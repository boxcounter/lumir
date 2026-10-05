# editor-live-preview 增量规格

## MODIFIED Requirements

### Requirement: 标准 Markdown 链接的形态分类与 live preview 渲染

md 模式下的链接判定 SHALL 取自 lezer 语法树（`src/editor.ts` 的 `markdownConfig` = `markdownLanguage` + `GFM`）里的 `URL` 节点，判定面 SHALL 覆盖四种节点形态：

1. **标准链接** `[title](target)`：`Link` 节点的 `URL` 子节点（M144 / M145 落地，本 change 后逐条不变）。
2. **裸 URL**：正文流里的 `http:` / `https:` / `mailto:` 字面 URL——GFM 的 `Autolink` 扩展把它直接产出为一个 `URL` 节点（父节点既不是 `Link` 也不是 `Image`），段落、列表项与引用块内一视同仁；表格 cell 内同样装饰是裁决点 D4 的推荐项（取备选时按 [proposal.md](../../proposal.md) 的改写指引收窄）。
3. **链接定义行** `[tag]: url`：`LinkReference` 节点的 `URL` 子节点（`[tag]: ` 前缀是同一节点的 `LinkLabel` 与 `LinkMark`）。
4. **角括号自动链接** `<https://…>`：`Autolink` 节点的 `URL` 子节点（尖括号是同一节点的两个 `LinkMark`）。判据与形态 2 同一条——这是裁决点 D1 的推荐项，取备选（排除本形态）时本款整条删除。

本 requirement 的名称沿用 M144 的标题，作为 requirement 的稳定身份（归档合并按标题匹配）——标题里的「标准 Markdown 链接」是 M144 引入时的措辞，本 change 后其判定面是上面四种形态，不再限于 `[title](target)` 一种。

分类 SHALL 仍只有前端一份实现（`src/preview/links.ts` 的 `classifyLinkTarget`），装饰层与激活路径共用同一个结果；下面五类分类与各款口径对本 requirement 的全部四种形态同等适用：

1. **外链**：目标带 `http` / `https` / `mailto` scheme（大小写不敏感）→ 渲染为显示文本 `title` 加尾部标记 `↗︎`（U+2197 后跟 U+FE0E 变体选择符 VS15，强制文字表现而非 emoji）。
2. **应用内笔记**：目标无 scheme 且路径段（丢掉 `#fragment` 后）末段以 `.md` 结尾**或没有扩展名** → 渲染为 `title` 加尾部标记 `→`（U+2192）。
3. **vault 内资产**：目标无 scheme 且路径段末段是其它扩展名，或路径段以 `/` 结尾（目录）→ 渲染为 `title` 加尾部标记 `↗︎`——语义是「这一下会离开本应用」。
4. **纯锚点**：目标以 `#` 开头 → 渲染为 `title` 加尾部标记 `→`。
5. **不可用**：schema 不在白名单内（`javascript:` / `file:` / 应用自定义协议）、目标为空、或目标解码后含控制字符 → SHALL 保持原文，MUST NOT 有任何装饰（没有链接样式、没有尾标、没有 `title` 属性）。

形态 1 的 `title` SHALL 取 `[` 与 `]` 之间的显示文本；`[`、`]` 与 `(target)` 三段源码 SHALL 被装饰隐藏，MUST NOT 出现在渲染态。隐藏与标记 SHALL 只存在于装饰层：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律），装饰层的视口增量纪律不变。

**形态 2 / 3 / 4 的装饰形态**：目标区间 SHALL 被标记为链接（`src/preview/theme.ts:611` 的 `.cm-lp-link`，与标准链接的显示文本同一类，零新 token、零新色值），`title` 属性给出解码后的 URL，尾部 SHALL 追加 `↗︎` 标记 widget（与标准链接的外链尾标同一份实现、同一份可见文字）。这三种形态**没有可隐藏的链接源码**（URL 本身就是原文）——MUST NOT 为「看起来像标准链接」而额外隐藏任何字符；唯一的例外是形态 4 的两个尖括号，按标准链接的 `[` / `(` 同款隐藏（尖括号是语法定界符，不是目标的一部分）。形态 3 SHALL 只装饰 URL 部分：`[tag]: ` 前缀属定义行的语法，SHALL 保持原文（整行隐藏是另一个形态，见 [proposal.md](../../proposal.md) 的 Non-goals 与裁决点 D3）。

**形态 2 / 3 / 4 的可装饰前提是「节点原文带白名单 scheme」**（`http` / `https` / `mailto`，大小写不敏感）：GFM 的字面 URL 形态里 `www.example.com` 与裸邮箱 `a@b.example.com` **没有 scheme**，`classifyLinkTarget` 会把它们判成 vault 内资产（末段带 `.com` 一类的扩展名），而按资产处理意味着把这两个串当 vault 内相对路径交给 Rust 校验——那是错误的语义。因此这类无 scheme 的字面 URL SHALL 保持原文，MUST NOT 装饰、MUST NOT 产生打开入口（判据是「有没有 scheme」这条硬事实，不是「像不像 URL」的猜测）。

**保持原文（不装饰、无打开入口、语法树上下文天然排除——前端 MUST NOT 另写一套上下文判定）的形态**（逐条为不变量）：引用式链接的**引用点** `[text][ref]` / `[ref]`（lezer 不把定义处的 URL 挂到引用点，拿不到目标就不该猜——本 change 只装饰定义行那一侧的 URL）；白名单外 scheme（`javascript:` / `file:` / 应用自定义协议，含 GFM 字面形态能产出的 `xmpp:`）；**大写字面的 scheme**（`HTTPS://…`——GFM 的字面自动链接只认小写 `http://` / `https://` / `mailto:`，那种写法根本不产出 `URL` 节点，因此同样保持原文；这是上游语法树的结论，不是本 change 的收窄，分类实现本身仍是大小写不敏感的，`[x](HTTPS://…)` 照旧可点）；行内代码、围栏代码块与缩进代码块（这些上下文里的节点是 `CodeText` / `InlineCode`，没有 `URL` 节点）；HTML 块与 HTML 注释（同样没有 `URL` 节点）；frontmatter 块（由既有的 frontmatter 剪枝排除——语法树本身不认识 frontmatter，这一条是剪枝顺序的产物，MUST NOT 依赖「语法树会排除它」）。

目标 SHALL 经被装饰的链接元素的 `title` 属性保留可取（悬停可见、读屏可取）——外链接解码后的 URL，其余类别给目标原文；源码里的目标被隐藏后，信息 MUST NOT 丢失。标记自身 SHALL 是装饰性元素（`aria-hidden`），MUST NOT 成为无名的可读内容。

**分类判据只看目标原文，不看文件是否存在**（装饰与激活解耦）：解析得到吗、能不能打开，都是激活时才问的问题。因此「目标不存在」的链接照常装饰，代价由激活路径的人话提示承担，而不是让渲染层去猜。

光标或选区触及该链接时，系统 SHALL 显露整条链接的源码（含括号、目标与显示文本内的强调标记），显露口径与既有 callout 首行的源码显露一致：编辑态下作者看到的仍是原文，且长目标被隐藏后 MUST NOT 在链接中间产生「按键而光标不动」的死区。显露由选区驱动的装饰重建实现，MUST NOT 改写文档。对形态 2 / 3 / 4 而言「源码」就是 URL 原文本身（形态 4 含尖括号），显露的实际效果是撤下链接样式与尾标——判据与标准链接同款（严格重叠），MUST NOT 另立一套编辑态语义。

本 requirement MUST NOT 改变 wikilink（`[[…]]`）的渲染路径：三态显示、span 定位与 `![[…]]` 的附件/嵌入分流一律不动。`[[x]]` 在语法树里是一个不带 `URL` 子节点的 `Link` 节点，本 requirement 的 `URL` 判据天然不命中它。

本 change MUST NOT 改变标准链接（形态 1）的任何既有行为：五类分类、`title` 属性、三段源码隐藏、尾标、光标显露、表格 cell 内照常渲染、未转义管道符处保持原文——逐条不变，并由既有断言（`tests/visual/scenes/render-link.spec.ts`、`scripts/acceptance/scenarios/12-links.md`）守。

#### Scenario: 外链与应用内链接各自渲染出正确的标记

- **WHEN** 打开一份含 `[示例站点](https://example.invalid/site)`、`[写邮件](mailto:someone@example.invalid)`、`[包裹形式](<https://example.invalid/wrapped>)`、`[本地笔记](note.md)`、`[上层笔记](../top.md)`、`[配置](配置)`、`[说明书](docs/manual.pdf)`、`[资料目录](docs/)` 与 `[去标题](#链接)` 的 Markdown
- **THEN** 前三条渲染为显示文本加尾部 `↗︎`，`[本地笔记]`、`[上层笔记]`、`[配置]`、`[去标题]` 渲染为显示文本加尾部 `→`，`[说明书]` 与 `[资料目录]` 渲染为显示文本加尾部 `↗︎`；所有目标源码在渲染态不可见，`title` 属性给出对应目标，文档内容逐字节不变

#### Scenario: 裸 URL 与链接定义行各自装饰为外链

- **WHEN** 打开一份含 `正文里的 https://example.invalid/bare 是裸 URL。` 与 `[homepage]: https://example.invalid/home` 两行的 Markdown
- **THEN** 第一个 URL 上屏为带链接样式的 `https://example.invalid/bare`（文本本身保持可见，因为它就是原文）并在其后出现 `↗︎`；第二行的 URL 部分同样带链接样式与 `↗︎`，而 `[homepage]: ` 前缀保持原文；两处的 `title` 属性分别是两个解码后的 URL；`EditorState.doc` 与磁盘文件逐字节不变

#### Scenario: 角括号自动链接装饰为外链

- **WHEN** 打开一份含 `<https://example.invalid/angle>` 的 Markdown（裁决点 D1 取推荐项时适用）
- **THEN** 上屏为 `https://example.invalid/angle` 加尾部 `↗︎`——两个尖括号被装饰隐藏，与标准链接隐藏 `[` / `(` 同款；光标触及该节点时尖括号随原文显露

#### Scenario: 无 scheme 的字面 URL 保持原文

- **WHEN** 同一份文档里含 `www.example.invalid`、裸邮箱 `someone@example.invalid` 与 `xmpp:someone@example.invalid`
- **THEN** 三处一律原样显示，没有链接样式、没有尾标、不产生任何打开入口（前两者没有 scheme，会被归类为 vault 内资产——那是错误的语义；后者 scheme 不在白名单内）；激活路径在同样位置上 SHALL 无操作，MUST NOT 产生任何打开请求

#### Scenario: 引用式链接的引用点保持原文

- **WHEN** 文档里有 `[正文][ref]` 与 `[ref]` 两个引用点，以及 `[ref]: https://example.invalid/ref` 定义行
- **THEN** 两个引用点一律原样显示、不产生打开入口（lezer 不把定义处的 URL 挂到引用点）；定义行的 URL 部分装饰为外链（本 change 的范围）；文档逐字节不变

#### Scenario: 不可用形态保持原文

- **WHEN** 同一份文档里含 `[别开我](javascript:alert(1))`、行内代码里的 `` `[代码里的](https://example.invalid/code)` ``、围栏代码块里的 `https://example.invalid/in-fence` 与 HTML 注释里的 `<!-- https://example.invalid/in-comment -->`
- **THEN** 这些位置一律原样显示 Markdown 源码，没有链接样式、没有尾标，也不产生任何打开入口（代码块与 HTML 上下文由语法树天然排除：那些位置的节点是 `CodeText` / `CommentBlock`，没有 `URL` 节点）

#### Scenario: 目标不存在的链接照常装饰

- **WHEN** 文档里含 `[不存在的笔记](missing.md)`，而 vault 里没有这个文件
- **THEN** 该链接照常渲染为 `不存在的笔记` + `→`（分类只看目标原文），vault 里 MUST NOT 因此出现新文件

#### Scenario: 光标落在链接上显露源码

- **WHEN** 把光标移到某条链接的显示文本内
- **THEN** 该链接整条显露源码（`[示例站点](https://example.invalid/site)`、`[本地笔记](note.md)` 同样），其余链接仍是渲染态；光标移开后又恢复渲染态，两种状态下 `EditorState.doc` 都不变

#### Scenario: 光标落在裸 URL 上撤下装饰

- **WHEN** 把光标移进 `正文里的 https://example.invalid/bare 是裸 URL。` 里的 URL 中间，随后把光标移开
- **THEN** 光标在 URL 内时该处的链接样式与 `↗︎` 尾标撤下（呈现为普通正文文本），移开后恢复；两种状态下 URL 原文都在场、`EditorState.doc` 逐字节不变；光标停在 URL 的**末位**时 MUST NOT 出现「按键而光标不动」的死区（尾标是插在正文流中的 widget，落点手感由实现期实测钉住）

#### Scenario: 表格 cell 内的链接

- **WHEN** 链接出现在 grid 表格的某个 cell 内，且整条链接落在该 cell 内
- **THEN** 该链接照常渲染为 `title` + 与其类别对应的标记，同一行其余 cell 的内容不受影响（表格仍是 grid）

#### Scenario: 链接标题里的未转义管道符

- **WHEN** 链接标题里出现**未转义**的管道符（`| [x | y](https://example.invalid) |`）
- **THEN** 该行被管道符切成两个 cell、该处不再是一个链接（词法层面即不成立），因此保持原文不装饰；系统 MUST NOT 猜测修复这条链接，表格自身按表格合同处置（cell 数多于表头 → 整块降级）
