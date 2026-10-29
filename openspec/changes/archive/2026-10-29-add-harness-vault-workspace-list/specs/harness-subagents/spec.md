# harness-subagents 增量规格（change add-harness-vault-workspace-list）

> 起草注记（非规格正文）：本 delta 只改「工具集声明与默认收紧」一条——子运行可授予的闭集合随
> `vault_list` 入册扩为 9 件，缺省集**不变**（仍为只读三件）。缺省集是否扩到四件属独立裁决，
> 不在本 change 范围（记入 design §8 的 follow-up）。
>
> **MODIFIED 块的基线**：按当前 living spec（`openspec/specs/harness-subagents/spec.md`）的整块正文
> 复制再改。

## MODIFIED Requirements

### Requirement: 工具集声明与默认收紧

子运行的工具集 SHALL 来自定义的 `tools` 白名单，闭集合 SHALL 为 9 件 vault 操作工具（`vault_read` /
`vault_search` / `vault_list` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` /
`cli_run`）。`tools` 缺省时 SHALL 为只读三件 `vault_read` / `vault_search` / `skill_load`；`vault_list` 是
只读工具、**可由定义显式声明授予**（缺省集不变，仍为只读三件；声明的子运行因此能列目录）；写类
工具与 `cli_run` MUST 由定义显式声明后才可见。未声明的工具 MUST NOT 出现在子运行的工具定义里。
**缺省收紧只是缺省值，不是能力上限**：`tools` SHALL 接受上述 9 件工具的任意子集（含写类与
`cli_run`），声明后的可见性不受额外限制。工具集里 MUST NOT 包含 web 类工具——这是 harness 本体的
能力边界（主会话同样没有 web 工具），MUST NOT 被表述为「子代理被额外削减」；联网检索的现时方式是
`cli_run` 调用外部 CLI（与主会话同权，受权限管线与批准闸约束）。

工具是否可见（白名单）与是否放行（权限管线）SHALL 是两道独立的闸：白名单只决定子运行的工具定义，
放行仍走既有五层权限管线与三档权限模式，MUST NOT 因「子 agent」而放松或额外收紧用户选定的档位。
执行层 SHALL 对白名单做二次校验：白名单外的调用 MUST NOT 执行，回送 `tool_not_allowed`。

#### Scenario: 缺省只读

- **WHEN** 定义未写 `tools`
- **THEN** 子运行请求里的工具定义恰为 `vault_read` / `vault_search` / `skill_load`；写类与 `cli_run`
  对子模型不可见

#### Scenario: 显式声明写工具

- **WHEN** 定义声明 `tools: [vault_patch]`，且权限档为 `vault_write`
- **THEN** 子运行可调用 `vault_patch`，写入仍经既有工具语义与权限管线，MUST NOT 出现第二套写入通道

#### Scenario: 模型幻觉未声明工具

- **WHEN** 子运行模型发起一个不在白名单内的工具调用
- **THEN** 执行层拒绝并回送 `tool_not_allowed`，不执行该工具
