## MODIFIED Requirements

### Requirement: 行内 `[[` 候选的触发与关闭

可编辑 md 会话中，编辑器持焦且主选区为空光标时，系统 SHALL 在光标位于当前行最内层未闭合的普通 `[[` 之后显示笔记候选。opener MUST NOT 由 `!` 前缀构成 embed；opener 到光标之间的查询 MUST NOT 含 `|`、`#`、`[`、`]` 或换行。光标位于完整既有 wikilink 内、frontmatter、行内代码、围栏 / 缩进代码、标准 Markdown `Link` / `Image`（含未闭合 label / alt）、只读会话、非空选区或 IME 组合期时 MUST NOT 新触发候选。opener 与 head 的 lezer 上下文 SHALL 都参与 `Link` / `Image` 排除，不得只排除完整 `[text](url)`。

查询 SHALL 直接来自文档正文，不得创建持焦输入框。退格使 opener 不完整、光标离开触发区间、进入排除上下文、编辑器失焦、切标签、切 vault 或锚点滚出视口时 SHALL 关闭。除接受候选外，打开、过滤、导航与关闭 MUST NOT 改写 `EditorState.doc` 或磁盘文件。

每个文档、选区、语法树或焦点更新完成后，候选控制器 SHALL 重读当前 `EditorState` 并重算 trigger 与 items；query 改变后 MUST NOT 展示上一代 items，trigger 不存在时 MUST NOT 保留旧 `OpenState` 或候选 DOM。已有候选时语法树暂不可用只允许绕过可用性门，MUST NOT 跳过 trigger 重算、query 过滤或关闭条件；首次打开 SHALL 在允许上下文可判定后立即展示当前空 query 候选。原生输入事件先于 state 更新到达时 MUST NOT 将旧 query 当作新一代渲染，最终 DOM 以事务后的 state 为准。候选渲染 MUST NOT 在 CodeMirror update 阶段读取布局而使插件失效，布局读取 SHALL 延后到合法 measure 阶段；IME 组合期的刷新冻结仍以「候选的键鼠、焦点与 IME 语义」为准。

候选 listbox 的 `aria-label` 与无匹配空态 SHALL 在构造、首次打开及 `<html lang>` 更新后的同一同步语言施加链中，通过同一 relabel 写入路径读取当前语言。已打开的有候选或空态形态在 zh ↔ en 切换后 SHALL 立即使用新语言，MUST NOT 依赖输入、方向键、query / items / active 变化或关闭重开。relabel MUST NOT 重算 trigger / items、读取布局或改变文档、选区、焦点与开闭状态，也不得产生额外落盘；候选布局读取仍只允许位于合法 measure 阶段，IME 组合期刷新冻结与单次刷新语义不变。

#### Scenario: 输入与退格控制候选生命周期

- **WHEN** 可编辑 md 文档的普通正文里输入 `[[`，继续输入查询，再退格删掉一个 `[`
- **THEN** 输入 opener 后候选出现且查询随正文更新；opener 不再完整时候选关闭，这些操作除用户实际键入 / 退格外不产生额外文档变更

#### Scenario: 原生事务矩阵中候选与当前 query 同步

- **WHEN** 在普通正文、列表、CJK 前缀与多行文本中分别逐字输入 `[[`、`s`、`i`，再逐字删除到 `s`、空 query 与不完整 opener
- **THEN** 完整 opener 在允许上下文可判定后立即展示当前未过滤候选；每拍 items 都由当前 query 重算，不展示上一代 items；删到单个 `[` 时 `OpenState` 与候选 DOM 均关闭，且 CodeMirror 不报告候选插件崩溃

#### Scenario: 已有候选时语法树暂不可用

- **WHEN** 大文档中已有候选且当前语法树暂不可用，随后以当前正文重算 query、进入不完整 opener 或其他排除条件，并在后续解析更新完成后再次判定
- **THEN** 已有候选只绕过可用性门，trigger 与 query 仍来自当前正文，关闭条件仍然生效；解析可用后按同一当前状态判定，首次打开仍不得绕过可用性门

#### Scenario: 首次打开与运行期语言切换共用 relabel

- **GIVEN** 中文配置已施加，候选控制器早于配置装配完成构造
- **WHEN** 首次打开有候选或无匹配空态，随后分别保持浮层打开并以 `zh → en → zh` 切换界面语言，期间不输入、不按方向键且不关闭重开
- **THEN** 首次 listbox 读屏名为「筛选」、空态为「没有匹配的条目」；每次切换后两者立即逐字使用当前语言，query、items、active、文档、选区、焦点、开闭状态与磁盘均不变，且不引入 update 阶段布局读取或额外 IME 刷新

#### Scenario: 排除上下文与完整链接内部

- **WHEN** 光标分别位于 `![[`、完整 `[[note]]` 内部、frontmatter、行内代码、围栏代码、只读会话或非空选区
- **THEN** 不新显示候选，不创建持焦输入框，文档逐字节不变

#### Scenario: 标准链接与图片 label / alt 内不触发不接受

- **WHEN** 光标位于 `[see [[alp](https://example.invalid)` 的 `alp` 后、对应图片 `![alt [[alp](image.png)` 的 `alp` 后，以及已完整解析的标准链接 label / 图片 alt 内，随后按 Enter
- **THEN** 这些位置均不显示候选，Enter 不被候选接受或消费，不插入 wikilink target；负例覆盖未闭合 label / alt，不能只复用无嵌套 `[[` 的旧 fixture
