// 阅读位置的值形态（change remember-reading-position 的 design §2.4）：跨会话落盘的三量，以及
// 捕获 / 恢复两个口径的纯函数部分。
//
// 为什么单独一个模块：`git diff` 之外的约束是「本层不 import 编辑器内核」——
// tests/unit 用假 EditorHandle、真 EditorState，真 `EditorView` 需要 DOM（见 tests/unit/README.md）。
// 值形态的推导与往返是**纯代数**，抽到这里就能秒级单测；`src/editor.ts` 只留「读 view 的哪个
// 数与 dispatch 哪个效果」。同 `src/cell-geometry.ts` 的处置。

/** 一份文档的阅读位置（可序列化的三量）。`pos` 是文档位置锚，`y` / `x` 是锚的字符盒相对
 *  **滚动容器**顶 / 左的实际偏移。 */
export interface ScrollPosition {
  pos: number;
  y: number;
  x: number;
}

/** 捕获侧的原始读数（client 坐标；都来自公开 API）。 */
export interface ScrollReadings {
  /** 锚位置的字符盒顶 / 左（`view.coordsAtPos(anchor)`）。 */
  charTop: number;
  charLeft: number;
  /** 滚动容器的顶 / 左（`view.scrollDOM.getBoundingClientRect()`）。 */
  boxTop: number;
  boxLeft: number;
}

/** 捕获口径（值形态的唯一构造点，与 [`restoreScrollTop`] 成对）。
 *
 *  `y` / `x` 取「字符盒相对滚动容器顶 / 左的偏移」，**不是**相对文档顶——这是 design §2.3
 *  的推导在实现期被实测修正的那一处（design §7 第 1、2 条要求实测钉住，不得凭推导宣称已验）：
 *  公开恢复通道 `EditorView.scrollIntoView(pos, {y: "start", yMargin})` 在 CM 里落地为
 *  `scrollRectIntoView(scrollDOM, targetRect, …)`，其不变量是
 *  **`字符盒顶 = 滚动容器顶 + yMargin`**（`@codemirror/view` 的 `scrollRectIntoView`：
 *  `targetTop = rect.top - yMargin; moveY = targetTop - bounding.top`，`bounding` 就是
 *  `scrollDOM` 自己的矩形）。若按「相对文档顶」捕获，`.cm-content` 的 `paddingBlock: 44px`
 *  （`src/editor.ts` 的 baseTheme）会让恢复落点恒等于 44px（页首附近），往返根本不成立；
 *  取「相对滚动容器」后，两个口径互为逆（判据见 tests/unit/scroll-position.test.ts）。
 *
 *  另一个容易看错的口径是 `pos` 的取法：`lineBlockAtHeight(scrollTop)` 取的是**高度等于
 *  scrollTop 的那一行块**，而文档原点（height 0）在页首内边距之下，所以它比「视口顶那一行」
 *  低约一个 `paddingBlock`。这不影响判据——`y` 记录的正是该锚相对视口的实际偏移，捕获与恢复
 *  用同一个锚，「离开时顶行 = 回来时顶行」照旧成立（真机场景 28 与视觉场景的判据都落在顶行）。 */
export function positionFromReadings(readings: ScrollReadings): { y: number; x: number } {
  return { y: readings.charTop - readings.boxTop, x: readings.charLeft - readings.boxLeft };
}

/** 恢复口径：给定**装载后**（scrollTop = 0）的同一读数与落盘载荷，算出效果的落点（scrollTop）。
 *
 *  与 [`positionFromReadings`] 成对：同一份布局下 `restoreScrollTop(readingsAt(0),
 *  positionFromReadings(readingsAt(S))) === S`。调用方用它做两件事——判「落点是否即篇首」
 *  （≤ 0 时不施加效果，保住 M110 的页首内边距），以及在单测里断言两个口径互为逆。 */
export function restoreScrollTop(
  readings: ScrollReadings,
  position: Pick<ScrollPosition, "y">,
): number {
  return readings.charTop - readings.boxTop - position.y;
}
