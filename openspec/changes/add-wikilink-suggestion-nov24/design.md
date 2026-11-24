# Design: 行内 wikilink 候选——同步索引、稳定分层与编辑器持焦

> 本文件是节点 1 的行为与技术合同，不包含产品实现。前置 `fix-wikilink-caret-reveal-nov24` 必须先归档；本设计不复刻其 spec delta。

## 1. 状态机与触发判定

新增叶子模块 `src/link-suggest.ts`，分为纯逻辑与 DOM 两层；编辑器 md 分支用 ViewPlugin 监听文档、选区、视口和组合事件。注入的索引闭包活读 `vaultFilePaths`，没有异步请求或代际。

打开条件必须同时满足：

- 当前是可编辑 md 会话，编辑器持焦，主选区为空光标；不在 frontmatter、行内代码或围栏 / 缩进代码上下文；
- 取光标所在行 `line.from … head` 的前缀，最内层未闭合 opener 是普通 `[[`，前一个字符不是 `!`；
- 光标不在任何完整既有 wikilink span 内；opener 到光标之间的查询不含 `|`、`#`、`[`、`]` 或换行；
- 当前不在 IME 组合期。

查询就是文档正文 opener 后的原文，不创建隐藏 input。Backspace 删掉 opener 的任一字符、选区变非空、光标离开触发区间、进入排除上下文、编辑器失焦、切标签、切 vault 或锚点滚出视口时关闭。 Escape 只关闭浮层，不改变文档或光标。

接受时设 opener 后查询区为 `[queryFrom, head)`，以所选 target 替换该区间并插入 `]]`，保留用户已输入的 `[[`。新光标在整个闭合链接之后，浮层关闭；除此之外的打开、过滤、导航、滚动和关闭路径 `EditorState.doc` 与磁盘均逐字节不变。

## 2. 候选来源与稳定分层

### 2.1 来源

- 每次非组合期输入 / 选区变化同步读取注入闭包返回的 `readonly string[]`，与 Quick Open 共用 `vaultFilePaths` 及其 watch 增量结果。
- 只保留 `fileClassOfPath(path) === "md"`；MUST NOT 复用服务 harness 的 `linkableVaultPaths`，后者包含 code / text。
- 按完整 vault 相对路径去重。显示文本就是完整相对路径（含扩展名），与 `list-filter` 的「匹配对象是显示文本」一致；目录前缀与文件名分两段布局，但 textContent 仍是完整路径。
- 索引更新不引入请求世代：下一次允许刷新的输入重算即可；刷新前先按路径固定当前项，若仍存在则保持，否则回到第一层首项，不能把旧行号套到新数组。
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

候选路径若无法无损表示为 wikilink target（例如 target 含 `|`、`#`、嵌套方括号、换行或去扩展名后为空），v1 MUST NOT 生成可接受候选；不得发明转义或接受一个会解析到别处的字符串。这条是正确性边界，不是相似度过滤。

## 3. 插入文本与 Rust 往返

对当前索引内全部可表示 md 路径按 `foldCase(stem)` 分组：

- 组大小为 1：插入该文件实际大小写的 `stem`；
- 组大小大于 1：插入该文件完整 vault 相对路径，去掉末尾 `.md`，保留目录与实际大小写。

唯一 stem 经 Rust 的短路径解析只命中所选文件；折叠同名时若仍插 stem 会成为 ambiguous，因此必须插完整路径。大小写仅不同的完整路径也保留实际大小写，让 Rust 的 exact 优先规则选中该项。前端不复制 Rust 的候选解析或 `chosen` 规则，只用上述规则生成可解析 target；最终解析仍由 Rust 负责。

测试必须将候选生成结果喂给真实 Rust fixture / 解析入口，至少覆盖：唯一 stem、两目录同名、大小写折叠同名、路径含目录、`Café`、西里尔、CJK、emoji ZWJ、大写 `.MD`。不能接受用户输入的模糊前缀代替所选 target。对不可表示路径另断言「无可接受候选」，而不是放宽往返判据。

## 4. 键盘、鼠标与 IME 分派

| 输入 | 浮层打开且有活动候选 | 浮层关闭 / 无活动候选 | 接线约束 |
|---|---|---|---|
| Enter | 接受当前项，`preventDefault` | 完全委派既有逻辑 | 只改既有 `markupKeymap` 分支，不新增 Enter 绑定 |
| ↓ / ↑ | 移动候选游标并滚入视野 | 既有垂直光标移动 | 在 `editor.cursor-down/up` 现有命令内分派 |
| ⌃N / ⌃P | 与 ↓ / ↑ 相同 | 既有 Emacs 移动 | 同上，不新增 token |
| Escape | 经 escape-router 关闭栈顶层 | 既有路由 | `registerEscapeLayer("link-suggest", close)`，开合同源注销 |
| Tab | 不接管 | 不接管 | 既有 `editor.list-indent` / 焦点语义不变 |
| 主键点击行 | 接受该行，编辑器不失焦 | 不适用 | 行自身 `mousedown preventDefault`；点击浮层外只关闭，不拦截其默认行为 |

所有候选键处理先检查 `event.isComposing || event.keyCode === 229`：组合期直接让 IME 处理，MUST NOT 接受、移动候选或 `preventDefault`。`compositionstart` 后保留已打开浮层但冻结刷新；组合期文档变化不重算候选；`compositionend` 后按最终文档补一次刷新。组合取消导致触发条件失效时，在结束后的这次刷新关闭，而不是吞掉 IME 的取消键。

浮层是编辑器的非模态辅助面，不持焦、不设 `aria-modal`。列表 / 行复用 Quick Open 的 listbox、option 与 active-descendant 形态；活动项语义挂在仍持焦的编辑器上，关闭时清理。焦点不得为了渲染候选被抢回。

## 5. 浮层几何与视觉合同

- 锚点取 `view.coordsAtPos(head)`，浮层 `position: fixed`。水平宽度与夹取必须调用 `placeOverlay`，档位列 `list`、宿主为视口；不得另写一份左右夹取。垂直方向优先落在光标行下方，空间不足则上翻，最大高度受剩余视口约束；resize / 滚动后重夹或关闭，不留在视口外。
- 壳复用 Quick Open 的几何与 token：`--preview-bg` 背景、1px `--border`、`--r10`、`--shadow-raise`、`--fs-ui-s`。三主题计算后的背景 alpha MUST 等于 1，MUST NOT 使用透明 / 半透明壳让正文透过候选文字。
- 行高 26px、`--r6`、既有水平 spacing；目录 / 文件名分别取 `--text-3` / `--text`，活动行取 `--sel` + inset currentColor，hover 取 `--hover`，零命中取 `--text-3`。无新色值、字号、圆角或阴影 token。
- 路径行复用 Quick Open 的目录先让宽、文件名后裁与 `title` 全文通道；同名候选必须可区分。滚动列表登记到 `tests/unit/scrollbar-registry.test.ts` 的原生 overlay 豁免档，与 `.lumir-qo-list` / `.lumir-toc-list` 同类，不写 `::-webkit-scrollbar` 或 `scrollbar-gutter`，右缘 12px 内不新增常驻按钮。
- 视觉验证覆盖 light / dark / eink、默认与 32px 字号、长路径、同名、空态、视口四边与窄窗。除结构 / 计算样式断言外，本地 pixel 门禁必须运行；任何基线更新先给 Alex 过目。

## 6. 验证矩阵

| 层 | 维度与判据 |
|---|---|
| unit：触发纯函数 | opener 内外、完整链接内部、embed、代码 / frontmatter、只读、非空选区、跨行、退格关闭；排除态不得靠空字符串假绿 |
| unit：候选纯函数 | md 过滤、路径去重、四层顺序、空查询、100 上限、CJK / Unicode、不可表示路径、同名插入；`list-filter` 的调用结果保序 |
| Rust 对账 | 每个可接受插入串解析到所选路径；同名与大小写折叠同名不得成为 ambiguous |
| visual：键鼠 | Enter / 指针接受、方向键与 ⌃N/P、Escape、Tab 原义、点击外部、失焦 / 切标签 / 滚出关闭；编辑器始终持焦，非接受路径文档不变 |
| visual：IME | 组合期列表数据与 DOM 不刷新，组合 Enter 不接受，结束后只补一次；取消组合不触发接受 |
| visual：几何 / token | 三主题壳 alpha=1、长路径不越界、同名可辨、resize 重夹、滚动注册表双向对账；接受后按前置 A 的显露合同落点 |
| perf | 1MB 文档只扫当前行与必要语法上下文，不做全文档扫描；万文件索引下键入采样仍满足既有 <16ms 预算 |
| acceptance | 真实 WKWebView 下打开 / 过滤 / 方向键 / Enter / Escape / 鼠标、浮层不裁切、文档与磁盘字节；精确 caret 与组合内部状态留在 visual / unit |

每个 visual 行为用例除「接受」外都以 `readDocument` / `fileText` 断言文档逐字节不变。新增真机场景随实现同 PR；真机读不到的状态 MUST 判 FAIL 或改到可测层，不能用 `null ?? ""` 做空值比较。
