# Delta: toc-outline

## MODIFIED Requirements

### Requirement: 大纲浮层

浮层 SHALL 由点击指示段或命令 `toc.toggle` 展开，**查询为空时** SHALL 列出全部标题并按层级缩进（H1–H6
同列表呈现），**查询非空时** SHALL 只列出命中项（见「浮层输入筛选的匹配语义」）。缩进 SHALL 以「文档里
出现的最浅层标题」为基准归一：只出现 H2/H3 的文档 MUST NOT 浪费一层空缩进。条目顺序 SHALL 与文档顺序
一致（筛选后的结果集同此）。

浮层 SHALL 高亮**当前段**（与指示段同一口径：光标在可见范围内取光标，否则取视口顶部）——当前段**在结果
集里**时才高亮，不在时无高亮（MUST NOT 把高亮落到别的条目上）；键盘游标 SHALL 初值落在当前段上；没有
当前段（光标在首个标题之前）时，键盘游标落在第一条。`↑↓` SHALL 移动键盘游标并在边界处钳制（不循环），
`Enter` 与鼠标点击条目 SHALL 跳转，`Esc`、再次触发命令、点击浮层以外区域、焦点离开浮层 SHALL 关闭浮层。
关闭后的焦点归属 SHALL 区分主动与被动：主动关闭（`Esc`、再次触发命令）SHALL 把焦点交还编辑器并保持
阅读位置；被动关闭（点击浮层以外区域、焦点离开浮层）MUST NOT 抢焦点——焦点归用户刚点的目标（点击
编辑器时由编辑器自然接手），MUST NOT 把焦点拽回编辑器。
鼠标路径与键盘路径 SHALL 共用同一跳转实现，MUST NOT 存在两套跳转。

浮层打开态 SHALL 支持 Emacs 的上下移动键：`⌃N` / `⌃P` SHALL 与 `↓` / `↑` **完全等价**（同一移动
实现、同一边界钳制口径——Emacs 的 `C-n` 在 buffer 末行同样是停止而非回卷）。这两键 SHALL 只在浮层
打开且持有焦点时生效，MUST NOT 改动文档、MUST NOT 移动编辑器光标；键位匹配 SHALL 复用键位层的
token 归一化（`keyToken`），MUST NOT 另写一套匹配口径。

跳转 SHALL 只改变选区与视口：光标落在目标标题行**行尾**，该行 SHALL 滚到视口居中，MUST NOT 修改
文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）。

浮层的视觉 SHALL 复用既有排版基线（M55 的 `--bg` / `--bd-*` / `--dim` / `--font-*` / `--radius`），
MUST NOT 引入新的视觉语言。浮层 SHALL 绝对定位、不参与布局：展开与收起 MUST NOT 引起文档区或
masthead 的几何变化（零常驻占地是 Alex 需求原话的落点）。标题文本过长时 SHALL 省略号收尾。

浮层的最大高度 SHALL 为**窗口内容区高度**（webview 视口高，`vh` 的基准）的 80%，且该上限约束的是
**浮层总高**——底部键位提示与内边距一并算在内（这是与实现期自选的 `55vh` 只约束列表的差别，Alex
2026-09-17 的需求口径）。条目超出时 SHALL 只在浮层内的列表里滚动，底部键位提示 SHALL 常驻可见
（MUST NOT 被列表滚出、MUST NOT 被压缩）。该上限 SHALL 随窗口尺寸变化在重排时立即生效，MUST NOT
要求关闭再打开浮层。**已知边界（如实记录）**：浮层锚在 masthead 下沿（`.masthead` 的
`min-height: 57px`），窗口内容区高 ≥ 285px 时 `57px + 80% ≤ 100%` 成立、浮层不越出窗口底边；
更矮的窗口下底边可能越出——本条不加钳制逻辑，理由见 proposal 的非目标。**新增筛选输入行后的实测读数
（change `list-filter`，M199）**：285px 时底边恰好贴住内容区下沿（越出 0px，与上面的推导逐位吻合）、
260px 时越出 5px、300 / 320 / 400 / 800px 均不越出；输入行是固定行，让浮层的**自然高度** +31px，
因此条目少（自然高度小于 80% 上限）时真正的下限由自然高度决定（5 条条目下约 259px）。

浮层底部的键位提示 SHALL 覆盖浮层内就地消费的**全部**导航键（`↑↓` / `⌃N` / `⌃P` / `Enter` /
`Esc`）：这些键不进统一键位表、也不出现在 `app.describe-bindings` 面板里（见「命令入口与浮层内
键位的归属」），界面上的提示是它们唯一的可见出口（文案见 `文案-Copy.md` D84–D87）。新增就地键时
SHALL 同步更新该提示，MUST NOT 让任何就地键只能靠「试出来」被发现。（输入筛选的可发现性由输入框的
占位文案承担；打字不是键位表意义上的就地键。）

文档没有标题时，`toc.toggle` SHALL 只给提示（文案见 `文案-Copy.md` D84），MUST NOT 展开空浮层。
MUST NOT 把「查询没命中」（浮层保持打开 + 无匹配提示）与本条混用。

#### Scenario: 展开后看到层级条目与当前段高亮

- **WHEN** 光标停在 `## 甲小节` 段内，点击 masthead 的指示段（或按 `⌘⇧O`）
- **THEN** 浮层展开并列出全部标题，H1–H6 都在列表里，各自缩进与层级一致（层级以文档最浅层标题为
  基准归一），`甲小节` 那条标记为当前段，键盘游标落在它上面

#### Scenario: 键盘跳转把光标放到标题行尾

- **WHEN** 浮层打开时按 `↑` 或 `↓` 移动，再按 `Enter`
- **THEN** 浮层收起，光标落在选中标题所在行的行尾，该行滚到视口居中；指示段随即显示该标题的完整
  链条；文档内容逐字节不变

#### Scenario: 鼠标点击条目跳转

- **WHEN** 浮层打开时鼠标点击某一条目标题文本
- **THEN** 与键盘 `Enter` 完全相同的落点（光标在行尾、该行居中、浮层收起），指示段显示所点标题的
  链条

#### Scenario: 关闭路径

- **WHEN** 浮层打开时按 `Esc`；再次打开后按 `⌘⇧O`；再次打开后点击浮层以外的区域（编辑器 / 文件树）；
  再次打开后按 `Tab` 把焦点移出浮层
- **THEN** 四条路径都收起浮层；`Esc` / `⌘⇧O` 是主动关闭，焦点交还编辑器并保持阅读位置；点击编辑器时
  由编辑器自然接手焦点，点击文件树等其它目标时焦点归该目标、MUST NOT 被拽回编辑器；`Tab` 那条不抢焦点
  （焦点已经落在别的控件上，拽回来是无礼的）；浮层打开态下 `↑↓` MUST NOT 穿透到文档（不会移动编辑器光标）

#### Scenario: 无标题文档给提示而非空浮层

- **WHEN** 打开一份没有任何标题的 Markdown 并按 `⌘⇧O`
- **THEN** 出现「这份文档还没有标题，大纲为空」的提示，浮层 MUST NOT 展开

#### Scenario: ⌃N / ⌃P 与 ↑↓ 等价且不穿透文档

- **WHEN** 光标停在 `## 甲小节` 段内，按 `⌘⇧O` 打开浮层，依次按 `⌃N`、`⌃P`、`⌃N`，并在键盘游标
  落在末项时再按一次 `⌃N`
- **THEN** 键盘游标依次下移一项、上移一项、再下移一项（落点与按 `↓` / `↑` 完全相同，末项处不再移动
  ——与 `↓` 的钳制一致）；全程文档内容逐字节不变、编辑器光标位置不变

#### Scenario: 浮层最大高度为窗口高的 80% 且随窗口变化

- **WHEN** 打开一份标题条数远超一屏的 Markdown，在 1200×800 窗口下展开浮层并读浮层总高；随后把窗口
  内容区高改到 400px（浮层保持打开）再读一次
- **THEN** 两次读到的浮层总高都不超过当时窗口内容区高度的 80%；两次都是列表在浮层内滚动（列表的
  内容高度大于它的可视高）而底部键位提示仍可见；改尺寸后上限跟着变，不必重开浮层

#### Scenario: 就地键与新提示同步

- **WHEN** 浮层打开，读底部键位提示文本，并依次按 `↑`、`↓`、`⌃N`、`⌃P`
- **THEN** 提示文本里五种就地键都出现（`↑↓` / `⌃N` / `⌃P` / `Enter` / `Esc`），四个方向键在浮层里
  都有实际效果（移动键盘游标）——MUST NOT 存在一个「提示里没有、也没有别的可见出口」的就地键


## ADDED Requirements

### Requirement: 浮层选择列表的 IME、ARIA 与焦点口径

浮层的就地键处理 SHALL 与 Quick Open 共用同一条组合期准入：`KeyboardEvent.isComposing` 为真或
`keyCode === 229` 时，`↑↓` / `⌃N` / `⌃P` / `Enter` MUST NOT 移动游标、MUST NOT 接受当前项、MUST NOT
关闭浮层，也 MUST NOT 消费该键（不 `preventDefault`）。组合期 MUST NOT 刷新结果集；组合结束 SHALL 按
最终查询串刷新**恰一次**——真实引擎在 `compositionend` 之后补发的同值 `input` MUST NOT 触发第二次
刷新。

`aria-selected` SHALL 只表示**键盘游标**：任意时刻至多一条 option 为 `aria-selected="true"`，且它
SHALL 是 `aria-activedescendant` 指向的那一条。当前段是**另一件事**：它 SHALL 用 `aria-current="true"`
与既有 `is-current` 视觉标记表示，MUST NOT 借 `aria-selected` 表达；游标移开后当前段 SHALL 保持
`aria-selected="false"` 且 `aria-current="true"`，两态因此可区分。

ARIA 关系 SHALL 闭合：持焦点的输入框是 `role=combobox` 且 `aria-controls` 指向列表的 `id`；列表是
`role=listbox` 且持有该 `id`；每个 option SHALL 有唯一、非空的 `id`；`aria-activedescendant` SHALL
指向当前游标 option 的 `id`，没有游标时 MUST NOT 出现该属性。没有键盘游标空间的条目（无命中态等）
MUST NOT 被写进 `aria-activedescendant`。

`Tab` MUST NOT 被浮层消费（仍走原生焦点遍历）；指针悬停游标行 MUST NOT 移除该行的游标标记——选中
底色与内描边 SHALL 保持不变。

关闭路径的焦点口径 SHALL 按主动 / 被动区分（与「大纲浮层」的关闭路径同一条）：主动关闭交还编辑器
并保持阅读位置，被动关闭不抢焦点。本条与 `docs/specs/selector-contract.md` 的选择器交互合同同源；
条目级细节以本合同为准，合同本身不在本文件复制。

#### Scenario: 组合期不导航不接受

- **WHEN** 浮层打开、焦点在筛选输入框，输入法组合进行中（`isComposing` 为真或 `keyCode === 229`）
  依次按下 `↓` 与 `Enter`，随后结束组合并提交最终查询串
- **THEN** 组合期游标不动、浮层不关闭、文档光标与选区不变；组合结束后列表按最终查询串刷新，游标
  落在该结果集的首条命中（查询为空时落在全量态起点）

#### Scenario: 组合结束只刷新一次

- **WHEN** 组合结束（`compositionend`）后引擎补发一次 `isComposing=false` 的同值 `input`
- **THEN** 结果集与行 DOM 只重建一次（不是两次）；最终查询串生效、游标起点按组合结束后的口径摆放

#### Scenario: 游标与当前段的属性分离

- **WHEN** 浮层打开（游标初值在当前段），随后按 `↓` 把游标移开当前段
- **THEN** 当前段保持 `aria-current="true"` 且 `aria-selected="false"`，游标行 `aria-selected="true"`
  且 `aria-current="false"`；`aria-activedescendant` 指向游标行；任意时刻 `aria-selected="true"` 的
  option 至多一条

#### Scenario: 被动关闭不抢焦点

- **WHEN** 浮层打开时点击浮层以外的非编辑器目标（如文件树空白处）
- **THEN** 浮层收起，焦点归用户刚点的目标（或浏览器默认落点），MUST NOT 被拽回编辑器；同一浮层用
  `Esc` 关闭时焦点交还编辑器且阅读位置不变
