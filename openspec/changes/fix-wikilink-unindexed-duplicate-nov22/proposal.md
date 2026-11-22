# Proposal: 一键创建不再在索引外造成重复笔记（有界同名探测 + 安全拒绝）

- Change ID: `fix-wikilink-unindexed-duplicate-nov22`
- 日期: 2026-11-22
- 角色: Alex Lee（授权 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：**已授权，无需新增产品裁决**（2026-11-22）。本 change 是 Alex 已确认的
> 防重复修复：发现索引外同名目标、或无法在有界扫描内证明「不存在」，一律安全拒绝；不自动打开、
> 不重绑、不选择某个同名候选；成功创建后的既有「创建并打开」行为不变。授权经本次 mission 下达，
> 无逐字原话记录；只读方案（含机器测试矩阵与剩余边界）一并作为节点 1 材料。
> 节点 2（归档评审）：实现完成后填写。

## Why

### 现象与缺陷

`wikilink_create` 的语义是「对解析为 `unresolved` 的链接按确定性路径建一个空文件」。但链接
解析只看**索引**，而索引按可见性规则建：`lazy` 档目录（`node_modules` / `target` / `dist`…）
与用户规则命中的目录（`.gitignore` 声明的目录）里的文件**不进索引**。于是：

- vault 里真实存在 `target/Note.md`（作者手写的笔记，只是目录被声明为惰性）；
- 索引里没有它 ⇒ `[[Note]]` 解析为 `unresolved`；
- 用户在 `Alpha.md` 里点「创建并打开」⇒ 在 `Alpha.md` 同目录新建 `Note.md`；
- 结果：**同一个名字出现两份笔记，链接从此指向新文件**，既有那份变成隐形的重复。

这不是理论路径：`fs-io` 的 living spec 把「`wikilink_create` 对惰性区域可能造出重复文件」
写成了已知边界，等于承认缺陷在产品里；用户规则（`.gitignore`）只是把触发面从构建产物族
扩到任何「声明不跟踪」的目录。

### 为什么现在收

- 这条是**数据完整性**缺陷：重复笔记一旦产生，用户不会收到任何提示，两份内容各自演化；
  越晚收，已经产生的重复越多。
- 修法不需要产品取舍：发现候选就拒绝，是最保守、也不新增交互的方向（见「非目标」）。
- 同族的「有界扫描」语义在仓内已有先例（`scan_vault_files`、`apply_fs_changes` 的代际对账），
  本次只是把二者拼成一条安全判据，不引入新机制。

## What Changes

1. **`wikilink_create` 改为两阶段异步（`wikilink-resolution` MODIFIED）**
   第一段短持锁取 vault 根 / 规则表 / 打开世代，并跑既有的 `create_target`（词法、路径、
   unsupported、「当前索引已可解析」的校验一处不复制）；随后释放锁，在
   `spawn_blocking` 里做有界扫描；扫描结束后重新短持锁核对根 + 世代，一致才走原有
   `create_note`（索引重查与 `O_EXCL` 创建不变）。扫描期间 MUST NOT 持锁——同步的
   `link_graph_resolve` 也在这把锁上，持锁扫描会把等待转嫁给 IPC 主线程。

2. **新增专用、有界、无副作用的索引外同名探测（`fs-io` MODIFIED 的已知边界段）**
   从 vault 根遍历全部非 `hidden` 档目录：**配置 `lazy` 与用户规则惰性目录都递归**（否则
   修不到本缺陷）；`hidden` 档整棵剪掉（口径仍以 `IgnorePolicy::hidden_hit` 为唯一判据）；
   不跟随符号链接目录、不读链接目标；不读文档正文、不读新 `.gitignore`、不登记物化状态、
   不写任何索引。预算初值 **20,000 个目录项 / 250ms**（条目与时长都计数，待实测校准）；
   任一目录 / 条目读取失败、或超限，都按「无法证明不存在」拒绝。

3. **匹配语义复用 resolver，不写第二套**
   扫描结果建一个临时 `LinkGraph`，对 `from` / `link` 调同一个 `resolve_link`：
   `resolved` 与 `ambiguous` 都算冲突（多个候选不选择、不打开）；完整扫描且零候选才放行。
   临时图用完即弃，MUST NOT 合并进常驻索引。

4. **错误码与前端零改动**
   命中候选 → `wikilink_target_exists`（D192）；超限 / 读不到 / 任务异常 / vault 代际变化 →
   `wikilink_create_failed`（D194）。`src/link-follow.ts` 的失败路径已统一清缓存 + toast、
   不打开文件，本次不新增错误码、文案或前端分支。

5. **验收与判据**
   Rust 单测覆盖：配置 / 用户规则惰性目录、多候选、大小写 / alias / heading、路径后缀、
   真正不存在仍创建、极小预算、目录读取失败、hidden、符号链接（目录不跟随 / 文件构成冲突）、
   探测期间 vault 代际变化、索引过期与不覆盖回归。新增合成真机验收场景（惰性 fixture 下点
   「创建并打开」→ D192 toast、仍在原文档、零新文件），随实现同 PR 进入套件与 COVERAGE。

## Non-goals

- **不展示候选列表、不自动打开 / 重绑、不提供「仍然创建」的逃生口**：出现同名就是作者需要
  自己判断的现场，产品只负责不制造重复。
- **不把惰性候选带进常驻索引**：索引仍按可见性规则建（同一 vault 两次打开的解析结果一致是
  既有不变量）。因此拒绝之后重解析仍是 `unresolved`——这是有意保留的边界。
- **不扫描 `hidden` 档、不新增用户配置项**：预算与剪枝口径是代码内的实现常量，不暴露给配置。
- **不声称彻底消除跨进程竞态**：外部进程在「探测结束 → 创建」之间往别的目录放同名文件，
  本命令防不住；它只保证自身不再制造重复。
- **不改 `create_note` / `create_file` / 底层 `O_EXCL` 原语**，也不改 `link-follow.ts` 的
  成功路径（创建并打开）。

## Impact

- 影响的 specs：`wikilink-resolution`（MODIFIED「未创建目标一键创建」）、`fs-io`（MODIFIED
  「全类型递归枚举」的已知边界段，删掉「可能造出重复文件」的旧话）。活跃期不改 living specs。
- 影响的代码：`src-tauri/src/commands.rs`（命令两阶段 + 探测装配 + 代际对账）、
  `src-tauri/src/fs_io.rs`（专用有界扫描与预算类型）。`src-tauri/src/link_graph.rs` 不变
  （`create_target` / `create_note` / `O_EXCL` 原语照旧）。
- 影响的测试 / 制品：`src-tauri/src/commands.rs` 与 `src-tauri/src/fs_io.rs` 的单测；
  `scripts/acceptance/scenarios/` 新增场景与 `COVERAGE.md` 重生成。
- 关联约束：性能合同（扫描在 blocking 线程、预算有界，不占 IPC 主线程；常量是待实测初值，
  不宣称硬实时）；ADR 0003 §3（不覆盖、不改写既有文件）；ADR 0002 §3（语义只在 Rust core）。

## 裁决点

- **D1 发现索引外候选时的行为**：**拒绝**（Alex 已授权的安全方向）。不自动打开、不重绑、
  不选择候选；错误码复用 `wikilink_target_exists`。
- **D2 探测不完整时的行为**：**拒绝**（fail-closed）。超限、读不到、任务异常、vault 代际
  变化都按「无法证明不存在」处理，复用 `wikilink_create_failed`。
- **D3 扫描口径**：递归全部非 `hidden` 目录（含配置 `lazy` 与用户规则惰性目录）；预算
  20,000 项 / 250ms 是实现初值，实测后由实现方按读数调整，不需要产品裁决。
- **D4 预算数值**：待实测（小 vault / 约两万项 / 深惰性子树 / 符号链接环四档读数），
  本 change 不宣称硬实时上限。
