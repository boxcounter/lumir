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
- [ ] 真机复跑 140 PASS，证据落主仓 `.local/`；跑相关单测 / `quick` / `visual` 门禁，不更新基线
- [ ] 提交并 TowerComplete
