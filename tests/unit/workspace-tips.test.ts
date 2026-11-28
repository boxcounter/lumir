// 空工作区 tips 的机械对账（Alex 2026-11-28 重设计合同）：
// 1) 只保留四个不同的 Lumir 卖点，顺序固定，不堆功能目录；
// 2) 只有 Outline / Harness 两条产品特有命令从默认键位表派生字位；
// 3) 通用启动 / 查找 / 设置 / vault 快捷键与“查看全部”脚注不得回流；
// 4) 所有可见文案都能在文案表找到，运行时不另藏第二份文案真源。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COPY } from "../../src/copy-data.ts";
import { KEY_BINDINGS } from "../../src/keys.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(path.join(root, "src/workspace-tips.ts"), "utf8");

test("空工作区只保留 Outline / Quote / Wikilink / Harness 四条，顺序与身份唯一", () => {
  const features = [...source.matchAll(/^    id: "(outline|quote|wikilink|harness)",$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(features, ["outline", "quote", "wikilink", "harness"]);
  assert.equal(new Set(features).size, 4);
});

test("只有产品特有命令显示键位，且字形全部从默认表派生", () => {
  const commands = [...source.matchAll(/command: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(commands, ["toc.toggle", "harness.toggle"]);
  for (const command of commands) {
    assert.ok(KEY_BINDINGS.some((binding) => binding.command === command));
  }
  assert.equal(source.includes("⌘"), false, "tips 源码不得硬编码键位字形");
  assert.match(source, /glyphOfToken\(binding\.key\)/);
});

test("通用快捷键与右键新建不拿来回填条目", () => {
  for (const forbidden of [
    "app.quick-open",
    "app.search-open",
    "app.settings-open",
    "vault.switcher",
    "D1036",
    "D1037",
    "D1039",
    "D1041",
    "D1044",
    "D1047",
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} 不应出现在共享 tips`);
  }
});

test("四条标题 / 描述 / 手势与区域名都有文案表来源", () => {
  const keys = [...source.matchAll(/"(D\d+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, `tips 文案键数量异常：${keys.length}`);
  for (const key of keys) assert.ok(key in COPY, `${key} 不在文案表里`);
  assert.equal(COPY.D1034.zh, "添加 vault");
  assert.equal(COPY.D1034.en, "Add vault");
});
