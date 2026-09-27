# Delta: fs-io（editable-non-md-files）

## MODIFIED Requirements

### Requirement: 文档保存与冲突恢复

系统 SHALL 提供 `document_save` command 保存 vault 内文本文件——`.md`/`.markdown` 与扩展名注册表中的文本类（`code` / `text`）文件；image/binary 类扩展名 SHALL 被拒绝并返回 `fs_read_only`，MUST NOT 写入。写入 MUST 为原子替换：内容先写入同目录临时文件（`.{文件名}.lumir-{pid}`），再 rename 替换目标；写入或替换结果无法确认时 SHALL 返回 `document_write_unknown`，MUST NOT 向用户报告成功。保存 MUST 以 revision CAS（compare-and-swap）为并发边界：调用方携带 `expected_revision`，与磁盘当前 revision（文件内容的 SHA-256，与 `fs_file_revision` 同口径）不一致时 SHALL 返回 `document_conflict` 并拒绝写入，MUST NOT 静默覆盖外部修改。

`document_conflict` 的界面提示 MUST 说明内存中的修改未丢失，并提供两个恢复动作：「重新载入（放弃我的修改）」回退到磁盘当前内容；「强制覆盖保存」在覆盖前拉取磁盘当前 revision 刷新 CAS 基准，且覆盖前的确认文案 MUST 明示将覆盖磁盘上较新的内容。提示 MUST 保持可见直至用户处置（sticky），MUST NOT 自动消隐。

强制覆盖保存 MUST NOT 静默吞掉再次冲突：覆盖前拉取的 revision 与写入之间再发生外部修改时，SHALL 再次给出与 `document_conflict` 同形的 sticky 提示（同一组两个恢复动作），MUST NOT 退化为自动消隐的纯文案提示。

保存目标被外部删除或移动（`fs_not_found`）时，界面提示 MUST 说明内存中的修改未丢失，并提供「另存为新文件」动作：在同目录创建恢复副本（O_EXCL 语义，MUST NOT 覆盖既有文件），写入内存内容后切换为当前打开文件；目标已存在时 SHALL 自动变更副本名重试——副本名 SHALL 按「原名-恢复」、`-2` 直至 `-5` 的顺序推进；五个候选都被占用时 SHALL 给出人话失败提示并保留内存修改，MUST NOT 静默失败。恢复副本 SHALL 保留原文件的扩展名（`note.txt` 的副本是 `note-恢复.txt`，无扩展名文件的副本同样无扩展名），MUST NOT 把非 md 文件恢复成 `.md` 文件。

保存临时文件属于进程内垃圾：`document_save` 的 `create_new` 撞上同名残留文件（上次保存进程崩溃的 ghost）时 SHALL 删除该 ghost 并重试一次；重试仍失败才返回 `document_write_failed`。

#### Scenario: CAS 冲突拒绝静默覆盖

- **WHEN** 磁盘文件已被外部修改，webview 以旧 `expected_revision` 调用 `document_save`
- **THEN** 返回 `document_conflict`，磁盘内容保持外部修改后的版本，内存修改不被写入

#### Scenario: 非 md 文本保存走同一链路

- **WHEN** 用户编辑一份 `.yaml` / `.txt` 文件后按 Cmd+S（或自动保存 debounce 到期）
- **THEN** 原子替换落盘、dirty 清除；磁盘被外部修改过时返回 `document_conflict` 并给出与 Markdown 同形的两个恢复动作

#### Scenario: 非 md 另存保留原扩展名

- **WHEN** 打开中的 `config.yaml` 被外部删除，用户保存得到 `fs_not_found` 后选择「另存为新文件」
- **THEN** 系统在同目录创建 `config-恢复.yaml`（不覆盖既有文件），内存内容写入副本并切换为当前打开文件

#### Scenario: 二进制扩展拒绝写入

- **WHEN** `document_save` 被以 image/binary 类扩展名的路径调用（如 `logo.png`）
- **THEN** 返回 `fs_read_only`，不写入任何内容

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

### Requirement: 崩溃备份与恢复入口

编辑器 dirty 内容 SHALL 在 debounce 窗口到期后仍未落盘时（自动保存暂停或保存失败）写入应用恢复目录，位置 SHALL 为 `<config_dir>/recovery/<vault-key>/<path-key>`：`vault-key` 由 vault 根唯一确定，`path-key` 由 vault 相对路径可逆编码为单层文件名。备份 MUST NOT 写入 vault 内的文档路径；配置目录不在 vault 内时（常规部署）备份不进枚举结果与 watch 事件流。同一 (vault, 相对路径) SHALL 只保留最新一份备份（覆盖式写入）。每次写入 SHALL 一并记录备份那时的磁盘 revision 作为 CAS 基准（恢复侧对账用）。保存成功（手动保存、自动保存、强制覆盖保存、另存为新文件）后 SHALL 清除该路径的备份。无落盘基准的 dirty 内容（未打开文件 / 未登记磁盘 revision）SHALL 显式跳过备份：备份的用途是经恢复入口把内容写回磁盘，而写回必须走保存链路（CAS 基准），为这类内容写备份只会留下无法闭环的恢复提示。（editable-non-md-files 后，已打开的非 md 文本文件均登记磁盘 revision，天然进入备份路径，不再是本条款的触发面。）

vault 装载完成后 webview SHALL 枚举当前 vault 的残留备份并逐个给出恢复提示：提示为 sticky（处置前不自动消隐），提供「恢复内容」与「丢弃备份」两个动作。「恢复内容」SHALL 打开该文件，并以备份记录的 revision 作为保存基准——MUST NOT 把恢复时刻的磁盘 revision 吸收为新基准——再把备份内容放入编辑器缓冲并保持未保存状态。磁盘在备份之后被外部修改时，随后的保存 SHALL 按 CAS 语义返回 `document_conflict` 并要求用户处置，MUST NOT 静默改写较新的磁盘版本；备份未记录基准（信封之前的老格式 / 元数据不可读）时 SHALL 同样以冲突收场，不得静默改写。「丢弃备份」SHALL 删除备份且不改动编辑器。

#### Scenario: 暂停期间留下备份

- **WHEN** 自动保存因冲突 / 外部修改待决而暂停，编辑器仍有 dirty 内容
- **THEN** 该内容与当时的磁盘 revision（CAS 基准）被写入配置目录下的恢复目录（不写入 vault 内路径），常规部署下文件树与 watch 事件流不出现该文件

#### Scenario: 非 md 文本的 dirty 内容照常备份

- **WHEN** 自动保存 debounce 到期而保存未落盘（暂停或失败），当前文档是已登记磁盘 revision 的非 md 文本文件
- **THEN** 其 dirty 内容与 CAS 基准照常写入恢复目录，下次启动出现该路径的恢复提示

#### Scenario: 无落盘基准不留备份

- **WHEN** 自动保存 debounce 到期，而当前文档未登记磁盘 revision（未打开文件的空态 / 新建文档）
- **THEN** 不写备份；下次启动不会出现该路径的恢复提示（该内容本来就没有任何保存路径可写回磁盘）

#### Scenario: 保存成功清除备份

- **WHEN** 曾经留下备份的文档保存成功（含强制覆盖保存与另存为新文件）
- **THEN** 对应备份被删除，下次启动不再提示

#### Scenario: 备份后磁盘被外部修改

- **WHEN** 备份写入之后、用户选择「恢复内容」之前，同一文件在磁盘上被外部程序修改
- **THEN** 恢复以备份记录的 revision 为保存基准（不吸收磁盘当前 revision），编辑器显示备份内容并保持未保存；随后的保存因基准与磁盘不一致返回 `document_conflict` 并给出恢复动作，磁盘上较新的版本不被覆盖

#### Scenario: 启动发现残留备份

- **WHEN** 应用启动并装载 vault 后，恢复目录存在该 vault 的残留备份
- **THEN** webview 给出 sticky 恢复提示（含文件路径与两个动作），用户处置前不自动消隐

#### Scenario: 恢复不静默覆盖磁盘

- **WHEN** 用户对残留备份选择「恢复内容」，且磁盘上的文件已被外部修改
- **THEN** 备份内容进入编辑器并保持未保存状态，磁盘不被立即改写；随后的保存按 CAS 语义返回冲突并要求用户处置

### Requirement: 不可保存文档的保存反馈

编辑器 dirty 而当前展示文档没有落盘能力时（未打开文件 / 未登记磁盘 revision），手动保存（Cmd+S）MUST 给出可见反馈：说明该文档不支持保存，并指出脱离 dirty 的动作（撤销修改）。MUST NOT 静默返回。dirty 状态切换文件 / 切换 vault 的守卫提示同样 MUST NOT 建议「请先保存（Cmd+S）」这条在该状态下走不通的动作，SHALL 指向撤销修改。dirty 会拦截切换文件、切换 vault 与退出（M101 守卫），因此静默或误导性的守卫提示等价于把用户锁在一个没有出口的状态里。

崩溃备份 SHALL 对无落盘基准的 dirty 内容显式跳过（不写备份）：备份的唯一用途是经恢复入口写回磁盘，而写回必须走保存链路（CAS 基准），为这类内容写备份只会留下无法闭环的恢复提示。跳过是显式裁决，MUST NOT 表现为「静默地什么都没有」。

本条同时是防再犯的兜底：editable-non-md-files 后，已打开的非 md 文本文件可编辑且登记磁盘 revision（保存真实可达），当前可达的触发路径是「没有打开文件」（空态 / 新建文档）与「尚未读到快照的 md」；若未来再出现「可编辑但无磁盘 revision」的路径，本要求照旧生效。

#### Scenario: 没有打开文件时的 Cmd+S 反馈

- **WHEN** 用户在没有打开任何文件时编辑默认模式文档（编辑器为空态/演示文档）后按 Cmd+S
- **THEN** 出现可见提示说明当前没有可保存的文件、修改仍在编辑器内并给出撤销动作；不发起任何写入，dirty 保持不变

#### Scenario: 无落盘基准时切换守卫指向真正的出口

- **WHEN** 上述状态下用户点击文件树里的另一个文件（切换被 dirty 守卫拦下）
- **THEN** 守卫提示说明当前文档不支持保存，并指向撤销修改；MUST NOT 出现「请先保存（Cmd+S）」这类走不通的建议，当前文件保持不变

#### Scenario: 无落盘基准不写崩溃备份

- **WHEN** 自动保存 debounce 到期，而当前文档未登记磁盘 revision（空态 / 新建文档），且编辑器有 dirty 内容
- **THEN** 不写崩溃备份也不排期保存，且不产生恢复提示（该跳过为显式裁决，记录于 change non-md-readonly-open，触发面经 editable-non-md-files 收窄）
