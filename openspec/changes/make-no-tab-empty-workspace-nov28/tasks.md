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
      `keymap-commands`（MODIFIED 行号条款表述 + 右键复制的不可达表述）、
      `quick-open`（ADDED 空工作区入口与焦点归还）、`file-tree`（MODIFIED 默认名条款的不可达表述）。
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

## 7. 独立评审返修（K3 needs-changes @ `aa4634a4`）

- [x] 7.1 P2-1：vault 切换器的 `focusEditor` 接 `focusActiveDocPaneEntry()`；补「空工作区 → ⌘O → Esc → 主操作持焦」回归并做旧红新绿。
- [x] 7.2 P2-2：tips 覆盖判据收窄到实际宿主 pane（`firstRunTipsEl.parentElement`），结构只读同步收窄；补「首启 → 收起 harness → 分栏 → 右 pane 空工作区主操作持焦」回归并做旧红新绿。
- [x] 7.3 P2-3：同步 native 场景 50（Close All 焦点 / 旧未命名守卫叙述）与 79（D369 → 空工作区）；native 复跑清单加入 50 + 79（不自行 native）。
- [x] 7.4 P3-1：`ax.focused` 支持 `{ role, name }`，885 三条主操作焦点断言改用它；补读数与静态校验自测。
- [x] 7.5 P3-2：修 Quick Open 双 pane scenario 的「成功打开后又要求回主操作」矛盾。
- [x] 7.6 P3-3：清扫文案末位、m320 注释、`src/tabs.ts` Close All 注释、验收 29 的空态表述。
- [x] 7.7 P3-4：清三个 delta 的 EOF blank line，`git diff --check` 通过。
- [x] 7.8 清理 keymap「行号 gutter 右键复制」与 file-tree「默认名其他创建链路」两处不可达旧表述（新增 MODIFIED 增量）。
- [x] 7.9 候选补「首启收起 harness 再分栏」一张，五张全量重生成。

## 8. 真机首轮返修（885 / 50）

- [x] 8.1 根因：空工作区的占位会话仍被 `editor.goto-line` 当成编辑器目标（真机 885 的 AXTextField「1」）。`editor.goto-line` 在 `active.path === undefined` 时直接返回；有路径文档（含只读 / 未装载异常会话）行为不变。
- [x] 8.2 885 oracle：`ax.not "跳转到行"` 在预填非空时不可观察（输入框只暴露值）；改用输入条必显的「共 N 行」，并补「主操作持焦」与「正文持焦」两档真实 ⌥G 断言。
- [x] 8.3 50 oracle：Close Other 后「单击开新标签」与 `treeOpenIntent`（单击 = current、⌘-单击 = new，change improve-file-open-harness-affordance-nov26）冲突；三处开新标签改 ⌘-单击并改准 label。
- [x] 8.4 结构回归：正文持焦 + ⌥G 不打开输入条、焦点不被夺；旧红（去掉 goto 门）实测。
- [x] 8.5 native 串行复跑 885 + 50（不并行）→ 2/2 PASS；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-28-no-tab-empty-workspace-r2/evidence/`（885 36 断言 / 50 79 断言，含 263/79 上一轮 PASS 的索引）。
- [x] 8.6 885 的 Esc 步：KimiCU `press_key("escape")` 连续两轮零事件（同状态 CGEvent keycode 53 一次即关闭）⇒ `channel: cgevent` 在 `do: key` 单数形态放行命名键（escape / tab / return …），885 改走该通道；`do: keys` 列表里的命名键与普通字符仍走 KimiCU（100 的逐键分工不变），判据自测同步。
