# Tasks: add-harness-quote-cards

## 1. 序列化协议与卡片数据模型

- [ ] 1.1 卡片数据模型（file / heading（最近一级标题）/ headingPath（完整标题链，hover 专用不进序列化）/ lines / 摘录原文）与 XML 序列化 walker：交错顺序（卡片阅读顺序 = 序列化顺序）、XML 转义、lines 非空才产出卡片、协议无编号（一致性原则）
- [ ] 1.2 prompt 装配：`<quote>` 结构接入消息投递（两 provider 统一处）；agent 按内容/出处回指、同文档相似摘录用 heading / lines 消歧的会话层指引；JSONL 留存含序列化完整消息
- [ ] 1.3 序列化不变量属性测试（无编号 / 转义 round-trip / 交错顺序 / heading 与卡片显示一致）

## 2. 混排对话输入区

- [ ] 2.1 composer 改 contenteditable 混排编辑区（顶层仅 `.qcard` / `.qpara` 两类块；无卡片时退化为纯文本输入；全 composer 唯一形态）
- [ ] 2.2 原子 block 卡片节点（`contenteditable=false`、删除/选择按整体作用、× 移除）
- [ ] 2.3 光标处拆段插入（段落从光标处拆两段、卡片插中间、插入后光标落卡片下一行的问题段落——无空段落则新建）
- [ ] 2.4 contenteditable 四 quirk 正面处理：粘贴净化 / IME 组合态 / 撤销栈 / 新块归一化为 `.qpara`
- [ ] 2.5 transcript 用户消息同构呈现（卡片与问题段落交错，卡片无 ×）

## 3. 编辑器侧手势与跳回

- [ ] 3.1 选区 → 浮动「摘录到对话」钮（活跃编辑器 pane 选区、selectionchange 记最后选区、选区坍缩即消失、harness 未开先打开）
- [ ] 3.2 选区 → lines 捕获（CM6 `lineAt(from)/lineAt(to)`）；heading 取摘录上方最近一级标题
- [ ] 3.3 点击卡片跳回 + 瞬态高亮（借用 pending-tint，~1.4s 消退，eink 10% 黑）
- [ ] 3.4 失锚降级链三层（行号定位+原文前缀校验 → 全文搜索原文 → toast 告知失锚）；目标文档未打开先打开、不存在直接第三层

## 4. 上下文注入调整

- [ ] 4.1 选区自动注入移除；路径注入保留；视口注入在无卡片时保留、消息携带卡片时跳过；可核对 chip 口径更新

## 5. 文档与文案

- [ ] 5.1 ADR 0008 措辞修订：Decision 8 与 Consequences 中「pin 式上下文块」改摘录引用卡片表述（pin 机制 2026-10-05 已被推翻）
- [ ] 5.2 文案表 zh/en 双档（浮动钮、失锚 toast、卡片相关全部可见文案）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 新增真机验收场景并全绿：卡片创建（含面板未开先开）/ 混排交错编辑（含光标落卡片下一行）/ 序列化结构断言 / 失锚三层 / transcript 沉淀 / 粘贴净化（mock provider）
- [ ] 6.3 视觉：harness 面板新 UI 场景基线新增（Alex 过目后 --update）；既有相关基线时间戳核对；`scripts/gate.sh quick` 全绿（视觉面有改动则补 visual 档）
- [ ] 6.4 原型与 verify 守卫退役（实现落地、验收绿后移除或归档标记 `design/prototypes/phase2-harness-chat/`）
