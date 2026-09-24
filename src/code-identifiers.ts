// 代码文件里的「同一变量」判定与双击高亮（M198，change code-variable-highlight）。
//
// ## 判据全部落在结构解析树上
//
// 用户的原话是「不是字符匹配，要语法上的变量」。因此本模块里**没有一条以文档字符串 / 正则 /
// 选区文本为判据的匹配路径**：出现位置来自 `src/code-structure.ts` 的 lezer 树（节点名 + 父链），
// 匹配用的是**节点原文**（不是选区文本），字符串与注释里的同名词之所以进不来，靠的是「节点类别」
// 这一层（它们落在 String / LineComment / Comment 一类节点里，不在标识符类节点集合内）。
//
// ## 三层判据与一条等价改写
//
// spec 的三层是：① 位置类别（源与候选都落在「变量类位置」）② 名字逐字节相同 ③ 可见域
// （不被更内层的同名声明隔开、方向合理）。三层里最难实现的是 ③ 的**方向判定**——design §3.3 把它
// 写成「从候选向外走到源的容器（不含源容器）的每一层都不含同名声明」，那个写法在「候选在源之外」
// 的一侧没有定义（design §3.3 的场景表却要求「函数内两条互相点亮、顶层那条不亮」，双向都成立）。
//
// 本实现把 ③ 改写成一条**等价的、双向都定义好的**判据：**归属声明相同**。
//
//   owner(出现) = 自身（若它是声明位）／从它的位置向外找**作用域跨度最小**的同名「声明类位置」；
//                 找不到 → null（文件级自由名）。
//   点亮条件    = 名字相同 ∧ 两处都是变量类位置 ∧ owner(候选) === owner(源)。
//
// 逐条核过 design §3.3 的场景表（断言在 `tests/unit/code-identifiers.test.ts`）：顶层声明 + 函数内
// 引用（无同名局部）都亮；函数内有同名局部时「函数内两条互相点亮、顶层那条不亮」（双向）；
// 两个函数的同名局部互不点亮；外层参数与内层嵌套引用都亮；自由名引用按同一 owner（null）分组、
// 被局部声明隔断的那些不亮。差别只在**更保守的一侧**：`if (a) { let y = 1 }` 之后在块外引用 `y`
// 时本实现不亮（design 的容器写法会亮）——「宁可漏、不可错」的方向，spec 只把这三条写成 MUST NOT
// 过亮的约束，因此这个更严的落点是合规的。
//
// ## 保守方向（tie-break）的两个唯一入口
//
// 判断链上任何一步拿不到证据都落在「少亮」一侧，且各只有一个入口函数：
//
// - `isShadowingDeclaration()`（`declaration` / `unknown`）：位置类别**判不出来**（`unknown`，即标识符类
//   节点但父链不匹配任何判据）时当作「可能是声明位」——它参与归属判定（可能把候选挡掉 = 少亮），
//   但**不做源、不做候选**。
// - `isVariableClass()`（`declaration` / `reference`）：**源位置**判不出来（`unknown` 或 `excluded`）
//   时不做源（不亮）。
//
// ## 复用 code-outline 的解析与缓存（MUST NOT 另建一份）
//
// 树只走 `structureTree()`（唯一的解析入口），索引按 (语言, 原文) 缓存。因此「先 ⌘⇧O 再双击」与
// 「先双击再 ⌘⇧O」都只解析一次（`structureParseCount()` 的断言）。语言分层也**不另建表**：是否有
// 本能力由 `STRUCTURE_SUPPORT` 的 `tier === "symbols"`（T1 的 8 门）决定——一张表两个能力。
//
// ## 已知边界（如实记录，MUST NOT 被读成已支持）
//
// - 环境判据是**近似**：不处理变量提升与块作用域差异、闭包捕获时点、`global` / `nonlocal`、
//   动态名字、跨文件（`import` 的来源）、类型与重载（design §3.5）。
// - 未实测的声明位形态按 `unknown` 落（消极：既不亮、也可能挡掉同名候选）：python 的
//   `with … as` / `except … as` / 解构 / 推导式 / 海象 / 模式匹配、js-ts 的标签与语句级解构特例、
//   c-cpp 的含糊声明、go 的类型 switch、rust 的模式绑定细节、java 的 record 与增强 for 的绑定名。
//   逐门实测读数见 change 的 evidence 与 `test-results/m198/var-highlight-cases.md`。
// - 枚举成员名（c / cpp 的 `Enumerator`、cpp / java 的 `EnumConstant`、rust 的 `EnumVariant`）一律
//   排除：它们是类型成员，与「属性/字段名一律排除」同一条口径（宁可漏）。
// - go / rust 的占位名 `_` 排除（它不是变量，点亮它会变成一片噪音）。
// - 高亮是**全文**的（绑定出现位置本身是全文概念），与「文件内搜索只看视口」的既有口径不同：
//   这条差异写在 spec 的「高亮呈现与生命周期」里，是明文口径。

import { StateField } from "@codemirror/state";
import type { EditorState, Extension, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { STRUCTURE_SUPPORT, structureTree } from "./code-structure";
import type { StructureTree } from "./code-structure";
import type { CodeLanguage } from "./preview/attachments";

/** 绑定匹配的装饰类名（样式在 `src/preview/theme.ts`；这里是**唯一**的类名定义处）。 */
export const BINDING_MATCH_CLASS = "cm-lp-code-binding";

/** 位置类别（收录面）。`unknown` 只作为 `Classification` 的第三态存在，不进这个联合。 */
export type PositionKind = "declaration" | "reference";
/** 分类结果：两种收录位置 + 排除位 + 判不出来（tie-break 输入）。 */
export type Classification = PositionKind | "excluded" | "unknown";

/** 一次出现位置（树上的一个标识符类节点）。 */
export interface IdentifierOccurrence {
  /** **节点原文**（判据用的名字；MUST NOT 用选区文本——那是子串匹配）。 */
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly cls: Classification;
  /** 声明容器 = 向外最近的容器祖先（判不出来时是文件根）的范围与名字。 */
  readonly containerFrom: number;
  readonly containerTo: number;
  readonly containerName: string;
  /** 归属声明在 `occurrences` 里的下标；-1 = 无可见声明（文件级自由名）。见文件头的等价改写。 */
  owner: number;
}

/** 一份文档的标识符索引（按 (语言, 原文) 缓存；构建时遍历一次树，此后只查表）。 */
export interface IdentifierIndex {
  readonly occurrences: readonly IdentifierOccurrence[];
  /** 名字 → 出现位置下标（按文档序）。 */
  readonly byName: ReadonlyMap<string, readonly number[]>;
  /** 最长出现位置的跨度（触发判据的向后扫描界）。 */
  readonly maxSpan: number;
}

/** 一条高亮命中（装饰的覆盖区间）。 */
export interface BindingHit {
  readonly from: number;
  readonly to: number;
  readonly name: string;
}

// --- 判据表 ----------------------------------------------------------------------------------
//
// 每门语言三件套：① `identifiers` 标识符类叶节点名（不在集合里的叶节点根本不成出现位置——关键字、
// 运算符、`Label` / `StatementIdentifier` 这类名字都不是标识符）② `containers` 容器节点名（声明
// 容器链的骨架）③ `rules` 逐「节点名 + 父链」的判据表。
//
// **判据表的写法定死**（免得日后靠猜）：
// - `path[0]` 是节点自身名，`path[1]` 是父节点名……匹配是**前缀匹配**；表**自上而下第一条匹配生效**，
//   因此排除面一律写在收录面之前。
// - `firstOf` 用于「一个父节点下多个同名子节点，只有第一个是声明」的实测形态（c / cpp 的
//   `InitDeclarator{Identifier,Identifier}`：前一个是被声明的名字，后一个是初始化表达式里的引用）。
// - 表里没有的形态落 `unknown`（消极处置，见文件头）。
//
// 依据全部是探针实测（不是文档推断）：逐门父链转储见
// `openspec/changes/code-variable-highlight/evidence/03-identifier-positions.md` §2 与
// `test-results/m198/var-highlight-cases.md`（M198 复跑，含本表每条规则的落点）。

interface PositionRule {
  readonly path: readonly string[];
  readonly firstOf?: readonly string[];
  /** 该节点必须是父节点的第 n 个子节点（0 起）——`NamedExpression` 的赋值目标就是首个子节点。 */
  readonly indexInParent?: number;
  /** 紧邻的前一个兄弟节点名必须 ∈ 列表——`for` 之后的推导式目标、`as` 之后的绑定名靠它定位。 */
  readonly prevSibling?: readonly string[];
  readonly kind: Classification;
}

interface LanguageRules {
  readonly identifiers: readonly string[];
  readonly containers: readonly string[];
  readonly rules: readonly PositionRule[];
  /** 语言里没有名字语义的占位名（go / rust 的 `_`）。 */
  readonly blankNames?: readonly string[];
}

const JS_BINDING_RULES: LanguageRules = {
  identifiers: ["VariableDefinition", "VariableName", "PropertyDefinition", "PropertyName", "TypeDefinition", "TypeName"],
  containers: ["Script", "Block", "ClassBody", "StaticBlock", "SwitchBody", "CatchClause", "FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"],
  rules: [
    // 导入名一律排除（默认导入、命名空间导入、命名导入的别名、以及命名导入里的原名）。
    { path: ["VariableDefinition", "ImportDeclaration"], kind: "excluded" },
    { path: ["VariableDefinition", "ImportGroup"], kind: "excluded" },
    { path: ["VariableName", "ImportGroup"], kind: "excluded" },
    // 类名 / 函数名（与局部变量同名也不亮——它们是类型与函数，不是变量）。
    { path: ["VariableDefinition", "ClassDeclaration"], kind: "excluded" },
    { path: ["VariableDefinition", "FunctionDeclaration"], kind: "excluded" },
    // 类字段 / 方法名 / 对象键（PropertyDefinition）、成员访问与对象键（PropertyName）、类型名。
    { path: ["PropertyDefinition"], kind: "excluded" },
    { path: ["PropertyName"], kind: "excluded" },
    { path: ["TypeDefinition"], kind: "excluded" },
    { path: ["TypeName"], kind: "excluded" },
    // 表达式里的名字是引用；其余 `VariableDefinition`（变量声明、参数、解构绑定、for-of 绑定、
    // catch 参数）都是声明位。
    { path: ["VariableName"], kind: "reference" },
    { path: ["VariableDefinition"], kind: "declaration" },
  ],
};

/** typescript 与 javascript 的判据完全相同（ts 的额外形态是类型位，已由 TypeDefinition / TypeName 排除）。 */
const TS_BINDING_RULES: LanguageRules = JS_BINDING_RULES;

const PY_BINDING_RULES: LanguageRules = {
  identifiers: ["VariableName", "PropertyName"],
  containers: ["Script", "Body", "ClassDefinition", "FunctionDefinition", "LambdaExpression"],
  rules: [
    // 导入名（`import os` / `import os.path as p` / `from a import b as c` 里的每个名字都在
    // ImportStatement 下，一个规则全覆盖）。
    { path: ["VariableName", "ImportStatement"], kind: "excluded" },
    // 类名 / 函数名（python 的名字位与引用同为 VariableName，只能靠父节点分）。
    { path: ["VariableName", "ClassDefinition"], kind: "excluded" },
    { path: ["VariableName", "FunctionDefinition"], kind: "excluded" },
    // 成员名（`self.count` 的 count）。
    { path: ["PropertyName"], kind: "excluded" },
    // 类体直属赋值 = 类属性（不是局部/模块变量）：`Body` 的父是 `ClassDefinition` 这一层只有它能表达。
    { path: ["VariableName", "AssignStatement", "Body", "ClassDefinition"], kind: "excluded" },
    // 参数。
    { path: ["VariableName", "ParamList"], kind: "declaration" },
    // `for` 目标：`ForStatement` 下有两个 VariableName（目标、可迭代对象），只有**第一个**是绑定。
    { path: ["VariableName", "ForStatement"], firstOf: ["VariableName"], kind: "declaration" },
    // 赋值目标：`AssignStatement` 下目标在 `AssignOp` 之前——同一条「第一个 VariableName」判据。
    // `a.b = 1` 的左边是 MemberExpression（首个子节点不是 VariableName）⇒ 不命中，`a` 走引用。
    { path: ["VariableName", "AssignStatement"], firstOf: ["VariableName"], kind: "declaration" },
    // 以下三条是 design §7 点名的「未实测声明位形态」——M198 补了实测（父链与兄弟位序都是探针读数）：
    // - `with … as fh:` → `VariableName ← WithStatement` 且**紧邻的前一个兄弟是 `as`**（`as` 之前的
    //   上下文表达式是 CallExpression，不会撞上）；
    // - `except ValueError as err:` → `TryStatement` 下两个 VariableName：`as` 之后的是绑定，
    //   `except` 之后的是异常类型（按「类型名排除」处理）；
    // - 推导式目标（`[x for x in src]` 的 x）→ 四个推导式节点下紧邻 `for` 的那个 VariableName 是绑定。
    { path: ["VariableName", "WithStatement"], prevSibling: ["as"], kind: "declaration" },
    { path: ["VariableName", "TryStatement"], prevSibling: ["as"], kind: "declaration" },
    { path: ["VariableName", "TryStatement"], prevSibling: ["except"], kind: "excluded" },
    { path: ["VariableName", "ArrayComprehensionExpression"], prevSibling: ["for"], kind: "declaration" },
    { path: ["VariableName", "SetComprehensionExpression"], prevSibling: ["for"], kind: "declaration" },
    { path: ["VariableName", "DictionaryComprehensionExpression"], prevSibling: ["for"], kind: "declaration" },
    { path: ["VariableName", "ComprehensionExpression"], prevSibling: ["for"], kind: "declaration" },
    // - 海象 `(z := x)` 的目标是 `NamedExpression` 的**首个子节点**；
    // - `match` 的 `case` 模式里 `CapturePattern` 下的名字是绑定（`case [a, b]` / `case {"k": val}` /
    //   `case Point(x, y)` 的实参都落在它下面），而 `ClassPattern` / `AttributePattern` 直接子节点是
    //   类名（`case Point(x)` 的 Point、`case Color.RED` 的 Color）⇒ 按类型名排除。
    { path: ["VariableName", "NamedExpression"], indexInParent: 0, kind: "declaration" },
    { path: ["VariableName", "CapturePattern"], kind: "declaration" },
    { path: ["VariableName", "ClassPattern"], kind: "excluded" },
    { path: ["VariableName", "AttributePattern"], kind: "excluded" },
    { path: ["VariableName"], kind: "reference" },
  ],
};

const RUST_BINDING_RULES: LanguageRules = {
  identifiers: ["BoundIdentifier", "Identifier", "TypeIdentifier", "FieldIdentifier"],
  containers: ["SourceFile", "Block", "DeclarationList", "FunctionItem", "ImplItem", "TraitItem", "MatchBlock", "ClosureExpression", "StructItem", "EnumItem"],
  blankNames: ["_"],
  rules: [
    // `use` 的两半：路径末名（`use std::fmt;` 的 fmt / `E::A` 的 A）与 `as` 别名——都是导入名。
    { path: ["BoundIdentifier", "ScopedIdentifier"], kind: "excluded" },
    { path: ["BoundIdentifier", "UseAsClause"], kind: "excluded" },
    { path: ["Identifier", "ScopedIdentifier"], kind: "excluded" },
    // 枚举成员名（`enum E { A }` 的 A）——类型成员，与字段同理排除。
    { path: ["Identifier", "EnumVariant"], kind: "excluded" },
    // 函数名。
    { path: ["BoundIdentifier", "FunctionItem"], kind: "excluded" },
    // 字段声明与字段访问（都是 FieldIdentifier）、类型名。
    { path: ["FieldIdentifier"], kind: "excluded" },
    { path: ["TypeIdentifier"], kind: "excluded" },
    // 绑定位：const / static / let / 参数 / for 目标 / 模式绑定（元组、结构体、match 臂）。
    { path: ["BoundIdentifier"], kind: "declaration" },
    // 表达式里的名字是引用。
    { path: ["Identifier"], kind: "reference" },
  ],
};

const GO_BINDING_RULES: LanguageRules = {
  identifiers: ["DefName", "VariableName", "FieldName", "TypeName"],
  containers: ["SourceFile", "Block", "SwitchBlock", "TypeSwitchStatement", "FunctionDecl", "MethodDecl", "StructBody", "InterfaceBody"],
  blankNames: ["_"],
  rules: [
    // 包名（`package main` 的 main 是 DefName，但它不是变量）。
    { path: ["DefName", "PackageClause"], kind: "excluded" },
    // 导入名（含 `_` 与别名）。
    { path: ["DefName", "ImportSpec"], kind: "excluded" },
    // 函数名、方法名、类型名。
    { path: ["DefName", "FunctionDecl"], kind: "excluded" },
    { path: ["DefName", "MethodDecl"], kind: "excluded" },
    { path: ["DefName", "TypeSpec"], kind: "excluded" },
    // 字段名与成员名（`s.count` 的 count）、类型名。
    { path: ["FieldName"], kind: "excluded" },
    { path: ["TypeName"], kind: "excluded" },
    // 声明位：const / var / 短变量声明 / 参数 / 类型 switch 绑定 / range 目标。
    { path: ["DefName"], kind: "declaration" },
    // 表达式里的名字是引用（含赋值左侧与 range 的可迭代对象）。
    { path: ["VariableName"], kind: "reference" },
  ],
};

const JAVA_BINDING_RULES: LanguageRules = {
  identifiers: ["Definition", "Identifier", "TypeName"],
  containers: ["Program", "Block", "ClassBody", "InterfaceBody", "AnnotationTypeBody", "EnumBody", "MethodDeclaration", "ConstructorDeclaration", "ConstructorBody", "StaticInitializer", "LambdaExpression"],
  rules: [
    // 类型名一律排除（类 / 接口 / 枚举 / 注解类型 / record）。
    { path: ["Definition", "ClassDeclaration"], kind: "excluded" },
    { path: ["Definition", "InterfaceDeclaration"], kind: "excluded" },
    { path: ["Definition", "EnumDeclaration"], kind: "excluded" },
    { path: ["Definition", "AnnotationTypeDeclaration"], kind: "excluded" },
    { path: ["Identifier", "AnnotationTypeDeclaration"], kind: "excluded" },
    // 方法名 / 构造器名 / 方法调用里的方法名。
    { path: ["Definition", "MethodDeclaration"], kind: "excluded" },
    { path: ["Definition", "ConstructorDeclaration"], kind: "excluded" },
    { path: ["Identifier", "MethodName"], kind: "excluded" },
    // 字段（`FieldDeclaration` 下的 VariableDeclarator）与枚举成员名。
    { path: ["Definition", "VariableDeclarator", "FieldDeclaration"], kind: "excluded" },
    { path: ["Definition", "EnumConstant"], kind: "excluded" },
    // 包名与 import 路径（`package p`、`import java.util.List`）。
    { path: ["Identifier", "PackageDeclaration"], kind: "excluded" },
    { path: ["Identifier", "ScopedIdentifier"], kind: "excluded" },
    // 成员访问的名字（`this.count` 的 count）。
    { path: ["Identifier", "FieldAccess"], kind: "excluded" },
    // 类型名（`String` / `List<Integer>` 一类）。
    { path: ["TypeName"], kind: "excluded" },
    // 声明位：局部变量（祖父必须是 LocalVariableDeclaration——字段与它同形，靠祖父分）、形式参数。
    { path: ["Definition", "VariableDeclarator", "LocalVariableDeclaration"], kind: "declaration" },
    { path: ["Definition", "FormalParameter"], kind: "declaration" },
    // 表达式里的名字是引用。
    { path: ["Identifier"], kind: "reference" },
  ],
};

/** c 与 cpp 共用一支（cpp 追加名字空间与类）。 */
const C_BINDING_RULES: LanguageRules = {
  identifiers: ["Identifier", "TypeIdentifier", "TypeDefinition", "FieldIdentifier"],
  containers: ["Program", "CompoundStatement", "FunctionDefinition", "FieldDeclarationList"],
  rules: [
    // 函数名（顶层是 Identifier；cpp 类内是 FieldIdentifier——两条规则都命中它）。
    { path: ["Identifier", "FunctionDeclarator"], kind: "excluded" },
    // 类型名（struct / class / enum 名）、枚举成员名（`Enumerator`）、c 的 typedef 名（TypeDefinition）。
    { path: ["TypeIdentifier"], kind: "excluded" },
    { path: ["TypeDefinition"], kind: "excluded" },
    { path: ["Identifier", "Enumerator"], kind: "excluded" },
    // 结构体 / 类的字段名与字段访问名。
    { path: ["FieldIdentifier"], kind: "excluded" },
    // 声明位：`InitDeclarator` 的**第一个** Identifier（`int a = b;` 的 a，后一个是 b 的引用）、
    // 参数、指针声明符里的名字（`int *p` / `char *s`）。
    { path: ["Identifier", "InitDeclarator"], firstOf: ["Identifier"], kind: "declaration" },
    { path: ["Identifier", "ParameterDeclaration"], firstOf: ["Identifier"], kind: "declaration" },
    { path: ["Identifier", "PointerDeclarator"], firstOf: ["Identifier"], kind: "declaration" },
    // 表达式里的名字是引用（含 `InitDeclarator` 的第二个 Identifier）。
    { path: ["Identifier"], kind: "reference" },
  ],
};

const CPP_BINDING_RULES: LanguageRules = {
  ...C_BINDING_RULES,
  containers: [...C_BINDING_RULES.containers, "ClassSpecifier", "NamespaceDefinition", "LambdaExpression"],
  rules: [
    // cpp 独有：名字空间名不是变量（`namespace ns { … }`）。
    { path: ["Identifier", "NamespaceDefinition"], kind: "excluded" },
    ...C_BINDING_RULES.rules,
  ],
};

/**
 * 语言 → 判据表（null = 本能力不生效）。`Record<CodeLanguage, …>` 是**编译期穷尽检查**：语言表
 * 新增语言时这里必须显式表态（与 `STRUCTURE_SUPPORT` 同一纪律）。
 *
 * **是否有本能力由 `STRUCTURE_SUPPORT` 的 tier 决定**（T1「符号大纲」档的 8 门，proposal 裁决点 1 的
 * 同一张表）——T2 的 css / scss 是「规则集」不是符号，T3 没有结构解析，两者都双击不高亮、不提示。
 * 表里因此只给这 8 门写规则，其余一律 null；`supportsVariableBinding()` 是唯一的判定入口。
 */
const BINDING_RULES: Record<CodeLanguage, LanguageRules | null> = {
  javascript: JS_BINDING_RULES,
  typescript: TS_BINDING_RULES,
  python: PY_BINDING_RULES,
  rust: RUST_BINDING_RULES,
  go: GO_BINDING_RULES,
  java: JAVA_BINDING_RULES,
  c: C_BINDING_RULES,
  cpp: CPP_BINDING_RULES,
  css: null,
  scss: null,
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

/**
 * 该语言是否有双击变量高亮（**唯一判定入口**）。判据取 `STRUCTURE_SUPPORT` 的 tier：语言分层的
 * 单一来源在那边，本模块 MUST NOT 另建一份语言清单（design §4.1）。
 * 注意与 `supportsStructure` 的关系：css / scss 有结构（T2）但**没有**变量高亮。
 */
export function supportsVariableBinding(language: CodeLanguage | null): boolean {
  return language !== null && STRUCTURE_SUPPORT[language]?.tier === "symbols";
}

// --- 索引构建 --------------------------------------------------------------------------------

/**
 * 能作「归属声明」的位置 = 声明位 + 判不出来的位置（tie-break A 的唯一入口；见文件头）。
 * 引用位**不是**声明——它要向内找归属，因此 MUST NOT 落入这一侧（写成 `cls !== "excluded"` 会把
 * 引用也算成声明，归属判定就退化成「每处自持」，这是实现期实测到的一条假绿路径）。
 */
const isShadowingDeclaration = (cls: Classification): boolean => cls === "declaration" || cls === "unknown";
/** 只有两种收录位置可作源 / 候选（tie-break B 的唯一入口；见文件头）。 */
const isVariableClass = (cls: Classification): boolean => cls === "declaration" || cls === "reference";

/** 判据表的第一条匹配（前缀匹配 + firstOf / indexInParent / prevSibling）。 */
function classify(rules: LanguageRules, chain: readonly string[], earlier: readonly string[], text: string): Classification {
  if (rules.blankNames !== undefined && rules.blankNames.includes(text)) return "excluded";
  for (const rule of rules.rules) {
    if (rule.path.length > chain.length) continue;
    let matched = true;
    for (let i = 0; i < rule.path.length; i++) {
      if (chain[i] !== rule.path[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (rule.firstOf !== undefined && rule.firstOf.some((name) => earlier.includes(name))) continue;
    if (rule.indexInParent !== undefined && earlier.length !== rule.indexInParent) continue;
    if (rule.prevSibling !== undefined && !rule.prevSibling.includes(earlier[earlier.length - 1])) continue;
    return rule.kind;
  }
  return "unknown";
}

/**
 * 遍历树一次，收集全部出现位置。出现位置按**先序 = 文档序**产出（`bindingHits` 与装饰集合都依赖
 * 这个顺序，`Decoration.set` 要求区间有序）。
 */
function collectOccurrences(rules: LanguageRules, tree: StructureTree, text: string): IdentifierOccurrence[] {
  const occurrences: IdentifierOccurrence[] = [];
  const cursor = tree.cursor();
  // 祖先链（根在前，不含当前节点）——只保留容器判定需要的名字与范围。
  const ancestors: { name: string; from: number; to: number }[] = [];

  const record = (name: string, from: number, to: number, earlier: readonly string[]): void => {
    if (!rules.identifiers.includes(name)) return;
    const nodeText = text.slice(from, to);
    const chain: string[] = [name];
    for (let i = ancestors.length - 1; i >= 0; i--) chain.push(ancestors[i].name);
    const cls = classify(rules, chain, earlier, nodeText);
    // 声明容器 = 向外最近的容器祖先；一个都没有时落文件根（消极侧：根容器跨度最大 = 最容易挡住候选）。
    let container = { name: ancestors.length > 0 ? ancestors[0].name : name, from: 0, to: text.length };
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (rules.containers.includes(ancestors[i].name)) {
        container = ancestors[i];
        break;
      }
    }
    occurrences.push({
      name: nodeText,
      from,
      to,
      cls,
      containerFrom: container.from,
      containerTo: container.to,
      containerName: container.name,
      owner: -1,
    });
  };

  const visit = (earlier: readonly string[]): void => {
    const name = cursor.name;
    const from = cursor.from;
    const to = cursor.to;
    record(name, from, to, earlier);
    if (!cursor.firstChild()) return;
    ancestors.push({ name, from, to });
    const before: string[] = [];
    do {
      visit(before);
      before.push(cursor.name);
    } while (cursor.nextSibling());
    ancestors.pop();
    cursor.parent();
  };

  visit([]);
  return occurrences;
}

/**
 * 归属判定（第二遍，只在构建时跑）：给每个出现位置填 `owner`。
 *
 * 声明位（含 `unknown` 的「可能声明位」）**自持**；引用位向内找**作用域跨度最小**的同名声明位，
 * 找不到 → -1。同一名字的声明位按「跨度升序、再按文档序」排好，第一个「容器包含该位置」的即命中
 * （跨度相同时按文档序取先出现的那个——同一容器里重复声明同名变量的病态代码会落在「少亮」侧）。
 */
function resolveOwners(occurrences: IdentifierOccurrence[]): void {
  const declarations = new Map<string, number[]>();
  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    if (!isShadowingDeclaration(occ.cls)) continue;
    const list = declarations.get(occ.name);
    if (list === undefined) declarations.set(occ.name, [i]);
    else list.push(i);
  }
  for (const list of declarations.values()) {
    list.sort((a, b) => {
      const spanA = occurrences[a].containerTo - occurrences[a].containerFrom;
      const spanB = occurrences[b].containerTo - occurrences[b].containerFrom;
      return spanA !== spanB ? spanA - spanB : occurrences[a].from - occurrences[b].from;
    });
  }
  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    if (isShadowingDeclaration(occ.cls)) {
      occ.owner = i;
      continue;
    }
    let owner = -1;
    for (const candidate of declarations.get(occ.name) ?? []) {
      const decl = occurrences[candidate];
      if (decl.containerFrom <= occ.from && occ.from < decl.containerTo) {
        owner = candidate;
        break;
      }
    }
    occ.owner = owner;
  }
}

// --- 索引缓存 --------------------------------------------------------------------------------

/** 缓存份数上限（与 code-structure 同一纪律：超出即整体清空、不做 LRU）。索引按文档缓存，容量比
 *  条目表小——一份 1MB 文档的索引条目是「标识符出现数」级，比条目表大得多。 */
const CACHE_LIMIT = 8;

let buildCount = 0;
const cache = new Map<string, IdentifierIndex>();
/** 上一次查询的现场（同一份文档来回问时不再重拼 O(doc) 的缓存键，同 code-structure 的口径）。 */
let lastLookup: { language: CodeLanguage; text: string; index: IdentifierIndex | null } | null = null;

const cacheKey = (language: CodeLanguage, text: string): string => `${language}\u0000${text}`;

/** 取索引（未命中即构建一次）。**唯一的解析与遍历入口**。 */
export function identifierIndex(language: CodeLanguage, text: string): IdentifierIndex | null {
  if (!supportsVariableBinding(language)) return null;
  if (lastLookup !== null && lastLookup.language === language && lastLookup.text === text) return lastLookup.index;
  const cached = cache.get(cacheKey(language, text)) ?? null;
  if (cached !== null) {
    lastLookup = { language, text, index: cached };
    return cached;
  }
  const tree = structureTree(language, text);
  if (tree === null) return null;
  buildCount += 1;
  const occurrences = collectOccurrences(BINDING_RULES[language] as LanguageRules, tree, text);
  resolveOwners(occurrences);
  const byName = new Map<string, number[]>();
  let maxSpan = 0;
  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i];
    const list = byName.get(occ.name);
    if (list === undefined) byName.set(occ.name, [i]);
    else list.push(i);
    if (occ.to - occ.from > maxSpan) maxSpan = occ.to - occ.from;
  }
  const index: IdentifierIndex = { occurrences, byName, maxSpan };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cacheKey(language, text), index);
  lastLookup = { language, text, index };
  return index;
}

/** 累计的索引构建次数。**唯一的消费者是测试**：它把「同一文档的第二次触发不重建索引」钉成读数。 */
export function identifierBuildCount(): number {
  return buildCount;
}

// --- 触发与匹配 ------------------------------------------------------------------------------

/**
 * 触发判据（spec 的「触发判据 SHALL 是」）：选区非空、单区间，且**完整包含于**一个变量类位置的
 * 标识符节点内（`node.from ≤ sel.from && sel.to ≤ node.to`）。取**最内层**那个（起点最靠后、
 * 同起点取跨度最小者）。判据只看节点，因此「选不全」也命中（`$price` 只选中 `price` 时仍按节点
 * 原文 `$price` 判定），跨节点选区（拖选、含运算符）不命中。找不到 → null（不亮、不提示）。
 */
export function bindingSource(
  language: CodeLanguage | null,
  text: string,
  selection: { readonly from: number; readonly to: number },
): IdentifierOccurrence | null {
  if (language === null || selection.to <= selection.from) return null;
  const index = identifierIndex(language, text);
  if (index === null) return null;
  const occurrences = index.occurrences;
  // 出现位置按 from 升序：二分找最后一个 from ≤ 选区起点的位置，再向前扫（跨度有上界 maxSpan，
  // 因此向后扫描的窗口是常数级）。
  let lo = 0;
  let hi = occurrences.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (occurrences[mid].from <= selection.from) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  let found: IdentifierOccurrence | null = null;
  for (let i = last; i >= 0; i--) {
    const occ = occurrences[i];
    if (occ.from < selection.from - index.maxSpan) break;
    if (!isVariableClass(occ.cls)) continue;
    if (occ.to < selection.to) continue;
    // 更靠后（更内层）的起点优先；同起点取更小跨度。
    if (found === null || occ.from > found.from || (occ.from === found.from && occ.to < found.to)) found = occ;
  }
  return found;
}

/**
 * 该变量的全部出现位置（**不含源位置**——那儿是原生选区，spec §场景「同一变量的多处出现被点亮」
 * 只要求其余位置被点亮）。`byName` 的列表已按文档序，因此产出也是文档序。
 */
export function bindingHits(
  language: CodeLanguage | null,
  text: string,
  selection: { readonly from: number; readonly to: number },
): readonly BindingHit[] {
  if (language === null) return [];
  const source = bindingSource(language, text, selection);
  if (source === null) return [];
  const index = identifierIndex(language, text);
  if (index === null) return [];
  const hits: BindingHit[] = [];
  for (const candidateIndex of index.byName.get(source.name) ?? []) {
    const candidate = index.occurrences[candidateIndex];
    if (candidate === source) continue;
    if (!isVariableClass(candidate.cls)) continue;
    if (candidate.owner !== source.owner) continue;
    hits.push({ from: candidate.from, to: candidate.to, name: candidate.name });
  }
  return hits;
}

// --- 装饰层（CM6）----------------------------------------------------------------------------

/**
 * 文档原文的按对象记忆：装饰重算发生在**每次选区变化**上，而缓存键是文档原文——1MB 文档上每次
 * 选区变化都 `doc.toString()` 会白白分配 1MB（与 `src/toc.ts` 的 textCache 同一考量）。
 * code 模式只读，同一个 `Text` 对象的内容不会变，因此可以按对象身份记忆。
 */
let lastDoc: Text | null = null;
let lastDocText = "";

function textOf(doc: Text): string {
  if (lastDoc === doc) return lastDocText;
  lastDoc = doc;
  lastDocText = doc.toString();
  return lastDocText;
}

function computeDecorations(language: CodeLanguage, state: EditorState): DecorationSet {
  const ranges = state.selection.ranges;
  // 空选区 / 多区间（多光标）一律不亮：判据要的是「一个落在标识符内的单区间」。
  if (ranges.length !== 1 || ranges[0].empty) return Decoration.none;
  const hits = bindingHits(language, textOf(state.doc), ranges[0]);
  if (hits.length === 0) return Decoration.none;
  const mark = Decoration.mark({ class: BINDING_MATCH_CLASS });
  return Decoration.set(hits.map((hit) => mark.range(hit.from, hit.to)));
}

/** 每种语言一份 StateField（同一实例跨 modeCompartment 重配复用，字段值因此不会被重建丢掉）。 */
const fields = new Map<CodeLanguage, Extension>();

function bindingField(language: CodeLanguage): Extension {
  return StateField.define<DecorationSet>({
    // create = 「文档装载」这一半：新建会话 / 换文件 / 外部重载都走 state 创建。打开文件时选区是
    // 空的（光标在 0），computeDecorations 因此直接返回空集——**不触发解析**（design §1.6 的惰性）。
    create: (state) => computeDecorations(language, state),
    // update = 「选区变化」这一半。只读模式下没有 docChanged 带来的重算需求，但装载路径也可能带
    // changes 进同一次 dispatch，故两个条件都认；其余事务（滚动 / 视口 / 焦点）原样返回旧值。
    update: (value, tr) => (tr.docChanged || tr.selection !== undefined ? computeDecorations(language, tr.state) : value),
    provide: (field) => EditorView.decorations.from(field),
  });
}

/**
 * code 模式要装的扩展（**只装进 code 分支**，md 分支零改动）：不支持的（T2 / T3）语言返回空数组，
 * 既不解析也不装饰，更不给提示——用户双击一个标识符不是错误操作（proposal §2.3）。
 */
export function bindingHighlight(language: CodeLanguage | null): Extension {
  if (!supportsVariableBinding(language)) return [];
  const key = language as CodeLanguage;
  let field = fields.get(key);
  if (field === undefined) {
    field = bindingField(key);
    fields.set(key, field);
  }
  return field;
}
