// 撤回消息的 composer 投影（change add-harness-message-withdraw-nov26）。
//
// 两个判据：
// - `composerContentFromMessage` 是 `projectDelivery` 的逆：卡片行拆回块、段落还原 XML 实体、
//   卡片锚点与 `composerBlocks` 的「卡片前去掉一个换行」互逆；
// - 撤回合并 = 原文在前、当前输入在后（补一个换行），光标落原文末尾。
// 造一个必须让它 FAIL 的输入：把卡片塞进段落、或把 `&amp;lt;` 还原两次，下列断言都会红。

import assert from "node:assert/strict";
import { test } from "node:test";
import { composerContentFromMessage } from "../../src/harness-panel.ts";
import { mergeWithdrawnComposerContent } from "../../src/harness-composer.ts";
import { projectDelivery } from "../../src/quote-card.ts";
import type { ComposerBlock, QuoteCard } from "../../src/quote-card.ts";

const quote: QuoteCard = {
  file: "notes/a.md",
  heading: "一节",
  headingPath: "一节",
  lines: "1-2",
  text: "被引用的原文",
};

const imageBlock: ComposerBlock = {
  kind: "image",
  card: { name: "pasted-a0123456789bc.webp", sourceMime: "image/webp" },
};

test("纯文本：XML 实体还原一次，光标在末尾", () => {
  const content = composerContentFromMessage("a &lt; b &amp;&amp; c");
  assert.equal(content.text, "a < b && c");
  assert.equal(content.caret, "a < b && c".length);
  assert.deepEqual(content.cards, []);
});

test("引用卡片：锚点落在卡片前一行的末尾，段落之间保留换行", () => {
  const text = projectDelivery([
    { kind: "paragraph", text: "前段" },
    { kind: "quote", card: quote },
    { kind: "paragraph", text: "后段" },
  ]).panelText;
  const content = composerContentFromMessage(text);
  assert.equal(content.text, "前段\n后段");
  assert.equal(content.cards.length, 1);
  assert.equal(content.cards[0]?.anchor, 3, "锚点在「前段」后的换行之后");
  assert.equal(content.cards[0]?.card.kind, "quote");
});

test("行首卡片：不凭空补前导换行", () => {
  const text = projectDelivery([
    imageBlock,
    { kind: "paragraph", text: "看图" },
  ]).panelText;
  const content = composerContentFromMessage(text);
  assert.equal(content.text, "看图");
  assert.equal(content.cards[0]?.anchor, 0);
  const image = content.cards[0]?.card;
  assert.equal(image?.kind, "image");
  assert.equal(image?.kind === "image" ? image.card.name : null, "pasted-a0123456789bc.webp");
  assert.equal(image?.kind === "image" ? image.card.sourceMime : null, "image/webp");
});

test("连续卡片共用同一锚点，块的顺序不丢", () => {
  const text = projectDelivery([
    { kind: "paragraph", text: "前" },
    imageBlock,
    { kind: "quote", card: quote },
  ]).panelText;
  const content = composerContentFromMessage(text);
  assert.equal(content.text, "前");
  assert.equal(content.cards.length, 2);
  assert.deepEqual(
    content.cards.map((card) => [card.card.kind, card.anchor]),
    [
      ["image", 1],
      ["quote", 1],
    ],
  );
});

test("Skill：按 /name 首次出现还原位置，找不到即不伪造", () => {
  const content = composerContentFromMessage("用 /demo 看看这段\n再说", ["demo", "ghost"]);
  assert.deepEqual(content.skills, [{ name: "demo", from: 2 }]);
});

test("失败 / 被拒的显式 Skill 同样还原：按名字定位、保持后端给的顺序", () => {
  // 后端（`withdrawn_composer`）现在从 `lumir_skill_trace` 取全部显式选择——成功与被拒都在；
  // 前端按 `/name` 定位。两者都在正文里时各自成 ref，不因「没加载成功」而丢。
  const content = composerContentFromMessage("用 /demo 和 /ghost 看看", ["demo", "ghost"]);
  assert.deepEqual(content.skills, [
    { name: "demo", from: 2 },
    { name: "ghost", from: 10 },
  ]);
});

test("与当前输入合并：原文在前、当前在后（补换行），锚点与光标随原文长度平移", () => {
  const restored = composerContentFromMessage(
    projectDelivery([
      { kind: "paragraph", text: "原文" },
      { kind: "quote", card: quote },
    ]).panelText,
  );
  const merged = mergeWithdrawnComposerContent(restored, {
    text: "当前输入",
    caret: 2,
    cards: [{ card: imageBlock, anchor: 1 }],
    skills: [],
  } as never);
  assert.equal(merged.text, "原文\n当前输入");
  assert.equal(merged.caret, 2, "光标落原文末尾");
  assert.deepEqual(
    merged.cards.map((card) => [card.card.kind, card.anchor]),
    [
      ["quote", 2],
      ["image", 4],
    ],
  );
});

test("当前输入为空：原文原样回来（光标仍在末尾）", () => {
  const restored = composerContentFromMessage("原文");
  const merged = mergeWithdrawnComposerContent(restored, {
    text: "",
    caret: 0,
    cards: [],
    skills: [],
  });
  assert.equal(merged.text, "原文");
  assert.equal(merged.caret, 2);
});
