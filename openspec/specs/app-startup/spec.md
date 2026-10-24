# app-startup Specification

## Purpose

定义应用启动期的呈现契约：主窗 webview 的**首个内容帧**由独立于主模块（编辑器与整壳装配）的启动层绘制启动态——既有骨架几何的占位（只取 `--layout-*` 与 `--hover` / `--border` 色 token）、产品标记（取应用元信息真源，读不到就整体隐藏）、恢复进行中的一行阶段文案（复用既有恢复中提示，不新增文案条目）；不伪造条目 / 计数 / 进度 / 预计时间，零入场动画。启动态在「当前 vault 树装载完成」「vault 状态落到未打开终态」「安全阀（≤10s）超时」三者之一先到时撤下，撤下在单帧内完成；期间保留标题栏拖拽区（窗口可拖动）与启动态内的「打开 vault」入口，用户此间成功打开的 vault 优先于进行中的恢复。首帧之前由启动层读一次配置并施加 `[ui] theme`（同一份配置交给主模块复用），因此启动面第一个内容帧就在当前主题下。边界：不改 `LUMIR_READY` 的位置与语义、setup 零新增同步工作、不新增后端命令、不推迟窗口首次上屏，冷启动主口径 median 增量 ≤10ms。可观测性：启动层首帧与撤下（含 `tree_ready` / `no_vault` / `timeout` / `degraded` 原因）各落一条诊断读数，只用于观察与归因、不进 CI 门禁。由 change `app-splash-screen` 归档并入（2026-10-24，实现 M645）。

## Requirements

### Requirement: 启动态的上屏与撤下

系统 SHALL 在主窗 webview 的**首个内容帧**呈现启动态——覆盖整窗、结构性、只反映真实状态的一个启动面。
该首帧 SHALL 由独立于主模块（编辑器与整壳装配）的启动层绘制，并 MUST 先于主模块的装载完成绘制。窗口上屏
早于启动层首帧的间隙不属于启动态：其时长 SHALL 有诊断读数，本 capability MUST NOT 把该间隙当作已消除
（它由窗口层与页面层的既有底色兜底，主题正确的程度取决于主题何时施加——见
[design.md](../../changes/archive/2026-10-24-app-splash-screen/design.md) §9）。启动层 SHALL 在绘制启动面之前施加界面主题，使启动面的首个内容帧即处于当前主题之下（见「启动态的内容与
视觉口径」）。

启动态 SHALL 在下列三种情形**之一先到**时撤下，撤下 SHALL 在单帧内完成，MUST NOT 有入场 / 退场动画或过渡：

1. 当前 vault 的树装载完成（该 vault 的文件树已在界面可交互地呈现）；
2. vault 状态落到「未打开」终态（无 `last_vault`、路径失效、打开 vault 失败或配置加载失败）；
3. 安全阀超时（实现值 SHALL NOT 长于 10s）——超时后撤下并按既有恢复中态 / 未打开空态呈现，MUST NOT 把
   用户困在启动态。

启动态 MUST NOT 抢键盘焦点、MUST NOT 注册或改写既有键位、MUST NOT 拦截不属于它的输入事件。启动态 SHALL
保留标题栏拖拽区（`data-tauri-drag-region`，与真实壳同口径），窗口在启动态期间 MUST 可拖动；启动面容器
MUST NOT 挂 `mousedown` + `preventDefault`（该写法会静默打断窗口拖拽，见 REVIEW.md『标题栏 mousedown
preventDefault 打断拖拽』条）。启动面的承载 MUST NOT 落在会被壳的建立动作整体替换的容器里：主模块建壳
MUST NOT 使启动态消失，撤下只由前述三种情形触发。启动态期间系统 SHALL 提供「打开 vault」入口（与既有空态
入口同一命令、同一 dirty 守卫路径）；用户在此间成功打开的 vault SHALL 优先于进行中的启动恢复（既有让位
规则逐字不变），启动态 SHALL 随该 vault 的树装载完成撤下。

启动层自身失败（脚本异常、样式缺失）或主模块装载失败时，系统 SHALL 撤下启动态并继续既有启动路径，
MUST NOT 阻断启动、MUST NOT 上屏报错。

#### Scenario: 首个内容帧即启动态

- **WHEN** 冷启动一个带有 `last_vault` 的 vault，观察窗口从出现到树可用的过程
- **THEN** 窗口出现后的首个**内容帧**就是启动态（骨架 + 产品标记，恢复进行中另有一行阶段文案）；MUST NOT 先
  出现半成品壳（标题栏已建、树与正文尚未就位）再被启动态替换；上屏到该帧之间的间隙只允许是底色或空白，
  MUST NOT 含任何界面元素

#### Scenario: 树装载完成后撤下

- **WHEN** 启动恢复成功且当前 vault 的树装载完成
- **THEN** 启动态在同一帧内撤下，界面即为可交互的文件树 + 空态正文；MUST NOT 出现淡出、滑动或延时消失

#### Scenario: 未打开终态撤下

- **WHEN** 启动时没有 `last_vault`，或 `last_vault` 已失效 / 打开失败
- **THEN** vault 状态落地为「未打开」终态的那一刻启动态撤下，界面呈现既有未打开空态（含人话提示与打开入口）

#### Scenario: 安全阀不让用户被困

- **WHEN** vault 状态在安全阀时长内仍未到达任何终态
- **THEN** 启动态撤下并按既有恢复中态呈现（阶段文案 + 打开入口可用），用户可继续等待或另选 vault

#### Scenario: 启动态期间打开另一个 vault

- **WHEN** 启动态仍在场时，用户经启动态内的「打开 vault」入口成功打开了另一个 vault
- **THEN** 本次启动恢复的结果被整体丢弃（既有让位规则），启动态随新 vault 的树装载完成撤下；打开入口全程可用

#### Scenario: 启动层失败降级

- **WHEN** 启动层脚本抛出异常、启动面样式缺失，或主模块装载失败
- **THEN** 启动态被撤下（撤下原因记为降级），既有启动路径继续执行，界面最终落到既有空态或错误提示，MUST NOT
  停在启动面上充当白屏

#### Scenario: 启动态期间窗口可拖动

- **WHEN** 启动态在场时在标题栏区域按下并拖动窗口
- **THEN** 窗口跟随指针移动（与真实壳的拖拽区同口径），启动态不因此撤下、阶段行与骨架不变

### Requirement: 启动态的内容与视觉口径

启动态 SHALL 由三部分构成：**骨架结构**（既有应用骨架的几何占位）、**产品标记**、**阶段行**（只在有真实
状态可说时出现，见下）。

骨架 SHALL 只表达既有骨架几何——标题栏、侧栏、modeline、树行等尺寸一律取既有 `--layout-*` token，启动层
MUST NOT 另写一份像素值；占位块填充 SHALL 只取既有色 token（`--hover` / `--border` 档），MUST NOT 新增色值、
MUST NOT 新增只对启动态成立的主题覆盖。骨架 MUST NOT 伪造条目名、文件名、条目计数、进度百分比或预计剩余时间。
标题栏占位带 SHALL 承载窗口拖拽区（与真实壳的标题栏同口径）。

产品标记 SHALL 取应用元信息真源（`tauri.conf.json` 的 `productName`，经既有内置通道读取）；读取失败或尚未
就绪时该标记 SHALL 整体隐藏，MUST NOT 显示占位名、MUST NOT 硬编码产品名副本。启动态 MUST NOT 显示版本号
（版本号的常显位是真实壳的标题栏标识块）。

阶段行 SHALL 只反映真实状态：恢复进行中时取既有「恢复中提示」文案（文案真源仍是 `文案-Copy.md` 与运行时
文案表）；其余阶段 MUST NOT 显示任何文案，MUST NOT 显示进度百分比或剩余时间。

启动态 SHALL 在三主题（light / dark / eink）下同构成立、颜色全部取该主题 token；启动层 SHALL 在绘制首个内容帧
之前施加 `[ui] theme`，MUST NOT 先以默认主题块出图再切换。启动态 MUST NOT 引入入场动画，MUST NOT 引入
`ui-design-system`「chrome 表面与动效纪律」之外的过渡时长或缓动曲线。

#### Scenario: 几何与颜色只认 token

- **WHEN** 在任意主题下截取启动态首帧，把标题栏 / 侧栏 / modeline / 树行的实际尺寸与 `--layout-*` 的解析值对比
- **THEN** 逐项相等；启动面没有任何硬编码的像素尺寸，也没有任何不在 token 表里的颜色值

#### Scenario: 不伪造内容

- **WHEN** 检查启动态的 DOM 文本与占位块
- **THEN** 除产品名与（恢复中的）阶段行外没有任何文本；没有假文件名、假条目数、百分比或剩余时间

#### Scenario: 产品名取真源、读不到就隐藏

- **WHEN** 应用元信息读取失败（非 Tauri 环境或通道异常）时启动
- **THEN** 启动态不显示任何产品名（骨架与阶段行照常），MUST NOT 出现占位串或硬编码副本

#### Scenario: 阶段行只在恢复进行中

- **WHEN** 分别在「有 `last_vault` 的恢复进行中」与「无 `last_vault`」两种情形下观察启动态
- **THEN** 前者显示既有恢复中提示文案，后者不显示任何阶段文案

#### Scenario: 三主题首帧主题正确

- **WHEN** 分别以 `[ui] theme` = light / dark / eink 启动
- **THEN** 启动态首个内容帧的底色与占位块颜色即该主题 token 的解析值，MUST NOT 先以默认（light）主题块出现再翻转

#### Scenario: 零动画

- **WHEN** 审查启动面的样式声明
- **THEN** 启动面没有任何 `animation` 或 `transition` 声明，撤下是单帧移除

### Requirement: 启动态与启动链路的边界

`LUMIR_READY` 的发射位置与语义 SHALL 保持不变。Tauri setup MUST NOT 因启动态新增任何同步工作，MUST NOT 新增
后端启动读取或后端命令。启动层在首帧之前 MUST NOT 发起与启动态无关的 IO：除启动链路本来就要发起的那一次配置
读取（可并发读取应用元信息）之外，MUST NOT 读取 vault、MUST NOT 读取会话或索引。该次配置读取的结果 SHALL 由
启动层交给主模块复用——同一份配置 MUST NOT 为启动层与主模块各读一次（同一读数只发起一处）。

启动态 MUST NOT 推迟窗口首次上屏（既有尺寸施加、显示与激活时序不变），也 MUST NOT 改变启动恢复的并发结构
（`restore_pending` 语义、`vault:restore_finished` 事件、让位规则逐条不变）。

性能判据：同一机器、改动前后两份构建产物的对比中，冷启动主口径（spawn → `LUMIR_READY`）的 median 增量
MUST NOT 超过 10ms（每轮 n≥20）。冷启动端点的定义、测量方法与阈值归 `perf-measurement`，本 capability
MUST NOT 定义第二套冷启动口径、MUST NOT 因启动态调整既有门禁模式或容忍线。

#### Scenario: ready 端点不动

- **WHEN** 冷启动测量读取 `LUMIR_READY` 行
- **THEN** 行内容、发射位置与语义与改动前逐字一致，读数不含启动层与启动态的耗时

#### Scenario: setup 零新增同步工作

- **WHEN** 对比改动前后的 Tauri setup 实现
- **THEN** setup 内没有新增任何同步 IO、窗口操作或配置读取；启动态的建立全部发生在 webview 前端

#### Scenario: 冷启动读数不劣化

- **WHEN** 同机对改动前 / 改动后的构建各采样 n≥20 次冷启动
- **THEN** spawn → `LUMIR_READY` 的 median 增量 ≤10ms；超出即视为本 change 的设计失败，而非调整容忍线

#### Scenario: 不读 vault

- **WHEN** 审查启动层在首帧之前发出的调用
- **THEN** 只有配置读取与应用元信息读取；没有任何 vault、会话或索引读取

### Requirement: 启动态的可观测性

启动层 SHALL 把两个时刻落进既有诊断日志通道（`log_event` 的 JSONL 落盘）：启动层首帧绘制完成、启动态撤下。
撤下读数 SHALL 携带撤下原因，取值集合为 `tree_ready` / `no_vault` / `timeout` / `degraded`。两条读数的载荷
MUST NOT 含 vault 名、路径、文件名或任何文档内容，只允许阶段名、撤下原因、相对页面导航开始的毫秒数与 unix
毫秒时间戳（后者用于与 `LUMIR_READY` 的 `ts_unix_ms` 对照，得出「窗口上屏 → 启动层首帧」的间隙）。新增的
事件名与字段名 MUST 先登记进后端白名单，MUST NOT 绕过白名单落盘。

这两条读数 SHALL 只用于观察与归因，MUST NOT 作为 CI 门禁判据（前端首帧时刻在被测量的端点之外，理由见
`perf-measurement` 的「冷启动测量」）。

#### Scenario: 两条读数按序落盘

- **WHEN** 一次正常的冷启动完成
- **THEN** 诊断日志里依次出现首帧读数与撤下读数，撤下原因为 `tree_ready`

#### Scenario: 撤下原因可区分

- **WHEN** 分别在恢复成功、无 `last_vault`、安全阀超时、启动层失败四种情形下启动
- **THEN** 撤下读数分别记为 `tree_ready` / `no_vault` / `timeout` / `degraded`，四者可被日志检索区分

#### Scenario: 载荷无敏感信息

- **WHEN** 检查两条读数的全部字段与值
- **THEN** 不含 vault 名、绝对路径、文件名或文档内容；只有阶段名、撤下原因、毫秒数与 unix 毫秒时间戳

#### Scenario: 不进 CI 门禁

- **WHEN** 查看 `perf.yml` 与 `tests/perf/thresholds.json`
- **THEN** 没有因本 capability 新增的端点、指标或阈值；两条读数只出现在本地诊断日志
