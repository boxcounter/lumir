# harness Specification Delta

> 起草注记（非规格正文）：本 delta 只改「面板收起与跨 vault 的活动在场」一条 requirement，MODIFIED 块
> 按当前 living spec 的整条正文复制再改（`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档
> 时静默消失）。机制与取舍见 [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。

## MODIFIED Requirements

### Requirement: 面板收起与跨 vault 的活动在场

harness 面板的活动状态 MUST NOT 只存在于面板内部。活动 SHALL 按 vault 根路径记账：标题栏 harness toggle 钮
（`harness.toggle` 的可见入口）呈现**当前 vault 会话**的活动；vault 切换器浮层的非当前行呈现**该行 vault**
的活动（行级呈现的完整合同见 `vault-workspace` 的「vault 列表行的活动状态」条）。标题栏三态可辨：空闲 /
在途 / 有未读结果；三态 SHALL 同时在钮的可访问描述上可读（MUST NOT 只靠颜色承载语义）：状态词 SHALL 同时
写进该钮的 `title`——WKWebView 把钮当叶子节点，钮内文本不进 AX 树、`aria-describedby` 指向的隐藏文本在
自动化通道里读不到，`title`（AX `help`）是三态可判定读数的唯一载体。该钮挂在标题栏且面板展开时不在场上
（既有退让条款），因此三态的在场判据 SHALL 取收起态（面板展开期间的读数由面板内既有的发送钮 / 阶段行
承载）。活动提示 MUST NOT 自动展开面板、MUST NOT 抢焦点、MUST NOT 切换 vault、MUST NOT 触发系统通知，
也 MUST NOT 引入新的全局键位；行级标记 MUST NOT 在浮层收起时可见（不得变成常驻角标）。

**在途**的判据 SHALL 只有一个：该 vault 的轮次状态；同一份按 vault 键控的活动记录 SHALL 同时服务标题栏钮
与切换器行，两处 MUST NOT 各存一份。当前 vault 的呈现读 SHALL 取后端会话的轮次状态。后端 SHALL 把「轮次
在跑」与「终态已发、会话尚未释放」区分成两个状态，`harness_state` 快照 SHALL 携带**呈现读** `in_flight`
——它只在「轮次在跑、终态未发」时为真，在「终态已发、尚未释放」窗口里 MUST 为假。用于协议判定（在途拒绝
新的发送 / 新会话）的**协议读** SHALL 保持今天的语义（终态已发、尚未释放时仍视为占用），两读 MUST 由同
一个会话级轮次状态派生，MUST NOT 各存一份。该状态 SHALL 覆盖**全部轮次来源**——用户发送、点击发起的 cron
运行、唤醒链的自动回合——以及**该轮次的全部终态路径**（正常完成、配置级失败、内部错误 / panic、空响应、
用户停止、程序性中止）；MUST NOT 只对普通回合成立（自动回合的失败路径同样经历「终态已发、尚未释放」的
窗口）。面板在装载、切回 vault、恢复会话三个时点 SHALL 按**进入快照**的 `in_flight` 恢复相位，MUST NOT
因视图复位（切 vault 时的 `resetView`）或事件按 vault 过滤而把一个仍在途的轮次呈现为空闲；`in_flight`
为假时 SHALL 就地收口（相位空闲、轮次闸门关闭、清「中途接管」标记），MUST NOT 等一个可能永远不会到达的
终态事件。前端 MUST NOT 保存终态记忆，也 MUST NOT 把 `harness_busy` 拒绝当作在途证据——拒绝只可能来自上
述「终态已发、尚未释放」窗口或本地假空闲，处置 SHALL 是重取一次快照并按 `in_flight` 应用，MUST NOT 直接
改相位。

非当前 vault 的轮次状态 SHALL 由该 vault 的 `harness:event` 信封派生：轮次开始取本地发送的乐观起点（同步
拒绝时按发送前的记录回滚）或后端 `auto_turn_started`，轮次结束取该 vault 的 `done` / `error` / `aborted`
终态。派生理由 SHALL 是 `harness_state` 只服务当前 vault、非当前 vault 没有快照可读；切回该 vault 后的进入
快照 SHALL 以 `in_flight` 与事件记录对账一次，MUST NOT 让两读长期分叉。事件派生只是同一记录的输入，
MUST NOT 引入第二张未读表、第二个相位状态机或第二份后端真源。

**停止子态** SHALL 沿用既有两态机的语义：running 下点击停止进入 stopping、重复点击保持 stopping（幂等）、
终态统一收口回 idle；本能力 MUST NOT 另立第二套相位状态机——相位只有一份投影。

**终态与释放的次序 MUST NOT 反转**：改成「先释放再发终态」会让旧轮终态落到其后开始的新轮上（新轮被误认为
结束、后续增量被轮次闸门丢弃），因此终态的发射先于会话释放这一既有次序 SHALL 保持不变；两个状态的区分
由后端轮次状态承担，MUST NOT 由前端按时序猜测。终态对账用的那份快照 MUST NOT 参与相位判定，只重建内容。

切回一个仍在途的 vault 时，该轮次**尚未上屏的后续增量** SHALL 继续渲染（轮次闸门随相位一并恢复）；
该轮次到达终态时，面板 SHALL 以后端会话快照对账一次渲染面，MUST NOT 把缺少开头部分的中途正文当作该轮的
完整回答留在 transcript 里。

**未读结果** SHALL 只由轮次终态产生，并按终态种类分档：正常结束 = 有新的回复；错误终态 = 有失败结果；
用户主动停止（`aborted`）MUST NOT 产生未读，也 MUST NOT 清除既有未读。未读只在该 vault 的 transcript
不在屏幕上期间产生；**已读 = 该 vault 的 transcript 真的在屏幕上**，判据 SHALL 是「该 vault 是当前 vault、
且 harness pane 对它在场（布局已落定）」——不看窗口焦点、不看应用是否前台。重新打开面板 SHALL 清除当前
vault 的未读（已读清算的入口之一）；切到一个布局里有 harness pane 的 vault、面板随布局在场时 SHALL 清除
该 vault 的未读；切过去但面板收起（或目标布局没有 harness pane）MUST NOT 清除，标记保留并转由标题栏钮
承载。切换 vault 本身是视图复位口径，MUST NOT 被当作已读（见下）。MUST NOT 使用数字计数，MUST NOT 为同一
vault 累计多条未读。

**作用域与来源**：活动记录 SHALL 按 vault 根路径键控，覆盖该 vault 的用户发送、点击发起的 cron 运行与唤
醒链的自动回合；标题栏钮 SHALL 只呈现当前 vault 的记录，切换器行 SHALL 只呈现**非当前 vault** 的行，当前
vault 的行 MUST NOT 重复呈现（当前行由标题栏钮承载，避免同一状态两处出现）。切换 vault MUST NOT 清空任一
vault 的未读；视图复位（新会话 / 恢复历史会话 / cron 点击运行切屏 / cron 发起失败回滚 / cron 通知打开会话）
SHALL 只清**动作发起时捕获的 vault** 的记录（换会话即换视图）；MUST NOT 按异步回包到达时的当前 vault
清除——在 A 发起
新会话 / 恢复、回包到达前切到 B 时，只清 A，B 的记录 MUST NOT 被误清。显式删除 / 重定位 vault 时 SHALL
按后端实际打开根丢弃该 vault 的记录；实际根不可得时 MUST NOT 改用注册表原值 `path` 猜键，记录 MAY 留到
重载。系统 MUST NOT 以注册表路径做周期性清理（旧拼写不同会误删当前标题栏仍在用的记录）。未匹配到实际根、
已无行可显示的内存记录 MAY 留到重载，属非持久化边界：它 MUST NOT 产生任何可见标记，MUST NOT 被当作
「已读 / 未读」的可见状态。无人值守 / 后台 cron 运行（隔离 runtime、事件不进当前 transcript）MUST NOT
参与该记录——它们的完成走 cron 自己的通知通道；点击发起的 cron 运行走交互槽位，按普通轮次呈现。后台子
代理完成通知（`notice`）不单独产生未读，其未读由所属轮次的终态承担。审批等待（`approval_request` 挂起）
归「在途」档，MUST NOT 单独成为一档未读（它等待处置，不是「已完成、待你看」的结果）。未读水位 MUST NOT 跨应用重启或 webview 重载回放：应用重启后所有
vault 从空闲开始；webview 重载后未读同样不回放，但当前 vault 的真实在途 SHALL 仍按进入快照的 `in_flight`
恢复（MUST NOT 因此把在途呈现为空闲），非当前 vault 没有快照、重载后其相位与未读暂时未知，直到该 vault
的后续事件到达或用户切回它并读快照。

**视觉与主题**：空闲态 MUST NOT 新增任何上屏像素（既有整页基线不因本能力更新）；三态形状 SHALL 承载语义、
颜色只作增强，eink 主题下 MUST NOT 依赖彩色或中间调区分。标题栏钮与切换器行 SHALL 复用同一套形状语言
（在途 = 空心环、未读回复 = 实心点、未读失败 = 实心点 + 外环）与同一档 6×6 尺寸；行标记 MUST NOT 新增
文本或计数，状态词 SHALL 只写进该行切换钮的 `title`，行内文本、可访问名与点击定位 MUST NOT 因它改变。
MUST NOT 引入常态动画（因此 `prefers-reduced-motion` 无分支）。状态文案 SHALL 走文案表 zh/en 双档并随界面
语言切换重绘（复用既有 D870–D872，不新增 copy key）。

#### Scenario: 收起期间完成一轮并点亮未读

- **WHEN** 面板打开、发送一条提问后立即收起面板（`⌘⇧A`），该轮随后正常结束
- **THEN** 收起期间标题栏 toggle 钮呈「在途」态（可访问描述为处理中）；轮次结束后转为「有新的回复」态，
  本轮的增量与终态 MUST NOT 把面板重新展开、MUST NOT 抢走焦点

#### Scenario: 收起期间失败轮次呈失败档

- **WHEN** 面板收起期间到达一个错误终态（`error`）
- **THEN** 指示呈「有失败结果」态，与「有新的回复」在形状上可辨（不单靠颜色）

#### Scenario: 用户主动停止不产生未读

- **WHEN** 一轮在途时用户点击停止，并在 `aborted` 终态到达之前收起面板（终态在收起期间到达）
- **THEN** 指示回到空闲态，MUST NOT 留下未读标记

#### Scenario: 重新打开面板即清算未读

- **WHEN** 指示处于「有新的回复」态，用户经 `⌘⇧A` / toggle 钮打开面板
- **THEN** 未读标记立即消失、指示呈空闲（该轮若仍在途则呈在途），面板内容按既有恢复路径正常呈现

#### Scenario: 终态已发、尚未释放的窗口报不在途

- **WHEN** 一轮已发出终态（`done` / `error` / `aborted` 任一）、会话尚未释放（协议上仍占用），此时读快照
- **THEN** 快照的呈现读为「不在途」，面板保持空闲（或按该终态种类呈未读档），MUST NOT 复活为在途、
  MUST NOT 重开轮次闸门；对账快照只重建内容，不参与相位判定

#### Scenario: 终态后立即发送被拒不复活

- **WHEN** 面板已处理完终态、用户在上述窗口内发送，后端以 `harness_busy` 拒绝
- **THEN** 面板只上一条错误行并重取一次快照（呈现读仍为不在途），MUST NOT 因这次拒绝把相位改成在途；
  用户随后重试正常发出（窗口结束）

#### Scenario: 离开期间发生的终态由进入快照收口

- **WHEN** 在 vault A 发起一轮、切到 B、该轮在 B 期间结束（vault A 的 transcript 不在屏幕上），随后在 B
  打开切换器
- **THEN** A 的行呈「有新的回复」（不是「处理中」；该轮终态已收口）；切到 A（面板仍收起）后标题栏钮呈
  「有新的回复」，再次打开切换器时 A 行不显示标记（当前行由钮承载）；进入快照的呈现读为「不在途」，
  面板就地收口（相位空闲、轮次闸门关闭、清接管标记），MUST NOT 停在「处理中」等一个不会到达的事件；
  打开面板后该轮的回答按快照完整呈现，未读随之清除

#### Scenario: 自动唤醒回合的终态同样收口

- **WHEN** 唤醒链的自动回合在配置级失败或内部错误（panic）上结束，此时会话尚未释放（协议上仍占用）
- **THEN** 快照的呈现读为「不在途」，面板当轮收口（相位空闲、轮次闸门关闭），MUST NOT 因该回合的
  `auto_turn_started` 曾把相位置为处理中而停在空闲之外——自动回合的失败路径与普通回合同一条判据

#### Scenario: 停止中的相位与幂等

- **WHEN** 一轮在途（running）时点击发送钮的停止态，随后再次点击（连点），直到终态到达
- **THEN** 相位在首次点击后进入 stopping、重复点击保持 stopping（幂等，不重复发停止请求）；期间到达的
  快照 MUST NOT 把它改回 running 或提前收口；终态到达后相位回到 idle

#### Scenario: 跨 vault 往返仍在途不呈空闲

- **WHEN** 在 vault A 发起一轮对话（处理中）、切到 vault B、再切回 A，此时该轮仍在后端运行
- **THEN** 切回 A 后标题栏指示与面板内发送钮都呈处理中（发送钮为停止态），MUST NOT 出现「看似可发送」的
  空闲态——用户不会在以为空闲的状态下撞上「对话正在进行中」的拒绝

#### Scenario: 切回后在途轮次续渲染并对账

- **WHEN** 切回一个仍在途的 vault，该轮随后产出更多正文并正常结束
- **THEN** 切回之后的增量继续上屏；终态到达时渲染面按后端快照对账，transcript 里该轮呈现与留存一致的完整
  回答（MUST NOT 留下缺开头的半截正文）

#### Scenario: 未读不计数

- **WHEN** 面板收起期间先后有两个轮次到达终态（第二个由唤醒链的自动回合发起，含一个失败）
- **THEN** 指示仍只是一枚状态标记，MUST NOT 出现数字计数或第二条标记

#### Scenario: 重复切换不丢在途状态

- **WHEN** 一轮在 vault A 处理中，用户在同一次会话里反复在 A / B 之间切换多次（A→B→A→B→A）
- **THEN** 每次切回 A 指示都仍呈在途（不因切换次数累积成多条未读、也不掉回空闲）；该轮终态只收口一次，
  transcript 里不出现重复消息，切回后的增量照常上屏

#### Scenario: 后台 cron 运行不点亮指示

- **WHEN** 一个无人值守 / 定时 cron 运行在后台完成（隔离 runtime，事件不进当前 transcript）
- **THEN** 标题栏指示的相位与未读态都不因这次运行改变；其完成提示仍走 cron 既有通知通道

#### Scenario: 点击发起的 cron 运行按普通轮次呈现

- **WHEN** 用户点击 cron 通知发起一次运行（交互槽位），随后收起面板
- **THEN** 收起期间指示呈在途，运行结束后按普通轮次点亮未读

#### Scenario: cron 发起失败回滚按发起 vault 收口

- **WHEN** 在 vault A 点击 cron 通知发起运行（`beginCronRun` 已复位 A 的视图），请求在途时切到 B，随后
  运行发起被拒
- **THEN** 只回滚 A 的记录与视图；B 的记录、transcript、输入区与快照 MUST NOT 被复位或重取；A 的失败
  提示不写进 B；切回 A 时按快照重建

#### Scenario: cron 通知恢复跨 vault 不操作当前视图

- **WHEN** 点击 vault A 的结果通知恢复会话，`harness_resume_session` 在途时切到 B，随后恢复成功
- **THEN** 只复位 A 的记录；B MUST NOT 被打开 harness pane、MUST NOT 清未读、MUST NOT 重取快照；A 的
  恢复内容不渲染进 B，切回 A 时按快照重建

#### Scenario: 非当前 vault 的在途在行上可见

- **WHEN** 在 vault A 发起一轮（处理中），收起面板并切到 B，随后打开切换器
- **THEN** A 的行呈「处理中」（空心环），当前 vault B 的行不显示任何标记；标记落在 A 行切换钮矩形内，
  MUST NOT 压住移除钮、MUST NOT 出现数字或第二枚标记

#### Scenario: 切过去但面板收起不清未读

- **WHEN** vault A 有「有新的回复」未读，用户从 B 切到 A，而 A 的存储布局里没有 harness pane（切过去后
  面板仍是收起态）
- **THEN** 切换本身 MUST NOT 清除未读；标题栏钮呈「有新的回复」，再次打开切换器时 A 行不显示标记
  （当前行由钮承载）；随后用户经 `⌘⇧A` 打开面板，未读才清除

#### Scenario: 目标布局有 harness pane 时随在场清算

- **WHEN** vault A 有「有失败结果」未读，用户从 B 切到 A，A 的存储布局里 harness pane 在场
- **THEN** 布局落定、面板随在场后该未读清除，标题栏钮回到空闲；MUST NOT 在布局落定之前凭切换动作抢先
  清算（切换窗口内到达的终态按「不在屏幕上」保守记未读，由随后的在场信号校正）

#### Scenario: 审批等待归在途

- **WHEN** vault A 的一轮因工具审批挂起（`approval_request` 等待处置），用户切到 B 并打开切换器
- **THEN** A 的行呈「处理中」，MUST NOT 呈「有新的回复」或「有失败结果」；该档不引入第四种清算语义

#### Scenario: 停止不清既有未读

- **WHEN** vault A 已有「有新的回复」未读，A 又发起一轮并在终态前被用户主动停止，用户在 `aborted` 到达前
  切到 B
- **THEN** A 的行仍呈「有新的回复」，MUST NOT 因这次 `aborted` 清除既有未读、MUST NOT 改呈「有失败结果」

#### Scenario: 停止请求被拒不关掉新轮

- **WHEN** vault A 的一轮在途时用户点击停止并切到 B；停止请求随后被后端拒绝为「没有在途轮次」，而 A 的
  记录已因终态回到空闲或已开始新的一轮
- **THEN** 拒绝只收口停止中的那一轮：记录已 idle 或已 running 时 MUST NOT 被改回 idle、MUST NOT 改写
  新轮的相位；错误行 MUST NOT 写进 B 的视图

#### Scenario: 后台通知不单独点亮

- **WHEN** 后台子代理完成并发出 `notice`，但没有触发自动唤醒回合
- **THEN** 该 vault 的记录不因 `notice` 产生未读；若 `notice` 触发了自动唤醒回合，未读由该回合的终态按
  普通轮次产生

#### Scenario: 无人值守 cron 不参与跨 vault 记录

- **WHEN** 一个无人值守 / 定时 cron 运行针对非当前 vault 到点（后端结构上拒绝跨 vault 派发，隔离 runtime
  也不发面板事件）
- **THEN** 任何 vault 的行与标题栏钮都不因这次运行改变；其完成提示仍走 cron 既有通知通道

#### Scenario: 浮层收起时行标记不可见

- **WHEN** 某非当前 vault 有未读，用户关闭 vault 切换器
- **THEN** 行标记随浮层一起消失，MUST NOT 留下常驻角标、树头部标记或数字；再次打开浮层时按该 vault 的
  当前记录重建标记（不在关闭期间维护常驻 DOM 镜像）

#### Scenario: 新会话回包跨 vault 只清发起 vault

- **WHEN** 在 vault A 发起「新会话」，回包到达前切到 B，回包随后到达
- **THEN** 只清 A 的记录（A 从新会话起算）；B 的在途与未读记录 MUST NOT 被清、B 的视图 MUST NOT 被这次
  回包重建；切回 A 时按 A 的会话快照呈现

#### Scenario: 恢复回包跨 vault 只清发起 vault

- **WHEN** 在 vault A 恢复一个历史会话，回包到达前切到 B，回包随后到达
- **THEN** 只清 A 的记录；B 的记录与视图不受影响；A 恢复后的会话内容按既有恢复路径呈现，MUST NOT 把
  恢复内容写进 B 的 transcript

#### Scenario: 发送拒绝按发送时 vault 收口

- **WHEN** 在 vault A 发送后立即切到 B，A 的发送随后被同步拒绝（`harness_busy` / 缺配置）
- **THEN** 只撤销 A 的乐观在途记录（回到发送前状态）；B 的轮次闸门、transcript 与输入区 MUST NOT 被
  这次拒绝改动；切回 A 后不呈假在途

#### Scenario: 重启与 webview 重载不保留

- **WHEN** 某 vault 有未读时应用退出并重启，或 webview 重载且当前 vault 仍有一轮在后端运行
- **THEN** 应用重启：所有 vault 从空闲开始，MUST NOT 从磁盘回放未读；webview 重载：未读同样不回放，但
  当前 vault 的真实在途 SHALL 按进入快照的 `in_flight` 恢复、MUST NOT 呈假空闲；非当前 vault 没有快照，
  重载后其相位与未读暂时未知，直到该 vault 的后续事件到达或用户切回它并读快照（场景名的「不保留」只指
  未读水位，不指在途）

#### Scenario: 行标记不改变行的既有口径

- **WHEN** 非当前 vault 行显示「有新的回复」标记，用户输入查询筛选、用 ↑↓ 移动游标或点击该行
- **THEN** 匹配对象仍是显示名、结果集与游标空间不变、行内文本与可访问名不因标记改变、点击仍按既有
  切换语义发起切换；标记 MUST NOT 引入第二套键位或改变排序

#### Scenario: 三主题与语言纪律

- **WHEN** 在 light / dark / eink 三主题下分别呈现在途、未读回复、未读失败三态，或把界面语言切到 zh / en
- **THEN** 三态在每一主题下都可辨（eink 靠形状、不用彩色与中间调）；状态文案随语言重绘，取值来自文案表

#### Scenario: 空闲态零像素漂移

- **WHEN** 会话空闲且面板收起
- **THEN** toggle 钮的上屏像素与本次改动前逐像素相同（既有整页基线不更新）；三态的「在场」由结构断言守卫，
  MUST NOT 依赖整页像素容差（6px 级元素落在容差预算之内，像素对比对它没有区分度）
