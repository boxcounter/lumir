## ADDED Requirements

### Requirement: 自动保存与暂停边界

编辑器内容 dirty 时，webview SHALL 在停止输入 debounce 窗口（初始值 2000ms，可随实测调整）到期后自动保存当前文档；每次文档内容变化 SHALL 重置该窗口，连续输入期间 MUST NOT 落盘。自动保存成功后 dirty 的清除语义 SHALL 与手动保存完全一致（清除内存标记、撤下 dirty 守卫提示、向后端 `document_set_dirty` 镜像 false），退出守卫随之放行。

自动保存 MUST 在以下任一状态暂停，MUST NOT 以陈旧 `expected_revision` 重试 CAS 写入：存在未解决的 `document_conflict`（冲突提示已出现且未处置）；watch 命中打开中文件的外部修改且编辑器 dirty（用户尚未在提示上选择）；保存目标已被外部删除或移动。暂停态 SHALL 由成功的保存或重新载入清除。

#### Scenario: 停止输入后自动保存

- **WHEN** 用户编辑 Markdown 后停止输入超过 debounce 窗口
- **THEN** 文档被自动保存，磁盘内容与编辑器一致，dirty 标记清除，退出守卫放行

#### Scenario: 连续输入不落盘

- **WHEN** 用户在 debounce 窗口内持续输入（每次内容变化重置窗口）
- **THEN** 期间不发起保存写入，直到真正停止输入

#### Scenario: 冲突未处置时自动保存暂停

- **WHEN** 一次保存返回 `document_conflict` 且冲突提示仍未被处置，用户继续编辑并停止输入
- **THEN** 不发起任何保存写入（不重试 CAS），磁盘保持外部版本，内存修改保持 dirty

#### Scenario: 外部修改待决时自动保存暂停

- **WHEN** watch 命中打开中文件的外部修改且编辑器 dirty，用户在 sticky 提示上尚未选择
- **THEN** 不发起保存写入，磁盘保持外部程序写入的版本

### Requirement: 崩溃备份与恢复入口

编辑器 dirty 内容 SHALL 在 debounce 窗口到期后仍未落盘时（自动保存暂停或保存失败）写入应用恢复目录，位置 SHALL 为 `<config_dir>/recovery/<vault-key>/<path-key>`：`vault-key` 由 vault 根唯一确定，`path-key` 由 vault 相对路径可逆编码为单层文件名。备份 MUST NOT 写入 vault 内的文档路径；配置目录不在 vault 内时（常规部署）备份不进枚举结果与 watch 事件流。同一 (vault, 相对路径) SHALL 只保留最新一份备份（覆盖式写入）。保存成功（手动保存、自动保存、强制覆盖保存、另存为新文件）后 SHALL 清除该路径的备份。

vault 装载完成后 webview SHALL 枚举当前 vault 的残留备份并逐个给出恢复提示：提示为 sticky（处置前不自动消隐），提供「恢复内容」与「丢弃备份」两个动作。「恢复内容」SHALL 打开该文件并以磁盘当前 revision 作 CAS 基准，再把备份内容放入编辑器缓冲并保持未保存状态——恢复 MUST 经保存链路落盘，MUST NOT 静默改写磁盘上较新的内容；「丢弃备份」SHALL 删除备份且不改动编辑器。

#### Scenario: 暂停期间留下备份

- **WHEN** 自动保存因冲突 / 外部修改待决而暂停，编辑器仍有 dirty 内容
- **THEN** 该内容被写入配置目录下的恢复目录（不写入 vault 内路径），常规部署下文件树与 watch 事件流不出现该文件

#### Scenario: 保存成功清除备份

- **WHEN** 曾经留下备份的文档保存成功（含强制覆盖保存与另存为新文件）
- **THEN** 对应备份被删除，下次启动不再提示

#### Scenario: 启动发现残留备份

- **WHEN** 应用启动并装载 vault 后，恢复目录存在该 vault 的残留备份
- **THEN** webview 给出 sticky 恢复提示（含文件路径与两个动作），用户处置前不自动消隐

#### Scenario: 恢复不静默覆盖磁盘

- **WHEN** 用户对残留备份选择「恢复内容」，且磁盘上的文件已被外部修改
- **THEN** 备份内容进入编辑器并保持未保存状态，磁盘不被立即改写；随后的保存按 CAS 语义返回冲突并要求用户处置

## MODIFIED Requirements

### Requirement: 文档保存与冲突恢复

系统 SHALL 提供 `document_save` command 保存 vault 内 Markdown 文件，写入 MUST 为原子替换：内容先写入同目录临时文件（`.{文件名}.lumir-{pid}`），再 rename 替换目标；写入或替换结果无法确认时 SHALL 返回 `document_write_unknown`，MUST NOT 向用户报告成功。保存 MUST 以 revision CAS（compare-and-swap）为并发边界：调用方携带 `expected_revision`，与磁盘当前 revision（文件内容的 SHA-256，与 `fs_file_revision` 同口径）不一致时 SHALL 返回 `document_conflict` 并拒绝写入，MUST NOT 静默覆盖外部修改。

`document_conflict` 的界面提示 MUST 说明内存中的修改未丢失，并提供两个恢复动作：「重新载入（放弃我的修改）」回退到磁盘当前内容；「强制覆盖保存」在覆盖前拉取磁盘当前 revision 刷新 CAS 基准，且覆盖前的确认文案 MUST 明示将覆盖磁盘上较新的内容。提示 MUST 保持可见直至用户处置（sticky），MUST NOT 自动消隐。

强制覆盖保存 MUST NOT 静默吞掉再次冲突：覆盖前拉取的 revision 与写入之间再发生外部修改时，SHALL 再次给出与 `document_conflict` 同形的 sticky 提示（同一组两个恢复动作），MUST NOT 退化为自动消隐的纯文案提示。

保存目标被外部删除或移动（`fs_not_found`）时，界面提示 MUST 说明内存中的修改未丢失，并提供「另存为新文件」动作：经 `wikilink_create`（O_EXCL 语义，MUST NOT 覆盖既有文件）在同目录创建恢复副本，写入内存内容后切换为当前打开文件；目标已存在时 SHALL 自动变更副本名重试——副本名 SHALL 按「原名-恢复」、`-2` 直至 `-5` 的顺序推进；五个候选都被占用时 SHALL 给出人话失败提示并保留内存修改，MUST NOT 静默失败。

保存临时文件属于进程内垃圾：`document_save` 的 `create_new` 撞上同名残留文件（上次保存进程崩溃的 ghost）时 SHALL 删除该 ghost 并重试一次；重试仍失败才返回 `document_write_failed`。

#### Scenario: CAS 冲突拒绝静默覆盖

- **WHEN** 磁盘文件已被外部修改，webview 以旧 `expected_revision` 调用 `document_save`
- **THEN** 返回 `document_conflict`，磁盘内容保持外部修改后的版本，内存修改不被写入

#### Scenario: 冲突的两个逃生口

- **WHEN** 保存冲突提示可见，用户选择「重新载入（放弃我的修改）」
- **THEN** 编辑器回退到磁盘当前内容，dirty 状态清除；若选择「强制覆盖保存」并经确认，则磁盘被内存内容覆盖，且确认文案已明示将覆盖较新内容

#### Scenario: 强制覆盖再冲突仍给出恢复动作

- **WHEN** 强制覆盖保存拉取 revision 与写入之间，磁盘又被外部程序修改
- **THEN** 再次出现带两个恢复动作的 sticky 冲突提示，内存修改保持未保存，磁盘不被覆盖

#### Scenario: 文件被外部删除后另存

- **WHEN** 打开中的文件被外部删除，用户保存得到 `fs_not_found` 后选择「另存为新文件」
- **THEN** 系统在同目录创建恢复副本（不覆盖既有文件），内存内容写入副本并切换为当前打开文件

#### Scenario: 另存副本名逐级重试

- **WHEN** 「原名-恢复」与「原名-恢复-2」都已存在
- **THEN** 系统依次尝试候选名，在「原名-恢复-3」成功创建；若「原名-恢复」到「原名-恢复-5」全部被占用，则给出人话失败提示并保留内存中的修改

#### Scenario: 崩溃残留 ghost 不挡保存

- **WHEN** 目标目录存在同名 `.lumir-` 临时文件残留（上次保存进程崩溃），本次保存 `create_new` 撞车
- **THEN** 系统删除 ghost 重试一次，保存成功；ghost 不出现在文件树与 watch 事件流
