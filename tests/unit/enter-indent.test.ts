// `Enter` 自动缩进的判定单测（M272，change enter-auto-indent）：跑的是 `src/editor.ts` 里
// 那个**键位命令体本体**（`src/enter-indent.ts` 的 `enterWithAutoIndent`），不是复刻一份判定
// ——装配与单测同源。它之所以单独成模块，就是因为 `src/editor.ts` 在 Node 的类型剥离口径下
// 不可 import（模块图里有 TypeScript 参数属性），见该文件头。
//
// 为什么能在本层测：命令体只读 `state` 与 `view.dispatch`，`insertNewline*` 这两个 CM 命令
// 要的也就这两样（design §4 的探针同手法）。真 `EditorState` + 真 parser（md 用 lezer
// markdown，code 用 legacy-modes 的 StreamLanguage，与生产同一份注册表）。
// **本层测不到**的一半是键位链路本身（`Prec.highest` 的优先级、上游 `markdownKeymap` 让位、
// `Shift-Enter` 不命中）——那些归 chromium 场景 `m264-enter-auto-indent.spec.ts` 与真机场景 59。
//
// 口径来源：change 的 design §4 实测表（逐行原样搬进断言），以及派生的三条：
// 1. 有缩进规则的语言 ⇒ 语法缩进（`getIndentation`）；
// 2. 无规则的语言 / md 围栏 / md 缩进代码块 ⇒ 沿用当前行行首空白（`insertNewlineAndIndent`
//    在 `getIndentation` 返回 null 时的回落，本 change 不自己写这条）；
// 3. md 列表 / 引用 ⇒ 委派上游、续写标记（本 change MUST NOT 改变）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { DEFAULT_AUTO_INDENT, enterWithAutoIndent } from "../../src/enter-indent.ts";
import type { EditorMode } from "../../src/bindings/EditorMode.ts";

const MD: Extension[] = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/**
 * 真 `EditorState` + 真 parser，光标落在文档末尾（= 触发那一行的行尾）。
 *
 * 返回值的 `doc` 是命令跑完之后的全文；`handled` 是命令的返回值（false = 没接管）。
 * 假 view 只带 `state` 与 `dispatch`——`insertNewlineAndIndent` /
 * `insertNewlineContinueMarkup` 只读这两样（design §4 探针同一形态）。
 */
function pressEnter(
  doc: string,
  mode: EditorMode,
  autoIndent: boolean,
  extensions: readonly Extension[],
  readOnly = false,
): { handled: boolean; doc: string } {
  const state = EditorState.create({
    doc,
    extensions: [
      ...extensions,
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ],
    selection: EditorSelection.cursor(doc.length),
  });
  let next = state;
  const view = {
    state,
    dispatch: (tr: { state: EditorState }) => {
      next = tr.state;
    },
  } as unknown as EditorView;
  const handled = enterWithAutoIndent(view, mode, autoIndent);
  return { handled, doc: next.doc.toString() };
}

/** 生产注册表里 code 模式用的那一层（StreamLanguage），逐语言取与 `src/preview/code.ts` 同源。 */
async function stream(name: string, key: string): Promise<Extension[]> {
  const mod = (await import(`@codemirror/legacy-modes/mode/${name}`)) as Record<string, unknown>;
  return [StreamLanguage.define(mod[key] as never)];
}

// ---------------------------------------------------------------------------
// 1. code 模式 · 有缩进规则的语言：语法缩进（design §4 的前六行）
// ---------------------------------------------------------------------------

test("code 模式：有缩进规则的语言给语法缩进（新行两个空格）", async () => {
  const cases: Array<[label: string, extensions: Extension[], doc: string]> = [
    ["javascript", await stream("javascript", "javascript"), "const alpha = () => {"],
    ["json", await stream("javascript", "json"), "{"],
    ["python", await stream("python", "python"), "def f():"],
    ["rust", await stream("rust", "rust"), "if (x) {"],
    ["go", await stream("go", "go"), "if (x) {"],
    ["c", await stream("clike", "c"), "if (x) {"],
  ];
  for (const [label, extensions, doc] of cases) {
    const result = pressEnter(doc, "code", true, extensions);
    assert.equal(result.handled, true, `${label}：应接管`);
    assert.equal(result.doc, `${doc}\n  `, `${label}：新行应有两个空格的语法缩进`);
  }
});

test("code 模式：`auto_indent = false` 不接管、文档逐字节不变（回到本 change 之前的行为）", async () => {
  const extensions = await stream("javascript", "javascript");
  const result = pressEnter("const alpha = () => {", "code", false, extensions);
  assert.equal(result.handled, false, "返回 false = 不消费，按键落回浏览器默认");
  assert.equal(result.doc, "const alpha = () => {", "命令本身 MUST NOT 改文档");
});

test("只读会话：即使 auto_indent 为真也不产生文档变更", async () => {
  const extensions = await stream("javascript", "javascript");
  const result = pressEnter("const alpha = () => {", "code", true, extensions, true);
  assert.equal(result.handled, false, "insertNewlineAndIndent 在 readOnly 下返回 false");
  assert.equal(result.doc, "const alpha = () => {");
});

// ---------------------------------------------------------------------------
// 2. code 模式 · 无缩进规则的语言：沿用当前行行首空白
// ---------------------------------------------------------------------------

test("code 模式：无缩进规则的语言沿用当前行行首空白（不是行首、也不多一层）", async () => {
  const cases: Array<[label: string, extensions: Extension[], doc: string, expected: string]> = [
    ["toml 行首无空白", await stream("toml", "toml"), "[a]", "[a]\n"],
    ["toml 行首两个空格", await stream("toml", "toml"), "  [a]", "  [a]\n  "],
    ["shell", await stream("shell", "shell"), "echo 1", "echo 1\n"],
    ["未收录扩展（纯文本）", [], "    foo", "    foo\n    "],
  ];
  for (const [label, extensions, doc, expected] of cases) {
    const result = pressEnter(doc, "code", true, extensions);
    assert.equal(result.handled, true, `${label}：应接管`);
    assert.equal(result.doc, expected, label);
  }
});

// ---------------------------------------------------------------------------
// 3. md 模式：围栏 / 缩进代码块沿用当前行，段落平换行
// ---------------------------------------------------------------------------

test("md 围栏代码块内：沿用块内该行的缩进，且不把 `- x` 续写成列表项", () => {
  const fenced = "```js\n  beta();";
  const result = pressEnter(fenced, "md", true, MD);
  assert.equal(result.handled, true);
  assert.equal(result.doc, "```js\n  beta();\n  ", "围栏内沿用当前行缩进");

  // 围栏内的 `- x` 是代码文本：委派给上游时它返回 false（`getContext` 遇 `FencedCode`
  // 返回空），自动缩进也不产生 `- `。反例断言必须写清「不是 `- x\n- `」。
  const dash = "```\n- x";
  const continued = pressEnter(dash, "md", true, MD);
  assert.equal(continued.doc, "```\n- x\n", "围栏内的 `- x` MUST NOT 被续写成列表");
});

test("md 缩进代码块（4 空格）内：沿用当前行缩进", () => {
  const result = pressEnter("    foo", "md", true, MD);
  assert.equal(result.doc, "    foo\n    ");
});

test("md 正文段落：平换行（行首无空白时与变更前一致）", () => {
  const result = pressEnter("hello", "md", true, MD);
  assert.equal(result.handled, true);
  assert.equal(result.doc, "hello\n", "MUST NOT 凭空加缩进");
});

// ---------------------------------------------------------------------------
// 4. md 列表 / 引用：委派上游，续写标记（本 change MUST NOT 改变）
// ---------------------------------------------------------------------------

test("md 列表 / 引用：委派上游续写同级标记并保持层级", () => {
  const cases: Array<[label: string, doc: string, expected: string]> = [
    ["无序", "- alpha", "- alpha\n- "],
    ["嵌套", "- alpha\n  - bravo", "- alpha\n  - bravo\n  - "],
    ["有序", "1. uno\n2. dos", "1. uno\n2. dos\n3. "],
    ["引用", "> quoted", "> quoted\n> "],
  ];
  for (const [label, doc, expected] of cases) {
    const result = pressEnter(doc, "md", true, MD);
    assert.equal(result.handled, true, `${label}：上游应接管`);
    assert.equal(result.doc, expected, `${label}：与本次变更之前逐字节一致`);
  }
});

test("md 列表里 `auto_indent = false`：续行照旧（M399 起由本键位代跑同一上游命令）", () => {
  // D5a 的显式不对称：本键只关本 change 新增的两处，MUST NOT 关掉列表续行。M399 之前本层
  // 返回 false、由 markdownKeymap（Prec.high）代跑默认配置的同一上游命令；M399 为让「空项
  // 退出」的裁决行为不随缩进开关分叉，把 md 委派提到开关检查之前——因此本层现在直接接管
  //（handled=true），用户可见行为与之前逐字节一致（除空项退出的裁决差异外）。
  const result = pressEnter("- alpha", "md", false, MD);
  assert.equal(result.handled, true, "md 列表续行不随 auto_indent 关闭");
  assert.equal(result.doc, "- alpha\n- ", "续写同级标记");
});

// ---------------------------------------------------------------------------
// 4.5 M399：空列表项上的 Enter（Alex 裁决的主流模式）与行首 Enter 的命令层钉固
// ---------------------------------------------------------------------------

/** `pressEnter` 的定光标变体：`pos` 显式给光标位（行首 / 行中场景的命令层判定用）。 */
function pressEnterAt(
  doc: string,
  pos: number,
  mode: EditorMode,
  autoIndent: boolean,
  extensions: readonly Extension[],
): { handled: boolean; doc: string; cursor: number } {
  const state = EditorState.create({ doc, extensions, selection: EditorSelection.cursor(pos) });
  let next = state;
  const view = {
    state,
    dispatch: (tr: { state: EditorState }) => {
      next = tr.state;
    },
  } as unknown as EditorView;
  const handled = enterWithAutoIndent(view, mode, autoIndent);
  return { handled, doc: next.doc.toString(), cursor: next.selection.main.head };
}

test("空列表项上 Enter：去掉列表符号、该行保留为普通空行、光标在行首、不新增行（M399 裁决）", () => {
  // 不变量：任意「marker + 纯空白」的列表项行、光标在 marker 之后，Enter 后该行恒变为空行、
  // 光标恒在该行行首、文档行数恒不变（MUST NOT 新增行）。嵌套项按主流模式凸一级
  // （仍是列表项、留待下一次 Enter 退出），不在本条不变量内，单独钉。
  const cases: Array<[label: string, doc: string, pos: number, expected: string, cursor: number]> = [
    ["单 item 无序", "- ", 2, "", 0],
    ["两 item 的空第二项（上游默认会把列表变松、保留 marker——裁决禁止）", "- a\n- ", 6, "- a\n", 4],
    ["三 item 的空第三项", "- a\n- b\n- ", 10, "- a\n- b\n", 8],
    ["单 item 有序", "1. ", 3, "", 0],
    ["两 item 有序的空第二项", "1. a\n2. ", 8, "1. a\n", 5],
    ["空 item 后面还有内容（行保留、列表断成两段是 markdown 语义的自然结果）", "- a\n- \n- b", 6, "- a\n\n- b", 4],
  ];
  for (const [label, doc, pos, expected, cursor] of cases) {
    const result = pressEnterAt(doc, pos, "md", true, MD);
    assert.equal(result.handled, true, `${label}：应接管`);
    assert.equal(result.doc, expected, `${label}：文档应为去标记后的形态`);
    assert.equal(result.cursor, cursor, `${label}：光标应在该行行首`);
  }
});

test("嵌套空列表项上 Enter：凸一级（Obsidian 式逐层退出），仍是有 marker 的列表项", () => {
  const result = pressEnterAt("- a\n  - ", 8, "md", true, MD);
  assert.equal(result.handled, true);
  assert.equal(result.doc, "- a\n- ");
  assert.equal(result.cursor, 6);
});

test("行首 Enter 的命令层钉固（M399 问题 1）：换行确实发生、新空行插在光标行之前", () => {
  // 问题 1 的根因在渲染层（新空行被 0 高隐藏），命令层本就正确——这里钉住防止将来误改。
  const para = pressEnterAt("hello world", 0, "md", true, MD);
  assert.equal(para.handled, true);
  assert.equal(para.doc, "\nhello world", "行首 Enter 应在该行之前插入空行");
  assert.equal(para.cursor, 1, "光标随内容下移（停在新空行之后的内容行行首）");
  const list = pressEnterAt("- abc", 0, "md", true, MD);
  assert.equal(list.doc, "\n- abc");
  assert.equal(list.cursor, 1);
});

// ---------------------------------------------------------------------------
// 5. 出厂默认与配置面的对接
// ---------------------------------------------------------------------------

test("出厂默认：TS 侧常量与 Rust `EditorConfig::default()` 同值（true）", () => {
  // Rust 侧那条由 cargo test `missing_auto_indent_takes_factory_true` 钉住（键缺席 ⇒ true，
  // 且不跟随折行键）；这里钉住 TS 侧的兜底值，两边各一份（REVIEW.md 第 8 条：同语义两处
  // 真源必须都受断言约束）。改默认值必须同时改两处，任一侧红了就是漏改。
  assert.equal(DEFAULT_AUTO_INDENT, true);
});

test("配置三态在编辑器侧的投影：缺省/true 生效、false 回退", async () => {
  const extensions = await stream("javascript", "javascript");
  // 「键缺席」在 Rust 侧解析成 true，装配层把它原样传下来 ⇒ 这里等价于传 true。
  assert.equal(pressEnter("if (x) {", "code", DEFAULT_AUTO_INDENT, extensions).doc, "if (x) {\n  ");
  assert.equal(pressEnter("if (x) {", "code", true, extensions).doc, "if (x) {\n  ");
  const off = pressEnter("if (x) {", "code", false, extensions);
  assert.equal(off.handled, false);
  assert.equal(off.doc, "if (x) {");
});
