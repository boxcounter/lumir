# Design: startup-restore-off-main-thread

- Change ID: startup-restore-off-main-thread
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

本文件承载 proposal 里读不出实现后果的三件事：**机制核实（含对 finding 机制表述的更正）**、**用户操作边界与并发让位规则**、**ready 口径论证**。实现形状（函数切分、字段名）只是建议，实现期可在不改变本文结论的前提下调整。

## 1. 机制核实：恢复确实推迟首帧，但原因不是「run loop 未启动」

信源全部为库源码（cargo registry 内的实际版本），非文档推断：

1. `tauri-2.11.5/src/app.rs:1423-1427`：`RuntimeRunEvent::Ready` 分支里调用 `crate::app::setup(&mut self)`（失败即 panic）。也就是说**用户 setup hook 由事件循环的首个回调驱动**——此时事件循环已经启动，我们正跑在它的回调里。
2. `tauri-runtime-wry-2.11.4/src/lib.rs:4174`：`Ready` 来自 tao 的 `Event::NewEvents(StartCause::Init)`，即事件循环首次迭代。
3. `tauri-2.11.5/src/app.rs:2521-2532`：`fn setup` 先按 config 建窗口（`:2524-2525 WebviewWindowBuilder::from_config(...).build()`），再调用户 hook（`:2530-2531`）。所以恢复执行时**窗口已存在**。
4. 恢复在同一个回调内同步跑（`src-tauri/src/lib.rs:97`），回调返回前主线程无法处理别的 AppKit 事件、也进入不了下一次绘制。

**更正**：M154 finding 与 `docs/backlog.md` 第 12 条写的是「run loop 未启动」——严格说不成立；成立的是「主线程被占在事件循环的首个回调里，绘制与输入都被推迟到回调返回之后」。**结论不受影响**：这 ~125–770ms 直接加在「用户看到可用界面」之前，且**不是** command，async 化 command 覆盖不到它。本 change 的处方（把工作移出主线程）在两种表述下都成立；更正只影响对「为什么 ready 端点是失明」的归因——见 §6。

**量级信源**：M154 实测（release 构建；harness 以 path 依赖直调本仓真实函数，非复刻；真实 vault 只读）。真实 vault scan 14.0ms + build_graph 111.2ms ≈ 125ms；合成 4×（8884 项 / 6100 md / 45MB md）32.9 + 736.7ms ≈ 770ms。finding `20260917-worker-rustasync-bug-restore-last-vault-setup-scan-build-graph-perf.md`。

## 2. 方案总览：时序对照

现状（主线程 = 事件循环回调，`▓` 为被占时间）：

```
事件循环首个 Ready 回调 ├─ logging::init ─ emit_ready(LUMIR_READY) ─ 菜单覆盖 ─▓ config::load + open_vault(125–770ms) ▓─┤ 回调返回
                                                                                                    └── 此间窗口存在但无法绘制
webview 装载/挂载 ─────────────────────────────────────────────────────────────────────────────────────────────────────►
                                                                                                            ├ vault_current 拉取
```

本 change 之后：

```
事件循环首个 Ready 回调 ├─ logging::init ─ emit_ready ─ 菜单覆盖 ─ start_restore（起线程，立即返回）─┤ 回调返回 → 立即可绘制
                                                                        │
lumir-vault-restore 线程 ───────────────────────────────────────────────┴─ config::load → is_dir → open_vault（scan + build_graph）→ 世代校验 → 提交
webview 装载/挂载 ──────────────► 订阅 vault:restore_finished + 拉 vault_current ─► [pending? 恢复中态 : 终态] ─► 恢复完成 → 事件 → 再拉一次 → 进树
```

要点：**ready 行的出现时刻不变**（仍在恢复之前，`lib.rs:94` → `:97` 的相对位置不动），所以冷启动读数预期不动；变化的是回调不再被恢复占用。

## 3. 后端：两阶段 `open_vault` + 打开世代号

### 3.1 三态与字段

`VaultStatus`（`src-tauri/src/commands.rs:107`，ts-rs 导出到 `src/bindings/VaultStatus.ts`）新增：

```rust
pub restore_pending: bool,   // true = 启动恢复仍在进行；false = 终态（vault 为 Some，或未打开 + 可选 notice）
```

不用 `notice` 字段兼职表达「进行中」：`notice` 的语义是**终态**的人话原因（失败原因 / remap 提示），且 `open_vault` 成功时会清空它（`commands.rs:238`）。用一个终态字段表达进行态会让前端无法区分「恢复失败」与「正在恢复」，也会污染 `notice` 现有的「取走后仍保留（幂等）」口径。

### 3.2 世代号与两阶段提交

`VaultInner` 增加 `generation: u64`（启动为 0）。规则：

- **提交点自增**：任何一次**成功**的 vault 打开（用户 `vault_open` / `vault_open_path` / remap 确认重开 / 启动恢复）在写入 `root`/`watcher`/`graph` 的同一次持锁内 `generation += 1`。
- **恢复任务**：`begin_restore()` 记下当时的世代（并置 `restore_pending = true`），完成 IO 后 `finish_restore(generation, outcome)`：**同一次持锁**内比对世代与 `root.is_some()`，不一致则整体丢弃（不写 root/watcher/graph/notice），一致则提交并自增；无论哪条分支都置 `restore_pending = false`，返回「是否应用」。
- **失败不产生世代跃迁**：用户打开失败（权限错、目录不可读）不提交、不自增，因此启动恢复的结果随后仍可生效——与前端「只有**成功**装载才让位」对称。

实现形状建议：把 `open_vault`（`commands.rs:198`）拆成

- `prepare_vault_open(app, root, force_new) -> PreparedVaultOpen`：全部无状态副作用的活——remap 门、`reconcile_vault`、`fs_io::watch`（watcher 随返回值持有，未提交即 drop = 不监听）、`scan_workspace`、`build_graph`。remap 候选短路返回也在这里（不产生 `Prepared`，行为不变）。
- `commit_vault_open(&state, prepared, expect_generation: Option<u64>) -> bool`：一次持锁写入；`expect_generation` 为 `Some` 时先比对（恢复路径用），不匹配返回 `false`。

这样并发正确性可**无线程测试**：单测里 `begin_restore()` → 模拟用户提交（`commit_vault_open(..., None)`）→ `finish_restore(旧世代, ...)` 断言返回 `false` 且 root 仍是用户那个。

为什么必须有这层：`open_vault` 的 IO 目前不在锁内（锁只覆盖最后的提交），并发是**本 change 新引入**的——今天主线程串行执行掩盖了它。少了世代校验就会出现：用户在后端提交了 B，恢复线程随后用 A 覆盖 → 前端显示 B 的树、后端 root 是 A，后续打开/读取都按 A 解析（跨 vault 的静默错乱）。

### 3.3 线程选型

用 `std::thread::Builder::new().name("lumir-vault-restore")`：

- 仓内先例：`lumir-log`（`logging.rs:196`）、`lumir-fs-debounce`（`fs_io.rs:633`）都是命名 `std::thread`；本仓目前不使用 `tauri::async_runtime`。
- 任务是纯阻塞 IO（目录遍历、文件读、FSEvents 建流），没有 async 组合需求；占住一个 tokio blocking worker 没有收益。
- 命名线程在采样/profiling 里可辨认。

`tauri::async_runtime::spawn_blocking`（`tauri-2.11.5/src/async_runtime.rs:290`，惰性建 runtime，setup 内可用）是等价备选，不改变任何结论。

**实现注意**：`tauri::State<'_, T>` 借用自 handle，不能跨线程传递；线程闭包内需先 `AppHandle::clone()`，再在闭包内 `handle.state::<VaultState>()` 取用。`app.emit` 与 `AppHandle` 都是线程安全的，可从恢复线程发事件。

### 3.4 完成通知与「所有结束路径」

恢复任务结束（成功 / 无 `last_vault` / 路径失效 / 配置加载失败 / `open_vault` 失败）时一律 `app.emit("vault:restore_finished", ())`——**无载荷**。原因：载荷会在「恢复读状态」与「用户提交」之间产生竞态（emit 前读到的可能是已被丢弃的 A），而前端本来就要以 `vault_current` 为权威，载荷是多余的风险面。

用 Drop guard 或等价的兜底结构保证「`restore_pending` 必被清零 + 完成信号必被发出」，覆盖提前 `return` 与 debug profile 下的 unwind（`src-tauri/Cargo.toml:52` 的 `panic = "abort"` 只作用于 release：release 下 panic 直接 abort 整个进程，不存在卡在恢复中的状态；debug 下 unwind，Drop guard 生效）。

## 4. 前端：启动三态 + 「用户成功装载优先」

### 4.1 启动序列（顺序是契约的一部分）

```ts
await onVaultRestoreFinished(() => { if (!vaultLoaded) void refreshVaultStatus(); });  // 先订阅
void refreshVaultStatus();                                                            // 再拉（权威）
```

`refreshVaultStatus()`：

- `status.vault` → 未装载过则 `loadVault(..., restored = true)`（既有函数，`src/main.ts:484`）。
- 否则 `tree.showEmpty(status.restore_pending ? 恢复中文案 : status.notice)`。

先订阅、后拉取是必需的：反过来的话，恢复在两者之间完成 → 事件无人接收、拉取又早于完成 → 界面永久停在恢复中态。

### 4.2 让位规则（与后端同源的不变式）

**不变式：前端「成功装载」与后端「成功提交」在同一处触发；任一发生，恢复结果就在两层同时被丢弃。**

| 事件 | 后端 | 前端 | 结果 |
|---|---|---|---|
| 恢复成功，用户没动 | 提交 A，世代 +1 | `loadVault(A)` | 一致 ✓ |
| 恢复成功，用户已成功打开 B | 恢复比对世代不符 → 丢弃 A | 已 `vaultLoaded`，忽略完成信号 | 一致（B）✓ |
| 用户 picker 取消 | 无提交，世代不变 → 恢复仍可提交 A | 未成功装载 → 应用信号 → `loadVault(A)` | 一致（A）✓ |
| 用户打开 B 失败（异常） | 无提交 → 恢复仍可提交 A | 未成功装载 → 应用信号 → `loadVault(A)` | 一致（A）✓ |
| 用户打开未注册目录 → remap 候选短路 | 无提交 → 恢复仍可提交 A | 未成功装载 → 应用信号 → 树进 A，remap 浮条仍在 | 一致（A + remap 提示）✓ |
| 恢复失败，用户已打开 B | 丢弃失败 notice | 忽略信号（已装载） | 一致（B，无 A 的失败提示）✓ |

`vaultLoaded` 是既有变量（`src/main.ts:51`，`loadVault` 内置 true），不需要新状态。

### 4.3 恢复中态的视觉

复用**未打开空态的布局**（`src/tree.ts:304-323` 的 `.ft-empty`：notice 行 + 说明行 + 打开按钮），只在 notice 位置显示恢复中文案。好处：零新样式、零布局变化，现有整页视觉基线不受影响；恢复中态天然带着「打开 vault」入口（也就是 §4.2 里「用户可抢先」的实现）。文案进 `文案-Copy.md`（编号按 deck 末位追加，当前末位 D94）。

### 4.4 「打开文件」在恢复期间的状态：无入口，因此不需要守卫

恢复进行中还没有 vault 装载，因此：文件树未渲染（无 `.ft-row` 可点）、没有任何标签或文档、编辑器是空态。`openFile`（`src/main.ts:200`）的全部调用面都依赖这三者之一——树点击（`src/main.ts:476`）、文档内链接跟随与一键创建（`src/link-follow.ts:150/177/294`）、保存链路（另存为 `src/save-controller.ts:445`、恢复备份 `:648`）、以及崩溃备份恢复入口（`save.checkRecovery()`，只在 `loadVault` 尾部调用，`src/main.ts:506`）。所以本 change **不需要**为「恢复期间打开文件」加状态守卫；spec 里也只对「打开 vault」定边界。这一条写进 design 是为了审计：将来若新增任何「启动即可用」的打开入口（如会话恢复、最近文件列表），必须先回答它与恢复进行态的关系。

### 4.5 恢复完成时「无标题缓冲」的处置：显式化既有语义

自动恢复完成触发 `loadVault` 时，对**无标题缓冲**（`session.path === undefined`）继承手动打开 vault 的既有语义：**守卫放行、缓冲丢弃**。

- 代码事实：`loadVault` 先过 `save.guardVaultSwitch()`（`src/main.ts:487`），该守卫的脏判据是 `session.path !== undefined && session.dirty`（`src/save-controller.ts:240-247`）——无标题文档不算脏，因此放行；随后 `editor.reset()`（`src/main.ts:496`，实现见 `src/editor.ts:1494`）作废全部标签、只留一个未命名空文档，用户在恢复窗口内敲进无标题缓冲的内容随之消失。
- 这条语义**不是本 change 引入的**：手动打开 vault 走同一个 `loadVault`、同一个守卫，该语义 Alex 已在 M149 守卫口径下接受（有文件路径的标签之间是切换、不设守卫；无标题文档另有 `openFile` 的显式守卫）。本 change 唯一改变的是它的**可达性**：恢复在 setup 内同步完成时，webview 挂载时 `vault_current` 已是终态，用户没有机会在恢复完成前动编辑器；异步窗口（大 vault 770ms+）把这条路径从「不可能」变成「可达」。
- 因此本 change 不改变语义、不引入新机制。若 Alex 要收紧（例如「恢复完成时编辑器非空则延迟应用恢复结果」），那是新语义，需在节点 1 明确后另加 requirement；proposal 的「本 change 内的一个裁决点」一节已登记这个边缘，不留给实现期偶遇。

## 5. 失败路径逐条（行为不变的部分）

| 情形 | 现状（`src-tauri/src/lib.rs:377-402`） | 本 change 之后 |
|---|---|---|
| 无 `last_vault` | 直接返回，无提示 | 同；额外：`restore_pending` 转 false + 发完成信号 |
| 路径不存在 / 不是目录 | `set_notice("上次打开的 vault 已不可用：{last}，请重新选择目录")` | 文案逐字不变；不再阻塞主线程（`is_dir()` 在慢卷/未挂载网络卷上可能长时间阻塞，这也是本 change 顺带修掉的） |
| 配置加载失败 | `set_notice("配置加载失败：{e}")` | 文案不变 |
| `open_vault` 失败 | `set_notice("恢复上次 vault 失败：{e}")` | 文案不变 |
| remap 候选 | `set_notice("发现可能已移动的 vault，请确认重映射")` | 文案不变 |
| 用户已抢先打开 | （不存在该情形） | 丢弃上述全部（含 notice） |

## 6. ready 口径论证

### 6.1 `LUMIR_READY` 的位置与语义：不变

- 事实：`emit_ready` 在恢复之前（`src-tauri/src/lib.rs:94` → `:97`），本 change 之后仍在恢复**任务启动之前**。因此本 change **不改变冷启动读数**，不得据此宣称性能改进。
- 端点语义：`docs/specs/perf-measurement.md:69` 把辅口径定义为「从 `run()` 入口到 Tauri setup 完成（即 webview 创建后、**事件循环接管前**）」。按 §1 的核实，括号里那句在实现上不准：setup 本身就是由事件循环首个回调调用的，ready 行是在**回调内**打印的，而该回调随后还被 125–770ms 的同步恢复占着——今天的实情是「事件循环已接管，但主线程仍不可用」（更准的描述应为「窗口创建后、事件循环首个回调结束前」）。修掉同步恢复之后，该端点**字面不变而语义变真**：回调随即返回，事件循环确实可以接着跑。本 change 不改这一行的字面（见下条），只在 §1 补说明。
- 因此本 change 对 `perf-measurement` 的处理是：**不动 requirement 文本、不动端点定义、不动阈值与门禁**；只在 `docs/specs/perf-measurement.md` §1 补一句「ready 不含也不等待 `last_vault` 自动恢复；该端点的语义是『事件循环可接管』而非『用户首帧』，恢复耗时不经此端点」，把这个裁决记录在案，防止后人用「把 ready 移到恢复之后」来「修」这个缺口（那是拿指标换真实体验：延迟一分不减，只把延迟记进数里）。

### 6.2 `lumir:vault-ready` 是否升格为正式信号：不

1. 它是 webview 侧的 `CustomEvent`（`src/main.ts:489`，全仓无消费者）。CI 冷启动 harness 读的是 app 的 stdout（`scripts/perf/cold-start.mjs:13`），读不到 webview 侧信号；`docs/specs/perf-measurement.md:71` 已把这个限制写死（headless CI 无法可靠读 webview console）。
2. 要把它做成合同端点，必须先造一条后端 → stdout 的通道（例如 `LUMIR_VAULT_READY`），那就是**新端点 = 新合同**（阈值、门禁模式、滚动基线一套）。perf spec 对演进端点的既有口径是「由后续 OpenSpec change 承载」，不该搭在本 change 上。
3. 时序修好之后，该耗时已不在用户可见路径上（首帧不再等它），做成合同门禁的价值大幅下降；真正需要它的场景是「恢复悄悄变慢了」的**观察**，那是诊断日志的活，不是拒合门禁的活。
4. 结论：保留 `lumir:vault-ready` 现状（不删、不改名、不改语义），实现期在发射点补一行注释说明它与后端 `vault:restore_finished` 的分工——**前者=前端装载完成（面向就绪管线/测试），后者=后端恢复结束（面向启动状态机）**。两个名字太像，注释是唯一防线。

### 6.3 那「恢复耗时」还需要可见吗？

需要，但不通过合同端点。本 change 的 Non-goal 里明确不做新端点；若 dogfood 期需要盯恢复耗时，走独立 change 加**诊断事件**（`logging.rs` 的事件白名单 + 一条 `vault_restore{dur_ms, entries}`），那是 agent 可读的观察面，与拒合门禁解耦。本 change 不夹带。

## 7. 备选方案与拒绝理由

| # | 方案 | 拒绝理由 |
|---|---|---|
| A1 | `tauri::async_runtime::spawn_blocking` 替代命名线程 | 不是拒绝而是等价备选（§3.3）；选命名线程只是为了与仓内既有两个后台线程同形。 |
| A2 | 把 `emit_ready` 移到恢复之后，让门禁覆盖恢复耗时 | 延迟一分不减（恢复仍占主线程），只是把延迟记进指标；且会让「冷启动 <300ms」变成量一个用户看不到的点。（§6.1 已把理由写进 spec 说明） |
| A3 | 继续同步恢复，只把 `build_graph` 做快（如 M154 §7 的 canonicalize 优化，约 46/111ms） | 只把 125ms 压到 ~80ms，结构性放大没解决（vault 越大线性涨）；且那是独立优化项，不是本 change 的手段。 |
| A4 | 恢复期间不开放打开入口（恢复完成前不出空态按钮） | 把用户锁在 IO 后面：慢卷/网络卷上 `is_dir()`/枚举可能长时间阻塞且本 change 不引入超时；且「用户主动改选目录」是合法意图，不该被启动流程否决。 |
| A5 | 前端轮询 `vault_current` 直到 `restore_pending` 为 false | 轮询间隔是没依据的常数，慢恢复时要么延迟大要么白跑；事件 + 权威拉取更简单也更省。 |
| A6 | 让 `vault_current` 阻塞到恢复结束再返回 | 把同步阻塞搬进 IPC：前端在等待期间连恢复中态都渲染不出来，等于没修。 |

## 8. 风险与未决点

- **事件丢失**：webview 挂载晚于恢复完成时事件收不到——由「先订阅后拉取 + 拉取为权威」覆盖（§4.1），spec 里作为 scenario 固定下来。
- **debug profile 下的 panic**：靠 Drop guard 保证 `restore_pending` 清零（§3.4）；release 下 `panic = "abort"` 直接终止进程，不会留下永久恢复中态。
- **锁竞争**：`vault_current` 目前跨 `reconcile_vault` + `scan_workspace` 持锁（`commands.rs:375-390`），恢复线程的提交要等它；这是既有的锁粒度问题（M154 survey 的另一条），本 change 不加剧也不修——恢复的 IO 全部在锁外。
- **恢复中态的短暂出现**：典型 vault 下前端多半在恢复完成后才首次拉状态，恢复中态常不可见；慢 vault 下它是刻意可见的诚实状态。视觉上不新增整页基线，只加元素级断言。
- **未决（交节点 1）**：恢复进行中是否开放「打开 vault」入口。本 change 选**开放**（用户优先，理由见 §7 A4）。若 Alex 翻转成「恢复期间不出入口」，改动面很小：恢复中态换成不带按钮的空态变体，同时 §3.2 的世代校验可以退化为断言（后端不再有并发提交者）——但保留它更稳，不建议退。
- **将来的交互**：多标签会话恢复（backlog 第 10 条）若要接启动流程，应复用 `vault:restore_finished` 这条「启动恢复已结束」的信号，而不是另起一个时点。
