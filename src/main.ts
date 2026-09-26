import { createShell } from "./shell";
import { createEditor } from "./editor";
import { applyKeyOverrides, KEY_BINDINGS, Keymap } from "./keys";
import type { CommandRunner, CommandRuntime, KeyBinding, KeyOverrides } from "./keys";
import { baseName, createFileTree, openKind } from "./tree";
import {
  configGet,
  configSetUiValue,
  errorMessage,
  fsReadAttachment,
  fsReadSnapshot,
  documentSetDirty,
  onFsEntryChanged,
  onMenuCommand,
  onQuitBlocked,
  onVaultRestoreFinished,
  readingPositionGet,
  readingPositionPut,
  vaultCurrent,
  vaultList,
  vaultOpen,
  vaultOpenPath,
  vaultRemap,
  vaultSessionGet,
  vaultSessionPut,
} from "./ipc";
import { createSaveController, SAVE_GUARD_TOAST_CLASS } from "./save-controller";
import { getName, getVersion } from "@tauri-apps/api/app";
import { createToc } from "./toc";
import { createImageLightbox } from "./lightbox";
import {
  createGuardPromptPresenter,
  createVaultRemapPrompt,
  createVaultSwitcher,
  createVaultSwitchGate,
  samePath,
} from "./vault-switcher";
import type { VaultSwitcherHandle } from "./vault-switcher";
import { createReadingPositionStore } from "./reading-position";
// M151：名字听不出归属的三块能力各自的模块（见各处装配点与模块头注释）。
// link-follow（解析缓存 + 链接跟随）、tabs（标签栏 DOM）、bindings-panel（键位查看面板）。
import { createLinkFollow } from "./link-follow";
import { createTabs } from "./tabs";
import { createBindingsPanel } from "./bindings-panel";
import { WIDTH_SAVE_FAILED_TEXT, createContentWidthDrag } from "./content-width";
import { createTitlebarIdentity } from "./modeline";
import {
  THEME_INDICATOR_LABEL,
  THEME_SAVE_FAILED_TEXT,
  currentTheme,
  nextTheme,
} from "./theme";
import { invalidateMermaidTheme } from "./preview/mermaid";
import { logEvent, sampleCallback } from "./diagnostics";
import type { FsEntry } from "./bindings/FsEntry";
import type { UiTheme } from "./bindings/UiTheme";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultListEntry } from "./bindings/VaultListEntry";
import { codeLanguage, extensionOf, mimeTypeOf, resolveByNameUnique } from "./preview/attachments";
import { openSearch } from "./search";
import "./style.css";
// 搜索 panel 的样式单列一个文件（M139）：与并行 mission 的 src/style.css 隔离，
// 本 mission 的搜索样式一律放这里。
import "./search-panel.css";

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
/** 已装载的 vault 根（`vaultLoaded` 为真时有效）：启动恢复有两条入口（完成信号与首次
 *  拉取），两者可能同时到达——同一个 vault 的重复响应只装载一次，避免重复走一遍
 *  装载副作用（编辑器整批复位、崩溃备份入口再弹一次）。 */
let loadedRoot: string | undefined;
/** 当前 vault 的显示名（= 目录 basename，M163）：切换器列表的当前项与 dirty
 *  守卫提示都读它。唯一赋值点是 applyVault——侧栏头的 vault 名由 src/tree.ts 的
 *  setVault 用同一个 baseName 派生，本文件不另存一份派生物。 */
let vaultName = "";

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

// 图片放大查看（M184，双击内联图片 → 应用内遮罩）：能力与 DOM 在 src/lightbox.ts，装配侧只给
// 它两样看不到的东西——挂点（app-shell 根，与键位面板同款）与关闭后把焦点交还编辑器。
// 遮罩 DOM 惰性建立：文档打开路径与键入路径上零新增工作。
const lightbox = createImageLightbox({
  mount: shell.root,
  restoreFocus: () => editor.view.focus(),
});
editor.setLightbox(lightbox);

// 栏宽拖拽手柄（M228，change content-width-drag）：DOM 在 shell（编辑器 pane 的覆盖层），
// 控制器在 src/content-width.ts；装配侧给三样东西——当前宽度的读写口（editor 闭包真源）、
// 松手后的持久化（D3：通用键值合并写命令 config_set_ui_value，写失败降级为 toast + 诊断
// 日志，运行期宽度**不回滚**——与 remember_last_vault 的「主结果不受写失败影响」同口径）。
const widthDrag = createContentWidthDrag({
  pane: shell.editor,
  overlay: shell.widthHandles.overlay,
  leftHandle: shell.widthHandles.left,
  rightHandle: shell.widthHandles.right,
  content: editor.view.contentDOM,
  scroller: editor.view.scrollDOM,
  getWidth: () => editor.contentWidth(),
  setWidth: (width) => editor.setContentWidth(width),
  onCommit(width) {
    configSetUiValue("content_width", width).catch((e: unknown) => {
      toast(WIDTH_SAVE_FAILED_TEXT(errorMessage(e)));
      logEvent("config_warning", { source: "content-width", message: errorMessage(e) });
    });
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
  widthDrag.setVisible(false); // 空态 / 覆盖层在：栏宽手柄 MUST NOT 出现（spec「空态无手柄」）
}

function showEditor() {
  notice.hidden = true;
  editor.view.dom.style.display = "";
  widthDrag.setVisible(true);
}

// 瞬时提示（锚点缺失 / 创建结果 / 解析错误）：编辑器右下角浮条，自动消隐。
// sticky 的提示（如退出被拦截）不自动消隐，点击浮条本体关闭——守卫类反馈
// 不允许在用户看到之前消失。sticky 提示按文案去重（M107）：连续触发同一守卫
//（如连按 Cmd+Q）复用既有浮条，不堆叠；自动消隐的普通 toast 不受此限。
// tone "success" 给浮条加 ✓ 前缀（定稿 direction-c 屏 5 toast），只用于「用户
// 动作已成功完成」的确认；错误 / 警告 / 纯信息保持 neutral 不带 ✓（语义口径，
// tower 裁决 2026-09-25）。
type ToastTone = "neutral" | "success";
function toast(
  text: string,
  actions: Array<{ label: string; run(): void }> = [],
  sticky = false,
  tone: ToastTone = "neutral",
): HTMLElement {
  if (sticky) {
    for (const el of shell.editor.querySelectorAll<HTMLElement>(".lumir-toast[data-sticky-text]")) {
      if (el.dataset.stickyText === text) return el;
    }
  }
  const el = document.createElement("div");
  el.className = "lumir-toast toast-surface";
  if (tone === "success") {
    const check = document.createElement("span");
    check.className = "toast-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    el.append(check);
  }
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
 *  已合并为 controller 的世代号，兼作 editor 装载（reloadSession）的 requestId。 */
const save = createSaveController({
  editor,
  container: shell.editor,
  toast,
  // intent 原样转发：装配层是唯一知道「落到哪个标签」的地方（save-controller 只在
  // 另存为新文件 / 恢复崩溃备份两条链路上指定 "current"）。
  openFile: async (path, kind, intent) => {
    await openFile(path, kind, intent);
  },
  invalidateResolve: () => linkFollow.invalidate(),
  showEditor: () => showEditor(),
  isNoticeHidden: () => notice.hidden,
});

function emitReadiness(name: string, detail: object = {}): void {
  window.dispatchEvent(new CustomEvent(`lumir:${name}`, { detail }));
}

// 轻量大纲（M148）：modeline 左段的当前位置指示段 + ⌘⇧O 浮层。能力与浮层本体在 src/toc.ts，
// 装配侧只提供四样：编辑器视图、是否有当前文件（空态不显示指示段）、当前文档的模式与 code 语言
// （M197：md 走标题大纲、code 走符号大纲，语言名从扩展名注册表取——单一来源），以及无条目时的
// 提示出口（toast：D84 与 M197 的两条新文案）。指示段与浮层都挂 modeline（M211 从旧标题区迁来），
// 浮层向上展开、不动布局。
const toc = createToc({
  view: editor.view,
  indicator: shell.modelineSection,
  mount: shell.modeline,
  hasFile: () => save.displayedPath() !== undefined,
  // 活读前台会话的模式与路径（切标签 / 切 vault 后自动跟上）：语言名只在这里派生一次，
  // toc 侧不再自己从路径推。
  context: () => {
    const session = editor.activeSession();
    return {
      mode: session.mode,
      language: session.path === undefined ? null : codeLanguage(extensionOf(session.path)),
    };
  },
  toast,
});

editor.onReady((event) => {
  emitReadiness(event.phase, event);
});

// ---------------------------------------------------------------------------
// 标签（M149）：会话模型、标签栏 DOM 与切换 / 关闭动作在 src/tabs.ts，这里只装配——
// 把本文件才知道的入口交给它（save / 解析缓存失效 / 覆盖层 / 同步点，逐项见 TabsDeps）。
// ---------------------------------------------------------------------------

const tabs = createTabs({
  editor,
  mount: shell.tabStrip,
  toast,
  saveCurrent: () => save.save(),
  invalidateResolve: () => linkFollow.invalidate(),
  showEditor: () => showEditor(),
  syncActiveDocument: () => syncActiveDocument(),
});

// ---------------------------------------------------------------------------
// 多 vault 切换器（M163，change multi-vault-workspaces 的 3.x / 4.x）：列表浮层、切换流程的
// 请求侧、按 vault 的标签会话与装载后恢复都在 src/vault-switcher.ts。这里只装配它看不到的
// 东西：树头部入口、当前 vault 的打开链路（dirty 前置门 + vault_open_path + 装载）、
// 会话的 ipc、以及恢复时逐标签打开文件的那条既有链路（openFile）。
// ---------------------------------------------------------------------------

/** 空 vault 首入态的引导（文案 D107）：装载完成而一个标签都没能恢复出来时，正文给一句
 *  指路，不伪造内容（也不残留上一次 vault 的正文——那已被 editor.reset 作废）。 */
const EMPTY_VAULT_TEXT = "这个 vault 还没有打开的文件。在左栏选一个文件开始。";

/** 守卫类粘性提示的出口：先撤下既有守卫浮条再挂新的（M163 r1 P2-1——toast 的 sticky 去重按
 *  文案命中会复用旧元素，而守卫浮条的动作带着「切到哪一个」，复用等于把后一次请求的 proceed
 *  丢掉；来由见 src/vault-switcher.ts 的 createGuardPromptPresenter）。 */
const showGuardPrompt = createGuardPromptPresenter({
  clearPrevious: () => save.clearGuardToasts(),
  // 挂上守卫提示族的标识类：dirty 清除时由 save.clearGuardToasts 整批撤下。
  toast: (text, actions, sticky) =>
    void toast(text, actions, sticky).classList.add(SAVE_GUARD_TOAST_CLASS),
});

/** 切换流程的门与闸（M163 的 4.1–4.3；状态机与三动作在 src/vault-switcher.ts，可脱离
 *  DOM 单测）。判据来自 save-controller 的 vaultSwitchBlock（M149 口径原样）。 */
const switchGate = createVaultSwitchGate({
  block: () => save.vaultSwitchBlock(),
  saveAll: () => save.saveAllDirty(),
  currentName: () => vaultName,
  notify: (text, actions) => showGuardPrompt(text, actions),
  fail: (message) => toast(message),
});

/** 「未注册目录 + 存在失效注册项」时的两出口浮条（M121/M126 既有形态；M163 r1 P1-1 起两个
 *  动作在**动作时点**也过 dirty 门——浮条 sticky、可无限期存活，期间产生的修改不许被静默
 *  丢弃；门在 vault_open_path 提交之前，见 src/vault-switcher.ts 的 createVaultRemapPrompt）。 */
const remapPrompt = createVaultRemapPrompt({
  guard: (proceed) => guardVaultSwitch(proceed),
  // 用普通 sticky 浮条（**不**挂守卫提示族的标识类）：它说的是「这个目录还没注册」，
  // 与 dirty 无关——挂上族标会让一次成功的保存把它一并撤下，用户手上那条路径确认提示就没了。
  notify: (text, actions) => void toast(text, actions, true),
  displayName: (path) => baseName(path),
  openPath: async (path) => {
    const opened = await vaultOpenPath(path, true);
    await applyVault(opened.root, opened.entries, opened.vault_id, false);
  },
  remap: async (id, path) => {
    await vaultRemap(id, path);
  },
  fail: (message) => toast(message),
});

const switcher: VaultSwitcherHandle = createVaultSwitcher({
  mount: shell.root, // 浮层挂点取 app-shell 根：左栏两个容器都 overflow:auto，挂进去会被裁掉
  entry: () => tree.vaultEntry(),
  toast,
  sessions: () => editor.sessions(),
  // 前台路径取自保存链路（它才是「前台标签是哪一个」的持有者），不在这里再存一份副本。
  activePath: () => save.displayedPath(),
  list: () => vaultList(),
  requestSwitch: (row) => guardVaultSwitch(() => switchToVault(row.path)),
  requestAdd: () => requestAddVault(),
  requestRelocate: (row, siblings) => guardVaultSwitch(() => requestRelocate(row, siblings)),
  expanded: (expanded) => tree.setVaultEntryExpanded(expanded),
  // 收起浮层后把焦点交还编辑器（M186）：这三条一起构成「交还焦点 MUST NOT 改变阅读位置」。
  // 滚动位置只存在于 scrollDOM、不属于 CM state。把焦点放进编辑器是**浏览器**接管的视口动作
  //（聚焦时保证光标可见），本应用左右不了它何时发生——用户「滚着读」时光标停在别处，那一刻就
  // 可能把整篇正文拽回光标处（表现为跳回篇首）。这里不预测它，只在前后把位置守住：先取快照、
  // 聚焦之后再写回。取 / 写都走 CM 自己的滚动快照通道（与切标签恢复滚动位置同一份实现）：
  // 直接写 scrollDOM.scrollTop 会被滚动锚点维护改掉（M149 实测差 242px）。
  readingPosition: () => editor.view.scrollSnapshot(),
  restoreReadingPosition: (snapshot) => editor.view.dispatch({ effects: snapshot }),
  focusEditor: () => editor.view.focus(),
  getSession: (vaultId) => vaultSessionGet(vaultId),
  putSession: (vaultId, paths, active) => vaultSessionPut(vaultId, paths, active),
  // 恢复用**固定标签**意图逐个打开（预览意图会让第二个起顶掉前一个，只剩最后一个），
  // 且不上屏失败覆盖层：恢复是批量动作，单个文件的失败由计数提示承担（见 vault-switcher）。
  openPinned: (path) => openFile(path, openKind(path), "pinned", true),
  activate: (path) => {
    const session = editor.sessionForPath(path);
    if (session !== undefined) tabs.activateTab(session);
  },
  onEmptyVault: () => showNotice(EMPTY_VAULT_TEXT),
  warn: (text) => toast(text),
});

// ---------------------------------------------------------------------------
// 文档阅读位置（M194，change remember-reading-position 的 3.x / 4.x）：跨会话记住阅读位置的
// 捕获侧与恢复侧。判定、防抖、清理与上限都在 src/reading-position.ts（无 DOM、可单测），这里
// 只装配它看不到的东西：编辑器的两个口子、ipc、以及三个 flush 时点。
// ---------------------------------------------------------------------------

/** 阅读位置的存储。`activePath` 与标签会话取同一份（前台标签是哪一个），不再各自存副本。 */
const readingPositions = createReadingPositionStore({
  activePath: () => save.displayedPath(),
  readPosition: () => editor.readScrollPosition(),
  applyPosition: (position) => editor.applyScrollPosition(position),
  getPositions: (vaultId) => readingPositionGet(vaultId),
  putPositions: (vaultId, entries) => readingPositionPut(vaultId, entries),
  warn: (text) => toast(text),
});

// 捕获侧的信号源：滚动容器一滚就通知（同步派发，防抖在 store 里）。订阅一次、挂全局——全应用
// 只有一个 EditorView，「前台文档是谁」由 activePath 活读，不随标签切换重新挂监听。
editor.onScroll(() => readingPositions.scrolled());

/** 前台会话变化后把周边表现层**一次**对齐：正文基准路径、modeline（路径 + 右段派生信息）、
 *  后端 dirty 镜像、大纲指示段、文件树高亮、标签栏。这是「当前文档」在装配层的唯一同步点——
 *  别处的读点一律改为问 editor.activeSession()，不再各自存副本。 */
function syncActiveDocument(): void {
  const session = editor.activeSession();
  // resolve 的 from 基准不在这里同步：它由 link-follow.ts 的 resolveBase() 活读前台会话
  //（见那边的注释，那份副本曾在装载时序上造成一整批 wikilink 停在 pending）。
  syncDirtyIndicator();
  syncModelineMeta();
  syncBackendDirty();
  // 指示段与文档同一帧到位（不落在 120ms 节流窗口之后）：见 TocHandle.refresh 的说明。
  toc.refresh();
  tree.setCurrentPath(session.path);
  // 会话切换后栏宽手柄重新贴合列缘（模式 / gutter 进出只改列位置不改列宽，控制器自己的
  // ResizeObserver 看不见位置变化）。
  widthDrag.reposition();
  tabs.renderTabs();
  // 标签集合 / 顺序 / 激活项变化后防抖落盘会话（M163）。挂在这个唯一同步点上：切标签、
  // 开文件、关标签都会经过它，别处不必各埋一个「记得写会话」的钩子。
  switcher.sessionChanged();
  // 阅读位置与标签会话同一批 flush（M194，task 3.4）：这是「切文件 / 切标签」在装配层的唯一
  // 同步点，滚动停止后的防抖是主路径、这里是补漏——MUST NOT 只依赖定时器（切走之后没有第二次
  // 机会），也 MUST NOT 只依赖退出路径（那条路径的 invoke 是异步的，可能赶不上界面拆除）。
  void readingPositions.flush();
}

/** 装载完成后的表现层对齐（打开 / 重载共用）。
 *  解析缓存失效不在这里：它必须发生在装载**之前**（openFile 里 reloadSession 的前一句），
 *  否则会抹掉装载事务里刚发起的在途 resolve，mtime 到达后的重建会重复查询（M227）。 */
function afterLoad(): void {
  showEditor();
  syncActiveDocument();
}

// 打开文件：读出文本交给内核装载——模式裁决（以扩展名注册表为唯一事实源：
// .md/.markdown → md 模式；其余已打开的文件一律只读 code，含未知扩展与 basename
// 无点的文件，M130 方向 A）和附件相对路径解析依赖的 currentFilePath 都在内核里完成
//（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
//
// 落点由 intent 决定（M149，Alex 已裁决）：
//   - 文档内链接跟随 / 另存为新文件 / 恢复备份 → "current"（**默认值**）：当前标签跟随
//     换文档——这是 M144/M145 既有语义，也是「不传就退化成 M149 之前的行为」这个保守兜底；
//   - 单击文件树 → "preview"：复用预览标签，旧预览被就地替换，不新开；
//   - 双击 / ⌘-点击文件树 → "pinned"：新开固定标签。
//
// 返回「这次打开是否成功」——只有 M163 的会话恢复读它（逐个打开、失败的计入跳过数）。
// `quiet` 为真时**不上屏失败覆盖层**：恢复是逐标签的批量动作，单个文件的失败不该把正文
// 换成错误提示（spec：跳过并给一次计数提示）；其余调用方沿用既有表现，不看返回值。
async function openFile(
  path: string,
  kind: "md" | "code" | "text" | "binary",
  intent: "preview" | "pinned" | "current" = "current",
  quiet = false,
): Promise<boolean> {
  // 唯一保留的 dirty 守卫：前台是**未命名文档**（没有路径）。它的内容没有落盘基准，
  // 就地替换等于丢弃草稿，另开标签又会让草稿失去落点——沿用 M130 的守卫与文案。
  // 有文件路径的标签之间是标签切换，不丢内容，因此不设守卫（M149 的语义变化，
  // 见 openspec change add-multi-tabs 的 proposal「语义变化」一节）。
  if (editor.activeSession().path === undefined && !save.guard("切换文件")) return false;
  // 已经打开的文件一律切到既有标签：不重复开、也不重读（非 md 只读，重读只会把用户
  // 正在看的位置顶掉）。三种意图都适用；双击 / ⌘-点击一个已打开的**预览**标签 = 把它
  // 固定住——这正是「双击 = 固定」的落点（第一次单击已把它开成预览，这边收尾）。
  //
  // 这一条必须放在 showNotice 与 beginSwitch 之前：切换是同步的，既不需要「正在打开」
  // 这一步，提前 return 也绝不会把「正在打开 / 暂不支持预览」覆盖层留在编辑器上
  //（M149 实测缺陷：留下过一次，`.editor-notice` 从此盖住整块正文且不再撤下，表现为
  //  此后所有点击都被它 intercept——视觉场景 wikilink.spec.ts 就是这样红的）。
  const existing = editor.sessionForPath(path);
  if (existing !== undefined) {
    if (intent === "pinned") existing.preview = false;
    showEditor(); // 撤下一次更早的、已被这次同步切换取代的「正在打开」覆盖层
    tabs.activateTab(existing);
    return true;
  }
  const request = save.beginSwitch();
  if (kind === "binary") {
    if (!quiet) showNotice(`暂不支持预览：${path}`);
    return false;
  }
  showNotice(`正在打开：${path}`);
  try {
    const snapshot = await fsReadSnapshot(path);
    if (!save.isCurrent(request)) return false;
    // 守卫复查：请求在途期间前台可能已经换过（并发打开 / 用户切走）。
    if (editor.activeSession().path === undefined && !save.guard("切换文件")) return false;
    // 只有 md 进保存链路（登记磁盘 revision）；非 md 以只读 code 模式打开，不存在
    // dirty，也不该被任何保存入口接受（M130）。
    save.noteOpened(path, kind === "md" ? snapshot.revision : undefined);
    const session = tabs.targetSessionFor(intent);
    tabs.activateTab(session); // 已在同一会话上时是 no-op
    // 解析缓存整批失效必须在装载**之前**（save-controller.ts 外部重载路径的同序写法）：
    // 装饰层在 reloadSession 的装载事务里首次构建并发起 link_graph_resolve（在途），
    // 装完再清会把在途标记一并抹掉——随后 mtime 到达触发的 previewRefresh 重建时，
    // 同名链接因 pending 已空、缓存已清而重复查询（M227 实证：同一 wikilink 一次打开
    // 打两次后端）。内容真变更的语义不变：每次装载仍然整批失效，只是次序先于首次构建。
    linkFollow.invalidate(); // 内容已换，按 from 键控的解析缓存整批失效
    // 装载走事务派生（editor.reloadSession）而不是新建 state：同一标签内换文件时
    // 搜索面板的查询与开合状态因此保留（M139 以来的既有行为）。
    editor.reloadSession(session, snapshot.content, path, request);
    // 阅读位置恢复（M194）：**必须在装载复位之后**（reloadSession 内部的 `scrollTop = 0` 是
    // 既有的、有现场依据的复位，顺序与写法都不动），也必须在文档已经进入 view 之后——后台会话
    // 分支只换代 state，那里不恢复（design §5）。
    //
    // 挂点在这一条分支里（而不是在 openFile 之上）就是「已打开的标签不被盘上的位置拽走」这条
    // 判据的实现方式：同一个文件已经在某个标签里打开时，上面那个 short-circuit 直接 return，
    // 根本走不到这里。store 还会再核一次「它仍是前台文档」（装载是异步的，期间用户可能切走）。
    readingPositions.restoreFor(path);
    afterLoad();
    return true;
  } catch (e) {
    if (!save.isCurrent(request)) return false;
    if (!quiet) showNotice(errorMessage(e));
    return false;
  }
}

window.addEventListener("beforeunload", (event) => {
  // 退出前把标签会话 flush 掉（M163，MUST NOT 只依赖防抖定时器——正常退出与「放弃修改并
  // 退出」都走这条路）。尽力而为：invoke 是异步的，webview 拆除可能早于它完成；这是这条
  // 需求在现有钩子里能拿到的最好时点（没有「窗口即将关闭」的 await 通道）。
  void switcher.flush();
  // 阅读位置与标签会话同一批 flush（M194）。同样尽力而为：防抖写入是主路径，这里是补漏。
  void readingPositions.flush();
  // 判据是「任一标签有未保存修改」：多标签下只看前台文档会让后台标签的修改被静默丢弃。
  if (!editor.sessions().some((session) => session.dirty)) return;
  event.preventDefault();
  event.returnValue = "当前 Markdown 有未保存修改";
});

// ---------------------------------------------------------------------------
// wikilink 与 Markdown 链接（M144 起外链，M145 扩到全形态）：解析缓存、跟随、一键创建在
// src/link-follow.ts，这里只装配——编辑器句柄、打开文档的落点（openFile）、提示出口。
// 解析缓存的失效入口由 linkFollow 暴露（invalidate / resetForVault），装配层不持副本。
// ---------------------------------------------------------------------------

const linkFollow = createLinkFollow({
  editor,
  // intent 不传：链接跟随一律就地替换前台标签（openFile 的默认值 "current"）。
  openFile: async (path, kind) => {
    await openFile(path, kind);
  },
  toast,
});

// ---------------------------------------------------------------------------
// 主题（M237，change live-theme-switch）：运行期切换的单一施加点与循环命令。
//
// 真源分层（design §3.1）：`config.json` 的 `[ui] theme` = **启动真源**，`<html data-theme>` =
// **运行期唯一生效面**。不引入第三处「当前主题」状态——modeline 钮的文案由 applyTheme 唯一
// 写入，循环命令读的也是 data-theme（`src/theme.ts` 的 currentTheme）。主题的循环序与两条
// 可见文案同在 src/theme.ts（纯逻辑，单测在那层跑），本文件只管施加与接线。
//
// applyTheme 是**唯一施加点**：启动装配（本文件末尾 configGet 块的最后一条）与运行期切换都经
// 它，MUST NOT 出现第二处 `data-theme` 写入者（REVIEW.md 第 8 条）。
// ---------------------------------------------------------------------------

/** 施加主题：写 `<html data-theme>`（token 层三组块按它取色，chrome / CM 主题 / 两路语法高亮 /
 *  KaTeX 全部经 CSS 变量即时跟随，零重测量——字体与字号不随主题变）+ 刷新 modeline 指示钮。
 *  `theme` 取 Rust 侧 `UiTheme` 闭集合，前端不判非法值（合法性已由 Rust validate 保证，再判一次
 *  就是同一条语义的第二处真源）。 */
function applyTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  shell.modelineTheme.textContent = theme;
  const label = THEME_INDICATOR_LABEL(theme);
  shell.modelineTheme.title = label;
  shell.modelineTheme.setAttribute("aria-label", label);
  shell.modelineTheme.hidden = false;
}

/** 循环切换到下一档（命令 `view.theme-cycle` 与 modeline 主题钮的**同一条实现路径**，
 *  design §3.4：不调命令分发器，两处直接调它）。顺序是有意的：
 *    ① 施加新主题（写 data-theme，全部 CSS 变量着色面同步完成）；
 *    ② mermaid 按新主题失效（initialize 态 + 缓存 + 世代号）；
 *    ③ 派发 previewRefresh 让装饰重建——重建时 mermaid 缓存未命中，各块回落既有 pending
 *       占位并串行重渲，settle 后再次 previewRefresh。①②③ 的相对次序 MUST NOT 调换：
 *       失效必须发生在重建之前，否则重建会命中刚清空前的旧缓存。
 *    ④ 写回配置（不等结果）。
 *
 *  写回降级口径照栏宽拖拽（D3 裁决 + M228 的通用合并写 IPC）：applyTheme 已生效，写失败只是
 *  不持久——运行期主题**不回滚**，toast 告知重启后回到配置文件里的主题，另记一条诊断日志。 */
function cycleTheme(): void {
  const next = nextTheme(currentTheme(document.documentElement));
  applyTheme(next);
  invalidateMermaidTheme();
  editor.refreshPreview();
  configSetUiValue("theme", next).catch((e: unknown) => {
    toast(THEME_SAVE_FAILED_TEXT(errorMessage(e)));
    // 诊断出口复用既有的 config_warning（用 source 区分成因）——不为一条失败新造事件名，
    // 事件名与字段白名单的单一来源是 src-tauri/src/logging.rs。
    logEvent("config_warning", { source: "theme", message: errorMessage(e) });
  });
}

// modeline 主题钮的点击 = 同一条实现路径（click 事件本身不需要被消费，语义全在 cycleTheme 里）。
shell.modelineTheme.addEventListener("click", cycleTheme);

// ---------------------------------------------------------------------------
// 统一键位层（M131）：唯一分发表在 keys.ts，装配在这里——编辑器侧命令由 editor 提供，
// 装配侧命令（保存）在下面就地实现，链接跟随与标签那几条转各自模块的句柄（M151）。
// 原先散落的四条旁路（keys.ts 的 window trie、editor 的 CM keymap 与 domEventHandlers、
// 此处的裸 window 监听）已全部迁入；剩下的只有这一处 attach。
// ---------------------------------------------------------------------------
const commands: CommandRuntime = {
  ...editor.commands,
  "document.save": () => {
    void save.save();
  },
  // 轨道 A 原样迁入（键位与作用域不变）；M144 起跟随光标/选区处的链接——外链交系统
  // 浏览器、wikilink 走既有跳转链路；M145 补齐其余形态：相对路径 md 走应用内跳转、
  // vault 内非 md 交系统默认应用、纯锚点只提示。落在非链接处无操作（不假装有反馈）。
  "link.follow": () => linkFollow.followAt(editor.view.state.selection.main.head),
  // 键位查看面板（M133）：列出**生效中**的键位表（含 [keys] 覆盖的产物）。
  "app.describe-bindings": () => bindingsPanel.toggle(),
  // 文件内搜索（M139）：能力与 panel 在 src/search.ts，此处只把编辑器视图交过去。
  // 作用域 global——焦点在文件树 / 搜索框里时同样要能开（⌘F 的 mac 惯例，理由见 keys.ts）。
  "app.search-open": () => openSearch(editor.view),
  // 轻量大纲（M148）：开→关 / 关→开，无标题文档只给提示（不弹空浮层）。
  "toc.toggle": () => toc.toggle(),
  // vault 切换器（M163）：开→关 / 关→开；未装载 vault 时无操作（那时没有列表入口）。
  "vault.switcher": () => switcher.toggle(),
  // 折行开关（M180，change line-wrap-options 的 D1/D3 裁决）：翻转的是**应用运行期**的折行
  // 口径——全部会话（含当时不在前台的标签页）随即同步，新标签页取当前应用态；不写文档、
  // 不进撤销栈、不碰 dirty、不落盘（config.json 的内容与 mtime 逐字节不变）。
  // 两条都默认不绑键（登记在 keys.ts 的 KEYLESS_COMMAND_IDS），由 [keys] 绑定后可用；
  // 作用域 global，故 id 前缀取 `view.` 而不是 `editor.`（前缀与作用域不得互相打脸）。
  "view.toggle-line-wrap": () => editor.toggleLineWrap(),
  "view.toggle-code-block-wrap": () => editor.toggleCodeBlockWrap(),
  // 字号步进（M195，change typography-and-zoom）：改的是**编辑器内容字号**（Emacs 的
  // text-scale-adjust 的对应物），不是整体界面缩放——MUST NOT 启用 Tauri 的 webview 缩放
  // 热键（它会在统一键位表之外再注册一条 keydown 通路、接管同一批键，见 keymap-commands 的
  // delta）。能力（运行期真源 + 施加）在 editor 侧：一份值管全部会话、不落盘、不回写
  // config.json、不进撤销栈、不碰 dirty；⌘0 回到**配置字号**而不是出厂默认值（15px，D1 裁决）。
  "view.text-scale-up": () => editor.textScale("up"),
  "view.text-scale-down": () => editor.textScale("down"),
  "view.text-scale-reset": () => editor.textScale("reset"),
  // 主题循环切换（M237，change live-theme-switch 的 D1/D2 裁决）：light → dark → eink 循环，
  // 命令实现就是上面的 cycleTheme（与 modeline 主题钮共用同一条路径，见那段注释）。
  // 默认键位 ⌘⇧T 在 keys.ts 的 KEY_BINDINGS 里（冲突核实与 token 形态见那一条的 doc）。
  "view.theme-cycle": () => cycleTheme(),
  // 标签（M149）：能力与切换在 editor 的会话 API，装配层只做两件它才知道的事——
  // 切换后的表现层对齐（tabs.activateTab → syncActiveDocument）与关标签的确认（都在 src/tabs.ts）。
  // `tab.close` 关的是**前台**标签；逐标签关闭钮走同一条 closeTab（同一个确认）。
  "tab.close": () => {
    void tabs.closeTab(editor.activeSession());
  },
  "tab.next": () => tabs.cycleTab(1),
  "tab.prev": () => tabs.cycleTab(-1),
  ...tabs.gotoCommands(),
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
 *  没有 UI 出口，本 change 不新增 UI 面），并另经 log_event 落一份诊断日志——
 *  dogfood 期排查「键位没生效」时 agent 能直接读事件，不必让人回忆 console 输出。 */
function applyKeyConfig(overrides: KeyOverrides | undefined): void {
  const { bindings, warnings } = applyKeyOverrides(overrides ?? {});
  for (const warning of warnings) {
    console.warn(`lumir: ${warning}`);
    logEvent("config_warning", { source: "keys", message: warning });
  }
  effectiveBindings = bindings; // 面板渲染这份产物，不自己重新合并一遍默认表
  if (Object.keys(overrides ?? {}).length === 0) return; // 无覆盖：默认表已在分发
  detachKeymap();
  detachKeymap = new Keymap(bindings).attach(window, commands, keymapContext);
}

// ---------------------------------------------------------------------------
// 键位查看面板（M133，app.describe-bindings）：面板本体在 src/bindings-panel.ts——分组表、
// 关闭键、渲染与交互都在那边，这里只装配三样它看不到的东西：挂点、生效表的读取口、关闭
// 后把焦点交还编辑器。
// ---------------------------------------------------------------------------

/** 生效中的键位表：默认表，或默认表经 [keys] 覆盖后的产物（applyKeyConfig 写入）。
 *  bindings-panel 渲染这份产物，不自己重新合并一遍默认表。 */
let effectiveBindings: readonly KeyBinding[] = KEY_BINDINGS;

const bindingsPanel = createBindingsPanel({
  mount: shell.root,
  bindings: () => effectiveBindings,
  restoreFocus: () => editor.view.focus(),
});

// 原生 Edit 菜单的撤销 / 重做项与 File/Window 的关闭项（lib.rs 的自定义项，都不带
// accelerator）点击后经此事件回到前端——菜单与键盘走同一个命令层，不产生第二套实现。
// 取值口径见 lib.rs MENU_COMMAND_EVENT：菜单只说 undo / redo / close 这类平台术语，
// 映射到命令 id 是前端的事。关闭项映射到 `tab.close`（M149：⌘W 归标签，菜单里的关闭项
// 因此也关标签而不是关窗，两者的语义必须一致）。
// M132：该通道从装配层直连 listen 收进 ipc.ts 的 onMenuCommand（同类事件走同一模块，
// M131 已把它记为待收编项）；ipc.ts 的这一族因此覆盖 invoke 与 listen 两条通道。
const MENU_COMMANDS: Record<string, CommandRunner | undefined> = {
  undo: commands["editor.undo"],
  redo: commands["editor.redo"],
  close: commands["tab.close"],
};
onMenuCommand((payload) => {
  MENU_COMMANDS[payload]?.();
}).catch(() => {}); // 无 Tauri 后端（纯浏览器预览）时静默忽略

// dirty 状态反馈（M101 验收修复 + M149 按标签）：toast 会消隐，dirty 期间 modeline 的
// 路径段旁常驻「未保存」标记。M149 起这个后缀描述的是**前台标签**那一个文档；逐标签的
// 状态由标签栏自己的 dirty 点承担（见 src/tabs.ts 的 renderTabs），两者同源同义。
function syncDirtyIndicator(): void {
  const session = editor.activeSession();
  const path = session.path;
  // 定稿口径（index.html:1225）：路径段分隔符写作「 / 」（带空格）。session.path 是
  // vault 相对路径（不含前导 /），直接全量替换即可。
  const display = path === undefined ? "无当前文件" : path.replaceAll("/", " / ");
  shell.modelinePath.textContent = session.dirty && path !== undefined ? `${display}（未保存）` : display;
}

/** modeline 右段（`语法 · 行数 · UTF-8`）——design §4-2 的实现期结论，口径「**只读派生、
 *  零新状态**」：
 *
 *  - 行数取 `view.state.doc.lines`。它是 CM 的 Text rope 上**构造期算好的缓存字段**
 *    （`TextNode` 在构造时累加子节点的 lines、`TextLeaf` 恒为 1，见 @codemirror/state 的
 *    Text 实现），读它是 O(1)，**不引入全文档遍历**——ADR 0002 §6 对键入路径的约束因此
 *    不被这条新展示位破坏。
 *  - 语法名从扩展名注册表取（`codeLanguage`，与文件树 / 大纲同一份注册表，不另立映射表）：
 *    md 模式不是注册表条目，固定写 "Markdown"；code 模式无语言线索（php / 未知扩展 /
 *    无扩展）时报 "Plain text"。
 *  - 编码恒为 "UTF-8"：读取链路的契约就是 Rust `String`（fs_read_snapshot 的
 *    `content: String`），前端拿不到也造不出别的编码——它不是「检测结果」，是契约事实。
 *
 *  只在**值真的变化**时写 DOM（每次键入都会走这条路径，条件写避免无谓的布局失效）。 */
function syncModelineMeta(): void {
  const session = editor.activeSession();
  const lines = editor.view.state.doc.lines;
  const language = session.mode === "md"
    ? "Markdown"
    : codeLanguage(extensionOf(session.path ?? "")) ?? "Plain text";
  const text = `${language} · ${lines} 行 · UTF-8`;
  if (shell.modelineMeta.textContent !== text) shell.modelineMeta.textContent = text;
}

/** 已推给后端的 dirty 镜像值（M149）：只在**变化**时上报。
 *
 *  标签切换会频繁调用 syncActiveDocument → syncBackendDirty，每切换一次就 invoke 一遍
 *  是白费（后端是覆盖式写入，同一个值重复推没有语义），而且会破坏 M107 的「启动只推一次
 *  复位镜像」这条既有断言（它的意图正是「别在上报通道上乱喷」）。undefined = 还没推过，
 *  启动时必然推一次。 */
let pushedDirty: boolean | undefined;

/** 后端退出守卫（Cmd+Q / 关窗拦截）的 dirty 镜像：判据是「**任一**标签有未保存修改」。
 *  旧实现只有一个文档，取单个 dirty 即可；多标签下必须取并集，否则后台标签里的修改在
 *  退出时会被静默放行。无 Tauri 后端（纯浏览器预览）时同步失败无害，静默忽略。 */
function syncBackendDirty(): void {
  const any = editor.sessions().some((session) => session.dirty);
  if (any === pushedDirty) return;
  pushedDirty = any;
  documentSetDirty(any).catch(() => {});
}

editor.onDirty((dirty) => {
  // 内核在前台会话内容变化、或任何会话被标记为与磁盘同步时回调（见 editor.ts 的
  // updateDirty / setSessionDirty）。两种情形都要重画标签栏：dirty 点是逐标签的。
  syncDirtyIndicator();
  tabs.renderTabs();
  // 保存成功（dirty→false）后所有 dirty 表现层必须一致清除：modeline 的标记、
  // 后端退出守卫镜像，以及 dirty 期间弹出的守卫提示。sticky 提示按设计不自动
  // 消隐，不主动撤下会让「未保存」在保存成功后残留在右下角（桌面验收缺陷）。
  if (!dirty) save.clearGuardToasts();
  syncBackendDirty();
});

// modeline 的行数随文档变化（每次键入都可能改行数）。走内核已有的 onDocChanged
// （它已在用一个：预览标签「首次输入即固定」），不新开一条监听通道——行数是
// rope 上的缓存字段，读一次 + 条件写 DOM 的代价不构成新的键入路径负担。
editor.onDocChanged(() => syncModelineMeta());

// 预览标签「首次输入即固定」（M149，Alex 口径）：编辑动作落在预览标签上就说明用户
// 打算留着它，此后单击文件树不再顶掉它。
//
// 判据是「docChanged 且 dirty」而不是单看 docChanged：**装载也走 docChanged**（打开文件 /
// 外部重载 / 恢复备份都是整篇替换），而装载不是「开始编辑」。装载后 cleanDoc 已与内容对齐、
// dirty 为 false，据此把两者分开——不必让内核再为此加一个来源参数。
editor.onDocChanged(() => {
  const session = editor.activeSession();
  if (!session.dirty || !session.preview) return;
  session.preview = false;
  tabs.renderTabs();
  // 提升即「可持久化集合」多了一个成员（预览标签不入盘，spec「按 vault 持久化标签列表」），
  // 属一次**集合变化**，必须沿同一条防抖写盘——否则崩溃窗口里这个提升会丢（M163 r1 P2-2）。
  // 这里不经 syncActiveDocument（那会连 modeline / 大纲 / 树高亮一起重算，而这一步只改了
  // 一个会话的属性），直接调会话侧的通知口。
  switcher.sessionChanged();
});

// DirtyState 防滞留（M107）：后端的 dirty 镜像在 webview 重载（开发者刷新 /
// 崩溃重载）后可能滞留 stale true，退出守卫将永久拦截。前端是唯一事实源，
// 初始化后主动推送一次当前值复位镜像（启动时必为 false）；重载后用户再次
// 编辑仍走 onDirty 正常同步。无 Tauri 后端时失败无害，静默忽略。
syncBackendDirty();

// 退出/关窗被 dirty 守卫拦截时必须可见（M101）：后端 prevent_exit/prevent_close
// 本身无任何界面表现，前端收到事件要给出可理解的提示。sticky：拦截提示不得
// 在用户看到前自动消隐（守卫反馈要持续可见，点击浮条关闭）。
onQuitBlocked(() => save.showQuitBlocked()).catch(() => {});
let tree!: ReturnType<typeof createFileTree>;

// ---------------------------------------------------------------------------
// vault 切换 / 新增 / 重新定位（M163 的 4.1–4.3、4.7、4.8；能力面在 src/vault-switcher.ts）
//
// 三条通道各自的第一步都是同一道 dirty 前置门（guardVaultSwitch）：判据原样来自
// save-controller 的 vaultSwitchBlock（M149：任一**有路径**的标签 dirty），提示与三条出口
// 摆在拦下它的地方。装载本身只有一处实现（applyVault），本文件不出现第二条装载通道。
// ---------------------------------------------------------------------------

/** 切换 vault 的 dirty 前置门（本文件唯一的入口封装，供三条通道与 loadVault 的最后防线
 *  共用）：把「继续」这一步交给 src/vault-switcher.ts 的门与闸。`proceed` = 继续切换
 *  （打开目标并装载）；拦下时返回 false 并已给出三条出口：
 *    - 保存并切换：先保存全部脏标签，保存未闭环（冲突 / 写失败 / 无落盘基准）就**不**继续
 *      （spec「保存未闭环则不切换」）；不可保存的脏标签不给这条动作（走不通的建议不给）；
 *    - 放弃修改并切换：直接继续（守卫本身不产生副作用，内容随后随 vault 复位一起作废）；
 *    - 取消：什么都不做。
 *
 *  「新增」在**弹目录选择器之前**过这道门是有意的：选择器一返回，后端就已经把选中的目录当成
 *  当前 vault 提交了（vault_open 内部 reconcile + commit），那时再拦会留下「后端在新 vault、
 *  前端还显示旧的」的不一致态——此后相对路径的保存会落到错误的 vault 上。先拦后选，取消
 *  选择器就真的什么都没发生。 */
function guardVaultSwitch(proceed: () => Promise<void> | void): boolean {
  return switchGate.request(proceed);
}

/** 打开目标 vault 并装载（切换 / 重定位共用）：打开失败就抛出去，由门与闸统一给一条失败
 *  提示（目标打开失败保留当前上下文，MUST NOT 把文件树抹成空态）。 */
async function switchToVault(path: string): Promise<void> {
  const info = await vaultOpenPath(path, false);
  await applyVault(info.root, info.entries, info.vault_id, false);
}

/** 新增 vault（浮层底部的唯一新增入口）：先过 dirty 前置门，再走既有目录选择器链路。
 *  取消选择器不改变任何上下文；命中 remap 门时沿用既有两出口浮条，不因列表而绕过。 */
function requestAddVault(): void {
  guardVaultSwitch(() => void pickVault());
}

/** 失效行「重新定位…」（spec「失效 vault 的处置」）：把该稳定 id 绑到用户新选的目录
 *  （vault_remap），成功后打开它（等价于一次切换）。
 *
 *  选择目录只能走 vault_open——后端没有「只选目录不开 vault」的命令。这里传 force_new=false
 *  是有意的：命中 remap 门（未注册路径 + 存在失效注册项）时后端**不提交、不注册**，这正是
 *  「只取路径、不动上下文」需要的语义。门没短路就说明后端已经把选中的目录当成 vault 提交
 *  了（该路径已注册，或它没有可映射的失效项），两种情形都拒绝：
 *    - 路径属于**另一个**注册项：稳定 id 是重映射的锚点，把两个身份静默并到同一路径会让
 *      列表出现两行同路径、后续按路径查找不再确定；
 *    - 没有可映射项（该注册项已归档等）：无从绑定，也不能让它变成一个「新增 vault」。
 *  两种拒绝都先把后端恢复到当前 vault：前端从头到尾没换过上下文，后端也不该停在一个前端
 *  不知道的 vault 上（相对路径的保存会落到错误的 vault）。 */
async function requestRelocate(
  row: VaultListEntry,
  siblings: readonly VaultListEntry[],
): Promise<void> {
  let picked: VaultInfo | null;
  try {
    picked = await vaultOpen(false);
  } catch (e) {
    toast(errorMessage(e));
    return;
  }
  if (picked === null) return; // 取消：上下文不变
  const occupied = siblings.find(
    (item) => item.id !== row.id && samePath(item.path, picked.root),
  );
  if (picked.remap_candidates.length === 0 || occupied !== undefined) {
    if (loadedRoot !== undefined) await vaultOpenPath(loadedRoot, true).catch(() => {});
    toast(
      occupied !== undefined
        ? `这个目录已经是「${occupied.name}」的路径，不能用来重新定位`
        : `这个目录没法用来重新定位「${row.name}」；请选择该 vault 现在所在的目录`,
    );
    return;
  }
  try {
    await vaultRemap(row.id, picked.root);
  } catch (e) {
    toast(errorMessage(e));
    return;
  }
  await switchToVault(picked.root);
}

// 目录选择器入口（空态按钮与浮层底部的「新增 vault…」共用）。命中重映射候选时
//（spec：未注册路径 + 失效注册需显式确认）open_vault 按契约返回空 entries，
// 此时不得装载——否则用户看到 vault 名已换、树全空的死态（桌面验收缺陷）；
// 改为 sticky 提示给出两个出口（两个动作在**动作时点**过 dirty 门，见 remapPrompt）。
function pickVault(forceNew = false): void {
  vaultOpen(forceNew)
    .then((info) => {
      // null = 用户在目录选择器取消，无错误状态（spec）
      if (!info) return;
      if (info.remap_candidates.length > 0) {
        remapPrompt.present(info);
        return;
      }
      // 非 remap 成功路径：选择器返回后的微任务里立刻装载，中间没有用户输入窗口（dirty 门
      // 已在弹选择器之前跑过），不需要在这里再拦一次。
      void applyVault(info.root, info.entries, info.vault_id, false);
    })
    .catch((e) => {
      // 已有 vault 时打开失败（如改选了一个不可读目录）不得把既有树抹成
      // 空态——空态只属于"尚无 vault"的启动路径；此处仅浮条提示。
      if (vaultLoaded) toast(errorMessage(e));
      else tree.showEmpty(errorMessage(e));
    });
}

tree = createFileTree(shell.treeMount, {
  // 打开意图由树判定（它是唯一看得到点击事件的地方）：单击 = 复用预览标签，
  // 双击 / ⌘-点击 = 新固定标签（M149 语义，Alex 已裁决）。
  onOpenFile: (path, kind, intent) => void openFile(path, kind, intent),
  // 空态按钮（未装载 vault 时唯一入口）与浮层底部的「新增 vault…」同一条链路。
  onOpenVault: () => requestAddVault(),
  // 树头部的常驻入口（形态 A）：展开 / 收起列表浮层。
  onOpenVaultSwitcher: () => switcher.toggle(),
});

/** 装载 vault 的最后防线版（空态打开 / 启动恢复）：dirty 时拦下并就地给出三条出口，出口
 *  执行时经同一个 proceed 继续装载——守卫不清除 dirty，那三条出口必须能把它带过去（否则
 *  用户选了「放弃修改并切换」还会再被拦一次，等于把他的决定无声作废）。 */
function loadVault(root: string, entries: FsEntry[], vaultId = root, restored = false): void {
  guardVaultSwitch(() => applyVault(root, entries, vaultId, restored));
}

/** 装载的唯一实现（切换 / 新增 / 重新定位 / 空态打开 / 启动恢复共用）：先换附件索引再装
 *  文件树，换 vault 前全量复位旧上下文（reviewer-switcher high finding）——否则旧文件的
 *  currentPath 会被当作新 vault 的 resolve/create from 基准，wikilink 一键创建会把文件误建
 *  到新 vault 的同名相对路径下。 */
async function applyVault(
  root: string,
  entries: FsEntry[],
  vaultId: string,
  restored: boolean,
): Promise<void> {
  // 切换前 flush 当前 vault 的会话（MUST NOT 只依赖防抖：切走之后再没有「当前 vault」这个
  // 上下文，写不成了）。启动路径上还没有当前 vault，flushSession 直接返回。阅读位置同一批
  // flush（M194）：键还是旧 vault 的 id，来得及写走。
  await switcher.flush();
  await readingPositions.flush();
  // 装载后读一次该 vault 的阅读位置并建内存镜像（M194，task 3.2）：这是「读一次、此后每次打开
  // 文档只查表」的那一次读。**位置放在树可用之前**：树一出现用户就可能点开文件，而装载路径上
  // 的恢复要查这份镜像（放在后面会留一个「镜像还没到」的窗口，视觉场景实测到过——初值在盘上
  // 的第一份文档点开时恢复不发生）。清理也搭在下面这一次既有的枚举上，零新增 IO。
  await readingPositions.onVaultLoaded(vaultId, entries);
  vaultLoaded = true;
  loadedRoot = root;
  const name = baseName(root);
  vaultName = name;
  // `lumir:vault-ready` = **前端装载完成**（面向就绪管线/测试，全仓无消费者），与后端
  // `vault:restore_finished`（面向启动状态机：后端恢复任务结束，前端据此再拉一次状态）
  // 分工不同——两个名字太像，这里是唯一的区分点，改名/改语义前先读 design §6.2。
  emitReadiness("vault-ready", { root, vaultId, restored });
  save.noteVaultReset();
  attachmentPaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  // 链接索引已在后端随 vault 打开建立；换世代使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效（两件事在 link-follow 里成对）。
  linkFollow.resetForVault();
  // 全部标签作废：内核只留一个未命名空文档（内部 currentFilePath 一并置空）。
  editor.reset();
  editor.setWikilinkResolver(linkFollow.resolver);
  // vault 名的展示位只有一处：侧栏头的切换器入口（tree.setVault 内部按同一个 baseName
  // 渲染），本文件不再往另一个元素上写一份副本。
  tree.setVault(root, entries);
  // 表现层一次对齐：modeline 路径回「无当前文件」、标签栏隐藏（空态）、树高亮清空、
  // 大纲指示段收起、后端 dirty 镜像复位。放在 setVault 之后：setVault 重绘整棵树，
  // 之后再由它把树高亮刷成「无当前文件」。
  syncActiveDocument();
  showEditor(); // 旧 vault 的「暂不支持预览」覆盖层一并撤下
  // 残留崩溃备份的恢复入口（M127）：装载完成后才有 vault 上下文可定位备份。
  void save.checkRecovery();
  // 装载后恢复该 vault 的标签列表（M163）：逐标签异步装载，不阻塞树与首帧；恢复途中若又
  // 换了一次 vault，本次恢复整体作废（vault-switcher 的世代号）。上面的位置镜像已经就绪，
  // 逐个标签装载时会走各自的恢复。
  void switcher.onVaultLoaded(vaultId, entries);
}

// watch 增量事件流 → 附件索引与文件树同步打补丁（都不全量重扫）。
// 无 Tauri 后端的环境（如纯浏览器预览）下 listen 会 reject，静默忽略。
// 整段处理是「后台回调」（不在键入路径上），超 16ms 预算时采样记一条 slow_callback
// ——「文件一多就卡」这类毛刺正是 dogfood 要定位的东西。
onFsEntryChanged((changes) => {
  sampleCallback("fs_entry_changed", () => {
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
    // 已打开文件被外部变更（Lumir ↔ Obsidian 来回编辑的高频路径，M124）：附件索引与
    // 文件树照常吃增量，文档内容另行处置（save 控制器内分流）。M149：判据是**全部**
    // 打开中的文档而不是前台那一个——多标签下后台标签被外部改写同样要处置（旧实现只查
    // displayedPath，后台标签的变更会静默漏报）。
    for (const session of editor.sessions()) {
      const path = session.path;
      if (path === undefined) continue;
      const hit = changes.find((c) => c.path === path);
      if (hit) save.handleExternalChange(path, hit.kind);
    }
    // 链接索引已由后端随事件流增量更新；前端清缓存重建装饰
    linkFollow.invalidate();
    editor.refreshPreview();
    tree.applyChanges(changes);
  });
}).catch(() => {});

// 启动恢复（M159，change startup-restore-off-main-thread）：后端把 last_vault 的自动恢复
// 移出了 setup 主线程，前端因此要能表达三态——**恢复中** / 已打开 / 未打开（+ 可选提示）。
//
// 顺序是契约的一部分：**先订阅完成信号、再拉一次权威状态**。反过来的话，恢复在两者之间
// 完成会既没有监听者、拉取又早于完成，界面永久停在恢复中态（design §4.1）。
// 事件只是唤醒信号（无载荷）；权威状态始终是 vault_current 的返回值——webview 挂载晚于
// 恢复完成时事件根本收不到，终态照样正确。

// 恢复中态的提示行（文案-Copy.md D95）。复用未打开空态的布局，只换提示行：零新样式、
// 零布局变化，「打开 vault」入口天然保留（用户可在恢复期间抢先改选目录，design §4.3）。
const RESTORING_NOTICE = "正在恢复上次打开的 vault……";

/** 拉一次权威 vault 状态：已打开就装载，否则按终态（恢复中 / 恢复失败 / 无 vault）显示空态。
 *
 *  两条「不降级」门（都是让位规则的前端侧，design §4.2）：① 同一个 vault 的响应只装载一次
 *  ——启动时完成信号与首次拉取可能同时到达，重复装载会白走一遍编辑器整批复位与崩溃备份入口；
 *  ② 尚未到终态的空态只在**没装载过**时呈现——装载之后再到达的「恢复中 / 无 vault」响应是
 *  更早那次拉取的迟到响应，不能把已装载的树降级成空态。 */
function refreshVaultStatus(): Promise<void> {
  return vaultCurrent()
    .then((status) => {
      if (status.vault) {
        if (status.vault.root === loadedRoot) return;
        loadVault(status.vault.root, status.vault.entries, status.vault.vault_id, true);
      } else if (!vaultLoaded) {
        tree.showEmpty(status.restore_pending ? RESTORING_NOTICE : status.notice);
      }
    })
    .catch((e) => {
      if (!vaultLoaded) tree.showEmpty(errorMessage(e));
    });
}

/** 恢复完成信号的处理（订阅见下）：让位规则——只有尚未成功装载任何 vault 时才应用它。
 *  `vaultLoaded` 只在 `loadVault` 里置 true，因此 picker 取消 / 打开异常 / remap 候选短路
 *  这三条失效路径都不会挡掉恢复结果，与后端「失败不产生世代跃迁」对称（design §4.2）。 */
function applyRestoreFinished(): void {
  if (!vaultLoaded) void refreshVaultStatus();
}

onVaultRestoreFinished(applyRestoreFinished).catch(() => {}); // 无 Tauri 后端（纯浏览器预览）时静默忽略
void refreshVaultStatus();

// 标题栏产品标识块（M236，change product-version-display）：启动时经 Tauri 内置 app 模块
// 读一次 productName / version（真源 = tauri.conf.json，前端 MUST NOT 硬编码第二份——
// REVIEW.md 第 8 条），写 DOM 的事全在 src/modeline.ts（含窄窗退让）。运行期不刷新
//（版本号构建期固化，没有可监听的变化源）。
// 失败降级（ACL 漏配 / 非 Tauri 环境如 chromium 视觉桩未路由时）：标识块整体 hidden +
// 一条 app_meta_unavailable 诊断日志——宁可不显示，MUST NOT 渲染假版本号。
const titlebarIdentity = createTitlebarIdentity({
  block: shell.titlebarIdentity.block,
  name: shell.titlebarIdentity.name,
  sep: shell.titlebarIdentity.sep,
  version: shell.titlebarIdentity.version,
  modelineVersion: shell.modelineVersion,
});
Promise.all([getName(), getVersion()])
  .then(([name, version]) => titlebarIdentity.show({ name, version }))
  .catch((e: unknown) => {
    titlebarIdentity.fail();
    logEvent("app_meta_unavailable", { message: errorMessage(e) });
  });

// editor.mode：只对没有文件上下文的文档（空态 / 新建）生效的默认模式；打开文件时
// 一律按扩展名裁决（M130 方向 A：非 md 只读 code），该配置对文件打开不再有影响。
// keys：单键重绑 / 解绑（M132），覆盖到位后重挂分发器（见 applyKeyConfig）。
configGet().then((snapshot) => {
  editor.setMode(snapshot.config.editor.mode);
  // 折行口径（M180，change line-wrap-options）：配置给的是**启动时的起点**——应用运行期的
  // 翻转由两条 `view.toggle-*` 命令承担，运行期 MUST NOT 回写这里（config.json 的 mtime 与
  // 内容在翻转前后逐字节不变）。放在 setMode 之后：mode 决定代码块内容级 class 有没有
  // 作用对象，两者一起重配（editor.setWrap 走的就是那条 modeAndWrapEffects 路径）。
  editor.setWrap({
    lineWrap: snapshot.config.editor.line_wrap,
    codeBlockWrap: snapshot.config.editor.code_block_wrap,
  });
  // 排版口径（M195，change typography-and-zoom）：配置给的是**启动时的基准**——字号在运行期
  // 由三条 `view.text-scale-*` 命令步进，运行期 MUST NOT 回写这里（config.json 的内容与 mtime
  // 在步进前后逐字节不变）。字体族只在启动读一次（本 change 不做热重载，改字体需重启）。
  // warning 走与 [keys] 覆盖同一条出口（console + 诊断日志）——本模块不新造一个出口。
  for (const warning of editor.applyTypography({
    fontFamily: snapshot.config.editor.font_family,
    monoFontFamily: snapshot.config.editor.mono_font_family,
    fontSize: snapshot.config.editor.font_size,
  })) {
    console.warn(`lumir: ${warning}`);
    logEvent("config_warning", { source: "typography", message: warning });
  }
  applyKeyConfig(snapshot.config.keys);
  // 配置 warning（含 [keys] 的逐项回退）：M1 以来没有 UI 出口，如实记到 console，
  // 不新增 UI 面（避免启动浮条与既有启动视觉冲突）；同一份 warning 另落诊断日志
  // （config_warning 事件），让读日志的 agent 直接看到配置面出了什么问题。
  for (const warning of snapshot.warnings) {
    console.warn(`lumir: ${warning}`);
    logEvent("config_warning", { source: "config", message: warning });
  }
  // 阅读栏宽（M228，change content-width-drag）：配置给的是**启动时的初值**——运行期由栏宽
  // 拖拽推进并回写 `ui.content_width`（D3），因此不存在「运行期态 vs 配置默认」的双真源。
  // 前端不判区间（Rust 侧 validate 已越界回落默认 + warning，与主题同口径）。
  editor.setContentWidth(snapshot.config.ui.content_width);
  // 主题（restyle-ui-tokens-v1 的启动真源 + M237 的运行期切换）：`[ui] theme` 是**启动真源**，
  // 装载时经 applyTheme 施加到 `<html data-theme>`——token 层的三组块按这个属性取色，全部着色面
  // 即时跟随。运行期由 `view.theme-cycle`（⌘⇧T）/ modeline 主题钮推进并回写配置文件，因此不存在
  //「运行期态 vs 配置默认」的双真源；两处都走上面那个**唯一施加点** applyTheme。与上面几步同属
  //「配置到位后施加一次」的启动装配落点区。**前端不判非法值**：取值是闭集合，合法性已由
  // Rust 侧 validate 保证（light|dark|eink 之外 warning + 回落 light），前端再判一次就是
  // 同一条语义的第二处真源（REVIEW.md 第 8 条）。不跟随系统主题（非目标）。
  //
  // 放在本块**最后一条**是有意的：`config_get` 的拿到 `ui` 是契约（Rust 的 AppConfig 里
  // `ui` 不是 Option，序列化必带），但桩环境可能落后于契约——若断言在块首，桩缺 `ui` 时
  // 抛出的异常会让后面所有配置项（模式 / 折行 / 排版 / [keys]）一起被 `.catch` 静默吞掉，
  // 症状是「一大片场景以不相干的理由变红」。放最后则退化为「主题没施加」（浅色默认块照常
  // 生效，modeline 主题钮停在初始 hidden），失败面收窄到真正依赖主题的地方。测试桩的补齐见
  // tests/visual/scenes/tauri-stub.ts。
  applyTheme(snapshot.config.ui.theme);
}).catch(() => {});

// app-ready 只表示 webview/application shell 已挂载，不等价于 vault 恢复或编辑器首帧。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
emitReadiness("app-ready", { time: now });
