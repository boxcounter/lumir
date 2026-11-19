# Design: CodeMirror composer 与区外附件

## 1. 状态所有权

`src/harness-composer.ts` 是唯一 composer 状态模块。最小扩展集为 `history()`、`EditorView.lineWrapping`、placeholder / aria 属性和必要事件适配；不 import Markdown / language / preview。

- 文本、选区与撤销：CM `EditorState.doc` / `selection` / `historyField`。
- 附件：`StateField<readonly ComposerAttachment[]>`；`ComposerAttachment` 只复用 `{kind:"quote"|"msgquote"|"image",card}`，没有文本 offset、widget 或 DOM 引用。
- 附件事务：`StateEffect` 表达 append / remove；`invertedEffects` 从 startState 取被删卡，为每个 effect 生成逆 effect。事务以 `isolateHistory.of("full")` 独立成步。文本事务不发出附件 effect，因此 Backspace、⌘A、IME 不可能改附件 field。
- 视图：附件 tray 只投影 field；卡片不进入 `.cm-content`，不参与 DOM Selection、IME、Backspace 或 select-all。
- 重置 / 恢复：创建新 `EditorState`，历史随之归零；不伪造一笔可撤销的「清空」。

CM 的 history 只承认 changes 或 `invertedEffects` 产出的 effect（本机 `@codemirror/commands` 1.12 的 `HistEvent.fromTransaction` 实现），所以附件 effect 必须走该 facet，不能只更新 field 后期待 undo 自动看见。

## 2. 文本命令与事件边界

`composerCommand` 不再读 DOM 块或执行旧模型纯函数，而是把统一键位表命令适配到 composer 的 `EditorView` / `EditorState`：

- 字符 / 行 / 视觉行移动、扩选用 CM 的移动原语；事务只改 selection。
- 字素簇与词边界复用 `src/quote-card.ts` 的共享扫描核；kill 槽继续是编辑器与 composer 的模块级单例。
- 删除、kill-yank、转置发普通文本 changes；不发附件 effect。
- ⌘A dispatch `{anchor:0,head:doc.length}`；不改变附件。
- undo / redo 只调 `@codemirror/commands` 的同一 history。

Enter / ⇧Enter 是唯一就地发送键路。现有 `imeGate*` 纯状态机保留，仅负责「候选确认 Enter 不发送」；不再承担 DOM 冻结、手工压栈或组合补账。组合中其余键（尤其 Backspace）完全交给 CM。普通 Enter preventDefault 后发送；⇧Enter 在同一事务插入 `\n`。

paste 图优先：含图片时只走既有 harness 附件写入，成功后 append 附件；否则只把 `text/plain` 插入当前文本选区。卡片 append 不移动 caret；图片 `@` 才显式插入 `Image N` 文本。

## 3. 投递与 transcript

新 composer 的发送输入由纯函数构造：

```
[...state.field(attachments), {kind:"paragraph",text:state.doc.toString()}]
```

随后继续调用 `projectDelivery`，不在面板另写 XML / parts。结果必然是所有 quote / msgquote 文本上下文与图片 parts 在完整问题之前；空问题只投附件，全空不发送。`firstUserTextOf` 继续只取问题段落。

`parseQuoteMessage` 与 `projectDelivery` 仍支持任意交错，因为消费者是历史 JSONL / transcript，不是新编辑器。历史消息不经过 v2 草稿迁移。

## 4. 草稿 v2 与 v1 一次性转换

### 4.1 v2

```ts
{ version: 2, text: string, caret: number | null, cards: ComposerAttachment[] }
```

caret 是 UTF-16 offset，合法区间 `[0,text.length]`；非法 / 缺席按 `null`，恢复时由 composer 落全文末尾。cards 逐字段校验，图片仍只存内容寻址引用。

### 4.2 v1 映射

按原 blocks 顺序扫描一次，同时累计 `text` 与抽取 `cards`：

- paragraph / 未知块：可见文本加入文本流；两个可见文本块之间恰好一个 `\n`。未知块文本继续由 `draftUnknownBlockText` 产出。
- quote / msgquote / image：只加入 cards，不产生文本或分隔符。
- paragraph caret：该段拼接起点 + clamp(offset,0,段长)。
- 卡片 caret 或末尾边界：最近后续可见文本块的拼接起点；没有后续则全文末尾。
- 非法 caret：null；合法 caret 不得因 cards 抽取而越界。

store `load()` 读到合法 v1 后立即把转换结果经既有串行 `enqueue` 写回 v2，再把 `written` 基准设为该 v2。写回失败走既有 warning / 待写语义，不谎报迁移成功；内存仍可恢复转换后的内容。后续 schedule / load 成功路径只写 v2，绝不双写。

## 5. 失败恢复与焦点

发送前保存完整 `{text,caret,cards}`。乐观清空只替换 composer state；能力闸拒绝时用这份状态重建新 `EditorState`，再渲染 tray、标图片错误态并对齐草稿。其他失败沿用现有 transcript / 草稿口径。

插入附件后先确保 pane 挂载，再 `view.focus()`；caret 由 state 保持，不再做 DOM Range 二次精调或几何重试。× 移除后焦点回文本区；引用卡 / 消息卡点击仍跳回来源。

## 6. 视觉保真

- composer 外框、控制行顺序、圆角、边框、底色、字号、行高、padding、最大高度与滚动档不变；CM host 填满旧文本面。
- 附件 tray 复用 `.lumir-hp-qcard` 整族卡片样式、缩略图、编号和动作钮；不引入新主题色或第二套卡片外观。
- 空态 placeholder 仍取 D328；focus-within 仍由旧 composerBox 承担。
- 不更新视觉基线。旧卡片内嵌像素场景若与新语义冲突，改写为结构 / 行为断言，不用 `--update` 消红。

## 7. 证伪与性能

- 纯状态：附件 append / remove / undo / redo、文本操作不改附件、投递 golden、v2 round-trip、v1 属性迁移（文本与卡片各出现一次、未知块可见、caret 合法）。
- Chromium CDP：真实 `Input.imeSetComposition` 覆盖 committed CJK + 组合字符、组合中一次 / 连续 Backspace、取消、提交、Enter 确认不发送、撤销；同时断言附件 field 经 tray DOM 不变与发送计数。
- Playwright WebKit 只跑合成 adapter 序与文本命令，不标成原生 IME。
- 真机场景 156 保留人工 WKWebView 原始动作：「我」→ 组合「s」→ Backspace 只删 s、Esc 取消、Enter 确认不发送。
- 性能在同一浏览器构建、同 fixture 下比较最小 composer CM 与空页面基线；keypress-to-paint 用按键事务到后续 paint 的读数，内存报告浏览器进程 RSS 与 CM 增量，不能冒充整个 Tauri app 的常驻内存。硬合同仍是 `<16ms` / `<200MB`；若最小实例本身越界，升级 tower，不静默换实现。
