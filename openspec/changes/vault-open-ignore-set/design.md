# Design: vault-open-ignore-set

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、哪些地方会咬人、哪些结论还没有读数撑」。

> **Alex 节点 1 裁决（2026-09-28）已落进本文**：A3 名单（`build` / `out` / `vendor`）不收；**B 案（读 `.gitignore` / `.git/info/exclude`）纳入本 change**，并带一条硬性产品约束——**被这些规则挡住的目录与文件在左栏文件树里 MUST 仍然可见**（原话：「我还是希望能在左栏里看到 .gitignore 挡住的目录或文件（比如 .local 里有我需要读的教程）」）；C 案（用户可配置名单）不做。§2 / §3 / §4 因此重写，§11 是给这条约束的影响面对账。

## 0. 一句话方案

打开段的 3.1s 里，scan（1,231ms）+ build_graph（1,879ms）**全花在用户不读的东西上**，而成本与「主动枚举的条目数」近似正比。所以本 change 做三件事：

1. **忽略集拆成两类**：**隐藏类**（硬编码名单，行为不变——不进树、不进索引）与**惰性类**（vault 自己的 VCS 忽略规则命中——**行在树里可见、子树按需枚举、不进索引**）。前者收窄「用户不读的东西」，后者把「用户声明为不跟踪、但可能想读的东西」从「看不见」改成「看得见、不看就不付费」。
2. **打开段移出 IPC 主线程**（`#[command(async)]`，单行）：收窄之后 66ms 档不需要它，但任何收不窄的 vault（用户库 20 万条目）不再整窗死帧。
3. **补两条分段读数**（scan / graph），闭合真机与合成之间那 2.4s 的解释缺口。

三者各自独立可回退。**关键量**：Alex 的 vault 在「隐藏类 + 惰性类」下的主动枚举量 = 1,658 文件 / 2,395 条目 ⇒ 合成实测 `scan 14.0ms + graph 51.7ms = 65.8ms`；而 `.tower`（275,180 文件 / 35G）与 `.local`（他要读的教程）仍然**看得见**，代价从「每次打开付掉」变成「点开哪一层才付哪一层」。

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
| VCS 忽略规则 | **今天完全不读**（`Cargo.toml` 无 `ignore` / `globset` / `walkdir` 依赖；代码里没有任何读 `.gitignore` 的路径） | Alex 真 vault 的 `.gitignore` 覆盖 `node_modules/` / `.pnpm-store/` / `dist/` / `src-tauri/target/` / `perf-results/` / `test-results/` / `*.log` / `.DS_Store` / `HANDOFF.md`；`.tower/` 只在 `.git/info/exclude:7` | 走查有据（M289）；本 change 的输入 |
| **枚举 = 可见集 = 树的数据来源**（本 change 要拆开的同一性） | `scan_workspace` 的输出被六个消费点直接当作「vault 里有什么」 | 六个消费点：文件树模型（`src/tree.ts` 的 `setVault`）、链接索引（`VaultState::build_graph`）、附件索引（`src/main.ts` 的 `attachmentPaths`）、会话恢复的「在不在 vault 内」判据（`src/vault-switcher.ts:137-155` 的 `planRestore`）、阅读位置（`src/reading-position.ts`）、watch 事件过滤（`fs_io::rel_string`） | 走查有据；§4.7 逐条给口径 |

**复现命令**（M289 用的就是它，未改一行代码；harness 命中已存在的 `$TMPDIR/lumir-m283-real-shape` 即复用）：

```bash
CARGO_TARGET_DIR=/tmp/<dir>/target cargo build --release --test vault_open_readings   # 实测 1m22s
TMPDIR=<vault 父目录> cargo test --release --test vault_open_readings -- --ignored --nocapture
```

口径提醒（照录 M289，别当稳态常数读）：harness 是**热缓存**读数，且当时 load average 5–8；真机首次打开是冷的。

## 2. 两类忽略，与名单

### 2.1 两类各自的语义

| | 隐藏类（硬编码名单） | 惰性类（VCS 忽略规则命中） |
|---|---|---|
| 判据来源 | 产品硬编码的名字集（本 change 扩到 16 个名） | vault 自己的 `.gitignore`（含嵌套）与 `.git/info/exclude` |
| 谁在声明 | 产品（「这按结构就不是内容」） | 用户（「我不想让它进版本库」） |
| 文件树 | **不出现**（今日行为，不变） | **出现**（目录行与文件行都在；子树按需枚举） |
| 主动枚举 | 不进入（连同子孙） | 条目本身进枚举（一行），子孙不进 |
| 链接索引 / 附件索引 | 不进入（今日行为） | 不进入（§4.6） |
| watch | 事件一律不投递 | 行级事件总是投递；子树内部事件只对「已按需展开过」的目录投递（§4.4） |
| 代价 | 每次打开都省下；误伤面 = 名单里的通用词 | 每次打开都省下；误伤面 = 用户自己写的规则 |

**为什么硬编码名不跟着变成「可见」**（这条不对称必须说清，否则会被读成不一致）：Alex 的约束对象是**用户可编辑的规则**——他改 `.gitignore` 是为了「不进版本库」，不是「从 Lumir 里藏起来」。硬编码名单是产品的判断（`.git` 是对象库、`node_modules` 是依赖副本、`target` 是构建产物），这些行出现在每一层目录里是纯噪音（Alex 的 repo 里有 13 个 `target` 目录、1,122 个 `dist`、645 个 `out`，绝大多数在依赖树里）；把它们做成可见会把「按需」退化成「十几万个行可选」。**要读构建产物**是另一个需求（若真有，另立 change 做一个显式的「显示被忽略项」开关），本 change 不做。

### 2.2 隐藏类的匹配规则保持不变（这一点比名单本身重要）

`is_ignored` 今天有三条性质，**隐藏类全部保留**：

1. **名字精确匹配**（逐字节、大小写敏感）——不含通配、不含前缀。`dist-old` 不命中 `dist`，`Target` 不命中 `target`。
2. **任意深度**——不只在 vault 根生效。Alex 的 110,501 个 worktree target 就是靠这条剪掉的。
3. **与条目类型无关**——同名文件与同名目录一视同仁（理由见 §2.4）。

### 2.3 名单（Alex 裁决后的最终形态）

| 档 | 名字 | 裁决 |
|---|---|---|
| 既有 | `.git` `.DS_Store` `node_modules` | 不动 |
| A1 生态专名 | `.venv` `venv` `__pycache__` `.next` `.nuxt` `.cache` `.pnpm-store` `.tox` `.gradle` `test-results` `perf-results` | **收**（2026-09-28） |
| A2 工具链常用词 | `target` `dist` | **收**（2026-09-28） |
| ~~A3 通用英文词~~ | ~~`build` `out` `vendor`~~ | **不收**（Alex 裁决 2026-09-28：「A3 名单（build / out / vendor）不收」） |

合计 **16 个名**（3 既有 + 11 A1 + 2 A2）。收益主力仍是 `target`（Alex 的 vault 里 129,655 个可见文件 = 170,317 的 76%）与 `test-results`（9,660）。

A3 被砍的实际代价很小，值得记下：Alex 的 vault 里 `build` / `out` / `vendor` 的**可见目录数为 0**（`dist` / `out` 的 1,122 / 645 个目录绝大多数在 `node_modules` 树内，已由隐藏类剪掉）；损失的是通用性——别人的 Python `build/` 与 npm `vendor/` 不再被隐藏，而这类目录**若在用户的 `.gitignore` 里，照样会走惰性类**（行可见、不主动枚举）。

### 2.4 惰性类覆盖了「名单必然不完整」这一缺口

构建系统的输出目录名是无穷的（`_build` / `zig-out` / `.svelte-kit` / `coverage` / `Pods` / `.dart_tool` / `cmake-build-*`…）。名单只收「常见且高代价」这一批，但**未列名的目录只要被 vault 的 VCS 规则声明过，就自动落进惰性类**——不主动枚举，因此不付打开段的钱。这正是 B 案相对「扩名单」的完备性优势：完备的信息源是用户自己写的那份忽略声明。

## 3. 隐藏类的代价（A1 + A2）

### 3.1 代价一：用户内容可能被静默隐藏

一个已有 vault 里若存在 `notes/target/plan.md`，本 change 之后它从文件树、**链接索引**、附件索引里一起消失——`[[plan]]` 也解析不到了。用户看到的是「我的文件不见了」，且**没有任何提示**。A3 被砍之后，剩下的 16 个名都是工具链固定输出名，误伤概率低但不为零（`dist` 与 `target` 仍是英文词）。

### 3.2 代价二：这些名字从此不能新建 / 改名

`validate_new_name`（[fs_io.rs:328](../../../src-tauri/src/fs_io.rs#L328)）复用同一份名单——它是**有意耦合**的：如果允许建出 `target/` 而枚举又忽略它，用户在界面上既看不到也删不掉（[fs_io.rs:306](../../../src-tauri/src/fs_io.rs#L306) 起的注释写的就是这条）。代价因此是显式的：**新建/改名成这 16 个名字会被 `fs_name_invalid` 拒绝**（人话文案「`{name}` 在忽略集内，建成后不会出现在文件树里」）。注意：**惰性类的名字不受这条约束**——用户可以照常创建/改名成被 `.gitignore` 匹配的名字（它本来就可见可打开），只是它不进索引（§4.6）。

### 3.3 缓解（本 change 能做到的）

1. **诊断日志给一条忽略计数**（实现项，不是 UI）：枚举收口处记一行「被隐藏类剪掉的条目数」。落点是 diagnostics 的事件白名单——新增 `LogEventName::VaultScanIgnored`、字段只有 `count`（十进制字符串，[logging.rs:133](../../../src-tauri/src/logging.rs#L133) 的 `allowed_fields` 与事件名是机制化护栏，新事件名要一并登记）；MUST NOT 记被忽略条目的路径或名字原文（隐私边界不变，只给计数就够用）。用途：用户报「文件不见了」时，一条日志即可判断是不是隐藏类干的。
2. **可回退**：名单是一个常量，回退是单行；`is_ignored` 是纯函数，回退后无残留状态。

### 3.4 与 ADR 0001 的张力（如实记）

ADR 0001 的原文是「全文件类型一等公民」——**一等公民的是文件类型**（不按扩展名过滤），不是「任何目录名都必须在树里」。既有忽略集（`.git` / `node_modules`）已经做了「按名排除非内容目录」这件事；张力成立的部分是判据从「结构上确定不是内容」（`.git` 内是对象库）退到「按名字猜不是内容」。**本 change 用两类拆分显著收窄了这个张力**：现在只有「工具链固定输出名」走隐藏，其余「用户声明过的不跟踪目录」一律可见（惰性）。

## 4. 惰性类：让「不主动枚举」与「看得见」两立

### 4.1 一句话机制

**枚举只枚举「未被规则挡住」的子树；被规则挡住的条目本身仍作为一行出现在枚举结果里，但它的子孙不进本次枚举——用户展开它时才按需枚举一层。** 于是：

- 打开段成本 = 未被挡住的部分（Alex 的 vault：1,658 文件 ≈ 66ms）；
- 可见性 = 全部（挡住的东西一行不少，点开就能读）；
- 代价随注意力移动：点开哪一层付哪一层（一次 `read_dir`），不点不付。

### 4.2 分类算法（枚举侧）

对 `read_dir` 读到的每个条目 `E`（相对路径 `P`，磁盘类型 `is_dir`）：

| 判据 | 结果 |
|---|---|
| 名字命中隐藏类名单，或命中 `.lumir-` 临时文件模式 | **丢弃**（不出现、不递归——今日行为） |
| `P` 命中 vault 的 VCS 忽略规则（含「祖先被排除 ⇒ 子孙全被排除」） | **出一行**（`lazy: true`），**不递归** |
| 其余 | 出一行，**递归** |

「祖先被排除 ⇒ 子孙全被排除」是 gitignore 的既有语义（不能再 re-include 一个被排除目录下的文件），`ignore` crate 的 `matched_path_or_any_parents(path, is_dir)` 正是这个口径。**推论**：惰性子树内部的一切都仍是惰性（不需要逐层重新判定规则），这也是「按需枚举一层」不会越界的依据。

规则栈（嵌套 `.gitignore`）只在**递归进入可见目录**时逐层叠加；惰性子树内部不读它的 `.gitignore`（那里的规则不会改变结论：祖先已排除）。

### 4.3 按需枚举：新命令 + 条目上的惰性标记

- **`FsEntry` 新增 `lazy: bool`**（ts-rs 导出面变更）：`true` 表示「这一条的子树/索引面未枚举」——目录的子孙不在 entries 里（展开时按需拉取），文件不进链接索引与附件索引。前端靠它区分「空目录」与「惰性目录」（没有这个标记，两者在模型里长得一样，展开一个惰性目录会显示成空）。
- **新命令 `fs_scan_dir(dir)`**：返回该**一层**的条目，分类口径与 §4.2 完全同源（隐藏类丢弃、规则命中出 `lazy` 行、其余递归——注意它**只枚举一层**，不递归下钻）。路径 MUST 走与所有读取路径同源的 vault 内校验（`resolve_in_vault`），**MUST NOT 为按需枚举放松边界**；目录不存在 / 不是目录 → 人话 `CommandError`。
- **它也是异步 command**（`#[command(async)]`）：一次展开可能是几万条（`.tower/worktrees` 下层），不能占 IPC 主线程（§5 同口径）。
- **调用时机**：文件树展开一个 `lazy` 目录时（`src/tree.ts` 的 `expandNode` 现在直接从内存模型取子节点，惰性目录要走命令并把结果合并进模型）。
- **物化登记**：`fs_scan_dir(dir)` 成功即把该目录登记进 vault 的「已按需展开集合」（§4.4 的 watch 判据用它）。集合随 vault 装载重建，MUST NOT 跨 vault 串用。

### 4.4 watch 侧如何复现同一判定

判定必须与枚举侧同源（spec 的既有条款：watch 与枚举共用同一忽略集），但事件路径有三种枚举侧没有的难处：拿不到条目类型、被删条目 stat 不到、以及**惰性子树内部的变更不该无条件投递**（`.tower/worktrees` 里的 agent 活动会变成事件风暴）。

**判定规则（逐组件，只看最后组件之外的祖先）**：

```
对事件路径 P（vault 相对）：
  若任一「祖先组件」（P 去掉最后一段后的每个前缀）命中隐藏类  → 丢弃
  若任一「祖先组件」命中 VCS 规则 且 该祖先不在已按需展开集合  → 丢弃
  否则                                                      → 投递
```

三条要点：

1. **最后一段不参与规则判定**：条目自身的行级事件（新建 / 删除 / 改名）总是投递——行的增删必须实时（否则用户删掉 `.local` 后树里留一个死行）。这也顺手消掉了「被删路径拿不到类型、无法判定目录限定规则」的歧义。
2. **祖先命中规则但已物化 ⇒ 投递**：用户展开过的目录，其下的变事实时可见（打开中的文档因此照常得到「外部修改」处置）。用户没展开过 ⇒ 不投递，事件风暴天然被挡在注意力之外（`.tower/worktrees/**` 的 agent churn 与今天一样不进 webview）。
3. **隐藏类的祖先一律丢弃**（不设物化例外）：硬编码名连行都没有，谈不上展开。

**同一判定在两处跑的机制**：`fs_io` 现在刻意不依赖 tauri 类型（ADR 0002 §7），且过滤发生在 `fs_io::watch` 的回调里。做法是把策略对象**下传**：`fs_io::IgnorePolicy`（纯 std 类型：隐藏类名单 + 编译好的 VCS 匹配器 + `Arc<Mutex<HashSet<PathBuf>>>` 的物化集合）由 `commands.rs` 构造并同时交给 `scan_workspace` / `watch` / `fs_scan_dir` / `expand_new_dir_subtrees` / `validate_new_name`——**一份策略，五个使用点**（REVIEW.md 第 8 条：同一语义只能有一个真源）。

> 实现期性能注记（不改判据）：事件路径的规则判定是 glob 匹配，比名字等值贵。若成为热点，允许按「祖先组件 → 判定结果」做进程内缓存，但**语义 MUST NOT 变**（缓存失效面 = 规则重编 + 物化集合变化）。

### 4.5 规则快照与生效时点

- **读什么**：`<root>/.gitignore` 与递归途中的嵌套 `.gitignore`，加上 `<root>/.git/info/exclude`。**MUST NOT 读全局 exclude 文件**（`core.excludesFile` 在 vault 之外，读取它会引入「vault 之外的状态影响 vault 内可见集」的耦合）。
- **何时读**：vault 装载时（`prepare_vault_open`）编译一次，随 vault 存活。
- **规则文件自身变更的生效时点**：**下一次装载**。本会话不重编。
  依据与代价：① 本仓 `fs_scan_workspace`（全量重扫）**目前没有前端调用方**（走查确认），做会话内热生效要新开「重编 + 重扫 + 前端整体替换模型」一条通道，而它只能在装载路径之外再造一条会改树模型的路径（半刷新风险：规则换了索引没换，或树换了索引没换）；② **用户可感知的后果极小**——惰性化只影响「哪些子树被主动枚举/索引」，**可见集不变**（行永远可见），所以改了 `.gitignore` 之后树的样子本来就不会变，变的只是下次打开要不要为它付费。这条如实写进 spec 的已知边界。
- **若将来要热生效**：方向是「规则文件事件 → 重编 → 走与装载同一条重扫通道」，属独立 change（并需先给前端补全量重扫通道）。

### 4.6 索引口径：惰性条目不进索引（确定性优先）

**口径**：链接索引（`LinkGraph`）与附件索引（`attachmentPaths`）只由**主动枚举**的条目建出；惰性条目一律不进去，包括用户已经展开过的（展开是 UI 动作，MUST NOT 改变索引）。

**为什么不让「展开」把条目补进索引**：那会让同一份文档的 wikilink 解析结果取决于**用户点过哪些目录**（`wikilink-resolution` 的既有条款明写「同一 vault 两次打开的解析结果 MUST 一致（确定性）」）。索引的输入必须是磁盘 + 规则的纯函数，不是 UI 历史。

**后果（如实记，写进 spec 的已知边界）**：

- 指向惰性区域的 `[[wikilink]]` 解析为 `unresolved`；`![[img.png]]` 若图片在惰性目录里同样找不到。用户在树里点开那个文件**照常可读**（打开链路是路径直读，不查索引）。
- `wikilink_create`（`wikilink-resolution` 的既有行为）按确定性路径创建空文件、目标已存在则报错——它**不做全 vault 搜索**。因此对一个「真实存在于惰性目录、但索引里没有」的名字点「创建」，会产生一个**重复文件**。这条风险在今天就存在（任何未索引的名字都如此），B 案只是把触发面变宽；本 change 不改 `wikilink_create`，把它记为已知边界与后续候选（若日后要收，方向是「创建前做一次有界的同名探测」）。

### 4.7 六个消费点的口径（逐一交代，不留隐含假设）

| 消费点 | 口径 | 动作 |
|---|---|---|
| 文件树模型（`src/tree.ts`） | 显示**全部**条目（含惰性行）；惰性目录的子孙按需拉取 | 改：展开惰性目录 → `fs_scan_dir` 合并；`lazy` 标记区分空目录 |
| 链接索引（`VaultState::build_graph`） | 只由主动枚举的条目建出 | 不改代码，改口径（§4.6）+ spec 条款 |
| 附件索引（`src/main.ts` 的 `attachmentPaths`） | 同上 | 不改代码，口径写进 spec 边界 |
| 会话恢复的「在不在 vault 内」（`src/vault-switcher.ts:137-155`） | **不再只看枚举集合**：条目集里没有的路径，补一次 vault 内存在探测（只探测会话里的那几条路径，不改写任何文件）；存在即照常恢复 | 改：新增一条探测（可复用 `fs_file_meta` 或等价命令），跳过计数仍**由枚举 + 探测的结果在装载完成时给出**（口径不变，来源多一个） |
| 阅读位置（`src/reading-position.ts`） | 按路径键控，与集合无关 | 不改 |
| watch 事件过滤（`fs_io::rel_string`） | 见 §4.4 | 改 |

> 会话恢复这条不是洁癖：**没有它，用户从 `.local` 打开的教程在下次启动时会被判成「已删除」并跳过**——他刚被允许打开的东西又被系统丢掉。

### 4.8 匹配器选型：引 `ignore` crate（新依赖）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **`ignore` crate（推荐）** | gitignore 语义完整（`!` 取反、`/` 锚定、`**`、目录限定、注释、转义、大小写规则），与 ripgrep 同源、被广泛验证；用它的 `gitignore` 模块即可，不必换掉自己的遍历实现 | 新增依赖（连带 `globset` 等传递依赖）；需要在依赖评审里过一遍 |
| 手写子集 | 零新依赖 | 子集必然猜错：`!` 与排除目录的交互、锚定边界、`**` 语义、注释转义——**猜错的后果是「该隐藏的没隐藏」（性能回落）或「该显示的没显示」（正是 Alex 这条约束要防的）** |

选 `ignore`：这条约束的产品语义是「按用户写的规则办事」，规则解释错了就等于产品承诺没兑现。**这是本 change 唯一的依赖新增**，请在节点 1 一并确认（proposal 的 What Changes 已列）。

### 4.9 边界（如实记，且写进 spec）

- **非 git 仓库的 vault**：只要存在 `.gitignore` 就按它判（`.gitignore` 的存在本身就是用户的声明）；`.git/info/exclude` 只在 `<root>/.git` 是**目录**时读。
- **`.git` 是文件**（linked worktree 的 gitlink）时：不读 `info/exclude`（真身在 gitdir 里，跟着 gitlink 走会把 vault 边界外的配置读进来）。
- **不读全局 excludes**（§4.5）。
- **大小写**：匹配器按 gitignore 的规则解释（默认大小写敏感），与隐藏类名单的逐字节口径同向；本 change 不引入折叠匹配。
- **符号链接**：现状「指向目录的 symlink 不递归展开、按文件列出」不变。
- **vault 根自身的名字**：不参与判定（vault 根叫 `target` 也照常打开）——隐藏类与惰性类都只看根以下的组件。
- **惰性子树内部**：不读它的 `.gitignore`（祖先已排除，结论不会变，见 §4.2）。

### 4.10 两个用例走查（Alex 的两个现场）

**例 1：`.local/教程.md`（在 `.git/info/exclude` 里）**
打开 vault → 枚举 `.local` 这一条（`lazy: true`，不进去）→ 树里出现 `.local` 行 → 用户点开 → `fs_scan_dir(".local")` 返回 `教程.md`（不递归）→ 用户点开读。打开段为它付的钱：**一次 dirent 读取**。打开中的 `教程.md` 若被外部改写：因为 `.local` 已被物化，事件正常投递 ⇒ 外部修改提示照常。
**代价**：`[[教程]]` 在别处写会解析为 `unresolved`（§4.6）。

**例 2：`.tower/`（275,180 文件 / 35G，在 `.git/info/exclude` 里）**
枚举出 `.tower` 一行（`lazy: true`）→ 打开段为它付的钱：一次 dirent 读取；active 枚举从 170,317 文件掉到 **1,658**（M289 实测 66ms）。用户不点它，agent 的 churn 一个事件都不进 webview（未物化）；他真点了，就按层付费（`.tower` → `worktrees` / `comms` → …，每层一次 `read_dir`）。

## 5. 打开段与按需枚举移出 IPC 主线程

### 5.1 机制核实（读 tauri 2.11.5 / tauri-macros 2.6.3 源码，不靠记忆）

- 宏对「同步函数 + `async` 上下文」的处理路径：`ExecutionContext::Async if function.sig.asyncness.is_none() => "sync_threadpool"`（`tauri-macros-2.6.3/src/command/wrapper.rs:264`，cargo registry 路径 `~/.cargo/registry/src/index.crates.io-*/`）。
- 生成的 body 是一个 `async move`（`wrapper.rs:388` 的 `body_async`），交给 `resolver.respond_async_serialized(...)`；该函数在 `tauri-2.11.5/src/ipc/mod.rs:371` 的 `respond_async_serialized_inner` 里走 `crate::async_runtime::spawn` ⇒ **body 在 async 运行时（tokio 多线程）里执行，不占 IPC 主线程**。
- 顺带的一层：返回值的 JSON 序列化也在同一个 spawn 出来的任务里——`ResultTag::future` 调 `value...?.body()`（`tauri-2.11.5/src/ipc/command.rs:265`），而 `impl<T: Serialize> IpcResponse for T` 的 `body()` 就是 `serde_json::to_string`（`tauri-2.11.5/src/ipc/mod.rs:183`）。同步 command 走的是 `ResultTag::block` → `resolver.respond(value)`（`command.rs:250`），即在主线程上序列化。**所以 async 化同时把「20 万条目的 VaultInfo 序列化」移出主线程**（M289 的 survey 写「响应序列化仍在主线程侧」，这一句按源码不成立——本 change 以源码为准，实现期别照抄 survey 那一行）。

### 5.2 先例与风险

`vault_open`（目录选择器那条 path，[commands.rs:590](../../../src-tauri/src/commands.rs#L590)）本来就是 `async fn`，跑的是同一段 `open_vault` 工作，已经在生产里验过（多 vault 切换、注册表 remap、启动恢复都触发它）。本 change 做的是**把 outlier 拉平**：`vault_open_path` 与新的 `fs_scan_dir` 都标 `#[command(async)]`。

- 并发/顺序语义：前端 `inFlight` 串行化 + `commit_vault_open` 单次持锁提交不变；`prepare_vault_open` 里的注册表写（`reconcile_vault`）本来就与 `vault_open` 路径同源。
- 已知不完美：body 里是**阻塞式文件 IO**（读目录、读 md），跑在 async 运行时的 worker 上会占住一个 worker（不是 `spawn_blocking`）。同仓 `vault_open` 已是这个形态；本 change 与它保持一致，**不**引入 `spawn_blocking`（那是形态分叉，且没有读数表明需要）。
- 剩下仍在主线程的：command 的参数解析（`parse_args`）与最后一步「把响应投递给 webview」。payload 的 `JSON.parse` 在 webview 主线程（§7）。
- 按需枚举的并发：两次展开同一目录 / 展开与全量重扫并发时，按「后到者以磁盘现状为准」合并（前端按路径去重，§9 的验收只判终态）。

## 6. 分段读数与「真机 5.5s vs 合成 3.1s」的 2.4s 缺口

### 6.1 缺口是什么

真机日志 09-28 的 `vault_load_open` = 5,501ms（另两条 12,416 / 12,695ms），而同形状合成的 scan+graph = 3,110ms。候选解释（M289 排序，均未坐实）：① 冷缓存（194k 条元数据 + 171MB md 不在页缓存里；同路径读数跨度 48× 指向缓存/负载主导尾部）；② 真 vault 路径更深（`canonicalize` 逐组件解析）；③ Tauri/macOS 对大 payload 的额外编码。**区分 ①②③ 只能靠在同一条真机路径上分段读数**。

### 6.2 加哪几条，口径是什么

**加 2 条（读数），不是 4 条**：

| 读数名 | 落点 | 覆盖 | 阈值 |
|---|---|---|---|
| `vault_open_scan` | `prepare_vault_open` 里 `scan_workspace` 前后打点 | 全量枚举 | **无条件记录** |
| `vault_open_graph` | 同函数里 `build_graph` 前后打点 | 建链接索引 | **无条件记录** |

口径沿用 M283 的 `vault_open_watch`：走 `logging::slow_callback`（事件名 `slow_callback`、字段 `name` / `ms`，白名单不新造字段），**刻意不设阈值**——理由同源：「日志里没有这一行」与「它很快」事后不可区分，阈值会把「没超阈值」写成「没有读数」；vault 打开是低频动作。

**按需枚举另有一条（有条件，阈值 250ms）**：`vault_scan_dir`——一次展开若超过 250ms，用户会看到明确的等待，值得留一条读数（阈值口径与前端 `phaseMs` 一致；低频、不稀释日志）。它**不是**本 change 的性能目标，只是「用户点了大目录」这件事的可观测面。

**为什么不另加「serialize / IPC」两条**：它们与前端既有的 `vault_load_open`（`phaseMs`，250ms 阈值；见 [src/main.ts](../../../src/main.ts)）是同一段，做减法即可：`序列化+传输+解析 ≈ vault_load_open − scan − graph`。要单独测序列化得让 command 返回**预序列化的 raw response**（Tauri 有 `tauri::ipc::Response` 这条通道，`tauri-2.11.5/src/ipc/mod.rs:190`），那会把 `VaultInfo` 的响应形态改掉 + 前端手工 `JSON.parse`——**本 change 不做**（收益是「多一条读数」，成本是改契约；且 async 化之后序列化已不在主线程上，它不再是我们关心的时间线）。

### 6.3 2.4s 的归因指望什么

真机跑一次之后：`vault_load_open`（前端总时长）− `vault_open_scan` − `vault_open_graph` ≈ 序列化 + 传输 + `JSON.parse`。若这个残差很小（预期 ≪ 100ms），而合成 scan+graph 只有 3.1s ⇒ **剩下的就是「同一段代码在真 vault 上比合成慢」**，即 ①/② ——那属于「冷缓存与路径深度」，不是本 change 要修的（它只影响首次打开，且 async 化之后不再冻结界面）。若残差很大，则 ③ 成立，需要另立 change（raw response / 分片传输）。

## 7. 前端侧的两段剩余边界

1. **装载后的装配段**：打开段结束（响应到达）之后，webview 主线程上还有 payload 解析 → `applyVault` → `tree.setVault`（给全部条目建节点表）。本 change 不动它；收窄可见集之后它的输入同步变小（27MB → 0.19MB），是**间接**收益，没有直接实现改动、也没有独立读数。
2. **按需展开这一段（本 change 新增的等待面）**：用户展开一个惰性目录时，`fs_scan_dir` 是异步的，返回前该目录在树里处于「展开但还没有子行」的一拍。要求：MUST NOT 阻塞主线程（§5.2）、MUST NOT 把这一拍渲染成「空目录」（靠 `lazy` 标记区分）、展开结果 MUST NOT 覆盖用户在同一拍里做的别的操作（按路径合并）。**不引入加载指示文案**（本 change 的文案增量为零；若实现期发现确需，按 deck 末位取号）。

## 8. 未验项与已知边界（照录，别读成「已覆盖」）

- **真机全链路的分段读数**：本 change 之前，真机只有 `vault_load_open` 一条（合成侧才有 scan/graph 直测）。§6 的埋点是**闭合它的手段**，读数本身要等实现后真机跑一次才有。
- **B 案在真机上的收窄幅度**：66ms 是 M289 在合成形状上**手工收口**（把目标目录移走）得到的读数，不是「读 `.gitignore` / `info/exclude` 之后」的读数——实现后必须用同一 harness 复测一次（tasks 3.2），不得把 66ms 直接写成实现结论。
- **惰性展开的真机成本分布**：`.tower/worktrees` 那类目录一层多少条、一层多少 ms，没有读数（`vault_scan_dir` 埋点就是为了它）。
- **前端装配段与树模型的耗时**：没有读数（`vault_load_tree` 三天日志零出现 ⇒ 与 250ms 阈值相比无意义；但没有真值）。
- **「隐藏类误伤」的真实发生率**：无法测——本 change 只保证诊断日志里能读到忽略计数（§3.3），不保证体验上可发现。
- **惰性条目的解析降级率**：无法测（依赖用户的链接习惯）；口径已定（§4.6），后果已写进 spec。
- **`wikilink_create` 对惰性目标可能造出重复文件**：既有行为，B 案把触发面变宽（§4.6）；本 change 不改它。
- **规则不热生效**：改了 `.gitignore` 本会话不重编（§4.5）；可见集不变，只影响「哪些子树被主动索引」。

## 9. 真机场景 67 的判据设计

### 9.1 为什么「指示可动」的可判定形式是「打开段内 AX 可读」

M283 在场景 60 里实测到：套件读 AX 需要主线程空闲，而打开段（同步 command）阻塞期间 `get_app_state` 只回 `element_count: 1`（读不到任何节点）⇒ 当时「指示在场」这条正观测**在真机上不可判定**，只能改由探针承担。本 change 把打开段移出主线程之后，**同一件事从「读不到」变成「读得到」**，那条被撤下的正观测因此可以立起来：

- **判据**：点开目标 vault 之后、装载完成之前的**一次 AX 快照**里，`AXProgressIndicator` 与文件树节点同时可读。
- **修前行为**：该快照读不到任何节点（主线程被 body 占住）⇒ 判红。**修后**：异步执行，AX 可答 ⇒ 判绿。
- **为什么不是「动画帧在推进」**：一次 `get_app_state` 的往返是秒级（M283 实测采样点约在动作后 4.1s），逐帧判动画没有通道；且 spec 的判据本来就是「在场」（M252 立的口径，本 change 不改）。**MUST NOT** 把「读不到」写成「不在场」（REVIEW.md 第 2 条）。

### 9.2 为什么必须有测量放大器

收窄可见集**本身**就把打开段从秒级压到毫秒级——这是本 change 的目的，但它同时把「打开段内可观测」这个窗口抹掉了。所以场景必须自带放大器（沿用场景 60 的 20×8MB 稀疏 md 口径，把打开段撑到 ~7.5s ≫ 一次 AX 往返），**并且**这个放大器是测量工具不是产品场景：**MUST NOT** 拿该场景日志里的 `vault_load_open` 当规模读数（场景 60 已立此惯例，这里照抄）。

### 9.3 场景里的三组判据（Alex 裁决后更新）

1. **隐藏类**：根级 `target/` / `dist/` / `test-results/` 探针**不在**树里（与改动前的差异面）。
2. **惰性类（Alex 的新约束，本场景新增）**：vault 里放一份 `.gitignore`（声明 `.local/`）与 `.git/info/exclude`（声明 `.excluded-dir/`），两者各带一个 md：
   - 两个目录**行在树里**（正向断言，不许写成「读不到 ⇒ 不在」）；
   - 展开 `.local` ⇒ 其中的 md **出现在树里**、可打开（`editor.has` 到内容）；
   - 这一对正负断言同场，且**同一快照里还要有可见的真内容行**作正向见证（REVIEW.md 第 2 条）。
3. **打开段内界面可响应 + 读数落盘**：同 §9.1 与 §6.2。

### 9.4 场景的放大器与惰性探针会不会互相干扰

不会：放大器是 vault 根下的**可见** md（不被任何规则命中），惰性探针在 `.local` 之下（不可见地枚举、只在展开时付钱）。**MUST NOT** 把放大器放进 `.local`——那会把「测量放大器」与「惰性子树」两件事混在一起，读数与判据都失去区分度。

## 10. 落地地图（文件 / 符号级）

| 落点 | 改动 | 依据 |
|---|---|---|
| `src-tauri/Cargo.toml` | 新增依赖 `ignore`（只用它的 `gitignore` 模块） | §4.8 |
| `src-tauri/src/fs_io.rs` `IGNORED_NAMES` | 名单 3 → 16（A1+A2），文档写清「两类」与各自语义 | spec delta；§2 |
| `src-tauri/src/fs_io.rs` `IgnorePolicy`（新） | 隐藏类名单 + 编译好的 VCS 匹配器 + 物化集合（纯 std 类型，不引 tauri），提供 `classify()` | §4.4 / §4.2 |
| `src-tauri/src/fs_io.rs` `scan_workspace` | 按 `classify()` 出 `lazy` 行、不递归；给 `FsEntry` 填 `lazy` | §4.2 |
| `src-tauri/src/fs_io.rs` `rel_string` | 换成 §4.4 的逐组件判定（隐藏类祖先丢弃、惰性祖先未物化丢弃） | §4.4 |
| `src-tauri/src/fs_io.rs` `fs_scan_dir`（新） | 一层枚举 + 同源分类 + 物化登记 | §4.3 |
| `src-tauri/src/fs_io.rs` `expand_new_dir_subtrees` / `validate_new_name` | 沿用 `IgnorePolicy`（隐藏类照旧拒绝；惰性类不拒绝） | §3.2 / spec delta |
| `src-tauri/src/fs_io.rs` 枚举收口 | 新增`VaultScanIgnored` 忽略计数（含 `LogEventName` 白名单登记） | §3.3 |
| `src-tauri/src/commands.rs` `prepare_vault_open` | 编译 VCS 规则、构造 `IgnorePolicy` 并交给 watch / scan / graph；scan / graph 两处打点 | §4.5 / §6.2 |
| `src-tauri/src/commands.rs` `vault_open_path` | 加 `#[command(async)]`；注释写明线程语义已与 `vault_open` 拉平 | §5 |
| `src-tauri/src/commands.rs` `fs_scan_dir` command（新） | `#[command(async)]` + vault 内路径校验 + 打点 | §4.3 / §5.2 / §6.2 |
| `src-tauri/src/commands.rs` `VaultState` | 持有当前 `IgnorePolicy`（含物化集合）；装载时重建 | §4.3 / §4.4 |
| `src-tauri/src/commands.rs` 会话恢复的存在探测 | 新增一条探测入口（或复用 `fs_file_meta`），不改写任何文件 | §4.7 |
| `src/bindings/**`（ts-rs 重导出） | `FsEntry` 新增 `lazy` | §4.3 |
| `src/tree.ts` | 惰性目录展开走 `fs_scan_dir` 并按路径合并；`lazy` 与「空目录」区分 | §4.7 / §7.2 |
| `src/main.ts` | 装配新命令；附件索引口径（只由主动枚举建出）保持并写注释 | §4.6 / §4.7 |
| `src/vault-switcher.ts` `planRestore` | 「在不在 vault 内」补存在探测（条目集 + 探测），跳过计数口径不变 | §4.7 |
| `scripts/acceptance/lib/app.mjs` `generateBulkVault` | 加构建产物族探针（隐藏类）+ `.gitignore` / `.git/info/exclude` 惰性探针 | §9.3 |
| `scripts/acceptance/scenarios/67-*.md` | 新场景（草案见本 change 的 `acceptance-scenario.md`） | §9 |
| `docs/backlog.md` | 待归档跟踪；M289 读数落 canon（现在只在 `.tower/comms/` 的 inbox 消息里）；`wikilink_create` 的重复文件风险与「规则热生效」两条后续候选 | proposal「影响」 |

## 11. 影响面清单（AGENTS.md「影响面升级线」的对账，2026-09-28）

Alex 裁决 2 的「忽略项必须可见」**推翻了本仓一条既有同一性**：「枚举结果 = 可见集 = 文件树的数据来源」（写在 `fs-io` 与 `file-tree` 的 canonical 文本里，且是六个消费点的隐含前提）。下表是本次改动对既有设定 / 逻辑 / 实现的影响面，供节点 1 一并确认：

| # | 既有设定 / 实现 | 本 change 之后的形态 | 影响级别 |
|---|---|---|---|
| 1 | 忽略集 = 不可见集（fs-io 的 SHALL 条款 + file-tree 的「数据来源 = 枚举结果」） | 拆成隐藏类（不可见）与惰性类（可见但不主动枚举）；两条 canonical 文本都改写 | **推翻既有设定**（跨 2 个 capability 的措辞与 6 个消费点的口径） |
| 2 | 树模型 = 枚举快照（`setVault` 一次性建满） | 快照 + 按需层（展开惰性目录发命令合并） | **改实现结构**（前端） |
| 3 | watch 判定 = 名字的纯函数（无状态、可在 fs_io 内自洽） | 需要策略对象 + 物化集合（跨层传、有生命周期、随 vault 重建） | **改实现结构**（后端） |
| 4 | 依赖面：`Cargo.toml` 无 ignore 类依赖 | 新增 `ignore` crate（§4.8） | **新增依赖**（请一并确认） |
| 5 | 导出面：`FsEntry` 是「路径 / 类型 / 大小 / mtime」四元组 | 新增 `lazy` 字段（ts-rs 重导出 `src/bindings/**`） | **改契约**（前端全部消费点重新编译即得，行为面已逐条列在 §4.7） |
| 6 | 会话恢复的「在不在 vault 内」= 在枚举集合里 | 集合 + 存在探测 | **改判据**（不改用户可见语义：仍是在 vault 里的文件才恢复） |
| 7 | 链接 / 附件索引覆盖「vault 里的一切」 | 覆盖「主动枚举的那部分」；惰性区域解析降级（含 `wikilink_create` 的重复文件风险） | **收窄能力边界**（写入 spec 的已知边界） |

**没有变的部分（同样明确）**：vault 内路径约束（ADR 0002 §3 的安全边界）、附件大小上限、保存链路与 CAS、watch 的 debounce 与自身写盘回声判据、性能合同数字（ADR 0002 §6）、文案 deck（零新增）。**本清单已于 2026-09-28 经 tower 转达 Alex 并经他确认接受**（含 `wikilink_create` 触发面变宽与惰性区域的解析降级）；下面这段回退口径保留为记录——若日后要回收，按它执行，不静默缩水。回收档位：**只保留隐藏类扩集与 async 化**（回到 2840bc1 的形态，B 案另立 change），届时 spec delta 与 tasks 按提案的裁决改法一并回退。
