# pane-layout Specification Delta

> 起草注记（非规格正文）：harness 自动分栏的默认宽度比由 1:2 改为 1:1（Alex 2026-10-10 裁决）。
> 本 requirement 是该默认值的 **canonical 定义处**——`harness` / `ui-design-system` /
> `keymap-commands` / `vault-workspace` 四处只是括号内的复述，随本 change 一并改值并指向本处。
> 改动只涉及取值，不涉及「只在无存储比例时生效」的语义（`vault-workspace` 的「按 vault
> 持久化 pane 布局」）。

## MODIFIED Requirements

### Requirement: harness pane

harness 对话面板 SHALL 作为 pane 容器的一种内容件存在：一个 pane 要么承载一组文档标签，要么是 harness pane，二者必居其一。harness pane SHALL NOT 承载标签条与文档会话；「分栏态空 pane 不接受文本输入」条款 SHALL NOT 适用于 harness pane（它不是空 pane，其可编辑性是面板自身的输入区）。pane 命令族对 harness pane 的语义：`pane.close` 于 harness pane SHALL 等价于关闭 harness（同 `harness.toggle` 收起路径）；`pane.other` SHALL 可在文档 pane 与 harness pane 之间切换活跃；harness 在场时 `pane.split` SHALL 为无操作（上限二）。harness pane 的打开 SHALL 由 `harness.toggle` 承担：无第二 pane 时自动分栏（默认宽度比 harness:文档 pane = **1:1**——本值是本仓该默认值的 canonical 定义，其他 spec 只引用不重述），已有第二 pane 时该 pane 的文档标签并入另一 pane 后换位为 harness（沿用「移动标签非复制」口径，MUST NOT 丢标签）。

#### Scenario: 无第二 pane 时自动分栏打开

- **WHEN** 单 pane 开着文档，执行 `harness.toggle`
- **THEN** 自动分栏：文档 pane 与 harness pane 按 1:1 宽度出现（各占内容区一半）；文档标签与活跃 pane 归属不受影响

#### Scenario: 已有双文档 pane 时换位打开

- **WHEN** 已是双文档 pane（A | B），执行 `harness.toggle`
- **THEN** 其中一个 pane 换位为 harness pane，其文档标签按移动口径并入另一 pane——标签总数不变、无标签丢失、不触发关标签确认

#### Scenario: pane.close 于 harness pane

- **WHEN** harness pane 活跃时执行 `pane.close`
- **THEN** harness 收起（等价 `harness.toggle`），回到单文档 pane；无确认、无报错
