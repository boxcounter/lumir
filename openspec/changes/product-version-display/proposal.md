# Proposal: 标题栏常显产品名与版本号（Lumir · 0.0.0）

- Change ID: product-version-display
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

> **节点 1 裁决（2026-09-25，Alex）**：D1 右端 ✓ 采纳；**D2 改选备选**——窄窗（<640px）
> 版本号退 modeline 右段尾部，产品名留标题栏；D3 双档字重 ✓ 采纳。补充约束：版本号唯一
> 真源是 tauri.conf.json 的 `version` 字段，前端不留硬编码副本；补丁号由 Alex 人工 bump。
> specs delta / design §3.2 / tasks 已按裁决改写（D2 备选形态）。

Alex 原话（2026-09-25）：「显示产品名和版本号。」「常显示。放标题栏，但不知道标题栏能不能
放得下产品名加版本号，如果放不下，可以把它们拆开放在不同的地方。」版本号来源 =
tauri.conf.json。

dogfood 场景的直接价值：批次验收与问题上报时「我跑的是哪个构建」一眼可归因（与
live-theme-switch 的 modeline 主题指示同一类动机——常驻归因出口）；对预发布产品，
版本号常显也是「这是开发版」的持续提示。

## 现状调研（全部锚点可复核；实测证据在 `test-results/m225-probe/results/`）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | restyle 后标题栏结构 = 左端 traffic 灯占位 236px（`--layout-sidebar-w`，与侧栏对齐）+ tabstrip（`flex:1 1 auto`，tab 不收缩、溢出横向滚动）+ 右 padding 12px（`--sp-6`）。**本版没有右侧动作钮**——spec 口径是「预留槽位、零可见内容」 | `src/shell.ts:52-64`；`src/style.css:304-316`（.titlebar / .titlebar-traffic）、`:318-336`（.tabstrip）；`openspec/changes/restyle-ui-tokens-v1/specs/ui-design-system/spec.md`「应用骨架布局」 |
| 2 | tower 简报称「标题栏有 tab 栏、搜索钮、侧栏开关」——**与 master 实测不符**：搜索是 ⌘F 编辑器内面板（无标题栏按钮），也无侧栏开关钮；M217（`b4c29a6`）是 chrome 表面修复。本提案以实测为准 | `src/search.ts`、`src/search-panel.css`；`grep titlebar src/*.ts` 仅命中 shell.ts |
| 3 | 剩余空间实测（chromium + tauri 桩 + master tip `1e2aca2` 的 dist 构建；量测脚本与截图见证据目录）：空态 1200px 窗口空闲 **952px**；开 4 个标签（README.md 122 / LICENSE 100 / guide.md 104 / notes.txt 102，含 gap 合计 ≈446px）后：1200px 余 **506px**、800px 余 106px、700px 余 6px、**600px 起标签区开始横滚** | `test-results/m225-probe/results/measurements.json`；`titlebar-1200-empty.png`、`titlebar-{1200..520}-6tabs.png` |
| 4 | 候选文案渲染宽度实测（`--font-sans`）：「Lumir · 0.0.0」12.5px/550 = **77px**，11px/550 = 69px；「Lumir 0.0.0」（空格分隔）12.5px/550 = 70px。标识块含间距预算 ≈95px | 同上 measurements.json `textWidths` |
| 5 | 版本号链路现状：**前端没有任何现存 IPC 暴露产品名 / 版本号**（src/ipc.ts 全部命令无此项，getVersion/getName 零命中）；真源 `src-tauri/tauri.conf.json:3-4` = productName "Lumir" / version **"0.0.0"（占位值，bump 策略是另一个待裁决项，已登记 finding）**；`@tauri-apps/api` ^2.11.1 已在依赖，其 app 模块 `getName()`/`getVersion()` 是官方内置通道，所需 ACL 权限名在 schema 中存在（`core:app:allow-name` / `core:app:allow-version`）——**零新 Rust 命令**即可接通 | `src-tauri/tauri.conf.json:3-4`；`package.json:32`；`src-tauri/gen/schemas/desktop-schema.json`；`src-tauri/capabilities/default.json`（现有 3 条权限，无 app 族） |
| 6 | modeline 现状：25px，左「文件路径 › 大纲指示段」/ 右「语法 · 行数 · UTF-8」，字号 11px（`--fs-label`）、`--text-3`——它是拆分备选里版本号的落点 | `src/shell.ts:72-90`；`src/main.ts:585-613`；`src/style.css:438-498` |

**实测结论**：默认 1200px 窗口、常见标签数（≤6 个短名标签）下，标题栏放得下产品名 +
版本号一体块（余量 ≥5 倍）；临界出现在窗口 <~750px 且多标签时。因此**推荐一体放标题栏**，
「放不下就拆开」的 Alex 备选收窄为**窄窗退让策略**的裁决项（D2），而不是默认形态。

## What Changes

1. **标题栏右端常显标识块**（推荐方案）：标题栏在 tabstrip 之后新增右端标识块
   「Lumir · 0.0.0」，`flex: none` 不参与收缩；文案 = 产品名 + 版本号，启动时经
   `@tauri-apps/api/app` 的 `getName()`/`getVersion()` 读一次（与 tauri.conf.json 真源一致）。
   样式只吃 token（零新色值，三主题自然成立）。排版细节与窄窗退让见 design.md §3。
   （delta：`ui-design-system` / ADDED「产品名与版本号常显」）

2. **窄窗退让 = 标签区横滚优先，标识常显**（裁决点 D2 推荐项）：窗口变窄时既有行为
   （tabstrip `overflow-x: auto`）天然吸收挤压，标识块钉住不动、不截断——「常显示」是硬
   约束。实测 520px 窗口下标签区仍有 272px 可用，可滚动浏览全部标签。

3. **能力授权**：`src-tauri/capabilities/default.json` 增加 `core:app:allow-name` 与
   `core:app:allow-version` 两条只读权限；不新增 Rust 命令（被否决方案见 design.md §4）。

## 须提请 Alex 节点 1 裁决的选项

三项都给了推荐项，delta 与 tasks 已按推荐项起草；裁决改备选则按备选改写。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **落位**：标题栏右端还是水平居中？ | **右端**（tabstrip 之后）：确定性 flex 布局，与标签流无碰撞面；macOS  Overlay 标题栏下「居中标题」会与右滑增长的标签流争夺同一水平带，碰撞处理（截断哪边、何时让位）是纯增量复杂度 | 水平居中（macOS 传统标题位） | 居中的收益是平台惯例观感；代价是标签流与居中块的碰撞规则没有现成答案，且空态/多标签两种截图下重心漂移 |
| D2 | **窄窗退让**：标签横滚保标识，还是宽度阈值下版本号退 modeline？ | **标签横滚保标识**：「常显示」是 Alex 原话硬约束；tabstrip 的横滚行为已存在零新增机制；实测 520px 仍可用 | 窗口宽 <阈值（如 640px）时版本号退到 modeline 右段（拼进「语法 · 行数 · UTF-8」尾），产品名留标题栏——Alex 原话「拆开放在不同的地方」的响应式形态 | 备选的代价：版本号有两个展示位（写两处、读两处、测两处），且宽度跨越阈值时界面元素跳动；收益是极窄窗下标签区多 ~60px——横滚已经解决了这个问题 |
| D3 | **文案与字档**：「Lumir · 0.0.0」双档（产品名 12.5px/550/`--text-2`、版本号 12.5px/400/`--text-3`），还是其它组合？ | **双档 12.5px**：12.5 = `--fs-ui-s`，与同一行的标签文字同档（视觉对齐纪律）；产品名用 550「强调不粗」特征档承担识别度，版本号降色到 `--text-3` 退后；「·」分隔与 modeline 右段「语法 · 行数 · UTF-8」同构 | (a) 无分隔符空格「Lumir 0.0.0」；(b) 整体降到 11px（`--fs-label`，与 modeline 同档）；(c) 版本号加 `v` 前缀 | (a) 失去与 modeline 的同构；(b) 与同行标签差一档，基线不齐；(c) 「0.0.0」已是 semver 形，`v` 前缀是冗余装饰（原则 3） |

## Non-goals

- **不做关于面板 / 关于菜单项**：本 change 只有常显标识块；点击行为、版本详情页、
  更新检查全部不在范围。
- **不改 tauri.conf.json 的版本号取值 / bump 策略**：当前值 "0.0.0" 会如实显示；
  「版本号何时开始真实递增」已登记 finding 待裁决，不随本 change 落地。
- **不新增 Rust 命令**：版本号获取走 `@tauri-apps/api/app` 内置通道（design §3.3）。
- **不动 token 层**：零新色值 / 零新字号 / 零新间距档——全部吃 design-tokens-v1 现行值。
- **不占标题栏右侧动作钮预留槽位的语义**：标识块是「常显信息」不是「动作钮」；
  未来动作钮接入时与标识块并存（间距规则在 design §3.1 预留）。
- **不做运行期版本号刷新**：版本号构建期固化，启动读一次即可，不监听任何变化。

## Impact

- **影响的 specs**：**`ui-design-system`** —— ADDED ×1（产品名与版本号常显）+
  MODIFIED ×1（应用骨架布局：标题栏三段式补标识块、「空态的标题栏」场景表述同步）。
  **归档顺序约束**：`ui-design-system` 的 living spec 尚未归档（restyle-ui-tokens-v1 已实现、
  待节点 2），`validate --strict` 通过但提示「ADDED 要求目标 spec 已存在」。**本 change
  必须在 restyle-ui-tokens-v1 归档之后归档**（与 live-theme-switch 同约束、互无序）；
  实现与评审不受影响。
- **影响的代码/系统**（实现 mission 照 design §3 的锚点施工）：
  - `src/shell.ts`：标题栏右端标识块容器；`src/style.css`：标识块样式（token 取值）；
  - `src/main.ts`：启动时装配（getName/getVersion → 写 DOM，失败降级口径见 design §3.3）；
  - `src-tauri/capabilities/default.json`：+2 条只读 ACL；
  - `tests/visual/scenes/`：结构层断言场景（标识块在场、文案形态、三主题计算样式）；
  - `scripts/acceptance/scenarios/`：新增真机验收场景 **39**（编号接 38-content-width-drag）。
- **性能**：启动时两次 app 元信息 IPC（getName/getVersion，µs 级本地调用）+ 一次性 DOM
  写入；运行期零轮询、零重算。不触碰 ADR 0002 §6 四条阈值。
- **关联约束**：ADR 0002 §6（性能合同）；REVIEW.md 第 8 条（产品名 / 版本号真源唯一 =
  tauri.conf.json，前端不留第二份硬编码副本）；design-tokens-v1 收敛规则 1（色彩零新增）
  与字档纪律（550/650 以外不许自造中间字重）。
- **证据目录**（git 外，本地留存）：`test-results/m225-probe/results/`（量测 JSON + 8 张
  标题栏截图 + 探针脚本 `test-results/m225-probe/titlebar-space.spec.ts`）。
