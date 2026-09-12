import { createShell } from "./shell";
import { createEditor } from "./editor";
import { Keymap } from "./keys";
import { createFileTree, openKind } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadAttachment,
  fsReadSnapshot,
  documentSave,
  documentSetDirty,
  isCommandError,
  linkGraphResolve,
  onFsEntryChanged,
  onQuitBlocked,
  vaultCurrent,
  vaultOpen,
  vaultOpenPath,
  vaultRemap,
  wikilinkCreate,
} from "./ipc";
import type { FsEntry } from "./bindings/FsEntry";
import type { FsChangeKind } from "./bindings/FsChangeKind";
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

/** dirty 守卫提示（无法切换 / 无法退出）的标识类：dirty 清除时整批撤下。 */
const GUARD_TOAST_CLASS = "toast-dirty-guard";

// 打开文件：读出文本交给 editor.openDocument——模式裁决（文件类型优先，
// 无类型线索回落配置默认）和附件相对路径解析依赖的 currentFilePath 都在
// 内核里完成（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
let fileRequest = 0;
let displayedPath: string | undefined;
let displayedRevision: string | undefined;
let documentGeneration = 0;
let saveInFlight = false;

function dirtyGuard(action: string): boolean {
  if (!editor.isDirty()) return true;
  toast(`当前 Markdown 有未保存修改，无法${action}；请先保存（Cmd+S）`).classList.add(GUARD_TOAST_CLASS);
  return false;
}

// 保存失败的界面反馈（M101 验收修复）：冲突 / 写入失败 / 结果未知都必须给出
// 可理解的提示并说明修改仍保留在内存，不得静默或只剩技术化 message。
// 冲突与「文件已被外部删除」另有带动作的恢复提示（M124，见 saveCurrentFile
// 的 catch 分流），此处文案是两路共用的兜底与人话化映射。
const SAVE_ERROR_HINTS: Record<string, string> = {
  document_conflict: "保存冲突：文件在磁盘上已被外部修改，内存中的修改未丢失",
  document_write_failed: "保存失败：无法写入文档，内存中的修改未丢失",
  document_write_unknown: "保存结果未知：写入可能未生效，请核对文件内容，内存中的修改未丢失",
  fs_not_found: "保存失败：文件已被外部删除或移动，内存中的修改未丢失",
};

function saveErrorMessage(e: unknown): string {
  if (isCommandError(e)) return SAVE_ERROR_HINTS[e.code] ?? `保存失败：${e.message}`;
  return `保存失败：${errorMessage(e)}`;
}

function emitReadiness(name: string, detail: object = {}): void {
  window.dispatchEvent(new CustomEvent(`lumir:${name}`, { detail }));
}

editor.onReady((event) => {
  emitReadiness(event.phase, event);
});

async function openFile(path: string, kind: "md" | "code" | "text" | "binary") {
  if (!dirtyGuard("切换文件")) return;
  const request = ++fileRequest;
  const generation = ++documentGeneration;
  if (kind !== "binary") showNotice(`正在打开：${path}`);
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  try {
    const snapshot = await fsReadSnapshot(path);
    if (request !== fileRequest || generation !== documentGeneration || !dirtyGuard("切换文件")) return;
    const text = snapshot.content;
    const revision = kind === "md" ? snapshot.revision : undefined;
    displayedPath = path;
    displayedRevision = revision;
    currentPath = kind === "md" ? path : undefined;
    mastheadFile.textContent = path;
    invalidateResolve(); // from 变更，按 from 键控的缓存整批失效
    editor.openDocument(text, path, request);
    tree.setCurrentPath(path);
    showEditor();
  } catch (e) {
    if (request !== fileRequest) return;
    showNotice(errorMessage(e));
  }
}

/** 重载当前展示文件：与 openFile 同序（读快照 → 校验世代 → openDocument），
 * 但不走 dirtyGuard——调用方自行承担处置语义（冲突放弃 / watch 外部修改）。
 * 不主动换代号：捕获当前世代并在应用前校验未被并发打开挤占，迟到响应自然丢弃。
 * onlyIfChanged：revision 未变即跳过（自身保存也触发 watch Modified，避免每次
 * 保存后重载闪烁、光标复位）；应用前发现用户已开始输入（dirty）也放弃。 */
async function reloadDisplayedFile(path: string, opts: { onlyIfChanged?: boolean } = {}): Promise<boolean> {
  if (displayedPath !== path || editor.mode() !== "md" || !notice.hidden) return false;
  const request = fileRequest;
  const generation = documentGeneration;
  try {
    const snapshot = await fsReadSnapshot(path);
    if (request !== fileRequest || generation !== documentGeneration || displayedPath !== path) return false;
    if (opts.onlyIfChanged && (snapshot.revision === displayedRevision || editor.isDirty())) return false;
    if (editor.mode() !== "md") return false;
    displayedRevision = snapshot.revision;
    invalidateResolve(); // from 未变，但内容已换，按 from 键控的缓存整批失效
    editor.openDocument(snapshot.content, path, request);
    showEditor();
    return true;
  } catch (e) {
    if (request !== fileRequest) return false;
    toast(errorMessage(e));
    return false;
  }
}

/** 重新载入（放弃我的修改）：冲突处置与 watch 重载共用的入口，给出完成反馈。 */
async function discardAndReload(path: string): Promise<void> {
  if (await reloadDisplayedFile(path)) toast("已重新载入磁盘内容");
}

async function saveCurrentFile(): Promise<void> {
  if (saveInFlight || !displayedPath || editor.mode() !== "md" || !editor.isDirty() || !displayedRevision) return;
  const generation = documentGeneration;
  const path = displayedPath;
  const expectedRevision = displayedRevision;
  const content = editor.view.state.doc.toString();
  saveInFlight = true;
  try {
    const revision = await documentSave(path, expectedRevision, content);
    if (generation !== documentGeneration || displayedPath !== path) return;
    displayedRevision = revision;
    if (editor.view.state.doc.toString() === content) {
      editor.markClean();
      toast("已保存");
    } else {
      toast("已保存当前快照，仍有未保存修改");
    }
  } catch (e) {
    if (isCommandError(e) && e.code === "document_conflict") {
      // CAS 失败：重试必败（revision 已变），纯文案会把用户修改锁死在内存——
      // dirtyGuard 与退出守卫又堵死切换/退出，必须给逃生口（M124）。
      showConflictPrompt(path);
    } else if (isCommandError(e) && e.code === "fs_not_found") {
      showNotFoundPrompt(path);
    } else {
      toast(saveErrorMessage(e));
    }
  } finally { saveInFlight = false; }
}

/** 保存冲突的恢复提示：两个动作分别对应「放弃本地」与「覆盖磁盘」。sticky：
 * 冲突在用户处置前不得自动消隐。 */
function showConflictPrompt(path: string): void {
  toast(SAVE_ERROR_HINTS.document_conflict, [
    { label: "重新载入（放弃我的修改）", run: () => void discardAndReload(path) },
    { label: "强制覆盖保存", run: () => showForceSaveConfirm(path) },
  ], true);
}

/** 强制覆盖的二次确认：文案必须明示将覆盖磁盘上较新的内容（M124 裁决）。 */
function showForceSaveConfirm(path: string): void {
  toast("将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存？", [
    { label: "覆盖保存", run: () => void forceSaveCurrentFile(path) },
    { label: "取消", run: () => {} },
  ], true);
}

/** 强制覆盖保存：先拉取磁盘当前 revision 作为新的 CAS 基准再写入（经既有
 * fsReadSnapshot 封装，revision 与 fs_file_revision 同 sha256 原文口径）。
 * 拉取与写入之间再有外部修改则仍报冲突，用户可重试——不静默吞。 */
async function forceSaveCurrentFile(path: string): Promise<void> {
  if (saveInFlight || displayedPath !== path || editor.mode() !== "md") return;
  const content = editor.view.state.doc.toString();
  saveInFlight = true;
  try {
    const snapshot = await fsReadSnapshot(path);
    if (displayedPath !== path) return;
    const revision = await documentSave(path, snapshot.revision, content);
    displayedRevision = revision;
    if (editor.view.state.doc.toString() === content) {
      editor.markClean();
      toast("已强制覆盖保存");
    } else {
      toast("已强制覆盖保存当前快照，仍有未保存修改");
    }
  } catch (e) {
    if (isCommandError(e) && e.code === "fs_not_found") {
      // 冲突处置期间文件又被外部删除：同样走另存出口。
      showNotFoundPrompt(path);
    } else {
      toast(saveErrorMessage(e));
    }
  } finally { saveInFlight = false; }
}

/** 保存目标已被外部删除：内存修改是最后副本，给出另存入口（M124）。 */
function showNotFoundPrompt(path: string): void {
  toast(SAVE_ERROR_HINTS.fs_not_found, [
    { label: "另存为新文件", run: () => void saveAsNewFile(path) },
  ], true);
}

/** 另存为新文件：经 wikilink_create（后端 create_note，O_EXCL 语义不覆盖既有
 * 文件）在同目录建「原名-恢复.md」，把内存内容写入后切过去；撞名自动加序号
 * 重试。 */
async function saveAsNewFile(fromPath: string): Promise<void> {
  const stem = fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
  const content = editor.view.state.doc.toString();
  for (const suffix of ["", "-2", "-3", "-4", "-5"]) {
    try {
      const { created } = await wikilinkCreate(fromPath, `[[${stem}-恢复${suffix}]]`);
      const snapshot = await fsReadSnapshot(created); // 空文件 revision 作 CAS 基准
      await documentSave(created, snapshot.revision, content);
      // 缓冲内容已落到新文件，本地 dirty 处置完毕——否则 openFile 的 dirtyGuard
      // 会拦下这次切换，用户停在已删除文件上。
      editor.markClean();
      await openFile(created, "md");
      toast(`已另存为：${created}`);
      return;
    } catch (e) {
      if (isCommandError(e) && e.code === "wikilink_target_exists") continue;
      toast(errorMessage(e));
      return;
    }
  }
  toast("另存为新文件失败：同名文件已存在，请手动导出");
}

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveCurrentFile();
  }
});

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

const mastheadVault = shell.root.querySelector<HTMLElement>(".masthead-vault")!;
const mastheadFile = shell.root.querySelector<HTMLElement>(".masthead-file")!;

// dirty 状态反馈（M101 验收修复）：toast 会消隐，dirty 期间 masthead 文件名旁
// 常驻「未保存」标记；同时把 dirty 镜像给后端退出守卫（Cmd+Q / 关窗拦截）。
function syncDirtyIndicator(): void {
  if (displayedPath === undefined) return;
  mastheadFile.textContent = editor.isDirty() ? `${displayedPath}（未保存）` : displayedPath;
}

editor.onDirty((dirty) => {
  syncDirtyIndicator();
  // 保存成功（dirty→false）后所有 dirty 表现层必须一致清除：masthead 标记、
  // 后端退出守卫镜像，以及 dirty 期间弹出的守卫提示。sticky 提示按设计不自动
  // 消隐，不主动撤下会让「未保存」在保存成功后残留在右下角（桌面验收缺陷）。
  if (!dirty) shell.editor.querySelectorAll(`.${GUARD_TOAST_CLASS}`).forEach((el) => el.remove());
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
onQuitBlocked(() => {
  toast("当前有未保存修改，无法退出；请先保存（Cmd+S）", undefined, true).classList.add(GUARD_TOAST_CLASS);
}).catch(() => {});
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
  if (!dirtyGuard("切换 vault")) return;
  vaultLoaded = true;
  emitReadiness("vault-ready", { root, vaultId, restored });
  ++fileRequest;
  ++documentGeneration;
  displayedPath = undefined;
  displayedRevision = undefined;
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
  // 附件索引与文件树照常吃增量，文档内容另行处置。
  const openPath = displayedPath;
  if (openPath) {
    const hit = changes.find((c) => c.path === openPath);
    if (hit) handleExternalChange(openPath, hit.kind);
  }
  // 链接索引已由后端随事件流增量更新；前端清缓存重建装饰
  invalidateResolve();
  editor.refreshPreview();
  tree.applyChanges(changes);
}).catch(() => {});

/** watch 命中打开中文件的分流（M124）。保存进行中的批次跳过——自身保存也产生
 * 事件，由 reloadDisplayedFile 的 revision 比对丢弃；外部删除无法重载，只提示
 * 内容仍保留；dirty 时把选择权交给用户（sticky 浮条而非 modal，不打断打字）；
 * 未 dirty 自动重载并提示。仅 md 模式：展示中的 md 才有内存修改可丢失。 */
function handleExternalChange(path: string, kind: FsChangeKind): void {
  if (saveInFlight) return;
  if (kind === "deleted") {
    toast(`当前文件已被外部删除：${path}；编辑器中的内容未丢失`, [], true);
    return;
  }
  if (editor.isDirty()) {
    toast(`检测到外部修改：${path}`, [
      { label: "重载（放弃我的修改）", run: () => void discardAndReload(path) },
      { label: "保留我的版本", run: () => {} },
    ], true);
  } else {
    void reloadDisplayedFile(path, { onlyIfChanged: true }).then((reloaded) => {
      if (reloaded) toast("检测到外部修改，已自动重载");
    });
  }
}

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

// editor.mode：无类型线索时的默认模式（openFile 的模式裁决消费）。
// editor.measure 前端不消费（M107 标注的废弃路径）：行宽由 CSS --measure
//（style.css，默认 80% 百分比口径）控制，与 config.rs 的 100-2000px 整数
// 口径不一致。在 Rust 侧字段正式废弃前，配置里的 editor.measure 只被解析
// 校验，不影响任何界面行为。
configGet().then((snapshot) => editor.setMode(snapshot.config.editor.mode)).catch(() => {});

// app-ready 只表示 webview/application shell 已挂载，不等价于 vault 恢复或编辑器首帧。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
emitReadiness("app-ready", { time: now });
