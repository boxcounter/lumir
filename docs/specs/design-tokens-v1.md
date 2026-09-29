# Lumir Design Tokens v1

> 状态：提取自 direction-c 定稿原型（2026-09-24 Alex 裁决「挺喜欢，无必须改项」，裁决记录见
> [design-brief-v1.md](design-brief-v1.md) §裁决记录）。本文档是**已做决策的登记**，
> 不是新设计：每个值都能在 `design/prototypes/direction-c/index.html` 里指出来源行。
> 用途：后续 UI 重设计 OpenSpec change 与实现的直接输入。
>
> 提取范围：屏 1（主界面）+ 屏 4（内容类型）× 三主题 × 无衬线表皮。
> 屏 2/3（agent 在场/裁决）与 composer=bottom 变体随 agent 特性推迟（brief 裁决记录），
> 但它们的色值已在原型里定稿，相关 token 照常收录并标注「随 agent 特性启用」，
> 避免二次提取。

## 收敛规则（魔术数 → token 的映射纪律）

原型的 CSS 里大量值是直接写在组件上的魔术数。收敛成 token 时遵循以下规则，
每条规则同时是「实现时不许再扩散」的约束：

1. **色彩零新增**：三主题全部颜色已在 `:root` 块里是 token（29 个），组件里只剩
   eink 的手工反白（`#000`/`#fff`/`#d8d8d8`/`#6e6e6e`），它们语义上属于既有 token
   的 eink 值，收敛时归位，不新增色。
2. **字号阶梯 = 双锚点**：正文锚 15px、UI 锚 13px。标题从锚点向上做递减级差
   （24→21→18→16→15→14→13，级差 3/3/2/1/1/1——heading-hierarchy-ramp 稿 A 修订，
   2026-09-26；旧级差 24→19→16.5→15 退场），UI 从锚点向下以 0.5px 步进压缩层级
   （13→12.5→12→11.5→11→10.5→10）。0.5px 步进是 macOS 系统 UI 的通行做法
   （SF 在 0.5 档渲染清晰），阶梯里 14 档全部有原型出处或裁决出处，没有为凑整而改值。
3. **间距 = 2px 基网**：≤16px 每 2px 一档，>16px 按 4/8px 跳档，共 14 档。
   落不进基网的奇数值（5/7/9/11/13）只出现在两类场景并已点名：（a）行内补偿
   （chip padding 2.5px、wl padding 1px 5px，对齐 CJK 行腹）；（b）已调优的组件
   内边距（q-item `7px 14px 8px 16px`、msg `11px 16px`）。这些值保留为组件常量，
   收敛规则是「不再扩散」，不强行归整以免改动定稿观感。
4. **缩进公式化**：文件树层级缩进 = `8px + 14px × 层深`（原型里 8/22/36/50 四个
   魔术数收敛为一条规则）；有序列表三级悬挂 26/38/52 与 marker 宽度耦合，
   不公式化，作为列表组件内部常量。
5. **圆角随控件尺寸连续取值**：4–10px 连续 + 20px pill，不设跳档。规则：
   嵌套/小型元素 4–6，标准控件 7–8，容器/卡片 9–10，pill 仅 chip。
6. **字重即层级**：7 档字重（400/500/550/600/650/680/700）各有语义位
   （见字体节），550 是「强调但不粗」档，是本套排版的特征档；实现时不许用
   550/650 以外的中间值自造层级。
7. **阴影两档、各自专用**：active tab 的 `--shadow-pop`（「同平面相连」档）与浮层的
   `--shadow-raise`（「悬空」档，v1.1 增补，见文末）。其余层次全部靠两档 hairline +
   底色差。dark/eink 下阴影退场。两档之外新增阴影需要走裁决。
8. **屏 4 节奏收紧不进 token**：屏 4 的紧凑间距（`body[data-screen="4"]` 作用域）
   是演示密度让步（NOTES.md 妥协点），属组件级覆盖，不进入全局阶梯。

## 三主题 token 对照表（色彩 · 33 个）

同一 token 一行，三列主题值。`—` = 该主题未定义（继承语义见 eink 规则节）。

| token | light | dark | eink |
|---|---|---|---|
| `--frame` | `#f4f4f1` | `#1a1b1d` | `#ffffff` |
| `--agent-bg` | `#f7f7f4` | `#1e1f21` | `#ffffff` |
| `--content-bg` | `#fdfdfc` | `#222326` | `#ffffff` |
| `--preview-bg` | `#ffffff` | `#26272b` | `#ffffff` |
| `--border` | `#e3e2dd` | `rgba(255,255,255,.095)` | `#000000` |
| `--border-soft` | `#edece7` | `rgba(255,255,255,.055)` | `#b9b9b9` |
| `--text` | `#21201a` | `#e3e2db` | `#000000` |
| `--text-2` | `#6e6c61` | `#9b9a91` | `#3d3d3d` |
| `--text-3` | `#a9a79b` | `#62615b` | `#6e6e6e` |
| `--sel` | `#e8e7e1` | `rgba(255,255,255,.075)` | `#b9b9b9` |
| `--sel-text` | —（= `--text`） | —（= `--text`） | `#000000`（= `--text`） |
| `--sel-band`（v1.3） | `#c6c5bf` | `rgba(255,255,255,.22)` | `#b9b9b9` |
| `--hover` | `rgba(0,0,0,.038)` | `rgba(255,255,255,.05)` | `rgba(0,0,0,.06)` |
| `--accent` | `#3a5fcd` | `#8ba3ef` | `#000000` |
| `--accent-fill` | `#3a5fcd` | `#647ecf` | `#000000` |
| `--accent-fill-text` | `#ffffff` | `#ffffff` | `#ffffff` |
| `--accent-tint` | `#eef1fb` | `rgba(128,152,232,.15)` | `transparent` |
| `--run` | `#3a5fcd` | `#8ba3ef` | `#000000` |
| `--pending` | `#a06e0f` | `#d9a75c` | `#000000` |
| `--pending-tint` | `#faf3e1` | `rgba(217,167,92,.14)` | `transparent` |
| `--ok` | `#2c7a4d` | `#7cc093` | `#000000` |
| `--ok-tint` | `#e9f4ec` | `rgba(124,192,147,.13)` | `transparent` |
| `--danger` | `#bf4438` | `#e08a80` | `#000000` |
| `--danger-tint`（v1.2） | `#f9ecea` | `rgba(224,138,128,.13)` | `transparent` |
| `--code-bg` | `#f2f1ec` | `rgba(255,255,255,.05)` | `#f0f0f0` |
| `--tk-k`（keyword） | `#3a5fcd` | `#8ba3ef` | `#000000`＋700 |
| `--tk-s`（string） | `#2c7a4d` | `#7cc093` | `#000000` |
| `--tk-n`（number） | `#a06e0f` | `#d9a75c` | `#000000` |
| `--tk-c`（comment） | `#a9a79b` | `#63615f` | `#6e6e6e` |
| `--shadow-pop` | `0 1px 2px rgba(0,0,0,.05)` | `none` | `none` |
| `--shadow-raise`（v1.1） | `0 4px 16px rgba(0,0,0,.10)` | `0 4px 16px rgba(0,0,0,.50)` | `none` |
| `--scrim`（v1.1） | `rgba(0,0,0,.22)` | `rgba(0,0,0,.50)` | `rgba(0,0,0,.35)` |
| `--tl-close/min/max`（traffic 三色组） | `#ff5f57 / #febc2e / #28c840` | 同 light | `#fff` ×3 ＋ 1.2px 黑描边 |

服务原则 4（色彩克制且每色有语义）：light 下彩色恰好 4 个语义色（accent/pending/ok/
danger），语法高亮四色直接复用同一色阶（tk-k=accent、tk-s=ok、tk-n=pending、
tk-c=text-3），零新色相。服务原则 3（质感来自工艺）：层次靠两档灰（border/
border-soft）与底色差，不靠投影。

### 色彩分组语义与出处

- **bg 层级 4 档**：`--frame`（窗口框体/标题栏/侧栏/modeline，最沉）→ `--agent-bg`
  （agent 栏底色 + frontmatter 区/Agent 备注等「次级表面」）→ `--content-bg`
  （正文栏）→ `--preview-bg`（审阅视图文件卡，最亮）。层级方向在 dark 下反转
  （越深越沉），token 名不变。eink 全白，层级改由 hairline 承担（见 eink 规则）。
- **text 层级 3 档**：正文 `--text` / 次级 `--text-2`（meta、th、引用块、lede）/
  提示 `--text-3`（占位、时间戳、列表 marker、fm-key）。
- **border 两档**：`--border` 结构档（窗口分区、卡片、th 底线、引用块竖线）、
  `--border-soft` 层次档（区块内部条目分隔、hr、td 底线）——「两档灰而非投影」
  是原则 2/3 的核心手法。
- **语义色 4 个**：`--run`（运行中 = accent 同色，活跃语义统一）、`--pending`
  （待裁决 = 琥珀，唯一注意力色）、`--ok`（已批准/resolved = 弱饱和绿，只出现在
  档案与属性区）、`--danger`（驳回文字，不填充）。每个配一个 `-tint` 浅底
  （chip 底色）。run/pending 随 agent 特性启用；ok 在屏 4 已用（resolved chip）。
- **chip/状态**：chip = `10.5px/600` + 圆点 5px + `padding 2.5px 8px` + pill 圆角，
  四态 run/pending/ok/neutral 分别取语义色 + tint（neutral 取 `--text-3` + `--hover`）。
- **语法高亮 4 token**：keyword/string/number/comment，keyword 加 600 字重。
- **traffic 三色**：macOS 标准色，仅 eink 改白点黑描边（黑白纪律）。

## 字体（29 个）

服务原则 1（内容即界面）：排版参数是全套 token 里最大的一类，质感主要由它承担。

**家族栈（3）**

| token | 值 | 用途 |
|---|---|---|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif` | 全局默认（定稿表皮） |
| `--font-serif` | `ui-serif, "New York", Charter, Georgia, "Songti SC", serif` | 备查（`?body=serif` 轴保留，不定稿） |
| `--font-mono` | `ui-monospace, "SF Mono", Menlo, monospace` | 代码、fm-key、文件路径、kbd、ref |

基体还启用了 `font-feature-settings: "cv11","ss01"` 与
`font-variant-numeric: tabular-nums`（数字表面：modeline/chip/meta/编号）。
这两个特性随 `--font-sans` 走，是排版基因的一部分。

**字号阶梯（14）**：24（doc-title）/ 21（h1）/ 18（h2）/ 16（h3）/ 15（正文·h4）/
14（h5）/ 13.5（表格·memo·一级列表 marker）/ 13（UI 基准·fm-val·chat·队列标题·h6）/
12.5（tab·文件树·activity 行）/ 12（doc-meta·代码块·文件路径）/
11.5（th·面包屑·kbd hints）/ 11（label 基准·modeline·q-id）/
10.5（micro label·chip·时间戳）/ 10（file-tag·ghost chip·fm 内 chip）。
建议命名 `--fs-title/-h1/-h2/-h3/-h4/-h5/-h6/-body/-body-s/-ui/-ui-s/-meta/-label-s/-label/-micro/-nano`。
（2026-09-26 heading-hierarchy-ramp：19/16.5 两档随旧 H1/H2 退场——阶梯不留失去消费者的档；
新增 21/18/16/14 四档，h4/h6 与正文/UI 档同值但语义位独立命名，不跨语义引用。）

**字重阶梯（7）**：400 正文 / 500 中等强调（tab.active、folder）/
550 强调不粗（选中树行、队列标题、表格首列、按钮）/ 600 半粗（chip、seg 选中、
modeline `<b>`）/ 650 小字加粗（vault 名、label、h1–h6）/
680 大标题专用（doc-title、review-title）/ 700 标签大写档（agent-title、
queue-title、file-tag）。680 只许出现在 ≥21px 的字号上。

**行高（7）**：1.28（doc-title）/ 1.3（review-title）/ 1.7（正文阅读）/
1.58（chat 消息）/ 1.55（代码块）/ 1.5（UI 紧凑·表格 td·composer）/
1.4（队列标题）。规则：行高按表面分档，不做全局统一值。

**字距（随组件，不进阶梯）**：标题负字距 -0.012（doc-title）/ -0.009（h1）/ -0.007（h2）/
-0.005（h3）/ -0.004（h4）/ -0.002（h5）/ 0（h6）em（随字号递减；h1–h6 序列为
heading-hierarchy-ramp 2026-09-26 修订，原 -0.008/-0.006/-0.004em 三档退场）；
大写小标签正字距**逐处点名**（值一律取原型 CSS，不许在区间内取近似）：文件树组标题
`.tg-label` 0.08em（index.html:230）、审阅文件区标题 `.files-title` 0.08em（:531）、
agent 标题 / 队列标题 0.09em（:414、:465）、队列分组标签 `.q-group` 0.06em（:469）、
callout 组标题 `.co-g-label` 0.07em（:651）、键位面板组标题 `.kb-g-title` 0.07em（:739）、
预览区标签 `.preview-label` 0.07em（:542）。规则：负字距仅标题，正字距仅大写小标签。
（2026-09-25 修订：原文只给区间 `+0.06–0.09em`，实现据区间把键位面板组标题读成 0.08em，
原型是 0.07em（M215 gap 报告 §3.9）。点名即防这类区间内漂移。）

## 间距阶梯（14 个）

2px 基网：`--sp-1:2` `--sp-2:4` `--sp-3:6` `--sp-4:8` `--sp-5:10` `--sp-6:12`
`--sp-7:14` `--sp-8:16` `--sp-9:20` `--sp-10:24` `--sp-11:32` `--sp-12:40`
`--sp-13:44` `--sp-14:48`。

组件间 margin/padding 必须落阶梯；例外仅限收敛规则 3 点名的行内补偿与
已调优组件内边距。高频出处：正文 `padding: 32px 44px 20px`（sp-11/13/9）、
doc-body 段落间距 8（sp-4）、h2 `20px 0 6px`、h4 `14px 0 5px`、h5 `12px 0 4px`、
h6 `10px 0 4px`（h4–h6 为 heading-hierarchy-ramp 补档，2026-09-26）、fm 区 `padding: 8px 14px 9px`、
代码块 `padding: 9px 14px 10px`、队列条目三行的 20px 悬挂缩进（sp-9，与
checkbox 对齐——对齐纪律的样板）。

服务原则 3：对齐纪律的量化载体——同一档间距出现在不同组件上时，
它们就应当对齐（队列 20px 缩进 = checkbox 宽 13 + gap 7 的调优结果，
作为组件常量保留）。

## 圆角（8 个）

`--r4 / --r5 / --r6 / --r7 / --r8 / --r9 / --r10 / --r-pill:20`。

出处：r4 = tab 关闭钮、ghost chip、file-tag、q-check；r5 = wikilink、inline code；
r6 = 树行、send 钮、seg；r7 = tab、tb-btn、toast（`.toast5`，index.html:750）；
r8 = 按钮、代码块、fm 区、queue-count；r9 = composer 框、Agent 备注；
r10 = 文件卡、**浮层壳**（popover / modal：`.ovl-pop` :685、`.kbpanel` :732）；pill = chip。
规则：圆角与控件视觉尺寸正相关，连续取值不跳档。
（2026-09-25 补记：浮层壳归 r10——popover 与 modal 同档，toast 例外取 r7。出处表原本只列
「文件卡」，v1.1「浮层 elevation 与遮罩」节也只给了阴影/描边配方、未给圆角归属，实现据此
把 toc / vault 浮层取成 r9（M215 gap 报告 §3.5）。）

## 阴影与 hairline（两档阴影 + 两档 hairline 规则）

- `--shadow-pop`（值见对照表）：仅 active tab，用来表达「它连着正文」。
  dark/eink = none。
- `--shadow-raise`（v1.1 增补，值与推导见文末「浮层 elevation 与遮罩」）：
  **浮层专用**（popover / modal / toast），不扩散到任何平铺表面。dark 加深、
  eink = none。
- hairline 宽度统一 1px；eink 下强调态允许加粗到 1.2–1.6px（tab.active 1.4、
  traffic 点 1.2、composer focus 1.6）——eink 没有颜色，`border-width` 是它的
  「强调档」。
- 引用块竖线 2px `--border`、队列选中条 2.5px `--accent`、进度条 2.5px 高：
  三处「粗 hairline」是装饰性结构线的全部，不再新增。

服务原则 2/3：chrome 退后但不粗糙——层次全部来自两档灰与 1px 线，
投影只留给「当前文档」与「悬空表面」两个隐喻。

## 布局尺寸（16 个）

| token | 值 | 出处/说明 |
|---|---|---|
| `--layout-sidebar-w` | 236px | 侧栏 = traffic 灯区宽，左缘对齐 |
| `--layout-agent-w` | 348px | 「队列条目三行不折行」最小宽；随 agent 特性启用 |
| `--layout-titlebar-h` | 42px | |
| `--layout-modeline-h` | 25px | |
| `--layout-doc-measure` | 760px | 正文 max-width（框宽），居中；**默认值**（content-width-drag 节点 1 裁决 D1，2026-09-26 Alex 修订为 760），可被 `ui.content_width` 配置覆盖（合法区间 [760, 1200]） |
| `--layout-review-measure` | 720px | 审阅视图 max-width；随 agent 特性启用 |
| `--layout-tab-h` | 29px | tab 高，max-width 230px |
| `--layout-tb-btn` | 30×28px | 标题栏按钮（侧栏内变体 26×24） |
| `--layout-tree-row-h` | 25px | 树行高 |
| `--layout-agent-head-h` | 38px | agent 栏头；随 agent 特性启用 |
| `--layout-queue-head-h` | 34px | 队列头；随 agent 特性启用 |
| `--layout-actionbar-h` | 54px | 审阅操作条；随 agent 特性启用 |
| `--layout-tree-indent` | 8 + 14×层深 | 文件树缩进公式（收敛规则 4） |
| `--layout-fm-key-w` | 104px | frontmatter 字段名列宽 |
| `--layout-chat-queue-split` | 44% / 56% | chat 与队列的纵向配比；随 agent 特性启用 |
| `--layout-composer-h` | 99px | composer 固定高（两轴几何不变的前提）；随 agent 特性启用 |

目标视口 1280×900；agent 在场时正文 **pane** 被压至 ~696px（1280 − 侧栏 236 − agent 栏 348），
`.cm-scroller` 的中列随之钳到 **648px**（696 − 两侧各 24px 的最小轨道），文字实测宽约 **560px**
（648 − 88 内边距）。**这不与默认值矛盾**：`--layout-doc-measure` 的轨道语义是**上限**
（`minmax(0, token)`），窗口或侧栏不够宽时中列收缩到可用宽度——648 是「被压后的实际列宽」，
不是「默认值失效」。（「用户仍可在中间栏读文」的兑现；664→680→**760** 为 content-width-drag
节点 1 裁决 D1 及其 2026-09-26 修订——760 是**默认值**，用户可经栏宽拖拽在 [760, 1200] 内调宽。）

服务原则 1/2：760 阅读宽（默认）是「内容即界面」的硬参数；固定栏宽是 chrome
退后的前提（chrome 尺寸不随内容呼吸）。

## 动效（4 个）

| token | 值 | 用途 |
|---|---|---|
| `--dur-hover` | 0.1s | 树行/队列条目 hover |
| `--dur-ui` | 0.12s | tab、tb-btn、wikilink、composer 边框、chevron 旋转 |
| `--ease-standard` | `ease` | 全部过渡统一缓动 |
| `--pulse-cycle` | `1.6s ease-in-out infinite`（opacity 1→0.25→1） | 运行中呼吸点（agent-live、chip.run、m-dot）；随 agent 特性启用 |

规则：只有 hover 过渡（0.1–0.12s）与一种呼吸动画，无入场动画、无弹性曲线。
服务原则 3：克制的动效是质感来源之一；Linear 式速度感落在键盘流上，
不落在动画上。

## eink 规则（显式，不是散落的值）

eink 不是「换一套色板」，是一组系统性降级规则。实现时逐条落实：

1. **色彩全退场**：`--accent` 与全部语义色（run/pending/ok/danger）= `#000`，
   全部 `-tint` = `transparent`。彩色只剩 traffic 灯，且改成白点黑描边。
2. **对比改由字重与明度承担**：语法高亮 keyword 700 纯黑、string/number 纯黑、
   comment 降灰 `#6e6e6e`（= `--tk-c`）——注释与代码的区分是明度对比，不依赖
   色相（屏 4 截图已验证成立）。
3. **hairline 实心黑**：`--border` = `#000`；`--border-soft` 保留为 `#b9b9b9`
   灰档——两档层次不丢，只是结构档拉满。
4. **选中态 = 明度带 + 黑字（v1.3 修订，2026-09-28 Alex 裁决）**：`--sel` = `#b9b9b9`、
   `--sel-text` = `#000000`（= `--text`）。v1 的「黑底反白」（`--sel` `#000` + `--sel-text` `#fff`）
   **整条退场**——反白只有两条实现路径，两条都不可靠：
   （a）**chrome 侧**靠 `--sel-text` + 逐表面的 `:not(:hover)` 排除条款：`--hover` 档会压过选中
   底色（悬停反馈压过常驻选中，同一心智模型），于是「白字压浅底」只差漏掉一条排除条款或一个
   过渡帧——Alex 原话「现在是白字灰底，我人眼几乎看不清字是什么」；
   （b）**编辑器侧**只能靠原生选区的 `::selection { color }`，而它只作用于**仍被原生选区覆盖**的
   文字：选区驱动的装饰重建（显露强调段、公式、链接…）会把那段 DOM 重建出来，WKWebView 不把
   重建出的节点画进选中层（M273 的机理，M285 只修了**底色**那一半）⇒ 重建段保留自己的字色、
   压在黑底上被吞（Alex 的引用块粗体现场）。
   改成明度带 + 黑字后：任选区内文字与被压着的底色都可辨（①不成立），编辑器侧不再依赖原生选区的
   覆盖（②不成立），`--sel-text` 也不再需要与正文色分家（本档两值相同是设计结果，不是巧合）。
   `--sel-text` 这个语义位保留：下游规则（树行 / 浮层行 / 菜单项 / 编辑器原生选区）照旧只读它。
   **代价**：选区不再是「纯黑块」而是灰带——观感弱一档，实测读数见下节。
5. **浅底区块翻转为白底黑框**：代码块与 frontmatter 区在 light/dark 靠浅底
   （`--code-bg`/`--agent-bg`）区分，eink 无灰底可用，改为 `background:#fff;
   border:1px solid #000`。
6. **chip 描边化**：全部 chip 加 `1px solid #000`，底色退场，状态语义改由
   文案 + 圆点承担。
7. **阴影全退场**：`--shadow-pop` 与 `--shadow-raise`（v1.1）= none；浮层在 eink 的
   分层改由白底 + 实心黑框承担（见「浮层 elevation 与遮罩」），遮罩以明度差保留。
8. **强调 = 加粗线宽**：tab.active 边框 1.4px、composer focus 1.6px、
   traffic 描边 1.2px——`border-width` 是 eink 唯一的「强调色」。
9. **wikilink 从药丸降级为下划线**：浅底 accent 药丸在黑白下不成立，
   改 `text-decoration: underline` + 3px offset。

服务 brief 已识别张力「消费品质感 vs eink」：三主题共享结构与排版基因，
只分档对比度——上述 9 条就是「分档」的完整定义。

## 浮层 elevation 与遮罩（v1.1 增补，2026-09-24）

**缘起**：v1 的阴影只有 active tab 一档（`--shadow-pop`），浮层（popover / modal /
toast）没有分层依据——原型定稿图未直接呈现 toc 大纲浮层、vault 切换浮层、
搜索面板、lightbox、键位面板等周边表面。提案评审（restyle-ui-tokens-v1）确认：
为浮层设计一档 elevation，保持克制，规则写明「浮层专用，不扩散」。

**新增 token ×2**（值已并入三主题对照表）：

| token | light | dark | eink |
|---|---|---|---|
| `--shadow-raise` | `0 4px 16px rgba(0,0,0,.10)` | `0 4px 16px rgba(0,0,0,.50)` | `none` |
| `--scrim` | `rgba(0,0,0,.22)` | `rgba(0,0,0,.50)` | `rgba(0,0,0,.35)` |

**推导依据**：

- **`--shadow-raise` 与 `--shadow-pop` 是两档隐喻**：pop 是「同平面相连」
  （active tab 连着正文，0 1px 2px / .05）；raise 是「悬空于内容之上」，因此
  y-offset 与 blur 放大到 4/16、不透明度翻倍到 .10——量级参照 macOS 系统
  popover 再收一档。浮层的**边缘不由阴影承担**：浮层壳一律带 1px `--border`
  hairline（与界面全部边线同档），阴影只负责「浮起」这一层信息。
- **dark 加深不加糊**：dark 下环境光缺席，相同 alpha 的黑阴影在深色底上不可读；
  保持同构参数（4/16）、不透明度提到 .50。描边已由 `--border`
  `rgba(255,255,255,.095)` 承担，阴影无需兼职。
- **eink 走既有 9 条规则的自然延伸**：规则⑦阴影全退场 ⇒ `--shadow-raise` = none；
  浮层分层 = bg 层级最亮档（`--preview-bg`，eink 为白）+ 1px 实心黑 hairline
  （规则③）；modal 类浮层（键位面板等需要强于 popover 的存在感）升级到 1.4px
  线宽强调档（规则⑧）。遮罩以明度差保留（规则②的同一逻辑：明度是 eink 合法
  的对比手段），取 .35——纯黑过强会让下层内容完全消失，违背「压暗而非遮蔽」。
- **`--scrim` 不是第三档阴影**：遮罩是背景压暗层，与 elevation 无关，单列。
  取中性纯黑 alpha 而非现行实现的 `color-mix(in srgb, var(--text) 30%)`——
  新体系三主题的 `--text` 色相不同（light 是暖黑），color-mix 会让遮罩随主题
  偏色；遮罩的职责只是压暗，应保持中性。light .22（下层隐约可读）、dark .50
  （底色已深，需更高 alpha 才形成压暗差）。

**使用规则**：

1. `--shadow-raise` **浮层专用**：popover（toc 大纲、vault 切换器）、modal 面板
   （键位面板）、toast。MUST NOT 用在任何平铺表面（侧栏、面板、卡片、按钮）——
   平铺表面的层次继续只靠两档 hairline + 底色差。
2. 浮层壳的完整配方 = `--preview-bg`（bg 层级最亮档，「浮层在内容之上」在色阶
   上的表达）+ 1px `--border` + `--shadow-raise`；eink = `--preview-bg` + 1px
   实心黑框（modal 1.4px），无阴影。
3. `--scrim` 仅用于全屏遮罩（lightbox、键位面板的 overlay）。popover 不用遮罩。
4. 任何第三档 elevation（如「浮层之上再浮层」）需要走裁决，本版不存在该场景。

服务原则 3（质感来自工艺，不来自装饰）：浮层的「浮起感」靠一档受控阴影 +
hairline 边缘 + bg 色阶三者各司其职，不靠堆叠模糊半径。

## callout 语义收敛（v1.2 增补，2026-09-24）

**缘起**：现行实现有 14 个 `--callout-*` 色（13 种 callout 类型 + unknown 回落，
`src/style.css:28`），与原则 4「4 语义色」冲突。restyle-ui-tokens-v1 节点 1 裁决
**D2 = 本 change 内收敛**：13 种类型归并到「4 语义色 + 灰」，`--callout-*` token
全部删除。

**映射表**（语义就近；有争议的类型在理由列标注）：

| callout 类型 | 归并 | 取值（色条 / 底色） | 理由 |
|---|---|---|---|
| note | 蓝（信息） | `--accent` / `--accent-tint` | 默认类型，中性信息 |
| abstract | 蓝（信息） | `--accent` / `--accent-tint` | **有争议**：原色 teal（`#3d7a76`）在新体系无色相对应；摘要是信息聚合而非成功/警示，归蓝系 |
| info | 蓝（信息） | `--accent` / `--accent-tint` | 与 note 同族 |
| todo | 蓝（信息） | `--accent` / `--accent-tint` | **有争议**：候选是琥珀（「需要注意」），但 todo 是常态清单不是紧迫警示；琥珀留给「需要你裁决」的语义（与 pending 同族），todo 不到那档 |
| tip | 绿（积极） | `--ok` / `--ok-tint` | 建议性、正向前馈 |
| success | 绿（积极） | `--ok` / `--ok-tint` | 与「已批准/resolved」同语义 |
| question | 琥珀（注意） | `--pending` / `--pending-tint` | 映射里语义最强的一条：question = 悬而未决 = 「待裁决」的文档内形态，与 pending 同族 |
| warning | 琥珀（注意） | `--pending` / `--pending-tint` | 警示但不阻断 |
| failure | 红（否定） | `--danger` / `--danger-tint`（v1.2 新增） | 已发生的否定结果 |
| danger | 红（否定） | `--danger` / `--danger-tint` | 高危警示，与 failure 同族（现行两色本就同值 `#b23a2c`） |
| bug | 红（否定） | `--danger` / `--danger-tint` | 缺陷 = 已确认的错（现行同 `#b23a2c`） |
| example | 灰（中性） | `--text-3` / `--agent-bg` | 内容性展示，无状态语义 |
| quote | 灰（中性） | `--text-3` / `--agent-bg` | 引用块近亲，无状态语义 |

**规则**：

1. callout 色值只允许取上表五族：蓝 `--accent` / 绿 `--ok` / 琥珀 `--pending` /
   红 `--danger`（+ 各自 `-tint` 底色）、灰 `--text-3` + `--agent-bg`。
   `--callout-*` 与 `--callout-tint`（color-mix 强度）一并删除——底色直接取
   tint token，不再 color-mix 现混。
2. **同族类型的区分手段 = 标题文字，不是色相**。色条与底色承担「语义族」
   （信息 / 积极 / 注意 / 否定 / 中性），类型区分由 callout 标题行的类型标签
   文字承担（failure / danger / bug 同红族时靠「失败 / 危险 / 缺陷」分辨）。
   MUST NOT 为此引入图标体系——本设计无装饰性图标（原则 3），且 eink 下
   色条全黑（下条），图标会假扮成「黑白下仍成立的区分手段」。
3. **eink**：语义色全黑（规则①）、tint 全 transparent（底色 = `--content-bg`）、
   色条 2px 黑。五族在 eink 下视觉合一，区分完全交给标题文字——这不是退化，
   是规则②（字重/明度承担对比）在 callout 上的直接后果；屏 6（原型
   `?screen=6`）已渲染验证可读性。
4. `--danger-tint` 为本节新增 token（已入对照表）：light `#f9ecea`、
   dark `rgba(224,138,128,.13)`、eink `transparent`，色阶与 `--ok-tint` /
   `--pending-tint` 同档。

## 选区族（`--sel-band` 与 eink 规则④，v1.3 增补，2026-09-28）

**缘起**：Alex 报告选区族的一串问题——light / dark 看不出选区落点（「我人眼压根看不出来我从哪里
选中的」）；eink 下代码块里「几乎看不到文字」；eink 的 chrome 侧选中态「现在是白字灰底，我人眼
几乎看不清字是什么」（裁决：整族重定）；以及「eink 引用块里粗体被选中后看不见」。定性后是**两档
机制**，都不是「画不出来」：

1. **撞色**：`--sel` 与它要压住的承载面太近。真机读数（窗口局部 7×7 主色）：light 正文带
   `#e8e7e2` vs 纸 `#fdfdfd` = **27**、dark `#37383a` vs `#222327` = **21**（M288 时代的块内读数
   更低：light 11 / dark 16）。「看不出从哪里选中」就是这两个数字的直接后果。
2. **eink 的「黑底反白」只有一半**（v1 规则④的实现依赖）：
   （a）**编辑器侧**反白只能靠原生选区的 `::selection { color }`，而它只作用于**仍被原生选区覆盖**
   的文字——选区驱动的装饰重建（显露）会把那段 DOM 重建出来，WKWebView 不把重建出的节点画进选中层
   （M273 机理；M285 只修了**底色**那一半）⇒ 重建段保留自己的字色压在黑底上。
   （b）**chrome 侧**反白靠 `--sel-text` + **逐表面**的 `:not(:hover)` 排除条款：`--hover` 档会压过
   选中底色，于是「白字压 `#f0f0f0`」只差漏一条条款或一个过渡帧（实测该形态差 **15**）。
   （c）附带现场：**行内 code 药丸**的底色画在选区带**之上**，取白字的药丸内部实测跨度 **15**
   （白字压浅灰）。

**设计决定**（Alex 2026-09-28 裁决「eink 的 `--sel` 族整体重定」）：

- 编辑器选区带的真源从 `--sel` 拆出为 **`--sel-band`**：它画在**文字之下**、前景改不了，下界还要
  压住代码块的行区带（`--code-bg`）。light / dark 因此必须比 `--sel` 重得多，两 token 分列。
- **eink 的 `--sel` 族整体重定**：`--sel` 纯黑 → 明度带 `#b9b9b9`、`--sel-text` 白 → 黑（= `--text`）。
  反白路线整条退场 ⇒ 编辑器侧不再依赖原生选区的覆盖（2a 不成立）、chrome 侧不再需要逐表面的
  `:not(:hover)` 兜底（2b 不成立）、药丸里的字也不再被改成白色（2c 不成立，实测跨度 15 → 231）。
- **eink 两个 token 同值**（`--sel` = `--sel-band` = `#b9b9b9`）：明度带同时满足两侧的下界，
  没有分列的必要；`--sel-text` 保留语义位（下游规则照旧只读它），值不再与正文色分家。

**取值判据**（先写死判据，再取值）：带与**两种承载面**（`--content-bg`、代码块行区带 `--code-bg`）
的每通道最大差 MUST ≥ **40**；此外「选区（带）覆盖的文字 MUST 与它压着的底色可辨」≥ 40。
40 的来历是实测的：21 / 16 / 27 被 Alex 判为「人眼压根看不出来」，取约两倍并把实测值随判据登记，
不宣称它是普适感知阈值。

| 主题 | `--sel-band` | vs `--content-bg` | vs 代码行区带 | 说明 |
|---|---|---|---|---|
| light | `#c6c5bf` | 61 | 45 | **下界由 `--code-bg` 决定**：`--code-bg` 自己就是浅灰（`#f2f1ec`），可用区间被它压得很窄——本档能取的最浅值就在这附近（暖灰轴 `--border` `#e3e2dd` → `--sel` `#e8e7e1` → 本档的更深一步） |
| dark | `rgba(255,255,255,.22)` | 49 | 44 | 深色档的既有语汇是半透明白（`--border` .095 / `--hover` .05 / `--code-bg` .05），本档取**满足两条判据的最小档**（binding 约束是代码行区带）——再往下会把暗档文字一并压掉，那是本档无法两全的地方，代价见下 |
| eink | `#b9b9b9` | 70 | 55 | M291 同批改的还有 chrome 侧的 `--sel`（规则④），本档两个 token 同值。取 `--border-soft` 的 eink 值——**零新增色**（收敛规则 1 只允许既有档位）。黑字压它的对比约 10.7:1，着色文字（`--tk-c` `#6e6e6e`）也 ≥ 75 |

**chrome 侧的实测**（chromium，`tests/visual/scenes/m291-selection-contrast.spec.ts` 的 chrome 用例；
判据是「文字色 vs 它实际压着的底色」逐层合成后的每通道差 ≥ 40）：

| 表面 | 修前（eink） | 修后（eink） |
|---|---|---|
| 树当前行（指针停在行上 ⇒ 底色被 `--hover` 压过） | 白字压 `#f0f0f0` ⇒ **差 15**（「白字灰底」形态；修前靠一条 `:not(:hover)` 排除条款避开它） | 黑字压 `#f0f0f0` ⇒ 240 |
| 树当前行（稳态） | 白字压 `#000` ⇒ 255 | 黑字压 `#b9b9b9` ⇒ 185 |
| 浮层当前项（含 ✓ 槽位与悬停组合） | 白字压 `#000` ⇒ 255 | 黑字压 `#b9b9b9` ⇒ 185 |

**已知代价（如实登记）**：填色式选区带必然要占一段明度，而 light / dark 的**暗档文字**
（`--text-3` / `--tk-c`）与底色之间只有约 30 个 L\* 的余量——一条同时满足「与承载面差 ≥ 40」的带子
落不进退让区间。实测 ΔL\*（带 vs 暗档文字）：light 21.3 → 9.3、dark 18.5 → 6.1（eink 无此问题，
28 → 28）。即 **dark 下选区内的注释会明显变淡**。取舍理由：被报告的缺陷是「选区根本看不见」
（每一次选择都受影响），而暗档文字只在**选区之内**的短暂状态下变淡，且暗档本就是设计上刻意低对比
的提示档。可调旋钮：dark 的 alpha（.18 → .30，越小越保暗档、越弱化选区）。

**被否的候选**（留档，防后人重走）：「把选区层抬到文字之上 + `mix-blend-mode: difference`」能凑出
反白效果，代价是①与 M288 的层序口径冲突（底板 / 行区带是按负 z-index 定的），②带色随承载面变
（压 `#f0f0f0` 的代码行得到 `#0f0f0f`、压白底得到 `#000000`），同一选区在块内外不再同色，M288 的
绝对判据当场失去意义。

**本版未覆盖**：行内 code 药丸 / callout 行底色 / frontmatter 区这类 in-flow 行内底色仍画在选区带
**之上**——本版只保证「那里的字可读」，覆盖问题另立（`docs/backlog.md` 的 M291 节 + finding
`20260928-worker-selection-contrast-m291-bug-in-flow-code-callout-frontmatter`）。

## 字面值归位（eink 反白 → token；v1.4 增补，2026-09-29）

**缘起**：收敛规则 1 说「组件里只剩 eink 的手工反白（`#000` / `#fff` / …），它们语义上属于既有
token 的 eink 值，收敛时归位，不新增色」。本条把「归位」落成可执行的两族口径，并给出首批落地
（M293，Alex 2026-09-29 裁决「改。你可以安排时就动手。」）。

**两族与归属**——**角色归位**：按这条声明在规则里的**角色**选 token（实心底 / 边框），
不按字面值去反查「哪个 token 恰好也是这个值」（eink 下 `#000` 与多个 token 同值，反查会选错语义位）：

| 角色 | 归属 token | eink 取值 | M293 落点 |
|---|---|---|---|
| 实心强调（实心底 + 反白字） | `--accent-fill` / `--accent-fill-text` | `#000000` / `#ffffff` | 搜索面板的大小写开关「开」态、当前搜索匹配 |
| 边框（黑框 / 描边 / 色条） | `--border` | `#000000` | 代码块横滚容器、frontmatter 盒、fm 状态 chip、tags chip、callout 左色条、两处全屏浮层壳、文件树「打开目录」入口 |

线宽（1.4px = 规则⑧的强调档、1px 的结构档、callout 色条的 2px）**不是色**，归位不动宽度。

**判据（两层，缺一层即假绿）**：
1. **值**：元素的计算色 == 归属 token 的计算值（三主题；eink 是被改写的那一档）；
2. **归属**：把归属 token 临时改成一个三主题都不用的探测色，该元素的计算色 MUST 跟着变——
   写死字面值的声明**不会**跟着变。这一层才是「不再硬编码」的判据（REVIEW.md 第 1 条的防线）。
   实证：`tests/visual/scenes/m293-eink-literal-tokens.spec.ts`（4 组 × 3 主题）修前跑，eink 三组
   全红在 ②、① 全绿——「值不变、只是不再硬编码」的签名。

**平台注记**：chromium 在 `deviceScaleFactor=1`（视觉门禁与 CI 的口径）下把 1.4px 边框折成整数档，
`getComputedStyle` 读回 `1px` ⇒「规则⑧的 1.4px 强调档」在这一层的判别力为零，只能钉「有框 +
色 = `--border`」；该档的可见差异在真机（WKWebView，dsf=2）。

**「面」字面值 + 一处处前景色（v1.4 登记，v1.5 已归位）**：`background-color: #fff` /
`backgroundColor: "#fff"`（代码块底板、全屏代码块内容容器、callout 行、frontmatter 盒）与
callout 类型标签的 `color: "#000"`。登记当时它们不属上述两族，且 eink 下 `#fff` 与
`--preview-bg` / `--frame` / `--content-bg` / `--agent-bg` 同值（`#000` 与 `--accent` /
`--ok` / `--pending` / `--danger` / `--text` 同值）——归位要先定语义位。语义位与落点见下节。

### 面族与前景区位（v1.5 增补，2026-09-29）

**缘起**：Alex 2026-09-29 裁决原文「1. 立；2，删。」——① 立本节的语义位口径并归位 v1.4 登记的
4 处面字面值；② frontmatter 盒那处**冗余**覆盖直接删。落地批次 M294（判据与读数见
`test-results/m294/`）。

**角色归位表**（口径同 v1.4：按声明在规则里的**角色**选 token，不按字面值反查）：

| 角色 | 归属 token | 依据 |
|---|---|---|
| 浅底区块翻白（规则⑤ 的白底半边） | `--content-bg` | eink「无灰底可用」⇒ 区块不另立色面，**回落成它所在的面**（正文面）。先例即本档既有口径：§callout 语义收敛 规则 3「tint 全 transparent（底色 = `--content-bg`）」。三处落点同取此档：代码块底板、全屏代码块内容容器、callout 行 |
| frontmatter 盒（**次级表面**） | `--agent-bg` | 基规则本就取它（§bg 层级四档里 frontmatter 区就被点名为「次级表面」），eink 该 token 同为 `#ffffff` ⇒ eink 覆盖**冗余**，按裁决直接删（删后由基规则接管，值不变） |
| 五族合一后的统一前景（callout 类型标签） | `--text` | ❌ 不是「族色」：五族的族色分散在 `--accent` / `--ok` / `--pending` / `--danger` / `--text-3` 上，**没有一个 token 能代表五族**；且规则② 之后 eink 的颜色不承担信息，标签靠文案区分。同口径先例：M291 r3 把触发钮静止态的 `color` 归到 `--text` |

**M294 落点（值逐值不变，零基线更新）**：`src/style.css` 的 `:root[data-theme="eink"]
.cm-lp-codeblock-scroll::before` 与 `:root[data-theme="eink"] .lumir-codeblock-fs-content`、
`src/preview/theme.ts` 的 `:root[data-theme="eink"] & .cm-line.cm-lp-callout-line` 底色
→ `var(--content-bg)`；`… & .cm-lp-frontmatter` 的 `backgroundColor` 声明**删除**；
`… & .cm-lp-callout-type` → `var(--text)`。

**两条 MUST NOT（本批查实的既有事实，防后人顺手「修」错）**：

1. 代码块在 eink 是**两层**：底板（`::before`，本批归位的那处，白）与行区带（`::after`，读
   `--code-bg` = `#f0f0f0` 的灰）——restyle-eink 规则⑤的用例把这条写成断言（「只有底板翻转，
   行区带仍是 `--code-bg` 的灰」）。`--code-bg` 在本档另有消费者（行区带、变量绑定底纹、
   mermaid 集群底色），**MUST NOT 把 `--code-bg` 一并翻白**。
2. 全屏代码块内容容器（`.lumir-codeblock-fs-content`）是**单层**（整块白，无行区带那一层）
   ——它的白与文档内底板的取同一 token，但形态不同，改一处不应推及另一处的层数。

**判据（两层，与 v1.4 同）**：`tests/visual/scenes/m294-surface-and-foreground-literals.spec.ts`
（6 用例 = 2 组 × 3 主题：面族 4 处 + 类型标签；每组断言「计算色 == 归属 token」并做 token
探测归属判据）。修前跑：light / dark 4 条绿（基规则本就取对 token）、eink 2 条红在 ②（四处面 +
一处前景均读到写死的 `rgb(255,255,255)` / `rgb(0, 0, 0)` 纹丝不动）、① 全绿——同样是
「值不变、只是不再硬编码」的签名。

## 与现行实现的差距（对照 src/style.css）

现行实现是单主题米色 editorial 风（`:root` 一组 token，无主题机制），
新 token 是三主题结构。映射与处置：

**替换（语义对应、值更换）**

| 现行 | 新 | 说明 |
|---|---|---|
| `--bg: #f6f3ea` | `--content-bg` | 米色退场，换近白中性 |
| `--bg-nav: #efeadd` | `--frame` | 侧栏与窗口框体同色 |
| `--bd-1` | `--border` | |
| `--text: #262219` | `--text: #21201a` | |
| `--dim: #8d8471` | `--text-2` + `--text-3` | 一级 dim 拆两级，按场景分流（meta→text-3，次级正文→text-2） |
| `--accent: #b23a2c` | `--accent: #3a5fcd` | 红→蓝，色相语义更换 |
| `--sel: rgba(178,58,44,.16)` | `--sel` | 中性化；`::selection` 改 `--accent-tint` |
| `--radius: 5px` | `--r*` 阶梯 | 按控件尺寸分档 |
| `--measure: 80%` | `--layout-doc-measure: 760px` | 百分比改定值（664→680→760：content-width-drag D1 裁决 + 2026-09-26 修订） |
| `--nav-width: 244px`（窄屏 204） | `--layout-sidebar-w: 236px` | 响应式 204 变体删除，收窄策略待裁决 |
| `--line-height: 1.75` | 1.7（`--lh-reading`） | |
| `--font-body` | `--font-sans` | 栈扩充（SF Pro Text/Helvetica Neue） |
| `--font-mono` | `--font-mono` | 值不变 |

**删除**

- `--font-display`（Songti 标题栈）：sans 定稿，标题改 sans + 680 字重。
- `--selection-ink`：选中前景由 `--sel-text`（eink）/ 默认（light/dark）接替。
- `--bd-2` / `--bd-3`：三档边线收敛为两档。影响点：`theme.ts` 引用块竖线
  `3px solid var(--bd-2)` → 2px `--border`（粗度与色值双变，需过视觉门禁）。

**保留机制、换默认值**

- `--editor-font-family / --editor-mono-family / --editor-font-size` 三层
  （typography-and-zoom change 的运行期写入路径）机制保留，族改指
  `--font-sans` / `--font-mono`。`--editor-font-size` 出厂默认 16px → **15px**
  （2026-09-24 节点 1 裁决 D1：编辑器即阅读表面，出厂观感与定稿图一致）。
- callout 13 色（`--callout-*`）：**已裁决收敛**（2026-09-24 节点 1 裁决 D2，
  随 restyle-ui-tokens-v1 一并落地）——按「callout 语义收敛（v1.2 增补）」节的
  映射表归并到 4 语义色 + 灰，13 个 `--callout-*` token 删除。

**新增（现行完全没有）**

- dark / eink 整套主题值与主题切换机制（`data-theme` 属性）。
- `--text-3`、`--border-soft`、`--hover`、`--accent-tint/-fill/-fill-text`、
  `--code-bg`、语义色 6 个（run/pending/ok + 3 tint + danger 沿用语义换色）、
  语法高亮 `--tk-*` ×4、`--shadow-pop`、间距/圆角/布局/动效全套。
- `src/preview/theme.ts` 的语法高亮色当前借用 `--dim`/`--accent`/
  `--callout-tip`/`--callout-warning` 等（`cm-lp-tok-*`），实现时改指
  `--tk-k/s/n/c`，与 callout 色解耦。
- frontmatter 渲染：现行是编辑器内 block widget（theme.ts 引用 `--bg-2`），
  新形态是 `.fm` 属性区（字段名 mono 11px `--text-3`、值 13px、status 语义
  chip、置于文档顶部），样式整体换新 token。

## 统计

共 **106 个 token**：色彩 33（含阴影 2、遮罩 1、traffic 组 1、danger-tint 1、
`--sel-band` 1；`--shadow-raise` / `--scrim` 为 v1.1 增补、`--danger-tint` 为 v1.2 增补，均
2026-09-24，`--sel-band` 为 v1.3 增补，2026-09-28，缘起各见其节）、字体 31（族 3 + 字号 14 + 字重 7 + 行高 7；
字号 12→14 为 heading-hierarchy-ramp 修订，2026-09-26）、
间距 14、圆角 8、布局 16、动效 4。
