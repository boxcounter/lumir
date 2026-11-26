# Tasks: preserve-composer-across-sessions-nov26

> 阶段门：节点 1 已通过（Alex 2026-11-26「采纳」），合同见 proposal 头部。实现顺序是硬约束：
> **先红后绿**——新增 / 改准的浏览器场景先在未修复代码上判红并留证，再进实现。实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/harness/spec.md`（MODIFIED delta，
      整块复制 living「CM composer 的单一 history」条后改）
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 0.3 回填节点 1 批准记录（Alex 原话「采纳」与四条合同），确认范围只覆盖同 vault 的
      新建 / 选择 / 恢复 / 重载会话

## 1. 先红：合同测试

- [x] 1.1 新增 `tests/visual/scenes/harness-composer-session-preserve-nov26.spec.ts`，覆盖
      design §4 的 1–8：纯文本 + caret、引用卡 / 图片卡 / Skill、撤销历史、草稿未被清除、
      会话重载、失败回包不清、在途草稿恢复不覆盖（三条：空态 / redo 历史 / 已键入内容 + caret，
      含正向对照）、切 vault 仍按 vault 恢复、发送确实进入当前选中会话（新建与选择后各一次）
- [x] 1.2 改准 `tests/visual/scenes/m831-harness-composer-codemirror.spec.ts` 的两条旧行为用例：
      「新会话成功：composer 新建 EditorState，旧文本与 history 不可达」→「保留内容与 history」；
      「新会话清除同 vault 草稿」→「新会话不清草稿，reload 后恢复旧输入」
- [x] 1.3 **红跑**：在未修复实现上跑新增 / 改准的场景，逐条确认失败断言符合 design §4 的预期
      （不是超时 / 桩错误），把日志与失败摘要落
      `.local/missions/preserve-composer-across-sessions-nov26/RED-before-fix.log`
- [x] 1.4 反向验证：在绿跑之后临时把 `draftSeq += 1` 那行注释掉复跑「在途草稿恢复」用例，
      确认它如实判红（证明该判据有区分度），再恢复

## 2. 实现（最小修复）

- [x] 2.1 `src/harness-panel.ts` 新增 `holdComposerAcrossSessionSwitch()`（只推进 `draftSeq`），
      注释写明「会话切换保留输入区 / 作废在途草稿恢复 / 切 vault 不走这里」
- [x] 2.2 `startNewSession()` 成功分支：删除 `resetComposer()` 与 `void draft.clear()`，改调
      `holdComposerAcrossSessionSwitch()`；`resetView` 保持只清 transcript / 会话视图
- [x] 2.3 `reloadTargetSession()`：同样替换；`resumeSession()` 成功分支补同一调用
- [x] 2.4 核对未误改：`performSend()` 成功清空与 `clearSent`、`vaultChanged` 的
      `resetComposer()` + `restoreDraft()`、`beginCronRun()` 的切屏语义逐字不动

## 3. 文档与验收场景

- [x] 3.1 更新 `docs/specs/harness-composer.md` 的旧口径（第 5 条：新会话 / 会话重载清草稿、
      重置 history）为保留口径，并写明切 vault 仍是 per-vault 草稿恢复
- [x] 3.2 新增真机验收场景 `scripts/acceptance/scenarios/878-composer-preserve-across-sessions.md`
      （核对 877 / 878 未被占用；覆盖「＋新会话」与「会话浮层选择历史会话」两条路径），
      跑 `node scripts/acceptance/coverage.mjs` 重新生成 `COVERAGE.md`
- [x] 3.3 回扫既有测试对「新会话清 composer」的过期期望：逐条检查点 `.lumir-hp-seg-new` 的
      场景在那一刻输入区是否为空；把结论记进证据文件

## 4. 验证

- [x] 4.1 目标浏览器场景绿：`bash scripts/visual/run.sh scenes/harness-composer-session-preserve-nov26.spec.ts`
      与 `... scenes/m831-harness-composer-codemirror.spec.ts`
- [x] 4.2 相关既有场景回归：`scenes/harness-send-reject-nov22.spec.ts`、`scenes/skill-hybrid.spec.ts`、
      `scenes/m440-harness-image-card.spec.ts`、`scenes/m633-image-quote.spec.ts`、
      `scenes/m303-harness-panel.spec.ts`、`scenes/harness-vault-activity.spec.ts`
- [x] 4.3 前端单测 `pnpm test`、结构模式 `LUMIR_VISUAL_STRUCTURAL=1` 下同一批场景
- [x] 4.4 `bash scripts/docs-check.sh` 与 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.5 证据落主仓 `.local/missions/preserve-composer-across-sessions-nov26/`（红 / 绿日志、
      回扫结论、命令与读数），不留在 worktree 内

## 5. 真机与归档

- [ ] 5.1 （**本轮不执行**）真机跑场景 878：任务明确本轮禁止真机操作，场景文件随实现提交，
      执行安排到后续批次；未跑 ⇒ 不声称真机通过
- [ ] 5.2 （**本轮不执行**）节点 2 五要件与归档：等独立评审，本批不归档

## 6. 返修 r1（K3 verdict：P2-1 / P3-1 / P3-2 / P3-3）

- [x] 6.1 **P2-1**：delta 的「非 history 文档变更被拒绝」scenario 改为两句——「旧 history 不可达」
      只约束**重建 `EditorState` 的装载 / 复位路径**（草稿恢复、切 vault、发送清空）；新建 / 选择 /
      恢复会话与会话重载「旧 history 仍须可达（撤销 / 重做跨切换保留）」，与
      `docs/specs/harness-composer.md` HC2.5 同口径
- [x] 6.2 **P3-1**：桩记录 `new` / `resume` 后的会话身份与切换世代，`harness_send` 记录发送时的
      身份 / 世代；新增「新建后发送」与「选择历史会话后发送」两条用例——身份与世代等于切换后的值、
      投递载荷含保留的文字 / 引用卡 / Skill、transcript 出现用户消息、composer 清空
- [x] 6.3 **P3-2**：在途草稿用例拆三条——空态（draftSeq 判据）、redo 历史（键入→撤销回空态→切换→
      放行读回→redo 回到切换前输入）、已键入内容 + caret（逐字段不变且 ⌘Z 可回退），标题不再声称
      空态用例覆盖 history
- [x] 6.4 **P3-3**：本 tip 的 `pnpm test` / `docs-check` / `validate --all --strict` 原始输出落
      `.local/missions/preserve-composer-across-sessions-nov26/`（不再是摘要）
- [x] 6.5 用旧实现（`a9152deca` 的 `src/harness-panel.ts`）重跑扩充后的场景，确认新增用例必红；
      修复后全绿；再对 `draftSeq` 作废行做一次反向验证

## 本批读数（2026-11-26，返修 r1 后）

- 先红（返修版场景跑 `a9152deca` 的 `src/harness-panel.ts`）：`RED-before-fix-r2.log` —
  **9 failed / 5 passed**（新建文本、新建后发送、卡片/Skill、pendingSend 内容、草稿未被清、
  会话重载、在途草稿三条各红一条；选择会话 / 失败回包 / 正向对照 / 切 vault 等守卫绿）。
- 后绿：`GREEN-spec-plus-m831-r2.log` — 新场景 14/14 + m831 两个 project 共 **35 passed /
  1 skipped**（CDP 用例只在 chromium 提供），退出码 0；单跑新场景 `GREEN-spec-r2-final.log`
  **14 passed**。
- 反向验证：`reverse-check-draftseq-red-r2.log`（注释掉作废行 ⇒ **2 failed / 12 passed**，失败
  恰为空态 draftSeq 与 redo 历史两条；已键入内容那条由 pristine 守卫兜底，仍绿）→ 恢复后
  `GREEN-spec-r2-final.log` 14/14。
- 回归批：`regression-batch-green.log` — 196 passed / 1 skipped（源文件本批未再改动，仍适用）。
- 前端单测：`final-pnpm-test.log` — **2049 passed / 0 failed**，退出码 0。本机负载下同一份套件曾
  两次红在 `link-suggest.test.ts` 的 16ms 时序预算用例（实测 20.7ms / 66ms，其余 2048 绿；该用例
  与本 change 无交集），复跑取到干净读数，原始日志为这次单跑版本。
- 制品：`final-docs-check.log` — **PASS**；`final-openspec-validate.log` — **39 passed /
  0 failed**。三项均为原始命令输出文件，不再是摘要。
- 未跑：`scripts/gate.sh` 全档、真机场景 878、CI（任务明确不跑）；`tests/unit` 的 tsc 在**主仓
  master 同样**报 `tests/unit/skill-menu.test.ts` 的 `ChangeSpec` 类型错，与本批无关。
