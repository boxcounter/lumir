# Tasks: add-harness-subagents

> **实现范围（预估）**：`src-tauri/src/harness/{run,subagents,turn,tools,session,jsonl,llm,context}.rs`、
> `src-tauri/src/{config,logging}.rs`、`src/bindings/**`、`docs/specs/config-reference.md`、
> `scripts/acceptance/scenarios/**`、`openspec/changes/add-harness-subagents/**`、`docs/adr/0007-*.md`。
>
> **前置**：节点 1（提案评审）通过前不动手；本 change 只到提案制品。
>
> **裁决口径**：`task` 是第 9 件工具（8 件 vault 操作工具 + 1 件编排工具）；公共层按 `RunSpec` +
> `RunContext` 回抽，cron 的运行槽位接入同一契约；子运行默认只读三件、深度硬性 1 层、三重闸任一触顶
> 返回部分结果、ask 级调用一律拒绝、用量折叠进父会话、子运行只留审计流水不进会话列表。逐条裁决点见
> proposal 末尾，Alex 否决项按替代方案改写后重走节点 1。实现期发现意图需变更时停下重走节点 1。

## 0. 前置（ADR 与跨 change 对齐）

- [ ] 0.1 修订 ADR 0007（Revisit 条件命中：subagent 从架构约束转为实际需求）：工具集边界原则拆为
  「vault 操作工具」与「编排工具」两类，清单记为 8 + 1；写清 `task` 不操作 vault、不参与「写且需
  防护」判据；**须 Alex 过目**（ADR 修订是人肉裁决点）。
- [ ] 0.2 与评审中的 change `add-cron-runtime-daemon` 对齐：确认其运行槽位与 `cron:run` 交接载荷在
  实现期按 `RunSpec` 形状落地（cron 提案 §14 的承诺由本 change 兑现）；若两 change 实现顺序对调，
  在 cron 的 tasks 里补一条「接入 RunSpec」，本 change 的公共层任务不删。
- [ ] 0.3 记录本 change 与 cron 的反向扳机分工：公共层随 cron 的消费者去留，不随本 change 的零使用
  删除（动作写进 proposal，代码注释就地写明「无兼容层、按消费者定去留」）。

## 1. 运行公共层回抽（`harness/run.rs` 新建 + `harness/turn.rs` 参数化）

- [ ] 1.1 新建 `run.rs`：`RunOrigin` / `SessionTarget` / `ToolPolicy` / `RunBudget` / `ApprovalPolicy` /
  `RunOutcome` / `RunReport` / `RunSpec`；纯 Rust、无 tauri 依赖（ADR 0002 §7）。
- [ ] 1.2 定义 `RunContext` trait（会话状态、事件接收端、工具定义、权限判定、批准、预算、留存），
  并为交互路径实现 `SessionContext`：`turn.rs` 的 `with_session` 调用点（25 处）与 `sink.emit`
  （16 处）改经 `ctx`，语义逐字节不变。
- [ ] 1.3 `build_request` 的工具定义改由 `ctx.tool_definitions()` 提供；`ToolPolicy` 为全集时输出与
  既有 `tools::definitions()` 深度相等（单测钉死）。
- [ ] 1.4 `llm::client_at` 增加模型覆盖参数；`LlmClient` 增加 `external_consumed()` / `skip(n)`
  （真 provider 恒 0 / no-op），供 mock 的父子游标编排（design §10.2）。
- [ ] 1.5 交互路径回归：既有 `cargo test` 零改写通过（含恢复充分性、事件形状、批准闸、循环上限）；
  `sessions/` JSONL 形状不变；`rg -n "fn run_turn_for" src-tauri/src` 仍只有一处循环实现。
- [ ] 1.6 真机跑一轮既有交互对话（mock 与真 provider 各一次），确认发送、工具调用、批准卡、停止、
  压缩与读数均无变化；把证据路径写进完成报告。

## 2. `task` 工具与工具集

- [ ] 2.1 `tools.rs` 新增第 9 件工具 `task` 的定义（design §4.1 的 schema）与执行入口；文件头
  「恰好 8 个」改为「8 件 vault 操作工具 + 1 件编排工具」，并指向 ADR 0007 修订。
- [ ] 2.2 白名单工具：`ToolPolicy::validate`（闭集合、默认只读三件、`task` 不可声明）、请求构造时
  过滤工具定义、`execute` 层二次校验（`tool_not_allowed`）。
- [ ] 2.3 结果信封与摘要截断：`completed` / `partial` / 失败三态、8,000 字符上限 + 头尾保留 +
  `truncated` 标记、`tool_calls` 计数；单测覆盖空摘要与超长摘要。
- [ ] 2.4 深度 1 的类型层约束：`RunSpec` 构造器拒绝 `Delegation + task in tools`；`task` 声明 `task`
  时回送 `depth_exceeded`（单测 + 集成测试各一条）。
- [ ] 2.5 `enabled=false` 时 `task` 不注册进工具定义；对该工具的调用回送 `disabled`（单测）。

## 3. 子运行引擎（`harness/subagents.rs` 新建）

- [ ] 3.1 `ChildContext`：本地 `Session::new`（不插入 `Runtime.sessions`，不碰父 busy 锁）、
  `ChildSink`（吞掉子运行事件）、`permission()` 复用 `permissions::decide`、`approval()` 恒
  `RejectedUnavailable`（回送 `approval_unavailable`）。
- [ ] 3.2 上下文装配：`assemble_system` 增加委托角色段变体；输入为空历史 + 一条 user 消息（单 text
  part）；MUST NOT 注入编辑器上下文、MUST NOT 继承父历史（单测断言请求体的 system 与 messages）。
- [ ] 3.3 三重闸：`RunBudget` 检查点（往返前、工具调用前、往返后 token 复查）；触顶收敛构造部分
  结果（最后一条非空助手文本 + `note`），不追加总结调用；父回合停止请求在检查点生效（单测覆盖
  三个闸 + 停止）。
- [ ] 3.4 失败与 panic 收尾：`catch_unwind` 后显式执行收尾（折叠用量、写 sidecar、完成事件、flush），
  任何终态都只收尾一次；审计写失败不阻断（`audit_error` 标记）。
- [ ] 3.5 上下文溢出与压缩边界：沿用既有压缩重试一次；压缩只压内存态输入、不轮转审计文件、落
  `compact` sidecar；压缩 usage 计入子运行预算但不折叠父读数（单测）。
- [ ] 3.6 委派次数闸：`max_subruns_per_turn` 按父回合计数，超出回 `subrun_limit`；
  `subagent_rejected` 记录；与被拒调用（不占额度）区分（单测）。

## 4. 用量归属与留存

- [ ] 4.1 `Session` 增加用量折叠入口：把一次运行的 `UsageDelta` 并入累计器（input / cached /
  cache_write / output / samples），只增不减；既有读数算法与键集不改。
- [ ] 4.2 父会话 JSONL 的 `subrun` sidecar（design §8.2 字段），在子运行收尾时写；压缩 / 失败 /
  中止路径同样写（终态如实）。
- [ ] 4.3 `usage_from_records` 纳入 `subrun` 记录重算；单测钉「live 折叠读数 == 恢复重算读数」
  （含一次失败子运行与一次中止子运行）。
- [ ] 4.4 子运行审计流水（`harness/jsonl.rs`）：`subruns/<vault 稳定 id>/<run_id>.jsonl`、`run_open`
  首行、wire 记录与 sidecar；MUST NOT 落 `sessions/`（`rg` 断言目录常量只出现在一处装配点）。
- [ ] 4.5 会话列举 / 恢复 / 删除三条链路不感知 `subruns/`：跑既有会话列表验收场景，确认零变化。

## 5. 配置、文档与 bindings

- [ ] 5.1 `config.rs` 新增 `SubagentsConfig`（`enabled` / `default_max_rounds` / `default_max_tokens` /
  `default_timeout_secs` / `max_subruns_per_turn`）与 `[harness.subagents]` 解析；类型不符整节回落 +
  warning，数值越界夹取 + warning；ts-rs 导出。
- [ ] 5.2 单测：缺节 / 空节 / 类型错 / 每个键的越界与合法边界；`enabled=false` 的工具注册路径。
- [ ] 5.3 `docs/specs/config-reference.md` 新增 `[harness.subagents]` 键表：缺省值、合法域、生效时机
  （装载时读一次，改配置需重启）、逐次参数只能收紧不能放宽、折叠后 cache% 的混合读数含义。
- [ ] 5.4 `src/bindings/**` 重导出进索引；`scripts/gate.sh quick` 的 bindings-drift 绿。
- [ ] 5.5 信息卫生：全部制品与验收 fixture 无真实 vault 路径 / 真实内容（一律 `<vault>` /
  `<config_dir>`）；提交前对改动面做一次 text 级 grep 清扫并记录命令与零命中。

## 6. 诊断与观测

- [ ] 6.1 `logging.rs` 白名单新增 `subagent_started` / `subagent_finished` / `subagent_rejected` 与
  字段校验用例；`subagent_finished` 的 `status` / `stopped_by` 为闭集合。
- [ ] 6.2 断言完成事件只有一个产出点（子运行收尾），失败与中止路径同样产出一条，不静默。
- [ ] 6.3 反扳机口径自验：人为跑一次完成的子运行与一次失败的子运行，给出两条 `rg` 命令（使用计数 /
  触顶分布）的实际读数与执行时刻。

## 7. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 7.1 新增场景「只读调研」：mock 脚本按 design §10.2 的父子游标编排；断言子运行工具集为只读
  三件、父会话收到摘要、父会话 JSONL 有 `subrun` sidecar、`subruns/<vault id>/<run_id>.jsonl` 存在、
  面板无子运行过程消息。
- [ ] 7.2 新增场景「显式写工具」：`tools: ["vault_patch"]` + `vault_write` 档，断言子运行写入成功且
  走既有工具语义（vault 内文件按预期变化）。
- [ ] 7.3 新增场景「需批准调用被拒」：声明 `vault_delete` + 默认档，断言 `approval_unavailable`、
  `denied_calls=1`、文件未删。
- [ ] 7.4 新增场景「三重闸触顶」：分别以 `max_tokens` 极小、`max_rounds=1`、`timeout_secs` 极小驱动，
  断言 `partial` + 正确 `stopped_by`、父 agent 收到部分结果、无追加总结调用。
- [ ] 7.5 新增场景「深度与模型拒绝」：`tools` 含 `task` → `depth_exceeded`；`model` 未声明 →
  `model_not_configured` 且零子运行启动。
- [ ] 7.6 新增场景「用量折叠与恢复」：完成子运行后断言父会话读数增加；重启恢复后读数与 live 相等。
- [ ] 7.7 新增场景「关停与次数上限」：`enabled=false` 时工具不注册；`max_subruns_per_turn=1` 时
  第二个委派 `subrun_limit`。
- [ ] 7.8 **回扫既有验收场景的闸期望**（改权限 / 闸语义的 change 必做）：全量跑既有批准闸与权限
  模式相关场景，确认交互会话的 ask / allow / deny 行为逐条不变；有期望过期的就地改准并写明原因。
  子运行的新闸语义只出现在 7.3，不得混入交互场景的期望。
- [ ] 7.9 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 8.2 `cargo test` 通过（含 §1.3 / §2.2–2.5 / §3.1–3.6 / §4.3 / §5.2 / §6.2 的新增单测）。
- [ ] 8.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）。
- [ ] 8.4 真机跑新增验收场景（§7.1–7.7），证据目录用绝对路径 `ls` 到；失败与跳过项逐条写明原因。
- [ ] 8.5 公共层对账：`rg -n "fn run_turn_for|fn run_turn" src-tauri/src` 确认循环入口唯一；
  `rg -n "cron:run" src` 确认 cron 交接载荷已按 `RunSpec` 形状（或按 §0.2 记录的顺序豁免）。
- [ ] 8.6 反扳机与降级路径的可执行性：按 proposal「观测」节给出三条检查命令的实际读数与执行时刻，
  并确认 `enabled=false` 的关停路径可用（真机重启一次验证）。
