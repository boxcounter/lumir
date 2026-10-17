# fs-io 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/fs-io/spec.md](../../../../specs/fs-io/spec.md) 的「全类型递归枚举」。
> 本次修订只换**配置面形状**：两档名单从 `vault.hidden` / `vault.lazy` 两个名字数组，改成
> `vault.ignore` 一张**名字 → 档位**的地图（档位值 `"hidden"` / `"lazy"`）。判定链（`hidden` →
> `lazy` → 用户规则 → 可见）、前两档命中即定格、watch 按档分流、索引排除、剪枝、临时文件模式
> 恒定硬编码全部**逐字保留**。
>
> **同名冲突规则消亡**：「同一个名字同时出现在两个键里 ⇒ 按 `hidden` 生效 + warning」这一条
> 随单键地图一并删除——名字是对象的键，一个名字只能有一个档位。MUST NOT 把它改写成「重复键
> warning」重新引入。
>
> **裁决留痕（2026-10-17）**：Alex 裁决「采纳你的推荐方案（单键地图）」；预审「都采纳」覆盖
> 缺省即默认不变、同名冲突规则消亡、行为语义不变只换配置面、旧两键直接切断零兼容。

## MODIFIED Requirements

### Requirement: 全类型递归枚举

系统 SHALL 提供 `fs_scan_workspace` command 对当前 vault 做全类型递归枚举，返回条目清单：相对路径、文件/目录类型、大小、mtime，以及**惰性标记**（见下）。枚举 MUST NOT 按扩展名过滤（ADR 0001 全文件类型一等公民）。旧 stub 签名（`WorkspaceSnapshot` / 返回 `Option`）废弃，MUST NOT 在其上累代码（架构复查 P2-5）。

枚举 SHALL 由**一份规则表**决定每个条目的去向。规则表按**固定优先级**由四个来源解释：

- **不显示档（`hidden`）**：名字由配置项 `vault.ignore` 里**档位为 `hidden`** 的名字给出（语义见下），并**恒定**含保存临时文件模式两条：`.lumir-*`（名字以 `.lumir-` 开头）与 `.*.lumir-*`（首个 `.` 之后另有内容再出现 `.lumir-`，覆盖 `.{目标名}.lumir-{pid}`）。两条合起来的匹配集合 SHALL 等于既有判据「`.` 开头且含 `.lumir-`」，MUST NOT 留下差异。命中 ⇒ **不可见**：该条目 SHALL NOT 出现在枚举结果里，其整棵子树 MUST NOT 被枚举，也 MUST NOT 进入 watch 事件流与索引。
- 否则**惰性档（`lazy`）**命中 ⇒ **惰性可见**：条目 SHALL 出现在枚举结果里（惰性标记为 true；类型 / 大小 / mtime 与磁盘一致），其**子孙 MUST NOT 进入本次枚举**。
- 否则**用户规则**（vault 自己的 VCS 忽略声明）命中 ⇒ **惰性可见**（同上）。
- 否则 ⇒ 条目出现（惰性标记为 false），并递归其子树。

**判定顺序与优先级**：`hidden` SHALL 先判、命中即定格；`lazy` 次判、命中即定格；用户规则只在两者都未命中时参与。用户规则里的取反（如 `.gitignore` 写 `!target/`）MUST NOT 把 `hidden` 或 `lazy` 档命中的条目放回可见集、也 MUST NOT 改变其去向（理由：两档表达的是产品对「按结构不是内容」名字的判断，且它们的不可见 / 不进索引同时是性能与索引确定性的护栏，允许被一行编辑推翻等于把「打开 vault 会不会卡几秒」「链接解析是否确定」交给用户配置；出口是改配置、或产品侧另做显式的「显示被忽略项」开关）。用户规则之间 SHALL 按 git 口径决定优先级：深层 `.gitignore` > 浅层 `.gitignore` > `<root>/.git/info/exclude`，同一路径上最深的匹配决定（忽略与取反都在用户规则集内解析）。

**两档名字由单键地图给出**：`<config>/config.json` 的 `vault.ignore`（一个**名字 → 档位**的对象；档位值闭集合 `"hidden"` / `"lazy"`）SHALL 决定两档的名单；缺键 / 缺节 / 配置文件不存在 ⇒ 整图取**代码内置默认**。语义：

- **缺省即默认（粒度是整图）**：`vault.ignore` 缺席 ⇒ 用代码内置默认地图（`hidden`：`.git`、`.DS_Store`；`lazy`：`node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist`）；键存在（含 `{}`）⇒ 整图按配置解释。MUST NOT 在安装时把默认值快照写入配置文件。
- **档位只写在名字自己的值上**：一个名字只有一个档位，MUST NOT 需要「同名冲突」判定——这是单键地图的结构性质，不是一条需要实现的规则。`hidden` 比 `lazy` 更严格的含义（`hidden` 命中同时具备 `lazy` 的全部效用）由判定链表达，MUST NOT 在配置面再引入第二个表达方式。
- **不在图里的名字 ⇒ 该名字走用户规则 / 完全可见**：这是「第三档」的唯一表达方式，MUST NOT 为此新增第三个键、新增 `"visible"` 档位值或新的去向枚举值。
- **只接受名字，不接受模式**：每个**键** MUST 是单个名字——不含 `/`、不是 `.` / `..`、不含 gitignore 元字符（`*` `?` `[` `]` `!` `#` `\`）、首尾无空白。写模式（如 `"*.log": "lazy"`）MUST 被逐项忽略并给出人话 warning，MUST NOT 被当成模式解释。
- **逐项校验、非法项只丢自己**：名字非法 / 档位值不是字符串 / 档位值不在闭集合，都逐项忽略并各给一条人话 config warning；其余项 SHALL 照常生效，MUST NOT 因为一项非法而丢弃整份配置或回退整键默认地图（ADR 0002 §5）。整个 `ignore` 键给错类型（如 `"ignore": "hidden"`、`"ignore": []`）仍是既有解析模型的整文件回落，MUST NOT 发明逐字段类型容忍。
- **临时文件模式不在配置面内**：`.lumir-*` / `.*.lumir-*` 恒定硬编码；即使 `vault.ignore` 为 `{}`，它们仍被挡下（数据损坏面不交给用户配置）。
- **生效时点**：配置 SHALL 在 vault 装载时读取（MUST NOT 用启动期缓存钉住它）；其改动与规则文件内容的改动同为**下一次装载**生效。

**与用户规则来源的关系**：`vault.rule_files`（默认 `[".gitignore", ".git/info/exclude"]`）的语义不变——它只决定用户规则从哪些文件读，MUST NOT 影响两档名字。空列表 = 无用户规则来源（彻底：不含 `.gitignore` 时嵌套 `.gitignore` 同样不读）；文件不存在静默跳过；非法项逐项忽略 + warning；`<root>/.git/info/exclude` 仅当 `<root>/.git` 是目录时读取（是文件——linked worktree 的 gitlink——时不读，避免把 vault 边界之外的状态读进来）。MUST NOT 读全局 excludes 文件（`core.excludesFile` 在 vault 之外）。匹配 SHALL 按 gitignore 语义（取反 `!`、`/` 锚定、`**`、目录限定、注释与转义、大小写规则），并包含「祖先被排除 ⇒ 子孙全被排除」这一既有语义。规则表 SHALL 在 vault 装载时编译**一次**；规则文件自身的变更 SHALL 在**下一次装载**生效。

**名字的书写形式**：两档配置名字与用户规则的内置匹配方式中，名字 SHALL 按**无尾斜杠名字字面量**匹配（`target`，不是 `target/`）：gitignore 语义下无斜杠模式在任意深度匹配同名的**文件与目录**（「同名文件与目录一视同仁」）。配置里的名字经上述校验不含元字符，因此其语义就是名字等值 + 祖先传递。

**惰性标记的语义**：true 表示本条目的子树 / 索引面未枚举——目录的子孙不在本次结果里（展开时经「按需枚举目录」拉取一层），文件不进链接索引与附件索引。前端 SHALL 用它区分「空目录」与「惰性目录」。

被 `hidden` 档隐藏与被标为惰性的条目（无论惰性来自哪一档）SHALL NOT 进入由枚举结果建出的**链接索引**与**附件索引**，其中包括用户已经按需展开过的惰性条目——索引的输入 MUST 是磁盘与规则的纯函数，MUST NOT 依赖 UI 交互历史（同一 vault 两次打开的解析结果一致，见 wikilink-resolution）。新建 / 改名的末段名命中 **`hidden` 档（含临时文件模式）** 时 SHALL 返回 `fs_name_invalid`（沿用既有行为）；命中 **`lazy` 档或用户规则** 时 MUST NOT 拒绝（该名字本来就可见、可打开，只是不进索引）。

**诊断计数**：全量枚举收口处 SHALL 记录被 **`hidden` 档**（含临时文件模式）剪掉的条目数，作为既有 `vault_scan_ignored` 事件的唯一口径；惰性条目 MUST NOT 计入（它们有行、看得见，不属于「文件不见了」的诊断对象）。计数 MUST NOT 包含路径或名字原文。

**已知边界（如实记录）**：内置默认地图是启发式、不完整（未列名的构建产物目录靠「用户把它写进配置或忽略声明」处理）；名字匹配不折叠大小写；配置不支持模式；JSON 对象的重复键按解析库口径「后者覆盖」，不产生 warning（单键地图里「同名冲突」这个类别结构上不存在）；被 `hidden` 档隐藏的条目静默消失（含 wikilink 解析面与附件面）；指向惰性区域的 `[[wikilink]]` 与 `![[img]]` 解析降级（它们不在索引里），且 `wikilink_create` 对它可能造出重复文件——本 change 不改该命令，记为后续候选。

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
- **THEN** 用户规则的三个来源都生效（与默认 `rule_files` 一致）；两档名字都取代码内置默认地图，16 名仍全部被规则表覆盖、无一漏网——`.git` / `.DS_Store` 不可见，其余 14 名惰性可见

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

- **WHEN** 用户把 `dist` 从默认地图里删除（`vault.ignore` 不含它），磁盘上有 `dist/app.js`
- **THEN** `dist` 与 `dist/app.js` 照常递归枚举、惰性标记为 false、进入索引（这是「第三档」的表达方式；scenario 名按 archive 规则保留原文）

#### Scenario: 配置把某个名字加进不显示档

- **WHEN** 用户在 `vault.ignore` 里写 `"scratch": "hidden"`，磁盘上有 `scratch/a.md`
- **THEN** `scratch` 及其子孙不出现在枚举结果里；且新建 / 改名为 `scratch` 返回 `fs_name_invalid`

#### Scenario: 空列表表示该档没有名字

- **WHEN** `vault.ignore` 被设为 `{}`（整图为空，两档都没有名字），磁盘上有 `.git/` 与一个 `.note.md.lumir-123` 临时文件
- **THEN** `.git` 不再被该档隐藏（按用户规则 / 可见处理）；临时文件仍不出现在枚举结果里（模式恒定硬编码）；scenario 名按 archive 规则保留原文

#### Scenario: 同一名字同时出现在两档

- **WHEN** 用户在 `vault.ignore` 里给同一个名字写了两次（JSON 重复键，如 `{".git": "hidden", ".git": "lazy"}`）
- **THEN** 「同名冲突」这个类别在单键地图里结构上不存在——按解析库口径后者覆盖（`"lazy"`），不产生 warning；MUST NOT 为此新增冲突判定。scenario 名按 archive 规则保留原文

#### Scenario: 非法项逐项忽略且其余项照常生效

- **WHEN** `vault.ignore` 为 `{"*.log": "lazy", "a/b": "hidden", "": "lazy", "node_modules": "invisible", "target": 3, ".git": "hidden"}`
- **THEN** 前五项被逐项忽略并各给一条人话 config warning（名字非法 / 档位不是字符串 / 档位取值非法），`.git` 照常生效；启动与装载 MUST NOT 因此失败，其余配置字段 MUST NOT 被回退默认值

#### Scenario: 临时文件模式不可配置

- **WHEN** 用户把 `vault.ignore` 设为 `{}` 并在 vault 里留下 `.lumir-notes.md` 与 `..lumir-1`
- **THEN** 它们仍不出现在枚举结果里，也不进入 watch 事件流（模式不在配置面内）

#### Scenario: 配置改动下次装载生效

- **WHEN** 用户在会话中把 `vault.ignore` 里 `target` 的值从 `"lazy"` 改成 `"hidden"`
- **THEN** 本次会话的枚举形态不变；下次装载该 vault 后 `target` 变成不可见

#### Scenario: 惰性档名字可以新建与改名

- **WHEN** 用户在树里新建文件 `target`（或把某文件改名为 `node_modules`）
- **THEN** 创建 / 改名成功，得到一行惰性条目（该名字可见、可打开，只是不进索引）；命中用户规则的名字同样允许

#### Scenario: 不显示档名字被拒绝

- **WHEN** 用户新建 / 改名的末段名为 `.git` 或 `.DS_Store`
- **THEN** 返回 `fs_name_invalid`，文件系统不变

#### Scenario: vault 根与忽略集同名不影响

- **WHEN** 用户把名为 `target` 的目录作为 vault 打开，其内含 `a.md`
- **THEN** 打开成功，枚举结果含 `a.md`（vault 根自身的名字不参与判据）
