// `src/code-identifiers.ts` 的纯逻辑单测（change code-variable-highlight，M198）。
//
// 这一层判六件事（都能在 node 里直接跑，不需要 DOM / EditorView）：
//   1. **逐语言判据语料**：`tests/unit/var-highlight-cases.ts` 的每一条用例——收录面（模块级 /
//      参数 / 局部 / 引用）必须点亮成组的出现，排除面（导入名 / 函数名 / 类与类型名 / 字段与成员名 /
//      对象键 / 枚举成员 / 名字空间名 / 包名 / 字符串 / 注释）必须**一处不亮**；
//   2. **触发判据**：完整选中命中、**部分选中也命中**（判据是「包含于」而不是「等于」）、
//      跨节点选区不命中、空选区不命中、落在非标识符上不命中；
//   3. **名字取节点原文**：`$price` 被截断选中时仍按 `$price` 判定，绝不退化成匹配 `price`
//      （`price` / `price_list` 一处都不亮）；
//   4. **可见域**：遮蔽（更内层同名声明）与方向合理性（两个函数各自的同名局部变量不互相点亮）；
//   5. **保守方向的两个 tie-break**：位置判不出来时「少亮」——既不作源，也能挡住候选；
//   6. **复用与缓存**：⌘⇧O 与双击共享同一次解析；索引按文档缓存（同一文档第二次触发不重建）；
//      T2 / T3 语言不解析也不装饰。
//
// 位置一律用**锚点**表达（`{ after, at }`：从 `after` 的末尾起找第一个 `at`），断言比的是
// `L<行>:<原文>@<from>-<to>`（行号与原文给人看，偏移量保证同文案多处出现也能分辨）。
//
// 不在这一层：装饰是否真的出现在 DOM 上、三层（选区 / 绑定匹配 / 搜索命中）计算样式是否互不相同、
// 几何与文档字节不变、生命周期四条清除——归 `tests/visual/scenes/m198-code-variable-highlight.spec.ts`；
// 真机（WKWebView）下的行为归 `scripts/acceptance/scenarios/31-code-variable-highlight.md`。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BINDING_MATCH_CLASS,
  bindingHits,
  bindingSource,
  identifierBuildCount,
  identifierIndex,
  supportsVariableBinding,
} from "../../src/code-identifiers.ts";
import { structureEntries, structureParseCount } from "../../src/code-structure.ts";
import { HIGHLIGHT_CASES } from "./var-highlight-cases.ts";
import type { ClickTarget, Locate } from "./var-highlight-cases.ts";
import type { CodeLanguage } from "../../src/preview/attachments.ts";

/** `L<行>:<原文>@<from>-<to>`——给人和给机器看的是同一串（同文案多处出现也不会混）。 */
const tag = (doc: string, from: number, to: number): string =>
  `L${doc.slice(0, from).split("\n").length}:${doc.slice(from, to)}@${from}-${to}`;

/** 定位一个区间：从 `after` 的**末尾**起找第 `nth`（默认 0）个 `at` 出现。 */
function locate(doc: string, spec: Locate): { from: number; to: number } {
  const anchor = doc.indexOf(spec.after);
  assert.notEqual(anchor, -1, `锚点不存在：${JSON.stringify(spec.after)}`);
  let from = doc.indexOf(spec.at, anchor + spec.after.length);
  for (let i = 0; i < (spec.nth ?? 0); i++) {
    assert.notEqual(from, -1, `锚点后找不到第 ${i + 1} 个 ${spec.at}`);
    from = doc.indexOf(spec.at, from + spec.at.length);
  }
  assert.notEqual(from, -1, `锚点后找不到 ${spec.at}（${JSON.stringify(spec.after)}）`);
  return { from, to: from + spec.at.length };
}

/** 点击目标 → 选区（默认覆盖整个 `at`；`shift` / `length` 供「选不全」的用例用）。 */
function selection(doc: string, target: ClickTarget): { from: number; to: number } {
  const base = locate(doc, target);
  const shift = target.shift ?? 0;
  const length = target.length ?? target.at.length;
  return { from: base.from + shift, to: base.from + shift + length };
}

/** 期望的一串位置 → 标签串（锚点解析失败即断言失败，不会静默产出空集）。 */
const expectTags = (doc: string, specs: readonly Locate[]): string[] =>
  specs.map((spec) => {
    const range = locate(doc, spec);
    return tag(doc, range.from, range.to);
  });

/** 点一下（或等价地产生该选区）→ 命中的标签串。 */
const hitsAt = (language: CodeLanguage, doc: string, click: ClickTarget): string[] =>
  bindingHits(language, doc, selection(doc, click)).map((hit) => tag(doc, hit.from, hit.to));

// --- 1. 逐语言判据语料 ------------------------------------------------------------------------

for (const item of HIGHLIGHT_CASES) {
  test(`判据语料：${item.name}`, () => {
    const sel = selection(item.doc, item.click);
    const source = bindingSource(item.language, item.doc, sel);
    const hits = bindingHits(item.language, item.doc, sel);
    const actual = hits.map((hit) => tag(item.doc, hit.from, hit.to));
    const expected = expectTags(item.doc, item.hits);
    assert.deepEqual(actual, expected, `${item.name}（${item.rationale}）`);
    if (expected.length === 0) {
      // 0 命中的用例一律断言「源位置本身就不是变量类位置」——比「匹配集合为空」强：它同时排除了
      // 「源取到了、只是没有别的出现」这条假绿路径（REVIEW.md 第 2 条）。
      assert.equal(source, null, `${item.name}：这一处不该被认作变量类位置（${item.rationale}）`);
    } else {
      assert.notEqual(source, null, `${item.name}：应当取到源节点`);
      assert.equal(source?.name, item.source ?? item.click.at, `${item.name}：名字必须取节点原文`);
    }
  });
}

// --- 2. 触发判据 -----------------------------------------------------------------------------

const DOLLAR_DOC = `const $price = 1;
$price + $price;
const price = 2;
price + 1;
const price_list = 3;
price_list;
`;

const FIRST_DOLLAR = { after: "const ", at: "$price" } as const;
const SECOND_DOLLAR = { after: "$price + ", at: "$price" } as const;
// 下一行里的第一处 `$price`（`$price + $price;` 的左操作数）
const THIRD_DOLLAR = { after: "1;\n", at: "$price" } as const;
const BARE_PRICE = { after: "$price + $price;\nconst ", at: "price" } as const;

test("触发：完整选中命中", () => {
  assert.deepEqual(
    hitsAt("javascript", DOLLAR_DOC, FIRST_DOLLAR),
    expectTags(DOLLAR_DOC, [THIRD_DOLLAR, SECOND_DOLLAR]),
    "点第 1 行的声明：第 2 行的两处 $price 都被点亮（源位置本身除外）",
  );
});

test("触发：只选中 `price`（`$` 未被选上）仍命中，且按节点原文判定——绝不匹配独立的 `price` / `price_list`", () => {
  // 选区 = `$price` 里的 `price` 五个字符（模拟双击在 wordChars 不含 `$` 的语言上的落点）
  const partial: ClickTarget = { after: "const ", at: "$price", shift: 1, length: 5 };
  const sel = selection(DOLLAR_DOC, partial);
  assert.equal(DOLLAR_DOC.slice(sel.from, sel.to), "price", "选区确实只覆盖了 `price` 五个字符");
  assert.equal(bindingSource("javascript", DOLLAR_DOC, sel)?.name, "$price", "名字取节点原文");
  assert.deepEqual(
    hitsAt("javascript", DOLLAR_DOC, partial),
    expectTags(DOLLAR_DOC, [THIRD_DOLLAR, SECOND_DOLLAR]),
    "只点亮其余 $price；独立的 `price` 与 `price_list` 一处都不亮（反向验证：把匹配文本改成选区文本时这里会变红）",
  );

  // 第二种「选不全」：选区在标识符**内部**结束（只选中 `pri`）——同样是「包含于」而不是「等于」。
  // 这两种形态合起来才有区分度：把判据改成「选区 === 节点」时，两条都必须变红
  //（反向验证见 test-results/m198/reverse-verification/unit-partial-is-not-contained.log）。
  const inner: ClickTarget = { after: "const ", at: "$price", shift: 1, length: 3 };
  const innerSel = selection(DOLLAR_DOC, inner);
  assert.equal(DOLLAR_DOC.slice(innerSel.from, innerSel.to), "pri");
  assert.equal(bindingSource("javascript", DOLLAR_DOC, innerSel)?.name, "$price");
  assert.deepEqual(hitsAt("javascript", DOLLAR_DOC, inner), expectTags(DOLLAR_DOC, [THIRD_DOLLAR, SECOND_DOLLAR]));
});

test("触发：独立的 `price` 与 `price_list` 各自成组，不与 `$price` 混", () => {
  const bareDecl = { after: "$price + $price;\nconst ", at: "price" } as const;
  const bareRef = { after: "price = 2;\n", at: "price" } as const;
  assert.deepEqual(hitsAt("javascript", DOLLAR_DOC, bareDecl), expectTags(DOLLAR_DOC, [bareRef]));
  const listDecl = { after: "price + 1;\nconst ", at: "price_list" } as const;
  const listRef = { after: "const price_list = 3;\n", at: "price_list" } as const;
  assert.deepEqual(hitsAt("javascript", DOLLAR_DOC, listDecl), expectTags(DOLLAR_DOC, [listRef]));
  // `$price` 的那些位置一处都不在 `price` / `price_list` 的命中集合里
  const dollarHits = hitsAt("javascript", DOLLAR_DOC, BARE_PRICE);
  assert.deepEqual(dollarHits, expectTags(DOLLAR_DOC, [bareRef]));
});

test("触发：跨节点选区不命中（拖选 / 含运算符 / 含成员访问符）", () => {
  const span = DOLLAR_DOC.indexOf("$price + $price");
  assert.deepEqual(bindingHits("javascript", DOLLAR_DOC, { from: span, to: span + 15 }), []);
  assert.equal(bindingSource("javascript", DOLLAR_DOC, { from: span, to: span + 15 }), null);

  const member = `const o = { count: 1 };\no.count + 1;\n`;
  const at = member.indexOf("o.count");
  assert.deepEqual(bindingHits("javascript", member, { from: at, to: at + 7 }), []);
});

test("触发：空选区与落在非标识符上的选区都不命中", () => {
  const empty = DOLLAR_DOC.indexOf("$price");
  assert.deepEqual(bindingHits("javascript", DOLLAR_DOC, { from: empty, to: empty }), []);
  const keyword = DOLLAR_DOC.indexOf("const");
  assert.equal(bindingSource("javascript", DOLLAR_DOC, { from: keyword, to: keyword + 5 }), null);
  const space = DOLLAR_DOC.indexOf(" + ");
  assert.equal(bindingSource("javascript", DOLLAR_DOC, { from: space + 1, to: space + 2 }), null);
});

// --- 3. 可见域（遮蔽与方向）-------------------------------------------------------------------

const SHADOW_JS = `const LIMIT = 42;
function inner() {
  const LIMIT = 1;
  return LIMIT + LIMIT;
}
function bare() {
  return LIMIT;
}
LIMIT + 1;
`;

const TOP_DECL = { after: "", at: "LIMIT" } as const; // 第 1 行 `const LIMIT`
const INNER_DECL = { after: "function inner() {\n  const ", at: "LIMIT" } as const;
const INNER_REF1 = { after: "const LIMIT = 1;\n  return ", at: "LIMIT" } as const;
const INNER_REF2 = { after: "return LIMIT + ", at: "LIMIT" } as const;
const BARE_REF = { after: "function bare() {\n  return ", at: "LIMIT" } as const;
const LAST_REF = { after: "  return LIMIT;\n}\n", at: "LIMIT" } as const;

test("遮蔽：函数内的同名局部声明把顶层那组与该函数隔开（双向都成立）", () => {
  assert.deepEqual(
    hitsAt("javascript", SHADOW_JS, TOP_DECL),
    expectTags(SHADOW_JS, [BARE_REF, LAST_REF]),
    "点顶层那条：只点亮未被隔断的两处，函数内那两条不亮",
  );
  assert.deepEqual(
    hitsAt("javascript", SHADOW_JS, INNER_DECL),
    expectTags(SHADOW_JS, [INNER_REF1, INNER_REF2]),
    "反过来点函数内那条：只点亮同函数体内的两处，顶层那条不亮（对称）",
  );
});

test("方向：两个函数各自的同名局部变量不互相点亮", () => {
  const doc = `function f() { const x = 1; return x; }\nfunction g() { const x = 2; return x; }\n`;
  const first = { after: "function f() { const ", at: "x" } as const;
  const firstRef = { after: "const x = 1; return ", at: "x" } as const;
  assert.deepEqual(hitsAt("javascript", doc, first), expectTags(doc, [firstRef]));
});

test("方向：外层参数与内层嵌套函数体里的引用都亮（同一支）", () => {
  const doc = `function outer(p) {\n  return function () { return p; };\n}\n`;
  const param = { after: "function outer(", at: "p" } as const;
  const innerRef = { after: "function () { return ", at: "p" } as const;
  assert.deepEqual(hitsAt("javascript", doc, param), expectTags(doc, [innerRef]));
});

// --- 4. 保守方向（两个 tie-break）-------------------------------------------------------------

// 判据表里**没有覆盖**的形态（design §7 的未实测名单）：java 的增强 for 绑定在 `ForSpec` 下，
// 我把它留在 unknown（当作「可能是声明位」）而不是猜成引用——这是两个 tie-break 的语料。
const JAVA_UNKNOWN = `class K {
  int m(String[] xs) {
    for (String LIMIT : xs) { LIMIT.length(); }
    int LIMIT = 1;
    return LIMIT;
  }
}
`;

test("tie-break B：位置判不出来（增强 for 的绑定名）时不作源——点它一处都不亮", () => {
  const target = { after: "for (String ", at: "LIMIT" } as const;
  const sel = selection(JAVA_UNKNOWN, target);
  assert.equal(bindingSource("java", JAVA_UNKNOWN, sel), null, "unknown 位置 MUST NOT 作源");
  assert.deepEqual(bindingHits("java", JAVA_UNKNOWN, sel), []);
});

test("tie-break A：判不出来的位置当作「可能是声明位」——它会把同名候选挡掉（少亮一侧）", () => {
  const decl = { after: "for (String LIMIT : xs) { LIMIT.length(); }\n    int ", at: "LIMIT" } as const;
  assert.equal(bindingSource("java", JAVA_UNKNOWN, selection(JAVA_UNKNOWN, decl))?.name, "LIMIT");
  assert.deepEqual(
    hitsAt("java", JAVA_UNKNOWN, decl),
    [],
    "少亮一侧：增强 for 的 `LIMIT`（unknown）把循环体内那处引用的归属抢走 ⇒ 与字段不同组",
  );
});

// --- 5. 复用与缓存 ---------------------------------------------------------------------------

test("共用解析：先 ⌘⇧O 再双击（与反过来）都只解析一次", () => {
  const docA = `const AA = 1;\nAA + 1;\n`;
  const beforeA = structureParseCount();
  structureEntries("javascript", docA); // ⌘⇧O：结构未解析 ⇒ 这里解析
  const refA = { after: "1;\n", at: "AA" } as const;
  bindingHits("javascript", docA, selection(docA, refA)); // 双击（走索引构建，不再解析）
  assert.equal(structureParseCount() - beforeA, 1, "⌘⇧O 之后再双击不应再解析");

  const docB = `const BB = 1;\nBB + 1;\n`;
  const beforeB = structureParseCount();
  const refB = { after: "1;\n", at: "BB" } as const;
  bindingHits("javascript", docB, selection(docB, refB)); // 先双击
  structureEntries("javascript", docB); // 再 ⌘⇧O
  assert.equal(structureParseCount() - beforeB, 1, "双击之后再 ⌘⇧O 不应再解析");
});

test("索引按文档缓存：同一文档第二次触发不重建，换文档才重建", () => {
  const doc = `const CC = 1;\nconst DD = 2;\nCC + DD;\n`;
  const cc = { after: "const ", at: "CC" } as const;
  const dd = { after: "const ", at: "DD" } as const;
  const before = identifierBuildCount();
  const beforeParses = structureParseCount();
  assert.equal(hitsAt("javascript", doc, cc).length, 1, "CC 的引用在 `CC + DD;` 那一行");
  assert.equal(identifierBuildCount() - before, 1, "首次触发建索引一次");
  bindingHits("javascript", doc, selection(doc, dd));
  assert.equal(identifierBuildCount() - before, 1, "同一文档第二次触发 MUST NOT 重新遍历整棵树");
  assert.equal(structureParseCount() - beforeParses, 1, "第二次触发也不重新解析");
});

test("索引条目数 = 语料里的标识符类出现数（含排除位）；排除位不进候选集合", () => {
  const doc = `const alpha = 1;\nfunction f(beta) { return alpha + beta; }\n`;
  const index = identifierIndex("javascript", doc);
  assert.notEqual(index, null);
  const all = index?.occurrences.map((occ) => `${occ.name}:${occ.cls}`) ?? [];
  assert.deepEqual(all, ["alpha:declaration", "f:excluded", "beta:declaration", "alpha:reference", "beta:reference"]);
});

// --- 6. 语言分层与零副作用 --------------------------------------------------------------------

test("语言分层：只有 T1 的 8 门有变量高亮，T2 / T3 一律没有（且不解析、不装饰、不提示）", () => {
  const supported: CodeLanguage[] = ["javascript", "typescript", "python", "rust", "go", "c", "cpp", "java"];
  const unsupported: CodeLanguage[] = ["css", "scss", "lua", "yaml", "sql", "ruby", "shell", "toml", "json", "html", "xml", "swift", "kotlin"];
  for (const language of supported) assert.equal(supportsVariableBinding(language), true, `${language} 应当支持`);
  for (const language of unsupported) assert.equal(supportsVariableBinding(language), false, `${language} 不应当支持`);

  const before = structureParseCount();
  for (const language of ["lua", "yaml", "sql", "css", "scss"] as CodeLanguage[]) {
    assert.equal(identifierIndex(language, "local LIMIT = 1\nLIMIT\n"), null);
    assert.deepEqual(bindingHits(language, "local LIMIT = 1\nLIMIT\n", { from: 6, to: 11 }), []);
  }
  assert.equal(structureParseCount() - before, 0, "不支持的语言 MUST NOT 解析（静默且零成本）");
});

test("判据是纯函数：同一输入两次调用结果相同（装饰层的「不改选区 / 不改文档 / 不抢焦点」由 chromium 场景断言）", () => {
  const first = hitsAt("javascript", DOLLAR_DOC, FIRST_DOLLAR);
  const second = hitsAt("javascript", DOLLAR_DOC, FIRST_DOLLAR);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2, "第 2 行的两处 $price");
});

test("类名不与搜索命中复用（MUST NOT 复用 .cm-searchMatch）", () => {
  assert.equal(BINDING_MATCH_CLASS, "cm-lp-code-binding");
  assert.notEqual(BINDING_MATCH_CLASS, "cm-searchMatch");
});
