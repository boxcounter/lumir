# Tasks: multi-vault-workspaces

> 提案阶段只锁定意图；本清单随实现细化。入口形态（裁决点 1）在节点 1 定下后，任务 3.1 / 5.2 / 6.3 按定下的形态落地。
>
> **勾选状态（M164 收口，2026-09-18）**：本清单在 M162（后端，merge `eafd258`）/ M163（前端，merge `fb2dc26`）
> 与 M164（验收·视觉·文档收口）之后一次性勾齐。每条括注证据（文件:行 / 单测名 / 场景名 / 命令输出）；
> 拿不出证据的一律不勾。**7.1 / 7.2 / 8.6 标注「归档时」的三条保持不勾**——它们的时点是归档评审
> （节点 2），M164 已把其中的 backlog 工作做完（见各条的括注），勾选留给归档。

## 1. 后端：注册项字段与列表命令

- [x] 1.1 `VaultWorkspace`（`src-tauri/src/workspaces.rs:35-50`）增 `last_opened_at: Option<i64>`（`#[serde(default, skip_serializing_if = "Option::is_none")]`）：vault 打开成功时与 `last_vault` 同一次成功路径写入（`src-tauri/src/commands.rs:302-329`（`remember_last_vault` 的降级 warning 口径））；打开失败 / remap 门短路时不写。核对 `vault_register`（`workspaces.rs:218-239`）与 `sweep_registry`（`:85-129`）的整项构造不会清掉该字段（后者用 `..v` 展开，前者是重映射复位路径，需显式保留）　**证据**：字段在 `workspaces.rs:56-61`；`mark_opened` 是唯一写入点（`commands.rs:480` 的成功打开路径 + `lib.rs:437` 的启动恢复成功路径）；`vault_register` 显式保留（`workspaces.rs` 的重映射复位路径）；`sweep_registry` 用 `..v` 展开不碰它。集成场景 `scenario_open_memory_is_written_only_for_real_opens` / `scenario_last_opened_at_survives_governance_sweep_and_remap`（`src-tauri/tests/workspace_scenarios.rs`）。
- [x] 1.2 新增 `vault_list` command：读注册表（复用既有目录读取与「解析失败即跳过」的容错口径）+ 每项返回 `{ id, path, name, available, last_opened_at, tab_count }`；`name` 取 path 的 basename；`tab_count` 来自会话文件的固定标签数（见 2.3）　**证据**：`workspaces.rs:347-408`（`list_vaults` + `vault_list` command）；契约类型 `src/bindings/VaultListEntry.ts`（ts-rs 导出）；集成场景 `scenario_vault_list_reports_name_availability_and_tab_count`。
- [x] 1.3 可用性判定与线程：路径探测 MUST NOT 在 Tauri 主线程上做（`#[tauri::command(async)]` 或等价迁移）；未归档与已归档项都返回并标 `available: false`（归档只抑制 remap 候选，不抑制列表可见性）　**证据**：`workspaces.rs:399-408`——`#[tauri::command] pub async fn vault_list()` 内只读两个目录路径，读盘与逐项 `is_dir()` 交给 `spawn_blocking`；`list_vaults` 不过滤 `archived_at`（`:342-343`），归档项照常返回并因路径不存在而 `available: false`。
- [x] 1.4 ts-rs 重新导出新类型到 `src/bindings/` 并一起提交（`cargo test` 触发导出，`scripts/gate.sh quick` 的 bindings 漂移检查会核对）　**证据**：`src/bindings/VaultListEntry.ts` / `VaultSession.ts` 已入库；`scripts/gate.sh quick` 的 `bindings-drift` 在 M164 复跑 PASS（`GATE PASS bindings-drift`）。
- [x] 1.5 Rust 单测：列表含失效项、排序（最近打开倒序 + 不可用项沉底）；`last_opened_at` 只在打开成功时写入；单个注册项损坏时列表仍返回其余项　**证据**：`src-tauri/tests/workspace_scenarios.rs` 的四条集成场景——`scenario_vault_list_reports_name_availability_and_tab_count`（含失效项与 `tab_count`）、`scenario_vault_list_sorts_recent_first_and_unavailable_last`（排序）、`scenario_vault_list_skips_corrupt_registry_entries`（单个损坏项）、`scenario_open_memory_is_written_only_for_real_opens`（只在真打开时写）。**形式说明**：落在集成测试 crate 而非 `mod tests`——`list_vaults(registry, sessions)` 的目录注入口径就是为它留的（与既有 workspace 场景同一处）。

## 2. 后端：按 vault 的会话存储

- [x] 2.1 新增会话读写模块（`~/.config/lumir/vault-sessions/<id>.json`）：字段 `version` / `tabs`（有序 vault 相对路径）/ `active` / `updated_at`；写用临时文件 + rename 原子替换；解析失败 / `version` 不匹配 / 字段类型非法 → 返回「无历史」并记 warning，不抛错　**证据**：`src-tauri/src/vault_session.rs`（`sessions_dir` / `load_from` / `save_to`；文件头写明与注册项分开存放的理由与写入纪律）。
- [x] 2.2 条目校验：丢弃绝对路径、含 `..`、越出 vault 的条目（`..` 与绝对路径的判断与既有 vault 相对路径口径同源）　**证据**：`vault_session.rs` 的 `sanitize`（读写共用）；集成场景 `scenario_session_commands_round_trip_and_reject_out_of_bounds_entries`。
- [x] 2.3 命令：`vault_session_get(vault_id)` 与 `vault_session_put(vault_id, tabs, active)`；写失败返回可降级的 warning 语义（不抛错，前端不因它中断切换与打开）　**证据**：`vault_session.rs:126` / `:142`；前端封装 `src/ipc.ts:148-162`；降级行为由 `scenario_session_put_degrades_write_failure_to_warning` 覆盖。
- [x] 2.4 Rust 单测：往返一致；损坏 / 缺版本等价于无历史；越界条目被丢弃；写失败不 panic 且不影响其它 vault 的会话　**证据**：`vault_session.rs:160+` 的 5 条 `#[test]`（往返 / 版本不匹配 / 解析失败 / 越界丢弃 / 写失败）+ `workspace_scenarios.rs` 的 `scenario_session_commands_round_trip_and_reject_out_of_bounds_entries` / `scenario_session_put_degrades_write_failure_to_warning`。

## 3. 前端：入口、浮层与键位

- [x] 3.1 树头部入口按裁决点 1 的形态落地（A：`button.ft-vault`（名称 + `▾` caret，`aria-haspopup="listbox"` / `aria-expanded`）；B：保留 `button.ft-switch-btn`「切换」改为开列表 + 常驻 `＋`）；单 vault 时常驻出现　**证据**：形态 A 落地在 `src/tree.ts:219-240`（含 mousedown 不夺焦的理由）；「单 vault 时常驻」由 `tests/visual/scenes/mv-vault-switcher.spec.ts` 第 1 条断言（含 `.ft-switch-btn` 计数 0 的退场判据）。
- [x] 3.2 浮层渲染：显示名 / 摘要「N 个标签 · 上次打开时间」/ 路径尾部三段 / 当前项唯一标记 / 不可用行（标注 + 「重新定位…」）/ 分隔线 + 「新增 vault…」（A 在浮层底部且是浮层内唯一入口；B 在左栏头部、浮层内不重复）；与 `.lumir-toc` 同手法的绝对定位、不占常驻行高、关闭即消失；宽度允许溢出左栏　**证据**：`src/vault-switcher.ts:658-737`（`render` / `renderRow` / `subLine`）；视觉断言 `mv-vault-switcher.spec.ts` 第 2 条（行序不重排、当前项唯一标记、失效行 `aria-disabled` + D102/D103、D104 新增入口、不占常驻行高的几何不变、宽度溢出左栏）。
- [x] 3.3 键位：新增命令「打开 vault 切换器」+ 默认 `Cmd-o` 进 `src/keys.ts` 的 `KEY_BINDINGS`（含 `doc` 字段说明来由与冲突核实；键位面板自动收录该条，无需另改 `src/bindings-panel.ts`——面板读的就是该表的 `doc`）；浮层内 ↑↓ 选择、Enter 切换、Esc 关闭（就地消费、不进键位表，与 D86 同口径）　**证据**：`src/keys.ts:307`（`Cmd-o` → `vault.switcher`，`doc` 里记了三条独立冲突核实）；就地消费在 `src/vault-switcher.ts:776-811`（↑↓ / ⌃N⌃P / Enter / Esc）；面板收录由 `tests/visual/scenes/m133-describe-bindings.spec.ts` 的基线体现（面板多一行），浮层键位语义由 `mv-vault-switcher.spec.ts` 第 3 条与真机 `17-multi-vault-switch`（⌘O 开 / Esc 关）覆盖。
- [x] 3.4 basename 派生收敛为单一函数（现状 `src/tree.ts:240` 与 `src/main.ts:498` 各一份，列表是第三个消费点——REVIEW.md 第 8 条同族，一并收口）　**证据**：`src/tree.ts` 的 `baseName()` 是全前端唯一一份（`src/main.ts` 的那份已删）；列表行的 `name` 由后端 `vault_list` 给出（前端不重复派生，见 `VaultListEntry.ts` 的注释）。
- [x] 3.5 列表在每次打开时重新拉取（MUST NOT 维护常驻镜像）；不可用行点击不发起打开　**证据**：`src/vault-switcher.ts:618-641`（每次 `toggle()` 都调 `deps.list()`）；失效行点击/Enter 只走重定位（`:711-728`、`:790-802`）；视觉断言见 `mv-vault-switcher.spec.ts` 第 2/3 条。

## 4. 前端：切换、会话落盘与装载后恢复

- [x] 4.1 切换流程：dirty 前置检查（提示点名**当前** vault、带脏标签数，替换 `src/save-controller.ts:247-248` 的两条既有串——旧串不在 deck 里）→ 三动作（保存并切换 / 放弃修改并切换 / 取消，与 D93 同形）→ flush 当前 vault 的会话 → `vault_open_path` → `loadVault`；目标打开失败保留当前上下文，只给一条失败提示（沿用 `src/main.ts:466-470`）　**证据**：`src/main.ts:576-585`（`guardVaultSwitch` / `switchToVault`）+ `save-controller.ts:264-272`（`vaultSwitchBlock`）+ `vault-switcher.ts:259-268`（三动作，文案 D109/D110）；真机 `19-vault-switch-guard`（35 断言）与视觉 `mv-vault-switch-guard.spec.ts`（4 用例）。
- [x] 4.2 「保存并切换」在保存未闭环（冲突 / 写失败 / 无落盘基准）时 MUST NOT 继续切换，沿用既有保存失败提示与出口；不可保存的脏标签不给该动作　**证据**：`src/vault-switcher.ts:237-249`（`saveThenRun` 在 `deps.saveAll()` 为 false 时不 proceed）+ `:261-264`（`hasUnsaveable` 时不 push 该动作）。**覆盖**：「保存未闭环则不切走 + 沿用既有出口」由真机 `19-vault-switch-guard` 的出口一步覆盖（外部改写制造冲突）；「不可保存的脏标签不给该动作」由 `tests/unit/vault-switcher.test.ts` 的状态机断言覆盖。
- [x] 4.3 切换进行中忽略新的切换请求；`loadVault` 里的既有守卫保留为最后防线　**证据**：`src/vault-switcher.ts:212-235`（`inFlight` 闸，注释写明「两个 in-flight 会互相覆盖」）；单测 `tests/unit/vault-switcher.test.ts`。
- [x] 4.4 会话写入时机：标签集合 / 顺序 / 激活项变化后防抖写；切换前与退出前 flush（MUST NOT 只依赖防抖定时器）；预览标签不入盘；摘要数字与入盘数字同源　**证据**：`vault-switcher.ts:38`（`SESSION_WRITE_DEBOUNCE_MS = 1000`）+ `:459-480`（`sessionChanged` / `flush`）+ `:97-106`（`sessionSnapshot` 过滤 `preview`）；切换前 flush 在 `src/main.ts:692`（`applyVault` 的第一步），退出前 flush 走 `beforeunload` 路径；真机 `17-multi-vault-switch` 的三条 `file` 断言直读 `env:vault-sessions/acc-a.json`（存在性 / `tabs` 有序 / `active`），视觉 `mv-vault-switcher.spec.ts` 第 4 条断言 `vault_session_put` 的载荷。
- [x] 4.5 装载后恢复：`loadVault` 完成后按会话以**固定标签**意图逐个 `openFile`（MUST NOT 用默认预览意图——第二个起会顶掉前一个，只剩一个标签），随后激活存储的激活项；激活项不可用退化为第一个可打开的；越界 / 缺失 / 打不开的条目跳过并给**一次**计数提示；全部不可用 → 空 vault 首入态　**证据**：`vault-switcher.ts:114-144`（`restorePlan`）+ `:426-457`（`restore`，固定标签意图 + 一次计数提示 + `onEmptyVault`）；真机 `18-vault-session-restore`（激活项断言 + 反证）与 `17-multi-vault-switch`（切回恢复两个标签）；跳过计数与越界丢弃由 `tests/unit/vault-switcher.test.ts` 覆盖。
- [x] 4.6 启动路径衔接：标签恢复挂在 `vault:restore_finished` → `refreshVaultStatus` → `loadVault(..., restored = true)` **之后**（MUST NOT 挂在恢复线程或 `open_vault` 内）；`restore_pending` 为 `true` 时不恢复任何标签；用户已成功装载别的 vault 时不恢复（M156 的让位规则）　**证据**：`src/main.ts:684-721`（`applyVault` 末尾 `void switcher.onVaultLoaded(...)`，在 `emitReadiness("vault-ready")` 与树/正文装载之后）+ `:777-790`（`refreshVaultStatus` 的让位门：`restored`/`loadedRoot`）+ `vault-switcher.ts:402-404`（恢复世代号，切走即整体作废）；真机 `18-vault-session-restore`。
- [x] 4.7 新增 vault：列表内入口 → `vault_open`（取消不改上下文）→ 命中 remap 门时沿用既有两出口浮条（不绕过）→ 成功即自动切换；不引入命名步骤　**证据**：`src/main.ts:589-591`（`requestAddVault` 先过 dirty 门再弹选择器）+ `:642-661`（`pickVault`，remap 候选短路时交 `remapPrompt`）；视觉 `tests/visual/scenes/app-main.spec.ts`（入口 → 选择器 → 装载 + remap 两出口）；真机侧是**套件缺口**（不驱动原生对话框，见 README 已知边界）。
- [x] 4.8 失效行「重新定位…」：复用 `vaultRemap` → 成功后打开该 vault；目标路径已被另一个注册项占用时拒绝并给人话提示　**证据**：`src/main.ts:605-636`（占用判定 + `vault_remap` + 成功后 `switchToVault`，注释写明「只取路径」的语义与两种拒绝）；`vault-switcher.ts:330-357`（remap 两出口的就地消费）。**未机验**：需要系统目录选择器（套件不驱动原生对话框）——由单测与代码评审覆盖，本清单不宣称真机已验。
- [x] 4.9 前端单测（`tests/unit`）：会话过滤（预览不入盘 / 越界条目丢弃 / 激活项退化 / 跳过计数）、切换守卫三动作状态机、切换进行中新请求被忽略　**证据**：`tests/unit/vault-switcher.test.ts`（`gate unit-tests` 在 `scripts/gate.sh quick` 里 PASS，10/10 全绿输出见 M164 的门禁日志）。

## 5. 文案 deck

- [x] 5.1 把 `demo/multi-vault.html` §7 的新文案落进 `文案-Copy.md`（编号按 deck 末位连续追加，当前末位 D94；五要素齐全），并在文末「文案实现备注」登记归属文件与「轻量大纲 / 多标签」同形的说明　**证据**：`文案-Copy.md` 的 D96–D110（连续追加）+ 文末「文案实现备注」按四处归属登记（`文案-Copy.md:115`）。
- [x] 5.2 方案 A 落地时把 D4「切换」标注停用不复用（与 D30 / D2–D3 的既有处置同形）；方案 B 保留原样　**证据**：`文案-Copy.md:103` 的「**D4「切换」随多 vault 切换器（M163）停用，不复用**——树头部的入口改为 vault 名称本身（形态 A）」。
- [x] 5.3 术语核查：界面文案与契约里零 `space`（决策 4）；`V15_guard` 按 M158 r1 修正后的口径点名当前 vault　**证据**：`grep -ic space 文案-Copy.md` = 0；契约里 `VaultListEntry` / `VaultSession` 无 `space` 字段；D109 的点名口径在 `vault-switcher.ts:188-190`（`vaultGuardText`），真机 `19-vault-switch-guard` 断言其原文。

## 6. 真机验收与视觉制品

- [x] 6.1 新增真机验收场景（文件名 / `id` / `item` 三者一致，**号取落地时「待真机验收」列表的实际末位项号**——评审时末位为 15、M156 预计占 16，本 change 至少从 17 起；不得复用既有号，`run.mjs` 的筛选同时按 `id` 前缀与 `item` 号匹配，重号会串选）：① 多 vault 列表与切换（A 里打开两个标签 → 切到 B 呈空态引导 → 切回 A 恢复两个标签且激活项正确，`shot` + `ax` 证据）；② 启动时按 `last_vault` 恢复 vault 并一并恢复其标签列表；③ dirty 拦截三动作（「放弃修改并切换」走完，另两条各自闭环）　**证据**：`scripts/acceptance/scenarios/{17-multi-vault-switch,18-vault-session-restore,19-vault-switch-guard}.md`（id=文件名、item 17/18/19 = 落地时末位 16 之后的新号，未复用）；全量真机 26/26 PASS（2026-09-18），三项分别 38 / 7 / 35 断言、0 失败（35.0s / 18.1s / 24.2s），证据 `test-results/acceptance/2026-09-17/`（git 外）。**③ 的一条边界**：保存**能**闭环时的「保存成功 → 继续切换」顺路在真机上抢不到 2s 窗口，改由 `tests/visual/scenes/mv-vault-switch-guard.spec.ts` 覆盖，已在场景正文与 README 已知边界如实声明。
- [x] 6.2 合成 vault 补第二个可选目录与会话预置 fixture；验收 runner 的 `configWrite` 支持覆盖 `last_vault`（与 M156 任务 3.4 是同一处能力，落地时合并、不重复加）；同步更新 `scripts/acceptance/README.md` 的动作表　**证据**：第二个合成 vault = `fixtures/second-vault/beta.md` + `util.mjs` 的 `secondVaultDir()` + `app.mjs` 的 `resetSecondVault()`（纳入每场景重置）；会话预置 = `app.mjs` 的 `prepareSeed()` / `writeRegistryEntry()` / `writeSession()` + 场景 frontmatter 的 `seed` 块（README 新增「预置状态（`seed`）」一节）；`last_vault` 覆盖是 M156 已落地的能力（`execute.mjs` 的 `configWrite`），**本 mission 复用、未重复加**；README 的动作表补了 `settle` / `clickNodeText` 两行并修正了旧按钮名口径。
- [x] 6.3 视觉：新增元素级断言（入口、浮层、当前项、不可用行、单 vault 态入口仍在）；方案 A 下「切换」按钮退场会改动含它的整页基线——`--update` 前的截图须 Alex 过目，并按 REVIEW.md 第 3 条逐一核对该元素出现过的所有整页基线时间戳是否随本次更新（0.001 容差在 1200×800 下约 960px，有静默假绿风险）　**证据**：`tests/visual/scenes/mv-vault-switcher.spec.ts`（5 条用例：入口常驻与旧按钮退场 / 浮层与几何 / 键盘导航 / Enter 切换与会话落盘 / 按会话恢复）+ 元素级基线 `vault-entry.png` / `vault-popover.png`；基线核对：`--update-snapshots=all` 重建后**逐张 sha256 与 `HEAD` 比对**，共 **13 张内容变了**（7 张超容差被门禁抓到、**6 张落在容差内静默通过**）+ 2 张新增，前后截图与清单已交 tower 转 Alex（`/tmp/wt164-baseline-review/`，含 MANIFEST）；**基线入库以 Alex 批准为前提**（批准前本分支不带基线更新，见 8.3 的括注）。
- [x] 6.4 若真机发现套件缺动作（如「预置某个 vault 的会话文件」），登记套件缺口并保留如实结论，不降级为「人工看过」　**证据**：`scripts/acceptance/README.md`「已知边界」新增两条——① **不驱动原生对话框**（「新增 vault…」→ 选择器 → 装载的真机路径未验，由 chromium 视觉通道覆盖；真机改用 `seed.registry` 预置「两个目录此前都已作为 vault 打开过」，如实声明「首次把某个目录加进列表」未被验证）；② **dirty 拦截门的可测窗口很窄**（2s 自动保存防抖 vs 注入耗时；本场景改用外部改写制造持久 dirty，「保存能闭环 → 继续切换」顺路由视觉通道覆盖）。两条都写明「不要把 19 的 PASS 读成…」。

## 7. 文档与口径

- [ ] 7.1 `docs/backlog.md` 第 10 条（多标签会话恢复）由本 change 承接——归档时更新其状态与口径　**M164 已把 backlog 正文写好**（`docs/backlog.md` 第 10 条的「状态更新（M164 收口）」：三处与原建议的有意差异、落地口径指针、v1 建议里未落地的 `session_restored{count}` 观测点）。**本条不勾**：它的时点是归档评审（节点 2），届时按归档口径复核。
- [ ] 7.2 归档时把「用户主动打开 / 切换移出主线程」（design §9 的登记项）落一条 backlog 或 finding，避免这条账只留在 design 里　**M164 已落账**（`docs/backlog.md`「待 Alex 裁决」新增第 16 条：现状、收益、代价与建议时机）。**本条不勾**：同上，时点是归档评审。
- [x] 7.3 对账既有 living spec **到 scenario 粒度**（M161 r1 P2-1 的教训：只对 requirement 粒度会让矛盾 scenario 留在 living spec 里）：逐条核 `vault-workspace` / `multi-tabs` / `file-tree` / `perf-measurement` 的每条 scenario 与本 change 的口径是否一致——本 change 对 `vault-workspace` 只 ADD、对 `multi-tabs` 提交 1 条 MODIFIED（其第三条 scenario 的提示口径），`file-tree` 空态不变、`perf-measurement` 无 delta；delta 里的 MODIFIED requirement 文本须与 living spec 逐字一致（只改该改的那一处）；proposal 的「已建议口径」两表与该对账结论对得上　**证据**：对账结论见本节末「7.3 对账记录」。

## 8. 验证

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过　**证据**：`Totals: 17 passed, 0 failed (17 items)`（`change/multi-vault-workspaces` 在内；`scripts/gate.sh quick` 的 `openspec-validate` 也 PASS）。
- [x] 8.2 `scripts/gate.sh quick` 全绿（fmt + clippy + cargo test + bindings 漂移 + tsc + openspec validate）　**证据**：`GATE RESULT: 10/10 PASS（SKIP 0）`——cargo-fmt / cargo-clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / tsc-unit / unit-tests / docs-check / openspec-validate（在 M164 的最终提交内容上复跑）。
- [x] 8.3 `scripts/gate.sh visual` 全绿；基线变动逐张经 Alex 过目后入库　**证据**：`GATE RESULT: 12/12 PASS（SKIP 0）`（含 `visual-regression 162s`；在最终提交内容上复跑）。基线：M163 的入口形态 A 影响 **13 张既有基线**（7 张超容差失败、**6 张落在 0.001 容差内静默通过**——REVIEW.md 第 3 条的新现场）+ 2 张新增（`mv-vault-switcher` 的元素级基线）；13 张 Before/After 与 2 张新增的清单交 tower 转 Alex 过目，**Alex 2026-09-18 批准全部入库**（tower 转达）。入库前逐张 sha256 核对与批准件一致（22/22 match）。
- [x] 8.4 `node scripts/acceptance/run.mjs --check` 通过后，按 6.1 落地时的 `id` 前缀跑该批场景，全 PASS（证据留 `test-results/acceptance/`，不入 git）　**证据**：`--check` = 「场景静态校验通过（26 个）」；全量 `node scripts/acceptance/run.mjs` = **26/26 PASS**（2026-09-18，含本批 17/18/19 与 M160 遗留的 13-toc），证据 `test-results/acceptance/2026-09-17/`（git 外）。
- [x] 8.5 冷启动读数前后对比：本 change 不新增 perf 端点、不改阈值与门禁口径；若 CI 冷启动 median 回退 >40%，按真回归排查，不得调整基线　**证据**：本 change 的 diff 对 `tests/perf/**`、`docs/specs/perf-measurement.md`、`src-tauri/src/ready.rs` 零改动（`git diff master...HEAD --stat` 核对）；perf 端点与阈值未动，故无「新旧数字混比」问题。**未跑** `gate.sh all` 的 perf 段（需要 release 构建，属 CI 的 `perf.yml` 职责）——本条按「口径未变 + 零 perf 相关 diff」判为成立，不宣称本地跑过 perf。
- [ ] 8.6 归档评审前对账一次本 change 的「建议口径」是否被节点 1 翻转（入口 A/B 与 design §9 的未决项）；有翻转则先改 spec 再归档　**M164 已做了一次对账**（结论：无翻转，见 7.3 记录）。**本条不勾**：它要求的是归档评审**前**的最终复核，时点在节点 2。

## 7.3 对账记录（M164，2026-09-18）

对账口径：逐条读 change 的两份 delta + 四个 living spec（`vault-workspace` / `multi-tabs` / `file-tree` /
`perf-measurement`）的**每条 scenario**，与实现（`src/vault-switcher.ts` / `src/tree.ts` / `src/main.ts` /
`src-tauri/src/{workspaces.rs,vault_session.rs}`）对照。

- **`multi-tabs` 的 MODIFIED**：delta 与 living spec **逐字一致，只差两处**，且两处正是 proposal §Impact
  声明的改动点——① requirement 第三段在 living 那句「切换 vault 的守卫 SHALL 用『任一标签有未保存修改』作
  判据」之后**追加**了 4 行「拦下时的人话提示 SHALL 点名**当前** vault 与它有未保存修改的标签数…出口口径见
  `vault-workspace`…」；② 第三条 scenario 的 THEN 由 living 的「提示点名那个有未保存修改的标签」改为 delta 的
  「提示点名当前 vault 与它有未保存修改的标签数（1 个）并给出三条出口；MUST NOT 因为脏标签不在前台而放行，
  MUST NOT 点名切换目标」。其余段落、scenario 1/2、scenario 3 的 heading 与 WHEN 全部逐字相同 → **无需改 living
  spec**（归档时整块应用 delta 即可）。实现与 delta 一致：`vaultGuardText` 的文案（D109）与三动作（D110）。
- **`vault-workspace` living spec（12 条 scenario）**：全部与 change **兼容**、无一处矛盾或需要改写的措辞
  （打开链路、`last_vault` 记账、注册表治理与重映射的既有 scenario 都不被本 change 触碰；本 change 只 ADD 7 条
  requirement）。**一个已知的措辞张力**（本 change 未引入、也未修）：living 的守卫判据写「任一标签有未保存修改」，
  而实现与 `vault-workspace` delta 写「任一**有路径**的标签」——差异来自 M156 的无名缓冲豁免。change 有意保留
  living 原文（「判据原文不动」），故不改；此处只标注，避免后续读者误判。
- **`file-tree`（「空态不变」成立）**：`tree.showEmpty` 仍逐字使用 D5 / D6，且空态下不渲染 `.ft-vault` 入口
  （`entryEl` 被清），与 delta 的「未装载时无列表入口」scenario 一致；四条既有 requirement（全类型树 / 点击打开 /
  watch 增量 / 未打开空态）的每条 scenario 均不受本 change 影响。**树头部入口与 D107 的空 vault 引导不在这个
  capability 的范围内**（前者只在已装载态出现、后者是编辑器区的引导），它们由 `vault-workspace` 的新 ADD 承接。
- **`perf-measurement`（无 delta）**：change 未提交该 capability 的 delta，也未改 `src-tauri/src/ready.rs` 的
  `LUMIR_READY` 位置；逐条核对既有 scenario（冷启动测量 / keypress-to-paint / 打开 1MB / 常驻内存）无矛盾。
  **一条如实标注的可见性缺口**（非矛盾）：装载后的标签恢复发生在 `LUMIR_READY` 之后、不在任何被测量的端点里，
  因此「恢复 N 个标签」的耗时对 perf 门禁结构性不可见——design §9 原本把诊断日志 `session_restored{count}` 记为
  观察点，而该事件**并未实现**（`logging.rs` 白名单里没有它），这条已落 `docs/backlog.md` 第 10 条。
- **proposal 的两张「已建议口径」表**：逐行核对**无翻转**——12 条 mock 口径（不命名 / 新增后自动切 / 单 vault
  入口常驻 / 摘要+路径两行 / 最近打开倒序 / 切回不提示跳过才提示 / 不做过渡元素 / 三动作点名当前 vault /
  失效保留+重新定位+已归档在列表+不给移除 / 空态沿用 D5-D6 / 浮层 320px 溢出左栏 / `Cmd-o` + ↑↓/Enter/Esc）
  与实现一致；实现面 9 条（存哪 / 存什么 / 何时写 / 恢复怎么开 / 恢复的代价 / 复用链路 / 列表线程 /
  `last_opened_at` / basename 收敛）全部落地。裁决点 1 定为方案 A，与 design §7 的落地形态一致。
