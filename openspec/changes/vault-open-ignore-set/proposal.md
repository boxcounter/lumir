# Proposal: 收窄 vault 打开段的可见集（两类忽略 + 打开段移出主线程）

- Change ID: vault-open-ignore-set
- 日期: 2026-09-28
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Alex 节点 1 裁决结果（2026-09-28）

本 proposal 的 2840bc1 版提出了三条裁决点，Alex 已裁决；同日还有第二轮**机制合并**指令（下表第 6 行）。本文件与 design / tasks / spec delta 均已按裁决重做。

| 裁决点 | Alex 裁决 | 落点 |
|---|---|---|
| 1. 忽略集的档位 | **A3（`build` / `out` / `vendor`）不收**；A1 + A2（含 `target` / `dist`）收 | **内置规则**定为 16 条名字 + 1 条临时文件模式（原「三档 19 名」删去 A3），见 design §2.4 |
| 2. 是否引入 `.gitignore` / `.git/info/exclude` 语义 | **纳入本 change，不再缓议**，并带一条硬性产品约束：**被这些规则挡住的目录与文件在左栏文件树里 MUST 仍然可见**（原话：「我还是希望能在左栏里看到 .gitignore 挡住的目录或文件（比如 .local 里有我需要读的教程）」） | 「**用户规则**」档：命中 ⇒ 行可见、子树按需枚举、不进索引，见 design §4；spec delta 相应补条款 |
| 2'. 用户可配置忽略名单（C 案） | **不做**（Alex 未提） | Non-goals |
| 3. `vault_open_path` 标 `#[command(async)]` | **纳入本 change** | 维持 design §5 |
| 4. 规则生效时点 | **vault 打开时编译一次，`.gitignore` 改动下次装载生效**（ask 时列为待确认项，2026-09-28 经 tower 转达确认） | design §4.5 |
| 5. B 案的影响面接受度 | **接受完整影响面**（概念拆分、新命令、`FsEntry` 导出面变更、`ignore` crate 依赖、树模型与 watch 过滤改动、惰性区域链接/附件降级含 `wikilink_create` 触发面变宽——Alex 知情接受） | design §11（保留为记录，不再作为待确认项） |
| 6. **机制合并（同日第二轮指令）** | Alex：「硬编码隐藏类是否可以和 .gitignore 合并、而不是单独硬编码，少一种硬编码的特殊情况」⇒ **合并成一份规则表、走同一个匹配器**（`ignore` crate）；**来源决定去向**（内置规则 ⇒ 不可见；用户规则 ⇒ 惰性可见）；`is_ignored` 的名字等值判定退役。两条边界由本 proposal 论证后定：**用户规则的取反 MUST NOT 推翻内置规则**；内置规则写成**无尾斜杠名字字面量**，保持「同名文件也隐藏」这条既有语义不改判 | design §2（§2.2 判定顺序 / §2.3 等价承诺 / §2.6 取反论证） |

**影响面声明（AGENTS.md「影响面升级线」）**：裁决 2 那条约束**推翻了本仓一条既有同一性**——「枚举结果 = 可见集 = 文件树的数据来源」。要同时满足「不主动枚举」与「看得见」，必须把它拆成两类并使用按需枚举，这会连带：新增依赖（`ignore` crate）、新增命令与后端状态、`FsEntry` 加字段（改 ts-rs 导出面）、文件树模型从「快照」变成「快照 + 按需层」，以及六个消费点的口径逐条交代（含会话恢复的「在不在 vault 内」判据）。**这些影响的清单在 design §11**（含第 6 行机制合并带来的「`is_ignored` 退役、内置规则改由匹配器解释」）；清单已按 Alex 2026-09-28 的裁决确认接受，回退口径保留为记录：若要回收，可退到「只保留内置规则扩集 + async 化」的形态（B 案另立 change），spec delta 与 tasks 按裁决改法一并回退，不静默缩水。

## Why

Alex 原话（2026-09-28）：

> 「奇怪，我现在切换 vault 依然要卡好几秒」

M268/M283 把**会话恢复段**做快了（真实 vault 恢复段 422–471ms → 35–120ms），剩下的「几秒」落在**打开段**上。M289 survey（只读，零 diff）把它拆开了：

### 一、打开段 = Rust 侧 scan + build_graph，全跑在 IPC 主线程上

`vault_open_path`（[src-tauri/src/commands.rs:614](../../../src-tauri/src/commands.rs#L614)）是**不带 `async`** 的同步 command；Tauri 语义下同步 command 的 body 在 IPC 主线程内联执行（同仓对照：[commands.rs:590](../../../src-tauri/src/commands.rs#L590) 的 `vault_open` 是 `async fn`）。该段包含 `reconcile_vault` → `fs_io::watch()` → `scan_workspace` → `build_graph`。

**实测**（release 直调生产函数，5 次取中位；harness [src-tauri/tests/vault_open_readings.rs](../../../src-tauri/tests/vault_open_readings.rs)，复刻 Alex 真 vault 的可见形状 166,626 文件 / 200,274 条目 / 14,573 md）：

| 段 | 读数 | 说明 |
|---|---|---|
| `scan_workspace` | **1,231ms** | 全量递归枚举 20 万条目 |
| `build_graph` | **1,879ms** | 逐 md 读盘建链接索引（非 md 也各 upsert 一次） |
| `watch` 建流 | 1.7ms | 不是瓶颈（M283 已测） |
| **scan + graph** | **3,110ms** | 全在主线程内联执行 |

同一段（**主动枚举量收窄到真内容**后：1,658 文件 / 2,395 条目 / 3.3MB）：**scan 14.0ms + graph 51.7ms = 65.8ms**。

### 二、可见集的 170,317 个文件里，真内容只有 1,658

忽略集目前**只有 3 个硬编码名字**（`IGNORED_NAMES`，[src-tauri/src/fs_io.rs:28](../../../src-tauri/src/fs_io.rs#L28)）：`.git` / `.DS_Store` / `node_modules`。按名剪枝（任意深度、不靠 `.gitignore`）已剪掉 147,440 个文件（含 12 个 tower worktree 里嵌套的 133,440 个 `node_modules`），**`.git` 不是嫌疑**。

Alex 的 vault 是 lumir 仓库本身，其可见集构成（M289 只读盘点）：

| 构成 | 可见文件数 |
|---|---|
| 12 个 worktree 的 `src-tauri/target` | 110,501 |
| 根 `src-tauri/target` | 19,154 |
| `test-results/` | 9,660 |
| `.tower/`（comms 2,832 + worktree 仓库内容 ~14,000） | ~17,000 |
| **真内容** | **1,658** |

即：**可见集里 99% 的文件（170,317 中的 168,659）与阅读无关**，而忽略集只覆盖了 VCS/包管理内部目录——打开段的成本与主动枚举的条目数近似正比，钱全花在这里。

### 三、`target` / `test-results` 之外，还有一块只能靠「读用户自己的忽略声明」才能省下的钱

`.gitignore` 覆盖 `node_modules/` / `.pnpm-store/` / `dist/` / `src-tauri/target/` / `perf-results/` / `test-results/` / `*.log` / `.DS_Store` / `HANDOFF.md`；**`.tower/` 只在 `.git/info/exclude:7`**。想把它（275,180 文件 / 35G）从打开段里拿掉，只有两条路：把它硬编码进产品名单（Alex 已判不进），或者**读用户自己的忽略声明**——而后者必须同时满足 Alex 的新约束：**挡住的仍然看得见**。

### 四、payload 与前端解析不是瓶颈，单挪主线程也不够

真可见形状的 payload ≈27MB，同一份 payload 在 V8 里 `JSON.parse` 只要 71–73ms（46MB 档实测）。所以「流式化 entries / 懒加载 payload」在收窄主动枚举量之前不值得做；而只把 command 挪出主线程（3.1s 照旧要跑）也不解决「慢」，只解决「整窗冻结」。

### 五、为什么必须走 change proposal

忽略集「本 change 内不可配置」与「被忽略的条目 SHALL NOT 进入枚举结果」是一条 SHALL 条款（[openspec/specs/fs-io/spec.md:11](../../../openspec/specs/fs-io/spec.md#L11)），任何放宽（含新增「可见但惰性」这一档）都得先过提案。本 change 就是这份提案。

### 六、另一条不互斥的杠杆（本 change 范围外，列给裁决参考）

M289 已向 tower 报了一条 finding：`.tower/`（275,180 文件 / 35G）就在 vault 里，12 个 worktree 各自带一份 `src-tauri/target`。**本 change 落地后，它对「打开段耗时」的贡献已被惰性化吸收**：`.tower` 被 `info/exclude` 命中 ⇒ 主动枚举量同样掉到真内容那一档（1,658 文件 / 66ms 档），打开段不再为它付费。tower 侧布局（把 worktree 移出 vault 或共享一个 vault 外的 `CARGO_TARGET_DIR`）**仍然值得做，但诉求变了**：剩下的是磁盘 33G 与「用户真去展开那一层时的代价」（按需枚举一层、以及物化后的实时事件）——不再是他每次切 vault 都要付的税。两者的关系是互补而非替代：本 change 让**任何**仓库形状的 vault 打开都不再被构建产物与用户声明的忽略目录拖住，同时**他依然能在树里看到并读到那些目录**。

## What Changes

1. **忽略集合成一份规则表**（spec delta：`fs-io`「全类型递归枚举」MODIFIED）。**内置规则**（产品硬编码）从 3 个名字扩到 **16 个名字 + 1 条临时文件模式**（既有 3 + A1 11 + A2 `target`/`dist`；**A3 `build` / `out` / `vendor` 按裁决不收**），并与**用户规则**（vault 自己的 `.gitignore` / `.git/info/exclude`）合成**同一份表、走同一个匹配器**（`ignore` crate 的 gitignore 语义）；`fs_io` 的 `is_ignored` 名字等值判定退役，枚举 / watch / 文件树 / 索引 / 目录改名的子树展开 / 新建改名的名字校验**全走这一份表**（一个真源）。该表本 change 内不可配置（C 案不做）。
2. **去向按规则来源分：内置 ⇒ 不可见，用户 ⇒ 惰性可见**（spec delta：`fs-io` 新增一条「按需枚举目录」requirement + MODIFIED「watch 增量事件流」；`file-tree` 两条 MODIFIED）：
   - 判定顺序固定：**内置规则先判、命中即不可见**（用户规则里的取反——如 `.gitignore` 写 `!target/`——MUST NOT 把它放回来；论证见 design §2.6：内置规则是产品判断，且它的不可见性同时是性能护栏，不能由用户一行编辑关掉）；否则**用户规则命中 ⇒ 出一行**（`lazy` 标记）、**不递归**；否则正常枚举并递归；
   - 文件树展开惰性目录时经新命令 `fs_scan_dir(dir)` 按需拉取**一层**（同源分类），并把这层结果合并进模型；
   - watch：内置规则祖先的事件一律丢弃；用户规则祖先的事件只在「该目录已被按需展开过」时投递（否则 `.tower/worktrees/**` 的 agent churn 会变成事件风暴）；条目自身的行级增删改总是投递（树里的行必须实时）；
   - 索引：惰性条目不进链接索引与附件索引（确定性——索引的输入是磁盘 + 规则的纯函数，不是 UI 历史）；指向惰性区域的 `[[wikilink]]` / `![[img]]` 解析降级，如实写进 spec 的已知边界；
   - 规则读什么：内置规则 + `<root>/.gitignore`（含递归途中的嵌套）+ `<root>/.git/info/exclude`；**不读全局 excludes**；用户规则之间按 git 口径定优先级（深层 `.gitignore` > 浅层 > `info/exclude`）；**生效时点 = vault 装载时编译一次**（`.gitignore` 改动下次装载生效——可见集不随规则变化，故用户可感知的后果极小，而热生效要新开「重编 + 重扫 + 前端整体替换模型」通道）；
   - 匹配语义由 `ignore` crate 提供（gitignore 完整语义：`!` / 锚定 / `**` / 目录限定），**内置规则与用户规则共用同一个匹配器**——「少一种硬编码特例」就是这一步落到实处；**这是本 change 唯一的依赖新增**（已随影响面确认接受）。
   - **等价承诺**：「任意深度 / 同名文件与目录一视同仁 / 大小写敏感 / `.lumir-` 临时文件不进树」逐条与今日一致，由一条对拍测试钉住（design §2.3），不是口头承诺。
3. **会话恢复的「在不在 vault 内」补一次存在探测**（spec delta：`vault-workspace`「装载后恢复标签列表」MODIFIED）：不再只看枚举集合——否则用户从 `.local` 打开的教程下次启动会被判成「已删除」。跳过计数口径不变。
4. **打开段与按需枚举移出 IPC 主线程**（spec delta：`vault-workspace`「vault 打开」MODIFIED）。`vault_open_path` 与新命令 `fs_scan_dir` 都标 `#[command(async)]`，与既有 `vault_open` 的线程语义拉平；顺带把响应序列化也移出主线程（tauri 2.11.5 的 async 路径在 tokio 任务里做 `IpcResponse::body()` 的 `serde_json::to_string`）。理由：内置规则名单永远追不上用户 vault，而这一条把最坏情况从「整窗死帧」变成「界面活着、指示在动」。
5. **改写「装载的即时反馈」的已知边界**（spec delta：`vault-workspace` MODIFIED）。现条文写着「打开段由同步 command 承担 ⇒ 该段期间 webview 不能重绘、指示只能静止显示、用户看到的是 beachball」；第 4 条改完这句话就过期了：打开段不再整段冻结，**剩余边界**是打开段结束后的前端装配（payload 解析 + 树/索引装配）与新增的「按需展开」那段异步等待。
6. **打开段两条分段读数 + 按需枚举一条**（无 spec 变更，走既有 `slow_callback` 事件族）：`vault_open_scan` / `vault_open_graph`（无条件记录）与 `vault_scan_dir`（250ms 阈值）；配合前端既有 `vault_load_open` 做减法，即可把打开段切成 scan / graph / 序列化+传输+解析 三段——这是闭合「真机 5,501ms vs 合成 3,110ms 的 2.4s 缺口」的唯一手段。
7. **真机验收场景 67**（三组判据，草案见 [acceptance-scenario.md](acceptance-scenario.md)）：① 内置规则探针（`target` / `dist` / `test-results`）**不在**树里，且 fixture 的 `.gitignore` 里那条 `!target/` 取反**同样不能**把它们放回来；② **用户规则探针**（`.gitignore` 声明的 `.local/` 与 `info/exclude` 声明的目录）**行在树里、可展开、可打开读到内容**；③ 打开段内界面可响应（AX 可读 + 指示在场）与读数落盘。

## Non-goals

- **不做用户可配置的忽略名单**（C 案，Alex 未提）。内置规则仍是产品硬编码；`[vault] ignore = [...]` 这类配置面留作独立候选。
- **不允许用户规则推翻内置规则**：`.gitignore` 里的 `!target/` 之类取反不把内置规则命中的条目放回可见集（论证见 design §2.6）；想要这个能力的正路是产品侧做一个显式的「显示被忽略项」开关（非目标，留候选）或改内置名单走 change。
- **不把内置规则改成「可见」**：`node_modules` / `target` / `.git` 这些行不出现在树里（理由见 design §2.1——那类名字在每层目录里出现会退化成噪音；真要读构建产物是另一个需求，另立 change 做一个显式开关）。
- **不做规则热生效**（`.gitignore` 改动本会话不重编，下次装载生效；理由见 design §4.5）。也不给前端补「全量重扫」通道。
- **不让「按需展开」把条目补进索引**（确定性优先，design §4.6）；**不改 `wikilink_create`**（它对惰性目标的重复文件风险记为已知边界与后续候选）。
- **不新增任何用户可见文案 / 加载指示 /「被忽略的条目」视图**：惰性行的可见性就是全部；展开那一拍不渲染成「空目录」，但不加文案。若实现期确需新增文案，按 deck 末位取号（见「编号声明」）。
- **不做 scan 并行化**（rayon / jwalk）、**不做增量建图**（mtime/size 缓存）、**不做 payload 流式化或分页**（M289 已把收益排序排完）。
- **不改 `IGNORED_NAMES` 之外的既有拒绝面**：vault 内路径约束、附件大小上限、保存链路与 CAS、watch 的 debounce 与回声判据一律不动。
- **不改性能合同数字**（ADR 0002 §6），**不新增 perf 门禁端点**（`scripts/perf/` 无 vault 打开端点的缺口留 `docs/backlog.md`，与 M283 的裁决点 4 同处）。

## Impact

- **影响的 specs**：
  - `fs-io`：2 条 MODIFIED（「全类型递归枚举」——两类忽略 + 16 名名单 + 惰性标记 + 规则来源；「watch 增量事件流」——逐组件判定 + 物化登记）、1 条 ADDED（「按需枚举目录」）
  - `file-tree`：2 条 MODIFIED（「全类型文件树展示」——可见集含惰性行、数据来源补按需命令；「watch 驱动的增量刷新」——惰性目录的按需获取与合并）
  - `vault-workspace`：3 条 MODIFIED（「vault 打开」——打开段在主线程之外；「装载的即时反馈」——已知边界改写；「装载后恢复标签列表」——「在不在 vault 内」的判据补存在探测）
- **影响的代码/系统**：
  - `src-tauri/Cargo.toml`：新增依赖 `ignore`（唯一新增依赖）
  - `src-tauri/src/fs_io.rs`：`IGNORED_NAMES` **退役**为内置规则表（16 条名字字面量 + `.*.lumir-*`，编进匹配器）、新的 `IgnorePolicy`（一份规则表 + 物化集合，来源决定去向）、`scan_workspace`（`lazy` 行、不递归）、`rel_string`（逐组件判定）、新 `fs_scan_dir`、`expand_new_dir_subtrees` / `validate_new_name` 沿用同一策略、忽略计数诊断（新 `LogEventName::VaultScanIgnored`）、一条「内置匹配器 ≡ 今日名字等值判定」的对拍测试
  - `src-tauri/src/commands.rs`：`prepare_vault_open`（编译规则、构造策略、scan/graph 打点）、`vault_open_path` 与 `fs_scan_dir` 的 `#[command(async)]`、`VaultState` 持有策略、会话恢复的存在探测入口
  - `src/bindings/**`：`FsEntry` 新增 `lazy`（ts-rs 重导出，进索引后跑门禁）
  - `src/tree.ts` / `src/main.ts` / `src/vault-switcher.ts`：惰性目录按需展开与合并、附件索引口径注释、恢复判据补探测
  - `scripts/acceptance/lib/app.mjs` + `scenarios/67-*.md`：探针与场景
  - `docs/backlog.md`：待归档跟踪；M289 读数落 canon；`wikilink_create` 重复文件风险与「规则热生效」两条后续候选
- **关联约束**：
  - ADR 0001（全文件类型一等公民）：两类拆分把张力收窄到「工具链固定输出名」（design §3.4）；
  - ADR 0002 §3（webview 不直接触文件系统）/ §6（性能合同，本 change 不改数字）/ §7（fs_io 不依赖 tauri 类型——策略对象因此用纯 std 类型下传）/ §5（配置即数据——C 案若日后采纳涉及配置键）；
  - ADR 0004 节点 1 / 节点 2；`REVIEW.md` 第 8 条（策略只能有一份真源）；`AGENTS.md` 的「影响面升级线」（design §11）。

## 裁决点

| # | 裁决点 | 推荐 | 备选 | Alex 裁决（2026-09-28） |
|---|---|---|---|---|
| 1 | 内置规则的档位 | A1 + A2 收；A3 由 Alex 取舍 | 全收 / 只收 A1 | **A3 不收**；A1 + A2 收 ⇒ 内置规则 16 条名字 + 1 条模式 |
| 2 | 是否引入 `.gitignore` / `.git/info/exclude` 语义 | 另立 change（本 proposal 原推荐） | 纳入本 change | **纳入本 change**，并加硬性约束：被挡住的目录与文件在左栏文件树里 MUST 仍然可见 ⇒ 本 proposal 据此把忽略改成「一份表、两个来源」 |
| 3 | `vault_open_path` 标 `#[command(async)]` | 纳入本 change | 推迟 | **纳入本 change** |
| 4 | 规则生效时点 | vault 装载时编译一次，`.gitignore` 改动下次装载生效 | 会话内热生效（要新开重编 + 重扫 + 前端替换模型通道） | **取推荐**（2026-09-28 经 tower 转达确认；实现期若要改口径，先改本行与 design §4.5） |
| 6 | 机制合并后两条边界的口径 | ① 内置规则不可被用户规则取反推翻；② 内置规则用无尾斜杠名字字面量（「同名文件也隐藏」不改判） | ① 允许取反（等于把性能护栏交给用户配置）；② 改用 `target/`（只隐藏目录，属有意改判） | **取推荐两条**（Alex 同日第二轮指令要求「论证后定，写明理由」，论证在 design §2.3 / §2.6） |
| 5 | B 案的影响面是否接受 | 接受完整影响面（含新依赖、`FsEntry` 加字段、树模型变更、惰性区域解析降级） | 回收为「只保留内置规则 + async 化」，B 案另立 change | **接受完整影响面**（Alex 知情接受，清单见 design §11） |

## 编号声明

- **真机场景取 67**（试占）。依据（2026-09-28 动工前核对）：`scripts/acceptance/scenarios/` 现有编号最大 **65**（`65-external-reload-reading-position.md`）；**66 已被在飞的 M288 占用**（`feat/fix-code-block-selection-visibility-m288` 的 `scripts/acceptance/scenarios/66-code-block-selection.md`，尚未合并到 master）。**对冲条款**：实现期动工前 SHALL 再核一次目录与各在飞 change 的编号声明，被占则取当时的下一个可用号。
- **文案 deck：本 change 预期零新增用户可见文案**。内置规则是静默的（不新增句子）；惰性行沿用树行既有形态（不新增文案，也不加加载指示）；被隐藏名字的新建/改名拒绝沿用既有 `fs_name_invalid` 文案模板。若实现期确需新增（例如按需展开的等待文案），按 deck「只追加、不复用」的规则取**当时末位的下一个可用编号**（2026-09-28 核对末位是 **D321**），动工前再核一次，不盲取。
