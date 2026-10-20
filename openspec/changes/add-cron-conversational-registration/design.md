# Design: add-cron-conversational-registration

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 语义坐标：cron 机制本身由 `add-cron-runtime-daemon` 定义（任务 = 调度 + 自然语言 prompt +
> 会话形态 + 触达策略 + 可选模型覆盖；运行沿用既有 harness 装配）。本 change 只加**入口**——
> 三件调度工具、一条运行期重载通道、一段系统提示词、一组权限档，**不改判定函数、不改运行路径**。

## 1. 形态总览

```
用户在会话里说：「每天 21:00 提醒我写今日 log」
        │
        ▼
  agent（交互会话，工具定义含 3 件调度工具）
        │  cron_task_create {id:"daily-log", at:"21:00", prompt:"…"}
        ▼
  权限闸（ask 档）── 批准卡：五要素 + 「今天不补触发」──── 用户采纳 ──┐
        │ 拒绝：回送模型，配置零改动                                  │
        ▼                                                            │
  单条校验（与装载期同一个 validate_cron_task）◄──────────────────────┘
        │ 非法：{"ok":false,"code":"cron_task_invalid",…}
        ▼
  统一写通道（读—改—写同一把锁 + 原子替换）→ config.json 的 cron.tasks
        │
        ▼
  投 CronMessage::Reload(ack) ──────────────► lumir-cron 线程
                                                   │ 重读 config.json（唯一真源）
                                                   │ 重建任务集（新增 / 移除）
                                                   │ 新任务且「已过点」→ 写当日种子
                                                   │ 任务集非空 → 补检通知权限
                                                   ▼
                                              ack { tasks, seeded } ──► 工具回执
                                                                        （effect / skip_today）
```

三条不变量贯穿全文：

1. **任务表只有一处真源**：`config.json` 的 `cron.tasks`。工具写它、线程读它；reload 消息**不带
   任务载荷**，否则就有了第二份可能漂移的任务表。
2. **去重状态只有一个写者**：`cron-state.json` 只由 `lumir-cron` 线程写（派发成功 / 注册种子）。
   工具**不碰**状态文件。
3. **校验只有一份实现**：「什么是一条合法任务」由 `config.rs` 的单条校验函数定义，装载期与工具
   调用同一个。

## 2. 工具面

### 2.1 命名与分类

| 工具 | 动作 | 类别 |
|---|---|---|
| `cron_task_create` | 注册一条任务 | 调度工具（编排工具类的第二组） |
| `cron_task_list` | 列出任务与最近触发日 | 同上 |
| `cron_task_remove` | 删除一条任务 | 同上 |

- **对象 + 动作**命名，与 `skill_load` 同族（`vault_*` 是「对象_动作」，`task` 是单动词）。
- **三件独立工具，不用 `cron_task(op=…)`**：权限层按工具名分层（`permissions.rs` 的
  `READ_TOOLS` 与 `mode_layer` 都是按名字 match）；单工具多 op 会把「list 放行、create 要问」
  推进 op 判别，等于在权限层新造一条真源。代价是工具清单多两件——这个代价由 ADR 0007 的显式
  裁决承担（proposal 裁决点 1）。
- **不操作 vault**，因此不走「写且需防护才有 vault 工具」的判据；`TOOL_NAMES`（8 件 vault 工具）
  **不变**，另立 `CRON_TOOL_NAMES: [&str; 3]`。

### 2.2 注册面：只在交互发送路径

```rust
// src-tauri/src/harness/run.rs —— SessionContext::tool_definitions
let mut definitions = gate_tool_definitions(
    tools::definitions_with_subagents(&self.catalog),
    self.config.subagents.enabled,
);
if self.tool_policy.is_none() {          // 交互路径：没有交接契约
    definitions.extend(tools::cron_definitions());
}
filter_tool_definitions(definitions, self.tool_policy.as_ref())
```

由此得到的边界，全部由既有机制自动成立，**不需要**新增开关：

| 路径 | 是否可见三件调度工具 | 由什么保证 |
|---|---|---|
| 交互发送（用户输入） | 是 | `tool_policy = None` |
| 无人值守运行（cron 定时 / 点击） | 否 | 交接契约 `tool_policy.allow = TOOL_NAMES`（8 件） |
| 子运行（`task`） | 否 | 定义白名单的元素必须是 `TOOL_NAMES` 成员（`agents.rs` 的定义校验） |

**这就是「定时运行不能给自己排新任务、子代理不能排任务」的实现**——不是纪律，是类型。验收里各
配一条断言钉住（§11）。

### 2.3 参数 schema

`cron_task_create`：

| 参数 | 类型 | 必填 | 缺省 | 口径 |
|---|---|---|---|---|
| `id` | string | 是 | — | 任务身份；非空、不含空白、不与既有任务重复；同时是通知标题 |
| `at` | string | 是 | — | `HH:MM`（本地时间），`00:00`–`23:59` |
| `prompt` | string | 是 | — | **自包含**的自然语言载荷（运行期是另一个会话，看不到本次对话） |
| `days` | string[] | 否 | 全周 | `mon`…`sun` 的非空子集 |
| `vault` | string | 否 | 当前 vault 根 | 绝对路径 |
| `delivery` | string | 否 | `notify-then-run` | `notify-then-run` / `run-then-notify` / `silent-run` |
| `session` | string | 否 | `new` | `new` / `dedicated` |
| `model` | string | 否 | 缺席 | 非空字符串；运行期按 provider 声明解析 |

`cron_task_list`：无参数。
`cron_task_remove`：`id`（必填）。

`prompt` 的「自包含」无法机器判定（那需要理解语义），因此写在工具 `description` 与提示词段里，
归抽样观察，**不进机器判据**（与「路径引用纪律」的遵从度同口径）。

### 2.4 返回值与错误码

沿用既有结果信封（成功 `{"ok":true,…}`、失败 `{"ok":false,"code","message"}`，
`src-tauri/src/harness/tools.rs` 模块头）。

```jsonc
// create
{ "ok": true, "task": { "id": "daily-log", "vault": "/abs/path", "at": "21:00",
                        "days": ["mon","tue","wed","thu","fri","sat","sun"],
                        "delivery": "notify-then-run", "session": "new" },
  "effect": "active", "skip_today": false }

// list
{ "ok": true, "tasks": [ { "id": "…", "vault": "…", "at": "…", "days": ["…"],
                           "delivery": "…", "session": "…",
                           "last_fired": "2026-10-19" } ] }

// remove
{ "ok": true, "id": "daily-log", "effect": "active" }
```

- `effect`：`active` = 运行时已确认重载；`pending_restart` = 配置已写入但线程未确认（ack 超时 /
  通道断），下次启动生效。**只有 `active` 才算「已生效」**——工具回执不许把「写了文件」说成
  「任务已生效」。
- `skip_today`：注册时刻已过点 ⇒ `true`（见 §8）。agent 据此对用户说准话（「今天不会再提醒，
  明天 21:00 开始」）。
- `list` 的 `last_fired` 读的是 `cron-state.json`（只读、原子替换保证读到的是完整版本）；
  文件缺失 / 损坏时该字段为 `null`，不报错（与线程的读取纪律同口径）。
- 错误码：
  | code | 时机 |
  |---|---|
  | `cron_task_exists` | `create` 的 `id` 与既有任务（含装载期被判非法而丢弃的项）重名 |
  | `cron_task_not_found` | `remove` 的 `id` 不存在 |
  | `cron_task_invalid` | 任一项校验失败；`message` 携带 `field` 与该字段的人话原因（与装载期同一文案） |
  | `config_write_failed` | 落盘失败（沿用 `config.rs` 既有错误码，不新增同义码） |

**不做静默覆盖**：同名 `id` 直接报错，连同 `message` 指出既有任务的 `at`，让模型自己决定是
`remove` 还是换 `id`。装载期的「重复 id 保留首项、丢后项」口径只适用于手写配置（那份配置的
作者是自己改坏的），不适用于工具（工具可以在写之前拒绝）。

## 3. 运行时注册通道

### 3.1 消息变体

```rust
// src-tauri/src/lib.rs
enum CronMessage {
    Poke(cron::Trigger),
    RunResult(cron::RunResult),
    Click { task: String },
    /// 任务表可能变了：重读配置并替换任务集（载荷为空——配置是唯一真源）。
    Reload { ack: std::sync::mpsc::Sender<ReloadOutcome> },
}

struct ReloadOutcome { applied: usize, seeded: Vec<String>, error: Option<String> }
```

- **复用既有工作项通道**（`CronRuntime.inner.tx`，`src-tauri/src/lib.rs:766-850`）：通知点击的
  `on_action` 已经走这条通道投工作项，reload 是同一形状的第二类消息，不新发明 IPC。
- **不带任务载荷**：线程自己 `config::load()` 重读。带载荷等于在进程里放第二份任务表，两份迟早
  分叉（REVIEW.md「同一语义两处真源」条）。
- **一次性回执**（`ack`）：工具侧 `recv_timeout(1s)` 等结果，把「已生效 / 未确认」如实写进回执。
  1s 是上限：工具跑在 LLM 线程上，不阻塞 UI；线程处理 reload 只是一次小文件读。

### 3.2 线程不再因空表退出

现状：任务表为空时线程直接 `return`（`src-tauri/src/lib.rs:958`），此后进程里没有任何 cron 消费者，
`Reload` 只会把消息投进一个没有接收端的通道。本 change 把该 `return` 改为「空表空转」：

```
loop {
    recv_timeout(TICK) →
      Poke(trigger)         => evaluate(trigger)        // 空表时 evaluate 是零次循环
      RunResult(result)     => finish(result)
      Click { task }        => handle_click(task)
      Reload { ack }        => reload(ack)              // 新增
      Timeout               => evaluate(Timer)
      Disconnected          => return
}
```

- 空表空转的成本：每次 tick 一次空的 `for` 循环，可忽略（ADR 0002 §6 的性能合同不受影响：tick
  仍不碰磁盘）。
- 线程起不来（spawn 失败）仍降级为「定时任务不启用」+ warning（既有行为）；此时 `Reload` 的
  sender 会在启动时就已断开，工具回执走 `pending_restart`。

### 3.3 reload 处理顺序

1. `config::load()`；失败 → **保留现有任务集**（不因一次坏读清空任务）+ `config_warning` +
   `ack.error`。清空任务集会让「配置文件被外部编辑器写坏一瞬间」变成「今天所有提醒消失」。
2. 重建 `Vec<ScheduledTask>`（`parse_at` + vault 路径规范化，与启动装载同一段代码——抽成
   `fn schedule_of(snapshot) -> Vec<ScheduledTask>` 供两处调用）。
3. 计算新增 id（现任务集里没有的）→ 对每条新增任务判「注册时刻是否已过点」：
   `today ∈ days && now.minutes_since_midnight >= at_minutes` 成立 ⇒ 在状态里写当日种子
   （`last_fired = today`，§8）。状态落盘走 `cron.rs` 既有的原子写。
4. 替换 `self.tasks` 与 `self.loop_max`（后者是 `max_rounds` 的来源，装载期快照的那份要一起换）。
5. **in-flight 与移除的交界**：任务被删时，其 `inflight` 记录**保留**（该次运行的回执还要落到
   状态与诊断），但不进入后续派发；`skipped_today` / `clicked_today` 里属于被删任务的记录清除
   （纯内存，无消费者）。
6. 任务集非空且通知权限尚未检查过 → 补检一次（`ensure_notification_permission`）。这是本 change
   必须补上的一步：现状只在「启动时有任务」的路径检查权限（`src-tauri/src/lib.rs:989`），
   对话注册的任务会静默投不出通知。
7. `ack` 回 `{applied, seeded, error}`。

> **为什么 reload 只能由线程做**：任务集是线程的私有态（`CronRunner.tasks`），跨线程直接改它
> 就要引入第二把锁与两处派发路径。消息是唯一入口，与「判定与副作用全在 `lumir-cron` 线程上」
> 的既有分层一致。

### 3.4 手改 `config.json` 不单独触发重读

不做文件监听，也不在 tick / 焦点上重读配置：

- 重读会把「配置生效时机」变成不确定——用户正在编辑的文件、写了一半的文件、临时回退的版本都会
  在某一刻被读进来；由此要定义「重读失败的降级」「warning 是否重复刷屏」「任务被临时删掉又加回」
  一整组语义，成本远高于收益。
- 本 change 的需求是「对话注册即生效」，不是「配置编辑即生效」。两条通道的差异**写进
  `config-reference.md` 的生效时机列**，用户看得到。

**但重载本身读的是文件，不是内存快照**（§3.3 第 1 步的 `config::load()`）。因此准确表述是：运行期
**不因文件变化**而重读；**注册通道触发的重载必然重读整份文件**，先前未重启生效的手改会被这一次
重载一并吸收——包括手改新增的任务按「新增任务」规则写当日种子（§8）。这不是额外语义，是「配置是
唯一真源 + 重载重读整份文件」的必然推论；把它写明是为了不让文档承诺实现不会兑现的「手改一定等到
下次启动」。spec 的对应 scenario（「运行期任务集重载」/「任务定义与配置校验」两处）按同一口径写。

`AppConfig.cron` 的注释（`src-tauri/src/config.rs:164-165`）、`CronRunner.loop_max` 的注释
（`src-tauri/src/lib.rs:1015`）与 `config-reference.md:262` 三处「不热重载」表述在同一 change 内
改准（REVIEW.md「设定类现状断言」条：改设定必须清扫旧表述，不留新旧并存）。

## 4. 持久化与写通道

### 4.1 走既有统一写通道，并把锁的范围补对

现状两条写入口：`config::write_json_atomic`（原子写 + `CONFIG_WRITE_LOCK`）与
`commands::write_config_value_to`（读 → 改 → 写，读发生在取锁之前）。M592 / M600 修的是
「tmp 名冲突」与「绕开统一通道」，**读—改—写的竞态窗口仍在**：两个写者可以各自读到旧版本，
后写者把前者的改动顶掉（丢键）。

本 change 在 `config.rs` 增加一个把三件事放进同一把锁的入口，工具与后续写者共用：

```rust
// src-tauri/src/config.rs
/// config.json 的「读—改—写同锁」入口：锁内读整份 JSON、交给闭包改、再原子替换。
pub(crate) fn update_json_atomic(
    path: &Path,
    f: impl FnOnce(&mut serde_json::Value) -> Result<(), CommandError>,
) -> Result<(), CommandError>;
```

- 复用既有 `CONFIG_WRITE_LOCK`（`src-tauri/src/config.rs:1768` 一带）与 `write_file_atomic`；
  不新增第二套原子写实现。
- `commands::write_config_value_to` 与 `write_last_vault_to` **不在本 change 的迁移面内**（它们
  各有调用方与测试，迁移属独立收口）；本 change 只保证新写者走同锁入口，并把这条差异记进
  `docs/backlog.md`（tool 侧写配置的并发窗口）。引入第二份实现才是禁令，复用同一把锁不是。

### 4.2 只写用户给了的键

`cron_task_create` 写入配置项时**只写模型实际给出的字段**：缺省的 `delivery` / `session` /
`days` / `vault` 不写进文件。

- 理由 `config-reference.md` §3 的写回纪律：把缺省值写进 `config.json` 会把「跟随出厂默认」钉死
  成写入当天的取值；日后默认档一变，旧任务仍按老档跑。
- `vault` 是例外：它**必须**落成绝对路径（缺省时填当前 vault 根）——`vault` 是运行坐标，不是
  策略旋钮，缺省值无法在运行期重新推导（那时当前 vault 可能已经换了）。
- `version` 由既有 `bump_config_version` 补齐（不在锁外自己写）。

### 4.3 工具不写状态文件

`cron-state.json` 的写者只有一个：`lumir-cron` 线程（派发成功、运行回执、注册种子）。工具侧只
**读**（`list` 的 `last_fired`）。

- 两个写者会让「谁最后写」变成状态一致性的问题；而线程本来就持有状态的内存副本，工具再写一遍
  必然与内存副本分叉。
- 注册种子由线程在 reload 时写（§3.3 第 3 步），因此种子的时钟口径与派发判定的时钟口径是同一个
  `LocalNow::now()`，不会出现「工具按 A 时刻判、线程按 B 时刻判」的分裂。

## 5. 校验复用

`validate_cron`（`src-tauri/src/config.rs:2100` 起）现在把「逐项判定」写在循环里。抽出一个单条
校验函数，装载期与工具共用：

```rust
/// 校验一条任务项。「什么是一条合法任务」的唯一定义。
fn validate_cron_task(
    item: &serde_json::Value,
    position_label: &str,          // 装载期：「cron.tasks 的第 N 项」；工具：「cron_task_create」
    existing_ids: &[String],       // 重复 id 的判据（装载期 = 已生效项；工具 = 文件里的全部 id）
) -> Result<CronTask, CronTaskIssue>;
```

- **一处定义**：字段顺序（`id` → `vault` → `at` → `days` → `prompt` → `delivery` → `session` →
  `model`）、致命 / 非致命的分界、每条 warning 的文案，全部只在这一个函数里。
- 工具侧的差异只有两点：① 致命项**不回落、直接报错**（`cron_task_invalid` + `field` + 同一句
  原因）；② 重复 id 在工具侧是致命（报 `cron_task_exists`），在装载期仍是「保留首项 + warning」。
- 「已生效项」与「文件里的全部 id」的差别：工具做唯一性检查时，判据是**文件里出现的全部 id**
  （含那些装载期已被丢弃的非法项）——否则文件里会有两条同 id 的项，下次启动的「保留首项」会把
  刚写进去的那条丢掉。这是本 change 唯一一处对装载期口径的**加严**，写进 spec。
- 不做类型容忍：`"at": 21` 之类形状错误报 `cron_task_invalid(field=at)`，与装载期同一句原因。

## 6. 权限档与批准卡

### 6.1 档位矩阵（`permissions.rs` 的 `mode_layer` 增加三支）

| 工具 | `read_only` | `vault_write`（默认） | `full_access` | 批准卡 |
|---|---|---|---|---|
| `cron_task_list` | Allow | Allow | Allow | — |
| `cron_task_create` | Ask | Ask | Allow | 五要素 + 注册日口径 |
| `cron_task_remove` | Ask | Ask | Allow | id + at + 「删除后不再触发」 |

- `list` 进 `READ_TOOLS`（读类，三档放行）。它读的是配置与状态，不是 vault——但「读类默认放行」
  这条语义不依赖被读对象的类型，它依赖「没有副作用」。
- `create` / `remove` 与 `vault_delete` 同形（打断成本高，但 `full_access` 档的承诺是不打断）。
  理由见 proposal 裁决点 2：定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后每天会自己
  跑」的时机。
- deny / allow 规则照旧生效（第 1 / 第 4 层），无需专门接线。

### 6.2 主体串（会话内批准缓存的键）

`permission_subject`（`src-tauri/src/harness/tools.rs:314`）现在对没有 `path` 参数的工具回落到
空串——`cron_task_create` 会被缓成一个 `.lumir-hp` 级的**总开关**：用户对某条任务点了「本会话
不再问」，此后任何任务创建都不再问。加一支：

```rust
"cron_task_create" | "cron_task_remove" => {
    let id = args["id"].as_str().unwrap_or("");
    let at = args["at"].as_str().unwrap_or("");
    let days = args["days"].as_array().map(join_days).unwrap_or_default();
    format!("{id} {at} {days}")     // 规范化交给 permission_cache::normalize_subject
}
```

- **不含 `prompt`**：主体串会进缓存键、批准事件与诊断（日志字段有 256 字符上限），prompt 可能含
  用户的私密内容。prompt 全文只出现在批准卡上（用户当场看），不进日志。
- `id + at + days` 是用户对这条任务最容易复述的「同一条任务」判据；改了 prompt 但时间不变时，
  缓存会放行——这是刻意的：改 prompt 不改变「它是哪个定时任务」这件事，而 prompt 本身在批准卡
  上仍然完整可见。

### 6.3 批准卡呈现

`ApprovalPreview` 增加一个字段（与 `diff` / `argv` / `purpose` 并列）：

```rust
pub struct ApprovalPreview {
    // …既有字段…
    /// 定时任务预览（cron_task_create / cron_task_remove）：五要素的待批准快照。
    pub cron_task: Option<serde_json::Value>,
}
```

事件载荷键 `cron_task`，形状：

```jsonc
{ "op": "create", "id": "daily-log", "at": "21:00", "days": ["mon", …],
  "delivery": "notify-then-run", "session": "new", "vault": "/abs/path",
  "prompt": "…全文…", "skip_today": false }
```

**视觉保真（无原型，按既有批准卡版式延伸；实现后由 Alex 手感裁决）**：

- 位置：在既有卡片 `.lumir-hp-approval` 内，紧跟判定依据行（`.lumir-hp-approval-basis`）之后，
  在采纳 / 拒绝按钮之前——与 diff 块、argv 块同一层级。
- 结构：一个 `.lumir-hp-approval-cron` 块，内部两列键值（`时间` / `星期` / `触达` / `会话` /
  `目标 vault`），键名右对齐次级灰（复用 `.lumir-hp-approval-basis` 的颜色 token），值等宽字体；
  其下是 prompt 全文，用既有 argv 块的等宽样式（`.lumir-hp-argv` 的字族与底色，**不新增配色**）。
- 文案：「今天已过点，注册后今天不再触发」/「今天照常触发」一行，位置在键值块之下——这是用户
  批准前最需要知道的一条。
- 语言：文案进 `src/copy-data.ts` 的双语文案表（`D` 编号），不在 TSX 里硬写中文。
- 不做：不做折叠、不做编辑（卡片只读，要改就让 agent 重新发起）、不做 diff 风格的高亮。

## 7. 系统提示词增订

### 7.1 形态：新固定段，不塞进 identity

新增 `src-tauri/src/harness/prompts/cron-reference.md`，与 `quote-reference.md` /
`path-reference.md` 同族（编译期 `include_str!` + 仓内路径常量 + 装配清单条目）。

- **为什么单独成文件**：identity 段的职责是身份与通用工具纪律；cron 段是**能力 + 禁区**，两者
  生命周期不同（能力表述会随工具面演进）。单独成文件也让 `session_open.assembly` 多一条可审计的
  来源记录（`cron_reference`）。
- **注入位置**：`assemble_system` 里 path_reference 之后、AGENTS.md 三层之前（与既有固定段顺序
  并列，MUST NOT 依赖目录枚举顺序）。
- **不注入子运行**：`assemble_system_for_subagent` 不追加该段——子运行的工具白名单里没有这三件
  工具（§2.2），告知即噪音；子运行的身份段由定义正文替换，注入机制级 cron 段会与「定义只承载
  任务身份」的既有分工冲突。

### 7.2 正文（起草稿，实现期照抄；改动须回改本节）

```markdown
定时任务：
- 用户说「每天 / 每周几 / 到点提醒我 / 定时检查一下」时，用 cron_task_create 在本机 Lumir 里注册
  定时任务；它只在 Lumir 运行时触发，不需要、也不许另建系统级调度。先 cron_task_list 看有没有
  同名或重复的任务，改任务 = cron_task_remove + cron_task_create。
- 定时任务的 prompt 要自包含：到点运行时是一个新会话，看不到你们现在这段对话。写清「做什么、在
  哪个目录、产出放哪、不要做什么」。
- 默认触达策略是 notify-then-run（到点只提醒，用户点通知才运行）；用户没明确要「自动跑完再告诉我」
  时不要改成 run-then-notify / silent-run。
- 不许用 cli_run 手搓系统级调度：LaunchAgent plist / launchctl / crontab / at / systemd timer /
  登录项 / 第三方调度器一律不做。用户要求「Lumir 没开也要跑」时，说明这是产品明确的边界，由用户
  决定是否另开能力，不要自己找替代路径。
```

- 三条各对应一个缺口：能力告知 / 使用纪律 / 禁区。
- **遵从度不进机器判据**（与「路径引用纪律」同口径：mock provider 代表不了真实模型的书写习惯）；
  归抽样观察——验收套件只钉「段在场 + 装配清单有条目」。

## 8. 注册日不补触发

既有判定口径是「已过点 + 当日未触发 ⇒ 触发」（`cron.rs` 的 `decide`），对**启动 / 焦点 / vault
打开**三个拉取触发是对的：「我错过了，补给我」。但它不适用于「刚刚注册」：用户 21:30 说「每天
21:00 提醒我」，若照搬，注册后 30 秒内就会弹一条通知——刚说完话又被提醒一次。

规则（只作用于运行期注册引入的新任务，不影响启动装载）：

```
reload 时对每条新增任务：
  due_now = today ∈ days && now.minutes_since_midnight >= at_minutes
  due_now ⇒ 在 cron-state.json 写 last_fired = today（当日种子），ack.seeded 里带上该 id
  !due_now ⇒ 不写，当日按判定正常派发（20:00 注册 at=21:00 的任务今天照常提醒）
```

- **为什么写 `last_fired` 而不是新字段**：`last_fired` 的消费者只有一个语义——「该任务在本地的
  这一天是否已经派发过 / 当日不再派发」。种子正是这个语义（今天不再派发），而派发成功时写的也
  是同一件事。加一个 `seeded_on` 字段会让 `decide` 多一个输入、状态多一个无人清理的键。
  该字段的语义在 spec 与 `config-reference.md` 里一并写准（MODIFIED「触发去重状态与持久化」）。
- **为什么不是「注册日整天跳过」**：太粗——20:00 注册的 21:00 任务今天应该照常响。判据是「注册
  那一刻是否已过点」，与既有判定函数用同一组输入（`at` / `days` / 本地时间），不新造时钟口径。
- **为什么要在 reload 里而不是工具里算**：时钟口径只能有一个（线程的 `LocalNow::now()`）；工具侧
  算一次会让「工具说今天不触发、线程说触发」在 1 秒的窗口里分裂。工具只**展示** ack 回来的
  `skip_today`。
- **点击语义不受影响**：`notify-then-run` 的点击仍落在交互槽位（既有口径）；本规则只决定「当天
  有没有那一条通知」。
- 备选（Alex 可否决）：照既有拉取口径立即补触发一次。适合「我就是要它现在跑一次」的场景，但
  用户没说这句话时是噪音——而且用户完全可以手动说「现在就跑一遍」。

## 9. 不做任务面板

任务可见面 = `config.json`（唯一真源）+ 通知 + 会话留存 + 诊断事件。不做面板的理由：

1. **第二个真源**：面板要维护一份任务列表，就得回答「外部编辑 `config.json` 后它同步吗」
   （不监听文件 ⇒ 不同步 ⇒ 面板展示过期数据；监听 ⇒ 落进本 change 明确不做的文件监听面）。
2. **没有增量价值**：单用户日常 1–3 条任务；创建与删除本来就在对话里发生。面板只在「任务多到
   需要浏览 / 批量停用」时有价值，而那正是当前不存在的场景。
3. **成本结构不对称**：面板是视觉面（原型、视觉基线、视觉门禁、手感裁决），而本 change 的验收
   完全可以落在行为面（工具被调 → 配置变化 → 任务触发）。用视觉面成本换行为面的等价信息不划算。
4. **触发条件写明**：出现「想在不打开配置文件的前提下看清单 / 暂停某条任务」的真实摩擦时另立
   change（`enabled` 开关也属那时）。

## 10. 诊断事件

| 事件 | 时机 | 字段（≤256 字符） |
|---|---|---|
| `cron_task_registered` | 工具写入成功且 reload 已确认（`effect=active`） | `task`、`at`、`days`（规范化串）、`delivery`、`session`、`skip_today` |
| `cron_task_removed` | 同上 | `task`、`effect` |
| `cron_task_rejected` | 工具拒绝（校验失败 / 重名 / 不存在 / 落盘失败） | `task`（可空）、`field`、`code` |
| `config_warning`（既有） | reload 重读配置失败、状态落盘失败、ack 超时 | `source = "cron"` |

- **不带 prompt**：prompt 全文只在批准卡（用户当场看）与会话留存里，不进诊断日志——日志会长期
  留在本机、字段有 256 字符截断，prompt 的私密内容不该有第二条落点。
- 成功 / 失败的终态仍只在既有 `cron_run_finished` 一处产出；本 change 的三个事件记录的是
  **注册动作**，不是运行结果（REVIEW.md「同一语义两处真源」条）。
- `logging.rs` 的 `LogEventName` + `allowed_fields` 各加三条（白名单外的键会被丢弃）。

## 11. 测试矩阵（机器验收面）

**单元（`config.rs` / `cron.rs` / `tools.rs` / `permissions.rs`）**

- 校验复用：同一组非法形态（`at="25:00"` / 空 `id` / 非绝对 `vault` / 空 `prompt` / `days=[]`）
  分别经装载期与 `cron_task_create` 各跑一次，**原因文案逐字相等**（区分度：文案不同的实现必红）。
- create 成功：写前写后比 `config.json` 的 sha，断言 ① 新增一项 ② 模型没给的键**不出现**
  （`delivery` / `session` / `days` 缺席）③ 顶层未知键与其它表逐字节保留 ④ `version` 未降。
- create 失败（非法 / 重名 / 落盘失败）：配置逐字节不变（**负向断言的区分度**：先写一份可写文件
  确认改动会落盘，再让它失败，断言字节相同）。
- 去重状态：create 成功后工具侧零写（断言 `cron-state.json` 的 mtime 不变）；reload 线程侧写入
  种子，且**只**对「注册时刻已过点」的新任务写。
- reload 纯函数：任务集替换（新增 / 移除 / 改 `at`）、新增且已过点 → 种子、新增未到点 → 不种子、
  空表替换不 panic、`loop_max` 随 reload 更新、被删任务的在途运行记录保留。
- 工具定义面：交互路径（`tool_policy=None`）= 8 + 1 + 3；cron 交接（`allow=TOOL_NAMES`）= 8，
  三件不在内；子运行定义写 `tools: ["cron_task_create"]` 被定义校验拒绝。
- 权限矩阵：3 工具 × 3 档共 9 格，逐格断言 Allow / Ask；`cron_task_list` 在 `read_only` 档也
  Allow。
- 主体串：`create(id=a, at=21:00, days=[mon])` 与 `create(id=a, at=22:00)` 的缓存键不同；同一组
  `id+at+days`、不同 prompt 的缓存键**相同**（刻意口径，注释指回 §6.2）。
- 提示词装配：`assemble_system` 含 cron 段且字节数等于 `cron-reference.md`（trim 后）；
  `session_open.assembly` 有 `cron_reference` 条目（`path` 为仓内相对路径、`exists=true`）；
  `assemble_system_for_subagent` **不含**该段（负向断言 + 正观测：子运行装配里有定义正文）。

**契约（`lib.rs` / 前端接线）**

- reload ack 超时（接收端已断）→ 工具回执 `effect="pending_restart"`，且**不回滚**配置（配置已写入
  是事实，回滚会制造第二个真源）。
- 批准卡载荷：`cron_task` 五要素在场、`prompt` 与请求一致、`skip_today` 与线程计算一致。
- 拒绝路径：配置字节不变、无 reload、模型收到拒绝原因。
- `cron_task_registered` 只在 `effect=active` 时落（`pending_restart` 不落——避免「注册成功」的
  假记录）。

**真机验收（`scripts/acceptance/scenarios/`，新增）**

用 `provider: mock` + fixture 固定两段回答（第一段 `tool_calls: cron_task_create`，第二段收尾）。

| 场景 | 步骤 | 断言 |
|---|---|---|
| 对话注册 → 工具被调 → 立即生效 | 隔离 `XDG_CONFIG_HOME`；用户在面板输入「每天 21:00 提醒我写今日 log」；mock fixture 发起 `cron_task_create`（`id=daily-log`、`at` = 下一分钟，未到点） | ① 批准卡出现且含 `at` / `prompt` 片段（`ax`）；② 点采纳后 `config.json` 出现该任务（`file` 断言 id + at + **无** `delivery` 键）；③ 日志 `cron_task_registered(task=daily-log, skip_today=false)`；④ 等过点后 `cron_notified(kind=trigger)` 出现（**即时生效的证据链**）；⑤ 当日 `cron_run_started` 为 0（默认档不点头不跑） |
| 注册日不补触发 | 同上，但 `at` = 今日已过时刻 | ① 批准卡出现；② `cron_task_registered(skip_today=true)`；③ `cron-state.json` 该任务 `last_fired` = 今日（种子）；④ 之后多次切前台 / 重启后仍无 `cron_notified`（当日不再补） |
| 拒绝不落盘 | 同上，批准卡点「拒绝」 | ① `config.json` 无该任务（**负向断言的区分度**：同 run 里另一条已采纳的任务必须在文件里，证明文件可写）；② 无 `cron_task_registered`；③ 面板出现拒绝后的模型收尾 |
| 删除任务 | 先建后删（第二个 fixture 轮次发 `cron_task_remove`） | `config.json` 不再有该任务；`cron_task_removed`；该任务到点后无通知 |
| 重名拒绝 | `create` 一个已存在的 `id` | 工具回执 `cron_task_exists`；配置字节不变；面板工具行显示错误摘要 |
| 提示词段在场 | 新建会话 | 系统上下文含「定时任务」段；`session_open.assembly` 有 `cron_reference`；日志无异常 |

- 批准卡点击沿用既有场景的 KimiCU 定位口径（`ax` 读卡片 → 点按钮坐标），不新增点击机制。
- 通知横幅仍受系统通知权限 / 专注模式影响：通知相关的子步骤若被 DND 抑制，按
  `scripts/acceptance/README.md` 的 INVALID 口径登记，**不伪造 PASS**（先例：
  `add-cron-runtime-daemon` tasks §7.2 / §7.3）。

## 12. 已知边界与风险

- **不把外部调度命令加进危险黑名单**：`launchctl list`、`crontab -l` 是合法只读查询，进黑名单会
  误伤日常操作；而写入形态（`launchctl bootstrap`、`crontab -`、手写 plist）无法穷举——plist 本身
  就是普通文件。取舍是「让正解存在且被告知」（§2 + §7）而不是封路；代价是模型仍可能在被明确要求
  「app 关着也要跑」时铤而走险，此时提示词段的第三句要求它说明边界并交用户裁决。
- **手改配置不单独触发重读**：两条通道的生效时机不同（工具 = 即时；手改 = 下一次启动**或**下一次
  注册通道重载，二者取先到）。已在 `config-reference.md` 的生效时机列写明。若日后需要「改文件就
  生效」，另立「配置文件监听」change。
- **手改可能被一次重载提前吸收**：重载读的是文件当下内容（§3.4），因此「手改的新任务 + 随后的
  一次注册」会让手改内容提前生效，并按新增任务规则写当日种子。这是设计推论而非缺陷，但意味着
  「我改的配置什么时候生效」有一个不确定的上界：下一次注册动作。用户若想避免，改完手写配置直接
  重启即可。
- **agent 可能误建任务**：批准卡是防线（`full_access` 档除外——该档的语义就是不打断）。用户在
  `full_access` 档下的对策是事后 `remove` 或改档。
- **prompt 自包含无法机器校验**：只能靠工具 description + 提示词段 + 用户读批准卡上的 prompt
  全文。这是本设计的已知弱点，如实记录，不假装有防线。
- **注册即生效的最小延迟**：从工具返回到下一次 tick 最多 30s；若 `at` 恰好落在这 30s 内，任务在
  下一次 tick（≤30s）才派发。判定函数是「已过点」，不是「恰好等于」，因此不会漏。
- **reload 与手改并发**：用户手改 `config.json` 的同时 agent 注册任务，工具侧的读—改—写锁只保护
  本进程内的写者；外部编辑器不受锁约束，它的写入可能覆盖工具的写入（或反之）。现状既有（M592 /
  M600 的同一类边界），本 change 不扩大也不消除。
- **ack 超时的语义**：`pending_restart` 表示「配置已写、运行时未确认」，不代表任务不会生效（线程
  可能在 1s 后处理到该消息）。回执的措辞必须区分这两件事。
- **三件工具是工具清单的第二次扩张**：不做 `cron_task_update` 会让「改 prompt」变成 remove +
  create 两次批准；这是刻意的取舍（proposal Non-goals），若摩擦显著再立 change。
- **不给子运行 / 无人值守运行**：由 `tool_policy` 与定义白名单的既有校验挡住，不是新机制；若日后
  要放开（例如「定时任务里再排任务」），那是 harness 的额度与深度问题，须另裁。
- **不做数量上限**：单用户 1–3 条；`full_access` 档下 agent 连建的极端情形由用户自己承担（与
  cli_run 在该档的语义一致）。

## 13. 与既有决策的关系

> **推翻记录**：`add-cron-runtime-daemon` design §4.1 / §13 与 `config.rs:164-165` 的
> 「运行期不热重载」在本 change 内被**部分**推翻——推翻的是「任务集恒为启动快照」，保留的是
> 「不做文件监听」。落地表述：「运行期任务集只经**显式注册通道**重载；运行期不因文件变化而重读，
> 但注册通道触发的重载读文件当下内容，可能一并吸收先前未生效的手改」。三处旧表述
> （`config.rs:164-165`、`lib.rs:1015`、`config-reference.md:262`）在同一 change 内清扫，
> 不留新旧并存。

- **ADR 0007 Decision 7**：工具清单由「8 + 1」修订为「8 + 1 + 3」。修订走该 Decision 明写的
  Revisit 路径（「探针能力清单需要扩张 … → Alex 显式裁决后修订本 ADR」），节点 1 即裁决点；
  ADR 的修订与实现同批提交（同 `task` 的 2026-10-18 先例）。
- **`add-cron-runtime-daemon`**：本 change 复用它的判定函数、状态文件、通知链路与运行交接，
  **不改**它们。它的 delta 是本 change 三个 MODIFIED requirement 的基线。
- **`add-harness-subagents`**：本 change 的「工具循环」MODIFIED 块必须同时包含 `task` 与本 change
  的三件工具——按两者**都已归档**后的 living 形态撰写。归档顺序是本 change 的前置条件
  （proposal Impact 已列）：它先归档，本 change 后归档；反序会让「工具清单」在这两份 delta 的整块
  替换之间来回丢项。
- **REVIEW.md「同一语义两处真源」条**：本设计的三条集中化（任务表 / 状态写者 / 校验函数）就是这
  条的正面落地；§4.3 与 §3.1 的「不带载荷」「工具不写状态」是它的具体约束。
- **`docs/process/openspec-workflow.md`「改权限 / 闸语义的 change 必须回扫既有验收场景的闸期望」**：
  本 change 改的是**新增工具**的档位，不改既有工具的档位；但仍须回扫既有场景里
  「工具清单恰好 8 件」「写类工具默认 ask」一类期望——它们不会自己跟着变（tasks §6 单列一项）。
