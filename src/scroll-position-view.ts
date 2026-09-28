// 阅读位置的 **view 侧**原语（M280 三个：捕获 / 两个口径的恢复 / 「交还焦点不改变阅读位置」；
// M286 起多一个**捕获让位窗口**的包装器 `duringViewportTransition`——应用自己推视口的动作
// 一律经它开窗，见 src/viewport-transition.ts）。
//
// 为什么与 src/scroll-position.ts 分开：那边是**值形态与两个算式**的纯代数（不 import 编辑器
// 内核，tests/unit 秒级可测，见那份文件头）；这边只做「读 view 的哪个数、dispatch 哪个效果」。
// 此前这三段住在 src/editor.ts 的 facade 里，只有 facade 的持有者（src/main.ts）能用；M280 把
// 其余四条「以 `view.focus()` 交还焦点」的路径也收进来（src/toc.ts / src/search.ts /
// src/preview/livePreview.ts），它们手里只有裸 EditorView——**同一个语义不许有第二份实现**
// （REVIEW.md 第 8 条），所以抽到独立模块，facade 与它们共用同一份。
//
// 本模块 MUST NOT import src/editor.ts（facade 反向 import 它）：否则 src/search.ts 这类被
// editor.ts 依赖的模块一 import 就成环。

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { positionFromReadings, restoreScrollTop } from "./scroll-position";
import type { ScrollPosition } from "./scroll-position";
import { beginViewportTransition, endViewportTransition } from "./viewport-transition";

/**
 * 把一段「应用自己推动视口」的动作包进捕获让位窗口（窗口语义见 src/viewport-transition.ts）。
 *
 * **窗口在下一帧关闭**，这是本仓能给出的最紧的确定性边界：本模块发放的写回是
 * `EditorView.scrollIntoView` 效果，CM 只在它的测量周期（`measure()`，由 rAF 驱动、注册于
 * dispatch 那一拍）才把 `viewState.scrollTarget` 落到 DOM 上（`@codemirror/view` 的
 * `measure()` 尾部消费它），因此「写回已落地」的那一拍就是下一个 rAF 回调——本包装器注册的
 * 关窗回调排在包内注册的一切 rAF 之后，读到的已是目标位置（或用户自己推动的位置）。
 *
 * **MUST NOT 换成任何时长量**（`setTimeout(…, 200)` 之类）：中间态与写回同帧还是跨帧由引擎
 * 决定，没有可用的固定时长。残留（如实登记）：引擎若把中间态维持到第二帧之后（M279/M280 的
 * 读数里写回都在下一拍落地，未见过），本窗口不覆盖那一拍——那时捕获读到的仍是引擎留下的
 * 位置，与本加固之前的行为一致。
 */
export function duringViewportTransition(run: () => void): void {
  beginViewportTransition();
  try {
    run();
  } finally {
    requestAnimationFrame(() => endViewportTransition());
  }
}

/**
 * 捕获当前视口的阅读位置。锚取「高度等于 `scrollTop` 的行块起点」（公开方法、语义是「相对文档
 * 顶的高度」），锚比视口顶那一行低约一个 `paddingBlock`——这不影响判据：`y` 记的正是该锚相对
 * 视口的实际偏移（见 `positionFromReadings` 的注释），捕获与恢复用同一个锚。
 *
 * 锚处没有可量的字符盒（折行点、被替换的区间等）时返回 null：调用方按「本次不记录」处理，
 * **绝不写半个值**。
 */
export function readScrollPosition(view: EditorView): ScrollPosition | null {
  const scroller = view.scrollDOM;
  const anchor = view.lineBlockAtHeight(scroller.scrollTop).from;
  const rect = view.coordsAtPos(anchor);
  if (rect === null) return null;
  const box = scroller.getBoundingClientRect();
  return {
    pos: anchor,
    ...positionFromReadings({
      charTop: rect.top,
      charLeft: rect.left,
      boxTop: box.top,
      boxLeft: box.left,
      scrollLeft: scroller.scrollLeft,
    }),
  };
}

/** 越界锚（两次会话之间文档被外部改写）夹回文档内：与 CM 自己的 clip 同口径，也让「落点是否
 *  即篇首」的判定用的是真正会被使用的那个位置。 */
function clampAnchor(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(Math.round(pos), view.state.doc.length));
}

/** 把捕获位置按 CM 自己的滚动通道写回（两个口径共用）。 */
function writeBack(view: EditorView, position: ScrollPosition, anchor: number): void {
  view.dispatch({
    effects: EditorView.scrollIntoView(EditorSelection.cursor(anchor), {
      y: "start",
      yMargin: position.y,
      // 横向**不**交给这个效果：非快照分支会先减掉 getScrollMargins(view).left，而本仓的
      // gutter 插件正好提供它（固定列宽）——拿捕获值当 xMargin 会系统性偏一个 gutter 宽
      //（code 模式实测 34px；M281 起 md 也有行号 gutter，档位见 `[ui] markdown_line_numbers`
      // ——该值在 md 上**在场时才非零**（`always` 档或 `on-demand` 档下输入条打开期间），
      // 不在场时为 0，两种情形本口径都按原始 scrollLeft 处理）。
      // 这里只要求「横向别动锚的位置」，横向量在下面直接赋值。
      x: "nearest",
      xMargin: 0,
    }),
  });
  // 横向按 CM 自己的快照分支的口径恢复：直接写 scrollLeft（`dist/index.js` 的快照分支就是
  // `scrollDOM.scrollLeft = xMargin`）。CM 的滚动锚点维护只管纵向（`scrollAnchorAt` 用
  // scrollTop），因此这个赋值不会像裸写 scrollTop 那样被改掉（M149 的 242px 是纵向现场）。
  //
  // 放在下一帧：上面那个效果由 CM 在测量周期里落地，而它带 `x: "nearest"`——锚被横向移出
  // 视口时它会主动把锚拉回来（实测：先写 200、效果随后把它拉回 62），所以横向必须是**最后**
  // 一次写入。requestAnimationFrame 的回调排在 CM 同帧的测量之后。
  requestAnimationFrame(() => {
    view.scrollDOM.scrollLeft = position.x;
  });
}

/**
 * **运行期**施加一个阅读位置（切标签 / 交还焦点 / 切模式之后）。唯一一条早退是「捕获锚落在
 * 文档原点」——那时「恢复到篇首」与「停在篇首」是同一件事，不施加更稳。
 *
 * **MUST NOT 在这里按 `coordsAtPos` 复核落点**（装载口径 `applyLoadedScrollPosition` 才那么做）：
 * 运行期读数取在**当前** `scrollTop` 上，同一算式退化成「还差多少才到位」的**差值**，
 * 而不是「落点」。交还焦点那一拍布局还没反映出引擎的聚焦滚动，差值恰为 0 ⇒ 复核会把每一次
 * 写回都吃掉（M279 实测：`coordsAtPos` 前后同一个 −42、`target = 0`、一次 dispatch 都没有）。
 */
export function applyScrollPosition(view: EditorView, position: ScrollPosition): void {
  const anchor = clampAnchor(view, position.pos);
  if (anchor === 0) return;
  writeBack(view, position, anchor);
}

/**
 * **装载路径**施加一个阅读位置：装载复位（`scrollTop = 0`）之后调用，此时读数取在原点，同一
 * 算式给出的就是**绝对落点**，落点 ≤ 0 说明这条历史位置就落在文档原点——不施加效果（带 margin
 * 的 `scrollIntoView` 对 pos 0 有把页首 44px 内边距顶出画的历史，M110）。
 *
 * 这不是冗余：装载刚结束时存储的锚几乎总在视口之外，那时 `coordsAtPos` 返回 null（实测：锚在
 * 视口下方 ~2800px 时为 null）。若把 null 当「不可读 → 放弃恢复」，整条能力对所有深于一屏的
 * 位置都会静默失效（M194 实测现场）。CM 自己的通道先按 scrollTarget 重新定位视口、渲染、测量，
 * 之后再算坐标，因此发放效果对任意深的锚都成立；锚真的不可读时 CM 的 `scrollIntoView` 自己会
 * 提前返回，视口留在装载复位处——这正是 spec 要的「静默退化到篇首」。
 */
export function applyLoadedScrollPosition(view: EditorView, position: ScrollPosition): void {
  const anchor = clampAnchor(view, position.pos);
  if (anchor === 0) return;
  const rect = view.coordsAtPos(anchor);
  if (rect !== null) {
    const box = view.scrollDOM.getBoundingClientRect();
    const target = restoreScrollTop(
      {
        charTop: rect.top,
        charLeft: rect.left,
        boxTop: box.top,
        boxLeft: box.left,
        scrollLeft: view.scrollDOM.scrollLeft,
      },
      position,
    );
    if (target <= 0) return;
  }
  writeBack(view, position, anchor);
}

/**
 * 把焦点交还编辑器，并**保住阅读位置**（M186 的收敛建议，M277 首次落地，M280 收敛为全仓唯一
 * 实现）。
 *
 * 顺序本身就是口径：**取位置 MUST 在聚焦之前**——把焦点放进编辑器是**浏览器**接管的视口动作
 * （聚焦时保证光标可见），快照取在聚焦之后就成了被改过的值，那正是缺陷本身。写回 MUST 走
 * CM 自己的滚动通道（`writeBack`），**MUST NOT 裸写滚动容器**——CM 的滚动锚点簿记会把它改掉
 * （M149 实测差 242px，同一族）。
 *
 * 写回**不依赖即时测量**（M279 实测的第二个根因）：聚焦那一拍 `coordsAtPos` 拿到的还是旧布局，
 * 据此复核落点会把写回整个吃掉。这里发放的是「按捕获值无条件定位」的效果，再叠一层
 * `requestAnimationFrame` 保底——引擎的滚动若比 CM 的测量周期更晚落地，第二拍仍把位置钉回去；
 * 位置本来没动时两次发放都是空动作（同一份捕获值报回同一处）。
 *
 * 保底那一拍带 `view.hasFocus` 闸门：焦点若在同一个 rAF 里已被用户挪走（收起浮层的下一拍又
 * 点了别处 / 切了标签），这一拍 MUST NOT 再拿旧位置把视口拽回去——那时视口的主人是用户。
 *
 * 位置读不出来（锚处没有可量的字符盒）时只聚焦，不写半个值。
 *
 * **整段动作包在捕获让位窗口里**（M286）：聚焦揭示是**引擎**接管的位移，它把视口拽到 caret
 * 处那一拍会派发滚动事件——那读到的不是用户的位置。窗口覆盖「取位置 → 聚焦 → 写回落地」整段，
 * 窗口内的滚动事件被捕获侧整体忽略（`src/reading-position.ts` 的 `scrolled`）。
 */
export function focusPreservingReadingPosition(view: EditorView): void {
  const position = readScrollPosition(view);
  duringViewportTransition(() => {
    view.focus();
    if (position === null) return;
    applyScrollPosition(view, position);
    requestAnimationFrame(() => {
      if (view.hasFocus) applyScrollPosition(view, position);
    });
  });
}
