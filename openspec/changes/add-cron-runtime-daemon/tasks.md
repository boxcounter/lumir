# Tasks: add-cron-runtime-daemon

> **实现范围（预估）**：`src-tauri/src/{config,cron,harness,lib,commands,logging}.rs`、
> `src-tauri/Cargo.toml`、`src/main.ts`（`cron:run` 处理器）、`src/bindings/**`、
> `docs/specs/config-reference.md`、`scripts/acceptance/scenarios/**`、
> `openspec/changes/add-cron-runtime-daemon/**`。
>
> **前置**：节点 1（提案评审）已于 2026-10-18 通过（Alex 原话「通过。」，留痕见
> [proposal.md](proposal.md) 的裁决记录）；实现自本清单展开。
>
> **裁决口径**：cron 是通用机制（任务 = 调度 + 自然语言 prompt + 会话形态 + 触达策略 + 可选模型
> 覆盖），环境初始化是运行时职责；`note-templates` 原语已摘除；运行时守护不建系统级守护；拉取兜底
> 与定时器共享判定函数。实现期发现意图需变更时停下重走节点 1。

## 1. 配置面（`src-tauri/src/config.rs`）

- [x] 1.1 新增 `CronTask`（`id`、`vault`、`at`、`days`、`prompt`、`delivery`、`session`、`model`）
  与 `CronConfig`（`tasks`），进 `AppConfig`；`DeliveryPolicy` / `SessionShape` 用闭集合枚举；
  ts-rs 导出到 `src/bindings/`。
- [x] 1.2 `RawConfig` 增加 `cron` 节；整节错形状走整文件回落，表内逐项校验（`serde_json::Value` +
  逐项判定，照 `vault.ignore` / `harness.permissions` 先例）；`[note_templates]` 不新增任何解析。
- [x] 1.3 `validate_cron`：`id` 非空/无空白且唯一（重复保留首项）、`vault` 绝对路径、`at` 为
  `HH:MM`、`days` 闭集合且非空、`prompt` trim 后非空、`delivery` / `session` 闭集合外回落缺省并
  保留任务、`model` 形状非法只丢该键；每个非法形态一条人话 warning、其余项生效。
- [x] 1.4 单测：§7.2 的每个非法形态 / 合法形态 / 空表 / 缺节 / 整节错形状各一条；断言
  `delivery` 非法时任务保留且取缺省档（不是丢项）。
- [x] 1.5 断言实现代码零任务字面量：`rg -n "daily-log|daily/|## 记录" src-tauri/src src` 零命中
  （配置样例与测试 fixture 用的合成 id 除外，逐条在完成报告点名）。

## 2. 判定与调度（`src-tauri/src/cron.rs` + `lib.rs`）

- [x] 2.1 `cron.rs` 实现 `decide`（纯函数：`at` / `days` / `now` / `last_fired` → `NotDue` /
  `Done` / `Fire`）；无文件 IO、不读时钟；真值表四格 + 星期过滤 + 跨日边界单测。
- [x] 2.2 `at` / `days` 解析与本地时间换算（`chrono::Local`，判定接受注入 `now`，单测不依赖系统
  时区）；DST 跳过/重复小时与时钟回拨用例。
- [x] 2.3 `cron-state.json` 读写：`last_fired` + `session_id`、tmp + rename 原子写、缺失/损坏/
  `version` 不符视为无状态 + warning、不写 `config.json` 与 vault。
- [x] 2.4 `lib.rs` 启动 `lumir-cron` 线程：30s tick（零文件 IO）+ poke 通道；线程在 setup 尾部
  spawn、不阻塞启动；配置装载时快照、运行期不热重载。
- [x] 2.5 拉取触发接线：启动就绪后一次 + `WindowEvent::Focused(true)`（200ms 去抖）+ 目标 vault
  打开成功后一次，三处只投 poke，不内联判定。
  （实现口径：三处都是真实 poke——启动在 `start_cron`、焦点在 `WindowEvent::Focused(true)`、
  目标 vault 打开成功在 `commands::open_vault` 的提交点（两条打开命令共用）与
  `RestoreGuard::finish` 的恢复提交点（启动恢复也是打开成功的一次）。tick 上**不**观察 vault
  变更：本批（M583）因命令层不在改动面而临时用 tick 观察代替第三处（补判最晚 30s），该偏差
  已由 M591 消除。）
- [x] 2.6 派发分支按 `delivery`：`notify-then-run` 只投通知；`run-then-notify` / `silent-run` 发起
  运行交接。派发成功才写 `last_fired`；`vault_not_current` / `busy` / `not_ready` 不写状态并落
  `cron_run_skipped`；当日不自动重试已失败的任务；不跨日补发。
  （通知通道本身由本 change 的通知链路任务接入；本批把投递端口留在 `lib.rs` 的
  `deliver_notification`，通道缺席时按「投递失败」口径处理：不写 `last_fired`、下一次评估重试。）

## 3. 运行装配与会话形态（`harness.rs` + 前端）

- [x] 3.1 运行槽位与交互会话槽位分离：无人值守运行 MUST NOT 改写 / 重置 / 替换用户当前会话，其
  事件不渲染进当前 transcript；新增契约测试钉「运行前后交互槽位的内容与 id 不变」。
- [x] 3.2 发送通道参数化为「显式消息文本 + 可选附件」的单一实现，运行注入 prompt 时不读写 composer
  草稿；`rg` 确认没有第二条发送实现。
- [x] 3.3 `cron:run` 事件与 `cron_run_result({run_id, ok, session_id?, error?})` 命令；运行终态
  只由该回执一处产出。（载荷形状已由 3.9 改为「`RunSpec` + 任务载荷」；字段不再自列。）
- [x] 3.4 `src/main.ts` 装配唯一 `cron:run` 处理器：目标 vault 未打开时走既有 vault 打开链路 →
  `session=new` 新建 / `dedicated` 用状态里的 `session_id` 走既有恢复链路 → 按 `model` 覆盖 →
  经 3.2 的发送通道送出 prompt → 回执结果；不写第二套打开、装配或发送实现。
- [x] 3.5 无人值守运行的批准闸：遇到需批准调用即以 `approval_required` 中止并回执失败（`silent-run`
  只落诊断）；不自动放行、不自动拒绝、不无限挂起。
- [x] 3.6 并发：同一任务同一时刻至多一个在途运行；点击发起运行时若该 vault 会话正忙，给出人话提示
  不排队；`dedicated` 续写不被并发触发。
- [x] 3.7 模型解析：`model` 按运行时 `[harness].providers.<provider>.models` 解析；未声明回落默认 +
  `config_warning`，任务不丢；会话留存 `session_open` 记录的模型与选择一致。
- [x] 3.8 回扫既有验收场景里批准闸相关的期望（权限模式与批准卡场景）：确认 3.5 只作用于运行槽位，
  交互会话的批准行为逐条不变；有期望过期的就地改准并写明原因。
- [x] 3.9 `cron:run` 交接载荷改为「`RunSpec` + 任务载荷」（M593，兑现 change
  `add-harness-subagents` design §2.4）：合成点是 `cron::handoff` 纯函数，定时 / 拉取运行填
  `SessionTarget::Unattended` + `ApprovalPolicy::RejectUnavailable`，点击发起填
  `SessionTarget::Interactive` + `ApprovalPolicy::Interactive`，`budget` 只填轮次上限。前端
  `handleCronRun` 与 `harness_cron_run` 同一次切断消费（无兼容层、无第二套形状）。
  **provider 请求闸**：随 change `add-harness-subagents` §4.9 落地（`harness/scheduler.rs`）。cron
  的运行路径不另接一条线——`SessionContext::request_permit` 在每次 provider 请求（含压缩）前取
  同一个进程内 per-provider 信号量：隔离槽位（cron 无人值守）取 `Child` 优先级、交互槽位取
  `Parent`；许可数 = `max_concurrent + 1`（design §12.3）。M593 rebase 后已用单测
  `isolated_cron_run_shares_the_provider_request_gate` 钉住「cron 持有的许可会挡住交互路径」。

## 4. 通知与点击链路

- [x] 4.1 依赖：`tauri-plugin-notification = "2.6"`（桌面点击回调自 2.6.0 起）与 `chrono`；插件用
  Rust 侧 API 注册，`src-tauri/capabilities/default.json` 零增量（逐条核对）。
- [x] 4.2 启动时注册常驻 `on_action` 监听（`actionId == "tap"`），回调只投递工作项到 `lumir-cron`
  线程；非 `tap` 动作忽略并落诊断。
- [x] 4.3 权限：有有效任务时检查、未决定申请一次、被拒一条 warning 且不反复申请；权限查询失败不
  阻断启动。
- [x] 4.4 投递：标题 = 任务 `id`，正文 = 通用文案（到点 / 已完成 / 运行失败）；`extra` 携带
  `{"task": id}`（结果通知另带该次 `session_id`）；正文不含 prompt、文档内容与绝对路径。
- [x] 4.5 点击链路：`notify-then-run` → 聚焦（show/unminimize/set_focus）→ 必要时打开目标 vault →
  发起运行；`run-then-notify` → 聚焦 → 恢复该次会话；失败各落 `cron_click(ok=false)` + 人话提示。
- [x] 4.6 重复点击幂等：当日已有运行会话时只聚焦并打开该会话，不重复运行、不产生第二次模型请求。
- [x] 4.7 **实现期第一验证项**：确认 `pnpm tauri dev` 的 dev flavour 在 macOS 上能拿到通知权限并
  投递；不可用则改用打包 `.app` 实例验证，并在完成报告写明 flavour。两者都不可用即停下上报，不
  跳过通知验证。
  （**结论：dev flavour 可用**。插件在 dev 档按 `tauri::is_dev()` 把通知归属到
  `com.apple.Terminal`（插件源码行为），首次投递触发 Terminal 的通知权限弹窗；授权后
  `usernoted` 日志出现 `successfully processed by pipeline, scheduled for delivery` 与
  `Presenting … as banner`。本机结论另有一条环境项：系统处于专注模式（DND，user 的
  「我要睡觉了」Focus），横幅被 `muted by DND suppression: delay` 抑制——通知进入通知中心
  存储但不上屏，点击链路因此无法自动化，见 §7.2/§7.3 的 INVALID 登记。）

## 5. 诊断事件与可观测性

- [x] 5.1 `logging.rs` 白名单新增 `cron_notified` / `cron_click` / `cron_run_started` /
  `cron_run_finished` / `cron_run_skipped` / `cron_task_invalid` 六个事件名与字段校验用例。
  （白名单与字段校验用例已落；`cron_notified` / `cron_click` 的触发点在通知与点击链路任务里，
  本批只落事件名、字段面与 Rust 侧埋点入口。）
- [x] 5.2 断言成功 / 失败终态只有一个产出点：`cron_run_finished` 由 `cron_run_result` 回执驱动；
  其它事件不重复判定（单测 + 一次代码走查）。
  （单测 `cron_run_finished_has_a_single_production_point` 扫 `src-tauri/src/**/*.rs` 源码，
  命中数不为 1 即判红。）
- [x] 5.3 观测口径自验：人为点击一次通知 → 日志出现 `cron_click(ok=true)`；跑一次 `silent-run`
  任务 → 日志出现 `cron_run_finished(ok=true)`；仅投递未点击的通知只产生 `cron_notified`。
  （自验读数：仅投递未点击的 170 现场 `cron_notified(kind=trigger)` 1 条、`cron_run_started` /
  `cron_run_finished` / `cron_click(ok=true)` 均 0 条；`silent-run` 的 172 现场
  `cron_run_finished(ok=true)` 1 条、`cron_notified` 0 条。`cron_click(ok=true)` 因 DND 无法
  产生真实点击，未取得读数——如实登记，不伪造。）

## 6. 文档与 bindings

- [x] 6.1 `docs/specs/config-reference.md` 新增 `[cron]` 一节：键表、缺省值、闭集合、非法项口径、
  生效时机（装载时读一次、改配置需重启）、`cron-state.json` 位置与读取纪律。
- [x] 6.2 `src/bindings/**` 重导出产物进索引（ts-rs）；`scripts/gate.sh quick` 的 bindings-drift 绿。
- [x] 6.3 信息卫生：proposal / design / spec / tasks / 验收场景内无真实 vault 路径与真实内容
  （样例一律 `<daily-vault>` / `<work-vault>` 一类占位）；提交前对改动面做一次 text 级 grep 清扫。
- [x] 6.4 口径一致性：`rg -n "note_templates|note-templates|note-template:open|\{\{date\}\}"
  --glob '!openspec/changes/add-cron-runtime-daemon/**' --glob '!.tower/**'` 全仓零命中（本 change
  目录内的「已摘除」历史说明与裁决原文除外，逐条点名）。

## 7. 真机验收场景（`scripts/acceptance/scenarios/`）

- [x] 7.1 新增场景「cron 到点通知」：隔离 `XDG_CONFIG_HOME` 写一条 `notify-then-run` 任务
  （`at` = 下一分钟）与 mock provider；断言到点前后目标 vault 零写入、`cron-state.json` 出现今日
  `last_fired`、`shot` 留通知横幅证据、日志**无** `cron_run_started`（未点击不花 token）。
- [x] 7.2 新增场景「点击发起运行」：接 7.1，经 KimiCU 按截图坐标点击横幅本体；断言 `cron_click
  (ok=true, action=run)`、`cron_run_started`、`cron_run_finished(ok=true)`、面板出现任务 prompt 与
  回答、会话 JSONL 落在目标 vault 目录。
  （场景已落 `170-cron-click-run`；真机跑批判 **INVALID**：本机 DND 抑制横幅上屏 + 横幅不在
  Lumir 的 AX 树 / 窗口截图内，按 §7.7 的边界口径标 INVALID，不伪造 PASS。关闭专注模式后可复跑。）
- [x] 7.3 新增场景「run-then-notify」：同一任务改 `delivery=run-then-notify`（`at` = 下一分钟）；
  断言到点**无**「到点」通知、无点击即出现 `cron_run_started`、终态后有结果通知横幅与
  `cron_notified(kind=result)`、点击后会话被恢复（`cron_click(action=open-session)`）且不重跑。
  （场景已落 `171-cron-run-then-notify`；运行侧判据全部 PASS（started / finished ok=true /
  kind=result / 无 trigger 通知 / 留存），点击恢复子步骤同因 DND 判 **INVALID**，不伪造 PASS。）
- [x] 7.4 新增场景「silent-run」：`delivery=silent-run`、`at` = 今日已过、清状态；断言运行发生
  （`cron_run_started` / `cron_run_finished(ok=true)`）、日志**零** `cron_notified`、会话留存可经
  既有会话历史列出。
- [x] 7.5 新增场景「配置非法项丢弃 warning」：两条任务，一条 `at="25:00"`、一条合法；断言启动成功、
  一条 `cron_task_invalid(field=at)` 与人话 warning、合法任务照常触发、非法任务零 `cron_run_started`。
- [x] 7.6 新增场景「当日去重」：`at` = 今日已过 + `notify-then-run`、清状态；通知一次后 `restart`
  并多次切前台；断言全程只有一条 `cron_notified(kind=trigger)`、`last_fired` 保持今日、无第二条横幅。
- [x] 7.7 通知点击的验证边界写进场景注释：横幅属系统通知中心进程、不在 Lumir 的 AX 树里；主判据
  为「按截图坐标点击 → 应用内可断言」；横幅位置不稳定时降级为通知中心点击并留截图；无法自动化时
  标 INVALID，不伪造 PASS；dev flavour 通知不可用时改用打包实例并写明 flavour。
- [x] 7.8 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。

## 8. 验证

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 8.2 `cargo test` 通过（含 §1.4 / §2.1–2.3 / §3.1 / §3.7 / §5.2 的新增单测）。
- [x] 8.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）。
- [x] 8.4 真机跑新增验收场景（§7.1–7.6），`.local/acceptance/<日期>/` 下证据目录可用绝对路径
  `ls` 到；失败项与跳过项逐条写明原因。
- [x] 8.5 观测口径可用性自验（§5.3）：给出两条 `rg` 命令的实际读数与执行时刻，证明诊断链路可查。
