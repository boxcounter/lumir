# wikilink-suggestion Specification

## Purpose
在可编辑 Markdown 文档的行内 `[[` 后提供 vault 笔记候选，规定候选触发与生命周期、索引来源与稳定分层、完整路径接受及 Rust 唯一往返证书、键鼠 / 焦点 / IME 行为与浮层几何，保证除有效接受外不改写文档或磁盘。

## Requirements

### Requirement: 行内 `[[` 候选的触发与关闭

可编辑 md 会话中，编辑器持焦且主选区为空光标时，系统 SHALL 在光标位于当前行最内层未闭合的普通 `[[` 之后显示笔记候选。opener MUST NOT 由 `!` 前缀构成 embed；opener 到光标之间的查询 MUST NOT 含 `|`、`#`、`[`、`]` 或换行。光标位于完整既有 wikilink 内、frontmatter、行内代码、围栏 / 缩进代码、标准 Markdown `Link` / `Image`（含未闭合 label / alt）、只读会话、非空选区或 IME 组合期时 MUST NOT 新触发候选。opener 与 head 的 lezer 上下文 SHALL 都参与 `Link` / `Image` 排除，不得只排除完整 `[text](url)`。

查询 SHALL 直接来自文档正文，不得创建持焦输入框。退格使 opener 不完整、光标离开触发区间、进入排除上下文、编辑器失焦、切标签、切 vault 或锚点滚出视口时 SHALL 关闭。除接受候选外，打开、过滤、导航与关闭 MUST NOT 改写 `EditorState.doc` 或磁盘文件。

#### Scenario: 输入与退格控制候选生命周期

- **WHEN** 可编辑 md 文档的普通正文里输入 `[[`，继续输入查询，再退格删掉一个 `[`
- **THEN** 输入 opener 后候选出现且查询随正文更新；opener 不再完整时候选关闭，这些操作除用户实际键入 / 退格外不产生额外文档变更

#### Scenario: 排除上下文与完整链接内部

- **WHEN** 光标分别位于 `![[`、完整 `[[note]]` 内部、frontmatter、行内代码、围栏代码、只读会话或非空选区
- **THEN** 不新显示候选，不创建持焦输入框，文档逐字节不变

#### Scenario: 标准链接与图片 label / alt 内不触发不接受

- **WHEN** 光标位于 `[see [[alp](https://example.invalid)` 的 `alp` 后、对应图片 `![alt [[alp](image.png)` 的 `alp` 后，以及已完整解析的标准链接 label / 图片 alt 内，随后按 Enter
- **THEN** 这些位置均不显示候选，Enter 不被候选接受或消费，不插入 wikilink target；负例覆盖未闭合 label / alt，不能只复用无嵌套 `[[` 的旧 fixture

### Requirement: 候选来源、匹配与稳定分层

候选 SHALL 同步读取与 Quick Open 相同的 `vaultFilePaths` 内存索引，只保留 `foldCase(path).endsWith(".md")` 的路径，与 Rust `is_markdown` 的普通 wikilink 候选全集一致；`.markdown` MUST NOT 进入候选，`fileClassOfPath(path) === "md"` 的较宽分类 MUST NOT 用作本判据。候选按完整路径去重，MUST NOT 新增 IPC、异步磁盘枚举或依赖，MUST NOT 改用包含 code / text 的 `linkableVaultPaths`。显示文本 SHALL 是完整 vault 相对路径（含实际扩展名）；惰性目录不在当前索引的既有边界保持不变。

候选 SHALL 复用 `list-filter` 的 `foldCase`、子串匹配和保序语义，依次分为精确 stem、折叠 stem、折叠前缀、折叠子串四层：精确为 `stem === query`；折叠为 `foldCase(stem) === foldCase(query)`；前缀为折叠 stem 以折叠 query 开头；子串经 `list-filter` 的 `isFoldedMatch` 对预折叠显示路径与查询匹配。每项只进入最前一个命中层，层间按四层顺序、层内保持源数组顺序，MUST NOT 计算相似度分数或引入模糊子序列、拼音、全角 / 简繁归一。空查询全部命中并保序；连接后 SHALL 最多显示 100 条，零命中显示既有 `NO_MATCH_TEXT` 且不设置活动候选。

无法无损表示为 wikilink target 的路径 MUST NOT 生成可接受候选；系统 MUST NOT 为其发明转义或接受会改变解析语义的字符串。

#### Scenario: 四层顺序且层内保序

- **WHEN** 索引中同时存在精确大小写 stem、仅折叠后相等的 stem、以前缀命中的 stem 与仅在完整路径中子串命中的笔记
- **THEN** 候选依次按精确、折叠、前缀、子串排列，每层内部与 `vaultFilePaths` 源顺序一致，不出现相似度分数或额外重排

#### Scenario: `.markdown` 不属于普通 wikilink 候选全集

- **WHEN** 索引含 `notes/readme.markdown`
- **THEN** 该路径不进入候选，不能因 `fileClassOfPath` 将其归为 md 而提供接受

#### Scenario: 空态不变成创建动作

- **WHEN** 查询没有任何可接受候选
- **THEN** 浮层显示既有零命中文案，没有活动候选或创建行，Enter 委派既有编辑器逻辑，vault 不新增文件

#### Scenario: 不可表示 target 不被错误接受

- **WHEN** 某 md 路径含 wikilink 保留分隔符或其他无法无损表示为 target 的字符
- **THEN** 该路径不作为可接受候选，系统不生成解析到不同文件或不同语义的链接

### Requirement: 接受候选与 Rust 唯一往返证书

接受候选时，系统 SHALL 只用所选 target 替换 `[[` 后的当前查询并补齐 `]]`，保留 opener，光标落在闭合链接之后并关闭浮层；MUST NOT 自动打开、创建或改写目标文件。v1 插入文本 SHALL 是所选路径 `P` 的完整 vault 相对路径并保留实际 `.md` / `.MD` 扩展名，MUST NOT 按 folded stem 唯一性插入短 stem 或去掉扩展名。

每个可接受项 SHALL 按当前索引满足唯一往返证书：`P` 含 `/` 时，`T = P` 必须经 Rust 根相对精确匹配得到 `resolved(path = P)`；`P` 不含 `/` 时，仅当当前索引不存在另一份 md 路径 `Q ≠ P` 使 `file_name(Q) === P`，才允许以 `T = P` 经完整文件名精确匹配得到 `resolved(path = P)`。根文件存在精确同名时 MUST 判为不可接受，不得退回去试 stem 或制造 ambiguous 链接。接受前 SHALL 重读当前索引并复核路径、全集、可表示性与证书；不能重新证明 `resolved && path === P` 时 MUST NOT 插入，Enter 委派既有逻辑。

Rust 仍是最终解析与 `chosen` 的唯一实现。测试 SHALL 用真实 Rust fixture 证明每个可接受项 `status === "resolved" && path === P`，不可接受项零插入、零创建；不存在笔记的创建 SHALL 继续归既有显式 ⌘⏎ 流程。

#### Scenario: 非根完整路径接受

- **WHEN** 用户输入 `[[alp`，选择 `notes/Alpha.md` 并接受
- **THEN** 文档得到 `[[notes/Alpha.md]]`，光标在 `]]` 之后，Rust `resolved(path = "notes/Alpha.md")`，不打开该文件

#### Scenario: 重复 `.md` 不被完整文件名优先重定向

- **WHEN** 索引含 `foo.md` 与 `foo.md.md`（含目录变体），分别选择两项
- **THEN** 分别插入各自的完整路径含实际扩展名，Rust 均解析到所选路径；选择 `foo.md.md` 时 MUST NOT 插入会被解析到 `foo.md` 的 `[[foo.md]]`

#### Scenario: 扩展名大小写交叉保留精确目标

- **WHEN** 大小写敏感索引含 `a/note.md` 与 `a/note.MD`，分别选择两项
- **THEN** 分别插入 `[[a/note.md]]` 与 `[[a/note.MD]]`，Rust exact 匹配返回对应实际大小写路径，不得选择 folded 项

#### Scenario: 根文件精确同名不可接受

- **WHEN** 索引含根 `foo.md` 与 `dir/foo.md`
- **THEN** 根 `foo.md` 不提供接受，避免 `[[foo.md]]` 形成完整文件名歧义；`dir/foo.md` 可插入 `[[dir/foo.md]]` 并唯一解析；若另一项是 `dir/foo.MD` 而非精确同名，根 `foo.md` 的 exact 唯一性不受影响

#### Scenario: 接受时证书失效不写入

- **WHEN** 候选显示后、接受前索引变化，使所选路径消失或不再满足唯一往返证书
- **THEN** 接受动作不插入文本、不创建文件，Enter 委派既有编辑器逻辑；不得沿用展示时的旧证明

#### Scenario: 不存在笔记仍走显式创建

- **WHEN** 用户输入没有任何候选的名称
- **THEN** 候选层不创建文件；只有随后使用既有显式 ⌘⏎ 创建入口时才进入 `wikilink_create` 流程

### Requirement: 候选的键鼠、焦点与 IME 语义

浮层打开且有活动候选时，Enter SHALL 经既有 `markupKeymap` 分支接受；↓ / ↑ 与 ⌃N / ⌃P SHALL 在既有垂直光标命令内分派为候选导航；Escape SHALL 经 escape-router 关闭栈顶浮层。浮层关闭或无活动候选时这些键 SHALL 完全恢复既有语义。Tab MUST NOT 被候选层接管，MUST NOT 新增物理键绑定。

候选行主键 `mousedown` SHALL `preventDefault`，且仅在证书仍有效时接受该行；编辑器始终保持焦点。点击浮层外 SHALL 关闭但不拦截点击的默认行为。浮层 MUST NOT 使用持焦 input、`aria-modal` 或独立焦点状态机。

IME 组合期 SHALL 保留已打开浮层但冻结候选刷新，组合期文档变化不得重算列表。`compositionend` handler MUST NOT 同步按 `EditorState` 重建候选或 dispatch；系统 SHALL 复用列表的 composition settle 保护，等 CM observer 的 pending MutationRecord 清空且 `view.compositionStarted === false` 后，重读最终文档与 head，只补一次候选刷新。pending flush 前不得消费或丢弃记录，不得使用 compositionend 时缓存的旧 query。`event.isComposing` 或 `keyCode === 229` 时，Enter 与候选导航键 MUST 让 IME 处理，不得接受、移动候选或 `preventDefault`。

#### Scenario: 键盘接受与既有键位恢复

- **WHEN** 浮层打开时依次使用 ↓ / ↑、⌃N / ⌃P 和 Enter，随后关闭浮层再按这些键及 Tab
- **THEN** 打开时只移动候选并由 Enter 接受；关闭后方向键恢复光标移动、Enter 恢复既有换行逻辑、Tab 保持既有列表缩进，编辑器焦点不迁移到浮层

#### Scenario: 鼠标接受不抢焦点

- **WHEN** 用户主键点击某一候选行，随后再次打开候选并点击浮层外正文
- **THEN** 证书有效的点击行接受所选 target 且编辑器始终持焦；点击外部只关闭浮层并保留正文点击的既有落点行为

#### Scenario: IME 组合不刷新不吞确认

- **WHEN** 候选已打开，用户开始 IME 组合、用 Enter 确认候选文本并结束组合
- **THEN** 组合期间候选列表不刷新，确认 Enter 不被 Lumir 候选接受或消费；pending flush 后只按最终查询补一次刷新，文档只包含 IME 实际提交内容

#### Scenario: compositionend 时 state 暂旧不得按旧 query 刷新

- **WHEN** compositionend 到达时 DOM 已是最终候选，但 CM 尚有 pending MutationRecord 且 `EditorState` 仍是旧 query
- **THEN** handler 不同步刷新或 dispatch，pending flush 前候选保持冻结；flush 且组合标志清除后重读最终 state，只按最终 query 刷新一次

### Requirement: 候选浮层的不透明视觉与几何合同

候选浮层 SHALL 以 `view.coordsAtPos(head)` 为锚点、`position: fixed`，水平宽度与视口夹取复用 `placeOverlay` 的 `list` 档；垂直方向下方空间不足时上翻，resize / 滚动后 MUST 重夹或关闭，不得停留在视口外。路径行 SHALL 复用 Quick Open 的目录先让宽、文件名后裁与全文提示，同名候选必须可区分。

浮层壳 SHALL 使用 `--preview-bg`、1px `--border`、`--r10`、`--shadow-raise` 与 `--fs-ui-s`；light / dark / eink 三主题计算后的背景 alpha MUST 等于 1，正文 MUST NOT 透过候选壳。行几何、文字、目录、活动与 hover 状态 SHALL 复用 Quick Open 对应的现有 spacing、`--r6`、`--text`、`--text-3`、`--sel`、`--hover` 和 currentColor，MUST NOT 新增颜色、字号、圆角或阴影 token。滚动列表 SHALL 登记到既有原生 overlay 豁免档，MUST NOT 新增自绘滚动条或 `scrollbar-gutter`，右缘 12px 内不得新增常驻按钮。

#### Scenario: 三主题与长路径均不透明且不越界

- **WHEN** 分别在 light / dark / eink、默认与放大字号下打开含长路径和同名项的候选，并把光标移到视口边缘后 resize
- **THEN** 浮层背景计算值完全不透明，路径身份可辨，水平夹取来自 `placeOverlay`，垂直按可用空间重夹或上翻，浮层不越出视口

#### Scenario: 浮层滚动容器遵守既有分档

- **WHEN** 候选超过可视高度并滚动列表
- **THEN** 列表使用已登记的原生 overlay 豁免档，没有新增自绘滚动条、`scrollbar-gutter` 或右缘常驻按钮，活动项始终滚入视野
