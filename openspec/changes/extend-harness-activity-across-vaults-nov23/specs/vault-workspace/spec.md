# vault-workspace Specification Delta

> 起草注记（非规格正文）：本条只新增「行级活动标记」这一呈现合同；活动记录的真源与终态归类归
> `harness` 的「面板收起与跨 vault 的活动在场」条，本 capability MUST NOT 另写一份状态机或第二张表。
> 机制与取舍见 [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。
>
> **D2 裁定值**：三态（在途 / 未读回复 / 未读失败），2026-11-23 节点 1 按推荐值批准（Alex 原话
> 「三项推荐。」）。本 delta 与 `harness` 条中的「三态同源」表述即为批准口径；「只做未读两档」的
> 退路不再适用，实现期若需缩减须重走节点 1。

## ADDED Requirements

### Requirement: vault 列表行的活动状态

vault 切换器浮层的行 SHALL 呈现该行 vault 的活动状态，且**只在该行不是当前 vault 时**呈现：当前 vault
的活动由标题栏 harness toggle 钮承载，同一状态 MUST NOT 在两处同时出现。行级状态 SHALL 与标题栏钮复用
同一份按 vault 键控的活动记录（见 `harness` 的「面板收起与跨 vault 的活动在场」条），MUST NOT 由后端新增
字段、MUST NOT 由本 capability 另存一份、MUST NOT 在列表拉取之外维护常驻镜像。

行级状态 SHALL 只有三态：在途 / 有未读回复 / 有未读失败；空闲态 MUST NOT 产生任何标记。三态 SHALL 复用
标题栏钮的形状语言与同一档尺寸（在途 = 空心环、未读回复 = 实心点、未读失败 = 实心点 + 外环，6×6），
形状承载语义、颜色只作增强，eink 主题下 MUST NOT 依赖彩色或中间调区分。标记 SHALL 是行内空的
`aria-hidden` 元素：MUST NOT 新增文本、MUST NOT 使用数字计数、MUST NOT 进入行的可访问名；状态词 SHALL
只写进该行切换钮的 `title`（`<显示名> · <状态词>`），空闲行 MUST NOT 新增 `title`。状态词 SHALL 复用既有
D870–D872（处理中 / 有新的回复 / 有失败结果），MUST NOT 新增 copy key。

标记 SHALL 落在该行切换钮的矩形内（右端），MUST NOT 越出切换钮、MUST NOT 与移除钮相交、MUST NOT 压住
移除钮；MUST NOT 引入新的滚动容器，`.vault-list` 的滚动条档位不变。标记的在场 MUST NOT 改变行高、行宽、
排序、筛选匹配对象、键盘游标空间或点击落点；空闲行 MUST NOT 新增任何上屏像素。行标记 MUST NOT 引入
常态动画、`aria-live` 播报或焦点变化。

行级状态 SHALL 只在浮层打开时可见：浮层关闭时标记随行 DOM 一起消失，MUST NOT 留下常驻角标、树头部标记、
Dock 徽标或系统通知。浮层打开期间记录发生变化（如某非当前 vault 的在途轮次到达终态）时，行的标记 SHALL
就地更新（不重新拉取列表、不重排、不改变游标）；列表仍按既有纪律每次打开重新拉取，注册表是唯一真源。
行级状态 MUST NOT 跨应用重启或 webview 重载持久化。

活动记录的键 SHALL 与 `harness` 条同源（后端事件信封的 vault 根路径 / 当前 vault 根）；行数据里的路径
与记录键对不上时（含极老注册项的旧拼写）SHALL 视为无记录、MUST NOT 显示标记——fail-closed，不猜测映射、
不在本 capability 规范化注册表路径或改变列表身份。

#### Scenario: 非当前行呈在途

- **WHEN** 在 vault A 发起一轮（处理中），收起面板并切到 B，随后打开切换器
- **THEN** A 的行呈「处理中」标记（空心环），B 的行不显示任何标记；标记完全落在 A 行切换钮矩形内，
  MUST NOT 与移除钮相交

#### Scenario: 非当前行呈未读回复

- **WHEN** vault A 的一轮在 A 的 transcript 不在屏幕上时正常结束，用户在 B 打开切换器
- **THEN** A 的行呈「有新的回复」标记（实心点），该行切换钮的 `title` 为「A 的显示名 · 有新的回复」；
  行内文本与可访问名不因标记改变

#### Scenario: 非当前行呈未读失败且与回复可辨

- **WHEN** vault A 的一轮以错误终态结束，用户在 B 打开切换器
- **THEN** A 的行呈「有失败结果」标记（实心点 + 外环），与「有新的回复」不单靠颜色可辨；eink 主题下
  两态仍靠形状可辨

#### Scenario: 当前行不重复显示

- **WHEN** 当前 vault A 有在途或未读，用户打开切换器
- **THEN** A 的行 MUST NOT 显示任何活动标记（由标题栏钮承载）；其它非当前行的标记照常呈现

#### Scenario: 空闲行零新增像素

- **WHEN** 所有非当前 vault 都空闲，用户打开切换器
- **THEN** 各行的上屏像素与本次改动前相同：没有标记节点、没有新增 `title`、没有新增占位宽度

#### Scenario: 浮层关闭即不可见

- **WHEN** 某非当前 vault 有未读，用户关闭切换器后再观察左栏
- **THEN** MUST NOT 出现常驻角标、树头部标记、数字或其它浮层外的提示；再次打开浮层时按该 vault 的当前
  记录重建标记

#### Scenario: 浮层打开期间记录变化就地更新

- **WHEN** 切换器打开时，某非当前 vault 的在途轮次到达正常终态
- **THEN** 该行的标记在本次浮层内由「处理中」变为「有新的回复」；列表 MUST NOT 重新拉取、行序与游标
  MUST NOT 改变

#### Scenario: 显式移除后不残留

- **WHEN** 某非当前 vault 有未读，用户显式移除该 vault（后端按实际打开根丢弃记录）
- **THEN** 对应的行与标记随列表消失；重新加入同一目录铸新 id 时 MUST NOT 复活旧记录

#### Scenario: 无行记录不产生可见标记

- **WHEN** 注册表变化后某 vault 已不在列表，但其内存活动记录尚未被显式移除清掉（含旧拼写导致行查不到
  记录的情形）
- **THEN** 该记录 MUST NOT 在任何行、树头部或标题栏钮上产生可见标记；它 MAY 留到应用重启 / webview
  重载，属非持久化边界；本 capability MUST NOT 以注册表原值 `path` 做周期性清理

#### Scenario: 旧拼写路径不误报

- **WHEN** 注册表里极老注册项的 `path` 与后端事件信封的 vault 根是同一目录的两种拼写
- **THEN** 该行按无记录处理、MUST NOT 显示标记（fail-closed）；当前 vault 的标题栏钮仍按事件键正常呈现，
  MUST NOT 为对齐拼写而规范化列表身份或改写注册项

#### Scenario: 三主题与语言纪律

- **WHEN** 在 light / dark / eink 三主题下分别呈现三态，或把界面语言切到 zh / en
- **THEN** 三态在每一主题下都可辨（eink 靠形状）；状态词随语言重绘，取值来自既有 D870–D872 文案表，
  MUST NOT 新增 copy key
