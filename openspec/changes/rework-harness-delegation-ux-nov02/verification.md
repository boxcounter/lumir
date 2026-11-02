# Verification: rework-harness-delegation-ux-nov02

本文件记录本 change 的验证读数（原文 + 退出码 + 完整日志路径），供独立评审与归档对照。
`GATE RESULT` 行按 `scripts/gate.sh` 原样抄录，不重算分母。

## 基座与提交

- 干净 rebase：`git rebase --onto master 9895a0d`，无冲突；新 tip **`f0b660bb`**，基座
  `1d08868d`（master，含 M821 `add-path-line-range-links` 归档）。
- 启动快照 `9895a0d` 已随 rebase 去掉；`git diff master -- src-tauri/src/harness/prompts/
  src-tauri/src/harness/context.rs` 为空（快照的 prompts 本地改动未进入本分支）。

## 门禁（rebase 后）

### quick

- 命令：`scripts/gate.sh quick`（持 `/tmp/lumir-cargo-build.lock`，结束释放）
- 首轮日志：`/tmp/m822-gate-quick3.log` → `GATE RESULT: 13/13 PASS（SKIP 0）`，`GATE_EXIT=0`
  （rebase 后先暴露并修掉 `Usage` 冗余 `as u64` 与 `cargo fmt` 差异）
- 评审修复后复跑：`/tmp/m822-gate-quick-r3.log` → `GATE RESULT: 13/13 PASS（SKIP 0）`，
  `GATE_EXIT=0`；单测 1553 / 1553。

### visual

- 命令：`LUMIR_VISUAL_PORT=4188 scripts/gate.sh visual`（4273 被 M823 的 `vite preview` 占用，
  按隔离纪律改用 4188，未动他人进程）
- 首轮日志：`/tmp/m822-gate-visual.log`
- 首轮 `GATE RESULT: 14/15 PASS（SKIP 0）`，`GATE_EXIT=1`；2 条失败均为并发负载下的抖动，
  单跑复现为绿：
  - `reading-position.spec.ts:253`（该条在满负载下耗时 4.9m 判红；单跑 `7 passed (14.1s)`）；
  - `render-link.spec.ts:66`（单跑通过）。
- 复跑（机器空闲、无其它 gate / 验收实例）：日志 `/tmp/m822-gate-visual2.log`
- `GATE RESULT: 15/15 PASS（SKIP 0）`
- 退出码：`GATE_EXIT=0`（详细日志：`935 passed / 1 skipped (12.8m)`）
- 评审修复后复跑：日志 `/tmp/m822-gate-visual3.log` → `GATE RESULT: 15/15 PASS（SKIP 0）`，
  `GATE_EXIT=0`（详细日志：`938 passed / 1 skipped (11.0m)`）。

## 单元 / 视觉 / OpenSpec

- `pnpm test`：`tests 1552 / pass 1552 / fail 0`（rebase 前读数；rebase 后随 quick 复跑）。
- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：
  `Totals: 36 passed, 0 failed (36 items)`。
- `node scripts/openspec-archive-check.mjs`：
  `PASS（扫过 9 份 delta，12 条 MODIFIED，对比 180 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`。

## 判别性证据（先红后绿）

- `old-impl-zombie.log`：回退三处修复（清 DOM / `data-run` 对账 / `live_subruns` 合并）后，跨 vault
  场景红在 `.lumir-tp-run[data-run="r1"]` 期望 0、实测 1（M819 僵尸行）。
- `fixed-zombie-scene.log`：恢复修复后同一场景 `1 passed`。
- 证据目录：worktree `.local/reports/m822-delegation-ux-nov02/`（git 外；合并后如需复核先从
  worktree 复制到主仓 `.local/`）。

## 评审修复（reviewer r1，p1-5items/hold）

| 项 | 修复 | 判别测试 |
|---|---|---|
| P1-1 恢复 running 行无 Stop | 快照落地后对 live run 调 `refreshTaskRow`；live 渲染清掉恢复详情闭包 | 视觉「恢复出的运行中 task 行」：单前台控制区隐藏、transcript Stop 可见、点击记录到 `harness_subagent_stop`、行显示 live 用时 |
| P1-2 resume 事件序留第二身份 / 原因不复位 | `reduceSubruns` 新段复位 `stoppedBy`；`taskRowFor` 绑定既有行时收走第二段 `tool_call` 建出的未绑定行 | 视觉「resume 段的真实事件序」：两段完整调用后只有 1 个 task 行；单测断言 `stoppedBy === null` |
| P1-3 恢复种子缺失 | `subrun_runs` 写入 `session_open`、恢复合并种子、压缩携带；sidecar 增加 `background` / `duration_ms` / `tool_calls` | Rust `subrun_runs_seed_round_trips_and_chains`（sidecar → restore → 再 restore）与 `compact_carries_subrun_run_seed`（compact → restore） |
| P1-4 failed/aborted 信封无身份 | 两种信封补 agent/run_id/segment/background/status/model/duration/rounds/tool_calls/usage；恢复图标统一 `taskIcon(status)` | Rust `failed_and_aborted_envelopes_keep_task_identity`；视觉「四态恢复行」断言状态词、class 与用量 |
| P1-5 后台异常切回后消失 / 跨段基线缺失 | `parseSubrunRuns` + `mergeTerminalSubruns` 并入 `subruns`；`mergeLiveSubruns` 以逐 run 汇总为段基线；确认状态跨切 vault 保留 | 单测 `parseSubrunRuns / mergeTerminalSubruns`；视觉跨 vault 场景改为断言待确认行存在、`知道了` 可确认 |
| P2 文档/卫生 | 文案表末位 D881；`harness_state` 注释补两个键；场景 240 行尾空白 | `git diff --check` 退出码 0 |

## 二轮评审修复（reviewer r2，p1-2items/hold）

| 项 | 修复 | 判别测试（回退修复后实测红） |
|---|---|---|
| P1-1 resume 去重误删并行行 | 去重只在 `subagent_started` 判定「run 已存在」时执行，且只收走 **agent 匹配** 的最近未绑定行；progress / step / finished / 快照刷新不再去重 | 视觉「并行交错」：r1 progress 后 r2 未绑定行仍在；r2 无 started 被闸拒时失败结果保留、顺序不变。回退旧逻辑后该测试 1≠2（`r2-old-visual.log`，exit 1） |
| P1-2 第二次快照读数冻结 / 用时口径 | live 分支始终 `segmentBase + 当前段快照值`，首次与后续 `elapsedMs` 都取当前段；更早段迟到快照保留既有视图 | 单测：第二次快照 rounds 7→8 / calls 12→13、elapsed 500→1500；回退旧 `Math.max` 后该测试红（`r2-old-unit.log`，exit 1） |

二轮 A/B 证据：`.local/reports/m822-delegation-ux-nov02/r2-old-unit.log` / `r2-old-visual.log`。

### 二轮门禁

- quick：`/tmp/m822-gate-quick-r4.log` → `GATE RESULT: 13/13 PASS（SKIP 0）`，`GATE_EXIT=0`。
- visual：`/tmp/m822-gate-visual4.log` → `GATE RESULT: 15/15 PASS（SKIP 0）`，`GATE_EXIT=0`（939 passed / 1 skipped / 10.1m）。

## 三轮评审修复（reviewer r3，p1-3items/hold）

| 项 | 修复 | 判别测试（回退修复后实测红） |
|---|---|---|
| P1-1 同 agent 并行调用归属互换 | `tool_call` / `subagent_started` / 结果信封贯通 `call_id`；started 按 call_id 精确绑定本次调用行，done 按 call_id 配对，resume 去重按 call_id 收走本次重复行；旧后端缺键才退回 agent 匹配 | 视觉「同 agent 的 r1/r2/r3 交错」：三行保持调用顺序，r2 承载 concurrency_limit、r3 承载自己的运行态。回退 call_id 绑定后该测试红（`r3-old-visual.log`） |
| P1-2 恢复仍按段建第二身份 | `mergeRestoredEnvelopes`：恢复重放时同一 `run_id` 的段合并到既有行；段数/rounds/steps/tokens/用时求和，终态/摘要取最近段；最近段仍 live 时 live 刷新落在同一身份 | 单测 `mergeRestoredEnvelopes`（段数 2、rounds 8、steps 8、用量 100k/70k/3k、终态 completed）；视觉「恢复同一 run 的两段」只 1 行、详情 2 段与合计用量；回退合并后该视觉测试红 |
| P1-3 确认只存在内存 | 确认按 run id 持久化到 webview `localStorage`（`lumir.harness.acknowledged-subruns`，有上限）；完整重载后不再要求确认 | 视觉「后台异常 → 知道了 → 完整重载」：reload 后控制区不再出现。回退持久化后该测试红 |

三轮 A/B 证据：`.local/reports/m822-delegation-ux-nov02/r3-old-visual.log`（3 条新测试恰好红，8 条既有绿，exit 1）。

### 三轮门禁

- quick：`/tmp/m822-gate-quick-r6.log` → `GATE RESULT: 13/13 PASS（SKIP 0）`，`GATE_EXIT=0`。
- visual：`/tmp/m822-gate-visual5.log` → `GATE RESULT: 15/15 PASS（SKIP 0）`，`GATE_EXIT=0`（943 passed / 1 skipped / 10.2m）。

## 真机验收

- 场景：`201-subagent-panel-and-stop` / `240-harness-subagent-vault-switch` /
  `192-subagent-usage-buckets` / `203-subagent-chain-limit`。
- 时间：2026-11-02 20:00（tower 统一协调的机器窗口）。
- 读数：（待跑后回填；证据落 `.local/acceptance/`）
