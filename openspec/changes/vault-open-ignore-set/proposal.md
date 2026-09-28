# Proposal: 收窄 vault 打开段的可见集（忽略集扩集 + 打开段移出主线程）

- Change ID: vault-open-ignore-set
- 日期: 2026-09-28
- 角色: Alex Lee（评审/裁决），AI agent（起草）

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

同一段（收窄后残余形状 1,658 文件 / 2,395 条目 / 3.3MB）：**scan 14.0ms + graph 51.7ms = 65.8ms**。

### 二、可见集的 170,317 个文件里，真内容只有 1,658

忽略集目前**只有 3 个硬编码名字**（`IGNORED_NAMES`，[src-tauri/src/fs_io.rs:28](../../../src-tauri/src/fs_io.rs#L28)）：`.git` / `.DS_Store` / `node_modules`。按名剪枝（任意深度、不靠 `.gitignore`）已剪掉 147,440 个文件（含 12 个 tower worktree 里嵌套的 133,440 个 `node_modules`），**`.git` 不是嫌疑**。

Alex 的 vault 是 lumir 仓库本身，其可见集构成（M289 只读盘点）：

| 构成 | 可见文件数 |
|---|---|
| 12 个 worktree 的 `src-tauri/target` | 110,501 |
| 根 `src-tauri/target` | 19,154 |
| `test-results/` | 9,660 |
| `.tower/comms/` + worktree 仓库内容 | ~17,000 |
| **真内容** | **1,658** |

即：**可见集里 99% 的文件（170,317 中的 168,659）与阅读无关**，而忽略集只覆盖了 VCS/包管理内部目录，没覆盖构建产物目录族——打开段的成本与条目数近似正比，钱全花在这里。

### 三、payload 与前端解析不是瓶颈，单挪主线程也不够

真可见形状的 payload ≈27MB，同一份 payload 在 V8 里 `JSON.parse` 只要 71–73ms（46MB 档实测）。所以「流式化 entries / 懒加载」在收窄可见集之前不值得做；而只把 command 挪出主线程（3.1s 照旧要跑）也不解决「慢」，只解决「整窗冻结」。

### 四、为什么必须走 change proposal

忽略集「本 change 内不可配置」是一条 SHALL 条款（[openspec/specs/fs-io/spec.md:11](../../../openspec/specs/fs-io/spec.md#L11)），任何放宽都得先过提案。本 change 就是这份提案。

### 五、另一条不互斥的杠杆（本 change 范围外，列给裁决参考）

M289 已向 tower 报了一条 finding：`.tower/`（275,180 文件 / 35G）就在 vault 里，12 个 worktree 各自带一份 `src-tauri/target`。**把 worktree 移出 vault 或让它们共享一个 vault 外的 `CARGO_TARGET_DIR`**，Alex 的可见集会直接从 170k 掉到 ~29k（root target + test-results 仍在）——这是「一个用户的现场」的根治。本 change 的产品侧修法对**任何**仓库形状的 vault 有效（用户在 Lumir 里打开任何代码仓库都会撞上同一件事），两者互补。

## What Changes

1. **忽略集扩集**（spec delta：`fs-io`「全类型递归枚举」MODIFIED）。名单从 3 个名扩到 19 个名，新增的是**构建产物目录族**（`target` / `dist` / `build` / `out` / `vendor` / `.venv` / `venv` / `__pycache__` / `.next` / `.nuxt` / `.cache` / `.pnpm-store` / `.tox` / `.gradle` / `test-results` / `perf-results`）。规则不变：**名字精确匹配、任意深度、与条目类型无关**；枚举 / watch / 目录改名的子树展开 / 新建改名的名字校验四处**共用同一份名单**（一个真源）。该集合**本 change 内仍不可配置**——「读 VCS 配置」与「用户自定义名单」是两个独立裁决（见裁决点 1），本 change MUST NOT 顺手实现。
2. **打开段移出 IPC 主线程**（spec delta：`vault-workspace`「vault 打开」MODIFIED）。`vault_open_path` 标 `#[command(async)]`（单行；tauri 宏对「同步函数 + async 上下文」的处理是 `sync_threadpool`，body 进 async 运行时线程池），与既有 `vault_open` 的线程语义拉平。顺带把**响应序列化**也移出主线程（tauri 2.11.5 的 async 路径在 tokio 任务里做 `IpcResponse::body()` 的 `serde_json::to_string`；同步路径的这一步在主线程上）。理由：忽略集永远追不上用户 vault（20 万条目的笔记库是合法存在），而这一条把最坏情况从「整窗死帧」变成「界面活着、指示在动」。
3. **改写「装载的即时反馈」的已知边界**（spec delta：`vault-workspace` MODIFIED）。现条文写着「打开段由同步 command 承担 ⇒ 该段期间 webview 不能重绘、指示只能静止显示、用户看到的是 beachball」（[vault-workspace/spec.md:502](../../../openspec/specs/vault-workspace/spec.md#L502) 起）。第 2 条改完这句话就过期了，必须随之改写：打开段不再整段冻结，**剩余边界**是打开段结束后的前端装配（payload 解析 + 树/索引装配）仍在 webview 主线程上。
4. **打开段的两条分段读数**（无 spec 变更，走既有 `slow_callback` 事件族）。Rust 侧补 `vault_open_scan` 与 `vault_open_graph` 两条（无条件记录，同 `vault_open_watch` 的口径与理由），配合前端既有的 `vault_load_open` 做减法，即可把打开段切成 scan / graph / 序列化+传输+解析 三段——这是闭合「真机 5,501ms vs 合成 3,110ms 的 2.4s 缺口」的唯一手段（真机同一条路径的日志读数跨度 48×，265ms–12,695ms，冷缓存与机器负载是首要嫌疑）。
5. **真机验收场景 67**：仓库形状的大 vault（含 `target`/`dist`/`test-results` 探针 + 可见的真笔记）——断言构建产物目录不进树、真内容在树里；并用测量放大器把打开段撑到可采样长度，正向断言**打开段内界面可响应（指示与界面节点可读）**；末步断言两条新读数落盘。草案见本 change 的 [acceptance-scenario.md](acceptance-scenario.md)。

## Non-goals

- **不引入 `.gitignore` / `.git/info/exclude` 语义**（裁决点 1 的 B 案），**也不加用户可配置的忽略名单**（C 案）。两案各有真实成本（design §4：watch 侧要在事件路径上复现同一套判定，含 `.gitignore` 自身变更后的规则刷新；四个使用点从模块常量变成注入状态），MUST NOT 在本 change 顺手做。
- **不把 `.tower` 塞进硬编码名单**（裁决点 2；推荐把它留给 tower 侧的布局 finding，或等 C 案）。
- **不新增任何用户可见的提示 / 「被忽略的条目」视图 / 展开入口**。扩集是静默的（与 `.git` / `node_modules` 今天的形态一致）；若误伤真实显现，另立 change 给出口，本 change 只保证诊断日志里能读到忽略计数（见 design §3.3）。
- **不做 scan 并行化**（rayon / jwalk）、**不做增量建图**（mtime/size 缓存）、**不做 entries 流式化或分页**。M289 已把收益排序排完：前两者在收窄可见集之后再谈（且各带新依赖或新状态），第三者已被实测否定（payload 解析 71ms）。
- **不改 `IGNORED_NAMES` 之外的任何拒绝面**：vault 内路径约束、附件大小上限、保存链路与 CAS、watch 的 debounce 与回声判据一律不动。
- **不改性能合同数字**（ADR 0002 §6 四条），**不新增 perf 门禁端点**（`scripts/perf/` 无 vault 打开端点的缺口留 `docs/backlog.md`，与 M283 的裁决点 4 同处）。
- **不动前端装配段**（payload 解析 + 树/索引装配）：本 change 只把后端侧移出主线程，装配段仍占 webview 主线程，如实记为已知边界。

## Impact

- **影响的 specs**：
  - `fs-io`：1 条 MODIFIED（「全类型递归枚举」——忽略集名单 + 匹配规则 + 四处共用一个真源）
  - `vault-workspace`：2 条 MODIFIED（「vault 打开」——打开段在主线程之外；「装载的即时反馈」——已知边界改写）
- **影响的代码/系统**：
  - `src-tauri/src/fs_io.rs`：`IGNORED_NAMES` 名单与 `is_ignored` 的文档；四处使用点（枚举 `read_dir` 循环、`rel_string`、`expand_new_dir_subtrees`、`validate_new_name`）沿用同一真源，MUST NOT 另抄一份
  - `src-tauri/src/commands.rs`：`vault_open_path` 的 `#[command(async)]`；`prepare_vault_open` 里 scan / graph 两处打点
  - `scripts/acceptance/lib/app.mjs`：`seed.bulkVault` 的忽略探针形态（加一个「构建产物目录族」参数，与既有 `node_modules` 探针并存）
  - `scripts/acceptance/scenarios/67-*.md`：新场景
  - `docs/backlog.md`：本 change 的待归档跟踪；M289 survey 读数的 canonical 落点（现在只存在于 `.tower/comms/` 的一条 inbox 消息里，`.tower/**` 不入 git）
- **关联约束**：
  - ADR 0001（全文件类型一等公民）：扩集与它**有张力**——被忽略的不再只是「VCS/包管理内部目录」，而是「按名字猜出来不是内容的目录」。取舍与代价逐条写进 design §3，这是本 change 最需要 Alex 看的一节。
  - ADR 0002 §3（webview 不直接触文件系统）/ §6（性能合同，本 change 不改数字）/ §5（配置即数据——B/C 两案若采纳涉及新的配置键）
  - ADR 0004 节点 1 / 节点 2
  - `REVIEW.md` 第 8 条（同一语义两处真源）：名单必须留在 `fs_io.rs` 一处

## 裁决点

| # | 裁决点 | 推荐 | 备选 | 不裁决的后果 |
|---|---|---|---|---|
| 1 | 忽略集的**范围与来源** | **A：名单扩集**（本 proposal 的形态），三档分明：A1 生态专名（`.venv` / `venv` / `__pycache__` / `.next` / `.nuxt` / `.cache` / `.pnpm-store` / `.tox` / `.gradle` / `test-results` / `perf-results`，几乎零误伤）+ A2 工具链常用词（**`target`** / `dist`，收益最大、误伤低）+ A3 通用英文词（`build` / `out` / `vendor`，误伤中）。**推荐 A1+A2 无条件纳入，A3 由 Alex 取舍** | **B：A + 读 `.git/info/exclude`（+ 可选 `.gitignore`）**——能把 Alex 的 vault 压到 1,658 文件 / 66ms（`.tower` 只有 `info/exclude` 挡得住）；代价是「用户可编辑的 VCS 配置会隐藏他想看的笔记」+ watch 侧要复现同一套判定。**C：A + 用户可配置忽略名单**（`[vault] ignore = [...]`）——躲开 VCS 耦合与 `ignore` crate，但要新增配置键与回写通道 | 非 git 仓库形状的大 vault（CI 产物、`_build`、`.svelte-kit` 等未列名）仍慢；但界面不再冻结（第 3 条兜住体验） |
| 2 | `.tower/` 是否进硬编码名单 | **不进**。它是本仓库的开发工作区约定，不是通用产品约定；把每个私有约定都塞进产品名单会让名单无界。它在 Alex 的 vault 里占 ~17k 可见文件（`target` 被剪掉之后的最大一块），但根治在 tower 侧布局（M289 finding）或裁决点 1 的 B/C 案 | 进名单（立刻把 Alex 的可见集再砍一半，代价是产品里多一个与他私有工具绑定的名字） | 维持现状：Alex 的 vault 收窄后仍剩 ~31k 可见文件（≈0.6s 打开段），比他今天的 3.1–12.7s 好一个量级，但不是 66ms |
| 3 | 打开段移出主线程（`#[command(async)]`）是否纳入**本 change** | **纳入**。单行改动（tauri 宏对同步函数 + async 上下文生成 `sync_threadpool`，不必把函数重写成 `async fn`），且仓内已有先例（`vault_open` 本来就在主线程之外跑同一段工作）。忽略集永远追不上用户 vault，这一条是大 vault 的保险 | 推迟为独立 change（M268 的裁决点 3 曾按「watch 0.4–1.6ms、open 92–107ms」判暂缓——那条读数取自 2,142 文件的 vault，本次 20 万条目档已把它推翻） | 收窄之后 66ms 档确实不需要它；但任何收不窄的 vault（用户库 20 万条目）继续整窗死帧 + beachball |

## 编号声明

- **真机场景取 67**（试占）。依据（2026-09-28 动工前核对）：`scripts/acceptance/scenarios/` 现有编号最大 **65**（`65-external-reload-reading-position.md`）；**66 已被在飞的 M288 占用**（`feat/fix-code-block-selection-visibility-m288` 的 `scripts/acceptance/scenarios/66-code-block-selection.md`，尚未合并到 master）。**对冲条款**：实现期动工前 SHALL 再核一次目录与各在飞 change 的编号声明，被占则取当时的下一个可用号。
- **文案 deck：本 change 预期零新增用户可见文案**。扩集是静默的（不新增句子）；被忽略名字的新建/改名拒绝沿用既有 `fs_name_invalid` 的文案模板（前端按 `code` 渲染，见 deck D19x 段）。若实现期确需新增（例如误伤提示），按 deck「只追加、不复用」的规则取**当时末位的下一个可用编号**（2026-09-28 核对末位是 **D321**），动工前再核一次，不盲取。
