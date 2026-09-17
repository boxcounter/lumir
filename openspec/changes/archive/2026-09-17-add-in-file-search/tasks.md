# Tasks: add-in-file-search

补记 change：实现已在 M139 合入（merge `647f519`），下列任务按「已存在的实现与证据」逐条核对，不新增代码。

## 1. 能力现状对账（按实现倒推规格）

- [x] 1.1 打开入口：`src/keys.ts` 注册 `app.search-open`（`⌘F`，作用域 `global`）并纳入 `GLOBAL_COMMAND_IDS`（`src/keys.ts:157`、绑定来由见 `src/keys.ts:294`）；装配在 `src/main.ts:746` 映射到 `src/search.ts` 的 `openSearch`
- [x] 1.2 面板能力集与实现一致：`src/search.ts` 文件头列出的 v0 能力集（查找 / 全匹配高亮 / 上一个 / 下一个 / 大小写切换 / 匹配计数）与本 change 的 requirement 逐条对应；**替换有意不在其中**
- [x] 1.3 关闭与焦点口径与实现一致：`PANEL_CLOSE_TOKENS`（`Escape` / `Ctrl-G`）+ 关闭按钮三路关闭，`closeSearch` 先 `view.focus()` 再关面板（不依赖官方还原焦点的时序）
- [x] 1.4 只读性：搜索不 dispatch 任何 doc 变更（唯一 dispatch 是 `setSearchQuery` 的查询状态）
- [x] 1.5 已知边界如实写入 spec：高亮只看视口；被 replace widget 覆盖的匹配无可见高亮

## 2. 验证

- [x] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 2.2 真机证据在案：`scripts/acceptance/scenarios/search-01-find.md`（⌘F 打开、匹配计数、上一个/下一个导航、Esc 还原焦点）与 `search-02-binding.md`（`config.json` keys 表重绑搜索命令生效），证据目录 `test-results/acceptance/2026-09-16/`
- [x] 2.3 归档评审（节点 2）：由 M150 批次授权执行（Alex 对整体 review 的裁决「好，采纳。你动手吧」），本 change 随该批次归档
