# Design: harness 对话表格的固有宽与局部横滚

## 0. 一句话

表格按内容固有宽布局，超宽部分只在自己的横滚容器里滚；容器结构是
`slot > .lumir-hp-table-scroll > table`，全屏钮留在横滚容器之外，全屏入口仍收 `<table>` 本身。

## 1. 现状与根因（M699 实测）

- 渲染：`src/harness-panel.ts:3151-3172` 的 `case "Table"` 产出 `<table class="lumir-hp-table">`，
  直接交给 `blockSlot(table, "table", …)`；slot 内只有表与钮。
- CSS：`.lumir-hp-table` 无 `width`；auto 表布局把表压到 `min(可用宽, max-content)`；
  `.lumir-hp-msg-assistant { word-break: break-word }` 被 cell 继承，min-content 被压到接近单字宽。
- 祖先不是成因：`.lumir-hp-transcript` 是 flex column + `overflow-y:auto`，只提供宽度上限；
  `.lumir-hp-msg-assistant` 是 `align-self:stretch; min-width:0`。
- 视觉门禁盲区：`tests/visual/scenes` 没有渲染宽表的 harness 场景，也没有表格像素基线。

## 2. 方案（结构 + 声明）

### 2.1 DOM

```
.lumir-hp-block-slot[data-hp-block="table"]   ← position: relative，全屏钮锚在这里
└── .lumir-hp-table-scroll                     ← 横滚容器（新增）
    └── table.lumir-hp-table                   ← 固有宽
```

- `blockSlot` 的签名不变；Table case 先建 wrapper、把 table 放进去，再把 wrapper 交给 `blockSlot`。
- `openers.table(table, …)` 继续收 **table 本身**：全屏模块深克隆的是传入节点，若传 wrapper，
  遮罩里会多一层空的横滚容器，m634「克隆源就是 table」的判据与既有 spec 条款一起失效。

### 2.2 CSS

```css
.lumir-hp-table-scroll {
  display: block;
  max-inline-size: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
}
.lumir-hp-table {
  border-collapse: collapse;
  width: max-content;
}
```

- `overflow-y: hidden` 与正文 `.cm-lp-table-scroll` 同口径：内容即表本体，高度恰好贴合；
  也避免 `overflow-x:auto` + `overflow-y:visible` 在 WKWebView 上的裁切疑点（M119）。
- 不为 wrapper 写 `scrollbar-gutter`（M177 / M663 的禁则）。
- **margin 链路**：`slot > .lumir-hp-table` 的直接子选择器在包 wrapper 后失效，必须把
  `.lumir-hp-block-slot > .lumir-hp-table-scroll` 与 `... > .lumir-hp-table-scroll > .lumir-hp-table`
  一起纳入归零组；纵向节奏仍由 slot 的 `margin: var(--sp-2) 0` + 首末贴边承担。
- **全屏重复声明收敛**：删掉 `.lumir-table-fs-snapshot .lumir-hp-table { width: max-content }`，
  由基类一处承担；全屏快照克隆 `<table>` 时仍命中同一条声明，行为逐值不变。

### 2.3 为什么两半缺一不可（反例数字）

M699 在 pane 480（body 463）实测：

| 变体 | 表宽 | wrapper 溢出 | transcript 溢出 |
|---|---|---|---|
| 只加 wrapper（无 max-content） | 463 | 0 | 0 |
| 只加 max-content（无 wrapper） | 524.08 | — | 53 |
| wrapper + max-content | 524.08 | 61 | 0 |

只加 wrapper 时表仍被压回、容器永不溢出（缺陷原样保留）；只加 max-content 时溢出抬高整列，
transcript 整列横向滚动（违背 C3）。两个数字都在视觉场景里以可区分的断言形式钉住：
宽表场景先断言 `wrapper.scrollWidth − wrapper.clientWidth > 20`，再断言
`transcript.scrollWidth === transcript.clientWidth`。

### 2.4 嵌套收缩

表格可出现在 blockquote 与 list item 内（`src/harness-panel.ts:3093-3121`）。wrapper 用
`max-inline-size: 100%` 随**包含块**收缩，MUST NOT 假设自己是 `.lumir-hp-body` 的直接子节点；
slot 的 `max-width: 100%` 同样按包含块解析。结构场景用 blockquote 内的宽表验证。

### 2.5 滚动条分档

新容器是横向单轴滚动（`overflow-y: hidden`），按注册表口径归**细条档**：

- 在 `src/style.css` 的共用选择器组（`scrollbar-width` / `::-webkit-scrollbar` / thumb / track
  四组）各加一个 `.lumir-hp-table-scroll`；
- 在 `tests/unit/scrollbar-registry.test.ts` 的 thin 条目登记，并更新「被扫出的滚动容器集合」
  与计数器文案；
- 右缘 12px 条款的适用截面：横向单轴容器的条只占**底带**，右上角 6px 的块级全屏钮不在条带上
  ——与正文 `.cm-lp-table-scroll` + `.cm-lp-table-slot` 的既有组合同构。该解释写进
  ui-design-system delta。

### 2.6 非目标

- 不加 sticky 表头、列宽拖拽、固定列上限（M119 同口径禁则）；
- 不做 JS 测量回写，纯声明式；
- 不改矩形化 / 降级逻辑；全屏遮罩行为逐值不变；
- 不改代码块的 slot 几何（仍是整行锚点）。

## 3. 测试设计

### 3.1 单测

`tests/unit/scrollbar-registry.test.ts`：

- thin 条目加 `.lumir-hp-table-scroll`（未登记即 `missing-tier` 判红；登记了源码没有即 `stale-entry`）；
- 「覆盖盘点出的全部滚动容器」集合加一项，轴向断言为 `["x"]`。

### 3.2 结构场景（chromium，`LUMIR_VISUAL_STRUCTURAL=1` 下也跑）

`tests/visual/scenes/m703-harness-table-scroll.spec.ts`：

| 用例 | 判据 |
|---|---|
| 窄 pane + 宽表 | wrapper 溢出 > 20；表宽 > 正文宽且等于 `wrapper.scrollWidth`；每个 th/td 的文本 Range **不同 line-top 数 = 1**（不是数 rect 个数：cell 里含裸 URL 的 `<a>` 时同一行会返回重叠 rect）；transcript 无横溢；slot 右缘 = wrapper 右缘（≤1px）、钮距 slot 右缘 6px；`scrollLeft` 可动 |
| 声明层 | wrapper `overflowX:auto` / `overflowY:hidden` / `scrollbarWidth:thin`；CSSOM `::-webkit-scrollbar` 4px；`scrollbar-gutter:auto` |
| 全屏源 | 点开全屏后 `.lumir-table-fs-snapshot` 的直接子节点是 `table.lumir-hp-table`，快照内无 `.lumir-hp-table-scroll` |
| 长 URL cell | 表宽 > 正文宽、wrapper 溢出 > 0、cell 不折行 |
| 宽 pane（1800 视口） | wrapper 无溢出（`scrollWidth === clientWidth`）、表仍按固有宽 |
| 窄表回归 | slot / wrapper / table 三者同宽（≤1px）、无溢出、钮距右缘 6px |
| 嵌套 blockquote | wrapper 宽 = blockquote 内容宽、表宽 > wrapper 宽、transcript 无横溢 |

### 3.3 像素

不新增整页基线（人肉裁决点）。窄表 / 代码块几何逐值不变，既有基线预计零更新；若实测有漂移，
先把截图交 Alex 过目，**禁止自行 `--update`**。

### 3.4 真机

`scripts/acceptance/scenarios/234-harness-table-horizontal-scroll.md`：

- mock 回复放一张 4 列宽表，断言首末列文本都在 AX 树里；
- `do: scroll` + `wheel: true` + `dx` 在表格区域投真实滚轮，滚动前后各一张 `shot`；
- **已知边界**：AX 不暴露表格几何与 scrollTop，「不折行 / 确实横滚」在真机层只能靠截图判，
  机验只覆盖「滚轮通道执行不报错」。场景注释如实写明，不声称 AX 能测几何。
