# Design: composer-image-mention

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker 与
归档评审对账。全部现状断言对着 worktree wt-446 @ e4abfbf（M440 的贴图实现已在 master）核实。

**术语**：沿用既有制品——**composer** = harness 面板的混排输入区；**块 / block** = composer 的顶层单元
（`ComposerBlock`）；**图片卡片** = M440 落地的第三类原子块（缩略图 + 元信息行 + 移除钮）。本 change 自造
三个词，就地定义：**编号（ordinal）** = 一条消息内图片块按出现次序拿到的 1-based 序号（`1` / `2`…），是
块序列的**派生读数**、不进任何持久化面；**引用文本** = 用户经 `@` 钮插进正文的普通文字 `Image N`；
**投递标签** = 系统在 wire 上为每个图片块生成的 `Image N` 文本行（与引用文本同形，但由系统注入）。

## 1. 调研结论（现状事实锚点）

- **图片块与卡片 DOM**：`ComposerBlock` 的第三类变体 `{kind:"image"}`（`src/quote-card.ts:73`）；
  `createImageCardEl`（`src/harness-panel.ts:2320`）产出 `.lumir-hp-qcard.lumir-hp-imgcard`，
  composer 态挂 `×` 移除钮（`:2338`，`.lumir-hp-qc-x` 绝对定位在右上角），transcript 态无钮、整块
  `role="img"` + aria 名 D447。**卡片上没有任何编号**。
- **两处块渲染点**：composer 走 `renderComposer`（`src/harness-panel.ts:2453`，每次模型变更整面重渲）；
  transcript 走 `appendUserMessage`（`:3554`）——两者都是「按块序遍历、逐块调 `createCardEl(card, mode)`」，
  **调用点不带块下标**（编号要落进卡片，渲染点必须把编号算出来传进去，见 §3）。
- **投递投影是唯一入口**：`projectDelivery`（`src/quote-card.ts:202`）一次遍历同时产出 `panelText` 与
  `parts`（`DeliveryPart = {kind:"text",text} | {kind:"image",name}`，`:169`）；图片块的 parts 侧只推
  `{kind:"image", name}`（`:217-222`），面板侧推 `<image ref="…" type="…"/>` 占位行。发送侧
  `src/harness-panel.ts:4900` 同时取 `parts`（给后端装配）与 `panelText`（transcript / 会话名素材）。
- **前端只把 parts 交给后端**：`harnessSend(JSON.stringify(parts), contextJson)`（`:4934`）——**面板文本
  不进模型上下文**，模型的输入只有 parts。
- **Rust 装配与 wire 展开**：`parse_delivery_parts`（`src-tauri/src/harness/attachments.rs:49`）解析
  parts_json；`content_of_parts`（`:348`）把图片 part 装配成
  `{"type":"input_image","image_url":"lumir-attachment://<name>"}`；`expand_image_refs`（`:286`）在发送前
  把引用换成 base64 data URL——**真 client 与 mock 同调这一条**（`src-tauri/src/harness/llm.rs:418` 与
  `:891`，mock 把展开后的 input 记进 `received_inputs` 供验收断言）。
- **留存 = 发送前那份 input**：`record_llm_request` 记的就是 `request.input`（引用形态），所以**留存里
  图片 part 只有引用、没有标签、没有 base64**。
- **恢复的唯一还原口**：`panel_text_of_content`（`attachments.rs:314`）把 content parts 还原成面板文本
  ——文本 part 取原文、`input_image` part 还原成 `<image ref="…" type="…"/>` 占位行；`restored_panel_messages`
  （`src-tauri/src/harness.rs:687`）的 user 分支与 M440 的会话入队面板面都用它。**这条决定了「标签不能
  落在留存的文本 part 里」**：否则恢复路径会把 `Image 1` 复现成正文段落（与卡片徽标重复）。
- **插入机制已存在**：`insertPlainTextAtCaret`（`src/harness-panel.ts:323`）是「光标处插文本、段落中间
  拆两段」的纯函数；卡片插入的光标口径见 `insertMessageQuoteCard`（`:2474`）——`caretFromDom()` 取当前
  选区、取不到落 `{block: blocks.length-1, offset: 0}`（composer 末尾），插入后 `composer.focus()`。
- **零编号原则的原文**：living spec「引用消息序列化协议」（`openspec/specs/harness/spec.md:334`）明写
  「序列化结构 SHALL NOT 包含任何编号……UI SHALL NOT 显示卡片编号」（Alex 2026-10-06）。本 change 的
  MODIFIED 把它收窄为「有文本身份的卡片」（§7）。
- **既有缺口（如实登记）**：M440 的 change（`harness-composer-image-paste`）**已实现、尚未归档**，其
  「图片消息投递协议」里有一句「文本 part 的序列化 MUST NOT 包含卡片编号」。本 change 的 spec 增量不能
  MODIFIED 一个还不存在于 living spec 的 requirement（`validate` 会打 INFO、`archive` 会拒绝），故本
  change 只 MODIFIED「引用消息序列化协议」（该条在 living spec 里），并在 §7 与 proposal 的 Impact 里
  写明**归档前必须与 M440 那句同口径对账**。

## 2. 设计合同与输入

- 设计合同：本 change 的 `specs/harness/spec.md` 增量（ADDED ×1「图片编号与引用」+ MODIFIED ×1「引用消息
  序列化协议」及其验收场景）。
- 行为基准：living spec 的「混排对话输入区」「引用消息序列化协议」「会话本地留存」
  （`openspec/specs/harness/spec.md:315 / 334 / 258`）；composer 质量合同
  [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md)（HC1/HC2 不因本 change 变化
  ——本 change 不加块类、不改行盒）。
- NOT 清单：引用卡片 / 消息摘录卡片编号、跨消息编号、悬空引用检测与改写、原子 mention 块、图片卡片其余
  形态、M440 的投递与落盘口径（proposal §Non-goals）。
- **一致性原则（Alex 2026-10-06，全文适用）**：投递给模型的上下文要素对人必须也可查。本 change 不是
  对它开例外，而是把它**执行到位**——模型看到的 `Image N` 必须在卡片上以同一个 N 可查、并可被用户写进
  自己的话里。

## 3. 编号：一处真源与规则

- **规则（位序）**：一条消息内按图片块出现次序 1-based 编号，只数图片块，自 1 起、无空号；移除图片块后
  同一消息内其余图片即时重编（裁决点 1 的 A）。
- **派生、不落数据**：编号 MUST NOT 进 `ImageCard` 字段、MUST NOT 进 composer 快照（留存里它只作为
  §5.2 的**投递标签字段**在场——那是给模型的标签，不是卡片的编号字段）。理由是它可由块序**确定性重建**：
  恢复路径因此天然与发送时一致，无需任何编号字段（这条也是选位序而非稳定编号的工程理由：稳定编号必须
  把编号持久化并贯通快照/留存/恢复三面）。
- **一处计算**：`src/quote-card.ts`（与 `projectDelivery` 同层、同模块）新增两个纯函数，二者是本 change
  编号面的唯一真源：

  ```ts
  /** 块下标 → 编号（1-based，只数 image 块）。未编号的块（卡片 / 段落）不出现在表里。 */
  export function imageOrdinals(blocks: readonly ComposerBlock[]): ReadonlyMap<number, number>;
  /** 编号 → 引用 / 标签文本（`Image N`）：@ 插入、投递标签、卡片可访问名共用同一份格式。 */
  export function imageMentionText(ordinal: number): string;
  ```

  三个消费点全部引这两个函数，MUST NOT 各自实现一份：
  1. **卡片徽标**（§8）：两处块渲染点（`renderComposer` / `appendUserMessage`）先算一次
     `imageOrdinals(blocks)`，把编号随块下标传给卡片工厂（`createCardEl` 增一个编号参数；非图片块传
     `null`）。
  2. **`@` 钮**（§4）：插入 `imageMentionText(该卡片编号)`。
  3. **投递标签**（§5）：`projectDelivery` 在同一次遍历里给图片 part 带上
     `label: imageMentionText(n)`——`projectDelivery` 与卡片渲染各调一次 `imageOrdinals`，**同一函数、
     同一输入、同一输出**（「一处真源」指规则与实现只有一处，不是指缓存一份值）。
- **不变式（单测钉死）**：编号只数 `kind === "image"` 的块；编号与图片块在序列里的次序一一对应；纯文本 /
  仅卡片消息的 parts 与 panelText **逐字节**与今天一致（回归）。
- **作用域 = 单条消息**（裁决点 2 的 A）：composer 发送后清空，下一条消息从 1 重新开始；transcript 上的
  每条用户消息各自按自己的图序显示编号（消息发出即冻结其图序）。

## 4. 引用插入：`@` 钮与光标

- **钮**：只在 `createImageCardEl` 的 composer 态挂「插入引用」钮（`@` 形态），与既有 `×` 同为右上角的
  卡片动作钮（§8）；transcript 态 MUST NOT 有（已发送消息没有可插入的光标）。引用卡片 / 消息摘录卡片
  MUST NOT 有该钮。
- **落点**：点击 → `caretFromDom()` 取当前光标 → `insertPlainTextAtCaret(blocks, caret,
  imageMentionText(n))` → `withModel(...)` 重渲 → `composer.focus()` + `setDomCaret` 落插入文本之后。
  **零新机制**：段落中间拆段、插入后光标位置全部由既有纯函数给出（`insertPlainTextAtCaret` 已返回
  「光标落在插入文本之后」）。
- **光标来源的诚实边界**：composer 内卡片是 `contenteditable=false` 且整卡 `mousedown` 拦下
  （`src/harness-panel.ts:2347`），点卡片钮**不夺走 composer 的选区**——正常情况下 `caretFromDom()`
  就是用户点 `@` 之前的光标。取不到（面板刚打开未聚焦、选区在面板外）时按既有口径落 composer 末尾
  （`{block: blocks.length-1, offset: 0}`，与 `insertMessageQuoteCard` 同款兜底），MUST NOT 静默不动作。
- **事件处置**：同既有 `×` 钮——`mousedown` / `click` 拦截，插入完成后 `composer.focus()`。
- **引用文本是普通文字**：可编辑、可删除；图片被移除导致编号重编后可能悬空——系统 MUST NOT 扫描或改写
  用户正文（裁决点 1 的已知代价，proposal §Non-goals 已登记）。这是**可见**状态：徽标与正文同屏。

## 5. 投递：标签的注入点与留存形态

### 5.1 前端：编号进 parts（一处算）

`DeliveryPart` 的图片变体扩为 `{kind:"image"; name: string; label: string}`：
`projectDelivery` 在同一次遍历里按 §3 算出 n、填 `label = imageMentionText(n)`。`panelText` 侧**不变**
（仍是 `<image ref type width height/>` 占位行）——徽标是从块算的，占位行不需要携带编号，恢复路径因此
不需要新解析面。

### 5.2 后端：装配时把标签记成结构化字段

- `DeliveryPart`（`attachments.rs:33`）增 `label: Option<String>`；`parse_delivery_parts` 对**图片 part
  缺 label** 按非法 parts 拒绝本次发送（`harness_parts_invalid`，与既有非法 part 同码）——缺标签即等于
  破坏「模型看到编号」这条硬保证，MUST NOT 静默放行。
- `content_of_parts`（`:348`）装配图片 part 为
  `{"type":"input_image","image_url":"lumir-attachment://<name>","lumir_label":"Image N"}`。
  **`lumir_label` 是本地字段**：它只活在留存与装配面，发送前由展开链剥掉（§5.3），provider 永不看见。
  留存因此**可审计地**带着编号，而留存的**文本面**不含标签行（`panel_text_of_content` 只取
  `input_text` 的原文，图片 part 还原成 `<image …/>` 占位行）→ 恢复路径不会把 `Image N` 复现成正文。

### 5.3 wire：展开时生成标签行

`expand_image_refs_from`（`attachments.rs:247`）在既有「引用 → data URL」之外多做两步：
1. 取该图片 part 的 `lumir_label`，**剥掉该字段**（wire part 只剩标准的 `type` / `image_url`）；
2. 在图片 part **之前**插入一个 `{"type":"input_text","text":"<label>"}` part。

因此 wire 的形状是 `… [input_text "问题"], [input_text "Image 1"], [input_image dataURL], …`——模型读到
「编号 → 图」的紧邻配对。真 client（`llm.rs:418`）与 mock（`llm.rs:891`）同调这一条函数，验收可直接断言
`received_inputs` 里的形状（`llm.rs:821`）。

**恢复充分性口径的修订（延续 M440 的诚实声明）**：M440 已把「仅凭 JSONL 逐字节重建」改成「JSONL 引用 +
附件同 id 目录的字节」；本 change 再加一项**确定性的派生**——标签行由 `lumir_label` 生成，属可重建的规则，
不是新的事实源。留存的 messages 仍是发送前那份 input（`record_llm_request` 不做二次序列化），wire 与
留存的关系是一条单向、确定的展开链：`引用 → data URL`、`+ 标签行`、`- lumir_label`。

## 6. 恢复 / transcript / 快照

- **composer 快照**：编号是派生的，快照（块序列 → 面板文本 → `parseQuoteMessage`）**零改动**；恢复出来的
  块序列顺序不变，编号自然一致。
- **历史会话恢复**：`panel_text_of_content` 还原的占位行顺序 = 发送时的图片顺序 → `parseQuoteMessage`
  还原成同样顺序的图片块 → 徽标编号与发送时一致（位序规则保证）。**不新增任何编号字段**。
- **transcript**：`appendUserMessage` 用发送时的那份 `blocks` 渲染 → 编号即时由块序算出，与该消息 wire
  上的标签一致。
- **合并/压缩路径**：`DeliveryInput::from(String)`（`src-tauri/src/harness/turn.rs:187`）产出的单 text
  part 不含图片，编号面不涉及。

## 7. 与「零编号」原则的关系（修订的理由与边界）

- **原则原文**（`openspec/specs/harness/spec.md:334`，Alex 2026-10-06）：「序列化结构 SHALL NOT 包含任何
  编号……UI SHALL NOT 显示卡片编号」，理由是「投递给模型的上下文要素对人必须也可查……编号对人无区分
  价值故不进协议」。
- **对引用卡片，那句话今天依然完全成立**：`<quote>` 带 `file` / `heading` / `lines`、`<msg-quote>` 带
  `role` / `at`、摘录原文本身——agent 与用户都能按**出处**无歧义回指，「编号无区分价值」是真判断。
- **对图片块，前提变了**：wire 上的 `input_image` part **只有字节**（`image_url` 被换成 data URL，连内容
  寻址文件名都不可见）。一张图在投递里**没有任何可被人类话语指向的身份**——「第 2 张」这句话在 wire 上
  不存在对应物。**因此编号对图片不是冗余，而是唯一可用、且必须有的一种身份**；不给编号，硬保证就落空。
- **修订的边界（本 change 的 MODIFIED 只做这件事）**：编号禁令的适用范围收窄为「引用卡片与消息摘录
  卡片」；图片块按「图片编号与引用」携带标签。UI 侧同理：引用卡片不显示编号，图片卡片显示编号。
- **归档前对账**：M440 的「图片消息投递协议」里那句「文本 part 的序列化 MUST NOT 包含卡片编号」须与
  本次修订同口径（见 tasks §6），避免 living spec 里出现互相矛盾的两句。本 change 的增量**不**去改那个
  尚未归档的 requirement（`validate` / `archive` 的机制约束，§1 末条）。

## 8. 视觉口径（徽标与两钮）

无 repo 内原型；Alex 附的 Kimi Code Web 截图为行为参考（hover 出 `@` / 删除两钮、`@` 在光标处插引用）。
本节的形态默认值供实现期落地，**屏位细节以 Alex 过目实现截图为准**（手感/审美不下沉，见 AGENTS.md）。

- **编号徽标**：图片卡片**缩略图左上角**的小圆角徽标，内容就是裸编号 `1` / `2`（不带 `Image` 字样——
  与投递标签的完整形态 `Image N` 是同一份编号的两种呈现，N 一致即可核对）。字号取既有 `--fs-micro`
  档、底色用既有 token（半透明深底 + 浅字，或 `--agent-bg` + `--text-3` 边框，实现期按对比度定），
  尺寸 ~16px 见方、`border-radius: var(--r4)`。**元信息行保持 M440 的裁决不变**（从文件名开始、无
  `image ·` 前缀）——编号走徽标，不回头往元信息行塞前缀。徽标对读屏可访问：transcript 卡片的 aria 名
  （D447）改形为含编号的形态（如 `图片 {n}：{name}`），composer 态徽标挂 `aria-label`（同一文案）。
- **两钮**：卡片右上角动作区放 `@` 与既有 `×`。可见性取裁决点 5 的 A（恒显、与既有 `×` 同口径）：
  今日 `.lumir-hp-qc-x`（`src/harness-panel.css:1591`）本就恒显。实现建议把两钮收进一个绝对定位的
  动作容器（flex、`gap: var(--sp-1)`），`@` 钮复用 `×` 的尺寸与 hover 样式族（新类 `.lumir-hp-qc-at`），
  不改既有 `×` 的可见行为。
- **不改的**：缩略图尺寸/`object-fit`、加载中与失败占位、错误态（能力闸）语义色、eink 降级规则、
  卡片边框/圆角/底色/边距——本 change 只加一个徽标与一个钮。
- **手感项（不进机器判据）**：徽标的确切位置与对比度、两钮的可见性最终形态（A/B）、`@` 字形与 hover
  提示的措辞观感。

## 9. 与 M444（composer-intercard-caret）的依赖声明

- M444 修订的是**卡片间光标位的落点规则**（在途提案，未合并）。本 change 的 `@` 引用插入依赖的只是
  「存在光标位」这一既有概念与 `insertPlainTextAtCaret` / `insertBlockAtCaret` 的既有语义，**不依赖 M444
  的任何具体规则、也不预设它的实现**。
- **无合并顺序依赖，各自独立可批**：
  - 本 change 先合 → 引用插入按当时（M444 之前）的光标模型落点；M444 合并后引用插入自动按修订后的规则
    落点（同一份 `caretFromDom()` / `insertPlainTextAtCaret` 路径），无需改动本 change 的代码。
  - M444 先合 → 引用插入直接按修订后的光标模型落点。
- 冲突面无交集：M444 改的是光标落点计算，本 change 改的是卡片动作钮与投递标签；两处唯一的接触点是
  「光标处插入文本」这条既有路径的调用，属稳定接口。

## 10. 验收面（机器判定锚点）

- **单元/属性测试**（tests/unit，零 DOM）：
  - `imageOrdinals`：只数 image 块、1-based、与块序一一对应、移除后重编为无空号序列；
  - `imageMentionText(1) === "Image 1"`（形态固定，供 `@` 插入与投递标签共用）；
  - `projectDelivery`：图片 part 带 `label` 且与块序编号一致；**纯文本 / 仅卡片消息的 parts 与 panelText
    与今天逐字节一致**（回归）；`panelText` 不因本 change 变化；
  - `insertPlainTextAtCaret` 的既有不变量回归（引用插入复用它，零新机制）。
- **Rust 单测**（`attachments.rs` 既有测试族）：
  - `parse_delivery_parts`：图片 part 缺 `label` → 拒绝；齐备 → 通过；
  - `content_of_parts`：图片 part 带 `lumir_label`、文本 parts 面**不含**标签行；
  - `expand_image_refs`：每个图片 part 前生成标签 `input_text`、`lumir_label` 被剥掉、`image_url` 仍是
    data URL、无引用路径仍是零副作用早退（`input.to_vec()`）；
  - `panel_text_of_content`：还原文本不含标签行、占位行顺序不变。
- **真机验收场景**（scripts/acceptance，mock provider，fixture 全合成；mock 的 `received_inputs` 是断言
  数据源）：
  1. 贴两张图 + 用 `@` 在光标处各插一次引用 + 发送 → wire 的 content 数组里每个 `input_image` **之前**
     有标签 `input_text`，两个标签的编号与卡片徽标逐一对上；
  2. 该轮 `llm_request` 留存：user 项的**文本面不含** `Image N` 行、图片 part 带 `lumir_label`、
     **无 base64**（沿用 M440 的反向断言）；
  3. 恢复会话后各图片卡片徽标编号与发送时一致、恢复出的正文不出现多余标签行；
  4. 移除一张图后余图徽标即时位序重编；
  5. 回归：引用卡片 / 消息摘录卡片在界面与 wire 上仍零编号。
- **视觉**：图片卡片（composer 态：徽标 + 两钮 / transcript 态：徽标 / hover 态）新增场景基线，Alex
  过目后 `--update`；动过 `src/harness-panel.css` → 跑 `gate.sh visual`，既有基线按纪律核对时间戳。
- **门禁**：`bash scripts/gate.sh quick` 全绿；`npx --yes @fission-ai/openspec@1.12.0 validate --all
  --strict` 通过。

## 11. 后续项（本 change 不做，登记 backlog）

- **位序编号的悬空窗口**：删除图片后，已插入正文的引用文本可能指向不存在的编号。若 dogfood 证明这条被
  常踩，升级路径是裁决点 1 的 C / 裁决点 3 的 B（原子引用块 + 稳定身份，徽标与引用联动重编）——设计上
  已留出（编号集散在 §3 那两个纯函数里）。
- **编号作用域若改为会话连续**：需要重新设计「删除历史消息」与编号的关系（裁决点 2 的 B 已记代价）。
- **M440 的归档对账**：见 §7 与 tasks §6。
- **文案 deck 编号**：`@` 钮读屏名与新卡片可访问名取当前末位之后（M440 用到 D451），实现期按
  `文案-Copy.md` 的「只追加」纪律重核末位，不背口头值。
