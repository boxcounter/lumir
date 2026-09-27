# Design: bare-url-cmd-click

形态总览（推荐项）：md 模式下，语法树里「带白名单 scheme 的 `URL` 节点」——裸 URL（含角括号自动链接，D1 推荐项）与链接定义行的 URL 部分——与标准链接 `[title](target)` 一视同仁地装饰（同一个 `.cm-lp-link` 类、同一个 `↗︎` 尾标、同一个 `classifyLinkTarget` 分类），并共用同一条激活链路（`link.follow` 的键盘路径与 ⌘-Click 鼠标路径）。所有锚点按 master tip `6e9f024` 核对。

## 1. 现状锚点：语法树里的节点形态（实测）

底稿：[evidence/lezer-node-forms.mjs](evidence/lezer-node-forms.mjs)（可复跑），记录输出 [evidence/lezer-node-forms.txt](evidence/lezer-node-forms.txt)。跑法：

```
cd <仓根>                                      # 有 node_modules 的那一层
node openspec/changes/bare-url-cmd-click/evidence/lezer-node-forms.mjs
```

环境读数为 `@lezer/markdown 1.7.2`，配置与本仓默认一致（`markdownLanguage` + `GFM`，`src/editor.ts:1137`）。`GFM = [Table, TaskList, Strikethrough, Autolink]`（`node_modules/@lezer/markdown/dist/index.js:2275`）。

| 现场 | 节点形态（证据行号） | 判据含义 |
|---|---|---|
| `段落里的 https://x` | `Paragraph` 直属的顶层 `URL`（`:8`） | 形态 2：`URL` 节点的父不是 `Link` / `Image` |
| `https://x` 在行首 | 同上（`:10`，`Paragraph` 从节点起点开始） | 打开文件时选区复位到 0 的现场，`URL` 起点就是 `Paragraph` 起点 |
| `https://x.` 句末 | `URL` 不含最后那个句点（`:12`） | 标点剥离是 GFM 口径，前端 MUST NOT 再写一份 |
| `<https://x>` | `Autolink` + 两个 `LinkMark`（`<` `>`）+ `URL`（`:14-16`） | 形态 4：URL 的父是 `Autolink` |
| `[包裹](<https://x>)` | `Link` 的 `URL` 子节点**含尖括号**（`:22`） | 既有 `classifyLinkTarget` 的 `<>` 剥离正是为它写的；形态 1 行为不变 |
| `[homepage]: https://x` | `LinkReference` = `LinkLabel` + `LinkMark`(`:`) + `URL`（`:24-27`） | 形态 3：定义行的两个部分是两个子节点，可以只装饰后者 |
| `[正文][ref]` / `[ref]` | `Link` + 两个 `LinkMark` + `LinkLabel`，**没有 `URL` 子节点**（`:29-34`） | 引用点拿不到目标（与 `links.ts` 文件头注释一致）⇒ 保持原文 |
| `www.example.com`（GFM 字面） | 顶层 `URL`，**无 scheme**（`:36`） | 见 §3 的误判推演 |
| 裸邮箱 `a@b.example.com` | 顶层 `URL`，**无 scheme**（`:37`） | 同上 |
| `mailto:x@y` / `xmpp:a@b` | 顶层 `URL`（`:39-40`） | 前者白名单命中、后者被 blocked |
| URL 出现在 `Link` 的标签里 | `URL` 的父是 `Link`（`:44`） | 形态 1 已覆盖；新判据 MUST 排除它，否则同一位置被装饰两次 |
| URL 出现在 `Image` 的 alt / 目标 | `URL` 的父是 `Image`（`:52`、`:55`） | 既有 `Image` 分支 `return false` 剪枝 + 新判据显式排除 |
| 围栏代码块 | `CodeText`，**无 `URL` 节点**（`:59`） | 边界由语法树天然给出 |
| 缩进代码块 | `CodeText`，**无 `URL` 节点**（`:62`） | 同上 |
| 行内代码 | `InlineCode`，**无 `URL` 节点**（`:64`） | 同上 |
| HTML 注释 / HTML 块 | `CommentBlock` / `HTMLBlock`，**无 `URL` 节点**（`:67-68`） | 同上 |
| 表格 cell | `TableCell` 内的 `URL`（`:80`） | 表格内的放行名单要开口子（裁决点 D4） |
| 引用块 / 列表里的定义行 | `LinkReference` 嵌在 `Blockquote` / `ListItem` 内（`:86`、`:93`） | 形态 3 的嵌套形态齐备 |
| `[[wikilink]]` | `Link` + 两个 `LinkMark`，**没有 `URL` 子节点**（`:98`） | wikilink 路径零改动（判据天然不命中） |
| frontmatter 之类的 `---` 包围段 | 首尾 `---` 被解析成 `HorizontalRule` + `SetextHeading2`，URL 落在 SetextHeading2 里（`:104`） | **陷阱**：语法树不认识 frontmatter，剪枝只能靠既有的 `inFrontmatter`（§6.2） |

### 1.2 代码侧的判定与装饰锚点

- 分类唯一实现：`src/preview/links.ts:102-125` 的 `classifyLinkTarget`（五类 + 白名单 + 反斜杠转义解码 + `<>` 剥离 + 控制字符拒绝）。
- 形态 1 的定位：`src/preview/links.ts:73-90` 的 `standardLinkParts`（取 `Link` 的 `URL` 子节点 + 前两个 `LinkMark` 定出标签区间）与 `:146-153` 的 `standardLinkAt`（`ensureSyntaxTree` 同步推进、两侧 `resolveInner` 试起点的既有理由）。
- 形态 1 的装饰：`src/preview/livePreview.ts:1034-1074`（隐藏 `[` / `](` / `)`、打 `.cm-lp-link`、在 `ref.to` 插 `LinkMarkWidget`）；`blocked` 形态 `:1055` 直接 `return` 保持原文。
- 激活：`src/link-follow.ts:223-245` 的 `linkTargetAt`（wikilink → 标准链接 → 分类分流），`:318-321` 的 `followAt`（⌘⏎），`:330-339` 的 `mousedown` 监听（⌘-Click）。
- 表格内放行名单：`src/preview/livePreview.ts:872-873`；cell 边界的防御性收窄：`:1046-1051`。

## 2. 归属：为什么是 MODIFIED 一条既有 requirement

`editor-live-preview` 的「标准 Markdown 链接的形态分类与 live preview 渲染」条是链接渲染的唯一居所（分类实现、五类口径、`title` 属性、显露、代码上下文排除、wikilink 不动——全在这一条里），而 `keymap-commands` 的激活条款**以类别为口径、把分类委托给这里的矩阵**（`openspec/specs/keymap-commands/spec.md:509`）。裸 URL 按本 change 归入既有的**外链**类，激活条款的每一句在新形态上仍然成立。

由此得到两个动作：

1. **MODIFIED 那一条 requirement**（不是 ADDED 一条新 requirement）。把它拆成两条会让「五类口径 + 分类唯一实现 + 显露 + 上下文排除」同时出现在两处——同语义两处真源是 [REVIEW.md](../../../REVIEW.md) 第 8 条点名的形态。
2. **`keymap-commands` 零增量**。新形态不改变任何一句条款的真值（「外链」这个类别名涵盖了它）。反方记录在 [proposal.md](proposal.md) 的归属节，节点 1 可要求补一条纯文本 MODIFIED。

标题保持 M144 的原文不变：`openspec archive` 按标题匹配 MODIFIED 要求，改标题会让它落成「新 requirement + 悬挂的旧 requirement」。标题里的「标准 Markdown 链接」是 M144 引入时的措辞，requirement 正文第一句已把判定面写清（这是**刻意的取舍**：稳定性优先于标题措辞的精确性；本仓 archive 无 `## RENAMED Requirements` 的使用先例）。

## 3. 判据设计：一条判据覆盖四种形态

判据（实现语言无关的表述）：**语法树里的 `URL` 节点，且它的祖先里没有 `Link`（形态 1 已覆盖）也没有 `Image`，且节点原文带白名单 scheme** ⇒ 进分类表。

三条设计点：

1. **为什么以 `URL` 节点为锚**，而不是自己写 URL 正则：与 M144/M145 的纪律同源（`links.ts` 文件头：标准链接的语法判定一律取自 lezer，只有 Obsidian 方言没有语法树的地方才手写词法）。自己扫 URL 会同时丢掉「代码块/HTML 内不算」「GFM 的标点剥离」这些已经免费拿到的上下文结论——上面 §1 的表格就是证据：`CodeText` / `InlineCode` / `CommentBlock` / `HTMLBlock` 四种上下文里**根本没有 `URL` 节点**。
2. **为什么「带白名单 scheme」是硬前提**，不是可选收窄：GFM 的字面形态把 `www.example.com` 与 `a@b.example.com` 也产出为 `URL` 节点（`:36-37`）。这两个串没有 scheme，喂给 `classifyLinkTarget` 会走到「无 scheme」分支，末段 `.com` 是「其它扩展名」⇒ **判成 vault 内资产**，于是激活时会被当作 vault 内相对路径交给 Rust 的 `link_open_path` 校验。那语义是错的（把网页当本地文件），而且失败形态是「链接目标不存在」这类人话提示，用户无法从提示反推原因。因此这类字面 URL 保持原文——判据是「有没有 scheme」这条硬事实，不是「像不像 URL」的猜测。
3. **`mailto:` 走同一条**（裁决点 D2 推荐项）：它在白名单里，分类结果就是 `external`，走 `open_external_url` 交给系统邮件客户端——与 `[写邮件](mailto:…)` 今天完全同一条路径。为了把它挡在外面而写的收窄分支，是给一个已经能工作的类别加特例。

`xmpp:` 由白名单自动挡住（`blocked`），无需特例。

## 4. 装饰形态与复用清单

零新 token、零新色值、零新可见文案、零新 CSS 类：

| 复用物 | 出处 | 用在哪 |
|---|---|---|
| `.cm-lp-link` 链接类与 `.cm-lp-link-mark` 尾标样式 | `src/preview/theme.ts:608-618`（M144/M145 起） | 三种新形态的目标区间与尾标 |
| `LinkMarkWidget` + `EXTERNAL_LINK_MARK`（`↗︎`） | `src/preview/livePreview.ts:148-173`、`:1069` | 三种新形态的尾标 |
| `classifyLinkTarget` | `src/preview/links.ts:102-125` | 目标原文 → 五类 |
| `title` 属性口径 | 既有 requirement：外链给解码后的 URL | 悬停可见 / 读屏可取 |
| 选区显露判据（严格重叠） | 既有 requirement + `livePreview.ts` 的 `touchesSelection` | 编辑态撤下装饰（D6） |

三种形态的装饰差异（`隐藏什么` 是唯一有差别的一列）：

| 形态 | 隐藏 | 标记 | 尾标 | 与形态 1 的关系 |
|---|---|---|---|---|
| 2 裸 URL | **不隐藏任何字符** | 整个 `URL` 节点区间 | `URL` 节点末尾 | 形态 1 减去「标签/括号源码」这一层 |
| 3 定义行 URL | **不隐藏任何字符**（`[tag]: ` 前缀保持原文，D3） | `URL` 子节点区间 | 同上 | 同上 |
| 4 角括号自动链接 | 两个 `LinkMark`（`<` `>`） | `URL` 子节点区间 | `Autolink` 节点末尾 | 形态 1 的隐藏手法，藏的是尖括号 |

形态 2 / 3 不隐藏源码带来一个**可见的既有能力变化**：URL 文本本身仍然在屏上（它没有可隐藏的源码），所以「装饰态 vs 编辑态」的差别只有链接色与尾标——这一点写进了 spec 的 scenario，避免实现期有人为了「看起来像标准链接」而自作主张隐藏 URL 文本（那会破坏可复制性与 `EditorState.doc` 之外的一切等价物）。

## 5. 激活接线

`linkTargetAt`（`src/link-follow.ts:223-245`）在「wikilink → 标准链接」之后加第三段查询：定位光标/点击位置上的 `URL` 节点形态，命中则按 `classifyLinkTarget` 分类回归既有的五种 `LinkTarget`。

- **顺序与互斥**：`wikilinkAt` 是纯词法扫描（`[[…]]`），`standardLinkAt` 只认 `Link` 节点，新查询只认「祖先无 `Link`/`Image` 的 `URL` 节点」——三者互不重叠。与既有注释的要求一致（「顺序写死仍是有意的——wikilink 的语义只有 Rust link_graph 一份，先问它」，`:206-208`）。
- **鼠标路径零改动**：`mousedown` 监听落在 `linkTargetAt` 上，新形态自动获得 ⌘-Click（`:330-339` 的 `e.preventDefault()` + `followLink`）。
- **键盘路径同源**（裁决点 D5 推荐项）：`followAt` 调同一个判定，⌘⏎ 因此同时覆盖新形态。这不只是「顺手」——**真机验收套件的 `click` 动作不支持修饰键**（`docs/backlog.md:1048-1053`，M144 裁决「套件能力改造另开 mission」），⌘⏎ 是唯一能在真机上触发的通道。
- **分类不复制**：新查询只负责「找到节点、取出原文」，分类仍只有 `classifyLinkTarget` 一份（M145 的原则）；`blocked` 与「无 scheme 字面 URL」在查询阶段就被挡掉（§3.2），不进 `followLink`，与渲染层的「不装饰也不激活」保持一致。
- **零新字节通道**：外链仍只经 `open_external_url`（Rust 侧白名单校验是唯一权威），`src-tauri/**` 零改动。

## 6. 边界（逐条给机制来源，防误伤）

### 6.1 语法树天然排除的上下文

围栏代码块、缩进代码块、行内代码、HTML 块、HTML 注释里的 URL **没有 `URL` 节点**（§1 表，证据 `:59` / `:62` / `:64` / `:67-68`）。这是 spec 里那句「语法树上下文天然排除，前端 MUST NOT 另写一套上下文判定」的直接兑现——实现里 MUST NOT 出现 `isInsideCode` 一类二次判定。

### 6.2 frontmatter 是唯一需要人盯的上下文

语法树不认识 frontmatter（首尾 `---` 被解析成 `HorizontalRule` + `SetextHeading2`，证据 `:104`），URL 节点确实会出现在那里。剪枝靠既有的 `inFrontmatter(fm, from, to)`（`src/preview/livePreview.ts:746-747`，装饰循环的第一句 `:865`）。**实现期必须用 fixture 断言**（tasks 5.x）：`frontmatter` 里的 `https://…` 不装饰——这条是「装饰循环的剪枝顺序」与「URL 分支自己在不在剪枝之后」的耦合点，是真实的可错点。

### 6.3 表格（裁决点 D4）

现有放行名单（`src/preview/livePreview.ts:872-873`）只放 `InlineCode` / 强调系 / `Link`，`URL` 不在其中 ⇒ 表格 cell 内的裸 URL 默认不装饰。推荐纳入（与 `:1046-1051` 的 cell 边界防御性收窄同款处理）。**不纳入的代价是第二种语义**：同一份文档里同样的裸 URL，cell 外能点、cell 内点不动。

### 6.4 不动的两条路径

- **wikilink**：`[[x]]` 在语法树里是没有 `URL` 子节点的 `Link` 节点（证据 `:98`），新判据不命中；M145 的三态渲染、span 定位、`![[…]]` 分流一律不动。
- **标准链接**：形态 1 的五类分类、三段隐藏、尾标、显露、cell 内渲染、未转义管道符处保持原文——逐条不变，由既有断言守（`tests/visual/scenes/render-link.spec.ts` 与 `12-links` 真机场景）。

## 7. 性能与隐私

- **零新增扫描范围**：新分支只在装饰循环已经在遍历的视口节点序列里多认一种节点名（`src/preview/livePreview.ts` 的 `iterate({from: vrFrom, to: vrTo})`），MUST NOT 引入全文档扫描——`docs/specs/table-reading.md` §6 拒绝过的「打开时同步扫描全文」是同一族反模式。ADR 0002 §6 的打开 1MB <100ms 与 keypress-to-paint <16ms 不因此放宽。
- **激活路径不在键入路径上**：新查询只在确切的激活动作（⌘⏎ / ⌘-Click）里跑一次，与既有 `standardLinkAt` 同档（那条路径的 `ensureSyntaxTree(state, pos, 25)` 说明见 `src/preview/links.ts:131-145`）。
- **零新 IO**：不读文件、不调 IPC、不新增字节通道。
- **日志边界不变**：外链仍由 Rust 侧记 `link_open`（`category=external` / `outcome=opened` / `scheme`），URL 原文 MUST NOT 进日志（`keymap-commands` 的隐私条款，本 change 不改）。

## 8. 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 自己写裸 URL 正则（不经语法树） | 要自己重做「代码块 / HTML / 行内代码里不算」与「句末标点剥离」两件事，且必然与 lezer 的 GFM autolink 规则漂移；同语义两处真源（REVIEW.md 第 8 条） |
| 把 `www.` 与裸邮箱也升级成链接（D2 备选之外） | 无 scheme ⇒ 分类为 vault 内资产 ⇒ 把网页当本地文件交给 Rust 路径校验（§3.2）；要正确支持得先在 `classifyLinkTarget` 里加「像不像域名」的猜测，与本 change 的「不改分类口径」Non-goal 直接冲突 |
| 只覆盖裸 URL、排除 `<…>` 自动链接（D1 备选） | 判据上要多一条父节点分支；留下「同一件事的两种写法行为不同」的不一致 |
| 整行隐藏定义行（D3 备选） | 文档少一段可见文本（行数、滚动位置、复制行为全变），且引用点今天不渲染 ⇒ 隐藏后正文只剩不可点的 `[text][ref]`，语义更乱。属另一个 change |
| 解析引用式链接的引用点 | 要自己实现 CommonMark 的标签匹配（大小写不敏感、首个定义生效、shortcut / collapsed / full 三形态），体量另一个量级。本 change 只做定义行那一侧（Non-goals + 边界 1） |
| 新增一条 ADDED requirement 而不是 MODIFIED | 五类口径与分类唯一实现会同时出现在两条 requirement 里（§2） |
| 给新形态另写一套激活判定（不复用 `linkTargetAt`） | 鼠标与键盘两条路径会各自漂移（M132 的教训：同一物理动作两处各写一份判定） |
| 为「裸 URL 不装饰」加配置开关 | 装饰面与激活面的一致性正是 M144/M145 反复收敛的东西；开关会让「看起来能开」与「真的能开」重新分叉 |

## 9. 风险与未决点

| 项 | 状态 | 处置 |
|---|---|---|
| 裸 URL 的尾标是插在正文流中间的 widget（形态 1 的尾标落在被隐藏源码的尾部，两者位置性质不同） | **未验** | 实现期实测「光标落到 URL 末位后继续键入」的落点与文档变化（tasks 1.3）；若是死区，改显露判据（严格重叠 → 含端点）而不是改尾标位置 |
| frontmatter 内 URL 的剪枝是否真的生效 | **设计口径，未实测**（依据是 `inFrontmatter` 的区间包含判定 `:746-747`） | tasks 1.3 的核对 + 5.x 的 fixture 断言 |
| 表格 cell 内尾标会改变 cell 内容宽 ⇒ 表格自然宽变化 | 机制清楚（M119 宽度合同） | 取 D4 推荐项时，含裸 URL 的表格基线按基线纪律重拍；实现期 `grep -rln` 定位受影响的 fixture |
| `mailto:` 裸字面形式在真机上唤起邮件客户端的观感 | 未验（与 `[写邮件](mailto:…)` 的既有终点一致） | 归 Alex dogfood；套件只留诊断日志与截图证据 |
| 引用点仍是「半覆盖」 | 事实明确（§6.4、proposal 边界 1） | 在 proposal 与 spec 里如实写明；是否另立 change 由 Alex 裁决 |
| `CODE_OF_CONDUCT.md` 一类文档里正文引用点的占比 | **未测**（未扫真实 vault 统计引用点密度） | 若 Alex 关注，可在节点 1 前补一次快速统计（`grep -r "\[[^]]*\]\[[^]]*\]" <vault>`）；本 change 不因此扩 scope |
| 光标恰在 URL 起点（选区复位到 0 的场景）时能否命中 | 机制上有既有解法（`standardLinkAt` 的两侧 `resolveInner`，`src/preview/links.ts:140-145`） | 新形态定位 MUST 沿用同一手法；tasks 1.3 / 4.x 各有一条 |

## 10. 验收面（与 tasks.md 对应）

- **合同层**：`editor-live-preview` 的 MODIFIED requirement（scenario 总数 11 条 = 新增 5 条 + 改写 1 条 + 逐条保留 5 条，与 [proposal.md](proposal.md) 的 Impact 同口径）。
- **单测层（纯逻辑）**：新形态的节点识别与区间（等价于 `standardLinkParts` 的位置断言）、「带 scheme」前提（`www.` / 裸邮箱 / `xmpp:` 一律不入选）、分类复用（新形态的目标喂进 `classifyLinkTarget` 得 `external`）。
- **视觉层（chromium，CI 结构层 + 本地像素层）**：装饰形态（类名、`title`、尾标文字与顺序）、`LINKS` / `MARKS` 计数更新、⌘-Click 与 ⌘⏎ 各开一次（stub 记账 `__openedUrls`）、无 scheme 字面保持原文（负向断言必须配正观测，REVIEW.md 第 2 条）、引用点保持原文、代码块 / HTML / frontmatter 保持原文、光标显露、`EditorState.doc` 与磁盘逐字节不变。
- **真机层（WKWebView）**：场景 **54**（编号声明见 tasks.md §6）——`⌘⏎` 触发（套件无法表达 ⌘-Click），断言装饰态上屏（尾标在场）+ 诊断日志 `link_open`（`category=external` / `outcome=opened`，与 `12-links` 同款通道）+ `unchangedSince` 不改写源文件。
- **反向验证**：装饰分支未实现前先跑一次，必须 FAIL（REVIEW.md 第 1 条防线）。
- **基线**：`render-link` 场景基线必然变化（新增装饰与尾标）⇒ 按 [tests/visual/README.md](../../../tests/visual/README.md) 先出对比图请 Alex 过目，再 `--update-snapshots=all`（裸 `--update-snapshots` 在容差内等于什么都不做，本仓已两次实证）。
