// 粘贴 URL 自动取标题的前端纯判据（change add-url-paste-title-nov21）。
//
// 被测面是 `src/paste-url.ts`：单个 http(s) URL 的识别、标题 → 纯文本 Markdown 标签的
// 转义、待返回区间的映射、以及「什么时候允许改写」。真正的 paste 事件 / 异步事务归
// `tests/visual/scenes/url-paste-title.spec.ts` 与真机验收场景；本层不碰 DOM。

import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import {
  MAX_URL_TITLE_LENGTH,
  addPendingUrlTitle,
  clearPendingUrlTitleEffects,
  markdownLinkFor,
  markdownLinkLabel,
  newPendingUrlTitle,
  pastedHttpUrl,
  pendingUrlTitleField,
  pendingUrlTitles,
  removePendingUrlTitle,
  urlTitleReplacement,
} from "../../src/paste-url.ts";
import { classifyLinkTarget, standardLinkParts } from "../../src/preview/links.ts";
import { completeTree } from "./syntax-tree.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

/** 生成的 `[title](url)` 必须仍是一条标准外链，标签渲染文本逐字等于标题。 */
function parsedLink(source: string) {
  const state = completeTree(EditorState.create({ doc: source, extensions: MD }));
  type ParsedLink = NonNullable<ReturnType<typeof standardLinkParts>>;
  let link: ParsedLink | null = null;
  let labelSource = "";
  const kinds = new Set<string>();
  syntaxTree(state).iterate({
    enter(ref) {
      if (link === null && ref.name === "Link") {
        link = standardLinkParts(ref.node, state.doc);
        if (link !== null) labelSource = state.doc.sliceString(link.labelFrom, link.labelTo);
      }
      if (link !== null && ref.from >= link.labelFrom && ref.to <= link.labelTo) kinds.add(ref.name);
    },
  });
  const resolved = link as ParsedLink | null;
  assert.ok(resolved, "生成的文本必须解析出一条标准链接");
  // CommonMark 的反斜杠转义集（与 links.ts 的 PUNCT_ESCAPE 同源）：解码后即渲染文本。
  const labelText = labelSource.replace(/\\([!-/:-@[-`{-~])/g, "$1");
  return { link: resolved, labelSource, labelText, kinds };
}

test("单个 http(s) URL：整段就是 URL 才接管", () => {
  assert.equal(pastedHttpUrl("https://example.invalid/a?b=1#c"), "https://example.invalid/a?b=1#c");
  assert.equal(pastedHttpUrl("http://example.invalid/"), "http://example.invalid/");
  // 大小写 scheme 与原始字节都保留（不把 new URL().href 的规范化结果写进文档）。
  assert.equal(pastedHttpUrl("HTTPS://Example.Invalid/A"), "HTTPS://Example.Invalid/A");
  // 中文路径 / 查询是合法的 http(s) URL（new URL 负责编码），不在这里收窄。
  assert.equal(pastedHttpUrl("https://example.invalid/中文?q=中"), "https://example.invalid/中文?q=中");
});

test("非单个 http(s) URL 一律不接管：正文、空白、其它 scheme、Markdown", () => {
  const rejected = [
    "",
    "   ",
    " https://example.invalid/a",
    "https://example.invalid/a ",
    "see https://example.invalid/a",
    "https://example.invalid/a\n",
    "https://example.invalid/a b",
    "www.example.invalid",
    "mailto:someone@example.invalid",
    "file:///tmp/x",
    "javascript:alert(1)",
    "[x](https://example.invalid/a)",
    "https://", // host 为空
    "not a url",
  ];
  for (const text of rejected) {
    assert.equal(pastedHttpUrl(text), null, `${JSON.stringify(text)} 不应被当成单个 URL`);
  }
});

test("标题转纯文本：空白折叠、控制字符抹平、标点转义", () => {
  assert.equal(markdownLinkLabel("  Hello\n\tWorld  "), "Hello World");
  assert.equal(markdownLinkLabel("a\u0000b\u001fc"), "a b c");
  assert.equal(markdownLinkLabel(""), null);
  assert.equal(markdownLinkLabel("   "), null);
  assert.equal(markdownLinkLabel(null), null);

  // 每个可能在行内制造结构的 ASCII 标点都带反斜杠。
  const title = "a\\b`c*d_e[f]g<h>i~j^k$l|m&n:o";
  assert.equal(markdownLinkLabel(title), "a\\\\b\\`c\\*d\\_e\\[f\\]g\\<h\\>i\\~j\\^k\\$l\\|m\\&n\\:o");
});

test("生成的链接：目标仍是 URL 原文（括号 / 反斜杠 / 尖括号被转义后解码回来）", () => {
  for (const url of [
    "https://example.invalid/a(b)c",
    "https://example.invalid/a)b",
    "https://example.invalid/a\\b",
    "https://example.invalid/a<b>",
  ]) {
    const source = markdownLinkFor(url, "标题");
    assert.ok(source, `${url} 应能生成链接`);
    const { link } = parsedLink(source);
    assert.ok(link);
    assert.deepEqual(classifyLinkTarget(link.target), { kind: "external", url }, `${url}：目标解码后逐字还原`);
  }
});

test("标题按纯文本处理：不产生 HTML / 强调 / 链接 / 表格 / 公式结构", () => {
  const title = "[点我](https://evil.invalid) <b>粗</b> *斜* `码` | cell | $x$ :smile: https://evil.invalid";
  const source = markdownLinkFor("https://example.invalid/ok", title);
  assert.ok(source);
  const { labelText, kinds } = parsedLink(source);

  assert.equal(labelText, title, "标签源码解转义后逐字等于标题");
  // 标签内部只有普通文本与 Escape 节点：不得出现 HTMLTag / StrongEmphasis / InlineCode /
  // Image / Link / Table / Emoji / URL 等结构节点。
  for (const forbidden of [
    "HTMLTag",
    "HTMLBlock",
    "StrongEmphasis",
    "Emphasis",
    "InlineCode",
    "Image",
    "Link",
    "URL",
    "Emoji",
    "Table",
  ]) {
    assert.equal(kinds.has(forbidden), false, `标题里不得长出 ${forbidden}`);
  }
  // 整份文档只有生成的那一条 Link：标题里的 `[点我](…)` 没有变成第二条链接。
  const state = completeTree(EditorState.create({ doc: source, extensions: MD }));
  let links = 0;
  syntaxTree(state).iterate({ enter(ref) { if (ref.name === "Link") links += 1; } });
  assert.equal(links, 1);
});

test("标题长度上限：超长标题视为不可用（保留 URL）", () => {
  assert.ok(markdownLinkFor("https://example.invalid", "中".repeat(MAX_URL_TITLE_LENGTH)));
  assert.equal(markdownLinkFor("https://example.invalid", "中".repeat(MAX_URL_TITLE_LENGTH + 1)), null);
});

test("改写判据：区间文本仍是原 URL 才允许，标题不可用则不写", () => {
  const url = "https://example.invalid/a";
  const doc = EditorState.create({ doc: `前 ${url} 后` }).doc;
  const from = 2;
  const to = from + url.length;
  const pending = { id: 1, from, to, url };

  assert.deepEqual(urlTitleReplacement(doc, pending, "标题"), {
    from,
    to,
    insert: "[标题](https://example.invalid/a)",
  });
  assert.equal(urlTitleReplacement(doc, pending, null), null, "网络失败 / 无标题：不改写");
  assert.equal(urlTitleReplacement(doc, pending, "   "), null, "空白标题：不改写");
  assert.equal(
    urlTitleReplacement(EditorState.create({ doc: `前 ${url}x 后` }).doc, { ...pending, to: to + 1 }, "标题"),
    null,
    "区间内被编辑过：不改写",
  );
});

test("待返回区间随事务映射：区间外插入不丢目标，区间内编辑则改写被放弃", () => {
  let state = EditorState.create({ doc: "URL", extensions: [pendingUrlTitleField] });
  state = state.update({
    effects: addPendingUrlTitle.of({ id: 7, from: 0, to: 3, url: "URL" }),
  }).state;
  assert.deepEqual(pendingUrlTitles(state), [{ id: 7, from: 0, to: 3, url: "URL" }]);

  // 区间前插入：两个端点整体右移，切片仍是 URL。
  state = state.update({ changes: { from: 0, insert: "前" } }).state;
  let pending = pendingUrlTitles(state)[0];
  assert.deepEqual([pending.from, pending.to], [1, 4]);
  assert.equal(state.doc.sliceString(pending.from, pending.to), "URL");

  // 区间末尾插入：新文本算在 URL 之后（to 用 assoc -1），切片仍是 URL。
  state = state.update({ changes: { from: 4, insert: "后" } }).state;
  pending = pendingUrlTitles(state)[0];
  assert.deepEqual([pending.from, pending.to], [1, 4]);
  assert.equal(state.doc.sliceString(pending.from, pending.to), "URL");

  // 区间内删除一个字符：切片对不上，改写必须放弃。
  state = state.update({ changes: { from: 2, to: 3 } }).state;
  pending = pendingUrlTitles(state)[0];
  assert.notEqual(state.doc.sliceString(pending.from, pending.to), "URL");
  assert.equal(urlTitleReplacement(state.doc, pending, "标题"), null);

  // 显式移除后不再留账。
  state = state.update({ effects: removePendingUrlTitle.of(7) }).state;
  assert.deepEqual(pendingUrlTitles(state), []);
});

test("撤账 effects：清空全部 pending；整篇替换后不会再有可升级的区间", () => {
  let state = EditorState.create({ doc: "URL", extensions: [pendingUrlTitleField] });
  state = state.update({
    effects: [
      addPendingUrlTitle.of({ id: 1, from: 0, to: 3, url: "URL" }),
      addPendingUrlTitle.of({ id: 2, from: 0, to: 3, url: "URL" }),
    ],
  }).state;
  assert.equal(pendingUrlTitles(state).length, 2);

  const effects = clearPendingUrlTitleEffects(state);
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: "# 重载后的正文\n" },
    effects,
  }).state;
  assert.deepEqual(pendingUrlTitles(state), [], "整篇重载（或切走）必须撤清 pending");
  assert.equal(state.doc.toString(), "# 重载后的正文\n");
});

test("pending id 自增：同一文档里多次粘贴互不覆盖", () => {
  const a = newPendingUrlTitle(0, 3, "https://a.invalid");
  const b = newPendingUrlTitle(0, 3, "https://b.invalid");
  assert.notEqual(a.id, b.id);
});
