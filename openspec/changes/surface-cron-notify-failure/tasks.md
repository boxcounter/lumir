# Tasks: surface-cron-notify-failure

> **实现范围**：`src-tauri/src/cron.rs`、`src-tauri/src/lib.rs`、
> `src-tauri/src/harness/tools.rs`、`src-tauri/src/harness/prompts/cron-reference.md`、
> `src-tauri/src/commands.rs`（`current_ui_language` 提为 `pub(crate)`）、`src/copy-data.ts`、
> `src/copy.ts`（`cronNoticeText` 取值口）、`src/main.ts`（`cron:notice` 订阅）、`文案-Copy.md`、
> 本 change 目录。
>
> **前置**：节点 1 已过（Alex 2026-10-23 原话「安排。」，口径按 M636 定论细化为两档成因，见
> [proposal.md](proposal.md) 的裁决留痕）。
>
> **裁决口径**：判据只有一处（守护线程申请一次，回执回流）；注册告知走工具回执由模型转达；
> 投递连续失败走既有 toast；文案全部进 deck（中英双档）。

## 1. 判据（`src-tauri/src/cron.rs`）

- [x] 1.1 `NotifyPermission` 四档（`Granted` / `Denied` / `Unrecognized` / `Unknown`）+
  `blocks_delivery()`；档位含义与 M636 机制写进类型文档注释。
- [x] 1.2 `ReloadOutcome` 增加 `notify_permission` 字段（重载回执回流，注册路径不二次申请）。
- [x] 1.3 `notify_permission_notice(permission, language)`：两档成因 × 两语言的四句；
  `Unrecognized` 档 MUST NOT 出现「系统设置」引导。
- [x] 1.4 `registration_notice(delivery, permission, language)`：只有 `notify-then-run` ×
  「送不出去」出句。
- [x] 1.5 `delivery_failed_code(permission)`：身份档 / 通用档两个 code。
- [x] 1.6 `CronCreateOutcome` 增加 `notice: Option<&'static str>`。

## 2. 权限探测（`src-tauri/src/lib.rs`）

- [x] 2.1 `NOTIFY_PERMISSION: OnceLock<NotifyPermission>` + `probe_notification_permission()`：
  `request_auth_blocking()` 之后读 `get_notification_settings_blocking()`，按 `authorizationStatus`
  区分用户拒绝与身份未被认可（判据表见 design §3）。
- [x] 2.2 `config_warning` 两档措辞：身份档陈述「系统未认可当前 Lumir 的通知身份（安装包缺少
  有效签名，系统设置里的 Lumir 条目属于其它身份）」，拒绝档沿用原句。
- [x] 2.3 `cached_notification_permission()`：只读快照，不发起申请（投递失败时选措辞用）。
- [x] 2.4 `apply_reload` 的三种出口都填 `notify_permission`（成功路径补检读数、失败 / 空任务集
  为 `Unknown`）。
- [x] 2.5 `CronToolPort::reload_effect` 返回三元组，`create` 用 `cron::registration_notice` 填
  `notice`。

## 3. 投递连续失败（`src-tauri/src/lib.rs` + `src-tauri/src/cron.rs`）

- [x] 3.1 `cron::NotifyFailureStreak` + `NOTIFY_FAILURE_NOTICE_AFTER = 3`：达阈值返回次数且一段
  连续失败只返回一次；成功清零。
- [x] 3.2 `CronRunner` 持有计数；`Plan::Notify` 与 `run-then-notify` 的结果投递两条路径都记账。
- [x] 3.3 `note_notify_failure`：达阈值时落一条 `config_warning` 并经 `notice_code` 上屏
  （按快照选 code，params = `{count}`）。
- [x] 3.4 `notice_code()` 新通道（`{code, params}`）；既有 `notice()` 的 5 个调用点不动。

## 4. 回执与提示词（`src-tauri/src/harness/{tools.rs,prompts/cron-reference.md}`）

- [x] 4.1 `cron_task_create` 回执在 `notice` 在场时写入该字段；缺席时回执里没有这个键。
- [x] 4.2 `cron-reference.md` 增加转达义务（原样转达、不得省略或弱化）。

## 5. 文案（`文案-Copy.md` + `src/copy-data.ts` + `src/copy.ts`）

- [x] 5.1 deck 新增 D551–D554（注册告知两档 + 连续失败 toast 两档），设计意图列写明消费者与
  两档分开的理由（编号在 rebase 到含 M631 的 master 时由 D548–D551 顺延，M631 已占 D548–D550）。
- [x] 5.2 `copy-data.ts` 四条 `COPY` 条目 + `CRON_NOTICE_COPY` 两个 code 映射。
- [x] 5.3 `copy.ts` 的 `cron:notice` 取值口 `cronNoticeText`：有 `code` 走文案表，否则回落
  `message`（`main.ts` 只留订阅与空串不上屏的守卫）。

## 6. 验证

- [x] 6.1 Rust 单测：`registration_notice` 档位矩阵、`notify_permission_notice` 两档措辞区分、
  `delivery_failed_code` 分档、`NotifyFailureStreak` 阈值与「一段只提示一次」、
  `cron_task_create` 回执 `notice` 在场 / 缺席。
- [x] 6.2 文案漂移门禁：`pnpm test` 的 copy 用例（deck ↔ 表全量、占位名按位置归一）。
- [x] 6.3 `openspec validate --all --strict` 通过。
- [x] 6.4 `scripts/gate.sh quick` 全绿（附 `GATE RESULT` 原文行）。
- [x] 6.5 已知边界登记：真机验收副本的签名身份被系统认可，「身份未被认可」与「用户拒绝」两支
  无法在验收副本复现，只做静态校验（见 [design.md](design.md) §7）。**本 change 不新增验收场景**
  ——场景只能用 mock provider 驱动，而这两支的输入（系统授权状态）不在 App 可控面内；等出现可注入
  权限态的手段再补，避免新增一条跑不真的场景让套件腐化。
