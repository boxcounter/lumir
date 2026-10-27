# Tasks: add-cron-notification-relaunch

> 本 change 目前只到**节点 1（提案评审）**：下面全部保持未勾选，提案通过后才进入实现。

## 1. macOS 通知平台层（自持）

- [ ] 1.1 新增 `src-tauri/src/notify/` 窄模块：macOS 实现（安装并持有 delegate 强引用、
      `willPresent` 返回 banner+sound、`didReceive` 转成进程内缓冲）、非 macOS 透传既有
      `notify-rust` 逐条等待；对外只暴露安全接口（投递、投递后自查、授权查询 / 申请、delegate 安装）
- [ ] 1.2 在 `run()` 入口安装 delegate（`!tauri::is_dev()` 且有 bundle id 时），安装路径零 IO、零
      跨进程查询；安装失败只降级为 warning，不影响启动与投递
- [ ] 1.3 `deliver_notification` 的 macOS 分支改走本仓实现：请求 id 形状、启动窗口内的本地早退
      重试、同 id 重投、`getDeliveredNotificationIds` 自查（M620 语义）逐项保留
- [ ] 1.4 删除 `notify-rust` 的 `preview-macos-un` feature 与 `mac-usernotifications` 直接依赖，
      更新 `Cargo.toml` 的注释（说明 macOS 已自持、`notify-rust` 只服务 Linux / Windows、
      `mac-notification-sys` 仍供 dev flavour）
- [ ] 1.5 单测 / 结构断言：delegate 安装点在 `run()` 入口且先于窗口创建；dev flavour 不触 UN

## 2. 通知台账与接收判据（纯函数）

- [ ] 2.1 `cron.rs` 的 `CronState` 增加 `notices`（request id → 任务 / 种类 / 派发日期 / 会话
      标识），`#[serde(default)]`，读取纪律与 `tasks` 段一致
- [ ] 2.2 台账写入与 `last_fired` 共用同一次原子替换；有界裁剪（保留窗口 + 条数上限），裁剪不触碰
      `tasks` 段；写失败降级为 warning
- [ ] 2.3 接收判据写成纯函数：tap 动作 / 台账命中 / 任务仍在 / 派发日期为今天，四条独立返回分类
      原因（`notice_unknown` / `task_unknown` / `notice_stale`）；不解析 request id 字符串
- [ ] 2.4 单测：判据真值表（含任务 id 含 `-` 的用例）、台账裁剪、读取降级、旧文件读入为空台账

## 3. 恢复流水线（守护线程 + 前端保留重放）

- [ ] 3.1 守护线程装载完成后 drain 启动期缓冲，按到达顺序处理；缓冲有界（上限 + 进程退出即丢）
- [ ] 3.2 接受的点击复用 `handle_click` 的既有处置（聚焦 → vault → 运行 / 会话恢复），只多一个
      来源参数；重复 / 并发点击落到既有 `clicked_today`、`session_started_today`、在途表判据
- [ ] 3.3 界面未就绪时保留并在 `bridge_ready` 后重放（同任务只留最新一条，总数有上限）；被覆盖或
      进程退出时补记 `not_ready`
- [ ] 3.4 前端：`handleCronRun` 的失败回执路径覆盖恢复来源（`vault_not_open` 等既有错误码照旧上屏，
      MUST NOT 新增第二套文案），并确认 dirty 前置门的三出口在恢复点击下可直接使用

## 4. 诊断与文案

- [ ] 4.1 `cron_click` 增加 `source`（`in-process` / `relaunch`）；新增 `cron_click_deferred`
      （任务、来源、闭集合 `reason`）；同步 `log_event` 字段白名单与
      `src/bindings/LogEventName.ts` 重导出（先 `git add` 重导出产物再跑门禁）
- [ ] 4.2 新增两条人话提示的 copy 条目（任务已删除 / 提醒已过期），后端只给 code + 参数
- [ ] 4.3 单测：字段白名单与事件名一致性；提示 code 在 copy 表里登记

## 5. 验收套件与真机证据

- [ ] 5.1 探针：被 LaunchServices 拉起的验收实例如何拿到套件的 `XDG_CONFIG_HOME`
      （`Info.plist` 的 `LSEnvironment` 优先，不成立则用包装可执行文件 `exec` 真二进制）；
      判据 = 拉起后的进程写入的是套件 `env/` 下的 `cron-state.json`，不是用户真实配置目录
- [ ] 5.2 套件动作：新增「正常退出应用」与「点击后按验收 bundle id 重新附着到新进程」两条能力
      （附着必须校验 `CFBundleIdentifier` 与二进制路径，沿用 M619/M622 的隔离口径）
- [ ] 5.3 新增场景 `scripts/acceptance/scenarios/252-cron-click-after-exit.md`（`tier: bundle`、
      `requires: bundle`），覆盖 design §8.2 的七条判据：跨进程运行全链路、仅拉起不点击的负向
      控制、重复点击、删除任务、跨天、台账外 request id、结果通知的会话恢复
- [ ] 5.4 更新 `scripts/acceptance/COVERAGE.md` 与场景索引，登记新场景及其覆盖点
- [ ] 5.5 回扫既有通知类场景（169 / 170 / 171 / 213）在新接收模型下的期望：逐条确认断言仍成立，
      需要改动的就地改准（`cron_click` 新增字段不得让既有 jsonl 断言失配）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `scripts/gate.sh quick` 全绿（含 docs-check 与 bindings-drift）
- [ ] 6.3 冷启动读数不退化（delegate 安装不进测量路径）：对照 `docs/specs/` 的性能测量方法学复跑
- [ ] 6.4 bundle 真机：`node scripts/acceptance/run.mjs 252` PASS，证据落 `.local/acceptance/<日期>/252-cron-click-after-exit/`
- [ ] 6.5 真机复跑 169 / 170 / 171 / 213，确认进程内点击链路零回归
- [ ] 6.6 在 `proposal.md` 的节点 2 块记录归档前五要件读数（实现完成后执行，此处仅为提醒）
