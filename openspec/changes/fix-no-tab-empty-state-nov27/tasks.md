# Tasks: fix-no-tab-empty-state-nov27

> 开工前先过 `REVIEW.md`，重点核对自己的改动面：『同一语义两处真源』（gutter 判据 / 结构只读
> 判据各只一处）、『断言等价于子串』（视觉用例要有「有文档」的对照面）、『读不到当成空』
> （光标层 / gutter 读数缺失一律 FAIL）、『标题栏 mousedown preventDefault』（本 change 不碰
> 标题栏监听）。节点 1 已按 Alex 需求与主会话代裁记录在 `proposal.md`；实现按本 tasks 执行。

## 1. 行号：per-pane `hasTabs`

- [x] 1.1 `src/line-numbers.ts` 新增纯函数 `gutterVisible(hasTabs, lineNumbersOn, gotoGutterVisible)`；
      无标签压过持久 `on` 与 ⌥G 临时档。`src/editor.ts` 的 `gutterExtensions()` 是唯一消费者。
- [x] 1.2 `EditorHandle` 新增 `setPaneHasTabs(hasTabs)`；实例变量 `paneHasTabs` 初值 `false`；
      与 `setLineNumbers` / `setGotoLineGutterVisible` 共用 `reconfigureGutter()`（全部会话、两模式）。
- [x] 1.3 `renderAllTabStrips` 把既有 `hasTabs` 逐 pane 喂给 `setPaneHasTabs`；有文档后同帧恢复。
- [x] 1.4 单测：`tests/unit/line-numbers.test.ts` 增 `gutterVisible` 真值表，含「无标签 + on →
      false」「无标签 + ⌥G → false」「有标签 + 两档 → 按档」与 `hasTabs` 翻面的反向判据。

## 2. 结构性只读：无插入光标

- [x] 2.1 `EditorSession` 新增 `structuralReadOnly`；`makeSession` / `makeImageSession` 初值 false；
      `setSessionEditable` 第三参写入，幂等比较两个维度；`reloadSession` 装载时清 false。
- [x] 2.2 `modeExtensions` / `modeAndWrapEffects` / `rebindEffects` / `sessionState` / `loadedState`
      把 `structuralReadOnly` 穿到 `.cm-editor` 的 `lumir-structural-readonly` 类；`adoptSession`
      带上迁入会话的标记。
- [x] 2.3 `src/style.css` 增 `.cm-editor.lumir-structural-readonly .cm-cursorLayer { visibility:
      hidden; }`；MUST NOT 用 `:has()`、MUST NOT 覆盖 animation；`.cm-selectionLayer` 与
      `tabindex` / `aria-readonly` 不变。
- [x] 2.4 `.pane-empty-guide` 的 `cursor: text` 改 `default`；不新增创建按钮。
- [x] 2.5 `renderAllTabStrips` 计算 `structuralReadOnly = paneBlocksInput(...) || firstRunTipsVisible`，
      与 `editable` 一起喂给 `setSessionEditable`；分栏前 dirty scratch 豁免与单 pane scratch 可编辑不变。

## 3. D107 覆盖层收窄

- [x] 3.1 `renderNotice` 不再整块隐藏 `editor.view.dom`；改为 `placeNotice()` 把覆盖层移进活跃
      doc pane 的 `.editor-pane`，只隐藏该 pane 的编辑器。
- [x] 3.2 `placeNotice()` 幂等、可见时跟随活跃 pane 换宿主；`syncActiveDocument` 在
      `renderAllTabStrips` 后调用一次；`showEditor()` 恢复 `noticeHostEditor` 的显示。
- [x] 3.3 首启 tips 的挂载与生命周期不改；D107 / D882 文案与动作链路不改；不新增创建按钮。

## 4. 视觉与单测

- [x] 4.1 新增 `tests/visual/scenes/no-tab-empty-state-nov27.spec.ts`：
      S5 单 pane scratch（on 档关标签后无 gutter / 可输入 / 光标可见 / 重开恢复）；
      S4 分栏空 pane（无 gutter / 光标层 hidden / 键入无效 / 点击激活 / 打开文档后恢复）；
      S3 首启 tips（无 gutter / 光标 hidden / 不盖 harness）；
      S2 老用户空 vault（D107 收窄在 doc pane、harness 与 composer 可见可输入）。
- [x] 4.2 更新 `tests/visual/scenes/m281-goto-line.spec.ts` 的「新 pane」用例：空 pane
      0 条 gutter（on 档 + ⌥G 临时档都不例外），打开文档后 `[1,1]`。
- [x] 4.3 更新 `tests/visual/scenes/gutter-copy-path-line.spec.ts` 的「关闭最后标签」：on 档
      无 gutter、原位置右键不复制不反馈、重开文档恢复；旧断言「空文档继承 always 档」删除。
- [x] 4.4 `tests/unit/harness.ts` 替身补 `structuralReadOnly: false`，与真编辑器初值一致。
- [x] 4.5 视觉像素候选截图落 `.local/missions/fix-no-tab-empty-state-nov27/`，供主会话自审；
      本 change MUST NOT 自行 `--update` 基线。

## 5. 规格与验收制品

- [x] 5.1 `openspec/changes/fix-no-tab-empty-state-nov27/` 的 proposal / design / tasks 与
      `specs/keymap-commands`、`specs/pane-layout` 增量；MODIFIED 条整条复制 living 后改。
- [x] 5.2 新增 `scripts/acceptance/scenarios/885-no-tab-empty-state.md`（S5 / S4 真机行为 +
      截图证据）；884 未被占用（本分支最高为 878），885 为空号。
- [x] 5.3 `node scripts/acceptance/run.mjs --check` 通过。
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.5 `bash scripts/docs-check.sh` 通过。

## 6. 验证

- [x] 6.1 目标单测：`pnpm test`（或 `node --test tests/unit/line-numbers.test.ts tests/unit/pane-layout.test.ts`）。
- [x] 6.2 根 `pnpm exec tsc --noEmit` 与 visual `tsc -p tests/visual/tsconfig.json --noEmit` 通过。
- [x] 6.3 结构层视觉：`LUMIR_VISUAL_STRUCTURAL=1 pnpm --dir tests/visual exec playwright test
      scenes/no-tab-empty-state-nov27.spec.ts scenes/m281-goto-line.spec.ts
      scenes/gutter-copy-path-line.spec.ts`（按本仓实际脚本名核对后执行）。
- [ ] 6.4 完整视觉门禁与基线更新**不在本 worker 执行**：像素测试与 `scripts/gate.sh visual`
      由主会话串行安排；真机场景 885 未执行，待主会话排期。完成后勾选本项，change 才进入归档跟踪。
