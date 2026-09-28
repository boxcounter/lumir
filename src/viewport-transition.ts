// 应用自身推动视口的**窗口标记**（M286）：捕获侧据此让位。
//
// 缺陷族（M279 现场 → M280 修跳变 → 本模块收口剩下的竞态）：阅读位置的捕获挂在滚动容器的原生
// `scroll` 事件上，而**应用自己**也会推视口，两条路径都是「中间态 → 目标位置」两拍：
//   - 交还焦点的聚焦揭示：`view.focus()` 让**引擎**把视口拽到 caret 处（WebKit 实测从 1543 拽到
//     0 / −1），目标位置由本应用随后经 CM 的滚动通道写回（`src/scroll-position-view.ts`）；
//   - 装载复位：`editor.reloadSession` 的 `scrollTop = 0`（M110 的既有口径），目标位置由紧随其后的
//     `readingPositions.restoreFor` 施加（`src/main.ts` 的 `loadSessionContent` / 外部重载同序）。
// 捕获若在中间态那一拍读位置，就会把「篇首」当成用户离开的位置写盘，而恢复侧对 `anchor === 0`
// 刻意不施加（M110 口径）⇒ 该文档此后每次打开都从篇首开始（finding
// `20260927-worker-survey-esc-jump-bug-esc-pos-0-anchor-0.md`；真实 vault 47 条里 19 条 `pos 0`）。
//
// 判据取的是「本应用此刻正在推视口」这个**事实**，不是任何时长量：中间态与写回落在同一帧还是
// 跨帧由引擎决定（M279/M280 实测两种都出现过），任何 `setTimeout` 阈值都是在猜。推视口的一方
// 开窗、写回落地后关窗，窗口内到达的滚动事件**整体忽略**——忽略整个窗口而不是「只忽略篇首」
// 这类值判据，是因为中间态的口径同样由引擎决定（实测过 `0` 与 `-1` 两种）。
//
// 窗口的边界（谁在哪一拍关窗）由开窗方决定，见 `src/scroll-position-view.ts` 的
// `duringViewportTransition`：那里给出的边界是「本模块自己那一拍写回所在的测量帧之后」。
//
// 本模块是纯计数器：无 DOM、无时钟、无 IO，任何一侧都能安全 import（node 端单测导入了它的
// 传递依赖也照样跑）。窗口**嵌套安全**——装载路径的窗口里会嵌一次交还焦点的窗口（外部重载先
// 复位视口、再关浮层交还焦点），任一方提前关窗都会让另一半的中间态漏出去。

/** 当前开着的窗口数。 */
let depth = 0;

/** 开一扇窗（可嵌套）。开窗方 MUST 与 `endViewportTransition` 一一配对。 */
export function beginViewportTransition(): void {
  depth += 1;
}

/** 关一扇窗。计数归零之前窗口仍然有效；多余的 end（无对应 begin）不把计数压到负数。 */
export function endViewportTransition(): void {
  if (depth > 0) depth -= 1;
}

/** 本应用是否正在推动视口（窗口内）。捕获侧的唯一消费点（`src/reading-position.ts` 的
 *  `scrolled`）：窗口内到达的滚动事件 MUST NOT 被记录。 */
export function viewportTransitionInFlight(): boolean {
  return depth > 0;
}
