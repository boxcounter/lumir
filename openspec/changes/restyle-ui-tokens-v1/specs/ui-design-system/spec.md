## ADDED Requirements

### Requirement: 设计 token 层

系统 SHALL 以单层 CSS 自定义属性承载全部视觉决策，token 的分层、命名、值与收敛纪律以
[design-tokens-v1.md](../../../../docs/specs/design-tokens-v1.md) 为权威文本（色彩 32 × 三主题、
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
  eink 下全部色条为实心黑、底色为 transparent

### Requirement: 三主题与主题选择

系统 SHALL 提供 light / dark / eink 三个主题，同一套 token 名经 `data-theme` 属性切换取值；
三主题 SHALL 共享同一套非色 token（字体阶梯 / 间距 / 圆角 / 布局 / 动效）——「共享结构与排版
基因，只分档对比度」。主题选择 SHALL 走配置：新增 `[ui]` 配置表的 `theme` 字段
（`light` / `dark` / `eink`，默认 `light`），启动装载时读一次并施加，MUST NOT 引入运行期
切换与跟随系统（`prefers-color-scheme`）通道；非法值 SHALL 回落 `light` 并附一条人话
warning（配置即数据 + schema 校验，ADR 0002 §5）。

#### Scenario: 配置驱动主题

- **WHEN** 配置 `ui.theme` 为 `dark`（或 `eink`）并启动
- **THEN** 首帧即为对应主题：底色、文字、边线、语法高亮取该主题的 token 值；未配置时与
  `light` 逐项一致

#### Scenario: 非法值回落

- **WHEN** 配置 `ui.theme` 为取值表之外的字符串
- **THEN** 记一条 warning、主题为 `light`，界面无其他可见变化

### Requirement: eink 降级规则

eink 主题 SHALL 按 tokens 文档 §eink 规则 的 9 条系统性降级（不是换一套色板）：
①色彩全退场（accent 与语义色 = `#000`，全部 tint = `transparent`）；②对比改由字重与明度
承担（语法高亮 keyword 700 纯黑、comment 降灰）；③hairline 结构档实心黑、层次档保留灰；
④选中态黑底反白，组件内次级元素（badge / chip / ghost 项）SHALL 同步手工反白；⑤浅底区块
（代码块 / frontmatter 区）翻转为白底黑框；⑥chip 描边化；⑦阴影全退场；⑧强调档改由线宽
承担（1.2–1.6px）；⑨wikilink 从药丸降级为下划线。eink 下组件内的字面色值 SHALL 只出现在
这套反白/降级规则里，MUST NOT 散落成各组件自造的灰。

#### Scenario: eink 下信息不依赖色相

- **WHEN** 以 eink 主题打开含代码块、frontmatter、wikilink、选中树行的文档
- **THEN** 代码注释与代码凭明度区分（灰 vs 黑）、keyword 凭字重区分（700）；fm 区与代码块
  为白底黑框；选中树行黑底反白；wikilink 以下划线标识；全屏无任何彩色像素

#### Scenario: eink 的强调档是线宽

- **WHEN** eink 主题下查看 active tab 与 focus 态输入框
- **THEN** 其边线粗于常规 hairline（1.4px / 1.6px），且阴影不存在

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，标签位于标题栏内，
右侧为动作钮）/ 主行（侧栏 236px + 正文栏 + **右栏 dock 预留位**）/ modeline 25px（全宽）。
dock 预留位 SHALL 只是结构上的列位（本版零像素、无内容、无边框、不可交互）——agent 栏及其
任何像素不在本版。正文阅读宽 SHALL 为 664px 居中。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 →
modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 →
modeline 右侧（只读派生自既有编辑器状态，MUST NOT 为此引入全文档遍历或新状态源，ADR 0002 §6）。
macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列 664 居中、dock 列零像素；
  modeline 左侧显示当前文件的 vault 相对路径，右侧显示语法 / 行数 / 编码；masthead 不存在

#### Scenario: 空态的标题栏

- **WHEN** 没有打开任何文件
- **THEN** 标题栏只剩 traffic 灯区与动作钮（标签区隐藏），modeline 与侧栏骨架不变

### Requirement: chrome 表面与动效纪律

全部 chrome 表面（文件树 / 标签 / 搜索面板 / 键位面板 / 大纲浮层 / toast / vault 切换浮层）
SHALL 改吃 token 层取值，且 MUST NOT 因此改变任何行为语义（显示判据、键位、焦点流、读屏名
逐项不变）。文件树行 SHALL 为：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色
`--sel`（eink 黑底反白）、hover 底色 `--hover`。hover 与过渡 SHALL 收敛为 0.1s / 0.12s 两档
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
