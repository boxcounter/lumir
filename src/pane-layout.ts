// pane 容器（change pane-system-split-view 的 tasks.md 1.1；设计来源 design.md §3「装配形状」、
// §4「会话所有权与移动标签」，语义边界见 ADR 0008 Decision 1 / 3 / 4）。
//
// 本模块是**会话所有权的账本 + 活跃 pane 状态机**，只有纯逻辑：
//   - 不 import 任何装配层模块（editor / tabs / main），不碰 DOM、不碰 EditorView；
//   - 每个 pane 的编辑器句柄由装配层经 `PaneLayoutDeps` 注入（类型参数隔离），容器只按 pane
//     持有、在收起时归还，**不解释它**（不知道句柄是不是 EditorHandle）；
//   - 标签是调用方给的**不透明对象**，容器只读它的 `path`——会话所有权按路径判定。
//
// 账本与「每个 pane 一个编辑器实例」的分工（接线时唯一要对齐的一处）：
//   - **账本管归属**：哪个标签在哪个 pane、各 pane 谁是前台、谁是活跃 pane；
//   - **编辑器管机械**：EditorView / EditorState / 装载与保存。
//   装配层必须让两者同源：本模块的 `openTab` / `closeTab` / `moveTab` 是标签集合的唯一变动通道，
//   编辑器侧的对应动作（`createSession` / `closeSession` / 目标 view 的 `setState`）在同一处跟随
//   ——REVIEW.md 第 8 条：同一语义不许两处真源。**接线从 tasks.md 分组 1.2 起，不在本 mission**；
//   本模块暂未被 `src/` 其他文件引用是预期形态。
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

/** v1 上限（ADR 0008 Decision 1）。上限二是有意约束，不是待填能力——第三次 `split` 无操作。 */
export const MAX_PANES = 2;

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
   *  - 否则调用 `create(target)` 造一个新标签追加到目标 pane。
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
      if (path !== undefined && tab.path !== path) {
        // 账本是按 path 判重的（不变量 2），create 交回的标签路径与打开目标不符会让判重失效；
        // 宁可在这里炸掉，也不留一个「同名标签可以有两份」的静默后门。
        throw new Error(`pane-layout: create 交回的标签 path=${String(tab.path)} 与目标 path=${path} 不一致`); // i18n-exempt: log
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
