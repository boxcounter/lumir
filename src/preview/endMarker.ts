// 正文末尾的「到底了」标记（change document-end-marker）。
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

import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

export const END_MARKER_CLASS = "cm-lp-end-marker";
export const END_MARKER_LINE_CLASS = "cm-lp-end-marker-line";
export const END_MARKER_TEXT_CLASS = "cm-lp-end-marker-text";
/** 加在 `.cm-scroller` 上的在场态 class（标记在场时才加，见 `EndMarkerView` 的说明）。 */
export const END_MARKER_VISIBLE_CLASS = "cm-lp-end-marker-visible";

/** 标记的可见文案：deck D114 的中文列（单一来源；`tests/unit/end-marker.test.ts` 按 deck 逐字断言）。 */
export const END_MARKER_TEXT = "到底了";

/**
 * 出现判据（本 change 的唯一判定点，纯函数）：**不含标记的内容高度 > 可用视口高度**时显示。
 *
 * - 两个量都是静态量（内容高度 × 视口高度），与滚动位置无关——判据 MUST NOT 读滚动位置，
 *   否则会长出第二份「当前位置」语义（`src/toc.ts` 已有那份，REVIEW.md 第 8 条）；
 * - `>` 而不是 `>=`：内容恰好一屏时整篇都在视野内，没有可滚动的余量，标记该省则省；
 * - 可用视口高度为零（尚未布局 / 被覆盖层盖住）时一律不显示：这时量到的关系不成立，
 *   显示会在编辑器浮现后变成一次无意义的显隐跳变。
 *
 * 调用方传入的内容高度**不含标记自身**（标记在 `.cm-content` 之外，见 `EndMarkerView.read`），
 * 因此不存在「标记一旦出现就把自己推过判据」的自我指涉（change design §2 与 §7 第 5 条）。
 */
export function endMarkerVisible(contentHeight: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && contentHeight > viewportHeight;
}

/** 两段短线中的一段：本体 0 高，视觉高度来自 1px border（与 `.cm-lp-hr` 同款取色 `--bd-2`）。 */
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

class EndMarkerView {
  // 不用构造器参数属性：`tests/unit` 直接跑 src 源码（Node 的类型剥离不支持参数属性，
  // 那是会生成代码的语法而不是纯类型标注）。
  private readonly view: EditorView;
  private readonly marker: HTMLElement;
  private attached = false;
  private readonly observer: ResizeObserver;
  private readonly request: {
    key: unknown;
    read: (view: EditorView) => boolean;
    write: (visible: boolean, view: EditorView) => void;
  };

  constructor(view: EditorView) {
    this.view = view;
    this.marker = createEndMarker();
    // 上一个实例（换文档 / 换模式时 CM 会重建 view plugin）不该留下在场态 class：
    // 本次构造时标记尚未挂载，行尺寸必须回到 auto。destroy 也会清，这里是第二道。
    view.scrollDOM.classList.remove(END_MARKER_VISIBLE_CLASS);
    this.request = {
      key: this,
      // 量的是 `.cm-content` 的渲染盒：标记在它之外，这个数里没有标记自己的高度贡献。
      // 一屏装得下时该盒被 min-height:100%（CM 基础主题）撑到可用高度，于是
      // 「盒高 > 可用高」⇔「内容自然高 > 可用高」——两种情形（撑开 / 不撑开）同解。
      read: (target) => endMarkerVisible(target.contentDOM.getBoundingClientRect().height, target.scrollDOM.clientHeight),
      write: (visible) => this.setAttached(visible),
    };
    // 重算触发点（判据是重算型，不是逐帧监听）：内容尺寸变化（文档变更、异步图片到达、
    // 字体度量）观察 `.cm-content`；视口尺寸变化（窗口 resize、侧栏拖动）观察 `.cm-scroller`。
    this.observer = new ResizeObserver(() => view.requestMeasure(this.request));
    this.observer.observe(view.contentDOM);
    this.observer.observe(view.scrollDOM);
    view.requestMeasure(this.request);
  }

  update(update: ViewUpdate): void {
    // 装载与键入会让内容变长变短，判据必须跟着重算。这里只**排队**一次测量：CM 每次重绘
    // 本来就排了自己那一趟（`EditorView.update` 的 `requestMeasure`），本模块搭同一趟车，
    // 读的是两个既有布局数——ADR 0002 §6 的「不在打开 / 键入路径新增测量」落在这条注释上。
    if (update.docChanged) update.view.requestMeasure(this.request);
  }

  destroy(): void {
    this.observer.disconnect();
    this.marker.remove();
    // 在场态 class 与元素必须同生同死：漏掉它会让 code 模式的滚动容器继续吃
    // `grid-auto-rows: max-content`（那里没有标记，不该有此口径）。
    this.view.scrollDOM.classList.remove(END_MARKER_VISIBLE_CLASS);
  }

  /** 显隐 = 在场与否：不显示时元素根本不在 DOM 里（spec：一屏装得下时「标记不存在」）。 */
  private setAttached(visible: boolean): void {
    if (visible === this.attached) return;
    this.attached = visible;
    // 挂载位置：`.cm-scroller` 的第 2 列第 2 行 = 正文所在列、正文之下（样式在 theme.ts）。
    // 同时给滚动容器打在场态 class：`.cm-content` 带 `min-height: 100%`（CM 基础主题），
    // 滚动容器被压缩到可用高度时它的隐式行贡献会被算成 0——只有把行尺寸改成 max-content，
    // 第 2 行才真的落在正文内容盒之后而不是叠在正文上。该口径只在标记在场时生效，
    // 因此不触碰一屏装得下的文档与 code 模式（那里行尺寸仍是原来的 auto）。
    if (visible) {
      this.view.scrollDOM.classList.add(END_MARKER_VISIBLE_CLASS);
      this.view.scrollDOM.appendChild(this.marker);
    } else {
      this.marker.remove();
      this.view.scrollDOM.classList.remove(END_MARKER_VISIBLE_CLASS);
    }
  }
}

/** md 模式的扩展示例（装配点：`src/editor.ts` 的 `modeExtensions` 的 md 分支）。 */
export const endMarker = ViewPlugin.fromClass(EndMarkerView);
