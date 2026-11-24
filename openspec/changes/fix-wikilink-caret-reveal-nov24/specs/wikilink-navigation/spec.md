## MODIFIED Requirements

### Requirement: 链接 span 定位与三态显示

md 模式装饰层 SHALL 在视口内定位 wikilink span（词法范围识别，视口增量构建，沿用 live preview 装饰层纪律），并按 `link_graph_resolve` 返回的解析结果分三态显示（spec §4.1）：`resolved` 正常链接样式（显示 alias 或 target）；`ambiguous` 链接样式加歧义标识，悬停提示候选列表；`unresolved` 未创建链接样式。前端 MUST NOT 在 span 定位之外复制解析语义（架构复查 P1-4）。

普通 `[[…]]` 的编辑态 SHALL 复用 live preview 共享的 `touchesSource` 判据：光标或选区触及 span 时，三态 replace 装饰 MUST 撤下并显露完整源码；选区离开后 SHALL 恢复对应三态。进入后 SHALL 允许按字素逐位移动和编辑，MUST NOT 把整条 wikilink 作为原子步。无 resolver 与 pending 态的原文显示保持现状；pending 转为任一三态时，若选区仍触及 span，MUST NOT 重新隐藏正在编辑的源码。显露与装饰重建 MUST NOT 改写文档。

普通 wikilink widget 的主键指针入口 SHALL 复用 `enterReplacedSource`：点击后编辑器持焦、完整源码显露，空光标落在 target / alias 的源码区内；进入后仍可移动到定界符。`EditorState.readOnly` 会话 MUST NOT 通过该入口改变选区或进入编辑态。Mod-Click 跳转、显式创建、`![[…]]` 与 unsupported / 附件渲染路径不在本段改动范围内。

#### Scenario: 未创建链接区分显示

- **WHEN** 文档含 `[[不存在的笔记]]` 且解析结果为 `unresolved`
- **THEN** 该链接以未创建样式显示（与正常链接视觉可区分），不显示为错误

#### Scenario: 歧义链接标识

- **WHEN** 文档含 `[[Beta]]` 且解析结果为 `ambiguous`
- **THEN** 链接带歧义标识，悬停可见候选列表

#### Scenario: 键盘进入后逐字素编辑

- **WHEN** 可编辑会话中，用户用 `→` / `⌃F` 从左侧进入 resolved、ambiguous 或 unresolved 的普通 wikilink，继续移动并键入，随后反向移出
- **THEN** 首个 span 内部落点即显露完整 `[[…]]` 源码，之后按字素逐位移动，键入只改变对应源码；移出后恢复对应三态，未编辑的移动路径文档逐字节不变

#### Scenario: 点击 widget 中部进入源码

- **WHEN** 可编辑会话中，用户用主键点击普通 wikilink widget 的中部
- **THEN** 编辑器持焦，完整源码显露，空光标位于 target / alias 源码区内而不是链接前后边界；仅点击时文档逐字节不变，Mod-Click 跳转语义不变

#### Scenario: pending 完成不遮回编辑面

- **WHEN** 用户正在编辑 pending 的普通 wikilink，解析随后完成为 resolved、ambiguous 或 unresolved，且选区仍触及 span
- **THEN** 完整源码持续可见且可编辑，三态只在选区离开后恢复

#### Scenario: 只读会话不进入编辑态

- **WHEN** `EditorState.readOnly` 会话中用户主键点击普通 wikilink widget
- **THEN** 不通过编辑入口改变选区或焦点，不显露可编辑源码，文档逐字节不变
