// src/preview/endMarker.ts 的纯逻辑单测（change document-end-marker）：
// 出现判据的真值表与 deck D114 的文案一致性。
//
// 不在这一层：标记的 DOM 组装与几何（需要 DOM 与布局引擎）——那部分归
// tests/visual/scenes/end-marker.spec.ts（判据两态、临界带、滚动高度恒定、形态与配色、
// 非文档性）与 scripts/acceptance/scenarios/27-document-end-marker.md（真机）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { END_MARKER_TEXT, endMarkerVisible } from "../../src/preview/endMarker.ts";

const deck = readFileSync(new URL("../../文案-Copy.md", import.meta.url), "utf8");

/** deck 表格行（`| 编号 | 位置 | 角色 | 中文 | English | 设计意图 |`）；编号不按序排，按 id 找。 */
function deckRow(id: string): { zh: string; en: string } {
  const line = deck.split("\n").find((l) => l.startsWith(`| ${id} | `));
  assert.ok(line, `文案-Copy.md 里缺少 ${id}`);
  const cells = line.split("|").map((cell) => cell.trim());
  return { zh: cells[4], en: cells[5] };
}

test("出现判据：内容高度严格超过可用视口高度才显示", () => {
  assert.equal(endMarkerVisible(900, 800), true);
  assert.equal(endMarkerVisible(801, 800), true);
  // 恰好一屏：整篇都在视野内，没有可滚动的余量，标记该省则省（`>` 而不是 `>=`）
  assert.equal(endMarkerVisible(800, 800), false);
  assert.equal(endMarkerVisible(799, 800), false);
  // 空文档 / 只有 frontmatter 的文档：内容高度远小于视口
  assert.equal(endMarkerVisible(88, 800), false);
  assert.equal(endMarkerVisible(0, 800), false);
});

test("可用视口高度为零时一律不显示（未布局 / 被覆盖层盖住时量到的关系不成立）", () => {
  assert.equal(endMarkerVisible(0, 0), false);
  assert.equal(endMarkerVisible(1200, 0), false);
  // 负值同样按不显示处理（判据不因异常读数翻成显示）
  assert.equal(endMarkerVisible(1200, -1), false);
});

test("标记的文案与 deck D114 逐字一致（deck 是可见文案的唯一真源）", () => {
  assert.equal(END_MARKER_TEXT, deckRow("D114").zh);
  assert.equal(deckRow("D114").en, "That's all");
});
