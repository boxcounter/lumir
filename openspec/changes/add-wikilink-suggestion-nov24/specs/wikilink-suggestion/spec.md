## ADDED Requirements

### Requirement: 行内 `[[` 候选的触发与关闭

可编辑 md 会话中，编辑器持焦且主选区为空光标时，系统 SHALL 在光标位于当前行最内层未闭合的普通 `[[` 之后显示笔记候选。opener MUST NOT 由 `!` 前缀构成 embed；opener 到光标之间的查询 MUST NOT 含 `|`、`#`、`[`、`]` 或换行。光标位于完整既有 wikilink 内、frontmatter、行内代码、围栏 / 缩进代码、只读会话、非空选区或 IME 组合期时 MUST NOT 新触发候选。

查询 SHALL 直接来自文档正文，不得创建持焦输入框。退格使 opener 不完整、光标离开触发区间、进入排除上下文、编辑器失焦、切标签、切 vault 或锚点滚出视口时 SHALL 关闭。除接受候选外，打开、过滤、导航与关闭 MUST NOT 改写 `EditorState.doc` 或磁盘文件。

#### Scenario: 输入与退格控制候选生命周期

- **WHEN** 可编辑 md 文档的普通正文里输入 `[[`，继续输入查询，再退格删掉一个 `[`
- **THEN** 输入 opener 后候选出现且查询随正文更新；opener 不再完整时候选关闭，这些操作除用户实际键入 / 退格外不产生额外文档变更

#### Scenario: 排除上下文与完整链接内部

- **WHEN** 光标分别位于 `![[`、完整 `[[note]]` 内部、frontmatter、行内代码、围栏代码、只读会话或非空选区
- **THEN** 不新显示候选，不创建持焦输入框，文档逐字节不变

### Requirement: 候选来源、匹配与稳定分层

候选 SHALL 同步读取与 Quick Open 相同的 `vaultFilePaths` 内存索引，只保留 `fileClassOfPath(path) === "md"` 的路径并按完整路径去重；MUST NOT 新增 IPC、异步磁盘枚举或依赖，MUST NOT 改用包含 code / text 的 `linkableVaultPaths`。显示文本 SHALL 是完整 vault 相对路径；惰性目录不在当前索引的既有边界保持不变。

候选 SHALL 复用 `list-filter` 的 `foldCase`、子串匹配和保序语义，依次分为精确 stem、折叠 stem、折叠前缀、折叠子串四层：精确为 `stem === query`；折叠为 `foldCase(stem) === foldCase(query)`；前缀为折叠 stem 以折叠 query 开头；子串经 `filterIndices` 对显示路径匹配。每项只进入最前一个命中层，层间按四层顺序、层内保持源数组顺序，MUST NOT 计算相似度分数或引入模糊子序列、拼音、全角 / 简繁归一。空查询全部命中并保序；连接后 SHALL 最多显示 100 条，零命中显示既有 `NO_MATCH_TEXT` 且不设置活动候选。

无法无损表示为 wikilink target 的路径 MUST NOT 生成可接受候选；系统 MUST NOT 为其发明转义或接受会改变解析语义的字符串。

#### Scenario: 四层顺序且层内保序

- **WHEN** 索引中同时存在精确大小写 stem、仅折叠后相等的 stem、以前缀命中的 stem 与仅在完整路径中子串命中的笔记
- **THEN** 候选依次按精确、折叠、前缀、子串排列，每层内部与 `vaultFilePaths` 源顺序一致，不出现相似度分数或额外重排

#### Scenario: 空态不变成创建动作

- **WHEN** 查询没有任何可接受候选
- **THEN** 浮层显示既有零命中文案，没有活动候选或创建行，Enter 委派既有编辑器逻辑，vault 不新增文件

#### Scenario: 不可表示 target 不被错误接受

- **WHEN** 某 md 路径含 wikilink 保留分隔符或其他无法无损表示为 target 的字符
- **THEN** 该路径不作为可接受候选，系统不生成解析到不同文件或不同语义的链接

### Requirement: 接受候选与 Rust 解析往返

接受候选时，系统 SHALL 只用所选 target 替换 `[[` 后的当前查询并补齐 `]]`，保留 opener，光标落在闭合链接之后并关闭浮层；MUST NOT 自动打开、创建或改写目标文件。对当前索引内全部可表示 md 路径按 `foldCase(stem)` 分组：组内唯一时插入实际大小写的 stem；组内多个同名时插入该文件完整 vault 相对路径并去掉末尾大小写不敏感的 `.md`。MUST NOT 把用户的模糊查询前缀当作最终 target。

每个可接受插入串 SHALL 经 Rust 既有 wikilink 解析回到所选路径：唯一 stem 不得产生歧义，同名完整路径不得退化为 stem，Rust 仍是解析与 `chosen` 的唯一实现。不存在笔记的创建 SHALL 继续归既有显式 ⌘⏎ 流程，候选层不得直接创建。

#### Scenario: 唯一 stem 接受

- **WHEN** 用户输入 `[[alp`，唯一匹配项为 `notes/Alpha.md`，按 Enter 接受
- **THEN** 文档得到 `[[Alpha]]`，光标在 `]]` 之后，Rust 解析到 `notes/Alpha.md`，不打开该文件

#### Scenario: 折叠同名插入完整路径

- **WHEN** 索引含 `a/Note.md` 与 `b/note.md`，用户选择 `b/note.md`
- **THEN** 文档插入 `[[b/note]]` 而不是 `[[note]]`，Rust 精确解析到 `b/note.md`，不产生 ambiguous 结果

#### Scenario: 不存在笔记仍走显式创建

- **WHEN** 用户输入没有任何候选的名称
- **THEN** 候选层不创建文件；只有随后使用既有显式 ⌘⏎ 创建入口时才进入 `wikilink_create` 流程

### Requirement: 候选的键鼠、焦点与 IME 语义

浮层打开且有活动候选时，Enter SHALL 经既有 `markupKeymap` 分支接受；↓ / ↑ 与 ⌃N / ⌃P SHALL 在既有垂直光标命令内分派为候选导航；Escape SHALL 经 escape-router 关闭栈顶浮层。浮层关闭或无活动候选时这些键 SHALL 完全恢复既有语义。Tab MUST NOT 被候选层接管，MUST NOT 新增物理键绑定。

候选行主键 `mousedown` SHALL `preventDefault` 并接受该行，编辑器始终保持焦点；点击浮层外 SHALL 关闭但不拦截点击的默认行为。浮层 MUST NOT 使用持焦 input、`aria-modal` 或独立焦点状态机。

IME 组合期 SHALL 保留已打开浮层但冻结候选刷新，组合期文档变化不得重算列表；`compositionend` 后 SHALL 按最终文档补一次刷新。`event.isComposing` 或 `keyCode === 229` 时，Enter 与候选导航键 MUST 让 IME 处理，不得接受、移动候选或 `preventDefault`。

#### Scenario: 键盘接受与既有键位恢复

- **WHEN** 浮层打开时依次使用 ↓ / ↑、⌃N / ⌃P 和 Enter，随后关闭浮层再按这些键及 Tab
- **THEN** 打开时只移动候选并由 Enter 接受；关闭后方向键恢复光标移动、Enter 恢复既有换行逻辑、Tab 保持既有列表缩进，编辑器焦点不迁移到浮层

#### Scenario: 鼠标接受不抢焦点

- **WHEN** 用户主键点击某一候选行，随后再次打开候选并点击浮层外正文
- **THEN** 点击行接受所选 target 且编辑器始终持焦；点击外部只关闭浮层并保留正文点击的既有落点行为

#### Scenario: IME 组合不刷新不吞确认

- **WHEN** 候选已打开，用户开始 IME 组合、用 Enter 确认候选文本并结束组合
- **THEN** 组合期间候选列表不刷新，确认 Enter 不被 Lumir 候选接受或消费；`compositionend` 后只按最终查询补一次刷新，文档只包含 IME 实际提交内容

### Requirement: 候选浮层的不透明视觉与几何合同

候选浮层 SHALL 以 `view.coordsAtPos(head)` 为锚点、`position: fixed`，水平宽度与视口夹取复用 `placeOverlay` 的 `list` 档；垂直方向下方空间不足时上翻，resize / 滚动后 MUST 重夹或关闭，不得停留在视口外。路径行 SHALL 复用 Quick Open 的目录先让宽、文件名后裁与全文提示，同名候选必须可区分。

浮层壳 SHALL 使用 `--preview-bg`、1px `--border`、`--r10`、`--shadow-raise` 与 `--fs-ui-s`；light / dark / eink 三主题计算后的背景 alpha MUST 等于 1，正文 MUST NOT 透过候选壳。行几何、文字、目录、活动与 hover 状态 SHALL 复用 Quick Open 对应的现有 spacing、`--r6`、`--text`、`--text-3`、`--sel`、`--hover` 和 currentColor，MUST NOT 新增颜色、字号、圆角或阴影 token。滚动列表 SHALL 登记到既有原生 overlay 豁免档，MUST NOT 新增自绘滚动条或 `scrollbar-gutter`，右缘 12px 内不得新增常驻按钮。

#### Scenario: 三主题与长路径均不透明且不越界

- **WHEN** 分别在 light / dark / eink、默认与放大字号下打开含长路径和同名项的候选，并把光标移到视口边缘后 resize
- **THEN** 浮层背景计算值完全不透明，路径身份可辨，水平夹取来自 `placeOverlay`，垂直按可用空间重夹或上翻，浮层不越出视口

#### Scenario: 浮层滚动容器遵守既有分档

- **WHEN** 候选超过可视高度并滚动列表
- **THEN** 列表使用已登记的原生 overlay 豁免档，没有新增自绘滚动条、`scrollbar-gutter` 或右缘常驻按钮，活动项始终滚入视野
