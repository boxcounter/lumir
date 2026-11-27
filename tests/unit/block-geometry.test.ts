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

/** 普通正文行与空行的终态：纵向 padding 恒 0（与邻行 / EOF / 结构边界无关）。 */
const LOCAL_TEXT: LineShape = { kind: "text", top: 0, bottom: 0 };

function totalPadding(map: Map<number, LineShape>): number {
  let total = 0;
  for (const shape of map.values()) total += shape.top + shape.bottom;
  return total;
}

const PREFIX_FAMILIES = [
  ["-", "- ", "- 哈"],
  ["+", "+ ", "+ 哈"],
  ["*", "* ", "* 哈"],
] as const;

test("边界单调性：bullet 每个前缀都同步保留 marker 行 2px，正文行纵向 padding 恒 0", () => {
  for (const prefixes of PREFIX_FAMILIES) {
    for (const prefix of prefixes) {
      for (const doc of [`alpha\n${prefix}`, `首段\n中间\n${prefix}`, `${prefix}\n尾段`]) {
        const previous = doc.startsWith(prefix) ? null : shapeAt(doc, doc.split("\n").length - 1);
        if (previous) assert.deepEqual(previous, LOCAL_TEXT, `${JSON.stringify(doc)}：marker 前缀不得改动前一正文行几何`);
        assert.equal(shapeAt(doc, doc.startsWith(prefix) ? 1 : doc.split("\n").length).top, 2);
      }
      const control = `alpha\n\n${prefix}`;
      assert.deepEqual(shapeAt(control, 1), LOCAL_TEXT);
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
  assert.equal(shapeAt("alpha\n1", 1).bottom, 0, "普通数字前缀不得改动前一正文行");
  assert.equal(shapeAt("alpha\n1.", 1).bottom, 0, "尾点前缀同样不得改动前一正文行（旧模型在这里给 8px）");
  for (const prefix of ["-", "--", "---"]) {
    assert.equal(shapeAt(`alpha\n${prefix}`, 1).bottom, 0, "setext 下划线前缀不得改动前一正文行");
  }
  assert.equal(shapeAt("alpha\n---x", 1).bottom, 0, "---x 回到普通文本同样不改动前一行");
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

test("普通行局部性：顶层正文与空行的纵向 padding 恒 0，不读邻行 / EOF / 结构边界", () => {
  const docs = [
    "alpha",
    "alpha\nbeta",
    "alpha\n\nbeta",
    "alpha\n\n",
    "\n\n",
    "alpha\n1.",
    "## next\nalpha",
    "alpha\n## next",
    "alpha\n> quote",
    "alpha\n```\nx\n```",
    "alpha\n- item",
    "alpha\n---",
    "- alpha\n  continued",
    "> alpha\n> continued",
  ];
  for (const doc of docs) {
    const lines = doc.split("\n");
    for (let n = 1; n <= lines.length; n++) {
      const shape = shapeAt(doc, n);
      if (shape.kind === "text") assert.deepEqual(shape, LOCAL_TEXT, `${JSON.stringify(doc)} 第 ${n} 行（普通正文）`);
      if (shape.kind === "blank") assert.deepEqual(shape, { kind: "blank", top: 0, bottom: 0 }, `${JSON.stringify(doc)} 第 ${n} 行（空行）`);
    }
  }
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

test("数千行连续正文只取首个可见行：视口求值不扫描后续全文", () => {
  const doc = Array.from({ length: 6000 }, (_, index) => `line ${index}`).join("\n");
  const text = Text.of(doc.split("\n"));
  const first = text.line(1);
  const result = lineShapes(text, parser.parse(doc), first.from, first.to, null);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get(first.from), LOCAL_TEXT);
});

// ---------------------------------------------------------------------------
// 非语义迁移稳定（终态合同：空行↔有字、正文编辑不改任何行的纵向 padding）
// ---------------------------------------------------------------------------

test("非语义迁移稳定：空行↔有字不改变任何行的纵向 padding（文档末行 / 中间 / 连续空行）", () => {
  const migrations: ReadonlyArray<readonly [string, string, string]> = [
    ["a\n", "a\nx", "文档末尾空行输入首字（单换行）"],
    ["a\n\n", "a\n\nx", "文档末行空行输入首字（双换行）"],
    ["a\n\nb\nc", "a\nx\nb\nc", "中间单个空行变正文"],
    ["p\n\n\n\nq", "p\n\nx\n\nq", "连续空行中的一行变正文"],
    ["\n", "x\n", "全空文档的第一行落字"],
    ["a\n\nb\n", "a\n\nb\nx", "段落后的末空行为文档唯一空行"],
  ];
  for (const [before, after, label] of migrations) {
    const a = shapes(before);
    const b = shapes(after);
    const at = Text.of(before.split("\n"));
    const bt = Text.of(after.split("\n"));
    assert.equal(at.lines, bt.lines, `${label}：行数不得变化`);
    for (let n = 1; n <= at.lines; n++) {
      const beforeShape = a.get(at.line(n).from)!;
      const afterShape = b.get(bt.line(n).from)!;
      assert.equal(afterShape.top, beforeShape.top, `${label}：第 ${n} 行 top 不得变化`);
      assert.equal(afterShape.bottom, beforeShape.bottom, `${label}：第 ${n} 行 bottom 不得变化`);
    }
    assert.equal(totalPadding(b), totalPadding(a), `${label}：全篇纵向 padding 总和不得变化`);
  }
});

test("57 行同族：中段单个空行变正文时全篇行几何逐项锁定", () => {
  const lines: string[] = Array.from({ length: 57 }, (_, index) => (index === 0 ? "p" : index === 56 ? "q" : ""));
  const before = lines.join("\n");
  lines[28] = "x";
  const after = lines.join("\n");
  const a = shapes(before);
  const b = shapes(after);
  const at = Text.of(before.split("\n"));
  const bt = Text.of(after.split("\n"));
  assert.equal(at.lines, 57);
  assert.equal(bt.lines, 57);
  for (let n = 1; n <= 57; n++) {
    const beforeShape = a.get(at.line(n).from)!;
    const afterShape = b.get(bt.line(n).from)!;
    assert.equal(afterShape.top, beforeShape.top, `第 ${n} 行 top 不得随第 29 行空行落字而翻转`);
    assert.equal(afterShape.bottom, beforeShape.bottom, `第 ${n} 行 bottom 不得随第 29 行空行落字而翻转`);
    if (n !== 29) assert.equal(afterShape.kind, beforeShape.kind, `第 ${n} 行未被编辑，类别不得变化`);
  }
  assert.equal(totalPadding(a), 0, "终态下 57 行全篇没有块下距");
  assert.equal(totalPadding(b), 0);
  assert.deepEqual(a.get(at.line(29).from), { kind: "blank", top: 0, bottom: 0 });
  assert.deepEqual(b.get(bt.line(29).from), { kind: "text", top: 0, bottom: 0 }, "第 29 行真的落字了（区分度）");
});

// ---------------------------------------------------------------------------
// 语义 reflow 有界（块类型成立 / 消失时，块外行几何不变）
// ---------------------------------------------------------------------------

test("语义 reflow 有界：heading↔text 只改标题行自身，块外行几何不变", () => {
  const heading = "正文行\n## 标题\n尾行";
  const text = "正文行\n标题\n尾行";
  assert.deepEqual(shapeAt(heading, 1), LOCAL_TEXT, "正文行不受下一行类别影响");
  assert.deepEqual(shapeAt(text, 1), LOCAL_TEXT);
  assert.deepEqual(shapeAt(heading, 2), { kind: "heading", top: 20, bottom: 6, headingLevel: 2 });
  assert.deepEqual(shapeAt(text, 2), LOCAL_TEXT);
  assert.deepEqual(shapeAt(heading, 3), shapeAt(text, 3), "标题块之后的正文行几何不变（只整体位移）");
  assert.deepEqual(shapeAt(heading, 3), LOCAL_TEXT);

  const list = "正文行\n- 列表项\n尾行";
  assert.deepEqual(shapeAt(list, 1), LOCAL_TEXT, "正文行不受下一行列表影响");
  assert.deepEqual(shapeAt(list, 2), { kind: "list-item", top: 2, bottom: 0 });
});

test("语义 reflow 有界：标题台阶变化只改变标题行自身的上下距", () => {
  const h2 = "前文\n\n## 标题\n后文";
  const h4 = "前文\n\n#### 标题\n后文";
  assert.deepEqual(shapeAt(h2, 1), shapeAt(h4, 1), "块外前行几何不得随标题级别变化");
  assert.deepEqual(shapeAt(h2, 4), shapeAt(h4, 4), "块外后行几何不得随标题级别变化（只整体位移）");
  assert.notDeepEqual(shapeAt(h2, 3), shapeAt(h4, 3), "标题自身的台阶必须真的变化（区分度）");
});

test("Enter 拆分 / Backspace 合并：高度差只是自然行数变化，普通行不带额外 padding", () => {
  const merged = "正文第一行";
  const split = "正文\n第一行";
  assert.deepEqual(shapeAt(merged, 1), LOCAL_TEXT);
  assert.deepEqual(shapeAt(split, 1), LOCAL_TEXT);
  assert.deepEqual(shapeAt(split, 2), LOCAL_TEXT);
  assert.equal(totalPadding(shapes(split)), totalPadding(shapes(merged)), "拆分不引入段距");

  const mergedHeading = "## 标题";
  const splitHeading = "## 标\n题";
  assert.deepEqual(shapeAt(splitHeading, 1), shapeAt(mergedHeading, 1), "拆分标题时标题行自身几何不变");
  assert.deepEqual(shapeAt(splitHeading, 2), LOCAL_TEXT, "拆出的正文行不带纵向 padding");
});

// ---------------------------------------------------------------------------
// 选区 / IME / 视口不是几何输入
// ---------------------------------------------------------------------------

test("选区 / IME / 视口不是几何输入：同一文档重复求值与视口片段求值逐项一致", () => {
  const doc = Array.from({ length: 57 }, (_, index) => `line ${index + 1}`).join("\n");
  const text = Text.of(doc.split("\n"));
  const tree = parser.parse(doc);
  const full = lineShapes(text, tree, 0, text.length, null);
  assert.deepEqual(lineShapes(text, tree, 0, text.length, null), full, "纯函数无隐藏状态：两次求值必须逐项相等");
  const ranges = [
    [text.line(1).from, text.line(1).to],
    [text.line(28).from, text.line(30).to],
    [text.line(57).from, text.line(57).to],
  ] as const;
  for (const [from, to] of ranges) {
    const slice = lineShapes(text, tree, from, to, null);
    assert.ok(slice.size > 0, "片段求值必须真的覆盖到行");
    for (const [pos, shape] of slice) {
      assert.deepEqual(shape, full.get(pos), `片段 [${from},${to}] 与全量求值对同一行必须给出同一 shape`);
    }
  }
  assert.ok(full.size === 57, "全量求值覆盖全部行");
});
