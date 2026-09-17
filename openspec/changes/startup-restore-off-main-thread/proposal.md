# Proposal: 启动时的 last_vault 自动恢复移出主线程（首帧不再等 vault 恢复）

- Change ID: startup-restore-off-main-thread
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Lumir 每次启动都会自动恢复上次的 vault。这件事目前发生在 Tauri setup 的主线程上，**在用户看到可用界面之前**：

- `src-tauri/src/lib.rs:97` 的 `restore_last_vault(app.handle())` 在 setup 内同步执行（`fn restore_last_vault` 见 `src-tauri/src/lib.rs:377`），内部串行做注册表 IO → 起 watch → 全量枚举 → 逐 md 读文件建 wikilink 索引（`src-tauri/src/commands.rs:198` 的 `open_vault`，索引构建见 `:154` 的 `build_graph`）。
- 实测（M154 survey，release 构建，harness 以 path 依赖直调本仓真实函数；真实 vault `/Users/boxcounter/Downloads/Everything-copy` 只读）：真实 vault **约 125ms**（scan 14.0ms + build_graph 111.2ms），合成 4× 规模（8884 项 / 6100 md / 45MB md）**约 770ms**（32.9 + 736.7ms）；索引耗时随 md 字节数近似线性（约 12–16ms/MB）。信源：`.tower/comms/findings/20260917-worker-rustasync-bug-restore-last-vault-setup-scan-build-graph-perf.md`。
- 机制（**对 finding 机制表述的更正**，见 design.md §1）：tauri 2.11.5 里用户 setup hook 由事件循环的**首个 `Ready` 回调**驱动（`tauri-2.11.5/src/app.rs:1423-1427`），hook 先按 config 建窗口（`app.rs:2524-2525`）再执行用户代码（`app.rs:2530-2531`）。所以准确的描述不是「run loop 未启动」，而是「恢复在主线程的事件循环回调内同步跑，回调返回前主线程无法进入下一次绘制」——结论不变：这段耗时**直接加在用户看到可用界面之前**。
- 它是 M154 调查里唯一既「用户可感」、量级又最大的主线程阻塞项，而且**不是 command**，`#[tauri::command(async)]` 覆盖不到它。

**可见性缺口**：冷启动性能合同的端点是 spawn → stdout 出现 `LUMIR_READY`（`docs/specs/perf-measurement.md` §1「端点定义」），而该行在恢复**之前**打印（`src-tauri/src/lib.rs:94` → `:97`，打印点 `src-tauri/src/ready.rs:38`）。因此 <300ms 合同与 CI 相对回归门禁对这段耗时结构性失明。这个缺口的正确修法**不是**把 ready 行挪到恢复之后（那只会把延迟记进门禁、真实体验一点不变），而是让这段工作不再占着主线程。

**已裁决**：Alex 对 `docs/backlog.md` 第 12 条回复「好」——立项走 OpenSpec change（改启动时序属行为变更，不做补丁直推）。本 change 只到提案为止，节点 1 通过后才进入实现。

## What Changes

1. **启动恢复移出主线程**：setup 只做「日志初始化 → 发 ready → 装菜单覆盖 → 起恢复任务（立即返回）」。恢复任务在一支命名线程上完成配置读取、`last_vault` 校验、枚举与索引建立；成功才提交到 `VaultState`。setup **MUST NOT** 再同步执行 `config::load` 与 `open_vault`。
2. **启动三态**：`vault_current` 返回的 `VaultStatus` 增加 `restore_pending` 字段，区分「恢复进行中」与「终态（已打开 / 未打开）」。恢复进行中时前端按**未打开空态的布局**显示恢复中提示（新增一条文案），MUST NOT 把它呈现成「尚无 vault」的终态；恢复完成后无需用户操作自动进入该 vault。
3. **恢复结果的两条通道**：`vault_current` 的返回值是**权威状态**；新事件 `vault:restore_finished`（无载荷）只作**唤醒信号**。前端启动时先订阅该事件、再拉一次状态，因此 webview 挂载晚于恢复完成（事件丢失）时终态照样正确。
4. **恢复期间的用户操作边界 = 用户优先**：恢复进行中「打开 vault」入口保持可用（用户不被 IO 挡在外面，慢卷/网络卷尤其重要）。用户在恢复期间**成功**打开另一个 vault 时，恢复结果（含失败提示）被整体丢弃，用户的选择胜出：
   - 后端：`VaultState` 增加打开世代号；恢复任务在提交前比对世代，世代已变则整体丢弃（含**不写**它的失败提示）。
   - 前端：只有在尚未成功装载任何 vault（`vaultLoaded === false`）时才应用恢复完成信号。
   - 两层规则同源：**后端「成功提交」与前端「成功装载」在同一处触发**，因此任何一条路径上两层都同时让位或同时生效（design.md §4 的不变式）。
   - 另一个操作面「打开文件」在恢复期间**无入口**（无文件树、无标签、无文档，`openFile` 的调用面——树点击、链接跟随/一键创建、保存链路、崩溃备份恢复入口——全部依赖其中之一），因此不需要额外守卫——论证与审计口径见 design.md §4.4。
5. **失败路径逐条保号**：成功 / 无 `last_vault` / 路径已失效 / 配置加载失败 / `open_vault` 失败，**每一条**结束路径都使 `restore_pending` 转 `false` 并发完成信号；人话提示文案与现状逐字一致（`src-tauri/src/lib.rs:377-402` 现文案）。恢复流程不引入超时。
6. **ready 口径**：`LUMIR_READY` 的发射位置与语义**保持不变**——它是「事件循环可接管」的标记，恢复耗时不计入该端点，也 MUST NOT 用「把该标记移到恢复之后」的方式让门禁覆盖它。**不新增任何 perf 端点、不动阈值与门禁口径、不动合同数字**；只在 `docs/specs/perf-measurement.md` §1 补一句说明，把「为什么不把恢复计入端点」这个裁决记录在案（见 design.md §6）。

## 需要 Alex 知悉的语义变化

1. **慢 vault 上启动先看到「恢复中」而非空态**：有 `last_vault` 且恢复尚未完成时，文件树区显示恢复中提示（空态布局 + 提示行），而不是「打开一个目录作为 vault」的空态终态。典型 vault（~125ms）下前端多半在恢复完成后才首次拉状态，用户看不到这一态。
2. **恢复期间用户可以抢先打开别的 vault**：这是刻意的（不让 IO 把用户锁在外面）；代价是用户可能在「恢复中」的短暂窗口里主动改选目录，此时上次 vault 的恢复被丢弃。
3. **冷启动读数预计不变**：ready 行本就在恢复之前（`lib.rs:94` → `:97`），本 change 不改变它的出现时刻，因此**不宣称任何性能改进**；改善的是未被门禁量到的用户可见首帧。若 CI 冷启动 median 出现 >40% 回退，按既有口径当真回归排查，**不得**以本 change 的名义调整基线。

## 本 change 内的一个裁决点（翻转成本很低）

**恢复进行中是否保留「打开 vault」入口**：本 change 选**保留**（用户优先，理由与备选见 design.md §7 A4、§8）。若 Alex 倾向「恢复完成前不出入口」，翻转只落在两处——恢复中态改为不带按钮的空态变体、以及后端世代校验从「防线」降格为「断言」（仍建议保留）。请在节点 1 一并裁掉，避免实现期再回来改口径。

## Non-goals（非目标）

- **不新增 perf 端点、不改阈值 / 门禁模式 / 合同数字 / 滚动基线**。把 `lumir:vault-ready`（前端 `CustomEvent`，`src/main.ts:489`，全仓无消费者）升格为合同端点**不做**——CI 冷启动 harness 只读 stdout，读不到 webview 侧信号（`docs/specs/perf-measurement.md:71` 已明确「headless CI 无法可靠读 webview console」），要覆盖它必须先造一条后端 stdout 通道，那是新端点=新合同，按既有口径应由后续 OpenSpec change 承载。
- **不做恢复超时**：「多久算超时」是产品裁决，且超时会误伤「能恢复但慢」的 vault；本 change 把慢恢复的代价从「整个界面不可用」降为「树晚出现」，不再需要超时兜底。
- **不改用户主动打开 vault 那条路径的同步性**：`vault_open` / `vault_open_path` 仍是同步 command，其内部 `open_vault` 的枚举仍在主线程跑（用户主动触发、有 picker 作为心理预期）。该项是 M154 survey 的独立条目，不在本 change。
- **不动 `last_vault` 的记忆口径与配置 schema**（ADR 0002 §5）：写入条件、逐字段校验、非法值 warning 全部不变。
- **不删、不改名、不改语义前端就绪事件族**（`lumir:app-ready` / `lumir:vault-ready` / `lumir:*-ready`）：只在新发射点补注释说明它与后端 `vault:restore_finished` 的分工。
- **不做多标签会话恢复**（`docs/backlog.md` 第 10 条）：本 change 只保证恢复过程不阻塞首帧；将来若在启动时恢复标签，复用同一完成信号即可。
- **不改写源文件、不写 vault**（ADR 0003）：恢复只读 vault，日志仍写配置目录（ADR 0003 §3）。

## Impact

- **影响的 specs**：`vault-workspace`（MODIFIED「last_vault 记忆与启动恢复」+ ADDED「启动恢复的时序与可见性」）。`perf-measurement` 的 requirement 文本**不变**（只有 `docs/specs/perf-measurement.md` §1 的一句说明）。`file-tree` 的「未打开 vault 空态」requirement 不变：恢复中态就是「无打开的 vault」时的空态布局，加一行提示，不与之矛盾。
- **影响的代码/系统**：`src-tauri/src/lib.rs`（setup 时序 + 恢复任务）、`src-tauri/src/commands.rs`（`VaultState` 的恢复态与世代号、`open_vault` 拆为准备/提交两阶段、`VaultStatus` 增字段）、`src/main.ts` + `src/ipc.ts`（启动状态机与事件订阅）、`src/bindings/VaultStatus.ts`（ts-rs 重导出）、`src/tree.ts`（空态可承接恢复中提示，若无改动则不动）、`文案-Copy.md`（新增一条恢复中文案）、`docs/specs/perf-measurement.md`（§1 补说明）、验收场景与元素级视觉断言。
- **关联约束**：ADR 0002 §6 性能合同（不改合同数字与门禁）、ADR 0002 §5 配置即数据（不动 schema）、ADR 0003（不写 vault）、ADR 0004（本 change 走 OpenSpec 两节点）。
