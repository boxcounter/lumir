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

打开中文件被外部变更命中时，webview SHALL 处置：编辑器未 dirty 时自动重载磁盘内容并提示；dirty 时给出 sticky 提示（非 modal）让用户选择「重载（放弃我的修改）」或「保留我的版本」；外部删除时提示内容仍保留在编辑器中。**自身写盘的回声 SHALL 被识别并丢弃**：命中打开中文件的 `modified` 事件到达时，webview SHALL 先读一次磁盘 revision（与 CAS 基准同 sha256 口径）并与该会话已知的基准比对，一致即判为应用自己那次写入的 FSEvents 回声，SHALL NOT 产生任何用户可见处置（不弹「检测到外部修改」、不弹处置浮条、不动缓冲与选区）；只有 revision 不一致（磁盘确有第三方写入）才进入上句的 dirty 分流处置。该判据 MUST NOT 依赖编辑器当前是否 dirty——「保存完成」与「回声到达」之间存在一二百毫秒的窗口（M266 实测记下相隔 177ms 的一对诊断日志，见 change 的 design §4），窗口内用户若已重新键入，dirty 分流会把自己的写入误报成外部修改，而它给出的「重载（放弃我的修改）」会让用户丢掉刚敲进去的内容。判据必须与 dirty 无关，MUST NOT 只靠「保存进行中」这一个瞬时标记抑制。

目录条目**从无到有**（该批次的条目类型为 created 且磁盘上是目录）时，同一批次 SHALL 一并带出该目录下的全部条目（递归、与枚举同忽略集、父先于子），使**增量收敛后的模型与同一时刻的全量枚举一致**。依据：FSEvents（macOS 实际事件源）对目录改名只报目录本身一条路径，子孙一个都不进事件流——M258 真机探针实测批次逐字为 `[deleted:旧路径, created:新路径(dir)]`（`src-tauri/src/fs_io.rs` 的测试 `watch_dir_rename_delivers_full_subtree` 复现），而前端只能按事件流打补丁、读不到磁盘；缺这一层，改名后的目录在前端只能建出一个空节点（永远展不开，直到重启全量重扫）。补的这一层是唯一读得到磁盘现状（ground truth）的一层。

#### Scenario: 目录改名后批次带出整棵子树

- **WHEN** vault 里的目录 `a`（含 `a/x.md` 与 `a/deep/y.txt`）被改名为 `b`（app 内重命名或外部 `mv`）
- **THEN** 该批增量含 `deleted:a` 与 `created:b`（目录），并含 `created:b/x.md`、`created:b/deep`、`created:b/deep/y.txt`（entry_kind 与磁盘一致）；批次内父先于子

#### Scenario: 改名两个方向被 debounce 拆成两批也不漏

- **WHEN** 一次目录改名产生的 `deleted:旧` 与 `created:新` 落在两个 debounce 批次里
- **THEN** `created:新` 那一批自带整棵子树，前端收敛出的目录仍是完整可展开的

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

#### Scenario: 自身写盘的回声在 dirty 时也不误报外部修改

- **WHEN** 用户按 `⌘S` 保存成功后，在回声到达前（约一二百毫秒内）继续键入，使编辑器重新 dirty；随后该次保存产生的 `modified` 事件到达
- **THEN** webview 读到磁盘 revision 与会话已知基准一致，判为自身写盘回声：不弹「检测到外部修改」、不出处置浮条、缓冲与选区不动；磁盘内容保持用户保存时的那一份

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

系统 SHALL 提供 `document_save` command 保存 vault 内文本文件——`.md`/`.markdown` 与扩展名注册表中的文本类（`code` / `text`）文件；image/binary 类扩展名 SHALL 被拒绝并返回 `fs_read_only`，MUST NOT 写入。写入 MUST 为原子替换：内容先写入同目录临时文件（`.{文件名}.lumir-{pid}`），再 rename 替换目标；写入或替换结果无法确认时 SHALL 返回 `document_write_unknown`，MUST NOT 向用户报告成功。保存 MUST 以 revision CAS（compare-and-swap）为并发边界：调用方携带 `expected_revision`，与磁盘当前 revision（文件内容的 SHA-256，与 `fs_file_revision` 同口径）不一致时 SHALL 返回 `document_conflict` 并拒绝写入，MUST NOT 静默覆盖外部修改。

`document_conflict` 的界面提示 MUST 说明内存中的修改未丢失，并提供两个恢复动作：「重新载入（放弃我的修改）」回退到磁盘当前内容；「强制覆盖保存」在覆盖前拉取磁盘当前 revision 刷新 CAS 基准，且覆盖前的确认文案 MUST 明示将覆盖磁盘上较新的内容。提示 MUST 保持可见直至用户处置（sticky），MUST NOT 自动消隐。

强制覆盖保存 MUST NOT 静默吞掉再次冲突：覆盖前拉取的 revision 与写入之间再发生外部修改时，SHALL 再次给出与 `document_conflict` 同形的 sticky 提示（同一组两个恢复动作），MUST NOT 退化为自动消隐的纯文案提示。

保存目标被外部删除或移动（`fs_not_found`）时，界面提示 MUST 说明内存中的修改未丢失，并提供「另存为新文件」动作：在同目录创建恢复副本（O_EXCL 语义，MUST NOT 覆盖既有文件），写入内存内容后切换为当前打开文件；目标已存在时 SHALL 自动变更副本名重试——副本名 SHALL 按「原名-恢复」、`-2` 直至 `-5` 的顺序推进；五个候选都被占用时 SHALL 给出人话失败提示并保留内存修改，MUST NOT 静默失败。恢复副本 SHALL 保留原文件的扩展名（`note.txt` 的副本是 `note-恢复.txt`，无扩展名文件的副本同样无扩展名），MUST NOT 把非 md 文件恢复成 `.md` 文件。

保存临时文件属于进程内垃圾：`document_save` 的 `create_new` 撞上同名残留文件（上次保存进程崩溃的 ghost）时 SHALL 删除该 ghost 并重试一次；重试仍失败才返回 `document_write_failed`。

本 change 只改一处行为口径：**本 requirement 覆盖的落盘入口全部是用户显式动作**（`⌘S`、冲突处置的两个动作、另存为新文件）——自动保存不再是本 requirement 的调用方，「非 md 文本保存走同一链路」的判据因此只剩显式动作一条（本 change 之前该 scenario 的括号里还写着「或自动保存 debounce 到期」）。CAS 边界、原子替换、冲突与另存处置的口径 MUST NOT 因本 change 改动。

#### Scenario: CAS 冲突拒绝静默覆盖

- **WHEN** 磁盘文件已被外部修改，webview 以旧 `expected_revision` 调用 `document_save`
- **THEN** 返回 `document_conflict`，磁盘内容保持外部修改后的版本，内存修改不被写入

#### Scenario: 非 md 文本保存走同一链路

- **WHEN** 用户编辑一份 `.yaml` / `.txt` 文件后按 Cmd+S
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

### Requirement: 保存临时文件 ghost 的磁盘治理

保存临时文件（`.{文件名}.lumir-{pid}`）在进程崩溃后残留的 ghost 会被忽略集挡在文件树与 watch 事件流之外，但仍占用 vault 磁盘空间并随崩溃次数累积。系统 SHALL 在 vault 枚举路径上惰性清除 mtime 早于年龄阈值（初始值 24 小时，可随实测调整）的该模式临时文件。系统 MUST NOT 清除未超龄的临时文件（同进程保存的 tmp 生命周期为毫秒级，阈值即保护在途写入），MUST NOT 清除名字不匹配该模式的合法点文件或符号链接。清除操作 SHALL 为 best-effort：任一清除失败 MUST NOT 使枚举失败或产生用户可见错误。

#### Scenario: 超龄 ghost 被惰性清除

- **WHEN** vault 内（含子目录）存在 mtime 早于年龄阈值的 `.lumir-` 临时文件，用户触发枚举或打开 vault
- **THEN** 该文件被删除，且不出现在枚举结果中

#### Scenario: 在途保存与合法点文件不受影响

- **WHEN** 枚举时同一目录下存在 mtime 在阈值内的 `.lumir-` 临时文件，以及 `.hidden.conf` 这类合法点文件
- **THEN** 二者均被保留，合法点文件正常出现在枚举结果中

### Requirement: 崩溃备份与恢复入口

编辑器 dirty 内容 SHALL 在**它自己的** debounce 窗口到期后写入应用恢复目录——触发不再依附任何保存动作（本 change 之前，备份挂在自动保存的失败分支上：只有自动保存暂停或写失败才落盘）。每次文档内容变化 SHALL 重置该窗口；窗口到期时该文档仍 dirty 即 SHALL 写一份备份，连续输入期间 MUST NOT 写。窗口初始值与实测定档见 change 的 design §3（裁决点 D1）。

备份位置 SHALL 为 `<config_dir>/recovery/<vault-key>/<path-key>`：`vault-key` 由 vault 根唯一确定，`path-key` 由 vault 相对路径可逆编码为单层文件名。备份 MUST NOT 写入 vault 内的文档路径；配置目录不在 vault 内时（常规部署）备份不进枚举结果与 watch 事件流。同一 (vault, 相对路径) SHALL 只保留最新一份备份（覆盖式写入）。每次写入 SHALL 一并记录备份那时的磁盘 revision 作为 CAS 基准（恢复侧对账用）。备份的 debounce 定时器 SHALL 按文档路径键控，MUST NOT 存在跨标签共享的单值（`multi-tabs` 的「保存粒度按标签隔离」）。

**备份的生命周期 SHALL 与 dirty 对齐**（本 change 新增的条款，依据见 change 的 design §5）：内存内容回到「与磁盘基准逐字节相同」时，该路径的备份 SHALL 被清除——手动保存成功、强制覆盖保存、另存为新文件、撤销 / 重做回到已保存基线、重新载入（放弃我的修改）、关闭标签时放弃修改、切换 vault 时放弃修改，全部 SHALL 清除对应路径的备份。MUST NOT 让一份不再对应当前未保存内容的备份在下次启动时弹出恢复提示：备份从「冲突待决时的罕见避险」变成「每次停止输入都会写的常规状态」之后，不清除会退化成「用户明明撤销 / 放弃了修改，下次启动却被追问要不要恢复」的系统性噪音（本 change 之前这条路径已存在，只是备份罕有落盘而少被看见）。

**app 内改名**（文件树菜单的重命名，含目录前缀改名）SHALL 把该路径的备份一并迁到新路径：旧路径的备份 SHALL 被清除，仍 dirty 的会话 SHALL 按新路径立即重新写入一份。备份与磁盘 revision 基准都按**路径**键控，而改名换的正是这个键——不迁的话旧路径会留下一份孤儿备份，下次启动弹出一个指向**已被改名、打不开**的文件的恢复提示，而新路径则落进「未登记磁盘版本」的不可保存态（r1 评审的 P2-2；本 change 把备份从「冲突待决时的罕见落盘」改成「每次停止输入满一个窗口就写」之后，这条路径从极窄变成常规暴露面）。

无落盘基准的 dirty 内容（未打开文件 / 未登记磁盘 revision）SHALL 显式跳过备份：备份的用途是经恢复入口把内容写回磁盘，而写回必须走保存链路（CAS 基准），为这类内容写备份只会留下无法闭环的恢复提示。（editable-non-md-files 后，已打开的非 md 文本文件均登记磁盘 revision，天然进入备份路径，不再是本条款的触发面。）

vault 装载完成后 webview SHALL 枚举当前 vault 的残留备份并逐个给出恢复提示：提示为 sticky（处置前不自动消隐），提供「恢复内容」与「丢弃备份」两个动作。「恢复内容」SHALL 打开该文件，并以备份记录的 revision 作为保存基准——MUST NOT 把恢复时刻的磁盘 revision 吸收为新基准——再把备份内容放入编辑器缓冲并保持未保存状态。磁盘在备份之后被外部修改时，随后的保存 SHALL 按 CAS 语义返回 `document_conflict` 并要求用户处置，MUST NOT 静默改写较新的磁盘版本；备份未记录基准（信封之前的老格式 / 元数据不可读）时 SHALL 同样以冲突收场，不得静默改写。「丢弃备份」SHALL 删除备份且不改动编辑器。

备份的写入 MUST NOT 落在键入到绘制的路径上（ADR 0002 §6）：窗口到期才写、写入走异步 IPC，键击之间 MUST NOT 出现备份写入。

#### Scenario: 暂停期间留下备份

- **WHEN** 用户编辑一份已登记磁盘 revision 的文档后停止输入满 debounce 窗口，文档仍是 dirty（无冲突、无外部修改待决——本 change 之前这一步依赖自动保存暂停）
- **THEN** 该内容与当时的磁盘 revision（CAS 基准）被写入配置目录下的恢复目录（不写入 vault 内路径），常规部署下文件树与 watch 事件流不出现该文件
- （scenario 名保留自 M127 的自动保存暂停口径：暂停态已随自动保存整条移除，open spec 的 MODIFIED 块不允许改 scenario 名，改名通道是整条移除 + 新增；本条断言已按新触发口径重写）

#### Scenario: 非 md 文本的 dirty 内容照常备份

- **WHEN** 备份 debounce 到期而文档仍是 dirty，当前文档是已登记磁盘 revision 的非 md 文本文件
- **THEN** 其 dirty 内容与 CAS 基准照常写入恢复目录，下次启动出现该路径的恢复提示

#### Scenario: 无落盘基准不留备份

- **WHEN** 备份 debounce 到期，而当前文档未登记磁盘 revision（未打开文件的空态 / 新建文档）
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

#### Scenario: 连续输入期间不写备份

- **WHEN** 用户在备份 debounce 窗口内持续输入（每次内容变化重置窗口）
- **THEN** 期间恢复目录里该路径的备份不变，直到真正停止输入满一个窗口（本条承接自被移除的「自动保存与暂停边界」的「连续输入不落盘」，约束对象由落盘改为备份写入）

#### Scenario: 放弃修改与撤销回到基线清除备份

- **WHEN** 某路径已经留下备份，随后用户的动作让内存内容回到磁盘基准（撤销 / 重做回到已保存内容，或经「重新载入（放弃我的修改）」/ 关闭标签放弃修改 / 切换 vault 放弃修改）
- **THEN** 该路径的备份被删除，下次启动对该路径不再出现恢复提示；恢复目录里 MUST NOT 留下一份内容已被用户明确放弃的备份

#### Scenario: app 内改名时备份随路径迁移

- **WHEN** 打开中的 dirty 文档已经留下崩溃备份，用户经文件树菜单把它改名（单文件改名，或目录前缀改名下的任一打开中会话）
- **THEN** 旧路径的备份被清除、仍 dirty 的会话立刻按新路径写入一份（内容与 CAS 基准随键迁移）；下次启动不对旧路径弹恢复提示，且该文档改名后仍可正常保存（不落进「未登记磁盘版本」的不可保存态）

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

- **WHEN** 备份 debounce 到期，而当前文档未登记磁盘 revision（空态 / 新建文档），且编辑器有 dirty 内容
- **THEN** 不写崩溃备份（也不排期任何自动落盘），且不产生恢复提示（该跳过为显式裁决，记录于 change non-md-readonly-open，触发面经 editable-non-md-files 收窄）

### Requirement: 文件级操作（删除 / 重命名 / 新建 / 定位）

系统 SHALL 提供以下后端命令，全部只作用于 vault 内路径，安全边界与读取链路同源
（`resolve_in_vault` 或其新建变体）：删除（`fs_trash_entry`）、重命名（`fs_rename_entry`）、
新建文件（`fs_create_file`）、新建目录（`fs_create_dir`）、系统文件管理器定位
（`fs_reveal_in_finder`）。

- 删除 SHALL 为**移到系统废纸篓**（用户可经系统通道恢复），MUST NOT 提供永久删除路径；
  废纸篓失败 SHALL 报错且 MUST NOT 留下部分删除状态。
- 重命名 SHALL 只支持同目录改末段名；目标已存在 MUST NOT 覆盖。
- 新建 SHALL 使用原子创建语义（`create_new` 或等价），撞名即拒绝。
- 新建/改名的末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不命中枚举忽略集
  （`IGNORED_NAMES`）。
- 目标解析 SHALL 经新建变体（父目录沿用 `resolve_in_vault` 全部逃逸防护，末段名按上条校验），
  MUST NOT 为写操作放松 vault 边界。
- 失败 SHALL 返回人话 `CommandError`（区分 `fs_not_found` / `fs_already_exists` /
  `fs_name_invalid` / `fs_trash_failed` 等错误码）。

#### Scenario: 删除进废纸篓且可恢复

- **WHEN** 用户确认删除文件 `a.md`
- **THEN** `a.md` 从 vault 消失并进入系统废纸篓；若废纸篓调用失败，文件保持原样并返回
  `fs_trash_failed`

#### Scenario: 改名撞名拒绝

- **WHEN** 重命名目标名与既有条目同名
- **THEN** 返回 `fs_already_exists`，两个条目逐字节不变

#### Scenario: 逃逸路径拒绝

- **WHEN** 任一文件级命令收到含 `..` 或绝对路径的输入
- **THEN** 返回 `fs_path_escape`，文件系统不变

#### Scenario: 忽略集名拒绝

- **WHEN** 新建/改名的末段名为 `.git` / `.DS_Store` / `node_modules`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

### Requirement: app 内文件操作的 tab 联动

app 内发起的重命名命中打开中的文档时，前端 SHALL 就地 remap 打开 session 的路径（文件 = 单
session 替换；目录 = 其下全部打开 session 的前缀替换），保留 dirty 内容、revision 基准、滚动
与光标状态；本次改名的 watcher 回响 SHALL 按 invoke 发起时登记的 old→new 对（invoke 失败即撤）
做一次性归因抑制：`deleted:old` 与 `created:new` 两个事件都在 session 链路跳过（树与索引照常
收敛），MUST NOT 触发「已被外部删除」或「检测到外部修改」处置。抑制条目消费即清或超时即清，
MUST NOT 常驻。app 内发起的删除命中
打开中的文档时 SHALL 沿用既有 watcher 删除处置（tab 保留、提示内容未丢失、该路径的 dirty 内容
与其 CAS 基准照常留在崩溃备份里），
不另开分支。外部发起的删除/改名 SHALL 完全沿用 watcher 现状处置。

#### Scenario: app 内改名打开中的文件不误报

- **WHEN** 打开中的 `a.md`（含未保存修改）经右键菜单改名为 `b.md`
- **THEN** tab 就地变为 `b.md`，未保存内容与编辑状态保留，全程无「已被外部删除」与
  「检测到外部修改」提示

#### Scenario: app 内改名目录联动深层 session

- **WHEN** 目录 `sub` 经右键菜单改名为 `sub2`，且 `sub/deep/a.md` 打开中
- **THEN** 该 session 路径前缀替换为 `sub2/deep/a.md`，状态保留，无误报

#### Scenario: app 内删除打开中的文件沿用现状处置

- **WHEN** 打开中的 `a.md` 经右键菜单确认删除
- **THEN** tab 保留、sticky 提示内容未丢失（与外部删除同一处置），该路径的 dirty 内容与
  磁盘基准照常可按恢复入口取回

### Requirement: 局部 patch 写入

系统 SHALL 提供 `fs_patch_file(path, edits: [{old_string, new_string}], revision)` 库函数：对 vault 内既有文本文件应用一组编辑。每个 `old_string` SHALL 在**应用它的那一刻**的文本中**恰好命中一次**——零次或多次命中 SHALL 拒绝整组编辑并返回带命中次数与编辑序号的人话错误；编辑按数组顺序逐个应用（后一条看得到前一条的结果）；空 `edits` 或空 `old_string` SHALL 拒绝（空串没有唯一命中语义，MUST NOT 退化成插入）。替换后未触及部分 SHALL 逐字节不变（ADR 0003 §3 在 agent 写入侧的延伸）。image/binary 扩展名 SHALL 拒绝（沿用 `fs_read_only` 口径），判定先于任何 IO。

patch SHALL 携带调用方持有的 revision（SHA-256），与 `document_save` 同一套 compare-and-swap 口径：冲突返回 `document_conflict`，文件逐字节不变。

落盘 SHALL 走与保存**同一个写核心**（同目录 `.lumir-` 临时文件 + 原子 rename + ghost 重试），因此写入过程 MUST NOT 在文件树或 `fs:entry_changed` 事件流里产生临时条目（写盘方的自身标记被既有忽略集挡下）；patch 完成后 SHALL 有目标文件的一条 `modified` 增量进入事件流。被 patch 文件若有打开的编辑器会话，系统 SHALL 经该既有通路（`fs:entry_changed` 的外部变更分流：未 dirty 自动重载、dirty 交用户选择）同步编辑器内容，MUST NOT 绕过通路只改盘而不更新会话。

#### Scenario: 唯一命中替换

- **WHEN** 对文件应用一个 `old_string` 唯一命中的编辑
- **THEN** 命中处被替换，文件其余部分逐字节不变（前后两段与原文 sha256 相同），revision 前进

#### Scenario: 非唯一命中拒绝

- **WHEN** `old_string` 在文件中出现零次或多次
- **THEN** 拒绝整组编辑（含数组中先前的合法编辑也不落盘），文件逐字节不变、revision 不变，错误中指明命中次数与编辑序号

#### Scenario: revision 冲突

- **WHEN** patch 携带的 revision 与当前文件不一致
- **THEN** 返回 `document_conflict`，文件不变，由调用方重读后重试

#### Scenario: image/binary 拒绝

- **WHEN** 目标路径的扩展名属于 image/binary 拒绝清单（如 `.png` / `.pdf` / `.zip`）
- **THEN** 返回 `fs_read_only`，不写入任何字节，且不因目标不存在而返回 `fs_not_found`

#### Scenario: 临时条目不入事件流

- **WHEN** patch 落盘（写入临时文件并原子替换目标）
- **THEN** `fs:entry_changed` 流里只有目标文件的 `modified` 增量，不含任何 `.lumir-` 临时条目

#### Scenario: 打开中会话同步

- **WHEN** patch 命中一个已打开的文档
- **THEN** 编辑器内容经既有外部变更分流与该文件的新内容收敛（未 dirty 自动重载；dirty 时由用户选择重载或保留），MUST NOT 出现「磁盘已变而编辑器仍停在旧内容」的静默分歧

### Requirement: 新建文档（含内容，O_EXCL）

系统 SHALL 提供 `vault_create_file(path, content)` 库函数：按显式 vault 相对路径新建文档并写入内容，使用原子创建语义（`create_new`）——目标已存在 SHALL 返回 `fs_already_exists`，MUST NOT 覆盖既有文件或目录的任何字节。

目标 SHALL 经既有新建变体解析（父目录沿用 `resolve_in_vault` 的全部逃逸防护，末段名按内置忽略名校验）；父目录 MUST NOT 被隐式创建，不存在时返回 `fs_not_found`。路径的**父段** MUST NOT 命中内置忽略名（如 `.git/new.md`、`node_modules/x.md`）：建在忽略子树里的文件不出现在文件树里、用户也删不掉，属静默丢失。image/binary 扩展名 SHALL 拒绝（`fs_read_only`）。写入或落盘失败 SHALL 删除刚建出的文件，MUST NOT 留下半截内容。

#### Scenario: 新建成功且不覆盖

- **WHEN** 对不存在的路径调用一次 `vault_create_file`，随后对同一路径再调用一次
- **THEN** 第一次创建成功并写入内容；第二次返回 `fs_already_exists`，文件内容仍是第一次写入的那一份

#### Scenario: 非法目标各归其错误码

- **WHEN** 目标为不存在父目录下的路径 / 含 `..` 或绝对路径 / 末段或父段命中内置忽略名 / image-binary 扩展名 / 空路径
- **THEN** 分别返回 `fs_not_found` / `fs_path_escape` / `fs_name_invalid` / `fs_read_only` / `fs_path_invalid`，且文件系统上不出现任何新条目
