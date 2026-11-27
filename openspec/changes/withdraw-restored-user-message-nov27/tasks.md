# Tasks: withdraw-restored-user-message-nov27

## 1. 后端

- [x] 1.1 `TurnOrigin::is_interactive`（`allows_retry` 改由它派生，单一判据）；`turn::USER_ORIGIN_FIELD` 常量与交互入队点的标记写入（cron / 自动唤醒 / 子运行不写）。
- [x] 1.2 `attachments::expand_image_refs_from` 在 wire 前剥除 `lumir_user_origin`；单测断言 wire 不含该字段。
- [x] 1.3 `Session`：`restored_withdraw_target` 字段、`WithdrawSource`、`withdraw_source()` / `withdrawable()` 改读它；`replace_input` / `rotate` 一并清目标；恢复占用释放口 `release_resume_claim(source)`。
- [x] 1.4 `resume_session`：`restored_panel_messages` 唯一实现另返回「input 下标 → 面板行下标」映射；按最后一条带标记的 user 项重建目标；`SessionResumeInfo.withdrawable`。
- [x] 1.5 `withdraw_last_turn`：来源闸两档；恢复件的删除目标 = 恢复来源 A（释放自身占用后按既有栅栏 / 派生检测复核）；装配记录与祖先链副本检测都读来源留存（`harness_withdraw_copy_exists`）。
- [x] 1.6 文案 D1088 中英双表 + `ERROR_COPY` 映射 + `文案-Copy.md` 台账；`tests/unit/error-text.test.ts` 完整性门禁随新 code 通过。

## 2. 测试

- [x] 2.1 红绿对照：关掉「恢复目标」分支的探针跑 `withdraw_tests` → 4 条恢复路径用例判红（`restored_session_with_a_trailing_notice_refuses_to_withdraw` / `withdraw_from_a_restored_session_refuses_when_the_source_has_derived_sessions` / `withdraw_refuses_when_an_ancestor_retention_still_holds_the_message` / `withdraw_works_after_restoring_an_interactive_session`）；恢复后 24/24 全绿。证据 `.local/missions/withdraw-restored-user-message-nov27/{red-probe-withdraw.log,green-withdraw.log}`。
- [x] 2.2 `withdraw_tests` 新增 6 条：恢复后撤回删来源且 B 唯一、再恢复不复活、旧记录无标记安全拒绝、尾部通知拒绝、恢复后跑过 cron 轮拒绝、祖先链副本拒绝、来源派生拒绝（含恢复回执 `withdrawable=true` 断言）。
- [x] 2.3 turn 层单测：交互入队项带标记、cron 入队项不带（同一 bench 两轮）。
- [x] 2.4 前端源码断言（`tests/unit/harness-activity-wiring.test.ts`：重放之后落地 + 重施撤回钮 + 不写死 true）；`SessionResumeInfo` fixture 补 `withdrawable`。

## 3. 验收场景

- [x] 3.1 新增真机场景 887（恢复 → 撤回 → 再恢复不复活）；`node scripts/acceptance/coverage.mjs` 重生成 COVERAGE（309 个场景 / 277 个 item）。
- [x] 3.2 `node scripts/acceptance/run.mjs --check` 通过（309 个场景；编号与 id 由 check 对账）。
- [ ] 3.3 真机执行场景 887 至 PASS（证据落 `.local/acceptance/`）——**本 mission 不执行**：真机归主会话，worker 只交付场景与 `--check` 读数。

## 4. 验证

- [x] 4.1 `cargo test --lib` 通过（1282 passed / 0 failed / 1 ignored）。
- [x] 4.2 `pnpm test` 通过（2149 passed / 0 failed）；根与 `tests/visual` 的 `tsc --noEmit` 通过。
- [x] 4.3 `node scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`（证据 `.local/missions/withdraw-restored-user-message-nov27/gate-quick-final.log`）。同一日志另记一条环境读数：首次跑 `unit-tests` 时 `tests/unit/link-suggest.test.ts` 的 16ms 预算断言在机器负载下判红（47.25ms），复跑 13/13 全绿；该用例与本 change 无关。
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（39 passed / 0 failed）。
- [x] 4.5 `node scripts/openspec-archive-check.mjs` 门禁模式 PASS（9 份 delta / 8 条 MODIFIED / 156 段，无静默丢段）。

## 5. 归档（不在本 mission 内执行）

- [ ] 5.1 节点 2 五要件与归档记录（见 `proposal.md` 的「节点 2：归档记录」）——**本 mission 不执行**：由 tower 在真机 887 PASS 后按五要件办理。
