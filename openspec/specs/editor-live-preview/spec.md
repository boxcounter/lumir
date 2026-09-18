# editor-live-preview Specification

## Purpose

定义编辑器单内核双模式（ADR 0002 §2）的落地口径：md 模式 = 高亮 + live preview 装饰层且可编辑、code 模式 = 仅高亮且只读（M130 的「非 md 即只读」）、按文件类型选模式、配置 `editor.mode` 仅作无类型线索时的默认；装饰层视口增量构建以满足打开 1MB <100ms 性能合同（ADR 0002 §6）。**编辑态口径**：md 模式下光标/选区触及的结构显露源码（callout 行、标准 Markdown 链接、frontmatter 块、公式与 mermaid widget、分隔线行），显露由选区驱动的装饰重建实现、不改文档——M1 期的只读口径已随编辑能力落地而作废。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；真实打开路径 perf 端点的演进义务见 perf-measurement spec），并由 `align-editor-live-preview-spec` 对齐到现状（2026-09-17，同时补记 M138 渲染保真三件套）。

## Requirements

### Requirement: 单内核双模式落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按扩展名注册表（`src/preview/attachments.ts` 的单一事实源）选择模式：`.md`/`.markdown` 用 md 模式；**其余一切已打开的文件一律用只读 code 模式**（含未收录扩展、dotfile 与 basename 无点的文件）——有语言包则高亮、无则纯文本；只有没有文件上下文（path 缺失）的文档才回落配置 `editor.mode`。md 模式之外编辑器 MUST NOT 可编辑（`editable(false)` + `readOnly(true)` 的视图层只读合同）。初始模式由配置 `editor.mode` 决定（既有接线保留）。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

#### Scenario: 非 md 文本文件只读打开

- **WHEN** 用户在配置 `editor.mode = md`（出厂值）下点击一个 `.php`、`.svelte`、`.txt`、未知扩展文件，或 `LICENSE`/`Makefile` 这类 basename 无点的文件
- **THEN** 该文件以只读 code 模式打开：视图层不可编辑（`contenteditable` 摘除、`aria-readonly`），输入被拒收，不产生 dirty，后续 Cmd+S 不进入保存链路

### Requirement: live preview 装饰层

md 模式下系统 SHALL 用 CM6 decoration 实现 live preview：标题按级别呈现字号/字重、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、行内代码与代码块背景。装饰层 SHALL 采用视口增量构建（⚠ 裁决点 D，推荐项：只为可见区域构建 decoration，滚动时增量更新），MUST NOT 在打开文档时全量构建——打开 1MB Markdown <100ms 是 CI 绝对阈值（ADR 0002 §6）。该视口增量义务不含 frontmatter properties 区块——跨行 replace 装饰受 CM6 视口插件硬限制，其构建策略见 frontmatter-properties spec（StateField + 文档变更时重算 + 首部扫描有界）。**编辑态口径**（M1 只读期已结束，md 模式可编辑）：光标或选区触及的结构 SHALL 显露源码——callout 行（含其内容行的行内标记）、**强调范围（`**加粗**` / `*斜体*` / `~~删除线~~`，M168）**、标准 Markdown 链接（整条）、frontmatter 块、公式与 mermaid widget、分隔线行；显露 SHALL 由选区驱动的装饰重建实现，MUST NOT 改写文档。装饰 MUST NOT 改变文档源码（ADR 0003 §3 铁律）。

显露的**判定单位**分两级，两条口径 MUST 同时成立且互不替代：

1. **节点范围级**（强调范围、标准链接）：选区与该节点的源码区间相接即显露该节点。两条命令的**相接口径不同，各有其由**：强调范围取**含端点相接**（`sel.from <= to && sel.to >= from`）——范围两端邻接位的两侧都是隐藏定界符，空光标停在那里既测不到 caret 坐标、也够不到定界符，一并显露才能让「光标所在范围」始终有可编辑的原文；标准链接保持既有的**严格重叠**（`sel.from < to && sel.to > from`，M145 口径未动）。
2. **行级**（callout 内容行）：选区触及该行即显露该行全部 inline 标记（M119 既有口径，行级显露是节点范围级的超集，不因本条收窄）。

「不是行级」是节点范围级口径的要害：同一行里未被触及的另一个强调范围 MUST 保持渲染态；光标在范围外紧邻的字符位上（`from - 1`）该范围同样保持渲染态。

强调范围的显露 SHALL 同时撤下该范围的样式装饰与标记隐藏（编辑态下作者看到的是一段原文，不是「有样式的源码」）。行内代码不在本口径内：装饰层只给它加样式、不隐藏反引号，其标记在渲染态本就可见可编辑（cell 内 inline code 的断言见 tests/visual/scenes/table-foundation-v2.spec.ts），故它没有「进入范围才显露」这回事。

#### Scenario: 标记符隐藏

- **WHEN** md 模式打开含 `**加粗**` 与 `# 标题` 的文档
- **THEN** 加粗文本以粗体呈现且不显示 `**`，标题按级别样式呈现

#### Scenario: 大文件视口增量

- **WHEN** 打开 1MB Markdown 文件
- **THEN** 只为可见区域构建 decoration，打开路径不超性能合同阈值；滚动到任意位置时该区域装饰即时生效

#### Scenario: 光标触及即显露源码

- **WHEN** 文档含 `# 标题`、`**加粗**`、callout 与一条标准 Markdown 链接，光标先停在正文里（不在任何强调范围内）、再移入加粗文本中、再移入 callout 首行、最后移入链接的显示文本
- **THEN** 第一步加粗与标题仍为渲染态；移入加粗文本时该 `**加粗**` 显露为含标记的原文；移入 callout 首行时该行显露 `>` 与 `[!type]` 原文；移入链接时该链接整条（含 `]` 与 `(target)`）显露；光标移开后恢复渲染态，各状态下 `EditorState.doc` 逐字节不变

#### Scenario: 同一行内只显露被触及的强调范围

- **WHEN** 同一段落里有 `**甲**` 与 `**乙**` 两个强调范围，光标移入 `**甲**` 的内容
- **THEN** `**甲**` 显露为原文，`**乙**` 仍以粗体渲染且其 `**` 不出现（判定单位是节点范围，不是行）；光标移入 `**乙**` 时两者互换，光标移开后两者都恢复渲染态

#### Scenario: 强调范围的端点相接同样显露

- **WHEN** 文档含 `**加粗**`，光标分别停在范围起点（开头的 `**` 之前）与终点（收尾的 `**` 之后）这两个空光标位
- **THEN** 两次都显露该范围为原文（端点邻接位的两侧都是隐藏定界符，caret 在那里没有可测位置，显露才可编辑）；光标停在范围起点**前一个字符位**（与该范围不相接）时保持渲染态、`**` 不出现——这一对输入互为区分度对照

#### Scenario: callout 的行级显露不因节点范围口径收窄

- **WHEN** callout 内容行含加粗、行内代码与斜体，光标落在该行的任一处（含加粗范围之外的位置）
- **THEN** 该行整行显露（`>`、`**`、反引号、`*` 一并可见），行为与 M119 落地时一致

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；该配置 SHALL 只作用于没有文件上下文的文档（空态 / 新建 / reset）。打开文件时的模式 SHALL 由扩展名注册表唯一裁决：`.md`/`.markdown` → md 模式；其余一切已打开的文件（含未收录扩展、dotfile 与 basename 无点的文件）→ 只读 code 模式，**MUST NOT 回落 `editor.mode`**。该裁决 MUST NOT 随 `editor.mode` 的取值漂移：把配置在 `md` 与 `code` 之间切换不改变任何已打开文件的模式。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开（可编辑 + live preview）；配置值只对空态 / 新建文档生效

#### Scenario: 未收录扩展不回落配置默认

- **WHEN** `editor.mode = md` 且用户打开 `.log`、`.csv` 或 `.xyz` 这类未收录扩展的文件
- **THEN** 文件以只读 code 模式打开（无语言包时按纯文本显示原文），MUST NOT 进入可编辑 md 模式，不产生 dirty

#### Scenario: 无扩展名文件一并不回落配置默认

- **WHEN** 用户打开 basename 无点的文件（如 `LICENSE`、`Makefile`）
- **THEN** 文件以只读 code 模式打开，MUST NOT 按 `editor.mode` 进入可编辑模式（M130 评审裁决：D4「非 md 即只读」优先于任务书「ext 缺失保持 fallback」的字面）

### Requirement: JSON 键名与值分色

json 文档里的**对象键** SHALL 以属性名配色（`--callout-note`）呈现，MUST NOT 与字符串值同色；字符串值 SHALL 保持字符串配色（`--callout-tip`），数字、布尔与 null 值 SHALL 保持字面量配色（`--callout-warning`）。该口径 SHALL 对任意键形态恒成立——顶层、嵌套对象与数组内对象里的键，纯数字键、非 ASCII 键、含点/冒号/空格/转义引号的键——MUST NOT 只对某一类键生效。键同时带 string 与 propertyName 两个 tag 时命中属性名规则；配色 MUST 只取自既有 editorial token，MUST NOT 为本次修复新增颜色。同一段 json 在 code 模式（只读 `.json` 文件）与 md 围栏 ```json 代码块里的配色 SHALL 一致。装饰 MUST NOT 改写文档内容，`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律）。

#### Scenario: .json 文件键与值分色

- **WHEN** 用户打开内容为 `{"name": "lumir", "count": 3}` 的 `.json` 文件（只读 code 模式）
- **THEN** `"name"` 以属性名色呈现、`"lumir"` 以字符串色呈现、`3` 以字面量色呈现，三者互不相同，且文件仍不可编辑

#### Scenario: 围栏 json 代码块同口径

- **WHEN** md 文档里有 ```json 围栏代码块 `{"name": "lumir", "count": 3}`
- **THEN** 块内键取属性名色、字符串值取字符串色，与打开 `.json` 文件时一致，且用色不越出既有 editorial token

#### Scenario: 键形态不影响判定

- **WHEN** json 文档的键是纯数字（`"123"`）、非 ASCII（`"中文键"`）、含点/冒号/空格或转义引号，或位于嵌套对象与数组内
- **THEN** 每个键都以属性名色呈现、每个字符串值都以字符串色呈现、字面量值都以字面量色呈现

#### Scenario: 其它语言的字符串键不跟着变

- **WHEN** md 围栏 ```javascript 代码块里出现对象字面量 `const a = {"name": "lumir"}`
- **THEN** 该字符串键仍取字符串色（json 的复合 token 修正 MUST NOT 外溢到 javascript/typescript）

### Requirement: GFM 短行表格尾部补空列与多列整块降级

md 模式 SHALL 按 [GFM spec §4.10](https://github.github.com/gfm/#tables-extension-) 处理数据行 cell 数与表头不同的 pipe table：数据行 cell 数**少于**表头列数时，系统 SHALL 在尾部补空 cell 并把整表按矩形呈现，MUST NOT 因这一行整块回退为源码。补出的空 cell SHALL 与源文件里的空格空槽、`||` 零宽空槽同形——不填占位符、不加「缺列」之类的标记，列边界 SHALL 与表头列对齐；装饰 MUST NOT 改写文档内容，`EditorState.doc` 与磁盘文件逐字节不变。数据行 cell 数**多于**表头列数时，系统 SHALL 维持整块源码降级（GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突）；表头与分隔行列数不一致、槽位不能安全映射、范围不完整同样 MUST 整块降级。降级文案 SHALL 继续指认首个与表头列数不符的数据行的文档行号与表头列数。

#### Scenario: 短行尾部补空列

- **WHEN** 用户打开一份表头声明 6 列、其中若干数据行只有 5 格的 Markdown 文件（M137 实测的 `outline.md` 形态）
- **THEN** 该表按 6 列矩形呈现，缺列行的末格是空白 cell，各列边界与表头列对齐；屏幕上不出现表格降级提示，文档与磁盘文件逐字节不变

#### Scenario: 多列表整块降级

- **WHEN** parser 识别的 Table 中有数据行 cell 数多于表头列数
- **THEN** 该表整块显示可读源码，并给出指认出错行文档行号与表头列数的降级文案；系统 MUST NOT 静默丢弃多余 cell，也 MUST NOT 只丢多出的列后照常渲染

### Requirement: 标准 Markdown 链接的形态分类与 live preview 渲染

md 模式下，标准 Markdown 链接 `[title](target)`（lezer 语法树的 `Link` 节点 + `URL` 子节点，非引用式、非自动链接、非图片）SHALL 按其**目标原文**归入五类之一，分类实现 SHALL 只有前端一份（`src/preview/links.ts` 的 `classifyLinkTarget`），装饰层与激活路径共用同一个结果：

1. **外链**：目标带 `http` / `https` / `mailto` scheme（大小写不敏感）→ 渲染为显示文本 `title` 加尾部标记 `↗︎`（U+2197 后跟 U+FE0E 变体选择符 VS15，强制文字表现而非 emoji）。
2. **应用内笔记**：目标无 scheme 且路径段（丢掉 `#fragment` 后）末段以 `.md` 结尾**或没有扩展名** → 渲染为 `title` 加尾部标记 `→`（U+2192）。
3. **vault 内资产**：目标无 scheme 且路径段末段是其它扩展名，或路径段以 `/` 结尾（目录）→ 渲染为 `title` 加尾部标记 `↗︎`——语义是「这一下会离开本应用」。
4. **纯锚点**：目标以 `#` 开头 → 渲染为 `title` 加尾部标记 `→`。
5. **不可用**：schema 不在白名单内（`javascript:` / `file:` / 应用自定义协议）、目标为空、或目标解码后含控制字符 → SHALL 保持原文，MUST NOT 有任何装饰（没有链接样式、没有尾标、没有 `title` 属性）。

`title` SHALL 取 `[` 与 `]` 之间的显示文本；`[`、`]` 与 `(target)` 三段源码 SHALL 被装饰隐藏，MUST NOT 出现在渲染态。隐藏与标记 SHALL 只存在于装饰层：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律），装饰层的视口增量纪律不变。

目标 SHALL 经被装饰的链接元素的 `title` 属性保留可取（悬停可见、读屏可取）——外链接解码后的 URL，其余类别给目标原文；源码里的目标被隐藏后，信息 MUST NOT 丢失。标记自身 SHALL 是装饰性元素（`aria-hidden`），MUST NOT 成为无名的可读内容。

**分类判据只看目标原文，不看文件是否存在**（装饰与激活解耦）：解析得到吗、能不能打开，都是激活时才问的问题。因此「目标不存在」的链接照常装饰，代价由激活路径的人话提示承担，而不是让渲染层去猜。

光标或选区触及该链接时，系统 SHALL 显露整条链接的源码（含括号、目标与显示文本内的强调标记），显露口径与既有 callout 首行的源码显露一致：编辑态下作者看到的仍是原文，且长目标被隐藏后 MUST NOT 在链接中间产生「按键而光标不动」的死区。显露由选区驱动的装饰重建实现，MUST NOT 改写文档。

行内代码与围栏代码块内的链接 SHALL NOT 渲染（语法树上下文天然排除，前端 MUST NOT 另写一套上下文判定）。

本 requirement MUST NOT 改变 wikilink（`[[…]]`）的渲染路径：三态显示、span 定位与 `![[…]]` 的附件/嵌入分流一律不动。引用式链接（`[text][ref]` / `[ref]`）与自动链接（`<https://…>`）SHALL 保持原文：前者 lezer 不把定义处的 URL 挂到引用点、拿不到目标，后者不是 `[title](target)` 形态。

#### Scenario: 外链与应用内链接各自渲染出正确的标记

- **WHEN** 打开一份含 `[示例站点](https://example.invalid/site)`、`[写邮件](mailto:someone@example.invalid)`、`[包裹形式](<https://example.invalid/wrapped>)`、`[本地笔记](note.md)`、`[上层笔记](../top.md)`、`[配置](配置)`、`[说明书](docs/manual.pdf)`、`[资料目录](docs/)` 与 `[去标题](#链接)` 的 Markdown
- **THEN** 前三条渲染为显示文本加尾部 `↗︎`，`[本地笔记]`、`[上层笔记]`、`[配置]`、`[去标题]` 渲染为显示文本加尾部 `→`，`[说明书]` 与 `[资料目录]` 渲染为显示文本加尾部 `↗︎`；所有目标源码在渲染态不可见，`title` 属性给出对应目标，文档内容逐字节不变

#### Scenario: 不可用形态保持原文

- **WHEN** 同一份文档里含 `[别开我](javascript:alert(1))`、自动链接 `<https://example.invalid/auto>`、裸网址、引用式链接与行内代码里的 `` `[代码里的](https://example.invalid/code)` ``
- **THEN** 这些位置一律原样显示 Markdown 源码，没有链接样式、没有尾标，也不产生任何打开入口

#### Scenario: 目标不存在的链接照常装饰

- **WHEN** 文档里含 `[不存在的笔记](missing.md)`，而 vault 里没有这个文件
- **THEN** 该链接照常渲染为 `不存在的笔记` + `→`（分类只看目标原文），vault 里 MUST NOT 因此出现新文件

#### Scenario: 光标落在链接上显露源码

- **WHEN** 把光标移到某条链接的显示文本内
- **THEN** 该链接整条显露源码（`[示例站点](https://example.invalid/site)`、`[本地笔记](note.md)` 同样），其余链接仍是渲染态；光标移开后又恢复渲染态，两种状态下 `EditorState.doc` 都不变

#### Scenario: 表格 cell 内的链接

- **WHEN** 链接出现在 grid 表格的某个 cell 内，且整条链接落在该 cell 内
- **THEN** 该链接照常渲染为 `title` + 与其类别对应的标记，同一行其余 cell 的内容不受影响（表格仍是 grid）

#### Scenario: 链接标题里的未转义管道符

- **WHEN** 链接标题里出现**未转义**的管道符（`| [x | y](https://example.invalid) |`）
- **THEN** 该行被管道符切成两个 cell、该处不再是一个链接（词法层面即不成立），因此保持原文不装饰；系统 MUST NOT 猜测修复这条链接，表格自身按表格合同处置（cell 数多于表头 → 整块降级）

### Requirement: Markdown 渲染保真（分隔线 / 围栏代码着色 / 引用内列表）

md 模式 SHALL 在基础装饰之外渲染下列三类结构（M138 落地），三者均 MUST NOT 改写文档内容（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3 铁律）：

1. **分隔线**：`---` / `***` / `___` 主题行 SHALL 渲染为一条横线（replace widget，读屏名「分隔线」），渲染态 MUST NOT 露出源码标记。**文档首部 frontmatter 块内的 `---` 定界符 MUST NOT 被当作分隔线**（frontmatter 判定复用既有唯一实现，toc 与装饰层不得各写一份）。横线的宽度 SHALL 取阅读栏宽，本体 SHALL 不参与行高计算；光标或选区触及该行时 SHALL 显露源码（否则作者既看不到光标也看不到刚敲入的字符）。
2. **围栏代码块着色**：带 info string 且语言在收录表内的围栏代码块 SHALL 按该语言着色，token 色值 MUST 只取自既有 editorial token（MUST NOT 为此新增颜色）；同一段代码经围栏渲染与整文件（code 模式）打开时 SHALL 得到同一套 tag 与配色，MUST NOT 出现两侧漂移。**该一致性 SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT 由两侧各自维护一份语言或配色表。** 语言相关的键名口径按各自 capability 条目处置：json 见「JSON 键名与值分色」，yaml 见「YAML 代码块的键名配色」。info string 缺失、语言不在收录表内时 SHALL 保持纯文本（源码逐字保留，MUST NOT 用近似 parser 冒充着色）。块级 mermaid 走自身的 widget 渲染路径，不适用本条。围栏代码块的分隔行与源码 SHALL 保持可选中的原文，装饰 MUST NOT 吞掉字符。着色 SHALL 受单一代码块长度上限约束（超过即回落纯文本，MUST NOT 因语言不同而放宽）。**已知例外（如实记录，缺陷在案）**：（a）rust 的字符 / 字节字符字面量（simpleMode 的 `string.special` 复合 token）在围栏里丢 tag、取正文色，与 code 模式不一致——影响面已枚举（收录语言里只有 rust），finding 与修法见 `docs/backlog.md` 的「rust 字符字面量在围栏代码块里不着色」条；（b）toml 的表头 `[x]` 与 `true` / `false`、日期共用 legacy mode 的同一个 `atom` token（`@codemirror/legacy-modes` 的 `mode/toml.js:44,57,59`），tokenTable 按 token 名映射、分不开三者，因此表头取的是字面量色（与数字、布尔同色）——两侧口径一致（不构成漂移），修它需要改 vendored mode 的词法，本 capability 记为接受现状，记 `docs/backlog.md`。本条「两侧同 tag 同配色」在（b）上成立、在（a）修复前不成立，MUST NOT 被读作已满足。
3. **引用内列表**：引用块（含嵌套引用 `> >`）内的有序 / 无序 / 任务列表 SHALL 与正文里的列表走同一套标记装饰与正文对齐——行首连续的 `>` 与紧随空格、以及列表标记 SHALL 在渲染态被隐藏；callout 内的列表与普通引用内的列表同一口径（callout 本就是 blockquote）。嵌套层级、多位编号与任务状态 SHALL 保留，MUST NOT 重新编号或写入任务状态。

三项装饰 SHALL 遵守本 spec 的视口增量纪律（`live preview 装饰层` requirement）：只为可见区域构建，MUST NOT 因这三项在打开文档时引入全量构建。

#### Scenario: 分隔线渲染且 frontmatter 不误渲

- **WHEN** 打开一份首部含 frontmatter（`---` 定界符）且正文另有一行 `---` 的 Markdown
- **THEN** 正文那行渲染为一条横线（宽度取栏宽、本体不占行高、读屏名为「分隔线」），源码 `---` 在渲染态不可见；frontmatter 的定界符 MUST NOT 被渲染为横线（frontmatter 区按自身口径呈现）

#### Scenario: 光标落在分隔线行显露源码

- **WHEN** 把光标移到渲染为横线的那一行
- **THEN** 该行显露 `---` 原文、横线让位；光标移开后恢复横线渲染，两种状态下文档内容不变

#### Scenario: 收录语言着色、未收录语言保持纯文本

- **WHEN** md 文档里有两个围栏代码块，一个 info string 为 `python`、另一个为 `brainfuck`（不在收录表内）
- **THEN** python 块按语言取色（色值来自既有 editorial token），brainfuck 块按纯文本显示且源码逐字可读可选中；同一段 python 代码在只读 `.py` 文件（code 模式）里取到同一套配色

#### Scenario: 两侧语言与配色表同源

- **WHEN** 任何一门收录语言在只读文件（code 模式）与 md 围栏代码块里渲染同一段代码
- **THEN** 两侧取到同一套 tag 与同一组色值；系统 MUST NOT 存在第二份语言表或配色表可供两侧分别取用（语言表的增删在两侧同时生效）

#### Scenario: 着色受长度上限约束且与语言无关

- **WHEN** 任一收录语言的围栏代码块长度超过单一代码块的长度上限（回落阈值）
- **THEN** 该块回落为纯文本、不产出任何 token 装饰；该上限对收录语言一律适用，MUST NOT 因语言不同而放宽（MUST NOT 只对部分语言生效）

#### Scenario: 引用内的列表按常规列表渲染

- **WHEN** 打开含 `> - 甲` `> - 乙` 以及嵌套 `> > 1. 丙` 的 Markdown
- **THEN** 引用内的列表以常规列表呈现（标记换列表符号、正文缩进对齐、层级保留），`>` 与 `-` / `1.` 等标记在渲染态不可见；文档内容逐字节不变

### Requirement: YAML 代码块的键名配色

yaml 文档里的**映射键**（`key:` 与 `- key:` 两种形态的键）SHALL 以属性名配色（`--callout-note`）呈现，MUST NOT 与字面量（数字、布尔）同色——键的语义是属性名，与 json 的对象键同一口径（见「JSON 键名与值分色」）。该口径 SHALL 对**未加引号**的键形态恒成立——顶层键、嵌套键、序列项内的键、非 ASCII 键、含 `-` / `.` / `/` / `+` / 空格的键——MUST NOT 只对某一类键生效（带引号的键另见下一条 scenario）。字符串值 SHALL 保持字符串配色（`--callout-tip`），数字值 SHALL 保持字面量配色（`--callout-warning`），布尔值（`true` / `false` 等）SHALL 保持关键字配色（`--accent`），注释 SHALL 保持注释配色（`--dim`）；未加引号的标量值与结构符号（`-` / `:` / `,` 等）SHALL 维持正文色（本 capability 不对它们赋予颜色语义）。同一段 yaml 在 md 围栏（```yaml 与 ```yml 两个 info string）与只读 `.yml` / `.yaml` 文件（code 模式）里的配色 SHALL 一致——两侧共用同一张语言表，该一致性 MUST NOT 由两侧分别对齐。配色 MUST 只取自既有 editorial token，MUST NOT 为本次修复新增颜色。本口径 MUST NOT 外溢到其它语言——toml 的 `atom`（表头 / 日期 / 布尔）以及 json、javascript、typescript 的既有取色 SHALL 保持不变。装饰 MUST NOT 改写文档内容，`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律）。

#### Scenario: 围栏 yaml 代码块的键取属性名色

- **WHEN** md 文档里有 ```yaml 围栏代码块，内容为两层嵌套映射加一个序列（`dimensions:` → `- name: Goal` → `key: goal`）
- **THEN** 全部键名（`dimensions`、`name`、`key`）以属性名色呈现、MUST NOT 与数字或布尔同色；字符串值取字符串色；块内不再出现「整块只有一种颜色」的形态

#### Scenario: 别名 yml 与 yaml 同口径

- **WHEN** md 文档里两个围栏代码块内容逐字节相同，info string 分别为 `yaml` 与 `yml`
- **THEN** 两块取到逐 token 相同的类名与色值

#### Scenario: .yml 文件与围栏同色

- **WHEN** 打开内容与上述围栏块相同的只读 `.yml`（或 `.yaml`）文件
- **THEN** 键取属性名色、字符串值取字符串色，与围栏渲染逐 token 相同，且文件仍不可编辑

#### Scenario: 键形态不影响判定

- **WHEN** yaml 的键是非 ASCII 键、含 `-` / `.` / `/` / `+` / 空格的键，或位于序列项内与任意嵌套层级
- **THEN** 每个键都以属性名色呈现，MUST NOT 只对该类键中的某一种生效

#### Scenario: 带引号的键取字符串色（已知边界，如实记录）

- **WHEN** yaml 的键写成 `"k": v` 或 `'k': v`
- **THEN** 该键取字符串色，与同段里的引号值同口径；系统 MUST NOT 把它读成属性名。原因是 vendored `mode/yaml.js` 的引号分支排在键判定之前、产出的是 `string` token（与引号值同一个 token 名），token 名层面分不开键与值——要分开须改 vendored parser 的词法，本 change 非目标。本 scenario 是上一条 requirement 的**边界说明**，不是它的失效面

#### Scenario: 其它语言的 atom 不跟着变

- **WHEN** md 围栏 ```toml 代码块里出现表头 `[[hooks]]`、布尔 `true` 与日期，或 ```json 代码块里出现对象键
- **THEN** toml 的表头 / 布尔 / 日期仍取字面量色、json 的键仍取属性名色（MUST NOT 因 yaml 的键名修正而改变）

### Requirement: 折行口径与配置来源

`~/.config/lumir/config.json` 的 `[editor]` 表 SHALL 支持两个布尔项，键名与 Rust 字段名逐字一致
（沿用 `EditorConfig` 无 `serde(rename)` 的既有口径，`src-tauri/src/config.rs:70-75`）：

- `editor.line_wrap`：文件级折行，`true`（默认）/ `false`。`true` 时正文行在阅读栏内折行，
  `false` 时长行不折、由编辑区横向平移呈现。
- `editor.code_block_wrap`：代码块折行，`false`（默认）/ `true`。作用对象只有 md live preview 里的
  围栏与缩进代码块（代码块**不是 widget**，是行装饰：`src/preview/livePreview.ts:792-798`）。

两项 SHALL 与既有 `editor.mode` 走同一条装配链——各类型 `impl Default`（`config.rs:77-83`）、
宽容解析镜像上的 `#[serde(default)]`（`:142-146`）、`validate()` 逐字段回落到默认（`:237-247`）——
MUST NOT 为它们另开一条装载路径。取值不合法时 MUST 走既有 config warning 语义、不得导致启动失败
（ADR 0002 §5）：warning 出口沿用现状（console + 诊断日志的 `config_warning` 事件，
`src/main.ts:811-814`），本 change MUST NOT 新增 UI 面。

**已知边界（如实记录）**：类型不符（如 `"line_wrap": "yes"`）会在解析期让整份宽容结构失败、走整文件
回落（全部默认 + warning，`config.rs:200-209`），与 `editor.mode` 给错类型时同路。本 change MUST NOT
引入「逐字段类型容忍」——那是解析模型的变更，不应附带在新增字段里；实现 SHALL 用一条单测把这条
边界钉住，MUST NOT 把它读成「配置项没问题」。

装载时点 SHALL 与现状一致：只在启动装载（`src/main.ts:805` 是全仓唯一的 `config_get` 消费点，
无 watcher、无第二次读取），改配置需重启；运行期的口径变更由「折行开关的瞬态口径」承担。配置格式
随现状（config.rs 的「JSON 而非 TOML」选型，`config.rs:17-22`），本 change 不做格式迁移。新增字段
SHALL 经 ts-rs 导出到 `src/bindings/` 并受 bindings 漂移门禁约束（`scripts/gate.sh:61-70`）。

两个配置项是**输入面**：应用 MUST NOT 因运行期的折行翻转回写 `config.json`，MUST NOT 做 per-file 的
折行状态持久化（对比 Emacs：`toggle-truncate-lines` 只做 buffer-local 翻转、不落盘
[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。

#### Scenario: 缺字段时取默认

- **WHEN** `config.json` 的 `[editor]` 表里没有这两个字段（旧配置原样启动）
- **THEN** 正文行折行、代码块不折行（`line_wrap = true`、`code_block_wrap = false`）；不产生任何
  config warning

#### Scenario: 显式关闭文件级折行

- **WHEN** 配置 `{"editor": {"line_wrap": false}}` 后启动，打开一份含超长正文行的 Markdown
- **THEN** 该行不折行；光标可移到行尾，超宽部分可在编辑区（`.cm-scroller`）横向到达，MUST NOT 被
  裁掉且无法到达；文档内容逐字节不变

#### Scenario: 代码块折行可显式打开

- **WHEN** 配置 `{"editor": {"code_block_wrap": true}}` 后启动，打开一份含超长代码行的 Markdown
- **THEN** 代码块的长行在阅读栏内折行（与 M138 以来的现状一致），MUST NOT 出现块内横向滚动容器

#### Scenario: 类型不符走整文件回落

- **WHEN** 配置 `{"editor": {"line_wrap": "yes", "mode": "md"}, "keys": {"Cmd-s": null}}` 后启动
- **THEN** 产生 warning（console 与诊断日志的 `config_warning` 事件），整份配置按默认解释（这是本
  requirement 如实记录的既有边界，与 `editor.mode` 给错类型同路）；应用照常启动、可编辑
- **AND** 该边界 SHALL 由一条单测钉住（断言此时 `line_wrap` 与 `mode` 同时回到默认，MUST NOT 出现
  「部分字段按配置、部分按默认」的混合态）

### Requirement: 折行渲染与代码块横滚容器

折行的判定 SHALL 是「一元素一条规则」：代码块行（围栏 / 缩进代码块）由 `editor.code_block_wrap`
裁决，其余所有行（含只读 code 模式的正文行）由 `editor.line_wrap` 裁决；两者 MUST NOT 互相改写。
四条生效路径 SHALL 为：

| `editor.line_wrap` | `editor.code_block_wrap` | 正文行 | 代码块 |
|---|---|---|---|
| `true` | `false` | 栏内折行 | 不折行，块内横向滚动 |
| `true` | `true` | 栏内折行 | 栏内折行 |
| `false` | `false` | 不折行，编辑区横向平移 | 不折行，块内横向滚动 |
| `false` | `true` | 不折行，编辑区横向平移 | 栏内折行 |

文件级口径为「不折行」时，编辑区 MUST NOT 折行（`.cm-content` 落回 `white-space: pre`），超长行
SHALL 由 `.cm-scroller` 的横向滚动到达——「Horizontal scrolling automatically causes line
truncation」是本条的对齐口径（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)），
MUST NOT 使用会让内容不可达的方案（如 `overflow: hidden` 式的静默裁切）。

代码块口径为「不折行」时，块内每行 SHALL 不折行（行级 `white-space` 压回 `pre`、`overflow-wrap`
回到 `normal`），且该块 SHALL 由一个**块级横滚容器**承载，使超长行在容器内横向滚动。容器 SHALL：

- 复用 CM6 的 `BlockWrapper` 机制（与表格容器同一机制，`src/preview/livePreview.ts:234-279`）；
  MUST NOT 把代码块替换为 replace widget——源码 SHALL 保持可选中的原文、md 模式下仍可编辑；
- 可聚焦（`tabindex=0`）并带 `region` 角色与读屏可读的名字（与表格容器既有形态一致，
  `src/preview/livePreview.ts:262`）；
- 与表格滚动容器**共用同一「块级横滚容器」判据**，使既有五条 widget 滚动键（`←` `→` `Home` `End`
  `Escape`）对代码块同样生效；判据的 class 单一来源 SHALL 在 `src/keys.ts`（见
  `keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一键位表」）。MUST NOT 为实现横滚另加一条
  `keydown` 路径（键位通路仍只有统一键位表一条）；
- 提供代码块底板：横向滚到右侧时 MUST NOT 露出无底色的空白（底色仍取自既有 `--bg-2` 与 token 配色，
  `src/preview/theme.ts:59`、`:63-68`）；
- MUST NOT 引入额外的纵向内外边距：翻转开关带来的几何变化 SHALL 只来自折行本身。任何必要的间距
  SHALL 用 padding 表达、MUST NOT 用 margin（CM 按 border-box 量行高，margin 对高度图不可见，
  口径见 `src/preview/theme.ts:96-100`、`src/style.css:284-288` 的 M110 注释）；表格容器的
  `padding-block: 12px` MUST NOT 被照抄（它会把代码块下方所有行推走）。

两项口径 SHALL 遵守本 spec 的视口增量纪律（「live preview 装饰层」requirement）：块发现与装饰构建
MUST NOT 因本 change 变成全文档扫描。任何一项 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节
不变，ADR 0003 §3）。

既有例外原样保留：表格 cell 有自己的 `white-space: pre-wrap`（`src/style.css:325-326`）、块级公式与
mermaid 走自身 widget 渲染路径、表格容器自己的 `overflow-x: auto`——三者 MUST NOT 被本 change 改变。

#### Scenario: 默认口径下代码块不折行且块内可滚

- **WHEN** 默认配置下打开一份含超长代码行（长度超过阅读栏宽）的 Markdown
- **THEN** 该代码行不折行（不产生第二个视觉行），代码块在自己的容器内横向滚动；同一文档里的超长
  正文行仍照常折行（一元素一条规则）

#### Scenario: 文件级不折行 + 代码块折行

- **WHEN** 配置 `{"editor": {"line_wrap": false, "code_block_wrap": true}}` 后打开同一份文档
- **THEN** 代码块的长行在阅读栏内折行（无块内滚动容器），而正文的超长行不折行、由编辑区横向平移
  呈现——两级配置各自作用于各自的对象，互不改写

#### Scenario: 代码块容器的键盘可达性

- **WHEN** 默认配置下打开含超长代码行的 Markdown，用 `Tab` 把焦点移入代码块横滚容器，依次按 `→`、
  `End`、`Home`、`Escape`
- **THEN** 容器横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器内容区（行为与表格滚动
  容器一致）；全程文档内容逐字节不变、编辑器光标位置不变

#### Scenario: 横滚到右端不露白底

- **WHEN** 把代码块容器横向滚到最右端，读该区域的计算背景色
- **THEN** 代码块底板覆盖整块可见区域（与未滚动时同一色值），MUST NOT 出现无底色的空白条

#### Scenario: 容器不改变代码块的纵向节奏与文档内容

- **WHEN** 打开一份代码行都不超栏宽的 Markdown（默认配置），与 `code_block_wrap = true` 下同一份
  文档对照
- **THEN** 代码块的纵向占位与文字位置一致（容器不引入额外垂直位移）；两种配置下文档内容逐字节
  相同、dirty 状态不变

#### Scenario: 只读 code 模式的正文行走文件级口径

- **WHEN** 默认配置下打开一个非 md 文件（只读 code 模式），其某行长于栏宽
- **THEN** 该行按 `editor.line_wrap`（默认折行）呈现——`editor.code_block_wrap` 对 code 模式没有
  作用对象，MUST NOT 产生容器、MUST NOT 报错或提示

### Requirement: 折行开关的瞬态口径

折行的运行期翻转 SHALL 由两条命令承担，命令的 id、作用域、默认不绑键与面板口径见 `keymap-commands`
的「折行开关命令」requirement；本 requirement 只定**状态语义**。

折行口径的**运行期真源是应用运行期的一个值**（D1 裁决，2026-09-18）：两条命令的翻转 SHALL 作用于
**全部会话**，翻转后所有标签页（含当时不在前台的）SHALL 立即呈现同一口径，MUST NOT 出现「前台变了、
后台标签页还是旧口径」的错位；翻转 SHALL 立即生效，且 MUST NOT 改写文档（`EditorState.doc` 与磁盘
文件逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、MUST NOT 改变 dirty、MUST NOT 落盘
（`config.json` 的内容与 mtime 在翻转前后逐字节不变）、MUST NOT 做 per-file 持久化。

粒度上本 change 自觉偏离 Emacs 的对应物：`toggle-truncate-lines` 只把 `truncate-lines` 在**当前
buffer** 内变成局部值（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)），
而本 change 取应用运行期（Alex D1 原话「应用级。」）。由此两条推论 SHALL 成立：一，切标签页
SHALL NOT 改变折行口径；二，新标签页 SHALL 取**当前应用态**而不是配置默认——配置项给的是启动时的
起点，命令给的是运行期口径，重载/新建会话都不得退回配置值。重启后 SHALL 回到配置值（运行期值不持久化）。

本版 MUST NOT 为翻转提供 toast 播报或常驻指示（无 mode line）：翻转的可见结果即反馈。**已知观测
缺口（如实记录）**：当文档里没有超长行 / 没有代码块时，翻转没有可见效果，用户与 agent 都无法从界面上
读出当前状态。这是本版的自觉取舍（理由与替代落点见 proposal 的非目标）；若 dogfood 后确认为真实
痛点，按手感证据另提 change。

#### Scenario: 翻转立即生效、全体标签页一致且不落盘

- **WHEN** 通过 `[keys]` 绑定的键触发折行翻转（前台标签页有超长行与超长代码行，另有至少一个后台
  标签页打开着同类文档），随后比对 `config.json` 的内容与 mtime，并读文档内容与 dirty 状态
- **THEN** 折行口径立即变化（正文行与代码块按各自口径重新呈现）；切到那个后台标签页看到的同样是
  新口径；`config.json` 逐字节不变、mtime 不变；文档内容逐字节不变、dirty 不变、撤销栈不含本次
  翻转带来的条目

#### Scenario: 切标签页不改变折行口径

- **WHEN** 触发翻转（与配置默认相反），切到另一个标签页观察，再切回
- **THEN** 两次观察都是**翻转后**的口径——折行是应用运行期的显示口径，MUST NOT 随标签页切换退回
  配置值，也 MUST NOT 出现「某个标签页还停在旧口径」的第三种状态

#### Scenario: 新标签页取当前应用态

- **WHEN** 用与配置默认相反的配置启动，触发折行翻转，随后新建 / 打开另一个标签页
- **THEN** 新标签页按**当前应用态**呈现（而不是回到配置默认）；重启应用后所有标签页回到配置值

#### Scenario: 重启回到配置值

- **WHEN** 翻转后退出应用、重新启动，打开同一份文档
- **THEN** 呈现与配置一致（翻转是瞬态的，不持久化）；`config.json` 的内容与翻转前逐字节相同
