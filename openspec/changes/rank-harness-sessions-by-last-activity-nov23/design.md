# Design: 会话列表按最后活动时间排序（每文件一行，读路径）

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）的读数，实现时以符号为准。
> 节点状态见 [proposal.md](proposal.md)：**节点 1 已于 2026-11-24 通过**（Alex「同意」，
> B1–B6 按推荐；B5 = A 档、B6 = M392 另立）。本文件与 delta 即该批准口径的实现合同。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 列举读每个 JSONL 的完整记录、每条信封 ts、首行信封 ts | `src-tauri/src/harness/jsonl.rs:888-939`（`SessionFile` 的 `records` / `record_ts` / `first_ts`） |
| F2 | `SessionSummary.ts` 取首行信封 ts（文件创建时刻） | `src-tauri/src/harness/session.rs:652`；赋值 `src-tauri/src/harness.rs:1150` |
| F3 | 后端排序改为 `last_activity_ts` 倒序 → 同值 session id 倒序 → 无值最后 | `src-tauri/src/harness.rs:1163`（`list_sessions` 唯一排序点） |
| F4 | 前端 `sessionEntriesOf` 保持后端数组序（不再重排） | `src/harness-panel.ts:1314` |
| F5 | 行时间格读 `lastActivityTs ?? ts` | `src/harness-panel.ts:10113` |
| F6 | 恢复开新文件：`session_open` 带 `opened_from=restore` + `restored_from`（源 id） | `src-tauri/src/harness.rs:805-838` |
| F7 | 恢复时写 `notice_delivered`（有未投递通知）与 `inherit`（源有标题）；两者皆无时 writer 惰性到首条记录 | `src-tauri/src/harness.rs:890-906`；`jsonl.rs:520-558` |
| F8 | 源文件不删、不改写；新旧文件并存 | 恢复路径（F6）与删除入口（`harness.rs:929-980`） |
| F9 | 有效标题 last-wins，单处实现 | `jsonl::effective_title`（`harness.rs:1121` 调用） |
| F10 | 会话归属按首行 `session_open.vault_root`；目录只是组织维度 | `harness.rs:1082-1118` |
| F11 | `last_opened_at` 是 vault 级字段，与会话无关 | `src-tauri/src/vault_registry.rs:83`、`:374-395` |
| F12 | 浮层每次打开现拉现建；打开期间不订阅、不轮询 | `src/harness-panel.ts:9755-9896` |
| F13 | 现有 sidecar kind：`session_title`（含 `inherit`）/ `notice_delivered` / `approval` / `turn_aborted` / `error` / `loop_limit` / `subrun` 等 | `openspec/specs/harness/spec.md`「会话本地留存」条 |
| F14 | 自动压缩换文件只写 `opened_from=compact`，**没有** `restored_from` | `src-tauri/src/harness/run.rs:755-790`；`session_open_payload`（`harness.rs:1569-1605`） |
| F15 | 删除只删一个文件；活跃会话拒删 | `harness.rs:929-980`；前端成功后只移除当前行 `harness-panel.ts:9864-9869` |

结论：列举已经为了会话名与标题读完了每一份文件（F1、F9），算活动时间与链遍历是**同一次读**上的
新增线性工作，不需要新 IO、不需要新记录、不需要后端写路径。

## 2. 语义

### 2.1 行身份

**一份 JSONL 文件 = 一行**，行身份是 `session_id`（文件名）。不折叠、不隐藏、不合并、不去重；
恢复 / 压缩产生的多份文件各占一行。源行与恢复行都能独立恢复 / 删除；从源行再次恢复即形成分支，
不需要额外的「查看链 / 从此节点恢复」入口。

### 2.2 最后活动时间

```
last_activity_ts(file) =
  max{ 信封 ts | 记录 kind ∈ {llm_request, llm_response},
       属于该文件或它的 restored_from 祖先链 }
  否则 min{ 首行 session_open 信封 ts | 该文件或它的 restored_from 祖先链 }
  否则 None
```

- 无轮次时回落链上**最早**的首行信封 ts，而不是本文件创建时刻：恢复产生的新文件没有自己的
  轮次时，继承源文件的创建时刻，不会因「新文件刚建」而排到活动更晚的会话之前。
- 用「最早」而不是「链根」：线性链上二者相等；遇到环 / 父缺失时仍然有定义，不需要根身份与
  第三遍异常分量算法。
- None 只用于**排序兜底与不显示时间格**，MUST NOT 用 id 前缀或其它派生值伪造展示读数。

### 2.3 计入 / 不计入

| 记录 | 计入 | 理由 |
|---|---|---|
| `llm_request` | 是 | 一次真实发送（含失败轮、被停止轮、工具循环每次迭代、点击 cron、自动回合） |
| `llm_response` | 是 | 一次真实产出 |
| `session_title`（含 `inherit`） | 否 | 改标题 / 恢复不是「在这个会话里聊过」；且既有条款要求改名不重排 |
| `notice_delivered` | 否 | 投递通知是后台动作 |
| `approval` / `turn_aborted` / `error` / `loop_limit` / `subrun` | 否 | 都是 wire 外的决策 / 事件 sidecar |
| `user_message` 等 11 类废弃 kind | 否 | 已不再记录（历史文件里即使有也不计入） |

被拒的发送（`harness_busy` / provider 缺失 / 图片能力闸）没有 `llm_request`，因此不改排序。
无人值守 cron 走隔离 runtime、不写交互会话文件，同样不改排序。

### 2.4 恢复与排序

- 恢复开新文件 → 列表新增一行；源行保留。
- 新行没有自己的轮次时，活动时间 = 链上最大值 = 源文件的最后活动；因此它**不会越过任何活动更晚
  的会话**。它通常与源行同值，按 session id 倒序相邻（新 id 在上）。
- 若源文件本来就是最近活动的一条，新行会与源行一起停在最前——这是「同一逻辑会话仍在最前」，
  不是「新文件凭创建时刻置顶」。判据是：**不得越过活动更晚的会话**。
- 新行发出第一条消息后，它自己的 `llm_request` ts 进入链最大值；此后按真实新活动排序。
- 源行仍可再次恢复，形成第二个分叉；每个分叉各自一行、各自可删除。

### 2.5 删除与链

- 删除仍只删一个文件（F15），不按链删除；活跃会话拒删不变。
- 删除链上祖先会改变后代可计算到的链上活动时间（后代仍在、仍独立一行，按剩余链 / 自身创建
  时刻回落）。这是「每文件一行」的已知边界，不是父代复活，也不改变删除语义。
- 父 id 不在目录（已删除 / 跨 vault）→ 链在该处停止；文件仍是独立一行。
- `restored_from` 指向自身 → 按无父处理。

### 2.6 compact

compact 文件没有 `restored_from`（F14），因此**不进入任何链**：它按自身轮次 / 自身创建时刻落位，
独立一行。MUST NOT 因为同名、`compact_summary` 在场或 `opened_from=compact` 就把它与源文件合并，
也 MUST NOT 让它的活动时间继承源文件。压缩模板作为回落名、与源文件同名的残留是现有行为，本 change
不特判、不消除。

## 3. 后端算法

### 3.1 数据形状

```rust
struct ListedNode {
    id: String,
    parent: Option<String>,     // session_open.restored_from（非空、且 != 自身）
    own_activity: Option<u64>,  // 本文件内 llm_request / llm_response 的信封 ts 最大值
    created: Option<u64>,       // 首行信封 ts（既有 first_ts）
    summary: SessionSummary,    // 既有字段（ts 仍是 created）
}
```

### 3.2 一遍收集 + 每行一次链遍历

1. **收集**：对每个可读文件建 `ListedNode`，放进 `HashMap<String, ListedNode>`。不建 `referenced`
   集合、不找链头、不做第三遍异常分量扫描。
2. **逐行求时间**：对每个节点，沿 `parent` 向上走：
   - `visited` 防环、深度上限 256；
   - `activity = max(activity, node.own_activity)`；
   - `earliest = min(earliest, node.created)`（忽略 None）；
   - 父 id 不在 map / 指向自身 / 已访问 → 停止。
   - 结果时间 = `activity.or(earliest)`。
3. **排序**：所有节点（= 所有文件）一起排序：

```
rows.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| b.id.cmp(&a.id)))
```

- `Option<u64>` 的 `cmp` 把 `Some` 排在 `None` 之后（降序时 `Some` 在前、`None` 最后）。
- 同值按 session id 倒序兜底（确定性；不依赖目录遍历序）。
- 纯环：`visited` 让遍历终止；每个文件仍各占一行，不挂起、不丢行、不重复。没有「链头」概念，
  所以不存在纯环零行。
- 只在这里排一次；前端不再排。

### 3.3 复杂度

每文件一次 `read_session_file`（既有）+ 一次记录扫描（O(records)）+ 一次链遍历
（O(链长)）。链长通常 1–3；深度上限 256 兜底。总复杂度与今天同阶，不新增 IO。

## 4. 数据合同

`SessionSummary` 新增一个可选字段（不动既有 `ts` 与 `first_user_text`）：

```rust
/// 该文件的最后活动时间（自身与 restored_from 祖先链上 llm_request / llm_response 信封 ts 的
/// 最大值；链上无轮次时取链上最早的首行信封 ts）。None = 无任何可信时间
///（排序置后、界面不显示时间格）。
#[ts(optional)]
#[ts(type = "number")]
#[serde(skip_serializing_if = "Option::is_none")]
pub last_activity_ts: Option<u64>,
```

- `ts` 语义不变（本文件创建时刻），既有消费方不受影响。
- `first_user_text` 语义不变：仍是**本文件**内首条 `llm_request` 的首条 user 消息；不做链上解析
  （每文件一行，行名各按本文件；恢复出的未命名文件在未发消息前按现有口径显示「新会话」）。
- 前端 `SessionEntry` 增加 `lastActivityTs: number | null`；解析规则与 `ts` 相同（正数、有限）。
- 行时间格读 `lastActivityTs ?? ts`：新字段缺失（旧载荷 / 桩）时退回既有创建时刻，不改变旧行为；
  两者皆空则不渲染时间格。

## 5. 前端

- `sessionEntriesOf`：删除 `.sort(...)`，保持后端数组序；注释写明「顺序由后端唯一产生，前端
  MUST NOT 重排」（REVIEW.md「同一语义两处真源」）。
- 行时间格：`const at = entry.lastActivityTs ?? entry.ts; if (at !== null) …`。
- 浮层：打开时现拉；打开期间不订阅、不轮询、不重排。改名仍走 `retitleOpenSessRows` 的原地更新
  （F14 / 既有条款），不触发排序。
- 当前会话：无特殊处理（自然排序）。
- 删除：仍按行的 `sessionId` 调 `harness_delete_session`；成功只移除该行；不推断链、不联动删除
  其它行。

## 6. 只读与性能

- 列举路径只读：不写 JSONL、不建文件、不迁移、不改 mtime。单测用「读前后字节 + mtime 相等」判。
- 不新增记录、不回填、不迁移；旧文件只被读。
- 打开浮层的耗时与今天同阶；不进入按键路径、不新增定时器。

## 7. A 档与 B 档

| 档 | 做法 | 本期 |
|---|---|---|
| **A（采用）** | 只在 `harness_list_sessions` 读算；不写任何记录、不做迁移、不改既有文件 | ✅ |
| B（不纳入） | A + 停止恢复时立即写 `inherit`，标题改为沿链解析；「点开不说话」零写盘 | ❌ 需改「会话本地留存」的 inherit 条款与 `effective_title` 读取面，属影响面升级线 |
| C（否决） | 点开写 `last_opened` / 更新 sidecar 改排序 | 每次重开都写历史，且制造第二真源 |

B 档不纳入本期的直接后果：恢复仍会在有标题 / 有通知时立即落一份小文件；它与源文件各占一行
（本 change 的显式行为，不是缺陷）。这是 A 档已知的代价，写进 §9。

## 8. 测试与验收矩阵

| 判据 | 机器层 | 真机层 |
|---|---|---|
| 创建与活动顺序相反 | Rust 单测：A 创建 100 / 活动 400，B 创建 200 / 活动 300 → A 在 B 前；C 创建 300 / 无活动按 300 落位 | 新场景：老会话聊一轮后回到最前 |
| 恢复不置顶 | Rust 单测：A 活动 400；C 活动 500；恢复 A → C 仍在最前；A 源行与新行都在、都读 400、相邻（新 id 在上） | 新场景：先 C=600 验证恢复 A 不越过 C；再 B 真实发送（后端实际当前时间）验证 A 源/恢复行不越过 B |
| 每文件一行 | Rust 单测：源 + 恢复子文件 → 恰好两行、精确 id 集；不折叠 | 106：恢复后两行都可点 |
| 源 / 恢复行独立操作 | Rust 单测：两份文件各自可被删除；删除源后子文件仍列出、仍可恢复 | 108 回扫：删除只作用于所选行；活跃拒删不变 |
| sidecar 不计入 | Rust 单测：只追加 `session_title` / `notice_delivered` / `approval` 的文件不改变排序；改名不重排 | 165 + 改名步骤 |
| 失败 / 停止轮计入 | Rust 单测：`llm_request` 后跟 `error` / `turn_aborted`，时间取请求 ts | 可并入 88 |
| 无人值守 cron 不参与 | 既有测试：隔离 runtime 不写交互会话文件；列表不因它变动 | 124（按 vault） |
| 缺时间安静回落 | Rust 单测：`llm_request` / `llm_response` / `session_open` 全部缺 ts → 无值、排最后；TS 单测：null 不渲染时间格 | 165 |
| 同名两行 | Rust 单测：两个独立文件同名 → 两行都在、按时间排 | 视觉场景桩：两行同名 + 不同时间 |
| compact 不沿链 | Rust 单测：源 + compact 文件（无 `restored_from`）→ 两行、compact 不继承源活动时间；同名不合并 | 可并入新场景 |
| 纯环终止 | Rust 单测：A↔B 互指 → 两行、精确 id 集、遍历终止 | ——（静态数据） |
| 只读 | Rust 单测：列举前后文件字节 / mtime 不变；目录无新文件 | 打开浮层前后核 JSONL sha256 不变 |
| 前端不重排 | TS 单测：乱序输入 → 输出保持输入序 | ——（命令层已覆盖） |

## 9. 已知边界

1. **恢复 / 压缩产生多行是现有行为**：本 change 不折叠、不去重；同名两行、恢复出的未命名文件在
   未发消息前显示「新会话」、compact 文件可能用压缩模板作回落名，都保留。M392 另立。
2. **compact 无源 id**：不进入链，按自身创建时刻 / 自身活动落位；压缩后可能因新文件创建时间靠前。
   这是既有行为，本 change 不引入 compact 特判。
3. **删除祖先改变后代可计算时间**：后代仍独立一行，按剩余链 / 自身创建时刻回落；不隐藏、不合并。
4. **同名但无关系**：不合并、各占一行；改名按上屏名匹配时可能同时改到两行——既有口径，不在本期
   扩面。
5. **链上全缺 ts**：无值、排序置后、不显示时间格；不伪造 id 前缀。
6. **当前会话无标记**：用户只能靠时间与内容判断哪条是当前；加标记需要快照补 `session_id`，本期
   不做。
7. **浮层打开期间列表不刷新**：期间产生的活动不会让行跳动；重开浮层才更新。这是刻意的只读快照
   语义。

## 10. 实施顺序

1. 先红：Rust 排序 / 恢复不置顶 / 每文件一行 / sidecar / compact / 缺 ts / 只读单测；TS 保序单测；
   m662 桩补新键。
2. 后端：活动时间链遍历、排序、无值兜底；不建链头 / 不折叠。
3. ts-rs 重导出（先 `git add`）与前端字段。
4. 前端：删二次排序、行时间格；删除仍按单行 id。
5. 真机新场景 + 106 / 108 / 124 / 165 回扫；M392 不碰。
6. 门禁（quick / visual / docs）。
