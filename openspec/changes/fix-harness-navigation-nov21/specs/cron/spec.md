# cron 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/cron/spec.md](../../../../specs/cron/spec.md) 的「通知的投递与点击唤起」。
> 改动面只有一处语义：点击结果通知时的**焦点归属**——pane 展开与会话恢复照旧，但键盘焦点
> MUST NOT 从正文编辑器移到 harness composer；正文焦点与阅读位置原地保留。
> 其余段落逐字沿用 living spec。
>
> **MODIFIED 是整块替换**：按 living spec 全文抄录后就地改，MUST NOT 只写改动段。

## MODIFIED Requirements

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

点击结果通知（`run-then-notify` / `silent-run` 的终态通知，以及幂等重复点击）时的**键盘焦点** SHALL
保持在点击前的正文编辑器上：系统 SHALL 展开 harness pane 并恢复该次运行的会话（pane 已存在时同样
确保可见与内容恢复），但 MUST NOT 把焦点移到 harness composer，MUST NOT 改变正文的阅读位置。显式
打开 / 切换 harness（`harness.toggle` 等用户主动动作）的 composer 聚焦行为 MUST NOT 受此条影响。

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

#### Scenario: 结果通知点击不抢正文焦点

- **WHEN** 文档编辑器持有键盘焦点时，用户点击 `run-then-notify` 的结果通知（harness pane 关闭或已
  打开两种状态）
- **THEN** 窗口被唤起、harness pane 展开 / 保持可见、该次运行的会话恢复并可继续对话；键盘焦点仍在
  正文编辑器，正文的阅读位置不变；随后的键入落在正文而不是 harness composer

#### Scenario: 权限被拒

- **WHEN** 用户拒绝通知权限，配置含合法任务
- **THEN** 启动不失败，产生一条人话 warning；到点不投递通知、不写 `last_fired`；其它任务形态
  （如 `silent-run`）的判定与运行不受影响

#### Scenario: 重复点击幂等

- **WHEN** 同一 `notify-then-run` 通知被连续点击两次，第一次已发起运行
- **THEN** 第二次只聚焦并打开已有运行会话；不新建第二个会话、不产生第二次模型请求
