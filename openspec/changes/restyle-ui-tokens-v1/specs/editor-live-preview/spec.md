## MODIFIED Requirements

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
