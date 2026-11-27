// src/preview/endMarker.ts 的纯逻辑单测（change document-end-marker；change
// show-document-end-marker-all-docs-nov27 起判据扩大到所有已完成布局的 md 文档）：
// 出现判据的真值表与 deck D114 的文案一致性。
//
// 不在这一层：标记的 DOM 组装与几何（需要 DOM 与布局引擎）——那部分归
// tests/visual/scenes/end-marker.spec.ts（短文 / 长文两态、视口为 0、滚动高度恒定、形态与配色、
// 非文档性、M238 位置不变量、M251 模式切换矩阵）与 scripts/acceptance/scenarios/27-document-end-marker.md（真机）。

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

test("出现判据：只要已完成布局（可用视口高度 > 0）就显示，与内容高度无关", () => {
  // 判据不再接收内容高度——short / long / 空文档同一个问题，答案只由布局是否完成决定
  assert.equal(endMarkerVisible(733), true);
  assert.equal(endMarkerVisible(1), true);
  assert.equal(endMarkerVisible(4000), true);
});

test("可用视口高度为零时一律不显示（未布局 / 被完全遮挡）", () => {
  assert.equal(endMarkerVisible(0), false);
  // 负值同样按不显示处理（判据不因异常读数翻成显示）
  assert.equal(endMarkerVisible(-1), false);
});

test("标记的文案与 deck D114 逐字一致（deck 是可见文案的唯一真源）", () => {
  assert.equal(END_MARKER_TEXT, deckRow("D114").zh);
  // 中英两列同形是**有意的**（M238 起英文串；M251 起「END」）：原中文串「到底了」换成英文后，
  // 标记不再分语言——deck 两列都写这一串，而不是给中文列留一个无人消费的旧值
  //（REVIEW.md 「声明了却没有消费者」条：声明必须有人消费）。
  assert.equal(deckRow("D114").en, END_MARKER_TEXT);
});
