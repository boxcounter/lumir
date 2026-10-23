# cron 增量规格（change surface-cron-notify-failure）

> 起草注记（非规格正文）：本 delta 只加「通知送不出去时用户能感知到什么」，不动判定函数、
> 派发策略与投递链路（重试预算、投递后自查、失败不写 `last_fired` 全部照旧）。机制背景与取舍见
> [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。

## ADDED Requirements

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
