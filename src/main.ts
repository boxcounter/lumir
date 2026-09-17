import { createShell } from "./shell";
import { createEditor } from "./editor";
import { applyKeyOverrides, KEY_BINDINGS, Keymap } from "./keys";
import type { CommandRunner, CommandRuntime, KeyBinding, KeyOverrides } from "./keys";
import { createFileTree } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadAttachment,
  fsReadSnapshot,
  documentSetDirty,
  onFsEntryChanged,
  onMenuCommand,
  onQuitBlocked,
  vaultCurrent,
  vaultOpen,
  vaultOpenPath,
  vaultRemap,
} from "./ipc";
import { createSaveController } from "./save-controller";
import { createToc } from "./toc";
// M151：名字听不出归属的三块能力各自的模块（见各处装配点与模块头注释）。
// link-follow（解析缓存 + 链接跟随）、tabs（标签栏 DOM）、bindings-panel（键位查看面板）。
import { createLinkFollow } from "./link-follow";
import { createTabs } from "./tabs";
import { createBindingsPanel } from "./bindings-panel";
import { logEvent, sampleCallback } from "./diagnostics";
import type { FsEntry } from "./bindings/FsEntry";
import { extensionOf, mimeTypeOf, resolveByNameUnique } from "./preview/attachments";
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
 *  已合并为 controller 的世代号，兼作 editor 装载（reloadSession）的 requestId。 */
const save = createSaveController({
  editor,
  container: shell.editor,
  toast,
  // intent 原样转发：装配层是唯一知道「落到哪个标签」的地方（save-controller 只在
  // 另存为新文件 / 恢复崩溃备份两条链路上指定 "current"）。
  openFile: (path, kind, intent) => openFile(path, kind, intent),
  invalidateResolve: () => linkFollow.invalidate(),
  showEditor: () => showEditor(),
  isNoticeHidden: () => notice.hidden,
});

function emitReadiness(name: string, detail: object = {}): void {
  window.dispatchEvent(new CustomEvent(`lumir:${name}`, { detail }));
}

// 轻量大纲（M148）：masthead 的当前位置指示段 + ⌘⇧O 浮层。能力与浮层本体在 src/toc.ts，
// 装配侧只提供三样：编辑器视图、是否有当前文件（空态不显示指示段）、无标题时的提示出口
// （toast，文案见 文案-Copy.md D84）。指示段与浮层都挂 masthead，浮层不动布局。
const toc = createToc({
  view: editor.view,
  indicator: shell.mastheadSection,
  mount: shell.masthead,
  hasFile: () => save.displayedPath() !== undefined,
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

/** 前台会话变化后把周边表现层**一次**对齐：正文基准路径、masthead、后端 dirty 镜像、
 *  大纲指示段、文件树高亮、标签栏。这是「当前文档」在装配层的唯一同步点——别处的读点
 *  一律改为问 editor.activeSession()，不再各自存副本。 */
function syncActiveDocument(): void {
  const session = editor.activeSession();
  // resolve 的 from 基准不在这里同步：它由 link-follow.ts 的 resolveBase() 活读前台会话
  //（见那边的注释，那份副本曾在装载时序上造成一整批 wikilink 停在 pending）。
  syncDirtyIndicator();
  syncBackendDirty();
  // 指示段与文档同一帧到位（不落在 120ms 节流窗口之后）：见 TocHandle.refresh 的说明。
  toc.refresh();
  tree.setCurrentPath(session.path);
  tabs.renderTabs();
}

/** 装载完成后的表现层对齐（打开 / 重载共用）。 */
function afterLoad(): void {
  linkFollow.invalidate(); // 内容已换，按 from 键控的解析缓存整批失效
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
async function openFile(
  path: string,
  kind: "md" | "code" | "text" | "binary",
  intent: "preview" | "pinned" | "current" = "current",
) {
  // 唯一保留的 dirty 守卫：前台是**未命名文档**（没有路径）。它的内容没有落盘基准，
  // 就地替换等于丢弃草稿，另开标签又会让草稿失去落点——沿用 M130 的守卫与文案。
  // 有文件路径的标签之间是标签切换，不丢内容，因此不设守卫（M149 的语义变化，
  // 见 openspec change add-multi-tabs 的 proposal「语义变化」一节）。
  if (editor.activeSession().path === undefined && !save.guard("切换文件")) return;
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
    return;
  }
  const request = save.beginSwitch();
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  showNotice(`正在打开：${path}`);
  try {
    const snapshot = await fsReadSnapshot(path);
    if (!save.isCurrent(request)) return;
    // 守卫复查：请求在途期间前台可能已经换过（并发打开 / 用户切走）。
    if (editor.activeSession().path === undefined && !save.guard("切换文件")) return;
    // 只有 md 进保存链路（登记磁盘 revision）；非 md 以只读 code 模式打开，不存在
    // dirty，也不该被任何保存入口接受（M130）。
    save.noteOpened(path, kind === "md" ? snapshot.revision : undefined);
    const session = tabs.targetSessionFor(intent);
    tabs.activateTab(session); // 已在同一会话上时是 no-op
    // 装载走事务派生（editor.reloadSession）而不是新建 state：同一标签内换文件时
    // 搜索面板的查询与开合状态因此保留（M139 以来的既有行为）。
    editor.reloadSession(session, snapshot.content, path, request);
    afterLoad();
  } catch (e) {
    if (!save.isCurrent(request)) return;
    showNotice(errorMessage(e));
  }
}

window.addEventListener("beforeunload", (event) => {
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
  openFile: (path, kind) => openFile(path, kind),
  toast,
});

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

const mastheadVault = shell.root.querySelector<HTMLElement>(".masthead-vault")!;
const mastheadFile = shell.root.querySelector<HTMLElement>(".masthead-file")!;

// dirty 状态反馈（M101 验收修复 + M149 按标签）：toast 会消隐，dirty 期间 masthead
// 文件名旁常驻「未保存」标记。M149 起这个后缀描述的是**前台标签**那一个文档；逐标签的
// 状态由标签栏自己的 dirty 点承担（见 src/tabs.ts 的 renderTabs），两者同源同义。
function syncDirtyIndicator(): void {
  const session = editor.activeSession();
  const path = session.path;
  mastheadFile.textContent = path === undefined
    ? "无当前文件"
    : session.dirty ? `${path}（未保存）` : path;
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
  // 保存成功（dirty→false）后所有 dirty 表现层必须一致清除：masthead 标记、
  // 后端退出守卫镜像，以及 dirty 期间弹出的守卫提示。sticky 提示按设计不自动
  // 消隐，不主动撤下会让「未保存」在保存成功后残留在右下角（桌面验收缺陷）。
  if (!dirty) save.clearGuardToasts();
  syncBackendDirty();
});

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
  // 打开意图由树判定（它是唯一看得到点击事件的地方）：单击 = 复用预览标签，
  // 双击 / ⌘-点击 = 新固定标签（M149 语义，Alex 已裁决）。
  onOpenFile: (path, kind, intent) => void openFile(path, kind, intent),
  onOpenVault: () => pickVault(),
});

// vault 装载的两个入口（手动打开 / 启动恢复）共用：先换附件索引再装文件树。
// 换 vault 前必须全量复位旧上下文（reviewer-switcher high finding）：否则旧
// 文件的 currentPath 会被当作新 vault 的 resolve/create from 基准，wikilink
// 一键创建会把文件误建到新 vault 的同名相对路径下。
function loadVault(root: string, entries: FsEntry[], vaultId = root, restored = false) {
  // 判据是「任一标签有未保存修改」——切 vault 会把全部标签一起作废（save-controller 的
  // guardVaultSwitch）。旧实现只有一个文档，那条 guard 与它等价。
  if (!save.guardVaultSwitch()) return;
  vaultLoaded = true;
  emitReadiness("vault-ready", { root, vaultId, restored });
  save.noteVaultReset();
  attachmentPaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  // 链接索引已在后端随 vault 打开建立；换世代使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效（两件事在 link-follow 里成对）。
  linkFollow.resetForVault();
  // 全部标签作废：内核只留一个未命名空文档（内部 currentFilePath 一并置空）。
  editor.reset();
  editor.setWikilinkResolver(linkFollow.resolver);
  mastheadVault.textContent = root.slice(root.lastIndexOf("/") + 1) || root;
  tree.setVault(root, entries);
  // 表现层一次对齐：masthead 文件名回「无当前文件」、标签栏隐藏（空态）、树高亮清空、
  // 大纲指示段收起、后端 dirty 镜像复位。放在 setVault 之后：setVault 重绘整棵树，
  // 之后再由它把树高亮刷成「无当前文件」。
  syncActiveDocument();
  showEditor(); // 旧 vault 的「暂不支持预览」覆盖层一并撤下
  // 残留崩溃备份的恢复入口（M127）：装载完成后才有 vault 上下文可定位备份。
  void save.checkRecovery();
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
  // 不新增 UI 面（避免启动浮条与既有启动视觉冲突）；同一份 warning 另落诊断日志
  // （config_warning 事件），让读日志的 agent 直接看到配置面出了什么问题。
  for (const warning of snapshot.warnings) {
    console.warn(`lumir: ${warning}`);
    logEvent("config_warning", { source: "config", message: warning });
  }
}).catch(() => {});

// app-ready 只表示 webview/application shell 已挂载，不等价于 vault 恢复或编辑器首帧。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
emitReadiness("app-ready", { time: now });
