# Proposal: 恢复出来的旧会话也能撤回最近一条真实用户消息

- Change ID: `withdraw-restored-user-message-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（需求 / 裁决），AI agent（起草与实现）

> **评审记录**
> 节点 1（提案评审）：**通过**。Alex 原话「好，采纳这个改进。请你安排。」（2026-11-27）即批准。
> 本 change 的批准边界：沿用 `add-harness-message-withdraw-nov26` 的全部既有语义（只撤回最近一条、
> 工具二次确认、派生检测、恢复栅栏、删除 A / 发布 B / 失败回滚、composer 回填），只把「来源闸」
> 向**恢复出来的普通交互会话**打开；cron / 自动唤醒 / 子运行仍禁止；按钮可发现性（hover 透明）
> 不扩 scope。

## Why

### 现状

撤回最近一条用户消息（`add-harness-message-withdraw-nov26`）只对**本进程发起的交互轮 / 重试轮**
开放：撤回目标来自两个纯内存字段——`Session::last_turn_origin` 与 `Session::withdraw_target`
（`src-tauri/src/harness/session.rs`，字段注释明写「不落盘、不进 wire；重启后会话本就清空」）。
恢复出来的会话这两个字段恒为 `None`，`withdrawable()` 因此恒 `false`：用户最自然的用法——
「把上次那段对话恢复回来，把最后那句错话撤掉」——今天做不到。

### 为什么不能靠现有记录推断

留存里的用户项只有标准 Responses 形状（`role=user` + content parts）。后台通知走
`subagents::insert_notice_message`，同样以 `session::user_item(text)` 压进 input（`subagents.rs`），
与真实用户消息**同形**；压缩摘要项也是 `session::user_item`（`run.rs`）。唯一差别是通知正文末尾
拼了 `[lumir:auto_notice …]` 文本标记——用正文匹配判来源就是「靠文本猜」，通知正文里出现同串
（引用、转述）即误判，且无法覆盖 cron / 自动唤醒的其它注入。**现有记录不足**。

### 最小、明确的来源证据

本仓已有「用户项本地字段」先例：`lumir_skill_trace` / `lumir_skill` / `lumir_label` 只活在会话
`input` 与 `llm_request.messages` 里，`attachments::expand_image_refs_from` 在 provider wire 前
整体剥除。本 change 用同一纪律给交互用户项加一个机器标记 `lumir_user_origin: "interactive"`：
写入点唯一（交互发送 / 重试轮的入队点，来源闸与撤回同一判据），随 `llm_request.messages` 与
`withdraw_seed` 持久化，恢复时据此重建撤回目标。**旧记录没有该标记 ⇒ 没有可撤回目标（安全拒绝），
不伪造、不补写**。

## What Changes

1. **来源标记**：交互发送 / 重试轮入队时在用户项上写 `lumir_user_origin=interactive`；cron /
   自动唤醒 / 子运行轮不写（同一 `TurnOrigin` 判据）。该字段进留存、进 `withdraw_seed`，
   provider wire 前剥除。
2. **恢复期重建目标**：`resume_session` 从灌回的 input 取**最后一条带标记的 user 项**及其在重建
   面板里的行下标，作为该会话的「恢复撤回目标」；没有标记、命中项没有面板行、历史被压缩替换时
   一律无目标。
3. **来源闸两档**：本进程的交互 / 重试轮（入队下标，既有行为）；或「恢复出来且本进程**尚未跑过
   任何轮**」时的恢复目标。本进程一旦跑过任何轮，轮次来源优先——cron / 自动唤醒 / 子运行轮仍
   拒绝，旧恢复目标不得复活。
4. **删除目标**：恢复件撤回时被删除的是**恢复来源 A 的留存**（恢复本身尚未发布任何轮次，当前
   会话没有自己的文件）；B 的 `restored_from` 指向 A；删除 A 之前先释放本会话对 A 的恢复占用，
   再按既有栅栏与派生检测复核。
5. **复活边界**：沿 A 的 `restored_from` 祖先链确认没有更早的留存仍包含被撤回的那条消息；命中
   即拒绝（`harness_withdraw_copy_exists`），不静默留副本；祖先不可读按扫描失败 fail closed。
6. **前端**：`SessionResumeInfo` 增 `withdrawable`——恢复回执直接驱动撤回钮可见性（此前恢复后
   不重取 `harness_state`，钮要等下一次快照才出现）。
7. **规格**：MODIFIED `harness` 的「撤回最近一条用户消息」一条 requirement（整条复制后改来源闸 /
   目标 / 删除目标三段，并补恢复路径场景）。

## Non-goals

- 不做任意历史消息撤回（仍只最近一条）；不做「撤回后自动重发」、不做多级 undo。
- 不改 `add-harness-message-withdraw-nov26` 的其它语义：两段式工具确认、派生检测、恢复栅栏、
  A/B 删除与回滚、composer 回填、事件令牌全部原样沿用。
- 不给旧记录补写来源标记、不做数据迁移；没有标记的旧会话就是不可撤回。
- 不改按钮可发现性（hover 才显形、透明的小圆钮）；不新增撤回入口。
- 不改恢复算法本身（仍取最后一条会话轮次 `llm_request`；只多一处目标重建的读取）。
- 不级联删除恢复来源之外的会话；祖先链里仍有副本时拒绝，而不是顺手删掉它们。

## Impact

- **spec**：`harness` 1 条 MODIFIED requirement（无 ADDED）。
- **代码**：
  - `src-tauri/src/harness/turn.rs`：`TurnOrigin::is_interactive`（来源判据单一出口）、
    `lumir_user_origin` 常量与入队写入点。
  - `src-tauri/src/harness/session.rs`：`restored_withdraw_target` 字段、`WithdrawSource`、
    `withdraw_source()` / `withdrawable()`、压缩 / 历史替换时清目标、恢复占用释放口。
  - `src-tauri/src/harness.rs`：`resume_session` 的目标重建与 `SessionResumeInfo.withdrawable`；
    `withdraw_last_turn` 的来源闸两档、恢复件的删除目标与祖先链副本检测。
  - `src-tauri/src/harness/attachments.rs`：wire 前剥除新本地字段。
  - `src/bindings/**`：ts-rs 重导出。
  - `src/harness-panel.ts`：恢复回执落地时写 `withdrawable` 并重施撤回钮。
- **错误码**：新增 `harness_withdraw_copy_exists`（文案 D1088，双表同步）。
- **验收**：新增真机场景 887（恢复 → 撤回 → 再恢复不复活）；复用 882 的撤回判据口径。

## 节点 2：归档记录

（实现完成后由 tower 按五要件填写；真机 887 由主会话执行。）
