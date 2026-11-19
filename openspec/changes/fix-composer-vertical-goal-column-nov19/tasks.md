# Tasks: composer 竖直移动的列位改回行内字符列

- [x] 读 REVIEW.md、真机 140 证据与 composer 导航合同；在 Chromium / WebKit 与真机重放 ⌃P 列位，
      记录每步 selection / goal column，判定是实现缺陷而非期望错误（依据：`.local/acceptance/`
      2026-10-28 的 140 全 PASS + 双引擎探针读数）
- [x] 定位根因：CM `cursorLineUp/Down` 的 goal column 是像素 x，比例字体下同一字符列的像素宽不等
- [x] `src/harness-composer.ts`：行选交给 `moveVertically`、列位按渲染行内字符列重算；⌃P/⌃N 与
      ⇧⌃P/⇧⌃N 共用一份目标函数；导航只写 selection
- [x] `docs/specs/harness-composer.md` HC1 增第 5 条（合同先行）
- [x] `tests/unit/composer-nav.test.ts`：假 view 改像素 goal column 模型（区分度），补 9 条列位用例；
      保留 `runComposerCommand` 全表对账
- [x] `tests/visual/scenes/m831-harness-composer-codemirror.spec.ts`：补 5 条浏览器回归（140 现场、
      长行→短行钳位、连续上下目标列往返、⇧Enter 换行键入后 ⌃P、软折行逐屏行）
- [x] `scripts/acceptance/scenarios/140-harness-composer-nav-move.md`：保留原正向断言，补负向断言与
      字符列口径说明
- [x] r1 review P2-1 返修：落点 `assoc` 显式给（行首 +1 / 钳到非空行尾 -1 / 行内 0）、目标 cursor
      沿用起点 `bidiLevel`、扩选按 CM `extendSel` 形态重建 range（goalColumn + bidiLevel + assoc）；
      顺带修「`moveVertically` 在末屏行把落点钳到文档末尾但仍属同一屏行」的边界（按无可停靠行走
      `cursorByLine` / `selectByLine` 的回退）。证据：修前双引擎红（⇧⌃N 0→70→70；⇧⌃P 358→358→358），
      修后 m831 两支全绿；单测补 2 条 assoc 用例（37/37）
- [x] 真机复跑 140 PASS（36.8s / 10 步全 PASS），证据落主仓
      `.local/acceptance/2026-11-19-m834/`；未更新像素基线
- [x] 最终门禁（r1 修复后的树，`visual` 用 `LUMIR_VISUAL_PORT=4273`；两次 `GATE RESULT` 原文）：
      `quick` — `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0；
      `visual` — `GATE PASS visual-regression 632s`、`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0
      （visual-regression `960 passed / 2 skipped / 0 failed`；m831 在 chromium 与 webkit-realua 两支
      都执行，CDP 条在 WebKit 按设计 skip）
- [x] 提交并 TowerComplete
