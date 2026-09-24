# 证据 01：代码模式的语言栈盘点（M192 两份提案共用）

本文件是 [code-outline](../proposal.md) 与 [code-variable-highlight](../../2026-09-24-code-variable-highlight/proposal.md) 共用的现场记录。同内容各持一份副本（跨 change 目录的引用在 archive 后会失效）。

## 0. 口径与来源

- 日期：2026-09-24。环境：Alex 的本机（macOS，Apple Silicon），Node v26.10.0，pnpm 装的 `@codemirror/*` 来自主 checkout（只读）。
- **两类来源，分开标注**：
  1. **探针（机器生成，见 [01a](01a-raw-agent-survey.md)）**：`npm view` / registry search / 逐包安装 + parse 探针 / esbuild 体积。原始日志 781 行，**未逐条复核**。
  2. **worker 独立复核（本文件 §3 / §5 / §6 / §7 与 §4 的抽样）**：我自己跑的命令与输出，脚本落 `/tmp/lezer-probe-m192/`（探针临时目录，不入仓；关键输出已抄在本文件里）。**载重结论（yaml 缺陷、逐语言声明节点名、体积抽样、耗时量级）都由第 2 类来源支撑**。
- 口径声明 A（体积）：`npx esbuild --bundle --minify --format=esm`，并把 `@lezer/lr`、`@lezer/common`、`@lezer/highlight`、`@codemirror/*` 一律外置——即**只量语法包自身**。gzip = `gzip -c <file> | wc -c`。抽样复核见 §4。
- 口径声明 B（耗时）：headless Node（不经视图、不经 WKWebView），单进程 V8，median of 5。**是下界**，只用于量级判断，MUST NOT 当作产品端点读数或达标证据。
- 口径声明 C（节点名）：探针在固定小语料上跑（每门语言一份 6–15 行样本，样本内容见 §3 的引文）。节点名是**该版本语法包的实测输出**，不是文档抄录。

## 1. 现状：code 模式的树是扁平的 token 序列

读数与命令见 [02](02-current-code-mode-readings.md)（`max depth: 1`；`Document` 的直接子节点就是全文 token）。本文件只补一句与分层相关的话：**现状的 `variableName.definition` / `variableName.local` 这类名字是 token 级分类，不含符号名、不含符号范围、不含嵌套关系**——所以「大纲」与「同一变量」两件事在现状管线上都拿不到，这不是配置问题，是机制缺口。

## 2. 逐语言盘点（21 门注册语言）

注册语言名来自 `src/preview/attachments.ts` 的 `CODE_EXTENSIONS`（值域 = `preview/code.ts` 的 `LANGUAGES` 键）。

### 2.1 有官方 `@lezer` 语法的（12 门名称 → 11 个包）

| 注册语言名 | 现有着色来源（legacy-modes） | 官方语法包 | 版本 / 最后发布 | min / gzip KB | 结构节点（§3 实测） | 分层结论 |
|---|---|---|---|---|---|---|
| javascript | `mode/javascript.javascript` | `@lezer/javascript` | 1.5.5 / 2026-09-20 | 77.8 / 29.9 | 声明/引用可分 | **T1** |
| typescript | `mode/javascript.typescript` | `@lezer/javascript` `configure({dialect:"ts"})` | 同上 | （同上，共包） | 声明/引用可分 | **T1** |
| python | `mode/python.python` | `@lezer/python` | 1.1.19 / 2026-05-28 | 38.0 / 15.8 | 同名节点，靠父节点分 | **T1** |
| rust | `mode/rust.rust` | `@lezer/rust` | 1.0.3 / 2026-09-20 | 83.2 / 29.2 | 声明/引用可分 | **T1** |
| go | `mode/go.go` | `@lezer/go` | 1.0.1 / 2025-05-12 | 27.1 / 10.8 | 声明/引用可分 | **T1** |
| c | `mode/clike.c` | `@lezer/cpp` | 1.1.6 / 2026-05-28 | 103.2 / 32.9（c+cpp 共包） | 同名节点，靠父节点分 | **T1** |
| cpp | `mode/clike.cpp` | `@lezer/cpp` | 同上 | （同上） | 同名节点，靠父节点分 | **T1** |
| java | `mode/clike.java` | `@lezer/java` | 1.1.4 / 2026-09-08 | 39.5 / 15.6 | 声明名与引用名同类，靠父节点分 | **T1** |
| css | `mode/css.css` | `@lezer/css` | 1.3.8 / 2026-09-22 | 17.2 / 7.9 | `RuleSet` / 选择器节点可分 | **T2（只大纲）** |
| scss | `mode/css.sCSS` | `@lezer/sass` | 1.1.0 / 2025-05-16 | 22.4 / 9.6 | `RuleSet` / `SassVariableName` | **T2（只大纲）** |
| json | `mode/javascript.json` | `@lezer/json` | 1.0.3 / 2024-12-29 | 1.7 / 1.1 | `Property` / `PropertyName`（键层） | **T3（本次不做）** |
| html | `mode/xml.html` | `@lezer/html` | 1.3.13 / 2025-12-22 | 12.9 / 5.4 | `Element` / `TagName` | **T3（本次不做）** |
| xml | `mode/xml.xml` | `@lezer/xml` | 1.0.6 / 2024-12-27 | 8.6 / 3.6 | `Element` / `TagName` | **T3（本次不做）** |
| yaml | `mode/yaml.yaml` | `@lezer/yaml` | 1.0.4 / 2026-01-29 | 10.8 / 4.7 | 键层可分，**但位置有缺陷（§6）** | **T3（缺陷阻断）** |

### 2.2 没有官方「可用」语法的（8 门）与社区候选

| 注册语言名 | 现有着色来源 | 社区候选 | 下载量 / 最后发布 | 不纳入的理由（可复核） |
|---|---|---|---|---|
| ruby | `mode/ruby.ruby` | `codemirror-lang-ruby` | 507 /wk，2026-03-27 | 社区单维护者包，不在 `@lezer` 官方体系；包内 `MethodDef` 名与局部读都是 `Identifier`，声明/引用靠父节点判（同 python 形态） |
| shell | `mode/shell.shell` | `@fig/lezer-bash` | 2 773 /wk，**2023-02-03** | 停更 2 年+，且**在普通 bash 上出错**（`local x=1`、`$(( ))`、`function f {` → 11 个 error 节点） |
| toml | `mode/toml.toml` | `lezer-toml` | 238 /wk，**2022-08-15** | 4 年未更新；`@lezer/toml` 不存在 |
| swift | `mode/swift.swift` | `@fazelstudio/codemirror-lang-swift`（另有 `@codincod/...`） | 11 /wk，2026-09-03（9 /wk，2026-08-15） | 单维护者新包，周下载量个位数，维护风险与兼容性无从判断 |
| kotlin | `mode/clike.kotlin` | `@fazelstudio/codemirror-lang-kotlin` | 5 /wk，2026-09-02 | 同上 |
| lua | `mode/lua.lua` | `@fazelstudio/codemirror-lang-lua` / `lezer-lua@0.13.0` | 8 /wk，2026-09-04 / **0 /wk，2023-08** | 前者同 swift；后者依赖**已被废弃的 `lezer` 包**（`npm warn deprecated lezer@0.13.5: replaced by @lezer/lr`），只发过 1 个版本、周下载 0 → 明确排除 |
| sql | `mode/sql.standardSQL` | `@codemirror/lang-sql`（官方，但语法是 token 级） | 3 506 103 /wk，2026-04-13 | 官方包，但其语法**不产出声明节点**（实测：一个 `SELECT/INSERT/CREATE` 语料里只有 `Statement`，`VALUE` 被词法成 `Keyword`）→ 大纲无从提取 |
| php | 无（注册表标 `null`，纯文本） | `@lezer/php` | 官方，1.0.6 | 注册表当前有意不接（M130 裁决）；本批两 change 均不顺手接上（见两份 proposal 的非目标） |

**搜索证据**（探针跑的 registry 查询，逐条列在 [01a](01a-raw-agent-survey.md) §7）：`@lezer/{ruby,shell,toml,swift,kotlin,lua,sql,scss,typescript}` 全部 E404；`codemirror-lang-{swift,kotlin,lua,sql,toml,bash,shell}`、`@codemirror/lang-{ruby,swift,kotlin,lua,shell,toml}`、`@replit/codemirror-lang-{swift,kotlin,lua,sql}` 全部 E404；突破点是 `keywords:lezer` 的全量检索（101 个包），swift/kotlin/lua 的候选只在那里出现。

## 3. 声明节点与「名字子节点」实测（分层判据的第一手依据）

命令（我在 `/tmp/lezer-probe-m192/` 里自跑，脚本 `verify-decls.mjs` / `verify-decls2.mjs` / `verify-names.mjs`；`@lezer/*` 来自探针目录的安装，版本即 §2.1 所列）：

```bash
cd /tmp/lezer-probe-m192 && node verify-names.mjs     # 每门语言：声明节点 → 子节点序列 + 该段源码
```

固定小语料与输出节选：

**javascript**（`const LIMIT = 42; class Util { greet(name) { return name; } } function helper(value) { return value + LIMIT; }`）

```
VariableDeclaration    子节点=[const, VariableDefinition, Equals, Number, ;]
ClassDeclaration       子节点=[class, VariableDefinition, ClassBody]      → 名字 = VariableDefinition «Util»
MethodDeclaration      子节点=[PropertyDefinition, ParamList, Block]       → 名字 = PropertyDefinition «greet»
FunctionDeclaration    子节点=[function, VariableDefinition, ParamList, Block] → 名字 = VariableDefinition «helper»
引用 = VariableName（«name» «value» «LIMIT»）
```

**typescript**（`dialect: "ts"`）：与 javascript 同形，另多 `TypeAnnotation` / `TypeName`（类型名不是变量，判据要排除）。

**python**（`LIMIT = 42` / `class Util:` / `def greet(self, name): return name` / `def helper(value): return value + LIMIT`）

```
ClassDefinition        子节点=[class, VariableName, Body]        → 名字 = VariableName «Util»
FunctionDefinition     子节点=[def, VariableName, ParamList, Body] → 名字 = VariableName «greet»
FunctionDefinition     子节点=[def, VariableName, ParamList, Body] → 名字 = VariableName «helper»
参数与引用同为 VariableName（«self» «name» «value» «LIMIT»）；顶层赋值是 AssignStatement 的 LHS VariableName
```

→ python 的「声明位」只能靠**父节点**判：`FunctionDefinition` / `ClassDefinition` 的第二个子节点、`ParamList` 的项、`AssignStatement` 的 LHS。

**rust**（`const LIMIT: u32 = 42; struct Util { name: u32 } impl Util { fn greet(&self) -> u32 { 1 } } fn helper(...)`）

```
ConstItem      子节点=[const, BoundIdentifier, :, TypeIdentifier, =, Integer, ;] → 名字 = BoundIdentifier «LIMIT»
StructItem     子节点=[struct, TypeIdentifier, FieldDeclarationList]            → 名字 = TypeIdentifier «Util»
ImplItem       子节点=[impl, TypeIdentifier, DeclarationList]                   → «Util»
FunctionItem   子节点=[fn, BoundIdentifier, ParamList, ->, TypeIdentifier, Block] → 名字 = BoundIdentifier «greet»/«helper»
引用 = Identifier；字段引用 = FieldIdentifier
```

**go**（`const Limit = 42` / `type Util struct { name string }` / `func (u Util) Greet() string` / `func helper(...)`）

```
ConstDecl   子节点=[const, ConstSpec] → ConstSpec 子节点=[DefName, =, Number] → 名字 = DefName «Limit»
TypeDecl    子节点=[type, TypeSpec]   → TypeSpec（StructType/StructBody…）
MethodDecl / FunctionDecl → 名字 = DefName；引用 = VariableName；字段 = FieldName
```

**java**（`class Util { static final int LIMIT = 42; String greet(String name) { return name; } }`）

```
ClassDeclaration    子节点=[class, Definition, ClassBody]                 → 名字 = Definition «Util»
FieldDeclaration    子节点=[Modifiers, PrimitiveType, VariableDeclarator, ;] → VariableDeclarator 子节点=[Definition, AssignOp, IntegerLiteral] → 名字 = Definition «LIMIT»
MethodDeclaration   子节点=[TypeName, Definition, FormalParameters, Block] → 名字 = **第一个** Definition «greet»（注意：`TypeName` 是返回类型，不是名字）
```

**c / cpp**（`const int LIMIT = 42; struct Util { int name; }; int greet(const char *name) { return 1; } int helper(int value) { int local = value; return local + LIMIT; }`）

```
Declaration         子节点=[const, PrimitiveType, InitDeclarator] → InitDeclarator 子节点=[Identifier, Number] → 名字 = **第一个** Identifier «LIMIT»
FunctionDefinition  子节点=[PrimitiveType, FunctionDeclarator, CompoundStatement] → FunctionDeclarator 子节点=[Identifier, ParameterList] → 名字 = Identifier «greet»
局部声明             Declaration → InitDeclarator 子节点=[Identifier, Identifier]（前一个是声明名 «local»，后一个是引用 «value»）
cpp 特有：类体里的函数名是 **FieldIdentifier**（`FunctionDeclarator 子节点=[FieldIdentifier, ParameterList]`），与顶层函数的 Identifier 不同
```

**css / scss / json / html / xml**（T2 的候选与 T3 的排除依据）

```
css   节点名：RuleSet, ClassSelector, ClassName, Declaration, PropertyName, VariableName（`--gap`）, PseudoClassSelector, ValueName…
      结构候选计数：Declaration:4 RuleSet:3 ClassName:3 PropertyName:3 PseudoClassName:2 VariableName:2 ValueName:1；max depth 6
scss  节点名：RuleSet, ClassName, Declaration, PropertyName, SassVariableName, MixinStatement, NestingSelector…
      结构候选计数：Declaration:4 SassVariableName:3 PropertyName:3 RuleSet:2 MixinStatement:1
json  结构候选：Property:4 PropertyName:4；max depth 6
html  结构候选：Element:6 TagName:12 Attribute:2（含 id/class 属性值）；max depth 6
xml   结构候选：Element:3 TagName:5 Attribute:1；max depth 4
```

**共同事实（决定变量高亮判据的三条）**：

1. **字符串与注释天然出局**：字符串内容落在 `String` / `StringContent` / `InterpolatedString` / `Text` 节点里，注释落在 `Comment` / `LineComment` / `BlockComment` 里——「只认标识符类节点」的候选集合天然不含它们。
2. **声明与引用是否同类，逐语言不同**：js/rust/go 有独立的名字节点（`VariableDefinition` / `BoundIdentifier` / `DefName`）；python/java/c/cpp 的声明名与引用名**同类**（`VariableName` / `Definition` / `Identifier`），必须靠**父节点**才能判声明位（§3 的父节点判据即为实现依据）。
3. **作用域节点存在、绑定器不存在**：所有语法都有显式的词法域节点（`Block` / `Body` / `ClassBody` / `CompoundStatement` / `BraceGroup` / `DeclarationList`…），因此「最近声明容器」这类近似可写；但**没有任何语法包提供绑定解析**（提升、闭包捕获、遮蔽链、`var`/`let` 差异都不在树里）——严格 binding 判定在纯语法树层面做不到，这是 [code-variable-highlight 的裁决点 2](../../2026-09-24-code-variable-highlight/proposal.md) 的事实依据。

## 4. 体积（依赖成本）

口径见声明 A。语法包自身（外置运行时后）：

| 包 | min KB | gzip KB |
|---|---|---|
| `@lezer/javascript`（js + ts） | 77.8 | 29.9 |
| `@lezer/cpp`（c + cpp） | 103.2 | 32.9 |
| `@lezer/rust` | 83.2 | 29.2 |
| `@lezer/java` | 39.5 | 15.6 |
| `@lezer/python` | 38.0 | 15.8 |
| `@lezer/go` | 27.1 | 10.8 |
| `@lezer/sass`（scss） | 22.4 | 9.6 |
| `@lezer/css` | 17.2 | 7.9 |
| **T1 + T2 合计（8 个包）** | **408.4** | **151.7** |

**抽样复核（我自跑，验证口径 A）**：

```bash
cd /tmp/lezer-probe-m192 && npx esbuild spot/entry-<lang>.js --bundle --minify --format=esm \
  --external:@lezer/lr --external:@lezer/common --external:@codemirror/* --external:@lezer/highlight --outfile=spot/<lang>.js
python  min=38399  gzip=16094   （表内 38.0 / 15.8 ✓）
css     min=17497  gzip=8099    （表内 17.2 / 7.9 ✓）
javascript min=78044 gzip=30075 （表内 77.8 / 29.9 ✓）
```

**运行时不再重复计入**：`@codemirror/language@6.12.4` 的 dependencies 已含 `@lezer/common` / `@lezer/highlight` / `@lezer/lr`（主 checkout 的 `node_modules/@codemirror/language/package.json` 实测），因此探针里那句「另加 59.4 KB 运行时」对 Lumir 是**重复计算**——本仓已付这部分。新增的只有上表的语法包。

## 5. 解析耗时（量级，非产品读数）

`parser.parse(text)` median of 5 + 全树 `cursor()` 遍历 median of 5（口径声明 B）：

| 语言 | 100KB parse / walk | 1MB parse / walk | 1MB 节点数 |
|---|---|---|---|
| json | 7.5 / 0.8 ms | 77.8 / 8.0 ms | 513 595 |
| html | 9.6 / 0.7 | 97.7 / 6.8 | 466 057 |
| java | 16.6 / 0.7 | 166.3 / 6.0 | 393 225 |
| yaml | 16.2 / 0.8 | 180.3 / 8.0 | 514 401 |
| css | 19.3 / 0.7 | 225.3 / 6.9 | 454 388 |
| go | 23.6 / 0.6 | 248.5 / 6.4 | 435 050 |
| javascript | 25.7 / 0.7 | 267.9 / 6.8 | 421 593 |
| python | 29.8 / 0.9 | 266.6 / 6.3 | 403 304 |
| rust | 28.7 / 0.6 | 290.6 / 6.3 | 413 388 |
| cpp | 28.7 / 0.6 | 289.9 / 6.1 | 382 199 |

对照：现状（legacy StreamLanguage 全量解析）100KB `.ts` = 7.9 ms、1MB `.ts` = 69.5 ms、1MB `.py` = 104.2 ms（[02](02-current-code-mode-readings.md) §读数 2）。

**读法**：100KB 代码的结构解析 ≈ 8–30 ms（无感）；1MB ≈ 78–291 ms（**可感**）。树遍历本身很便宜（6–8 ms）。→ 本批提案据此把「解析时机」写成「**首次需要结构时**才解析并缓存」，而不是打开文件时无条件解析（见两份 design 的 §1.6）；1MB 级的可感延迟作为**已知边界**如实记录，不宣称达标。

## 6. yaml 的位置缺陷（排除 `@lezer/yaml` 的依据，独立复现）

最小复现（我自跑，`@lezer/yaml@1.0.4`）：

```js
import { parser } from "@lezer/yaml";
const text = "\n# c\nkey: 1\n";   // 文件以「空行 + 注释行」开头，其后是区块映射
const t = parser.parse(text);
t.topNode.name                 // "Stream"  [0,12)
t.topNode.getChild("Document") // Document  [65536, 11)   ← from > to（65536 = 2^16）
t.resolveInner(5, 1).name      // "Stream"（不是 Key/Pair）
t.iterate({enter(){}})         // 只产出 2 个节点：Stream, Comment（子树不可达）
t.toString()                   // Stream(Comment,Document(BlockMapping(Pair(Key(Literal),":",Literal))))
```

触发与不触发（同一次探针的对照，逐例输出见 `/tmp/lezer-probe-m192/verify-decls.mjs` 尾部）：

| 形态 | 位置读数 |
|---|---|
| 空行 + 注释 + **区块映射** | **`Document [65536,11)`（坏）** |
| 第 1 行就是注释 + 区块映射 | `Document [0,10)`（正常） |
| 空行无注释 + 区块映射 | `Document [0,7)`（正常） |
| 内容后注释 | `Document [0,13)`（正常） |
| 空行 + 注释 + **序列** | `Document [5,8)`（正常） |

后果：任何**按位置/范围**取节点的消费者（`iterate`、`resolveInner`、按范围取键）在触发形态下全部失效——对「取 yaml 顶层键做大纲」是**阻断性**缺陷。

处置：本批两 change **都不支持 yaml 的结构功能**（它在大纲分层里落 T3，变量高亮本来也不适用数据语言），并把它记为上游缺陷（探针上游 issue 检索未见对应条目）。finding 全文落 `.tower/comms/findings/20260924-worker-code-intel-proposal-bug-lezer-lezer-yaml-fig-lezer-bash-bash.md`——`.tower/**` **不入 git**，该路径只在本机可查（口径与 [REVIEW.md](../../../../../REVIEW.md) 的语料说明一致：`.tower` 路径作现场原卷指针、仓内锚点另给）；`docs/backlog.md` 的登记**待 tower 路由后补**（本 mission 未获授权改 backlog），本文件不把它写成已登记。

## 7. `codeLanguages` 架构事实（为将来换代着色管线留档）

本节只记录**将来若要换管线**必须知道的事实，本批两 change 不采用（理由见两份 design 的 §1.5）。

- 签名（已核）：`codeLanguages?: readonly LanguageDescription[] | ((info: string) => Language | LanguageDescription | null)` —— `/Users/boxcounter/Code/Boxcounter/lumir/node_modules/@codemirror/lang-markdown/dist/index.d.ts:80`；实现 `dist/index.js:75`（`getCodeParser`）、`:421`（挂进 `parseCode`）。
- 本仓现状：`markdownConfig` 出厂 `{ base: markdownLanguage, extensions: [GFM] }`，**没有设 `codeLanguages`**（`src/editor.ts:1025`，用在 `:1161`）——与 `src/preview/code.ts` 文件头的说明一致（围栏着色走手工驱动 legacy mode 的路线）。
- 探针读数（**未由我复核，按原始日志转述**）：数组形态只接受 `LanguageDescription`，传普通对象字面量会**静默不生效**（不报错、不警告）；嵌套树挂在 `CodeText` 节点上，且**只有 `resolveInner` / `node.enter` 能进去**（`tree.iterate` 不进入 overlay mount，`IterMode.EnterBracketed` 也无效）——`@lezer/highlight` 的 `highlightTree` 就是这么手工进入的。要在大纲/绑定遍历里覆盖围栏块，必须走 `node.enter`。
- 相关 API（已核）：`@codemirror/language` 的 `LRLanguage.define` / `LanguageDescription` / `language` facet 的 combine 是「取第一个」（`@codemirror/language/dist/index.js:654-660`：`combine(languages) { return languages.length ? languages[0] : null }`）——**同一 state 里挂两个 `Language` 只有第一个生效**，这是「不能让 lezer 语法与 legacy mode 同时当 language facet」这条约束的依据（`syntaxTree` 读的就是它：同文件 `:186-189`）。

## 8. 附录

- [01a-raw-agent-survey.md](01a-raw-agent-survey.md)：探针的原始日志（781 行，机器生成，**未逐条复核**；其中的分层建议是探针自己的结论，**不是**本批提案的口径——以本文件 §2 与两份 design 为准）。
- [02-current-code-mode-readings.md](02-current-code-mode-readings.md)：现状树形态与 StreamLanguage 耗时读数。
- 探针脚本（临时，不入仓）：`/tmp/lezer-probe-m192/{verify-decls.mjs,verify-decls2.mjs,verify-names.mjs,yaml-addendum.mjs,spot/}`；/tmp 会被系统清理，故关键输出已抄进本文件。
