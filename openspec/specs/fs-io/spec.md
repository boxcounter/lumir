# fs-io Specification

## Purpose

定义 vault 文件系统 IO 的 webview 侧契约：全类型递归枚举（全文件类型一等公民，ADR 0001）、watch 增量事件流、文本/二进制附件读取，以及所有按路径读取的 vault 内路径约束安全边界（ADR 0002 §3：webview 不直接触文件系统）。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18；fs_io 经架构复查 P2-5 整体重写，旧 stub 签名废弃）。

## Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。默认忽略集 SHALL 硬编码为 `.git/`、`.DS_Store`、`node_modules/`（⚠ 裁决点 C，理由：忽略集保护性能合同，一等公民的是文件类型而非 VCS 内部目录）；该集合本 change 内不可配置。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（忽略集除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** vault 根含 `.git/` 目录与 `.DS_Store` 文件
- **THEN** 枚举结果不含这些条目及其子孙

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

### Requirement: 文本文件读取

系统 SHALL 提供 `fs_read_file` command 按相对路径读取 vault 内文本文件内容，按 UTF-8 解码；非合法 UTF-8 SHALL 返回 `CommandError`（code 稳定、message 为人话中文），MUST NOT 静默替换字符。读取结果 SHALL 经 ts-rs 导出 payload 类型至 `src/bindings/`。

#### Scenario: 非法 UTF-8 人话报错

- **WHEN** 前端请求读取一个 GBK 编码的文本文件
- **THEN** invoke reject 携带 `CommandError`，message 说明文件编码不受支持，前端可直接展示

### Requirement: 二进制附件读取

系统 SHALL 提供按相对路径读取 vault 内二进制附件字节的能力（⚠ 裁决点 A：invoke + base64 为推荐形态，Tauri asset protocol 为候选；最终形态以 Alex 裁决为准，spec 语义不绑定形态），供编辑器渲染附件引用（`![[image.png]]` 等，消费方见 add-editor-live-preview）。附件读取 SHALL 与文本读取走同一 vault 内路径约束。单附件大小 SHALL 设上限（建议 50MB），超限返回人话错误，防止误读大文件撑破常驻内存合同（ADR 0002 §6）。

#### Scenario: 超限附件拒绝

- **WHEN** 请求读取超过大小上限的附件
- **THEN** 返回人话错误，不分配对应内存

### Requirement: vault 内路径约束

fs-io 所有按路径读取的接口 SHALL 校验目标路径解析后不逃逸 vault 根：`..` 穿越、绝对路径、符号链接逃逸均 SHALL 拒绝并返回 `CommandError`。该约束是安全边界，MUST NOT 由调用方（webview）自觉保证。

#### Scenario: 路径穿越拒绝

- **WHEN** 请求路径为 `../../etc/passwd` 或指向 vault 外的符号链接
- **THEN** 返回 `CommandError`，不读取任何 vault 外内容

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

### Requirement: 保存临时文件 ghost 的磁盘治理

保存临时文件（`.{文件名}.lumir-{pid}`）在进程崩溃后残留的 ghost 会被忽略集挡在文件树与 watch 事件流之外，但仍占用 vault 磁盘空间并随崩溃次数累积。系统 SHALL 在 vault 枚举路径上惰性清除 mtime 早于年龄阈值（初始值 24 小时，可随实测调整）的该模式临时文件。系统 MUST NOT 清除未超龄的临时文件（同进程保存的 tmp 生命周期为毫秒级，阈值即保护在途写入），MUST NOT 清除名字不匹配该模式的合法点文件或符号链接。清除操作 SHALL 为 best-effort：任一清除失败 MUST NOT 使枚举失败或产生用户可见错误。

#### Scenario: 超龄 ghost 被惰性清除

- **WHEN** vault 内（含子目录）存在 mtime 早于年龄阈值的 `.lumir-` 临时文件，用户触发枚举或打开 vault
- **THEN** 该文件被删除，且不出现在枚举结果中

#### Scenario: 在途保存与合法点文件不受影响

- **WHEN** 枚举时同一目录下存在 mtime 在阈值内的 `.lumir-` 临时文件，以及 `.hidden.conf` 这类合法点文件
- **THEN** 二者均被保留，合法点文件正常出现在枚举结果中

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

编辑器 dirty 内容 SHALL 在 debounce 窗口到期后仍未落盘时（自动保存暂停或保存失败）写入应用恢复目录，位置 SHALL 为 `<config_dir>/recovery/<vault-key>/<path-key>`：`vault-key` 由 vault 根唯一确定，`path-key` 由 vault 相对路径可逆编码为单层文件名。备份 MUST NOT 写入 vault 内的文档路径；配置目录不在 vault 内时（常规部署）备份不进枚举结果与 watch 事件流。同一 (vault, 相对路径) SHALL 只保留最新一份备份（覆盖式写入）。每次写入 SHALL 一并记录备份那时的磁盘 revision 作为 CAS 基准（恢复侧对账用）。保存成功（手动保存、自动保存、强制覆盖保存、另存为新文件）后 SHALL 清除该路径的备份。无落盘基准的 dirty 内容（非 md 只读模式 / 未登记磁盘 revision）SHALL 显式跳过备份：备份的用途是经恢复入口把内容写回磁盘，而写回必须走保存链路（md 模式 + CAS 基准），为这类内容写备份只会留下无法闭环的恢复提示。

vault 装载完成后 webview SHALL 枚举当前 vault 的残留备份并逐个给出恢复提示：提示为 sticky（处置前不自动消隐），提供「恢复内容」与「丢弃备份」两个动作。「恢复内容」SHALL 打开该文件，并以备份记录的 revision 作为保存基准——MUST NOT 把恢复时刻的磁盘 revision 吸收为新基准——再把备份内容放入编辑器缓冲并保持未保存状态。磁盘在备份之后被外部修改时，随后的保存 SHALL 按 CAS 语义返回 `document_conflict` 并要求用户处置，MUST NOT 静默改写较新的磁盘版本；备份未记录基准（信封之前的老格式 / 元数据不可读）时 SHALL 同样以冲突收场，不得静默改写。「丢弃备份」SHALL 删除备份且不改动编辑器。

#### Scenario: 暂停期间留下备份

- **WHEN** 自动保存因冲突 / 外部修改待决而暂停，编辑器仍有 dirty 内容
- **THEN** 该内容与当时的磁盘 revision（CAS 基准）被写入配置目录下的恢复目录（不写入 vault 内路径），常规部署下文件树与 watch 事件流不出现该文件

#### Scenario: 无落盘基准不留备份

- **WHEN** 自动保存 debounce 到期，而当前展示的是非 md 文档（只读 code 模式，未登记磁盘 revision）
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

编辑器 dirty 而当前展示文档没有落盘能力时（未打开文件 / 非 md 只读模式 / 未登记磁盘 revision），手动保存（Cmd+S）MUST 给出可见反馈：说明该文档不支持保存，并指出脱离 dirty 的动作（撤销修改）。MUST NOT 静默返回。dirty 状态切换文件 / 切换 vault 的守卫提示同样 MUST NOT 建议「请先保存（Cmd+S）」这条在该状态下走不通的动作，SHALL 指向撤销修改。dirty 会拦截切换文件、切换 vault 与退出（M101 守卫），因此静默或误导性的守卫提示等价于把用户锁在一个没有出口的状态里。

崩溃备份 SHALL 对无落盘基准的 dirty 内容显式跳过（不写备份）：备份的唯一用途是经恢复入口写回磁盘，而写回必须走保存链路（md 模式 + CAS 基准），为这类内容写备份只会留下无法闭环的恢复提示。跳过是显式裁决，MUST NOT 表现为「静默地什么都没有」。

本条同时是防再犯的兜底：M130 方向 A 收口后，非 md 文件（含无扩展名）一律以只读 code 模式打开、不可能 dirty，因此当前可达的触发路径是「没有打开文件」（空态 / 新建文档）；若未来再出现「可编辑但无磁盘 revision」的路径，本要求照旧生效。

#### Scenario: 没有打开文件时的 Cmd+S 反馈

- **WHEN** 用户在没有打开任何文件时编辑默认模式文档（编辑器为空态/演示文档）后按 Cmd+S
- **THEN** 出现可见提示说明当前没有可保存的文件、修改仍在编辑器内并给出撤销动作；不发起任何写入，dirty 保持不变

#### Scenario: 无落盘基准时切换守卫指向真正的出口

- **WHEN** 上述状态下用户点击文件树里的另一个文件（切换被 dirty 守卫拦下）
- **THEN** 守卫提示说明当前文档不支持保存，并指向撤销修改；MUST NOT 出现「请先保存（Cmd+S）」这类走不通的建议，当前文件保持不变

#### Scenario: 无落盘基准不写崩溃备份

- **WHEN** 自动保存 debounce 到期，而当前文档是非 md（只读 code）或未登记磁盘 revision，且编辑器有 dirty 内容
- **THEN** 不写崩溃备份也不排期保存，且不产生恢复提示（该跳过为显式裁决，记录于 change non-md-readonly-open）
