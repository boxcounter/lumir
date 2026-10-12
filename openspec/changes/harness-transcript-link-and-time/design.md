# Design: harness 面板的裸 URL 上屏为链接 + 恢复会话的消息带时间

- Change ID: harness-transcript-link-and-time
- 日期: 2026-10-12

## 1. 缺陷一的节点形态（本机实测，不是推测）

面板正文渲染器（`src/harness-panel.ts` 的 `mdParser = commonmarkParser.configure([GFM])`）对下列
输入产出的语法树（`node_modules/@lezer/markdown` 的 GFM 配置，本机 node 实测逐节点打印）：

| 输入 | 语法树形态 | 修复前 |
|---|---|---|
| `见 https://example.com/a 结束`（段落里的裸 URL） | `Paragraph(URL)` —— `URL` 是段落的**直接子节点** | 整段 URL 被 `SKIP_NODES` 跳过 ⇒ 隐身 |
| `\| 列 \|` / `\|---\|` / `\| https://example.com/t \|`（表格 cell） | `Table(TableRow(TableCell(URL)))` | 同上（Alex 现场那一格） |
| `[文字](https://example.com/x)` | `Link(LinkMark, LinkMark, LinkMark, URL, LinkMark)` | 正常（`Link` 分支取 URL 子节点作 `href`，URL 子节点被跳过——**正当语义**） |
| `<https://example.com/y>` | `Autolink(LinkMark, URL, LinkMark)` | 正常（同上） |
| `www.example.com` / `user@example.com` / `mailto:a@b.com` | `Paragraph(URL)` —— **无 scheme 的字面 URL 也是同一种节点** | 隐身 |
| `` `https://…` `` / 围栏代码块里的 URL | 无 `URL` 节点（行内代码只有 `CodeMark`，围栏只有 `CodeText`） | 正常（代码原文） |

**因此修复面是「谁来消费独立的 `URL` 节点」，而不是加一套上下文判定**：代码类上下文天然没有
`URL` 节点（与 change `bare-url-cmd-click` 在编辑器侧的实测结论一致——那边也是靠语法树排除，
前端不另写上下文判定）。

## 2. 独立 URL 节点与 Link 子节点的区分（收窄 SKIP_NODES 的语义）

`SKIP_NODES` 里原来那条 `"URL"` 的正当性只覆盖**一半**情况：`Link` / `Autolink` 之下的 `URL`
子节点确实不该上屏（它是 `[文字](url)` 括号里那段，宿主分支已把它取作 `href`）。修法是把这个
判断从「节点名字」提到「节点位置」：

- `SKIP_NODES` 去掉 `"URL"`；
- `renderInlineNode` 增加 `case "URL"`：`node.parent` 是 `Link` / `Autolink` 时 `return`（保住
  不二次上屏），否则渲染为锚。

**为什么用父节点判据而不是让 `Link` 分支自己消费 URL 子节点**：`renderInlineChildren` 是
`Link` / `Autolink` / `Emphasis` 一族共用的遍历口，要在它里面按宿主类型跳过子节点，得给遍历口
加一个「谁在上游」的参数（递归传参）或改成「子节点白名单」——两者都把「URL 在谁的下面」这条
信息从节点自身（`node.parent`，lezer 本来就给）搬到遍历状态里，多一处可能漂的真源（REVIEW.md
第 8 条）。父节点判据是一行、局部、无状态。

**三条入口共用一个出口**：新增的 `createLinkEl(href)` 收编 `Link` / `Autolink` / 独立 `URL` 三条
分支——`href` 只作展示与 `title`，点击一律 `preventDefault` + 交给 `openExternalUrl`（scheme
白名单在 Rust 侧判定）。修复前这段是 `Link` / `Autolink` 分支内联的代码，多一条入口就多一份
信任边界拷贝，故抽出来。

**无 scheme 的字面 URL 一律上屏为锚**（proposal 裁决点 1 取 A）：`www.example.com` 与裸邮箱
被 GFM 判为 `URL` 节点，修复前同样隐身；上屏为锚后点击会被 Rust 白名单拒绝（前端静默吞掉），
这不比隐身更差，且与「GFM 说它是 URL」一致。前端**不**自行判 scheme——白名单只有 Rust 一份。

## 3. 缺陷二：留存信封 ts 的逐项归属（沿记录序，不猜时间）

会话恢复的数据流（`harness_resume_session`，change `reshape-harness-session-recording` design §6.2）：
读源文件**最后一条会话轮次** `llm_request` 的 `messages` 数组灌回内存态，并把其后未入请求的
`llm_response` 折叠进来；同一批 wire 项经 `restored_panel_messages` 映射成面板消息。wire 项
自身**不带时间戳**，而留存 JSONL 的**每行信封都有 `ts`**（`jsonl::JsonlWriter::record` 的写入口）

- 写入点：`llm_request` 的信封 ts = 该请求的**发送时刻**（`turn::record_llm_request`）；
  `llm_response` 的信封 ts = 该响应的**落盘时刻**（`turn::record_llm_response`）。

归属规则（`src-tauri/src/harness.rs` 的 `restored_messages_ts`）：

| wire 项 | 归属 | 依据 |
|---|---|---|
| 本轮新增的 `user` 项 | 它所属 `llm_request` 的信封 ts | user 项在请求发出前入队，两者同一时刻 |
| `assistant` / `function_call` / `function_call_output` 项 | **产出它的那条 `llm_response`** 的信封 ts | 它们由响应驱动写入；工具循环内同轮多项共享同一次响应的时刻 |
| 前缀延续项（上一轮就在数组里的同一项） | 沿用上次归属的戳 | messages 数组按轮**累积追加**，同一项会重复出现；逐位比对后不改戳，避免「后来的请求把老消息的时间改掉」 |
| 归属不到的项（记录缺 `ts`、首条请求之前没有响应可归） | `None` ⇒ 面板消息 `ts = 0` | 无读数就不显示时间，不伪造（本仓时间读数的一贯纪律） |

**压缩调用不参与**：压缩自己的 `llm_request`（system 是压缩指令）不纳入走查——它的 messages 是
压缩提示、不是会话数组，纳入会把前缀比对错位。压缩把数组换掉后前缀比对失配，新项按自己的角色重新
归位（压缩注入的汇总消息是 user 项，归当次请求的 ts——正是它被注入的时刻）。

**折叠进来的响应项**归**那条响应自己的**信封 ts（`records[index + 1]` 与灌回项同批取，判据与
折叠判据同一个 index，不可能漂）。

**为什么不做「整批用一个 ts」**：那会把一周前的消息显示成「刚刚」，等于伪造读数（proposal
裁决点 3）。代价是多一个纯函数与它的走查单测——值。

## 4. 读数形态两档（live / restored）

| 形态 | 数据来源 | 规则 | 出处 |
|---|---|---|---|
| `live` | 消息上屏时前端打戳（`Date.now()`） | 「刚刚 / N 秒前 / N 分钟前 / N 小时前 / 昨天」（`relativeWhen`） | M351 design §4（读数一定新，「昨天」是兜底） |
| `restored` | 后端 `PanelMessage.ts`（快照 / 会话恢复） | 「同日窄相对 / 跨天短日期」（`sessionWhen` 同族） | 本 change：留存在盘上，读数可跨天甚至跨周 |

两档由 `whenTextOf(at, now, form)` 一个出口产出（首绘 / 30s 刷新 / 语言切换共用），形态落
`data-when-form` 供重绘读回——重绘不重算形态，两处不可能漂。**不把两档合并成一个 formatter**：
live 档的「刚刚」是 M351 的裁决观感（`sessionWhen` 在 <1 分钟时产 `0秒前`，更差）；restored 档
必须能表达「很久以前」（`昨天` 对一周前的消息是错读数）。合成一个函数等于翻 M351 的裁决。

**恢复工具行**（`appendRestoredToolRow` 的「已采纳 / 已拒绝」时间戳）同走 restored 档：它与 who
行的时间读数同源（同一批留存 ts），跨天时同样需要短日期。

## 5. 覆盖与不覆盖

| 面 | 判据落点 |
|---|---|
| 独立 URL 节点的上屏形态（段落 / 表格 cell / 三态字面 URL / Link 子节点不重复上屏 / 代码里不产锚） | `tests/unit/harness-transcript-render.test.ts`（最小 DOM 替身驱动真渲染件） |
| 真 DOM 里的锚与点击→`open_external_url`、恢复重放的 who 行读数 | `tests/visual/scenes/m460-harness-transcript-link-and-time.spec.ts` |
| ts 归属走查与重建消息带 ts | `src-tauri/src/harness.rs` 的单测（`restored_messages_ts_walks_the_record_sequence` / `restored_panel_messages_carries_envelope_ts_per_item`）+ `jsonl.rs` 的 `read_session_file_keeps_per_record_envelope_ts` |
| 端到端（真机：留存在盘 → 恢复 → 上屏读数；正文里的裸 URL 可见） | 真机场景 `scripts/acceptance/scenarios/152-…`（`--check` 已过；**真机未跑**，如实登记在 tasks） |
| **不覆盖** | 「链接点击被后端拒绝时的用户反馈」——面板对所有外链失败一律静默（`openExternalUrl(...).catch(() => {})`，见下 §6），本 change 不改这条边界 |

## 6. 相邻问题（当日发现，另立 finding，不在本 change 内修）

面板的外链失败**一律静默**（`.catch(() => {})`）：`[x](ftp://y)` 这类不在 Rust 白名单里的链接
今天点了没有任何反馈（编辑器侧 `link-follow.ts` 同一条路径会 toast）。本 change 让无 scheme 的
字面 URL 也变成锚之后，这条静默面变宽了（`www.…` / 裸邮箱点击必被拒）——但修它是**行为变更**
（要不要 toast、文案取哪条），超出本 change 的范围，已另立 finding 交 tower 路由。
