# Tasks: align-block-scroller-focus-entry

补记 change：下列任务按「已存在的实现」逐条核对，不新增代码。

## 1. 与现状矛盾的表述（keymap-commands）

- [x] 1.1 核对焦点入口的现状：`editor.focus-block-scroll` 由 `src/editor.ts:2028` 注册、`src/keys.ts:635`
      默认绑定 `Ctrl-Alt-KeyS`（`⌃⌥S`），实现在 `src/preview/livePreview.ts:558` 的 `focusBlockScroll`
- [x] 1.2 核对「无容器时静默无操作」：`focusBlockScroll` 在 caret 不在块内、或该块无容器
      （`editor.code_block_wrap = true` 的折行档）时直接返回，不报错、不动文档
- [x] 1.3 改写「焦点入口」段（MODIFIED）：删「当前没有任何真机验通的路径」，写明 `⌃⌥S` 入口与其语义
- [x] 1.4 改写 Scenario「代码块容器与表格容器同判据同行为」的 `WHEN`：由 chromium 编程聚焦改为真机
      `⌃⌥S` 进入

## 2. 与现状矛盾的表述（editor-live-preview）

- [x] 2.1 核对 Scenario「代码块容器的键盘可达性」：`Tab` 已被 `editor.list-indent` 接管，不再是入口
- [x] 2.2 改写该 Scenario 的 `WHEN`：把焦点移入改为「把光标放进代码块后按 `⌃⌥S`」

## 3. 验证

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 3.2 归档后核对 living spec：两处 requirement 不再含「没有产品入口 / 用 `Tab` 移入」的记述
- [x] 3.3 归档评审（节点 2）：M474 的实现已随该 mission 完成评审，本 change 随 M476 批次归档
