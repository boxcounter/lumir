// pane 容器（change pane-system-split-view 的 tasks.md 1.1；设计来源 design.md §4「装配形状：
// createEditor 双实例化」、§6「会话所有权与『移动标签』交互」，语义边界见 ADR 0008 Decision 1 / 3 / 4）。
//
// 本模块是**会话所有权的账本 + 活跃 pane 状态机**，加上分隔条比例的两样东西：纯换算与一个
// 元素注入式的拖拽控制器（见文件末尾）。全部与装配层解耦：
//   - 不 import 任何装配层模块（editor / tabs / main）；不碰 EditorView；不创建 / 不查询
//     全局 DOM——拖拽控制器需要的分隔条元素与测量、施加、提交回调全部由调用方注入，
//     因此可脱浏览器单测；
//   - 每个 pane 的编辑器句柄由装配层经 `PaneLayoutDeps` 注入（类型参数隔离），容器只按 pane
//     持有、在收起时归还，**不解释它**（不知道句柄是不是 EditorHandle）；
//   - 标签是调用方给的**不透明对象**，容器只读它的 `path`——会话所有权按路径判定。
//
// 账本与「每个 pane 一个编辑器实例」的分工（M317 已接线，接线点在 src/main.ts）：
//   - **账本管归属**：哪个标签在哪个 pane、各 pane 谁是前台、谁是活跃 pane；
//   - **编辑器管机械**：EditorView / EditorState / 装载与保存。
//   装配层经 `reconcilePaneLedger` 把两者对齐：账本按**对象引用**持有各实例的 EditorSession
//   （同一对象、`path` 活读），`openTab` 负责登记并按 path 判重、`closeTab` 摘除、`moveTab`
//   跨 pane 迁移——REVIEW.md 第 8 条：同一语义不许两处真源。
//
//   为什么登记走「对账」而不是「openTab 作唯一创建通道」：`createEditor` 的初始文档与 `reset()`
//   的空文档由编辑器实例内部建出，装配层看不到那些创建点，无法把它们全改道经 `openTab`；
//   对账把两者按对象引用补齐（见 `reconcilePaneLedger` 的说明），循环只对差异动手。
//
// 三条不变量（`pane-layout.test.ts` 逐条钉住）：
//   1. pane 数 ≤ `MAX_PANES`（v1 = 2；第三次 split 无操作、无报错、无提示）；
//   2. **同一路径的标签在容器内至多存在于一个 pane**——跨 pane 是移动标签，不是复制标签
//      （`openTab` 命中已开文件时不调 `create`，因此不可能出现第二个 EditorState）；
//   3. 移动**不重建**标签对象：`moveTab` 只是把同一个对象从源 pane 的数组挪到目标 pane 的数组，
//      撤销史 / 选区 / 滚动位置（都在对象里）随之原样迁移。
//
// 空 pane 是**合法在场**状态：把某 pane 的最后一个标签移走或关掉，它变空但不自动收起
//（spec「移动标签致空 pane 不自动收起」）；只有 `close()` 才收起。

/** pane 标识：容器内单调递增，**收起后不重用**（再分栏得到新 id），装配层据此给 DOM 列与
 *  逐 pane 记账做 key。 */
export type PaneId = number;

/** v1 上限（ADR 0008 Decision 1）。上限二是有意约束，不是待填能力——第三次 `split` 无操作。
 *  与 Rust 侧 `vault_session::MAX_PANES` 同值（会话 schema 的 pane 数上限）——
 *  `tests/unit/session-schema-drift.test.ts` 对账两处，改一处必须同步另一处。 */
export const MAX_PANES = 2;

/** 分隔条比例的钳制区间：任一 pane 至少留两成宽（再窄标签条与正文都不可用）。
 *  与 Rust 侧 `vault_session::SPLIT_RATIO_MIN` / `SPLIT_RATIO_MAX` 同值（对账同上）——
 *  落盘值与施加值同区间，避免「盘上存 0.05、显示却是 0.2」的双真源。 */
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

/** 分隔条比例的初值 / 缺省（对半分）：与 Rust 侧 `vault_session::DEFAULT_SPLIT_RATIO` 同值。 */
export const DEFAULT_SPLIT_RATIO = 0.5;

/** 把任意比例归一进合法区间（越界取端点）。NaN 落对半；±Infinity 与越界值一样收端点
 *（与 Rust 侧 `vault_session::clamp_ratio` 同口径——NaN 才落默认，见该函数注释）。 */
export function clampSplitRatio(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

/** 空 pane 引导的显示谓词（M322，spec「分栏后出现两个文档 pane」的空态引导）：**纯函数**，
 *  四个条件缺一不可。
 *  - `split`：只在分栏态显示——单 pane 零标签维持 M149 起的既有形态（未命名空文档编辑器 +
 *    标签条整条隐藏），引导不覆盖它（「单 pane 常态逐像素不变」是本 change 的第一判据，
 *    既有单 pane 基线因此构造上零影响）；
 *  - `hasTabs` 为假：「空」按**带路径的会话**判定（与 `src/tabs.ts` 的 visibleTabsOf 同一定义
 *    ——未命名文档不是标签）；装配层从实例会话表现查，不读账本（账本会登记 path=undefined 的
 *    空会话，见 `openTab` 的文档化合法路径）；
 *  - `foregroundDirty` 为假：空 pane 的前台未命名文档是 dirty 草稿时引导让位——用户在空 pane
 *    里敲 scratch，第一个键引导即隐去、键入内容立即可见（onDirty → renderAllTabStrips 同帧
 *    同步），不把输入埋在水印底下；
 *  - `vaultLoaded`：未装载 vault 时不显示（Alex 2026-10-04 裁决）——此时左栏没有文件可点，
 *    「在左栏选一个文件」的指引不成立。 */
export function emptyPaneGuideVisible(
  split: boolean,
  hasTabs: boolean,
  foregroundDirty: boolean,
  vaultLoaded: boolean,
): boolean {
  return split && !hasTabs && !foregroundDirty && vaultLoaded;
}

/** 分栏态空 pane 的**输入闸门**（M329，Alex 2026-10-05 dogfood bug 2）：**纯函数**。
 *
 *  分栏态下「无带路径标签」的 pane MUST NOT 接受文本输入——它还没有承载任何文档，引导层是它
 *  唯一的交互面；打开 / 新建文件之后该 pane 才可编辑。缺了这条，空 pane 里敲的字会落进一份
 *  没有路径的空文档：它没有落盘基准，⌘S 只能报「No file is open…」（Alex 的现场原话
 *  「这个行为很古怪」）。
 *
 *  与 `emptyPaneGuideVisible` 的**分工**（同一分栏空态的两件事，判据各自独立）：
 *   - 那条判「引导水印**是否在场**」，条件里还有「已装 vault」与「前台非 dirty 草稿」；
 *   - 本条判「编辑器**是否可编辑**」，只看「分栏 + 该 pane 有没有文档」。
 *  两者 MUST NOT 合并成一个谓词：未装 vault 时引导不显示，但空 pane 照样不接受输入。
 *
 *  `hasTabs` 的口径与 `emptyPaneGuideVisible` / `src/tabs.ts` 的 visibleTabsOf 一致——**带路径
 *  的会话**才算文档（未命名文档不是标签）。 */
export function paneBlocksInput(split: boolean, hasTabs: boolean): boolean {
  return split && !hasTabs;
}

/** 指针横坐标 → 钳制后的比例（**纯函数**，拖拽的唯一计算）：`rect` 是 pane 容器的矩形。
 *  容器零宽（尚未布局）时落中点，不产出 NaN / Infinity。 */
export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((clientX - rect.left) / rect.width);
}

/** 分隔条拖拽所需的最小元素面：真 DOM 元素（`HTMLElement`）与单测替身都满足这一结构。
 *  本模块**不创建、不查询** DOM——元素与测量 / 施加 / 提交都由调用方注入，控制器因此可脱
 *  浏览器单测。 */
export interface DividerSurface {
  addEventListener(type: string, listener: (event: DividerPointerEvent) => void): void;
  removeEventListener(type: string, listener: (event: DividerPointerEvent) => void): void;
  setPointerCapture(pointerId: number): void;
  classList: { add(token: string): void; remove(token: string): void };
}

/** 分隔条拖拽用到的最小指针事件面。 */
export interface DividerPointerEvent {
  button: number;
  pointerId: number;
  clientX: number;
  preventDefault(): void;
}

export interface DividerDragDeps {
  /** 分隔条元素（指针捕获与拖拽态 class 的落点）。 */
  divider: DividerSurface;
  /** pane 容器矩形（比例的参照系）：每帧现测，容器尺寸变化不至于沿用旧值。 */
  measure(): { left: number; width: number };
  /** 实时施加新比例（拖拽中每次移动；**只改布局样式**）。 */
  apply(ratio: number): void;
  /** 当前生效比例（内存态真源在装配层，这里只读）。 */
  getRatio(): number;
  /** 比例写回（内存态真源在装配层）。 */
  setRatio(ratio: number): void;
  /** 松手且比例**有变化**时回调一次——**持久化入口**（写本 vault 的会话文件）。过程零回调。 */
  onCommit(ratio: number): void;
}

export interface DividerDrag {
  /** 拆监听（pane 收起时调用；元素移除前先摘干净）。 */
  destroy(): void;
}

/**
 * 分隔条拖拽控制器（pane-system-split-view tasks 5.4）：实时重排（每次移动 `apply`）、松手写盘
 * （`onCommit` 一次）、比例钳 `[SPLIT_RATIO_MIN, SPLIT_RATIO_MAX]`。
 *
 * 整条路径只读指针坐标与容器矩形、只写比例与布局样式——**依赖面里没有任何编辑器 / 会话 /
 * 撤销栈通道**，这是「拖拽全程不改文档 / 不进撤销栈 / 不改 dirty」的结构保证（断言见
 * `tests/unit/pane-layout.test.ts`：拖动只调 `apply` / `setRatio`，松手只调一次 `onCommit`）。
 */
export function createDividerDrag(deps: DividerDragDeps): DividerDrag {
  const { divider, measure, apply, getRatio, setRatio, onCommit } = deps;
  let drag: { pointerId: number; startRatio: number } | null = null;

  const onPointerDown = (event: DividerPointerEvent): void => {
    if (event.button !== 0) return;
    divider.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startRatio: getRatio() };
    divider.classList.add("dragging");
    event.preventDefault(); // 命中区内不触发文本选择
  };
  const onPointerMove = (event: DividerPointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const ratio = ratioFromPointer(event.clientX, measure());
    setRatio(ratio);
    apply(ratio);
  };
  const endDrag = (event: DividerPointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const { startRatio } = drag;
    drag = null;
    divider.classList.remove("dragging");
    const ratio = getRatio();
    if (ratio !== startRatio) onCommit(ratio);
  };

  divider.addEventListener("pointerdown", onPointerDown);
  divider.addEventListener("pointermove", onPointerMove);
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  return {
    destroy() {
      divider.removeEventListener("pointerdown", onPointerDown);
      divider.removeEventListener("pointermove", onPointerMove);
      divider.removeEventListener("pointerup", endDrag);
      divider.removeEventListener("pointercancel", endDrag);
    },
  };
}

/** 标签在账本里的最小形状：**会话所有权按 `path` 判定**（ADR 0008 Decision 4）。
 *  `undefined` 是未命名文档，允许同时存在多份（它们不参与判重）。 */
export interface PaneTab {
  readonly path: string | undefined;
}

/** 一个 pane：一个编辑器句柄 + 一份有序标签 + 前台标签下标。 */
export interface Pane<Tab extends PaneTab, Handle> {
  readonly id: PaneId;
  /** 该 pane 的编辑器句柄（装配层注入；容器只持有，不解释）。 */
  readonly handle: Handle;
  /** 有序标签（打开序 = 标签栏从左到右）。**容器是唯一写入者**，外部只当只读数组用。 */
  readonly tabs: Tab[];
  /** 前台标签在 [`tabs`] 里的下标；**空 pane 为 -1**。同上：容器唯一写入者。 */
  foreground: number;
}

export interface PaneLayoutDeps<Handle> {
  /** 为一个 pane 造编辑器句柄。root pane 与每次 `split()` 的 pane 都经它产出；装配层在这里
   *  `createEditor` 并把句柄绑到该 pane 的 DOM 列（容器不知道 DOM 的存在）。 */
  createHandle(paneId: PaneId): Handle;
  /** 归还一个 pane 的编辑器句柄（`close()` 时调用；装配层在这里拆 EditorView / 卸载 DOM 列）。
   *  调用时机：标签已全部并入目标 pane **之后**、`close()` 返回之前——句柄释放与标签归属无关，
   *  被移走的标签对象不受影响。 */
  disposeHandle(handle: Handle): void;
}

/** pane 容器对外的全部能力。泛型参数：`Tab` = 标签对象（装配层传 `EditorSession`），
 *  `Handle` = 编辑器句柄（装配层传 `EditorHandle`）——本模块两者都不 import。 */
export interface PaneLayout<Tab extends PaneTab, Handle> {
  /** 全部 pane，按横向顺序（左 → 右）。至少一个、至多 `MAX_PANES` 个。 */
  panes(): readonly Pane<Tab, Handle>[];
  /** 是否已分栏（两个 pane）。 */
  isSplit(): boolean;
  /** 活跃 pane（Emacs selected-window 语义；恒存在）。 */
  active(): Pane<Tab, Handle>;
  /** 活跃 pane 的编辑器句柄——编辑器命令 / modeline / 树高亮 / toc 内容源的解析入口。 */
  activeHandle(): Handle;
  /** 某 pane 的前台标签；空 pane 返回 undefined。 */
  foregroundTab(pane: Pane<Tab, Handle>): Tab | undefined;
  /** 活跃 pane 的前台标签；活跃 pane 为空时 undefined。 */
  activeTab(): Tab | undefined;
  /** 按路径找标签（在全部 pane 里找；同一路径至多命中一个）。未打开返回 undefined。 */
  tabForPath(path: string): Tab | undefined;
  /** 某标签当前的所属 pane；不在容器里返回 undefined。 */
  paneOf(tab: Tab): Pane<Tab, Handle> | undefined;

  /** 在活跃 pane 右侧新开一个**空 pane** 并置为活跃（spec「分栏后出现两个文档 pane」）。
   *  返回新 pane；已达上限二返回 `null`（无操作，不报错、不提示）。 */
  split(): Pane<Tab, Handle> | null;
  /** 收起**活跃 pane**：其全部标签按序并入另一 pane（各带状态），其前台标签成为目标 pane 的
   *  前台，目标 pane 成为活跃 pane（裁决点 2 = 方案 A，不丢标签、不弹关标签确认）。
   *  返回被收起的 pane（已脱离容器：`tabs` 清空、`foreground` 归 -1，句柄已归还）；单 pane
   *  时返回 `null`（无操作）。 */
  close(): Pane<Tab, Handle> | null;

  /** 焦点进入某 pane 的 contentDOM → 该 pane 成为活跃 pane（焦点移出内容区到 chrome 时
   *  **不调用**本函数，活跃 pane 因此不漂移）。id 不存在时抛错（装配层拿的是 pane 对象）。 */
  activate(id: PaneId): void;
  /** 切到另一个 pane（`pane.other`）；单 pane 时无操作返回 false。 */
  activateOther(): boolean;
  /** 把某 pane 的某个标签置为该 pane 的前台，并令该 pane 成为活跃 pane（点击标签栏 = 焦点
   *  进入该 pane）。标签不在该 pane 里返回 false。 */
  activateTab(id: PaneId, tab: Tab): boolean;

  /** 「打开」意图的唯一入口（design §6）：目标缺省活跃 pane。
   *  - 同一 `path` 已在容器内任何 pane 打开 → 执行**移动**（源 pane 失去它），
   *    **不调用 `create`**——因此不可能为同一文件创建第二个 EditorState；
   *  - 否则调用 `create(target)` 造一个新标签追加到目标 pane。**`create` 交回的标签其 `path`
   *    必须与本次 `path` 相等**（含「都未命名」），不等即抛错——两个方向都不放行，否则账本的
   *    判重键与标签实际归属会错位，同 path 第二份标签得以静默落下。
   *  两种情形都把目标 pane 置为活跃、把该标签置为其前台，返回目标 pane 的前台标签。 */
  openTab(
    path: string | undefined,
    create: (owner: Pane<Tab, Handle>) => Tab,
    target?: PaneId,
  ): Tab;
  /** 跨 pane 移动标签（标签条拖拽路径；`openTab` 的判重分支也走它）。标签已经是目标 pane 的
   *  成员时只把它置为前台。目标缺省活跃 pane；目标 pane 成为活跃 pane。标签不在容器里返回 false。 */
  moveTab(tab: Tab, target?: PaneId): boolean;
  /** 关闭一个标签（`closeTabNow` 的账本侧）。所属 pane 变空则保持空 pane 在场；活跃 pane 不变。
   *  标签不在容器里返回 false。 */
  closeTab(tab: Tab): boolean;
}

/**
 * 建 pane 容器。构造即建 root pane（单 pane 常态），其句柄由 `deps.createHandle(1)` 产出。
 *
 * 泛型无法从 deps 推断（deps 只用到 `Handle`），调用点显式写：
 * `createPaneLayout<EditorSession, EditorHandle>({ … })`。
 */
export function createPaneLayout<Tab extends PaneTab, Handle>(
  deps: PaneLayoutDeps<Handle>,
): PaneLayout<Tab, Handle> {
  let nextId = 2;
  let activeId: PaneId = 1;
  const panes: Pane<Tab, Handle>[] = [makePane(1)];

  function makePane(id: PaneId): Pane<Tab, Handle> {
    return { id, handle: deps.createHandle(id), tabs: [], foreground: -1 };
  }

  function paneById(id: PaneId): Pane<Tab, Handle> {
    const found = panes.find((pane) => pane.id === id);
    if (found === undefined) {
      const ids = panes.map((pane) => pane.id).join(", ");
      // 装配层拿到的是 pane 对象，未知 id 只可能是接线错误——就地炸掉，不静默当成无操作。
      throw new Error(`pane-layout: 没有 id 为 ${id} 的 pane（在场的是 ${ids}）`); // i18n-exempt: log
    }
    return found;
  }

  function paneOf(tab: Tab): Pane<Tab, Handle> | undefined {
    return panes.find((pane) => pane.tabs.includes(tab));
  }

  /** 摘除一份标签并维护前台下标：摘的是前台 → 落到右邻，没有右邻落左邻，都没有则 -1；
   *  摘的在前台**之前** → 前台左移一位。与 `src/editor.ts` 的 `closeSession` 同口径
   *（右邻优先），但**不代造未命名空文档**——那是每个 pane 的编辑器内核的事，账本只记归属：
   *  关掉某 pane 最后一个标签后该 pane 就是空的（空 pane 合法在场），装配层若要维持「空态 =
   *  未命名空文档」的既有表现，须把内核造出的那份空会话经 `openTab(undefined, …)` 登记进来。 */
  function removeTabAt(pane: Pane<Tab, Handle>, index: number): void {
    pane.tabs.splice(index, 1);
    if (pane.foreground === index) {
      pane.foreground = pane.tabs.length === 0 ? -1 : Math.min(index, pane.tabs.length - 1);
    } else if (pane.foreground > index) {
      pane.foreground -= 1;
    }
  }

  function activate(id: PaneId): void {
    paneById(id);
    activeId = id;
  }

  function moveTab(tab: Tab, target?: PaneId): boolean {
    const owner = paneOf(tab);
    if (owner === undefined) return false;
    const targetPane = target === undefined ? active() : paneById(target);
    if (owner === targetPane) {
      // 已在本 pane：只把它置为前台（拖回原 pane / 打开本 pane 已开的文件都落在这里）。
      targetPane.foreground = targetPane.tabs.indexOf(tab);
      activeId = targetPane.id;
      return true;
    }
    removeTabAt(owner, owner.tabs.indexOf(tab));
    targetPane.tabs.push(tab);
    targetPane.foreground = targetPane.tabs.length - 1;
    activeId = targetPane.id;
    return true;
  }

  function active(): Pane<Tab, Handle> {
    return paneById(activeId);
  }

  function foregroundTab(pane: Pane<Tab, Handle>): Tab | undefined {
    return pane.foreground >= 0 ? pane.tabs[pane.foreground] : undefined;
  }

  function tabForPath(path: string): Tab | undefined {
    for (const pane of panes) {
      const found = pane.tabs.find((tab) => tab.path === path);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  return {
    panes: () => panes,
    isSplit: () => panes.length > 1,
    active,
    activeHandle: () => active().handle,
    foregroundTab,
    activeTab: () => foregroundTab(active()),
    tabForPath,
    paneOf,

    // 落点规则（裁决/规格逐条对应）：新 pane 成为活跃 pane，且恒在活跃 pane 右侧
    //（分栏只在单 pane 时发生，因此等价于追加到列表末位）。
    split() {
      if (panes.length >= MAX_PANES) return null;
      const pane = makePane(nextId++);
      panes.push(pane);
      activeId = pane.id;
      return pane;
    },

    // 落点规则：目标（存活）pane 成为活跃 pane；被收起 pane 的前台标签在合并后仍是前台。
    close() {
      if (panes.length === 1) return null;
      const closing = active();
      const survivor = panes.find((pane) => pane !== closing);
      if (survivor === undefined) return null;
      const base = survivor.tabs.length;
      for (const tab of closing.tabs) survivor.tabs.push(tab);
      if (closing.foreground >= 0) survivor.foreground = base + closing.foreground;
      panes.splice(panes.indexOf(closing), 1);
      // 已收起的 pane 不持有任何标签（tabs 已全部并入 survivor），清空以免留下悬空的归属读数。
      closing.tabs.length = 0;
      closing.foreground = -1;
      activeId = survivor.id;
      deps.disposeHandle(closing.handle);
      return closing;
    },

    activate,

    activateOther() {
      const other = panes.find((pane) => pane.id !== activeId);
      if (other === undefined) return false;
      activeId = other.id;
      return true;
    },

    activateTab(id, tab) {
      const pane = paneById(id);
      const index = pane.tabs.indexOf(tab);
      if (index < 0) return false;
      pane.foreground = index;
      activeId = id;
      return true;
    },

    openTab(path, create, target) {
      const targetPane = target === undefined ? active() : paneById(target);
      if (path !== undefined) {
        const existing = tabForPath(path);
        if (existing !== undefined) {
          moveTab(existing, targetPane.id);
          return existing;
        }
      }
      const tab = create(targetPane);
      // 账本是按 path 判重的（不变量 2），create 交回的标签路径与打开目标不符会让判重失效。
      // **无条件比对**（不只在 path 有值时）：反向的 `openTab(undefined, …)` 交回一个带 path 的
      // 标签同样能绕过判重、静默落下第二份同 path 标签——两个方向都要在这里炸掉。
      // 文档化的合法路径（空会话经 `openTab(undefined, …)` 登记）交回的标签 path 也是 undefined，
      // 不受这条校验影响。
      if (tab.path !== path) {
        throw new Error(`pane-layout: create 交回的标签 path=${String(tab.path)} 与目标 path=${String(path)} 不一致`); // i18n-exempt: log
      }
      targetPane.tabs.push(tab);
      targetPane.foreground = targetPane.tabs.length - 1;
      activeId = targetPane.id;
      return tab;
    },

    moveTab,

    closeTab(tab) {
      const owner = paneOf(tab);
      if (owner === undefined) return false;
      removeTabAt(owner, owner.tabs.indexOf(tab));
      return true;
    },
  };
}
