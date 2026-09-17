import { createShell } from "./shell";
import { createEditor } from "./editor";
import type { EditorSession } from "./editor";
import {
  applyKeyOverrides,
  COMMAND_IDS,
  KEY_BINDINGS,
  Keymap,
  keyToken,
  NON_TAB_GLOBAL_COMMAND_IDS,
  TAB_COMMAND_IDS,
  TAB_GOTO_IDS,
  WIDGET_COMMAND_IDS,
} from "./keys";
import type { CommandId, CommandRunner, CommandRuntime, KeyBinding, KeyOverrides } from "./keys";
import { createFileTree, openKind } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadAttachment,
  fsReadSnapshot,
  documentSetDirty,
  isCommandError,
  linkGraphResolve,
  linkOpenPath,
  linkResolveNote,
  onFsEntryChanged,
  onMenuCommand,
  onQuitBlocked,
  openExternalUrl,
  vaultCurrent,
  vaultOpen,
  vaultOpenPath,
  vaultRemap,
  wikilinkCreate,
} from "./ipc";
import { createSaveController } from "./save-controller";
import { createToc } from "./toc";
import { logEvent, sampleCallback } from "./diagnostics";
import type { FsEntry } from "./bindings/FsEntry";
import type { LinkResolveResult } from "./bindings/LinkResolveResult";
import { extensionOf, mimeTypeOf, resolveByNameUnique } from "./preview/attachments";
import { findWikilinkSpans } from "./preview/wikilinks";
import { standardLinkAt } from "./preview/links";
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
  invalidateResolve: () => invalidateResolve(),
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
// 标签（M149）：模型就是 editor 的会话列表（顺序 = 打开顺序），装配层只多维护
// 「哪个是可复用的预览标签」与标签栏 DOM。选中 / 关闭 / 切换都经内核的会话 API，
// 这里不自己存第二份文档清单（REVIEW.md 第 8 条：同一语义不要两处真源）。
// ---------------------------------------------------------------------------

/** vault 相对路径 → 文件名（标签的可见文本）。 */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** 标签栏渲染：从会话列表**全量重建**。标签数量是人的注意力量级（几到十几个），全量重建
 *  比增量 diff 简单，也天然不会漂。空态（没有任何带路径的会话）整条隐藏——它在网格里
 *  不占行高，所以空态布局与多标签之前逐像素一致（整页基线的空态对照因此不需要更新）。 */
function renderTabs(): void {
  const sessions = editor.sessions().filter((session) => session.path !== undefined);
  const active = editor.activeSession();
  shell.tabStrip.hidden = sessions.length === 0;
  shell.tabStrip.replaceChildren(
    ...sessions.map((session) => {
      const path = session.path as string;
      const name = fileNameOf(path);
      const isActive = session === active;

      const tab = document.createElement("div");
      tab.className = "tab";
      tab.dataset.path = path;
      tab.classList.toggle("is-active", isActive);
      // 预览（临时）标签：标题走斜体。多标签下「这一篇会不会被下一次单击顶掉」必须有
      // 可见线索，否则用户以为它已经固定住了。
      tab.classList.toggle("is-preview", session.preview);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "tab-open";
      open.setAttribute("role", "tab");
      open.setAttribute("aria-selected", String(isActive));
      // 读屏名点名文件名 + 它自己的未保存状态（文案 D90）；悬停提示给完整相对路径
      //（同名文件分散在不同目录时要能分辨，文案 D91）。
      open.setAttribute("aria-label", session.dirty ? `${name}（未保存）` : name);
      open.title = path;
      open.addEventListener("mousedown", (event) => event.preventDefault());
      open.addEventListener("click", () => activateTab(session));

      const dot = document.createElement("span");
      dot.className = "tab-dirty";
      dot.textContent = "●";
      dot.hidden = !session.dirty;
      const label = document.createElement("span");
      label.className = "tab-name";
      label.textContent = name;
      open.append(dot, label);

      const close = document.createElement("button");
      close.type = "button";
      close.className = "tab-close";
      close.textContent = "×";
      close.title = `关闭 ${name}`;
      close.setAttribute("aria-label", `关闭 ${name}`);
      close.addEventListener("mousedown", (event) => event.preventDefault());
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        void closeTab(session);
      });

      tab.append(open, close);
      return tab;
    }),
  );
  // 标签栏出现 / 消失会改变编辑器列的高度，通知 CM 立刻重新测量一次：否则它要等浏览器
  // resize 观察器的回调，滚动锚点会在之后的某一拍才被修正——那一拍落在用户操作之间时，
  // 表现为「莫名其妙跳了几个像素」。m118 的「cell 内 Ctrl+E」场景按 1px 容差断言
  // 「内容不下挫」，实测就是被这一拍打红的（全量跑 3px、单跑 ≤1px，典型的竞态形态）。
  // requestMeasure 由 CM 合并，代价只有一次测量。
  editor.view.requestMeasure();
}

/** 前台会话变化后把周边表现层**一次**对齐：正文基准路径、masthead、后端 dirty 镜像、
 *  大纲指示段、文件树高亮、标签栏。这是「当前文档」在装配层的唯一同步点——别处的读点
 *  一律改为问 editor.activeSession()，不再各自存副本。 */
function syncActiveDocument(): void {
  const session = editor.activeSession();
  // resolve 的 from 基准不在这里同步：它由 resolveBase() 活读前台会话（见那边的注释，
  // 那份副本曾在装载时序上造成一整批 wikilink 停在 pending）。
  syncDirtyIndicator();
  syncBackendDirty();
  // 指示段与文档同一帧到位（不落在 120ms 节流窗口之后）：见 TocHandle.refresh 的说明。
  toc.refresh();
  tree.setCurrentPath(session.path);
  renderTabs();
}

function activateTab(session: EditorSession): void {
  if (session !== editor.activeSession()) {
    editor.activateSession(session);
    invalidateResolve(); // from 变了（多半是另一篇文档），按 from 键控的缓存整批失效
    showEditor();
  }
  // 已经是前台时也要重绘：调用方可能在本次调用前改过会话的可见属性（例如把预览标签
  // 固定住），标签栏必须跟着变。
  syncActiveDocument();
}

/** 关标签：有未保存修改的先给三个出口确认（文案 D92 / D93）。
 *
 * **未命名文档（没有路径）不是标签**：⌘W 与逐标签关闭钮对它一律无操作（reviewer r1 P2-1）。
 * 它的内容只活在内存里，根本没有「关掉」这个语义——不加这条守卫时，冷启动的 SAMPLE 演示
 * 文档会被静默换成一份空文档（用户看到的是文档被无声清空），对一个无路径的 dirty 文档还会
 * 弹出主体为空的确认浮条（`「」有未保存修改…`）。spec 与 proposal 都写「零标签时 ⌘W 无操作」，
 * 这条守卫就是它的落点。 */
async function closeTab(session: EditorSession): Promise<void> {
  if (session.path === undefined) return;
  if (!session.dirty) {
    closeTabNow(session);
    return;
  }
  const path = session.path ?? "";
  toast(
    `「${path}」有未保存修改，关闭后修改将丢失`,
    [
      { label: "保存并关闭", run: () => void saveThenClose(session) },
      { label: "放弃修改并关闭", run: () => closeTabNow(session) },
      { label: "取消", run: () => {} },
    ],
    true,
  );
}

/** 保存链路以「前台文档」为落点，所以先把要关的这一个切到前台再存——顺序是有意的，
 *  不是随手切的。保存未闭环（冲突 / 写失败 / 无落盘基准）时不关：用户还没处置完。 */
async function saveThenClose(session: EditorSession): Promise<void> {
  activateTab(session);
  await save.save();
  if (session.dirty) return;
  closeTabNow(session);
}

function closeTabNow(session: EditorSession): void {
  const wasActive = session === editor.activeSession();
  editor.closeSession(session);
  if (wasActive) {
    invalidateResolve(); // 前台文档被关掉：它的 from 基准一并作废
    showEditor(); // 关掉最后一个标签会落在未命名空文档上，撤下「暂不支持预览」覆盖层
  }
  syncActiveDocument();
}

/** 按意图挑落点会话（只决定「落到哪个标签」，内容装载在 openFile 里做）：
 *  - "current"：前台会话就地换文档（跟随链接 / 另存为新文件 / 恢复崩溃备份）；
 *  - "preview"：复用可复用的标签（预览标签，或还没有文件的未命名文档）；没有就新建一个；
 *  - "pinned"：总是新建固定标签。
 *
 *  预览标签一定是干净的——首次输入即固定（见下面 editor.onDirty 的处理），因此就地替换
 *  不会丢内容；兜底再判一次 dirty，异常情况下宁可新开一个也不覆盖。未命名文档同理：
 *  openFile 的守卫已经保证它在 dirty 时不会被走到这里。 */
function targetSessionFor(intent: "preview" | "pinned" | "current"): EditorSession {
  if (intent === "current") return editor.activeSession();
  if (intent === "preview") {
    const reusable = editor.sessions().find(
      (session) => session.path === undefined || (session.preview && !session.dirty),
    );
    if (reusable !== undefined) {
      reusable.preview = true;
      return reusable;
    }
    const created = editor.createSession();
    created.preview = true;
    return created;
  }
  return editor.createSession();
}

/** 可见标签（有文件路径的会话），按打开顺序。标签栏、⌘1–9、⌃⇥ 共用这一份口径——
 *  未命名文档不是标签（空态就是它），所以一律经这里过滤。 */
function visibleTabs(): EditorSession[] {
  return editor.sessions().filter((session) => session.path !== undefined);
}

/** 序号落点（⌘1–9 / 循环切换的唯一解析点）：越界返回 undefined，调用方无操作。
 *  **不做**「越界就跳到最后一个」这类隐式兜底——⌘7 在只有 3 个标签时不该有动作。 */
function sessionAt(index: number): EditorSession | undefined {
  return visibleTabs()[index];
}

function activateTabByIndex(index: number): void {
  const session = sessionAt(index);
  if (session !== undefined) activateTab(session);
}

/** 循环切换（⌃⇥ / ⌃⇧⇥）：首尾回卷。0 或 1 个标签时什么都不做——「下一个」不存在，
 *  回卷到自己只会产生一次无意义的标签栏重绘。 */
function cycleTab(delta: number): void {
  const tabs = visibleTabs();
  if (tabs.length < 2) return;
  const current = tabs.indexOf(editor.activeSession());
  activateTab(tabs[(current + delta + tabs.length) % tabs.length]);
}

/** ⌘1–9 的九条命令实现。用 TAB_GOTO_IDS 生成而不是手写九遍：序号与命令 id 出自同一次
 *  遍历，不可能错位（手抄一处错的表现是「某个 ⌘N 静默不动」，最难发现的一类 bug）。 */
function tabGotoCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner> {
  const table = {} as Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
  TAB_GOTO_IDS.forEach((id, index) => {
    table[id] = () => activateTabByIndex(index);
  });
  return table;
}

/** 装载完成后的表现层对齐（打开 / 重载共用）。 */
function afterLoad(): void {
  invalidateResolve(); // 内容已换，按 from 键控的解析缓存整批失效
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
    activateTab(existing);
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
    const session = targetSessionFor(intent);
    activateTab(session); // 已在同一会话上时是 no-op
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
// wikilink：解析缓存、跳转、一键创建（语义全部经 invoke 取 Rust link_graph 结果）
// ---------------------------------------------------------------------------

/**
 * wikilink resolve 的 from 基准：**活读前台会话**，不另存一份副本。
 *
 * 为什么不是模块级变量（M149 排查出的一处真 bug）：那份副本与会话里的路径是同语义的
 * 两处真源，装载时序上只要晚半步就会整批出错——装饰层在**装载事务的 dispatch 里**就问
 * resolver，此时 `from` 若还是 undefined，`resolve()` 连在途解析都不发起（见下面 resolve
 * 的第一个分支），这一批 wikilink 会全部停在 pending 且永不自动重来（视觉场景
 * `wikilink.spec.ts` 的 `.cm-lp-wikilink-resolved` 找不到就是这个原因）。
 * 会话的 path 在装载之前就已就位（reloadSession 的第一件事），活读它没有这个时间窗。
 */
function resolveBase(): string | undefined {
  const session = editor.activeSession();
  return session.mode === "md" ? session.path : undefined;
}
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
    const from = resolveBase();
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
  const from = resolveBase();
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

/**
 * 光标/点击处的链接（M144 起外链，M145 扩到全形态）：wikilink 或标准 Markdown 链接。
 *
 * wikilink 优先且路径逐字未动：`[[x]]` 在语法树里也是一个没有 URL 子节点的 `Link`
 * 节点，标准链接判定天然不命中它，两者不会互相抢；顺序写死仍是有意的——wikilink 的
 * 语义只有 Rust link_graph 一份，先问它。
 *
 * vault 上下文（打开中的 md 文件）是 vault 内跳转类链接的前提：`[x](note.md)` 与
 * `[x](./doc.pdf)` 的解析基准就是当前文件，没有它就不算可激活的链接。外链与纯锚点
 * 不受此限（前者不需要 vault，后者就在这份文档里）。
 *
 * 键盘路径（选区 head）与鼠标路径（点击坐标）共用本判定，跟随逻辑只有一份。
 */
type LinkTarget =
  | { kind: "wikilink"; raw: string }
  | { kind: "external"; url: string }
  | { kind: "note"; target: string }
  | { kind: "asset"; target: string }
  | { kind: "anchor" };

function linkTargetAt(pos: number): LinkTarget | null {
  const raw = wikilinkAt(pos);
  if (raw !== null) {
    return resolveBase() === undefined ? null : { kind: "wikilink", raw };
  }
  const link = standardLinkAt(editor.view.state, pos);
  if (link === null) return null;
  switch (link.form.kind) {
    case "external":
      return { kind: "external", url: link.form.url };
    case "internal":
      return resolveBase() === undefined ? null : { kind: "note", target: link.form.target };
    case "asset":
      return resolveBase() === undefined ? null : { kind: "asset", target: link.form.target };
    case "anchor":
      return { kind: "anchor" };
    case "blocked":
      // 白名单外 scheme 不装饰也不激活（渲染层同样保持原文）。这里显式记一条诊断：
      // 「按了 ⌘⏎ 没反应」是 dogfood 里最难归因的一类反馈，日志要能回答它是被拒的。
      logEvent("link_open", { category: "blocked-scheme", outcome: "rejected" });
      return null;
  }
}

/** 跟随链接：应用内跳转（wikilink / 相对路径 md）与交系统默认应用（外链 / vault 内资产）
 *  各走各的链路，纯锚点只给提示（M145：不做文档内滚动跳转）。 */
function followLink(target: LinkTarget): void {
  switch (target.kind) {
    case "wikilink":
      void followWikilink(target.raw);
      break;
    case "external":
      void openExternalLink(target.url);
      break;
    case "note":
      void followNoteLink(target.target);
      break;
    case "asset":
      void openVaultAsset(target.target);
      break;
    case "anchor":
      logEvent("link_open", { category: "anchor", outcome: "unsupported" });
      toast("暂不支持锚点跳转");
      break;
  }
}

/** 外链交给系统默认应用打开（Rust 侧校验 scheme）；失败给人话提示。 */
async function openExternalLink(url: string): Promise<void> {
  try {
    await openExternalUrl(url);
  } catch (e) {
    toast(errorMessage(e));
  }
}

/**
 * 跟随相对路径 md 链接 `[x](note.md)`（M145）：解析交 Rust（`link_resolve_note`——
 * 相对当前文件所在目录的路径语义，与 wikilink 的名称匹配不同源），命中的文件走
 * 与 wikilink 同一条 `openFile` 打开链路，因此应用内只存在一套「打开一篇笔记」。
 *
 * 解析不到只提示、不创建文件：一键创建是 wikilink 的显式动作（spec §4.4），
 * 相对路径链接不继承它——作者写错路径时，凭空多出一个文件和只给一句提示相比，
 * 后者才是他要的。
 */
async function followNoteLink(target: string): Promise<void> {
  const from = resolveBase();
  if (from === undefined) return;
  try {
    const path = await linkResolveNote(from, target);
    if (path === null) {
      logEvent("link_open", { category: "internal-md", outcome: "unresolved" });
      toast(`链接目标不存在：${target}`);
      return;
    }
    logEvent("link_open", { category: "internal-md", outcome: "opened" });
    await openFile(path, openKind(path));
  } catch (e) {
    toast(errorMessage(e));
  }
}

/** 打开 vault 内的非 md 文件 / 目录 `[x](./doc.pdf)`：交系统默认应用。目标必须落在
 *  vault 内（Rust 侧前缀校验），落不进去 / 不存在时透传它的人话错误。 */
async function openVaultAsset(target: string): Promise<void> {
  const from = resolveBase();
  if (from === undefined) return;
  try {
    await linkOpenPath(from, target);
  } catch (e) {
    toast(errorMessage(e));
  }
}

// 点击跳转（spec §4.2）：⌘-Click 命中链接时阻止选区落点，直接跟随链接；
// 裸点击不拦截，保持链接文本可正常落点编辑。
// M132 收窄：鼠标路径与 D1 的 ⌘/⌃ 拆分对齐——只有 ⌘-Click 跟随链接；⌃-Click 让位给
// macOS 的系统级次级点击（右键等价手势），不再被当作链接激活。键位表只管键盘，鼠标
// 路径就地判定（收窄前是 e.metaKey || e.ctrlKey，与拆分前的键盘口径同源）。
// M144：鼠标路径同样覆盖外链——外链不需要 vault 上下文，故不再以 currentPath 提前返回。
// M145：同一条路径覆盖全部可激活形态（应用内跳转类仍要求 vault 上下文，判定在 linkTargetAt）。
editor.view.dom.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!e.metaKey) return;
  const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return;
  const target = linkTargetAt(pos);
  if (target === null) return; // 不在链接上：不拦截，选区正常落点
  e.preventDefault();
  followLink(target);
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
  // 轨道 A 原样迁入（键位与作用域不变）；M144 起跟随光标/选区处的链接——外链交系统
  // 浏览器、wikilink 走既有跳转链路；M145 补齐其余形态：相对路径 md 走应用内跳转、
  // vault 内非 md 交系统默认应用、纯锚点只提示。落在非链接处无操作（不假装有反馈）。
  "link.follow": () => {
    const target = linkTargetAt(editor.view.state.selection.main.head);
    if (target !== null) followLink(target);
  },
  // 键位查看面板（M133）：列出**生效中**的键位表（含 [keys] 覆盖的产物）。
  "app.describe-bindings": () => bindingsPanel.toggle(),
  // 文件内搜索（M139）：能力与 panel 在 src/search.ts，此处只把编辑器视图交过去。
  // 作用域 global——焦点在文件树 / 搜索框里时同样要能开（⌘F 的 mac 惯例，理由见 keys.ts）。
  "app.search-open": () => openSearch(editor.view),
  // 轻量大纲（M148）：开→关 / 关→开，无标题文档只给提示（不弹空浮层）。
  "toc.toggle": () => toc.toggle(),
  // 标签（M149）：能力与切换在 editor 的会话 API，装配层只做两件它才知道的事——
  // 切换后的表现层对齐（activateTab → syncActiveDocument）与关标签的确认。
  // `tab.close` 关的是**前台**标签；逐标签关闭钮走同一条 closeTab（同一个确认）。
  "tab.close": () => {
    void closeTab(editor.activeSession());
  },
  "tab.next": () => cycleTab(1),
  "tab.prev": () => cycleTab(-1),
  ...tabGotoCommands(),
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
// 键位查看面板（M133，app.describe-bindings）：dogfood 期的自用查看器，刻意简单——
// 不是 UX 重设计的一部分，只回答一个问题「某个键现在归谁」。
//
// 数据源是分发器真正在用的那份表（上面 applyKeyConfig 里 applyKeyOverrides 的产物），
// 不是 keys.ts 的默认表——配置过 [keys] 之后两者不同（重绑 / 解绑），面板要显示前者。
// 有实现但当前没有键位指向的命令（被解绑的）同样列出并标注「未绑定」，否则解绑之后
// 该命令就从视野里消失了。分组只表达功能族，不改变作用域语义（scope 仍由 keys.ts 定）。
//
// 关闭键（Escape / ⌃G）由面板自己消费，不进 KEY_BINDINGS：统一表是「一个 token 一条
// 绑定」（装配期重复即抛），而这两个 token 已被占用——Escape 归 editor.widget-escape
// （带 when 条件）、⌃G 归 editor.keyboard-quit。面板打开时焦点在遮罩上，那两条绑定因
// 作用域与 when 条件都不会命中，故这里不存在「同一物理键两处各写一份」的漂移；监听只
// 挂在遮罩元素上（隐藏时收不到事件），关闭动作仍回到同一条命令实现（打开态再按即关）。
// ---------------------------------------------------------------------------

/** 生效中的键位表：默认表，或默认表经 [keys] 覆盖后的产物（applyKeyConfig 写入）。 */
let effectiveBindings: readonly KeyBinding[] = KEY_BINDINGS;

/** 面板的功能分组：只列命令 id，键位与作用域一律从生效表读。
 *  9 个分组覆盖全部命令（不做文本改写的选择类命令——⌘A 全选、⌃G 撤下选择——归
 *  「移动与选择」，与光标族同属「不动文档的定位/选区命令」）；未列入任何分组的
 *  命令自动落到末尾「其他」——将来新增命令忘记归组时不会从面板里消失。 */
const BINDING_GROUPS: ReadonlyArray<{ title: string; commands: readonly CommandId[] }> = [
  { title: "移动与选择", commands: ["editor.cursor-up", "editor.cursor-down", "editor.cursor-forward", "editor.cursor-backward", "editor.line-start", "editor.line-end", "editor.select-all", "editor.keyboard-quit"] },
  { title: "扩选", commands: ["editor.extend-char-forward", "editor.extend-char-backward", "editor.extend-line-down", "editor.extend-line-up", "editor.extend-line-start", "editor.extend-line-end", "editor.extend-word-forward", "editor.extend-word-backward"] },
  { title: "删除", commands: ["editor.delete-char-forward", "editor.delete-char-backward", "editor.transpose-chars", "editor.delete-word-forward", "editor.delete-word-backward"] },
  { title: "kill-yank", commands: ["editor.kill-line", "editor.yank"] },
  { title: "翻屏", commands: ["editor.scroll-page-down", "editor.scroll-page-up", "editor.recenter"] },
  { title: "撤销", commands: ["editor.undo", "editor.redo"] },
  { title: "widget", commands: WIDGET_COMMAND_IDS },
  // M149：标签单列一组（而不是并进「全局」）——⌘W 的语义变化与 ⌘1–9 的九条直达是
  // dogfood 期最需要一眼核对的两件事，混在全局组里不容易看全。两组必须**互斥**：
  // 「全局」组用 keys.ts 的 NON_TAB_GLOBAL_COMMAND_IDS，否则同一命令会被两个分组
  // 各渲染一行（面板行数翻倍，「每条命令一行」的口径被破坏）。
  { title: "标签", commands: TAB_COMMAND_IDS },
  { title: "全局", commands: NON_TAB_GLOBAL_COMMAND_IDS },
];

/** 面板自己的关闭键（token 口径与表内绑定同源，见下面 keydown 监听）。 */
const PANEL_CLOSE_TOKENS = new Set(["Escape", "Ctrl-G"]);

interface BindingsPanel {
  /** 打开态再调用即关闭（命令与关闭键共用同一入口）。 */
  toggle(): void;
}

function createBindingsPanel(options: {
  mount: HTMLElement;
  bindings(): readonly KeyBinding[];
  /** 关闭后把焦点交还编辑器：焦点一直在遮罩上，不交还就「关掉也走不了」。 */
  restoreFocus(): void;
}): BindingsPanel {
  const overlay = document.createElement("div");
  overlay.className = "lumir-bindings-overlay";
  overlay.hidden = true;

  const panel = document.createElement("div");
  panel.className = "lumir-bindings-panel";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "键位（生效中）");

  const title = document.createElement("h2");
  title.className = "lumir-bindings-title";
  title.textContent = "键位（生效中）";
  const body = document.createElement("div");
  body.className = "lumir-bindings-body";
  const hint = document.createElement("p");
  hint.className = "lumir-bindings-hint";
  hint.textContent = "Esc / ⌃G 或点击遮罩关闭";
  panel.append(title, body, hint);
  overlay.append(panel);
  options.mount.append(overlay);

  /** 一行：一条绑定，或一条「未绑定」命令（binding 为 null）。 */
  function makeRow(command: CommandId, binding: KeyBinding | null): HTMLElement {
    const row = document.createElement("div");
    row.className = binding === null ? "lumir-bindings-row is-unbound" : "lumir-bindings-row";
    row.dataset.command = command;
    const key = document.createElement("span");
    key.className = "lumir-bindings-key";
    key.textContent = binding?.key ?? "未绑定";
    const id = document.createElement("span");
    id.className = "lumir-bindings-command";
    id.textContent = command;
    const doc = document.createElement("span");
    doc.className = "lumir-bindings-doc";
    doc.textContent = binding?.doc ?? "当前没有键位指向它（配置解绑或尚未绑定）";
    row.append(key, id, doc);
    return row;
  }

  function render(): void {
    // 生效表按命令归桶：一条命令多个键（如撤销的三个键）就是多行。
    const byCommand = new Map<string, KeyBinding[]>();
    for (const binding of options.bindings()) {
      const list = byCommand.get(binding.command) ?? [];
      list.push(binding);
      byCommand.set(binding.command, list);
    }
    const assigned = new Set<string>();
    const groups = BINDING_GROUPS.map((group) => {
      for (const command of group.commands) assigned.add(command);
      return { title: group.title, commands: [...group.commands] as CommandId[] };
    });
    const rest = COMMAND_IDS.filter((command) => !assigned.has(command));
    if (rest.length > 0) groups.push({ title: "其他", commands: rest });

    body.replaceChildren();
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "lumir-bindings-group";
      const heading = document.createElement("h3");
      heading.className = "lumir-bindings-group-title";
      heading.textContent = group.title;
      section.append(heading);
      for (const command of group.commands) {
        const keys = byCommand.get(command) ?? [];
        if (keys.length === 0) section.append(makeRow(command, null));
        else for (const binding of keys) section.append(makeRow(command, binding));
      }
      body.append(section);
    }
  }

  function toggle(): void {
    if (!overlay.hidden) {
      overlay.hidden = true;
      options.restoreFocus();
      return;
    }
    render(); // 每次打开重读生效表（配置重挂后不留旧表）
    overlay.hidden = false;
    panel.focus();
  }

  // 点击遮罩关闭；点在面板本身上不关（面板内要能选中文本）。
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) toggle();
  });

  // 关闭键复用 keys.ts 的 token 归一化，不另写一套匹配口径（否则两处会漂移）。
  overlay.addEventListener("keydown", (event) => {
    const token = keyToken(event);
    if (token === null) return;
    // Tab 必须挡在面板内（aria-modal 的语义）：面板没有可聚焦子元素，放行 Tab 会让焦点
    // 落到编辑器内容区——面板还开着，后续按键就又能穿透到文档了（本监听只有这一条职责
    // 之外的守卫，不构成第二条键位路径）。
    if (token === "Tab" || token === "Shift-Tab") {
      event.preventDefault();
      return;
    }
    if (!PANEL_CLOSE_TOKENS.has(token)) return;
    // 先于 window 上的分发器消费：分发器对已消费事件让路（defaultPrevented）。
    event.preventDefault();
    toggle();
  });

  return { toggle };
}

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
// 状态由标签栏自己的 dirty 点承担（见 renderTabs），两者同源同义。
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
  renderTabs();
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
  renderTabs();
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
  // 链接索引已在后端随 vault 打开建立；世代号自增使旧 vault 的在途 resolve
  // 回调全部作废，解析缓存与单链接降级集合整批失效
  resolveEpoch += 1;
  invalidateResolve();
  // 全部标签作废：内核只留一个未命名空文档（内部 currentFilePath 一并置空）。
  editor.reset();
  editor.setWikilinkResolver(wikilinkResolver);
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
    invalidateResolve();
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
