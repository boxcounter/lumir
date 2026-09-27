# Proposal: vault 切换的反馈窗口与会话恢复的装载时机

- Change ID: vault-switch-restore-perf
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话（2026-09-27）：

> 「切换 vault 时，会卡住几秒。我会愣住，以为刚才点击没点中，然后才出现系统的转圈提示，我才明白在加载中。我们有什么方案？」

这句话里有两件事，必须分开处理：**一是真的等了（耗时），二是等待期间没有任何可归因的信号（反馈）**。第二件是「以为没点中」的直接成因，且它不依赖耗时有多大就会发生。

### 一、M265 survey 已经把任务书的规模前提推翻

| 口径 | 文件 | 目录 | md | md 字节 |
|---|---|---|---|---|
| 裸 `find`（任务书 / M252 finding 引用的数） | 8189 | 1057 | 1525 | — |
| **Lumir 实际扫描可见** | **2142** | **426** | **1341** | **7.01 MB** |

差额在 `src-tauri/src/fs_io.rs:28` 的 `IGNORED_NAMES = [".git", ".DS_Store", "node_modules"]` 里：`*/node_modules/*` 5775 个文件（占裸计数 71%）与 `.git` 全部被忽略。因此「8000+ 文件 ⇒ 30MB 级 ⇒ 秒级」这条链前提不成立。同一份 survey 里的两个直接读数：`build_graph` 在**同一个真实 vault 上直测 111.2ms**（`scan_workspace` 14.0ms），树在切换时只重建根级行 DOM（`src/tree.ts:457` 只对根级子节点 `mountNode`，`src/tree.ts:712` 的 `setVault` 先 `expanded.clear()`，DOM 行数 = 根级 22–24 行）。

### 二、剩下能到秒级的量与它的证据强度

**逐标签会话恢复：46 个标签 992–1359ms（≈21–30ms/标签）**——`openspec/changes/vault-switch-feedback/tasks.md` 的 3.2 真机读数，来自 46 次串行的 `await deps.openPinned(path)`（`src/vault-switcher.ts:454-457`）。

这条读数**不是** M252 那批 48ms/MB 外推的同族问题（后者已被 survey 判为稀疏单行文件的放大假象）：场景 49 的会话里是 46 个 fixture 小文件（那几个 8MB 稀疏文件只塞进 vault 用来撑开 `vault_load_open` 的观察窗，不在会话里），所以这 21–30ms/标签 是**每标签固定成本**主导——IPC 往返 + EditorState 构建（含 markdown 解析与装饰层）+ 视图更新 + 阅读位置恢复，而不是文件读取代价。固定成本主导让这条读数比「随文件大小增长」的口径更可外推，**但它仍只在验收合成 vault（77 个条目）上量过**：per-tab 成本里若有随 vault 索引规模增长的成分（链接解析、附件索引查询），真实 vault（2567 条目 / 1341 md）上会更大。**这一条未验，而「恢复段是唯一能到秒级的段」这个结论正挂在它上面。**

### 三、三段未读数（任一条都可能改变归因）

1. **切前写盘不在指示窗口内**：dirty 时「保存并切换」出口走 `saveThenRun` → `await deps.saveAll()`（`src/vault-switcher.ts:250-256`，`deps.saveAll` = `save.saveAllDirty()`，`src/main.ts:395`），而指示起于 `proceed()` 内部的 `vaultLoading.begin()`（`src/main.ts:371-372`、`src/main.ts:1100-1106`）。写盘脏标签这段时间**零反馈**，M252 新加的转圈盖不住它。按 M154 的写入地板推算（fsync ≈4ms、1MB 文档 ≈10ms），几个脏文档就是数百毫秒。
2. **`vault_open_path` 整段占主线程，且 fs_io::watch() 建流从未测过**：该 command 是**不带 `async` 的同步 command**（`src-tauri/src/commands.rs:555`），按 Tauri 语义在主线程内联执行（[Calling Rust from the frontend](https://tauri.app/v1/guides/features/command)：「Commands without the async keyword are executed on the main thread unless defined with `#[tauri::command(async)]`」；仓内同一条语义的旁证见 M154 finding 第 18 行）。它包含 `reconcile_vault` + `fs_io::watch()`（FSEvents 建流，426 个目录，**从未测过**）+ 全量枚举 14ms + `build_graph` 111.2ms。该段期间 webview 不能重绘（按机制推导，**未实测**）——**这正是 Alex 看到的那句「然后才出现系统的转圈提示」**：那是 macOS 的 beachball，不是我们的指示。
3. **perf 门禁不覆盖 vault 切换**：`scripts/perf/` 只有 `cold-start` / `keypress-to-paint` / `memory` / `open-file` 四个端点 ⇒ 即使本 change 把切换做快了，也没有门禁能锁住它（与 `docs/backlog.md` 第 12 条同族）。

### 四、结论：本 change 的第一件事是补读数，不是改代码

M252 已把三段读数埋进 `phaseMs`（`src/main.ts:362`，阈值 250ms，走既有 `slow_callback`）。**零成本路径**：Alex 切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl` 的 `vault_load`（agent 侧不得开他的真实 vault——会写 registry / last_vault 到 `~/.config/lumir`，M265 §六-1 的纪律）。本 proposal 因此给每一段标出**证据状态**（读数 / 机制推导 / 未验），并把靠读数才能定的选择写成显性裁决点——读数不到位就动代码，是在推断上盖房子。

## What Changes

1. **装载指示覆盖到写盘段**（修反馈缺口，无需裁决）：指示的窗口起点改到「用户选定出口的那一刻」，覆盖「保存并切换」自身要跑完的写盘。spec 增量以 MODIFIED 改写既有 requirement「装载的即时反馈」（该 requirement 现只在已合并未归档的 `vault-switch-feedback` 的 delta 里，归档顺序见 tasks.md）。
2. **装载耗时的读数补齐**（不改任何契约）：补两条 `phaseMs`——`saveAll` 段（`saveThenRun` 里，名字 `vault_load_flush`）与 `watch` 段（Rust 侧，名字 `vault_open_watch`）；恢复段的读数补一个「固定成本 / 随规模成本」的拆分口径（用真机日志里标签数与毫秒数的关系即可，不引入新埋点、不新增事件名）。**读数是本 change 后续三件工作的排期依据**。
3. **会话恢复的等待不再随标签数增长**（**裁决点 1**）：推荐「带壳惰性」——装载完成的那一帧先把标签栏按存储顺序重建齐（标签在、顺序对、激活项对、跳过计数照旧），各标签的**文档内容**在它首次成为前台时才装载。备选 (a) 并发恢复（无契约变更，加速比受 25–30ms 里 IPC 占比限制，未测）与 (b) 纯惰性（只建激活标签，标签栏会先缩成一个再逐次长出）。三案对比见 design §3；spec 增量按推荐案书写。
4. **建图局部优化**（**裁决点 2**，按读数决定是否纳入本 change）：`read_text_file` 每次经 `resolve_in_vault` 做两次 `canonicalize`，把 `canonicalize(root)` 提到循环外 + 加一条「已校验批量读」路径，M154 实测可砍 `build_graph` 约 40%（1341 个 md：70.2ms → 24.6ms 量级）。改动面比增量建图小一个量级。**下限**：建图整段上限只有 111.2ms，做满也不足以让「几秒」变成「不卡」。
5. **vault 打开段是否移出主线程**（**裁决点 3**）：把 `vault_open_path` 改成 `#[tauri::command(async)]` 一档的改动（未核实 `State` 借用与 `Send` 约束），让 open 段（含 watch 建流）不再占主线程——这是唯一能消掉「指示静止 + beachball」的修法，但它跨 Rust 侧，且收益上限等于 open 段的总耗时（读数前未知）。

## Non-goals

- **不做树 DOM 虚拟化**（否决）。前提与代码不符：`renderAll` 只对根级子节点挂 DOM（`src/tree.ts:457`），目录子节点仅在已展开时挂载，而 `setVault` 先 `expanded.clear()`（`src/tree.ts:712`）——切换路径上的 DOM 行数是根级条目数（该 vault 22–24 行），不是 8000+ 行。目标场景（展开大目录）在该 vault 上也不存在（最大可见目录 22 项）。收益按代码结构接近 0，成本是跨 capability 高风险大改。
- **不做增量建图**（暂缓）。收益上限 = 消掉 `build_graph` 的 111.2ms（`scan` 14ms 仍必须做——要知道什么变了就得枚举），却要引入 mtime/size 缓存与失效正确性；真实 vault 的 7MB md 远未到值得上缓存的规模。
- **不新增 perf 门禁端点**：缺口与端点草案留在 design §6.4，是否立项由 Alex 裁；本 change 不碰 `scripts/perf/`。
- **不改任何性能合同数字**（ADR 0002 §6 四条）——本 change 不声称达标或改阈。
- **不动建图算法本身**（只做裁决点 2 的调用层优化：canonicalize 外提与批量读）。
- **不给会话恢复加取消 / 中断入口**：恢复途中再切一次 vault 沿用既有的世代让位规则。
- **不改「保存并切换」的三条出口与 dirty 判据**，也不把写盘挪到装载之后（那会破坏「保存未闭环则不切换」）。

## Impact

- 影响的 specs：`vault-workspace`（两条 MODIFIED：既有 requirement「装载的即时反馈」与「装载后恢复标签列表」）
- 影响的代码/系统：
  - 反馈窗口：`src/vault-switcher.ts`（`saveThenRun` 的出口时序）、`src/main.ts`（指示装配）
  - 读数：`src/main.ts`（`phaseMs` 调用点）、`src-tauri/src/commands.rs`（watch 段读数）
  - 恢复时机（裁决点 1）：`src/vault-switcher.ts` 的恢复循环、`src/main.ts` 的 `openFile` 装配、按裁决案可能触及 `src/tabs.ts` / `src/editor.ts` 的标签会话模型
  - 裁决点 2 / 3：`src-tauri/src/commands.rs`、`src-tauri/src/fs_io.rs`
- 关联约束：ADR 0002 §6（性能合同：本 change 不改数字，但裁决点 2/3 是它覆盖不到的端点）；ADR 0003（不写 vault、不新增 vault 内文件）；ADR 0004 节点 1 / 节点 2；`openspec/changes/vault-switch-feedback`（已合并未归档，本 change 的 delta 依赖它先归档）

## 裁决点

| # | 裁决点 | 推荐 | 备选 | 不裁决的后果 |
|---|---|---|---|---|
| 1 | 会话恢复的时机与契约 | **带壳惰性**：标签栏当帧重建齐、文档内容按需装载 | (a) 并发恢复（无契约变更）；(b) 纯惰性（只建激活标签） | 恢复段按标签数线性增长保留（40 标签 ≈1.0–1.2s） |
| 2 | 是否在本 change 纳入建图局部优化 | **按读数**：若 `vault_load_open` 在真实 vault 上 >250ms 则纳入 | 推迟为独立 change | 少砍 ≈45ms 的建图成本，无风险 |
| 3 | `vault_open_path` 是否移出主线程 | **按读数**：watch 段若显著（>100ms）则纳入 | 推迟为独立 change（跨 Rust 侧） | 打开段继续占主线程（指示静止 + beachball 保留） |
| 4 | perf 门禁是否新增 vault 切换端点 | **本 change 不新增**，缺口留在 design §6.4 | 另立 change 加端点与 fixture | 优化效果没有门禁锁住（可被后续改动静默回退） |
| 5 | 编号占用（场景 60 / 文案 deck） | 见「编号声明」 | — | 与在飞 change 撞号 |

## 编号声明

- **真机场景取 60**（试占）。依据（2026-09-27 动工前核对 master 的 `scripts/acceptance/scenarios/`）：目录内现有编号最大 **53**；在飞 / 已落地声明依次为 54 = M260、55 = M267、56 = M261、57 = M262、58 = M263、59 = M264（M259 已用 53）。**对冲条款**：实现期动工前 SHALL 再核一次目录与各 change 的编号声明，不盲取；被占则取当时的下一个可用号。场景草案见本 change 的 `acceptance-scenario.md`。
- **文案 deck：本 change 预期零新增用户可见文案**（指示无文案、恢复时机变化不产生新句子；未装载标签被激活时沿用既有的「正在打开：{path}」）。若实现期发现确需新增（例如未装载标签的占位态要一句说明），按 deck「只追加、不复用」的规则取**当时末位的下一个可用编号**（M265 的试占是 D156：D152 = M261 已合并、D153–D155 = M263 已合并、M267 实现期另占），动工前再核一次 deck 末位，不盲取。
