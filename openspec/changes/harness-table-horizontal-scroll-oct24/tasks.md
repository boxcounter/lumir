# Tasks: harness-table-horizontal-scroll-oct24

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / `specs/ui-design-system/spec.md` / 本文件
- [x] 0.2 依据 M699 只读 survey（`.local/reviews/harness-table-overflow-audit-oct24.md`）落 C1–C7、
      两半缺一不可的反例数字与测试矩阵；Alex 截图 `m3` 记为节点 1 来源
- [x] 0.3 Alex 节点 1 评审通过：2026-10-24 回复原文「提案和截图都认可。」
- [x] 0.4 裁决结果已回填 proposal 的「评审记录」块；D1–D4 未逐条反对，按提案倾向落地，
      design 与 delta 无需修正

## 1. 结构（`src/harness-panel.ts`）

- [x] 1.1 `case "Table"` 建 `.lumir-hp-table-scroll` wrapper：`slot > wrapper > table`
- [x] 1.2 `openers.table()` 仍收 `<table>` 本身（不是 wrapper）

## 2. CSS（`src/harness-panel.css` / `src/style.css`）

- [x] 2.1 wrapper：块级 / `max-inline-size:100%` / `overflow-x:auto` / `overflow-y:hidden` /
      `overscroll-behavior-inline:contain`
- [x] 2.2 `.lumir-hp-table { width: max-content }`
- [x] 2.3 margin 归零链路覆盖 wrapper 与 wrapper 内的 table
- [x] 2.4 删除 `.lumir-table-fs-snapshot .lumir-hp-table { width: max-content }` 重复声明，更新注释
- [x] 2.5 `src/style.css` 细条共用选择器组四处加入 `.lumir-hp-table-scroll`

## 3. 单测与注册表

- [x] 3.1 `tests/unit/scrollbar-registry.test.ts` thin 条目登记 `.lumir-hp-table-scroll`
- [x] 3.2 被扫出的滚动容器集合与计数器文案同步（20 面 / 21 选择器），轴向断言为 `["x"]`

## 4. 结构场景

- [x] 4.1 `tests/visual/scenes/m703-harness-table-scroll.spec.ts`：窄 pane 宽表（溢出 > 20、表宽 =
      `wrapper.scrollWidth`、cell 不折行、transcript 无横溢、slot / 钮锚点、`scrollLeft` 可动）
- [x] 4.2 声明层：`overflowX/overflowY`、`scrollbar-width:thin`、CSSOM 4px、`scrollbar-gutter:auto`
- [x] 4.3 全屏快照直接子节点是 `table.lumir-hp-table`，不含 wrapper
- [x] 4.4 长 URL cell / 宽 pane / 窄表回归 / 嵌套 blockquote 四组用例

## 5. 真机验收

- [x] 5.1 `scripts/acceptance/fixtures/harness-mock-table-scroll.json`：4 列宽表 + 首末列标记
- [x] 5.2 `scripts/acceptance/scenarios/234-harness-table-horizontal-scroll.md`：AX 首末列在场、
      `do: scroll` + `wheel: true` 在表格区域横滚、滚动前后截图；注释写明 AX 不能测几何
- [x] 5.3 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`；`run.mjs --check` 绿
- [x] 5.4 真机跑 234，证据落 `.local/acceptance/`（截图含滚动前后各一张；dx 负值向右滚，
      滚动后截图里末列完整可见、首列被裁）

## 6. 门禁与证据

- [x] 6.1 `node tests/unit/run.mjs`（1362 pass / 0 fail）+ `npx tsc --noEmit`（根 / 单测 / 视觉三份）
- [x] 6.2 `scripts/gate.sh quick`：`GATE RESULT: 11/11 PASS（SKIP 0）`，退出码 0
- [x] 6.3 `scripts/gate.sh visual`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；
      视觉套件 826 passed / 1 skipped，未新增或更新像素基线
- [x] 6.4 `bash scripts/docs-check.sh` PASS / `openspec validate --all --strict` 42/42 PASS /
      `node scripts/acceptance/run.mjs --check` PASS
- [ ] 6.5 证据与完工报告对账后提交（source only），TowerComplete

## 7. 归档（节点 2）

- [ ] 7.1 节点 2 归档评审通过后 `openspec archive harness-table-horizontal-scroll-oct24`
      （批次收尾执行；本 change 活跃期不改 living spec / backlog）
