# harness 增量规格

> 本 change 把 composer 从「编辑区外 tray」改回「编辑区内零长度块级卡片」，恢复文字 / 卡片有序
> 混排；不恢复 contenteditable 双拥有、卡片可编辑、卡间 caret、跨卡选区或键盘删卡。
>
> 六条主 requirement 的标题沿用归档身份（`openspec archive` 按标题匹配 MODIFIED；改标题会落成
> 「新 requirement + 悬挂的旧 requirement」，先例见
> `openspec/changes/archive/2026-09-28-bare-url-cmd-click/design.md:56`）。标题里的「区外附件」
> 「附件前置」是历史措辞，**现行语义以各条正文为准**。
>
> 同理，MODIFIED 块里的场景标题 MUST 与现行 spec 同名（`openspec validate --strict` 会拒绝丢失
> 同名场景）。旧标题里的「tray」「附件前置」「不拆文本」是归档身份；正文已按新行为改写，标题
> 只在它仍然成立的特例上保持字面（例如「不拆文本」场景的 WHEN 限定为行首插入）。
>
> 另六条从属 requirement 只做措辞对齐（标题同样不变；tray 退役、插入会移动 caret、编号按块序、
> anchor 随文档映射），防止归档后的 living spec 同时说两套结构。

## MODIFIED Requirements

### Requirement: CM 对话输入区与区外附件

对话输入区 SHALL 是一个最小 CodeMirror 6 纯文本编辑区；引用卡片、消息摘录卡片与图片卡片 SHALL 作为**零长度块级 widget** 渲染在文本之中（`Decoration.widget({ block: true, side: -1 })`），文档 MUST NOT 出现任何卡片占位字符、哨兵字符或隐藏结构。每张卡片的锚点 SHALL 是文档中的一个**精确 UTF-16 偏移**（`0 <= anchor <= doc.length`，不要求行首）；块级 widget SHALL 在该偏移把文本拆成前后两块：偏移之前的文字在卡上方、之后的文字在卡下方，偏移恰在行首时卡落在两行之间。同一偏移多张卡片 SHALL 合成一个 widget、按视觉次序纵向堆叠，新插入的卡片 SHALL 落在该堆叠的底部。卡片 MUST NOT 可编辑、MUST NOT 获得键盘焦点、MUST NOT 参与文本选区；caret、方向键、⌘A、⌘C、Backspace / Delete MUST NOT 进入或删除卡片。卡片与文字 SHALL 按视觉顺序进入 AX 阅读顺序（卡片摘录在前、其下方文字在后）；卡片标记 MUST NOT 出现在 **composer 的** `AXTextArea.value` 中，MUST NOT 被读成可编辑 / 可聚焦控件；编辑器源文档可以包含原始摘录，负向断言 MUST NOT 扩大到编辑器的 `AXTextArea.value`。文本编辑区 SHALL 只承载完整问题文字。

插入附件 SHALL 落在 caret 处：caret 之前的文字在卡上方、之后的文字在卡下方。caret 在行首时锚在该行行首；caret 在行中时 SHALL 先在该处插入一个真实换行把行拆开，卡片落在新行上方；caret 在行尾且其后还有行时 SHALL 锚在下一行行首，MUST NOT 额外插入空行；caret 在文末时 SHALL 补一个换行造出下方行。拆行 / 补行与卡片插入 MUST 在同一条 transaction。**上述行首只是初始插入的产物**：插入后 anchor 是行首；后续文本编辑 MUST NOT 把 anchor 钳回行首（见「CM composer 的单一 history」）。插入后 SHALL 把键盘焦点交给文本编辑区，caret 停在卡片正下方的行首，随后键入 MUST NOT 落进卡片；面板原本未打开时 SHALL 先打开面板再移交焦点。IME 组合期间的插卡请求 SHALL 进入 FIFO 队列并延迟到组合结束后按序落位；发送前 SHALL 先 drain，无法安全 drain 时 SHALL 延迟发送，MUST NOT 清空队列。延迟期间的发送意图 SHALL 由**单个一次性 `pendingSend`（带视图世代）**承载：重复触发合并为一次；`compositionend` drain 成功后仅触发一次发送；切 vault / 新会话 / 面板销毁同时取消；drain 失败 SHALL 取消发送、保留未消费请求，MUST NOT 投递缺卡消息。组合中的文本 MUST NOT 丢失、组合 MUST NOT 被打断。

附件 SHALL 只经移除钮移除；文本 Backspace / Delete MUST NOT 删卡。粘贴 SHALL 按剪贴板内容分派：含 `image/*` 时走「图片粘贴卡片」且图优先，其余内容只收 `text/plain` 并保留换行。新发送的用户消息 SHALL 按**块序**（文字行与卡片锚点的合并顺序）沉淀；块序即视觉顺序，MUST NOT 再把全部卡片硬编码到完整问题之前。历史已发送消息仍 SHALL 按留存原文交错显示。在卡片锚点处键入或粘贴的内容 SHALL 落在卡片下方。空消息判据 SHALL 仍是「文档为空且卡片为空」；只有空白文本不算消息。空态占位 SHALL 只在文档与卡片都为空时出现，MUST NOT 覆盖卡片。

composer 摘录正文 SHALL 通过 `data-excerpt + CSS ::before` 保留视觉呈现，MUST NOT 因此进入 contenteditable 的聚合文本；卡片 `aria-label` SHALL 保留完整摘录与出处。copy listener SHALL 写入 `state.sliceDoc(main.from, main.to)`；空选区 SHALL 写入 `""`，MUST NOT 复制整段或卡片文本；`clipboardData === null` 时 MUST NOT `preventDefault()`，保留原生回退。

#### Scenario: 添加附件不拆文本且可直接继续输入

- **WHEN** 问题文字中已有合法 caret 且位于某行行首（不触发拆行的情形），用户从编辑器、transcript 或剪贴板加入一个附件
- **THEN** 卡片出现在该行上方（零长度块级 widget，文本逐字节不变）、caret 落在该行行首即卡片正下方，焦点在文本区，随后键入接在该行行首

#### Scenario: 文本键不改变附件

- **WHEN** composer 内有一张或多张卡片，用户在文本区执行 Backspace / Delete、⌘A、普通键入或 IME 组合
- **THEN** 只有文本 / 选区按各自语义变化，卡片数量、身份与相对顺序不变；anchor 按精确偏移随文档映射（MUST NOT 钳回行首），卡片只能经 × 移除

#### Scenario: 新消息附件前置、历史交错保留

- **WHEN** 用户在空输入区先插两张卡片、再在卡片下方输入完整问题并发送（本例全部卡片在文字之前），随后查看新消息和一条历史交错消息
- **THEN** 新消息先呈现全部卡片再呈现完整问题（块序的特例）；历史消息仍按留存的文字 / 卡片交错顺序呈现，MUST NOT 被迁移或重排

#### Scenario: 粘贴按剪贴板内容分派

- **WHEN** 在文本区粘贴多行纯文本，或粘贴同时含文字与图片的剪贴板
- **THEN** 纯文本只进入当前文本选区并保留换行，落在卡片下方的规则与键入相同；图文同板只把第一张图片写成卡片，夹带文字不得另行落入文本区

#### Scenario: 新消息按块序投递

- **WHEN** 用户输入前段、在中间插入卡片、再输入后段并发送
- **THEN** 新消息按文字 / 卡片 / 文字的块序呈现，MUST NOT 把卡片全部挪到前段之前；历史消息仍按留存原文呈现

#### Scenario: 行中插卡拆行

- **WHEN** caret 在某一行中间，用户加入一个附件
- **THEN** 该行在 caret 处拆成两行（插入一个真实 `\n`），卡片落在前后半句之间；拆行与卡片插入是同一条 transaction，一次撤销同时撤掉两者

#### Scenario: 文末插卡补行

- **WHEN** caret 在文档末尾（末行行尾或空文档），用户加入一个附件
- **THEN** 文末补一个 `\n` 造出下方行（空文档不补），卡片在全部文字之后、caret 在新行行首；随后键入从卡片下方开始

#### Scenario: 跨卡文本选区只删除文本

- **WHEN** 用户从一张卡片上方的文字选到卡片下方的文字，按 Backspace / Delete
- **THEN** 只有选中的文本被删除，选区覆盖的卡片全部保留；每张卡的 anchor 按精确偏移映射（不钳行首），不丢卡、不报错；随后 undo 恢复原 anchor 与块序

#### Scenario: 复制只取问题文字

- **WHEN** composer 内有卡片，用户 ⌘A 后 ⌘C，或选中跨卡的一段文本后 ⌘C
- **THEN** 应用内 copy 事件的数据逐字节等于选中的问题文字；系统剪贴板读取按平台归一后（统一行尾、去一个尾换行）相等；两者都不含卡片摘录、`×` / `@` 文本、占位字符或哨兵字符

#### Scenario: IME 组合期连续两卡后发送

- **WHEN** 用户在 IME 组合期间连续发起两次插卡请求，未等组合结束就触发发送
- **THEN** 发送投影前队列按序 drain，两张卡片按请求顺序落入 composer 并进入投递；MUST NOT 因发送清空队列、MUST NOT 丢任一张卡；组合文本不丢、组合不被打断

#### Scenario: AX 卡片不可编辑不可聚焦

- **WHEN** 读屏读取 composer 子树
- **THEN** 卡片摘录按视觉顺序出现在其下方文字之前；卡片标记 MUST NOT 出现在 **composer 的** `AXTextArea.value` 中，MUST NOT 作为可编辑或可聚焦控件暴露；编辑器源文档可以包含原始摘录，负向断言 MUST NOT 扩大到编辑器的 `AXTextArea.value`；composer 子树不可读时断言必须 FAIL，不得空过

#### Scenario: 延迟发送只触发一次

- **WHEN** 组合期已有插卡请求，用户在组合结束前连续触发两次发送（Enter / 发送钮）
- **THEN** 只有一个 `pendingSend` 被设置；`compositionend` drain 成功后只发送一条消息，MUST NOT 重复投递；重复触发不产生第二条消息

#### Scenario: 切视图取消延迟发送

- **WHEN** `pendingSend` 已设置，随后切 vault / 新会话 / 面板销毁
- **THEN** pending 被清空、旧视图的队列被清空，新的 `compositionend` MUST NOT 发送旧视图的消息；新视图的发送不受影响

#### Scenario: drain 失败不投递缺卡消息

- **WHEN** `pendingSend` 已设置，`compositionend` 后 drain 某条插卡请求失败
- **THEN** 发送被取消，未消费请求保留在队列中，MUST NOT 发出缺卡消息；后续可重试 drain，成功后才允许发送

### Requirement: CM composer 的单一 history

composer SHALL 使用 CodeMirror history 作为文本与卡片的唯一撤销 / 重做真源，MUST NOT 再维护 DOM / blocks 快照栈。卡片 SHALL 以 `{ id, card, anchor }` 记录：`id` 是会话内稳定身份，`anchor` 是文档中的**精确 UTF-16 偏移**（不要求行首）。卡片添加与移除 SHALL 由专用 StateEffect 更新 StateField；移除按 `id` 定位，MUST NOT 按下标定位；附件结构事务 SHALL 与相邻编辑隔离。composer MUST NOT 在现有 history 上执行 `addToHistory:false` 或 `remote` 的文档变更；装载 / 复位（草稿恢复、切 vault、新会话、会话重载、发送清空）MUST 新建 `EditorState` 重置 history，MUST NOT 用 `state.update({annotations: Transaction.addToHistory.of(false)})` 在旧 state 上打补丁。连续文本输入 SHALL 按 CM history 聚簇；IME 整段 history SHALL 由 CM 管理，MUST NOT 在 compositionstart/end 手工压栈。导航本身 MUST NOT 产生编辑 undo 事件。

文本 Backspace / Delete、⌘A、普通输入、粘贴与 IME MUST NOT 发出附件增删 effect，因此不得增删或重排卡片；文本变更引起的 anchor 映射是机械重映射，不属于附件编辑。重置、草稿恢复、切 vault 和发送成功后的空输入 SHALL 是新的编辑史，MUST NOT 撤销回另一 vault 或已发送内容。

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
- **THEN** 该事务被拒绝（开发断言 / 过滤器），composer 内容与 history 不变；装载 / 复位路径必须新建 `EditorState`，旧 history 不可达；MUST NOT 用 sync effect 的 `mapPos` 补映射

### Requirement: 新消息的附件前置序列化协议

发送新消息时，系统 SHALL 按**块序**投影：把文档在每个卡片锚点**偏移**处切开，按文字 / 卡片锚点的合并顺序产出块序列；每段文档摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，消息摘录沿用 `<msg-quote>`；`lines` MUST 非空，属性值与文本节点 MUST 做 XML 转义。`projectDelivery` SHALL 继续单源产出 panelText 与 parts，发送方 MUST NOT 另写一套序列化。

文本区没有卡片时，`composerBlocks()` SHALL 产出与现行单段落文档相同的 `[paragraph(doc)]`，`panelText` 与「单段落文档的现行投影」逐字节相同（段落仍过 XML 转义，MUST NOT 声称与 doc 原文逐字节相同）。有卡片时，`panelText` SHALL 等于「把文档在每个锚点偏移处切开、插入该锚点上的卡片行后拼回」；`parts` SHALL 按块序在图片块处 flush 文本、图片 part 落在它的块位置，MUST NOT 再把完整问题统一放到最后。

序列化结构 SHALL NOT 包含引用 / 消息摘录卡片编号；图片仍是唯一例外，按「图片编号与引用」携带 `Image N` 结构化标签。序列化后的完整消息 SHALL 以 wire 形态逐字节留存。历史消息的任意交错解析与显示 SHALL 保留，MUST NOT 因新 composer 的块序语义改写历史 JSONL；重试仍回放 `input` 历史里的 user 消息原文，MUST NOT 从 composer 状态二次投影。

#### Scenario: 新消息统一附件前置

- **WHEN** 全部卡片都锚在问题文字之前（例如先插卡、再在卡片下方输入完整问题），用户发送
- **THEN** 投递先出现 `<quote>` / `<msg-quote>` 文本上下文及图片 part，最后才是完整问题——这是块序的一个特例；卡片相对顺序与视觉顺序一致

#### Scenario: 新消息按块序投影

- **WHEN** 当前文本是「前段 / 后段」，一张引用卡锚在前段之后、一张图片锚在后段之后，用户发送
- **THEN** 投递先出现前段文字、再出现 `<quote>`、再出现后段文字与图片 part；卡片相对顺序与视觉顺序一致，MUST NOT 出现「全部卡片在前、完整问题在后」

#### Scenario: 无卡时与单段落投影逐字节一致

- **WHEN** composer 只有纯文本（无卡片），文本含 `<`、`&` 等需要转义的字符
- **THEN** `composerBlocks()` 只产出一个段落块，`panelText` 等于现行单段落投影（同样的 XML 转义），`parts` 只有这一个 text part

#### Scenario: 转义与零编号回归

- **WHEN** 摘录原文或出处含 `<`、`&`、`"` 等字符，消息含引用 / 消息摘录与图片
- **THEN** XML 转义 round-trip 还原；`<quote>` / `<msg-quote>` 无序号属性，图片标签编号与卡片徽标一致

#### Scenario: 历史消息不改写

- **WHEN** 历史 JSONL 中一条用户消息是「问题1 / 卡片 / 问题2」交错形态
- **THEN** 恢复与 transcript 仍按原顺序显示和再投影，文件逐字节不变

### Requirement: 区外图片附件粘贴

harness composer SHALL 支持粘贴剪贴板图片：含 `image/*` 时拦截粘贴，把图片落到 `<config_dir>/harness/attachments/<vault 稳定 id>/` 的内容寻址文件，并按「CM 对话输入区与区外附件」的落位规则插入图片卡片。vault 稳定 id、MIME / 50MB / 转码 / 不降级分辨率、图优先、多图取第一项和不写 vault 的既有约束不变。图片落盘成功 SHALL 按 caret 落位：caret 在行首时锚在该行行首，在行中时拆行，在行尾且其后还有行时锚到下一行行首（不额外插空行），在文末时补行；caret 停在卡片下方行首，MUST NOT 删除或改写问题文字。失败后给人话 toast、不插卡片、不留半截临时文件。

图片卡片 SHALL 呈现可见缩略图与移除钮；字节经读回命令按需取，MUST NOT 把 base64 落进卡片数据、草稿或留存。发送后 transcript 按块序投影呈现，历史快照仍能从引用还原任意交错图片卡。

#### Scenario: 贴图只追加附件

- **WHEN** caret 在文末，用户粘贴一张 png 截图
- **THEN** 图片写 harness 附件目录，文末补一个 `\n`、图片卡片追加在全部文字之后；原文本逐字节保留、caret 在新行行首、焦点在文本区；vault 零写入，可直接继续输入

#### Scenario: 图文同板与失败回归

- **WHEN** 剪贴板同时含文字和多张图片，或图片格式不支持 / 超限 / 落盘失败
- **THEN** 前者只取第一张图且不写夹带文字；后者给对应 toast、无新卡片、无半截文件，原文本保持

#### Scenario: 行中贴图拆行

- **WHEN** 问题文字中间有 caret，用户粘贴一张 png 截图
- **THEN** 该行在 caret 处拆行，图片卡片落在前后半句之间；原文本逐字节保留、caret 在卡片下方行首；拆行与卡片插入是同一条 transaction

### Requirement: 附件前置图片投递协议

发送新消息时，系统 SHALL 把卡片按**块序**投影为 Responses API content parts：图片 part 落在它的块位置，文本 part 是相邻文字行的连续段；块序是唯一顺序，MUST NOT 以「全部附件前置」为固定投影（全部卡片恰在文字之前只是块序的一个特例）。文本与图片由既有 `projectDelivery` 同源产出，文本 part MUST NOT 包含引用 / 消息摘录卡片编号；图片按同一编号源携带 `Image N` 结构化标签。

会话 input 项与 JSONL MUST NOT 内联图片字节；图片以 `lumir-attachment://<内容寻址名>` 引用留存，provider wire 在发送前展开为 data URL。展开失败不得静默缺图；引用按当前 vault id 解析，历史恢复继续从 wire 引用还原图片卡片及其历史交错位置。块序投影 MUST NOT 改变 wire 的 part 类型、标签格式或留存形态。

#### Scenario: content parts 附件前置

- **WHEN** 全部卡片都锚在完整问题之前（例如先插图片 A、引用卡、图片 B，再在下方输入多行问题），用户发送
- **THEN** 图片 A / B 的 parts 与引用上下文都在完整问题之前，图片相对顺序和标签为 Image 1 / Image 2；这是块序的特例，问题换行完整保留

#### Scenario: content parts 按块序交错

- **WHEN** 块序为「文字 A / 图片 X / 文字 B / 引用卡 / 文字 C」，用户发送
- **THEN** parts 依次是 text(A)、image(X, Image 1)、text(B + 引用上下文 + C)；图片标签与卡片徽标一致，问题换行完整保留

#### Scenario: 引用进留存、展开进 wire

- **WHEN** 携带图片卡片的交错消息发出并落盘
- **THEN** JSONL 中只有 harness 附件引用且无 base64，provider 请求同位置是展开后的 data URL；展开失败则本轮人话收口、不缺图发送

#### Scenario: 历史交错消息不改写

- **WHEN** 恢复一条历史交错消息，其中图片卡在文字之间
- **THEN** 恢复路径按留存原文还原图片卡片及其交错位置，JSONL 逐字节不变；编号按该消息自己的图序重建

### Requirement: composer 草稿 v2 与一次性 v1 转换

composer 内容 SHALL 作为当前 vault 的一份草稿自动保存与恢复；落点、tmp+rename、无 vault 不落盘、防抖、离散 flush、无变更不写、写失败 warning、串行写清、per-vault 隔离及发送成功 / 失败语义不变。草稿 MUST NOT 写入 vault。每次写入链 SHALL 捕获当前编辑世代；写失败时只有 epoch 未变且期间无新编辑才允许恢复原 pending。新编辑写已入链时，旧写 MUST NOT 借失败回填取得待写所有权；无新编辑时仍 SHALL 保留失败内容供后续 flush 重试。

草稿的归属 SHALL 在出发时绑定：前端在装载 vault 时记下该 vault 的稳定 id，读、写、清除命令 MUST 携带它；后端 SHALL 只按携带的 id 解析落点，MUST NOT 读取当前打开的 vault。切 vault 之前发出的在途写无论何时执行 MUST 只落它出发时的 vault 的文件，MUST NOT 写进之后打开的 vault；在途读的结果 MUST 按装载世代作废，不得覆盖新 vault 的输入区或「已落盘」基准。写失败重试 SHALL 仍打出发时的归属 id。切换 vault 时旧 vault 的待写按既有纪律丢弃（由切换前的 flush 写走），其迟到失败 MUST NOT 回填新 vault 的待写、MUST NOT 改变新 vault 的「已落盘」基准。

新草稿 SHALL 是 `{version:3,text,caret,cards}`：text 是完整问题，caret 是 `[0,text.length]` 内 UTF-16 offset 或 null，cards 按**视觉顺序**逐项保存 `{card, at}`——`card` 是既有附件记录，`at` 是该卡的**精确 UTF-16 偏移**（不要求行首，`0 <= at <= text.length`）。图片只存内容寻址名、源 mime 与可选宽高，MUST NOT 内联 base64；v3 合法往返必须逐字段还原（anchor 逐卡还原）。`id` 不写盘，恢复时按数组顺序重新编号。

**CRLF 归一放在所有版本解析 / 迁移完成后的共同出口**：CM 在 `EditorState.create` 时按 `/\r\n?|\n/` 分行并统一为 LF，原始 CRLF 坐标（caret / `at`）不能直接灌进 state。v1 / v2 / v3 SHALL 先各自解析 / 迁移成同形状草稿（`{text,caret,cards:[{card,at}]}`，仍是原始坐标），再统一把 `\r\n` / `\r` 归一为 `\n`，并用同一份原始 offset → 归一 offset 映射重定位 caret 与每张卡的 `at`。归一后的草稿 SHALL 同时用于**写回 v3**与**创建 `EditorState`**；MUST NOT 只归一文本而保留原始坐标，MUST NOT 让写回与 state 使用两份不同坐标。混合行界（`\r\n` / `\r` / `\n` 混用）按同一扫描处理。

现存 v2 与 v1 都是迁移的具体消费者。读到合法 v2 时 SHALL 一次性转换：可见内容保留，**行尾及坐标按共同出口的统一映射归一**（不是字节级原样保留）；全部卡片落 `at: 0`（等价于 v2 的「卡片全在前」语义），caret 由原始偏移映射到归一文本坐标。读到合法 v1 时 SHALL 沿用现行转换（段落按原顺序以 `\n` 连接，未知块以可见 JSON 文本加入，卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，无后续则全文末尾），再全部落 `at: 0`。v1 / v2 转换成功后 SHALL 立即经既有串行 store 写回 v3，此后只读 / 只写 v3；MUST NOT 双写、保留旧编辑路径或建立通用迁移平台。load 起始 SHALL 捕获编辑世代；读盘期间发生新编辑时 MUST 跳过旧迁移写回及 written 基准覆盖，保留当前 pending / written。迁移写一旦入串行链，后续编辑写 SHALL 排在其后，最终落盘必须是最新输入。损坏 v1 / v2 / v3 安静回空；迁移写失败不谎报已保存。

发送被同步拒绝、而拒绝回包晚于用户的下一条输入时，输入区的合并 SHALL 保持「原文在前、当前在后」：文本为 `restored.text + current.text`，当前卡片的 anchor 平移 `restored.text.length`，再按精确偏移稳定排序；MUST NOT 为对齐行首补换行、MUST NOT 钳到行首。精确偏移模型下，当前卡片平移到原文末尾后由块级 widget 在该偏移拆文本，自然落在原文之后、当前文字之前。当前侧为空态时 SHALL 原样返回 restored。

#### Scenario: v2 往返与合法 caret

- **WHEN** 盘上是合法 v2 草稿，包含多行文本、三类附件和文本中部 caret，装载同一 vault 后重开
- **THEN** text / caret / cards 逐字段保留（全部卡片落 `at: 0`，即 v2 的「卡片全在前」语义），图片引用不变且无 base64；读回后立即写回 v3，重新装载 v3 仍逐字段还原

#### Scenario: v1 一次性转换不丢内容

- **WHEN** 现存 v1 含交错段落、未知块、三类卡片与段落 / 卡片 / 末尾 caret
- **THEN** 所有段落和未知块可见文本各出现一次，卡片相对顺序不变且全部落 `at: 0`，caret 按合同映射且合法；成功后盘上只写一份 v3，无双写

#### Scenario: 发送与写失败保留语义

- **WHEN** 发送成功、发送被能力闸拒绝，或草稿写盘失败
- **THEN** 成功清空草稿；拒绝恢复发送前 text / caret / cards 且草稿不变；写失败给 warning、不阻断输入、不谎报已保存

#### Scenario: 旧写失败不夺回新编辑的待写所有权

- **WHEN** v1 / v2 迁移写或普通 v3 旧写在途，新输入 flush 已入串行链，随后旧写失败、新写成功并再次 flush；对照组旧写失败期间无新编辑
- **THEN** 前者再次 flush 不得写出旧内容，盘上逐字节保持新输入；对照组保留原待写并可在下一次 flush 成功重试

#### Scenario: 迟到的旧写不串台

- **WHEN** vault-a 的草稿写已发出但在途，随后切到 vault-b 完成装载，旧的写才执行
- **THEN** 它只落 vault-a 的草稿文件、逐字节不改 vault-b 的草稿；vault-b 的后续编辑只写 vault-b

#### Scenario: 迟到的旧读不污染新现场

- **WHEN** vault-a 的草稿读已发出但在途，装载 vault-b 的读先完成，旧的读才返回
- **THEN** 旧读结果整体作废（不返回内容、不铺进输入区），vault-b 的「已落盘」基准与盘上草稿不变

#### Scenario: v3 往返与合法 caret

- **WHEN** 草稿包含多行文本、三类卡片、行首与**行中**锚点、文本中部 caret，保存后重开同一 vault
- **THEN** text / caret / cards 逐字段恢复，每张卡（含行中 anchor）与视觉顺序不变，图片引用不变且无 base64；撤销史不跨进程恢复

#### Scenario: CRLF v3 装载与坐标重映射

- **WHEN** 盘上 v3 草稿的 text 是 `A\r\nB\r\nC`，caret 在 B 之后（原始 offset 4），一张卡片的 `at` 指向 C 行首（原始 offset 6）
- **THEN** 创建 state 前文本归一为 `A\nB\nC`，caret 与 `at` 用同一映射重定位（分别变为 3 与 4）；恢复后的文本、caret、anchor 与 `composerBlocks()` 顺序全部正确，MUST NOT 把原始 CRLF 坐标直接灌进 state

#### Scenario: CRLF v2 caret 归一

- **WHEN** 盘上 v2 草稿的 text 是 `A\r\nB\r\nC`，caret 在 B 之后（原始 offset 4），cards 含一张卡片
- **THEN** 迁移先得到 v3 形状（卡片 `at: 0`，caret 仍为原始 4），共同出口把文本归一为 `A\nB\nC`、caret 映射为 3；写回的 v3 与创建的 state 都用这份归一草稿，MUST NOT 把 caret 4 直接灌进 state

#### Scenario: 混合行界 v1 归一

- **WHEN** 现存 v1 的段落文本混用 `\r\n`、`\r`、`\n`（如 `A\r\nB`、`C\rD`、`E\nF`），caret 位于其中一个段落之后
- **THEN** v1 转换后走共同出口：所有行界归一为 `\n`，caret 按同一原始 offset → 归一 offset 映射重定位，可见文本一段不丢；写回 v3 与创建 state 使用同一份归一坐标

#### Scenario: 写失败重试仍落出发时的 vault

- **WHEN** vault-a 的草稿写失败（人话 warning），随后用户在 vault-a 里再次 flush
- **THEN** 重试携带的归属仍是 vault-a，成功后才更新 vault-a 的草稿；期间切换到的其他 vault 的草稿与待写不受影响

#### Scenario: 发送被拒合并不丢卡片

- **WHEN** 发送被拒的回包晚于用户的下一条输入：原文末尾无换行，当前侧已粘贴一张图片卡片
- **THEN** 合并结果是「原文 + 当前文字」（MUST NOT 补换行），当前图片卡 anchor 平移原文长度后恰好落在原文末尾、当前文字之前；块级 widget 在该偏移拆文本，两边内容一张不丢，anchor 不需要是行首

### Requirement: 摘录引用卡片

系统 SHALL 提供摘录创建手势：在编辑器 pane 中选中片段后出现浮动「摘录到对话」钮，点击把该片段作为引用附件按「CM 对话输入区与区外附件」的落位规则加入对话输入区；harness 面板未打开时 SHALL 先打开面板再入卡片。**钮的出现时机 SHALL 是「选区完成后」**：鼠标拖拽选区在松开（mouseup）前 MUST NOT 出现，键盘建立的选区在选区稳定（停止变化约 350ms）后才出现，选区清空或移出编辑器即消失。**落点 SHALL 就近取选区末端（光标侧）附近**，且钮整体 MUST 钳制在触发面板可视区内（M531 不变量）。每张卡片 SHALL 呈现：引号竖条、摘录原文截断（至多两行）、出处行（文档名 · 最近一级标题；摘录在文档首个标题之前时仅显示文档名）、（输入区内）移除钮；hover SHALL 显示完整摘录与完整标题链。卡片数据 SHALL 携带：vault 相对路径 file、最近一级标题 heading、行范围 lines（从选区捕获，MUST 非空，取不到行范围时 MUST NOT 生成卡片）、摘录原文。点击卡片 SHALL 跳回原文位置并瞬态高亮，MUST NOT 删除问题文字或改变卡片数量。编辑器侧 SHALL NOT 出现任何常驻的摘录相关装饰——只存在两种瞬态：存在的选区（含浮动钮）、跳回高亮。摘录来源 SHALL 为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义），harness 面板持焦 MUST NOT 改变该归属。

#### Scenario: 选区创建卡片

- **WHEN** 在编辑器 pane 中选中一段文字并点击浮动「摘录到对话」钮
- **THEN** 对话输入区出现一张引用卡片（竖条 + 至多两行摘录 + 出处行），落在 caret 处（caret 在行中则拆行）；卡片数据含该文件的相对路径、最近一级标题、选区行范围与摘录原文；编辑器侧无任何常驻装饰残留

#### Scenario: 点击卡片跳回高亮

- **WHEN** 点击输入区或已发送消息中的引用卡片
- **THEN** 对应编辑器 pane 定位到摘录原文位置并瞬态高亮（约 1.4s 消退）；输入区的问题文字与卡片数量不变

### Requirement: 消息摘录序列化协议

发送新消息时，消息摘录附件 SHALL 序列化为 `<msg-quote role="…" at="…">摘录原文</msg-quote>`——每段消息摘录一行，全部 `<msg-quote>` 上下文 SHALL 按「新消息的附件前置序列化协议」条的**块序**投影落在各自锚点位置（该 requirement 标题沿用归档身份，正文口径以块序为准）；历史已发送消息的任意交错顺序只用于留存、解析与呈现，MUST NOT 被重排。`role` MUST 为 `user` 或 `assistant` 且 MUST 在场；`at`（来源消息上屏时刻，ISO 8601 本地时间串、秒级）可缺——不可考时产出 role-only 元素；属性值与文本节点 MUST 做 XML 转义。序列化结构 SHALL NOT 包含任何编号——遵循一致性原则：投递给模型的上下文要素对人必须也可查（transcript who 行显示角色与相对时间、卡片 hover 显示完整摘录与绝对时间），编号对人无区分价值故不进协议。会话 JSONL 留存 SHALL 记录序列化后的完整消息（含 `<msg-quote>` 元素，与 `<quote>` 同纪律），历史 JSONL MUST NOT 因新投递语义改写。解析还原路径 SHALL 识别 `<msg-quote>` 还原为消息摘录卡片，并保留历史消息的文字 / 卡片交错顺序；对不识别元素 SHALL 保守处理，MUST NOT 静默丢弃其文本内容。agent 回复 SHALL 按摘录内容与角色/时间回指。

#### Scenario: 序列化结构

- **WHEN** 发送一条「消息摘录卡 + 问题」的消息
- **THEN** 模型收到的消息中摘录为一个 `<msg-quote>` 元素（role 属性在场且合法、at 随来源消息可缺、无编号属性），问题文字按块序落在 `</msg-quote>` 之后

#### Scenario: 转义 round-trip

- **WHEN** 摘录原文含 `<`、`&`、`"` 等字符，或来源消息无 at
- **THEN** 序列化输出中对应位置为 XML 转义形式，解析后还原为原文；无 at 来源产出无 at 属性的元素，解析还原为 at 为空的消息摘录卡片

#### Scenario: UI 与协议无编号

- **WHEN** 输入区或 transcript 呈现消息摘录卡片，或 agent 回复引用某段消息摘录
- **THEN** 界面任何位置与投递给模型的消息中均不出现 `#N` / `index` 形式的卡片编号

#### Scenario: 未知元素保守处理

- **WHEN** 快照恢复的留存消息文本中含序列化协议不认识的元素
- **THEN** 该元素的文本内容 MUST NOT 被静默丢弃（维持既有保守解析口径）

### Requirement: 区外图片附件编号与引用

图片编号 SHALL 在一条消息内按**块序** 1-based 分配，只计图片块，不含引用 / 消息摘录或文本；移除后即时重编且无空号。编号 MUST 是派生读数，不持久化进卡片源数据；composer 徽标、transcript 与投递标签共用同一编号函数，MUST NOT 从卡片数组下标另取一份。

composer 图片卡片 SHALL 提供 `@` 钮，点击在当前文本选区插入普通 `Image N` 文本，不拆段落；插入后 caret 在文本之后。`N` SHALL 在点击时按附件 id 在块序里反查，MUST NOT 使用渲染时的旧编号。后续图片重编号 MUST NOT 静默改写已插入文本。发送时每张图片的标签紧邻其内容之前，标签进 provider wire、以结构化字段留存而不进留存文本面；历史恢复继续按原图序重建编号。

#### Scenario: 删除重编与 @ 插入

- **WHEN** 输入区按块序有图片 A / B / C，删除 A 后在问题中部点击新编号 B 的 @
- **THEN** 剩余卡即时显示 1 / 2；原 caret 处插入普通 `Image 1`，文本不拆段、caret 在插入文本之后，既有引用文本不被重写

#### Scenario: 徽标与 wire 标签同源

- **WHEN** 发送含两张图片且未使用 @ 的消息，随后恢复历史
- **THEN** 两个图片 part 分别带 Image 1 / Image 2，编号与发送时徽标一致；留存文本面无标签行，历史恢复编号不变

### Requirement: 区外消息摘录附件

系统 SHALL 提供消息摘录手势：在 transcript 用户 / 助手消息体内选中片段后出现浮动「摘录到对话」钮，点击把消息摘录按「CM 对话输入区与区外附件」的落位规则加入对话输入区；面板未打开时先打开。选区稳定时机、落点钳制、排除思考 / 工具 / 批准 / 引用卡内部选区和两手势互斥不变。附件呈现竖条、至多两行摘录、`对话 · 角色` 出处、移除钮与完整摘录 / 绝对时间 hover；数据保留 role、可缺 at 与所见文本。

点击附件 SHALL 按 role+at → 摘录原文搜索 → 失锚 toast 的三层路径跳回并瞬态高亮，MUST NOT 静默跳到其他消息。插入 SHALL 按 caret 落位规则执行：可能拆行 / 补行、caret 落到卡片下方行首，MUST NOT 删除问题文字；完成后焦点回文本区。携带消息摘录时继续跳过视口注入；历史快照仍按留存原文还原消息摘录卡及其历史交错位置。

#### Scenario: 消息摘录入 tray 后可继续输入

- **WHEN** 在 transcript 助手消息中选择一段并点击摘录钮，且 composer 的 caret 在某行行首（不触发拆行的情形）
- **THEN** 该行上方新增消息摘录卡片，原文本逐字节不变、caret 落在该行行首即卡片正下方、焦点回文本区；随后可直接继续输入，点击卡片可定位来源并高亮

#### Scenario: 排除面、失锚与历史恢复

- **WHEN** 选区来自排除面，或来源消息已不在当前会话，或恢复一条历史交错消息
- **THEN** 排除面不产卡；失锚给 toast 不错跳；历史消息仍按原交错顺序显示并还原 role / at / 摘录文本

### Requirement: CM composer 的 Emacs 文本导航族

composer 的 Emacs 文本导航族 SHALL 经统一键位表 `text` 作用域分发，并适配到 CM EditorView / EditorState；MUST NOT 再由旧块模型或浏览器原生 contenteditable caret 决定。键位覆盖不变：⌃F/B、⌃A/E、⌃N/P、⌃D/H、⌥D/⌥⌫、⌃K/Y、⌃T、扩选六键与按词扩选；族外键位路径不变。

所有命令只作用于纯文本。字符与视觉行移动、逻辑行首尾和扩选 SHALL 用 CM 移动原语；扩选 anchor 不动。字素簇 / 词边界 SHALL 复用编辑器共享扫描核；⌃D/H 与**折叠光标上的无修饰物理 Backspace** 删除一个字素簇或选区（同一份 `clusterBackward` 步长），⌥D/⌥⌫ 按词 kill，⌃K kill 到逻辑行尾（在行尾则杀行界），⌃Y 插入共享 kill 槽，⌃T 转置相邻字素簇。kill 槽继续跨编辑器 / composer 共用，内容不含卡片。任何文本命令 MUST NOT 添加、移除或重排卡片；anchor 按精确偏移随文档映射（MUST NOT 钳到行首），不属于「重排」。

物理 Backspace / Delete 的 `deleteContentBackward` / `deleteContentForward` SHALL 由 composer 的 `beforeinput` 闸门按统一选区事务合同处理：单区间非空选区 MUST `preventDefault()` 并按 `state.selection` 删除；折叠 caret 上只有 Backspace（`deleteContentBackward`）由本闸门接管，按同一份 `clusterBackward` 删一个整字素簇，forward Delete 交还原生路径。一次删除 = 一条 history 步（一次 undo 复原）。修饰键变体（`deleteWordBackward` / `deleteHardLineBackward` / `deleteSoftLineBackward`）、IME 组合期、只读会话与多区间 MUST NOT 被本闸门改变；MUST NOT 在 composer 侧复制第二份字素判定表。

#### Scenario: 文本移动、扩选与删除不触附件

- **WHEN** composer 内有卡片，用户在多行 / 软折行文本中执行移动、扩选、字符 / 词删除和转置
- **THEN** 文本与 selection 按 CM / 共享词法语义变化，导航不产编辑 undo；卡片数量、身份与相对顺序不变，anchor 按精确偏移映射（可落在行中）

#### Scenario: 物理 Backspace 与 ⌃H 同一步长

- **GIVEN** composer 文档为 `A مَ B`、`x👍🏽y` 或 `xe\u0301\u0323y`，caret 在簇之后且无选区
- **WHEN** 按一次无修饰 Backspace
- **THEN** 文档分别变为 `A  B`、`xy`、`xy`——base 与全部附标 / 修饰符一起删除，MUST NOT 只剩码点后缀
- **AND** 同一次按压的 `editor.delete-char-backward`（⌃H）结果逐字节相同；一次 undo 复原；卡片不增删，anchor 按精确偏移映射

#### Scenario: kill-yank 跨面共用

- **WHEN** 在编辑器 kill 一段多行文本后到 composer yank，再反向操作
- **THEN** 两侧使用同一 kill 槽与连续 kill 合并规则，多行文本进入当前文本选区，卡片不成为 kill 内容

### Requirement: CM composer 的文本全选

焦点在 composer 文本区时按 ⌘A SHALL 经统一键位表选择 `0 → doc.length` 的全部问题文字，MUST NOT 选到编辑器 / transcript，也 MUST NOT 选择、删除或高亮卡片。后续删除 / 键入只替换全部文本；undo 恢复文本与 selection，卡片数量、身份与相对顺序保持不变（anchor 按精确偏移映射，MUST NOT 钳到行首）。选区绘制 SHALL 使用 CM 自身选区层，不再存在旧块级自绘高亮。

#### Scenario: 全选只覆盖文本

- **WHEN** composer 有多行问题和多张卡片，按 ⌘A 后键入一个字符再撤销
- **THEN** 键入后文本只剩该字符、卡片全部在场且相对顺序不变；撤销恢复全部原文本，整个过程中卡片数量、身份与相对顺序不变，anchor 按精确偏移映射（不要求行首）
