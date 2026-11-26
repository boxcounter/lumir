// 文件树点击的打开意图（change improve-file-open-harness-affordance-nov26，合同 1）。
//
// 判据是**手势 → 落点**这一条纯函数：浏览器式语义下，普通点击在当前标签就地打开，
// ⌘-点击新开标签并保留当前标签；其它修饰键不另立落点（Shift / Alt / Ctrl 与普通点击同义）。
//
// 为什么单测钉这一条：树不 import 装配层、装配层不读鼠标事件，「手势判定」与「落点判定」
// 因此只有一个可脱 DOM 测试的接缝——就是这里。事件绑定层若绕过它自己读 metaKey，
// 下面的断言不会红，所以实现必须让绑定与判据共用同一函数（测试文件同时做源码对账）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { treeOpenIntent } from "../../src/tree.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TREE_SOURCE = readFileSync(path.join(root, "src/tree.ts"), "utf8");

/** 事件形状只取判据用到的字段；其它修饰键以额外键的形式混进来，证明它们不参与判定。 */
function mouse(init: Partial<{ metaKey: boolean; shiftKey: boolean; altKey: boolean; ctrlKey: boolean }> = {}) {
  return { metaKey: false, shiftKey: false, altKey: false, ctrlKey: false, ...init };
}

test("普通点击 = 当前标签；⌘-点击 = 新标签", () => {
  assert.equal(treeOpenIntent(mouse()), "current", "无修饰键是普通点击：当前标签就地打开");
  assert.equal(treeOpenIntent(mouse({ metaKey: true })), "new", "⌘-点击新开标签并保留当前标签");
});

test("其它修饰键不另立落点：Shift / Alt / Ctrl 与普通点击同义", () => {
  for (const extra of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true, altKey: true, ctrlKey: true }]) {
    assert.equal(treeOpenIntent(mouse(extra)), "current", `带了 ${JSON.stringify(extra)} 仍是当前标签`);
  }
  // 反证判据有区分度：metaKey 混在其它修饰键里仍然只认 metaKey。
  assert.equal(treeOpenIntent(mouse({ metaKey: true, shiftKey: true, altKey: true, ctrlKey: true })), "new");
});

test("事件绑定与判据共用同一函数（MUST NOT 在监听里另读 metaKey）", () => {
  // 行点击的监听必须把 event 交给 treeOpenIntent 得出意图，并在同一小窗口里交给回调。
  const listener = /addEventListener\("click",\s*\(event\)\s*=>[\s\S]{0,200}?cb\.onOpenFile\([\s\S]{0,200}?treeOpenIntent\(event\)/;
  assert.match(TREE_SOURCE, listener, "click 监听必须把 event 交给 treeOpenIntent 得出意图");
  // 全文件只允许这一处读 `metaKey`（判据函数内部）；监听里再写一次就是两处真源。
  const reads = [...TREE_SOURCE.matchAll(/\.metaKey/g)];
  assert.equal(reads.length, 1, `metaKey 只允许在 treeOpenIntent 里读一次（实际 ${reads.length} 处）`);
});
