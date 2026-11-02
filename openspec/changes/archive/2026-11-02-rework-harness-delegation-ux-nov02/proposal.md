# Proposal: 把子代理可见面从「运行时监控台」改为「按用户任务组织、按需出现」

- Change ID: `rework-harness-delegation-ux-nov02`
- 日期: 2026-11-02
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## 节点 1 批准记录

- **批准人 / 日期**：Alex Lee，2026-11-02。
- **批准原话**：「好，请你动手。」
- **批准对象**：tower 上一轮给出的完整方案全文（主对象从 run 改为用户任务；普通运行归对话流，
  并行后台 / 待批才出现 composer 控制区；完成归同一任务行；后台失败保留到用户看见；空闲不显示
  任务区 / 完成汇总 / 常驻用量；单次用量进详情，会话聚合按需；rounds 仅触顶时作为原因；修复僵尸
  卡片、resume 身份、跨 vault 控制入口与通知指向）。
- **依据材料**：UX 复盘（`.tower/comms/inbox/20261102-review-task-ux-tower-survey-summary.md`，
  下称「复盘」）与子运行生命周期审计（finding
  `.tower/comms/findings/20261102-audit-subrun-lifecycle-bug-resume-rounds-steps-segments-1.md`，
  下称「审计」）。用户最初反馈原话：「看不懂 harness pane 里的 task 面板」「subtask usage (by model)
  是否有必要，如果有必要是否有更好的方案？」「整体使用下来，我觉得目前 subagents / tasks 的 UX
  设计逻辑有问题，请你从更高维度更深度地复盘。」

## 节点 2 记录（归档前）

- **1. 节点 1 批准**：Alex Lee，2026-11-02，原话「好，请你动手。」（批准对象见上节）。
- **2. 独立评审**：`reviewer-delegation-ux-final` 对 exact tip
  `0dfa906864780220a82c7e11f021c43e7477a87c` 给出 `status: clean` / `merge: merge`，findings 为 none；
  评审文件 `.tower/comms/reviews/review-feat-rework-harness-delegation-ux-nov02-reviewer-delegation-ux-final-r1.md`
  （round 1 / seq 992，2026-11-02）。
- **3. tasks**：30/30 全部勾选（`openspec/changes/rework-harness-delegation-ux-nov02/tasks.md`），无放弃项。
- **4. 门禁与真机证据**：quick `GATE RESULT: 13/13 PASS（SKIP 0）`、`GATE_EXIT=0`
  （`/tmp/m822-gate-quick-r8.log`）；visual `GATE RESULT: 15/15 PASS（SKIP 0）`、`GATE_EXIT=0`
  （`/tmp/m822-gate-visual7.log`，详细日志 943 passed / 1 skipped / 10.1m）；真机 201（14 断言）/
  240（14）/ 192（17）/ 203（11）全 PASS、合计 56 断言，
  证据 `.local/acceptance/m822-delegation-ux-20261102/run/summary.md`。
- **5. 规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` PASS（扫过 8 份 delta，
  10 条 MODIFIED，对比 141 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）；
  `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 35 passed, 0 failed
  (35 items)`；`bash scripts/docs-check.sh` → `docs-check: PASS`。
- **放行结论**：机器 + 独立评审放行（`docs/process/openspec-workflow.md` 节点 2 五要件），
  未命中必须找 Alex 的例外类别。归档后读数见下方追加段。

## Why

现设计把运行时的**记账对象**（run、rounds、segment、按模型 token 桶）当成了用户要看的**产品对象**，
因此信息层级、默认可见性与归属都跟着实现内部结构走。可核事实（均在本仓现行代码上核过）：

1. **同一件事最多有四个可见面**：composer 上方的任务行、transcript 的 `task` 工具行、后台完成通知、
   父会话正文里的转述。任务行只在运行中出现、完成后消失，用户必须学一条「状态决定去哪看」的规则；
   后台完成通知还无条件写「详情见任务面板」，而那一刻面板已经没有该 run（`src/harness-panel.ts:8946`
   与 `:8802-8806`）。
2. **主读数是闸门计数而不是进度**：行首读数为「N rounds」——`rounds` 是 `max_turns` 的消耗计数
   （`src-tauri/src/harness/turn.rs:495-510`），不能回答「还要多久 / 是否值得等」。
3. **成本读数在最贵的位置、却不是用户要的那一份**：常驻 `Subtask usage (by model)` 在无 live run 时
   永久占据 composer 上方（`src/harness-panel.ts:8786-8787`），且恢复后「有内容、无标题、无法折叠」
   （`:8798` 与 `:8905-8908`）；而 living spec 早已要求「每个 run 的详情（含用量）从 transcript 的
   `task` 行展开」（`openspec/specs/harness-subagents/spec.md:634`），实现里这条用量从未出现。
4. **空闲态并不空闲**：全部 run 收敛后任务区仍以「本次会话 N 个已完成」常驻（`:3659-3692`），且
   `failed` / `stopped` 不计入——全失败时标题为空、只剩一个无标题用量表。
5. **状态会停在错误的地方（已证实的缺陷）**：跨 vault 切换时 `clearTranscriptSurface()` 只清
   `runRowEls`（`:9682-9699`）不删 `taskList` 子节点，`renderTaskArea()` 只按 map 对账（`:8801-8806`），
   于是旧 vault 的行成为永久僵尸：读数冻结、「停止」永不隐藏、点击无效（审计；M819）。切回后仍在
   跑的 run 反而没有行、也没有「停止」——快照没有 live run 列表可重建（`harness_state` 现有键集合，
   `src-tauri/src/harness.rs:1869-1876`）。
6. **resume 段被讲成第二个任务**：同一 `run_id` 的第二段 `subagent_started` 会 filter 后 push 全新
   视图，`rounds` / `steps` / `elapsedMs` 归零、`segments` 恒为 1（`:3548-3572`；注释 `:3447-3448`
   声称「resume 会累加」但没有任何累加点），用户因此把同一 run 的两段看成两个子代理（审计）。

## What Changes

- **主对象从 run 改为「一次交办」**：状态词、description、执行者、用时、可执行动作是 L0；最近一步、
  模型、步数、摘要是 L1；单次用量、触顶原因与预算、分段是 L2。任何可见数字都必须回答其中一层的问题。
- **一个相位一个家**：运行中归对话流的 `task` 行（运行期间不被工具块折叠、行内直接可停止）；≥2 并行 /
  后台运行 / 等待批准才在 composer 上方出现控制区；完成沿用同一行的终态；空闲态控制区与完成汇总整体
  不出现；后台 run 的失败 / 部分结果 / 停止保留一行直到用户确认。
- **常驻用量退场**：删除 composer 上方的 `Subtask usage (by model)` 块；单次用量进 transcript `task`
  行的展开详情（live 与恢复同一形状）；会话聚合改为会话浮层里的按需「本会话子任务用量」段，只有一个
  模型桶时不出现「按模型」分组。
- **`rounds` 降级为触顶原因**：行与详情不再把轮次当进度读数，只在 `stopped_by = rounds` 时作为原因出现。
- **自动回合触顶提示移出任务区**：`auto_wake.blocked` 的提示行与「继续」改为对话流里的一条自动化提示，
  不再冒充一件交办。
- **修三个已证实缺陷**：跨 vault 僵尸行（DOM 清理 + 按 `data-run` 对账）、切回后在跑的 run 无行无停止
  （快照新增 live run 列表）、resume 段清零（同一 run 累计 rounds / steps / segments，保持一个身份）。
- **通知落点改准**：后台完成通知删除「详情见任务面板」，结果与详情统一落在 transcript 的 `task` 行。

## Non-goals

- 不新增「本会话委派回顾」这类新能力（复盘 §八第 5 条列为另立能力；本 change 只做按需的会话用量段）。
- 不改按模型分桶的记账口径、`subrun` sidecar 形状与可重算性（后端账本不变，只改呈现与入口）。
- 不改权限 / 批准闸语义（批准卡形态与位置不变，仅子运行行的宿主随任务区收窄）。
- 不做视觉基线 `--update`（审美 / 手感归 Alex，见 design「视觉保真」的裁决项）。
- 不引入「单前台 run 的极细状态线」——批准方案允许二选一，本 change 取「不出现」，理由见 design §3。

## Impact

- 影响的 specs：`harness-subagents`（4 条 MODIFIED requirement：任务面板与子代理可见面；并行、后台与
  调度；后台完成的通知投递与自动唤醒；子运行上下文装配与隔离）。
- 影响的代码/系统：`src/harness-panel.ts` / `src/harness-panel.css` / `src/copy-data.ts` /
  `src/ipc.ts`（事件与快照类型）、`src-tauri/src/harness.rs` 与 `src-tauri/src/harness/{session,subagents}.rs`
  （快照新增 live run 列表）、`src/bindings/**`（ts-rs 重导出）。
- 影响的验收面：`tests/unit/harness-subagents.test.ts`、`tests/visual/scenes/m607-*`、既有子代理真机
  场景（201 / 192 / 203 / 204 / 199 等）的期望回扫；新增跨 vault 场景 240 与多待批滚动断言。
- 关联约束：ADR 0002 性能合同（新增读数全部来自既有快照，不新增 IPC 往返；行重渲仍是事件驱动）；
  「同一语义两处真源」（状态词、用量文案、触顶原因词各自只有一个产出点）。
