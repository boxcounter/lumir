## MODIFIED Requirements

### Requirement: 工具集声明与默认收紧

子运行的工具集 SHALL 来自定义的 `tools` 白名单，闭集合 SHALL 为 9 件 vault 操作工具（`vault_read` /
`vault_search` / `vault_list` / `vault_patch` / `vault_create` / `vault_move` / `vault_delete` / `skill_load` /
`cli_run`）。`tools` 缺省时 SHALL 为只读三件 `vault_read` / `vault_search` / `skill_load`；`vault_list` 是
只读工具、**可由定义显式声明授予**（缺省集不变，仍为只读三件；声明的子运行因此能列目录）；写类
工具与 `cli_run` MUST 由定义显式声明后才可见。未声明的工具 MUST NOT 出现在子运行的工具定义里。
**缺省收紧只是缺省值，不是能力上限**：`tools` SHALL 接受上述 9 件工具的任意子集（含写类与
`cli_run`），声明后的可见性不受额外限制。工具集里 MUST NOT 包含 `web_search` / `web_fetch`；交互主会话
新增这两件 Web 工具 MUST NOT 被解释为子运行同步扩权。子运行需要特殊站点或非 HTML 内容时，仍只能经
`cli_run` 调用外部 CLI，并受既有权限管线与批准闸约束。

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

#### Scenario: 主会话 Web 工具不扩权到子运行

- **WHEN** 交互主会话已注册 `web_search` / `web_fetch`，子运行定义声明 `tools: [web_search]` 或模型
  直接幻觉出 Web 工具调用
- **THEN** 该定义按闭集合外工具处理；幻觉调用回送 `tool_not_allowed`，子运行的 9 件 vault 工具边界不变
