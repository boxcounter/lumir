# editor-live-preview 增量规格

## ADDED Requirements

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

两条命令 SHALL 翻转**当前标签页**的瞬态显示状态，并 SHALL 立即生效：MUST NOT 改写文档
（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、MUST NOT 改变 dirty、
MUST NOT 落盘（`config.json` 的内容与 mtime 在翻转前后逐字节不变）、MUST NOT 做 per-file 持久化。
状态 SHALL 随标签页独立持有：切走再切回时该标签页的折行口径 SHALL 保持它自己的值，MUST NOT 出现
「内核单值错位到别的标签页」（这是本项目记过的陷阱形态：创建期闭包读可变实例变量，
`src/editor.ts:836-841`）。重启后 SHALL 回到配置值。

新标签页 SHALL 从**配置默认**开始；翻转 MUST NOT 改变新标签页的起点——这与 Emacs 的语义一致：
`toggle-truncate-lines` 只把变量在**当前 buffer** 内变成局部值，「until that time, the default
value, which is normally `nil`, is in effect」 指的是新 buffer 走默认
（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。

本版 MUST NOT 为翻转提供 toast 播报或常驻指示（无 mode line）：翻转的可见结果即反馈。**已知观测
缺口（如实记录）**：当文档里没有超长行 / 没有代码块时，翻转没有可见效果，用户与 agent 都无法从界面上
读出当前状态。这是本版的自觉取舍（理由与替代落点见 proposal 的非目标）；若 dogfood 后确认为真实
痛点，按手感证据另提 change。

#### Scenario: 翻转立即生效且不落盘

- **WHEN** 通过 `[keys]` 绑定的键触发折行翻转（当前标签页有超长行与超长代码行），随后比对
  `config.json` 的内容与 mtime，并读文档内容与 dirty 状态
- **THEN** 折行口径立即变化（正文行与代码块按各自口径重新呈现）；`config.json` 逐字节不变、
  mtime 不变；文档内容逐字节不变、dirty 不变、撤销栈不含本次翻转带来的条目

#### Scenario: 状态随标签页独立

- **WHEN** 标签页 A 触发翻转（与配置默认相反），切到标签页 B 观察，再切回 A
- **THEN** B 仍按配置默认呈现，A 保持它翻转后的值——切标签页 MUST NOT 把 A 的状态带进 B，也 MUST NOT
  把 A 的状态重置为默认

#### Scenario: 新标签页取配置默认

- **WHEN** 在当前标签页翻转后，新建 / 打开另一个标签页
- **THEN** 新标签页按配置默认呈现（翻转 MUST NOT 改变新标签页的起点）；重启应用后所有标签页也都回到
  配置值

#### Scenario: 重启回到配置值

- **WHEN** 翻转后退出应用、重新启动，打开同一份文档
- **THEN** 呈现与配置一致（翻转是瞬态的，不持久化）；`config.json` 的内容与翻转前逐字节相同
