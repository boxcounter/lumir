// src/code-structure.ts 的纯逻辑单测（change code-outline，M197）。
//
// 这一层判三个东西（都能在 node 里直接跑，不需要 DOM / EditorView）：
//   1. **条目集合**：逐语言的固定语料 → 条目文本 / 类别 / 层级逐一断言，并带负向断言
//      （局部变量、参数、导入语句、表达式引用 MUST NOT 出现）；
//   2. **名字口径**：java 的返回类型、c 的第二个 Identifier、python 的位置判据、rust 的
//      BoundIdentifier / TypeIdentifier、go 的 DefName / FieldName —— 每种错取法都有反向用例；
//   3. **惰性与缓存**：peek 不解析、首次解析一次、同文档不重复解析、换文档重新解析，
//      以及不分层的语言（T3）永远没有结构。
//
// 不在这一层：指示段 / 浮层 / 跳转落点 / 两种空态提示的**行为**（归 tests/visual/scenes/
// code-outline.spec.ts）与真机手感（归 scripts/acceptance/scenarios/30-code-outline.md）。
// `toc.ts` 依赖 DOM 侧模块（frontmatter → 渲染 widget），进不了本层，因此「当前位置链」的算法
// 被提到 code-structure.ts（`itemIndexAt` / `itemPath`），在这里直接断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURE_SUPPORT,
  itemIndexAt,
  itemPath,
  peekStructureEntries,
  structureEntries,
  structureParseCount,
  supportsStructure,
} from "../../src/code-structure.ts";
import type { CodeLanguage } from "../../src/preview/attachments.ts";

/** 条目表 → `层级|类别|文本` 的可读快照（断言里逐条比对，避免只判长度这种没有区分度的写法）。 */
const snapshot = (language: CodeLanguage, text: string): string[] =>
  structureEntries(language, text).map((entry) => `${entry.depth}|${entry.category}|${entry.text}`);

/** 只取文本（判断「哪些符号被列出来了」时更直观）。 */
const texts = (language: CodeLanguage, text: string): string[] =>
  structureEntries(language, text).map((entry) => entry.text);

// --- 1. 逐语言条目集合 ------------------------------------------------------------------------

const JS_DOC = `import { readFile } from "node:fs";
const LIMIT = 42;
let counter = 0;
class Util {
  static VERSION = "1";
  field = 1;
  greet(name) { const local = 1; return local + name; }
}
function helper(value, extra) { return value + LIMIT; }
const obj = { method() { return 1; }, prop: 2 };
`;

test("javascript：顶层变量 / 类 / 类成员 / 函数各就其位，局部变量与参数不入列", () => {
  assert.deepEqual(snapshot("javascript", JS_DOC), [
    "0|constant|LIMIT",
    "0|constant|counter",
    "0|class|Util",
    "1|field|VERSION",
    "1|field|field",
    "1|method|greet",
    "0|function|helper",
    "0|constant|obj",
  ]);
  // 负向：参数（name / value / extra）、局部变量（local）、导入行（readFile）、对象字面量的方法
  // （method / prop）都 MUST NOT 出现。断言用「集合不含」而不是「数组不等」——它们本来就不该在。
  for (const absent of ["readFile", "name", "value", "extra", "local", "method", "prop"]) {
    assert.ok(!texts("javascript", JS_DOC).includes(absent), `${absent} 不该出现在大纲里`);
  }
  // 字符串里的 `function x` 不是声明：正则式实现会在这里多出一条
  const inString = `const s = "function ghost() { return 1; }";\nfunction real() {}\n`;
  assert.deepEqual(texts("javascript", inString), ["s", "real"]);
});

test("typescript：在 js 的基础上多接口 / 类型别名 / 枚举（外加 declare 函数）", () => {
  const doc = `export const LIMIT: number = 42;
export interface Shape { area(): number; }
export type Alias = string | number;
export enum Color { Red, Green }
export class Util implements Shape {
  private readonly field: number = 1;
  constructor(v: number) { this.field = v; }
  area(): number { return 1; }
}
declare function ambient(a: number): void;
`;
  assert.deepEqual(snapshot("typescript", doc), [
    "0|constant|LIMIT",
    "0|interface|Shape",
    "0|type|Alias",
    "0|enum|Color",
    "0|class|Util",
    "1|field|field",
    // 构造器在 js/ts 语法里就是 MethodDeclaration（名字恰为 `constructor`）；delta 的类别表只给
    // java 列了 constructor，故这里归 method。
    "1|method|constructor",
    "1|method|area",
    "0|function|ambient",
  ]);
  // 反向：接口里的方法/属性（MethodType / PropertyType）与类型注解里的名字都不是条目
  assert.deepEqual(texts("typescript", doc).filter((t) => t === "area").length, 1);
});

test("python：类 / 方法 / 函数 / 顶层赋值；类体赋值、嵌套函数、局部变量都不出现", () => {
  const doc = `import os
LIMIT = 42
class Util(Base):
    FIELD = 1
    def greet(self, name):
        local = 1
        return local + name
def helper(value, extra=1):
    inner_var = 2
    def inner():
        return 3
    return value + LIMIT
async def amain():
    pass
`;
  assert.deepEqual(snapshot("python", doc), [
    "0|constant|LIMIT",
    "0|class|Util",
    "1|method|greet",
    "0|function|helper",
    "0|function|amain",
  ]);
  // 类体赋值（FIELD）不是「顶层赋值」；嵌套 def 与局部变量、参数都不是符号
  for (const absent of ["os", "FIELD", "name", "local", "inner", "inner_var", "value", "extra", "self"]) {
    assert.ok(!texts("python", doc).includes(absent), `${absent} 不该出现在大纲里`);
  }
});

test("rust：常量 / 静态量 / 类型 / 枚举 / trait / 结构体 / impl 块 / 函数 / 字段", () => {
  const doc = `const LIMIT: u32 = 42;
static NAME: &str = "x";
type Alias = u32;
enum Color { Red, Green }
trait Shape { fn area(&self) -> u32; }
struct Util { name: u32, flag: bool }
impl Util {
    fn greet(&self) -> u32 { let local = 1; local }
}
impl fmt::Display for Util {
    fn fmt(&self) -> u32 { 1 }
}
fn helper(value: u32) -> u32 { value + LIMIT }
`;
  assert.deepEqual(snapshot("rust", doc), [
    "0|constant|LIMIT",
    "0|constant|NAME",
    "0|type|Alias",
    "0|enum|Color",
    "0|trait|Shape",
    "1|function|area",
    "0|struct|Util",
    "1|field|name",
    "1|field|flag",
    "0|impl|impl Util",
    "1|method|greet",
    "0|impl|impl fmt::Display for Util",
    "1|method|fmt",
    "0|function|helper",
  ]);
  // 负向：`impl Util` 与 `impl Display for Util` 都取起始行原文（**不是** TypeIdentifier 的名字——
  // 后者在第二条上会取成 `Util`，把两个 impl 块显示成同一条）；`let local` 不是条目。
  assert.ok(!texts("rust", doc).includes("local"));
  assert.deepEqual(
    texts("rust", doc).filter((t) => t.startsWith("impl ")),
    ["impl Util", "impl fmt::Display for Util"],
  );
});

test("go：常量 / 变量声明逐个名字成条（分组声明与多名字都不丢）", () => {
  const doc = `package main

import "fmt"

const Limit = 42
var Name = "x"
var (
    A = 1
    B = 2
)
var x, y = 1, 2
type Util struct {
    name string
}
type Alias = int
func (u Util) Greet() string { local := 1; return fmt.Sprint(local) }
func helper(value int) int { return value + Limit }
`;
  assert.deepEqual(snapshot("go", doc), [
    "0|constant|Limit",
    "0|constant|Name",
    "0|constant|A",
    "0|constant|B",
    "0|constant|x",
    "0|constant|y",
    "0|type|Util",
    "0|type|Alias",
    "0|method|Greet",
    "0|function|helper",
  ]);
  // 负向：包名、导入、结构体字段（FieldDecl 不在 delta 的 go 覆盖表里）、局部短变量声明
  for (const absent of ["main", "fmt", "name", "local", "value", "u"]) {
    assert.ok(!texts("go", doc).includes(absent), `${absent} 不该出现在大纲里`);
  }
});

test("c：函数定义 / 函数原型 / 结构体 / 字段 / 全局常量与变量；函数体内的声明不入列", () => {
  const doc = `#include <stdio.h>
const int LIMIT = 42;
struct Util { int name; int flag; };
int helper(int value);
int greet(const char *pname) { int local = value; return 1; }
static int svalue = 3;
int main(void) { return 0; }
`;
  assert.deepEqual(snapshot("c", doc), [
    "0|constant|LIMIT",
    "0|struct|Util",
    "1|field|name",
    "1|field|flag",
    "0|function|helper",
    "0|function|greet",
    "0|constant|svalue",
    "0|function|main",
  ]);
  // 负向：函数体里的 `int local = value;` 不是顶层常量；`#include` 不是条目；形参不入列
  // （`value` / `pname`；结构体的字段 `name` 是**合法条目**，故不在负向表里）。
  for (const absent of ["stdio", "local", "value", "pname"]) {
    assert.ok(!texts("c", doc).includes(absent), `${absent} 不该出现在大纲里`);
  }
});

test("cpp：在 c 的基础上有类与类内方法（方法名是 FieldIdentifier）", () => {
  const doc = `class Util {
public:
  int field;
  static const int VERSION = 1;
  Util() {}
  int greet(const char *name) { return 1; }
};
struct Plain { int name; };
int helper(int value) { int local = value; return local; }
template <typename T> T id(T v) { return v; }
`;
  assert.deepEqual(snapshot("cpp", doc), [
    "0|class|Util",
    "1|field|field",
    "1|field|VERSION",
    "1|method|Util",
    "1|method|greet",
    "0|struct|Plain",
    "1|field|name",
    "0|function|helper",
    "0|function|id",
  ]);
  assert.ok(!texts("cpp", doc).includes("local"));
});

test("java：类 / 接口 / 枚举 / 方法 / 构造器 / 字段，嵌套类深一级", () => {
  const doc = `public class Util {
  static final int LIMIT = 42;
  private String field;
  public Util(String v) { this.field = v; }
  public String greet(String name) {
    int local = 1;
    return name;
  }
  interface Inner { void run(); }
  enum Color { RED }
  static class Nested { void deep() {} }
}
`;
  assert.deepEqual(snapshot("java", doc), [
    "0|class|Util",
    "1|field|LIMIT",
    "1|field|field",
    "1|constructor|Util",
    "1|method|greet",
    "1|interface|Inner",
    "2|method|run",
    "1|enum|Color",
    "1|class|Nested",
    "2|method|deep",
  ]);
  // 负向：局部变量（LocalVariableDeclaration）、形参、枚举常量（EnumConstant 不在 delta 的 java
  // 覆盖表里）都不是条目。
  for (const absent of ["local", "name", "v", "RED"]) {
    assert.ok(!texts("java", doc).includes(absent), `${absent} 不该出现在大纲里`);
  }
});

// --- 2. 名字口径的反向用例 --------------------------------------------------------------------

test("名字口径：取错就会失败的四处形态（java 返回类型 / c 第二个 Identifier / python 位置 / rust impl 行原文）", () => {
  // java：`String greet(String name)` 的返回类型 TypeName 排在名字前面——取「第一个类型名」
  // 会得到 `String`（错），取「第一个 Definition」才是 `greet`（对）。
  const java = `class A { String greet(String name) { return name; } }`;
  const javaEntries = structureEntries("java", java);
  assert.deepEqual(
    javaEntries.map((entry) => entry.text),
    ["A", "greet"],
  );
  assert.ok(!javaEntries.some((entry) => entry.text === "String"));

  // c：`int local = value;` 的 InitDeclarator 有两个 Identifier（声明名 + 初始化表达式里的引用），
  // 取第二个会得到 `value`（错）。
  const c = `const int LIMIT = 42;\nint helper(int value) { int local = value; return local; }\n`;
  assert.deepEqual(texts("c", c), ["LIMIT", "helper"]);

  // python：函数名与引用同名（VariableName），只有「直接子节点里的那一个」是名字——错误做法
  // （取第一个同名后代）在 `def greet(self, name)` 上会取到 `self`（形参）。
  const python = `def greet(self, name):\n    return name\n`;
  assert.deepEqual(texts("python", python), ["greet"]);

  // rust：ImplItem 取起始行原文（`impl` 与类型名分开的形态、`impl X for Y` 的形态都不出错）
  const rust = `impl Util {\n    fn a(&self) {}\n}\nimpl fmt::Display for Util {\n    fn b(&self) {}\n}\n`;
  assert.deepEqual(texts("rust", rust), ["impl Util", "a", "impl fmt::Display for Util", "b"]);

  // go：方法名是 FieldName，接收者括号里的形参是 DefName——取错会得到接收者名 `u`
  const go = `package main\nfunc (u Util) Greet() string { return "" }\n`;
  assert.deepEqual(texts("go", go), ["Greet"]);
});

// --- 3. 层级与缩进 ----------------------------------------------------------------------------

test("层级 = 语法嵌套深度（深嵌套与单层各一份语料）", () => {
  // 类内嵌套类 → 方法深一级（js 的类体里不能再声明类，故用 python 造三层；js 的成员层级由
  // 上面 javascript 那条用例覆盖：类 0、成员 1）
  const deep = `class Outer:\n    def m(self):\n        pass\n    class Inner:\n        def deep(self):\n            pass\n`;
  assert.deepEqual(
    structureEntries("python", deep).map((entry) => [entry.text, entry.depth]),
    [
      ["Outer", 0],
      ["m", 1],
      ["Inner", 1],
      ["deep", 2],
    ],
  );
  // 单层：多个顶层函数全在同一层（缩进归一后 --toc-depth 全为 0）
  const flat = `def a():\n    pass\ndef b():\n    pass\n`;
  assert.deepEqual(
    structureEntries("python", flat).map((entry) => entry.depth),
    [0, 0],
  );
  // 深层嵌套的 css 规则集同样逐级加深（.nested > .inner > .deep）
  const css = `.nested { .inner { .deep { color: red; } } }\n`;
  assert.deepEqual(
    structureEntries("css", css).map((entry) => [entry.text, entry.depth]),
    [
      [".nested", 0],
      [".inner", 1],
      [".deep", 2],
    ],
  );
});

test("顺序 = 文档顺序，落点 = 声明起点（前导缩进不在范围内）", () => {
  const doc = `function b() {}\nfunction a() {}\n`;
  const entries = structureEntries("javascript", doc);
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["b", "a"],
  );
  // 声明起点是 `function` 关键字处，不是名字处、也不是行尾
  assert.equal(entries[0].from, 0);
  assert.equal(entries[1].from, doc.indexOf("function a"));
  const indented = `class A {\n  greet() {}\n}\n`;
  const method = structureEntries("javascript", indented)[1];
  assert.equal(indented.slice(method.from, method.from + 7), "greet()");
  assert.equal(method.line, 2);
});

// --- 4. T2（规则集与 $变量）--------------------------------------------------------------------

test("css：条目 = 规则集（选择器原文），嵌套规则深一级，属性声明不入列", () => {
  const doc = `:root { --gap: 1px; }
.a, .b > .c:hover { color: red; }
@media (min-width: 10px) { .d { color: blue; } }
@keyframes spin { from { opacity: 0; } }
`;
  assert.deepEqual(snapshot("css", doc), [
    "0|rule|:root",
    "0|rule|.a, .b > .c:hover",
    // @media 不是条目（选择器没有名字可从它取），它里面的规则集仍是顶层规则
    "0|rule|.d",
  ]);
  // 属性声明与自定义属性（--gap）都不是条目；@keyframes 的关键帧选择器不是 RuleSet
  assert.ok(!texts("css", doc).includes("--gap"));
  assert.ok(!texts("css", doc).includes("from"));
});

test("scss：条目 = 规则集 + `$变量`声明；属性值里的 $变量与 mixin 形参不入列", () => {
  const doc = `$primary: #333;
.a {
  $local: 1px;
  padding: $local;
  .inner { color: blue; }
}
@mixin box($w) { width: $w; }
`;
  assert.deepEqual(snapshot("scss", doc), [
    "0|variable|$primary",
    "0|rule|.a",
    "1|variable|$local",
    "1|rule|.inner",
  ]);
  // `padding: $local` 是属性声明（值里含 $local）——只按「有 SassVariableName 子节点」判会多出
  // 一条重复条目（M197 实测踩到过）；`@mixin box($w)` 的 $w 是形参，也不是符号。
  const locals = structureEntries("scss", doc).filter((entry) => entry.text === "$local");
  assert.equal(locals.length, 1);
  assert.ok(!texts("scss", doc).includes("$w"));
});

// --- 5. 惰性与缓存 ----------------------------------------------------------------------------

test("peek 不解析：未解析的文档返回 null，解析后才可见", () => {
  const text = `def probe_peek():\n    pass\n# unique-${Date.now()}\n`;
  assert.equal(peekStructureEntries("python", text), null);
  const before = structureParseCount();
  const entries = structureEntries("python", text);
  assert.equal(structureParseCount(), before + 1);
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["probe_peek"],
  );
  assert.equal(peekStructureEntries("python", text), entries);
});

test("同一文档第二次请求不重新解析；换文档（内容变化）重新解析", () => {
  const first = `def one():\n    pass\n# cache-probe-a\n`;
  structureEntries("python", first);
  const afterFirst = structureParseCount();
  assert.deepEqual(texts("python", first), ["one"]);
  assert.equal(structureParseCount(), afterFirst, "同一文档第二、三次请求不该再解析");
  assert.equal(peekStructureEntries("python", first)?.length, 1);
  // 换文件 / 外部重载 / 切标签在缓存的眼里都是「文档内容变了」 → 新键、重新解析
  const second = `${first}def two():\n    pass\n`;
  assert.deepEqual(texts("python", second), ["one", "two"]);
  assert.equal(structureParseCount(), afterFirst + 1);
  // 同一段文本换语言是另一个键（token 与节点名都可能不同）
  assert.deepEqual(texts("javascript", "function one() {}\n"), ["one"]);
  assert.equal(structureParseCount(), afterFirst + 2);
});

test("不支持的语言永远没有结构：11 门 T3 语言与「无语言包」两侧都成立", () => {
  const unsupported: CodeLanguage[] = ["ruby", "shell", "toml", "yaml", "swift", "kotlin", "lua", "sql", "json", "html", "xml"];
  const supported: CodeLanguage[] = ["javascript", "typescript", "python", "rust", "go", "c", "cpp", "java", "css", "scss"];
  // 分层表逐门核对（与 spec 的三档名单一致）：不支持的档一律 null
  for (const language of unsupported) {
    assert.equal(STRUCTURE_SUPPORT[language], null, `${language} 应在不支持档`);
    assert.equal(supportsStructure(language), false);
    assert.deepEqual(structureEntries(language, "anything: 1\n"), []);
    assert.equal(peekStructureEntries(language, "anything: 1\n"), null);
  }
  for (const language of supported) {
    assert.ok(STRUCTURE_SUPPORT[language] !== null, `${language} 应有结构支持`);
    assert.equal(supportsStructure(language), true);
  }
  // 「无语言包」（无扩展名 / php 一类）在消费者侧就是 language === null
  assert.equal(supportsStructure(null), false);
  assert.equal(peekStructureEntries(null, "def f(): pass\n"), null);
});

test("T3 语言不做文本级降级：yaml / sql 的「看起来像声明」的文本一条都不产出", () => {
  // 这两门是最容易被近似 parser 蒙对的形态（yaml 的键、sql 的 CREATE TABLE），MUST NOT 降级
  assert.deepEqual(structureEntries("yaml", "key: 1\nother: 2\n"), []);
  assert.deepEqual(structureEntries("sql", "CREATE TABLE t (id INT);\nSELECT 1;\n"), []);
  assert.deepEqual(structureEntries("shell", "function f() { echo 1; }\n"), []);
  assert.deepEqual(structureEntries("lua", "function f() end\n"), []);
});

// --- 6. 当前位置归属与条目链 ------------------------------------------------------------------

test("当前位置归属：最后一个 from <= pos 的条目；首个条目前返回 -1", () => {
  const items = [
    { level: 0, from: 10 },
    { level: 1, from: 20 },
    { level: 0, from: 30 },
  ];
  assert.equal(itemIndexAt(items, 0), -1);
  assert.equal(itemIndexAt(items, 9), -1);
  assert.equal(itemIndexAt(items, 10), 0);
  assert.equal(itemIndexAt(items, 25), 1);
  assert.equal(itemIndexAt(items, 999), 2);
  assert.equal(itemIndexAt([], 5), -1);
});

test("条目链 = 祖先链（md 的标题层级与 code 的语法深度走同一份实现）", () => {
  // md 形态：H1 / H2 / H3 / H2 —— 光标在 H3 里时链条含 H1 与 H2
  const headings = [
    { level: 1, from: 0, name: "一" },
    { level: 2, from: 10, name: "一小" },
    { level: 3, from: 20, name: "一小细" },
    { level: 2, from: 30, name: "二小" },
  ];
  assert.deepEqual(
    itemPath(headings, itemIndexAt(headings, 25)).map((item) => item.name),
    ["一", "一小", "一小细"],
  );
  // 同级另起一段：光标落到「二小」时不再含「一小」那一支
  assert.deepEqual(
    itemPath(headings, itemIndexAt(headings, 35)).map((item) => item.name),
    ["一", "二小"],
  );
  // code 形态：depth 0 / 1 / 2 —— 同一个语义
  const entries = [
    { level: 0, from: 0, name: "class A" },
    { level: 1, from: 8, name: "m1" },
    { level: 1, from: 20, name: "m2" },
    { level: 2, from: 30, name: "inner" },
  ];
  assert.deepEqual(
    itemPath(entries, itemIndexAt(entries, 32)).map((item) => item.name),
    ["class A", "m2", "inner"],
  );
  assert.deepEqual(itemPath(entries, -1), []);
});

// --- 7. 与 spec 的分层名单逐门对账 ------------------------------------------------------------

test("分层注册表的键与既有语言表一一对应（21 门，无遗漏无多余）", () => {
  const keys = Object.keys(STRUCTURE_SUPPORT).sort();
  assert.deepEqual(keys, [
    "c",
    "cpp",
    "css",
    "go",
    "html",
    "java",
    "javascript",
    "json",
    "kotlin",
    "lua",
    "python",
    "ruby",
    "rust",
    "scss",
    "shell",
    "sql",
    "swift",
    "toml",
    "typescript",
    "xml",
    "yaml",
  ]);
  // php 不在 CodeLanguage 里（注册表标 null → 纯文本），因此本表没有它——「不顺带接 php」由类型保证
  assert.ok(!keys.includes("php"));
  const nullable = Object.entries(STRUCTURE_SUPPORT).filter(([, support]) => support === null);
  assert.equal(nullable.length, 11, "不支持档应是 11 门");
});
