// 代码文件的结构解析与符号提取（M197，change code-outline；机制 = design §1.5 的 S2 双管线）。
//
// 为什么另起一条管线而不是换掉着色：S1 / S3 都要动「同一段代码长什么样」，会撞上
// editor-live-preview 的 parity 不变量（围栏与整文件打开同 tag 同配色）并牵动全量视觉基线。
// 本模块因此与 src/preview/code.ts **互不引用**：着色不看这棵树，结构不看 legacy token
// （design §1.5 纪律 3——两棵树 MUST NOT 互相校验、MUST NOT 混用）。代价是同一份文本被两套词法
// 各读一遍，换来着色 / parity / 基线 / 既有断言零改动。
//
// 语言分层（两条判据，design §1.2）：① 有官方 @lezer 语法；② 该语法在普通代码上无阻断性缺陷。
// 逐门落位与实测依据见 STRUCTURE_SUPPORT 的注释与 change 的 evidence/01。**不支持的语言没有大纲，
// 也不做任何文本级降级**（正则 / 缩进 / 关键字扫描一律禁止）。
//
// 惰性（proposal 裁决点 7）：解析只在 structureEntries 被显式调用时发生。打开文件与光标路径走
// peekStructureEntries——只读缓存，**不解析**。code 模式只读（M130 方向 A），因此「语言 + 文档原文」
// 可以当缓存键：文档在打开期间不会变，换文件 / 外部重载 / 切标签都会带来新的键（design §1.6）。

import { parser as javascriptParser } from "@lezer/javascript";
import { parser as pythonParser } from "@lezer/python";
import { parser as rustParser } from "@lezer/rust";
import { parser as goParser } from "@lezer/go";
import { parser as cppParser } from "@lezer/cpp";
import { parser as javaParser } from "@lezer/java";
import { parser as cssParser } from "@lezer/css";
import { parser as sassParser } from "@lezer/sass";
// 类型唯一来源是 preview/attachments.ts 的扩展名注册表（`Record<CodeLanguage, …>` 在这里做
// 编译期穷尽检查）。type-only import 在编译与 node 的类型剥离下都被完全擦除，因此本模块不依赖
// 附件 / 编辑器侧的运行期代码，可以直接在 tests/unit 里跑。
import type { CodeLanguage } from "./preview/attachments";

/** 条目类别（**内部模型，界面不显示类别标签**——md 大纲也只显示文本与缩进）。 */
export type EntryCategory =
  | "function"
  | "method"
  | "constructor"
  | "field"
  | "constant"
  | "class"
  | "interface"
  | "enum"
  | "struct"
  | "trait"
  | "type"
  | "impl"
  | "rule"
  | "variable";

/** 一条大纲条目。`from` 是**声明起点**（前导缩进不在节点范围内）——code 的跳转落点就是它。 */
export interface StructureEntry {
  category: EntryCategory;
  /** 条目文本（名字节点原文，或无名结构节点的起始行原文）。 */
  text: string;
  /** 声明节点在文档里的起点。 */
  from: number;
  /** 声明节点在文档里的终点（不含尾随空白与换行）。**消费者是 `tests/unit/code-structure.test.ts`
   *  的跨度断言**——它把「`doc.slice(from, to)` = 声明节点原文」钉成合同（声明范围是后续 mission
   *  〈变量高亮〉要吃的东西）；跳转不用它（落点是 `from`），因此这里不写「供去重」那类没有消费者的说法。 */
  to: number;
  /** 1 基行号。 */
  line: number;
  /** 语法嵌套深度 = 条目父链上的条目级容器数（MUST NOT 按类别赋层级）。 */
  depth: number;
}

/**
 * 名字取值口径（design §2.2；逐语言差异都是实测出来的，猜必错）。每个变体都至少有一门语言在消费，
 * 且都是为了一条实测出来的形态差异：
 * - `child` / `descendant`：绝大多数语言（直接子节点 / 藏在 Spec、Declarator 里一层）。
 * - `firstChild`：**判定用的位置判据**——scss 的 `$变量`声明与属性声明同为 `Declaration`，前者首个子
 *   节点是 SassVariableName、后者是 PropertyName（`padding: $local` 的 `$local` 也是直接子节点，
 *   只能靠「是不是第一个」分辨）。
 * - `eachChild` / `eachGrandchild`：一个声明节点带多个名字时**逐个成条目**（go 的 `var (…)` /
 *   `var a, b = 1, 2`、java 的 `int a, b;`）——只取第一个会静默丢掉其余符号。
 */
type NameRule =
  /** 文档序第一个**直接子节点**（名字 ∈ names）。 */
  | { at: "child"; names: readonly string[] }
  /** 文档序第一个**后代节点**（名字 ∈ names）。 */
  | { at: "descendant"; names: readonly string[] }
  /** **首个子节点**必须 ∈ names（位置判据，见上）。 */
  | { at: "firstChild"; names: readonly string[] }
  /** 每个直接子节点（名字 ∈ names）各成一条。 */
  | { at: "eachChild"; names: readonly string[] }
  /** 每个直接子节点名为 via 的，取其第一个直接子节点（名字 ∈ names）各成一条。 */
  | { at: "eachGrandchild"; via: string; names: readonly string[] }
  /** 该条目起始行的原文（去行首缩进、去行尾 `{` 与尾随空白）——无名结构节点用（rust impl 块）。 */
  | { at: "line" }
  /** 选择器部分（到 Block 子节点之前）——css / scss 的规则集用。 */
  | { at: "selector" };

/** 同名节点的细分判据（c/cpp 的 Declaration 既可能是函数声明，也可能是变量 / 常量声明）。 */
interface RuleGuard {
  has?: readonly string[];
  lacks?: readonly string[];
}

interface EntryRule {
  node: string;
  category: EntryCategory;
  name: NameRule;
  /** none = 不下潜（函数体因此天然不产生条目）；container = 子树里的条目深一级。 */
  descend: "none" | "container";
  /** 容器内类别为 function 的条目升格为 method（类 / impl 块 / trait 的成员）。 */
  membersAre?: "method";
  /** 只在顶层（没有任何条目级容器祖先）成立——python 的顶层赋值靠它排除类体赋值。 */
  topLevelOnly?: boolean;
  guard?: RuleGuard;
}

/** 没有名字节点的结构节点（rust impl 块）与规则集（css / scss）——见 design §2.2。 */
const asLine = { at: "line" } as const satisfies NameRule;
const asSelector = { at: "selector" } as const satisfies NameRule;
const child = (...names: string[]): NameRule => ({ at: "child", names });
const descendant = (...names: string[]): NameRule => ({ at: "descendant", names });
const firstChild = (...names: string[]): NameRule => ({ at: "firstChild", names });
const eachChild = (...names: string[]): NameRule => ({ at: "eachChild", names });

// --- 逐语言条目规则 ---------------------------------------------------------------------------
// 条目覆盖逐语言与 openspec/changes/code-outline/specs/toc-outline/spec.md 的「代码文件的符号大纲」
// 一一对应：**规则表里没有的节点不进大纲**。局部变量 / 参数 / 表达式引用 / 导入语句都靠这条排除——
// 它们要么落在 descend: "none" 的函数体里，要么根本没有对应规则。

/** javascript / typescript 共用的一支（ts 在其上追加接口 / 类型别名 / 枚举）。 */
const JS_RULES: readonly EntryRule[] = [
  // 顶层变量与常量（`const` / `let` / `var`）。名字是 VariableDefinition，不是 PropertyDefinition。
  { node: "VariableDeclaration", category: "constant", name: child("VariableDefinition"), descend: "none" },
  { node: "FunctionDeclaration", category: "function", name: child("VariableDefinition"), descend: "none" },
  {
    node: "ClassDeclaration",
    category: "class",
    name: child("VariableDefinition"),
    descend: "container",
    membersAre: "method",
  },
  // 类成员：方法名与字段名都是 PropertyDefinition（js 与 ts 同形，实测见 evidence/01 §3）。
  // 构造器在 js/ts 语法里就是 MethodDeclaration（名字恰为 `constructor`）——delta 的类别表只给 java
  // 列了 constructor，故这里仍是 method。
  { node: "MethodDeclaration", category: "method", name: child("PropertyDefinition"), descend: "none" },
  { node: "PropertyDeclaration", category: "field", name: child("PropertyDefinition"), descend: "none" },
];

const TS_RULES: readonly EntryRule[] = [
  ...JS_RULES,
  { node: "InterfaceDeclaration", category: "interface", name: child("TypeDefinition"), descend: "none" },
  { node: "TypeAliasDeclaration", category: "type", name: child("TypeDefinition"), descend: "none" },
  { node: "EnumDeclaration", category: "enum", name: child("TypeDefinition"), descend: "none" },
  // `declare function f(): void;`——声明式函数，与普通函数同档。
  { node: "AmbientFunctionDeclaration", category: "function", name: child("VariableDefinition"), descend: "none" },
];

const PY_RULES: readonly EntryRule[] = [
  // 类 / 函数的名字都是 VariableName（与引用同名）→ 只能取**直接子节点**里的那一个：
  // ClassDefinition = [class, VariableName, (ArgList), Body]，FunctionDefinition = [def, VariableName, …]。
  {
    node: "ClassDefinition",
    category: "class",
    name: child("VariableName"),
    descend: "container",
    membersAre: "method",
  },
  { node: "FunctionDefinition", category: "function", name: child("VariableName"), descend: "none" },
  // 顶层赋值（模块级常量）。类体里的赋值由 topLevelOnly 排除（spec 写的是「顶级赋值」）。
  { node: "AssignStatement", category: "constant", name: child("VariableName"), descend: "none", topLevelOnly: true },
];

const RUST_RULES: readonly EntryRule[] = [
  { node: "ConstItem", category: "constant", name: child("BoundIdentifier"), descend: "none" },
  { node: "StaticItem", category: "constant", name: child("BoundIdentifier"), descend: "none" },
  { node: "TypeItem", category: "type", name: child("TypeIdentifier"), descend: "none" },
  { node: "EnumItem", category: "enum", name: child("TypeIdentifier"), descend: "none" },
  { node: "TraitItem", category: "trait", name: child("TypeIdentifier"), descend: "container" },
  { node: "StructItem", category: "struct", name: child("TypeIdentifier"), descend: "container" },
  // impl 块没有名字子节点（`impl Util` 与 `impl Display for Util` 的子节点形态还不一样）→ 起始行原文。
  { node: "ImplItem", category: "impl", name: asLine, descend: "container", membersAre: "method" },
  { node: "FunctionItem", category: "function", name: child("BoundIdentifier"), descend: "none" },
  { node: "FieldDeclaration", category: "field", name: child("FieldIdentifier"), descend: "none" },
];

const GO_RULES: readonly EntryRule[] = [
  // go 的名字在 Spec 节点上（`const Limit = 42` 的 ConstSpec、分组声明里的每个 VarSpec / TypeSpec），
  // 因此**以 Spec 为条目节点**：`var (A = 1; B = 2;)` 与 `var a, b = 1, 2` 都会逐名成条
  // （以 Decl 为条目节点只取得到第一个名字，其余静默丢失）。落点即该 spec 的起点（名字处）。
  { node: "ConstSpec", category: "constant", name: eachChild("DefName"), descend: "none" },
  { node: "VarSpec", category: "constant", name: eachChild("DefName"), descend: "none" },
  { node: "TypeSpec", category: "type", name: eachChild("DefName"), descend: "none" },
  { node: "FunctionDecl", category: "function", name: descendant("DefName"), descend: "none" },
  // 方法名是 FieldName（接收者那对括号里的形参是 DefName，不会撞上）。
  { node: "MethodDecl", category: "method", name: descendant("FieldName"), descend: "none" },
];

/** c 与 cpp 共用的一支（cpp 追加 ClassSpecifier）。 */
const C_RULES: readonly EntryRule[] = [
  // 函数定义：名字在 FunctionDeclarator 里（顶层是 Identifier，cpp 类内是 FieldIdentifier）；
  // 返回类型是 PrimitiveType / TypeIdentifier，取「第一个 Identifier」不会取错（实测见 evidence/01 §3）。
  {
    node: "FunctionDefinition",
    category: "function",
    name: descendant("Identifier", "FieldIdentifier"),
    descend: "none",
  },
  // 函数原型（`int f(int);`）：Declaration 带 FunctionDeclarator；没有它的 Declaration 才是变量 / 常量。
  {
    node: "Declaration",
    category: "function",
    name: descendant("Identifier", "FieldIdentifier"),
    descend: "none",
    guard: { has: ["FunctionDeclarator"] },
  },
  {
    node: "Declaration",
    category: "constant",
    name: descendant("Identifier", "FieldIdentifier"),
    descend: "none",
    guard: { lacks: ["FunctionDeclarator"] },
  },
  { node: "StructSpecifier", category: "struct", name: child("TypeIdentifier"), descend: "container" },
  { node: "FieldDeclaration", category: "field", name: child("FieldIdentifier"), descend: "none" },
];

const CPP_RULES: readonly EntryRule[] = [
  ...C_RULES,
  // 类内方法的名字是 FieldIdentifier（顶层函数是 Identifier），由同一条 name 规则覆盖；类体里的
  // FunctionDefinition 因此升格为 method（membersAre）。
  {
    node: "ClassSpecifier",
    category: "class",
    name: child("TypeIdentifier"),
    descend: "container",
    membersAre: "method",
  },
];

const JAVA_RULES: readonly EntryRule[] = [
  // java 的声明名与引用名同为 Definition：类 / 接口 / 枚举 / 方法 / 构造器都取**文档序第一个
  // Definition**。方法的返回类型是 TypeName（排在名字前面，不是 Definition），形参在 FormalParameters
  // 子节点里（不是直接子节点）——两条实测差异都记在 evidence/01 §3。
  {
    node: "ClassDeclaration",
    category: "class",
    name: descendant("Definition"),
    descend: "container",
    membersAre: "method",
  },
  { node: "InterfaceDeclaration", category: "interface", name: descendant("Definition"), descend: "container" },
  { node: "EnumDeclaration", category: "enum", name: descendant("Definition"), descend: "none" },
  { node: "MethodDeclaration", category: "method", name: descendant("Definition"), descend: "none" },
  { node: "ConstructorDeclaration", category: "constructor", name: descendant("Definition"), descend: "none" },
  // 字段名藏在 VariableDeclarator 里（直接子节点是类型与声明符）：`int a, b;` 因此逐个成条。
  // 副作用是字段条目的落点是声明符起点（名字处）而不是 `private` 这样的修饰符处——对符号大纲而言
  // 更靠近要看的名字，且 `int a, b;` 不再丢 b。
  {
    node: "FieldDeclaration",
    category: "field",
    name: { at: "eachGrandchild", via: "VariableDeclarator", names: ["Definition"] },
    descend: "none",
  },
];

/** css 的条目 = 规则集（选择器原文）；属性声明不是符号，不进大纲。 */
const CSS_RULES: readonly EntryRule[] = [
  { node: "RuleSet", category: "rule", name: asSelector, descend: "container" },
];

/**
 * scss 的条目 = 规则集 + `$变量`声明。
 * `$变量`判据 = **首个子节点是 SassVariableName**：`$local: 1px` 是它，而属性声明
 * （`padding: $local`）的首个子节点是 PropertyName——`$local` 在那里也是 Declaration 的直接子节点
 * （值位置），只按「有这个名字的子节点」判会多出一条重复条目（M197 实测踩到过）。
 */
const SCSS_RULES: readonly EntryRule[] = [
  { node: "RuleSet", category: "rule", name: asSelector, descend: "container" },
  { node: "Declaration", category: "variable", name: firstChild("SassVariableName"), descend: "none" },
];

// --- 语言分层注册表（单一来源）----------------------------------------------------------------

type Parser = ReturnType<typeof javascriptParser.configure>;

/**
 * 解析树与它的游标类型（从 parser 推导，避免直接依赖 `@lezer/common` 的包边——同 M197 的既有
 * 口径）。**导出**是因为 M198 的标识符索引也要在树上走一遍，而它 MUST NOT 自己再解析一次
 *（design §4.1：本 change 只读消费本模块的解析与缓存）。
 */
export type StructureTree = ReturnType<Parser["parse"]>;
export type StructureCursor = ReturnType<StructureTree["cursor"]>;

interface StructureSupport {
  /** symbols = 符号大纲（T1）；rules = 结构大纲、条目是规则集（T2）。 */
  tier: "symbols" | "rules";
  parser: Parser;
  rules: readonly EntryRule[];
}

const typescriptParser: Parser = javascriptParser.configure({ dialect: "ts" });

/**
 * 语言 → 结构支持（null = 不支持，T3）。`Record<CodeLanguage, …>` 是**编译期穷尽检查**：既有语言表
 * 新增语言而此处漏登记、或此处多出无人引用的键，编译都会失败（与 preview/code.ts 的 LANGUAGES 同一纪律）。
 *
 * 逐门判据（design §1.2 两条 + §1.3 的逐门理由，实测见 evidence/01）：
 * - T1 符号大纲 8 门：javascript / typescript（@lezer/javascript，ts 走 dialect）、python、rust、go、
 *   java 各有官方语法；c / cpp 共用 @lezer/cpp（c 是其子集）。
 * - T2 结构大纲 2 门：css（@lezer/css）、scss（@lezer/sass）——条目是规则集，不是符号。
 * - T3 不支持 11 门，逐门理由：
 *   ruby / swift / kotlin / lua —— 只有社区单维护者包（判据 1 排除；lua 的另一候选还依赖已废弃的
 *   `lezer` 包）；shell —— 社区包 @fig/lezer-bash 停更 2 年+ 且在普通 bash 上产出 11 个 error 节点
 *   （判据 1 + 2 都不过）；toml —— 社区包 4 年未更新；sql —— 官方包但语法不产出声明节点（判据 2）；
 *   yaml —— 官方语法有位置缺陷（判据 2；复现读数见 test-results/m197/yaml-defect.txt）；json / html /
 *   xml —— 语法可用，但「条目文本口径」尚未裁定（键与元素名重复度太高，列表里分不出目标）——那是产品
 *   决定，本 change 不替它做，也不做半套。
 * 另：php 不在 CodeLanguage 里（注册表标 null → 纯文本），因此本表无需为它留位；把 php 接上属于
 * 「扩语言覆盖」，另立 change（proposal 裁决点 5）。
 */
export const STRUCTURE_SUPPORT: Record<CodeLanguage, StructureSupport | null> = {
  javascript: { tier: "symbols", parser: javascriptParser, rules: JS_RULES },
  typescript: { tier: "symbols", parser: typescriptParser, rules: TS_RULES },
  python: { tier: "symbols", parser: pythonParser, rules: PY_RULES },
  rust: { tier: "symbols", parser: rustParser, rules: RUST_RULES },
  go: { tier: "symbols", parser: goParser, rules: GO_RULES },
  c: { tier: "symbols", parser: cppParser, rules: C_RULES },
  cpp: { tier: "symbols", parser: cppParser, rules: CPP_RULES },
  java: { tier: "symbols", parser: javaParser, rules: JAVA_RULES },
  css: { tier: "rules", parser: cssParser, rules: CSS_RULES },
  scss: { tier: "rules", parser: sassParser, rules: SCSS_RULES },
  ruby: null,
  shell: null,
  toml: null,
  yaml: null,
  json: null,
  html: null,
  xml: null,
  swift: null,
  kotlin: null,
  lua: null,
  sql: null,
};

/** 该语言是否有可用的结构解析（T3 语言与「无语言包」都返回 false）。 */
export function supportsStructure(language: CodeLanguage | null): boolean {
  return language !== null && STRUCTURE_SUPPORT[language] !== null;
}

// --- 解析与缓存 --------------------------------------------------------------------------------

const EMPTY: readonly StructureEntry[] = [];
/** 缓存条数上限（与 preview/code.ts 的着色缓存同量级）：超出即整体清空，不做 LRU。 */
const CACHE_LIMIT = 32;

/** 「语言 + 文档原文」→ 条目表。code 模式只读，故内容即身份（design §1.6）。 */
const cache = new Map<string, readonly StructureEntry[]>();
let parseCount = 0;
let keyBuildCount = 0;

const cacheKey = (language: CodeLanguage, text: string): string => `${language}\u0000${text}`;

/**
 * 上一次查询的现场。**同一个 (语言, 原文) 上重复问时不重建键**——指示段的节流同步每 120ms 问一次
 * 同一份文档，而键是整篇原文：不记忆的话每次同步都要拼一个文档长度的字符串并把它哈希一遍
 * （1MB 文档 ~1MB 分配 + O(n)，14MB 的压缩 bundle 同比例放大；都不违反性能合同的字面，但完全是
 * 可避免的）。`text` 是 string 原始值，`===` 比一层即可：同一个 `Text` 对象取出的串在 toc 侧
 * 有记忆（`Toc.fullText()`），传进来的是同一个字符串对象。
 *
 * `entries: null` 是「这份文档已知没有缓存结果」——**未命中也要记住**：用户可能打开一个代码文件却
 * 从不按 `⌘⇧O`，那种形态下每一次节流同步都是未命中。缓存的唯一写入口是 `remember()`（解析路径），
 * 因此这条记忆不会被绕过而陈旧；`cache.clear()` 也只发生在 `remember()` 之前。
 *
 * 冷路径（首次解析）的 `cache.set` 会自己再建一次键——每文档一次，不为它把接口复杂化。
 */
let lastLookup: { language: CodeLanguage; text: string; entries: readonly StructureEntry[] | null } | null = null;

/**
 * 「最近一次解析」的单槽现场——**两条消费者（符号大纲 / 标识符索引）共享同一棵树**的落点。
 * 为什么要有它：M198 的变量高亮要的是树，大纲要的是条目，两者若各自 `parser.parse()` 一次，
 * 同一份文档就要被两套词法读两遍（用户「先 ⌘⇧O 再双击」或反过来的顺序都会踩到）。
 * 单槽而不是容量 32：树是**大对象**（1MB 文档约 40 万节点），entries / 索引才是按文档缓存的派生
 * 数据；保留一棵树的代价可测（见 M198 的 perf 读数），保留 32 棵不可接受。
 * 键含文档原文，因此同键复用永远安全（树不可变；code 模式只读，原文即身份）。
 */
let lastParse: { language: CodeLanguage; text: string; tree: StructureTree } | null = null;

/** 查缓存（含上一次现场的快路径）；未命中返回 null。**不解析**。 */
function cachedEntries(language: CodeLanguage, text: string): readonly StructureEntry[] | null {
  if (lastLookup !== null && lastLookup.language === language && lastLookup.text === text) return lastLookup.entries;
  keyBuildCount += 1;
  const entries = cache.get(cacheKey(language, text)) ?? null;
  lastLookup = { language, text, entries };
  return entries;
}

/** 把 (语言, 原文) → 条目表记进缓存与「上一次现场」。 */
function remember(language: CodeLanguage, text: string, entries: readonly StructureEntry[]): void {
  cache.set(cacheKey(language, text), entries);
  lastLookup = { language, text, entries };
}

/**
 * 已解析的条目（**只看缓存，不解析**）——指示段的节流同步走这一条：光标 / 滚动路径上
 * MUST NOT 触发解析（proposal 裁决点 7）。
 * 返回 null 的两种情形（都让指示段隐藏）：不支持该语言（永远不会有结果）；该文档尚未解析。
 */
export function peekStructureEntries(language: CodeLanguage | null, text: string): readonly StructureEntry[] | null {
  if (language === null || STRUCTURE_SUPPORT[language] === null) return null;
  return cachedEntries(language, text);
}

/**
 * 取条目（**首次需要结构时**才解析一次并缓存）。这是本模块的两个解析入口之一（另一个是
 * structureTree，两者共享同一棵树与同一份缓存——M198 的标识符索引走后者）。不支持的语言返回空表，
 * MUST NOT 降级为文本近似。
 */
export function structureEntries(language: CodeLanguage, text: string): readonly StructureEntry[] {
  const support = STRUCTURE_SUPPORT[language];
  if (support === null) return EMPTY;
  const cached = cachedEntries(language, text);
  if (cached !== null) return cached;
  const tree = structureTree(language, text);
  // structureTree 的返回值只为 null 在「不支持该语言」时出现，而那种情形上面已经返回。
  const entries = collectEntries(support, tree as StructureTree, text);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  remember(language, text, entries);
  return entries;
}

/**
 * 取解析树（**首次需要结构时**才解析一次）。两条消费者共用它：符号大纲（structureEntries 内部
 * 也走这里）与 M198 的标识符索引。同一份 (语言, 原文) 上重复调用不重复解析——这是
 * 「先 ⌘⇧O 再双击」与「先双击再 ⌘⇧O」都只解析一次的实现落点（断言见
 * `tests/unit/code-identifiers.test.ts`）。不支持的语言返回 null。
 */
export function structureTree(language: CodeLanguage, text: string): StructureTree | null {
  const support = STRUCTURE_SUPPORT[language];
  if (support === null) return null;
  if (lastParse !== null && lastParse.language === language && lastParse.text === text) return lastParse.tree;
  parseCount += 1;
  const tree = support.parser.parse(text);
  lastParse = { language, text, tree };
  return tree;
}

/**
 * 累计发生的解析次数。**唯一的消费者是测试**（`tests/unit/code-structure.test.ts` 与视觉场景的反向
 * 验证）：它把「惰性与缓存真的成立」变成可复算的读数。产品代码不读它，界面上也没有它的出口。
 */
export function structureParseCount(): number {
  return parseCount;
}

/**
 * 累计进缓存查找（= 建过缓存键）的次数。**唯一的消费者是测试**：它把「同一份文档重复问不重建键」
 * 这条可避免的 O(doc) 分配钉成断言（`cachedEntries` 的快路径命中时计数不动）。
 */
export function structureKeyBuildCount(): number {
  return keyBuildCount;
}

// --- 提取 ------------------------------------------------------------------------------------

interface Span {
  from: number;
  to: number;
}

const lineStarts = (text: string): number[] => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
};

/** 1 基行号（二分；starts 按升序）。 */
function lineOf(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 起始行原文：去行首缩进、去行尾 `{` 与尾随空白（design §2.2 的无名条目口径）。 */
function lineText(text: string, from: number, to: number): string {
  const newline = text.indexOf("\n", from);
  const stop = newline === -1 || newline > to ? to : newline;
  return text
    .slice(from, stop)
    .trim()
    .replace(/\{\s*$/, "")
    .trim();
}

/** 先序遍历 cursor 覆盖的子树；visitor 返回 true 即中止。cursor 位置始终复原。 */
function scanSubtree(cursor: StructureCursor, visitor: (name: string, from: number, to: number) => boolean): boolean {
  if (!cursor.firstChild()) return false;
  let stopped = false;
  do {
    if (visitor(cursor.name, cursor.from, cursor.to) || scanSubtree(cursor, visitor)) {
      stopped = true;
      break;
    }
  } while (cursor.nextSibling());
  cursor.parent();
  return stopped;
}

/** 直接子节点里名字 ∈ names 的范围（`onlyFirst` 为真时只看首个子节点——位置判据）。 */
function childSpans(cursor: StructureCursor, names: readonly string[], onlyFirst: boolean): Span[] {
  if (!cursor.firstChild()) return [];
  const spans: Span[] = [];
  do {
    if (names.includes(cursor.name)) {
      spans.push({ from: cursor.from, to: cursor.to });
      if (onlyFirst) break;
    } else if (onlyFirst) break;
  } while (cursor.nextSibling());
  cursor.parent();
  return spans;
}

/** 文档序第一个后代节点的范围（名字 ∈ names）。 */
function firstDescendantSpan(cursor: StructureCursor, names: readonly string[]): Span | null {
  let found: Span | null = null;
  scanSubtree(cursor, (name, from, to) => {
    if (!names.includes(name)) return false;
    found = { from, to };
    return true;
  });
  return found;
}

const hasDescendant = (cursor: StructureCursor, names: readonly string[]): boolean =>
  firstDescendantSpan(cursor, names) !== null;

function guardPasses(guard: RuleGuard | undefined, cursor: StructureCursor): boolean {
  if (guard === undefined) return true;
  if (guard.has !== undefined && !hasDescendant(cursor, guard.has)) return false;
  return !(guard.lacks !== undefined && hasDescendant(cursor, guard.lacks));
}

/**
 * 条目文本与落点。取不到名字返回空表（该节点**不成条目**）——scss 的属性声明靠这条出局。
 * 单值口径的落点是声明节点起点（cursor.from）；逐名口径的落点是名字自身（`eachChild` /
 * `eachGrandchild`：一个声明带多个名字时，落点必须落在各自的名字上，否则多条条目共享同一个起点，
 * 当前位置归属会选错那一条）。
 */
function resolveEntries(rule: EntryRule, cursor: StructureCursor, text: string): { from: number; to: number; text: string }[] {
  const own = { from: cursor.from, to: cursor.to };
  const emit = (span: Span): { from: number; to: number; text: string }[] => [
    { from: own.from, to: own.to, text: text.slice(span.from, span.to) },
  ];
  switch (rule.name.at) {
    case "child": {
      const span = childSpans(cursor, rule.name.names, false)[0];
      return span === undefined ? [] : emit(span);
    }
    case "firstChild": {
      const span = childSpans(cursor, rule.name.names, true)[0];
      return span === undefined ? [] : emit(span);
    }
    case "descendant": {
      const span = firstDescendantSpan(cursor, rule.name.names);
      return span === null ? [] : emit(span);
    }
    case "eachChild":
      return childSpans(cursor, rule.name.names, false).map((span) => ({
        from: span.from,
        to: span.to,
        text: text.slice(span.from, span.to),
      }));
    case "eachGrandchild": {
      const result: { from: number; to: number; text: string }[] = [];
      if (!cursor.firstChild()) return result;
      do {
        if (cursor.name !== rule.name.via) continue;
        const span = childSpans(cursor, rule.name.names, false)[0];
        if (span !== undefined) result.push({ from: span.from, to: span.to, text: text.slice(span.from, span.to) });
      } while (cursor.nextSibling());
      cursor.parent();
      return result;
    }
    case "line":
      return [{ ...own, text: lineText(text, cursor.from, cursor.to) }];
    case "selector": {
      const block = childSpans(cursor, ["Block"], false)[0];
      if (block === undefined) return [{ ...own, text: lineText(text, cursor.from, cursor.to) }];
      // 选择器部分：条目起点到 Block 之前（不把 `{` 与同行声明带进来）。
      return [{ ...own, text: text.slice(cursor.from, block.from).replace(/[\s,]+$/, "") }];
    }
  }
}

function collectEntries(support: StructureSupport, tree: StructureTree, text: string): readonly StructureEntry[] {
  const entries: StructureEntry[] = [];
  const starts = lineStarts(text);
  const cursor = tree.cursor();

  const visit = (depth: number, methodScope: boolean): void => {
    const rule = support.rules.find(
      (candidate) => candidate.node === cursor.name && guardPasses(candidate.guard, cursor),
    );
    if (rule === undefined) {
      // 规则表里没有的节点是**透明**的：继续下潜，但不改变深度（ClassBody / Body / DeclarationList …
      // 这些语法容器不是条目，却也 MUST NOT 挡住其下的条目）。
      if (cursor.firstChild()) {
        do visit(depth, methodScope);
        while (cursor.nextSibling());
        cursor.parent();
      }
      return;
    }
    // 顶层限定：python 的类体赋值由它排除（spec 写的是「顶级赋值」）。
    if (rule.topLevelOnly === true && depth > 0) return;
    for (const resolved of resolveEntries(rule, cursor, text)) {
      if (resolved.text.length === 0) continue;
      entries.push({
        category: methodScope && rule.category === "function" ? "method" : rule.category,
        text: resolved.text,
        from: resolved.from,
        to: resolved.to,
        line: lineOf(starts, resolved.from),
        depth,
      });
    }
    // descend: "none" 的条目不下潜——函数体 / 类字段 / 规则集的声明块因此天然不产生任何条目
    // （局部变量、参数、属性声明都靠这条排除）。
    if (rule.descend === "none" || !cursor.firstChild()) return;
    const childMethodScope = rule.membersAre === "method" ? true : methodScope;
    do visit(depth + 1, childMethodScope);
    while (cursor.nextSibling());
    cursor.parent();
  };

  visit(0, false);
  return entries;
}

// --- 当前位置归属与条目链（md 与 code 共用的同一份算法）----------------------------------------
//
// 这两个函数与语言无关：`level` 是「层级量」（code 是语法嵌套深度，md 是标题层级 1–6），`from` 是
// 条目起点。md 的标题链与 code 的符号链是**同一个语义**（同级或更浅的条目各自另起一段，链上只留
// 祖先），因此只有一份实现、两条来源共用——REVIEW.md 第 8 条（同一语义不留两处真源）。
//
// 放在本模块而不是 src/toc.ts：toc.ts 的依赖链里有 DOM 侧模块（frontmatter → 渲染 widget），
// 进不了 tests/unit 那一层；这两条判据（当前位置归属 + 祖先链）是单测能覆盖的纯逻辑。

/** 大纲条目的最小形状：md 的标题与 code 的符号都满足它。 */
export interface OutlineItemLike {
  /** 层级量（code = 语法嵌套深度、md = 标题层级）。 */
  level: number;
  /** 条目起点（文档偏移）。 */
  from: number;
}

/** 包含 pos 的条目下标（最后一个 `from <= pos` 的条目）；pos 在首个条目前时返回 -1。 */
export function itemIndexAt<T extends OutlineItemLike>(items: readonly T[], pos: number): number {
  let index = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].from > pos) break;
    index = i;
  }
  return index;
}

/**
 * 该条目的祖先链（含自身）：从当前项往回走，逐级取「层级比当前更浅的最后一条」——文档序保证祖先
 * 在前，因此这与 md 原先的标题栈算法等价（栈的不变量正是「父级是前面最后一个更浅的条目」）。
 */
export function itemPath<T extends OutlineItemLike>(items: readonly T[], index: number): readonly T[] {
  if (index < 0) return [];
  const path: T[] = [];
  let level = Number.POSITIVE_INFINITY;
  for (let i = index; i >= 0; i--) {
    if (items[i].level < level) {
      level = items[i].level;
      path.unshift(items[i]);
      if (level === 0) break;
    }
  }
  return path;
}
