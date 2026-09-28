# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 两条 MODIFIED + 一条 ADDED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md) 的「全类型递归枚举」与
> 「watch 增量事件流」（本 change 起草时的 master 上无活跃 change，无需等待别的归档）。
> 本次修订按 Alex 节点 1 裁决（2026-09-28）：内置规则名单去掉 `build` / `out` / `vendor`；
> 新增「用户规则」档——被 vault 自己的 VCS 忽略声明挡住的条目**行可见、子树按需枚举、不进索引**；
> 并按同日的合并指令把「内置名单」与「用户忽略声明」合成**一份规则表**（同一匹配器，来源决定去向，
> 内置规则不可被用户规则的取反推翻）——`is_ignored` 的名字等值判定随之退役。

## MODIFIED Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime，以及**惰性标记**（见下）。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

枚举 SHALL 由**一份规则表**决定每个条目的去向。规则表由两个来源编译而成，**来源决定去向**：

- **内置规则**（产品硬编码）命中 ⇒ **不可见**：该条目 SHALL NOT 出现在枚举结果里，其整棵子树 MUST NOT 被枚举，也 MUST NOT 进入 watch 事件流与索引。⚠ 裁决点 C 的原始理由（忽略集保护性能合同；一等公民的是文件类型而非 VCS 内部目录与构建产物目录）仍然成立。内置规则 SHALL 为 `.git`、`.DS_Store`、`node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist`（共 16 个名；`build` / `out` / `vendor` 经 Alex 裁决 2026-09-28 明确**不**纳入），外加保存临时文件模式 `.*.lumir-*`。**书写形式 SHALL 为无尾斜杠的名字字面量**（`target`，不是 `target/`）——gitignore 语义下无斜杠模式在任意深度匹配同名的**文件与目录**，因此与既有行为逐条等价（「同名文件与目录一视同仁」这条既有 scenario 保留、不改判；写成 `target/` 会变成只隐藏目录，那是有意的改判，本 change 不做）。
- 否则**用户规则**（vault 自己的 VCS 忽略声明）命中 ⇒ **惰性可见**：条目 SHALL 出现在枚举结果里（惰性标记为 true；类型 / 大小 / mtime 与磁盘一致），其**子孙 MUST NOT 进入本次枚举**。
- 否则 ⇒ 条目出现（惰性标记为 false），并递归其子树。

**规则表的来源与判定顺序**：内置规则 SHALL **先判且命中即定格**——用户规则里的取反（如 `.gitignore` 写 `!target/`）MUST NOT 把内置规则命中的条目放回可见集（理由：内置规则表达的是「按结构不是内容」的产品判断，且它的不可见性同时是性能护栏，允许被一行编辑推翻等于把「打开 vault 会不会卡几秒」交给用户配置；出口是改内置名单走 change、或产品侧另做显式的「显示被忽略项」开关）。用户规则之间 SHALL 按 git 口径决定优先级：深层 `.gitignore` > 浅层 `.gitignore` > `<root>/.git/info/exclude`，同一路径上最深的匹配决定（忽略与取反都在用户规则集内解析）。

**用户规则的来源由配置项给出**：`<config>/config.json` 的 `vault.rule_files`（vault 相对路径列表，默认 `[".gitignore", ".git/info/exclude"]`；缺节 / 缺键 / 配置文件不存在 ⇒ 用默认值）SHALL 决定读哪些规则文件；每一项 SHALL 按「**vault 根的规则文件**」解释（模式相对 vault 根匹配，MUST NOT 被当成「相对该文件所在目录」的规则）。语义：

- **空列表 ⇒ 无用户规则来源**：只剩内置规则（非 git vault 的等价行为）。这是**彻底**的——列表里不含 `.gitignore` 时，递归途中的嵌套 `.gitignore` 同样 SHALL NOT 被读取（嵌套逐层读取是「`.gitignore` 这个来源」的固有语义，MUST NOT 被做成第二个配置面）；列表含 `.gitignore` 时嵌套照常逐层叠加。
- **文件不存在或不是常规文件 ⇒ 静默跳过**：MUST NOT 报错、MUST NOT 产生 warning（`.git/info/exclude` 在非 git vault 里本就不存在，这是常态）。
- **非法项逐项忽略 + 一条人话 config warning**：非字符串 / 绝对路径 / 含 `..` / 空串都算非法（ADR 0002 §5：逐字段校验、非法值人话 warning、不得导致启动失败）；其余项 SHALL 照常生效，MUST NOT 因为一项非法而丢弃整份配置或回退整字段默认值。
- **生效时点**：配置 SHALL 在 vault 装载时读取（MUST NOT 用启动期缓存钉住它），其改动与规则文件内容的改动同为**下一次装载**生效。
- **与内置规则的关系**：该配置只决定「用户规则从哪些文件读」，MUST NOT 影响内置规则——后者恒定生效、不在配置面内、不可被用户规则的取反推翻。

默认列表下的行为与本文此前的写法逐条一致：`<root>/.gitignore` 与递归途中的嵌套 `.gitignore`、以及 `<root>/.git/info/exclude`（仅当 `<root>/.git` 是目录；`.git` 是文件——linked worktree 的 gitlink——时不读，避免把 vault 边界之外的状态读进来）。MUST NOT 读全局 excludes 文件（`core.excludesFile` 在 vault 之外）。匹配 SHALL 按 gitignore 语义（取反 `!`、`/` 锚定、`**`、目录限定、注释与转义、大小写规则），并包含「祖先被排除 ⇒ 子孙全被排除」这一既有语义 ⇒ 用户规则命中的子树内部一切仍是惰性（「按需枚举目录」因此不必在惰性子树里重读 `.gitignore`）。规则表 SHALL 在 vault 装载时编译**一次**（内置规则与用户规则用同一类匹配器解释）；规则文件自身的变更 SHALL 在**下一次装载**生效（本会话不重编；可见集不随规则变化，规则只决定哪些子树被主动枚举，代价与依据见 change 的 design §4.5）。

**惰性标记的语义**：true 表示本条目的子树 / 索引面未枚举——目录的子孙不在本次结果里（展开时经「按需枚举目录」拉取一层），文件不进链接索引与附件索引。前端 SHALL 用它区分「空目录」与「惰性目录」。

被内置规则隐藏与被标为惰性的条目 SHALL NOT 进入由枚举结果建出的**链接索引**与**附件索引**，其中包括用户已经按需展开过的惰性条目——索引的输入 MUST 是磁盘与规则的纯函数，MUST NOT 依赖 UI 交互历史（同一 vault 两次打开的解析结果一致，见 wikilink-resolution）。新建 / 改名的末段名命中**内置规则**时 SHALL 返回 `fs_name_invalid`（沿用既有行为，MUST NOT 因扩集而放松）；命中**用户规则**时 MUST NOT 拒绝（该名字本来就可见、可打开，只是不进索引）。

**已知边界（如实记录）**：内置规则是启发式、不完整（未列名的构建产物目录靠「用户把它写进忽略声明」落进用户规则）；规则不折叠大小写；被内置规则隐藏的条目静默消失（含 wikilink 解析面与附件面），代价与缓解见 change 的 design §3；指向惰性区域的 `[[wikilink]]` 与 `![[img]]` 解析降级（它们不在索引里），且 `wikilink_create` 对它可能造出重复文件——本 change 不改该命令，记为后续候选。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（被忽略的除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** vault 根含 `.git/` 目录、`node_modules/`、`target/`、`dist/`、`test-results/` 与 `.DS_Store` 文件
- **THEN** 枚举结果不含这些条目及其子孙

#### Scenario: 任意深度的内置规则目录被剪枝

- **WHEN** `crates/app/` 下有构建产物目录 `crates/app/target/debug/x`，同目录另有内容文件 `crates/app/notes/a.md`
- **THEN** 枚举结果含 `crates/app/notes/a.md`，不含 `crates/app/target` 及其下的任何条目

#### Scenario: 名字相近的目录照常枚举

- **WHEN** vault 内含 `dist-old/`、`targets/`、`builds/` 目录
- **THEN** 它们与其中的文件正常出现在枚举结果里（内置规则是精确名字字面量，不是前缀或通配匹配）

#### Scenario: 同名文件与目录一视同仁

- **WHEN** vault 内含一个名为 `target` 的无扩展名文件
- **THEN** 它同样不可见（内置规则写成无尾斜杠的名字字面量，按 gitignore 语义在任意深度匹配同名的文件与目录——与既有行为逐条等价，理由见本条正文）

#### Scenario: 惰性目录出行为一行，子孙不进枚举

- **WHEN** vault 根的 `.gitignore` 含 `.local/`，磁盘上 `.local/tutorial.md` 与 `.local/deep/x.md` 都存在
- **THEN** 枚举结果含 `.local`（目录、惰性标记为 true），不含 `.local/tutorial.md` 与 `.local/deep/x.md`；`.local` 之外的内容照常递归枚举

#### Scenario: 惰性条目不进链接索引

- **WHEN** `.gitignore` 声明的目录里有一份 `tutorial.md`，vault 里另有 `index.md` 写着 `[[tutorial]]`
- **THEN** 该链接解析为 `unresolved`（用户规则命中的条目不进链接索引），而用户在文件树里展开该目录仍能看到并打开 `tutorial.md`

#### Scenario: `info/exclude` 与 `.gitignore` 同等生效

- **WHEN** 一个目录只被 `<root>/.git/info/exclude` 声明（不在任何 `.gitignore` 里）
- **THEN** 它的枚举形态与「被 `.gitignore` 声明」一致：出一行、惰性标记为 true、子孙不进枚举（两者同为用户规则，优先级按 git 口径：`.gitignore` 深于 `info/exclude`）

#### Scenario: 全局 excludes 不参与

- **WHEN** 用户的全局 git excludes（`core.excludesFile`）里声明了 vault 内的某个目录
- **THEN** 该目录照常被递归枚举（本 capability MUST NOT 读取 vault 之外的忽略配置）

#### Scenario: 用户规则的取反不推翻内置规则

- **WHEN** vault 根的 `.gitignore` 里既有 `target/` 的取反（如 `!target/`），磁盘上 `target/` 目录存在
- **THEN** `target` 及其子孙仍不出现、仍不被枚举（内置规则先判且命中即定格）；同一份 `.gitignore` 里对**用户规则**的取反（如忽略 `drafts/` 但 `!drafts/keep/`）照常生效

#### Scenario: 默认配置等效于今日行为

- **WHEN** `config.json` 没有 `vault` 节（或没有 `rule_files` 键），vault 根有 `.gitignore`、`.git/info/exclude` 与一个嵌套 `.gitignore`
- **THEN** 三者的规则都生效（与默认列表 `[".gitignore", ".git/info/exclude"]` 一致）：命中的条目按用户规则出惰性行，嵌套目录里的规则同样生效

#### Scenario: 空列表只剩内置规则

- **WHEN** `vault.rule_files` 被设为 `[]`，vault 根的 `.gitignore` 声明 `.local/`，且磁盘上有 `target/`
- **THEN** `.local/` 不再被当成用户规则命中——它是普通目录（照常递归枚举、不再是惰性行）；`target/` 仍因内置规则不可见（配置 MUST NOT 影响内置规则）

#### Scenario: 列表里的文件不存在时静默跳过

- **WHEN** `vault.rule_files` 含 `.git/info/exclude`，而该 vault 不是 git 仓库（文件不存在）
- **THEN** 不报错、不产生 warning，其余来源照常生效

#### Scenario: 非法项逐项忽略且其余项照常生效

- **WHEN** `vault.rule_files` 为 `["/etc/hosts", "../outside", "", ".gitignore"]`（前三项非法）
- **THEN** 前三项被逐项忽略并各给一条人话 config warning，`.gitignore` 照常生效；启动与装载 MUST NOT 因此失败，其余配置字段 MUST NOT 被回退默认值

#### Scenario: 配置改动下次装载生效

- **WHEN** 用户在会话中把 `vault.rule_files` 改成 `[]`（或改写它的内容）
- **THEN** 本次会话的枚举形态不变（规则表已在装载时编译）；下次装载该 vault 后新配置生效

#### Scenario: 规则变更下次装载生效

- **WHEN** 用户在会话中把 `drafts/` 加进 `.gitignore`
- **THEN** 本次会话的枚举形态不变（`drafts/` 仍是被枚举并递归的普通目录，可见性本来就与规则无关）；下次装载该 vault 后它变成惰性行

#### Scenario: vault 根与忽略集同名不影响

- **WHEN** 用户把名为 `target` 的目录作为 vault 打开，其内含 `a.md`
- **THEN** 打开成功，枚举结果含 `a.md`（vault 根自身的名字不参与判据）

### Requirement: watch 增量事件流

vault 打开期间系统 SHALL 监听文件系统变更，并经 `fs:entry_changed` 事件（commands.rs `<domain>:<event>` 命名约定）向 webview 推送增量，事件 payload SHALL 携带变更类型（created / modified / deleted）与相对路径。连续事件 SHALL 在 debounce 窗口内合并推送，窗口初始值 100ms、可随实测调整（⚠ 裁决点 B：逐条增量而非"tree dirty"重扫信号）。watch SHALL 与枚举共用**同一份规则表**（见「全类型递归枚举」：内置规则 / 用户规则，来源决定去向）；该策略 SHALL 覆盖保存临时文件模式——`.` 开头且含 `.lumir-` 的名字（如 `.note.md.lumir-123`），临时文件及其 ghost MUST NOT 进入事件流或文件树，合法点文件（如 `.obsidian/` 配置）不受影响。

事件路径的判据 SHALL 按**路径组件**运行，两个来源分开处理：

- **内置规则**：路径的**任一组件（含最后一段）**命中 ⇒ 丢弃。内置规则是名字的纯函数（不含目录限定模式，判定既不需要 stat 也不需要条目类型），且它命中的条目**在枚举结果里没有行**——因此这一行的增删事件 MUST NOT 投递，否则树里会出现一行**枚举永远不会产生的**幻影行（前端树不做隐藏名过滤），违反「增量收敛后的模型与同一时刻的全量枚举一致」与 file-tree 的「内置规则名字不出现在树里」。
- **用户规则**：任一**祖先组件**（去掉最后一段后的每个前缀）命中、而该目录**尚未被按需枚举**（见「按需枚举目录」的物化登记）⇒ 丢弃；否则投递。**最后一段不参与用户规则判定**——末段是否命中并不改变「有没有行」这一事实（命中 ⇒ 惰性行；不命中 ⇒ 普通行），两种情况下投递都正确；而行的出现 / 消失必须实时（否则外部删掉 `.local` 后树里留一个死行）。祖先组件必定是目录（前缀不可能是文件），故用户规则侧 MUST NOT 依赖 stat（目录限定模式在祖先上可无歧义判定）。

于是被用户规则挡住的目录**内部**的变更只在用户展开过它之后才进入事件流；被内置规则挡住的条目一个事件都不投递（与今日行为一致，代价与理由见 change 的 design §4.4）。vault 关闭或替换时 watch SHALL 停止。

打开中文件被外部变更命中时，webview SHALL 处置：编辑器未 dirty 时自动重载磁盘内容并提示；dirty 时给出 sticky 提示（非 modal）让用户选择「重载（放弃我的修改）」或「保留我的版本」；外部删除时提示内容仍保留在编辑器中。**自身写盘的回声 SHALL 被识别并丢弃**：命中打开中文件的 `modified` 事件到达时，webview SHALL 先读一次磁盘 revision（与 CAS 基准同 sha256 口径）并与该会话已知的基准比对，一致即判为应用自己那次写入的 FSEvents 回声，SHALL NOT 产生任何用户可见处置（不弹「检测到外部修改」、不弹处置浮条、不动缓冲与选区）；只有 revision 不一致（磁盘确有第三方写入）才进入上句的 dirty 分流处置。该判据 MUST NOT 依赖编辑器当前是否 dirty——「保存完成」与「回声到达」之间存在一二百毫秒的窗口（M266 实测记下相隔 177ms 的一对诊断日志，见 change 的 design §4），窗口内用户若已重新键入，dirty 分流会把自己的写入误报成外部修改，而它给出的「重载（放弃我的修改）」会让用户丢掉刚敲进去的内容。判据必须与 dirty 无关，MUST NOT 只靠「保存进行中」这一个瞬时标记抑制。

目录条目**从无到有**（该批次的条目类型为 created 且磁盘上是目录）时，同一批次 SHALL 一并带出该目录下的全部条目（递归、与枚举同一份规则表（两类判据见「全类型递归枚举」）、父先于子），使**增量收敛后的模型与同一时刻的全量枚举一致**。依据：FSEvents（macOS 实际事件源）对目录改名只报目录本身一条路径，子孙一个都不进事件流——M258 真机探针实测批次逐字为 `[deleted:旧路径, created:新路径(dir)]`（`src-tauri/src/fs_io.rs` 的测试 `watch_dir_rename_delivers_full_subtree` 复现），而前端只能按事件流打补丁、读不到磁盘；缺这一层，改名后的目录在前端只能建出一个空节点（永远展不开，直到重启全量重扫）。补的这一层是唯一读得到磁盘现状（ground truth）的一层。带出的子树 SHALL 与枚举同策略：创建出来的目录若命中用户规则，本批次只带出它这一行（惰性标记为 true），MUST NOT 带出子孙；物化登记 SHALL 随之校正——旧路径的登记随 `deleted` 清除，新路径的登记由用户下次展开时重建（登记只影响惰性子树的实时性，不影响可见性）。

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

#### Scenario: 外部新建命中内置规则的名字不产生事件

- **WHEN** 用户在 app 之外于 vault 的某个可见目录里跑一次构建，产生 `target/`、`node_modules/` 这类目录（或直接 `mkdir target`）
- **THEN** 事件流 MUST NOT 出现它们的 created（含末段判定，与今日行为一致）；树里 MUST NOT 出现这些名字的行——树的可见集与同一时刻的全量枚举一致

#### Scenario: 惰性条目自身的行级事件总是投递

- **WHEN** 外部新建一个命中用户规则的目录，或外部删除一个这样的目录（无论它是否被展开过）
- **THEN** 事件流出现对应的 `created` / `deleted`（路径的最后一段不参与规则判定），树里的行随之出现 / 消失

#### Scenario: 自身写盘的回声在 dirty 时也不误报外部修改

- **WHEN** 用户按 `⌘S` 保存成功后，在回声到达前（约一二百毫秒内）继续键入，使编辑器重新 dirty；随后该次保存产生的 `modified` 事件到达
- **THEN** webview 读到磁盘 revision 与会话已知基准一致，判为自身写盘回声：不弹「检测到外部修改」、不出处置浮条、缓冲与选区不动；磁盘内容保持用户保存时的那一份

## ADDED Requirements

### Requirement: 按需枚举目录

系统 SHALL 提供 `fs_scan_dir` command：给定 vault 相对目录路径，返回该目录的**一层**条目（相对路径、类型、大小、mtime、惰性标记），分类口径与「全类型递归枚举」完全同源（内置规则命中即丢弃、用户规则命中出一行且惰性标记为 true、其余出一行且惰性标记为 false）。它 SHALL 只枚举这一层，MUST NOT 递归下钻；被用户规则命中的子目录同样只出一行（「祖先被排除 ⇒ 子孙全被排除」，故其惰性标记恒为 true）。

该命令是文件树展开**惰性目录**时的唯一取数通道：惰性条目的子孙不在装载时的枚举结果里（见「全类型递归枚举」），树 MUST NOT 把它们当作空目录渲染。对非惰性目录调用它同样合法（结果是该目录的一层枚举），但正常路径下树不需要这么做。

- **边界**：目标路径 SHALL 经与所有读取路径同源的 vault 内校验，MUST NOT 为按需枚举放松边界（绝对路径 / `..` / 符号链接逃逸一律拒绝）；目标不存在或不是目录 SHALL 返回人话 `CommandError`。
- **线程**：该 command 的 body SHALL NOT 占 IPC 主线程——展开一个条目数很大的目录时界面 MUST NOT 整段冻结（口径与 vault-workspace「vault 打开」的打开段一致）。
- **物化登记**：成功返回后 SHALL 把该目录登记进当前 vault 的「已按需展开集合」。该集合是「watch 增量事件流」判定惰性子树事件的唯一依据，SHALL 随 vault 装载重建、MUST NOT 跨 vault 串用。
- **不改索引**：本次枚举出的条目 MUST NOT 被补进链接索引或附件索引（见「全类型递归枚举」的确定性条款）。

#### Scenario: 展开惰性目录得到一层

- **WHEN** 对 `.gitignore` 声明的 `.local` 调用 `fs_scan_dir`
- **THEN** 返回 `.local` 的直接子条目（含 `tutorial.md` 与 `deep`，后者惰性标记为 true），不含 `deep` 的子孙

#### Scenario: 对可见目录调用同样合法

- **WHEN** 对一个未被任何规则（内置或用户）命中的目录调用 `fs_scan_dir`
- **THEN** 返回它的一层条目，与装载时枚举里该目录的子条目集合一致（口径同源）

#### Scenario: 越界路径拒绝

- **WHEN** 以 `../outside` 或绝对路径调用 `fs_scan_dir`
- **THEN** 返回 `CommandError`，不读取 vault 之外的任何内容

#### Scenario: 按需枚举不改索引

- **WHEN** 用户展开一个惰性目录，其中有 `tutorial.md`；随后别处文档里的 `[[tutorial]]` 重新解析
- **THEN** 仍为 `unresolved`（展开是 UI 动作，MUST NOT 改变索引）

### Requirement: vault 内路径存在探测

系统 SHALL 提供 `fs_paths_exist` command：收一组 vault 相对路径，返回其中**确实存在**的那些。它存在的理由是「装载时的枚举结果不再是 vault 内文件的全集」——被用户规则命中的惰性条目（含其子树里的文件）在文件树里可见、可打开，却永不进枚举结果，因此任何「这个路径还在不在 vault 里」的判据都不能只看枚举集（消费方：会话恢复的「已删除」判定、阅读位置的存量键修剪）。

- **批量语义**：入参是一组路径，出参是存在的子集——MUST NOT 设计成单路径命令（两个消费点的候选数都不小：会话条目数、阅读位置镜像的键上限 `READING_POSITION_MAX_ENTRIES`；逐条调用会把 N 次 IPC 往返叠在装载路径上）。
- **边界**：每条路径 SHALL 经与读取路径同源的 vault 内校验；越界（绝对路径 / `..` / 符号链接逃逸）与不存在的路径一律**不出现在返回集合里**，MUST NOT 因此报错或放宽边界。
- **只读**：本 command MUST NOT 创建、改写或删除任何文件（ADR 0003 的「不改写源文件」不因它放宽）。
- **用途约束**：它是「枚举集之外的补充判据」，MUST NOT 被用来反向放宽枚举或索引的口径（惰性条目仍然不进索引）。

#### Scenario: 惰性目录里的文件被测为存在

- **WHEN** `.gitignore` 声明的 `.local/` 下有 `tutorial.md`（它不在枚举结果里），调用 `fs_paths_exist([".local/tutorial.md", "missing.md"])`
- **THEN** 返回集合只含前者；调用方（会话恢复 / 阅读位置）据此保留它

#### Scenario: 越界与不存在的路径不出现在返回集合里

- **WHEN** 以 `../../etc/passwd`、绝对路径或不存在的相对路径调用 `fs_paths_exist`
- **THEN** 它们都不出现在返回集合里，且不读取任何 vault 之外的内容、不产生任何写操作
