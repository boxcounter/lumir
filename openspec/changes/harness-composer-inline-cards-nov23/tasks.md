# Tasks: harness-composer-inline-cards-nov23

> 施工前提：**节点 1 已于 2026-11-23 通过**（见 [proposal.md](proposal.md)「节点状态」）。B0–B5 已裁，
> 本次通过确认方案可施工；裁决 / 评审若改了 §3 边界或标题策略，先改 proposal / design / delta
> 再施工，不静默扩 scope。
>
> **先红后绿**：每个行为先写一个在旧实现上必须判红的用例，实测红了再改实现；禁止先改实现后补
> 断言。**视觉基线**：候选截图先送 Alex 过目，未批不得 `--update`。**信息卫生**：所有 fixture
> 只用合成摘录 / 合成图片名 / 合成 vault 名。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：把评审结论与日期抄进 `proposal.md` 的节点状态块；未通过前不进入实现
- [x] 0.2 开工前过一遍 `REVIEW.md`，逐条对照改动面（尤其「断言等价于子串」「读不到当成空」
      「同一语义两处真源」「overflow 容器先定档」四条）
- [x] 0.3 红线：不提前改写 `openspec/specs/harness/spec.md`；living spec 只由归档并入
- [x] 0.4 红线：不回到 contenteditable、不写占位字符、不做卡片可编辑 / 可聚焦 / 可跨选 /
      键盘删卡
- [x] 0.5 红线：不改 `harness_send` / `parts_json` / `context_json` / JSONL / Rust 投递协议；
      Rust 零改动（草稿 v3 仍只搬运字符串）
- [x] 0.6 开工当天复核 design §1–§6 的行号锚点（`composerBlocks` / `composerAttachmentEffect` /
      tray DOM / `@` 编号 / `DRAFT_VERSION`）；漂了就改 design 再施工
- [x] 0.7 施工核对（不重新裁 B0–B5）：行尾初始落位、IME FIFO drain、精确偏移 / sync effect 按
      design §3–§5 执行；若与已批准 B0–B5 冲突，停下返修 proposal / design / delta 并记录，
      **不得**重新请 Alex 裁 B0–B5

## 1. 先红（旧实现上必须红）

- [x] 1.1 初始落位矩阵单测（新 `tests/unit/composer-inline-cards.test.ts`）：行首 / 行中 / 行尾
      非末行 / 文末 / 空文档 / 非空选区六组；断言**初始** anchor 是行首、caret 落在卡下方、
      文档改动与 effect 同事务
- [x] 1.2 投影单测：`[para, quote, image, para]` → parts `[text, image, text]`；`panelText` 与
      「切开拼回」逐字节一致；无卡时与单段落投影逐字节一致；行中 anchor 的切分正确
- [x] 1.3 精确锚点映射单测（**先红**）：在 anchor 前 / 上 / 后插入；删除行界后 doc=`AB`、
      anchor=1、`composerBlocks` 仍是 `[A, card, B]`；跨行删除；⌘A 替换覆盖 anchor；每种都断言
      完整 `composerBlocks()` 与每张卡 anchor，MUST NOT 只断言「卡片不丢 / 卡片间不翻转」
- [x] 1.4 undo / redo 精确还原单测（**先红**）：删除行界 / 跨行删除 / ⌘A 替换后 undo，断言
      anchor 回到原值、`composerBlocks()` 逐项恢复（如 `[A, card, B]`）；只靠 `mapPos` 的旧实现
      必须红；行中插卡（拆行 + effect）一步 undo / redo；移除 + undo 恢复原堆叠位次
- [x] 1.4a **分组 undo / redo**：连续两次 `input.type` 合并为一组；undo 恢复最早 anchor /
      `composerBlocks`，redo 恢复最终 anchor / `composerBlocks`；实测「最后一条 sync 胜出」
- [x] 1.4b **非 history 变更禁止路径**：在现有 state 上 dispatch `addToHistory:false` / `remote`
      的 doc 变更必须被拒绝（开发断言 / 过滤器）或测试证明重置路径新建 state、旧 history 不可达；
      并断言 **MUST NOT** 用 sync effect `mapPos` 补映射（分组 undo 会二次位移）
- [x] 1.5 草稿单测：v3 往返（含行首 / 行中 anchor）；**真实 CRLF v3**（`A\r\nB\r\nC` → `A\nB\nC`，
      caret / at 同映射）；**CRLF v2 caret**（原始 4 → 归一 3）；**混合行界 v1**（`\r\n` / `\r` /
      `\n` 混用）；v2 → 全 0 + 立即写 v3；v1 → 直接 v3；越界 / 非整数钳制；损坏回空；旧写失败
      不夺回新编辑（现有用例改准）
- [x] 1.6 发送被拒合并单测：原文末尾无换行 + 当前侧有卡 → **不补 `\n`**、anchor 平移原文长度、
      排序正确；当前侧无卡 → 纯拼接不变；空当前态原样返回
- [x] 1.7 图片编号单测：块序派生；`@` 按 id 反查 = 徽标；删图后重编；已插入 `Image N` 不回写
- [x] 1.8 结构场景先红：卡片在 `.cm-content` 内、位于两行文字之间；`.lumir-hp-composer-tray`
      零命中；占位符不在卡片上；旧实现上这些断言必须红
- [ ] 1.9 真机场景骨架先落（步骤见 §7.1），旧实现跑出预期红：卡在 tray、不在 caret 处（骨架 722 已落；本任务禁止真机，旧实现真机红与后续真机验收归主会话串行执行）
- [x] 1.10 在旧实现上跑 1.1–1.9，日志落 `.local/reviews/ux-improvements/composer-red.log`；
      逐条确认红的原因与预期一致（不是 fixture / 断言自身坏）

## 2. 数据模型与 effects（`src/harness-composer.ts`）

- [x] 2.1 新增 `PlacedAttachment { id, card, anchor }`；`ComposerContent.cards` 改为
      `readonly PlacedAttachment[]`；模块级单调 id 计数器
- [x] 2.2 `composerAttachmentsField` 改为 `StateField<readonly PlacedAttachment[]>`；`update` 里
      精确映射 anchor（`mapPos(anchor, -1)`，**不钳行首**），再按 `(anchor, 映射前位次)` 稳定
      排序，应用结构 effects；`!tr.docChanged && 无 effects` 时返回原引用
- [x] 2.3 新增 `composerAnchorsSyncEffect` + `EditorState.transactionExtender`：每个改 doc 或卡片
      结构的事务写入事务后的完整数组；载荷是最终文档坐标，**不再 mapEffect**；事务已带 sync
      effect 时不重复追加；undo / redo / select.undo / select.redo 事务跳过（否则覆盖精确恢复值）
- [x] 2.3a **非 history 变更 guard**：开发 / 测试构建用事务过滤器或断言拒绝现有 composer state
      上的 `addToHistory:false` / `remote` doc 变更；装载 / 复位（`restoreDraft` / `resetComposer` /
      `vaultChanged` / 新会话 / 发送清空）一律 `createComposerState` 新建 state，MUST NOT 用
      `state.update({annotations: addToHistory.of(false)})`；MUST NOT 给 sync effect 加 `mapPos`
- [x] 2.4 `invertedEffects` **只为 sync effect** 产出逆 effect（载荷 = `tr.startState` 的完整
      数组）；结构 insert / remove 不再单独提供逆 effect（避免双重应用）；`StateField.update`
      采用**最后一条** sync effect（分组撤销时逆 effect 逆序排列，最后一条才是最早事务的数组），
      测试路径用同一纯函数兜底
- [x] 2.5 `appendComposerAttachments` 改为「在 caret 处落位」的事务构造器：按 §3 计算初始
      `changes`（必要时插 `\n`）+ effects + `selection = cursor(anchor)` +
      `isolateHistory.of("full")` + `userEvent: "input.card-insert"`
- [x] 2.6 `mergeRejectedComposerContent` 按 design §11.4 改：`text = restored + current`、anchor
      平移原文长度、稳定排序；**不补换行、不钳行首**；空当前态原样返回
- [x] 2.7 `composerBlocks` 按 design §7.1 重写：按精确偏移分组、锚点前若有 `\n` 去掉一个行界、
      末段；无卡时与现行输出逐字段一致；行中 anchor 正确切分
- [x] 2.8 `composerContentOf` 返回 placed cards；`composerIsEmpty` 仍按 doc + cards
- [x] 2.9 1.1–1.4b 转绿；`tests/unit/composer-codemirror.test.ts` / `composer-nav.test.ts` 的
      既有断言按新模型改准（不得削弱）

## 3. 装饰与 widget（`src/harness-composer.ts` + `src/harness-panel.ts`）

- [x] 3.1 新增 `composerInlineCards` 扩展：`EditorView.decorations.compute([field], …)`，按
      **精确偏移**分组、每偏移一个 `Decoration.widget({ block: true, side: -1 })`；
      `RangeSetBuilder` 按 anchor 升序添加；行中偏移由 CM 拆 textblock，不加占位
- [x] 3.2 `InlineCardsWidget extends WidgetType`：`toDOM` 建 `.lumir-hp-cwidget` 容器 + 复用
      `createCardEl`；`eq` 比较 id 序列 / 卡片身份 / 编号序列（200 字逐键不重建）；`updateDOM`
      就地更新徽标与 `@` 可读名；`estimatedHeight = -1`；`destroy` 后下一帧
      `imageThumbCache.prune()`
- [x] 3.3 卡片工厂去掉 `dataset.attachmentIndex`，改 `dataset.attachmentId`；移除按钮按 id
      调 `removeComposerAttachment(id)`；`@` 按 id 反查当前编号（design §10）
- [x] 3.4 删除 `composerTray` 创建 / append（`src/harness-panel.ts:3737`、`:3796`）、
      `renderComposerAttachments` 的 tray 重渲路径、`renderedComposerAttachments` 缓存
- [x] 3.5 `updateEmptyClass` 改用 `composerIsEmpty`（doc 空 **且** 卡片空）；占位符不得压在
      卡片上
- [x] 3.6 `src/style.css` / `src/harness-panel.css`：删 `.lumir-hp-composer-tray` 一族；新增
      `.lumir-hp-cwidget`（无纵向 margin、`padding-block`、相邻卡不叠双倍间距、首卡上缘归零、
      内层 `.lumir-hp-qcard { margin-block: 0 }`）
- [x] 3.7 缩略图 / `imageSourceOf` / `imageGateErrored` / `quoteImageFailures` / 失败留痕沿用；
      widget 重建不重复发读图命令（缓存命中 + `eq`）
- [x] 3.8 1.8 结构场景转绿；`tests/unit/harness-thumb-cache.test.ts` 从 tray 挂载改为 widget
      挂载，断言不减

## 4. 入口接线（`src/harness-panel.ts`）

- [x] 4.1 `appendAttachments` 改成「按 caret 落位」；四个入口（拖拽 / 消息摘录 / 图片粘贴 /
      引用插入）全部走它，不另写落位
- [x] 4.2 插入后焦点回文本区、caret 在卡下方行首；面板未开时先开面板（现行路径保留）
- [x] 4.3 IME：`view.composing` / `compositionStarted` 时把插卡请求入 **FIFO**；`compositionend`
      后按序 drain，每条成功落入 composer 后才出队；`send()` 投影前先 drain，无法安全 drain 时
      延迟发送，**MUST NOT 清空队列**；切 vault / 新会话 / 面板销毁才清空；移除卡不受影响
- [x] 4.3a **单个 `pendingSend` + 视图世代**：重复触发（Enter / 按钮 / 命令）合并为一次；
      `compositionend` drain 成功且 generation 匹配时清空 pending 并只调一次 `performSend()`；
      切 vault / 新会话 / 面板销毁递增 generation 并取消；drain 失败取消发送、保留未消费请求，
      MUST NOT 发缺卡消息；**MUST NOT** 用 `activity.phase` 代替 pending 去重
- [x] 4.3b 连续两卡：组合期请求两次插卡后发送 → 两张卡按序落入 composer 并按序投递；旧实现
      / 清空队列的实现必须红
- [x] 4.3c 三组 pendingSend 测试：①重复触发只发一次；②切视图（vault / 新会话 / 销毁）取消旧
      pending；③drain 失败取消发送且未消费请求保留、后续可重试
- [x] 4.4 `@` 按钮：点击时按 id 反查编号；插入仍是 `Image N` 普通文本；不拆段、不改写既有
      引用文本
- [x] 4.5 发送路径：`composerBlocks` / `projectComposerDelivery` 已是块序；`hasCards` 判据不变；
      `appendUserMessage` 按交错 blocks 渲染（多个段落块各成一个 `.lumir-hp-qtext`）
- [x] 4.6 重试 / 历史：确认重试仍回放 `input` 原文、历史仍走 `parseQuoteMessage`；不新增二次
      投影
- [x] 4.7 1.5–1.7 转绿；`tests/unit/composer-reject-merge.test.ts` / `composer-draft.test.ts` /
      `harness-draft.test.ts` 按新类型改准

## 5. 草稿 v3（`src/quote-card.ts` + `src/harness-draft.ts`）

- [x] 5.1 `DRAFT_VERSION = 3`；`ComposerDraft` / `ParsedComposerDraft` 改为 placed cards
      （`{ card, at }`）；`serializeComposerDraft` 写视觉顺序、不写 id
- [x] 5.2 `readComposerDraft`：v1 / v2 / v3 先各自解析 / 迁移成同形状草稿（原始坐标）；v3 越界
      钳到 `[0,text.length]`（**不钳行首**）；v2 可见内容保留、cards 全 0、`migrated: true`；
      v1 现行转换后 cards 全 0、`migrated: true`；损坏 → null
- [x] 5.3 **共同出口** `normalizeDraftForState(draft)`：`normalizeLineEndings(text)` +
      原始 offset → 归一 offset 映射，**同时**重定位 `caret` 与每张卡的 `at`；返回
      `{ draft, changed }`。写回 v3 与创建 state 必须用同一份归一草稿；`migrated || changed`
      立即写 v3；覆盖 CRLF v3 / **CRLF v2 caret** / **混合行界 v1**
- [x] 5.4 `harness-draft.ts` 的 `schedule` / `load` / `ComposerDraftLoaded` 改为 placed cards；
      「无变更不写」「写失败不谎报」「旧写不夺回新编辑」「归属 vault」语义逐条不变
- [x] 5.5 `harness-panel.ts` 的 `markDraft` / `restoreDraft` / `resetComposer` 接线；草稿恢复
      后 anchor 逐卡还原（含行中 anchor / CRLF 归一）
- [x] 5.6 1.5 转绿；`tests/unit/harness-draft.test.ts` / `harness-draft-clear-sent.test.ts` /
      `draft-vault-ownership.test.ts` 全绿

## 6. 选区、剪贴板、键盘

- [x] 6.1 单测：`⌘A` 只选 `0 → doc.length`；跨卡文本选区删除只删文本、卡片保留、anchor 精确
      映射（不钳行首）
- [x] 6.2 应用内 copy event：读取 `DataTransfer`，逐字节等于选区文本；不含卡片摘录 / `×` / `@` /
      占位 / 哨兵
- [ ] 6.3 真机外部剪贴板：`⌘A` → `⌘C` → 外部粘贴，按平台归一后（统一行尾、去一个尾换行）比较，
      **不得**写「逐字节」；另负向断言无卡片摘录 / `×` / `@` / 占位 / 哨兵（场景 722 已落；真机归主会话）
- [ ] 6.4 真机：Backspace / Delete 紧邻卡片只删文本，卡片数量与数据不变；删除行界后
      `composerBlocks` 顺序不变（场景 722 已落；真机归主会话）
- [x] 6.5 若真机发现 CM 原生选区删除按 DOM 形状走：按 `state.selection` 显式 dispatch 兜底；
      判据是删除后 doc 逐字节等于按选区计算的期望（Chromium 红测命中并已修绿；真机复核归主会话）

## 7. 验收场景（真机矩阵）

- [x] 7.1 新增真机场景（id / item 按 `node scripts/acceptance/run.mjs --list` 当前最大值 +1，
      **不预占**；文件建议 `harness-composer-inline-cards`，`tier: core`）：
  1. 打开面板，输入两句问题；`Enter` 开新行；插入 quote 卡 → 顺序 = 文字 / 卡 / 空行（卡在
     caret 行上方），caret 在卡下方
  2. 再插一张卡、再打字、再插一张图 → 顺序 = 卡 卡 文字 卡 文字；AX 有序断言（见 7.3）
  3. 行中插入：caret 放在一句话中间 → 拆行、卡在前后半句之间，文本不丢
  4. 文末插入：不先按 Enter → 卡在文末、caret 在新行行首
  5. 撤销：⌘Z 一步撤掉「插卡 + 拆行」，文本回到插卡前；⌘⇧Z 全恢复
  6. 剪贴板：`⌘A` → `⌘C` → 外部粘贴，按平台归一比较；应用内 copy event 另做逐字节断言
  7. Backspace / Delete 紧邻卡片：文本变、卡片数不变
  8. 删除行界：`A\nB` + 卡在中间 → 删 `\n` → 顺序仍 A / 卡 / B；⌘Z 后 anchor 与原块序还原
  9. 跨行删除 / ⌘A 替换：卡片不丢、顺序确定；undo 恢复原 anchor 与 `composerBlocks`
  10. 草稿：切 vault 往返 / 重启 → 卡片回到正确偏移、文本逐字节一致；CRLF v3 装载用例
  11. IME：组合中插卡 → 延迟到 compositionend；连续两次插卡后发送 → 两张卡按序投递；组合
      文本不丢、组合不被打断
  12. 延迟发送：重复触发只发一次；切 vault / 新会话后旧 pending 不发；drain 失败不投递缺卡
      消息、未消费请求保留
- [x] 7.2 mock / fixture：新建或复用合成 fixture（合成 quote / msgquote / 图片名），不写真实
      vault 内容；图片用合成 png（固定 seed）
- [x] 7.3 AX 有序断言（**必须限定 composer 子树**）：给验收套件新增 scoped 断言（建议
      `ax: { scope: <node locator>, order: [CW-CARD-A, CW-TEXT-B] }` 或结构化节点序列），
      实现要解析 composer 节点后只在该子树里判序；找不到 scope / 不唯一 / 不可读 → FAIL。
      负控**只反转 composer 内的 widget 顺序**、编辑器 fixture 不动，必须判红；若对调编辑器原文
      也能判红，说明断言没限定子树。同场负向只断言卡片标记不在 **composer 的**
      `AXTextArea.value`；**编辑器源文档允许包含原始摘录**，MUST NOT 写成「任何
      AXTextArea.value」。卡片不可编辑 / 不可聚焦。套件新断言必须带自测（正向 / 反向 /
      不可读三档）
- [x] 7.4 回扫既有验收场景（逐份判断，受影响的改准，不受的不动）：
      `81` / `83` / `84` / `85` / `117` / `121` / `127` / `128` / `129` / `135` / `136` /
      `137` / `138` / `139` / `140` / `142` / `144` / `145` / `146` / `147` / `148` / `150` /
      `154` / `156` / `215` / `222` / `232` / `233` / `262` / `268` / `269` / `720`。
      重点：`127` 的「附件追加不移动 caret」与「txtprobe-plainimgmark-b」拼接待改准；`135` 的
      `"version":2` 改 `"version":3`；`148` 的编号取法；`81` / `83` / `85` 的卡片在场 /
      顺序断言
- [x] 7.5 回扫视觉场景（tray 选择器 / composer 卡片断言）：`m831` / `m815` / `m627` / `m440` /
      `m454` / `m423` / `m633` / `m345` / `m347` / `m351` / `editing-oracle` /
      `text-clipboard-adversarial` / `harness-send-reject-nov22` / `harness-turn-retry-nov23`；
      选择器改 `.cm-content .lumir-hp-cwidget .lumir-hp-qcard` 一族，断言强度不降
- [x] 7.6 `node scripts/acceptance/coverage.mjs` 重新生成 `COVERAGE.md`；
      `coverage.mjs --check` 与 `run.mjs --check` 通过
- [ ] 7.7 真机跑新场景 + 受影响场景，证据落 `.local/acceptance/<批次>/`（git 外）；FAIL 逐条
      定位，不把偶发超窗当产品缺陷、不静默重跑（本任务不启动 Lumir；主会话串行执行）
- [x] 7.8 证据目录用绝对路径 `ls` 一遍再写进报告（REVIEW.md「证据只在终端跑过」条）

## 8. 视觉（结构 → 像素 → 基线）

- [x] 8.1 结构断言（chromium，CI 层）：卡片在 `.cm-content` 内、位于两段文字之间（**行首
      anchor 与行中 anchor 两种形态都要覆盖**）；tray 零命中；占位符不压卡；`@` / `×` / 徽标
      在位；选区高亮不覆盖卡片；行中 anchor 不产生 doc 换行
- [ ] 8.2 本地像素对比：跑 `scripts/gate.sh visual`，产出候选截图到
      `.local/reviews/ux-improvements/composer-visual-candidate/`；并排列出现行基线的每一处差异（已产行首 / 行中候选，未跑全量 visual；完整对比归主会话）
- [ ] 8.3 **候选截图先送 Alex 过目**；未批不得 `--update`；批准后更新基线并复跑 `visual`，
      按 AGENTS.md「视觉门禁卫生」核对该元素出现过的整页基线时间戳（候选已备，待 Alex 过目；本任务未更新基线）
- [ ] 8.4 三主题 + eink 目检；滚动条归「细条」档（`.lumir-hp-composer` 已在
      `tests/unit/scrollbar-registry.test.ts` 登记，新增容器须先归挡）（未新增 overflow 容器；三主题目检归主会话完整 visual / Alex）
- [x] 8.5 手感 / 审美项（滚动节奏、点击跳回、`×` 反馈）只留截图与真机证据，标「归 Alex」，
      不进机器判据

## 9. 文档与门禁

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:`
      原文；日志 `.local/reviews/ux-improvements/composer-validate.log`
- [x] 9.2 `bash scripts/docs-check.sh` 通过（含 MODIFIED 对账、归档队列、backlog、场景契约）；
      日志 `.local/reviews/ux-improvements/composer-docs-check.log`
- [ ] 9.3 `scripts/gate.sh quick` 通过：照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）；日志
      `.local/reviews/ux-improvements/composer-quick.log`（按分工未跑，主会话串行执行）
- [ ] 9.4 `scripts/gate.sh visual` 通过（动过 `src/style.css` / `src/harness-panel.css`，必须
      本地跑像素层）；日志 `.local/reviews/ux-improvements/composer-visual.log`（按分工未跑，主会话串行执行；像素基线未动）
- [ ] 9.5 真机证据与 7.7 同目录；报告里给绝对路径（真机归主会话）
- [x] 9.6 更新 `openspec/changes/harness-composer-inline-cards-nov23/specs/harness/spec.md` 的
      口径与实现一致（实现期发现 delta 需改时，先改 proposal / design 并重走节点 1，不静默扩
      scope）
- [x] 9.7 同步 `docs/specs/harness-composer.md`：HC1–HC6 已按精确偏移 / sync effect / **非 history
      变更禁止** / IME FIFO + **pendingSend** / 块序投递 / **全版本共同出口 CRLF** 重写；AX 负向
      只查 composer 的 `AXTextArea.value`；实现期逐条核对，发现偏差改合同或改实现，不留旧 tray /
      附件前置 / 行首 anchor 术语
- [x] 9.8 文档与实现一致性：delta 的「精确偏移 / sync effect / 不补换行」与 HC 合同、design、
      proposal 四处逐条对照，禁止一处说行首、一处说精确偏移

## 10. 性能

- [ ] 10.1 跑既有 perf 套件：`node scripts/perf/keypress-to-paint.mjs`（或该套件当前入口），
      记录读数与对照合同 `<16ms`；证据落 `.local/perf/` 或 `.local/reviews/ux-improvements/`（主会话串行执行）
- [x] 10.2 卡片在场连续输入 **200 字**：记录键入总耗时 / 帧时间，确认无长帧；脚本与原始读数
      落 `.local/reviews/ux-improvements/composer-perf-200chars.log`
- [x] 10.3 **widget DOM 身份复用**：200 字过程中卡片 DOM 节点引用不变（`eq` 命中、不重建），
      用 DOM / 单测断言；证据与 10.2 同目录
- [x] 10.4 **图片读回不重复**：键入期间 `harnessReadImage` 调用计数不增加（缓存命中 + `eq`），
      用注入的计数桩断言；证据与 10.2 同目录
- [ ] 10.5 常驻内存对照项目 `<200MB`（如本 change 触及内存面）；浏览器读数不得冒充整个 Tauri app（主会话按真机 perf 口径测量）

## 11. 信息卫生

- [x] 11.1 所有 fixture / 视觉场景 / 验收场景只用合成摘录、合成图片名（`pasted-…`）、合成
      vault 名；MUST NOT 出现真实人名、真实项目 / 目录 / 文件名、真实文档正文
- [x] 11.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`
- [x] 11.3 本 change 无原型 HTML；若实现期新增原型，必须内置可点击控制面板并同步重截

## 12. 收尾

- [x] 12.1 `tasks.md` 全部勾选；未勾项就地写放弃理由（不删任务项、不留空勾）
- [x] 12.2 `proposal.md` 节点状态块按实情更新（**不得把待批写成已批**）
- [x] 12.3 `docs/backlog.md` 归档跟踪队列落一条本 change 记录（五要件齐待归档 / 命中例外待裁）
- [ ] 12.4 交独立 reviewer；verdict 绑定当前 tip（主会话在提交后安排）
- [ ] 12.5 归档前逐条核对节点 2 五要件；归档走 `node scripts/openspec-archive.mjs <change-id>`，
      归档提交后跑 `--archived` 审计至 PASS（待真机、完整 visual、候选裁决与独立 reviewer，主会话执行）
