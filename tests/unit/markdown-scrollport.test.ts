import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { horizontalScrollDelta, MARKDOWN_NOWRAP_SCROLLPORT_CLASS } from "../../src/markdown-scrollport.ts";

const viewport = { left: 100, right: 500 };
const MUTATION = process.env.LUMIR_SCROLLPORT_UNIT_MUTATION;

function delta(...args: Parameters<typeof horizontalScrollDelta>): number {
  if (MUTATION === "side-forward") return args[0].left - (args[1].left + (args[3] ?? 0));
  if (MUTATION === "side-reverse") return args[0].right - (args[1].right - (args[3] ?? 0));
  const value = horizontalScrollDelta(...args);
  return MUTATION === "nearest" || MUTATION === "strategy" || MUTATION === "property" ? value + 1 : value;
}

test("nearest：已在窗口内不动，左右越界只补最小距离", () => {
  assert.equal(delta({ left: 120, right: 480 }, viewport, "nearest"), 0);
  assert.equal(delta({ left: 60, right: 120 }, viewport, "nearest"), -40);
  assert.equal(delta({ left: 480, right: 540 }, viewport, "nearest"), 40);
});

test("start/end/center 使用目标 caret 而不是自然行宽", () => {
  const rect = { left: 600, right: 620 };
  assert.equal(delta(rect, viewport, "start"), 500);
  assert.equal(delta(rect, viewport, "end"), 120);
  assert.equal(delta(rect, viewport, "center"), 310);
});

test("宽矩形左越界 + 正向 head：按 CM 二次修正优先保右端", () => {
  assert.equal(delta({ left: -200, right: 200 }, { left: 0, right: 100 }, "nearest", 0, 1), 100);
  assert.equal(delta({ left: -200, right: 200 }, { left: 0, right: 100 }, "nearest", 0, -1), -200);
});

test("宽矩形右越界 + 反向 head：按 CM 二次修正优先保左端", () => {
  assert.equal(delta({ left: -50, right: 150 }, { left: 0, right: 100 }, "nearest", 0, -1), -50);
  assert.equal(delta({ left: -50, right: 150 }, { left: 0, right: 100 }, "nearest", 0, 1), 50);
});

test("属性：短 caret 盒经揭示后落在任意窗口内", () => {
  for (const left of [-1000, -20, 0, 99, 100, 300, 499, 800, 4000]) {
    for (const [viewportLeft, viewportRight] of [[0, 1], [100, 500], [-300, 200]]) {
      const rect = { left, right: left + 1 };
      const offset = delta(rect, { left: viewportLeft, right: viewportRight }, "nearest");
      assert.ok(rect.left - offset >= viewportLeft && rect.right - offset <= viewportRight, JSON.stringify({ rect, viewportLeft, viewportRight, offset }));
    }
  }
});

test("主题选择器与装配 class 逐字同源", () => {
  const source = readFileSync(new URL("../../src/preview/theme.ts", import.meta.url), "utf8");
  const expected = MUTATION === "theme" ? `${MARKDOWN_NOWRAP_SCROLLPORT_CLASS}-wrong` : MARKDOWN_NOWRAP_SCROLLPORT_CLASS;
  assert.ok(source.includes(`".cm-content.${expected}"`));
});
