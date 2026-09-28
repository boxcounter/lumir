# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 两条 MODIFIED + 一条 ADDED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md) 的「全类型递归枚举」与
> 「watch 增量事件流」（本 change 起草时的 master 上无活跃 change，无需等待别的归档）。
> 本次修订按 Alex 节点 1 裁决（2026-09-28）：隐藏类名单去掉 `build` / `out` / `vendor`；
> 新增「惰性类」——被 vault 自己的 VCS 忽略规则挡住的条目**行可见、子树按需枚举、不进索引**。

## MODIFIED Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime，以及**惰性标记**（见下）。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

枚举 SHALL 按两类忽略把条目标成三种去向（隐藏 / 惰性 / 枚举并递归）：

- **隐藏类**（产品硬编码名单）：名字命中名单的条目 SHALL NOT 出现在枚举结果里，其整棵子树 MUST NOT 被枚举。⚠ 裁决点 C 的原始理由（忽略集保护性能合同；一等公民的是文件类型而非 VCS 内部目录与构建产物目录）仍然成立。名单 SHALL 为 `.git`、`.DS_Store`、`node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist`（共 16 个名；`build` / `out` / `vendor` 经 Alex 裁决 2026-09-28 明确**不**纳入）。判据 SHALL 是**名字的纯函数**：逐字节精确匹配（大小写敏感、不含通配与前后缀——`dist-old` 不命中 `dist`，`Target` 不命中 `target`）、在任意深度生效、且与条目类型无关（同名目录连同整棵子树被剪掉，同名文件同样被隐藏）。判据 MUST NOT 依赖条目类型或磁盘 stat——watch 侧只能看到路径组件，依赖类型会让枚举与 watch 分叉。该名单本 change 内仍不可配置。
- **惰性类**（vault 自己的 VCS 忽略规则命中）：条目 SHALL **出现在枚举结果里**（惰性标记为 true；类型 / 大小 / mtime 与磁盘一致），但其**子孙 MUST NOT 进入本次枚举**。
- **其余**：条目出现（惰性标记为 false），并递归其子树。

**VCS 忽略规则的来源与语义**：`<root>/.gitignore` 与递归途中的嵌套 `.gitignore`、以及 `<root>/.git/info/exclude`（仅当 `<root>/.git` 是目录；`.git` 是文件——linked worktree 的 gitlink——时不读，避免把 vault 边界之外的状态读进来）。MUST NOT 读全局 excludes 文件（`core.excludesFile` 在 vault 之外）。匹配 SHALL 按 gitignore 语义（取反 `!`、`/` 锚定、`**`、目录限定、注释与转义、大小写规则），并包含「祖先被排除 ⇒ 子孙全被排除」这一既有语义 ⇒ 惰性子树内部的一切仍是惰性（「按需枚举目录」因此不必在惰性子树里重读 `.gitignore`）。规则 SHALL 在 vault 装载时读取并编译**一次**；规则文件自身的变更 SHALL 在**下一次装载**生效（本会话不重编；可见集不随规则变化，规则只决定哪些子树被主动枚举，代价与依据见 change 的 design §4.5）。

**惰性标记的语义**：true 表示本条目的子树 / 索引面未枚举——目录的子孙不在本次结果里（展开时经「按需枚举目录」拉取一层），文件不进链接索引与附件索引。前端 SHALL 用它区分「空目录」与「惰性目录」。

被隐藏与被标为惰性的条目 SHALL NOT 进入由枚举结果建出的**链接索引**与**附件索引**，其中包括用户已经按需展开过的惰性条目——索引的输入 MUST 是磁盘与规则的纯函数，MUST NOT 依赖 UI 交互历史（同一 vault 两次打开的解析结果一致，见 wikilink-resolution）。新建 / 改名的末段名命中**隐藏类**名单时 SHALL 返回 `fs_name_invalid`（沿用既有行为，MUST NOT 因扩集而放松）；命中**惰性类**规则时 MUST NOT 拒绝（该名字本来就可见、可打开，只是不进索引）。

**已知边界（如实记录）**：隐藏类名单是启发式、不完整（未列名的构建产物目录靠「用户把它写进忽略声明」落进惰性类）；名单不折叠大小写；被隐藏的条目静默消失（含 wikilink 解析面与附件面），代价与缓解见 change 的 design §3；指向惰性区域的 `[[wikilink]]` 与 `![[img]]` 解析降级（它们不在索引里），且 `wikilink_create` 对它可能造出重复文件——本 change 不改该命令，记为后续候选。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（被忽略的除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** vault 根含 `.git/` 目录、`node_modules/`、`target/`、`dist/`、`test-results/` 与 `.DS_Store` 文件
- **THEN** 枚举结果不含这些条目及其子孙

#### Scenario: 任意深度的隐藏类目录被剪枝

- **WHEN** `crates/app/` 下有构建产物目录 `crates/app/target/debug/x`，同目录另有内容文件 `crates/app/notes/a.md`
- **THEN** 枚举结果含 `crates/app/notes/a.md`，不含 `crates/app/target` 及其下的任何条目

#### Scenario: 名字相近的目录照常枚举

- **WHEN** vault 内含 `dist-old/`、`targets/`、`builds/` 目录
- **THEN** 它们与其中的文件正常出现在枚举结果里（隐藏类判据是精确名字，不是前缀或通配匹配）

#### Scenario: 同名文件与目录一视同仁

- **WHEN** vault 内含一个名为 `target` 的无扩展名文件
- **THEN** 它同样被隐藏（判据与条目类型无关，理由见本条正文）

#### Scenario: 惰性目录出行为一行，子孙不进枚举

- **WHEN** vault 根的 `.gitignore` 含 `.local/`，磁盘上 `.local/tutorial.md` 与 `.local/deep/x.md` 都存在
- **THEN** 枚举结果含 `.local`（目录、惰性标记为 true），不含 `.local/tutorial.md` 与 `.local/deep/x.md`；`.local` 之外的内容照常递归枚举

#### Scenario: 惰性条目不进链接索引

- **WHEN** `.gitignore` 声明的目录里有一份 `tutorial.md`，vault 里另有 `index.md` 写着 `[[tutorial]]`
- **THEN** 该链接解析为 `unresolved`（惰性条目不进链接索引），而用户在文件树里展开该目录仍能看到并打开 `tutorial.md`

#### Scenario: `info/exclude` 与 `.gitignore` 同等生效

- **WHEN** 一个目录只被 `<root>/.git/info/exclude` 声明（不在任何 `.gitignore` 里）
- **THEN** 它的枚举形态与「被 `.gitignore` 声明」一致：出一行、惰性标记为 true、子孙不进枚举

#### Scenario: 全局 excludes 不参与

- **WHEN** 用户的全局 git excludes（`core.excludesFile`）里声明了 vault 内的某个目录
- **THEN** 该目录照常被递归枚举（本 capability MUST NOT 读取 vault 之外的忽略配置）

#### Scenario: 规则变更下次装载生效

- **WHEN** 用户在会话中把 `drafts/` 加进 `.gitignore`
- **THEN** 本次会话的枚举形态不变（`drafts/` 仍是被枚举并递归的普通目录，可见性本来就与规则无关）；下次装载该 vault 后它变成惰性行

#### Scenario: vault 根与忽略集同名不影响

- **WHEN** 用户把名为 `target` 的目录作为 vault 打开，其内含 `a.md`
- **THEN** 打开成功，枚举结果含 `a.md`（vault 根自身的名字不参与判据）

### Requirement: watch 增量事件流

vault 打开期间系统 SHALL 监听文件系统变更，并经 `fs:entry_changed` 事件（commands.rs `<domain>:<event>` 命名约定）向 webview 推送增量，事件 payload SHALL 携带变更类型（created / modified / deleted）与相对路径。连续事件 SHALL 在 debounce 窗口内合并推送，窗口初始值 100ms、可随实测调整（⚠ 裁决点 B：逐条增量而非"tree dirty"重扫信号）。watch SHALL 与枚举共用**同一份忽略策略**（见「全类型递归枚举」的两类判据）；该策略 SHALL 覆盖保存临时文件模式——`.` 开头且含 `.lumir-` 的名字（如 `.note.md.lumir-123`），临时文件及其 ghost MUST NOT 进入事件流或文件树，合法点文件（如 `.obsidian/` 配置）不受影响。

事件路径的判据 SHALL 按**路径组件**运行，MUST NOT 依赖条目类型或磁盘 stat（被删条目 stat 不到）：路径的任一**祖先组件**（去掉最后一段后的每个前缀）命中隐藏类 ⇒ 丢弃；任一祖先组件命中 VCS 忽略规则而该目录**尚未被按需枚举**（见「按需枚举目录」的物化登记）⇒ 丢弃；否则投递。路径的**最后一段不参与规则判定**——条目自身的行级事件（新建 / 删除 / 改名）SHALL 一律投递，使树里的行随磁盘实时增删。于是被忽略目录**内部**的变更只在用户展开过它之后才进入事件流（代价与理由见 change 的 design §4.4）。vault 关闭或替换时 watch SHALL 停止。

打开中文件被外部变更命中时，webview SHALL 处置：编辑器未 dirty 时自动重载磁盘内容并提示；dirty 时给出 sticky 提示（非 modal）让用户选择「重载（放弃我的修改）」或「保留我的版本」；外部删除时提示内容仍保留在编辑器中。**自身写盘的回声 SHALL 被识别并丢弃**：命中打开中文件的 `modified` 事件到达时，webview SHALL 先读一次磁盘 revision（与 CAS 基准同 sha256 口径）并与该会话已知的基准比对，一致即判为应用自己那次写入的 FSEvents 回声，SHALL NOT 产生任何用户可见处置（不弹「检测到外部修改」、不弹处置浮条、不动缓冲与选区）；只有 revision 不一致（磁盘确有第三方写入）才进入上句的 dirty 分流处置。该判据 MUST NOT 依赖编辑器当前是否 dirty——「保存完成」与「回声到达」之间存在一二百毫秒的窗口（M266 实测记下相隔 177ms 的一对诊断日志，见 change 的 design §4），窗口内用户若已重新键入，dirty 分流会把自己的写入误报成外部修改，而它给出的「重载（放弃我的修改）」会让用户丢掉刚敲进去的内容。判据必须与 dirty 无关，MUST NOT 只靠「保存进行中」这一个瞬时标记抑制。

目录条目**从无到有**（该批次的条目类型为 created 且磁盘上是目录）时，同一批次 SHALL 一并带出该目录下的全部条目（递归、与枚举同策略（两类判据见「全类型递归枚举」）、父先于子），使**增量收敛后的模型与同一时刻的全量枚举一致**。依据：FSEvents（macOS 实际事件源）对目录改名只报目录本身一条路径，子孙一个都不进事件流——M258 真机探针实测批次逐字为 `[deleted:旧路径, created:新路径(dir)]`（`src-tauri/src/fs_io.rs` 的测试 `watch_dir_rename_delivers_full_subtree` 复现），而前端只能按事件流打补丁、读不到磁盘；缺这一层，改名后的目录在前端只能建出一个空节点（永远展不开，直到重启全量重扫）。补的这一层是唯一读得到磁盘现状（ground truth）的一层。带出的子树 SHALL 与枚举同策略：创建出来的目录若命中 VCS 忽略规则，本批次只带出它这一行（惰性标记为 true），MUST NOT 带出子孙；物化登记 SHALL 随之校正——旧路径的登记随 `deleted` 清除，新路径的登记由用户下次展开时重建（登记只影响惰性子树的实时性，不影响可见性）。

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

#### Scenario: 惰性子树的变更按物化状态投递

- **WHEN** `.gitignore` 声明的 `.local/` 尚未被用户展开过，外部在其中新建 `a.md`；随后用户展开 `.local`，外部再在其中新建 `b.md`
- **THEN** 前一次变更 MUST NOT 出现在事件流里；后一次（`created:.local/b.md`）SHALL 出现——物化登记是惰性子树实时性的唯一开关

#### Scenario: 惰性条目自身的行级事件总是投递

- **WHEN** 外部新建一个命中 VCS 忽略规则的目录，或外部删除一个这样的目录（无论它是否被展开过）
- **THEN** 事件流出现对应的 `created` / `deleted`（路径的最后一段不参与规则判定），树里的行随之出现 / 消失

#### Scenario: 自身写盘的回声在 dirty 时也不误报外部修改

- **WHEN** 用户按 `⌘S` 保存成功后，在回声到达前（约一二百毫秒内）继续键入，使编辑器重新 dirty；随后该次保存产生的 `modified` 事件到达
- **THEN** webview 读到磁盘 revision 与会话已知基准一致，判为自身写盘回声：不弹「检测到外部修改」、不出处置浮条、缓冲与选区不动；磁盘内容保持用户保存时的那一份

## ADDED Requirements

### Requirement: 按需枚举目录

系统 SHALL 提供 `fs_scan_dir` command：给定 vault 相对目录路径，返回该目录的**一层**条目（相对路径、类型、大小、mtime、惰性标记），分类口径与「全类型递归枚举」完全同源（隐藏类丢弃、VCS 规则命中出一行且惰性标记为 true、其余出一行且惰性标记为 false）。它 SHALL 只枚举这一层，MUST NOT 递归下钻；被规则命中的子目录同样只出一行（「祖先被排除 ⇒ 子孙全被排除」，故其惰性标记恒为 true）。

该命令是文件树展开**惰性目录**时的唯一取数通道：惰性条目的子孙不在装载时的枚举结果里（见「全类型递归枚举」），树 MUST NOT 把它们当作空目录渲染。对非惰性目录调用它同样合法（结果是该目录的一层枚举），但正常路径下树不需要这么做。

- **边界**：目标路径 SHALL 经与所有读取路径同源的 vault 内校验，MUST NOT 为按需枚举放松边界（绝对路径 / `..` / 符号链接逃逸一律拒绝）；目标不存在或不是目录 SHALL 返回人话 `CommandError`。
- **线程**：该 command 的 body SHALL NOT 占 IPC 主线程——展开一个条目数很大的目录时界面 MUST NOT 整段冻结（口径与 vault-workspace「vault 打开」的打开段一致）。
- **物化登记**：成功返回后 SHALL 把该目录登记进当前 vault 的「已按需展开集合」。该集合是「watch 增量事件流」判定惰性子树事件的唯一依据，SHALL 随 vault 装载重建、MUST NOT 跨 vault 串用。
- **不改索引**：本次枚举出的条目 MUST NOT 被补进链接索引或附件索引（见「全类型递归枚举」的确定性条款）。

#### Scenario: 展开惰性目录得到一层

- **WHEN** 对 `.gitignore` 声明的 `.local` 调用 `fs_scan_dir`
- **THEN** 返回 `.local` 的直接子条目（含 `tutorial.md` 与 `deep`，后者惰性标记为 true），不含 `deep` 的子孙

#### Scenario: 对可见目录调用同样合法

- **WHEN** 对一个未被任何规则命中的目录调用 `fs_scan_dir`
- **THEN** 返回它的一层条目，与装载时枚举里该目录的子条目集合一致（口径同源）

#### Scenario: 越界路径拒绝

- **WHEN** 以 `../outside` 或绝对路径调用 `fs_scan_dir`
- **THEN** 返回 `CommandError`，不读取 vault 之外的任何内容

#### Scenario: 按需枚举不改索引

- **WHEN** 用户展开一个惰性目录，其中有 `tutorial.md`；随后别处文档里的 `[[tutorial]]` 重新解析
- **THEN** 仍为 `unresolved`（展开是 UI 动作，MUST NOT 改变索引）
