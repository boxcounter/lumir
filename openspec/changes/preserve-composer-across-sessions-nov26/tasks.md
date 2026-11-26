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
      design §4 的 1–7：纯文本 + caret、引用卡 / 图片卡 / Skill、撤销历史、草稿未被清除、
      会话重载、失败回包不清、在途草稿恢复不覆盖（含正向对照）、切 vault 仍按 vault 恢复
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

## 本批读数（2026-11-26，实现批）

- 先红：`RED-before-fix.log` — 6 failed / 4 passed（新建文本、卡片/Skill、pendingSend 内容、草稿
  未被清、会话重载、在途草稿覆盖各红一条；4 条守卫绿）。
- 后绿：`GREEN-spec-plus-m831.log` — 新场景 10/10 + m831 两个 project 共 31 passed / 1 skipped
  （CDP 用例只在 chromium 提供），退出码 0。
- 结构模式：`GREEN-structural-mode.log` — 新场景 10/10（`LUMIR_VISUAL_STRUCTURAL=1`）。
- 反向验证：`reverse-check-draftseq-red.log`（注释掉作废行 ⇒ 在途草稿用例红：输入区被铺成
  `DISK-DRAFT-ALPHA`）/ `reverse-check-draftseq-green.log`（恢复 ⇒ 1 passed）。
- 回归批：`regression-batch-green.log` — 196 passed / 1 skipped（m831 / send-reject / skill-hybrid /
  m440 / m633 / m303 / vault-activity / m756 / persistence-health / m662），退出码 0。
- 前端单测：`pnpm test` 2049 passed / 0 failed。
- 制品：`bash scripts/docs-check.sh` PASS；`openspec validate --all --strict` 39 passed / 0 failed。
- 未跑：`scripts/gate.sh` 全档、真机场景 878、CI（任务明确不跑）；`tests/unit` 的 tsc 在**主仓
  master 同样**报 `tests/unit/skill-menu.test.ts` 的 `ChangeSpec` 类型错，与本批无关。
