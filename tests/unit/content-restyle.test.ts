// M218 内容渲染修复的纯逻辑单测：列表复合编号 / callout 13 类双段标签映射 /
// doc-title & doc-meta 的格式化（判据 = M216 gap 表 §2.2/§2.3 与定稿原型出处）。
//
// 为什么这一层只测纯函数：列表扫描与装饰装配要 DOM（harness.ts 的口径），但编号公式、
// 类型映射与 meta 格式化是判据里有逐字出处的部分——公式写错（如深层编号拼成 `1..1`）
// 在像素层之前就该红。

import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { bulletGlyph, orderedItemLabel } from "../../src/preview/lists.ts";
import { detectCallout } from "../../src/preview/callout.ts";
import { docDirFromPath, docTitleFromPath, formatDocDate } from "../../src/preview/doc-meta.ts";

// ---------------------------------------------------------------------------
// 列表标记体系（C3；定稿 direction-c/index.html:249-277）
// ---------------------------------------------------------------------------

test("ol 复合编号：L1 带尾点、L2/L3 拼接不带尾点", () => {
  assert.equal(orderedItemLabel(null, 1), "1.");
  assert.equal(orderedItemLabel(null, 12), "12.");
  assert.equal(orderedItemLabel("1.", 1), "1.1");
  assert.equal(orderedItemLabel("5.", 2), "5.2");
  // L3 的父编号是 L2 形态（无尾点）——拼错成 `1..1` 的那条路就是这条
  assert.equal(orderedItemLabel("1.5", 1), "1.5.1");
  assert.equal(orderedItemLabel("1.5.1", 2), "1.5.1.2");
});

test("ul glyph：L1 en dash、L2 及更深 ◦", () => {
  assert.equal(bulletGlyph(1), "–");
  assert.equal(bulletGlyph(2), "◦");
  assert.equal(bulletGlyph(3), "◦");
});

// ---------------------------------------------------------------------------
// callout 双段标签（C7；13 类映射逐类对照定稿 index.html:927-943）
// ---------------------------------------------------------------------------

/** 解析 `> [!type]` 首行并过 detectCallout；类型表只接受首行标记，单行即可。 */
function calloutOf(source: string) {
  const tree = markdownLanguage.parser.parse(source);
  const node = tree.topNode.firstChild;
  assert.ok(node && node.name === "Blockquote", `fixture 应解析为 Blockquote：${source}`);
  return detectCallout(Text.of(source.split("\n")), node);
}

test("13 类中文标签逐类对照定稿（含别名同归）", () => {
  // [type, 中文标签, 英文类型名, 族]——中文列逐字取自原型 index.html:927-943
  const cases: Array<[string, string, string, string]> = [
    ["note", "笔记", "note", "info"],
    ["abstract", "摘要", "abstract", "info"],
    ["info", "信息", "info", "info"],
    ["todo", "待办", "todo", "info"],
    ["tip", "提示", "tip", "ok"],
    ["success", "成功", "success", "ok"],
    ["question", "疑问", "question", "pending"],
    ["warning", "警告", "warning", "pending"],
    ["failure", "失败", "failure", "danger"],
    ["danger", "危险", "danger", "danger"],
    ["bug", "缺陷", "bug", "danger"],
    ["example", "示例", "example", "neutral"],
    ["quote", "引用", "quote", "neutral"],
  ];
  for (const [type, zh, en, family] of cases) {
    const info = calloutOf(`> [!${type}]`);
    assert.ok(info, `[!${type}] 应识别为 callout`);
    assert.equal(info.zhLabel, zh, `[!${type}] 的中文标签`);
    assert.equal(info.enLabel, en, `[!${type}] 的英文类型名`);
    assert.equal(info.family, family, `[!${type}] 的族`);
    assert.equal(info.known, true);
  }
  // 别名归到同一规范类型（中英文双段都按规范名出，不按别名原文）
  const alias = calloutOf("> [!summary]");
  assert.ok(alias);
  assert.deepEqual([alias.zhLabel, alias.enLabel, alias.canonical], ["摘要", "abstract", "abstract"]);
});

test("未知类型降级：只出前段、内容是原文类型名", () => {
  const info = calloutOf("> [!milestone]");
  assert.ok(info);
  assert.equal(info.known, false);
  assert.equal(info.family, "neutral");
  assert.equal(info.zhLabel, "milestone");
  assert.equal(info.enLabel, null);
});

// ---------------------------------------------------------------------------
// doc-title / doc-meta 格式化（A1；定稿 index.html:238-239 + 831-832/876-877 实例）
// ---------------------------------------------------------------------------

test("doc-title：basename 去扩展名", () => {
  assert.equal(docTitleFromPath("3_Resources/2026 R&D Strategy.md"), "2026 R&D Strategy");
  assert.equal(docTitleFromPath("dimension-design.md"), "dimension-design");
  assert.equal(docTitleFromPath("a/b/note"), "note");
});

test("doc-meta 路径段：父目录「 / 」分隔，根目录为空", () => {
  assert.equal(docDirFromPath("Work-Tracking-Method/decisions/dimension-design.md"), "Work-Tracking-Method / decisions");
  assert.equal(docDirFromPath("3_Resources/x.md"), "3_Resources");
  assert.equal(docDirFromPath("x.md"), "");
});

test("doc-meta 日期：同年 `M月D日`、跨年带年", () => {
  const now = new Date(2026, 8, 25); // 2026-09-25（本地时区，与格式化同一基准）
  assert.equal(formatDocDate(new Date(2026, 8, 22).getTime(), now), "9月22日");
  assert.equal(formatDocDate(new Date(2026, 6, 1).getTime(), now), "7月1日");
  assert.equal(formatDocDate(new Date(2025, 6, 1).getTime(), now), "2025年7月1日");
});
