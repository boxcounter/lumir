# Tasks: fix-skill-visible-selection-nov25

> 缺陷修复，行为依据是既有裁决（`docs/specs/selector-contract.md` C2/C3、`docs/specs/skill-menu.md`
> S2/S4），无需新的行为裁决。顺序是硬约束：**先红后绿**——1.x 的复现必须先判红并留证，再进 2.x–3.x。
> 实现期若发现 master 仍能复现产品缺陷，停下更新 proposal 再改，不静默扩 scope。

## 0. 提案

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/harness/spec.md`
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过

## 1. 先红：修前复现

- [x] 1.1 新增 `tests/visual/scenes/skill-visible-selection-nov25.spec.ts`（7 条：默认视口 30 项
      往返、短视口 500、短视口 360 + scale 1.5、异步目录、静止指针、窄 pane、窗口收缩）
- [x] 1.2 把 `src/harness-panel.ts` 的 `placeSkillMenu` 与揭示临时换回 `d0b6927` 的实现
      （旧放置以 composer 区为界、揭示取候选 `clientHeight`），跑新矩阵 → **7/7 红**，首条报错为
      「选中项下缘越出真实可见带，scrollTop=0」；证据见 design §2 / §5
- [x] 1.3 还原实现并重建产物，确认 7/7 绿（红不是测试写法问题）

## 2. 判据加固（绿）

- [x] 2.1 `skill-hybrid.spec.ts` 的 `expectHighlightedVisible` 改为独立计算真实可见带（全部裁切
      祖先 + 滚动口 padding）并断言 `.is-selected` 与 `aria-selected` 同项；既有 68 条全绿
- [x] 2.2 `tests/visual/playwright.config.ts` 把新矩阵加进 `webkit-realua` 的 testMatch（真实 UA +
      DPR 2 分支）
- [x] 2.3 chromium 与 WebKit 两支各跑新矩阵 7/7 绿
- [x] 2.4 `docs/specs/selector-contract.md` §证伪方式补两条：oracle 独立于实现、逐拍判「完整可见 +
      标记同项」，真机场景用 AX 暴露判可见

## 3. 门禁与收口

- [x] 3.1 `scripts/gate.sh visual` 全量通过：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0
      （visual-regression 1270s；新矩阵在 chromium 与 webkit-realua 两支各 7/7 PASS）
- [ ] 3.2 真机待办（本批不执行）：868 末项 / 末段补 AX 可见性断言，并在含本修复的构建上复跑
