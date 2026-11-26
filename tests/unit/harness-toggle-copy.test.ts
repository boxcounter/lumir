// Harness toggle 的悬停提示 / 可访问名文案（change improve-file-open-harness-affordance-nov26，
// 合同 3）：同一枚 toggle 的三处可读身份（钮 title / 钮 aria-label / 面板容器 aria-label）共用
// D327；键盘速查里的同一条命令标签（D648）与命令来由（D345）也 MUST 用 Harness 措辞。
//
// 为什么钉在单测层：`copy.test.ts` 只判 deck ↔ 表**有没有漂移**，两处一起改成旧措辞它照样绿；
// 本条判的是**取值本身**（逐字）与「旧措辞不再出现」，是文案合同唯一的机器判据。视觉场景
// （m303 / m756 一族）判上屏，二者互补。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COPY } from "../../src/copy-data.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DECK = readFileSync(path.join(root, "文案-Copy.md"), "utf8");

/** deck 行按 `|` 切格：`| key | 位置 | 作者 | zh | en | 意图 |`（与 copy.test.ts 同口径）。 */
function deckRow(key: string): { zh: string; en: string } {
  const line = DECK.split("\n").find((row) => row.startsWith(`| ${key} |`));
  assert.ok(line !== undefined, `文案-Copy.md 里缺少 ${key}`);
  const cells = line.split("|");
  assert.equal(cells.length, 8, `${key} 的 deck 行列数不是 6：${line}`);
  return { zh: cells[4].trim(), en: cells[5].trim() };
}

const OLD = /Chat pane|Chat panel/i;
const OLD_ZH = /对话面板/;

test("D327 两档逐字：en「Harness pane」/ zh「Harness 面板」", () => {
  assert.equal(COPY.D327.en, "Harness pane");
  assert.equal(COPY.D327.zh, "Harness 面板");
  assert.doesNotMatch(COPY.D327.en, OLD, "D327 en 不得残留 Chat pane / Chat panel");
  assert.doesNotMatch(COPY.D327.zh, OLD_ZH, "D327 zh 不得残留「对话面板」");
});

test("D327 的 deck 行与表逐字一致（真源不漂移）", () => {
  assert.deepEqual(deckRow("D327"), { zh: COPY.D327.zh, en: COPY.D327.en });
});

test("同一命令的速查标签与来由同用 Harness 措辞（D648 / D345）", () => {
  assert.equal(COPY.D648.zh, "打开或收起 Harness 面板");
  assert.equal(COPY.D648.en, "Toggle the Harness pane");
  assert.doesNotMatch(COPY.D648.zh, OLD_ZH);
  assert.doesNotMatch(COPY.D648.en, OLD);
  assert.deepEqual(deckRow("D648"), { zh: COPY.D648.zh, en: COPY.D648.en });

  // D345 是 ⌘⇧A 的来由文本（键位面板逐条显示）：首句不得再叫「harness chat pane」。
  assert.match(COPY.D345.en, /^Open \/ collapse the Harness pane/);
  assert.doesNotMatch(COPY.D345.en, OLD);
  assert.deepEqual(deckRow("D345"), { zh: COPY.D345.zh, en: COPY.D345.en });
});
