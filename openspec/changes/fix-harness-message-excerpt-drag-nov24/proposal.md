# Proposal: 修复消息摘录真机拖选坐标与 composer 定位

- Change ID: fix-harness-message-excerpt-drag-nov24
- 日期: 2026-11-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

场景 121 连续两次都在首次「真实拖选建立选区」阶段失败，尚未执行后续 composer 输入定位。两轮日志均为三次 CGEvent 拖选后没有「摘录到对话」钮，证据在 `.local/acceptance/2026-11-24-composer-locator-121*`；runner 按产品面 FAIL 如实上报，不能把它当作 flake 忽略。

真机 A/B 已定位根因：补 `focusWindow click: true` 后，`AXfocusedWindow=true` 与编辑器焦点都成立，旧 `(900,130) → (1020,130)` 仍三次造不出选区（`fix-r1`）；对照本轮截图，消息排版已把 assistant 正文下移到 y≈170，旧线段落在用户气泡与 Agent meta 之间的空白。只把线段重标定为当前正文行内的 `(760,170) → (880,170)` 后，完整 121 以 19 条断言 PASS（`fix-r2`）。因此这是 test-only 固定坐标未随排版重标定，不是产品选择器、CGEvent 注入通道或 key-window 缺陷。

后续 locator 另有一个已知的 test-only 失配：inline cards 把摘录卡实现为 composer 内 widget 后，AXTextArea 的名称仍是占位句，不再含旧 tray 的「Agent」。未合并分支 `test/composer-locator-121-nov24`（3874fcc8）只修这个后续定位，不是拖选修复；本 change 吸收同一 locator 口径，并以完整 121 实证。

## What Changes

1. **按当前文本几何重标定真实拖选**：121 两次 drag 统一为 `(760,170) → (880,170)`，起终点都落在同一 assistant 正文行内；场景注释明确要求 fixture、窗口尺寸或消息排版变化后按本轮截图重取。两次 `selection` 正观测及后续产品断言原样保留。
2. **composer locator 对齐 inline cards**：第二问改用「占位名 | 本轮注入文本」定位，保留 typeInNode 的 N→N+1 回读，证明文字确实落在 composer。
3. **只修验收场景，不改产品行为**：`src/` 与 Rust 产品代码零改动，不保留已证明与根因无关的 key-window 前置。

## Non-goals

- 不删除、跳过或放宽选区、浮动钮几何、卡片出处、序列化与 transcript 同构断言。
- 不把固定坐标改成程序化 DOM 选区，不用 `select_text` 替代真实 CGEvent 拖选。
- 不并行运行其他真机场景；本 change 的真机验证只跑 121。
- 不 merge / push；仅在本 change 五要件齐后归档，其他 change 不在范围内。

## Impact

- 影响的 specs：`harness`（ADDED ×1：消息摘录真机验收通道）。
- 影响的代码/系统：仅 `scripts/acceptance/scenarios/121-harness-message-excerpt.md` 与本 change 制品。
- 验证：场景静态检查、OpenSpec strict validate、`scripts/gate.sh quick`（含 docs-check）；消息摘录 Chromium 行为套件作产品侧对照，完整 121 WKWebView 真机为最终判据。
- 关联约束：真实选区行为合同、固定布局坐标的重标定纪律，以及「证据未实际取得不得写成 PASS」。

## 节点 2：归档放行记录（2026-11-24）

**机器 + 独立评审放行（五要件）**：

1. **方案已批准**：2026-11-24 任务书明确「test-only 则保持行为判据、产品缺陷则先不变量与修前红」并要求创建缺陷 change；本轮指令明确要求完成节点 2 与归档。实现未扩大产品行为面，`src/` 与 Rust 零改动。
2. **独立 reviewer clean / merge**：agent-373 对 `fe04278a2264becb11c103e443135c8407192c1f` 结论 clean / merge，确认坐标与选区 / 摘录卡判据真实、无产品修复需要。
3. **tasks 完成**：1.1–2.6 全部勾选；真实失败、诊断 A/B、最终 PASS、门禁与评审结论均已回填，无放弃项。
4. **门禁与真机证据通过**：
   - 修前两轮均为真实 0/1 FAIL，均在首次真实拖选、尚未到 composer locator：日志 `.local/missions/approval-visibility-nov24/acceptance-121-locator.log` 与 `acceptance-121-locator-r2.log`，证据 `.local/acceptance/2026-11-24-composer-locator-121*`。`baseline-r1` 是安装版实例导致的 exit 2 环境拒跑，MUST NOT 计入真实 FAIL。
   - 诊断 `fix-r1` 为有效 0/1 FAIL（34.0s）：`AXfocusedWindow=true` 与编辑器焦点成立，旧坐标仍失败，排除 key-window；证据 `.local/acceptance/2026-11-24-message-excerpt-drag/fix-r1/`。
   - 最终 `fix-r2`：121 **1/1 PASS、19 条断言、23.693s、exit 0**，首次与第二次真实选区、composer 第二问、transcript 同构和 wire 序列化均通过；证据 `.local/acceptance/2026-11-24-message-excerpt-drag/fix-r2/`。
   - `node scripts/acceptance/run.mjs --check 121`：279 个场景静态校验通过；`scripts/visual/run.sh scenes/m423-message-excerpt.spec.ts`：8/8 PASS。
   - `scripts/gate.sh quick`：**`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0**，日志 `.local/missions/message-excerpt-drag-nov24/gate-quick-final.log`。
   - `git diff --name-only 8fdf14e0..fe04278a` 仅列场景与本 change 三份制品，无产品代码改动。
5. **规格对账无丢段**：
   - `node scripts/openspec-archive-check.mjs --change fix-harness-message-excerpt-drag-nov24`：`PASS（扫过 1 份 delta，0 条 MODIFIED，对比 0 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`。
   - `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：40 passed / 0 failed。
   - `bash scripts/docs-check.sh`：PASS（含归档队列唯一、backlog 80/80、链接 699 条、验收契约与自测）；`git diff --check` 退出码 0。
