# Tasks: harness-message-excerpt

## 1. 数据模型与序列化协议

- [x] 1.1 MessageQuoteCard 数据模型（role 必选 user/assistant、at 可缺 ms 上屏戳、摘录原文=所见文本）；`createMessageQuoteCard` 校验（role 非法/原文为空不得产出卡片，对齐 QuoteCard 的 lines 非空纪律）
- [x] 1.2 `<msg-quote role="…" at="…">摘录原文</msg-quote>` 序列化：混排交错（与 `<quote>` 同规则）、role 必选、at 可缺（ISO 8601 本地时间串，秒级）、XML 转义、协议无编号（一致性原则）
- [x] 1.3 `parseQuoteMessage` 扩展：`<msg-quote>` 解析还原为 msgquote 块（快照恢复 round-trip 与 `<quote>` 同口径）；未知元素保守不丢文
- [x] 1.4 序列化/解析不变量属性测试（无编号、转义 round-trip、交错顺序、role 合法性、未知元素行为）——tests/unit/message-quote-card.test.ts
- [x] 1.5 prompt 装配：`<msg-quote>` 接入消息投递（两 provider 统一处 `harness_send` 的 `serializeQuoteMessage` 产物）；会话层指引 agent 按内容/角色回指

## 2. 手势与卡片流转

- [x] 2.1 transcript 选区手势：selectionchange scoped 到 `.lumir-hp-msg-user/-assistant > .lumir-hp-body`，浮动「摘录到对话」钮浮现/消失（复用 D370 文案与浮动钮视觉），平时记录最后选区、点击不依赖焦点保持
- [x] 2.2 捕获：现读选区 `selection.toString()`（所见文本）+ 沿 DOM 取所在消息 role（`who.dataset.role`）/at（`when.dataset.ts` 可缺）
- [x] 2.3 排除面：思考块、工具行/工具块、批准卡、消息内引用卡片内部的选区 MUST NOT 出钮
- [x] 2.4 与编辑器摘录手势的并存：两钮互斥（各以 containment 为门槛，后发生的选区来源容器决定哪个钮在场），验收覆盖编辑器选区与消息选区先后出现
- [x] 2.5 插入流转：`insertMessageQuoteCard` 走 `insertBlockAtCaret`（= `insertCardAtCaret` 同路：面板未开先开、光标处拆段、插入后光标落卡片下一行问题段落）
- [x] 2.6 视口注入 skip 判定扩展：含 quote 或 msgquote 块即 skipViewport（「上下文注入与可见性」「携带卡片」口径扩展）

## 3. 渲染与跳回

- [x] 3.1 `createCardEl` msgquote 分支：复用 `.lumir-hp-qcard` 整族样式（几何零改动），出处行「对话 · 角色」（D442 + D385/D386），hover 完整摘录 + 绝对时间
- [x] 3.2 transcript 用户消息同构沉淀（msgquote 卡与段落交错、无移除钮、整卡可点，a11y 名 D444）
- [x] 3.3 跳回：role+at 定位 → 全文搜索摘录原文（前缀匹配口径）→ toast 失锚三层降级；命中滚动居中 + 整条消息瞬态高亮（新动画类，pending-tint 黄语义 / eink 10% 黑，~1.4s）
- [x] 3.4 跳回定位判定纯逻辑层（零 DOM，tests/unit 直驱）：同秒双消息、无 at 旧消息、流式消息三类边界——tests/unit/message-quote-gesture.test.ts

## 4. 文案与文档

- [x] 4.1 新 D-code（D442–D444）双档 zh/en：出处行（D442 `对话 · {role}`，角色词复用 D385/D386）、消息失锚 toast（D443，对齐 D372 措辞改「对话」）、跳回 a11y 名（D444）；同步 `文案-Copy.md` 与 copy drift 测试
- [ ] 4.2 本 change 归档时 living spec 增量并入核对（ADDED ×2 与实现一致）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`gate.sh quick` 的 `openspec-validate` 项 PASS）
- [x] 5.2 新增真机验收场景并全绿（§8 验收面 ①②⑤⑥，mock provider；fixture 全部合成）——场景 **121**（选区 → 浮动钮 → 卡片入 composer → 移除 → 再摘 → 发送；含 `<msg-quote role at>` wire 断言与视口 skip）与 **122**（排除面：思考块内不出钮 + 消息体出钮正向对照）在真机 `LUMIR_ACCEPTANCE_PORT=1430` 上 PASS（证据 `test-results/acceptance/2026-10-10/{121,122}-*`）。选区通道 = 既有 `drag` 的 `{x,y}` 窗口局部坐标（真实 CGEvent 拖拽；`select_text` 实测不产生 DOM `selectionchange`，见两场景「已知边界」）。§8 的 ③④ 分别在 121 的 wire 断言与 chromium 视觉场景覆盖（同步半）。
- [x] 5.3 视觉：msgquote 卡与浮动钮场景基线**新增**（由 Playwright 首跑写入 `tests/visual/baselines/m423-message-excerpt.spec.ts-snapshots/`，未用 `--update`、未触碰既有基线）；既有基线**零漂移**（全量视觉套件 646 passed / 1 skipped / 0 failed）；截图已复制 `test-results/alex-review-2026-10-10/m423/` 待 Alex 过目；`scripts/gate.sh quick`：`GATE RESULT: 10/10 PASS（SKIP 0）`
