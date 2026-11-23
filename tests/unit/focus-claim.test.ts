// `src/focus-claim.ts` 的单测（change focus-created-document-nov23，tasks 2.10 / 2.14）：
// 新建文件打开成功后的焦点判定。
//
// 这一层判的是**纯逻辑**：`shouldClaimFocus` 零 DOM（`body` 由调用方传入，单测在 node 里直接
// 断言），因此「body / null / 提交时的输入框算可聚焦，其余一律放弃」这条 F2 追认值能逐格钉住，
// 不必靠浏览器场景间接兜底。真实事件序列（装载期间无编辑器获焦、浮层被动关闭）归
// `tests/visual/scenes/focus-created-document-nov23.spec.ts` 与真机场景 47c。

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldClaimFocus } from "../../src/focus-claim.ts";

/** 只用来判身份（`===`）的占位节点：函数不读任何 DOM 属性。 */
function node(name: string): Element {
  return { nodeName: name } as unknown as Element;
}

const BODY = node("BODY");
const CLAIM = node("INPUT");
const TREE_ROW = node("BUTTON");
const COMPOSER = node("TEXTAREA");
const EDITOR = node("DIV");

test("shouldClaimFocus：body / null 都代表「用户没把焦点移到新目标」", () => {
  assert.equal(shouldClaimFocus(BODY, CLAIM, BODY), true, "endInlineEdit 删掉输入框后的自然落点");
  assert.equal(shouldClaimFocus(null, CLAIM, BODY), true, "无 activeElement（防御性）");
  assert.equal(shouldClaimFocus(null, null, BODY), true, "没有提交时的输入框也照常可聚焦");
});

test("shouldClaimFocus：焦点仍在提交时的输入框上 ⇒ 可聚焦", () => {
  assert.equal(shouldClaimFocus(CLAIM, CLAIM, BODY), true, "输入框还在场且仍持焦");
});

test("shouldClaimFocus：焦点已移到仍在场的其它目标 ⇒ 放弃（F2 追认值：严格不抢）", () => {
  assert.equal(shouldClaimFocus(TREE_ROW, CLAIM, BODY), false, "文件树另一行");
  assert.equal(shouldClaimFocus(COMPOSER, CLAIM, BODY), false, "harness composer");
  assert.equal(shouldClaimFocus(EDITOR, CLAIM, BODY), false, "编辑器（用户自己点进去）");
});

test("shouldClaimFocus：提交时的输入框已从 DOM 移除（焦点落回 body）⇒ 仍可聚焦", () => {
  // 真实时序：`tree.endInlineEdit(true)` 先摘掉输入框，焦点随之落回 body；`claim` 持有的是
  // 那个已脱离文档的节点。判定不能因为「claim 不在 DOM 里」就放弃——否则正常路径永远不聚焦。
  assert.equal(shouldClaimFocus(BODY, CLAIM, BODY), true);
  assert.equal(shouldClaimFocus(CLAIM, CLAIM, BODY), true, "身份相等优先于是否在场（防御性）");
});
