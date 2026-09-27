// 标签（M149）：模型就是 editor 的会话列表（顺序 = 打开顺序），本模块只多维护标签栏
// DOM。选中 / 关闭 / 切换都经内核的会话 API，这里不自己存第二份文档清单
//（REVIEW.md 第 8 条：同一语义不要两处真源）。
//
// M254（两个 change 同批）：**预览标签机制退场**（change preview-tab-removal，Alex
// 2026-09-27 反馈「第一个 TAB 名是斜体」）——单击树文件也开正式标签，「可复用标签」的
// 挑选与 `is-preview` 一并删除，落点意图因此只剩 `"new"`（新开）/ `"current"`（就地替换）。
// 同批**新增标签的右键菜单**（change tab-strip-context-menu）：三条关闭路径 Close /
// Close Other Tabs / Close Tabs to the Right，脏标签复用 M149 的 sticky 确认（见
// closeEach / showCloseConfirm 的说明）。菜单浮层与文件树菜单共用一套皮肤（`style.css` 的
// `.ft-menu` / `.tab-menu` 选择器对），机制各写各的——理由见该 change 的 design。
//
// M151 从 main.ts 抽出（M127 的拆分判据「main.ts 收敛为装配层」的续作）。抽出的判据：
// 会话模型的读写全在 editor 的会话 API，本模块不持有任何状态，只是「会话列表 → 标签栏
// DOM + 切换/关闭动作」这一层表现与交互；装配侧注入的入口每一个都只有一个职责，
// 且都是本模块看不到的事实：
//   - saveCurrent：保存链路在 save-controller（关标签前的「保存并关闭」）；
//   - invalidateResolve：解析缓存的 from 基准随前台文档而变，能力在 link-follow.ts；
//   - showEditor：撤下「暂不支持预览」覆盖层（覆盖层属装配层的编辑器区）；
//   - syncActiveDocument：前台文档变化后的表现层**一次**对齐，它在装配层（要同时对齐
//     modeline / 文件树 / 大纲 / 标签栏），因此 activateTab 与 closeTabNow 末了都要回调它。
//     这条回调与 renderTabs 构成一次「本模块 → 装配层 → 本模块」的往返，与抽出前
//     两个函数同处一个文件时的调用关系逐字相同。
//
// 关闭确认的未命名文档守卫（reviewer r1 P2-1 的那条）在 closeTab 里，语义见该函数注释。

import type { EditorHandle, EditorSession } from "./editor";
import { TAB_GOTO_IDS, keyToken } from "./keys";
import type { CommandRunner } from "./keys";
import { baseName } from "./tree";

// ---------------------------------------------------------------------------
// 文案（编号见 文案-Copy.md 的 D148 起；本模块是它们唯一一份字面量）
// ---------------------------------------------------------------------------

/** 标签右键菜单的读屏名（`role=menu` 的 aria-label）。不叫「右键菜单」：键盘路径也能开，
 *  读屏用户没有「右键」这个概念（与 D125 文件树菜单同口径）。 */
export const TAB_MENU_LABEL = "标签操作";
/** 菜单三项（D149–D151）。**上屏英文是 Alex 2026-09-27 的裁决**（M254 菜单初上屏为中文，
 *  Alex 答复「上屏」给英文）：Close / Close Other Tabs / Close Tabs to the Right 是 Alex 给的
 *  原文，逐字保留；deck 里两列因此对调（上屏文案在 English 列，原中文措辞移到中文列备查）。
 *  不跟界面语言走的可见文案由此不止 D114 的 END 一处。 */
export const TAB_MENU_CLOSE = "Close";
export const TAB_MENU_CLOSE_OTHERS = "Close Other Tabs";
export const TAB_MENU_CLOSE_RIGHT = "Close Tabs to the Right";

export type TabMenuAction = "close" | "close-others" | "close-right";

export interface TabMenuItem {
  action: TabMenuAction;
  label: string;
}

/** 项集（菜单渲染、单测、验收断言三处同源，与文件树菜单的 `menuItemsFor` 同一纪律）。 */
export function tabMenuItems(): TabMenuItem[] {
  return [
    { action: "close", label: TAB_MENU_CLOSE },
    { action: "close-others", label: TAB_MENU_CLOSE_OTHERS },
    { action: "close-right", label: TAB_MENU_CLOSE_RIGHT },
  ];
}

/** 可见标签（有文件路径的会话），按打开顺序。标签栏、⌘1–9、⌃⇥、两条「批量关闭」共用
 *  这一份口径——未命名文档不是标签（空态就是它），所以一律经这里过滤。 */
function visibleTabsOf(sessions: readonly EditorSession[]): EditorSession[] {
  return sessions.filter((session) => session.path !== undefined);
}

/** 「关闭其他标签」的目标：除目标之外的全部可见标签。
 *  **本版不做任何保留**：标签只有一种（预览机制已退场），没有 pinned 一说——目标是哪一条，
 *  留下的就是哪一条，与它是不是当前激活项无关（右键不改上下文，见 renderTabs 的注释）。 */
export function closeOtherTargets(
  sessions: readonly EditorSession[],
  target: EditorSession,
): EditorSession[] {
  return visibleTabsOf(sessions).filter((session) => session !== target);
}

/** 「关闭右侧标签」的目标：标签栏里排在目标**严格右侧**的全部可见标签（与浏览器同口径，
 *  目标是哪一条由右键落在哪一条上决定，不由激活项决定）。目标不在列表里（已被别处关掉）
 *  时无目标，返回空。 */
export function closeRightTargets(
  sessions: readonly EditorSession[],
  target: EditorSession,
): EditorSession[] {
  const tabs = visibleTabsOf(sessions);
  const index = tabs.indexOf(target);
  return index < 0 ? [] : tabs.slice(index + 1);
}

/** 顺序关闭一批标签：**逐个等前一个落地再动下一个**。
 *
 *  这条顺序不是排版偏好，是正确性要求：脏标签的关闭要弹 M149 的 sticky 确认，一次只该问
 *  一个（同时弹两条确认浮条会让用户不知道自己在答复哪一个；后弹的那条还会把前一条挤在
 *  同一个浮条区里）。`closeOne` 返回 false（用户取消 / 保存未闭环 / 点掉浮条没答复）即停手，
 *  剩下的标签原样不动——批量关闭 MUST NOT 在用户还没答复时就关掉后面的。
 *
 *  单测覆盖它的两个性质：顺序（前一个 resolve 之前不调下一个）与停手（false 之后不再调）。 */
export async function closeEach(
  targets: readonly EditorSession[],
  closeOne: (session: EditorSession) => Promise<boolean>,
): Promise<void> {
  for (const session of targets) {
    if (!(await closeOne(session))) return;
  }
}

export interface TabsDeps {
  editor: EditorHandle;
  /** 标签栏容器（shell.tabStrip）。 */
  mount: HTMLElement;
  /** 右键菜单的挂点（app-shell 根）：标签栏自己是横向滚动容器（overflow-x: auto），
   *  菜单挂进去会被裁掉——与文件树菜单同一条理由。 */
  overlayMount: HTMLElement;
  /** 提示出口（关标签确认用的是 sticky 提示）。第 4 个参数是「sticky 浮条被点掉、用户没有
   *  选任何出口」——批量关闭靠它知道该停手（见 closeEach）。 */
  toast: (
    text: string,
    actions: Array<{ label: string; run(): void }>,
    sticky?: boolean,
    onDismiss?: () => void,
  ) => void;
  /** 保存**前台**文档（main 的 save.save）；关标签确认里的「保存并关闭」用它。 */
  saveCurrent: () => Promise<void>;
  /** wikilink 解析缓存整批失效（from 基准随前台文档而变，能力在 src/link-follow.ts）。 */
  invalidateResolve: () => void;
  /** 撤下「暂不支持预览」覆盖层（切换 / 关闭标签后）。 */
  showEditor: () => void;
  /** 前台文档变化后的表现层一次对齐（装配层的 syncActiveDocument）。 */
  syncActiveDocument: () => void;
}

export interface TabsHandle {
  /** 从会话列表**全量重建**标签栏（前台会话 / 会话集合变化后调用）。 */
  renderTabs(): void;
  /** 切换前台会话（已是前台时只重绘标签栏）。 */
  activateTab(session: EditorSession): void;
  /** 关标签：有未保存修改的先给三个出口确认。 */
  closeTab(session: EditorSession): Promise<void>;
  /** 按意图挑落点会话（只决定「落到哪个标签」，内容装载在 openFile 里做）：`"new"` = 新开
   *  一个标签（有可以落地的空会话就复用它），`"current"` = 就地替换前台会话。 */
  targetSessionFor(intent: "new" | "current"): EditorSession;
  /** 循环切换（⌃⇥ / ⌃⇧⇥）：首尾回卷。 */
  cycleTab(delta: number): void;
  /** ⌘1–9 的九条命令实现（用 TAB_GOTO_IDS 生成，序号与命令 id 出自同一次遍历）。 */
  gotoCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
}

export function createTabs(deps: TabsDeps): TabsHandle {
  const { editor, mount, overlayMount, toast, saveCurrent, invalidateResolve, showEditor, syncActiveDocument } =
    deps;

  // 右键菜单本体（M254）：菜单与确认框的界面形态在本模块，动作也在这里——与文件树菜单的
  // 分工不同（那边的动作在装配层，因为它要 vault 根、后端命令与树的内联编辑；标签的关闭
  // 只要会话 API 与提示出口，本模块全都有，绕一趟装配层只会多一层转发）。
  const tabMenu = createTabContextMenu({
    mount: overlayMount,
    onSelect: (action, session) => runTabMenuAction(action, session),
    restoreFocus: (session) => focusTab(session),
  });

  /** 标签栏渲染：从会话列表**全量重建**。标签数量是人的注意力量级（几到十几个），全量重建
   *  比增量 diff 简单，也天然不会漂。空态（没有任何带路径的会话）整条隐藏——它在网格里
   *  不占行高，所以空态布局与多标签之前逐像素一致（整页基线的空态对照因此不需要更新）。
   *  标签可见文本是路径末段：basename 派生全前端只有一份（`src/tree.ts` 的 baseName，
   *  REVIEW.md 第 8 条），标签栏、文件树、侧栏头的 vault 名与切换器列表共用它。 */
  function renderTabs(): void {
    const sessions = editor.sessions().filter((session) => session.path !== undefined);
    const active = editor.activeSession();
    mount.hidden = sessions.length === 0;
    mount.replaceChildren(
      ...sessions.map((session) => {
        const path = session.path as string;
        const name = baseName(path);
        const isActive = session === active;

        const tab = document.createElement("div");
        tab.className = "tab";
        tab.dataset.path = path;
        tab.classList.toggle("is-active", isActive);
        // 整区可点（M238，Alex 2026-09-26 报告）：点标签的**任意区域**都切换，只有 × 除外。
        // 当时的现场是「只有点文件名文字才切换」——动作绑在 `.tab-open` 上，而那个按钮的
        // 盒被 `.tab` 的 `align-items: center` 压成行高、又不覆盖标签的左右内边距，实测
        // 只有中间那块 54×15 的文字盒是热的（标签 103×29，四条边都是死区）。
        //
        // 为什么绑容器不绑按钮：按钮的盒由 flex 布局算，「撑满标签」的两种做法都动几何——
        // 负 margin 方案实测能补上左侧 12px 与上下的行高，但**标签右内边距（12px）与 1px
        // 透明边框仍是死区**（打开的盒右缘只到 x=321，而标签到 345、× 到 332），且它靠
        // 「改 flex 基础尺寸」换来的覆盖要逐处核基线；把按钮移出文档流则会打断标签宽度的
        // 计算。绑在容器上对布局零改动：命中的是整个 `.tab` 盒，× 的 click 自己
        // stopPropagation（下一段），因此 × 仍是独立控件。
        //
        // **这里只绑 click，不绑 mousedown**（M238 真机实测，别照抄按钮上那条 preventDefault）：
        // 给 `.tab` 加 `mousedown` + `preventDefault()` 之后，真机验收场景 39 的「标识块上按下
        // 拖拽窗口成立」稳定失败（`window.moved` 判红、窗口坐标 Δ=(0,0)，1/1 复现；去掉这一条
        // 即 2/2 PASS——同一次实验里 click 那条一直保留）。拖拽落点在窗口 (1160,21)，是标题栏
        // 右端的标识块、根本不经过标签，因此成因**未定位**；结论按实测走：不加它，标签的空白区
        // 照样切换（本 change 的断言覆盖），代价只是从空白区按下时不再阻止默认行为（焦点 / 选择）。
        // 想把它加回来的人：先跑 `node scripts/acceptance/run.mjs 39`。
        tab.addEventListener("click", () => activateTab(session));

        // 标签的右键菜单（M254，change tab-strip-context-menu）：右键**不改上下文**——这里
        // 不调 activateTab，菜单里的三项都作用于「指针下这一个标签」，与激活项无必然关系
        //（与文件树菜单同一条口径：右键即改选中的代价不对称，且「关闭右侧」需要一个不由
        // 激活项决定的锚点）。
        //
        // 监听绑在标签元素上而不是容器上（M251 把文件树的挪到了容器，理由不同）：`.tab` 的
        // 盒就是用户眼里的「这一条」，标签栏的 padding 与标签之间的间隙不属于任何一条，在
        // 那些位置右键本就不该给出「某个标签的菜单」。
        tab.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          tabMenu.open(session, { x: event.clientX, y: event.clientY });
        });

        const open = document.createElement("button");
        open.type = "button";
        open.className = "tab-open";
        open.setAttribute("role", "tab");
        open.setAttribute("aria-selected", String(isActive));
        // 读屏名点名文件名 + 它自己的未保存状态（文案 D90）；悬停提示给完整相对路径
        //（同名文件分散在不同目录时要能分辨，文案 D91）。
        open.setAttribute("aria-label", session.dirty ? `${name}（未保存）` : name);
        open.title = path;
        // 按钮上的这条与 M149 起逐字相同（点标签不该抢编辑器焦点、不拖出选区）。它不在
        // 拖拽问题的那条路径上（拖拽落点在标题栏右端的标识块），保留原样。
        open.addEventListener("mousedown", (event) => event.preventDefault());

        const dot = document.createElement("span");
        dot.className = "tab-dirty";
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
    // 全量重建之后活跃标签可能落在滚动视口之外（键盘切换 / 新建标签都不会自带横向滚动），
    // 这里的对齐是「活跃标签必须完整可见」这条不变量的唯一落点。
    ensureActiveVisible();
  }

  /** 活跃标签完整可见于标签栏的滚动视口（M238）。溢出由 `.tabstrip` 的横向滚动承载，
   *  而**只有**用户手势或浏览器默认行为会滚动它：⌘1–9 / ⌃⇥ / ⌘W 后的落点 / 新建标签都会
   *  让活跃标签停在视口外——用户看到的是「切了，但看不出切到哪」（Alex 2026-09-26 现场，
   *  红箭头指向的正是被裁掉的那一条）。
   *
   *  判据用矩形而不是 `scrollWidth`：算的是真实可视区（padding 盒，`clientLeft` 之外的
   *  `clientWidth` 段），左内边距与当前滚动位置都自动落进去。只朝**需要的那一侧**补差
   *  （`nearest` 语义）——活跃标签已在视口内时一个像素都不动，否则每次重绘都会把用户
   *  手动滚出来的位置抹掉。 */
  function ensureActiveVisible(): void {
    const active = mount.querySelector<HTMLElement>(".tab.is-active");
    if (active === null || mount.clientWidth === 0) return;
    const box = mount.getBoundingClientRect();
    const viewLeft = box.left + mount.clientLeft;
    const viewRight = viewLeft + mount.clientWidth;
    const rect = active.getBoundingClientRect();
    if (rect.left < viewLeft) mount.scrollLeft -= viewLeft - rect.left;
    else if (rect.right > viewRight) mount.scrollLeft += rect.right - viewRight;
  }

  function activateTab(session: EditorSession): void {
    if (session !== editor.activeSession()) {
      editor.activateSession(session);
      invalidateResolve(); // from 变了（多半是另一篇文档），按 from 键控的缓存整批失效
      showEditor();
    }
    // 已经是前台时也要重绘：调用方可能在本次调用前改过会话的可见属性（路径 / 未保存状态），
    // 标签栏必须跟着变。
    syncActiveDocument();
  }

  /** 关标签：有未保存修改的先给三个出口确认（文案 D92 / D93）。
   *
   * **未命名文档（没有路径）不是标签**：⌘W 与逐标签关闭钮对它一律无操作（reviewer r1 P2-1）。
   * 它的内容只活在内存里，根本没有「关掉」这个语义——不加这条守卫时，冷启动的 SAMPLE 演示
   * 文档会被静默换成一份空文档（用户看到的是文档被无声清空），对一个无路径的 dirty 文档还会
   * 弹出主体为空的确认浮条（`「」有未保存修改…`）。spec 与 proposal 都写「零标签时 ⌘W 无操作」，
   * 这条守卫就是它的落点。
   *
   * M254：返回值在用户选定出口（或点掉浮条）之后才 resolve——批量关闭（closeEach）靠这个
   * 顺序逐个问、逐个关。⌘W 与 × 那条单标签路径照样 `void` 调用，用户可见行为不变。 */
  async function closeTab(session: EditorSession): Promise<void> {
    await resolveClose(session);
  }

  /** 关一个标签并等它**真的**关掉：干净的直接关，脏的弹 M149 的既有确认。
   *  返回值 = 「这个标签已经关掉了」，批量关闭据此决定继续还是停手。 */
  function resolveClose(session: EditorSession): Promise<boolean> {
    const path = session.path;
    if (path === undefined) return Promise.resolve(false);
    // 已经不在了（被前一个动作带走 / 别处关掉）：那不是失败，继续下一个。
    if (!editor.sessions().includes(session)) return Promise.resolve(true);
    if (!session.dirty) {
      closeTabNow(session);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => showCloseConfirm(session, path, resolve));
  }

  /** 关标签的确认（文案 D92 / D93）：M149 的既有 sticky 浮条与三个出口原样复用——批量关闭
   *  MUST NOT 自造第二套确认 UI。`done(closed)` 在用户选定出口**或点掉浮条**后恰好调用一次；
   *  点掉浮条按「没答复」处理（closed = false），批量关闭因此停手，后面的标签原样不动。
   *
   *  浮条本体的点击与动作钮的点击靠 main.ts 的 `toast` 里那条 `stopPropagation` 分开：动作钮
   *  已经给出答复，不该再走「点掉浮条」这一路——「保存并关闭」的保存是异步的，早一步的
   *  `done(false)` 会让批量关闭在保存落地之前就停手。 */
  function showCloseConfirm(
    session: EditorSession,
    path: string,
    done: (closed: boolean) => void,
  ): void {
    let answered = false;
    const settle = (closed: boolean): void => {
      if (answered) return;
      answered = true;
      done(closed);
    };
    toast(
      `「${path}」有未保存修改，关闭后修改将丢失`,
      [
        { label: "保存并关闭", run: () => void saveThenClose(session).then(() => settle(!session.dirty)) },
        {
          label: "放弃修改并关闭",
          run: () => {
            closeTabNow(session);
            settle(true);
          },
        },
        { label: "取消", run: () => settle(false) },
      ],
      true,
      () => settle(false),
    );
  }

  /** 保存链路以「前台文档」为落点，所以先把要关的这一个切到前台再存——顺序是有意的，
   *  不是随手切的。保存未闭环（冲突 / 写失败 / 无落盘基准）时不关：用户还没处置完。 */
  async function saveThenClose(session: EditorSession): Promise<void> {
    activateTab(session);
    await saveCurrent();
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

  /** 菜单三项的落点。三条路径都经 `resolveClose`：脏标签一律复用 M149 的 sticky 确认，
   *  不新造确认 UI。「关闭其他 / 右侧」是**批量**——交 closeEach 顺序关，用户取消即停手
   *  （停手后剩下的标签还在，脏内容一个字节都不动）。 */
  function runTabMenuAction(action: TabMenuAction, session: EditorSession): void {
    if (action === "close") {
      void closeTab(session);
      return;
    }
    const sessions = editor.sessions();
    const targets =
      action === "close-others"
        ? closeOtherTargets(sessions, session)
        : closeRightTargets(sessions, session);
    void closeEach(targets, resolveClose);
  }

  /** 菜单关闭后把焦点还给触发它的那个标签。**按路径现查**而不是存元素引用：renderTabs 是
   *  全量重建（replaceChildren），菜单动作里关掉任何标签都会让打开时抓住的元素脱离文档，
   *  存下来的引用 focus() 落在一个不在场的节点上（等于没还）。
   *  那个标签已经不在了（被这次动作关掉）就落到当前激活的标签上——焦点不该掉回 body。 */
  function focusTab(session: EditorSession): void {
    const mine = session.path === undefined ? null : tabOpenElement(session.path);
    (mine ?? mount.querySelector<HTMLElement>(".tab.is-active .tab-open"))?.focus();
  }

  /** 某个路径的标签本体按钮（焦点归还的锚点）。按 `data-path` 逐条比对而不是拼选择器：
   *  路径里可能出现引号等需要转义 / 值得避免的字符。 */
  function tabOpenElement(path: string): HTMLElement | null {
    for (const tab of mount.querySelectorAll<HTMLElement>(".tab")) {
      if (tab.dataset.path === path) return tab.querySelector<HTMLElement>(".tab-open");
    }
    return null;
  }

  /** 按意图挑落点会话（只决定「落到哪个标签」，内容装载在 openFile 里做）：
   *  - "current"：前台会话就地换文档（跟随链接 / 另存为新文件 / 恢复崩溃备份）；
   *  - "new"：新开一个标签（单击 / 双击 / ⌘-点击树文件，以及新建文件后的自动打开）。
   *
   *  空态里那个**没有文件**的会话不是一个标签（冷启动的示例文档、关掉最后一个标签后的空
   *  文档），它就是「还没有打开任何文件」这个状态本身，因此就地复用它——否则每次单击都会
   *  在会话列表里留下一份看不见的空会话。复用只在它**干净**时发生：脏的空文档有真实内容
   *  且没有落盘基准（openFile 的守卫在它是前台时会拦下），复用它等于丢掉那份草稿，因此脏的
   *  一律新开。 */
  function targetSessionFor(intent: "new" | "current"): EditorSession {
    if (intent === "current") return editor.activeSession();
    const reusable = editor.sessions().find(
      (session) => session.path === undefined && !session.dirty,
    );
    return reusable ?? editor.createSession();
  }

  /** 可见标签（有文件路径的会话），按打开顺序。标签栏、⌘1–9、⌃⇥ 共用这一份口径——
   *  未命名文档不是标签（空态就是它），所以一律经这里过滤。 */
  function visibleTabs(): EditorSession[] {
    return visibleTabsOf(editor.sessions());
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
  function gotoCommands(): Record<(typeof TAB_GOTO_IDS)[number], CommandRunner> {
    const table = {} as Record<(typeof TAB_GOTO_IDS)[number], CommandRunner>;
    TAB_GOTO_IDS.forEach((id, index) => {
      table[id] = () => activateTabByIndex(index);
    });
    return table;
  }

  return { renderTabs, activateTab, closeTab, targetSessionFor, cycleTab, gotoCommands };
}

// ---------------------------------------------------------------------------
// 标签右键菜单浮层（M254，change tab-strip-context-menu）
//
// 形态与口径与文件树菜单（src/tree-menu.ts 的 TreeContextMenu）同源：`role=menu` / 项级
// `role=menuitem`、↑↓ 与 ⌃N⌃P 等价导航、Enter 触发、Esc 或外部点击关闭、打开即持焦点、
// 关闭把焦点归还触发它的那一条。就地消费按键、**不进** keys.ts 的统一表——那张表的不变量是
// 「一个 token 一条绑定」，而 ↑↓ / ⌃N⌃P / Enter / Esc 已分别归 editor.cursor-* 与
// editor.widget-escape；浮层持焦点时 editor 作用域因「事件目标不在 contentDOM 内」不命中，
// 就地消费 + preventDefault 让 window 上的分发器让路（与树菜单 / 大纲浮层 / vault 浮层同一套口径）。
//
// **为什么没有把两处菜单的机制抽成共用底层**（tower 提醒②问过，裁决记在这里）：
//   1. 文件范围：本 mission 的改动面不含 src/tree-menu.ts，抽底层要改它的导出面与类内部，
//      属另一次改动（跨 mission 的重构不该夹在一个功能 change 里）；
//   2. 差异不在细节而在**项集来源**：树菜单的项集随条目类型分流（文件 / 目录两套，含分隔线
//      与破坏性项档），标签菜单是三条固定项；菜单渲染、动作派发与作用元素标记都挂在这个差异上，
//      能共用的只有「容器 + 定位 + 键盘游标 + 外点关闭」这一层（约 60 行），抽出来的收益小于
//      两处同时改动带来的回归面（树菜单有它自己的单测与两条元素基线）；
//   3. **皮肤是共用的**：外观只有一份声明（`src/style.css` 里 `.ft-menu` / `.tab-menu` 的
//      选择器对），两处菜单长得一样、改一处同时影响两处，这才是「同一语义不要两处真源」在
//      外观层的要求。机制层的两份实现各自被自己的测试覆盖（tests/unit/tree-menu.test.ts /
//      tests/unit/tab-menu.test.ts）。
// ---------------------------------------------------------------------------

export interface TabContextMenuDeps {
  /** 浮层挂点（app-shell 根）：标签栏容器 overflow-x: auto，挂进去会被裁掉。 */
  mount: HTMLElement;
  onSelect(action: TabMenuAction, session: EditorSession): void;
  /** 关闭后焦点归还：装配侧按会话现查那一条标签（DOM 是全量重建的，存元素引用会失效）。 */
  restoreFocus(session: EditorSession): void;
}

export interface TabContextMenuHandle {
  open(session: EditorSession, at: { x: number; y: number }): void;
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  /** 菜单元素（断言口；内容随每次打开重建）。 */
  element(): HTMLElement;
}

const TAB_ITEM_ID_PREFIX = "tab-menu-item-";

class TabContextMenu implements TabContextMenuHandle {
  private readonly deps: TabContextMenuDeps;
  private readonly menu: HTMLDivElement;
  private items: HTMLButtonElement[] = [];
  private actions: TabMenuAction[] = [];
  private activeIndex = -1;
  private target: EditorSession | undefined;
  private open_ = false;

  constructor(deps: TabContextMenuDeps) {
    this.deps = deps;
    const menu = document.createElement("div");
    // 语义类 `.tab-menu`（皮肤由 style.css 的 `.ft-menu, .tab-menu` 选择器对给出——同一套声明
    // 两个名字，因此这里 MUST NOT 再带 `ft-menu`：带上它会让两份菜单同时命中 `.ft-menu`
    // 这个选择器，任何按类名找菜单的断言（tree-menu.spec.ts 的 openMenu）都会变成 strict
    // mode violation——实测过，12 条树菜单用例一起红）。
    menu.className = "tab-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", TAB_MENU_LABEL);
    menu.tabIndex = -1;
    menu.addEventListener("keydown", (event) => this.onKeydown(event));
    // 菜单里的项不夺焦点（与树菜单同一手法）：mousedown 一旦夺焦，随后的 click 落在已
    // hidden 的菜单上，那一项就永远不会执行——点击路径必须活到 click。
    menu.addEventListener("mousedown", (event) => event.preventDefault());
    document.addEventListener("mousedown", (event) => {
      if (!this.open_) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu.contains(target)) return;
      this.close(false);
    });
    deps.mount.append(menu);
    this.menu = menu;
  }

  open(session: EditorSession, at: { x: number; y: number }): void {
    this.target = session;
    this.render();
    this.open_ = true;
    this.menu.hidden = false;
    // 先落到原点再量尺寸：菜单在别处量到的 offsetWidth / offsetHeight 取决于上一次打开的内容。
    this.menu.style.left = "0px";
    this.menu.style.top = "0px";
    this.place(at.x, at.y);
    this.setActive(0);
    // 焦点落到容器（不是项）：键盘游标经 aria-activedescendant 表达，与树菜单同形。
    this.menu.focus();
  }

  close(restoreFocus = true): void {
    if (!this.open_) return;
    this.open_ = false;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    this.items = [];
    this.actions = [];
    this.activeIndex = -1;
    const target = this.target;
    this.target = undefined;
    if (!restoreFocus || target === undefined) return;
    this.deps.restoreFocus(target);
  }

  isOpen(): boolean {
    return this.open_;
  }

  element(): HTMLElement {
    return this.menu;
  }

  private render(): void {
    this.items = [];
    this.actions = [];
    const children: HTMLElement[] = [];
    tabMenuItems().forEach((item, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ft-menu-item";
      el.setAttribute("role", "menuitem");
      el.id = `${TAB_ITEM_ID_PREFIX}${index}`;
      el.tabIndex = -1;
      el.textContent = item.label;
      el.addEventListener("click", () => this.activate(index));
      this.items.push(el);
      this.actions.push(item.action);
      children.push(el);
    });
    this.menu.replaceChildren(...children);
  }

  /**
   * 把菜单放到指针位置（`clientX/clientY`，视口坐标），并按挂点边界翻转：右端不越出挂点，
   * 下方空间不够就整块翻到指针上方（算式与树菜单逐字相同——两处的锚点都是指针）。
   */
  private place(x: number, y: number): void {
    const host = this.deps.mount.getBoundingClientRect();
    const width = this.menu.offsetWidth;
    const height = this.menu.offsetHeight;
    const localX = x - host.left;
    const localY = y - host.top;
    const maxLeft = Math.max(0, host.width - width - 8);
    const left = Math.min(Math.max(localX, 0), maxLeft);
    const top = localY + height <= host.height ? Math.max(localY, 0) : Math.max(0, localY - height);
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
  }

  private setActive(index: number): void {
    const previous = this.items[this.activeIndex];
    if (previous) previous.classList.remove("is-active");
    this.activeIndex = index;
    const item = this.items[index];
    if (!item) {
      this.menu.removeAttribute("aria-activedescendant");
      return;
    }
    item.classList.add("is-active");
    this.menu.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    const next = Math.min(this.items.length - 1, Math.max(0, this.activeIndex + delta));
    if (next !== this.activeIndex) this.setActive(next);
  }

  private activate(index: number): void {
    const action = this.actions[index];
    const target = this.target;
    if (action === undefined || target === undefined) return;
    // 先收起再发请求：动作会弹确认浮条 / 重绘标签栏，菜单必须已经不在场。close 会把 target
    // 清掉，所以先把请求值取出来。
    //
    // **焦点归还放在动作之后**（与树菜单的顺序相反，理由是实测的）：标签的关闭会重绘整条
    // 标签栏（renderTabs 是全量 replaceChildren），动作之前归还的焦点会跟着被换掉的那个元素
    // 一起消失——实测「关闭一个标签后焦点落在 body 上」。装配侧的归还实现本来就是「按路径
    // 现查，查不到就落到当前激活标签」，所以放在动作之后才有意义。
    this.close(false);
    this.deps.onSelect(action, target);
    this.deps.restoreFocus(target);
  }

  private onKeydown(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      // ⌃N / ⌃P 与 ↑↓ 完全等价（同一落点、同一钳制），共用 move()——菜单里 MUST NOT
      // 有第二套下标逻辑（与树菜单、vault 浮层、大纲浮层同口径）。
      case "ArrowDown":
      case "Ctrl-N":
        this.move(1);
        break;
      case "ArrowUp":
      case "Ctrl-P":
        this.move(-1);
        break;
      case "Enter":
        this.activate(this.activeIndex);
        break;
      case "Escape":
        this.close();
        break;
      default:
        return; // 其余键不消费：菜单不是模态，Tab 等照常走原生焦点路径
    }
    event.preventDefault();
  }
}

export function createTabContextMenu(deps: TabContextMenuDeps): TabContextMenuHandle {
  return new TabContextMenu(deps);
}
