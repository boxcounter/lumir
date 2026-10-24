# cron Specification

## Purpose

通用定时任务机制：按配置里的任务表在到点时（并由 app 启动 / 切前台补判一次）叫醒一个无人值守的 harness 运行，任务以自然语言自述「何时 / 在哪个 vault / 做什么」，机制本身 MUST NOT 内置任何具体任务知识。覆盖：运行时守护与拉取式兜底共用同一判定函数、三档触达策略（notify-then-run / run-then-notify / silent-run）、运行装配与会话形态（每次触发新会话 / 专用会话续写 / 模型覆盖 / 需批准时中止）、通知投递与点击唤起、通知送不出去时的可见面（注册告知 + 投递连续失败的可见提示）、任务定义与配置校验、触发去重状态与持久化。由 change `add-cron-runtime-daemon` 归档并入（2026-10-24，实现 M568–M625），并由 change `surface-cron-notify-failure` 归档并入（2026-10-24，实现 M635——通知资格成因的注册告知与第三次连续投递失败的可见提示）。

## Requirements

### Requirement: 通用定时任务机制

系统 SHALL 提供通用定时任务机制：任务只以 `{id, vault, at, days?, prompt, delivery?, session?,
model?}` 声明「身份 + 目标 vault + 调度 + 自然语言载荷 + 会话形态 + 触达策略 + 可选模型覆盖」。
机制 MUST NOT 内置任何具体任务知识——MUST NOT 解析或生成笔记路径、MUST NOT 探测「该建的文件是否
已存在」、MUST NOT 提供占位符替换或模板实例化、MUST NOT 提供类型化动作枚举或条件表达式，实现代码
里 MUST NOT 出现任何任务 id、样例路径或样例小节标题的字面量。

任务「做什么」SHALL 全部由 `prompt` 表达；环境初始化与上下文装配 SHALL 是运行时职责：运行沿用既有
harness 会话装配（目标 vault 根 AGENTS.md 与既有三层指令上下文），由 agent 按 prompt 与 vault 约定
执行。新增、替换或删除任务 SHALL 只改配置与 vault 文档，MUST NOT 需要改机制代码。

#### Scenario: 换一类任务不改代码

- **WHEN** 用户删掉 daily log 任务，改成一条「检查 vault 里特定文档之间引用一致性」的任务（只改
  `config.json` 的 `[cron].tasks` 与对应 vault 的约定文档）
- **THEN** 机制按同一套调度、触达与运行路径处理新任务，运行内容由新 prompt 表达；无任何代码改动

#### Scenario: 删除唯一任务后机制仍可用

- **WHEN** 所有任务被删除（`"tasks": []`）后重新加入一条形状相同、内容不同的任务
- **THEN** 守护空转期间零报错；新任务照常按判定函数触发，机制不残留任何被删任务的专属行为

#### Scenario: 实现代码不含任务字面量

- **WHEN** 检索实现代码（`src-tauri/src/**`、`src/**`）中的任务 id、样例路径与样例小节标题
- **THEN** 零命中；样例只存在于配置样例与 vault 文档样例

### Requirement: 运行时定时守护

系统 SHALL 在应用**进程内**运行时间触发的评估循环，按本机本地时间评估 `[cron].tasks`；MUST NOT
安装、依赖或调用任何系统级守护（launchd / LaunchAgent / 登录项 / 系统 cron daemon）。

守护 SHALL 以「本地日期属于 `days`、本地时钟已越过当日 `at`、且该任务当日尚未触发过」为唯一触发
判据，判定 MUST NOT 读文件系统、MUST NOT 写盘；同一任务在同一本地日期内 MUST NOT 触发多于一次。
守护 MUST NOT 提供 cron 表达式、秒级触发、一天多次触发或任意间隔（这类需求由多条任务表达或另立
change）。

守护 SHALL 在主窗口就绪之后启动，其装载、线程创建与首次评估 MUST NOT 落在冷启动测量路径上
（ADR 0002 第 6 条：冷启动 <300ms）；周期评估 SHALL 只做本地时钟比较。应用进程不在运行时 MUST NOT
有任何触达（无通知、无运行、无后台补发）：这是运行时守护的定义，不是缺陷。

#### Scenario: 到点触发一次

- **WHEN** 任务 `at` 为 `21:00`，当日 21:00 已过、当日尚未触发，应用运行中
- **THEN** 守护按该任务的触达策略触发一次；`cron-state.json` 记录今日本地日期；机制自身 MUST NOT
  创建、改写或删除 vault 内任何文件

#### Scenario: 未到点不触发

- **WHEN** 当前本地时间为 09:00，任务 `at` 为 `21:00`
- **THEN** 守护不投递通知、不发起运行

#### Scenario: 星期过滤

- **WHEN** 任务的 `days` 为 `[wed]`，当前为周二 21:05
- **THEN** 不触发；到周三 21:00 后按同一判据触发

#### Scenario: 冷启动不被守护阻塞

- **WHEN** 配置含合法任务，启动应用
- **THEN** 启动就绪信号（`LUMIR_READY`）在守护首次评估之前发出；启动耗时不受任务数量影响

#### Scenario: 应用未运行无触达

- **WHEN** 21:00 时应用进程不在运行，随后于 21:30 启动应用
- **THEN** 21:00 不产生任何通知或运行（无进程）；21:30 启动后经拉取式兜底按同一判据补触发一次
  （同日补，不是跨日补）

### Requirement: 拉取式兜底与判定函数共享

系统 SHALL 在**三个**时机调用与定时器**同一个**判定函数：①应用启动就绪之后一次；②主窗口每次
获得焦点时一次；③目标 vault 打开成功之后一次。MUST NOT 为实现兜底再写一份判定逻辑、MUST NOT 让
不同触发源各自判定不同的条件。

判定 SHALL 使用同一组输入（`at`、`days`、当前本地时间、去重状态）与同一组输出（不动作 / 当日已
触发 / 应触发），并遵守同一去重规则。判定 MUST NOT 产生任何文件写。补触发语义：已过点且当日未触发
⇒ SHALL 与该任务的定时触发同样处理（按触达策略投递通知或发起运行）；已过点且当日已触发 ⇒ MUST NOT
重复动作；未到点 ⇒ MUST NOT 动作。焦点触发在短时间内的重复到达 SHALL 合并，MUST NOT 因焦点切换
风暴产生多次判定或多次触发。跨日 MUST NOT 补发：昨日错过的触发不在今日补。

#### Scenario: 启动补触发

- **WHEN** 任务 `at` 为 `21:00`，应用于 22:30 启动，当日尚未触发
- **THEN** 启动后按触达策略触发一次并记录今日 `last_fired`

#### Scenario: 切前台补触发

- **WHEN** 应用整天在后台运行，用户在 22:00 切到 Lumir，当日尚未触发
- **THEN** 主窗口获得焦点时调用同一判定函数并触发一次

#### Scenario: 当日已触发不重复

- **WHEN** 21:00 已触发过，用户在 21:30、22:00 多次切前台
- **THEN** 这些焦点触发不再投递通知、不再发起运行，也不写盘

#### Scenario: 跨日不补

- **WHEN** 昨日 21:00 应用未运行，今日 09:00 启动应用
- **THEN** 昨日的触发不补；今日 21:00 前判定为未到点

#### Scenario: 判定不创建文件

- **WHEN** 触发源为定时器或拉取兜底，任务尚未被用户点击（`notify-then-run`）
- **THEN** 目标 vault 内无任何写入，`cron-state.json` 之外无任何写盘

### Requirement: 三档触达策略

每个任务的 `delivery` SHALL 取以下三档之一，缺省为 `notify-then-run`：

- `notify-then-run`：到点 SHALL 投递「到点」通知并记录当日已触发，MUST NOT 在点击前发起运行；用户
  点击通知后 SHALL 唤起窗口、必要时打开目标 vault，并在交互会话槽位发起运行——点击即意图，无点击
  不产生任何模型调用。
- `run-then-notify`：到点 SHALL 静默发起运行并记录当日已触发；运行到达终态后 SHALL 投递结果通知
  （正文只表明「已完成」或「运行失败」）；点击结果通知 SHALL 聚焦窗口并恢复该次运行的会话，MUST NOT
  重新运行。
- `silent-run`：到点 SHALL 静默发起运行并记录当日已触发；MUST NOT 投递任何通知，结果只留在会话
  留存与诊断事件里。

三档 MUST 共用同一条运行实现（既有 harness 装配与发送通道），差别只在「何时通知、谁发起运行、
点击落地到哪」。通知投递失败时 MUST NOT 记录当日已触发（允许下一次评估重试）；运行交接未被接受时
MUST NOT 记录当日已触发。运行到达终态后 MUST NOT 在同一本地日期内自动重试（避免无人值守下的 token
风暴）。

#### Scenario: 默认档不在点击前花 token

- **WHEN** 任务的 `delivery` 缺省，到点条件满足
- **THEN** 只投递通知并记录 `last_fired`；无运行、无模型请求；直到用户点击通知才发起运行

#### Scenario: run-then-notify 静默运行后通知结果

- **WHEN** 任务 `delivery` 为 `run-then-notify`，到点条件满足
- **THEN** 无「到点」通知；运行在无用户点击的情况下发起；运行终态后投递一条结果通知；点击该通知
  恢复该次运行的会话且不重新运行

#### Scenario: silent-run 不通知

- **WHEN** 任务 `delivery` 为 `silent-run`，到点条件满足
- **THEN** 运行照常发起并完成；全程零通知；会话留存可经既有会话历史找到

#### Scenario: 通知投递失败不写去重

- **WHEN** 通知权限被拒或投递失败
- **THEN** `last_fired` 不写入；下一次评估（同一天内）再次尝试；不记录为已触发

### Requirement: 运行装配与会话形态

运行 SHALL 沿用既有 harness 会话装配与发送通道：目标 vault 的既有指令上下文（含 vault 根
AGENTS.md）照既有规则装配，任务 `prompt` SHALL 作为一条显式用户消息送入，MUST NOT 解析、替换
占位符或改写其文本。运行 MUST NOT 把 prompt 写入或覆盖用户的 composer 草稿。

`session` SHALL 取 `new`（缺省）或 `dedicated`：`new` 每次触发建立新会话；`dedicated` 每任务复用
一个专用会话并在后续触发中续写（缺状态时新建）。`model` 在场时 SHALL 作为该次会话的模型覆盖，按
运行时 `[harness].providers.<provider>.models` 的声明解析；未声明时回落该 provider 默认模型并给一条
warning，MUST NOT 丢弃任务。

**无人值守运行（`run-then-notify` / `silent-run`）MUST NOT 改写、重置或替换用户的交互会话**：其运行
槽位与交互会话槽位分离，其事件 MUST NOT 渲染进用户当前会话的 transcript；运行结果仍按既有 per-vault
布局落会话留存。**用户点击发起的运行**（`notify-then-run`）SHALL 落在交互会话槽位，使用户看见运行
过程。

同一任务同一时刻 MUST NOT 有多个在途运行。无人值守运行遇到需要用户批准的工具调用时 MUST NOT 无限
挂起：SHALL 中止本次运行、以 `approval_required` 记录诊断，并按触达策略通知失败（`silent-run` 只
落诊断）；MUST NOT 自动放行，也 MUST NOT 自动拒绝。

目标 vault 不是当前打开的 vault 时，无人值守运行 MUST NOT 切换用户当前 vault：SHALL 延后到当日
下一次拉取触发重试，当日始终未打开则当日不运行并落诊断，MUST NOT 跨日补。

#### Scenario: 每次触发新会话

- **WHEN** 任务 `session` 为 `new`，连续两日各触发一次运行
- **THEN** 两次运行落在两个不同的会话 id；第二天的运行上下文中不含第一天会话的历史消息

#### Scenario: 专用会话续写

- **WHEN** 任务 `session` 为 `dedicated`，第二次触发
- **THEN** 运行恢复同一专用会话并续写；`cron-state.json` 的 `session_id` 更新为续写后的会话 id

#### Scenario: 模型覆盖

- **WHEN** 任务声明了已在 `[harness].providers.<provider>.models` 中声明的 `model`
- **THEN** 该次会话按该模型建立（会话留存 `session_open` 记录该模型）；未声明时回落 provider 默认
  模型并给一条 warning，任务不丢

#### Scenario: 无人值守运行不影响用户当前会话

- **WHEN** 用户在一个会话里有历史消息，`run-then-notify` 任务在后台完成一次运行
- **THEN** 用户当前会话的内容与槽位不变，后台运行的事件不出现在其 transcript；后台会话可在既有
  会话历史中列出

#### Scenario: 需批准时中止而不是挂起

- **WHEN** 无人值守运行发起一个需要用户批准的工具调用
- **THEN** 本次运行以 `approval_required` 中止并落诊断（`run-then-notify` 另投递失败通知）；不自动
  放行、不自动拒绝、不无限等待

#### Scenario: 目标 vault 未打开时延后

- **WHEN** `silent-run` 任务到点，但目标 vault 不是当前打开 vault
- **THEN** 该次运行不发起、不切换 vault、不写 `last_fired`；当日打开目标 vault 或切前台后按同一
  判定补跑；当日未打开则当日不运行并落一条诊断

### Requirement: 通知的投递与点击唤起

系统 SHALL 经系统通知中心投递通知（macOS 上为通知中心；应用在后台、被遮挡或最小化时同样投递）。
通知标题 SHALL 为任务 `id`，正文 SHALL 是通用文案（「到点」/「已完成」/「运行失败」）；MUST NOT
含任务 prompt 内容、文档正文或 vault 绝对路径。

通知权限：存在至少一条有效任务时，系统 SHALL 在启动装载期检查通知权限；权限未决定 SHALL 申请
一次（系统弹窗）；权限被拒 SHALL 给出一条人话 warning、MUST NOT 反复申请、MUST NOT 阻断守护的
判定或非通知类功能。

点击等待 SHALL 随每条通知在投递成功后登记，MUST NOT 依赖一次性的全局注册（点击响应与具体的投递
请求绑定，平台按请求 id 路由，只有为该条通知登记的等待能收到它）。收到点击（`actionId` 为通知
本体，即 `tap`）后，系统 SHALL 按该任务的触达策略执行：`notify-then-run` → 唤起并聚焦主窗口、
必要时经既有 vault 打开链路打开目标 vault、在交互会话槽位发起运行；`run-then-notify` → 唤起并
聚焦主窗口、恢复该次运行的会话。任一步失败 SHALL 落一条诊断事件并给人话反馈，MUST NOT 静默。

重复点击同一通知 SHALL 幂等：当日该任务已有运行会话时，只聚焦并打开该会话，MUST NOT 重复发起
运行，MUST NOT 产生重复的模型请求。

#### Scenario: 到点通知内容

- **WHEN** `notify-then-run` 任务到点，通知被投递
- **THEN** 通知标题为任务 `id`，正文为通用文案；不含 prompt、文档内容或绝对路径

#### Scenario: 点击通知发起运行

- **WHEN** 通知已投递，用户点击通知本体
- **THEN** 主窗口被唤起并置于前台；目标 vault 未打开时先打开；交互会话槽位出现一次新运行，任务的
  prompt 作为用户消息在场；运行事件与结果可在界面上观察

#### Scenario: 结果通知点击恢复会话

- **WHEN** `run-then-notify` 的结果通知被点击
- **THEN** 窗口被唤起，该次运行的会话被恢复并可继续对话；不产生第二次运行

#### Scenario: 权限被拒

- **WHEN** 用户拒绝通知权限，配置含合法任务
- **THEN** 启动不失败，产生一条人话 warning；到点不投递通知、不写 `last_fired`；其它任务形态
  （如 `silent-run`）的判定与运行不受影响

#### Scenario: 重复点击幂等

- **WHEN** 同一 `notify-then-run` 通知被连续点击两次，第一次已发起运行
- **THEN** 第二次只聚焦并打开已有运行会话；不新建第二个会话、不产生第二次模型请求

### Requirement: 任务定义与配置校验

`[cron]` 配置节 SHALL 为配置即数据形态（ADR 0002 第 5 条）：`tasks` 数组，每项为
`{id, vault, at, days?, prompt, delivery?, session?, model?}`。校验 SHALL 逐项进行——非法项只丢弃
该项并给一条人话 warning，其余任务照常生效；`tasks` 整键形状非法（非数组）或 `[cron]` 整节形状
非法 SHALL 走既有解析模型的整文件回落，MUST NOT 发明逐字段类型容忍。未知字段 SHALL 被忽略（与
既有配置口径一致）。

字段口径：`id` 非空且不含空白，重复 id 保留首项、丢弃后项并 warning；`vault` 为绝对路径（是否
存在不在装载期判定）；`at` 为 `HH:MM`（`00:00`–`23:59`）；`days` 可选，取 `mon`/`tue`/`wed`/
`thu`/`fri`/`sat`/`sun` 的非空数组，缺省为全周；`prompt` 必填且 trim 后非空；`delivery` 可选，
闭集合 `notify-then-run` / `run-then-notify` / `silent-run`，缺省 `notify-then-run`，闭集合外取值
回落缺省并保留任务 + warning；`session` 可选，闭集合 `new` / `dedicated`，缺省 `new`，闭集合外
取值回落缺省并保留任务 + warning；`model` 可选，非空字符串，形状非法只丢 `model` 并保留任务。

任务集合 SHALL 在启动装载时读一次，运行期 MUST NOT 热重载（改配置需重启）。`"tasks": []` SHALL
表示守护空转：不触发任何任务、不报错。

#### Scenario: 合法任务被调度

- **WHEN** 配置一条 `at = "21:00"`、`prompt` 非空、`vault` 为绝对路径的任务
- **THEN** 守护在本地 21:00 后按判定函数评估该任务；无需重启以外的额外动作

#### Scenario: 非法项只丢一项

- **WHEN** `tasks` 含两条任务，其中一条 `at` 为 `"25:00"`
- **THEN** 该条被丢弃并给出一条人话 warning（`cron_task_invalid`）；另一条任务照常生效

#### Scenario: 缺 prompt 丢项

- **WHEN** 某任务的 `prompt` 缺失或为空白字符串
- **THEN** 该任务被丢弃并给出一条人话 warning；其余任务照常生效

#### Scenario: 非法 delivery 回落默认档

- **WHEN** 某任务的 `delivery` 为 `"notify-me"`（闭集合外）
- **THEN** 该任务保留并按 `notify-then-run` 处理，另给一条人话 warning

#### Scenario: 重复 id

- **WHEN** 两条任务的 `id` 相同
- **THEN** 保留首项、丢弃后项，并给出一条人话 warning

#### Scenario: 空任务表

- **WHEN** 配置为 `"cron": { "tasks": [] }` 或无 `[cron]` 节
- **THEN** 应用正常启动，守护不触发任何任务、无 warning

#### Scenario: 整节错形状回落

- **WHEN** 配置为 `"cron": "daily-log"`（整节不是对象）
- **THEN** 走整文件回落（全部字段回默认值 + 一条 warning），启动不失败

### Requirement: 触发去重状态与持久化

触发去重状态 SHALL 落在配置目录根下的独立小文件 `cron-state.json`（与 `window-state.json` 同
惯例）；MUST NOT 写入 `config.json`，MUST NOT 写入任何 vault。存档 SHALL 记录每个任务最近一次触发的
本地日期（`last_fired`）与最近一次运行的会话标识（`session_id`，在场时），并携带 schema 版本号。

`last_fired` SHALL 只在派发成功时写入（通知投递成功，或运行交接被接受）；运行失败、运行被跳过、
通知投递失败 MUST NOT 写入。`session_id` SHALL 由运行终态回执更新，消费者是结果通知的会话恢复与
`dedicated` 的续写。

写入 SHALL 使用临时文件 + rename 原子替换；写失败 SHALL 降级为 warning，MUST NOT 阻断守护循环或
影响其它功能。读取纪律：文件缺失、不可读、非合法 JSON、`version` 与实现不符，四类对调用方的语义
完全相同——「没有去重状态」（最多导致一次重复触发），一律 MUST NOT 抛错、MUST NOT 阻断启动；缺失是
常态不告警，其余三类各记一条 warning。任务从配置删除后其状态记录 SHALL 惰性残留，MUST NOT 为清理
它做启动期扫描。

#### Scenario: 当日至多一次

- **WHEN** 同一任务当日已派发过，随后多次触发判定
- **THEN** 不再投递通知、不再发起运行（状态文件记录当日日期）

#### Scenario: 跨日重新允许

- **WHEN** 昨日已触发且今日到点条件满足
- **THEN** 今日按判据可再次触发一次（本地日期变化即重新允许）

#### Scenario: 状态文件损坏

- **WHEN** `cron-state.json` 被截断或含非法 JSON
- **THEN** 应用正常启动，视为无状态（最多重复触发一次），并记一条 warning

#### Scenario: 会话标识随运行更新

- **WHEN** 一次运行到达终态并回执成功
- **THEN** `cron-state.json` 中该任务的 `session_id` 为本次运行的会话；点击结果通知可据此恢复

#### Scenario: 不污染配置与 vault

- **WHEN** 完成一次触发与一次运行
- **THEN** 去重状态只出现在 `cron-state.json`；`config.json` 无新增运行态字段；机制自身不向 vault
  写入任何内容（运行期写入由 agent 经既有工具与权限闸完成）

### Requirement: 通知送不出去时的注册告知

`cron_task_create` 在注册 `notify-then-run` 档任务、且通知权限判据为「送不出去」时 SHALL 在工具
回执里携带一句人话告知（字段 `notice`）；同一份判据 SHALL 在诊断面落一条 `config_warning`。
两处 MUST 读**同一份**权限快照（守护线程申请一次后回流），MUST NOT 各自发起一次授权申请。

判据 SHALL 区分两种成因，两者的告知 MUST NOT 共用一句：

- 系统里没有本客户端的授权记录（申请未获批准且 `authorizationStatus` 为 `NotDetermined`）⇒
  告知 SHALL 陈述「系统未认可当前 Lumir 的通知身份（安装包缺少有效签名）」，MUST NOT 引导用户
  去系统设置打开——那是另一个签名身份的条目，改它不解决问题；
- 系统记录为拒绝（`authorizationStatus` 为 `Denied`）⇒ 告知 SHALL 引导用户到系统设置打开。

告知 SHALL 由模型在回复里原样转达（提示词层给出该义务），MUST NOT 只在诊断日志里出现。
`run-then-notify` 与 `silent-run` 档 MUST NOT 在注册回执里出这句话：前者运行照常发生、后者不发
通知，两者的投递失败由「投递连续失败的可见提示」收口。判据无法得出（申请 / 查询失败、重载回执
丢失）时 MUST NOT 出这句话。

告知的取列 SHALL 按注册那一刻的界面语言决定（与原生对话框标题的选择口径同源）。

#### Scenario: 身份未被认可时回执说清成因

- **WHEN** 打包实例的系统里没有本客户端的通知授权记录，交互会话注册一条 `notify-then-run` 任务
- **THEN** 回执带 `notice`，内容陈述系统未认可当前 Lumir 的通知身份（安装包缺少有效签名）与
  「这条任务到点不会有提醒」，且不含「去系统设置打开」式引导

#### Scenario: 用户拒绝与身份未被认可的措辞不同

- **WHEN** 权限判据为「系统记录为拒绝」
- **THEN** `notice` 引导用户到系统设置打开本应用的通知权限，且与身份档的句子不逐字相同

#### Scenario: 其它触达档不出注册告知

- **WHEN** 注册 `run-then-notify` 或 `silent-run` 任务，且通知送不出去
- **THEN** 回执没有 `notice` 字段

#### Scenario: 无法判定时不报

- **WHEN** 授权申请或设置查询本身失败（判据为「无法判定」），或重载回执丢失
- **THEN** 回执没有 `notice` 字段；诊断面留一条 warning，注册仍按既有口径报告生效状态

### Requirement: 投递连续失败的可见提示

通知投递 SHALL 记账连续失败次数，一次成功投递 SHALL 清零。连续失败次数达到 3 次时 SHALL 在
app 内给一条可见提示（复用既有 `cron:notice` 提示通道），同一段连续失败 MUST NOT 重复提示；
清零后再次达到阈值 SHALL 重新提示。

提示文案 SHALL 由前端按文案表取值，后端只发 `code` 与参数（MUST NOT 持有可见文案）。身份未被
系统认可的成因与其它成因 SHALL 使用不同的 `code`：前者 SHALL 陈述签名身份事实，MUST NOT 把
「去系统设置打开」表述为唯一出路；后者 SHALL 提示用户检查系统设置里的权限。

提示 MUST NOT 改变投递语义：失败仍不写 `last_fired`、仍按既有节奏重试；提示本身失败（通道不
在场）MUST NOT 升级为投递失败。

#### Scenario: 第三次连续失败时上屏一次

- **WHEN** 同一进程内通知投递连续失败达到 3 次（中间没有一次成功）
- **THEN** app 内出现一条提示，正文带当时的连续失败次数；第 4 次及以后的失败不再重复上屏

#### Scenario: 成功投递清零后重新计数

- **WHEN** 连续失败 2 次后有一次投递成功，随后再次连续失败 3 次
- **THEN** 第二次达到阈值时重新上屏一条提示

#### Scenario: 身份成因与其它成因的措辞不同

- **WHEN** 提示上屏时权限快照为「系统未认可身份」
- **THEN** 文案点名「安装包缺少有效签名」这一成因；快照为其它值或未探测时使用通用文案

#### Scenario: 提示通道不在场不改变判定

- **WHEN** 前端未订阅 `cron:notice`（事件无人接收）
- **THEN** 投递失败仍按既有口径重试与落诊断事件，不因提示丢失而改变任务状态
