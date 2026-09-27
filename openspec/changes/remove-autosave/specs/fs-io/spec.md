# remove-autosave 增量规格

## REMOVED Requirements

### Requirement: 自动保存与暂停边界

整条移除：webview 不再有任何「编辑器 dirty 即自行落盘」的路径，`⌘S`（以及冲突恢复、另存为新文件这两条用户显式动作）是唯一写 vault 内文档的入口（Alex 裁决 2026-09-27：「去掉自动保存，保留守卫+备份」）。

被移除的是**三条**内容，各自有承接面，不是静默删条款：

1. **停止输入 debounce 到期即自动保存**（含「连续输入期间不落盘」这条子不变量）——落盘动作本身移除；「不静默丢失未保存内容」由 `退出 / 切文件 / 切 vault / 关标签的 dirty 守卫`（`multi-tabs`、`fs-io` 的「不可保存文档的保存反馈」）与「崩溃备份与恢复入口」两条机制承接，自动保存不是它们的必要条件。
2. **自动保存的暂停边界**（未处置冲突 / 外部修改待决 / 保存目标已删除时暂停，不得重试 CAS）——自动保存既是这套暂停机制的**消费者**（全仓唯一：`src/save-controller.ts` 的 `reconcile`），也是它的**存在理由**；消费者消失后，暂停态、`paused` 按路径集合与 `autosave_paused` / `autosave_resumed` 两个诊断事件一并失去意义（声明了却没有消费者是 REVIEW.md 第 9 条点名要收的形态）。
3. **自动保存成功后的 dirty 清除语义**——本身不消失，但不再是「与自动保存一致」，而是与手动保存同一套：清除内存 dirty 标记、撤下守卫提示、向后端 `document_set_dirty` 镜像 false、清除该路径的崩溃备份（见「崩溃备份与恢复入口」的重写文本）。

**保留且不受本 change 影响**：dirty 守卫（退出 / 切文件 / 切 vault / 关标签）与其「请先保存（Cmd+S）」文案；后端 `DirtyState` 镜像取「任一标签有未保存修改」；`⌘S` 手动保存的语义与错误处置（CAS 冲突、`fs_not_found` 另存、`document_write_unknown`）；崩溃备份目录、位置编码、CAS 基准记录与恢复入口（触发时机改为自有 debounce，见下条 MODIFIED）。

## MODIFIED Requirements

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

### Requirement: 崩溃备份与恢复入口

编辑器 dirty 内容 SHALL 在**它自己的** debounce 窗口到期后写入应用恢复目录——触发不再依附任何保存动作（本 change 之前，备份挂在自动保存的失败分支上：只有自动保存暂停或写失败才落盘）。每次文档内容变化 SHALL 重置该窗口；窗口到期时该文档仍 dirty 即 SHALL 写一份备份，连续输入期间 MUST NOT 写。窗口初始值与实测定档见 change 的 design §3（裁决点 D1）。

备份位置 SHALL 为 `<config_dir>/recovery/<vault-key>/<path-key>`：`vault-key` 由 vault 根唯一确定，`path-key` 由 vault 相对路径可逆编码为单层文件名。备份 MUST NOT 写入 vault 内的文档路径；配置目录不在 vault 内时（常规部署）备份不进枚举结果与 watch 事件流。同一 (vault, 相对路径) SHALL 只保留最新一份备份（覆盖式写入）。每次写入 SHALL 一并记录备份那时的磁盘 revision 作为 CAS 基准（恢复侧对账用）。备份的 debounce 定时器 SHALL 按文档路径键控，MUST NOT 存在跨标签共享的单值（`multi-tabs` 的「保存粒度按标签隔离」）。

**备份的生命周期 SHALL 与 dirty 对齐**（本 change 新增的条款，依据见 change 的 design §5）：内存内容回到「与磁盘基准逐字节相同」时，该路径的备份 SHALL 被清除——手动保存成功、强制覆盖保存、另存为新文件、撤销 / 重做回到已保存基线、重新载入（放弃我的修改）、关闭标签时放弃修改、切换 vault 时放弃修改，全部 SHALL 清除对应路径的备份。MUST NOT 让一份不再对应当前未保存内容的备份在下次启动时弹出恢复提示：备份从「冲突待决时的罕见避险」变成「每次停止输入都会写的常规状态」之后，不清除会退化成「用户明明撤销 / 放弃了修改，下次启动却被追问要不要恢复」的系统性噪音（本 change 之前这条路径已存在，只是备份罕有落盘而少被看见）。

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
