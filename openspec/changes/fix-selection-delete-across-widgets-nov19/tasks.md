# Tasks: fix-selection-delete-across-widgets-nov19

## 1. 探针与合同

- [x] 1.1 读 REVIEW.md 与 finding `20261119-worker-markdown-stability-bug-dom` / `...-bug-webkit-cell`，在真 EditorView 上跑探针：CM 选区与目标源码 range 逐值一致、文档未被触碰；`beforeinput` 为 `deleteContentBackward`、`defaultPrevented=false`；原生删除两引擎损坏形状不同；同一 range 的显式事务两引擎逐字节正确、一次 undo 复原。证据 `.local/reports/m854-probe.md`（git 外）。
- [x] 1.2 定义合同：非空选区删除只影响 `state.selection` 覆盖的源码字节；方向 / 输入类型不改变结果；一个事务 = 一条 history 步；save 载荷 = 当前 doc。规格 delta 落在 `editor-live-preview`（MODIFIED 既有 requirement 的已证伪句 + ADDED 新 requirement）。
- [x] 1.3 L7 同步（tower 扩 scope 后）：`docs/specs/lists.md` 的适用范围段与「既有路径不动」两处删掉「非空选区删除不在本条内」的旧口径，改为指向本 change 的统一选区编辑合同；不改 L7 其余条款。

## 2. 实现

- [x] 2.1 `src/editor.ts` 的 beforeinput 闸门扩到非空选区：`SELECTION_DELETE_INPUTS`（char / word / line 四个方向变体）+ `deleteSelectedRanges`（单区间走既有 `deleteRange`，多区间按 `state.selection` 生成 changes）；判据只读 state，不检测 widget / 不读 DOM 文本。
- [x] 2.3 M855 finding 同族并入：非空选区上的普通 `insertText` 走同一闸门，用 `state.replaceSelection(text)` 单事务替换选区源码（不吃选区前对齐空白）；IME 组合、粘贴与拼写替换不扩。
- [x] 2.2 保持空光标行边界合并（M836）原判据；IME 组合期、只读会话跳过；词删除变体的空光标分支仍调应用命令（kill 槽语义不变）。

## 3. 回归与真机

- [x] 3.1 `tests/visual/scenes/markdown-editing-stability.spec.ts`：M842 的 `test.fail` describe 转正为真实用例（表格跨行正 / 反向 / Delete、同一行跨 cell、同 cell、混合列表、反向、marker 内部端点、普通文本、`insertText` 替换（含 M855 跨 cell 形状 / 反向 / undo / 精确落盘）、undo/redo、`⌘S` 精确落盘），并把表格矩阵里两条选区用例的 `knownDefect` 移除；每条先断言 CM 选区与源码 range 一致。r1 追加 IME 组合期回归：`compositionstart` 后（`view.composing` 尚为 false、`compositionStarted` 为 true）的 `insertText` / `deleteContentBackward` 不被闸门消费，组合结束后普通编辑精确、undo/redo 合同成立。
- [x] 3.2 新增 `scripts/acceptance/scenarios/266-selection-delete-widgets.md`（真实鼠标双击单字符 cell 建立锚点 + ⇧→ 扩选；删除与跨 cell 键入替换两条 witness、精确落盘、一次撤销），`node scripts/acceptance/coverage.mjs` 重新生成 COVERAGE。
- [x] 3.3 真机 266 在 tower 串行窗口内执行：`PASS`、1/1、场景 21.9s、退出码 0。两条 witness 的 `file.exact` 逐字命中：删除 `| a | b |\n| --- | --- |\n|  | d |\n`（33 字符）、跨 cell 键入替换 `| a | b |\n| --- | --- |\n| Q |\n`（30 字符）；各配一次 ⌘Z 复原与零额外写盘。证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-m854-266/`（git 外）。同窗口首跑被磁盘水位挡住（run.mjs 判 `磁盘可用 0.13G < 2G`、退出码 2 = INVALID），按 tower 裁决清盘后复跑；该次不作为产品失败。真机 witness 用真实鼠标双击单字符 cell 建立锚点（键盘 caret 导航在真机几何下落到空格，已如实写进场景注释）；普通可打印键的 KimiCU 注入偶发丢键，替换键入改走 cgevent 的 `shift+q`。
- [x] 3.4 目标双引擎（r1 修复后）：`markdown-editing-stability.spec.ts` chromium + webkit-realua 各 61 条，`122 passed`（含新增 IME 组合期回归；日志 `.local/missions/M854/target-spec-r1.log`）。此前实现版读数 60/60 共 120——review r1 P2-1 指出旧记录误写 52/104，已按实际制品改正。WebKit 余 4 条 expected failure 属 finding `...-bug-webkit-cell`（空光标 cell 端点键入 / 删除），不在本 change 的接管面内。

## 4. 验证

- [x] 4.1 `scripts/gate.sh quick`（r1 修复提交，`CARGO_TARGET_DIR=/tmp/lumir-m854-target`）：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（日志 `.local/missions/M854/gate-quick-r1.log`；temp target 跑后已删）。
- [ ] 4.2 `LUMIR_VISUAL_PORT=4393 scripts/gate.sh visual`：实现 tip `c8b94170` 上曾得 `GATE RESULT: 15/15 PASS（SKIP 0）`（929s，未更新基线）；r1 修复（`compositionStarted` guard + IME 回归）后**待重跑**——等 M843 的 visual 槽位结束并经 tower 批准后执行，读数回填此项。
- [x] 4.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh`、`node scripts/acceptance/run.mjs --check` 通过（2026-11-19：`validate --all --strict` → `Totals: 35 passed, 0 failed`；`docs-check: PASS`；`--check` → `场景静态校验通过（240 个）`）。
- [x] 4.4 r1 修复：闸门 IME guard 改为 `view.compositionStarted`（保留 `event.isComposing`）+ 新增 WebKit 组合期回归；tasks 读数按实际制品改正（61/引擎、122 passed）。r1 提交后 quick 13/13 PASS、目标双引擎 122 passed；visual 待 M843 槽位结束 + tower 批准后重跑（4.2）。真机证据 `.local/acceptance/2026-11-19-m854-266/`；原始日志 `.local/missions/M854/`。提交 TowerComplete 等待 fresh review。
