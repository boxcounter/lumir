# Proposal: 主题运行期切换——命令 + 快捷键 + modeline 入口，免重启即时生效

- Change ID: live-theme-switch
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话「增加 theme 切换选项」（2026-09-25），澄清后确认为：加 UI 切换入口（状态栏 / 快捷键 /
命令），**免重启即时切换**。非目标已确认：不做跟随系统主题、不新增主题。

现状（restyle-ui-tokens-v1 已落地）：

| # | 事实 | 锚点（可复核） |
|---|---|---|
| 1 | light / dark / eink 三主题共用一套 token 名，经 `<html data-theme>` 属性切换取值；`[ui] theme` 配置在启动装载时读一次并施加，重启生效 | `src/main.ts:980`；`src/style.css:15/50/89`（三组 `:root[data-theme]` 块）；`src-tauri/src/config.rs:426-436`（validate） |
| 2 | 「重启生效」是 restyle 节点 1 裁决 D3（2026-09-24）的采纳项：当时否决了备选 B「运行期命令切换」 | `openspec/changes/restyle-ui-tokens-v1/proposal.md` 裁决点 D3 与裁决记录 |
| 3 | 调研实证：全部着色面（token 层、chrome 表面、CM 编辑器主题、两路语法高亮、KaTeX、搜索高亮）都经 CSS 变量取色，改 `data-theme` 属性即整体跟随，**无需重测量**（字体 / 字号不随主题变）；唯一不跟随的是 mermaid 已渲染 SVG（颜色烧进内联样式） | 逐子系统锚点见 design.md §1 与 §2 |
| 4 | 配置写回机制已有先例：`write_last_vault` 的「合并既有 JSON + tmp+rename 原子写 + 失败降级为 warning」模板可直接复用于 `[ui] theme` | `src-tauri/src/commands.rs:380-420` |

## 对既有裁决的修订（restyle 节点 1 裁决 D3）

**本 change 显式修订 D3**：保留其「`[ui] theme` 配置是启动真源、取值闭集合、非法回落 light」
的部分，**推翻其「重启生效 / MUST NOT 引入运行期切换」的部分**——运行期切换命令正是 D3 当时
的备选 B，本次由 Alex 的新需求（免重启即时切换）重新启用。

D3 否决备选 B 的三条理由，逐条对照本次调研结论：

1. 「运行期主题会变引入重测量与视觉基线口径问题」——调研证伪前半句：着色全部经 CSS 变量，
   切换 `data-theme` 不触发字体 / 布局重测量（三主题共享同一套非色 token）；后半句由口径消解：
   视觉基线与门禁照旧按桩注入固定主题跑，切换命令不进基线场景（与现状一致，基线口径不变）。
2. 「多占一组默认键位」——本提案确实占用一组默认键位（⌘⇧T），这是 Alex 本次点名要的入口
   形态之一，占用是有意的、经裁决的。
3. 「三主题的日常使用场景在重启粒度上够用」——被 2026-09-25 的新需求直接推翻。

D3 理由中仍成立、由本提案接续解决的一条：「dogfood 时『我这是哪个主题』的归因成本」——由
modeline 的主题指示钮消解（当前主题名常驻可见，同时是切换入口）。

## What Changes

1. **运行期切换命令 `view.theme-cycle`**：循环 light → dark → eink → light；进统一键位表
   （global 作用域），默认键位 ⌘⇧T（推荐项，见裁决点 D2），`[keys]` 可重绑 / 解绑，键位面板
   如实列出。命令实现的切换路径与启动施加共用同一施加点（`data-theme` 写入收敛为一个函数）。
   （delta：`keymap-commands` / ADDED「主题切换命令（view.theme-cycle）」）

2. **modeline 主题入口**：modeline 右段新增主题指示钮（button，文案 = 当前主题名），点击 =
   循环切换，与 `view.theme-cycle` 走同一条命令路径。它同时是「当前主题」的常驻归因出口
   （接续 D3 的遗留理由）。样式按 chrome 表面纪律吃 token（eink 下 chip 描边化），零新色值。
   （delta：`ui-design-system` / MODIFIED「三主题与主题选择」）

3. **免重启切换的行为定义**：切换 = 同步改写 `data-theme`，token 层 / chrome / CM 主题 / 语法
   高亮 / KaTeX 即时跟随（零 JS 重建）；**mermaid 已渲染 SVG 按新主题重渲染**——切换时使渲染
   缓存与 initialize 态失效，各 mermaid 块回到既有 pending 占位、经串行队列重渲后 settle
   （复用既有三态 widget，不引入新状态机）；配置写回 `[ui] theme` 在切换时立即执行，写回失败
   不阻塞切换：运行期主题保留 + toast 告知「重启后将回到配置文件值」。
   （delta：`ui-design-system` / MODIFIED「三主题与主题选择」）

4. **配置写回通道**：**（实现期修正，2026-09-26，M237；Alex 节点 1 的裁决口径）不新增 Rust
   命令**——直接复用 M228（change content-width-drag）已落地的**通用合并写 IPC**
   `config_set_ui_value`（`src-tauri/src/commands.rs:449-483`：serde_json::Value 级合并、保留未知
   键、tmp+rename 原子写、失败 `CommandError`、ACL 与 invoke handler 清单沿用既有那条）。原稿
   「新增 `config_set_ui_theme`，照 `write_last_vault_to` 模板」是 M228 落地**之前**的口径；同一条
   语义不留两套写通道（REVIEW.md 第 8 条）。前端不等写回结果、失败降级为 toast 的口径不变。
   配置即数据（ADR 0002 §5）不变：配置文件仍是启动真源，写回只是让真源跟上运行态。

## 须提请 Alex 节点 1 裁决的选项

三项都给了推荐项，delta 与 tasks 已按推荐项起草；裁决改备选则按备选改写。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **命令形态**：一条循环命令还是直达命令？ | **一条 `view.theme-cycle`**（light→dark→eink 循环）：三档循环是单键最低成本，且命令层没有参数通道（tab.goto-1..9 是把序号烙进 id 的无奈先例，不为三档再复制一次） | 三条直达命令 `view.theme-light/dark/eink`（或 cycle + 直达并存） | 直达的价值是「一键到 eink 不管当前在哪」；代价是三个 id 三条默认绑定（或三个 keyless 命令），键位面与面板行数膨胀——主题切换是低频动作，循环一次最多按两下 |
| D2 | **默认键位**：给 `view.theme-cycle` 绑 ⌘⇧T，还是默认不绑键？ | **绑 ⌘⇧T**：Alex 点名「快捷键」是入口形态之一；⌘⇧T 三条独立来源零冲突（表内 ⌘⇧ 系现有 ⇧⌘Z 重做、⇧⌘O toc.toggle 两条，⌘⇧T 不在其中；muda 预置 accelerator 集合无此项；macOS 系统级不占用——实现期按 keymap-commands 的三来源格式复核写入）。⌘ 系归 mac 惯例、语义取「T = Theme」 | 默认不绑键（进 `KEYLESS_COMMAND_IDS`，照 M180 折行开关先例，用户经 `[keys]` 自绑） | 备选的代价：Alex 点名的「快捷键」入口出厂不可用，等于把裁决点推回给用户配置；主题切换没有 M180 折行那种「各人口味分裂、不敢替人选键」的顾虑 |
| D3 | **配置写回**：切换即写回 `config.json` 的 `[ui] theme`，还是运行期不落盘？ | **切换即写回**（照 `write_last_vault` 模板，失败降级为运行期生效 + toast）：配置文件是启动真源，不写回则运行态与文件分叉——「config 写 dark、界面是 light」正是 D3 想消灭的归因混乱；主题是设备 / 场景级选择（eink 设备、夜间），用户预期它粘住 | 运行期不落盘（照 typography D5 字号步进 / M180 折行开关的「应用运行级」纪律） | 备选的依据是 typography D5 先例，但字号 / 折行是**会话内观感微调**，主题在两处不同：它有既有配置字段占着启动真源，且切换入口（modeline 常驻指示）让分叉持续可见——分叉成本高于先例 |

## Non-goals

- **不做跟随系统主题**（`prefers-color-scheme`）：用户明确的非目标；eink 没有系统级对应物，
  配置面少不了，自动跟随是纯增量复杂度（restyle design §3 的否决理由原样成立）。
- **不新增主题**（用户明确的非目标）：三档闭集合不变，取值校验不动。
- **不做设置面板 / 偏好 UI**：入口就是命令 + 快捷键 + modeline 三件套，不引入新的设置表面。
- **不改 token 值、不动视觉基线口径**：零色值新增 / 调整；视觉门禁与基线照旧按桩注入固定
  主题运行，切换命令不进基线场景。
- **不修 code 模式语法高亮在 eink 下 keyword 字重档的既有缺口**（在案 backlog 项，
  `src/editor.ts:1004-1007` 自述）：该缺口两侧都经 `var(--tk-*)` 取色，与切换无关，切换不会
  让它变好或变坏。
- **不为 mermaid 做 CSS 变量化后处理**：已渲染 SVG 的处置只有「失效重渲」一种（design §3
  被否决方案），不改 mermaid 的渲染管线。

## Impact

- **影响的 specs**：**`ui-design-system`** —— MODIFIED ×1（三主题与主题选择：删「MUST NOT
  引入运行期切换」，增运行期切换 / modeline 入口 / mermaid 重渲 / 写回条款）；
  **`keymap-commands`** —— ADDED ×1（主题切换命令 view.theme-cycle）。
- **归档顺序约束**：`ui-design-system` 的 living spec 尚未归档（restyle-ui-tokens-v1 已实现、
  待节点 2），`validate --strict` 通过但提示「MODIFIED 要求目标 spec 已存在」。**本 change
  必须在 restyle-ui-tokens-v1 归档之后归档**；实现与评审不受影响。
- **影响的代码/系统**（实现 mission 照 design §1 的锚点施工）：
  - `src/main.ts`：切换命令实现与装配、启动施加收敛为单一 `applyTheme` 函数、写回调用与
    失败 toast、modeline 指示维护；
  - `src/shell.ts`：modeline 右段主题钮容器；`src/keys.ts`：命令 id + ⌘⇧T 绑定；
  - `src/preview/mermaid.ts`：主题失效出口（渲染缓存与 initialize 态按主题世代失效）；
  - `src-tauri/src/commands.rs` / `config.rs`：**实现期修正**——不新增 `config_set_ui_theme`
    命令，复用 M228 的通用合并写 IPC `config_set_ui_value`（见 What Changes 第 4 条）；只需改
    `UiConfig` 的 doc comment 并 ts-rs 重新导出（`src/bindings/UiConfig.ts` 的「重启生效」自述随之刷
    新）。
  - `src/theme.ts`（新增）：主题域的纯逻辑——三档循环序、当前主题读取、两条可见文案；
  - `src/style.css`：modeline 主题钮的 chip 样式（样式居所是 style.css，M237 的 scope 已按裁决补入）；
  - `tests/visual/scenes/`：新增三主题切换场景（结构层断言）；
    `scripts/acceptance/scenarios/`：新增真机验收场景。
- **性能**：切换是 O(1) 的 DOM 属性写入 + mermaid 重建走既有串行队列与有限 settle；无新
  解析、无新 IO（写回复用既有配置写通道）。不触碰 ADR 0002 §6 四条阈值。
- **关联约束**：ADR 0002 §5（配置即数据）、ADR 0002 §6（性能合同）、ADR 0003 §3（不改写
  源文件：装饰层照旧只改视图）、ADR 0006（Emacs keybinding PKM 定位——命令 + 快捷键是本命
  入口，modeline 入口是补充）、REVIEW.md 第 8 条（施加点收敛为一处，不留第二处真源）。
