# harness-selector-merge — 设计笔记（M371）

原型入口：`design/prototypes/harness-selector-merge/index.html`（无参数 = 场景总览 board；`?scene=chip|pop|long|unsupported|mock` 单帧；`theme=light|dark|eink`；截图用 `&panel=0` 关控制面板）。

## 需求源（Alex 原话）

> 「模型选择和 thinking level 选择合并到一起，并提供三个信息/选项：provider、model、thinking level/effort，另外我不需要 mock 模型，界面上显示它有些奇怪，有什么处理方案？」

mock 处理裁决（逐字）：**「界面上隐藏，代码保留」**。

## 布局 / 交互决策

1. **合并 chip = 一格三读数**：`provider · model · effort`，分隔符 U+00B7 小圆点（modeline 同款，与 M370 ctx 双读数分隔符同裁决）。三个值都是数据读数（同 provider 名 / Low·High·Max 档位名的「读数不译文」口径），不带「模型：」「思考：」前缀——双 chip 时代的「思考：」前缀随合并退场。
2. **chip 形态纪律零改动**：沿用现行单 chip 配方（无边框小标签、24px 高、r5、11.5px、text-2、hover 给底、chevron ▾，见 `src/harness-panel.css` 的 `.lumir-hp-model` / `.lumir-hp-eff`）。唯一放宽：`max-width` 96px → 224px。空间账：双 chip 时两格各 96px + 4px gap ≈ 196px，合并后一格 224px 更宽但只此一格，ctl 行总占用反而略降。
3. **浮层 = 三维度分段单浮层**：Provider / 模型 / 思考程度 三段，hairline 分隔，段标签 fs-micro。项 = menuitemradio + 14px check 格 + 当前项 accent-tint 底（think pop 配方，替代 model pop 的「当前」文字标——三维度统一一种「当前」表达）。
4. **三维各自独立**：切 provider 不抹 effort；每个 provider 记住自己上次选的 model（数据上对应「选择写回配置」，切回时恢复）。当前 model 不在新 provider 列表时回落该 provider 首项。
5. **选完不自动关浮层**：与现行两个单维度浮层（选定即关）不同——合并浮层承载多维调整，用户可能一次要改两项；点 chip / 空白处 / Esc 关。
6. **mock 隐藏口径**：数据里保留 mock provider/模型条目，构建可选列表时按 `mock: true` 过滤；原型控制面板有「mock 显形」调试钮（产品无此开关），供核对隐藏前后的列表差异。
7. **effort 不支持（D390 态）的处置改了**：双 chip 时代是 thinkChip 整 chip 置灰禁用；合并后选择器 chip 本身仍要可点开（否则没法换到支持的组合），置灰只落在 effort 读数这一格（text-3），浮层内 effort 段整段禁用 + 保留原说明句「当前模型不支持思考程度调节」。**这是交互语义差异，列为裁决点 3。**

## 与现状的差异点（对照 `src/harness-panel.ts`）

| 现状（双 chip） | 原型（合并选择器） |
|---|---|
| `modelChip`（1259-1276 行）只显示 provider 名，浮层只列 provider | chip 显示 provider · model · effort 三读数，浮层三维分段 |
| `thinkChip`（1285-1303 行）显示「思考：{level}」，独立第二 chip | 不再有第二 chip；effort 并入选择器 |
| 两个 wrapper（`.lumir-hp-modelwrap` / `.lumir-hp-effwrap`） | 一个 wrapper（`.hp-selwrap`） |
| 两个浮层各自 `hidden` 管理、互斥逻辑散在两处 | 单浮层单开合状态 |
| model 维度不存在——现行 `providerSelection()`（581-588 行）只取 provider ID，model 是 provider 配置内部的隐式值 | model 成为显式可选维度（**需要配置 schema 暴露 provider 下的 model 列表**，见遗留问题） |
| mock 条目会出现在 provider 浮层 | UI 层过滤隐藏（数据保留） |
| effort 不支持 = 整 chip disabled | 仅 effort 读数/分段置灰，选择器可开 |

## 留给 Alex 的裁决点

1. **长读数截断策略**：chip max-width 224px 整串 ellipsis 时，超长 model 名会把 provider / effort 一并截掉（scene=long 可见）。备选：model 名单独 min-width:0 截断，保住头尾两格。原型先给最简方案。
2. **浮层选定后是否自动关**：原型选「不关」（多维一次调齐）；若你更习惯现行「选定即关」，实现时改一行。
3. **effort 不支持时的 chip 呈现**：原型 = 读数置灰（High 变灰但可见）+ 浮层段禁用；备选：effort 格显示「—」占位。双 chip 时代的「整 chip 禁用」在合并形态下不可行（点不开的换组合入口没了），此项只需在两种新呈现里挑。
4. **provider / model 的展示名**：原型用纯读数串（`Nova · Atlas 2 · High`）；若想让 provider 更弱一档（text-3）形成层次，可以，但未做——modeline 风格是同色。
5. **model 维度下配置 schema**：现配置只暴露 provider 选择（`providerSelection`），合并选择器需要 `[harness].providers.<id>` 下暴露可选 model 列表与当前 model 值。这是实现侧的前置工作，不是视觉裁决，但你可能想先知道它意味着配置结构动一刀。

## 合成数据说明

全部 provider / model 名为虚构（Nova / Pulse / Orbit / Atlas 2 / Pulse S1 / Orbit Mini…），effort 档位 Low/High/Max 沿用产品档位名（专有名词口径）。无任何真实 vault 内容、真实配置值或真实 provider 名。
