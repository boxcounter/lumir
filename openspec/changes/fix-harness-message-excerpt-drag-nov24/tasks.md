# Tasks: fix-harness-message-excerpt-drag-nov24

## 1. 归因与修复

- [x] 1.1 核对修前两轮真实 0/1 FAIL（`acceptance-121-locator.log` / `-r2.log`，均在首次 drag、未到 composer locator）、窗口几何和注入自报；安装版阻挡仅为 exit 2 环境拒跑，不计真实 FAIL。诊断 `fix-r1` 以 `AXfocusedWindow=true` 排除 key-window，截图定位旧 y=130 落在消息间空白，`fix-r2` 证明正文行内新坐标成立；产品选择器无需修改
- [x] 1.2 两次真实 drag 统一重标定为 `(760,170) → (880,170)`，不改两处 `selection` 正观测，不保留无关的 focus 前置
- [x] 1.3 将第二问 composer locator 改为 `问点什么|why`，保留 typeInNode 的注入回读判据
- [x] 1.4 在场景注释中写明排版变化后的坐标重标定与正断言纪律

## 2. 验证

- [x] 2.1 `node scripts/acceptance/run.mjs --check 121` 通过（279 个场景静态校验通过）
- [x] 2.2 `scripts/visual/run.sh scenes/m423-message-excerpt.spec.ts`：8/8 PASS，作为产品选择器与卡片链路的 Chromium 对照
- [x] 2.3 仅 121 的完整 WKWebView runner：1/1 PASS、19 条断言、23.7s、退出码 0；首次与第二次真实选区、composer 第二问、transcript 同构及 wire 序列化均通过（`.local/acceptance/2026-11-24-message-excerpt-drag/fix-r2/`）
- [x] 2.4 `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（含 `docs-check`；日志 `.local/missions/message-excerpt-drag-nov24/gate-quick.log`）
- [x] 2.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：40 passed / 0 failed；归档前 strict 检查通过
- [x] 2.6 独立 reviewer agent-373 对 `fe04278a` 结论 clean / merge，确认坐标与选区 / 摘录卡判据真实、无产品修复需要；节点 2 五要件与归档记录写入 proposal
