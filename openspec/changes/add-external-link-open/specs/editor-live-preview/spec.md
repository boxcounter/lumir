# editor-live-preview Specification

## ADDED Requirements

### Requirement: 标准 Markdown 链接的形态分类与 live preview 渲染

md 模式下，标准 Markdown 链接 `[title](target)`（lezer 语法树的 `Link` 节点 + `URL` 子节点，非引用式、非自动链接、非图片）SHALL 按其**目标原文**归入五类之一，分类实现 SHALL 只有前端一份（`src/preview/links.ts` 的 `classifyLinkTarget`），装饰层与激活路径共用同一个结果：

1. **外链**：目标带 `http` / `https` / `mailto` scheme（大小写不敏感）→ 渲染为显示文本 `title` 加尾部标记 `↗︎`（U+2197 后跟 U+FE0E 变体选择符 VS15，强制文字表现而非 emoji）。
2. **应用内笔记**：目标无 scheme 且路径段（丢掉 `#fragment` 后）末段以 `.md` 结尾**或没有扩展名** → 渲染为 `title` 加尾部标记 `→`（U+2192）。
3. **vault 内资产**：目标无 scheme 且路径段末段是其它扩展名，或路径段以 `/` 结尾（目录）→ 渲染为 `title` 加尾部标记 `↗︎`——语义是「这一下会离开本应用」。
4. **纯锚点**：目标以 `#` 开头 → 渲染为 `title` 加尾部标记 `→`。
5. **不可用**：schema 不在白名单内（`javascript:` / `file:` / 应用自定义协议）、目标为空、或目标解码后含控制字符 → SHALL 保持原文，MUST NOT 有任何装饰（没有链接样式、没有尾标、没有 `title` 属性）。

`title` SHALL 取 `[` 与 `]` 之间的显示文本；`[`、`]` 与 `(target)` 三段源码 SHALL 被装饰隐藏，MUST NOT 出现在渲染态。隐藏与标记 SHALL 只存在于装饰层：`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律），装饰层的视口增量纪律不变。

目标 SHALL 经被装饰的链接元素的 `title` 属性保留可取（悬停可见、读屏可取）——外链接解码后的 URL，其余类别给目标原文；源码里的目标被隐藏后，信息 MUST NOT 丢失。标记自身 SHALL 是装饰性元素（`aria-hidden`），MUST NOT 成为无名的可读内容。

**分类判据只看目标原文，不看文件是否存在**（装饰与激活解耦）：解析得到吗、能不能打开，都是激活时才问的问题。因此「目标不存在」的链接照常装饰，代价由激活路径的人话提示承担，而不是让渲染层去猜。

光标或选区触及该链接时，系统 SHALL 显露整条链接的源码（含括号、目标与显示文本内的强调标记），显露口径与既有 callout 首行的源码显露一致：编辑态下作者看到的仍是原文，且长目标被隐藏后 MUST NOT 在链接中间产生「按键而光标不动」的死区。显露由选区驱动的装饰重建实现，MUST NOT 改写文档。

行内代码与围栏代码块内的链接 SHALL NOT 渲染（语法树上下文天然排除，前端 MUST NOT 另写一套上下文判定）。

本 requirement MUST NOT 改变 wikilink（`[[…]]`）的渲染路径：三态显示、span 定位与 `![[…]]` 的附件/嵌入分流一律不动。引用式链接（`[text][ref]` / `[ref]`）与自动链接（`<https://…>`）SHALL 保持原文：前者 lezer 不把定义处的 URL 挂到引用点、拿不到目标，后者不是 `[title](target)` 形态。

#### Scenario: 外链与应用内链接各自渲染出正确的标记

- **WHEN** 打开一份含 `[示例站点](https://example.invalid/site)`、`[写邮件](mailto:someone@example.invalid)`、`[包裹形式](<https://example.invalid/wrapped>)`、`[本地笔记](note.md)`、`[上层笔记](../top.md)`、`[配置](配置)`、`[说明书](docs/manual.pdf)`、`[资料目录](docs/)` 与 `[去标题](#链接)` 的 Markdown
- **THEN** 前三条渲染为显示文本加尾部 `↗︎`，`[本地笔记]`、`[上层笔记]`、`[配置]`、`[去标题]` 渲染为显示文本加尾部 `→`，`[说明书]` 与 `[资料目录]` 渲染为显示文本加尾部 `↗︎`；所有目标源码在渲染态不可见，`title` 属性给出对应目标，文档内容逐字节不变

#### Scenario: 不可用形态保持原文

- **WHEN** 同一份文档里含 `[别开我](javascript:alert(1))`、自动链接 `<https://example.invalid/auto>`、裸网址、引用式链接与行内代码里的 `` `[代码里的](https://example.invalid/code)` ``
- **THEN** 这些位置一律原样显示 Markdown 源码，没有链接样式、没有尾标，也不产生任何打开入口

#### Scenario: 目标不存在的链接照常装饰

- **WHEN** 文档里含 `[不存在的笔记](missing.md)`，而 vault 里没有这个文件
- **THEN** 该链接照常渲染为 `不存在的笔记` + `→`（分类只看目标原文），vault 里 MUST NOT 因此出现新文件

#### Scenario: 光标落在链接上显露源码

- **WHEN** 把光标移到某条链接的显示文本内
- **THEN** 该链接整条显露源码（`[示例站点](https://example.invalid/site)`、`[本地笔记](note.md)` 同样），其余链接仍是渲染态；光标移开后又恢复渲染态，两种状态下 `EditorState.doc` 都不变

#### Scenario: 表格 cell 内的链接

- **WHEN** 链接出现在 grid 表格的某个 cell 内，且整条链接落在该 cell 内
- **THEN** 该链接照常渲染为 `title` + 与其类别对应的标记，同一行其余 cell 的内容不受影响（表格仍是 grid）

#### Scenario: 链接标题里的未转义管道符

- **WHEN** 链接标题里出现**未转义**的管道符（`| [x | y](https://example.invalid) |`）
- **THEN** 该行被管道符切成两个 cell、该处不再是一个链接（词法层面即不成立），因此保持原文不装饰；系统 MUST NOT 猜测修复这条链接，表格自身按表格合同处置（cell 数多于表头 → 整块降级）
