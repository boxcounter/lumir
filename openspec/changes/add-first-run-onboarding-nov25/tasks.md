# Tasks: add-first-run-onboarding-nov25

> 开工前先过一遍 `REVIEW.md`，重点核对自己的改动面：『假绿：断言等价于子串』『读不到当成空』
> 『同一语义两处真源』『新增 / 修改 overflow 容器没先定档』『标题栏 mousedown preventDefault
> 打断拖拽』。本 change 的节点 1 已于 2026-11-25 批准（Alex 原话「采纳推荐的只读」）；实现按
> 本 tasks 执行。

## 1. 首启判定

- [x] 1.1 `src/boot.ts` 在首帧前已有配置快照；在 `mountStartupSurface` 之前算
      `firstRun = snapshot !== null && snapshot.config.last_vault === null`，作为
      `StartupSurfaceOptions` 字段传给启动面。同一份配置只读一次，不新增 IPC / peek API。
- [x] 1.2 `src/startup-surface.ts` 的句柄暴露只读 `firstRun` 与 `visible`（`dismissed === null`）；
      `src/main.ts` 在启动恢复块之前读
      `const firstRunPending = startupSurface()?.firstRun === true;`。快照缺失 / 启动面不存在时
      按非首启处理；判断「仍在场」用 `visible`，不用 `firstRun` 单独判。
- [x] 1.3 判定此后只读：不在 `onEmptyVault` / vault 装载 / `last_vault` 写回 / 切换 vault 时复算。
- [x] 1.4 单测覆盖：`last_vault === null` → 首启；字符串 → 非首启；`null` 快照 → 非首启；
      写回 `last_vault` 后同一会话内判定不变。
- [x] 1.5 确认无新增 config / 状态字段：`git diff` 的 Rust config / ts-rs 导出面 / `src/bindings/**`
      为空；不新增 IPC。

## 2. 启动态首启模式

- [x] 2.1 `startup-surface.ts` 增加 `firstRunMode` 分支：根节点加 `startup-first-run` class；
      不建 `.startup-sidebar` / `.startup-row`、不建 `.startup-mark`、不建 `.startup-phase`；
      只建唯一 `.startup-open` 按钮，文案取首启模式的新文案「添加 vault」。
- [x] 2.2 `startup-surface.css` 增加首启模式布局：`.startup-content` 在 `#startup` 内
      `position:absolute; inset:0; display:flex; align-items:center; justify-content:center;`；
      按钮中心 = viewport 中心；顶部拖拽带绝对定位、高度 `--layout-titlebar-h`、背景透明、
      z-index 高于内容层；容器不挂 `mousedown` + `preventDefault`。
- [x] 2.3 撤下规则：首启模式不设安全阀定时器（timer 变量允许 undefined，`dismiss` 清定时器前
      判空）；`notifyNoVault` / `setPhase` 在首启模式为空操作；`evaluate` 在首启模式只在
      `treeReady` 或 `degraded` 时撤下；`startup-gate` 的非首启判据逐字不变。
- [x] 2.4 `src/main.ts` 的 `refreshVaultStatus` 未打开终态分支：`firstRunPending` 时不调
      `tree.showEmpty`（启动面首启模式仍在场）；非首启维持既有 `notifyNoVault + tree.showEmpty`。
- [x] 2.5 `refreshVaultStatus().catch`：首启模式先 `startup?.degrade()` 让路，再走既有
      `tree.showEmpty(errorMessage(e))`；错误必须可见，不被启动面盖住。
- [x] 2.6 `applyVault` 的 `startup?.notifyTreeReady()` 是首启模式撤下信号；随后
      `showEditor()` / `onEmptyVault` 接管。目录选择器取消 / 打开失败时启动面保持在场。
- [x] 2.7 工作区隔离：shell 建出后若 `firstRunPending && startup?.visible`，把 `#app`
      （设置面板同一个 `inertRoot`）置 `inert = true` + `aria-hidden="true"`；在
      `startup?.onDismiss` 回调里统一清 `#app.inert` / aria-hidden，并断言
      `.lumir-set-overlay` / 键位面板 / harness pane 不在场。不能只 inert `shell.root`。
      回调同时保留非首启 `timeout` 补 D95 的既有逻辑。
- [x] 2.8 `onRelabel` 按 `firstRun` 选文案键重写按钮；三主题 / 零动画 / token-only。
- [x] 2.9 结构断言：`#startup.startup-first-run` 不在 `.editor-pane` / `.pane-editor` / pane 容器
      内；不写 `vault-sessions`；`startup-open` 是唯一可聚焦 / 可操作入口。
- [x] 2.10 命令闸门：`workspaceCommandsBlocked = () => firstRunPending && startup?.visible === true`。
      `KeymapContext` 增加可选 `workspaceCommandsBlocked`；`Keymap.handle` 在 binding 解析、
      作用域 / `when` / `commandGate` 通过之后、`preventDefault` / `runtime[...]` 之前判一次，
      被阻断则 `preventDefault` + `reset` + return；非绑定键（Tab / IME / 未绑定字符）照常
      透传。默认 Keymap 与 `applyKeyConfig` 的 detach/reattach 共用同一个 `keymapContext`，
      天然同门；`onMenuCommand` 回调（`src/main.ts:4088`）在查 `MENU_COMMANDS` 前用同一谓词
      早退。首启按钮不走命令层，不受影响。
- [x] 2.11 断言 `Cmd-,` / `Cmd-Shift-A` / `Cmd-/` 在首启模式下：settings / harness / bindings
      overlay 不出现；无 `settings_get` / `config_set` IPC、无 pane / 布局变化；至少一次在
      `[keys]` 重绑后复跑；另用一次原生菜单事件（`settings` / `describe-bindings`，经桩事件
      通道或 `onMenuCommand` 注入）验证菜单来源同样被挡住；首启撤下后同一组键在非首启下行为
      不变。断言 `#app.inert` 在撤下后为 false，无 inert / aria-hidden 泄漏。

## 3. 首启工作区 tips

- [x] 3.1 新增 `src/first-run-tips.ts`：纯 DOM（只吃 `t()`、零 `innerHTML`），三组 9 行 +
      脚注；keycap 从 `src/keys.ts` 的 `KEY_BINDINGS` 按 command id 派生，不写 `"⌘P"` 字面量。
- [x] 3.2 把 tips 挂进 `shell.editorPane`（不是 `shell.editorRow` 的 `.editor-notice`）；
      `inset:0` 不透明覆盖 root doc pane；不引入 `overflow` 容器；不 `display:none` 编辑器 DOM。
- [x] 3.3 `onEmptyVault` 首启分支：`showFirstRunTips()` → `openHarnessPane(false)` →
      `renderAllTabStrips()`；非首启分支维持 `showEmptyVaultState()`（D107 + D882）。
- [x] 3.4 `renderAllTabStrips` 的 D369 门追加 `|| firstRunTipsVisible`；单一 flag、单一写点；
      `showFirstRunTips` / `hideFirstRunTips` 后各重跑一次。单测覆盖两个方向。
- [x] 3.5 tips 在场时 `editor.setSessionEditable(...)` 追加 `&& !firstRunTipsVisible`；打开文档后
      `showEditor()` 清 flag、移除 DOM、恢复 `widthDrag` 与可编辑，并重跑 `renderAllTabStrips()`。
- [x] 3.6 首启资格在首个 `applyVault` **入口**一次性领取：模块级 claim 记录本次 `vaultId` 并把
      全局资格置为已领取；后续 applyVault MUST NOT 覆盖已有 claim；`onEmptyVault` 只认
      claim.vaultId === 当前 loadedVaultId 且未消费的一次；首个 applyVault 的恢复收尾无论有无
      标签都清 claim。首个 vault 恢复出标签时 tips 不出现、不补到后续空态；本会话不再出现。
- [x] 3.7 `relabelNotice = showFirstRunTips`，语言切换重绘。
- [x] 3.8 单测：tips 在场时键入不改变空白草稿；打开文档后键入正常；tips 不遮 harness 的结构
      断言（DOM 父节点 / 兄弟关系）。
- [x] 3.9 单测 / 视觉：首个 vault 恢复出标签 → 切到空 vault 不出 tips、不默认 harness；第一个
      restore 未收尾时切第二个空 vault，第二个不得继承资格（可控延迟造竞态）；两个方向都要有
      正观测（首个 vault 的空态确实出 tips / harness，证明资格本身有效）。

## 4. 默认 harness

- [x] 4.1 仅首启空态调 `openHarnessPane(false)`；不抢焦点、不新增开合路径、不重复调用
      `paneSettled`。
- [x] 4.2 确认无空 JSONL / 无 preflight：场景断言 `harness/sessions/<vaultId>/` 无新增文件；
      `harness_state` 仍为空快照；`harness_pane: true` 按既有 debounce 落盘。
- [x] 4.3 既有 `harness_pane: true` 的恢复路径幂等：`openHarnessPane` 早退，不重复分栏。

## 5. 文案

- [x] 5.1 按 `文案-Copy.md` 当前末位连续取号（起草时 D1028；实现前复核），追加首启模式按钮、
      tips 标题 / 9 条标签 / 脚注 / 区域读屏名；中英双列必填。
- [x] 5.2 同步 `src/copy-data.ts` 与 `文案-Copy.md`；`tests/unit/copy.test.ts` 双向对账通过；
      `src/**` 除文案表外零 CJK 字面量。
- [x] 5.3 文案口径复核：首启模式「添加 vault」、非首启启动态 / 老用户树空态仍 D6；tips 注
      「默认键位」、`⌘/` 为完整出口；不出现 `config.json` / provider 等实现词。

## 6. 视觉测试与基线

- [x] 6.1 修 `tests/visual/scenes/tauri-stub.ts`：`VaultFixture` / `stubTauri` 支持 `lastVault`
      （含无 fixture 的非首启空态）。**第三参优先与 fixture 缺省派生分开计算**：`config_get`
      使用独立的 `initialLastVault`，`current` 继续保持 `null`：

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

      `stubTauri(page, null)` 仍为 `null`（真首启）。不能只写 `current.root ?? null`——`root`
      可选，`m831` 等 fixture 不写 root，实际根回落到 `/Users/alex/demo-vault`；也不能让
      `vault === null` 先短路掉 `options.lastVault`。
- [x] 6.2 审计所有 `stubTauri(page, null)` 场景（`app-main`、`toc-outline`、`quick-open`、
      `m293-eink-literal-tokens`、`m149-tabs`、`first-run-empty-state`、`startup-restore`、
      `m831-harness-composer-codemirror`）：要旧无 vault 工作区的，显式给失效的非 null
      `lastVault`；否则会被首启模式覆盖。补桩测试「fixture 省略 root ⇒ 非首启」，并新增正向
      用例 `stubTauri(page, null, { lastVault: "/mock/missing-vault" })` ⇒ 非首启、启动面按
      `no_vault` 撤下、既有 `.ft-empty` 可见。反向验证：改回 `current.root ?? null`（或在
      `vault === null` 处短路）时该用例必红。
- [x] 6.3 `m645-startup-surface` 的 `RESTORING` 场景显式给非 null `lastVault`，保持既有骨架 /
      产品标记 / 阶段行断言；另加首启模式用例（无侧栏 / 产品标记 / 阶段行、只有居中按钮）。
- [x] 6.4 更新 `tests/visual/scenes/first-run-empty-state.spec.ts`：真首启（`#startup.startup-first-run`
      + 唯一按钮 + 中心几何）；老用户空 vault（D107 + New note）；首启空 vault（tips + harness +
      无 D107 / New note / D369）。
- [x] 6.5 `app-main.spec.ts` 第一条若要保留旧空态基线，改为非首启的失效 `lastVault`；真首启另立
      用例与基线。新增 tips 结构 / 几何用例：只覆盖 root doc pane、harness 可见、三主题 token
      正确、无 `overflow` 容器（滚动条注册表不新增条目）。
- [ ] 6.6 三主题截图交 Alex 过目后再 `--update`；更新后核对 `app-main` / 首启模式 / tips 基线的
      时间戳与预期变化面，避免「删左栏 UI」式静默假绿。
- [x] 6.7 命令闸门用例：首启模式下按 `Cmd-,` / `Cmd-Shift-A` / `Cmd-/`，断言 settings /
      harness / bindings overlay 不出现、无 `settings_get` / `config_set`、pane 与布局零变化；
      造一次 `[keys]` 重绑后的重装现场复跑；首启撤下后同一组键恢复原行为；断言 `#app.inert`
      撤下后为 false。
- [x] 6.8 P1 回归：非首启恢复中打开设置 → 树就绪 → 设置 overlay 仍可见且 `#app.inert`
      仍为 true；关闭设置后才由设置 owner 恢复 false（`startup-restore.spec.ts`）。

## 7. 真机验收

- [x] 7.1 现场查 `scripts/acceptance/COVERAGE.md` 末位，确认 877 未被占用（876 已被
      `876-harness-web-production-no-injection` 占用）；若 877 也已被占，顺延并在 tasks 记下
      现场读数。
- [x] 7.2 更新场景 `263-first-run-empty-vault`：第一段改为启动态首启模式 + 添加 vault；第二段
      保留老用户空 vault 的 D107 + New note，并断言无 tips / 无默认 harness。
- [x] 7.3 新增场景 `877-first-run-onboarding`，按顺序覆盖：
      ① 启动态首启模式唯一按钮、无侧栏 / 标记 / 阶段行；
      ② 命令闸门：`Cmd-,` / `Cmd-Shift-A` / `Cmd-/` 无 overlay、无 settings/config IPC、无
      pane / 布局变化，至少一次在 `[keys]` 重绑后复跑；
      ③ `vaultOpenPath` 走完整前端链路打开预置 vault，不重启、不 reload；
      ④ tips 可见、harness 1:1 在场、D107 / New note / D369 不在场；
      ⑤ `harness_pane: true` 落盘；目录级
      `glob: { dir: "env:harness/sessions/<vaultId>", pattern: "\\.jsonl$", exact: 0 }` 断言
      无新增 JSONL，并用 harness 在场 + 布局位 `true` 作正观测（MUST NOT 用 `file.count: 0`）；
      ⑥ 打开文件后 tips 消失、编辑器可编辑；
      ⑦ 老用户回归：关闭标签（⌘W）与 harness（⌘⇧A），等 `vault-sessions` 落盘到
      `harness_pane: false` 且 panes 无标签（≥1.5s 或 `waitForFile`），再 `restart`；
      断言 D107 + New note 在场、tips / 默认 harness 不出现。`configWrite` 自带 restart，
      若用它写 `lastVault` 不得再叠加一次 `restart`。
- [x] 7.4 给套件补仅验收环境生效的 `vaultOpenPath` 动作：必须复用 `switchToVault(path)` 完整
      链路（`loadUserVault → vaultOpenPath → applyVault`），不能只调 `vault_open_path`；桥接同时
      受 `import.meta.env.DEV` 与 Vite 验收注入标记约束（沿用 `LUMIR_ACCEPTANCE_PORT` +
      `apply:"serve"`）。机器反证：普通 dev 无桥 / 端点 404；`pnpm build` 后
      `dist/assets/*.js` grep 桥接标记为 0；验收实例动作可用。若 Alex 不接受，877 的该段退回
      视觉断言 + 人工一步，并在证据里登记缺口。原生 `NSOpenPanel` 仍不驱动。
- [ ] 7.5 跑 `node scripts/acceptance/run.mjs 877 263`；证据落 `.local/acceptance/<日期>/`
      （不落 worktree）；FAIL 项先修，不送 Alex。

## 8. Specs 与文档

- [x] 8.1 新增 `specs/first-run-onboarding/spec.md` 的 2 条 ADDED requirements（判定与作用域 /
      工作区初始构成），每条 SHALL/MUST + 至少一个 Scenario；首启进入面引用 `app-startup`，
      不重复布局条款。
- [x] 8.2 `specs/app-startup/spec.md` 的 MODIFIED「启动态的上屏与撤下」：整条复制 living 正文
      再改；加入首启模式的撤下规则、`#app` 不可交互、命令闸门（默认键位 / 配置重绑 / 原生菜单
      同一闸门）与「添加 vault」文案；补 `Cmd-,` / `Cmd-Shift-A` / `Cmd-/` 场景；非首启三种
      撤下逐字保留。
- [x] 8.3 `specs/app-startup/spec.md` 的 MODIFIED「启动态的内容与视觉口径」：整条复制；加入首启
      模式的构成与居中例外；非首启骨架 / 产品标记 / 阶段行条款逐字保留；「阶段行只在恢复进行中」
      的第二种情形改为首启模式，删除「非首启、无 last_vault」这个不存在的状态；首启场景覆盖
      居中与无假内容。
- [x] 8.4 `specs/vault-workspace/spec.md` 的 MODIFIED「vault 切换器入口与列表浮层」：整条复制；
      D5 / D6 口径限定非首启，首启由启动态首启模式承接；其余逐字保留。
- [x] 8.5 `specs/file-tree/spec.md` 的 MODIFIED「未打开 vault 空态」：整条复制；非首启 scope +
      首启场景。
- [x] 8.6 `specs/pane-layout/spec.md` 的 MODIFIED「harness pane」：整条复制；加入首启初始布局
      的唯一例外、无 JSONL / 无 preflight / 不抢焦点 / 布局位照常落盘；新增场景。
- [ ] 8.7 `evidence.md` 的现状行号在实现后复核；如行号漂移，更新证据而不是改 spec 结论。

## 9. 验证

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 9.2 `bash scripts/docs-check.sh` 通过（若因 `docs/backlog.md` 80 行上限或并行归档冲突报红，
      如实记录原因，不删别人条目、不为此改本 change 的结论）。
- [ ] 9.3 `bash scripts/gate.sh quick` 通过；动过视觉代码 / 场景后本地 `bash scripts/gate.sh visual`
      通过（CI 只跑结构层，像素层归本地）。
- [ ] 9.4 真机证据：`877` / `263` PASS；截图与读数落 `.local/acceptance/<日期>/`，报告里给可
      `ls` 的绝对路径。
- [ ] 9.5 tasks 全部勾选后，在 `docs/backlog.md` 的归档跟踪队列落一条该 change 的记录（实现
      mission 号 + 五要件状态），供归档门禁核对；当前 backlog 已在 80/80 硬上限，若届时仍满，
      先按维护规则删掉已完成 / 无出口的僵尸条目再加，不为压行数删活条目。归档时补
      `first-run-onboarding` 的 Purpose 并跑 `--archived` 审计。
