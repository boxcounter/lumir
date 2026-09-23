# Proposal: 代码文件里双击标识符高亮同一变量

- Change ID: code-variable-highlight
- 日期: 2026-09-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **提案四件（proposal / design / specs 增量 / tasks），本 change 不写任何产品代码**——实现待节点 1 裁决后另立 mission。tasks.md 因此全部未勾选。

## Why

用户需求原话（2026-09-24，verbatim）：「代码文件也支持 Outline，并且支持双击选中变量后高亮变量（**不是字符匹配，要语法上的变量**）」。本 change 只做后半句（大纲见同批提案 [code-outline](../code-outline/proposal.md)）。括号里那半句就是本 change 的全部难点：**判据只能是语法，不能是文本。**

### 一、诉求面：今天双击之后的反馈只有原生选区，且「选中的是不是变量」根本没人回答

| # | 现状事实（可复核） | 锚点 |
|---|---|---|
| 1 | 非 md 文件一律只读 code 模式（M130 方向 A） | `src/editor.ts:999-1002`、`openspec/specs/editor-live-preview/spec.md`「单内核双模式落地」 |
| 2 | 双击选词是 **CM6 的字符类别口径**，与语法无关：`rangeForClick` 的 `type == 2` 分支取 `groupAt`，而 `groupAt` 只按字符类别（Word / Space / Other）向两侧扩到边界 | `@codemirror/view/dist/index.js:5000-5013`（`rangeForClick`）、`:3605-3633`（`groupAt`） |
| 3 | 字符类别里的「Word」= `\w` 类字符 + 语言声明的 `wordChars` + 非 ASCII 字母；`wordChars` 是**语言数据**，legacy mode 自己带（实测 js/ts 声明 `wordChars: "$"`） | `@codemirror/state/dist/index.js:2836-2857`（`charCategorizer` / `wordAt`）、`:2518-2530`（`makeCategorizer`）；`@codemirror/language/dist/index.js:2210`（`languageData: spec.languageData`）；`@codemirror/legacy-modes/mode/javascript.js:914`（`wordChars: "$"`）。实测读数见 [evidence/03](evidence/03-identifier-positions.md) §1（`$price` 与 `变量名` 都完整选中） |
| 4 | code 模式**没有任何标识符装饰**：唯一的装饰来源是 token 着色（`syntaxHighlighting` + `codeHighlight`），标记（mark）类装饰一件都没有 | `src/editor.ts:987-990`（`codeHighlight`）、`:1176-1179`（code 分支的扩展束） |
| 5 | 于是双击一个标识符之后，界面上唯一的反馈是原生选区背景 | `src/preview/theme.ts:58`（`.cm-selectionBackground` = `--sel`，token 在 `src/style.css:9`） |
| 6 | 判定「语法上的变量」需要结构：code 模式的语法树是扁平的 token 序列（**没有**名字与范围意义上的声明/引用节点） | 实测读数见 [evidence/02](evidence/02-current-code-mode-readings.md)（`max depth: 1`，节点名只有 token 类别） |

### 二、为什么「字符匹配」不是可接受的替代

用户把这件事说死了一半：MUST NOT 是字符匹配。字符匹配在这个界面上有三类**可达的错**（都能随手构造）：

1. **字符串与注释里的同名文本**被算成「同一变量」：`print("LIMIT")` 与 `LIMIT = 42` 一起被点亮。
2. **同名的另一个东西**被算成同一变量：对象的同名属性（`obj.limit`）、类型名、关键字、导入路径里的名字。
3. **作用域上被遮蔽同名变量**（`def f(): LIMIT = 1` 里的 `LIMIT` 与外层 `LIMIT`）被算成同一个。

这三类错在语法层是**可判**的（分别对应：节点落在 string/comment 节点内；节点类别不是变量类；被更内层的同名声明遮蔽）——所以本 change 的判据全部落在解析树上，且**宁可漏、不可错**：分辨不了的不点亮（理由与逐条口径见 design.md §3）。

### 三、依赖同一张语言表

高亮需要结构解析，能给出结构的语言集合与 [code-outline](../code-outline/proposal.md) 完全同一张表（design.md §1 的两份 design 共用同一节、逐字一致）。本 change **不另建语言表**：没有结构解析的语言 = 双击后不高亮（安静地什么也不发生，不给提示——这不是错误态，用户没做错事）。

## What Changes

两份 delta，落 `editor-live-preview`（归属理由见下节）：

1. **双击标识符高亮同一变量**（ADDED「双击标识符高亮同一变量」）。在只读 code 模式里，双击（或以其它方式产生）一个**落在标识符类节点内**的选区时，系统 SHALL 用结构解析树判定该标识符在文件里的**同一变量**的全部出现位置，并高亮它们：
   - 触发判据只有一条：选区是单区间、非空、且**完整包含于**一个「变量类位置」的标识符节点内（否则不高亮——跨标记的选区没有「它指的是哪个符号」这回事；而**选不全**（`$price` 只选中 `price`）仍命中，因为判据是包含而不是相等）。
   - **匹配用的名字取节点原文、不取选区文本**：否则 `$price` 会退化成子串匹配（把 `price`、`price_list` 一起点亮）。
   - 候选判据三层：① **类别**——源与候选都 MUST 落在「变量类位置」（逐语言按「节点名 + 父链」判定，实测依据见 [evidence/03](evidence/03-identifier-positions.md) §2）：局部变量、参数、顶层/模块变量与常量、`for` 一类绑定位收录；**字符串、注释、属性/成员/字段名、类与方法/函数名、类型名、对象键一律排除**（源本身落在排除位时就不高亮，MUST NOT 有「源是属性名就点亮其它属性名」这种口子）；② **名字**——逐字节相同（不做大小写折叠、不做词法归一，大小写敏感由语言的语法节点本身决定）；③ **可见域**——候选 MUST NOT 被更内层的同名声明隔开，且方向 MUST 合理（分属两个互不包含的容器的同名局部变量 MUST NOT 互相点亮，见 design.md §3.3）。
   - **保守方向（写进 requirement）**：任何一层判据拿不到证据时，MUST NOT 点亮该候选；MUST NOT 用文本相似度、MUST NOT 用「猜」。
   - **无结构解析的语言 SHALL 不高亮**，MUST NOT 退回字符匹配（与 code-outline 同一分层）。
2. **高亮的呈现与生命周期**（ADDED「高亮呈现与生命周期」）。高亮是**装饰**：MUST NOT 进入 `EditorState.doc`、MUST NOT 改变任何字节（ADR 0003 §3）；颜色 MUST 只取既有 editorial token（MUST NOT 为新功能新增颜色），且 SHALL 与原生选区、搜索面板的匹配高亮**可区分**（三层同时可见时不得混成一片）；选区变为空/变为非标识符/切换到别的标签或文件/文档重新装载时 SHALL 立即清除；高亮的重算 SHALL 只在选区变化与文档装载这两个事件上发生（只读态没有键入，MUST NOT 引入常驻遍历）。

## Non-goals

- **不做跨文件 / 全局索引**：只判当前文件（vault 级符号解析需要另一套基础设施，属 ADR 0001 §3 的 IDE 面）。
- **不做跳转定义、查找引用面板、符号重命名、调用层级**：本 change 只做「点亮同 binding 的出现位置」这一件可见的事。
- **不做「搜索式高亮全部匹配」**：文件内搜索（`⌘F`，in-file-search capability）已经承担文本匹配的高亮；本 change 的判据是语法，两者并存且必须可区分（不得让用户把语法判定的结果误读成搜索结果）。
- **不做正则 / 字符串匹配 / 大小写折叠 / 词法归一**：见 Why 第二节，这是本需求明令排除的形态。
- **不做 md 模式**（推荐项；若节点 1 要求做，本 change 的非目标与 delta 一并改写）：理由三条——① md 里没有「变量」这种语法对象，代码只出现在围栏块里；② 围栏块在今天**没有嵌套解析树**（着色是手工驱动 StreamLanguage 得到的，`src/preview/code.ts:344` 的 `highlightCode` 这一类手工驱动路径），要做就得先引入嵌套解析，那是另一条管线；③ md 可编辑，选区变化比只读模式频繁得多，且 md 的选区语义已经背着一整套「光标/选区触及即显露源码」的口径，往里加一层自动高亮会与它互相干扰。
- **不做配置项**（开关 / 颜色 / 是否包含属性名）：默认口径即唯一口径（REVIEW.md 第 9 条）。
- **不新增键位与命令**：触发就是既有的原生双击（或任意产生该选区的方式），不需要新入口。
- **不做语言服务级语义**：不做类型推断、不做重命名影响面、不做 `import` 别名的跨文件展开、不做宏/反射/动态名字（这些拿不到，见 design.md §7 的已知边界）。

## 裁决点（节点 1）

| # | 裁决点 | 推荐（已写进 delta，实现按此写） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| 1 | **语言覆盖分层** | 与 [code-outline](../code-outline/proposal.md) **同一张表**（两条判据：官方 `@lezer` 语法 + 无阻断缺陷）。本能力只在 **T1 的 8 门**（javascript / typescript / python / rust / go / c / cpp / java）生效；T2（css/scss）与 T3 的语言双击后不高亮、**不提示**。逐门落位与理由见 design.md §1.3（两份 design 的同一节逐字一致） | ① 只对少数常用语言支持；② 不支持的语言用字符匹配兜底（**本需求明文排除**，列出仅为记录被拒的理由） | ①的边界没有判据、且用户看不出「为什么这个文件没有」；②直接违反原话的「不是字符匹配」 |
| 2 | **语义精度**：严格作用域分析 vs 近似 | **近似 + 保守**：同名 + 同变量类 + 不被更内层同名声明遮蔽（三层的可判性逐语言列在 design.md §1.2 / §3.3）。**不宣称「同 binding」是语言语义级判定** | ① 严格 binding（真正的词法作用域解析：提升、闭包捕获、遮蔽链、`var`/`let` 差异、全局解析）——只有语言服务能做全，语法树层面做不到；② 最宽：同名 + 同类，不做遮蔽判定（实现最简，代价是「函数内同名局部变量」被误判成同一个） | 推荐项把「能判的判准、判不了的不亮」写死成 requirement（保守方向），错的方向是漏而不是错；①在本仓的技术栈（纯前端语法树、无语言服务）下无法交付，写进 spec 就是承诺做不到的事；②的误判恰好落在用户最容易注意到的场景（局部变量） |
| 3 | **新增 `@lezer/*` 依赖许可** | 与 code-outline **同一份依赖清单与体积**（design.md §1.4）。**本 change 不单独新增任何依赖**——它消费同一张表 | ① 不新增依赖 → 本需求退回「不做」；② 只为本能力引入更少的语言（等价于裁决点 1 的备选①） | 两个能力共用一次依赖成本；拆开算会让「依赖许可」这个决定被重复裁决两次且口径可能不一致 |
| 4 | **md 模式是否同样支持** | **不做**（理由见 Non-goals 三条） | ① md 的围栏代码块里也做（需先引入围栏嵌套解析，另一条管线 + 更大改动面）；② md 全文都做（在 markdown 语法树的正文里找「变量」没有意义） | ①的收益面（阅读 markdown 时在围栏里双击变量）远小于它的成本（嵌套解析管线 + 围栏内选区语义 + 可编辑态的选区频率）；②没有可辩护的语义 |
| 5 | **呈现** | **只加底纹/下划线，不换字色**（色值取既有 editorial token：选区用 `--sel`、匹配用一条既有弱化 token；MUST NOT 新增颜色），且必须与原生选区、搜索匹配**三层可区分** | ① 只改字色（与 token 着色打架：同一个字既是关键字又被点亮，语义会糊）；② 用与搜索匹配同一个形态（用户分不清「这是语法判定」还是「这是搜索命中」） | code 模式已经有 token 字色，再改字色的信息层会与语法着色冲突；底纹是唯一不与既有信息层抢同一通道的形态。具体色值与形态归 Alex 的手感项，delta 只锁「可区分 + 不新增颜色」两条硬约束 |
| 6 | **触发面边界**（如实告知） | 触发判据取「选区**完整包含于**一个变量类位置的标识符节点内」（`node.from ≤ sel.from && sel.to ≤ node.to`）。**推论一（优点）**：选不全也命中——`$price` 只选中 `price` 时仍按节点原文 `$price` 判定，因此含 `$` / 非 ASCII 的标识符不会因为字符类别口径而失效。**推论二（边界）**：跨节点的选区（拖选、含运算符）不命中；`a.b` 这类成员访问里双击 `b` 时源节点是属性位，按排除面不点亮 | ① 自己实现「语法感知的选词」（双击时按语法节点扩选区到完整标识符）——会改变原生双击行为，且引入第二套选词实现（与 CM 的选词路径漂移）；② 放宽到「选区与某个标识符节点有交集就点亮」——代价是把「点到 `obj.` 上的半个字符」也算成命中，判据从此没有干净边界；③ 判据改成「选区 === 节点」——丢掉推论一的优点，`$price` 类场景误判为不命中 | 推荐项不碰既有交互（CM 的选词路径是原生行为，见 Why 第 2 条），且把「选区文本」从判据里彻底移出（判据只看节点），这是「不是字符匹配」最硬的落点；①会让双击本身的落点与今天不同（一次静默的交互改写）；②的放宽使判据从「包含」变成「相交」；③等于把部分选中判为不命中，是纯损失 |

## capability 归属：`editor-live-preview` 的两条 ADDED

**结论**：落 `editor-live-preview`（既有 living spec），**不新建 capability**。

| 本 change 的条款 | 归属理由 |
|---|---|
| 「code 模式里的标识符高亮」 | 该 capability 的 Purpose 已经是「md 模式 = 高亮 + 装饰且可编辑；**code 模式 = 仅高亮且只读**」，它的 requirement 已经管着 code 模式的展示口径（只读合同、code 与围栏的配色一致、json/yaml 键色）。双击高亮是 code 模式的又一个展示口径 |
| 装饰 MUST NOT 改文档 / 视口纪律 | 同一 capability 里的「live preview 装饰层」requirement 已有同一族约束（只改显示、不改文档）；本 change 的装饰落在 code 模式，引用那一族约束比另起一份更不容易漂 |
| 「不改 md 模式」这条边界 | 「单内核双模式落地」requirement 管的就是模式边界，边界写在那里最读得全 |
| **反方（如实记录）** | 该 capability 的名字（`editor-live-preview`）与它今天的实际射程（含 code 模式）不完全对齐——这是既有事实（M138 起 code 模式口径就落在这里，json/yaml 键色都在其中）。改名是一次跨 capability 的迁移，不在本 change；若将来 code 模式长出第三个展示口径，再讨论把 code 模式口径整块拆成 `code-mode-reading` 一类新 capability |

## Impact

- 影响的 specs：`editor-live-preview`（ADDED ×2：「双击标识符高亮同一变量」「高亮呈现与生命周期」）。**不改** `editor-live-preview` 的既有 requirement（本 change 不与既有条款冲突：code 模式的只读合同、配色口径一条不改）、**不改** `keymap-commands`（零新命令零新键位）、**不改** `toc-outline`、**不改** `in-file-search`。
- 影响的代码/系统：新增标识符高亮模块（落点与命名见 design.md §4；形态是 ViewPlugin/StateField + `Decoration.mark`）、`src/editor.ts`（**只装进 code 模式分支**，md 分支零改动）、`src/preview/theme.ts`（高亮样式，沿用既有 token；该文件头明确 preview 装饰的样式在这里、不碰 `src/style.css`）、`src/preview/code.ts`（若结构解析器按语言挂在既有 `LANGUAGES` 表上，则在此新增一维）、`src/preview/attachments.ts`（**只在需要按扩展名裁决是否支持时**才碰；预期零改动）。`src-tauri/**` 零改动。
- 影响的文档：**零文案**（不高亮不是错误态，静默处理；见 design.md §3.5 的取舍说明）。`文案-Copy.md` 不改。
- 影响的测试/验收：`tests/unit/*.test.ts`（判据的纯函数层：声明/候选分类、遮蔽判定、候选集合的构造——给定假树或真树都能断言）、`tests/visual/scenes/m120-code-highlight.spec.ts` 与新场景（双击 → 断点亮的 span 集合、排除面：字符串/注释/属性名/同名局部；配色与搜索高亮/选区的可区分性）、`scripts/acceptance/scenarios/29-code-variable-highlight.md`（真机场景编号 29——28 分给 code-outline；编号若被占用则顺延）。**真机侧的判据限制**：AX 不暴露装饰与颜色（`document-end-marker` 的实现期实测：AX 只给 `AXButton/AXImage/AXScrollArea` 一类节点 bbox），因此真机场景判「选区与文档文本不变 + 高亮节点的在场/缺席（可读 DOM 探针）」，颜色与形态归 chromium 层。
- 基线影响：**md 侧零变更**（本 change 不碰 md 路径）；code 模式此前不在**有装饰**的基线里——新增元素级断言与（按需的）元素级基线，`--update` 前须请 Alex 过目（AGENTS.md 硬规则）。既有 `m120-code-highlight.spec.ts` 的 token 色断言预期零变更（本 change 不动着色），实现期须逐条复核而不是只看时间戳（REVIEW.md 第 3 条）。
- 性能：高亮的重算只发生在选区变化与文档装载；只读态无键入，因此不进入 keypress-to-paint 路径。结构解析的一次性成本与缓存见 design.md §1.6 / §4.2；**读数只来自 headless 探针（下界），不许据此宣称达标**。
- 关联约束：ADR 0002 §6（性能合同）、ADR 0003 §3（装饰不改写文档）、ADR 0001 §3（IDE 能力非目标——本 change 只点亮、不做跳转定义/引用面板）、ADR 0004 第 5 条、ADR 0006（零新增键位）。
- 未做验证的项（如实记录）：真机上「双击 → 高亮」的落点手感、以及 WKWebView 下装饰重绘的可感延迟——归实现期的真机场景与 Alex 手感项，本提案不宣称已验。
