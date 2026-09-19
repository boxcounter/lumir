// src/preview/attachments.ts 的图片终态纯逻辑单测（M178）：终态可见判据、尺寸兜底取点、
// 三条图片态文案（deck D111–D113）与 widget 相等性。
//
// 不在这一层：真 <img> 的加载 / 解码 / 布局（需要 DOM 与渲染引擎）——那部分归
// tests/visual/scenes/markdown-combo.spec.ts、m182-image-first-open-width.spec.ts（宽度不变量）
// 与 scripts/acceptance 的 20-image-fallback / 23-image-first-open-width 场景
//（分工见 tests/unit/README.md 与 tests/unit/harness.ts 的边界说明）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ImageWidget,
  imageFallbackText,
  imageFallbackWidth,
  imageLoadingText,
  imageReadErrorText,
  imageVisible,
} from "../../src/preview/attachments.ts";

const deck = readFileSync(new URL("../../文案-Copy.md", import.meta.url), "utf8");

/** deck 表格行（`| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |`）；编号不按序排，按 id 找。 */
function deckRow(id: string): { zh: string; en: string } {
  const line = deck.split("\n").find((l) => l.startsWith(`| ${id} | `));
  assert.ok(line, `文案-Copy.md 里缺少 ${id}`);
  const cells = line.split("|").map((cell) => cell.trim());
  return { zh: cells[4], en: cells[5] };
}

test("终态可见判据：两个维度都必须非零", () => {
  assert.equal(imageVisible({ width: 300, height: 100 }), true);
  // 小到不足 1px 也算可见（判据是「有没有画出来」，不是审美阈值）
  assert.equal(imageVisible({ width: 0.5, height: 0.5 }), true);
  assert.equal(imageVisible({ width: 0, height: 100 }), false);
  assert.equal(imageVisible({ width: 300, height: 0 }), false);
  assert.equal(imageVisible({ width: 0, height: 0 }), false);
});

test("尺寸兜底取点：布局尺寸为零且自然尺寸非零时按自然宽度，其余返回 null", () => {
  // 中招形状（`width="100%"` + 仅 viewBox）的实测读数：布局盒 0×0、自然尺寸 300×100。
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 300, height: 100 }), 300);
  // 只有一维为零同样按自然宽度兜底
  assert.equal(imageFallbackWidth({ width: 0, height: 100 }, { width: 300, height: 100 }), 300);
  // 已经可见：不碰尺寸（正常图片零行为变化的前提）
  assert.equal(imageFallbackWidth({ width: 240, height: 80 }, { width: 240, height: 80 }), null);
  // 自然尺寸也为零（如 `width="0"` 的 svg）：兜底取不到宽度 → 走占位
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 0, height: 0 }), null);
  assert.equal(imageFallbackWidth({ width: 0, height: 0 }, { width: 0, height: 100 }), null);
});

test("三条图片态文案与 deck D111–D113 逐字一致（deck 是模板的唯一真源）", () => {
  const ref = "![Hooks Overview](images/hooks-overview.en.svg)";
  assert.equal(imageLoadingText(ref), deckRow("D111").zh.replace("{引用}", ref));
  assert.equal(imageReadErrorText(ref, "文件不存在"), deckRow("D112").zh.replace("{引用}", ref).replace("{原因}", "文件不存在"));
  assert.equal(imageFallbackText(ref), deckRow("D113").zh.replace("{引用}", ref));

  // 位串本身（英文字段同样在 deck 里，防只改一边）
  assert.equal(imageLoadingText(ref), `加载中… ${ref}`);
  assert.equal(imageReadErrorText(ref, "文件不存在"), `图片读取失败：${ref}（文件不存在）`);
  assert.equal(imageFallbackText(ref), `图片无法显示：${ref}`);

  // 退场串不得复活：`img` 的 error 不携带原因，把多类成因一律说成解码失败是错误归因（design §5.1）。
  for (const text of [imageFallbackText(ref), imageReadErrorText(ref, "文件不存在")]) {
    assert.ok(!text.includes("解码失败"), `文案里仍出现已退场的「解码失败」：${text}`);
  }
});

test("占位文案保留原始引用文本（alt 与路径都在其中）", () => {
  const ref = "![Hooks Overview](images/hooks-overview.en.svg)";
  for (const text of [imageLoadingText(ref), imageReadErrorText(ref, "原因"), imageFallbackText(ref)]) {
    assert.ok(text.includes(ref), `占位文本丢了原始引用：${text}`);
    assert.ok(text.includes("Hooks Overview"), `占位文本丢了 alt：${text}`);
    assert.ok(text.includes("images/hooks-overview.en.svg"), `占位文本丢了路径：${text}`);
  }
});

test("widget 相等性：同一目标的两条引用原文不同时不得互认", () => {
  const load = () => Promise.resolve("data:image/svg+xml;base64,");
  const standard = new ImageWidget("assets/a.svg", load, "![alt](assets/a.svg)");
  const wiki = new ImageWidget("assets/a.svg", load, "![[a.svg]]");
  assert.equal(standard.eq(new ImageWidget("assets/a.svg", load, "![alt](assets/a.svg)")), true);
  // alt / 加载文案 / 占位文案都取自 rawRef：互认会让第二条引用显示第一条的引用文本。
  assert.equal(standard.eq(wiki), false);
  assert.equal(wiki.eq(standard), false);
  assert.equal(standard.eq(new ImageWidget("assets/b.svg", load, "![alt](assets/a.svg)")), false);
});

test("widget 的引用文本与加载函数按构造入参原样持有", () => {
  const load = () => Promise.resolve("data:image/png;base64,");
  const widget = new ImageWidget("assets/a.png", load, "![alt](assets/a.png)");
  assert.equal(widget.key, "assets/a.png");
  assert.equal(widget.rawRef, "![alt](assets/a.png)");
  assert.equal(widget.load, load);
});
