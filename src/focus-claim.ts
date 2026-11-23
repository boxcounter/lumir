// 新建文件打开成功后的焦点判定（change focus-created-document-nov23）。
//
// 纯函数、零 DOM 依赖：`body` 由调用方传入，单测（tests/unit/focus-claim.test.ts）在 node 里
// 直接断言，浏览器层的事件序列判据归 tests/visual/scenes/focus-created-document-nov23.spec.ts。
//
// 判据 = 「焦点仍在提交时的输入框上，或哪里都不在」（null / `document.body`）。`body` 是
// `tree.endInlineEdit(true)` 删掉内联输入框之后的自然落点，代表用户没有把焦点移到任何新目标；
// 其余（文件树另一行、harness composer、编辑器……）一律放弃，不拽回新文档——这是 F2 的追认值
// （见 change proposal 的 F2 裁决行）。
export function shouldClaimFocus(
  active: Element | null,
  claim: Element | null,
  body: Element | null,
): boolean {
  if (active === null) return true;
  if (active === body) return true;
  return claim !== null && active === claim;
}
