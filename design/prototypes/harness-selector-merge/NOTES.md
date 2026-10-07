# harness-selector-merge — 设计笔记（M371 原型 → M373 裁决定稿）

原型入口：`design/prototypes/harness-selector-merge/index.html`（无参数 = 场景总览 board；`?scene=chip|pop|long|unsupported|mock` 单帧；`theme=light|dark|eink`；截图用 `&panel=0` 关控制面板）。

**本目录是 M373 的实现设计基准**：Alex 已对 M371 原型的全部裁决点逐项裁决（2026-10-07，
逐字见下），原型与本文档已按裁决修订为最终形态——M371 的「原型先给最简方案」等过渡态
（chip 三读数 / 整串截断 / 无 hover hint）已被取代，实现 MUST 以本节为准。

## 需求源（Alex 原话）

> 「模型选择和 thinking level 选择合并到一起，并提供三个信息/选项：provider、model、thinking level/effort，另外我不需要 mock 模型，界面上显示它有些奇怪，有什么处理方案？」

mock 处理裁决（逐字）：**「界面上隐藏，代码保留」**。

## Alex 裁决（2026-10-07 逐字）与落点

| 裁决（逐字） | 落点 |
|---|---|
| 「不需要显示 provider，只需要 model · effort。」 | chip 读数 = `model · effort` 双读数（U+00B7），provider 不进 chip、只在浮层第一段选 |
| 「只截 model 名，保住 effort。」 | model 名单独 `min-width:0 + ellipsis` 承担全部截断；分隔符 / effort / chevron 三格 `flex:none`（scene=long 可见：effort 不被长名挤掉） |
| 「采纳原型的做法（选定后不自动关浮层）。」 | 浮层内选定任一维都不关；点 chip / 空白 / Esc 关 |
| 「采纳（effort 读数置灰 + 浮层段禁用），同时应该有一个 hover hint 告知不支持 effort。」 | 不支持时：chip 读数 text-3 置灰 + 浮层 effort 段 `is-disabled`（项不可点 + D390 段尾说明）+ **置灰格 hover 浮出 hint（D394，点名模型）**——本目录原型含此 hint 的演示 |
| 「同意（配置 schema 动刀）。」 | `[harness].providers.<id>` 暴露 `models` 清单（逐项 `{id, effort, window}`）+ 同级 `model` 当前值；内置 preset 给默认值，用户声明整体覆盖；单 model 旧配置形态零迁移 |
| 「无异议（能力/窗口表去硬编码、进配置 schema，并入本 mission；M372 词元判定为过渡先落地）。」 | `thinking.rs` 的 `is_kimi_k3` 词元判定与 `llm.rs` 的 `KIMI_PRESET` 窗口表退役为 schema 读取（`HarnessConfig::effort_supported` / `context_window`），配置未声明的模型回落保守默认（effort=false / window=131_072） |
| 「ctx%•cache% 增加 hover hint 说明含义。」 | ctx 读数 hover 泡常驻含义句（D395），越线时警示句（D335）追加其下——原型 ctxWrap 悬停可见 |
| 「这次的基线刷新不用我过目，你自动处理。」 | M373 worker 自动刷新漂移基线并逐张列清单 |

## 定稿形态（M373 = 本目录现状）

1. **合并 chip = 一格双读数**：`model · effort`，U+00B7 小圆点（modeline 同款）。形态纪律零改动沿用现行单 chip 配方（无边框小标签、24px 高、r5、11.5px、text-2、hover 给底、chevron ▾）；唯一放宽：`max-width` 96px → 224px。chip 永不禁用。
2. **浮层 = 三维度分段单浮层**：Provider / 模型 / 思考程度 三段，hairline 分隔，段标签 fs-micro（D396 / D397 / D392）。项 = menuitemradio + 14px check 格 + 当前项 accent-tint 底。三维各自独立：切 provider 不抹 effort；每 provider 记住自己的 model（选择写回 `providers.<id>.model`）。
3. **mock 隐藏口径**：数据里保留 mock provider/模型条目，构建可选列表时过滤（provider id = mock）；控制面板有「mock 显形」调试钮（产品无此开关）。
4. **effort 不支持（D390 态）**：读数置灰（text-3）+ 浮层 effort 段禁用 + 置灰格 hover hint（D394，「模型 {model} 不支持思考程度调节」）。**这是 M371 原型没有的第三条出口**（原型只有前两条）。
5. **两个 hover hint**（M373 裁决新增）：① effort 置灰格 hover → D394；② ctx% · cache% 读数 hover → D395 含义句（越线追加 D335 警示句）。

## M371 过渡态 → M373 定稿的差异（实现勿回到过渡态）

| M371 原型（过渡） | M373 定稿（本目录现状 = 实现基准） |
|---|---|
| chip 三读数 `provider · model · effort` | chip 双读数 `model · effort`（无 provider） |
| 整串一个 `.hp-sel-read` 截断（长名把 effort 一并截掉） | 只截 model 名：`.hp-sel-model` 单独 min-width:0，sep/effort flex:none |
| 无 hover hint（effort 不支持只有置灰 + 段禁用） | 置灰格 hover hint（D394）+ ctx 读数 hover hint（D395） |

其余与 M371 一致：单浮层三维分段、选定不自动关、think pop 配方的「当前」表达（check + tint，「当前」文字标 D98 的 harness 消费点退役）、mock 界面隐藏、合成数据（虚构 provider / model 名，无真实 vault 内容）。
