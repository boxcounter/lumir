# Design: harness-message-excerpt

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker 与归档评审对账。

**术语**：沿用 add-harness-quote-cards design.md 的术语（composer / contenteditable）；**transcript** = harness 面板的消息列表（`div.lumir-hp-transcript`）；**消息摘录卡片**（msgquote card）= 本 change 新增的卡片变体。**所见文本**（本 change 自造词，就地定义）：浏览器选区在渲染后 DOM 上的文本形态（`selection.toString()` 口径），即用户屏幕上读到的字，与源 Markdown 可能不同形（表格被拉平、强调标记丢失）。

## 1. 调研结论（现状事实锚点）

以下全部经只读调研核实（worktree wt-422 @ 8c88bbb），是设计决策的事实基础：

- **客户端没有消息对象**：面板把消息直接渲染进 transcript DOM，TS 侧唯一持久模型是 Rust 的 `Session.panel: Vec<PanelMessage>`（`src-tauri/src/harness/session.rs:22-64`，ts-rs 绑定 `src/bindings/PanelMessage.ts`）。`PanelMessage` 有 `role/text/ts(UNIX 秒)` 等字段但**无 id、无序号**；前端渲染层连消息数组都没有（`state.messages` 仅快照恢复时瞬态迭代）。
- **who 行已暴露 role 与时间**：`createWhoLine(role, at)`（`src/harness-panel.ts:3053`）产出 `who.dataset.role` + 可选 when span（`when.dataset.ts`，ms 上屏戳；快照恢复无 ts 的旧消息不建 when——不伪造读数，`messageTs` `:4128`）。**role + 时间对人本来就可查**——一致性原则下它们进协议不需要任何新 UI。
- **选区今天天然可用**：transcript 无任何 `user-select` 禁用（`src/harness-panel.css` 零命中）；唯一的 `selectionchange` 监听在 `src/quote-gesture.ts:308`，且以 `view.contentDOM.contains(anchorNode)` 为门槛（`:260`）——**编辑器手势按构造排除 transcript**，两条手势互斥不需仲裁。
- **用户消息是纯文本、助手消息是面板内 Markdown 渲染**：用户段 `textContent` 直出（`harness-panel.ts:3107-3109`）；助手段经 `renderMarkdownInto`（`:1525` 起，lezer commonmark + GFM，DOM API + `textContent`，**不保留源偏移**）。原文来源只在复制钮的 `copySources` WeakMap（`:3009`），不暴露给选区。
- **composer 混排模型可扩展**：`ComposerBlock = quote | paragraph`（`src/quote-card.ts:35-37`），卡片是 `contenteditable=false` 原子节点，`insertCardAtCaret`（`harness-panel.ts:229-262`）支持任意块在光标处拆段插入。`createCardEl(card, mode)`（`:2048-2101`）一个工厂供 composer 与 transcript 两态。
- **快照恢复从留存原文解析**：`parseQuoteMessage(record.text)`（`harness-panel.ts:4153`）把 JSONL 留存的用户消息文本还原为 blocks——新元素必须在这里有解析路径，否则恢复丢卡。
- **视口注入 skip 判定**：`hasCards` 成立即 skipViewport（`harness-panel.ts:4442-4443`），判定挂在「消息携带 `<quote>` 卡」上，扩展判定即可覆盖新块类。
- **文案**：浮动钮文案 D370「摘录到对话」、失锚 toast D372 已有（`src/copy-data.ts:843/851`）；D372 文案「原文已不在文档中」对消息场景不适用，需要新 D-code（下一空闲段 D440 起，见 `src/copy-data.ts:1260`）。

## 2. 设计合同与输入

- 设计合同：本 change 的 `specs/harness/spec.md` 增量（两条 ADDED requirement 及其验收场景）。
- 行为基准：living spec 的「摘录引用卡片 / 混排对话输入区 / 引用消息序列化协议 / 摘录失锚降级」（`openspec/specs/harness/spec.md:209-279`）——本 change 的全部交互形态以它们为对齐基准。
- NOT 清单：摘录思考块/工具行/批准卡（MVP）；位置级跳回；跨会话跳回；卡片编号；新键位。
- **一致性原则**（Alex 2026-10-06，全文适用）：投递给模型的上下文要素对人必须也可查——msgquote 卡的出处（role / ts）由 who 行（角色 + 相对时间）与卡片 hover（完整摘录 + 绝对时间）双可查面满足；协议不含任何 UI 不可查的标识。

## 3. 数据模型：MessageQuoteCard（与 QuoteCard 的差异及理由）

```ts
/** 消息摘录卡片（harness-message-excerpt）。 */
interface MessageQuoteCard {
  /** 来源消息角色："user" | "assistant"。必选，进序列化。 */
  role: "user" | "assistant";
  /** 来源消息上屏戳（ms）。可无：快照恢复无 ts 的旧消息（who 行本来就不显示时间）。 */
  at: number | null;
  /** 摘录原文——所见文本（渲染形态照录），与源 Markdown 可能不同形。 */
  text: string;
}
```

差异理由（对齐面与分裂面逐条）：

- **不复用 QuoteCard**（裁决点 1）：QuoteCard 的 `file/lines` 是文档行锚，`createQuoteCard` 对空 lines 抛错（`quote-card.ts:50`）；`heading/headingPath` 对消息无意义。留空复用会把「file/lines 必选」的文档不变量稀释成可选，并让失锚降级链（行号定位第一层）对消息卡无意义地空转。
- **对齐面**：卡片仍是 composer 原子 block 节点，混排/拆段插入/移除/transcript 同构沉淀全部复用既有机制——只新增一个块类，不改混排编辑区架构。
- **无 headingPath 等价物**：文档卡的 hover 标题链对应物是「role + 相对/绝对时间」，数据已在 at 字段，不需要第二条人侧专用字段。

## 4. 序列化协议：`<msg-quote>`

- **格式**（示例，fixture 为合成内容）：

  ```
  <msg-quote role="assistant" ts="1760217600000">先读结论再读论证——倒序阅读把大部分筛选成本压到最低</msg-quote>
  这里说的「筛选成本」具体指什么？
  ```

- **不变量**：每段消息摘录一行；问题文字按交错顺序排布在标签之间（与 `<quote>` 完全一致）；`role` 必选且仅 `user`/`assistant`；`ts` 可缺（不可考时产出 role-only 元素）；属性值与文本节点 XML 转义（复用 `quote-card.ts` 的 escapeXmlText/escapeXmlAttribute）；**无编号**（一致性原则）。
- **解析还原**：`parseQuoteMessage` 扩展识别 `<msg-quote>` 并还原为 `{kind:"msgquote"}` 块——快照恢复与 `<quote>` 同 round-trip 口径；未知元素维持既有「不识别即不还原」的保守行为，MUST NOT 静默丢文。
- **prompt 层**：序列化结构原样进用户消息；系统/会话层指引 agent 按摘录内容与角色回指（「你上面说的『倒序阅读』那段」）。两 provider 的装配处统一处理。
- **JSONL 留存**：天然含 `<msg-quote>` 块（留存记序列化后完整消息），Rust 侧零改动。
- **视口注入**：`hasCards` 判定扩展为「含 quote 或 msgquote 块」即 skipViewport（`:4442`）——「上下文注入与可见性」的「携带卡片」扩展涵盖两类卡片，注入策略本身不重裁。

## 5. 手势与装配

- **分层纪律**：与 `quote-gesture.ts` 同三层结构——纯逻辑（选区→卡片数据的捕获判定、跳回定位判定，tests/unit 零 DOM 驱动）/ DOM 手势工厂 / 装配。新模块 `src/message-quote-gesture.ts`（或同文件扩展，实现期定）。
- **手势形态对齐**：`selectionchange` 监听 scoped 到 transcript——选区锚点在 `.lumir-hp-msg-user > .lumir-hp-body` 或 `.lumir-hp-msg-assistant > .lumir-hp-body` 内时，浮动「摘录到对话」钮（复用 D370 文案与浮动钮视觉）浮现于选区右下；选区坍缩/移出即消失。点击时捕获现读选区（`selection.toString()`），沿 DOM 向上取所在消息的 role（`who.dataset.role`）与 at（`when.dataset.ts`，可缺）。**平时记录 transcript 内最后选区、点击不依赖焦点保持**——与编辑器手势双保险同口径。
- **与编辑器手势的互斥**：两监听各以 containment 为门槛（contentDOM vs transcript），选区不可能同时满足两者；后浮现的钮若与先浮现的钮视觉重叠，以「最后一次 selectionchange 的来源容器」为准另一钮隐藏（实现期处理，验收场景覆盖「编辑器选区与消息选区先后出现」）。
- **排除面**：选区锚点落在思考块（`.lumir-hp-thinking*`）、工具行/工具块、批准卡、消息内的引用卡片（`.lumir-hp-qcard`）内部时 MUST NOT 浮现按钮——嵌套摘录（对摘录的摘录）语义不清，MVP 整体排除。
- **插入落点**：`insertMessageQuoteCard(card)` 走 `insertCardAtCaret` 同路（面板未开先开、光标处拆段、插入后光标落卡片下一行问题段落——add-harness-quote-cards 裁决全部沿用）。
- **瞬态纪律对齐**：transcript 侧零常驻装饰，只有两种瞬态：进行中的选区（含浮动钮）、跳回高亮（约 1.4s 消退）。

## 6. 跳回与失锚降级（消息级）

点击卡片（composer 内或 transcript 内）：

1. **role + ts 定位**：在**当前 vault 当前会话**的 transcript 中找 `who.dataset.role` 相符且 `when.dataset.ts` 相等的消息元素；命中 → `scrollIntoView`（居中）+ 整条消息瞬态高亮（新 CSS 动画类，色值借 pending-tint 黄语义，eink 档 10% 黑，与编辑器跳回高亮同族）。
2. **全文搜索摘录原文**：第 1 层未命中（同秒双消息、旧消息无 ts、消息被流式更新）→ 遍历 transcript 各消息体的渲染文本，找包含摘录原文（前缀匹配口径，复用 `quotePrefixMatched` 的判定语义）的消息；命中 → 同上浮。
3. **告知失锚**：仍找不到（新会话已重置、切 vault）→ toast 告知该摘录已失锚（新 D-code，文案对齐 D372 措辞改「对话」），MUST NOT 静默跳到别的消息。

**粒度声明（裁决点 5）**：高亮整条消息，不在消息体内定位片段——渲染 Markdown 无源偏移，位置级定位需要重做渲染器偏移映射，代价与收益不成比例；「跳回来看上下文」的用途消息级已满足。流式进行中的消息允许摘录（锚是消息元素，文本后续增长不影响 role+ts 定位）。

## 7. 渲染与视觉保真

- **卡片 DOM**：`createCardEl` 扩展 msgquote 分支，结构完全对齐文档卡（`div.lumir-hp-qcard` / `span.lumir-hp-qc-bar` / `div.lumir-hp-qc-main` / 摘录 `.-qc-ex` + 出处行 `.-qc-src`），复用 `harness-panel.css:1505-1599` 整族样式，不新立视觉物种。
- **视觉保真口径**（逐面对账，无原型可对照，以产品内既有文档卡为基准）：
  - **布局节奏**：与文档卡同——3px 引号竖条（中性灰阶）+ 摘录 `-webkit-line-clamp: 2` 截断 + 等宽小字出处行；composer 与 transcript 两态的内外边距、圆角、字号全部沿用既有 `.lumir-hp-qcard` 规则，msgquote 卡只改出处行文案内容不改任何几何值。
  - **出处行**：文档卡「文档名 · 最近一级标题」→ msgquote 卡「对话 · 助手/你」（D-code 双档，zh/en）；摘录在 hover 显示完整摘录 + 绝对时间（`date` 本地化短格式）。时间不进出处行正文（裁决点 6）。
  - **浮动钮**：复用 `.quote-gesture-btn` 形态（选区右下 +4px 偏移、同字号同底色），只改定位基准为 transcript 容器。
  - **跳回高亮**：新动画类挂在 `.lumir-hp-msg` 上，色值 = find-in-page 黄同源 pending-tint（eink 10% 黑），~1.4s 消退——与编辑器 `.cm-quote-jump-flash` 同语义同节奏。
  - **状态**：composer 态 × 移除钮、transcript 态整卡可点（role=button + a11y 名「跳回来源消息」）——与文档卡两态完全一致。
- 手感/审美（浮动钮出现时机、高亮节奏）归 Alex dogfood 手感裁决，不进机器判据。

## 8. 验收面（机器判定锚点）

- **真机验收新场景**（scripts/acceptance，mock provider）：① transcript 选区 → 浮动钮 → 卡片入 composer（含面板未开先开）；② 排除面（思考块/工具行/卡片内部选区不出钮）；③ 序列化结构断言（`<msg-quote>` 元素、role 必选、ts 可缺、交错顺序、转义、无编号）；④ 跳回三层（role+ts 命中 / 搜索命中 / 失锚 toast）；⑤ 快照恢复 round-trip（含 `<msg-quote>` 的消息恢复后卡片还原）；⑥ 视口注入 skip（携带消息摘录卡时 chip 无视口）。fixture 全部合成（信息卫生纪律）。
- **单元/属性测试**：序列化与解析的不变量（无编号、转义 round-trip、交错顺序、role 合法性、未知元素保守不丢文）走属性测试口径；跳回定位判定（纯逻辑层）零 DOM 直驱。
- **视觉**：msgquote 卡与浮动钮新增场景基线（Alex 过目后 --update）；既有 harness 相关基线按纪律核对时间戳。
- **门禁**：`scripts/gate.sh quick` 全绿；动过 `src/harness-panel.css` 补 visual 档。
