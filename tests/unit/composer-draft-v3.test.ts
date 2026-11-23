import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_VERSION,
  parseComposerDraft,
  readComposerDraft,
  serializeComposerDraft,
} from "../../src/quote-card.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";

const quote: ComposerAttachment = {
  kind: "quote",
  card: { file: "synthetic.md", heading: "", headingPath: "", lines: "1-1", text: "CW-CARD-A" },
};
const draftCard = (at: number) => ({ card: quote, at });

test("v3 往返保留行首与行中 anchor，且不写 id 或图片字节", () => {
  const raw = serializeComposerDraft("AB\nC", 2, [draftCard(1), draftCard(3)] as any);
  assert.equal(DRAFT_VERSION, 3);
  assert.deepEqual(parseComposerDraft(raw), {
    version: 3,
    text: "AB\nC",
    caret: 2,
    cards: [draftCard(1), draftCard(3)],
  });
  assert.equal(raw.includes('"id"'), false);
  assert.equal(raw.includes("data:image"), false);
});

test("真实 CRLF v3 在共同出口归一文本、caret 与卡片 at", () => {
  const parsed = readComposerDraft(JSON.stringify({
    version: 3,
    text: "A\r\nB\r\nC",
    caret: 4,
    cards: [{ card: quote, at: 6 }],
  }));
  assert.deepEqual(parsed?.draft, {
    version: 3,
    text: "A\nB\nC",
    caret: 3,
    cards: [draftCard(4)],
  });
  assert.equal(parsed?.changed, true);
});

test("CRLF v2 的原始 caret 经同一映射归一，卡片全部落 at 0 并标记迁移", () => {
  const parsed = readComposerDraft(JSON.stringify({ version: 2, text: "A\r\nBC", caret: 4, cards: [quote] }));
  assert.deepEqual(parsed?.draft, { version: 3, text: "A\nBC", caret: 3, cards: [draftCard(0)] });
  assert.equal(parsed?.migrated, true);
  assert.equal(parsed?.changed, true);
});

test("混合行界 v1 先迁移原始坐标，再经共同出口归一", () => {
  const parsed = readComposerDraft(JSON.stringify({
    version: 1,
    blocks: [{ kind: "paragraph", text: "A\r\nB\rC\nD" }, quote],
    caret: { block: 0, offset: 7 },
  }));
  assert.deepEqual(parsed?.draft, {
    version: 3,
    text: "A\nB\nC\nD",
    caret: 6,
    cards: [draftCard(0)],
  });
  assert.equal(parsed?.migrated, true);
  assert.equal(parsed?.changed, true);
});

test("v3 非整数与越界 at 只钳到文档范围，不钳行首", () => {
  const parsed = readComposerDraft(JSON.stringify({
    version: 3,
    text: "AB\nC",
    caret: 0,
    cards: [{ card: quote, at: 1.5 }, { card: quote, at: 99 }, { card: quote, at: -2 }],
  }));
  assert.deepEqual(parsed?.draft.cards.map((card) => card.at), [1, 4, 0]);
});

test("损坏草稿仍安静回空", () => {
  for (const raw of ["", "null", '{"version":3,"text":"x"}', '{"version":3,"text":"x","cards":[{"card":{"kind":"paragraph","text":"bad"},"at":0}]}']) {
    assert.equal(readComposerDraft(raw), null);
  }
});
