# Tasks: fix-subagent-started-idempotence-nov19

## 1. 合同与实现

- [x] 1.1 在 `openspec/changes/fix-subagent-started-idempotence-nov19/specs/harness-subagents/spec.md` 加入「子运行启动事件的段号幂等」requirement 与三条可判定 scenario（同段重复 / 旧段重放 / 合法新段）。
- [x] 1.2 `src/harness-panel.ts` 增加 `isNewSegment`：段号判定的唯一实现（没有同 run = 新 run；有则只有段号更大才是新段），与 `mergeLiveSubruns` 的陈旧快照防线同口径。
- [x] 1.3 `reduceSubruns` 的 `subagent_started` 分支先过判重：同段 / 旧段原样返回（不复活、不加段、不清读数与待批）；合法新段按 resume 合并，`segments` 取 `max(现有 + 1, 事件段号)`；首见即段 N 以事件段号建档。
- [x] 1.4 `handleEvent` 的 `subagent_started` 分支不再自判「run 已存在 = resume」，改用同一个 `isNewSegment` 决定是否收 resume 的重复任务行与刷新行。

## 2. 回归测试

- [x] 2.1 新增 `tests/unit/harness-subagent-event-idempotence.test.ts`：同段重复（运行中，保读数与待批）、finished 后同段重复（不复活）、旧段重放（段 2 在跑）、合法新段（同身份 / 段数 / 段基线 / 清待批）、resume 后跨段用量累加、首见即段 N 共 6 条。

## 3. 验证

- [x] 3.1 目标单测通过：`node --experimental-strip-types --import ./tests/unit/register.mjs --test tests/unit/harness-subagent-event-idempotence.test.ts` 6/6 pass；全量单测 `node tests/unit/run.mjs` 1524 pass / 0 fail。
- [x] 3.2 类型门禁：`pnpm exec tsc -p tests/unit/tsconfig.json` 与 `pnpm exec tsc --noEmit` 通过。
- [x] 3.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`Totals: 35 passed, 0 failed (35 items)`）；`bash scripts/docs-check.sh` PASS。
- [x] 3.4 完整门禁 `scripts/gate.sh quick` 通过，`GATE RESULT` 原文行记入 completion report。
  - 最终口径（`tests/visual` 既有依赖按 `pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile` 安装，未改依赖 / 锁文件）：`CARGO_TARGET_DIR=/tmp/lumir-m850-target LUMIR_VISUAL_PORT=4387 scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（`tsc-visual` 已含）。原始日志 `.local/missions/M850/quick-final.log`。
  - 早先未装 `tests/visual` 依赖时同命令为 `12/12 PASS（SKIP 1）`（`quick-rebased.log`）；cargo 锁按 `mkdir` 协议排队获取，跑完释放并清理临时 target。
- [x] 3.5 真机验收：无——纯归约层，无 UI 形态 / 交互手感变化；行渲染行为不变。
