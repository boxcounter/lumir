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

- [x] 2.1 `src/editor.ts` 的统一 beforeinput 闸门 `absorbNativeEdit`（M854）内新增折叠 cell
      分支：单折叠光标 + `cellClamp` 命中 cell slot 时，对 `insertText` 按 state 光标显式插入、
      对 `deleteContentBackward` / `deleteContentForward` 调既有 `deleteCharBackward` /
      `deleteCharForward`（`editLimits` 即同一个 cell slot），命中即 `preventDefault()`。
- [x] 2.2 判据只读 `EditorState`：不读 DOM / AX 文本，不按字符类型分支，不新增第二套 caret 模型；
      非空选区、IME 组合期、只读会话与多区间选区放行原生路径。
- [x] 2.3 rebase 到含 M854 的 master 后并入同一个 `nativeEditGate`：非空选区分支 →
      折叠 cell 分支 → 折叠行边界分支（M836）依次早退，命中面互斥；两分支对纯文本不引入
      第二套语义。
- [x] 2.4 Chromium 不回归：两引擎跑同一批表格用例，逐字节结果与选区一致。

## 3. 回归矩阵与真机场景

- [x] 3.1 `tests/visual/scenes/markdown-editing-stability.spec.ts`：把 M842 标
      `knownDefect: webkit` 的四条（数据 cell 键入 / 首缘 Backspace / 尾缘 Delete / ⌘S 落盘）
      转正；新增数据 cell 首缘键入、尾缘 Backspace、首缘 Delete、表头四组对照（键入 / 双向删除）
      与一次 undo；M854 合并后选区删除 / 键入替换用例也已在同 spec 转正，合并结果不含任何
      expected-failure 标记（`knownDefect` 机制随之删除）。
- [x] 3.2 目标场景双引擎各跑一遍（rebase 后 tip）：整份 `markdown-editing-stability.spec.ts`
      chromium 67 passed / webkit-realua（真机同款 UA）67 passed（含 M854 选区节与 IME 用例）。
- [x] 3.3 新增 `scripts/acceptance/scenarios/265-table-cell-webkit-editing.md`（数据 cell 尾缘
      键入 / 首缘 Backspace / 尾缘 Delete / 表头对照；四格都用 `file.exact` 判整篇全文，并各配
      一次 `⌘Z` + `unchangedSince` + `mtimeUnchangedSince`）；`node scripts/acceptance/coverage.mjs`
      重建 COVERAGE（rebase 后 243 场景 / 220 项）；`node scripts/acceptance/run.mjs --check 265` PASS。
- [ ] 3.4 真机 265 在 rebase 后复跑（2026-11-20，`LUMIR_ACCEPTANCE_PORT=4394` /
      `CARGO_TARGET_DIR=/tmp/lumir-m855-target`，标准隔离 XDG + 合成 vault）：**PASS 1/1**，
      32 断言 / 0 失败，31.8s，退出码 0；四格 `file.exact` 逐字一致（441 / 439 / 439 / 441），
      三次撤销 `unchangedSince` + `mtimeUnchangedSince` 通过。证据
      `.local/missions/M855/acceptance-2026-11-20-rebase/` 与 `acceptance-265-rebase.log`；
      跑完已删除 target。**勾选留给归档节点**：本 mission scope 不含 `docs/backlog.md`，
      勾选后 docs-check 会要求该 change 的归档跟踪条目（实测），由归档节点一并补。

## 4. 验证

- [x] 4.1 `node scripts/acceptance/run.mjs --check`：rebase 后 243 个场景静态校验 PASS（含 265）；
      COVERAGE 生成器重建后 `acceptance-suite` 门禁同批 PASS。
- [x] 4.2 rebase 后 `CARGO_TARGET_DIR=/tmp/lumir-m855-target scripts/gate.sh quick`：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（日志
      `.local/missions/M855/gate-quick-rebase.log`）。
- [x] 4.3 rebase 后 `CARGO_TARGET_DIR=/tmp/lumir-m855-target LUMIR_VISUAL_PORT=4394
      scripts/gate.sh visual`：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0
      （visual-regression 1075s，含全量像素；未更新任何基线；日志
      `.local/missions/M855/gate-visual-rebase.log`）。
- [x] 4.4 OpenSpec validate（`openspec-validate`）与 `docs-check` 均随 4.2 的 quick 门禁 PASS；
      `acceptance-suite`（JS 语法 + 全部场景静态校验 + 覆盖表 + 套件自测）同批 PASS。
