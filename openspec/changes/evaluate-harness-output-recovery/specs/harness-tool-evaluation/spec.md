# harness-tool-evaluation Specification（delta）

> 本 capability 定义 harness 工具「输出预算 / 结果形状 / 错误恢复」类候选的评估方法学：
> 候选如何独立裁决、离线判据要证明什么、真实 provider 实验如何预注册、证据与结论边界在哪。
> 它不定义任何候选的产品行为——候选被采纳后由独立的实现 change 落地。

## ADDED Requirements

### Requirement: 候选独立裁决

评估 SHALL 把每个待验证的工具行为候选定义为独立的裁决单元：每个候选有自己的 control（现状）、
treatment（候选改动）、预注册判据与结论记录。MUST NOT 以「一组改动整体上线」作为默认形态，
MUST NOT 用一项候选的实验数据推断另一项候选。

评估制品 MUST NOT 直接改变产品行为：候选达到采纳阈值时，实现 SHALL 由后续独立 change 承载；
候选被拒绝时 SHALL 记录拒绝理由与可重启条件（什么新证据会让它重启）。为跑实验所需的
treatment 实现 SHALL 与产品分支隔离（独立实验分支，不合入产品分支），它不构成本评估 change 的
产品行为变更。每个候选的结论 SHALL 是 `adopt` / `reject` / `undecided` 之一，三者 MUST NOT
互相替代。

#### Scenario: 三项候选分别裁决

- **WHEN** 三项候选各自完成预注册实验
- **THEN** 每项独立产出 `adopt` / `reject` / `undecided` 结论，允许任意组合（例如只采纳第二项、
  拒绝其余两项）

#### Scenario: 评估不直接上线

- **WHEN** 某候选达到预注册的采纳阈值
- **THEN** 评估 change 本身不修改产品代码；实现由后续 change 完成，并在该 change 内补齐规格增量

#### Scenario: 拒绝也要留重启条件

- **WHEN** 某候选被判 `reject`
- **THEN** 结论记录写明依据、未达阈值的方向与可重启条件；MUST NOT 只写「不采纳」而无理由

### Requirement: 离线机器判据

每个候选 SHALL 有可在无网络、无真实 provider、无真机的条件下执行的离线判据，至少覆盖：
缺省取值下的现状同一性、边界值、预算上限、去重与合并语义、行号语义、省略量精确性、错误回执的
必需信息。判据 SHALL 断言结构字段或整条模板，MUST NOT 用子串匹配代替结构断言。

离线断言 SHALL 分为三类，红 / 绿与证据要求不同：

- **候选行为断言（收益侧 / 代价侧）**：断言候选引入的行为变化。收益侧断言新能力带来什么；
  代价侧断言候选按设计丢掉了什么（例如「某段内容在 treatment 上不可见」）。两类都 SHALL 先在
  control 实现上运行并证明会失败，再在 treatment 上运行并通过；红 / 绿两次读数 SHALL 落证据。
  代价侧断言 MUST NOT 被登记为 identity / 守门断言。
- **identity / 守门断言**：断言缺省值与现状一致，或既有行为未被候选改动（含「另一个工具的输出
  逐字节不变」）。SHALL 在 control 与 treatment 上**均通过**；MUST NOT 要求红侧证据，也 MUST NOT
  因为「control 已经是绿的」而把它移出判据。
- **静态对账元判据**：不针对单个实现版本的行为，而是断言两份静态清单互相对齐（例如「有下一步
  模板的 code 集合 == 工具实际产出的 code 集合」）。SHALL 在 control 与 treatment 两版上以同一份
  源码 / 表运行并记录比对输出；MUST NOT 要求红 / 绿方向，但失败即判实现不完整或表已过期，判据
  无效，实验不得开跑。

把 identity / 守门断言写成「必须先红」、把候选行为断言只做「两版均绿」、或把静态对账元判据
塞进前两类而不写证据规则，都 SHALL 判为判据无效。离线判据通过 SHALL 只表示形状合同成立，
MUST NOT 被表述为行为收益已验证。

#### Scenario: 缺省取值同一性

- **WHEN** 对同一 vault 状态分别用 control 与 treatment 执行候选的缺省取值
- **THEN** 两者的结果逐字段一致；出现任何差异都判 FAIL

#### Scenario: 候选行为断言先在 control 上红

- **WHEN** 新增一条针对候选新行为的断言（收益侧或代价侧）
- **THEN** 先在 control 实现上运行并记录失败输出，再在 treatment 上运行并记录通过输出；没有
  红侧读数的候选行为断言 MUST NOT 进入判据

#### Scenario: 代价侧断言不是 identity

- **WHEN** 一条断言的内容是「某段内容或某个事实在 treatment 上不可见」
- **THEN** 它属于候选行为断言·代价侧：control 应红（内容可见）、treatment 应绿（内容不可见）；
  MUST NOT 被登记为「两版均绿」的 identity / 守门断言

#### Scenario: identity / 守门断言两版均绿

- **WHEN** 运行缺省值同一性、既有输出逐字节不变、或防回归类断言
- **THEN** 这些断言在 control 与 treatment 上均通过，且不要求红侧证据；MUST NOT 为让候选行为
  断言通过而删除守门断言

#### Scenario: 静态对账元判据的证据

- **WHEN** 运行静态对账元判据
- **THEN** 两版以同一份源码 / 表运行并记录比对输出；失败即判实现不完整或表已过期，判据无效、
  实验不得开跑

#### Scenario: 三类断言不得混用

- **WHEN** 一条断言同时被登记为两类（例如既写「必须先在 control 上红」又写「两版均绿」），或
  静态对账元判据没有证据规则
- **THEN** 判据无效，必须重新归类并同步设计、spec 与 tasks

### Requirement: 真实 provider 实验预注册

每个候选在发起真实 provider 请求前 SHALL 预注册：任务族（合成任务与留出真实任务）、模型与
provider、fresh session 口径、A/B 交错与盲法、任务表述不点名被测参数、指标定义、样本量、序贯
中止规则与判据阈值。预注册内容 MUST NOT 在数据产生后修改；协议偏离 SHALL 记录并在报告中单独
列出，MUST NOT 与未偏离数据合并成同一结论。

指标 SHALL 至少包含任务成功率、总工具调用数、总 token、截断后追加调用数与人工介入次数；任务
成功 SHALL 由预注册的验证器或盲评量规判定，MUST NOT 只按工具序列判定。成功率 SHALL 以区间形式
报告；成本指标 SHALL 以中位数与重采样区间报告。实际有效样本量低于预注册值时结论 SHALL 为
`undecided`，MUST NOT 降级为采纳或拒绝。

#### Scenario: 样本不足不裁决

- **WHEN** 某候选的实际有效配对样本少于预注册值
- **THEN** 结论记为 `undecided`，报告写明缺口与原因；MUST NOT 写成 `adopt` 或 `reject`

#### Scenario: 任务表述不点名参数

- **WHEN** 生成真实 provider 实验的任务表述
- **THEN** 表述里不出现被测参数名、取值或「头尾 / 上下文 / 省略 / 下一步」等提示词；协议检查
  逐条记录通过，出现一处即不得开跑

#### Scenario: 工具序列不是成功判据

- **WHEN** 一次 run 的工具调用顺序与预期完全一致，但产物不满足预注册验证器
- **THEN** 该 run 判为失败；工具序列只用于成本与诊断指标

### Requirement: 证据边界与隐私

真实 provider 与真机不可用期间，评估 SHALL 只完成离线部分；报告 MUST 把未验证的结论项逐条标为
「未验证」，MUST NOT 用离线结果推断模型行为收益。原始超长输出未被留存的既有事实 SHALL 写入
限制，MUST NOT 据截断后的结果反推原始长度或内容。

实验 SHALL 使用隔离配置与合成 vault：真实 vault 只读，需要写入的真实任务在 git 外（`.local/`）
的副本上进行。原始会话记录 SHALL 落 git 外的 `.local/`；仓库内只留合成 fixture 与聚合读数。
评估过程 MUST NOT 读取、复制或打印真实 provider 凭据，MUST NOT 把真实 vault 内容写入入库制品。

#### Scenario: 原始超长不可反推

- **WHEN** 分析一份已截断的历史结果
- **THEN** 报告只描述可见部分的形状；MUST NOT 断言被省略内容的长度、位置或内容

#### Scenario: 凭据不入证据

- **WHEN** 收集真实 provider 实验证据
- **THEN** 证据文件不含 API key、`Authorization` 头或配置里的密钥字段；发现即按协议违规处理，
  删除该文件、记录事件，且不进入报告

#### Scenario: 暂缓期结论标注

- **WHEN** 真实 provider 与真机尚未可用
- **THEN** 报告把「模型是否因此少走几步 / 成功率是否上升」一类结论逐条标为「未验证」，只保留
  形状合同与机会规模两类可核读数
