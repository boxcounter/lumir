# Proposal: 退出前的保存全部确认弹框

- Change ID: add-quit-save-all-dialog-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（需求 / 批准 / 代裁授权），AI agent（起草与实现）

## Why

有未保存修改时，⌘Q / 关窗会被后端 dirty 守卫拦下；当前前端只把拦截提示渲染成**右下角的
sticky toast**（`save.showQuitBlocked` → 文案 D232）。用户的注意力与视觉焦点在左上角的编辑器，
右下角的提示看不到，于是「按了 ⌘Q 没反应」成为最常见的现场感受。提示既不可操作、也不处在
视线落点，等于退出守卫没有可理解的出口。

Alex 2026-11-27 的需求：**退出前提醒改用弹框**。因为未保存时点击关闭，视觉焦点在左上角，
右下提示看不到。

## 节点 1：批准与代裁授权

- **Alex 2026-11-27 原话要点**（本次 mission instructions）：「退出前提醒改用弹框，因为未保存时
  点击关闭，视觉焦点在左上角，右下提示看不到」；「Alex已授权夜间常规交互决策由agent代裁」。
- **批准的安全默认**（Alex 指定，agent 不再另设分支）：
  - 收到 `app:quit_blocked` 时显示**居中模态弹框**，不是 toast；弹框说明有未保存修改。
  - 主按钮「保存全部并退出」，次按钮「取消」；**不提供「丢弃修改」按钮**。
  - 保存复用 `src/save-all.ts` 的 Save All 屏障；成功后经真实、受控的退出路径退出，
    不伪造键盘事件。
  - 保存失败 / 冲突：弹框与现场保持，错误可见，不自动重试。
  - 取消只关闭弹框，不退出；正常干净退出不出现弹框。
- **交互细节代裁**（夜间常规交互决策，agent 裁决并记录在 design.md）：
  初始焦点、Tab 圈定、Escape 同取消、背景 inert、关闭后焦点还原、重复事件不叠弹；
  保存中的取消按钮禁用；后端退出命令必须复核 dirty=false。

## What Changes

- **产品侧：退出拦截改为居中模态弹框**（新模块 `src/quit-dialog.ts`）。`app:quit_blocked`
  不再调用 `save.showQuitBlocked()` 的 toast，而是打开弹框；弹框单例，重复事件不叠弹。
- **产品侧：「保存全部并退出」**：主按钮调用既有 `Save All` 屏障（`src/save-all.ts`）——
  保存全部脏标签 → 标签会话 flush → 阅读位置 flush → 后端 dirty 镜像同步 → 同步后复查
  dirty。屏障成功且本地复查无新 dirty 后，才调用新的后端命令 `app_quit`；失败 / 冲突 / 新
  dirty 一律留在弹框内，错误可见，不自动重试。
- **产品侧：受控退出命令 `app_quit`（Rust）**：命令内**复核 `DirtyState` 为 false** 才
  `app.exit(0)`；仍 dirty 时返回稳定错误码并拒绝退出。前端拿不到「任意字符串命令绕过守卫」
  的通道；退出仍会经过既有 `ExitRequested` 守卫。
- **产品侧：可访问性**：`role="dialog"` + `aria-modal="true"` + `aria-labelledby` /
  `aria-describedby`；打开时背景 `#app` 置 `inert`；初始焦点落在主按钮；Tab / Shift+Tab 在
  弹框内循环；Escape 等同「取消」；关闭后焦点还原到打开前的元素；状态行 `role="status"`
  读屏可达。
- **产品侧：旧 toast 路径切断**：`save-controller.ts` 的 `showQuitBlocked()` 与 D232 的
  toast 消费点删除（零消费者，不保留双写 / 过渡）。文案表新增弹框标题、说明、主按钮、
  保存中 / 失败 / 退出被拒状态行（D1068–D1072），「取消」复用 D136。
- **测试**：
  - 单测：`tests/unit/quit-flow.test.ts`（保存成功才退出、失败不退出、保存期间新 dirty 不退出、
    代次失效后不退出、重复触发单飞、退出被拒不自动重试）。
  - Rust 单测：`app_quit` 的守卫判据（dirty=true 拒绝、dirty=false 放行）。
  - 视觉结构：新场景 `tests/visual/scenes/quit-save-all-dialog-nov27.spec.ts`——居中遮罩、
    卡片 / 按钮层级、三主题 token、焦点圈定 / Escape / 背景 inert / 重复事件不叠弹。
  - 真机场景：`scripts/acceptance/scenarios/884-quit-save-all-dialog.md`（本轮只写场景，
    **不执行真机**）。
- **视觉候选**：新增三主题截图候选放主仓 `.local/missions/add-quit-save-all-dialog-nov27/`，
  **不自行更新像素基线**（基线更新是人肉裁决点）。

## Non-goals

- **不提供「丢弃修改」**：退出路径只有「保存全部并退出」与「取消」两条；丢弃修改不是退出弹框
  的出口。
- **不伪造键盘事件**：退出不靠合成 ⌘Q / Apple Event / SIGTERM；只经受控命令。
- **不做系统原生对话框**：不使用 `window.alert/confirm`、Tauri 原生 message dialog 或
  `NSAlert`；弹框是产品 DOM 模态。
- **不改保存屏障的成功判据**：Save All 的代次日志、单飞、同步后复查原样复用；本 change 不在
  屏障内部另写第二条成功判据。
- **不自动重试**：保存失败 / 冲突 / 退出被拒后，必须由用户再次点击主按钮。
- **不做真机执行、不打包、不归档**：本轮真机整链路（WKWebView 下的真实 ⌘Q / 关窗与进程退出）
  登记为待真机项。

## Impact

- 影响的 specs：`multi-tabs`（新增「退出前的保存全部确认」requirement）。
- 影响的代码：
  - 前端：`src/quit-dialog.ts`（新增）、`src/main.ts`（装配与 `app:quit_blocked` 接线）、
    `src/save-controller.ts`（删除 toast 出口）、`src/ipc.ts`（`appQuit`）、
    `src/copy-data.ts` / `文案-Copy.md`（D1068–D1072）、`src/style.css`（弹框样式）。
  - 后端：`src-tauri/src/commands.rs`（`app_quit` + 守卫判据 + 单测）、`src-tauri/src/lib.rs`
    （注册命令）。
  - 测试：`tests/unit/quit-flow.test.ts`、`tests/visual/scenes/quit-save-all-dialog-nov27.spec.ts`、
    `scripts/acceptance/scenarios/884-quit-save-all-dialog.md`、
    `scripts/acceptance/scenarios/239-escape-quit-guard.md`（旧 toast 判据改弹框）、
    `scripts/acceptance/COVERAGE.md`、`scripts/acceptance/README.md`。
- 关联约束：不改写源文件（本 change 只读展示用户文档）；仓库信息卫生（截图与 fixture 一律
  合成内容）；「变更默认直接切断」（旧 toast 路径删除、D232 随零消费者退场，编号不复用）。
