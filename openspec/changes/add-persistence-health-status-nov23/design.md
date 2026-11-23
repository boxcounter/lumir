# Design: 双面持久化健康状态（会话留存 + 崩溃备份）

- Change ID: `add-persistence-health-status-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（方向准入、节点 1 裁决），AI agent（起草）
- 状态：**节点 1 已通过**（2026-11-23，Alex 原话「三项推荐。」）；V1–V7 全部按推荐值生效，
  本文件是实现依据。

## 1. 目标

两件事，各自一个载体，共用一个原则：**写点唯一、状态可读、失败可见、恢复如实**。

1. **Harness 会话留存**：写失败不再只进 stderr；会话持有**两个独立维度**的健康——当前写健康
   与 `history_gap`（历史缺口 latch）。面板在 composer 上方持续可见；写入恢复后缺口仍显示，
   文案明确「写入已恢复但此前记录缺失」；本逻辑会话首次进入 `history` 给一条 sticky 提示。
2. **文档崩溃备份**：写失败与枚举失败不再被 `catch(() => {})` 吞掉；文档区 sticky 横幅用两个
   独立子条件分别表达，写失败给「全部保存」，枚举失败给「重新检查」。
3. **同根缺陷**：修 `pending_open` 的内存遗忘；但**不承诺部分写后的文件可恢复**——文件可能
   已损坏时，持续给 `history` 告警并写明边界。

不在范围内：设置项、忽略 / 静音、通知中心、跨重启持久化、子运行流水 / 草稿 / 附件健康、
对既有不可读留存文件的事后修复 / 提示、JSONL 原子发布 / 回滚 / 截断修复。

## 2. 现状证据（设计依据）

| 位置 | 事实 |
|---|---|
| `src-tauri/src/harness/jsonl.rs:250-281` | `record()` 返回 `()`；四类失败只 `eprintln!`；生产路径 15 处调用点无返回值处理 |
| `jsonl.rs:264-266` | 先 `pending_open.take()` 再 `writeln!(open)`；首行写失败即丢首行 |
| `jsonl.rs:411-416` | `read_session_file` 要求首行 `session_open`，否则 `harness_session_invalid` |
| `jsonl.rs:264-279` / `:391-416` | `writeln!` 可能写入部分字节后报错；`read_session_file` 对任一行非法 JSON 直接报错——部分写可使整份文件不可读 |
| `harness.rs:905-915` | 列举跳过不可读文件，只打 stderr |
| `save-controller.ts:882-887` | `backupDirty()` 以 `.catch(() => {})` 吞掉 `recovery_write_failed` |
| `save-controller.ts:324-328` / `:898-907` | 删除备份吞错；枚举失败直接 `return` |
| `copy-data.ts:377` / `:2845` / `:2848` | `D198`（写失败）与 `D201`（枚举失败）已备好且零消费者：两条 reject 分别被 `backupDirty` / `checkRecovery` 吞掉；`D199` / `D200` 在恢复 / 丢弃动作里已有消费者 |
| `fs-io` living spec `:423` | 「跳过是显式裁决，MUST NOT 表现为『静默地什么都没有』」 |
| `harness-panel.ts:3670-3683` | 现成的常驻状态行范式：`quoteNote` + `role="status"`，明写「持久可见，不是 3 秒 toast」 |
| `main.ts:1744-1812` | 现成的 sticky 浮条范式：按文案去重、点击关闭、可带动作 |
| `session.rs:91-93`、`ipc.ts:522-527` | 事件 / 快照同键同值的既有纪律（M534） |
| `session.rs:452-453` | `StateSnapshot` 只 `Serialize`、不导 ts-rs；加字段不动 bindings |
| `events.rs:1-19`、`ipc.ts:498-557` | `harness:event` 是固定联合；新增一类要同批改 Rust + TS 白名单 |
| `turn.rs:1812`（`TauriEventSink`） | sink 是轮次私有；`Runtime` 不持 AppHandle——写失败可发生在轮次外 |
| `execute.mjs:4822`（`scripts/acceptance/lib/execute.mjs`） | 验收套件无通用 shell / chmod，但 `envWrite` 可写隔离配置目录 |

## 3. 方案总览

```
┌─────────────────────────── Harness 会话留存 ───────────────────────────┐
│ JsonlWriter（唯一写点）                                                  │
│   └─ Arc<Mutex<PersistenceHealth>>  ← Session 持有、Writer 上报          │
│        ├─ 当前写健康：state / since_ts / severity / detail              │
│        ├─ 历史缺口：history_gap { present, since_ts, detail }（latch）   │
│        ├─ 跃迁（含 state ok + gap true 的恢复）→ Runtime 层 sink          │
│        │    （带 vault 信封的 `persistence` 事件）                        │
│        ├─ 每次失败 → 诊断日志（kind + 错误分类 + 是否部分写）             │
│        └─ Session::persistence() → harness_state 快照 `persistence` 键    │
│                                                                          │
│ 面板：composer 上方常驻状态行（role="status"）                            │
│       + 本逻辑会话首次 history/缺口一条 sticky 提示（关闭不等于静音）       │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────── 文档崩溃备份 ────────────────────────────────┐
│ save-controller（备份生命周期的唯一持有者）                              │
│   └─ failedPaths: Map<path, {at, code}>  ← 写失败子条件                  │
│        ├─ 装配层渲染文档区 sticky 横幅（全局一条）                        │
│        └─ 标签读屏名 / 悬停提示后缀（不改可见像素）                        │
│                                                                          │
│ 枚举失败（V5）：独立的第二个子条件「无法检查残留备份」+ 重新检查           │
│ 横幅在场 ⇔ 写失败子条件 或 枚举失败子条件；两个都清才撤下                  │
└──────────────────────────────────────────────────────────────────────────┘
```

两条面各自只有一个真源：harness 是会话持有的 `PersistenceHealth`（两维）；文档侧是
save-controller 的 `failedPaths` 与独立的枚举失败条件。前端 MUST NOT 通过列举文件、探测路径
或读日志反推健康。

## 4. Harness 留存健康

### 4.1 真源与所有权

- `PersistenceHealth` 由 `Session` 创建并持有（`Arc<Mutex<_>>`），`JsonlWriter` 共享同一份
  `Arc`。实现上健康随 `JsonlWriter::create`（会话留存路径）创建，`Session` 从 Writer 取
  同一份 `Arc` 持有；子运行审计用的 `create_at` / `append_at` **不挂健康**（`None`），
  其失败不进用户健康状态。
- 健康包含**两个相互独立的维度**：
  - **当前写健康**：`state` / `since_ts` / `severity` / `detail`——这一段会话**现在**还能不能写；
  - **历史缺口**：`history_gap { present, since_ts, detail }`——这一段会话**已经**缺失恢复所
    依赖的记录。后者是一个 latch。
- **辅助事实 `history_written`**：本逻辑会话是否已有至少一条 `llm_request` / `llm_response`
  成功写盘。它不是第三个健康维度，只用于「本次会话的新记录尚未落盘、退出后无法恢复」的风险提示；
  同一逻辑会话内 `true` 后不回落，rotate 沿用，新逻辑会话重置。
- **为什么必须分开**：一次成功追加只证明「现在能写」，不能补回已经缺失的记录。把两者合并成一个
  `ok/degraded`，会把「仍然丢了一段历史」洗成健康；这正是评审阻塞 1。
- **为什么由 Session 持有**：会话有四种建立场景（初始会话、从历史恢复、新会话重置、自动压缩
  轮换），还有轮次外的写点（批准 / 标题 / 继承）。健康状态若挂在这些调用点各自的局部变量上，
  四种场景会各有一份、轮换后会漂；切 vault 时后端会话仍按 vault 保留，也必须继续持有同一份健康。
- `JsonlWriter` 仍是唯一写点与唯一上报点；`record()` **保持 infallible**（返回 `()`），
  15 处生产调用点零改动，「写失败不阻断对话」的既有铁律不变。
- 上报内容只有分类：失败种类（由 `payload["kind"]` 或首行写出判定）、错误分类（IO /
  序列化 / 打不开 / 部分写）、时间戳。**不携带消息正文、不携带文档内容。**

### 4.2 状态机

**当前写健康**（只回答「现在能不能写」）：

```
[ok] ──写 / 开 / 序列化失败──► [degraded]
[degraded] ──任意一次成功追加──► [ok]
[degraded] ──自动压缩 rotate（同一逻辑会话）──► [degraded]（沿用）
[degraded] ──新逻辑会话 / 从历史恢复 / app 重启──► [ok]
切 vault ──► 不改变任何状态（见下）
```

**历史缺口**（latch，只回答「这段会话是否已经缺记录 / 文件是否可能已损坏」）：

```
[no gap] ──llm_request / llm_response 写失败（干净或部分）──► [gap]
[no gap] ──任意写失败可能已留下部分字节──► [gap]
[gap] ──成功追加 / rotate / 切 vault──► [gap]（不变）
[gap] ──新逻辑会话 / 从历史恢复 / app 重启──► [no gap]
```

- **首行 `session_open` 失败时，gap 由本次 `record(payload)` 的 payload 决定**（复审阻塞）：
  - 本次 payload 是 `llm_request` / `llm_response`：即使首行干净失败、payload 尚未写出，它也随
    本次调用一起丢失 → **置 `history_gap`**；后续重试成功只恢复当前写健康，不能补回这条记录。
  - 本次 payload 是非关键 annotation：不置 gap（annotation 不 latch）；首行重试成功后当前写
    健康回 `ok`。
  - 本次只写首行、没有 payload 被丢弃（若存在这种独立写首行的路径）：不置 gap。
- **首行 / 任意记录的部分写**（已写入字节后报错）**置 gap**：文件可能已损坏，不能承诺可恢复。
- **`llm_request` / `llm_response` 的干净失败**（非首行路径）也置 gap：这条记录永久缺失，
  后续成功不能补回。
- **annotation 干净失败**不置 gap：它不影响请求重建；没有独立的 annotation latch。若
  annotation 失败伴随部分写，按上一档处理（置 gap、severity 抬到 `history`）。
- **`history_written`** 在第一条 `llm_request` / `llm_response` 成功写盘时转 `true`；它不改变
  gap 判定，只决定「尚未落盘」提示是否还在。
- **切 vault 不是会话替换**：后端会话表以 vault 根为键，切 vault 只切换展示哪份快照，不创建 /
  销毁会话，MUST NOT 清除任何健康。切回时显示该会话自身仍 latch 的状态。这是评审阻塞 2。
- **新逻辑会话**：显式「新会话」立即清除当前会话健康（含 gap），面板 MUST NOT 继续显示旧状态；
  从历史恢复建新会话，从空健康起算；app 重启会话表清空，从空健康起算。
- **自动压缩 rotate**：同一逻辑会话换文件，两维都沿用；新文件首次成功只把当前写健康转 `ok`，
  gap 保持。

### 4.3 严重度与 gap 触发

| 失败 | 当前 `severity` | 置 `history_gap`？ | 理由 |
|---|---|---|---|
| 首行干净失败 + `llm_request` / `llm_response` payload | `history` | 是 | 本次 payload 也随调用丢失 |
| 首行干净失败 + annotation payload | `history` | 否 | 只丢 annotation；首行可重试，annotation 不 latch |
| 首行干净失败 + 无 payload 被丢弃 | `history` | 否 | 只有首行可重试 |
| `session_open` / 任意记录部分写 | `history` | 是 | 文件可能已损坏 |
| `llm_request` / `llm_response` 干净失败 | `history` | 是 | 记录永久缺失 |
| sidecar 干净失败（`approval` / `session_title` / `turn_aborted` / `llm_error` / `loop_max_reached` 等） | `annotation` | 否 | 不影响请求重建 |
| sidecar 部分写 | `history` | 是 | JSONL 完整性可能受损 |

- `severity` 只升不降：`annotation` 级失败 MUST NOT 降低已有的 `history`；恢复为 `ok` 时清空。
- `history_gap` 一旦 `present=true`，成功追加 / rotate / 切 vault 都不清除；只有新逻辑会话
  （显式新会话 / 从历史恢复 / app 重启）才从 `present=false` 起算。
- `detail`（当前写健康）记录本段 `degraded` 首次失败的分类，冻结到恢复；`history_gap.detail`
  记录本段首次 gap 的分类，冻结到新逻辑会话。
- 维护条款：新增一种「恢复充分性所依赖」的记录 kind 时 MUST 同批归入 history 触发面；未归类的
  kind 按 `annotation` 处理，且引入该 kind 的 change MUST 在 spec delta 里声明归类。

### 4.4 事件与快照

快照 `harness_state` 新增 `persistence` 键，**两维 + `history_written` 恒在场**：

```json
"persistence": {
  "state": "ok" | "degraded",
  "since_ts": 0,
  "severity": "history" | "annotation" | null,
  "detail": "",
  "history_written": false,
  "history_gap": {
    "present": false,
    "since_ts": 0,
    "detail": ""
  }
}
```

- `state=ok`：`since_ts=0`、`severity=null`、`detail=""`。
- `state=degraded`：`severity` 非空；`detail` 是本段首次失败分类。
- `history_written=false`：本逻辑会话尚无 `llm_request` / `llm_response` 成功写盘；
  第一条 history 记录成功后转 `true`，同一逻辑会话内不再回落；rotate 沿用，新逻辑会话重置。
- `history_gap.present=false`：`since_ts=0`、`detail=""`；`present=true`：`since_ts` 是本段
  首次缺口时间，`detail` 是首次缺口分类。
- **`state=ok` + `history_gap.present=true` 是合法且必须呈现的状态**：写入已恢复，但此前记录
  缺失。UI MUST NOT 把它当成健康。
- **`state=degraded` + `history_gap.present=false`**：只有当前写失败（通常是 annotation），
  没有恢复性缺口。
- 事件 `harness:event` 新增 `type: "persistence"`，载荷 = 同一份两维结构 + `type` + 信封
  `vault`。**同键同值不变量**：事件与快照共用同一份序列化，MUST NOT 各列一份键清单。
- 事件 SHALL 在以下跃迁时发出：当前写健康 `ok→degraded`、`degraded→ok`、
  `annotation→history`；历史缺口 `false→true`；`history_written` `false→true`。
  一次失败 / 成功可同时改变多项，发出一条完整载荷。**`degraded→ok` 且 gap 仍为 true 的
  恢复事件必须发**——它正是「写入恢复、缺口仍在」的状态变化。
- 旧快照 / 旧后端缺 `persistence` / `history_gap` / `history_written` 键：前端视为 `ok` /
  `present=false` / `history_written=true`（不误报「尚未落盘」），MUST NOT 因缺键显示
  状态行。
- `StateSnapshot::empty` 同样带 `persistence: { state:"ok", …, history_written:false,
  history_gap:{present:false} }`。

### 4.5 事件出口

写失败可能发生在轮次之外（批准、标题、继承、恢复），因此**不能把事件出口挂在轮次的
`TauriEventSink` 上**。方案：

- Writer 只把跃迁上报给注入的回调；回调由 `Runtime` 装配并负责盖 vault 信封。`jsonl.rs`
  MUST NOT 依赖 tauri / AppHandle（ADR 0002 §7：核心数据结构不耦合 UI 层）。
- `Runtime` 新增 `forward: Mutex<Option<Arc<dyn EventSink>>>`；`lib.rs` 在
  `.manage(harness::Runtime::default())` 附近装配 `TauriEventSink`（`turn.rs` 的私有结构
  提升为 `pub(crate)`）。
- 健康跃迁经 `Runtime` 的转发口发出，外套 `ScopedSink` 盖 vault 信封（只让当前 vault 的
  面板消费，切 vault 后旧事件被过滤）。发送 MUST NOT 在持有 Session / Writer 锁时进行：
  先在锁内更新状态并取出跃迁，释放锁后再发事件。
- 隔离运行（cron `Runtime::isolated()`）**不装配** forward：健康只进日志，不向面板呈现。
- 备选（不推荐）：每个会话建立点各自挂 hook。四种建立场景 + 轮次外写点会各写一份转发逻辑，
  比 Runtime 单一出口更碎、更易漂。

### 4.6 `pending_open`、首行 payload 与部分写

**只修内存遗忘**（评审阻塞 3 / 复审阻塞）：

- 现状 `jsonl.rs:264-266` 先 `pending_open.take()` 再写首行，首行失败即丢掉唯一的内存副本。
- 修法二选一：写成功后再 `take()`，或失败时把行放回 `pending_open`。硬性判据：
  - 首行写失败后，下一条 `record()` MUST 仍先尝试写 `session_open`；
  - MUST NOT 让挂起行从内存消失。
- **首行失败会连带丢弃本次 payload**：`record(payload)` 在首行写失败时直接返回，本次
  payload 也没有写出、没有被 `pending_open` 保存。因此 gap 判定 MUST 同时看本次 payload：
  `llm_request` / `llm_response` 被连带丢弃时置 gap；annotation 被丢弃时按 annotation
  规则不置 gap。测试 MUST 断言首次 payload 没有因后续成功而补回，不能只用「首行合法」
  冒充历史完整。
- **MUST NOT 承诺部分写后的文件可恢复**：`writeln!` 可能写入部分字节后返回错误；
  `read_session_file` 对任一行非法 JSON 直接报错（`jsonl.rs:391-416`），部分写可使整份文件
  不可读。因此：
  - 若失败发生在**任何字节落盘之前**，且后续重试成功：文件可以从合法首行开始（这是条件合同，
    不是绝对保证）；但**本次 payload 仍未写**——若它是 `llm_request` / `llm_response`，gap 已
    置 true，后续成功只恢复当前写健康；
  - 若失败**可能已留下字节**：`history_gap` 置 true，当前写健康 `degraded`，系统 MUST NOT
    声称该文件仍可被完整读取 / 恢复；
  - 已损坏的文件本 change **不修复、不截断、不做原子发布**；如需绝对可恢复保证，另立 change
    设计原子发布 / 回滚方案并加入前缀写故障注入。
- **实现提示**：写点通过一个可注入的 `LineSink`（生产实现写 `File`，测试实现「写 N 字节后
  返回 Err」）来区分「干净失败」与「部分写」；无法区分时 MUST 按可能部分写处理（置 gap）。
- 普通记录的干净失败按 §4.3 处理；部分写一律置 gap，且不因后续成功清除。
- **`history_written`** 在第一条 history 记录成功写盘时转 true；它不改变 gap，只让「本次
  会话尚未落盘」提示消失。

### 4.7 UI

- **常驻状态行**：composer 上方、`quoteNote` 之后新增同级元素，复用
  `lumir-hp-qc-src lumir-hp-quote-note` 类与 `role="status"`——零新样式。
  - `history_gap.present=true`：显示缺口文案；`state=ok` 时明确说「写入已恢复，但此前部分
    记录缺失，这段历史可能不完整」；`state=degraded` 时说明「写入仍在失败，且此前记录已
    缺失」。**MUST NOT 整条消失或回到健康文案。**
  - `state=degraded` 且无 gap：按 `severity` 显示当前失败文案。
  - `history_written=false` 且存在任何持久化告警（`state=degraded` 或 gap）：文案 MUST
    额外说明「本次会话的新记录尚未落盘，退出后无法恢复」。`history_written` 转 true 后该句消失；
    gap 文案仍按上一档保留。
  - 无自动消隐计时器，无关闭按钮；`ok` 且无 gap 时 `hidden`。`history_written=false` 本身
    不构成告警，只在已有告警时追加「尚未落盘」提示。
- **`history` 首次 sticky**（V2）：触发条件是**本逻辑会话首次进入 `severity=history`**，
  包括先 `annotation` 后升级为 `history`；也包括 `history_gap` 首次 `present=true`。
  每个逻辑会话只给一条，按文案去重；`annotation` 只亮状态行。
  - sticky 可点击关闭（沿用既有 sticky 浮条行为）。**关闭只移除本次提示**：MUST NOT 隐藏
    状态行、MUST NOT 清除 `history_gap`、MUST NOT 被视为对未来失败的静音；新逻辑会话可以
    再次触发。
  - toast 归属仍在装配层（M423）：面板调用新增的 `stickyToast(text)` 出口，不自建浮条。
- **新会话动作**：面板在动作完成后 MUST NOT 继续显示旧会话的状态行；实现可在 reset 路径立即
  清除当前会话健康（含 gap），下一次发送建立的新会话从空健康起算。
- **切 vault**：面板按 vault 重拉快照；MUST NOT 在切走时本地清除健康。切回时快照带回该会话
  自身的状态（含 gap）。
- **快照重建**：面板进入 / 重载 / `reloadSession` 时按 `persistence` 的两维 + `history_written`
  重建；缺键按 `ok` / `present=false` / `history_written=true`。事件到达时就地更新同一
  元素，不重建 transcript、不动滚动 / 焦点。
- **webview 整页重载**：前端「已提示」标记重置，同一逻辑会话的 sticky 可能再出现一次；
  状态行以快照为准，不会累积多条。

### 4.8 诊断日志

- 每次写失败落一条 `persistence_write_failed`（`logging.rs` 的 `LogEventName` 新变体）。
- 字段：`kind`（记录种类或 `session_open`）、`code`（`open` / `serialize` / `write` /
  `first_line`）、`partial`（是否可能已写入部分字节）、`path`（留存文件路径）。**不含消息
  正文、不含文档内容、不含 system prompt。**
- 只在失败时记，成功不记。既有 `recovery_written` 不动；文档侧写失败补一条同族事件。

### 4.9 已知边界

- 会话目录**创建**失败仍走既有 `harness_jsonl_failed` 硬错误（发送被拒），不进入健康状态。
- `_orphaned/` 不可达防御分支不额外表达。
- 子运行审计流水、草稿、附件不进健康（见 §4.3）。
- **部分写可能使文件不可读**；本 change 只保证「不丢挂起行 + 如实告警」，不保证可恢复。
- **首行干净失败 + history payload**：该 payload 随本次调用丢失，gap 置 true；重试成功后
  首行合法但那条记录不会补回。若 app 在重试成功前退出，运行期已告警，重启后不补报（非
  持久化边界不变）。
- **首行干净失败 + annotation payload**：annotation 丢失不 latch；首行重试成功后当前写
  健康回 `ok`、gap 为 false（annotation 没有独立历史系统）。
- **尚未任何 history 写盘**时，只要存在持久化告警，状态行必须提示「退出后无法恢复」；
  重启后不补报，仍由非持久化边界承担。
- 既有不可读留存文件的列举静默不纳入本次；本 change 只防止新产生与如实告警。
- 隔离运行不呈现（§4.5）。
- 切 vault 不重置健康；app 重启重置（会话表清空）。
- webview 整页重载会重置前端「已提示」标记，sticky 可能重复一次；状态行不重复累积。

## 5. 文档崩溃备份健康

### 5.1 真源

`save-controller` 是备份生命周期的唯一持有者，失败集合也放这里：

```
failedPaths: Map<path, { at: number, code: "recovery_write_failed" }>
```

- `backupDirty()` 失败 → `failedPaths.set(path, …)`；成功 → `delete(path)`。
- 装配层通过一个只读查询 + 变更通知渲染横幅与标签后缀；MUST NOT 另存一份失败集合。
- 失败集合只在内存；不写配置、不写磁盘、不跨重启。

### 5.2 触发 / 清除矩阵

横幅有两个**相互独立**的子条件：

- **写失败子条件**：`failedPaths` 非空——这些路径的 dirty 内容当前没有得到备份。
- **枚举失败子条件**：无法确认是否存在残留备份（`recovery_list` 失败）。

| 事件 | 写失败子条件（`failedPaths`） | 枚举失败子条件 |
|---|---|---|
| 备份写失败（目录创建 / tmp 写 / rename 失败） | 记录该路径（`at` 刷新为最近一次失败时间） | 不变 |
| 备份写成功 | 删除该路径 | 不变 |
| 保存成功 / 强制覆盖 / 另存为新文件 | 该路径转 clean → 删除 | **不变**（MUST NOT 连带清除） |
| 撤销 / 重做回到基线 / 重新载入放弃修改 | 该路径转 clean → 删除 | 不变 |
| 关闭标签放弃 / 切 vault 放弃 | 删除（随 `forgetBackup`） | 不变 |
| app 内改名 | 旧路径删除；新路径立即补写，失败则记新路径 | 不变 |
| 备份枚举失败（V5） | 不变 | 置 true |
| 备份枚举成功 / 「重新检查」成功 | 不变 | 清除 |

- 横幅在场 ⇔ 任一子条件成立；**两个子条件都清除后才撤下**。
- 写失败子条件清空 MUST NOT 撤下枚举失败子条件，反之亦然。

### 5.3 横幅

- **位置**：文档区顶部、标签条之下、正文之上的一条常驻条。两个子条件共用**一条**横幅，
  不按 pane 复制（分栏时不重复报警）。
- **形态**：sticky、不自动消隐、**不提供关闭 / 忽略按钮**；有动作按钮。
- **内容**：
  - 写失败子条件：受影响文档数 + 首个路径（不列全量；全量只进诊断日志）+ 一句「保存后即不再
    有丢失风险」；
  - 枚举失败子条件：一句「无法检查残留备份，可能有备份未被提示」；
  - 两者同时成立：同一横幅内分两段表达，各自带自己的动作。
- **动作**：写失败子条件 → 「全部保存」= 既有 `saveAllDirty()`；枚举失败子条件 →
  「重新检查」= 重跑 `checkRecovery()`。
- **撤下**：写失败子条件的路径逐个清除（保存成功 / 转 clean / 放弃 / 改名）；枚举失败子条件
  只在重新检查成功后清除。两个都清除后横幅才撤下。
- **无障碍**：`role="status"`；横幅出现 / 撤下不抢焦点。
- **性能**：横幅与标签后缀只在子条件变化时更新一次，MUST NOT 重建编辑器 / transcript，
  MUST NOT 在键入路径上引入同步 IO（ADR 0002 §6）。
- **几何**：`hidden` 时零占位、零像素变化；可见时占据文档区顶部一条，不覆盖正文。
  实现提示：`.pane-editor` 目前是横向 flex 容器，容纳顶部常驻条需要在其内加一层纵向
  布局（或等价方案）；健康态 MUST 与既有 CM 度量逐像素一致。

### 5.4 标签读屏名与悬停提示

- 受影响路径的标签在 `aria-label` 与 `title` 追加「（备份失败）」后缀（与 `D90`
  「（未保存）」同族）；**不改可见像素**、不加图标、不改标签宽度。
- 装配层在失败集合变化时触发一次标签重绘（`renderTabs` 已是全量重建，无增量 diff）。

### 5.5 枚举失败（V5 已纳入）

- `checkRecovery()` 的 `recovery_list` 失败不再 `return`：进入「无法检查残留备份」子条件，
  与写失败共用同一条横幅。
- 文案说明「可能有残留备份未被提示」，动作是「重新检查」（重跑 `checkRecovery`）；
  成功即清除该子条件。
- **独立保留**：该子条件不写入 `failedPaths`；保存成功 / `failedPaths` 清空 MUST NOT 撤下它；
  反之，重新检查成功 MUST NOT 清除写失败子条件。
- 该条件不影响标签后缀。

### 5.6 一处语义修正（已随节点 1 批准生效）

设计输入的场景 A3 写「全部保存后横幅仍保留（备份仍失败）」。按 §5.2 的清空条件，这条不
成立：保存成功后该路径不再需要备份，继续留横幅等于「没有风险却在报警」。本 design 采用与
清空条件一致的语义：

- **保存成功 → 该路径的写失败子条件移除**；写失败子条件全部清空且无枚举失败时，横幅撤下。
- **保存失败 → 写失败子条件保留**，并给出既有保存失败反馈。
- **枚举失败子条件独立**：即使写失败子条件清空，只要枚举失败仍在，横幅保留并显示枚举失败
  文案；它不能随 `failedPaths` 一起被撤掉（评审非阻塞建议）。
- 若备份子系统仍然坏着，用户下一次编辑并等满备份窗口会再次失败、写失败子条件再次出现——
  不静默，也不在无风险时占着界面。

修正后的准确表述是：**写失败子条件 = 该路径的 dirty 内容未得到备份**；不是「整个横幅 = 有
未保存内容没有备份」（V5 下枚举失败也能单独驱动横幅）。

### 5.7 重启语义

- 失败集合不持久化。app 重启 / webview 整页重载后不会凭旧状态弹横幅。
- 原因（磁盘满 / 权限 / 目录被占）若仍在，用户下一次编辑、等满备份 debounce（2s）后会
  再次失败，横幅重现——「重启不静默」由真实重试保证，不由持久化伪造。

## 6. 一致性不变量

1. **单一真源**：harness 健康只在 `PersistenceHealth`（两维 + `history_written` 辅助事实）；
   文档写失败只在 `failedPaths`，
   枚举失败单独一个条件。前端与日志都不得反推。
2. **两维不合并**：当前写健康回答「现在能不能写」；`history_gap` 回答「这段会话是否已经缺
   记录 / 文件是否可能损坏」。一次成功追加 MUST NOT 清除 `history_gap`。
3. **同键同值**：`persistence` 事件与快照共用一份序列化；单测钉两维 + `history_written`
   的键集合（M534 同形）。
4. **恒在场**：快照 `persistence` 的六个顶层键与 `history_gap` 的三个键恒在场；`ok` 用显式值
   （`severity: null`、`history_written: false`、`history_gap.present: false`），不用缺键表达
   健康（REVIEW.md「读不到当成空」条）。
5. **缺口生命周期**：成功追加 / rotate / 切 vault 都不清 `history_gap`；只有新逻辑会话
   （显式新会话 / 从历史恢复 / app 重启）才重置。
6. **切 vault 不重置**：后端会话按 vault 保留，切 vault 只切换展示哪份快照；切回显示同一
   会话自身的健康。
7. **无第二事实源**：不在前端按「历史列表少一项」推断写失败，不在文档侧按文件是否存在
   推断备份失败；枚举失败 MUST NOT 被当成「没有残留备份」。
8. **不阻断**：`record()` 仍 infallible；备份失败不阻断编辑与保存。
9. **关闭不等于静音**：关闭一次性 sticky 只移除提示，不隐藏状态行、不清缺口、不构成对未来
   失败的静音。
10. **未落盘提示**：`history_written=false` 且存在持久化告警时，状态行必须提示「本次会话的
    新记录尚未落盘，退出后无法恢复」；`history_written` 只由第一条 history 记录成功写盘转 true，
    不改变 gap 判定。

## 7. 视觉与手感

本 change 无交互原型，不新增视觉语言：

- **Harness 状态行**：复用引用失败状态行的类（`lumir-hp-qc-src lumir-hp-quote-note`）与
  字号 / 颜色 / 行高；不加边框、不加底色、不加图标。健康时 `hidden`，composer 几何与既有
  基线逐像素一致。缺口文案与当前失败文案共用同一元素，不叠加两条状态行。
- **文档横幅**：新元素，但只用既有 token——`--danger-tint` 底、`--danger` 文本、`--border`
  边、`--r10` 圆角、`--fs-ui` / `--lh-ui` 字级；与设置面板的 `lumir-set-banner.is-danger`
  同一套颜色语义。不引入新色值、不引入阴影。
- **标签后缀**：只进读屏名与 `title`，可见像素零变化。
- **像素基线**：健康态（状态行 / 横幅均 `hidden`）MUST 与既有基线一致，不需要更新；
  `degraded` / `history_gap` 态新增场景的像素基线须 Alex 过目后再 `--update`（人肉裁决点）。
- **手感**：横幅出现 / 撤下不做动画；状态行不做自动消隐。均归 Alex 真机手感裁决，
  不进机器判据。

## 8. 备选与取舍

| 方案 | 内容 | 结论 |
|---|---|---|
| A（本方案） | 双面健康状态、两维健康、单一真源、零设置、零忽略 | **推荐** |
| A-merged | 只用一个 `ok/degraded`，成功即回健康 | 否决：会把「仍然缺一段历史」洗成健康（评审阻塞 1） |
| B（更小） | 只把 `D198` 接上（文档一条 toast）+ harness 只记日志 | 否决：harness 正是「用户误以为历史已保存」的主场；一次性 toast 不满足「不能只做一次 toast」 |
| C（更大） | 控制行 chip + hover 浮层 + 标签第二标识 + 设置开关 + 通知中心 | 否决：命中「不要扩成设置中心或通用通知系统」；动 composer 控制行会牵动上下文用量 requirement 与视觉基线 |
| A3' | harness 状态行放控制行 chip + hover 浮层 | 不推荐：可发现性略强，但要改控制行构成、新气泡定位、可能牵动基线；状态行已足够 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 成功追加把历史缺口洗白 | `history_gap` 独立 latch；R2 / R3 覆盖「失败→成功→缺口仍在」与轮换 |
| 切 vault 被误当成会话替换、清掉健康 | 切 vault 不碰健康；R4 覆盖 A→B→A 仍显示 A 的缺口 |
| 首行修了但仍承诺文件可恢复 | 删除绝对承诺；R7 前缀写故障注入；文案只承诺「不丢挂起行 + 如实告警」 |
| 首行干净失败连带丢掉本次 history payload，却被当作无缺口 | gap 按本次 payload 判定；R6a 断言丢失记录未被后续成功补回；R6b 覆盖 annotation 对照 |
| 尚未任何 history 落盘时，状态行只报当前失败、不说退出后无法恢复 | `history_written` 辅助事实；U13 断言 false + 告警时出现未落盘提示，true 后消失 |
| annotation→history 升级拿不到 sticky | 触发条件改为「本逻辑会话首次进入 history」，U7 覆盖 |
| 枚举失败随 `failedPaths` 清空被撤下 | 两个子条件独立；U12 覆盖保存成功但枚举失败仍在 |
| 事件出口挂错层，轮次外失败仍不可见 | 出口挂 `Runtime`；R8 覆盖轮次外写点与隔离实例 |
| 前端把缺键当健康，掩盖新后端故障 | 新后端恒在场；缺键只对旧快照宽容，U5 / U6 覆盖 |
| 横幅变成常驻噪音 | 写失败子条件只在 dirty 且备份失败时出现；保存成功即清；枚举失败独立但文案准确 |
| 视觉基线被无意改动 | 健康态场景断言元素 `hidden` 与 composer 几何；degraded / gap 基线人肉过目 |
| 诊断日志泄露内容 | 白名单只允许 `kind` / `code` / `partial` / `path`；单测断言不含正文类字段 |

## 10. 验收矩阵（先红后绿）

「先红」= 在实现前先写断言并观察到失败；「后绿」= 实现后同一断言通过。每条都给出可复跑的
落点。

### 10.1 Rust（机器，主判据）

| # | 判据 | 落点 | 先红形态 |
|---|---|---|---|
| R1 | 当前写健康：annotation 干净失败 → `degraded(annotation)` 且无 gap；成功 → `ok`、无 gap | `jsonl.rs` 单测 | 无健康字段，红 |
| R2 | `llm_request` 失败 → `degraded(history)` + gap；成功 → `state=ok` 但 `history_gap.present=true`；恢复事件发出 | `jsonl.rs` / `events.rs` 单测 | 无两维，红 |
| R3 | 缺口随 `Session::rotate` 沿用；新文件首次成功 → `state=ok`、gap 仍 true | `session.rs` 单测 | 无 gap，红 |
| R4 | 切 vault 不清健康；A→B→A 后 A 的 gap 仍在；不跨 vault 发事件 | `harness.rs` 单测 | 无健康，红 |
| R5 | severity / gap 触发：`session_title` 干净失败 = annotation/no gap；`llm_request` 干净失败 = history/gap；`approval` 部分写 = history/gap | `jsonl.rs` 单测 | 无分类，红 |
| R6a | 首行干净失败 + `llm_request` payload：挂起行保留；重试成功后首行合法，但本次 payload 永久缺失、gap=true；断言文件里没有该请求、后续成功未补回 | `jsonl.rs` 单测 | 现状丢挂起行 / 无 gap，红 |
| R6b | 首行干净失败 + annotation payload：挂起行保留；首行重试成功后 `state=ok`、gap=false；annotation 丢失不 latch | `jsonl.rs` 单测 | 无分类，红 |
| R7 | 前缀写后报错：`degraded(history)` + gap；后续成功不清 gap；系统不声称文件可恢复 | `jsonl.rs` 单测（注入 `LineSink` 写 N 字节后 Err） | 无故障注入，红 |
| R8 | 快照与事件的两维 + `history_written` 键集合逐字相同；`empty` / 旧快照无害；轮次外写点发事件；隔离实例不发 | `session.rs` / `events.rs` / `harness.rs` 单测 | 无键 / 无出口，红 |
| R9 | 新会话 / 恢复重置两维 + `history_written`；app 重启从空开始；诊断日志含 `partial` 且不含正文 | `harness.rs` / `logging.rs` 单测 | 无健康 / 无事件变体，红 |
| R10 | `history_written`：首条 history 成功前 false；成功后 true 并发事件；rotate 沿用；新会话重置；不影响 gap | `jsonl.rs` / `session.rs` 单测 | 无字段，红 |

### 10.2 前端单测（机器）

| # | 判据 | 落点 | 先红形态 |
|---|---|---|---|
| U1 | `recoveryBackup` reject → 横幅出现且含路径；跨路径累积；某路径成功 → 该条消失；写失败子条件全清且无枚举失败 → 横幅撤下 | `tests/unit/save-controller.test.ts` | 现状吞错，横幅不存在，红 |
| U2 | 转 clean / 放弃 / 改名 → 该路径写失败态清除 | 同上 | 无失败态，红 |
| U3 | 存在未恢复的写失败时，MUST NOT 出现「已备份」类成功语义 | 同上 | 无状态，红 |
| U4 | `persistence` 事件 → 状态行显示、文案按 severity 分档；`ok` 且无 gap → 隐藏 | `tests/unit/harness-panel*.test.ts` | 无事件分支，红 |
| U5 | 旧快照缺 `persistence` / `history_gap` / `history_written` 键 → 视为 `ok` / `present=false` / `history_written=true`（不误报「尚未落盘」） | 同上 | 无解析，红 |
| U6 | 面板重进 / 重载快照 → 两维 + `history_written` 按快照重建 | 同上 | 无重建，红 |
| U7 | 本逻辑会话首次进入 history（含 `annotation→history`）只给一条 sticky；`annotation` 只亮状态行；重挂载不重复 | 同上 | 无分支，红 |
| U8 | 新事件类型不被 IPC 白名单丢弃 | `tests/unit/harness-event-whitelist.test.ts` | 未加白名单分支，红 |
| U9 | `state=ok` + `history_gap.present=true` → 状态行显示缺口文案，MUST NOT 回到健康态 | `tests/unit/harness-panel*.test.ts` | 无 gap 解析，红 |
| U10 | 切 vault 不清本地状态；切回同一会话显示其 gap；不把 B 的状态串进 A | 同上 | 无分 vault 处理，红 |
| U11 | 关闭 sticky 只移除提示；状态行仍在、gap 不清；不构成静音；新逻辑会话可再次触发 | 同上 | 无关闭语义，红 |
| U12 | 枚举失败子条件独立：写失败子条件清空后横幅仍在；重新检查成功只清枚举条件 | `tests/unit/save-controller.test.ts` | 单条件实现，红 |
| U13 | `history_written=false` + 告警 → 状态行出现「本次会话的新记录尚未落盘，退出后无法恢复」；`history_written false→true` 后该句消失、gap 文案仍在 | `tests/unit/harness-panel*.test.ts` | 无字段，红 |

### 10.3 视觉（结构层进 CI，像素层本地）

| # | 判据 |
|---|---|
| V1 | 健康态：状态行与横幅均 `hidden`；composer 几何与既有基线一致（守「不打扰」） |
| V2 | 当前写失败态：状态行可见 + 文案按 severity + `role="status"`；像素基线 Alex 过目后 `--update` |
| V3 | `state=ok` + gap 态：状态行显示「写入已恢复但此前记录缺失」，MUST NOT 隐藏；像素基线 Alex 过目后 `--update` |
| V4 | 横幅：写失败 / 枚举失败 / 两者同时三种形态可见；`hidden` 时零占位、可见时不覆盖正文 |

### 10.4 真机（WKWebView，本地）

| # | 场景 | 可达性 |
|---|---|---|
| A1 | **健康时不打扰**：正常会话 + 正常 dirty 文档 → AX 中无留存 / 备份告警文案 | 可达（负向，最有价值） |
| A2 | **文档备份失败可见**：`envWrite` 在 `<env>/lumir/recovery` 写一个**普通文件**（早于首次备份）→ 键入 → 等 4s → 断言横幅出现、vault 内文件未被改写 | 可达 |
| A3 | 横幅「全部保存」→ 内容进 vault；受影响路径转 clean，写失败子条件清空且无枚举失败 → 横幅撤下（见 §5.6） | 可达 |
| A4 | 保存失败（目标不可写 / 冲突）→ 横幅保留，并给出既有保存失败提示 | 可达 |
| A5 | **枚举失败独立保留**：`seed.envFiles` 预置 `<env>/lumir/recovery` 为普通文件 → 启动时 `recovery_list` 失败 → 编辑触发写失败 → 「全部保存」后写失败子条件清空，但横幅仍以「无法检查残留备份」保留 | 可达 |
| A6 | A2 之后 `restart`：重启后**再编辑一次**、等备份窗口 → 横幅重现（失败态不靠持久化） | 可达 |
| A7 | harness 写入失败正面注入 | **不可达**：会话目录 / 文件名由 app 生成；阻断父目录会变成「发送被拒」而非记录失败。由 R1–R10 与视觉桩承担，提案与 tasks 如实标注 |

### 10.5 验收场景维护

- 新增场景覆盖 A1–A6；`envWrite` / `seed.envFiles` 造失败面的场景须在正文说明「为什么这是
  真实可达的失败面」。
- 回扫既有场景里依赖 `env:recovery` 的断言（08c / 08d 等），确认新增横幅不会改变它们的
  期望；如出现文案碰撞，改断言而不是改产品语义。
- 场景证据落 `.local/acceptance/`（不落 worktree）。

## 11. 实现骨架（给实现者，不是给 Alex 的裁决面）

| 层 | 落点 | 要点 |
|---|---|---|
| Rust 健康 | `harness/jsonl.rs` | 两维 `PersistenceHealth` + `history_written` + `Serialize`；gap latch；首行失败按本次 payload 判 gap；部分写跟踪；`LineSink` 测试 seam |
| Rust 首行 | `harness/jsonl.rs` | 写成功后再 `take()`（或失败回填）；MUST NOT 丢挂起行；本次 payload 丢失按 history/annotation 判 gap；删除绝对可恢复承诺 |
| Rust 会话 | `harness/session.rs` | `Session::new` 建健康；`persistence()` 投影；`rotate` 两维 + `history_written` 沿用；新会话 / 恢复重置；`StateSnapshot` / `empty` 加键 |
| Rust 事件 | `harness/events.rs` | `persistence` 构造函数；两维 + `history_written` 同序列化；`degraded→ok` + gap、`history_written false→true` 也发事件 |
| Rust 运行时 | `harness.rs` / `lib.rs` / `turn.rs` | `Runtime.forward`；`TauriEventSink` 提升可见性；装配 / 隔离实例不装配；切 vault 不动健康 |
| Rust 日志 | `logging.rs` | `PersistenceWriteFailed` 变体 + `kind` / `code` / `partial` / `path` 白名单 |
| 前端 IPC | `src/ipc.ts` | 联合加 `persistence`；白名单加分支（`harness-event-whitelist` 会守） |
| 前端面板 | `src/harness-panel.ts` | 两维状态行；gap 文案优先；`history_written=false` + 告警时的未落盘提示；sticky 首次 history（含 annotation→history）；关闭不等于静音；分 vault 快照 |
| 前端保存 | `src/save-controller.ts` | `failedPaths`；写失败 / 枚举失败两个独立条件；查询 + 变更通知；`recovery_list` 失败条件 |
| 前端装配 | `src/main.ts` / `src/tabs.ts` | 横幅 DOM（文档区顶部、全局一条、两段子条件）；`saveAllDirty` / `重新检查`；标签后缀；`stickyToast` 接线 |
| 文案 | `src/copy-data.ts` + 文案 deck | 新增 D 编号（实现时按 deck 末号续接），zh / en 同批，占位名一致；含「尚未落盘，退出后无法恢复」句 |

**不需要动 bindings**：`StateSnapshot` 不导 ts-rs。但新增 `LogEventName` 变体会重导
`src/bindings/**`，按门禁纪律先 `git add` 再跑 quick。

## 12. 已知边界汇总

- **部分写可能使 JSONL 不可读**；本 change 只保证「不丢挂起行 + 如实告警」，不保证可恢复、
  不修复、不截断、不做原子发布。绝对可恢复保证需要另立 change。
- **首行干净失败 + history payload**：该 payload 随本次调用丢失，gap 置 true；重试成功后
  首行合法但那条记录不会补回。若 app 在重试成功前退出，运行期已告警，重启后不补报（非
  持久化边界不变）。
- **首行干净失败 + annotation payload**：annotation 丢失不 latch；首行重试成功后当前写
  健康回 `ok`、gap 为 false（annotation 没有独立历史系统）。
- **尚未任何 history 写盘**时，只要存在持久化告警，状态行必须提示「退出后无法恢复」；
  重启后不补报，仍由非持久化边界承担。
- harness 写失败无法在真机稳定注入（A7），由 Rust 单测 + 视觉桩承担。
- 健康只覆盖单次 write 成功与否，不覆盖 `fsync` / 断电 / 外部删除。
- 不追溯提示既有不可读留存文件。
- 隔离运行不呈现健康。
- 切 vault 不重置健康；app 重启重置（会话表清空）。
- webview 整页重载会重置前端「已提示」标记，sticky 可能重复一次；状态行不重复累积。
- 文档失败态不跨 app 重启、也不跨 webview 整页重载；横幅靠下一次真实失败重现。
- 横幅顶部常驻条需要调整 `.pane-editor` 的横向 flex 布局；健康态 MUST 零像素漂移。
