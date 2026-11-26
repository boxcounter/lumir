# Design: 撤回最近一条用户消息

- Change ID: `add-harness-message-withdraw-nov26`
- 性质：实现设计（原子顺序、落盘形状、前端投影、判据）。事实锚点以代码现状为准。

## 1. 语义分层

| 层 | 本 change 的做法 | 不是 |
|---|---|---|
| 停止生成 | 复用 `harness_abort`（「不再继续」） | 不是撤回：半截正文与用户消息都留在会话里 |
| 从模型上下文撤回 | B 的 `input` 物理上不含该消息及其后项 | 不是仅移除 DOM |
| 从显示历史撤回 | 前端重放 B 的面板（截断点之前） | 不是把消息置灰 / 折叠 |
| 恢复 composer | 被撤回项的序列化文本 + 卡片 / 图片引用 / Skill 名回填，光标在末尾 | 不是复制到剪贴板 |

## 2. 取数与前提（事实）

- `build_request` 直接取 `session.input` 作为 `request.input`（`turn.rs`），`llm_request_payload`
  原样记进 `messages`——**内存 `input` 就是 wire 的唯一事实源**，撤回不需要读 A 的文件。
- 面板与 `input` 同源：面板里最后一条 `role="user"` 对应 `input` 里最后一条 `role=="user"`。
- 撤回只在 **idle** 执行：`is_busy()`（含 `Finishing`）为真即拒绝；待批必然 busy。
- 用户消息项的形状：`input_text` / `input_image`（`lumir-attachment://<name>` + `lumir_label`）
  / `lumir_skill` part（正文只在 wire，`panel_text_of_content` 跳过）；「当前编辑器上下文」节
  附在最后一个文本 part 末尾，用 `turn::strip_context_section` 剥掉。

## 3. 原子顺序（任何失败都不先丢 A）

```
锁内：
 1. 校验：会话存在 / idle / last_turn_origin ∈ {Interactive, Retry} / 找到最后一条 user 项
 2. tool_names = 该项之后出现的 function_call 名（去重、出现序）
 3. confirm=false 且 tool_names 非空 → 直接返回 needs_confirmation（零副作用）
 4. 派生会话初检（restored_from 链 → A）→ 命中即拒绝
 5. 取前缀 prefix = input[..i]、被撤回项、面板截断点、system / assembly / 读数种子 / 标题
 6. create_restore(B) + publish_now()：session_open + title inherit + withdraw_seed
      └ 失败：返回（A 一个字节没动）
 7. 派生会话复核（排除 B）→ 命中或扫描失败：删 B 文件、返回错误（A 原样）
 8. unlink A 的 JSONL
      └ 失败：删 B 文件、返回 harness_withdraw_delete_failed（A 仍是当前会话）
 9. sessions.insert(B)、pending_open 清理 → 旧 Session 被 drop（hub.shutdown）
10. 返回 SessionWithdrawInfo（B 身份 + 保留面板 + composer 素材 + 标题 / 首条消息）
```

**发布之后的任何失败都回滚 B**：派生复核（含目录读取失败）与 unlink A 包在同一个「失败即删 B」
的作用域里——不留孤儿会话。第二次派生复核与 unlink 之间没有其它可失败的步骤。

**为什么先 unlink A 再换入 B**：删除失败时 A 的内存态与文件都还在，就地删 B 即可回滚——不需要
从文件重新恢复 A（那会引入第二次失败面）。A 的 writer 仍开着文件不阻止 unlink（POSIX）；换入
之后 `Drop` 关闭它。

**为什么没有「先丢 A」的窗口**：A 的唯一销毁点是第 9 步的 `insert` 覆盖；第 8 步失败已提前返回。

## 4. 落盘形状

B 的首行 `session_open`：

```
kind=session_open, session_id=B, vault_root=<scope>,
opened_from="withdraw", restored_from=A,
provider/model/wire_api=当前配置, thinking=会话内存值,
system=A 的内存 system 全文, assembly=A 文件首行的装配清单,
usage/cache_totals/subrun_usage/subrun_runs=撤回时点种子
```

首行之后的 `initial_records`：

1. `session_title {decision:"inherit", title}`（A 有标题时）；
2. `withdraw_seed {messages:[…]}` —— 内存 `input[..i]` 原样切片。

读取侧（最小扩展，两处）：

- `resume_session`：没有会话轮次 `llm_request` 时，`messages = withdraw_seed.messages`、
  档位回落 `session_open.thinking`；`restored_messages_ts` 为空表 ⇒ 这些消息无时间读数
  （不伪造——`restored_panel_messages` 对缺表记 0 = 不显示）。
- `first_user_text`：没有 `llm_request` 时从 seed 的首条 user 消息取首段——B 在清单里的名字
  因此与 A 一致，不回落成「新会话」。

**为什么不复制 A 的记录、也不提前写一条假请求**：复制记录等于从旧文件重拼历史；假请求会污染
`llm_request` / `first_user_text` / 活动时间。seed 只搬运内存里那份权威数组，且只被恢复路径读。

## 5. 派生会话检测

- 素材：每个留存文件**首行** `session_open`（新增 `jsonl::read_session_open`，只读首行）。
- 判据：`restored_from` 非空、非自指；从每个文件沿父链走（`visited` 防环、深度上限 256），
  能走到 A 即派生。
- 不可读文件跳过并打一条 stderr：它本身无法被恢复（`read_session_file` 也会失败），不构成可用
  的派生会话；把它当「可能有派生」会让一份损坏的无关文件永久堵死撤回。
- 两次复核：动作前（无排除）与「发布 B 后、删除 A 前」（排除 B）。第二次与 unlink 在同一把
  sessions 锁内，跨 Runtime 的外部恢复（如 cron 专用会话）若在两次之间落地会被第二次拦住；
  扫描与 unlink 之间的残余窗口是毫秒级，登记为已知边界。
- 命中回执：`harness_withdraw_derived_exists`，参数 `sessions` = 派生 id 列表；不级联删除、
  不静默保留 A。

## 6. 删除 A 的口径

- 目标路径由 A 的 writer 文件名派生（`sessions/<vault id>/<A>.jsonl`）；不存在视为已达成
  （例如 A 的留存从未落盘）。
- 不读 A 的文件做归属校验：A 就是当前会话，路径来自它自己的 writer。
- 删除后 A 不再出现在清单里；B 的 `restored_from` 因此成为 dangling parent——按现有口径，
  `chained_activity_ts` 在缺父处停止，B 的活动时间回落自身创建时刻（排在清单上方）。

## 7. 来源闸与并发

- `Session.last_turn_origin: Option<TurnOrigin>` 在 `run_turn_core` 真正开跑时写入；起线程失败
  不写（不会把上一轮来源冒充成这一轮）。撤回只接受 `Interactive` / `Retry`。
- 收回执后前端先做 vault + `viewGeneration` 双守卫（与 `resumeSession` 同款），迟到回包丢弃。
- 自动命名任务带 `session_id` 四项复核（`title.rs`），fork 换 id 后旧任务自然 `Dropped`。
- 旧 `Session` 被 drop → `hub.shutdown()`：后台子运行 / 待唤醒一并收口；已完成子运行的产出
  与 sidecar 留在 A（随 A 删除），B 的会话只带 `subrun` 种子。
- 事件信封只有 `vault`，没有回合级 token 准入；撤回要求 idle，回合线程已收口，残留面是
  `hub.shutdown()` 后可能有一拍的子运行事件——前端在撤回重放后清空 run 集合，未知 run_id
  不建行（真机场景 882 与既有 724/878 路径共同覆盖）。

## 8. 前端

- **撤回钮**：最后一条用户消息 hover 浮现（与复制钮同位形，右侧 30px），读屏名 D1034；
  非 idle 置灰并提示 D1035。可见性由快照 `withdrawable` 决定（只做可见性，判定在后端）。
- **二次确认**：`needs_confirmation` 时在消息下方插一行确认条（D1036 列工具名 + D1037 / D136），
  确认后以 `confirm=true` 再调一次。
- **回填**：`composerContentFromMessage(text, skills)` 是 `projectDelivery` 的逆——卡片行拆回
  块、段落还原 XML 实体（`parseQuoteMessage` 本身不还原段落，这里必须补一次，否则改完再发会
  把 `&lt;` 二次转义）、卡片锚点与 `composerBlocks` 的「卡片前去掉一个换行」互逆、Skill 位置
  按 `/name` 首次出现还原。
- **合并**：`mergeWithdrawnComposerContent` 与发送拒绝的 `mergeRejectedComposerContent` 共用
  同一份核心（原文在前、当前在后；卡片 / Skill 偏移平移），差别只在补一个换行、光标落原文末尾。
- **成功**：`resetView` + 重放 B 的面板 + 更新 persistence token / 标题 / 首条消息 + 刷新读数与
  任务区 + `resetComposer(合并结果)` + `markDraft()` + toast D1038。

## 9. 错误码

| code | 时机 | 副作用 |
|---|---|---|
| `harness_busy` | 在途 / 待批 / `Finishing` | 无 |
| `harness_no_session` | 空会话 | 无 |
| `harness_withdraw_not_applicable` | 非交互来源 / 恢复出来尚未发言 | 无 |
| `harness_withdraw_nothing` | `input` 里没有 user 项 | 无 |
| `harness_withdraw_derived_exists` | 派生会话在场（两次复核任一） | 无（第二次命中时已删 B） |
| `harness_withdraw_publish_failed` | B 的序列化 / 发布失败 | 无（A 未动） |
| `harness_withdraw_delete_failed` | unlink A 失败 | B 已删、A 保留 |
| `harness_withdraw_failed` | 会话没有可用 session id（兜底） | 无 |

## 10. 判据（测试与证据）

- Rust（`harness/withdraw_tests.rs`，10 条）：前缀 / 面板截断；A 删除 + B 唯一 + seed 不含被
  撤回文本；切走再恢复 B 得到同一前缀；两段式确认零副作用；busy / 待批拒绝；来源闸拒绝；
  派生拒绝（含参数）；**删除失败回滚 B 且 A 仍是当前会话**；composer 素材（图片 / Skill / 剥
  上下文节）；标题 / 用量种子 / `withdrawable` 归零；重复点击幂等；会话令牌变化。
- 前端（`tests/unit/harness-withdraw-composer.test.ts`，7 条）：实体还原、卡片锚点（行首 /
  中间 / 连续 / 末尾）、Skill 位置、合并顺序与光标。
- 真机 882：三层判据（transcript 节点在场性翻转、composer 值在场、最新 JSONL `not` + 
  `opened_from":"withdraw"` + 会话目录 `glob exact:1`）。
- 门禁：`cargo test --lib`、`pnpm test`、`tsc --noEmit`（根与 `tests/visual`）、
  `gate.sh quick`、`gate.sh visual`（结构层）、`docs-check`、`openspec validate --all --strict`、
  `acceptance --check`。

## 11. 风险与已知边界

1. **残窗**：派生复核与 unlink 之间毫秒级；跨 Runtime 的外部恢复若恰在此窗口落地会留下 dangling
   子会话。登记为已知边界（第二次复核已把窗口压到同一把锁内）。
2. **A 的审批 / 中断 sidecar 随 A 删除**：B 只带 `subrun` 种子与标题；被保留轮次的 `approval`
   决策在 B 的恢复路径上不可见（与 `resume_session` 既有的保真度缺口同口径）。
3. **空前缀**：撤回唯一一条用户消息时 B 的 seed 为空，B 在首条真实请求前没有名字素材（清单
   显示「新会话」）；下一次发送后按新消息取名。
4. **时间读数**：B 的 seed 消息在恢复后无相对时间（不伪造）；只在「切走 / 重启后从 B 恢复」
   时可见，撤回当场的面板保留原 ts。
5. **图片尺寸**：wire 不带 `width/height`，回填的图片卡只显文件名（与恢复路径同保真度）。
6. **文件删除的不可逆性**：删 A 之后无法从产品内恢复（这正是 Alex 裁决的形态）；不做回收站。
