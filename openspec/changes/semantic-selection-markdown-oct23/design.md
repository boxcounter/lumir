# Design: 指针选区的语义外扩（Markdown 语法包裹）

- Change ID: `semantic-selection-markdown-oct23`
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在本分支
（基于 master `57fa68b`）逐一读过原文的位置；行号会漂，实现前以符号名为准。

## 1. 调研：方法、读数与可靠性

| 对象 | 读到什么 | 信源与可靠度 |
|---|---|---|
| Obsidian Live Preview | 「显示格式化文本、隐藏大部分 Markdown 语法；光标进入格式内容时、底层语法可见」；0.13.8 changelog 有「Improved selection when selecting across hidden Markdown formatting syntax」一条 | 官方 Help 页与官方 changelog（高）；「拖选边界不含定界符」这一具体形态官方文档没直说，本轮**未做一手实测**，结论由 CM6 的坐标→位置映射机制与用户现场报告交叉推得（中） |
| Obsidian 复制 | 编辑视图复制出去的是含 `#` / `*` 的源码文本；阅读视图复制得到渲染文本 | 官方论坛多用户现场（中） |
| Typora | 默认复制是纯文本 / 富文本（无标记）；`Copy as Markdown`（⌘⇧C）才转换；偏好里可把「Copy Markdown source as plain text」设为默认 | 官方支持页（高） |
| iA Writer | 编辑面是带语法高亮的纯文本，Preview 才呈现格式化结果 | 官方 Features 页（高，用于「标记常显」这一事实）；「选中时边界含标记」是对该形态的直接推论（高） |
| VS Code | 语义扩选是显式命令 `Expand AST Selection`（⌃⇧⌘→ / `editor.action.smartSelect.expand`），另有 Shrink；不是拖选时自动发生 | 官方默认键位表（高） |
| 双击 / 三击 | 三家都能核到的通行语义是「双击选词、三击选行 / 段」；**本轮未对 Obsidian / Typora 的双击 / 三击做一手实测** | 只作旁证、不作判据；Lumir 的现状以本仓 CM6 源码为准（§2 第 12 条） |

未验证项照实登记：**没有一款目标编辑器在本轮做过一手操作实测**（本机只装了 Obsidian，
未在用户 vault 上做交互；Typora / iA Writer 未安装）。mission 允许的「一手实测或官方文档」
走的是官方文档一侧，社区现场只作旁证。

## 2. 现状链路（为什么会出现「看得见、选不到」）

| 环 | 事实 | 锚点 |
|---|---|---|
| 1 | 渲染态隐藏标题定界串（含其后一个空格） | `src/preview/livePreview.ts:1153-1165` |
| 2 | 渲染态隐藏强调系两侧定界符 | `src/preview/livePreview.ts:1169-1191` |
| 3 | 渲染态隐藏链接的 `[` 与 `](target)`，label 上屏 | `src/preview/livePreview.ts:1322-1323` |
| 4 | 标题的显露判据是整行、含端点相接（M297） | `src/preview/livePreview.ts:1153` |
| 5 | 强调系的显露判据是节点、含端点相接（M168） | `src/preview/livePreview.ts:1171` |
| 6 | 链接的显露判据是节点、严格重叠（M145） | `src/preview/livePreview.ts:1295` |
| 7 | 按压期间显露判定用按下瞬间的选区快照（M259），拖拽中布局不动 | `src/preview/reveal-gate.ts:39-53`、`:71-96`；接线 `src/preview/livePreview.ts:601-617` |
| 8 | 松开时解冻（window 层 mouseup，晚于 CM 自己的 mouseup），装饰按活选区重建 | `src/preview/reveal-gate.ts:78`、`:91-96` |
| 9 | 装饰重建的触发条件含 `pointerPressFrame` | `src/preview/livePreview.ts:625-637`、`:737-752` |
| 10 | ⌘C 读 `EditorState.selection`（CM 原生复制），不经过任何自定义序列化 | CM 默认行为；仓内无 copy 事件处理器（`rg "copy"` 无编辑器侧消费者） |
| 11 | Quote to chat 记录选区后按 `doc.sliceString(from, to)` 取文本 | `src/quote-gesture.ts:455-482`、`:557-565` |
| 12 | 三击本来就选整行源码（含隐藏定界符），双击只选词 | `node_modules/@codemirror/view/dist/index.js:5000-5015`（`rangeForClick`）、`:5026-5048`（`basicMouseSelection`） |
| 13 | 选区与光标由 CM 自绘（M285），高亮 = `EditorState.selection` | `src/editor.ts:2050`（`drawSelection()`）；`openspec/specs/editor-live-preview/spec.md:28` |
| 14 | DOM 选区 ↔ 文档位置的映射：拖拽走 CM 的 `posAndSideAtCoords`（按可见布局），Quote 手势走 `view.posAtDOM`；隐藏段零宽，边界位置两侧共用同一屏幕坐标 | `node_modules/@codemirror/view/dist/index.js:5026-5048`；`src/quote-gesture.ts:455-482`；零宽导致的两义性另见 `src/preview/hidden-tail-caret.ts:1-22`（M539 的成因段） |

链路合成：拖选时（7）冻结 → 屏幕上只有渲染文本被高亮；松开（8）解冻 → 标记上屏，**选区范围
没有变**（CM 的拖动选区在 mousemove 阶段就定了）→ 第 1/2/3 条隐藏的字符重新占宽并可见，
第 13 条的高亮仍只覆盖原范围。第 10/11 条两个消费者再把这个范围原样读走。

## 3. 外扩规则（形式化）

### 3.1 规则本体

对每个选区 range `[a, b)` 与每个候选构造 `N`（D4 的封闭集合）：

```
node(N)     = 该构造的**节点源码范围**——外扩的目标（标题的 `#` 串 + 标题文字；强调系的
              两侧定界符 + 内容；链接的 `[label](target)` 整条）
visible(N)  = node(N) 内、渲染态没有隐藏字符覆盖的源码区间 = [visFrom, visTo)
hidden(N)   = node(N) \ visible(N)  —— 也就是渲染态被 replace 掉的那些字符
gate(N)     = 该构造的**显露判据**（标题行级 / 强调节点含端点 / 链接严格重叠）——
              它只回答「选区与这个构造相接时要不要撤下装饰」，不是外扩目标
```

- **条件**：`a <= visFrom` 且 `b >= visTo`（选区**完整覆盖**该构造的全部渲染文本），
  且 `[a, b)` 不完整包含 `node(N)`（否则无事可做）。
- **空白口径**：`visFrom` / `visTo` 取该构造**第一个 / 最后一个可见非空白字符**的位置——
  首尾空白不参与「完整覆盖」的判定。理由：带缩进的标题（`  # 标题`）的前导空格在渲染态可见
  但多半不在拖选范围里；以空白为边界会让规则在这类输入上静默不生效。外扩目标仍是完整
  `node(N)`。
- **动作**：把该 range 外扩到 `[min(a, node.from), max(b, node.to))`；方向 MUST 保留——
  原 range 是反向选区（anchor 在右）时，外扩后 anchor / head 仍分别落在原来的两端，不得整体翻转
  （翻转会让随后的 shift+方向键语义反向，也让 Quote 钮的「光标侧」落点跳到另一头）。
- **迭代**：一个 range 上重复扫描直到不动点——嵌套构造（`***粗斜***`、链接 label 内的强调）
  由内向外逐层外扩；轮数受节点深度约束（实现上设上限，参照 M539 filter 的 `guard < 8` 写法）。
- **幂等**：`[a, b)` 已包含 `node(N)` 时条件不成立，不外扩。
- **部分覆盖**：`a > visFrom` 或 `b < visTo` 时不外扩——引用标题中间一段短语的场景保持纯文本。

**为什么 `node(N)` 不是 `gate(N)` 的扫描范围**：标题的显露判据是**整行**（M297），但撤下装饰后
上屏的只有 `#` 串与标题文字——行首缩进与引用前缀 `> ` 属于别的构造。若按整行外扩，引用块里的
标题就会把 `> ` 一并吞进引用（`> # 标题` 整行），把用户没选的东西塞进卡片。强调与链接的判据
与节点范围本来就重合，不受影响。这条也顺带回答了「为什么不能直接拿显露判据当外扩目标」。

### 3.2 外扩目标来自三处既有节点口径，显露判据只保证「必然上屏」

| 构造 | `node(N)` | 保证上屏的 `gate(N)` |
|---|---|---|
| ATX 标题 | 标题节点范围（`HeaderMark` 串 + 标题文字；带缩进时不含行首空白，闭合 `#` 串在内） | M297：选区触及整行（含端点相接）⇒ `#` 串显露 |
| 强调系 | 节点范围 `[node.from, node.to)` | M168：选区与节点相接（含端点）⇒ 定界符显露 |
| 标准链接 | 节点范围 `[node.from, node.to)` | M145：选区与节点严格重叠 ⇒ `[` 与 `](target)` 显露 |

这套对应关系同时回答「为什么外扩以后就一定所见=所得」：选区的可见文本覆盖了节点内容 ⇒
`gate(N)` 必然命中（标题行被触及、强调节点被相接、链接被重叠）⇒ 该节点范围内被隐藏的字符
全部上屏，而这些字符现在都在选区内。「必然命中」这一步是规则的前置条件送出来的，实现时不需要
再判一次显露——但**测试要断言**它（否则将来谁改了判据，外扩就会静默产出「选中了但没上屏」）。

**实现纪律**：`node` 与 `visible` 的判定 MUST 与本文件 §2 第 1–6 条的装饰层实现同源。
建议把「构造 → (node 范围, 可见区间)」抽成一个纯函数模块（例如 `src/preview/syntax-envelope.ts`），
装饰层的隐藏分支与新的外扩器都从它取值；MUST NOT 在外扩器里另写一份「`#` 后面跟一个空格」
这类字面规则（REVIEW.md「同一语义两处真源」条：同一条语义两处实现，改一处必漏另一处）。
抽取的边界由实现者定：可以只抽「标记 span 枚举」这一层，装饰层继续负责视口与上下文排除
（frontmatter / 表格 / callout），外扩器负责构造识别与迭代。

### 3.3 为什么不用 transactionFilter

M539 的 `hiddenInlineTailCaretFilter`（`src/preview/hidden-tail-caret.ts:122-132`）是同一族
问题的先例，但它只消费**指针产生的空光标**，并明确「拖拽 / 双击 / 三击的非空选区一律不碰」。
外扩若做成 filter，会在拖拽的每一次 mousemove 事务上触发，而 CM 的 `basicMouseSelection`
每次 mousemove 都用「start.pos / cur.pos 与当下选区」重新推导范围
（`node_modules/@codemirror/view/dist/index.js:5026-5048`）——中途改写选区会与状态机打架，
产生跳跃甚至回退。**外扩只在指针手势结束这一拍发生**，这是与 filter 方案的根本分界。

## 4. 事件顺序与实现落点

### 4.1 松开这一拍要发生三件事，顺序是契约

1. 选区外扩（dispatch；事务不标 `select.pointer`——M539 的过滤器以该标注识别「指针落点」，
   虽然它对非空选区直接放行，但这次改写不是一次新的落点，标成同类会给将来加判据的人埋歧义）；
2. 按压窗口关闭（`pointerPressFrame.of(null)`）——装饰按**外扩后的**选区重建；
3. Quote to chat 的浮动钮时机门看到外扩后的选区。

1 与 2 合并成**同一事务**（`{ selection, effects: pointerPressFrame.of(null) }`）：
装饰只重建一次、高亮与上屏落在同一帧，避免「先外扩后显露」两帧之间的中间态
（中间态会短暂出现「标记上屏但未被选中」，正是本 change 要消除的形态）。

### 4.2 落点候选与顺序约束

- 候选 ①：在 live preview 的 `EditorView.domEventHandlers({ mouseup })` 里做（contentDOM 冒泡段）。
  此时 `document` 层的 Quote 手势还没收到 mouseup、`window` 层的按压窗口也还没关——
  刚好满足「外扩在两者之前」。实现时必须在同一事务里带上 `pointerPressFrame.of(null)`，
  让 `reveal-gate.endPointerPress` 的后续调用成为空操作（它已经带 `if (field)` 判空，
  `src/preview/reveal-gate.ts:91-96`）。
- 候选 ②：扩展 `reveal-gate` 的 window 层 mouseup 监听，先外扩再解冻。缺点是 `reveal-gate`
  是模式无关的基础设施，把 Markdown 语法语义塞进去会破坏它的分层（文件头写明它只管
  「判据选区」与「相接口径」）。

倾向 ①。**顺序假设必须由探针确认**（tasks §1）：CM 的 `MouseSelection` 与 Quote 手势
分别挂在什么节点、谁先收到 mouseup，决定了外扩是否会在手势读取选区之后才落地。

### 4.3 与 Quote 手势的时序（本 change 最容易回归的一处）

`createQuoteGesture` 的时机门（`src/quote-gesture.ts:518-548`）状态机是：
`mouse-down` → `dragging = true`；`selection-change(valid)` 在 dragging 期间只记录、不排期；
`mouse-up` → `dragging = false`、`revealAt = now`（立即浮现）。

风险：若外扩事务落在**手势的 mouseup 之后**，它会再触发一次 `selectionchange`。此时
`dragging` 已是 false，状态机会把它当成键盘选区，排期 `now + GESTURE_SETTLE_MS`（350ms）
——浮动钮会先消失再在 350ms 后出现，是一次肉眼可见的闪动。

判据（验收场景要能抓到）：**拖选 / 双击后松开，浮动钮的浮现不得晚于现状**（不引入 350ms
延迟）。实现选项：
- 首选：把外扩放在手势 mouseup **之前**（4.2 候选 ①），使手势只看到一次「选区已定」的
  mouseup，不产生额外的 selection-change 收口；
- 备选：外扩事务带一个专用 annotation（如 `semanticSnap`），手势侧在计算 `last` 时读它——
  但这会把「Markdown 语法」的概念漏进 `quote-gesture`，除非必须，不采用。

`last` 的更新走 `currentSelectionRect()`（`:455-482`）——它从 DOM 选区读 anchor/focus 再
`view.posAtDOM`，因此外扩后的 DOM 选区必须已同步（CM 在 dispatch 内同步 DOM 选区）。
探针项：外扩后立刻读 `document.getSelection()`，确认它已覆盖新范围。

### 4.4 双击

双击产生的选区由 `rangeForClick(view, pos, bias, 2)` → `groupAt`（按词）给出
（`node_modules/@codemirror/view/dist/index.js:5000-5015`）。它同样走 mouseup；外扩规则与拖选
一致（词恰好覆盖某构造全部渲染文本时才外扩）。双击不改变 CM 的选词行为，只在结束时补一拍。

### 4.5 三击

三击选整行源码（`visFrom` 之前、`visTo` 之后都在内），规则条件不成立 → 空操作。
不需要按 `event.detail` 分支。

### 4.6 多选区与越界

- 多 range：逐 range 外扩；`EditorSelection.create` 的 range 顺序与去重由 CM 处理。
- 越界：外扩只在语法树给出的节点范围上取值，不手工拼位置，天然不出文档边界。
- 文档变更：外扩事务本身不改文档；若在计算与 dispatch 之间文档被改（几乎不可能，同步执行），
  以 `tr.state` 为准重新取树。

## 5. 覆盖类型的可核对清单（D4 的实现面）

| 类型 | 渲染态隐藏 | 外扩目标（node 范围） | 纳入 | 实现注意 |
|---|---|---|---|---|
| ATX 标题 | `HeaderMark` 串（首个吃掉后随空格、其余吃前导空格） | 标题节点（`#` 串 + 标题文字；不含行首缩进与引用前缀 `> `） | 是 | 显露判据是整行（M297），但外扩目标取节点——按整行会把引用块前缀吞进选区（§3.1 末段） |
| 强调系 | `*Mark` / `StrikethroughMark` | 节点 | 是 | 嵌套用迭代；`***x***` 的层序由 lezer 树决定，不假设 |
| 标准链接 | `[` 与 `](target)` | 节点 | 是 | 只处理 `standardLinkParts` 可解析的形态；引用式链接近年保持原文、无隐藏尾标，自然不外扩 |
| 角括号字面链接 `<url>` | `<>` 两字符 | 节点 | 是（随链接口径） | 隐藏段很小，外扩效果等于把尖括号带进来 |
| 裸 URL | 无 | — | 不适用 | 无隐藏字符，规则空转 |
| 行内代码 | 无（反引号可见） | — | 否 | 显式排除，避免「因为它是 markdown 语法就顺手纳入」 |
| 列表标记 | `ListMark` 被 `ListMarker` widget 替换 | 无显露判据 | 否 | 见 §7 第 3 条 |
| 引用 / callout 前缀 | `QuoteMark` / callout 标记 | —（行级前缀，不取节点） | 否（v1） | 跨行引用每行一个 `>`，会改变选区形态 |
| wikilink | 整条替换为 `WikilinkWidget` | 无显露判据 | 否 | 同列表标记 |
| 图片 / 公式 / mermaid / frontmatter / 分隔线 | 整块或整条替换 | — | 否 | 没有可拖选的渲染文本 |

## 6. 与既有机制的不变量边界

1. **M259 按压窗口**：外扩只在窗口关闭那一拍发生；拖拽期间不触发任何事务，落点判定不跨布局。
2. **M539 隐藏尾标修正**：只消费空光标；本 change 只消费非空选区。两者在输入域上不相交，
   MUST NOT 互相调用或合并（合并会让其中一条的判据被另一条的假设污染）。
3. **M285 选区可见范围**：外扩后上屏的定界符必须带选中底色。因为它们都在 `EditorState.selection`
   里，`drawSelection()` 自然覆盖——但「同一帧」是前提（4.1 的合并事务），因此结构层要断言
   「松开后：选区范围包含定界符，且这些字符有选中底色」。真机层按 M285 的既有口径只判像素。
4. **M110 / M168 / M297 / M145 显露判据**：不修改；外扩只是把选区推到这些判据所约束的节点范围上。
5. **M461 裸 marker 行的列表编辑态**：列表标记的揭示是「光标驻留」口径、不是本条的节点外扩，
   不动。
6. **M277 / M285 的自绘选区**：外扩不依赖原生选区；`drawSelection` 是唯一绘制来源。

## 7. 风险与已知边界

1. **编辑语义的变化（D1 的代价）**：外扩后的选区被替换时会一并删掉定界字符（整标题替换成
   纯段落）。这是「选中整个标题」的字面后果，proposal 已列为需 Alex 确认的代价。
2. **链接 URL 的噪声**（D4）：拖选一个链接会把 `](target)` 一并带入引用卡片；若目标很长，
   卡片会被 URL 占满。备选是链接不纳入，代价是链接仍留同类不一致。**这条建议在 dogfood 时
   专门看一眼**。
3. **列表标记与 wikilink 的可见缺口**：它们的标记在渲染态**永远不上屏**，所以「上屏的源码」
   与「选区」之间不存在可见矛盾；若将来为它们补显露判据，本条的外扩范围要同步扩（写在这里
   以免下一个人按「所有 markdown 标记」去加）。
4. **callout 内容行的行级显露（M119）**：光标触及 callout 某行会整行显露行内标记；若选区只
   覆盖该行里一个粗体构造，外扩只带该构造的定界符，同一行其它构造的定界符仍会「上屏但未选中」
   ——这是 M119 行级口径的既有后果，不在本条修复面，dogfood 时留意即可。
5. **部分选择不回退**：用户拖选覆盖了标题的大部分但漏了最后一个字，规则不触发（严格「完整
   覆盖」）。这是刻意选择——用「近似覆盖」做模糊匹配会让选区在松开时随机跳。
6. **表格 cell 内的构造**：cell 内的强调系有渲染与显露（表格分支放行 `Emphasis` 一族），
   外扩应在 cell 内正常工作；跨 cell 的选区不保证（表格 grid 的选取形态另有口径）。
7. **性能**：外扩每次指针手势结束跑一次，遍历语法树只扫选区覆盖的区间（`syntaxTree(state).iterate`
   带 `from`/`to`），无全量装饰构建，不触碰 ADR 0002 §6 的打开路径。
8. **code 模式**：没有 live preview 装饰层，规则不装（自然不生效）。
9. **兜底断言的缺口**：M285 的结构层断言只覆盖「选区 = 底色」，不覆盖「上屏的源码 = 选区」。
   本 change 的新场景要同时断言两件事（§8）。
10. **松开瞬间的视觉跳变**：松开时标记上屏（布局右移）并且高亮左扩——两次变化同帧完成，
   观感上是一次「跳」。这是 D1=A 的固有形态：不跳的替代方案（拖拽中实时扩）已被证伪（§9）。
   手感归 dogfood；若 Alex 认为跳得生硬，可讨论的方向是「外扩时不动画、直接落定」这类节奏项，
   而不是改回实时外扩。

## 8. 验证计划与真机通道的能力边界

| 层 | 手段 | 判据 |
|---|---|---|
| 纯函数 | 单测（无 DOM，直接驱动外扩器） | 输入矩阵见下；含反向区分度（部分覆盖不外扩、已含定界符不变） |
| chromium 结构层 | Playwright（`tests/visual/scenes/`） | ① 拖选整段标题 / 粗体 → 松开后 `EditorState.selection` 覆盖定界符；② 上屏的定界符字符都有 `.cm-selectionBackground` 覆盖（M285 口径）；③ 拖拽中途（mouseup 前）选区范围不变、标记仍隐藏；④ 部分选择不外扩；⑤ 双击粗体词外扩；⑥ 三击无变化；⑦ 文档逐字节不变 |
| 真机（WKWebView） | 验收场景（`scripts/acceptance/`，编号见 tasks；227 / 228 已被在途 mission 占用） | **双击**粗体词 → 摘录浮动钮 → 点钮 → composer 文本含 `**…**`（composer 是 AX 可读面）；文档逐字节不变 |
| 手感 | Alex dogfood | 拖选标题 / 粗体的松开观感、引用卡片可读性（尤其带 URL 的链接） |

真机通道的硬边界（照实登记，来源 `scripts/acceptance/README.md`「已知边界」）：

- 套件的 `drag` **在编辑器的 WKWebView 里造不出文本选区**（M228 / M423 实测）；编辑器侧要造
  选区只能用**双击族**（`do: doubleClick`）或键盘 chord。
- 选区本身 AX 读不到（不暴露 `AXSelectedTextRange`），且「依赖 ⌘C 读回选区文本」的真机判据
  不可靠 ⇒ 真机断言必须落在**下游可读产物**（本 change 是 composer 里的摘录卡片文本）。
- 因此：**拖选路径的真机机器判据不存在**，它由 chromium 结构层 + Alex dogfood 两侧兜住；
  这是 D2 倾向「双击纳入」的直接理由之一（让真机层至少有一条可断言路径）。

纯函数输入矩阵（写作 tasks 的判据）：

| 维度 | 取值 |
|---|---|
| 构造 | 标题（1/6 级、带缩进、闭合 `#`）· 粗体 · 斜体（`*` 与 `_`）· 删除线 · 嵌套 `***x***` · 链接（标准 / 角括号 / 引用式 / blocked）· 行内 code · 列表项 · wikilink |
| 选区形态 | 恰好覆盖渲染文本 · 少一个字符 · 多覆盖到相邻行 · 覆盖整个构造（幂等）· 多 range · 空光标 |
| 上下文 | 普通段落 · 表格 cell 内 · callout 行内 · frontmatter 之后的第一个标题 · 文档首行 / 末行 |

## 9. 备选方案与否决理由

1. **实时外扩（拖拽中）**：隐藏段零宽，选区带不会向它延伸 ⇒ 视觉上无收益；若为此解冻显露，
   复发 M259 幻影选区。否决（D1=B）。
2. **copy / quote 时补全**：Alex 2026-10-23 已证伪（新的所见≠所得）。否决（D1=C）。
3. **显式 `Copy as Markdown` 命令**（Typora 式）：能取到源码，但不消除「上屏未选中」的矛盾，
   且要占键位与文案号；作为**未来可选能力**保留，不进本 change（Non-goals）。
4. **把显露判据改成「覆盖整块才显露」**：能消除不一致，但推翻 M297 / M168 的编辑进入路径
   （光标落在范围里看不到标记就无法编辑），代价远大于收益。否决。
5. **只改复制序列化、不改选区**：与「复制走 CM state」的事实冲突（拦截 copy 事件要自己实现
   序列化，还要覆盖 quote 路径），且同样引出「卡片有、屏幕没有」的所见≠所得。否决。
6. **把外扩做成 transactionFilter（M539 风格）**：与 CM 拖拽状态机打架（§3.3）。否决。

## 10. 裁决点映射

| 裁决点 | 影响 | 未回时的落地 |
|---|---|---|
| D1 生效时机 | §4（松开时、与解冻同事务）；delta 的「指针松开」措辞 | A（release-snap） |
| D2 双击 | §4.4；delta 的「双击同规则」句 | A（纳入） |
| D3 键盘 | delta 的「只适用于指针选区」句；tasks 是否含命令/文案/键位 | A（不做自动外扩，不加命令） |
| D4 覆盖类型 | §3.2 / §5 的封闭集合；delta 的排除清单 | 标题 + 强调系 + 标准链接 |
| D5 与 M650 边界 | Non-goals 与 tasks 的改动面 | A（互不重叠，各自独立） |
