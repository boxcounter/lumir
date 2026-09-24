// 变量高亮的判据语料（M198，change code-variable-highlight）——**测试与证据表的同一份来源**。
//
// 为什么要单独一个数据模块：tasks.md 1.2 要求「每门语言一段语料 + 期望命中集合逐条给依据」，
// 而这份期望必须是**可再跑**的（不是写在 markdown 里的一段口头结论）。因此语料与期望写在这里，
// `tests/unit/code-identifiers.test.ts` 逐条断言它、`test-results/m198/dump-cases.mjs` 把它导出成
// 证据表（`var-highlight-cases.md`）。改语料 / 改期望只有这一处。
//
// 语料口径（每门语言两份）：
// 1. `*_DOC`：同一名字（`LIMIT`）出现在**全部位置类别**上——模块/顶层常量、参数、局部变量、
//    引用、类字段、成员名、对象键、字符串、注释。断言分几次点击（常量 / 参数 / 局部），
//    每次的期望命中集合都能把「谁跟谁是一组」区分开。
// 2. `*_EXCLUDE_DOC`：同名出现在**排除面**上（导入名、函数名、类 / 类型名、枚举成员、字段名、
//    名字空间名、方法名……）——这些位置点下去必须**一处不亮**；每份语料末尾都有一条**正向对照**
//    （真变量 + 真引用）必须亮，否则「0 命中」没有区分度（REVIEW.md 第 1 条）。
//
// 位置用**锚点**而不是行号表达（`{ after, at, nth }`：从 `after` 起找第 nth 个 `at` 出现）：
// 改语料时行号会漂，而「点的是哪一处、期望亮的是哪几处」是判据本身。判定失败时测试会打印
// `L<行>:<原文>` 标签，可读性不受影响。

import type { CodeLanguage } from "../../src/preview/attachments.ts";

/** 定位一个区间的方式：从 `after` 的**末尾**起，找第 `nth`（默认 0）个 `at` 出现。 */
export interface Locate {
  readonly after: string;
  readonly at: string;
  readonly nth?: number;
}

/** 点击目标 = 定位 + 选区（`shift` 相对 `at` 起点偏移，`length` 为选区长度，逐字节原始值）。 */
export interface ClickTarget extends Locate {
  readonly shift?: number;
  readonly length?: number;
}

export interface HighlightCase {
  /** 用例名（断言消息 + 证据表用）。 */
  readonly name: string;
  readonly language: CodeLanguage;
  /** 语料。 */
  readonly doc: string;
  /** 双击（或等价地：产生该选区）的位置。 */
  readonly click: ClickTarget;
  /** 期望点亮的区间（文档序；空数组 = 一处都不亮）。 */
  readonly hits: readonly Locate[];
  /** 期望的源节点原文（缺省 = `click.at`）——「名字取节点原文、不取选区文本」的落点。 */
  readonly source?: string;
  /** 这条用例说明了什么（证据表的「依据」列）。 */
  readonly rationale: string;
}

// --- javascript / typescript ------------------------------------------------------------------

const JS_DOC = `// LIMIT 出现在注释里
const LIMIT = 42;
function withParam(LIMIT) {
  return LIMIT;
}
function withLocal() {
  const LIMIT = 1;
  return LIMIT;
}
class Holder {
  LIMIT = 2;
  m() { return this.LIMIT; }
}
const o = { LIMIT: 3 };
const s = "LIMIT";
const t = LIMIT;
`;

const JS_EXCLUDE_DOC = `import { LIMIT } from "./m.js";
function LIMIT(a) { return a; }
class LIMIT { }
const o = { LIMIT: 1 };
obj.LIMIT = 2;
const s = "LIMIT";
let LIMIT2 = 1;
LIMIT2 + 1;
`;

/**
 * 对象字面量简写形态的对照语料（真实语料抽样发现的唯一漏亮形态）：`{ LIMIT }` 的键同时是值
 * （`PropertyDefinition` 是 Property 的**唯一**子节点、右端与 Property 重合）⇒ 按引用收录；
 * `{ LIMIT: 2 }` 的键是 `PropertyDefinition,:,值` 三段 ⇒ 仍按排除位处理。
 */
const JS_SHORTHAND_DOC = `const LIMIT = 1;
const o = { LIMIT };
const p = { LIMIT: 2 };
`;

/**
 * ts 的遮蔽语料（tasks 4.4：局部同名声明必须被认作**声明位**，否则遮蔽会漏判 = 错亮）。
 * ts 与 js 共用判据表，但语料分开——「共用一张表」不等于「共用一份断言」。
 */
const TS_SHADOW_DOC = `const LIMIT: number = 42;

function inner(): number {
  const LIMIT: number = 1;
  return LIMIT;
}

function bare(): number {
  return LIMIT;
}
`;

/** ts 的额外形态（接口 / 类型别名 / 枚举名与成员）。 */
const TS_EXCLUDE_DOC = `interface LIMIT { LIMIT: number }
type LIMIT = number;
enum LIMIT { A }
class LIMIT { }
function LIMIT() { }
let LIMIT2 = 1;
LIMIT2 + 1;
`;

/**
 * js / ts 的变量类位置（节点名 + 父链，实测）：
 * - 模块级常量 `const LIMIT` → `VariableDefinition ← VariableDeclaration` ✓
 * - 参数 → `VariableDefinition ← ParamList` ✓
 * - 局部 → `VariableDefinition ← VariableDeclaration ← Block` ✓
 * - 引用 → `VariableName`（`BinaryExpression` / 变量声明的初始化位）✓
 * 排除面：类字段 `PropertyDefinition ← PropertyDeclaration`、成员名与对象键
 * `PropertyName ← MemberExpression / Property`、导入名 `VariableDefinition ← ImportDeclaration /
 * ImportGroup`（`{ LIMIT }` 里的原名是 `VariableName ← ImportGroup`）、函数名 / 类名 / 类型名
 * `VariableDefinition ← FunctionDeclaration / ClassDeclaration`、`TypeDefinition`、`TypeName`。
 */
export const JS_CASES: readonly HighlightCase[] = [
  {
    name: "js：模块级常量 → 只点亮未被隔断的引用",
    language: "javascript",
    doc: JS_DOC,
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "const t = ", at: "LIMIT" }],
    rationale:
      "`const LIMIT` 的容器是 Script（文件根）；`const t = LIMIT` 的 VariableName 归属它。函数内两处 LIMIT 各自归属自己的声明（参数 / 局部），类字段与成员名是排除位，字符串不是标识符类节点。",
  },
  {
    name: "js：参数 → 只点亮同函数体内的引用",
    language: "javascript",
    doc: JS_DOC,
    click: { after: "function withParam(", at: "LIMIT" },
    hits: [{ after: "function withParam(", at: "LIMIT", nth: 1 }],
    rationale: "参数 `VariableDefinition ← ParamList`，容器是 FunctionDeclaration 的跨度；函数体里的引用归属它，模块级与函数外的出现都不亮（方向合理性）。",
  },
  {
    name: "js：局部变量 → 只点亮同函数体内的引用",
    language: "javascript",
    doc: JS_DOC,
    click: { after: "  const ", at: "LIMIT" },
    hits: [{ after: "  const LIMIT = 1;\n  return ", at: "LIMIT" }],
    rationale: "局部 `LIMIT` 的容器是 Block（函数体），比模块级与参数都更内层；`withLocal` 之外的出现都不归属它。",
  },
  {
    name: "js：导入名不亮（`{ LIMIT }` 里的原名是 VariableName ← ImportGroup）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "import { ", at: "LIMIT" },
    hits: [],
    rationale: "导入名是排除面；放宽到「所有标识符类节点」时这里会亮（反向验证配方）。",
  },
  {
    name: "js：函数名不亮（`VariableDefinition ← FunctionDeclaration`）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "function ", at: "LIMIT" },
    hits: [],
    rationale: "同名也不是变量——函数名是排除位。",
  },
  {
    name: "js：类名不亮（`VariableDefinition ← ClassDeclaration`）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "class ", at: "LIMIT" },
    hits: [],
    rationale: "类名不是变量。",
  },
  {
    name: "js：对象键不亮（`PropertyName`）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "const o = { ", at: "LIMIT" },
    hits: [],
    rationale: "对象字面量的键是 PropertyName。",
  },
  {
    name: "js：成员访问名不亮（`PropertyName ← MemberExpression`）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "obj.", at: "LIMIT" },
    hits: [],
    rationale: "`obj.LIMIT` 的 LIMIT 是 PropertyName。",
  },
  {
    name: "js：对象字面量简写属性是引用，同名对象键仍是排除位",
    language: "javascript",
    doc: JS_SHORTHAND_DOC,
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "const o = { ", at: "LIMIT" }],
    rationale:
      "`{ LIMIT }` 的键节点同时就是值（简写的 Property 只含一个子节点、右端与父节点重合）⇒ 它是对同一变量的引用；`{ LIMIT: 2 }` 的键是属性名（排除位）。真实语料抽样里简写是唯一的漏亮形态（见 test-results/m198/false-positive-sample.md）。",
  },
  {
    name: "js：字符串里的同名文本不亮",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: 'const s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点（判据连位置都取不到，因此不可能靠文本匹配误命中）。",
  },
  {
    name: "js：正向对照——同一语料里的真变量仍然亮（0 命中才有区分度）",
    language: "javascript",
    doc: JS_EXCLUDE_DOC,
    click: { after: "let ", at: "LIMIT2" },
    hits: [{ after: "let LIMIT2 = 1;\n", at: "LIMIT2" }],
    rationale: "`let LIMIT2` 与 `LIMIT2 + 1` 必须互相点亮，证明上面几个 0 命中不是「整份语料都没解析」。",
  },
  {
    name: "ts：接口名不亮（`TypeDefinition ← InterfaceDeclaration`）",
    language: "typescript",
    doc: TS_EXCLUDE_DOC,
    click: { after: "interface ", at: "LIMIT" },
    hits: [],
    rationale: "ts 的类型位一律排除。",
  },
  {
    name: "ts：类型别名不亮（`TypeDefinition ← TypeAliasDeclaration`）",
    language: "typescript",
    doc: TS_EXCLUDE_DOC,
    click: { after: "type ", at: "LIMIT" },
    hits: [],
    rationale: "类型名不是变量。",
  },
  {
    name: "ts：枚举名与枚举成员不亮（`TypeDefinition` / `PropertyName ← EnumBody`）",
    language: "typescript",
    doc: TS_EXCLUDE_DOC,
    click: { after: "enum ", at: "LIMIT" },
    hits: [],
    rationale: "枚举名是 TypeDefinition；成员是 `PropertyName ← EnumBody`——都是排除位。",
  },
  {
    name: "ts：函数内的同名局部声明把模块级那组与它隔开（局部必须被认作声明位）",
    language: "typescript",
    doc: TS_SHADOW_DOC,
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "function bare(): number {\n  return ", at: "LIMIT" }],
    rationale:
      "就近声明优先：`bare()` 里的引用归属模块级常量（容器 Script），`inner()` 里那两条归属函数内的局部声明（容器 Block ⊂ 函数跨度）⇒ 点模块级时不亮它们。这一条同时钉住「局部声明被认作声明位」——若它被误判成引用，函数内那两条会被错亮。",
  },
  {
    name: "ts：正向对照",
    language: "typescript",
    doc: TS_EXCLUDE_DOC,
    click: { after: "let ", at: "LIMIT2" },
    hits: [{ after: "let LIMIT2 = 1;\n", at: "LIMIT2" }],
    rationale: "同一份语料里的真变量仍然亮。",
  },
];

// --- python -----------------------------------------------------------------------------------

const PY_DOC = `# LIMIT 出现在注释里
LIMIT = 42

def with_param(LIMIT):
    return LIMIT

def with_local():
    LIMIT = 1
    return LIMIT

class Holder:
    LIMIT = 2

    def m(self):
        return self.LIMIT

s = "LIMIT"
t = LIMIT
`;

const PY_EXCLUDE_DOC = `# LIMIT 出现在注释里
import LIMIT
from mod import LIMIT

def LIMIT(a):
    return a

class LIMIT:
    pass

LIMIT2 = 1
LIMIT2 + 1
`;

/**
 * python 的位置判据只能靠「节点名 + 父链」：类名 / 函数名 / 参数 / 局部 / 引用**同为
 * `VariableName`**（实测转储见 evidence/03 §2）。逐条：
 * - 赋值目标 → `VariableName ← AssignStatement`，且必须是该父节点里**第一个** VariableName
 *   （`x = y` 的右值不是绑定）
 * - 参数 → `VariableName ← ParamList`；`for` 目标 → `VariableName ← ForStatement`（第一个）
 * - 引用 → 其余 `VariableName`
 * - 类体直属赋值（类属性）→ `VariableName ← AssignStatement ← Body ← ClassDefinition`
 * - 成员名 → `PropertyName ← MemberExpression`；导入名 → `VariableName ← ImportStatement`
 * - 类名 / 函数名 → `VariableName ← ClassDefinition / FunctionDefinition`
 */
export const PY_CASES: readonly HighlightCase[] = [
  {
    name: "python：模块级赋值 → 只点亮模块级的引用",
    language: "python",
    doc: PY_DOC,
    click: { after: "# LIMIT 出现在注释里\n", at: "LIMIT" },
    hits: [{ after: "t = ", at: "LIMIT" }],
    rationale: "`LIMIT = 42` 是 `VariableName ← AssignStatement`（LHS）；函数内两处各有自己的声明，类属性与 `self.LIMIT` 是排除位。",
  },
  {
    name: "python：参数 → 只点亮同函数体内的引用",
    language: "python",
    doc: PY_DOC,
    click: { after: "def with_param(", at: "LIMIT" },
    hits: [{ after: "def with_param(", at: "LIMIT", nth: 1 }],
    rationale: "`VariableName ← ParamList`（容器 FunctionDefinition）。",
  },
  {
    name: "python：局部赋值 → 只点亮同函数体内的引用",
    language: "python",
    doc: PY_DOC,
    click: { after: "def with_local():\n    ", at: "LIMIT" },
    hits: [{ after: "    LIMIT = 1\n    return ", at: "LIMIT" }],
    rationale: "函数体里的 `LIMIT = 1` 是局部声明（容器 Body），与模块级、参数都不混。",
  },
  {
    name: "python：类体直属赋值（类属性）不亮",
    language: "python",
    doc: PY_DOC,
    click: { after: "class Holder:\n    ", at: "LIMIT" },
    hits: [],
    rationale: "`VariableName ← AssignStatement ← Body ← ClassDefinition`——类属性不是变量（spec 的排除面）。",
  },
  {
    name: "python：成员名 `self.LIMIT` 不亮",
    language: "python",
    doc: PY_DOC,
    click: { after: "return self.", at: "LIMIT" },
    hits: [],
    rationale: "`PropertyName ← MemberExpression`。",
  },
  {
    name: "python：字符串里的同名文本不亮",
    language: "python",
    doc: PY_DOC,
    click: { after: 's = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "python：导入名不亮（`import LIMIT`）",
    language: "python",
    doc: PY_EXCLUDE_DOC,
    click: { after: "# LIMIT 出现在注释里\nimport ", at: "LIMIT" },
    hits: [],
    rationale: "`VariableName ← ImportStatement`——导入名一律排除。",
  },
  {
    name: "python：`from mod import LIMIT` 的导入名不亮",
    language: "python",
    doc: PY_EXCLUDE_DOC,
    click: { after: "from mod import ", at: "LIMIT" },
    hits: [],
    rationale: "同上（同一节点形态）。",
  },
  {
    name: "python：函数名不亮",
    language: "python",
    doc: PY_EXCLUDE_DOC,
    click: { after: "def ", at: "LIMIT" },
    hits: [],
    rationale: "`VariableName ← FunctionDefinition`（名字位）。",
  },
  {
    name: "python：类名不亮",
    language: "python",
    doc: PY_EXCLUDE_DOC,
    click: { after: "class ", at: "LIMIT" },
    hits: [],
    rationale: "`VariableName ← ClassDefinition`。",
  },
  {
    name: "python：正向对照",
    language: "python",
    doc: PY_EXCLUDE_DOC,
    click: { after: "", at: "LIMIT2" },
    hits: [{ after: "LIMIT2 = 1\n", at: "LIMIT2" }],
    rationale: "同一份语料里 `LIMIT2 = 1` 与 `LIMIT2 + 1` 互相点亮。",
  },
];

// --- rust -------------------------------------------------------------------------------------

const RUST_DOC = `// LIMIT 出现在注释里
const LIMIT: u32 = 42;

fn with_param(LIMIT: u32) -> u32 { LIMIT }

fn with_local() -> u32 {
    let LIMIT = 1;
    return LIMIT;
}

struct Holder {
    LIMIT: u32,
}

fn main() -> u32 {
    let h = Holder { LIMIT: 1 };
    let s = "LIMIT";
    let t = LIMIT;
    return t;
}
`;

const RUST_EXCLUDE_DOC = `// LIMIT 出现在注释里
use std::LIMIT;
use std::fmt as LIMIT;

fn LIMIT() -> u32 { 1 }

struct LIMIT {
    LIMIT: u32,
}

enum LIMIT { LIMIT }

fn main() -> u32 {
    let v = LIMIT::LIMIT;
    let t = LIMIT2;
    return t;
}

const LIMIT2: u32 = 2;
`;

/**
 * rust 的判据（实测）：
 * - 绑定：`BoundIdentifier ← ConstItem / StaticItem / LetDeclaration / Parameter / ForExpression /
 *   TuplePattern / FieldPattern / MatchArm` ✓
 * - 引用：`Identifier`（表达式里的名字）✓
 * - 排除：函数名 `BoundIdentifier ← FunctionItem`、字段声明与字段访问 `FieldIdentifier`、
 *   类型名 `TypeIdentifier`、`use` 路径名 `BoundIdentifier ← ScopedIdentifier` 与
 *   `Identifier ← ScopedIdentifier`、`use … as` 别名 `BoundIdentifier ← UseAsClause`、
 *   枚举成员名 `Identifier ← EnumVariant`、占位名 `_`。
 */
export const RUST_CASES: readonly HighlightCase[] = [
  {
    name: "rust：常量 → 只点亮未被隔断的引用",
    language: "rust",
    doc: RUST_DOC,
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "let t = ", at: "LIMIT" }],
    rationale: "`BoundIdentifier ← ConstItem`（容器 SourceFile）；`let t = LIMIT;` 的 Identifier 归属它；字段声明与字段访问都是 FieldIdentifier（排除），字符串不是标识符节点。",
  },
  {
    name: "rust：参数 → 只点亮同函数体内的引用",
    language: "rust",
    doc: RUST_DOC,
    click: { after: "fn with_param(", at: "LIMIT" },
    hits: [{ after: "fn with_param(", at: "LIMIT", nth: 1 }],
    rationale: "`BoundIdentifier ← Parameter`（容器 FunctionItem）。",
  },
  {
    name: "rust：`let` 绑定 → 只点亮同块内的引用",
    language: "rust",
    doc: RUST_DOC,
    click: { after: "    let ", at: "LIMIT" },
    hits: [{ after: "    let LIMIT = 1;\n    return ", at: "LIMIT" }],
    rationale: "`BoundIdentifier ← LetDeclaration`（容器 Block），比模块级更内层。",
  },
  {
    name: "rust：结构体字段声明不亮（`FieldIdentifier`）",
    language: "rust",
    doc: RUST_DOC,
    click: { after: "struct Holder {\n    ", at: "LIMIT" },
    hits: [],
    rationale: "字段一律排除（`Holder { LIMIT: 1 }` 的字段初始化同理）。",
  },
  {
    name: "rust：`use` 路径末名不亮",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "use std::", at: "LIMIT" },
    hits: [],
    rationale: "`BoundIdentifier ← ScopedIdentifier`——导入名。",
  },
  {
    name: "rust：`use … as` 别名不亮",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "use std::fmt as ", at: "LIMIT" },
    hits: [],
    rationale: "`BoundIdentifier ← UseAsClause`——导入名。",
  },
  {
    name: "rust：函数名不亮",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "fn ", at: "LIMIT" },
    hits: [],
    rationale: "`BoundIdentifier ← FunctionItem`（名字位）。",
  },
  {
    name: "rust：结构体名不亮（`TypeIdentifier`）",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "struct ", at: "LIMIT" },
    hits: [],
    rationale: "类型名一律排除；枚举名 `TypeIdentifier ← EnumItem` 同理。",
  },
  {
    name: "rust：枚举成员名不亮（`Identifier ← EnumVariant`）",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "enum LIMIT { ", at: "LIMIT" },
    hits: [],
    rationale: "枚举成员是类型成员，与字段同一条排除口径。",
  },
  {
    name: "rust：字符串里的同名文本不亮",
    language: "rust",
    doc: RUST_DOC,
    click: { after: 'let s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "rust：正向对照",
    language: "rust",
    doc: RUST_EXCLUDE_DOC,
    click: { after: "const ", at: "LIMIT2" },
    hits: [{ after: "    let t = ", at: "LIMIT2" }],
    rationale: "同一份语料里 `const LIMIT2` 与 `let t = LIMIT2;` 互相点亮。",
  },
];

// --- go ---------------------------------------------------------------------------------------

const GO_DOC = `// LIMIT 出现在注释里
package main

const LIMIT = 42

func withParam(LIMIT int) int {
	return LIMIT
}

func withLocal() int {
	LIMIT := 1
	return LIMIT
}

type Holder struct {
	LIMIT int
}

var s = "LIMIT"
var t = LIMIT
`;

const GO_EXCLUDE_DOC = `// LIMIT 出现在注释里
package LIMIT

import LIMIT "fmt"

func LIMIT() int { return 1 }

type LIMIT struct{ LIMIT int }

var LIMIT2 = 1
var use = LIMIT2
`;

/**
 * go 的判据（实测）：
 * - 声明：`DefName ← ConstSpec / VarSpec / VarDecl / Parameter / RangeClause / TypeSwitchStatement` ✓
 * - 引用：`VariableName` ✓
 * - 排除：包名 `DefName ← PackageClause`、导入名 `DefName ← ImportSpec`、函数 / 方法 / 类型名
 *   `DefName ← FunctionDecl / MethodDecl / TypeSpec`、字段与成员名 `FieldName`、`TypeName`、
 *   占位名 `_`。
 */
export const GO_CASES: readonly HighlightCase[] = [
  {
    name: "go：常量 → 只点亮未被隔断的引用",
    language: "go",
    doc: GO_DOC,
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "var t = ", at: "LIMIT" }],
    rationale: "`DefName ← ConstSpec`（容器 SourceFile）；`var t = LIMIT` 的 VariableName 归属它；结构体字段是 FieldName（排除），字符串不是标识符节点。",
  },
  {
    name: "go：参数 → 只点亮同函数体内的引用",
    language: "go",
    doc: GO_DOC,
    click: { after: "func withParam(", at: "LIMIT" },
    hits: [{ after: "func withParam(", at: "LIMIT", nth: 1 }],
    rationale: "`DefName ← Parameter`（容器 FunctionDecl）。",
  },
  {
    name: "go：短变量声明 → 只点亮同函数体内的引用",
    language: "go",
    doc: GO_DOC,
    click: { after: "func withLocal() int {\n\t", at: "LIMIT" },
    hits: [{ after: "\tLIMIT := 1\n\treturn ", at: "LIMIT" }],
    rationale: "`DefName ← VarDecl`（容器 Block）。",
  },
  {
    name: "go：结构体字段名不亮（`FieldName ← FieldDecl`）",
    language: "go",
    doc: GO_DOC,
    click: { after: "type Holder struct {\n\t", at: "LIMIT" },
    hits: [],
    rationale: "字段与成员名一律排除。",
  },
  {
    name: "go：包名不亮（`DefName ← PackageClause`）",
    language: "go",
    doc: GO_EXCLUDE_DOC,
    click: { after: "package ", at: "LIMIT" },
    hits: [],
    rationale: "包名不是变量；不排除的话，包名与变量同名时会亮一片。",
  },
  {
    name: "go：导入名不亮（`DefName ← ImportSpec`）",
    language: "go",
    doc: GO_EXCLUDE_DOC,
    click: { after: "import ", at: "LIMIT" },
    hits: [],
    rationale: "导入名（含别名）一律排除。",
  },
  {
    name: "go：函数名不亮（`DefName ← FunctionDecl`）",
    language: "go",
    doc: GO_EXCLUDE_DOC,
    click: { after: "func ", at: "LIMIT" },
    hits: [],
    rationale: "函数名是排除位。",
  },
  {
    name: "go：类型名不亮（`DefName ← TypeSpec`）",
    language: "go",
    doc: GO_EXCLUDE_DOC,
    click: { after: "type ", at: "LIMIT" },
    hits: [],
    rationale: "类型名是排除位（同一行的 `struct{ LIMIT int }` 字段名同为排除位）。",
  },
  {
    name: "go：字符串里的同名文本不亮",
    language: "go",
    doc: GO_DOC,
    click: { after: 'var s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "go：正向对照",
    language: "go",
    doc: GO_EXCLUDE_DOC,
    click: { after: "var ", at: "LIMIT2" },
    hits: [{ after: "var LIMIT2 = 1\nvar use = ", at: "LIMIT2" }],
    rationale: "同一份语料里 `var LIMIT2 = 1` 与 `var use = LIMIT2` 互相点亮。",
  },
];

// --- java -------------------------------------------------------------------------------------

const JAVA_DOC = `// LIMIT 出现在注释里
class Holder {
  int LIMIT = 1;

  int withParam(int LIMIT) {
    return LIMIT;
  }

  int withLocal() {
    int LIMIT = 2;
    return LIMIT;
  }

  int member() {
    return this.LIMIT;
  }
}
`;

const JAVA_SHADOW_DOC = `// LIMIT 出现在注释里
class K {
  int m() {
    int LIMIT = 1;
    if (true) { int LIMIT = 2; return LIMIT; }
    return LIMIT;
  }
}
`;

const JAVA_EXCLUDE_DOC = `// LIMIT 出现在注释里
package LIMIT;

import java.util.LIMIT;

enum LIMIT { LIMIT }

class LIMIT {
  void LIMIT() { }

  int run() {
    String s = "LIMIT";
    int LIMIT2 = 1;
    return LIMIT2;
  }
}
`;

/**
 * java 的判据（实测）：
 * - 局部变量：`Definition ← VariableDeclarator ← LocalVariableDeclaration`（**祖父**是区分字段的关键）
 * - 参数：`Definition ← FormalParameter` ✓
 * - 引用：表达式里的 `Identifier` ✓
 * - 排除：字段 `Definition ← VariableDeclarator ← FieldDeclaration`、方法名 `Definition ←
 *   MethodDeclaration`、构造器名、类 / 接口 / 枚举 / 注解类型名 `Definition ← …Declaration`、
 *   枚举成员 `Definition ← EnumConstant`、成员名 `Identifier ← FieldAccess`、方法调用里的方法名
 *   `Identifier ← MethodName`、包名与 import 路径 `Identifier ← PackageDeclaration / ScopedIdentifier`。
 */
export const JAVA_CASES: readonly HighlightCase[] = [
  {
    name: "java：参数 → 只点亮同方法体内的引用",
    language: "java",
    doc: JAVA_DOC,
    click: { after: "int withParam(int ", at: "LIMIT" },
    hits: [{ after: "int withParam(int LIMIT) {\n    return ", at: "LIMIT" }],
    rationale: "`Definition ← FormalParameter`（容器 MethodDeclaration）。",
  },
  {
    name: "java：局部变量 → 只点亮同方法体内的引用",
    language: "java",
    doc: JAVA_DOC,
    click: { after: "int withLocal() {\n    int ", at: "LIMIT" },
    hits: [{ after: "    int LIMIT = 2;\n    return ", at: "LIMIT" }],
    rationale: "`Definition ← VariableDeclarator ← LocalVariableDeclaration`（容器 Block）。",
  },
  {
    name: "java：字段不亮（同一个 `Definition ← VariableDeclarator`，靠祖父分）",
    language: "java",
    doc: JAVA_DOC,
    click: { after: "class Holder {\n  int ", at: "LIMIT" },
    hits: [],
    rationale: "字段的祖父是 FieldDeclaration——同类节点、只差祖父，必须逐条写死（实测）。",
  },
  {
    name: "java：成员名 `this.LIMIT` 不亮（`Identifier ← FieldAccess`）",
    language: "java",
    doc: JAVA_DOC,
    click: { after: "return this.", at: "LIMIT" },
    hits: [],
    rationale: "成员名是排除位。",
  },
  {
    name: "java：包名不亮（`Identifier ← PackageDeclaration`）",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "package ", at: "LIMIT" },
    hits: [],
    rationale: "包名不是变量。",
  },
  {
    name: "java：import 路径名不亮（`Identifier ← ScopedIdentifier`）",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "import java.util.", at: "LIMIT" },
    hits: [],
    rationale: "导入名一律排除。",
  },
  {
    name: "java：枚举名不亮",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "enum ", at: "LIMIT" },
    hits: [],
    rationale: "`Definition ← EnumDeclaration`；成员是 `Definition ← EnumConstant`，同为排除位。",
  },
  {
    name: "java：类名不亮",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "class ", at: "LIMIT" },
    hits: [],
    rationale: "`Definition ← ClassDeclaration`；方法名 `Definition ← MethodDeclaration` 同为排除位。",
  },
  {
    name: "java：方法名不亮",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "void ", at: "LIMIT" },
    hits: [],
    rationale: "`Definition ← MethodDeclaration`。",
  },
  {
    name: "java：字符串里的同名文本不亮",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: 'String s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "java：内层块的同名局部声明把外层那组与它隔开（局部必须被认作声明位）",
    language: "java",
    doc: JAVA_SHADOW_DOC,
    click: { after: "  int m() {\n    int ", at: "LIMIT" },
    hits: [{ after: "if (true) { int LIMIT = 2; return LIMIT; }\n    return ", at: "LIMIT" }],
    rationale:
      "外层局部（容器 = 方法 Block）只点亮 `if` 之后那一处；内层块里的声明与它的 `return LIMIT` 各自成组 ⇒ 点外层时不亮它们（同一条「局部是声明位」的判据在 java 上的落点）。",
  },
  {
    name: "java：正向对照",
    language: "java",
    doc: JAVA_EXCLUDE_DOC,
    click: { after: "    int ", at: "LIMIT2" },
    hits: [{ after: "    int LIMIT2 = 1;\n    return ", at: "LIMIT2" }],
    rationale: "同一份语料里的局部变量与它的引用互相点亮。",
  },
];

// --- c / cpp ----------------------------------------------------------------------------------

const C_DOC = `// LIMIT 出现在注释里
const int LIMIT = 42;

int with_param(int LIMIT) { return LIMIT; }

int with_local(void) {
  int LIMIT = 1;
  return LIMIT;
}

struct Holder { int LIMIT; };

char *s = "LIMIT";
int t = LIMIT;
`;

const C_EXCLUDE_DOC = `// LIMIT 出现在注释里
int LIMIT(void) { return 1; }

struct LIMIT { int LIMIT; };

enum LIMIT { LIMIT };

int use(void) {
  int LIMIT2 = 1;
  return LIMIT2;
}
`;

const CPP_DOC = `// LIMIT 出现在注释里
const int LIMIT = 42;

int with_param(int LIMIT) { return LIMIT; }

int with_local() {
  int LIMIT = 1;
  return LIMIT;
}

class Holder {
public:
  int LIMIT;
  int m() { return LIMIT; }
};

const char *s = "LIMIT";
int t = LIMIT;

namespace LIMIT { int inner = 1; }
`;

/**
 * c / cpp 的判据（实测，两门共用一支）：
 * - 声明：`Identifier ← InitDeclarator`（**第一个** Identifier——`int a = b;` 的 `b` 是第二个，
 *   是引用）、`Identifier ← ParameterDeclaration`、`Identifier ← PointerDeclarator`
 * - 引用：表达式里的 `Identifier`
 * - 排除：函数名 `Identifier ← FunctionDeclarator`、类型名 `TypeIdentifier`、字段与字段访问
 *   `FieldIdentifier`、枚举成员 `Identifier ← Enumerator`、cpp 名字空间名
 *   `Identifier ← NamespaceDefinition`
 */
export const C_CASES: readonly HighlightCase[] = [
  {
    name: "c：顶层常量 → 只点亮未被隔断的引用",
    language: "c",
    doc: C_DOC,
    click: { after: "const int ", at: "LIMIT" },
    hits: [{ after: "int t = ", at: "LIMIT" }],
    rationale: "`Identifier ← InitDeclarator`（第一个 Identifier，容器 Program）；字段是 FieldIdentifier（排除），字符串不是标识符节点。",
  },
  {
    name: "c：参数 → 只点亮同函数体内的引用",
    language: "c",
    doc: C_DOC,
    click: { after: "int with_param(int ", at: "LIMIT" },
    hits: [{ after: "int with_param(int LIMIT) { return ", at: "LIMIT" }],
    rationale: "`Identifier ← ParameterDeclaration`（容器 FunctionDefinition）。",
  },
  {
    name: "c：局部变量（`InitDeclarator` 的第一个 Identifier）→ 只点亮同函数体内的引用",
    language: "c",
    doc: C_DOC,
    click: { after: "  int ", at: "LIMIT" },
    hits: [{ after: "  int LIMIT = 1;\n  return ", at: "LIMIT" }],
    rationale: "声明名是 InitDeclarator 的**第一个** Identifier（`int a = b;` 里的 b 是第二个 ⇒ 引用）。",
  },
  {
    name: "c：结构体字段名不亮（`FieldIdentifier`）",
    language: "c",
    doc: C_DOC,
    click: { after: "struct Holder { int ", at: "LIMIT" },
    hits: [],
    rationale: "字段一律排除。",
  },
  {
    name: "c：函数名不亮（`Identifier ← FunctionDeclarator`）",
    language: "c",
    doc: C_EXCLUDE_DOC,
    click: { after: "int ", at: "LIMIT" },
    hits: [],
    rationale: "函数名是排除位。",
  },
  {
    name: "c：结构体名不亮（`TypeIdentifier`）",
    language: "c",
    doc: C_EXCLUDE_DOC,
    click: { after: "struct ", at: "LIMIT" },
    hits: [],
    rationale: "类型名是排除位（同一行的字段名同为排除位）。",
  },
  {
    name: "c：枚举成员名不亮（`Identifier ← Enumerator`）",
    language: "c",
    doc: C_EXCLUDE_DOC,
    click: { after: "enum LIMIT { ", at: "LIMIT" },
    hits: [],
    rationale: "枚举成员是类型成员，与字段同一条排除口径（宁可漏）。",
  },
  {
    name: "c：字符串里的同名文本不亮",
    language: "c",
    doc: C_DOC,
    click: { after: 'char *s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "c：正向对照",
    language: "c",
    doc: C_EXCLUDE_DOC,
    click: { after: "  int ", at: "LIMIT2" },
    hits: [{ after: "  int LIMIT2 = 1;\n  return ", at: "LIMIT2" }],
    rationale: "同一份语料里的局部变量与它的引用互相点亮。",
  },
  {
    name: "cpp：类字段声明不亮，但类内**裸名引用**会与外层同名变量混组（已知边界的实测落点）",
    language: "cpp",
    doc: CPP_DOC,
    click: { after: "const int ", at: "LIMIT" },
    hits: [{ after: "int m() { return ", at: "LIMIT" }, { after: "int t = ", at: "LIMIT" }],
    rationale:
      "类字段不在变量类 ⇒ `int m() { return LIMIT; }` 里的裸名 LIMIT 没有可归属的声明，于是与外层常量同组（边界见 design §7：字段不纳入变量类）。`int LIMIT;` 的字段声明本身不亮。",
  },
  {
    name: "cpp：字符串里的同名文本不亮",
    language: "cpp",
    doc: CPP_DOC,
    click: { after: 'const char *s = "', at: "LIMIT" },
    hits: [],
    rationale: "字符串内容不是标识符类节点。",
  },
  {
    name: "cpp：名字空间名不亮（`Identifier ← NamespaceDefinition`）",
    language: "cpp",
    doc: CPP_DOC,
    click: { after: "namespace ", at: "LIMIT" },
    hits: [],
    rationale: "名字空间名不是变量。",
  },
  {
    name: "cpp：类内方法名不亮（类内函数名是 `FieldIdentifier`，不是 `Identifier`）",
    language: "cpp",
    doc: CPP_DOC,
    click: { after: "public:\n  int ", at: "m" },
    hits: [],
    rationale: "cpp 类内函数名是 `FieldIdentifier ← FunctionDeclarator`（顶层函数名才是 `Identifier`）——判据必须逐语言写死，不能靠「看起来差不多」。",
  },
];

/** 全部用例（断言与证据表都走这一份）。 */
export const HIGHLIGHT_CASES: readonly HighlightCase[] = [
  ...JS_CASES,
  ...PY_CASES,
  ...RUST_CASES,
  ...GO_CASES,
  ...JAVA_CASES,
  ...C_CASES,
];
