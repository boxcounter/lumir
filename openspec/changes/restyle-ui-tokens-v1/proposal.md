# Proposal: UI 重设计——三主题设计系统落地（方向 C 骨架 + design tokens v1）

- Change ID: restyle-ui-tokens-v1
- 日期: 2026-09-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

设计阶段已收敛完毕，全部输入都是**你已批准的制品**：

| # | 事实 | 锚点（可复核） |
|---|---|---|
| 1 | 方向 C「驾驶舱」骨架已定稿：三栏（文件树 / 正文 / 右栏 dock 预留位），**本次实现范围 = 无 agent 的三栏骨架 + 无衬线表皮 × 三主题**；屏 2/3（agent）、composer 变体推迟到 agent 特性立项 | [design-brief-v1.md](../../../docs/specs/design-brief-v1.md) §裁决记录（2026-09-24） |
| 2 | 最终样式 6 图（主界面 + 内容类型 × light/dark/eink）经你检查，结论「挺喜欢，无必须改项」 | `design/prototypes/final-review/`（6 张 PNG）；brief §裁决记录同条 |
| 3 | tokens 已全量提取成文：103 个（色彩 32 / 字体 29 / 间距 14 / 圆角 8 / 布局 16 / 动效 4），含三主题对照表、9 条 eink 降级规则、浮层 elevation 与遮罩（v1.1 增补）、callout 13 类五族语义收敛（v1.2 增补，节点 1 裁决 D2）、以及与现行实现的新旧差距对照 | [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) |
| 4 | 现行实现是**单主题米色 editorial**：`--bg:#f6f3ea` / `--accent:#b23a2c`（红）/ `--font-display`（宋体标题）/ `--measure:80%` / `--nav-width:244px`，无主题机制 | `src/style.css:6-13`；新旧逐项映射见 tokens 文档 §与现行实现的差距 |
| 5 | 现行编辑器渲染色与 callout 色耦合：语法高亮 `cm-lp-tok-*` 借用 `--dim` / `--accent` / `--callout-tip` / `--callout-warning` 等，token 层没有独立的语法高亮语义 | `src/preview/theme.ts:157-162` |

为什么现在做：设计系统是所有后续 UI 工作的地基。继续把新功能（键位面板之后的任何表面）写在米色 editorial 体系上，等于持续积累注定全量返工的视觉债；且骨架里「右栏 dock 预留位」是 agent 特性的结构前提，先落骨架，agent 立项时才有地方放。

### 与活跃 change 的关系

- **`typography-and-zoom`（已实现、未归档）**：它给排版基线开了配置口（`--editor-font-family` / `--editor-mono-family` / `--editor-font-size`，机制保留）。本 change 把 `--font-body` 更名为 `--font-sans`、默认行高 1.75→1.7、栏宽 80%→664px，这三个 token 的默认值都变——typography 的**配置机制不受影响**（用户配置写在 `--editor-*` 层），但出厂默认观感整体换血。两个 change 的基线处置正交：typography 守「默认零变更」，本 change 是「全量重建」。**建议本 change 在 typography-and-zoom 归档之后进入实现**，避免两份 delta 同时改 `src/style.css` 的 `:root`。
- **ADR 0006 §3** 曾裁决「删除三主题实现，收敛到单套排版基线」——当时的三主题是旧 editorial 体系的变体。本 change 的三主题是**新设计系统**的分档（brief 已识别张力节的解法假设，经 6 图裁决验证成立），不是恢复旧三主题。

## What Changes

1. **落地 design token 层**：`src/style.css` 的 `:root` 按 tokens 文档全量重建——色彩 30（三主题各一份）、字体 29、间距 14、圆角 8、布局 16、动效 4；主题经 `data-theme` 属性切换。旧 token（`--bg` / `--bg-nav` / `--bg-2` / `--bg-3` / `--bd-1..3` / `--dim` / `--radius` / `--measure` / `--nav-width` / `--font-display` / `--selection-ink`）按 tokens 文档 §差距 的映射表替换或删除。（delta：`ui-design-system` / 设计 token 层）

2. **主题选择机制**：新增 `[ui]` 配置表，字段 `theme`（`light` / `dark` / `eink`，默认 `light`），启动装载时读一次并施加到 `data-theme`（与 `editor.mode` 同口径，重启生效）。**本项是裁决点 D3 的推荐项**，若裁决改备选，delta 与 tasks 按备选改写。（delta：`ui-design-system` / 三主题与主题选择）

3. **应用骨架重构**：标题栏 42px（traffic 灯区 236 与侧栏对齐、标签迁入标题栏、右侧动作钮）、侧栏 236px（vault 名入侧栏头）、modeline 25px（左：文件路径；右：语法 · 行数 · 编码）、正文阅读宽 664px 居中、**右栏 dock 预留位**（骨架上留出结构位置但不渲染任何 agent 内容）。**masthead 移除**，其信息迁移：vault 名→侧栏头、当前文件路径→modeline、toc 当前位置指示→modeline（落点与形态见 design §3）。macOS 侧启用 overlay 标题栏（`titleBarStyle: "Overlay"` + `hiddenTitle`），traffic 灯保持原生。（delta：`ui-design-system` / 应用骨架布局；`multi-tabs` / 标签栏的显示与形态）

4. **chrome 表面统一换新**：文件树（行高 25、层级缩进 8+14×层深、选中态、eink 黑底反白）、搜索面板、键位面板、大纲浮层、toast、vault 切换浮层——全部改吃新 token；hover/过渡统一 0.1s/0.12s 两档。行为 spec 不变，只换表皮。**周边表面（toc / vault 浮层、搜索面板、lightbox、键位面板、toast、空态等）在定稿图里没有直接呈现，处置方式是「换皮不改交互」：每个表面按 design §2.7 的类推映射表由已定稿组件样式 + token 组装，浮层 elevation 无类推依据的部分由 tokens v1.1 新增的 `--shadow-raise` / `--scrim` 兜底；基线重建批次包含每个周边表面的至少一张截图，随批次一并请你过目**（不新增裁决点）。（delta：`ui-design-system` / chrome 表面与动效纪律；`file-tree` / 全类型文件树展示）

5. **正文与内容类型样式**：编辑器渲染层（`src/preview/theme.ts` 等）全量改指新 token——标题层级（h1/h2/h3 sans 字重阶梯，宋体标题族随 `--font-display` 删除而退场）、表格、代码块、引用、列表、wikilink；语法高亮 `cm-lp-tok-*` 从借用 callout 色改指 `--tk-k/s/n/c`，与 callout 色解耦；**callout 13 类按 v1.2 映射收敛为五族语义色**（蓝 4 / 绿 2 / 琥珀 2 / 红 3 / 灰 2，色条 + tint 成对，红系补 `--danger-tint`；eink 色条全黑、底色全白，不引入图标，同族区分靠标题行文字；color-mix 现混色全部退场）；frontmatter properties 区块形态更新为定稿的 `.fm` 属性区（字段名 mono 11px 灰、值 13px、status 语义 chip、浅底圆角区置于文档顶部）。（delta：`editor-live-preview` / Markdown 渲染保真；`frontmatter-properties` / frontmatter 解析为 properties 区块）

6. **eink 降级规则落地**：tokens 文档 §eink 规则 的 9 条逐条实现——色彩退场、字重/明度承担对比、实心黑 hairline、选中态黑底反白（含组件内次级元素手工反白）、浅底区块翻白底黑框、chip 描边化、阴影退场、线宽即强调档、wikilink 药丸降级为下划线。（delta：`ui-design-system` / eink 降级规则）

7. **视觉基线全量重建**：既有 34 张基线（13 个快照目录）在本 change 后**必然全数变化**（底色、字体、栏宽全换）——重建作为**独立的、你逐张过目的显式批次动作**执行，禁止零碎 `--update`（纪律细节见 tasks §8）。（delta：`ui-design-system` / 视觉基线处置）

## 须提请 Alex 节点 1 裁决的选项

三项都给了推荐项；**节点 1 裁决已出（2026-09-24，D2 采纳备选），delta 与 tasks 已按裁决结果改写**，见表后裁决记录。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **编辑器基准字号**：`--editor-font-size` 出厂默认取 **15px**（定稿阅读表面的字号）还是保持 **16px**（typography-and-zoom 落地的配置默认）？ | **15px**：Lumir 的编辑器就是阅读表面（live preview 单内核），你批准的 6 张定稿图的密度、行高 1.7、列表与标题间距全部按 15px 调；16px 会让整套相对排版（标题 em、间距节奏）偏离批准稿。typography 的档位机制（×1.1、[12,32]、⌘= / ⌘− / ⌘0）不变，只是基准点从 16 挪到 15；反正基线全量重建，改默认零额外成本 | 保持 16px | 备选等于「批准的稿」与「出厂的样」不一致，且没有任何一个表面吃到定稿密度——除非你认为 15px 在真实 vault 的源码可读性上有顾虑（编辑器同时是码字表面，这是取 16 的唯一理由） |
| D2 | **callout 13 色的处置**：现行 `--callout-*` 13 色（米色系配色）与 brief 原则 4「4 语义色」冲突，tokens v1 明确不接管。本 change 内收敛还是维持现状？ | **维持现状**：callout 块保留旧色（随底色 token 迁移做最低限度适配，不改色相），收敛单独立项。如实写明代价：restyle 后 callout 是界面上仅存的旧色系，与新表皮并存在视觉上会突兀 | 本 change 内收敛为「4 语义色 + 灰」 | 收敛是一次独立的审美裁决（12 种 callout 类型各自有语义色，压到 4+1 要逐类定映射），混进来会把基线重建的核对难度再抬一档，且它不急——callout 不是高频表面 |
| D3 | **主题选择机制**：三主题怎么选？ | **`[ui] theme` 配置项**（`light` / `dark` / `eink`，默认 `light`），启动读一次、重启生效——与 `editor.mode` / 字体配置同口径，零新 UI、零运行期状态面 | A. `auto` 默认跟随系统（`prefers-color-scheme`）；B. 运行期命令切换（进键位表） | 备选 A 的实现本身便宜（WKWebView 支持 matchMedia），但「运行期主题会变」引入新的状态面：主题切换时的重测量、视觉基线口径（按哪个主题跑）、dogfood 时「我这是哪个主题」的归因成本。B 同理且多占一组默认键位。三主题的日常使用场景（eink 设备、夜间）在重启粒度上切换完全够用 |

**裁决记录（节点 1，2026-09-24）**：

- **D1 = 15px**（采纳推荐）：`--editor-font-size` 出厂默认 15px。
- **D2 = 本 change 内收敛**（采纳备选，**未采纳推荐**）：callout 13 类收敛为五族语义色，映射表与规则已落 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §callout 语义收敛（v1.2 增补）；样式可视化验收屏见 `design/prototypes/direction-c/?screen=6`（三主题各一屏）。
- **D3 = `[ui] theme` 配置**（采纳推荐）。

**未列入裁决面的硬约束**（写进 delta）：不改写源文件（ADR 0003 §3，本 change 只改显示）；不触碰性能合同（ADR 0002 §6，纯样式变更，无新解析、无新 IO）；配置即数据 + schema 校验（ADR 0002 §5，`[ui]` 表走既有 validate 模板）；**不做 agent 栏的任何像素**（右栏只有骨架预留位）；基线重建是你逐张过目的批次动作（AGENTS.md 硬规则）。

## capability 归属

**结论**：**宿主 = 新建 capability `ui-design-system`**；**配套 delta = `frontmatter-properties`（MODIFIED ×1）、`editor-live-preview`（MODIFIED ×1）、`multi-tabs`（MODIFIED ×1）、`file-tree`（MODIFIED ×1）**。

| 本 change 的条款 | 为什么落在这里 |
|---|---|
| token 层、三主题与选择机制、eink 规则、骨架布局、chrome 表面纪律、基线处置 | 这些是**跨 capability 的视觉合同**，没有现成的 living spec 居所（ADR 0006 §3 的单套排版基线今天只在 `src/style.css` 里）。新建 `ui-design-system` 并以 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) 为权威文本（spec 引用、不复制全文，照 perf-measurement 的先例） |
| properties 区块的形态更新（`.fm` 属性区） | 归 `frontmatter-properties`：该 capability 已有「frontmatter 解析为 properties 区块」requirement，本 change 改的是它的**形态条款**（键值表格 → 定稿属性区），解析、StateField 构建、性能纪律一字不动 |
| 语法高亮改指 `--tk-*`、标题族退场、内容类型样式 | 归 `editor-live-preview` 的「Markdown 渲染保真」requirement：它今天写着「token 色值 MUST 只取自既有 editorial token」——token 层整体替换，该条款必须同步改写，否则 living spec 与实现直接矛盾 |
| 标签迁入标题栏、tab 形态 | 归 `multi-tabs` 的「标签栏的显示与形态」：显示判据、dirty 点、关闭按钮等口径不变，位置与形态条款更新 |
| 文件树行形态（行高 / 缩进 / 选中态） | 归 `file-tree` 的「全类型文件树展示」：行为不变，补形态口径 |

成本如实记录：新建 capability 会在 archive 时由 CLI 写入占位 Purpose，需手写替换后再跑 validate（批次收尾 checklist 已记这条）。

## Non-goals

- **不做 agent 栏、屏 2/3 的任何功能与像素**：右栏只有骨架预留位（不渲染内容、不可交互）；`--agent-bg` / `--run` / `--pending` 等 agent 相关 token 随 token 层一并入库但**无消费者**——这是有意为之（tokens 文档已注明「随 agent 特性启用」），不作为「声明了没有消费者」的违规（REVIEW.md 第 9 条例外：设计系统的预留面，消费方是已立项方向的后续 change）。
- **不做 composer 位置变体、不做 serif 表皮**：`?composer=bottom` 与 `?body=serif` 是原型里的备查轴，不进实现。
- **不做跟随系统主题、不做运行期主题切换命令**（D3 推荐形态下）。
- **不做 callout 图标体系**：同族类型区分只靠标题行文字（v1.2 映射的刻意取舍），不引入图标。
- **不做窗口宽度自适应策略**：原型目标视口 1280×900，现行窗口 1200×800 不变；窄窗口下侧栏的行为（现行 1100px 以下 204px 的媒体查询随旧 token 一并删除）不在本版重设计，如实记录为已知边界。
- **不做原生整窗截图门禁**：本 change 引入 overlay 标题栏（tests/visual README 列为「触发重评的信号」），整窗截图场景单独立项评估，本 change 的真机证据走既有验收套件。
- **不改任何行为 spec 的功能语义**：键位、命令、配置字段（除新增 `[ui] theme`）、保存、watch、搜索、wikilink 等全部不动。

## Impact

- **影响的 specs**：**`ui-design-system`（新建）** —— ADDED ×6（设计 token 层 / 三主题与主题选择 / eink 降级规则 / 应用骨架布局 / chrome 表面与动效纪律 / 视觉基线处置）；**`frontmatter-properties`** —— MODIFIED ×1；**`editor-live-preview`** —— MODIFIED ×1；**`multi-tabs`** —— MODIFIED ×1；**`file-tree`** —— MODIFIED ×1。
- **影响的代码/系统**：
  - `src/style.css`：`:root` 全量重建（三主题块 + 五类非色 token）；
  - `src/shell.ts` / `src/main.ts`：骨架重构（标题栏 / modeline / 侧栏头 / masthead 移除 / dock 预留）、`[ui] theme` 启动施加；
  - `src/editor.ts` / `src/preview/theme.ts` / `src/preview/**`：渲染层 token 改指、tok-* → `--tk-*`、callout 13 类按 v1.2 映射换色（新增 `--danger-tint`，color-mix 现混退场）、frontmatter `.fm` 形态、内容类型样式、栏宽 80%→664px；
  - `src/tree.ts` / `src/search.ts` / `src/bindings-panel.ts` / `src/toc.ts` 等 chrome 表面：样式换新 token（行为零改动）；
  - `src-tauri/src/config.rs`：`UiConfig` 新表 +1 字段（validate 走既有模板）+ ts-rs 重新导出；`src-tauri/tauri.conf.json`：overlay 标题栏；
  - `tests/visual/scenes/**`：场景的主题注入与断言更新；`tests/visual/baselines/`：**34 张全量重建（独立批次动作）**；
  - `scripts/acceptance/`：`writeConfig` 扩 `ui.theme`、新增三主题与骨架的验收场景。
- **视觉基线**：34 张既有基线必然全数失效——重建是**独立批次动作，Alex 逐张过目后生效**（AGENTS.md 硬规则「基线更新是人肉裁决点」）；masthead 属「删除 UI 元素」，其出现过的所有整页基线须按视觉门禁卫生逐一核对（tests/visual/README.md §删除/移动 UI 元素后的核对）。
- **性能**：纯样式与布局变更；无新解析、无新 IO、无新增启动路径（`[ui] theme` 搭 `config_get` 既有的一次读取）。栏宽从百分比改定值是既有 CSS 网格的取值替换。不触碰 ADR 0002 §6 四条阈值。
- **关联约束**：ADR 0002 §5（配置即数据）、ADR 0002 §6（性能合同）、ADR 0003 §3（不改写源文件）、ADR 0004 §5（功能变更走 OpenSpec）、ADR 0006 §3（排版基线：本 change 替换它的默认值，配置机制不动）；brief 六原则与裁决记录（设计准绳）；tokens v1（值的唯一权威文本）。
