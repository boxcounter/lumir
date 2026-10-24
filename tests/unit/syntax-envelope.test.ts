// src/preview/syntax-envelope.ts 的不变量单测（M687，change semantic-selection-markdown-oct23）：
// 「指针选区的语法包裹外扩」的判定本身——完整覆盖才扩、逐层迭代到不动点、幂等、方向保留、
// 多 range，以及封闭集合之外的构造一律不外扩。
//
// 这一层钉的是**判定**：节点范围与可见区间、覆盖条件、迭代终止。几何与事件时序（松开那一拍、
// 选中底色、Quote 钮浮现）需要真实布局 / 真机管道，归 chromium 场景 m687 与真机场景 233。
//
// 反向区分度（REVIEW.md「断言等价于子串」条）：每条「不外扩」的负向用例旁边都有一条同文档里
// 「完整覆盖就外扩」的正向对照；部分覆盖的用例与完整覆盖的用例共用同一份 fixture。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { completeTree } from "./syntax-tree.ts";
import {
  autolinkEnvelope,
  emphasisEnvelope,
  expandSelectionToSyntax,
  headingEnvelope,
  standardLinkEnvelope,
} from "../../src/preview/syntax-envelope.ts";
import { syntaxTree } from "@codemirror/language";

const MD: Extension[] = [markdown({ base: markdownLanguage, extensions: [GFM] })];

function stateOf(doc: string, ranges: Array<[number, number]>, extensions: Extension[] = []): EditorState {
  const selection =
    ranges.length === 1
      ? EditorSelection.single(ranges[0][0], ranges[0][1])
      : EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b)), 0);
  return completeTree(
    EditorState.create({ doc, selection, extensions: [...MD, ...extensions] }),
  );
}

/** 展开一个（正向）选区。 */
function expand(doc: string, from: number, to: number, extensions: Extension[] = []): EditorSelection {
  const state = stateOf(doc, [[from, to]], extensions);
  return expandSelectionToSyntax(state, state.selection);
}

const shape = (selection: EditorSelection): Array<[number, number, number, number]> =>
  selection.ranges.map((r) => [r.from, r.to, r.anchor, r.head]);

/** 首次出现处的 [from, to]。 */
const rangeOf = (doc: string, raw: string): [number, number] => {
  const from = doc.indexOf(raw);
  assert.ok(from >= 0, `fixture 里找不到 ${JSON.stringify(raw)}`);
  return [from, from + raw.length];
};

/** 节点在语法树里的首个同名节点（用于 envelope 单测的位置来源，不心算偏移）。 */
function nodeOf(state: EditorState, name: string) {
  const tree = syntaxTree(state);
  let hit: typeof tree.topNode | null = null;
  tree.iterate({
    enter(ref) {
      if (hit === null && ref.name === name) hit = ref.node;
    },
  });
  assert.ok(hit !== null, `语法树里没有 ${name} 节点`);
  return hit!;
}

// ---------------------------------------------------------------------------
// 标题：完整覆盖才扩，目标是节点范围（含 `#` 串与紧随空格），不含行首缩进
// ---------------------------------------------------------------------------

test("标题：拖选全部渲染文字 → 外扩到节点范围，方向保留", () => {
  const doc = "前言\n\n## 标题语义验收\n\n尾。\n";
  const [rawFrom, rawTo] = rangeOf(doc, "## 标题语义验收");
  const visibleFrom = rawFrom + 3;

  const forward = expand(doc, visibleFrom, rawTo);
  assert.deepEqual(shape(forward), [[rawFrom, rawTo, rawFrom, rawTo]]);

  // 反向选区：anchor 在右、head 在左；外扩后 anchor 仍在右、head 仍在左（不得整体翻转）。
  const backward = expand(doc, rawTo, visibleFrom);
  assert.deepEqual(shape(backward), [[rawFrom, rawTo, rawTo, rawFrom]]);
});

test("标题：带闭合 `#` 串、带缩进、1/6 级都取节点范围", () => {
  {
    const doc = "## Title ##\n";
    const [from, to] = rangeOf(doc, "## Title ##");
    assert.deepEqual(shape(expand(doc, from + 3, to - 3)), [[from, to, from, to]]);
  }
  {
    const doc = "  ### Indented\n";
    const [from, to] = rangeOf(doc, "### Indented");
    // 节点从 `#` 起（缩进不在节点内）：外扩后仍不含行首两个空格。
    assert.deepEqual(shape(expand(doc, from + 4, to)), [[from, to, from, to]]);
  }
  {
    const doc = "###### Six\n";
    const [from, to] = rangeOf(doc, "###### Six");
    assert.deepEqual(shape(expand(doc, from + 7, to)), [[from, to, from, to]]);
  }
});

test("标题：部分覆盖不外扩（少一个字符即保持原样），完整覆盖在同一 fixture 里必须外扩", () => {
  const doc = "## 标题语义验收\n";
  const [from, to] = rangeOf(doc, "## 标题语义验收");
  const partial = expand(doc, from + 3, to - 1);
  assert.deepEqual(shape(partial), [[from + 3, to - 1, from + 3, to - 1]]);
  // 对照：同一 fixture 的完整覆盖必须外扩，证明上面的「不变」不是函数恒空转。
  assert.deepEqual(shape(expand(doc, from + 3, to)), [[from, to, from, to]]);
});

test("标题：已含全部定界符时幂等（返回同一个选区对象）", () => {
  const doc = "## Title\n";
  const [from, to] = rangeOf(doc, "## Title");
  const state = stateOf(doc, [[from, to]]);
  assert.equal(expandSelectionToSyntax(state, state.selection), state.selection);
});

// ---------------------------------------------------------------------------
// 强调系：节点范围；嵌套由内向外到不动点
// ---------------------------------------------------------------------------

test("强调系：粗体 / 斜体 `*` 与 `_` / 删除线全部覆盖 → 外扩到两侧定界符", () => {
  const cases: Array<[string, string]> = [
    ["段落 **P粗** 结束\n", "**P粗**"],
    ["段落 *P斜* 结束\n", "*P斜*"],
    ["段落 _P下_ 结束\n", "_P下_"],
    ["段落 ~~P删~~ 结束\n", "~~P删~~"],
  ];
  for (const [doc, raw] of cases) {
    const [from, to] = rangeOf(doc, raw);
    const delims = raw.length - raw.replace(/^[*_~]+/, "").length;
    assert.deepEqual(
      shape(expand(doc, from + delims, to - delims)),
      [[from, to, from, to]],
      raw,
    );
  }
});

test("强调系：部分覆盖不外扩（同一 fixture 的完整覆盖外扩作对照）", () => {
  const doc = "段落 **P粗** 结束\n";
  const [from, to] = rangeOf(doc, "**P粗**");
  assert.deepEqual(shape(expand(doc, from + 2, to - 3)), [[from + 2, to - 3, from + 2, to - 3]]);
  assert.deepEqual(shape(expand(doc, from + 2, to - 2)), [[from, to, from, to]]);
});

test("嵌套：***x*** 由内向外迭代到最外层", () => {
  const doc = "***粗斜体***\n";
  const [from, to] = rangeOf(doc, "***粗斜体***");
  // 只选最内层的渲染文字（`*`/`**`/`**`/`*` 之外的部分）。
  assert.deepEqual(shape(expand(doc, from + 3, to - 3)), [[from, to, from, to]]);
});

test("深层嵌套（>8 层）：一次调用扩到最外层，且对结果再次调用幂等", () => {
  // 左右各 18 个 `*`：lezer 形成 10 层 StrongEmphasis（旧实现 8 轮上限时首调只得 [2,35)，
  // 要调两次才到 [0,37)——review r1 P2-1 的现场）。先在语法树上实测层数，避免 fixture 退化
  // 后这条回归变成空断言。
  const doc = "******************x******************\n";
  const state = stateOf(doc, [[18, 19]]);
  {
    let depth = 0;
    let max = 0;
    syntaxTree(state).iterate({
      enter(ref) {
        if (ref.name === "StrongEmphasis" || ref.name === "Emphasis") {
          depth += 1;
          max = Math.max(max, depth);
        }
      },
      leave(ref) {
        if (ref.name === "StrongEmphasis" || ref.name === "Emphasis") depth -= 1;
      },
    });
    assert.ok(max > 8, `fixture 应形成 >8 层嵌套，实际 ${max}`);
  }
  const rawTo = doc.indexOf("\n");
  const once = expandSelectionToSyntax(state, state.selection);
  assert.deepEqual(shape(once), [[0, rawTo, 0, rawTo]]);

  // 幂等：把一次调用的结果作为新状态的选区，再调一次必须原样返回（同一个对象）。
  const second = stateOf(doc, [[once.main.from, once.main.to]]);
  assert.equal(expandSelectionToSyntax(second, second.selection), second.selection);
});

test("嵌套：链接 label 内的粗体 → 先扩粗体、再扩整条链接", () => {
  const doc = "[**粗体**](u)\n";
  const [linkFrom, linkTo] = rangeOf(doc, "[**粗体**](u)");
  const [strongFrom, strongTo] = rangeOf(doc, "**粗体**");
  assert.deepEqual(shape(expand(doc, strongFrom + 2, strongTo - 2)), [[linkFrom, linkTo, linkFrom, linkTo]]);
});

// ---------------------------------------------------------------------------
// 链接：标准链接与角括号字面链接；blocked / 引用式 / 图片不外扩
// ---------------------------------------------------------------------------

test("标准链接：完整覆盖 label → 整条 [label](target)", () => {
  const doc = "见 [label](target) 完\n";
  const [from, to] = rangeOf(doc, "[label](target)");
  const label = rangeOf(doc, "label");
  assert.deepEqual(shape(expand(doc, label[0], label[1])), [[from, to, from, to]]);
});

test("角括号字面链接：完整覆盖 URL → 含两个尖括号", () => {
  const doc = "见 <https://example.com> 完\n";
  const [from, to] = rangeOf(doc, "<https://example.com>");
  const url = rangeOf(doc, "https://example.com");
  assert.deepEqual(shape(expand(doc, url[0], url[1])), [[from, to, from, to]]);
});

test("链接：只覆盖 label 的一部分不外扩；blocked / 引用式 / 图片一律不动", () => {
  {
    const doc = "[label](target)\n";
    const [labelFrom, labelTo] = rangeOf(doc, "label");
    assert.deepEqual(
      shape(expand(doc, labelFrom, labelTo - 1)),
      [[labelFrom, labelTo - 1, labelFrom, labelTo - 1]],
    );
  }
  for (const doc of ["[x](javascript:alert(1))\n", "[text][ref]\n", "![alt](pic.png)\n"]) {
    const raw = doc.slice(0, doc.indexOf("]"));
    const from = raw.startsWith("![") ? 3 : 1;
    const selection = expand(doc, from, raw.length);
    assert.deepEqual(shape(selection), [[from, raw.length, from, raw.length]], doc);
  }
});

// ---------------------------------------------------------------------------
// 封闭集合之外：行内代码 / 列表 / wikilink / 引用前缀
// ---------------------------------------------------------------------------

test("封闭集合之外：行内代码 / 列表项 / wikilink 的渲染文字不外扩", () => {
  const cases: Array<[string, string]> = [
    ["段落 `code` 结束\n", "code"],
    ["- 条目\n", "条目"],
    ["段落 [[note|显示名]] 结束\n", "显示名"],
  ];
  for (const [doc, visible] of cases) {
    const [from, to] = rangeOf(doc, visible);
    assert.deepEqual(shape(expand(doc, from, to)), [[from, to, from, to]], doc);
  }
});

test("引用块内的标题：外扩取标题节点，不把 `> ` 前缀吞进选区", () => {
  const doc = "> # 引用标题\n";
  const [headingFrom, headingTo] = rangeOf(doc, "# 引用标题");
  const visible = rangeOf(doc, "引用标题");
  assert.equal(doc.slice(doc.indexOf(">"), headingFrom), "> ");
  assert.deepEqual(
    shape(expand(doc, visible[0], visible[1])),
    [[headingFrom, headingTo, headingFrom, headingTo]],
  );
});

// ---------------------------------------------------------------------------
// 上下文矩阵：表格 cell / callout 行 / frontmatter 之后的标题 / 文档首末行
// ---------------------------------------------------------------------------

test("上下文：表格 cell 内的粗体正常外扩；callout 行内的粗体正常外扩", () => {
  {
    const doc = "| **P粗** | b |\n| --- | --- |\n| c | d |\n";
    const [from, to] = rangeOf(doc, "**P粗**");
    assert.deepEqual(shape(expand(doc, from + 2, to - 2)), [[from, to, from, to]]);
  }
  {
    const doc = "> [!note]\n> **粗**\n";
    const [from, to] = rangeOf(doc, "**粗**");
    assert.deepEqual(shape(expand(doc, from + 2, to - 2)), [[from, to, from, to]]);
  }
});

test("上下文：frontmatter 之后的第一个标题 / 文档首行的标题", () => {
  {
    const doc = "---\ntitle: x\n---\n\n## H\n";
    const [from, to] = rangeOf(doc, "## H");
    assert.deepEqual(shape(expand(doc, from + 3, to)), [[from, to, from, to]]);
  }
  {
    const doc = "## First\n\n尾\n";
    const [from, to] = rangeOf(doc, "## First");
    assert.deepEqual(shape(expand(doc, from + 3, to)), [[from, to, from, to]]);
  }
});

// ---------------------------------------------------------------------------
// 选区形态：空光标 / 多 range / 已覆盖相邻文本
// ---------------------------------------------------------------------------

test("空光标不外扩（非空选区才是本规则的输入域）", () => {
  const doc = "## Title\n";
  const [from] = rangeOf(doc, "## Title");
  const state = stateOf(doc, [[from + 3, from + 3]]);
  assert.equal(expandSelectionToSyntax(state, state.selection), state.selection);
});

test("多 range：逐 range 外扩且保持主 range 索引", () => {
  const doc = "## Title\n\n段落 **粗** 尾\n";
  const [hFrom, hTo] = rangeOf(doc, "## Title");
  const [bFrom, bTo] = rangeOf(doc, "**粗**");
  const state = stateOf(
    doc,
    [
      [hFrom + 3, hTo],
      [bFrom + 2, bTo - 2],
    ],
    [EditorState.allowMultipleSelections.of(true)],
  );
  const out = expandSelectionToSyntax(state, state.selection);
  assert.deepEqual(shape(out), [
    [hFrom, hTo, hFrom, hTo],
    [bFrom, bTo, bFrom, bTo],
  ]);
});

test("选区覆盖到相邻行：构造被完整包含时不再扩（幂等），只向左补定界符时扩到节点", () => {
  const doc = "## Title\n\n下一行\n";
  const [from, to] = rangeOf(doc, "## Title");
  // 覆盖整行（含换行）与下一行：节点已被完整包含。
  const contained = expand(doc, from, doc.length);
  assert.deepEqual(shape(contained), [[from, doc.length, from, doc.length]]);
  // 从标题文字第一个字拖到下一行末：右边已超出节点、左边缺 `## ` → 只补左侧。
  assert.deepEqual(shape(expand(doc, from + 3, doc.length)), [[from, doc.length, from, doc.length]]);
});

// ---------------------------------------------------------------------------
// 单一出处：envelope 的节点范围 / 可见区间 / 隐藏 span 与装饰层逐值同源
// ---------------------------------------------------------------------------

test("envelope：标题 / 强调 / 链接 / 角括号链接的节点、可见区间与隐藏 span", () => {
  {
    const doc = "## Title ##\n";
    const state = stateOf(doc, [[0, 0]]);
    const env = headingEnvelope(nodeOf(state, "ATXHeading2"), state.doc)!;
    assert.deepEqual(
      { from: env.from, to: env.to, visibleFrom: env.visibleFrom, visibleTo: env.visibleTo, hidden: env.hidden },
      { from: 0, to: 11, visibleFrom: 3, visibleTo: 8, hidden: [{ from: 0, to: 3 }, { from: 8, to: 11 }] },
    );
  }
  {
    const doc = "**粗**\n";
    const state = stateOf(doc, [[0, 0]]);
    const env = emphasisEnvelope(nodeOf(state, "StrongEmphasis"))!;
    assert.deepEqual(
      { from: env.from, to: env.to, visibleFrom: env.visibleFrom, visibleTo: env.visibleTo, hidden: env.hidden },
      { from: 0, to: 5, visibleFrom: 2, visibleTo: 3, hidden: [{ from: 0, to: 2 }, { from: 3, to: 5 }] },
    );
  }
  {
    const doc = "[label](target)\n";
    const state = stateOf(doc, [[0, 0]]);
    const env = standardLinkEnvelope(nodeOf(state, "Link"), state.doc)!;
    assert.deepEqual(
      { from: env.from, to: env.to, visibleFrom: env.visibleFrom, visibleTo: env.visibleTo, hidden: env.hidden },
      { from: 0, to: 15, visibleFrom: 1, visibleTo: 6, hidden: [{ from: 0, to: 1 }, { from: 6, to: 15 }] },
    );
  }
  {
    const doc = "<https://example.com>\n";
    const state = stateOf(doc, [[0, 0]]);
    const env = autolinkEnvelope(nodeOf(state, "Autolink"), state.doc)!;
    assert.deepEqual(
      { from: env.from, to: env.to, visibleFrom: env.visibleFrom, visibleTo: env.visibleTo, hidden: env.hidden },
      { from: 0, to: 21, visibleFrom: 1, visibleTo: 20, hidden: [{ from: 0, to: 1 }, { from: 20, to: 21 }] },
    );
  }
});
