# Design: composer 卡片与文字有序混排（精确偏移块级 widget）

- Change ID: `harness-composer-inline-cards-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 本文是节点 1 的技术附件：回答「按 B0–B5 批准值怎么施工、边界在哪、怎么验」。
> B0–B5 的裁决记录在 [proposal.md](proposal.md)「裁决记录」节，本文不重复裁决理由。
>
> 2026-11-23 独立评审 `needs-changes` 后的返修：anchor 从「行首 + 钳制」改为**精确 UTF-16 偏移**；
> history 用 `composerAnchorsSyncEffect` 做可逆映射；IME 请求 FIFO drain；AX 断言限定 composer
> 子树；CRLF 在创建 state 前归一；同步 `docs/specs/harness-composer.md` 的 HC1–HC6；补性能任务。

## 1. 形状一句话

**卡片是文档中某个精确 UTF-16 偏移处的零长度块级 widget；文档只承载问题文字；widget 在该偏移把
文本拆成前后两块；阅读顺序、投递顺序、历史顺序是同一份块序。**

与 2026-11-18 的旧形状对比：

| | 旧（contenteditable 混排） | 2026-11-18 起（tray） | 本 change |
|---|---|---|---|
| 文本真源 | contenteditable DOM + 自管块模型 | CM doc | CM doc（唯一） |
| 卡片位置 | 块数组下标 | 无位置 | 精确 UTF-16 偏移 |
| 卡片可编辑 | 是（块内） | 否 | 否 |
| 卡间 caret / 跨卡选区 | 可表达 | 不适用（区外） | **模型上不可表达** |
| 键盘删卡 | 是 | 否 | 否 |
| 占位字符 | 有块结构 | 无 | **无**（零长度 widget） |
| 投递顺序 | 块序 | 卡片全在前 | 块序 |

## 2. 数据模型

```ts
// src/harness-composer.ts
export interface PlacedAttachment {
  /** 会话内单调插入序号；只作稳定身份（撤销按 id 定位），不进草稿、不进 wire。 */
  readonly id: number;
  readonly card: ComposerAttachment;
  /** doc 中的精确 UTF-16 偏移，0 <= anchor <= doc.length；不要求行首。 */
  readonly anchor: number;
}

export interface ComposerContent {
  text: string;
  caret: number | null;
  cards: readonly PlacedAttachment[];
}
```

- `ComposerAttachment`（`src/quote-card.ts:110-114`）不变：仍是 quote / msgquote / image 三种。
- 卡片数组始终保持**视觉顺序**：按 `anchor` 升序；同锚点按到达次序。`composerBlocks()` 只需一次
  线性走查。
- `id` 由模块级单调计数器分配；`createComposerState` 对没有 id 的入参（草稿恢复、测试）按数组
  顺序补号。合并两个快照时两边的 id 都来自同一计数器，不会撞号。
- **anchor 不是行首**：这是与 2026-11-23 评审前方案的关键差异。行首只是**初始插入**的产物；后续
  文本编辑可以让它落在行中，块级 widget 在该偏移拆文本。

## 3. 初始插入与落位

### 3.1 规则（保持已批准的 B1）

> 初始插入仍落 caret 处：caret 之前的文字在卡上方，caret 之后的文字在卡下方。
> 实现上初始 anchor 取「caret 之后那段文字所在行的行首」；需要时插入一个真实换行把行拆开。

| caret 位置 | 文档改动 | 初始 anchor | 插入后 caret |
|---|---|---|---|
| 行首（含空行行首） | 无 | 该行行首 | 同 anchor（卡片正下方） |
| 行中 | 在该处插 `\n` | 新行行首 = `p + 1` | 同 anchor |
| 行尾、非末行 | 无 | 下一行行首 = `p + 1` | 同 anchor |
| 文末（含末行行尾） | 在文末插 `\n` | 新行行首 = `p + 1` | 同 anchor |
| 空文档 | 无 | 0 | 0 |

- **这只约束初始插入**。插入后的 anchor 是行首；后续编辑 MUST NOT 把它钳回行首（见 §4）。
- 非空选区按 `head` 取位置；插入**不删除**选区文字，选区塌缩为 caret（卡片落在 caret 处）。
- 行中拆行的 `\n` 与卡片 effect 必须在**同一条 transaction**（见 §5）。
- 文末补 `\n` 只在「caret 之后没有行」时发生；空文档不补（卡在上方，唯一空行在下方）。

### 3.2 多卡同锚点

- 新卡插在该锚点堆叠的**底部**（数组里排在同锚点已有卡之后）。
- 渲染时同锚点合成一个 widget、内部纵向堆叠；`composerBlocks()` 同序产出，所以视觉顺序 =
  投递顺序。
- 删除 / 合并导致不同锚点的卡片映射到同一偏移时，按**映射前的视觉次序**稳定排序（先在上者仍在
  上），不按 id 翻转。

### 3.3 IME 组合期：FIFO，不丢请求

- 组合期间的插卡请求进入 FIFO 队列；每条请求只有**成功落入 composer** 后才出队。
- `compositionend` 后按序 drain；drain 逐条应用，每条成功后才出队；失败则停止 drain、保留请求、
  给人话错误，不丢用户操作。
- 发送投影前 SHALL 先 drain。若组合仍在进行、当前事件序无法安全 drain，**延迟发送**；待
  `compositionend` 后 drain 再发送。MUST NOT 在发送时清空队列。
- **单个一次性 `pendingSend`（带视图世代）** 承载延迟期间的发送意图：
  - 重复触发（Enter / 发送钮 / 命令）只在第一次设置 pending，后续合并为同一次；
  - `compositionend` drain 成功后，仅当 `pendingSend.generation === viewGeneration` 时清空
    pending 并调用**一次** `performSend()`；清空必须先于发送，避免 send 内再次排 pending；
  - 切 vault / 新会话 / 面板销毁：递增 `viewGeneration` 并清空 pending（旧代不再发）；
    `compositionend` 到达时 generation 不匹配则整条丢弃；
  - drain 失败：清空 pending、**取消发送**，保留未消费请求；MUST NOT 发出缺卡消息；后续
    `compositionend` / 重试可重新 drain。
- `activity.phase` 在真正发送前仍是 idle，MUST NOT 用它替代 pending 去重。
- 移除卡片不改文档，可立即生效，不进队列。
- 切 vault / 新会话 / 面板销毁时清空队列（这些场景下请求已不属于任何可见输入区）；发送成功
  清空的是 composer / 草稿，不是未消费的 IME 队列。

## 4. 锚点映射与 history 可逆性

### 4.1 前向映射

每次 transaction 的 `StateField.update` / 事务扩展器：

```ts
// 1) 映射：精确偏移，不钳行首
const mapped = attachments.map((a) => ({
  ...a,
  anchor: tr.changes.mapPos(a.anchor, -1),
}));
// 2) 结构 effects（插入 / 移除）在前向事务里应用
// 3) 按 (新 anchor, 映射前视觉位次) 稳定排序
mapped.sort((x, y) => x.anchor - y.anchor || x.index - y.index);
```

- `assoc = -1`：在 anchor 处键入、粘贴多行文本、按 Enter 产生的内联内容一律落在**卡片下方**；
  anchor 之前的插入把 anchor 后移；覆盖 anchor 的删除把 anchor 收到删除点。
- **MUST NOT 钳到行首**。行合并 / 行删除后 anchor 落在行中时，块级 widget 在该偏移拆文本。
- 映射是**机械过程**，不是附件编辑：文本命令不发出附件增删 effect，但 anchor 会随文档移动。
  delta 里把「附件 field 逐字段不变」改成「数量、身份、相对顺序不变；anchor 按精确偏移映射」。

### 4.2 为什么 `mapPos` 不够，以及 sync effect

`mapPos` 是不可逆的：删除覆盖 anchor 时它只保留「删除点」，undo 重新插入文本时无法知道 anchor
原本在删除范围里的哪个位置。实测反例（当前 `@codemirror/state`）：

```text
初始：doc="A\nB"，card.anchor=2                ⇒ composerBlocks = [A, card, B]
删除行界 [1,2)：doc="AB"，mapPos(2,-1)=1        ⇒ [A, card, B]（顺序不变，anchor 变 1）
undo：只靠 mapPos 会把 anchor 留在 1；doc="A\nB" ⇒ [A, card, B]（视觉碰巧对，anchor 已不是 2）
跨行删除 [0,3)：doc="XYZ"，mapPos(2,-1)=0       ⇒ [card, XYZ]
undo：只靠 mapPos 无法回到 2；doc="A\nB"        ⇒ [card, A, B]（块序错）
```

因此 anchor 的可逆性**不能只靠 `mapPos`**。本方案用一条同步 effect：

1. 新增 `composerAnchorsSyncEffect = StateEffect.define<readonly PlacedAttachment[]>()`。
2. `EditorState.transactionExtender` 对**每个改变 doc 或卡片结构**的事务，计算事务后的完整
   placed-attachment 数组（映射 + 结构 effects + 稳定排序），并把数组写入该 effect。
   - effect 载荷是**最终文档坐标**；扩展器在过滤器之后运行，MUST NOT 再用 `mapEffect` 映射，
     否则会二次位移。
   - 扩展现有事务若**已带** sync effect（调用方显式写入），扩展器 MUST NOT 再追加第二条；
     否则字段取最后一条会出现两份不同快照。
   - 扩展器 MUST NOT 给 history 的 undo / redo 事务追加前向 sync effect：`userEvent` 以
     `undo` / `redo` / `select.undo` / `select.redo` 开头时跳过。否则前向 effect 会覆盖
     inverse effect 的精确恢复值。
3. `invertedEffects` **只为 sync effect** 产出逆 effect，载荷是 `tr.startState` 的完整数组。
   一个事务含多条 sync effect（history 分组撤销）时，逆 effect 只需一条 `tr.startState` 数组。
   - 结构 effect（insert / remove）MUST NOT 再单独提供 `invertedEffects`；它们只做前向编辑，
     可逆性唯一由 sync effect 承担。否则撤销会双重应用（先 inverse sync 恢复旧数组，再
     inverse 结构 effect 增删一次）。
4. `StateField.update`：若事务带 sync effect，采用**最后一条** sync effect 的数组（history 分组
   撤销时逆 effect 按时间逆序排列，最后一条是最早事务的数组，必须覆盖前面的中间态）；否则
   （测试 / 极端路径）用同一个纯函数 `mapComposerAttachments(start, tr)` 兜底。生产路径由扩展器
   保证 sync effect 恒在。
5. undo / redo 直接恢复完整数组（含每张卡的 anchor 与顺序）；redo 重放原事务的 sync effect。

这样，删除行界、跨行删除、⌘A 替换、undo / redo 都恢复**原偏移与 composerBlocks**，而不是只保证
卡片不丢或卡片间不翻转。

### 4.3 编辑矩阵（实现期必须逐行断言）

| 操作 | doc 前 | anchor 前 | doc 后 | anchor 后 | composerBlocks 后 |
|---|---|---|---|---|---|
| 初始 | `A\nB` | 2 | `A\nB` | 2 | `[A, card, B]` |
| 在 anchor 处键入 `x` | `A\nB` | 2 | `A\nxB` | 2 | `[A, card, xB]` |
| 在 anchor 前键入 `x` | `A\nB` | 2 | `Ax\nB` | 3 | `[Ax, card, B]` |
| 删除行界 `[1,2)` | `A\nB` | 2 | `AB` | 1 | `[A, card, B]` |
| 上一步 undo | `AB` | 1 | `A\nB` | 2 | `[A, card, B]` |
| 跨行删除 `[1,3)` | `A\nB` | 2 | `A` | 1 | `[A, card]` |
| 上一步 undo | `A` | 1 | `A\nB` | 2 | `[A, card, B]` |
| 全选替换 `[0,3)→XYZ` | `A\nB` | 2 | `XYZ` | 0 | `[card, XYZ]` |
| 上一步 undo | `XYZ` | 0 | `A\nB` | 2 | `[A, card, B]` |

- 全选替换覆盖 anchor 时，前向映射收到替换起点（CM `mapPos` 语义）；这是「文本被整体替换后
  没有可保留的相对位置」的确定性取法，undo 仍精确还原。
- 实现期先写这些断言并在旧实现上确认红；只断言「卡片不丢 / 卡片间不翻转」的用例不算覆盖。

### 4.4 非 history 文档变更禁止（addToHistory:false / remote）

sync effect 的载荷是**快照数组**，不是位置；它只在 history 的「原样记录 / 原样回放」路径上成立。
CM 对**不进 history 的文档变更**（`Transaction.addToHistory.of(false)` 或 `Transaction.remote`）
会走 `HistoryState.addMapping` → `addMappingToBranch`，把已有历史分支里的 effects 通过
`StateEffect.mapEffects` 映射到新文档。sync effect 的 identity map 不会更新旧快照，于是 undo
用到过期 anchor：

```text
初始：doc=AB，anchor=1
历史事务：插入 X                  ⇒ 历史分支记录 sync 快照（anchor 2）
addToHistory:false：再插入 R      ⇒ CM 把旧历史分支 effects 映射；identity map 不变
undo 上一次历史编辑：doc=RAB，anchor=1   ⇒ 正确应为 anchor=2（R 在 X 之前）
```

- **禁止**在现有 composer history 上执行 `addToHistory:false` 或 `remote` 的 doc 变更。
- **装载 / 复位**（草稿恢复、切 vault、新会话、会话重载、发送清空、面板重建）MUST 通过
  `createComposerState` / `EditorState.create` **新建 state**，history 从空开始；MUST NOT 用
  `state.update({ changes, annotations: addToHistory.of(false) })` 在旧 state 上打补丁。
- 开发 / 测试构建 SHALL 用事务过滤器或断言拒绝这类事务（抛错 / 判红），作为施工纪律的机器
  判据；生产构建 MUST NOT 产生它们。
- **不能**给 sync effect 加 `mapPos` 来补洞：普通 history 分组在 `addChanges` 里也会调用
  `StateEffect.mapEffects`，加 `mapPos` 会让正常分组 undo 二次位移。若未来必须支持非 history
  变更，须另设计「旧分支快照重映射」机制，单独评审。
- 测试：连续输入分组 undo / redo（最后一条 sync 胜出）；非 history 变更被拒绝（或对应重置
  路径确实新建 state、旧 history 不可达）。

## 5. Effects 与撤销

```ts
type AttachmentEdit =
  | { type: "insert"; cards: PlacedAttachment[] }
  | { type: "remove"; ids: number[] };
```

- **插入**：effect 携带**新文档坐标**里的 anchor（拆行 / 补行之后的位置）。同一 transaction 里
  先写 `changes`，再写 effect；CM 的 effect 值按新文档解释。
- **移除**：只按 `id` 定位，不按下标。× 钮 dispatch 一条**只含 effect、不含文档改动**的事务。
- **history 可逆性**：唯一由 `composerAnchorsSyncEffect` + `invertedEffects` 承担（§4.2）；
  结构 effect 不提供逆 effect。插入 / 移除仍带 `isolateHistory.of("full")`，各自成为一步 undo；
  插入事务里的 `\n` 与卡在同一步里，一次 undo 全还原、redo 全恢复。
- **重置 / 草稿恢复 / 切 vault / 新会话 / 会话重载 / 发送成功清空**：新 state、新历史，不跨进程
  恢复撤销史（现行条款不变）。新会话与会话重载同时经既有串行 `draft.clear()` 清除当前 bound
  vault 的盘上草稿；其他 vault 不受影响，清除后的新输入按既有版本与写链保留。

## 6. 装饰与 widget 生命周期

### 6.1 装饰

```ts
Decoration.widget({ block: true, side: -1 })
```

- `side: -1` → CM 的 BlockBefore：widget 画在**该偏移所在位置之前**。偏移在行首时卡落在两行之间；
  偏移在行中时 CM 把该行拆成前后两个 textblock，卡夹在中间。
- 同一 offset 只放**一个** widget（多卡在 widget 内部堆叠），回避「同位置多个 block widget
  排序无定义」。
- 块级 widget 把一行拆成多个 textblock（CM view 的 BlockType），卡是真正的块元素，不需要任何
  占位字符。**行中 anchor 造成的视觉换行不是 doc 里的换行**：doc 文本逐字节不含它，投递时由
  卡片行承担分隔。

### 6.2 WidgetType

- `toDOM(view)`：创建 `.lumir-hp-cwidget` 容器 + 逐卡复用现有卡片工厂（quote / msgquote /
  image）；容器 `contentEditable = "false"`（CM 也会设，双保险）。
- `eq(other)`：`id` 序列、卡片对象身份、编号序列全等 → `true`。**逐键击不重建卡片 DOM**。
- `updateDOM(dom, view, prev)`：编号变化（另一张图被移除 / 新增）时就地更新徽标与 `@` 的可读
  名，返回 `true`；其余变化返回 `false` 让 CM 重建。编号不变而 anchor 变（打字）时 `eq` 已经
  命中，不会走这里。
- `estimatedHeight`：返回 `-1`（未知）。composer 高度上限 150px、卡片数很少，CM 的测量足够。
- `ignoreEvent`：默认 `true`（编辑器忽略 widget 内的鼠标 / 键盘事件），保证点击卡片不移动
  caret、不产生选区；卡片自己的按钮处理器照常收到事件。
- `destroy(dom)`：释放缩略图 DOM 关联；缩略图缓存的下一次 `prune()` 回收非活跃项。

### 6.3 卡片工厂

- 现有 `createCardEl(card, mode, ordinal)` 复用；composer 态的差异：
  - 移除按钮从「数组下标」改成「附件 id」；
  - `@` 按钮点击时按 id 反查**当前**编号（不是渲染时的编号）；
  - 整卡 `mousedown` 仍 `preventDefault`（不夺 CM 选区 / 焦点）；
  - 卡片容器不再写 `dataset.attachmentIndex`，改写 `dataset.attachmentId`。
- 卡片的点击跳回、hover、失败态、缩略图读回、`imageSourceOf`、`imageGateErrored`、
  `quoteImageFailures` 全部沿用。

### 6.4 缩略图缓存

- `activeImageThumbNames()` 查询整个 panel 的 `[data-thumb-name]`，widget DOM 天然在内。
- widget 重建 / 移除后的下一帧调 `imageThumbCache.prune()`；不得在 `toDOM` 同步调用（此时
  新 DOM 尚未挂载，会把正在显示的图当非活跃项回收）。
- 读回命令仍按名去重；打字不触发读图（缓存命中 + `eq` 不重建）。

## 7. 投影与序列化

### 7.1 `composerBlocks()`

按块序产出 `ComposerBlock[]`：

```
cards = attachments（已是视觉顺序）
cursor = 0
for group of cards by anchor（升序）:
  end = group.anchor
  if (end > cursor && doc.sliceString(end - 1, end) === "\n") end -= 1   // 去掉锚点前的行界
  if end > cursor: blocks.push(paragraph(doc.sliceString(cursor, end)))
  for card of group.cards: blocks.push({ kind: card.kind, card: card.card })
  cursor = group.anchor
if cursor < doc.length || blocks.length === 0:
  blocks.push(paragraph(doc.sliceString(cursor, doc.length)))
```

- 锚点在行首时，`anchor - 1` 是行界 `\n`，把它归入分隔而不是文本；锚点在行中时没有行界可去，
  文本按偏移直接切开。
- 状态 doc 在创建时已把 `\r\n` / `\r` 归一为 `\n`（§11.2），因此这里只需检查一个 `\n`。
- **无卡片时**：循环不执行，最后一段是整篇 doc → `[paragraph(doc)]`，与现行 `composerBlocks()`
  逐字段相同。`panelText` 与「单段落文档的现行投影」逐字节相同（**不是**与 doc 原文逐字节相同：
  段落要过 XML 转义，这是现行行为）。
- **有卡片时**：每个 anchor 处切开；卡行插在该偏移之前；空段落由 `projectDelivery` 的
  `trim() !== ""` 跳过。
- 多卡同锚点：group 内按数组顺序（视觉顺序）逐个 push。

### 7.2 `projectDelivery`

- 不改实现：它已经按块序 flush 文本 / 图片，`[段落, 卡, 段落]` → `[text, card, text]`。
- 图片编号 `imageOrdinals(blocks)` 仍按块序派生；`Image N` 标签、`<image>` 占位行、XML 转义、
  零编号纪律全部不变。
- **唯一增量**：`@` 与徽标需要「附件 id → 当前编号」。新增一个纯函数，在**同一次块序遍历**里
  产出「块序 → 编号」与「id → 编号」两张读数；徽标、`@`、`projectDelivery` 共用同一份编号源
  （REVIEW.md「同一语义两处真源」条）。

### 7.3 投递 / 历史 / 重试

- `projectComposerDelivery(state)` 仍是发送路径的唯一投影点；`parts` 按块序交替。
- wire 协议、JSONL、Rust `apply_context_section` 零改动。
- 重试仍回放 `input` 历史里的 user 消息原文，不从 composer 状态二次投影。
- 历史消息仍用 `parseQuoteMessage` 解析已留存文本，交错顺序不变。

## 8. 选区、剪贴板、键盘删除

- **卡片不可选择**：零长度 widget 没有可被 `Selection` 覆盖的文档范围；卡间 caret、卡片内部
  caret 在模型上不存在。
- **跨卡文本选区**：从卡上方选到卡下方的选区仍是纯文本选区（卡片不在 `state.selection` 里）；
  删除只删文本，卡片保留并按 §4 精确映射。
- **`⌘A`**：`0 → doc.length`，只选文本（现行 `runComposerCommand` 的 `editor.select-all` 不变）。
- **视觉文本与可访问结构分工**：composer 摘录正文只写 `data-excerpt`，出处、编号与动作 glyph
  只写 `data-glyph`，均由 CSS pseudo 呈现；原始文本放在 `display:none` 节点，不写进
  contenteditable 的聚合 value。实际 AX 树的 textbox value 只含文档文字（块分隔换行除外），
  完整摘录只暴露一个 StaticText 阅读节点；动作的 `aria-label` 保留。不得为了复制或 AX value
  负向断言撤掉视觉文本，也不得由卡根再次重复朗读摘录。
- **`⌘C` 应用内 copy event**：composer 的 copy listener 写 `state.sliceDoc(main.from, main.to)`；
  验收用 `copy` 事件读取 `DataTransfer`，逐字节等于选区文本，不含卡片摘录、`×` / `@` 文本、
  占位字符或哨兵。空选区写入 `""`，不得退回整段或卡片文本；`clipboardData === null` 时不
  `preventDefault()`，保留原生回退。
- **系统剪贴板外部读取**：套件的剪贴板读取会归一行尾并去掉一个尾换行（`scripts/acceptance/README.md:721`、
  `:851`）。外部粘贴断言 MUST 按平台归一后的文本比较（统一行尾 + 去一个尾换行），**不得**写
  「逐字节」；同时另做负向断言：不含卡片摘录 / `×` / `@` / 哨兵。
- **`Backspace` / `Delete`**：只产生文本 change；卡片不删。行界删除导致 anchor 落到行中是预期
  行为，块级 widget 在该偏移拆文本。
- **兜底**：如果真机发现 CM 原生选区删除在块 widget 边界上按 DOM 形状走（而不是按
  `state.selection`），在 `beforeinput` 里按 `state.selection` 显式 dispatch 删除；判据是
  「删除后的 doc 逐字节等于按选区 slice 计算的期望」。先写测试、后决定是否需要补代码。

## 9. AX（读屏）

- 卡片容器在 `contenteditable` 内、`contenteditable=false`：AX 把它呈现为一段不可编辑内容，
  不是文本区 value 的一部分。composer 摘录与出处用 data 属性 + CSS pseudo 保留视觉呈现，
  摘录只暴露一个 StaticText；动作的 `aria-label` 保留。composer 态卡片**不是** `role=button`
  （transcript 态才是），不可 Tab 到达。
- **顺序断言必须限定在 composer 子树**，不能用整棵应用 AX 树的跨节点正则：
  - 给验收套件新增 scoped 断言（建议 `ax: { scope: <node locator>, order: [marker, …] }` 或
    「composer 结构节点序列」形态），实现要解析出 composer 节点后只在该子树里判序。
  - 找不到 scope / scope 不唯一 / 子树不可读 → **FAIL**，不得空过（REVIEW.md「读不到当成空」条）。
  - **负控只反转 composer 内的 widget 顺序**，编辑器 fixture 保持不动；同一断言必须判红。若
    对调编辑器原文也能判红，说明断言没有限定子树，方案不成立。
  - 同一 `AXTextArea` 的 value 按节点内偏移游标匹配；后续卡片节点之后可从该 value 的未消费
    偏移继续判序，不得把节点当成只能命中一次的位置，也不得重读已消费文本。
- 同场断言：
  - 卡片标记 MUST NOT 出现在 **composer 的** `AXTextArea.value` 里；
  - **编辑器源文档允许包含原始摘录**（摘录原文本来就在编辑器 AXTextArea.value 中）；负向只限
    composer 子树，不得写成「任何 AXTextArea.value」，否则合法 fixture 必红；
  - 卡片 MUST NOT 作为可编辑 / 可聚焦控件暴露（无 focused、无可编辑 role、无按钮包装）；
  - 卡片摘录在前、下一行文字在后。
- 卡片内的 `×` 有既有可读名（D371）；`@` 有 D457；hover title 不进 AX 判据。
- 若真机 AX 把 widget 文本挂到 `AXTextArea` 的 value 之外且顺序不稳定：给 widget 容器加
  `role="group"` + 合成可读名，把卡片作为该 group 的可读内容；不得把卡片文本塞进文本区 value。

## 10. 图片编号与 `@`

- 编号源：`imageOrdinals(blocks)`（`src/quote-card.ts:226-232`）；只数 `kind === "image"` 的块，
  1-based、无空号。
- composer 徽标：widget 构建时按「id → 编号」读数渲染；编号变化时 `updateDOM` 就地更新。
- `@`：点击时读**当前**编号（不是构建时），因为发送前可能又删了别的图；插入的仍是普通
  `Image N` 文本，不拆段、不改写既有引用文本。
- transcript：`appendUserMessage` 用 `imageOrdinals(blocks)` 按块序渲染；消息发出即冻结该消息
  自己的编号（历史消息不受后续 composer 编辑影响）。
- **不冻结编号**（B3）：移除图片后即时重编；已插入的 `Image N` 文本不回写。冻结需要存编号，
  且「先 `@` 引用再往前插图」时编号与徽标会不一致——这是批准值明确不取的方案。

## 11. 草稿 v3 与迁移

### 11.1 形状

```json
{
  "version": 3,
  "text": "问题文字",
  "caret": 12,
  "cards": [
    { "card": { "kind": "quote", "card": { "file": "…", "heading": "…", "headingPath": "…", "lines": "3-4", "text": "…" } }, "at": 0 }
  ]
}
```

- `cards` 按**视觉顺序**（anchor 升序、同锚点堆叠序）写出；`at` 是该卡的**精确 UTF-16 偏移**，
  不要求行首；`0 <= at <= text.length`。
- `id` 不写盘；恢复时按数组顺序重新编号。
- 图片仍只存内容寻址名 / mime / 可选宽高，不内联 base64。

### 11.2 CRLF 归一（所有版本的共同出口）

CM 在 `EditorState.create` 时按 `/\r\n?|\n/` 分行并统一用 LF（`@codemirror/state/dist/index.js:608`），
实测 `"A\r\nB\r\nC"` 进入 state 后变为 `"A\nB\nC"`，行首从原始 `0/3/6` 变成 `0/2/4`。因此：

- **所有版本（v1 / v2 / v3）先各自解析 / 迁移成同形状草稿**（`{text, caret, cards:[{card, at}]}`，
  仍是**原始坐标**），再走同一个出口 `normalizeDraftForState(draft)`：
  - `normalizeLineEndings(text)`：`\r\n` / `\r` → `\n`，同时产出原始 offset → 归一 offset 映射；
  - `caret` 与每张卡的 `at` SHALL 用**同一映射**重定位；
  - 返回 `{ draft, changed }`；`changed` 表示文本或坐标因归一而变化。
- 归一后的草稿同时用于**写回 v3**与**创建 `EditorState`**；MUST NOT 只归一文本而保留原始
  caret / at，MUST NOT 让「写回的 v3」与「state 里的坐标」来自两份不同数据。
- `changed === true` 时（例如盘上 v3 含 CRLF）按迁移写回路径立即写一份归一 v3；`migrated` 与
  `changed` 任一为真都触发写回。
- 混合行界（`\r\n` / `\r` / `\n` 混用）按同一扫描处理；映射到 LF 坐标。
- 测试必须覆盖：
  - **真实 CRLF v3**：`text: "A\r\nB\r\nC"`、caret 在 B 后、卡片锚在 C 行首；断言文本
    `A\nB\nC`、caret / anchor 映射正确、`composerBlocks()` 顺序与视觉一致；
  - **CRLF v2 caret**：v2 的 caret 是原始偏移，归一后必须映射到 LF 坐标，不能按原值钳；
  - **混合行界 v1**：v1 段落里同时含 `\r\n`、`\r`、`\n`，转换后的 text / caret 必须与 v1 的
    原始坐标一致地映射。

### 11.3 读取与迁移

| 读到 | 处理 | 写回 |
|---|---|---|
| v3 | 解析 → 逐字段校验（`at` 非整数 / 越界 → 钳到 `[0, text.length]`，不钳行首）→ 共同出口归一 | `changed` 时写归一 v3；否则无 |
| v2 | `cards` 全部落 `at: 0`（= 今天「卡片全在前」语义），保持相对顺序 → 共同出口归一（**caret 按 CRLF 映射**） | 立即经既有串行 store 写 v3 |
| v1 | 沿用现行 v1 转换（段落 / 未知块 / caret 映射 / 卡片抽入），再全部落 `at: 0` → 共同出口归一（**混合行界按同一映射**） | 立即写 v3 |
| 损坏 | 安静回空 | 无 |

- v2 的「原样保留」改为「可见内容保留，行尾及坐标按统一映射归一」；不是字节级保留。
- `migrated` / `changed` 标记覆盖 v1 / v2 / 含 CRLF 的 v3；`load` 的「成功后立即写回、失败不
  谎报已保存、旧写不夺回新编辑」语义全部沿用。
- 不双写、不保留 v2 写出路径、不建通用迁移平台。
- Rust 只搬运字符串（`src-tauri/src/harness/draft.rs:56-66`），零改动。

### 11.4 发送被拒合并

`mergeRejectedComposerContent(restored, current)`：

```
text   = restored.text + current.text
caret  = current.caret === null ? null : restored.text.length + current.caret
cards  = [...restored.cards,
          ...current.cards.map(c => ({ ...c, anchor: c.anchor + restored.text.length }))]
// 按 (anchor, 原视觉位次) 稳定排序；restored 在前、current 在后
```

- 精确偏移模型下**不再需要**补 `\n`：当前卡片 anchor 平移到原文末尾后，块级 widget 在该偏移
  拆文本，卡片自然落在原文之后、当前文字之前。
- 空当前态（最常见路径）原样返回 `restored`。
- 两边都没有卡片时就是纯文本拼接，与现行一致。
- 合并后 `resetComposer` 换 state、显式 `markDraft()`；草稿的「无变更不写」照旧。

## 12. tray 退役与视觉合同

### 12.1 DOM / CSS

- 删除 `composerTray` 的创建与 `composer.append(composerTray)`（`src/harness-panel.ts:3737`、
  `:3796`）。
- 删除 `.lumir-hp-composer-tray` 一族 CSS（`src/style.css:306-317`），包括
  `:has(.lumir-hp-composer-tray:not(:empty)) > .cm-editor { margin-top }`。
- `.lumir-hp-composer` 的 `overflow-y: auto`、`max-height: 150px` 保持；卡片随文本一起滚动。
- 占位符 `.is-empty` 的挂载条件从「doc 为空」改成「doc 为空 **且** 卡片为空」
  （`composerIsEmpty`）；否则卡片在场时空文本仍会显示「问点什么」并压在卡片上。

### 12.2 视觉保真

本 change **没有新原型**；视觉真源是现行 composer 卡片样式与 composer 区整页基线。以下口径
供并排截图核对：

- **布局节奏**：卡片在 `.cm-content` 内、占满内容宽；卡片与相邻文本行 / 相邻卡片之间的垂直
  间距目标 **4px（`--sp-2`）**，相邻两卡不得出现 8px 双倍间距；首卡上缘与 composer 顶距
  与现行 tray 首卡一致（tray 的 `margin-top: 0` 语义由 widget 首块的 padding 归零承接）。
- **行中 anchor 的形态**：偏移落在行中时，CM 把该行拆成前后两个 textblock，卡夹在中间；
  doc 里没有新增换行。候选截图必须覆盖「行中 anchor」与「行首 anchor」两种形态。
- **卡片 / 气泡样式**：`.lumir-hp-qcard` 整族不变——`--agent-bg` 底、`--border-soft` 1px 边、
  `--r6` 圆角、3px 中性竖条、hover 时 `--border` / `--hover`；图片卡的缩略图、编号徽标、
  右上动作区（`@` / `×`）位置不变。
- **字层级**：摘录正文、出处行 micro、图片元信息行、编号徽标全部沿用现有字号 / 字重 / 行高；
  不新增字号档。
- **各状态**：hover / focus（CM 焦点环在 `.cm-editor.cm-focused`，仍 `outline: none`）/ 失败态
  `is-error` / eink（描边 1.4px、无阴影）/ 空态（占位符只在无文本且无卡片时出现）；**选区
  高亮不得覆盖卡片像素**（CM 选区层只画文本行）。
- **CM 约束**：block widget **不得带纵向 margin**（CM 文档明确要求），纵向间距一律用 wrapper
  的 `padding-block`；内层卡片的 `margin: var(--sp-2) 0` 在 widget 内归零，避免双份。
- **手感 / 审美归 Alex**：卡片随滚动的节奏、点击卡片跳回的手感、`×` 的即时反馈不进机器判据，
  只留截图与真机证据。

### 12.3 候选与基线

- 先跑结构断言（CI 层）与本地像素对比，产出**候选截图**到 `.local/`；
- 并排对照现行基线，列出每一处差异（卡与文字间距、首卡上缘、滚动位置、占位符、行中 anchor）；
- 候选截图送 Alex 过目；**未批不得 `--update`**；批准后才更新基线并复跑 `visual`。

## 13. 性能

- 每次击键：O(卡片数) 的 anchor 映射 + 稳定的数组重排 + 装饰重算；`eq` 命中时零 DOM 重建、
  零图片读回。卡片数是「几条引用」量级，不构成 16ms 风险。
- 无新增定时器、无每键 IPC；草稿防抖仍是 1s。
- **必须实测**：
  - 既有 perf 套件的 keypress-to-paint（`scripts/perf/keypress-to-paint.mjs`）；
  - 卡片在场连续键入 **200 字**的帧时间 / 键入总耗时；
  - **widget DOM 身份复用**：200 字过程中卡片 DOM 节点引用不变（逐键不重建）；
  - **图片读回不重复**：键入期间 `harnessReadImage` 调用计数不增加（缓存命中 + `eq`）。
- 不新增阈值，只对照 ADR 0002 第 6 条；大图缩略图仍受 64MiB / 256 条 LRU 约束。

## 14. 测试策略（先红后绿）

| 层 | 用例 | 断言 |
|---|---|---|
| 单元 | 块序交错 | `[para, quote, image, para]` → parts `[text, image, text]`；`panelText` 行序 = 切开拼回 |
| 单元 | 无卡等价 | 纯文本 doc → `composerBlocks` = `[paragraph(doc)]`，`panelText` 与单段落投影逐字节相同 |
| 单元 | 初始落位矩阵 | 行首 / 行中 / 行尾 / 文末 / 空文档 / 非空选区；拆行与 effect 同事务 |
| 单元 | 精确锚点 + 删除行界 | 4.3 矩阵逐行；`composerBlocks` 顺序与每张卡 anchor 都要断言 |
| 单元 | undo / redo 精确还原 | 删除行界、跨行删除、⌘A 替换、插入 / 移除卡片；undo 后 anchor 与 `composerBlocks` 回到原值 |
| 单元 | 分组 undo / redo | 连续两次 input.type 合并为一组：undo 恢复最早 anchor / 块序，redo 恢复最终 anchor / 块序；最后一条 sync 胜出 |
| 单元 | 非 history 变更禁止 | `addToHistory:false` / `remote` 的 doc 变更被拒绝（或重置路径确实新建 state、旧 history 不可达）；不得用 sync effect mapPos 补洞 |
| 单元 | sync effect | 每个 doc-changing / 结构事务都带 sync effect；undo/redo 事务不加前向 sync；结构 effect 无第二套 inverse |
| 单元 | 草稿 | v3 往返（含中段 anchor）；CRLF v3 装载 + caret/anchor 映射；**CRLF v2 caret**；**混合行界 v1**；v2 → 全 0 + 立即写 v3；v1 → 直接 v3；越界钳制；损坏回空 |
| 单元 | pendingSend | 重复触发合并为一次；compositionend drain 成功仅发送一次；切 vault / 新会话 / 销毁取消；drain 失败取消发送、保留未消费请求、不缺卡投递 |
| 单元 | 发送被拒合并 | 原文在前、当前在后；anchor 平移；不补换行；空当前态原样返回 |
| 单元 | 图片编号 | 块序派生；`@` 按 id 反查 = 徽标；删图后重编；已插入文本不回写 |
| 单元 / DOM | 性能 | 200 字连续输入；widget DOM 身份不变；图片读回计数不增 |
| 结构（chromium） | 卡片在 `.cm-content` 内、位于两段文字之间；tray 选择器消失；占位符不压卡 | 结构断言；不新增整页基线场景，既有含 composer 的整页基线按 §12.3 走候选 + 审批 |
| 像素（本地） | 卡片 / 文本间距、首卡上缘、行中 anchor、三主题 / eink | 候选截图先 Alex 过目，未批不 update |
| 真机 | Alex 原始复现：两卡 + 一句 → Enter → quote → 顺序 = 卡 卡 文字 卡 | AX 有序断言（限定 composer 子树）+ 截图 |
| 真机 | 删除行界 / 跨行删除 / ⌘A 替换 / undo | `composerBlocks` 顺序与 anchor 还原；AX 有序 |
| 真机 | IME：组合中插卡 / 组合中 Enter / 组合后插卡 / 组合期连续两卡后发送 | 组合不打断；两张卡按序投递；发送不丢队列 |
| 真机 | `⌘A` → `⌘C` → 外部粘贴 | 应用内 copy event 逐字节；外部剪贴板按平台归一比较；无卡片文本 / 占位 / 哨兵 |
| 真机 | Backspace / Delete 紧邻卡片 | 只删文本，卡片数量不变 |
| 真机 | 切 vault / 重启 | 草稿位置还原（含中段 anchor / CRLF），卡片仍在正确顺序 |

## 15. 已知边界与风险

| 边界 | 取法 / 残余风险 |
|---|---|
| 行合并 / 删除行界 | anchor 精确映射到删除点，不钳行首；块级 widget 在行中拆文本；undo 由 sync effect 精确还原 |
| 跨行删除 / 全选替换覆盖 anchor | 前向映射收到替换起点；卡片不丢、顺序确定；undo 精确还原。这是「文本被整体替换」的确定性取法 |
| 同锚点碰撞 | 稳定排序保持映射前视觉次序；极端场景只保证「顺序不翻转 + undo 精确」，不保证 anchor 数值唯一 |
| `addToHistory:false` / `remote` 文档变更 | 禁止在现有 history 上执行；装载 / 复位新建 state；开发断言 + 分组 undo/redo + 禁止路径测试 |
| `\r\n` 文档 | **所有版本解析/迁移后的共同出口**归一 + caret/at 同映射；写回 v3 与创建 state 用同一份归一草稿；CRLF v3 / v2 caret / 混合行界 v1 三组测试 |
| 空文档 / 全空白文档 | 空文档不补 `\n`；全空白段落被 `projectDelivery` 跳过，发送仍按 `parts.length === 0` 早退 |
| widget 内点击 | `ignoreEvent` 默认 true + `mousedown preventDefault`；点击卡片不移动 caret、不建选区；跳回 / × / `@` 各自处理器 |
| AX 子树不可读 | scoped 断言必须 FAIL，不得空过；负控只反转 composer 顺序；负向只查 composer 的 `AXTextArea.value`，编辑器原文允许摘录 |
| pendingSend 生命周期 | 单个一次性状态 + 视图世代；重复触发合并、drain 成功仅发一次、切视图取消、drain 失败取消且保留请求 |
| 外部剪贴板归一 | 套件读取会去一个尾换行、统一行尾；外部断言按归一文本，应用内 copy event 才逐字节 |
| CM 版本升级 | `side` / BlockType / `contentEditable` 行为按 6.43 核实（`node_modules/@codemirror/view/dist/index.js:2204-2208`、`:260-261`）；升级时复跑结构 + 真机 |
| 视觉基线 | 预计整页基线变化；候选先过 Alex，未批不 update |

## 16. 与 ADR 的关系

不需要新 ADR：这是 `harness` 一个 capability 内的行为与实现变更，不改技术选型（仍是 CM6 单
内核）、不改分层、不改 wire 协议、不改 Rust。2026-11-18 的「tray」是 change 级决定，不是 ADR；
本次改裁以 change proposal + 节点 1 记录为准。
