// dotfile 与 JSONC 的高亮（change dotfile-jsonc-highlight / M243）。
//
// 这一层判三件事，都能在 node 里直接跑（不需要 DOM / EditorView）：
//   1. **注册表判定顺序**（preview/attachments.ts）：basename 精确、大小写敏感、优先于扩展名；
//      未收录 dotfile 与扩展名仍落 text；
//   2. **语言表的覆盖**（preview/code.ts 的 LANGUAGES）：三类语言各有一个 StreamLanguage，
//      jsonc 与 json 是**同一实例**（design D2 的「复用既有 json mode」）；
//   3. **token 化**（highlightCode 驱动，与围栏代码块同一条路径）：gitignore 的四形态、
//      gitattributes 的字段切分、jsonc 的注释与尾逗号。
//
// 反向用例先行（REVIEW.md 第 1 条）：`foo.gitignore` / `.GitIgnore` / `.secret` / `\#` /
// 非行首 `!` / 非行尾 `/` 这些**必须不命中**的输入，是「断言有区分度」的自检面；没有它们，
// 一条恒真的 `assert.ok(...)` 与真正的判据在测试输出里长得一样。
//
// 真机侧同源：整文件 code 模式（editor.ts 的 codeLanguageFor）与围栏代码块（highlightCode）
// 共用 preview/code.ts 的 LANGUAGES，本层只覆盖后者能直接驱动的部分；DOM 类名 / 计算色 /
// 真机行为分别归 tests/visual（chromium，不在本 change 的施工面）与
// scripts/acceptance/scenarios/46-dotfile-jsonc-highlight.md。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codeLanguage,
  codeLanguageOfPath,
  extensionOf,
  fileClass,
  fileClassOfPath,
  isEditablePath,
  nonTextExtensions,
} from "../../src/preview/attachments.ts";
import { LANGUAGES, highlightCode, tokenClassOf } from "../../src/preview/code.ts";

// --- 1. 注册表：文件名优先 + 精确 + 大小写敏感 -------------------------------------------------

test("命中：两个 dotfile basename 与 .jsonc 各归其 class / language", () => {
  for (const [path, language] of [
    [".gitignore", "gitignore"],
    [".gitattributes", "gitattributes"],
    ["x.jsonc", "jsonc"],
  ] as const) {
    assert.equal(fileClassOfPath(path), "code", `${path} 应是 code 类`);
    assert.equal(codeLanguageOfPath(path), language, `${path} 的语言名`);
  }
});

test("判定按 basename：嵌套目录里的同名文件同样命中", () => {
  assert.equal(fileClassOfPath("dir/sub/.gitignore"), "code");
  assert.equal(codeLanguageOfPath("dir/sub/.gitignore"), "gitignore");
  assert.equal(codeLanguageOfPath("a/b/c.jsonc"), "jsonc");
});

test("扩展名大小写不敏感（.JSONC），文件名大小写敏感（.GitIgnore 不命中）", () => {
  assert.equal(codeLanguageOfPath("X.JSONC"), "jsonc");
  // 反向：basename 精确匹配，`.GitIgnore` 不是 `.gitignore`
  assert.equal(fileClassOfPath(".GitIgnore"), "text");
  assert.equal(codeLanguageOfPath(".GitIgnore"), null);
  assert.equal(fileClassOfPath("dir/.GitAttributes"), "text");
});

test("反向：精确 basename 匹配 MUST NOT 被扩展名形态命中（foo.gitignore 不中）", () => {
  // 若实现走 `CODE_EXTENSIONS` 的 `gitignore` 键（被否决的 V3），这两条会红
  assert.equal(fileClassOfPath("foo.gitignore"), "text");
  assert.equal(codeLanguageOfPath("foo.gitignore"), null);
  assert.equal(fileClassOfPath("notes.gitattributes"), "text");
});

test("反向：未收录 dotfile 仍落 text（.secret 对照组），已经录的扩展名不受影响", () => {
  for (const path of [".secret", ".env.local", ".gitmodules", ".gitkeep"]) {
    assert.equal(fileClassOfPath(path), "text", `${path} 应保持 text`);
    assert.equal(codeLanguageOfPath(path), null, `${path} 不应有语言包`);
  }
  // 注册表既有条目一字不动
  assert.equal(fileClassOfPath("main.rs"), "code");
  assert.equal(fileClassOfPath("notes.md"), "md");
  assert.equal(fileClassOfPath("pic.png"), "image");
});

test("path 版比 ext 版多出文件名规则：同一路径两个查询口给出不同答案", () => {
  // `.gitignore` 的「扩展名」是 `gitignore`（未收录）——只看 ext 会落 text（M130 起的旧路径），
  // 文件名规则才是把它提到 code 的那一步。这两条一起证明文件名表**参与且生效**。
  assert.equal(fileClass(extensionOf(".gitignore")), "text");
  assert.equal(fileClassOfPath(".gitignore"), "code");
  assert.equal(codeLanguage(extensionOf(".gitignore")), null);
  assert.equal(codeLanguageOfPath(".gitignore"), "gitignore");
});

test("dotfile 的名字约定 MUST NOT 出现在扩展名表（design §6 V3 的反向判据）", () => {
  // 文件名表的键都带前导点、扩展名表的键都不带，两表的键集因此**结构上不重叠**；反过来，
  // 把 `gitignore` / `gitattributes` 当扩展名塞进 CODE_EXTENSIONS（被否决的 V3 做法）会让
  // 下面每一条红。列表取本次收录的两个名字 + 一批「将来可能被顺带收录」的 dotfile：
  // 它们都必须走不到扩展名表（顺带收录要另立 change，且仍走文件名表）。
  for (const basename of [
    ".gitignore",
    ".gitattributes",
    ".gitmodules",
    ".gitkeep",
    ".dockerignore",
    ".npmrc",
    ".editorconfig",
    ".env",
  ]) {
    const asExtension = basename.slice(1);
    assert.equal(fileClass(asExtension), "text", `${asExtension} MUST NOT 出现在扩展名表`);
    assert.equal(codeLanguage(asExtension), null, `${asExtension} MUST NOT 在扩展名表里带语言`);
  }
});

test("可编辑性随文件类自动获得：三类可编辑，dotfile 对照组同样是 text 类（零新增开关）", () => {
  for (const path of [".gitignore", ".gitattributes", "x.jsonc", ".secret"]) {
    assert.equal(isEditablePath(path), true, `${path} 应可编辑`);
  }
  assert.equal(isEditablePath("pic.png"), false);
  // 文件名表是 code 类，不进「不可编辑扩展名」清单（Rust 拒绝清单因此无需跟着改）
  assert.equal(nonTextExtensions().includes("gitignore"), false);
});

// --- 2. 语言表覆盖 ----------------------------------------------------------------------------

test("LANGUAGES 有三类语言的实现，jsonc 复用 json 的同一实例", () => {
  assert.ok(LANGUAGES.gitignore, "gitignore 缺语言实现");
  assert.ok(LANGUAGES.gitattributes, "gitattributes 缺语言实现");
  assert.ok(LANGUAGES.jsonc, "jsonc 缺语言实现");
  assert.equal(LANGUAGES.jsonc, LANGUAGES.json, "jsonc SHALL 复用既有 json 实例（design D2）");
});

test("围栏 info string 与语言名同名即可解析（无别名条目时也命中）", () => {
  assert.ok(highlightCode("# c\n", "gitignore").length > 0);
  assert.ok(highlightCode("*.md text\n", "gitattributes").length > 0);
  assert.ok(highlightCode('"a": 1\n', "jsonc").length > 0);
});

test("反向：未收录 info string 一律不着色（不用近似 parser 冒充）", () => {
  for (const info of ["secret", "dotenv", "gitmodules", ""]) {
    assert.deepEqual(highlightCode("# c\n!k\nbuild/\n", info), [], `${info} 不应着色`);
  }
});

// --- 3. token 化 ------------------------------------------------------------------------------

/** token 区间快照：`from..to:cls`，逐条比对（只判长度或子串会失去区分度）。 */
const spans = (code: string, info: string): string[] =>
  highlightCode(code, info).map((token) => `${token.from}..${token.to}:${token.cls}`);

const COMMENT = tokenClassOf("comment");
const KEYWORD = tokenClassOf("keyword");
const STRING = tokenClassOf("string");
const PROPERTY = tokenClassOf("property");
const LITERAL = tokenClassOf("literal");

test("gitignore：`#` 至行尾取注释（整行一个区间）", () => {
  assert.deepEqual(spans("# comment", "gitignore"), [`0..9:${COMMENT}`]);
  assert.deepEqual(spans("#", "gitignore"), [`0..1:${COMMENT}`]);
});

test("gitignore：`\\#` 转义不算注释（行首是反斜杠）", () => {
  assert.deepEqual(spans("\\#literal", "gitignore"), []);
  // 紧邻的对照：行首真是 `#` 时同样两个字符的输入必须是注释
  assert.deepEqual(spans("#comment", "gitignore"), [`0..8:${COMMENT}`]);
});

test("gitignore：行首 `!` 取关键字，其余文本不赋 token", () => {
  assert.deepEqual(spans("!keep.txt", "gitignore"), [`0..1:${KEYWORD}`]);
});

test("gitignore：`!` 只在行首生效（非行首不取关键字）", () => {
  assert.deepEqual(spans("keep!me", "gitignore"), []);
});

test("gitignore：行尾 `/` 取关键字，行中的 `/` 不取", () => {
  assert.deepEqual(spans("build/", "gitignore"), [`5..6:${KEYWORD}`]);
  assert.deepEqual(spans("dist/", "gitignore"), [`4..5:${KEYWORD}`]);
  assert.deepEqual(spans("foo/bar", "gitignore"), []);
  assert.deepEqual(spans("/build", "gitignore"), []);
});

test("gitignore：空行与纯模式行零 token", () => {
  assert.deepEqual(spans("*.log", "gitignore"), []);
  assert.deepEqual(spans("\n", "gitignore"), []);
  assert.deepEqual(spans("build/\n*.log\n!keep.txt\n# c\n", "gitignore"), [
    `5..6:${KEYWORD}`,
    `13..14:${KEYWORD}`,
    `23..26:${COMMENT}`,
  ]);
});

test("gitattributes：pattern 不着色，属性名取 property，attr=value 的值取 string", () => {
  assert.deepEqual(spans("*.md text eol=lf", "gitattributes"), [
    `5..9:${PROPERTY}`,
    `10..13:${PROPERTY}`,
    `14..16:${STRING}`,
  ]);
});

test("gitattributes：`-attr` 取反形态同样落属性色", () => {
  assert.deepEqual(spans("*.bin -diff", "gitattributes"), [`6..11:${PROPERTY}`]);
  assert.deepEqual(spans("*.png binary !text", "gitattributes"), [`6..12:${PROPERTY}`, `13..18:${PROPERTY}`]);
});

test("gitattributes：`#` 注释行取注释色（pattern 位置不发生属性着色）", () => {
  assert.deepEqual(spans("# text eol=lf", "gitattributes"), [`0..13:${COMMENT}`]);
});

test("反向：gitattributes 的着色 MUST NOT 串到 pattern 上", () => {
  // 单字段行只有一个 pattern → 零 token；若实现把第一个词当属性，这条会红
  assert.deepEqual(spans("*.md", "gitattributes"), []);
  assert.deepEqual(spans("", "gitattributes"), []);
  assert.deepEqual(spans("\n", "gitattributes"), []);
});

test("jsonc：注释 / 键 / 字符串 / 数字各归其色，尾逗号不产出 error 着色", () => {
  const doc = [
    "{",
    "  // line comment",
    '  "alpha": "beta",',
    "  \"gamma\": 42,",
    "}",
  ].join("\n");
  const tokens = highlightCode(doc, "jsonc");
  const clsAt = (text: string): string[] =>
    tokens.filter((t) => doc.slice(t.from, t.to) === text).map((t) => t.cls);

  assert.deepEqual(clsAt("// line comment"), [COMMENT]);
  // json 键是复合 tag [string, propertyName] → 类名串同时含两个 role（TOKEN_GROUPS 的条目序
  // 让靠后的 property 在 CSS 上胜出，观感是属性色）。判据取「含 property 且不是纯 string」。
  assert.deepEqual(clsAt('"alpha"').length, 1);
  assert.ok(clsAt('"alpha"')[0].includes(PROPERTY), `键应含属性色，实际 ${JSON.stringify(clsAt('"alpha"'))}`);
  assert.notEqual(clsAt('"alpha"')[0], STRING, "键 MUST NOT 退化成纯字符串色（与值同色）");
  assert.deepEqual(clsAt('"beta"'), [STRING]);
  assert.ok(clsAt('"gamma"')[0].includes(PROPERTY));
  assert.deepEqual(clsAt("42"), [LITERAL]);
  // 尾逗号：无任何 token 覆盖它（error / invalid 不着色，也不占区间）
  assert.equal(
    tokens.some((t) => doc.slice(t.from, t.to).includes(",")),
    false,
    "尾逗号不应被任何 token 覆盖",
  );
  // 反向铺底：整段确实产出过四类 token（避免「零 token 也算通过」）。类名串可能是复合的
  //（键 = string + propertyName），因此按 includes 判在场而不是相等。
  for (const cls of [COMMENT, PROPERTY, STRING, LITERAL]) {
    assert.ok(tokens.some((t) => t.cls.includes(cls)), `${cls} 应出现`);
  }
});

test("jsonc：跨行块注释续行到闭合（与 design §1.4 探针一致）", () => {
  const doc = ["{", "  /* block", "     comment */", '  "k": 1', "}"].join("\n");
  const tokens = highlightCode(doc, "jsonc");
  const comment = tokens.filter((t) => t.cls === COMMENT);
  assert.ok(comment.length >= 1, "块注释应产出注释 token");
  const covered = comment.map((t) => doc.slice(t.from, t.to)).join("");
  assert.ok(covered.includes("block"), `块注释首行应被覆盖，实际 ${JSON.stringify(covered)}`);
  assert.ok(covered.includes("comment */"), `块注释续行应被覆盖，实际 ${JSON.stringify(covered)}`);
});

test("jsonc 与围栏 json 同源：同一段内容两块取到同一套 cls（键不退化成值色）", () => {
  const doc = '{ "alpha": "beta",\n  // c\n}';
  const asJsonc = highlightCode(doc, "jsonc").map((t) => `${doc.slice(t.from, t.to)}:${t.cls}`);
  const asJson = highlightCode(doc, "json").map((t) => `${doc.slice(t.from, t.to)}:${t.cls}`);
  assert.deepEqual(asJsonc, asJson);
  const key = asJsonc.find((entry) => entry.startsWith('"alpha":'))?.split(":").slice(1).join(":") ?? "";
  assert.ok(key.includes(PROPERTY), `键应是属性色，实际 ${JSON.stringify(asJsonc)}`);
  assert.ok(asJsonc.includes(`"beta":${STRING}`), `值应是字符串色，实际 ${JSON.stringify(asJsonc)}`);
});
