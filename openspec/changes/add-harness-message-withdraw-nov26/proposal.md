# Proposal: harness 撤回最近一条用户消息（删除原会话、只留撤回点开始的新会话）

- Change ID: `add-harness-message-withdraw-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（需求 / 裁决），AI agent（起草与实现）

> **评审记录**
> 节点 1（提案评审）：**通过**。Alex 对调查方案其余部分无异议，并明确了两件事的原话——
> 「我允许明确删除 A」「你可以安排实现了」（2026-11-26）。本 change 的批准边界：
> - 只撤回**最近一条**用户消息；在途先停止；
> - 成功后**明确删除**原会话 A 的 JSONL，默认列表只剩新会话 B（不保留 / 不隐藏 A、不做 A/B 双份
>   展示）；
> - 若 A 已有任何派生 / 恢复会话，拒绝撤回（不级联删除、不静默保留 A）并给用户明确原因；
> - 若删除 A 失败，撤销新建的 B 并保留 A——任何失败都不能先丢 A、不伪造成功；
> - 已执行工具副作用不回滚；有工具时二次确认并列出工具名；
> - 停止 ≠ 撤回；视觉删除 ≠ 上下文撤回。
>
> 节点 2（归档评审）：待真机场景 882 执行 PASS 后按常规通道办理（本轮不执行真机）。

## Why

### 现状

harness 的对话面板没有用户消息的删除 / 编辑 / 重发入口：发出去的内容只能留在 transcript 与
模型上下文里，唯一相关动作是「停止」——它的语义是「不再继续」，已产出的半截正文、用户消息
与工具调用都留在会话里（`session.rs` 的 `abort_requested` 注释与 `turn.rs` 的 `abort_turn`）。
现实里最常见的错误是「把没编辑完的内容发出去了」，用户要的是「把这句话拿回来改」而不是
「让模型别再说了」。

### 为什么不能只做视觉删除

模型上下文由会话 `input` 逐字节决定（`build_request` 直接取 `session.input`，
`llm_request_payload` 原样记进 `messages`），面板只是它的一个投影。只把消息从 DOM 里移除，
下一条请求仍然带着它——模型照样看见，等于没撤回。

### 为什么是「新会话 B + 删除 A」

- **结构性保证**：撤回后的内容物理上不在 B 的文件里，「不会再进上下文」不依赖每个读者都记得
  某条规则（同族陷阱见 REVIEW.md「同一语义两处真源」条）。
- **不改写旧文件**：A 的 JSONL 是 append-only 的审计事实；本 change 直接删除它（Alex 裁决），
  不做原地截断、不写撤回标记。
- **复用恢复机制**：B 的 `session_open` 沿用 A 的 `system` / `assembly`，标题按 `session_title
  inherit` 继承，用量 / 缓存 / 子运行种子落进首行——与 `resume_session` 同一套装配序列。

## What Changes

1. **撤回命令**（`harness_withdraw`）：撤回最近一条用户消息及其后全部轮次。两段式——
   `confirm=false` 时若该轮执行过工具，**什么都不做**、只回执工具名；`confirm=true` 才执行
   （全部校验与派生检测重新复跑）。
   **目标只认入队时记录的那条交互用户消息**（input / panel 两份下标）；该轮之后混入后台通知
   （blocked / 触顶分支的 user 项）时拒绝（`harness_withdraw_tail_notice`），不吞通知、不把
   通知当目标、也不跳过工具确认。
2. **新逻辑会话 B**：`opened_from=withdraw`、`restored_from=<A>`；**立即发布**（不等首条真实
   请求）。初始记录含 `withdraw_seed`（内存 `input[..i]` 原样搬运，不重新拼装 wire 历史），
   供 `resume_session` 在「没有 llm_request」时回落读取——否则撤回后切走会话再回来，B 会从
   空文件恢复、保留的历史全丢。
3. **删除 A**：B 发布成功且派生复核通过后，unlink A 的 JSONL；失败则删 B、保留 A，回执
   `harness_withdraw_delete_failed`，原会话与输入区不变。**双故障**（删 A 失败且 B 也清理失败）
   回执 `harness_withdraw_rollback_incomplete`：A 保留、B 残留，如实暴露「清单可能多一行」，
   不报干净失败、不声称唯一。
4. **派生检测**：读每个会话留存首行的 `session_open.restored_from`，`restored_from` 链能走回
   A 的任意文件即「派生会话」。动作前与「发布 B 之后、删除 A 之前」各复核一次（第二次排除 B
   自己）；命中即拒绝 / 回滚，不级联删除。**扫描 fail closed**：目录项 / 任一留存首行不可读
   即拒绝（`harness_withdraw_scan_failed`），不跳过候选删 A。**与恢复线性化**：恢复在读取源
   文件前登记进程级占用，撤回从检查到 unlink 全程持同一把栅栏；独立 Runtime 的未发布恢复因此
   不能越过扫描（`harness_withdraw_resume_in_flight`）。
5. **composer 回填**：被撤回的用户消息项（wire content parts）按其序列化文本回填——文本
   （剥掉自动注入的「当前编辑器上下文」节）、引用卡 / 消息摘录卡 / 图片引用、**全部显式
   Skill 名**（成功与被拒 / 不存在都在：名单取 `lumir_skill_trace` 的完整原名 `raw_name` 与
   `lumir_skill` part，去重保序；展示名截断不兼任恢复协议，旧记录缺原名时回落展示名并安全
   降级；正文不回填），光标落在原文末尾；当前输入非空时按「原文在前、当前输入在后」
   合并，不丢用户正在打的字。B 的 `assembly` 读失败 / 缺键时拒绝撤回（`harness_withdraw_read_failed`），
   不伪装成空装配后删 A。
6. **来源闸**：只对本进程发起的交互轮 / 重试轮开放（`TurnOrigin` 记在会话内存态）；cron /
   自动唤醒 / 子运行 / 恢复出来且尚未发言的会话一律拒绝，并给明确原因。
7. **工具副作用如实告知**：本轮出现过的 `function_call` 工具名（去重、按出现序）随确认回执
   返回；文案明确「撤回不会撤销这些操作」。工具副作用本身不回滚。
8. **旧会话事件封闭**：`harness:event` 信封新增 `session_token`（在回合 / 任务开始时定格）；
   前端在记账前按与 `persistence` 相同的准入丢弃退役 / 更旧令牌的事件（含 `subagent_started` /
   `notice` / `title`）。令牌水位**按 vault 分账**（`src/harness-session-tokens.ts`）：不同 vault
   的令牌大小互不相干，切到 token 更小的 vault 时其事件 / 快照先接纳、旧 vault 的旧事件仍拒；
   退役集合全局生效。后端写父会话的通知插入与投递标记比较 hub 的 `parent_token`，A→B 后旧
   hub 的迟到写入一律放弃（blocked 分支回滚 delivered 标记）。
9. **会话清单**：A 删除后只剩 B 一行；B 的 `last_activity_ts` 因谱系断链（dangling parent）回落
   自身创建时刻。B 的会话名在首条真实请求前取自 `withdraw_seed` 的首条用户消息。
10. **规格**：`harness` capability 新增 1 条 requirement（撤回最近一条用户消息），不改既有
   `会话边界` / `会话本地留存` 的整块正文。

## Non-goals

- 不做删除 / 脱敏：撤回后 A 的 JSONL 被删除，但这是一次显式动作；不提供「保留 A 但隐藏」的
  形态，也不提供把 A 的内容从磁盘上擦除的额外保证（文件删除即终点）。
- 不做任意历史消息撤回（只最近一条）；不做「撤回后自动重发」、不做多级 undo。
- 不改写任何既有 JSONL；不给 A 追加撤回标记；不做数据迁移。
- 不回滚任何工具副作用（文件写入、`cli_run`、cron 注册、子运行产出）。
- 不改停止语义（停止仍是「不再继续」）；不改恢复算法（恢复仍取最后一条请求，只多一条
  `withdraw_seed` 回落）。
- 不改权限 / 批准闸；不新增模型侧工具（模型不能自己撤回用户消息）。
- 不改会话清单排序口径与「一行一文件」规则；不为撤回新增清单字段。

## Impact

- **spec**：`harness` 1 条 ADDED requirement；不修改既有 requirement 的正文（无 MODIFIED
  整块替换的丢段风险）。
- **代码**：
  - `src-tauri/src/harness.rs`：`Runtime::withdraw_last_turn`、派生检测、撤回回执类型、
    `harness_withdraw` 命令；`resume_session` / `first_user_text` 的 seed 回落。
  - `src-tauri/src/harness/session.rs`：`last_turn_origin` / `withdraw_target` / `withdrawable()`
    / `cache_totals()` / `panel()`；进程级恢复占用表与栅栏（`claim_resume` / `lock_resume_fence`）；
    快照 `withdrawable`；`SessionWithdrawInfo` / `WithdrawnComposer` / `WithdrawOutcome`。
  - `src-tauri/src/harness/events.rs` / `turn.rs` / `title.rs` / `subagents.rs`：事件信封的
    `session_token`；旧 hub 的 `parent_token` 写入闸。
  - `src-tauri/src/harness/jsonl.rs`：`publish_now`、`read_session_open`、
    `withdraw_seed_payload` / `withdraw_seed_messages`。
  - `src-tauri/src/harness/turn.rs`：轮次来源记录。
  - `src-tauri/src/lib.rs`：命令注册。
  - `src/harness-panel.ts` / `harness-composer.ts` / `harness-panel.css` / `ipc.ts` /
    `copy-data.ts`：撤回钮、二次确认条、composer 投影与合并、文案。
- **视觉**：撤回钮 hover 才显形、落在复制钮左侧；非 hover 帧零像素变化（预期基线不动，仍跑
  本地 `gate.sh visual`）。
- **错误码**：`harness_withdraw_not_applicable` / `_tail_notice` / `_nothing` / `_derived_exists` /
  `_resume_in_flight` / `_scan_failed` / `_read_failed` / `_publish_failed` / `_delete_failed` /
  `_rollback_incomplete` / `_failed`（文案 D1039–D1049）。
- **验收**：新增真机场景 882（撤回三层判据 + A 删除的 glob 判据）；Rust 单测 16 条、子代理 1 条、
  事件信封 1 条、前端单测 8 条、真面板 chromium 4 条。

## 节点 2（归档前填写）

待实现批收尾按 `docs/process/openspec-workflow.md` 的五要件填写：节点 1 依据、reviewer verdict
与绑定 tip、tasks 完成数（真机 882 执行项待验收批）、门禁输出行与证据目录、delta 对账三项读数。
