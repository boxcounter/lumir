# Design: 查看零写盘与恢复文件的原子首次发布

- Change ID: `avoid-session-restore-duplicates-nov24`
- 日期: 2026-11-24
- 状态: 节点 1 待 Alex（唯一裁决点 D1，推荐 A）
- 视觉: 无原型、无视觉变更，不适用「视觉保真」合同

本设计只描述行为合同与实现边界，不含代码。实现期若发现合同与代码现状冲突，按
`docs/process/openspec-workflow.md` 停下更新提案，不静默扩 scope。

## 1. 现状与问题边界

| 事实 | 现值 | 后果 |
|---|---|---|
| 恢复铸新身份 | `Runtime::resume_session` 无条件 `new_session_id` + `JsonlWriter::create` | 每次点击都产生新行身份 |
| 查看即写 | 有标题写 `inherit`、有通知写 `notice_delivered` | 物理 JSONL 被创建；空源也会落文件 |
| 目录先建 | `vault_sessions_dir` 内部 `create_dir_all`，恢复在读源前调用 | 失败的查看也可能建目录 |
| 非原子 writer | 首条记录 `create_new` 最终文件后逐行写 | 失败留下空 / 半截最终文件 |
| 前端无短路 | 每次点击都调用恢复并 `resetView` | 重复点击 = 重复重置 + 重复重建 |

本 change 只改「查看 / 首次发布」这一段边界。恢复的**内容重建算法**（最后一条会话轮次
`llm_request` + 折叠末尾未入请求的响应，design §6.2 旧算法）、读数重算、标题继承、通知重建、
删除、排序都不变。

## 2. 不变量（实现期 MUST 保持）

1. **一份文件一行**：清单行身份仍是 `session_id`；恢复 / 压缩产生的文件各占一行，不折叠、不去重。
2. **排序只由后端列举产生**：`last_activity_ts` 倒序 → id 倒序 → 无值最后；`sidecar` 不计活动时间。
3. **恢复充分性**：仅凭 JSONL 能逐字节重建任意一轮请求；sidecar 不参与重建。
4. **append-only**：发布成功后的文件只追加；已存在的文件不重写、不截断、不回填。
5. **写失败不阻断对话**：已发布会话的额外写失败只影响健康与日志，不产生用户侧「发送失败」。
6. **compact 身份独立**：`opened_from=compact` 没有 `restored_from`；恢复文件恒 `opened_from=restore`。
7. **删除语义不变**：活跃会话拒删；源行与恢复行各自独立可删。
8. **变更直接切断**：不迁移、不折叠存量；不新增双读 / 双写路径。

## 3. 状态机

后端当前 vault 的会话槽位有三种形态：

```text
Materialized
  当前 writer 对应一份已发布（或正在发布）的文件。
  - session_id == 所点文件 id ⇒ 返回 switched=false（直切，零副作用）
  - 否则需要真正切换（busy 时拒绝）

PendingRestore { source_id, new_id, token, initial_batch, view }
  查看完成、文件尚未发布。
  - 重复点击同一 source_id ⇒ switched=false，复用 new_id / token，不重建
  - 点击另一份历史 ⇒ 校验并读取新源，成功后替换 pending
  - 首次真实 llm_request ⇒ 激活（见 §5）

（无会话 / 新会话）
  既有语义不变。
```

判定顺序（实现顺序即语义）：

1. 解析 vault scope 与 source id；非法 id / 跨 vault 在读取前失败（零文件、零 token 改变）。
2. **先判身份**：所点文件是当前 `Materialized` 文件，或当前 pending 的 `source_id` 与之相同 ⇒
   `switched=false` 直接返回。此判定 MUST 先于 busy 判定——发布失败后的在途轮次里，用户再点
   同一源必须是无害 no-op，而不是 `harness_busy`。
3. 需要真正切换时才判 busy：busy ⇒ `harness_busy`，当前会话与文件完全不动。
4. 读源文件并重建（只读）：失败（不可读 / 缺 `system` / 非本 vault / 损坏）⇒ 错误返回，
   当前会话、pending、文件、token 都不变。
5. 用底层入口解析会话目录：**不调用 `create_dir_all`**；目录不存在 ⇒ 读失败（不创建）。
6. 构造 `PendingRestore`：新 id、token、重建后的 input / panel / usage / title / 通知、
   初始批次（§5）。不写文件、不写 sidecar、不取任何写锁之外的持久化动作。
7. **替换规则**：旧 pending 若批次为空（纯查看态），直接丢弃；旧 pending 若已缓冲 history
   记录（发布失败过，见 §6），替换前 MUST 先尝试一次发布——仍失败则拒绝切换并保留旧会话与
   缓冲，返回发布失败错误。查看动作 MUST NOT 静默丢弃已产生的对话记录。

## 4. 查看路径

### 4.1 零写盘

查看 SHALL 只读源文件：不创建目录、临时文件、JSONL、sidecar；不改源文件字节与 mtime。
「零写盘」的观测面是会话目录：`.jsonl` 文件数不变、无临时文件残留、已存在文件的 sha256 与
mtime 不变。

### 4.2 同一源重复点击

复用查看阶段分配的 `new_id` 与 `session_token`。MUST NOT 重新铸 id、MUST NOT 重新读源文件、
MUST NOT 重建 transcript / 通知、MUST NOT 重放消息。`switched=false` 的回执只用于关闭浮层。

### 4.3 A→B→A

每次切换只替换内存投影。未发送即退出 = 无任何新文件；重启后 MUST NOT 复活空恢复文件
（没有待发布的持久化意图被写盘，故不存在恢复来源）。

### 4.4 当前项直切

所点文件就是当前活跃会话的已发布文件时：不 fork、不新增、不重放、不改变 token；busy 下也成功。
cron 打开会话入口走同一后端语义；当前文件直切仍只打开 / 刷新既有面板。

### 4.5 空源与异常源

- 空源（无任何轮次的会话文件）：允许查看为空 transcript，零新增；首次发言同样只发布一份恢复文件。
- 损坏源、非法 id、跨 vault、busy（需切换时）：在替换前失败；当前的 pending / 会话 / 文件不变。
- 查看成功后源被外部删除：发送使用查看时捕获的内存快照，不重读、不换历史；`restored_from`
  允许成为既有算法已支持的悬空父 id。

## 5. 初始批次与原子发布

### 5.1 触发点

第一条真实 `llm_request` 进入 `record_llm_request`（发送点同点记录）时触发激活。以下路径
**不产生** `llm_request`，因此 MUST NOT 激活、MUST NOT 发布文件：

- 缺 provider / 缺 Key / 缺 Base URL / 无模型的发送前置闸（`send_preflight`）；
- 图片能力闸；
- busy 拒绝、非法附件、线程未启动；
- 纯查看、标题评估、删除、列举。

provider 已实际收到请求后失败（非 2xx、网络、流中断）：这是真实失败轮次，文件已发布，
失败与后续显式重试追加同一文件。

### 5.2 批次内容与顺序

```text
session_open           （沿用恢复文件现存形状：system / assembly / opened_from=restore /
                        restored_from / provider / model / wire_api / thinking /
                        usage / cache_totals / subrun 种子）
inherit?               （源会话有有效标题时一条 session_title，decision=inherit）
notice_delivered*      （查看时重建的通知，按重建次序）
llm_request            （首条真实请求）
```

批次内每条记录恰好一次；批次之后产生的记录（`llm_response`、sidecar、工具循环后续请求）
在发布成功后按普通 append-only 追加。

### 5.3 原子发布算法

1. 目标目录 = 源文件所在会话目录（`sessions/<vault 稳定 id>/`）。发布 MUST NOT 创建目录；
   目录不存在 ⇒ 发布失败。
2. 临时文件名 = 同目录下 `.<session_id>.jsonl.tmp`（点号开头、不以 `.jsonl` 结尾）；
   会话列举只认 `extension == "jsonl"`，因此临时名永不被列举识别。
3. 以截断方式写临时文件（同一 session 只有一个写者，可安全复用 / 覆盖自己的残留临时名），
   依次写入批次全部行；完整写入并关闭。
4. 用**不覆盖**的原子发布机制创建最终目录项：`std::fs::hard_link(tmp, final)`（目标已存在即
   `EEXIST`，不会覆盖），随后删除临时名。
5. 发布成功是**唯一提交点**：此后切到普通 append-only 句柄；临时名删除失败只留不可列举残留，
   MUST NOT 回滚最终文件、MUST NOT 再次发布。
6. 最终路径已存在（撞名）⇒ 发布失败，MUST NOT 覆盖、MUST NOT 静默换 id。
7. 不支持硬链接的文件系统不在承诺内：按发布失败处理（走 §6），不降级为「先查后 rename」。

### 5.4 为什么不用 `rename`

`rename` 会静默覆盖既有目标。恢复文件的 id 是新铸的，撞名意味着不可接受的身份冲突；用
`hard_link` 把「不覆盖」变成系统调用级的原子条件，而不是 check-then-rename 的竞态。

## 6. D1 推荐 A：首次发布失败的语义

### 6.1 行为

- 发布失败（权限 / 磁盘 / 撞名 / 目录缺失）：最终 `.jsonl` 不存在；临时文件最多留一个不可列举
  残留；**MUST NOT** 留下空文件或半截最终文件。
- 初始批次完整保留在内存；本轮请求照常发给 provider，对话继续（沿用「写失败不阻断对话」）。
- 后续每条记录继续加入批次；每次写动作至多尝试一次发布（不在同一次调用里循环重试）。
- 重试 MUST 使用同一 `session_id`、同一 `session_token`、同一份批次。
- 发布成功后：批次每条记录恰好一次；此后记录走普通 append；MUST NOT 双写触发发布的那条记录。
- 退出前始终未发布成功：新增对话随内存消失；源文件不动；重启不复活空恢复文件。

### 6.2 健康状态（与「留存健康状态」条对齐）

未激活恢复的批次单独评价：

| 维度 | 发布失败期间 | 发布成功后 |
|---|---|---|
| `state` | `degraded` | `ok` |
| `severity` | `history`（缓冲记录属恢复文件的首行 + history） | `null` |
| `detail` | 发布失败分类（open / write / publish / collision） | 空串 |
| `history_written` | `false` | `true`（批次含 `llm_request`） |
| `history_gap` | **`false`**——记录仍在内存，未永久丢失 | `false`；MUST NOT 出现假缺口 |

呈现：警示块文案 MUST 说明「对话暂未保存」与「现在退出，这段对话将无法恢复」；MUST NOT 使用
缺口文案「此前部分对话记录未能保存」。事件：`ok→degraded`、`degraded→ok` 照常发；发布失败
MUST NOT 发 `history_gap` `false→true`。发布成功使 `history_written` `false→true`，发对应事件。

已发布之后的 append-only 写入（含部分写、首行重试）仍按既有口径判缺口——本规则只覆盖文件从未
存在过的初始发布。

### 6.3 备选 B 的差异（若 Alex 选 B）

首次发布失败 ⇒ 首次发送被拒（`harness_send` 返回发布失败），composer 回滚，用户修好后重试同一
身份。健康面不需要 pending 的 degraded 特例（失败即未受理）；但 `harness_send` 受理路径要同步
完成激活，前后端改动面更大，且给「写失败不阻断对话」增加一个例外。选 B 时替换 §6.1 / §6.2 与
spec 的 pending 条款，其余章节不变。

## 7. 身份与 IPC

`SessionResumeInfo` 增加 `switched: bool`：

- `switched=true`：真正发生了切换（含首次查看 A→B）；`session_id` / `session_token` /
  `restored_items` / `messages` 含义同现值。
- `switched=false`：直切或同一 pending 复用；`session_id` / `session_token` 为当前身份，
  `restored_items=0`、`messages=[]`；前端 MUST NOT 用它们重放。

`session_id` 的文档改为「当前或待激活身份，不保证文件已存在」。`session_token` 语义不变：
查看阶段分配，首次发布不重铸——前端在查看阶段采纳的 token 在首次发送与写失败事件中持续有效。
ts-rs 重导出 `src/bindings/SessionResumeInfo.ts`，前端桩同步。

## 8. 前端与在途快照

- 点击历史项：打开浮层 → 调恢复 → 成功回执后按 `switched` 分支处理。
- `switched=false`：只关闭浮层；不 `resetView`、不清 activity、不换 token、不重复渲染或滚动。
- `switched=true`：沿用 `snapshotSeq` / `viewGeneration` / `persistenceSnapshotSeq` 守卫；
  在回执成功后退役旧 token、采纳新 token。
- 查看阶段不再有 `inherit` / `notice_delivered` 写失败事件，因此前端可等成功回执再动视图；
  失败时旧视图完全不动（与现行「先退役、失败回滚」相比更简单）。
- 首次发送不改变 token：activation 的 persistence 事件仍归同一逻辑会话。
- 迟到的旧快照 / 事件按既有 token + 世代守卫丢弃，不串 vault、不重复 transcript。

## 9. 验收矩阵（真机）

权限故障使用验收 DSL 的受限 `envChmod`（只允许改隔离配置目录）制造真实 OS 权限失败，不引入
生产测试后门。负向断言必须同时有正观测，防止在「读不到目录」上空转。

| # | 操作 | 必须断言 |
|---|---|---|
| 1 | 连续点击同一历史项 | 目录 `.jsonl` 数不变；id / token 不变；transcript 与通知不重复 |
| 2 | A→B→A 查看 | 零新增；每次内容属于所选源 |
| 3 | 查看空源 | 空面板、零新增；首次发言后才 +1 |
| 4 | 点击当前已落盘文件（空闲 / busy） | 不 fork、不新增、busy 下也成功 |
| 5 | 首次真实发送 | 文件数恰好 +1；`restored_from` 指向所选源；源 sha256 与 mtime 不变 |
| 6 | 双击发送 / 重复发送意图 | 只受理一轮；一份文件、一条用户消息、一条首个 `llm_request` |
| 7 | 从源行建立第二分支并发送 | 第二份恢复文件才出现；两份独立可删 |
| 8 | 查看后退出（未发送） | 重启后仍零新增，不出现复活文件 |
| 9 | provider 前置拒绝（缺 Key / 图片闸） | 无新文件、无临时文件；有可见错误作为正观测 |
| 10 | provider 请求后失败并显式重试 | 不新增文件；失败与重试记录追加同一文件 |
| 11 | 目录权限导致发布失败 | 按 D1：对话继续、健康告警可见、最终 `.jsonl` 不增加 |
| 12 | 权限恢复后再发送 | 同一 id 发布一份；缓冲记录各一份，不双写 |
| 13 | 损坏源 / busy（需切换）/ 跨 vault | 原会话不变、零新增、有明确错误 |
| 14 | 恢复在途切 vault / 视图、旧快照迟到 | 不串 vault、不重复 transcript、不清新 token 的 persistence 事件 |
| 15 | 旧场景 724 / 206 回改后 | 行数在首次发送后才 +1；`notice_delivered` 首帧断言改为发送后成立 |

## 10. 规格增量映射

`specs/harness/spec.md` 三条 MODIFIED，均整条复制 living 正文再改：

1. **会话边界**：恢复入口改「查看 = 内存重建」；新增查看零写盘、重复 pending 复用、当前项直切、
   A/B 零新增、pending 不出现在清单、首次发送唯一文件、查看后退出不复活等段落与场景；
   「恢复新增一行且不置顶」「从历史会话恢复续聊」「源行与恢复行独立操作」「被拒的发送」按新触发点改准；
   其余段落（每文件一行、排序、compact、列举只读、纯环谱系）逐字保留。
2. **会话本地留存**：新增查看零写盘、初始批次顺序、原子发布、失败无最终文件、同身份重试、
   撞名不覆盖、双击只受理一轮、provider 前置不激活 / 后置失败仍留痕等条款与场景；
   `inherit` 改为初始批次的一部分；恢复充分性、append-only、孤儿化等段落逐字保留。
3. **留存健康状态**：新增 pending 初始批次的 scoped 规则（degraded + severity=history +
   `history_written=false` + 缺口保持 false；发布成功后恢复 `ok` 且无假缺口）；把「不做原子发布」
   的绝对表述收窄为「不修复既有损坏文件；仅恢复初始发布采用原子发布」；其余段落逐字保留。

## 11. 风险与已知边界

- **多实例**：同一账号开两个 app 实例时，两个 pending 可能铸出不同 id（各自随机），不会互相覆盖；
  发布用不覆盖语义，撞名按失败处理。
- **硬链接不可用**（少数文件系统）：发布按失败处理，走 D1；不降级为可能覆盖的 rename。
- **临时残留**：反复失败可能积累 `.jsonl.tmp` 残留；它们不被列举、不属清单消费者，本 change
  不做自动清扫（不引入后台任务）。
- **显式「新会话」**：在未发布 pending 上触发时等同放弃该批缓冲（用户显式动作，且警示块已提示
  退出风险）；本 change 不改「新会话」语义。
- **`fsync` / 断电**：不在承诺内；原子发布只保证「发布点之前不可见、之后可见且完整」。
- **未验证项**：真机权限失败的具体错误分类（`EACCES` 与目录属主）需在实现期实测后回填验收证据；
  本提案不声称已验证。
