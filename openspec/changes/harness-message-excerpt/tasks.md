# Tasks: harness-message-excerpt

## 1. 数据模型与序列化协议

- [ ] 1.1 MessageQuoteCard 数据模型（role 必选 user/assistant、at 可缺 ms 上屏戳、摘录原文=所见文本）；`createMessageQuoteCard` 校验（role 非法/原文为空不得产出卡片，对齐 QuoteCard 的 lines 非空纪律）
- [ ] 1.2 `<msg-quote role="…" at="…">摘录原文</msg-quote>` 序列化：混排交错（与 `<quote>` 同规则）、role 必选、at 可缺（ISO 8601 本地时间串，秒级）、XML 转义、协议无编号（一致性原则）
- [ ] 1.3 `parseQuoteMessage` 扩展：`<msg-quote>` 解析还原为 msgquote 块（快照恢复 round-trip 与 `<quote>` 同口径）；未知元素保守不丢文
- [ ] 1.4 序列化/解析不变量属性测试（无编号、转义 round-trip、交错顺序、role 合法性、未知元素行为）
- [ ] 1.5 prompt 装配：`<msg-quote>` 接入消息投递（两 provider 统一处）；会话层指引 agent 按内容/角色回指

## 2. 手势与卡片流转

- [ ] 2.1 transcript 选区手势：selectionchange scoped 到 `.lumir-hp-msg-user/-assistant > .lumir-hp-body`，浮动「摘录到对话」钮浮现/消失（复用 D370 文案与浮动钮视觉），平时记录最后选区、点击不依赖焦点保持
- [ ] 2.2 捕获：现读选区 `selection.toString()`（所见文本）+ 沿 DOM 取所在消息 role（`who.dataset.role`）/at（`when.dataset.ts` 可缺）
- [ ] 2.3 排除面：思考块、工具行/工具块、批准卡、消息内引用卡片内部的选区 MUST NOT 出钮
- [ ] 2.4 与编辑器摘录手势的并存：两钮互斥（以最后 selectionchange 的来源容器为准），验收覆盖编辑器选区与消息选区先后出现
- [ ] 2.5 插入流转：`insertMessageQuoteCard` 走 `insertCardAtCaret` 同路（面板未开先开、光标处拆段、插入后光标落卡片下一行问题段落）
- [ ] 2.6 视口注入 skip 判定扩展：含 quote 或 msgquote 块即 skipViewport（「上下文注入与可见性」「携带卡片」口径扩展）

## 3. 渲染与跳回

- [ ] 3.1 `createCardEl` msgquote 分支：复用 `.lumir-hp-qcard` 整族样式（几何零改动），出处行「对话 · 助手/你」，hover 完整摘录 + 绝对时间
- [ ] 3.2 transcript 用户消息同构沉淀（msgquote 卡与段落交错、无移除钮、整卡可点）
- [ ] 3.3 跳回：role+at 定位 → 全文搜索摘录原文（前缀匹配口径）→ toast 失锚三层降级；命中滚动居中 + 整条消息瞬态高亮（新动画类，pending-tint 黄语义 / eink 10% 黑，~1.4s）
- [ ] 3.4 跳回定位判定纯逻辑层（零 DOM，tests/unit 直驱）：同秒双消息、无 at 旧消息、流式消息三类边界

## 4. 文案与文档

- [ ] 4.1 新 D-code（D442 起）双档 zh/en：出处行（「对话 · 助手/你」）、消息失锚 toast（对齐 D372 措辞改「对话」）、跳回 a11y 名；同步 `文案-Copy.md` 与 copy drift 测试
- [ ] 4.2 本 change 归档时 living spec 增量并入核对（ADDED ×2 与实现一致）

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 新增真机验收场景并全绿（§8 验收面六项，mock provider；fixture 全部合成）
- [ ] 5.3 视觉：msgquote 卡与浮动钮场景基线新增（Alex 过目后 --update）；既有 harness 相关基线时间戳核对；`scripts/gate.sh quick` 全绿（harness-panel.css 有改动则补 visual 档）
