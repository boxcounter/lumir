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
>
> **节点 1 补充批准（范围裁决，2026-11-27）**：K3 终审提出 0.20 存量会话（无
> `lumir_user_origin` 标记）是否也开放后，Alex 先问「为什么 `role=user` 不能区分」；答复指出
> `role=user` 只是消息角色、不是**身份来源**——后台通知、cron / 子运行注入与压缩摘要项都以
> `role=user` 进 input，与真人发言同形（判定细节见下节「为什么不能靠现有记录推断」）。Alex 随后
> 明确裁决：**采纳「只允许升级后的新消息」**——0.20 及更早、没有来源标记的存量会话恢复后仍不可
> 撤回；**不采用**「旧记录显式认领」、**不采用**「非破坏性分叉」。该范围由此成为本 change 的
> 批准口径（见「范围裁决」一节），不再是待裁事项。

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
`withdraw_seed` 持久化，恢复时据此重建撤回目标。

**该标记只覆盖升级之后新写入的交互消息**（节点 1 补充批准的范围口径）：0.20 及更早的存量会话
没有这个标记，现有留存也不足以安全地自动区分「真人发言」与「cron / 子运行注入」，因此它们恢复
后仍然不可撤回。本 change **不覆盖**原始 0.20 场景，MUST NOT 被读成「存量会话已可撤回」。

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
   会话没有自己的文件）；B 的 `restored_from` 指向 A。占用检查 SHALL **排除本会话自己那一份**
   而 MUST NOT 提前释放它——撤回中途失败（发布 / 删除 / 派生 / 祖先链 / 回滚）时本会话仍会用
   内存里的旧历史，占用必须保留到成功换出（旧 `Session` 被 drop）为止（K3 P1-2）。随后按既有
   栅栏与派生检测复核。
5. **复活边界**：沿 A 的 `restored_from` 祖先链确认没有更早的留存仍包含被撤回的那条消息；命中
   即拒绝（`harness_withdraw_copy_exists`），不静默留副本；祖先不可读、链出现环或超过深度上限
   一律按扫描失败 fail closed（MUST NOT 当作「扫完为空」继续删除，K3 P2）。
6. **前端**：`SessionResumeInfo` 增 `withdrawable`——恢复回执直接驱动撤回钮可见性（此前恢复后
   不重取 `harness_state`，钮要等下一次快照才出现）。
7. **规格**：MODIFIED `harness` 的「撤回最近一条用户消息」一条 requirement（整条复制后改来源闸 /
   目标 / 删除目标三段，并补恢复路径场景）。

## Non-goals

- 不做任意历史消息撤回（仍只最近一条）；不做「撤回后自动重发」、不做多级 undo。
- 不改 `add-harness-message-withdraw-nov26` 的其它语义：两段式工具确认、派生检测、恢复栅栏、
  A/B 删除与回滚、composer 回填、事件令牌全部原样沿用。
- 不给旧记录补写来源标记、不做数据迁移；**0.20 及更早的存量会话（无标记）恢复后仍不可撤回**
  ——这是节点 1 补充批准的范围（只允许升级后的新消息），不是待办；不采用「旧记录显式认领」、
  不采用「非破坏性分叉」。
- 不改按钮可发现性（hover 才显形、透明的小圆钮）；不新增撤回入口。
- 不改恢复算法本身（仍取最后一条会话轮次 `llm_request`；只多一处目标重建的读取）。
- 不级联删除恢复来源之外的会话；祖先链里仍有副本时拒绝，而不是顺手删掉它们。

## 范围裁决：只允许升级后的新消息（节点 1 补充批准）

**裁决**：可撤回范围 = 升级后新写入、带 `lumir_user_origin=interactive` 标记的交互消息。
0.20 及更早的存量会话（无标记）恢复后仍不可撤回；不采用「旧记录显式认领」，不采用「非破坏性
分叉」。

**为什么不能放宽到全部旧记录**（K3 终审 P1-1 的事实基础，支撑该裁决）：

- `session_open.opened_from` 只表达文件边界（new / reset / compact / restore），不表达交互 /
  cron / 子运行来源；
- `llm_request` 由三类来源共用，记录里没有轮次来源字段；
- 后台通知与压缩摘要项都以 `role=user` 进入 input，与真人发言同形——`role=user` 是消息角色，
  **不是身份来源**；
- `cron-state.json` 的 session id 不是完整历史证明，不能据此排除全部旧 cron 会话；
- 正文匹配已被排除（引用 / 转述同串即误判），不能作为补救。

因此「严格禁止 cron / subrun」与「自动开放全部无标记旧记录」在现有证据下不能同时保证。被否决
的两条路线及其代价（显式认领需要用户确认、且认领项不得补写字段；非破坏性分叉会改变「删除 A、
不得留副本」的既有合同）保留在 git 历史的返修记录里，不再作为本 change 的待选项。

**后果（如实登记，不掩饰）**：触发本次需求的原始 0.20 会话仍不可撤回；升级后在该会话里再发一条
消息，那条新消息本身带标记（可撤回），更早的消息仍不可。放宽存量范围需要新的裁决与新的 change。

## Impact

- **spec**：`harness` 1 条 MODIFIED requirement（无 ADDED）。
- **代码**：
  - `src-tauri/src/harness/turn.rs`：`TurnOrigin::is_interactive`（来源判据单一出口）、
    `lumir_user_origin` 常量与入队写入点。
  - `src-tauri/src/harness/session.rs`：`restored_withdraw_target` 字段、`WithdrawSource`、
    `withdraw_source()` / `withdrawable()`、压缩 / 历史替换时清目标、占用的「排除自身」读数
    （`foreign_resume_claim_count`，不提前释放）。
  - `src-tauri/src/harness.rs`：`resume_session` 的目标重建与 `SessionResumeInfo.withdrawable`；
    `withdraw_last_turn` 的来源闸两档、恢复件的删除目标与祖先链副本检测。
  - `src-tauri/src/harness/attachments.rs`：wire 前剥除新本地字段。
  - `src/bindings/**`：ts-rs 重导出。
  - `src/harness-panel.ts`：恢复回执落地时写 `withdrawable` 并重施撤回钮。
- **错误码**：新增 `harness_withdraw_copy_exists`（文案 D1088，双表同步）。
- **验收**：新增真机场景 887（恢复 → 撤回 → 再恢复不复活）；复用 882 的撤回判据口径。

## 节点 2：归档记录

**归档前（2026-11-27）**：

1. **方案已批准**：节点 1 于 2026-11-26 通过（Alex「好，采纳这个改进。请你安排。」）；节点 1
   补充批准（2026-11-27）裁定范围——只允许升级后的新消息（见「评审记录」与「范围裁决」）。
   实现期未扩 scope：K3 终审的三项返修（占用不提前释放、祖先链环 / 超深 fail closed、旧注释
   收口）都落在本 proposal 的合同内。
2. **独立 reviewer clean / merge**：K3 verdict `clean/merge`，绑定 **`0589fa09`**（代码 tip
   `9d4a0e6b`），无开放 P1 / P2 / P3
   （`.local/reviews/withdraw-restored-user-message-nov27/k3-verdict.md`）。verdict 明确：
   `4e9802f1` 只调整真机 887 第二句输入目标的跟踪文本，不影响该结论。
3. **tasks 完成**：全部勾选（3.3 真机、5.2 本条、5.3 归档与审计见下）。
4. **门禁与真机证据**：`gate.sh quick` `GATE RESULT: 13/13 PASS（SKIP 0）`（`9d4a0e6b`；
   `.local/missions/withdraw-restored-user-message-nov27/gate-quick-k3-final.log`）；
   `cargo test --lib` 1308 passed / 0 failed（`withdraw_tests` 29/29）、`pnpm test` 2157/0、
   docs-check / `validate --all --strict`（39 passed）/ `acceptance --check`（311 场景）全 PASS。
   **真机 887：PASS，17 条 PASS（12 条断言 + 5 张截图证据）**（2026-11-27，
   `.local/acceptance/2026-11-27-withdraw-restored-r2/887-harness-withdraw-restored-session/`，
   `status.txt` = PASS）。首轮 `.local/acceptance/2026-11-27-withdraw-restored/` 在
   `typeInNode` 的目标跟踪上 FAIL（旧断言把 composer 目标写成 `问点什么|q887-RESTORE-A`，
   而第二句已完整输入、目标在注入过程中从 AX 消失），`4e9802f1` 只改场景 target（一行），
   复跑 r2 PASS——产品行为未改。
5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（9 份 delta /
   8 条 MODIFIED / 156 段，0 静默丢段）；`validate --all --strict` 39 passed / 0 failed；
   归档跟踪队列有且仅有一条本 change 条目（`docs/backlog.md` 的「归档跟踪队列」）。

**归档后（2026-11-27）**：待归档提交后填写。
