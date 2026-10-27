# Tasks: add-cron-notification-relaunch

> 本 change 目前只到**节点 1（提案评审）**：下面全部保持未勾选，提案通过后才进入实现。

## 1. macOS 通知平台层（自持）

- [ ] 1.1 新增 `src-tauri/src/notify/` 窄模块：macOS 实现（安装并持有 delegate 强引用、
      `willPresent` 返回 banner+sound、`didReceive` 经归一化后转成进程内缓冲）；非 macOS 分支的
      逐条等待**携带整份已校验上下文**（见 2.5），不是只透传任务 id；对外只暴露安全接口（投递、
      投递后自查、授权查询 / 申请、delegate 安装）
- [ ] 1.2 在 `run()` 入口安装 delegate（`!tauri::is_dev()` 且有 bundle id 时），安装路径零 IO、零
      跨进程查询；安装失败只降级为 warning，不影响启动与投递
- [ ] 1.3 `deliver_notification` 的 macOS 分支改走本仓实现：请求 id 形状、启动窗口内的本地早退
      重试、同 id 重投、`getDeliveredNotificationIds` 自查（M620 语义）逐项保留
- [ ] 1.4 投递端口契约：`deliver_notification` 返回该条通知的 request id（现状 `Result<(),
      String>`，id 只在函数内部；非 macOS 由本仓显式指定 id 保证返回值与系统标识一致），到点与
      结果 / 失败两条路径都用它做台账键与上下文键
- [ ] 1.5 **动作归一化**：平台层把系统的 `UNNotificationDefaultActionIdentifier` 归一为内部
      `Tap`，`dismiss` / 自定义动作归一为非处置值（只落 warning）；补齐这一层是因为方案 A 删掉了
      `mac-usernotifications` + `notify-rust` 的既有转换（`lib.rs:2022-2026` 原靠它）
- [ ] 1.6 删除 `notify-rust` 的 `preview-macos-un` feature 与 `mac-usernotifications` 直接依赖，
      更新 `Cargo.toml` 的注释（说明 macOS 已自持、`notify-rust` 只服务 Linux / Windows、
      `mac-notification-sys` 仍供 dev flavour）
- [ ] 1.7 单测 / 结构断言：delegate 安装点在 `run()` 入口且先于窗口创建；dev flavour 不触 UN；
      安装失败只降级（不阻断启动与投递，且**不**声称保留 macOS 进程内点击通道）；默认动作归一化
      （把原始字符串直接交给 `Tap` 判据的写法必须判红）

## 2. 通知台账与接收判据（纯函数）

- [ ] 2.1 `cron.rs` 的 `CronState` 增加 `notices`（request id → 任务 / 种类 / 派发日期 / 会话
      标识），`#[serde(default)]`，读取纪律与 `tasks` 段一致；条目写入即快照，后续运行不改写；
      **只在 macOS 打包实例写入**（其它平台没有消费者，MUST NOT 写）
- [ ] 2.2 **到点通知路径**：台账条目与 `last_fired` 共用同一次原子替换（扩展现有 `mark_fired`
      调用点，不加第二次写）；有界裁剪（保留窗口 + 条数上限），裁剪不触碰 `tasks` 段；写失败降级
      为 warning
- [ ] 2.3 **结果 / 失败通知路径**：改 `finish` 的 `run-then-notify` 成功分支（`lib.rs:1575-1581`）
      ——投递成功后把新台账条目与当时的完整状态一次原子落盘，条目 `session_id` 与同次落盘里
      `tasks.<task>.session_id` 逐字相同；MUST NOT 出现「会话已更新、台账缺失」
- [ ] 2.4 接收判据写成纯函数，按通道分列：动作归一化 / 上下文来源（进程内 = 闭包在场；跨进程 =
      台账命中）/ 任务仍在 / 派发日期为今天，各自独立返回分类原因（`notice_unknown` /
      `task_unknown` / `notice_stale`）；不解析 request id 字符串
- [ ] 2.5 判据的**输出**是 `ClickContext { request_id, task, kind, session_id(快照), date }`，
      两个来源产出同一形状、且都派生自投递点那一次构造：① **进程内上下文表**（所有平台，按
      request id 登记；扩 `spawn_notification_click_waiter` 与 `finish` 的调用点，把种类与会话
      快照带进来，**不读台账**）；② **台账**（跨进程，仅 macOS 打包实例）。两条入口不得各自拼装、
      不得只传任务 id
- [ ] 2.6 单测：判据真值表（含任务 id 含 `-` 的用例；判据 2 按通道分别验）、上下文构造（结果 /
      失败通知带快照会话、到点通知不带）、**台账为空时进程内通道仍能构造上下文并进入处置**（不得
      报 `notice_unknown`）、两条写入路径各自的原子性判据、台账裁剪、快照不被改写、读取降级（旧
      文件读入为空台账）

## 3. 恢复流水线（守护线程 + 前端保留重放）

- [ ] 3.1 守护线程装载完成后 drain 启动期缓冲，按到达顺序处理；缓冲有界（上限 + 进程退出即丢）
- [ ] 3.2 `clicked_today` / `session_started_today` / 在途表的既有判据保持不变；把入口签名改成
      `handle_click(ctx, source, not_ready_policy)`，两个入口都传**同一份**上下文，来源与未就绪
      策略只作附加参数
- [ ] 3.3 `handle_click` 的 `run-then-notify` 分支改用 `ctx.session_id`（**MUST NOT** 再读
      `self.state.session_id(task)`，现状 `lib.rs:1704-1710`）；`kind = trigger` 分支保持既有
      同日幂等判据（那条判据回答「今天跑没跑」，不回答「点的是哪条通知」）
- [ ] 3.4 **区分度回归（状态级）**：构造「上下文快照 = A，`tasks.<task>.session_id` = B」与
      「同一任务两条台账条目各持不同会话」两种状态，断言每次恢复的都是被点那条的会话；这条用例
      必须能让「读最新会话」的实现判红（design §5.2 可达性说明：默认语义下当日端到端不可达，
      所以回归落在状态级）
- [ ] 3.5 界面未就绪时保留并在 `bridge_ready` 后重放（同任务只留最新一条，总数有上限）；被覆盖或
      进程退出时补记 `not_ready`；保留的是**整份上下文**，不是任务 id
- [ ] 3.6 前端：`handleCronRun` 的失败回执路径覆盖恢复来源（`vault_not_open` 等既有错误码照旧上屏，
      MUST NOT 新增第二套文案），并确认 dirty 前置门的三出口在恢复点击下可直接使用

## 4. 诊断与文案

- [ ] 4.1 `cron_click` 增加 `source`（`in-process` / `relaunch`）；新增 `cron_click_deferred`
      （任务、request_id、来源、闭集合 `reason`）；同步 `log_event` 字段白名单与
      `src/bindings/LogEventName.ts` 重导出（先 `git add` 重导出产物再跑门禁）
- [ ] 4.2 新增两条人话提示的 copy 条目（任务已删除 / 提醒已过期），后端只给 code + 参数
- [ ] 4.3 单测：字段白名单与事件名一致性；提示 code 在 copy 表里登记

## 5. 验收套件与真机证据

- [ ] 5.1 验收 bundle 改成 fail-closed 隔离：`CFBundleExecutable` 指向包装脚本，脚本在 `exec` 真
      二进制**之前**导出隔离的 `XDG_CONFIG_HOME` **与** `HOME`（缺 XDG 时 `config.rs:1980` 会回落
      `$HOME/.config`，两个都要）；`LSEnvironment` 若仍要加，只能作冗余加强，不得作为唯一依据
- [ ] 5.2 静态前置门（任何一次 LaunchServices 拉起之前）：断言 bundle 的 `CFBundleExecutable` 是
      包装脚本、脚本内容把两个变量都指向套件目录；不成立即判 INVALID 且不发起拉起（拉起后才知道
      就晚了——`logging::init` / vault 恢复 / cron 装载已经跑过）
- [ ] 5.3 套件动作：新增「正常退出应用」与「点击后按验收 bundle id 重新附着到新进程」两条能力
      （附着必须校验 `CFBundleIdentifier` 与二进制路径，沿用 M619/M622 的隔离口径）
- [ ] 5.4 新增场景 `scripts/acceptance/scenarios/252-cron-click-after-exit.md`（`tier: bundle`、
      `requires: bundle`），逐条覆盖 design §8.2 的判据清单（1–9；清单只在 design 维护，本文件
      不另抄一份）
- [ ] 5.5 更新 `scripts/acceptance/COVERAGE.md` 与场景索引，登记新场景及其覆盖点
- [ ] 5.6 拉起后的正向验证（不充当防线）：新进程写入的 `cron-state.json` 落在套件 `env/` 下；真实
      `~/.config/lumir` 的只读 stat（mtime / size / inode）前后无变化
- [ ] 5.7 回扫既有通知类场景（169 / 170 / 171 / 213）在新接收模型下的期望：逐条确认断言仍成立，
      需要改动的就地改准（`cron_click` 新增字段不得让既有 jsonl 断言失配）；补一条结果 / 失败通知
      的台账回归断言（`run-then-notify` 通知投递成功后台账在场、`session_id` 与 `tasks` 段一致）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `scripts/gate.sh quick` 全绿（含 docs-check 与 bindings-drift）
- [ ] 6.3 冷启动读数不退化（delegate 安装不进测量路径）：对照 `docs/specs/` 的性能测量方法学复跑
- [ ] 6.4 bundle 真机：`node scripts/acceptance/run.mjs 252` PASS，证据落 `.local/acceptance/<日期>/252-cron-click-after-exit/`
- [ ] 6.5 真机复跑 169 / 170 / 171 / 213，确认进程内点击链路零回归
- [ ] 6.6 在 `proposal.md` 的节点 2 块记录归档前五要件读数（实现完成后执行，此处仅为提醒）
