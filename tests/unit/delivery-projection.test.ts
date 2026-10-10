// 投递投影与面板文本投影的单测（change harness-composer-image-paste 任务 1.3 / 1.4）。
//
// 合同：design §4.1–§4.2——
//   ① 块序 ⟺ 投递 parts 交错顺序（[段落, 图, 段落] → [text, image, text]）；
//   ② 纯文本/卡片消息投影为**单** text part，与既有 serializeQuoteMessage 逐字节一致；
//   ③ 面板文本 ⟺ 投递 parts 由**同一个函数**（projectDelivery）产出，round-trip 钉住；
//   ④ XML 转义 round-trip；协议零编号；未知元素保守不丢文。
//
// round-trip 用 src/harness-panel.ts 的 parseQuoteMessage（反向实现），不用被测代码自证。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectDelivery,
  serializeDelivery,
  serializeQuoteMessage,
  type ComposerBlock,
  type ImageCard,
  type QuoteCard,
} from "../../src/quote-card.ts";
import { parseQuoteMessage } from "../../src/harness-panel.ts";

const cardA: QuoteCard = {
  file: "reading-workflow.md",
  heading: "筛选",
  headingPath: "阅读工作流 › 筛选",
  lines: "9-10",
  text: "先读结论再读论证",
};

const image: ImageCard = { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 640, height: 360 };
const imageBlock: ComposerBlock = { kind: "image", card: image };
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });

test("纯文本消息：单 text part，与既有序列化逐字节一致", () => {
  const blocks = [
    para("这段是什么意思？"),
    { kind: "quote", card: cardA },
    para("这里指什么？"),
  ] as ComposerBlock[];
  const legacy = [
    "这段是什么意思？",
    '<quote file="reading-workflow.md" heading="筛选" lines="9-10">先读结论再读论证</quote>',
    "这里指什么？",
  ].join("\n");
  const projection = projectDelivery(blocks);
  assert.equal(projection.panelText, legacy);
  assert.deepEqual(projection.parts, [{ kind: "text", text: legacy }]);
  assert.deepEqual(serializeDelivery(blocks), [{ kind: "text", text: legacy }]);
  assert.equal(serializeQuoteMessage(blocks), legacy, "文本面行为逐字节不变");
});

test("交错顺序：[段落, 图, 段落] → [text, image, text]，逐位保留", () => {
  const blocks = [para("先看这张图"), imageBlock, para("图里哪里不对？")];
  const projection = projectDelivery(blocks);
  assert.deepEqual(projection.parts, [
    { kind: "text", text: "先看这张图" },
    { kind: "image", name: image.name },
    { kind: "text", text: "图里哪里不对？" },
  ]);
  assert.equal(
    projection.panelText,
    ['先看这张图', `<image ref="${image.name}" type="image/png" width="640" height="360"/>`, "图里哪里不对？"].join("\n"),
  );
});

test("连续图片块各自成 part；图在首 / 图在尾", () => {
  const two = projectDelivery([imageBlock, imageBlock]);
  assert.deepEqual(two.parts, [
    { kind: "image", name: image.name },
    { kind: "image", name: image.name },
  ]);
  assert.equal(two.panelText.split("\n").length, 2);
  const head = projectDelivery([imageBlock, para("什么问题？")]);
  assert.deepEqual(head.parts, [
    { kind: "image", name: image.name },
    { kind: "text", text: "什么问题？" },
  ]);
});

test("图片卡片属性转义 round-trip：name / sourceMime 含 XML 保留字符", () => {
  const tricky: ImageCard = { name: "pasted-ab&lt;.webp", sourceMime: 'image/png";x' };
  const blocks: ComposerBlock[] = [para("问"), { kind: "image", card: tricky }, para("尾")];
  const projection = projectDelivery(blocks);
  const restored = parseQuoteMessage(projection.panelText);
  assert.deepEqual(restored, [para("问"), { kind: "image", card: { name: tricky.name, sourceMime: tricky.sourceMime, width: undefined, height: undefined } }, para("尾")]);
  // 投递 part 只带 name（sourceMime 不进投递内容）。
  assert.deepEqual(projection.parts[1], { kind: "image", name: tricky.name });
});

test("round-trip：面板文本 ⟺ 块序列（含 quote / msgquote / image 三类卡片）", () => {
  const blocks: ComposerBlock[] = [
    { kind: "quote", card: cardA },
    para("第一段"),
    imageBlock,
    { kind: "msgquote", card: { role: "assistant", at: null, text: "上次说的结论" } },
    para("第二段"),
  ];
  const projection = projectDelivery(blocks);
  const restored = parseQuoteMessage(projection.panelText);
  // parseQuoteMessage 的段落口径：连续非元素行合并为一个段落；此处元素把段落隔开，逐块还原。
  // headingPath 不进协议（人侧专用字段）：恢复的引用卡 hover 退化为 heading 链（M342 口径）。
  const expected: ComposerBlock[] = [
    { kind: "quote", card: { ...cardA, headingPath: cardA.heading } },
    para("第一段"),
    imageBlock,
    { kind: "msgquote", card: { role: "assistant", at: null, text: "上次说的结论" } },
    para("第二段"),
  ];
  assert.deepEqual(restored, expected);
  // 再投影必须稳定（幂等）：restore → 再投影逐字节相同。
  assert.equal(projectDelivery(restored).panelText, projection.panelText);
  assert.deepEqual(projectDelivery(restored).parts, projection.parts);
});

test("尺寸缺席的占位元素（wire 引用恢复形态）解析为无尺寸卡片", () => {
  const restored = parseQuoteMessage('<image ref="pasted-0123456789abcdef.webp" type="image/webp"/>\n这图是什么？');
  assert.deepEqual(restored, [
    { kind: "image", card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/webp", width: undefined, height: undefined } },
    para("这图是什么？"),
  ]);
});

test("未知 / 畸形元素保守不丢文：整行原样落段落", () => {
  const text = "<image ref=\"unclosed\n普通一行";
  const restored = parseQuoteMessage(text);
  assert.deepEqual(restored, [para(text)], "不成形的占位行按段落落地，内容守恒");
});

test("零编号：图片占位元素属性集合恰为 ref / type / width / height", () => {
  const projection = projectDelivery([imageBlock]);
  const attrs = [...projection.panelText.matchAll(/\s([A-Za-z][\w-]*)="/g)].map((m) => m[1]);
  assert.deepEqual(attrs, ["ref", "type", "width", "height"]);
});

test("空消息：空 parts、空 panelText（不投递空内容）", () => {
  assert.deepEqual(projectDelivery([para(""), para("  ")]), { panelText: "", parts: [] });
  assert.equal(serializeQuoteMessage([]), "");
});

test("卡片字段缺失仍抛错（quote 空 lines），不产出半截投影", () => {
  const bad = [{ kind: "quote", card: { ...cardA, lines: " " } }] as ComposerBlock[];
  assert.throws(() => projectDelivery(bad), /lines/);
  assert.throws(() => serializeQuoteMessage(bad), /lines/);
});
