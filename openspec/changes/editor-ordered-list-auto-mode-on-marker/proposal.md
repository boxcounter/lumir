# Proposal: 裸 marker 行（「1. 」空格触发）的列表编辑态 + IME 组合期不重复插入 marker

- Change ID: editor-ordered-list-auto-mode-on-marker
- 日期: 2026-10-12
- 角色: Alex Lee（评审/裁决），AI agent（起草/实现）

> 评审记录：
> 节点 1（提案评审）：**「1. + 空格进入列表编辑模式」为 Alex 已表达预期（即裁决）**——
> Alex 2026-10-12 dogfood 原话：「反馈另一个问题：当我输入『1. 』（注意：有空格）……时，
> 没有自动进入列表编辑模式，这不符合预期。但还有一个问题是：如果此时我用中文输入法
> 输入一个字符……就会多出现一个『1. 』。如果是英文输入法就没有这个问题。」tower 问
> 复杂度时 Alex 未否定立项，按「已表达预期即裁决」立项；「空项直接回车 = 退出列表、
> 删掉空标记；空标记行离开/留空的语义按 Obsidian 通行行为」口径 tower 已告 Alex。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

**缺陷一：「1. + 空格」不进列表编辑态。** 空列表项按 CommonMark 不能打断段落——
`para\n1. `（段落后无空行，Alex 输入「1. 」的现场形态）被 lezer 解析为段落的 lazy
continuation，行里没有任何列表节点。渲染层（树驱动）不认它，Enter 续行（树驱动）
不认它，于是行首的 `1. ` 只是一段普通文本——与 Alex 的预期（Obsidian live preview
里该行为即列表编辑态：标记按列表项渲染、Enter 续 `2.`、空项回车退出）不符。
探针确诊（`test-results/m461-probe/readings.md`，本机真机 WKWebView + lezer 直跑）：

- 缺口**恰好**是「语法树不接管」的形态：`1. ` 在文档首行或空行后**已被解析为真列表**
  （既有渲染与 M399 空项退出已覆盖），无需特判；`- ` 紧接段落是 setext 标题下线
  （Obsidian 同口径，交给标题语义）；`+ ` / `* ` 紧接段落是 lazy 段落（同族缺口）；
  引用内 `> para\n> 1. ` 同缺陷。
- 修复按 tower 口径走**文本模式特判**（渲染层把光标所在裸 `1. ` 行显示为列表项），
  **不动解析器配置**——CommonMark 归属与渲染层在此分道（与 lists.md 对 lazy
  continuation 的取舍同一哲学）。

**缺陷二：中文 IME 组合期重复插入「1. 」。** 编辑器全仓无任何会自写 `1. ` 的代码；
`@codemirror/view` 的 beforeinput 处理器对 `insertOrderedList` / `insertUnorderedList`
**不 preventDefault**（dist/index.js:5295 实测）——WebKit contenteditable 的原生
smart-list 转换（唯一候选插入者）若触发，默认动作完整执行，CM 的 MutationObserver
再把 DOM 读回成文档变更；英文直输路径逐键只有 insertText、无该事件（probe 实测），
所以只有组合期（CM 不接管 DOM）会中招。自动化复现组合态不可达（全部合成键盘通道
绕过 TSM，探针如实登记），inputType 的精确形态留 dogfood 复验。

## What Changes

1. **裸 marker 行判定**（editor-live-preview，ADDED requirement）：新增纯判定
   `bareListMarkerLine`（`src/preview/lists.ts`，与 `listLineInfo` 同文件同源）——
   行首合法列表标记（有序 `\d{1,9}[.)]`、无序 `-` / `+` / `*`）+ 标记后空白至行尾
   （空项）或带内容但树不接管（lazy），且树未把该行认作列表项首行；排除 setext 下线、
   围栏 / 缩进代码块、HTMLBlock、表格。判定是 `listLineInfo` 的**补集**：树已接管的
   形态（真列表、空行后的 `1. `、列表自身空续项）一律不抢（REVIEW.md 第 8 条）。
2. **Enter 两态分派**（editor-live-preview，MODIFIED「Enter 换行与自动缩进」）：
   光标在裸 marker 行（marker 之后）时，`Enter` 先于树驱动续行检查——空项退出
   （删 marker 与其后空白、行留空、光标在删后位置、不新增行）、有内容续行
   （`\n` + 前缀原文 + 下一序号 / 同标记）；单次 dispatch = 单次撤销步；光标在
   marker 之前不接管（回到行首 Enter 默认行为，与 M399 钉固同口径）。
3. **光标驻留渲染**（editor-live-preview，ADDED）：光标（判据选区，含按压快照口径）
   驻留裸 marker 行时，该行按列表项首行渲染——藏源码标记（含引用前缀，与真实引用内
   列表同落点）、上既有 `ListMarker` widget、悬挂缩进按字面标记宽 + 前缀列计算；
   光标离开回到字面文本。门控是渲染层事件，不改文档（ADR 0003 §3 铁律）。
4. **DOM 输入入口拒收原生自动列表**（editor-live-preview，ADDED）：md 模式
   beforeinput 命中 `insertOrderedList` / `insertUnorderedList` 时 preventDefault
   并消费——本仓列表语义（特判续行 + 上游续行 + TAB 缩进）是唯一合法的列表编辑
   路径；英文路径零影响（探针实测无该事件）。

## Alex 裁决点

| # | 裁决点 | 选项 | 结果 |
|---|---|---|---|
| 1 | 「1. + 空格」的预期形态 | — | **已表达预期即裁决**（节点 1 原话）；实现按 tower 口径：文本模式特判 + Obsidian 通行退出语义 |
| 2 | 真机组合期复现不可达时 IME 修复的验证形态 | A. 等硬件键盘复现再修；B. 按代码层定界先修 DOM 入口（beforeinput 拦 insertOrderedList 族）+ 单测合成事件 + dogfood 复验 | **实现期取 B**（派发补充 4 的预案）：探针三通道实证合成事件不进 TSM，等硬件会无限期阻塞；拦截对英文路径零影响，风险单侧 |
| 3 | 空项 Enter 的退出语义 | — | **Obsidian 惯例**（tower 已告 Alex）：删空标记、留空行、光标在行首、不新增行 |

## Non-goals

- **不改解析器配置**（tower 口径）：CommonMark 归属照旧，特判只活在渲染与命令层。
- **不接管 `- ` 紧接段落的 setext 形态**：那是标题下线语义，Obsidian 同口径。
- **不处理有序编号的组内重排**：裸行续行用「字面序号 +1」，不做 M218 式复合编号
  （裸行本来就是单行长尾形态）；树一旦接管（如空行后）重回归组逻辑。
- **不拦 `formatBold` 等其他原生格式命令**：无缺陷报告，MUST NOT 预防性扩面。
- **任务列表（`- [ ]`）裸形态不特殊处理**：内容按字面文本对待。
