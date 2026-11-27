# Design: 恢复出来的旧会话也能撤回最近一条真实用户消息

- Change ID: `withdraw-restored-user-message-nov27`
- 性质：实现设计（来源证据的形状、恢复期目标重建、删除目标与复活边界、判据）。
- 事实锚点以代码现状为准（基线 `2e6d5e17`）。

## 1. 事实与前提

- 撤回当前只认两个**内存态**字段：`Session::last_turn_origin`（只接受 `Interactive` / `Retry`）与
  `Session::withdraw_target`（入队时的 input / panel 双下标）。两者的字段注释都写明「不落盘、
  不进 wire」——恢复出来的会话因此 `withdrawable()` 恒 `false`。
- 留存里的用户项只有标准形状（`{"role":"user","content":[…]}`）：
  - 后台通知：`subagents::insert_notice_message` → `session::user_item(text)`（与用户消息同形），
    正文末尾拼 `[lumir:auto_notice …]`；
  - 压缩摘要项：`run.rs` 的压缩落点同样用 `session::user_item`；
  - cron 的交互槽也走 `run_turn_core_with_mode` 的 `TurnInput::User` 入队路径（只是
    `TurnOrigin::Cron`）。
  结论：**留存里没有任何现成字段能区分「用户发出的那一句」与「系统注入的 user 项」**；正文标记
  不是判据（正文里出现同串即误判）。
- 本仓已有「用户项本地字段」先例：`lumir_skill_trace`（用户项顶层）、`lumir_skill` / `lumir_label`
  （content part），都只活在会话 `input` 与 `llm_request.messages`，由
  `attachments::expand_image_refs_from` 在 provider wire 前剥除。
- 恢复是**惰性发布**：`resume_session` 只把 `session_open` 挂在 `pending_open`，首次真实
  `llm_request` 才落盘（`JsonlWriter::create_restore` / `pending_restore_source`）。恢复后未发言
  的会话**没有自己的文件**。

## 2. 来源证据：`lumir_user_origin`

| 项 | 取值 |
|---|---|
| 字段 | 用户项顶层本地字段 `lumir_user_origin`（`turn::USER_ORIGIN_FIELD`，唯一字面量来源） |
| 值 | `"interactive"`（只有这一种） |
| 写入点 | `run_turn_core_with_mode` 的 `TurnInput::User` 入队块，条件 = `origin.is_interactive()`（`Interactive` / `Retry`） |
| 不写入 | cron（含交互槽）、自动唤醒（`Preloaded` 不入队）、子运行（`TurnOrigin::Subrun`）；压缩摘要项不带 |
| 持久化 | 进 `Session.input` → 每条 `llm_request.messages`；撤回 fork 的 `withdraw_seed` 原样搬运 |
| 剥除点 | `attachments::expand_image_refs_from`（与 `lumir_skill_trace` 同一处、同一纪律）——provider 永不看见 |

为什么放在**入队点**而不是 `session::user_item`：`user_item` 同时服务通知 / 压缩 / 标题素材，
在那里打标会把系统注入项也标成交互消息。入队点是唯一能同时拿到 `TurnOrigin` 与「这就是用户
这一句」的地方。

为什么不新增 sidecar 记录（如 `{"kind":"user_turn","index":N}`）：下标在压缩 / 恢复 / 撤回 fork
之间不可移植，跟随后移的消息项本身才是唯一稳定载体；且 sidecar 与 messages 的一致性需要第二套
对齐逻辑（REVIEW.md「同一语义两处真源」条）。

## 3. 恢复期重建目标

`resume_session` 在重建面板时同时产出「input 下标 → 面板行下标」的映射（`restored_panel_messages`
的唯一实现返回两份，旧签名保留为薄包装）：

```
重建逻辑（纯函数）：
  1. last = input 里最后一条 role=user 且 lumir_user_origin=interactive 的项下标
  2. 该下标没有对应面板行（内容为空 / 非文本图片混合形态）⇒ 无目标
  3. 否则 WithdrawTarget { input: last, panel: <映射值> }
```

- 目标只挂在 `Session::restored_withdraw_target`，**不写 `last_turn_origin`**：后者仍是「本进程真正
  开跑的轮次来源」，恢复不是一次轮次。
- 没有标记（本 change 之前的旧记录）、历史被压缩替换（只剩摘要项）、命中项没有面板行 ⇒ 无目标；
  快照 `withdrawable=false`，命令层安全拒绝。**MUST NOT 给旧记录补写标记、MUST NOT 按正文猜。**
- 恢复通知（`restored_notices`）在面板重建之后追加，落不进映射；它们因此永远不会成为目标，且在
  撤回时由既有尾部检查拦住（见 §5）。

## 4. 来源闸：两档与优先级

`Session::withdraw_source() -> Option<WithdrawSource>`：

| 本进程轮次来源 | 取值 |
|---|---|
| `Some(Interactive / Retry)` | `Turn(withdraw_target)`；target 为空（压缩 / 替换）⇒ `None` |
| `None`（恢复后尚未跑过任何轮） | `Restored(restored_withdraw_target)`；无目标 ⇒ `None` |
| `Some(Cron / Subrun / AutoWake)` | `None`——**恢复目标不得越过来源闸复活** |

`withdrawable()` 即 `withdraw_source().is_some()`（快照与命令共用同一判据）。命令层对三类拒绝给
不同原因：非交互轮 → `harness_withdraw_not_applicable`（cron / 自动唤醒 / 子运行）；无来源且无目标
→ `harness_withdraw_not_applicable`（旧留存没有来源标记 / 已压缩）；交互轮但目标失效 →
`harness_withdraw_nothing`（既有口径，压缩清理让旧下标失效）。

## 5. 删除目标：恢复件删的是恢复来源 A

`Restored` 来源蕴含「本进程没跑过任何轮」，而落盘只由轮次触发 ⇒ **当前会话没有自己的文件**。因此：

```
delete_id = match source {
    Turn(_)     => 当前 writer 的文件名（既有行为）
    Restored(_) => writer.pending_restore_source()   // 恢复来源 A；缺失 ⇒ harness_withdraw_failed
}
B.restored_from = delete_id        // 谱系指向真实存在过的那份文件
```

- 占用检查在栅栏内**排除本会话自己那一份**（`Session::foreign_resume_claim_count`），MUST NOT 提前
  释放自身的 `ResumeClaim`（K3 P1-2）：撤回中途失败（发布 / 删除 / 派生 / 祖先链 / 回滚）时本会话
  仍可能用内存里的旧历史发布派生文件，提前释放会让独立 Runtime 趁隙恢复并删掉来源，随后本会话
  把被撤回的消息复活。占用保留到成功换出（旧 `Session` 被 drop）为止——失败路径因此天然保留保护，
  不需要逐个错误出口重新登记。
- 派生检测、发布 B、删除 A、失败回滚全部沿用既有实现（含 fail-closed 扫描与双故障终态）。

## 6. 复活边界：祖先链副本检测

恢复来源 A 自己也可能是别的会话的恢复件（`A.restored_from=Z`）。若被撤回的那条消息原本来自 Z，
删掉 A 之后 Z 仍带着它——切回 Z 就是复活。因此在删除 A 之前：

1. 沿 A 的 `restored_from` 链逐层读留存（深度上限 256、`visited` 防环，与派生检测同一手法）；
2. 对每一层的 `llm_request.messages` 做**逐项深比较**，命中被撤回项即「更早留存仍含该消息」；
3. 命中 ⇒ 拒绝（`harness_withdraw_copy_exists`，参数 `sessions` 点名那些留存），A 不删、B 不建；
4. 任一祖先首行 / 记录不可读 ⇒ `harness_withdraw_scan_failed`（fail closed，不跳过）；
5. 链出现环或超过深度上限 ⇒ **同样** `harness_withdraw_scan_failed`（参数 `reason` 为
   `ancestor cycle` / `ancestor depth exceeded`）：剩余链路枚举不完就无法证明没有副本，MUST NOT
   当作「扫完为空」继续删来源（K3 P2）；祖先文件在盘上正常缺失才允许终止（那份留存已不存在）。

逐项深比较而不是正文匹配：比较的是**同一条项**（含 content parts 交错与本地字段），不是「文本
里出现过这串字」。常见情形（A 的最后一条交互消息是 A 自己发的）天然无命中，检查零成本放过。

## 7. 前端

- `SessionResumeInfo` 增 `withdrawable: boolean`（恒在场）：恢复回执落地时与消息重放同一处写入并
  重施撤回钮。恢复流程不重取 `harness_state`（只取读数 / 任务 / 相位），没有这个字段时钮要等下一次
  内容快照才出现——真机场景 887 会在恢复后立刻点它。
- 撤回钮仍只挂最后一条用户消息、可见性仍由后端字段驱动；按钮形态（hover 透明）本 change 不动。

## 8. 拒绝面与错误码

| code | 时机 | 副作用 |
|---|---|---|
| `harness_withdraw_not_applicable` | 非交互轮来源；或恢复会话无来源标记 / 无目标 | 无 |
| `harness_withdraw_nothing` | 交互轮但入队目标已失效 | 无 |
| `harness_withdraw_tail_notice` | 目标之后还有其它 user 项（恢复通知 / 后台通知） | 无 |
| `harness_withdraw_copy_exists`（新） | 恢复来源的祖先留存仍含被撤回项 | 无 |
| `harness_withdraw_failed` | 恢复件的来源身份缺失（不该出现） | 无 |
| 其余 | 与 `add-harness-message-withdraw-nov26` 完全相同 | 同 |

`harness_withdraw_copy_exists` 文案 D1088：中英双表同步（`tests/unit/error-text.test.ts` 的完整性
门禁会扫到新 code）。

## 9. 判据（测试与证据）

- Rust（`harness/withdraw_tests.rs` 扩展；fixture 的 seed 按生产口径打标）：
  1. 恢复后撤回：来源 A 删除、B 唯一、seed 不含被撤回文本、composer 素材正确；
  2. 恢复后切走再恢复 B：前缀在、被撤回文本不在（不复活）；
  3. 旧记录（无标记）恢复：快照 `withdrawable=false`、撤回 `not_applicable`、零文件变化；
  4. 恢复出带尾部通知的会话：撤回 `tail_notice`、通知不被吞；
  5. 恢复后跑过 cron 轮：`not_applicable`，恢复目标不复活；
  6. 恢复来源的祖先仍含该项：`harness_withdraw_copy_exists`、A 不删；
  7. 恢复来源有派生会话：既有派生拒绝照常；
  8. 恢复回执 `withdrawable=true`；
  9. 交互入队项带标记、cron 入队项不带（turn 层单测）；
  10. wire 不含 `lumir_user_origin`（attachments 单测）；
  11. 恢复件撤回失败后占用仍在（删除失败 / 发布失败 / 双故障各一条）；外来 Runtime 在失败后
      恢复并撤回被拒（`harness_withdraw_resume_in_flight`），失败会话被丢弃后才放行（K3 P1-2）；
  12. 祖先链成环 / 超过深度上限：`harness_withdraw_scan_failed` + `reason` 区分，来源不删（K3 P2）。
- 前端：`resumeSession` 落地 `withdrawable`（源码断言测试，与既有的恢复接线条同法）。
- 真机场景 887：恢复 → 撤回 → 再见（见 `scripts/acceptance/scenarios/887-*.md`）。
- 门禁：`gate.sh quick`。

## 10. 风险与已知边界

1. **0.20 及更早的存量会话不可撤回（已裁的严格范围）**：本 change 之前写下的留存没有标记，恢复后
   没有目标。这是**节点 1 补充批准**的范围裁决——只允许升级后的新消息，旧记录的显式认领与非破坏
   性分叉均不采用（问答与依据见 `proposal.md` 的「范围裁决」一节）。它不是待办，MUST NOT 被读成
   「存量会话已可撤回」；升级后在该会话里再发的消息本身带标记（可撤回），更早的消息仍不可。
2. **祖先链拒绝会让少数链式恢复无法撤回**：宁可拒绝并点名留存，也不静默留副本；用户可先删除那些
   旧留存再撤回。
3. **恢复件的撤回是「在来源会话里撤回」**：来源 A 被删除、B 接替；清单里不会同时留着同一段对话的
   旧副本（这正是本 change 要堵的复活口）。
4. **通知 / 自动唤醒仍不可撤回**：与既有语义一致——它们的 user 项不带标记，且恢复后一旦跑过这类
   轮次，来源闸直接拒绝。

## 11. K3 终审返修（2026-11-27）

| 评审项 | 处置 |
|---|---|
| P1-1 0.20 存量不可撤回、现有记录不足 | **已裁（节点 1 补充批准）**：采纳「只允许升级后的新消息」，存量会话仍不可撤回；不采用显式认领 / 非破坏性分叉。proposal 的「范围裁决」一节记录「为什么 `role=user` 不能区分」的问答与依据；节点 2 回到「待真机 887」；design §10.1 同步。 |
| P1-2 失败后永久释放自身恢复占用 | 改为「占用检查排除自己那一份」（`foreign_resume_claim_count`），不提前释放；成功换出时由 `ResumeClaim::Drop` 释放。新增 3 条回归（删除失败 / 发布失败 / 双故障）+ 1 条外来 Runtime 交错用例。 |
| P2 祖先链环 / 深度上限失败开放 | 两种情况改返回 `harness_withdraw_scan_failed`（`ancestor cycle` / `ancestor depth exceeded`），新增 2 条用例；祖先文件正常缺失仍允许终止。 |
| P3 前端过时注释 | `src/harness-panel.ts` 两处「历史恢复不挂撤回钮」改为当前口径。 |
| 集成编号冲突 | rebase 到 `1f0d6556`；验收 item/场景改 **887**、错误文案改 **D1088**（保留 Web 886/886b 与 D1076–D1087）。 |
