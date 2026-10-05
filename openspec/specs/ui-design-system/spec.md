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

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，标签位于标题栏内——
单 pane 常态；双 pane 时标签区左右分区为两槽，左槽 = 左 pane 标签、右槽 = 右 pane 标签，槽宽
比例随分隔条，见 `multi-tabs` 的「标签栏的显示与形态」，**右端为产品标识块**——见「产品名与
版本号常显」）/ 主行（侧栏 236px + **内容区
（pane 容器）** + **右栏 dock**）/ modeline 25px（全宽）。内容区 SHALL 是 pane 容器
（v1 上限两个横向 pane，见 `pane-layout` 的「pane 容器模型」）：未分栏时它承载单个文档 pane，
**几何与 pane 化之前的正文栏逐像素一致**；分栏时两个 pane 以分隔条相隔，分隔条是容器级
hairline 元素（`--border` 档，平铺表面不吃 elevation），其位置可拖拽调整（拖拽重排实时生效，
松手后位置经会话持久化通道落盘，per-vault，见 `vault-workspace` 的「按 vault 持久化 pane
布局」）。右栏 dock SHALL 承载 harness 对话面板（Phase 1 不变：收起时零像素，展开时宽
`--layout-dock-w`，与内容区之间以 hairline 分隔）；Phase 2 harness 归位 pane 后 dock 列移除，
届时本条随 Phase 2 change 修订。标题栏右侧动作钮区填入面板 toggle 钮（**排在产品标识块左侧**，
尺寸吃既有 `--layout-tb-btn-w/h` token）。双 pane 时标题栏右簇 SHALL 退让——产品标识块退
modeline（沿用窄窗 <640px 版本号退 modeline 的既有先例，`src/modeline.ts`）、harness 开关钮
隐藏（`⌘⇧A` 照走；Phase 2 该钮语义重做）；单 pane 时右簇全量在场、逐像素不变（chrome 只在
空间紧张时退让）。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 →
modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 →
modeline 右侧（只读派生自**活跃 pane 的前台**编辑器状态，MUST NOT 为此引入全文档遍历或新状态
源，ADR 0002 §6）。macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，
栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件（单 pane 常态）
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列按既有阅读宽口径居中、dock 列在面板
  收起时零像素；内容区、标签区、modeline 与 pane 化之前**逐像素一致**；modeline 左侧显示当前
  文件的 vault 相对路径，右侧显示语法 / 行数 / 编码

#### Scenario: 分栏后的容器几何

- **WHEN** 执行 `pane.split`（双 pane）
- **THEN** 内容区内出现两个横向 pane，各占容器约一半（默认 0.5），以一条 hairline 分隔条相隔；
  侧栏 236px、标题栏 42px、modeline 25px、dock 列均不受影响；标题栏标签区同步左右分区为两槽
  （槽宽比例与分隔条一致），右簇退让（产品标识块退 modeline、harness 开关钮隐藏），顶部恒为
  一条横带；拖拽分隔条至 0.7 后两 pane 宽度与两槽宽度按新比例重排（实时），松手后位置被持久化

#### Scenario: dock 展开与收起

- **WHEN** 经标题栏 toggle 钮或命令唤起 / 收起 harness 面板
- **THEN** dock 列在 `0px` 与 `--layout-dock-w` 之间切换，内容区（pane 容器）随之伸缩，切换
  不改变正文阅读宽居中的既有口径；分栏态下 dock 展开时两个 pane 同步收窄

#### Scenario: 空态的标题栏

- **WHEN** 没有任何文件打开（单 pane、空标签列表）
- **THEN** 标题栏为 traffic 灯区 + 动作钮区（harness toggle）+ 右端产品标识块（标签区隐藏），
  modeline 与侧栏骨架不变；pane 容器呈空态（无分隔条、无第二 pane）

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

标题栏 SHALL 在右端常显产品标识块「产品名 · 版本号」（当前为「Lumir · 0.0.0」），
产品名与版本号 SHALL 取自应用元信息真源（tauri.conf.json 的 `productName` / `version`，
前端经 Tauri 内置 app 通道 `getName()` / `getVersion()` 读取），前端 MUST NOT 硬编码第二份
产品名 / 版本号副本。标识块 SHALL 在启动装配时读取一次并写入，运行期不刷新；读取失败
SHALL 使标识块整体隐藏并记一条诊断日志，MUST NOT 显示占位串或半截版本号。

标识块是纯展示信息位，MUST NOT 带点击语义或伪装成按钮。标识块 SHALL 不参与收缩、
MUST NOT 截断。窄窗退让（D2 裁决备选，2026-09-25）：窗口宽 < 640px 时版本号（连同
分隔符）SHALL 从标题栏退入 modeline 右段尾部（拼在「语法 · 行数 · UTF-8」之后），
产品名 SHALL 留在标题栏右端；窗口回到 ≥ 640px 时版本号 SHALL 回到标题栏。退让判定
SHALL 只看窗口宽度（纯阈值规则，不数标签个数）。标识块样式
SHALL 只取 token 层现行值（字号 / 字色 / 间距），MUST NOT 引入新色值或组件级主题覆盖；
三主题（light / dark / eink）下 SHALL 同构成立。

#### Scenario: 常显与真源一致

- **WHEN** 应用启动完成（有或无打开的文件）
- **THEN** 标题栏右端显示「产品名 · 版本号」，且版本号与 src-tauri/tauri.conf.json 的
  `version` 字段逐字节一致；空态（无标签）下标识块仍在右端

#### Scenario: 窄窗退让（D2 裁决备选）

- **WHEN** 窗口宽度收窄到 640px 以下（如约 520px）
- **THEN** 版本号从标题栏退入 modeline 右段尾部（「语法 · 行数 · UTF-8 · 版本号」），
  标题栏右端只留产品名；标识块不收缩、不截断

#### Scenario: 退让恢复

- **WHEN** 窗口从 640px 以下重新拉宽到 640px 及以上
- **THEN** 版本号回到标题栏标识块（产品名 · 版本号），modeline 右段恢复「语法 · 行数 · UTF-8」

#### Scenario: 读取失败降级

- **WHEN** 产品名 / 版本号的读取在启动时失败（ACL 未授权或非 Tauri 环境）
- **THEN** 标识块整体隐藏、记一条诊断日志；界面不出现任何占位版本号

#### Scenario: 拖拽区共存

- **WHEN** 在标识块上按下并拖拽
- **THEN** 窗口照常拖动（标题栏 drag region 行为不被标识块阻断）
