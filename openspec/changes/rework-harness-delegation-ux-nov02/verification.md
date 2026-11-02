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
- 日志：`/tmp/m822-gate-quick3.log`
- `GATE RESULT: 13/13 PASS（SKIP 0）`
- 退出码：`GATE_EXIT=0`
- 备注：rebase 后先暴露并修掉两处门禁问题——`Usage` 字段的冗余 `as u64`（clippy
  `-D warnings`，提交 `e05ac64f`）与 `cargo fmt` 差异（提交 `b02ec8d6`）。

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

## 真机验收

- 场景：`201-subagent-panel-and-stop` / `240-harness-subagent-vault-switch` /
  `192-subagent-usage-buckets` / `203-subagent-chain-limit`。
- 时间：2026-11-02 20:00（tower 统一协调的机器窗口）。
- 读数：（待跑后回填；证据落 `.local/acceptance/`）
