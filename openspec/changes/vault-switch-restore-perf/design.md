# Design: vault-switch-restore-perf

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、哪些地方会咬人、哪些结论还没有读数撑」。

## 0. 一句话方案

切换的等待分成三段：**写盘 → 打开 → 逐标签恢复**。写盘段当前零反馈（指示晚起一拍，补上）；打开段是同步 command、占主线程（是否移出走裁决点 3）；恢复段是唯一随标签数线性增长的段（≈21–30ms/标签）——推荐把它拆成「**当帧建齐标签壳** + **文档内容按需填充**」，让等待与标签数脱钩，同时不改变「所有标签一次回来」的外部观感（标签栏、顺序、激活项、会话落盘内容全部照旧）。**先读数、后开工**：本 change 的多数选路都挂在读数上（§7）。

## 1. 现状机制与证据状态

| 段 | 现状机制（代码落点） | 量级 / 证据 | 状态 |
|---|---|---|---|
| 切前写盘 | `saveThenRun` → `await deps.saveAll()`（`src/vault-switcher.ts`；`deps.saveAll` = `save.saveAllDirty()`，`src/main.ts`），指示原在 `proceed()` 内的装载壳里才起（M283 起在写盘前起） | M283 补了 `vault_load_flush` 埋点（阈值 250ms）：验收场景（1 个脏标签、几十 ms）**未触发**，因此本条仍**未测出**；埋点已就位，Alex 在自己 vault 上带着较大的脏文档切一次即可拿到 | **未测（埋点已就位）** |
| 打开（`vault_open_path`） | 不带 `async` 的 command（`src-tauri/src/commands.rs`）⇒ Tauri 语义下**主线程内联执行**：`reconcile_vault` → `fs_io::watch()` → `scan_workspace` → `build_graph` | **M283 实测**（复刻真实形状的合成 vault：2142 文件 / 426 目录 / 1341 md / 6.7MB）——release 直测**两次独立运行**：`scan_workspace` **10.6–13.0ms**、`build_graph` **81.5–94.4ms**、合计 **≈92–107ms**（M154 在同一真实 vault 上的 14.0 + 111.2ms 同量级）；`watch` 建流 **0.4–1.6ms**（debug 真机 0.4–0.5ms / release harness 1.5–1.6ms）——**裁决点 3 的答案**；debug 构建的 app 里 `vault_load_open` 实测 **612–630ms**（≈92–107ms 的 6×，debug 的 Rust 不快，两者不可混比） | **有读数** |
| 树重建 | `setVault` → `expanded.clear()` → `renderAll`；`renderAll` 只对根级子节点 `mountNode` | DOM 行数 = 根级条目数 = 22–24 行；真正的成本是给 2567 个条目建 `Node`/`Map`（O(n)，个位数 ms） | 有读数（结构性） |
| 逐标签恢复 | `for (const path of plan.open) await deps.openPinned(path)`（M283 前）→ M283 起「当帧建壳 + 内容按需」 | M252：46 个标签 992–1359ms（≈21–30ms/标签，77 条目的合成 vault）。**M283 在真实形状的 vault（2567 条目）上复测：40 个标签 901–1056ms ⇒ ≈22–26ms/标签**——**与 77 条目 vault 上的读数同档 ⇒ per-tab 成本基本不随 vault 规模增长**（原先「未验」的那条由此闭合）；改动后同一场景的恢复段见 §1.1 的对照 | **有读数（含跨规模对照）** |

**恢复段读数的外推边界（如实记）**：场景 49 的会话是 46 个 fixture **小文件**（那几个 8MB 稀疏文件是塞进 vault 撑开 `vault_load_open` 观察窗的放大器，不在会话里，见 `scripts/acceptance/scenarios/49-vault-switch-feedback.md` 的 seed 说明与「覆盖边界」节）。所以 21–30ms/标签 **不是**文件读取代价，而是每标签的固定成本：IPC 往返（`fsReadSnapshot`）+ `editor.createSession()` + `tabs.activateTab` + `editor.reloadSession`（装载走前台路径：`EditorState.create` + 视图事务 + 装饰层 + 就绪事件）+ `readingPositions.restoreFor` + `afterLoad`。固定成本这一性质让它可以跨文件大小外推，**但不能保证跨 vault 规模外推**——该读数取自 77 个条目的合成 vault，真实 vault 是 2567 条目 / 1341 md；per-tab 成本里若有随 vault 索引规模增长的成分（链接解析、附件索引查询），真实 vault 上会更大。**这一条未验，且它是「恢复段是唯一到秒级的段」这个结论的关键依赖。**

## 2. 反馈窗口：现状时序与修法

### 2.1 现状时序（切换一条通道，`requestSwitch`）

```
用户点行 ─► switchGate.request(proceed)
             ├─ dirty? ─► 守卫浮条（三条出口）──「保存并切换」─► await saveAll()  ← 零反馈窗口（可数百 ms）
             └─ 干净 ─────────────────────────────────────────► proceed()
                                                                  └─ loadUserVault.begin()  ← 指示起点
                                                                       └─ vaultOpenPath（同步 command，主线程）
                                                                       └─ applyVault（树重建）
                                                                       └─ switcher.onVaultLoaded(...)  ← 逐标签恢复
                                                                              .finally(vaultLoading.end())
```

两处缺口：

1. **写盘段（§1 第一行）**：指示起点在 `loadUserVault.begin()`，而写盘发生在它之前。dirty 时用户已经选了「保存并切换」——他此刻在等，界面却与「什么都没发生」不可区分。M252 的 spec 文本写的是「出口执行后开始装载时指示照常出现」，即这条缺口是**写在 requirement 里的**，必须改 requirement 才能闭合（proposal 的 What Changes 1）。
2. **打开段（§1 第二行）**：`vault_open_path` 在主线程内联执行 ⇒ 该段 webview 不能重绘，指示只能**静止显示**，而 macOS 在此期间给的 beachball 才是用户实际看到的「转圈提示」。M252 的 proposal 曾用「等待期间事件循环是空的、界面会重绘」作为立论，那句话**成立于恢复段（纯 JS 异步），不完全成立于打开段**。修法唯一：把该段移出主线程（裁决点 3）。本 change 只能把它写成显性边界（delta 里加一句：requirement 只要求指示在窗口内**在场**，不要求它全程动画），不假装已解决。

### 2.2 修法

- 指示的窗口起点随出口一起走：`saveThenRun` 在 `await deps.saveAll()` **之前**起指示（`begin()` 幂等、引用计数），写盘失败（保存未闭环）时撤下并**不**继续切换（`end()` 与既有 `return` 同路）。
- 「放弃修改并切换」「取消」两条出口不变：前者不写盘、出口执行后由 `proceed()` 起指示；后者不装载，MUST NOT 出现指示。
- 「新增 vault…」通道不受影响（选择器返回后起指示，已经是对的）。
- 落地位置：指示的 `begin/end` 装配在 `src/main.ts`（`vaultLoading`），出口时序在 `src/vault-switcher.ts` 的 `saveThenRun`；两者的依赖注入关系（`deps` 里要不要暴露指示开关）由实现期选最小心脏——**倾向**让 `deps.saveAll` 的调用方（装配层）包一层 `loadUserVault`，避免把 UI 句柄塞进 `vault-switcher` 的 deps（它现在是可脱离 DOM 单测的纯状态机，这条性质不要丢）。

### 2.3 实现落点（M283）

指示的开关**经 deps 注入切换门**（`VaultSwitchGateDeps.saveAllWindow: VaultLoadingIndicator`，
装配层传 `vaultLoading` 本身），`saveThenRun` 在 `await deps.saveAll()` 之前 `begin()`、写完
（或写失败/未闭环）立刻 `end()`：写盘的 `end` 与随后 `proceed()` 里装载壳的 `begin` 落在同一批
微任务里（中间不让出渲染），指示因此是一个不闪的连续窗口。

- 「保存并切换」：写盘前起指示（本 change 修的缺口）；
- 「放弃修改并切换」：不起（不写盘，指示由装载壳自己起）；
- 「取消」：不起。

`src/main.ts` 的 `saveAll` 另包一层 `phaseMs(..., "vault_load_flush")`（任务 1.1 的读数；干净
路径不走这里，所以那一段不会出现这条读数）。**为什么不把 UI 句柄塞进 vault-switcher**：注入的是
一对 `begin/end`（`VaultLoadingIndicator` 接口，本来就存在），模块仍是可脱离 DOM 单测的纯状态机
——单测里传一个记账的假句柄即可逐条断言开关时序（`tests/unit/vault-switcher.test.ts` 的
「指示窗口」组）。

## 3. 会话恢复：三案与推荐结构

### 3.1 纯惰性（只恢复激活标签）会**毁掉**该 vault 的会话文件

`sessionSnapshot` 只收有 `path` 的会话（`src/vault-switcher.ts:110-120`），而会话落盘的触发点是装配层唯一的同步点 `switcher.sessionChanged()`（`src/main.ts:664`，1s 防抖，`SESSION_WRITE_DEBOUNCE_MS`）。因此「只建激活标签」的实现会在恢复后 1 秒内把该 vault 的会话文件**从 40 条写成 1 条**——用户的标签列表被这一次切换永久删掉（他下次回来只剩 1 个标签）。这不是实现细节，是方案级的否决理由：**纯惰性本 change 不做**。

### 3.2 纯并发（`Promise.all`）不是加一行

三个障碍，都在代码里：

1. **在途请求互相作废**：`openFile` 里 `const request = save.beginSwitch()`（`src/main.ts:722`，实现是 `++serial`，`src/save-controller.ts:316`），IPC 返回后校验 `if (!save.isCurrent(request)) return false`（`src/main.ts:730`）。并发发起时后一次 `beginSwitch` 会让先发起的那几次全部判为过期 ⇒ 结果只剩最后一个标签。要并发必须先改这套「单在途请求」的语义（整批铸一个 serial，或引入批量令牌）。
2. **标签顺序**：`tabs.targetSessionFor("new")`（`src/tabs.ts:420-425`）发生在 `await fsReadSnapshot` **之后**，并发下完成顺序即错序——标签栏顺序是 spec 承诺的（「按存储顺序」）。要保序就得先同步建出会话、再并发填内容。
3. **世代让位**：`gen !== restoreGen` 的检查现在是循环内的逐次比对（`src/vault-switcher.ts:455`），并发后要在整批结束处收口（一次比对一个批次），否则「恢复途中又切一次 vault」的作废语义会变。

### 3.3 推荐结构：**先建壳（当帧）→ 再填充（时机是裁决点）**

障碍 1、2 的解法与 3.1 的解法是同一个：**把「标签存在」与「文档内容在内存里」拆成两步**。

- **建壳**（同步、当帧）：按 `plan.open` 的顺序为每个条目建会话（`editor.createSession()` 的成本是 `makeSession("", undefined, defaultMode)`，极低），把 `path` / `mode` / `editable` 写上去，**跳过计数照旧在装载完成时给出**（`restorePlan` 已在装载时就拿到了可用条目集）。建完壳，标签栏内容、顺序、激活项立刻正确，会话快照也立刻是 40 条——**「所有标签一次回来」这条外部契约在观感与落盘两侧都保持**。
- **填充**（装载文档内容）：各标签的文档内容在它**首次成为前台**时装载（走既有 `openFile` 路径），激活标签在装载完成时立刻填充。这一档是可用性收益的来源：40 个标签里用户当次访问的通常只有一两个。

**这个结构同时是纯并发案的前提**（保序与请求令牌都要靠它），所以「壳」这一层不用讨论；**要裁决的是填充时机**：按需（推荐，收益最大，代价与标签数脱钩）还是整批立即并发（无行为变更，收益限于 21–30ms 里的 IPC 占比）。两案可以叠加成「先建壳 + 整批并发填」，叠加后仍是按需之外的一个选择。

### 3.4 契约影响与落点

- **spec**：`vault-workspace` 的「装载后恢复标签列表」改写为「标签栏当帧重建齐 + 文档内容按需装载」，并保留既有的顺序 / 激活项 / 跳过计数 / 越界条目丢弃 / 空 vault 首入态口径。
- **代码落点**（按裁决结果收窄）：
  - `src/vault-switcher.ts`：恢复循环从「逐个 openPinned 并等待」变成「建壳 + 激活项装载 + 其余挂按需」；
  - `src/editor.ts`：会话需要一个「有路径、内容未装载」的状态。今天 `createSession()` 产出的会话 `path` 为 undefined，而 `sessionSnapshot` 只收有 path 的会话——壳态必须让 `path` 就位而内容为空。装载走既有 `reloadSession`（它的后台会话分支只换代 state，正是壳→内容的落点）；`reloadSession` 里的 `ensureMtime(path)` 是唯一「每标签一次的 IPC」，要在壳态跳过、留到填充时补（否则按需的收益被这一枪抵消一部分）。
  - `src/main.ts`：按需装载的触发点（标签激活）与「已装载」判定；`saveAllDirty` / `vaultSwitchBlock` 对未装载标签的语义（未装载 ⇒ 不可能是 dirty，自然跳过；MUST NOT 因为「没读到内容」被当成「无落盘基准」而拦停切换——这条要写测试）。
- **风险与已知边界**：
  1. **未装载标签的外部变更检测**：`save` 控制器按 path 跟踪 revison，壳态没有 revision ⇒ 该标签在磁盘上被外部改写时，冲突检测要等到它被首次装载（那时的 CAS 基准取的是装载时刻的 snapshot，不是切换前的——语义上等价于「刚打开这个文件」）。未装载 ⇒ 不 dirty ⇒ 无覆盖风险，但**这是行为变化**，要在 design 与 delta 的边界里写明。
  2. **标签栏标题**：标题由 session path 渲染，壳态有 path ⇒ 不变。
  3. **阅读位置**：既有口径是「恢复出的标签各自回到各自的位置」（`readingPositions.restoreFor(path)` 在 `openFile` 里跑）。按需装载下，每个标签回到自己位置这件事发生在它首次被打开时——可观察结果不变，时间点后移。
  4. **未装载标签被激活时的时延**：一次 `openFile`（21–30ms 量级）在点击后落地，仍在「正在打开：{path}」覆盖层的既有语义内。**若这条时延在真机上可感**，实现期应先量再决定要不要给「壳态首次激活」加一条更轻的反馈；本 change 不预设新文案（见 proposal 的编号声明）。
  5. **崩溃备份 / 恢复入口**：`save.checkRecovery()` 在装载后跑，与壳态无交互（它按备份文件工作）。

### 3.6 实现落点（M283，按裁决点 1 的推荐案落地）

- **`src/editor.ts`**：`EditorSession.loaded`（内容是否已装载）；`createShellSession(path)`
  （`path` / `mode` / `editable` 就位、内容为空、`loaded === false`，**不取 mtime**）；
  `reloadSession` 装载时置 `loaded = true`；`activate()` 里 `ensureMtime` 按 `loaded` 门控
  （壳态跳过那一次 IPC）。无路径的会话（未命名空文档）恒 `loaded = true`。
- **`src/vault-switcher.ts`**：`VaultSessionStoreDeps` 加 `createShell(path): boolean` 与
  `shellsBuilt()`，`openPinned` 的语义收窄为「装载**文档内容**」。`restore` 结构：
  ① 同步按 `plan.open` 顺序建壳（建不成壳的计入跳过数：不可打开的文件类）；
  ② `plan.open` 为空 ⇒ 空 vault 首入态（不建任何壳，标签栏因此隐藏）；
  ③ `deps.shellsBuilt()`——装配层在此把标签栏刷成完整列表（「装载完成的那一帧标签栏就是完整的」
  这条契约因此不依赖后续任何异步步骤）；
  ④ 只装载**激活项**的内容，读失败时按存储顺序退化为下一个能读的（spec 的退化句）；
  ⑤ 一次计数提示；全部装载失败时交装配层分流（见下）。
- **`src/main.ts`**：`openFile` 拆出共用的 `loadSessionContent(resolveSession, …)`——壳态标签的
  「填充」与新文件的「打开」是同一件事（读快照 → 登记基准 → 落到会话上 → 装载事务 → 恢复阅读
  位置），`resolveSession` 在快照读成**之后**才调用（读失败不留空标签）。壳态分支在未命名文档
  守卫**之后**（与「点一个已打开的文件」同一条守卫口径）。按需装载的唯一触发点挂在
  `syncActiveDocument` 上（`ensureActiveSessionLoaded`，会话 id 集合挡重入），`quiet = false`
  ——点标签是一次明确的用户动作，失败要上屏。
- **`onEmptyVault` 分两态**（实现期补的边界）：① 会话里没有任何可用条目 ⇒ 空 vault 首入态
  （标签栏本来就空 + D107 引导）；② 壳建出来了但正文全读不出来（例如会话里只有超过读取上限的
  大文件）⇒ **标签栏留着那些标签**，不说「还没有打开的文件」这句假话（只撤覆盖层），失败在用户
  点开该标签时由按需装载的既有提示上屏。老实现只有前一种（失败的 openPinned 不留标签），这条
  是「先建壳」带来的新形态，行为差异如实记在这里。
- **未装载标签的语义**：`dirty` 恒 false（`cleanDoc` 为空串）⇒ 不进 `vaultSwitchBlock`、
  不进 `saveAllDirty`、也不算「无落盘基准」（`saveBaseline` 只对脏标签有意义）。单测钉在
  `tests/unit/save-controller.test.ts`。

### 3.5 备选：整批并发填内容（裁决点 1 的另一选项）

若 Alex 不接「按需」，则取「先建壳 + 整批立即并发填充」：标签栏当帧齐（同 §3.3），随后并发发起全部装载（请求令牌与世代让位按 §3.2 的收口改法处理），最终内容与今天逐标签串行的结果一致。**收益上限 = 21–30ms/标签里 IPC 占比的那部分**（JS 侧建 state / 事务 / 装饰仍是单线程串行，无法并行）——该占比未测，所以这个选项的收益在读数出来前无法承诺。

## 4. 建图：局部优化 vs 增量建图（裁决点 2）

| | 局部优化（M154 §7） | 增量建图（mtime/size 缓存） |
|---|---|---|
| 做法 | `read_text_file` 每次经 `resolve_in_vault` 做两次 `canonicalize`；把 `canonicalize(root)` 提到循环外 + 加一条「已校验批量读」路径 | 建图前比对 mtime/size，只重读变更文件并复用上次的图 |
| 收益 | M154 实测：1341 个 md 上 `read_text_file` 70.2ms → 裸读 24.6ms 量级，即砍 `build_graph` 约 40%（≈45ms） | 上限 = 消掉 `build_graph` 整段 111.2ms（scan 14ms 仍必须做：要知道什么变了就得枚举） |
| 成本 / 风险 | 一处调用层重构；不引入新状态、无失效正确性问题 | 缓存键、失效条件、跨进程/跨会话的一致性；风险与改动面都大一档 |
| 结论 | **推迟**（M283 实测：打开段合计 ≈92–107ms « 250ms 阈值，收益上限实测 ≈26–33ms；账记 `docs/backlog.md`） | **暂缓**：真实 vault 7MB md 远未到需要缓存的规模（M154 的 737ms 出现在 45MB md 的 4× 合成规模） |

**建图整段的绝对上限是 111.2ms**：即使做满也把「几秒」变成「几秒减 0.1 秒」。它是本 change 里最便宜的改动（相对增量建图），所以排在恢复段之后而不是之前。

## 5. 树 DOM 虚拟化：否决，逐条对代码

finding 的前提「主线程一次建出 8000+ 行 DOM」与代码不符：

- `renderRow` 只由 `mountNode` 调用（`src/tree.ts:398`）；
- `renderAll` 只对根级子节点调 `mountNode`（`src/tree.ts:457`），目录子节点仅在该目录已展开时挂载；
- `setVault` 先 `expanded.clear()`（`src/tree.ts:712`）。

⇒ 切换路径上的 DOM 行数 = **根级条目数 = 22–24 行**（该 vault 根级 24 项，最大可见目录 22 项）。虚拟化的目标场景（展开一个几千项的大目录）在这个 vault 上不存在。收益按代码结构接近 0，代价是跨 capability 的高风险重写（滚动与坐标映射、选择与复制、CodeMirror 无关但树行自身的状态）。**否决**，理由在实现期落 `docs/backlog.md`（本 mission 的 scope 不含该文件）。

## 6. 未采纳 / 暂缓候选

### 6.1 `vault_open_path` 移出主线程（裁决点 3）

**M283 定夺：暂缓**（读数见 §7.1：watch 建流 0.4–1.6ms、打开段合计 ≈92–107ms release，都远低于「显著」的量级；async 化收益上限就是打开段总时长）。以下是当时的方案记录：`#[tauri::command(async)]` 一档的改动（或按 M159 的两阶段 `prepare`/`commit` 复用，把 IO 段搬到 worker）。**未核实**：`State<'_, VaultState>` 借用与 `Send` 约束在这个签名下的可行性、以及「两个用户发起的打开交错」的世代替换语义（今天由前端 `inFlight` 串行化，移到后端后要确认没有新的交错面）。收益上限 = 打开段总耗时（读数前未知；已知 scan+build_graph ≈92–107ms（M283 实测），**watch 建流未测**）。

### 6.2 启动恢复路径

M159 已把启动恢复移出主线程，本 change 不碰它（`last_vault` 自动恢复那条路径的反馈由空态文案承担，MUST NOT 复用装载指示）。

### 6.3 恢复段的取消 / 中断入口

不做：恢复途中再切一次 vault 沿用既有的世代让位规则（`restoreGen`）。

### 6.4 perf 门禁的 vault 切换端点（裁决点 4，草案）

现状：`scripts/perf/` 只有 `cold-start` / `keypress-to-paint` / `memory` / `open-file`，没有切换端点 ⇒ 本 change 的优化效果没有任何门禁能锁住（同族问题见 `docs/backlog.md` 第 12 条）。

草案（若 Alex 裁「另立 change」）：

- 端点 `vault-switch`：合成**真实形状** vault（≈2500 项 / 1341 md / 7MB、行长正常、含一个 `node_modules` 用于验证忽略生效——不要复用 M252 的稀疏单行放大器，M265 §六-2），预置一份 40 标签的会话；测「点击切换 → 目标 vault 就绪」的墙钟，并同时记录三段 `phaseMs` 读数（分段读数才是归因面，总时长是门禁面）。
- 门禁口径要先定：切换耗时是**绝对阈值**还是**相对回归**？ADR 0002 §6 的四条合同不含切换，新增门禁数字属于合同扩张 —— 需要 Alex 裁决（这也是本 change 不顺手做它的理由：它要动合同语义，不是加一个脚本）。

## 7. 裁决点与其读数依赖

| # | 裁决点 | 依赖的读数 | 读数不出来时的默认 |
|---|---|---|---|
| 1 | 填充时机：按需（推荐）/ 整批并发 | 恢复段 21–30ms/标签里 IPC 占比 | **按需**（结构性收益，不依赖占比） |
| 2 | 建图局部优化是否纳入本 change | 真实 vault 的 `vault_load_open` | 读数 >250ms 则纳入 |
| 3 | `vault_open_path` 是否移出主线程 | watch 建流耗时 + open 段总时长 | >100ms 显著则纳入 |
| 4 | perf 门禁是否新增切换端点 | —（是合同语义问题，不是读数问题） | 不新增，缺口留 §6.4 |
| 5 | 编号（场景 60 / 文案 deck） | 目录与 deck 的当时末位 | 见 proposal 的编号声明 |

### 7.1 M283 的读数与裁决落点（实现期填，2026-09-28）

工具与口径：release 直调生产函数（`cargo test --release --test vault_open_readings -- --ignored
--nocapture`，合成本地 vault 与场景 60 的 `seed.bulkVault` 同形状）；真机读数取验收场景 60 的日志
（`env:logs/*.jsonl`，同一台机器、debug 构建的 app）。

| 读数 | 值 | 支撑的裁决 / 结论 |
|---|---|---|
| `scan_workspace` | 10.6 / 13.0ms（中位，release 两次运行） | 打开段的可优化项之一，无悬念 |
| `build_graph` | 81.5 / 94.4ms（中位，release 两次运行；其中一次含 271ms 的冷缓存离群样本） | **裁决点 2：`vault_load_open` ≈92–107ms « 250ms ⇒ 建图局部优化不纳入本 change**（账记 `docs/backlog.md`：增量建图暂缓 + canonicalize 外提的收益上限实测 ≈26ms，不是 M154 估的 ≈45ms） |
| `build_graph`（canonicalize 外提 + 批量读，仅估上限的复刻） | 55.7 / 61.7ms（中位，release 两次运行） | 同上：即使做满也只省 ≈26–33ms |
| `watch`（FSEvents 建流） | 1.5–1.6ms（release 中位，两次运行）/ 0.4–0.5ms（真机日志） | **裁决点 3：远低于 100ms ⇒ `vault_open_path` 的 async 化暂缓**（`src-tauri/src/commands.rs` 的 `vault_open_watch` 读数已就位，Alex 的真实 vault 上也能自查） |
| `vault_load_open`（真机，真实形状 A） | 612–630ms（debug 构建，改动前后同档） | 与 release 的 92–107ms 不可混比；Alex 的发布版对应 release 侧 |
| `vault_load_restore`（真机，A = 2567 条目，40 标签，**改动前**） | 901 / 909 / 1008 / 1056ms ⇒ **≈22–26ms/标签** | 裁决点 1 的推荐案依据；与 M252 在 77 条目 vault 上的 21–30ms/标签同档 ⇒ 跨规模无显著放大（§1 的「未验」闭合） |
| `vault_load_restore`（同场景，**改动后**） | 见 §1.1 的对照 | 3.6 的验收读数 |
| `vault_load_flush` | 验收场景里未出现（脏标签只有 1 个、低于 250ms 阈值） | 1.1 的埋点已就位；本条读数需 Alex 在自己 vault 上带较大脏文档切一次 |

读数怎么拿（三种渠道，都不需要 agent 碰 Alex 的真实 vault）：

1. **零成本**：Alex 自己切一次真实 vault，grep `~/.config/lumir/logs/*.jsonl` 的 `vault_load`（M252 的 `phaseMs` 已经把三段埋好）。补上本 change 的 `saveAll` 段与 watch 段读数后，这一条就能直接回答「几秒卡在哪」。
2. **agent 侧**：合成真实形状 vault（§6.4 的 fixture）+ 场景观察窗，跑一遍拿三段读数，可直接对比 M154 的 111.2ms 与 M252 的 21–30ms/标签。
3. **实现期**：把读数写进 change 的 tasks（`test-results/` 留档，git 外）。

## 8. 已知边界与未验项（如实记）

1. **打开段指示静止**：§2.1 的机制推导（同步 command 占主线程 ⇒ 不能重绘）**未直接实测**。M283 的间接证据：场景 60 在「切到 B」那一步（打开段被 20×8MB 放大器撑到 7.5s 量级）断言指示在场并 PASS ⇒「指示在打开段**在场**」有实测支撑；「动画在推进」仍无判据（本 change 不改指示形态，spec delta 的边界写的也正是「只要求在场」）。
2. **恢复段读数跨 vault 规模**：**已闭合**（M283）：真实形状 vault（2567 条目）上 40 标签 = 901–1056ms（≈22–26ms/标签），与 M252 在 77 条目 vault 上的 21–30ms/标签同档 ⇒ per-tab 成本基本不随 vault 规模增长。
3. **watch 建流耗时**：**已测**（M283）：release 中位 1.5–1.6ms、真机（debug app）0.4–0.5ms ⇒ 裁决点 3 取「暂缓 async 化」。
4. **`readingPositions.onVaultLoaded` 的成本**：装载路径上按条目剔除不在 vault 内的键（内存镜像即时剔除），它在 2567 条目上的成本未单独测过；它在指示窗口内（`applyVault` 前段），不在恢复段读数里。
5. **未装载标签的外部变更检测时点后移**（§3.4 风险 1）：行为变化，delta 的边界里写明。
6. **按需装载下标签激活时延**（§3.4 风险 4）：真机是否可感，本 change 不预设结论。
7. **M252 的指示在恢复段的行为照旧**：本 change 不改指示的形态、无文案、`hidden` 常态（ADR 0002 §6 空闲态零布局影响）。

## 9. 真机验收场景（草案见 `acceptance-scenario.md`）

场景 **60**（试占，见 proposal 的编号声明）。判据分三层，都落在「用户能观察到什么」上：

1. **反馈窗口**：dirty 出口「保存并切换」被选定后，标题栏指示在写盘期间就在场（这是本 change 修好的缺口，必须有一条正向观测）；「取消」不出现指示（负向配对，REVIEW.md 第 2 条）。
2. **标签当面**：切回一个有 N 标签的 vault，`settle` 后标签栏立刻是 N 个（不再等恢复跑完才逐个长出）；激活项与存储一致。
3. **按需装载的可观察面**（若裁决点 1 取按需）：点一个未装载的标签，它的正文出现（而不是空文档）。

耗时本身**不做断言**（机器间抖动，REVIEW.md 第 3 条的同族问题）：改为在场景里留一个 `grep` 日志读数步骤，把三段 `vault_load_*` 读数截进证据目录（`test-results/`，git 外），由人读。
