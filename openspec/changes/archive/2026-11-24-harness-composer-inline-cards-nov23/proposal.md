# Proposal: 输入区卡片与文字有序混排（零长度块级 widget）

- Change ID: `harness-composer-inline-cards-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **影响面升级已裁（2026-11-23）**：Alex 在 B-0 影响面升级说明后明确「按推荐执行」——推翻
>   2026-11-18 的「取消文字 / 卡片任意交错」，**只恢复有序混排**；卡片仍零长度、caret 进不去、
>   不能靠键盘删卡、不能跨卡选内容。**不回到 contenteditable 双拥有模型。**
> - 本文件记录这次正式改裁与 B0–B5 批准值（见「裁决记录」）。B0–B5 不再待裁。
> - **节点 1（提案评审）已通过（2026-11-23）**：Alex 依据「按推荐执行」及完成的方案评审批准
>   进入实现。本次通过只确认「按已批准值写成的方案可施工」，不重裁 B0–B5。
> - 视觉基线是**人肉裁决点**：`--update` 前候选截图必须先给 Alex 过目，未批不得 update。
> - **节点 2 材料已备（2026-11-24）**：最终集成 tip `fd72c2ae`；独立评审 r6 clean / merge；
>   八组真机 8/8 PASS（185.5s）；quick 与完整视觉均为 `GATE RESULT: 15/15 PASS（SKIP 0）`
>   （集成视觉 1338 passed / 1 skipped）；三主题候选经 Alex 批准且无需重截基线；archive-check
>   12 条 MODIFIED / 92 段 PASS。
> - **内存例外（2026-11-24）**：真实 release A/B 为 master 262.64MB、composer 267.75MB，二者均超
>   250MB 门禁，composer 高 5.1MB；keypress median 9.60ms。Alex 明确「允许 composer 内存例外」，
>   允许按功能证据合并归档，但不宣称内存验收通过，发布说明保留本地未达标与内存专项。
>   实现与节点 2 材料已合并推送至 master（`a539f52f`）；本次提交执行归档，living spec 已由
>   归档包装器并入。

## 裁决记录（2026-11-23）

### 正式改裁

2026-11-18 的 change `move-composer-to-codemirror-nov18` 为了消掉 `contenteditable` 与自管块模型
「双重拥有文本 / 结构 / 选区」派生的一族缺陷（HC1–HC6），在 proposal 里写死了三条否决：

- `openspec/changes/archive/2026-11-19-move-composer-to-codemirror-nov18/proposal.md:51`：「不用
  CM block / inline widget 重建混排卡片，不引入文本位置锚点来暗中维持旧交错」。
- 同文件 `:44`：「明确取消……文字 / 卡片任意交错」。
- 同文件 `:37`：「CM 内嵌卡片 widget 仍保留卡间 caret 与跨卡选区」。

现行 living spec 把它固化成条款：`openspec/specs/harness/spec.md:2588`「附件 tray 在**编辑区外**……
卡片 MUST NOT 作为 CM 文本内的原子 block / widget」，`:2590`「新输入 MUST NOT 支持文字 / 卡片任意
交错」。

这次改裁只推翻**「取消交错」这一半**：

- **恢复**：卡片按位置与文字混排，视觉顺序 = 投递顺序 = 历史顺序。
- **不恢复**：contenteditable 编辑面、卡片可编辑 / 可聚焦、卡间 caret、跨卡选区、Backspace /
  Delete 删卡、块级自绘选区高亮。
- 新的形状严格更窄：卡片是**零长度块级 widget**，文档里没有任何卡片占位字符；「卡间 caret」
  与「跨卡选区」在模型上不可表达，不是靠约定禁止。

### B0–B5 批准值

| # | 批准值 | 本提案的实现口径 |
|---|---|---|
| **B0 改裁** | **推翻「取消交错」，只恢复有序混排**；卡片零长度、caret 进不去、不能键盘删卡、不能跨卡选内容 | 零长度 block widget；文档只承载问题文字；卡片只经 × 移除 |
| **B1 落位** | **卡片恒在 caret 处：caret 行上方**；插入后 caret 停在该行行首（卡片正下方） | **初始插入**按「边界的取法」；插入后 anchor 是行首，后续编辑不钳行首（见「1. 模型：卡片有位置」） |
| **B2 行中插卡** | **拆行**：插一个真实换行 | 拆行与卡片 effect 在**同一条 transaction**，一步 undo 全还原 |
| **B3 图片编号** | **不冻结**，沿用派生读数 | 编号按**块序**派生；徽标、`@`、投递共用同一函数；已插入的 `Image N` 文本不被改写 |
| **B4 复制** | **只复制文本**，不带卡片 | `⌘A` / `⌘C` 只作用于 CM 文档；剪贴板无卡片文本、无占位字符、无哨兵字符 |
| **B5 草稿** | **v2 读时归一到 v3 并立即写回**（同 v1→v2 的一次性迁移） | v3 = `{version:3,text,caret,cards:[{card,at}]}`；v2 全部卡片落 `at:0`；v1 同路径直达 v3；Rust 零改动 |

### 边界的取法（施工核对项，不重新裁 B0–B5）

设计输入写了两条规则：「卡片恒在 caret 所在行上方」与「文档末尾直接插卡时补一个 `\n` 造出下方
那一行」。这两条在「caret 在某行行尾、且该行不是末行」时没有定义。本稿按「**插入在 caret 处：
caret 之前的文字在卡上方、之后的文字在卡下方**」统一：

- caret 在行首：锚在该行行首，卡在该行上方。
- caret 在行中：在该处拆行，卡在新行上方（= 前半行之下、后半行之上）。
- caret 在行尾（非末行）：锚在**下一行**行首，卡在当前行之下、下一行之上；不额外插入空行。
- caret 在文末：在文末补一个 `\n`，锚在新行行首，卡在全部文字之下。

理由：设计输入自己给出的文末补行例外，已经说明规则不是字面的「永远在 caret 行上方」，而是
「卡落在 caret 处」；行尾与文末同构补齐，才与「先打字再插卡 → 文字 / 卡 / 文字」一致。
**这是施工口径，不是新的 B0–B5 裁决点**：实现期发现它与已批准值冲突时，停下返修制品并记录，
不重新请 Alex 裁 B0–B5。

### 另一处施工口径：IME 组合期插卡 FIFO

组合期间插入卡片需要改文档（补换行），会打断组合。本稿取：**组合期间的插卡请求进入 FIFO 队列，
延迟到 compositionend 后按序 drain**；每条请求只有成功落入 composer 后才出队；发送投影前先
drain，当前事件序无法安全完成时**延迟发送**，MUST NOT 清空队列。延迟期间的发送意图由**单个
`pendingSend`（带视图世代）**承载：重复触发合并为一次；`compositionend` drain 成功后仅触发
一次；切 vault / 新会话 / 面板销毁同时取消；drain 失败取消发送、保留未消费请求，MUST NOT 投递
缺卡消息。组合中的文本 MUST NOT 丢失、组合 MUST NOT 被打断。移除卡片不改文档，可立即生效。
此口径写进 delta 的场景，不留给实现期猜。

## Why

### 现场

Alex 的复现步骤：输入两句问题 → `Enter` 开新行 → 点「摘录到对话」插入 quote 卡片 → 卡片出现
在那句话**之前**。根因是模型里卡片没有位置：

| 事实 | 位置 |
|---|---|
| `ComposerContent` = `{ text, caret, cards }`：文字是一份 CM doc，卡片是一个**独立数组** | `src/harness-composer.ts:40-44` |
| 卡片存在独立 `StateField`，append 的 `at` 是**数组下标** | `src/harness-composer.ts:52-67` |
| 撤销靠 `invertedEffects` 生成逆 effect，也只操作数组 | `src/harness-composer.ts:69-90` |
| **`composerBlocks()` 直接返回 `[...cards, paragraph]`** | `src/harness-composer.ts:185-190` |
| 卡片 DOM 全部渲染在编辑区**外的 tray**，tray 在 CM 之前 | `src/harness-panel.ts:3737`、`:3796`；`src/style.css:306-317` |
| 四个插卡入口全部收敛到 `appendAttachments` | `src/harness-panel.ts:4751`、`:4779`、`:4787`、`:10107-10152` |
| 投递按**块序**产出 parts，交错完全支持 | `src/quote-card.ts:251-298` |
| 历史消息的交错解析 / 序列化**已经互逆**（有测试钉住） | `src/harness-panel.ts:456-550`；`tests/unit/harness-composer.test.ts:22-38` |
| 草稿 v2 = `{version,text,caret,cards}`，同样无位置 | `src/quote-card.ts:324-349`、`:365-402` |
| 发送被拒的合并是「原文在前、当前在后」 | `src/harness-composer.ts:159-169` |
| `@` 提及按钮用**块数组下标**取编号（与 cards 下标今天是同一个数，交错后必然分家） | `src/harness-panel.ts:4541`、`:4722` |

一句话：**卡片没有位置，只有一个先后数组；块序是「卡片全部在前、问题在后」硬编码出来的。**

### 为什么现在值得做

- 位置感是需求本身：用户按「这句之后插一张卡」的直觉操作，产品却把卡放到最前面；dogfood 已
  反复出现。
- 投递协议与历史解析**不需要改**：`projectDelivery` 早就按块序工作，`parseQuoteMessage` /
  `serializeQuoteMessage` 对「问题1 / 卡片 / 问题2」已原样往返，Rust 侧的
  `apply_context_section` 只是「拼进最后一个非图片 text part」（`src-tauri/src/harness/attachments.rs:447-471`）。
  这是**纯前端改动**。
- 新形状不回到旧根因：卡片是零长度、不可编辑、不可聚焦、不可选择的块级 widget；没有
  contenteditable 双拥有、没有 DOM↔block 映射、没有占位字符。

### 为什么不是「只改顺序、不改观感」

备选 B2（卡片仍在 tray，按锚点排序、卡上显示顺序号）最省，但不满足「按位置排列」的观感；
Alex 要的正是观感。B3（U+FFFC 哨兵字符）会把不可见字符带进复制与文档，正是本仓反复收口的
「隐藏结构」；B4（回 contenteditable）直接走回 HC1–HC6 的根因。

## What Changes

### 1. 模型：卡片有位置

- 每张卡片从 `ComposerAttachment` 变成 `{ id, card, anchor }`：
  - `id` 是会话内单调插入序号，**只作稳定身份**（撤销按 id 定位），不进草稿、不进 wire。
  - `anchor` 是文档中的**精确 UTF-16 偏移**（`0 <= anchor <= doc.length`），**不要求行首**。
- 卡片数组始终保持**视觉顺序**（按 anchor 排序；同锚点按到达次序）。阅读顺序、`composerBlocks()`
  与投递顺序因此是同一件事。
- **块级 widget 在 anchor 偏移处把文本拆成前后两块**：偏移之前的文字在卡上方、之后的在卡下方；
  偏移恰在行首时卡落在两行之间。行首只是**初始插入**的产物，不是后续编辑的不变量。
- 文本编辑后 anchor 随 `tr.changes.mapPos(anchor, -1)` 做精确映射，**MUST NOT 钳到行首**。
  `assoc = -1`：在锚点处键入 / 粘贴的文字一律落在卡片下方；anchor 之前的插入把它后移；覆盖
  anchor 的删除把它收到删除点。删除行界后 `A / card / B` 仍是 `A / card / B`。
- **history 可逆性不能只靠 `mapPos`**：新增 `composerAnchorsSyncEffect`，由事务扩展器把事务后的
  完整 placed-attachment 数组写入事务；`invertedEffects` 只为它产出逆 effect（携带事务前数组）。
  undo / redo 直接恢复该数组，删除行界、跨行删除、⌘A 替换后都能还原原 anchor 与 `composerBlocks`。
  结构 effect 不再单独提供逆 effect；undo / redo 事务不再追加前向 sync effect。
- **非 history 文档变更禁止**：composer MUST NOT 在现有 history 上执行 `addToHistory: false` 或
  `remote` 的 doc 变更——这类变更会被 CM history 当成 mapping 去改写旧事件，而 sync effect 的
  identity map 无法同步旧快照，组内 undo 会双重位移 / 恢复过期 anchor。装载 / 复位（草稿恢复、
  切 vault、新会话、发送清空）MUST 新建 `EditorState` 重置 history；若未来必须支持这类变更，
  另设计快照映射，禁止简单给 sync effect 加 `mapPos`。

### 2. 落位与插入

- 卡片恒插在 caret 处：caret 之前的文字在卡上方、之后的文字在卡下方（B1，边界见上）。
- 行中插入先拆行：插入一个真实 `\n`，卡在新行上方；拆行与卡片 effect 在**同一 transaction**。
- 行尾插入：其后还有行时锚在下一行行首（不额外插空行）；文末插入补一个 `\n`；空文档不补
  （卡在上方，caret 在下方）。
- **以上只约束初始插入**：插入后的 anchor 是行首；后续文本编辑让 anchor 精确移动，不钳行首。
- 插入后焦点留在文本编辑区，caret 落在卡片正下方的行首；随后键入从那里开始。
- 同锚点多卡合成一个 widget，内部纵向堆叠；新插入的卡在该锚点堆叠的底部。

### 3. 渲染：零长度块级 widget，tray 退役

- 每张卡是 `Decoration.widget({ block: true, side: -1 })`，位置 = anchor；CM 给 widget 设
  `contenteditable="false"`，光标进不去、键入落不进去。
- 同锚点多卡合成**一个** widget，避免「同位置多个 block widget 排序无定义」。
- 块级 widget 在该偏移把文本拆成前后两块；偏移在行中时该行被拆开，**doc 里没有新增换行**。
- 卡是真正的块元素，**不需要任何占位字符**。
- 编辑区外 tray DOM 整体退役；`.lumir-hp-composer-tray` 的 CSS 删除。
- 卡片 DOM 复用既有 `.lumir-hp-qcard` 整族样式；widget wrapper 用 padding 承担纵向间距
  （CM 要求 block widget 不带纵向 margin）。

### 4. 不可编辑、不可跨选、不能键盘删卡

- 卡片 MUST NOT 可编辑、MUST NOT 获得键盘焦点、MUST NOT 参与文本选区。
- 卡片零长度 ⇒ 文档里没有「卡片之间」或「卡片里面」的位置；卡间 caret 与跨卡选区在模型上
  不可表达。
- `⌘A` 只选文本；`⌘C` 只复制文本（无卡片文本、无占位字符）；`Backspace` / `Delete` 只删文本，
  卡片只经 × 移除。
- 跨过卡片的文本选区仍是纯文本选区；删除只删文本，卡片保留并按精确偏移映射（MUST NOT 钳回行首）。

### 5. 投递、历史、重试

- `composerBlocks()` 按 `(anchor, 视觉次序)` 把文档在每个锚点**偏移**处切开、与卡片交错产出；
  `projectDelivery` 仍是唯一投影点，wire 协议不变。
- 文本区无卡片时，`panelText` 与「单段落文档的现行投影」**逐字节相同**（注意：不是与文档原文
  逐字节相同——段落要过 XML 转义，这是既有行为）。
- 有卡片时，`panelText` = 把文档在每个锚点偏移处切开、插入该锚点上的卡片行后拼回；`parts` 按
  块序 flush 文本 / 图片。锚点在行首时去掉锚点前的行界再拼回；在行中时按偏移直接切。
- 历史消息解析与 JSONL 逐字节不变；重试仍只回放 `input` 历史里的 user 消息，不做二次投影。

### 6. 图片编号与 `@`

- 编号仍是派生的：按**块序**只数图片块，1-based、无空号；移除后即时重编。
- composer 徽标、`@` 插入、投递标签共用同一编号函数。
- `@` 按钮从「按数组下标取编号」改成「按附件 id 在块序里反查编号」；这是本需求唯一的隐藏耦合。
- 已插入的 `Image N` 文本不被后续重编静默改写（B3 不冻结编号，但不回写历史文本）。

### 7. 草稿 v3 与发送被拒合并

- 草稿升级为 `{version:3,text,caret,cards:[{card,at}]}`；`at` = 该卡的**精确 UTF-16 偏移**
  （不要求行首）。**CRLF 归一放在所有版本解析 / 迁移完成后的共同出口**：v1 / v2 / v3 先各自
  解析成同形状草稿（原始坐标），再统一把 `\r\n` / `\r` 归一为 `\n`，并用同一映射重定位 caret
  与每张卡的 `at`；归一后的草稿同时用于**写回 v3**与**创建 state**。v2 的「原样保留」改为
  「可见内容保留，行尾及坐标按统一映射归一」。
- v2 读到 → 全部卡片落 `at:0`（正好等于今天「卡片全在前」的语义），成功后立即经既有串行 store
  写回 v3；v1 读到 → 沿用既有一次性转换，再直接落 v3。不双写、不保留旧渲染路径。
- Rust 侧只搬运 JSON 字符串（`src-tauri/src/harness/draft.rs:56-66`），**零改动**。
- 发送被拒合并：原文在前、当前在后；当前卡片的 anchor 平移 `restored.text.length`，再按精确
  偏移稳定排序。精确偏移模型下**不需要补 `\n`、不需要钳行首**：卡片平移到原文末尾后由 widget
  在该偏移拆文本，自然落在原文之后、当前文字之前。

### 8. 从属措辞对齐（防止 living spec 自相矛盾）

六条主 requirement 之外，另需同步六条既有 requirement 里已被本次改裁作废的措辞：

| requirement | 旧措辞 | 新措辞 |
|---|---|---|
| 「摘录引用卡片」 | 加入「编辑区外 tray」 | 按落位规则加入对话输入区 |
| 「消息摘录序列化协议」 | `<msg-quote>` 位于「完整问题文字之前」 | 按块序投影落在各自锚点位置 |
| 「区外图片附件编号与引用」 | 按「图片附件顺序」编号 | 按**块序**编号；`@` 按 id 反查 |
| 「区外消息摘录附件」 | 「插入不拆文本、不动 caret」 | 按落位规则插入，可能拆行、caret 落到卡下方 |
| 「CM composer 的 Emacs 文本导航族」 | 「附件 field 逐字段不变」 | 不增删卡片、相对顺序不变；anchor 随文档映射 |
| 「CM composer 的文本全选」 | 「附件保持不变 / 数据不变」 | 卡片数量、身份与相对顺序不变；anchor 随文档映射 |

不做这六条，归档后的 living spec 会同时说「卡片在编辑区外」与「卡片是编辑区内 widget」——下一
次引用旧句就会重演 REVIEW.md「同一语义两处真源」条的误引用现场。

### 9. 标题保持不变（归档身份）

六条主 requirement 的标题（含「区外附件」「附件前置」字样）**不改**：`openspec archive` 按标题
匹配 MODIFIED，改标题会落成「新 requirement + 悬挂的旧 requirement」。仓内先例与理由见
`openspec/changes/archive/2026-09-28-bare-url-cmd-click/design.md:56`。delta 正文第一句写明
「标题沿用归档身份，现行语义以本条正文为准」。

## Non-goals

- **不回到 contenteditable**、不自管块模型、不做 DOM↔block caret 映射、不做块级自绘选区。
- 不做卡片编辑（改摘录文字 / 换出处 / 富文本）、不做卡片拖拽排序、不做卡片嵌套。
- 不做卡间 caret / 跨卡选区 / Backspace·Delete 删卡 / 卡片键盘焦点（B0 的「不恢复」半边）。
- 不写入任何占位字符（U+FFFC 或其他哨兵）；文档任何时刻只有问题文字。
- 不改 `harness_send` / `parts_json` / `context_json` / JSONL / Rust 投递协议 / 图片字节格式；
  Rust 零改动。
- 不改历史已发送消息的解析、呈现或 JSONL；不做历史消息迁移。
- 不新增视觉语言：卡片样式、配色、主题、eink 分叉沿用既有；不新增整页像素基线，除非
  Alex 过目批准。
- 不把 `⌘C` 做成「带卡片标记的富文本 / XML」；不做「复制为引用」。
- 不在本 change 内做需求 A（`/skill` 候选浮层）；两者不合并 proposal。

## Impact

- 影响的 specs：`harness` 一个 capability。
  - `MODIFIED` 六条主条：「CM 对话输入区与区外附件」「CM composer 的单一 history」「新消息的
    附件前置序列化协议」「区外图片附件粘贴」「附件前置图片投递协议」「composer 草稿 v2 与一次性
    v1 转换」。
  - `MODIFIED` 六条从属条：「摘录引用卡片」「消息摘录序列化协议」「区外图片附件编号与引用」
    「区外消息摘录附件」「CM composer 的 Emacs 文本导航族」「CM composer 的文本全选」。
- 影响的合同文档：
  - `docs/specs/harness-composer.md`：HC1–HC6 整体重写（精确偏移、sync effect、IME FIFO、
    块序投递、v3 + CRLF、证伪方式），并清扫 M831 的 tray / 附件前置 / 行首 anchor 术语。
- 影响的代码 / 系统（概述，不写实现细节）：
  - 前端 composer 状态：卡片记录加精确 anchor / id；`composerAnchorsSyncEffect` + 事务扩展器 +
    `invertedEffects`；插入、移除、精确映射；`composerBlocks()` 的偏移切分；草稿 v3 与 v1/v2
    读时归一 + CRLF 坐标映射；发送被拒合并。
  - 前端渲染：新 block widget（DOM 复用既有卡片工厂）、tray 退役、缩略图缓存 prune 时点、
    占位符显隐、`@` 编号反查。
  - 测试：composer 单测重写（投递 golden、删除行界 / undo 精确锚点、同步 effect、草稿 / CRLF、
    合并、编号、性能）；视觉场景把 tray 选择器改成 widget 选择器；验收套件新增 scoped AX 断言；
    真机场景回扫「插入不动 caret」的旧期望，并补删除行界 / undo / IME 连续两卡。
  - Rust：零改动。
- 关联约束：
  - ADR 0002 第 6 条性能合同：每次击键只做 O(卡片数) 的锚点映射与装饰重算；widget `eq` 命中时
    不重建 DOM、不重发读图命令；无新增定时器、无每键 IO。
  - ADR 0003：不改写 vault 源文件；卡片只读引用。
  - ADR 0004：节点 1 未过，本文件不构成施工依据。
  - 仓库信息卫生：单测 / 视觉 / 验收 fixture 只用合成摘录与合成图片名。

## 风险与失败模式

| 风险 | 处置 |
|---|---|
| 旧「行首 anchor + 钳制」删除行界后把卡从 A 后移到 A 前，undo 回不去 | 精确偏移 + `composerAnchorsSyncEffect` 可逆 history；删除行界 / 跨行删除 / ⌘A 替换 / undo 的 `composerBlocks` 与每张卡 anchor 先红后绿 |
| 只靠 `mapPos` 反推，删除覆盖 anchor 后 undo 回不到原偏移 | sync effect 携带事务前完整数组；undo/redo 直接恢复；结构 effect 不再单独提供逆 effect |
| 在 undo/redo 事务上再追加前向 sync effect，覆盖精确恢复值 | 事务扩展器按 `userEvent`（undo / redo / select.undo / select.redo）跳过 |
| `addToHistory:false` / `remote` 文档变更走现有 history，identity map 让旧 sync 快照过期，undo 双重位移 | 禁止此类变更；装载 / 复位一律新建 `EditorState`；加分组 undo/redo 与非 history 禁止路径测试；不给 sync effect 加 `mapPos` 补洞 |
| widget 每次重建 → 缩略图重发、点击态丢失、按键卡顿 | `eq` / `updateDOM` 按 `(id, card, ordinal)` 判等；200 字连续输入 + DOM 身份复用 + 图片读回计数不增的测试 |
| 同锚点多卡堆叠顺序在行合并后翻转 | 卡片数组保持视觉顺序；映射后按新 anchor **稳定排序**（同锚点保持原相对次序）；sync effect 恢复原数组 |
| 行中拆行与卡片 effect 拆成两步 undo | 同一 transaction；单测先红后绿钉死「一步 undo 全还原 / redo 全恢复」 |
| `@` 编号仍按数组下标取 → 交错后编号错位 | 唯一派生函数（块序 → 编号 / id → 编号）；`@` 点击时按 id 反查；单测覆盖「删前图后编号变化」 |
| 复制把卡片文本 / 占位字符带出 | 零长度 widget 使「复制带卡」物理不可能；应用内 copy event 逐字节；外部剪贴板按平台归一比较，负向断言无卡片 / × / @ / 哨兵 |
| AX 有序断言被编辑器原文假绿 / 误伤编辑器原文 | 顺序断言与负控限定 composer 子树；负向只断言卡片标记不在 **composer 的** `AXTextArea.value`，编辑器源文档允许原始摘录；卡片不可编辑 / 不可聚焦；不可读 FAIL |
| IME 组合期插卡打断组合 / 发送丢掉已请求的卡 / 延迟发送重复触发 | FIFO 队列；单个 `pendingSend`（带视图世代）去重；compositionend drain 成功仅触发一次；切视图取消；drain 失败取消发送、保留未消费请求；连续两卡 + 重复触发 + 切视图 + 失败三组测试 |
| 发送被拒合并把当前卡片放到原文之前 | 精确偏移平移（不补换行、不钳行首）；单测覆盖「原文末尾无换行 + 当前侧有卡」 |
| CRLF v1/v2/v3 坐标错位 | 所有版本解析 / 迁移后的共同出口归一文本 + 同一映射重定位 caret / `at`；写回 v3 与创建 state 用同一份归一草稿；补 CRLF v2 caret 与混合行界 v1 |
| 视觉层走样（卡与文字间距翻倍 / 占位符压住卡 / 行中 anchor 拆行） | widget wrapper 用 padding、相邻卡不叠双倍间距；占位符只在文本与卡片都为空时出现；候选截图覆盖行中 anchor；并排截图 + 像素候选 |
| 既有场景大量断言「插入不动 caret」→ 假红 | tasks 的「场景回扫」逐份改准；只新增覆盖不算完成 |

## 备选（未采纳，供节点 1 对照）

| 备选 | 形态 | 代价 / 为什么次选 |
|---|---|---|
| **B2 只改顺序不改视觉** | 卡片仍在 tray，按锚点排序、卡上显示顺序号 | 最省，Rust 与 CM 都不动；但不满足「按位置排列」的观感 |
| **B3 正文塞哨兵字符** | U+FFFC 占位，replace 装饰遮住 | 复制带出哨兵字符；文档里有用户看不见删不掉的字符 |
| **B4 回 contenteditable** | — | 直接走回 HC1–HC6 的根因，不做 |
| **B5 锚在行尾（WidgetAfter）** | 卡落在 caret 行下方 | 与 B1 只差一个方向；「先打字再插卡」的直觉顺序相反，文档末尾要额外处理 |
| **B 不做 / 维持原裁决** | 卡片全部前置 | 放弃 Alex 要的观感；本 change 不成立 |

## 施工核对项（不重新裁 B0–B5）

以下不是新的裁决点；B0–B5 已裁，下面只是实现期必须照做的核对项。发现与已批准值冲突时，停下
返修制品并记录，不重新请 Alex 裁 B0–B5。

1. **行尾落位**：caret 在非末行行尾 → 初始 anchor 锚到下一行行首、不额外插空行；后续编辑不钳
   行首。实现期按 design §3 / delta 场景核对。
2. **IME FIFO**：组合期插卡请求排队；发送前 drain；无法安全 drain 则延迟发送；成功后才出队，
   MUST NOT 清空。连续两卡场景先红后绿。
3. **标题稳定**：六条主 requirement 标题不变（归档身份）；MODIFIED 块的场景标题必须与现行 spec
   同名（`validate --strict` 硬要求）；旧标题里的 tray / 附件前置 / 不拆文本是历史措辞。
4. **从属 requirement**：六条从属措辞对齐纳入本 change（不纳入则 living spec 自相矛盾）。
5. **HC 合同**：`docs/specs/harness-composer.md` 的 HC1–HC6 随本 change 同步重写，列入 tasks。
6. **视觉基线**：`--update` 前候选截图先送 Alex 过目，未批不 update；这是人肉裁决点，不是
   B0–B5 重裁。
