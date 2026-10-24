# Tasks: app-splash-screen

> 阶段门：节点 1（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现 proposal
> 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> 若 D2 裁「只到壳挂载」：删除 3.2（`vault-workspace` 的 MODIFIED 整块撤回），其余不变；6.3（归档时为
> 新 capability 手写 Purpose）与 D2 无关，任何分支都要做。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/{app-startup,vault-workspace}/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，其中 D1 决定形态、D2 决定是否要改 `vault-workspace`）
      —— 2026-10-23「按倾向」：D1 感知性能 / D2 到树装载 / D3 前端两段式 / D4 骨架 + 标记 + 阶段行 / D5
      首帧前施主题；提案合并 a779eed。

## 1. 启动层与首帧

- [x] 1.1 新增 `src/boot.ts`：`index.html` 的模块脚本改指向它；用 **async IIFE**（不用 top-level await——最低系统
      10.15 的 WKWebView 不支持，实现期在真机确认一次，结论写进文件头）
      —— 本机（macOS 26.6.2 / WebKit 21624）支持 TLA，但最低支持系统的 Safari 13 级不支持 ⇒ 仍用 async IIFE，
      结论与依据在 `src/boot.ts` 文件头与 design §11.3
- [x] 1.2 首帧前读配置与应用元信息（`Promise.all([configGet(), getName()])`，两端都 `catch` 成 `null`）；只写
      `<html data-theme>`，不碰 modeline 与其余启动装配（那些归主模块）；把这份配置快照交给主模块复用，主模块
      原本那次 `configGet()` 改为接快照（同一份配置不许两处各读一次）
      —— `src/config-handoff.ts`（一次性交接）；`src/main.ts` 的配置装配块改 `consumeConfigSnapshot()`
- [x] 1.3 启动层 import 启动面所需的样式（与主模块同一份 token 表，不另立第二份）；核对构建产物里该 CSS 在
      entry chunk 内、不随主模块的异步 chunk 迟到
      —— `dist/index.html` 只 link 入口 CSS（`index-*.css`），`.startup-*` 与 `.ft-open-btn` 都在其中；
      主模块的额外 CSS（`main-*.css`）才是唯一的异步 CSS
- [x] 1.4 `await import("./main")` 装载主模块；**装载失败必须撤下启动态**（`dismiss("degraded")`）并把错误交给
      既有 console 路径 —— 统一走 `boot()` 的 catch → `startupSurface()?.degrade()`
- [x] 1.5 双 rAF 等待首帧后再动态装载（`nextPaint`）；注释写明它只是尽力而为，正确性不依赖它
      —— 另加 200ms 上界（窗口不可见时 WebKit 可能不派发渲染帧，design §3.6 / §11.2）
- [x] 1.6 读数：记录「`show()` → 启动层首帧」的实测值（本机 ≥10 次），写进实现说明；作为「是否需要 show 闸门」
      的判据（design §9 已知边界 1）
      —— release 构建、隔离空配置、n=10：中位 ≈ 253ms（页面自身 ≈ 117ms），见 design §11.4

## 2. 启动态的呈现

- [x] 2.1 新增启动面模块（`src/startup-surface.ts`）：`mount({ productName })` / `dismiss(reason)` 两个出口；
      **承载点是 `document.body` 下的独立兄弟节点（如 `#startup`），不在 `#app` 里**——`createShell` 用
      `mount.replaceChildren(root)` 整体替换 `#app` 的子节点（`src/shell.ts:248`），挂在 `#app` 里的启动面会
      在壳建出的瞬间被抹掉（写一条「壳建出后启动面仍在」的单测挡住这个坑）；
      几何全部取 `--layout-titlebar-h` / `--layout-sidebar-w` / `--layout-modeline-h` / `--layout-tree-row-h`，
      占位块只取 `--hover` / `--border` 档（断言先行：先写「无硬编码 px、无 token 表外颜色」的视觉断言，再实现）
      —— 「壳建出后启动面仍在」由 `startup-restore.spec.ts` 第 1 条断言（`.app-shell` 与 `#startup` 同时在
      DOM、且 `#app #startup` 为 0）；几何 / 颜色 / 零动画由 `m645-startup-surface.spec.ts` 断言
- [x] 2.2 产品标记取 `getName()` 结果；`null` 时不建该元素（MUST NOT 占位名）；不显示版本号
      —— 视觉场景「产品名读不到时整块隐藏」（`appMeta: false`）
- [x] 2.3 阶段行：恢复进行中复用既有 D95 文案（`t("D95")`，文案真源在 `文案-Copy.md` / `src/copy-data.ts`）；
      其余阶段不建该元素。**不新增文案条目**，完成后 `文案-Copy.md` 的核对栏记「本次无新增」
      —— deck 的「各批」清单记「未取新号 / 本次无新增文案条目」，D95 的实现备注同步改准消费点
- [x] 2.4 启动面零 `animation` / `transition` 声明；`dismiss` 用 `remove()` 单帧移除
      —— 视觉场景对 `#startup` 全子树扫计算样式（`animation-name` / `transition-duration`）
- [x] 2.5 启动面不抢焦点、不注册键盘监听、不拦截事件；核对既有全局键位在启动态期间的行为未被改变
      —— 启动面是纯静态 DOM；键位表与分发器零改动
- [x] 2.6 启动面内含「打开 vault」入口，回调复用 `tree.showEmpty` 的 `onOpenVault` 与 `loadVault` 的 dirty
      守卫路径（不新开第二条打开链路）—— `setOpenHandler(() => requestAddVault())`（同一 dirty 前置门 +
      目录选择器）；`startup-restore.spec.ts` 第 4 条经它走完整让位链路
- [ ] 2.7 标题栏占位带带 `data-tauri-drag-region`：启动态期间窗口可拖动；启动面容器不挂 `mousedown` /
      `preventDefault`（REVIEW.md『标题栏 mousedown preventDefault 打断拖拽』条），真机拖一次确认
      —— 结构判据已落（视觉场景断言属性在；容器零 `mousedown`）；**真机拖一次未做**：就绪门之前没有可
      执行步骤的通道（启动态在步骤开跑时必然已撤下，见 `scripts/acceptance/README.md` 的「已知边界」），
      留作 Alex 真机手感项

## 3. 撤下与让位

- [x] 3.1 撤下判据写成纯函数（输入 = `treeReady` / `noVaultTerminal` / `elapsedMs`，输出 = 撤下或继续），
      挂在既有收口：`applyVault` 的 `tree.setVault` 之后、`refreshVaultStatus` 的未打开终态分支；`dismiss` 幂等
      （同一收口在用户后续切换 vault 时会再跑，已撤下即空动作）
      —— `src/startup-gate.ts`（输入含 `degraded`，四种结局同在一处判）；单测 `tests/unit/startup-gate.test.ts`
- [x] 3.2 `vault-workspace` 的恢复中呈现改由启动态承担：核对 `restore_pending` 期间不再走 `tree.showEmpty(D95)`
      建空态（否则同一等待两处呈现），并确认让位规则、`vault:restore_finished`、`LUMIR_READY` 逐条未动
      —— `refreshVaultStatus` 的恢复中分支只 `setPhase(D95)`；`startup-restore.spec.ts` 第 1 条断言恢复中
      `.ft-empty` 为 0；后端 Rust 侧零改动（`restore_pending` / 事件 / 端点逐字未动）
- [x] 3.3 安全阀（≤10s）：超时撤下并回调既有恢复中态；实现值与其读数进实现说明
      —— `STARTUP_TIMEOUT_MS = 10_000`；撤下后由 `onDismiss("timeout")` 回落 `tree.showEmpty(D95)`；
      design §11.4 / 验收场景 225 的文档记「真机不可合成」的边界
- [x] 3.4 逐条走 failure 路径（design §6 的表）：无 `last_vault` / 失效 / 打开失败 / 配置读失败 / 恢复线程起不来 /
      主模块装载失败——每条都要有「启动态已撤下」的判据
      —— 无 `last_vault` / 失效 / 打开失败 / 配置读失败都走 `refreshVaultStatus` 的未打开终态分支
      （`notifyNoVault`，视觉场景第 2 条 + 验收场景 225 第二步）；恢复线程起不来 ⇒ `restore_pending` 保持
      false ⇒ 同一条终态分支；主模块装载失败 ⇒ `degrade()`（`src/boot.ts` 的 catch）。
      **`vault_current` 读取失败不当作未打开终态**（读不到 ≠ 空，见该 catch 分支的注释：只铺错误空态，
      交由安全阀兜底）
- [x] 3.5 用户在启动态内打开另一个 vault：确认既有让位规则接管，启动态等**新** vault 树装载完成才撤下
      —— `startup-restore.spec.ts` 第 4 条（恢复完成信号不再生效 + 新 vault 树就绪即撤下）

## 4. 诊断读数

- [x] 4.1 `src-tauri/src/logging.rs`：白名单新增事件名 `startup_surface` 与字段 `phase` / `reason` / `ms` /
      `ts_unix_ms`（白名单测试会强制 snake_case 与字段集合，先加断言用例再实现）
      —— 新增单测 `startup_surface_readings_are_the_observation_set`（字段面逐项 + 白名单外字段被拒），
      事件也进了 `event_names_are_snake_case_and_whitelisted` 的清单；`src/bindings/LogEventName.ts` 由
      cargo test 重导出
- [x] 4.2 启动层落两条读数：`phase=first_frame`、`phase=dismissed` + `reason ∈ {tree_ready, no_vault, timeout,
      degraded}`；两条都带 unix 毫秒时间戳，实现说明里给出「`LUMIR_READY` → 首帧」的算例（相减即得）
      —— 算例与实测见 design §11.4；真机断言见验收场景 225（含「首帧读数先于撤下读数」的顺序正则）
- [x] 4.3 核对载荷无 vault 名 / 路径 / 文件名 / 文档内容（白名单只放允许字段，机制化兜底）
      —— Rust 白名单是机制化判据（单测覆盖拒绝路径）；验收场景 225 另做端到端复核（读数行不含验收 vault 路径）

## 5. 测试与验收（判别性优先）

- [x] 5.1 视觉新场景：stub 把 vault 状态冻结在「恢复中」，截启动态三主题首帧；断言几何 = token 解析值、
      产品名 = stub 值、标题栏占位带带 `data-tauri-drag-region`、启动面无 `animation` / `transition` 命中
      —— `tests/visual/scenes/m645-startup-surface.spec.ts`（4 条：三主题 + 产品名缺失），基线
      `startup-{light,dark,eink}-chromium-darwin.png`（新增，未动既有基线）
- [x] 5.2 视觉既有场景回扫：全部场景必须在启动面撤下后截帧。**先造一个「不撤下」的输入**确认既有场景会红，
      再实现撤下信号（REVIEW.md『覆盖声明超出真实验证』条）；实现后逐场景跑一遍，把结果计数写进任务勾选
      —— 撤下门在 `tests/visual/scenes/expect-screenshot.ts`（5s 上界 < 10s 安全阀）。
      **反向验证实测（删掉 `notifyTreeReady`）**：`startup-restore.spec.ts` 第 3/4 条判红（判别力成立）；
      既有截图场景（app-main 6 条）仍全绿、每条多耗 10s——安全阀把覆盖层撤下后点击才成功。因此
      「信号是否接上」的判别性判据落在 `startup-restore.spec.ts`，`expect-screenshot` 的撤下门只作第二道
      防线（防「永不撤下」）。边界记在 design §11.5 与两处代码注释。全量跑结果见 5.6
- [x] 5.3 单测：撤下判据纯函数（树就绪 / 未打开终态 / 超时 / 降级四条各一例，删掉判据必红）
      —— `tests/unit/startup-gate.test.ts`（7 条：四结局 + 无信号 + 安全阀边界 + 优先级/上界）
- [x] 5.4 真机验收场景（`scripts/acceptance/`）：合成大 vault 冷启 → 诊断读数断言「首帧 → 撤下 →
      reason=tree_ready」的顺序；启动态期间从入口打开另一个 vault（让位）；启动态期间拖动窗口（标题栏 drag
      region）；安全阀路径用合成慢加载 fixture。同步更新 `scripts/acceptance/README.md` 的场景清单
      —— 场景 `225-app-splash-screen.md`（大 vault 冷启读数顺序 + 失效路径 no_vault + 载荷卫生）；
      真机 **2026-10-24 1/1 PASS（11 断言，0 FAIL）**（证据
      `.local/acceptance/2026-10-24-m711/225-app-splash-screen/`；`first_frame` 先于
      `dismissed(reason=tree_ready)` 的顺序与 `no_vault` 撤下原因两条都命中）。
      **让位 / 窗口拖动 / 安全阀三项在真机层不可达**（启动态在就绪门之前，见 README「已知边界」）：
      让位由视觉场景 `startup-restore.spec.ts` 第 4 条判，拖动只有结构判据（2.7 未做真机拖），安全阀由
      单测 + 启动面计时器承担——如实登记，不冒充已覆盖
- [x] 5.5 冷启动前后读数：改动前 / 后各 n≥20，median 增量 ≤10ms；超出即按 design §3 回炉，不动容忍线
      —— 5 轮交错、每轮 n=20：中位-中位增量 **−8.1ms**（246.7 → 238.6ms），满足判据；单轮散布
      −31…+36ms 属本机噪声（结构上该端点早于本 change 的任何前端代码）。见 design §11.4
- [x] 5.6 `gate.sh visual`（本次触到样式与视觉场景，本地必须跑一次；基线更新须 Alex 过目）
      —— `GATE RESULT: 13/13 PASS（SKIP 0）`（visual-regression 497s，含全量像素）。首轮全量红 4 条
      （lists / m293 的 dark 与 eink / mv-vault-switcher）：两段式启动作废了「`goto` 即壳已建出」与
      「`config_get` 调用计数即配置已施加」两条旧就绪代理，已按界面信号改（`configApplied()` /
      显式等元素），`configGets` helper 与计数器删除；复跑全绿。**新增基线 3 张**
      （`m645-startup-surface` 的 light / dark / eink），既有基线未更新——新基线图需 Alex 过目

## 6. 文档与登记

- [x] 6.1 `design.md` 的读数与实现期实测值对齐（§5、§9 的第 1 条）—— design §11.4（首帧 ≈253ms、冷启动
      −8.1ms），§9 第 1 条已加实测指针
- [x] 6.2 若 D1 裁品牌仪式：补原型截图 + `design.md`「视觉保真」一节（流程硬要求），再进入实现
      —— D1 裁感知性能，本条不适用（design §10 已写明）
- [ ] 6.3 归档时为本 capability 手写 `Purpose`（`openspec archive` 会写占位 Purpose 并让 `validate --strict`
      报红）—— 归档评审阶段的事，不在实现 mission 内
- [x] 6.4 若实现期确认「窗口底色晚于 `show()` 施加」需要本 change 一并修：先回 proposal 改 Non-goals 并重走
      节点 1 —— 实现期未发现需要一并修的现场；仍按 Non-goals 另行登记

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      —— `Totals: 37 passed, 0 failed (37 items)`（gate 的 openspec-validate 门亦 PASS）
- [x] 7.2 `bash scripts/docs-check.sh` 通过（含相对链接与归档对账）
      —— `docs-check: PASS（ADR 8 份结构合法 + README 索引双向一致 + OpenSpec 相对链接可达 + 归档对账无静默丢段）`
- [x] 7.3 `bash scripts/gate.sh quick` 通过；照抄 `GATE RESULT` 原文行与退出码
      —— `GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0）；visual 档 `GATE RESULT: 13/13 PASS（SKIP 0）`
