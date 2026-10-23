# Proposal: 通知送不出去时的可见面（注册告知 + 投递连续失败提示）

- Change ID: surface-cron-notify-failure
- 日期: 2026-10-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **节点 1 裁决留痕（2026-10-23，逐字）**
>
> **现场**：Lumir 正式版（`com.lumir.app`）的 cron 任务到点没有任何提醒。诊断日志
> （`~/.config/lumir/logs/2026-10-23.jsonl`）显示：注册那一刻就有一条 `config_warning`
> 「通知权限被拒绝：notify-then-run 任务无法投递，可改用 run-then-notify / silent-run」，
> 16:30 触发后每 ~30s 重试均报「macOS rejected the notification request」——全程只落日志，
> app 内零感知。
>
> **立项**：tower 提案「注册 cron 任务时若检测到通知权限被拒，在 harness 回复里明说『通知权限被拒，
> 请到系统设置打开』；投递连续失败时在 app 内给一条可见提示。」，Alex 原话「**安排。**」——
> 实现与后续批次由 tower 直接立项开工。
>
> **口径修正（2026-10-23，M636 调查定论，随本 mission 落地）**：上面提案原话里的「请到系统设置
> 打开」**不适用于本次现场**。macOS 26 的 usernotificationsd 按调用进程的代码签名身份判定通知
> 资格；`/Applications` 里的 0.9.2 只有 linker ad-hoc 签名（`Info.plist` 未绑定、TeamIdentifier
> 为空），系统认不到 `com.lumir.app` 名下，`requestAuthorization` 与 `addNotificationRequest`
> 一律被拒。系统设置里开着的两个「Lumir」条目属于另外两个签过名的身份（探针 / 旧验收副本、
> `com.lumir.app.acceptance`），与正在跑的二进制无关——让用户「去打开」是误导。因此本 change 的
> 用户可见文案按**成因分档**：身份未被认可陈述签名事实，只有系统里确有「被拒绝」记录时才引导用户
> 去系统设置。这是同一裁决内的口径细化，不改变「要明说」这个决定。

## Why

### 1. 通知送不出去，用户完全看不见

注册路径只有一条 `config_warning`（`src-tauri/src/lib.rs` 的 `ensure_notification_permission`），
投递失败每条也只进同一份诊断日志。用户在 app 里看到的只有「任务已注册」——直到某天发现提醒根本
没来过。`cron:notice` toast 通道已经存在（点击链路失败时在用），但投递失败这条路一次都没用过它。

### 2. 现有诊断把「系统没认这个客户端」误读成「用户拒绝」

`src-tauri/src/lib.rs:1851` 把 `request_auth_blocking()` 的 `Ok(false)` 一律写成「通知权限被拒绝…
可改用 run-then-notify」。M636 的定论是：`Ok(false)` 在「系统里没有本客户端的授权记录」时同样
成立（本次现场的 `authorizationStatus` 是 `NotDetermined`，不是 `Denied`）。诊断与用户可见文案
都建立在这个误读上，会把用户引向一个改了也没用的开关。

### 3. 会话里没有转达的义务，模型只会说「注册成功」

`cron-reference.md` 目前只要求「以工具回执为准说生效与否」，回执本身不携带任何通知能力信息，
模型没有理由提这件事。

## What Changes

1. **注册告知**（`cron` capability）：`cron_task_create` 的回执在「`notify-then-run` 档 + 通知送不
   出去」时携带 `notice` 字段；文案按成因分档（身份未被认可 / 用户拒绝），取注册那一刻的界面语言。
   `cron-reference.md` 增加一条「回执带 `notice` 就原样转达」的指令。
2. **判据单一化**：通知权限的申请与快照只发生在 `ensure_notification_permission` 一处；结果经
   重载回执（`ReloadOutcome::notify_permission`）回流到注册回执，注册路径不发起第二次申请。
   判据用 `authorizationStatus` 把「身份未被认可」与「用户拒绝」分开。
3. **投递连续失败提示**（`cron` capability）：连续失败次数达 3 次时经既有 `cron:notice` 通道上屏
   一条 toast，同一段连续失败只提示一次；文案在文案表里按 `code` 取值，身份成因与其它成因分档。

## Non-goals

- **不改投递链路本身**：重试预算（`NOTIFY_STARTUP_RETRY` / `NOTIFY_DELIVERY_ATTEMPTS` /
  投递后自查）与 design §5.4「失败不写 `last_fired`」全部不动。
- **不修签名问题**：安装包怎么签、要不要换 bundle id 属产品侧根治方向（M636 的报告面），本
  change 只让用户看见事实。
- **不做任务面板 / 不做通知中心页**：可见面只复用既有 toast 与工具回执。
- **不迁移既有 5 处 `cron:notice` 直传中文串**：那批文案的 i18n 收尾是独立治理，本 change 只保证
  新增的两处走文案表。
- **不动 `notify-then-run` 的默认档位**：不因为权限不可用就自动改档。

## Impact

- 影响的 specs：`cron`
- 影响的代码 / 系统：`src-tauri/src/cron.rs`（判据与文案的纯函数、连续失败计数）、
  `src-tauri/src/lib.rs`（权限快照、重载回执回流、连续失败记账与上屏）、
  `src-tauri/src/harness/tools.rs`（注册回执字段）、
  `src-tauri/src/harness/prompts/cron-reference.md`（转达指令）、
  `src/copy-data.ts` + `src/copy.ts`（`cron:notice` 按 code 取值）、`src/main.ts`（订阅）、
  `文案-Copy.md`（D551–D554）。
- 关联约束：ui-language（「Rust 侧错误只带 `code` + `params`」；D551/D552 是 D321 同款的
  「后端持有」例外，理由写进 deck 设计意图列）；REVIEW.md「同一语义两处真源」条（判据与文案
  各自只有一处）。
- 已知边界：验收副本（`com.lumir.app.acceptance`）的签名身份被系统认可，「身份未被认可」的分支
  在真机验收里无法复现——该分支只由 Rust 单测覆盖，如实登记（见 tasks 的验证分组）。
