# Design: add-harness-subagents

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 两件事同时交付：**运行公共层回抽**（`RunSpec` / `RunContext`，`harness` capability）与
> **委托运行**（子代理定义文件 + `task` 工具 + 子运行引擎，`harness-subagents` capability）。
> 形态参照 [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)（2026-10-18 抓取）：
> 定义即文件、按名字委派、按 `description` 自动委派、部分结果可 resume。与参照系的逐项对照与
> 刻意偏离见 proposal「参照系」节；真源已裁决的两条（默认收紧 / 三重闸）不因参照系松动。
> 第二轮修订按 Alex 节点 1 阅读中的裁决：并行 + 后台运行、批准卡透传、内建 `explore`、用量按模型
> 分桶、用户可见面（任务面板 + 原型）。第三轮修订按节点 1 终审前的两条裁决：后台完成**自动唤醒**
> 父会话（推翻原「不自动起回合」）+ **链式失控闸**（§12.6）、降级检查改由 cron 承载。逐条出处见
> proposal「裁决留痕」。

## 1. 形态总览

```
   <vault>/.lumir/agents/**/*.md  ┐
   <config_dir>/agents/**/*.md    ┴─► 每回合开头扫描 + 校验 → 定义快照
   （内建 explore 走同一装载路径；用户 / vault 同名覆盖）
                                              │
                          ┌───────────────────┴────────────────────┐
                          ▼                                        ▼
              task 工具描述（名字 + 描述清单）           委派时：读正文 → 构造 RunSpec
              （主 agent 据此自动委派；超阈值告警）                   │
                                     ┌───────────────────────────────┴─────────────┐
                                     ▼                                             ▼
                              前台 task（本回合等待）                      后台 task（跨回合继续）
                                     └────────────────────┬────────────────────────┘
                                                          ▼
                                     SessionScheduler（会话级并发上限 + per-provider 请求闸）
                                                          │ 每 run 一条线程
                                                          ▼
                                                     RunContext（ChildContext）
                                                     system：定义正文 + 委托约束 + AGENTS 三层 + Skill
                                                     input：任务 prompt（空历史）
                                                     tools：定义 tools（缺省只读三件）
                                                     budget：定义字段 ∩ 配置上限
                                                     approval：透传父会话（请求带 agent / run 来源）
                                                                     │
                                          ┌──────────────────────────┴─────────────────┐
                                          ▼                                            ▼
                                  harness 循环（唯一一份）                    收尾：按模型分桶记账 +
                                  三重闸检查 / 工具执行                          sidecar + 审计 flush +
                                                                                事件 + 面板行终态
```

三类触发源（用户输入 / cron / 委托）共用一份 `RunSpec` 与一个循环；差异在契约值（会话目标、批准
策略、工具白名单、预算），不在循环内分支。**并行不是新的触发源**：它是「同一个父回合里多个委托
RunSpec 并发执行」，调度与配额口径见 §12。

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

/// 批准策略：交互会话与子运行的 ask 透传给同一个人（同一次会话）；cron 的无人值守槽位才拒绝。
pub enum ApprovalPolicy {
    Interactive,
    PassthroughFrom { run_id: String },
    RejectUnavailable,
}

pub enum RunOutcome {
    Completed,
    Partial { stopped_by: StopReason },   // rounds | tokens | time | quota | error
    Failed { code: String, message: String },
    Aborted,
}

/// 一次运行的报告。usage 只描述这一段自己花的量；按模型分桶由收尾方（父会话）决定。
pub struct RunReport {
    pub outcome: RunOutcome,
    pub model: String,
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

`RunSpec` 组合上述字段；**不含任务知识**（不认路径、不认 vault 约定、不认场景名）。另带
`background: bool`：只有委托运行会置 true，它决定的是**收尾投递方式**（立即返回 `running` +
完成时通知，通知可能给父会话起一个自动回合 vs. 本回合等待结果），不改变循环本体。实现提示：会话与
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
  不碰父会话的 busy 锁。resume 时复用内存里保留的子会话（§9.3）。每条 run 跑在自己的线程上；前台
  由父循环 join，后台由调度器持句柄（§12.4）。
- `sink()`：`ChildSink` 把子运行的过程事件（text / reasoning / tool_call 内容）转成**面板事件**
  （`subagent_progress` / `subagent_step`，带 run_id），并累计 `tool_calls` 计数；MUST NOT 把过程
  消息写进父会话 transcript 或父会话历史——父会话上下文只拿 `task` 工具结果与后台完成通知。
- `permission()`：复用 `permissions::decide`（同一份权限档与规则表）；`approval()` 走 §8.3 的透传
  通道：请求带 `source = {agent, run_id, description}` 挂进父会话的待批列表，本线程只等自己的信号。
- `budget()`：§7（时间闸扣除审批等待时长）。
- `persist()`：子运行审计流水（§9.2）；每段收尾按模型分桶记入父会话（§9.1）。
- 父回合停止请求：父循环注入停止标志读取闭包（不持有父会话）；检查点读到停止即 `Aborted`，父循环走
  既有 `aborted` 路径（不产 `task` 工具结果）。停止是**广播**的：一次停止让所有在跑的 run 收敛为
  `Aborted`（§12.4）。

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
- **内建定义**：`explore` 由代码内置一份定义（`tools` = 只读三件，`model` = `inherit`，三闸取配置
  缺省，`description` 见 §4.6），与磁盘定义一起进入同一个快照与同一条校验 / 清单注入路径——不是代码
  里的特殊分支，也没有「内建专用」的工具集或权限面。
- **覆盖规则**：用户级 / vault 级同名定义覆盖内建（更具体的作用域优先），覆盖时产一条 warning；
  清单里只出现一次（生效的那份）。参照系同款规则（自定义 `Explore` 覆盖内建）。

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
| `background` | 否 | bool | `false` | 强制后台运行（§12.5）；调用参数只能把前台升为后台，不能把定义的后台降为前台 |

- **正文**（frontmatter 之后）即子运行 system prompt 的身份段（§10）。内建 `explore` 无磁盘文件，
  正文由代码内置一份（只读探索、产出结论 + 依据 + 未覆盖范围）。
- 字段名采本仓配置惯例的 **snake_case**；参照系用 camelCase（如 `maxTurns`），这是命名惯例差异、不是
  形态差异——写错大小写的字段会被「未识别字段」warning 点名，不会静默失效。
- 未识别字段：产 warning 并忽略（列名 + 提示「v1 不采纳」），不静默吞掉。参照系忽略未知字段且不报错，
  本仓选择报错可见——定义是用户手写制品，拼错字段名应当被发现。
- 参照系有、本稿不采纳的字段（`disallowedTools` / `permissionMode` / `skills` / `initialPrompt` /
  `isolation` / `omitClaudeMd` / `hooks` / `mcpServers` / `memory` / `effort` / `color`）走同一
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

丢弃是**逐定义**的，不影响其它定义；扫描本身永不失败（最多全空）。空目录 / 全部自定义定义非法时
清单只剩内建 `explore`，`task` 照常注册（模型仍可委派只读探索）；`enabled=false` 是唯一的不注册
路径。

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

### 4.6 内建 `explore`

| 项 | 值 |
|---|---|
| `name` | `explore` |
| `description` | 「只读探索：在 vault 里搜索、按路径枚举、读取文件与 skill，产出结论与依据；不改文件、不跑命令。」 |
| `tools` | `vault_read` / `vault_search` / `skill_load` |
| `model` | `inherit` |
| 三闸 | 取 `[harness.subagents]` 缺省（定义不写值，也就没有夹取） |
| 正文 | 内置身份段：只做探索与综合，输出「结论 + 依据（vault 相对路径）+ 不确定项 + 未覆盖范围」 |

- **为什么是只读**：这是「调研类默认收紧」的现成样板，也把「探索」与「落地写」分开——写类委派由
  用户自己的定义承担，内建不预设任何写入能力。
- **撞名**：同名自定义定义覆盖它（§4.1），覆盖产 warning；不提供「单独禁用内建」的开关，`enabled =
  false` 是全局 kill switch（Alex 裁决的语义就是全局启停）。
- **不落盘**：内建定义不出现在 `<vault>/.lumir/agents/`，来源标记为 `builtin`（面板清单可见），因此
  也不受「非法定义逐条丢弃」路径影响——它是代码里的默认快照项，与磁盘定义走同一条清单注入与装载
  路径。

## 5. `task` 工具契约

### 5.1 schema（`src-tauri/src/harness/tools.rs`）

```json
{
  "name": "task",
  "description": "把任务委派给一个子代理：子代理有独立上下文，只把摘要返回；不能再次委派；需要批准的调用会弹给用户。可用子代理：\n- research：…\n- reviewer：…",
  "parameters": {
    "type": "object",
    "properties": {
      "agent": {"type": "string", "description": "子代理定义名（见本工具描述里的清单）"},
      "prompt": {"type": "string", "description": "自包含的任务说明：目标、范围、输出形态（结论 + 依据 + 不确定项）"},
      "description": {"type": "string", "description": "一句话任务标签，显示在工具行与诊断里"},
      "model": {"type": "string", "description": "可选，调用级模型覆盖；缺省用定义里的 model，再缺省 inherit"},
      "resume": {"type": "string", "description": "可选，run_id；在同一子代理会话上继续（通常用于续跑 partial 结果）"},
      "background": {"type": "boolean", "description": "可选，true = 后台运行：本调用立即返回 running，结果稍后以自动化通知进入会话；定义 background: true 时强制后台"}
    },
    "required": ["agent", "prompt", "description"]
  }
}
```

工具集与闸值不在调用参数里——它们是定义字段（参照系形态）。`model` 与 `background` 是仅有的两个
调用级覆盖项：前者对应参照系的模型优先级，后者对应参照系 Agent 工具的 `run_in_background`。

### 5.2 结果信封

```json
// 完成
{"ok": true, "status": "completed", "agent": "research", "run_id": "r-…", "resumable": true,
 "model": "…", "summary": "…", "truncated": false,
 "usage": {"input_tokens": 81000, "cached_tokens": 62000, "output_tokens": 2400},
 "rounds": 5, "denied_calls": 0, "tool_calls": {"vault_read": 6, "vault_search": 2}}

// 触顶（部分结果）
{"ok": true, "status": "partial", "agent": "research", "run_id": "r-…", "resumable": true,
 "stopped_by": "tokens", "model": "…", "summary": "…", "truncated": false,
 "note": "子运行触及 token 预算；可用 resume 续跑", …}

// API 中断但已有文本 / provider 配额耗尽
{"ok": true, "status": "partial", "stopped_by": "error", "note": "子运行被 API 错误中断；以下为已产出部分", …}
{"ok": true, "status": "partial", "stopped_by": "quota", "note": "provider 配额或限流；不自动重试", …}

// 后台启动成功（本调用立即返回；结果稍后作为自动化通知进入会话）
{"ok": true, "status": "running", "agent": "research", "run_id": "r-…", "background": true,
 "model": "…", "note": "后台运行中；完成后结果以自动化通知进入本会话"}

// 失败（沿用既有失败信封）
{"ok": false, "code": "agent_not_found", "message": "…"}
```

- `stopped_by ∈ {rounds, tokens, time, quota, error}`；`resumable` 仅对 completed / partial 为
  true。`quota` 与 `error` 分开：前者指向配额（父 agent 的正确反应是等或换模型，不是重试同一条
  路径），后者指向一次具体失败。
- **摘要上限 8,000 字符**（经验初值，与 `cli_run` 单侧 10,000 字符同量级）：超出取头尾各一半、中间
  标 `…[截断]`，并置 `truncated: true`；MUST NOT 静默截断。
- 子运行没有产出任何助手文本（第一轮就触顶）时 `summary` 为空串，`note` 说明已完成多少轮工具调用；
  父 agent 据 `tool_calls` 知道「材料读到了但没综合」。
- 失败码闭集合：`disabled` / `agent_not_found` / `run_not_resumable` / `run_busy` / `agent_mismatch` /
  `subrun_limit` / `concurrency_limit` / `model_not_configured` / `empty_prompt` /
  `harness_context_overflow`。`concurrency_limit` 只给**后台**启动用（拿不到并发许可即拒，不留排队
  句柄）；前台调用等许可，不返回该码。

### 5.3 resume 语义

- `resume=run_id` 时在**同一子会话**上继续（保留完整历史：消息、工具结果、思考回放），新 `prompt`
  作为一条新的 user 消息；`agent` 必须与保留 run 的 agent 相同，否则 `agent_mismatch`；目标 run 仍在
  运行（后台未收敛）时回 `run_busy`，不并发写同一子会话。
- 模型：调用参数 > 保留 run 上次使用的模型 >（首次时的）定义字段；参照系同样规定调用级模型在 resume
  时保持。
- 预算：每次 resume 是一段新预算（定义字段，夹取配置上限）；token 计数按段清零，usage 按段分桶记账。
- 保留：每父会话最多保留 **4** 个 run（常量 `MAX_RETAINED_RUNS`，不做配置项）；超出按最久未用淘汰，
  被淘汰或跨重启的 resume 返回 `run_not_resumable`。`failed` / `aborted` 的 run 不可 resume。
  **后台 run 与前台 run 同一条保留规则**：后台完成（completed / partial）后仍可 resume，直到被 LRU
  淘汰或父会话重置。
- 段身份：`run_id` 标识整段对话，`segment`（从 1 起）标识第几次调用；审计流水同一文件追加，sidecar
  与诊断事件都带 `segment`。并行时不同 run 的 segment 各自递增，互不参照。

### 5.4 深度 1 的强制（白名单即机制）

- 子运行的工具定义恒来自定义 `tools`，而 `task` 不在可授予集合内：**不维护运行时深度计数**。
- 定义把 `task` 写进 `tools` ⇒ 该定义非法、装载期丢弃 + warning（作者错误尽早暴露，不在调用期报错）。
- 若未来允许更深派生，改动面是「给子运行授予 `task` + 引入深度预算」；v1 不预留开关。

## 6. 子运行生命周期

```
task 调用（父循环内；同一助手消息里的多个 task 并行进入本流程）
  → 解析参数（agent 存在？prompt 非空？resume 有效？background 取值？）
  → 次数闸（本回合已发起段数 < max_subruns_per_turn）
  → 并发许可（会话级 < max_concurrent；后台非阻塞取，取不到即 concurrency_limit）
  → 取定义快照 → 预算 = 定义字段 ∩ 配置上限 → 模型解析
  → 装配：定义正文 + 委托约束段 + AGENTS 三层 + Skill 索引；空 input + [user: prompt]
  → 打开 / 追加审计流水 subruns/<vault id>/<run_id>.jsonl（首段写 run_open）
  → 起 run 线程：前台由父循环等待；后台立即回 status=running，句柄交调度器
  → 循环（§7）：每往返前查闸 → 经请求闸发请求 → 执行工具（白名单 + 权限 + 审批透传）→ 回送
  → 收敛：completed / partial / failed / aborted
  → 收尾（任何终态）：按模型分桶记账 + 父会话 subrun sidecar + 诊断事件 + flush + 面板行终态；
    保留子会话（可 resume）；后台 run 另交唤醒调度（完成通知落库上屏 + 可能的自动回合，§12.5 / §12.6）
  → 释放并发许可 → 返回工具结果信封（后台在启动时已返回）
```

收尾必须在任何终态跑到（含 panic）：与父回合同款 `catch_unwind`，收尾在 unwind 处理之后显式执行
（Rust 无 finally），审计句柄与用量累加器由收尾函数消费，且只消费一次。

## 7. 三重失控闸

### 7.1 检查点与判据

| 闸 | 判据 | 检查点 | 触顶后 |
|---|---|---|---|
| 轮次 | 本段已发起的 LLM 往返数 ≥ `max_turns` | 每次往返前 | 停止开新往返 |
| token | 本段累计 `Σ(input + output)` ≥ `max_tokens` | 每次往返后（读本次 usage）；往返前再查一次 | 同上 |
| 时间 | 运行时长（扣除审批等待）≥ `timeout_secs` | 每次往返前、每个工具调用前 | 同上 |
| 配额 | provider 返回配额耗尽 / 限流错误 | 每次请求错误后 | 不自动重试，按已有产出收敛 `quota` |

- **时间闸按「运行时长」计，等待人工批准的时间不计入**：子运行挂起在批准卡上时 deadline 顺延。
  等人的延迟不是模型的失控方向；若照绝对墙钟计，用户离开几分钟就会把子运行跑成 partial，而它
  什么都没做错。副作用要说清：时间闸的墙钟上界因此是「运行时长 + 等待批准时长 + 单次工具最长耗时」，
  写进 spec scenario。

- **token 计数含缓存命中部分**（`input_tokens` 含 cached）：缓存只影响价格，不影响预算判据；简单、
  可预测、对失控方向保守。
- **压缩调用的 usage 计入本段预算**（否则反复压缩成为绕过闸的洞），但**不进父会话任何模型的桶**
  （沿用「压缩是内部汇总调用，不计入会话读数」的既有口径）。
- **父回合停止请求优先于一切**：检查点读到停止即 `Aborted`。

### 7.2 收敛语义

任一闸触顶：不再发起新往返、不再执行新工具调用，用已有产出构造部分结果——`summary` 取子会话里最后
一条非空助手文本；没有则为空串 + `note`。**不追加「请总结」的 LLM 调用**：那等于给闸开一个不受预算
约束的尾巴。`status=partial`、`stopped_by` 精确点名哪一闸、`resumable=true`。

### 7.3 错误与部分输出

- 子运行 LLM 报错：已有助手文本 ⇒ `partial` + `stopped_by=error`（部分工作不丢，参照系同款语义）；
  什么都没有 ⇒ `failed{code}`。
- provider 配额耗尽 / 限流：`stopped_by=quota`，同样按已有产出收敛；**不自动重试、不换模型重来**
  （换档是父 agent 或用户的决定）。兄弟 run 不受影响，继续跑自己的段。
- 失败不自动重试（机制不自作主张）；父 agent 可重新委派或 resume（failed 不可 resume，见 §5.3）。

### 7.4 时间闸的执行边界

已在执行的工具调用**不中途打断**：`cli_run` 自带 60 秒超时并 kill 子进程，其余工具是同步短操作。
等待人工批准的时间不计入闸，所以实际墙钟上界 = `运行时长预算 + 等待批准时长 + 单次工具最长耗时`
（最坏 60 秒）。这条边界写进 spec scenario。

### 7.5 上下文溢出与压缩

- 超限 ⇒ 沿用既有「压缩后重试一次」路径；压缩只压子会话的内存态输入，不轮转审计文件（审计是一次
  运行的完整轨迹，不是可恢复会话），压缩动作落 `compact` sidecar。
- 压缩后仍超限 ⇒ `failed{code: harness_context_overflow}`。
- 压缩 usage 计入本段预算，但**不进父会话任何模型的桶**（沿用「压缩是内部汇总调用，不计入会话
  读数」的既有口径）。

## 8. 工具集与权限

### 8.1 白名单

闭集合 = 8 件 vault 工具（`vault_read` / `vault_search` / `vault_patch` / `vault_create` /
`vault_move` / `vault_delete` / `skill_load` / `cli_run`）；`task` 不在可授予集合内。

| 工具 | 定义未声明时 | 声明后 | 备注 |
|---|---|---|---|
| `vault_read` / `vault_search` / `skill_load` | ✅（缺省集合） | ✅ | 只读三件 |
| `vault_patch` / `vault_create` / `vault_move` | ❌ | ✅ | 默认 `vault_write` 档下权限管线自动放行 |
| `vault_delete` | ❌ | ✅ | 该档需批准 → 透传批准卡（§8.3） |
| `cli_run` | ❌ | ✅ | 只读白名单命令放行；写命令 / 危险黑名单需批准 → 透传批准卡 |
| `task` | ❌ | ❌ | 定义非法（§5.4） |

**声明只决定「工具是否可见」，放行仍由权限管线判定**。子运行不放松也不额外收紧用户选定的档位；
落到 ask 的调用弹批准卡给用户（§8.3），批准后执行、拒绝只废该次调用。默认 `vault_write` 档下声明
`vault_patch` 的子运行能直接写、声明 `vault_delete` 的写前要问人——与主会话完全同权。

**缺省收紧只是缺省值，不是能力天花板**：定义可声明上表任意子集（含 `cli_run`）。清单里没有 web 类
工具——这是 harness 本体的缺口（主会话同样没有），不是子代理被额外削减；联网检索的现时方式是
`cli_run` 调 `tvly` 一类外部 CLI（与主会话同权、同批准闸），补 web 工具须另立 change 并过 ADR 0007。
列目录经 `vault_search` 的 `path_glob` 完成（如 `项目/**`）。

### 8.2 执行层二次校验

请求构造时按白名单过滤工具定义（模型看不见未声明的工具）；`tools::execute` 再查一次白名单，
白名单外的调用以 `tool_not_allowed` 拒绝、不执行（防模型幻觉出未声明工具名）。

### 8.3 批准透传（Alex 裁决「确认」）

子运行**继承**用户选定的权限档，不另立档、不因是子代理而放松或收紧。ask 级调用照常进入批准闸，
卡片浮到父会话并点名发起者：

- **请求形状**：`ApprovalRequest` 增加 `source`：`{kind: "interactive" | "subrun", agent?, run_id?,
  description?}`。卡片主体（diff 预览 / argv / 判定依据 / 原因输入）与父会话同款，另加一行「来自
  <agent>：<description>」。
- **挂载点**：会话的待批项由单槽 `pending_approval` 改为按 ask 时间排序的列表
  `pending_approvals`（并行时多个子运行可以同时等）。挂载点由父会话统一持有；子线程只持有自己的
  `ApprovalSignal` 接收端，**任何代码不得在持有 `Runtime.sessions` 锁时等待子运行或用户决定**。
- **决策**：批准 → 该次调用执行；拒绝（可附原因）→ 回送子模型 `approval_denied`，不执行，
  `denied_calls` 加一，子运行**继续**（与参照系「拒绝只废这一次调用、不停子代理」一致）。
- **会话级记忆**：卡片上的「本会话不再问」写进同一份会话批准缓存（命名空间 `(vault, 父会话 id)`，
  键 `(工具, 规范化主体串)`），对父会话与所有子运行同时生效——一个用户、一次会话、一份授权状态。
  子运行 MUST NOT 拥有独立缓存或独立命名空间。
- **停止**：停止回合（或停止某个后台 run 时它自己挂起的请求）→ 对应待批项以
  `ApprovalSignal::Withdrawn` 收回，等待的线程如实记「已停止」，不混同「被拒绝」。
- **deny 规则 / 危险黑名单 / vault 内写重定向**三层不受透传影响：它们先于批准闸，照样直接生效。

## 9. 用量归属与留存

### 9.1 按模型分桶记账

子运行的 usage **不**并入父会话的单一累计读数（Alex：「不同的模型的 token 使用量没有任何意义」）。

```
子运行每段每往返 usage ──► 子会话累加器 ──(每段结束，一次)──► 父会话 SubrunUsageTable[model]
                                                               {input, cached, writes, output,
                                                                samples, segments}
```

- 桶键是**实际使用的模型 id**（按 §11 解析出的结果）：同一模型的多段相加，不同模型各占一桶。
  分桶表挂在会话读数面上，供任务面板、`harness_state` 快照与诊断事件读取。
- 父会话自己的 `ctx%` / cache% 只由父会话自己的往返计算，**不掺子运行数字**——跨模型混算的百分比
  没有解释力。「`ctx%` 不受子运行影响」与「cache% 不再被稀释」是同一句话的两面。
- 记账点只有一处（每段收尾），避免中途读数抖动与重复计数；失败 / 中止的段同样记账（已花的 token
  是事实）。
- 配额口径不分桶：所有桶都算进同一 provider 配额，见 §12.3。

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
- **恢复重算**：`usage_from_records` 纳入 `subrun` 记录，按 `model` 归桶累加；不影响 ctx%（不是
  父会话自己的请求）。判据：live 分桶表与恢复重算的分桶表逐字段相等（单测钉住；求和与记录顺序无关，
  并行的完成顺序不影响读数）。
- 审计流水：`<config_dir>/harness/subruns/<vault 稳定 id>/<run_id>.jsonl`，同一 run 的多个 segment
  追加同一文件；首段首行 `run_open`（run id / agent / 模型 / 工具集 / 预算 / 提交的 prompt），后续段
  写 `run_segment`（segment 序号 / 预算 / resume 说明）。MUST NOT 写 `sessions/`、MUST NOT 写 vault。
- 不进会话列举 / 恢复 / 删除链路；不做 UI；写失败不阻断运行（沿用既有纪律），事件里带 `audit_error`。

### 9.3 内存保留（resume 的前提）

- `SubagentRegistry`（挂在父会话或 `Runtime` 上）按 `run_id` 保留子 `Session` 与元数据（agent、
  模型、mock 游标、最后使用时间），上限 `MAX_RETAINED_RUNS = 4`，LRU 淘汰。并行时多线程共享同一张
  表，访问加锁；**运行中的 run MUST NOT 被淘汰**，淘汰只作用于已收敛的 run。
- 保留期 = 父会话生命周期；父会话重置 / 恢复 / 关闭 vault 时清空并中止仍在跑的后台 run（跨重启不可
  resume）。
- 内存量级：单个子会话的峰值约等于其上下文（默认上限 200k token ≈ 数百 KB 文本）。峰值受两个上限
  共同封顶：`max_concurrent`（同时在跑）与 `MAX_RETAINED_RUNS`（已收敛仍保留）；不做磁盘换出
  （审计流水已在盘上，但**不是**可恢复会话——见 §9.2）。

## 10. 上下文装配与隔离

- **system** = 定义正文（非空时**替换**固定身份段；空正文则只用固定身份段）+ 固定的「委托运行约束」
  段（只做被交代的任务、不与用户交互、不能再次委派；需要用户决定的调用交给批准闸透传（§8.3），
  不能自己假设答案；结束时直接给摘要：结论 + 依据 + 不确定项 + 未覆盖范围）+ AGENTS.md 三层 +
  Skill 索引。
  - 参照系里自定义正文**整体替换**默认 system prompt；本仓的 AGENTS.md 三层保留（参照系默认也加载
    CLAUDE.md），委托约束段是机制级补充，不写进定义文件。
- **input** = 空历史 + 一条 user 消息（`prompt` 原文，单 text part）。MUST NOT 继承父会话任何消息。
- **过程可见与上下文隔离分开**：子运行的过程事件只投向任务面板详情与诊断（§19），MUST NOT 进入父
  会话 transcript 正文，也 MUST NOT 进入父会话的 LLM 历史。
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

## 12. 并发、后台与调度

### 12.1 执行模型

- **同回合并行**：同一条助手消息里的多个 `task` 调用并行启动；非 `task` 调用仍按既有「tool_calls
  逐个执行」顺序跑。消息结束的条件 = 非 `task` 调用跑完且所有前台 `task` 收敛——前台 `task` 因此
  仍是「本回合等待」，只是彼此之间不再排队。
- 每条 run 一条线程（`lumir-subagent-<run_id>`），各自持有自己的 `LlmClient` 与 `Session`；父线程
  只在前台 join / 后台句柄上阻塞，不共享可变会话态。
- **并发许可**：会话级计数信号量，上限 `max_concurrent`（缺省 4）。前台调用阻塞取许可；后台调用
  非阻塞取，取不到即 `concurrency_limit`（不排队——后台的语义是「现在就跑」，排队会让人以为已经在跑）。
- `max_subruns_per_turn` 按父回合计数所有实际进入执行的段（前台 + 后台）；被拒调用不占额度。
- **后台跨回合**：父回合收尾时不等待后台 run，busy 锁照常释放；后台 run 不持有 busy 锁。前台与后台
  共用同一套引擎、闸与记账，差异只有「父是否等待」与「结果怎么投递」（§12.5）。

### 12.2 事件交错

1. **每个 run 一条独立事件流**：`subagent_progress` / `subagent_step` / `subagent_finished` 都带
   `run_id` + `segment`；同一 run 内严格有序，跨 run 的相对顺序**无意义**，MUST NOT 依赖。
2. **transcript 不重排**：父会话里的 `task` 工具行在调用发生时按调用顺序创建，之后只就地更新状态
   （运行中 → 完成 / 触顶 / 失败 / 后台），MUST NOT 因完成顺序改变行的位置。
3. **工具结果按调用顺序回填**：父请求的 tool results 以原 `tool_calls` 顺序提交（并行只影响**执行**
   时刻，不影响结果排列）——模型看到的结果顺序与它发出的调用顺序一致。实现：结果收进
   `BTreeMap<call_index, ToolResult>`，全部收敛后按索引展开。
4. **面板按 run 路由**：面板行是 run 的视图，事件只更新自己的行；多个 run 同时推进时各行独立刷新，
   没有跨 run 的合并排序。
5. **记账顺序无关**：分桶表是求和，sidecar 记录各带自己的 run_id / segment；并行完成顺序不改变
   读数（live == 恢复重算）。
6. **审计文件按 run 隔离**：每个 run 一个文件，不存在跨 run 的写入交错。
7. **批准按 ask 时间排队**：多个 run 同时等批准时，待批列表按 ask 时间排序；决策只回给发起者。
8. **诊断配对靠 run_id**：`subagent_started` / `subagent_finished` 用 run_id + segment 关联，MUST NOT
   按时间邻近配对。

### 12.3 配额争用

所有运行共享同一 provider / 同一账号配额；并行 N 路意味着峰值 N+1 个在飞请求（含父自己的往返）。

- **请求级闸**：每 provider 一个计数信号量，许可数 = `max_concurrent + 1`。父会话自己的往返优先取
  许可（避免被自己的子任务饿死）；子请求之间 FIFO。
- **预算闸**：每个 run 的 token 预算独立且是硬闸；回合级最坏情况 = `max_subruns_per_turn ×
  max_tokens` + 父回合预算，写进 `config-reference.md`，让用户知道最坏花多少。
- **配额错误**：provider 返回配额耗尽 / 限流 ⇒ 该段以 `stopped_by=quota` 收敛，不重试、不自动降档；
  兄弟 run 继续（各自也可能撞上，各自收敛）。同回合连续 ≥2 段 quota 时面板出「配额不足」提示；机制
  不替父 agent 做「换模型」的决定。
- **缓存经济性**：每个子运行各付一次装配前缀（AGENTS 三层 + Skill 索引 + 定义正文），N 路并行 =
  N 份前缀。这是并行的固有成本：只对**互相独立**的子任务并行；互相依赖的任务串行反而省前缀。
- **与 cron 共享闸**：cron 的无人值守运行走同一个 provider 信号量，不因 GUI 侧并行改变调度。

### 12.4 取消与生命周期

| 情形 | 行为 |
|---|---|
| 父回合被用户停止 | 广播停止：所有在跑的 run（前台 + 本回合起的后台）在下一检查点收敛 `Aborted`；挂起的批准项全部 `Withdrawn`；被中止的 run 不触发唤醒（§12.6） |
| 面板上停止单个 run | 只停该 run；其它 run 不受影响；它的待批项收回；该 run 收敛为 `aborted`，不触发唤醒 |
| 父会话重置 / 恢复 / 切 vault / 退出应用 | 所有在跑的后台 run 中止并记 `aborted`；保留表清空（跨重启不可 resume）；唤醒调度与链计数一并清空 |
| 后台 run 触顶 / 出错 / 配额 | 按 §7 收敛；结果作为完成通知投递并按 §12.6 决定是否唤醒 |
| 用户停止自动回合 | 该回合按既有停止路径结束；唤醒置 `blocked = "stopped"`，后续通知不再唤醒 |
| 并发放开一格 | 被 `concurrency_limit` 拒绝的后台调用**不**自动补跑；父 agent 决定是否再试 |

- 子运行不碰 `Runtime` busy 锁：父会话在**前台**子运行期间保持 busy；后台 run 不延长 busy（回合
  已结束，用户可以继续发送）。
- 后台 run 的停止入口是任务面板（§19），与父回合停止是两个动作。

### 12.5 后台结果投递

- `task(background=true)` 成功启动 → 工具结果立即 `status=running`（含 run_id / agent / 模型）。
- run 收敛（completed / partial / failed）时：
  1. 写 `subrun` sidecar 与 `subagent_finished` 事件（照常）；
  2. 在允许的时刻（父会话空闲；正忙则排队到回合收尾，见下）把完成通知作为**一条带 `auto_notice`
     标记的 user 角色消息**写进父会话历史（run_id、agent、终态、
     摘要、模型、usage；标记里带 `wake_batch`）。该消息的 `llm_request` 留存就是真源——MUST NOT 另写
     一份独立的完成记录（如原方案的 `task_result` 旁路记录）——同一语义两处真源；
  3. transcript 依据标记渲染为**自动化通知**消息（样式与用户消息区分，文案「后台任务完成」）；
  4. 产 `subagent_notified` 诊断事件（`wake` / `wake_batch` / `chain_index`，见 §13）；
  5. 交唤醒调度（§12.6）决定是否起自动回合。
- **父回合进行中**：通知排队到本回合收尾后再追加，MUST NOT 在本回合中途改写父会话上下文（否则同一
  回合的两次请求前缀不一致）。空闲时的合并窗口见 §12.6。
- **自动唤醒**（Alex 裁决，见 proposal 设计取舍 14）：父会话空闲时起一个父会话回合，合并后的通知就是
  该回合的输入；链式失控由 §12.6 的确定性闸约束。
- 投递只发生一次：进程退出时未收敛的后台 run 不投递（与既有「运行中退出应用」同类边界）。

### 12.6 自动唤醒与链式失控闸

**为什么需要这一节**：自动唤醒把「无人注视时消耗配额」从不可能变成常态。参照系靠「人始终在场」兜底，
本仓没有这个前提，因此闸必须是确定性的、可机器验证的——MUST NOT 依赖模型自己判断「该不该继续」。

#### 12.6.1 触发条件

| 维度 | 规则 |
|---|---|
| 终态 | completed / partial / failed **触发**；aborted **不触发**（面板停止或父回合停止都是用户在场的主动动作，停止后立刻自动起回合与停止动作自相矛盾；会话拆除时没有可唤醒的会话） |
| 前置 | 只对**后台** run 触发；前台 `task` 的结果在本回合内已回填，不产生唤醒 |
| 关闭态 | `[harness.subagents].enabled = false` 时不注册 `task`，也就没有后台 run；运行中途没有实际路径 |
| cron | cron 的运行槽位是 `SessionTarget::Unattended`，走自己的通知链路，**不参与**唤醒与链计数 |

#### 12.6.2 批次与合并（何时起回合）

唤醒调度器挂在父会话上，内存态，三个字段：`pending`（待投递的通知批次）、`running`（自动回合在飞）、
`chain`（连续自动回合数）。规则是一个不变量：**同一时刻至多一个自动回合在飞、至多一个待起批次。**

| 收敛时的父会话状态 | 行为 |
|---|---|
| 空闲 | 通知写进父会话历史并上屏；等**合并窗口**（`AUTO_WAKE_COALESCE_MS = 2000`，从首条通知算起、不因新通知顺延）到期后起一个自动回合，窗口内收敛的其它 run 并入同一批。若 `chain` 已达上限，则不起回合（通知照常上屏、`blocked = "chain_limit"`） |
| 正忙（用户回合 / 自动回合在飞） | 通知进 `pending`；当前回合结束时把 `pending` 合并为**一条**输入并起**一个**回合——多个 run 相继收敛不叠回合 |
| 用户回合开始 | 若 `pending` 非空：先把它作为一条通知消息追加在用户消息之前；若合并窗口内已有通知、自动回合尚未起：取消该次待起唤醒（通知已在历史里）。两种情况都不起自动回合，`chain` 清零、`blocked` 清空 |
| 自动回合在飞时又有通知 | 进 `pending`，等该回合结束再起下一回合（这就是链的一环） |

- **回合输入的形状**：合并后的通知是**一条** user 角色消息（固定前缀：「以下是后台任务的完成通知，
  不是用户发言」+ 每条 run 的 agent / description / 终态 / `stopped_by` / 摘要首行 + 固定收尾「请简要
  说明结果与建议的下一步」）。带 `auto_notice` 标记与 `wake_batch`，恢复后仍可识别。
- **不新增触发源**：自动回合进入交互会话后就是一个普通交互回合（`origin` 仍是用户输入的交互路径），
  唤醒来源由消息标记与 `subagent_notified` 记录表达；`RunSpec` 的三类触发源口径不变。
- 自动回合照常受 `loop_max`（回合内工具往返）、`max_subruns_per_turn`（回合内委派段数）、
  `max_concurrent`（并发）约束——它没有任何豁免。

#### 12.6.3 链式失控闸

```
AUTO_WAKE_CHAIN_MAX = 3      // 连续自动回合上限（代码常量，不是配置键）
AUTO_WAKE_COALESCE_MS = 2000 // 空闲时的合并窗口
```

- **计数**：每个父会话一个内存计数器 `chain`。自动回合**开始时** `chain += 1`；任何用户回合开始、
  面板「继续」、会话重置 / 恢复 / 切 vault 时清零。计数器不持久化（恢复已中止后台 run，链无续接
  意义）。
- **触顶判定**：起自动回合前检查 `chain >= AUTO_WAKE_CHAIN_MAX`。计数一旦达到上限，快照即置
  `auto_wake.blocked = "chain_limit"`（面板提示行在触顶时就出现，不等下一次通知被拒才提示）；此时
  再来通知**不起回合**，但照常落库上屏、`pending` 保留。
- **用户停止自动回合**：视同触顶（`blocked = "stopped"`），后续通知不再唤醒——否则「停止」会被下一个
  完成通知立刻推翻。
- **「继续」入口**：面板提示行的「继续」按钮等价一次用户发言：`chain = 0`、`blocked = null`，并按
  当前 `pending` 起一个回合（无 `pending` 时只恢复监听）。
- **与 `loop_max` 的关系**：正交。`loop_max` 管**一个回合内**的工具往返数（触顶该回合按既有提示结束）；
  链上限管**无用户发言的回合数**（触顶停摆等人）。两者各自停摆、互不替代：一个回合内跑满 50 轮工具
  不会推进链计数，链触顶也不会让当前回合提前结束。
- **最坏消耗的有界性**：无人注视下的上界 = `AUTO_WAKE_CHAIN_MAX × max_subruns_per_turn × max_tokens`
  + 自动回合自身往返；`max_concurrent` 只压同时性，不改总量上界。这个量级写进
  `docs/specs/config-reference.md`（tasks §6.3），让用户知道最坏花多少。
- **为什么是常量而不是配置键**：它是安全绳不是策略旋钮。可调大会直接抬高「不在场烧配额」的上界；
  需要继续时用户发言（或点「继续」）即清零，不需要改配置。作为配置键还会引入「调大它」的错误用法，
  恰是这条闸要防的。
- **可观测**：`subagent_notified.wake ∈ {auto_turn, user_turn, blocked_chain, blocked_stopped,
  none_aborted}`——事件在通知**最终处理时**产出一次（被排队 / 合并的 run 用同一 `wake_batch` 与同一
  最终 `wake` 值，不重复产出 `queued` 事件），`wake_batch` 标识同一批，`chain_index` 是本次自动回合
  在链中的序号（1 起；非自动回合为 0）。父会话快照带 `auto_wake: {chain, max, blocked}`，面板据此
  渲染提示行。

## 13. 诊断事件

| 事件 | 字段 |
|---|---|
| `subagent_started` | `run_id`, `segment`, `parent_session`, `agent`, `description`, `model`, `tools[]`, `max_turns`, `max_tokens`, `timeout_secs`, `background` |
| `subagent_progress` | `run_id`, `segment`, `rounds`, `tool_calls`, `last_tool`, `elapsed_ms`（节流：每轮最多一条，只给面板读数，不是逐 token 流） |
| `subagent_step` | `run_id`, `segment`, `tool`, `summary`（面板详情用的步骤行；参数摘要已人话化，不含文件内容） |
| `subagent_finished` | `run_id`, `segment`, `agent`, `status`, `stopped_by`, `rounds`, `model`, `input_tokens`, `cached_tokens`, `output_tokens`, `denied_calls`, `duration_ms`, `summary_chars`, `audit`（写失败时另带 `audit_error`） |
| `subagent_notified` | `run_id`, `agent`, `status`, `wake`（`auto_turn` / `user_turn` / `blocked_chain` / `blocked_stopped` / `none_aborted`）, `wake_batch`, `chain_index`（自动回合在链中的序号，1 起；非自动回合为 0） |
| `subagent_rejected` | `reason`（含 `concurrency_limit` / `run_busy`）, `agent`, `description` |
| `subagent_catalog_large` | `estimated_tokens`, `definition_count` |

- 七事件进 `logging.rs` 白名单，字段逐个校验；`status` / `stopped_by` / `reason` 为闭集合。
- 事件在段收尾处产出一次，失败路径也产；`subagent_progress` / `subagent_step` 是**可见面事件**，
  MUST NOT 含任务 prompt 内容、文件内容与 vault 绝对路径。

## 14. 配置面

`[harness.subagents]`（装载时读一次，改配置需重启；定义文件与此不同，按回合扫描）：

| 键 | 缺省 | 合法域 | 语义 | 消费者 |
|---|---|---|---|---|
| `enabled` | `true` | bool | kill switch：关闭后 `task` 不注册、面板任务区不出现，定义与内建 `explore` 保留 | `task` 是否注册 / 面板是否显示任务区 |
| `max_turns` | `20` | 1–64 | 定义未写时的轮次预算，同时是定义值的上限 | 预算构造 |
| `max_tokens` | `200000` | 1–10000000 | 同上（token 闸） | 预算构造 |
| `timeout_secs` | `300` | 1–3600 | 同上（时间闸） | 预算构造 |
| `max_subruns_per_turn` | `8` | 1–64 | 父回合委派段数上限（前台 + 后台） | 次数闸 |
| `max_concurrent` | `4` | 1–16 | 会话级同时运行的子运行数上限；也是请求闸许可数（+1 给父往返） | 并发许可 / 请求闸 |

- 校验沿用既有模板：类型不符整节回落 + warning；数值越界夹取 + warning；应用不因配置错误启动失败
  （ADR 0002 第 5 条）。
- 定义字段是「用户意图」，配置是「用户设定的上限」；二者冲突时取小（定义值夹取）。
- **不新增配置键的两项**：自动唤醒的合并窗口 `AUTO_WAKE_COALESCE_MS = 2000` 与链上限
  `AUTO_WAKE_CHAIN_MAX = 3` 是代码常量（理由见 §12.6.3：安全绳不是策略旋钮）。它们不读
  `config.json`，也不出现在 `SubagentsConfig` 里。
- ts-rs 导出 `SubagentsConfig`；任务面板（§19）消费 `enabled` 与读数，配置本身仍无设置界面
  （改配置文件 + 重启生效，与其余 `[harness]` 键同口径）。

## 15. 失败模式与边界

- **定义被丢弃**：调用该名字 ⇒ `agent_not_found`，消息列出当前可用名字。
- **空目录 / 全自定义定义非法**：清单只剩内建 `explore`，`task` 照常注册（模型仍可委派只读探索）；
  `enabled=false` 是唯一的不注册路径。
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
- **并发已满**：后台启动 ⇒ `concurrency_limit`，不排队、不自动补跑；前台调用阻塞等许可（父回合本来
  就在等它）。
- **resume 一条仍在跑的 run**：`run_busy`，不并发写同一子会话。
- **审批等待期间用户离开**：run 挂起在批准卡上，时间闸不计等待；用户回来批准即继续，不因离开被判
  触顶。
- **父回合已收尾、后台 run 仍在跑**：busy 锁已释放，用户可继续发消息；面板常驻该行。run 收敛时按
  §12.5 投递通知，并按 §12.6 决定是否起自动回合。
- **后台 run 遇上会话重置**：中止并记 `aborted`，不投递结果（保留表已清空）。
- **链上限触顶**：通知照常落库上屏，但不起自动回合；面板出现提示行（`blocked = "chain_limit"`），
  用户发言或点「继续」后恢复。
- **用户停止自动回合**：该回合结束，`blocked = "stopped"`；后续后台结果不再唤醒，避免「停止」被下一个
  通知立刻推翻。
- **自动回合内部触顶 `loop_max`**：该回合按既有「达到循环上限」提示结束，链计数不受影响（链数的是
  回合数，不是工具往返数）。
- **自动回合的委派被 `concurrency_limit` / `subrun_limit` 拒绝**：照常回工具结果，模型在回合内处理；
  不额外重试、不特别唤醒。
- **通知落库后应用退出**：通知与 `auto_notice` 标记随 `llm_request` 留存，恢复后照常显示；已中止的
  后台 run 不补投递、不补唤醒。

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
4. **批准透传**：定义 `tools: [vault_delete]` + 默认档；子运行调用 ⇒ 父会话出现批准卡且带
   `source.agent` / `source.run_id`；批准 ⇒ 文件按既有语义删除；拒绝 ⇒ 回送 `approval_denied`、
   `denied_calls=1`、文件未删、子运行继续跑完并在结果里说明被拒。
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
16. **同回合并行**：一条助手消息含 2 个 `task`；断言两个 run 的 `subagent_started` 时间区间重叠、
    工具结果按调用顺序回填、transcript 两行按调用序排列（不因完成顺序换位）。
17. **后台运行与通知**：`task(background=true)`；断言工具结果立即 `status=running`、父回合正常
    `done`、run 收敛后父会话出现带 `auto_notice` 标记的通知消息（transcript 按自动化通知样式渲染）、
    `subagent_notified` 落盘、回合结束后可立即发送新消息（busy 已释放）。
18. **并发上限**：`max_concurrent=1`；第二个**后台**调用 ⇒ `concurrency_limit`；两个**前台**调用
    则依次取许可、都完成（不拒绝）。
19. **内建 explore 与覆盖**：无自定义定义时清单含 `explore` 且其工具恰为只读三件；放一个同名自定义
    定义 ⇒ 覆盖 warning、清单只一条、生效的是自定义定义。
20. **按模型分桶**：两个 run 用不同模型（mock 编排）；断言父会话 `ctx%` / cache% 只反映父自己的往返、
    分桶表出现两个模型桶、恢复后分桶表与 live 逐字段相等。
21. **任务面板可见**：子运行期间面板出现该 run 行（agent + description + 状态 + 读数）；批准卡点名
    agent；主 transcript 的 AX 树里不出现子运行的逐条工具行（可见面在详情视图，不在主对话）。
22. **后台完成自动唤醒**：父会话空闲时后台 run 收敛 ⇒ 合并窗口（2 秒）到期后自动起一个父会话回合，
    请求里含一条带 `auto_notice` 标记的 user 消息（内容是完成通知）；断言 `subagent_notified.wake =
    auto_turn`、`chain_index = 1`、回合结束后父会话有该回合的助手回复；断言没有用户发言。
23. **忙时合并为一个回合**：一个用户回合进行中两个后台 run 相继收敛 ⇒ 当前回合结束后只起**一个**
    自动回合，输入里含两条通知（`wake_batch` 相同）；断言自动回合数 = 1（不是 2）。
24. **链上限与恢复**：驱动三个连续自动回合后第 4 条后台结果收敛 ⇒ 不起回合、通知照常上屏、
    `subagent_notified.wake = blocked_chain`、面板出现触顶提示行（AX 断言）且「继续」可点；用户发言
    后链清零，下一条后台结果恢复自动唤醒。另断言一个自动回合内模型反复调工具触顶 `loop_max` 时，
    该回合按既有提示结束而链计数不变（两者正交）。

备注（写进场景注释）：主 transcript 不上屏子运行过程，判据一律取 JSONL / 事件 / 快照 / WKWebView 的
AX 断言，不取截图（手感与观感不下沉）；面板截图只作证据。mock 按 §18 的父子游标约定编排，并行场景
按 run 分配连续条目（§18 末段）。

## 18. mock 与父子游标

mock provider 的脚本是单条线性序列（`MockClient`），父子客户端各自持有游标：

- 子运行的 mock 起点 = 父会话游标 + 父客户端本轮已消费条数（绝对位置）；脚本按「父第 1 条 = task
  调用 → 子运行 N 条 → 父续写」顺序编排；
- 子运行结束后父客户端前移子运行消费的条数（`LlmClient` 增 `external_consumed()` / `skip(n)`，
  真 provider 恒 0 / no-op）；父回合结束按既有规则回写会话游标；
- resume 段沿用保留 run 的 mock 游标（子会话元数据里带 `mock_cursor`），继续往下弹；
- **并行时按 run 预分配区段**：线性脚本不够用（多个 run 交错消费同一游标会互相吃掉条目）。父回合在
  启动 `task` 调用时按调用顺序给每个 run 分配一段连续区间（区间长度由 fixture 声明），各 run 只在自己
  区间内弹；越界即 `fixture_exhausted`（比静默错位好）。父续写条目放在所有子区间之后。
- **后台 run 的区间同样预分配**，且父回合收尾条目必须落在后台区间之外——后台 run 可能在父回合结束后
  才继续弹，脚本顺序不能假设「父说完 → 子接着弹」。
- 验收场景按此顺序写 fixture，断言「父续写的响应紧跟子运行条目」，不依赖时间；同时断言两个并行 run
  各自拿到了自己的区间（`subagent_started` 的 mock 起点互不相同）。

## 19. UX：任务面板、批准卡透传、子代理清单

原型：[`design/prototypes/subagents-tasks.html`](../../../design/prototypes/subagents-tasks.html)
（Alex 看的裁决稿；页面内置控制面板可切场景 / 主题 / 面板状态，query 参数只作深链，`?panel=0`
关面板供截图）。全部 fixture 合成，无真实 vault 内容。

### 19.1 任务面板（agent 面板内、composer 上方）

```
│ 任务 · 2 个运行中 · 1 个等待批准        ▾
│  ● research   梳理这周的规范变更       5 轮 · 82k
│  ● reviewer   交叉复核三处结论         3 轮 · 41k
│  ◐ explore    按路径枚举变更文件       等待批准
├──────────────────────────────────────────
│ composer
```

- 常驻一行标题（有运行中 / 等待批准的 run 时）；面板**只列运行中 / 等待批准的 run**——历史任务不逐行
  留在面板，它们的详情从 transcript 的 `task` 工具行点开（点击就地展开）。
- 全部任务收敛后，任务区收敛为**一行摘要**（「任务 · 本次会话 2 个已完成 · 1 个部分结果」）+ 按模型
  用量块；没有子运行任务时整块不出现。
- **自动回合触顶提示行**：`auto_wake.blocked` 非空时，任务区顶部出现一行提示（「自动回合已达上限
  （3），后台结果等你发言后处理」+「继续」按钮）；`blocked = "stopped"` 时文案改为「你停止了自动
  回合」。提示行与任务行视觉区分（不冒充 run 行），点击「继续」等价一次用户发言（§12.6.3）。
- 行 = agent 名（mono）+ description（省略号截断，**唯一可截断的字段**）+ 状态图标 + 一个读数
  （轮次 · tokens）。状态词永不截断（同 M401 的「保住终态词」纪律）。
- 状态：运行中（脉冲点）/ 等待批准（暂停图标 + accent）/ 后台（`background` 标记）/ 完成 / 触顶
  （partial）/ 失败 / 已停止。
- 展开行（点击）：模型、工具步数、最近一步（工具名 + 参数摘要，人话化）、用时；完成后显示摘要
  （可折叠）、该 run 的用量与来源标记。运行中的行有「停止」动作。
- 面板行只消费 `subagent_progress` / `subagent_step` / `subagent_finished`；过程 MUST NOT 写进
  transcript（可见面 ≠ 进上下文）。

### 19.2 批准卡透传的呈现

- 父会话自己的批准卡：位置与形态不变（transcript 工具行下，M401 已定稿）。
- 子运行的批准卡：渲染在**任务面板该 run 的展开区**里（卡片跟着发起者走），卡片头部多一行
  「来自 research：梳理这周的规范变更」；待批时该行自动展开，面板标题显示「N 个等待批准」——避免
  把阻塞决策藏在折叠区里。
- 卡体与父会话同款：diff / argv 预览、判定依据行、原因输入、批准 / 拒绝、「本会话不再问」。
- 拒绝后卡片收敛为终态记录（未执行 + 原因），子运行继续；面板行状态从「等待批准」回到「运行中」。
- 多个 run 同时待批 ⇒ 多行各自展开，按 ask 时间排序；面板内纵向滚动，不叠成模态。

### 19.3 后台任务、完成通知与自动回合

- 后台行在回合结束后常驻面板（带「后台」标记）；父回合结束时面板不自动收起。
- 完成 ⇒ 行状态变完成 / 触顶 / 失败；transcript 出现一条自动化通知（左侧色条 + 「后台任务完成」
  标签，与用户消息视觉区分），带 agent、description、摘要首行与「详情见任务面板」。多条通知在同一
  合并窗口 / 同一排队批次里收敛时合并成**一条**通知（逐 run 列一行）。
- 通知就是一条会话消息（带 `auto_notice` 标记的 user 消息），也是自动回合的输入；父会话空闲时随之
  自动起一个回合，模型在回合里汇报结果（§12.5 / §12.6）。正忙时通知排队，回合结束后合并为一个回合。
- 自动回合的助手回复与普通回合形态一致（不额外加标记）；用户随时可发言打断流程，链计数清零。
- 链触顶或用户停止自动回合后，后续通知只上屏、不再唤醒，任务区顶部出现提示行（§19.1）。

### 19.4 子代理清单

- 面板内一个只读折叠列表：名字、一行 description、工具数、模型、来源标记（内建 / vault / 用户）。
- 目的：让「有哪些子代理、各自能做什么」可发现，不必去翻 `.lumir/agents/`。不含编辑动作（v1 定义
  仍是文本文件）。
- 同名覆盖时只显示生效的一份，行内注明「覆盖了内建 / 用户级定义」。

### 19.5 关停与空态

- `enabled = false` ⇒ `task` 不注册、任务区不出现；没有运行中 / 等待批准的任务时标题行也不出现。
- 历史任务不留在面板：它们已经在 transcript 的 `task` 工具行里（两处各留一份等于双读数，见
  REVIEW.md「同一语义两处真源」条）。

### 19.6 原型覆盖范围与不覆盖

覆盖：并行运行中、等待批准（多个待批）、后台完成通知、自动唤醒回合、链上限触顶提示行 + 「继续」、
完成详情 + 按模型用量、子代理清单、关停空态、三主题。不覆盖：真实 token 计量动画、合并窗口的真实
计时、长列表滚动性能、真机 AX 读屏顺序（由验收场景 21 / 24 兜底）。
