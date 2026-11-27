// 正文末尾的「END」标记（change document-end-marker；change show-document-end-marker-all-docs-nov27
// 起**所有已完成布局的 md 文档**都显示，不再要求内容高度超过视口）。
//
// 它是应用 chrome，不是文档内容，因此**挂在 `.cm-scroller` 上、与 `.cm-content` 同级**：
// 不进 `EditorState.doc`、不进保存字节、不被 ⌘A / ⌘F 取用（ADR 0003 §3），也不进 CM 的
// DOM 观察子树（`DOMObserver` 只观察 `.cm-content`）、不进 heightmap、不参与「装饰层只为
// 可见区域构建」那条增量义务（`src/preview/livePreview.ts:585`）。
//
// 为什么不是 `.cm-content` 的生成内容（change design §1.1 的候选 A）：spec 的三条判据都要读
// 真实几何——「渲染盒宽高均非零」「横线的总宽小于阅读栏宽的一半」「标记内存在文本节点」。
// 伪元素的盒子没有 JS 可读的几何（`getBoundingClientRect` 取不到它），也拿不出文本节点；
// 判据只能退化成读声明（computed style）。本模块把候选 A 那套「不参与 CM 数据结构」的性质
// 用真元素实现，三条判据因此都有渲染结果可读。机制取舍与实测记录见 change 的 design.md §1.1.1。
//
// **在场态与落点的落地时机（M238）**：判据和落点在 CM 的 DOM 读相位算（`MeasureRequest.read`），
// 但 DOM / 样式改写在**测量周期之外**落地（`write` 只记录期望值并排一帧，`apply` 才动 DOM）。
// 理由与实测证据见下方 `write` 与 `apply` 的注释：在测量周期里改布局，会让 CM 在该周期尾段
//（`scrollIntoView` + 新一轮 `measure`）读到被自己改动过的几何。
//
// **指针命中面与 END 落点（change show-document-end-marker-all-docs-nov27）**：正文盒保持
// `minmax(max-content, 1fr)` 行 + CM 基础主题的 `min-height: 100%`——它是 CM 的原生命中面，
// 正文下方空白处的单击 / 双击 / 拖选仍走 CM 自己的手势路径。END 是这个命中面之上绝对定位的
// chrome（`position: absolute` + `pointer-events: none`），`top` = 正文自然末尾、`left/width`
// = 正文盒的水平区间。落点由 O(1) 布局读数给出：`contentHeight` + 正文盒 / scroller 的矩形 +
// `scrollTop/Left`（滚动偏移只把视口矩形换算成**内容坐标**，不参与在场判据）。因此短文档的 END
// 钉在自然末尾而不是窗口底，而点它自身也穿透到正文盒——不是「只给单击打补丁」的分叉。正文行的
// 尺寸与标记在场无关；绝对定位的盒子不参与内容布局 / heightmap，但作为绝对定位后代仍会计入
// scroller 的 scrollable overflow（END 自身高度：长文四态恒定，短文可装下时 scrollHeight == clientHeight）。
//
// **元素生命周期 ⊆ 插件实例生命周期（M251 的结构性修复）**：元素可以晚于 `destroy` 被挂回来。
// 现场（Alex 2026-09-27 真机报告：`— End —` 出现在非 markdown 文件的正文右侧空白区）与实测
// 病因：换模式（md → code）时 `EditorView.setState` 确实先 `destroy` 了本插件（`.cm-scroller`
// 上的标记元素在同一帧被摘掉），但**销毁前排进 CM 测量队列的请求在销毁后照常执行**——CM 的
// `requestMeasure` 没有取消口，`destroy` 只能取消它自己排的动画帧，取消不了这一趟。那一趟测量
// 走回本模块的 `write`，排下新的一帧，帧回调把元素重新挂回 `.cm-scroller`；此时 state 已经不含
// 本插件，元素就此成为孤儿。孤儿在 code 模式的后果正是用户看到的那一幕：code 模式的
// `.cm-scroller` 是三列 grid 且行 1 的前两列已被 gutter 与 `.cm-content` 占住，元素没有 md 那套
// 定位声明（`theme.ts` 只把那些声明随 live preview 一起装进 md 分支），自动落位到行 1 第 3 列
// （正文右侧的空白列）。
//
// 不变量（`openspec/specs/editor-live-preview/spec.md`「正文末尾的结束标记（所有已完成布局的 md
// 文档）」：标记 SHALL 只出现在 md 模式，code 模式 MUST NOT 出现标记）：**任意时刻元素的存在与否恒等于
// 「当前 state 装配了本插件且视口已完成布局」**；插件销毁后，任何在途的测量 / 帧回调 MUST NOT 再触碰
// DOM。实现见 `destroyed` 标志与 `schedule` / `apply` 的守卫——判据侧的单条 case 覆盖不了这条，因为触发它的
// 是**模式切换的历史**（源模式 × 目标模式 × 切换时元素在场与否），回归测试是
// `tests/visual/scenes/end-marker.spec.ts` 的模式切换矩阵属性用例。

import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

export const END_MARKER_CLASS = "cm-lp-end-marker";
export const END_MARKER_LINE_CLASS = "cm-lp-end-marker-line";
export const END_MARKER_TEXT_CLASS = "cm-lp-end-marker-text";

/** 标记的可见文案（Alex 2026-09-27 裁决：改用「END」，无破折号，替代 M238 的「— End —」；
 *  单一来源，`tests/unit/end-marker.test.ts` 按 deck D114 逐字断言）。 */
export const END_MARKER_TEXT = "END";

/**
 * 出现判据（本 change 的唯一判定点，纯函数）：**可用视口高度 > 0** 时显示，即「布局已完成」。
 *
 * - 判据 MUST NOT 比较内容高度、MUST NOT 读滚动位置：END 对所有已完成布局的 md 文档显示，短文与
 *   长文同判（Alex 2026-11-27 采纳的统一口径，change show-document-end-marker-all-docs-nov27）；
 * - 可用视口高度为零（尚未布局 / 被完全遮挡）时一律不显示：这时没有可读的布局，显示会在编辑器
 *   浮现后变成一次无意义的显隐跳变；
 * - 判据只读一个既有布局数（`scrollDOM.clientHeight`），常量级、不含逐帧监听（ADR 0002 §6）。
 *
 * 标记本身在 `.cm-content` 之外，纵向位置由本模块按正文自然末尾绝对定位（`theme.ts` 的
 * end-marker 段 + 下方 `read` 的 O(1) 布局读数），因此判据不存在「标记一旦出现就把自己推过判据」
 * 的自我指涉。
 */
export function endMarkerVisible(viewportHeight: number): boolean {
  return viewportHeight > 0;
}

/** 两段短线中的一段：本体 0 高，视觉高度来自 1px border（与 `.cm-lp-hr` 同款取色 `--border-soft`）。 */
function markerLine(): HTMLElement {
  const line = document.createElement("span");
  line.className = END_MARKER_LINE_CLASS;
  return line;
}

/**
 * 标记的 DOM：两段短线夹一段文字（裁决点 2 的推荐形态）。
 * 可见文字本身就是它的可读文本，因此 MUST NOT 再加 `aria-label`（读屏会听到两遍，design §5）——
 * 元素因此不在 `.cm-content` 的 textbox 里，不进编辑器文档文本。
 */
function createEndMarker(): HTMLElement {
  const root = document.createElement("div");
  root.className = END_MARKER_CLASS;
  const text = document.createElement("span");
  text.className = END_MARKER_TEXT_CLASS;
  text.textContent = END_MARKER_TEXT;
  root.append(markerLine(), text, markerLine());
  return root;
}

/** 一次测量给出的 END 落点（正文自然末尾，scroller 内容坐标）与在场态。 */
interface EndMarkerGeometry {
  visible: boolean;
  top: number;
  left: number;
  width: number;
}

const sameGeometry = (a: EndMarkerGeometry, b: EndMarkerGeometry): boolean =>
  a.visible === b.visible && a.top === b.top && a.left === b.left && a.width === b.width;

class EndMarkerView {
  // 不用构造器参数属性：`tests/unit` 直接跑 src 源码（Node 的类型剥离不支持参数属性，
  // 那是会生成代码的语法而不是纯类型标注）。
  private readonly view: EditorView;
  private readonly marker: HTMLElement;
  /** 已落地的在场态（判据的**结论**不一定等于它，见 `pending`）。 */
  private attached = false;
  /** 待落地的几何：`write` 只记录期望值，真正的 DOM / 样式改动在 `apply` 里做（下一帧）。 */
  private pending: EndMarkerGeometry = { visible: false, top: 0, left: 0, width: 0 };
  /** 已排的动画帧句柄（0 = 没排队）。 */
  private frame = 0;
  /** 已销毁（M251）：销毁后在途的测量 / 帧回调一律不得再触碰 DOM，理由见文件头的
   *  「元素生命周期 ⊆ 插件实例生命周期」段。 */
  private destroyed = false;
  private readonly observer: ResizeObserver;
  private readonly request: {
    key: unknown;
    read: (view: EditorView) => EndMarkerGeometry;
    write: (geometry: EndMarkerGeometry, view: EditorView) => void;
  };

  constructor(view: EditorView) {
    this.view = view;
    this.marker = createEndMarker();
    // 上一个实例（换文档 / 换模式时 CM 会重建 view plugin）不该留下它的元素：本次构造时
    // 标记尚未挂载，先清掉任何残留（destroy 也会清，这里是第二道）。
    for (const stale of view.scrollDOM.querySelectorAll(`.${END_MARKER_CLASS}`)) stale.remove();
    this.request = {
      key: this,
      // 两个既有几何读数：布局是否完成（视口高 > 0），以及正文自然末尾在 scroller 内容坐标里的
      // 位置。后者 = 正文盒相对 scroller 的矩形偏移 + `contentHeight`（正文自然高，含上下内边距；
      // 高度图在 read 之前已由 CM 自己量完）。`scrollTop/Left` 只用于把视口矩形换算回**内容坐标**，
      // 换算结果与滚动位置无关；判据（visible）MUST NOT 读它。全是 O(1) 布局读数：不遍历文档、
      // 不含标记自己的贡献。
      read: (target) => {
        const scroller = target.scrollDOM.getBoundingClientRect();
        const content = target.contentDOM.getBoundingClientRect();
        return {
          visible: endMarkerVisible(target.scrollDOM.clientHeight),
          top: content.top - scroller.top + target.scrollDOM.scrollTop + target.contentHeight,
          left: content.left - scroller.left + target.scrollDOM.scrollLeft,
          width: content.width,
        };
      },
      // **不在 write 相位动 DOM / 写样式**（M238）：CM 的 `MeasureRequest.write` 明文要求「不得做
      // 触发布局的事」（@codemirror/view 6.43.11 的 MeasureRequest 注释），而本模块的 patch 会改
      // 绝对定位元素与 scrollDOM 的子节点。更要紧的是 `measure()` 的循环在这一步之后还会走
      // `docView.scrollIntoView(...)` 与**新一轮测量**（同文件 `measure()` 尾段），同步改样式
      // 等于让那一轮读到被自己改动过的几何。这里只记录期望值，落地交给下一帧的 `apply`。
      write: (geometry) => this.schedule(geometry),
    };
    // 视口尺寸变化（窗口 resize、侧栏拖动、模式切换后的首次布局）由 ResizeObserver 触发；
    // 文档变更与 CM 几何变更（异步图片、字体度量、缩放）由 `update` 触发——两者都只重算
    // END 的绝对落点，不改变正文布局。
    this.observer = new ResizeObserver(() => view.requestMeasure(this.request));
    this.observer.observe(view.scrollDOM);
    view.requestMeasure(this.request);
  }

  update(update: ViewUpdate): void {
    // END 的纵坐标由 contentHeight 派生：装载 / 键入 / 异步图片 / 缩放都会改它。这里只排队一次
    // 测量（CM 每次重绘本来就排了自己那一趟），读的是 `contentHeight`、正文盒 / scroller 矩形与
    // 滚动偏移三个既有布局数。
    if (update.docChanged || update.geometryChanged) update.view.requestMeasure(this.request);
  }

  destroy(): void {
    // 先立销毁标志再收尾（M251）：`marker.remove()` 之后仍可能有在途的一趟测量回来调
    // `schedule`（CM 的测量队列取消不掉，见文件头），标志是那条路上唯一的闸门。
    this.destroyed = true;
    this.observer.disconnect();
    this.cancelFrame();
    this.marker.remove();
  }

  /** 记录期望的几何并（必要时）排一次落地。排队期间重复的请求被合并：以最后一次期望为准，
   *  已排的那一帧不重排——反复排帧会让 patch 永远追不上期望值。 */
  private schedule(geometry: EndMarkerGeometry): void {
    // 销毁后一律空动作（M251）：这一步的调用方可能是**已经排进 CM 测量队列**的那一趟
    //（销毁发生在它之前），此时 state 已不含本插件，任何落地都会造出孤儿元素。
    if (this.destroyed) return;
    if (geometry.visible === this.attached && sameGeometry(geometry, this.pending) && this.frame === 0) return;
    this.pending = geometry;
    if (this.frame !== 0) return;
    // 不可见且本来就不在场：只更新 pending，不排帧。
    if (!geometry.visible && !this.attached) return;
    // **一帧，不是两帧**（M238 实测，别改成双帧）：一帧就足以离开当前的测量周期（CM 的
    // `measure()` 自己跑在一个动画帧回调里，本模块的回调必然排在它那次任务之后）；而多等一帧
    // 会挪到测量周期尾段的 `scrollIntoView`/滚动锚点落地之后，实证代价是阅读位置恢复偏 13px
    // ——`tests/visual/scenes/reading-position-probe.spec.ts` 的 §7-3（含异步图片的文档）在
    // 双帧下 3/3 红（参照行 172.6 vs 捕获 159.6，容差 4px），单帧 0px。
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.apply(this.pending);
    });
  }

  private cancelFrame(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** 落地一次几何（视口为 0 时元素根本不在 DOM 里——spec：尚未布局时不显示）。
   *
   *  元素是 `.cm-scroller` 上绝对定位的 chrome：top = 正文自然末尾，left / width = 正文盒的
   *  水平区间。正文盒本身仍铺满可用高度（`minmax(max-content, 1fr)` + `min-height: 100%`），
   *  它是 CM 的指针命中面——单击 / 双击 / 拖选在正文下方空白处仍走 CM 自己的手势路径。
   *  标记 `pointer-events: none`，点在它自身上也穿透到正文盒，因此不存在「只给单击打补丁」的
   *  分叉。绝对定位的盒子不参与正文布局、不进 heightmap，也不改滚动锚点。
   *
   *  落地后**不补排测量**：标记在 `.cm-content` 之外、不改变任何布局，CM 量到的几何没有变化；
   *  在这个窗口里多排一趟测量只会让 CM 拿在途的滚动锚点再算一次 scrollTop（ADR 0002 §6 的
   *  「不新增测量」在这条路径同样成立）。 */
  private apply(geometry: EndMarkerGeometry): void {
    if (this.destroyed) return;
    this.marker.style.top = `${geometry.top}px`;
    this.marker.style.left = `${geometry.left}px`;
    this.marker.style.width = `${geometry.width}px`;
    if (geometry.visible === this.attached) return;
    this.attached = geometry.visible;
    if (geometry.visible) this.view.scrollDOM.append(this.marker);
    else this.marker.remove();
  }
}

/** md 模式的扩展示例（装配点：`src/editor.ts` 的 `modeExtensions` 的 md 分支）。 */
export const endMarker = ViewPlugin.fromClass(EndMarkerView);
