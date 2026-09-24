# Design: list-filter（两处列表浮层的输入筛选）

技术方案与权衡。**本文的读数都是对仓内现状的引用（file:line 可复核）**；凡是「应当如何」的说法若未在真机或 chromium 上跑过，一律写成**待实测**并给出实测写法（见 §5），不包装成已验。

## 1. 现状读数（两处浮层的机制盘点）

### 1.1 大纲浮层（`src/toc.ts`）

| 面 | 现状 | 锚点 |
|---|---|---|
| 条目来源 | 打开那一刻 `extractHeadings(state, true)` 取一次快照（25ms 预算的全量解析），打开期间**不重建** | `:96`、`:119-141`、`:249`、`:255`；快照字段 `:192` |
| 列表 DOM | `div.lumir-toc` > `div.lumir-toc-list`（`role=listbox`、`aria-label`、`tabIndex=-1`）+ `p.lumir-toc-hint` | `:208-220` |
| 焦点 | 打开后 `list.focus()`；列表 `blur` → `close(false)`；`document mousedown` 落在外侧 → `close()` | `:259`、`:232`、`:234-239` |
| 就地键 | `keydown` 挂在**列表**上；`↑↓ / ⌃N / ⌃P` → `move(±1)`；`Enter` → `jumpTo(activeIndex)`；`Esc` → `close()`；其余键**不消费** | `:230`、`:391-415` |
| 游标 | `activeIndex` 是 `this.items` 的下标；`setActive()` 写 `is-active` + `aria-selected` + `aria-activedescendant` + `scrollIntoView({block:"nearest"})` | `:329-345` |
| 隐式下标不变量 | `items` 由 `entries` **同序同下标**构建；`render(current)` 的 `current`、`jumpTo(index)` 的 `index` 都按 `entries` 解释 | `:303-327`、`:371-383` |
| 当前段 | 打开时算一次 `headingIndexAt(entries, anchorPos(...))`，写进 `is-current` | `:255`、`:319` |
| 缩进基准 | `entries.reduce(min level)`（**文档**最浅层），写 `--toc-depth` | `:304`、`:317`；CSS `src/style.css:511-513` |
| 布局 | 列向 flex，`max-height: 80vh`，列表是唯一滚动容器，提示行 `flex: 0 0 auto` 不可压缩 | `src/style.css:491-510`、`:524-532` |

### 1.2 vault 浮层（`src/vault-switcher.ts`）

| 面 | 现状 | 锚点 |
|---|---|---|
| 条目来源 | 每次打开异步 `list()` 拉一次（MUST NOT 常驻镜像）；排序由后端给出、前端不重排 | `:14-16`、`:631-641` |
| 列表 DOM | `div.vault-pop` > `div.vault-list`（`role=listbox`、`tabIndex=-1`）+ `div.vault-sep` + `button.vault-add` | `:555-577` |
| 双击下标（两个空间） | `rows` = **可选中行**（可用行）的下标空间；`rowEntries` = 完整列表；两者用 `dataset.vault` 回查 | `:542-544`、`:681-682`、`:690-691`、`:707`、`:790-795` |
| `rowEntries` 的第二个消费者 | 「重新定位…」把 `this.rowEntries` 当 `siblings` 传给装配层做**占用判定**（同一路径不能绑给两个 vault） | `:511`、`:747`、`:816` |
| 就地键 | `keydown` 挂在列表上；`Enter` 分三支（失效行 → 重定位 / 当前项 → 只收起 / 其余 → 切换）；其余键不消费 | `:585`、`:797-832` |
| 焦点与关闭 | 打开后 `list.focus()`；列表 `blur` → `close(false)`；浮层级 `mousedown` **一律** `preventDefault()`（行不夺焦）；`document mousedown` 落在外侧 → `close(false)` | `:640`、`:591`、`:589`、`:595-602` |
| 当前项 | `currentId` 决定 `is-current` / 「当前」标记；打开时游标默认落在当前项 | `:549`、`:690-691`、`:706`、`:718-729` |
| 空态 / 列表为空 | 分隔线隐藏而「新增 vault…」照常给出（空列表时它是唯一的动作）；**列表读不到时只给一条人话提示、不弹空浮层**（空列表会被误读成「一个 vault 都没有」——这就是「没有条目」与「查询没命中」必须分开的既有依据） | `:686`、`:642-646` |
| 布局 | 列向 flex，`max-height: 60vh`（**与大纲的 80vh 不同**），列表是唯一滚动容器 | `src/style.css:539-559` |

### 1.3 键位与验收的约束面

| 面 | 现状 | 锚点 |
|---|---|---|
| 表内无单字符绑定 | `KEY_BINDINGS` 的每一条都带修饰键或具名键 | `src/keys.ts:285-379` |
| 单字符 token 合法 | `normalizeKey` 把单字符**大写化**（`s` → `S`），因此「单字符绑定」完全合法 | `src/keys.ts:409-419` |
| 分发器让路 | 对 `defaultPrevented` 直接返回不改 chord 状态；`global` 作用域与焦点无关 | `src/keys.ts:553-555`、`openspec/specs/keymap-commands/spec.md:31-35` |
| 提示行即判据 | `⌃N⌃P 选择` 串在 `13-toc` 场景里 **15 处 `ax:` 断言** + chromium 侧 1 处逐字比对 | `scripts/acceptance/scenarios/13-toc.md`、`tests/visual/scenes/toc-outline.spec.ts:153` |
| `⌃S` 已被预留 | 「⌃S 解绑（预留给 isearch）」——本 change MUST NOT 占用它 | `src/keys.ts:350` |

## 2. 机制设计

### 2.1 筛选状态机

状态（每处浮层一份，两处同形）：

- `closed`：未打开（已有的 `open = false`）。
- `open`：浮层可见。此时 `query` 为空（全量态）或非空（筛选态）；两态共用同一个「结果集」概念——**全量态就是查询为空时的结果集**。
- 结果集为空且查询非空 = `open` 的一个子情形（无命中态），**不是**另一个状态、**也不关闭浮层**（`src/toc.ts:249-253` 的「没有标题就不弹浮层」判的是文档里一条标题都没有，与「查询没命中」是两件事，MUST NOT 混用）。

转移（两处通用；vault 的「打开」多一段既有的异步拉取，`src/vault-switcher.ts:631-641`）：

| 事件 | 行为 | 与现状的关系 |
|---|---|---|
| 打开 | 查询 = 空；结果集 = 全量；游标 = 全量态起点（大纲 = 当前段，无当前段则首条；vault = 当前项，无则首条） | 与现状一致（`src/toc.ts:255-261`、`src/vault-switcher.ts:690-691`） |
| 输入（查询从空变非空） | 重算结果集；游标 = **首条命中**；重渲染 | 新 |
| 输入（查询继续变长 / 变短） | 重算结果集；游标 = 首条命中（**不做「尽量保持原游标」的锚定**，理由：v1 求可预测，锚定会引入一条只在部分情形生效的规则） | 新 |
| 查询变为空 | 结果集 = 全量；游标 = **回到全量态起点** | 新 |
| `↑↓` / `⌃N` / `⌃P` | 在结果集里移动，边界钳制（共用既有 `move()`） | 复用 `src/toc.ts:385-389`、`src/vault-switcher.ts:784-788`（MUST NOT 第二套下标逻辑） |
| `Enter` | 对当前游标条目执行**既有**动作（大纲跳转；vault 三支不变）；无游标（无命中）时无操作 | 复用 `:371-383`、`:811-824` |
| `Esc` | 关闭浮层并丢弃查询（一步，裁决点 ④ 推荐项） | 复用既有关闭路径，语义不变 |
| 关闭（浮层外点击 / `blur` / 再按开关命令） | 丢弃查询（下次打开从空开始） | 新增一条「状态随关闭清空」的不变量 |
| （大纲）光标 / 文档变化 | **不影响结果集**（快照在打开时取定，打开期间不重建，`:192`） | 不变 |

### 2.2 输入通道：为什么必须是可编辑宿主

形态选择（裁决点 ②）的技术根据是三条，**第 1 条是决定性的**：

1. **输入法 composition 只投向可编辑元素**：`compositionstart` / `compositionupdate` / `compositionend` 的目标必须是 `input` / `textarea` / `contenteditable`。两处浮层的现有宿主是 `div`（`src/toc.ts:211-215`）与 `button`（`src/vault-switcher.ts:698-700`），都不是 composition 目标，因此「没有输入框、直接在列表上打字」这条形态**打不进中文**——而两处列表的主文本恰恰是中文（大纲 fixture 的 `## 甲小节`、`## 第 1 章 概览`）。**这条 MUST 在真机上实测一次**（§5 第 1 项），实测前不在 spec 里把它写成既成事实。
2. **文本编辑语义**：退格 / `⌥⌫` / `⌘A` / `⌦` / 左右方向键在真输入框上是原生的；自建缓冲要把它们重写一遍，且必然与 macOS 的文本系统行为有差。
3. **无障碍**：ARIA 的组合框模式（`role=combobox` + `aria-controls` + `aria-activedescendant` + `aria-expanded`）正是为「输入框 + 列表」这一对定义的；列表持焦点 + `aria-activedescendant` 是另一种模式，二者只能选一种，混用会让读屏走错分支。

### 2.3 焦点迁移的连带面（本次改动真正的风险面）

把持焦点元素从列表换成输入框，会牵动五处既有挂点。逐条给出**迁移后 MUST**：

| 面 | 现状锚点 | 迁移后 MUST |
|---|---|---|
| 打开时聚焦 | `src/toc.ts:259`、`src/vault-switcher.ts:640`（`list.focus()`） | 聚焦输入框 |
| 失焦即收起 | `src/toc.ts:232`、`src/vault-switcher.ts:591`（挂在**列表**上） | 挂点外移到浮层容器：**焦点离开浮层**（含从输入框离开）才收起。否则 `Tab` 从输入框出去时浮层会留在屏幕上、焦点却已跑到别的控件 |
| `aria-activedescendant` | `src/toc.ts:343`、`src/vault-switcher.ts:770`（挂在列表上） | 挂到**持焦点的输入框**上；列表保留 `id` 供 `aria-controls` 指认（ARIA 要求 `aria-activedescendant` 落在持焦点的元素上） |
| 就地键挂点 | `src/toc.ts:230`、`src/vault-switcher.ts:585`（挂在列表上） | 上移到浮层容器（输入框里的键冒泡到容器；列表不再是焦点路径）。行为口径一字不改：仍是就地消费 + `preventDefault` |
| 浮层级 `mousedown` 防夺焦 | `src/vault-switcher.ts:589` 是**浮层级**的 `preventDefault()`；`src/toc.ts:321-322` 是**逐条目**的 | vault 侧 MUST 把输入框排除在这条 `preventDefault` 之外，否则**点击输入框无法落焦点**（现象：点了没反应、指针进不去）。toc 侧因为是逐条目挂的，天然不受影响——但两处的现象 SHOULD 在真机上各实测一次 |

一条**不变**的口径：条目 / 行仍然不夺焦点（`src/toc.ts:321-322`、`src/vault-switcher.ts:586-589` 的理由不变：mousedown 一旦夺焦，`blur` 会先收起浮层，随后的 `click` 落在已是 `display:none` 的元素上，那一行的动作永远不执行）。

### 2.4 结果集与下标空间（两处各有一个「下标空间」陷阱）

**共同原则**：结果集 SHALL 表达为一个**下标数组**（`visible: number[]`，指向条目源数组的下标），所有游标语义（当前游标、当前段 / 当前项、点击与 `Enter` 的落点）都 SHALL 在同一空间里解释；MUST NOT 让「结果集下标」与「源下标」两套空间并存而不显式映射。

- **大纲侧**：现有实现里 `items` 与 `entries` **同序同下标**（`:309-325` 构建、`:371-383` 的 `jumpTo` 按 `entries` 取、`:319` / `:326` 的 `current` 也按 `entries` 解释）。这个不变量是**隐式**的，筛选一旦引入就会破：若不建映射，`Enter` 会跳到「结果集里第 i 条」在**全文**里对应的另一条标题上——一个随机跳错位置的静默缺陷。修法是把「结果集下标 → 源下标」的映射做成唯一入口，`jumpTo` 与 `is-current` 都从它取。
- **vault 侧**：今天的两个空间是 `rows`（可选中行，索引空间）与 `rowEntries`（完整列表，用 `dataset.vault` 回查，`:790-795`）。筛选**不能**直接把 `rowEntries` 收窄成结果集，因为 `rowEntries` 还有第二个消费者：「重新定位…」把它当 `siblings` 传给占用判定（`:511`、`:747`、`:816`）。若 `siblings` 变成结果集，被筛掉的 vault 就不参与占用判定——**用户能把一个已被别的 vault 占用的目录当成重定位目标**（D105 的拒绝不触发，两个身份落到同一路径，`文案-Copy.md` D105 与 living spec 的「重定位到已被占用的路径被拒绝」一起失效）。修法：`rowEntries` 保持完整列表，另加结果集下标数组。

### 2.5 性能：不加防抖，但不引用既有门禁

- 每次击键的实际工作 = 「对已提取的快照做一次大小写折叠的子串判定」+ 「重建可见条目 DOM」（`src/toc.ts:306-325` 的 `replaceChildren` + 逐条建元素；vault 同理 `:684`）。**不重跑 lezer 解析**（打开路径那次 25ms 预算的解析仍是唯一一次，`:96`、`:119-122`），**不重新拉取注册表**（vault 的 `list()` 只在打开时调，`:631`）。
- 量级：大纲 60 条（既有长文 fixture）到数百条；vault 是注册表规模（几十条量级）。
- **不加防抖**：防抖会把「打字即筛」变成「打完才筛」，与诉求相反；且成本与量级无关地落在 DOM 重建上，防抖不能消除它，只能掩盖。
- **既有性能门禁不覆盖这条路径**：`scripts/perf/keypress-to-paint.mjs` 注入的是**编辑器**里的按键（`docs/specs/perf-measurement.md:111-115`），浮层击键不在其测量面上；ADR 0002 §6 的 `<16ms` 因此在本次是**声称**而非证明。MUST 实测（§5 第 4 项），并在真实读数出来前不写「达标」。
- **退化预案（若实测超预算）**：打开时建全量条目 DOM，筛选改为切换 `hidden` / `display`（不重建 DOM）。它天然保留顺序与缩进，代价是全量 DOM 常驻（60–数百条可接受；上千条要再评估）。选哪条按实测读数定，并把读数写进实现说明。

### 2.6 视觉与布局

- 两处浮层都已是列向 flex + 唯一滚动容器（`src/style.css:491-510`、`:539-559`），因此新增一行输入行**不需要动高度口径**：输入行取 `flex: 0 0 auto`（同 `.lumir-toc-hint` 的写法 `:524-532`），列表的 `flex: 1 1 auto; min-height: 0` 自动让出高度，浮层总高上限（80vh / 60vh）不变。
- 视觉只取既有 token（`--bg` / `--bd-*` / `--dim` / `--font-*` / `--radius`），MUST NOT 引入新的视觉语言（`openspec/specs/toc-outline/spec.md:73`）。
- 已知边界随之收紧：原文「窗口内容区高 ≥ 285px 时浮层不越出窗口底边」（`src/style.css:488-490`、`openspec/specs/toc-outline/spec.md:80-83`）是在没有输入行时算的；新增一行后该下限上移约一行，**实测后如实改写**（§5 第 5 项）。
- **可发现性**：vault 浮层今天没有任何提示行（`:555-577`），本 change **不加**新提示行，输入的可发现性由输入框的占位文案承担（新文案条目）；大纲浮层保留既有提示行、文字**不动**（裁决点 ④ 推荐项下无需改写，因而 15 处验收断言与 1 处视觉断言不受影响）。

## 3. 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 无输入框的纯 typeahead（焦点留在列表上，自建查询缓冲） | 非可编辑宿主不是 composition 目标 ⇒ 中文打不进去（§2.2 第 1 条）；且要把文本编辑语义重写一遍 |
| 模糊匹配（子序列 + 打分排序） | 要引入排序与打分：vault 侧与「排序由后端给出、前端不重排」的既有口径冲突（`src/vault-switcher.ts:14-16`）；大纲侧要引入一套可见的打分语言，与 `openspec/specs/toc-outline/spec.md:73` 冲突。收益是「少打几个字」，代价是结果顺序不可预测 |
| 命中片段高亮 | 新视觉语言（同上）；且大纲条目文本含行内标记原文（`src/toc.ts:12-13`），高亮的偏移会落进标记里 |
| 把筛选做成统一键位表里的绑定（单字符或前缀键如 `/`） | 单字符 token 在表里合法（`src/keys.ts:409-419`），绑进去会吞掉编辑器里键入的每一个字母（`global` 作用域与焦点无关）；且键位表的不变量要求「一个 token 一条绑定」，筛选天然是「一组键」 |
| 用 `⌃S`（Emacs isearch 的预留位）进入筛选态 | 该 token 已被明确预留（`src/keys.ts:350`）；真正的 isearch 是另一件事（全文档增量搜索），本 change 不占它的位置 |
| 两步 `Esc` | 要改写 `Esc SHALL 关闭浮层` 的既有条款 + 底部提示文案（同步 15 处验收断言 + 1 处视觉断言），收益只是省一次重输 |
| 无命中即关闭浮层 | 用户分不清「没命中」与「列表本来就空」，还丢掉刚输入的查询 |
| 防抖 | 与「打字即筛」的诉求相反（§2.5） |
| 给 vault 浮层再加一条底部提示行 | 新元素 + 与大纲不同的提示口径；可发现性由输入框占位承担更省 |
| 两处各写一份匹配 / 各定一套口径 | REVIEW.md 第 8 条：同一语义两处真源必漂移 |
| 按匹配集归一层级缩进 | 层级信息消失，且要改写 living spec 的「文档最浅层」原文（裁决点 ⑤） |
| 把 `rowEntries` 收窄成结果集（vault 侧图省事） | 破坏重定位的占用判定（§2.4），是一次静默的身份合并风险 |
| 为筛选态加「清空」按钮 | 新元素、新视觉语言；原生文本编辑已经够用（`Esc` 关闭即丢弃） |

## 4. 已知边界（如实记录）

1. **行内标记不剥离**：匹配对象是条目显示文本本身（与显示口径逐字相同），因此 `## **粗**标题` 用「粗标题」搜不到（跨标记的连续串不存在）。不剥离是既有显示口径的延伸（`src/toc.ts:12-13`），不是本次的新决定。
2. **不做归一**：全角 / 半角、简繁、拼音一律不归一；大小写折叠仅 ASCII 有效（CJK 无大小写）。
3. **不做分词**：查询是单一子串，多词 AND / 排除语法 / 正则不做。
4. **vault 只匹配显示名**：不匹配路径与摘要（否则输入 `1` 会因为「1 个标签」命中一堆无关行）；因此同名不同目录的两个 vault 无法靠输入区分（靠路径区分是另一件事）。
5. **查询不持久化**：关闭即丢弃，重开从空开始。
6. **指标准则**：本 change 不新增任何键位 / 命令 / 配置项 / 埋点。
7. **`(focused)` 判据通道可能变化**：焦点迁移后游标条目的 AX 形态待实测（§5 第 2 项），验收场景的判据要按实测改写——**这条不定稿就不动既有场景**。

## 5. 实现期待验证项（MUST 实测，不包装成已验）

每条给出「为什么必须实测 / 怎么测 / 结论落到哪」。实测记录落 `test-results/<mission>/`（git 外，可 `ls`），结论回写本文件对应小节。

| # | 待验项 | 为什么必须实测 | 怎么测 | 结论落到 |
|---|---|---|---|---|
| 1 | 非可编辑宿主收不到 IME 输入 | 形态选择（裁决点 ②）的决定性根据，不能只凭规范推导 | 真机：拼音输入法在浮层列表上敲（预期无任何字符落地）；chromium：CDP `Input.imeSetComposition` 对 `.lumir-toc-list` 派发（预期无效） | §2.2；若实测与预期相反，形态选择要重新评估并回报 tower |
| 2 | 焦点迁移后的 AX 形态（游标落在哪一条怎么判） | 验收场景判定「`↑↓` 落点」的**唯一**通道就是 `(focused)`；迁移后归属变了 | 真机打开浮层读 AX 快照，看 `(focused)` 落在输入框还是条目上；再按 `↓` 复读 | §2.3；据此改写 `scripts/acceptance/scenarios/13-toc.md` 的四处游标判据（写清新旧通道的差异） |
| 3 | WKWebView 的组合期事件顺序 | 组合期刷新结果集会让中文输入过程闪烁（拼音串必然零命中） | 真机记录 `compositionstart` / `input(isComposing)` / `compositionend` 的先后与各自时的查询值 | §2.1 的「输入」行；据此定「组合期不刷新、`compositionend` 后刷一次」的实现 |
| 4 | 击键到结果集渲染完成的时长 | ADR 0002 §6 的 `<16ms` 在这条路径上没有既有端点（§2.5） | chromium：60 条与约 1000 条标题两份 fixture，采样 N≥50 次取 median；真机补一组观感读数 | §2.5；超预算则启用退化预案并把读数写进实现说明 |
| 5 | 短窗口下浮层底边是否越出 | 现有「≥285px」是在没有输入行时算的（§2.6） | chromium：把窗口内容区高压到 285 / 300 / 320px，读浮层底边与视口底边的差 | §2.6；如实改写 spec 的已知边界段 |
| 6 | 焦点迁移后三条关闭路径仍成立 | `blur` 挂点外移是本次最容易漏的一处（§2.3） | 真机：从输入框 `Tab` 出去 / 点击浮层外区域 / ⌘⇧O 再按，三条路径各一次 | §2.3；三条都进验收场景 |
| 7 | 点击输入框能落焦点（vault 侧） | 浮层级 `mousedown preventDefault` 会把它挡掉（§2.3） | 真机：鼠标点输入框后直接键入一个字符，看查询是否出现 | §2.3 |
| 8 | 用户单字符 `[keys]` 绑定在浮层打开期间被遮蔽 | 这是 spec 要声明的**有意变化**（语义变化表），得先证明它真的发生、且关闭浮层后恢复 | 用 `s = "document.save"` 的配置起一次：浮层打开时按 `s`（预期筛选、不保存）、关闭后按 `s`（预期保存） | §2.3 / spec 的 MUST；这段行为写进验收场景 |
| 9 | `Enter` 落点在结果集里正确（下标空间） | §2.4 的大纲侧陷阱是静默跳错位置 | chromium + 真机：筛出中段的一条标题后按 `Enter`，断言游标落在**那一条**的行尾 | §2.4；反向验证：去掉映射后该断言必须 FAIL |
| 10 | 重定位占用判定仍用完整列表 | §2.4 的 vault 侧陷阱是静默的身份合并 | 单元/视觉：三个 vault（其中之一被筛掉）下把一个被占用路径当重定位目标，断言仍被拒 | §2.4；反向验证：把 `siblings` 换成结果集后该断言必须 FAIL |

## 6. 裁决点与 delta / tasks 的改写路径

| 裁决点 | 推荐项下的制品形态 | 若取备选，改写落点 |
|---|---|---|
| ① 匹配语义 | 子串 + 大小写折叠 + 顺序不重排（delta 的匹配 requirement 原文） | 前缀 ⇒ 改一句匹配判定的措辞 + 场景里换成「只命中前缀」；模糊 / 高亮 ⇒ 追加「排序与打分」或「高亮」一整条 requirement + 视觉基线，且要单独请 Alex 裁「是否允许引入新视觉语言」 |
| ② 触发形态 | 输入框 + 焦点在它上面（delta 的交互 requirement 原文） | 纯 typeahead ⇒ 删掉输入框与 ARIA 条款、改为「列表持焦点 + 自建查询缓冲」，并把 §5 第 1 项的实测结论一并改写（若实测证明非可编辑宿主能收 IME，这条才有讨论价值）；两段式 ⇒ 追加「进入筛选态」的键位裁决，并回到键位表去找免费 token |
| ③ 共享口径 | 规则写 `toc-outline`、`vault-workspace` 引用（delta 现状） | 翻转宿主 ⇒ 两个 delta 文件内容对调；新建 capability ⇒ 新增 `openspec/specs/list-filter/spec.md` 与 archive 时的 Purpose（`docs/process/openspec-workflow.md:57`） |
| ④ 键盘与退出 | 一步 `Esc`、无命中不关浮层（delta 原文） | 两步 `Esc` ⇒ 改 `Esc` 条款 + **必须**改写底部提示文案，并同步 `13-toc` 的 15 处断言、`tests/visual/scenes/toc-outline.spec.ts:153`、`文案-Copy.md` D86；无命中即关 ⇒ 删掉无命中态 requirement 与其场景 |
| ⑤ 缩进基准 | 沿用文档级基准（`src/toc.ts:304` 不动，living spec 原文不动） | 按匹配集归一 ⇒ 把「文档最浅层」改写为「结果集最浅层」，并加一条筛选态缩进的场景 |

## 7. 实现期实测结论（M199，2026-09-24）

本节的读数都来自 M199 的真机（`scripts/acceptance/`，WKWebView + KimiCU）与 chromium（`tests/visual/`）
运行，证据路径均可 `ls`（`test-results/m199/`，git 外）。**逐项标注「已实测 / 未实测」，不把未测的写成已验。**

| # | 结论 |
|---|---|
| 1 | **未实测（探针不可判定，如实登记）**：chromium 用 CDP `Input.imeSetComposition` 做的半边探针结果**无法区分**被测命题——把 DOM 焦点放到 `.lumir-toc-list`（div）后派发组合串，"zhong" 仍落进了**弹层里的输入框**（`probe-ime-chromium.json`：`host: list(div)` 那次 `input=1, text="zhong"`，说明 Chromium 的 IME 目标不是 DOM activeElement，而是同一 frame 里的编辑宿主）。真机半边也造不出输入法组合（KimiCU 的 `type_text` 直接注入 Unicode，不经 IME；`do: keys` 只能注入 ASCII）。因此「非可编辑宿主收不到 IME 输入」这条**没有被本 mission 的测量证实**，形态选择（裁决点 ② 的真输入框）在本实现里由另外两条腿承重：原生文本编辑语义（`⌫` / `⌥⌫` / `⌘A` / `⌦` / 左右键）与 ARIA 组合框语义。**真机实测到的是它的正向部分**：文本确实进得了输入框（`AXComboBox` 的 `Value:` 读数，场景 32）。 |
| 2 | **已实测**：真机 AX 快照里唯一带 `(focused)` 的节点是 `AXComboBox (筛选)`，浮层条目（`AXList (大纲)` 下的 `AXStaticText`）**没有任何标记**。据此 `scripts/acceptance/scenarios/13-toc.md` 的四处游标判据全部改写为**派生证据**（masthead 标题链，`›` 分隔符只可能由指示段产生）：`↓` 的落点由随后的 `Enter` 链条证明；⌃N / ⌃P 两腿各补一次「↓ + Enter」或直接 Enter 由链条判。改后 `13-toc` **49/49 PASS**（`test-results/m199/acceptance-run4.log`）。 |
| 3 | **部分实测**：实现按「组合期不刷新、组合结束后的第一个输入事件刷一次」落地（两个事件序都成立）；chromium 断言在 `tests/visual/scenes/list-filter.spec.ts`（合成 `compositionstart` → `input(isComposing)` → `compositionend` 序列）。真机的事件序**未实测**（同第 1 项：真机通道造不出输入法组合）。 |
| 4 | **已实测（chromium）**：N=120 次击键/档，「输入 → 结果集 DOM 重建完成」的处理时长中位 **0.30ms（60 条）/ 4.70ms（1000 条）**，p95 0.5 / 6.2ms，max 1.6 / 7.0ms；事件到下一帧 paint 的中位 0.70 / 5.40ms（`test-results/m199/filter-keystroke.json`）。**不启用退化预案**（DOM 重建路线留在实现里）；真机观感读数未取——ADR 0002 §6 的 `<16ms` 在这条路径上仍只是「chromium 上未观察到超预算」，不写成真机达标。 |
| 5 | **已实测（chromium）**：`test-results/m199/short-window.json`——窗口内容区高 285px 时浮层底边**恰好**贴住内容区下沿（overflow 0px，与原文 `57px + 80% ≤ 100%` 的推导逐位吻合）；260px 时越出 5px；300 / 320 / 400 / 800px 均不越出。**原文那条已知边界照旧成立**（它说的是 80vh 上限那条分支），本次补一句：内容自然高度小于上限时（条数少的文档）约束换成自然高度，输入行让自然高度 +31px（`toc-outline` 的 5 条条目下浮层自然高约 202px → 窗口内容区高低于约 259px 时底边可能越出）。读数与改写落 `src/style.css` 与 `openspec/specs/toc-outline/spec.md` 的已知边界段。 |
| 6 | **部分实测**：`Esc` 一步关闭（真机，场景 32）与 `⌘⇧O` 再按关（真机，`13-toc` 全绿）都过了；`Tab` 出去即收起在 chromium 侧有断言（`tests/visual/scenes/list-filter.spec.ts` 的大纲侧）；**vault 侧的焦点离开收起与「点浮层以外收起」在单元层**（`tests/unit/vault-switcher.test.ts`：focusout 带浮层外 `relatedTarget`、document `mousedown` 落在浮层外；两条路径本 change 未动）。真机侧的 `Tab` / 点击浮层以外**未单独断言**（r1 评审 P2-3 指正了原先那句过宽的指针）。 |
| 7 | **chromium 已实测**（`list-filter.spec.ts`「点击输入框能落焦点」先把焦点 Tab 到行上再点输入框；反向验证 RV-4 去掉排除项后该条红）。**真机的鼠标点击现象未覆盖**（判据只能人工或 chromium）。 |
| 8 | **已实测（chromium，r1 修复 + r2 收窄后）**：本条原先只登记「结构证据」，r1 评审走查证明那套证据**不成立**——浮层容器对单字符走「其余键不消费」，事件照常冒泡到 window 分发器；用户绑定派生的 scope 是 **global**，分发器只对 editor 作用域判 `isEditorEvent`，于是 `preventDefault()` + 保存触发：**字符进不了输入框**，与 delta scenario 的 THEN 恰好相反。修复（tower 裁决路径 ①）：`src/keys.ts` 的 `Keymap.handle` 加**可编辑宿主守卫**；**r2 评审把守卫收窄到「只拦打字键」**——目标是编辑器之外的可编辑宿主（原生 input / textarea / contenteditable）且按下的是**无修饰键的可打印单字符**（`isTypingKey`：`⇧` 仍属打字，⌘/⌃/⌥ chord 放行；编辑器 contentDOM 经既有的 `ctx.isEditorEvent` 排除）。收窄的理由是 r1 的 blanket 形态把 living spec 的关闭路径二整段杀死（两处浮层打开后焦点恒在筛选输入框，`⌘⇧O`/`⌘O` 再按收起浮层因此永不可达，连同浮层里的 `⌘W`/`⌘F`/`⌘=`/`⌘1–9` 一起失效——reviewer r2 探针在同构建里实测，读数 `Received: visible`，见 `test-results/m199/reviewer-r2-toggle-close-probe.md`）。断言落 `tests/visual/scenes/editable-host-guard.spec.ts` 四条：① 筛选输入框里打 `s` → 字符落进输入框（`toHaveValue("s")`）、桩的 `document_save` 调用数不变、无「已保存」浮条；② 浮层外（编辑器）打 `s` → 保存真的落盘（写盘记录 +1、内容含 `x`）；③ 搜索 panel 侧同型一条；④ **焦点在筛选输入框时 ⌘⇧O / ⌘O 再按应收起浮层**（关闭路径二，r2 的修复要求）。两次反向验证互补（读数 `test-results/m199/visual-filter-reverse.md`）：**RV-5** 关掉守卫 → 单字符两条红（`Received: ""`）而 chord 两条绿；**RV-6** 放宽回 blanket → chord 两条红（`Received: visible`）而单字符两条绿。真机侧：场景 32（字符进输入框，AXValue 读数）与场景 25（`⌘O` 再按收起，26/26 PASS）。 |
| 9 | **已实测**：chromium 光标偏移断言（筛出中段一条后 `Enter` 落在该条的行尾）+ 反向验证 RV-2（去掉「结果集下标 → 源下标」映射后**只**该条红）。真机侧同一条映射由场景 32 的链条判据覆盖（查询 `ban` + `↓` + `Enter` → `Filter 章节 › Banana 小节 › Banana 细节`）。 |
| 10 | **已实测**：单元层按**调用参数**断言 `requestRelocate` 的 `siblings` 仍是完整列表（`tests/unit/vault-switcher.test.ts`）+ 反向验证 RV-3（换成结果集后该条红）。 |

### 语义变化登记（r2 修正版：可编辑宿主守卫的净影响）

守卫收窄到「只拦无修饰键的可打印单字符」之后，本 change 的净行为变化**只剩 approved delta 要求的那一条**：

| 路径 | 今天（收窄后） |
|---|---|
| 非编辑器可编辑宿主（筛选输入框 / 搜索 panel 输入框）里按**无修饰键的可打印字符** | 归输入框：字符落入、不触发任何绑定（**有意变化**，delta 的 scenario） |
| 同一宿主里按 **⌘ / ⌃ 开头的 chord**（⌘⇧O、⌘O、⌘W、⌘F、⌘=、⌘1–9…） | **照常触发绑定**（与改动前一致；r1 的 blanket 形态曾把它们一并拦掉——r2 评审 P1-1 实证并裁决收窄） |
| 同一宿主里按 **⌥ 组合**（`⌥a` → `å`） | 放行（按 chord 处理）。它是 macOS 的组字层，与「往输入框里键入一个字符」不是同一回事；本 change 只服务单字符绑定不许吞字这一条，⌥ 形态如实登记为未收窄的边界 |
| 编辑器（contentDOM 内）里的任何按键 | 与改动前逐字一致（守卫经 `ctx.isEditorEvent` 排除） |
| 浮层容器级就地键（↑↓ / ⌃N / ⌃P / Enter / Esc） | 与改动前逐字一致（容器先 `preventDefault`，分发器对已消费事件让路） |

**一处被推翻的论证（如实留痕）**：r1 的 review-request 里用「348 条既有断言全绿」支持「搜索 panel 的 chord 让位无既有断言依赖」。
r2 评审指出该论证的成立原因是**覆盖洞**——当时没有任何断言在「焦点位于可编辑宿主」时按修饰键 chord（浮层 toggle-close 因此整段失守而无灯可亮），
不是「行为无变化」。修正后的证据是**两向**的：RV-6（放宽回 blanket → chord 两条红）与 RV-5（关掉守卫 → 单字符两条红）。

### 真机场景读数（`test-results/acceptance/2026-09-24/`）

| 场景 | 结果 | 说明 |
|---|---|---|
| `32-list-filter`（新增） | **PASS 47/47** | 两处浮层的打字即筛 / 结果集游标与跳转落点 / 无命中保持浮层 / `Esc` 一步丢弃查询 / 清空回全量 / 大小写折叠 |
| `13-toc`（判据改写后） | **PASS 49/49** | 既有大纲行为未被筛选挤坏；游标判据走派生证据 |
| `17-multi-vault-switch` | **PASS 38/38** | 切换器浮层的既有行为（含会话落盘与恢复）未回归 |
| `18-vault-session-restore` | **PASS 7/7** | 同上 |

**场景侧的两处修正（都不是产品缺陷，如实登记）**：① WKWebView 把 `<input role="combobox">` 报成
`AXComboBox`（不是 `AXTextField`），且它的文本经 `Value: …` 暴露——套件原先两处都不认，`keys` 的回读目标
因此退到 label 上，注入残段累积成脏查询（实测值 `banbab`）。`lib/ax.mjs` 与 `lib/execute.mjs` 已就地补上
这两种形态。② 真机注入通道给不出大写（`A` 落成 `a`，同族边界见 README 的 `⌘⇧=` 那条），大小写折叠的真机
判据改走「小写查询命中混合大小写文本」这一半。
