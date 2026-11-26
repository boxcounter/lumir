# Tasks: fix-skill-enter-accept-nov26

> 行为依据是 Alex 2026-11-26 节点 1 批准的 Enter 新合同（proposal 六条）。顺序是硬约束：
> **先红后绿**——1.x 用新合同写判据并实测旧实现判红，留证据后再进 2.x；3.x 才是文档与验收收口。
> 实现期若发现合同本身需要新裁决，停下更新 proposal 再改，不静默扩 scope。

## 0. 提案

- [x] 0.1 起草 `proposal.md` / 本文件 / `specs/harness/spec.md`（整条 MODIFIED）
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 39/39 与
      `bash scripts/docs-check.sh` PASS

## 1. 先红：新合同判据对旧实现

- [x] 1.1 `tests/unit/skill-menu.test.ts` 改写为高亮即 armed：部分匹配、多候选首项、无候选、
      按名字保留、异步回包不换项；旧实现上实测 **11 failed / 7 passed**，日志
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-enter-accept-nov26/unit-red.log`
      （修后同文件 19/19，`unit-green.log` / 全量 2049/2049 `unit-final.log`）
- [x] 1.2 `tests/visual/scenes/skill-hybrid.spec.ts` 补真实按键用例：`/tmp` 接受、`/in`
      多候选首项、无匹配发送、`/tmp` 无匹配态、Esc 后发送原文、延迟 catalog 不重开/不换项、
      Tab 接受；旧实现上 **9 failed / 65 passed**（`visual-red.log`），异步回落项另以旧 src
      单跑判红 `data-armed="false"`（`visual-red-async.log`）

## 2. 实现（绿）

- [x] 2.1 `src/skill-menu.ts`：`items` 非空时 `armed` 恒真；同 token 的异步回包按名字保留
      目标（新出现的同名项也不得改选）；更新状态机注释；保留 `skillSelectionSpec` 的 armed 守卫
- [x] 2.2 `src/harness-panel.ts`：更新接受键与点击接受注释（高亮即接受、无修饰 Enter/Tab）
- [x] 2.3 单元测试转绿：目标文件 19/19、全量 `node tests/unit/run.mjs` 2049/2049 PASS
- [x] 2.4 视觉目标用例转绿：`skill-hybrid.spec.ts` 76/76（chromium，`visual-final.log`）；
      相邻 `skill-visible-selection-nov25.spec.ts` chromium + webkit-realua 14/14（`visual-adjacent-green.log`）

## 3. 文档与验收收口

- [x] 3.1 `docs/specs/selector-contract.md` C4 整节改写（高亮即 armed、异步不得换项、观测口径）
- [x] 3.2 `docs/specs/skill-menu.md` 更新 S1 并新增 S5（接受/发送边界、Esc 原文、异步稳定）
- [x] 3.3 `specs/harness/spec.md` delta 与 living 逐段对账：旧 requirement 整条 REMOVED + 新名 ADDED，
      「Skill 支持」交叉引用 MODIFIED；`openspec validate --all --strict` 39/39、archive-check 无丢段
- [x] 3.4 验收 868：`/tmp` 段翻转为接受，补多候选首项 / 无匹配发送 / Esc 原文；`726` 的
      `/tmp` 普通文本路径改为先 Esc；`node scripts/acceptance/run.mjs --check` 298 场景通过
- [x] 3.5 静态与目标门禁：`pnpm exec tsc --noEmit` 0、`tests/visual` tsc 0、`docs-check` PASS、
      `openspec validate --all --strict` 39/39、`acceptance --check` 298；完整 `gate.sh` 与真机 868
      留主会话执行
- [x] 3.6 提交并回报 tip、红绿证据、待真机事项（不 merge / 不 push / 不归档 / 不改正式基线）；
      提交由本 change 的首个 commit 完成，tip 在完工回报中给出

## 覆盖边界

- IME：真机 AX 无法注入原生 TSM 组合；本 change 的 IME 判据落在 `skill-hybrid.spec.ts` 的真实
  keydown + 合成 CompositionEvent 序列（组合期不吞、结束后重算一次），原生 IME 人工终判仍归
  `156-harness-composer-ime-composition-freeze` 的人工矩阵，不在本 change 内冒充。
- 异步 catalog：浏览器场景用可控 deferred `harness_skills_list` 回包验证「不换项 / 不重开」；
  真机 868 不伪造后端回包时序，该分支以浏览器场景为准。
