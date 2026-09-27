# Tasks: vault-switch-feedback

## 1. 浮层定位（修 Alex 真机反馈 4）

- [x] 1.1 `src/vault-switcher.ts` 的 `place`：纵向夹进挂点矩形，横向口径不变；常态路径与修前逐像素一致
- [x] 1.2 纵向余量不足时把 `max-height` 压到实测可用空间（列表仍是唯一滚动容器）；写 inline 前先清空残留值
- [x] 1.3 模块头注释与 `src/style.css` 的浮层注释同步（定位的夹取范围写进注释，不留在代码里当暗知识）
- [x] 1.4 复算三档现场（以 node 复现算式）：入口在原位 `top = anchor.bottom + 4`（= 旧式 86px，逐值相同）、入口露出下半 `24`、入口滚出视口 `0`（贴视口上沿、浮层完整可见）

## 2. 装载即时反馈（Alex 真机反馈 2）

- [x] 2.1 `src/vault-switcher.ts`：`createVaultLoadingIndicator`（无文案、`hidden` 常态、引用计数、标题栏末尾追加）
- [x] 2.2 `src/style.css`：`.vault-loading` 样式（tokens 取色、0.8s 旋转、reduced-motion 分支）
- [x] 2.3 `src/main.ts`：指示装配 + `loadUserVault` 壳 + 三条用户发起的装载通道接线（切换 / 重定位、新增、remap 出口）
- [x] 2.4 `src/main.ts`：终点挂在 `switcher.onVaultLoaded()` 的 Promise 上；启动恢复路径不开关指示（引用计数下 `end()` 为 no-op）
- [x] 2.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（29/29，含本 change）

## 3. 卡顿根因定位

- [x] 3.1 三段耗时读数接入（`vault_load_open` / `vault_load_tree` / `vault_load_restore`，阈值 250ms，走既有 `slow_callback`）
- [x] 3.2 真机读数落档：`vault_load_open` 2252ms（48MB 稀疏 md）/ 4615ms（96MB）/ 8979ms（192MB）→ **≈48ms/MB 线性**；`vault_load_restore` 46 个标签 992–1359ms、14 个标签 390ms → **≈25–30ms/标签**；`vault_load_tree` 在合成 vault 规模下未触发阈值。读数落 `test-results/acceptance/env/lumir/logs/2026-09-27.jsonl`（git 外）
- [x] 3.3 结论写进 review-request，并落 finding（`20260927-worker-vault-switch-fb-improve-vault.md`：全量建图 + 全量树重建 + 逐标签串行恢复三段结构成本，含 Alex 真实 vault 规模 8189 文件 / 1525 md 的推演与建议路径）；**没有**在 scope 内找到低风险压缩（三段分别落在 Rust / 树渲染策略 / 恢复世代语义上）

## 4. 验收场景与门禁

- [x] 4.1 新增 `scripts/acceptance/scenarios/49-vault-switch-feedback.md`（即时反馈时序 + 浮层列表完整可读 + 端到端切换闭环 + 截图证据 + 放大器与边界说明）
- [x] 4.2 `node scripts/acceptance/run.mjs --check` 通过（56 场景）；真机跑 49 全 PASS（22 断言 / 0 失败，`test-results/acceptance/2026-09-27-m252-final2/49-vault-switch-feedback/`，主 checkout）
- [x] 4.3 真机 AX 形态确认：WKWebView 把它暴露成 `AXProgressIndicator = "50"`（无 bbox；`hidden` 时节点整体不在 AX 树里 ⇒ 节点在场即证明元素真被布局渲染）→ 保留 `role="progressbar"`，断言不动
- [x] 4.4 复跑既有场景：`25-vault-list-close-keeps-reading-position` **PASS 26/0**；`17-multi-vault-switch` FAIL 4 条——**全部**是套件占位符缺陷导致的第二 vault 行（`$vault2` 被 `$vault` 前缀替换吃掉，finding 已落），浮层相关断言（打开 / 新增入口在 / Esc 收起 / ⌘O 再开）全绿 ⇒ 与本 change 的定位改动无关；`39-titlebar-identity` FAIL 1 条（标题栏拖拽 Δ=(0,0)），失败轮与另一个 agent 的并行真机实例同轮（套件文档要求串行），**已复跑**（见 5.3）
- [x] 4.5 `scripts/gate.sh quick` 全绿（9/9 PASS，1 SKIP = tsc-visual 依赖未装，见 5.4 的处理）
- [x] 4.6 视觉门禁（`src/style.css` 动过 → AGENTS.md 要求本地跑）：`scripts/gate.sh visual`（隔离断言 + 视觉回归，隔离端口）

## 5. 收口

- [x] 5.1 浮层几何的真机覆盖缺口留 finding（`20260927-worker-vault-switch-fb-improve-scroll-m252.md`：套件缺 `scroll` 动作）
- [x] 5.2 `openspec/changes/vault-switch-feedback/` 的三个制品与本文件的勾选状态按实际证据写（未验的一律写明「未验」）
- [x] 5.3 `39-titlebar-identity` 复跑结论（无并行实例时）
- [x] 5.4 另落三条 finding：AX 快照延迟秒级（`…-improve-ax-toast.md`）、`$vault2` 被前缀替换（`…-bug-vault-vault2-…md`）、会话恢复「已跳过」文案把两种成因合成一句（`…-bug-vault.md`）
