# Proposal: harness 面板的裸 URL 上屏为链接 + 恢复会话的消息带时间

- Change ID: harness-transcript-link-and-time
- 日期: 2026-10-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：**留白**（本 change 由 Alex 的两条 dogfood 反馈直接立项，见下「Why」——
> 需求原文即 Alex 的现场反馈，方向不含未裁选项；tower 已立项并派发实现）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 2026-10-12 dogfood 反馈原话（两条）：

> 「反馈另一个问题：harness pane 里的表格里的链接没有渲染出来……但在会话 JSONL 里是有链接的」
>
> 「还有一个小问题是：恢复的会话里，没有显示消息时间」

**缺陷一：裸 URL 在面板里隐身（影响面不止表格）。** 面板正文的 Markdown 渲染器（`src/harness-panel.ts`）
用 `@lezer/markdown` 的 GFM 配置解析，其 `SKIP_NODES` 集合里含 `"URL"`——这条的**本意**是不把
`[文字](url)` 括号里那段 URL 重复上屏（那段由 `Link` 节点的 `href` 消费）。但 GFM 对**裸 URL**
（`https://…` / 无 scheme 的 `www.…` / 邮箱字面量）产出的就是**顶层 `URL` 节点**（段落里父节点是
`Paragraph`、表格里父节点是 `TableCell`，本机实测三种宿主形态见 design §1），没有任何
`Link` / `Autolink` 外层包裹 ⇒ 它落进 `default` 分支被整段跳过、在面板里**缺席**。表格只是最容易
被注意到的一格：任何位置的裸 URL 都同样隐身，而用户在 JSONL 里能看到它（留存是 wire 原文）。

**缺陷二：会话恢复后的消息不显示时间。** 面板的消息 meta 行 = 角色 + 时间读数，读数来自
`PanelMessage.ts`。live 消息的上屏打戳是前端自己给的（`Date.now()`）；而**会话恢复重放**路径
（`harness_resume_session` → `renderSnapshotMessages`）用的是后端重建的面板消息，重建代码里
`ts` 恒为 `0`（`src-tauri/src/harness.rs` 的 `restored_panel_messages`）——`0` 按「无读数」处理，
于是恢复出来的历史消息只有角色、没有时间。数据其实是有的：会话留存 JSONL 的每行都有信封 `ts`。

## What Changes

逐条对应 `specs/harness/spec.md` 增量里的一个 requirement：

1. **裸 URL 上屏为可点链接**（harness，MODIFIED：对话面板）。`URL` 节点独立成节点时渲染为
   `.lumir-hp-link` 锚（`href` = 节点文本自身，点击拦下导航交给既有的 `open_external_url`——
   与 `[文字](url)`、`<url>` 三条入口共用同一个出口，信任边界只有一份）；作为 `Link` / `Autolink`
   **子节点**时照旧跳过（保住「URL 不二次上屏」这条正当语义）。代码块 / 行内代码里的 URL 不受影响
   （那些上下文没有 `URL` 节点，语法树天然排除，前端不另写一套上下文判定）。
2. **恢复重放的消息带留存时间**（harness，MODIFIED：消息呈现）。会话恢复重建面板消息时，逐项
   按**留存记录的信封 `ts`** 归位（规则见 design §3：user 项 = 它所属请求的发送时刻、
   assistant / function_call 项 = 产出它的那次响应时刻；归属不到记 0，不伪造读数），随
   `SessionResumeInfo.messages` 与新会话 `panel` 两条通道一起带出（快照重载后不丢）。
   读数形态按数据来源分两档：live 沿用既有分档（含「刚刚」），restored 按「同日窄相对 /
   跨天短日期」——留存在盘上，读数可以跨天甚至跨周，`昨天` 对一周前的消息是错读数。

## Alex 裁决点

| # | 裁决点 | 选项 | 结果 |
|---|---|---|---|
| 1 | 无 scheme 的字面 URL（`www.x.y` / 邮箱）要不要也上屏为链接 | A. 一律上屏为锚（GFM 同一种节点，跟 `https://…` 一样）；B. 只上有 scheme 的，无 scheme 的保持原文 | **实现期取 A**：修复前这三态**同样隐身**（整段跳过），上屏为锚严格优于隐身；能不能打开由 Rust 侧 scheme 白名单判定（`www.` / 裸邮箱不在白名单 ⇒ 点击被后端拒绝），与编辑器侧「裸文本装饰面收窄到白名单 scheme」（change `bare-url-cmd-click` 裁决点 D2）**有意不同**——编辑器里无 scheme 的串可能是 vault 内相对路径，聊天正文里不可能，两种上下文的最优解本就不同。B 要在前端多写一份 scheme 白名单（REVIEW.md 第 8 条：同一语义不应有两处判定） |
| 2 | 恢复消息的时间读数用哪一档格式 | A. 与 live 同档（含「昨天」兜底）；B. 恢复档按「同日窄相对 / 跨天短日期」 | **实现期取 B**：`昨天` 对一周前的恢复消息是错读数（会话留存在盘上、可跨周）。两档并存是刻意的——live 档的「刚刚」是 M351 定下的观感（`sessionWhen` 的 `0秒前` 更差），故不合并成一个 formatter（不翻 M351 的裁决） |
| 3 | 后端 ts 归属的粒度 | A. 逐项按记录序归位（user = 请求时刻、assistant = 响应时刻）；B. 整批用最后一个请求的 ts | **实现期取 A**：B 会把一周前的消息都显示成「刚刚」，等于伪造读数（本 change 的第一条纪律是不伪造）。A 的代价是多一个纯函数与它的走查单测（`restored_messages_ts`） |

## Non-goals

- **不加任何新的可见文案**：两条修复都用既有元素（`.lumir-hp-link` 样式、meta 行的 when span），
  文案表零新增 D 号。
- **不改后端时间读数的其它口径**：`session_open` 的 `first_ts`（会话浮层的行时间）、批准决策行的
  时间戳、live 消息的打戳路径一律不变。
- **不做时间读数的「相对 / 绝对」切换**、不加悬停显示完整时刻、不给恢复消息补「多久以前说过」之外
  的二级信息：这两条反馈要的是「有读数」，不是读数的新形态。
- **不补写会话留存结构**：不给留存加逐消息 ts 字段、不改 JSONL 记录 kind（信封 `ts` 已足够）。
- **不动链接的信任边界**：scheme 白名单仍只在 Rust 侧判定；前端 MUST NOT 自行判能不能开。
- **不修「链接点击被后端拒绝时静默无反馈」这条既有边界**（当日发现的相邻问题，已另立 finding）。

## Impact

- **影响的 specs**：`harness`（MODIFIED ×2：对话面板 / 消息呈现）
- **影响的代码/系统**：
  - src：`harness-panel.ts`（`SKIP_NODES` 去掉 `URL` + 新增 `URL` 分支 + 抽 `createLinkEl` 共用出口；
    `whenTextOf` + `WhenForm` 与 who 行 / 恢复工具行的形态接线；导出 `renderMarkdownInto` 供单测驱动）
  - src-tauri：`harness.rs`（新增 `restored_messages_ts` 归属走查 + `restored_panel_messages` 收
    `restored_ts` 参数 + `resume_session` 同步增长时间表）、`harness/jsonl.rs`（`SessionFile.record_ts`
    保留每行信封 ts）、`harness/session.rs`（`PanelMessage.ts` 的注释改准）
  - tests/unit：新增 `harness-transcript-render.test.ts`（裸 URL 锚 / 不重复上屏 / when 两形态）
  - tests/visual：新增 `m460-harness-transcript-link-and-time.spec.ts`（段落与表格 cell 的裸 URL 锚 +
    点击交给 `open_external_url`；恢复重放的 who 行时间读数）
  - scripts/acceptance：新增场景 152（真机：会话恢复后消息带时间 + 正文里的裸 URL 可见）
- **关联约束**：REVIEW.md 第 8 条（信任边界与读数形态各只有一份出口）、第 9 条（声明即有消费者）、
  仓库信息卫生（fixture 一律合成域名与人名）
- **不影响的既有行为**：模型输出原文、wire 请求体、会话留存结构、`[文字](url)` 与 `<url>` 的既有
  呈现、live 消息的时间读数、会话浮层的行时间——全部逐字节不变

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：两条都是**常驻可见**的呈现面——链接是否可点、恢复消息是否带时间，
  Alex dob足时扫一眼即可（无埋点，沿用产品零埋点口径）。
- **怎么知道它有效**：主判 = Alex 下次 dogfood 不再提这两条（表格链接看得见、恢复会话有时间）；
  辅判 = 他如果对时间读数提出「这个时间不对」，那说明归属走查有错，落点就是 design §3 的规则表。
- **出问题怎么发现**：机器面兜底——Rust 单测（ts 归属走查 + 重建消息带 ts）、前端单测（裸 URL 锚 /
  不重复上屏 / 两档读数形态）、视觉场景（真 DOM 里的锚与 who 行读数）、真机场景 152（端到端）。
