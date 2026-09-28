# Design: vault-open-ignore-set

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、哪些地方会咬人、哪些结论还没有读数撑」。

## 0. 一句话方案

打开段的 3.1s 里，scan（1,231ms）+ build_graph（1,879ms）**全花在用户不读的东西上**（构建产物、agent 工作区），而这一段的成本与可见条目数近似正比——所以第一件事是**收窄可见集**（忽略集从 3 个名字扩到 19 个），第二件事是把这一段**移出 IPC 主线程**（`#[command(async)]`，单行），让收不窄的 vault 也不至于整窗死帧。两件事各自独立可回退；收窄后残余实测 66ms（合成真形状）。第三件事是补两条分段读数，闭合真机与合成之间那 2.4s 的解释缺口。

## 1. 现状与证据状态

| 面 | 现状机制（落点） | 量级 / 证据 | 状态 |
|---|---|---|---|
| 打开段 | `vault_open_path`（[commands.rs:614](../../../src-tauri/src/commands.rs#L614)）**同步 command** ⇒ body 在 IPC 主线程内联执行：`reconcile_vault` → `fs_io::watch()` → `scan_workspace` → `build_graph` | **M289 release 直测**（复刻真 vault 可见形状：166,626 文件 / 200,274 条目 / 14,573 md / 172.6MB）：`scan 1,231.1ms` + `build_graph 1,879.1ms`（生产复刻口径；canonicalize 外提版 1,710.6ms）**= 3,110.2ms**（5 次中位） | **有读数** |
| 同段：收窄后残余 | 同上 | 1,658 文件 / 2,395 条目 / 1,211 md / 3.3MB ⇒ `scan 14.0ms + graph 51.7ms = 65.8ms`（同 harness、5 次中位） | **有读数** |
| 同段：对照规模 | 同上 | 2,142 文件 / 1,341 md 形状（M283）⇒ 92–107ms；与残余形状同量级 ✓（两把尺子互相印证） | 有读数 |
| 可见集 | `IGNORED_NAMES`（[fs_io.rs:28](../../../src-tauri/src/fs_io.rs#L28)）3 个名字；`is_ignored`（[fs_io.rs:104](../../../src-tauri/src/fs_io.rs#L104)）= 名字等值 + `.lumir-` 临时文件模式 | Alex 真 vault：**scan 可见 170,317 文件 / 24,072 目录 = 194,389 条目**；按名已剪 147,440（133,440 嵌套 node_modules + 11,158 根 node_modules + 961 `.git` + 探针）⇒ `.git` 不是嫌疑 | **有读数** |
| 可见集构成 | 同上 | worktree `src-tauri/target` 110,501 + 根 `src-tauri/target` 19,154 + `test-results` 9,660 + `.tower`（comms 2,832 + worktree 仓库内容 ~14,000）+ 真内容 1,658 | **有读数** |
| payload | entries 全量 serialize → webview `JSON.parse` | 真可见形状 ≈27MB（字典序 JSON；46MB 档实测 `JSON.parse` 71–73ms，堆 +124MB） ⇒ **不是瓶颈** | 有读数 |
| 前端装配 | `applyVault`（附件路径过滤）+ `tree.setVault`（给全部条目建 `Node`/`Map`；DOM 只挂根级） | 194k 条目的建表是 O(n)、个位数~十位数 ms 级；`vault_load_tree` 在 09-26/27/28 三天真机日志里**一次都没出现**（>250ms 才记）⇒ 不是主因 | 结构性有据；整段耗时**未单独测** |
| 真机打开段 | 同上 | 同一条路径的真机日志读数：09-27 `265 / 2,661 / 297 / 4,883 / 6,616 / 5,146 / 3,951 / 4,999ms`，09-28 `12,416 / 5,501 / 12,695ms` ⇒ **跨度 48×** | 有读数（但 `~/.config/lumir/logs/` 属 Alex 本机，agent 不读） |

**复现命令**（M289 用的就是它，未改一行代码；harness 命中已存在的 `$TMPDIR/lumir-m283-real-shape` 即复用）：

```bash
CARGO_TARGET_DIR=/tmp/<dir>/target cargo build --release --test vault_open_readings   # 实测 1m22s
TMPDIR=<vault 父目录> cargo test --release --test vault_open_readings -- --ignored --nocapture
```

口径提醒（照录 M289，别当稳态常数读）：harness 是**热缓存**读数，且当时 load average 5–8；真机首次打开是冷的。

## 2. 忽略集的取舍：为什么是「名字」，而不是通配或 VCS 配置

### 2.1 匹配规则保持不变（这一点比名单本身重要）

`is_ignored` 今天有三条性质，本 change **全部保留**：

1. **名字精确匹配**（逐字节、大小写敏感）——不含通配、不含前缀。`dist-old` 不命中 `dist`，`Target` 不命中 `target`。要覆盖 `dist-2`、`.next-2` 这类变体只能靠扩名单或换机制（B/C 案）。
2. **任意深度**——不只在 vault 根生效。Alex 的 110,501 个 worktree target 就是靠这条剪掉的（它们全是 `.../worktrees/wt-N/src-tauri/target/...`）。
3. **与条目类型无关**——同名文件与同名目录一视同仁（下条解释为什么）。

三条性质合起来让「是否忽略」成为**名字的纯函数**，这一点是设计上的关键约束：`rel_string`（watch 事件侧，[fs_io.rs:135](../../../src-tauri/src/fs_io.rs#L135)）拿到的只是路径的组件，没有条目类型、也没有 stat 的机会（被删的条目 stat 不到）。**只要判定需要「类型」或「上下文」，枚举侧与 watch 侧就会分叉**，而 spec 明写两者共用同一忽略集（[fs-io/spec.md](../../../openspec/specs/fs-io/spec.md) 的「watch 增量事件流」）。所以本 change 不引入「只忽略目录」这类条件规则，代价是「名为 `build` 的文件同样被忽略」——这条代价写进 spec 的 scenario 里，明着接受。

### 2.2 名单的三档

| 档 | 名字 | 误伤概率 | 备注 |
|---|---|---|---|
| A1 生态专名 | `.venv` `venv` `__pycache__` `.next` `.nuxt` `.cache` `.pnpm-store` `.tox` `.gradle` `test-results` `perf-results` | 极低 | 工具/生态专名或点目录；`test-results` / `perf-results` 是 CI 产物约定 |
| A2 工具链常用词 | `target` `dist` | 低 | `target` 是 Cargo/Maven/Scala 的固定输出目录，`dist` 是前端打包的固定输出目录；作为笔记目录名出现概率低，而**收益最大** |
| A3 通用英文词 | `build` `out` `vendor` | 中 | **可以是有意的用户内容**（一个叫「build」的笔记目录）。建议由 Alex 单独取舍 |
| 既有 | `.git` `.DS_Store` `node_modules` | — | 本次不动 |

名单里 `target` 是**收益最大**的一个（Alex 的 vault 里占 129,655 个可见文件：110,501 + 19,154，占 170,317 的 76%）；`test-results` 再砍 9,660。二者加起来把可见集从 170,317 压到 ~31k，是本 change 的主要收益来源。**A3 档可以整体砍掉**（proposal 裁决点 1）：砍掉后 Alex 的现场几乎不变（`build` / `out` / `vendor` 在他的 vault 里可见目录数为 0），收益只损失通用性（Python 的 `build`、包 vendoring 的 `vendor` 不在名单里）——而 A2 里的 `target` 必须在，否则本 change 对他的收益从 76% 掉到 6%。

### 2.3 名单**必然不完整**，而且这一点是本 change 的固有性质

构建系统的输出目录名是无穷的：`_build`（Dune/Elixir）、`zig-out`、`.svelte-kit`、`coverage`、`Pods`、`.dart_tool`、`cmake-build-*`……本 change 收的是「**常见且高代价**」这一批，不是全集。诚实地说：**扩名单是启发式，B 案（读用户自己的 VCS 配置）才是完备解**——这是一个「先做便宜的、承认它不完备」的排序，不是「名单就够了」的断言。

## 3. 扩集的代价（这一节是本 change 最需要 Alex 看的）

### 3.1 代价一：用户内容可能被静默隐藏

一个已有 vault 里若存在 `notes/build/plan.md`，本 change 之后它从文件树、**链接索引**（`LinkGraph` 由同一份枚举建出）、附件索引里一起消失——`[[plan]]` 也解析不到了。用户看到的是「我的文件不见了」，且**没有任何提示**。这不是极端假设：`build` / `out` / `vendor` 是日常英文词，A3 档把它们变成保留名，就是拿这个风险换通用性。

### 3.2 代价二：这些名字从此不能新建 / 改名

`validate_new_name`（[fs_io.rs:328](../../../src-tauri/src/fs_io.rs#L328)）复用同一份名单——它是**有意耦合**的：如果允许建出 `build/` 而枚举又忽略它，用户在界面上既看不到也删不掉（[fs_io.rs:306](../../../src-tauri/src/fs_io.rs#L306) 起的注释写的就是这条）。代价因此是显式的：**新建/改名成 `target` / `dist` / `build` / `out` / `vendor` 会被 `fs_name_invalid` 拒绝**（人话文案「`{name}` 在忽略集内，建成后不会出现在文件树里」）。用户想在 vault 里留一个叫 `build` 的目录，只能去 Finder 里改——且改完它也不会出现在 Lumir 里。

### 3.3 缓解（本 change 能做到的）

1. **诊断日志给一条忽略计数**（实现项，不是 UI）：枚举收口处记一行「被忽略集剪掉的条目数」。落点是 diagnostics 的事件白名单——新增 `LogEventName::VaultScanIgnored`、字段只有 `count`（十进制字符串，[logging.rs:133](../../../src-tauri/src/logging.rs#L133) 的 `allowed_fields` 与事件名是机制化护栏，新事件名要一并登记）；MUST NOT 记被忽略条目的路径或名字原文（隐私边界不变，只给计数就够用）。用途：用户报「文件不见了」时，一条日志即可判断是不是忽略集干的。**不做 UI 提示**（非目标）：UI 出口要么是「展开被忽略项」（等于把忽略集做成可撤销的过滤器，是另一个能力），要么是一次性横幅（噪音）。这条留到误伤真实出现时再立 change。
2. **A3 档可砍**：误伤概率集中在 A3（`build` / `out` / `vendor`），Alex 可以在节点 1 直接砍掉这一档；A1 与 A2（含 `target`）是收益主力，砍它们等于取消本 change。
3. **可回退**：名单是一个常量，回退是单行；且 `is_ignored` 是纯函数，回退后无残留状态（没有缓存需要失效）。

### 3.4 与 ADR 0001 的张力（如实记）

ADR 0001 的原文是「全文件类型一等公民」——**一等公民的是文件类型**（不按扩展名过滤），不是「任何目录名都必须在树里」。既有忽略集（`.git` / `node_modules`）已经做了「按名排除非内容目录」这件事，本 change 只是把「非内容」的判据从 VCS/包管理内部扩到构建产物。**张力成立的部分**是判据从「结构上确定不是内容」（`.git` 内是对象库）退到「按名字猜不是内容」（`build` 可能是用户的笔记目录）；这是本 change 明知的一步退让，代价见 §3.1，出口见 §3.3 与裁决点 1。

## 4. B / C 两案的成本明细（为什么必须单独立项）

### 4.1 B 案：读 `.git/info/exclude`（+ 可选 `.gitignore`）

收益确凿：Alex 的 vault 压到 1,658 文件 / 66ms（`src-tauri/target`、`test-results`、`dist`、`.pnpm-store` 在 `.gitignore`，`.tower` 在 `.git/info/exclude`——**只读 `.gitignore` 挡不住 `.tower`**）。成本不止「引一个 crate」：

1. **watch 侧要在事件路径上复现同一套判定**。今天是「名字的纯函数」；gitignore 语义是「路径 × 该路径各级目录的规则栈」（含 `!` 取反、目录锚定、`**`、嵌套 `.gitignore`）。watch 侧要么在扫的时候就缓存一份「目录 → matcher」映射并常驻，要么在事件路径上重新读规则文件——两者都是**新状态**，且都要处理「`.gitignore` 自己变了」时的规则刷新（那本身是一个 watch 事件）。做不好就是**枚举与 watch 可见集分叉**（一侧列出的文件，另一侧的事件被吞），而 spec 明写两者共用同一忽略集。
2. **`validate_new_name` 的语义要重新定义**：新建/改名的名字还不存在于磁盘上，「是否命中忽略集」在 gitignore 语义下要按 `<父目录>/<新名>` 对 matcher 求值。不处理就会出现「改名成一个被忽略模式命中的名字 ⇒ 文件当场从树里消失」。
3. **可配置性**：Alex 的真实 vault 想要它生效，就得有开关（默认开还是关是产品判断——「用户 gitignore 了 `private/` 是为了不发布，不是为了在 Lumir 里看不见」是真实用户场景，与 Lumir 的读者型用户群尤其相关）。开关 = 新配置键（ADR 0002 §5 的配置即数据）+ 前端回写通道（若做成可切换）。
4. **新依赖**：gitignore 语义自己实现是子集，子集会猜错（`!` / 锚定 / `**` 的边界）；用 `ignore` crate（ripgrep 同源）就要过依赖评审（体积、平台行为、构建时间）。

**结论**：B 案值得做，但它的核心难点是 1，而 1 是一个跨 fs-io 内部结构的改动——**不该塞进本 change**。

### 4.2 C 案：用户可配置的忽略名单

- 语义清晰、无 VCS 耦合、无新依赖、能挡住 `.tower`（Alex 自己写一行）；对「Emacs 键位 PKM、配置即数据」的产品取向也合拍（`[keys]` 已经是同样的形态）。
- 成本：新增配置键 + 校验（非法名字的人话 warning，同 `[keys]` 的既有形态）；四个使用点要从「模块常量」变成「从 vault 状态里取的有效忽略集」（`rel_string` 在 watch 回调里跑，得能拿到当前 vault 的配置——Thread 安全与生命周期都要过一遍）。
- 与 `validate_new_name` 的耦合同上（名字校验要问「当前有效集合」）。

**结论**：C 案是 B 案的廉价替身，若 Alex 的诉求是「我这台机器上的 vault 我自己声明」，C 案优先于 B 案；但两者都不属于本 change 的形态（本 change 保住「忽略集本 change 内不可配置」这条既有条款）。

## 5. 打开段移出 IPC 主线程

### 5.1 机制核实（读 tauri 2.11.5 / tauri-macros 2.6.3 源码，不靠记忆）

- 宏对「同步函数 + `async` 上下文」的处理路径：`ExecutionContext::Async if function.sig.asyncness.is_none() => "sync_threadpool"`（`tauri-macros-2.6.3/src/command/wrapper.rs:264`，cargo registry 路径 `~/.cargo/registry/src/index.crates.io-*/`）。
- 生成的 body 是一个 `async move`（`wrapper.rs:388` 的 `body_async`），交给 `resolver.respond_async_serialized(...)`；该函数在 `tauri-2.11.5/src/ipc/mod.rs:371` 的 `respond_async_serialized_inner` 里走 `crate::async_runtime::spawn` ⇒ **body 在 async 运行时（tokio 多线程）里执行，不占 IPC 主线程**。
- 顺带的一层：返回值的 JSON 序列化也在同一个 spawn 出来的任务里——`ResultTag::future` 调 `value...?.body()`（`tauri-2.11.5/src/ipc/command.rs:265`），而 `impl<T: Serialize> IpcResponse for T` 的 `body()` 就是 `serde_json::to_string`（`tauri-2.11.5/src/ipc/mod.rs:183`）。同步 command 走的是 `ResultTag::block` → `resolver.respond(value)`（`command.rs:250`），即在主线程上序列化。**所以 async 化同时把「20 万条目的 VaultInfo 序列化」移出主线程**（M289 的 survey 写「响应序列化仍在主线程侧」，这一句按源码不成立——本 change 以源码为准，实现期别照抄 survey 那一行）。

### 5.2 先例与风险

`vault_open`（目录选择器那条 path，[commands.rs:590](../../../src-tauri/src/commands.rs#L590)）本来就是 `async fn`，跑的是同一段 `open_vault` 工作，已经在生产里验过（多 vault 切换、注册表 remap、启动恢复都触发它）。本 change 做的是**把 outlier 拉平**，不是发明新形态。

- 并发/顺序语义：前端 `inFlight` 串行化 + `commit_vault_open` 单次持锁提交不变；`prepare_vault_open` 里的注册表写（`reconcile_vault`）本来就与 `vault_open` 路径同源。
- 已知不完美：body 里是**阻塞式文件 IO**（读目录、读 md），跑在 async 运行时的 worker 上会占住一个 worker（不是 `spawn_blocking`）。同仓 `vault_open` 已是这个形态；本 change 与它保持一致，**不**在本 change 里引入 `spawn_blocking`（那是形态分叉，且没有读数表明需要）。
- 剩下仍在主线程的：command 的参数解析（`parse_args`）与最后一步「把响应投递给 webview」。payload 的 `JSON.parse` 在 webview 主线程（§7）。

## 6. 分段读数与「真机 5.5s vs 合成 3.1s」的 2.4s 缺口

### 6.1 缺口是什么

真机日志 09-28 的 `vault_load_open` = 5,501ms（另两条 12,416 / 12,695ms），而同形状合成的 scan+graph = 3,110ms。候选解释（M289 排序，均未坐实）：① 冷缓存（194k 条元数据 + 171MB md 不在页缓存里；同路径读数跨度 48× 指向缓存/负载主导尾部）；② 真 vault 路径更深（`canonicalize` 逐组件解析）；③ Tauri/macOS 对大 payload 的额外编码。**区分 ①②③ 只能靠在同一条真机路径上分段读数**。

### 6.2 加哪几条，口径是什么

**加 2 条，不是 4 条**：

| 读数名 | 落点 | 覆盖 | 阈值 |
|---|---|---|---|
| `vault_open_scan` | `prepare_vault_open` 里 `scan_workspace` 前后打点 | 全量枚举 | **无条件记录** |
| `vault_open_graph` | 同函数里 `build_graph` 前后打点 | 建链接索引 | **无条件记录** |

口径沿用 M283 的 `vault_open_watch`：走 `logging::slow_callback`（事件名 `slow_callback`、字段 `name` / `ms`，白名单不新造字段），**刻意不设阈值**——理由同源：「日志里没有这一行」与「它很快」事后不可区分，阈值会把「没超阈值」写成「没有读数」；vault 打开是低频动作，一次打开最多三条。

**为什么不另加「serialize / IPC」两条**：它们与前端既有的 `vault_load_open`（`phaseMs`，250ms 阈值；见 [src/main.ts](../../../src/main.ts)）是同一段，做减法即可：`序列化+传输+解析 ≈ vault_load_open − scan − graph`（前端那条 `phaseMs` 包住整次 `invoke`）。要单独测序列化得让 command 返回**预序列化的 raw response**（Tauri 有 `tauri::ipc::Response` 这条通道，`tauri-2.11.5/src/ipc/mod.rs:190`），那会把 `VaultInfo` 的响应形态改掉 + 前端手工 `JSON.parse`——**本 change 不做**（收益是「多一条读数」，成本是改契约；且 async 化之后序列化已不在主线程上，它不再是我们关心的时间线）。

### 6.3 2.4s 的归因指望什么

真机跑一次之后：`vault_load_open`（前端总时长）− `vault_open_scan` − `vault_open_graph` ≈ 序列化 + 传输 + `JSON.parse`。若这个残差很小（预期 ≪ 100ms），而合成 scan+graph 只有 3.1s ⇒ **剩下的就是「同一段代码在真 vault 上比合成慢」**，即 ①/② ——那属于「冷缓存与路径深度」，不是本 change 要修的（它只影响首次打开，且 async 化之后不再冻结界面）。若残差很大，则 ③ 成立，需要另立 change（raw response / 分片传输）。

## 7. 前端装配段：本 change 之外的剩余边界

打开段结束（响应到达）之后，webview 主线程上还有：payload 解析（27MB ⇒ 71ms 量级）→ `applyVault`（附件路径过滤）→ `tree.setVault`（给全部条目建节点表）。这一段**本 change 不动**，在大 vault 上仍可能有一拍不可交互。收窄可见集之后这条路径的输入同步变小（27MB → 0.19MB），所以本 change 对它有间接收益，但**没有直接实现改动，也没有单独读数**——如实记为已知边界（写进 spec delta 的「装载的即时反馈」），MUST NOT 在 review-request 或 tasks 里写「界面全程不卡」。

## 8. 未验项与已知边界（照录，别读成「已覆盖」）

- **真机全链路的分段读数**：本 change 之前，真机只有 `vault_load_open` 一条（合成侧才有 scan/graph 直测）。§6 的两条埋点是**闭合它的手段**，读数本身要等实现后真机跑一次才有。
- **前端装配段的耗时**：没有读数（`vault_load_tree` 三天日志零出现 ⇒ 与 250ms 阈值相比无意义；但没有真值）。
- **「忽略集误伤」的真实发生率**：无法测——本 change 只保证诊断日志里能读到忽略计数（§3.3），不保证体验上可发现。
- **`venv` / `build` / `out` / `vendor` 在真实用户 vault 里的分布**：只有 Alex 一个 vault 可看（他那个 vault 里这四个名字的可见目录数为 0）。A3 档的误伤概率是**推断**，不是实测。
- **大小写**：名单是逐字节比较，macOS 上 `Target/` 不会被剪。这是现状口径的延续，本 change 不改（改成折叠匹配会扩大误伤面）。
- **符号链接**：现状「指向目录的 symlink 不递归展开、按文件列出」（[fs_io.rs:205](../../../src-tauri/src/fs_io.rs#L205) 起），本 change 不动。
- **vault 根自身的名字**：若用户把 vault 根取名为 `target`，枚举照常（`is_ignored` 只看根以下的条目；`rel_string` 比的是去掉根之后的相对组件）——本 change 保持不变，且要在实现期加一条单测钉住（否则「扩集把整棵树吃掉」是很容易写出来的 bug）。

## 9. 真机场景 67 的判据设计

### 9.1 为什么「指示可动」的可判定形式是「打开段内 AX 可读」

M283 在场景 60 里实测到：套件读 AX 需要主线程空闲，而打开段（同步 command）阻塞期间 `get_app_state` 只回 `element_count: 1`（读不到任何节点）⇒ 当时「指示在场」这条正观测**在真机上不可判定**，只能改由探针承担。本 change 把打开段移出主线程之后，**同一件事从「读不到」变成「读得到」**，那条被撤下的正观测因此可以立起来：

- **判据**：点开目标 vault 之后、装载完成之前的**一次 AX 快照**里，`AXProgressIndicator` 与文件树节点同时可读。
- **修前行为**：该快照读不到任何节点（主线程被 body 占住）⇒ 判红。**修后**：异步执行，AX 可答 ⇒ 判绿。
- **为什么不是「动画帧在推进」**：一次 `get_app_state` 的往返是秒级（M283 实测采样点约在动作后 4.1s），逐帧判动画没有通道；且 spec 的判据本来就是「在场」（M252 立的口径，本 change 不改）。**MUST NOT** 把「读不到」写成「不在场」（REVIEW.md 第 2 条）。

### 9.2 为什么必须有测量放大器

收窄可见集**本身**就把打开段从秒级压到毫秒级——这是本 change 的目的，但它同时把「打开段内可观测」这个窗口抹掉了。所以场景必须自带放大器（沿用场景 60 的 20×8MB 稀疏 md 口径，把打开段撑到 ~7.5s ≫ 一次 AX 往返），**并且**这个放大器是测量工具不是产品场景：**MUST NOT** 拿该场景日志里的 `vault_load_open` 当规模读数（场景 60 已立此惯例，这里照抄）。

### 9.3 忽略集的判据（场景的另一半）

`seed.bulkVault` 现在会在 vault 根下生成一个 `node_modules` 探针（`scripts/acceptance/lib/app.mjs:236` 的 `ignoredMd`）。场景 67 需要同形状的**构建产物族探针**：根下 `target/`、`dist/`、`test-results/` 各带若干 md，另有可见的真内容（bulkVault 自己生成的 `area-XX` 与它下面的 `note-XXXX.md`）。判据配成正负一对（同一快照里）：真内容的行**在**、三个构建产物目录的行**不在**。REVIEW.md 第 2 条要求负向断言必须与正向见证同场（本条靠「真内容的行在」作见证）。

## 10. 落地地图（文件 / 符号级）

| 落点 | 改动 | 依据 |
|---|---|---|
| `src-tauri/src/fs_io.rs` `IGNORED_NAMES` + `is_ignored` 文档 | 名单扩到 19 个；文档补「按名剪枝的三条性质」与「为什么类型无关」 | spec delta；§2.1 |
| `src-tauri/src/fs_io.rs` 四处使用点 | **不改逻辑**，只核对仍走同一真源（REVIEW.md 第 8 条） | spec delta |
| `src-tauri/src/fs_io.rs` 枚举收口 | 新增一行「忽略计数」诊断（§3.3 的缓解 1；含 `LogEventName` 白名单的新事件名） | §3.3 |
| `src-tauri/src/commands.rs` `vault_open_path` | 加 `#[command(async)]`；注释写明线程语义已与 `vault_open` 拉平 | §5 |
| `src-tauri/src/commands.rs` `prepare_vault_open` | scan / graph 两处打点（`slow_callback`） | §6.2 |
| `scripts/acceptance/lib/app.mjs` `generateBulkVault` | 加构建产物族探针参数（默认仍生成 `node_modules` 探针；与 Rust 侧 harness 的形状参数一起核） | §9.3 |
| `scripts/acceptance/scenarios/67-*.md` | 新场景（草案见本 change 的 `acceptance-scenario.md`） | §9 |
| `docs/backlog.md` | 待归档跟踪；M289 读数落 canon（现在只在 `.tower/comms/` 的 inbox 消息里） | proposal「影响」 |
