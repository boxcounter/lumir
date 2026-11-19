# Proposal: composer 改用 CodeMirror 文本内核，附件移到编辑区外

- Change ID: `move-composer-to-codemirror-nov18`
- 日期: 2026-11-18
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-18，tower 按 Alex 委托批准）。Alex 原话：「composer 改用统一编辑内核，优先评估 CodeMirror；能从编辑区移出的卡片就移出去。」并授权 tower 不等后续裁决。tower 裁决采用最小 CM6 文本内核 + 编辑区外附件 tray + `EditorState` 内附件 `StateField`；新草稿 / 新发送取消文字与卡片任意交错，统一为附件上下文在前、完整问题在后。该退化是有意消类，不保留文本锚点或双实现。既有草稿是具体消费者，一次性 v1→v2 转换；历史 JSONL 不改写。
> 节点 2（归档评审）：五要件记录见下节（2026-11-19，M840）。

## 节点 2 记录（归档前，2026-11-19，M840）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-18 通过——Alex 原话「composer 改用统一编辑内核，优先评估 CodeMirror；能从编辑区移出的卡片就移出去。」并授权 tower 不等后续裁决；tower 裁决采用最小 CM6 文本内核 + 编辑区外附件 tray + `EditorState` 内附件 `StateField`（见本文开头记录）。实现期没有静默扩 scope：`git diff --name-only edc5ed6c...7344736d` 全在本文「Impact」声明的 composer / 卡片 / 草稿 / 场景 / spec / 文档面内，Rust 与依赖均未改。
2. **独立 reviewer clean / merge**：assigned reviewer `reviewer-composer-write-ownership` 判 `status: clean` / `merge: merge`，评审 tip `7344736d75573c08c63bb62fa22fcc18e277a1ec`（`reviewed_commit` 同值），评审文件 `/Users/boxcounter/Code/Boxcounter/lumir/.tower/comms/reviews/review-feat-move-composer-to-codemirror-nov18-reviewer-composer-write-owners-r1.md`。合并提交 `8814bbf0` 的第二父即 `7344736d`，评审绑定内容与合入内容同一份。此前三轮 P1（delta 漏退役消息摘录序列化协议、v1 迁移写回竞态、失败回填竞态）分别以 `519b8289` / `42a943d5` / `7344736d` 修完并复评。
3. **tasks 完成**：`tasks.md` 15/15 全勾，无放弃项；4.2 / 4.3 的 `GATE RESULT` 原文按最终 tip 读数补齐（见 tasks 文末两条）。
4. **要求的门禁与真机证据**：最终 tip `7344736d` 串行复跑——`quick` `GATE RESULT: 13/13 PASS（SKIP 0）` 退出码 0（`/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/move-composer-to-codemirror-nov18/gate-quick.log`，首行为完整 tip）；`visual` `GATE RESULT: 15/15 PASS（SKIP 0）` 退出码 0、`visual-regression` 624s、946 passed / 1 skipped / 0 failed（同目录 `gate-visual.log`）；未更新像素基线。真机：composer 族 11 场景 PASS（117 / 127 / 135 / 142 / 144 / 145 / 146 / 147 / 154 / 156 / 215，共 136 断言，`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-editor-trust/`，2026-11-19T03:34Z 起跑的 M831 实现期批次）；合并后 master `ee742606` 上复跑 156 PASS（7 断言）与 140 PASS（13 断言），证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-editor-trust-final/`。原生 WKWebView 中文 IME 由 Alex 在真实系统输入法下人工走完 1–7 步全 PASS（同目录 `156-manual-prep/manual-result.md`，人工证据，非机器 PASS；自动化段 7 断言 PASS）。140 在 M831 实现期首跑 FAIL 的成因是 CM 像素 goal column，由 `fix-composer-vertical-goal-column-nov19` 修复后复跑 PASS，不是本 change 未验证项。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过 10 份 delta，11 条 MODIFIED，对比 127 段，无静默丢段；归档队列 2 项已完成 change 均有唯一条目`（退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 37 passed, 0 failed (37 items)`（退出码 0）；`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。delta 为 10 条 ADDED + 5 条 MODIFIED + 12 条 REMOVED，是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与 tip 均无异常、证据无缺口——机器 + 独立评审放行（本节要件）。

## Why

M828 的只读调查证明，持续故障面不是某一个按键，而是浏览器原生 `contenteditable` DOM 与产品自管块模型同时拥有文本、结构和选区。现有实现还要另管 DOM 选区映射、结构归一、块级快照撤销与草稿读回；HC1–HC6 的换行、卡间光标、IME 折段、跨卡删除和全选高亮修复都由这套双重所有权派生。调查原文与证据见 `.tower/comms/inbox/20261118-worker-composer-kernel-k3-tower-survey-summary.md`（本机协议材料）；切换方向也早已写入[原始卡片设计](../../archive/2026-10-06-add-harness-quote-cards/design.md)：contenteditable quirks 若 dogfood 证明不可控，应切 CM6。

原始 IME 现场是已提交「我」后组合「s」，Backspace 连已提交文本一起删。M828 用 Chromium CDP 原生组合通道确认了旧实现会把组合中的删除范围交给引擎，且现有测试不覆盖这一拍；Chromium 没复现 WKWebView 的连删，真机 marked-text 范围仍是待验边界，不能把合成测试当原生复现。

继续局部修补会增加组合范围和 DOM reconciler；`textarea` 则要重建视觉行导航、IME history 与选区命令；CM 内嵌卡片 widget 仍保留卡间 caret 与跨卡选区。选择「最小 CM6 纯文本内核 + 区外附件」才能消除整类共同根因，同时保留已有卡片数据和投递协议。

## What Changes

1. **统一文本内核**：composer 的问题文字由最小 CodeMirror 6 实例承载，只装 doc / selection / history / line wrapping 与必要 keymap；普通输入、IME、⇧Enter、Emacs 文本命令、kill-yank、撤销、纯文本粘贴和 ⌘A 都作用于这一份状态。不加载 Markdown parser、语法高亮、自动完成或 lint，不新增依赖。
2. **区外附件 tray**：引用、消息摘录、图片卡片按加入顺序显示在文本编辑区外。附件存于同一 `EditorState` 的专用 `StateField`，增删用可逆 effect，与文本共享 CM history；不另建附件撤销栈。卡片跳回、移除、图片缩略图、编号、`@` 提及、失败态和引用后焦点保留。
3. **新产品语义**：加入卡片不拆文本、不改变 caret；发送统一构造「全部附件上下文 + 完整问题文本」。图片 parts 也在问题文本之前，`projectDelivery` 继续单源产出 panelText 与 parts。新消息 transcript 按该投影呈现。
4. **明确取消**：不再支持文字 / 卡片任意交错、卡片前后缘或两卡之间 caret、跨卡选区、Backspace / Delete 删卡、块级自绘选区高亮。文本 ⌘A 只选问题文字，不改变附件；附件只经 × 移除。
5. **草稿 v2 与一次性迁移**：新格式为 `{version:2,text,caret,cards}`。读取现存 v1 时保留段落文本、未知块可见文本、卡片相对顺序和合法 caret，成功转换后立即只写 v2；不双写、不保留旧渲染路径、不建通用迁移平台。损坏草稿仍安静回空。
6. **历史不变**：已发送消息的任意交错解析与 transcript 呈现保留；历史 JSONL、vault 源文件和 Rust parts / 附件展开协议不改写。
7. **验证**：以纯 `EditorState` 属性测试、真实浏览器按键链路和 Chromium CDP 原生 IME 组合测试替代旧块级测试；保留 WKWebView 原生输入法人工验收边界。保持既有几何与主题，不更新视觉基线；测最小 CM 实例 keypress-to-paint 与常驻内存，对照 `<16ms` / `<200MB` 合同。

## Non-goals

- 不用 CM block / inline widget 重建混排卡片，不引入文本位置锚点来暗中维持旧交错。
- 不保留 contenteditable 编辑路径、DOM↔block caret 映射、normalize、自管 snapshot undo 或块级 selection highlight 作为兼容 / 回退实现。
- 不为零消费者保留旧草稿写出、旧 composer 模型 API 或通用迁移框架；v1 reader 的唯一消费者是现存草稿的一次性转换。
- 不改历史已发送消息、JSONL、系统提示词、Rust 投递协议、图片字节格式或 vault 文件。
- 不新增编辑器功能（Markdown、补全、lint、富文本格式），不调整主题和视觉基线。
- 不把 Chromium / Playwright WebKit 合成事件称为原生 WKWebView IME 验证；真机原始动作仍需人工终判。

## Impact

- 影响的 specs：`harness`（composer、附件、投递、撤销、草稿、Emacs 命令与全选）。
- 影响的代码 / 系统：前端 composer 状态与视图、附件 tray、草稿序列化和面板接线；复用 `src/quote-card.ts` 的卡片 / 投递数据与 `src/paste-image.ts` / `src/quote-image.ts` 的图片链路。Rust 不改。
- 影响的测试 / 制品：重写 composer 单测、真实浏览器场景与既有真机验收场景；退役卡间 caret / 跨卡选区 / 整卡删除断言，历史消息解析测试保留。
- 关联约束：ADR 0002 单内核与性能合同；ADR 0003 永不改写源文件；ADR 0004 AI-only 交付。
