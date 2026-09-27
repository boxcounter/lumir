# editor-live-preview Specification

## Purpose

定义编辑器单内核双模式（ADR 0002 §2）的落地口径：md 模式 = 高亮 + live preview 装饰层且可编辑、code 模式 = 仅高亮且只读（M130 的「非 md 即只读」）、按文件类型选模式、配置 `editor.mode` 仅作无类型线索时的默认；装饰层视口增量构建以满足打开 1MB <100ms 性能合同（ADR 0002 §6）。**编辑态口径**：md 模式下光标/选区触及的结构显露源码（callout 行、标准 Markdown 链接、frontmatter 块、公式与 mermaid widget、分隔线行），显露由选区驱动的装饰重建实现、不改文档——M1 期的只读口径已随编辑能力落地而作废。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；真实打开路径 perf 端点的演进义务见 perf-measurement spec），并由 `align-editor-live-preview-spec` 对齐到现状（2026-09-17，同时补记 M138 渲染保真三件套），由 change `code-outline` 归档并入（2026-09-24，实现 M197——代码文件的结构解析（语言分层注册表）与解析缓存），由 change `code-variable-highlight` 归档并入（2026-09-24，实现 M198——双击标识符高亮同一变量及其呈现与生命周期），并由 change `document-end-marker` 归档并入（2026-09-25，实现 M189——正文末尾的「到底了」结束标记：静态显示判据、与作者分隔线可区分的形态，以及「非文档性与几何稳定」两条新增 requirement），M259（2026-09-27，缺陷修复）补记显露的隐含前提：按压期间的落点判定 MUST NOT 跨布局。

## Requirements

### Requirement: live preview 装饰层

md 模式下系统 SHALL 用 CM6 decoration 实现 live preview：标题按级别呈现字号/字重、加粗/斜体/删除线隐藏标记符并渲染字形、列表符号美化、引用块样式、行内代码与代码块背景。装饰层 SHALL 采用视口增量构建（⚠ 裁决点 D，推荐项：只为可见区域构建 decoration，滚动时增量更新），MUST NOT 在打开文档时全量构建——打开 1MB Markdown <100ms 是 CI 绝对阈值（ADR 0002 §6）。该视口增量义务不含 frontmatter properties 区块——跨行 replace 装饰受 CM6 视口插件硬限制，其构建策略见 frontmatter-properties spec（StateField + 文档变更时重算 + 首部扫描有界）。**编辑态口径**（M1 只读期已结束，md 模式可编辑）：光标或选区触及的结构 SHALL 显露源码——callout 行（含其内容行的行内标记）、**强调范围（`**加粗**` / `*斜体*` / `~~删除线~~`，M168）**、标准 Markdown 链接（整条）、frontmatter 块、公式与 mermaid widget、分隔线行；显露 SHALL 由选区驱动的装饰重建实现，MUST NOT 改写文档。装饰 MUST NOT 改变文档源码（ADR 0003 §3 铁律）。

显露的**判定单位**分两级，两条口径 MUST 同时成立且互不替代：

1. **节点范围级**（强调范围、标准链接）：选区与该节点的源码区间相接即显露该节点。两条命令的**相接口径不同，各有其由**：强调范围取**含端点相接**（`sel.from <= to && sel.to >= from`）——范围两端邻接位的两侧都是隐藏定界符，空光标停在那里既测不到 caret 坐标、也够不到定界符，一并显露才能让「光标所在范围」始终有可编辑的原文；标准链接保持既有的**严格重叠**（`sel.from < to && sel.to > from`，M145 口径未动）。
2. **行级**（callout 内容行）：选区触及该行即显露该行全部 inline 标记（M119 既有口径，行级显露是节点范围级的超集，不因本条收窄）。

「不是行级」是节点范围级口径的要害：同一行里未被触及的另一个强调范围 MUST 保持渲染态；光标在范围外紧邻的字符位上（`from - 1`）该范围同样保持渲染态。

强调范围的显露 SHALL 同时撤下该范围的样式装饰与标记隐藏（编辑态下作者看到的是一段原文，不是「有样式的源码」）。行内代码不在本口径内：装饰层只给它加样式、不隐藏反引号，其标记在渲染态本就可见可编辑（cell 内 inline code 的断言见 tests/visual/scenes/table-foundation-v2.spec.ts），故它没有「进入范围才显露」这回事。

**按压期间的落点判定 MUST NOT 跨布局**（M259，真实桌面缺陷）：显露一落地就改变布局——被隐藏的定界符重新占宽（`**` 约 12px 量级）。而从指针按下（`mousedown`）到抬起（`mouseup`）之间，同一屏幕坐标 SHALL 始终映射到同一文档位置：判据选区在这段窗口内 MUST 取**按下瞬间的选区快照**，MUST NOT 取按压期间指针落下的活选区。否则按下时按当时布局算出的落点与之后每次指针移动按新布局重算的落点会落在不同位置，两个落点被当作一次拖拽，在一次点击（指针抖动即足以触发）上产生「误选中一个字符」的幻影选区，落点也不再是用户瞄准的那一个。适用面是**全部选区驱动的显露**（本节的节点范围级与行级、以及 frontmatter 块的显露），不是只修强调范围。快照窗口的关闭路径 MUST 覆盖抬起、失焦与文档变化三条——缺任一条，判据会永久停在被冻住的那一帧（静默失效）。

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

#### Scenario: 按压期间的落点判定不跨布局

- **WHEN** 文档含被隐藏定界符的强调范围（渲染态），指针在该范围内的任意横向落点按下，并在按住期间作一次小于一个字符宽度的位移（点击抖动量级）后抬起
- **THEN** 结果选区与「同一落点、无位移按下」的结果逐值相同——光标落在按下坐标对应的文档位置上、MUST NOT 产生非空选区；同一屏幕坐标的文档落点映射在按下与抬起之间逐值不变；抬起后显露照常跟随（光标落在范围内时该范围显露为原文）。区分度对照：位移达到真实拖拽量级时仍按拖拽语义产生选区；同一落点双击仍选整个词；指针窗口关闭后（抬起 / 失焦 / 文档变化）显露即刻跟随活选区

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；该配置 SHALL 只作用于没有文件上下文的文档（空态 / 新建 / reset）。打开文件时的模式 SHALL 由扩展名注册表唯一裁决：`.md`/`.markdown` → md 模式；其余一切已打开的文件（含未收录扩展、dotfile 与 basename 无点的文件）→ code 模式，**MUST NOT 回落 `editor.mode`**。该裁决 MUST NOT 随 `editor.mode` 的取值漂移：把配置在 `md` 与 `code` 之间切换不改变任何已打开文件的模式。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开（可编辑 + live preview）；配置值只对空态 / 新建文档生效

#### Scenario: 未收录扩展不回落配置默认

- **WHEN** `editor.mode = md` 且用户打开 `.log`、`.csv` 或 `.xyz` 这类未收录扩展的文件
- **THEN** 文件以 code 模式打开（可编辑；无语言包时按纯文本显示原文），MUST NOT 进入 md 模式或套用其装饰层

#### Scenario: 无扩展名文件一并不回落配置默认

- **WHEN** 用户打开 basename 无点的文件（如 `LICENSE`、`Makefile`）
- **THEN** 文件以 code 模式打开（可编辑），MUST NOT 按 `editor.mode` 进入 md 模式（M130 评审裁决的模式语义保留：非 md 不走 md 模式；editable-non-md-files 解除的只是只读）

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
2. **围栏代码块着色**：带 info string 且语言在收录表内的围栏代码块 SHALL 按该语言着色，token 色值 MUST 取自 design tokens 的语法高亮 token（`--tk-k` keyword / `--tk-s` string / `--tk-n` number / `--tk-c` comment，三主题各一份值；MUST NOT 在 token 层之外引入字面色值，MUST NOT 再借用 callout 色或正文层级色充当高亮色）；同一段代码经围栏渲染与整文件（code 模式）打开时 SHALL 得到同一套 tag 与配色，MUST NOT 出现两侧漂移。**该一致性 SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT 由两侧各自维护一份语言或配色表。** 语言相关的键名口径按各自 capability 条目处置：json 见「JSON 键名与值分色」，yaml 见「YAML 代码块的键名配色」。info string 缺失、语言不在收录表内时 SHALL 保持纯文本（源码逐字保留，MUST NOT 用近似 parser 冒充着色）。块级 mermaid 走自身的 widget 渲染路径，不适用本条。围栏代码块的分隔行与源码 SHALL 保持可选中的原文，装饰 MUST NOT 吞掉字符。着色 SHALL 受单一代码块长度上限约束（超过即回落纯文本，MUST NOT 因语言不同而放宽）。**已知例外（如实记录，缺陷在案）**：（a）rust 的字符 / 字节字符字面量（simpleMode 的 `string.special` 复合 token）在围栏里丢 tag、取正文色，与 code 模式不一致——影响面已枚举（收录语言里只有 rust），finding 与修法见 `docs/backlog.md` 的「rust 字符字面量在围栏代码块里不着色」条；（b）toml 的表头 `[x]` 与 `true` / `false`、日期共用 legacy mode 的同一个 `atom` token（`@codemirror/legacy-modes` 的 `mode/toml.js:44,57,59`），tokenTable 按 token 名映射、分不开三者，因此表头取的是字面量色（与数字、布尔同色）——两侧口径一致（不构成漂移），修它需要改 vendored mode 的词法，本 capability 记为接受现状，记 `docs/backlog.md`。本条「两侧同 tag 同配色」在（b）上成立、在（a）修复前不成立，MUST NOT 被读作已满足。
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
- **THEN** python 块按语言取色（色值取自 `--tk-*` 语法高亮 token），brainfuck 块按纯文本显示且源码逐字可读可选中；同一段 python 代码在只读 `.py` 文件（code 模式）里取到同一套配色

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

`~/.config/lumir/config.json` 的 `[editor]` 表 SHALL 支持三个布尔项，键名与 Rust 字段名逐字一致
（沿用 `EditorConfig` 无 `serde(rename)` 的既有口径，`src-tauri/src/config.rs`）：

- `editor.line_wrap`：**md 模式**的正文行折行，`true`（默认）/ `false`。`true` 时正文行在阅读栏内折行，
  `false` 时长行不折、由编辑区横向平移呈现。
- `editor.code_block_wrap`：代码块折行，`false`（默认）/ `true`。作用对象只有 md live preview 里的
  围栏与缩进代码块（代码块**不是 widget**，是行装饰：`src/preview/livePreview.ts`）。
- `editor.code_mode_line_wrap`（本 change 新增）：**code 模式**的正文行折行，`false`（默认）/ `true`。

**出厂口径是分叉的**：`line_wrap` 默认 `true`、`code_mode_line_wrap` 默认 `false`——同一份出厂配置下
md 折行、code 不折行。`code_mode_line_wrap` MUST NOT 跟随 `line_wrap`：键缺席 = 上列的出厂 `false`，
显式写 `true` 才把 code 模式也折起来。跟随口径被明确否决——它会让缺省值随用户改 `line_wrap` 漂移，
出厂分叉随之失效。两键的作用面互不重叠（各管各的模式），MUST NOT 互相改写。

三项 SHALL 与既有 `editor.mode` 走同一条装配链——各类型 `impl Default`
（`src-tauri/src/config.rs` 的 `impl Default for EditorConfig`）、宽容解析镜像上的 `#[serde(default)]`、
`validate()` 逐字段回落到默认——MUST NOT 为它们另开一条装载路径。取值不合法时 MUST 走既有 config
warning 语义、不得导致启动失败（ADR 0002 §5）：warning 出口沿用现状（console + 诊断日志的
`config_warning` 事件，`src/main.ts`），本 change MUST NOT 新增 UI 面。

**已知边界（如实记录）**：类型不符（如 `"line_wrap": "yes"` 或 `"code_mode_line_wrap": "yes"`）会在
解析期让整份宽容结构失败、走整文件回落（全部默认 + warning），与 `editor.mode` 给错类型时同路。
本 change MUST NOT 引入「逐字段类型容忍」——那是解析模型的变更，不应附带在新增字段里；实现 SHALL 用
单测把这条边界逐键钉住，MUST NOT 把它读成「配置项没问题」。

装载时点 SHALL 与现状一致：只在启动装载（`src/main.ts` 是全仓唯一的 `config_get` 消费点，无 watcher、
无第二次读取），改配置需重启；运行期的口径变更由「折行开关的瞬态口径」承担。配置格式随现状
（config.rs 的「JSON 而非 TOML」选型），本 change 不做格式迁移。新增字段 SHALL 经 ts-rs 导出到
`src/bindings/` 并受 bindings 漂移门禁约束（`scripts/gate.sh`）。

三个配置项是**输入面**：应用 MUST NOT 因运行期的折行翻转回写 `config.json`，MUST NOT 做 per-file 的
折行状态持久化（对比 Emacs：`toggle-truncate-lines` 只做 buffer-local 翻转、不落盘
[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。

#### Scenario: 缺字段时取默认

- **WHEN** `config.json` 的 `[editor]` 表里没有这三个字段（旧配置原样启动）
- **THEN** md 模式的正文行折行、md 的代码块不折行、code 模式的正文行不折行
  （`line_wrap = true`、`code_block_wrap = false`、`code_mode_line_wrap = false`）；不产生任何 config warning
- **AND** 键缺席时取到的就是**出厂分叉**（md 折 / code 不折）——本 change 的出厂口径即上列三项默认值，
  不需要用户配置任何东西

#### Scenario: code 模式缺字段时不跟随 line_wrap

- **WHEN** 配置 `{"editor": {"line_wrap": true}}`（显式打开 md 折行）后打开一个非 md 文件，其某行长于栏宽
- **THEN** 该行**不折行**——code 模式读的是 `code_mode_line_wrap`（缺席即出厂 `false`），
  `line_wrap` 的取值对它无可观测效果

#### Scenario: 显式关闭文件级折行

- **WHEN** 配置 `{"editor": {"line_wrap": false}}` 后启动，打开一份含超长正文行的 Markdown
- **THEN** 该行不折行；光标可移到行尾，超宽部分可在编辑区（`.cm-scroller`）横向到达，MUST NOT 被
  裁掉且无法到达；文档内容逐字节不变

#### Scenario: 代码块折行可显式打开

- **WHEN** 配置 `{"editor": {"code_block_wrap": true}}` 后启动，打开一份含超长代码行的 Markdown
- **THEN** 代码块的长行在阅读栏内折行（与 M138 以来的现状一致），MUST NOT 出现块内横向滚动容器

#### Scenario: 显式打开 code 模式折行

- **WHEN** 配置 `{"editor": {"code_mode_line_wrap": true}}` 后打开一个非 md 文件，其某行长于栏宽
- **THEN** 该行在阅读栏内折行；md 文档的呈现不受影响（`line_wrap` / `code_block_wrap` 各按自己的值生效）

#### Scenario: 类型不符走整文件回落

- **WHEN** 配置 `{"editor": {"code_mode_line_wrap": "yes", "mode": "md"}, "keys": {"Cmd-s": null}}` 后启动
- **THEN** 产生 warning（console 与诊断日志的 `config_warning` 事件），整份配置按默认解释（这是本
  requirement 如实记录的既有边界，与 `editor.mode` 给错类型同路）；应用照常启动、可编辑
- **AND** 该边界 SHALL 由单测钉住（断言此时 `code_mode_line_wrap`、`mode` 与同文件里的合法字段**一起**
  回到默认，MUST NOT 出现「部分字段按配置、部分按默认」的混合态）

### Requirement: 折行渲染与代码块横滚容器

折行的判定 SHALL 是「一元素一条规则」：代码块行（围栏 / 缩进代码块）由 `editor.code_block_wrap` 裁决，
**正文行由该模式自己的折行键**裁决——md 模式的正文行由 `editor.line_wrap`、code 模式的正文行由
`editor.code_mode_line_wrap`（本 change 新增的分叉）；任一轴 MUST NOT 改写另一轴。两个模式各自的生效路径
SHALL 为：

| 模式 | 正文行 | 代码块层 |
|---|---|---|
| md | `editor.line_wrap`：`true`（默认）栏内折行；`false` 不折、编辑区横向平移 | `editor.code_block_wrap`：`false`（默认）不折、块级横滚容器；`true` 栏内折行 |
| code | `editor.code_mode_line_wrap`：`false`（默认）不折、编辑区横向平移；`true` 栏内折行 | 无作用对象：非 md 没有围栏渲染，MUST NOT 装内容级 class、MUST NOT 产生容器 |

md 模式内部的两轴四组合（既有口径，本 change 不改）：

| `editor.line_wrap` | `editor.code_block_wrap` | md 正文行 | md 代码块 |
|---|---|---|---|
| `true` | `false` | 栏内折行 | 不折行，块内横向滚动 |
| `true` | `true` | 栏内折行 | 栏内折行 |
| `false` | `false` | 不折行，编辑区横向平移 | 不折行，块内横向滚动 |
| `false` | `true` | 不折行，编辑区横向平移 | 栏内折行 |

任一模式的文件级口径为「不折行」时，编辑区 MUST NOT 折行（`.cm-content` 落回 `white-space: pre`），超长行
SHALL 由 `.cm-scroller` 的横向滚动到达——「Horizontal scrolling automatically causes line
truncation」是本条的对齐口径（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)），
MUST NOT 使用会让内容不可达的方案（如 `overflow: hidden` 式的静默裁切）。**「不折行」的两个模式走的是同一条
呈现路径**（同一份 `.cm-content` 口径与同一个 `.cm-scroller`）：本 change MUST NOT 为 code 模式另造一套横向
平移机制。

代码块口径为「不折行」时，块内每行 SHALL 不折行（行级 `white-space` 压回 `pre`、`overflow-wrap`
回到 `normal`），且该块 SHALL 由一个**块级横滚容器**承载，使超长行在容器内横向滚动。容器 SHALL：

- 复用 CM6 的 `BlockWrapper` 机制（与表格容器同一机制，`src/preview/livePreview.ts`）；
  MUST NOT 把代码块替换为 replace widget——源码 SHALL 保持可选中的原文、md 模式下仍可编辑；
- 可聚焦（`tabindex=0`）并带 `region` 角色与读屏可读的名字（与表格容器既有形态一致）；
- 与表格滚动容器**共用同一「块级横滚容器」判据**，使既有五条 widget 滚动键（`←` `→` `Home` `End`
  `Escape`）对代码块同样生效；判据的 class 单一来源 SHALL 在 `src/keys.ts`。MUST NOT 为实现横滚另加一条
  `keydown` 路径（键位通路仍只有统一键位表一条）；
- 提供代码块底板：横向滚到右侧时 MUST NOT 露出无底色的空白（底色仍取自既有 token）；
- MUST NOT 引入额外的纵向内外边距：翻转开关带来的几何变化 SHALL 只来自折行本身。任何必要的间距
  SHALL 用 padding 表达、MUST NOT 用 margin（CM 按 border-box 量行高，margin 对高度图不可见）；表格容器的
  `padding-block` MUST NOT 被照抄（它会把代码块下方所有行推走）。

两项口径 SHALL 遵守本 spec 的视口增量纪律（「live preview 装饰层」requirement）：块发现与装饰构建
MUST NOT 因本 change 变成全文档扫描。任何一项 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节
不变，ADR 0003 §3）。

既有例外原样保留：表格 cell 有自己的 `white-space: pre-wrap`、块级公式与 mermaid 走自身 widget 渲染
路径、表格容器自己的 `overflow-x: auto`——三者 MUST NOT 被本 change 改变。

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
- **THEN** 容器横向滚动、滚到最右、回到最左，`Escape` 把焦点交还编辑器内容区（行为与表格滚动
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

> scenario 名沿用改动前的写法（「文件级口径」在 M180 时代指 `editor.line_wrap`）：本 change 起 code 模式
> 的正文行改由 `editor.code_mode_line_wrap` 裁决，名字保留是为了让归档对账逐条可追，**语义以本条正文为准**。

- **WHEN** 默认配置下打开一个非 md 文件（code 模式），其某行长于栏宽
- **THEN** 该行不折行（`code_mode_line_wrap` 出厂 `false`），超宽部分由编辑区（`.cm-scroller`）横向
  滚动到达、MUST NOT 被裁掉且无法到达；`editor.code_block_wrap` 对 code 模式没有作用对象，MUST NOT
  产生容器、MUST NOT 报错或提示
- **AND** 在同一份配置下打开一份 Markdown 时，其超长正文行仍照常折行（分叉的两半同框可判）
- **AND** 显式写 `{"editor": {"code_mode_line_wrap": true}}` 时该行改为在阅读栏内折行（覆盖键生效）

### Requirement: 折行开关的瞬态口径

折行的运行期翻转 SHALL 由两条命令承担，命令的 id、作用域、默认不绑键与面板口径见 `keymap-commands`
的「折行开关命令」requirement；本 requirement 只定**状态语义**。

`view.toggle-line-wrap` 翻的是**前台会话模式对应的那一个正文行轴**（本 change 明确的口径）：
前台是 md 会话时翻 `line_wrap`、前台是 code 会话时翻 `code_mode_line_wrap`。理由：code 模式的正文行已
只读 `code_mode_line_wrap`，若该命令恒翻 `line_wrap`，它在 code 模式下按下去将没有任何可见效果——
与 `keymap-commands` 的「配置绑定后真的能触发」正面冲突（该 scenario 要求「折行呈现立即变化、不是
无反应」）。`view.toggle-code-block-wrap` 的作用面不变（md 的围栏 / 缩进代码块），对 code 模式无可观测
效果。两条命令的 id、作用域（`global`）、默认不绑键状态 MUST NOT 因本 change 改变。

折行口径的**运行期真源是应用运行期的一组值**（D1 裁决，2026-09-18；本 change 起是三个轴）：两条命令的
翻转 SHALL 作用于**全部会话**，翻转后所有标签页（含当时不在前台的）SHALL 立即呈现同一口径，MUST NOT
出现「前台变了、后台标签页还是旧口径」的错位。三个轴各自独立：翻转 code 模式的轴 MUST NOT 改写 md
模式的两个轴（反之亦然）——分叉在运行期同样成立，命令只改「你眼前那个折行」。翻转 SHALL 立即生效，
且 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、
MUST NOT 改变 dirty、MUST NOT 落盘（`config.json` 的内容与 mtime 在翻转前后逐字节不变）、MUST NOT
做 per-file 持久化。

粒度上本 change 与既有口径一致（M180 的 D1，自 Emacs 的对应物 `toggle-truncate-lines` 有意偏离：
后者只把 `truncate-lines` 在**当前 buffer** 内变成局部值
[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）：
翻转是应用运行期的显示口径。由此两条推论 SHALL 成立：一，切标签页 SHALL NOT 改变折行口径；二，新标签页
SHALL 取**当前应用态**而不是配置默认——配置项给的是启动时的起点，命令给的是运行期口径，重载/新建会话
都不得退回配置值。重启后 SHALL 回到配置值（运行期值不持久化）。

本版 MUST NOT 为翻转提供 toast 播报或常驻指示（无 mode line）：翻转的可见结果即反馈。**已知观测
缺口（如实记录）**：当文档里没有超长行 / 没有代码块时，翻转没有可见效果，用户与 agent 都无法从界面上
读出当前状态。这是本版的自觉取舍（理由与替代落点见既有 change 的非目标）；若 dogfood 后确认为真实
痛点，按手感证据另提 change。

#### Scenario: 翻转立即生效、全体标签页一致且不落盘

- **WHEN** 通过 `[keys]` 绑定的键触发折行翻转（前台标签页有超长行与超长代码行，另有至少一个后台
  标签页打开着同类文档），随后比对 `config.json` 的内容与 mtime，并读文档内容与 dirty 状态
- **THEN** 折行口径立即变化（正文行与代码块按各自口径重新呈现）；切到那个后台标签页看到的同样是
  新口径；`config.json` 逐字节不变、mtime 不变；文档内容逐字节不变、dirty 不变、撤销栈不含本次
  翻转带来的条目

#### Scenario: code 模式下翻转的是 code 模式的轴

- **WHEN** 前台是 code 会话（非 md 文件，某行长于栏宽），通过 `[keys]` 触发 `view.toggle-line-wrap`
- **THEN** 该长行立即变为折行（再按一次回到不折行）——命令在 code 模式下 MUST NOT 是「按了没反应」；
- **AND** 切到任一 md 会话，其正文行的折行口径 MUST NOT 因这次翻转改变（三轴独立：翻 code 那一轴
  不改写 md 的两个轴）

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

### Requirement: 代码文件的结构解析（语言分层注册表）

code 模式（见「单内核双模式与可编辑性落地」）下的**结构信息** SHALL 由一张单一来源的**分层注册表**裁决：
「语言 → 是否有可用的结构解析器」。该表 SHALL 与既有的语言表（`src/preview/code.ts` 的 `LANGUAGES`，
键类型为 `preview/attachments.ts` 推导出的 `CodeLanguage`）同源、逐语言一一对应，MUST NOT 在消费者侧
（大纲、标识符高亮等）另写一份语言或能力清单。表的内容 SHALL 按下面两条判据裁决，两条都可逐门复核：

1. **有官方 `@lezer` 语法**（与既有依赖体系同源、随 CodeMirror 生态维护）。社区单维护者包 MUST NOT
   进入本表。
2. **该语法在普通代码上无阻断性缺陷**。`@lezer/yaml` SHALL NOT 进入本表：它在「文件以空行 + 注释行
   开头、其后是区块映射」时产出越界区间（`Document [65536, 11)`），使按位置取节点的消费者失效——这是
   实测复现的缺陷，不是推测。凡进入本表的语法都 SHALL 有实测证据支撑（探针读数与命令留档在 change
   的 evidence 目录）。

裁决结论 SHALL 至少区分三档并写进本条：**符号大纲 + 变量高亮**（javascript / typescript / python /
rust / go / c / cpp / java）、**只做大纲**（css / scss）、**不支持**（ruby / shell / toml / yaml / swift /
kotlin / lua / sql / json / html / xml）。不支持的档 SHALL 得到的处置是「没有结构可用」，MUST NOT
降级为文本级近似（正则、缩进、关键字扫描一律禁止）。

解析时机与缓存 SHALL 满足：① 结构解析 SHALL 只在**首次需要结构时**发生（每个消费者
各自定义「什么时候需要」——本 change 的消费者是「首次展开大纲」；同一份文档的解析结果在各消费者之间共用，
不重复解析），MUST NOT 在打开文件的路径上无条件解析，MUST NOT 在光标 / 滚动路径上解析；② 解析结果 SHALL
按「语言 + 文档内容」缓存复用（**缓存身份 = 文档内容**，MUST NOT 依赖文件路径、标签或编辑会话身份），
MUST NOT 在同一份内容上重复解析；③ 内容相同即命中缓存——换文件后若内容与已缓存的不同 SHALL 重新解析，
**切回内容相同的文件 SHALL 命中已有缓存、不重新解析**（外部重载与切换标签按同一口径判定）。
本条的前提是 **code 模式只读**（`editor-live-preview` 的只读合同）：文档在打开期间不变，内容键因此天然
对齐当前文档；若将来 code 模式可编辑，本条的内容键口径仍成立（每次编辑即新内容、新键），须另行审视的
只是缓存的淘汰口径。

**着色管线 MUST NOT 因本能力改变**：code 模式的着色来源 SHALL 仍是既有语言表上的 `StreamLanguage`
（`@codemirror/legacy-modes`），「Markdown 渲染保真」第 2 款的「同一段代码在围栏与整文件打开时得到同一
套 tag 与配色」SHALL 继续逐字成立。因此结构解析 MUST NOT 以占用 CM 语言位（`Language` facet）的方式
引入——同一 `EditorState` 里只有第一个 `Language` 生效；也不 MUST NOT 借语法包自带的 `styleTags` 去
改动着色。语法包在本条里**只贡献语法树本身**。

新增依赖 SHALL 限于结构解析所需的官方语法包，其清单、版本与体积 SHALL 记录在 change 的 design 与
实现 PR 里（逐包给 min / gzip 读数与许可核对结果）。性能与内存 SHALL 在实现期于**真机 / 产品端点**上
复测（大口径见 `perf-measurement`）：不在打开路径上新增全文解析是硬要求，而首次结构解析的耗时与解析
结果的常驻占用 SHALL 如实记录——不达标就写不达标，MUST NOT 用 headless 探针读数充当达标证据。

#### Scenario: 分档裁决逐语言可复核

- **WHEN** 在一份 `.py` 文件（受支持档）与一份 `.yaml` / `.lua` / `.sql` 文件（不支持档）里按 `⌘⇧O`
- **THEN** 前者列出符号条目；后者给「暂不支持大纲」的提示且不展开浮层；两侧都 MUST NOT 出现任何由文本
  匹配猜出来的条目

#### Scenario: 着色与围栏的一致性不受影响

- **WHEN** 同一段 javascript 分别在只读 `.js` 文件（code 模式）与 md 围栏 ```js 代码块里渲染
- **THEN** 两侧仍得到同一套 tag 与同一组色值（口径同「Markdown 渲染保真」第 2 款）；code 模式的着色来源
  仍是既有语言表上的 `StreamLanguage`，结构解析的引入 MUST NOT 改变任何 token 的取色

#### Scenario: 打开大文件不在打开路径上解析

- **WHEN** 打开一份 1MB 的代码文件（受支持语言）后不做任何操作
- **THEN** 没有发生全文结构解析（打开路径上没有该工作）；首次按 `⌘⇧O` 时才解析，且解析结果被缓存

#### Scenario: 解析结果缓存复用

- **WHEN** 在同一份文件上先按 `⌘⇧O`、关闭浮层、再按一次 `⌘⇧O`
- **THEN** 第二次不重新解析（复用缓存），条目与第一次逐条相同；切换文件后再切回，缓存按「缓存身份 =
  文档内容」的规则**命中**（内容未变，不重新解析；只有内容不同才解析）

#### Scenario: yaml 不因「有官方语法」而进入结构表

- **WHEN** 核对分层注册表里 yaml 的档位，并用最小复现（文件以空行 + 注释行开头，其后一行 `key: 1`）
  跑一次该语法的解析
- **THEN** yaml 在不支持档；复现证实该语法产出越界区间（`Document [65536, 11)`）从而使按位置取节点的
  消费者失效；MUST NOT 用「它是官方语法」为理由把它放进支持档

#### Scenario: 分层表只有一份

- **WHEN** 查阅代码模式的结构能力来源
- **THEN** 存在且只存在一份「语言 → 结构解析器 / 支持档」的表，内容与既有语言表的键一一对应；消费者
  （大纲、标识符高亮）只读它，MUST NOT 各自维护一份语言或能力清单（新增 / 删除语言时两侧同时生效）

### Requirement: 双击标识符高亮同一变量

在code 模式（见「单内核双模式与可编辑性落地」）下，双击一个标识符后，系统 SHALL 高亮该标识符在**当前文件**
里语法上属于**同一变量**的全部出现位置。判据 SHALL 全部落在结构解析树（见「代码文件的结构解析（语言
分层注册表）」）上，MUST NOT 使用正则、子串 / 全词匹配、或任何以选区文本为判据的文本匹配。

**触发判据 SHALL 是**：选区非空、单区间，且**完整包含于**选区起点处**最内层的一个「变量类位置」的
标识符节点之内**（`node.from ≤ sel.from && sel.to ≤ node.to`）；否则 MUST NOT 高亮。由此：

- **判据不依赖选区的完整性**：选区只覆盖标识符的一部分（例如 `$price` 在 `wordChars` 不含 `$` 的语言里
  只选中 `price`）时 SHALL 仍算命中，因为它是**包含于**节点，而不是等于节点。
- **匹配用的名字 SHALL 取节点原文，MUST NOT 取选区文本**：否则 `$price` 会退化成匹配 `price`（子串
  匹配）。
- 选区跨多个节点（拖选、含运算符的选区）时 MUST NOT 高亮。

**「同一变量」SHALL 由三层判据共同决定，任一层拿不到证据即 MUST NOT 点亮该候选**：

1. **位置类别**：源与候选都 MUST 落在「变量类位置」。变量类位置 SHALL 按语言逐一定义（节点名 + 父链，
   实现依据是 change 的 evidence 里逐语言的父链实测），至少覆盖：局部变量、函数 / 方法参数、模块 / 顶层
   变量与常量、`for` 一类绑定目标。**MUST NOT 收录为变量类**：成员 / 属性 / 字段名、类与方法 / 函数名、
   类型名、对象键、导入名。
2. **名字**：候选节点原文与源节点原文逐字节相同；MUST NOT 做大小写折叠或词法归一。
3. **可见域**：候选 MUST NOT 被更内层的同名声明隔开，且方向 MUST 合理——源所在声明容器是候选所在容器的
   祖先（或同容器、或候选在源的祖先链上），分属两个互不包含的容器（两个函数各自一个同名局部变量）
   MUST NOT 互相点亮。

**保守方向 SHALL 写死在实现口径里**：位置类别判不出来时 SHALL 按「可能是声明位」处理（少亮），源位置
判不出来时 SHALL 按「不是变量类」处理（不亮）——两个方向的落点都是「宁可漏、不可错」。

本能力 SHALL 只在分层注册表里「符号大纲 + 变量高亮」档的语言上生效（javascript / typescript / python /
rust / go / c / cpp / java）。其余语言（含 yaml、shell、sql、ruby、swift、kotlin、lua、json、html、xml）
双击后 MUST NOT 高亮，且 MUST NOT 给任何提示或 toast（这不是错误态）；MUST NOT 退回字符匹配。

**已知边界 SHALL 如实记录（MUST NOT 被读成已支持）**：变量提升与块作用域差异、闭包捕获时点、`global` /
`nonlocal` 一类显式跨层声明、动态名字（`eval` / `getattr` / 宏 / 反射）、跨文件（`import` 的来源）、
类型与重载——这些都需要语言语义，本能力不处理。因此本条 MUST NOT 被表述为「引用查找」或「精确的同
binding」：它是**语法位置 + 名字 + 容器链**的近似。

本能力 MUST NOT 改变选区、MUST NOT 抢焦点、MUST NOT 阻止鼠标默认行为；MUST NOT 新增键位、命令或配置项
（触发就是既有的原生双击）。

#### Scenario: 同一变量的多处出现被点亮

- **WHEN** 打开一份只读 `.py` 文件，内容含顶层 `LIMIT = 42`、函数体内的 `return LIMIT`（函数内无同名
  局部变量），双击任意一处 `LIMIT`
- **THEN** 两处 `LIMIT` 都被高亮（装饰出现），选区不变、文档内容逐字节不变

#### Scenario: 字符串与注释里的同名文本不点亮

- **WHEN** 文档里同名的文本同时出现在变量声明、字符串字面量（`"LIMIT"`）与注释（`// LIMIT`）里，双击
  变量声明
- **THEN** 只有变量与引用位置被高亮；字符串内部与注释内部的同名文本 MUST NOT 出现任何装饰

#### Scenario: 同名但不同类别不点亮

- **WHEN** 双击 `obj.count` 里的 `count`（成员名），或双击类名 / 方法名 / 类型名
- **THEN** 不发生高亮（这些位置不在变量类）；把实现放宽到「所有标识符类节点」时该断言 MUST 变红
  （反向验证口径见 change 的 design）

#### Scenario: 被更内层同名声明遮蔽时不点亮

- **WHEN** 顶层 `const LIMIT = 42` 与某函数体内的 `const LIMIT = 3`、两者各自的引用都在同一份 `.js` 文件里，
  双击顶层那条 `LIMIT`
- **THEN** 该函数体内的 `LIMIT` MUST NOT 被点亮（被更内层的同名声明隔开）；顶层那条与其它未被隔开的引用
  被点亮

#### Scenario: 分属两个函数的同名局部变量不互相点亮

- **WHEN** 同一文件里两个函数各有一个同名局部变量，双击其中一个
- **THEN** 只点亮该函数内的出现；另一个函数里的同名变量 MUST NOT 被点亮

#### Scenario: 选不全仍命中，且匹配取节点原文

- **WHEN** 语言含 `$` 前缀标识符（如 `$price`），双击时选区只覆盖 `price` 一部分
- **THEN** 仍按节点原文 `$price` 判定并点亮其它 `$price`；MUST NOT 退化成匹配 `price`（子串匹配的反向
  验证：把匹配文本改成选区文本，该断言 MUST 变红）

#### Scenario: 不受支持的语言静默

- **WHEN** 在一份 `.lua` 或 `.yaml` 文件里双击一个标识符
- **THEN** 不发生任何高亮，也 MUST NOT 出现 toast 或其它提示；MUST NOT 出现文本匹配式的高亮

#### Scenario: md 模式不受影响

- **WHEN** 在 md 模式的文档（含围栏代码块，内容与上述用例相同）里双击一个标识符
- **THEN** 本能力 MUST NOT 产生任何装饰；md 的既有选区显露口径逐字不变

### Requirement: 高亮呈现与生命周期

高亮 SHALL 以**装饰**（`Decoration.mark`）实现：MUST NOT 进入 `EditorState.doc`、MUST NOT 改变磁盘文件
的任何字节（ADR 0003 §3）、MUST NOT 改变字符与行高（几何稳定：装饰前后滚动高度逐像素相同）。

配色 MUST 只取既有 editorial token，MUST NOT 为本次功能新增颜色。高亮 SHALL 与同屏可能同时出现的
**原生选区**（源位置）与**文件内搜索的匹配高亮**（`.cm-searchMatch`，accent 淡底 + 当前项下划线）在计算
样式上**可区分**（三者互不相同），且 MUST NOT 复用搜索匹配的类名。

高亮的存在条件 SHALL 等于「触发判据成立」：选区清空、选区变为非标识符 / 跨节点选区、光标或点击移到
别处、切换标签或文件、文档重新装载时，高亮 SHALL 立即清除。重算 SHALL 只发生在**选区变化**与**文档
装载**两个事件上（只读模式没有键入路径）；MUST NOT 在每次选区变化时重走整棵树（SHALL 复用按文档缓存的
标识符索引）。

本条的高亮是**全文的**（一个变量在文件里的出现位置本身就是全文概念），与「文件内搜索只看视口」的既有
口径不同；这条差异是本条的明文口径，MUST NOT 被读成违反视口纪律。高亮 MUST NOT 产生可读文本、MUST NOT
触发 aria 播报（本次不引入任何文案）。

#### Scenario: 装饰不改文档也不改几何

- **WHEN** 双击一个多处出现的变量触发高亮，读取 `readDocument(page)` 与滚动容器 `scrollHeight`
- **THEN** 文档内容与 fixture 逐字节相同、`scrollHeight` 与触发前逐像素相同；键盘 `⌘A` 复制出的文本里
  不含任何附加内容

#### Scenario: 三层可区分

- **WHEN** 先 `⌘F` 搜索同一标识符（搜索命中在场），再双击该标识符触发高亮（选区与匹配同时在屏）
- **THEN** 原生选区、绑定匹配、搜索命中三者的计算样式互不相同（可直接比较 `getComputedStyle`）；把绑定
  匹配临时改成搜索匹配的样式表达式，该断言 MUST 变红

#### Scenario: 选区变化即清除

- **WHEN** 触发高亮后，把光标点到空白处（或按方向键移动光标、点击另一个标识符）
- **THEN** 上一次的高亮 SHALL 立即清除；点击另一个标识符时改为按新源判定（MUST NOT 残留旧装饰）

#### Scenario: 切换文件后不残留

- **WHEN** 在文件 A 里触发高亮，然后切到文件 B（再切回 A）
- **THEN** 文件 B 里 MUST NOT 出现任何来自 A 的装饰；切回 A 时装饰按当前选区重新判定（MUST NOT 复用
  上一文档的索引）

#### Scenario: 缓存复用而非重算

- **WHEN** 在同一份文件上先双击变量触发一次高亮，再清空选区、改双击另一个变量
- **THEN** 第二次 SHALL 复用已建好的标识符索引（MUST NOT 重新走整棵树）；该口径由实现期的读数或计数
  断言证明

### Requirement: 正文末尾的结束标记

md 模式下，正文末尾 SHALL 出现一个装饰标记，表明「正文到此结束、下面没有更多内容」。标记 SHALL 落在
最后一行之下、随内容滚动，并水平居中于阅读栏。

标记的出现判据 SHALL 只由**文档内容与视口**这一个静态关系决定：文档内容高度超过可用视口高度时显示，
一屏装得下时（含空文档、只有 frontmatter 的文档）MUST NOT 显示。判据 MUST NOT 依赖滚动位置、MUST NOT
依赖光标位置。窗口高度变化跨越该判据时，标记随之显示或隐藏（这是判据的直接推论，不是缺陷）。

判据的测量 SHALL 剔除标记自身的高度贡献：用于比较的量 SHALL 是不含标记的文档内容高度与可用视口高度，
MUST NOT 直接拿含标记贡献的滚动高度判定（否则标记一旦出现就把自己推过判据，装得下的文档也显示标记）。
若实现上剔除不便，可用迟滞——显示阈值与隐藏阈值错开且差值 SHALL 不小于标记高度。两种修法二选一。

标记的形态 SHALL 与作者书写的正文结构可区分：MUST NOT 与作者手写的分隔线同形（分隔线是**通栏**发丝线，
`src/preview/theme.ts:139-146` 的既有形态）——标记的横线 SHALL 短于阅读栏宽的一半，且 SHALL 夹着文字。
文字 SHALL 取弱化色（`--dim`）、线段 SHALL 取发丝线色（`--bd-2`），MUST NOT 使用朱红（`--accent` 留给
链接与错误态）。标记的可见文字 SHALL 与 `文案-Copy.md` 的 deck 条目逐字一致（单一来源，不得在实现里
另写一份串）。

标记 SHALL 只出现在 md 模式（live preview 装饰层）；code 模式（只读源码视图）MUST NOT 出现标记。
标记 MUST NOT 从属「光标或选区触及即显露源码」这条显露口径——它不隐藏任何源码，因此光标落在文档末尾
时标记照常显示。

已知边界（如实记录，本版不做）：标记的观感（线段长短、留白多少）归裁决者，门禁只判几何与语义；
标记只回答「正文到此结束」，不回答「你滚到哪了」（不做阅读进度读数，见 change 的 proposal 之 Non-goals）。

#### Scenario: 滚到长文档末尾看到标记

- **WHEN** 打开一份内容高度超过视口高度的 md 文档并滚动到底部
- **THEN** 正文最后一行之下出现标记，其渲染盒宽高均非零、水平居中于阅读栏；标记的横线总宽小于阅读栏
  宽的一半，且标记内存在文本节点（形态与作者手写的通栏分隔线可区分）

#### Scenario: 一屏装得下的文档不显示标记

- **WHEN** 打开一份内容高度小于视口高度的 md 文档（含空文档、只有 frontmatter 的文档），在同一滚动
  位置读取 DOM
- **THEN** 标记不存在；随后把同一份文档补长到超过一屏（或把视口压矮到装不下），标记出现——正观测
  保证「不存在」不是恒真（判据 MUST NOT 退化成「读不到即通过」）

#### Scenario: 判据不因标记自身的高度而自我成立

- **WHEN** 打开一份内容高度**恰好落在判据临界带内**（大于「可用视口高度 − 标记高度」、小于等于可用视口
  高度）的 md 文档，读取标记状态
- **THEN** 标记不存在；随后把同一份文档补长到明确超过可用视口高度，标记出现——这条覆盖的是「标记自己的
  高度计入判据所量的滚动高度」这一自我指涉：若判据未剔除标记自身的高度贡献，本 Scenario 的第一半会显示
  标记而 FAIL

#### Scenario: 判据不随滚动位置变化

- **WHEN** 在一份超过一屏的文档里分别停在顶部、中部与底部，各读一次标记的显隐与几何
- **THEN** 三次读数相同（同一份文档、同一视口下，标记的显隐只由内容与视口的高度关系决定）

#### Scenario: code 模式没有标记、文末光标不影响显示

- **WHEN** 打开一份非 md 文本文件（code 模式）；再打开一份超过一屏的 md 文档并把光标放到文档最后一行
- **THEN** 前者没有标记；后者标记照常显示（不从属显露口径），且 `EditorState.doc` 逐字节不变

### Requirement: 结束标记的非文档性与几何稳定

标记 SHALL 是应用渲染出来的装饰，MUST NOT 是文档内容：它 MUST NOT 出现在 `EditorState.doc` 里、MUST NOT
出现在保存到磁盘的字节里（ADR 0003 §3 铁律）、MUST NOT 被全选复制带出、MUST NOT 被文件内搜索命中。

标记 MUST NOT 使文档的滚动高度随滚动位置变化——在文档的任意滚动位置上，滚动容器的可滚动高度 SHALL
逐像素相同（防的是「接近底部时标记才参与布局、滚动条突然变长」这一类几何跳变，同族缺陷见
`src/preview/theme.ts:163-166` 记过的 heightmap 失配）。标记的高度 SHALL 固定；它的纵向间距 SHALL 用
`padding` 表达，MUST NOT 用 `margin`（CM 测量的高度不含 margin）。

标记 MUST NOT 在文档打开路径与键入路径上新增解析或测量工作：打开 1MB Markdown < 100ms 与
keypress-to-paint < 16ms 的绝对阈值（ADR 0002 §6）不因本能力放宽。

已知边界（如实记录）：显隐判据只读两个既有布局数——**不含标记自身贡献**的内容盒高度与滚动容器的可用
高度（常量级读取，不含逐帧监听、不读滚动位置），剔除自身贡献的口径见「正文末尾的结束标记」requirement；
MUST NOT 直接拿含标记贡献的滚动高度判定（那是同一 requirement 明文排除的写法）。判据是否会与编辑器自身
的尺寸观察机制互相干扰，已实测为**无反应**（标记落在内容盒之外，编辑器的三处观察面都看不到它，读数与机制
依据见归档件 `openspec/changes/archive/2026-09-25-document-end-marker/design.md` 的 §7 第 1 条）。

#### Scenario: 标记不是文档内容

- **WHEN** 在一份超过一屏的 md 文档上，全选并复制正文、用文件内搜索查标记的文案、再保存该文档
- **THEN** 复制得到的文本里没有标记的文案；搜索无命中；保存后磁盘文件的字节与打开时逐字节相同

#### Scenario: 滚动高度在所有滚动位置恒定

- **WHEN** 在一份超过一屏的文档里分别停在顶部、中部与底部，各读一次滚动容器的可滚动高度与可用高度
- **THEN** 三次读出的可滚动高度逐像素相同（标记的高度贡献与滚动位置无关）

#### Scenario: 标记与作者手写的分隔线同时在场且可区分

- **WHEN** 打开一份同时在正文里含作者手写分隔线、且内容超过一屏的文档，读两类元素的几何与配色
- **THEN** 两类元素都在场；分隔线的横线撑满阅读栏宽，标记的横线总宽小于阅读栏宽的一半且夹着文本；
  标记文字色为弱化色、线段色为发丝线色，两者的朱红通道均未被使用

### Requirement: 标题层级阶梯（H1–H6）

md 模式渲染态的标题 SHALL 按六级阶梯呈现，层级辨识度 SHALL 由字号单变量承担
（2026-09-25 Alex 裁决，三稿对比原型留档 `design/prototypes/heading-hierarchy/`）。
相对编辑器内容字号（`--editor-font-size`，出厂 15px）的字号比值 SHALL 逐档为
H1 `21/15`、H2 `18/15`、H3 `16/15`、H4 `1`、H5 `14/15`、H6 `13/15`（出厂基准读数
21/18/16/15/14/13px）；字重 SHALL 全档统一 `650`——字重 MUST NOT 承担层级区分；
字距 SHALL 取标题负字距档 `-0.009 / -0.007 / -0.005 / -0.004 / -0.002 / 0` em
（H1–H6 随字号递减）。

任何级别 MUST NOT 使用装饰手段承担层级（底线、竖杠、斜体、颜色变化）；H6 的
`italic` 与次级文字色（`--text-2`）旧形态 SHALL 退场。阶梯值 SHALL 经 token 层
（`--fs-h1`–`--fs-h6` = 21/18/16/15/14/13）取值，渲染层 MUST NOT 写字面值；
H4/H6 与正文档/UI 档同值时 SHALL 用独立命名的语义 token（`--fs-h4`/`--fs-h6`），
MUST NOT 跨语义引用 `--fs-body`/`--fs-ui`。三主题 SHALL 共享同一套阶梯值
（排版基因共享，只分档对比度）。

标题块距（上/下）SHALL 为 H1 `24px/9px`、H2 `20px/6px`、H3 `16px/5px`（定稿出处
沿用）、H4 `14px/5px`、H5 `12px/4px`、H6 `10px/4px`（补档，间距阶梯内取值）；
H4–H6 MUST NOT 再取零块距。H4 与正文同字号（15px）是裁决知情接受的代价，其与正文的
区分 SHALL 由 `650` vs `400` 的字重差与块距承担。

编辑器内容字号变化（配置或字号步进命令）时，六级标题 SHALL 按上表同一比值随动，
MUST NOT 出现「正文变了标题不变」的脱钩。本条 SHALL 由计算属性断言钉住（逐档读
`cm-lp-h1..h6`），MUST NOT 靠截图目测充当判据。

#### Scenario: 六级逐档取值

- **WHEN** 以出厂默认（内容字号 15px）打开含 `#` 到 `######` 六级标题的 Markdown
- **THEN** `.cm-lp-h1..h6` 的计算字号逐档为 21/18/16/15/14/13px、字重全为 650、
  字距逐档为 -0.009/-0.007/-0.005/-0.004/-0.002/0em；H2 与 H3 的字号差为 2px——
  辨识度全部由字号承担

#### Scenario: 零装饰

- **WHEN** 查看任一 H6 标题行
- **THEN** 无 italic、颜色取 `--text`（与正文同色 token）；旧形态（italic + `--text-2`）
  的计算样式读数不在场

#### Scenario: 阶梯随字号步进随动

- **WHEN** 出厂默认下按一次 `⌘=`（内容字号 15→17）
- **THEN** 六级标题按同一比值随动（如 H1 渲染为 17×21/15 对应的计算字号），
  六级间的相对关系不变

#### Scenario: 三主题同值

- **WHEN** 分别以 light / dark / eink 主题打开同一份含六级标题的文档
- **THEN** 六档的字号、字重、字距、块距逐项一致；eink 下不出现额外的层级色或装饰线

### Requirement: 单内核双模式与可编辑性落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮（纯文本形态，无装饰层）。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按扩展名注册表（`src/preview/attachments.ts` 的单一事实源）选择模式：`.md`/`.markdown` 用 md 模式；**其余一切已打开的文件一律用 code 模式**（含未收录扩展、dotfile 与 basename 无点的文件）——有语言包则高亮、无则纯文本；只有没有文件上下文（path 缺失）的文档才回落配置 `editor.mode`。

可编辑性 SHALL 按文件类裁决（editable-non-md-files，M130「非 md 即只读」的只读部分自此翻转，模式裁决语义保留）：md 模式恒可编辑；code 模式对注册表文本类（`fileClass` 为 `code` 或 `text`）文件**可编辑**——纯文本编辑 + 语法高亮，undo/redo、dirty、保存链路与 md 同口径；image/binary 类 MUST NOT 进入编辑器（分流与提示见 file-tree spec）。code 模式 MUST NOT 引入 live preview 装饰层。初始模式由配置 `editor.mode` 决定（既有接线保留）。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

#### Scenario: 非 md 文本文件可编辑打开

- **WHEN** 用户在配置 `editor.mode = md`（出厂值）下点击一个 `.php`、`.svelte`、`.txt`、未知扩展文件，或 `LICENSE`/`Makefile` 这类 basename 无点的文件
- **THEN** 该文件以可编辑 code 模式打开：视图层可编辑（`contenteditable` 在场、无 `aria-readonly` 只读态），键入/撤销生效并产生 dirty，Cmd+S 进入保存链路；无语言包时按纯文本显示原文

### Requirement: dotfile 与 JSONC 文件的语法高亮

打开 `.gitignore`、`.gitattributes`（按 basename **精确、大小写敏感**匹配）与
`.jsonc`（按扩展名）文件时，编辑器 SHALL 以 code 模式按对应语言着色：gitignore 的
`#` 注释、行首 `!` 取反标记与行尾 `/` 目录标记、gitattributes 的属性名与
`attr=value` 值、jsonc 的 `//` 与 `/* */` 注释、对象键、字符串、数字与布尔各归其
语义配色。文件名匹配 SHALL 优先于扩展名匹配（basename 约定是比扩展名更具体的信号）；
两个匹配表的键集 MUST 不重叠。未收录的 dotfile 与未收录扩展名 SHALL 保持纯文本
（MUST NOT 用近似 parser 冒充着色——既有口径不变）。配色 MUST 只取自既有 editorial
token，MUST NOT 为本次新增颜色。着色 MUST NOT 改写文档内容，`EditorState.doc` 与
磁盘文件逐字节不变（ADR 0003 §3 铁律）。同一段内容在围栏代码块（`gitignore` /
`gitattributes` / `jsonc` 三个 info string）与整文件打开时 SHALL 得到同一套 tag 与
配色——该一致性
SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT
由两侧各自维护。

#### Scenario: .gitignore 的注释与取反着色

- **WHEN** 用户打开内容为 `# comment`、`!keep.txt`、`build/` 三行的 `.gitignore`
  文件（code 模式）
- **THEN** `#` 至行尾取注释配色、行首 `!` 与行尾 `/` 取关键字配色，模式本体保持
  正文色，文档逐字节不变

#### Scenario: .gitattributes 的属性与值着色

- **WHEN** 用户打开内容为 `*.md text eol=lf` 的 `.gitattributes` 文件
- **THEN** `text` / `eol` 取属性名配色、`lf` 取字符串配色、`#` 注释行取注释配色，
  行首 pattern 保持正文色

#### Scenario: .jsonc 的注释与尾逗号

- **WHEN** 用户打开含 `//` 行注释、`/* */` 块注释与对象尾逗号的 `.jsonc` 文件
- **THEN** 注释取注释配色、对象键取属性名配色、字符串值与数字各归其配色，尾逗号
  不产生 error 着色；同一段内容在 md 围栏 `jsonc` 代码块里取到同一套配色

#### Scenario: 未收录 dotfile 保持纯文本

- **WHEN** 用户打开 `.secret`、`.env.local` 等未收录的 dotfile
- **THEN** 文件仍以 code 模式打开但按纯文本显示原文，不着色

#### Scenario: 文件名匹配优先于扩展名

- **WHEN** 某 basename 同时能命中文件名表与扩展名表（构造用例）
- **THEN** 按文件名表的条目裁决分类与语言

### Requirement: dotfile 与 JSONC 文件的可编辑性

`.gitignore`、`.gitattributes`、`.jsonc` 文件 SHALL 随注册表文件类（code 类）经
非 md 文本文件可编辑通道（change `editable-non-md-files`，M231）可编辑：编辑产生
dirty、Cmd+S 与自动保存、CAS 冲突恢复、崩溃备份、外部修改重载与 md 走同一保存链路。
可编辑性 SHALL 只由注册表文件类推导——本 capability MUST NOT 为这三类文件单设
可编辑开关或第二份白名单（REVIEW.md 第 8 条双表漂移防线）。若可编辑通道按白名单
形态落地，这三类 SHALL 在白名单内。可编辑通道落地前，三类文件维持只读 code 模式
（着色不受影响）。

#### Scenario: 三类文件随可编辑通道可编辑

- **WHEN** 非 md 可编辑通道已落地，用户打开 `.gitignore`（或 `.gitattributes` /
  `.jsonc`）并编辑、保存
- **THEN** 编辑落盘成功，保存链路（Cmd+S / 自动保存 / 冲突恢复）与 md 同口径；
  可编辑性的来源是注册表文件类，不存在仅作用于这三类文件的独立开关

### Requirement: 表格放大全屏查看

md 模式下经 live preview 渲染为 grid 的 pipe table SHALL 支持经命令 `table.toggle-fullscreen`
打开应用内全屏遮罩查看。命令的命中条件 SHALL 为下列之一：① 遮罩已打开（此时命令 = 关闭，
toggle）；② 编辑器 caret 落在一张**当前渲染为 grid** 的表内；③ 该表的滚动容器持有焦点。
命中条件不满足时命令 MUST NOT 消费事件（事件原样留给原生路径）。**降级表与非矩形表没有任何
打开路径**——它们没有 grid DOM（>64 KiB 源码或非矩形整块回退为源码的既有口径），「无入口」
SHALL 是「该表当前渲染为 grid」这一事实的结构性结果，MUST NOT 用降级提示或「强制放大」旁路模拟。

打开路径 SHALL 有两条（裁决点 3 的 D3 裁决：命令 + 表格 hover 触发钮双入口）：① 上面的命令；
② 表格右上角内侧的 hover 触发钮——四角框字形、`aria-label` 取 `文案-Copy.md` D124，零新 token、
无阴影、eink 黑框反白（热态黑底反白），静止态零足迹。触发钮 SHALL 锚定在**表格可视盒**的坐标系
（表格内容横滚时钮不动），且 SHALL 只对渲染为 grid 的表存在——降级表没有 `.cm-lp-table` 子树，
钮无处可挂，因此「降级表没有钮」与「降级表没有命令入口」是同一个结构性事实的两面。

全屏内容 SHALL 是该表打开那一刻渲染态 grid 的**只读快照副本**（含 cell 内已渲染的链接 / 行内代码 /
图片等 inline 形态），SHALL 由深克隆既有渲染 DOM 得到，MUST NOT 搬动 CM 管理的原 DOM 节点，
MUST NOT 从源码切片重建第二套呈现口径（那会丢掉全部 inline 渲染）。快照只读 SHALL 是结构性的
（克隆不带事件监听、不在编辑器 contenteditable 子树内），MUST NOT 以开关模拟。快照内表格 SHALL 按
自然尺寸呈现、不缩放不压缩，超出遮罩可视区的部分由遮罩内容器双向滚动承载。

遮罩 SHALL 覆盖窗口内容区并定位在文档流之外（打开与关闭 MUST NOT 引起文档区几何变化），SHALL 是
模态层：`role="dialog"` + `aria-modal="true"`，打开即持有焦点，持焦期间 `editor` 作用域的键
MUST NOT 穿透到文档，`Tab` SHALL 留在遮罩内；读屏名 SHALL 复用表格容器既有标签的同一来源
（`Markdown 表格 N`），MUST NOT 另写一份字面量。关闭路径 SHALL 有四条：`Esc`（遮罩上就地消费，
复用键位层 token 归一化，MUST NOT 为同一物理组合在统一键位表注册第二条绑定）、点击遮罩
（表格以外的区域）、再次执行 `table.toggle-fullscreen`（toggle）、焦点离开遮罩（`blur` 兜底，
MUST NOT 抢焦点）；四条 SHALL 回到同一个关闭实现，前三条关闭后焦点 SHALL 交还编辑器。
打开与关闭 SHALL NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、
SHALL NOT 改变选区或光标落点；表格的选区显露口径本 change 不加不减。文档代际变化（外部修改
重载）时遮罩 SHALL 关闭且 MUST NOT 抢焦点（视同 `blur` 兜底）——MUST NOT 留下「遮罩里是旧表、
文档里已是新表」的状态。

遮罩与快照的样式 MUST 只取既有 design token（`--scrim` / `--preview-bg` / `--border` /
`--shadow-raise` / `--r10` 等），MUST NOT 新增 token 与组件级色值；三主题（light / dark / eink）
SHALL 由 token 体系自然成立，eink 按既有浮层规则（无阴影、实心黑框升级线宽）。

#### Scenario: 打开、快照与四条关闭路径

- **WHEN** caret 在一张已渲染 grid 的表内，执行 `table.toggle-fullscreen`；随后依次按四组动作验证：
  按 `Esc`、再次打开后点击表格以外的遮罩区域、再次打开后再执行一次同一命令、再次打开后把焦点移到
  遮罩之外
- **THEN** 每次打开时遮罩可见且其中的表格快照渲染盒宽高非零、内容与文档内表格可见文本逐字节一致；
  四条路径都让遮罩从可见变为不可见；前三条关闭后焦点回到编辑器（随后的 `⌃D` 真的删掉一个字符）；
  `blur` 路径关闭且不抢焦点；全程文档内容与选区逐字节 / 逐值不变

#### Scenario: 降级表与非矩形表没有打开路径

- **WHEN** 在同一份文档里，caret 先后落在一张降级表（>64 KiB 源码）与一张非矩形表内，分别执行
  `table.toggle-fullscreen`；随后 caret 移进同文档里一张正常渲染的表再执行一次
- **THEN** 前两次都不出现遮罩、事件不被消费（原样留给原生路径）、不出现任何提示；最后一次正常
  打开遮罩——正观测保证「不出现」不是恒真

#### Scenario: 触发钮只对渲染为 grid 的表存在，且静止态零足迹

- **WHEN** 打开一份含正常表与非矩形（降级）表的文档，在静止态读 DOM、读屏树与表格几何；随后把
  指针移到正常表的可视盒上
- **THEN** 静止态：正常表的触发钮不可见（定位/绘制层面不存在，不进读屏树、不接收指针），表格的
  渲染盒与不含它时逐值相同；hover 后钮出现在表格可视盒右上角内侧、压在首行之上；降级表没有钮
  （没有 `.cm-lp-table` 子树可挂）

#### Scenario: 遮罩持焦期间编辑键不穿透

- **WHEN** 打开遮罩后依次按 `⌃D`、`⌃K`、`⌃A`、`Tab` 与若干字符键
- **THEN** 文档内容与光标位置逐字节不变（编辑键不穿透，`Tab` 不把焦点送出遮罩），遮罩仍持有焦点

#### Scenario: 快照保真——inline 形态与自然尺寸

- **WHEN** 打开一张 cell 内含行内代码、链接与图片引用的表的全屏遮罩；再对一张自然宽超过遮罩可用
  宽度的宽表打开遮罩
- **THEN** 前者的快照里行内代码 / 链接标记 / 图片保持渲染形态（不退回源码）；后者的快照按自然尺寸
  呈现且遮罩内容器横向可滚（不缩放、不压缩）

#### Scenario: 文档代际变化时遮罩退场

- **WHEN** 遮罩打开期间文档因外部修改重载（文档代际推进）
- **THEN** 遮罩关闭且不抢焦点（焦点去向由重载链路自身决定），不留「遮罩里是旧表」的状态

### Requirement: 全屏查看的快照与性能边界

全屏遮罩的 DOM SHALL 惰性建立（首次打开时建，MUST NOT 在文档打开路径上预建）；打开与关闭
MUST NOT 在键入路径与文档打开路径上新增解析或测量工作（ADR 0002 §6 的性能合同不因本能力放宽）。
打开动作 MUST NOT 触发全文档扫描——表格发现保持视口有界（既有 `tableDiscoveryRange` 纪律），
命令的表格定位 SHALL 复用缓存的表格模型。快照 MUST NOT 新增任何字节读取路径（不调附件读取、
不动 Rust 侧）；快照成本由「可渲染表源码 ≤64 KiB」的既有降级阈值天然有界，本 change 不设新上限。

已知边界（如实记录，本版不做）：键盘入口只有命令、默认不绑键（用户经 `[keys]` 绑定后生效），
鼠标入口是 hover 触发钮（裁决点 3 的 D3 双入口）；快照 = 打开那一刻**已渲染**的那部分表格
——CM 的 DOM 随视口有界（实测：700 行 / 60,764 B 的表只渲染 49 行），长表在全屏里只看到视口附近
的行，完整快照需要另一条渲染路径，是另一个 change；快照内的图片不响应双击再放大（快照只读语义
的应有之义；cell 内的图片引用今天不渲染为 widget 附件）；无文档内多表导航；遮罩内表格双向滚动的
手感归 dogfood 验收。

#### Scenario: 文档打开路径零新增

- **WHEN** 打开一份含多张表格的文档但一次都不执行 `table.toggle-fullscreen`，读 DOM
- **THEN** 文档的 DOM 里不存在全屏遮罩节点（惰性建立）；打开路径的解析与测量工作与本能力引入前
  一致

#### Scenario: 定位不触发全文档扫描

- **WHEN** 在一份大文档中部的一张表内执行 `table.toggle-fullscreen`
- **THEN** 表格定位经既有视口有界的缓存模型完成（无全文档表格扫描），遮罩正常打开
