# Proposal: 子运行过程 / 终态事件按段号丢弃旧段重放

- Change ID: `fix-subagent-segment-replay-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始要求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对同类缺陷的原始要求——「同类问题主动安排修复，不等裁决」
> （M850 Context 原话）。M850 的收尾 finding
> （`.tower/comms/findings/20261119-worker-subagent-event-idempote-bug-finished-resume-run.md`）
> 用纯函数探针坐实：resume 后旧段的 `subagent_progress` / `subagent_step` / `subagent_finished`
> 仍只按 `run_id` 匹配，段 1 的 `finished` 重放会把在跑的段 2 翻成终态、并以段 2 基线再叠一份
> 段 1 读数。本 change 不引入新的产品行为或裁决点，修复面由该要求与 finding 直接决定；与 M850
> （started 幂等）同一归约层、同一段号口径。

## Why

### 现场

M850 收尾时用 `reduceSubruns` 纯函数探针复现（脚本不落仓，事件序列可复跑）：

```
start(seg1) → progress(rounds 5, calls 1) → finished(seg1, rounds 5, input 80000)
→ start(seg2) → progress(seg2, rounds 1, calls 2)
→ { status: "running", segments: 2, rounds: 6, input: 80000 }   // 正确
→ finished(seg1) 重放
→ { status: "done", segments: 2, rounds: 10, input: 160000, summary: "段1" }  // 非法
```

代码路径：`src/harness-panel.ts` 的 `reduceSubruns`（M857 改动前的位置 `:2580` / `:2592` /
`:2602`）中，progress / step / finished 三个分支只按 `run_id` 匹配，不比对事件自带的 `segment`；
`handleEvent` 的三个分支也没有把 `segment` 透传进 `SubrunEvent`。后端四类 `subagent_*` 事件与
`src/ipc.ts` 的 `HarnessEvent` 本来就必带 `segment`（`src-tauri/src/harness/events.rs:214-304`），
缺口只在前端归约层。

### 为什么必须修

同 M850：现有后端每段结束只发一条 finished、tauri listen 同进程不重放，因此不是现网可复现路径；
它违反的是「重放 / 乱序事件不制造非法状态」的合同。M850 只修了 started 的 `(run_id, segment)`
幂等，旧段的其余三类事件仍能在跨 resume 边界后制造后端从未发出过的状态（新段被翻终态、读数翻倍、
摘要被旧段覆盖）。同段重复的 finished 本身是幂等的（写回「段基线 + 本段值」同值）——缺的只是
「事件属于哪个段」这个判据。

### 为什么仍在归约层收口

M850 已把 started 的判据收进 `reduceSubruns`（`isNewSegment`）。本 change 沿用同一归约层与同一
段号口径：progress / step / finished 的旧段判定（`isStaleSegmentEvent`）与 `isNewSegment` 是同一
条规则的两半，都对着 `run.segments` 判；`handleEvent` 只透传 `segment`，并用同一个判定决定收尾
副作用（待批收回 / 决策记录清理 / 快照刷新）是否执行——MUST NOT 另写一份段号判据，否则测试只能
覆盖其中一处，下一个调用方会再次踩空（REVIEW.md「同一语义两处真源」条）。

## What Changes

- 新增 requirement「子运行过程与终态事件的段号守卫」：`subagent_progress` / `subagent_step` /
  `subagent_finished` SHALL 消费事件自带的 `segment`——段号**小于**该 run 活跃段的事件 MUST 原样
  忽略（不改状态、不叠读数、不追加步骤、不覆盖摘要 / 触顶原因 / 待批关联）；段号等于活跃段的同段
  事件照旧归约，同段 finished 重复仍幂等；段号更大的乱序事件不在此丢弃（段基线重置另立项）。
- 实现：`src/harness-panel.ts` 的 `SubrunEvent` 三类变体增加可选 `segment`（生产必带；可选只为
  让既有纯函数单测构造旧形态）；新增 `isStaleSegmentEvent` 作为旧段判定的唯一实现，三个归约分支
  先过守卫；`handleEvent` 透传 `segment`，`subagent_finished` 的旧段重放不执行收尾副作用。
- 与 M850 同一口径补齐：`isNewSegment` 保留为 started 的唯一判据；首见即段 N 以事件段号建档。
- 回归：`tests/unit/harness-subagent-event-idempotence.test.ts` 覆盖 started 的六条既有场景，外加
  旧段 progress / step / finished、当前段正常序列、同段 finished 重复幂等、旧段 finished 在新段
  收尾后重放（读数不累加）五条。

## Non-goals

- 不改后端事件产出与 `src/ipc.ts` 的事件形状（后端本来就带 `segment`）。
- 不改「段号更大的乱序事件」的归约语义（如按段基线重置）：finding 明确该形态需单独立项定，本
  change 只丢弃确定的旧段事件。
- 不改快照合并 / 恢复路径（`mergeLiveSubruns` 的陈旧快照防线不动），只要求两条入口的段号口径
  不分叉。
- 不改任务区的行渲染、文案、DOM 形态与视觉；不新增视觉基线、不跑真机。

## Impact

- 影响的 specs：`harness-subagents`（新增 requirement，与 M850 的「子运行启动事件的段号幂等」
  同 capability、同口径）。
- 影响的代码：`src/harness-panel.ts`（`SubrunEvent`、`isNewSegment`、`isStaleSegmentEvent`、
  `reduceSubruns`、`handleEvent` 的三类事件分支）；新增
  `tests/unit/harness-subagent-event-idempotence.test.ts`。
- 关联约束：REVIEW.md「同一语义两处真源」条（段号判定收口到一处）；既有「中断恢复（resume）」
  requirement 的段语义不变（`segment` 递增、token 按段清零、面板读数跨段累计）。
