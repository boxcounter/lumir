## ADDED Requirements

### Requirement: 撤回最近一条用户消息

面板 SHALL 在**最后一条用户消息**上提供撤回入口；撤回 SHALL 同时完成三件事：该消息及其后全部
轮次（assistant 正文、工具调用与结果、思考块）不再进入后续模型上下文、不再出现在显示历史、
原文回到 composer 供编辑。只把消息从显示面移除 MUST NOT 被当作撤回——模型上下文由会话 `input`
决定，显示面只是它的投影。

撤回 SHALL 创建新逻辑会话 B：`session_open` 记 `opened_from=withdraw` 与 `restored_from=<原会话
A>`，`system` / `assembly` 沿用 A，标题按 `session_title inherit` 继承，读数与子运行种子随首行
落账。B SHALL 在撤回动作内**立即发布**（不等首条真实请求），初始记录 SHALL 含
`withdraw_seed`——撤回点之前的 `input` 原样切片；恢复路径在没有 `llm_request` 时 SHALL 回落读它，
使「撤回后切走会话再回来」仍得到撤回点之前的历史而不是空会话。撤回 MUST NOT 改写 A 或任何既有
JSONL。

撤回成功 SHALL 删除 A 的留存文件：默认会话清单只剩 B 一行，MUST NOT 保留、隐藏或双份展示 A。
A 已有任何派生 / 恢复会话（`restored_from` 链能走回 A）时，撤回 MUST 被拒绝并给出明确原因；
MUST NOT 级联删除这些会话，MUST NOT 静默保留 A。派生检测 SHALL 在动作前与「发布 B 之后、删除 A
之前」各复核一次（第二次排除 B 自身）。

删除 A 失败时，系统 MUST 撤销本次新建的 B（清掉其发布文件）并保留 A，MUST NOT 报成成功，也
MUST NOT 改动原会话与 composer。任何失败路径 MUST NOT 先丢弃 A。

撤回 SHALL 只对**本进程发起的交互轮 / 重试轮**开放：在途（含 `Finishing` 与待批）MUST 被拒绝
（用户先停止），cron / 自动唤醒 / 子运行推入的用户项与「恢复出来但尚未在本进程发言」的会话
MUST 被拒绝并给出原因。停止 SHALL 保持「不再继续、不回滚」的既有语义，MUST NOT 被当作撤回。

工具副作用 MUST NOT 回滚。该轮出现过 `function_call` 时，首次调用 SHALL **不做任何动作**、只
回执工具名（去重、按出现序）；用户确认后再次调用才执行，届时全部校验与派生检测重新复跑。

composer 回填 SHALL 包含：用户消息的序列化文本（引用卡 / 消息摘录卡 / 图片占位按原交错）、
图片附件引用、显式 Skill 名，光标落在原文末尾；MUST NOT 包含自动注入的「当前编辑器上下文」节，
MUST NOT 包含显式 Skill 的正文（注入内容）。composer 原有内容非空时 SHALL 合并（撤回内容在前、
当前输入在后），MUST NOT 丢弃任何一边。

#### Scenario: 撤回后显示与上下文同时移除

- **WHEN** 用户对最近一条用户消息执行撤回且本轮没有任何工具调用
- **THEN** transcript 不再显示该消息及其后的 assistant 内容；composer 得到该消息原文且光标在末尾；
  下一条 `llm_request.messages` 不含该消息及其后任何项

#### Scenario: 原会话被物理删除、只剩新会话

- **WHEN** 撤回成功
- **THEN** 原会话 A 的 JSONL 不存在；A 的 vault 会话目录里有且只有 B 一份 JSONL；B 的首行
  `opened_from` 为 `withdraw` 且 `restored_from` 为 A 的 session id

#### Scenario: 撤回后切走会话再回来不复活

- **WHEN** 撤回成功后切到另一个会话，再从清单选中 B
- **THEN** B 从 `withdraw_seed` 恢复出撤回点之前的历史；被撤回的消息与其后轮次既不在面板上、
  也不在模型上下文里

#### Scenario: 在途先停止

- **WHEN** 轮次在跑（含等待批准）时请求撤回
- **THEN** 请求被拒绝（`harness_busy`），会话与文件都不变；用户停止本轮后再次撤回才执行

#### Scenario: 非交互来源不开放撤回

- **WHEN** 最近一轮来自 cron / 自动唤醒 / 子运行，或当前会话是从历史恢复且本进程尚未发言
- **THEN** 撤回被拒绝（`harness_withdraw_not_applicable`），并给出「不是你在本窗口发出的消息」
  的原因；文件与会话均不变

#### Scenario: 派生会话在场时拒绝

- **WHEN** A 的 `restored_from` 链上存在其它留存文件
- **THEN** 撤回被拒绝（`harness_withdraw_derived_exists`，回执列出派生 session id）；A 与派生
  文件都不被删除、也不创建 B

#### Scenario: 删除原会话失败时回滚

- **WHEN** B 已发布但删除 A 的 JSONL 失败
- **THEN** 本次新建的 B 被清理，A 仍是当前会话且其文件仍在；回执为失败
  （`harness_withdraw_delete_failed`），composer 不被改写

#### Scenario: 工具副作用只告知不回滚

- **WHEN** 被撤回的那一轮执行过 `vault_patch` / `cli_run` 等工具
- **THEN** 首次撤回请求不产生任何动作，只回执工具名；确认后的撤回照常完成，但已产生的副作用
  不被回滚——确认文案如实列出工具名并说明不会撤销

#### Scenario: composer 回填保留卡片与 Skill 引用

- **WHEN** 被撤回的消息含引用卡 / 图片引用 / 显式 Skill 选择
- **THEN** composer 里出现相同的文本、卡片与图片引用、Skill 名；文本不含自动注入的编辑器上下文
  节，也不含 Skill 正文

#### Scenario: 撤回不复活重试与自动命名

- **WHEN** 撤回前这一轮处于可重试失败态，或自动命名任务在途
- **THEN** 撤回后旧重试动作失效（`harness_turn_stale` / `harness_no_failed_turn`）；旧命名任务
  因 `session_id` 不符被丢弃，不给 B 落标题

#### Scenario: 重复触发幂等

- **WHEN** 撤回成功后再次请求撤回
- **THEN** 请求被拒绝且不产生第二份 B、不删除任何文件；会话清单仍只有 B
