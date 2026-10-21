# Design: add-cron-runtime-daemon

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 单一 capability `cron`：通用定时任务机制。机制只认「调度 + 自然语言 prompt + 会话形态 + 触达
> 策略 + 可选模型覆盖」，不认任何具体任务的知识（路径、笔记格式、完成条件都不在机制里）。
> 原稿的 `note-templates` 原语已按 2026-10-18 重构裁决摘除，本文件不再出现模板定义、模板实例化与
> `{{date}}` 占位符的设计。

## 1. 形态总览

```
              ┌─────────────── 触发源（同一个判定函数）────────────────┐
              │  ① 进程内定时器（30s tick，纯内存比较）                 │
              │  ② 启动就绪后一次                                     │
              │  ③ 主窗口获得焦点（200ms 去抖）                        │
              │  ④ 目标 vault 打开成功后一次                           │
              └───────────────────────┬───────────────────────────────┘
                                      ▼
                    decide(task, now, last_fired) -> NotDue | Done | Fire
                                      │ Fire
              ┌───────────────────────┴────────────────────────┐
   delivery=notify-then-run                          delivery=run-then-notify | silent-run
              │                                                │
   投递通知（正文＝「到点」）                          在运行槽位发起运行（prompt 送入既有会话通道）
   成功后写 last_fired                                交接成功后写 last_fired
              │                                                │
   用户点击 ──► 聚焦窗口 → 打开目标 vault（必要时）      run-then-notify：运行终态后投递结果通知
              → 在交互会话槽位发起运行                  silent-run：不通知
                                                               │
                                                    点击结果通知 ──► 恢复该次运行的会话
```

两条链路共用同一份运行实现（既有 harness 装配与发送通道）与同一份留存（per-vault 会话 JSONL）。
机制侧只有「何时叫醒、投递什么、记录什么」。

## 2. 任务模型：五要素与「机制不知道什么」

任务 = `{id, vault, at, days?, prompt, delivery?, session?, model?}`。五要素是调度（`at` + `days`）、
自然语言载荷（`prompt`）、会话形态（`session`）、触达策略（`delivery`）、可选模型覆盖（`model`）；
`id` 是身份，`vault` 是运行坐标。逐字段的职责边界：

| 字段 | 要素 | 机制拿它做什么 | 机制 MUST NOT 拿它做什么 |
|---|---|---|---|
| `id` | 身份 | 去重状态的键、诊断事件的 `task`、通知标题 | 不得据此分支任何行为 |
| `vault` | 目标 | 运行的目标 vault；判定当前 vault 是否匹配 | 不得解析路径、不得探测文件存在性 |
| `at` / `days` | 调度 | 计算「是否到点」 | 不支持表达式、不支持一天多次 |
| `prompt` | 载荷 | 原样作为一条用户消息送入既有发送通道 | 不得解析、不得替换占位符、不得改写 |
| `delivery` | 触达策略 | 决定到点后通知还是运行、运行后是否通知 | 不得携带任务专属文案 |
| `session` | 会话形态 | 决定 session id 从哪来（新建 / 专用会话） | 不得感知会话内容 |
| `model` | 可选覆盖 | 解析为该次会话的模型覆盖 | 不得内置模型清单 |

**机制不知道的事**（这是本次重构的核心判据，也是验收场景之一）：

- 任务要写哪个文件、路径怎么拼、日期怎么进文件名——由 prompt 与 vault 的 `AGENTS.md` 表达。
- 「今天是不是已经做过了」——由运行时 agent 读文件判断；机制只做「当日是否触发过」的去重。
- 任何任务名、路径、小节标题的字面量——代码里 MUST NOT 出现（`daily-log` 只活在配置样例里）。
- 环境怎么初始化、上下文怎么装配——沿用既有 harness 装配（`src-tauri/src/harness/context.rs`
  的三层 AGENTS 注入），机制不加任何自己的装配逻辑。

## 3. 单一判定函数

```rust
// src-tauri/src/cron.rs —— 无 tauri 依赖、无文件 IO、不读时钟
pub struct CheckInput<'a> {
    pub at_minutes: u16,             // 由 `at` 解析
    pub days: &'a [Weekday],         // 缺省 = 全周
    pub now: LocalNow,               // { date: "YYYY-MM-DD", weekday, minutes_since_midnight }
    pub last_fired: Option<&'a str>, // cron-state.json 里的本地日期
}

pub enum Decision { NotDue, Done, Fire }

/// 纯函数：不读时钟、不碰磁盘。四个触发源都只走它。
pub fn decide(input: &CheckInput) -> Decision;
```

判据：

```
due   = today ∈ days && now.minutes_since_midnight >= at_minutes
Decision = NotDue if !due
         = Done   if last_fired == today
         = Fire   otherwise
```

- **没有「已满足」这一档**。原稿的 `Satisfied`（当日实例文件已存在）是任务知识；新形态下「是否真的
  需要做事」由 prompt 在运行时判断（例如「已存在就直接用它，不要改写」）。机制只保证「当日至多触发
  一次」。
- **判定 MUST NOT 读文件系统、MUST NOT 写盘**。定时器 tick 因此是纯内存比较。
- 判定结果对四个触发源完全一致；「何时调用」是唯一差别（§4）。

## 4. 触发源与时间口径

### 4.1 定时器

一个专用线程 `lumir-cron`，在 setup 末尾（窗口已显示、`ready` 已发出之后）spawn：

```
loop {
    recv_timeout(tick = 30s)   // 或收到 poke 立即醒
    for task in snapshot.tasks {
        match decide(...) { Fire => dispatch(task, trigger = Timer), _ => {} }
    }
}
```

- 周期评估零文件 IO；任务量在几十条以内无感（单用户日常 1–3 条）。
- 启动装载时读一次配置并快照；运行期不热重载（与 `editor.mode` / `ui.markdown_line_numbers` 同
  口径），改任务需重启，写进 `config-reference.md` 的「生效时机」列。
- 线程在 setup 返回前 spawn 即返回，不做同步 IO；冷启动 <300ms 合同无接触面（ADR 0002 第 6 条）。
- 系统休眠期间线程停摆，唤醒后的下一次 tick 把「已过点」判出来——同一判定函数，无需专门处理。

### 4.2 拉取兜底

三个时机，共用一个 poke 通道（不阻塞事件循环、不在回调里做 IO）：

| 时机 | 落点 | 行为 |
|---|---|---|
| 启动就绪后一次 | `lib.rs` setup 尾部（`ready` 之后） | 投一次 poke；线程内跑同一判定 |
| 主窗口获得焦点 | `RunEvent::WindowEvent` 的 `WindowEvent::Focused(true)` | 投一次 poke；200ms 内重复投递合并（防抖） |
| 目标 vault 打开成功 | `commands::open_vault` 的提交点（两条打开命令共用）+ 启动恢复的提交点（`RestoreGuard::finish`） | 投一次 poke（`run-then-notify` / `silent-run` 在目标 vault 未打开时会被延后，见 §6.5）；不在 tick 上观察 vault 变更 |

补触发语义由 §3 自动覆盖：已过点 + 当日未触发 ⇒ 触发一次；当日已触发 ⇒ 静默；未到点 ⇒ 不动作。
**跨日不补**：00:00 后「今天」变成新日期，昨日错过的任务不补——提醒与环境准备的意义在当天。

### 4.3 时间口径

- **本地时间**：`chrono::Local`（`chrono` 已在依赖树内，作为直接依赖引入）。本地日期用于「今天」
  与去重，本地时分用于「到点」。
- **判据形态**：「本地时钟越过 `at`」而不是「恰好等于 `at`」；tick 抖动、休眠、晚启动都不影响正确性。
- **DST**：跳过的小时 → 下一次 tick 即为已过点；重复的小时 → 当日去重挡住第二次。
- **时钟回拨**：本地日期倒退时保留既有 `last_fired`，最多抑制当天一次触发（保守方向），不删记录。

## 5. 三档触达策略

| `delivery` | 到点时 | 运行由谁发起 | 运行后 | 点击通知 | `last_fired` 写入时机 | 无人点头时的 token 花费 |
|---|---|---|---|---|---|---|
| `notify-then-run`（缺省） | 投递「到点」通知 | 用户点击通知 | — | 聚焦 → 打开目标 vault（必要时）→ 发起运行 | 通知投递成功 | 0 |
| `run-then-notify` | 静默发起运行 | 机制 | 终态后投递「已完成 / 运行失败」通知 | 聚焦 → 恢复该次运行的会话 | 运行交接被接受 | 一次运行 |
| `silent-run` | 静默发起运行 | 机制 | 不通知 | 无通知可点 | 运行交接被接受 | 一次运行 |

三档的**运行实现完全相同**（§6）；差别只在「何时通知、谁发起运行、点击落地到哪」。

### 5.1 `notify-then-run`（默认）

1. 到点 → 投递通知（标题 = 任务 id，正文 = 通用文案「到点」）→ 投递成功才写 `last_fired`。
2. 用户点击通知 → `cron_click`（`action = "run"`）→ 聚焦窗口 → 目标 vault 不是当前 vault 时先走
   既有 vault 打开链路 → 在**交互会话槽位**发起运行（用户看着它跑）。
3. **点击即意图**：没有点击就没有模型调用。这是默认档的理由，也是「无人点头不花 token」的落点。
4. **重复点击幂等**：当日该任务已有运行会话（`cron-state.json` 的 `session_id`）时，第二次点击只
   聚焦并恢复该会话，不重复运行。

### 5.2 `run-then-notify`

1. 到点 → 在**运行槽位**（与交互会话分离，§6.2）发起运行；交接被接受才写 `last_fired`。
2. 运行到达终态（完成 / 失败 / 中止）→ 投递结果通知（正文只含「已完成」或「运行失败」）。
3. 点击结果通知 → `cron_click`（`action = "open-session"`）→ 聚焦并恢复该次运行的会话；不重新运行。
4. 运行卡在批准闸（需用户批准的工具调用）→ 中止本次运行并投递「运行失败」通知（§6.4）。

### 5.3 `silent-run`

1. 到点 → 运行槽位发起运行；不投递任何通知。
2. 结果只留在会话留存与诊断事件里；用户经既有会话历史查看（per-vault 会话列表）。
3. 失败同样不通知，只落 `cron_run_finished(ok=false)` 与错误码——这是静默档的定义，不是缺陷。

### 5.4 失败与不派发

| 情形 | 是否写 `last_fired` | 后续行为 |
|---|---|---|
| 通知投递失败（权限 / 插件错误） | 否 | 下一次 tick 再试；最小重试间隔 = tick（30s），不形成风暴 |
| 运行交接被拒（目标 vault 不是当前 vault） | 否 | 当日下一次拉取触发重试（§6.5）；定时器不再重复尝试 |
| 运行交接被拒（该任务上一次运行仍在进行） | 否 | 落 `cron_run_skipped(reason=busy)`；下一次拉取触发重试 |
| 运行失败 / 因需批准而中止 | 是（已在交接时写入） | 当日不自动重试（避免无人值守下的 token 风暴）；`run-then-notify` 通知失败，`silent-run` 只落诊断 |
| 通知权限被拒 | 否（通知链路整体不可用） | 一条人话 warning；`notify-then-run` 任务因此不可用，用户可改用 `run-then-notify` / `silent-run` 或删掉该任务 |

## 6. 运行装配与会话形态

### 6.1 职责边界

- **Rust 侧（`cron.rs` + `lib.rs`）**：判定、去重、通知投递与点击回调、运行交接、结果回执落状态。
  它不知道 harness 会话怎么装配、prompt 会被怎么解释。
- **前端（`src/main.ts` 的单一处理器）**：收到运行交接后，确保目标 vault 已打开 → 选择会话槽位 →
  按会话形态建立 / 恢复会话 → 经既有发送通道把 prompt 作为一条显式消息送出 → 回执结果。
  MUST NOT 写第二套打开、装配或发送实现。

交接事件 `cron:run` 载荷是「运行契约（`RunSpec`）+ 任务载荷」的组合（change
`add-harness-subagents` design §2.4）：契约字段平铺，任务载荷是 sibling 字段。`RunSpec` 刻意不含
任务知识，因此 vault / prompt / 会话形态 / 模型覆盖仍由本 change 的任务模型表达。

```json
{ "origin": { "kind": "cron", "task": "<task-id>", "run_id": "…" },
  "session_target": { "kind": "unattended", "key": "…" },
  "tool_policy": { "allow": ["vault_read", "…"] },
  "budget": { "max_rounds": 50, "max_tokens": 0 },
  "approval_policy": { "kind": "reject_unavailable" },
  "background": false,
  "trigger": "timer",
  "vault": "/abs/path", "prompt": "…",
  "session": "new", "session_id": null, "model": "…" }
```

- `session_target` / `approval_policy`：定时与拉取运行是 `unattended` + `reject_unavailable`；
  点击发起是 `interactive` + `interactive`（用户就在现场，批准卡照既有方式出现，§6.2）。
- `tool_policy` 是**被执行**的契约值，不是声明：运行入口在拿到 busy 后把它交给运行层，
  `SessionContext` 构造时按 `allow` 过滤工具定义（`src-tauri/src/harness/run.rs` 的
  `filter_tool_definitions`）。因此本 change 声明的 8 件 vault 工具白名单在
  `[harness.subagents].enabled = true` 时同样生效——无人值守运行看不见委派工具 `task`；
  交互**发送**（用户输入，不是 cron 交接）没有运行契约，仍是完整注册表。两个槽位（无人值守
  与点击发起的交互槽）都消费同一份契约值。
- `trigger` 只服务诊断事件 `cron_run_started.trigger`；行为分支只读契约枚举，不读这个字符串。
- `session_id` 只在 `session = dedicated` 时携带（来自 `cron-state.json` 的续写会话）；`new` 档为
  `null`。运行槽位的实现落点是 `Runtime::isolated()` 的独立运行时实例（见 §6.2 的「等价形态」）。

回执命令 `cron_run_result({ run_id, ok, session_id?, error? })`：前端在运行终态（含中止、失败、
需批准而中止）调用一次；Rust 据此更新 `cron-state.json` 的 `session_id`、投递结果通知（按策略）、
落诊断事件。**终态只由前端回执一处产出**，Rust MUST NOT 另据字符串或事件流猜成功与否
（REVIEW.md「同一语义两处真源」条）。

### 6.2 会话槽位：交互会话与运行槽位分离

harness 运行时的会话按 vault 键控、每个 vault 一个活跃槽位（`Runtime` 以 `VaultScope` 的键存
会话，UI 命令永远作用于当前 vault 的槽位）。无人值守运行若直接复用这个槽位，会替换用户正在看的
会话——这是不可接受的副作用。因此：

- **运行槽位**与**交互会话槽位**分离：`run-then-notify` / `silent-run` 在运行槽位执行，MUST NOT
  改写、重置或替换用户当前会话；其事件 MUST NOT 渲染进用户当前会话的 transcript。
- `notify-then-run` 的点击运行是显式意图，运行落在**交互会话槽位**，用户能看见它跑。
- 运行槽位的实现落点（把会话键扩为 `(vault, 槽位)`，或等价的独立运行时实例）归实现期；行为判据
  只有一条：**无人值守运行前后，用户当前会话的内容与槽位不变**。
- 落盘不受槽位影响：每次运行仍按既有 per-vault 布局写会话 JSONL（`<config>/harness/sessions/
  <vault-id>/<session_id>.jsonl`），因此运行结果能经既有会话历史找到、能被既有恢复链路打开。

### 6.3 会话形态

| `session` | 语义 | session id 来源 | 消费者 |
|---|---|---|---|
| `new`（缺省） | 每次触发新会话，上下文互不污染 | 运行槽位新建 | 默认；独立任务（如每日日记） |
| `dedicated` | 每任务一个专用会话，后续触发续写 | `cron-state.json` 的 `session_id`；缺失则新建 | 需要跨次累积上下文的任务（如每周回顾要看到上周结论） |

- `dedicated` 的续写走既有恢复链路（`harness_resume_session` 语义：读源会话、续写新文件），
  回执带回新的 `session_id`，Rust 覆盖状态里的值。
- **推荐**：v1 两档都交付、缺省 `new`——两档共用同一条运行路径，差别只是 session id 的来源，
  缺一档会让 `session` 字段退化成装饰（裁决点见 proposal 第 2 条）。
- `dedicated` 的上下文增长由既有自动压缩机制处理，本 change 不新增策略。
- 同一任务同一时刻只允许一个在途运行（§5.4 的 `busy`）；`dedicated` 因此不会并发续写。

### 6.4 权限与批准

- 运行沿用既有 harness 权限闸（`[harness].permission_mode` / 规则表），MUST NOT 因为「无人值守」
  而自动放行或自动拒绝。
- 无人值守运行（运行槽位）遇到需要批准的调用：立即中止本次运行（错误码 `approval_required`），
  不无限挂起；`run-then-notify` 投递「运行失败」通知，`silent-run` 只落诊断。v1 不做「批准请求
  通知」，见 proposal Non-goals。
- `notify-then-run` 的点击运行落在交互槽位，批准卡照既有方式出现，用户就在现场。

### 6.5 目标 vault 不是当前 vault

事实约束：harness 会话与「当前打开的 vault」绑定（`commands::VaultState` 单一当前 vault，
`harness_send` 由它解析 scope）。因此无人值守运行 MUST NOT 静默切换用户的 vault：

- 到点时目标 vault 不是当前 vault ⇒ 该次运行延后，不写 `last_fired`；定时器不重复尝试（避免日志
  噪音），由当日下一次拉取触发重试（打开该 vault / 切前台）。
- 当日始终没有打开目标 vault ⇒ 当日不运行，落 `cron_run_skipped(reason=vault_not_current)`；
  **不跨日补**（与 §4.2 同口径）。
- `notify-then-run` 不受此限：通知已投递，点击时按既有 vault 打开链路打开目标 vault（这是用户
  点击带来的显式意图）。

### 6.6 消息注入与草稿

- prompt 作为**显式消息参数**送入既有发送通道；MUST NOT 写入或覆盖用户的 composer 草稿。
- 发送通道若当前只接受「读 composer 再发」，实现期把它参数化为「显式文本 + 可选附件」，仍只有
  一份发送实现（REVIEW.md「同一语义两处真源」条）。
- 若目标 vault 的 harness 会话正忙（用户正在发送），无人值守运行按 `busy` 延后（§5.4）；
  `notify-then-run` 的点击运行遇到忙碌时给出人话提示，不排队。

## 7. 配置面（配置即数据）

### 7.1 形状

```json
{
  "cron": {
    "tasks": [
      {
        "id": "daily-log",
        "vault": "<daily-vault>",
        "at": "21:00",
        "prompt": "按本 vault 的 AGENTS.md 的「日记」约定，确保今天的日记存在：不存在就按骨架新建，已存在就直接用它，不要改写。完成后用一句话给出今天日记的路径。",
        "delivery": "notify-then-run",
        "session": "new"
      },
      {
        "id": "vault-consistency",
        "vault": "<work-vault>",
        "at": "10:00",
        "days": ["sun"],
        "prompt": "检查 notes/ 目录下所有文档之间互相引用的标题是否与目标文档的实际标题一致；把不一致项列成一张清单，不要直接改文件。",
        "delivery": "run-then-notify",
        "model": "<declared-model-id>"
      }
    ]
  }
}
```

- 两条任务形状相同、内容完全不同——这就是「一个月后不要 daily log、改要一致性检查」的答案：改配置，
  不改代码。
- `<daily-vault>` / `<work-vault>` / `<declared-model-id>` 都是占位符；真实 vault 路径与真实模型
  id 按仓库信息卫生纪律不入库。
- `[cron]` 整节错形状（如 `"cron": "daily-log"`）走既有解析模型的**整文件回落**；表内**逐项**校验
  （`[harness].permissions` / `vault.ignore` 先例）：坏一项只丢那一项 + 一条人话 warning，其余照常
  生效。未知字段忽略（config.rs 既有向前兼容口径）；原稿的 `[note_templates]` 不再被识别，作为未知
  键忽略。

### 7.2 校验

| 字段 | 合法 | 非法处置 |
|---|---|---|
| `tasks` | 数组 | 非数组 / 整节错形状 → 整文件回落（serde 期） |
| `id` | 非空、无空白 | 丢该项 + warning；**重复 id** 保留首项、丢后项 + warning |
| `vault` | 绝对路径字符串 | 非绝对 → 丢该项 + warning（路径是否存在不在此判定：装载期 stat 会拖慢启动，且外置盘可能后挂载） |
| `at` | `HH:MM`，`00:00`–`23:59` | 非法 → 丢该项 + warning |
| `days` | 可选；`mon`/`tue`/`wed`/`thu`/`fri`/`sat`/`sun` 的非空数组；缺省 = 全周 | 含非法值 / 空数组 → 丢该项 + warning |
| `prompt` | 必填；trim 后非空的字符串 | 缺失 / 空白 / 非字符串 → 丢该项 + warning（没有载荷的任务无从运行） |
| `delivery` | 可选；`notify-then-run` / `run-then-notify` / `silent-run`；缺省 `notify-then-run` | 闭集合外取值 → 回落缺省 + warning，**保留任务**（向「不花 token」的保守方向回落） |
| `session` | 可选；`new` / `dedicated`；缺省 `new` | 闭集合外取值 → 回落 `new` + warning，保留任务 |
| `model` | 可选；非空字符串 | 形状非法 → 只丢 `model`、保留任务 + warning；运行期未在 `[harness].providers.<provider>.models` 声明 → 本次回落 provider 默认模型 + `config_warning`（不丢任务） |
| 未知字段 | 忽略 | — |

- 一条 warning 一条原因：一项任务只报第一处问题（与 `vault.ignore` 先判名字的口径同族）。
- `"tasks": []` ⇒ 守护空转、零报错。
- 不支持 cron 表达式、一天多次、任意条件表达式或脚本声明（proposal Non-goals）。

### 7.3 字段消费者（REVIEW.md「值或开关声明了却没有消费者」条）

| 字段 | 消费者 |
|---|---|
| `id` | `cron-state.json` 的键、诊断事件 `task`、通知标题 |
| `vault` | 运行的目标 scope；§6.5 的当前 vault 比对 |
| `at` / `days` | §3 判定函数 |
| `prompt` | `cron:run` 载荷 → 既有发送通道 |
| `delivery` | §5 的派发分支 |
| `session` | §6.3 的 session id 来源 |
| `model` | 会话建立时的模型覆盖 |

### 7.4 首个配置样例的 vault 侧约定（不是产品代码）

`<daily-vault>/AGENTS.md` 里写约定，例如（合成样例，非真实 vault 内容）：

```markdown
## 日记
- 每天一篇：`daily/YYYY-MM-DD.md`（本地日期）。
- 新建时用这个骨架：frontmatter `date: YYYY-MM-DD`，小节 `## 记录`、`## 反思`。
- 已存在就只使用它，不要改写既有内容。
```

运行时 harness 的既有装配会把 vault 根 `AGENTS.md`（与 `AGENTS.local.md`）注入系统上下文
（`src-tauri/src/harness/context.rs`），任务 prompt 只需引用这份约定。产品代码不认识 `daily/`、
`## 记录` 或任何占位符。

## 8. 触发去重状态

`<config>/cron-state.json`（配置目录根下，与 `window-state.json` / `vault-sessions/` 同级）：

```json
{
  "version": 1,
  "tasks": {
    "daily-log": { "last_fired": "2026-10-18", "session_id": "20261018-210512-a1b2" }
  }
}
```

- **`last_fired`**：本地日期，写入时机见 §5 表（派发成功才算）。它是「当日至多一次」的唯一依据。
- **`session_id`**：该任务最近一次运行落到的会话（`new` 档是当次会话，`dedicated` 档是专用会话）。
  消费者：结果通知点击后的恢复（§5.2）与 `dedicated` 的续写（§6.3）。前端回执时带回，Rust 覆盖。
- **为什么不进 `config.json`**：这是易变运行状态，不是用户声明（与 `window-state.json` 同理由）。
- 写入：tmp + rename 原子替换；写失败降级 warning（最多导致一次重复通知 / 重复触发，接受）。
- 读取：文件缺失 / 不可读 / 非合法 JSON / `version` 不符，四类一律视为「无状态」，不抛错、不阻断
  启动；缺失是常态不告警，其余三类各一条 warning。
- 任务从配置删掉后，其状态记录惰性残留（不主动清理——无消费者、无体积问题）。

## 9. 分层、依赖与性能

- **无 tauri 依赖**（ADR 0002 第 7 条）：
  - `src-tauri/src/cron.rs`：任务数据类型（或从 `config.rs` 借用）、`decide`、`at` / `days` 解析、
    状态文件读写、tick 常量。
  - `src-tauri/src/lib.rs`：唯一 tauri 接线层——线程启动、poke 通道、通知投递、点击回调、运行交接
    事件、结果回执落状态。副作用以回调形式注入，判定模块不知道通知或窗口存在。
- **依赖新增**：`tauri-plugin-notification`（2.6+，Rust 侧 API，桌面点击回调自 2.6.0 起可用）、
  `chrono`（本地时间；锁文件已在树内）。两者都不经 webview，`src-tauri/capabilities/default.json`
  零增量。
- **性能**：setup 内只 spawn 线程（微秒级）；tick 30s 一次、纯内存比较；通知权限查询一次；
  状态文件只在派发成功时写（一天几次）。冷启动 / keypress-to-paint 合同无接触面。
- **日志**：六个事件名进 `logging::LogEventName` 白名单（§11），字段值上限 256 字符的隐私护栏不变；
  日志日期口径仍是 UTC（不改 `logging.rs` 的既有裁决）。

## 10. 首个配置样例端到端时序（daily log，`notify-then-run`）

配置 = §7.1 第一条任务（`at = "21:00"`，`delivery = "notify-then-run"`，`vault = <daily-vault>`）。

| 时刻 | 触发源 | 判定 | 结果 |
|---|---|---|---|
| 20:59 | tick | `NotDue` | 无动作 |
| 21:00:14 | tick | `Fire` | 投递「到点」通知；`last_fired` 写 `2026-10-18`；无模型调用 |
| 21:04 | 用户点击通知 | — | `cron_click` → 聚焦 → 目标 vault 已是当前 vault → 交互槽位新建会话 → 发送 prompt |
| 21:04:20 | 运行时 agent | — | 读 `AGENTS.md` → 今天日记不存在 → 按骨架创建 → 回答给出路径 |
| 21:04:21 | 前端回执 | — | `cron_run_finished(ok=true)`；`session_id` 写入状态 |
| 21:05 / 22:30 | 切前台 / tick | `Done` | 无动作、无写盘 |
| 次日 21:00 | tick | `Fire` | 新一天重新允许触发 |

若目标 vault 次日不是当前 vault：通知照常投递（`notify-then-run` 不受 §6.5 限制），点击时打开它。

## 11. 诊断事件与观测口径

| 事件 | 时机 | 字段（≤256 字符） |
|---|---|---|
| `cron_notified` | 通知投递成功 | `task`、`kind`（`trigger` / `result` / `failure`）、`trigger`（`timer` / `startup` / `focus` / `vault-open`） |
| `cron_click` | 点击通知处理完成（含失败） | `task`、`ok`、`action`（`run` / `open-session`）、`error`（错误码，可选） |
| `cron_run_started` | 运行交接被前端接受 | `task`、`trigger`、`session`（`new` / `dedicated`）、`model`（可选） |
| `cron_run_finished` | 运行到达终态（含失败 / 中止） | `task`、`ok`、`error`（错误码，可选） |
| `cron_run_skipped` | 该次不派发 | `task`、`reason`（`vault_not_current` / `busy` / `not_ready`） |
| `cron_task_invalid` | 装载期丢弃任务项 | `task`（id 或空）、`field`、`reason` |

成功 / 失败的终态**只在 `cron_run_finished` 一处产出**（由 §6.1 的回执带来），其它事件不重复判定
（REVIEW.md「同一语义两处真源」条）。

观测口径（诊断用途，不构成任何「删除能力」的判据）：

```bash
# ① 点击发起运行（click = intent）
rg -c '"event":"cron_click".*"ok":true' ~/.config/lumir/logs/
# ② 运行成功（含静默运行与点击发起的运行）
rg -c '"event":"cron_run_finished".*"ok":true' ~/.config/lumir/logs/
```

读数用法：两条合计为 0 只说明「这条链路最近没被用过」，是判断**某条任务**要不要换档（改
`delivery`）或删掉该任务的输入；`cron_notified` 高而 `cron_click` 长期为 0 说明该任务的提醒没在
帮忙；`cron_run_skipped` / `ok=false` 说明链路有故障，按缺陷处理。

## 12. 测试矩阵（机器验收面）

**单元（`cron.rs`，注入 `now` / `last_fired`，不碰系统时区）**

- `decide` 真值表：`due × fired` 四格；`days` 过滤（`days=[wed]` 在周二 / 周三）；跨日边界
  （昨日 23:59 与今日 00:01）。
- `at` 解析：`00:00` / `23:59` / `24:00` / `9:5` / `21:60` / 带空格 / 缺冒号。
- DST 形态用注入的「本地分钟数」构造；时钟回拨时保留 `last_fired`。
- 状态文件：缺失 / 损坏 / `version` 不符 → 无状态 + warning；原子写后内容可回读；`session_id`
  读写往返。
- 配置校验：§7.2 每个非法形态各一条用例，断言「丢该项 / 回落 + 其余生效 + warning 文案」。

**契约（`lib.rs` / 前端接线层，可测的部分）**

- `cron:run` 载荷形状：`RunSpec` 字段（`origin` / `session_target` / `tool_policy` / `budget` /
  `approval_policy` / `background`）+ 任务载荷（`trigger` / `vault` / `prompt` / `session` /
  `session_id` / `model`）；契约合成点 `cron::handoff` 有单测钉线格式。
- 工具白名单被执行：`tool_policy.allow` = 8 件 vault 工具时，运行上下文（`SessionContext`）
  的工具定义恰为这 8 件；即使 `[harness.subagents].enabled = true` 也不含 `task`。交互发送
  路径没有契约，仍注册第 9 件（两条用例的区分度即在此）。
- `cron_run_result` 回执后：状态更新、`cron_run_finished` 的 `ok` 与错误码、`run-then-notify` 只在
  终态后投递结果通知。
- 运行槽位隔离：无人值守运行前后，交互会话槽位的内容与 id 不变。
- 目标 vault 不是当前 vault：无人值守运行不派发、不切换、不写 `last_fired`，落
  `cron_run_skipped(vault_not_current)`；打开该 vault 后按同一判定补跑一次。
- 日志白名单接受六个新事件名；失败码 `approval_required` / `vault_not_current` / `busy` 在场。

**真机验收（`scripts/acceptance/scenarios/`，新增）**

到点触发靠「把 `at` 写成下一次分钟边界」；拉取触发靠「`at` 写今日已过时刻 + 清空
`cron-state.json`」；运行侧用 `provider: mock` + fixture 固定回答。

| 场景 | 步骤 | 断言 |
|---|---|---|
| 到点通知（`notify-then-run`） | 隔离 `XDG_CONFIG_HOME` 写一条任务（`at` = 下一分钟）；清状态；起 app；等过点 + 余量 | ① 到点前 / 后目标 vault 零写入（判定不写盘、未点击不运行）；② `cron-state.json` 出现今日 `last_fired`；③ 截图证据：通知横幅在场；④ 日志无 `cron_run_started`（未点击不花 token） |
| 点击发起运行 | 接上一条，经 KimiCU 按截图坐标点击横幅本体 | `cron_click(ok=true, action=run)`；`cron_run_started`；`cron_run_finished(ok=true)`；harness 面板出现任务 prompt 与回答；会话 JSONL 落在目标 vault 目录 |
| `run-then-notify` | 同一任务改 `delivery=run-then-notify`（`at` = 下一分钟）；清状态；起 app | 到点**无**「到点」通知；`cron_run_started` 在无点击情况下出现；运行终态后截图有结果通知横幅、`cron_notified(kind=result)` 在场；点击后该会话被恢复（`cron_click(action=open-session)`） |
| `silent-run` | 改 `delivery=silent-run`；`at` = 今日已过；清状态；起 app | 运行发生（`cron_run_started` / `cron_run_finished(ok=true)`）；日志**零** `cron_notified`；会话留存可经会话历史列出 |
| 配置非法项丢弃 warning | 两条任务：一条 `at="25:00"`、一条合法；起 app | 启动成功；日志一条 `cron_task_invalid(field=at)` 与人话 warning；合法任务照常按判定触发；非法任务零 `cron_run_started` |
| 当日去重 | 配置 `at` = 今日已过 + `notify-then-run`；清状态；起 app → 通知一次；`restart`；多次切前台 | 全程只有一条 `cron_notified(kind=trigger)`；`last_fired` 保持今日；无第二条横幅 |

**通知相关的验证边界（如实写进场景注释）**：横幅属系统通知中心进程，不在 Lumir 的 AX 树里，`ax`
读不到；主判据是「按截图坐标点击横幅 → 应用内行为可被 `ax` / `file` / 日志断言」。KimiCU 以系统
通知中心为目标的点击能力是实现期工具面未知数，需先核实；横幅位置不稳定时降级为「点开通知中心再
点」并保留截图；仍不可自动化时场景标 INVALID 并按 README 口径报运行无效，不伪造 PASS。dev flavour
（`pnpm tauri dev` 直接 exec 二进制）下 macOS 通知权限 / 投递可能不可用（未签名的非 bundle 进程）
——实现期先验证；不可用则改用打包 `.app` 实例跑该组场景，并在证据里写明 flavour。

## 13. 已知边界与风险

- **应用未运行 = 无触达**：这是运行时守护的定义（proposal Non-goals）；不做系统级守护。
- **无人值守运行不切换 vault**：目标 vault 未打开时延后到当日拉取触发，当日未打开则不运行（§6.5）。
  这是「不抢用户界面」的代价，接受并如实记录。
- **无人值守运行遇到批准闸即中止**：不自动放行、不挂起等待；`run-then-notify` 收到失败通知，
  `silent-run` 只落诊断。需要「批准请求也能通知」属于后续扩展。
- **运行槽位的实现成本**：把 harness 会话键扩为 `(vault, 槽位)`（或等价形态）是本 change 对
  harness 运行时的唯一结构性改动。若实现期发现成本超出本 change 边界，停下上报；MUST NOT 静默改成
  「复用并重置用户当前会话」。
- **没有「打开文件」工具**：agent 能建、能改、能读，不能在编辑器里开标签；`notify-then-run` 点击后
  进入的是会话而不是文件（proposal 裁决点 6）。要改须另裁新增工具。
- **通知文案通用**：不读 prompt 摘要、不含路径与内容（锁屏隐私）；代价是通知本身信息量低，靠任务
  id 的可读命名弥补。
- **点击上报的平台口径**：插件文档写明桌面端点击「as far as the notification server reports it」，
  且只对「投递时监听器已在场」的通知上报。macOS 实现把响应登记绑在每条通知自己身上：投递成功
  （系统确认已送达）后为这条通知起一个响应等待线程（`spawn_notification_click_waiter`），点通知
  本体 → `CronMessage::Click` 交给 `lumir-cron` 线程；非 macOS 仍走插件的 `on_action`，启动时
  注册一次并常驻。两条路径分工相同：回调只投工作项，判定与副作用都在 cron 线程上。
  > **M620 实现期修订（本条的第一次更正）**：草案曾写「我们启动即常驻监听，覆盖自身投递的通知」
  > （插件 `on_action` 口径）。投递改走 notify-rust 直连后，平台按 `UNNotificationRequest` 的
  > request id 路由响应，**每条通知都必须有自己的响应登记**——插件内部同样每条通知起一个 wait
  > 线程，`on_action` 只是它的分派出口；启动时注册一次的 `on_action` 只覆盖插件自己投递的通知，
  > 绕开后收不到点击。实现取「投递成功后登记响应等待线程」，与原口径**行为等价**：同一个
  > `CronMessage::Click`、同一份 cron 线程处理、同样的 tap 语义（非 tap 动作同样落 warning）；
  > 差异只在登记时机与归属（随每条通知登记 vs 启动时常驻）。平台约束仍满足：响应通道随这条通知的
  > 请求一起建立（发出前注册），不是点击后才补。真机依据：M620 的 170 / 171 两条点击链路 PASS。
- **应用退出后的残留通知**：进程已退出时点击通知最多把 app 拉起来，没有运行上下文（不会自动打开
  会话）；与「应用未运行无触达」同类边界。
- **运行中退出应用**：`last_fired` 已写，当日不重跑；会话留存里能看到半截运行，诊断有记录。
- **多机重复**：iCloud 同步的 vault 在每台 Mac 上各自判定与触发；不做跨机去重。
- **配置不热重载**：改任务 / 策略需重启（与既有配置口径一致）。
- **通知权限被拒 = `notify-then-run` 失效**：判定照常，但无法投递；该档任务会静默失效，用户可换
  `run-then-notify` / `silent-run` 档或删掉该任务。
- **任务量假设**：tick 每任务一次纯内存判定；几十条以内无感，本 change 不为此做索引。
- **专用会话的上下文增长**：交给既有自动压缩；本 change 只支持一天一次触发，这不是主要矛盾。

## 14. 统一抽象的重审点（对设计真源的回应）

设计真源（`.local/design/harness-vision.md`，git 外）要求「动工任一原语前应先落实『触发器 +
上下文装配 + 工具循环 + 留存』统一抽象，避免两个功能各写一套调度」。本 change 的落法：

- **已共用**：上下文装配（`harness/context.rs`）、工具循环（`harness/turn.rs`）、发送通道与会话
  留存全部复用既有实现；cron 只是新增了一类触发源与一套触达策略，没有第二套运行实现。
- **运行契约已接入**（M593，change `add-harness-subagents` design §2.4）：`cron:run` 交接载荷不再
  字段自列，改由 `cron::handoff` 纯函数合成「`RunSpec` + 任务载荷」；定时 / 拉取运行是
  `SessionTarget::Unattended` + `ApprovalPolicy::RejectUnavailable`，点击发起是
  `SessionTarget::Interactive` + `ApprovalPolicy::Interactive`。运行循环仍是既有唯一实现。
- **尚未抽象**：触发器层（cron 的调度 + 投递）仍是 cron 自己的；Subagents 落地时 MUST 回抽公共层
  「触发 → 装配 → 运行 → 留存」，把 cron 的触发源与 Subagents 的委托触发一起接入该层，MUST NOT
  让 Subagents 另写一套调度。provider 请求闸（每 provider 一个计数信号量、许可数
  `max_concurrent + 1`、父请求优先、子请求 FIFO）已随 change `add-harness-subagents` §4.9 落地
  （`harness/scheduler.rs`）；cron **自动共用**同一个闸——`SessionContext::request_permit` 在每次
  provider 请求前取许可，隔离槽位取 `Child` 优先级、交互槽位取 `Parent`，cron 侧零新增接线。
  届时若 cron 的运行路径与该抽象不兼容，先改抽象再进实现——与真源「动工任一原语前先落实抽象」
  的方向一致；本 change 不在 Subagents 之前预造空壳抽象。
