# Tasks: fix-webkit-table-cell-editing-nov19

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal，不静默扩 scope。

## 1. 诊断（修复前反例）

- [x] 1.1 读 [REVIEW.md](../../../REVIEW.md) 与 finding
      `20261119-worker-markdown-stability-bug-webkit-cell-backspace-delete-dom.md`；
      用 Playwright chromium + webkit（真机同款 UA）探针记录真实事件序 / DOM / 事务与 cell 选区映射。
- [x] 1.2 区分根因：不是 caret 的 state 映射（点击后 `anchor = 27/26` 与 DOM 选区偏移都正确），
      而是 WebKit 原生编辑的 target range 把 cell slot 首尾对齐空白当块级 padding，跨过零宽
      replace 覆盖的隐藏源码；CM DOMReader 再按 DOM 文本回读。证据与矩阵见
      `.local/probes/2026-11-19-m855-table-cell/`（probe1 的事件 / target range / MutationRecord
      原卷，probe2 的 9 位置 × 3 输入矩阵）。
- [x] 1.3 修复前反例逐条留档（`probe1`）：键入吃尾部空白、Backspace 跨行毁表、Delete 删管道；
      chromium 与表头对照正确。不改任何期望值，只把正确合同写成断言。

## 2. 实现（最小 CM / 表格几何修复）

- [x] 2.1 `src/editor.ts` 新增 beforeinput 闸门 `absorbTableCellInput`：单折叠光标 +
      `cellClamp` 命中 cell slot 时，对 `insertText` 按 state 光标显式插入、对
      `deleteContentBackward` / `deleteContentForward` 调既有 `deleteCharBackward` /
      `deleteCharForward`（`editLimits` 即同一个 cell slot），命中即 `preventDefault()`。
- [x] 2.2 判据只读 `EditorState`：不读 DOM / AX 文本，不按字符类型分支，不新增第二套 caret 模型；
      非空选区、IME 组合期、只读会话与多区间选区放行原生路径。
- [x] 2.3 与 M836 的 `lineMergeDeleteGate` 并列装配、命中面互斥（cell slot vs 行边界），
      两闸门结果对纯文本不引入第二套语义。
- [x] 2.4 Chromium 不回归：两引擎跑同一批表格用例，逐字节结果与选区一致。

## 3. 回归矩阵与真机场景

- [x] 3.1 `tests/visual/scenes/markdown-editing-stability.spec.ts`：把 M842 标
      `knownDefect: webkit` 的四条（数据 cell 键入 / 首缘 Backspace / 尾缘 Delete / ⌘S 落盘）
      转正；新增数据 cell 首缘键入、尾缘 Backspace、首缘 Delete、表头四组对照（键入 / 双向删除）
      与一次 undo；保留两条 cell 选区删除的 expected failure（归 M854）。
- [x] 3.2 目标场景双引擎各跑一遍：chromium 16/16 表格用例通过；webkit-realua（真机同款 UA）
      16/16 通过（两条选区删除按 expected failure 计过），整份
      `markdown-editing-stability.spec.ts` 两个 project 各 49 passed。
- [x] 3.3 新增 `scripts/acceptance/scenarios/265-table-cell-webkit-editing.md`（数据 cell 尾缘
      键入 / 首缘 Backspace / 尾缘 Delete / 表头对照；四格都用 `file.exact` 判整篇全文，并各配
      一次 `⌘Z` + `unchangedSince` + `mtimeUnchangedSince`）；`node scripts/acceptance/coverage.mjs`
      重建 COVERAGE（240 场景 / 217 项）；`node scripts/acceptance/run.mjs --check 265` PASS。
- [ ] 3.4 真机 265 执行并记录 PASS 证据：M855 期间真机窗口由 tower 串行分配，**未跑不得记 PASS**。

## 4. 验证

- [x] 4.1 `node scripts/acceptance/run.mjs --check`：240 个场景静态校验 PASS（含 265）。
- [x] 4.2 `scripts/gate.sh quick` 全绿：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
      （2026-11-19，最终源码；日志 `.local/missions/m855-table-cell-webkit-editing/gate-quick.log`）。
- [x] 4.3 `LUMIR_VISUAL_PORT=4434 scripts/gate.sh visual` 全绿：`GATE RESULT: 15/15 PASS（SKIP 0）`，
      退出码 0（visual-regression 991s，含全量像素；未更新任何基线；日志
      `.local/missions/m855-table-cell-webkit-editing/gate-visual.log`）。
- [x] 4.4 OpenSpec validate（`openspec-validate`）与 `docs-check` 均随 4.2 的 quick 门禁 PASS；
      `acceptance-suite`（JS 语法 + 全部场景静态校验 + 覆盖表 + 套件自测）同批 PASS。
