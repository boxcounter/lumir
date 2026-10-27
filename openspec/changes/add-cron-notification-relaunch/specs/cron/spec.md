# cron 增量规格（change add-cron-notification-relaunch）

> 起草注记（非规格正文）：本 delta 只改「点击如何被接收、如何被识别」与「点击恢复的语义」，不动
> 三档触达策略、判定函数、运行交接与通知文案。机制背景与方案取舍见 [design.md](../../design.md)，
> 裁决留痕见 [proposal.md](../../proposal.md)。
>
> **MODIFIED 块的基线**：两个 MODIFIED requirement 按当前 living spec（`openspec/specs/cron/spec.md`）
> 的整块正文复制再改——`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档时静默消失。

## ADDED Requirements

### Requirement: 进程退出后的通知点击恢复

系统 SHALL 让「应用进程退出期间投递的通知」被点击时仍能落地。点击 SHALL 由系统拉起本应用（平台
行为），新进程 SHALL 识别该次点击、校验它的来源，并进入与进程内点击**同一段**处置实现（唤起窗口、
必要时经既有 vault 打开链路打开目标 vault、在交互会话槽位发起运行，或恢复该次运行的会话）。MUST
NOT 出现「应用被拉起、点击没有任何后果」的形态。

**启动期常驻接收**：macOS 打包实例 SHALL 在应用完成启动之前安装通知 delegate 并持有它的强引用
直到进程退出；MUST NOT 依赖首次投递时才发生的懒装，MUST NOT 在安装路径上发起跨进程查询或读写
配置文件（ADR 0002 第 6 条冷启动 <300ms 合同）。delegate 收到响应时 SHALL 先落进程内缓冲（无主
响应落点），由守护线程在装载完成之后取走处理，MUST NOT 在缓冲阶段按「界面未就绪」之类的原因丢弃
响应。缓冲 SHALL 有界（超出上限时丢最旧的一条并落一条 warning），SHALL 只存在于进程内（进程退出
即无待处理点击，MUST NOT 落盘）。delegate 安装失败（无 bundle 身份、系统拒绝）SHALL 只降级为
warning：MUST NOT 阻断启动与投递，MUST NOT 影响其它平台的点击接收。macOS 上点击接收只有 delegate
一条通道——安装失败时进程内点击与跨进程点击**一起不可用**，MUST NOT 声称存在第二条 macOS 通道。

**接收判据**：一次响应只有同时满足以下四条才算「被接受的点击」，缺一按分类原因拒绝：

- 动作是通知本体（`tap`）——非 tap 动作 MUST NOT 进入处置，按既有防御性口径落一条 warning；
- request id 在本机通知台账里（台账的落点与写入纪律见「触发去重状态与持久化」）；
- 台账里的任务仍存在于当前任务集；
- 台账记录的派发本地日期等于今天。

识别 MUST NOT 依赖 request id 的字符串形状（任务 id 允许含分隔符），MUST NOT 凭通知正文推断任务。

**拒绝语义**：

- 台账里没有该 request id ⇒ `cron_click(ok=false, error=notice_unknown)`；不发起运行、不打开会话，
  MUST NOT 上屏提示（旧版本遗留或已被台账裁剪的通知属正常噪声）；
- 任务已删除 ⇒ `cron_click(ok=false, error=task_unknown)` + 一句人话提示；
- 跨天（台账的派发日期不是今天）⇒ `cron_click(ok=false, error=notice_stale)` + 一句人话提示；
  MUST NOT 发起运行，MUST NOT 影响当日本任务正常的到点派发与去重记录。

**界面未就绪**：恢复的点击若在前端接线层就绪之前被接受，SHALL 保留并在接线层就绪后重放（落
`cron_click_deferred`）；MUST NOT 按「界面尚未就绪，请稍后重试」退回——用户手里没有第二次点击的
机会。保留 SHALL 有界（同一任务只留最新一条，总数有上限），进程退出即丢弃。只有保留被覆盖或进程
退出时，才补一条 `cron_click(ok=false, error=not_ready)`。

**dirty vault**：目标 vault 与当前不同且当前有未保存修改时，SHALL 走既有 vault 切换前置门（三
出口由用户选择），MUST NOT 自动丢弃修改；用户未选择继续时运行不落地，SHALL 以既有的「运行未落地」
回执（`cron_run_finished(ok=false, error=vault_not_open)`）收尾并给人话提示，MUST NOT 自动重试。

**重复与并发**：同一 request id 的第二次及以后的响应 SHALL 幂等——只唤起窗口并打开已有会话，MUST
NOT 产生第二次运行或第二次模型请求；同一条通知的两次响应在缓冲里先后到达（快速双击）时，至多
一次运行。

**运行失败**：恢复的点击发起的运行以失败终态结束时，SHALL 走既有终态路径
（`cron_run_finished(ok=false)` + 一次人话提示），MUST NOT 在同一本地日期内自动重跑。

**平台范围**：以上 SHALL 只适用于 macOS 打包实例。非 macOS 平台 MUST NOT 声称跨进程恢复能力，
其点击仍走进程内接收通道；macOS dev flavour 的点击本就不可达（响应路由给别的身份，M608 已知边界），
MUST NOT 因本 change 而声称它可用。

**诊断**：`cron_click` SHALL 带 `source` 字段区分来源（`in-process` / `relaunch`）；保留待重放
SHALL 落 `cron_click_deferred`（与 `cron_click` 共用任务与来源字段，另带闭集合 `reason`）。两者
MUST NOT 记录通知正文、任务 prompt 或 vault 绝对路径。

#### Scenario: 应用退出后点击到点通知发起运行

- **WHEN** `notify-then-run` 任务的「到点」通知已投递成功、投递它的进程已退出，用户点击该通知
- **THEN** 系统拉起应用；新进程落一条 `cron_click(ok=true, action=run, source=relaunch)`，目标
  vault 被打开、窗口被唤起，交互会话槽位发起一次运行（`cron_run_started(trigger=click)`），运行
  终态落 `cron_run_finished`

#### Scenario: 结果通知的跨进程恢复

- **WHEN** `run-then-notify` 任务的结果通知已投递、投递它的进程已退出，用户点击该通知
- **THEN** 新进程落一条 `cron_click(ok=true, action=open-session, source=relaunch)`，目标 vault 被
  打开、台账里该次运行的会话被恢复；MUST NOT 发起第二次运行

#### Scenario: 仅拉起应用不产生点击

- **WHEN** 应用在没有任何通知被点击的情况下启动（用户从程序坞或 Dock 打开）
- **THEN** 不产生 `cron_click`、不产生 `cron_run_started`；动作只来自按判定函数的既有触达策略

#### Scenario: 台账外的通知被拒

- **WHEN** delegate 收到一个不在台账里的 request id（上一版本投递的通知，或已被台账裁剪的通知）
- **THEN** 落 `cron_click(ok=false, error=notice_unknown)`；不发起运行、不打开会话、不上屏提示

#### Scenario: 跨天点击不补跑

- **WHEN** 通知在昨日派发（台账 `date` 为昨日），用户在今日点击它
- **THEN** 落 `cron_click(ok=false, error=notice_stale)` 并给人话提示；不发起运行；当日本任务仍按
  到点判定正常派发与记录

#### Scenario: 任务已删除

- **WHEN** 台账里的任务在点击前已被从配置删除
- **THEN** 落 `cron_click(ok=false, error=task_unknown)` 并给人话提示；不发起运行、不打开会话

#### Scenario: 重复点击同一条通知

- **WHEN** 恢复的点击已发起运行，用户随后再次点击同一条通知
- **THEN** 第二次只唤起窗口并打开已有运行会话（`cron_click(ok=true, source=relaunch)`）；
  `cron_run_started` 仍只有一条，无第二次模型请求

#### Scenario: 快速双击只跑一次

- **WHEN** 同一条通知的两次响应在守护线程处理第一次之前先后进入缓冲（快速双击）
- **THEN** 至多一次运行；另一条只唤起窗口并打开已有会话

#### Scenario: 界面未就绪时保留并重放

- **WHEN** 恢复的点击在前端接线层就绪之前被接受
- **THEN** 落 `cron_click_deferred`，接线层就绪后该点击被重放并落地（`cron_click(ok=true,
  source=relaunch)`）；MUST NOT 以「稍后重试」结束

#### Scenario: 目标 vault 有未保存修改

- **WHEN** 恢复的点击指向另一个 vault，而当前 vault 有未保存修改
- **THEN** 走既有切换前置门的三出口；用户未选择继续时这次运行不落地，以
  `cron_run_finished(ok=false, error=vault_not_open)` 收尾并给提示；未保存内容未被丢弃，不自动重试

#### Scenario: 恢复的点击运行失败

- **WHEN** 恢复的点击发起的运行以失败终态结束
- **THEN** 落一条 `cron_run_finished(ok=false)` 并给人话提示；当日不自动重跑

#### Scenario: 台账写失败不影响投递

- **WHEN** 派发时台账落盘失败
- **THEN** 通知照常投递、`last_fired` 照写、落一条 warning；该通知随后被点击时按
  `notice_unknown` 拒绝

#### Scenario: 其它环境不声称跨进程能力

- **WHEN** 在 macOS dev flavour 或非 macOS 平台上投递并点击通知
- **THEN** 非 macOS 平台的点击仍走进程内接收通道（`cron_click.source` 为 `in-process`）；dev
  flavour 不声称点击可用；两者都不出现针对跨进程恢复的断言或提示

#### Scenario: delegate 不可用时的降级

- **WHEN** macOS 打包实例的 delegate 安装失败（无 bundle 身份 / 系统拒绝）
- **THEN** 应用照常启动、通知照常投递，落一条 warning；点击接收（进程内与跨进程）一起不可用，
  不声称存在第二条通道

#### Scenario: 启动期安装不拖慢冷启动

- **WHEN** 打包实例在含有效任务的情况下冷启动
- **THEN** delegate 在应用完成启动之前装好，`LUMIR_READY` 与冷启动耗时不受影响（安装路径无
  跨进程查询、无配置 / vault 读写）

## MODIFIED Requirements

### Requirement: 通知的投递与点击唤起

系统 SHALL 经系统通知中心投递通知（macOS 上为通知中心；应用在后台、被遮挡或最小化时同样投递）。
通知标题 SHALL 为任务 `id`，正文 SHALL 是通用文案（「到点」/「已完成」/「运行失败」）；MUST NOT
含任务 prompt 内容、文档正文或 vault 绝对路径。

通知权限：存在至少一条有效任务时，系统 SHALL 在启动装载期检查通知权限；权限未决定 SHALL 申请
一次（系统弹窗）；权限被拒 SHALL 给出一条人话 warning、MUST NOT 反复申请、MUST NOT 阻断守护的
判定或非通知类功能。

点击响应 SHALL 由进程内常驻的通知 delegate 接收并交守护线程处置；MUST NOT 把「逐条通知登记一个
一次性等待」当作唯一接收通道——一次性等待与 delegate 都随进程退出失效，跨进程点击另由「进程退出
后的通知点击恢复」定义。非 macOS 平台与 macOS dev flavour MAY 沿用逐条等待，但 MUST 与 delegate
通道共用同一段「收到点击之后」的处置实现，MUST NOT 各写一套。收到点击（`actionId` 为通知本体，
即 `tap`）后，系统 SHALL 按该任务的触达策略执行：`notify-then-run` → 唤起并聚焦主窗口、必要时经
既有 vault 打开链路打开目标 vault、在交互会话槽位发起运行；`run-then-notify` → 唤起并聚焦主窗口、
恢复该次运行的会话。任一步失败 SHALL 落一条诊断事件并给人话反馈，MUST NOT 静默。诊断事件 SHALL
带 `source` 字段区分来源（进程内 / 跨进程恢复）。

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

#### Scenario: 两种来源共用同一段处置

- **WHEN** 一条通知在投递它的进程内被点击，另一条在进程退出后被点击
- **THEN** 两者落到同一段处置实现：vault 打开、窗口唤起、发起运行或恢复会话的行为逐项相同；
  诊断里仅以 `cron_click.source` 区分来源

#### Scenario: 权限被拒

- **WHEN** 用户拒绝通知权限，配置含合法任务
- **THEN** 启动不失败，产生一条人话 warning；到点不投递通知、不写 `last_fired`；其它任务形态
  （如 `silent-run`）的判定与运行不受影响

#### Scenario: 重复点击幂等

- **WHEN** 同一 `notify-then-run` 通知被连续点击两次，第一次已发起运行
- **THEN** 第二次只聚焦并打开已有运行会话；不新建第二个会话、不产生第二次模型请求

### Requirement: 触发去重状态与持久化

触发去重状态 SHALL 落在配置目录根下的独立小文件 `cron-state.json`（与 `window-state.json` 同
惯例）；MUST NOT 写入 `config.json`，MUST NOT 写入任何 vault。存档 SHALL 记录每个任务最近一次触发的
本地日期（`last_fired`）与最近一次运行的会话标识（`session_id`，在场时），并携带 schema 版本号。

存档 SHALL 另记一份**通知台账**（`notices`；只在 macOS 打包实例上写入——唯一消费者是「进程退出后的
通知点击恢复」，其它平台没有消费者，MUST NOT 写没有消费者的台账）：每条已投递的通知一行——request
id、任务 id、通知种类、派发的本地日期、该次运行的会话标识（结果 / 失败通知在场时）。台账 SHALL
只服务点击的识别与校验，MUST NOT 被当作第二份任务表：它的键是 request id，不含调度要素，也不参与
派发判定；条目 SHALL 在写入时快照，后续运行 MUST NOT 改写既有条目。

投递端口 SHALL 返回该条通知的 request id（平台不提供时由本仓显式指定），台账以它为键。台账的写入
SHALL 分两条路径，各自的原子性判据不同：

- 到点通知（`notify-then-run` 的派发）：台账条目 SHALL 与 `last_fired` 在**同一次**原子替换里
  落盘；
- 结果 / 失败通知（`run-then-notify` 的运行终态之后）：该路径不写 `last_fired`（派发时已写），
  台账条目 SHALL 在投递成功后与**当时的完整状态**在同一次原子替换里落盘，且条目的 `session_id`
  MUST 与同一次落盘里 `tasks.<task>.session_id` 逐字相同——MUST NOT 出现「会话标识已更新、台账
  条目缺失」或两者不一致。

台账 SHALL 有界（按派发日期与条数上限裁剪），裁剪 MUST NOT 触碰 `tasks` 段；两条路径的台账写失败
SHALL 降级为 warning（投递、`last_fired` 与 `session_id` 仍然成立），对应通知随后不可被校验。

`last_fired` 的语义 SHALL 是「该任务在这一本地日期不再派发」——它 SHALL 在两个时机写入：① 派发
成功（通知投递成功，或运行交接被接受）；② 运行期注册引入的新任务在**注册时已过点**时写入当日
种子（见「运行时任务集重载」）。运行失败、运行被跳过、通知投递失败 MUST NOT 写入；启动装载引入的
任务 MUST NOT 写种子（启动补触发是既有语义）。`session_id` SHALL 由运行终态回执更新，消费者是
结果通知的会话恢复与 `dedicated` 的续写。

写入 SHALL 使用临时文件 + rename 原子替换；写失败 SHALL 降级为 warning，MUST NOT 阻断守护循环或
影响其它功能。写入者 SHALL 只有守护线程一处：调度工具 MUST NOT 写该文件（`list` 只读）。读取纪律：
文件缺失、不可读、非合法 JSON、`version` 与实现不符，四类对调用方的语义完全相同——「没有去重
状态」（最多导致一次重复触发），一律 MUST NOT 抛错、MUST NOT 阻断启动；缺失是常态不告警，其余
三类各记一条 warning。任务从配置删除后其状态记录 SHALL 惰性残留，MUST NOT 为清理它做启动期扫描。

#### Scenario: 当日至多一次

- **WHEN** 同一任务当日已派发过（或已写入当日注册种子），随后多次触发判定
- **THEN** 不再投递通知、不再发起运行（状态文件记录当日日期）

#### Scenario: 跨日重新允许

- **WHEN** 昨日已触发且今日到点条件满足
- **THEN** 今日按判据可再次触发一次（本地日期变化即重新允许）

#### Scenario: 注册种子

- **WHEN** 21:30 经调度工具注册一条 `at = "21:00"` 的新任务（注册时已过点）
- **THEN** 状态文件里该任务 `last_fired` 为本日，当日不再派发；次日 21:00 起恢复正常判定

#### Scenario: 未过点的新任务不写种子

- **WHEN** 20:00 注册一条 `at = "21:00"` 的新任务
- **THEN** 状态文件不出现该任务的当日记录；21:00 后按正常判定派发

#### Scenario: 状态文件损坏

- **WHEN** `cron-state.json` 被截断或含非法 JSON
- **THEN** 应用正常启动，视为无状态（最多重复触发一次），并记一条 warning；跨进程点击因台账为空
  而被拒（`notice_unknown`）

#### Scenario: 会话标识随运行更新

- **WHEN** 一次运行到达终态并回执成功
- **THEN** `cron-state.json` 中该任务的 `session_id` 为本次运行的会话；点击结果通知可据此恢复

#### Scenario: 到点通知的台账与去重同次落盘

- **WHEN** 一条「到点」通知被投递并被系统确认送达
- **THEN** 同一次原子替换里既有该通知的台账条目（request id、任务、种类、派发本地日期），也有该
  任务的当日 `last_fired`

#### Scenario: 结果通知的台账与完整状态同次落盘

- **WHEN** `run-then-notify` 的运行终态之后结果（或失败）通知被投递成功
- **THEN** 一次原子替换写入该通知的台账条目与当时的完整状态；条目里的 `session_id` 与
  `tasks.<task>.session_id` 逐字相同；`last_fired` 保持派发时写入的值不变

#### Scenario: 台账条目是快照，不被后续运行改写

- **WHEN** 同一任务次日再次运行并写入新的台账条目
- **THEN** 前一条目的各字段逐字不变；两条条目独立存在

#### Scenario: 台账有界且不碰去重字段

- **WHEN** 派发次数超过台账上限（或条目早于保留窗口）
- **THEN** 最旧的条目被裁剪；`tasks` 段的 `last_fired` / `session_id` 逐字不变

#### Scenario: 不污染配置与 vault

- **WHEN** 完成一次触发与一次运行
- **THEN** 去重状态只出现在 `cron-state.json`；`config.json` 无新增运行态字段；机制自身不向 vault
  写入任何内容（运行期写入由 agent 经既有工具与权限闸完成）

#### Scenario: 工具不写状态

- **WHEN** 一次 `cron_task_list` 调用读出 `last_fired`
- **THEN** 该文件的内容与 mtime 均不被改变（读取不产生写入）
