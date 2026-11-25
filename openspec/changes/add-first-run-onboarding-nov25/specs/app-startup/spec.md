# app-startup 增量规格

> 起草注记（非规格正文）：本 delta 改两条 requirement——「启动态的上屏与撤下」加入首启模式的撤下
> 规则，「启动态的内容与视觉口径」加入首启模式的构成与居中口径。两条都整条复制 living 正文再改；
> 其余 requirement 与 Scenario 不动。首启判定 / tips / 默认 harness 在 `first-run-onboarding`。

## MODIFIED Requirements

### Requirement: 启动态的上屏与撤下

系统 SHALL 在主窗 webview 的**首个内容帧**呈现启动态——覆盖整窗、结构性、只反映真实状态的一个启动面。该首帧 SHALL 由独立于主模块（编辑器与整壳装配）的启动层绘制，并 MUST 先于主模块的装载完成绘制。窗口上屏早于启动层首帧的间隙不属于启动态：其时长 SHALL 有诊断读数，本 capability MUST NOT 把该间隙当作已消除（它由窗口层与页面层的既有底色兜底，主题正确的程度取决于主题何时施加——见 [design.md](../../../archive/2026-10-24-app-splash-screen/design.md) §9）。启动层 SHALL 在绘制启动面之前施加界面主题，使启动面的首个内容帧即处于当前主题之下（见「启动态的内容与视觉口径」）。

启动态 SHALL 在下列三种情形**之一先到**时撤下，撤下 SHALL 在单帧内完成，MUST NOT 有入场 / 退场动画或过渡：

1. 当前 vault 的树装载完成（该 vault 的文件树已在界面可交互地呈现）；
2. vault 状态落到「未打开」终态（无 `last_vault`、路径失效、打开 vault 失败或配置加载失败）；
3. 安全阀超时（实现值 SHALL NOT 长于 10s）——超时后撤下并按既有恢复中态 / 未打开空态呈现，MUST NOT 把用户困在启动态。

真正首次启动（启动快照 `last_vault === null`）SHALL 进入启动态的**首启模式**：首启模式 MUST NOT 因 `no_vault` 终态或安全阀超时撤下；其撤下条件收窄为「首个 vault 的树装载完成」与「启动层 / 主模块失败降级」两条，且 MUST NOT 先露出既有树空态。非首启的三种撤下情形与顺序逐字不变。安全阀在首启模式下不生效——首启没有「正在恢复上次打开的 vault」这件事可说，启动面内的唯一主操作始终可用。

启动态 MUST NOT 抢键盘焦点、MUST NOT 注册或改写既有键位；除首启模式的命令闸门（见下）外，MUST NOT 拦截不属于它的输入事件。启动态 SHALL 保留标题栏拖拽区（`data-tauri-drag-region`，与真实壳同口径），窗口在启动态期间 MUST 可拖动；启动面容器 MUST NOT 挂 `mousedown` + `preventDefault`（该写法会静默打断窗口拖拽，见 REVIEW.md『标题栏 mousedown preventDefault 打断拖拽』条）。启动面的承载 MUST NOT 落在会被壳的建立动作整体替换的容器里：主模块建壳 MUST NOT 使启动态消失，撤下只由前述条件触发。启动态期间系统 SHALL 提供「打开 vault」入口（与既有空态入口同一命令、同一 dirty 守卫路径）；首启模式的入口文案 SHALL 为「添加 vault」，命令与守卫路径不变。用户在此间成功打开的 vault SHALL 优先于进行中的启动恢复（既有让位规则逐字不变），启动态 SHALL 随该 vault 的树装载完成撤下。首启模式在场期间工作区尚未进入：工作区（`#app`）的标题栏、文件树、编辑器与 modeline SHALL 对辅助技术隐藏且不可交互，唯一可交互的是启动面内的「添加 vault」入口。首启模式在场期间，系统 SHALL 在工作区命令分发层统一阻断命令：默认键位、配置重绑后的分发器与原生菜单命令三条来源 MUST 走同一个闸门；唯一例外是启动面内的添加 vault 入口。闸门 MUST NOT 产生工作区 DOM / IPC / 布局副作用，也 MUST NOT 拦截非绑定键或启动面按钮的可达性。

启动层自身失败（脚本异常、样式缺失）或主模块装载失败时，系统 SHALL 撤下启动态并继续既有启动路径，MUST NOT 阻断启动、MUST NOT 上屏报错。

#### Scenario: 首个内容帧即启动态

- **WHEN** 冷启动一个带有 `last_vault` 的 vault，观察窗口从出现到树可用的过程
- **THEN** 窗口出现后的首个**内容帧**就是启动态（骨架 + 产品标记，恢复进行中另有一行阶段文案）；MUST NOT 先出现半成品壳（标题栏已建、树与正文尚未就位）再被启动态替换；上屏到该帧之间的间隙只允许是底色或空白，MUST NOT 含任何界面元素

#### Scenario: 树装载完成后撤下

- **WHEN** 启动恢复成功且当前 vault 的树装载完成
- **THEN** 启动态在同一帧内撤下，界面即为可交互的文件树 + 空态正文；MUST NOT 出现淡出、滑动或延时消失

#### Scenario: 未打开终态撤下

- **WHEN** 启动时没有 `last_vault`，或 `last_vault` 已失效 / 打开失败
- **THEN** 非首启时，vault 状态落地为「未打开」终态的那一刻启动态撤下，界面呈现既有未打开空态（含人话提示与打开入口）；真正首次启动时，启动态保持在场（首启模式），MUST NOT 露出既有树空态

#### Scenario: 首启模式不因 no_vault / 超时撤下

- **WHEN** 真正首次启动且无 vault，`vault_current` 返回未打开终态，且经过时间超过安全阀时长
- **THEN** 启动态仍在场，唯一的「添加 vault」主操作可用；MUST NOT 出现树空态、D5 / D6 或恢复中阶段行

#### Scenario: 首启模式树就绪撤下

- **WHEN** 用户在首启模式中成功打开首个 vault，文件树就绪
- **THEN** 启动态在同一帧内撤下，工作区出现；MUST NOT 出现淡出、滑动或延时消失

#### Scenario: 首启模式阻断工作区命令

- **WHEN** 首启模式在场，依次按 `Cmd-,` / `Cmd-Shift-A` / `Cmd-/`（含一次经 `[keys]` 重绑后重装的现场）
- **THEN** 设置面板、harness pane、键位面板都不出现；没有 settings / config IPC、没有 pane / 布局变化；「添加 vault」仍是唯一可执行动作；首启模式撤下后同一组键在非首启下行为不变，且 `#app` 不带 `inert` / aria-hidden（设置面板不会留下背景隔离）

#### Scenario: 安全阀不让用户被困

- **WHEN** 非首启的恢复中状态在安全阀时长内仍未到达任何终态
- **THEN** 启动态撤下并按既有恢复中态呈现（阶段文案 + 打开入口可用），用户可继续等待或另选 vault

#### Scenario: 启动态期间打开另一个 vault

- **WHEN** 启动态仍在场时，用户经启动态内的「打开 vault」入口成功打开了另一个 vault
- **THEN** 本次启动恢复的结果被整体丢弃（既有让位规则），启动态随新 vault 的树装载完成撤下；打开入口全程可用

#### Scenario: 启动层失败降级

- **WHEN** 启动层脚本抛出异常、启动面样式缺失，或主模块装载失败
- **THEN** 启动态被撤下（撤下原因记为降级），既有启动路径继续执行，界面最终落到既有空态或错误提示，MUST NOT 停在启动面上充当白屏

#### Scenario: 启动态期间窗口可拖动

- **WHEN** 启动态在场时在标题栏区域按下并拖动窗口
- **THEN** 窗口跟随指针移动（与真实壳的拖拽区同口径），启动态不因此撤下、阶段行与骨架不变

### Requirement: 启动态的内容与视觉口径

启动态 SHALL 由三部分构成：**骨架结构**（既有应用骨架的几何占位）、**产品标记**、**阶段行**（只在有真实状态可说时出现，见下）。**首启模式是唯一例外**：真正首次启动时，启动态 SHALL 只由唯一「添加 vault」主操作构成，MUST NOT 建骨架、产品标记或阶段行；该主操作 SHALL 在主窗口中水平与垂直居中（按钮中心与 viewport 中心的偏差在取整后不超过 1 CSS px）。下述骨架 / 产品标记 / 阶段行条款只适用于非首启的启动态；首启模式只受三主题、token、零动画与居中条款约束。

骨架 SHALL 只表达既有骨架几何——标题栏、侧栏、modeline、树行等尺寸一律取既有 `--layout-*` token，启动层 MUST NOT 另写一份像素值；占位块填充 SHALL 只取既有色 token（`--hover` / `--border` 档），MUST NOT 新增色值、MUST NOT 新增只对启动态成立的主题覆盖。骨架 MUST NOT 伪造条目名、文件名、条目计数、进度百分比或预计剩余时间。标题栏占位带 SHALL 承载窗口拖拽区（与真实壳的标题栏同口径）。首启模式不建骨架，但同样 SHALL 保留一个透明或同色的顶部拖拽带，尺寸取 `--layout-titlebar-h`，带 `data-tauri-drag-region="deep"`，且容器 MUST NOT 挂 `mousedown` + `preventDefault`。

产品标记 SHALL 取应用元信息真源（`tauri.conf.json` 的 `productName`，经既有内置通道读取）；读取失败或尚未就绪时该标记 SHALL 整体隐藏，MUST NOT 显示占位名、MUST NOT 硬编码产品名副本。启动态 MUST NOT 显示版本号（版本号的常显位是真实壳的标题栏标识块）。首启模式不建产品标记——窗口标题 / 系统 chrome 承担身份，启动面内不显示第二个身份件。

阶段行 SHALL 只反映真实状态：恢复进行中时取既有「恢复中提示」文案（文案真源仍是 `文案-Copy.md` 与运行时文案表）；其余阶段 MUST NOT 显示任何文案，MUST NOT 显示进度百分比或剩余时间。首启模式没有恢复进行中状态，MUST NOT 建阶段行。

启动态 SHALL 在三主题（light / dark / eink）下同构成立、颜色全部取该主题 token；启动层 SHALL 在绘制首个内容帧之前施加 `[ui] theme`，MUST NOT 先以默认主题块出图再切换。启动态 MUST NOT 引入入场动画，MUST NOT 引入 `ui-design-system`「chrome 表面与动效纪律」之外的过渡时长或缓动曲线。

#### Scenario: 几何与颜色只认 token

- **WHEN** 在非首启的启动态下截取首帧，把标题栏 / 侧栏 / modeline / 树行的实际尺寸与 `--layout-*` 的解析值对比
- **THEN** 逐项相等；启动面没有任何硬编码的像素尺寸，也没有任何不在 token 表里的颜色值

#### Scenario: 首启模式只有一个居中主操作

- **WHEN** 真正首次启动且无 vault，启动态首帧上屏
- **THEN** 启动面内只有「添加 vault」主操作；按钮中心与窗口水平、垂直中心的偏差不超过 1 CSS px；MUST NOT 出现骨架、产品标记、阶段行、D5 / D6 树空态或第二个按钮

#### Scenario: 不伪造内容

- **WHEN** 检查非首启启动态的 DOM 文本与占位块
- **THEN** 除产品名与（恢复中的）阶段行外没有任何文本；没有假文件名、假条目数、百分比或剩余时间

#### Scenario: 产品名取真源、读不到就隐藏

- **WHEN** 非首启启动时应用元信息读取失败（非 Tauri 环境或通道异常）
- **THEN** 启动态不显示任何产品名（骨架与阶段行照常），MUST NOT 出现占位串或硬编码副本

#### Scenario: 阶段行只在恢复进行中

- **WHEN** 分别在「非首启、有 `last_vault` 的恢复进行中」与「首启模式（启动快照 `last_vault === null`）」两种情形下观察启动态
- **THEN** 前者显示既有恢复中提示文案；后者不建阶段行、不显示任何阶段文案

#### Scenario: 三主题首帧主题正确

- **WHEN** 分别以 `[ui] theme` = light / dark / eink 启动
- **THEN** 启动态首个内容帧的底色与占位块颜色即该主题 token 的解析值，MUST NOT 先以默认（light）主题块出现再翻转

#### Scenario: 零动画

- **WHEN** 审查启动面的样式声明
- **THEN** 启动面没有任何 `animation` 或 `transition` 声明，撤下是单帧移除
