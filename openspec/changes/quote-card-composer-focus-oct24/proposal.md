# Proposal: 引用卡片插入后的焦点移交（composer 输入区）

- Change ID: `quote-card-composer-focus-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：Alex 2026-10-24 批准立项（口径：「quote 卡片进 composer 后，焦点没有搬进
> 输入区——你 quote 完想直接打字，字会落进编辑器而不是 composer。建议立项小改：引用卡片插入后
> 自动聚焦 composer 输入区（顺带修好 163b 场景）」）。本 proposal 无待裁裁决点。
> 节点 2（归档评审）：**通过**（2026-10-24 Alex 原话：「第一组和第二组都可以归档了。」）。

## Why

三条引用入口都把卡片插进 composer 的混排输入区：文本摘录（编辑器选区 → 浮动钮 →
`insertQuoteCard`）、消息摘录（transcript 选区 → 浮动钮 → `insertMessageQuoteCard`）、图片引用
（图片悬停钮 / 跨图选区 → `insertQuoteWithImages`）。用户在真机上的用法是「quote 完直接接着打
问题」，而这三条路径此前**没有任何一条**把「插入之后键盘落点在哪」写成可判的合同：

1. 三条入口各自在末尾写一句 `composer.focus()`，但「先写 caret 再 focus」的顺序没有依据、也没有
   复核：面板本来就是开着的现场，`withModel` 整面重渲时焦点还在编辑器里，重渲写下的 DOM 选区
   要等 focus 之后才可能被引擎重判——「插入后光标在卡片下一行的问题段落」这条既有条款因此只是
   有概率成立。
2. 面板原本关着时，焦点靠装配层 `openHarnessPane()` 顺手聚焦一次（`harnessPanel.focusComposer()`）
   才成立；入口自己写的 focus 是第二条路径，两条路径谁生效取决于时序，没有一处复核
   `document.activeElement`。
3. **判据缺位的代价**：场景 163b（quote 首条消息 → 命名事件）此前用一步 `clickInNode` 先点
   composer 再注入素材——那一步把「产品有没有搬焦点」整个绕过去，是**假绿**形态（产品没搬，
   场景照样绿）。REVIEW.md「覆盖声明超出真实验证」条要修的正是这种现场。
4. 真机读数（本次 mission 的 163b 基线跑，证据
   `.local/acceptance/2026-10-24/163b-harness-quote-first-title/`）：删掉 `clickInNode` 之后，
   「直接键入 → 字落在 composer（`qqmark`）」「编辑器正文 68 字节逐字节未变」两条断言**同时
   PASS**——**AXPress 插卡这条通道上焦点本来就落对了**。也就是说本条要修的不是「焦点一直没搬」，
   而是「这条合同没有单一实现、没有被判据钉住、且场景用假前置把它盖住了」；真实鼠标点击通道
   没有独立的真机读数，本 change 因此把移交写成显式的、focus 后复核的一处实现，并把判据落在
   单测（DOM 焦点）+ 场景（落点）两层。

影响面：三条引用入口是 quote 能力的全部入口；这条合同错了，用户每次 quote 都要多点一次输入区，
而机器判据看不出来。

## What Changes

1. **一处焦点移交实现**（`src/harness-panel.ts` 的 `focusComposerAfterInsert`）：三条引用入口共用。
   顺序是合同的一部分——**面板在场才移**（面板不在场时只返回，不把焦点丢给别的元素）→
   **先 focus** → **再写 caret**（`withModel` 现在返回重渲后落地的模型光标，引用入口据此在 focus
   之后重放一次，保证「光标落卡片下一行的问题段落」在焦点移交后仍成立）。focus 之后复核
   `document.activeElement`，没到位**同帧补一次**（只补一帧，不排持续重试——持续重试会跟用户的
   下一次点击抢焦点）。
2. **单测钉住三条入口 × 两态**（`tests/unit/harness-quote-focus.test.ts`）：面板原本关着 /
   原本开着，各断言一次「插入后 `document.activeElement` 是 composer」，另加一条「无卡片可插
   （引用全失败）时不偷焦点」。反向验证：删掉 `focusComposerAfterInsert` 的调用后 6/7 条必红。
   判据用 **DOM 焦点**而不是 AX 的 `focused` 标记——编辑器正文与 composer 在 AX 里同为
   `AXTextArea`，标记分不出两侧（M500/M502 实证）。
3. **场景 163b 改用产品行为做前置**：删掉 `clickInNode` 那一步，卡片插入后**直接键入**，
   判据 = 「composer 里有注入串」+「编辑器逐字节未变（`recordEditor` + `editor.unchangedSince`）」；
   同时把前台前置从 `focusWindow click: true`（标题栏拖拽区，会让 webview 失焦，M670 定因）换成
   `clickEditor real: true`；浮动钮的在场断言从「`keys` 步的立即断言」改成 `waitFor`——浮现走
   M541 时机门（键盘选区静默 350ms 后才出钮），立即断言读到的是「还没浮现」，是一条随机器负载
   漂的假红（本次基线跑实测：同一轮里紧接着的 click 步能找到那颗钮）。
4. **规格补一条不变量**（`harness` MODIFIED「混排对话输入区」）：三类卡片插入后 SHALL 把 DOM
   焦点交给输入区，用户插入后直接键入的字 SHALL 落进输入区的问题段落、MUST NOT 落进编辑器正文。

## Non-goals

- **不动装配层的 `openHarnessPane()`**：它那条 `focusComposer()` 是「⌘⇧A 开面板就聚焦」的产品
  行为，与「插入后移交」是两条不同意图的入口；本 change 只让插入路径自己负责自己的焦点，不删
  装配层那一次（它是面板打开时的正常落点）。
- **不动图片粘贴路径**（`pasteClipboardImage`）与「发送后焦点复位」：粘贴与发送各有自己的语义，
  不在 Alex 报的这条链路上；改动面越小越好。
- **不把 AX 的 `focused` 标记做成判据**：已在 M500/M502 实证分不出编辑器与 composer，本 change
  不重新发明这条通道。
- **不修 163b 的其它判据**（命名事件 / 浮层改名 / 标题栏同步）：它们本次基线跑已全绿，本 change
  只动前置与键入两步。

## Impact

- 影响的 specs：`harness`（MODIFIED「混排对话输入区」+ 一条新 Scenario）。
- 影响的文件：`src/harness-panel.ts`（`withModel` 返回值、`focusComposerAfterInsert`、三条入口）、
  `tests/unit/harness-quote-focus.test.ts`（新增）、
  `scripts/acceptance/scenarios/163b-harness-quote-first-title.md`、本 change 目录。
- 关联约束：REVIEW.md「假绿：断言看着有覆盖，实际不判任何东西」族（假前置）、
  change `add-harness-quote-cards` design §5（插入后光标落卡片下一行）、M670 的 finding
  `20261024-worker-image-hover-quote-oct24-bug-focuswindow-click-true-wkwebview.md`（标题栏单击
  会打死 webview 焦点）。
