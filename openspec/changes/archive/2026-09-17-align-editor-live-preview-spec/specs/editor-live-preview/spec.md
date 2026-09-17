# editor-live-preview 增量规格

## MODIFIED Requirements

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

## ADDED Requirements

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
