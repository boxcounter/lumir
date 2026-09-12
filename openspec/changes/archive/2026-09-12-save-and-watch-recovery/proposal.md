# Proposal: 保存冲突恢复与外部修改重载

- Change ID: save-and-watch-recovery
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

dogfood 核心场景是「在 Lumir 和 Obsidian 之间来回」：同一份 Markdown 在两个编辑器间交替保存，保存冲突（`document_conflict`）与外部修改是高频路径而非边缘异常。现状的三处缺口都把用户修改推向死路：

1. `document_conflict` 只有纯文案提示。CAS（compare-and-swap）语义下重试必败——revision 已变；dirty 期间切换文件被 dirtyGuard 拦截、退出被后端守卫拦截，用户修改被锁死在内存，没有逃生口。
2. 文件被外部删除后保存得到 `fs_not_found`，同样只有文案，内存中的最后副本无路可去。
3. watch 事件流不比对打开中文件：Obsidian 侧的修改不会反映到 Lumir，编辑器在不知情中继续展示旧内容。

另有一处积垢：保存的原子写入临时文件（`.{name}.lumir-{pid}`）在进程崩溃后残留 ghost，既进文件树也进 watch 事件流。

## What Changes

1. **冲突提示升级为恢复入口**：`document_conflict` 提示提供两个动作——「重新载入（放弃我的修改）」回退到磁盘当前内容；「强制覆盖保存」在覆盖前拉取磁盘当前 revision 刷新 CAS 基准后经二次确认写入，确认文案必须明示「将覆盖磁盘上较新的内容」。提示为 sticky，处置前不自动消隐。
2. **`fs_not_found` 给出另存出口**：保存目标被外部删除/移动时，提示说明内存修改未丢失，提供「另存为新文件」动作——经 `wikilink_create`（后端 `create_note`，O_EXCL 语义不覆盖既有文件）在同目录创建「原名-恢复.md」，写入内存内容并切换过去；撞名自动加序号重试。
3. **watch 命中打开中文件的外部修改处置**：未 dirty 时自动重载磁盘内容并提示；dirty 时弹 sticky 提示（非 modal，不打断打字）让用户在「重载（放弃我的修改）」与「保留我的版本」间选择；外部删除则提示内容仍保留。自身保存产生的 watch 事件经 revision 比对丢弃，不触发重载。
4. **ghost 临时文件治理**：枚举与 watch 共用的忽略集扩展模式规则——`.` 开头且含 `.lumir-` 的名字（如 `.note.md.lumir-123`）被忽略，ghost 从文件树与事件流消失；`document_save` 的 `create_new` 撞上同名陈旧 ghost 时删除后重试一次。

## Non-goals

- 不引入三方合并/冲突标记语法（如 Git 冲突标记或 diff 视图）：v1 只做「放弃本地 / 覆盖磁盘」二选一。
- 不改 revision 的 sha256 内容寻址口径，不引入 mtime 替代方案。
- 不改动 `ipc.ts`（不在本 change scope）：强制覆盖前的 revision 拉取经既有 `fsReadSnapshot` 封装（与 `fs_file_revision` 同 sha256 原文口径）。
- 不处理非 Markdown 打开文件的自动重载（code/text/binary 模式维持现状）；Obsidian 侧删除目录等级联场景由既有 deleted 增量逐文件到达。
- 不做「保留我的版本」之后的自动重保存或后台对账。

## Impact

- 影响的 specs：`fs-io`——ADDED「文档保存与冲突恢复」（含原子写入与 revision CAS 现状语义）；MODIFY「watch 增量事件流」（忽略集覆盖保存临时文件、打开中文件外部修改的重载行为）。
- 影响的代码：`src/main.ts`（保存 catch 分流、恢复提示、watch 打开中文件处置）、`src-tauri/src/fs_io.rs`（忽略集模式、`save_markdown` ghost 重试）、`src/shell.ts` 与 `src/style.css`（顺带清除 panel 空壳与 Cmd+\ 死接线——Thread 删除后已无消费者）、`tests/visual/scenes/`（stub 外部写入/删除钩子、一次性 failures 注入、`save-recovery.spec.ts`）、`文案-Copy.md`（新增条目、panel 条目停用）。
- 关联约束：ADR 0002 §6 性能合同不变（忽略集模式只增一条前缀匹配，无扫描成本变化）；原子写入与 CAS 语义是保存合同的既有现状，本 change 将其写入 spec 并补恢复面。

## 评审节点记录

- 节点 1（提案评审）：方案要点（冲突提示两动作、fs_not_found 另存、watch 重载/二选一、ghost 治理）随本批 mission 于 2026-09-12 前经 Alex 批准（原话：「我没有异议」），视为节点 1 通过。
