import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageCardMetaText,
  imageDimensionsFromNatural,
  parseQuoteMessage,
  unescapeXmlEntities,
} from "../../src/harness-panel.ts";
import { serializeQuoteMessage } from "../../src/quote-card.ts";
import type { ComposerBlock, QuoteCard } from "../../src/quote-card.ts";

const cardA: QuoteCard = {
  file: "reading-workflow.md",
  heading: "筛 & 选",
  headingPath: "阅读工作流 › 筛 & 选",
  lines: "9-10",
  text: "第一行\n第二行 <带标签>",
};
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const quote = (card: QuoteCard): ComposerBlock => ({ kind: "quote", card });

test("历史消息任意交错解析与投递投影保持互逆", () => {
  const source = [para("前文"), quote(cardA), para("后文")];
  const wire = serializeQuoteMessage(source);
  const restored = parseQuoteMessage(wire);
  assert.equal(restored.length, 3);
  assert.deepEqual(restored[0], para("前文"));
  assert.deepEqual(restored[2], para("后文"));
  const card = restored[1];
  assert.equal(card.kind, "quote");
  if (card.kind === "quote") {
    assert.equal(card.card.file, cardA.file);
    assert.equal(card.card.heading, cardA.heading);
    assert.equal(card.card.text, cardA.text);
    assert.equal(card.card.headingPath, cardA.heading);
  }
  assert.equal(serializeQuoteMessage(restored), wire);
});

test("历史消息中的多行摘录与未知文本不丢失", () => {
  const wire = '<quote file="a.md" heading="" lines="1-3">一行\n二行\n三行</quote>\n问题';
  assert.deepEqual(parseQuoteMessage(wire), [
    { kind: "quote", card: { file: "a.md", heading: "", headingPath: "", lines: "1-3", text: "一行\n二行\n三行" } },
    para("问题"),
  ]);
  const malformed = '前文\n<quote file="a.md" heading="" lines="1">未闭合\n后文';
  const restored = parseQuoteMessage(malformed);
  assert.equal(restored.every((block) => block.kind === "paragraph"), true);
  assert.equal(restored.map((block) => block.kind === "paragraph" ? block.text : "").join("\n"), malformed);
});

test("XML 实体单次扫描解码，不二次解释用户原文", () => {
  assert.equal(unescapeXmlEntities("&amp;lt;"), "&lt;");
  assert.equal(unescapeXmlEntities("&lt;quote&gt;"), "<quote>");
  assert.equal(unescapeXmlEntities("&quot;&amp;&quot;"), '"&"');
  assert.equal(unescapeXmlEntities("&nbsp;"), "&nbsp;");
});

test("图片元信息只接受成对有效自然尺寸", () => {
  assert.equal(imageCardMetaText("a.webp", 640, 360), "a.webp · 640×360");
  assert.equal(imageCardMetaText("a.webp", 640, undefined), "a.webp");
  assert.deepEqual(imageDimensionsFromNatural(1024, 768), { width: 1024, height: 768 });
  for (const [width, height] of [[0, 0], [0, 600], [-1, 2], [Number.NaN, 2]]) {
    assert.equal(imageDimensionsFromNatural(width, height), null);
  }
});
