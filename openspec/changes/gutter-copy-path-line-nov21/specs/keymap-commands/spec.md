# keymap-commands 增量规格

> 起草注记（非规格正文）：本 change 给**行号 gutter** 补一条右键复制手势——把当前文档路径与
> 1-based 源行号以 `{path}:{line}` 写入剪贴板。接线、路径口径与失败面见
> [design.md](../../design.md)。ADDED 条不与 living spec 现有 requirement 同名；md gutter 的
> 三档在场合同与 goto-line 的行号口径均不改写。

## ADDED Requirements

### Requirement: 行号 gutter 的右键复制（`{path}:{line}`）

在 md 与只读 code 模式下，当行号 gutter（`lineNumbers()`）实际安装且可见时，用户在 gutter 的
可见面上右键，系统 SHALL 把**当前文档路径**与**指针所在行的 1-based 源文档逻辑行号**以精确形式
`{path}:{line}` 写入系统剪贴板：花括号是占位说明，输出 MUST NOT 含字面花括号；路径与行号之间
只有一个 `:`，冒号两侧 MUST NOT 有空格或其它字符。

路径口径 SHALL 复用会话的 `path` 原样——vault 内文档是 **vault 相对路径**（与 modeline 路径段 /
快速打开 / harness 路径链接同一份语义），vault 外只读文档是**绝对路径**（沿用既有外部路径
语义）。实现 MUST NOT 重写、补全、规范化或另算一份路径；MUST NOT 为无路径文档编造路径。
文档没有路径（未命名文档 / 空态）时 MUST NOT 写剪贴板、MUST NOT 显示成功提示，SHALL 走失败
反馈（见下）。

行号口径 SHALL 与 gutter 显示的行号一致：计数单位是 `view.state.doc` 的**源文档逻辑行**（硬换行
分隔、1 基、总行数 = `doc.lines`），软换行（视觉行）MUST NOT 参与计数。右键落在 gutter 的某个
行号元素上时取该行；落在 gutter 的空白处（块级 widget 覆盖的源行没有渲染数字、首行上方或末行
下方的留白）时，按该垂直位置对应的源行处理，边界处自然钳到首行 / 末行。这是 gutter 的
`BlockInfo` 语义，MUST NOT 为它新增第二份「行号 → 位置」映射。

右键复制 MUST NOT 修改文档内容、选区、dirty、撤销栈、模式、gutter 档位或阅读位置（滚动位置与
滚动快照）；MUST NOT 派发文档事务；MUST NOT 移动焦点。它只写剪贴板并给用户反馈。右键的
`mousedown` 默认行为（辅助键抢焦点）SHALL 被消费：`on-demand` 档下由跳转输入条带出的临时 gutter
因此 MUST NOT 在 `focusout` 中先被卸除，焦点 SHALL 保持右键前的归属，右键之后临时 gutter 与输入条
仍在场（直到用户按 Escape 收起）。原生的 `contextmenu` 默认行为 SHALL 被消费（不弹出浏览器 /
系统菜单）。

成功时 SHALL 复用既有 toast 机制（success tone）并逐字显示复制出去的 `{path}:{line}`。剪贴板
不可用、写入被拒（权限拒绝）或文档没有路径时，SHALL 给失败 toast 与一条 console 诊断线索；
MUST NOT 显示成功提示，MUST NOT 静默吞掉失败。成功与失败 MUST NOT 同时出现。

本要求 MUST NOT 改变行号 gutter 的在场合同：`[ui] markdown_line_numbers` 的
`"on-demand"` / `"always"` / `"off"` 三档语义与 code 模式恒常显 MUST 逐字不变，档位读取 /
回写时机也不变。右键能力只在 `lineNumbers()` 实际安装时存在；`"off"` 档、或 `"on-demand"` 档且
跳转输入条未打开时没有 gutter，也就没有本手势（不复制、不反馈）。本要求 MUST NOT 新增命令、
键位、配置项、右键菜单或持久化状态。

#### Scenario: md 模式首行 / 末行复制 vault 相对路径

- **WHEN** 打开一个 vault 内 md 文档（`ui.markdown_line_numbers = "always"`，路径含空格与中文），在行号 gutter 的第 1 行与末行上分别右键
- **THEN** 剪贴板分别是 `{path}:1` 与 `{path}:{末行号}`（路径逐字、1 基、无字面花括号）；出现 success tone 的成功提示且逐字包含复制出去的串；文档逐字节不变、dirty 不变、选区与滚动位置不变，原生右键菜单不出现

#### Scenario: code 模式首行 / 末行同一口径

- **WHEN** 打开一个只读 code 模式文本文件，在恒常显的行号 gutter 的首行与末行上右键
- **THEN** 剪贴板分别是 `{path}:1` 与 `{path}:{末行号}`，成功反馈与零副作用同 md 场景；行号与 gutter 显示的数字一致

#### Scenario: vault 外只读文档沿用绝对路径

- **WHEN** 通过快速打开打开一个 vault 外文件（只读会话），在其行号 gutter 上右键
- **THEN** 剪贴板以该文件的**绝对路径**起头并接 1-based 行号（`/…/name.md:1`），MUST NOT 改写成 vault 相对路径；文档仍只读、逐字节不变、不产生 dirty

#### Scenario: 剪贴板被拒时失败反馈、不假装成功

- **WHEN** 浏览器 / webview 拒绝 `navigator.clipboard.writeText`（权限被拒），用户在行号 gutter 上右键
- **THEN** 出现失败 toast（含失败原因），MUST NOT 出现成功提示；剪贴板内容不变，文档、选区、dirty 与滚动位置均不变

#### Scenario: `on-demand` 档的临时 gutter 也能复制且不收起输入条

- **WHEN** `ui.markdown_line_numbers = "on-demand"`（默认），打开 md 文档后按 `⌥G` 带出行号 gutter（跳转输入条持焦），在 gutter 第 1 行上右键
- **THEN** 剪贴板是 `{path}:1` 并出现成功提示；跳转输入条仍打开且仍持焦，gutter 仍在场（右键的 mousedown 默认行为被消费，没有触发输入条的 focusout 卸载）；随后按 `Escape` 输入条与 gutter 按既有合同收起

#### Scenario: 档位关闭时没有 gutter、也没有本手势

- **WHEN** `ui.markdown_line_numbers = "off"`（或 `"on-demand"` 且跳转输入条未打开），打开 md 文档并在原 gutter 位置右键
- **THEN** 没有行号 gutter，也没有复制动作与成功 / 失败反馈；剪贴板不变；`on-demand` 档打开跳转输入条后 gutter 出现，此时右键复制恢复可用

#### Scenario: 无路径文档不编造路径

- **WHEN** 文档没有路径（未命名 / 空态）而 gutter 在场，用户在 gutter 上右键
- **THEN** 不写剪贴板，出现失败反馈；MUST NOT 输出 `undefined:{line}`、`: {line}` 或任何编造的路径
