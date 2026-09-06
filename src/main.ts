import { createShell } from "./shell";
import { createEditor } from "./editor";
import { Keymap } from "./keys";
import { createFileTree, openKind } from "./tree";
import { createThreads, type Thread } from "./threads";
import {
  configGet,
  threadList, threadCreate, threadUpdate, threadCurrent, threadSwitch,
  errorMessage,
  fsReadAttachment,
  fsReadFile,
  isCommandError,
  linkGraphResolve,
  onFsEntryChanged,
  vaultCurrent,
  vaultOpen,
  wikilinkCreate,
} from "./ipc";
import type { FsEntry } from "./bindings/FsEntry";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import { extensionOf, resolveByNameUnique } from "./preview/attachments";
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

// data: URL 的 MIME 推断，与 attachments.ts 私有 MIME_BY_EXTENSION 同口径。
// 该文件不在本 mission scope，对齐点（provider 工厂接受注入的读取函数 /
// 抽出公共 MIME 表）已报 tower，此处就地维护一份。
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

// 附件 provider：文件名匹配走 vault 索引（add-vault-workspace 裁决点 F），
// 字节读取走 ipc 的 fsReadAttachment 封装（裁决点 A，invoke + base64）。
// 索引未命中 → livePreview 出「附件未找到」占位；读取失败 → ImageWidget
// 原地换「图片读取失败」占位，都不抛错。
editor.setAttachmentProvider({
  resolveByName: (name) => resolveByNameUnique(attachmentPaths, name),
  async readDataUrl(path) {
    const base64 = await fsReadAttachment(path);
    const mime = IMAGE_MIME[extensionOf(path)] ?? "application/octet-stream";
    return `data:${mime};base64,${base64}`;
  },
});

const keymap = new Keymap();

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
function toast(text: string, action?: { label: string; run(): void }): void {
  const el = document.createElement("div");
  el.className = "lumir-toast toast-surface";
  const span = document.createElement("span");
  span.textContent = text;
  el.append(span);
  if (action) {
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
  shell.editor.append(el);
  setTimeout(() => el.remove(), action ? 8000 : 3500);
}

// 打开文件：读出文本交给 editor.openDocument——模式裁决（文件类型优先，
// 无类型线索回落配置默认）和附件相对路径解析依赖的 currentFilePath 都在
// 内核里完成（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
async function openFile(path: string, kind: "md" | "code" | "text" | "binary") {
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  try {
    const text = await fsReadFile(path);
    currentPath = kind === "md" ? path : undefined;
    invalidateResolve(); // from 变更，按 from 键控的缓存整批失效
    editor.openDocument(text, path);
    tree.setCurrentPath(path);
    showEditor();
  } catch (e) {
    // CommandError 的 message 是人话（如非法 UTF-8），直接展示
    showNotice(errorMessage(e));
  }
}

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

/** 激活链接（点击 / Mod-Enter）：按解析结果跳转、提示或给出一键创建入口。 */
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
      toast(`未创建的链接：${raw}`, {
        label: "创建并打开",
        run: () => void createForWikilink(from, raw),
      });
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

// 点击跳转（spec §4.2）：Mod-Click 命中 wikilink span 时阻止选区落点，直接跟随链接；
// 裸点击不拦截，保持链接文本可正常落点编辑。
editor.view.dom.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!(e.metaKey || e.ctrlKey)) return; // Mod-Click：macOS Cmd，跨平台兼容 Ctrl
  if (currentPath === undefined) return; // 无 vault 上下文：链接只是文本
  const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return;
  const raw = wikilinkAt(pos);
  if (raw === null) return;
  e.preventDefault();
  void followWikilink(raw);
});

// 键位（ADR 0001 §4：chorded 非 modal）：Mod-Enter 跟随光标处链接。
keymap.register("Mod-Enter", "wikilink.follow");
keymap.attach(window, (command) => {
  if (command === "wikilink.follow") {
    const raw = wikilinkAt(editor.view.state.selection.main.head);
    if (raw !== null) void followWikilink(raw);
  }
});

shell.panel.hidden = true;
shell.root.classList.add("panel-default-hidden");

const mastheadVault = shell.root.querySelector<HTMLElement>(".masthead-vault")!;
const mastheadThread = shell.root.querySelector<HTMLElement>(".masthead-thread")!;
const mastheadStatus = shell.root.querySelector<HTMLElement>(".masthead-status")!;
let tree!: ReturnType<typeof createFileTree>;
const sessionThreads: Thread[] = [];
let selectedThreadId: string | undefined;
let currentVaultId = "";
const threadStatusLabels: Record<string, string> = { active: "进行中", paused: "暂停", completed: "完成", archived: "归档" };
function refreshThreads() {
  const counts = new Map<string, number>();
  for (const item of sessionThreads) for (const file of item.files) counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
  tree?.setReferenceCounts(counts);
  threads.setThreads(sessionThreads);
  threads.setCurrent(selectedThreadId);
  const selected = sessionThreads.find((item) => item.id === selectedThreadId);
  mastheadThread.textContent = selected?.title ?? "无当前 Thread";
  mastheadStatus.textContent = selected ? threadStatusLabels[selected.status] : "—";
}
const threads = createThreads(shell.threads, {
  onCreate: async (title) => {
    try { const item = await threadCreate(title, currentVaultId); sessionThreads.push(item); selectedThreadId = item.id; refreshThreads(); toast(`已创建 Thread：${title}`); }
    catch (error) { toast(errorMessage(error)); throw error; }
  },
  onSelect: async (id) => {
    try { const item = await threadSwitch(id, currentVaultId); selectedThreadId = item.id; sessionThreads.splice(0, sessionThreads.length, ...(await threadList(currentVaultId))); refreshThreads(); }
    catch (error) { toast(errorMessage(error)); throw error; }
  },
  onStatus: async (id, status) => {
    const item = sessionThreads.find((thread) => thread.id === id);
    if (!item) return;
    const previous = { ...item };
    try { const updated = await threadUpdate({ ...item, status }); Object.assign(item, updated); refreshThreads(); toast("Thread 已保存"); }
    catch (error) { Object.assign(item, previous); refreshThreads(); toast(errorMessage(error)); throw error; }
  },
});
refreshThreads();
tree = createFileTree(shell.treeMount, {
  onOpenFile: (path, kind) => void openFile(path, kind),
  onOpenVault: () => {
    vaultOpen()
      .then((info) => {
        // null = 用户在目录选择器取消，无错误状态（spec）
        if (info) loadVault(info.root, info.entries, info.vault_id, info.remap_candidates);
      })
      .catch((e) => {
        // 已有 vault 时打开失败（如改选了一个不可读目录）不得把既有树抹成
        // 空态——空态只属于"尚无 vault"的启动路径；此处仅浮条提示。
        if (vaultLoaded) toast(errorMessage(e));
        else tree.showEmpty(errorMessage(e));
      });
  },
});

// vault 装载的两个入口（手动打开 / 启动恢复）共用：先换附件索引再装文件树。
// 换 vault 前必须全量复位旧上下文（reviewer-switcher high finding）：否则旧
// 文件的 currentPath 会被当作新 vault 的 resolve/create from 基准，wikilink
// 一键创建会把文件误建到新 vault 的同名相对路径下。
function loadVault(root: string, entries: FsEntry[], vaultId = root, remapCandidates: Array<{ id: string; path: string }> = []) {
  vaultLoaded = true;
  currentVaultId = vaultId;
  if (remapCandidates.length) toast(`发现 ${remapCandidates.length} 个可映射的 vault 路径`);
  void threadList(currentVaultId).then((items) => { sessionThreads.splice(0, sessionThreads.length, ...items); return threadCurrent(currentVaultId); }).then((current) => { selectedThreadId = current?.id; refreshThreads(); });
  attachmentPaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  // 链接索引已在后端随 vault 打开建立；世代号自增使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效
  resolveEpoch += 1;
  invalidateResolve();
  // 三件套重置：清空编辑器文档（内部 currentFilePath 一并置空）、复位前端
  // currentPath；旧 vault 的「暂不支持预览」覆盖层一并撤下
  editor.reset();
  currentPath = undefined;
  showEditor();
  editor.setWikilinkResolver(wikilinkResolver);
  mastheadVault.textContent = root.slice(root.lastIndexOf("/") + 1) || root;
  tree.setCurrentPath(undefined);
  tree.setVault(root, entries);
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
      loadVault(status.vault.root, status.vault.entries, status.vault.vault_id, status.vault.remap_candidates);
    } else {
      tree.showEmpty(status.notice);
    }
  })
  .catch((e) => tree.showEmpty(errorMessage(e)));

configGet().then((snapshot) => editor.setMode(snapshot.config.editor.mode)).catch(() => {});

const themes = ["light", "dark", "eink"] as const;
let themeIndex = Math.max(0, themes.indexOf((localStorage.getItem("lumir-theme") as typeof themes[number]) || "light"));
document.documentElement.dataset.theme = themes[themeIndex];
window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "\\") shell.panel.hidden = !shell.panel.hidden;
  if ((event.metaKey || event.ctrlKey) && event.key === "t") {
    themeIndex = (themeIndex + 1) % themes.length;
    document.documentElement.dataset.theme = themes[themeIndex];
    localStorage.setItem("lumir-theme", themes[themeIndex]);
  }
});

// ready 信号（前端一半）：webview 首屏挂载完成即打点。
// Rust core 启动完成后会打印 LUMIR_READY 结构化日志（见 src-tauri/src/lib.rs），
// 两端时间戳合起来构成 perf mission 的测量终点（ADR 0002 §6 委托 M0 定义测量方法学）。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
