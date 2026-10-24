# Proposal: 光标可见性与 frontmatter 光标超高修复

- Change ID: `cursor-visibility-oct23`
- 日期: 2026-10-23
- 改裁: 2026-10-24（D2 由 A 改判 B：恢复 1.2s 闪烁；评审记录见下）
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-10-23 Alex 裁决：「D1–D3 全部按倾向」）。落地取值：
> D1 = **A**（点击 properties 盒 → 显露 YAML 源码、光标落在点击对应的源行；doc-title / 纯装饰
> padding 只聚焦、不进 YAML）、D2 = **A**（2px 实心竖线 + 取消闪烁，三主题同值）、
> D3 = **按 design §2 的 C1–C5 原文**落地（`docs/specs/editor-caret.md`）。
> **改裁（2026-10-24，实现后 dogfood 反馈 #6）**：D2 由 A 改判为 **B**——Alex 原话「光标
> 可见性调地有些过头了 —— 现在光标不闪了，也不容易一眼扫到。」保留 2px 宽度与 `--text`
> 颜色，**恢复约 1.2s 周期闪烁**（CM 原生 `steps(1) cm-blink`），三主题同口径（含 eink）。
> D1 / D3 不变；原始缺陷（光标高度取整块、光标太细）的修复不回退。
> 节点 2（归档评审）：待实现完成后填写。

## Why

Alex 2026-10-23 的需求原话（逐字）：

> 「1. 当点击 frontmatter 时，光标特别高（截图：frontmatter 区域光标是一条贯穿整个
> frontmatter 块高度的竖线，远超行高）
> 2. 光标太细，不容易快速一眼扫到」

两条分属两类问题：第 1 条是**渲染缺陷**（光标几何取错了量），按
[渲染缺陷合同先行规则](../../../docs/process/rendering-defect-contract-first.md) 处置；
第 2 条是**视觉决策**（光标粗细 / 闪烁 / 颜色的呈现档位），给候选取值 + 倾向交 Alex 裁决。
两者同批落地，因为它们都落在同一个「光标呈现」面上。

### 1. frontmatter 光标超高：根因已定位，不是 CSS 宽度问题

**一句话**：frontmatter 被一个**块级 replace 装饰**整体替换；光标落在该块的边界上时，
CM6 的光标层拿**整个块 widget 的包围盒**当光标高度，于是光标从 properties 盒顶端一直画到
doc-title 底端。加粗 / 调 CSS `line-height` 都改不了它——量错的是「哪一段 DOM 的几何」。

机制链（逐段可在本机源码核对）：

1. `src/preview/livePreview.ts:639-655` 把 frontmatter 的整个源范围 `[fm.from, fm.to]`
   替换为一个 `Decoration.replace({ block: true })`，widget 是 `FrontmatterWidget`；有文件
   路径时 doc-title 折叠在同一个 widget 的 outer 里（`src/preview/frontmatter.ts:145-156`）。
   因此这个「块」的高度 = properties 盒 + 20px 间距 + 标题 + meta。
2. CM6 画空光标时取 `view.coordsAtPos(head, assoc)` 的 `top` / `bottom` 作为光标矩形高度
   （`node_modules/@codemirror/view/dist/index.js:9292-9299` 的 `RectangleMarker.forRange`）。
   `coordsAtPos` 命中块级 widget 时走 `WidgetTile.coordsInWidget(offset, side, true)`
   （同文件 `:3249-3257`），block 分支直接返回 `this.dom.getBoundingClientRect()`
   （`:2122-2128`；只把 left / right 收成一条线，top / bottom 原样保留）——光标高度因此
   等于整个 widget 的高度。
3. 指针落在 widget 上时，CM 默认 `WidgetType.ignoreEvent()` 返回 true（`:161`），CM 不处理
   widget 内的事件（`:4874`、`:7239`），点击因此不走 CM 自己的落点逻辑。光标位置的两条现实
   路径都落在块边界——① 选区仍是装载时预置的 `fm.from`（见第 5 条）；② 浏览器把原生选区
   塌缩在这个 `contenteditable=false` 岛的边缘，CM 经 `selectionchange` 读回 `fm.from` /
   `fm.to`。具体走哪一支未在真机逐帧区分；两支的后果相同：边界位置被保留，光标层照常为它
   绘制整块矩形。非文本 block 的坐标→位置映射也只会给出这两个边界：`posAtCoords` 对非文本
   块按上 / 下半返回 `block.from` / `block.to`（`:3829-3830`）。
4. 键盘路径同样会撞上：`src/editor.ts:325-337` 的垂直移动对跨块级 widget 的落点做
   「钳制到行进方向近端边界」，钳制结果正是 `fm.to` / `fm.from`；在已聚焦的编辑器里按
   ↑ / ⌃P，光标落在块边界，仍按整块高度绘制。
5. 装载路径预置了同一个隐患：`loadedState` 与打开文件的装载事务都把选区复位到
   `anchor: 0`（`src/editor.ts:2304`、`:2585`）；有 frontmatter 时 0 就是 `fm.from`，之后
   任何一次「交还焦点」（`focusPreservingReadingPosition` 等路径）都会让这个边界光标显形。

**为什么公式 / mermaid 的点击路径没有同样的现场**：它们是同一类块级 replace，但指针入口把
选区 dispatch 到块内（`src/preview/math.ts:176-198` 的 `enterReplacedSource`，mermaid 复用
`src/preview/mermaid.ts:366`），严格重叠随即撤下装饰显示源码（`math.ts:308` / `:352`、
`mermaid.ts:421`），所以点击这条路径上光标落在可见源码行。frontmatter 缺的正是这条入口：
它的显露判据是「选区**覆盖整块**」（`livePreview.ts:648`）——只有覆盖整个块时才换一层
`--sel` 底色（`src/preview/theme.ts:185-188`），仍不显露；空光标在块内或边界时连底色都不变，
块一直渲染。**键盘边界路径**三类同病：clamp 停在块边界，公式 / mermaid 的空光标在边界上与
块不严格重叠，装饰同样不撤——本 change 的 C4 一并覆盖。

**合同现状**：living spec 已经写了「光标或选区触及的结构 SHALL 显露源码——…frontmatter
块」（`openspec/specs/editor-live-preview/spec.md:11`），但对应的 Scenario「光标触及即显露
源码」（`:40-43`）没有把 frontmatter 放进输入分布——实现与 requirement 的偏差因此没有被
场景钉住。本 change 按合同先行处置：先补「光标几何」这条缺的不变量条款（新增
`docs/specs/editor-caret.md`，条款原文见 design §2），再配不变量级属性测试，禁止只修
「点击 properties 盒」这一个案例。

### 2. 光标太细：现状与判断

- **粗细**：应用只覆盖了颜色（`src/editor.ts:1834-1836` 的 `borderLeftColor: var(--text)`）；
  粗细仍是 CM 基础主题的 `border-left: 1.2px solid black`
  （`node_modules/@codemirror/view/dist/index.js:6891-6895`），无自定义值。
- **闪烁**：CM 基础主题给 `.cm-cursorLayer` 挂 `steps(1) cm-blink 1.2s infinite`
  （同文件 `:6880-6887`），一半时间 opacity 0——「一眼扫到」的难度不只来自细，也来自
  **半程不可见**。
- **颜色**：`--text`（light `#21201a` / dark `#e3e2db` / eink `#000000`，见
  [design-tokens-v1](../../../docs/specs/design-tokens-v1.md) 的 `--text` 行，`:57`）在三主题
  都是最高对比档，不存在「看不清颜色」的问题。
- **eink 的约束**：eink 没有颜色，线宽是它唯一的强调手段（tokens 文档规则⑧，
  `design-tokens-v1.md:284-288`）；现有强调线宽是 1.2–1.6px，另有 2px 引用块竖线 /
  2.5px 队列条这类「粗 hairline」（`:193-196`）。光标加粗到 2px 落在既有语汇内，不需要
  新造颜色或新造宽度档；闪烁在 eink 上尤其不合适（残影 + 半程不可见）。

结论：加粗到 2px 并**取消闪烁**是同时解决「细」与「一半时间看不见」的最小组合；3px、
变色与呼吸块光标作为候选 / 否决项见 D2。

## What Changes

1. **新增《编辑器光标》质量合同**（`docs/specs/editor-caret.md`）：把「任意光标矩形 MUST 落在
   一条可见文本行上、高度等于该行行盒」写成不变量，并规定块级 replace 装饰的指针 / 键盘 /
   装载 / 聚焦四个入口都不得在渲染面上留下光标。条款原文见 design §2；这是 Alex 的合同
   评审面（D3）。
2. **frontmatter 显露口径对齐公式 / mermaid**：显露判据从「选区覆盖整块」改为「选区与块
   范围严格重叠」（复用 `src/preview/reveal-gate.ts:45-47` 的 `touchesSource`），判据选区
   仍取 M259 的按压快照；frontmatter 的 `selected` 底色态随口径统一退场（该态此后不可达，
   `src/preview/frontmatter.ts` / `src/preview/theme.ts` 的对应代码删除）。
3. **替换块的指针入口**：properties 盒按下即进入源码编辑（复用 `enterReplacedSource`，按
   点击位置落光标）；doc-title / 纯装饰 padding 是合成面、没有对应源码，按下只聚焦编辑器，
   不把光标放进 YAML。是否「整块任何位置都进 YAML」见 D1。
4. **装载 / 聚焦的初始光标规范化**：以 frontmatter 开头的 md 文档装载后，初始光标落在块
   之后第一条可见正文行（没有正文行时，聚焦后显露源码）；聚焦时若空光标停在已渲染的
   frontmatter 边界上，按同一规则规范化。
5. **键盘垂直移动的边界规范化**：`clampAcrossBlockWidgets` 钳制到块边界后，把落点推进块内
   最近的一条可见源码行并显露该块（frontmatter / 块级公式 / mermaid 三类同口径），避免
   「钳制到边界 = 整块高度光标」。这项对公式 / mermaid 也生效——它们此前同样会在该路径上
   留下边界光标（见 design §5）。
6. **光标视觉**：按 D2 落地（2026-10-24 改裁后为 2px + 约 1.2s 闪烁）；颜色保持 `--text`，
   宽度登记为组件常量（不新增颜色 / 字号 token）；eink 同宽、同样闪烁。
7. **spec 增量**：`editor-live-preview` 新增「光标可见位置与替换块指针入口」requirement；
   `ui-design-system` 新增「编辑器光标视觉」requirement。
8. **测试**：新增 `tests/visual/scenes/m647-caret-geometry.spec.ts` 的属性矩阵
   （frontmatter 形状 × 标题有无 × 正文有无 × 入口 × 主题 × 字号）；光标视觉的计算样式
   断言并入同一场景；新增真机验收场景 228（截图证据 + 文档不变；光标高度在真机 AX 不可
   断言，见 design §6）。

## 裁决点（每项给倾向；不回即按倾向落地）

### D1 frontmatter 的点击语义

- **A（倾向）**：**点击 properties 盒 → 显露 YAML 源码，光标落在点击对应的源行**。与公式 /
  mermaid 的「点渲染面即进源码」同一条交互语汇，兑现 living spec 已写的「触及即显露」；
  今天 Lumir 没有其它 frontmatter 编辑入口，A 顺手补上这条路径。代价：doc-title 折叠在
  同一个 widget 里，编辑 YAML 期间标题会一起让位（移开光标即恢复）；点击位置与显露后的行
  之间有一次布局位移，落点按 `enterReplacedSource` 的两步测量 + 钳制近似（手感归 dogfood）。
- **B**：**properties 盒只读**：点击只聚焦，光标放到正文首行；不显露 YAML。代价：要
  **MODIFIED** living spec 的 frontmatter 显露句（把它从「触及即显露」改为「只读属性区」），
  且 Lumir 内不再有 frontmatter 编辑路径；点击位置与光标落点不一致，容易读成「点了没反应」。
- 倾向理由：A 是仓内已有模型的直接复用，改动的是「缺的两条防线」，不是新增语义；B 要推翻
  一条 living spec，且把「点击 frontmatter」变成不落点的动作。若 Alex 更看重「阅读面不跳」
  而不是「可就地编辑」，选 B，delta 与 tasks 同步改。
- 子问题（A 内部已定，登记以免实现期再问）：doc-title / 纯装饰 padding 不是源码，按下只
  聚焦、不进入 YAML；「是否连标题一起进 YAML」不在本 change（标题保持合成面）。

### D2 光标视觉候选

| 候选 | 形态 | 可见性增益 | 代价 / eink |
|---|---|---|---|
| **A（2026-10-23 原裁决）** | 2px 实心竖线，`--text`，**取消闪烁** | 宽度 +67%，且不再有半程不可见 | 光标在聚焦期间常亮；`--text` 三主题已最高对比 |
| **B（2026-10-24 改裁，现行）** | 2px 实心竖线，保留 1.2s 闪烁 | 宽度增益 + 闪烁的运动信号（「一眼扫到」） | 半程仍不可见；eink 仍闪烁（残影），见 design §3.5 |
| C | 3px 实心竖线，保留闪烁 | 最粗 | 3px 超出 eink 既有 1.2–1.6 强调线宽与 2 / 2.5px 粗 hairline 语汇，且半程不可见 |
| 考虑过、不推荐 | accent 变色 | light / dark 有颜色增益 | eink 无色、退化为 1.2px；accent 与链接同色，语义撞车 |
| 考虑过、不推荐 | 呼吸块光标（约 0.5em 半透明块 + opacity 呼吸） | 块面最显眼 | 与选区带混淆；eink 上是灰带 + 动画残影；CJK 字格宽度不一；实现要改光标层几何 |

原倾向 A：它同时命中「细」与「半程不可见」两个成因，且是三主题唯一同构的解（eink 没有颜色，
只能靠宽度与常亮）。**2026-10-24 改裁为 B**：Alex 反馈 #6「光标可见性调地有些过头了 —— 现在
光标不闪了，也不容易一眼扫到。」——实测证明「取消闪烁」把可发现性的另一半（闪烁的运动信号）
一起拿掉了；恢复闪烁，宽度 / 颜色 / 居中的增益全部保留。3px 与 C 的其他代价不变，仍不采纳。

### D3 合同条款原文过目

按 [渲染缺陷合同先行规则](../../../docs/process/rendering-defect-contract-first.md) 的
「Alex 介入点」，新增 / 修订的不变量条款本身要过目。条款原文在 design §2 的 C1–C5
（光标高度 = 可见行行盒；替换块四个入口不留光标；显露不改文档；键盘不把光标留在块边界）。
倾向：按原文落地；需要改措辞直接批注。

## Non-goals

- 不做 frontmatter 的**行内属性编辑**（点值改值、tags / status chip 的编辑 UI）——那不是本
  缺陷的修复面，是另一个能力。
- 不改 properties 盒 / doc-title 的视觉（底色、圆角、字号、间距、key 列宽）。
- 不改公式 / mermaid 的点击与显露语义；本 change 只让它们共享「键盘边界推进源码行」的同一
  条规范化（D1 外的派生改动，见 design §5）。
- 不改 code 模式的任何光标行为（除共享的宽度 / 闪烁视觉）。
- 不改 reveal 的既有口径（强调范围含端点、链接严格重叠、callout 行严格重叠）。
- 不引入新的 keybinding、不引入新的配置字段。
- 不把 doc-title 从 frontmatter widget 拆出来（M222 的两岛拓扑约束不变；编辑 YAML 期间
  标题让位是 A 的已知代价）。
- 不改文档源码（ADR 0003 §3）。

## Impact

- **影响的 specs**：`editor-live-preview`（ADDED「光标可见位置与替换块指针入口」）、
  `ui-design-system`（ADDED「编辑器光标视觉」）。
- **新增文档**：`docs/specs/editor-caret.md`（质量合同，条款见 design §2）；
  [design-tokens-v1](../../../docs/specs/design-tokens-v1.md) 的「阴影与 hairline」节登记光标宽度
  2px 与 1.2s 闪烁口径（2026-10-24 改裁后由「常亮」改准）。
- **代码**：`src/preview/livePreview.ts`（显露判据）、`src/preview/frontmatter.ts`（widget
  指针入口 / `selected` 退场）、`src/preview/theme.ts`（selected 样式删除）、
  `src/preview/math.ts` / `src/preview/mermaid.ts`（`enterReplacedSource` 迁到共享模块的
  import 调整、reveal 注释改准）、`src/editor.ts`（初始选区 + 聚焦规范化 + 垂直移动边界
  推进 + 光标视觉）、`src/style.css`（如需组件常量注释）。
- **测试**：`tests/unit/doc-title-placement.test.ts`（FrontmatterWidget 构造参数变更）、
  新增 `tests/visual/scenes/m647-caret-geometry.spec.ts`、新增
  `scripts/acceptance/scenarios/228-caret-visibility.md`。
- **视觉基线**：光标宽度 / 闪烁若出现在既有整页基线里，需按
  [tests/visual/README.md](../../../tests/visual/README.md) 的纪律重新截图并由 Alex 过目
  （基线更新是人肉裁决点）。
- **关联约束**：ADR 0003 §3（不改写源文件）；ADR 0002 §6（打开 1MB <100ms；本 change 不
  新增全量装饰构建，显露判据仍只看选区）；[rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)
  （合同先行 + 属性测试）；M259 按压快照（frontmatter 显露判据继续走 `revealSelection`）；
  M222 单岛拓扑（不拆 doc-title）。
