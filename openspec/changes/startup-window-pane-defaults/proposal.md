# Proposal: 启动窗口几何与 pane 默认比例的默认值对齐

- Change ID: startup-window-pane-defaults
- 日期: 2026-10-10
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 原话（2026-10-10）：「Content pane:Harness pane 也默认为 1:1（之前是 2:1），也就是双 pane 默认就是 1:1，不论 pane #2 是 content 还是 harness。」「App 启动后，窗口大小设置为全屏的 90%。」补充裁决（2026-10-10）：「只有首次启动 90%，之后记住我的尺寸」。

两件事都属于「启动期的默认值」，且都牵着一处**多处重述的真值**：

1. **窗口几何没有默认值，也没有记忆**。窗口尺寸写死在构建配置 `src-tauri/tauri.conf.json:16-17`（`1200×800`，无位置字段），启动时的尺寸对任何屏幕都一样、也不随用户调整而变化——用户每次启动都要手动拉一次窗口。
2. **harness 自动分栏的默认宽度比是 1:2，且这个值在 5 份 living spec 里被重述**（`pane-layout` 的「harness pane」是定义处，`harness` 的「对话面板」、`ui-design-system` 的「应用骨架布局」、`keymap-commands` 的「对话面板唤起命令」、`vault-workspace` 的「按 vault 持久化 pane 布局」各处复述）。实现处只有一处：`src/main.ts:683` 的 `HARNESS_DEFAULT_DOC_RATIO = 2/3`（`splitRatio` 记的是**文档侧**占比，2/3 即 harness:文档 = 1:2）。同文件的 `pane-layout.ts:57` 与 `vault_session.rs:47` 的 `DEFAULT_SPLIT_RATIO = 0.5` 是 `pane.split`（双文档 pane）的初值，本就是 1:1，本次不动——**两个默认值不是同一件事**，这正是 Alex 原话里「不论 pane #2 是 content 还是 harness」要合并的地方：合并后 `harness.toggle` 的自动分栏与 `pane.split` 的初值同为 1:1。

## What Changes

每条对应 specs/ 增量中的一个 requirement。

1. **首启窗口几何**（`app-window`，ADDED）：无窗口几何存档时，主窗口尺寸 SHALL 为**当前工作区**（窗口所在显示器的可用区域——macOS 上即排除菜单栏与 Dock 的 `visibleFrame`）的 90% 并居中；窗口 MUST NOT 越出工作区。工作区不可得时回落构建配置的占位尺寸、不阻断启动。
2. **窗口几何的持久化与恢复**（`app-window`，ADDED）：窗口的**尺寸与位置**持久化到 `<config>/lumir/window-state.json` 独立小文件（与 vault-sessions / reading-positions 同惯例，MUST NOT 新增 config.json 配置键）；非首启时首帧即以存档几何出现（MUST NOT 先以占位尺寸出现再跳变）；存档缺失 / 损坏 / 版本不符一律等价于「没有存档，按首启规则」；存档几何在窗口所在显示器上解读，显示器布局变化致存档矩形与任一工作区无交集时回落首启规则（MUST NOT 把窗口放到屏外）；尺寸与位置以逻辑像素（点）落盘。写入时机 = 变化后（可防抖）+ 退出前 flush。
3. **harness 自动分栏默认宽度比 1:1**（MODIFIED ×5：`pane-layout` 的「harness pane」为 canonical 定义处，`harness` 的「对话面板」、`ui-design-system` 的「应用骨架布局」、`keymap-commands` 的「对话面板唤起命令」、`vault-workspace` 的「按 vault 持久化 pane 布局」各处复述一并改值）：`HARNESS_DEFAULT_DOC_RATIO` 由 2/3 改 1/2，harness:文档 = 1:1。**只有本 vault 无存储比例时生效**的既有语义不变（见裁决点 ②）。
4. **重述面收敛**（随 3 一并做，implementation 面）：代码注释（`src/main.ts:681`、`:773`）、文案表 D345 正文（`文案-Copy.md` + `src/copy-data.ts`，zh/en 双档）、视觉场景 `tests/visual/scenes/m303-harness-panel.spec.ts` 的宽度比断言、验收场景 `scripts/acceptance/scenarios/86-harness-pane-toggle.md` 的判据与注释——凡写「1:2 / 2:1 / 文档侧 2/3」处一并改准。已在 git 里的 `openspec/changes/archive/**` 是历史留档，不回改。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 窗口记什么 | A. 只记尺寸；B. 尺寸与位置都记 | **倾向 B**——只记尺寸会每次丢弃「窗口被我挪到副屏 / 屏幕某个角落」这一半信息，而位置恢复正是 macOS 多显示器下的主要痛点；代价是恢复时要多做一次「显示器布局是否已变」的校验（见 What Changes 2 与 design §5） |
| 2 | 已存分栏比例的 vault 是否受新默认影响 | A. 不受影响（默认只在无存储值时生效）；B. 新默认覆盖存量 vault | **倾向 A**——B 会把用户手动拖过的比例在升级后静默重置；「默认值」的语义本就只在首见某 vault 时生效，维持现状语义、只换数字 |
| 3 | 窗口几何的 capability 归属 | A. 新建 `app-window`；B. 并入 `ui-design-system` 的「应用骨架布局」 | **倾向 A**——OS 窗口的生命周期与几何（首启规则、跨显示器校验、独立存档文件）不是设计 token / 骨架几何那一层的事，并入会稀释 `ui-design-system` 的 Purpose 与归档面；B 的支持点是该 capability 已讨论过「窗口宽 < 640px 退让」，但那是**给定窗口尺寸下**的响应式规则，不是窗口自身的尺寸来源 |

## Non-goals

- **全屏 / 最大化 / 最小化状态的记忆**：只记常规窗口的尺寸与位置；用户按绿灯进全屏后的状态不入盘、下次启动仍按常规几何。
- **引入 tauri-plugin-window-state（第三方插件）**：插件有自己的存储位置与文件格式（`<app-config>/window-state.json` 走它自己的 schema 与「每窗口标签一文件」形状），与本仓「配置即数据 / 独立小文件 / tmp+rename / 版本不符即无历史」这套既有纪律不齐，且它的多显示器处理口径不可控；本 change 自建 ~50 行的小模块，与 `reading_position.rs` 同形。
- **把窗口几何写进 config.json**：易变界面状态不混进身份 / 配置文件（`vault_session.rs` 文件头的既有裁决理由），也不给它加配置键。
- **`pane.split`（双文档 pane）初值改动**：`DEFAULT_SPLIT_RATIO = 0.5` 本就是 1:1，本次不动；本 change 只对齐 `harness.toggle` 的自动分栏默认值。
- **分栏比例的持久化语义改动**：`pane_split_ratio` 仍是 per-vault 布局数据、仍只在无存储值时用默认值——本 change 只改默认值这一个数字。
- **窗口几何的 per-vault 区分**：窗口是应用级单份状态，切 vault 不改窗口几何。
- **新增命令 / 键位 / 文案条目**：窗口几何无用户可见手势（用户就是拖窗口），不加命令、不加键位；pane 比例改值不新增文案。
- **`config.json` 增键**：本 change 不新增任何配置键。
- **窗口尺寸的最小值闸门**：当前构建配置未声明 `minWidth` / `minHeight`，本 change 不新增（见 design §10 开放问题）。

## Impact

- 影响的 specs：`app-window`（ADDED ×2：首启窗口几何 / 窗口几何的持久化与恢复）；`pane-layout`、`harness`、`ui-design-system`、`keymap-commands`、`vault-workspace`（各 MODIFIED ×1，均为 1:2 → 1:1 的值改准）
- 影响的代码/系统：src-tauri（`tauri.conf.json` 的窗口尺寸降级为占位 + `visible: false`；`lib.rs` 的 `setup` 与 `RunEvent::Exit` 接线；新模块 `window_state.rs`——配置目录小文件 + tmp+rename + 版本纪律，与 `reading_position.rs` 同形）、src（`main.ts` 的 `HARNESS_DEFAULT_DOC_RATIO` 与两处注释）、文案表（D345 正文 zh/en 同步 `文案-Copy.md` 与 `src/copy-data.ts`）、tests/visual（`m303-harness-panel.spec.ts` 的宽度比断言）、scripts/acceptance（场景 86 的判据与注释）
- 关联约束：ADR 0002 §5（配置即数据、逐字段校验、非法值回落默认）；ADR 0002 §6（冷启动 <300ms——几何施加只多一次本地小文件读 + 一次 `set_size`/`set_position`，MUST NOT 引入同步重活）；ADR 0003 §3（不改写源文件）；仓库信息卫生（验收 / 视觉 fixture 全合成，窗口几何属本机状态不入 git）

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：无需埋点——`window-state.json` 的 mtime 与内容就是使用痕迹；dogfood 期 agent 看该文件是否随用户拖窗口而变化即可。
- **怎么知道它有效**：主判 Alex dogfood 手感（启动后是否还需要手动拉窗口）；辅判（可机械取）——连续两次启动之间 `window-state.json` 的尺寸/位置与上次退出时一致。
- **出问题怎么发现**：机器面兜底——`window_state.rs` 的解析 / 校验 / 版本判定 / 几何回落单测（纯函数层，注入目录与显示器矩形，不碰真实配置目录与真实屏幕）+ 真机验收场景（首启 90% 居中、二次启动恢复、存档损坏回落）+ 视觉层不涉及（窗口几何不进 chromium 视觉场景）。写失败 / 回落的用户可见面：不弹窗、只记 warning（与既有落盘纪律同）。
