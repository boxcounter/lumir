// 表格全屏触发钮（M240；change table-fullscreen-view 的裁决点 3 = D3「命令 + 表格 hover 工具钮
// 双入口」，形态按 M235 划稿的推荐档 `inside-corners-hover` 实现）。
//
// 形态三条（M235 原话，逐条落点）：
//   - **右上角内侧叠放**：钮压在表格可视区右上角（`top: 6px; right: 6px`），零文档几何变化。
//   - **四角框图标**：系统全屏的通行字形，无方向性（`expand` 的对角箭头会被读成「去别处打开」）。
//   - **hover 才出现**：静止态零足迹——不出现、不占位、不进任何整页基线（对 REVIEW.md 第 3 条
//     的基线纪律最友好）。可发现性缺口由命令入口承担，这正是 D3 双入口的分工。
//
// 坐标系是本文件唯一有机制含量的地方，写清再动手：
//
//   1. 表格的既有块级包装是两层 BlockWrapper（rank 10 = `.cm-lp-table-scroll` 横滚容器，
//      rank 0 = `.cm-lp-table` grid）。钮钉在**横滚容器的可视区**而不是内容里——内容横滚时
//      钮不动（M235 的实现期交接明写「别抄成跟着内容滚」）。为此加第三层包装
//      `.cm-lp-table-slot`（rank 20，最外）并给它 `position: relative`，钮的全部偏移量都相对
//      它计算。
//   2. 钮本身是 grid 子树里的一个 `Decoration.widget`（inline point widget，挂在表头行行首）。
//      它 `position: absolute` 且**最近的定位祖先是 slot**：`.cm-lp-table-row` / `.cm-lp-table` /
//      `.cm-lp-table-scroll` 三级都是 static（src/style.css 各自的规则里没有任何 position），
//      所以绝对定位的包含块落在 slot 上。包含块在横滚容器**之外**的绝对定位元素不被该容器
//      滚动、也不被它裁切——「钮不动」因此是 CSS 定位的结果，不需要任何监听器或重排。
//   3. 因为钮是绝对定位，它不是 subgrid / grid 的流内子项，不参与轨道与隐式行（cells 的
//      `grid-column` 内联定位不因此漂移）。它是**直接子节点**，故 src/style.css 那条
//      「行内非 cell 子项一律 display: none」的规则要显式豁免本 class——那条规则是针对 CM 的
//      widgetBuffer / 占位 span（自动放置的 grid item，会撑出隐式行）写的，豁免项附了理由。
//
// 生命周期跟着表格装饰走：表格不再渲染为 grid 时 widget 一并消失，「降级表没有入口」因此是
// 结构性事实（降级表没有 `.cm-lp-table` 子树，钮无处可挂），不是一条要维护的开关。
//
// 读屏名 = 文案 deck D120（「放大查看表格」）。遮罩自己的读屏名不在这里——它复用表格容器既有的
// `Markdown 表格 N` 标签同一来源（从源元素的 aria-label 取，见下）。

import { WidgetType } from "@codemirror/view";

/** 触发钮的坐标系统（BlockWrapper，rank 20）：`position: relative` 的唯一职责是给钮当包含块。
 *  常量在此声明而非 livePreview.ts，因为它是**钮的存在理由**；样式在 src/style.css。 */
export const TABLE_SLOT_CLASS = "cm-lp-table-slot";

/** 触发钮的 class（样式 / 测试 / 克隆卫生三处共用同一个串）。 */
export const TABLE_TRIGGER_CLASS = "lumir-table-fs-trigger";

/** 触发钮的读屏名（文案 deck D120，`文案-Copy.md` 与本常量逐字一致）。 */
export const TABLE_TRIGGER_LABEL = "放大查看表格";

/** 四角框图标（M235 划稿的 `corners`，1.4px 描边、currentColor）：与 direction-c 的自绘控件
 *  同一手法，形状逐字取自裁决稿 `design/prototypes/table-fs-trigger/index.html`。 */
const CORNERS_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3 H3 V6"/><path d="M10 3 H13 V6"/><path d="M13 10 V13 H10"/><path d="M3 10 V13 H6"/></svg>';

/** 打开全屏遮罩的口子（装配层注入；未接线返回 null，与 `PreviewContext.lightbox()` 同口径）。 */
export type TableFullscreenOpener = () => {
  open(source: HTMLElement, label: string): void;
} | null;

/**
 * 表头行行首的触发钮。`eq` 恒真：钮的渲染结果只由 DOM 上下文决定（源元素与读屏名都在点击那一刻
 * 现取），重建装饰没有理由换掉这个 DOM——换掉反而会打断 hover 态与淡入。
 */
export class TableFullscreenTrigger extends WidgetType {
  readonly fullscreen: TableFullscreenOpener;

  constructor(fullscreen: TableFullscreenOpener) {
    super();
    this.fullscreen = fullscreen;
  }

  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = TABLE_TRIGGER_CLASS;
    button.setAttribute("aria-label", TABLE_TRIGGER_LABEL);
    button.innerHTML = CORNERS_ICON;
    // 点击不该扰动文档：mousedown 的默认行为会把焦点与 caret 挪走（CM 对 widget 内的事件
    // 本就 ignoreEvent，这里再加一道显式防线，与 M184 放大图的 mousedown 手法同款）。
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      // 源表与读屏名都在**点击那一刻**从 DOM 现取（不缓存进 widget）：装饰一旦重建，
      // 缓存的元素引用就可能指向已经被替换掉的节点。
      const grid = button.closest<HTMLElement>(".cm-lp-table");
      if (grid === null) return; // 表格不再是 grid（降级 / 已卸载）：无入口
      const label = grid.getAttribute("aria-label");
      if (label === null) return; // 没有读屏名就不开（aria-modal 的语义要求有名）
      this.fullscreen()?.open(grid, label);
    });
    return button;
  }
}
