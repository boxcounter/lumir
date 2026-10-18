# cron 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `cron`。设计见 [design.md](../../design.md)，
> 裁决背景见 [proposal.md](../../proposal.md)。本 capability 只负责「按时把未满足的条件变成一次
> 可点击的系统通知，并在点击后进入环境」；环境怎么建、怎么打开归
> [note-templates 增量](../note-templates/spec.md)，两者只以「任务引用模板 id」单向耦合。
> 系统级守护（launchd 等）明确不在本 capability 内（留档与升级触发条件见 proposal）。

## ADDED Requirements

### Requirement: 运行时定时守护

系统 SHALL 在应用**进程内**运行一个时间触发的评估循环（运行时守护），按本机本地时间评估
`[cron].tasks` 声明的任务；MUST NOT 安装、依赖或调用任何系统级守护（launchd / LaunchAgent /
登录项 / 系统 cron daemon），MUST NOT 依赖 cron 表达式、任意条件表达式或脚本执行。

任务 SHALL 以 `at`（本地 `HH:MM`）与 `days`（星期集合，缺省全周）声明时间面，以 `template`
（引用的模板 id）与 `vault`（目标 vault 绝对路径）声明环境面。守护 SHALL 以「本地日期属于 `days`、本地时钟已越过当日 `at`、且任务条件未满足、
且当日尚未通知过」为唯一投递判据；任务条件 SHALL 是「模板当日实例的目标文件已存在」，判定规则见
「拉取式兜底与判定函数共享」。同一任务在同一本地日期内 MUST NOT 投递多于一次通知。

守护 SHALL 在主窗口就绪之后启动，其装载、线程创建与首次评估 MUST NOT 落在冷启动测量路径上
（ADR 0002 第 6 条：冷启动 <300ms）；周期评估 SHALL 只做本地时钟比较，仅在到期时做一次目标路径
存在性探测，MUST NOT 在评估循环里读写 config.json。

应用进程不在运行时 MUST NOT 有任何触达（无通知、无自动创建、无后台补发）：这是运行时守护的定义，
不是缺陷。系统级守护留档不做，升级触发条件见 proposal。

#### Scenario: 到点未满足投递通知

- **WHEN** 任务 `at` 为 `21:00`、当日 21:00 已过、今日实例文件不存在、当日未通知过，应用运行中
- **THEN** 投递一次系统通知；`cron-state.json` 记录该任务的 `last_notified` 为今日本地日期；目标文件 MUST NOT 因通知而创建

#### Scenario: 到点已满足不通知

- **WHEN** 到点前今日实例文件已存在，时钟越过 `at`
- **THEN** 不投递通知、不写去重状态，文件内容与 mtime 均不变

#### Scenario: 未到点不通知

- **WHEN** 当前本地时间为 09:00，任务 `at` 为 `21:00`
- **THEN** 守护不投递任何通知（即使今日文件不存在）

#### Scenario: 星期过滤

- **WHEN** 任务的 `days` 为 `[wed]`，当前为周二 21:05 且当日文件不存在
- **THEN** 不投递通知；到周三 21:00 后按同一判据投递

#### Scenario: 冷启动不被守护阻塞

- **WHEN** 配置含合法 cron 任务，启动应用
- **THEN** 启动就绪信号（`LUMIR_READY`）在守护首次评估之前发出；启动耗时不受任务数量影响

#### Scenario: 应用未运行无触达

- **WHEN** 21:00 时应用进程不在运行，随后于 21:30 启动应用
- **THEN** 21:00 不产生任何通知（无进程）；启动后经拉取式兜底按同一判据处理（见「拉取式兜底与判定函数共享」），昨日错过的提醒不补发

### Requirement: 拉取式兜底与判定函数共享

系统 SHALL 在**两个**时机调用与定时器**同一个**判定函数：①应用启动就绪之后一次；②主窗口每次
获得焦点（切前台）时一次。MUST NOT 为实现兜底再写一份判定逻辑、MUST NOT 让两个触发源各自判定
不同的条件。

判定 SHALL 使用同一组输入（任务定义、模板、目标 vault、当前本地时间、去重状态）与同一组输出
（不动作 / 已满足 / 应通知），并遵守同一去重规则。判定 MUST NOT 产生任何文件写：实例创建只发生在
通知点击链路与模板独立入口里。

补判语义：已过点、未满足、当日未通知 ⇒ SHALL 与定时器触发同样投递一次通知；已过点但当日已通知 ⇒
MUST NOT 重复投递；已满足或未到点 ⇒ MUST NOT 动作。焦点触发在短时间内的重复到达 SHALL 合并，
MUST NOT 因窗口焦点切换风暴产生多次探测或多次通知。

#### Scenario: 启动补判

- **WHEN** 任务 `at` 为 `21:00`，应用于 22:30 启动，今日实例文件不存在，今日尚未通知
- **THEN** 启动后投递一次通知并记录今日 `last_notified`

#### Scenario: 切前台补判

- **WHEN** 应用整天在后台运行（窗口被遮挡），用户在 22:00 切到 Lumir
- **THEN** 主窗口获得焦点时调用同一判定函数；条件如仍未满足且当日未通知，投递一次通知

#### Scenario: 当日已通知不重复

- **WHEN** 21:00 已投递过通知，用户在 21:30、22:00 多次切前台，文件仍未创建
- **THEN** 这些焦点触发不再投递通知（当日去重），也不写盘

#### Scenario: 两源判定一致

- **WHEN** 今日实例文件已存在，无论时钟越过 `at` 还是启动 / 切前台触发判定
- **THEN** 两个触发源都判为「已满足」，均不投递、均不写盘

#### Scenario: 判定不创建文件

- **WHEN** 条件未满足，触发源为定时器或拉取兜底（未发生点击）
- **THEN** 目标文件不存在、其父目录不因判定而创建，`cron-state.json` 之外无任何写盘

### Requirement: 通知的投递与点击唤起

系统 SHALL 经系统通知中心投递提醒（macOS 上为通知中心；应用在后台、被遮挡或窗口最小化时同样
投递）。通知正文 SHALL 只含任务可读名与目标文件的可读名，MUST NOT 含文档正文，MUST NOT 含 vault
绝对路径。

通知权限：存在至少一条有效任务时，系统 SHALL 在启动装载期检查通知权限；权限未决定 SHALL 申请
一次（系统弹窗）；权限被拒 SHALL 给出一条人话 warning、MUST NOT 反复申请、MUST NOT 阻断任务的
判定或模板入口的其它功能。

点击监听 SHALL 在应用启动时注册一次并常驻；MUST NOT 按需注册（平台只在「通知投递时监听器已在场」
的通知上上报点击）。收到点击（`actionId` 为通知本体，即 `tap`）后，系统 SHALL 按顺序执行：

1. 唤起并聚焦主窗口（隐藏则显示、最小化则还原、被遮挡则前置）；
2. 重新执行同一判定并确保环境存在：模板当日实例不存在则按 `note-templates` 的实例化规则创建，
   已存在则 MUST NOT 覆盖或改写任何字节；
3. 打开该实例文件（复用既有文档打开链路），并在模板声明了 prompt 时把它预载进该 vault 的 harness
   composer 草稿；MUST NOT 自动发送，MUST NOT 因此发起任何模型请求。

目标 vault 尚未打开时，系统 SHALL 先经既有 vault 打开链路打开该 vault，成功后再打开文件。任一步
失败 SHALL 给出人话反馈并落一条诊断事件，MUST NOT 静默；同一通知被重复点击 SHALL 幂等（第二次
不重建文件、不重复发起任何模型请求）。

#### Scenario: 点击通知创建并进入环境

- **WHEN** 通知已投递（今日实例不存在），用户点击通知本体
- **THEN** 主窗口被唤起并置于前台；模板当日实例被创建（日期 frontmatter 与固定小节齐全）；该文件在新标签中打开；若模板声明了 prompt，composer 草稿含该 prompt 且尚未发送

#### Scenario: 实例已存在时只打开不覆盖

- **WHEN** 通知投递后用户在别处手动创建了今日实例，随后点击通知
- **THEN** 文件内容与 mtime 不变，仅执行唤起与打开

#### Scenario: 重复点击幂等

- **WHEN** 同一通知被连续点击两次
- **THEN** 第二次不创建文件、不改写文件，composer 草稿内容不变，无重复的模型请求

#### Scenario: 权限被拒

- **WHEN** 用户拒绝通知权限，配置含合法任务
- **THEN** 启动不失败，产生一条人话 warning；到点后不投递通知；任务判定与模板独立入口仍照常工作

#### Scenario: 点击时目标 vault 未打开

- **WHEN** 当前打开的是别的 vault，通知指向 daily vault 的模板实例
- **THEN** 系统先打开 daily vault，成功后再打开实例文件；打开失败时给出人话提示并记录诊断事件

#### Scenario: 点击时窗口最小化

- **WHEN** 主窗口处于最小化状态，用户点击通知
- **THEN** 窗口还原并置于前台，随后打开实例文件

### Requirement: cron 任务定义与配置校验

`[cron]` 配置节 SHALL 为配置即数据形态（ADR 0002 第 5 条）：`tasks` 数组，每项为
`{id, vault, at, template, days?}`。校验 SHALL 逐项进行——非法项只丢弃该项并给一条人话 warning，
其余任务照常生效；`tasks` 整键形状非法（非数组）或 `[cron]` 整节形状非法 SHALL 走既有解析模型的
整文件回落，MUST NOT 发明逐字段类型容忍。未知字段 SHALL 被忽略（与既有配置口径一致）。

字段口径：`id` 非空且不含空白，重复 id 保留首项、丢弃后项并 warning；`vault` 为绝对路径（是否
存在不在装载期判定）；`at` 为 `HH:MM`（`00:00`–`23:59`）；`template` MUST 指向
`[note_templates]` 中已定义的模板 id，悬空引用丢项并 warning；`days` 可选，取 `mon`/`tue`/`wed`/
`thu`/`fri`/`sat`/`sun` 的非空数组，缺省为全周。

任务集合 SHALL 在启动装载时读一次，运行期 MUST NOT 热重载（改配置需重启，与既有配置键口径一致）。
`"tasks": []` SHALL 表示守护空转：不投递任何通知、不报错。本 capability MUST NOT 支持 cron 表达式、
秒级触发、一天多次触发、任意间隔或脚本执行（这类需求由多条任务表达或另立 change）。

#### Scenario: 合法任务被调度

- **WHEN** 配置一条 `at = "21:00"`、`template` 指向已定义模板、`vault` 为绝对路径的任务
- **THEN** 守护在本地 21:00 后按判定函数评估该任务；无需重启以外的额外动作

#### Scenario: 非法项只丢一项

- **WHEN** `tasks` 含两条任务，其中一条 `at` 为 `"25:00"`
- **THEN** 该条被丢弃并给出一条人话 warning；另一条任务照常生效

#### Scenario: 悬空模板引用

- **WHEN** 任务的 `template` 指向不存在的模板 id（或该模板因自身非法已被丢弃）
- **THEN** 该任务被丢弃并给出一条人话 warning，守护不因它反复失败

#### Scenario: 重复 id

- **WHEN** 两条任务的 `id` 相同
- **THEN** 保留首项、丢弃后项，并给出一条人话 warning

#### Scenario: 空任务表

- **WHEN** 配置为 `"cron": { "tasks": [] }` 或无 `[cron]` 节
- **THEN** 应用正常启动，守护不投递任何通知、无 warning

#### Scenario: 整节错形状回落

- **WHEN** 配置为 `"cron": "daily-log"`（整节不是对象）
- **THEN** 走整文件回落（全部字段回默认值 + 一条 warning），启动不失败

### Requirement: 通知去重状态与持久化

通知去重状态 SHALL 落在配置目录根下的独立小文件 `cron-state.json`（与 `window-state.json` 同
惯例）；MUST NOT 写入 `config.json`，MUST NOT 写入任何 vault。存档 SHALL 记录每个任务最近一次
通知的本地日期，并携带 schema 版本号。

写入 SHALL 使用临时文件 + rename 原子替换，只在通知投递成功后写；写失败 SHALL 降级为 warning，
MUST NOT 阻断守护循环或影响其它功能。读取纪律：文件缺失、不可读、非合法 JSON、`version` 与实现
不符，四类对调用方的语义完全相同——「没有去重状态」（最多导致一次重复通知），一律 MUST NOT 抛错、
MUST NOT 阻断启动；缺失是常态不告警，其余三类各记一条 warning。任务从配置删除后其状态记录 SHALL
惰性残留，MUST NOT 为清理它做启动期扫描。

#### Scenario: 当日至多一次

- **WHEN** 同一任务当日已投递过通知，随后多次触发判定
- **THEN** 不再投递第二条通知（状态文件记录当日日期）

#### Scenario: 跨日重新允许

- **WHEN** 昨日已通知且今日到点条件仍未满足
- **THEN** 今日按判据可再次投递一次（本地日期变化即重新允许）

#### Scenario: 状态文件损坏

- **WHEN** `cron-state.json` 被截断或含非法 JSON
- **THEN** 应用正常启动，视为无状态（最多重复通知一次），并记一条 warning

#### Scenario: 不污染配置与 vault

- **WHEN** 完成一次通知投递
- **THEN** 去重状态只出现在 `cron-state.json`；`config.json` 无新增运行态字段，vault 内无任何本功能写入
