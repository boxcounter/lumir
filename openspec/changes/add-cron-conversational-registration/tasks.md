# Tasks: add-cron-conversational-registration

> **实现范围（预估）**：`src-tauri/src/{config,cron,lib,logging,harness/tools,harness/run,harness/turn,
> harness/permissions,harness/context}.rs`、`src-tauri/src/harness/prompts/cron-reference.md`、
> `src/harness-panel.ts`、`src/harness-panel.css`、`src/copy-data.ts`、`src-tauri/src/bindings/**`（如有
> ts-rs 导出变化）、`docs/specs/config-reference.md`、`docs/adr/0007-ai-positioning-probe.md`（Decision 7
> 修订）、`scripts/acceptance/scenarios/**`、本 change 目录。
>
> **前置**：① 节点 1（提案评审）通过——含 ADR 0007 Decision 7 的扩张裁决（proposal 裁决点 1 / 2）；
> ② `add-cron-runtime-daemon` 与 `add-harness-subagents` 先归档（本 change 的 MODIFIED 块按两者归档后
> 的 living 形态撰写；反序会让「工具循环」的整块替换来回丢项）。
>
> **裁决口径**：三件独立工具（不是单工具多 op）；`create` / `remove` 在 `read_only` / `vault_write`
> 档逐个问、`full_access` 档放行；不做任务面板；运行期注册引入且「注册时已过点」的新任务当日不补
> 触发；不做外部调度器命令黑名单（只做提示词禁令）。实现期发现意图需变更时停下重走节点 1。

## 1. 校验复用（`src-tauri/src/config.rs`）

- [x] 1.1 从 `validate_cron` 的循环体抽出 `validate_cron_task(item, position_label, existing_ids)`，
  作为「一条合法任务」的唯一定义；`validate_cron` 改为逐项调用它，**行为逐字节不变**（既有单测
  全绿即证据）。
- [x] 1.2 单测：同一组非法形态（`at="25:00"`、空 `id`、非绝对 `vault`、空 `prompt`、`days=[]`、
  `at` 为数字）分别经装载期与工具侧入口各跑一次，断言 `field` 与原因文案**逐字相等**。
- [x] 1.3 新增「读—改—写同锁」入口 `config::update_json_atomic(path, f)`：`CONFIG_WRITE_LOCK` 覆盖
  读、改、rename 三段；复用 `write_file_atomic` 与 `bump_config_version`。
- [x] 1.4 并发单测（照 M592 / M600 的既有形态）：两线程同时写不同键（一条 `ui.theme`、一条
  `cron.tasks`），断言两键都在、无 tmp 残留、未知顶层键保留。
- [x] 1.5 `AppConfig.cron` 的注释改准（`config.rs:164-165`）：删掉「运行期不热重载」，改为「启动
  装载 + 运行期经注册通道重载；文件变化本身不触发重读（重载读的是文件当下内容）」。同理改
  `CronRunner.loop_max` 的注释（tasks 3.7）。

## 2. 工具面（`src-tauri/src/harness/tools.rs`）

- [x] 2.1 `CRON_TOOL_NAMES: [&str; 3]`（`cron_task_create` / `cron_task_list` / `cron_task_remove`）
  与 `cron_definitions()`：JSON Schema 按 design §2.3（`create` 的 8 个参数、`list` 无参、`remove`
  一个 `id`）；description 里写明「prompt 必须自包含」「缺省 `notify-then-run`」。
- [x] 2.2 `ToolContext` 增加 `cron: Option<&dyn CronPort>`；`CronPort` trait（`create` / `list` /
  `remove` 三个方法，返回结构化结果或错误码）定义在 `cron.rs` 侧、实现落在 `lib.rs` 接线层
  （`cron.rs` 保持无 tauri 依赖）。
- [x] 2.3 `execute` 增加三支：参数解析 → 校验（`validate_cron_task`）→ 写配置（`update_json_atomic`
  + 只写用户给出的键，`vault` 缺省填当前 vault 根并落绝对路径）→ 投 `Reload` + `recv_timeout(1s)`
  → 回执 `{ok, task, effect, skip_today}`。
- [x] 2.4 错误码按 design §2.4：`cron_task_exists` / `cron_task_not_found` / `cron_task_invalid`
  （带 `field` 与同一句原因）/ 复用 `config_write_failed`。
- [x] 2.5 `create` 不静默覆盖：重名直接报错并指出既有任务的 `at`；唯一性判据是**文件里的全部 id**
  （含装载期被丢弃的非法项）。
- [x] 2.6 `list` 只读：读 `config.json`（宽读，失败按空表）+ 读 `cron-state.json`（只读，缺失 /
  损坏给 `last_fired: null`），不写任何文件。
- [x] 2.7 `permission_subject` 增加 cron 分支：`create` / `remove` 用 `id + at + days`，**不含
  prompt**；`list` 为空串。
- [x] 2.8 单测：成功 create 后 ① 新项在场 ② 模型没给的键缺席（`delivery` / `session` / `days`）
  ③ 其它表与未知顶层键逐字节保留 ④ `version` 未降 ⑤ `cron-state.json` 的 mtime 不变。
- [x] 2.9 单测（负向断言带区分度）：失败路径（非法 / 重名 / 落盘失败）配置逐字节不变——同组用例里
  先做一次成功写，证明文件可写。

## 3. 运行时重载（`src-tauri/src/cron.rs` + `lib.rs`）

- [x] 3.1 `CronMessage::Reload { ack }` + `ReloadOutcome { applied, seeded, error }`；复用既有的
  `CronRuntime.inner.tx` 通道（不新开通道）。
- [x] 3.2 线程不再因空表退出（`lib.rs:958` 的 `return` 改为空转）：空表下 tick 仍是零次循环、
  零文件 IO。
- [x] 3.3 抽出 `schedule_of(snapshot) -> Vec<ScheduledTask>`，启动装载与 reload 共用（`parse_at` +
  vault 路径规范化同一段代码）。
- [x] 3.4 reload 处理按 design §3.3 的七步：重读配置（失败保留旧任务集 + warning + `ack.error`）
  → 重建任务集 → 新增任务判「注册时刻是否已过点」并写当日种子 → 替换 `tasks` 与 `loop_max` →
  清理被删任务的内存记录（in-flight 保留）→ 任务集非空时补检通知权限 → ack。
- [x] 3.5 状态写者唯一：种子只由线程写（工具侧零写状态文件，2.8 的单测钉住）；`cron-state.json`
  仍走 `cron.rs` 既有原子写。
- [x] 3.6 纯函数单测：任务集替换（新增 / 移除 / 改 `at`）、已过点新增 → 种子、未到点新增 →
  不种子、空表替换不 panic、`loop_max` 随 reload 更新、被删任务的在途运行记录保留。
- [x] 3.7 `CronRunner.loop_max` 的注释（`lib.rs:1015`）「配置不热重载」改为「随 reload 更新」。
- [x] 3.8 ack 超时（接收端已断 / 线程未起）→ 回执 `effect="pending_restart"`，**不回滚**已写入的
  配置；`cron_task_registered` 只在 `effect=active` 时落。

## 4. 工具注册面与权限（`harness/run.rs` + `harness/permissions.rs`）

- [x] 4.1 `SessionContext::tool_definitions`：`tool_policy.is_none()` 时追加
  `tools::cron_definitions()`（交互路径唯一注册点）。
- [x] 4.2 单测（区分度：两条断言必须能分别红）：交互路径定义 = 8 + 1 + 3；cron 交接
  （`allow = TOOL_NAMES`）= 8 且三件不在内；子运行定义写 `tools: ["cron_task_create"]` 被定义校验
  拒绝。
- [x] 4.3 `mode_layer` 增加三支：`cron_task_list` 进 `READ_TOOLS`（三档 Allow）；
  `cron_task_create` / `cron_task_remove` 在 `read_only` / `vault_write` 档 Ask、`full_access` 档
  Allow。
- [x] 4.4 权限矩阵单测 3 × 3 逐格断言（含 `read_only` 档 `list` 仍 Allow）。
- [x] 4.5 `ApprovalPreview` 增加 `cron_task: Option<serde_json::Value>`；`turn.rs` 的
  `approval_request` 载荷带上该键（`op` / 五要素 / `prompt` 全文 / `skip_today`）；`remember`
  语义不变。
- [x] 4.6 契约单测：批准卡载荷五要素在场、prompt 与请求逐字一致、`skip_today` 与线程计算一致；
  拒绝路径配置字节不变且无 reload。

## 5. 系统提示词（`harness/context.rs` + `prompts/cron-reference.md`）

- [x] 5.1 新增 `src-tauri/src/harness/prompts/cron-reference.md`，正文照抄 design §7.2。
- [x] 5.2 `context.rs` 增加 `CRON_REFERENCE` / `CRON_REFERENCE_PATH` 常量，`assemble_system` 在
  path_reference 之后、AGENTS 三层之前注入，装配清单记 `cron_reference` 条目（仓内相对路径、
  `exists=true`、trim 后字节数）；`assemble_system_for_subagent` **不**注入。
- [x] 5.3 单测：`assemble_system` 文本包含该段且剔除尾空白后逐字节等于文件；清单条目字段齐；
  子运行装配不含该段；`prompts/` 目录内增删其它文件不改变注入顺序。
- [ ] 5.4 回扫：`rg -n "不热重载" src-tauri/src docs/specs` 只剩改准后的表述（运行期只经注册通道
  重载、文件变化不单独触发重读），没有「任务集恒为启动快照」或「手改一定等下次启动」一类旧话
  （REVIEW.md「设定类现状断言」条）。

## 6. 文档与口径

- [ ] 6.1 `docs/specs/config-reference.md` §1.8：`cron.tasks` 的**生效时机**列改准；新增
  「1.8.1 对话式注册（agent 调度工具）」小节（三件工具表、参数缺省、错误码、注册时已过点不补触发、
  写回纪律：只写给出的键、`vault` 落绝对路径）。
- [ ] 6.2 `docs/specs/config-reference.md` §3 / §4：§3 的「只有四个键会被回写」补上 `cron.tasks`
  （由 agent 工具写、读写同锁）；§4 的 `cron-state.json` 段补「注册种子」与 `last_fired` 的语义
  （「该本地日期不再派发」）。
- [ ] 6.3 `docs/adr/0007-ai-positioning-probe.md` Decision 7 修订为「8 件 vault 操作 + 1 件编排 +
  3 件调度」，Revisit 条件追加本次消费记录（日期 + 本 change）。
- [x] 6.4 **回扫既有验收场景的闸 / 工具清单期望**（`docs/process/openspec-workflow.md` 的强制项）：
  全仓 `rg` 既有场景里「工具清单恰好 8 件」「写类工具默认 ask」「交互路径工具数」一类期望，逐条
  确认是否需要随本 change 改准。已知候选（开工时逐个读，不凭 grep 命中就下结论）：
  `scripts/acceptance/scenarios/75-harness-permissions.md`、`103-harness-tool-order.md`、
  `106-harness-session-restore.md`、`96-harness-transcript-restore.md`、`77-harness-skill-load.md`，
  以及 `tests/unit/harness-restore-block-defaults.test.ts`。本 change 不改既有工具的档位，因此预期
  多数期望仍然成立——**预期不改也必须给出核对结论**（「读过 + 为何不变」），不能默认放过。
- [ ] 6.5 信息卫生：本 change 全部制品与验收场景里不出现真实 vault 路径、真实 LaunchAgent label、
  真实脚本路径（一律占位）；提交前对改动面做一次 text 级 grep 清扫。
- [x] 6.6 `src/bindings/**` 若有 ts-rs 导出变化，`git add` 重导出产物后跑 `scripts/gate.sh quick`
  （`bindings-drift` 的既有纪律）。
- [ ] 6.7 把既有两写者未迁移的读—改—写窗口记进 `docs/backlog.md`（design §4.1 的承诺）：
  `commands::write_config_value_to` / `write_last_vault_to` 的读发生在取 `CONFIG_WRITE_LOCK` 之前，
  本 change 只让新写者走同锁入口，未迁移旧写者。条目一行 gist + 证据指针（`config.rs` 的
  `CONFIG_WRITE_LOCK` 只覆盖写、`commands.rs` 的读在锁外），不写过程性验证状态。

## 7. 批准卡呈现（前端）

- [ ] 7.1 `src/harness-panel.ts`：批准卡增加 `.lumir-hp-approval-cron` 块（两列键值：时间 / 星期 /
  触达 / 会话 / 目标 vault；其下 prompt 全文走既有等宽块样式；再下一行「今天已过点，注册后今天
  不再触发」/「今天照常触发」），位置在判定依据行之后、按钮之前（design §6.3）。
- [ ] 7.2 `src/harness-panel.css`：只新增该块的布局规则（复用既有颜色 token 与等宽字族，**不新增
  配色**）；`src/copy-data.ts` 加对应双语文案条目（`D` 编号）。
- [ ] 7.3 视觉门禁：`scripts/gate.sh visual` 本地跑一次并核对既有批准卡基线的差异只在本块（动过
  `src/harness-panel.ts` / `.css` 后必跑；基线更新是人肉裁决点，先出截图给 Alex）。

## 8. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 8.1 「对话注册 → 工具被调 → 立即生效」：mock fixture 两段（`tool_calls: cron_task_create`
  → 收尾）；`at` = 下一分钟（未到点）。断言批准卡（含 `at` 与 prompt 片段）→ 采纳后 `config.json`
  有该任务且**无** `delivery` 键 → `cron_task_registered(skip_today=false)` → 过点后
  `cron_notified(kind=trigger)` 出现 → 当日 `cron_run_started` 为 0。
- [ ] 8.2 「注册日不补触发」：`at` = 今日已过；断言批准卡 → `cron_task_registered(skip_today=true)`
  → `cron-state.json` 今日 `last_fired` → 多次切前台 + `restart` 后仍零 `cron_notified`。
- [ ] 8.3 「拒绝不落盘」：批准卡点拒绝；断言配置无该任务（同 run 里另一条已采纳的任务必须在文件
  里，作为「文件可写」的正观测）→ 无 `cron_task_registered` → 面板出现拒绝后的收尾。
- [ ] 8.4 「删除任务」：先建后删；断言 `config.json` 不再有该任务、`cron_task_removed`、该任务到点
  后无通知。
- [ ] 8.5 「重名拒绝」：对已存在 `id` 再 create；断言 `cron_task_exists`、配置字节不变、面板工具行
  显示错误摘要。
- [ ] 8.6 「提示词段在场」：新建会话；断言系统上下文含有 cron 段、`session_open.assembly` 有
  `cron_reference` 条目。注：段内容的行为遵从度归抽样观察，**不做机器断言**。
- [ ] 8.7 通知横幅相关子步骤若被 DND 抑制，按 `scripts/acceptance/README.md` 标 INVALID 并写明原因，
  不伪造 PASS（先例：`add-cron-runtime-daemon` tasks §7.2 / §7.3）。
- [ ] 8.8 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。

## 9. 验证

- [ ] 9.1 `openspec validate --all --strict` 通过（CI 与 `scripts/gate.sh` 的同一命令）。
- [ ] 9.2 `bash scripts/docs-check.sh` 全绿（ADR 结构 + openspec 相对链接 + 归档对账）。
- [ ] 9.3 `cargo test` 通过（含 §1.2 / §1.4 / §2.8 / §2.9 / §3.6 / §4.2 / §4.4 / §4.6 / §5.3 的新增
  单测）。
- [ ] 9.4 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）。
- [ ] 9.5 `scripts/gate.sh visual` 本地全绿（动过 `src/harness-panel.*` 后必跑）。
- [ ] 9.6 真机跑 §8.1–8.6，证据落 `.local/acceptance/<日期>/`；失败 / 跳过项逐条写明原因，
  INVALID 不并进 PASS。
- [ ] 9.7 归档顺序核对：`openspec list` 确认 `add-cron-runtime-daemon` / `add-harness-subagents`
  已归档（否则本 change 不归档，并在报告里点名）。
