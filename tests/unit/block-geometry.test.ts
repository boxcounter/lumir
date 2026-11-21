import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { lineShapes, type LineShape } from "../../src/preview/block-geometry.ts";
import { markerTextAt } from "../../src/preview/lists.ts";

const parser = (markdownLanguage.parser as MarkdownParser).configure(GFM);

function shapes(doc: string, fm: { from: number; to: number } | null = null): Map<number, LineShape> {
  const text = Text.of(doc.split("\n"));
  return lineShapes(text, parser.parse(doc), 0, text.length, fm);
}

function shapeAt(doc: string, lineNumber: number): LineShape {
  const text = Text.of(doc.split("\n"));
  const line = text.line(lineNumber);
  const shape = shapes(doc).get(line.from);
  assert.ok(shape, `${JSON.stringify(doc)} 第 ${lineNumber} 行必须有几何形状`);
  return shape;
}

function assertUneditedLinesEqual(before: string, after: string, editedLine: number): void {
  const a = shapes(before);
  const b = shapes(after);
  const beforeText = Text.of(before.split("\n"));
  const afterText = Text.of(after.split("\n"));
  assert.equal(beforeText.lines, afterText.lines);
  for (let n = 1; n <= beforeText.lines; n++) {
    if (n === editedLine) continue;
    assert.deepEqual(
      b.get(afterText.line(n).from),
      a.get(beforeText.line(n).from),
      `第 ${n} 行未编辑，几何不得随 ${JSON.stringify(before)} → ${JSON.stringify(after)} 翻转`,
    );
  }
}

const PREFIX_FAMILIES = [
  ["-", "- ", "- 哈"],
  ["+", "+ ", "+ 哈"],
  ["*", "* ", "* 哈"],
] as const;

test("边界单调性：bullet 每个前缀都同步保留前一行 8px，文档首尾与空行对照同判", () => {
  for (const prefixes of PREFIX_FAMILIES) {
    for (const prefix of prefixes) {
      for (const doc of [`alpha\n${prefix}`, `首段\n中间\n${prefix}`, `${prefix}\n尾段`]) {
        const previous = doc.startsWith(prefix) ? null : shapeAt(doc, doc.split("\n").length - 1);
        if (previous) assert.equal(previous.bottom, 8, `${JSON.stringify(doc)}：marker 前缀必须构成块边界`);
        assert.equal(shapeAt(doc, doc.startsWith(prefix) ? 1 : doc.split("\n").length).top, 2);
      }
      const control = `alpha\n\n${prefix}`;
      assert.equal(shapeAt(control, 1).bottom, 8);
      assert.deepEqual(shapeAt(control, 2), { kind: "blank", top: 0, bottom: 0 });
    }
  }
});

test("无中段翻转与首帧即终帧：bullet / 有序序列只改当前编辑行", () => {
  for (const prefixes of [...PREFIX_FAMILIES, ["1.", "1. ", "1. 哈"] as const]) {
    for (let i = 1; i < prefixes.length; i++) {
      assertUneditedLinesEqual(`alpha\n${prefixes[i - 1]}`, `alpha\n${prefixes[i]}`, 2);
      assert.deepEqual(shapeAt(`alpha\n${prefixes[i - 1]}`, 2), shapeAt(`alpha\n${prefixes[i]}`, 2));
    }
  }
  assert.equal(shapeAt("alpha\n1", 1).bottom, 0, "普通数字尚未成为块");
  assert.equal(shapeAt("alpha\n1.", 1).bottom, 8, "尾点是唯一允许的块成立拍");
  for (const prefix of ["-", "--", "---"]) {
    assert.equal(shapeAt(`alpha\n${prefix}`, 1).bottom, 8, "setext 下划线前缀必须保留前段边界");
  }
  assert.equal(shapeAt("alpha\n---x", 1).bottom, 0, "---x 回到普通文本是已登记边界");
});

test("取值表：标题阶梯、首内容块、列表、空行、引用、代码、表格与 HR 逐项不变", () => {
  const tops = [24, 20, 16, 14, 12, 10];
  const bottoms = [9, 6, 5, 5, 4, 4];
  for (let level = 1; level <= 6; level++) {
    const doc = `alpha\n\n${"#".repeat(level)} title`;
    assert.deepEqual(shapeAt(doc, 3), { kind: "heading", top: tops[level - 1], bottom: bottoms[level - 1], headingLevel: level });
    assert.equal(shapeAt(`${"#".repeat(level)} title`, 1).top, 0, "首个内容块标题上距为 0");
  }
  assert.deepEqual(shapeAt("- item", 1), { kind: "list-item", top: 2, bottom: 0 });
  assert.deepEqual(shapeAt("> quote", 1), { kind: "quote", top: 0, bottom: 0 });
  assert.deepEqual(shapeAt("alpha\n\n---", 3), { kind: "hr", top: 0, bottom: 0 });
  for (const doc of ["```js\n- code\n```", "| a |\n| --- |\n| - b |"]) {
    for (let n = 1; n <= doc.split("\n").length; n++) {
      const shape = shapeAt(doc, n);
      assert.equal(shape.top, 0, `${JSON.stringify(doc)} 第 ${n} 行 top`);
      assert.equal(shape.bottom, 0, `${JSON.stringify(doc)} 第 ${n} 行 bottom`);
    }
  }
});

test("text 的 8px 只在 EOF / 空行 / 结构边界；嵌套段落与引用不新增下距", () => {
  assert.equal(shapeAt("alpha", 1).bottom, 8);
  assert.equal(shapeAt("alpha\n\nbeta", 1).bottom, 8);
  assert.equal(shapeAt("alpha\nbeta", 1).bottom, 0);
  assert.equal(shapeAt("alpha\n## next", 1).bottom, 8);
  assert.equal(shapeAt("alpha\n> quote", 1).bottom, 8);
  assert.equal(shapeAt("alpha\n```\nx\n```", 1).bottom, 8);
  assert.equal(shapeAt("- alpha\n  continued", 2).bottom, 0, "列表项内段落保持无下距");
  assert.equal(shapeAt("> alpha\n> continued", 2).bottom, 0, "引用内段落保持无下距");
});

test("形态包含：markerTextAt 的普通上下文命中 MUST 同属几何 marker 形态", () => {
  for (const marker of ["-", "+", "*", "1.", "2)", "- [ ]"]) {
    for (const suffix of [" ", " content"]) {
      const doc = `${marker}${suffix}`;
      const text = Text.of([doc]);
      assert.ok(markerTextAt(doc, 0), `${JSON.stringify(doc)} 应被 markerTextAt 命中`);
      assert.equal(shapes(doc).get(0)?.kind, "list-item");
    }
  }
  for (const doc of ["-x", "+x", "1", "===x"]) {
    assert.equal(shapeAt(doc, 1).kind, "text", `${JSON.stringify(doc)} 不应误判成列表`);
  }
});

test("frontmatter 不参与行装饰；首个内容块扫描跳过 frontmatter 与其后空行", () => {
  const doc = "---\ntitle: synthetic\n---\n\n## heading";
  const fm = { from: 0, to: doc.indexOf("\n\n") };
  const result = shapes(doc, fm);
  assert.equal(result.size, 2, "frontmatter 三行不参与，空行与标题参与");
  assert.equal(shapeAt(doc, 2).kind, "text", "不带 fm 的对照仍读源码文本");
  const text = Text.of(doc.split("\n"));
  assert.deepEqual(result.get(text.line(5).from), { kind: "heading", top: 0, bottom: 6, headingLevel: 2 });
});
