# ui-design-system Specification

## Purpose
定义 UI 设计系统的落地口径：视觉决策全部经单层 CSS 自定义属性（token 层）表达，其分层 / 命名 /
值与收敛纪律以 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) 为唯一权威文本；
三主题（light / dark / eink）的取值、选择与运行期切换来源；eink 降级规则 9 条（色彩退场、线宽与
字重强调）；应用骨架布局（标题栏 / 侧栏 / modeline / 内容区的几何与层级）；chrome 表面与动效纪律
（阴影两档、浮层壳、过渡时长）；以及视觉基线处置（整页基线重建属人肉裁决点，逐张过目后才提交）。
由 change `restyle-ui-tokens-v1` 归档并入（2026-09-27，实现 M210–M213 + 收口修复 M217–M222）。由 change `pane-system-split-view` 归档并入的增量（2026-10-05，实现 M315–M322）：正文栏泛化为 pane 容器（v1 上限两个横向 pane，分栏时容器级 hairline 分隔条可拖拽、位置按 vault 持久化），双 pane 时标题栏右簇退让（产品标识块退 modeline、harness 开关钮隐藏），单 pane 逐像素不变。

## Requirements

### Requirement: 设计 token 层

系统 SHALL 以单层 CSS 自定义属性承载全部视觉决策，token 的分层、命名、值与收敛纪律以
[design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) 为权威文本（色彩 32 × 三主题、
字体 29、间距 14、圆角 8、布局 16、动效 4，共 103 个）。界面样式 SHALL 经 token 引用取值，
MUST NOT 在 token 层之外新增字面色值、字号或间距；仅有的例外是 tokens 文档点名的组件常量
（行内补偿与已调优组件内边距）与 eink 规则的组件级覆盖（见「eink 降级规则」）。

旧 editorial token（`--bg` / `--bg-nav` / `--bg-2` / `--bg-3` / `--bd-1..3` / `--dim` /
`--sel` / `--selection-ink` / `--radius` / `--measure` / `--nav-width` / `--font-display` /
`--line-height`）SHALL 按 tokens 文档 §与现行实现的差距 的映射表替换或删除，MUST NOT 以别名
形式保留双名（同一语义两处真源）。

阴影 SHALL 只有两档、各自专用：`--shadow-pop`（active tab，「同平面相连」）与
`--shadow-raise`（浮层专用：popover / modal 面板 / toast，「悬空」；v1.1 增补，三主题值
与推导见 tokens 文档 §浮层 elevation 与遮罩）；全屏遮罩 SHALL 取 `--scrim`（它不是第三档
阴影）。浮层壳 SHALL 为 `--preview-bg` + 1px `--border` + `--shadow-raise`（eink：白底 +
实心黑框、modal 类 1.4px 线宽，无阴影）；`--shadow-raise` MUST NOT 用在任何平铺表面。
两档之外新增阴影 SHALL 走裁决。平铺表面的界面层次 SHALL 继续靠两档 hairline
（`--border` 结构档 / `--border-soft` 层次档）与底色差承担。

周边表面（toc 大纲浮层、vault 切换浮层、搜索面板、lightbox、键位面板、toast、空态）
SHALL 按本 change design §2.7 的类推映射表组装（换皮不改交互）；浮层壳与遮罩没有类推
依据的部分 SHALL 取 `--shadow-raise` / `--scrim`。

#### Scenario: token 层是取值的唯一来源

- **WHEN** 抽查界面任一表面的计算样式（底色 / 文字色 / 边线 / 圆角 / 间距）
- **THEN** 其值可回溯到 tokens 文档登记的某个 token；`rg` 全仓不出现旧 token 名的存活引用

#### Scenario: 阴影两档、浮层专用

- **WHEN** 审查全仓 `box-shadow` 声明
- **THEN** 非 `none` 的投影只出现在 active tab（`--shadow-pop`）与浮层（`--shadow-raise`）
  两处；任一平铺表面（侧栏 / 面板 / 卡片 / 按钮）带投影即违规

#### Scenario: callout 语义收敛

- **WHEN** 渲染 13 类 callout（note/abstract/info/todo/tip/success/question/warning/failure/danger/bug/example/quote）
- **THEN** 每类的色条与底色只取自五族语义 token——蓝 `--accent`+`--accent-tint`、
  绿 `--ok`+`--ok-tint`、琥珀 `--pending`+`--pending-tint`、红 `--danger`+`--danger-tint`、
  灰 `--text-3`+`--agent-bg`（逐类映射以 tokens 文档 §callout 语义收敛 为准）；
  不出现逐类独立色值与 `color-mix` 现混底色；同族类型的区分只靠标题行文字，不引入图标；
  eink 下全部色条为实心黑、底色回落到 `--content-bg`（eink 即白——tint token 在全黑档取
  `transparent`，行底因此由内容面承担）

### Requirement: 三主题与主题选择

系统 SHALL 提供 light / dark / eink 三个主题，同一套 token 名经 `data-theme` 属性切换取值；
三主题 SHALL 共享同一套非色 token（字体阶梯 / 间距 / 圆角 / 布局 / 动效）——「共享结构与排版
基因，只分档对比度」。主题选择 SHALL 走配置：`[ui]` 配置表的 `theme` 字段（`light` / `dark` /
`eink`，默认 `light`）是**启动真源**，启动装载时读一次并施加；非法值 SHALL 回落 `light` 并附
一条人话 warning（配置即数据 + schema 校验，ADR 0002 §5）。MUST NOT 引入跟随系统
（`prefers-color-scheme`）通道。

主题 SHALL 支持**运行期切换**（本 change 修订 restyle-ui-tokens-v1 节点 1 裁决 D3 的「重启
生效」部分）：切换入口为命令 `view.theme-cycle`（循环 light → dark → eink，键位口径见
`keymap-commands` 的「主题切换命令」）与 modeline 右段的主题指示钮——钮文案 SHALL 为当前
主题名（常驻的「这是哪个主题」归因出口），点击 SHALL 与命令走同一条切换路径。切换 SHALL
即时生效：改写 `<html data-theme>` 后 token 层、chrome 表面、CM 编辑器主题、两路语法高亮、
KaTeX 全部经 CSS 变量跟随，MUST NOT 要求重启或整窗 reload。启动施加与运行期切换 SHALL
共用同一施加点（同一函数写 `data-theme`），MUST NOT 出现第二处主题写入者。

mermaid 已渲染 SVG SHALL 在主题切换时按新主题重渲染（颜色烧进 SVG 内联样式，CSS 变量无法
事后跟随）：切换时使渲染缓存与 initialize 态失效、经 `previewRefresh` 触发装饰重建，重建期间
各块回落既有 pending 占位，重渲经既有串行队列与有限 settle；切换前已发出的渲染（in-flight）
settle 时 SHALL 按主题世代号丢弃，旧主题色 SVG MUST NOT 落地为新缓存。

运行期切换 SHALL 在切换时把新主题写回 `config.json` 的 `[ui] theme`（合并既有内容、原子写），
让启动真源跟上运行态；写回失败 SHALL NOT 阻塞或回滚运行期切换——主题保持已切换状态，并以
toast 告知「重启后将回到配置文件值」。主题指示钮与相关 chrome 样式 SHALL 只取 token 层取值
（eink 下适用 chip 描边化规则），MUST NOT 引入新色值。

#### Scenario: 配置驱动主题

- **WHEN** 配置 `ui.theme` 为 `dark`（或 `eink`）并启动
- **THEN** 首帧即为对应主题：底色、文字、边线、语法高亮取该主题的 token 值；未配置时与
  `light` 逐项一致

#### Scenario: 非法值回落

- **WHEN** 配置 `ui.theme` 为取值表之外的字符串
- **THEN** 记一条 warning、主题为 `light`，界面无其他可见变化

#### Scenario: 运行期切换即时生效

- **WHEN** 在运行期经 `view.theme-cycle` 命令（或点击 modeline 主题指示钮）切换主题
- **THEN** `data-theme` 立即改写，chrome 表面与编辑器（含语法高亮）的计算样式同步跟随到新
  主题取值，全程不重启、不整窗 reload；modeline 指示钮文案同步更新为新主题名；三档循环
  顺序为 light → dark → eink → light

#### Scenario: mermaid 按新主题重渲染

- **WHEN** 含已渲染 mermaid 图的文档在运行期切换主题
- **THEN** 各 mermaid 块先回落「渲染中…」占位，随后以新主题的 token 取值重渲染并 settle；
  切换前发出的渲染结果不得落地（旧色 SVG 不出现在切换后的界面上）

#### Scenario: 切换写回与失败降级

- **WHEN** 运行期切换主题成功
- **THEN** `config.json` 的 `[ui] theme` 被写回为新主题（文件中其他字段保持不变），下次启动
  首帧即为该主题；写回失败时界面保持新主题、弹出 toast 告知重启后回落，应用其他行为不受
  影响

### Requirement: eink 降级规则

eink 主题 SHALL 按 tokens 文档 §eink 规则 的 9 条系统性降级（不是换一套色板）：
①色彩全退场（accent 与语义色 = `#000`，全部 tint = `transparent`）；②对比改由字重与明度
承担（语法高亮 keyword 700 纯黑、comment 降灰）；③hairline 结构档实心黑、层次档保留灰；
④选中态取**明度带 + 黑字**（M291 起「黑底反白」整条退场，见 docs/specs/design-tokens-v1.md §选区族），组件内次级元素（badge / chip / ghost 项）SHALL 同步取选中前景 `--sel-text`；⑤浅底区块
（代码块 / frontmatter 区）翻转为白底黑框；⑥chip 描边化；⑦阴影全退场；⑧强调档改由线宽
承担（1.2–1.6px）；⑨wikilink 从药丸降级为下划线。eink 下组件内的字面色值 SHALL 只出现在
这套选中/降级规则里，MUST NOT 散落成各组件自造的灰。

#### Scenario: eink 下信息不依赖色相

- **WHEN** 以 eink 主题打开含代码块、frontmatter、wikilink、选中树行的文档
- **THEN** 代码注释与代码凭明度区分（灰 vs 黑）、keyword 凭字重区分（700）；fm 区与代码块
  为白底黑框；选中树行为明度带 + 黑字；wikilink 以下划线标识；全屏无任何彩色像素

#### Scenario: eink 的强调档是线宽

- **WHEN** eink 主题下查看 active tab 与 focus 态输入框
- **THEN** 其边线粗于常规 hairline（1.4px / 1.6px），且阴影不存在

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽**恒等于侧栏当前宽度**并与侧栏对齐，**产品标识块位于 traffic 灯区内、系统按钮旁**——见「产品名与版本号常显」；标签位于标题栏内——单 pane 常态；双 pane 时标签区左右分区为两槽，左槽 = 左 pane 标签、右槽 = 右 pane 标签，槽宽比例随分隔条，见 `multi-tabs` 的「标签栏的显示与形态」）/ 主行（侧栏 + **内容区（pane 容器）**）/ modeline 25px（全宽）。**右栏 dock 列随本 change 移除**（harness 归位 pane，`--layout-dock-w` 与 `.dock-open` 机制一并清扫）。内容区 SHALL 是 pane 容器（v1 上限两个横向 pane，见 `pane-layout` 的「pane 容器模型」与「harness pane」）：未分栏时它承载单个文档 pane，**几何与 pane 化之前的正文栏逐像素一致**；分栏时两个 pane 以分隔条相隔，分隔条是容器级 hairline 元素（`--border` 档，平铺表面不吃 elevation），其位置可拖拽调整（拖拽重排实时生效，松手后位置经会话持久化通道落盘，per-vault，见 `vault-workspace` 的「按 vault 持久化 pane 布局」）。

**侧栏宽度与收起**（change add-sidebar-resize-hide-and-root-create）：侧栏宽度 SHALL 是**可调**的——出厂默认 236px，用户 SHALL 能经侧栏与内容区之间的分隔条拖拽调整，合法区间 `[180, 480]`，窗口过窄时 SHALL 按窗口宽度的四成再钳一次（显示口径，不影响落盘值）。拖拽 SHALL 实时重排（rAF 合并，拖拽期 MUST NOT 产生 IPC），松手且值有变化时 SHALL 经既有合并写通道持久化（配置键 `ui.sidebar_width`），写失败 SHALL 只提示、MUST NOT 回滚运行期宽度。侧栏右缘与标题栏 traffic 区 SHALL 继续像素对齐（两者读同一宽度真源，MUST NOT 各存一份宽度）。

侧栏 SHALL 可收起与展开，且**同一命令往返**（`view.toggle-sidebar`，默认 ⌘B，见 `keymap-commands`）：收起时侧栏列宽 SHALL 归 0、侧栏内容不显示（树模型与展开态 MUST NOT 被销毁或重建）、标题栏 traffic 区 SHALL 回到「原生交通灯 + 产品标识块」的最小宽（MUST NOT 留出 236px 空位）；展开时 SHALL 回到收起前的宽度。收起 SHALL 先收掉左栏内的在手交互（右键菜单关闭、进行中的行内重命名 / 新建按取消处理），焦点在左栏内时 SHALL 先把焦点交还活跃文档 pane——MUST NOT 留下焦点在不可见元素上的状态。收起状态 MUST NOT 跨启动持久化（每次启动显示侧栏）。

**标题栏 harness 段**：harness 在场时，标题栏的标签区之后 SHALL 出现 harness 段（会话名下拉 + 新建会话钮，行为见 `harness` 的「会话边界」），与标签段同构；段宽 SHALL 与 pane 实际宽度像素对齐（实现机制：分栏态标题栏弹性区与内容区容器同宽——padding 归零 / toggle 隐藏 / spinner 绝对定位——标签槽与 harness 段挂同一份 splitRatio 分宽；这是几何构造的对齐，MUST NOT 用与 pane 宽度脱节的固定比例近似）。标题栏右端动作钮区保留 harness toggle 钮（尺寸吃既有 `--layout-tb-btn-w/h` token，与 `harness.toggle` 命令同一路径）。双 pane（含 harness pane 在场）时标题栏右簇 SHALL 退让——harness 开关钮隐藏（`⌘⇧A` 照走）；产品标识块已在最左，不再是退让对象；单 pane 且无 harness 时右簇全量在场、逐像素不变（chrome 只在空间紧张时退让）。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 → modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 → modeline 右侧（只读派生自**活跃 pane 的前台**编辑器状态，MUST NOT 为此引入全文档遍历或新状态源，ADR 0002 §6）。macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件（单 pane 常态、无 harness）
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列按既有阅读宽口径居中、**无 dock 列**；内容区、标签区、modeline 与 pane 化之前**逐像素一致**；modeline 左侧显示当前文件的 vault 相对路径，右侧显示语法 / 行数 / 编码

#### Scenario: 分栏后的容器几何

- **WHEN** 执行 `pane.split`（双 pane）
- **THEN** 内容区内出现两个横向 pane，各占容器约一半（默认 0.5），以一条 hairline 分隔条相隔；侧栏 236px、标题栏 42px、modeline 25px 均不受影响；标题栏标签区同步左右分区为两槽（槽宽比例与分隔条一致），右簇退让（harness 开关钮隐藏），顶部恒为一条横带；拖拽分隔条至 0.7 后两 pane 宽度与两槽宽度按新比例重排（实时），松手后位置被持久化

#### Scenario: harness 的打开与收起

- **WHEN** 经标题栏 toggle 钮或 `harness.toggle` 命令唤起 / 收起 harness 面板
- **THEN** harness 在旁侧 pane 打开（无第二 pane 时自动分栏，默认宽度比 harness:文档 pane = **1:1**，canonical 定义见 `pane-layout` 的「harness pane」）或收起回到单 pane；切换不改变正文阅读宽居中的既有口径；harness 在场时标题栏出现 harness 段且段缘与 pane 分隔条对齐

#### Scenario: dock 展开与收起

- **WHEN** 检查应用骨架（本 change 落地后）
- **THEN** 右栏 dock 列不复存在——`--layout-dock-w` 与 `.dock-open` 机制已随本 change 移除；原 dock 承载的 harness 面板改在旁侧 pane 打开（见「harness 的打开与收起」）

#### Scenario: 空态的标题栏

- **WHEN** 没有任何文件打开（单 pane、空标签列表）
- **THEN** 标题栏为 traffic 灯区（含产品标识块）+ 右端动作钮区（harness toggle）（标签区隐藏），modeline 与侧栏骨架不变；pane 容器呈空态（无分隔条、无第二 pane）

#### Scenario: 拖拽分隔条调整侧栏宽度

- **WHEN** 用户在侧栏与内容区之间的分隔条上按下并向右拖动 80px
- **THEN** 侧栏实时变宽（拖拽过程逐帧跟随），标题栏 traffic 区宽度同步跟随；松手后新宽度经配置写通道
  落盘一次；正文区左缘随之右移，pane 容器内部几何（标签条、正文栏）按既有口径重排

#### Scenario: 宽度在重启后保持

- **WHEN** 把侧栏拖到 320px 并落盘成功，随后退出并重新启动应用
- **THEN** 启动后的侧栏宽度为 320px（配置值即启动真源）；越界或类型不符的配置值按 `ui.content_width`
  同口径回落默认 236 并给配置 warning

#### Scenario: ⌘B 收起与展开侧栏

- **WHEN** 用户按 ⌘B（焦点可在编辑器、文件树或 harness composer 内）
- **THEN** 侧栏收起：侧栏列宽为 0、侧栏内容不可见、标题栏 traffic 区回到「交通灯 + 产品标识块」的最小宽、
  正文左缘贴窗口左缘；再按一次 ⌘B，侧栏展开并回到收起前的宽度与展开态；两次切换都不重建树模型

#### Scenario: 收起时收掉在手交互并留住焦点

- **WHEN** 用户在文件树里正在行内重命名某条目（或右键菜单开着）时按 ⌘B
- **THEN** 该次重命名按取消处理（磁盘与树都不出现半截改动）、菜单关闭；焦点交还活跃文档 pane 的编辑器，
  随即键入的字符落在文档里而不是不可见元素上

### Requirement: chrome 表面与动效纪律

全部 chrome 表面（文件树 / 标签 / 搜索面板 / 键位面板 / 大纲浮层 / toast / vault 切换浮层）
SHALL 改吃 token 层取值，且 MUST NOT 因此改变任何行为语义（显示判据、键位、焦点流、读屏名
逐项不变）。文件树行 SHALL 为：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色
`--sel`（eink = 明度带 `#b9b9b9` + 黑字）、hover 底色 `--hover`。hover 与过渡 SHALL 收敛为 0.1s / 0.12s 两档
（`--dur-hover` / `--dur-ui`，统一 `ease`），全仓 MUST NOT 出现第三个过渡时长；动效只有
hover 过渡与（随 agent 特性启用的）pulse 呼吸，MUST NOT 新增入场动画或弹性曲线。

#### Scenario: 行为零改动

- **WHEN** 跑既有 chrome 表面的行为断言（标签显示判据、树的行为场景、面板键位与焦点归还）
- **THEN** 全部原样通过（断言本身不改一字）；变化只在视觉层

#### Scenario: 动效两档

- **WHEN** 审查全仓 `transition` 声明
- **THEN** 时长值只有 0.1s 与 0.12s 两种（动画 `pulse 1.6s` 除外），缓动统一

### Requirement: 视觉基线处置

本 change 使既有全部整页 / 元素基线失效（底色、字体、栏宽、骨架全换），基线 SHALL 以
**独立批次动作**全量重建：实现收敛后一次性重建，重建出的截图 SHALL 经 Alex 逐张过目后才
生效（人肉裁决点），MUST NOT 在实现过程中零碎 `--update`。删除 / 移动的 UI 元素
（masthead、旧标签栏行）出现过的所有整页基线 SHALL 逐张核对时间戳随本次重建刷新，未刷新的
逐张给出原因（视觉门禁卫生）；重建后 SHALL 做一次「人为删除可见元素确认门禁 FAIL」的反向
验证，防比例容差吞掉真实变化。

#### Scenario: 批次重建而非零碎更新

- **WHEN** 实现收敛、结构层断言全绿后
- **THEN** 一次性重建全部基线；全部基线文件的时间戳同属该批次；逐张核对表（张名 / 变化原因 /
  对应定稿图 / 结论）落档可 `ls`

#### Scenario: 删除元素核对与假绿防线

- **WHEN** 基线重建完成后，人为删除一个可见元素再跑门禁
- **THEN** 门禁如实 FAIL（证明容差没有吞掉真实变化）；还原后全绿；删除元素涉及的所有整页
  基线时间戳均有核对记录

### Requirement: 产品名与版本号常显

标题栏 SHALL 在**最左 traffic 灯区内（系统按钮旁）**常显产品标识块「产品名 · 版本号」（当前为「Lumir · 0.0.0」），产品名与版本号 SHALL 取自应用元信息真源（tauri.conf.json 的 `productName` / `version`，前端经 Tauri 内置 app 通道 `getName()` / `getVersion()` 读取），前端 MUST NOT 硬编码第二份产品名 / 版本号副本。标识块 SHALL 在启动装配时读取一次并写入，运行期不刷新；读取失败 SHALL 使标识块整体隐藏并记一条诊断日志，MUST NOT 显示占位串或半截版本号。

标识块是纯展示信息位，MUST NOT 带点击语义或伪装成按钮。标识块 SHALL 不参与收缩、MUST NOT 截断。窄窗退让（D2 裁决备选，2026-09-25）：窗口宽 < 640px 时版本号（连同分隔符）SHALL 从标题栏退入 modeline 右段尾部（拼在「语法 · 行数 · UTF-8」之后），产品名 SHALL 留在标题栏最左；窗口回到 ≥ 640px 时版本号 SHALL 回到标题栏。退让判定 SHALL 只看窗口宽度（纯阈值规则，不数标签个数）。标识块样式 SHALL 只取 token 层现行值（字号 / 字色 / 间距），MUST NOT 引入新色值或组件级主题覆盖；三主题（light / dark / eink）下 SHALL 同构成立。

#### Scenario: 常显与真源一致

- **WHEN** 应用启动完成（有或无打开的文件）
- **THEN** 标题栏最左（系统按钮旁）显示「产品名 · 版本号」，且版本号与 src-tauri/tauri.conf.json 的 `version` 字段逐字节一致；空态（无标签）下标识块仍在

#### Scenario: 窄窗退让（D2 裁决备选）

- **WHEN** 窗口宽度收窄到 640px 以下（如约 520px）
- **THEN** 版本号从标题栏退入 modeline 右段尾部（「语法 · 行数 · UTF-8 · 版本号」），标题栏最左只留产品名；标识块不收缩、不截断

#### Scenario: 退让恢复

- **WHEN** 窗口从 640px 以下重新拉宽到 640px 及以上
- **THEN** 版本号回到标题栏标识块（产品名 · 版本号），modeline 右段恢复「语法 · 行数 · UTF-8」

#### Scenario: 读取失败降级

- **WHEN** 产品名 / 版本号的读取在启动时失败（ACL 未授权或非 Tauri 环境）
- **THEN** 标识块整体隐藏、记一条诊断日志；界面不出现任何占位版本号

#### Scenario: 拖拽区共存

- **WHEN** 在标识块上按下并拖拽
- **THEN** 窗口照常拖动（标题栏 drag region 行为不被标识块阻断）

### Requirement: 编辑器光标视觉（粗细 / 颜色 / 闪烁）

编辑器光标 SHALL 以**实心竖线**呈现，材质沿用 CodeMirror 基础主题的默认值：宽度 `1.2px`、以
`marginLeft: -0.6px` 相对插入点居中（两者都取 CM 基础主题的既有值——`border-left: 1.2px` 与
`margin-left: -0.6px`；本仓 MUST NOT 再写宽度或居中覆盖）。颜色 SHALL 取 `--text`（三主题取值以
`docs/specs/design-tokens-v1.md` 的 `--text` 行为准）——颜色是唯一保留的覆盖项，MUST NOT 跟随
CM 默认的 `black`（dark 主题下黑线不可见）。光标层 SHALL 以约 `1.2s` 周期闪烁（CM 原生
`steps(1)` 动画，半程 `opacity: 0`；周期取 `EditorView.cursorBlinkRate` 的默认值）；闪烁是
光标可发现性的核心信号——光标 MUST NOT 在聚焦期间常亮不动。选区变化 MUST 重启动画相位：
光标移动后 MUST 立即可见，MUST NOT 停在「灭」相位直到下一个周期。该口径 SHALL 对 md 与
code 两种模式、三个主题一致；eink 下同为 1.2px 黑色并同样闪烁（eink 没有颜色，可发现性由
闪烁承担，线宽回到 2026-10-23 之前的默认档；1.2px 与 1px hairline 的 0.2px 宽度差 MUST NOT
被当作 eink 的可辨识判据）。光标 MUST NOT 改变文字排版、行盒高度或容器几何
（`drawSelection` 的绝对定位层不参与布局）；编辑器未聚焦时光标 MUST NOT 显示。

> 改裁记录（三次，按时间序）：
> ① 2026-10-23（change `cursor-visibility-oct23`，D2）：Alex 反馈光标太细，应用从「只覆盖颜色」
> 改为 2px 宽度 + `-1px` 居中，该档保留至 2026-11-23。
> ② 2026-10-24：Alex 反馈 #6 原话「光标可见性调地有些过头了 —— 现在光标不闪了，也不容易一眼
> 扫到」⇒ D2 改判为 B：保留 2px 宽度与 `--text` 颜色，恢复 1.2s 闪烁。
> ③ 2026-11-23（本 change）：Alex 裁决「按推荐」——**推翻 2026-10-23 的 2px 加粗**，light /
> dark / eink 三档统一恢复 CM 默认的 1.2px 宽度与 `-0.6px` 居中；颜色 `--text` 与 1.2s 闪烁
> 两项增益保留。宽度不是新的组件常量，`docs/specs/design-tokens-v1.md` 的组件常量登记随之撤销。
> 后续 MUST NOT 以「再粗一点更显眼」为由回改 2px；确需变更时走新的裁决并同时改本条与本记录。

#### Scenario: 三主题下的光标计算样式

- **WHEN** 编辑器聚焦、光标停在正文行，分别取 light / dark / eink 三主题的
  `getComputedStyle(.cm-cursor-primary)`、匹配该元素的 CSSOM 声明与 `.cm-cursorLayer` 的动画读数
- **THEN** 级联里匹配光标的 `border-left-width` 声明恰好一条、值为 `1.2px`（CM 基础主题；
  本仓主题规则不声明宽度或居中）、`marginLeft` 计算值为 `-0.6px`、颜色等于该主题 `--text` 的
  计算值；`borderLeftWidth` 的计算值落在 `1px` / `1.2px` 档（渲染引擎按整数 CSS 像素取整，
  Chromium DPR=1 下读回 `1px`）且 MUST NOT 为 `2px`；`.cm-cursorLayer` 的 `animationName`
  为 `cm-blink` / `cm-blink2`（CM 原生闪烁，不是 `none`）、`animation-duration` 为 `1.2s`
  且无限循环、动画处于运行态；三主题的宽度与闪烁口径一致

#### Scenario: 宽度覆盖已移除（反向判据）

- **WHEN** 读取任一主题下匹配 `.cm-cursor-primary` 的 `border-left-width` 声明、`marginLeft`
  计算值与 `borderLeftWidth` 计算值
- **THEN** 声明列表恰为 `["1.2px"]`、`marginLeft` 为 `-0.6px`；`borderLeftWidth` 的计算值
  MUST NOT 为 `2px`、`marginLeft` MUST NOT 为 `-1px`——这两个值一旦回潮，本场景必红
  （区分度对照：2026-10-23 至 2026-11-23 的实现正是这两个值，且其 2px 声明会出现在声明列表里）

#### Scenario: 闪烁的亮 / 灭相位真实交替

- **WHEN** 编辑器聚焦后把光标层的动画暂停在周期起点（0ms）与中点之后（700ms），分别读
  `getComputedStyle(.cm-cursorLayer).opacity`
- **THEN** 0ms 处为 `1`（光标可见）、700ms 处为 `0`（光标不可见）；恢复播放后闪烁照常继续。
  区分度对照：M654 的「常亮」实现没有可暂停的动画（`animationName = none`），本场景的
  相位读数无从取得，判 FAIL

#### Scenario: eink 下闪烁且宽度可辨

- **WHEN** eink 主题下聚焦编辑器
- **THEN** 光标为 1.2px 纯黑实心竖线，并以约 1.2s 周期闪烁；不引入灰度档或彩色。「可辨」
  在本档由闪烁承担：线宽与 1px hairline（结构线）只差 0.2px，本场景 MUST NOT 以「肉眼可分辨
  宽度」为断言——线宽观感归真机 dogfood 手感项

#### Scenario: 非聚焦不显示光标

- **WHEN** 编辑器失去焦点（焦点在文件树 / 浮层 / composer）
- **THEN** `.cm-cursor` 不显示（`display: none` 的既有口径）；闪烁口径 MUST NOT 让失焦状态
  出现残留光标

### Requirement: 滚动条分档与滚动容器注册表

凡在任一轴声明 `overflow: auto` / `overflow: scroll` 的滚动容器（含 chrome、浮层、编辑器与预览的横滚面）
SHALL 归入且仅归入下列三档之一，MUST NOT 留在未登记的默认形态。档位按**容器**分配，MUST NOT 按轴分配：
WebKit 一旦为某容器自绘 `::-webkit-scrollbar`，就把它两条轴一起从 overlay 切成占位经典条——只写
`height` 时纵向仍变占位条（实测 17px）、只写 `width` 时横向同理；逐轴的 `::-webkit-scrollbar:horizontal`
在 WKWebView 上是死规则（与不写声明逐字节相同）；`scrollbar-width` 不改变 WKWebView 的 overlay 条。
因此「同一容器一轴细条、一轴 overlay」在实现上不可达，判据的分配单位只能是容器整体。

- **细条档**：`scrollbar-width: thin` + `::-webkit-scrollbar { width: 4px; height: 4px }` + thumb 取
  `--border`、轨道 `transparent`。两条声明都要——标准通道管标准渲染，`::-webkit-scrollbar` 管
  WKWebView 与 chromium（只写前者时 WKWebView 仍是系统默认条）。配方 SHALL 由**一份共用选择器组**承担，
  消费者 MUST NOT 各自再写一份值。现行消费者：harness transcript 的代码块 / diff / argv（M406 起，
  M628 把代码块并入同一份声明）、编辑器预览的块级横滚容器——代码块 `.cm-lp-block-scroll`、宽表
  `.cm-lp-table-scroll`、公式 `.cm-lp-math-block`、mermaid 图 `.cm-lp-mermaid`（M663）。
- **隐藏档**：`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`。滚动能力保留（触控板手势 /
  程序化对齐），只是不占位、不上屏。现行消费者：标签栏（M257，与浏览器标签条同形态）、右缘 0 留白且
  逐行有常驻钮的三处浮层列表——vault 切换浮层 `.vault-list`、harness 会话浮层 `.lumir-hp-sesspop-list`、
  权限规则段 `.lumir-hp-permpop-rules`（M660）。
- **原生 overlay 豁免档（白名单，逐条枚举）**：保留平台 overlay 条，MUST NOT 为该容器声明
  `scrollbar-width`（含 `thin` / `auto`），MUST NOT 为它写任何 `::-webkit-scrollbar` 规则——写了就把该
  容器翻成占位经典条，与本档的「不占宽」前提相悖。准入判据（三条同时成立）：静止态不占宽、右缘 8px 以上
  是留白或空轨道、改档会让像素基线全量失效而收益只是「滚动瞬间看着细」。现行白名单：编辑器主滚动
  `.cm-scroller`（两轴；正文列两侧是 `1fr` 空轨道，纵向条不压任何正文或可点件——且自绘即双轴占位，见上）、
  文件树 `.tree-pane`、键位面板体 `.lumir-bindings-body`、表格全屏壳 `.lumir-table-fs-panel`、
  代码块全屏壳 `.lumir-codeblock-fs-panel`、大纲浮层列表 `.lumir-toc-list` 与快速打开列表
  `.lumir-qo-list`（行右 padding 8 + 列表 padding 4 = 12px 净留白）、harness transcript
  `.lumir-hp-transcript`、composer `.lumir-hp-composer`，以及 `.pane`（备而不用：编辑器撑满高度时
  实际不滚动）。白名单之外的容器 MUST NOT 使用本档。

归挡结果 SHALL 登记在可执行注册表（`tests/unit/scrollbar-registry.test.ts`）里，注册表是本条的机器判据，
MUST 与源码**双向**对齐：`src/style.css` / `src/harness-panel.css` / `src/preview/theme.ts` 里凡声明
`overflow(-x|-y): auto|scroll` 的选择器，未登记即判红（拦新增容器）；注册表条目在源码里已不存在
（选择器改名或删除）同样判红（拦僵尸条目）。同一判据 SHALL 按档位核验声明本身：细条与隐藏档消费者
MUST 实际持有该档的声明且全档共用一份选择器组，豁免档消费者 MUST NOT 持有任何 `scrollbar-width` /
`::-webkit-scrollbar` 声明。新增滚动容器时 SHALL 在同一变更内先定档、再写 `overflow`，MUST NOT 先写
`overflow` 等评审发现。

滚动容器右缘 12px 内 MUST NOT 放常驻可交互件（逐行删除钮、复制钮、浮动操作钮），除非该容器归隐藏档：
overlay 条不占布局、直接画在内容上，条与钮占同一条带时滚动期间钮会被压住。第二解是给容器右缘留出
≥12px 净留白把 overlay 条吸收进 padding；两种做法都 SHALL 在实现处写明取舍，MUST NOT 只调细条尺寸
了事（4px 条仍会盖住 0 留白容器的钮右缘）。

横向细条容器 MUST NOT 声明 `scrollbar-gutter`：其纵向已显式 `overflow-y: hidden`，不存在「纵向条出现
导致抖宽」的场景，该声明只在 classic 滚动条环境换来常驻沟槽（M177 实测 `offsetWidth − clientWidth = 15`，
overlay 环境为 0）。浮层 / 列表类滚动容器的验收场景 SHALL 先断言容器确实溢出
（`scrollWidth > clientWidth` 或 `scrollHeight > clientHeight`），再断言滚动条形态——在不溢出的容器上
量滚动条是空测量（同 m628 注释里的「区分度输入」口径）。

#### Scenario: 代码块横向溢出是细条

- **WHEN** harness transcript 里出现横向溢出的代码块（超长代码行）
- **THEN** 其滚动条为 4px 细条（`scrollbar-width: thin` + `::-webkit-scrollbar` 的 4px 声明，与工具详情的 diff / argv 同一份声明逐值一致），系统默认粗条不出现

#### Scenario: 预览横向滚动面是细条，且断言前先证明溢出

- **WHEN** md 文档里同时出现「默认不折行」的超长代码行、宽于正文列的表、宽于正文列的块级公式
- **THEN** 三个块级横滚容器（`.cm-lp-block-scroll` / `.cm-lp-table-scroll` / `.cm-lp-math-block`）各自先满足
  `scrollWidth − clientWidth > 0`（本场景的区分度输入），再各自取到 `scrollbar-width: thin` 的计算值与
  `::-webkit-scrollbar` 的 4px 声明；宽表容器的 `scrollbar-gutter` 计算值为 `auto`（其声明已删除）。
  `.cm-lp-mermaid` 同样取到细条声明，但它的横向溢出**在当前渲染链上不可达**——mermaid 自己的
  `useMaxWidth` 把 svg 钳在容器宽内（实测 `scrollWidth === clientWidth`），验收只断言声明层并钉住
  「当前不溢出」这个事实，换渲染器时该断言会红并提醒重做判据

#### Scenario: 编辑器主滚动保留平台 overlay 条

- **WHEN** 检查编辑器主滚动容器 `.cm-scroller`（md 与 code 两种模式、三主题）
- **THEN** 它不持有任何 `scrollbar-width` 声明，也没有 `.cm-scroller::-webkit-scrollbar` 规则（`scrollbar-width`
  的计算值为 `auto`），两条轴的滚动条仍是平台 overlay 条；正文列宽与行盒高度逐值不变

#### Scenario: 标签栏不出滚动条

- **WHEN** 打开的标签多到标签栏横向溢出
- **THEN** 标签栏没有可见滚动条（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），横向滚动能力保留，标签宽度与正文列宽不受影响

#### Scenario: 右缘带常驻钮的浮层列表归隐藏档

- **WHEN** vault 切换浮层 / harness 会话浮层 / 权限规则段的列表长到纵向溢出（每行右侧有 20×20 常驻钮）
- **THEN** 三个列表先满足 `scrollHeight > clientHeight`，且都不显示滚动条（隐藏档），滚动期间行尾的 ✕ / × / 删除钮始终完整可点

#### Scenario: 新增滚动容器未登记即红

- **WHEN** 往 `src/style.css`、`src/harness-panel.css` 或 `src/preview/theme.ts` 里新增一个声明
  `overflow: auto`（或 `overflow-x` / `overflow-y`）的选择器，而未在注册表登记
- **THEN** `pnpm test` 的 `scrollbar-registry` 用例判红并指名未登记的选择器；把它登记进任一档后转绿。
  反向同样成立：注册表里的条目在源码里查不到（改名 / 删除）时判红并指名僵尸条目

#### Scenario: 豁免档不许持有滚动条声明

- **WHEN** 为白名单里的某个容器（如 `.cm-scroller` / `.lumir-hp-transcript`）加上 `scrollbar-width: thin`
  或任意 `::-webkit-scrollbar` 规则
- **THEN** `scrollbar-registry` 用例判红——豁免档的判据是「一条声明都没有」，写了就翻成占位经典条，
  与该档「不占宽」的前提相悖；要改档必须先把容器从白名单移出并写明取舍

### Requirement: 行号指示钮

modeline 右段 SHALL 增加一个行号指示钮（`.modeline-line-numbers`），它是**常驻的「当前行号
开关是什么」归因出口**，同时是切换入口：点击 SHALL 与命令 `view.toggle-line-numbers` 走同一条
实现路径（切换、持久化与失败降级的口径见 `keymap-commands` 的「行号开关命令」条，MUST NOT 在
本钮上另写一套切换逻辑）。

钮的可见文本 SHALL 是当前开关的读数 `on` / `off`（与 `[ui] line_numbers` 的取值逐字一致，属
读数、不译文，与 `light` / `dark` / `eink`、`en` / `zh` 同族）。悬停提示与读屏名 SHALL 由文案表
给出（含当前状态），并 SHALL 随界面语言切换重新取值（`onRelabel` 的重绘面）；MUST NOT 使用
裸文本拼接绕过文案表。

钮 SHALL 与既有的主题指示钮同族：复用同一套 pill 规则（micro 字号、semibold、pill 圆角、微底、
`--sp-6` 左外边距、1px 透明边框占位），取色只走 token 层，MUST NOT 引入新色值或组件级主题覆盖。
eink 下 SHALL 走同一套 chip 描边化规则（边框取 `--border`），线宽与内边距不变。钮 SHALL 排在
`.modeline-meta` 与 `.modeline-theme` 之间（版本号退让段之后、主题钮之前），主题 / 语言继续占
右段最右。

钮 SHALL 在初始态隐藏，仅在行号开关已施加后才显示（与主题 / 语言钮同口径：宁可不显示，也不
显示一个尚未生效的状态）。`on` / `off` 两种读数 SHALL 占用**相同宽度**（`min-width` 覆盖较长
的 `off` + 居中），切换时 MUST NOT 让右段的其它元素（meta / 版本号段 / 主题钮 / 语言钮）发生
位移——行号开关是状态切换，不是布局事件。

窄窗 SHALL 不因本钮溢出：在 520px 窗口下，右段的 meta、版本号退让段（若在场）、行号钮、主题钮、
语言钮 SHALL 全部在场且不互相遮挡、不越出窗口右缘；MUST NOT 用隐藏主题 / 语言钮的方式给行号钮
让位。

#### Scenario: 三主题下的形态

- **WHEN** 分别在 light / dark / eink 下检查 modeline 右段的行号钮
- **THEN** 三档的字号 / 字重 / 圆角 / 内边距 / 左外边距逐项一致（同一套 pill 规则）；底色、文字色与
  边框取各自主题的 token 值；eink 下边框显形为 `--border`（#000）、底色透明；不出现新色值，
  也不出现阴影

#### Scenario: 初始隐藏、施加后显示

- **WHEN** 配置尚未施加（启动早期）与施加完成（`applyLineNumbers` 已运行）两个时刻分别检查
- **THEN** 施加前钮带 `hidden`、不占位；施加后钮显示，可见文本与 `<html data-line-numbers>` 一致

#### Scenario: 点击与命令同源、文本同步

- **WHEN** 点击行号钮；随后按 `⌘⇧N`
- **THEN** 两次切换的效果逐项相同：`<html data-line-numbers>`、两种模式的 gutter、钮文本、配置回写
  全部同步；钮文本在 `on` / `off` 之间切换，不出现中间态或空文本

#### Scenario: 切换不产生右段位移

- **WHEN** 在 1200px 与 520px 两个窗口宽度下，把开关从 `off` 切到 `on` 再切回
- **THEN** 右段其它元素（meta、版本号退让段、主题钮、语言钮）的实测 rect 逐值不变；行号钮自身的
  rect 宽度在两种读数下相同；整段不出现横向溢出或换行

#### Scenario: 窄窗不溢出

- **WHEN** 窗口收窄到 520px（版本号退让段在场）
- **THEN** meta、版本号、行号钮、主题钮、语言钮全部可见且不互相遮挡，右缘不越出窗口；主题 / 语言钮
  不被隐藏、不被行号钮挤出

#### Scenario: 语言切换后重取文案

- **WHEN** 界面语言在 `zh` / `en` 之间切换
- **THEN** 钮的悬停提示与读屏名按新语言重取（文案表取值），可见文本仍是 `on` / `off` 读数；
  切换语言不改变开关状态、不重配编辑器、不引起右段布局位移

### Requirement: CSS token 引用链的静态防线

`src/**/*.css` 里的每条 `var(--x, …)` 引用 SHALL 落到下列归宿之一：`--x` 在该 CSS 文件集内有
定义；`--x` 在运行期由 TS 显式写入（白名单）；或引用带**有效回退**——回退是字面量，或是一条
每个 `var()` 都能解析到底的回退链。回退 SHALL 被求值：主引用未定义时，回退里的每个 `var()` 都
MUST 解析成功；以另一个未定义 token 作回退 MUST NOT 被视为有效回退（该声明在 computed-value
阶段失效，背景 / 字色等属性回落初始值或继承值）。主引用已定义时，回退是死代码，MUST NOT 因其
内容未定义而判红。

该判据 SHALL 由 `tests/unit/css-token-references.test.ts` 承担，覆盖 `src/**/*.css` 全量（新文件
自动进入），MUST 报告违规的文件与行号。运行时赋值白名单 MUST 只含**真实有赋值点**的 token
（现行：`--lumir-hp-scale` / `--toc-depth` / `--cm-lp-table-columns`），且每条 MUST 同时满足
「`src/**/*.ts` 里有赋值点」与「被至少一条 CSS 引用」——缺任一侧即判红。新增运行期 token MUST
在同一变更内同时落赋值点与白名单条目，MUST NOT 借白名单放行没有赋值点的名字。

判据边界 SHALL 明确：只覆盖 CSS 文件里的 `var()` 文本与 TS 里的运行时写入点，MUST NOT 被表述为
覆盖 TS 内联样式（CodeMirror theme 对象、inline style 串）的引用面，也不做主题作用域 / 级联
分析——本条是「引用有归宿」判据，不是「该主题下一定生效」判据。

#### Scenario: 未定义的 bare 引用判红

- **WHEN** 某 CSS 声明引用一个既无 CSS 定义、又无运行时赋值、又没有回退的 token
- **THEN** 判据 FAIL，并给出违规文件与行号（现场：`.lumir-hp-skill-name { color: var(--text-1) }`）

#### Scenario: 回退链本身未定义判红

- **WHEN** 引用写成 `var(--a, var(--b))`，而 `--a` 与 `--b` 都没有定义或运行时赋值
- **THEN** 判据 FAIL（现场：`.lumir-hp-skill-menu { background: var(--bg-raise, var(--bg)) }`）

#### Scenario: 有效回退与运行时 token 判绿

- **WHEN** 引用写成 `var(--border-strong, var(--border))` 且 `--border` 有定义，或回退是字面量，
  或引用的 token 是白名单里的运行时赋值 token
- **THEN** 判据 PASS；主引用已定义时，回退里的未定义名字不误报

#### Scenario: 白名单双向核对

- **WHEN** 白名单新增一个在 `src/**/*.ts` 里没有赋值点、或没有被任何 CSS 引用的 token
- **THEN** 判据 FAIL（白名单不能靠加名字放行）

### Requirement: 无标签时标题栏动作钮贴右缘

标题栏在**没有任何标签**时（标签段 `hidden`、不占宽度），右端动作钮区（harness toggle）
SHALL 贴标题栏右缘：钮的右缘 SHALL 等于标题栏右缘（即视口右缘）减去钮自身既有的右缘留白
（`--sp-6`），与有标签时的右缘位置逐值相同。MUST NOT 停在 traffic 灯区右缘（左栏宽处）——
那里是 Content pane 左缘的上方，钮会被读成「浮在内容区左上角」，而不是标题栏右端的动作钮。

有标签时既有落位 MUST NOT 改变：标签段仍弹性占满剩余宽度，动作钮紧随标签段之后贴同一右缘。
标题栏的子节点顺序与结构口径 MUST NOT 改变——空态仍只有 traffic 灯区（含产品标识块）与动作钮
两枚可见子节点，标签段保持 `hidden` 且不占宽度；本条只约束既有动作钮在弹性行里的对齐，
MUST NOT 为它新增占位元素或改变 DOM 结构。

分栏退让（harness 在场时动作钮 `hidden`）与其它标题栏元素 MUST NOT 受本条影响；侧栏收起 /
展开时 traffic 区宽度的既有条款照旧成立。

#### Scenario: 空态动作钮贴右缘

- **WHEN** 应用启动后没有任何标签（未打开 vault 的空态，或 vault 已装载但没有打开任何文件）
- **THEN** 标签段隐藏；harness toggle 位于标题栏最右端——钮右缘 = 视口右缘 − 钮自身
  `--sp-6` 留白（±2px），钮整体落在视口右半区，MUST NOT 贴在左栏宽度处

#### Scenario: 有标签时落位不变

- **WHEN** 打开一个或多个文件、标签段可见
- **THEN** 动作钮仍在标题栏右端且右缘与空态逐值相同；标签段在它左侧弹性占满，标签与钮
  之间维持既有留白（MUST NOT 因本 change 挪位或换边）

#### Scenario: 分栏退让不受影响

- **WHEN** harness pane 在场（分栏态）或文档分栏
- **THEN** 动作钮按既有退让条款隐藏，标题栏不出现新的空位或位移；harness 段与标签槽的分宽
  几何不受本条影响
