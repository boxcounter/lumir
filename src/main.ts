import { createShell } from "./shell";
import { createEditor } from "./editor";
import { applyKeyOverrides, Keymap } from "./keys";
import type { CommandRunner, CommandRuntime, KeyOverrides } from "./keys";
import { createFileTree, openKind } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadAttachment,
  fsReadSnapshot,
  documentSetDirty,
  isCommandError,
  linkGraphResolve,
  onFsEntryChanged,
  onMenuCommand,
  onQuitBlocked,
  vaultCurrent,
  vaultOpen,
  vaultOpenPath,
  vaultRemap,
  wikilinkCreate,
} from "./ipc";
import { createSaveController } from "./save-controller";
import type { FsEntry } from "./bindings/FsEntry";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import { extensionOf, mimeTypeOf, resolveByNameUnique } from "./preview/attachments";
import { findWikilinkSpans } from "./preview/wikilinks";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

// M1 装配：app-shell 三栏 + 编辑器单内核 + 键位框架 + 全类型文件树
//（add-vault-workspace），M20 接上附件链路（add-editor-live-preview）。
// editor.ts 的 EditorHandle 由 editor 波持有，此处只消费，不改其签名。
const shell = createShell(app);
const editor = createEditor(shell.editor);

// 附件索引：vault 内全部文件（不含目录）的 vault 相对路径。provider 的
// resolveByName 闭包活读它，vault 切换 / watch 增量就地更新数组，无需重注。
let attachmentPaths: string[] = [];
/** 是否已有 vault 装载成功；onOpenVault 失败时据此决定空态还是浮条提示。 */
let vaultLoaded = false;

// 附件 provider：文件名匹配走 vault 索引（add-vault-workspace 裁决点 F），
// 字节读取走 ipc 的 fsReadAttachment 封装（裁决点 A，invoke + base64）。
// 索引未命中 → livePreview 出「附件未找到」占位；读取失败 → ImageWidget
// 原地换「图片读取失败」占位，都不抛错。MIME 取扩展名注册表（M130 收敛后
// main.ts 不再自维护一份 IMAGE_MIME）。
editor.setAttachmentProvider({
  resolveByName: (name) => resolveByNameUnique(attachmentPaths, name),
  async readDataUrl(path) {
    const base64 = await fsReadAttachment(path);
    const mime = mimeTypeOf(extensionOf(path)) ?? "application/octet-stream";
    return `data:${mime};base64,${base64}`;
  },
});

// 编辑器区域的"暂不支持预览 / 错误提示"覆盖层：显示提示时藏起编辑器本体。
const notice = document.createElement("div");
notice.className = "editor-notice";
notice.hidden = true;
shell.editor.append(notice);

function showNotice(text: string) {
  notice.textContent = text;
  notice.hidden = false;
  editor.view.dom.style.display = "none";
}

function showEditor() {
  notice.hidden = true;
  editor.view.dom.style.display = "";
}

// 瞬时提示（锚点缺失 / 创建结果 / 解析错误）：编辑器右下角浮条，自动消隐。
// sticky 的提示（如退出被拦截）不自动消隐，点击浮条本体关闭——守卫类反馈
// 不允许在用户看到之前消失。sticky 提示按文案去重（M107）：连续触发同一守卫
//（如连按 Cmd+Q）复用既有浮条，不堆叠；自动消隐的普通 toast 不受此限。
function toast(text: string, actions: Array<{ label: string; run(): void }> = [], sticky = false): HTMLElement {
  if (sticky) {
    for (const el of shell.editor.querySelectorAll<HTMLElement>(".lumir-toast[data-sticky-text]")) {
      if (el.dataset.stickyText === text) return el;
    }
  }
  const el = document.createElement("div");
  el.className = "lumir-toast toast-surface";
  const span = document.createElement("span");
  span.textContent = text;
  el.append(span);
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.className = "toast-action";
    btn.addEventListener("click", () => {
      el.remove();
      action.run();
    });
    el.append(btn);
  }
  if (sticky) {
    el.dataset.stickyText = text;
    el.addEventListener("click", () => el.remove());
  }
  shell.editor.append(el);
  if (!sticky) setTimeout(() => el.remove(), actions.length ? 8000 : 3500);
  return el;
}

/** dirty 守卫提示的标识类与保存链路的其余决策都在 src/save-controller.ts；
 *  main.ts 只装配（M127）。原 fileRequest 与 documentGeneration 恒同增同减，
 *  已合并为 controller 的世代号，兼作 editor.openDocument 的 requestId。 */
const save = createSaveController({
  editor,
  container: shell.editor,
  toast,
  openFile: (path, kind) => openFile(path, kind),
  invalidateResolve: () => invalidateResolve(),
  showEditor: () => showEditor(),
  isNoticeHidden: () => notice.hidden,
});

function emitReadiness(name: string, detail: object = {}): void {
  window.dispatchEvent(new CustomEvent(`lumir:${name}`, { detail }));
}

editor.onReady((event) => {
  emitReadiness(event.phase, event);
});

// 打开文件：读出文本交给 editor.openDocument——模式裁决（以扩展名注册表为唯一
// 事实源：.md/.markdown → md 模式；其余已打开的文件一律只读 code，含未知扩展与
// basename 无点的文件，M130 方向 A）和附件相对路径解析依赖的 currentFilePath 都在
// 内核里完成（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
async function openFile(path: string, kind: "md" | "code" | "text" | "binary") {
  if (!save.guard("切换文件")) return;
  const request = save.beginSwitch();
  if (kind !== "binary") showNotice(`正在打开：${path}`);
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  try {
    const snapshot = await fsReadSnapshot(path);
    if (!save.isCurrent(request) || !save.guard("切换文件")) return;
    const text = snapshot.content;
    // 只有 md 进保存链路（登记磁盘 revision）；非 md 以只读 code 模式打开，不存在
    // dirty，也不该被任何保存入口接受（M130）。currentPath 同理：wikilink 语义只对
    // md 生效，非 md 打开时不作 resolve 的 from 基准。
    const revision = kind === "md" ? snapshot.revision : undefined;
    save.noteOpened(path, revision);
    currentPath = kind === "md" ? path : undefined;
    mastheadFile.textContent = path;
    invalidateResolve(); // from 变更，按 from 键控的缓存整批失效
    editor.openDocument(text, path, request);
    tree.setCurrentPath(path);
    showEditor();
  } catch (e) {
    if (!save.isCurrent(request)) return;
    showNotice(errorMessage(e));
  }
}

window.addEventListener("beforeunload", (event) => {
  if (!editor.isDirty()) return;
  event.preventDefault();
  event.returnValue = "当前 Markdown 有未保存修改";
});

// ---------------------------------------------------------------------------
// wikilink：解析缓存、跳转、一键创建（语义全部经 invoke 取 Rust link_graph 结果）
// ---------------------------------------------------------------------------

/** 当前文件（md 模式）的 vault 相对路径；resolve 的 from 基准。 */
let currentPath: string | undefined;
/** 解析结果缓存：键 = `${from}\n${raw}`。watch 增量 / 切文件 / 创建后整批失效。 */
const resolveCache = new Map<string, LinkResolveResult>();
const pendingResolve = new Set<string>();
/** 业务错误降级集合：resolve 失败的键（与 resolveCache 同生命周期，随其整批失效）。 */
const failedResolve = new Set<string>();
/** vault 世代号：loadVault 自增，在途 resolve 回调据此丢弃旧 vault 的迟到响应。 */
let resolveEpoch = 0;

/** 解析失败分类：仅命令缺失 / 无后端（非 CommandError 信封）才整体降级。 */
function handleResolveFailure(key: string, epoch: number, e: unknown): void {
  if (epoch !== resolveEpoch) return; // 旧 vault 的迟到响应，直接丢弃
  if (isCommandError(e)) {
    // 业务错误（路径逃逸 / 目标不存在 / vault_not_open 等）：只降级该链接——
    // 保持中性 pending 视觉，不拖垮其余链接的语义渲染；显式点击走
    // followWikilink 的 catch 弹人话提示，此处被动渲染不打扰。
    failedResolve.add(key);
    editor.refreshPreview();
  } else {
    // invoke 层失败（命令未注册 / 无 Tauri 后端，如纯浏览器预览桩）：整体降级
    editor.setWikilinkResolver(null);
  }
}

const wikilinkResolver = {
  resolve(raw: string): LinkResolveResult | undefined {
    const from = currentPath;
    if (from === undefined) return undefined;
    const key = `${from}\n${raw}`;
    const hit = resolveCache.get(key);
    if (hit) return hit;
    if (failedResolve.has(key)) return undefined; // 该链接已知失败，保持中性渲染
    if (!pendingResolve.has(key)) {
      pendingResolve.add(key);
      const epoch = resolveEpoch;
      linkGraphResolve(from, raw).then(
        (r) => {
          if (epoch !== resolveEpoch) return;
          resolveCache.set(key, r);
          editor.refreshPreview();
        },
        (e) => handleResolveFailure(key, epoch, e),
      ).finally(() => pendingResolve.delete(key));
    }
    return undefined;
  },
};

/** 解析状态整批失效（from 变更 / watch 增量 / 一键创建后共用）。 */
function invalidateResolve(): void {
  resolveCache.clear();
  failedResolve.clear();
  // 在途标记一并清：被 epoch 丢弃的迟到响应不会重触发解析，不清会让同 key
  // 链接卡在中性渲染；在途 promise 的 finally delete 对已清集合是 no-op。
  pendingResolve.clear();
}

/** 激活链接（Mod-Click / ⌘Enter）：按解析结果跳转、提示或给出一键创建入口。 */
async function followWikilink(raw: string): Promise<void> {
  const from = currentPath;
  if (from === undefined) return;
  let result = resolveCache.get(`${from}\n${raw}`);
  if (!result) {
    try {
      result = await linkGraphResolve(from, raw);
      resolveCache.set(`${from}\n${raw}`, result);
    } catch (e) {
      toast(errorMessage(e));
      return;
    }
  }
  switch (result.status) {
    case "resolved":
    case "ambiguous": {
      const path = result.path;
      if (path === null) return;
      await openFile(path, openKind(path));
      // spec §4.2：锚点找到定位标题行；缺失时打开文件并提示，不静默停在顶部
      if (result.anchor.status === "found" && result.anchor.line !== null) {
        editor.revealLine(result.anchor.line);
      } else if (result.anchor.status === "missing") {
        toast(`标题未找到：${result.anchor.heading ?? ""}`);
      }
      break;
    }
    case "unresolved":
      // spec §4.3：unresolved 不是错误；§4.4：提供一键创建入口
      toast(`未创建的链接：${raw}`, [{
        label: "创建并打开",
        run: () => void createForWikilink(from, raw),
      }]);
      break;
    case "unsupported":
      toast(`块引用不支持：${raw}`);
      break;
  }
}

async function createForWikilink(from: string, raw: string): Promise<void> {
  try {
    const { created } = await wikilinkCreate(from, raw);
    invalidateResolve();
    editor.refreshPreview(); // 创建成功后链接转为正常态（spec §4.4）
    await openFile(created, "md");
    toast(`已创建：${created}`);
  } catch (e) {
    // 目标已存在 = 索引过期（spec §4.4）：清缓存重解析而非覆盖
    invalidateResolve();
    editor.refreshPreview();
    toast(errorMessage(e));
  }
}

/** 光标/点击处的非 embed wikilink span（span 定位是前端唯一持有的词法逻辑）。 */
function wikilinkAt(pos: number): string | null {
  const text = editor.view.state.doc.toString();
  for (const span of findWikilinkSpans(text)) {
    if (!span.embed && pos >= span.from && pos < span.to) {
      return text.slice(span.from, span.to);
    }
  }
  return null;
}

// 点击跳转（spec §4.2）：⌘-Click 命中 wikilink span 时阻止选区落点，直接跟随链接；
// 裸点击不拦截，保持链接文本可正常落点编辑。
// M132 收窄：鼠标路径与 D1 的 ⌘/⌃ 拆分对齐——只有 ⌘-Click 跟随链接；⌃-Click 让位给
// macOS 的系统级次级点击（右键等价手势），不再被当作链接激活。键位表只管键盘，鼠标
// 路径就地判定（收窄前是 e.metaKey || e.ctrlKey，与拆分前的键盘口径同源）。
editor.view.dom.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!e.metaKey) return;
  if (currentPath === undefined) return; // 无 vault 上下文：链接只是文本
  const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return;
  const raw = wikilinkAt(pos);
  if (raw === null) return;
  e.preventDefault();
  void followWikilink(raw);
});

// ---------------------------------------------------------------------------
// 统一键位层（M131）：唯一分发表在 keys.ts，装配在这里——编辑器侧命令由 editor 提供，
// 装配侧命令（保存 / 链接跟随）在下面就地实现。原先散落的四条旁路（keys.ts 的
// window trie、editor 的 CM keymap 与 domEventHandlers、此处的裸 window 监听）已全部
// 迁入；剩下的只有这一处 attach。
// ---------------------------------------------------------------------------
const commands: CommandRuntime = {
  ...editor.commands,
  "document.save": () => {
    void save.save();
  },
  // 轨道 A 原样迁入：作用域仍是 global（迁移前挂在 window 上，任意焦点都生效）。
  "wikilink.follow": () => {
    const raw = wikilinkAt(editor.view.state.selection.main.head);
    if (raw !== null) void followWikilink(raw);
  },
};

// editor 作用域判定：事件目标落在 contentDOM 内（含其中 widget 与表格滚动容器）。
// 用目标而非焦点，是因为轨道 D 的 widget 就在 contentDOM 里——焦点落在表格滚动
// 容器上时命令照常生效；容器自己的滚动键由表内绑定用 `when` 收窄（M132），
// 分发器入口另对已消费事件（defaultPrevented）让路。
const keymapContext = {
  isEditorEvent: (event: KeyboardEvent) =>
    event.target instanceof Node && editor.view.contentDOM.contains(event.target),
};
let detachKeymap = new Keymap().attach(window, commands, keymapContext);

/** 应用配置里的 [keys] 覆盖（M132）：先挂默认表、配置到位后重挂，避免「启动瞬间按键
 *  无响应」的竞态。覆盖只换「键 → 命令」的对应（作用域随命令归属，见 keys.ts）；
 *  未知命令 / 非法键位 / 多段 chord 都给 warning 并忽略该条，MUST NOT 抛错打断启动。
 *  warning 走 console（与 ConfigSnapshot.warnings 的既有口径一致：M1 以来配置 warning
 *  没有 UI 出口，本 change 不新增 UI 面）。 */
function applyKeyConfig(overrides: KeyOverrides | undefined): void {
  const { bindings, warnings } = applyKeyOverrides(overrides ?? {});
  for (const warning of warnings) console.warn(`lumir: ${warning}`);
  if (Object.keys(overrides ?? {}).length === 0) return; // 无覆盖：默认表已在分发
  detachKeymap();
  detachKeymap = new Keymap(bindings).attach(window, commands, keymapContext);
}

// 原生 Edit 菜单的撤销 / 重做项（lib.rs 的自定义项，不带 accelerator）点击后经此事件
// 回到前端——菜单与键盘走同一个命令层，不产生第二套撤销。取值口径见 lib.rs
// MENU_COMMAND_EVENT：菜单只说 undo/redo，映射到命令 id 是前端的事。
// M132：该通道从装配层直连 listen 收进 ipc.ts 的 onMenuCommand（同类事件走同一模块，
// M131 已把它记为待收编项）；ipc.ts 的这一族因此覆盖 invoke 与 listen 两条通道。
const MENU_COMMANDS: Record<string, CommandRunner | undefined> = {
  undo: commands["editor.undo"],
  redo: commands["editor.redo"],
};
onMenuCommand((payload) => {
  MENU_COMMANDS[payload]?.();
}).catch(() => {}); // 无 Tauri 后端（纯浏览器预览）时静默忽略

const mastheadVault = shell.root.querySelector<HTMLElement>(".masthead-vault")!;
const mastheadFile = shell.root.querySelector<HTMLElement>(".masthead-file")!;

// dirty 状态反馈（M101 验收修复）：toast 会消隐，dirty 期间 masthead 文件名旁
// 常驻「未保存」标记；同时把 dirty 镜像给后端退出守卫（Cmd+Q / 关窗拦截）。
function syncDirtyIndicator(): void {
  const path = save.displayedPath();
  if (path === undefined) return;
  mastheadFile.textContent = editor.isDirty() ? `${path}（未保存）` : path;
}

editor.onDirty((dirty) => {
  syncDirtyIndicator();
  // 保存成功（dirty→false）后所有 dirty 表现层必须一致清除：masthead 标记、
  // 后端退出守卫镜像，以及 dirty 期间弹出的守卫提示。sticky 提示按设计不自动
  // 消隐，不主动撤下会让「未保存」在保存成功后残留在右下角（桌面验收缺陷）。
  if (!dirty) save.clearGuardToasts();
  // 无 Tauri 后端（纯浏览器预览）时同步失败无害，静默忽略。
  documentSetDirty(dirty).catch(() => {});
});

// DirtyState 防滞留（M107）：后端的 dirty 镜像在 webview 重载（开发者刷新 /
// 崩溃重载）后可能滞留 stale true，退出守卫将永久拦截。前端是唯一事实源，
// 初始化后主动推送一次当前值复位镜像（启动时必为 false）；重载后用户再次
// 编辑仍走 onDirty 正常同步。无 Tauri 后端时失败无害，静默忽略。
documentSetDirty(editor.isDirty()).catch(() => {});

// 退出/关窗被 dirty 守卫拦截时必须可见（M101）：后端 prevent_exit/prevent_close
// 本身无任何界面表现，前端收到事件要给出可理解的提示。sticky：拦截提示不得
// 在用户看到前自动消隐（守卫反馈要持续可见，点击浮条关闭）。
onQuitBlocked(() => save.showQuitBlocked()).catch(() => {});
let tree!: ReturnType<typeof createFileTree>;
// 目录选择器入口（空态按钮与树头部「切换」共用）。命中重映射候选时
//（spec：未注册路径 + 失效注册需显式确认）open_vault 按契约返回空 entries，
// 此时不得装载——否则用户看到 vault 名已换、树全空的死态（桌面验收缺陷）；
// 改为 sticky 提示给出两个出口：作为新 vault 打开 / 确认映射到最近期候选。
function pickVault(forceNew = false): void {
  vaultOpen(forceNew)
    .then((info) => {
      // null = 用户在目录选择器取消，无错误状态（spec）
      if (!info) return;
      if (info.remap_candidates.length > 0) {
        const top = info.remap_candidates[0];
        const name = info.root.slice(info.root.lastIndexOf("/") + 1) || info.root;
        // 确认动作用 vaultOpenPath 直开刚选中的路径，不再弹一次选择器。
        const reopen = () => vaultOpenPath(info.root, true)
          .then((opened) => loadVault(opened.root, opened.entries, opened.vault_id))
          .catch((e) => toast(errorMessage(e)));
        toast(
          `「${name}」尚未注册为 vault；发现可能已移动的 vault：${top.path}`,
          [
            { label: "作为新 vault 打开", run: () => void reopen() },
            {
              label: "确认映射到此路径",
              run: () => void vaultRemap(top.id, info.root)
                .then(() => reopen())
                .catch((e) => toast(errorMessage(e))),
            },
          ],
          true,
        );
        return;
      }
      loadVault(info.root, info.entries, info.vault_id);
    })
    .catch((e) => {
      // 已有 vault 时打开失败（如改选了一个不可读目录）不得把既有树抹成
      // 空态——空态只属于"尚无 vault"的启动路径；此处仅浮条提示。
      if (vaultLoaded) toast(errorMessage(e));
      else tree.showEmpty(errorMessage(e));
    });
}

tree = createFileTree(shell.treeMount, {
  onOpenFile: (path, kind) => void openFile(path, kind),
  onOpenVault: () => pickVault(),
});

// vault 装载的两个入口（手动打开 / 启动恢复）共用：先换附件索引再装文件树。
// 换 vault 前必须全量复位旧上下文（reviewer-switcher high finding）：否则旧
// 文件的 currentPath 会被当作新 vault 的 resolve/create from 基准，wikilink
// 一键创建会把文件误建到新 vault 的同名相对路径下。
function loadVault(root: string, entries: FsEntry[], vaultId = root, restored = false) {
  if (!save.guard("切换 vault")) return;
  vaultLoaded = true;
  emitReadiness("vault-ready", { root, vaultId, restored });
  save.noteVaultReset();
  attachmentPaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  // 链接索引已在后端随 vault 打开建立；世代号自增使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效
  resolveEpoch += 1;
  invalidateResolve();
  // 三件套重置：清空编辑器文档（内部 currentFilePath 一并置空）、复位前端
  // currentPath；旧 vault 的「暂不支持预览」覆盖层一并撤下
  editor.reset();
  currentPath = undefined;
  mastheadFile.textContent = "无当前文件";
  showEditor();
  editor.setWikilinkResolver(wikilinkResolver);
  mastheadVault.textContent = root.slice(root.lastIndexOf("/") + 1) || root;
  tree.setCurrentPath(undefined);
  tree.setVault(root, entries);
  // 残留崩溃备份的恢复入口（M127）：装载完成后才有 vault 上下文可定位备份。
  void save.checkRecovery();
}

// watch 增量事件流 → 附件索引与文件树同步打补丁（都不全量重扫）。
// 无 Tauri 后端的环境（如纯浏览器预览）下 listen 会 reject，静默忽略。
onFsEntryChanged((changes) => {
  for (const change of changes) {
    if (change.kind === "deleted") {
      // 目录删除连同子孙一起出索引（与 tree.applyChanges 的级联删除同口径）
      attachmentPaths = attachmentPaths.filter(
        (p) => p !== change.path && !p.startsWith(`${change.path}/`),
      );
    } else if (
      (change.entry_kind ?? "file") === "file" &&
      !attachmentPaths.includes(change.path)
    ) {
      attachmentPaths.push(change.path);
    }
  }
  // 打开中文件被外部变更（Lumir ↔ Obsidian 来回编辑的高频路径，M124）：
  // 附件索引与文件树照常吃增量，文档内容另行处置（save 控制器内分流）。
  const openPath = save.displayedPath();
  if (openPath) {
    const hit = changes.find((c) => c.path === openPath);
    if (hit) save.handleExternalChange(openPath, hit.kind);
  }
  // 链接索引已由后端随事件流增量更新；前端清缓存重建装饰
  invalidateResolve();
  editor.refreshPreview();
  tree.applyChanges(changes);
}).catch(() => {});

// 启动恢复：后端 setup 已按 last_vault 尝试自动打开；这里拉取结果。
// 未打开 → 空态 + 打开入口；恢复失败 → 空态上人话提示。
vaultCurrent()
  .then((status) => {
    if (status.vault) {
      loadVault(status.vault.root, status.vault.entries, status.vault.vault_id, true);
    } else {
      tree.showEmpty(status.notice);
    }
  })
  .catch((e) => tree.showEmpty(errorMessage(e)));

// editor.mode：只对没有文件上下文的文档（空态 / 新建）生效的默认模式；打开文件时
// 一律按扩展名裁决（M130 方向 A：非 md 只读 code），该配置对文件打开不再有影响。
// keys：单键重绑 / 解绑（M132），覆盖到位后重挂分发器（见 applyKeyConfig）。
configGet().then((snapshot) => {
  editor.setMode(snapshot.config.editor.mode);
  applyKeyConfig(snapshot.config.keys);
  // 配置 warning（含 [keys] 的逐项回退）：M1 以来没有 UI 出口，如实记到 console，
  // 不新增 UI 面（避免启动浮条与既有启动视觉冲突）。
  for (const warning of snapshot.warnings) console.warn(`lumir: ${warning}`);
}).catch(() => {});

// app-ready 只表示 webview/application shell 已挂载，不等价于 vault 恢复或编辑器首帧。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
emitReadiness("app-ready", { time: now });
