# Design: harness 面板里的 vault 路径可点击打开（新标签 + 行定位）

- Change ID: harness-path-link
- 日期: 2026-10-17

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点均为起草时在工作分支
（基于 master `81e4db01`）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 正文行内渲染入口 | `src/harness-panel.ts:2426` `renderInlineNode`；文本间隙在 `renderInlineChildren`（`:2401`）里直接落地 | 路径链接化的插入点 |
| 行内代码 / 链接 / 裸 URL 分支 | 同文件 `:2446`（InlineCode）、`:2456`（Link / Autolink）、`:2469`（URL）、`:2414`（`createLinkEl`） | 链接化范围与「不产嵌套锚」的判据 |
| 代码块 | 同文件 `renderBlock` 的 FencedCode / CodeBlock（`:2636` / `:2647`） | 明确不链接化 |
| 工具参数 → 展示文本 | 同文件 `keyArgOf`（`:2218`，`args.path` 在 `:2232`）、`humanizeToolArgs`（`:2253`）、`toolArgsText`（`:2288`）、`diffPathOf`（`:2294`）、`approvalArgsText`（`:2357`） | 卡片路径的结构化来源 |
| 工具行 / 批准卡渲染 | 同文件 `createToolText`（`:5164`）、`appendToolCall`（`:5285`）、`appendApproval`（`:5554`，参数格在 `:5577` / `:5582`）、恢复行 `:6284` | 卡片路径可点的接线点 |
| 唯一打开链路 | `src/main.ts:1931` `openFile`（intent `"new"` / `"current"`） | 落点 = 新标签 |
| 打开分类 | `src/tree.ts:222` `openKind` | md / code / text / binary 分流 |
| 行跳转原语 | `src/editor.ts:2297` `revealLineAt`（`EditorView.scrollIntoView(pos, { y: "center" })`） | 行定位复用同一落点 |
| TOC 跳转 | `src/toc.ts:665` `jumpTo`（dispatch 在 `:674`–`:677`），`toggle` 的「可见后再滚一次」在 `:486` | 捕获语义对齐、二次滚动先例 |
| WKWebView 滚动怪癖 | `src/editor.ts` `healCollapsedReveal`（注释起点 `:339`） | 首轮 `scrollIntoView` 可能停在半路的既有依据 |
| 阅读位置捕获 | `src/reading-position.ts:248` `scrolled`，早退在 `:256`（`viewportTransitionInFlight`） | CL-2 的唯一消费点 |
| 让位窗口 | `src/viewport-transition.ts`（纯计数器）；开窗器 `src/scroll-position-view.ts:35` `duringViewportTransition`（**下一帧**关窗） | 跳转必须经它 |
| vault 文件索引 | `src/main.ts:1014` / `:2866`（装载时由 `FsEntry[]` 建出）、`:2917`（watch 增量经 `patchAttachmentPaths`，`:1034` 现被附件解析消费） | 存在性校验的数据源 |
| 索引条目形态 | `src/bindings/FsEntry.ts`（`path` / `kind` / `lazy`） | 只认 `kind === "file"` 且 `!lazy`；目录天然排除 |
| 后端路径边界 | `src-tauri/src/fs_io.rs:812` `resolve_in_vault`；`fs_paths_exist`（`src-tauri/src/commands.rs:871`） | 作为「另一条候选通道」被否，理由见 §2.3 |
| 系统上下文装配 | `src-tauri/src/harness/context.rs:44` `QUOTE_REFERENCE`、`:100` `assemble_system`、`AssemblySource` 清单 | prompt 纪律段的同构先例 |

## 1. 扫描证据（识别规则的输入）

只读扫描本机 harness 会话留存的 `llm_response` 文本，统计候选形态（脚本临时编写、未入库；本文
不落任何真实路径样例，只留形态与计数）：

- 非空 agent 回复 158 条；含路径候选 61 条（38%）；含**能解析到 vault 文件**的路径 9 条（5%）。
- 候选按形态：

| 形态 | 次数 | 存在性校验后 |
|---|---|---|
| 中文行文里的对照式斜杠（中文词以 `/` 并列） | 105 | 全部不命中 |
| 反引号内的仓库相对路径（vault 外） | 34 | 全部不命中 |
| 围栏代码块里的相对串 | 6 | 全部不命中 |
| vault 外绝对路径 | 12 | 按已裁策略不链接化 |
| vault 内文件（纯文本 8 / 行内代码 4） | 12 | 可链接化 |
| vault 内目录（行内代码 7 / 围栏 1） | 8 | 按已裁策略不链接化 |
| 带 `:行号` 或 `:行号:列号` 后缀 | 0 | 规则靠 prompt 培养 |

结论：**候选必须允许中文**（否则漏真引用）；**存在性校验足以滤掉噪音**（145 条相对噪音候选
〔105 + 34 + 6〕全部不命中，无需「像不像路径」的启发式）；目录占命中数的 8/20，是 v1 明确排除
的面；样本里行号后缀出现 0 次，说明行号规则要靠系统提示培养使用习惯，不是从现有行为里归纳出来的。

## 2. 识别规则（候选宽、校验严）

### 2.1 候选单元

- **路径字符**：字母（含中文等非 ASCII 字母）、数字、`_`、`.`、`-`、`/`。空白、引号、括号、中文
  标点（`。，、；：！？` 等）不是路径字符，天然构成候选边界。
- **候选必须至少含一个 `/` 或一个 `.`**（`.md` 这类裸文件名要能命中；纯中文词不会因「含中文」
  就成为候选）。
- **行号后缀**：候选 run 之后紧跟 `:N` 或 `:N:M`（`N`、`M` 为十进制数字）时，后缀属于同一次点击
  的可点范围；`N` 是 1-based 行号，`M` 按列解析、v1 不参与落点（proposal 起草期取值 1）。
- **拒绝形态**（在查索引之前结构性拒绝）：以 `/` 或 `~/` 开头；任一段为 `..`；空段（`a//b`）。
  这些候选来自模型输出，按不可信输入处理。

### 2.2 中文紧邻路径的边界收缩（扫描暴露的真问题）

中文行文不空格：「见docs/notes.md里的内容」整段是**一个**路径字符 run（`见docs/notes.md里的内容`）。
若只把整个 run 当候选，存在性校验会把真引用也滤掉。因此：

1. 先试整个 run；
2. 未命中时，**只从两端收缩**（左侧逐字剥 CJK 字符；右侧逐字剥 CJK 字符与句末的 `.`——其余句读不是
   路径字符，本就把 run 断开了），按「总收缩量最小、命中串最长」的顺序试；
3. 命中即止；一次 run 最多产出**一个**链接（避免同一串被切成两段）。

只从两端收缩、不在中间开刀，是因为中文既可能出现在文件名里也可能紧贴路径外侧：`见中文/笔记.md的`
→ 全串不命中，左剥「见」、右剥「的」后命中 `中文/笔记.md`；而文件本身含中文时，全串先命中，不会
被剥坏。run 长度设上限（约 120 字符），超限的 run 直接跳过并登记为已知边界（极长无断句中文串里的
路径不识别）——这是性能与可预测性的取舍，不影响正常行文。

### 2.3 存在性校验：内存文件索引，不是 IPC

候选 → **当前 vault 的文件索引**成员判定，同步、零 IPC、零额外解析。单一真源是装配层已有的文件
路径表（现名 `attachmentPaths`：装载时由 `FsEntry[]` 建出、watch 增量经 `patchAttachmentPaths`
维护——删除移除、惰性条目不入、非文件不入）。本 change 把它**改名为 `vaultFilePaths`**（语义即
「vault 内非惰性文件集」，附件解析继续消费同一份），面板在 `vaultChanged` 与增量通知时把它派生为
`Set` 供逐候选查询——不另维护一套集合语义（REVIEW.md「同一语义两处真源」条）。

可点目标再限定为**可打开的文件**：`openKind(path) !== "binary"`（分类注册表 `src/tree.ts:222` 是
既有唯一真源）。图片与已知二进制类型的引用点开只会得到既有的「暂不支持预览」提示，是死路，保持
纯文本。

为什么不逐条调后端 `fs_paths_exist`：

- 它只回答「存在」，不区分文件 / 目录（`fs_io::paths_exist` 只做 `resolve_in_vault`），而 v1 要求
  「仅文件链接化」；
- 它必须逐轮 IPC，而路径识别发生在**流式渲染路径**上（尾块每帧重渲），逐帧 IPC 既违背性能合同
  也必然引入异步闪烁；
- 内存索引的已知边界（惰性文件不入）与附件解析完全同源，是有先例、可解释的边界，不是新漏洞。

已知边界（写进 spec 场景之外的实现注释与验收「覆盖边界」）：索引按原始大小写精确匹配（macOS 大小写
不敏感文件系统上，大小写不一致的引用不链接化）；`vault_create` 刚创建的文件要等 watch 增量到达后
才可点（proposal 起草期取值 5）；索引只在装载与 watch 事件时更新，不做轮询重扫。

## 3. 链接化范围与 DOM 形态

- **在列**：段落 / 标题 / 列表项 / 引用块 / 表格 cell 的**文本间隙**，以及**行内代码**。
- **不在列**：围栏 / 缩进代码块（`buildCodeBlock` 的路径不经过文本落地）；`Link` / `Autolink` 内部
  的文本（嵌套锚在 HTML 里不合法，且那段文本已有自己的导航语义）；图片 alt 文本；纯 URL 节点
  （GFM 已把它解析成 `URL`，不会落进文本间隙）。
- 渲染上下文（doc 文本 + `isVaultFile` + `onOpenPath`）作为参数透传，**不引入模块级可变状态**：
  面板是单实例但单测并行、流式重渲每帧都会走这条路径，模块状态会让测试互相污染。
- 可点元素用 `<button type="button">`（`display:inline`、`font:inherit`、重置边框/内边距/底色），
  不用 `<a href>`：`href` 会带来 webview 的默认导航与中键点击路径，而打开动作必须只走我们自己的
  处理器。元素可聚焦、Enter 触发；`user-select: text` 保住选区手感。
- 样式复用 `.lumir-hp-link` 的色值与下划线语义（`--accent` + underline），新增的类只做工具行
  （等宽字体）里的形态微调；MUST NOT 引入新色值或字号（eink / dark 由既有 token 自动覆盖）。

## 4. 行号锚定与跳转（CL-2）

### 4.1 打开与落点

1. `await openFile(path, openKind(path), "new")` —— 既有唯一链路，**新标签**意图；文件已打开时它
   自己会切到既有标签（单标签不变量在 `openFile` 里，面板不重判）。
2. 打开成功且带行号时，调 `editor.revealLine(line)`：与 TOC 跳转同一落点算式（行首 + 居中），
   行号由编辑器钳到 `[1, doc.lines]`。
3. 下一帧复核一次：若目标行仍不在视口内且编辑器选区仍停在目标行首（用户没动），补发一次
   `revealLine`（补发那次**单独开一扇窗**，不与首轮的窗口共用——首轮的窗在下一帧已经关了）。依据是
   WKWebView / CM 的两条既有先例：`toc.ts:486`（`display:none` 时 `scrollIntoView` 不动，可见后要再
   滚一次）与 `editor.ts` 的 `healCollapsedReveal`（首轮可能停在半路，第二轮带已学高度收敛）。补发
   至多一次，撞帧即止。

### 4.2 捕获语义（CL-2）

- 跳转的 dispatch 包进 `duringViewportTransition`（开窗 → dispatch → 下一帧关窗）。窗口内到达的
  `scroll` 事件被 `reading-position.ts` 的 `scrolled()` 整体忽略，中间态不会落盘；窗口边界由写回
  落地（下一帧）定义，不用任何时长量。
- 窗口关闭后，落点本身仍是用户选择的目的地，会由既有的 1s 防抖正常记录——这不是「覆盖」，而是
  「用户去了那里」。
- **TOC 跳转同样开窗**：核对原文后确认 `toc.jumpTo` 目前直接 dispatch、没有开窗（`:674`–`:677`）。
  它和 harness 跳转是同一类「应用推动视口」动作，本次把两处对齐到同一捕获语义。TOC 的落点算式
  不改，只加窗口。
- 打开新标签这一步本身可能触发的装载复位窗口在 `openFile` / `reloadSession` 内部已有（阅读位置
  合同 CL-2 的既有实现），本 change 不重复开窗、也不改它的边界。

### 4.3 跳转编排的可测形态

把「打开 → 落点 → 二次滚」编排成一个纯依赖注入的函数（`src/harness-path-link.ts`）：`open`、
`reveal`、`duringTransition`、`selectionAtTarget` 都由调用方注入。单测用假件断言：顺序正确、
带行号才 reveal、reveal 必须发生在 `duringTransition` 的窗口内、选区已变时不补发。真实滚动行为本身
归既有 `revealLine` 与真机验收，不在单测里伪造。

## 5. 工具调用卡片

- 路径来源**只有结构化工具参数**：对 `started` / 恢复记录的 summary 做严格 JSON 解析（与
  `humanizeToolArgsStrict` 同一条判据），取 `path` / `new_path`；diff 走 `diffPathOf` 的头行。
  解析失败（含 80 字截断的参数摘要）→ 不产路径目标，卡片文本照旧、不可点。
- 目标与展示文本的对应：`keyArgOf` 与路径目标共用同一张「工具 → 路径字段」表（`vault_read` /
  `vault_create` / `vault_patch` / `vault_delete` 的 `path`；`vault_move` 的 `path` 与 `new_path`；
  `vault_list` 不产目标）。展示文本不新增分隔符，`path → path` 两段各自可点。
- Read 的落点行 = `offset`（1-based）；**缺省不带行锚**（沿用打开链路的阅读位置恢复，
  不无端把读者拽到篇首）；`limit` v1 不参与落点（不做区间选择）。
- 卡片路径同样过文件索引校验（proposal 起草期取值 5），因此目录、已删除文件、未进索引的新建文件
  保持纯文本。
- 同一套渲染函数服务 live 行、批准卡与恢复行，避免第三条渲染路径。

## 6. 打开链路与安全

- 唯一链路：`openFile`（`main.ts:1931`），intent `"new"`。与 link-follow 的
  `openFile(path, openKind(path))`（默认 `"current"`、且 unresolved 时走创建）**刻意不同**：
  harness 引用是「去看 agent 说的那个东西」，不是「跟着链接走」，所以新标签、且绝不创建。
- 边界校验三层：① 候选在面板层做结构性拒绝（绝对路径 / `..` / 空段）；② 索引成员判定保证目标是
  当前 vault 里真实存在的文件；③ `openFile` → Rust `resolve_in_vault` 再做一次权威校验（绝对路径、
  `..`、符号链接逃逸、存在性）。面板不拼绝对路径，也不自行判断文件系统。
- 失败表现：索引过期（文件刚被外部删除）时点击会让既有打开链路给出它既有的失败提示；不新增面板
  文案、不静默吞掉。
- 目标 pane：活跃 doc pane（`openFile` 的既有口径）；harness pane 持焦不改变活跃文档 pane 的判定。

## 7. prompt 纪律段（依赖 `harness-prompt-files` 的布局）

- 新增 `src-tauri/src/harness/prompts/path-reference.md`，在 `context.rs` 里以固定段装配（与
  `QUOTE_REFERENCE` 同构），`AssemblySource` 记一条来源（`path_reference`，固定段：`path: None`、
  `exists: true`、字节数为注入文本长度）。
- 内容要点：引用 vault 内文件写**完整 vault 相对路径并带扩展名**；指向具体位置带 `:行号`
  （必要时 `:行号:列号`）；**只引用工具结果里真实出现过的路径**（不凭记忆拼路径）；不要用
  Markdown 链接语法包裹 vault 相对路径（面板按外链处理，点了不会打开文件）；引用目录时说清是目录，
  不要写成文件路径。
- 该 change 依赖 `harness-prompt-files` 的 `prompts/` 布局；后者未合并时本项不先做（实现期 rebase
  后再落），不在 `context.rs` 里先写一份内联常量再搬——那会制造第二份文本。
- **验收 = 抽样观察**：mock provider 的回复是固定 fixture，测不到真实模型的遵从度。实现后由 agent
  用真实 provider 抽样若干轮，检查路径写法；不满足时作为 prompt 迭代输入，不写成机器断言、也不据此
  判实现失败。

## 8. 验证策略（判别性优先）

- **纯函数单测**（`src/harness-path-link.ts`）：
  - 候选：中文行文斜杠不产候选；`见路径` / `路径的` 两端紧邻中文能收缩命中；含 `/` 与仅含 `.`
    两种形态；行号 / 行列后缀；越界与畸形后缀（`:0`、`:12:`）不误吞；绝对路径与 `..` 拒绝。
  - 文件索引：`kind` 非 file、`lazy` 条目不命中；watch 增删的三种形态。
  - 工具目标：Read 带 offset → 行目标；Move 两段；截断 JSON → 空；`vault_list` → 空。
  - 跳转编排：窗口包裹、顺序、选区变更不补发。
- **渲染单测**（驱动真渲染件 + 最小 DOM 替身）：命中项产可点元素且文本不变；未命中项仍是文本节点；
  行内代码在列；围栏代码块与锚内文本不在列；同一段里多个路径按序；流式尾块重渲结果稳定。
- **CL-2 单测**：沿用 `tests/unit/viewport-transition.test.ts` / `reading-position.test.ts` 的窗口
  口径，新增「跳转窗口内中间态不落盘」用例（与既有空窗对照成对，保证判据有输入）。
- **真机验收**（`scripts/acceptance/scenarios/`）：新增场景，mock provider 回复里放：命中 vault 的
  中文路径 + `:行号`、一个不存在的路径、一个目录、一个工具卡片路径。断言点击新路径 → 新标签打开、
  目标行文本出现；不存在 / 目录 / 卡片外的文本不产可点元素（`ax: not`）；工具卡片路径点击 → 新标签。
  行落点的**位置**由截图人工判读并如实登记——套件没有 `scrollTop` 读数（CL-1/CL-2 的同一已知边界）。
- **门禁**：`scripts/gate.sh quick` 全绿；动过 `harness-panel.css`，另跑 `scripts/gate.sh visual`
  并按原文行报告。本次 scope 不含 `tests/visual`，不新增视觉场景（形态变化由真机截图与现有视觉
  门禁兜底）。

## 9. 已知边界（如实登记，不包装成覆盖）

1. 带空格的文件名、以及超过约 120 字符的无断句 run 里的路径，本次不识别。
2. 图片 / 二进制文件引用保持纯文本（点开只会得到既有的「暂不支持预览」）。
3. 惰性文件（用户忽略规则命中的子树）不进索引 ⇒ 不链接化；与附件解析的既有边界同源。
4. 索引按精确大小写匹配；大小写不一致的引用保持纯文本。
5. `vault_create` 刚创建的文件在 watch 增量到达前不可点。
6. 参数摘要超过 80 字被截断的工具调用（典型是带长 `old_string` 的 `vault_patch`）取不到结构化
   路径；若该调用经过批准闸，批准卡的 diff 头仍提供可点路径。
7. 行落点只用行号；列号、行范围高亮、next-error 遍历均不在 v1。
8. prompt 纪律的遵从度未进机器判据（抽样观察）。
