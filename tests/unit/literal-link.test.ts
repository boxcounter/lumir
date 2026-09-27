// src/preview/links.ts 的字面 URL 入口单测（M272，change bare-url-cmd-click）：
// 形态 2 / 3 / 4（裸 URL / 链接定义行 / 角括号自动链接）的**节点识别、区间与原文**，
// 以及「哪些位置不入选」的负向面（标准链接与图片的 `URL` 子节点、无 scheme 的字面、
// 代码与 HTML 上下文）。用真 `EditorState` + 真 markdown parser（先例
// `list-indent.test.ts` / `cell-geometry.test.ts`）。
//
// 为什么这一层能测：判定只读文档与语法树（`ensureSyntaxTree` + `resolveInner`），不碰
// view、不碰坐标、不碰渲染。装出来的装饰与 ⌘⏎ 的终点归 chromium 场景
//（`tests/visual/scenes/render-link.spec.ts`）与真机场景 54。
//
// 负向断言一律配正观测（REVIEW.md 第 2 条）：每组「不入选」的用例旁边都有一条同文档里
// 命中成功的对照，否则「查询恒返回 null」也能让全部断言绿。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";
import { literalLinkAt, literalLinkOfNode } from "../../src/preview/links.ts";

const MD = [markdown({ base: markdownLanguage, extensions: [GFM] })];

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: MD });
}

/** 在 `needle` 首次出现处（+ offset）查询字面 URL。 */
function hit(doc: string, needle: string, offset = 0) {
  const at = doc.indexOf(needle);
  assert.ok(at >= 0, `fixture 里找不到 ${JSON.stringify(needle)}`);
  return literalLinkAt(stateOf(doc), at + offset);
}

// ---------------------------------------------------------------------------
// 形态 2：裸 URL
// ---------------------------------------------------------------------------

test("裸 URL：命中 URL 节点自身，尾标落在它末尾，露出范围就是它自己", () => {
  const doc = "正文里的 https://example.invalid/bare 是裸 URL。\n";
  const link = hit(doc, "https://example.invalid/bare");
  assert.ok(link, "段落里的裸 URL 应入选");

  const from = doc.indexOf("https://");
  const to = from + "https://example.invalid/bare".length;
  assert.deepEqual([link.from, link.to], [from, to]);
  assert.equal(link.target, "https://example.invalid/bare");
  assert.deepEqual(link.form, { kind: "external", url: "https://example.invalid/bare" });
  assert.equal(link.markAt, to, "尾标插在 URL 末尾（URL 本身是原文，没有任何隐藏）");
  assert.deepEqual([link.revealFrom, link.revealTo], [from, to], "显露范围就是 URL 自己");
  assert.deepEqual(link.angleMarks, []);

  // 光标落在 URL 中间任意位置都能命中（起点与末位各一条）
  assert.ok(hit(doc, "https://example.invalid/bare", 0), "起点");
  assert.ok(hit(doc, "https://example.invalid/bare", "https://example.invalid/bare".length - 1), "末位前一个字符");
});

test("文档首字符即裸 URL：光标在 0（打开文件时选区复位的位置）同样命中", () => {
  // 与 standardLinkAt 的同款两侧试起点：`resolveInner(0, 0)` 给的是 Paragraph，
  // 只有 side 1 才从该位置开始取。这条断了的表现是 ⌘⏎ 静默无反应。
  const doc = "https://example.invalid/first\n\n后续正文。\n";
  const link = literalLinkAt(stateOf(doc), 0);
  assert.ok(link, "文档起点处的裸 URL 应命中");
  assert.deepEqual([link.from, link.to], [0, "https://example.invalid/first".length]);
});

// ---------------------------------------------------------------------------
// 形态 3：链接定义行
// ---------------------------------------------------------------------------

test("链接定义行：只装饰 URL 部分，`[tag]: ` 前缀不是链接本体", () => {
  const doc = "[homepage]: https://example.invalid/home\n\n正文。\n";
  const link = hit(doc, "https://example.invalid/home");
  assert.ok(link, "定义行的 URL 应入选");

  const from = doc.indexOf("https://");
  assert.equal(link.from, from, "前缀 `[homepage]: ` 不在装饰区间内（D3）");
  assert.equal(link.to, from + "https://example.invalid/home".length);
  assert.deepEqual(link.form, { kind: "external", url: "https://example.invalid/home" });
  assert.equal(link.markAt, link.to);
  // 显露范围是整条定义行：光标落在 `[homepage]` 上也算「在编辑这条链接」
  assert.deepEqual([link.revealFrom, link.revealTo], [0, doc.indexOf("\n\n")]);
});

test("定义行嵌在引用块 / 列表项内同样入选（形态 3 的嵌套形态）", () => {
  for (const doc of [
    "> [homepage]: https://example.invalid/quoted\n",
    "- [homepage]: https://example.invalid/item\n",
  ]) {
    const link = hit(doc, "https://");
    assert.ok(link, `${JSON.stringify(doc)} 里的定义行应入选`);
    assert.equal(link.target, doc.slice(doc.indexOf("https://")).trim());
  }
});

// ---------------------------------------------------------------------------
// 形态 4：角括号自动链接
// ---------------------------------------------------------------------------

test("角括号自动链接：只装饰 URL 部分，两个尖括号被标记为待隐藏", () => {
  const doc = "<https://example.invalid/angle>\n";
  const link = hit(doc, "https://example.invalid/angle");
  assert.ok(link, "`<…>` 自动链接应入选（D1 推荐项）");

  assert.deepEqual([link.from, link.to], [1, doc.indexOf(">")], "装饰区间不含尖括号");
  assert.equal(link.target, "https://example.invalid/angle");
  assert.deepEqual(
    link.angleMarks.map((m) => doc.slice(m.from, m.to)),
    ["<", ">"],
    "两个 LinkMark 交给装饰层隐藏（按标准链接隐藏 `[` / `(` 同款）",
  );
  assert.equal(link.markAt, doc.indexOf(">") + 1, "尾标落在 `Autolink` 末尾（`>` 之后）");
  assert.deepEqual([link.revealFrom, link.revealTo], [0, doc.length - 1], "显露范围含尖括号");
});

// ---------------------------------------------------------------------------
// 负向面：哪些 `URL` 节点不入选（每条都配同文档里的正观测）
// ---------------------------------------------------------------------------

test("标准链接与图片的 `URL` 子节点不入选（形态 1 与 `Image` 各自的面）", () => {
  const doc = [
    "[示例站点](https://example.invalid/site)",
    "![图](https://example.invalid/img.png)",
    "正文里的 https://example.invalid/bare 是裸 URL。",
    "",
  ].join("\n\n");

  // 负向：标准链接的目标
  const site = doc.indexOf("https://example.invalid/site");
  assert.equal(literalLinkAt(stateOf(doc), site), null, "标准链接的目标 URL 不归本入口");
  const bare = doc.indexOf("https://example.invalid/bare");
  assert.ok(literalLinkAt(stateOf(doc), bare), "同一份文档里的裸 URL 仍是正观测");
});

test("标准链接标签里的 URL 也不入选（祖先链上有 `Link`）", () => {
  // `[**https://x**](note.md)`：URL 在标签内，祖先链是 StrongEmphasis → Link。
  const doc = "[**https://example.invalid/in-label**](note.md)\n\n正文 https://example.invalid/bare 在此。\n";
  assert.equal(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/in-label")), null);
  assert.ok(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/bare")), "正观测");
});

test("图片目标的 URL 不入选（`Image` 剪枝）", () => {
  const doc = "![图](https://example.invalid/img.png)\n\n正文里的 https://example.invalid/bare 在此。\n";
  assert.equal(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/img.png")), null);
  assert.ok(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/bare")), "正观测");
});

test("无 scheme 的字面 URL 与白名单外 scheme 一律不入选（分类复用，不另写 scheme 清单）", () => {
  const cases: Array<[label: string, literal: string]> = [
    ["GFM 的字面域名", "www.example.invalid"],
    ["裸邮箱", "someone@example.invalid"],
    ["白名单外 scheme", "xmpp:someone@example.invalid"],
  ];
  for (const [label, literal] of cases) {
    const doc = `正文 ${literal} 在此。\n\n另一处 https://example.invalid/bare 与 [ref]: https://example.invalid/def\n`;
    assert.equal(
      literalLinkAt(stateOf(doc), doc.indexOf(literal)),
      null,
      `${label}（${literal}）不应入选——判成 vault 内资产 / blocked 都不是外链语义`,
    );
    assert.ok(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/bare")), `${label}：正观测（裸 URL）`);
  }
  // 大写字面的 scheme（`HTTPS://…`）同样不入选——**不是我们的收窄**：GFM 的字面形态只认小写
  // `http://` / `https://` / `mailto:`，那种写法根本不产出 `URL` 节点（实测：整段只剩
  // Paragraph）。分类的 scheme 判定仍是大小写不敏感（`classifyLinkTarget` 单测与
  // `render-link.spec.ts` 的形态矩阵都钉着），只是裸文本这条路走不到它。
  assert.equal(
    literalLinkAt(stateOf("正文 HTTPS://example.invalid/upper 在此。\n"), 3),
    null,
    "GFM 不给大写字面产出 URL 节点",
  );
  // 白名单内的三种写法都入选
  for (const literal of ["http://example.invalid/plain", "mailto:someone@example.invalid"]) {
    const doc = `正文 ${literal} 在此。\n`;
    const link = literalLinkAt(stateOf(doc), doc.indexOf(literal));
    assert.ok(link, `${literal} 应入选`);
    assert.equal(link.form.kind, "external");
  }
});

test("代码与 HTML 上下文里没有 `URL` 节点（语法树天然排除），同文档的裸 URL 仍是正观测", () => {
  const doc = [
    "```js",
    "const url = 'https://example.invalid/in-fence';",
    "```",
    "",
    "`https://example.invalid/in-code`",
    "",
    "<!-- https://example.invalid/in-comment -->",
    "",
    "正文 https://example.invalid/bare 在此。",
    "",
  ].join("\n");
  for (const literal of ["https://example.invalid/in-fence", "https://example.invalid/in-code", "https://example.invalid/in-comment"]) {
    assert.equal(literalLinkAt(stateOf(doc), doc.indexOf(literal)), null, `${literal} 不应入选`);
  }
  assert.ok(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/bare")), "正观测");
});

test("frontmatter 内的 URL 会被查询命中——挡掉它的是装饰层的 frontmatter 剪枝", () => {
  // 这条钉住的是**职责分界**（design §6.2）：语法树不认识 frontmatter，URL 节点确实在那里；
  // `inFrontmatter` 剪枝在装饰循环的第一句生效，因此「不装饰」是剪枝顺序的产物，
  // MUST NOT 被读成「语法树会排除它」。装饰侧的行为由视觉场景断言。
  const doc = "---\ntitle: 标题\nlink: https://example.invalid/in-fm\n---\n\n正文 https://example.invalid/bare 在此。\n";
  const inFm = literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/in-fm"));
  assert.ok(inFm, "查询层命中（装饰层负责剪枝）");
  assert.equal(inFm.form.kind, "external");
  assert.ok(literalLinkAt(stateOf(doc), doc.indexOf("https://example.invalid/bare")), "正观测");
});

// ---------------------------------------------------------------------------
// 节点级入口：直接喂节点（装饰层用的就是这一条）
// ---------------------------------------------------------------------------

test("literalLinkOfNode 对非 URL 节点返回 null（装饰循环按节点名分派）", () => {
  // 装饰层的 `URL` 分支把 ref.node 喂进来；喂进别种节点（这里是整棵树的 Document）
  // 必须得到 null——否则那个分支会误伤任何节点。
  const state = stateOf("正文里的 https://example.invalid/bare 是裸 URL。\n");
  assert.equal(literalLinkOfNode(syntaxTree(state).topNode, state.doc), null);
});
