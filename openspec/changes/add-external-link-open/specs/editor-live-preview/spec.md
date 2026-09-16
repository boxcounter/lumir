# editor-live-preview Specification

## ADDED Requirements

### Requirement: 标准 Markdown 外链的 live preview 渲染

md 模式下，标准 Markdown 链接 `[title](url)` 的目标 scheme 属于外链白名单（`http` / `https` / `mailto`，大小写不敏感）时，系统 SHALL 把它渲染为显示文本 `title` 加一个尾部标记 `↗︎`（U+2197 后跟 U+FE0E，变体选择符 VS15 强制文字表现而非 emoji）；`title` SHALL 取 `[` 与 `]` 之间的显示文本，`[`、`]` 与 `(url)` 三段源码 SHALL 被装饰隐藏，MUST NOT 出现在渲染态。隐藏与标记 SHALL 只存在于装饰层：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律），装饰层的视口增量纪律不变。

`url` 原文 SHALL 经被装饰的链接元素的 `title` 属性保留可取（悬停可见、读屏可取）——源码里的 URL 被隐藏后，信息 MUST NOT 丢失；`↗︎` 标记自身 SHALL 是装饰性元素（`aria-hidden`），MUST NOT 成为无名的可读内容。

光标或选区触及该链接时，系统 SHALL 显露整条链接的源码（含括号、URL 与显示文本内的强调标记），显露口径与既有 callout 首行的源码显露一致：编辑态下作者看到的仍是原文（改动前没有任何链接装饰，编辑 URL 时看到的就是原文），且长 URL 被隐藏后 MUST NOT 在链接中间产生"按键而光标不动"的死区。显露由选区驱动的装饰重建实现，MUST NOT 改写文档。

非外链形态 SHALL 保持原文、不做任何装饰：相对路径（`[x](note.md)`）、纯锚点（`[x](#h)`）、scheme 不在白名单内的链接（`javascript:` / `file:` / 应用自定义协议）、尖括号自动链接（`<https://…>`）、裸网址、引用式链接（`[text][ref]` 与 `[ref]`，lezer 不把定义处的 URL 挂到引用点）。行内代码与围栏代码块内的链接 SHALL NOT 渲染（语法树上下文天然排除，前端 MUST NOT 另写一套上下文判定）。

本 requirement MUST NOT 改变 wikilink（`[[…]]`）的渲染路径：三态显示、span 定位与 `![[…]]` 的附件/嵌入分流一律不动。

#### Scenario: 外链渲染为 title + ↗︎ 且 URL 被隐藏

- **WHEN** 打开一份含 `[示例站点](https://example.invalid/site)`、`[写邮件](mailto:someone@example.invalid)` 与 `[包裹形式](<https://example.invalid/wrapped>)` 的 Markdown
- **THEN** 三处都渲染为显示文本加尾部 `↗︎` 标记，源码里的 `https://example.invalid/site` 等 URL 在渲染态不可见，链接元素的 `title` 属性给出对应的 URL，文档内容逐字节不变

#### Scenario: 光标落在链接上显露源码

- **WHEN** 把光标移到某条外链的显示文本内
- **THEN** 该链接整条显露源码（`[示例站点](https://example.invalid/site)`），其余外链仍是渲染态；光标移开后又恢复渲染态，两种状态下 `EditorState.doc` 都不变

#### Scenario: 非外链形态保持原文

- **WHEN** 同一份文档里含相对路径 `[本地笔记](note.md)`、纯锚点 `[去标题](#外链)`、白名单外 scheme `[别开我](javascript:alert(1))`、裸网址与自动链接 `<https://example.invalid/auto>`、行内代码里的 `` `[代码里的](https://example.invalid/code)` ``
- **THEN** 这些位置一律原样显示 Markdown 源码，没有链接样式、没有 `↗︎` 标记，也不产生任何打开入口

#### Scenario: 表格 cell 内的外链

- **WHEN** 外链出现在 grid 表格的某个 cell 内，且整条链接落在该 cell 内
- **THEN** 该链接照常渲染为 title + `↗︎`，同一行其余 cell 的内容不受影响（表格仍是 grid）

#### Scenario: 链接标题里的未转义管道符

- **WHEN** 链接标题里出现**未转义**的管道符（`| [x | y](https://example.invalid) |`）
- **THEN** 该行被管道符切成两个 cell、该处不再是一个链接（词法层面即不成立），因此保持原文不装饰；系统 MUST NOT 猜测修复这条链接，表格自身按表格合同处置（cell 数多于表头 → 整块降级）
