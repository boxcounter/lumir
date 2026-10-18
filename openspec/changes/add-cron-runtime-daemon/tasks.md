# Tasks: add-cron-runtime-daemon

> **实现范围（预估）**：`src-tauri/src/{config,cron,note_templates,lib,commands,logging}.rs`、
> `src-tauri/Cargo.toml`、`src/main.ts`（`note-template:open` 处理器）、`src/bindings/**`、
> `docs/specs/config-reference.md`、`scripts/acceptance/scenarios/**`、
> `openspec/changes/add-cron-runtime-daemon/**`。
>
> **前置**：节点 1（提案评审）通过前不动手；本 change 只到提案制品。
>
> **裁决口径**：运行时守护（不建系统级守护）+ 拉取兜底共享判定函数 + 模板独立原语；
> 反向扳机「连续 4 周零使用即删除」见 proposal；实现期发现意图需变更时停下重走节点 1。

## 1. 配置面（`src-tauri/src/config.rs`）

- [ ] 1.1 新增 `NoteTemplateConfig`（`path: String`、`body: Vec<String>`、`prompt: Option<String>`）与
  `CronTask`（`id`、`vault`、`at`、`template`、`days`）/ `CronConfig`（`tasks`），进 `AppConfig`；
  ts-rs 导出到 `src/bindings/`。
- [ ] 1.2 `RawConfig` 增加 `cron` / `note_templates` 两节；整节错形状走整文件回落，表内逐项校验
  （`serde_json::Value` + 逐项判定，照 `vault.ignore` / `harness.permissions` 先例）。
- [ ] 1.3 `validate_note_templates`：id 非空/无空白、`path` vault 相对路径、`body` 字符串数组、
  `prompt` 类型非法只丢 prompt；未知 `{{…}}` 一条 warning 且原样保留。
- [ ] 1.4 `validate_cron`：`id` 唯一（重复保留首项）、`vault` 绝对路径、`at` 为 `HH:MM`、
  `template` 悬空引用丢项、`days` 闭集合且非空；每个非法形态一条人话 warning、其余项生效。
- [ ] 1.5 单测：§5.2 / §5.3 的每个非法形态 + 合法形态 + 空表 / 缺节 / 整节错形状各一条。

## 2. 模板原语（`src-tauri/src/note_templates.rs` + 入口）

- [ ] 2.1 `resolve_instance_path(vault_root, template, date)`：`{{date}}` 替换、vault 内路径边界校验
  （复用 fs-io 的边界实现，不复制第二份）。
- [ ] 2.2 `ensure_instance(...) -> Exists | Created`：已存在即 no-op、绝不读写字节；缺失父目录逐级创建；
  `create_new` 写入（行 `\n` 连接 + 末尾单个 `\n`）；写失败清理本次文件并返回错误。
- [ ] 2.3 单测：首次创建逐字节、二次调用 mtime/内容不变、父目录创建、非法路径拒绝、写失败清理。
- [ ] 2.4 `commands.rs` 新增 `note_template_open({ template_id, vault? })`：`vault` 省略用当前 vault；
  返回 `{ path, created }` 并触发前端 `note-template:open` 事件；完成（含失败）记 `template_open`
  诊断事件，**不记** `cron_open`（两条来源的事件名分开，见 design §11）。
- [ ] 2.5 `src/main.ts` 装配唯一处理器：必要时先打开目标 vault → 既有打开文件链路开标签 →
  `prompt` 在场时用既有 `harness_draft_put` 预载草稿（不发送）。
- [ ] 2.6 断言模板入口不读 cron 配置：`rg -n "cron" src-tauri/src/note_templates.rs` 零命中（注释除外）。

## 3. cron 判定与运行时守护（`src-tauri/src/cron.rs` + `lib.rs`）

- [ ] 3.1 `cron.rs` 实现 `decide`（纯函数，输入含 `now` / `notified_on` / `instance_exists`）与
  `check`（一次 `metadata` 探测 + 调 `decide`），truth table 八格全部覆盖。
- [ ] 3.2 `at` / `days` 解析与本地时间换算（`chrono::Local`，判定接受注入 `now`，单测不依赖系统时区）；
  跨日、DST 跳过/重复小时的用例。
- [ ] 3.3 `cron-state.json` 读写：tmp + rename 原子写、缺失/损坏/version 不符视为无状态 + warning、
  不写 `config.json` 与 vault。
- [ ] 3.4 `lib.rs` 启动 `lumir-cron` 线程：30s tick（零文件 IO）+ poke 通道；线程在 setup 尾部
  spawn、不阻塞启动；配置装载时快照、运行期不热重载。
- [ ] 3.5 拉取触发接线：启动就绪后一次 + `WindowEvent::Focused(true)`（200ms 去抖），两处只投 poke，
  不内联判定。
- [ ] 3.6 日志白名单新增 `cron_notified` / `cron_open`（仅通知点击链路）/ `template_open`（仅模板独立
  入口）/ `cron_task_invalid` 四个事件名（含字段校验用例；断言独立入口不产生 `cron_open`）。

## 4. 通知与点击链路（独立功能点）

- [ ] 4.1 依赖：`tauri-plugin-notification = "2.6"`（桌面点击回调自 2.6.0 起）与 `chrono`；插件用
  Rust 侧 API 注册，capabilities 零增量（核对 `src-tauri/capabilities/default.json` 未新增条目）。
- [ ] 4.2 启动时注册常驻 `on_action` 监听（`actionId == "tap"`），回调只投递工作项到 `lumir-cron`
  线程；非 `tap` 动作忽略并落诊断。
- [ ] 4.3 权限：有有效任务时检查、未决定申请一次、被拒一条 warning 且不反复申请；权限查询失败不阻断启动。
- [ ] 4.4 投递：标题 = 任务可读名、正文 = 目标文件名未建；`extra` 携带 `{"task": id}`；正文不含文档内容
  与绝对路径；投递成功才写去重状态。
- [ ] 4.5 点击后四步：聚焦（show/unminimize/set_focus）→ `ensure_instance` → 发 `note-template:open`
  → 前端预载草稿；目标 vault 未打开时先走既有 vault 打开链路。
- [ ] 4.6 失败路径：vault 不可达 / 路径不可写 / webview 已销毁各落一条 `cron_open(ok=false)` 诊断，
  能给的人话提示不静默；重复点击幂等。
- [ ] 4.7 **实现期第一验证项**：确认 `pnpm tauri dev` 的 dev flavour 在 macOS 上能拿到通知权限并投递；
  不可用则改用打包 `.app` 实例验证，并在完成报告写明 flavour。两者都不可用即停下上报，不跳过通知验证。

## 5. 文档与 bindings

- [ ] 5.1 `docs/specs/config-reference.md` 新增 `[note_templates]` / `[cron]` 两节：键表、默认值、
  生效时机（装载时读一次、改配置需重启）、非法项口径、去重状态文件位置与读取纪律。
- [ ] 5.2 `src/bindings/**` 重导出产物进索引（ts-rs）；`scripts/gate.sh quick` 的 bindings-drift 绿。
- [ ] 5.3 proposal / design / spec 内不出现真实 vault 路径（`rg` 真实路径零命中；样例路径为占位符）。

## 6. 真机验收场景（`scripts/acceptance/scenarios/`）

- [ ] 6.1 新增场景「cron 到点通知 + 点击建环境」：隔离 `XDG_CONFIG_HOME` 写模板与任务
  （`at` = 下一分钟）；断言到点前后目标文件均不存在（判定不写盘）→ `cron-state.json` 出现今日记录 →
  `shot` 留通知横幅证据 → 经 KimiCU 对通知横幅按截图坐标点击（目标为系统通知中心进程；实现期先核实
  该点击通道可操作，见 6.5）→ `ax` 断言窗口前台与目标标签打开 →
  `file` 断言实例内容（日期 frontmatter + 小节）→ 再次点击后 mtime 不变。
- [ ] 6.2 新增场景「启动补判」：`at` = 今日已过、清状态、起 app → 今日 `last_notified` 在场 + 横幅截图；
  `restart` 后不再产生第二条。
- [ ] 6.3 新增场景「已满足不通知」：seed 今日实例、`at` 已过 → 状态文件无今日记录、无新横幅、文件不变。
- [ ] 6.4 新增场景「模板独立入口」：只有模板、无 cron 任务 → 首次调用创建并开标签、二次调用不写盘。
- [ ] 6.5 通知点击的验证边界写进场景注释：横幅属系统通知中心进程、不在 Lumir 的 AX 树里；主判据为
  「按截图坐标点击 → 应用内可断言」；横幅位置不稳定时降级为通知中心点击并留截图；无法自动化时标
  INVALID，不伪造 PASS。dev flavour 通知不可用时改用打包实例并写明 flavour。
- [ ] 6.6 `node scripts/acceptance/run.mjs --check` 通过（新增场景静态校验）。

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 7.2 `cargo test` 通过（含 §1.5 / §2.3 / §3.1 / 3.2 / 3.3 的新增单测）。
- [ ] 7.3 `scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行与退出码照抄进完成报告）。
- [ ] 7.4 真机跑新增验收场景（§6.1–6.4），`test-results/acceptance/<日期>/` 下证据目录可用绝对路径 `ls` 到。
- [ ] 7.5 反向扳机观测可用性自验：人为点击一次通知、并调用一次模板独立入口，日志里分别能 grep 到
  `cron_notified` + `cron_open` 与 `template_open`（且独立入口不产生 `cron_open`）——证明 proposal
  的两条度量口径（cron 只计点击链路、模板独立调用方另计）可执行。
