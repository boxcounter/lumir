# editor-live-preview 增量规格

## ADDED Requirements

### Requirement: Enter 换行与自动缩进

`Enter` 在可编辑会话中的换行行为 SHALL 按**光标所在的结构上下文**分派，逐条口径如下
（各条的实测依据与来源见 change 的 `design.md` §1 / §4）：

- **md 模式的列表项 / 引用内**：`Enter` SHALL 续写同级标记并保持该项的嵌套层级（无序项续标记、
  有序项续下一个序号、引用续 `> `）。这条是**既有行为**（编辑器内核所装 markdown 语言支持包
  自带的键位），本 change MUST NOT 改变它。
- **code 模式**：`Enter` SHALL 插入换行，且新行的缩进 SHALL 取该文件语言的**语法缩进**（由编辑器
  内核的缩进服务按语法树判定）；该语言没有缩进规则时（如 `shell` / `toml` / `yaml` / 未收录扩展
  的纯文本），SHALL 沿用光标所在行的行首空白。
- **md 模式的围栏代码块与缩进代码块内**：`Enter` SHALL 插入换行并沿用光标所在行的行首空白。
  MUST NOT 在该上下文里续写列表标记（围栏内的 `- x` 是代码文本，不是列表项）。本 change MUST NOT
  为围栏内容引入语法级缩进——围栏内容在编辑器的语法树里没有子语言，本 change 如实登记这条能力
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

`Shift-Enter` MUST NOT 被本 change 改变：它维持现状（裸换行）。因此 code 模式下两个键的行为从此不同
——这是知情的不对称（`Shift-Enter` 成为「插一个不缩进的裸换行」的逃生口），也是本 change 的显式
Non-goal。

#### Scenario: code 模式继承语法缩进

- **WHEN** 打开一份 `.js` 文件，光标移到 `const alpha = () => {` 的行尾并按下 `Enter`
- **THEN** 新行缩进两个空格（该语言的语法缩进，缩进单位为编辑器出厂值）
- **AND** 一次撤销即回到按键前的文档（一步撤销），磁盘文件在自动保存后逐字节等于编辑器内容

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

## MODIFIED Requirements

### Requirement: 折行口径与配置来源

`~/.config/lumir/config.json` 的 `[editor]` 表 SHALL 支持三个**折行**布尔项，键名与 Rust 字段名逐字一致
（沿用 `EditorConfig` 无 `serde(rename)` 的既有口径，`src-tauri/src/config.rs`）：

- `editor.line_wrap`：**md 模式**的正文行折行，`true`（默认）/ `false`。`true` 时正文行在阅读栏内折行，
  `false` 时长行不折、由编辑区横向平移呈现。
- `editor.code_block_wrap`：代码块折行，`false`（默认）/ `true`。作用对象只有 md live preview 里的
  围栏与缩进代码块（代码块**不是 widget**，是行装饰：`src/preview/livePreview.ts`）。
- `editor.code_mode_line_wrap`（本 change 新增）：**code 模式**的正文行折行，`false`（默认）/ `true`。

`[editor]` 表的第四个布尔键 `editor.auto_indent`（Enter 自动缩进）不在本 requirement 的作用面内，
它的口径见「Enter 换行与自动缩进」；本 requirement 只管折行三键，MUST NOT 被读成「`[editor]` 表
只有三个布尔键」。

**出厂口径是分叉的**：`line_wrap` 默认 `true`、`code_mode_line_wrap` 默认 `false`——同一份出厂配置下
md 折行、code 不折行。`code_mode_line_wrap` MUST NOT 跟随 `line_wrap`：键缺席 = 上列的出厂 `false`，
显式写 `true` 才把 code 模式也折起来。跟随口径被明确否决——它会让缺省值随用户改 `line_wrap` 漂移，
出厂分叉随之失效。两键的作用面互不重叠（各管各的模式），MUST NOT 互相改写。

三个折行项（连同 `editor.auto_indent`）SHALL 与既有 `editor.mode` 走同一条装配链——各类型
`impl Default`（`src-tauri/src/config.rs` 的 `impl Default for EditorConfig`）、宽容解析镜像上的
`#[serde(default)]`、`validate()` 逐字段回落到默认——MUST NOT 为它们另开一条装载路径。取值不合法时
MUST 走既有 config warning 语义、不得导致启动失败（ADR 0002 §5）：warning 出口沿用现状（console +
诊断日志的 `config_warning` 事件，`src/main.ts`），本 change MUST NOT 新增 UI 面。

**已知边界（如实记录）**：类型不符（如 `"line_wrap": "yes"` 或 `"code_mode_line_wrap": "yes"`）会在
解析期让整份宽容结构失败、走整文件回落（全部默认 + warning），与 `editor.mode` 给错类型时同路。
本 change MUST NOT 引入「逐字段类型容忍」——那是解析模型的变更，不应附带在新增字段里；实现 SHALL 用
单测把这条边界逐键钉住，MUST NOT 把它读成「配置项没问题」。

装载时点 SHALL 与现状一致：只在启动装载（`src/main.ts` 是全仓唯一的 `config_get` 消费点，无 watcher、
无第二次读取），改配置需重启；运行期的口径变更由「折行开关的瞬态口径」承担。配置格式随现状
（config.rs 的「JSON 而非 TOML」选型），本 change 不做格式迁移。新增字段 SHALL 经 ts-rs 导出到
`src/bindings/` 并受 bindings 漂移门禁约束（`scripts/gate.sh`）。

折行三个配置项是**输入面**：应用 MUST NOT 因运行期的折行翻转回写 `config.json`，MUST NOT 做 per-file 的
折行状态持久化（对比 Emacs：`toggle-truncate-lines` 只做 buffer-local 翻转、不落盘
[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。

#### Scenario: 缺字段时取默认

- **WHEN** `config.json` 的 `[editor]` 表里没有这三个折行字段（旧配置原样启动）
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
