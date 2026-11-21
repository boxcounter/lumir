import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { MarkdownParser } from "@lezer/markdown";
import {
  advanceGroupScan,
  createGroupScan,
  estimateGroup,
  type ListGroup,
} from "../../src/preview/lists.ts";

const parser = (markdownLanguage.parser as MarkdownParser).configure(GFM);
type Node = ReturnType<MarkdownParser["parse"]>["topNode"];

function onlyList(doc: string): { list: Node; item: Node; text: Text } {
  const tree = parser.parse(doc);
  const text = Text.of(doc.split("\n"));
  let found: Node | null = null;
  tree.iterate({
    enter(node) {
      if (found === null && (node.name === "BulletList" || node.name === "OrderedList")) found = node.node;
    },
  });
  const list = found as Node | null;
  assert.ok(list, `${JSON.stringify(doc)} 必须有列表`);
  const item = list.firstChild;
  assert.ok(item?.name === "ListItem");
  assert.equal(item.nextSibling, null, "本组估算==扫描合同以单项新组为输入");
  return { list, item, text };
}

function scanned(list: Node, text: Text): ListGroup {
  const scan = createGroupScan(list, text);
  advanceGroupScan(scan, text, Number.POSITIVE_INFINITY);
  assert.equal(scan.item, null);
  return { width: scan.width, body: scan.indent + scan.width, depth: scan.depth, labels: scan.labels };
}

test("单项新组：ul / ol / 任务项的估算与扫描 width/body/labels 逐项相等", () => {
  for (const doc of ["- alpha", "+ alpha", "* alpha", "1. alpha", "2) alpha", "- [ ] alpha", "- [x] alpha"]) {
    const { list, item, text } = onlyList(doc);
    const estimate = estimateGroup(list, text, item);
    assert.ok(estimate, `${JSON.stringify(doc)} 必须给出首帧估算`);
    assert.deepEqual(estimate, scanned(list, text), JSON.stringify(doc));
  }
});

test("多项组不走单项首帧估算：保留组宽扫描，避免后扫描二次横移", () => {
  const doc = "1. one\n2. two\n3. three";
  const tree = parser.parse(doc);
  const text = Text.of(doc.split("\n"));
  const list = tree.topNode.getChild("OrderedList");
  assert.ok(list);
  for (let item = list.firstChild; item; item = item.nextSibling) {
    assert.equal(estimateGroup(list, text, item), null);
  }
  const scan = createGroupScan(list, text);
  advanceGroupScan(scan, text, Number.POSITIVE_INFINITY);
  assert.deepEqual([...scan.labels.values()], ["1.", "2.", "3."]);
});

test("嵌套有序：父 ol 的复合编号在首帧与扫描同式", () => {
  const doc = "1. parent\n   1. child";
  const tree = parser.parse(doc);
  const text = Text.of(doc.split("\n"));
  const lists: Node[] = [];
  tree.iterate({ enter(node) { if (node.name === "OrderedList") lists.push(node.node); } });
  assert.equal(lists.length, 2);
  const child = lists[1].firstChild;
  assert.ok(child);
  const estimate = estimateGroup(lists[1], text, child);
  assert.ok(estimate);
  assert.equal(estimate.labels.get(child.from), "1.1");
  assert.deepEqual(estimate, scanned(lists[1], text));
});

test("嵌套断链：父 ul 不把编号传给子 ol；估算仍等于扫描", () => {
  const doc = "- parent\n  1. child";
  const tree = parser.parse(doc);
  const text = Text.of(doc.split("\n"));
  let childList: Node | null = null;
  tree.iterate({ enter(node) { if (node.name === "OrderedList") childList = node.node; } });
  const list = childList as Node | null;
  assert.ok(list);
  const child = list.firstChild;
  assert.ok(child);
  const estimate = estimateGroup(list, text, child);
  assert.ok(estimate);
  assert.equal(estimate.labels.get(child.from), "1.");
  assert.deepEqual(estimate, scanned(list, text));
});
