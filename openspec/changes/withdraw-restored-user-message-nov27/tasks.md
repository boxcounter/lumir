# Tasks: withdraw-restored-user-message-nov27

## 1. 后端

- [x] 1.1 `TurnOrigin::is_interactive`（`allows_retry` 改由它派生，单一判据）；`turn::USER_ORIGIN_FIELD` 常量与交互入队点的标记写入（cron / 自动唤醒 / 子运行不写）。
- [x] 1.2 `attachments::expand_image_refs_from` 在 wire 前剥除 `lumir_user_origin`；单测断言 wire 不含该字段。
- [x] 1.3 `Session`：`restored_withdraw_target` 字段、`WithdrawSource`、`withdraw_source()` / `withdrawable()` 改读它；`replace_input` / `rotate` 一并清目标；占用的「排除自身」读数 `foreign_resume_claim_count`。
- [x] 1.4 `resume_session`：`restored_panel_messages` 唯一实现另返回「input 下标 → 面板行下标」映射；按最后一条带标记的 user 项重建目标；`SessionResumeInfo.withdrawable`。
- [x] 1.5 `withdraw_last_turn`：来源闸两档；恢复件的删除目标 = 恢复来源 A；装配记录与祖先链副本检测都读来源留存（`harness_withdraw_copy_exists`）。
- [x] 1.6 文案 D1088 中英双表 + `ERROR_COPY` 映射 + `文案-Copy.md` 台账；`tests/unit/error-text.test.ts` 完整性门禁随新 code 通过。
- [x] 1.7 K3 P1-2：占用检查改为排除本会话自己那一份，**不提前释放** `ResumeClaim`（失败路径天然保留保护，成功换出时才随旧 `Session` drop）。
- [x] 1.8 K3 P2：祖先链出现环或超过深度上限改判 `harness_withdraw_scan_failed`（附路径与 `reason`）；祖先文件正常缺失仍允许终止。

## 2. 测试

- [x] 2.1 红绿对照（首轮）：关掉「恢复目标」分支的探针跑 `withdraw_tests` → 4 条恢复路径用例判红；恢复后全绿。证据 `.local/missions/withdraw-restored-user-message-nov27/{red-probe-withdraw.log,green-withdraw.log}`。
- [x] 2.2 `withdraw_tests` 新增 6 条（首轮）：恢复后撤回删来源且 B 唯一、再恢复不复活、旧记录无标记安全拒绝、尾部通知拒绝、恢复后跑过 cron 轮拒绝、祖先链副本拒绝、来源派生拒绝（含恢复回执 `withdrawable=true` 断言）。
- [x] 2.3 turn 层单测：交互入队项带标记、cron 入队项不带（同一 bench 两轮）。
- [x] 2.4 前端源码断言（`tests/unit/harness-activity-wiring.test.ts`：重放之后落地 + 重施撤回钮 + 不写死 true）；`SessionResumeInfo` fixture 补 `withdrawable`。
- [x] 2.5 K3 返修回归 5 条：恢复件撤回失败后占用仍在（删除失败 / 发布失败 / 双故障各一条）、外来 Runtime 在失败后恢复并撤回被拒（`resume_in_flight`）且 drop 失败会话后放行、祖先链成环 / 超深各一条 fail closed。红绿对照：关掉占用保护 + 把环判据改回 `break` → 4 条判红（`red-probe-k3.log`），恢复后 `green-withdraw-k3.log` 29/29。

## 3. 验收场景

- [x] 3.1 新增真机场景 887（恢复 → 撤回 → 再恢复不复活；rebase 到 master 后由 886 让位到 Web 的 886/886b，本 change 顺延为 887）；`node scripts/acceptance/coverage.mjs` 重生成 COVERAGE（311 个场景 / 278 个 item）。
- [x] 3.2 `node scripts/acceptance/run.mjs --check` 通过（311 个场景；编号与 id 由 check 对账）。
- [ ] 3.3 真机执行场景 887 至 PASS（证据落 `.local/acceptance/`）——**本 mission 不执行**：真机归主会话，worker 只交付场景与 `--check` 读数。

## 4. 验证

- [x] 4.1 `cargo test --lib` 通过：K3 返修后 **1308 passed / 0 failed / 1 ignored**（首轮 1282/0；增量来自 master 的 Web 用例与本 change 新增用例）。
- [x] 4.2 `pnpm test` 通过（2149 passed / 0 failed）；根与 `tests/visual` 的 `tsc --noEmit` 通过。
- [x] 4.3 `node scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`（K3 返修后，证据 `.local/missions/withdraw-restored-user-message-nov27/gate-quick-k3-final.log`；首轮为 `gate-quick-final.log`）。**环境读数如实登记**：同一命令跑 4 次有 2 次在 `unit-tests` 被 `tests/unit/link-suggest.test.ts` 的 16ms 预算断言判红（47.25ms / 23.85ms，疑似随 `node --test` 并行度与机器负载），该文件单独连跑 3 次 15/15 全绿；该用例是纯计时断言、与本 change 无关，未改它。
- [x] 4.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 4.5 `node scripts/openspec-archive-check.mjs` 门禁模式 PASS（8 条 MODIFIED / 156 段，无静默丢段）。

## 5. 范围裁决与归档（本 mission 不执行 merge / 归档）

- [x] 5.1 **0.20 存量会话范围已裁**：节点 1 补充批准（2026-11-27）——采纳「只允许升级后的新消息」，0.20 及更早无 `lumir_user_origin` 标记的存量会话恢复后仍不可撤回；不采用显式认领、不采用非破坏性分叉。记录见 `proposal.md` 的「评审记录 / 节点 1 补充批准」与「范围裁决」一节。
- [ ] 5.2 节点 2 五要件与归档记录（见 `proposal.md` 的「节点 2：归档记录」）——**本 mission 不执行**：剩余缺口只有真机 887 的 PASS 证据，由 tower 在真机 PASS 后按五要件办理。
