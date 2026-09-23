# 证据 03：标识符位置类别与双击选区的实测（M192 两份提案共用）

本文件支撑 [code-variable-highlight](../proposal.md) 的判据设计与 [code-outline](../proposal.md) 的条目口径。同内容各持一份副本。

## 0. 口径与命令

- 日期 2026-09-24，Node v26.10.0，`@lezer/*` 版本见 [01](01-language-stack-survey.md) §2.1。
- 探针（我自己跑的，脚本在 `/tmp/lezer-probe-m192/`，未入仓；关键输出已抄在本文件）：

```bash
cd /tmp/lezer-probe-m192 && node verify-positions.mjs   # 标识符类节点的「父链」转储
cd /Users/boxcounter/Code/Boxcounter/lumir && node --experimental-strip-types --import ./tests/unit/register.mjs /tmp/probe-m192/probe5.mjs   # 双击选区与 wordChars
```

- 口径声明：headless，无视图、无 WKWebView。双击选区那部分是**复刻** `@codemirror/view` 的 `groupAt` 算法（`dist/index.js:3605-3633`）在真 `EditorState` 上跑的，不是浏览器真实双击事件——真实双击的落点由 CM 的 `basicMouseSelection`（同文件 `:5000-5013`，`type == 2` 分支）走同一函数，因此**算法一致**，但不含浏览器侧的原生选词行为（只读、`contenteditable=false` 时浏览器不改选区）。

## 1. 双击选区的实测（触发面的第一手读数）

语料：`const $price = 1;` / `const 变量名 = 2;` / `const a = $price + 变量名;`（`.ts`，走 `LANGUAGES.typescript`）。

```
code 模式 wordChars: ["$"]
字符类别（0=Word 1=Space 2=Other）: "$"→Word  "p"→Word  "_"→Word  "字"→Word  "1"→Word  "."→Other  "-"→Other  "("→Other  " "→Space
double-click @ "$price" +0 → [6,12)   "$price"      （$ 被完整选中）
double-click @ "$price" +1 → [6,12)   "$price"
double-click @ "变量名"  +0 → [24,27)  "变量名"       （非 ASCII 标识符完整选中）
double-click @ "a = $price" +0 → [39,40) "a"  +1 → [40,41) " "（空白）  +2 → [41,42) "="
```

**两条结论**：

1. **`$` 与非 ASCII 字母都算 word**：`wordChars` 来自语言数据（`@codemirror/language/dist/index.js:2210` 把 `spec.languageData` 装进语言；`@codemirror/legacy-modes/mode/javascript.js:914` 声明 `wordChars: "$"`），非 ASCII 走 `hasWordChar`（`@codemirror/state/dist/index.js:2518-2530` 的 `makeCategorizer`）。因此「双击 `$price` 只选中 `price`」这类担心在 js/ts 上不成立——实测整体选中。
2. **断点只在非 word 字符**：`.` / `-` / 引号 / `(` 等会把选区截断；空白是独立类别（Space），双击空白只得到一个空格选区。

**边界如实记录**：`wordChars` 是**逐语言**的（legacy mode 自己声明），本探针只核了 js/ts 一处；python 等未核。因此判据 MUST NOT 依赖具体字符集合——判据定义在**节点**上（选区 ⊆ 标识符节点），选不全是允许的（见 §3 的推论）。

## 2. 标识符类节点的父链转储（判据表的第一手数据）

每门语言一份固定语料（含：顶层声明、类/结构体、字段、方法/函数、参数、局部变量、成员访问、字符串与注释里出现同名的文本），转储「标识符类节点 ← 父链（4 层）」。

### javascript（`dialect` 默认）

```
VariableDefinition «LIMIT»  ← VariableDeclaration < Script              ← 顶层变量 ✓
VariableDefinition «obj»    ← VariableDeclaration < Script              ✓
PropertyDefinition «count»  ← Property < ObjectExpression < VariableDeclaration   ✗ 对象键
VariableDefinition «Box»    ← ClassDeclaration < Script                 ✗ 类名
PropertyDefinition «count»  ← PropertyDeclaration < ClassBody < ClassDeclaration  ✗ 类字段
PropertyDefinition «run»    ← MethodDeclaration < ClassBody < ClassDeclaration    ✗ 方法名
VariableDefinition «LIMIT»  ← ParamList < MethodDeclaration …            ✓ 参数
VariableDefinition «LIMIT»  ← VariableDeclaration < Block < MethodDeclaration …   ✓ 局部变量
VariableName «obj»          ← MemberExpression < BinaryExpression …      ✓ 变量引用
PropertyName «count»        ← MemberExpression < BinaryExpression …      ✗ 成员名
VariableName «LIMIT»        ← BinaryExpression < …                       ✓ 引用
VariableDefinition «s»      ← VariableDeclaration < Script               ✓
（语料里的字符串 "LIMIT" 与注释 // LIMIT 未出现在转储里 —— String / LineComment 节点不是标识符类）
```

### typescript

同 javascript（另多 `TypeName` / `TypeAnnotation`，类型名不是变量类）。

### python

```
VariableName «LIMIT»  ← AssignStatement < Script                          ✓ 顶层赋值
VariableName «Box»    ← ClassDefinition < Script                          ✗ 类名
VariableName «count»  ← AssignStatement < Body < ClassDefinition          ✗（类体里的赋值 = 类属性）
VariableName «run»    ← FunctionDefinition < Body < ClassDefinition       ✗ 函数名
VariableName «self»   ← ParamList < FunctionDefinition …                  ✓ 参数
VariableName «LIMIT»  ← ParamList < FunctionDefinition …                  ✓ 参数
VariableName «LIMIT»  ← AssignStatement < Body < FunctionDefinition …     ✓ 局部变量
VariableName «x»      ← ForStatement < Body < FunctionDefinition …        ✓ for 目标（绑定）
VariableName «self»   ← MemberExpression < BinaryExpression …             ✓ 变量引用
PropertyName «count»  ← MemberExpression < BinaryExpression …             ✗ 成员名
VariableName «LIMIT»  ← BinaryExpression < ReturnStatement < Body …       ✓ 引用
VariableName «other»  ← FunctionDefinition < Script                       ✗ 函数名
VariableName «LIMIT»  ← ReturnStatement < Body < FunctionDefinition …     ✓ 引用（跨函数，用于遮蔽场景）
（注释 `# …` 里的同名文本未出现在转储里）
```

**python 的判据只能是「节点名 + 父链」**：同一 `VariableName` 兼作类名 / 函数名 / 属性 / 参数 / 局部与顶层变量 / 引用，父节点是唯一的区分依据。

### rust

```
BoundIdentifier «LIMIT» ← ConstItem < SourceFile                     ✓ 常量
TypeIdentifier «u32»    ← ConstItem < SourceFile                     ✗ 类型
TypeIdentifier «Box»    ← StructItem < SourceFile                    ✗ 类型名
FieldIdentifier «count» ← FieldDeclaration < FieldDeclarationList …  ✗ 结构体字段
BoundIdentifier «run»   ← FunctionItem < DeclarationList < ImplItem  ✗ 函数名
BoundIdentifier «LIMIT» ← Parameter < ParamList < FunctionItem …     ✓ 参数
BoundIdentifier «LIMIT» ← LetDeclaration < Block < FunctionItem …    ✓ 局部变量
FieldIdentifier «count» ← FieldExpression < BinaryExpression …       ✗ 字段访问
Identifier «LIMIT»      ← BinaryExpression < ExpressionStatement …   ✓ 引用
BoundIdentifier «other» ← FunctionItem < SourceFile                  ✗ 函数名
Identifier «LIMIT»      ← ExpressionStatement < Block < FunctionItem ✓ 引用（跨函数）
```

### go

```
DefName «LIMIT»      ← ConstSpec < ConstDecl < SourceFile     ✓ 常量
DefName «run»        ← FunctionDecl < SourceFile              ✗ 函数名
DefName «n»          ← Parameter < Parameters < FunctionDecl  ✓ 参数
DefName «LIMIT»      ← VarDecl < Block < FunctionDecl …       ✓ 短变量声明（局部）
VariableName «LIMIT» ← BinaryExp < ReturnStatement < Block …  ✓ 引用
VariableName «n»     ← BinaryExp < ReturnStatement < Block …  ✓ 引用
DefName «other»      ← FunctionDecl < SourceFile              ✗ 函数名
VariableName «LIMIT» ← ReturnStatement < Block < FunctionDecl ✓ 引用（跨函数）
```

### java

```
Definition «Box»     ← ClassDeclaration < Program                          ✗ 类名
Definition «LIMIT»   ← VariableDeclarator < FieldDeclaration < ClassBody …  ✗ 字段
Definition «count»   ← VariableDeclarator < FieldDeclaration < ClassBody …  ✗ 字段
Definition «run»     ← MethodDeclaration < ClassBody < ClassDeclaration …   ✗ 方法名
Definition «LIMIT»   ← FormalParameter < FormalParameters < MethodDeclaration  ✓ 参数
Definition «LIMIT»   ← VariableDeclarator < LocalVariableDeclaration < Block   ✓ 局部变量
Identifier «count»   ← FieldAccess < BinaryExpression …                     ✗ 成员名
Identifier «LIMIT»   ← BinaryExpression < ReturnStatement < Block …         ✓ 引用
```

（java 的「字段 vs 局部」由父节点区分：`FieldDeclaration` vs `LocalVariableDeclaration`——探针实测，不是推测。）

### c

```
Identifier «LIMIT»     ← InitDeclarator < Declaration < Program                    ✓ 顶层常量与变量
TypeIdentifier «Box»   ← StructSpecifier < Program                                 ✗ 类型名
FieldIdentifier «count»← FieldDeclaration < FieldDeclarationList < StructSpecifier ✗ 字段
Identifier «run»       ← FunctionDeclarator < FunctionDefinition < Program         ✗ 函数名
Identifier «LIMIT»     ← ParameterDeclaration < ParameterList < FunctionDeclarator ✓ 参数
Identifier «LIMIT»     ← InitDeclarator < Declaration < CompoundStatement < FuncDef ✓ 局部变量
Identifier «LIMIT»     ← ReturnStatement < CompoundStatement < FunctionDefinition  ✓ 引用
Identifier «other»     ← FunctionDeclarator < FunctionDefinition < Program         ✗ 函数名
Identifier «LIMIT»     ← ReturnStatement < CompoundStatement < FunctionDefinition  ✓ 引用（跨函数）
```

### cpp

```
Identifier «LIMIT»      ← InitDeclarator < Declaration < Program                    ✓ 顶层
TypeIdentifier «Box»    ← ClassSpecifier < Program                                  ✗ 类型名
FieldIdentifier «count» ← FieldDeclaration < FieldDeclarationList < ClassSpecifier  ✗ 字段
FieldIdentifier «run»   ← FunctionDeclarator < FunctionDefinition < FieldDeclList   ✗ **类内函数名是 FieldIdentifier**
Identifier «LIMIT»      ← ParameterDeclaration < ParameterList < FunctionDeclarator ✓ 参数
Identifier «LIMIT»      ← InitDeclarator < Declaration < CompoundStatement …        ✓ 局部变量
FieldIdentifier «count» ← FieldExpression < BinaryExpression …                      ✗ 字段访问
Identifier «LIMIT»      ← BinaryExpression < ReturnStatement …                      ✓ 引用
```

**cpp 的一个坑（实测）**：类体里的函数名是 `FieldIdentifier`（不是 `Identifier`），顶层函数的函数名是 `Identifier`。判据必须逐语言写死，不能靠「看起来差不多」。

## 3. 由转储导出的判据（实现依据）

**位置类别 = 节点名 + 父链**。三分类：

- **变量类位置**（收录，可成为高亮源与候选）：局部变量、参数、顶层/模块级变量与常量、`for` 等绑定位。
- **排除位**（同名也排除）：属性/成员/字段名、类与方法/函数名、类型名、对象键、导入名、标签。
- **不可判 → 按保守方向处置**：位置类别判定不确定时，**当作「可能是声明位」**（多判一次遮蔽 → 少亮），而非当作引用位；源位置判定不确定时，**当作「不是变量类」**（不亮）。两个方向的落点都是「少亮」，与「宁可漏、不可错」一致。

**声明容器**（遮蔽判定的骨架）：每门语言的容器节点名逐语言列（`Block` / `Body` / `ClassBody` / `CompoundStatement` / `DeclarationList` / `Program` / `SourceFile` / `Script`…，见 §2 的父链转储），文件根容器 = `Program` / `SourceFile` / `Script` / `Document` 一类顶层节点。

**共同事实**：字符串内容与注释文本**天然出局**（它们落在 `String` / `InterpolatedString` / `Text` / `Comment` / `LineComment` / `BlockComment` 里，不在标识符类节点集合内）——转储里语料的字符串与注释同名词一次都没出现，可直接引用为断言依据。

## 4. 本文件不覆盖

- 真实浏览器 / WKWebView 下的双击事件路径（只在 §1 的算法层复刻）。
- 每门语言的**完整**声明位枚举（只给了固定语料的实测清单；未覆盖 `with` / `except as` / 解构 / 模式匹配 / 标签等形态）——实现期须按 spec 的判据逐条补断言，未覆盖形态如实记进 design 的边界节。
- 增量重解析（code 模式只读，无编辑路径）。
