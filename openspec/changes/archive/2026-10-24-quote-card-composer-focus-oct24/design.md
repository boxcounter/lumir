# Design: quote-card-composer-focus-oct24

## D1. 判据为什么是 DOM 焦点，不是 AX 的 focused 标记

真机套件的落点类断言惯用 `ax: { focused: "AXTextArea" }`（README 的「匹配值」段）。这一条在
**编辑器与 composer 同时在场**时不成立：两边的正文都是 `AXTextArea`，标记只能回答「有没有一个
AXTextArea 持焦」，分不出是哪一侧。M500/M502 已经实证过这条通道更坏的一面——`type_text` 无 index
的**真实投递**与 AX 的 `(focused)` 标记可以背离（标记在 composer、盲注落进编辑器，82/83/85 三场景
现场）。

因此本 change 的判据分两层：

- **单测层**（`tests/unit/harness-quote-focus.test.ts`）：读 `document.activeElement`——DOM 焦点的
  唯一真源，绕开 AX 的歧义；
- **真机层**（场景 163b）：读**落点**——卡片插入后直接键入，判「composer 里有串」+「编辑器逐字节
  未变」。焦点在编辑器时第一条可能绿（整棵 AX 树里都有该串），第二条必红。

## D2. 为什么「先 focus、再写 caret」

`withModel` 的重渲流程是「算模型 → `renderComposer`（`replaceChildren` + `setDomCaret`）」。
`setDomCaret` 写的是**文档级选区**，它不要求宿主元素持焦；而 contenteditable 在**获得焦点的那一拍**
可能按引擎口径重置 caret（WKWebView 在「元素未持焦时被写入选区、随后才 focus」这一档上的行为不可
依赖）。三条引用入口的现场恰好两种都有：

- 面板原本关着：装配层在 `deps.togglePane()` 里就把焦点交给了 composer，重渲时宿主已持焦；
- 面板原本开着：焦点还在编辑器里，重渲写完选区之后才 focus。

两种现场靠「碰巧的顺序」得出同一个结果，是本条要收掉的不确定性。落法：`withModel` 返回它重渲后
使用的模型光标（`ComposerCaret | null`），引用入口把这个值交给 `focusComposerAfterInsert`，由它
**在 focus 之后**再写一次——同一个模型位写两次是幂等的（`setDomCaret` 只做 `removeAllRanges` +
`addRange` + 滚动位），第二次才是权威。

代价：插入路径多一次 `setDomCaret`（含一次 `scrollCaretIntoView`，即「把卡片下方的问题段落滚进
视口」）。这正是插入后用户要看的位置，不是副作用。

## D3. 为什么只补一帧，不做持续重试

`focus()` 在两种时机可能「当拍不成立」：装配层刚把 panel 挂进 DOM 的那一拍（本 change 的路径里
挂载是同步的，正常当拍就成立），以及引擎在 click 分发尾部做的焦点修正。两者都落在**同一帧内**，
所以补一次 `requestAnimationFrame` 足够；**不排持续重试**——持续重试会在用户已经点走焦点之后
继续抢，把一个「插入后的落点」变成「全局焦点看守」。

失败方向是安全的：补完仍不持焦就停手（不回滚插入、不 toast）——卡片已经在输入区里，用户点一下
输入区即可继续，与改动前的行为等价。

## D4. 面板不在场时只返回

`focusComposerAfterInsert` 第一句是 `if (mountEl === null) return;`。装配层没能开出 pane（例如
分栏上限、开面板失败）时，composer 是**长驻内存但不在文档里**的元素——对不在文档里的元素 focus
会被引擎忽略，但更糟的是「以为移交成功」。这里的取舍：**插入照旧落进模型**（用户的内容不丢，
下次开面板可见 + 草稿已写），**只是不搬焦点**。

## D5. 场景 163b 的两处判据改写

1. **前置换成一个真实单击**（`clickEditor real: true`）：M670 的定因是「`focusWindow click: true`
   点的是标题栏拖拽区，那一下让 webview 失焦，此后移动与键盘注入整批停投」。键盘注入（⌃N /
   ⌃⇧N）与真实点击都要求 webview 有焦点，因此前台纪律落在正文单击上，与场景 222 同一条通道。
2. **键入通道用 `do: keys` 而不是 `typeInNode`**：`typeInNode` 的 attempt-1 焦点守卫会在目标
   没持焦时**先点目标**（M501），恰好把本场景要判的「产品有没有搬焦点」mask 掉——那也是一条假
   前置。`do: keys` 逐键注入的已知缺陷是本机确定性丢 `'e'`（M497），素材串 `qqmark` 不含 `'e'`；
   这正是 M502 给「AXPress 插卡语境」留的口径（82/83/85 三场景同形）。
3. **浮动钮的在场断言改 `waitFor`**：浮现走 M541 时机门（键盘选区静默 `GESTURE_SETTLE_MS`=350ms
   后才出钮），`keys` 返回时计时器通常还没到点。基线跑实测：`keys` 步的立即断言 FAIL（AX 快照
   101 个节点、整棵 web 内容缺失的退化读数），而同一次运行里紧接着的 `click` 步找到了那颗钮——
   是判据抢跑，不是产品缺钮。

## 已知边界

- 单测层的 DOM 是替身：`focus()` 是「把 `document.activeElement` 指到自己」的桩，**不能**证明
  WKWebView 的引擎行为；引擎层的判据只有场景 163b（真实鼠标单击 + 实际键入落点）。
- 真实鼠标点击插卡这条通道没有独立的真机读数（套件的 `click` 走 AXPress）。本次 163b 基线跑覆盖
  的是 AXPress 通道；「鼠标点击后焦点」的读数只在 Alex 的现场口述里，本 change 的落法对两条通道
  都成立（focus 是程序化调用，与触发通道无关），但**未单独判**。
