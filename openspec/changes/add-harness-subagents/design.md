# Design: add-harness-subagents

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 两件事同时交付：**运行公共层回抽**（`RunSpec` / `RunContext`，`harness` capability）与
> **委托运行**（子代理定义文件 + `task` 工具 + 子运行引擎，`harness-subagents` capability）。
> 形态参照 [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)（2026-10-18 抓取）：
> 定义即文件、按名字委派、按 `description` 自动委派、部分结果可 resume。与参照系的逐项对照与
> 刻意偏离见 proposal「参照系」节；真源已裁决的三条（默认收紧 / 用量归主会话 / 三重闸）不因参照系松动。

## 1. 形态总览

```
   <vault>/.lumir/agents/**/*.md  ┐
   <config_dir>/agents/**/*.md    ┴─► 每回合开头扫描 + 校验 → 定义快照（name / description / 字段）
                                              │
                          ┌───────────────────┴────────────────────┐
                          ▼                                        ▼
              task 工具描述（名字 + 描述清单）           委派时：读正文 → 构造 RunSpec
              （主 agent 据此自动委派；超阈值告警）                   │
                                                                     ▼
                                                     RunContext（ChildContext）
                                                     system：定义正文 + 委托约束 + AGENTS 三层 + Skill
                                                     input：任务 prompt（空历史）
                                                     tools：定义 tools（缺省只读三件）
                                                     budget：定义字段 ∩ 配置上限
                                                                     │
                                          ┌──────────────────────────┴─────────────────┐
                                          ▼                                            ▼
                                  harness 循环（唯一一份）                    收尾：用量折叠 + sidecar +
                                  三重闸检查 / 工具执行                         审计 flush + 事件
```

三类触发源（用户输入 / cron / 委托）共用一份 `RunSpec` 与一个循环；差异在契约值（会话目标、批准
策略、工具白名单、预算），不在循环内分支。

## 2. 运行公共层

### 2.1 类型（`src-tauri/src/harness/run.rs`，新）

```rust
/// 触发来源。仅用于诊断、事件归属与预留策略，不用于分支循环行为。
pub enum RunOrigin {
    User,
    Cron { task: String, run_id: String },
    Delegation { parent_session: String, call_id: String },
}

/// 会话目标：一次运行把消息写进哪份会话状态。
pub enum SessionTarget {
    Interactive,
    Unattended { key: String },
    Child { run_id: String },            // 内存态、不注册进 Runtime
}

pub struct ToolPolicy { pub allow: Vec<&'static str> }

/// 三重失控闸。子运行的预算来自定义字段，已按配置上限夹取。
pub struct RunBudget {
    pub max_rounds: u32,
    pub max_tokens: u64,
    pub deadline: Option<std::time::Instant>,
}

pub enum ApprovalPolicy { Interactive, RejectUnavailable }

pub enum RunOutcome {
    Completed,
    Partial { stopped_by: StopReason },   // rounds | tokens | time | error
    Failed { code: String, message: String },
    Aborted,
}

pub struct RunReport {
    pub outcome: RunOutcome,
    pub usage: UsageDelta,
    pub rounds: u32,
    pub denials: u32,
    pub summary: Option<String>,
    pub tool_calls: BTreeMap<String, u32>,
}

/// 循环依赖面的唯一抽象。实现方：SessionContext（§2.2）、ChildContext（§2.3）。
pub trait RunContext {
    fn session(&mut self) -> &mut session::Session;
    fn sink(&self) -> &dyn EventSink;
    fn tool_definitions(&self) -> Vec<serde_json::Value>;
    fn permission(&self, tool: &str, args: &serde_json::Value) -> permissions::Verdict;
    fn approval(&mut self, request: ApprovalRequest) -> ApprovalOutcome;
    fn budget(&mut self) -> BudgetVerdict;
    fn persist(&mut self, record: serde_json::Value);
}
```

`RunSpec` 组合上述字段；**不含任务知识**（不认路径、不认 vault 约定、不认场景名）。实现提示：会话与
事件接收端按字段分开持有（`SessionContext` 内部拆分），避免 `&mut session` 与 `&sink` 的借用冲突。

### 2.2 交互路径（`SessionContext`）

- 现有 `run_turn_for(runtime, scope, config, parts, context, client)` 的 25 处 `with_session` 改经
  `ctx.session()`；16 处 `sink.emit` 改经 `ctx.sink()`（行为不变）。
- `build_request` 的 `tools: tools::definitions()` 改为 `ctx.tool_definitions()`；交互上下文的实现
  按「当前定义快照」生成 `task` 工具描述（含 agent 清单）。这是回抽唯一改变交互路径数据面的点，
  且无子代理定义时输出与既有 8 件清单深度相等。
- 批准：`park_approval` + `ApprovalSignal` 包进 `SessionContext::approval`，语义逐字节不变。
- 预算：交互路径只有轮次上限（`loop_max`），`budget()` 返回「轮次检查 + 无 token/时间上限」。
- 回归判据：既有 cargo 测试（恢复充分性、事件形状、批准闸、循环上限）零改写通过；`sessions/` 的
  JSONL 形状不变；真机验收全量重跑（tasks §1.6）。

### 2.3 子运行（`ChildContext`）

- 本地构造 `Session::new(root, child_system, vec![], effort, subrun_jsonl)`，不插入 `Runtime.sessions`，
  不碰父会话的 busy 锁。resume 时复用内存里保留的子会话（§9.3）。
- `sink()`：`ChildSink` 吞掉子运行的所有事件（text / reasoning / tool_call / usage / done），只累计
  `tool_calls` 计数；MUST NOT 转发到面板。
- `permission()`：复用 `permissions::decide`；`approval()` 恒 `RejectedUnavailable`（工具结果带
  `approval_unavailable`）。批准缓存视图恒为空（§10.2）。
- `budget()`：§7。
- `persist()`：子运行审计流水（§9.2）；用量在每段结束时折叠父会话（§9.1）。
- 父回合停止请求：父循环注入停止标志读取闭包（不持有父会话）；检查点读到停止即 `Aborted`，父循环走
  既有 `aborted` 路径（不产 `task` 工具结果）。

### 2.4 cron 的接入

cron 的运行槽位与 `cron:run` 交接载荷改为 `RunSpec` 序列化：`origin=Cron`、
`session_target=Unattended`、`approval_policy=RejectUnavailable`、`budget` 只填轮次上限。前端按
`RunSpec` 反序列化后走同一入口；cron 的调度、通知、去重逻辑不变。**这是 cron 侧唯一改动面。**

## 3. 若「不回抽」：逐条反驳（选择回抽的理由）

vision 的已裁决心只有两条，都直接命中本 change。逐条尝试反驳，结论是反驳不成立：

1. **「动工任一原语前应先落实『触发器 + 装配 + 工具循环 + 留存』统一抽象」**。
   *反驳 A：cron 已经共用了装配 / 循环 / 留存。* —— 不成立：共用的是下游实现，触发层与交接形状仍是
   cron 自己的；子运行不接入会出现两套交接载荷 + 两套预算语义 + 两套用量归属。
   *反驳 B：子运行只是父回合里的一个工具调用，不是新触发源。* —— 不成立：它决定「谁发起一次 harness
   运行」，且需要自己的装配、预算与留存；「作为工具被调用」是交付形态，不是绕过契约的理由。
   *反驳 C：等第三个原语再抽。* —— 不成立：vision 以「第二个原语出现」为时点；两个 change 都零代码，
   此刻改形状成本最低。
2. **「机制进代码、策略进参数」**。*反驳：把模型档位写进机制（如调研固定便宜档）。* —— 不成立：
   那是把场景知识写进机制。落实为：定义文件承载策略，机制只读字段。

## 4. 子代理定义文件（`src-tauri/src/harness/agents.rs`，新）

### 4.1 位置、发现与优先级

| 作用域 | 路径 | 说明 |
|---|---|---|
| vault 级 | `<vault>/.lumir/agents/**/*.md` | 随 vault 走、可入版本控制；`.` 前缀沿用真源「应用私有配置」惯例 |
| 用户级 | `<config_dir>/agents/**/*.md` | 跨 vault 复用；复用既有配置根（不新建 home dotdir） |

- 只认 `.md`；递归扫描子目录；**身份只看 frontmatter 的 `name`**，子目录不参与身份（与参照系一致）。
- 参照系的「项目级目录向上递归到仓库根」在 Lumir 没有对应物（vault 是单根，没有「仓库根」概念），
  故只扫 vault 根下的 `.lumir/agents/`，不做向上遍历。
- 优先级：vault 级同名覆盖用户级（更具体的作用域优先，与 AGENTS.md 三层的「后位为准」同构）；同一层
  同名取**字典序第一个**并产 warning（参照系按文件系统读序，不可复现；本仓改为确定性规则）。
- 扫描时机：**每回合开头一次**（读取两目录 + 解析）。目录不存在视为空，不报错；新建目录无需重启。
  相对参照系的「watcher 秒级热加载」，本方案在「下次委派生效」这一点上等价，且没有 watch 的失效面。

### 4.2 frontmatter 字段（v1 闭集合）

| 字段 | 必填 | 值域 | 缺省 | 机制用途 |
|---|---|---|---|---|
| `name` | 是 | 非空、无空白、不含 `/`、≤64 字符 | — | 身份、委派参数、诊断 |
| `description` | 是 | 非空 | — | 自动委派的匹配依据；注入工具描述 |
| `tools` | 否 | 8 件 vault 工具名的子集；`task` 非法 | 只读三件 | 子运行的工具定义 |
| `model` | 否 | `inherit` 或当前 provider `models[]` 里的 id | `inherit` | 模型选择（§11） |
| `max_turns` | 否 | 正整数 | 配置 `max_turns` | 轮次闸（夹取） |
| `max_tokens` | 否 | 正整数 | 配置 `max_tokens` | token 闸（夹取） |
| `timeout_secs` | 否 | 正整数 | 配置 `timeout_secs` | 时间闸（夹取） |

- **正文**（frontmatter 之后）即子运行 system prompt 的身份段（§10）。
- 字段名采本仓配置惯例的 **snake_case**；参照系用 camelCase（如 `maxTurns`），这是命名惯例差异、不是
  形态差异——写错大小写的字段会被「未识别字段」warning 点名，不会静默失效。
- 未识别字段：产 warning 并忽略（列名 + 提示「v1 不采纳」），不静默吞掉。参照系忽略未知字段且不报错，
  本仓选择报错可见——定义是用户手写制品，拼错字段名应当被发现。
- 参照系有、本稿不采纳的字段（`disallowedTools` / `permissionMode` / `skills` / `initialPrompt` /
  `background` / `isolation` / `omitClaudeMd` / `hooks` / `mcpServers` / `memory` / `effort`）走同一
  warning 路径，文案点名「本版本不采纳」。

### 4.3 校验与丢弃规则

| 情形 | 处置 |
|---|---|
| frontmatter 缺失 / 未闭合 / YAML 解析失败 | 丢弃该定义 + warning（点名文件） |
| `name` / `description` 缺失或为空 | 丢弃 + warning |
| `tools` 含未知工具名 / `task` | 丢弃 + warning（点名条目）——fail loud，不让子代理在静默缺工具下跑 |
| `tools: []` | 合法：零工具子运行（纯推理/判断用） |
| `model` 不在 provider 清单 | 保留定义，回落 `inherit` + warning（配置约定） |
| `max_*` 类型非法 | 保留定义，取配置上限 + warning |
| `max_*` 超过配置上限 | 夹取到上限 + warning |
| 同一层同名 | 字典序第一个生效 + warning |
| 文件不可读 | 跳过 + warning（不阻断扫描） |

丢弃是**逐定义**的，不影响其它定义；扫描本身永不失败（最多全空）。空目录 ⇒ `task` 不注册（模型看
不见该工具），与 `enabled=false` 等效。

### 4.4 清单注入与容量告警

- 每个定义的 `name` + `description` 按固定格式拼进 `task` 工具描述：`- <name>：<description>`。
- 描述合计超过 **15,000 token**（本仓无本地 tokenizer，按 `ceil(字符数 ÷ 4)` 粗估，warning 文案注明
  「估算」）时产一条 warning + `subagent_catalog_large` 事件（含估算值与定义数）。MUST NOT 截断清单
  ——截断会让某些定义静默消失，比告警更糟。
- 正文不进清单（只在委派时读取），与参照系「描述占上下文、正文按需加载」一致。

### 4.5 YAML 解析依赖

- 只解析 frontmatter 的**标量 + 字符串列表 + 注释**子集，不支持锚点 / 别名 / 多文档。
- `serde_yaml` 已标记 deprecated（0.9.34+deprecated，最后更新 2024-03）；候选 `yaml-rust2`（0.13，
  2026-09 更新）与 `saphyr`（0.2，2026-10 更新），实现时二选一并记录理由。手写 YAML 解析器不选
  （解析器的边界语义不值得自造）。
- 解析产出 `serde_json::Value` 或一个窄结构体（字段逐个取、逐项校验），不走宽松反序列化——校验文案
  要能点名具体字段。

## 5. `task` 工具契约

### 5.1 schema（`src-tauri/src/harness/tools.rs`）

```json
{
  "name": "task",
  "description": "把任务委派给一个子代理：子代理有独立上下文，只把摘要返回；不能再次委派、不能请求人工批准。可用子代理：\n- research：…\n- reviewer：…",
  "parameters": {
    "type": "object",
    "properties": {
      "agent": {"type": "string", "description": "子代理定义名（见本工具描述里的清单）"},
      "prompt": {"type": "string", "description": "自包含的任务说明：目标、范围、输出形态（结论 + 依据 + 不确定项）"},
      "description": {"type": "string", "description": "一句话任务标签，显示在工具行与诊断里"},
      "model": {"type": "string", "description": "可选，调用级模型覆盖；缺省用定义里的 model，再缺省 inherit"},
      "resume": {"type": "string", "description": "可选，run_id；在同一子代理会话上继续（通常用于续跑 partial 结果）"}
    },
    "required": ["agent", "prompt", "description"]
  }
}
```

工具集与闸值不在调用参数里——它们是定义字段（参照系形态）。`model` 是唯一的调用级覆盖项（参照系
确认的优先级）。

### 5.2 结果信封

```json
// 完成
{"ok": true, "status": "completed", "agent": "research", "run_id": "r-…", "resumable": true,
 "summary": "…", "truncated": false,
 "usage": {"input_tokens": 81000, "cached_tokens": 62000, "output_tokens": 2400},
 "rounds": 5, "denied_calls": 0, "tool_calls": {"vault_read": 6, "vault_search": 2}}

// 触顶（部分结果）
{"ok": true, "status": "partial", "agent": "research", "run_id": "r-…", "resumable": true,
 "stopped_by": "tokens", "summary": "…", "truncated": false,
 "note": "子运行触及 token 预算；可用 resume 续跑", …}

// API 中断但已有文本
{"ok": true, "status": "partial", "stopped_by": "error", "note": "子运行被 API 错误中断；以下为已产出部分", …}

// 失败（沿用既有失败信封）
{"ok": false, "code": "agent_not_found", "message": "…"}
```

- `stopped_by ∈ {rounds, tokens, time, error}`；`resumable` 仅对 completed / partial 为 true。
- **摘要上限 8,000 字符**（经验初值，与 `cli_run` 单侧 10,000 字符同量级）：超出取头尾各一半、中间
  标 `…[截断]`，并置 `truncated: true`；MUST NOT 静默截断。
- 子运行没有产出任何助手文本（第一轮就触顶）时 `summary` 为空串，`note` 说明已完成多少轮工具调用；
  父 agent 据 `tool_calls` 知道「材料读到了但没综合」。
- 失败码闭集合：`disabled` / `agent_not_found` / `run_not_resumable` / `agent_mismatch` /
  `subrun_limit` / `model_not_configured` / `empty_prompt` / `harness_context_overflow`。

### 5.3 resume 语义

- `resume=run_id` 时在**同一子会话**上继续（保留完整历史：消息、工具结果、思考回放），新 `prompt`
  作为一条新的 user 消息；`agent` 必须与保留 run 的 agent 相同，否则 `agent_mismatch`。
- 模型：调用参数 > 保留 run 上次使用的模型 >（首次时的）定义字段；参照系同样规定调用级模型在 resume
  时保持。
- 预算：每次 resume 是一段新预算（定义字段，夹取配置上限）；token 计数按段清零，usage 按段折叠。
- 保留：每父会话最多保留 **4** 个 run（常量 `MAX_RETAINED_RUNS`，不做配置项）；超出按最久未用淘汰，
  被淘汰或跨重启的 resume 返回 `run_not_resumable`。`failed` / `aborted` 的 run 不可 resume。
- 段身份：`run_id` 标识整段对话，`segment`（从 1 起）标识第几次调用；审计流水同一文件追加，sidecar
  与诊断事件都带 `segment`。

### 5.4 深度 1 的强制（白名单即机制）

- 子运行的工具定义恒来自定义 `tools`，而 `task` 不在可授予集合内：**不维护运行时深度计数**。
- 定义把 `task` 写进 `tools` ⇒ 该定义非法、装载期丢弃 + warning（作者错误尽早暴露，不在调用期报错）。
- 若未来允许更深派生，改动面是「给子运行授予 `task` + 引入深度预算」；v1 不预留开关。

## 6. 子运行生命周期

```
task 调用（父循环内）
  → 解析参数（agent 存在？prompt 非空？resume 有效？）
  → 次数闸（本回合已发起段数 < max_subruns_per_turn）
  → 取定义快照 → 预算 = 定义字段 ∩ 配置上限 → 模型解析
  → 装配：定义正文 + 委托约束段 + AGENTS 三层 + Skill 索引；空 input + [user: prompt]
  → 打开 / 追加审计流水 subruns/<vault id>/<run_id>.jsonl（首段写 run_open）
  → 循环（§7）：每往返前查闸 → 发请求 → 执行工具（白名单二次校验 + 权限管线）→ 回送
  → 收敛：completed / partial / failed / aborted
  → 收尾（任何终态）：用量折叠 + 父会话 subrun sidecar + 诊断事件 + flush；保留子会话（可 resume）
  → 返回工具结果信封
```

收尾必须在任何终态跑到（含 panic）：与父回合同款 `catch_unwind`，收尾在 unwind 处理之后显式执行
（Rust 无 finally），审计句柄与用量累加器由收尾函数消费，且只消费一次。

## 7. 三重失控闸

### 7.1 检查点与判据

| 闸 | 判据 | 检查点 | 触顶后 |
|---|---|---|---|
| 轮次 | 本段已发起的 LLM 往返数 ≥ `max_turns` | 每次往返前 | 停止开新往返 |
| token | 本段累计 `Σ(input + output)` ≥ `max_tokens` | 每次往返后（读本次 usage）；往返前再查一次 | 同上 |
| 时间 | `Instant::now() ≥ deadline` | 每次往返前、每个工具调用前 | 同上 |

- **token 计数含缓存命中部分**（`input_tokens` 含 cached）：缓存只影响价格，不影响预算判据；简单、
  可预测、对失控方向保守。
- **压缩调用的 usage 计入本段预算**（否则反复压缩成为绕过闸的洞），但**不折叠进父会话读数**（沿用
  「压缩是内部汇总调用，不计入会话读数」的既有口径）。
- **父回合停止请求优先于一切**：检查点读到停止即 `Aborted`。

### 7.2 收敛语义

任一闸触顶：不再发起新往返、不再执行新工具调用，用已有产出构造部分结果——`summary` 取子会话里最后
一条非空助手文本；没有则为空串 + `note`。**不追加「请总结」的 LLM 调用**：那等于给闸开一个不受预算
约束的尾巴。`status=partial`、`stopped_by` 精确点名哪一闸、`resumable=true`。

### 7.3 错误与部分输出

- 子运行 LLM 报错：已有助手文本 ⇒ `partial` + `stopped_by=error`（部分工作不丢，参照系同款语义）；
  什么都没有 ⇒ `failed{code}`。
- 失败不自动重试（机制不自作主张）；父 agent 可重新委派或 resume（failed 不可 resume，见 §5.3）。

### 7.4 时间闸的执行边界

已在执行的工具调用**不中途打断**：`cli_run` 自带 60 秒超时并 kill 子进程，其余工具是同步短操作。
实际 wall-clock 上界 = `deadline + 单次工具最长耗时`（最坏 60 秒）。这条边界写进 spec scenario。

### 7.5 上下文溢出与压缩

- 超限 ⇒ 沿用既有「压缩后重试一次」路径；压缩只压子会话的内存态输入，不轮转审计文件（审计是一次
  运行的完整轨迹，不是可恢复会话），压缩动作落 `compact` sidecar。
- 压缩后仍超限 ⇒ `failed{code: harness_context_overflow}`。
- 压缩 usage 计入本段预算，不折叠父会话读数。

## 8. 工具集与权限

### 8.1 白名单

闭集合 = 8 件 vault 工具（`vault_read` / `vault_search` / `vault_patch` / `vault_create` /
`vault_move` / `vault_delete` / `skill_load` / `cli_run`）；`task` 不在可授予集合内。

| 工具 | 定义未声明时 | 声明后 | 备注 |
|---|---|---|---|
| `vault_read` / `vault_search` / `skill_load` | ✅（缺省集合） | ✅ | 只读三件 |
| `vault_patch` / `vault_create` / `vault_move` | ❌ | ✅ | 默认 `vault_write` 档下权限管线自动放行 |
| `vault_delete` | ❌ | ✅ | 该档需批准 → 子运行内被拒（`approval_unavailable`） |
| `cli_run` | ❌ | ✅ | 只读白名单命令放行；写命令需批准 → 被拒；危险黑名单需批准 → 被拒 |
| `task` | ❌ | ❌ | 定义非法（§5.4） |

**声明只决定「工具是否可见」，放行仍由权限管线判定**。子运行不放松也不额外收紧用户选定的档位；它
只是**没有人类可批准**，因此一切落到 ask 的调用被拒并计数。默认 `vault_write` 档下声明 `vault_patch`
的子运行能写、声明 `vault_delete` 的不能——前者在用户选定档位里自动放行，后者本来就要问人。

### 8.2 执行层二次校验与批准缓存

- 请求构造时按白名单过滤工具定义（模型看不见未声明的工具）；`tools::execute` 再查一次白名单，
  白名单外的调用以 `tool_not_allowed` 拒绝、不执行（防模型幻觉出未声明工具名）。
- 子运行 MUST NOT 复用父会话批准缓存：缓存免除的是人工批准动作，子运行本来就没有可批准的人；共享
  会让「用户在别处批准过类似命令」变成子运行的自动放行，等于从侧门恢复「自动批准」。

## 9. 用量归属与留存

### 9.1 折叠进父会话

```
子运行每段每往返 usage ──► 子会话累加器 ──(每段结束，一次)──► 父会话 UsageAccumulator
                                                              （input/cached/cache_write/samples 全加）
```

- 折叠点只有一处（每段收尾），避免中途读数抖动与重复计数；失败 / 中止的段同样折叠（已花的 token 是
  事实）。
- 折叠后父会话 cache% 是混合读数（父 + 子、可能跨模型）：这是「用量归主会话」的既定代价，在
  `config-reference.md` 写明；读数算法不改。
- 父会话 `ctx%`（最近一次请求 input ÷ 窗口）不受折叠影响。

### 9.2 父会话 sidecar 与审计流水

父会话 JSONL 每段一条 `subrun` sidecar：

```json
{"kind": "subrun", "run_id": "r-…", "segment": 1, "agent": "research", "description": "…",
 "model": "…", "status": "partial", "stopped_by": "tokens", "rounds": 8, "denied_calls": 0,
 "usage": {"input_tokens": 81000, "cached_tokens": 62000, "output_tokens": 2400},
 "audit": "harness/subruns/<vault 稳定 id>/<run_id>.jsonl"}
```

- 属于既有 sidecar 类别（wire 不可推导的决策与事件）：子运行的往返不在父会话 wire 历史里，无法从
  `llm_request` / `llm_response` 推导。
- **恢复重算**：`usage_from_records` 纳入 `subrun` 记录，按 `usage` 累加；不影响 ctx%（不是父会话的
  请求）。判据：live 折叠读数与恢复重算读数逐字段相等（单测钉住）。
- 审计流水：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的多个 segment
  追加同一文件；首段首行 `run_open`（run id / agent / 模型 / 工具集 / 预算 / 提交的 prompt），后续段
  写 `run_segment`（segment 序号 / 预算 / resume 说明）。MUST NOT 写 `sessions/`、MUST NOT 写 vault。
- 不进会话列举 / 恢复 / 删除链路；不做 UI；写失败不阻断运行（沿用既有纪律），事件里带 `audit_error`。

### 9.3 内存保留（resume 的前提）

- `SubagentRegistry`（挂在父会话或 `Runtime` 上）按 `run_id` 保留子 `Session` 与元数据（agent、
  模型、mock 游标、最后使用时间），上限 `MAX_RETAINED_RUNS = 4`，LRU 淘汰。
- 保留期 = 父会话生命周期；父会话重置 / 恢复 / 关闭 vault 时清空（跨重启不可 resume）。
- 内存量级：单个子会话的峰值约等于其上下文（默认上限 200k token ≈ 数百 KB 文本），4 个以内可控；
  不做磁盘换出（审计流水已在盘上，但**不是**可恢复会话——见 §9.2）。

## 10. 上下文装配与隔离

- **system** = 定义正文（非空时**替换**固定身份段；空正文则只用固定身份段）+ 固定的「委托运行约束」
  段（只做被交代的任务、不与用户交互、不能请求批准、不能再次委派、结束时直接给摘要：结论 + 依据 +
  不确定项 + 未覆盖范围）+ AGENTS.md 三层 + Skill 索引。
  - 参照系里自定义正文**整体替换**默认 system prompt；本仓的 AGENTS.md 三层保留（参照系默认也加载
    CLAUDE.md），委托约束段是机制级补充，不写进定义文件。
- **input** = 空历史 + 一条 user 消息（`prompt` 原文，单 text part）。MUST NOT 继承父会话任何消息。
- **Skill 索引**：同一份 `discover_skills(vault_root)`；`skill_load` 在只读缺省集合内。
- **编辑器上下文**：不注入（子运行没有「当前编辑器」语义）；所需路径由 `prompt` 给出。

## 11. 模型解析

解析序（参照系）：

1. 调用参数 `model`（显式 id）——非法即 `model_not_configured`（调用方是模型，静默回落会训练错误习惯）；
2. 定义 `model`——`inherit` 或缺省 ⇒ 第 3 步；显式 id 不在 provider 清单 ⇒ 装载期 warning + 回落
   `inherit`（定义是用户手写配置，按配置约定回落）；
3. 当前 provider 的会话模型。
4. resume 时：调用参数 > 保留 run 上次使用的模型（参照系：调用级模型在 resume 时保持）> 定义。

思考档位继承父会话，不开放为定义字段（`effort` 字段按 §4.2 走「本版本不采纳」warning）。

## 12. 并发与串行

- 子运行在父回合同一线程内同步执行；一次助手消息里的多个 `task` 调用按既有「tool_calls 逐个执行」
  串行跑。不做后台 / 并行（proposal 参照系「刻意不同」）。
- `max_subruns_per_turn`（默认 8）按父回合计数，只计**实际进入执行**的段（被拒调用另由
  `subagent_rejected` 记录，不占额度）。
- 子运行不碰 `Runtime` busy 锁；父会话在子运行期间保持 busy（用户再次发送仍被既有 `harness_busy` 挡下）。

## 13. 诊断事件

| 事件 | 字段 |
|---|---|
| `subagent_started` | `run_id`, `segment`, `parent_session`, `agent`, `description`, `model`, `tools[]`, `max_turns`, `max_tokens`, `timeout_secs` |
| `subagent_finished` | `run_id`, `segment`, `agent`, `status`, `stopped_by`, `rounds`, `input_tokens`, `cached_tokens`, `output_tokens`, `denied_calls`, `duration_ms`, `summary_chars`, `audit`（写失败时另带 `audit_error`） |
| `subagent_rejected` | `reason`, `agent`, `description` |
| `subagent_catalog_large` | `estimated_tokens`, `definition_count` |

- 四事件进 `logging.rs` 白名单，字段逐个校验；`status` / `stopped_by` / `reason` 为闭集合。
- 事件在段收尾处产出一次，失败路径也产；MUST NOT 含 prompt 内容与 vault 绝对路径。

## 14. 配置面

`[harness.subagents]`（装载时读一次，改配置需重启；定义文件与此不同，按回合扫描）：

| 键 | 缺省 | 合法域 | 语义 | 消费者 |
|---|---|---|---|---|
| `enabled` | `true` | bool | 总开关 | `task` 是否注册 |
| `max_turns` | `20` | 1–64 | 定义未写时的轮次预算，同时是定义值的上限 | 预算构造 |
| `max_tokens` | `200000` | 1–10000000 | 同上（token 闸） | 预算构造 |
| `timeout_secs` | `300` | 1–3600 | 同上（时间闸） | 预算构造 |
| `max_subruns_per_turn` | `8` | 1–64 | 父回合委派段数上限 | 次数闸 |

- 校验沿用既有模板：类型不符整节回落 + warning；数值越界夹取 + warning；应用不因配置错误启动失败
  （ADR 0002 第 5 条）。
- 定义字段是「用户意图」，配置是「用户设定的上限」；二者冲突时取小（定义值夹取）。
- ts-rs 导出 `SubagentsConfig`；本 change 无新增 UI。

## 15. 失败模式与边界

- **定义被丢弃**：调用该名字 ⇒ `agent_not_found`，消息列出当前可用名字。
- **空目录 / 全定义非法**：`task` 不注册（模型看不见），无调用面。
- **YAML 解析失败**：丢定义 + warning；其余定义照常。
- **目录在回合中途变化**：下个回合生效（本回合用快照）；不会出现同一回合内定义前后不一致。
- **API 中断**：有文本 ⇒ partial + `stopped_by=error`；无文本 ⇒ failed。
- **父回合停止**：子运行下一检查点收敛为 `Aborted`，不产工具结果。
- **应用退出**：子运行随进程终止；审计可能半截（append-only 可读）；父会话无该段 sidecar，恢复读数
  不计这段——与既有「运行中退出应用」同类边界；内存保留随之丢失（resume 不可用）。
- **run 被 LRU 淘汰**：resume ⇒ `run_not_resumable`（消息说明保留上限与替代做法：重新委派）。
- **resume 的 agent 不匹配**：`agent_mismatch`，不继续。
- **模型幻觉工具名**：执行层白名单二次校验拒绝，回送 `tool_not_allowed`。
- **mock 脚本条目不足**：沿用 `fixture_exhausted` 错误，段以 failed 收尾。
- **审计写失败**：不阻断运行，`subagent_finished` 带 `audit_error`。
- **描述清单巨大**：只 warning 不截断（截断 = 定义静默消失）。

## 16. 与 cron 提案的对接

| 事项 | cron 提案现状 | 本 change 后的落法 |
|---|---|---|
| 运行交接载荷 | `cron:run` 事件字段自列 | `RunSpec` 序列化（字段是超集） |
| 运行槽位 | 「与交互会话分离的运行槽位」 | `SessionTarget::Unattended` |
| 批准语义 | 需批准即中止并回执失败 | `ApprovalPolicy::RejectUnavailable`，行为不变 |
| 预算 | 无 token / 时间闸 | `RunBudget` 只填轮次上限 |
| 留存 | 既有会话 JSONL | 不变 |

实现顺序（建议，非阻塞）：本 change 公共层先落 → cron 实现按 `RunSpec` 接入；若 cron 先开工，其交接
载荷直接按 `RunSpec` 形状写，公共层由本 change 补齐。**不允许两套交接形状并存。**

## 17. 真机验收场景设计（`scripts/acceptance/scenarios/`）

1. **定义发现与自动委派**：vault 放两个定义（如 research / reviewer），mock 父响应直接 `task(agent=research)`；
   断言 `subagent_started.agent=research`、工具定义里出现清单、父会话收到摘要。
2. **默认只读**：定义不写 `tools`，断言子运行请求的 `tools` 恰为只读三件。
3. **显式写工具**：定义 `tools: [vault_patch]` + `vault_write` 档，断言写入成功且走既有工具语义。
4. **需批准调用被拒**：定义 `tools: [vault_delete]` + 默认档，断言 `approval_unavailable`、
   `denied_calls=1`、文件未删。
5. **定义校验**：一组坏定义（缺 name、未知工具、`tools: [task]`、未知字段、超上限数值、同名）各产
   对应 warning；好定义照常可用；`tools: [task]` 的定义不可调用。
6. **同名优先级**：vault 与用户级同名，断言 vault 生效；同层同名断言字典序第一个 + warning。
7. **热加载**：回合间改定义（换模型 / 换工具），下一回合委派断言新字段生效，无需重启。
8. **描述超阈值告警**：生成超阈值的定义集合，断言 `subagent_catalog_large` + warning，清单未被截断。
9. **三重闸触顶**：`max_tokens` / `max_turns` / `timeout_secs` 分别极小，断言 `partial` + 正确
   `stopped_by` + 无追加总结调用。
10. **resume 续跑**：触顶后 `task(resume=run_id)`，断言同 `run_id`、`segment=2`、审计同一文件追加、
    总量增加；resume 后 `completed`。
11. **resume 边界**：第 5 个 run 淘汰第 1 个后 resume ⇒ `run_not_resumable`；重启后 resume 同样。
12. **用量折叠与恢复**：完成 / partial 后父会话读数增加；重启恢复后读数与 live 相等（含 sidecar 重算）。
13. **模型解析**：调用覆盖生效；定义非法 id 回落 inherit + warning；调用非法 id 拒绝。
14. **开关与次数闸**：`enabled=false` 时工具不注册；`max_subruns_per_turn=1` 时第二个委派
    `subrun_limit`。
15. **API 中断 partial**：mock 返回错误但已有文本，断言 `partial` + `stopped_by=error`。

备注（写进场景注释）：子运行过程不上屏，判据一律取 JSONL / 事件 / 快照，不取截图；mock 按 §18 的
父子游标约定编排。

## 18. mock 与父子游标

mock provider 的脚本是单条线性序列（`MockClient`），父子客户端各自持有游标：

- 子运行的 mock 起点 = 父会话游标 + 父客户端本轮已消费条数（绝对位置）；脚本按「父第 1 条 = task
  调用 → 子运行 N 条 → 父续写」顺序编排；
- 子运行结束后父客户端前移子运行消费的条数（`LlmClient` 增 `external_consumed()` / `skip(n)`，
  真 provider 恒 0 / no-op）；父回合结束按既有规则回写会话游标；
- resume 段沿用保留 run 的 mock 游标（子会话元数据里带 `mock_cursor`），继续往下弹；
- 验收场景按此顺序写 fixture，断言「父续写的响应紧跟子运行条目」，不依赖时间。
