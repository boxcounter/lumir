# Design: add-harness-subagents

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 两件事同时交付：**运行公共层回抽**（`RunSpec` / `RunContext`，`harness` capability）与
> **委托运行**（`task` 工具与子运行引擎，`harness-subagents` capability）。前者是 cron 提案 §14
> 声明的到期点，后者是它的第二个消费者。

## 1. 形态总览

```
                      ┌──────────────── 三类触发源，一份 RunSpec ────────────────┐
                      │  ① 用户输入（交互会话）                                  │
                      │  ② cron 到点 / 点击（无人值守槽位，change 并行评审中）     │
                      │  ③ 主 agent 调用 task（委托，子运行）                     │
                      └──────────────────────────┬──────────────────────────────┘
                                                 ▼
                                          RunSpec（运行契约）
                              origin / scope / session_target / parts / model /
                              tool_policy / budget / approval_policy / usage_sink / sink
                                                 │
                                                 ▼
                          RunContext（循环依赖面的唯一抽象）
                 session() · sink() · tool_definitions() · permission() · approval() ·
                 budget() · persist()
                                                 │
                                                 ▼
                   harness::turn 的循环本体（唯一一份：装配 → 往返 → 工具执行 → 收敛）
                          ▲                                      ▲
              SessionContext                          ChildContext
   （交互会话 / cron 槽位：UI sink、      （子运行：本地内存会话、父回合内 sink、
     人工批准等待、sessions/ 留存）          自动拒绝批准、subruns/ 审计）
```

- **装配**沿用 `harness/context.rs`（固定身份段 + AGENTS.md 三层 + Skill 索引）；`RunSpec` 只增加
  委托角色段（§9）。
- **工具循环**只有一份；`RunContext` 是唯一差异面。
- **留存**：交互会话 / cron 槽位落 `sessions/<vault 稳定 id>/<session_id>.jsonl`（不变）；子运行落
  `subruns/<vault 稳定 id>/<run_id>.jsonl`（新建，§8.3）。

## 2. 运行公共层

### 2.1 类型（`src-tauri/src/harness/run.rs`，新）

```rust
/// 触发来源。三类触发源各自构造，仅用于诊断、事件归属与预算策略，不用于分支循环行为。
pub enum RunOrigin {
    User,
    Cron { task: String, run_id: String },
    Delegation { parent_session: String, call_id: String },
}

/// 会话目标：一次运行把消息写进哪份会话状态。
pub enum SessionTarget {
    /// 当前 vault 的交互会话（用户输入；cron 点击后进入的会话）。
    Interactive,
    /// 无人值守槽位：与交互会话分离，事件带 vault 标识但只回执给发起方（cron）。
    Unattended { key: String },
    /// 子运行：本地内存态会话，不注册进 Runtime，不可恢复。
    Child { run_id: String },
}

/// 工具白名单（已校验的闭集合，见 §7）。
pub struct ToolPolicy { pub allow: Vec<&'static str> }

/// 三重失控闸的判决输入。
pub struct RunBudget {
    pub max_rounds: u32,
    pub max_tokens: u64,
    pub deadline: Option<std::time::Instant>,
}

/// 批准策略：交互会话等人；子运行与无人值守槽位无人可问。
pub enum ApprovalPolicy { Interactive, RejectUnavailable }

/// 运行终态（对外信封，不是内部 Result）。
pub enum RunOutcome {
    Completed,
    Partial { stopped_by: StopReason },   // rounds | tokens | time
    Failed { code: String, message: String },
    Aborted,
}

pub struct RunReport {
    pub outcome: RunOutcome,
    pub usage: UsageDelta,       // 本次运行新增的 input / cached / cache_write / output / samples
    pub rounds: u32,
    pub denials: u32,
    pub summary: Option<String>, // 子运行才有
}

/// 循环依赖面的唯一抽象。实现方：SessionContext（§2.2）、ChildContext（§2.3）。
pub trait RunContext {
    fn session(&mut self) -> &mut session::Session;
    fn sink(&self) -> &dyn EventSink;
    fn tool_definitions(&self) -> Vec<serde_json::Value>;
    fn permission(&self, tool: &str, args: &serde_json::Value) -> permissions::Verdict;
    fn approval(&mut self, request: ApprovalRequest) -> ApprovalOutcome;
    fn budget(&mut self) -> BudgetVerdict;   // 每往返前 / 每工具调用前调用
    fn persist(&mut self, record: serde_json::Value);
}
```

`RunSpec` 只持有上述字段的组合；**不含**任何任务知识（不认笔记路径、不认 vault 约定、不认场景名）。

实现提示：会话与事件接收端在实现里分开持有（`SessionContext` 内部按字段拆分，而不是每次调用都借整个
`ctx`），避免循环里 `&mut session` 与 `&sink` 的借用冲突。

### 2.2 交互路径（`SessionContext`）

- 现有 `run_turn_for(runtime, scope, config, parts, context, client)` 的 25 处 `with_session` 调用
  改经 `ctx.session()`；16 处 `sink.emit` 改经 `ctx.sink()`（行为不变）。
- `build_request` 里的 `tools: tools::definitions()` 改为 `ctx.tool_definitions()`——这是本次回抽
  **唯一改变交互路径数据面的点**，且结果恒等于既有 8 件清单（`ToolPolicy` 为全部 vault 工具时）。
- 批准：`park_approval` + `ApprovalSignal` 等待逻辑包进 `SessionContext::approval`，语义逐字节不变
  （未决批准项不超时通过）。
- 预算：交互路径当前无 token / 时间闸，只有 `loop_max`；`SessionContext::budget` 返回「轮次检查 +
  无 token/时间上限」，与现状等价。
- 回归判据：既有单元测试（含恢复充分性、事件形状、批准闸）零改动通过；`sessions/` 留存 JSONL 形状
  不变；验收场景全部重跑（tasks §1.6）。

### 2.3 子运行（`ChildContext`）

- 本地构造 `Session::new(root, child_system, vec![], effort, subrun_jsonl)`，**不插入**
  `Runtime.sessions`，因此不碰父会话的 busy 锁。
- `sink()`：一个 `ChildSink`，默认吞掉所有子运行事件（text / reasoning / tool_call / usage / done），
  只把 `tool_call` 计数用于结果信封；MUST NOT 把子运行事件转发到面板（proposal 裁决点 10）。
- `permission()`：复用 `permissions::decide`（同一份五层管线）；`approval()` 恒返回
  `RejectedUnavailable`，工具结果带 `code: "approval_unavailable"` 回送子模型。
- `budget()`：§6。
- `persist()`：子运行审计流水（§8.3）；`usage()` 在运行结束时一次性折叠进父会话（§8.1）。
- 父回合的停止请求：父循环把一个**停止标志读取闭包**注进 `ChildContext`（不持有父会话、不碰
  busy 锁）；`budget()` 第一个检查点读到停止即返回 `Aborted`，子运行立即收敛，父循环走既有
  `aborted` 路径（不产 `task` 工具结果）。

### 2.4 cron 的接入

cron 提案（`add-cron-runtime-daemon`，评审中）的运行槽位与 `cron:run` 交接载荷改为 `RunSpec` 的
序列化形状：`origin=Cron{task,run_id}`、`session_target=Unattended{key}`、
`approval_policy=RejectUnavailable`（与 cron 提案「需批准即中止」一致）、`budget` 只有轮次上限
（cron v1 不设 token/时间闸）。前端处理器不再自建字段集，按 `RunSpec` 反序列化后走同一入口。
**这是 cron 侧唯一的改动面**：它已有的调度、通知、去重逻辑不变。

## 3. 若「不回抽」：需要逐条反驳的已裁决心（本提案选择回抽的理由）

vision 的已裁决心只有两条，但都直接命中本 change。逐条尝试反驳，结论是反驳不成立：

1. **「动工任一原语前应先落实『触发器 + 装配 + 工具循环 + 留存』统一抽象」**。
   *反驳尝试 A：cron 已经做到了装配 / 循环 / 留存共用，抽象已经存在。* —— 不成立：cron 共用的是
   「下游三段的实现」，触发层与运行交接形状仍是它自己的；子运行若不接入同一契约，就会出现两套
   `RunSpec`（cron 的交接 JSON、task 的入参）+ 两套预算语义（cron 无闸、子运行三闸）+ 两套用量归属
   （cron 落自己的会话、子运行折父会话）。这恰是「两个功能各写一套调度」。
   *反驳尝试 B：子运行只是父回合里的一个工具调用，不是新触发源，不需要进公共层。* —— 不成立：
   它确实是一个新的触发源——它决定「谁发起一次 harness 运行」，且需要自己的上下文装配、预算与留存。
   「作为工具被调用」是它的交付形态，不是它可以绕过运行契约的理由。
   *反驳尝试 C：现在抽太早，等第三个原语出现再抽。* —— 不成立：vision 明确以「第二个原语出现」为
   回抽时点；再等就违反已裁决心，而且两个 change 都零代码、此刻改形状成本最低（真源「现在做的
   成本最低」的同一逻辑）。
2. **「机制进代码、策略进参数」**。*反驳尝试：模型档位应写进机制（比如调研固定便宜档）。* ——
   不成立：那是把场景知识写进机制，与 cron 重构裁决（任务知识不进机制）同构。落实为：`model` 只是
   一个参数，机制不认识「调研」「批量」这些词。

## 4. `task` 工具契约

### 4.1 schema（`src-tauri/src/harness/tools.rs`）

```json
{
  "name": "task",
  "description": "把一段自包含的调研/遍历任务委派给子 agent：子 agent 有独立上下文，只把摘要返回。适合读大量材料后只要结论的任务。子 agent 不能再次委派、不能请求人工批准；默认只读。",
  "parameters": {
    "type": "object",
    "properties": {
      "description": {"type": "string", "description": "一句话任务标签（进进度与诊断，不当作 prompt 用）"},
      "prompt": {"type": "string", "description": "自包含的任务说明：目标、范围、输出形态（结论 + 依据 + 不确定项）"},
      "model": {"type": "string", "description": "可选模型 id，须在当前 provider 的 models 清单内；缺省继承当前会话模型"},
      "tools": {"type": "array", "items": {"type": "string"},
                "description": "可选工具白名单；缺省 [vault_read, vault_search, skill_load]。写类与 cli_run 须显式声明"},
      "max_rounds": {"type": "integer", "description": "可选，LLM 往返上限；缺省取 [harness.subagents].default_max_rounds"},
      "max_tokens": {"type": "integer", "description": "可选，子运行累计 input+output token 上限；缺省取配置"},
      "timeout_secs": {"type": "integer", "description": "可选，wall-clock 秒上限；缺省取配置"}
    },
    "required": ["description", "prompt"]
  }
}
```

参数面与真源「任务描述、prompt、模型档位、工具集、失控闸值、超时」一一对应；`description` 是标签，
不是任务内容（任务内容只在 `prompt` 里，避免两份任务文本分叉）。

### 4.2 结果信封

```json
// 完成
{"ok": true, "status": "completed", "summary": "…", "truncated": false,
 "usage": {"input_tokens": 81000, "cached_tokens": 62000, "output_tokens": 2400},
 "rounds": 5, "denied_calls": 0, "tool_calls": {"vault_read": 6, "vault_search": 2}}

// 触顶（部分结果）
{"ok": true, "status": "partial", "stopped_by": "tokens", "summary": "…", "truncated": false,
 "note": "子运行在产出完整结论前触及 token 预算，以下为部分结果", …}

// 失败（沿用既有失败信封）
{"ok": false, "code": "model_not_configured", "message": "…"}
```

- `stopped_by ∈ {rounds, tokens, time}`；`partial` 不是失败，父 agent 可据它决定缩小范围重试。
- **摘要上限 8,000 字符**（经验初值，与 `cli_run` 单侧 10,000 字符同量级）：超出取头尾各一半、中间
  标 `…[截断]`，并置 `truncated: true`；MUST NOT 静默截断。
- 子运行没有产出任何助手文本（第一轮就触顶）时 `summary` 为空串，`note` 说明已完成多少轮工具调用，
  父 agent 据 `tool_calls` 计数知道「材料读到了但没综合」。

### 4.3 深度 1 的强制

- 子运行的 `tool_definitions()` 恒不含 `task`：`ToolPolicy` 校验时若 `tools` 含 `task`，整次委派被拒
  （`code: "depth_exceeded"`）并回送原因——**不静默剔除**（静默剔除会让父模型误以为子 agent 有派生
  能力）。
- `RunSpec` 的构造校验（装配前唯一入口）拒绝 `Delegation + tools 含 task` 的组合，单测钉住；循环
  内部不再重复判定。深度不是配置项。

## 5. 子运行生命周期

```
task 调用（父循环内）
  → 参数校验（prompt 非空、tools ⊆ 闭集合、不含 task、预算取配置缺省并夹取、model 可解析）
  → 次数闸（本回合已发起 < max_subruns_per_turn）
  → 装配：assemble_system(vault_root, Role::Delegated) + 空 input + [user: prompt]
  → 打开审计流水 subruns/<vault id>/<run_id>.jsonl（首行 run_open）
  → 循环（§6）：每往返前查闸 → 发请求 → 执行工具（白名单二次校验 + 权限管线）→ 回送
  → 收敛：终态判定（completed / partial / failed / aborted）
  → 收尾（无论终态）：用量折叠父会话 + 父会话 subrun sidecar + subagent_finished 事件 + flush
  → 返回工具结果信封
```

收尾必须在**任何**终态都跑到（含 panic）：与父回合同款 `catch_unwind`，收尾放在 unwind 处理之后
显式执行（Rust 无 finally），审计句柄与用量累加器由收尾函数消费。

## 6. 三重失控闸

### 6.1 检查点与判据

| 闸 | 判据 | 检查点 | 触顶后 |
|---|---|---|---|
| 轮次 | 已发起的 LLM 往返数 ≥ `max_rounds` | 每次往返前 | 停止开新往返 |
| token | 子运行累计 `Σ(input + output)` ≥ `max_tokens` | 每次往返后（读本次 usage）；往返前再查一次 | 同上 |
| 时间 | `Instant::now() ≥ deadline` | 每次往返前、每个工具调用前 | 同上 |

- **token 计数含缓存命中部分**（`input_tokens` 是含 cached 的总量）。缓存只影响价格、不影响预算判据
  ——简单、可预测，且对失控方向保守。
- **压缩调用的 usage 计入子运行预算**（否则反复压缩成为绕过闸的洞）；但**不折叠进父会话读数**
  （沿用「压缩是内部汇总调用，不计入会话读数」的既有口径）。两条口径的差异在 §6.4 说明。
- **父回合停止请求优先于一切**：停止标志在第一个检查点生效，子运行以 `Aborted` 终止。

### 6.2 收敛语义

任一闸触顶：不再发起新往返、不再执行新工具调用，用**已有产出**构造部分结果——`summary` 取子会话里
最后一条非空助手文本；没有则为空串 + `note`。**不追加一次「请总结」的 LLM 调用**：那等于给闸开了
一个不受预算约束的尾巴（且触发它的正是预算不足）。`status = "partial"`、`stopped_by` 精确点名哪一闸。

### 6.3 时间闸的执行边界

已在执行的工具调用**不中途打断**：`cli_run` 自带 60 秒超时并 kill 子进程，其余工具是同步短操作。
因此实际 wall-clock 上界 = `deadline + 单次工具最长耗时`（最坏 60 秒）。这条边界写进 spec scenario，
避免「超时了为什么还在跑」被当成缺陷。

### 6.4 上下文溢出与压缩（边界）

子运行与父共用循环，因此同样会遇到上下文超限。v1 口径：

- 请求被 provider 判超限 ⇒ 沿用既有「压缩后重试一次」路径；压缩只压子会话的内存态输入，**不轮转
  审计文件**（审计流水是一次运行的完整轨迹，不是可恢复会话），压缩动作落 `compact` sidecar；
- 压缩后仍超限 ⇒ `Failed{code: "harness_context_overflow"}`，父 agent 可缩小范围重试；
- 压缩调用的 usage 计入子运行预算（§6.1），不计入父会话读数。

## 7. 工具集收紧与权限

### 7.1 工具白名单

闭集合 = 既有 8 件：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`vault_move`、
`vault_delete`、`skill_load`、`cli_run`（`task` 不在可选集合内，见 §4.3）。

| 工具 | 子运行默认可用 | 声明后可用 | 备注 |
|---|---|---|---|
| `vault_read` / `vault_search` / `skill_load` | ✅ | ✅ | 只读三件，默认集合 |
| `vault_patch` / `vault_create` / `vault_move` | ❌ | ✅ | 默认 `vault_write` 档下权限管线自动放行（人已选档） |
| `vault_delete` | ❌ | ✅ | `vault_write` 档下需批准 → 子运行内被拒（`approval_unavailable`） |
| `cli_run` | ❌ | ✅ | 只读白名单命令放行；写命令在 `vault_write` 档需批准 → 被拒；危险黑名单任何档都需批准 → 被拒 |
| `task` | ❌ | ❌ | 深度 1 |

要点：**声明只决定「工具是否可见」，放行仍由权限管线判定**。子运行不放松、也不额外收紧用户选定的
权限档位；它只是**没有人类可批准**，因此一切落到 ask 的调用被拒并计数。这解释了为什么默认
`vault_write` 档下声明 `vault_patch` 的子运行能写、而 `vault_delete` 不能——前者在用户选定档位里是
自动放行，后者本来就要问人。

### 7.2 执行层二次校验与批准缓存

请求构造时按白名单过滤工具定义（模型看不见未声明的工具）；`tools::execute` 再查一次白名单，白名单外
的调用以 `tool_not_allowed` 拒绝、不执行——防模型幻觉出未声明工具名（部分 provider 不校验 schema）。

子运行 MUST NOT 复用父会话的批准缓存（`permission_cache`）：缓存免除的是**人工批准动作**，子运行
本来就没有可批准的人；共享缓存会让「用户在别的上下文里批准过类似命令」变成子运行的自动放行，等于
从侧门绕回「自动批准」。子运行的缓存视图恒为空。

## 8. 用量归属与留存

### 8.1 折叠进父会话

```
子运行每往返 usage ──► 子运行累加器 ──(运行结束，一次)──► 父会话 UsageAccumulator
                                                          （input/cached/cache_write/samples 全加）
```

- 折叠点只有一处（子运行收尾），避免中途读数抖动与重复计数。被用户停止 / 失败的子运行同样折叠
  （已花的 token 是事实）。
- 折叠后父会话的 cache% 是混合读数（父 + 子、可能跨模型）：这是「用量归主会话」的既定代价，读数
  含义在 `config-reference.md` 与 design 里写明，不改读数算法。
- 父会话的 `ctx%`（最近一次请求 input ÷ 窗口）**不受折叠影响**——它只描述父会话自己的下一次请求，
  语义不变。

### 8.2 父会话 sidecar：`subrun`

父会话 JSONL 落一条（每次子运行一条）：

```json
{"kind": "subrun", "run_id": "r-…", "description": "…", "model": "…",
 "status": "completed", "stopped_by": null, "rounds": 5, "denied_calls": 0,
 "usage": {"input_tokens": 81000, "cached_tokens": 62000, "output_tokens": 2400},
 "audit": "harness/subruns/<vault 稳定 id>/<run_id>.jsonl"}
```

- 它属于既有的 sidecar 类别（「wire 不可推导的决策与事件以 sidecar 留存」）：子运行的往返不在父会话
  的 wire 历史里，无法从 `llm_request` / `llm_response` 推导，故必须显式记录。
- **恢复重算**：`usage_from_records` 的输入新增 `subrun` 记录，按 `usage` 块累加；`subrun` 不计入
  「会话轮次」的 input 语义（不影响 ctx%），只影响累计器。判据：live 折叠后的读数与恢复重算的读数
  逐字段相等（单测钉住）。

### 8.3 子运行审计流水

- 路径：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`（`<vault 稳定 id>` 与会话目录
  同一份身份）；MUST NOT 写入 `<config_dir>/harness/sessions/` 与 vault。
- 形态：与会话同 wire 形状（`run_open` 首行含 run id / 父会话 id / 模型 / 工具集 / 预算 / 提交的
  prompt；`llm_request` / `llm_response` 成对；`compact` / `tool_denied` / `budget_hit` sidecar），
  复用 `JsonlWriter`，append-only。
- 不进会话列表、不可恢复、不做 listing / 删除 UI；`subagent_finished` 事件带路径供人工定位。保留策略
  随会话留存（不新增清理机制）。
- 目录结构：`subruns/<vault 稳定 id>/` 与会话目录平级——不放进 `sessions/` 是为了不让「会话列举 /
  恢复 / 删除」三条既有链路的归属判据多一类文件。

## 9. 上下文装配与隔离

- **system**：`assemble_system(vault_root)` 既有输出 + 一段固定的「委托运行」角色段（机制级文本，
  与固定身份段同类）：只做被交代的任务、不与用户交互、不能请求批准、不能再次委派、结束时直接给出
  摘要（结论 + 依据 + 不确定项 + 未覆盖范围）。任务内容 MUST NOT 进 system（只走 user 消息）。
- **input**：空历史 + 一条 user 消息（`prompt` 原文，单 text part）。MUST NOT 继承父会话任何消息
  ——这是「隔离」的定义，也是价值来源。
- **Skill 索引**：同一份 `discover_skills(vault_root)`；子运行可用 `skill_load`（默认集合内）。
- **编辑器上下文**：不注入（子运行没有「当前编辑器」的语义）；任务所需的路径由 `prompt` 给出。

## 10. 模型与思考档位

### 10.1 模型解析

- `model` 缺省 ⇒ 当前 `[harness].provider` 的 `model`（父会话模型）。
- 显式 `model` ⇒ 必须命中该 provider 的 `models[]` 声明（`HarnessModelSpec.id`）；否则整次委派被拒：
  `code: "model_not_configured"`，附「当前可用模型 id 清单」。**不静默回落**（回落会掩盖调用方的
  成本判断错误，且与 cron 的「未声明模型回落 + warning」不同——cron 的任务是人手写的配置，责任在
  配置侧；task 的调用方是模型，静默回落会训练出错误的调用习惯）。
- `llm::client_at` 增加模型覆盖参数（cron 的 `model` 覆盖同用此参数）。
- 思考档位：v1 继承父会话档位，不开放为 `task` 参数（provider 能力差异大，先不扩面）。

### 10.2 mock 与验收

mock provider 的脚本是单条线性序列（`MockClient`），父子两个客户端各自持有游标。约定：

- 子运行客户端的 mock 起点 = 父会话游标 + 父客户端本轮已消费条数（绝对脚本位置；脚本按「父第 1 条
  = task 调用 → 子运行 N 条 → 父续写」顺序编排）；
- 子运行结束后父客户端前移子运行消费的条数（`LlmClient` 增 `external_consumed()` / `skip(n)`，
  真 provider 恒 0 / no-op），父回合结束时按既有规则回写会话游标；
- 验收场景按此顺序写 fixture，断言「父续写的响应紧跟子运行条目」，不依赖时间。

## 11. 并发与串行

- 子运行在父回合的同一线程内同步执行；一次助手消息里的多个 `task` 调用按既有「tool_calls 逐个
  执行」串行跑。
- `max_subruns_per_turn`（默认 8）按**父回合**计数，派发即计（含被拒的调用？——只计实际进入执行的，
  被拒的另由 `subagent_rejected` 记录，不占额度；防止模型用非法调用刷满额度）。
- 子运行不碰 `Runtime` 的 busy 锁；父会话在子运行期间保持 busy（用户再次发送仍被既有 `harness_busy`
  挡下）。

## 12. 配置面

`[harness.subagents]`（生效时机：装载时读一次，改配置需重启，与 `[cron]` 同口径）：

| 键 | 缺省 | 合法域 | 消费者 |
|---|---|---|---|
| `enabled` | `true` | bool | `task` 是否注册进工具定义；false 时调用返回 `disabled` |
| `default_max_rounds` | `20` | 1–64 | `task` 未传 `max_rounds` 时的预算 |
| `default_max_tokens` | `200000` | 1–10000000 | 同上（token 闸） |
| `default_timeout_secs` | `300` | 1–3600 | 同上（时间闸） |
| `max_subruns_per_turn` | `8` | 1–64 | 父回合的委派次数闸 |

- 校验沿用既有模板：类型不符整节回落 + 一条 warning；数值越界夹取到合法域 + 一条 warning
  （ADR 0002 第 5 条、`vault.ignore` / `harness.permissions` 先例）。
- 逐次调用的 `max_rounds` / `max_tokens` / `timeout_secs` **只能收紧不能放宽**：超过配置默认值即夹取
  到默认值并回送 `note`（否则调用方可以绕过用户设定的上限——配置是用户的闸，参数是调用方的闸，
  后者不得推翻前者）。这条写进 spec scenario。
- ts-rs 导出 `SubagentsConfig`，前端只在配置文档层面消费（本 change 无新增 UI）。

## 13. 诊断事件

| 事件 | 字段 |
|---|---|
| `subagent_started` | `run_id`, `parent_session`, `description`, `model`, `tools[]`, `max_rounds`, `max_tokens`, `timeout_secs` |
| `subagent_finished` | `run_id`, `status`（completed / partial / failed / aborted）, `stopped_by`, `rounds`, `input_tokens`, `cached_tokens`, `output_tokens`, `denied_calls`, `duration_ms`, `summary_chars`, `audit` |
| `subagent_rejected` | `reason`（disabled / depth / subrun_limit / model_not_configured / tool_not_allowed / empty_prompt）, `description` |

- 三个事件进 `logging.rs` 白名单，字段逐个校验（与 cron 六事件同纪律）。
- 事件在收尾处产出一次，失败路径也产（`status=failed` + `reason`），不静默。
- 事件 NOT 含 prompt 内容与 vault 绝对路径（日志可能被粘贴外发）；`description` 是模型写的一句话
  标签，按用户自述内容对待，不额外脱敏（与既有 tool 摘要同口径）。

## 14. 失败模式与边界

- **子运行内模型报错**：不重试（机制不自作主张），`Failed{code}` 回父 agent；已发生的 usage 照常折叠。
- **子运行第一轮就失败**：父 agent 收到明确错误码，可自行重试或接手。
- **父回合被用户停止**：子运行在下一检查点收敛为 `Aborted`，不产工具结果，父循环走既有停止路径。
- **应用退出**：子运行随进程终止；审计流水可能只有半截（append-only，可读）；父会话 JSONL 无
  `subrun` sidecar（收尾未执行），恢复读数不计这次子运行——这是进程级故障的已知边界，与既有
  「运行中退出应用」同类。
- **子运行递归委托**：声明 `task` 即整次拒绝；机制层面无递归入口。
- **模型幻觉工具名**：执行层白名单二次校验拒绝，回送 `tool_not_allowed`。
- **mock 脚本条目不足**：沿用既有 `fixture_exhausted` 错误，子运行 `Failed`。
- **审计流水写失败**：不阻断运行（沿用「写失败不阻断对话」纪律），但 `subagent_finished` 落
  `audit_error` 供排查。
- **token 预算与上下文窗口的错配**：预算小于窗口时闸先生效；预算大于窗口时可能先撞 provider 400，
  走压缩重试（§6.4）。默认值（200k / 256k 级窗口）留了余量，但不保证；触顶/溢出分布是调参依据。

## 15. 与 cron 提案的对接

| 事项 | cron 提案现状 | 本 change 后的落法 |
|---|---|---|
| 运行交接载荷 | `cron:run` 事件字段自列（`run_id/task/vault/prompt/session/model/origin`） | 改为 `RunSpec` 序列化（字段是超集，前端按契约反序列化） |
| 运行槽位 | cron design 的「与交互会话分离的运行槽位」 | `SessionTarget::Unattended` |
| 批准语义 | 需批准即中止并回执失败 | `ApprovalPolicy::RejectUnavailable`，行为不变 |
| 预算 | 无 token / 时间闸 | `RunBudget` 只填轮次上限（cron v1 仍无 token/时间闸） |
| 留存 | 落既有会话 JSONL | 不变 |

实现顺序（建议，非阻塞）：本 change 的公共层先落 → cron 实现按 `RunSpec` 接入；若 cron 先开工，其
交接载荷直接按 `RunSpec` 形状写，公共层由本 change 补齐。**不允许两套交接形状并存**（AGENTS.md
「变更默认直接切断」）。

## 16. 真机验收场景设计（`scripts/acceptance/scenarios/`）

1. **只读调研**：mock 脚本「父：task → 子：读 2 个文件 + 摘要 → 父：综合」。断言子运行未获写工具、
   父会话收到摘要、父会话 JSONL 有 `subrun` sidecar、`subruns/<vault id>/<run_id>.jsonl` 存在、
   面板无子运行过程消息。
2. **默认工具集**：task 不传 `tools`，断言子运行请求的 `tools` 恰为只读三件（从 `llm_request` 读）。
3. **显式写工具**：task 传 `tools:["vault_patch"]` + `vault_write` 档，断言子运行可写、写入经既有
   工具与 diff 预览链路（子运行内自动放行）。
4. **`vault_delete` 被拒**：声明 `vault_delete` + 默认档，断言子运行收到 `approval_unavailable`、
   `denied_calls=1`、文件未删。
5. **token 闸触顶**：`max_tokens` 设极小值，断言 `status=partial`、`stopped_by=tokens`、父 agent
   收到部分结果、无第二次「请总结」调用。
6. **轮次闸触顶**：`max_rounds=1` + 脚本要求两轮，断言 `stopped_by=rounds`。
7. **时间闸**：`timeout_secs` 极小 + cli_run 场景，断言在工具返回后立刻收敛、`stopped_by=time`。
8. **深度拒绝**：`tools` 含 `task`，断言 `code=depth_exceeded`、零子运行启动事件。
9. **模型非法**：`model` 传未声明 id，断言 `model_not_configured` 且附可用清单、零子运行。
10. **开关关停**：`enabled=false` 重启，断言工具定义里无 `task`，模型调用返回 `disabled`。
11. **用量折叠**：完成一次子运行后断言父会话读数增加了子运行 usage；重启恢复后读数与 live 相等
    （对照 `harness_state` 快照）。
12. **委派次数闸**：`max_subruns_per_turn=1`，同一条助手消息两个 task 调用，断言第二个
    `subrun_limit`。

备注（场景注释里写明）：子运行过程不上屏，因此判据一律取 JSONL / 事件 / 快照，不取截图；mock 脚本
按 §10.2 的父子游标约定编排。
