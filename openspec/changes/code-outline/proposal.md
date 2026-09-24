# Proposal: 代码文件的符号大纲（Outline）

- Change ID: code-outline
- 日期: 2026-09-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **提案四件（proposal / design / specs 增量 / tasks），本 change 不写任何产品代码**——实现待节点 1 裁决后另立 mission。tasks.md 因此全部未勾选。

## Why

用户需求原话（2026-09-24，verbatim）：「代码文件也支持 Outline，并且支持双击选中变量后高亮变量（不是字符匹配，要语法上的变量）」。本 change 只做前半句（字符级高亮见同批提案 [code-variable-highlight](../code-variable-highlight/proposal.md)）。

### 一、诉求面：code 模式今天没有任何结构线索，且「大纲」入口在它上面给的是错话

| # | 现状事实（可复核） | 锚点 |
|---|---|---|
| 1 | 非 md 文件一律以**只读 code 模式**打开（M130 方向 A），没有例外 | `src/editor.ts:999-1002`（`modeForPath`）、`openspec/specs/editor-live-preview/spec.md` 的「单内核双模式落地」 |
| 2 | code 模式的语法来源是 `@codemirror/legacy-modes` 的 `StreamLanguage`（21 门语言同一机制） | `src/preview/code.ts:84-104`（`LANGUAGES`） |
| 3 | **StreamLanguage 的树是扁平的 token 序列**：整篇文档一个 `Document` 节点，其下直接是 token 叶节点，节点名只有 token 类别（`keyword` / ``variableName.definition`` / `typeName` / `string` …），**没有函数、类、方法、常量这类带名字与范围的声明节点** | 读数见下（实测），探针命令落 [evidence/02](evidence/02-current-code-mode-readings.md) |
| 4 | 现有大纲**只认 markdown ATX 标题**：数据来源是 `^ATXHeading([1-6])$` 正则 + `tree.iterate` | `src/toc.ts:119-141`（`extractHeadings`） |
| 5 | 于是今天在一个 `.ts` / `.py` 文件里按 `⌘⇧O`：`extractHeadings` 在扁平 token 树上命中 0 条 → 命中空态提示「这份文档还没有标题，大纲为空」（D84）。**这句话在代码文件上是错的**——不是「还没有标题」，而是「这份文件的语言今天给不出结构」 | 实测读数见下；入口 `src/keys.ts:354`（`⌘⇧O → toc.toggle`）、`src/main.ts:172-180`（装配） |
| 6 | masthead 的当前位置指示段（大纲入口）**对非 md 文档恒隐藏** | `src/toc.ts:283-290`（`sync` 的 `hidden` 判据）、`openspec/specs/toc-outline/spec.md` 的「当前位置指示与标题提取」 |

**实测读数（2026-09-24，headless，命令与完整输出见 [evidence/02](evidence/02-current-code-mode-readings.md)）**：

```
code 模式（.ts → LANGUAGES.typescript / StreamLanguage）
  max depth: 1    节点总数: 18    Document 的直接子节点数: 17
  游标顺序: Document → comment, keyword, variableName.definition, typeName, operator,
            number, keyword, keyword, variableName.definition, propertyName, …
  ATXHeading 命中（即 toc.toggle 今天拿到的条目数）: 0
对照（同一段文本走 lezer markdown parser）: distinct node names 2（Paragraph / Document），ATXHeading 0
对照（真 md 文档）: ATXHeading 2 → extractor 本身工作正常
```

结论：**诉求面真实且可复核**——今天 code 模式既没有大纲，也拿不到能做出大纲的东西；`⌘⇧O` 在那儿给的是错话。

### 二、能不能靠「近似」把大纲做出来：不能，而这正是本 change 的分层依据

- 扁平 token 树里 `variableName.definition` 这类名字**看着像**声明信息，实际上它只是**token 级分类**：不带符号名、不带符号范围、不带嵌套关系（同一行的 `def f():` 会碎成 `keyword` + `variableName.definition` + `operator` + …）。用它拼大纲就是把「上色的分类」当成「结构」，属于近似 parser 冒充结构——本仓在着色面上已经明确拒绝过同一形态（change `codeblock-toml-yaml-highlight` 的非目标：MUST NOT 用近似 parser 冒充）。
- 真结构只能来自**能产出具体语法树的 Lezer 语法**（`@lezer/*`）。哪些语言有、哪些没有，是既成事实、不是设计选择：本 change 的 design.md §1 逐语言列出（21 门注册语言逐条，含语法包、下载量与最后发布、体积、该语法是否给出声明节点），并且**探针已跑出两个反例**——`@fig/lezer-bash` 在普通 bash 上产出 11 个 error 节点、`@lezer/yaml@1.0.4` 有位置缺陷（文件以空行 + 注释行开头时产出 `Document [65536, 11)`，按位置取节点全部失效）。因此判据是两条而不是一条：**① 有官方 `@lezer` 语法；② 该语法在普通代码上无阻断性缺陷**。
- 分层因此是**硬事实驱动的**，且不能靠「有 parser 就算支持」这种粗判据：判据不过的语言就是**不支持——不做任何文本级降级**（字符匹配/缩进启发式既答不对「函数在哪」，也答不对「当前在哪个方法里」，还会把字符串与注释里的同名文本算进来）。

### 三、UI 通道不新起一套：复用既有的指示段 + 浮层

现成的大纲 UI 已经在 `src/toc.ts` 里：masthead 的当前位置指示段（兼入口）+ `⌘⇧O` 浮层 + 浮层内导航键（`↑↓` / `⌃N` / `⌃P` / `Enter` / `Esc`）。它被接受过的理由正是「不占文档区任何空间」——代码文件同样需要这个理由。本 change **不新增面板、不新增键位、不新增命令**，只把数据源与条目模型按语言分支扩展（理由见 proposal 的「capability 归属」节）。

### 四、约束

- 性能合同（ADR 0002 §6）：打开 1MB <100ms、keypress-to-paint <16ms。今天 code 模式只按视口增量解析（CM 默认行为）；引入「全文结构」必须**不在打开路径与键入路径上无条件做全文解析**——解析时机、缓存与读数见 design.md §1.6。
- 铁律（ADR 0003 §3）：大纲是装饰/视图层，跳转只改选区与视口，MUST NOT 改写文档。
- 依赖即承诺：新增 `@lezer/*` 解析器是**新依赖**（体积与许可见 design.md §1.4），须节点 1 一并裁决。

## What Changes

三件，逐条对应 specs 增量里的 requirement：

1. **代码文件的符号大纲**（delta：`toc-outline` / ADDED「代码文件的符号大纲」）。打开一个有结构解析的语言的文件时，`⌘⇧O` 与「点击指示段」列出该文件的条目：按语言的「声明节点 → 条目类别」映射（函数 / 方法 / 类 / 类型 / 常量 / 字段 / 命名空间等；css/scss 是规则集这一档），层级取**语法嵌套**（类 → 方法 缩进一级），顺序取文档顺序，跳转把光标放到该**声明的起点**（不是 md 的行尾）并滚动居中。条目数据来源 SHALL 是结构解析树，MUST NOT 由正则或文本匹配产出。覆盖档位：**T1 8 门**（javascript / typescript / python / rust / go / c / cpp / java）、**T2 2 门**（css / scss 的规则集）、**T3 11 门不支持**（逐门理由见 design.md §1.3）。
2. **指示段扩展到 code 模式**（delta：`toc-outline` / MODIFIED「当前位置指示与标题提取」）。代码文件在有当前符号且结构已解析时显示**符号链**（如 `Util › greet`），与 md 的标题链同一位置、同一入口；没有可识别符号（语言不支持 / 文件里没有声明 / 尚未解析）时不显示。md 的全部既有口径（ATX 标题来源、行尾落点、缩进归一、D84 提示）**逐字不动**。
3. **代码文件的结构解析与语言分层**（delta：`editor-live-preview` / ADDED「代码文件的结构解析（语言分层注册表）」）。把「语言 → 结构解析器 / 支持档」做成一张**单一来源**的表（与现有扩展名注册表同一条纪律，键类型同为 `CodeLanguage`），并写清：两条判据（官方语法 + 无阻断缺陷）、解析时机（首次需要时解析一次并缓存，不在打开/键入路径上解析）、不支持语言的处置（无条目、无符号链，MUST NOT 字符级降级）、**着色管线本次不动**（`@codemirror/legacy-modes` 仍是 code 模式的着色来源，见 design.md §1.5 的三条候选与推荐）。

## Non-goals

- **不改 md 大纲的任何既有口径**：条目来源（ATX 标题）、跳转落点（标题行尾）、缩进归一（最浅层标题为基准）、空态提示（D84）、浮层形态与就地键，逐字不动。
- **不做任何文本级 / 正则 / 缩进启发式的降级**：没有结构解析器的语言就是没有大纲（`⌘⇧O` 给一句说明真相的提示），MUST NOT 用「行首缩进 + 关键字」猜函数边界。
- **不换 code 模式的着色管线**：本 change 不让 lezer 语法接管高亮（那会改变既有配色观感并牵动全量视觉基线，且用户没有要求改颜色）。三条候选与推荐见 design.md §1.5。
- **不做 IDE 能力**（ADR 0001 §3 非目标）：不做跳转定义、查找引用、跨文件符号索引、符号重命名、调用层级、面包屑以外的导航。
- **不做右栏常驻面板 / 不新增窗口级 UI**：复用既有浮层（它与 masthead 指示段、vault 切换器浮层同一手法：绝对定位、零常驻占地）。
- **不加键位、不加命令、不加配置项**：`toc.toggle` 与 `⌘⇧O` 是既有入口；不做「大纲显示 / 隐藏」开关（REVIEW.md 第 9 条：声明了没有消费者的开关就是假开关）。
- **不做 md 围栏代码块内的符号大纲**：围栏是正文的一部分（没有嵌套解析树，见 design.md §6），另立 change。
- **不顺带接 php**：注册表里 php 当前是「无语言包 → 纯文本」（M130 的裁决），而 lezer 有官方 php 语法——把它接上属于「扩语言覆盖」，与本需求的「拿结构」是两件事，本次不做（记 design.md §6 的边界，另立 finding/change）。
- **不改动文档内容**（ADR 0003 §3）：大纲与跳转都不写文档字节。

## capability 归属：`toc-outline` 的 MODIFIED + ADDED，与 `editor-live-preview` 的一条 ADDED

**结论**：UI 与条目口径落 `toc-outline`（既有 living spec），**结构解析的来源**落 `editor-live-preview`（既有 living spec 的「单内核双模式落地」射程内）。**不新建 capability。**

| 本 change 的条款 | 归属理由 |
|---|---|
| 代码 + md 两套条目来源、指示段、浮层入口、跳转 | 「当前文件的大纲」这件事本身就是 `toc-outline` capability 的定义。指示段与浮层只有一份实现、一套键位口径；拆到新 capability 就得让「同一段 UI 由两份 spec 描述」，正是 REVIEW.md 第 8 条点名的形态 |
| code 模式的指示段不再恒隐藏 | `toc-outline` 的既有 requirement 明文写着「非 md 文档 SHALL 隐藏」，本 change 必须 MODIFIED 它——这是同一 capability 内的行为变更，不是新能力 |
| 语言 → 是否有结构解析器、解析时机与缓存、无解析器的回落 | 这是 **code 模式**的语言/解析口径，`editor-live-preview` 已经持有「code 模式 = 仅高亮且只读」、json/yaml 键色等 code 模式展示口径，且同批提案 `code-variable-highlight` 也要消费同一张表——表放在大纲 capability 里会让另一个 capability 去引用它的内部，放这里两侧都是「消费方」 |
| **反方（如实记录）** | 若将来代码结构解析长出「跳转定义 / 查找引用 / 符号搜索」这类 IDE 面（ADR 0001 §3 当前把它们列为非目标），那应当单立 capability（`code-intelligence` 一类）。今天它只服务两个展示面，落 `editor-live-preview` 的代码模式口径里最小 |

**归档顺序**：同批提案 [code-variable-highlight](../code-variable-highlight/proposal.md) 依赖本 change 引入的这张表。两份 change 都只对自己 capability 做 ADDED（requirement 名不重叠），互覆风险为零；但**实现顺序**上建议本 change 先行（见那份 proposal 的同一节）。

## 须提请 Alex 节点 1 裁决的选项

四项都给了推荐项；推荐项已按默认形态写进 delta 与 tasks，裁决若取备选，实现前先按裁决改写 delta 与 tasks 的条件项，不静默按推荐项做。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | **语言覆盖分层方案** | **按两条可复核判据分层**：① 有官方 `@lezer` 语法（社区单维护者包不进）；② 该语法在普通代码上无阻断性缺陷（探针实测）。结论三档：**T1 符号大纲 + 变量高亮**（javascript / typescript / python / rust / go / c / cpp / java，8 门）；**T2 结构大纲、不做变量高亮**（css / scss，条目 = 规则集）；**T3 不支持**（ruby / shell / toml / yaml / swift / kotlin / lua / sql / json / html / xml，11 门）。逐门理由与实测依据见 design.md §1.2 / §1.3 与 [evidence/01](evidence/01-language-stack-survey.md) | ① 只支持少数「常用」语言（依赖面更小，但「哪些算常用」没有判据，用户看不出缺失原因）；② 无解析器的语言用行首缩进 / 关键字启发式近似（把本仓在着色面已拒绝的「近似 parser」引进结构面）；③ **T2 整档不做**（若认为「键 / 元素 / 选择器不是符号」，删掉 T2 不影响 T1） | 推荐项的两条判据都能查、能测（包是否存在、语法是否可用），且已实测出两个反例：`@fig/lezer-bash` 在普通 bash 上产出 11 个 error 节点，`@lezer/yaml` 有位置缺陷（`Document [65536, 11)`）——「有解析器就支持」这种粗判据会把这两门放进来。json / html / xml 落 T3 的理由不是语法不可用，而是**条目文本口径尚未裁定**（键与元素名重复度太高，列表里分不出目标），这属于产品决定，本 change 不替它做 |
| 2 | **新增 `@lezer/*` 依赖许可** | **许可**：8 个官方语法包，T1+T2 合计 **408.4 KB min / 151.7 KB gzip**（逐包读数与抽样复核见 design.md §1.4 与 [evidence/01](evidence/01-language-stack-survey.md) §4；Lezer 运行时**已含**在 `@codemirror/language` 的依赖里，不重复计入）。**代价**：包体 + 结构树与索引的常驻内存（1MB 级文件 38–51 万节点） | ① 不新增依赖 → 本需求无法实现，退回「只做 md 大纲」；② 用 `@codemirror/lang-*` 包装包替代裸 `@lezer/*`（体积更大，且自带 styleTags 与配色主张）；③ 按语言动态 `import()` 懒加载（只挪成本不减总量，多一层异步） | 推荐项是「拿到结构」的最小代价，且本次**不消费语法包的 styleTags**（着色仍走 legacy-modes，见 design §1.5 的 S2），因此不引进任何第三方配色主张。内存与首次解析耗时须在真机端点复测，本提案不宣称达标 |
| 3 | **代码大纲与 md 大纲的异同**：跳转落点、层级口径、空态文案 | **异**：跳转落点取**符号声明起点**（不是 md 的「标题行行尾」——代码的声明行可能很长，行尾落在函数体开头，看不到符号）；层级取**语法嵌套深度**（不是标题的 1–6 级数字）；空态提示**新增两条文案**（① 这份文件没有可提取的符号；② 这个扩展名 / 语言暂不支持大纲）。**同**：同一指示段、同一浮层、同一组就地键、同一跳转语义（只改选区与视口） | ① 逐条与 md 同形（落点也取行尾、层级也按数字、空态复用 D84）——形式统一，代价是代码上落点不合理、且 D84 在代码文件上是一句错话；② 代码大纲干脆不显示指示段（只用 `⌘⇧O`）——省一条 MODIFIED，代价是同一个入口在两种模式下行为不一致，用户无从预期 | 推荐项的理由都在「用户看到什么」这一层：入口行为可以不一致（内容本来就不同），但**不能给错话**；`⌘⇧O` 在代码文件上继续吐「这份文档还没有标题」是必须修掉的 |
| 4 | **md 模式是否同样支持** | md **已经**支持——本 change 就是它的扩展。与 md 的口径关系见裁决点 3（推荐「浮层与键位沿用、条目与落点按语言分支」） | ① 强制两模式逐条同形（等价于裁决点 3 的备选①）；② 反过来收窄 md 大纲（不推荐，属于把既有能力降级） | md 的「标题」与代码的「符号」是两类对象，同一条 requirement 里写死一套形式会让两边都别扭；UI 通道（入口、浮层、键位、跳转语义）才是应当共享的那一层 |
| 5（附） | **`php` 是否顺带接上** | **不接**（维持 M130 的「无语言包 = 纯文本」） | 接上（`@lezer/php` 存在，且它能同时给出着色与结构） | 接上属于「扩语言覆盖」，会同时改 php 文件的观感（从纯文本变成有色的语法视图）+ 新增一类基线核对面，与本需求无关；真要接，单独立 change，证据已在 design.md §6 留档 |

## Impact
：① 语言覆盖分层 = 裁决点 1；② 新增 `@lezer/*` 依赖许可 = 裁决点 2；
③ md 模式是否同样支持 = 裁决点 4（md 已支持，本 change 是它的扩展；反向问题见裁决点 3）；④ 变量高亮的语义精度
（严格作用域分析 vs 近似）**不在本 change 的裁决面**——它属同批 [code-variable-highlight](../code-variable-highlight/proposal.md)
的裁决点 2，本 change 只负责保证两份 change 用同一张语言分层表（裁决点 1 的同一张表）。
**本 change 另自提两项**：裁决点 6（机制选择 S1/S2/S3——牵动 parity 与常驻内存的核心决定）与裁决点 7
（指示段的出现时机：惰性或打开即预解析）。
| 6 | **机制选择：结构解析与着色管线的并存形态**（design §1.5 的 S1 / S2 / S3） | **S2 双管线**：legacy mode 继续当着色来源（`language` facet 不动），结构解析用 `@lezer/*` 自己驱动、按需一次并缓存。**代价**：同一份文本两套词法各读一遍 + 结构树（1MB 级 38–51 万节点）与索引的常驻内存 | ① **S1 单管线**：有官方语法的语言改挂 `LRLanguage`，着色改由语法的 `styleTags` 驱动；② **S3**：lezer 语法占住 `language` facet，着色改成装饰层 | 这是本 change 最实质的技术决定且**牵动既有 parity 不变量与常驻内存**，故单列一行：S1/S3 都会改变观感，并撞上 spec 的「同一段代码在围栏与整文件打开时同 tag 同配色」——只改一侧就破 parity，两侧都改是大 change 且用户没要求改颜色；S2 换来着色 / parity / 全量视觉基线 / 既有断言**零改动**。三候选的代价与被拒理由见 design §1.5，本节只给 Alex 选形态的口子 |
| 7 | **指示段的出现时机**：惰性（默认）vs 打开即预解析 | **惰性**：结构未解析时指示段不显示，且**不为了点亮它而触发解析**；解析只在用户显式动作（`⌘⇧O` / 双击）时发生。**代价（写实）**：打开代码文件后若从未按过 `⌘⇧O`，那片 masthead 位置一直空着 | **打开即预解析**：打开文件后在空闲时段跑一次预算化解析，指示段随后自动出现 | 推荐项的代价是「少一个自动读数」，换来两件事：不在打开路径上加后台工作（ADR 0002 §6）＋ 指示段的出现时机**可预测**（没有异步竞态，截图类门禁不会拍到「有 / 无指示段」的中间态——`src/toc.ts:74-84` 的 `refresh()` 正是为 md 侧同类问题长出来的）。备选能让指示段「自己出现」，代价是打开路径上的后台工作 + 出现时机异步化 + 截图门禁口径要跟着改 |


**节点 1 的四项既定裁决面与本节对应关系**
- **机制（裁决点 6）在 Impact 上的落点**：S2 下着色管线（`src/preview/code.ts` 的 `LANGUAGES` / `TOKEN_GROUPS`、`src/editor.ts` 的 `codeHighlight`）与围栏着色路径**零改动**——代价是结构树与索引的常驻内存，须在常驻内存端点上复测（不达标不得宣称）。
- 影响的 specs：`toc-outline`（1 × MODIFIED「当前位置指示与标题提取」 + 1 × ADDED「代码文件的符号大纲」）、`editor-live-preview`（1 × ADDED「代码文件的结构解析（语言分层注册表）」）。**不改** `keymap-commands`（零新命令零新键位）、**不改** `file-tree`、**不改** `in-file-search`。
- 影响的代码/系统：`src/preview/code.ts`（语言表的单一来源处新增「结构解析器」维度）、新增结构解析模块（落点与命名见 design.md §2）、`src/toc.ts`（数据源分支 + 条目模型 + 指示段可见判据）、`src/main.ts`（装配）、`src/editor.ts`（只读 code 模式的既有扩展束是否需要挂载新模块）、`src/style.css` 或 `src/preview/theme.ts`（符号链与条目**不引入新视觉语言**：沿用 `.masthead-section` 与 `.lumir-toc*` 既有规则）、`package.json` + `pnpm-lock.yaml`（新增依赖）。`src-tauri/**` 零改动。
- 影响的文档：`文案-Copy.md`（**新增两条空态提示**：无可识别符号 / 语言暂不支持大纲；末位当前 D114）。`AGENTS.md` 与 `REVIEW.md` 不改（无新坑；若实现期踩到新坑按 REVIEW.md 的维护规则补）。
- 影响的测试/验收：`tests/unit/*.test.ts`（条目提取与类别映射的纯函数层，若判定可纯化）、`tests/visual/scenes/toc-outline.spec.ts`（**非 md 恒隐藏**这条既有断言要按新口径改写：改为「无可识别符号时不显示」）与新场景/新 fixture（代码大纲的条目、缩进、落点、不支持语言的提示）、`scripts/acceptance/scenarios/28-code-outline.md`（编号 28——现有最大为 27，若实现期已被占用则顺延）。
- 基线影响：**md 侧的既有整页基线预期零变更**（本 change 不改 md 渲染路径）。新增的是 code 模式下的指示段与浮层——`toc-outline.spec.ts` 已有的元素级基线（浮层本体）在条目文本变化时必然变化，**实现期须逐张核对并按 AGENTS.md 的硬规则先请 Alex 过目再 `--update`**；code 模式的测试语料此前不在任何基线里，需新增元素级基线（整页基线守不住浮层，见 `toc-outline.spec.ts` 头部记录的两条实测）。
- 性能：新增的是「结构解析」的一次性成本，时机与读数见 design.md §1.6——**读数只来自 headless 探针**（下界，不含 WKWebView 与真实打开路径），实现期须在真机端点上复测，不许拿探针读数宣称达标。
- 关联约束：ADR 0002 §6（性能合同）、ADR 0003 §3（不改写源文件）、ADR 0001 §3（IDE 能力是非目标）、ADR 0004 第 5 条（功能变更走 OpenSpec）、ADR 0006（Emacs keybinding PKM 定位——本 change 零新增键位）。
- 未做验证的项（如实记录）：真机（WKWebView）下浮层条目与符号链的观感、长文件（1MB 级代码）上浮层首次打开的手感与耗时——这两项归实现期的真机场景与 Alex 的手感项，本提案不宣称已验。
