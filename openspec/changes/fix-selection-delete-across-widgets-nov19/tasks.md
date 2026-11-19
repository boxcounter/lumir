# Tasks: fix-selection-delete-across-widgets-nov19

## 1. 探针与合同

- [x] 1.1 读 REVIEW.md 与 finding `20261119-worker-markdown-stability-bug-dom` / `...-bug-webkit-cell`，在真 EditorView 上跑探针：CM 选区与目标源码 range 逐值一致、文档未被触碰；`beforeinput` 为 `deleteContentBackward`、`defaultPrevented=false`；原生删除两引擎损坏形状不同；同一 range 的显式事务两引擎逐字节正确、一次 undo 复原。证据 `.local/reports/m854-probe.md`（git 外）。
- [x] 1.2 定义合同：非空选区删除只影响 `state.selection` 覆盖的源码字节；方向 / 输入类型不改变结果；一个事务 = 一条 history 步；save 载荷 = 当前 doc。规格 delta 落在 `editor-live-preview`（MODIFIED 既有 requirement 的已证伪句 + ADDED 新 requirement）。

## 2. 实现

- [x] 2.1 `src/editor.ts` 的 beforeinput 闸门扩到非空选区：`SELECTION_DELETE_INPUTS`（char / word / line 四个方向变体）+ `deleteSelectedRanges`（单区间走既有 `deleteRange`，多区间按 `state.selection` 生成 changes）；判据只读 state，不检测 widget / 不读 DOM 文本。
- [x] 2.2 保持空光标行边界合并（M836）原判据；IME 组合期、只读会话跳过；词删除变体的空光标分支仍调应用命令（kill 槽语义不变）。

## 3. 回归与真机

- [x] 3.1 `tests/visual/scenes/markdown-editing-stability.spec.ts`：M842 的 `test.fail` describe 转正为 11 条真实用例（表格跨行正 / 反向 / Delete、同行跨 cell、同 cell、混合列表、反向、marker 内部端点、普通文本、undo/redo、`⌘S` 精确落盘），并把表格矩阵里两条选区用例的 `knownDefect` 移除；每条先断言 CM 选区与源码 range 一致。
- [x] 3.2 新增 `scripts/acceptance/scenarios/266-selection-delete-widgets.md`（键盘跨行选区 + 鼠标 shift-click 破坏形状、精确落盘、一次撤销），`node scripts/acceptance/coverage.mjs` 重新生成 COVERAGE。
- [x] 3.3 真机 266 在 tower 串行窗口内执行：`PASS`、1/1、场景 26.8s、退出码 0、15 条断言全 PASS；`file.exact` 逐字命中 `| a | b |\n| --- | --- |\n|  | d |\n`，一次 ⌘Z 复原且零额外写盘。证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-m854-266/`（git 外）。同窗口首跑被磁盘水位挡住（run.mjs 判 `磁盘可用 0.13G < 2G`、退出码 2 = INVALID），按 tower 裁决清盘后复跑；该次不作为产品失败。真机 witness 用真实鼠标双击单字符 cell（键盘 ↓/⇧↓ 在真机 caret 几何下落到空格，已如实写进场景注释）。
- [x] 3.4 目标双引擎：`markdown-editing-stability.spec.ts` chromium + webkit-realua 各 52 条，`104 passed`（2026-11-19 复跑同值）；WebKit 余 4 条 expected failure 属 finding `...-bug-webkit-cell`（空光标 cell 端点键入 / 删除），不在本 change 的接管面内。

## 4. 验证

- [x] 4.1 `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（2026-11-19，tip 见 4.4）。
- [ ] 4.2 `LUMIR_VISUAL_PORT=4393 scripts/gate.sh visual` 全绿并记录 `GATE RESULT` 原文行；不更新任何像素基线。
- [x] 4.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh`、`node scripts/acceptance/run.mjs --check` 通过（2026-11-19：`validate --all --strict` → `Totals: 35 passed, 0 failed`；`docs-check: PASS`；`--check` → `场景静态校验通过（240 个）`）。
- [ ] 4.4 门禁读数与真机证据回填本节，提交 TowerComplete 等待独立 review。
