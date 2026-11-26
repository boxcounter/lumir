# Tasks: add-harness-message-withdraw-nov26

## 1. 后端

- [x] 1.1 `Session` 记 `last_turn_origin`（`run_turn_core` 开跑时写入）；`withdrawable()` 单一判据；快照 `withdrawable` 恒在场（空态 false）。
- [x] 1.2 `jsonl::publish_now` 立即发布未发布批次（失败上抛）；`read_session_open` 只读首行；`withdraw_seed` 载荷与读取口（唯一字面量来源）。
- [x] 1.3 `Runtime::withdraw_last_turn`：idle / 来源 / 目标项校验；两段式工具确认；派生初检与发布后复核；建 B 并发布；unlink A；失败就地回滚 B；换入 B 并丢弃 A。
- [x] 1.4 `resume_session` 与 `first_user_text` 的 `withdraw_seed` 回落（没有 `llm_request` 时）。
- [x] 1.5 `harness_withdraw` 命令与 `lib.rs` 注册；`SessionWithdrawInfo` / `WithdrawnComposer` / `WithdrawOutcome` 的 ts-rs 导出。
- [x] 1.6 单元测试 16 条（`harness/withdraw_tests.rs`）：前缀 / 面板截断、A 删除 + B 唯一 + seed 不含被撤回文本、切走再恢复、两段式确认零副作用、busy / 待批拒绝、来源闸、派生拒绝、删除失败回滚、尾部通知拒绝、不可读候选 fail closed、恢复占用拒绝、双故障 rollback_incomplete、失败 Skill 恢复、装配读失败、composer 素材、标题 / 用量 / `withdrawable`、重复点击幂等、令牌变化。
- [x] 1.7 K3 返修：撤回目标改为入队下标（`withdraw_target`）；尾部非交互 user 项拒绝；派生扫描 fail closed；恢复占用表 + 栅栏；装配读失败 fail closed；双故障终态；失败 Skill 从 trace 恢复。
- [x] 1.8 事件隔离：`session_token` 信封 + 前端全事件准入；`insert_notices_into_session` / `notice_delivered` 校验 hub `parent_token`；子代理中断窗口测试。
- [x] 1.9 令牌水位按 vault 分账（K3 复审 P1-1）：`src/harness-session-tokens.ts` 账本 + 面板接线；A/B/A、B 事件先于快照、退役与空快照语义的单元测试 6 条。
- [x] 1.10 显式 Skill 的完整原名（K3 复审 P2-1）：`ExplicitSkillTrace.raw_name` 与展示名分离（wire 仍随 `lumir_skill_trace` 剥除）；撤回优先用原名，旧记录缺键时回落展示名；>80 字符成功 / 失败与旧记录测试。

## 2. 前端

- [x] 2.1 最后一条用户消息的撤回钮（hover 显形、非 idle 置灰并提示）；快照 `withdrawable` 驱动可见性。
- [x] 2.2 工具二次确认条（列出工具名 + 不撤销说明）；确认后 `confirm=true` 复调。
- [x] 2.3 `composerContentFromMessage`（wire 文本 → composer 内容：实体还原、卡片锚点、Skill 位置）；与 `mergeRejectedComposerContent` 共用合并核心的 `mergeWithdrawnComposerContent`。
- [x] 2.4 撤回成功后的视图换代：重放 B 的面板、persistence token、标题 / 首条消息、读数与任务区刷新、composer 回填 + `markDraft`、toast。
- [x] 2.5 文案 D1034–D1044（含 6 个错误码）双表同步；撤回钮与确认条样式（非 hover 帧零像素变化）。
- [x] 2.6 前端单测 9 条（`tests/unit/harness-withdraw-composer.test.ts`，含失败 Skill 与 >80 字符长名）+ `resetView` 调用点矩阵与 i18n 门禁同步更新；令牌账本单测 6 条（`tests/unit/harness-session-tokens.test.ts`）。
- [x] 2.7 真面板 chromium 场景 4 条（`tests/visual/scenes/harness-withdraw-message-nov26.spec.ts`：直接撤回 / 工具二次确认 / 派生拒绝 / 旧令牌迟到事件拒收），无像素断言、不新增基线。

## 3. 验收场景

- [x] 3.1 新增真机场景 882（transcript 节点在场性翻转 / composer 值在场 / 最新 JSONL `not` 被撤回文本 + `opened_from":"withdraw"` / 会话目录 `glob exact:1`）；`node scripts/acceptance/coverage.mjs` 重生成 COVERAGE。
- [x] 3.2 `node scripts/acceptance/run.mjs --check` 通过（301 场景）。
- [ ] 3.3 真机执行场景 882 至 PASS（**本轮不执行真机**，留待验收批；执行前核 880/881/877/879 的占用）。

## 4. 验证

- [x] 4.1 `cargo test --lib`（含 `withdraw_tests` 18 条、子代理交错 1 条、事件信封 1 条）通过。
- [x] 4.2 `pnpm test` 通过（2094 条：含新增投影 9 条与令牌账本 6 条）。
- [x] 4.3 根 `tsc --noEmit` 与 `tests/visual` 的 tsc 通过。
- [x] 4.4 `node scripts/gate.sh quick` 与 `scripts/visual/run.sh`（`LUMIR_VISUAL_STRUCTURAL=1`，结构 / 计算属性层）通过；像素层本轮不跑、未更新任何基线。
- [x] 4.5 `node scripts/docs-check.sh` 通过。
- [x] 4.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 4.7 证据落 `.local/missions/add-harness-message-withdraw-nov26/`（红绿对照、门禁输出、场景 --check 读数）。

## 5. 归档（不在本 mission 内执行）

- [ ] 5.1 节点 2 五要件与归档记录（真机 882 PASS 后才能开始）。
