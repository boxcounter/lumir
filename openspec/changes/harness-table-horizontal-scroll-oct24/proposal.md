# Proposal: harness 对话表格的固有宽与局部横滚

- Change ID: `harness-table-horizontal-scroll-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已通过**（2026-10-24）。Alex 查看本 proposal 与两张真机截图后回复原文：
> 「提案和截图都认可。」D1–D4 未逐条反对，按本文倾向落地。
> 来源是 Alex 的 dogfood 截图 `kimi-code-composer://attachments/m3`：harness 面板里的 Markdown 表格被
> 挤压得很窄、单元格折行，Alex 要求「参考正文横向铺开、左右滑动」。只读 survey
> `.local/reviews/harness-table-overflow-audit-oct24.md`（M699）用合成 DOM + 真实 CSS 逐值实测了根因与
> 修法组合。节点 2（归档评审）：实现完成后填写。

## Why

### 现场

harness transcript 里的 Markdown 表格没有任何横滚容器，`<table>` 走浏览器 auto 表布局：

- `.lumir-hp-table` 没有 `width` / `min-width` 声明（`src/harness-panel.css:531` 一带只有边框与内边距），
  `width: auto` 解析为 `min(可用宽, max-content)`；
- 助手消息的 `word-break: break-word`（`src/harness-panel.css:457-461`）被单元格继承，把 min-content
  压到接近单字宽，auto 表布局因此能把每列压到任意窄。

结果是表被压回正文栏宽、单元格折成多行——不是「祖先挤压」，表自身没有固有宽声明才是根因。

M699 探针实测（chromium，真实 `style.css` + `harness-panel.css`，pane 480 / body 463）：

| 变体 | 表宽 | wrapper 溢出 | transcript 溢出 | 最大 cell 行数 |
|---|---|---|---|---|
| 现状（无 wrapper、无 max-content） | 463 | — | 0 | 2 |
| 只加 wrapper | 463 | 0 | 0 | 2 |
| 只加 max-content（无 wrapper） | 524.08 | — | **53** | 1 |
| wrapper + max-content | 524.08 | **61** | 0 | 1 |

两张反例表把「两半缺一不可」钉死：只加横滚容器时表仍被压回、容器永不溢出；只加固有宽时溢出抬高
整个正文列，transcript 整列横向滚动——正是本次要避免的形态。

### 为什么现在修

- 视觉门禁对这类缺陷结构性不可见：`tests/visual/scenes` 里唯一渲染 harness 表格的 m634 / m460 都用
  窄表，没有任何表格像素基线；组件行为也无结构断言。
- 正文侧的宽度合同（`docs/specs/table-reading.md` §3：表框 = 内容自然宽 / 可见宽 = min(自然宽, 栏宽) /
  超宽由局部横滚承载）已运行多轮，harness 只是没接上同一条合同。

## What Changes

对应 spec delta：新增 harness 条款「对话表格的固有宽与局部横滚」；修改「面板块级全屏钮的锚点」的宽表
场景；修改 ui-design-system「滚动条分档与滚动容器注册表」的细条档消费者枚举。

1. **固有宽**：`.lumir-hp-table` SHALL `width: max-content`，单元格不因栏宽不足折行；窄表贴合内容。
2. **局部横滚**：新增 `.lumir-hp-table-scroll` 包裹 `<table>`，块级、`max-inline-size:100%`、
   `overflow-x:auto`、`overflow-y:hidden`、`overscroll-behavior-inline:contain`。
3. **不撑宽正文列**：transcript / 消息列 MUST NOT 横向溢出（`scrollWidth === clientWidth`）。
4. **结构**：`slot > wrapper > table`——定位容器（全屏钮）在横滚容器之外；`openers.table()` 仍收
   `<table>` 本身，全屏快照不出现 wrapper 层。
5. **嵌套收缩**：wrapper 以 `max-inline-size:100%` 随 blockquote / list item 的包含块收缩。
6. **滚动条**：新容器归细条档，加入 `src/style.css` 的共用选择器组并登记
   `tests/unit/scrollbar-registry.test.ts`；MUST NOT 声明 `scrollbar-gutter`。
7. **全屏重复声明收敛**：`.lumir-table-fs-snapshot .lumir-hp-table { width: max-content }` 与新的
   固有宽声明同语义，收敛到 `.lumir-hp-table` 一处。
8. **非目标**：不加 sticky 表头 / 列宽拖拽 / 固定列上限；不做 JS 测量回写；全屏遮罩行为逐值不变。

## Impact

- 代码：`src/harness-panel.ts`（Table case 包 wrapper）、`src/harness-panel.css`（wrapper / 固有宽 /
  margin 链路）、`src/style.css`（细条共用组加一个选择器）。
- 规格：`openspec/changes/harness-table-horizontal-scroll-oct24/specs/harness/spec.md` 与
  `specs/ui-design-system/spec.md`（delta）。**活跃期不改 living spec**。
- 测试：`tests/unit/scrollbar-registry.test.ts`、`tests/visual/scenes/m703-harness-table-scroll.spec.ts`、
  `scripts/acceptance/scenarios/234-harness-table-horizontal-scroll.md`。
- **像素基线**：现有基线（m303 / m347 / m351 / m440 / m634 / m460）均不含 harness 表格；窄表与
  代码块几何逐值不变，预计零更新。本批**不新增整页基线**（基线是人肉裁决点）。
- 真机：WKWebView 下 `width:max-content` + `border-collapse: collapse` 的最终形态需截图确认；
  AX 不暴露几何与 scrollTop，「不再折行 / 确实横滚」只能靠截图证据，场景注释如实写明。

## 裁决点（未回按倾向落地）

- **D1 wrapper 类名**：`.lumir-hp-table-scroll`（不复用 `.cm-lp-*`）。倾向：采纳——复用会把编辑器
  命令面的 `BLOCK_SCROLL_CLASS` 判据引到面板，且两处实现不同构。
- **D2 键盘可达性**：本批不给 wrapper 加 `role="region"` + `tabindex="0"`（正文是这口径，但 harness
  代码块今天也不可键盘横滚；只给表格加会造成新的不一致）。倾向：整批登记后另裁；finding 已 file。
- **D3 像素基线**：本批不新增。倾向：采纳——整页基线是人肉裁决点，先以结构断言 + 真机截图交付。
- **D4 极宽表**：一格几百字散文时允许很长的横滚，与正文一致，不新增第二套宽度策略（M119 禁则）。
  倾向：采纳。
