// 首启 tips 的机械对账（change add-first-run-onboarding-nov25）：
// 1) key 行只引用 KEY_BINDINGS 里真实存在的 command（默认键位改了 tips 跟着表走）；
// 2) 不出现硬编码的键位字形（`⌘P` 一类），键位一律由 glyphOfToken 派生；
// 3) 所有可见标签 / 手势 / 脚注 / 区域读屏名都能在文案表里找到。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COPY } from "../../src/copy-data.ts";
import { KEY_BINDINGS } from "../../src/keys.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(path.join(root, "src/first-run-tips.ts"), "utf8");

test("tips 的 key 行只引用默认表里的 command", () => {
  const commands = [...source.matchAll(/command: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(commands.length, 6, "首启 tips 应有 6 条键位行");
  for (const command of commands) {
    assert.ok(
      KEY_BINDINGS.some((binding) => binding.command === command),
      `${command} 不在 KEY_BINDINGS 里——tips 会渲染成空 keycap`,
    );
  }
});

test("tips 不硬编码键位字形（键位一律由 glyphOfToken 派生）", () => {
  assert.equal(source.includes("⌘"), false, "tips 源码不得出现 ⌘ 字面量");
  assert.match(source, /glyphOfToken\(binding\.key\)/);
});

test("tips 的可见标签 / 手势 / 脚注 / 读屏名都在文案表里", () => {
  const keys = [...source.matchAll(/(?:label|token): "(D\d+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 11, `tips 文案键数量异常：${keys.length}`);
  for (const key of keys) {
    assert.ok(key in COPY, `${key} 不在文案表里`);
  }
  // 首启按钮与非首启启动态按钮是两个不同键（首启用「添加 vault」，恢复模式仍 D6）。
  assert.equal(COPY.D1029.zh, "添加 vault");
  assert.equal(COPY.D1029.en, "Add vault");
});
