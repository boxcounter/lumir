# Tasks: add-harness-subagents

> **实现范围（预估）**：`src-tauri/src/harness/{agents,run,subagents,turn,tools,session,jsonl,llm,context}.rs`、
> `src-tauri/src/{config,logging}.rs`、`src-tauri/Cargo.toml`、`src/bindings/**`、
> `docs/specs/{config-reference,subagent-definitions}.md`、`scripts/acceptance/scenarios/**`、
> `openspec/changes/add-harness-subagents/**`、`docs/adr/0007-*.md`。
>
> **前置**：节点 1（提案评审）通过前不动手；本 change 只到提案制品。
>
> **裁决口径**：形态照 Claude Code subagents 参照系（定义即 Markdown + frontmatter、按名字委派、按
> description 自动委派、partial 可 resume）；真源已裁决的三条不松动——工具缺省只读三件、用量归主
> 会话、三重闸全在。深度 1 层用「不授予 `task` 工具」表达，不维护深度计数。逐条取舍见 proposal 末尾
> 13 条裁决点，Alex 否决项按替代方案改写后重走节点 1；实现期发现意图需变更时停下重走节点 1。

## 0. 前置（ADR 与跨 change 对齐）

- [ ] 0.1 修订 ADR 0007（Revisit 条件命中：subagent 从架构约束转为实际需求）：工具集边界原则拆为
  「vault 操作工具」与「编排工具」两类，清单记为 8 + 1；写清 `task` 不操作 vault、不参与「写且需
  防护」判据；**须 Alex 过目**（ADR 修订是人肉裁决点）。
- [ ] 0.2 与评审中的 change `add-cron-runtime-daemon` 对齐：确认其运行槽位与 `cron:run` 交接载荷在
  实现期按 `RunSpec` 形状落地；若两 change 实现顺序对调，在 cron 的 tasks 里补一条「接入 RunSpec」，
  本 change 的公共层任务不删。
- [ ] 0.3 记录反向扳机的分工：公共层随 cron 的消费者去留，不随本 change 的零使用删除（写进代码
  注释就地说明「无兼容层、按消费者定去留」）。

## 1. 运行公共层回抽（`harness/run.rs` 新建 + `harness/turn.rs` 参数化）

- [ ] 1.1 新建 `run.rs`：`RunOrigin` / `SessionTarget` / `ToolPolicy` / `RunBudget` / `ApprovalPolicy` /
  `RunOutcome` / `RunReport` / `RunSpec`；纯 Rust、无 tauri 依赖（ADR 0002 §7）。
- [ ] 1.2 定义 `RunContext` trait（会话、事件接收端、工具定义、权限判定、批准、预算、留存），实现
  `SessionContext`：`turn.rs` 的 `with_session` 调用点（25 处）与 `sink.emit`（16 处）改经 `ctx`，
  语义逐字节不变。
- [ ] 1.3 `build_request` 的工具定义改由 `ctx.tool_definitions()` 提供；交互上下文按当前定义快照
  生成 `task` 描述（含清单）；无定义 / `enabled=false` 时输出与既有 8 件清单深度相等（单测钉死）。
- [ ] 1.4 `llm::client_at` 增加模型覆盖参数；`LlmClient` 增加 `external_consumed()` / `skip(n)`
  （真 provider 恒 0 / no-op），供 mock 父子游标编排（design §18）。
- [ ] 1.5 交互路径回归：既有 `cargo test` 零改写通过（含恢复充分性、事件形状、批准闸、循环上限）；
  `sessions/` JSONL 形状不变；`rg -n "fn run_turn_for" src-tauri/src` 仍只有一处循环实现。
- [ ] 1.6 真机跑一轮既有交互对话（mock 与真 provider 各一次），确认发送、工具调用、批准卡、停止、
  压缩与读数均无变化；证据路径写进完成报告。

## 2. 子代理定义文件（`harness/agents.rs` 新建）

- [ ] 2.1 YAML 依赖选型并落地：`serde_yaml` 已 deprecated，候选 `yaml-rust2` / `saphyr`；只解析
  标量 + 字符串列表子集，产出窄结构体；选型理由写进 Cargo.toml 注释与完成报告。
- [ ] 2.2 扫描：`<vault>/.lumir/agents/**/*.md` 与 `<config_dir>/agents/**/*.md` 递归发现；目录
  不存在视为空；每回合开头扫描一次并快照（不做 watcher）。
- [ ] 2.3 frontmatter 解析与字段校验：`name` / `description` 必填，`tools` / `model` / `max_turns` /
  `max_tokens` / `timeout_secs` 可选；非法定义逐条丢弃 + 点名 warning；未知字段 warning 并忽略；
  `tools: []` 合法；`tools` 含 `task` 或未知工具 ⇒ 丢定义。
- [ ] 2.4 优先级：vault 覆盖用户级；同层同名取字典序第一个 + warning（确定性规则，不依赖文件系统
  读序）。
- [ ] 2.5 正文与身份段：定义正文按需读取（只在委派时装配），不进主会话上下文、不进清单。
- [ ] 2.6 清单注入与容量告警：`name` + `description` 注入 `task` 描述；估算 token（`ceil(字符数 ÷ 4)`）
  超 15,000 时一条 warning + `subagent_catalog_large` 事件；MUST NOT 截断清单。
- [ ] 2.7 单测：每个校验分支（缺必填 / 未知工具 / `task` / 空 tools / 未知字段 / 非法 model /
  越界数值 / 同名 / YAML 坏格式）各一条；扫描对坏文件不整体失败。

## 3. `task` 工具（`harness/tools.rs`）

- [ ] 3.1 新增第 9 件工具 `task` 的定义（design §5.1 的 schema）与执行入口；文件头「恰好 8 个」改为
  「8 件 vault 操作工具 + 1 件编排工具」，指向 ADR 0007 修订。
- [ ] 3.2 工具注册条件：`enabled=false`、无生效定义时不注册；对该工具的调用回送 `disabled` /
  `agent_not_found`（单测）。
- [ ] 3.3 参数校验：`agent` 命中清单、`prompt` 非空、`resume` 合法；失败码闭集合
  （`agent_not_found` / `run_not_resumable` / `agent_mismatch` / `subrun_limit` /
  `model_not_configured` / `empty_prompt`）。
- [ ] 3.4 结果信封与摘要截断：completed / partial / 失败三态、`run_id` / `resumable` / `segment`、
  8,000 字符上限 + 头尾保留 + `truncated`、`tool_calls` 计数；单测覆盖空摘要与超长摘要。

## 4. 子运行引擎（`harness/subagents.rs` 新建）

- [ ] 4.1 `ChildContext`：本地 `Session::new`（不插入 `Runtime.sessions`，不碰父 busy 锁）、
  `ChildSink`（吞事件、只计 tool_calls）、`permission()` 复用 `permissions::decide`、`approval()` 恒
  `RejectedUnavailable`、批准缓存视图为空。
- [ ] 4.2 上下文装配：`assemble_system` 增加「定义正文替换身份段 + 委托约束段」变体；AGENTS 三层与
  Skill 索引照常；输入为空历史 + 一条 user 消息；不注入编辑器上下文（单测断言 system 与 messages）。
- [ ] 4.3 三重闸：预算来自定义（夹取配置上限）；检查点（往返前、工具调用前、往返后 token 复查）；
  触顶收敛构造部分结果（最后一条非空助手文本 + note），不追加总结调用；父回合停止请求经闭包在检查点
  生效（单测覆盖三闸 + 停止）。
- [ ] 4.4 错误语义：API 错误但有文本 ⇒ partial + `stopped_by=error`；无文本 ⇒ failed；不自动重试
  （单测）。
- [ ] 4.5 收尾幂等：`catch_unwind` 后显式执行收尾（折叠用量、写 sidecar、事件、flush），任何终态只
  收尾一次；审计写失败不阻断（`audit_error`）。
- [ ] 4.6 resume：内存保留（`MAX_RETAINED_RUNS = 4`，LRU）、agent 一致性校验、模型解析序、新段
  预算、审计同文件追加 `run_segment`；父会话重置 / 恢复 / 关 vault 清空保留（单测覆盖淘汰、重启
  等价、定义不匹配）。
- [ ] 4.7 上下文溢出与压缩边界：沿用压缩重试一次；压缩只压内存态输入、不轮转审计文件、落 `compact`
  sidecar；压缩 usage 计入段预算但不折叠父读数（单测）。
- [ ] 4.8 委派次数闸：`max_subruns_per_turn` 按父回合计数、只计实际执行的段；超出回 `subrun_limit`；
  被拒调用不占额度（单测）。

## 5. 用量归属与留存

- [ ] 5.1 `Session` 增加用量折叠入口：把一段的 `UsageDelta` 并入累计器（input / cached /
  cache_write / output / samples），只增不减；既有读数算法与键集不改。
- [ ] 5.2 父会话 JSONL 的 `subrun` sidecar（design §9.2 字段），每段一条；失败 / 中止 / resume 路径
  同样写（终态如实）。
- [ ] 5.3 `usage_from_records` 纳入 `subrun` 记录重算；单测钉「live 折叠读数 == 恢复重算读数」
  （含 partial、resume、失败段）。
- [ ] 5.4 子运行审计流水（`harness/jsonl.rs`）：`subruns/<vault 稳定 id>/<run_id>.jsonl`、`run_open` /
  `run_segment`、wire 记录与 sidecar；MUST NOT 落 `sessions/`（`rg` 断言目录常量只出现在一处装配点）。
- [ ] 5.5 会话列举 / 恢复 / 删除三条链路不感知 `subruns/`：跑既有会话列表验收场景，确认零变化。

## 6. 配置、文档与 bindings

- [ ] 6.1 `config.rs` 新增 `SubagentsConfig`（`enabled` / `max_turns` / `max_tokens` / `timeout_secs` /
  `max_subruns_per_turn`）与 `[harness.subagents]` 解析；类型不符整节回落 + warning，数值越界夹取 +
  warning；ts-rs 导出。
- [ ] 6.2 单测：缺节 / 空节 / 类型错 / 每键越界与合法边界；定义值夹取到配置上限的警告路径。
- [ ] 6.3 `docs/specs/config-reference.md` 新增 `[harness.subagents]` 键表：缺省值、合法域、生效时机
  （装载时读一次）、定义值夹取、折叠后 cache% 的混合读数含义。
- [ ] 6.4 新增 `docs/specs/subagent-definitions.md`：定义文件格式（vault / user 路径、frontmatter
  字段表、校验与丢弃规则、优先级、热加载时机、清单与 15k 告警、本版本不采纳的参照系字段清单）。
- [ ] 6.5 `src/bindings/**` 重导出进索引；`scripts/gate.sh quick` 的 bindings-drift 绿。
- [ ] 6.6 信息卫生：全部制品与验收 fixture 无真实 vault 路径 / 真实内容（一律 `<vault>` /
  `<config_dir>`）；提交前对改动面做一次 text 级 grep 清扫并记录命令与零命中。

## 7. 诊断与观测

- [ ] 7.1 `logging.rs` 白名单新增 `subagent_started` / `subagent_finished` / `subagent_rejected` /
  `subagent_catalog_large` 与字段校验用例；`status` / `stopped_by` / `reason` 为闭集合。
- [ ] 7.2 断言完成事件只有一个产出点（段收尾），失败与中止路径同样产出一条，不静默；事件不含 prompt
  与 vault 绝对路径。
- [ ] 7.3 反扳机口径自验：跑一次 completed 与一次 failed 的子运行，给出使用计数与触顶分布的 `rg`
  命令实际读数与执行时刻。

## 8. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 8.1 「定义发现与自动委派」：vault 放两个定义，mock 父响应按 description 选其中一个；断言
  `subagent_started.agent`、工具描述含清单、父会话收到摘要、面板无子运行过程消息。
- [ ] 8.2 「默认只读」与「显式写工具」：未写 `tools` 断言恰为只读三件；声明 `vault_patch` +
  `vault_write` 档断言写入走既有工具语义。
- [ ] 8.3 「需批准调用被拒」：声明 `vault_delete` + 默认档，断言 `approval_unavailable`、
  `denied_calls=1`、文件未删。
- [ ] 8.4 「定义校验与优先级」：坏定义组（缺 name / 未知工具 / `tools:[task]` / 未知字段 / 越界数值 /
  同名）各产 warning 且好定义照常；vault 覆盖用户级、同层字典序 + warning。
- [ ] 8.5 「热加载」：回合间改定义的模型与工具，下一回合委派断言新字段生效，无需重启。
- [ ] 8.6 「描述超阈值」：生成超阈值定义集合，断言 `subagent_catalog_large` + warning，清单未截断。
- [ ] 8.7 「三重闸触顶」：分别以 `max_tokens`、`max_turns`、`timeout_secs` 极小驱动，断言
  `partial` + 正确 `stopped_by`、无追加总结调用。
- [ ] 8.8 「resume 续跑」：触顶后 `task(resume=run_id)`，断言同 run、`segment=2`、审计同文件追加、
  用量继续折叠；resume 后可完成。
- [ ] 8.9 「resume 边界」：第 5 个 run 淘汰后 resume ⇒ `run_not_resumable`；重启后 resume 同样；
  agent 不匹配 ⇒ `agent_mismatch`。
- [ ] 8.10 「用量折叠与恢复」：完成 / partial / resume 后父会话读数增加；重启恢复后读数与 live 相等。
- [ ] 8.11 「模型解析」：调用覆盖生效、定义非法回落 inherit + warning、调用非法拒绝。
- [ ] 8.12 「开关与次数闸」：`enabled=false` 时工具不注册；`max_subruns_per_turn=1` 时第二个委派
  `subrun_limit`。
- [ ] 8.13 「API 中断 partial」：mock 返回错误但已有文本，断言 `partial` + `stopped_by=error`。
- [ ] 8.14 **回扫既有验收场景的闸期望**（改权限 / 闸语义的 change 必做）：全量跑既有批准闸与权限
  模式相关场景，确认交互会话的 ask / allow / deny 行为逐条不变；期望过期的就地改准并写明原因。
  子运行的新闸语义只出现在 8.3，不得混入交互场景的期望。
- [ ] 8.15 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。

## 9. 验证

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 9.2 `cargo test` 通过（含 §1.3 / §2.7 / §3.2–3.4 / §4.1–4.8 / §5.3 / §6.2 / §7.2 新增单测）。
- [ ] 9.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）。
- [ ] 9.4 真机跑新增验收场景（§8.1–8.13），证据目录用绝对路径 `ls` 到；失败与跳过项逐条写明原因。
- [ ] 9.5 公共层对账：`rg -n "fn run_turn_for|fn run_turn" src-tauri/src` 确认循环入口唯一；
  `rg -n "cron:run" src` 确认 cron 交接载荷已按 `RunSpec` 形状（或按 §0.2 记录的顺序豁免）。
- [ ] 9.6 反扳机与降级路径可执行性：按 proposal「观测」节给出检查命令的实际读数与执行时刻；确认
  `enabled=false` 关停路径可用（真机重启一次验证）。
