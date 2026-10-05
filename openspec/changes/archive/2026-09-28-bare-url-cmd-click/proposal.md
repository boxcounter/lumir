# Proposal: 普通（非 `[title](link)` 语法）链接也可 CMD+点击打开——裸 URL 与链接定义行的装饰与激活

- Change ID: bare-url-cmd-click
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 需求原话（2026-09-27）：**「普通链接（不是 markdown 标准语法 [title](link)）也可以像 markdown 标准链接那样可以通过 CMD+点击打开。」** 截图现场：`CODE_OF_CONDUCT.md` 末尾的 reference-style 定义行 `[homepage]: https://www.contributor-covenant.org` 里的裸 URL。

### 一、现状：这条链接今天既没有装饰，也没有打开路径

M144 引入外链渲染与激活、M145 把装饰面扩到「`[title](target)` 的全形态矩阵」，两者共用一份分类实现（`src/preview/links.ts` 的 `classifyLinkTarget`）与一条跟随链路（`src/link-follow.ts` 的 `linkTargetAt` → `followLink`）。**判定面的入口是语法树的 `Link` 节点**——`src/preview/links.ts:73-90` 的 `standardLinkParts` 先取 `Link` 节点的 `URL` 子节点，取不到就返回 null（`src/preview/links.ts:156-165` 的 `linkOfNode` 同款）。裸 URL 与定义行在语法树里各自的节点形态与 `Link` 不同，因此**在路口之外**：

| 现场 | 语法树里的形态（实测，见 [evidence/lezer-node-forms.txt](evidence/lezer-node-forms.txt)） | 今天的行为 |
|---|---|---|
| `正文里的 https://x 是裸 URL` | 段落直属的顶层 `URL` 节点（父节点是 `Paragraph`） | 纯文本：无链接样式、无尾标、⌘-Click 落在 `posAtCoords` 判定的位置上但 `linkTargetAt` 返回 null，不拦截、不打开 |
| `[homepage]: https://x` | `LinkReference` 节点（`LinkLabel` + `LinkMark` `:` + `URL` 子节点） | 整行按源码显示，URL 部分不可点、不可激活 |
| `<https://x>` | `Autolink` 节点（两个 `LinkMark` 尖括号 + `URL` 子节点） | 同上（M145 口径：自动链接保持原文） |

三处的 `URL` 节点**已经在语法树里**（裸 URL 那条是 GFM 的 `Autolink` 扩展直接产出 `URL` 节点——`node_modules/@lezer/markdown/dist/index.js:2233-2275` 的扩展本体与 `:2265` 的 `cx.elt("URL", …)`；本仓的 `markdownConfig` 默认含 `GFM`，`src/editor.ts:1137`），差的只是「谁去认它、怎么装饰、激活时怎么分类」。

### 二、代码与 spec 的双重现状锚点

- **装饰面**：`src/preview/livePreview.ts:1034-1074` 的 `name === "Link"` 分支是唯一的链接装饰实现；`src/preview/livePreview.ts:872-873` 对表格内节点只放行 `InlineCode` / `Emphasis` / `StrongEmphasis` / `Strikethrough` / `Link` 五种名字。
- **激活面**：`src/link-follow.ts:223-245` 的 `linkTargetAt` = 「先 wikilink（`wikilinkAt`，纯词法）→ 再标准链接（`standardLinkAt`）」，两条都返回 null 时无操作；鼠标路径（`src/link-follow.ts:330-339`，`mousedown` + `metaKey` + `posAtCoords`）与键盘路径（`src/link-follow.ts:318-321`，`link.follow` = ⌘⏎）共用这一个判定。
- **spec 侧今天**：living spec 的「标准 Markdown 链接的形态分类与 live preview 渲染」条**明文要求这些位置保持原文**——`openspec/specs/editor-live-preview/spec.md:138-139`（场景「不可用形态保持原文」的 WHEN 里列着「自动链接 `<https://…>`、裸网址、引用式链接」，THEN 是「一律原样显示 Markdown 源码……不产生任何打开入口」）与 `:129`（「引用式链接……与自动链接……SHALL 保持原文」）。**因此本 change 不是加一条新行为，而是修订一条既有 requirement**（下面「What Changes」第 1 条与 [design.md](design.md) §2 的归属论证）。
- **仓库内已有断言会因此变红**（这不是障碍，是判据已经就位）：`tests/visual/scenes/render-link.spec.ts:137-141` 断言裸 URL 与 `<…>` 自动链接保持原文、`:31-32` 的 `LINKS = 13` / `MARKS` 数组按「13 条链接」计数；fixture `tests/visual/fixtures/render-link/links.md:20` 就含这两个形态。`scripts/acceptance/scenarios/12-links.md` 的链接 fixture 不含裸 URL，不受影响。

### 三、诉求面在哪

裸 URL 在真实 vault 里密度不低（本次现场来自 CODE_OF_CONDUCT.md 一类「从模板抄来」的文档：正文写 `https://…`、末尾用 `[标签]: https://…` 收口）。今天读这类文档，链接文本配色、可点这些**读者预期都在**，实际要点开只能靠选中再手工复制——这是「看起来是链接但点不动」的一类沉默失败（M144 的注释里把这条列为 dogfood 最难归因的反馈族，`src/link-follow.ts:241-242`）。

## What Changes

1. **链接判定面从 `Link` 节点扩到 `URL` 节点**（delta：MODIFIED `editor-live-preview`「标准 Markdown 链接的形态分类与 live preview 渲染」）。判定面变为四种形态：标准链接 `[title](target)`（形态 1，行为逐条不变）、裸 URL（形态 2）、链接定义行 `[tag]: url` 的 URL 部分（形态 3）、角括号自动链接 `<https://…>`（形态 4，裁决点 D1）。**分类实现仍只有 `classifyLinkTarget` 一份**，装饰层与激活路径仍共用同一个结果——本 change 一个字不改分类口径，只扩「谁来喂它」。

2. **裸 URL 与定义行的装饰形态**：目标区间打上与标准链接显示文本同一个 `.cm-lp-link` 类，`title` 属性给出解码后的 URL，尾部追加 `↗︎` 标记（复用既有的 `LinkMarkWidget` 与同一份可见文字）。这三形态**没有可隐藏的链接源码**（URL 本身就是原文），因此不引入任何隐藏——唯一的例外是形态 4 的两个尖括号，按标准链接隐藏 `[` / `(` 的同款处理（裁决点 D1）。形态 3 只装饰 URL 部分，`[tag]: ` 前缀保持原文（裁决点 D3）。**零新 token、零新色值、零新可见文案。**

3. **激活走既有链路，不新建第二条**：`linkTargetAt` 增加一次「`URL` 节点」查询，命中的目标按 `classifyLinkTarget` 归入既有的五类之一，再交给既有的 `followLink`——外链仍经 `open_external_url` 交系统默认应用（Rust 侧 scheme 白名单与校验是唯一权威，`src-tauri` 零改动）。**键盘路径（⌘⏎）与鼠标路径（⌘-Click）共用这次判定**，因此两者同时覆盖新形态（裁决点 D5）。

4. **可装饰的前提是「节点原文带白名单 scheme」**：`www.example.com` 与裸邮箱在 GFM 里也是 `URL` 节点，但它们**没有 scheme**，`classifyLinkTarget` 会把它们判成 vault 内资产（末段带 `.com` 一类扩展名）——按资产处理就要把这两个串当 vault 内相对路径交给 Rust 校验，是明确的错误语义。这类字面 URL 因此保持原文（裁决点 D2）。

5. **边界逐条写进 spec**（下面「边界与已知限制」）：围栏 / 缩进代码块、行内代码、HTML 块与注释、frontmatter 块内的 URL 一律不装饰（**语法树天然排除**：那些上下文没有 `URL` 节点，实测见证据文件；前端 MUST NOT 另写一套上下文判定）；wikilink 渲染路径零改动（`[[x]]` 是不带 `URL` 子节点的 `Link` 节点，判据不命中）；引用式链接的**引用点** `[text][ref]` / `[ref]` 保持原文。

6. **表格 cell 内的裸 URL**（裁决点 D4）：推荐纳入，与既有的「cell 内链接照常渲染」口径一致。

7. **真机验收场景**：新增 `scripts/acceptance/scenarios/54-….md`（编号声明见 [tasks.md](tasks.md) §6）。**注意**：验收套件的 `click` 动作不支持修饰键（`docs/backlog.md:1049`），⌘-Click 在真机上无法表达——因此真机场景只能经 **⌘⏎** 触发，这使「键盘路径是否覆盖新形态」（裁决点 D5）从「顺带一致」变成真机验收的前置条件；若 D5 取备选（键盘路径排除），真机场景须整份改由 chromium 层承担。

## 须提请 Alex 节点 1 裁决的选项

六项都给了推荐项，且推荐项的形态**已经按默认写进 delta**；若裁决改成备选，delta 与 tasks 按「备选」列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | 判定面是否含角括号自动链接 `<https://…>` | **纳入**（形态 4）：判据与裸 URL 同一条（`URL` 节点 + 白名单 scheme），尖括号按 `[` / `(` 同款隐藏 | 排除：只覆盖裸 URL 与定义行两种形态（Alex 原话与 mission 的字面范围），`<…>` 保持原文 | 排除要在判据上**多加一条**分支（该 URL 的父节点是 `Autolink`），而两者是同一件事的两种写法：作者用 `<…>` 明确标出 URL，却比裸写的 URL 更不可点，是难以向用户解释的不一致。代价：M145 定下的「自动链接保持原文」一句被翻转（该句本 change 已经要动——裸网址与它同处一条场景） |
| D2 | 裸文本装饰面的 scheme 范围 | **白名单 scheme（`http` / `https` / `mailto`）**——即 `classifyLinkTarget` 同一张白名单，实现上不加收窄分支 | 严格 `http` / `https`：`mailto:` 字面形式保持原文（mission 字面口径） | 推荐项与既有分类白名单同源，零特例；`mailto:x@y` 在 `[写邮件](mailto:…)` 里今天就是可点的外链，裸写同一串却不可点同样费解。**两者都排除** `www.` 与裸邮箱（无 scheme ⇒ 会被判成 vault 内资产，见 What Changes 第 4 条），这一条没有备选 |
| D3 | 定义行 `[tag]: url` 里非 URL 部分的处理 | **只装饰 URL 部分**：`[tag]: ` 前缀保持原文，整行仍是可见文本（渲染为 `[homepage]: https://… ↗︎`） | 整行隐藏（引用式定义在阅读态不可见，接近 Obsidian 阅读视图） | 推荐项是「只在 URL 上加链接能力」的最小改动，文档几何与行数不变，零意外；整行隐藏会让文档少掉一段可见文本（滚动位置、行号、复制行为全都变），且引用点今天不渲染 ⇒ 隐藏定义行之后正文里只剩不可点的 `[text][ref]`，语义更乱。属另一个 change |
| D4 | 表格 cell 内的裸 URL 是否装饰 | **纳入**：与既有「cell 内的链接照常渲染」同口径（`src/preview/livePreview.ts:872-873` 的放行名单加一个名字，另加既有的 cell 边界防御性收窄 `:1046-1051`） | 不纳入：表格内保持原文 | 纳入后同一份文档里 cell 内外的裸 URL 行为一致；不纳入会留下第二种语义（同样的 URL，在表格里点不动）。代价：尾标会改变 cell 的内容宽度 ⇒ 表格自然宽变化，含裸 URL 的表格基线要重拍（[tests/visual/README.md](../../../../tests/visual/README.md) 的基线纪律） |
| D5 | 键盘路径 ⌘⏎ 是否同样覆盖新形态 | **覆盖**：`link.follow` 与 ⌘-Click 共用 `linkTargetAt`，两条路径行为一致 | 只覆盖鼠标路径：⌘⏎ 对新形态无操作 | 推荐项零额外实现（排除反而要按「事件来源」分流，那是 REVIEW.md 第 8 条点名的两处真源形态）；且**真机验收只有 ⌘⏎ 这一条通道**（套件的 `click` 不支持修饰键），取备选则真机场景无法建立。备选的唯一理由见 Non-goals 里的引用点边界：⌘⏎ 在定义行上生效会让人误以为引用点也能用同一个键 |
| D6 | 光标落在裸 URL 上时是否撤下装饰 | **撤下**：与「编辑态显露源码」同款判据（严格重叠），实际效果是去掉链接色与尾标 | 保留装饰（裸 URL 没有隐藏源码，编辑时保持链接外观） | 推荐项沿用既有条款、不新增第二套编辑态语义，且避免「光标停在 URL 末位时尾标还在、落点与刚敲的字符错位」这一类 widget 边界问题。备选项更直观（链接永远是链接色），代价是编辑裸 URL 时多一种「只有这一形态不显露」的例外 |

## Non-goals

- **不解析引用式链接的引用点**（`[text][ref]` / `[ref]`）：lezer 不把定义处的 URL 挂到引用点，要覆盖它必须自己实现 CommonMark 的标签匹配规则（大小写不敏感、首个定义生效、shortcut / collapsed / full 三种形态），是另一个量级的事。**这是一处要如实记账的半覆盖**：`CODE_OF_CONDUCT.md` 这类文档的正文引用点（如 `[Mozilla's code of conduct enforcement ladder][Mozilla CoC]`）在本 change 后**仍然不可点**，只有末尾定义行的 URL 可点——Alex 的原始诉求若包含正文引用点，需要另立 change（见「边界与已知限制」第 1 条）。
- **不做裸 URL 的自动链接化**：不把 `www.example.com`、裸邮箱这类无 scheme 的字面文本升级成链接（那要先决定「什么算 URL 猜测」，且与 `classifyLinkTarget` 的五类语义冲突，见 D2）。
- **不改分类口径**：五类的判据、白名单、解码规则一字不动；本 change 只扩「哪些语法树节点进这张分类表」。
- **不改 wikilink**：三态显示、span 定位、`![[…]]` 分流一律不动。
- **不隐藏定义行**（D3 备选）、**不隐藏裸 URL 的任何字符**（形态 4 的尖括号除外，D1）。
- **不新增字节通道**：`src-tauri/**` 零改动，不新增 IPC command，不开第二条打开路径。
- **不新增配置项**：本 change 无 `config.json` 面。
- **不做「链接装饰的开关」**：不提供「裸 URL 不装饰」的配置——装饰面与激活面的一致性正是 M144/M145 反复收敛的东西。

## capability 归属：为什么只有一个 capability

**结论**：本 change 的全部增量落 `editor-live-preview`（MODIFIED ×1），**不新建 capability**，**`keymap-commands` 零增量**。

理由：

1. 装饰与分类是 `editor-live-preview` 既有 requirement 的本体（`classifyLinkTarget` 是该条点名的分类唯一实现）。
2. 激活面归 `keymap-commands` 的两条 requirement（「鼠标路径的 ⌘ / ⌃ 拆分」与「链接跟随——⌘⏎ 与 ⌘-Click 同一命令」），但那两条**都以类别（外链 / 应用内笔记 / 资产 / 锚点 / 不可用）为口径、把「怎么分类」委托给 `editor-live-preview` 的链接矩阵**（`openspec/specs/keymap-commands/spec.md:509`）。裸 URL 按本 change 归入其中的**外链**类，既有 requirement 的每一句在新形态上都成立，**没有一句话变假**——因此按「规格增量只写变化」的纪律，那里不写 delta（写一份与 living 逐字相同的 MODIFIED 只是复制文本、制造漂移面）。反方如实记录：若 Alex 认为「可激活的位置面」本身需要在 keymap-commands 留痕，节点 1 可要求补一条 MODIFIED（内容是把 `:328` 的类别枚举扩为「含裸 URL / 定义行 URL」），那是一次文本复制，不引入新行为。

## Impact

- 影响的 specs：`editor-live-preview`（MODIFIED ×1：把链接 requirement 的判定面从 `Link` 节点扩到 `URL` 节点的四种形态，并翻转「自动链接 / 裸网址保持原文」那句既有条款；scenario 总数 11 条 = 新增 5 条（裸 URL 与定义行 / 角括号自动链接 / 无 scheme 字面 / 引用点 / 光标落在裸 URL 上）+ 改写 1 条（「不可用形态保持原文」）+ 逐条保留 5 条）。`keymap-commands` 零增量（理由见上）。**不改**分类规则本身。
- 影响的代码/系统（实现期，本 mission 零产品代码改动）：
  - `src/preview/links.ts`：新增「`URL` 节点的形态判定与定位」入口（形态 2 / 3 / 4 的节点识别与区间产出），分类仍走 `classifyLinkTarget`；现有 `standardLinkAt` / `standardLinkParts` 的行为不变。
  - `src/preview/livePreview.ts`：装饰分支新增一类节点（形态 2 / 3 / 4），复用 `LinkMarkWidget`、`.cm-lp-link` 与既有的选区显露判据；表格放行名单按 D4 加一个名字。
  - `src/link-follow.ts`：`linkTargetAt` 增加一次新形态查询（顺序：wikilink → 标准链接 → 新形态，互不抢）。
  - `src/style.css` / `src/preview/theme.ts`：**零改动**（复用 `.cm-lp-link` 与既有尾标样式）。
  - `src-tauri/**`：**零改动**（`grep -rn "invoke\|fs_read" ` 层面无新增）。
  - `文案-Copy.md`：**零改动**（尾标文字与链接样式都是既有可见文字的唯一来源；新形态不产生新读屏名）。
- 影响的测试/验收：
  - `tests/visual/scenes/render-link.spec.ts`：`:137-141` 四条断言里两条按新口径改写（裸 URL 的文本**仍应可见**——它没有可隐藏的源码，只是从「无装饰」变成「有装饰」；`<…>` 的尖括号变隐藏；`javascript:` 与行内代码那两条逐字不动）；`:31-32` 的 `LINKS` / `MARKS` 计数与顺序按实际装饰数更新（D1 取推荐项时 +2）；新增「新形态装饰 + ⌘-Click 打开 + ⌘⏎ 打开 + 无 scheme 字面保持原文 + 引用点保持原文 + 光标显露」断言组。⌘-Click 在 chromium 里可用合成 `mousedown`（`metaKey: true` + `clientX/Y`，`posAtCoords` 同一条路径）触发——既有先例 `tests/visual/scenes/typography.spec.ts:484` / `:547-558`。
  - `tests/visual/fixtures/render-link/links.md`：`:20` 那行按新口径保留（它同时是「裸 URL 装饰」与「自动链接装饰」的现场），按需补 `www.` / 裸邮箱 / 定义行 / 引用点四条现场。
  - `scripts/acceptance/scenarios/54-<slug>.md` + fixture（编号声明见 [tasks.md](tasks.md) §6）：经 `⌘⏎` 触发（套件无法表达 ⌘-Click），断言走既有通道——`editor` 文本（装饰态含尾标）+ `env:logs/*.jsonl` 的 `link_open`（`category=external` / `outcome=opened`，`12-links` 已有同款断言）+ `unchangedSince` 不改写源文件。
  - `scripts/acceptance/scenarios/12-links.md`：现有 fixture 不含裸 URL，预期零改动；实现期复核一遍（若 fixture 补了现场，同步加断言）。
- 影响的文档：`docs/specs/foundation-markdown.md` 无裸 URL 相关表述（grep 零命中「裸 / autolink」），预期零改动；`docs/backlog.md` 的「链接渲染与激活（全形态）」条目（`:1728` 起）在实现期补一句「裸 URL 与定义行纳入判定面」。
- 视觉基线：`render-link` 场景的输出必然变化（新增装饰与尾标）⇒ 该场景基线要重拍。**基线更新是人肉裁决点**：实现期按 [tests/visual/README.md](../../../../tests/visual/README.md) 与 AGENTS.md 的视觉门禁卫生先出对比截图请 Alex 过目，再 `--update-snapshots=all`；并 `grep -rln` 定位其余含裸 URL 的 fixture，逐张核对时间戳与内容判据（删/改元素级变化曾静默假绿的教训）。
- 关联约束：ADR 0003 §3（装饰不改文档——全部形态都断言 `EditorState.doc` 与磁盘逐字节不变）；ADR 0002 §6（性能合同——新分支只多在视口内的语法树遍历里认一种节点，不引入全文档扫描，装饰层视口增量纪律不变）；ADR 0002 §3（webview 不直接访问文件系统——外链仍只经 `open_external_url`）；ADR 0006（键盘路径 ⌘⏎ 同源覆盖，见 D5）；ADR 0004 第 5 条（功能变更走 OpenSpec）。

## 边界与已知限制

1. **半覆盖（要如实记账，也是最可能被回头追问的一条）**：本 change 只让**定义行的 URL** 可点，**引用点** `[text][ref]` / `[ref]` 仍不可点。现场文件 `CODE_OF_CONDUCT.md` 的正文里恰好有 `[Mozilla's code of conduct enforcement ladder][Mozilla CoC]` 这类引用点——若 Alex 的实际诉求是「正文里那些链接也能点」，本 change 只解决一半，需要在节点 1 明确：接受半覆盖（引用点另立 change），还是本 change 内一并覆盖（体量翻倍，见 Non-goals）。
2. **无 scheme 的字面 URL 不装饰**（`www.example.com` / 裸邮箱 / `xmpp:`）：不是漏做，是分类语义决定的（见 What Changes 第 4 条）。这一条要写进 spec 的保持原文清单，避免以后被当成 bug 回头修成「猜 URL」。
3. **`mailto:` 裸字面形式会被装饰**（D2 取推荐项时）：点开由系统默认邮件客户端承担；这与 `[写邮件](mailto:…)` 今天的终点一致。
4. **真机只能验 ⌘⏎**：套件的 `click` 动作不支持修饰键，⌘-Click 这条路径的真机行为**不在验收套件覆盖范围内**（chromium 层用合成 `mousedown` 覆盖）。这是套件的既有边界（`docs/backlog.md:1049`），不是本 change 引入的。
5. **行尾标点**：GFM 的 autolink 字面量本身会剥掉句末的 `.` / `,` 一类标点（实测 `https://x.` 的 `URL` 节点不含最后那个句点），因此「句末裸 URL」不会把句号吞进链接——这是 GFM 口径，本 change MUST NOT 自行改写。
6. **URL 里的 `#fragment`**：裸 URL 的节点原文含 `#…`（实测），与标准链接的 `<url>` / 尖括号包裹形态一致，交给 Rust 侧打开；本 change MUST NOT 在前端切锚点。

## 裁决记录

**Alex 节点 1（2026-09-27）原话（逐字）**：

> 「# bare-url-cmd-click 采纳建议。」

即 D1–D6 六项**全部按推荐项**落地（D1 纳入角括号自动链接、D2 白名单 scheme 含 `mailto:`、
D3 只装饰定义行的 URL 部分、D4 纳入表格 cell 内的裸 URL、D5 ⌘⏎ 同源覆盖新形态、D6 编辑态
撤下装饰），delta 与 `tasks.md` **未按「裁决改写指引」改写**。

实现合并执行归 M272（与 `enter-auto-indent` 同批）。实现期实测到并已修正的两处落点事实
（末位端点取不到 URL、定义行前缀不是链接本体）登记在 `tasks.md` 的「实现台账」节；真机场景
54 的 PASS 证据与其两轮先红后绿的现场同在 `test-results/m272/`（git 外）。
