# Tasks: app-splash-screen

> 阶段门：节点 1（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现 proposal
> 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> 若 D2 裁「只到壳挂载」：删除 3.2 与 6.3（`vault-workspace` 的 MODIFIED 整块撤回），其余不变。

## 0. 提案（节点 1）

- [ ] 0.1 起草 `proposal.md` / `design.md` / `specs/{app-startup,vault-workspace}/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，其中 D1 决定形态、D2 决定是否要改 `vault-workspace`）

## 1. 启动层与首帧

- [ ] 1.1 新增 `src/boot.ts`：`index.html` 的模块脚本改指向它；用 **async IIFE**（不用 top-level await——最低系统
      10.15 的 WKWebView 不支持，实现期在真机确认一次，结论写进文件头）
- [ ] 1.2 首帧前读配置与应用元信息（`Promise.all([configGet(), getName()])`，两端都 `catch` 成 `null`）；只写
      `<html data-theme>`，不碰 modeline 与其余启动装配（那些归主模块）；把这份配置快照交给主模块复用，主模块
      原本那次 `configGet()` 改为接快照（同一份配置不许两处各读一次）
- [ ] 1.3 启动层 import 启动面所需的样式（与主模块同一份 token 表，不另立第二份）；核对构建产物里该 CSS 在
      entry chunk 内、不随主模块的异步 chunk 迟到
- [ ] 1.4 `await import("./main")` 装载主模块；**装载失败必须撤下启动态**（`dismiss("degraded")`）并把错误交给既有
      console 路径
- [ ] 1.5 双 rAF 等待首帧后再动态装载（`nextPaint`）；注释写明它只是尽力而为，正确性不依赖它
- [ ] 1.6 读数：记录「`show()` → 启动层首帧」的实测值（本机 ≥10 次），写进实现说明；作为「是否需要 show 闸门」
      的判据（design §9 已知边界 1）

## 2. 启动态的呈现

- [ ] 2.1 新增启动面模块（`src/startup-surface.ts`）：`mount({ productName })` / `dismiss(reason)` 两个出口；
      **承载点是 `document.body` 下的独立兄弟节点（如 `#startup`），不在 `#app` 里**——`createShell` 用
      `mount.replaceChildren(root)` 整体替换 `#app` 的子节点（`src/shell.ts:248`），挂在 `#app` 里的启动面会
      在壳建出的瞬间被抹掉（写一条「壳建出后启动面仍在」的单测挡住这个坑）；
      几何全部取 `--layout-titlebar-h` / `--layout-sidebar-w` / `--layout-modeline-h` / `--layout-tree-row-h`，
      占位块只取 `--hover` / `--border` 档（断言先行：先写「无硬编码 px、无 token 表外颜色」的视觉断言，再实现）
- [ ] 2.2 产品标记取 `getName()` 结果；`null` 时不建该元素（MUST NOT 占位名）；不显示版本号
- [ ] 2.3 阶段行：恢复进行中复用既有 D95 文案（`t("D95")`，文案真源在 `文案-Copy.md` / `src/copy-data.ts`）；
      其余阶段不建该元素。**不新增文案条目**，完成后 `文案-Copy.md` 的核对栏记「本次无新增」
- [ ] 2.4 启动面零 `animation` / `transition` 声明；`dismiss` 用 `remove()` 单帧移除
- [ ] 2.5 启动面不抢焦点、不注册键盘监听、不拦截事件；核对既有全局键位在启动态期间的行为未被改变
- [ ] 2.6 启动面内含「打开 vault」入口，回调复用 `tree.showEmpty` 的 `onOpenVault` 与 `loadVault` 的 dirty
      守卫路径（不新开第二条打开链路）
- [ ] 2.7 标题栏占位带带 `data-tauri-drag-region`：启动态期间窗口可拖动；启动面容器不挂 `mousedown` /
      `preventDefault`（REVIEW.md『标题栏 mousedown preventDefault 打断拖拽』条），真机拖一次确认

## 3. 撤下与让位

- [ ] 3.1 撤下判据写成纯函数（输入 = `treeReady` / `noVaultTerminal` / `elapsedMs`，输出 = 撤下或继续），
      挂在既有收口：`applyVault` 的 `tree.setVault` 之后、`refreshVaultStatus` 的未打开终态分支；`dismiss` 幂等
      （同一收口在用户后续切换 vault 时会再跑，已撤下即空动作）
- [ ] 3.2 `vault-workspace` 的恢复中呈现改由启动态承担：核对 `restore_pending` 期间不再走 `tree.showEmpty(D95)`
      建空态（否则同一等待两处呈现），并确认让位规则、`vault:restore_finished`、`LUMIR_READY` 逐条未动
- [ ] 3.3 安全阀（≤10s）：超时撤下并回调既有恢复中态；实现值与其读数进实现说明
- [ ] 3.4 逐条走 failure 路径（design §6 的表）：无 `last_vault` / 失效 / 打开失败 / 配置读失败 / 恢复线程起不来 /
      主模块装载失败——每条都要有「启动态已撤下」的判据
- [ ] 3.5 用户在启动态内打开另一个 vault：确认既有让位规则接管，启动态等**新** vault 树装载完成才撤下

## 4. 诊断读数

- [ ] 4.1 `src-tauri/src/logging.rs`：白名单新增事件名 `startup_surface` 与字段 `phase` / `reason` / `ms` /
      `ts_unix_ms`（白名单测试会强制 snake_case 与字段集合，先加断言用例再实现）
- [ ] 4.2 启动层落两条读数：`phase=first_frame`、`phase=dismissed` + `reason ∈ {tree_ready, no_vault, timeout, degraded}`；
      两条都带 unix 毫秒时间戳，实现说明里给出「`LUMIR_READY` → 首帧」的算例（相减即得）
- [ ] 4.3 核对载荷无 vault 名 / 路径 / 文件名 / 文档内容（白名单只放允许字段，机制化兜底）

## 5. 测试与验收（判别性优先）

- [ ] 5.1 视觉新场景：stub 把 vault 状态冻结在「恢复中」，截启动态三主题首帧；断言几何 = token 解析值、
      产品名 = stub 值、标题栏占位带带 `data-tauri-drag-region`、启动面无 `animation` / `transition` 命中
- [ ] 5.2 视觉既有场景回扫：全部场景必须在启动面撤下后截帧。**先造一个「不撤下」的输入**确认既有场景会红，
      再实现撤下信号（REVIEW.md『覆盖声明超出真实验证』条）；实现后逐场景跑一遍，把结果计数写进任务勾选
- [ ] 5.3 单测：撤下判据纯函数（树就绪 / 未打开终态 / 超时 / 降级四条各一例，删掉判据必红）
- [ ] 5.4 真机验收场景（`scripts/acceptance/`）：合成大 vault 冷启 → 诊断读数断言「首帧 → 撤下 → reason=tree_ready」
      的顺序；启动态期间从入口打开另一个 vault（让位）；启动态期间拖动窗口（标题栏 drag region）；
      安全阀路径用合成慢加载 fixture。同步更新 `scripts/acceptance/README.md` 的场景清单
- [ ] 5.5 冷启动前后读数：改动前 / 后各 n≥20，median 增量 ≤10ms；超出即按 design §3 回炉，不动容忍线
- [ ] 5.6 `gate.sh visual`（本次触到样式与视觉场景，本地必须跑一次；基线更新须 Alex 过目）

## 6. 文档与登记

- [ ] 6.1 `design.md` 的读数与实现期实测值对齐（§5、§9 的第 1 条）
- [ ] 6.2 若 D1 裁品牌仪式：补原型截图 + `design.md`「视觉保真」一节（流程硬要求），再进入实现
- [ ] 6.3 归档时为本 capability 手写 `Purpose`（`openspec archive` 会写占位 Purpose 并让 `validate --strict` 报红）
- [ ] 6.4 若实现期确认「窗口底色晚于 `show()` 施加」需要本 change 一并修：先回 proposal 改 Non-goals 并重走节点 1

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `bash scripts/docs-check.sh` 通过（含相对链接与归档对账）
- [ ] 7.3 `bash scripts/gate.sh quick` 通过；照抄 `GATE RESULT` 原文行与退出码
