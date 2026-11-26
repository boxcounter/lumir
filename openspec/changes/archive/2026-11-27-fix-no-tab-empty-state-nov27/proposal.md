# Proposal: 无 TAB 空态的呈现修正

- Change ID: `fix-no-tab-empty-state-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（需求与裁决），AI agent（起草）

## Why

没有打开任何 TAB 时，content pane 仍然显示行号 gutter，并且编辑器带着一个**假输入焦点**：光标在场、点击可聚焦，但按键不产生字符（分栏空 pane / 首启 tips 是结构性只读）。对用户来说这不是「空态」，而是「编辑器坏了」——行号暗示这里有一份文档，光标暗示这里能打字，两者同时为真时实际什么也不会发生。

Alex 的需求原话：没有打开 TAB 时 content pane 不显示行号、无假输入焦点；当前有行号、有焦点但按键无字符，像 bug。常规细节由主会话代裁。

根因有三处：

1. 行号 gutter 的在场判据只有「全局开关 / ⌥G 临时档」，没有「该文档 pane 是否有带路径标签」这一维；空编辑器上因此常驻一列无意义的 `1`。
2. 结构性只读（分栏空 pane、首启 tips）只被表达成 `editable = false`，而 `drawSelection()` 仍会在聚焦时画 CM 插入光标；「只读」与「坏了」在外观上不可区分。
3. 老用户空 vault 的 D107 覆盖层挂在 `shell.editorRow` 上，`inset:0` 以整条分栏行为界，一旦 harness 打开就把 harness 与 composer 一起盖住；显示时还会整块隐藏编辑器 DOM。

## What Changes

1. **行号：无标签文档 pane 不出行号**
   - 任一 doc pane 的 `hasTabs=false`（没有带路径会话）时，该 pane MUST NOT 显示行号 gutter；⌥G 的临时 gutter 同样受约束。
   - 有带路径标签进入后，按 `[ui] line_numbers` 与 ⌥G 既有两档恢复；单 pane 未命名 scratch 仍可编辑并落字（M149 形态不变），只是没有行号。
   - 判据与开关 / 临时档合成一个纯函数（`src/line-numbers.ts` 的 `gutterVisible`），`src/editor.ts` 的 `gutterExtensions()` 是唯一消费者；per-pane `hasTabs` 复用 `renderAllTabStrips` 的既有读数。
2. **结构性只读：不画插入光标，但保留焦点 / 选中 / 复制**
   - 分栏空 pane 与首启 tips 的**前台** MUST NOT 画 CM 插入光标；点击仍可聚焦并激活 pane，只读内容仍可选中复制，`tabindex` 与既有焦点归还不改。
   - 可编辑 scratch（单 pane 空态、分栏前 dirty scratch）照旧有光标；有文档后同帧恢复。
   - 结构只读的呈现标记逐会话随 `setSessionEditable` 重配，样式只隐藏 `.cm-cursorLayer`，MUST NOT 用 `:has()` 从 `contenteditable=false` 反推（vault 外只读文档仍保留光标）。
   - 空 pane 引导的指针由 `text` 改为 `default`，不新增创建按钮。
3. **老用户空 vault 的 D107 覆盖层收窄到 doc pane**
   - 覆盖层挂进活跃 doc pane 的挂载元素，只覆盖该 pane，MUST NOT 覆盖 harness/composer；composer 与草稿不受影响。
   - 首启 tips 保持原样（继续只覆盖 root doc pane，不盖 harness）。
4. **不变项**
   - 不把「全部无 TAB」一刀切为只读：单 pane scratch 仍可编辑；分栏前 dirty scratch 的豁免保留。
   - 无 TAB 时 modeline 本批不改。
   - 不改文档内容、dirty、撤销栈、保存链路、键位与配置 schema；不新增 IPC。

## 节点 1：批准与代裁记录

- Alex 需求（2026-11-27）：没有打开 TAB 时 content pane 不显示行号、无假输入焦点；当前有行号、有焦点但按键无字符，像 bug。常规细节由主会话代裁。
- 主会话代裁（记录进本 proposal 与 design）：
  - **S1/S5**：单 pane 未命名 scratch 仍保持 M149 的可编辑形态，但也无行号；不删除 scratch、不改保存提示口径。
  - **S2**：老用户空 vault 的覆盖层收窄到 doc pane，不能覆盖 harness/composer；不新增创建按钮、不改 D107/D882 文案与动作。
  - **S3**：首启 tips 原样，不盖 harness；tips 前台的结构只读不画光标。
  - **S4**：分栏空 pane 无行号、无光标、键入无效，但点击仍激活 pane；可选中复制、tabindex 与焦点归还不改。
  - 只改呈现，不把全部无 TAB 一刀切只读；分栏前 dirty scratch 豁免保留；有文档后同帧恢复行号与可编辑光标。

## Non-goals

- 不删除单 pane 空态 scratch，不改 M149 的「空态即未命名草稿、可直接键入」形态。
- 不把行号开关改成 per-pane 偏好，不改 `[ui] line_numbers` 的两档语义、默认值与持久化。
- 不改 ⌥G 的输入条、落点、钳制与取消语义；只让临时 gutter 受 per-pane 判据约束。
- 不改 modeline 的路径 / 行数 / 行号指示钮。
- 不新增空态创建按钮、不改 D107 / D882 / D369 文案。
- 不改 harness composer 的输入、草稿与持久化；不改首启 tips 的内容与生命周期。
- 不新增 IPC、Rust 命令、config schema 或 ts-rs 导出面。
- 不在本 change 的实现 PR 内更新视觉基线或执行真机；基线截图落 `.local/missions/fix-no-tab-empty-state-nov27/` 供主会话自审，真机由主会话排期执行（885 r4 PASS 16 断言，证据见节点 2）。

## Impact

- 影响的 specs：
  - `keymap-commands`（行号可见面 / 行号开关 / gutter 右键复制的「无标签不出行号」条件）
  - `pane-layout`（分栏空 pane 的结构性只读呈现；新增「无标签文档 pane 的空态呈现」）
- 影响的代码：
  - `src/line-numbers.ts`（`gutterVisible` 纯函数）
  - `src/editor.ts`（`EditorSession.structuralReadOnly`、`setPaneHasTabs`、`gutterExtensions`、结构性只读标记）
  - `src/main.ts`（`renderAllTabStrips` 接线、D107 覆盖层收窄到活跃 doc pane）
  - `src/style.css`（光标层隐藏、空 pane 引导 `cursor: default`）
- 影响的测试：
  - 单测：`tests/unit/line-numbers.test.ts` 增 `gutterVisible` 真值表；`tests/unit/harness.ts` 替身补字段。
  - 视觉：新增 `tests/visual/scenes/no-tab-empty-state-nov27.spec.ts`（S2–S5）；更新 `m281-goto-line.spec.ts` 的「新 pane」用例（空 pane 无 gutter、打开文档后 1/1）与 `gutter-copy-path-line.spec.ts` 的「关闭最后标签」用例（无 gutter、无手势、重开恢复）。
  - 验收：新增 `scripts/acceptance/scenarios/885-no-tab-empty-state.md`；真机 885 r4 PASS 16 断言（`.local/acceptance/2026-11-27-ux-goal-r4/885-no-tab-empty-state/`）。
- 视觉基线：候选截图落 `.local/missions/fix-no-tab-empty-state-nov27/`；完整像素门禁无基线差异，未执行 `--update`。
- 关联约束：ADR 0003（不改写源文件）、ADR 0004（AI-only 开发）、ADR 0006（Emacs keybinding PKM 定位）。


## 节点 2：归档放行记录

机器 + 独立评审放行（`docs/process/openspec-workflow.md` 的五要件）；逐条读数如下：

1. **方案已批准**：节点 1 记录见本文件「节点 1：批准与代裁记录」（Alex 2026-11-27 需求 +
   主会话代裁 S1–S5）；实现期无静默扩 scope。
2. **独立 reviewer clean / merge**：K3 独立终审 clean/merge，绑定实现 tip `a6e79de8`
   （P1 / P2 / P3 = 0；评审文 `.local/reviews/fix-no-tab-empty-state-nov27/k3-verdict.md`）。
   之后的 master 合并与验收场景修正（885）不含产品代码改动；真机 r4 PASS 覆盖其行为。
3. **tasks 完成**：`tasks.md` 的 6 组任务全部勾选（含 6.4 完整视觉读数与真机 885 r4 PASS）；
   无放弃项。
4. **门禁与真机证据**：
   - 合并预检：前端单测 2145 PASS、docs-check PASS、acceptance `--check` 308 场景 PASS。
   - 完整 `scripts/gate.sh visual`：`GATE RESULT: 13/15 PASS（SKIP 0）`；两个 FAIL 均为
     master 既有失败（unit 的 `link-suggest` 时序抖动，隔离单跑 2145/2145 PASS；visual 的
     m133 / persistence-health V6 / 迟到旧 switched / webkit editing-oracle IME 四条已在
     master 59052847 逐条复现）。无基线差异，未更新基线。
     证据：`.local/missions/fix-no-tab-empty-state-nov27/gate-visual-nov27.log`、
     `visual-regression-full.log`、`unit-tests-load-failure.log`。
   - 真机 885：r4 PASS 16 断言，
     `.local/acceptance/2026-11-27-ux-goal-r4/885-no-tab-empty-state/`。
5. **规格对账无丢段**：归档前 `node scripts/openspec-archive-check.mjs` 门禁模式 PASS
   （22 份 delta / 18 条 MODIFIED / 342 段 / 无静默丢段；归档队列 2 项均唯一）；
   `validate --all --strict` 44 passed / 0 failed；`docs/backlog.md` 归档队列有且仅有一条
   本 change 条目。

**归档后记录**：包装器 `node scripts/openspec-archive.mjs fix-no-tab-empty-state-nov27`
归档为 `2026-11-27-fix-no-tab-empty-state-nov27`；specs 更新 `keymap-commands` 3 条
MODIFIED、`pane-layout` +1 ADDED / 1 MODIFIED，Totals `+1, ~4, -0, →0`；修链 0 处
（扫过 5 篇 Markdown / 2 条相对链接），`openspec-links: PASS（710 条全部可达）`。
归档提交 hash 与 `--archived` PASS 读数待首次归档提交后回填。
