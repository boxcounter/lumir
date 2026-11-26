import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  acceptTargetForPath,
  buildLinkSuggestions,
  findLinkSuggestTrigger,
} from "../../src/link-suggest.ts";

function stateAt(doc: string, head = doc.length, options: { anchor?: number; readOnly?: boolean } = {}): EditorState {
  const extensions: Extension[] = [markdown({ base: markdownLanguage, extensions: [GFM] })];
  if (options.readOnly) extensions.push(EditorState.readOnly.of(true));
  return EditorState.create({
    doc,
    selection: { anchor: options.anchor ?? head, head },
    extensions,
  });
}

function pathsOf(paths: readonly string[], query = ""): string[] {
  return buildLinkSuggestions(paths, query).map((item) => item.path);
}

test("触发：只认普通行内 [[，查询直接来自正文", () => {
  const trigger = findLinkSuggestTrigger(stateAt("before [[Café"), { focused: true });
  assert.deepEqual(trigger, { openerFrom: 7, queryFrom: 9, head: 13, query: "Café" });
  assert.equal(findLinkSuggestTrigger(stateAt("before [[x]]"), { focused: false }), null);
  assert.equal(findLinkSuggestTrigger(stateAt("before [[x]]"), { focused: true, composing: true }), null);
});

test("触发负例：embed、保留字符、完整链接内部、非空选区与只读", () => {
  const cases: Array<[string, number, { anchor?: number; readOnly?: boolean }?]> = [
    ["![[alp", 5],
    ["[[a|b", 5],
    ["[[a#b", 5],
    ["[[a[b", 5],
    ["[[a]b", 5],
    ["[[a\nb", 4],
    ["x [[note]] y", 8],
    ["[[alp", 5, { anchor: 2 }],
    ["[[alp", 5, { readOnly: true }],
  ];
  for (const [doc, head, options] of cases) {
    assert.equal(findLinkSuggestTrigger(stateAt(doc, head, options), { focused: true }), null, doc);
  }
});

test("触发负例：frontmatter、行内代码、围栏与缩进代码", () => {
  const docs = [
    "---\ntitle: [[alp\n---\nbody",
    "`[[alp`",
    "``[[alp``",
    "```md\n[[alp\n```",
    "~~~\n[[alp\n~~~",
    "    [[alp",
  ];
  for (const doc of docs) {
    const head = doc.indexOf("alp") + 3;
    assert.equal(findLinkSuggestTrigger(stateAt(doc, head), { focused: true }), null, doc);
  }
});

test("触发负例：标准 Link / Image 与未闭合 label / alt，Enter 不得有候选可接受", () => {
  const docs = [
    "[see [[alp](https://example.invalid)",
    "![alt [[alp](image.png)",
    "[see [[alp](https://example.invalid) tail",
    "![alt [[alp](image.png) tail",
    "[see [[alp]",
    "![alt [[alp]",
  ];
  for (const doc of docs) {
    const head = doc.indexOf("alp") + 3;
    const state = stateAt(doc, head);
    assert.equal(findLinkSuggestTrigger(state, { focused: true }), null, doc);
  }
});

test("来源：只收大小写不敏感 .md，排除 .markdown、其他文件与不可表示路径", () => {
  const paths = [
    "notes/readme.markdown",
    "notes/readme.md",
    "notes/upper.MD",
    "notes/image.png",
    "bad|pipe.md",
    "bad#hash.md",
    "bad[bracket.md",
    "bad]bracket.md",
    "bad\nline.md",
    " leading.md",
    "trailing.md ",
    "./dot.md",
    "../up.md",
    "a//empty.md",
    ".md",
  ];
  assert.deepEqual(pathsOf(paths), ["notes/readme.md", "notes/upper.MD", ".md"]);
});

test("完整路径去重是精确大小写语义，大小写敏感卷上的两项都保留", () => {
  const paths = ["a/note.md", "a/note.md", "a/note.MD", "a/Note.md"];
  assert.deepEqual(pathsOf(paths), ["a/note.md", "a/note.MD", "a/Note.md"]);
  assert.equal(acceptTargetForPath(paths, "a/note.md"), "a/note.md");
  assert.equal(acceptTargetForPath(paths, "a/note.MD"), "a/note.MD");
});

test("稳定分层：精确 stem、折叠 stem、前缀、完整路径子串；层内保序且不打分", () => {
  const paths = [
    "z/alpha-suffix.md",
    "z/Alpha.md",
    "z/alpha.md",
    "z/other-alpha.md",
    "z/alphabet.md",
    "z/ALPHA.md",
    "z/none.md",
  ];
  assert.deepEqual(pathsOf(paths, "alpha"), [
    "z/alpha.md",
    "z/Alpha.md",
    "z/ALPHA.md",
    "z/alpha-suffix.md",
    "z/alphabet.md",
    "z/other-alpha.md",
  ]);
});

test("空查询不额外分层，全部命中保序；结果最多 100 条", () => {
  const paths = ["z/z.md", "a/a.md", "m/m.md"];
  assert.deepEqual(pathsOf(paths), paths);
  const many = Array.from({ length: 130 }, (_, index) => `n/${String(index).padStart(3, "0")}.md`);
  assert.equal(buildLinkSuggestions(many, "").length, 100);
  assert.deepEqual(pathsOf(many).slice(0, 3), ["n/000.md", "n/001.md", "n/002.md"]);
  assert.deepEqual(pathsOf(paths, "missing"), []);
});

test("Unicode 查询与插入目标逐字保留，包括组合字符、CJK、西里尔与 emoji ZWJ", () => {
  const paths = ["Café.md", "Cafe\u0301.md", "笔记/中文.md", "путь/заметка.MD", "family/👩‍👩‍👧‍👦.md"];
  for (const path of paths) {
    assert.equal(acceptTargetForPath(paths, path), path);
    assert.ok(pathsOf(paths, path.slice(0, path.lastIndexOf("/") + 1 || undefined)).includes(path));
  }
  assert.deepEqual(pathsOf(paths, "中文"), ["笔记/中文.md"]);
  assert.deepEqual(pathsOf(paths, "👩‍👩‍👧‍👦"), ["family/👩‍👩‍👧‍👦.md"]);
});

test("foo.md.md 不去扩展名、不重定向；重复扩展名矩阵分别精确接受", () => {
  for (const paths of [
    ["foo.md", "foo.md.md"],
    ["dir/foo.md", "dir/foo.md.md"],
    ["foo.md", "dir/foo.md.md"],
  ]) {
    for (const path of paths) {
      if (!path.includes("/") && paths.some((other) => other !== path && other.split("/").pop() === path)) continue;
      assert.equal(acceptTargetForPath(paths, path), path);
    }
    assert.notEqual(acceptTargetForPath(paths, "foo.md.md"), "foo.md");
  }
});

test("根文件只有完整文件名精确同名才拒绝，folded 变体不过度拒绝", () => {
  assert.equal(acceptTargetForPath(["foo.md", "dir/foo.md"], "foo.md"), null);
  assert.equal(acceptTargetForPath(["foo.md", "dir/foo.md"], "dir/foo.md"), "dir/foo.md");
  assert.equal(acceptTargetForPath(["note.md", "dir/note.MD"], "note.md"), "note.md");
  assert.equal(acceptTargetForPath(["a/Note.md", "b/note.md"], "a/Note.md"), "a/Note.md");
  assert.equal(acceptTargetForPath(["a/Note.md", "b/note.md"], "b/note.md"), "b/note.md");
});

test("过滤索引保留精确重复与不可表示同名路径的接受证书边界", () => {
  assert.deepEqual(buildLinkSuggestions(["foo.md", "foo.md"], "foo.md"), [{ path: "foo.md", target: "foo.md" }]);
  assert.deepEqual(buildLinkSuggestions(["foo.md", "dir//foo.md"], "foo.md"), [{ path: "foo.md", target: null }]);
});

test("接受前重读索引：路径消失、扩展名全集变化或根文件变歧义都使证书失效", () => {
  const initial = ["note.md", "dir/other.md"];
  assert.equal(acceptTargetForPath(initial, "note.md"), "note.md");
  assert.equal(acceptTargetForPath(["dir/other.md"], "note.md"), null);
  assert.equal(acceptTargetForPath(["note.markdown", "dir/other.md"], "note.md"), null);
  assert.equal(acceptTargetForPath(["note.md", "dir/note.md"], "note.md"), null);
});

test("已有候选时语法树暂不可用仍重算 query，且不绕过关闭条件", () => {
  const prefix = "ordinary text\n".repeat(10_000);
  const previous = stateAt(`${prefix}[[s`);
  assert.equal(findLinkSuggestTrigger(previous, { focused: true, allowUnavailableSyntax: true })?.query, "s");
  const opened = previous.update({
    changes: { from: previous.doc.length, insert: "i" },
    selection: { anchor: previous.doc.length + 1 },
  }).state;
  const head = opened.selection.main.head;
  assert.equal(syntaxTreeAvailable(opened, head), false);
  assert.equal(findLinkSuggestTrigger(opened, { focused: true }), null);
  assert.deepEqual(findLinkSuggestTrigger(opened, { focused: true, allowUnavailableSyntax: true }), {
    openerFrom: prefix.length,
    queryFrom: prefix.length + 2,
    head,
    query: "si",
  });

  ensureSyntaxTree(opened, opened.doc.length, 1000);
  assert.equal(syntaxTreeAvailable(opened, head), true);
  assert.equal(findLinkSuggestTrigger(opened, { focused: true })?.query, "si");

  for (const suffix of ["[", "![[si", "[[s|i"]) {
    const closed = stateAt(`${prefix}${suffix}`);
    assert.equal(syntaxTreeAvailable(closed, closed.selection.main.head), false, suffix);
    assert.equal(findLinkSuggestTrigger(closed, { focused: true, allowUnavailableSyntax: true }), null, suffix);
  }
});

test("大库与 1MB 文档：当前行触发和万文件过滤的同步预算保持在 16ms 内", () => {
  const files = Array.from({ length: 10_000 }, (_, index) => `dir-${index % 40}/note-${index}.md`);
  const started = performance.now();
  const suggestions = buildLinkSuggestions(files, "note-9999");
  const filterMs = performance.now() - started;
  assert.deepEqual(suggestions.map((item) => item.path), ["dir-39/note-9999.md"]);
  assert.ok(filterMs < 16, `万文件过滤 ${filterMs.toFixed(2)}ms 超过预算`);

  const prefix = "ordinary text\n".repeat(76_000);
  const doc = `${prefix}[[note`;
  const state = stateAt(doc);
  ensureSyntaxTree(state, doc.length, 1000);
  const triggerStarted = performance.now();
  const trigger = findLinkSuggestTrigger(state, { focused: true });
  const triggerMs = performance.now() - triggerStarted;
  assert.equal(trigger?.query, "note");
  assert.ok(triggerMs < 16, `1MB 文档当前行触发 ${triggerMs.toFixed(2)}ms 超过预算`);
});
