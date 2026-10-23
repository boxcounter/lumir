// 全屏遮罩内的「全选」（M650，change fullscreen-table-text-selection）。
//
// 一份实现、两处调用：表格全屏（src/table-fullscreen.ts）与代码块全屏（src/code-block-fullscreen.ts）
// 各把自己**已经持有的内容根**传进来。两处各写一份「怎么选中」就是 REVIEW.md『同一语义两处真源』
// 条的形态（选区端点口径、是否清旧 range 都只有一处可漂移）。
//
// 为什么不是把 ⌘A 写进统一键位表：`Cmd-a` 已归 `editor.select-all`，表的不变量是「一个 token
// 一条绑定」，同 token 第二条绑定会被构造期拒绝（src/keys.ts）；遮罩因此就地消费，与既有
// `Esc`（被 `editor.widget-escape` 占用、遮罩仍就地处理）同一条先例。详见 change design §5。

/** 把 `root` 的整棵子树设为当前 DOM 选区的内容（全选）。 */
export function selectAllOf(root: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) return;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(root);
  selection.addRange(range);
}

/** 关闭遮罩前清掉**落在 `root` 内**的 DOM 选区。
 *
 *  两个消费者各只有一个理由（第 2 条决定了调用时机必须排在焦点交还之后——见两个遮罩的 hide）：
 *   1. 「关闭后 MUST NOT 残留可被复制动作取到的遮罩文本」——显式全选或拖选之后的选区不会随
 *      `hidden = true` 自动坍缩，必须在关闭路径上主动清；
 *   2. 交还焦点时浏览器可能把隐藏子树的旧选区带进编辑器（实测：不清理时 CM 的 caret 会被
 *      拽到 0——选区端点落在已隐藏的内容里，聚焦 contentDOM 后 CM 从 DOM 选区同步回状态）。
 *
 *  判据按锚点归属：选区不在 `root` 内（例如用户已经把焦点移走、在别处另选了文本）时不动它，
 *  否则会把不属于遮罩的选区一起清掉。 */
export function clearSelectionWithin(root: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode;
  if (anchor === null) return;
  const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
  if (anchorElement === null || !root.contains(anchorElement)) return;
  selection.removeAllRanges();
}
