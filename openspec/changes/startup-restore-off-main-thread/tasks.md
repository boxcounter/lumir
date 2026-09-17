# Tasks: startup-restore-off-main-thread

## 1. 后端：启动恢复移出主线程

- [x] 1.1 `VaultInner` 增 `generation: u64`（启动 0）与 `restore_pending: bool`；`VaultState` 增 `begin_restore() -> u64`（置 pending，返回当前世代）与 `finish_restore(generation, outcome) -> bool`（单次持锁：比对世代与 `root.is_some()`，不符则整体丢弃含失败 notice；无论哪条分支都置 `restore_pending = false`）
- [x] 1.2 拆 `open_vault`（`src-tauri/src/commands.rs:198`）为 `prepare_vault_open`（remap 门 / `reconcile_vault` / `fs_io::watch` / `scan_workspace` / `build_graph`，无状态副作用；remap 候选短路返回行为不变）与 `commit_vault_open(state, prepared, expect_generation: Option<u64>) -> bool`（提交时 `generation += 1`）；`vault_open` / `vault_open_path` 走「prepare + 无条件 commit」，对外行为与现状等价
- [x] 1.3 `src-tauri/src/lib.rs` 的 setup：保留 `logging::init` → `ready::emit_ready` → `install_menu_overrides` 的相对顺序，把 `restore_last_vault(app.handle())` 换成 `start_restore(app.handle())`（起命名线程 `lumir-vault-restore`，不 join、不等待）；setup 内 MUST NOT 再出现 `config::load` 与 `open_vault` 的同步调用
- [x] 1.4 恢复任务：`begin_restore` → `config::load` → `last_vault` 校验 → `prepare_vault_open` → `finish_restore`；四条结束路径（成功 / 无 `last_vault` / 路径失效 / 配置加载失败或打开失败）都发 `app.emit("vault:restore_finished", ())`（无载荷），文案与 `src-tauri/src/lib.rs:377-402` 逐字一致
- [x] 1.5 用 Drop guard（或等价结构）保证「清 `restore_pending` + 发完成信号」在提前 `return` 与 debug unwind 下都成立（release 的 `panic = "abort"` 不依赖它）
- [x] 1.6 `VaultStatus` 增 `restore_pending: bool`（`src-tauri/src/commands.rs:107`），`vault_current`（`:375`）回填；跑 `cargo test` 重新导出 `src/bindings/VaultStatus.ts` 并把导出结果一起提交
- [x] 1.7 恢复线程内的 `State` 取用：`AppHandle::clone()` 进闭包后再在闭包内 `handle.state::<VaultState>()`（`tauri::State<'_, T>` 不能跨线程传递）

## 2. 前端：启动三态与让位规则

- [x] 2.1 `src/ipc.ts` 增 `onVaultRestoreFinished(handler)`（订阅 `vault:restore_finished`，返回退订函数，与 `onFsEntryChanged` / `onQuitBlocked` 同形）
- [x] 2.2 `src/main.ts` 启动序列改为「先订阅、再拉取」：`onVaultRestoreFinished(() => { if (!vaultLoaded) void refreshVaultStatus(); })` 之后立即 `refreshVaultStatus()`；`refreshVaultStatus` 中 `vault` 非空走既有 `loadVault(..., restored = true)`，否则 `tree.showEmpty(status.restore_pending ? 恢复中文案 : status.notice)`
- [x] 2.3 让位规则落到代码并留注释：完成信号只在 `!vaultLoaded` 时生效（`vaultLoaded` 是既有变量，`src/main.ts:51`，`loadVault` 内置 true）；失效路径（picker 取消 / 打开异常 / remap 候选短路）不得把它置 true
- [x] 2.4 `文案-Copy.md` 追加恢复中提示条目（编号按 deck 末位连续追加，当前末位 D94；含位置/角色/中文/English/设计意图五要素），并在文末「文案实现备注」段落登记归属文件
- [x] 2.5 `src/main.ts:489` 的 `lumir:vault-ready` 发射点补注释：前端装载完成（面向就绪管线/测试）vs 后端 `vault:restore_finished`（面向启动状态机）的分工；不改事件名与语义

## 3. 测试与验收

- [x] 3.1 Rust 单测（`src-tauri/src/commands.rs` 的 `mod tests`）：`begin_restore` 置 pending；`finish_restore` 在世代不符时丢弃且不覆盖 `root`/`notice`；一致路径提交并自增；四条结束路径后 pending 必为 false
- [x] 3.2 Rust 集成测（`src-tauri/tests/workspace_scenarios.rs`）：用户打开 vault 后到达的过期恢复结果被丢弃，当前 vault 仍是用户那个（可无线程构造：直接调 prepare/commit 与 finish 的两阶段 API）
- [x] 3.3 新增真机验收场景（文件名 / `id` / `item` 三者一致，**号取落地时「待真机验收」列表的实际末位项号**：评审时末位为 15，预计占 **16**；不得复用既有的 10/11/12/13/14——`12-links.md` 已占 `item: 12`，且 `run.mjs:60` 的筛选同时按 `id` 前缀与 `item` 号匹配，重号会让 `node run.mjs 12` 串选两个场景。落地时把本节、5.4 与 `scripts/acceptance/README.md` 三处的号一并改齐）：① 默认 config（`last_vault` = 验收 vault）启动后自动进入 vault、无「恢复中」文案残留（`shot` 证据）；② `last_vault` 指向不存在目录重启后为未打开空态 + 「上次打开的 vault 已不可用」提示 + 「打开 vault」入口存在
- [x] 3.4 验收 runner 的 `configWrite`（`scripts/acceptance/lib/execute.mjs:650`）支持覆盖 `last_vault`（缺省保持现状=沿用当前值），供 3.3 的失效路径使用；同步更新 `scripts/acceptance/README.md` 的动作表
- [x] 3.5 `tests/visual/scenes/tauri-stub.ts` 的 `vault_current` 桩补 `restore_pending` 字段（含可注入 `true` 的选项）；新增元素级视觉断言 `tests/visual/scenes/startup-restore.spec.ts`：恢复中态与既有空态同布局（`.ft-empty` / `.ft-notice` / 打开按钮），**不新增或更新整页基线**
- [ ] 3.6 可选证据（非门禁）：用 ~6000 md 的合成 vault（约 45MB）起 dev app，截图记录「首帧（恢复中态）→ 树出现」的先后与耗时，附在证据里供 Alex 判手感

## 4. 文档与口径

- [x] 4.1 `docs/specs/perf-measurement.md` §1「端点定义」补一句：`LUMIR_READY` 不含也不等待 `last_vault` 自动恢复，该端点的语义是「事件循环可接管」而非「用户首帧」，恢复耗时不经此端点；**不动**端点定义、合同数字、门禁模式与阈值
- [x] 4.2 归档前后同步 `docs/backlog.md` 第 12 条状态（并就地更正其机制表述：不是「run loop 未启动」，而是「主线程被占在事件循环首个回调内」，证据见 design.md §1）与 finding `20260917-worker-rustasync-bug-restore-last-vault-setup-scan-build-graph-perf.md`
- [x] 4.3 确认 `openspec/specs/perf-measurement/spec.md` 与本 change 无 requirement 级冲突（本 change 不产生 perf-measurement 的 delta）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `scripts/gate.sh quick` 全绿（含 bindings 漂移与 tsc）
- [x] 5.3 `scripts/gate.sh visual` 全绿；本 change 不更新整页基线，若实现期发现必须更新，先交 Alex 过目再执行 `--update`
- [x] 5.4 `node scripts/acceptance/run.mjs --check` 通过后，按 3.3 落地时的 `id` 前缀跑该场景（`node scripts/acceptance/run.mjs <该 id>`），全 PASS（证据留在 `test-results/acceptance/`，不入 git）
- [ ] 5.5 冷启动读数前后对比（本地观察，不作阈值判定）：确认 `LUMIR_READY` 的出现时刻无显著变化（预期不变，本 change 不宣称性能改进）；若 CI 冷启动 median 回退超 40%，按真回归排查，不得调整基线
- [ ] 5.6 归档前对账一次 design §4.5 显式化过的语义边缘（恢复完成时无标题缓冲继承手动打开语义）：若 Alex 在节点 1 把它收紧，则按新 requirement 改 spec 增量与实现，不得沿用「继承既有语义」口径；未收紧则本项无操作，勾掉即可
