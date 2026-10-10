# Tasks: composer-image-mention

## 1. 编号与投递投影（纯函数，一处真源）

- [ ] 1.1 `src/quote-card.ts` 新增 `imageOrdinals(blocks)`（块下标 → 编号，1-based，只数 image 块）与
      `imageMentionText(ordinal)`（`Image N` 形态）——编号与标签文本的**唯一**实现；`DeliveryPart` 的图片
      变体增 `label: string`，`projectDelivery` 在同一次遍历里给每个图片 part 填上标签（`panelText` 与
      占位行形态**不变**）
- [ ] 1.2 不变量单测（tests/unit，零 DOM）：只数 image 块 / 1-based / 与块序一一对应 / 移除后无空号；
      `imageMentionText(1) === "Image 1"`；纯文本与仅卡片消息的 `parts` / `panelText` 与今天**逐字节一致**
      （回归）；`insertPlainTextAtCaret` 既有不变量回归

## 2. 投递：装配记字段、展开生成标签（Rust）

- [ ] 2.1 `harness/attachments.rs` 的 `DeliveryPart` 增 `label: Option<String>`；`parse_delivery_parts`
      对**图片 part 缺 label** 按 `harness_parts_invalid` 拒绝（MUST NOT 静默放行——缺标签即破坏硬保证）
- [ ] 2.2 `content_of_parts` 装配图片 part 为 `{type:"input_image", image_url:"lumir-attachment://<name>",
      lumir_label:"<label>"}`（本地字段，发送前剥掉）；**留存文本面 MUST NOT 出现标签行**
- [ ] 2.3 `expand_image_refs_from`：取 `lumir_label` → 剥掉该字段 → 在图片 part 之前插入
      `{type:"input_text", text:"<label>"}` → 图片 part 仍展开为 base64 data URL；真 client 与 mock 同调
      （`received_inputs` 直接可断言）；无引用路径保持零副作用早退
- [ ] 2.4 Rust 单测：`parse_delivery_parts`（缺 label 拒绝 / 齐备通过）、`content_of_parts`（字段在场、
      文本面无标签行）、`expand_image_refs`（标签在图片前、字段被剥、data URL 形态不变）、
      `panel_text_of_content`（还原文本不含标签行、占位行顺序不变）

## 3. 界面：编号徽标、`@` 钮与光标处插入引用

- [ ] 3.1 两处块渲染点（`renderComposer` / `appendUserMessage`）各算一次 `imageOrdinals(blocks)`，把编号随
      块下标传给卡片工厂；`createCardEl` / `createImageCardEl` 增编号参数（非图片块传 null，不渲染徽标）
- [ ] 3.2 图片卡片渲染编号徽标（composer 与 transcript 两态，形态见 design §8）；元信息行保持 M440 的
      「从文件名开始」口径不变
- [ ] 3.3 composer 态图片卡片增「插入引用」钮（`@`）：点击 → `caretFromDom()` → `insertPlainTextAtCaret
      (blocks, caret, imageMentionText(n))` → 重渲 → `composer.focus()` + 光标落插入文本之后；光标不可得
      按既有口径落 composer 末尾；事件处置与既有 `×` 同款（不夺 composer 选区）
- [ ] 3.4 `src/harness-panel.css`：徽标样式（缩略图角上的小圆角徽标）+ 动作区容纳 `@` 与 `×` 两钮
      （实现建议：绝对定位的 flex 容器；**不改既有 `×` 的可见行为**）；eink 主题按既有 token 走

## 4. 恢复与 transcript 一致性

- [ ] 4.1 恢复路径零改动核对：`panel_text_of_content` → `parseQuoteMessage` → 图片块顺序不变 → 徽标编号
      与发送时一致（补一条断言覆盖此链路）
- [ ] 4.2 transcript 用发送时的块序列渲染 → 编号与该消息 wire 标签一致（补断言）
- [ ] 4.3 composer 快照 round-trip 核对：编号派生自块序，快照面零改动（回归测试）

## 5. 文案与视觉

- [ ] 5.1 文案新增（`文案-Copy.md` + `src/copy-data.ts`）：`@` 钮读屏名 + 图片卡片可访问名含编号
      （D447 改形或新增，实现期按「只追加 / 沿用改形」纪律取号，动工前重核末位——M440 用到 D451）；
      同步 copy drift 测试
- [ ] 5.2 图片卡片视觉场景基线新增（composer 态含徽标与两钮 / transcript 态含徽标 / hover 态），Alex
      过目后 `--update`；动过 `src/harness-panel.css` → `bash scripts/gate.sh visual` 全绿、既有基线按
      纪律核对时间戳

## 6. 验证与对账

- [ ] 6.1 真机验收新场景（scripts/acceptance，mock provider，fixture 全合成）：编号一致性（卡片徽标 =
      wire 标签）/ 留存文本面无标签行且带 `lumir_label`、无 base64 / 恢复后编号一致 / 移除后位序重编 /
      引用卡片与消息摘录卡片零编号回归（design §10 的 ①–⑤）
- [ ] 6.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 6.4 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 截图全部合成）
- [ ] 6.5 **跨 change 对账（M440）**：核 `harness-composer-image-paste` 的「图片消息投递协议」里
      「文本 part 的序列化 MUST NOT 包含卡片编号」一句与本 change 的 MODIFIED 同口径；若该 change 已归档，
      在同一批里把该句修订为「卡片编号（引用卡片与消息摘录卡片）」，两处措辞不得互相矛盾
- [ ] 6.6 归档前逐条对账：tasks / spec 增量 / 实现三者一致（ADDED ×1 + MODIFIED ×1）
