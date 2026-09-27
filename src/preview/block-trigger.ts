// 块级动作钮群（change block-copy-affordance + code-block-fullscreen，M277）。
//
// 一个块上一组钮，组内自左至右「复制 → 放大」，全部是 `position: absolute` 挂在块级 slot 层
// （`position: relative`）里的 `Decoration.widget`。形态纪律（壳 / 尺寸 / 圆角 / 图标色与热态 /
// 过渡 / 出现时机 / eink 两条规则）只在 src/style.css 的共享类 `.lumir-block-trigger` 里写一份，
// 本文件只出常量与 DOM；各钮自己的 class 只承担**位置偏移**（REVIEW.md 第 8 条：同一语义一处
// 真源，四个消费者不各抄一遍形态）。
//
// 坐标系统沿用 M240 表格全屏钮的机制（src/preview/table-trigger.ts 的文件头有完整推导）：
// 钮的最近定位祖先是 slot 层，而横滚容器在 slot 内侧——包含块在横滚容器**之外**的绝对定位元素
// 不被该容器滚动、也不被它裁切，「内容横滚时钮不动」因此是 CSS 定位的结果，没有任何监听器。
//
// 读屏名取文案 deck：D156（放大查看代码块）、D153（复制{块类型}）。块编号 MUST NOT 下沉到
// 按钮文案——上下文由容器既有的 `Markdown 表格 N` / `Markdown 代码块 N` 标签提供。

import { WidgetType } from "@codemirror/view";
import type { BlockCopyKind, BlockCopyRange } from "./block-copy";

/** 共享形态类：壳 / 尺寸 / 圆角 / 图标色 / 过渡 / 出现时机 / eink 规则全部挂在它上面
 *（src/style.css）。四个动作钮（表格复制、表格放大、代码块复制、代码块放大）都带它。 */
export const BLOCK_TRIGGER_CLASS = "lumir-block-trigger";

/** 复制钮的位置类（`top: 6px; right: 36px` = 放大钮左侧 4px；尺寸 26×24 与放大钮相同）。 */
export const BLOCK_COPY_TRIGGER_CLASS = "lumir-block-copy-trigger";

/** 代码块放大钮的位置类（`top: 6px; right: 6px` = 贴可视盒右上角内侧，与表格放大钮同几何）。 */
export const CODEBLOCK_FS_TRIGGER_CLASS = "lumir-codeblock-fs-trigger";

/** 代码块触发钮的坐标系统（BlockWrapper，rank 20）：`position: relative` 的唯一职责是给钮当
 *  包含块。与 `.cm-lp-table-slot` 同机制；本层零足迹（无背景 / 边框 / 内外边距 / overflow），
 *  M180 的「代码块折行时块内 MUST NOT 出现横向滚动容器」口径不变——slot 只是定位层。 */
export const CODEBLOCK_SLOT_CLASS = "cm-lp-codeblock-slot";

/** 代码块放大钮的读屏名（文案 deck D156，`文案-Copy.md` 与本常量逐字一致）。
 *
 *  为什么不是 D152：本 change 的原稿声明（D152）与 `docs/backlog.md` 的「文案 deck D152 编号碰撞」
 *  节 tower 裁决（2026-09-27，D152 起归先合并的 M261 `goto-line-command`）撞号，实现期按裁决取
 *  当时的下一个可用编号。deck 的沿革段记着这次改号。 */
export const CODEBLOCK_FS_TRIGGER_LABEL = "放大查看代码块";

/** 复制钮的读屏名（文案 deck D153）：块类型词只写一份，toast（D154）复用同一个词。 */
export function blockCopyLabel(kind: BlockCopyKind): string {
  return kind === "table" ? "复制表格" : "复制代码块";
}

/** 四角框图标（M235 划稿的 `corners`，1.4px 描边、currentColor）：与 direction-c 的自绘控件
 *  同一手法，形状逐字取自裁决稿 `design/prototypes/table-fs-trigger/index.html`。 */
export const CORNERS_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3 H3 V6"/><path d="M10 3 H13 V6"/><path d="M13 10 V13 H10"/><path d="M3 10 V13 H6"/></svg>';

/** 复制图标（双矩形「复制」字形，1.4px 描边、currentColor，14×14 / viewBox 16×16，
 *  与四角框同一手法）：后页只画左上两条边，前页是一整个圆角矩形。 */
export const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="7" height="7" rx="1.6"/><path d="M10 3.6 H4.6 A1.6 1.6 0 0 0 3 5.2 V10.6"/></svg>';

/** 复制能力的口子（装配层注入；未接线返回 null，与 `PreviewContext.lightbox()` 同口径）。 */
export type BlockCopyOpener = () => { copy(range: BlockCopyRange): void } | null;

/** 代码块全屏的口子（装配层注入；未接线返回 null）。参数是块起点——呈现计划与读屏名都由装配层
 *  在**点击那一刻**现取（不把文本缓存进 widget：装饰重建后这份引用就可能过期）。
 *
 *  这是「按块起点打开」的**端口**，不是遮罩本体：遮罩本体（isOpen / close）只有装配层的命令
 *  实现需要，装饰层不该拿到它（少一条能绕开命中判据的路径）。 */
export interface CodeBlockFullscreenPort {
  open(from: number): void;
}

export type CodeBlockFullscreenOpener = () => CodeBlockFullscreenPort | null;

/**
 * 复制触发钮。
 *
 * `eq` 比较块范围（与表格放大钮的「恒真」不同）：复制必须知道**文档里的哪一段**，而这个范围
 * 只能来自构建装饰时的模型。范围没变时复用同一个 DOM（保住 hover 与淡入），范围变了就重建——
 * 恒真会让按钮带着旧范围去复制另一段文本。
 */
export class BlockCopyTrigger extends WidgetType {
  // 显式字段而不是构造器参数属性：本仓的 tests/unit 层用 Node 的类型剥离跑源码，参数属性
  // 在 strip-only 模式下不受支持（editor.ts 的文件头记着同一条口径）。
  readonly range: BlockCopyRange;
  readonly opener: BlockCopyOpener;

  constructor(range: BlockCopyRange, opener: BlockCopyOpener) {
    super();
    this.range = range;
    this.opener = opener;
  }

  eq(other: BlockCopyTrigger): boolean {
    return other.range.kind === this.range.kind && other.range.from === this.range.from && other.range.to === this.range.to;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = `${BLOCK_TRIGGER_CLASS} ${BLOCK_COPY_TRIGGER_CLASS}`;
    button.setAttribute("aria-label", blockCopyLabel(this.range.kind));
    button.innerHTML = COPY_ICON;
    // 点击不该扰动文档：mousedown 的默认行为会把焦点与 caret 挪走（M240 同款手法）。
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.opener()?.copy(this.range);
    });
    return button;
  }
}

/** 代码块放大触发钮（与表格放大钮同形同几何，只是宿主是代码块 slot）。 */
export class CodeBlockFullscreenTrigger extends WidgetType {
  // 同 BlockCopyTrigger：显式字段，不用构造器参数属性。
  readonly from: number;
  readonly opener: CodeBlockFullscreenOpener;

  constructor(from: number, opener: CodeBlockFullscreenOpener) {
    super();
    this.from = from;
    this.opener = opener;
  }

  eq(other: CodeBlockFullscreenTrigger): boolean {
    return other.from === this.from;
  }

  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = `${BLOCK_TRIGGER_CLASS} ${CODEBLOCK_FS_TRIGGER_CLASS}`;
    button.setAttribute("aria-label", CODEBLOCK_FS_TRIGGER_LABEL);
    button.innerHTML = CORNERS_ICON;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.opener()?.open(this.from);
    });
    return button;
  }
}
