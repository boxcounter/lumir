# Harness composer 交互合同

> 状态：M831（2026-11-18）整体重写。旧 HC1–HC6 约束的是 contenteditable 混排块模型；该模型已退役，
> 旧条款不再通过换皮保留。本合同只约束最小 CodeMirror 6 文本内核、编辑区外附件 tray、统一 history、
> 附件前置投递与草稿 v2。历史已发送消息的交错解析不属于 composer 编辑模型。

## 适用范围

composer 由两个互不嵌套的状态投影组成：

- **文本面**：一个最小 CM6 实例，只有纯文本 doc、selection、history、line wrapping 与必要 keymap；
  `.cm-content` 内没有引用 / 消息摘录 / 图片卡片或自造 block widget。
- **附件面**：编辑区外 tray，按加入顺序呈现 quote / msgquote / image 卡片。附件没有文本锚点，
  卡片 DOM 不参与文本 Selection、IME、Backspace 或 select-all。

新输入不再支持文字与卡片任意交错。发送统一为「附件上下文在前、完整问题在后」。这是有意消类，
不是待补功能；不得用文字 offset 锚点、隐藏占位或第二编辑路径恢复交错。

## 不变量

### HC1 — 单一文本与选区真源

普通输入、IME、⇧Enter、粘贴、删除、Emacs 命令、kill-yank、转置与全选 MUST 只通过 CM state 修改文本和选区。
实现 MUST NOT 再从 DOM 反推块模型，MUST NOT 维护 DOM↔block caret 映射、normalize 或自绘块级选区带。

1. ⇧Enter 在当前文本选区插入一个 `\n`，光标落插入文本之后；不发送。
2. ⌘A 选区端点为 `0 → doc.length`，不选择或修改附件。
3. 文本导航只改 selection，不新增 undo 编辑事件；视觉行移动由 CM 负责。
4. 字素簇 / 词边界与 kill 槽继续复用编辑器共享原语，不另写第二份词法或 kill buffer。

### HC2 — 单一 history，文本与附件可逆

文本与附件 MUST 共用 `@codemirror/commands` 的 history。附件 append / remove MUST 由专用 effect 更新
`StateField`，并经 `invertedEffects` 产出逆 effect；结构事务 MUST 与相邻编辑隔离。不得再建快照栈。

1. 一次 undo 恢复上一次附件添加或移除及当时文本 / selection；redo 对称恢复。
2. 文本 Backspace / Delete、⌘A、普通键入、粘贴与 IME 事务 MUST NOT 改变附件 field。
3. 连续文本输入按 CM history 聚簇；整段 IME 的撤销归 CM，不在 compositionstart/end 手工压栈。
4. 重置、草稿恢复和发送后的新输入是新的编辑史；不得撤销回另一 vault 或已发送消息。

### HC3 — IME 由 CM 持有组合状态，发送键只有确认门

CM MUST 独占组合文本、组合选区与组合中删除。实现 MUST NOT 在 compositionstart/end 重建文本 DOM、
改写组合范围、手工计算 marked-text 删除区间或补跑 normalize。

1. 已提交文本后组合一个或多个字符，组合中 Backspace 只按引擎语义删组合内容，MUST NOT 由产品额外删除已提交文本。
2. 取消组合不发送；提交候选后文本留在原文本位置，附件不变。
3. 组合期 Enter 与 WebKit 序的 compositionend 后确认拍 MUST NOT 发送或换行；确认窗外 Enter 才发送。
4. 除 Enter 确认门外，组合期按键 MUST 交给 CM / IME；尤其不得由旧 Backspace / Delete 自管路径接管。
5. Chromium CDP `Input.imeSetComposition` 是真引擎回归通道；Playwright 手工事件只证明 adapter 序，
   MUST NOT 被描述为 WKWebView 原生 IME。原始拼音动作仍需真机人工终判。

### HC4 — 附件与文本解耦

附件按加入顺序排列；添加附件 MUST NOT 拆分文本、移动 caret 或产生隐藏文本。附件只经 × 移除，
文本删除键 MUST NOT 删卡。引用 / 消息摘录跳回、图片缩略图、编号、错误态与焦点行为保留。

1. 引用、消息摘录、图片插入完成后焦点回文本面，caret 保持插入前的合法位置，可直接继续键入。
2. 图片编号只数图片附件，1-based 无空号；移除后即时重编。卡片徽标与投递标签共用同一编号源。
3. 图片 `@` 在当前文本选区插入普通 `Image N` 文本，不拆段落；后续重编号不得静默改已插入文本。
4. 文本 ⌘A / Backspace / IME 前后 tray 的卡片数据与顺序逐字段不变。

### HC5 — 附件前置投递，历史仍可交错显示

新消息 MUST 由 `[...attachments, paragraph(fullText)]` 构造并调用既有 `projectDelivery`。
panelText 与 parts MUST 同源；quote / msgquote XML 与全部图片 parts 位于完整问题之前。
空问题可只投附件；全空不发送。

1. 新 transcript 按同一附件前置投影呈现，卡片无 ×；跳回与编号保持不变。
2. 已发送历史消息和 JSONL MUST NOT 改写；`parseQuoteMessage` 继续识别任意交错与未知文本，
   历史 transcript 继续原样显示。
3. 发送被拒需要恢复时，文本、caret、附件及其顺序 MUST 回到发送前；图片错误态按既有 code 标出。

### HC6 — 草稿 v2 与一次性 v1 转换

v2 只含 `{version:2,text,caret,cards}`；caret 是 `[0,text.length]` 内 UTF-16 offset 或 null。
图片只存内容寻址引用，MUST NOT 内联 base64。防抖、无变更不写、离散 flush、串行写清和 per-vault 隔离不变。

1. 合法 v2 往返必须逐字段保留 text / caret / cards；非法 caret 按 null，损坏文件安静回空。
2. v1 段落按原顺序以单个 `\n` 连接；未知块以 `draftUnknownBlockText` 的可见文本加入，MUST NOT 丢文。
3. v1 卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，
   无后续则全文末尾；结果 caret 必须合法或 null。
4. 成功读出合法 v1 后 MUST 立即经既有串行 store 写回 v2；之后只读 / 只写 v2。MUST NOT 双写、
   MUST NOT 保留旧编辑器或建立通用迁移平台。写回失败只走既有 warning / 重试，不谎报已保存。
5. 发送成功清除；拒绝 / 失败保留；写失败不阻断输入；切 vault 不串草稿。

## 证伪方式

- **纯状态属性测试**：附件增删与 undo/redo、文本命令不改附件、v2 往返、v1 块序生成器的文本 / 卡片守恒与 caret 合法性、附件前置 golden。
- **真实浏览器**：统一键位表命令、⇧Enter、⌘A、paste、focus、附件 × / 跳回、发送失败恢复。
- **CDP 真引擎 IME**：committed CJK + 单 / 多组合字符、一次 / 连续 Backspace、取消、提交、Enter 确认与 undo；同时读发送计数和 tray。
- **真机人工**：原始 WKWebView 拼音动作，不用合成测试替代。
- **性能**：最小 CM 实例 keypress-to-paint `<16ms`；常驻内存对照项目 `<200MB`，报告测量对象与增量，浏览器读数不得冒充整个 Tauri app。

## 明确退役的旧判据

旧 HC1 的块拆分 / 尾随换行行盒、旧 HC2 的 Range reveal 算式、旧 HC3 的卡间 caret / 物化段落、
旧 HC4 的块停靠点 / 整卡删除、旧 HC5 的 normalize 冻结 / 补账、旧 HC6 的跨卡全选与自绘块级高亮，
均随 contenteditable 块模型删除。相应单测和验收场景必须退役，不得仅把选择器换成 CM 后继续声称覆盖。
