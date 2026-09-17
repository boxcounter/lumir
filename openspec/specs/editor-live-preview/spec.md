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

md 模式下系统 SHALL 用 CM6 decoration 实现 live preview：标题按级别呈现字号/字重、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、行内代码与代码块背景。装饰层 SHALL 采用视口增量构建（⚠ 裁决点 D，推荐项：只为可见区域构建 decoration，滚动时增量更新），MUST NOT 在打开文档时全量构建——打开 1MB Markdown <100ms 是 CI 绝对阈值（ADR 0002 §6）。该视口增量义务不含 frontmatter properties 区块——跨行 replace 装饰受 CM6 视口插件硬限制，其构建策略见 frontmatter-properties spec（StateField + 文档变更时重算 + 首部扫描有界）。**编辑态口径**（M1 只读期已结束，md 模式可编辑）：光标或选区触及的结构 SHALL 显露源码——callout 行（含其内容行的行内标记）、标准 Markdown 链接（整条）、frontmatter 块、公式与 mermaid widget、分隔线行；显露 SHALL 由选区驱动的装饰重建实现，MUST NOT 改写文档。装饰 MUST NOT 改变文档源码（ADR 0003 §3 铁律）。

#### Scenario: 标记符隐藏

- **WHEN** md 模式打开含 `**加粗**` 与 `# 标题` 的文档
- **THEN** 加粗文本以粗体呈现且不显示 `**`，标题按级别样式呈现

#### Scenario: 大文件视口增量

- **WHEN** 打开 1MB Markdown 文件
- **THEN** 只为可见区域构建 decoration，打开路径不超性能合同阈值；滚动到任意位置时该区域装饰即时生效

#### Scenario: 光标触及即显露源码

- **WHEN** 文档含 `# 标题`、`**加粗**`、callout 与一条标准 Markdown 链接，光标先停在正文、再移入 callout 首行、最后移入链接的显示文本
- **THEN** 前两次移动中加粗与标题仍为渲染态；移入 callout 首行时该行显露 `>` 与 `[!type]` 原文；移入链接时该链接整条（含 `]` 与 `(target)`）显露；光标移开后恢复渲染态，三种状态下 `EditorState.doc` 逐字节不变

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
2. **围栏代码块着色**：带 info string 且语言在收录表内的围栏代码块 SHALL 按该语言着色，token 色值 MUST 只取自既有 editorial token（MUST NOT 为此新增颜色）；同一段代码经围栏渲染与整文件（code 模式）打开时 SHALL 得到同一套 tag 与配色，MUST NOT 出现两侧漂移。info string 缺失、语言不在收录表内时 SHALL 保持纯文本（源码逐字保留，MUST NOT 用近似 parser 冒充着色）。块级 mermaid 走自身的 widget 渲染路径，不适用本条。围栏代码块的分隔行与源码 SHALL 保持可选中的原文，装饰 MUST NOT 吞掉字符。**已知例外（如实记录，缺陷在案）**：rust 的字符 / 字节字符字面量（simpleMode 的 `string.special` 复合 token）在围栏里丢 tag、取正文色，与 code 模式不一致——影响面已枚举（收录语言里只有 rust），finding 与修法见 `docs/backlog.md` 的「rust 字符字面量在围栏代码块里不着色」条；本条「两侧同 tag 同配色」在修复前对该类 token 不成立，MUST NOT 被读作已满足。
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

#### Scenario: 引用内的列表按常规列表渲染

- **WHEN** 打开含 `> - 甲` `> - 乙` 以及嵌套 `> > 1. 丙` 的 Markdown
- **THEN** 引用内的列表以常规列表呈现（标记换列表符号、正文缩进对齐、层级保留），`>` 与 `-` / `1.` 等标记在渲染态不可见；文档内容逐字节不变
