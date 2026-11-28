# Tasks: make-no-tab-empty-workspace-nov28

> 开工前先过 `REVIEW.md`，重点核对自己的改动面：『同一语义两处真源』（「有没有标签」只留一处读数）、
> 『断言等价于子串』（空态用例要有「有文档」的对照面）、『读不到当成空』（焦点 / 可编辑性读数缺失
> 一律 FAIL）、『标题栏 mousedown preventDefault』（本 change 不碰标题栏监听）。

## 1. 无路径会话是结构性只读空工作区

- [x] 1.1 `src/editor.ts` 的 `makeSession`：无路径会话 `editable=false`、`structuralReadOnly=true`；
      `reloadSession` 装载有路径文档时按既有表达式恢复并清结构只读。
- [x] 1.2 `src/main.ts` 的 `renderAllTabStrips`：`structuralReadOnly = foreground.path === undefined ||
      firstRunTipsVisible`；`editable = !structuralReadOnly && isEditablePath(path)`。
- [x] 1.3 删除 `src/pane-layout.ts` 的 `paneBlocksInput` / `emptyPaneGuideVisible` 及其过时注释；
      「有没有标签」统一取 `visibleTabsOf`（从 `src/tabs.ts` 导出）。

## 2. 空工作区表面与动作

- [x] 2.1 `createPaneHandle` 为每个 doc pane 建 `.pane-empty-workspace`（标题 +「打开笔记…」+
      「新建笔记」）；去掉旧的「点击水印 = 聚焦正文」行为。
- [x] 2.2 在场判据：该 pane 无带路径标签；tips 在场 / notice 覆盖宿主 pane 时让位。写入点与
      `renderAllTabStrips` 同一个 `hasTabs` 读数；notice / showEditor 变更经同一同步函数。
- [x] 2.3 两个动作先 `activatePane(paneId)` 再分别进入 Quick Open / `tree.beginCreate("", "file")`；
      未装载 vault 时「新建笔记」禁用。
- [x] 2.4 删除 `showEmptyVaultState` / D107 分支：空 vault 与普通无 Tab 同一表面；
      `syncWidthHandleVisibility` 在空工作区不显示栏宽手柄。

## 3. 焦点落点

- [x] 3.1 新增 `focusDocPaneEntry(paneId)`：空工作区 → 主操作，有文档 → 正文（M280 口径）。
      复合句柄 `focusPreservingReadingPosition`、标签条 `focusEditor`、分栏 / 切 pane / 收起 pane、
      Close All 收尾、各浮层 `restoreFocus` 全部改走它。
- [x] 3.2 `tabs.closeTabNow` 关闭最后一个可见标签后交还一次焦点（落主操作，不落正文 / body）。
- [x] 3.3 Quick Open 的取消 / 关闭经同一入口把焦点还给空工作区主操作；成功打开后仍聚正文。

## 4. 删除不可达的旧分支

- [x] 4.1 `src/save-controller.ts`：`guard()` 的无路径分支改为直接放行；`save()` 的无路径 dirty
      反馈删除；`reportUnsaveable` 只服务有路径未登记 revision（D234）。
- [x] 4.2 `src/tabs.ts`：`targetSessionFor` 的「dirty 草稿不复用」条件删除（无路径恒 clean）；
      相关注释按新身份改准。
- [x] 4.3 文案：新增「没有打开的文档」「打开笔记…」；删除 D107 / D233 / D369（D882 保留）。

## 5. 规格与验收制品

- [x] 5.1 `specs/` 增量：`pane-layout`（REMOVED 旧两条 + ADDED 空工作区）、`multi-tabs`
      （REMOVED 未命名 dirty 守卫 + ADDED 空工作区与 dirty 判定 + MODIFIED Close All 焦点）、
      `fs-io`（MODIFIED 不可保存反馈）、`first-run-onboarding`（MODIFIED 首启构成 + Purpose）、
      `keymap-commands`（MODIFIED 行号条款表述）、`quick-open`（ADDED 空工作区入口与焦点归还）。
- [x] 5.2 更新 `scripts/acceptance/scenarios/885-no-tab-empty-state.md`：改为空工作区的
      「不可输入 / 无 dirty / 无保存目标 / 两个动作 / 焦点落主操作」；`--check` 通过。
- [x] 5.3 `docs/backlog.md`：删除已裁的 M416「未保存新文档」条目；补本 change 的归档跟踪条目。

## 6. 验证

- [x] 6.1 目标单测：`node --test tests/unit/pane-layout.test.ts tests/unit/save-controller.test.ts
      tests/unit/tabs.test.ts tests/unit/tab-menu.test.ts tests/unit/line-numbers.test.ts` 通过。
- [x] 6.2 根 `pnpm exec tsc --noEmit` 与 visual `tsc -p tests/visual/tsconfig.json --noEmit` 通过。
- [x] 6.3 前端全量 `pnpm test` 通过。
- [x] 6.4 结构层视觉（目标场景，`LUMIR_VISUAL_STRUCTURAL=1`）：`no-tab-empty-workspace-nov28`、
      `m320-pane-split`、`m281-goto-line`、`first-run-empty-state`、`gutter-copy-path-line`。
- [x] 6.5 `bash scripts/docs-check.sh` 与 `npx --yes @fission-ai/openspec@1.12.0 validate --all
      --strict` 通过。
- [x] 6.6 门禁 `bash scripts/gate.sh quick`（不跑完整 visual / 真机）。
- [x] 6.7 新增 / 修改的断言逐条做**反向必红**实测：把无路径 `editable` 改回 true、把焦点落点
      改回正文、把空态动作去掉，各实测一次判红；恢复后判绿。读数记进完工报告。
- [x] 6.8 普通 / 双 pane / 首启候选截图落 `.local/reviews/no-tab-empty-workspace-nov28/`；
      MUST NOT 更新视觉基线。
