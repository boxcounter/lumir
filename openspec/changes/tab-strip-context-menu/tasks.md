# Tasks: tab-strip-context-menu

## 1. 菜单浮层（src/tabs.ts）

- [x] 1.1 项集与文案常量（`TAB_MENU_LABEL` / `TAB_MENU_CLOSE` / `TAB_MENU_CLOSE_OTHERS` / `TAB_MENU_CLOSE_RIGHT`、`tabMenuItems()`）——渲染、单测、验收断言同源
- [x] 1.2 `TabContextMenu` 类：`role=menu` 容器 + 项级 `role=menuitem`、指针定位与挂点夹取、↑↓ 与 ⌃N⌃P 导航（同一 `move`）、Enter 触发、Esc / 外部点击关闭、打开即持焦点（游标落首项）、关闭归还焦点
- [x] 1.3 `renderTabs` 里给每个标签绑 `contextmenu`（`preventDefault` + 打开菜单）；**不改上下文**（不调 `activateTab`）
- [x] 1.4 焦点归还原语：按路径**现查**标签元素（`renderTabs` 是全量重建，存元素引用会在关闭后失效），标签已不在时落到当前激活标签

## 2. 三条关闭路径

- [x] 2.1 目标选择做成纯函数（`closeOtherTargets` / `closeRightTargets`，按「有路径的会话 + 打开顺序」），可单测
- [x] 2.2 `resolveClose`：干净标签立即关；脏标签弹 M149 既有确认并等用户选定；已不在会话列表里视为已处理
- [x] 2.3 `closeEach`：顺序等待，`false` 即停手（批量 MUST NOT 在用户答复之前关下一个）
- [x] 2.4 `src/main.ts` 的 `toast` 增 `onDismiss`（sticky 被点掉时通知）+ 动作钮 click 的 `stopPropagation`（防「保存并关闭」被 `onDismiss` 抢先作废）
- [x] 2.5 `closeTab`（⌘W / × 的既有路径）改为经 `resolveClose`，用户可见行为不变

## 3. 样式与文案

- [x] 3.1 `src/style.css`：`.tab-menu` / `.tab-menu-item` 与 `.ft-menu` / `.ft-menu-item` 写进同一批选择器（一套皮肤两个类名，零复制）；eink 反白与描边两条同样成对
- [x] 3.1b 标签菜单的容器**只带** `.tab-menu`（不带 `ft-menu`）——实测教训：先写成 `class="ft-menu tab-menu"` 时，树菜单按 `.ft-menu` 找菜单的 12 条用例全变成 locator strict violation（两份菜单同时命中）。皮肤是靠 CSS 的选择器对共用的，不需要两个类名都写在 DOM 上
- [x] 3.2 `文案-Copy.md`：D148–D151（菜单读屏名 + 三个项；英文列是 Alex 原文）+ 「文案实现备注」里补位置段

## 4. 测试

- [x] 4.1 `tests/unit/tab-menu.test.ts`：四条文案逐字断言、菜单 DOM 行为（打开 / 键盘 / Esc / 外点 / 焦点归还）、目标选择纯函数、`closeEach` 的顺序与停手
- [x] 4.2 `tests/visual/scenes/tab-menu.spec.ts`：三条路径的端到端落点、脏标签拦截（含「取消即停手」「点掉浮条即停手」「保存并关闭不被 onDismiss 作废」）、右键不改上下文、键盘与 Esc 关闭、eink 共用皮肤（判 CSSOM 原文而非计算值——亚像素 border-width 在 deviceScaleFactor=1 下不可区分）、两张元素级基线
- [x] 4.2b 焦点归还在动作**之后**（与树菜单相反）：标签的关闭会重绘整条标签栏，动作前归还的焦点会跟着被替换的元素一起消失（实测「关闭一个标签后焦点落在 body 上」）
- [x] 4.3 `scripts/acceptance/scenarios/50-tab-context-menu.md`：真机右键三条路径 + 脏拦截（真实 WKWebView 层）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（**21 passed / 0 failed**；含同批的 preview-tab-removal 与它的 vault-workspace delta）
- [x] 5.2 `node tests/unit/run.mjs` 全绿（**386 passed / 0 failed**，含 `tests/unit/tab-menu.test.ts` 的 9 条）
- [x] 5.3 `scripts/gate.sh quick` 全绿（**10/10 PASS，SKIP 0**，`test-results/m254/gate-quick2.log`）
- [x] 5.4 `scripts/gate.sh visual` 全绿（读数见 `test-results/m254/gate-visual.log`；全量另跑两轮：末轮 **478 passed / 1 skipped / 0 failed**，`visual-full-run2.log`）；菜单两张元素基线归 M254 的过目包（**新增**基线，不是更新既有基线）
- [x] 5.5 `node scripts/acceptance/run.mjs --check` 通过（57 个场景，含新增的 50）；真机跑 50 **撞上套件 `button: right` 的取图通道边界**（两轮复现「取不到窗口截图」，已按 mission 口径如实登记在场景文件的「已知边界」+ finding `20260927-worker-tab-strip-bug-button-right-kimicu.md`，**不判产品缺陷**）；同一实例用 KimiCU MCP 直接注入的补充探针**在真机验过**「关闭其他标签（含脏拦截与批量继续）」「关闭右侧标签」「右键不改上下文」「Esc 收起 + 焦点归还」四条，读数与 AX 原文见 `test-results/m254/real-machine-probe.md`
- [x] 5.6 同批把 `scripts/acceptance/scenarios/14-tabs.md` 的预览断言改齐并真机复跑：**PASS 51 断言 / 0 失败 / 49.8s**（`test-results/acceptance/2026-09-27/14-tabs/`）

## 6. 收口

- [x] 6.1 `docs/backlog.md` 登记同批落地与核销（第 39 条待归档跟踪 + 「待修 findings」的遗留项）
- [x] 6.2 review-request 逐任务对账
