# Proposal: 撤回入口的后果可感知性（图标化 + 完整提示 + 将被移除内容的预览）

- Change ID: `clarify-harness-withdraw-scope-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（需求 / 裁决），AI agent（起草与实现）

> **评审记录**
> 节点 1（提案评审）：**通过**（2026-11-27，Alex：「实现 Alex 已采纳的 Harness 撤回可感知性改进」
> 并给出以下边界）。批准边界：
> - 撤回入口不改成常驻，仍 hover / focus 显示；按钮不变大，改小型撤销图标；读屏名「撤回这一轮」。
> - 提示完整后果，措辞避免「后续回答」；工具副作用不回撤仍需明确，二次确认保留。
> - hover / 键盘聚焦撤回入口时，对将被移除的当前用户消息、对应 agent 回答与工具记录做轻微的
>   共同高亮 / 轮廓预览；不能影响布局；Esc / 移出 / 失焦 / 切换会话 / 在途状态变化时清理，不
>   制造额外跳动。
> - 成功 toast 按同口径表达消息 + 回答被撤回、原文回 composer，不暗示只删用户文字。
> - 只改最近可撤回用户消息，无权限 / 来源变化；只读、恢复、busy 等既有边界不动。
>
> 节点 2（归档评审）：按常规通道办理。

## Why

`add-harness-message-withdraw-nov26` 交付的撤回入口是一个文字按钮「撤回」：读屏名只说动作、悬停
提示只有同一句「撤回」，成功 toast 说「已撤回；原文已回到输入区」。用户从入口读不到这次动作的
完整后果——撤回会同时移除该消息之后的 assistant 回答与工具记录（工具副作用不回滚），而这些正是
用户最需要事先知道的。入口在消息 hover 时才出现，点击前也没有「哪些内容会消失」的预览：用户要
么先点下去、要么回去翻代码与文档。本 change 只补**可感知性**，不改撤回语义与后端任何边界。

## What Changes

1. **入口图标化**：撤回钮去掉可见文字，改 12px 撤销箭头图标（`aria-hidden`）；按钮盒维持
   20px 高、宽缩到 20px——不放大入口。仅在最后一条用户消息 hover 或入口 `focus-visible` 时显形。
2. **可访问名与提示分家**：读屏名 = 「撤回这一轮」（D1052 改文案）；悬停提示 = 完整后果句
   「撤回这条消息和它引发的回答、工具记录；原文回到输入框」（新增 D1089）。
3. **预览**：hover / 键盘聚焦撤回钮时，对**将被移除的那一段**——最后一条用户消息本身、其后的
   assistant 回答、工具块与错误行（transcript 顶层节点，排除进度行与空态提示）——加同一个
   `is-withdraw-preview` 类；CSS 只用 `outline`（虚线，1px）与 `background: var(--hover)`，
   两者都不参与布局。非预览帧零像素变化。**两个激活源分别跟踪**：指针悬停与键盘焦点任一
   仍成立就保留预览，只有两者都退出才清；**尾部后台通知在场时整段不预览**——后端会以
   `harness_withdraw_tail_notice` 拒绝这次撤回，预览只描述实际可执行的撤回（动作与后端错误
   语义不变，入口不静默禁用）。
4. **清理**：某个激活源退出时按另一源是否仍成立决定保留 / 清除；Escape（预览登记为 escape
   层栈顶层）、在途状态变化（`syncWithdrawButton` 判 busy）、视图复位（`resetView` / 面板摘除）、
   撤回动作开始、预览期间到达尾部通知时**强制清除并复位两个激活源**；不改动任何其它层的关闭
   顺序。
5. **文案同口径**：二次确认条（D1054）改为「撤回这条消息和它引发的回答、工具记录；本轮已执行：
   {tools}，这些操作不会撤销。」；成功 toast（D1056）改为「已撤回这条消息及它引发的回答、工具
   记录；原文已回到输入框，可编辑后重新发送」。工具名清单与确认动作（`confirm=false` → 二次确认
   → `confirm=true`）不动。
6. **真机判据对账**：882 / 887 的撤回点击目标从 `^撤回$` 改为 `^撤回这一轮$`；882 增加入口
   读屏名 / 悬停提示的 AX 断言与 hover 预览截图证据（截图只作证据，形态归 Alex）。

## Non-goals

- 不改撤回的后端语义：目标锁定、来源闸、派生检测、恢复占用栅栏、A 的删除与回滚、事件令牌、
  composer 回填全部不动。
- 不改入口的可见性时机（仍 hover / focus 显示），不做常驻、不做更大点击区。
- 不做预览的像素级动效（淡入 / 脉冲）；预览只是静态轮廓 + 淡底，避免额外跳动。
- 不改工具二次确认的动作数与副作用口径（不回滚任何工具副作用）。
- 不新增设置项 / 不新增开关；预览无持久状态。

## r2：独立终审 P2 修复（2026-11-27）

独立 K3 终审判 `findings`（绑定 `12275f06`），两项 P2 在 r2 修复：

1. **P2-1 双激活源**：预览不再由 `pointerleave` / `blur` 任一直接清掉。指针悬停与键盘焦点
   分别跟踪（`withdrawPreviewPointer` / `withdrawPreviewFocus`），任一仍成立就保留预览，两个
   都退出才清；Escape / 在途 / 视图换代 / 面板摘除 / 撤回动作开始等强制清理仍清全部源并保持
   Escape 栈幂等。新增两种退出顺序的组合测试（焦点留指针退、指针留焦点退）与全部退出才清的
   断言。
2. **P2-2 尾部通知不预览**：目标之后出现 `.lumir-hp-notice`（blocked / 触顶 / 自动唤醒通知）
   时，后端会以 `harness_withdraw_tail_notice` 拒绝整个撤回——此时整段预览不显示（不是仅把
   通知排除出虚线框），预览期间到达这类通知也立即撤下。入口与后端错误语义不变：按钮不静默
   禁用、点击仍发起同一条命令。新增合成 fixture 测试（前缀 + 目标轮 + 回答 + 工具行 + 尾部
   通知）：预览数为 0、通知无预览类、按钮可用且仍发 `confirm=false`。

两项修复均做了反向必红与恢复绿；未改已批准文案 / 小图标 / hover-focus 可见性 / CSS 零布局 /
复制钮 / 20×20 命中区（命中区扩大的后续 change 不受本 r2 影响），未改后端权限或通知语义，
未更新视觉基线。

## Impact

- **spec**：`harness` 的「撤回最近一条用户消息」requirement 一段 MODIFIED（入口、预览、提示与
  toast 口径）。
- **代码**：`src/harness-panel.ts`（入口图标、预览状态与清理、文案取值）、`src/harness-panel.css`
  （图标钮尺寸、预览轮廓）、`src/copy-data.ts` / `文案-Copy.md`（D1052 / D1054 / D1056 改写 +
  新增 D1089）。
- **测试**：`tests/visual/scenes/harness-withdraw-message-nov26.spec.ts` 新增入口 / 预览 / 清理 /
  无布局变化 / 确认条文案用例；`tests/unit/harness-withdraw-scope-copy.test.ts` 新增文案语义与
  中英双档断言。
- **真机**：更新 `scripts/acceptance/scenarios/882-harness-withdraw-message.md` 与
  `887-harness-withdraw-restored-session.md`（读屏名对账；882 加 hover 预览证据）。
- **视觉基线**：预期不产生整页 / 元素像素差异（非 hover 帧零变化）；若产生，候选放
  `.local/reviews/withdraw-scope-feedback-nov27/`，不更新基线。

## 节点 2：归档记录（2026-11-27）

### 归档前（五要件）

1. **方案已批准**：节点 1 Alex 2026-11-27 采纳「撤回可感知性改进」，批准边界为：不常驻、仍在
   hover / focus 显示；按钮不放大、改小型撤销图标；读屏名「撤回这一轮」；提示完整后果且避免
   「后续回答」；工具副作用不回撤与二次确认保留；hover / 键盘聚焦时对将被移除的消息、回答与
   工具记录做零布局影响的共同预览；Esc / 移出 / 失焦 / 切换会话 / 在途变化清理；成功 toast 同
   口径。r2 两项 P2（双激活源、尾部通知不预览）均在该边界内，无静默扩 scope；实现期未改后端
   权限 / 通知语义，未改复制钮与 20×20 命中区（后者归后续 change）。
2. **独立 reviewer clean / merge**：K3 r2 verdict `clean/merge`，绑定
   **`a62b7df178e53cb698826b4ea9d03de9e3d95bb9`**
   （`.local/reviews/withdraw-scope-feedback-nov27/independent-review-r2.md`）；r1 两项 P2 均复核
   修复，P1 / P2 / P3 无新增；四份反向必红日志与目标 spec 13/13 经 reviewer 独立复跑。
3. **tasks 完成**：全部勾选（1.1–4.6），无放弃项。
4. **要求的门禁与真机证据**：
   - `bash scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0
     （`.local/reviews/withdraw-scope-feedback-nov27/quick-r2.log`）；
   - **最终完整视觉** `bash scripts/gate.sh visual` → `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；
     `visual-regression` 1375s，无像素差异，未更新任何基线；
   - 目标视觉 13/13（`target-visual-r2-green.log`）；`pnpm test` 2195 passed / 0 failed
     （`unit-r2.log`）；`acceptance --check` 312 场景（`acceptance-check-r2.log`）；
   - 真机（新 tip `a62b7df1`）：882 PASS 15 断言 / 887 PASS 17 断言，2/2 PASS
     （`.local/acceptance/2026-11-27-withdraw-scope-feedback-r2/`，summary.md 与各场景
     `status.txt`）。
5. **规格对账无丢段 + 队列唯一（归档前读数）**：`npx --yes @fission-ai/openspec@1.12.0
   validate --all --strict` → 39 passed / 0 failed；`node scripts/openspec-archive-check.mjs` →
   PASS（扫过 9 份 delta，8 条 MODIFIED，对比 172 段，无静默丢段；归档队列 1 项已完成 change
   均有唯一条目）；`bash scripts/docs-check.sh` → PASS；`docs/backlog.md` 归档跟踪队列本 change
   有且仅有一条。

### 状态

- **视觉候选**：无需新基线。原因：非 hover / focus 帧零像素变化；预览只加 `outline` + 背景，
  不参与布局；最终完整视觉 15/15 PASS、无像素差异。
- **implemented**：是（代码 tip `a62b7df1`）。
- **released**：否——本批不打包 / 不发布。
- **machine PASS**：是（quick 13/13、完整 visual 15/15、目标视觉 13/13、单测 2195、acceptance
  312、validate 39/39、docs-check PASS）。
- **native PASS**：是（882 PASS 15 断言 / 887 PASS 17 断言，新 tip）。
- **archived**：待归档（归档后回填提交与审计读数）。

### 归档后

- 归档提交：`<待回填>`
- 包装器输出：`<待回填>`
- `--archived` 审计：`<待回填>`
