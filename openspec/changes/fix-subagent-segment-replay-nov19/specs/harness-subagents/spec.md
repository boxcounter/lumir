## ADDED Requirements

### Requirement: 子运行过程与终态事件的段号守卫

子运行的 `subagent_progress` / `subagent_step` / `subagent_finished` SHALL 消费事件自带的
`segment`：段号**小于**该 run 活跃段（`segments`）的事件 MUST 视为旧段重放并原样忽略。

- 旧段 `subagent_progress` / `subagent_step` MUST NOT 改变行状态与读数：轮次 / 工具调用数 /
  最后工具 / 耗时 / 步骤列表保持当前段的值。
- 旧段 `subagent_finished` MUST NOT 把在跑的新段翻成终态，MUST NOT 以新段基线再叠一份旧段读数，
  MUST NOT 覆盖新段的摘要、触顶原因或待批关联。
- 段号等于活跃段的同段事件 SHALL 照旧归约；同段 `subagent_finished` 重复到达 SHALL 幂等
  （写回「段基线 + 本段值」的同值）。
- 段号大于活跃段的乱序事件不在本条丢弃（`started` 尚未到达的形态），保持既有归约行为；按段基线
  重置属另一个议题，需单独立项。
- 段号判定 SHALL 只有一处实现并落在事件归约层（`reduceSubruns`），与 `subagent_started` 的
  `isNewSegment` 共用同一 `run.segments` 口径；事件接线层 MUST NOT 另写一份判据，只按同一判定
  决定收尾副作用（待批收回 / 决策记录清理 / 用量快照刷新）是否执行。

#### Scenario: 旧段 finished 重放不打断在跑的新段

- **WHEN** 一个 run 的段 1 已收尾、段 2 正在运行，收到段 1 的 `subagent_finished` 重放
- **THEN** 行仍为运行中、`segments` 仍为 2，轮次 / 用量 / 摘要保持段 2 的值，MUST NOT 再叠一份
  段 1 读数

#### Scenario: 旧段 progress / step 重放不改变读数

- **WHEN** 段 2 在跑时收到段 1 的 `subagent_progress` 或 `subagent_step`
- **THEN** 轮次 / 工具调用数 / 最后工具 / 步骤列表原样保留

#### Scenario: 当前段事件与重复终态

- **WHEN** 段 1 依次收到 started / progress / step / finished，随后再收到一次段 1 的 finished
- **THEN** 正常序列全部生效、行落 `done`；重复的 finished 幂等，读数与摘要不变

#### Scenario: 合法新段照常 resume 且旧段重放不再累加

- **WHEN** 段 1 收尾后收到段 2 的 started、段 2 的 progress / finished，随后重放段 1 的 finished
- **THEN** 任务区仍只有一行，读数 = 段基线 + 段 2 本段值；旧段 finished 重放不改变读数与摘要
