# editor-live-preview 增量规格

## ADDED Requirements

### Requirement: 折行口径与配置来源

编辑器 SHALL 提供两个折行开关，取值来自**启动时读取一次**的配置（与既有 `editor.mode` 同一口径：
`config.rs` 的 `editor` 表内新增字段，ts-rs 导出；运行期改配置文件 MUST NOT 生效——本版不引入配置热重载）：

- `editor.line_wrap`（布尔，出厂 `true`）：文档正文的折行。`false` 时超长行 SHALL 截断显示（不折行），
  截断掉的部分 SHALL 经横向滚动可达——MUST NOT 出现「看不到且取不到」的内容。
- `editor.code_block_wrap`（布尔，出厂 `false`）：围栏代码块的折行。`false` 时块内超长行 SHALL 不折行，
  且 SHALL 在**代码块自己的**横向滚动容器里滚动；MUST NOT 让编辑器整体（标题与正文一并）出现横向滚动。

两个开关 SHALL 相互独立，同一元素上的折行判定 SHALL 只有一条规则：围栏代码块内的行（含围栏行本身）由
`editor.code_block_wrap` 裁决，其余一切行由 `editor.line_wrap` 裁决。`editor.line_wrap` SHALL 对 md 模式与
只读 code 模式一视同仁（现状即如此：折行装在会话上、与模式无关）。既有例外原样保留、不受两个开关影响：
表格 cell 的折行口径（表格自身 spec 持有）与块级数学公式 / mermaid widget 的横向滚动容器（各自渲染路径
持有）。

`editor.code_block_wrap` 的作用面 SHALL 只有 md 模式——围栏代码块只在 live preview 装饰层里渲染，非 md
文件以只读 code 模式打开、没有围栏渲染，该开关对它们无可观测效果。这不是缺口，是作用面如此。

**默认行为变更（如实记录）**：`editor.code_block_wrap` 出厂为 `false`，而本次变更之前围栏代码块是折行的
（代码块行继承内容区的 `white-space: break-spaces`，且没有块级滚动容器）。因此本变更落地后，含超长代码行的
文档呈现由折行变为截断 + 块内横滚。这是有意的出厂值，MUST NOT 被读作回归。

折行是纯视图属性：开关的取值与切换 MUST NOT 改动文档内容，`EditorState.doc` 与磁盘文件 SHALL 逐字节不变
（ADR 0003 §3 铁律）。代码块截断后，围栏行与源码 SHALL 仍以原文可选中、可编辑（md 模式下），MUST NOT
为了横向滚动把源码替换成只读副本。

开关切换 MUST NOT 引入折行本身之外的几何变化：折行容器 MUST NOT 使用外边距，MUST NOT 为折行容器引入块级
内边距（CM 按 border-box 量行高，外边距对高度图不可见、会造成落点漂移——既有表格滚动容器的同一纪律）。

#### Scenario: 出厂口径下代码块截断、正文折行

- **WHEN** 打开一份正文含超长段落行、且围栏代码块内也有超过栏宽的代码行的 Markdown，两个开关均为出厂值
- **THEN** 正文的超长行折行显示；代码块的超长行不折行、在代码块自己的横向滚动容器里可滚动看到全部内容；
  编辑器整体（含标题与正文）不出现横向滚动；`EditorState.doc` 与磁盘文件逐字节不变

#### Scenario: 代码块开关打开后恢复折行

- **WHEN** 配置 `{"editor": {"code_block_wrap": true}}` 后打开同一份文档
- **THEN** 代码块内的超长行折行显示、代码块内不再有横向滚动；正文的折行口径不因该配置改变

#### Scenario: 文件开关关闭后正文截断

- **WHEN** 配置 `{"editor": {"line_wrap": false}}` 后打开同一份文档（含以只读 code 模式打开的非 md 文件）
- **THEN** 正文超长行截断显示、经横向滚动可达；代码块的折行仍只由 `editor.code_block_wrap` 决定（两开关
  独立，互不覆盖）

#### Scenario: 开关切换不改文档、不改磁盘

- **WHEN** 依次切换两个开关（每个开关的两种取值都试过）
- **THEN** `EditorState.doc` 与磁盘文件逐字节不变；md 模式下正文与代码块的源码仍可选中、可编辑

### Requirement: 折行开关的瞬态口径

两个折行开关 SHALL 可经命令在运行期翻转（命令 id、作用域与键位归属见 `keymap-commands` 的「折行开关命令」）。
翻转的语义 SHALL 是**当前标签页的瞬态覆盖**（Emacs `truncate-lines` 的 buffer 局部模型的对应物）：

- 翻转 SHALL 立即生效：MUST NOT 要求重新打开文件，MUST NOT 重建 EditorView，MUST NOT 丢失文档状态或选区；
- 翻转 SHALL 只作用于当前标签页——其它已打开的标签页 SHALL 保持各自的取值；
- 该值 SHALL 随标签页存活，标签页关闭或应用重启后 SHALL 回到配置取值；新开的标签页 SHALL 从配置取值开始
  （翻转 MUST NOT 改变「新标签页从什么值开始」）；
- 翻转 MUST NOT 写入配置文件，也 MUST NOT 产生任何 per-file 持久化（本变更明确不做 per-file 持久化）。

翻转 SHALL 给出一次瞬态反馈，写明翻转的是哪一项折行、变成了什么状态（形态沿用既有瞬时提示，文案见
`文案-Copy.md`）。理由：文档里没有超长行时，翻转不产生任何可见差异，反馈是「生效了没有」的唯一可观测判据。

#### Scenario: 翻转立即生效且只影响当前标签页

- **WHEN** 打开两份都含超长代码行的文件 A 与 B、停在 A，执行代码块折行翻转命令，随后切到 B 再切回 A
- **THEN** A 的代码块立即改变呈现（不需要重开文件）；B 仍按配置取值呈现；切回 A 时 A 的翻转取值仍在

#### Scenario: 翻转不落盘、重启回配置值

- **WHEN** 执行翻转命令后核对配置目录，随后重启应用并重新打开同一文件
- **THEN** `config.json` 的内容与 mtime 在翻转前后逐字节 / 逐时间戳不变（翻转未写盘）；重启后该文件的呈现
  回到配置取值

#### Scenario: 翻转有可观测反馈

- **WHEN** 在没有任何超长行的文档上执行任一翻转命令
- **THEN** 出现一次瞬时提示，写明该折行项与其新状态（该文档下画面本身无差异，提示是唯一的可观测判据）
