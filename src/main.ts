import { createShell } from "./shell";
import { createEditor } from "./editor";
import type { EditorHandle, EditorSession } from "./editor";
import type { EditorView } from "@codemirror/view";
import { applyKeyOverrides, BLOCK_SCROLL_CLASS, EDITOR_COMMAND_IDS, KEY_BINDINGS, Keymap, TAB_GOTO_IDS } from "./keys";
import type { CommandId, CommandRunner, CommandRuntime, EditorCommandId, KeyBinding, KeyOverrides } from "./keys";
import { DEFAULT_SPLIT_RATIO, clampSplitRatio, createDividerDrag, createPaneLayout } from "./pane-layout";
import type { DividerDrag, PaneId } from "./pane-layout";
import { DEFAULT_AUTO_INDENT } from "./enter-indent";
import { DEFAULT_FONT_SIZE } from "./typography";
import type { TypographySettings } from "./typography";
import type { EditorMode } from "./bindings/EditorMode";
import type { MarkdownLineNumbers } from "./bindings/MarkdownLineNumbers";
import { baseName, createFileTree, openKind, patchAttachmentPaths, vaultAbsolutePath } from "./tree";
import type { InlineEditRequest, OpenKind } from "./tree";
import {
  configGet,
  configSetUiValue,
  errorMessage,
  fsCreateDir,
  fsCreateFile,
  fsReadAttachment,
  fsReadSnapshot,
  fsRenameEntry,
  fsRevealInFinder,
  fsTrashEntry,
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
import { invoke } from "@tauri-apps/api/core";
import { getName, getVersion } from "@tauri-apps/api/app";
import { createToc } from "./toc";
import { createImageLightbox } from "./lightbox";
import { createTableFullscreen } from "./table-fullscreen";
import { createGotoLinePrompt } from "./goto-line";
import { createCodeBlockFullscreen } from "./code-block-fullscreen";
import { blockCopyTarget, codeBlockFullscreenTarget, tableFullscreenTarget } from "./preview/livePreview";
import { blockCopyText } from "./preview/block-copy";
import type { BlockCopyRange } from "./preview/block-copy";
import {
  createGuardPromptPresenter,
  createVaultLoadingIndicator,
  createVaultRemapPrompt,
  createVaultSwitcher,
  createVaultSwitchGate,
  samePath,
} from "./vault-switcher";
import type { VaultSwitcherHandle } from "./vault-switcher";
import { createReadingPositionStore } from "./reading-position";
import {
  COPIED_PATH_TOAST,
  COPY_PATH_FAILED_TOAST,
  DIALOG_CANCEL,
  TRASH_CONFIRM_DIR_BODY,
  TRASH_CONFIRM_FILE_BODY,
  TRASH_CONFIRM_OK,
  TRASH_CONFIRM_TITLE,
  createConfirmDialog,
  createRenameEchoGuard,
  createTreeContextMenu,
} from "./tree-menu";
import type { TreeMenuAction, TreeMenuTarget } from "./tree-menu";
// M151：名字听不出归属的三块能力各自的模块（见各处装配点与模块头注释）。
// link-follow（解析缓存 + 链接跟随）、tabs（标签栏 DOM）、bindings-panel（键位查看面板）。
import { createLinkFollow } from "./link-follow";
import { createTabs } from "./tabs";
import type { TabsHandle } from "./tabs";
import { createBindingsPanel } from "./bindings-panel";
import { WIDTH_HANDLE_LABEL, WIDTH_SAVE_FAILED_TEXT, createContentWidthDrag } from "./content-width";
import { createTitlebarIdentity } from "./modeline";
import {
  THEME_INDICATOR_LABEL,
  THEME_SAVE_FAILED_TEXT,
  currentTheme,
  nextTheme,
} from "./theme";
import {
  currentLanguage,
  formatNumber,
  languageTag,
  nextLanguage,
  onRelabel,
  runRelabels,
  t,
  tPlural,
} from "./copy";
import type { Language } from "./copy";
import { invalidateMermaidTheme } from "./preview/mermaid";
import { logEvent, sampleCallback } from "./diagnostics";
import type { FsEntry } from "./bindings/FsEntry";
import type { UiTheme } from "./bindings/UiTheme";
import type { VaultInfo } from "./bindings/VaultInfo";
import type { VaultStatus } from "./bindings/VaultStatus";
import type { VaultListEntry } from "./bindings/VaultListEntry";
import { extensionOf, codeLanguageOfPath, isEditablePath, mimeTypeOf, resolveByNameUnique } from "./preview/attachments";
import { openSearch } from "./search";
import { createHarnessPanel } from "./harness-panel";
import "./style.css";
// 搜索 panel 的样式单列一个文件（M139）：与并行 mission 的 src/style.css 隔离，
// 本 mission 的搜索样式一律放这里。
import "./search-panel.css";
// harness 对话面板的样式同理单列（M303，change add-harness-probe）。
import "./harness-panel.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

// ---------------------------------------------------------------------------
// 本 change 新增的两条后端命令封装（change vault-open-ignore-set）
//
// **待收编**：按仓内既有分层，所有 command 调用应当经 `src/ipc.ts` 进出（那个文件头写着
// 「所有 command 调用与后端事件订阅经此模块进出」）。本 mission 的 scope 不含 `src/ipc.ts`
// ——与 M127 当年的处境同形（那次封装暂居 `src/save-ipc.ts`，M132 才收编回 ipc.ts，来历记在
// `src/ipc.ts` 的文件头）。照同一条办：两条封装暂居装配层，收编由后续 mission 完成。
// 这不是「多开一条通道」：命令名、参数名与后端 `commands.rs` 的定义逐字一致，形态与
// `ipc.ts` 里那三十来条封装完全同构。
// ---------------------------------------------------------------------------

/** 按需枚举一个目录的**一层**条目（后端 `fs_scan_dir`）：文件树展开惰性目录时的唯一取数通道。
 *  失败 reject 人话 `CommandError`（越界 / 不存在 / 不是目录 / 读失败），调用方负责提示。 */
function fsScanDir(dir: string): Promise<FsEntry[]> {
  return invoke<FsEntry[]>("fs_scan_dir", { dir });
}

/** 批量探测一组 vault 相对路径是否存在（后端 `fs_paths_exist`）：返回其中确实存在的那些。
 *  会话恢复与阅读位置共用这一个读口（一次命令、一次往返、N 次 stat）。 */
function fsPathsExist(paths: string[]): Promise<string[]> {
  return invoke<string[]>("fs_paths_exist", { paths });
}

// M1 装配：app-shell 三栏 + 编辑器内核 + 键位框架 + 全类型文件树
//（add-vault-workspace），M20 接上附件链路（add-editor-live-preview）。
// editor.ts 的 EditorHandle 由 editor 波持有，此处只消费，不改其签名。
const shell = createShell(app);

// ---------------------------------------------------------------------------
// 双 pane 装配（M316 建骨架，M317 完成标签级接线）：
// pane-layout 账本管 pane 生命周期、活跃指针与**标签归属**；每个 pane 一个 createEditor 实例
//（design §4「createEditor 双实例化」）。
//   - 账本既做 **pane 级**操作（split / close / activate），也做**标签级**归属登记
//    （openTab / closeTab / moveTab）。标签归属的对齐口径是 `reconcilePaneLedger`（M317 接线）：
//     账本按**对象引用**持有各实例的 EditorSession，与实例会话表对账（同一对象、path 活读），
//     装配层不另存第二份归属清单（REVIEW.md 第 8 条）。跨 pane 移动标签走 `moveSessionToPane`
//    （账本 moveTab + 源实例 closeSession + 目标实例 adoptSession，state 整体迁移不重建）；
//   - 「哪个会话在哪个 pane」的**现查**入口仍是 `paneEntryOfSession`（按实例会话表查，与账本
//     对账同源、互为兜底）；
//   - 既有消费者（保存链路 / toc / link-follow / 栏宽拖拽 / 浮层群 / 命令表）拿到的仍是
//     一个 EditorHandle——下面这份**复合句柄**：写类口径广播到全部 pane（能力一份值管
//     全部实例，与单实例时代语义一致），读类与动作类解析到**活跃 pane**，会话级操作按
//     属主 pane 路由，`sessions()` 给并集（退出守卫 / 会话落盘 / watch 处置因此结构上
//     免费成立）。
// ---------------------------------------------------------------------------

/** 一个 pane 的装配记录：DOM 槽（编辑器挂载元素 + 标题栏标签槽）与实例句柄。 */
interface PaneAssembly {
  mountEl: HTMLElement;
  stripEl: HTMLElement;
  handle: EditorHandle;
  /** 该 pane 的标签条实例；root pane 在下方 tabs 装配块就位，pane B 在 split 时就位。 */
  tabs: TabsHandle | undefined;
  /** 该 pane 的订阅与监听的退订函数（disposePaneHandle 时整批跑掉）。 */
  unsubs: Array<() => void>;
}

const paneAssemblies = new Map<PaneId, PaneAssembly>();

// 配置期值的跟踪（新 pane 能力同步的真源）：全部只在文件末尾的 configGet 块写一次，
// 运行期没有改它们的命令（与 editor.ts 各自的「装载时喂一次」口径同源）。初值与
// editor.ts 的实例初值逐项对齐——split 发生在配置到达之前时，pane B 因此与 root pane
// 同口径。折行 / 排版 / 栏宽不在这里跟踪：它们是运行期口径，split 时从既有 pane
//（donor）的只读快照现取（运行期步进后的当前值只有实例记账里有）。
let currentDefaultMode: EditorMode = "md";
let currentAutoIndent = DEFAULT_AUTO_INDENT;
let currentMarkdownLineNumbers: MarkdownLineNumbers = "on-demand";
let currentTypography: TypographySettings = {
  fontFamily: null,
  monoFontFamily: null,
  fontSize: DEFAULT_FONT_SIZE,
};
/** wikilink 解析器的当前值（applyVault 更新；新 pane 的注入重放读同一份）。 */
let currentResolver: Parameters<EditorHandle["setWikilinkResolver"]>[0] = null;

/** 编辑器能力注入的注册表（tasks 1.3「能力注入收敛为单一遍历全部 pane 入口」）：
 *  注册即对现存全部 pane 施加，新 pane 在 createPaneHandle 里全量重放——pane B 不靠
 *  调用方记得补注。 */
const editorInjections: Array<(handle: EditorHandle) => void> = [];
function forEachEditor(run: (handle: EditorHandle) => void): void {
  for (const pane of paneLayout.panes()) run(pane.handle);
}
function injectEach(register: (handle: EditorHandle) => void): void {
  editorInjections.push(register);
  forEachEditor(register);
}

/** 「每个 pane 的 EditorView 本体」的挂钩注册表（M317 tasks 2.1）：与 `editorInjections`
 *  同构——注册即对现存 pane 的视图各挂一次，新 pane 在 `createPaneHandle` 里重放。用于需要
 *  视图对象本身、而不只是 EditorHandle 的消费者（当前唯一是 toc 的 updateListener：
 *  它要挂在**每个** pane 的视图上，才能在该 pane 成为活跃 pane 后捕获它自己的光标 / 滚动）。 */
const viewTrackers: Array<(view: EditorView) => void> = [];
function trackEachView(run: (view: EditorView) => void): void {
  viewTrackers.push(run);
  for (const pane of paneLayout.panes()) run(pane.handle.view);
}

/** wikilink 解析器的施加（applyVault 唯一调用点）：更新当前值并广播到全部 pane——
 *  新 pane 在 createPaneHandle 里读同一份 currentResolver，两处因此不漂
 *（REVIEW.md 第 8 条）。 */
function applyWikilinkResolver(
  resolver: Parameters<EditorHandle["setWikilinkResolver"]>[0],
): void {
  currentResolver = resolver;
  forEachEditor((handle) => handle.setWikilinkResolver(resolver));
}

/** 编辑器事件订阅的注册表（onReady / onScroll / onDirty / …）：与注入同构——订阅对
 *  现存全部 pane 挂上、新 pane 自动挂上；返回的退订函数从全部 pane 上摘除。 */
const paneSubscribers: Array<(handle: EditorHandle) => () => void> = [];
function onEachEditor(subscribe: (handle: EditorHandle) => () => void): () => void {
  paneSubscribers.push(subscribe);
  const unsubs = paneLayout.panes().map((pane) => subscribe(pane.handle));
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

// 分隔条比例：内存态真源（初值与钳制区间取自 pane 模块的单一来源）。松手位置写会话文件
// （per-vault 布局即数据，M318 tasks 5.4）；**不复用 `ui.content_width` 全局键**——栏宽是
// 全局偏好、分栏比例是 vault 布局，两个真源各管一层（ADR 0008 Decision 2）。
let splitRatio = DEFAULT_SPLIT_RATIO;
/** 分隔条元素（split 时现建、close 时移除；单 pane DOM 里没有它）。 */
let dividerEl: HTMLElement | null = null;
/** 分隔条拖拽控制器（与 dividerEl 同生命周期；元素移除前先摘监听）。 */
let dividerDrag: DividerDrag | null = null;
/** 分隔条的读屏名（M319，文案 D368）：`role=separator` 需要一句可读的身份——它与栏宽拖拽手柄
 *  （同为 `role=separator`、读屏名 D120）是两回事，读屏不该听到两个无名的分隔符。元素在分栏时
 *  现建、close 时移除，因此没有「挂载时写死」的问题；语言切换由下方 onRelabel 重写
 *（design §5.2 的不变量：挂载后无法重写的语言相关文本 MUST NOT 存在）。 */
const SPLITTER_LABEL = (): string => t("D368");

const paneLayout = createPaneLayout<EditorSession, EditorHandle>({
  createHandle: (paneId) => createPaneHandle(paneId),
  disposeHandle: (handle) => disposePaneHandle(handle),
});

/** 为一个 pane 建编辑器实例与其 DOM 槽（pane-layout 的 createHandle 注入点）。
 *  root pane（恒为 id 1）复用 shell 建好的挂载元素与标签槽——单 pane DOM 与 M316 之前
 *  逐字节一致（零基线更新判据）；pane B 的挂载元素 / 标签槽 / 分隔条全部现建，
 *  close 时整批移除（见 disposePaneHandle）。 */
function createPaneHandle(paneId: PaneId): EditorHandle {
  const rootSlot = paneId === 1;
  const mountEl = rootSlot ? shell.editorPane : document.createElement("div");
  const stripEl = rootSlot ? shell.tabStrip : shell.createTabStrip();
  if (!rootSlot) {
    mountEl.className = "editor-pane";
    const divider = document.createElement("div");
    divider.className = "pane-divider";
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-label", SPLITTER_LABEL()); // 读屏名（M319，D368）
    wireDividerDrag(divider);
    shell.editor.append(divider, mountEl);
    shell.tabStrip.after(stripEl);
    dividerEl = divider;
  }
  const handle = createEditor(mountEl);
  const assembly: PaneAssembly = { mountEl, stripEl, handle, tabs: undefined, unsubs: [] };
  paneAssemblies.set(paneId, assembly);
  if (!rootSlot) {
    // createEditor 的初始会话是 SAMPLE 演示文档（无文件上下文的起步态）——新 pane 从
    // 未命名空文档起步，不给它复制一份演示文档。
    handle.reset();
    // 能力同步：配置期值读装配层跟踪，运行期口径（折行 / 排版 / 栏宽）读既有 pane
    //（donor）的只读快照。排版的两个成员各管一半：applyTypography 把 baseFontSize 锚回
    // 配置档（⌘0 回落语义），syncRuntimeTypography 把运行期步进值对齐进实例记账。
    const donor = paneLayout.panes()[0].handle;
    handle.setMode(currentDefaultMode);
    handle.setWrap(donor.wrapSettings());
    handle.setAutoIndent(currentAutoIndent);
    handle.applyTypography(currentTypography);
    handle.syncRuntimeTypography(donor.typographySettings());
    handle.setContentWidth(donor.contentWidth());
    handle.setMarkdownLineNumbers(currentMarkdownLineNumbers);
    handle.setWikilinkResolver(currentResolver);
  }
  // 能力注入与事件订阅全量重放（注册表口径，见上面几处注册表的注释）。
  for (const inject of editorInjections) inject(handle);
  for (const track of viewTrackers) track(handle.view);
  for (const subscribe of paneSubscribers) assembly.unsubs.push(subscribe(handle));
  // 焦点进入该 pane 的内容区 → 它成为活跃 pane；焦点移去 chrome 不翻指针
  //（pane-layout 的 activate 语义：「移出内容区不调用」）。
  const onFocusIn = (): void => activatePane(paneId);
  mountEl.addEventListener("focusin", onFocusIn);
  assembly.unsubs.push(() => mountEl.removeEventListener("focusin", onFocusIn));
  return handle;
}

/** 归还一个 pane 的编辑器句柄（pane-layout 的 disposeHandle 注入点）：摘订阅、销毁
 *  EditorView、拆 DOM 槽。root pane 的 DOM 槽是 shell 的常驻元素，只销毁实例不拆元素
 *（本 mission 的 close 流程恒收动态 pane，root 槽永不归还——该分支是防御性的）。 */
function disposePaneHandle(handle: EditorHandle): void {
  const entry = [...paneAssemblies.entries()].find(([, assembly]) => assembly.handle === handle);
  if (entry === undefined) return;
  const [paneId, assembly] = entry;
  for (const unsub of assembly.unsubs) unsub();
  handle.view.destroy();
  if (paneId !== 1) {
    dividerDrag?.destroy(); // 元素移除前先摘指针监听（元素随后才 remove）
    dividerDrag = null;
    assembly.mountEl.remove();
    assembly.stripEl.remove();
    dividerEl?.remove();
    dividerEl = null;
  }
  paneAssemblies.delete(paneId);
}

/** 活跃 pane 指针的唯一翻转点（焦点进入 / 标签条交互 / 跨 pane 激活共用）：翻完对齐
 *  一次表现层——modeline / 树高亮 / 大纲读的都是活跃 pane 的前台文档。 */
function activatePane(paneId: PaneId): void {
  if (paneLayout.active().id === paneId) return;
  paneLayout.activate(paneId);
  syncActiveDocument();
}

/** 按一个 EditorView 找到它所属 pane 并翻成活跃 pane（M317 2.3 的鼠标路径：事件只带视图，
 *  不带 pane id）。找不到即视图不属于任何在场 pane（防御性），无操作。 */
function activatePaneForView(view: EditorView): void {
  for (const [paneId, assembly] of paneAssemblies) {
    if (assembly.handle.view === view) {
      activatePane(paneId);
      return;
    }
  }
}

/** 一个编辑器句柄所属的 pane（M317 2.9：遮罩的来源 pane）。 */
function paneIdOfHandle(handle: EditorHandle): PaneId | undefined {
  for (const [paneId, assembly] of paneAssemblies) {
    if (assembly.handle === handle) return paneId;
  }
  return undefined;
}

/** 把焦点交还给**指定 pane**（M317 2.9 的遮罩焦点归还例外）：遮罩打开后活跃 pane 可能已经
 *  切换，焦点要还到打开遮罩的那个 pane，而不是机械回当前活跃 pane。指定的 pane 已收起时
 *  （防御性）退化为活跃 pane。聚焦会触发该 pane 的 focusin，活跃指针随之翻回来——与「点选
 *  窗口即选中该窗口」一致。 */
function focusSourcePane(paneId: PaneId | undefined): void {
  const pane = paneId === undefined ? undefined : paneLayout.panes().find((p) => p.id === paneId);
  (pane?.handle ?? paneLayout.activeHandle()).focusPreservingReadingPosition();
}

/** 活跃 pane 的标签条实例。未就位的唯一窗口是 splitActivePane 里 split() 与标签条
 *  创建之间的同步段——外部调用不可能插进去；缺位即接线错误，就地炸掉（同 pane-layout
 *  的 paneById 口径），不静默当成无操作。 */
function activeTabs(): TabsHandle {
  const tabs = paneAssemblies.get(paneLayout.active().id)?.tabs;
  if (tabs === undefined) throw new Error("main: 活跃 pane 的标签条实例未就位"); // i18n-exempt: log
  return tabs;
}

/** 会话属主 pane 的装配记录（真源 = 各实例会话表，见块头注释）。 */
function paneEntryOfSession(session: EditorSession): [PaneId, PaneAssembly] | undefined {
  for (const entry of paneAssemblies.entries()) {
    if (entry[1].handle.sessions().includes(session)) return entry;
  }
  return undefined;
}

/** 在属主 pane 激活一个会话并把活跃 pane 翻过去（不移动标签的场景：会话恢复激活等）。 */
function activateSessionInOwnerPane(session: EditorSession): void {
  const entry = paneEntryOfSession(session);
  if (entry === undefined) return;
  activatePane(entry[0]);
  entry[1].tabs?.activateTab(session);
}

/** 把一个会话**整体迁到**目标 pane（M317 tasks 4.1 / 4.2）：源实例摘除、目标实例接管。
 *  `adoptSession` 迁入的是**原 state 对象**（撤销史 / 语法树 / 选区 / 搜索查询随迁，M317 4.1
 *  已把三处 Compartment 提为模块级共享使之成立），MUST NOT 重建 state、MUST NOT 重新解析。
 *  账本一侧用 `moveTab` 同步归属；目标 pane 成为活跃 pane 且该标签成为其前台。
 *  移动**不制造撤销事件**（没有 dispatch 装载事务，只是 view.setState）。 */
function moveSessionToPane(session: EditorSession, targetPaneId: PaneId): void {
  const owner = paneEntryOfSession(session);
  const target = paneAssemblies.get(targetPaneId);
  if (target === undefined) return;
  if (owner !== undefined && owner[0] === targetPaneId) {
    // 已在该 pane：只激活（幂等分支）。
    activatePane(targetPaneId);
    target.tabs?.activateTab(session);
    return;
  }
  // 账本先动（此时标签已登记在册，reconcile 保证）：moveTab 把归属挪到目标 pane。
  paneLayout.moveTab(session, targetPaneId);
  owner?.[1].handle.closeSession(session); // 源实例摘除（不销毁 state；前台让位给邻居）
  target.handle.adoptSession(session); // 目标实例接管原 state（不重建）
  renderAllTabStrips();
  activatePane(targetPaneId);
  target.handle.activateSession(session); // view.setState(原 state)：撤销史 / 选区 / 滚动随行
  target.tabs?.renderTabs();
  syncActiveDocument();
}

/** 账本对账（M317 标签级接线）：把 pane-layout 的标签账本与各 pane 编辑器实例的会话表对齐。
 *
 *  为什么用「对账」而不是「openTab 作唯一创建通道」：编辑器实例内部也会建会话——`createEditor`
 *  的初始文档、`reset()` 的空文档都是实例内部行为，装配层看不到那些创建点，无法把它们都改道
 *  经 `openTab`。因此账本按**对象引用**与实例会话表对齐（同一 `EditorSession`，`path` 活读），
 *  两边天然不会各存一份归属真源。
 *
 *  对账用 `openTab` 登记（它按 path 判重、登记后不改已有归属——被登记的会话本就只属于当前
 *  pane）、`closeTab` 摘除、`activateTab` 对齐前台；对账过程会翻活跃指针，末尾还原。
 *  每次调用只对**差异**动手，稳态下是 O(panes × tabs) 的纯比较。 */
function reconcilePaneLedger(): void {
  const activeId = paneLayout.active().id;
  for (const pane of paneLayout.panes()) {
    const sessions = pane.handle.sessions();
    for (const tab of [...pane.tabs]) {
      if (!sessions.includes(tab)) paneLayout.closeTab(tab);
    }
    for (const session of sessions) {
      if (paneLayout.paneOf(session) === undefined) {
        // create 只交回既有会话对象本身（对账不新建）；path 此刻已落定，判重键因此正确。
        paneLayout.openTab(session.path, () => session, pane.id);
      }
    }
    const foreground = pane.handle.activeSession();
    if (sessions.includes(foreground)) paneLayout.activateTab(pane.id, foreground);
  }
  paneLayout.activate(activeId); // openTab / activateTab 会翻活跃指针，对账后还原
}

/** 全部 pane 的标签槽各重画一遍（dirty 跃迁 / 同步点）：dirty 点是逐标签的，
 *  后台 pane 的标签条也要跟着变。 */
function renderAllTabStrips(): void {
  for (const assembly of paneAssemblies.values()) assembly.tabs?.renderTabs();
}

/** 每 pane 一个标签条实例（tabs per-pane，tasks 分组 3）：createTabs 的 editor / mount
 *  都传该 pane 自己的，会话子列表与标签槽因此天然 per-pane（模型就是实例会话表，
 *  不另存清单）。用户与该 pane 标签条的交互（点标签 / 关标签）同时把活跃 pane 翻过去——
 *  窗口级命令（⌘W / ⌃⇥ / ⌘1–9 / 右键菜单）作用于活跃 pane 的标签条（已裁形态）。 */
function createPaneTabs(paneId: PaneId, handle: EditorHandle, stripEl: HTMLElement): TabsHandle {
  const raw = createTabs({
    editor: handle,
    mount: stripEl,
    // 菜单挂点取 app-shell 根：标签栏是横向滚动容器（.tabstrip 的 overflow-x: auto），
    // 菜单挂进去会被它裁掉——与文件树菜单、vault 浮层同一条理由。
    overlayMount: shell.root,
    // 适配一层：tabs 只关心「选没选出口」，不关心 tone；tone 固定 neutral（关标签确认是
    // 警告语气，不是成功态）。
    toast: (text, actions, sticky, onDismiss) => {
      toast(text, actions, sticky, "neutral", onDismiss);
    },
    saveCurrent: () => save.save(),
    // 「放弃修改并关闭」这条出口不产生 dirty 跃迁（会话直接被摘掉），备份得由它显式清除。
    forgetBackup: (path) => save.forgetBackup(path),
    invalidateResolve: () => linkFollow.invalidate(),
    showEditor: () => showEditor(),
    syncActiveDocument: () => syncActiveDocument(),
    // 树是下面 `let tree` 绑定的单例，赋值在 createPaneTabs 首次调用之后——闭包在动作
    // 发生时读，装配期不读，因此没有时序问题（与 M149 起就有的那条注释同款模式）。
    revealInTree: (path) => tree.revealPath(path),
    keepMountWhenEmpty: () => paneLayout.isSplit(),
  });
  return {
    ...raw,
    activateTab: (session) => {
      activatePane(paneId);
      raw.activateTab(session);
    },
    closeTab: (session) => {
      activatePane(paneId);
      return raw.closeTab(session);
    },
  };
}

/** 分隔条拖拽的接线（控制器本体在 src/pane-layout.ts，可脱浏览器单测）：指针每移一次实时
 *  重排（比例内存态，钳 `[SPLIT_RATIO_MIN, SPLIT_RATIO_MAX]`），**松手写盘一次**——写本 vault
 *  的会话文件（per-vault 布局即数据，M318 tasks 5.4），MUST NOT 复用 `ui.content_width`。
 *  拖拽全程只改比例与布局样式，不碰文档 / 撤销栈 / dirty（控制器依赖面里没有编辑器，
 *  见 `createDividerDrag` 的说明）。 */
function wireDividerDrag(divider: HTMLElement): void {
  dividerDrag = createDividerDrag({
    divider,
    measure: () => {
      const rect = shell.editor.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    },
    apply: () => applySplitRatio(),
    getRatio: () => splitRatio,
    setRatio: (ratio) => {
      splitRatio = ratio;
    },
    onCommit: () => {
      // 松手才排期落盘：拖拽过程零写盘请求（防抖窗口在 store 里）。switcher 在下面才建，
      // 但本回调只在拖拽发生时跑，那时它已就位（与 createPaneTabs 里 `tree` 的同一模式）。
      void switcher.sessionChanged();
    },
  });
}

/** 分隔条比例的施加：pane 挂载元素与标题栏标签槽的 inline flexGrow **同源同一份
 *  splitRatio**（「两槽宽度比例跟随分隔条」是已裁形态）；单 pane 时清空 inline 样式，
 *  回落 CSS 默认——几何与 M316 之前逐像素一致。 */
function applySplitRatio(): void {
  const split = paneLayout.isSplit();
  for (const [index, assembly] of [...paneAssemblies.values()].entries()) {
    if (!split) {
      assembly.mountEl.style.flexGrow = "";
      assembly.stripEl.style.flexGrow = "";
      assembly.stripEl.style.flexBasis = "";
      continue;
    }
    const grow = index === 0 ? splitRatio : 1 - splitRatio;
    assembly.mountEl.style.flexGrow = String(grow);
    assembly.stripEl.style.flexGrow = String(grow);
    assembly.stripEl.style.flexBasis = "0";
  }
}

/** 分栏态的 chrome 切换：右簇退让（产品标识块整块退 modeline、harness toggle 钮隐藏，
 *  均为已裁形态）+ 两槽比例 + 标签槽重画。 */
function applySplitChrome(): void {
  const split = paneLayout.isSplit();
  titlebarIdentity.setSplitRetreat(split);
  harnessPanel.setChromeRetreat(split);
  applySplitRatio();
  renderAllTabStrips();
}

/** 把 pane 布局设成存储的形状（恢复路径的当帧一步，M318 tasks 5.3）：`count` 为 1 或 2。
 *  - 存储是分栏（2）而当前是单 pane → 补一次 split；
 *  - 存储是单 pane（1）而当前在分栏 → 收拢回 root（切换 vault 时上一次的分栏拓扑不会残留
 *    到新 vault，「单 pane 存储恢复不出第二 pane」）；
 *  - 比例钳进合法区间后施加。
 *  已是目标形态时不动（不重复 split / 不无辜收起）。 */
function applyPaneCount(count: number, ratio: number): void {
  splitRatio = clampSplitRatio(ratio);
  if (count > 1) {
    if (!paneLayout.isSplit()) addPane(); // 恢复路径**不抢焦点**（焦点归用户，不进右 pane）
  } else if (paneLayout.isSplit()) {
    closeActivePane();
  }
  applySplitChrome();
  syncActiveDocument();
}

/** 建一个新 pane（账本落点规则：恒在活跃 pane 右侧并即活跃）并补标签条实例与 chrome。
 *  能力同步与注入重放在 createPaneHandle 里完成。**不抢焦点**——`pane.split` 命令与恢复
 *  路径共用它，焦点由调用方决定（恢复路径不该在装载期把焦点丢进右 pane）。 */
function addPane(): boolean {
  const pane = paneLayout.split(); // 上限二：null = 无操作、无提示（不变量 1）
  if (pane === null) return false;
  const assembly = paneAssemblies.get(pane.id);
  if (assembly !== undefined) {
    assembly.tabs = createPaneTabs(pane.id, pane.handle, assembly.stripEl);
  }
  applySplitChrome();
  return true;
}

/** `pane.split`：建右 pane、把焦点交给它（用户动作的落点），再对齐一次表现层。 */
function splitActivePane(): void {
  if (!addPane()) return;
  paneLayout.activeHandle().focusPreservingReadingPosition();
  syncActiveDocument();
}

/** `pane.other`（Emacs other-window 语义）：焦点落目标 pane——交还焦点走
 *  focusPreservingReadingPosition（M280 口径：聚焦不得把阅读位置拽回光标处）。 */
function activateOtherPane(): void {
  if (!paneLayout.activateOther()) return;
  paneLayout.activeHandle().focusPreservingReadingPosition();
  syncActiveDocument();
}

/** `pane.close`（裁决点 2 = 方案 A：不丢标签、不弹关标签确认）：会话先过户、账本后收。
 *  收尾占据 shell 槽的**恒为 root pane**——它复用 shell 的常驻 DOM 元素（单 pane 判据），
 *  因此被收的是 root 时先把活跃指针翻给动态 pane、再让账本收它：「被收 pane 的前台成为
 *  幸存 pane 前台」的语义不变，对齐的只是 DOM 槽位；标签顺序保持视觉上的从左到右
 *（root 的在前、并进来的在后）。 */
function closeActivePane(): void {
  if (!paneLayout.isSplit()) return;
  // 先把账本对齐再收（close() 依据 closing.tabs 把归属并入幸存 pane）：M317 标签级接线。
  reconcilePaneLedger();
  const closing = paneLayout.active();
  const root = paneLayout.panes()[0];
  const dynamic = paneLayout.panes()[1];
  const closingForeground = closing.handle.activeSession();
  // 动态 pane 的会话全量过户进 root：干净且无路径的未命名文档丢弃无损失；dirty 未命名
  // 必须随迁——它的内容只活在内存里，不迁就是数据丢失。
  for (const session of [...dynamic.handle.sessions()]) {
    if (session.path === undefined && !session.dirty) continue;
    dynamic.handle.closeSession(session); // 源实例摘除（邻居激活等副作用随 view 销毁无害）
    root.handle.adoptSession(session);
  }
  if (closing === dynamic) {
    paneLayout.close();
    // 被收 pane 的前台成为幸存 pane 前台（干净空文档已被丢弃的除外——那时幸存 pane
    // 保持自己的前台）。
    if (root.handle.sessions().includes(closingForeground)) {
      root.handle.activateSession(closingForeground);
    }
  } else {
    // 被收的是 root：会话（含刚过户的）已全在 root、前台不动；把活跃指针翻给动态 pane
    // 再让账本收它，收尾 DOM 槽位恒落 root。
    paneLayout.activate(dynamic.id);
    paneLayout.close();
  }
  applySplitChrome();
  root.handle.focusPreservingReadingPosition();
  syncActiveDocument();
}

// 既有消费者的统一入口（复合句柄，口径见本块头注释）。单 pane 时全部方法退化为对
// root pane 那一个实例的直转——逐语义不变的第一判据因此成立在结构上。
const editor: EditorHandle = {
  get view() {
    return paneLayout.activeHandle().view;
  },
  // 命令表在装配期预生成、**分发时**按活跃 pane 解析（tasks 分组 3）——下方命令表里的
  // `...editor.commands` 展开因此逐字不动。
  commands: Object.fromEntries(
    EDITOR_COMMAND_IDS.map((id) => [
      id,
      (event?: KeyboardEvent) => paneLayout.activeHandle().commands[id](event),
    ]),
  ) as Record<EditorCommandId, CommandRunner>,
  setMode: (mode) => forEachEditor((handle) => handle.setMode(mode)),
  mode: () => paneLayout.activeHandle().mode(),
  setWrap: (next) => forEachEditor((handle) => handle.setWrap(next)),
  wrapSettings: () => paneLayout.activeHandle().wrapSettings(),
  setAutoIndent: (next) => forEachEditor((handle) => handle.setAutoIndent(next)),
  toggleLineWrap: () => forEachEditor((handle) => handle.toggleLineWrap()),
  toggleCodeBlockWrap: () => forEachEditor((handle) => handle.toggleCodeBlockWrap()),
  applyTypography: (settings) => {
    // warning 是配置值层面的（非法字族），各实例逐字相同——广播施加、只回第一份。
    let warnings: readonly string[] = [];
    forEachEditor((handle) => {
      const result = handle.applyTypography(settings);
      if (warnings.length === 0) warnings = result;
    });
    return warnings;
  },
  typographySettings: () => paneLayout.activeHandle().typographySettings(),
  syncRuntimeTypography: (settings) =>
    forEachEditor((handle) => handle.syncRuntimeTypography(settings)),
  textScale: (direction) => forEachEditor((handle) => handle.textScale(direction)),
  // 栏宽是**全局单键**（`ui.content_width`，ADR 0008 Decision 2）：一份值管全部 pane，
  // 单 key 不动（M317 2.5）。广播施加到每个实例（各写一次 documentElement 上的 token，幂等），
  // 并**逐 pane 各自 requestMeasure()**——CSS 变量变化不触发 CM 的 ResizeObserver（editor.ts
  // 的 setContentWidth 注释），只给 root 请求重测量会让另一个 pane 停在旧列宽上。CM 会把同帧
  // 多次 requestMeasure 合并成一次，重复请求无额外成本。
  setContentWidth: (width) => {
    forEachEditor((handle) => {
      handle.setContentWidth(width);
      handle.view.requestMeasure();
    });
  },
  contentWidth: () => paneLayout.activeHandle().contentWidth(),
  // 新会话落在**活跃 pane**（tasks 2.10 / 4.2 的打开落点）。
  createSession: () => paneLayout.activeHandle().createSession(),
  // 复合句柄的这个方法恒落 root pane（EditorHandle 接口要求实现它）。**会话恢复不再走它**：
  // M318 起按 pane 恢复，恢复路径直接用目标 pane 的句柄（见 switcher deps 的 createShell）。
  // 新 pane 的空白档由 split 自己的 reset 提供。
  createShellSession: (path) => paneLayout.panes()[0].handle.createShellSession(path),
  reloadSession: (session, doc, path, requestId) => {
    (paneEntryOfSession(session)?.[1].handle ?? paneLayout.activeHandle()).reloadSession(
      session,
      doc,
      path,
      requestId,
    );
  },
  remapSessionPaths: (from, to) =>
    paneLayout.panes().flatMap((pane) => pane.handle.remapSessionPaths(from, to)),
  activateSession: (session) => {
    const entry = paneEntryOfSession(session);
    if (entry === undefined) return;
    entry[1].handle.activateSession(session);
    activatePane(entry[0]);
  },
  activeSession: () => paneLayout.activeHandle().activeSession(),
  sessions: () => paneLayout.panes().flatMap((pane) => pane.handle.sessions()),
  sessionForPath: (path) => {
    for (const pane of paneLayout.panes()) {
      const found = pane.handle.sessionForPath(path);
      if (found !== undefined) return found;
    }
    return undefined;
  },
  closeSession: (session) => {
    (paneEntryOfSession(session)?.[1].handle ?? paneLayout.activeHandle()).closeSession(session);
  },
  adoptSession: (session) => paneLayout.activeHandle().adoptSession(session),
  markCleanOf: (path, content) => forEachEditor((handle) => handle.markCleanOf(path, content)),
  reset: () => forEachEditor((handle) => handle.reset()),
  setAttachmentProvider: (provider) =>
    forEachEditor((handle) => handle.setAttachmentProvider(provider)),
  setWikilinkResolver: (resolver) =>
    forEachEditor((handle) => handle.setWikilinkResolver(resolver)),
  setLightbox: (lightbox) => forEachEditor((handle) => handle.setLightbox(lightbox)),
  setTableFullscreen: (fullscreen) =>
    forEachEditor((handle) => handle.setTableFullscreen(fullscreen)),
  setCodeBlockFullscreen: (port) =>
    forEachEditor((handle) => handle.setCodeBlockFullscreen(port)),
  setBlockCopy: (copy) => forEachEditor((handle) => handle.setBlockCopy(copy)),
  setGotoLinePrompt: (prompt) => forEachEditor((handle) => handle.setGotoLinePrompt(prompt)),
  setMarkdownLineNumbers: (tier) =>
    forEachEditor((handle) => handle.setMarkdownLineNumbers(tier)),
  setGotoLineGutterVisible: (visible) =>
    forEachEditor((handle) => handle.setGotoLineGutterVisible(visible)),
  refreshPreview: () => forEachEditor((handle) => handle.refreshPreview()),
  revealLine: (line) => paneLayout.activeHandle().revealLine(line),
  jumpToLine: (line) => paneLayout.activeHandle().jumpToLine(line),
  readScrollPosition: () => paneLayout.activeHandle().readScrollPosition(),
  applyLoadedScrollPosition: (position) =>
    paneLayout.activeHandle().applyLoadedScrollPosition(position),
  applyScrollPosition: (position) => paneLayout.activeHandle().applyScrollPosition(position),
  focusPreservingReadingPosition: () =>
    paneLayout.activeHandle().focusPreservingReadingPosition(),
  isDirty: () => paneLayout.activeHandle().isDirty(),
  // 订阅全部经注册表（现存 + 未来 pane 都挂上；退订全局摘除）。onScroll / onDocChanged
  // 门控「仅活跃 pane」：滚动捕获与崩溃备份排期都按活跃 pane 的前台文档记账，非活跃
  // pane 的事件（程序化重载）进来会记错对象。onDirty / onSessionDirty 不门控——后台
  // 会话的 dirty 跃迁同样要重画它那 pane 的标签条与退出守卫镜像。
  onReady: (listener) => onEachEditor((handle) => handle.onReady(listener)),
  onScroll: (listener) =>
    onEachEditor((handle) =>
      handle.onScroll(() => {
        if (paneLayout.activeHandle() === handle) listener();
      }),
    ),
  onDirty: (listener) => onEachEditor((handle) => handle.onDirty(listener)),
  onSessionDirty: (listener) => onEachEditor((handle) => handle.onSessionDirty(listener)),
  onDocChanged: (listener) =>
    onEachEditor((handle) =>
      handle.onDocChanged(() => {
        if (paneLayout.activeHandle() === handle) listener();
      }),
    ),
};

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
// M316 起全部能力注入走 injectEach 注册表（现存 pane 立即施加、新 pane 重放，见其上注释）。
injectEach((handle) =>
  handle.setAttachmentProvider({
    resolveByName: (name) => resolveByNameUnique(attachmentPaths, name),
    async readDataUrl(path) {
      const base64 = await fsReadAttachment(path);
      const mime = mimeTypeOf(extensionOf(path)) ?? "application/octet-stream";
      return `data:${mime};base64,${base64}`;
    },
  }),
);

// 图片放大查看（M184，双击内联图片 → 应用内遮罩）：能力与 DOM 在 src/lightbox.ts，装配侧只给
// 它两样看不到的东西——挂点（app-shell 根，与键位面板同款）与关闭后把焦点交还编辑器。
// 遮罩 DOM 惰性建立：文档打开路径与键入路径上零新增工作。
// **交还焦点走 `editor.focusPreservingReadingPosition()`，MUST NOT 写成裸 `editor.view.focus()`**
// （M280）：把焦点放进编辑器是浏览器接管的视口动作，裸 focus 会把视口拽回光标处——浮层关闭
// 「不得改变阅读位置」是硬条款（docs/design-parity-contract/overlay-close-reading-position.md）。
const lightbox = createImageLightbox({
  mount: shell.root,
  restoreFocus: () => editor.focusPreservingReadingPosition(),
});
injectEach((handle) => handle.setLightbox(lightbox));

// 表格放大全屏查看（M240，D3 双入口：命令 + 表格 hover 触发钮）：能力与 DOM 在
// src/table-fullscreen.ts，装配侧只给它两样看不到的东西——挂点（与 lightbox / 键位面板同款）
// 与关闭后把焦点交还编辑器。遮罩 DOM 惰性建立：文档打开路径与键入路径上零新增工作。
// **M280 补齐**：这里此前是裸 `editor.view.focus()`——同一形态的第 5 个落点，M240 当时漏改
// （M279 §6 必修第 1 条）。现在与代码块/图片遮罩/键位面板走同一份原语。
// M317 2.9：遮罩打开时的**来源 pane**——关闭时焦点归还到这里，而不是机械回活跃 pane
//（遮罩打开后活跃 pane 可能已切换；design §2 行 10 的显式例外）。两条打开入口（命令 /
// 触发钮端口）都在打开前记下发起 pane；源元素本身也已按 pane 取（命令路径取活跃 pane 的
// target，触发钮路径的 widget 本就在发起 pane 的 DOM 里）。
let tableFullscreenSource: PaneId | undefined;
const tableFullscreen = createTableFullscreen({
  mount: shell.root,
  restoreFocus: () => focusSourcePane(tableFullscreenSource),
});
injectEach((handle) =>
  handle.setTableFullscreen({
    open: (source, label) => {
      tableFullscreenSource = paneIdOfHandle(handle);
      tableFullscreen.open(source, label);
    },
    close: (reason) => tableFullscreen.close(reason),
    isOpen: () => tableFullscreen.isOpen(),
  }),
);

// 代码块放大全屏查看（M277，change code-block-fullscreen；双入口：命令 +
// 代码块 hover 触发钮）。`restoreFocus` 与表格侧**形态一致**（M280 起两侧逐字同一份）：
// MUST NOT 照抄裸 `editor.view.focus()`——M274 实测证明 WebKit 下那次聚焦会把阅读位置拽回
// （scrollTop 2750 → 0，chromium 结构性看不见）。这里注入 editor 的原语（取阅读位置 → focus →
// 经编辑器滚动通道写回），见 src/scroll-position-view.ts 的 focusPreservingReadingPosition。
// M317 2.9：与表格侧同款——来源 pane 在打开时记下，关闭时焦点归还到它（不机械回活跃 pane）。
let codeBlockFullscreenSource: PaneId | undefined;
const codeBlockFullscreen = createCodeBlockFullscreen({
  mount: shell.root,
  restoreFocus: () => focusSourcePane(codeBlockFullscreenSource),
  themeScopeSource: () => editor.view.dom,
});
// 装饰层拿到的是「按块起点打开」的**端口**（不是遮罩本体）：呈现计划在点击那一刻按当前
// `EditorState` 现取，读屏名复用文档内容器同一份生成处（见 livePreview 的 codeBlockLabel）。
// M316：端口闭包必须捕获**各 pane 自己的** view——`from` 是发起 pane 的 state 里的位置，
// 经复合句柄的活跃 view 现取会在「点非活跃 pane 的触发钮」时拿错文档。
injectEach((handle) =>
  handle.setCodeBlockFullscreen({
    open(from) {
      const target = codeBlockFullscreenTarget(handle.view, from);
      if (target === null) return;
      // 来源 pane 记录（M317 2.9）：触发钮在哪个 pane 的 DOM 里，焦点就还给哪个 pane。
      codeBlockFullscreenSource = paneIdOfHandle(handle);
      codeBlockFullscreen.open(target.render, target.label);
    },
  }),
);

// 块级复制（M277，change block-copy-affordance）：触发钮与 `block.copy` 命令共用一个口子，
// 内容口径只有一处（`src/preview/block-copy.ts`）。剪贴板走既有纯前端通道
// （navigator.clipboard.writeText，M244 已实证），零插件、零后端命令、零 capabilities 增量。
// M316：与代码块全屏端口同一条理由，复制口子的闭包捕获各 pane 自己的句柄（range 锚在
// 发起 pane 的 state 上）。
injectEach((handle) =>
  handle.setBlockCopy({
    copy: (range: BlockCopyRange) => void copyBlockContent(handle, range),
  }),
);

/** 文档代际变化（前台文档被就地重载）后，**内容取自旧一份文档**的浮层退出（M286）。
 *
 *  两份全屏遮罩的快照都是**打开那一刻**渲染态 DOM 的深克隆（`src/table-fullscreen.ts` /
 *  `src/code-block-fullscreen.ts` 的 load）：文档换代之后继续挂着就是展示一份已不存在的内容。
 *  改前这里只有遮罩自己的 blur 兜底，而注释声称它兜住「文档代际变化」——M279 的 T6 实测
 *  **从不触发**（重载不移动焦点，遮罩一直持焦）。现在是显式信号（`documentReplaced` 这条 dep）
 *  + 显式关闭，关闭路径是共用的 `document`（交还焦点，键盘回到正文，与三条用户路径同口径）。
 *
 *  关闭是空操作安全的：遮罩没开时 `close` 直接返回。
 *
 *  **图片遮罩（lightbox）不在这里**：它是同一族（放大图复用内联 `<img>` 的 src，文档换代后
 *  那份 DOM 可能已不在），但 `ImageLightbox` 的对外面只有 `open`——没有关闭口子，且它的状态机
 *  是 M184 留下的**第二份实现**（未走 src/overlay-state.ts）。收它要动公开接口与那份重复状态机，
 *  不在本 mission 的射程内，已按纪律登记残余（docs/backlog.md 的 M280 节）。 */
function closeDocumentOverlays(): void {
  tableFullscreen.close("document");
  codeBlockFullscreen.close("document");
}

// 跳转到行（M281，change goto-line-command）：能力与浮层 DOM 在 src/goto-line.ts，装配侧给它
// 三样看不到的东西——挂点（`shell.modeline`，与 .lumir-toc 同挂点同定位：浮层贴 modeline 上沿
// 向上展开）、确认回调（编辑器的 `jumpToLine`：先把焦点交还编辑器再走既有 `revealLine`，
// 落点算式只有一处）、以及取消 / 收起时的交还焦点（`focusPreservingReadingPosition`——
// **MUST NOT 裸 `editor.view.focus()`**：浮层关闭不得改变阅读位置，见 src/scroll-position-view.ts）。
// 浮层 DOM 随装配建立（一次性），打开 / 收起只是 hidden 翻转：文档打开路径与键入路径零新增工作。
// M317 2.8：`onJump` 解析到**活跃 pane** 的 `jumpToLine`（复合句柄）；输入条打开期间前台会话
// 变化（含**跨 pane 切换**）的失效路径复用既有「不跨会话跳转」口径——`syncActiveDocument` 是
// 唯一同步点，切 pane / 切标签都会 `gotoLine.close()`（收起且不跳转），cross-pane 因此天然走同
// 一条失效路径，不需要第二条判据。
const gotoLine = createGotoLinePrompt({
  mount: shell.modeline,
  onJump: (line) => editor.jumpToLine(line),
  restoreFocus: () => editor.focusPreservingReadingPosition(),
  // `on-demand` 档（md 行号 gutter 的默认档，D4 二次改判）下 gutter 随输入条装 / 卸：
  // 装配层只做「把在场状态转给编辑器」这一件事，安装与卸除的判据在 editor.ts 的
  // `mdGutterExtensions()`（单一来源）。
  onVisibilityChange: (open) => editor.setGotoLineGutterVisible(open),
});
injectEach((handle) => handle.setGotoLinePrompt(gotoLine));

/** 块级复制的反馈文案（文案 deck D154 / D155）。块类型词只写一处：这里的「表格 / 代码块」与
 *  `block-trigger.ts` 的 `blockCopyLabel`（D153 读屏名）取自同一对词，读屏名与 toast 因此不会
 *  各写一份（改一处即两处同步）。 */
const COPIED_TABLE_TOAST = (): string => t("D154", { block: t("D203") });
const COPIED_CODE_BLOCK_TOAST = (): string => t("D154", { block: t("D204") });
const COPY_BLOCK_FAILED_TOAST = (reason: string): string => t("D155", { reason });

/**
 * 复制一个块的内容（M277）：内容在**触发那一刻**从当前 `EditorState` 现取（不缓存文本——
 * 装饰重建 / 外部重载后取到的就是最新文档），写剪贴板 + toast 反馈。
 *
 * 成功 = success tone 的 D154（与「已复制完整路径」D137 同族）；失败（剪贴板不可用 / 权限被拒）
 * 给 D155 的 toast 并另记一条 console 线索（M244 同款处置：诊断事件名是 Rust 侧白名单，
 * 不借一个语义不符的既有事件名）。MUST NOT 静默。
 */
async function copyBlockContent(handle: EditorHandle, range: BlockCopyRange): Promise<void> {
  const text = blockCopyText(handle.view.state, range);
  const done = range.kind === "table" ? COPIED_TABLE_TOAST() : COPIED_CODE_BLOCK_TOAST();
  // console 线索里那个块类型词与上屏同源（同一个表条目），只是日志面固定用中文取值——
  // 诊断文本不进语言面，但**不另写一份字面量**（同一条串两处真源正是 REVIEW.md 第 8 条要防的）。
  const noun = t(range.kind === "table" ? "D203" : "D204", undefined, "zh");
  try {
    await navigator.clipboard.writeText(text);
    toast(done, [], false, "success");
  } catch (e) {
    const reason = errorMessage(e);
    console.warn(`lumir: 复制${noun}失败：${reason}`); // i18n-exempt: log
    toast(COPY_BLOCK_FAILED_TOAST(reason));
  }
}

// 栏宽拖拽手柄（M228，change content-width-drag）：DOM 在 shell（编辑器 pane 的覆盖层），
// 控制器在 src/content-width.ts；装配侧给三样东西——当前宽度的读写口（editor 闭包真源）、
// 松手后的持久化（D3：通用键值合并写命令 config_set_ui_value，写失败降级为 toast + 诊断
// 日志，运行期宽度**不回滚**——与 remember_last_vault 的「主结果不受写失败影响」同口径）。
const widthDrag = createContentWidthDrag({
  // 坐标参照系 = pane A 挂载元素（覆盖层就挂在它里面；M316 容器化后下沉一层，几何不变）。
  // 栏宽手柄只有 pane A 槽这一套：栏宽是全局 token，双栏时手柄留在 root pane（已知过渡
  // 形态，记录在 M316 完成报告）。
  pane: shell.editorPane,
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
//
// M317 2.6：提示**点名跟随活跃 pane**——`showNotice` 的文案由打开动作给的 path 派生（打开 /
// 重载的落点就是活跃 pane），隐藏的是 `editor.view.dom`（活跃 pane 的前台视图）。覆盖层是
// `shell.editor` 上的 `inset: 0` 整块遮罩，双 pane 下会临时盖住两栏（转瞬即逝的装载提示），
// 单 pane 常态逐像素不变；跨 pane 的批量提示（切 vault 守卫）维持既有「数量 + 当前 vault」
// 口径，取的是全部 pane 的 dirty 并集（save.vaultSwitchBlock），逐路径键控不变。
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
//
// M254 起多一个尾部参数 `onDismiss`：**sticky 浮条被点掉**（用户没有选任何出口、只把
// 浮条关掉）时通知调用方。批量关闭（标签右键菜单的「关闭其他 / 右侧」）靠它知道该停手：
// 那条路径逐个问脏标签，用户点掉浮条等于「没答复」，后面的标签一律不动。动作钮的点击
// MUST NOT 走这一路（见下面的 stopPropagation），因此它只表示「浮条被点掉」这一种情形。
// 自动消隐的浮条不通知——它们没有「被用户点掉」以外的生命周期事件可报。
type ToastTone = "neutral" | "success";
function toast(
  text: string,
  actions: Array<{ label: string; run(): void }> = [],
  sticky = false,
  tone: ToastTone = "neutral",
  onDismiss?: () => void,
): HTMLElement {
  if (sticky) {
    for (const el of shell.editor.querySelectorAll<HTMLElement>(".lumir-toast[data-sticky-text]")) {
      if (el.dataset.stickyText !== text) continue;
      // M254（reviewer r1 P2-1）：去重命中时返回的是**旧**元素，本次调用的 actions / onDismiss
      // 一律不接上线。对「关标签确认」那条链路（`src/tabs.ts` 的 showCloseConfirm）这等于
      // **本次提问拿不到自己的答复**：它在批量关闭里等的是「这个标签关掉了没有」，而答复挂在
      // 本次调用的回调上。就地调用 onDismiss 把这件事如实报回去——调用方按「没答复」处理
      //（`settle(false)`），批量在该标签之前干净停手，MUST NOT 静默挂起一个永不 resolve 的
      // 批量动作。其余 sticky 调用方不传 onDismiss，行为一字不变。
      onDismiss?.();
      return el;
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
    btn.addEventListener("click", (event) => {
      // 动作钮的点击不得冒到浮条本体那条「点掉即关闭」的监听上（M254）：那条现在还要
      // 通知 onDismiss，而钮已经给出答复（选了某个出口）。少了这一行，「保存并关闭」这条
      // 异步出口会被紧随其后的 done(false) 抢先作废——批量关闭在保存落地前就停手了。
      event.stopPropagation();
      el.remove();
      action.run();
    });
    el.append(btn);
  }
  if (sticky) {
    el.dataset.stickyText = text;
    el.addEventListener("click", () => {
      el.remove();
      onDismiss?.();
    });
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
  // 落点意图在这里收敛（M254）：save-controller 的 `OpenIntent` 里还留着 "preview" /
  // "pinned" 两个取值（它不在本 mission 的改动面内），但它实际只在「另存为新文件 / 恢复
  // 崩溃备份」两条链路上传值，而那两条都是 "current"（当前这份文档换个落点）。非 "current"
  // 一律按「新开一个标签」处理——预览机制退场后，"pinned" 与 "preview" 的差别（会不会被
  // 下一次单击顶掉）已经不存在，两者落到同一个落点。等 save-controller 的 union 收窄成
  // `"current"`（或删掉这个参数）后，这一层适配可以整个删掉。kind 也在这里现取——落点路径
  // 已确定，分类归扩展名注册表（`openKind`），save-controller 不持第二份判据。
  openFile: async (path, intent) => {
    await openFile(path, openKind(path), intent === "current" ? "current" : "new");
  },
  invalidateResolve: () => linkFollow.invalidate(),
  showEditor: () => showEditor(),
  isNoticeHidden: () => notice.hidden,
  // 外部改写 / 冲突放弃的**就地重载**（M286）：这一路不走 openFile，因此阅读位置与遮罩收口
  // 都必须在重载处补上——前者与 openFile 的 `restoreFor` 是同一个 store 的同一条口子，
  // 后者见下面 `closeDocumentOverlays` 的说明。
  restoreReadingPosition: (path) => readingPositions.restoreFor(path),
  documentReplaced: () => closeDocumentOverlays(),
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
  // M317 2.1：内容源活读**活跃 pane** 的 view（构造期不再钉死 root）。刷新挂钩经
  // trackEachView 挂到每个 pane 的视图上（含未来 pane），跨 pane 切换由 syncActiveDocument
  // 调 toc.sourceChanged() 即时换源。
  view: () => editor.view,
  indicator: shell.modelineSection,
  mount: shell.modeline,
  hasFile: () => save.displayedPath() !== undefined,
  // 活读前台会话的模式与路径（切标签 / 切 vault 后自动跟上）：语言名只在这里派生一次，
  // toc 侧不再自己从路径推。
  context: () => {
    const session = editor.activeSession();
    return {
      mode: session.mode,
      language: session.path === undefined ? null : codeLanguageOfPath(session.path),
    };
  },
  toast,
});
// 大纲的视图更新挂钩挂到每个 pane 的视图上（现存 root + 未来 pane 由 viewTrackers 重放）：
// 非活跃 pane 的事件也挂着，等它成为活跃 pane 后立刻可捕获。
trackEachView((view) => toc.track(view));

editor.onReady((event) => {
  emitReadiness(event.phase, event);
});

// ---------------------------------------------------------------------------
// 标签（M149）：会话模型、标签栏 DOM、切换 / 关闭动作与标签右键菜单（M254）在
// src/tabs.ts，这里只装配——把本文件才知道的入口交给它（save / 解析缓存失效 / 覆盖层 /
// 同步点 / 浮层挂点 / 提示出口 / 树定位（M300），逐项见 TabsDeps）。
// M316 起实例恒经 createPaneTabs 产出（每 pane 一个，口径见该函数注释）；窗口级命令
// 走 activeTabs()（活跃 pane 的标签条），跨 pane 激活走 activateSessionInOwnerPane。
// ---------------------------------------------------------------------------

const rootPaneAssembly = paneAssemblies.get(1);
if (rootPaneAssembly === undefined) throw new Error("main: root pane 装配记录缺失"); // i18n-exempt: log
rootPaneAssembly.tabs = createPaneTabs(1, rootPaneAssembly.handle, rootPaneAssembly.stripEl);

// ---------------------------------------------------------------------------
// 多 vault 切换器（M163，change multi-vault-workspaces 的 3.x / 4.x）：列表浮层、切换流程的
// 请求侧、按 vault 的标签会话与装载后恢复都在 src/vault-switcher.ts。这里只装配它看不到的
// 东西：树头部入口、当前 vault 的打开链路（dirty 前置门 + vault_open_path + 装载）、
// 会话的 ipc、以及恢复时装载内容的那条既有链路（openFile）。
// ---------------------------------------------------------------------------

/** 空 vault 首入态的引导（文案 D107）：装载完成而一个标签都没能恢复出来时，正文给一句
 *  指路，不伪造内容（也不残留上一次 vault 的正文——那已被 editor.reset 作废）。 */
const EMPTY_VAULT_TEXT = (): string => t("D107");

// ---------------------------------------------------------------------------
// 装载的即时反馈与阶段读数（M252，Alex 真机反馈原话：「切换 vault 时，会卡住几秒。我会愣住，
// 以为刚才点击没点中，然后才出现系统的转圈提示，我才明白在加载中」）
// ---------------------------------------------------------------------------

/** 装载指示：标题栏右端的无文案转圈（形态与口径在 src/vault-switcher.ts 的工厂里）。
 *  **常态 hidden**，只在「用户发起的装载 + 它之后的会话恢复」这一段出现——空闲态的标题栏
 *  布局与像素逐值不变。 */
const vaultLoading = createVaultLoadingIndicator(shell.titlebar);

/** 装载阶段的耗时读数（定位「几秒卡在哪一段」，读法见下面的 phaseMs）。
 *  阈值取 250ms：低于它的装载在真机上感知不到等待，记下来只会稀释日志。 */
const VAULT_PHASE_SLOW_MS = 250;

/** 把一段装载阶段的耗时落进诊断日志：只在超过阈值时写一条 `slow_callback`（既有事件名 +
 *  白名单字段 name/ms，不新增事件、不动 Rust 侧——与 src/toc.ts 的 code_structure_parse
 *  同一条通道）。读数落在 `<config>/lumir/logs/*.jsonl` 里 grep `vault_load` 即可，
 *  Alex 真实 vault 上的「几秒」也能因此就地量出来，不必等 agent 复现。
 *
 *  `always` 用于**本 change 动过的那一段**（恢复段，M283）：阈值口径下「变快了」会表现成
 *  「日志里没有这一行」，与「这一段没跑」不可区分——改动的卖点因此无法被读数证明。其余段
 *  （open / tree）沿用阈值：它们不因本 change 改变，读数用 release harness
 *  （`src-tauri/tests/vault_open_readings.rs`）量。 */
function phaseMs(startedAt: number, name: string, always = false): void {
  const ms = performance.now() - startedAt;
  if (!always && ms <= VAULT_PHASE_SLOW_MS) return;
  logEvent("slow_callback", { name, ms: ms.toFixed(1) });
}

/** 用户发起的装载共用一层壳：起指示 → run → 失败时立刻收（失败路径上不会有会话恢复，
 *  指示必须由这里撤下）。**成功路径的收口不在这里**——它挂在装载后的会话恢复跑完那一刻
 *  （见 applyVault 尾部）：会话恢复（建壳 + 激活项的内容装载）是异步的，而 M283 之前 Alex
 *  感知到的「卡住几秒」正落在「逐标签装载内容」这一段（现在只剩一次装载），
 *  指示要盖住它才算「加载完成才消失」。 */
async function loadUserVault(run: () => Promise<void>): Promise<void> {
  vaultLoading.begin();
  try {
    await run();
  } catch (e) {
    vaultLoading.end();
    throw e;
  }
}

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
  // 「保存并切换」的写盘段：只在这里补一条读数（`vault_load_flush`，M283 的 1.1）。
  // 干净路径不走这里，因此不会出现这条读数——「有没有写盘」与「有没有这条读数」一一对应。
  saveAll: async () => {
    const startedAt = performance.now();
    try {
      return await save.saveAllDirty();
    } finally {
      phaseMs(startedAt, "vault_load_flush");
    }
  },
  // 写盘段的指示窗口（M283 的 2.1）：同一个引用计数与装载壳共用，因此「写盘 → 装载 → 会话
  // 恢复」是一个连续在场的窗口（两段之间的交接见 vault-switcher.ts 的 saveThenRun）。
  saveAllWindow: vaultLoading,
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
  // 用户发起的装载：装载指示从「作为新 vault 打开」这个动作的时点起（M252）。
  openPath: async (path) => {
    await loadUserVault(async () => {
      const opened = await vaultOpenPath(path, true);
      await applyVault(opened.root, opened.entries, opened.vault_id, false);
    });
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
  // 入盘快照的输入（M318）：逐 pane 的会话与前台路径 + 分隔比例，全部活读装配层的真实状态。
  // 前台路径取该 pane 的前台标签（与 `save.displayedPath()` 同源——它也是活跃 pane 的前台，
  // 只是这里**逐 pane** 取，不另存一份副本）。
  layout: () => ({
    panes: paneLayout.panes().map((pane) => ({
      sessions: pane.handle.sessions(),
      activePath: pane.handle.activeSession().path,
    })),
    ratio: splitRatio,
  }),
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
  putSession: (vaultId, panes, ratio) => vaultSessionPut(vaultId, panes, ratio),
  // 会话恢复的「在不在 vault 内」同样补一次批量存在探测（spec「装载后恢复标签列表」）：
  // 惰性条目不在枚举结果里，但它们是真文件——用户从 `.local` 打开的教程下次启动照常回来。
  pathsExist: (paths) => fsPathsExist(paths),
  // 恢复前把 pane 布局摆成存储的形状（M318 tasks 5.3 的第一步；单 pane 存储不出第二 pane）。
  applyPaneCount,
  // 会话恢复的第一步（M283 的 3.2）：**当帧建壳**——为每个条目建一个「有路径、内容未装载」的
  // 标签，落进**它自己所属的那个 pane**（M318：按 pane 恢复；此前恒落 root，见下游注释）。
  // 不可打开的文件类（image/binary）不成壳，交回 store 计入跳过数（与它此前必然装载失败同
  // 口径，行为不变）。
  createShell: (path, pane) => {
    if (openKind(path) === "binary") return false;
    const target = paneLayout.panes()[pane];
    if (target === undefined) return false;
    target.handle.createShellSession(path);
    return true;
  },
  // 壳建齐的一拍把标签栏刷成完整列表（`syncActiveDocument` 是渲染标签栏的唯一落点）。
  shellsBuilt: () => syncActiveDocument(),
  // 装载**文档内容**（恢复时只对激活项与它的退化候选调用；其余标签留到首次成为前台）：
  // 走既有打开链路，壳态标签落进它自己的会话（`openFile` 的壳态分支），不新建标签；
  // `quiet` 为真时不上屏失败覆盖层——批量路径的失败由一次计数提示承担。
  // 键名 `openPinned` 由 vault-switcher 的 deps 定；落点意图按 M254 的新口径取 "new"——
  // 每个文件新开一个标签（壳态命中时不新开：`openFile` 按 path 命中已在会话里的壳，装进它
  // 自己所属的 pane）。`pane` 是条目所属 pane 的下标，作为**显式落点**交给 openFile：
  // 恢复装载因此不走「打开意图落在活跃 pane」，标签归位原 pane（M321）。
  openPinned: (path, pane) => openFile(path, openKind(path), "new", true, pane),
  activate: (path) => {
    const session = editor.sessionForPath(path);
    if (session !== undefined) activateSessionInOwnerPane(session);
  },
  onEmptyVault: () =>
    // 一个标签都没恢复出来时的落点。两种到达方式（M283 起）：
    //   1. 会话里没有任何可用条目（或本来就没有历史）⇒ **空 vault 首入态**：标签栏本来就空
    //      （没有会话就一个壳都不建），正文给一句 D107 的引导；
    //   2. 壳建出来了、但激活项与全部退化候选的正文都读不出来（例如会话里只有超过读取上限的
    //      大文件）⇒ 标签栏里确实有标签，**不说「还没有打开的文件」这句假话**，只撤下覆盖层
    //      让标签栏自己说话（每个标签的真实状态在它被点开时由打开链路的既有提示呈现——
    //      那时 `quiet=false`，失败会上屏）。
    editor.sessions().some((session) => session.path !== undefined)
      ? showEditor()
      : showNotice(EMPTY_VAULT_TEXT()),
  warn: (text) => toast(text),
});

// ---------------------------------------------------------------------------
// 文件树条目操作（M244，change file-tree-context-menu）：右键菜单、内联编辑提交、删除确认
//
// 分工：菜单浮层 / 确认框 / 改名回响抑制在 src/tree-menu.ts（无 ipc 依赖、可单测），内联
// 编辑的行 DOM 在 src/tree.ts，**动作**在这里——只有装配层同时拿着 vault 根、编辑器会话与
// 保存链路。三个共同点：
//   1. 全部经后端 command 落地（ADR 0002 §3：webview 不直接触文件系统），唯一例外是
//      「复制完整路径」（纯剪贴板，spec 明确零新命令）；
//   2. 成功后的**树**一律等 watcher 回响收敛（唯一收敛通道，不自绘补丁——design §4.7），
//      唯一例外是新建文件的自动打开（走读取链路，与树展示解耦）；
//   3. 失败一律 toast 人话（后端错误信封的 message 已是人话），MUST NOT 静默。
// ---------------------------------------------------------------------------

const renameEcho = createRenameEchoGuard();

const treeMenu = createTreeContextMenu({
  mount: shell.root, // 与 vault 浮层同一挂点：左栏容器 overflow:auto，挂进去会被裁掉
  onSelect: (action, target) => runTreeAction(action, target),
});

/** 确认框正在问的那一条（打开时写入，动作完成 / 取消后清空）。 */
let trashPending: TreeMenuTarget | undefined;

const trashConfirm = createConfirmDialog({
  mount: shell.root,
  onConfirm: () => {
    const target = trashPending;
    if (target !== undefined) void trashEntry(target.path);
  },
  // 焦点归还触发菜单的那一行（对话框关闭即调用；确认路径也在其列）。
  restoreFocus: () => trashPending?.anchor.focus(),
});

/** 菜单动作分发：每个动作只做「起编辑 / 起确认 / 调命令」三件事之一（判定不在这一层）。 */
function runTreeAction(action: TreeMenuAction, target: TreeMenuTarget): void {
  switch (action) {
    case "rename":
      tree.beginRename(target.path);
      return;
    case "new-file":
      tree.beginCreate(target.path, "file");
      return;
    case "new-dir":
      tree.beginCreate(target.path, "dir");
      return;
    case "copy-path":
      void copyVaultPath(target.path);
      return;
    case "reveal":
      void revealInFinder(target.path);
      return;
    case "trash":
      trashPending = target;
      trashConfirm.open({
        title: TRASH_CONFIRM_TITLE(),
        // 目录那一档明示「连同其中全部内容」（裁决点 2 的护栏：删除必须两步 + 可恢复）。
        body:
          target.kind === "dir"
            ? TRASH_CONFIRM_DIR_BODY(target.name)
            : TRASH_CONFIRM_FILE_BODY(target.name),
        confirmLabel: TRASH_CONFIRM_OK(),
        cancelLabel: DIALOG_CANCEL(),
      });
      return;
  }
}

/**
 * 复制完整路径（裁决点 4 = 绝对路径）：纯前端剪贴板通道，零后端命令、零 capabilities
 * 增量（spec）。拼接只有一处（`tree.ts` 的 `vaultAbsolutePath`，MUST NOT 在这里再拼一次）。
 *
 * 失败（剪贴板不可用 / 权限被拒）给 toast 人话——不引剪贴板插件。design §5.2 的既定退路
 * 是「行为契约不变地换一条通道」（后端 command + 剪贴板插件），但那条路只在真机实证
 * WKWebView 拒绝时才走；真机场景 47 的剪贴板断言就是这条实证的落点。失败另记一条
 * console 线索：诊断事件名是 Rust 侧的白名单（`logging.rs`），新增名字不在本 change 的
 * 改动面内，因此不借一个语义不符的既有事件名。
 */
async function copyVaultPath(rel: string): Promise<void> {
  const root = loadedRoot;
  if (root === undefined) return; // 未装载 vault 时树不存在，菜单不可能出现（防御性）
  const absolute = vaultAbsolutePath(root, rel);
  try {
    await navigator.clipboard.writeText(absolute);
    toast(COPIED_PATH_TOAST(), [], false, "success");
  } catch (e) {
    const reason = errorMessage(e);
    console.warn(`lumir: 复制路径失败（${rel}）：${reason}`); // i18n-exempt: log
    toast(COPY_PATH_FAILED_TOAST(reason));
  }
}

/** 在 Finder 中显示（§3.4）：只读动作，无 watcher 联动（不产生文件系统变更）。 */
async function revealInFinder(rel: string): Promise<void> {
  try {
    await fsRevealInFinder(rel);
  } catch (e) {
    toast(errorMessage(e));
  }
}

/**
 * 移到废纸篓（裁决点 2）：删除经确认框已是两步，这里只负责调命令与失败提示。
 * 成功的**表现**由 watcher 的 deleted 统一收敛：树节点消失（级联子孙）、命中打开中的
 * 文档时走既有的 `handleExternalChange`（sticky「内容未丢失」，不特判、不抑制——
 * design §3.1）。失败则本就没有事件，提示里明说「未删除任何内容」。
 */
async function trashEntry(rel: string): Promise<void> {
  try {
    await fsTrashEntry(rel);
  } catch (e) {
    toast(errorMessage(e));
  }
}

/**
 * 内联编辑提交（重命名 / 新建共用）：不管成败都经 `tree.endInlineEdit` 回到那一行——
 * 成功退出编辑态（新名由 watcher 回响收敛），失败留在编辑态并标红（后端是权威，前端的
 * 即时校验只是先手）。重命名另有 tab 联动（裁决点 5），见下面两条分支的注释。
 */
async function submitInlineEdit(request: InlineEditRequest): Promise<void> {
  if (request.mode === "rename") {
    const predicted =
      request.parentRel === "" ? request.name : `${request.parentRel}/${request.name}`;
    // 抑制登记在 **invoke 发起时**（不是成功返回后）：in-flight 窗口内到达的真实外部事件
    // 必须照常归因，失败即撤（回滚消除乱序窗口）。登记的是预测的新路径——与后端
    // `rename_entry` 的返回值同一个公式（`join_rel(parent_rel, new_name)`）。
    const cancelEcho = renameEcho.register(request.path, predicted);
    let renamed: string;
    try {
      renamed = await fsRenameEntry(request.path, request.name);
    } catch (e) {
      cancelEcho();
      tree.endInlineEdit(false, errorMessage(e));
      return;
    }
    // 打开中的文档就地 remap（裁决点 5）：dirty 内容、revision 基准（改名不改字节，CAS
    // 依旧有效）、滚动与光标全部保留；扩展名变化时 mode / editable 由 remap 内部重裁。
    // 返回的路径对逐条喂给保存链路（M278 r1 的第五条路径）：它的 revision 基准与崩溃备份
    // 同样按路径键控，而改名换的正是那个键——不迁的话新路径会落到「未登记磁盘版本」的
    // 不可保存态，旧路径那份备份成为孤儿（下次启动弹一个打不开的恢复提示）。
    // 目录改名时 remap 逐会话给出前缀替换后的新路径，这里天然是批量。
    for (const remap of editor.remapSessionPaths(request.path, renamed)) {
      save.noteRenamed(remap.from, remap.to);
    }
    tree.endInlineEdit(true);
    // 表现层一次对齐：modeline 的路径段、标签栏可见文本与 `dataset.path`、树高亮、标签
    // 会话落盘、阅读位置 flush——「当前文档」在装配层的唯一同步点。
    syncActiveDocument();
    return;
  }

  try {
    if (request.mode === "create-file") {
      const created = await fsCreateFile(request.parentRel, request.name);
      tree.endInlineEdit(true);
      // 新建文件成功即自动打开（§3.5）：**不等 watcher 回响**——打开走读取链路，与树的
      // 展示互不依赖。意图取 "new"：新建是用户的显式动作，值得一个自己的标签（M254 起
      // 「自己的标签」就是唯一的标签形态——预览机制已退场，但落点意图仍要显式写出来：
      // openFile 的默认值是 "current"，那是「就地替换前台文档」）。
      // md / 其余类型由 openKind 一处裁决。
      void openFile(created, openKind(created), "new");
      return;
    }
    await fsCreateDir(request.parentRel, request.name);
    tree.endInlineEdit(true);
    // 新建子目录不自动展开、不自动打开（§3.6）：条目由 watcher 回响收敛进树。
  } catch (e) {
    tree.endInlineEdit(false, errorMessage(e));
  }
}

// ---------------------------------------------------------------------------
// 文档阅读位置（M194，change remember-reading-position 的 3.x / 4.x）：跨会话记住阅读位置的
// 捕获侧与恢复侧。判定、防抖、清理与上限都在 src/reading-position.ts（无 DOM、可单测），这里
// 只装配它看不到的东西：编辑器的两个口子、ipc、以及三个 flush 时点。
// ---------------------------------------------------------------------------

/** 阅读位置的存储。`activePath` 与标签会话取同一份（前台标签是哪一个），不再各自存副本。 */
const readingPositions = createReadingPositionStore({
  activePath: () => save.displayedPath(),
  readPosition: () => editor.readScrollPosition(),
  // 装载口径（M280 拆开）：装载复位之后读数取在 scrollTop = 0 上，落点 ≤ 0 即「这条历史就是
  // 篇首」，静默不施加（保 M110 的页首内边距）。运行期那条（切标签 / 交还焦点）的口径不同，
  // 见 `applyScrollPosition`——两者不可互换。
  applyPosition: (position) => editor.applyLoadedScrollPosition(position),
  getPositions: (vaultId) => readingPositionGet(vaultId),
  putPositions: (vaultId, entries) => readingPositionPut(vaultId, entries),
  // 「这个路径还在不在 vault 里」的**批量**读口（change vault-open-ignore-set §4.11）：装载时的
  // 枚举结果不再是 vault 内文件的全集——被 vault 自己的忽略声明挡住的惰性文件在树里可见、
  // 可打开，却永不进枚举，它们的阅读位置 MUST NOT 每次装载都被剪掉。
  pathsExist: (paths) => fsPathsExist(paths),
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
  // 跳转到行的输入条**不跨会话**（M281）：落点行号只对打开时那份文档有意义，前台文档一换就
  // 收起且不跳转（切标签 / 被外部打开请求置换两条路径都汇到这里）。收起时把焦点交还编辑器
  //（用户接下来的按键应落在新文档上；`focusPreservingReadingPosition` 不改变阅读位置）。
  gotoLine.close();
  // resolve 的 from 基准不在这里同步：它由 link-follow.ts 的 resolveBase() 活读前台会话
  //（见那边的注释，那份副本曾在装载时序上造成一整批 wikilink 停在 pending）。
  syncDirtyIndicator();
  syncModelineMeta();
  syncBackendDirty();
  // 指示段与文档同一帧到位（不落在 120ms 节流窗口之后）：见 TocHandle.refresh 的说明。
  toc.refresh();
  // 大纲浮层打开期间活跃 pane / 前台文档变化 ⇒ 内容源即时换源（M317 2.1；未打开时 no-op）。
  toc.sourceChanged();
  tree.setCurrentPath(session.path);
  // 会话切换后栏宽手柄重新贴合列缘（模式 / gutter 进出只改列位置不改列宽，控制器自己的
  // ResizeObserver 看不见位置变化）。
  widthDrag.reposition();
  // 标签账本与各 pane 会话表对齐（M317 标签级接线）：这是「标签集合 / 归属变化」的唯一同步点，
  // 开 / 关 / 移动标签与实例内部建会话都汇到这里。
  reconcilePaneLedger();
  renderAllTabStrips();
  // 标签集合 / 顺序 / 激活项变化后防抖落盘会话（M163）。挂在这个唯一同步点上：切标签、
  // 开文件、关标签都会经过它，别处不必各埋一个「记得写会话」的钩子。
  switcher.sessionChanged();
  // 阅读位置与标签会话同一批 flush（M194，task 3.4）：这是「切文件 / 切标签」在装配层的唯一
  // 同步点，滚动停止后的防抖是主路径、这里是补漏——MUST NOT 只依赖定时器（切走之后没有第二次
  // 机会），也 MUST NOT 只依赖退出路径（那条路径的 invoke 是异步的，可能赶不上界面拆除）。
  void readingPositions.flush();
  // 壳态标签（vault 会话恢复的第一步的产物）首次成为前台时装载它的内容（M283 的 3.5）。
  // 挂在这一个同步点上：标签点击 / ⌃⇥ 轮换 / 关标签后的相邻激活 / 树里点开一个已在会话里的
  // 文件，全部经过它——别处不必各埋一个「记得装载」的钩子。
  ensureActiveSessionLoaded();
}

/** 装载完成后的表现层对齐（打开 / 重载共用）。
 *  解析缓存失效不在这里：它必须发生在装载**之前**（openFile 里 reloadSession 的前一句），
 *  否则会抹掉装载事务里刚发起的在途 resolve，mtime 到达后的重建会重复查询（M227）。 */
function afterLoad(): void {
  showEditor();
  syncActiveDocument();
}

// 打开文件：读出文本交给内核装载——模式裁决（以扩展名注册表为唯一事实源：
// .md/.markdown → md 模式；其余已打开的文件一律 code，含未知扩展与 basename
// 无点的文件，M130 方向 A）和附件相对路径解析依赖的 currentFilePath 都在内核里完成
//（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
//
// 可编辑性同源于注册表（editable-non-md-files）：md / code / text 三类进可编辑 code/md
// 模式并登记磁盘 revision；image/binary 按 kind 在下面提前分流（fileClass 的 image/binary
// 两类的 openKind 都是 "binary"），因此不在这里重复判定。
//
// 落点由 intent 决定（M254 起只剩两个取值，预览机制已退场）：
//   - "current"（**默认值**）：当前标签跟随换文档——文档内链接跟随 / 另存为新文件 /
//     恢复备份三条链路都是「当前这份文档换个落点」，也是「不传就退化成 M149 之前的
//     行为」这个保守兜底；
//   - "new"：新开一个标签（单击 / 双击 / ⌘-点击文件树、新建文件后的自动打开、会话恢复）。
//
// `targetPane`（pane 下标，缺省 undefined）是**显式落点**，只有会话恢复批量路径传它（M321）：
// 命中他 pane 已开的同文件时，落点取这个指定 pane 而不是活跃 pane——恢复期活跃 pane 是后建的
// 右 pane，用活跃 pane 判定会把左 pane 的激活项「打开即移动」抢走。缺省 = M317 4.2 的「一切
// 用户打开意图落在活跃 pane」。
//
// 返回「这次打开是否成功」——只有 M163 的会话恢复读它（M283 起：**只有激活项那一次**，失败时
// 按存储顺序退化到下一个候选；其余标签的内容留到首次成为前台）。
// `quiet` 为真时**不上屏失败覆盖层**：批量路径里单个文件的失败由一次计数提示承担
//（spec：跳过并给一次计数提示）；其余调用方沿用既有表现，不看返回值。
async function openFile(
  path: string,
  kind: "md" | "code" | "text" | "binary",
  intent: "new" | "current" = "current",
  quiet = false,
  targetPane?: number,
): Promise<boolean> {
  // 壳态标签（vault 会话恢复建出来、内容还没装载，M283 的 3.1）：把内容填进**它自己**的
  // 标签，不新建标签（标签栏点击那条路径另有触发点，见 ensureActiveSessionLoaded）。
  const existing = editor.sessionForPath(path);
  // 唯一保留的 dirty 守卫：前台是**未命名文档**（没有路径）。它的内容没有落盘基准，
  // 就地替换等于丢弃草稿，另开标签又会让草稿失去落点——沿用 M130 的守卫与文案。
  // 有文件路径的标签之间是标签切换，不丢内容，因此不设守卫（M149 的语义变化，
  // 见 openspec change add-multi-tabs 的 proposal「语义变化」一节）。
  //
  // 壳态分支排在它**之后**：走这条分支的动作（树里点开一个已在会话里的文件）与「点一个已打开
  // 的文件」是同一件事的两态，守卫口径必须一致；会话恢复那条批量路径进入时前台是装载刚复位出的
  // 空文档（clean），守卫照常放行。
  if (editor.activeSession().path === undefined && !save.guard(t("D209"))) return false;
  // M317 4.2：在活跃 pane 里的「打开」意图命中**他 pane 已开的同文件**时执行**移动**（源 pane
  // 失去它、目标 pane 前台变为它），而不是只把活跃指针切过去；链接跟随命中已开文件同样移动并
  // 激活，当前标签保留。移动不重建 state（见 moveSessionToPane）。
  // M321：落点改用「显式 targetPane（会话恢复）或活跃 pane（用户打开）」——恢复装载条目都在
  // 自己所属的 pane 里建好了壳（owner === target），此判定因此不移动，标签归位原 pane。
  if (existing !== undefined) {
    const ownerId = paneEntryOfSession(existing)?.[0];
    const targetPaneId =
      targetPane === undefined ? paneLayout.active().id : paneLayout.panes()[targetPane]?.id;
    if (targetPaneId !== undefined && ownerId !== undefined && ownerId !== targetPaneId) {
      moveSessionToPane(existing, targetPaneId);
    }
  }
  if (existing !== undefined && !existing.loaded) {
    // 经 `withSessionLoad` 登记在途：装载里的 `tabs.activateTab` 会经同步点回调到
    // `ensureActiveSessionLoaded`，不登记就会为同一个文件并发发起第二次装载。
    return withSessionLoad(existing, () =>
      loadSessionContent(() => existing, path, kind, quiet),
    );
  }
  // 已经打开的文件一律切到既有标签：不重复开、也不重读（非 md 只读，重读只会把用户
  // 正在看的位置顶掉）。两种意图都适用（M254 之前还有一步「双击 / ⌘-点击一个已打开的
  // 预览标签 = 把它固定住」，预览机制退场后这一步自动消失）。
  //
  // 这一条必须放在 showNotice 与 beginSwitch 之前：切换是同步的，既不需要「正在打开」
  // 这一步，提前 return 也绝不会把「正在打开 / 暂不支持预览」覆盖层留在编辑器上
  //（M149 实测缺陷：留下过一次，`.editor-notice` 从此盖住整块正文且不再撤下，表现为
  //  此后所有点击都被它 intercept——视觉场景 wikilink.spec.ts 就是这样红的）。
  if (existing !== undefined) {
    showEditor(); // 撤下一次更早的、已被这次同步切换取代的「正在打开」覆盖层
    // 上面的移动分支已把「开在他 pane」的同文件移到活跃 pane 并激活；这一句覆盖剩余情形
    //（本就在活跃 pane）与移动分支之外的兜底，已是前台时是 no-op。
    activateSessionInOwnerPane(existing);
    return true;
  }
  // 新开一个标签（"new"）或就地替换前台标签（"current"）：会话在快照读成之后才落点——
  // 读失败的请求不许留下一个多余的空标签。落点 = 活跃 pane 的标签条（已裁形态）。
  return loadSessionContent(() => activeTabs().targetSessionFor(intent), path, kind, quiet);
}

/** 内容装载的共同体（M283 起被两条路径共用）：壳态标签的「填充」与新文件的「打开」是同一件事
 *  ——读快照 → 登记落盘基准 → 落到一个会话上 → 装载事务 → 恢复阅读位置。
 *
 *  `resolveSession` 在**快照读成之后**才调用（调用方据此决定落在哪个会话上：壳态标签是它自己，
 *  新打开是 `targetSessionFor`），因此读失败不会留下多余的空标签；它返回的会话必须仍在编辑器
 *  的会话表里——`isCurrent(request)` 的复查挡的就是「读在途期间 vault 被换掉
 *  （`editor.reset()` 清空了会话表）」那条路径。 */
async function loadSessionContent(
  resolveSession: () => EditorSession,
  path: string,
  kind: "md" | "code" | "text" | "binary",
  quiet: boolean,
): Promise<boolean> {
  const request = save.beginSwitch();
  if (kind === "binary") {
    if (!quiet) showNotice(t("D25", { path }));
    return false;
  }
  showNotice(t("D205", { path }));
  try {
    const snapshot = await fsReadSnapshot(path);
    if (!save.isCurrent(request)) return false;
    // 守卫复查：请求在途期间前台可能已经换过（并发打开 / 用户切走）。
    if (editor.activeSession().path === undefined && !save.guard(t("D209"))) return false;
    // 可编辑文本类（注册表 md/code/text）进保存链路并登记磁盘 revision——dirty 有真实
    // 出口（Cmd+S / 冲突恢复 / 崩溃备份全部可达，editable-non-md-files 裁决 D3）。
    // 判据取 isEditablePath（与编辑器会话的 editable 标志同源同一真源），MUST NOT 另写集合。
    save.noteOpened(path, isEditablePath(path) ? snapshot.revision : undefined);
    const session = resolveSession();
    // 成员复查（M283 r1 P2-1）：`resolveSession` 的两条路径都可能在读盘**之前**就绑定了会话对象
    // （壳态的两条装载路径——`openFile` 的壳态分支与 `ensureActiveSessionLoaded`——都是早绑定），
    // 而用户能在这次 IPC 在途期间关掉那个标签：`closeTabNow` 只动会话表与标签栏，**不碰**
    // `beginSwitch` 的 serial，因此上面那条 `isCurrent` 挡不住它。不复查的话随后的
    // `tabs.activateTab` 会把一个已脱离会话表的壳置为前台——正文显示已关闭标签的内容、标签栏里
    // 却没有它（无数据丢失，但状态机出格）。按失败收口：调用方（会话恢复）据此退化到下一个候选，
    // 用户看到的是一次正常的恢复。新标签路径（`tabs.targetSessionFor`）晚绑定，结构上不可能命中。
    if (!editor.sessions().includes(session)) return false;
    activateSessionInOwnerPane(session); // 已在同一会话上时是 no-op
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
    // M283 起它同样是**壳态标签首次成为前台**时恢复阅读位置的那一步（结果与今天一致，时间点
    // 从「装载完成时」后移到「首次成为前台时」——spec 已把这条写成可观察结果不变的边界）。
    readingPositions.restoreFor(path);
    afterLoad();
    return true;
  } catch (e) {
    if (!save.isCurrent(request)) return false;
    if (!quiet) showNotice(errorMessage(e));
    return false;
  }
}

/** 壳态标签的内容装载：唯一触发点是**它成为前台**（M283 的 3.5）。挂在唯一的同步点
 *  （`syncActiveDocument`）上——标签点击 / ⌃⇥ 轮换 / 关标签后的相邻激活 / 树里点开一个已在
 *  会话里的文件，都经过它。
 *
 *  在途用集合挡重入：`loadSessionContent` 自己会 `tabs.activateTab`，那又是一次同步点回调。
 *  **会话恢复那条路径也必须登记在途**（`withSessionLoad`）——不然它自己的装载会被这一次回调
 *  再发起一遍（同文件两次 IPC + 两次装载事务；M283 的探针里实测到它会把落点抢到别的标签上）。
 *  失败**不留失败标记**——下一次同步点会再试一次（用户再点一次这个标签就是一次重试），且失败
 *  按用户动作上屏（`quiet=false`：点标签是一次明确的用户动作，静默失败会让人以为文档是空的）。 */
function ensureActiveSessionLoaded(): void {
  const session = editor.activeSession();
  const path = session.path;
  if (path === undefined || session.loaded) return;
  if (shellLoadsInFlight.has(session)) return;
  void withSessionLoad(session, () =>
    loadSessionContent(() => session, path, openKind(path), false),
  );
}

/** 登记「某个会话的内容装载在途」，跑完自动摘掉。所有发起装载的路径都必须经它——包括
 *  会话恢复（`openPinned` → `openFile` 的壳态分支），否则同步点上的按需触发会重复发起一次。 */
function withSessionLoad(session: EditorSession, run: () => Promise<boolean>): Promise<boolean> {
  shellLoadsInFlight.add(session);
  return run().finally(() => shellLoadsInFlight.delete(session));
}

/** 在途的壳态装载（按会话对象键控）。放在这里而不是会话对象上：它是一次装载过程的局部状态，
 *  不属于会话本身（`loaded` 才是装载的终态）。M316 起键从会话 id 换成对象本身——id 是
 *  逐编辑器实例自增的，双 pane 下两个实例的会话会撞号。 */
const shellLoadsInFlight = new Set<EditorSession>();

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
  event.returnValue = t("D206");
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
  // M317 2.3：⌘-Click 挂到每个 pane 的视图上（与 toc 共用 viewTrackers 注册表，含未来 pane）；
  // 点击先按被点的视图把该 pane 翻成活跃 pane（鼠标事件早于 focusin，不先翻会让解析基准错位）。
  eachView: (attach) => trackEachView(attach),
  activateView: (view) => activatePaneForView(view),
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
// 界面语言（M282，change ui-language-i18n 的 D1/D2/D3 裁决）：运行期切换的单一施加点与循环命令。
//
// 真源分层（design §5.1）：`config.json` 的 `[ui] language` = **启动真源**，`<html lang>` =
// **运行期唯一生效面**（顺带修掉 index.html 原先写死的 `lang="en"` 与全界面不符）。文案层的
// 取值一律读 `<html lang>`（src/copy.ts 的 currentLanguage），本文件**不另存一份当前语言**。
//
// applyLanguage 是**唯一施加点**：启动装配（本文件末尾 configGet 块内）与运行期切换都经它，
// MUST NOT 出现第二处写 `<html lang>` 的地方（与 applyTheme 同款纪律，REVIEW.md 第 8 条）。
// 语言的派生物比主题多得多（全部可见字符串），因此施加点还要跑一遍 `runRelabels()`：长驻
// chrome 的模块在挂载时把串写死了，不重写就不会变（design §5.2 的不变量）。
// ---------------------------------------------------------------------------

/** 施加语言：写 `<html lang>`（`zh-Hans` / `en`，BCP-47）+ 刷新 modeline 指示钮 + 按注册顺序
 *  跑长驻 chrome 的重绘 + 让编辑器重建预览装饰（widget 的文本在 `toDOM()` 里生成，表格降级
 *  归因句还经 `data-degraded` 属性被 CSS `attr()` 取用——**属性不重建就不会变**）。
 *
 *  `lang` 取 Rust 侧 `UiLanguage` 闭集合，前端不判非法值（合法性已由 Rust validate 保证，
 *  再判一次就是同一条语义的第二处真源）。 */
function applyLanguage(lang: Language): void {
  document.documentElement.lang = languageTag(lang);
  shell.modelineLanguage.textContent = lang;
  const label = t("D317", { lang });
  shell.modelineLanguage.title = label;
  shell.modelineLanguage.setAttribute("aria-label", label);
  shell.modelineLanguage.hidden = false;
  runRelabels();
  editor.refreshPreview();
}

/** 循环切换到另一档（命令 `view.language-cycle` 与 modeline 语言钮的**同一条实现路径**，
 *  design §5.3：不调命令分发器，两处直接调它）。顺序是有意的：先施加（`<html lang>` 与全部
 *  长驻 chrome / 预览装饰都是新语言），再写回配置——写回失败只影响持久化，运行期语言**不回滚**
 *（与主题写回同款降级口径）。 */
function cycleLanguage(): void {
  const next = nextLanguage(currentLanguage(document.documentElement));
  applyLanguage(next);
  configSetUiValue("language", next).catch((e: unknown) => {
    toast(t("D319", { reason: errorMessage(e) }));
    logEvent("config_warning", { source: "language", message: errorMessage(e) });
  });
}

// modeline 语言钮的点击 = 同一条实现路径（click 事件本身不需要被消费，语义全在 cycleLanguage 里）。
shell.modelineLanguage.addEventListener("click", cycleLanguage);

// ---------------------------------------------------------------------------
// Harness 对话面板（M303，change add-harness-probe）：面板本体、流式渲染、上下文组装与
// 批准闸都在 src/harness-panel.ts（+ src/harness-context.ts / src/harness-panel.css），
// 这里只做一件事——把 shell 与编辑器句柄交给它。toggle 命令（harness.toggle）在下面的
// 统一键位层登记，与标题栏 toggle 钮共用面板的同一条 toggle 路径。
// ---------------------------------------------------------------------------
// M317 2.4：面板拿到的 `editor` 是复合句柄，`assembleHarnessContext(editor)` 读的
// `activeSession()` + `view.state/viewport` 因此都解析到**活跃 pane**——「当前 TAB」的定义
// 随活跃 pane 走。`HarnessContextSource`（harness-context.ts:31）的接口形状不变，改造面全在
// 这一处注入（design §2 行 5）。
const harnessPanel = createHarnessPanel({ shell, editor });

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
  // M317 2.7：交出的是**活跃 pane** 的视图；panel 在构造期绑死这一个 view、此后只用它
  //（src/search.ts 的 LumirSearchPanel 持 `this.view`），面板持焦期间活跃 pane 不漂移
  //（focusin 只发生在 pane 的 contentDOM 上），搜索 / 替换目标因此不随焦点漂。
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
  // 界面语言循环切换（M282，change ui-language-i18n 的 D1/D2/D3 裁决）：en ↔ zh 循环，命令实现
  // 就是上面的 cycleLanguage（与 modeline 语言钮共用同一条路径，见那段注释）。默认键位 ⌘⇧L 在
  // keys.ts 的 KEY_BINDINGS 里（三条冲突来源的复核与 token 形态见那一条的 docKey 指向的表条目）。
  "view.language-cycle": () => cycleLanguage(),
  // harness 对话面板唤起 / 收起（M303，change add-harness-probe）：与标题栏 toggle 钮共用面板
  // 的同一条 toggle 路径。默认键位 ⌘⇧A 在 keys.ts 的 KEY_BINDINGS 里（冲突核实见表条目 D345）。
  "harness.toggle": () => harnessPanel.toggle(),
  // 标签（M149）：能力与切换在 editor 的会话 API，装配层只做两件它才知道的事——
  // 切换后的表现层对齐（tabs.activateTab → syncActiveDocument）与关标签的确认（都在 src/tabs.ts）。
  // `tab.close` 关的是**前台**标签；逐标签关闭钮走同一条 closeTab（同一个确认）。
  // 表格放大全屏查看（M240，裁决点 1/2/4）：能力与遮罩 DOM 在 src/table-fullscreen.ts，
  // 命令只做「命中判定 + 两个动作」——遮罩已开 = 关闭（toggle，D4 的第三条关闭路径），否则把
  // 命中的那张表打开。命中条件不满足时什么都不做；**条件不满足时不消费事件**那条由下面
  // keymapContext 的命令级门承担（绑定层表达不了，理由见 keys.ts 的 KeymapContext）。
  "table.toggle-fullscreen": () => {
    if (tableFullscreen.isOpen()) {
      tableFullscreen.close("toggle");
      return;
    }
    const target = tableFullscreenTarget(editor.view);
    if (target === null) return;
    tableFullscreenSource = paneLayout.active().id; // 焦点归还的来源 pane（M317 2.9）
    tableFullscreen.open(target.table, target.label);
  },
  // 代码块放大全屏查看（M277）：与表格侧同形——遮罩已开 = 关闭（toggle），否则按命中判据找块
  // （caret 在块内；容器持焦这条在命令的 gate 里另判）并打开。内容取自「打开那一刻」的
  // EditorState（codeBlockFullscreenTarget 现取整块源码 + 按行 / token 切分）。
  "code-block.toggle-fullscreen": () => {
    if (codeBlockFullscreen.isOpen()) {
      codeBlockFullscreen.close("toggle");
      return;
    }
    const target = codeBlockFullscreenTarget(editor.view, editor.view.state.selection.main.head);
    if (target === null) return;
    codeBlockFullscreenSource = paneLayout.active().id; // 焦点归还的来源 pane（M317 2.9）
    codeBlockFullscreen.open(target.render, target.label);
  },
  // 块级复制（M277）：命中判据不满足时什么都不做（事件不被消费由下面的命令级门承担）。
  // 命令实现本身在 editor.ts 的 commands 记录里（`block.copy` 的作用域是 editor，内核组；
  // 内容口径与复制钮逐字相同——都经 `copyBlockContent`）。
  "tab.close": () => {
    void activeTabs().closeTab(editor.activeSession());
  },
  "tab.next": () => activeTabs().cycleTab(1),
  "tab.prev": () => activeTabs().cycleTab(-1),
  ...gotoTabCommands(),
  // 双栏（M316，change pane-system-split-view 分组 3）：三条容器命令——分栏 / 切到另一
  // pane / 收拢活跃 pane。默认都不绑键（登记在 keys.ts 的 KEYLESS_COMMAND_IDS，键位
  // 指配归收尾 mission），用户要键位就经 [keys] 绑；作用域 global（焦点在左栏 / 浮层
  // 里时同样要能切），故 id 前缀取 `pane.` 而不是 `editor.`。
  "pane.split": () => splitActivePane(),
  "pane.other": () => activateOtherPane(),
  "pane.close": () => closeActivePane(),
};

/** ⌘1–9 的九条命令：序号与命令 id 的映射唯一真源在 tabs.gotoCommands（TAB_GOTO_IDS
 *  同一次遍历），这里只做「分发时按活跃 pane 解析」的一层转发，不另写一份映射。 */
function gotoTabCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner> {
  const table = {} as Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
  for (const id of TAB_GOTO_IDS) {
    table[id] = () => activeTabs().gotoCommands()[id]();
  }
  return table;
}

// editor 作用域判定（M316 泛化）：事件目标落在**任一 pane** 的 contentDOM 内（含其中
// widget 与表格滚动容器）——边界不放宽到 chrome 焦点，只是从「那一个 view」换成
//「各 pane 的 view 任一」。用目标而非焦点，是因为轨道 D 的 widget 就在 contentDOM
// 里——焦点落在表格滚动容器上时命令照常生效；容器自己的滚动键由表内绑定用 `when`
// 收窄（M132），分发器入口另对已消费事件（defaultPrevented）让路。
const keymapContext = {
  isEditorEvent: (event: KeyboardEvent) => {
    const target = event.target;
    return (
      target instanceof Node &&
      paneLayout.panes().some((pane) => pane.handle.view.contentDOM.contains(target))
    );
  },
  // 命令级命中条件（M240，理由见 keys.ts 的 KeymapContext.commandGate）：`table.toggle-fullscreen`
  // 的命中条件需要编辑器状态（caret 在不在渲染为 grid 的表内 / 容器是否持焦），而
  // `[keys]` 覆盖产出的绑定没有 `when` 字段——条件因此落在命令实现方。不满足时返回 false，
  // 分发器**不消费事件**、不 preventDefault，同名按键照旧走原生路径（spec 的
  // 「命中条件不满足时不消费事件」scenario）。
  // 遮罩已开时恒为真：「再执行一次同一命令关闭」这条关闭路径必须可达——无论 caret 当时在哪。
  // M277 的两条命令同款：`code-block.toggle-fullscreen` 在遮罩已开时恒真（toggle 关闭可达），
  // 否则要求命中一块代码块（caret 在块内或块的横滚容器持焦——容器持焦那条是 DOM 事实，
  // 与 tableFullscreenTarget 的入口 ① 同口径）；`block.copy` 要求命中一个可复制的块。
  commandGate: (command: CommandId) => {
    if (command === "table.toggle-fullscreen") {
      return tableFullscreen.isOpen() || tableFullscreenTarget(editor.view) !== null;
    }
    if (command === "code-block.toggle-fullscreen") {
      return codeBlockFullscreen.isOpen() || codeBlockCommandTarget() !== null;
    }
    if (command === "block.copy") {
      return blockCopyTarget(editor.view) !== null;
    }
    return true;
  },
};

/**
 * `code-block.toggle-fullscreen` 的命中判定：内容目标（caret 在块内），或**该块的横滚容器持焦**
 * （滑鼠用户点了容器时 caret 可能还在别处，与 `tableFullscreenTarget` 的入口 ① 同口径）。
 * 折行口径下块内没有容器，第二条自然为假——结构性事实，不模拟。
 */
function codeBlockCommandTarget() {
  const active = editor.view.dom.ownerDocument.activeElement;
  if (active instanceof Element && active.classList.contains(BLOCK_SCROLL_CLASS)) {
    const from = editor.view.posAtDOM(active, 0);
    const target = codeBlockFullscreenTarget(editor.view, from);
    if (target !== null) return target;
  }
  return codeBlockFullscreenTarget(editor.view, editor.view.state.selection.main.head);
}
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
  // 交还焦点同图片遮罩 / 表格全屏（M280 收口）：MUST NOT 裸 `editor.view.focus()`。
  restoreFocus: () => editor.focusPreservingReadingPosition(),
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
  const display = path === undefined ? t("D207") : path.replaceAll("/", " / ");
  shell.modelinePath.textContent =
    session.dirty && path !== undefined ? t("D90", { name: display }) : display;
}

/** modeline 右段（`语法 · 行数 · UTF-8`）——design §4-2 的实现期结论，口径「**只读派生、
 *  零新状态**」：
 *
 *  - 行数取 `view.state.doc.lines`。它是 CM 的 Text rope 上**构造期算好的缓存字段**
 *    （`TextNode` 在构造时累加子节点的 lines、`TextLeaf` 恒为 1，见 @codemirror/state 的
 *    Text 实现），读它是 O(1)，**不引入全文档遍历**——ADR 0002 §6 对键入路径的约束因此
 *    不被这条新展示位破坏。
 *  - 语法名从分类注册表取（`codeLanguageOfPath`，与文件树 / 大纲同一份注册表，不另立映射表）：
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
    : codeLanguageOfPath(session.path ?? "") ?? "Plain text";
  const text = tPlural("D208", lines, { language, lines: formatNumber(lines) });
  if (shell.modelineMeta.textContent !== text) shell.modelineMeta.textContent = text;
}

// 语言切换后重写 modeline 的两段长驻文本（左段的路径 / 未保存标记、右段的「语法 · 行数 ·
// 编码」）：它们是「文档变化时才写」的派生文本，不随语言自动更新，因此必须有一条能在运行期
// 重跑它们的路径（design §5.2 的不变量）。同步主题 / 字号等重绘也走这里，避免各自为例外接线。
onRelabel(() => {
  syncDirtyIndicator();
  syncModelineMeta();
  // 主题钮的悬停提示 / 读屏名由 `applyTheme` 写，而它在启动块里跑在 `applyLanguage` **之前**
  //（那时 `<html lang>` 还没写，取值落到默认档）——这里按当前主题重写一遍。
  const theme = currentTheme(document.documentElement);
  if (theme !== null) applyTheme(theme);
  // 树空态那一行必须**重新取值**而不是重放旧字符串：`RESTORING_NOTICE()` 在显示的那一刻就
  // 解析成了字符串，重放等于把切换前的语言钉死（同族的还有后端透传的 notice，那是真值，原样重放）。
  if (lastVaultStatus !== null && lastVaultStatus.vault === null && !vaultLoaded) {
    tree.showEmpty(lastVaultStatus.restore_pending ? RESTORING_NOTICE() : lastVaultStatus.notice);
  }
  // 栏宽手柄的读屏名：`createShell` 在挂载时写死（D120），它没有「打开」这个点时重写的机会，
  // 因此必须走重绘注册（design §5.2 的不变量：挂载后无法重写的语言相关文本 MUST NOT 存在）。
  const handleLabel = WIDTH_HANDLE_LABEL();
  shell.widthHandles.left.setAttribute("aria-label", handleLabel);
  shell.widthHandles.right.setAttribute("aria-label", handleLabel);
  // 分隔条的读屏名（M319，D368）：只在分栏态在场（dividerEl 非 null），切换语言时同样要重写。
  if (dividerEl !== null) dividerEl.setAttribute("aria-label", SPLITTER_LABEL());
});

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
  // updateDirty / setSessionDirty）。两种情形都要重画全部 pane 的标签栏：dirty 点是
  // 逐标签的（M316：后台 pane 的标签条同样要跟）。
  syncDirtyIndicator();
  renderAllTabStrips();
  // 保存成功（dirty→false）后所有 dirty 表现层必须一致清除：modeline 的标记、
  // 后端退出守卫镜像，以及 dirty 期间弹出的守卫提示。sticky 提示按设计不自动
  // 消隐，不主动撤下会让「未保存」在保存成功后残留在右下角（桌面验收缺陷）。
  if (!dirty) save.clearGuardToasts();
  syncBackendDirty();
});

// modeline 的行数随文档变化（每次键入都可能改行数）。走内核已有的 onDocChanged，
// 不新开一条监听通道——行数是 rope 上的缓存字段，读一次 + 条件写 DOM 的代价不构成新的
// 键入路径负担。（M254 之前这条监听的注释还举了「预览标签首次输入即固定」这个同类消费者；
// 预览机制退场后它只剩行数这一个消费者，通道本身不动。）
editor.onDocChanged(() => syncModelineMeta());

// M254：这里原先还有一条「预览标签首次输入即固定」的 onDocChanged（编辑动作落在预览标签上
// 就把它提升为固定标签，并沿会话侧通知口防抖落盘）。预览机制随 change preview-tab-removal
// 退场后，标签只有一种形态，没有可提升的状态——整块删除，不留空壳监听。

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
 *  提示（目标打开失败保留当前上下文，MUST NOT 把文件树抹成空态）。
 *
 *  这里也是「切换」这条通道给出即时反馈的地方（M252）：装载指示从**用户点下列表行的那个
 *  时刻**起（浮层收起与指示几乎同帧，见 src/vault-switcher.ts 的行点击路径），一路盖到
 *  目标 vault 的会话恢复跑完；`vault_open_path` 的耗时另记一条阶段读数。 */
async function switchToVault(path: string): Promise<void> {
  await loadUserVault(async () => {
    const openedAt = performance.now();
    const info = await vaultOpenPath(path, false);
    phaseMs(openedAt, "vault_load_open");
    await applyVault(info.root, info.entries, info.vault_id, false);
  });
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
        ? t("D105", { name: occupied.name })
        : t("D106", { name: row.name }),
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
      // 已在弹选择器之前跑过），不需要在这里再拦一次。装载指示同一条通道（M252），起点取
      // **选择器返回之后**——原生选择器自己开着的那段时间不该转（那是用户在挑目录，不是
      // 在等 Lumir）。
      void loadUserVault(() => applyVault(info.root, info.entries, info.vault_id, false));
    })
    .catch((e) => {
      // 已有 vault 时打开失败（如改选了一个不可读目录）不得把既有树抹成
      // 空态——空态只属于"尚无 vault"的启动路径；此处仅浮条提示。
      if (vaultLoaded) toast(errorMessage(e));
      else tree.showEmpty(errorMessage(e));
    });
}

tree = createFileTree(shell.treeMount, {
  // 打开文件的落点：树已经不再判定意图（M254）——单击 / 双击 / ⌘-点击一律是「开一个标签」，
  // 预览机制退场后这三者没有可区分的落点，判定权因此收回装配层一处（"new"）。
  onOpenFile: (path, kind) => void openFile(path, kind, "new"),
  // 空态按钮（未装载 vault 时唯一入口）与浮层底部的「新增 vault…」同一条链路。
  onOpenVault: () => requestAddVault(),
  // 树头部的常驻入口（形态 A）：展开 / 收起列表浮层。
  onOpenVaultSwitcher: () => switcher.toggle(),
  // 条目右键（M244）：菜单浮层与动作都在上面那两个装配块里；树只报「哪一行、什么条目、
  // 锚点是谁、指针在哪」。右键不改上下文（树不发 onOpenFile，装配层也不碰 currentPath）。
  onContextMenu: (target, at) => treeMenu.open(target, at),
  // 内联编辑提交（重命名 / 新建共用）。
  onInlineEditSubmit: (request) => void submitInlineEdit(request),
  // 惰性目录展开取数（design §4.3）：一次一层。失败**必须**透出去（提示 + reject），
  // 树据此不把它标记成「已取回」——吞成空数组会把一次失败渲染成「空目录」。
  onExpandLazyDir: async (path) => {
    try {
      return await fsScanDir(path);
    } catch (e) {
      toast(errorMessage(e));
      throw e;
    }
  },
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
  // 附件索引只由**主动枚举**的条目建出（design §4.6）：惰性条目在树里可见、可打开，但
  // 不进索引——索引的输入必须是磁盘 + 规则的纯函数，不能取决于用户点开过哪些目录
  //（`![[img.png]]` 指向惰性目录里的图片解析为找不到是已知边界）。
  attachmentPaths = entries.filter((e) => e.kind === "file" && !e.lazy).map((e) => e.path);
  // 链接索引已在后端随 vault 打开建立；换世代使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效（两件事在 link-follow 里成对）。
  linkFollow.resetForVault();
  // 全部标签作废：内核只留一个未命名空文档（内部 currentFilePath 一并置空）。
  // M316：reset / resolver 都经复合句柄广播——双 pane 时两个实例一起复位。
  editor.reset();
  applyWikilinkResolver(linkFollow.resolver);
  // vault 名的展示位只有一处：侧栏头的切换器入口（tree.setVault 内部按同一个 baseName
  // 渲染），本文件不再往另一个元素上写一份副本。
  // 这一步是同步的整树重建，也是装载路径上**唯一**的主线程重活（大 vault 上可能数百 ms）：
  // 单独量一条读数，好与 Rust 侧的打开、会话恢复分开看（M252 的阶段定位）。
  const treeAt = performance.now();
  tree.setVault(root, entries);
  phaseMs(treeAt, "vault_load_tree");
  // 表现层一次对齐：modeline 路径回「无当前文件」、标签栏隐藏（空态）、树高亮清空、
  // 大纲指示段收起、后端 dirty 镜像复位。放在 setVault 之后：setVault 重绘整棵树，
  // 之后再由它把树高亮刷成「无当前文件」。
  syncActiveDocument();
  showEditor(); // 旧 vault 的「暂不支持预览」覆盖层一并撤下
  // harness 面板换会话作用域（M312）：面板的会话状态在后端按 vault 分桶，而面板自己只在挂载时
  // 拉过一次快照——切 vault 后必须让它重拉（并丢掉旧 vault 的渲染面），否则面板上留着上一个
  // vault 的对话。放在这里而不是 applyVault 开头：编辑器与表现层都已对齐到新 vault，面板重拉
  // 时取的上下文 chip 因此是新 vault 的文档（不是旧 vault 残留的那个）。
  harnessPanel.vaultChanged(root);
  // 残留崩溃备份的恢复入口（M127）：装载完成后才有 vault 上下文可定位备份。
  void save.checkRecovery();
  // 装载后恢复该 vault 的标签列表（M163；M283 起先按存储顺序建壳、内容只装激活项）：异步，
  // 不阻塞树与首帧；恢复途中若又换了一次 vault，本次恢复整体作废（vault-switcher 的世代号）。
  // 上面的位置镜像已经就绪，激活项的内容装载会走它自己那份阅读位置的恢复（其余标签在首次
  // 成为前台时各走一次）。
  //
  // 这个 Promise 也是「装载指示什么时候该消失」的唯一信号（M252）：它在「壳建齐 + 激活项内容
  // 装载完」那一刻 resolve（M283 起恢复段的等待与标签数脱钩，见 design §3.3），那一刻整窗
  // 上下文才真的就绪。启动恢复路径没有开指示，`end()` 在那里是 no-op（引用计数）。
  const restoreAt = performance.now();
  void switcher.onVaultLoaded(vaultId, entries).finally(() => {
    phaseMs(restoreAt, "vault_load_restore", true);
    vaultLoading.end();
  });
}

// watch 增量事件流 → 附件索引与文件树同步打补丁（都不全量重扫）。
// 无 Tauri 后端的环境（如纯浏览器预览）下 listen 会 reject，静默忽略。
// 整段处理是「后台回调」（不在键入路径上），超 16ms 预算时采样记一条 slow_callback
// ——「文件一多就卡」这类毛刺正是 dogfood 要定位的东西。
onFsEntryChanged((changes) => {
  sampleCallback("fs_entry_changed", () => {
    for (const change of changes) {
      // 附件索引的口径（「哪些事件能改索引」）是 `patchAttachmentPaths` 的纯函数那一份：
      // 惰性条目不进索引、deleted 无条件移除、其余文件条目照旧。装配层只把结果写回。
      attachmentPaths = patchAttachmentPaths(attachmentPaths, change);
    }
    // 已打开文件被外部变更（Lumir ↔ Obsidian 来回编辑的高频路径，M124）：附件索引与
    // 文件树照常吃增量，文档内容另行处置（save 控制器内分流）。M149：判据是**全部**
    // 打开中的文档而不是前台那一个——多标签下后台标签被外部改写同样要处置（旧实现只查
    // displayedPath，后台标签的变更会静默漏报）。
    //
    // M244（design §3.2）：app 内改名的一次性归因抑制。菜单发起的重命名会让 watcher 回来
    // 「deleted:old + created:new」，不抑制就会把用户自己改的名报成外部变更（remap 之后
    // session.path 已是 new，真正命中 dirty 会话的是 `created:new` → 「检测到外部修改」）。
    // 抑制只作用在**会话链路**上：上面的附件索引与下面的树 / 链接索引照常收敛。
    const renamed = renameEcho.consume(changes.map((c) => c.path));
    for (const session of editor.sessions()) {
      const path = session.path;
      if (path === undefined) continue;
      const hit = changes.find((c) => c.path === path);
      if (hit && !renamed.has(hit.path)) save.handleExternalChange(path, hit.kind);
    }
    renameEcho.settle();
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
const RESTORING_NOTICE = (): string => t("D95");

/** 拉一次权威 vault 状态：已打开就装载，否则按终态（恢复中 / 恢复失败 / 无 vault）显示空态。
 *
 *  两条「不降级」门（都是让位规则的前端侧，design §4.2）：① 同一个 vault 的响应只装载一次
 *  ——启动时完成信号与首次拉取可能同时到达，重复装载会白走一遍编辑器整批复位与崩溃备份入口；
 *  ② 尚未到终态的空态只在**没装载过**时呈现——装载之后再到达的「恢复中 / 无 vault」响应是
 *  更早那次拉取的迟到响应，不能把已装载的树降级成空态。 */
let lastVaultStatus: VaultStatus | null = null;

function refreshVaultStatus(): Promise<void> {
  return vaultCurrent()
    .then((status) => {
      lastVaultStatus = status;
      if (status.vault) {
        if (status.vault.root === loadedRoot) return;
        loadVault(status.vault.root, status.vault.entries, status.vault.vault_id, true);
      } else if (!vaultLoaded) {
        tree.showEmpty(status.restore_pending ? RESTORING_NOTICE() : status.notice);
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
  currentDefaultMode = snapshot.config.editor.mode;
  editor.setMode(snapshot.config.editor.mode);
  // 折行口径（M180，change line-wrap-options；M247 起三项）：配置给的是**启动时的起点**——
  // 应用运行期的翻转由两条 `view.toggle-*` 命令承担，运行期 MUST NOT 回写这里（config.json 的
  // mtime 与内容在翻转前后逐字节不变）。放在 setMode 之后：mode 决定代码块内容级 class 有没有
  // 作用对象，两者一起重配（editor.setWrap 走的就是那条 modeAndWrapEffects 路径）。
  // 三项按模式分工：`line_wrap` / `code_block_wrap` 管 md 模式，`code_mode_line_wrap` 管 code
  // 模式——出厂即「md 折 / code 不折」的分叉（两键各自的默认值都来自 Rust 侧 `EditorConfig`）。
  editor.setWrap({
    lineWrap: snapshot.config.editor.line_wrap,
    codeBlockWrap: snapshot.config.editor.code_block_wrap,
    codeModeLineWrap: snapshot.config.editor.code_mode_line_wrap,
  });
  // Enter 自动缩进（change enter-auto-indent）：与上面三项同属「配置到位后施加一次」的启动
  // 装配落点区，**不新增第二条装载路径**（编辑器的唯一入口是 setAutoIndent）。键缺席时 Rust 侧
  // 取到的就是出厂 `true`（键不跟随任何别的键）；`false` 只回退本 change 新增的两处
  //（code 模式 / md 围栏与缩进代码块内），md 的列表 / 引用续行是上游行为、不受本键影响
  //（裁决 D5a 的显式不对称，spec 的「关闭自动缩进」scenario 有对应断言）。
  editor.setAutoIndent(snapshot.config.editor.auto_indent);
  currentAutoIndent = snapshot.config.editor.auto_indent;
  // 排版口径（M195，change typography-and-zoom）：配置给的是**启动时的基准**——字号在运行期
  // 由三条 `view.text-scale-*` 命令步进，运行期 MUST NOT 回写这里（config.json 的内容与 mtime
  // 在步进前后逐字节不变）。字体族只在启动读一次（本 change 不做热重载，改字体需重启）。
  // warning 走与 [keys] 覆盖同一条出口（console + 诊断日志）——本模块不新造一个出口。
  // currentTypography 是 M316 新 pane 能力同步的真源（baseFontSize 的锚，见 createPaneHandle）。
  currentTypography = {
    fontFamily: snapshot.config.editor.font_family,
    monoFontFamily: snapshot.config.editor.mono_font_family,
    fontSize: snapshot.config.editor.font_size,
  };
  for (const warning of editor.applyTypography(currentTypography)) {
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
  // md 行号 gutter 档位（M281 的 D4 二次改判，2026-09-28）：三档 `on-demand`（默认）/ `always`
  // / `off` 只管 md，code 恒常显。与 `ui.theme` 的**差别**：它没有运行期切换的落点，因此是
  // **装载时读一次、运行期 MUST NOT 回写**（同 `editor.mode` / `editor.font_size`）——本 change
  // 不提供切换它的命令 / 键位 / UI。**前端不判非法值**：取值是闭集合，合法性已由 Rust 侧
  // validate 保证（三档之外 warning + 回落 on-demand，REVIEW.md 第 8 条）。
  editor.setMarkdownLineNumbers(snapshot.config.ui.markdown_line_numbers);
  currentMarkdownLineNumbers = snapshot.config.ui.markdown_line_numbers;
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
  // 界面语言（change ui-language-i18n，M282）：`[ui] language` 是**启动真源**，装载时经
  // applyLanguage 施加到 `<html lang>` 并由文案层按它取值；运行期由 `view.language-cycle`
  // （⌘⇧L）/ modeline 语言钮推进并回写配置文件，两处都走上面那个**唯一施加点**。
  // **前端不判非法值**：取值是闭集合（en|zh），合法性已由 Rust 侧 validate 保证
  //（非法值 warning + 回落 en，REVIEW.md 第 8 条）。不跟随系统语言（非目标）。
  //
  // 与 applyTheme 相邻、同属块内末尾一族（design §5.1）：桩环境缺 `ui` 表时只让语言不施加，
  // 失败面收窄到真正依赖语言的地方（文案层回落到 DEFAULT_LANGUAGE，不抛错）。
  applyLanguage(snapshot.config.ui.language);
}).catch(() => {});

// app-ready 只表示 webview/application shell 已挂载，不等价于 vault 恢复或编辑器首帧。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
emitReadiness("app-ready", { time: now });
