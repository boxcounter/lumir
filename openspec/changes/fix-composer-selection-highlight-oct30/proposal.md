# Proposal: composer 全选必须逐块可见

- Change ID: `fix-composer-selection-highlight-oct30`
- 日期: 2026-10-30
- 角色: Alex Lee（评审 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-10-30）。Alex 原话：「推荐修复方向：composer 自绘选区高亮，
> 不再完全依赖引擎原生 ::selection；同时补『选区必须可见』的合同和 WebKit 像素测试。」随后原话：
> 「好，请你安排」。本实现严格保留调查报告已证实正确的 DOM 端点、块模型与删除语义。
> 节点 2（归档放行）：实现完成后按五要件填写。

## Why

composer 混排内容在 WebKit 中存在「选区正确、删除正确、画面没有选中态」的缺陷。首个顶层块是
`contenteditable=false` 卡片时，`selectNodeContents(composer)` 的模型端点仍是首块前缘到末尾之后，
Backspace 也能删除全部块，但引擎不绘制选区。调查报告的同一前端读数为：WebKit 的 ⌘A 前后像素差
0 px，Chromium 为 6210 px。

既有 HC6 与 m627 只检查 DOM 端点、块覆盖与后续编辑，未约束选区必须可见，且只在 Chromium 运行。
因此它们不能发现这个引擎相关的呈现缺陷。

调查报告与原始读数：`.local/reports/composer-select-all-highlight-oct30/README.md`。

## What Changes

1. **补 HC6 可见性不变量**：任意段落、引用卡片、消息摘录卡片、图片卡片序列全选后，每个被选块
   都必须有可见高亮；高亮不得越出 composer；折叠、失焦或选区变化后不得残留。
2. **模型驱动的自绘呈现层**：DOM Selection 继续是编辑真源。根据 `caretFromDom()` 的模型选区，
   给完整命中的卡片与段落施加块级高亮；局部文本仍由原生选区绘制。`selectionchange`、结构编辑与
   折叠共用同一同步入口，不新增第二套选区模型。
3. **先红后绿的引擎像素判据**：新增 real-UA WebKit 场景，覆盖卡片首位 / 中间 / 末位、多卡片交错、
   纯文本与段落软断行。逐块断言 ⌘A 前后像素差与该块矩形相交、composer 外无差异、折叠后无残留；
   同时保留 DOM 端点与 Backspace 整删断言。未修实现上，卡片首位用例必须 WebKit FAIL、Chromium PASS。
4. **真机验收**：新增场景 259，用隔离配置和合成 vault，经 `[keys]` 把同一 `editor.select-all`
   命令重绑到可注入键，验证真实 WKWebView 的高亮、整删与折叠清除，保存前后截图。

## Non-goals

- 不使用 `execCommand("selectAll")`，不增加恒定可编辑首块，不改文本端点选区。
- 不改 HC6 的 DOM 端点、块模型、序列化、撤销或删除语义。
- 不对内容文本施加 `user-select: none`，不替换原生键盘、IME、辅助技术或 Selection 集成。
- 不用 DOM wrapper 或 accessibility tree 中的伪内容实现高亮，不更新既有视觉基线。
- 不宣称验证物理 ⌘A 的真机注入；该通道边界与场景 215 相同。

## Impact

- 规格：`harness` 的「composer 的全选（⌘A，M627）」整块 MODIFIED；活跃期不改 living spec。
- 代码：`src/harness-panel.ts` 的呈现同步与纯模型判据；`src/style.css` 的块级高亮样式。
- 测试：WebKit / Chromium 像素属性场景、模型与几何属性单测、真机场景 259 与 COVERAGE。
- 证据：`.local/reviews/composer-selection-highlight-oct30/`。
