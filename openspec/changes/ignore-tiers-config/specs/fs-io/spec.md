# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 四条 MODIFIED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md) 的「全类型递归枚举」「watch 增量事件流」
> 「按需枚举目录」「文件级操作（删除 / 重命名 / 新建 / 定位）」。本次修订把忽略规则表的**名字来源**
> 从代码常量改为「配置默认值 + 用户覆盖」：`never_show`（不显示）与 `lazy`（惰性可见）两档的名字由
> `config.json` 的 `[vault]` 表给出，缺省即代码内置默认（2 + 14 = 既有 16 名）；保存临时文件模式恒定
> 硬编码。判定顺序从「内置 → 用户规则 → 可见」变为「never_show → lazy → 用户规则 → 可见」，用户规则的
> 取反仍不能推翻前两档（对 change `vault-open-ignore-set` §2.6 条款的显式修订）。
>
> **待裁决条款**：`.git` 恒护栏一节与对应 scenario 按提案裁决点 1 的推荐（方案 A：加护栏）起草；
> 若 Alex 裁方案 B（不加），实现前删除该段与 scenario，其余条款不变。

## MODIFIED Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime，以及**惰性标记**（见下）。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

枚举 SHALL 由**一份规则表**决定每个条目的去向。规则表按**固定优先级**由四个来源解释：

- **不显示档（`never_show`）**：名字由配置项 `vault.never_show` 给出（语义见下），并**恒定**含保存临时文件模式两条：`.lumir-*`（名字以 `.lumir-` 开头）与 `.*.lumir-*`（首个 `.` 之后另有内容再出现 `.lumir-`，覆盖 `.{目标名}.lumir-{pid}`）。两条合起来的匹配集合 SHALL 等于既有判据「`.` 开头且含 `.lumir-`」，MUST NOT 留下差异。命中 ⇒ **不可见**：该条目 SHALL NOT 出现在枚举结果里，其整棵子树 MUST NOT 被枚举，也 MUST NOT 进入 watch 事件流与索引。
- 否则**惰性档（`lazy`）**命中 ⇒ **惰性可见**：条目 SHALL 出现在枚举结果里（惰性标记为 true；类型 / 大小 / mtime 与磁盘一致），其**子孙 MUST NOT 进入本次枚举**。
- 否则**用户规则**（vault 自己的 VCS 忽略声明）命中 ⇒ **惰性可见**（同上）。
- 否则 ⇒ 条目出现（惰性标记为 false），并递归其子树。

**判定顺序与优先级**：`never_show` SHALL 先判、命中即定格；`lazy` 次判、命中即定格；用户规则只在两者都未命中时参与。用户规则里的取反（如 `.gitignore` 写 `!target/`）MUST NOT 把 `never_show` 或 `lazy` 档命中的条目放回可见集、也 MUST NOT 改变其去向（理由：两档表达的是产品对「按结构不是内容」名字的判断，且它们的不可见 / 不进索引同时是性能与索引确定性的护栏，允许被一行编辑推翻等于把「打开 vault 会不会卡几秒」「链接解析是否确定」交给用户配置；出口是改配置、或产品侧另做显式的「显示被忽略项」开关）。用户规则之间 SHALL 按 git 口径决定优先级：深层 `.gitignore` > 浅层 `.gitignore` > `<root>/.git/info/exclude`，同一路径上最深的匹配决定（忽略与取反都在用户规则集内解析）。

**两档名字由配置给出**：`<config>/config.json` 的 `vault.never_show` 与 `vault.lazy`（两个**名字数组**）SHALL 决定两档的名单；缺键 / 缺节 / 配置文件不存在 ⇒ 该档取**代码内置默认**。语义：

- **缺省即默认**：某个键缺席 ⇒ 该档用代码内置默认（`never_show` = `[".git", ".DS_Store"]`，`lazy` = `["node_modules", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".cache", ".pnpm-store", ".tox", ".gradle", "test-results", "perf-results", "target", "dist"]`）；键存在（含 `[]`）⇒ 该档整体按配置解释。两个键各自独立：只写一个时另一个仍取默认。MUST NOT 在安装时把默认值快照写入配置文件。
- **两个键都不含某名字 ⇒ 该名字走用户规则 / 完全可见**：这是「第三档」的唯一表达方式，MUST NOT 为此新增第三个键或新的去向枚举值。
- **只接受名字，不接受模式**：每一项 MUST 是单个名字——不含 `/`、不是 `.` / `..`、不含 gitignore 元字符（`*` `?` `[` `]` `!` `#` `\`）、首尾无空白。写模式（如 `*.log`）MUST 被逐项忽略并给出人话 warning，MUST NOT 被当成模式解释。
- **逐项校验、非法项只丢自己**：非字符串 / 空串 / 上述非法形态都逐项忽略并各给一条人话 config warning；其余项 SHALL 照常生效，MUST NOT 因为一项非法而丢弃整份配置或回退整字段默认值（ADR 0002 §5）。整个字段给错类型（如 `"never_show": ".git"`）仍是既有解析模型的整文件回落，MUST NOT 发明逐字段类型容忍。
- **跨档重名**：同一个名字同时出现在两个键里 ⇒ 按 `never_show` 生效，并给一条人话 warning。
- **临时文件模式不在配置面内**：`.lumir-*` / `.*.lumir-*` 恒定硬编码；即使 `never_show` 为 `[]`，它们仍被挡下（数据损坏面不交给用户配置）。
- **生效时点**：配置 SHALL 在 vault 装载时读取（MUST NOT 用启动期缓存钉住它）；其改动与规则文件内容的改动同为**下一次装载**生效。

**与用户规则来源的关系**：`vault.rule_files`（默认 `[".gitignore", ".git/info/exclude"]`）的语义不变——它只决定用户规则从哪些文件读，MUST NOT 影响两档名字。空列表 = 无用户规则来源（彻底：不含 `.gitignore` 时嵌套 `.gitignore` 同样不读）；文件不存在静默跳过；非法项逐项忽略 + warning；`<root>/.git/info/exclude` 仅当 `<root>/.git` 是目录时读取（是文件——linked worktree 的 gitlink——时不读，避免把 vault 边界之外的状态读进来）。MUST NOT 读全局 excludes 文件（`core.excludesFile` 在 vault 之外）。匹配 SHALL 按 gitignore 语义（取反 `!`、`/` 锚定、`**`、目录限定、注释与转义、大小写规则），并包含「祖先被排除 ⇒ 子孙全被排除」这一既有语义。规则表 SHALL 在 vault 装载时编译**一次**；规则文件自身的变更 SHALL 在**下一次装载**生效。

**名字的书写形式**：三档（两档配置名字与用户规则的内置匹配方式）中，名字 SHALL 按**无尾斜杠名字字面量**匹配（`target`，不是 `target/`）：gitignore 语义下无斜杠模式在任意深度匹配同名的**文件与目录**（「同名文件与目录一视同仁」）。配置里的名字经上述校验不含元字符，因此其语义就是名字等值 + 祖先传递。

**惰性标记的语义**：true 表示本条目的子树 / 索引面未枚举——目录的子孙不在本次结果里（展开时经「按需枚举目录」拉取一层），文件不进链接索引与附件索引。前端 SHALL 用它区分「空目录」与「惰性目录」。

被 `never_show` 档隐藏与被标为惰性的条目（无论惰性来自哪一档）SHALL NOT 进入由枚举结果建出的**链接索引**与**附件索引**，其中包括用户已经按需展开过的惰性条目——索引的输入 MUST 是磁盘与规则的纯函数，MUST NOT 依赖 UI 交互历史（同一 vault 两次打开的解析结果一致，见 wikilink-resolution）。新建 / 改名的末段名命中 **`never_show` 档（含临时文件模式）** 时 SHALL 返回 `fs_name_invalid`（沿用既有行为）；命中 **`lazy` 档或用户规则** 时 MUST NOT 拒绝（该名字本来就可见、可打开，只是不进索引）。

**诊断计数**：全量枚举收口处 SHALL 记录被 **`never_show` 档**（含临时文件模式）剪掉的条目数，作为既有 `vault_scan_ignored` 事件的唯一口径；惰性条目 MUST NOT 计入（它们有行、看得见，不属于「文件不见了」的诊断对象）。计数 MUST NOT 包含路径或名字原文。

**已知边界（如实记录）**：两档默认名单是启发式、不完整（未列名的构建产物目录靠「用户把它写进配置或忽略声明」处理）；名字匹配不折叠大小写；配置不支持模式；被 `never_show` 档隐藏的条目静默消失（含 wikilink 解析面与附件面）；指向惰性区域的 `[[wikilink]]` 与 `![[img]]` 解析降级（它们不在索引里），且 `wikilink_create` 对它可能造出重复文件——本 change 不改该命令，记为后续候选。

#### Scenario: 混合类型 vault 全量列出

- **WHEN** vault 内含 md、代码文件、图片、PDF、无扩展名文本与嵌套目录
- **THEN** 枚举结果包含全部条目（被忽略的除外），不只含 Markdown

#### Scenario: 忽略集生效

- **WHEN** 缺省配置下 vault 根含 `.git/` 目录、`.DS_Store` 文件、`node_modules/`、`target/`、`dist/`、`test-results/`
- **THEN** 枚举结果不含 `.git` 与 `.DS_Store` 及其子孙；含 `node_modules`、`target`、`dist`、`test-results` 各**一行**（目录、惰性标记为 true），不递归其子孙

#### Scenario: 任意深度的内置规则目录被剪枝

- **WHEN** `crates/app/` 下有嵌套仓库目录 `.git/`，同目录另有内容文件 `crates/app/notes/a.md`
- **THEN** 枚举结果含 `crates/app/notes/a.md`，不含 `crates/app/.git` 及其下的任何条目

#### Scenario: 名字相近的目录照常枚举

- **WHEN** vault 内含 `dist-old/`、`targets/`、`builds/` 目录
- **THEN** 它们与其中的文件正常出现在枚举结果里（两档名字是字面量等值，不是前缀或通配匹配）

#### Scenario: 同名文件与目录一视同仁

- **WHEN** vault 内含一个名为 `.DS_Store` 的无扩展名文件与一个名为 `target` 的无扩展名文件
- **THEN** `.DS_Store` 不可见；`target` 文件同样是一行惰性条目（名字匹配不区分文件与目录——与既有行为逐条等价）

#### Scenario: 惰性目录出行为一行，子孙不进枚举

- **WHEN** 缺省配置下 vault 根有 `node_modules/express/index.js`
- **THEN** 枚举结果含 `node_modules`（目录、惰性标记为 true），不含 `node_modules/express` 与 `node_modules/express/index.js`；`node_modules` 之外的内容照常递归枚举

#### Scenario: 惰性条目不进链接索引

- **WHEN** 缺省配置下 `target/` 里有一份 `notes.md`，vault 里另有 `index.md` 写着 `[[notes]]`
- **THEN** 该链接解析为 `unresolved`（惰性档命中的条目不进链接索引），而用户在文件树里展开 `target` 仍能看到并打开 `notes.md`

#### Scenario: `info/exclude` 与 `.gitignore` 同等生效

- **WHEN** 一个目录只被 `<root>/.git/info/exclude` 声明（不在任何 `.gitignore` 里）
- **THEN** 它的枚举形态与「被 `.gitignore` 声明」一致：出一行、惰性标记为 true、子孙不进枚举（两者同为用户规则，优先级按 git 口径：`.gitignore` 深于 `info/exclude`）

#### Scenario: 全局 excludes 不参与

- **WHEN** 用户的全局 git excludes（`core.excludesFile`）里声明了 vault 内的某个目录
- **THEN** 该目录照常被递归枚举（本 capability MUST NOT 读取 vault 之外的忽略配置）

#### Scenario: 用户规则的取反不推翻内置规则

- **WHEN** `.gitignore` 里写了 `!target/` 与 `!.git/`，磁盘上 `target/` 与 `.git/` 都存在
- **THEN** `target` 仍是一行惰性条目（不因取反变成完全可见）、`.git` 及其子孙仍不可见；同一份 `.gitignore` 里对**用户规则**的取反（如忽略 `drafts/` 但 `!drafts/keep/`）照常生效

#### Scenario: 默认配置等效于今日行为

- **WHEN** `config.json` 没有 `[vault]` 节（缺键 / 缺节），vault 根有 `.gitignore`、`.git/info/exclude` 与一个嵌套 `.gitignore`
- **THEN** 用户规则的三个来源都生效（与默认 `rule_files` 一致）；两档名字都取代码内置默认，16 名仍全部被规则表覆盖、无一漏网——其中 `.git` / `.DS_Store` 与今日一致（不可见），其余 14 名的去向由「不可见」改为「惰性可见」（本 change 的有意行为变化，见 proposal；scenario 名按 archive 规则保留原文）

#### Scenario: 空列表只剩内置规则

- **WHEN** `vault.rule_files` 被设为 `[]`，vault 根的 `.gitignore` 声明 `.local/`，且磁盘上有 `target/`
- **THEN** `.local/` 不再被当成用户规则命中——它是普通目录（照常递归枚举、不再是惰性行）；`target/` 仍按惰性档出一行惰性条目（配置 MUST NOT 影响两档名字）；不读任何用户规则文件，嵌套 `.gitignore` 同样不读

#### Scenario: 列表里的文件不存在时静默跳过

- **WHEN** `vault.rule_files` 含 `.git/info/exclude`，而该 vault 不是 git 仓库（文件不存在）
- **THEN** 不报错、不产生 warning，其余来源照常生效

#### Scenario: 规则变更下次装载生效

- **WHEN** 用户在会话中把 `drafts/` 加进 `.gitignore`
- **THEN** 本次会话的枚举形态不变（`drafts/` 仍是被枚举并递归的普通目录）；下次装载该 vault 后它变成惰性行

#### Scenario: 用户规则命中的条目仍是惰性可见

- **WHEN** vault 根的 `.gitignore` 含 `.local/`，磁盘上 `.local/tutorial.md` 存在
- **THEN** 枚举结果含 `.local`（惰性标记为 true），不含 `.local/tutorial.md`

#### Scenario: 配置把某个名字移出两档后完全可见

- **WHEN** 用户把 `dist` 从默认的 `lazy` 键里删除（两个键都不含它），磁盘上有 `dist/app.js`
- **THEN** `dist` 与 `dist/app.js` 照常递归枚举、惰性标记为 false、进入索引（这是「第三档」的表达方式）

#### Scenario: 配置把某个名字加进不显示档

- **WHEN** 用户把 `scratch` 写进 `vault.never_show`，磁盘上有 `scratch/a.md`
- **THEN** `scratch` 及其子孙不出现在枚举结果里；且新建 / 改名为 `scratch` 返回 `fs_name_invalid`

#### Scenario: 空列表表示该档没有名字

- **WHEN** `vault.never_show` 被设为 `[]`，磁盘上有 `.git/` 与一个 `.note.md.lumir-123` 临时文件
- **THEN** `.git` 不再被该档隐藏（按用户规则 / 可见处理）；临时文件仍不出现在枚举结果里（模式恒定硬编码）

#### Scenario: 同一名字同时出现在两档

- **WHEN** `vault.never_show` 含 `node_modules`，`vault.lazy` 也含 `node_modules`
- **THEN** `node_modules` 按不显示档生效（不可见），并产生一条人话 config warning

#### Scenario: 非法项逐项忽略且其余项照常生效

- **WHEN** `vault.never_show` 为 `["*.log", "a/b", "", 42, ".git"]`
- **THEN** 前四项被逐项忽略并各给一条人话 config warning，`.git` 照常生效；启动与装载 MUST NOT 因此失败，其余配置字段 MUST NOT 被回退默认值

#### Scenario: 临时文件模式不可配置

- **WHEN** 用户把 `vault.never_show` 设为 `[]` 并在 vault 里留下 `.lumir-notes.md` 与 `..lumir-1`
- **THEN** 它们仍不出现在枚举结果里，也不进入 watch 事件流（模式不在配置面内）

#### Scenario: 配置改动下次装载生效

- **WHEN** 用户在会话中把 `target` 从 `lazy` 挪进 `never_show`
- **THEN** 本次会话的枚举形态不变；下次装载该 vault 后 `target` 变成不可见

#### Scenario: 惰性档名字可以新建与改名

- **WHEN** 用户在树里新建文件 `target`（或把某文件改名为 `node_modules`）
- **THEN** 创建 / 改名成功，得到一行惰性条目（该名字可见、可打开，只是不进索引）；命中用户规则的名字同样允许

#### Scenario: 不显示档名字被拒绝

- **WHEN** 用户新建 / 改名的末段名为 `.git` 或 `.DS_Store`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

#### Scenario: `.git` 恒护栏（待裁决点 1）

- **WHEN** 用户把 `.git` 配置成惰性可见，然后在树里对 `.git` 行发起删除、重命名或拖拽移动；或把某条目的名字改成 `.git`
- **THEN** 操作被拒绝并给出行内 / toast 人话原因（`fs_name_invalid`），磁盘不变；展开 `.git` 与打开其中文件仍照常可用

#### Scenario: vault 根与忽略集同名不影响

- **WHEN** 用户把名为 `target` 的目录作为 vault 打开，其内含 `a.md`
- **THEN** 打开成功，枚举结果含 `a.md`（vault 根自身的名字不参与判据）

### Requirement: watch 增量事件流

vault 打开期间系统 SHALL 监听文件系统变更，并经 `fs:entry_changed` 事件（commands.rs `<domain>:<event>` 命名约定）向 webview 推送增量，事件 payload SHALL 携带变更类型（created / modified / deleted）、相对路径，以及**惰性标记**（`lazy`：该条目按当前规则表的去向——惰性档或用户规则命中 ⇒ true。created / modified 时条目类型由 payload 的 `entry_kind` 已知，可精确判定；deleted 时该字段不参与下游决策，见下）。连续事件 SHALL 在 debounce 窗口内合并推送，窗口初始值 100ms、可随实测调整（⚠ 裁决点 B：逐条增量而非"tree dirty"重扫信号）。watch SHALL 与枚举共用**同一份规则表**（见「全类型递归枚举」：不显示档 / 惰性档 / 用户规则，优先级固定）；该策略 SHALL 覆盖保存临时文件模式——`.` 开头且含 `.lumir-` 的名字（如 `.note.md.lumir-123`），临时文件及其 ghost MUST NOT 进入事件流或文件树，合法点文件（如 `.obsidian/` 配置）不受影响。

事件路径的判据 SHALL 按**路径组件**运行，按档分开处理：

- **不显示档**（含临时文件模式）：路径的**任一组件（含最后一段）**命中 ⇒ 丢弃。该档名字是名字的纯函数（不含目录限定模式，判定既不需要 stat 也不需要条目类型），且它命中的条目**在枚举结果里没有行**——因此这一行的增删事件 MUST NOT 投递，否则树里会出现一行**枚举永远不会产生的**幻影行（前端树不做隐藏名过滤），违反「增量收敛后的模型与同一时刻的全量枚举一致」与 file-tree 的「`never_show` 档名字不出现在树里」。
- **惰性档**：任一**祖先组件**（去掉最后一段后的每个前缀）命中、而该目录**尚未被按需枚举**（见「按需枚举目录」的物化登记）⇒ 丢弃；否则投递。**最后一段不参与「投不投递」的判定**——末段命中惰性档只意味着这一行是惰性行（枚举同样会给出这一行），投递正确；而行的出现 / 消失必须实时（否则外部删掉 `target` 后树里留一个死行）。
- **用户规则**：与惰性档同形（祖先命中 + 未物化 ⇒ 丢弃；最后一段一律投递）。祖先组件必定是目录（前缀不可能是文件），故这两档 MUST NOT 依赖 stat。

于是被惰性档 / 用户规则挡住的目录**内部**的变更只在用户展开过它之后才进入事件流；被不显示档挡住的条目一个事件都不投递。惰性档目录被外部新建时，它**自身**的 created SHALL 投递（payload `lazy: true`），与枚举结果一致；其子孙 MUST NOT 被补出（见下条的子树带出策略）。

**投递的事件 MUST NOT 让惰性条目进入索引**（依据是「索引 = 磁盘 + 规则的纯函数」，见「全类型递归枚举」）：惰性档或用户规则命中的条目，其事件虽然要投递（树的可见性依赖它），但两处索引的增量更新 SHALL 消费 payload 的惰性标记并跳过它——链接索引（`apply_fs_changes`）：created / modified 且惰性 ⇒ MUST NOT upsert；附件索引（前端）：created / modified（即**非 deleted**——既有分支对这两者同路）且惰性 ⇒ MUST NOT push。**deleted 方向 SHALL 无条件移除**（幂等：本来不在索引里就是空操作），因此该方向 MUST NOT 消费惰性标记——这也绕开了「被删路径 stat 不到、目录限定模式判不准类型」的歧义。vault 关闭或替换时 watch SHALL 停止。

打开中文件被外部变更命中时，webview SHALL 处置：编辑器未 dirty 时自动重载磁盘内容并提示；dirty 时给出 sticky 提示（非 modal）让用户选择「重载（放弃我的修改）」或「保留我的版本」；外部删除时提示内容仍保留在编辑器中。**自身写盘的回声 SHALL 被识别并丢弃**：命中打开中文件的 `modified` 事件到达时，webview SHALL 先读一次磁盘 revision（与 CAS 基准同 sha256 口径）并与该会话已知的基准比对，一致即判为应用自己那次写入的 FSEvents 回声，SHALL NOT 产生任何用户可见处置（不弹「检测到外部修改」、不弹处置浮条、不动缓冲与选区）；只有 revision 不一致（磁盘确有第三方写入）才进入上句的 dirty 分流处置。该判据 MUST NOT 依赖编辑器当前是否 dirty——「保存完成」与「回声到达」之间存在一二百毫秒的窗口（M266 实测记下相隔 177ms 的一对诊断日志，见 change 的 design §4），窗口内用户若已重新键入，dirty 分流会把自己的写入误报成外部修改，而它给出的「重载（放弃我的修改）」会让用户丢掉刚敲进去的内容。判据必须与 dirty 无关，MUST NOT 只靠「保存进行中」这一个瞬时标记抑制。

目录条目**从无到有**（该批次的条目类型为 created 且磁盘上是目录）时，同一批次 SHALL 一并带出该目录下的全部条目（递归、与枚举同一份规则表（三档判据见「全类型递归枚举」）、父先于子），使**增量收敛后的模型与同一时刻的全量枚举一致**。依据：FSEvents（macOS 实际事件源）对目录改名只报目录本身一条路径，子孙一个都不进事件流——M258 真机探针实测批次逐字为 `[deleted:旧路径, created:新路径(dir)]`（`src-tauri/src/fs_io.rs` 的测试 `watch_dir_rename_delivers_full_subtree` 复现），而前端只能按事件流打补丁、读不到磁盘；缺这一层，改名后的目录在前端只能建出一个空节点（永远展不开，直到重启全量重扫）。补的这一层是唯一读得到磁盘现状（ground truth）的一层。带出的子树 SHALL 与枚举同策略：创建出来的目录若命中惰性档或用户规则，本批次只带出它这一行（惰性标记为 true），MUST NOT 带出子孙；物化登记 SHALL 随之校正——旧路径的登记随 `deleted` 清除，新路径的登记由用户下次展开时重建（登记只影响惰性子树的实时性，不影响可见性）。

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

- **WHEN** 惰性档的 `target/` 尚未被用户展开过，外部在其中新建 `a.md`；随后用户展开 `target`，外部再在其中新建 `b.md`
- **THEN** 前一次变更 MUST NOT 出现在事件流里；后一次（`created:target/b.md`）SHALL 出现——物化登记是惰性子树实时性的唯一开关

#### Scenario: 外部新建惰性档目录产生一行惰性事件

- **WHEN** 用户在 app 之外于 vault 的可见目录里跑一次构建，新出现 `target/` 目录（或直接 `mkdir target`）
- **THEN** 事件流 SHALL 出现 `created:target`（惰性标记为 true）——与同一时刻的全量枚举结果一致；其子孙 MUST NOT 被补出（`target/` 尚未展开）

#### Scenario: 外部新建命中内置规则的名字不产生事件

- **WHEN** 用户在外部的可见目录里新建 `.git/` 或 `.DS_Store`
- **THEN** 事件流 MUST NOT 出现对应的 created；树里 MUST NOT 出现这些名字的行——树的可见集与同一时刻的全量枚举一致（不显示档的名字仍与今日的内置规则逐条一致）

#### Scenario: 惰性条目的事件不改索引

- **WHEN** 惰性档的 `test-results/` 被外部改写（或外部新建一个惰性档命中的 md），事件被投递到 webview
- **THEN** 链接索引与附件索引 MUST NOT 因这条事件发生变化（MUST NOT upsert / push 惰性条目）；该文件的行照常在文件树里

#### Scenario: 惰性条目自身的行级事件总是投递

- **WHEN** 外部新建一个命中惰性档或用户规则的目录，或外部删除一个这样的目录（无论它是否被展开过）
- **THEN** 事件流出现对应的 `created` / `deleted`（路径的最后一段不参与投不投递的判定），树里的行随之出现 / 消失

#### Scenario: 自身写盘的回声在 dirty 时也不误报外部修改

- **WHEN** 用户按 `⌘S` 保存成功后，在回声到达前（约一二百毫秒内）继续键入，使编辑器重新 dirty；随后该次保存产生的 `modified` 事件到达
- **THEN** webview 读到磁盘 revision 与会话已知基准一致，判为自身写盘回声：不弹「检测到外部修改」、不出处置浮条、缓冲与选区不动；磁盘内容保持用户保存时的那一份

### Requirement: 按需枚举目录

系统 SHALL 提供 `fs_scan_dir` command：给定 vault 相对目录路径，返回该目录的**一层**条目（相对路径、类型、大小、mtime、惰性标记），分类口径与「全类型递归枚举」完全同源（不显示档命中即丢弃、惰性档或用户规则命中出一行且惰性标记为 true、其余出一行且惰性标记为 false）。它 SHALL 只枚举这一层，MUST NOT 递归下钻；被惰性档或用户规则命中的子目录同样只出一行（祖先命中 ⇒ 子孙同样惰性，故其惰性标记恒为 true）。

该命令是文件树展开**惰性目录**时的唯一取数通道：惰性条目的子孙不在装载时的枚举结果里（见「全类型递归枚举」），树 MUST NOT 把它们当作空目录渲染。对非惰性目录调用它同样合法（结果是该目录的一层枚举），但正常路径下树不需要这么做。

- **边界**：目标路径 SHALL 经与所有读取路径同源的 vault 内校验，MUST NOT 为按需枚举放松边界（绝对路径 / `..` / 符号链接逃逸一律拒绝）；目标不存在或不是目录 SHALL 返回人话 `CommandError`。
- **线程**：该 command 的 body SHALL NOT 占 IPC 主线程——展开一个条目数很大的目录时界面 MUST NOT 整段冻结（口径与 vault-workspace「vault 打开」的打开段一致）。
- **物化登记**：成功返回后 SHALL 把该目录登记进当前 vault 的「已按需展开集合」。该集合是「watch 增量事件流」判定惰性子树事件的唯一依据，SHALL 随 vault 装载重建、MUST NOT 跨 vault 串用。惰性档与用户规则的惰性目录共用同一个集合。
- **不改索引**：本次枚举出的条目 MUST NOT 被补进链接索引或附件索引（见「全类型递归枚举」的确定性条款）。

#### Scenario: 展开惰性目录得到一层

- **WHEN** 默认配置下对 `node_modules` 调用 `fs_scan_dir`
- **THEN** 返回 `node_modules` 的直接子条目（如 `express`，惰性标记为 true），不含 `express` 的子孙

#### Scenario: 对可见目录调用同样合法

- **WHEN** 对一个未被任何档或用户规则命中的目录调用 `fs_scan_dir`
- **THEN** 返回它的一层条目，与装载时枚举里该目录的子条目集合一致（口径同源）

#### Scenario: 越界路径拒绝

- **WHEN** 以 `../outside` 或绝对路径调用 `fs_scan_dir`
- **THEN** 返回 `CommandError`，不读取 vault 之外的任何内容

#### Scenario: 按需枚举不改索引

- **WHEN** 用户展开一个惰性目录，其中有 `tutorial.md`；随后别处文档里的 `[[tutorial]]` 重新解析
- **THEN** 仍为 `unresolved`（展开是 UI 动作，MUST NOT 改变索引）

### Requirement: 文件级操作（删除 / 重命名 / 新建 / 定位）

系统 SHALL 提供以下后端命令，全部只作用于 vault 内路径，安全边界与读取链路同源
（`resolve_in_vault` 或其新建变体）：删除（`fs_trash_entry`）、重命名（`fs_rename_entry`）、
新建文件（`fs_create_file`）、新建目录（`fs_create_dir`）、系统文件管理器定位
（`fs_reveal_in_finder`）。

- 删除 SHALL 为**移到系统废纸篓**（用户可经系统通道恢复），MUST NOT 提供永久删除路径；
  废纸篓失败 SHALL 报错且 MUST NOT 留下部分删除状态。
- 重命名 SHALL 只支持同目录改末段名；目标已存在 MUST NOT 覆盖。
- 新建 SHALL 使用原子创建语义（`create_new` 或等价），撞名即拒绝。
- 新建/改名的末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不命中 **`never_show` 档（含恒定临时文件模式）**。命中 `lazy` 档或用户规则的名字 MUST NOT 被拒绝（那是可见、可打开的名字，只是不进索引）。
- **`.git` 恒护栏（待裁决点 1）**：删除、重命名、移动的**源末段名或目标末段名**为 `.git` 时 SHALL 返回 `fs_name_invalid`，与分档无关——即使 `.git` 被配置成可见，MUST NOT 允许删除 / 改名 / 移出它，也 MUST NOT 允许把别的条目改名或移动为 `.git`。读取（展开、打开其中文件）不受限。
- 目标解析 SHALL 经新建变体（父目录沿用 `resolve_in_vault` 全部逃逸防护，末段名按上条校验），
  MUST NOT 为写操作放松 vault 边界。父目录补建时 SHALL 逐段拒绝 `never_show` 档名字；`lazy` 档名字允许作为父段（建出来的条目随该目录惰性）。
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

- **WHEN** 新建 / 改名的末段名为 `.git` 或 `.DS_Store`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

#### Scenario: 惰性档名允许

- **WHEN** 新建 / 改名的末段名为 `node_modules`（缺省配置下属惰性档）
- **THEN** 操作成功（该名字惰性可见、可打开，只是不进索引）

#### Scenario: `.git` 恒护栏（待裁决点 1）

- **WHEN** `.git` 被配置成惰性可见后，对其发起删除 / 重命名 / 拖拽移出 vault 根
- **THEN** 返回 `fs_name_invalid` 且磁盘不变；读取 `.git` 内的文件不受影响
