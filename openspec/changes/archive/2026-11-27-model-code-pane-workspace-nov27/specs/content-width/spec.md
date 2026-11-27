## ADDED Requirements

### Requirement: 内容模式决定 pane 宽度策略

content pane SHALL 是通用内容宿主，并按前台会话的内容模式选择布局策略：Markdown 是排版型文档，使用「宽度配置项与校验」规定的阅读栏宽；code 文件是工作区型内容，默认使用所在 pane 的完整可用宽度，MUST NOT 消费 `ui.content_width` / `--layout-doc-measure`。

code 无行号 gutter 时，正文内容框 SHALL 等于编辑器 scroller 的可用宽度。行号 gutter 在场时，gutter SHALL 取其自然宽，正文从 gutter 右缘起占满剩余宽度；正文右缘与 pane 可用区右缘保持一致。行号开关 MUST NOT 裁切行号，短行文档 MUST NOT 仅因 gutter 出现而产生横向滚动。

Markdown 中的代码块、宽表与其它块级组件 SHALL 继续落在 Markdown 阅读栏内，并使用既有块内滚动合同；文件级 code 满 pane 策略 MUST NOT 施加到这些文档组件。

#### Scenario: code 无行号时占满 pane

- **WHEN** 打开一个非 md 文本文件且行号为 off
- **THEN** `.cm-content` 的左右缘与所在 `.cm-scroller` 的可用区左右缘一致，列宽不取 `--layout-doc-measure`

#### Scenario: code 有行号时正文占满剩余宽度

- **WHEN** 同一个 code 文件打开行号
- **THEN** gutter 取自然宽，正文左缘贴 gutter 右缘，正文右缘仍贴 pane 可用区右缘；行号完整可见，短行内容不因此产生横滚

#### Scenario: Markdown 文档组件不随 code 满 pane

- **WHEN** 一份 Markdown 同时含超长围栏代码块与宽表
- **THEN** 两者仍位于阅读栏文字宽内，溢出由各自的既有块内横滚容器承载，主 scroller 不因此横滚

### Requirement: code 不消费阅读栏拖拽结果

阅读栏拖拽 SHALL 只改变 Markdown 阅读栏意图。code 文件在拖拽发生前已经打开时，切到 Markdown 拖宽再切回 code，code 的内容框、自然文本宽与横向滚动语义 MUST NOT 因该手势改变；配置写入仍由 Markdown 手势的既有持久化路径承担。

code 正文中的普通选择、点击与横向手势 MUST NOT 写 `content_width`，MUST NOT 改变侧栏宽度。侧栏与 pane 分栏 SHALL 继续由各自既有控制独占调整。

#### Scenario: Markdown 拖宽不改变既有 code 会话

- **WHEN** 先打开 code 文件并记录内容框与长行读数，再切到 Markdown 拖宽并切回 code
- **THEN** code 内容框仍等于当前 pane 的可用宽度，自然文本宽与折行状态不变；拖拽只写一次 Markdown 的 `content_width`

#### Scenario: code 正文手势不触发宽度配置

- **WHEN** 在 code 正文内部点击或进行普通横向手势
- **THEN** 不产生 `content_width` 写入，侧栏宽度不变，文档与选区只按编辑器自身语义响应

## MODIFIED Requirements

### Requirement: 拖拽调宽手柄

Markdown 正文列的左右缘 SHALL 各有一条拖拽手柄，用于调整阅读栏宽。手柄 SHALL：

- 常态不可见（不占布局、不遮挡文字、不进 Tab 序）；光标 hover 到列缘命中区（列缘两侧各约 5px）
  时显现，拖拽全程保持显现，移开且非拖拽中 SHALL 隐去；
- 是 shell 层（编辑器 pane）的覆盖元素，MUST NOT 落在 CodeMirror 的文档 DOM（`.cm-scroller` /
  `.cm-content`）内部，MUST NOT 以 margin 表达任何间距（CM 按 border-box 量行高，margin 对高度图
  不可见——M110 同族纪律，`src/preview/livePreview.ts:734`、`src/style.css:284-288`）；
- 命中区 SHALL 带 `col-resize` 光标；除命中区外 MUST NOT 拦截文本选择、点击落点与滚动；
- 仅在其 root 宿主与活跃 doc 会话均为 md 模式时出现；任一为 code 都 MUST NOT 出现阅读栏宽手柄，
  因为满 pane 工作区没有该控制的作用对象，也不得把其它 pane 的 Markdown 手柄落到 root code 上。
  无前台文档的空态、notice 或首启覆盖层在场时 MUST NOT 出现；
- 拖拽 SHALL 对称作用于两侧：栏宽变化 = 2 × 指针位移；宽度值钳制在「宽度配置项与校验」规定的
  上下限内，到界后继续拖拽 MUST NOT 改变宽度、MUST NOT 报错或提示；
- 拖拽 SHALL 实时重排（live）：每次宽度应用 SHALL 写 `--layout-doc-measure` token 并显式触发
  CodeMirror 重测量（CSS 变量变化不触发 CM 的 ResizeObserver，见「宽度变化的测量与重排口径」）；
  若实现期大文档实测不达标，允许退化为「拖拽中只画手柄线、松手时一次施加」，该退化 SHALL 记录在
  design 与验收证据里，MUST NOT 静默降级。

拖拽 MUST NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、MUST NOT 进撤销栈、
MUST NOT 改变 dirty 状态。本能力 MUST NOT 新增命令或键位（纯鼠标交互）；键盘调宽不在本期范围。
侧栏宽度与 pane 分栏仍由各自既有控制负责，阅读栏手柄 MUST NOT 成为这些控制的别名或覆盖层。

#### Scenario: hover 显现与隐去

- **WHEN** 打开一份 Markdown，光标移到正文列右缘命中区，随后移开
- **THEN** hover 时右缘手柄显现（竖线可见、光标为 `col-resize`），移开后隐去；全程文档内容
  逐字节不变

#### Scenario: 对称拖拽与上下限

- **WHEN** 打开一份 Markdown，把右缘手柄向右拖 80px，再把左缘手柄向左拖到超出下限
- **THEN** 第一次拖拽后栏宽增加 160px（两侧对称）；第二次拖拽在到达下限后宽度停在下限值，
  继续拖不再收窄、无报错

#### Scenario: 空态无手柄

- **WHEN** 未装载任何 vault（空态覆盖层在）
- **THEN** 两条手柄都不可见，hover 原列缘位置无任何反应

#### Scenario: code 模式同样有手柄

这是为 OpenSpec 1.12 MODIFIED 对账保留的历史场景名；新行为是否定式。

- **WHEN** 打开一个非 md 文件，或从 Markdown 切到既有 code 标签
- **THEN** 阅读栏手柄覆盖层隐藏，读屏树不再提供「调整内容宽度」；切回 Markdown 后两条手柄恢复
  并贴合阅读栏实际左右缘

### Requirement: 宽度变化的测量与重排口径

每次宽度应用（启动装配、拖拽每帧、松手生效路径）SHALL 由同一入口完成三步：写
`--layout-doc-measure` token（`documentElement` 上）、显式 `view.requestMeasure()`、光标行保持在
视口内（`scrollIntoView` 最小滚动，与 typography 的 `keepCaretVisible` 同口径）。

显式重测量是**正确性条件**，不是优化：CM 的 ResizeObserver 只观察 `scrollDOM`，grid 中列宽变化
不触发它（`@codemirror/view@6.43.11` dist 实证，design §1.4）；缺了它，高度图与坐标停留在旧宽度
（M103/M110 同族）。折行开时，栏宽变化超过一个字符宽由 CM 测量 pass 触发高度
oracle 刷新与高度图重建——折行重算 SHALL 由这条 CM 既有链路承担，本 change MUST NOT 另造折行
触发路径；折行关时高度不变，横向溢出范围随列宽更新。宽度 MUST NOT 用 margin 或文档流内间距表达
（M110 纪律）。

宽度是**应用级 Markdown 阅读意图**：token 在 `documentElement` 上，全部 Markdown 标签页（含后台）
与随后新建的 Markdown 会话 SHALL 呈现同一栏宽；切标签页 SHALL NOT 改变栏宽。code 模式不消费该 token，
其工作区宽度只由所在 pane 与行号 gutter 决定。Markdown 的 token 写入与逐 pane 重测量广播保留，
不因 code 的布局策略删除共享装配链。

图片列数换算、表格与代码块横滚容器等下游几何 SHALL 随 Markdown 列宽变化正确更新（由浏览器布局 + CM 重测量
承担）；若实现期实测发现几何缓存不失效，实现的失效逻辑 SHALL 写进 design 的实测记录。

#### Scenario: 折行下收窄后坐标与画面一致

- **WHEN** 折行开时打开一份含超长正文行的 Markdown，拖窄栏宽 100px
- **THEN** 超长行的折点数增加；点击折行内的文字，光标落在点击的字符处（坐标与画面一致，
  重测量到位的试金石）

#### Scenario: 不折行下变宽更新横向溢出

- **WHEN** `{"editor": {"line_wrap": false}}` 下打开含超长行的 Markdown，拖宽栏宽
- **THEN** `.cm-scroller` 的横向可滚动范围随列宽收缩，超长行仍可横向到达，MUST NOT 被裁掉

#### Scenario: 全部标签页同宽

历史场景名保留用于 MODIFIED 对账；新合同只让 Markdown 共享阅读栏，code 不消费该 token。

- **WHEN** 打开两个 Markdown 标签页，在前台标签页拖拽改宽，切到后台标签页再切回
- **THEN** 两个 Markdown 标签页呈现同一新栏宽；新建 Markdown 标签页也取当前运行期宽度；
  既有 code 标签的内容框不消费这次变化

#### Scenario: 大文档拖拽的帧预算

- **WHEN** 折行开时打开 1MB 探针文档，做一次完整拖拽
- **THEN** 「施加 → 重测量 → 绘制」的帧耗时实测数据落在证据目录里；若不达标（参照
  keypress-to-paint <16ms 的合同口径，ADR 0002 §6），实现 SHALL 退化为松手生效并在 design
  记录实测数据，MUST NOT 带损上线且不声明
