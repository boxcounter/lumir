# Design: 行内 wikilink 候选——同步索引、稳定分层与编辑器持焦

> 本文件是节点 1 的行为与技术合同，不包含产品实现。与 A 按真实文件冲突排程、独立验收和归档；r2 修订绑定独立评审 r1 的 Rust、词法与 IME 反例。

## 1. 状态机与触发判定

新增叶子模块 `src/link-suggest.ts`，分为纯逻辑与 DOM 两层；编辑器 md 分支用 ViewPlugin 监听文档、选区、视口和组合事件。注入的索引闭包活读 `vaultFilePaths`，没有异步请求或代际。

打开条件必须同时满足：

- 当前是可编辑 md 会话，编辑器持焦，主选区为空光标；不在 frontmatter、行内代码或围栏 / 缩进代码上下文；
- 取光标所在行 `line.from … head` 的前缀，最内层未闭合 opener 是普通 `[[`，前一个字符不是 `!`；
- 光标不在任何完整既有 wikilink span 内；opener 到光标之间的查询不含 `|`、`#`、`[`、`]` 或换行；
- opener 与 head 的 lezer 上下文均不在标准 Markdown `Link` / `Image` 内，包含未闭合 label / alt 的语法节点；不得只排除已完整解析的 `[text](url)`；
- 当前不在 IME 组合期。

查询就是文档正文 opener 后的原文，不创建隐藏 input。Backspace 删掉 opener 的任一字符、选区变非空、光标离开触发区间、进入排除上下文、编辑器失焦、切标签、切 vault 或锚点滚出视口时关闭。Escape 只关闭浮层，不改变文档或光标。

接受时设 opener 后查询区为 `[queryFrom, head)`，以所选 target 替换该区间并插入 `]]`，保留用户已输入的 `[[`。新光标在整个闭合链接之后，即 A 的 `touchesSource` 所定义的 span 外边界；本行为无论 A 是否落地都成立。除此之外的打开、过滤、导航、滚动和关闭路径 `EditorState.doc` 与磁盘均逐字节不变。

## 2. 候选来源与稳定分层

### 2.1 来源与 Rust 全集对齐

- 每次非组合期输入 / 选区变化同步读取注入闭包返回的 `readonly string[]`，与 Quick Open 共用 `vaultFilePaths` 及其 watch 增量结果。
- 只保留 `foldCase(path).endsWith(".md")` 的路径，与 Rust `is_markdown` 的大小写不敏感 `.md` 后缀一致。MUST NOT 使用 `fileClassOfPath(path) === "md"`：该分类还接受 `.markdown`，而 Rust 普通 wikilink 候选全集不接受。
- 按完整 vault 相对路径去重。显示文本就是完整相对路径（含实际扩展名），与 `list-filter` 的「匹配对象是显示文本」一致；目录前缀与文件名分两段布局，但 textContent 仍是完整路径。
- 索引更新不引入请求世代：下一次允许刷新的输入重算即可；刷新前先按路径固定当前项，若仍存在则保持，否则回到第一层首项，不能把旧行号套到新数组。接受时必须再按当前索引重算证书，不能沿用展示时的过期结论。
- 惰性目录不进当前索引是既有边界，本 change 不做按需磁盘扫描，也不声称候选覆盖这些目录。

### 2.2 四层分桶，不是分数

设 `stem` 为文件名去掉最后一个大小写不敏感的 `.md`，`foldCase` 复用 `src/list-filter.ts`：

| 层 | 判定 | 顺序 |
|---|---|---|
| 精确 | `stem === query`，大小写逐字相等 | 保持源数组顺序 |
| 折叠 | 非精确且 `foldCase(stem) === foldCase(query)` | 保持源数组顺序 |
| 前缀 | 非前两层且 `foldCase(stem).startsWith(foldCase(query))` | 保持源数组顺序 |
| 子串 | 非前三层且经 `filterIndices(displayPaths, query)` 命中 | 保持 `filterIndices` 返回的源顺序 |

每层只是稳定分桶，不计算相似度分数、不做模糊子序列、不做拼音或全角 / 简繁归一。空查询按 `list-filter` 既有语义全部命中并保序，不另造「最近使用」层。四层连接后取前 100 条；零命中复用 `NO_MATCH_TEXT`，浮层保持打开但没有活动候选。

候选路径若无法无损表示为 wikilink target（例如 target 含 `|`、`#`、嵌套方括号、换行、首尾空白、`.` / `..` 路径段或为空），v1 MUST NOT 生成可接受候选；不得发明转义或接受一个会解析到别处的字符串。这条是正确性边界，不是相似度过滤。

## 3. v1 接受证书：完整路径含实际 `.md`

v1 不再采用「唯一 folded stem 插 stem、同名插完整路径去 `.md`」。该算法会被 Rust 的完整文件名优先和精确大小写优先重定向。新的插入文本 `T` 一律是所选路径 `P` 的**完整 vault 相对路径，保留实际 `.md` / `.MD` 扩展名**，并按当前索引满足以下证书：

1. **非根路径（`P` 含 `/`）**：`T = P`。Rust 根相对精确分支中 `f === T` 至少命中 `P`；exact 非空后 folded 候选全部丢弃，因此结果必为 `resolved(path = P)`，即使存在扩展名大小写交叉或同名 stem。
2. **根路径（`P` 不含 `/`）**：`T = P`，且当前索引中不得存在另一份 md 路径 `Q ≠ P` 使 `file_name(Q) === P`。此时 Rust 完整文件名精确匹配只返回 `P`。根路径没有目录可消歧；若存在精确同名，v1 MUST 将该行判为不可接受，不得插入 `[[P]]` 或退回去试 stem。
3. **接受时复核**：重新读取当前索引并验证 `P` 仍存在、`.md` 全集与可表示性未变、上述证书仍成立。无法重新证明 `resolved && path === P` 时，候选无活动接受动作，Enter 委派既有编辑器逻辑，文档与磁盘不变。

该证书只使用 Rust 已冻结的「根相对精确路径 / 完整文件名精确匹配优先于 folded」事实，不复制 `chosen`、后缀匹配或短 stem 解析。最终行为仍由真实 Rust fixture 验证，而不是只测前端镜像。

必须覆盖并拒绝旧算法的 fixture 矩阵：

| fixture | 选择与期望 |
|---|---|
| `notes/readme.markdown` | 不进入候选全集，无接受动作 |
| `foo.md` + `foo.md.md`（含目录变体） | 分别选择两者，插入各自完整路径含扩展名；Rust 均解析到所选路径，不允许 `foo.md.md` 被插成 `[[foo.md]]` |
| `a/note.md` + `a/note.MD` | 分别选择两者，插入 `[[a/note.md]]` / `[[a/note.MD]]`；exact 必须选中对应实际大小写路径 |
| 根 `foo.md` + `dir/foo.md` | 根行不可接受；`dir/foo.md` 可插入 `[[dir/foo.md]]` 并唯一解析，根行不得产生 ambiguous 链接 |
| 根 `note.md` + `dir/note.MD` | 根 `note.md` 的精确文件名唯一，可接受；folded 变体不得被误算成精确同名而过度拒绝 |
| `a/Note.md` + `b/note.md` | 两者均插完整路径含 `.md`，Rust 各自 resolved；不再生成去扩展名短链 |
| `Café.md`、西里尔、CJK、emoji ZWJ、大写 `.MD` | 完整路径逐字保留，真实 Rust 往返为所选路径 |

fixture 按 根 / 非根 × 重复扩展名 × 扩展名大小写 × 精确 / folded 同名 组合生成，不能只保留一个同名案例。每个可接受项都断言 `status === "resolved" && path === P`；不可接受项断言无插入、无文件创建。

## 4. 键盘、鼠标与 IME 分派

| 输入 | 浮层打开且有活动候选 | 浮层关闭 / 无活动候选 | 接线约束 |
|---|---|---|---|
| Enter | 接受当前项，`preventDefault` | 完全委派既有逻辑 | 只改既有 `markupKeymap` 分支，不新增 Enter 绑定 |
| ↓ / ↑ | 移动候选游标并滚入视野 | 既有垂直光标移动 | 在 `editor.cursor-down/up` 现有命令内分派 |
| ⌃N / ⌃P | 与 ↓ / ↑ 相同 | 既有 Emacs 移动 | 同上，不新增 token |
| Escape | 经 escape-router 关闭栈顶层 | 既有路由 | `registerEscapeLayer("link-suggest", close)`，开合同源注销 |
| Tab | 不接管 | 不接管 | 既有 `editor.list-indent` / 焦点语义不变 |
| 主键点击行 | 证书仍有效才接受，编辑器不失焦 | 不适用 | 行自身 `mousedown preventDefault`；点击浮层外只关闭，不拦截其默认行为 |

所有候选键处理先检查 `event.isComposing || event.keyCode === 229`：组合期直接让 IME 处理，MUST NOT 接受、移动候选或 `preventDefault`。`compositionstart` 后保留已打开浮层但冻结刷新；组合期文档变化不重算候选。

`compositionend` handler MUST NOT 同步读取 `EditorState` 重建候选或 dispatch。复用 / 提取列表现有的 composition settle 调度，使列表与候选共享同一份保护：

1. 等 CM observer 的 `pendingRecords()` 清空，且 `view.compositionStarted === false`；pending 时不得 dispatch，以免清掉尚未回读的最终候选。
2. 使用既有有界重试，不另造固定长延时；视图销毁 / 新组合开始则作废旧调度。
3. 条件满足后重读当时的 `view.state.doc` 与 `selection.main.head`，只补一次候选刷新；不得在 compositionend 时缓存旧 query。

测试必须构造「compositionend 时 DOM 已是最终候选、state 暂时仍是旧 query」的区分度场景：handler 同步阶段列表不变且未 dispatch；pending flush 前不得按旧 query 刷新；flush 后只按最终 query 刷新一次。键侧 `isComposing` / 229 让路和 Safari 错序保护沿用既有路径。

## 5. 浮层几何与视觉合同

- 锚点取 `view.coordsAtPos(head)`，浮层 `position: fixed`。水平宽度与夹取必须调用 `placeOverlay`，档位列 `list`、宿主为视口；不得另写一份左右夹取。垂直方向优先落在光标行下方，空间不足则上翻，最大高度受剩余视口约束；resize / 滚动后重夹或关闭，不留在视口外。
- 壳复用 Quick Open 的几何与 token：`--preview-bg` 背景、1px `--border`、`--r10`、`--shadow-raise`、`--fs-ui-s`。三主题计算后的背景 alpha MUST 等于 1，MUST NOT 使用透明 / 半透明壳让正文透过候选文字。
- 行高 26px、`--r6`、既有水平 spacing；目录 / 文件名分别取 `--text-3` / `--text`，活动行取 `--sel` + inset currentColor，hover 取 `--hover`，零命中取 `--text-3`。无新色值、字号、圆角或阴影 token。
- 路径行复用 Quick Open 的目录先让宽、文件名后裁与 `title` 全文通道；同名候选必须可区分。滚动列表登记到 `tests/unit/scrollbar-registry.test.ts` 的原生 overlay 豁免档，与 `.lumir-qo-list` / `.lumir-toc-list` 同类，不写 `::-webkit-scrollbar` 或 `scrollbar-gutter`，右缘 12px 内不新增常驻按钮。
- 视觉验证覆盖 light / dark / eink、默认与 32px 字号、长路径、同名、空态、视口四边与窄窗。除结构 / 计算样式断言外，本地 pixel 门禁必须运行；任何基线更新先给 Alex 过目。

## 6. 验证矩阵

| 层 | 维度与判据 |
|---|---|
| unit：触发纯函数 + lezer visual | opener 内外、完整链接内部、embed、代码 / frontmatter、只读、非空选区、跨行、标准 `Link` / `Image`、未闭合 label / alt；负例同时验证无触发和无接受 |
| unit：候选纯函数 | Rust `.md` 后缀过滤、`.markdown` 排除、路径去重、四层顺序、空查询、100 上限、Unicode、不可表示路径、根文件精确同名拒绝；`list-filter` 保序 |
| Rust 对账 | 本文 §3 全组合 fixture；每个可接受串 `resolved && path === P`，不可接受项零插入；必须拒绝旧 stem / 去扩展名算法 |
| visual：键鼠 | Enter / 指针接受、方向键与 ⌃N/P、Escape、Tab 原义、点击外部、失焦 / 切标签 / 滚出关闭；接受前索引变化使证书失效时零写入 |
| visual：IME | 组合期列表与 DOM 不刷新，组合 Enter 不接受；compositionend 时 state 暂旧必须等 pending flush，最终 query 只刷新一次 |
| visual：几何 / token | 三主题壳 alpha=1、长路径不越界、同名可辨、resize 重夹、滚动注册表双向对账；接受后光标在新增 `]]` 之外，不依赖 A |
| perf | 1MB 文档只扫当前行与必要语法上下文，不做全文档扫描；万文件索引下键入采样仍满足既有 <16ms 预算 |
| acceptance | 真实 WKWebView 下打开 / 过滤 / 方向键 / Enter / Escape / 鼠标、浮层不裁切、文档与磁盘字节；精确 caret 与组合内部状态留在 visual / unit |

每个 visual 行为用例除「接受」外都以 `readDocument` / `fileText` 断言文档逐字节不变。新增真机场景随实现同 PR；真机读不到的状态 MUST 判 FAIL 或改到可测层，不能用 `null ?? ""` 做空值比较。
