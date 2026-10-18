# Tasks: add-harness-subagents

> **实现范围（预估）**：`src-tauri/src/harness/{agents,run,subagents,scheduler,turn,tools,session,jsonl,llm,approval,context}.rs`、
> `src-tauri/src/{config,logging}.rs`、`src-tauri/Cargo.toml`、`src/harness-panel.ts`、`src/bindings/**`、
> `docs/specs/{config-reference,subagent-definitions}.md`、`scripts/acceptance/scenarios/**`、
> `openspec/changes/add-harness-subagents/**`、`docs/adr/0007-*.md`。
>
> **前置**：节点 1（提案评审）已于 2026-10-18 终审通过（Alex 原话「5 个回合。subagents 的提案其他
> 部分我没有异议，通过。」，见 proposal「裁决留痕」）；ADR 0007 修订（§0.1）仍须 Alex 过目。节点 1
> 通过后本 change 进入实现，实现范围以本文件各节 tasks 为准。
>
> **裁决口径**：形态照 Claude Code subagents 参照系（定义即 Markdown + frontmatter、按名字委派、按
> description 自动委派、partial 可 resume）；真源已裁决的两条不松动——工具缺省只读三件、三重闸全在。
> 第二轮按 Alex 节点 1 阅读中的裁决改写：**并行 + 后台运行、批准卡透传、内建 `explore`、用量按模型
> 分桶、用户可见面**（逐条原话见 proposal「裁决留痕」）。第三轮按节点 1 终审前的裁决改写：**后台完成
> 自动唤醒父会话**（推翻取舍 14）+ **链式失控闸**（`AUTO_WAKE_CHAIN_MAX = 5`，取舍 19）、降级检查改由
> cron 承载。深度 1 层用「不授予 `task` 工具」表达；逐条取舍见 proposal 末尾 19 条设计取舍（第 7、13 条
> 与 15–18 条已采纳；第 14 条先采纳后推翻；第 19 条已裁决，节点 1 终审把链上限定为 5）。节点 1 已
> 通过；实现期发现意图需变更时，把替代方案写清后停下重走节点 1。

## 0. 前置（ADR 与跨 change 对齐）

- [x] 0.1 修订 ADR 0007（Revisit 条件命中：subagent 从架构约束转为实际需求）：工具集边界原则拆为
  「vault 操作工具」与「编排工具」两类，清单记为 8 + 1；写清 `task` 不操作 vault、不参与「写且需
  防护」判据；**须 Alex 过目**（ADR 修订是人肉裁决点）。
  （已落 `docs/adr/0007-ai-positioning-probe.md`：Decision 7 拆两类 + Revisit 第三分支留痕；
  文件 diff 随 M586 提交，供 Alex 过目。）
- [x] 0.2 与评审中的 change `add-cron-runtime-daemon` 对齐：确认其运行槽位与 `cron:run` 交接载荷在
  实现期按 `RunSpec` 形状落地；若两 change 实现顺序对调，在 cron 的 tasks 里补一条「接入 RunSpec」，
  本 change 的公共层任务不删；确认 cron 运行与子运行共用同一个 provider 请求闸（design §12.3）。
  **核对结论（M586，2026-10-18；M583/M584 已合入 master，实现顺序已对调）**：
  - 交接载荷**未**按 `RunSpec` 形状落地：`cron:run` 是字段自列的 `CronRunPayload`
    （`src-tauri/src/lib.rs:889`：`run_id` / `task` / `vault` / `prompt` / `session` /
    `session_id` / `model` / `origin`），前端 `handleCronRun` 逐字段转给
    `harness_cron_run`（`src/main.ts:2549`），后端复用 acquire + turn 路径。
  - 运行槽位已具备 `SessionTarget::Unattended` 的**语义**（`Runtime::isolated()`：事件不发面板、
    会话与交互槽位物理分离），但类型面仍是 `Runtime` 构造参数，不是 `SessionTarget` 值。
  - 批准语义已是 `ApprovalPolicy::RejectUnavailable` 的**行为**（`gated_execute` 遇
    `runtime.is_isolated()` 即 `stop_with("approval_required")`），待回抽后改由策略值表达。
  - provider 请求闸**尚未存在**（cron 侧只有「同一任务至多一个在途」；不同任务可同时跑多轮，
    当前没有 `max_concurrent + 1` 的计数信号量）。该闸随本 change §4.9 落地，cron 届时必须接入
    同一个闸（design §12.3）。
  - 因此按本条的条件分支：cron 侧需要一条「接入 `RunSpec` + 接入 provider 请求闸」的后续任务
    （属 change `add-cron-runtime-daemon` 的 tasks，不在 M586 的 scope 内，已上报 tower 路由）；
    本 change 的公共层任务不删。
- [x] 0.3 记录公共层的去留口径：公共层按实际消费者决定去留（cron / 委托），不因单一原语的变化删改；
  写进代码注释就地说明「无兼容层、按消费者定去留」。
  （已落 `src-tauri/src/harness/run.rs` 模块头「去留口径」段。）

## 1. 运行公共层回抽（`harness/run.rs` 新建 + `harness/turn.rs` 参数化）

- [x] 1.1 新建 `run.rs`：`RunOrigin` / `SessionTarget` / `ToolPolicy` / `RunBudget` / `ApprovalPolicy`
  （三值：Interactive / PassthroughFrom / RejectUnavailable）/ `RunOutcome` / `RunReport` / `RunSpec`
  （含 `background`）；纯 Rust、无 tauri 依赖（ADR 0002 §7）。
  （实现口径：`ToolPolicy::allow` 用 `Vec<String>`——`RunSpec` 是 cron 交接载荷的形状，需可反序列化；
  `RunBudget::deadline` 带 `serde(skip)`，跨进程恒 `None`。）
- [x] 1.2 定义 `RunContext` trait（会话、事件接收端、工具定义、权限判定、批准、预算、留存），实现
  `SessionContext`：`turn.rs` 的 `with_session` 调用点（25 处）与 `sink.emit`（16 处）改经 `ctx`，
  语义逐字节不变。
  （实现口径：会话以 `with_session` 闭包暴露而非 `&mut Session`——会话由 `Runtime` 的锁托管，
  直接交出可变引用会破坏「只在读写会话那一刻持锁」；压缩的会话轮换经
  `begin_compacted_session` 留在上下文实现里。）
- [ ] 1.3 `build_request` 的工具定义改由 `ctx.tool_definitions()` 提供；交互上下文按当前定义快照
  生成 `task` 描述（含清单）；`enabled=false` 时输出与既有 8 件清单深度相等（单测钉死）。
  **部分完成（M586）**：`build_request` 已走 `ctx.tool_definitions()`；`enabled` 的 kill switch
  已落（`run.rs` 的 `gate_tool_definitions` + 合成 `task` 定义的单测）。**M587 已补**：定义快照
  接进 `SessionContext::tool_definitions()`，`tools::task_definition` 生成描述与清单，
  `enabled=false` 的 8 件基线断言保持绿。**执行入口仍归 §3（M588）**——本棒只注册定义（tower
  scope 裁决：tools.rs 只有描述与注册条件，执行严格留 M588），因此「第 9 件可执行」这条要等
  M588 合入后才真正闭环。
- [x] 1.4 `llm::client_at` 增加模型覆盖参数；`LlmClient` 增加 `external_consumed()` / `skip(n)`
  （真 provider 恒 0 / no-op），供 mock 父子游标编排（design §18）。
  （另加 `LlmClient::model()`：发送点 `llm_request.model` 取覆盖后的实际值，避免「覆盖参数与
  留存值两处各说各的」。）
- [x] 1.5 交互路径回归：既有 `cargo test` 零改写通过（含恢复充分性、事件形状、批准闸、循环上限）；
  `sessions/` JSONL 形状不变；`rg -n "fn run_turn_for" src-tauri/src` 仍只有一处循环实现。
- [ ] 1.6 真机跑一轮既有交互对话（mock 与真 provider 各一次），确认发送、工具调用、批准卡、停止、
  压缩与读数均无变化；证据路径写进完成报告。
  （归 M590 验收批执行；本棒用既有 `cargo test` 全绿兜底。）
- [x] 1.7 工具循环的并行编排：同一条助手消息里的多个 `task` 调用并行启动、非 `task` 调用维持逐个
  执行；结果收进 `BTreeMap<call_index, ToolResult>`，全部收敛后按调用顺序回填；单测断言「完成顺序
  与回填顺序无关」（让第二个调用先完成，断言结果仍是 0,1）。
  （实现口径：`RunContext::orchestrate` 是 `task` 的启动口（交互上下文缺省恒 `None`，§3 接）；
  `execute_calls` 先启动全部编排调用、再按调用序 join；单测 `parallel_orchestration_backfills_in_call_order`
  用两个线程句柄钉住「完成顺序 [1,0] ⇒ 回填 [0,1]」。）

## 2. 子代理定义文件（`harness/agents.rs` 新建）

- [x] 2.1 YAML 依赖选型并落地：`serde_yaml` 已 deprecated，候选 `yaml-rust2` / `saphyr`；只解析
  标量 + 字符串列表子集，产出窄结构体；选型理由写进 Cargo.toml 注释与完成报告。
  （实现口径：选 **saphyr 0.2**——yaml-rust2 的 README 自述「只做基础维护、保留稳定 API」，
  新特性归同谱系的继任者 saphyr；本仓只在定义文件一处消费 YAML，维护方向优先于 API 冻结。
  `default-features = false` 关掉 encoding 档（定义文件恒 UTF-8）。理由全文见 `Cargo.toml`
  的 saphyr 依赖注释。）
- [x] 2.2 扫描：`<vault>/.lumir/agents/**/*.md` 与 `<config_dir>/agents/**/*.md` 递归发现；目录
  不存在视为空；每回合开头扫描一次并快照（不做 watcher）。
  （实现口径：`AgentCatalog::load` 在 `SessionContext::new` 调用一次，同一回合的所有请求共用
  该快照；不跟随符号链接；用户级目录取既有 `config::config_dir()`。）
- [x] 2.3 frontmatter 解析与字段校验：`name` / `description` 必填；`tools` / `model` / `max_turns` /
  `max_tokens` / `timeout_secs` / `background` 可选；非法定义逐条丢弃 + 点名 warning；未知字段
  warning 并忽略；`tools: []` 合法；`tools` 含 `task` 或未知工具 ⇒ 丢定义。
  （实现口径：「丢弃」= 机制看不懂定义：frontmatter 缺失 / 未闭合 / 解析失败 / 多文档、name 或
  description 缺失或非法、tools 不是字符串列表或含未知工具 / `task`。「保留 + 回落」= 看懂了但
  值不可用：model 非法回落 inherit、max_* 类型非法取配置值、max_* 越界夹取、background 类型错取
  false。warning 走 `config_warning(source="subagents")`，进程内按消息去重。）
- [x] 2.4 优先级：vault 覆盖用户级；同层同名取字典序第一个 + warning（确定性规则，不依赖文件系统
  读序）。
  （实现口径：先按路径字典序收集文件再解析；同层同名在层内去重后才合并，跨层覆盖产点名两处来源
  的 warning；内建 `explore` 参与同一套覆盖规则。）
- [x] 2.5 正文与身份段：定义正文按需读取（只在委派时装配），不进主会话上下文、不进清单。
  （实现口径：`AgentDefinition` 只存元数据；`body()` 在委派装配时重新读文件并剥离 frontmatter。
  内建定义的正文随定义文本内联，磁盘定义正文不缓存。）
- [x] 2.6 清单注入与容量告警：`name` + `description` 注入 `task` 描述；估算 token（`ceil(字符数 ÷ 4)`）
  超 15,000 时一条 warning + `subagent_catalog_large` 事件；MUST NOT 截断清单。
  （实现口径：`tools::task_definition(catalog)` 渲染描述，`definitions_with_subagents` 在快照
  非空时注册第 9 件；估算按所有生效定义**描述字符数合计**；事件白名单已加
  `subagent_catalog_large`（`estimated_tokens` / `definition_count`）。执行入口归 §3（M588）。）
- [x] 2.7 单测：每个校验分支（缺必填 / 未知工具 / `task` / 空 tools / 未知字段 / 非法 model /
  越界数值 / 同名 / YAML 坏格式 / `background` 类型错）各一条；扫描对坏文件不整体失败。
  （实现口径：单测在 `agents.rs` 的 `#[cfg(test)] mod tests`，另在 `run.rs` 钉「enabled=true
  时第 9 件注册且描述含清单」；所有用例用临时目录 + `load_from_roots`，不读真实
  `~/.config/lumir`。）
- [x] 2.8 内建 `explore`：代码内置定义（只读三件、`inherit`、三闸取配置），与磁盘定义同一条装载 /
  校验 / 清单路径；同名自定义覆盖内建 + 覆盖 warning + 清单只一条（单测：无定义时有 explore、
  有同名定义时生效的是自定义）。
  （实现口径：内建定义的 frontmatter 是一段常量文本，喂给与磁盘文件同一个 `parse_definition`；
  来源标记 `builtin`；不落盘。）
- [x] 2.9 `background` 字段：`true` 时调用参数无法降为前台；类型错 ⇒ 定义保留、取 `false` + warning
  （单测）。
  （实现口径：`AgentDefinition::effective_background(call)` = 定义值 OR 调用值；调用侧解析
  `background` 参数归 §3（M588），本棒钉住「不能降级」的纯函数语义。）

## 3. `task` 工具（`harness/tools.rs`）

- [x] 3.1 新增第 9 件工具 `task` 的定义（design §5.1 的 schema，含 `background`）与执行入口；文件头
  「恰好 8 个」改为「8 件 vault 操作工具 + 1 件编排工具」，指向 ADR 0007 修订。
  （实现口径：定义在 `tools::task_definition`；执行入口是 `subagents::start_task`，由
  `SessionContext::orchestrate` 接线。`task` 不走 `handle_call` 的权限管线——它是编排工具、
  不操作 vault；工具行由 `turn::execute_calls` 按调用序发 started / `finish_call` 发 done。）
- [x] 3.2 工具注册条件：`enabled=false` 时不注册；对该工具的调用回送 `disabled`（单测）。
  （注册关闭点仍是 `run::gate_tool_definitions` 一处；调用侧短路在 `start_task_inner`。
  单测 `disabled_subagents_reject_the_call`。）
- [x] 3.3 参数校验：`agent` 命中清单、`prompt` 非空、`resume` 合法、`background` 布尔；失败码闭集合
  （`agent_not_found` / `run_not_resumable` / `run_busy` / `agent_mismatch` / `subrun_limit` /
  `concurrency_limit` / `model_not_configured` / `empty_prompt`）。
  （另有两个**参数形状**错误沿用统一信封的 `tool_args_invalid`：`background` 非布尔、参数不是
  合法 JSON——闭集合是「子代理语义拒绝码」，形状错误仍走既有工具参数错误族。单测
  `task_argument_validation_uses_the_closed_error_set`。）
- [x] 3.4 结果信封与摘要截断：completed / partial / running / 失败四态、`run_id` / `resumable` /
  `model` / `segment`、8,000 字符上限 + 头尾保留 + `truncated`、`tool_calls` 计数；单测覆盖空摘要与
  超长摘要。
  （截断函数 `tools::truncate_task_summary`；信封在 `subagents::report_envelope`。段号
  `segment` 在诊断事件与审计里，信封按 design §5.2 的形状不重复带 segment。单测
  `long_summary_is_truncated_with_a_marker` / `tools::tests::task_summary_truncation_keeps_head_and_tail`。）
- [x] 3.5 后台启动路径：拿不到并发许可 ⇒ `concurrency_limit`；拿到即返回 `status=running` 并把句柄
  交调度器（单测：启动后父回合不等它、句柄可见）。
  （单测 `background_start_returns_running_without_waiting` / `background_concurrency_limit_is_reported`。）

## 4. 子运行引擎与调度（`harness/subagents.rs`、`harness/scheduler.rs` 新建）

- [x] 4.1 `ChildContext`：本地 `Session::new`（不插入 `Runtime.sessions`，不碰父 busy 锁）、
  `ChildSink`（过程事件转面板事件 + 只计 tool_calls）、`permission()` 复用 `permissions::decide`、
  `approval()` 走透传通道、每 run 一线程。
  （`harness/subagents.rs`；每 run 线程名 `lumir-subagent-<run_id>`。`ChildSink` 吞掉 text /
  reasoning / usage / done / error 等会污染父会话的事件，只转 `subagent_step` / `subagent_progress`
  与审批卡。）
- [x] 4.2 上下文装配：`assemble_system` 增加「定义正文替换身份段 + 委托约束段」变体；AGENTS 三层与
  Skill 索引照常；输入为空历史 + 一条 user 消息；不注入编辑器上下文（单测断言 system 与 messages）。
  （`context::assemble_system_for_subagent`；单测 `subagent_system_and_messages_are_isolated`。）
- [x] 4.3 三重闸 + 配额：预算来自定义（夹取配置上限）；检查点（往返前、工具调用前、往返后 token
  复查）；时间闸按运行时长累计、审批等待顺延；provider 配额 / 限流 ⇒ `stopped_by=quota` 且不重试
  （单测覆盖四闸 + 停止 + 审批等待不计时）。
  （往返后复查在 `turn::run_turn_core_with_mode`；**工具调用前**检查点在
  `turn::execute_calls` 的逐调用循环里（只对 tokens / time 生效，交互 loop_max 语义不变）。
  单测 `three_budgets_stop_with_the_right_reason` / `time_budget_is_checked_before_each_tool_call`
  / `approval_wait_does_not_count_against_the_time_budget` / `api_error_and_quota_semantics`。）
- [x] 4.4 错误语义：API 错误但有文本 ⇒ partial + `stopped_by=error`；无文本 ⇒ failed；不自动重试
  （单测）。
  （单测同上；quota 无产出时按 failed 收口。）
- [x] 4.5 收尾幂等：`catch_unwind` 后显式执行收尾（按模型记账、写 sidecar、事件、flush），任何终态
  只收尾一次；审计写失败不阻断（`audit_error`）。
  （`SegmentReport` + `ChildContext::finish` 的 `finished` 标志；单测 `finish_is_idempotent`。
  审计目录不可用时 `audit_error` 进 `subagent_finished`，运行照常。）
- [x] 4.6 resume：内存保留（`MAX_RETAINED_RUNS = 4`，LRU、运行中不淘汰）、agent 一致性校验、模型
  解析序、新段预算、审计同文件追加 `run_segment`、运行中 run 回 `run_busy`；父会话重置 / 恢复 / 关
  vault 清空保留并中止后台 run（单测覆盖淘汰、重启等价、定义不匹配、运行中续跑被拒）。
  （保留表挂在 `Session` 的 `SubagentHub` 上，`Session::Drop → hub.shutdown()` 清空并广播中止。
  单测 `resume_continues_the_same_subrun` / `resume_busy_and_eviction_boundaries`。）
- [x] 4.7 上下文溢出与压缩边界：沿用压缩重试一次；压缩只压内存态输入、不轮转审计文件、落 `compact`
  sidecar；压缩 usage 计入段预算但不进任何模型桶（单测）。
  （`ChildContext::begin_compacted_session` 只替换内存 input、审计同文件追加 `compact`；单测
  `context_overflow_compacts_and_retries_once`。）
- [x] 4.8 次数闸：`max_subruns_per_turn` 按父回合计数（前台 + 后台）、只计实际执行的段；超出回
  `subrun_limit`；被拒调用不占额度（单测）。
  （`SubagentHub.turn_segments` 在用户回合 / 自动回合开始时复位；单测
  `subrun_limit_counts_only_executed_segments`。）
- [x] 4.9 并发调度器（`scheduler.rs`）：会话级计数信号量 `max_concurrent`（前台阻塞取、后台非阻塞
  取）+ 每 provider 请求闸（`max_concurrent + 1`，父请求优先、子请求 FIFO）；cron 运行共用该闸。
  单测：并行 N 个 run 时在飞请求数不超上限；父往返不被子 run 饿死。
  （`scheduler::{ConcurrencyGate, ProviderGate}`；provider 闸按 provider 进程内单例，交互与
  无人值守槽位都经同一个 `RunContext::request_permit` 取，cron 无需另接。单测
  `provider_gate_prioritises_parent_requests`。）
- [x] 4.10 事件交错：`task` 工具行按调用顺序创建 / 就地更新；工具结果按调用序回填；过程事件带
  `run_id` + `segment` 且同 run 有序；审计按 run 隔离（单测：交错完成顺序不改变 transcript 行序与
  结果序）。
  （`turn::execute_calls` 先全部启动、按调用序收敛；`finish_call` 是普通工具与 `task` 共用的唯一
  收尾点。M586 的 `parallel_orchestration_backfills_in_call_order` 继续覆盖回填顺序。）
- [x] 4.11 后台生命周期：跨回合运行不改 busy；父回合停止广播中止；单个 run 可从面板停止；会话重置 /
  恢复 / 切 vault / 退出中止并记 `aborted`（单测覆盖四条）。
  （`SubagentHub::broadcast_abort` / `stop_run`；`Runtime::request_abort` 在释放 sessions 锁
  之后**直接**广播（前台 `task` 的同步 join 期间也能送达）；`Session::Drop → shutdown` 覆盖
  重置 / 恢复 / 切 vault / 退出。中枢与终态 sink 都持 `WeakRuntime`，运行时结束后可回收。
  停止单个 run 的命令层接线归 M590；本棒提供 `stop_run` 唯一实现体。单测
  `aborted_background_run_does_not_wake` / `stopping_the_parent_aborts_a_foreground_task_immediately`
  / `isolated_slot_does_not_wake_and_the_hub_is_reclaimable`。）
- [x] 4.12 批准透传接线：`ApprovalRequest` 增加 `source`（agent / run_id / description）；会话待批
  由单槽改列表 `pending_approvals`（快照字段一次迁净，旧字段直接删）；批准 / 拒绝 / 本会话不再问 /
  停止收回四条路径的单测；断言「持 `Runtime.sessions` 锁时不等待用户或子运行」。
  （`approval::ApprovalSource`；`Session.pending` 改列表，`resolve_approval` 按 id 移除、
  `request_abort` 全部 `Withdrawn`、`withdraw_approvals_of_run` 只收单个 run。集成测试
  `harness_runtime.rs` / `abort_turn.rs` 同步迁到 `pending_approvals`。单测
  `approval_is_passed_through_and_denial_keeps_the_run_going` /
  `session_lock_is_never_held_while_waiting_for_approval`。）
- [x] 4.13 自动唤醒调度（`scheduler.rs`）：每父会话一个调度器（`pending` 批次 / `running` / `chain`）；
  空闲时合并窗口 `AUTO_WAKE_COALESCE_MS = 2000`（首条通知起算、不顺延）后起一个回合；正忙时排队、
  回合结束后合并为一个回合；同一时刻至多一个自动回合在飞、至多一个待起批次；通知以带 `auto_notice`
  标记的 user 消息落进父会话历史（内容真源 = 随后第一条 `llm_request.messages`，不另写完成内容记录）。
  通知**收敛入队时**写投递标记 sidecar（`kind=notice_delivered`：`run_ids` / `wake_batch` /
  `shown_at`；写入早于上屏——合并窗口 / 排队期间退出同样覆盖），供「已接纳投递、未被消费」窗口的
  恢复。单测：空闲唤醒、两 run 忙时合并为 1 个回合、
  在飞时排队、用户回合撤销待起唤醒并把通知并入用户回合输入、上屏后退出→恢复按标记重建且不补唤醒、
  通知已进过 `llm_request` 时标记被判陈旧不重复上屏。
  （调度状态与投递在 `SubagentHub` / `wake_worker`；`AUTO_WAKE_*` 常量与 provider 闸在
  `scheduler.rs`。标记写于**收敛入队时**（「已接纳投递、未被消费」的崩溃窗口要求标记先于上屏存在——
  §8.23 的空闲窗口内终止变体），上屏在合并窗口到期时。恢复重建函数
  `restored_notice_texts` / `notice_batch_consumed` 已单测；重建已接进
  `Runtime::resume_session`（通知灌回 input、面板加 `notice` 行、投递标记复制进新文件，
  不起回合）。面板的渲染样式归 M590。单测
  `idle_background_result_wakes_one_parent_turn` / `busy_background_results_merge_into_one_turn` /
  `notice_markers_rebuild_only_unconsumed_batches`。链触顶 / 停止时 pending **保留**（上屏但
  不消费），`continue_wake` 按 `TurnInput::Preloaded` 立即起回合且不重复入历史；isolated 槽位
  在 `on_background_finished` / `process_wake` 全路径短路。起回合分支是**锁内原子取出**：
  acquire / spawn 失败原样放回，窗口内新到的通知留在 pending（不在成功分支清场），
  `delivered` 只在真实插入历史后写；自动回合线程 spawn 失败会 `release_turn`（不留下永久
  busy）。并发收口：触顶分支先标 delivered 再插入、插入失败再摘除；`begin_user_turn` 只
  取走本批 pending 对应 run 的标记（在飞批次的标记留在 wake）；投递标记的批次 id 在 push
  的同一把锁内取得（不再二次加锁，无孤儿批次）。单测
  `continue_after_chain_limit_starts_a_turn_without_duplicating_the_notice` /
  `isolated_slot_does_not_wake_and_the_hub_is_reclaimable` /
  `acquire_failure_keeps_the_notice_for_a_later_turn` /
  `a_notice_arriving_while_the_turn_starts_is_not_lost` /
  `auto_turn_spawn_failure_releases_the_parent_session` /
  `user_turn_during_blocked_insert_does_not_duplicate_the_notice` /
  `user_turn_during_an_in_flight_turn_keeps_blocked_delivery_marks` /
  `notice_marker_batch_matches_the_turn_that_consumes_it`。）
- [x] 4.14 链式失控闸：常量 `AUTO_WAKE_CHAIN_MAX = 5`（代码常量，不进 `SubagentsConfig`）；计数在
  自动回合开始时加一，用户回合开始 / 面板「继续」/ 会话重置恢复切 vault 时清零，不持久化；触顶
  不起回合、`auto_wake.blocked = "chain_limit"`、通知照常上屏并写投递标记；用户停止自动回合视同触顶
  （`blocked = "stopped"`）。单测覆盖：链内五回合放行、第 6 次触顶、清零后恢复、停止后不再唤醒、
  aborted 不唤醒、自动回合内部触顶 `loop_max` 不改变链计数（两者正交）。
  （`SubagentHub::continue_wake` 是面板「继续」的实现体；会话重建由 `Session::Drop` 清空。
  单测 `chain_limit_blocks_the_sixth_wake` / `stopping_the_auto_turn_blocks_further_wakes` /
  `auto_turn_loop_max_does_not_touch_the_chain`。）

## 5. 用量归属与留存

- [x] 5.1 按模型分桶：`Session` 增加 `SubrunUsageTable`（键 = 模型 id，值 = input / cached / writes /
  output / samples / segments），每段收尾累加一次；父会话自己的读数算法与键集不改。
  （M588 落 live 表与唯一累加点；M589 把累加算术收进 `SubrunUsage::accumulate`，live 与恢复
  重算共用这一份。`writes` 来自 `cache_write_tokens`。）
- [x] 5.2 父会话 JSONL 的 `subrun` sidecar（design §9.2 字段），每段一条；失败 / 中止 / resume /
  后台路径同样写（终态如实）。
  （M588 落 sidecar；M589 补 `usage.cache_write_tokens`——缺它恢复重算的 `writes` 不可能与 live
  相等。四键与 `llm_response.usage` 同形，design §9.2 已同步。）
- [x] 5.3 `usage_from_records` 纳入 `subrun` 记录并按模型归桶重算；单测钉「live 分桶表 == 恢复重算
  分桶表」（含 partial、resume、失败段、并行乱序完成）。
  （实现口径：新增 `subrun_usage_from_records(records, seed)`——不塞进 `usage_from_records` 的
  往返配对循环（父会话 ctx% 不受影响是另一条判据）。`seed` = `session_open.subrun_usage`，
  恢复 / 压缩开新文件时随首行落账，链式恢复与压缩边界因此不断档。单测
  `subrun_usage_from_records_matches_live_buckets` / `subrun_records_do_not_change_parent_readings`
  / `subrun_usage_seed_round_trips_and_chains` / `restore_subrun_usage_seeds_buckets`。）
- [x] 5.4 子运行审计流水（`harness/jsonl.rs`）：`subruns/<vault 稳定 id>/<run_id>.jsonl`、`run_open` /
  `run_segment`、wire 记录与 sidecar；MUST NOT 落 `sessions/`（`rg` 断言目录常量只出现在一处装配点）。
  （M588 落目录与写入；M589 把两个根的目录段收进 `sessions_root` / `subruns_root` 两个纯函数，
  单测 `directory_segments_have_one_assembly_point_each` 与 `audit_and_session_roots_are_disjoint`
  机制化。）
- [x] 5.5 会话列举 / 恢复 / 删除三条链路不感知 `subruns/`：跑既有会话列表验收场景，确认零变化。
  （代码级判据：三条链路只读 `vault_sessions_dir`，与 `vault_subruns_dir` 的根目录互不嵌套且有
  单测钉住。**真机复跑 106 / 108 / 124 场景归 M590 真机批**——本棒不改这三条链路的代码，唯一
  新增的读取面是恢复时的 `subrun` 种子。）
- [x] 5.6 后台结果投递与自动唤醒：收敛后写带 `auto_notice` 标记的通知消息（不另写完成内容记录；收敛
  入队时写投递标记，早于上屏）+ 通知上屏 + `subagent_notified`（`wake` / `wake_batch` / `chain_index`）；父会话
  空闲时按 §4.13 起自动回合，正忙时排队合并（单测：不中途改写父会话上下文；两个 run 相继收敛只起
  一个回合；链触顶不起回合；退出恢复按标记重建且不补唤醒）。
  （M588 已全部落地（见 §4.13 的实现口径与单测清单）；M589 只补诊断事件的生产者：七类
  `subagent_*` 面板事件在出口统一转成 `logging` 诊断行，`subagent_notified` 带 `wake` /
  `wake_batch` / `chain_index`。）

## 6. 配置、文档与 bindings

- [x] 6.1 `config.rs` 新增 `SubagentsConfig`（`enabled`（缺省 true）/ `max_turns` / `max_tokens` /
  `timeout_secs` / `max_subruns_per_turn` / `max_concurrent`）与 `[harness.subagents]` 解析；类型
  不符整节回落 + warning，数值越界夹取 + warning；ts-rs 导出。
  （实现口径：`subagents` 在 `RawHarnessConfig` 里收成 `serde_json::Value` 再单独解析——直接结构化
  会把「类型不符」变成整文件回落，与「整节回落」的裁决不符。）
- [x] 6.2 单测：缺节（enabled 生效为 true）/ 空节 / 类型错 / 每键越界与合法边界；定义值夹取到配置
  上限的警告路径；`max_concurrent` 与前四项的语义差异（并发不是预算）。
  （定义值夹取落在 `SubagentsConfig::clamp_turns` / `clamp_tokens` / `clamp_timeout_secs`：返回
  「夹取后值 + 是否夹取」，warning 由 §2 定义装载期按第二项产出——本棒先钉纯函数行为，警告路径随
  定义扫描落地。）
- [x] 6.3 `docs/specs/config-reference.md` 新增 `[harness.subagents]` 键表：缺省值、合法域、生效时机
  （装载时读一次）、定义值夹取、**子运行用量按模型分桶且不进父会话 ctx% / cache%**、回合级最坏
  token 消耗（`max_subruns_per_turn × max_tokens`）；另写明两个**不是配置键**的常量
  （`AUTO_WAKE_CHAIN_MAX = 5`、`AUTO_WAKE_COALESCE_MS = 2000`）与无人注视下的消耗上界
  （`AUTO_WAKE_CHAIN_MAX × max_subruns_per_turn × max_tokens` + 自动回合自身往返）。
  （M589 落 §1.9；同文补 §2「整节回落」例外与 §4 配置目录布局的 `harness/sessions/`、
  `harness/subruns/` 两行。**生效时机按实际代码改准**：`harness_send` 每次调用现场
  `config::load()`、中枢每回合 `set_config` 同步（`harness.rs:1229` / `run.rs:427`），改动
  **下一个回合**生效、不需要重启——任务原文与 design §14 首行的「装载时读一次、需重启」是
  过时表述，M589 已一并改准；`config.rs` 的对应注释不在本棒 scope，另报 finding。）
- [x] 6.4 新增 `docs/specs/subagent-definitions.md`：定义文件格式（vault / user 路径、frontmatter
  字段表含 `background`、校验与丢弃规则、优先级、热加载时机、清单与 15k 告警、内建 `explore` 与
  覆盖规则、本版本不采纳的参照系字段清单、能力边界：8 件工具任意子集 / 无 web 工具）。
  （已落 `docs/specs/subagent-definitions.md`；真源指向 `harness/agents.rs`，路径一律
  `<vault>` / `<config_dir>`。）
- [x] 6.5 `src/bindings/**` 重导出进索引；`scripts/gate.sh quick` 的 bindings-drift 绿。
  （`SubagentsConfig.ts` 新增、`HarnessConfig.ts` 增字段；`scripts/gate.sh quick` 退出码 0，
  `GATE RESULT: 9/9 PASS（SKIP 1）`。）
- [x] 6.6 信息卫生：全部制品、原型与验收 fixture 无真实 vault 路径 / 真实内容（一律 `<vault>` /
  `<config_dir>`）；提交前对改动面做一次 text 级 grep 清扫并记录命令与零命中。
  （M589 改动面：`session.rs` / `jsonl.rs` / `logging.rs` / `harness.rs` / `run.rs` /
  `subagents.rs` / `config-reference.md` / `design.md` / `tasks.md` / `src/bindings/LogEventName.ts`。
  用例里的路径一律合成（`vault-test-*` / `/tmp/lumir-*` / `<vault>` / `<config_dir>`）；
  grep 命令与零命中读数见 M589 完成报告。）

## 7. 诊断与观测

- [x] 7.1 `logging.rs` 白名单新增 `subagent_started` / `subagent_progress` / `subagent_step` /
  `subagent_finished` / `subagent_notified` / `subagent_rejected` / `subagent_catalog_large` 与字段
  校验用例；`status` / `stopped_by` / `reason` / `wake` 为闭集合；`subagent_notified` 带
  `wake` / `wake_batch` / `chain_index`。
  **部分完成（M587）**：按 tower 的 scope 裁决先放行 `subagent_catalog_large` 一条白名单
  （`estimated_tokens` / `definition_count` + 落盘用例），其余六个事件留 §7（M589）。
  **M589 完成**：六个事件进白名单；闭集合常量 `SUBAGENT_STATUSES` / `SUBAGENT_STOPPED_BY` /
  `SUBAGENT_WAKE` / `SUBAGENT_REJECT_REASONS` 逐值有接受用例，越界值在测试构建下判红
  （`subagent_closed_set_violation_is_caught`）。生产者的值来自 `StopReason::as_str()` 与
  `SegmentReport::status()`，日志侧不另立一套（测试期断言，release 原样落盘）。
- [x] 7.2 断言完成事件只有一个产出点（段收尾），失败 / 中止 / 后台路径同样产出一条，不静默；事件
  不含 prompt、文件内容与 vault 绝对路径。
  （实现口径：诊断落盘在**面板事件出口**统一转写——`SubagentHub::set_sink` 包一层
  `DiagnosticSink`，七类事件共用这一个产出点，完成 / 失败 / 中止 / 后台路径天然同路。
  单测 `subagent_diagnostics_have_a_single_production_point` 扫源码钉住
  `logging::subagent_event` 唯一调用点；`subagent_finished` 的构造点恰两处——段收尾
  `ChildContext::finish` 与**无段终态** `emit_failed_terminal`（线程启动失败 / 段前失败共用），
  两处都显式产出、都由同一出口落诊断。
  隐私边界：白名单外的 `prompt` / `messages` / `vault` 物理上进不来，用例
  `subagent_events_round_trip_from_panel_payloads` 反向钉住 `vault` 缺席。）
- [x] 7.3 观测读数自验：跑一次 completed、一次 failed、一次 quota 收敛的子运行，给出使用计数与触顶
  分布（含 quota 单列）的 `rg` 命令实际读数与执行时刻。
  （M590 实测（执行时刻 2026-10-18T20:37:09Z，日志副本 `.local/acceptance/2026-10-18/observability/`）：
  `rg -c '"event":"subagent_finished".*"status":"(completed|partial)"'` → 180=1（completed）、197=1
  （partial + stopped_by=error）、188=4（partial；stopped_by 分布 tokens=1 / rounds=1 / time=1 /
  quota=1，quota 单列）；自动唤醒代价面：`"wake":"auto_turn"` 在读数组内共 15 条、
  `"wake":"blocked_chain"` 6 条（场景 203 的链式五回合）——读数同时暴露了 notified 重复产出的
  缺陷，已报 finding `20261019-worker-m590-bug-subagent-notified-run.md`，本棒不改引擎。）

## 8. 真机验收场景（`scripts/acceptance/scenarios/`）

- [x] 8.1 「定义发现与自动委派」：vault 放两个定义，mock 父响应按 description 选其中一个；断言
  `subagent_started.agent`、工具描述含清单、父会话收到摘要、transcript 无子运行过程消息。
  （M590：场景 180-subagent-delegate-discovery（mock：父 task → 子 → 父续写；诊断 / subrun sidecar / 审计三处判据）。清单注入的可观测后果 = 按名字委派成功——工具描述正文不进留存（`llm_request` 记录不含 tools），场景正文已登记。）
- [x] 8.2 「默认只读」与「显式写工具」：未写 `tools` 断言恰为只读三件；声明 `vault_patch` +
  `vault_write` 档断言写入走既有工具语义。
  （M590：场景 181-subagent-default-tools / 182-subagent-explicit-write-tool（`tools` 串逐字断言 + 文件真落盘）。）
- [x] 8.3 「批准透传」：声明 `vault_delete` + 默认档，断言批准卡出现并带 `source.agent`；批准 ⇒ 文件
  删除；拒绝 ⇒ `approval_denied`、`denied_calls=1`、文件未删、子运行继续并完成。
  （M590：场景 183-subagent-approval-approve / 184-subagent-approval-reject（`read_only` 档；行内卡点名 agent，采纳 / 拒绝两条路径）。）
- [x] 8.4 「定义校验与优先级」：坏定义组（缺 name / 未知工具 / `tools:[task]` / 未知字段 / 越界数值 /
  同名 / `background` 类型错）各产 warning 且好定义照常；vault 覆盖用户级、同层字典序 + warning。
  （M590：场景 185-subagent-definition-validation（用户级定义用新增 `envWrite` 动作落盘）。）
- [x] 8.5 「热加载」：回合间改定义的模型与工具，下一回合委派断言新字段生效，无需重启。
  （M590：场景 186-subagent-hot-reload（两轮 `subagent_started` 的 model / tools 都要换值）。）
- [x] 8.6 「描述超阈值」：生成超阈值定义集合，断言 `subagent_catalog_large` + warning，清单未截断。
  （M590：场景 187-subagent-catalog-large（5 个长描述定义；事件 + warning + 清单计数）。）
- [x] 8.7 「三重闸触顶 + 配额」：分别以 `max_tokens`、`max_turns`、`timeout_secs` 极小驱动，断言
  `partial` + 正确 `stopped_by`、无追加总结调用；mock 返回配额错误断言 `stopped_by=quota` 且无重试。
  （M590：场景 188-subagent-gates-and-quota（tokens / rounds / time / quota 四段；每段 rounds=1）。）
- [x] 8.8 「resume 续跑」：触顶后 `task(resume=run_id)`，断言同 run、`segment=2`、审计同文件追加、
  用量继续归桶；resume 后可完成；运行中的后台 run resume ⇒ `run_busy`。
  （M590：场景 189-subagent-resume（`mockFill` 在运行期把真实 run_id 填进 env fixture 副本）/ 190-subagent-run-busy。）
- [x] 8.9 「resume 边界」：第 5 个 run 淘汰后 resume ⇒ `run_not_resumable`；重启后 resume 同样；
  agent 不匹配 ⇒ `agent_mismatch`。
  （M590：场景 191-subagent-resume-boundary（agent_mismatch + 重启后 run_not_resumable）。**LRU 淘汰**无真机判据（静态 fixture 拿不到被淘汰 run 的 id），由单测 `retained_runs_evict_oldest` 覆盖，场景正文已登记。）
- [x] 8.10 「用量分桶与恢复」：两个不同模型的 run ⇒ 两个桶、父会话 ctx% / cache% 不变；重启恢复后
  分桶表与 live 相等。
  （M590：场景 192-subagent-usage-buckets（重启 + 会话选择器恢复后两桶仍在）。）
- [x] 8.11 「模型解析」：调用覆盖生效、定义非法回落 inherit + warning、调用非法拒绝。
  （M590：场景 193-subagent-model-resolution（mock 的模型清单开放，「定义非法回落 / 调用非法拒绝」归单测，场景正文已登记）。）
- [x] 8.12 「开关、次数闸与并发闸」：`enabled=false` 时工具不注册且任务区不出现；`max_subruns_per_turn=1`
  时第二个委派 `subrun_limit`；`max_concurrent=1` 时第二个后台委派 `concurrency_limit`。
  （M590：场景 194-subagent-disabled / 195-subagent-subrun-limit / 196-subagent-concurrency-limit（三档启动配置拆三条）。）
- [x] 8.13 「API 中断 partial」：mock 返回错误但已有文本，断言 `partial` + `stopped_by=error`。
  （M590：场景 197-subagent-api-partial。）
- [x] 8.14 **回扫既有验收场景的闸期望**（改权限 / 闸语义的 change 必做）：全量跑既有批准闸与权限
  模式相关场景，确认交互会话的 ask / allow / deny 行为逐条不变；期望过期的就地改准并写明原因。
  子运行的新闸语义只出现在 8.3，不得混入交互场景的期望。
  （M590：回扫 72 / 73 / 74 / 75 / 109 / 151；结果见完成报告（期望未过期，无就地改准）。）
- [x] 8.15 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。
  （M590：`--check` 通过（205 个场景，其中新增 26 条）。）
- [x] 8.16 「同回合并行 + 按序回填」：一条助手消息含两个 `task`，让第二个先完成；断言两个 run 的
  时间区间重叠、transcript 两行按调用序、两条工具结果按调用序回填。
  （M590：场景 198-subagent-parallel。**区间重叠**无机器判据（断言面没有跨行时间序），场景正文登记；回填序按请求内 `call_a` → `call_b` 断言。）
- [x] 8.17 「后台运行与通知 + 自动唤醒」：`background=true`；断言立即 `status=running`、父回合正常
  `done`、回合结束后可立即发送新消息、run 收敛后 transcript 出现带 `auto_notice` 标记的自动化通知
  且留存里同时有 `notice_delivered` 投递标记、`subagent_notified` 落盘；空闲时紧接着自动起一个父会话
  回合（`wake=auto_turn`、`chain_index=1`）。
  （M590：场景 199-subagent-background-wake。）
- [x] 8.18 「内建 explore 与覆盖」：无自定义定义时清单含 `explore` 且工具为只读三件；放同名自定义
  定义后生效的是自定义定义 + 覆盖 warning。
  （M590：场景 200-subagent-explore。）
- [x] 8.19 「任务面板可见」（WKWebView AX 断言）：子运行期间任务区出现该行（agent / 状态 / 读数）；
  批准卡在行内展开并点名 agent；主 transcript 的 AX 树不含子运行工具行；停止单个 run 只停它。
  （M590：场景 201-subagent-panel-and-stop（AX：标题计数 / 两行 / 详情 / 停止；子运行工具行不进 transcript）。）
- [x] 8.20 「忙时合并为一个回合」：用户回合进行中两个后台 run 相继收敛；断言当前回合结束后只起**一个**
  自动回合、输入含两条通知（同一 `wake_batch`）、自动回合数 = 1。
  （M590：场景 202-subagent-busy-merge（两次 `chain_index=1`、`chain_index=2` 零次）。）
- [x] 8.21 「链上限与恢复」：连续五个自动回合后第 6 条后台结果收敛 ⇒ 不起回合、通知照常上屏并写
  投递标记、`wake=blocked_chain`、任务区出现触顶提示行（AX 断言）且「继续」可点；用户发言后链清零，
  下一条后台结果恢复自动唤醒；停止自动回合后同样不再唤醒（`blocked_stopped`）。
  （M590：场景 203-subagent-chain-limit（五轮自动回合 + 触顶提示 + 继续）/ 204-subagent-stopped（blocked_stopped）。）
- [x] 8.22 「自动回合与 loop_max 正交」：自动回合内 mock 驱动工具往返触顶 `loop_max`，断言该回合按
  既有提示结束、链计数不变、下一条后台结果仍受链上限约束。
  （M590：场景 205-subagent-auto-turn-loopmax（loop_max_reached + chain_index=1）。）
- [x] 8.23 「已上屏未消费的通知恢复」：链触顶后的通知上屏、下一次 LLM 请求前终止进程（另跑一次空闲
  合并窗口内终止的变体）⇒ 重启后留存有 `notice_delivered` 标记、通知据标记 + `subrun` sidecar 重建
  上屏、不自动起回合；用户发言后该通知进入请求，标记此后被忽略。反向验证：正常收尾后重启，通知不
  重复上屏。
  （M590：场景 206-subagent-notice-restore（合并窗口内退出 → 重建；消费后重启不重复）。）

## 9. 验证

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  （M590 实测：`Totals: 27 passed, 0 failed (27 items)`；`scripts/gate.sh quick` 的 openspec-validate 门禁同绿。）
- [x] 9.2 `cargo test` 通过（含 §1.3 / §1.7 / §2.7–2.9 / §3.2–3.5 / §4.1–4.14 / §5.3 / §5.6 /
  §6.2 / §7.2 新增单测）。
  （M590：`cargo test` 全绿——lib 734 + 集成 95（abort_turn 7 / harness_runtime 41 / link_graph 2 /
  session_recording 17 / wikilink 6 / workspace 22）；新增用例含 `mock_parent_continues_after_child_region`
  （父游标跳过子区间 + 续跑不双计数）与 `definition_model_accepts_any_id_under_mock`。）
- [x] 9.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）；动过
  `src/harness-panel.ts` / `src/style.css` / `tests/visual/**` 后本地跑 `scripts/gate.sh visual`，
  基线更新前截图须 Alex 过目（AGENTS.md 基线纪律）。
  （M590：`GATE RESULT: 10/10 PASS（SKIP 0）`、退出码 0。visual 档另跑但**未取得可信结论**：
  本 worktree 的视觉套件大面积 5s 超时（主题切换未生效：dark/eink 读到 light token；m303 期望
  `对话面板` 实得 `Chat panel`），**同一 m303 spec 在 master 上复现同一失败**（环境/基线口径问题，
  非本改动引入）。任务区在无任务时整块 `hidden`、既有场景默认空态不新增像素，故未申请基线更新。
  详见完成报告。）
- [x] 9.4 真机跑新增验收场景（§8.1–8.23），证据目录用绝对路径 `ls` 到；失败与跳过项逐条写明原因。
  （M590：新增 27 条场景，**26 条 PASS / 1 条 FAIL**（`201-subagent-panel-and-stop` 13 条断言中
  12 条 PASS，唯一 FAIL 是「被停止的 run 收敛为 `aborted`」——AX 点击「停止」未触发后端
  `harness_subagent_stop`（任务行停止钮与发送钮同名 `停止`，真机点击落到哪一个未定），按失败项
  如实登记、不冒充已验。证据：`.local/acceptance/2026-10-18/<场景>/`。）
- [x] 9.5 公共层对账：`rg -n "fn run_turn_for|fn run_turn" src-tauri/src` 确认循环入口唯一；
  `rg -n "cron:run" src` 确认 cron 交接载荷已按 `RunSpec` 形状（或按 §0.2 记录的顺序豁免）。
  （M590 实测读数：`run_turn` / `run_turn_for` 各一处（turn.rs:217 / 315，共享同一循环
  `run_turn_core`）；`cron:run` 仍为 `CronRunPayload` 逐字段载荷（§0.2 的顺序豁免，run-spec 化归
  M593）。）
- [x] 9.6 观测与关停可执行性：按 proposal「观测」节给出检查命令的实际读数与执行时刻；真机重启一次
  验证 `enabled=false` 的关停路径（任务区消失、工具不注册、定义保留）。
  （M590：观测读数见完成报告（completed / partial / quota 三种收敛的 `rg` 实际读数与执行时刻）；
  关停路径由真机场景 `194-subagent-disabled` 验证（任务区与清单整块不出现、`llm_request` 的 tools
  里零 `task`、定义文件保留）。）

## 10. UX 实现（任务面板与可见面）

- [x] 10.1 任务区：面板内 composer 上方，运行中 / 等待批准 / 后台行；行内 agent + description + 状态
  + 轮次 · tokens；状态词不截断、description 唯一可截断字段；无任务时不占位。
  （M590 落 `src/harness-panel.ts` 的任务区段：`taskHeadline` / `renderTaskArea`；只列运行中 /
  等待批准的 run，全部收敛后收敛为「本次会话 N 个已完成」一行 + 按模型用量块；无任务时整块
  `hidden`。样式在 `src/harness-panel.css` 的 `.lumir-tp*`。验收：场景 180 / 201。）
- [x] 10.2 行详情：模型、工具步数、最近一步（人话化参数摘要）、用时、摘要（完成后）、该 run 用量；
  运行中行提供「停止」。
  （M590：面板行详情给模型 / 轮次步数 / 用时 / 最近一步 / 触顶原因 + 运行中「停止」；历史任务的
  **摘要（完成后）**在 transcript 的 `task` 工具行点开（design §19.1）——`subagent_finished` 事件
  补了 `summary` 字段（诊断白名单不含它，不进日志），恢复路径从 `task` 工具记录的结果信封解析。
  停止入口 = `harness_subagent_stop`。验收：场景 201。）
- [x] 10.3 批准卡透传渲染：行内就地展开、点名 agent + description、待批时自动展开、标题显示待批数；
  拒绝后收敛为终态记录；父会话自己的批准卡保持不变。
  （M590：`attachTaskApproval` / `createTaskApprovalCard`；卡片复用父会话的 diff / 原因框 / 按钮
  样式类，外壳与来源行是任务区自己的类。事件与快照两条通道都按 `source.kind === "subrun"`
  分流——父会话的卡仍走 `appendApproval`。验收：场景 183 / 184。）
- [x] 10.4 后台完成通知与自动回合：transcript 自动化通知消息样式（与用户消息区分，左侧色条 +
  「后台任务完成」标签；多条通知合并为一条时逐 run 列一行）；自动回合的助手回复沿用普通回合形态；
  通知消息是模型上下文的一部分（`auto_notice` 标记的 user 消息）。
  （M590：后端在通知**上屏点**统一发 `notice` 事件（正文不进事件——真源仍是会话里那条 user
  消息；事件只带 run 元数据），前端 `appendNotice` 渲染；快照恢复路径按 `role: "notice"` 的
  展示串还原。验收：场景 199 / 202。）
- [x] 10.5 子代理清单：只读折叠列表（名字 / description / 工具数 / 模型 / 来源），覆盖时标来源说明。
  （M590 新增命令 `harness_subagent_catalog`（与 `task` 描述同一次 `AgentCatalog::load`）；
  `override_from` 由后端从定义合并 warning 解析（措辞有单测钉子）。`enabled=false` 时整块不出现。
  验收：场景 194 / 200。）
- [x] 10.6 按模型用量区：展开区给「子任务用量（按模型）」表，父会话控制行读数不变（不掺子运行）。
  （M590：`subrunUsageRows` 消费快照 `subrun_usage`；只在全部 run 收敛后显示。父会话读数不掺
  子运行由 M589 的 `subrun_records_do_not_change_parent_readings` 单测钉住。验收：场景 192。）
- [x] 10.7 前端单测（行状态映射、事件路由到 run、空态）+ 真机 AX 场景（§8.19 / §8.21）；视觉门禁按 §9.3。
  （M590：`tests/unit/harness-subagents.test.ts` 12 条（状态映射 / 归约 / 批准关联 / 标题与空态 /
  触顶文案 / 用量读数 / 清单与通知解析）；真机 AX 场景 201（§8.19）与 203 / 204（§8.21）。）
- [x] 10.8 自动回合触顶提示行：`auto_wake.blocked` 非空时任务区顶部出现提示（`chain_limit` /
  `stopped` 两种文案 + 「继续」按钮）；提示行不冒充 run 行、不参与 run 计数；「继续」等价一次用户
  发言（链清零并按待处理通知起回合），前端单测覆盖两种文案与点击路径。
  （M590：`autoWakeAlertText` 是两种文案的唯一产出点；「继续」= `harness_subagent_continue`
  命令 → `SubagentHub::continue_wake`。提示行独立于 `taskList`、不参与计数。
  验收：场景 203（chain_limit + 继续）/ 204（stopped）。）
