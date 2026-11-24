import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, Transaction } from "@codemirror/state";
import {
  appendComposerAttachments,
  applyComposerTransaction,
  composerAttachmentsField,
  composerBlocks,
  composerContentOf,
  composerRedo,
  composerUndo,
  createComposerState,
  projectComposerDelivery,
  removeComposerAttachment,
} from "../../src/harness-composer.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const quote: ComposerAttachment = {
  kind: "quote",
  card: { file: "synthetic.md", heading: "", headingPath: "", lines: "1-1", text: "CW-CARD-A" },
};
const image: ComposerAttachment = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.png", sourceMime: "image/png" },
};
const placed = (id: number, card: ComposerAttachment, anchor: number) => ({ id, card, anchor });

function makeState(text: string, caret: number | null, cards: Array<ReturnType<typeof placed>> = []) {
  return createComposerState({ text, caret, cards } as any);
}

function blockShape(state: ReturnType<typeof makeState>): unknown[] {
  return composerBlocks(state).map((block) => block.kind === "paragraph"
    ? ["text", block.text]
    : [block.kind, block.kind === "image" ? block.card.name : block.card.text]);
}

const insertionCases = [
  { name: "行首", text: "A\nB", caret: 2, anchor: 1, head: 2, doc: "A\nB", at: 2 },
  { name: "行中", text: "AB\nC", caret: 1, anchor: 1, head: 1, doc: "A\nB\nC", at: 2 },
  { name: "非末行行尾", text: "A\nB", caret: 1, anchor: 1, head: 1, doc: "A\nB", at: 2 },
  { name: "文末", text: "AB", caret: 2, anchor: 2, head: 2, doc: "AB\n", at: 3 },
  { name: "空文档", text: "", caret: 0, anchor: 0, head: 0, doc: "", at: 0 },
  { name: "非空选区不删文字", text: "ABCD", caret: 3, anchor: 1, head: 3, doc: "ABC\nD", at: 4 },
];

for (const item of insertionCases) {
  test(`初始落位：${item.name}`, () => {
    let state = makeState(item.text, item.caret);
    if (item.anchor !== item.head) {
      state = state.update({ selection: EditorSelection.range(item.anchor, item.head) }).state;
    }
    state = applyComposerTransaction(state, (appendComposerAttachments as any)(state, [quote]));
    assert.equal(state.doc.toString(), item.doc);
    assert.equal(state.selection.main.head, item.at);
    assert.equal(state.selection.main.empty, true);
    assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.anchor), [item.at]);
  });
}

test("行中插卡与拆行只有一步 history，undo/redo 完整可逆", () => {
  let state = makeState("AB\nC", 1);
  const before = composerContentOf(state);
  state = applyComposerTransaction(state, (appendComposerAttachments as any)(state, [quote]));
  assert.equal(state.doc.toString(), "A\nB\nC");
  assert.deepEqual(blockShape(state), [["text", "A"], ["quote", "CW-CARD-A"], ["text", "B\nC"]]);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), before.text);
  assert.deepEqual(state.field(composerAttachmentsField), []);
  state = composerRedo(state);
  assert.equal(state.doc.toString(), "A\nB\nC");
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.anchor), [2]);
});

test("精确偏移投影：段落 / quote / image / 段落按 anchor 交错，无卡投影不变", () => {
  const state = makeState("AB\nCD", 0, [placed(1, quote, 1), placed(2, image, 3)]);
  const projected = projectComposerDelivery(state);
  assert.deepEqual(blockShape(state), [
    ["text", "A"],
    ["quote", "CW-CARD-A"],
    ["text", "B"],
    ["image", "pasted-0123456789abcdef.png"],
    ["text", "CD"],
  ]);
  assert.deepEqual(projected.parts.map((part) => part.kind), ["text", "image", "text"]);
  assert.equal(projected.panelText, [
    "A",
    '<quote file="synthetic.md" heading="" lines="1-1">CW-CARD-A</quote>',
    "B",
    '<image ref="pasted-0123456789abcdef.png" type="image/png"/>',
    "CD",
  ].join("\n"));
  const plain = makeState("A<&\nB", 0);
  assert.deepEqual(composerBlocks(plain), [{ kind: "paragraph", text: "A<&\nB" }]);
  assert.equal(projectComposerDelivery(plain).panelText, "A&lt;&amp;\nB");
});

test("精确映射矩阵：锚点输入、删除行界、跨行删除和全选替换", () => {
  const cases = [
    { name: "anchor 处输入", spec: { changes: { from: 2, insert: "x" }, userEvent: "input.type" }, doc: "A\nxB", at: 2, blocks: [["text", "A"], ["quote", "CW-CARD-A"], ["text", "xB"]] },
    { name: "anchor 前输入", spec: { changes: { from: 1, insert: "x" }, userEvent: "input.type" }, doc: "Ax\nB", at: 3, blocks: [["text", "Ax"], ["quote", "CW-CARD-A"], ["text", "B"]] },
    { name: "删除行界", spec: { changes: { from: 1, to: 2 }, userEvent: "delete.backward" }, doc: "AB", at: 1, blocks: [["text", "A"], ["quote", "CW-CARD-A"], ["text", "B"]] },
    { name: "跨行删除", spec: { changes: { from: 1, to: 3 }, userEvent: "delete.selection" }, doc: "A", at: 1, blocks: [["text", "A"], ["quote", "CW-CARD-A"]] },
    { name: "全选替换", spec: { changes: { from: 0, to: 3, insert: "XYZ" }, userEvent: "input.paste" }, doc: "XYZ", at: 0, blocks: [["quote", "CW-CARD-A"], ["text", "XYZ"]] },
  ];
  for (const item of cases) {
    const initial = makeState("A\nB", 0, [placed(1, quote, 2)]);
    const next = applyComposerTransaction(initial, item.spec);
    assert.equal(next.doc.toString(), item.doc, item.name);
    assert.deepEqual(next.field(composerAttachmentsField).map((card: any) => card.anchor), [item.at], item.name);
    assert.deepEqual(blockShape(next), item.blocks, item.name);
    const undone = composerUndo(next);
    assert.equal(undone.doc.toString(), "A\nB", `${item.name} undo doc`);
    assert.deepEqual(undone.field(composerAttachmentsField).map((card: any) => card.anchor), [2], `${item.name} undo anchor`);
    assert.deepEqual(blockShape(undone), [["text", "A"], ["quote", "CW-CARD-A"], ["text", "B"]], `${item.name} undo blocks`);
    const redone = composerRedo(undone);
    assert.deepEqual(redone.field(composerAttachmentsField).map((card: any) => card.anchor), [item.at], `${item.name} redo anchor`);
    assert.deepEqual(blockShape(redone), item.blocks, `${item.name} redo blocks`);
  }
});

test("连续 input.type 分组 undo 取最早完整快照，redo 取最终快照", () => {
  let state = makeState("A\nB", 1, [placed(1, quote, 2)]);
  state = applyComposerTransaction(state, { changes: { from: 1, insert: "x" }, selection: { anchor: 2 }, userEvent: "input.type" });
  state = applyComposerTransaction(state, { changes: { from: 2, insert: "y" }, selection: { anchor: 3 }, userEvent: "input.type" });
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.anchor), [4]);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), "A\nB");
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.anchor), [2]);
  assert.deepEqual(blockShape(state), [["text", "A"], ["quote", "CW-CARD-A"], ["text", "B"]]);
  state = composerRedo(state);
  assert.equal(state.doc.toString(), "Axy\nB");
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.anchor), [4]);
});

test("非 history 文档变更被拒绝，装载用新 state 隔离旧 history", () => {
  const state = makeState("AB", 1, [placed(1, quote, 1)]);
  assert.throws(() => applyComposerTransaction(state, {
    changes: { from: 0, insert: "R" },
    annotations: Transaction.addToHistory.of(false),
  }), /addToHistory|remote|history/);
  assert.throws(() => applyComposerTransaction(state, {
    changes: { from: 0, insert: "R" },
    annotations: Transaction.remote.of(true),
  }), /addToHistory|remote|history/);
  const loaded = makeState("AB", 1, [placed(2, quote, 1)]);
  assert.equal(composerUndo(loaded), loaded);
});

test("移除按稳定 id，undo 恢复原堆叠位次", () => {
  let state = makeState("AB", 0, [placed(10, quote, 1), placed(11, image, 1)]);
  state = applyComposerTransaction(state, removeComposerAttachment(10));
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.id), [11]);
  state = composerUndo(state);
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => [card.id, card.anchor]), [[10, 1], [11, 1]]);
  state = composerRedo(state);
  assert.deepEqual(state.field(composerAttachmentsField).map((card: any) => card.id), [11]);
});

test("拒绝合并：当前卡片只平移原文长度，不补换行、不钳行首", async () => {
  const { mergeRejectedComposerContent } = await import("../../src/harness-composer.ts");
  const merged = mergeRejectedComposerContent(
    { text: "OLD", caret: 3, cards: [placed(1, quote, 1)], skills: [] },
    { text: "NEW", caret: 1, cards: [placed(2, image, 0)], skills: [] },
  );
  assert.equal(merged.text, "OLDNEW");
  assert.equal(merged.caret, 4);
  assert.deepEqual(merged.cards.map((card: any) => [card.id, card.anchor]), [[1, 1], [2, 3]]);
});
