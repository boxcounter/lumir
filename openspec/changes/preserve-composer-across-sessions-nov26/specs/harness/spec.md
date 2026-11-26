# harness 增量规格

> 起草注记（非规格正文）：本 change 只改「CM composer 的单一 history」一条——把「新会话 / 会话
> 重载清空 composer 与盘上草稿」的旧写法 supersede 为「会话切换只换消息列表，输入区原样保留」，
> 并补会话切换作废在途草稿恢复的判据。切 vault 的 per-vault 草稿恢复与发送成功清空逐字不动。
> 机制、入口盘点与判据落点见 [design.md](../../design.md)。MODIFIED 条基于当前 living spec
> （`openspec/specs/harness/spec.md`，master `a9152deca`）的原文整块复制后改，未改动的段落逐字
> 保留。

## MODIFIED Requirements

### Requirement: CM composer 的单一 history

composer SHALL 使用 CodeMirror history 作为文本与卡片的唯一撤销 / 重做真源，MUST NOT 再维护 DOM / blocks 快照栈。卡片 SHALL 以 `{ id, card, anchor }` 记录：`id` 是会话内稳定身份，`anchor` 是文档中的**精确 UTF-16 偏移**（不要求行首）。卡片添加与移除 SHALL 由专用 StateEffect 更新 StateField；移除按 `id` 定位，MUST NOT 按下标定位；附件结构事务 SHALL 与相邻编辑隔离。composer MUST NOT 在现有 history 上执行 `addToHistory:false` 或 `remote` 的文档变更；装载 / 复位（草稿恢复、切 vault、发送清空）MUST 新建 `EditorState` 重置 history。新建会话、选择 / 恢复其他会话与会话重载 MUST NOT 复位 composer：文字、引用 / 消息摘录 / 图片卡片、Skill 引用、光标与撤销历史 SHALL 原样保留，下一次发送 SHALL 进入当前选中会话；这些切换 MUST NOT 清除当前 vault 的盘上草稿——草稿只在发送成功或用户手动删除时清除，其他 vault 的草稿与保留后的新输入不得受影响。切 vault MUST 恢复各 vault 自己的草稿，MUST NOT 跨 vault 混用；会话切换 MUST 作废在途的草稿恢复，迟到的读回 MUST NOT 覆盖会话切换后保留的输入区、MUST NOT 借此重建编辑史。MUST NOT 用 `state.update({annotations: Transaction.addToHistory.of(false)})` 在旧 state 上打补丁。连续文本输入 SHALL 按 CM history 聚簇；IME 整段 history SHALL 由 CM 管理，MUST NOT 在 compositionstart/end 手工压栈。导航本身 MUST NOT 产生编辑 undo 事件。

文本 Backspace / Delete、⌘A、普通输入、粘贴与 IME MUST NOT 发出附件增删 effect，因此不得增删或重排卡片；文本变更引起的 anchor 映射是机械重映射，不属于附件编辑。重置、草稿恢复、切 vault 和发送成功后的空输入 SHALL 是新的编辑史，MUST NOT 撤销回另一 vault 或已发送内容。新建 / 选择 / 恢复会话与会话重载 MUST NOT 产生新的编辑史：撤销 / 重做 SHALL 跨这些会话切换保留，MUST NOT 撤销回另一 vault 或已发送内容。

anchor SHALL 随 `tr.changes.mapPos(anchor, -1)` 做精确偏移映射，**MUST NOT 钳到行首**：删除行界后 anchor 落在行中时，块级 widget 在该偏移把文本拆成前后两块。映射后 SHALL 按新 anchor 与映射前视觉位次稳定排序，同锚点保持原相对次序。

anchor 的可逆性 MUST NOT 只靠 `mapPos` 反推。每次改变文档或卡片结构的事务 SHALL 携带 `composerAnchorsSyncEffect`（由事务扩展器写入事务后的完整 placed-attachment 数组）；`invertedEffects` SHALL 只为该 effect 产出逆 effect，逆 effect 携带事务前的完整数组；undo / redo SHALL 直接恢复该数组（含每张卡的精确 anchor 与顺序）。结构 effect MUST NOT 再单独提供 `invertedEffects`，避免撤销时双重应用。history 产生的 undo / redo 事务 MUST NOT 再追加前向 sync effect（`userEvent` 以 `undo` / `redo` 开头时跳过），否则前向 effect 会覆盖精确恢复值。sync effect 载荷是最终文档坐标，MUST NOT 再用 `mapEffect` 映射。sync effect 的 identity map MUST NOT 被用来给非 history 文档变更补映射：CM 会把旧 history 分支经 `mapEffects` 映射，identity 不会更新旧快照；若未来必须支持 `addToHistory:false` / `remote` 变更，须另设计快照重映射，MUST NOT 简单给 sync effect 加 `mapPos`（普通 history 分组也会调用 `mapEffects`，会造成二次位移）。

插入卡片与它伴随的换行 / 补行 MUST 在同一条 transaction，一次 undo 全还原、redo 全恢复；移除卡片的 undo SHALL 按逆 sync effect 恢复原 anchor 与原堆叠位次。

#### Scenario: 附件与文本共享可验证的 undo/redo

- **WHEN** 用户依次输入文字、添加卡片、移除另一张卡，再逐步 undo 和 redo
- **THEN** 每一步按统一 history 逆序 / 正序恢复相应文本、selection 与卡片；不存在只恢复文本或只恢复卡片的第二历史

#### Scenario: 连续键入与 IME 归 CM 聚簇

- **WHEN** 用户连续键入，或完成一段 IME 组合后撤销
- **THEN** CM 按其 history 聚簇恢复文本；产品没有 compositionstart/end 的额外快照步，卡片数量与相对顺序不变，anchor 按精确偏移映射（可落在行中）

#### Scenario: 插卡与拆行是一步 undo

- **WHEN** 用户在行中插入一张卡片，随后按一次 ⌘Z，再按一次 ⌘⇧Z
- **THEN** 一次 ⌘Z 同时撤掉卡片与拆行，文本回到插卡前逐字节；一次 ⌘⇧Z 同时恢复卡片与拆行，anchor 与堆叠位次不变

#### Scenario: 文本编辑后卡片不丢

- **WHEN** 用户在卡片上方 / 锚点处 / 卡片下方插入或删除多行文本，包括删除行界与跨行删除
- **THEN** 每张卡片仍在场，anchor 是文档中的精确偏移（可落在行中）；同锚点多卡的相对顺序与编辑前一致，MUST NOT 因钳制翻转；`composerBlocks()` 的文字 / 卡片顺序与视觉顺序一致

#### Scenario: 移除与撤销恢复原堆叠位次

- **WHEN** 同一锚点堆叠三张卡，移除中间一张后按 ⌘Z
- **THEN** 被移除的卡按逆 sync effect 回到原 `id`、原 anchor 与原上下位次，另外两张卡的数据与顺序不变

#### Scenario: 删除行界后块序不变

- **WHEN** doc 为 `A\nB`、卡片 anchor 为 2（A 与 B 之间），用户删除行界得到 `AB`
- **THEN** 卡片 anchor 映射为 1（A 与 B 之间），`composerBlocks()` 仍是 `[A, card, B]`，MUST NOT 变成 `[card, AB]`；块级 widget 在偏移 1 处把 `AB` 拆成前后两块

#### Scenario: undo 还原原偏移与 composerBlocks

- **WHEN** 上一条场景删除行界后按 ⌘Z
- **THEN** doc 恢复为 `A\nB`、卡片 anchor 精确恢复为 2，`composerBlocks()` 逐项恢复为 `[A, card, B]`；MUST NOT 只保证卡片不丢或卡片间顺序不翻转

#### Scenario: 全选替换后 undo 还原

- **WHEN** doc 为 `A\nB`、卡片 anchor 为 2，用户 ⌘A 后键入 `XYZ` 替换全部文本，再按 ⌘Z
- **THEN** 前向替换后卡片仍在场（anchor 收到替换起点 0），`composerBlocks()` 为 `[card, XYZ]`；undo 后 doc 与 anchor 精确恢复为 `A\nB` / 2，`composerBlocks()` 恢复为 `[A, card, B]`

#### Scenario: 非 history 文档变更被拒绝

- **WHEN** 代码尝试在现有 composer state 上以 `addToHistory:false` 或 `remote` 修改 doc
- **THEN** 该事务被拒绝（开发断言 / 过滤器），composer 内容与 history 不变；装载 / 复位路径（草稿恢复、切 vault、发送清空）必须新建 `EditorState`，新建 / 选择 / 恢复会话与会话重载 MUST NOT 新建 `EditorState`；旧 history 不可达；MUST NOT 用 sync effect 的 `mapPos` 补映射

#### Scenario: 新建会话保留输入区

- **WHEN** 输入区含文字、引用卡 / 图片卡与 Skill 引用，caret 在文本中部，用户点击「新会话」
- **THEN** transcript 清空、会话名回到「新会话」；输入区的文字、卡片、Skill、光标与切换前逐字段相同，撤销历史仍可撤销；盘上草稿未被删除；随后的发送进入新会话

#### Scenario: 选择 / 恢复历史会话保留输入区

- **WHEN** 输入区含内容，用户从会话浮层选择另一条历史会话，或经 cron 结果通知打开其会话
- **THEN** 只切换消息列表与会话名；输入区内容、光标与撤销历史保持，下一次发送进入恢复后的会话

#### Scenario: 会话重载保留输入区

- **WHEN** 输入区含内容，面板按后端当前会话重载（cron 发起失败回滚 / 打开会话通知的重载通道）
- **THEN** transcript 按该通道重建，输入区 MUST NOT 被清空或重建编辑史；在途的草稿恢复 MUST NOT 覆盖它

#### Scenario: 新建失败不清输入区

- **WHEN** 用户点击「新会话」而 `harness_new_session` 的回包被拒绝
- **THEN** 面板只追加错误行；输入区内容、卡片、光标与撤销历史与点击前相同，盘上草稿不变

#### Scenario: 新会话取消发送意图但不清内容

- **WHEN** `pendingSend` 已设置（组合期），用户点击「新会话」
- **THEN** 旧视图的延迟发送被取消、插卡队列按既有口径清空；输入区的文字、卡片与光标保留，组合文本 MUST NOT 被清掉

#### Scenario: 连续切换不被在途草稿恢复覆盖

- **WHEN** 草稿读回在途时用户新建会话或重载会话（连续切换）
- **THEN** 迟到的读回 MUST NOT 铺进输入区、MUST NOT 重建编辑史；输入区保持会话切换时的内容

#### Scenario: 切 vault 仍按 vault 恢复草稿

- **WHEN** 输入区含 vault A 的内容，用户切到 vault B 再切回 A
- **THEN** 切到 B 时输入区按 B 自己的草稿恢复（B 无草稿则为空），切回 A 时恢复 A 的草稿；MUST NOT 把 A 的内容带进 B，MUST NOT 把 B 的草稿写进 A

#### Scenario: 发送成功仍清空并清草稿

- **WHEN** 用户在保留的输入区里直接发送且后端受理
- **THEN** 输入区清空，草稿按发送时定格的归属清除（「发送与写失败保留语义」条逐字不变）
