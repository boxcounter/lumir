import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_VERSION,
  draftUnknownBlockText,
  parseComposerDraft,
  readComposerDraft,
  serializeComposerDraft,
} from "../../src/quote-card.ts";
import type { ComposerAttachment, ComposerBlock } from "../../src/quote-card.ts";

const quote: ComposerAttachment = {
  kind: "quote",
  card: { file: "notes/a.md", heading: "标题", headingPath: "父 › 标题", lines: "3-5", text: "摘录原文" },
};
const message: ComposerAttachment = { kind: "msgquote", card: { role: "assistant", at: 1_760_000_000_000, text: "消息摘录" } };
const image: ComposerAttachment = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 800, height: 600 },
};
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const placed = (card: ComposerAttachment, at = 0) => ({ card, at });

function v1(blocks: readonly ComposerBlock[], caret: { block: number; offset: number } | null = null): string {
  return JSON.stringify({ version: 1, blocks, caret });
}

test("v3 往返逐字段无损，包含多行文本、全文 caret 和三类附件", () => {
  const text = "第一行\n第二行";
  const cards = [placed(quote, 0), placed(message, 2), placed(image, 4)];
  const raw = serializeComposerDraft(text, 3, cards);
  assert.deepEqual(parseComposerDraft(raw), { version: 3, text, caret: 3, cards });
  assert.equal(DRAFT_VERSION, 3);
  assert.equal(serializeComposerDraft(text, 3, parseComposerDraft(raw)?.cards ?? []), raw);
  assert.equal(raw.includes("data:image"), false);
  assert.equal(/base64/i.test(raw), false);
});

test("v2 非法 caret 归 null并迁移 v3，非法 / 未知附件整份回退", () => {
  assert.deepEqual(parseComposerDraft('{"version":2,"text":"x","caret":9,"cards":[]}'), {
    version: 3, text: "x", caret: null, cards: [],
  });
  for (const raw of [
    "", "null", "{}", '{"version":99,"text":"x","cards":[]}',
    '{"version":2,"text":"x","cards":[{"kind":"paragraph","text":"bad"}]}',
    '{"version":2,"text":"x","cards":[{"kind":"future","text":"bad"}]}',
    '{"version":2,"text":"x","cards":[{"kind":"quote","card":{"file":"a","heading":"h","lines":"","text":"t"}}]}',
  ]) {
    assert.equal(parseComposerDraft(raw), null, raw);
  }
});

test("v1 转换：段落与未知块文本守恒、空段落保留、卡片按相对顺序落到 at 0", () => {
  const unknown = { kind: "future-block", payload: { deep: [1, 2] } } as unknown as ComposerBlock;
  const blocks: ComposerBlock[] = [para("前文"), quote, para(""), message, unknown, image, para("后文")];
  const parsed = readComposerDraft(v1(blocks));
  assert.equal(parsed?.migrated, true);
  assert.deepEqual(parsed?.draft, {
    version: 3,
    text: ["前文", "", draftUnknownBlockText(unknown), "后文"].join("\n"),
    caret: null,
    cards: [placed(quote), placed(message), placed(image)],
  });
});

test("v1 段落 caret 精确映射，段长之外钳到该可见文本末缘", () => {
  const blocks: ComposerBlock[] = [para("ab"), quote, para("cde"), image, para("f")];
  assert.equal(readComposerDraft(v1(blocks, { block: 2, offset: 1 }))?.draft.caret, 4);
  assert.equal(readComposerDraft(v1(blocks, { block: 0, offset: 99 }))?.draft.caret, 2);
  assert.equal(readComposerDraft(v1(blocks, { block: 4, offset: 1 }))?.draft.caret, 8);
});

test("v1 卡片 / 末尾 caret 映到最近后续文本起点，无后续则全文末尾", () => {
  const blocks: ComposerBlock[] = [para("ab"), quote, para("cde"), image];
  assert.equal(readComposerDraft(v1(blocks, { block: 1, offset: 0 }))?.draft.caret, 3);
  assert.equal(readComposerDraft(v1(blocks, { block: 3, offset: 0 }))?.draft.caret, 6);
  assert.equal(readComposerDraft(v1(blocks, { block: 4, offset: 0 }))?.draft.caret, 6);
});

test("v1 损坏与非法 caret 安静回退或归 null", () => {
  for (const raw of [
    '{"version":1}', '{"version":1,"blocks":{}}', '{"version":1,"blocks":[1]}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":42}]}',
    '{"version":1,"blocks":[{"kind":"msgquote","card":{"role":"system","text":"x"}}]}',
  ]) assert.equal(readComposerDraft(raw), null, raw);
  assert.equal(readComposerDraft(v1([para("x")], { block: -1, offset: 0 }))?.draft.caret, null);
  assert.equal(readComposerDraft(v1([para("x")], { block: 5, offset: 0 }))?.draft.caret, null);
});

test("属性枚举：任意块序迁移后文本 / 卡片各出现一次且 caret 合法", () => {
  const unknown = { kind: "future", value: "可见" } as unknown as ComposerBlock;
  const atoms: ComposerBlock[] = [para("a"), para(""), quote, message, image, unknown];
  for (let bits = 0; bits < 64; bits += 1) {
    const blocks = atoms.filter((_, index) => (bits & (1 << index)) !== 0);
    for (let caretBlock = 0; caretBlock <= blocks.length; caretBlock += 1) {
      const parsed = readComposerDraft(v1(blocks, { block: caretBlock, offset: 0 }));
      assert.notEqual(parsed, null);
      const draft = parsed!.draft;
      assert.ok(draft.caret === null || (draft.caret >= 0 && draft.caret <= draft.text.length));
      const expectedCards = blocks.filter((block): block is ComposerAttachment =>
        block.kind === "quote" || block.kind === "msgquote" || block.kind === "image");
      assert.deepEqual(draft.cards, expectedCards.map((card) => placed(card)));
      const expectedText = blocks.filter((block) => !expectedCards.includes(block as ComposerAttachment))
        .map((block) => block.kind === "paragraph" ? block.text : draftUnknownBlockText(block)).join("\n");
      assert.equal(draft.text, expectedText);
    }
  }
});
