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
  非首启空态）。**第三参优先与 fixture 缺省派生分开计算**：`config_get` 使用独立的
  `initialLastVault`，`current` 保持 `null`：

  ```ts
  const initialLastVault =
    options?.lastVault !== undefined
      ? options.lastVault
      : vault === null
        ? null
        : vault.lastVault !== undefined
          ? vault.lastVault
          : vault.root ?? "/Users/alex/demo-vault";
  ```

  `stubTauri(page, null)` 仍为 `null`（真首启）。不能只写 `current.root ?? null`——`root` 可选，
  `m831` 等 fixture 不写 root，实际根回落到 `/Users/alex/demo-vault`（`tauri-stub.ts:428`、
  `:720`）；也不能让 `vault === null` 先短路掉 `options.lastVault`。补桩测试「fixture 省略
  root ⇒ 非首启」，并新增正向用例
  `stubTauri(page, null, { lastVault: "/mock/missing-vault" })` ⇒ 非首启、启动面按 `no_vault`
  撤下、既有 `.ft-empty` 可见；反向验证改回 `current.root ?? null`（或在 `vault === null` 处
  短路）时该用例必红。
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
| P2-2 视觉桩 lastVault 缺省 | design §9.2 与 tasks 6.1/6.2：独立 `initialLastVault`，`options.lastVault` 优先，其次 `vault === null ? null`，再 `vault.lastVault`，最后 `vault.root ?? "/Users/alex/demo-vault"`；`current` 保持 `null`。补正向用例 `stubTauri(page, null, { lastVault: "/mock/missing-vault" })` ⇒ 非首启 / `no_vault` 撤下 / `.ft-empty` 可见；反向验证短路时必红 |
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

## 8. 实现期验证（2026-11-25）

产品代码与测试已落地；本次只在本 worktree 跑目标层，完整 `gate.sh quick/visual` 留给主会话：

- `npx tsc --noEmit`：通过（含 `src/vite-env.d.ts` 的 `vite/client` 类型）。
- `pnpm --dir tests/visual exec tsc --noEmit`：通过（视觉桩 / 场景类型）。
- `pnpm test`：`tests 2042 / pass 2042 / fail 0`。
- 目标视觉（`LUMIR_VISUAL_PORT=4174`，不碰 Cargo）：
  - `first-run-empty-state.spec.ts` 4/4 PASS（首启模式居中、命令闸门含原生菜单、tips +
    默认 harness、只读、打开文档撤下 tips、首 vault restore 延迟竞态、老用户 D107 + New note）；
    竞态用例先做了一次变异（把 `onEmptyVault` 的 claim 判据临时换成 `firstRunPending`），
    在 `.first-run-tips` 上如实判红，恢复后绿灯；
  - `startup-restore.spec.ts` 5/5 PASS（含 P1 回归：非首启恢复中打开设置 → 树就绪 →
    设置仍开且 `#app.inert` 仍 true；关闭后才 false；修复前该断言红）；
  - `app-main` 6/6 + `m645-startup-surface` 4/4 PASS；
  - `toc-outline` + `quick-open` + `m149-tabs` + `m293-eink-literal-tokens` +
    `m831-harness-composer-codemirror`：79 passed / 1 skipped（chromium + webkit；跳过项是
    CDP-only 分支，非产品断言）。
- `bash scripts/acceptance/check-suite.sh`：PASS（877 静态契约 + COVERAGE 生成一致）。
- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：`38 passed / 0 failed`。
- `bash scripts/docs-check.sh`：PASS。
- `pnpm build` 后 `dist/assets/*.js` grep `__lumirAcceptanceVaultOpen` /
  `__LUMIR_ACCEPTANCE_VAULT_OPEN__` / `__lumir-acceptance-vault-open` 为 0（production 无桥）。
- 877 的“打开文档”段增加真实键入 `TIP-EDIT-877`、`editor.has` 与 `cmd+s` 落盘断言；保存而非
  撤销，后续老用户回归前无 dirty 污染。
- 基线候选（未 `--update`）：`.local/reviews/first-run-onboarding-nov25/baseline-candidates/`
  下 `first-run-{light,dark,eink}.png` 与 `tips-{light,dark,eink}.png` + README 清单。

## 9. 像素层复审：首启按钮深色对比度（2026-11-25）

Alex 在候选图上发现 `first-run-dark.png` 的「添加 vault」文字近黑、深底上不可读。

- 根因：`.ft-open-btn` 只设 `background: var(--content-bg)`，未设 `color`；按钮不继承父级
  `color`，缺省落 UA 的 `buttontext`（跟随系统外观，不跟 CSS 主题）。启动面 `#startup` 的
  `color: var(--text)` 传不进按钮。树空态同一入口类共用此规则，深色下同病。
- 断言（先红）：`first-run-empty-state.spec.ts` 三主题各一条，`getComputedStyle` 取按钮文字 /
  底色，按 WCAG 2.x 相对亮度算对比，正文档阈值 4.5:1（13px / 550 不构成大字号）。
  修复前 dark 红：`rgb(0, 0, 0)` / `rgb(34, 35, 38)` = **1.34:1**（chromium 实测）。
- 修复：`.ft-open-btn { color: var(--text); }`（最小改动，不动布局）。
- 修复后（chromium 计算样式实测）：light `rgb(33,32,26)` / `rgb(253,253,252)` = **16.04:1**；
  dark `rgb(227,226,219)` / `rgb(34,35,38)` = **12.10:1**；eink `rgb(0,0,0)` / `rgb(255,255,255)`
  = **21.00:1**。三主题断言绿；像素采样与计算样式一致（修前 dark 字形像素 `rgb(0,0,0)`，
  修后 `rgb(227,226,219)`）。
- 候选重生成（同一临时脚本，未入 git）与漂移核对（逐像素解码比对）：
  - `first-run-dark`：484 px 变化、376 px 超 51/255（字形区域），maxDiff 227 —— 即修复面；
  - `first-run-light`：472 px 变化，maxDiff 33（UA 黑 `#000` → token `#21201a`），未超像素门容差；
  - `first-run-eink`：0 px 变化（eink `--text` = `#000000`，与 UA 色同值）；
  - `tips-{light,dark,eink}`：0 px 变化（tips 面不含该按钮，未漂移）。
- 正式基线未 `--update`。已知陈旧基线：`m645-startup-surface` 的 `startup-dark` 基线本身
  带同一缺陷（黑字），修复后的实际图与旧基线差 329 px 超阈值、但占 960k 像素的 0.034%，
  低于 `maxDiffPixelRatio 0.001`，因此门禁容差内不红。修复后的三主题启动态候选存为
  `startup-restoring-{light,dark,eink}.png`，供 Alex 过目后随 `startup-dark` 一并重录。

剩余（主会话执行）：`877` / `263` 真机验收、完整 `gate.sh quick/visual`、正式视觉基线
`--update`（Alex 过目候选后；含 `m645-startup-surface/startup-dark` 的陈旧基线与首启 / tips 新基线）。
