## MODIFIED Requirements

### Requirement: 链接 span 定位与三态显示

md 模式装饰层 SHALL 在视口内定位 wikilink span（词法范围识别，视口增量构建，沿用 live preview 装饰层纪律），并按 `link_graph_resolve` 返回的解析结果分三态显示（spec §4.1）：`resolved` 正常链接样式（显示 alias 或 target）；`ambiguous` 链接样式加歧义标识，悬停提示候选列表；`unresolved` 未创建链接样式。前端 MUST NOT 在 span 定位之外复制解析语义（架构复查 P1-4）。

普通 `[[…]]` 的编辑态 SHALL 复用 live preview 共享的 `touchesSource` 判据：光标或选区触及 span 时，三态 replace 装饰 MUST 撤下并显露完整源码；选区离开后 SHALL 恢复对应三态。进入后 SHALL 允许按字素逐位移动和编辑，MUST NOT 把整条 wikilink 作为原子步。无 resolver 与 pending 态的原文显示保持现状；pending 转为任一三态时，若选区仍触及 span，MUST NOT 重新隐藏正在编辑的源码。显露与装饰重建 MUST NOT 改写文档。

普通 wikilink widget 只在**无修饰主键且可编辑**时复用 `enterReplacedSource`：点击后编辑器持焦、完整源码显露，空光标落在 target / alias 的源码区内；进入后仍可移动到定界符。Meta / Ctrl 主键 MUST 在调用 helper 前直接让开，不得先 `preventDefault`、dispatch 选区、显露或聚焦：Meta 冒泡给既有链接跟随，Ctrl 让回既有系统次级点击与 CM 原生路径，不改变「Meta 激活、Ctrl 不激活」的现行合同。`EditorState.readOnly` 会话 MUST NOT 通过该入口改变选区或进入编辑态。

指针拖选 SHALL 采用两次手势：第一次无修饰 click 或 drag 只进入源码，第一次 drag 在 mouseup 后保持空光标，不得声称从 widget 直接拖出 alias；第二次在已显露源码上拖选 target / alias 时走 CM 原生文本选区，选区精确等于用户拖出的源码范围，定界符不得被隐式外扩。`![[…]]`、unsupported / 附件渲染路径不在本段改动范围内。

#### Scenario: 未创建链接区分显示

- **WHEN** 文档含 `[[不存在的笔记]]` 且解析结果为 `unresolved`
- **THEN** 该链接以未创建样式显示（与正常链接视觉可区分），不显示为错误

#### Scenario: 歧义链接标识

- **WHEN** 文档含 `[[Beta]]` 且解析结果为 `ambiguous`
- **THEN** 链接带歧义标识，悬停可见候选列表

#### Scenario: 键盘进入后逐字素编辑

- **WHEN** 可编辑会话中，用户用 `→` / `⌃F` 从左侧进入 resolved、ambiguous 或 unresolved 的普通 wikilink，继续移动并键入，随后反向移出
- **THEN** 首个 span 内部落点即显露完整 `[[…]]` 源码，之后按字素逐位移动，键入只改变对应源码；移出后恢复对应三态，未编辑的移动路径文档逐字节不变

#### Scenario: 无修饰点击 widget 中部进入源码

- **WHEN** 可编辑会话中，用户用无修饰主键点击普通 wikilink widget 的中部
- **THEN** 编辑器持焦，完整源码显露，空光标位于 target / alias 源码区内而不是链接前后边界；仅点击时文档逐字节不变

#### Scenario: Meta / Ctrl 不先经过编辑入口

- **WHEN** 分别对 resolved、ambiguous、unresolved widget 执行 Meta-Click 与 Ctrl-Click，并记录原视图选区、widget 与焦点
- **THEN** 两种手势都不会先产生编辑入口的选区 dispatch、源码显露或聚焦；Meta 按既有规则打开 resolved / ambiguous 目标或对 unresolved 给 toast，其中 unresolved 的选区、焦点和 widget 保持不变；Ctrl 三态均不激活链接、无新 toast，选区与焦点只呈现既有系统 / CM 原生结果

#### Scenario: 第一次 drag 只进入，第二次拖选精确不外扩

- **WHEN** 用户先在渲染 widget 的 alias 上执行一次无修饰 drag，再在已显露源码上执行第二次部分 / 完整 alias 或 target-only 的正向 / 反向拖选
- **THEN** 第一次 drag 只显露源码并在 mouseup 后保持空光标；第二次拖选由真实鼠标路径产生，选区精确等于拖出的源码字符，`[[` / `]]` 不被隐式并入，文档逐字节不变

#### Scenario: pending 完成不遮回编辑面

- **WHEN** 用户正在编辑 pending 的普通 wikilink，解析随后完成为 resolved、ambiguous 或 unresolved，且选区仍触及 span
- **THEN** 完整源码持续可见且可编辑，三态只在选区离开后恢复

#### Scenario: 只读会话不进入编辑态

- **WHEN** `EditorState.readOnly` 会话中用户用无修饰主键点击普通 wikilink widget
- **THEN** 不通过编辑入口改变选区或焦点，不显露可编辑源码，文档逐字节不变
