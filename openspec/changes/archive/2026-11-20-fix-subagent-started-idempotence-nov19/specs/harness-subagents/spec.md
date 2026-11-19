## ADDED Requirements

### Requirement: 子运行启动事件的段号幂等

子运行的 `subagent_started` SHALL 按 `(run_id, segment)` 判重：只有段号**大于**该 run 已在视图中的段数时，事件才构成 resume 新段。

- 段号不大于现有段数的 `subagent_started`（同段重复投递 / 旧段重放）MUST NOT 改变行状态：MUST NOT 把已收尾的 run 复活为运行中，MUST NOT 增加 `segments`，MUST NOT 清空读数、上一段的触顶原因、摘要或该段的待批关联。
- 合法新段 SHALL 沿用既有 resume 口径：同一 `run_id` 合并为同一任务身份，`segments` 取「现有段数 + 1」与事件段号的大者，`rounds` / `steps` / 用量跨段累计，上一段读数进段基线，上一段的待批关联失效。
- 首见即段 N（更早段的事件在前端缺失）时，行 SHALL 以事件段号建档（`segments = N`），MUST NOT 谎报为 1 段。
- 判重 SHALL 只有一处实现并落在事件归约层（`reduceSubruns`）；事件接线层 MUST NOT 另写一份段号判据。同一段号口径 SHALL 与快照合并的陈旧快照防线一致（段号不增 = 旧回包），两条入口对「新段 / 旧段」的结论 MUST NOT 分叉。

#### Scenario: 已收尾的 run 收到同段重复的 started

- **WHEN** 同一 `run_id` 的段 1 已收尾（`done`、`segments = 1`），随后又收到段 1 的 `subagent_started`
- **THEN** 行仍为 `done`、`segments` 仍为 1，轮次 / 用量 / 摘要原样保留

#### Scenario: 旧段重放不打断在跑的新段

- **WHEN** 一个 run 正在段 2 运行，收到段 1 的 `subagent_started` 重放
- **THEN** 行仍为运行中、`segments` 仍为 2，读数不变

#### Scenario: 段号更大的 started 才构成 resume

- **WHEN** 段 1 已收尾，随后收到段 2 的 `subagent_started`
- **THEN** 任务区仍只有一行，状态回到运行中、`segments` 为 2，上一段的轮次 / 用量进段基线并保留
