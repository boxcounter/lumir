# Tasks: add-quit-save-all-dialog-nov27

## 1. 产品侧：弹框与受控退出

- [x] 1.1 新增 `src/quit-dialog.ts`：`createQuitFlow`（纯逻辑：保存 → 本地 dirty 复查 → 受控退出；代次 / 单飞 / 失败原因）与 `createQuitDialog`（DOM：居中遮罩 + 卡片 + 主次按钮 + `role="status"` 状态行）。
- [x] 1.2 可访问性：`role="dialog"` + `aria-modal` + `aria-labelledby` / `aria-describedby`；背景 `#app` 置 `inert` 并记录打开前的值；初始焦点主按钮；Tab / Shift+Tab 圈定；Escape 等同取消；关闭后焦点还原；保存中 / 退出中禁用两条按钮与取消路径。
- [x] 1.3 `src/main.ts`：`onQuitBlocked` 改为打开弹框（不再调 `save.showQuitBlocked()`）；`createQuitDialog` 注入 `saveAll.run`、`editor.sessions()` 的 dirty 并集、`appQuit`、焦点还原。
- [x] 1.4 `src/ipc.ts`：新增 `appQuit()` → `invoke("app_quit")`。
- [x] 1.5 Rust：`src-tauri/src/commands.rs` 新增 `quit_allowed(&DirtyState)`（dirty=true → `quit_blocked_dirty`）与 `app_quit` 命令（复核后 `app.exit(0)`）；`src-tauri/src/lib.rs` 注册 `commands::app_quit`。
- [x] 1.6 切断旧路径：删除 `save-controller.ts` 的 `showQuitBlocked()` 与 `SAVE_GUARD_TOAST_CLASS` 在该出口的使用；D232 的文案条目与 deck 行一并删除并移入 deck「不复用编号」清单（零消费者退场，编号不复用）。

## 2. 文案与样式

- [x] 2.1 `文案-Copy.md` / `src/copy-data.ts`：新增 D1068 标题、D1069 说明、D1070 主按钮、D1071 保存中、D1072 保存失败、D1073 保存后新 dirty、D1074 退出被拒、D1075 正在退出（中英两列）；「取消」复用 D136；更新 deck 末位与分配记录。
- [x] 2.2 `src/style.css`：新增 `.lumir-quit-overlay` / `.lumir-quit-card` / 标题 / 说明 / 状态行 / 按钮行样式；全部取既有 token；eink 1.4px 边框 / 无阴影 / 黑色焦点轮廓；`[hidden]` 显式补回。

## 3. 测试

- [x] 3.1 `tests/unit/quit-flow.test.ts`：保存成功 → 退出；保存失败 → 不退出且状态 failed；保存成功但本地新 dirty → 不退出；保存期间关闭（代次失效）→ 完成时不退出；并发触发单飞；`app_quit` 拒绝 → failed 且不自动重试；`app_quit` 网络错误 → failed；退出在途再次被拦 → failed(quit) 且旧代次结果不覆盖。
- [x] 3.2 Rust 单测：`quit_allowed` 的 dirty=true / false 两档与稳定 code。
- [x] 3.3 `tests/visual/scenes/quit-save-all-dialog-nov27.spec.ts`：结构 / 计算属性断言（遮罩居中、卡片 token、按钮层级与主次色、三主题 eink 规则、焦点初始 / Tab 圈定 / Escape / 背景 inert / 关闭后焦点还原 / 连续 `quit_blocked` 单弹框 / 保存中禁用 / 失败留场）；三主题整页像素断言见 6.3（已批准并由 `expectScreenshot` 验证）。

## 4. 真机场景与文档

- [x] 4.1 新增 `scripts/acceptance/scenarios/884-quit-save-all-dialog.md`：dirty → ⌘Q 弹框；保存全部并退出 → 落盘 + 进程退出；保存失败留场；取消 / Escape 留场且内容不变；干净 ⌘Q 无弹框。本轮只写场景，**不执行真机**。
- [x] 4.2 更新 `scripts/acceptance/scenarios/239-escape-quit-guard.md`：退出拦截判据由 D232 toast 改为弹框（标题 / 主按钮）；「Esc 不出现提示」的负向判据同步改弹框在场性。
- [x] 4.3 更新 `scripts/acceptance/COVERAGE.md` 与 `scripts/acceptance/README.md`（884 条目、退出拦截提示口径）。

## 5. 验证

- [x] 5.1 `pnpm exec tsc --noEmit`（根）与 `tests/visual` 的 tsc 通过。
- [x] 5.2 `node tests/unit/run.mjs` 通过。
- [x] 5.3 `cargo test --manifest-path src-tauri/Cargo.toml`（目标测试）通过。
- [x] 5.4 `LUMIR_VISUAL_STRUCTURAL=1` 跑视觉结构（新场景 + 受影响场景）通过；`tests/visual` 的 tsc 通过。
- [x] 5.5 `bash scripts/docs-check.sh` 通过。
- [x] 5.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.7 `node scripts/acceptance/run.mjs --check` 通过。
- [x] 5.8 视觉候选截图（三主题）落 `.local/missions/add-quit-save-all-dialog-nov27/visual-candidates/`；候选经批准后已转正为三张正式基线（见 6.3），其余基线不动。

## 6. 待真机 / 待终审（本轮不执行，未勾即未完）

- [ ] 6.1 真实 WKWebView 下的整链路真机验收：dirty → ⌘Q / 关窗 → 居中弹框；保存全部并退出 → 原 pid 消失；保存失败 / 冲突 → 弹框留场且错误可见；取消 / Escape → 留场且内容逐字节不变；干净 ⌘Q → 无弹框。理由：本轮 mission 明确不执行真机，归下批真机窗口。
- [ ] 6.2 场景 884 与 239 的真机 PASS（2026-11-27 r1/r4 失败已定位为判据与时序：`/^取消$/` 行锚、模态期间背景 AX 不可读、保存日志标记在模态期间不可读、编辑器 raw 文本受 markdown 标记显隐影响、239 第一下 Escape 可能被原生焦点交接吃掉；场景已修，待复跑）。
- [x] 6.3 视觉基线：三主题候选经主会话代 Alex 自审批准（2026-11-27）；已用 `scripts/visual/run.sh --update scenes/quit-save-all-dialog-nov27.spec.ts` 生成三张正式基线，其余基线不动。
- [ ] 6.4 独立终审（非作者 reviewer clean / merge）与归档放行；归档时在 `docs/backlog.md` 归档跟踪队列落条目。理由：本 mission 明确「不要归档」。
