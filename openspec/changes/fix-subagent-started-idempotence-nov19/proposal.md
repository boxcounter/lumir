# Proposal: 子运行 started 事件按 `(run_id, segment)` 幂等

- Change ID: `fix-subagent-started-idempotence-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始要求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对 M845 缺陷的原始要求——「同类问题主动安排修复，不等裁决」。
> M845 的 finding（`.tower/comms/findings/20261119-worker-harness-async-bug-harness-subagent-started-run.md`）
> 坐实了重复 `subagent_started` 会把已收尾 run 复活并 `segments + 1`；tower 据此立项 M850，
> 并指定「按 run_id + segment 幂等、优先下沉到单一归约层」。本 change 不引入新的产品行为或
> 裁决点，修复面由该要求与 finding 直接决定。

## Why

### 现场

M845 的探针（纯函数，可复跑）发现：同一 `run_id` 的段 1 收尾后，再投递一次段 1 的
`subagent_started`，任务行会从 `done` 翻回 `running`、`segments` 从 1 变 2：

```
runs = reduceSubruns([], {type:"subagent_started", run_id:"r1", segment:1, ...})
runs = reduceSubruns(runs, {type:"subagent_finished", run_id:"r1", segment:1, status:"completed", ...})
→ [ { status: "done", segments: 1 } ]
runs = reduceSubruns(runs, {type:"subagent_started", run_id:"r1", segment:1, ...})   // 同段重复
→ [ { status: "running", segments: 2 } ]
```

代码路径（M845 提出时）：`handleEvent` 的 `subagent_started` 分支只判「同 `run_id` 已存在」即
`resumed`；`reduceSubruns` 的同 run 分支无条件按 resume 处理——status 回 running、`segments + 1`、
`segmentBase` 取累计值、`approvalIds` 清空。事件自带的 `segment` 字段（后端每段启动发一次，
见 `src-tauri/src/harness/events.rs` 的 `subagent_started`；`src/ipc.ts` 的 `HarnessEvent`
类型同样必带）在两条路径上都没有被消费。

### 为什么必须修

当前后端没有重复投递路径（tauri listen 同进程不重放），所以不是现网可复现缺陷；但它违反
「重复事件不制造非法状态」的合同：同一 `(run_id, segment)` 的重放会造出后端从未发出过的状态
（已收尾 run 复活、段数虚增）。同类对照显示其余入口已守住——终态事件重复到达是幂等的（读数为
「段基线 + 本段值」，不累加），批准重复到达也不重复关联（`attachRunApproval` 有 includes 判重）；
快照合并路径 `mergeLiveSubruns` 也已有陈旧快照防线（段号不增一律忽略）。缺的正是事件归约这一条。

### 为什么下沉到归约层

若只在 `handleEvent` 判重，纯函数 `reduceSubruns` 仍保留「同 run 即 resume」的语义——同一条
判据两处实现，测试只能覆盖其中一处，下一处调用方（含未来新增的恢复 / 重放路径）会再次踩空。
把判据收进 `reduceSubruns`（`isNewSegment` 唯一实现），事件接线层只消费归约结果，语义不再分叉。

## What Changes

- 新增 requirement「子运行启动事件的段号幂等」：`subagent_started` SHALL 按 `(run_id, segment)`
  判重——只有段号更大的事件构成 resume 新段；同段重复 / 旧段重放 MUST NOT 复活已收尾的 run、
  MUST NOT 加段、MUST NOT 清读数与待批关联。首见即段 N 时以事件段号建档。判重只有一处实现，
  且与快照合并的陈旧快照防线同口径。
- 实现：`src/harness-panel.ts` 新增 `isNewSegment`（resume 判定的唯一实现），`reduceSubruns`
  的 started 分支先过判重再走 resume / 建行；`handleEvent` 不再自己判「run 已存在 = resume」，
  改为共用 `isNewSegment` 决定是否收 resume 的重复任务行与刷新行。
- `SubrunEvent` 的 `subagent_started` 增加可选 `segment`（生产事件必带；可选只为让既有纯函数
  单测构造不带段号的旧形态——不带段号时无判重依据，按旧行为 resume）。
- 回归：新增 `tests/unit/harness-subagent-event-idempotence.test.ts`，覆盖同段重复（运行中 /
  已收尾）、旧段重放、合法新段（含跨段用量累加）、首见即段 N 六条。

## Non-goals

- 不改 `subagent_progress` / `subagent_step` / `subagent_finished` 的归约语义——终态重复已有幂等
  口径，乱序段号的终态不在本 change 取证范围内。
- 不改后端事件产出（无重复投递路径；后端本来就带 `segment`）、不改快照合并与恢复路径的行为
  （只要求口径一致，`mergeLiveSubruns` 现有防线不动）。
- 不改任务区的行渲染、文案、DOM 形态与视觉。
- 不新增视觉基线，不跑真机验收（纯归约层，无 UI 形态变化）。

## Impact

- 影响的 specs：`harness-subagents`（新增 requirement）。
- 影响的代码：`src/harness-panel.ts`（`isNewSegment`、`reduceSubruns`、`handleEvent` 的
  `subagent_started` 分支、`SubrunEvent` 类型）；新增 `tests/unit/harness-subagent-event-idempotence.test.ts`。
- 关联约束：REVIEW.md「同一语义两处真源」条（判据收口到一处）；既有「resume 段保持同一身份」
  requirement 的可见面口径不变。
