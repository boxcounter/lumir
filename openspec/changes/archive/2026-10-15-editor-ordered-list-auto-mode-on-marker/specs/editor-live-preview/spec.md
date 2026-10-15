# editor-live-preview 增量规格

> 起草注记（非规格正文）：本 change 落 Alex 2026-10-12 dogfood 两条——「1. 」（有空格）
> 不进入列表编辑态（缺陷①）、中文 IME 组合期重复插入「1. 」（缺陷②）。判定/事件层的
> 证据与取舍见 [design.md](../../design.md) 与 `test-results/m461-probe/readings.md`。

## ADDED Requirements

### Requirement: 裸 marker 行的列表编辑态（文本模式特判）

行首为合法列表标记（有序 `\d{1,9}[.)]`、无序 `-` / `+` / `*`）、标记后为空白至行尾
（空项）或带内容但**语法树未把该行认作列表项首行**的形态（典型：`para\n1. `——空
列表项按 CommonMark 不能打断段落，行是 lazy continuation），SHALL 在光标驻留时按
列表项首行进入列表编辑态：源码标记（含引用前缀与行首缩进）隐藏、显示既有列表
marker widget、悬挂缩进按字面标记宽与前缀列计算。判定是纯文本 + 语法树的纯函数
（`bareListMarkerLine`），与 `listLineInfo` 同文件同源；树已接管的形态（真列表、
空行后的 `1. `、列表自身的空续项、引用内 `> 1. `）MUST 由既有路径接管，裸行判定
MUST NOT 抢（同语义不得两处真源）。

排除面（MUST NOT 进入列表编辑态）：setext 标题下线（`para\n- ` 的 `- `，标题语义
优先，与 Obsidian 同口径）、围栏 / 缩进代码块、HTMLBlock、表格内的 marker 形文本。

门控 SHALL 取判据选区（reveal-gate 的按压快照口径）与行范围**相接即算**（含端点）：
光标在该行任何位置（含行首）即为驻留；光标在上一行行尾（= 本行行首前一字符）MUST
NOT 触发。光标离开该行即回到字面文本渲染。门控与渲染 MUST NOT 改写文档（行内源码
逐字节不变，ADR 0003 §3 铁律）。

#### Scenario: 段落后输入「1. 」进入列表编辑态

- **WHEN** 在一段正文之后的新行行首输入 `1. `（无空行间隔），光标驻留该行
- **THEN** 该行按列表项首行渲染（源码 `1. ` 隐藏、列表 marker widget 在场、悬挂缩进生效）；文档内容逐字节不变

#### Scenario: 光标离开裸 marker 行回到字面文本

- **WHEN** 把光标从该 `1. ` 行移到其他行
- **THEN** 该行回到字面文本渲染（`1. ` 原文可见）；两种状态下文档内容相同

#### Scenario: 语法树已接管的形态不受影响

- **WHEN** 文档首行或空行后输入 `1. `（语法树解析为真列表空项），或列表项行上按 Enter 续行
- **THEN** 既有渲染与 M399 空项退出行为逐字节不变（裸行判定对这些形态返回「不接管」）

### Requirement: IME 组合期不重复插入列表 marker

编辑器 MUST 在 DOM 输入入口（beforeinput）拒收 WebKit contenteditable 的原生自动
列表命令：`insertOrderedList` 与 `insertUnorderedList` 两个 inputType SHALL 被
preventDefault 并消费——本仓的列表编辑语义（裸 marker 行特判、上游续行、TAB 缩进）
是唯一合法的列表编辑路径，MUST NOT 允许原生转换绕过它产生文档变更。其余 inputType
（`insertText` / `insertCompositionText` / `insertParagraph` / 删除类等）MUST 放行，
且放行动 MUST NOT preventDefault。

已知边界（如实登记）：本拦截覆盖原生转换走 beforeinput 的形态；若 WebKit 以无
beforeinput 的裸 DOM 变更路径插入（自动化合成键盘事件不进 TSM，组合态无法在本层
复现），本拦截不兜，该形态留真机 dogfood 复验。

#### Scenario: 原生自动列表命令被拦下

- **WHEN** beforeinput 事件携带 inputType 为 `insertOrderedList` 或 `insertUnorderedList`（如 WebKit 原生 smart-list 转换，中文 IME 组合期为已报告的触发场景）
- **THEN** 事件被 preventDefault 且不再传播，文档逐字节不变，不产生任何列表结构

#### Scenario: 普通输入事件放行

- **WHEN** beforeinput 事件携带 `insertText` / `insertCompositionText` / `insertParagraph` 等其余 inputType
- **THEN** 事件不被消费、不被 preventDefault，输入照常到达编辑器

## MODIFIED Requirements

### Requirement: Enter 换行与自动缩进

`Enter` 在可编辑会话中的换行行为 SHALL 按**光标所在的结构上下文**分派，逐条口径如下
（各条的实测依据与来源见 change 的 `design.md` §1 / §4）：

- **md 模式的裸 marker 行**（M461，`para\n1. ` 等语法树不接管形态，判定见「裸 marker 行
  的列表编辑态」requirement）：光标在 marker 之后时，`Enter` 两态分派——**空项**
  （marker 后只有空白）SHALL 删去 marker 与其后空白：该行保留为空行、光标留在删后
  位置（引用前缀 / 行首缩进保留）、MUST NOT 额外新增行（Obsidian 惯例的退出语义）；
  **有内容** SHALL 插入换行 + 前缀原文 + 下一 marker（有序 = 字面序号 + 1、分隔符
  沿用；无序 = 同标记）。两态 MUST 各为单次事务（一次 Enter = 一次撤销步）。光标在
  marker 之前（行首结构前缀内）时本键 MUST NOT 接管（落回行首 Enter 的默认行为）。
  该分派在树驱动的续行命令之前检查；只读会话 MUST NOT 产生文档变更。
- **md 模式的列表项 / 引用内**：`Enter` SHALL 续写同级标记并保持该项的嵌套层级（无序项续标记、
  有序项续下一个序号、引用续 `> `）。这条是**既有行为**（编辑器内核所装 markdown 语言支持包
  自带的键位），本 change MUST NOT 改变它。**例外（M399，Alex 裁决的主流模式）**：空列表项
  （marker 之后只有空白）上的 `Enter` SHALL 删去一级列表标记——顶层空项变为普通空行（该行保留、
  光标留在该行行首、MUST NOT 额外新增行），嵌套空项凸一级（仍是列表项，逐层退出）。上游默认配置对「tight 两
  item 列表的空第二项」的「插空行把列表变松、marker 保留」分支 MUST NOT 再出现。该退出行为 MUST NOT 随
  `editor.auto_indent` 开关分叉（列表语义与缩进开关无关）。
- **code 模式**：`Enter` SHALL 插入换行，且新行的缩进 SHALL 取该文件语言的**语法缩进**（由编辑器
  内核的缩进服务按语法树判定）；该语言没有缩进规则时（如 `shell` / `toml` / `yaml` / 未收录扩展的
  纯文本），SHALL 沿用光标所在行的行首空白。
- **md 模式的围栏代码块与缩进代码块内**：`Enter` SHALL 插入换行并沿用光标所在行的行首空白。
  MUST NOT 在该上下文里续写列表标记（围栏内的 `- x` 是代码文本，不是列表项）。本 change MUST NOT 为围栏内容引入语法级缩进——围栏内容在编辑器的语法树里没有子语言，本 change 如实登记这条能力
  边界，MUST NOT 假装已覆盖。
- **md 模式的正文段落**：光标所在行行首无空白时，`Enter` 的呈现 SHALL 与现状一致（平换行，
  MUST NOT 凭空加缩进）。

缩进的写入单位 SHALL 是编辑器内核算法的出厂缩进单位（两个空格），与仓内既有 2 空格惯例一致；
本 change MUST NOT 为某门语言单设 4 空格。一次 `Enter` SHALL 是一次撤销步（MUST NOT 产生两步撤销）。
只读会话（`EditorState.readOnly`）里 `Enter` MUST NOT 产生任何文档变更。

**配置键 `editor.auto_indent`**（`[editor]` 表，布尔，**默认 `true`**）：`false` 时上列「code 模式」
与「md 的围栏 / 缩进代码块内」两条 SHALL 回到本 change 之前的行为（裸换行）；md 的列表 / 引用续行
MUST NOT 受本键影响（本键的作用面只有本 change 新增的两处，这条不对称是本 change 的显式口径，
不是漏实现）。键缺席 = 出厂 `true`，MUST NOT 跟随任何别的键。该键 SHALL 与 `editor.mode` 及三个
折行键走同一条装配链（各类型 `impl Default`、宽容解析镜像上的 `#[serde(default)]`、`validate()`
逐字段回落、ts-rs 导出、启动时装载一次）；类型不符 MUST 走既有的整文件回落（与 `line_wrap` 同路），
本 change MUST NOT 引入逐字段类型容忍。

`Enter` MUST NOT 被登记进统一键位表（`src/keys.ts` 的 `KEY_BINDINGS`）：它的分派点在编辑器内核内
（由 markdown 语言支持包自带的 `Enter` 键位优先，未命中才自动缩进）。代价如实登记：`Enter` 不进
`[keys]` 的重绑面、不进键位查看面板——理由与备选见 change 的 `proposal.md` 裁决项 D1 与
`design.md` §1.3。本 change MUST NOT 新增命令 id。

#### Scenario: 裸 marker 行空项 Enter 退出（M461，Obsidian 惯例）

- **WHEN** 在裸 marker 行（如段落下一行的 `1. `，语法树不接管形态；光标在 marker 之后）按 `Enter`
- **THEN** 该行的 marker 与其后空白被删去、引用前缀 / 行首缩进保留、该行保留为空行、光标留在删后位置，文档行数不变（MUST NOT 额外新增行）
- **AND** 退出是单次事务（一次撤销即回到按键前）

#### Scenario: 裸 marker 行有内容 Enter 续行（M461）

- **WHEN** 在带内容但语法树不接管的有序行（如段落下一行的 `2. abc`，非 1 起号不能打断段落）或引用内同形态（`> 2. abc`）行尾按 `Enter`
- **THEN** 插入换行 + 前缀原文 + 下一 marker（有序 = 字面序号 + 1、分隔符沿用；无序 = 同标记），光标落在新 marker 之后
- **AND** 续行是单次事务；光标在 marker 之前（行首结构前缀内）时本键不接管

#### Scenario: code 模式继承语法缩进

- **WHEN** 打开一份 `.js` 文件，光标移到 `const alpha = () => {` 的行尾并按下 `Enter`
- **THEN** 新行缩进两个空格（该语言的语法缩进，缩进单位为编辑器出厂值）
- **AND** 一次撤销即回到按键前的文档（一步撤销），磁盘文件在显式保存（`⌘S`）后逐字节等于编辑器内容

#### Scenario: 语言无缩进规则时沿用当前行

- **WHEN** 打开一份 `.toml`（或 `.sh` / `.yaml` / 未收录扩展的纯文本）文件，光标移到 `  [a]` 的
  行尾并按下 `Enter`
- **THEN** 新行沿用该行的两个空格（MUST NOT 退化成行首，也 MUST NOT 凭空增加一层）

#### Scenario: md 围栏代码块内沿用当前行缩进且不续列表标记

- **WHEN** md 文档里有 ```js 围栏代码块，光标在块内 `  if (x) {` 的行尾按 `Enter`
- **THEN** 新行缩进两个空格
- **AND** 块内的 `- x` 行按 `Enter` MUST NOT 被续写成 `- `（围栏内是代码文本，不是列表项）

#### Scenario: md 列表与引用的续行不变

- **WHEN** 在 md 的 `- alpha`（或嵌套的 `  - bravo`、有序的 `2. dos`、`> quoted`）行尾按 `Enter`
- **THEN** 续写同级标记并保持层级（无序 → `- `、嵌套 → `  - `、有序 → 下一个序号、引用 → `> `），
  与本次变更之前逐字节一致

#### Scenario: 空列表项上的 Enter 退出列表（M399 裁决）

- **WHEN** 光标在空列表项（`- ` / `2. ` 等 marker 之后只有空白的行，含 tight 两 item 列表的空
  第二项）上按 `Enter`
- **THEN** 该行的列表标记被删去、该行保留为普通空行、光标留在该行行首，文档行数不变
  （MUST NOT 额外新增行、MUST NOT 把列表变松）
- **AND** 嵌套空项（如 `  - `）按 `Enter` 凸一级（变为上一层级的空列表项），逐层退出

#### Scenario: md 正文段落平换行

- **WHEN** 在 md 的普通段落（行首无空白）行尾按 `Enter`
- **THEN** 新行不带任何缩进——呈现与本次变更之前一致，MUST NOT 凭空加缩进

#### Scenario: 关闭自动缩进

- **WHEN** 配置 `{"editor": {"auto_indent": false}}` 后启动，在 code 模式的文件里按 `Enter`
- **THEN** 新行为裸换行（退回本次变更之前的行为）
- **AND** 同样配置下，md 的 `- alpha` 行按 `Enter` 仍续写 `- `（本键 MUST NOT 关掉既有的续行行为）

#### Scenario: 缺字段时的默认与类型边界

- **WHEN** `config.json` 的 `[editor]` 表里没有 `auto_indent`（旧配置原样启动）
- **THEN** 取出厂 `true`（code 模式与 md 的围栏 / 缩进代码块内均自动缩进），不产生任何 config warning
- **AND** `"auto_indent": "yes"` 这类类型不符 SHALL 走既有的整文件回落（全部默认 + warning，与
  `line_wrap` 同路），该边界 SHALL 由单测钉住；本 change MUST NOT 引入逐字段类型容忍
