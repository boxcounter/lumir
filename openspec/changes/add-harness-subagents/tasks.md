# Tasks: add-harness-subagents

> **实现范围（预估）**：`src-tauri/src/harness/{agents,run,subagents,scheduler,turn,tools,session,jsonl,llm,approval,context}.rs`、
> `src-tauri/src/{config,logging}.rs`、`src-tauri/Cargo.toml`、`src/harness-panel.ts`、`src/bindings/**`、
> `docs/specs/{config-reference,subagent-definitions}.md`、`scripts/acceptance/scenarios/**`、
> `openspec/changes/add-harness-subagents/**`、`docs/adr/0007-*.md`。
>
> **前置**：节点 1（提案评审）通过前不动手；本 change 只到提案制品 + 原型。
>
> **裁决口径**：形态照 Claude Code subagents 参照系（定义即 Markdown + frontmatter、按名字委派、按
> description 自动委派、partial 可 resume）；真源已裁决的两条不松动——工具缺省只读三件、三重闸全在。
> 第二轮按 Alex 节点 1 阅读中的裁决改写：**并行 + 后台运行、批准卡透传、内建 `explore`、用量按模型
> 分桶、用户可见面**（逐条原话见 proposal「裁决留痕」）。第三轮按节点 1 终审前的裁决改写：**后台完成
> 自动唤醒父会话**（推翻取舍 14）+ **链式失控闸**（`AUTO_WAKE_CHAIN_MAX = 3`，取舍 19）、降级检查改由
> cron 承载。深度 1 层用「不授予 `task` 工具」表达；逐条取舍见 proposal 末尾 19 条设计取舍（第 7、13 条
> 与 15–18 条已采纳；第 14 条先采纳后推翻；第 19 条待裁），Alex 否决项按替代方案改写后重走节点 1；
> 实现期发现意图需变更时停下重走节点 1。

## 0. 前置（ADR 与跨 change 对齐）

- [ ] 0.1 修订 ADR 0007（Revisit 条件命中：subagent 从架构约束转为实际需求）：工具集边界原则拆为
  「vault 操作工具」与「编排工具」两类，清单记为 8 + 1；写清 `task` 不操作 vault、不参与「写且需
  防护」判据；**须 Alex 过目**（ADR 修订是人肉裁决点）。
- [ ] 0.2 与评审中的 change `add-cron-runtime-daemon` 对齐：确认其运行槽位与 `cron:run` 交接载荷在
  实现期按 `RunSpec` 形状落地；若两 change 实现顺序对调，在 cron 的 tasks 里补一条「接入 RunSpec」，
  本 change 的公共层任务不删；确认 cron 运行与子运行共用同一个 provider 请求闸（design §12.3）。
- [ ] 0.3 记录公共层的去留口径：公共层按实际消费者决定去留（cron / 委托），不因单一原语的变化删改；
  写进代码注释就地说明「无兼容层、按消费者定去留」。

## 1. 运行公共层回抽（`harness/run.rs` 新建 + `harness/turn.rs` 参数化）

- [ ] 1.1 新建 `run.rs`：`RunOrigin` / `SessionTarget` / `ToolPolicy` / `RunBudget` / `ApprovalPolicy`
  （三值：Interactive / PassthroughFrom / RejectUnavailable）/ `RunOutcome` / `RunReport` / `RunSpec`
  （含 `background`）；纯 Rust、无 tauri 依赖（ADR 0002 §7）。
- [ ] 1.2 定义 `RunContext` trait（会话、事件接收端、工具定义、权限判定、批准、预算、留存），实现
  `SessionContext`：`turn.rs` 的 `with_session` 调用点（25 处）与 `sink.emit`（16 处）改经 `ctx`，
  语义逐字节不变。
- [ ] 1.3 `build_request` 的工具定义改由 `ctx.tool_definitions()` 提供；交互上下文按当前定义快照
  生成 `task` 描述（含清单）；`enabled=false` 时输出与既有 8 件清单深度相等（单测钉死）。
- [ ] 1.4 `llm::client_at` 增加模型覆盖参数；`LlmClient` 增加 `external_consumed()` / `skip(n)`
  （真 provider 恒 0 / no-op），供 mock 父子游标编排（design §18）。
- [ ] 1.5 交互路径回归：既有 `cargo test` 零改写通过（含恢复充分性、事件形状、批准闸、循环上限）；
  `sessions/` JSONL 形状不变；`rg -n "fn run_turn_for" src-tauri/src` 仍只有一处循环实现。
- [ ] 1.6 真机跑一轮既有交互对话（mock 与真 provider 各一次），确认发送、工具调用、批准卡、停止、
  压缩与读数均无变化；证据路径写进完成报告。
- [ ] 1.7 工具循环的并行编排：同一条助手消息里的多个 `task` 调用并行启动、非 `task` 调用维持逐个
  执行；结果收进 `BTreeMap<call_index, ToolResult>`，全部收敛后按调用顺序回填；单测断言「完成顺序
  与回填顺序无关」（让第二个调用先完成，断言结果仍是 0,1）。

## 2. 子代理定义文件（`harness/agents.rs` 新建）

- [ ] 2.1 YAML 依赖选型并落地：`serde_yaml` 已 deprecated，候选 `yaml-rust2` / `saphyr`；只解析
  标量 + 字符串列表子集，产出窄结构体；选型理由写进 Cargo.toml 注释与完成报告。
- [ ] 2.2 扫描：`<vault>/.lumir/agents/**/*.md` 与 `<config_dir>/agents/**/*.md` 递归发现；目录
  不存在视为空；每回合开头扫描一次并快照（不做 watcher）。
- [ ] 2.3 frontmatter 解析与字段校验：`name` / `description` 必填；`tools` / `model` / `max_turns` /
  `max_tokens` / `timeout_secs` / `background` 可选；非法定义逐条丢弃 + 点名 warning；未知字段
  warning 并忽略；`tools: []` 合法；`tools` 含 `task` 或未知工具 ⇒ 丢定义。
- [ ] 2.4 优先级：vault 覆盖用户级；同层同名取字典序第一个 + warning（确定性规则，不依赖文件系统
  读序）。
- [ ] 2.5 正文与身份段：定义正文按需读取（只在委派时装配），不进主会话上下文、不进清单。
- [ ] 2.6 清单注入与容量告警：`name` + `description` 注入 `task` 描述；估算 token（`ceil(字符数 ÷ 4)`）
  超 15,000 时一条 warning + `subagent_catalog_large` 事件；MUST NOT 截断清单。
- [ ] 2.7 单测：每个校验分支（缺必填 / 未知工具 / `task` / 空 tools / 未知字段 / 非法 model /
  越界数值 / 同名 / YAML 坏格式 / `background` 类型错）各一条；扫描对坏文件不整体失败。
- [ ] 2.8 内建 `explore`：代码内置定义（只读三件、`inherit`、三闸取配置），与磁盘定义同一条装载 /
  校验 / 清单路径；同名自定义覆盖内建 + 覆盖 warning + 清单只一条（单测：无定义时有 explore、
  有同名定义时生效的是自定义）。
- [ ] 2.9 `background` 字段：`true` 时调用参数无法降为前台；类型错 ⇒ 定义保留、取 `false` + warning
  （单测）。

## 3. `task` 工具（`harness/tools.rs`）

- [ ] 3.1 新增第 9 件工具 `task` 的定义（design §5.1 的 schema，含 `background`）与执行入口；文件头
  「恰好 8 个」改为「8 件 vault 操作工具 + 1 件编排工具」，指向 ADR 0007 修订。
- [ ] 3.2 工具注册条件：`enabled=false` 时不注册；对该工具的调用回送 `disabled`（单测）。
- [ ] 3.3 参数校验：`agent` 命中清单、`prompt` 非空、`resume` 合法、`background` 布尔；失败码闭集合
  （`agent_not_found` / `run_not_resumable` / `run_busy` / `agent_mismatch` / `subrun_limit` /
  `concurrency_limit` / `model_not_configured` / `empty_prompt`）。
- [ ] 3.4 结果信封与摘要截断：completed / partial / running / 失败四态、`run_id` / `resumable` /
  `model` / `segment`、8,000 字符上限 + 头尾保留 + `truncated`、`tool_calls` 计数；单测覆盖空摘要与
  超长摘要。
- [ ] 3.5 后台启动路径：拿不到并发许可 ⇒ `concurrency_limit`；拿到即返回 `status=running` 并把句柄
  交调度器（单测：启动后父回合不等它、句柄可见）。

## 4. 子运行引擎与调度（`harness/subagents.rs`、`harness/scheduler.rs` 新建）

- [ ] 4.1 `ChildContext`：本地 `Session::new`（不插入 `Runtime.sessions`，不碰父 busy 锁）、
  `ChildSink`（过程事件转面板事件 + 只计 tool_calls）、`permission()` 复用 `permissions::decide`、
  `approval()` 走透传通道、每 run 一线程。
- [ ] 4.2 上下文装配：`assemble_system` 增加「定义正文替换身份段 + 委托约束段」变体；AGENTS 三层与
  Skill 索引照常；输入为空历史 + 一条 user 消息；不注入编辑器上下文（单测断言 system 与 messages）。
- [ ] 4.3 三重闸 + 配额：预算来自定义（夹取配置上限）；检查点（往返前、工具调用前、往返后 token
  复查）；时间闸按运行时长累计、审批等待顺延；provider 配额 / 限流 ⇒ `stopped_by=quota` 且不重试
  （单测覆盖四闸 + 停止 + 审批等待不计时）。
- [ ] 4.4 错误语义：API 错误但有文本 ⇒ partial + `stopped_by=error`；无文本 ⇒ failed；不自动重试
  （单测）。
- [ ] 4.5 收尾幂等：`catch_unwind` 后显式执行收尾（按模型记账、写 sidecar、事件、flush），任何终态
  只收尾一次；审计写失败不阻断（`audit_error`）。
- [ ] 4.6 resume：内存保留（`MAX_RETAINED_RUNS = 4`，LRU、运行中不淘汰）、agent 一致性校验、模型
  解析序、新段预算、审计同文件追加 `run_segment`、运行中 run 回 `run_busy`；父会话重置 / 恢复 / 关
  vault 清空保留并中止后台 run（单测覆盖淘汰、重启等价、定义不匹配、运行中续跑被拒）。
- [ ] 4.7 上下文溢出与压缩边界：沿用压缩重试一次；压缩只压内存态输入、不轮转审计文件、落 `compact`
  sidecar；压缩 usage 计入段预算但不进任何模型桶（单测）。
- [ ] 4.8 次数闸：`max_subruns_per_turn` 按父回合计数（前台 + 后台）、只计实际执行的段；超出回
  `subrun_limit`；被拒调用不占额度（单测）。
- [ ] 4.9 并发调度器（`scheduler.rs`）：会话级计数信号量 `max_concurrent`（前台阻塞取、后台非阻塞
  取）+ 每 provider 请求闸（`max_concurrent + 1`，父请求优先、子请求 FIFO）；cron 运行共用该闸。
  单测：并行 N 个 run 时在飞请求数不超上限；父往返不被子 run 饿死。
- [ ] 4.10 事件交错：`task` 工具行按调用顺序创建 / 就地更新；工具结果按调用序回填；过程事件带
  `run_id` + `segment` 且同 run 有序；审计按 run 隔离（单测：交错完成顺序不改变 transcript 行序与
  结果序）。
- [ ] 4.11 后台生命周期：跨回合运行不改 busy；父回合停止广播中止；单个 run 可从面板停止；会话重置 /
  恢复 / 切 vault / 退出中止并记 `aborted`（单测覆盖四条）。
- [ ] 4.12 批准透传接线：`ApprovalRequest` 增加 `source`（agent / run_id / description）；会话待批
  由单槽改列表 `pending_approvals`（快照字段一次迁净，旧字段直接删）；批准 / 拒绝 / 本会话不再问 /
  停止收回四条路径的单测；断言「持 `Runtime.sessions` 锁时不等待用户或子运行」。
- [ ] 4.13 自动唤醒调度（`scheduler.rs`）：每父会话一个调度器（`pending` 批次 / `running` / `chain`）；
  空闲时合并窗口 `AUTO_WAKE_COALESCE_MS = 2000`（首条通知起算、不顺延）后起一个回合；正忙时排队、
  回合结束后合并为一个回合；同一时刻至多一个自动回合在飞、至多一个待起批次；通知以带 `auto_notice`
  标记的 user 消息落进父会话历史（`llm_request` 留存即真源，不另写旁路记录）。单测：空闲唤醒、
  两 run 忙时合并为 1 个回合、在飞时排队、用户回合撤销待起唤醒并把通知并入用户回合输入。
- [ ] 4.14 链式失控闸：常量 `AUTO_WAKE_CHAIN_MAX = 3`（代码常量，不进 `SubagentsConfig`）；计数在
  自动回合开始时加一，用户回合开始 / 面板「继续」/ 会话重置恢复切 vault 时清零，不持久化；触顶
  不起回合、`auto_wake.blocked = "chain_limit"`、通知照常落库上屏；用户停止自动回合视同触顶
  （`blocked = "stopped"`）。单测覆盖：链内三回合放行、第 4 次触顶、清零后恢复、停止后不再唤醒、
  aborted 不唤醒、自动回合内部触顶 `loop_max` 不改变链计数（两者正交）。

## 5. 用量归属与留存

- [ ] 5.1 按模型分桶：`Session` 增加 `SubrunUsageTable`（键 = 模型 id，值 = input / cached / writes /
  output / samples / segments），每段收尾累加一次；父会话自己的读数算法与键集不改。
- [ ] 5.2 父会话 JSONL 的 `subrun` sidecar（design §9.2 字段），每段一条；失败 / 中止 / resume /
  后台路径同样写（终态如实）。
- [ ] 5.3 `usage_from_records` 纳入 `subrun` 记录并按模型归桶重算；单测钉「live 分桶表 == 恢复重算
  分桶表」（含 partial、resume、失败段、并行乱序完成）。
- [ ] 5.4 子运行审计流水（`harness/jsonl.rs`）：`subruns/<vault 稳定 id>/<run_id>.jsonl`、`run_open` /
  `run_segment`、wire 记录与 sidecar；MUST NOT 落 `sessions/`（`rg` 断言目录常量只出现在一处装配点）。
- [ ] 5.5 会话列举 / 恢复 / 删除三条链路不感知 `subruns/`：跑既有会话列表验收场景，确认零变化。
- [ ] 5.6 后台结果投递与自动唤醒：收敛后写带 `auto_notice` 标记的通知消息（不另写旁路记录）+ 通知
  上屏 + `subagent_notified`（`wake` / `wake_batch` / `chain_index`）；父会话空闲时按 §4.13 起自动
  回合，正忙时排队合并（单测：不中途改写父会话上下文；两个 run 相继收敛只起一个回合；链触顶不起
  回合）。

## 6. 配置、文档与 bindings

- [ ] 6.1 `config.rs` 新增 `SubagentsConfig`（`enabled`（缺省 true）/ `max_turns` / `max_tokens` /
  `timeout_secs` / `max_subruns_per_turn` / `max_concurrent`）与 `[harness.subagents]` 解析；类型
  不符整节回落 + warning，数值越界夹取 + warning；ts-rs 导出。
- [ ] 6.2 单测：缺节（enabled 生效为 true）/ 空节 / 类型错 / 每键越界与合法边界；定义值夹取到配置
  上限的警告路径；`max_concurrent` 与前四项的语义差异（并发不是预算）。
- [ ] 6.3 `docs/specs/config-reference.md` 新增 `[harness.subagents]` 键表：缺省值、合法域、生效时机
  （装载时读一次）、定义值夹取、**子运行用量按模型分桶且不进父会话 ctx% / cache%**、回合级最坏
  token 消耗（`max_subruns_per_turn × max_tokens`）；另写明两个**不是配置键**的常量
  （`AUTO_WAKE_CHAIN_MAX = 3`、`AUTO_WAKE_COALESCE_MS = 2000`）与无人注视下的消耗上界
  （`AUTO_WAKE_CHAIN_MAX × max_subruns_per_turn × max_tokens` + 自动回合自身往返）。
- [ ] 6.4 新增 `docs/specs/subagent-definitions.md`：定义文件格式（vault / user 路径、frontmatter
  字段表含 `background`、校验与丢弃规则、优先级、热加载时机、清单与 15k 告警、内建 `explore` 与
  覆盖规则、本版本不采纳的参照系字段清单、能力边界：8 件工具任意子集 / 无 web 工具）。
- [ ] 6.5 `src/bindings/**` 重导出进索引；`scripts/gate.sh quick` 的 bindings-drift 绿。
- [ ] 6.6 信息卫生：全部制品、原型与验收 fixture 无真实 vault 路径 / 真实内容（一律 `<vault>` /
  `<config_dir>`）；提交前对改动面做一次 text 级 grep 清扫并记录命令与零命中。

## 7. 诊断与观测

- [ ] 7.1 `logging.rs` 白名单新增 `subagent_started` / `subagent_progress` / `subagent_step` /
  `subagent_finished` / `subagent_notified` / `subagent_rejected` / `subagent_catalog_large` 与字段
  校验用例；`status` / `stopped_by` / `reason` / `wake` 为闭集合；`subagent_notified` 带
  `wake` / `wake_batch` / `chain_index`。
- [ ] 7.2 断言完成事件只有一个产出点（段收尾），失败 / 中止 / 后台路径同样产出一条，不静默；事件
  不含 prompt、文件内容与 vault 绝对路径。
- [ ] 7.3 观测读数自验：跑一次 completed、一次 failed、一次 quota 收敛的子运行，给出使用计数与触顶
  分布（含 quota 单列）的 `rg` 命令实际读数与执行时刻。

## 8. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 8.1 「定义发现与自动委派」：vault 放两个定义，mock 父响应按 description 选其中一个；断言
  `subagent_started.agent`、工具描述含清单、父会话收到摘要、transcript 无子运行过程消息。
- [ ] 8.2 「默认只读」与「显式写工具」：未写 `tools` 断言恰为只读三件；声明 `vault_patch` +
  `vault_write` 档断言写入走既有工具语义。
- [ ] 8.3 「批准透传」：声明 `vault_delete` + 默认档，断言批准卡出现并带 `source.agent`；批准 ⇒ 文件
  删除；拒绝 ⇒ `approval_denied`、`denied_calls=1`、文件未删、子运行继续并完成。
- [ ] 8.4 「定义校验与优先级」：坏定义组（缺 name / 未知工具 / `tools:[task]` / 未知字段 / 越界数值 /
  同名 / `background` 类型错）各产 warning 且好定义照常；vault 覆盖用户级、同层字典序 + warning。
- [ ] 8.5 「热加载」：回合间改定义的模型与工具，下一回合委派断言新字段生效，无需重启。
- [ ] 8.6 「描述超阈值」：生成超阈值定义集合，断言 `subagent_catalog_large` + warning，清单未截断。
- [ ] 8.7 「三重闸触顶 + 配额」：分别以 `max_tokens`、`max_turns`、`timeout_secs` 极小驱动，断言
  `partial` + 正确 `stopped_by`、无追加总结调用；mock 返回配额错误断言 `stopped_by=quota` 且无重试。
- [ ] 8.8 「resume 续跑」：触顶后 `task(resume=run_id)`，断言同 run、`segment=2`、审计同文件追加、
  用量继续归桶；resume 后可完成；运行中的后台 run resume ⇒ `run_busy`。
- [ ] 8.9 「resume 边界」：第 5 个 run 淘汰后 resume ⇒ `run_not_resumable`；重启后 resume 同样；
  agent 不匹配 ⇒ `agent_mismatch`。
- [ ] 8.10 「用量分桶与恢复」：两个不同模型的 run ⇒ 两个桶、父会话 ctx% / cache% 不变；重启恢复后
  分桶表与 live 相等。
- [ ] 8.11 「模型解析」：调用覆盖生效、定义非法回落 inherit + warning、调用非法拒绝。
- [ ] 8.12 「开关、次数闸与并发闸」：`enabled=false` 时工具不注册且任务区不出现；`max_subruns_per_turn=1`
  时第二个委派 `subrun_limit`；`max_concurrent=1` 时第二个后台委派 `concurrency_limit`。
- [ ] 8.13 「API 中断 partial」：mock 返回错误但已有文本，断言 `partial` + `stopped_by=error`。
- [ ] 8.14 **回扫既有验收场景的闸期望**（改权限 / 闸语义的 change 必做）：全量跑既有批准闸与权限
  模式相关场景，确认交互会话的 ask / allow / deny 行为逐条不变；期望过期的就地改准并写明原因。
  子运行的新闸语义只出现在 8.3，不得混入交互场景的期望。
- [ ] 8.15 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。
- [ ] 8.16 「同回合并行 + 按序回填」：一条助手消息含两个 `task`，让第二个先完成；断言两个 run 的
  时间区间重叠、transcript 两行按调用序、两条工具结果按调用序回填。
- [ ] 8.17 「后台运行与通知 + 自动唤醒」：`background=true`；断言立即 `status=running`、父回合正常
  `done`、回合结束后可立即发送新消息、run 收敛后 transcript 出现带 `auto_notice` 标记的自动化通知、
  `subagent_notified` 落盘；空闲时紧接着自动起一个父会话回合（`wake=auto_turn`、`chain_index=1`）。
- [ ] 8.18 「内建 explore 与覆盖」：无自定义定义时清单含 `explore` 且工具为只读三件；放同名自定义
  定义后生效的是自定义定义 + 覆盖 warning。
- [ ] 8.19 「任务面板可见」（WKWebView AX 断言）：子运行期间任务区出现该行（agent / 状态 / 读数）；
  批准卡在行内展开并点名 agent；主 transcript 的 AX 树不含子运行工具行；停止单个 run 只停它。
- [ ] 8.20 「忙时合并为一个回合」：用户回合进行中两个后台 run 相继收敛；断言当前回合结束后只起**一个**
  自动回合、输入含两条通知（同一 `wake_batch`）、自动回合数 = 1。
- [ ] 8.21 「链上限与恢复」：连续三个自动回合后第 4 条后台结果收敛 ⇒ 不起回合、通知照常上屏、
  `wake=blocked_chain`、任务区出现触顶提示行（AX 断言）且「继续」可点；用户发言后链清零，下一条后台
  结果恢复自动唤醒；停止自动回合后同样不再唤醒（`blocked_stopped`）。
- [ ] 8.22 「自动回合与 loop_max 正交」：自动回合内 mock 驱动工具往返触顶 `loop_max`，断言该回合按
  既有提示结束、链计数不变、下一条后台结果仍受链上限约束。

## 9. 验证

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 9.2 `cargo test` 通过（含 §1.3 / §1.7 / §2.7–2.9 / §3.2–3.5 / §4.1–4.14 / §5.3 / §5.6 /
  §6.2 / §7.2 新增单测）。
- [ ] 9.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）；动过
  `src/harness-panel.ts` / `src/style.css` / `tests/visual/**` 后本地跑 `scripts/gate.sh visual`，
  基线更新前截图须 Alex 过目（AGENTS.md 基线纪律）。
- [ ] 9.4 真机跑新增验收场景（§8.1–8.22），证据目录用绝对路径 `ls` 到；失败与跳过项逐条写明原因。
- [ ] 9.5 公共层对账：`rg -n "fn run_turn_for|fn run_turn" src-tauri/src` 确认循环入口唯一；
  `rg -n "cron:run" src` 确认 cron 交接载荷已按 `RunSpec` 形状（或按 §0.2 记录的顺序豁免）。
- [ ] 9.6 观测与关停可执行性：按 proposal「观测」节给出检查命令的实际读数与执行时刻；真机重启一次
  验证 `enabled=false` 的关停路径（任务区消失、工具不注册、定义保留）。

## 10. UX 实现（任务面板与可见面）

- [ ] 10.1 任务区：面板内 composer 上方，运行中 / 等待批准 / 后台行；行内 agent + description + 状态
  + 轮次 · tokens；状态词不截断、description 唯一可截断字段；无任务时不占位。
- [ ] 10.2 行详情：模型、工具步数、最近一步（人话化参数摘要）、用时、摘要（完成后）、该 run 用量；
  运行中行提供「停止」。
- [ ] 10.3 批准卡透传渲染：行内就地展开、点名 agent + description、待批时自动展开、标题显示待批数；
  拒绝后收敛为终态记录；父会话自己的批准卡保持不变。
- [ ] 10.4 后台完成通知与自动回合：transcript 自动化通知消息样式（与用户消息区分，左侧色条 +
  「后台任务完成」标签；多条通知合并为一条时逐 run 列一行）；自动回合的助手回复沿用普通回合形态；
  通知消息是模型上下文的一部分（`auto_notice` 标记的 user 消息）。
- [ ] 10.5 子代理清单：只读折叠列表（名字 / description / 工具数 / 模型 / 来源），覆盖时标来源说明。
- [ ] 10.6 按模型用量区：展开区给「子任务用量（按模型）」表，父会话控制行读数不变（不掺子运行）。
- [ ] 10.7 前端单测（行状态映射、事件路由到 run、空态）+ 真机 AX 场景（§8.19 / §8.21）；视觉门禁按 §9.3。
- [ ] 10.8 自动回合触顶提示行：`auto_wake.blocked` 非空时任务区顶部出现提示（`chain_limit` /
  `stopped` 两种文案 + 「继续」按钮）；提示行不冒充 run 行、不参与 run 计数；「继续」等价一次用户
  发言（链清零并按待处理通知起回合），前端单测覆盖两种文案与点击路径。
