## ADDED Requirements

### Requirement: 文档保存与冲突恢复

系统 SHALL 提供 `document_save` command 保存 vault 内 Markdown 文件，写入 MUST 为原子替换：内容先写入同目录临时文件（`.{文件名}.lumir-{pid}`），再 rename 替换目标；写入或替换结果无法确认时 SHALL 返回 `document_write_unknown`，MUST NOT 向用户报告成功。保存 MUST 以 revision CAS（compare-and-swap）为并发边界：调用方携带 `expected_revision`，与磁盘当前 revision（文件内容的 SHA-256，与 `fs_file_revision` 同口径）不一致时 SHALL 返回 `document_conflict` 并拒绝写入，MUST NOT 静默覆盖外部修改。

`document_conflict` 的界面提示 MUST 说明内存中的修改未丢失，并提供两个恢复动作：「重新载入（放弃我的修改）」回退到磁盘当前内容；「强制覆盖保存」在覆盖前拉取磁盘当前 revision 刷新 CAS 基准，且覆盖前的确认文案 MUST 明示将覆盖磁盘上较新的内容。提示 MUST 保持可见直至用户处置（sticky），MUST NOT 自动消隐。

保存目标被外部删除或移动（`fs_not_found`）时，界面提示 MUST 说明内存中的修改未丢失，并提供「另存为新文件」动作：经 `wikilink_create`（O_EXCL 语义，MUST NOT 覆盖既有文件）在同目录创建恢复副本，写入内存内容后切换为当前打开文件；目标已存在时 SHALL 自动变更副本名重试。

保存临时文件属于进程内垃圾：`document_save` 的 `create_new` 撞上同名残留文件（上次保存进程崩溃的 ghost）时 SHALL 删除该 ghost 并重试一次；重试仍失败才返回 `document_write_failed`。

#### Scenario: CAS 冲突拒绝静默覆盖

- **WHEN** 磁盘文件已被外部修改，webview 以旧 `expected_revision` 调用 `document_save`
- **THEN** 返回 `document_conflict`，磁盘内容保持外部修改后的版本，内存修改不被写入

#### Scenario: 冲突的两个逃生口

- **WHEN** 保存冲突提示可见，用户选择「重新载入（放弃我的修改）」
- **THEN** 编辑器回退到磁盘当前内容，dirty 状态清除；若选择「强制覆盖保存」并经确认，则磁盘被内存内容覆盖，且确认文案已明示将覆盖较新内容

#### Scenario: 文件被外部删除后另存

- **WHEN** 打开中的文件被外部删除，用户保存得到 `fs_not_found` 后选择「另存为新文件」
- **THEN** 系统在同目录创建恢复副本（不覆盖既有文件），内存内容写入副本并切换为当前打开文件

#### Scenario: 崩溃残留 ghost 不挡保存

- **WHEN** 目标目录存在同名 `.lumir-` 临时文件残留（上次保存进程崩溃），本次保存 `create_new` 撞车
- **THEN** 系统删除 ghost 重试一次，保存成功；ghost 不出现在文件树与 watch 事件流

## MODIFIED Requirements

### Requirement: watch 增量事件流

vault 打开期间系统 SHALL 监听文件系统变更，并经 `fs:entry_changed` 事件（commands.rs `<domain>:<event>` 命名约定）向 webview 推送增量，事件 payload SHALL 携带变更类型（created / modified / deleted）与相对路径。连续事件 SHALL 在 debounce 窗口内合并推送，窗口初始值 100ms、可随实测调整（⚠ 裁决点 B：逐条增量而非"tree dirty"重扫信号）。watch SHALL 与枚举共用同一忽略集；忽略集 SHALL 覆盖保存临时文件模式——`.` 开头且含 `.lumir-` 的名字（如 `.note.md.lumir-123`），临时文件及其 ghost MUST NOT 进入事件流或文件树，合法点文件（如 `.obsidian/` 配置）不受影响。vault 关闭或替换时 watch SHALL 停止。

打开中文件被外部变更命中时，webview SHALL 处置：编辑器未 dirty 时自动重载磁盘内容并提示；dirty 时给出 sticky 提示（非 modal）让用户选择「重载（放弃我的修改）」或「保留我的版本」；外部删除时提示内容仍保留在编辑器中。应用自身保存产生的 watch 事件 SHALL 经 revision 比对丢弃（revision 未变即不重载）。

#### Scenario: 外部变更实时到达

- **WHEN** vault 打开期间，另一个程序在 vault 内新建、修改、删除文件
- **THEN** webview 在 debounce 窗口后收到对应增量的 `fs:entry_changed` 事件

#### Scenario: 突发变更合并

- **WHEN** 100ms 内发生 50 次文件变更（如 git checkout 切换分支）
- **THEN** 事件合并为少量批次推送，不逐条冲刷 webview

#### Scenario: 保存临时文件不进事件流

- **WHEN** 应用或崩溃残留产生 `.` 开头且含 `.lumir-` 的临时文件
- **THEN** 枚举与 watch 均忽略该文件，文件树与事件流不出现；合法点文件仍正常枚举

#### Scenario: 打开中文件被外部修改

- **WHEN** watch 增量命中当前打开的文件，编辑器无未保存修改
- **THEN** webview 自动重载磁盘内容并提示；若编辑器有未保存修改，则给出 sticky 提示让用户选择重载或保留本地版本

#### Scenario: 打开中文件被外部删除

- **WHEN** watch 增量命中当前打开的文件且变更类型为 deleted
- **THEN** webview 提示文件已被外部删除、编辑器中的内容未丢失
