# Tasks: composer-image-mention

> 实现记录（M454，2026-10-11）：编号纯函数、投递标签、Rust 装配/展开、UI 徽标与 `@` 钮、
> 文案、验收场景、living spec 对账均已落地。**唯一未勾项**是 5.2 的视觉基线 `--update`——
> 那是人肉裁决点（截图须先呈 Alex 过目），本 mission 只新增场景与待过目截图，不动基线。

## 1. 编号与投递投影（纯函数，一处真源）

- [x] 1.1 `src/quote-card.ts` 新增 `imageOrdinals(blocks)`（块下标 → 编号，1-based，只数 image 块）与
      `imageMentionText(ordinal)`（`Image N` 形态）——编号与标签文本的**唯一**实现；`DeliveryPart` 的图片
      变体增 `label: string`，`projectDelivery` 在同一次遍历里给每个图片 part 填上标签（`panelText` 与
      占位行形态**不变**）
- [x] 1.2 不变量单测（tests/unit，零 DOM）：只数 image 块 / 1-based / 与块序一一对应 / 移除后无空号；
      `imageMentionText(1) === "Image 1"`；纯文本与仅卡片消息的 `parts` / `panelText` 与今天**逐字节一致**
      （回归）；`insertPlainTextAtCaret` 既有不变量回归

## 2. 投递：装配记字段、展开生成标签（Rust）

- [x] 2.1 `harness/attachments.rs` 的 `DeliveryPart` 增 `label: Option<String>`；`parse_delivery_parts`
      对**图片 part 缺 label** 按 `harness_parts_invalid` 拒绝（MUST NOT 静默放行——缺标签即破坏硬保证）
- [x] 2.2 `content_of_parts` 装配图片 part 为 `{type:"input_image", image_url:"lumir-attachment://<name>",
      lumir_label:"<label>"}`（本地字段，发送前剥掉）；**留存文本面 MUST NOT 出现标签行**
- [x] 2.3 `expand_image_refs_from`：取 `lumir_label` → 剥掉该字段 → 在图片 part 之前插入
      `{type:"input_text", text:"<label>"}` → 图片 part 仍展开为 base64 data URL；真 client 与 mock 同调
      （`received_inputs` 直接可断言）；无引用路径保持零副作用早退
- [x] 2.4 Rust 单测：`parse_delivery_parts`（缺 label 拒绝 / 齐备通过）、`content_of_parts`（字段在场、
      文本面无标签行）、`expand_image_refs`（标签在图片前、字段被剥、data URL 形态不变）、
      `panel_text_of_content`（还原文本不含标签行、占位行顺序不变）

## 3. 界面：编号徽标、`@` 钮与光标处插入引用

- [x] 3.1 两处块渲染点（`renderComposer` / `appendUserMessage`）各算一次 `imageOrdinals(blocks)`，把编号随
      块下标传给卡片工厂；`createCardEl` / `createImageCardEl` 增编号参数（非图片块传 null，不渲染徽标）
- [x] 3.2 图片卡片渲染编号徽标（composer 与 transcript 两态，形态见 design §8）；元信息行保持 M440 的
      「从文件名开始」口径不变
- [x] 3.3 composer 态图片卡片增「插入引用」钮（`@`）：点击 → `caretFromDom()` → `insertPlainTextAtCaret
      (blocks, caret, imageMentionText(n))` → 重渲 → `composer.focus()` + 光标落插入文本之后；光标不可得
      按既有口径落 composer 末尾；事件处置与既有 `×` 同款（不夺 composer 选区）
- [x] 3.4 `src/harness-panel.css`：徽标样式（缩略图角上的小圆角徽标）+ 动作区容纳 `@` 与 `×` 两钮
      （实现建议：绝对定位的 flex 容器；**不改既有 `×` 的可见行为**）；eink 主题按既有 token 走

## 4. 恢复与 transcript 一致性

- [x] 4.1 恢复路径零改动核对：`panel_text_of_content` → `parseQuoteMessage` → 图片块顺序不变 → 徽标编号
      与发送时一致（补一条断言覆盖此链路）
- [x] 4.2 transcript 用发送时的块序列渲染 → 编号与该消息 wire 标签一致（补断言）
- [x] 4.3 composer 快照 round-trip 核对：编号派生自块序，快照面零改动（回归测试）

## 5. 文案与视觉

- [x] 5.1 文案新增（`文案-Copy.md` + `src/copy-data.ts`）：`@` 钮读屏名 + 图片卡片可访问名含编号
      （D447 改形取号 D447、新增 `@` 钮读屏名取 D457）；同步 copy drift 测试
- [ ] 5.2 图片卡片视觉场景基线新增（composer 态含徽标与两钮 / transcript 态含徽标 / hover 态），Alex
      过目后 `--update`；动过 `src/harness-panel.css` → `bash scripts/gate.sh visual` 全绿、既有基线按
      纪律核对时间戳
      —— **待 Alex 过目**（人肉裁决点，截图须先呈 Alex 过目后才 `--update`）：
      - 新增场景 `tests/visual/scenes/m454-composer-image-mention.spec.ts`：**结构层断言已在本分支跑绿**
        （`LUMIR_VISUAL_STRUCTURAL=1`，5/5）。两张新表面的整页/元素基线**未经 `--update`**（未提交）。
      - **M440 的 4 张图片卡片基线如今全部过期**：本 change 给图片卡片加了编号徽标与 `@` 钮，M440 的
        `m440-image-card-{composer,transcript,error,broken}.png` 像素形态已变 → 走同一次 Alex 过目 +
        `--update`（视觉门禁卫生：动过 `src/harness-panel.css` 后核对相关基线时间戳）。
      - 待过目截图已复制到主仓 `test-results/m454-visual-review/`（git 外）：
        `open /Users/boxcounter/Code/Boxcounter/lumir/test-results/m454-visual-review`。
      - `tests/visual/scenes/m440-harness-image-card.spec.ts` 的 transcript 读屏名断言随 D447 改形更新为
        `图片 1：{name}`（本分支内）。
      - **既有红（非本 change 引入）**：m440 场景的 test 3（错误态）/ test 5（投递投影）在 master 基线上
        即判红（send 路径）——已用 `git stash` 回 master 复现坐实，另立 finding
        `20261011-worker-m454-bug-m440-2-5-master-send`，不在本 mission scope。

## 6. 验证与对账

- [x] 6.1 真机验收新场景（scripts/acceptance，mock provider，fixture 全合成）：编号一致性（卡片徽标 =
      wire 标签）/ 留存文本面无标签行且带 `lumir_label`、无 base64 / 恢复后编号一致 / 移除后位序重编 /
      引用卡片与消息摘录卡片零编号回归（design §10 的 ①–⑤）—— 场景 148（①–④）+ 149（⑤）已新增，
      `node scripts/acceptance/run.mjs --check` 通过（152 场景）。**真机执行**归 dogfood 批次
      （本 mission 无 KimiCU 跑批环境，未在真机跑过——如实登记）。
      **边界**：wire 展开后的 `input_text "Image N"` 标签行不在磁盘（只活在 mock 的 in-memory
      `received_inputs`），由 Rust 单测 `expand_image_refs_from` 钉；真机场景只断言磁盘可读的留存侧。
- [x] 6.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [x] 6.4 信息卫生：改动面一次 text 级 grep 清扫（无真实 vault 内容；验收 fixture 截图全部合成）
- [x] 6.5 **跨 change 对账（M440）**：`harness-composer-image-paste` 已归档——living spec
      `openspec/specs/harness/spec.md` 的「图片消息投递协议」里「文本 part 的序列化 MUST NOT 包含卡片
      编号」一句已同口径收窄为「引用卡片与消息摘录卡片」（图片块是唯一例外），与本 change 的 MODIFIED
      不矛盾（该 requirement 不在本 change 的 delta 里——归档 change 的增量已并入 living spec，按 M448
      先例就地修订）。
- [x] 6.6 归档前逐条对账：tasks / spec 增量 / 实现三者一致（ADDED ×1 + MODIFIED ×1）
