# pane-layout 增量规格

> 起草注记（非规格正文）：本 delta 只改「harness pane」一条 requirement，加入首启初始布局的
> 唯一例外与一个 Scenario。整条 requirement 的其余正文与全部既有 Scenario 逐字保留
> （MODIFIED 是整块替换）。

## MODIFIED Requirements

### Requirement: harness pane

harness 对话面板 SHALL 作为 pane 容器的一种内容件存在：一个 pane 要么承载一组文档标签，要么是 harness pane，二者必居其一。harness pane SHALL NOT 承载标签条与文档会话；「分栏态空 pane 不接受文本输入」条款 SHALL NOT 适用于 harness pane（它不是空 pane，其可编辑性是面板自身的输入区）。pane 命令族对 harness pane 的语义：`pane.close` 于 harness pane SHALL 等价于关闭 harness（同 `harness.toggle` 收起路径）；`pane.other` SHALL 可在文档 pane 与 harness pane 之间切换活跃；harness 在场时 `pane.split` SHALL 为无操作（上限二）。harness pane 的打开 SHALL 由 `harness.toggle` 承担：无第二 pane 时自动分栏（默认宽度比 harness:文档 pane = **1:1**——本值是本仓该默认值的 canonical 定义，其他 spec 只引用不重述），已有第二 pane 时该 pane 的文档标签并入另一 pane 后换位为 harness（沿用「移动标签非复制」口径，MUST NOT 丢标签）。

首启引导的初始布局是本条的唯一例外：真正首次启动的首个 vault 无标签时，首启引导 SHALL 以与 `harness.toggle` 相同的打开实现、`focusComposer = false` 施加一次 harness pane（机械条款见 `first-run-onboarding` 的「首启工作区初始构成」）。该次施加 SHALL NOT 抢焦点、SHALL NOT 新建 harness 会话 / JSONL、SHALL NOT 发送 preflight；既有 `harness_pane` 布局位 SHALL 照常落盘。它只发生在装载后的初始布局里一次，MUST NOT 构成用户可触发的第二开合通道；用户收起 harness 后，后续启动 MUST NOT 自动展开。

#### Scenario: 无第二 pane 时自动分栏打开

- **WHEN** 单 pane 开着文档，执行 `harness.toggle`
- **THEN** 自动分栏：文档 pane 与 harness pane 按 1:1 宽度出现（各占内容区一半）；文档标签与活跃 pane 归属不受影响

#### Scenario: 已有双文档 pane 时换位打开

- **WHEN** 已是双文档 pane（A | B），执行 `harness.toggle`
- **THEN** 其中一个 pane 换位为 harness pane，其文档标签按移动口径并入另一 pane——标签总数不变、无标签丢失、不触发关标签确认

#### Scenario: pane.close 于 harness pane

- **WHEN** harness pane 活跃时执行 `pane.close`
- **THEN** harness 收起（等价 `harness.toggle`），回到单文档 pane；无确认、无报错

#### Scenario: 首启空 vault 默认展开 harness pane

- **WHEN** 真正首次启动的首个 vault 装载完成且没有任何带路径的标签
- **THEN** harness pane 按 1:1 与文档 pane 并列在场；焦点不在 composer；没有新增 harness JSONL、没有发送 preflight；`vault-sessions/<id>.json` 的 `harness_pane` 为 `true`
