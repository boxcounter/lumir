# Evidence: add-first-run-onboarding-nov25

本文件是提案期的证据说明，不是 living spec。所有行号取自本 change 的基线 worktree：

- 仓库：`lumir` 主仓
- worktree：`.local/worktrees/nov25/first-run-onboarding`（相对主仓，git 外）
- 基线：`origin/master` @ `ab7d6b1b`（2026-11-25；本地 master 落后于 `origin/master`，故直接以
  `origin/master` 建分支）
- 分支：`feat/first-run-onboarding-nov25`
- 只读调研原卷：会话任务目录下的 `output.log`（git 外，不落库；路径见提交说明 / tower 会话）

## 1. 现状落点

| 面 | 落点 | 现状口径 |
|---|---|---|
| 启动态首帧 | `src/boot.ts:50` 读配置；`:63` `mountStartupSurface`；`:67` 才装载主模块 | 首帧前读一次配置；启动面是 `#startup` 窗口级节点 |
| 启动态结构 | `src/startup-surface.ts:61` 挂载；`:79` 骨架侧栏；`:90` 内容列；`:102-107` 唯一 D6 按钮 | 骨架 + 产品标记 + 阶段行 + 「打开 vault」 |
| 启动态布局 | `src/startup-surface.css:32` `.startup-body` 两列；`:76` `.startup-content` 在内容列居中 | 按钮中心是「侧栏右侧内容列的中心」，不是整窗中心 |
| 撤下判据 | `src/startup-gate.ts` `startupDismissReason` | `degraded` / `tree_ready` / `no_vault` / `timeout` 四选一 |
| 未打开终态 | `src/main.ts:4571` `refreshVaultStatus`；`src/main.ts:4585` | `startup?.notifyNoVault(); tree.showEmpty(status.notice)` |
| 树空态 | `src/tree.ts:1526` `showEmpty`；`:1540` 起建 `.ft-empty` | 左栏 D5 说明 + D6「打开 vault」按钮 |
| 空 vault 首入态 | `src/main.ts:1724` `showEmptyVaultState` | `.editor-notice` 覆盖层：D107 + D882「新建笔记」 |
| 覆盖层几何 | `src/main.ts:1689` 挂 `shell.editorRow`；`src/style.css:1406` 起 | `position:absolute; inset:0` + 不透明底，盖住整条 pane 行（含 harness） |
| 空 pane 引导门 | `src/main.ts:650` `renderAllTabStrips`；`src/main.ts:678` | `guideEl.hidden = !emptyPaneGuideVisible(...)` |
| 空 pane 判据 | `src/pane-layout.ts:91` `paneBlocksInput`；`:103` `emptyPaneGuideVisible` | 分栏 + 无带路径标签 + 前台非 dirty + 已装载 vault |
| harness 打开 | `src/main.ts:890` `openHarnessPane(focusComposer = true)` | 分栏 + attach + 可选聚焦 + `switcher.sessionChanged()`（`src/main.ts:902`） |
| harness 空快照 | `src-tauri/src/harness.rs:2324` `harness_state`；`:593` `StateSnapshot::empty` | 无会话返回空快照，纯读 |
| preflight | `src-tauri/src/harness.rs:1787` / `:2046` | 只在 `harness_send` / `harness_cron_run`，建会话之前 |
| 配置快照 | `src/bindings/AppConfig.ts`；`src/config-handoff.ts` | `ConfigSnapshot.config.last_vault: string \| null`；一次性交接 |
| 文案 deck 末位 | `src/copy-data.ts:2985` D1028；`文案-Copy.md:1006` | 当前末位 **D1028**，不是调研时的 D991 |
| 验收覆盖表末位 | `scripts/acceptance/COVERAGE.md` 末行 | 876 已占用；下一个空号 **877** |

## 2. 调研结论的采信与更正

采信：

- 首启判据用 `config.last_vault === null` 的启动快照，零新增 IPC；必须在打开首个 vault 前取值。
- 老用户空 vault 保持 D107 + D882；首启才替换。
- tips 挂 `shell.editorPane`，不挂 `shell.editorRow` 的 `.editor-notice`（后者盖 harness）。
- 默认 harness 用 `openHarnessPane(false)`；不抢焦点、不建 JSONL、不发 preflight；`harness_pane`
  布局位照常落盘，用户收起后不再自动展开。
- tips 不放关闭钮；注「默认键位」并以 `⌘/` 为出口。
- 首启判定不复算；不新增持久化引导字段。

更正 / 本提案的取舍：

- 调研给出的验收场号 876 已被 `876-harness-web-production-no-injection` 占用；本提案取现场
  下一个空号 877（实现前再核）。
- 调研给出的文案 deck 末位 D991 已过时；当前末位 D1028（`src/copy-data.ts:2985`、
  `文案-Copy.md:1006`）。实现取号接 D1028，不预占。
- 调研建议 tips 用「隐藏活跃编辑器 DOM」的副作用；本设计改为「不透明覆盖 + 结构性只读」，
  不 `display:none` 编辑器（避免恢复时 CM 重新测量），并在 `renderAllTabStrips` 的
  `setSessionEditable` 上追加 tips 门，避免键入落进被遮住的草稿。
- **不新增 `#first-run` 首启屏模块**：Alex 明确「现有启动屏只有唯一主操作，重点修居中与纯启动屏
  层级，不额外加按钮」。本设计复用既有 `#startup`，加 `startup-first-run` 模式；不新增第二个
  启动面 / 按钮。调研未覆盖启动态居中与撤下规则，本提案补上。

## 3. 规格冲突与 delta 归属

| living spec | 冲突句 | 处置 |
|---|---|---|
| `app-startup`「启动态的上屏与撤下」 | 未打开终态 Scenario 撤下到既有空态；安全阀超时撤下 | MODIFIED：首启模式不因 `no_vault` / 超时撤下，只在树就绪 / 降级撤下；非首启逐字不变 |
| `app-startup`「启动态的内容与视觉口径」 | 启动态 SHALL 由骨架 + 产品标记 + 阶段行三部分构成 | MODIFIED：首启模式只由唯一居中「添加 vault」主操作构成；非首启三部分与既有条款逐字保留 |
| `vault-workspace`「vault 切换器入口与列表浮层」 | 「未装载 vault 时……空态沿用既有 D5 / D6 文案与入口」 | MODIFIED：D5 / D6 限定非首启；首启由启动态首启模式承接，仍无列表入口 |
| `file-tree`「未打开 vault 空态」 | 「无打开的 vault 时，文件树 pane SHALL 显示空态与打开入口」 | MODIFIED：非首启 scope；首启不呈现树空态 |
| `pane-layout`「harness pane」 | 「harness pane 的打开 SHALL 由 `harness.toggle` 承担」 | MODIFIED：首启初始布局是唯一例外；只发生一次、不是用户可触发的第二通道 |
| 新 capability | 无既有承载 | ADDED `first-run-onboarding`：判定与作用域 / 工作区初始构成；首启进入面引用 `app-startup`，不重复布局条款 |

`vault-workspace`「装载后恢复标签列表」的「全部标签都不可用时呈空 vault 首入态（标签栏隐藏 +
一句引导）」不另改：首启 tips 是该「一句引导」在首启下的具体形态，由新 capability 细化；
非首启仍是 D107。`file-tree`「目录下新建」里提到「空 vault 的『新建笔记』按钮」也不另改：该入口
在非首启空 vault 仍存在，条款继续成立；新 capability 只限定首启。

## 4. 测试 / 基线影响

- **视觉桩**：`tests/visual/scenes/tauri-stub.ts:589` 的 `config_get` 恒写 `last_vault: null`。
  若不修，所有带 fixture 的视觉场景、以及 `m645-startup-surface` 的恢复态都会被
  `firstRun` 判成首启模式。修法：`VaultFixture` / `stubTauri` 支持 `lastVault`（含无 fixture 的
  非首启空态）；**缺省值复用 `vault_current` 的同一 root 派生与 fallback**：
  `current === null ? null : (current.lastVault !== undefined ? current.lastVault :
  (current.root ?? "/Users/alex/demo-vault"))`；`stubTauri(page, null)` 仍为 `null`（真首启）。不能只写
  `current.root ?? null`——`root` 可选，`m831` 等 fixture 不写 root，实际根回落到
  `/Users/alex/demo-vault`（`tauri-stub.ts:428`、`:720`）。补桩测试「fixture 省略 root ⇒
  非首启」，并反向验证改回 `current.root ?? null` 时必红。
- **受影响的 `stubTauri(page, null)` 场景**（必须逐个核对是否要旧无 vault 工作区）：
  `app-main`、`toc-outline`、`quick-open`、`m293-eink-literal-tokens`、`m149-tabs`、
  `first-run-empty-state`、`startup-restore`、`m831-harness-composer-codemirror`。
- **`m645-startup-surface`**：`RESTORING` 场景要显式给非 null `lastVault`，保持既有骨架 /
  产品标记 / 阶段行断言；另加首启模式用例。
- **`first-run-empty-state.spec.ts`**：第一段（`stubTauri(page, null)`）从 `.ft-empty` 改为
  `#startup.startup-first-run` + 唯一「添加 vault」按钮 + 中心几何；第二段拆成老用户
  （`lastVault: root`）→ D107 + New note，与首启（`lastVault: null` + fixture vault）→ tips +
  harness + 无 D107 / New note。
- **`app-main.spec.ts` 第一条**：`stubTauri(page, null)` 现在落到首启模式；若要保留旧空态基线，
  改为非首启的失效 `lastVault`；真首启另立用例与基线。
- **基线**：`app-main` / 首启模式 / tips 会变或新增。按 AGENTS.md，`--update` 前截图须 Alex
  过目；本提案不重录。
- **验收**：263 第一段改首启模式；877 新增。原生 `NSOpenPanel` 不驱动（README 已知边界）；
  为表达「选中首个 vault」的终态，需仅验收环境生效的 `vaultOpenPath` 动作；该动作必须复用
  `switchToVault(path)` 完整链路（`loadUserVault → vaultOpenPath → applyVault`），不能只调
  `vault_open_path`。桥接仅 DEV + 验收注入，普通 dev 无桥 / 端点 404，`pnpm build` 后
  `dist/assets/*.js` grep 桥接标记为 0。877 的老用户回归须先关标签与 harness、等布局落盘再
  重启；`configWrite` 自带 restart，不得叠加。无 JSONL 用目录级 `glob exact: 0`，不用
  `file.count: 0`。
- **单测 / 视觉**：首启谓词、启动面首启模式（不建侧栏 / 标记 / 阶段行；`no_vault` / 超时不
  撤下；`tree_ready` / `degraded` 撤下）、命令闸门（默认 / 重绑 / 原生菜单；`Cmd-,` /
  `Cmd-Shift-A` / `Cmd-/` 无 overlay / IPC / 布局副作用；`#app.inert` 撤下后为 false）、
  首启资格在 `applyVault` 入口领取（恢复标签后切空 vault、快速切换竞态）、tips 键位对账
  （从 `KEY_BINDINGS` 派生）、D369 并列门、tips 在场只读、文案 deck 双向对账。

## 5. 风险与未验证

- 未打开真实 `~/.config/lumir` 与任何真实 vault（遵守调研约束）；`last_vault` 的真机取值形态
  来自代码与 spec，未做真机取数。
- 首启模式的居中几何、tips 与 harness 的并排结构、tips 在场只读，尚未真机复现；提案通过后第一步
  先补视觉结构用例与真机探针，再照章实现。
- `harness_pane: true` 在「无标签空 vault」下的现存表现（旧 `.editor-notice` 会盖 harness）是从
  DOM / CSS 推断的，未真机复现；实现第一步就用真机探针确认「tips 挂 editorPane 后 harness
  可见」。
- 首启模式让启动面在 `no_vault` / 超时后继续在场；这是对既有启动态语义的扩展。spec 的 MODIFIED
  与单测把它说清，但真机上「启动面长期在场 + `#app` inert + 命令闸门」的组合尚未复现，实现
  第一步先验。
- 验收套件的 `vaultOpenPath` 通道是提案建议，尚未实现；若 Alex 不接受，877 的 tips / 默认
  harness 段退回视觉结构断言 + 人工一步，证据里如实登记。
- `docs-check` / `validate` 的读数见 §6；若因 `docs/backlog.md` 80 行上限或并行归档冲突报红，
  在提案提交说明与最终 handoff 里记录真实原因，不删别人条目。

## 6. K3 needs-changes 处置

| 项 | 处置落点 |
|---|---|
| P1-1 shell.inert / 命令穿透 | design §4.4（`#app` inert + 命令闸门：默认 Keymap / `applyKeyConfig` 重装 / `onMenuCommand` 同一谓词；`Cmd-,` / `Cmd-Shift-A` / `Cmd-/` 无 DOM / IPC / 布局副作用；`#app.inert` 撤下后为 false）；app-startup delta 加入闸门条款与 Scenario；tasks 2.10 / 2.11 / 6.7 / 7.3 |
| P2-1 vaultOpenPath 只调 IPC | design §9.3 验收动作契约：`switchToVault` 完整链路，不重启 / reload；DEV + 验收注入双约束；普通 dev 无桥 / 端点 404、production build grep 为 0；tasks 7.4 / proposal 影响节 |
| P2-2 视觉桩 lastVault 缺省 | design §9.2 与 tasks 6.1：复用 `vault_current` 的 `current.root ?? "/Users/alex/demo-vault"` fallback；fixture 省略 root ⇒ 非首启，反向验证；evidence 同条 |
| P2-3 tips 资格竞态 | design §3.3 / §5.2 与 first-run-onboarding spec：`applyVault` 入口 claim + vaultId 令牌；首个 applyVault 收尾无论有无标签都清；补「首 vault 恢复标签 → 切空 vault」场景；tasks 3.6 / 3.9 |
| P2-4 877 老用户回归污染 | design §9.3 步骤 8 与 tasks 7.3：先关标签 + harness、等布局落盘再重启；`configWrite` 自带 restart 不叠加 |
| P3-1 无 JSONL 断言 | design §9.3 步骤 6 与 tasks 7.3：目录级 `glob exact: 0` + harness 在场 / `harness_pane:true` 正观测；明确不用 `file.count: 0` |
| P3-2 app-startup 矛盾态 | app-startup delta 的「阶段行只在恢复进行中」Scenario 第二种情形改为首启模式；tasks 8.3 |

已核实无阻塞项（启动快照复用 / 读取失败非首启 / 不复算、首启分流在 startup-surface、tips 挂
editorPane、`openHarnessPane(false)` 无 JSONL / preflight、877 未被占用）保持原方案，不改。

## 7. 提案期验证

在本 worktree 运行：

- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- `bash scripts/docs-check.sh`

结果记录在本文件同目录的提交说明与最终 handoff；本提案不跑实现门禁（`gate.sh` / 验收套件），
因为未改产品代码、测试或基线。
