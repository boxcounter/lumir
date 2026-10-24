## ADDED Requirements

### Requirement: 对话表格的固有宽与局部横滚

harness transcript 里渲染出的 GFM 表格 SHALL 按**内容固有宽**布局（`width: max-content`），
单元格 MUST NOT 因 pane / 正文栏宽不足而折行；自然宽窄于正文栏宽的表格 SHALL 贴合内容宽度，
MUST NOT 被拉满整栏。宽表的横向溢出 SHALL 只落在表格自己的横滚容器 `.lumir-hp-table-scroll` 内
（块级、`max-inline-size: 100%`、`overflow-x: auto`、`overflow-y: hidden`、
`overscroll-behavior-inline: contain`）；transcript 与消息列 MUST NOT 因表格出现横向溢出
（`scrollWidth === clientWidth`）。

**两半缺一不可**（M699 探针逐值实测，pane 480 / 正文栏 463）：只加横滚容器而无固有宽时，表仍被
auto 表布局压回正文栏宽、容器永不溢出（`scrollWidth === clientWidth`，与改动前逐值相同）；
只加固有宽而无容器时，表的溢出抬高整个正文列、transcript 整列横向滚动（实测溢出 53px）。
实现 MUST 同时满足两条，MUST NOT 以「只包一层容器」或「只给表加宽」交付。

结构 SHALL 是 `定位容器 > 横滚容器 > table`：全屏触发钮的定位容器（`.lumir-hp-block-slot`）仍在
横滚容器**之外**，内容横向滚动时钮不动；全屏入口 SHALL 仍以 `<table>` 本身为快照源（不是横滚容器），
遮罩快照里 MUST NOT 出现横滚容器层。表格可嵌套在 blockquote 与 list item 内，横滚容器 MUST NOT
假设自己是 `.lumir-hp-body` 的直接子节点，SHALL 以 `max-inline-size: 100%` 随包含块收缩。

横滚容器 SHALL 归细条档（与 harness 代码块 / diff / argv 共用同一份声明，见 ui-design-system 的
「滚动条分档与滚动容器注册表」），MUST NOT 声明 `scrollbar-gutter`。横向条只占容器底带，右上角
6px 的块级全屏钮不在条带上（与正文 `.cm-lp-table-scroll` + `.cm-lp-table-slot` 的既有组合同构）。

非目标：MUST NOT 引入 sticky 表头、列宽拖拽或固定列上限（沿用 `docs/specs/table-reading.md` §3
的宽度合同与 M119 禁则）；MUST NOT 用 JS 测量回写宽度（纯声明式）；全屏遮罩的呈现与关闭路径
逐值不变——固有宽声明收敛在 `.lumir-hp-table` 一处，快照克隆随元素命中同一条声明。

#### Scenario: 窄 pane 下的宽表

- **WHEN** harness pane 约 480px 宽（1:1 分栏），消息里有一张自然宽约 524px 的 4 列表格
- **THEN** 表格保持 524px 固有宽、每个 th/td 的文本仍是单行；表格的横滚容器出现＞20px 的横向溢出，
  而 `.lumir-hp-transcript` 的 `scrollWidth === clientWidth`（整列不横滚）；定位容器的右缘与横滚
  容器右缘相差 ≤1px，全屏钮距该右缘 6px

#### Scenario: 宽 pane 下的同一张表

- **WHEN** harness pane 宽于表格固有宽（如窗口 1800px、1:1 分栏）
- **THEN** 横滚容器无横向溢出（`scrollWidth === clientWidth`），表格仍按固有宽呈现、不被拉伸满栏，
  也不出现滚动条带

#### Scenario: 长 URL 单元格

- **WHEN** 表格 cell 里有一个长 URL，使表格自然宽明显超过正文栏宽
- **THEN** URL 不在 cell 内折行（文本单行），表格保持固有宽，溢出只由表格的横滚容器承载

#### Scenario: 窄表回归

- **WHEN** 消息里的表格自然宽明显窄于正文栏宽
- **THEN** 定位容器、横滚容器与表格三者同宽（相差 ≤1px）；横滚容器无横向溢出；全屏钮仍锚在
  表格右缘内侧 6px

#### Scenario: 嵌套在 blockquote / list item 内

- **WHEN** 宽表落在 blockquote 或 list item 内，包含块窄于正文栏
- **THEN** 横滚容器收缩到该包含块的内容宽，表格保持固有宽，溢出只在该容器内滚动；
  transcript 仍无横向溢出

#### Scenario: 全屏入口仍以表格为快照源

- **WHEN** 点击宽表或窄表的全屏钮
- **THEN** 遮罩快照的直接内容节点是 `table.lumir-hp-table`（不含 `.lumir-hp-table-scroll` 层），
  表格按自然尺寸呈现、放不下时双向滚动；关闭路径与既有条款一致

## MODIFIED Requirements

### Requirement: 面板块级全屏钮的锚点

harness 面板里，表格块的全屏触发钮 SHALL 锚定在**表格自身可视盒**的右上角内侧（`right` / `top`
各 6px），MUST NOT 悬在面板正文的右缘：表格所在的定位容器 SHALL 贴合表格的自然宽（上限为面板正文宽），
窄表因此钮随表可见、与表之间不隔空白。代码块的全屏钮 SHALL 保持整行锚点（块底色铺满面板正文宽，
其右缘即块可视盒右缘），MUST NOT 因本条款改为随内容宽收缩。钮的形态、图标、读屏名、出现时机与
点击行为沿用既有条款——本条款只改锚点，MUST NOT 引入第二套位置 class 或新的尺寸值。

#### Scenario: 窄表

- **WHEN** 面板消息里有一张自然宽明显窄于面板正文宽的表格，指针悬停该表
- **THEN** 全屏钮出现在表格右缘内侧 6px（定位容器的右缘与表格右缘相差 ≤1px），点击仍打开该表的全屏遮罩

#### Scenario: 宽表与代码块

- **WHEN** 表格自然宽达到或超过面板正文宽 / 指针悬停一个代码块
- **THEN** 表格的定位容器以面板正文宽为上限且自身不横向溢出，表格保持内容固有宽、超出部分由面板内的
  局部横滚容器承载（见「对话表格的固有宽与局部横滚」）；代码块的定位容器仍与面板正文同宽
