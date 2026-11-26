# Design: 退出前的保存全部确认弹框

## 1. 现状与缺陷

- 后端三处拦截退出 / 关窗后 emit `app:quit_blocked`：⌘Q 菜单守卫（`lib.rs` 的
  `QUIT_MENU_ID`）、`RunEvent::ExitRequested`、`WindowEvent::CloseRequested`。
- 前端唯一消费点是 `src/main.ts` 的 `onQuitBlocked(() => save.showQuitBlocked())`；
  `save-controller.ts` 的 `showQuitBlocked` 只弹一条 sticky toast（D232）。
- 缺陷：toast 在右下角，用户注意力在左上角编辑器；提示不可操作，用户只能自己猜要先 ⌘S。

## 2. 决策

### 2.1 居中模态，不是 toast

拦截发生时用户刚按下 ⌘Q / 点了关闭，这是一次**明确的退出意图**；界面必须给出可执行的出口。
居中模态把「有未保存修改」与两条动作放在视线落点，并且截断后续编辑（背景 inert），
避免用户在弹框背后继续改文档把保存判据搅乱。

### 2.2 不用系统原生对话框

`window.alert/confirm`、Tauri message dialog、`NSAlert` 都不在三主题 token 体系内，无法满足
eink 的线宽 / 无阴影规则，也无法做读屏名与焦点还原的统一验证。弹框用产品 DOM（与设置面板、
键位面板同一套浮层壳与 Escape 层栈）。

### 2.3 只有两条动作，没有「丢弃修改」

退出是一个不可逆动作；`保存全部并退出` 覆盖「我要退出」的正常意图，`取消` 覆盖「我不是
现在要退出」。丢弃修改会引入第三条语义，并且与「保存失败保持现场」的安全默认冲突——
用户不该在一个看不全文档的弹框里决定丢弃哪些修改。

### 2.4 初始焦点在主按钮

用户按 ⌘Q 的意图是退出；主按钮的主路径是「先保存再退出」，不丢数据。Escape / 次按钮都在
一步之内。初始焦点因此落在「保存全部并退出」，Enter 走主路径。

## 3. 前端结构

```
src/quit-dialog.ts
  ├─ createQuitFlow(deps)    纯逻辑：保存 → 复查 → 退出；代次 / 单飞 / 失败原因
  └─ createQuitDialog(deps)  DOM：遮罩 + 卡片 + 两个按钮 + 状态行；焦点 / Escape / inert
```

分层理由与 `save-all.ts` 相同：退出竞态必须能在无 DOM、无 Tauri 的单测里覆盖，装配层
（`main.ts`）只注入真实依赖（`saveAll.run`、`editor.sessions()`、`appQuit`）。

### 3.1 状态机

```
closed ──open()──► idle
idle ──主按钮──► saving ──屏障 true 且本地无新 dirty──► quitting ──app_quit 受理──► 进程退出
                    │                                        └─拒绝 / IPC 失败──► failed
                    ├─屏障 false ───────────────────────────────────────────────► failed
                    └─屏障 true 但本地 anyDirty() ────────────────────────────────► failed
failed ──主按钮（用户手动重试）──► saving
idle / failed ──取消 / Escape / 点遮罩──► closed
saving / quitting ──取消 / Escape / 点遮罩──► 忽略（不关闭、不退出）
```

- `failed` 不自动重试：没有定时器、没有循环、没有「保存完成事件」再触发一次。
- `saving` / `quitting` 期间取消与 Escape 被消费但不关层：否则用户取消后保存完成仍会退出，
  与「取消只关闭弹框、不退出」的承诺矛盾。

### 3.2 代次与竞态矩阵

`createQuitFlow` 持有一个单调代次：

| 现场 | 处置 | 判据 |
|---|---|---|
| 保存期间用户继续编辑 | 屏障同步后复查 `anyDirty()` 为 true → 失败 | `save-all.ts` 的既有最后复查；flow 成功后**再查一次**本地 dirty |
| 保存完成、退出命令到达前出现新 dirty | flow 在调用 `app_quit` 前同步复查 `anyDirty()`；后端 `app_quit` 再复核 `DirtyState` | 双层：前端本地态 + 后端镜像 |
| 保存期间的第二次点击 / 重复触发 | `saving` 状态下主按钮禁用；flow 自身也拒绝非 idle/failed 的入口（单飞） | 单飞在 view 与 flow 两层各一次，不靠 UI 单独承担 |
| 弹框已关闭，保存才完成 | `close()` 推进代次；flow 发现代次失效 → 不发退出 | 代次失效即放弃，绝不「补一次退出」 |
| 连续 `app:quit_blocked` | `open()` 幂等：已打开直接返回，不新建卡片、不重置状态 | 弹框单例 + 状态机 |
| 退出命令被后端拒绝 | `failed`，错误可见，不自动重试 | 后端返回 `quit_blocked_dirty` |
| 退出在途时后端又拦下一次（如 `ExitRequested` 再次看到 dirty） | 回到 `failed(quit)`，两条动作重新可用；在途退出请求的代次作废 | `noteQuitBlocked()`：只对 `quitting` 生效，不叠弹、不自动重试 |

### 3.3 受控退出

- 前端新增 `src/ipc.ts` 的 `appQuit()` → `invoke("app_quit")`。
- Rust `commands::app_quit`：先走 `quit_allowed(&DirtyState)`（纯函数，单测直接驱动）——
  `is_dirty()` 为 true 时返回 `CommandError { code: "quit_blocked_dirty" }`；为 false 才
  `app.exit(0)`。
- `app.exit(0)` 会再经 `RunEvent::ExitRequested`，此时镜像为 false，既有守卫放行；退出流程
  与用户 ⌘Q 的干净路径是同一条，不新增第二套退出语义。
- MUST NOT 合成 ⌘Q / Apple Event / SIGTERM；MUST NOT 让前端传任意「命令字符串」给后端执行。

### 3.4 可访问性

- 卡片：`role="dialog"`、`aria-modal="true"`、`aria-labelledby`（标题）、`aria-describedby`
  （说明段）、`tabindex="-1"`。
- 背景：打开时 `#app.inert = true`（记录打开前的值，关闭时还原——设置面板可能已经把它置为
  inert，不能无条件写 false）；关闭时恢复。
- 焦点：打开前记录 `document.activeElement`；打开后焦点落主按钮；`Tab` / `Shift+Tab` 在
  卡片内的可聚焦元素间循环；Escape 走 `escapeDisposition`（组合期 / 带修饰键不关层）；
  关闭后焦点还原到打开前元素（仍连接时），否则调用既有 `editor.focusPreservingReadingPosition`。
- 状态行：`role="status"`（polite），保存中 / 失败 / 退出被拒的文本变化可被读屏读到；
  `aria-busy` 在 `saving` / `quitting` 时为 true。

### 3.5 与既有层栈的关系

- `registerEscapeLayer("quit-save-all-dialog", cancel)`：后打开者在栈顶；一次 Escape 只关
  最上层。弹框内的就地 keydown 与全局兜底共用 `escapeDisposition` / `escapeRouter.handle`，
  不另写第二份准入。
- 若弹框打开时其它浮层（设置 / 键位 / 大纲等）仍在，弹框的遮罩覆盖它们、Tab 圈定阻止焦点
  进入；关闭弹框后原有层栈与 `#app` 的 inert 状态按打开前的值还原。

## 4. 视觉合同（视觉保真）

本 change 无独立 HTML 原型，视觉真源是本节的 token 口径 + 三主题候选截图。实现 MUST 只取
现有 token，不新增字面色值 / 字号 / 圆角；eink 走既有降级规则。

### 4.1 遮罩

| 项 | 口径 |
|---|---|
| 定位 | `position: fixed; inset: 0` |
| 层级 | `z-index: 40`（高于设置面板 30 / 其它浮层 20 / toast 10） |
| 布局 | `display: flex; align-items: center; justify-content: center` |
| 内边距 | `padding: var(--sp-12)`（40px，窄窗时卡片不贴边） |
| 底色 | `background: var(--scrim)`（三主题各自取 token 值，不写 rgba 字面量） |
| 显隐 | `[hidden] { display: none }`（author 的 flex 会盖掉 UA 的 hidden 规则，显式补回） |

### 4.2 卡片（居中）

| 项 | 口径 |
|---|---|
| 宽度 | `width: 100%; max-width: 440px` |
| 底色 | `background: var(--preview-bg)` |
| 文字 | `color: var(--text)` |
| 边框 | `1px solid var(--border)`；eink：`1.4px` 实心黑框 |
| 圆角 | `border-radius: var(--r10)` |
| 阴影 | `box-shadow: var(--shadow-raise)`；eink：`none` |
| 内边距 | `padding: var(--sp-9) var(--sp-10) var(--sp-8)`（与键位面板同一节奏） |
| 布局 | `display: flex; flex-direction: column; gap: var(--sp-6)` |
| 动效 | 无（不新增 transition；`prefers-reduced-motion` 无额外分支） |

### 4.3 字层级

| 元素 | 口径 |
|---|---|
| 标题 | `font-size: var(--fs-body)`；`font-weight: var(--fw-bold)`；`margin: 0` |
| 说明 | `font-size: var(--fs-ui-s)`；`color: var(--text-2)`；`line-height: var(--lh-ui)`；`margin: 0` |
| 状态行 | `font-size: var(--fs-ui-s)`；`min-height: 1.2em`（无文案时占位，避免弹框高度跳动）；默认 `color: var(--text-2)`；失败态 `color: var(--danger)` |

### 4.4 按钮层级与状态

| 项 | 主按钮「保存全部并退出」 | 次按钮「取消」 |
|---|---|---|
| 高度 | `30px` | `30px` |
| 内边距 | `0 14px` | `0 14px` |
| 字号 | `12px` | `12px` |
| 底色 | `var(--accent-fill)` | `transparent` |
| 文字 | `var(--accent-fill-text)` | `var(--text-2)` |
| 边框 | `1px solid var(--accent-fill)` | `1px solid var(--border)` |
| 圆角 | `var(--r5)` | `var(--r5)` |
| hover | `filter: brightness(1.05)` | `background: var(--hover)` |
| focus-visible | `outline: 2px solid var(--accent); outline-offset: 2px` | 同左 |
| eink focus | `outline-color: #000` | `outline-color: #000` |
| disabled | `opacity: 0.45; cursor: default` | 同左 |

按钮行：`display: flex; justify-content: flex-end; gap: var(--sp-3)`；主按钮在右、次按钮在左
（macOS 的确认动作在右）。

### 4.5 三主题与 eink 降级

- light / dark：全部取上表 token；`--scrim` 各自取值（light 0.22 / dark 0.5），不覆盖。
- eink：卡片 `border-width: 1.4px`、`box-shadow: none`；主按钮底色 `--accent-fill`（eink 为
  纯黑）+ `--accent-fill-text`（白）；次按钮透明底 + 实心黑边；焦点 outline 改黑。与设置面板 /
  键位面板的 eink 规则逐条一致。

## 5. 测试与验收策略

| 层 | 判据 | 位置 |
|---|---|---|
| 纯逻辑 | 保存成功才退出；失败 / 新 dirty / 代次失效不退出；重复触发单飞；退出被拒不重试 | `tests/unit/quit-flow.test.ts` |
| Rust | `quit_allowed`：dirty=true 拒绝（稳定 code），dirty=false 放行 | `src-tauri/src/commands.rs` 单测 |
| 视觉 / 结构（chromium + IPC stub） | 居中遮罩、卡片 / 按钮层级、三主题 token、焦点初始 / Tab 圈定 / Escape / inert / 焦点还原 / 重复事件单弹框 / 保存中禁用 / 失败留场 | `tests/visual/scenes/quit-save-all-dialog-nov27.spec.ts` |
| 真机（本轮不执行） | 真实 ⌘Q / 关窗 → 弹框；保存全部并退出 → 原 pid 消失；保存失败 → 仍在；取消 → 仍在且内容不变；干净 ⌘Q 无弹框 | `scripts/acceptance/scenarios/884-quit-save-all-dialog.md` + 更新 239 |
| 视觉基线 | 三主题整页截图（`expectScreenshot`，已批准） | `tests/visual/baselines/quit-save-all-dialog-nov27.spec.ts-snapshots/` |

## 6. 边界与已知限制

- Dock 右键退出 / 系统关机走 `applicationWillTerminate`，不产生 `ExitRequested`，弹框在这两条
  OS 级路径上不可达（既有已接受限制，本 change 不改）。
- 后端 `DirtyState` 是前端上报的镜像；`app_quit` 的复核能挡住「镜像仍 dirty」的竞态，但挡不住
  「镜像已被前端写成 false、用户在同一拍又输入」的极端窗口——前端在调用前同步复查本地
  `anyDirty()` 是第一道，后端复核是第二道；两处都不通过就留在弹框内。
- 弹框打开期间文档被外部修改（watch）：不属于退出竞态，仍走既有外部变更处置；弹框不关闭。
