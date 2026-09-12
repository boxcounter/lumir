# Proposal: 保存链路加固——自动保存、崩溃备份与 main.ts 拆分

- Change ID: save-hardening
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M124 建立了保存冲突恢复与外部修改重载（`openspec/changes/archive/2026-09-12-save-and-watch-recovery`），但保存链路仍有三处结构性缺口，且缺口都在 dogfood 核心场景（Lumir ↔ Obsidian 来回编辑）的必经路径上：

1. **没有自动保存**。每次落盘都要作者想起 Cmd+S。更糟的是：一旦 Cmd+S 撞上 CAS 冲突而未处置，`dirtyGuard` 与退出守卫会把内存修改锁死——用户能选的动作只有两个恢复按钮。
2. **崩溃窗口内无内容保全**。自动保存暂停期间（冲突未处置 / 外部修改待决 / 保存目标已被外部删除）恰好是内存修改最危险的时候，而进程崩溃 / 强杀后这些内容没有任何落盘副本。
3. **保存链路全部堆在 `main.ts`**（683 行）：vault 装配、wikilink、watch 分流、保存/冲突/恢复状态机混在一个文件里，任何一处改动都要在整篇里找边界。M124 引入的状态（展示路径 / revision / 在途标记 / 冲突提示）没有单一持有者。

另有两条 M121 / M124 reviewer 记录的既有分歧：`last_vault` 写失败会让已成功的打开整体报错；强制覆盖保存再次冲突时只剩自动消隐的纯文案 toast。

## What Changes

1. **自动保存（停止输入 debounce）**：编辑器 dirty 时，停止输入 2s（初始值，可随实测调整）后自动保存当前文档；成功语义与手动保存完全一致——dirty 清除、masthead 标记与后端退出守卫镜像一并复位，退出守卫随之放行。
2. **自动保存的暂停边界**：存在未解决冲突（`document_conflict` 未处置）、外部修改待决（watch 命中且本地 dirty）、保存目标已被外部删除时，自动保存 MUST 暂停，**不得重试 CAS**；暂停态由成功的保存或重新载入清除。这是产品约束而非实现细节：硬冲 CAS 在 Obsidian 侧有新内容时必然重复失败并把提示砸向用户。
3. **崩溃备份**：dirty 内容持久化到应用恢复目录（`<config_dir>/recovery/`，按 vault + vault 相对路径定位，后端 `recovery.rs`）；保存成功即清除。启动装载 vault 后枚举残留备份，逐个给出恢复提示——「恢复内容」把备份放进编辑器缓冲并保持未保存（仍走 CAS，不静默覆盖磁盘），「丢弃备份」清理。
4. **强制覆盖再冲突的提示升级**：覆盖前拉取 revision 与写入之间又有外部修改时，提示带「重新载入（放弃我的修改）」「强制覆盖保存」两个动作且 sticky，不再退化为自动消隐的纯文案。
5. **`last_vault` 写失败降级为 warning**：vault 已打开成功是主结果，记忆写回失败只打 warning，不再让整条 `vault_open` / `vault_open_path` 返回错误（前端因此不装载已打开的 vault）。
6. **main.ts 拆分**：保存 / 冲突恢复 / 外部修改处置 / 自动保存 / 崩溃备份抽到 `src/save-controller.ts`（+ recovery IPC 封装 `src/save-ipc.ts`），模块持有全部保存相关状态与决策；`main.ts` 收敛为装配层。行为零变化由既有 142 个视觉场景背书。

## Non-goals

- 不做多版本历史 / 自动保存快照列表：恢复目录只保留每个 (vault, path) 的最新一份 dirty 内容。
- 不做自动保存的间隔可配置：v1 固定 debounce 初始值，配置化留待有实测依据时再提。
- 不改 revision 的 sha256 内容寻址口径与 `document_save` 的原子写入语义（ADR 0003 §3 铁律、M124 spec 现状）。
- 不引入三方合并 / diff 视图：冲突处置仍是「放弃本地 / 覆盖磁盘」二选一。
- 不做「保留我的版本」之后的自动重保存或后台对账：该分支下自动保存保持暂停，直到用户主动保存或重载。
- 不把恢复目录纳入 vault 文件树或 watch：备份不在 vault 内（不进枚举、不进事件流）。

## Impact

- 影响的 specs：`fs-io`——ADDED「自动保存与暂停边界」、ADDED「崩溃备份与恢复入口」；MODIFIED「文档保存与冲突恢复」（强制覆盖再冲突的提示形态、另存副本名序号范围）。
- 影响的代码/系统：`src-tauri/src/recovery.rs`（新模块：备份读写与定位）、`src-tauri/src/commands.rs` 与 `lib.rs`（`recovery_*` 四个 command 注册、`last_vault` 写失败降级）、`src/save-controller.ts` 与 `src/save-ipc.ts`（新：保存链路与恢复 IPC 封装）、`src/main.ts`（收敛为装配层）、`tests/visual/scenes/save-hardening-*.spec.ts`（新增场景）、`文案-Copy.md`（D55–D62）。
- 关联约束：ADR 0002 §5「配置即数据」（`last_vault` 写失败按 warning 处理，与「非法值人话 warning」同向）；ADR 0002 §6 性能合同（备份只在 debounce 到期且内容仍未落盘时发生，不逐键写盘；恢复目录不进 vault 扫描）；ADR 0003 §3 铁律（备份内容原样落盘，不改写 vault 内源文件；恢复经保存链路，不静默覆盖）。
- 评审节点记录：本批工作范围（自动保存 / 崩溃备份 / 对话框升级 / 拆分）随 mission M127 于 2026-09-12 经 Alex 批准（原话：「"可立项的工程项"和"纯卫生"可以推进了」）。
