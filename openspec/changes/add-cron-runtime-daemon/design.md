# Design: add-cron-runtime-daemon

> 技术设计只回答「怎么落」；「为什么改」「不做什么」见 [proposal.md](proposal.md)。
> 两个新原语：`cron`（时间触发 + 通知 + 点击唤起）与 `note-templates`（模板定义 / 实例化 / 打开）。
> 依赖方向是单向的：cron 引用模板 id；模板模块 MUST NOT 读 cron 配置、MUST NOT 知道 cron 存在。

## 1. 形态总览

```
            ┌─────────────────────── 触发源（cron 侧） ────────────────────────┐
            │  ① 进程内定时器（每 30s tick，到点判定）                           │
            │  ② 拉取兜底（启动就绪后一次 / 主窗口每次获得焦点）                  │
            └───────────────────────────────┬────────────────────────────────┘
                                            │ 同一个判定函数
                                            ▼
                      check(task, template, vault_root, now, state) -> Decision
                        ├─ NotDue / Satisfied / Notify{task}   （纯逻辑，注入 exists/now）
                        │
             Notify ────┴──► 通知投递（macOS 通知中心；extra 携带 task id）
                                            │ 用户点击（actionId = "tap"）
                                            ▼
                      点击链路：聚焦窗口 → 确保实例存在 → 发前端事件打开
                                            │
                                            ▼
                 note-templates：resolve_path → exists? →（否）O_EXCL 创建 → 打开 + 可选草稿预载
```

`note-templates` 的实例化与打开也能被独立调用（命令），不经过 cron——这是「独立原语」的落点。

## 2. 单一判定函数

判定分两层，**两个触发源都只走 `check`**：

```rust
// src-tauri/src/cron.rs —— 无 tauri 依赖、无文件 IO（存在性由调用方探测后传入）
pub struct CheckInput<'a> {
    pub task: &'a CronTask,
    pub template: &'a NoteTemplate,
    pub vault_root: &'a Path,
    pub now: LocalNow,          // { date: "YYYY-MM-DD", weekday, minutes_since_midnight }
    pub notified_on: Option<&'a str>,
}

pub enum Decision { NotDue, Satisfied, Notify }

/// 纯函数：truth table 见 §9；不读时钟、不碰磁盘。
pub fn decide(input: &CheckInput, instance_exists: bool) -> Decision;

/// 唯一入口：做一次 metadata 探测，再调 decide。
pub fn check(...) -> (Decision, ResolvedPath);
```

判据（与 proposal 的「同一判定函数」一致）：

```
due        = today ∈ task.days && now.minutes_since_midnight >= task.at_minutes
satisfied  = instance_exists(vault_root / resolved(template.path, date = today))
notified   = state.last_notified(task.id) == today
Decision   = NotDue    if !due
             Satisfied if satisfied
             Notify    if !satisfied && notified_on != today
             Satisfied if !satisfied && notified_on == today   ← 当日已通知，静默
```

- 判定 MUST NOT 写盘：判定只读（`metadata` 一次）。建文件只发生在点击链路与独立命令里。
- `notified_on == today` 时返回 `Satisfied` 而不是单独一个 `AlreadyNotified`——对两个触发源来说它的
  后果相同（什么都不做）；语义上「今天不用再打扰了」就是终态。日志里另记原因（§11）。
- **既没有独立条件表达式，也没有第二份判定**：条件由「模板当日实例路径是否存在」推出；cron 与
  模板之间没有回写、没有事件订阅，只有一次性路径解析。

## 3. 触发源与线程模型

### 3.1 定时器

一个专用线程 `lumir-cron`，启动于 setup 末尾（窗口已显示、`ready` 已发出之后）：

```
loop {
    recv_timeout(tick = 30s)     // 或收到 poke 立即醒
    for task in snapshot.tasks { let d = check(...); if d == Notify { deliver(task) } }
}
```

- **周期评估零文件 IO**：tick 只做本地时钟比较；到期任务的 `metadata` 探测是每任务每 tick 一次
  （单用户日常任务量 1–3 条，代价可忽略）。
- **装载时读一次配置**：任务与模板在启动装载时快照，运行期不热重载（与 `editor.mode` /
  `ui.markdown_line_numbers` 同口径）。改任务需重启，写入 `config-reference.md` 的「生效时机」列。
- **休眠 / 唤醒**：`std::thread::sleep` 在系统休眠期间停摆，唤醒后下一次 tick 立刻把「已过点」判出来
  ——同一判定函数，无需专门处理。
- **启动不阻塞**：线程在 setup 返回前 `spawn` 即返回，不做同步 IO；冷启动 <300ms 合同不受影响
  （ADR 0002 第 6 条）。

### 3.2 拉取兜底

两个时机，共用一个 `poke` 通道（不阻塞事件循环、不在回调里做 IO）：

| 时机 | 落点 | 行为 |
|---|---|---|
| 启动就绪后一次 | `lib.rs` setup 尾部（与 `start_restore` 同层级，`ready` 之后） | 向 `lumir-cron` 投一次 `poke`，线程内跑同一 `check` 循环 |
| 主窗口获得焦点 | `RunEvent::WindowEvent` 的 `WindowEvent::Focused(true)` | 投一次 `poke`；同一焦点事件在 200ms 内的重复投递合并（防抖，避免切窗风暴反复 stat） |

补判语义由 §2 的判据自动覆盖：已过点 + 未满足 + 当日未通知 ⇒ 补发一次；当日已通知 ⇒ 静默；
未到点 ⇒ 不动作；已满足 ⇒ 不动作（**不写盘**）。

### 3.3 时间口径

- **本地时间**：`chrono::Local`（`chrono` 已在依赖树内，作为直接依赖引入，仅用 `clock` 能力）。
  Rust core 此前没有本地时区来源（`logging.rs` 明确选 UTC），本 change 是第一个需要本地墙上时钟的
  模块——本地日期用于「今天」、本地时分用于「到点」、本地日期也用于去重。
- **判据形态**：「本地时钟越过 `at`」而不是「恰好等于 `at`」。tick 抖 30s、机器休眠、应用晚启动
  都不影响正确性。
- **DST**：跳过的小时 → 下一次 tick 即为已过点（行为正确）；重复的小时 → 当日去重挡住第二次。
- **跨日不补发**：00:00 后「今天」变成新日期，昨日错过的提醒不补——提醒的意义在当天。
- **时钟回拨**：本地日期倒退时保留既有 `last_notified`，最多抑制当天通知（保守方向），不删除记录。

## 4. 通知与点击链路（独立功能点）

「发通知」和「点击后进入环境」是两条链路，后者不是前者的附属：通知只是把人带回来的入口，点击后
的聚焦、建环境、打开文件、预载草稿四步各有失败模式。

### 4.1 依赖与权限

- 用 [`tauri-plugin-notification`](https://docs.rs/tauri-plugin-notification/latest/tauri_plugin_notification/)
  **Rust 侧 API**：`NotificationExt::notification()` 投递，`Notification::on_action` 接点击。
  桌面端点击回调自 **2.6.0（2026-10-10）** 起可用（[插件 changelog](https://v2.tauri.app/release/notification/)：
  「a click on a notification (`tap`) … reaches `onAction` and the new Rust `Notification::on_action`」），
  因此 `Cargo.toml` 固定 `tauri-plugin-notification = "2.6"` 下限。
- **不走 JS 侧**：Rust 侧调用不经 webview ACL，`src-tauri/capabilities/default.json` 零增量；也避免
  把「点击监听必须早于通知投递」这件事交给前端生命周期（见 4.3）。
- **权限**：启动装载时若有至少一条有效任务 → 查权限；未决定 → 申请一次（系统弹窗）。被拒 →
  一条人话 warning + 不投递通知；MUST NOT 每次启动反复弹窗（系统本身也只弹一次），也 MUST NOT
  因此禁用任务判定与模板入口。
- macOS 上通知由系统通知中心呈现；其它平台的呈现不在本 change 的验收面内（插件跨平台，但只有
  macOS 进真机验收）。

### 4.2 投递

- 内容：标题 = 任务可读名（如「daily log」），正文 = 「今天的 `<目标文件名>` 还没建」。
  MUST NOT 含文档正文，MUST NOT 含 vault 绝对路径（通知可能出现在锁屏与通知中心）。
- `extra` 携带 `{"task": "<task id>"}`，点击回调据此反查任务；这是任务身份的唯一传递通道
  （不靠标题字符串匹配）。
- 投递成功即写去重状态（§5.4）。投递失败（权限、插件错误）→ 诊断事件 + 不写状态（下次 tick 会
  再试一次；不会在一分钟内形成风暴——tick 间隔即最小重试间隔）。

### 4.3 点击监听的生命周期

插件语义：桌面端点击只在「通知投递时已有监听器」的通知上可上报。因此：

- `on_action` 在应用启动时注册**一次并常驻**，MUST NOT 按需注册 / 注销。
- 回调里只做「反查任务 + 投递一个工作项到 `lumir-cron` 线程」，重活（建文件、聚焦、打开）在线程上
  做，不在回调里阻塞平台回调线程。
- macOS 上点击通知本体上报的 `actionId` 是 `"tap"`；本 change 只处理 `"tap"`，其它 action 忽略并
  落一条诊断事件（v1 没有动作按钮，见 proposal Non-goals）。

### 4.4 唤起与进入环境（点击后的四步）

1. **聚焦**：`window.show()`（若隐藏）→ `window.unminimize()`（若最小化）→ `window.set_focus()`。
   `set_focus` 在 macOS 上做 makeKeyAndOrderFront，与 `lib.rs` 启动路径同一条既有接法。
2. **确保环境存在**：调 `note_templates::ensure_instance(task.vault, template, today)`——
   不存在则 `O_EXCL` 创建，已存在则 no-op（§6.2）。**点击时刻重跑判定**：文件已被自己建好时只打开，
   不重建、不改写。
3. **打开**：向 webview 发 `note-template:open` 事件，载荷
   `{vault, path, prompt, created}`；前端是唯一的打开实现（见 4.5）。
4. **预载草稿**：`prompt` 在场时，前端用既有 `harness_draft_put` 写入该 vault 的 composer 草稿；
   MUST NOT 自动发送（不产生无人点头的模型调用）。

失败模式（全部落诊断事件，能出声的人话提示不静默）：

| 失败 | 表现 | 处置 |
|---|---|---|
| 目标 vault 目录不可达 / 未注册 | 无法解析实例路径 | 人话通知/提示「目标笔记库不可用」，点击事件落 `cron_open` 且 `ok=false` |
| 目标路径不可写（权限 / 只读卷） | 建文件失败 | 保留半截文件清理（§6.2），提示 + 诊断 |
| webview 已销毁（极窄窗口） | 事件发不出去 | 只落诊断；不重试、不排队（下次点击还有机会） |
| 目标 vault 未打开 | 前端没有该 vault 的标签上下文 | 前端先走既有 vault 打开链路（`vault_open_path`），成功后再开文件；失败即人话提示 |

### 4.5 前端打开链路（唯一一份）

`note-template:open` 的处理器只有一处（`src/main.ts` 的启动装配处），两个来源共用：

- 来源 A：cron 点击链路（Rust 发事件）；
- 来源 B：`note_template_open` 命令（独立入口，§6.3）。

处理器职责：必要时打开目标 vault → 用既有「打开文件」链路开标签 → `prompt` 在场时预载草稿。
MUST NOT 自带第二条 `vault_create_file` 或第二条「打开文件」实现。

## 5. 配置面（配置即数据）

### 5.1 形状

```json
{
  "note_templates": {
    "daily-log": {
      "path": "daily/{{date}}.md",
      "body": [
        "---",
        "date: {{date}}",
        "---",
        "",
        "## 记录",
        "",
        "## 反思",
        ""
      ],
      "prompt": "读一遍今天的 daily log，把散点收敛成三条结论。"
    }
  },
  "cron": {
    "tasks": [
      {
        "id": "daily-log",
        "vault": "/path/to/daily-vault",
        "at": "21:00",
        "template": "daily-log"
      }
    ]
  }
}
```

（`/path/to/daily-vault` 是占位符；真实路径按仓库信息卫生纪律不入库，daily vault 由 Alex 已建。）

两节都是**结构化表**：整表错形状（如 `"cron": "daily-log"`）走既有解析模型的**整文件回落**；
表内**逐项**校验（`[harness].permissions` / `vault.ignore` 先例）：坏一项只丢那一项 + 一条人话
warning，其余照常生效。

### 5.2 `[note_templates]` 校验

| 字段 | 合法 | 非法处置 |
|---|---|---|
| 模板 id（键） | 非空、无空白、无首尾空白 | 丢该项 + warning |
| `path` | 非空字符串；vault 相对路径（非绝对、不含 `..`、不以 `/` 结尾）；可含 `{{date}}` | 丢该项 + warning |
| `body` | 字符串数组（可为空数组） | 丢该项 + warning |
| `prompt` | 可选；字符串 | 非字符串 → **丢 prompt、保留模板** + warning（模板本身仍可用） |

- 未知 `{{…}}` 占位符：装载时一条 warning（提示拼错），正文原样保留、不丢项——模板正文里出现
  花括号是合法内容，代码 MUST NOT 替用户改写。
- 缺席 `note_templates` = 空表 = 模板原语不可用（调用即人话错误），不告警。

### 5.3 `[cron]` 校验

| 字段 | 合法 | 非法处置 |
|---|---|---|
| `tasks` | 数组 | 非数组 / 整节错形状 → 整文件回落（serde 期） |
| `id` | 非空、无空白 | 丢该项 + warning；**重复 id** 保留首项、丢后项 + warning |
| `vault` | 绝对路径字符串 | 非绝对 → 丢该项 + warning（路径是否存在不在此判定：装载期 stat 会拖慢启动，且外置盘可能后挂载） |
| `at` | `HH:MM`，`00:00`–`23:59` | 非法 → 丢该项 + warning |
| `template` | 指向 `note_templates` 已定义的 id | 悬空引用（含模板被校验丢弃的情形）→ 丢该项 + warning——悬空任务到期也无从判定 |
| `days` | 可选；`mon`/`tue`/`wed`/`thu`/`fri`/`sat`/`sun` 的非空数组，缺省 = 全周 | 含非法值 / 空数组 → 丢该项 + warning |
| 未知字段 | 忽略（config.rs 既有向前兼容口径） | — |

- 与「允许空表」一致：`"tasks": []` ⇒ 守护空转、零报错。
- 一条 warning 一条原因：一项任务只报第一处问题（与 `vault.ignore` 先判名字的口径同族），避免同一项
  刷出三行噪音。
- 消费者（REVIEW.md「值或开关声明了却没有消费者」条）：`id` → 去重状态与诊断事件；`vault` +
  `template` → 判定与实例化；`at` / `days` → 调度；`path` / `body` → 实例化；`prompt` → 点击后草稿预载。

### 5.4 去重状态文件

`<config>/cron-state.json`（配置目录根下，与 `window-state.json` / `vault-sessions/` 同级）：

```json
{
  "version": 1,
  "tasks": {
    "daily-log": { "last_notified": "2026-10-18" }
  }
}
```

- **为什么不进 `config.json`**：这是易变运行状态，不是用户声明；`config.json` 只承载声明（与
  `window-state.json` 的裁决同理由）。
- 写入：tmp + rename 原子替换；只在投递成功后写；写失败降级 warning（会多一次重复通知，接受）。
- 读取：文件缺失 / 不可读 / 非合法 JSON / `version` 不符，四类一律视为「无状态」（最多重复通知一次），
  不抛错、不阻断启动；缺失是常态不告警，其余三类各一条 warning。
- 任务从配置删掉后，其状态记录惰性残留（不主动清理——无消费者、无体积问题）。

## 6. 模板机制（独立原语）

### 6.1 定义与占位符

- 占位符只有 `{{date}}`：本地日期 `YYYY-MM-DD`。`path` 与 `body` 同规则替换。
- 不提供格式化 DSL、不做 `{{time}}` / `{{weekday}}`（proposal Non-goals）。

### 6.2 实例化（`ensure_instance`）

```
1. 解析相对路径：path 里替换 {{date}} → 拼到 vault 根 → 走 fs_io 的 vault 内路径边界校验
   （拒绝绝对路径、`..`、越界；软链解析后仍须在 vault 内）
2. 目标存在（含目录、符号链接、iCloud 占位文件）→ 返回 Exists，MUST NOT 读写任何字节
3. 缺失父目录 → 逐级创建（首次用 daily vault 时 `daily/` 可能还不存在）
4. body 以 "\n" 连接、末尾补一个 "\n"，OpenOptions::create_new(true) 写入（O_EXCL）
5. 写失败 → 删除本次已创建的文件（不留半截）→ 人话错误信封
```

- **绝不覆盖**：ADR 0003 第 3 条铁律的落点；`create_new` 由内核保证，不靠「先 stat 再写」的竞态窗口。
- **幂等**：同一模板同日调用 N 次，第 2..N 次不写盘（内容与 mtime 逐字节不变）。
- 实例化的输入只有 `(vault_root, template, date)`——没有 cron、没有调度、没有通知概念。

### 6.3 独立打开入口

命令 `note_template_open({ template_id, vault? })`：

- `vault` 省略 → 当前打开的 vault；显式给 → 目标 vault（点击链路走这一支）。
- 行为：`ensure_instance` → 返回 `{ path, created }` 并触发前端 `note-template:open`（与点击链路同一
  事件、同一处理器）；`prompt` 在事件载荷里。
- 与 cron 的关系：cron 点击链路复用 `ensure_instance` + 同一事件，**不新增第二条打开/预载实现**。
- 模板在无 cron 任务、通知权限被拒、通知插件未装载时同样可用（独立原语的验收判据）。

## 7. 首场景：daily log 每日 21:00（端到端时序）

配置 = §5.1 的样例（任务 `daily-log`，`at = "21:00"`，daily vault，模板 `daily/{{date}}.md`）。

| 时刻 | 触发源 | 判定 | 结果 |
|---|---|---|---|
| 20:59 | tick | `!due` | 无动作 |
| 21:00:14 | tick | due + 未满足 + 未通知 | 投递通知；状态写 `2026-10-18` |
| 21:04 | 用户点击通知 | 点击链路 | 聚焦 → 建 `daily/2026-10-18.md`（frontmatter + 小节）→ 开标签 → 草稿预载 prompt |
| 21:05 / 22:30 | 切前台 / tick | `satisfied` | 无动作、无写盘 |
| 次日 09:00 | 启动 | 未到点 | 无动作（不补发昨日） |
| 次日 21:00 | tick（应用未运行） | — | 无触达（运行时守护边界）；次日启动时若已过点 → 补发一次 |

## 8. 分层、依赖与性能

- **无 tauri 依赖**（ADR 0002 第 7 条）：
  - `src-tauri/src/cron.rs`：任务/模板数据类型（或从 `config.rs` 借用）、`decide` / `check`、`at` 与
    `days` 解析、状态文件读写、tick 常量。
  - `src-tauri/src/note_templates.rs`：路径解析、占位符替换、`ensure_instance`（复用 fs_io 的路径
    边界与错误类型）。
  - `src-tauri/src/lib.rs`：唯一 tauri 接线层——线程启动、poke 通道、通知投递、点击回调、窗口聚焦、
    前端事件。副作用以闭包/回调形式注入，判定模块不知道通知或窗口存在。
- **依赖新增**：`tauri-plugin-notification`（2.6+）、`chrono`（本地时间；锁文件已在树内）。
  两者都不经 webview，capabilities 零增量。
- **性能**：setup 内只 spawn 线程（微秒级）；tick 30s 一次、纯内存比较；到期一次 `metadata`；
  状态文件只在通知成功时写（一天一次）；通知权限查询一次。冷启动 / keypress-to-paint 合同无接触面。
- **日志**：`cron_notified` / `cron_open` / `cron_task_invalid` 三个事件名进 `logging::LogEventName`
  白名单（字段值上限 256 字符的隐私护栏不变）。日志日期口径仍是 UTC（不改 `logging.rs` 的既有裁决）。

## 9. 测试矩阵（机器验收面）

**单元（`cron.rs`，注入 `now` / `exists`，不碰系统时区）**

- truth table：`due × satisfied × notified_today` 八格逐一断言（§2 的判据）。
- `days` 过滤：`days = [wed]` 在周二 / 周三的判定。
- `at` 解析：`00:00` / `23:59` / `24:00` / `9:5` / `21:60` / 带空格 / 缺冒号。
- 跨日：昨日 23:59 与今日 00:01 的日期切换、「跨日不补发」。
- DST 形态用注入的「本地分钟数」构造，不依赖运行机时区。
- 状态文件：缺失 / 损坏 / version 不符 → 无状态 + warning；原子写后内容可回读。
- 配置校验：§5.2 / §5.3 每个非法形态各一条用例，断言「丢该项 + 其余生效 + warning 文案」。

**单元（`note_templates.rs`）**

- 首次创建：路径占位符替换、body 逐字节（`\n` 连接 + 末尾换行）。
- 二次调用：内容与 mtime 不变（幂等）。
- 父目录自动创建；非法路径（绝对 / `..` / 越界）拒绝；写失败不留半截文件。

**契约（`lib.rs` 接线层，可测的部分）**

- `note-template:open` 载荷形状（vault / path / prompt / created）。
- 日志白名单接受三个新事件名。

**真机验收（`scripts/acceptance/scenarios/`，新增；通知到达与点击唤起的验证法）**

到点触发靠「把 `at` 写成下一次分钟边界」实现，不需要时间注入 API；拉取触发靠「`at` 写今日已过
时刻 + 清空 `cron-state.json`」实现。

| 场景 | 步骤 | 断言 |
|---|---|---|
| cron 到点通知 + 点击建环境 | 隔离 `XDG_CONFIG_HOME` 写入模板与任务（`at` = 下一分钟）；清状态；起 app；等过点 + 余量 | ① 到点前/后目标文件均不存在（判定不写盘）；② `cron-state.json` 出现今日 `last_notified`；③ 截图证据：通知横幅在场（`shot`）；④ 经 KimiCU 按截图坐标点击横幅本体 → `ax` 断言窗口在前台、目标标签打开；⑤ `file` 断言实例内容（日期 frontmatter + 小节）；⑥ 再次点击 → 文件 mtime 不变（不覆盖） |
| 启动补判 | 同配置但 `at` = 今日已过（如 `00:01`）；清状态；起 app | 启动后 `cron-state.json` 写今日、截图有横幅；`restart` 后不再产生第二条（状态去重） |
| 已满足不通知 | seed 今日实例文件；`at` 已过；清状态；起 app 后切前台 | `cron-state.json` 不出现今日记录、无新横幅；文件 mtime / 内容不变 |
| 模板独立入口 | 配置只有模板、**没有** cron 任务；起 app 后调用独立入口两次 | 首次创建成功并开标签；第二次不写盘、只打开；全程无通知 |

**通知点击的验证边界（如实写进场景注释）**：通知横幅属系统进程（不在 Lumir 的 AX 树里），`ax`
读不到；主判据是「KimiCU 按截图定位的坐标点击横幅 → 应用内行为可被 `ax` / `file` 断言」。KimiCU
以系统通知中心进程为目标的点击能力是实现期的工具面未知数，需先核实；若系统横幅位置在跑批环境
不稳定（焦点切换导致横幅收进通知中心），场景降级为「点开通知中心再点」并保留截图；仍不可自动化时，
场景标 INVALID 并按 README 口径报运行无效，不伪造 PASS。dev flavour（`pnpm tauri dev` 直接 exec
二进制）下 macOS 通知权限/投递可能不可用（未签名的非 bundle 进程）——实现期先验证；不可用则改用
打包 `.app` 实例跑该场景，并在场景证据里写明 flavour。

## 10. 已知边界与风险

- **dev flavour 通知可用性（实现期第一验证项）**：未签名 / 非 bundle 进程在 macOS 上可能拿不到通知
  授权或投递失败。若 `pnpm tauri dev` 不可用：用 `cargo build --features custom-protocol` 后的
  bundle 验证；两者都不可用则停下上报（不得以「跳过通知验证」结项）。
- **点击上报的平台口径**：插件文档写明桌面端点击「as far as the notification server reports it」，
  且只对「投递时监听器已在场」的通知上报。我们启动即常驻监听，覆盖自身投递的通知；不保证覆盖
  系统层面的边缘形态（如用户在通知中心里隔很久再点）。
- **应用退出后的残留通知**：进程已退出时点击通知最多把 app 拉起来，没有 app 内任务上下文
  （不会自动打开环境）。与「应用未运行无触达」是同一类边界。
- **多机重复**：iCloud 同步的 vault 在每台 Mac 上各自判定与通知；不做跨机去重。
- **iCloud 占位文件**：目标路径存在但内容未下载时按「已存在」处理（不创建、不覆盖），可能表现为
  「判定已满足但打开是空」。这是「绝不覆盖」的代价，接受并如实记录。
- **配置不热重载**：改任务 / 模板需重启（与既有配置口径一致）。
- **权限被拒 = 提醒链路失效**：判定照常运行但无法投递；此时反向扳机会把「零使用」判出来——
  这正是扳机要覆盖的一类失败。
- **任务量假设**：tick 每任务一次 `metadata`；任务量在几十条以内无感，本 change 不为此做索引。

## 11. 观测与反向扳机度量

诊断事件（`logging.rs` 白名单，本地 JSONL，不外发）：

| 事件 | 时机 | 字段（≤256 字符） |
|---|---|---|
| `cron_notified` | 通知投递成功 | `task`（id）、`at`、`trigger`（`timer` / `startup` / `focus`） |
| `cron_open` | 点击链路或独立入口完成 | `task`（无任务记空）、`created`（`true`/`false`）、`ok`（`true`/`false`）、`error`（错误码，可选） |
| `cron_task_invalid` | 装载期丢弃任务项 | `task`（id 或空）、`field`、`reason` |

反向扳机（连续 4 周零使用）的度量口径：

```bash
# 合并日起 4 周内，点击后真正进入环境的次数（created=true 与 false 都算使用）
rg -c '"event":"cron_open"' ~/.config/lumir/logs/
# 为 0（或文件不存在）⇒ 扳机触发，按 proposal 条款删除
```

`cron_notified` 只作诊断，不作为「使用」判据——通知弹了四周没人点，说明它没在帮忙。
