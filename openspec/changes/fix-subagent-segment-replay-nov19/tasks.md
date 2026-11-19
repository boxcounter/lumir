# Tasks: fix-subagent-segment-replay-nov19

## 1. 合同与实现

- [x] 1.1 在 `openspec/changes/fix-subagent-segment-replay-nov19/specs/harness-subagents/spec.md` 加入「子运行过程与终态事件的段号守卫」requirement 与四条可判定 scenario（旧段 finished / 旧段 progress·step / 当前段与重复终态 / 合法新段与旧段重放不累加）。
- [x] 1.2 `src/harness-panel.ts` 的 `SubrunEvent` 四类事件增加可选 `segment`（生产必带，可选只为既有纯函数单测；不带段号 = 无判重依据，按旧行为归约）；`isNewSegment` 保留为 started 的唯一判据，新增 `isStaleSegmentEvent` 作为其余三类的旧段判据——两者共用 `run.segments` 口径。
- [x] 1.3 `reduceSubruns` 的 started 分支先过判重（同段 / 旧段原样返回，不复活 / 不加段 / 不清读数与待批；合法新段按 resume 合并、`segments` 取 `max(现有 + 1, 事件段号)`；首见即段 N 以事件段号建档）；progress / step / finished 分支丢弃 `segment < run.segments` 的旧段事件。
- [x] 1.4 `handleEvent` 只透传 `segment`，MUST NOT 自判段号：started 用同一个 `isNewSegment` 决定是否收 resume 重复任务行；finished 的旧段重放不执行待批收回 / 决策记录清理 / 用量快照刷新等收尾副作用。
- [x] 1.5 同族终态守卫（finding `20261120-worker-harness-async-bug-progress-step.md`）：`reduceSubruns` 的 progress / step 分支新增 `isTerminalFrozenEvent`（复用 `isLiveSubrun`），只冻结终态行**同段 / 无段号旧形态**的迟到事件；段号大于活跃段的乱序事件保持 base 归约，不被丢弃（non-goal 口径）。spec delta 增加「子运行终态后的迟到过程事件不改写读数」requirement 与四条 scenario（含更大段保持既有归约）。

## 2. 回归测试

- [x] 2.1 `tests/unit/harness-subagent-event-idempotence.test.ts`：started 六条（同段重复运行中 / finished 后同段重复 / 旧段重放 / 合法新段 / resume 用量累加 / 首见即段 N）；旧段 progress、旧段 step、旧段 finished 打断在跑新段、旧段 finished 不清当前段待批、旧段 finished 在新段收尾后重放不累加、同段 finished 重复幂等、当前段正常序列，共 13 条。
- [x] 2.2 终态守卫两条：四种终态（completed / partial / failed / aborted）后迟到的同段 progress / step 全读数冻结（status / rounds / toolCalls / elapsedMs / tokens / steps 逐一 deepEqual）；等待批准（waiting）仍属 live，progress / step 照常生效。
- [x] 2.3 终态冻结边界两条：终态后**更大段**（started 未到）progress / step 保持 base 归约（rounds / toolCalls / elapsedMs 或 steps 更新、状态仍终态、token 不变）；终态后**无段号**旧形态 progress / step 仍冻结。目标测试合计 17 条。

## 3. 验证

- [x] 3.1 目标单测：`node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/harness-subagent-event-idempotence.test.ts` → 17/17 pass；全量单测 `node tests/unit/run.mjs` → 1653 tests / 1651 pass / 0 fail / 2 todo。
- [x] 3.2 类型门禁：`pnpm exec tsc --noEmit` 与 `pnpm exec tsc -p tests/unit/tsconfig.json` 均 exit 0。
- [x] 3.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `bash scripts/docs-check.sh` PASS。
- [x] 3.4 完整门禁 `CARGO_TARGET_DIR=/tmp/lumir-m857-target LUMIR_ACCEPTANCE_PORT=4389 scripts/gate.sh quick`（`tests/visual` 既有依赖已按 `pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile` 安装，未改 lockfile）→ `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；原始输出 `.local/missions/M857/gate-quick.log`。cargo 锁按 `mkdir` 取得，完成后释放并清理临时 target。
- [x] 3.5 真机 / 视觉：无——纯归约层与事件接线，无 UI 形态 / 交互手感变化；不新增视觉基线、不跑 visual、不起真机。
