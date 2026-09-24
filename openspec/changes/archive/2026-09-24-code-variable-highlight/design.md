# Design: code-variable-highlight

本文件分九节。**第 1 节与同批 [code-outline 的 design](../2026-09-24-code-outline/design.md) 的第 1 节逐字一致**（同一份语言栈盘点的两条消费者）；第 2–9 节是本 change 自己的。本 change 的判据全部落在解析树上，判据的第一手实测（双击选区、逐语言父链转储）见 [evidence/03](evidence/03-identifier-positions.md)。

---

## 1. 语言栈现状与分层（两份 change 共用的同一节）

### 1.1 现状：code 模式给不出结构

- 非 md 文件一律只读 code 模式（M130 方向 A，`src/editor.ts:999-1002`）。
- 它的语法来源是 `@codemirror/legacy-modes` 的 `StreamLanguage`（21 门语言同一机制，`src/preview/code.ts:84-104` 的 `LANGUAGES`）。
- StreamLanguage 产出的树是**扁平的 token 序列**：整篇文档一个 `Document` 节点，其下直接是 token 叶节点（`max depth: 1`，节点名只有 `keyword` / `variableName.definition` / `typeName` / `string` / `comment` …）。读数与命令见 [evidence/02](evidence/02-current-code-mode-readings.md)。
- 那些 token 名**不含符号名、不含符号范围、不含嵌套关系**——所以「函数在哪、类里有哪些方法、当前光标在哪个方法里」在现状管线上一个都答不出来。这不是配置问题，是机制缺口。
- 因此今天在代码文件里按 `⌘⇧O`：`extractHeadings`（`src/toc.ts:119-141`，只认 `^ATXHeading([1-6])$`）在扁平 token 树上命中 0 条 → 命中空态提示「这份文档还没有标题，大纲为空」（D84）。**这句话在代码文件上是错的**（实测见 evidence/02）。

### 1.2 分层的判据（两条，都可复核）

1. **有官方 `@lezer` 语法**：与既有依赖体系同源（本仓已依赖 `@lezer/highlight` / `@lezer/markdown`，`@codemirror/language` 又依赖 `@lezer/common` / `@lezer/lr`），由 CodeMirror 组织维护，与 `@lezer/lr` 的兼容性有版本保证。社区单维护者包一律不进本批（逐条理由见 [evidence/01](evidence/01-language-stack-survey.md) §2.2）。
2. **探针核验无阻断性缺陷**：语法必须能对目标语言的普通代码产出可用的结构树。这一条把官方语法 `@lezer/yaml` 也筛掉了（它有一个已在 `1.0.4` 复现的位置缺陷，见 [evidence/01](evidence/01-language-stack-survey.md) §6）。

判据 2 不是形式条款：它是「用别人的语法来产出结构」这件事的**验收门槛**，与「不用近似 parser 冒充」是同一条纪律（着色面上已有先例：change `codeblock-toml-yaml-highlight` 明确拒绝近似 parser）。

### 1.3 三层结论（21 门注册语言逐门落位）

**T1 —— 符号大纲 + 变量高亮（8 门）**：声明节点与引用节点都在探针里逐个列了名（[evidence/01](evidence/01-language-stack-survey.md) §3），是「条目类别」与「同一变量判据」的第一手依据。

| 语言 | 结构解析包 | 大纲条目覆盖（见 §2.1 的类别词表） |
|---|---|---|
| javascript | `@lezer/javascript` | 函数 / 类 / 方法 / 类字段 / 常量与顶级变量 |
| typescript | `@lezer/javascript`（`configure({dialect:"ts"})`） | 同上 + 接口 / 类型别名 / 枚举 |
| python | `@lezer/python` | 函数 / 类 / 方法 / 顶级赋值（常量） |
| rust | `@lezer/rust` | 函数 / 结构体 / 枚举 / trait / 常量与静态量 / impl 块 / 字段 |
| go | `@lezer/go` | 函数 / 方法 / 类型（struct、interface）/ 常量与变量声明 |
| c | `@lezer/cpp` | 函数 / 结构体 / 全局常量与变量 / 字段 |
| cpp | `@lezer/cpp` | 同上 + 类 / 类内方法 |
| java | `@lezer/java` | 类 / 接口 / 方法 / 构造器 / 字段 / 常量 |

**T2 —— 只做大纲、不做变量高亮（2 门）**：结构是「规则集」而非「符号」，但规则的选择器是天然的可跳转目标（IDE 的样式表层大纲同形）。

| 语言 | 结构解析包 | 条目 = |
|---|---|---|
| css | `@lezer/css` | 所有 `RuleSet`（条目文本 = 该规则的选择器原文，层级 = 嵌套） |
| scss | `@lezer/sass` | 所有 `RuleSet` + 所有 `SassVariableName`（`$变量`） |

**T3 —— 本次不支持（11 门）**：无大纲条目、无符号链；`⌘⇧O` 给一句说明真相的提示。逐门理由：

| 语言 | 落 T3 的理由 |
|---|---|
| ruby | 只有社区包（`codemirror-lang-ruby`，507 dl/wk）——判据 1 排除；另：其声明名与局部读同为 `Identifier`，判据要更细 |
| shell | 社区包停更 2 年+（`@fig/lezer-bash`，2023-02）且**在普通 bash 上出错**（`local x=1`、`$(( ))`、`function f {` → 11 个 error 节点）——判据 1+2 都不过 |
| toml | 社区包停更（`lezer-toml`，2022-08）；无官方语法 |
| swift | 只有单维护者新包（11 dl/wk）——判据 1 排除 |
| kotlin | 同上（5 dl/wk） |
| lua | 同上（8 dl/wk）；另一候选 `lezer-lua` 依赖**已废弃的 `lezer` 包**、周下载 0 |
| sql | 官方 `@codemirror/lang-sql` 的语法**不产出声明节点**（实测只有 `Statement`，`VALUE` 被词法成 `Keyword`）——判据 2 排除 |
| yaml | 官方 `@lezer/yaml@1.0.4` **有位置缺陷**（空行 + 注释行开头 + 区块映射 → `Document [65536, 11)`，`iterate` / `resolveInner` 全失效）——判据 2 排除 |
| json | 有官方语法，但「条目」只能是键路径（`Property` / `PropertyName`），需要先定一套「键条目的文本与层级怎么取」的产品口径（见 §6 的边界）——**本 change 不做**，留待另一个 change |
| html | 同上：条目只能是元素（`Element` / `TagName`），而元素名重复度极高（实测语料 6 个 `Element`、12 个 `TagName`），列表里不足以区分目标 |
| xml | 同 html |

**为什么 json / html / xml 不在 T2**：css 的规则集选择器天然唯一度较高、且是开发者真正会跳的目标；元素名与键名则大量重复，一个 `div` 条目标不出「哪一个」。给它们定一套条目文本口径（例如带 id 的元素、键的完整路径）是**产品决定**，不是语法决定——本 change 不替它做决定，也不做半套（记入 §6 的边界与 §2.1 的「不覆盖」清单）。

### 1.4 新增依赖清单与体积

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
| **合计（8 个包，T1 + T2）** | **408.4** | **151.7** |

- 口径与抽样复核见 [evidence/01](evidence/01-language-stack-survey.md) §4（我自跑了 python / css / javascript 三个包的 bundle 复核，与表内一致）。
- **Lezer 运行时不再重复计入**：`@codemirror/language@6.12.4` 已依赖 `@lezer/common` / `@lezer/highlight` / `@lezer/lr`（其实测的 dependencies 见同节），这部分本仓已经付过。
- 动态导入（`import()`）不解决这里的体积问题：语法包在「打开一个该语言的文件」时必然要用到，懒加载只是把成本挪到第一次打开。是否按语言懒加载是**实现期可选项**（见 §7 的备选③），本次不写成要求。
- 许可：这些包随 CodeMirror 生态发布，均为 MIT（与既有 `@codemirror/*` / `@lezer/*` 同一体系）。**实现期须逐包核对 LICENSE 文件并把结论写进实现 PR**——本提案不代替那一步（`npm view <pkg> license` 的输出在实现时留档）。

### 1.5 与 legacy-modes 着色管线的并存关系（本 change 的核心机制决定）

三条候选，本 change 推荐 **S2**：

| 机制 | 形态 | 代价与风险 |
|---|---|---|
| **S1 单管线（lezer 接管着色）** | 有官方语法的语言改挂 `LRLanguage`，着色由语法的 `styleTags` 驱动；legacy mode 退为无语法语言的兜底 | ① **会改变观感**：tag 词汇与既有 `TOKEN_GROUPS`（`src/preview/code.ts:158-169`）不同，取色随之变化；② 撞上 spec 的既有不变量「同一段代码在围栏与整文件打开时 SHALL 得到同一套 tag 与配色」（`editor-live-preview` 的「Markdown 渲染保真」第 2 款）——围栏侧的着色是 `src/preview/code.ts` 手工驱动 legacy mode 得到的，只改一侧就破 parity，两侧都改则是另一个大 change；③ 全量视觉基线要重拍，且用户没有要求改颜色 |
| **S3 lezer 当 language + 手工着色** | lezer 语法占住 `language` facet（结构 + 后台解析由 CM 管），着色改成装饰层（复用手工驱动 StreamLanguage 的既有机械） | ① `language` facet 只有一个生效位（`@codemirror/language/dist/index.js:654-660` 的 combine 取第一个），要保住 legacy 着色就得把着色从 facet 路径挪到装饰路径——**着色来源被改写**，parity 与基线同样要重验；② 为「拿结构」付了整套渲染管线的改动代价 |
| **S2 双管线（推荐）** | legacy mode **继续当 language facet**（着色一行不改）；结构解析用 `@lezer/*` 语法**自己驱动**（`parser.parse(text)`），只在需要时跑一次并缓存 | 代价：同一份文本被两套词法各读一遍（①②的对照与理由见下）；换来：**着色、parity、视觉基线、既有断言全部零改动** |

**推荐 S2 的理由（按分量排序）**：

1. **用户要的是结构，不是颜色**：S1/S3 都会动到「同一段代码长什么样」，而本 change 的被裁决面不含观感变化。零观感变化意味着零基线重拍、零既有断言改写——这是可交付性的最大变量。
2. **parity 不变量在 S2 下自动成立**：`editor-live-preview` spec 要求围栏与 code 模式同 tag 同配色。S2 不动着色管线，这条要求**逐字照旧**；S1/S3 都必须同时改围栏侧才不破。
3. **两套词法不是「同一语义两处真源」**（[REVIEW.md](../../../../REVIEW.md) 第 8 条的形态）：那条纪律针对的是「同一个语义被两处各自维护」（扩展名表、配色表）。这里两者的**语义不同且不互相校验**——着色只看 legacy mode（它今天就在做这件事），结构只看 lezer 树；语言**身份**仍只有一份来源（`LANGUAGES` 的 `CodeLanguage` 键，结构表按同一键类型做穷尽检查）。设计上明确一条纪律：**两棵树 MUST NOT 互相校验、MUST NOT 混用**（着色不参考 lezer 树，结构不参考 legacy token），免得日后长出「用 token 名冒充结构」的旁路。
4. **改动面收敛在一处**：新增一个模块（§4）+ 两个消费者（大纲、变量高亮），`src/preview/code.ts` 的着色部分零改动。

**如实记下 S2 的两个代价**：

- 同一份文档在内存里可能同时存在两棵树（legacy 树由 CM 按视口解析，很小；lezer 树是全文件的，1MB 级约 40 万节点——内存影响见 §1.6 的已知边界）。
- 「同一段代码的两种读法可能不一致」在理论上存在（例如 legacy mode 把某段当字符串、lezer 当标识符）。处置：**结构功能的口径只由 lezer 树定义**（spec 里写死），界面不同时呈现两种判定，所以不会出现「同一处两个答案都可见」的场面。

### 1.6 解析时机、缓存与性能

- **触发**：**首次需要结构时**才解析——用户在 code 模式按下 `⌘⇧O` 展开大纲（或第一次双击标识符，见同批另一 change）。MUST NOT 在打开文件时无条件解析（那会把 1MB 级的 80–290 ms 塞进打开路径）。
- **缓存**：缓存的身份是**文档内容**（键 = 语言 + 原文，与 `src/code-structure.ts` 的 `cacheKey` 同口径）——内容不同才重新解析，**切回内容相同的文件命中已有缓存、不重新解析**。理由：code 模式**只读**（M130 方向 A），文档在打开期间不会变——这是本设计成立的关键前提，若将来 code 模式可编辑，缓存策略必须重做（记入 §6 的边界）。（2026-09-24 归档时按 Alex 节点 2 裁决改准：原稿此处写「换文件、外部重载、切换标签使缓存失效」，与同一句前半的「按文档内容 + 语言缓存」自相矛盾；实现侧零改动。）
- **读数（量级，headless 下界，见 [evidence/01](evidence/01-language-stack-survey.md) §5）**：100KB 代码的结构解析 ≈ 8–30 ms（无感）；1MB ≈ 78–291 ms（**可感**）。树遍历（取条目）6–8 ms。
- **已知边界（如实写）**：1MB 级代码文件**首次** `⌘⇧O` 会有一次可感延迟（量级见上），此后同一文件不再付。这不是达标声明，是需要实现期在真机端点上复测并在必要时升级机制的项（升级路径见 §7）。
- **不在键入路径上**：只读模式没有键入；光标/滚动只驱动指示段的节流刷新（沿用 `src/toc.ts:94` 的 120 ms 口径），且指示段只在结构**已解析**时才可能显示（§3.1）。

### 1.7 本节涉及的裁决点

语言覆盖分层（T1 / T2 / T3 的取舍）与依赖许可（§1.4）是提案期的正式裁决面，落在两份 proposal 的
裁决点 1 / 2；**机制选择（§1.5 的 S2 与 S1/S3 的拒绝）同样单列为裁决点**——它牵动 parity 不变量与常驻
内存，写在 [code-outline proposal](../2026-09-24-code-outline/proposal.md) 的**裁决点 6**（本 change 按它的结论行事，
对应一句写在本 change proposal 的裁决点表之后）。三候选的代价与拒绝理由以 §1.5 为准。

---

## 2. 触发口径：双击选区到底是什么，以及本 change 如何定义触发

### 2.1 事实（都可复核）

1. 双击 → CM 的 `basicMouseSelection` → `rangeForClick` 的 `type == 2` 分支 → `groupAt`：`@codemirror/view/dist/index.js:5000-5013`（`rangeForClick`）、`:3605-3633`（`groupAt`）。
2. `groupAt` **只按字符类别扩边**（Word / Space / Other），与语法无关；类别来自 `state.charCategorizer(pos)` → `languageDataAt("wordChars")`（`@codemirror/state/dist/index.js:2836-2857`），而 `wordChars` 是**语言数据**（`@codemirror/language/dist/index.js:2210` 把 legacy mode 的 `spec.languageData` 装进语言；`@codemirror/legacy-modes/mode/javascript.js:914` 声明 `wordChars: "$"`）。
3. 实测（[evidence/03](evidence/03-identifier-positions.md) §1）：js/ts 上双击 `$price` 得到完整 `$price`、双击 `变量名` 得到完整 `变量名`；`.` / `-` / 引号会截断；空白是独立类别。
4. code 模式今天没有任何标识符装饰：唯一的装饰来源是 token 着色（`src/editor.ts:987-990` 的 `codeHighlight`；code 分支的扩展束在 `:1176-1179`），没有一件 mark 类装饰。
5. 因此「双击之后发生了什么」在现状里只有一个答案：原生选区。**「选中的是不是一个变量」没人回答**——这正是本 change 要回答的问题。

### 2.2 触发判据（设计决定）

> **触发 = 选区非空、单区间，且**完整包含于**某一个「变量类位置」的最内层标识符节点内（`node.from ≤ sel.from && sel.to ≤ node.to`，且该节点是选区起点处最内层的变量类节点）。**

注意是**包含于（⊆）而不是等于**。三条推论，每条都决定实现行为：

1. **选不全也命中**：双击 `$price` 在 `wordChars` 不含 `$` 的语言里只选中 `price`，它仍完整落在 `$price` 节点内 → 命中。**判据定义在节点上，不定义在选区文本上**——这是「用语法而不是字符」的最直接体现（也因此判据不依赖逐语言的 `wordChars` 集合）。
2. **匹配的名字取节点原文，不取选区文本**：源节点 `$price` → 候选匹配 `$price`；若取选区文本 `price`，就会退化成子串匹配（把 `price`、`price_list` 一起点亮）。
3. **跨节点的选区一律不命中**：拖选一段代码、或选中 `obj.`（含标识符与运算符）时，没有任何单个标识符节点包含它 → 不高亮。

### 2.3 触发后「什么也不发生」的情形（逐条写进 spec 的 scenario）

| 情形 | 结果 | 理由 |
|---|---|---|
| 选区落在字符串内容里（`"LIMIT"` 中的 `LIMIT`） | 不亮 | 节点是 `String` 一类，不是变量类位置（[evidence/03](evidence/03-identifier-positions.md) §2 的转储里字符串同名词一次都没出现） |
| 选区落在注释里（`// LIMIT`） | 不亮 | 节点是 `LineComment` / `BlockComment` |
| 选中的是成员/属性名（`obj.count` 的 `count`） | 不亮 | `PropertyName` / `PropertyDefinition` / `FieldIdentifier` / `FieldAccess` 子节点 → 排除位（理由见 §3.2） |
| 选中的是类名 / 方法名 / 函数名 / 类型名 | 不亮 | 同名字也要排除：它们是类型与函数，不是变量（`VariableDefinition ← ClassDeclaration` 这类实测见 §3.2 表） |
| 选中的是关键字 / 运算符 / 数字 | 不亮 | 不在标识符类节点集合内 |
| 选区跨多个节点 | 不亮 | 见 §2.2 推论 3 |
| 该语言不在 T1（含 yaml / shell / sql / ruby / swift / kotlin / lua / json / html / xml） | 不亮，**且不给任何提示** | 不是错误态：用户没做错事，弹提示是噪音（对比 `⌘⇧O`：那是显式请求，所以给提示） |
| 光标移动 / 点击别处 / 选区清空 | 已亮的装饰立即清除 | 装饰的存在条件 = 触发判据成立 |

### 2.4 与既有交互的关系（不许互相干扰）

- **原生选区**：源位置就是用户双击的位置，原生选区照旧（本 change MUST NOT 改选区、MUST NOT 抢焦点、MUST NOT 阻止默认行为）。
- **搜索面板的匹配高亮**（`.cm-searchMatch`，`src/search-panel.css:109-113`：`color-mix(in srgb, var(--accent) 14%, transparent)` 底纹 + 当前项 32% 与下划线）：两者可能同屏（先 `⌘F` 搜一个词、再双击它）。分层见 §5.2；MUST NOT 让两种判定共用一个类名（否则「这是搜索命中还是语法绑定」在观感上分不开）。
- **md 模式**：MUST NOT 影响。code 模式的装饰束只装进 code 分支（`src/editor.ts` 的 `modeExtensions`），md 分支零改动；md 的选区显露口径（`editor-live-preview` 的「编辑态口径」）不在本 change 的射程内。

---

## 3. 「同一变量」的判据

### 3.1 三层

1. **位置类别**：源与候选都必须落在「变量类位置」（逐语言判据见 §3.2）。这是排除字符串/注释/成员/类型/函数名的全部依据。
2. **名字**：候选节点原文与源节点原文**逐字节相同**（不做大小写折叠、不做词法归一——大小写敏感性由语言的语法节点本身决定）。
3. **可见域**：候选不被一个**更内层的同名声明**隔开，且方向合理（见 §3.3）。

三层任一拿不到证据 → **MUST NOT 点亮该候选**（保守方向）。

### 3.2 位置类别（逐语言判据 + 保守方向）

语言分层取 §1.3 的 **T1（8 门）**。下表是**实测**（[evidence/03](evidence/03-identifier-positions.md) §2 的父链转储），不是文档推断：

| 语言 | 变量类位置（收录） | 排除位（同名也排除） |
|---|---|---|
| javascript / typescript | `VariableDefinition` 父 ∈ {`VariableDeclaration`, `ParamList`}；任意 `VariableName` | `VariableDefinition` 父 ∈ {`ClassDeclaration`, `FunctionDeclaration`}；`PropertyDefinition`（方法名 / 类字段）；`PropertyName`（成员访问、对象键） |
| python | `VariableName` 父 ∈ {`AssignStatement`(LHS), `ParamList`, `ForStatement`}；其余位置上的 `VariableName`（表达式里的引用） | `VariableName` 父 ∈ {`ClassDefinition`, `FunctionDefinition`}（名字位）；`PropertyName` 父 `MemberExpression`；类体 `Body` 直属的 `AssignStatement` 的 LHS（类属性） |
| rust | `BoundIdentifier` 父 ∈ {`ConstItem`, `StaticItem`, `LetDeclaration`, `Parameter`}；`Identifier`（表达式里的引用） | 父 `FunctionItem` 的 `BoundIdentifier`（函数名）；`TypeIdentifier`；`FieldIdentifier`（字段声明与字段访问） |
| go | `DefName` 父 ∈ {`ConstSpec`, `VarSpec`, `VarDecl`, `Parameter`}；`VariableName` | `DefName` 父 ∈ {`FunctionDecl`, `MethodDecl`, `TypeSpec`}；`FieldName`；`TypeName` |
| java | `Definition` 父 = `FormalParameter`（参数）；`Definition` 父 = `VariableDeclarator` 且其父为 `LocalVariableDeclaration`（局部）；表达式里的 `Identifier` | `Definition` 父 ∈ {`FieldDeclaration`, `MethodDeclaration`, `ClassDeclaration`}；`Identifier` 父 `FieldAccess`；`TypeName` |
| c / cpp | `Identifier` 父 ∈ {`InitDeclarator`(第一个 `Identifier`), `ParameterDeclaration`, `PointerDeclarator`}（声明与参数）；表达式里的 `Identifier` | `Identifier` 父 `FunctionDeclarator`（函数名）；cpp 类内的 `FieldIdentifier`（函数名与字段）；`TypeIdentifier` |

**两条必须写死的细节（实测差异，猜必错）**：

- c/cpp 的 `InitDeclarator` 有两个 `Identifier`（前一个是声明名，后一个是初始化表达式里的引用）——声明名只取**第一个**。cpp 的类内函数名是 `FieldIdentifier`。
- java 的方法名是 `MethodDeclaration` 的**第一个** `Definition` 子节点（`TypeName` 返回类型排在前面）。

**保守方向（tie-break 规则，写进 spec）**：

- 位置类别**判不出来**时（语料里没覆盖的形态、语法把某段解析成了别的结构）：**当作「可能是声明位」**——因为把声明误判成引用会让遮蔽判定漏掉一层，进而**错亮**；当作声明只是少亮。
- **源位置**判不出来时：**当作「不是变量类」**——不亮。
- 两个方向的落点都是「少亮」，与「宁可漏、不可错」一致（这条比逐条枚举更耐用：新语法版本、冷僻形态都按同一方向落）。

### 3.3 可见域（遮蔽判定）

**骨架**：每个变量类位置算出它的**声明容器链**（从该位置向外、到文件根的容器序列；容器节点名逐语言见 [evidence/03](evidence/03-identifier-positions.md) §3，根容器 = `Program` / `SourceFile` / `Script`）。

**源的绑定解析**（把「源位置」变成「源声明」）：

- 源本身是声明位 → 源声明 = 它自己，源容器 = 它所在的最内层容器。
- 源是引用位 → 从源位置向外找**最近的同名变量类声明**；找到 → 源声明 = 它，源容器 = 它的容器；找不到 → 视作文件级自由名，源容器 = 根容器。

**候选判据（逐条，全部要满足才点亮）**：

1. 候选与源的名字逐字节相同（§3.1 第 2 层）。
2. 候选是变量类位置（§3.2）。
3. **方向合理**：源容器 S 是候选容器 C（或 C 的祖先），或 C 是 S（或 S 的祖先）——即两者在同一支上。S 与 C 互不包含（分属两个函数）→ 不亮。
4. **没有被更内层的同名声明隔开**：从候选位置向外走到 S（不含 S）的每一层容器，都不含「同名的变量类声明」。任何一层含 → 不亮。

四个条件合起来的行为（实现期须逐例断言，见 §6）：

| 场景 | 结果 | 依据 |
|---|---|---|
| 顶层 `const LIMIT` 与函数体内的 `return LIMIT`（函数内无同名局部） | 都亮 | 3（S 是 C 的祖先）+ 4（无隔断） |
| 顶层 `const LIMIT` 与函数体内 `const LIMIT = 3; return LIMIT` | 函数内两条互相点亮；顶层那条**不亮** | 4：函数内的局部声明把顶层那组与该函数隔开（这是近似口径的**预期取向**：不把同名不同绑定的两组混在一起） |
| 函数 f 内的局部 `x`，另一函数 g 内的局部 `x` | 都不亮 | 3（S、C 互不包含） |
| 外层函数的参数 `p`，内层嵌套函数体里的 `p` 引用 | 都亮 | 3（S 是 C 的祖先）+ 4（中间层无同名声明） |
| 源是自由名（无任何可见声明）的引用，另一函数里有局部同名 | 该函数内的出现不亮，其余引用亮 | 源容器 = 根容器，4 把被局部声明隔断的候选排除 |

**已知不处理（写进 spec 的边界段，不假装处理）**：变量提升（`var` 与块作用域在树上是同一层 `Block`）、闭包的捕获时点、`global` / `nonlocal` 这类跨层显式声明、动态名字（`getattr` / `eval` / 宏 / 反射）、跨文件（`import` 的来源）、类型推断。这些都需要语言语义（本仓没有语言服务，语法树也不编码绑定——[evidence/01](evidence/01-language-stack-survey.md) §3 的「绑定器不存在」）。

### 3.4 判据的完整定义（实现与断言的共同依据）

```
source = 最内层包含选区的变量类节点            （§2.2；失败 → 不亮）
sourceName = doc[source.from..source.to]        （节点原文，不是选区文本）
sourceDecl = source 是声明位 ? source : 向外最近的同名变量类声明
S = sourceDecl ? sourceDecl 的容器 : 根容器
for 树上每一个变量类节点 cand:
    if doc[cand.from..cand.to] !== sourceName: continue
    C = cand 的容器
    if not (S 是 C 的祖先 或 C 是 S 的祖先): continue
    if ∃ 一层 X：X 严格在 cand 与 S 之间 且 X 内有同名变量类声明: continue
    match(cand)
装饰 = match 集合（源位置除外——那儿是原生选区）
```

实现注意：**候选集合的建立与遮蔽判定都要在树上做**，MUST NOT 用文档字符串扫描（字符串与注释里的同名词之所以进不来，正是靠「节点类别」这一层）。

### 3.5 为什么不宣称「同 binding」（如实记录）

- 语法包**不提供绑定解析**（[evidence/01](evidence/01-language-stack-survey.md) §3 第 3 条）：提升、闭包捕获、遮蔽链、`var`/`let` 差异都不在树里。要做到语言语义级的「同一 binding」，需要语言服务（作用域/类型解析器），不在本仓的技术栈与 ADR 0001 §3 的非目标之内。
- 因此 spec 与文案 MUST NOT 承诺「精确的同 binding」：判据是**语法位置 + 名字 + 容器链**的近似，偏差方向都列在 §3.3 与 §7。**实现期不许把它写成「引用查找」**（那是 IDE 能力）。
- 反过来，这也正对用户的要求：他排除的是字符匹配（原话「不是字符匹配」），而本判据的每一层都是语法证据（节点类别、节点原文、容器链）——比字符匹配强、比语言服务弱，落点如实写在 spec 里。

### 3.6 静默还是提示

- 不命中（源不是变量类 / 无候选 / 语言不在 T1）→ **静默**（不弹提示）：用户做的是一个阅读动作，不是命令。
- 不写诊断日志：本 change 不新增 `log_event` 事件（无排查需求，且会带来「双击即写日志」的频率问题）。

---

## 4. 解析、索引与生命周期

### 4.1 复用同批 change 的结构解析

- 结构解析器注册表、解析触发与缓存由 [code-outline](../2026-09-24-code-outline/proposal.md) 引入（`src/code-structure.ts`；spec 落 `editor-live-preview` 的「代码文件的结构解析（语言分层注册表）」）。
- 本 change **只读消费**它：MUST NOT 另建语言表、MUST NOT 自己再解析一遍。触发路径相同（第一次需要结构时解析一次），因此「先按 `⌘⇧O` 还是先双击」不会造成两次解析。

### 4.2 标识符索引（本 change 新增的部分）

- 新增模块 `src/code-identifiers.ts`：从已解析的树构建**名字 → 出现位置 + 位置类别 + 容器链**的索引，并记录每个容器的「同名声明集合」供遮蔽判定用。
- 构建时机：第一次触发（与结构解析同批）；此后按文档缓存。
- 成本（headless 下界的量级，[evidence/01](evidence/01-language-stack-survey.md) §5）：全树遍历 6–8 ms（1MB、40 万节点级）；索引条目数 ≈ 文件里的标识符出现数（1MB 级约数万条）。
- **内存是新增常驻占用**（索引 + 树）：须在常驻内存端点上复测（口径见 `perf-measurement` spec），本提案不宣称达标。不达标时的首选升级路径见 §8 备选②。

### 4.3 重算与失效

- 重算触发只有两个：**选区变化**（`update.selectionSet`）与**文档装载**（换文件 / 外部重载 / 切标签）。只读模式下没有编辑带来的 `docChanged`（M130 方向 A 的只读合同，见 `editor-live-preview` 的「单内核双模式落地」）。
- 选区变化时的成本 = 一次索引查表 + 生成装饰集合（匹配数级）；MUST NOT 每次选区变化都重走整棵树。
- 重建：**内容变化**（换文件 / 外部重载 / 切标签后内容不同）→ 重新构建索引并写回缓存（缓存份数上限 8，超出整体清空，见 `src/code-identifiers.ts` 的 `CACHE_LIMIT`）；内容相同的文件（含切回原文件）命中已有索引；从未触发过的文件不建索引。（2026-09-24 归档时按 Alex 节点 2 裁决改准：原稿写「换文件 / 外部重载 / 切标签 → 丢索引」，与实现的内容键口径不符；实现侧零改动。）
- **前提如实记录**：本设计成立的前提是 code 模式只读。若将来 code 模式可编辑，重算触发必须补 `docChanged` 的增量或全量重建，性能口径届时要重测。

### 4.4 呈现的性能边界

- 装饰集合大小 = 匹配数（1MB 文件里同名出现几百上千次是可能的）。实现期须在真机端点复测「大文件 + 高频标识符」的装饰重建耗时；不可接受时的处置是**优化重建路径**（走增量），MUST NOT 悄悄加一个「超过 N 条就不亮」的隐藏上限（那是没被裁决的行为改变）。
- 与 `in-file-search` 的既有口径不同：该 capability 的「搜索能力集与匹配口径」requirement 里写明「高亮 SHALL 由官方的匹配高亮器按**视口**构建（视口外的匹配不画高亮）」（`openspec/specs/in-file-search/spec.md:38`，计数走全文档），而本 change 的高亮**是全文的**（绑定出现位置本身是全文概念）。这条差异写进 spec，避免日后被读成违规。

---

## 5. 呈现

### 5.1 装饰形态

- 形态：`Decoration.mark`（**不是** replace/widget——不改字符、不改行高、不产生可读文本）。
- 类名：`cm-lp-code-binding`（沿用 `cm-lp-*` 前缀；样式落 `src/preview/theme.ts`——该文件头明确 preview 装饰的样式在那里、不碰 `src/style.css`）。
- 取色：**只取既有 editorial token**，MUST NOT 新增颜色（与 json/yaml 键色修复同一条硬约束）。推荐底纹 = `--bg-2`（既有 token，`src/style.css:6`；toc 的 `is-active` 已用它表达「次一级的选中底」），不改字色、不改字重、不加下划线（字色已被 token 着色占用）。**实现期改准（2026-09-24 归档时补指针）**：实际取 **`--bg-3`**——`--bg-2` 与 code 模式当前行底色重合会隐形，tower 2026-09-24 裁决采纳（据 `src/preview/theme.ts:78-80` 与 tasks 的「如实登记的偏离」第 1 条）。

### 5.2 三层可区分（写进 spec 的断言口径）

同屏可能同时存在三种「被点亮」：

| 层 | 视觉 | 现状事实 |
|---|---|---|
| 源位置 | 原生选区 | `src/preview/theme.ts:58`：`.cm-selectionBackground, ::selection` = `--sel` |
| 绑定匹配（本 change） | `--bg-3` 底纹（原稿写 `--bg-2`，实现期偏离并在归档时改准，见 §5.1） | 新增（取既有 token） |
| 搜索命中 | accent 淡底 + 当前项下划线 | `src/search-panel.css:109-113`（既有） |

要求：三者的**计算样式互不相同**（断言直接读 `getComputedStyle` 比较），且本 change MUST NOT 复用 `.cm-searchMatch` 类名。具体色值的手感归 Alex，spec 只锁「可区分」与「不新增颜色」两条。

### 5.3 不动的部分

- 不改文档字节（ADR 0003 §3）：装饰只在视图层。
- 不改几何：只改背景色，不动字体/行高/内边距（避免滚动高度变化——M189 的几何稳定教训同族）。
- 不抢焦点、不改选区、不阻止默认行为（§2.4）。
- 不新增键位、不新增命令、不新增配置项（触发就是原生双击）。
- 不产生可读文本、不做 aria 播报（没有文案；将来若要播报「N 处出现」，需要 deck 文案与新的断言口径，本次不做）。

---

## 6. 反向验证配方（每条判据先红后绿）

| 判据 | 反向验证（必须让它 FAIL） |
|---|---|
| 判据落在语法树上 | 把实现临时改成「文档里全词匹配」，字符串/注释用例应红 |
| 排除面：字符串 / 注释 | 同上（正向用例：真变量在字符串与注释里的同名文本 MUST NOT 有装饰） |
| 排除面：成员 / 属性名 | 临时把位置类别放宽到「所有标识符类节点」，`obj.count` 的断言应红 |
| 排除面：函数名 / 类名 / 类型名 | 同上（`VariableDefinition ← ClassDeclaration` 这类节点） |
| 名字取自节点原文 | 把匹配文本改成选区文本，`$price` 被截断的用例应红（会退化成匹配 `price`） |
| 触发判据是「包含于」而非「等于」 | 把判据改成「选区 === 节点」，`$price` / 非 ASCII 的用例应红 |
| 遮蔽判定 | 临时去掉第 4 条（隔断判定），遮蔽场景应红（局部同名变量被错误点亮） |
| 方向合理性 | 临时去掉第 3 条，两个函数里同名局部变量的断言应红 |
| 只 code 模式 | 在 md 模式里放同一份文本并触发，装饰断言应红（md 不该有本装饰） |
| 无解析器语言静默 | 双击 T3 语言（如 lua）里的标识符，装饰数应为 0 且**无 toast** |
| 不改文档 / 不改几何 | 断言装饰前后 `readDocument(page)` 逐字节相同、`scrollHeight` 不变；再把装饰临时改成改字色或加粗，几何/样式断言应红 |
| 三层可区分 | 断言三层计算样式互不相同；再把绑定底纹临时改成 `.cm-searchMatch` 的表达式，断言应红 |

---

## 7. 已知边界与未验证项

**已核实的边界**：

- 只在 **T1 的 8 门语言**生效（§1.3）；其余语言双击不高亮、不提示。
- **属性 / 字段 / 成员名不在变量类**（哪怕名字相同也不亮）：跨对象同名的误亮面太大。若 Alex 要求把字段算进来，那是扩大变量类集合的一个裁决，不是实现细节。
- 判据是**近似**：不处理提升、闭包捕获时点、`global`/`nonlocal`、动态名字、跨文件、类型（§3.3 / §3.5）。
- **声明位形态：原「未实测」名单已在 M198 实测收口**（2026-09-24 归档时按实测改准；原稿写的是「未实测的声明位形态（实现期须逐条补断言或如实标为不支持）」）。已补成声明位并落判据的有：python 的 `with … as` / `except … as` / 推导式目标 / 海象 / `match` 分支模式、go 的类型 switch 绑定、rust 的 `if let` / `match` 臂 / 结构体模式绑定（规则与注释见 `src/code-identifiers.ts:197-217`）。仍是**少亮或已知混组**的形态逐条列在 `test-results/m198/false-positive-sample.md` 的「已知漏亮 / 边界形态」表（java 增强 for 的循环变量按 `unknown`、java record 组件名不亮、python lambda 体内的引用落 `unknown`、rust `if let` 偶发落 ERROR 节点而不亮、cpp / java 类内裸名成员引用会与外层同名变量混组），**MUST NOT 把本节读成「这些形态都已支持」**。
- 1MB 级文件的索引内存与装饰重建耗时（§4.2 / §4.4）——headless 只有量级读数，须真机复测。

**未验证项（不许当成已验）**：

- 真机（WKWebView）双击 → 装饰出现的可感延迟与手感；`--bg-3` 底纹在真实屏幕上的可辨识度（归 Alex 的手感项；原稿写 `--bg-2`，实现期偏离后在此改准）。
- 真实 vault 语料上的误亮率：判据用固定小语料逐例实测过（[evidence/03](evidence/03-identifier-positions.md)），**没有**跑过统计意义上的真实文件集抽样。M198 交出的读数是「6 个真实 TypeScript 文件 × 8 次触发 = 44 次人工核对、明显误亮 0、1 类漏亮（对象字面量简写属性）已修」，该文自陈不是误亮率统计（`test-results/m198/false-positive-sample.md` 的「未做的部分」）；本节口径不变——**MUST NOT 把这份抽样读成误亮率。**
- 与「文件内搜索面板打开着」同屏时的视觉层次（可区分是断言级要求，观感归 Alex）。

---

## 8. 备选机制（备记，防止实现期绕回）

1. **字符匹配 / 全词匹配**：被需求原话排除。记录在此仅堵回头路。
2. **解析完只留派生数据、丢弃树**：可能显著降低常驻内存（对比保留 40 万节点的树），代价是索引阶段必须一次算全后续可能需要的全部信息（容器链、同名声明集合）。内存复测不达标时的首选升级路径。
3. **严格作用域分析（语言服务级）**：不可交付（无语言服务、ADR 0001 §3 非目标）。将来若要做，应当是独立的 capability，不是本 change 的实现分歧。
4. **自己实现「语法感知的选词」**（双击时按节点把选区扩到完整标识符）：能让 `$price` 这类场景的选区更整齐，代价是改写原生双击行为 + 与 CM 的选词路径并存两套口径。本 change 不采用（选区不整齐不影响判定，见 §2.2 推论 1）。
5. **把字段 / 属性纳入变量类**：见 §7；本次不纳入。
6. **装饰带上「N 处」的提示**：需要新文案与新的可见元素，超出需求（用户只要求高亮）。

---

## 9. 与同批 change 的依赖关系

- 本 change **依赖** [code-outline](../2026-09-24-code-outline/proposal.md) 引入的「代码文件的结构解析（语言分层注册表）」。
- **建议实现顺序：code-outline 先行**（结构解析、语言分层、缓存由它建立）。若两 change 并行实现，须指定唯一 owner：解析与缓存在 `src/code-structure.ts`（本 change 只读消费），索引与装饰在 `src/code-identifiers.ts`（本 change 新增），文件名与职责不得重叠。
- 两份 change 都只对自己 capability 做增量（requirement 名不重叠），**归档互覆风险为零**。
