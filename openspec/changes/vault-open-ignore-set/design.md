# Design: vault-open-ignore-set

技术方案与权衡。proposal 写「做什么」，本文写「怎么落、哪些地方会咬人、哪些结论还没有读数撑」。

> **Alex 节点 1 裁决（2026-09-28）已落进本文**：A3 名单（`build` / `out` / `vendor`）不收；**B 案（读 `.gitignore` / `.git/info/exclude`）纳入本 change**，并带一条硬性产品约束——**被这些规则挡住的目录与文件在左栏文件树里 MUST 仍然可见**（原话：「我还是希望能在左栏里看到 .gitignore 挡住的目录或文件（比如 .local 里有我需要读的教程）」）；C 案（用户可配置名单）不做；`#[command(async)]` 纳入；规则**装载时编译一次、下次装载生效**。
> **合并指令（同日第二轮，已被本文吸收）**：Alex 要求把「硬编码隐藏类」与「`.gitignore` 机制」**合并成一份规则表**（少一种硬编码特例）——见 §2：两类行为不再靠两套机制，而靠**规则来源**区分（内置 ⇒ 不可见；用户 ⇒ 惰性可见），`is_ignored` 的名字等值判定退役。§11 是影响面对账。

## 0. 一句话方案

打开段的 3.1s 里，scan（1,231ms）+ build_graph（1,879ms）**全花在用户不读的东西上**，而成本与「主动枚举的条目数」近似正比。所以本 change 做三件事：

1. **忽略集合成一份规则表，去向按来源分**：**内置规则**（产品硬编码：16 个名字 + 临时文件模式）命中 ⇒ **不可见**（行为与今日一致，不进树、不进索引，且用户规则的取反不能推翻它）；**用户规则**（vault 自己的 `.gitignore` / `.git/info/exclude`）命中 ⇒ **惰性可见**（行在树里、子树按需枚举、不进索引）。前者收窄「用户不读的东西」，后者把「用户声明为不跟踪、但可能想读的东西」从「看不见」改成「看得见、不看就不付费」。
2. **打开段移出 IPC 主线程**（`#[command(async)]`，单行）：收窄之后 66ms 档不需要它，但任何收不窄的 vault（用户库 20 万条目）不再整窗死帧。
3. **补两条分段读数**（scan / graph），闭合真机与合成之间那 2.4s 的解释缺口。

三者各自独立可回退。**关键量**：Alex 的 vault 在「内置规则 + 用户规则」下的主动枚举量 = 1,658 文件 / 2,395 条目 ⇒ 合成实测 `scan 14.0ms + graph 51.7ms = 65.8ms`；而 `.tower`（275,180 文件 / 35G）与 `.local`（他要读的教程）仍然**看得见**，代价从「每次打开付掉」变成「点开哪一层才付哪一层」。

## 1. 现状与证据状态

| 面 | 现状机制（落点） | 量级 / 证据 | 状态 |
|---|---|---|---|
| 打开段 | `vault_open_path`（[commands.rs:614](../../../src-tauri/src/commands.rs#L614)）**同步 command** ⇒ body 在 IPC 主线程内联执行：`reconcile_vault` → `fs_io::watch()` → `scan_workspace` → `build_graph` | **M289 release 直测**（复刻真 vault 可见形状：166,626 文件 / 200,274 条目 / 14,573 md / 172.6MB）：`scan 1,231.1ms` + `build_graph 1,879.1ms`（生产复刻口径；canonicalize 外提版 1,710.6ms）**= 3,110.2ms**（5 次中位） | **有读数** |
| 同段：收窄后残余 | 同上 | 1,658 文件 / 2,395 条目 / 1,211 md / 3.3MB ⇒ `scan 14.0ms + graph 51.7ms = 65.8ms`（同 harness、5 次中位） | **有读数** |
| 同段：对照规模 | 同上 | 2,142 文件 / 1,341 md 形状（M283）⇒ 92–107ms；与残余形状同量级 ✓（两把尺子互相印证） | 有读数 |
| 可见集 | `IGNORED_NAMES`（[fs_io.rs:28](../../../src-tauri/src/fs_io.rs#L28)）3 个名字；`is_ignored`（[fs_io.rs:104](../../../src-tauri/src/fs_io.rs#L104)）= 名字等值 + `.lumir-` 临时文件模式 | Alex 真 vault：**scan 可见 170,317 文件 / 24,072 目录 = 194,389 条目**；按名已剪 147,440（133,440 嵌套 node_modules + 11,158 根 node_modules + 961 `.git` + 探针）⇒ `.git` 不是嫌疑 | **有读数** |
| 可见集构成 | 同上 | worktree `src-tauri/target` 110,501 + 根 `src-tauri/target` 19,154 + `test-results` 9,660 + `.tower`（comms 2,832 + worktree 仓库内容 ~14,000）+ 真内容 1,658 | **有读数** |
| payload | entries 全量 serialize → webview `JSON.parse` | 真可见形状 ≈27MB（字典序 JSON；46MB 档实测 `JSON.parse` 71–73ms，堆 +124MB） ⇒ **不是瓶颈** | 有读数 |
| 前端装配 | `applyVault`（附件路径过滤）+ `tree.setVault`（给全部条目建 `Node`/`Map`；DOM 只挂根级） | 194k 条目的建表是 O(n)、个位数~十位数 ms 级；`vault_load_tree` 在 09-26/27/28 三天真机日志里**一次都没出现**（>250ms 才记）⇒ 不是主因 | 结构性有据；整段耗时**未单独测** |
| 真机打开段 | 同上 | 同一条路径的真机日志读数：09-27 `265 / 2,661 / 297 / 4,883 / 6,616 / 5,146 / 3,951 / 4,999ms`，09-28 `12,416 / 5,501 / 12,695ms` ⇒ **跨度 48×** | 有读数（但 `~/.config/lumir/logs/` 属 Alex 本机，agent 不读） |
| VCS 忽略规则 | **今天完全不读**（`Cargo.toml` 无 `ignore` / `globset` / `walkdir` 依赖；代码里没有任何读 `.gitignore` 的路径） | Alex 真 vault 的 `.gitignore` 覆盖 `node_modules/` / `.pnpm-store/` / `dist/` / `src-tauri/target/` / `perf-results/` / `test-results/` / `*.log` / `.DS_Store` / `HANDOFF.md`；`.tower/` 只在 `.git/info/exclude:7` | 走查有据（M289）；本 change 的输入 |
| **枚举 = 可见集 = 树的数据来源**（本 change 要拆开的同一性） | `scan_workspace` 的输出被六个消费点直接当作「vault 里有什么」 | 六个消费点：文件树模型（`src/tree.ts` 的 `setVault`）、链接索引（`VaultState::build_graph`）、附件索引（`src/main.ts` 的 `attachmentPaths`）、会话恢复的「在不在 vault 内」判据（`src/vault-switcher.ts` 的 `restorePlan`）、阅读位置（`src/reading-position.ts` 的 `onVaultLoaded` / `pruneEntries`）、watch 事件过滤（`fs_io::rel_string`） | 走查有据；§4.7 逐条给口径 |

**复现命令**（M289 用的就是它，未改一行代码；harness 命中已存在的 `$TMPDIR/lumir-m283-real-shape` 即复用）：

```bash
CARGO_TARGET_DIR=/tmp/<dir>/target cargo build --release --test vault_open_readings   # 实测 1m22s
TMPDIR=<vault 父目录> cargo test --release --test vault_open_readings -- --ignored --nocapture
```

口径提醒（照录 M289，别当稳态常数读）：harness 是**热缓存**读数，且当时 load average 5–8；真机首次打开是冷的。

## 2. 一份规则表，两个来源（Alex 2026-09-28 的合并指令）

### 2.1 指令与结论

Alex 问：「硬编码隐藏类是否可以和 .gitignore 合并、而不是单独硬编码，少一种硬编码的特殊情况」。**结论：合并可行，而且是简化**——把「内置名单」与「用户忽略声明」编成**同一份规则表**、走同一个匹配器（`ignore` crate 的 gitignore 语义），`fs_io` 的 `is_ignored` 名字等值判定退役；枚举 / watch / 文件树 / 索引 / 新建改名校验全部走这一份表。**「不可见」与「惰性可见」两种行为不再靠两套机制区分，而靠规则来源区分。**

### 2.2 判定顺序（唯一的一条链）

对每个条目（vault 相对路径 `P`、磁盘类型 `is_dir`）：

1. **内置规则**命中 ⇒ **不可见**：不进枚举结果、不进 watch 事件流、不进链接/附件索引、子树不枚举（行为与今日的硬编码名单一致）。用户规则的取反 MUST NOT 推翻它（§2.6）。
2. 否则**用户规则**命中 ignore ⇒ **惰性可见**：出一行（`lazy: true`）、不递归、不进索引。
3. 否则 ⇒ 出一行（`lazy: false`）、递归、进索引。

一句话：**来源决定去向**——内置（产品声明「按结构不是内容」）⇒ 不可见；用户（vault 自己的 VCS 忽略声明）⇒ 看得见但不主动付费。

### 2.3 与今日的等价承诺（「同名文件也隐藏」不改判）

- **书写形式**：内置规则 SHALL 用**无尾斜杠的名字字面量**（`target`，不是 `target/`）。gitignore 语义下，无斜杠模式匹配**任意深度上同名的文件与目录** ⇒ 与今日 `is_ignored` 的名字等值判定逐条等价，既有 scenario「同名文件与目录一视同仁」**保留、不改判**（一个名为 `target` 的无扩展名文件仍被隐藏）。写成 `target/` 会变成「只隐藏目录、同名文件可见」——那是**有意的改判**，本 change 不做（无收益，且会让既有断言失效）。
- 另两条等价：**任意深度**（无斜杠模式在任意层匹配）与**大小写敏感**（gitignore 默认大小写敏感，与逐字节等值同向）。
- **临时文件模式并入（两条，与今日判据**逐条等价**）**：今日判据是「`.` 开头且含 `.lumir-`」。它需要两条 gitignore 规则才能覆盖全：
  - `.lumir-*` —— 名字在**开头**就是 `.lumir-`（如 `.lumir-notes.md`、`.lumir-`、`.lumir-1`）；
  - `.*.lumir-*` —— 首个 `.` 之后还有一段内容，再出现 `.lumir-`（覆盖本 app 实际产生的 `.{目标名}.lumir-{pid}`，如 `.note.md.lumir-123`，以及 `..lumir-1`）。
  两条合起来的匹配集合 = 「`.` 开头且含 `.lumir-`」，**没有剩余差异**。ghost 的惰性清除仍由既有函数按同一判据判定（两处共用一份模式字面量）。
  > **r2/r3 评审 P2-a 的处置（比评审建议更进一步）**：评审用真 `git check-ignore` 实测指出，只写 `.*.lumir-*` 时 **`.lumir-notes.md` 这类「以 `.lumir-` 开头」的名字今日隐藏、新模式可见**——差异类不止 `.lumir-` 一个名字。评审接受「披露即可」，但本 change 的条款是「内置规则与既有行为**逐条等价**、不改判」，而少写一条规则等于**顺手把一个行为改了**（一个今天隐藏的文件会突然出现在树里），且对拍测试必然红。因此这里选择**补足规则**而不是披露差异：等价承诺完整、对拍测试无例外，代价为零（多一行字面量，不新增任何隐藏面——被它命中的名字今天本来就隐藏）。
- **等价性由一条对拍测试钉住**（不靠人眼）：对一份名字 corpus 同时跑「今日等值判据」与「新内置匹配器」，逐条断言**完全一致**（零例外）。corpus 至少含 `target` / `Target` / `target.md` / `dist-old` / `builds` / `build` / `out` / `vendor` / `.DS_Store` / `node_modules` / `.venv` / `.pnpm-store` / `.a.lumir-1` / `..lumir-1` / `.lumir-` / `.lumir-1` / `.lumir-notes.md` / `note.md.lumir-1`，以及嵌套路径（`a/target/x.md`、`a/.git/config`）。
- **用户规则不受这条约束**：`.gitignore` 里的 `foo/` 与 `foo` 按 gitignore 语义各自解释（用户写什么就是什么）。

### 2.4 内置规则的清单（16 个名字 + 1 条临时文件模式）

| 档 | 规则（无尾斜杠名字字面量） | 裁决 |
|---|---|---|
| 既有 | `.git` `.DS_Store` `node_modules` | 不动 |
| A1 生态专名 | `.venv` `venv` `__pycache__` `.next` `.nuxt` `.cache` `.pnpm-store` `.tox` `.gradle` `test-results` `perf-results` | **收**（2026-09-28） |
| A2 工具链常用词 | `target` `dist` | **收**（2026-09-28） |
| ~~A3 通用英文词~~ | ~~`build` `out` `vendor`~~ | **不收**（Alex 裁决 2026-09-28） |
| 临时文件模式 | `.*.lumir-*` | 并入（§2.3） |

合计 **16 个名字 + 1 条模式**。收益主力仍是 `target`（Alex 的 vault 里 129,655 个可见文件 = 170,317 的 76%）与 `test-results`（9,660）。A3 被砍的实际代价很小：Alex 的 vault 里 `build` / `out` / `vendor` 的**可见目录数为 0**（`out` / `dist` 的目录绝大多数在 `node_modules` 树内，已被 `node_modules` 覆盖）；损失的是通用性——别人的 Python `build/` 与 npm 式 `vendor/` 不再被内置隐藏，而这类目录**若写进了用户的 `.gitignore`，照样落进用户规则**（惰性可见、不主动枚举）。

### 2.5 用户规则的来源、优先级与语义

- **来源**：由配置项 `vault.rule_files` 给出（默认 `[".gitignore", ".git/info/exclude"]`，vault 相对路径；Rust 侧 `AppConfig.vault`）——见 §2.9。默认值下的行为与本文此前的写法逐条一致：`<root>/.gitignore` 与递归途中的嵌套 `.gitignore`、`<root>/.git/info/exclude`（仅当 `<root>/.git` 是目录）。**MUST NOT 读全局 excludes**（`core.excludesFile` 在 vault 之外，读它等于让 vault 之外的状态决定 vault 内的可见集）。
- **优先级（按 git 口径）**：深层 `.gitignore` > 浅层 `.gitignore` > `info/exclude`；同一路径上**最深的匹配决定**（忽略与取反都在用户规则集内解析）。
- **语义**：gitignore 全套——取反 `!`、`/` 锚定、`**`、目录限定（尾斜杠）、注释与转义、大小写规则，含「**祖先被排除 ⇒ 子孙全被排除**」⇒ 用户规则命中的子树内部一切仍是惰性（「按需枚举目录」因此不必在惰性子树里重读 `.gitignore`）。
- **编译时机**：vault 装载时一次；规则文件自身变更**下次装载生效**（依据见 §4.5）。

### 2.6 边界一：用户规则的取反 MUST NOT 推翻内置规则（论证）

`!target/` 这类取反**不能**把内置规则命中的条目放回可见集。三条理由：

1. **来源不同级**：内置规则是产品判断（「按结构不是内容」：`.git` 是对象库、`node_modules` 是依赖副本、`target` 是构建产物），不是用户的偏好设置；gitignore 的取反本来只在**用户自己那份规则集**内生效。把两者放进同一张表，是让它们共用**匹配器**，不是让它们互相覆盖。
2. **它是性能护栏，不能由一行编辑关掉**：允许取反推翻内置规则，等于把「切 vault 会不会卡几秒」交给用户 `.gitignore` 里的一行——失败模式是**静默的性能回归**（Alex 的 repo 里 `target` 一族 129,655 个条目会重新进枚举，回到 3.1s 档），且没有任何提示。
3. **合法出口已经存在**：内置名单要变，走 change proposal（本 change 就是先例）；用户要读构建产物，产品侧该给的是一个**显式的「显示被忽略项」开关**（Non-goal，留候选），而不是让 `.gitignore` 兼职产品配置。

**口径**：判定顺序（§2.2）里内置先判、命中即定格，不进入用户规则的取反通道；反过来，用户规则**可以**取反用户规则（`drafts/` 忽略、`!drafts/keep/` 放回）——那是用户自己那套规则内部的事，语义照 git。

### 2.7 这次合并去掉了哪些特例（收益）

- 判定链只剩一条（§2.2 的三步），不再有「名字等值」与「规则匹配」两套实现（REVIEW.md 第 8 条：同一语义一个真源）；
- 「不可见 / 惰性」变成**来源属性**：以后往内置规则里加一个名字，不引入任何新分支、也不新增代码路径；
- 内置规则的书写形式（无尾斜杠字面量）与应用处的语义是**同一把尺子**——「同名文件也隐藏」这条行为由匹配器语义保证，而不是由一处特判保证；
- 临时文件模式也从特判变成表中一行。

### 2.8 性能注记（必须复测，不得默认不变）

今日每个条目是 3 次字节比较；合并后是 globset 匹配（ripgrep 同源，预编译）。走访的条目数已被收窄（Alex 的 vault 收窄后 ~31k 量级），预期可忽略，但**必须用 M289 的 harness 复测**（tasks 8.3）——「等价的语义、不同的实现」不能靠推断宣称没有代价。若实测成为热点，允许从**同一份规则表**派生一个等价的名字集合快路径（派生只许由表生成，且要有一条「表 ≡ 快路径」的测试钉住），MUST NOT 另手写一份名单。

### 2.9 配置项 `vault.rule_files`：用户规则的来源（r6，Alex 定案第 7 条）

Alex 定案：**内置默认规则保留（16 名，行为同现状），同时引入配置项「规则文件列表」**（他原本提议「去掉内置规则、只做配置项」，tower 给出三个洞后采纳「两个都要」）。本节的落点是**配置项只决定「用户规则从哪些文件读」**，与内置规则无关。

**形态**（本仓第一个 `[vault]` 节）：

```json
{ "vault": { "rule_files": [".gitignore", ".git/info/exclude"] } }
```

- 每个值是一个 **vault 相对路径**；装载 vault 时逐个读取，按 gitignore 语义编译后与内置规则拼进同一份规则表（§2.1）。
- Rust 侧形状：`AppConfig.vault: VaultConfig`（`#[serde(default)]`）+ `VaultConfig { rule_files: Vec<String> }`，缺省值即上面两条；缺节 / 缺键 / 配置文件不存在 ⇒ 用默认值（`config::load_from` 的既有形状）。

**语义细节（指令要求「你定并写明理由」）**：

1. **空列表 = 没有用户规则来源**（只剩内置规则）——这正是「非 git vault 的等价行为」（没有 `.gitignore` 可守）。这里的「没有」是**彻底**的：列表里不含 `.gitignore` ⇒ 连递归途中的嵌套 `.gitignore` 也不读。
   理由：嵌套逐层读取是 **`.gitignore` 这个来源自身的语义**（gitignore 的固有行为），不是第二个可配置来源；把「嵌套要不要读」做成独立开关，等于给 Alex 没提的第二个配置面，收益为零而解释成本翻倍。换句话说——**列表里出现 `.gitignore` = 开启整套 gitignore 语义（根级 + 嵌套）；不出现 = 完全不读 `.gitignore`**。
2. **列表项一律按「vault 根的规则文件」解释**（模式相对 vault 根匹配）。所以把一个子目录里的 `.gitignore` 单列进来，不会让它变成「相对该子目录」的规则——嵌套 `.gitignore` 交给递归途中的语义处理，不由列表表达。这是刻意的简化：列表是「来源清单」，不是「规则作用域的声明」。
3. **文件不存在或不是常规文件 ⇒ 静默跳过、不报错、不给 warning**。这是常态而不是异常：`.git/info/exclude` 在非 git vault 里本来就不存在。
4. **非法项逐项忽略 + 一条人话 config warning**：非字符串 / 绝对路径 / 含 `..` / 空串都算非法（ADR 0002 §5 的配置即数据纪律：逐字段校验、非法值人话 warning、**不得导致启动失败**）。其余项照常生效；**MUST NOT** 因为一项非法而把整份配置回退默认值（那会让用户的一个笔误悄悄改掉别的设置）。**实现提示**：该字段在 `RawConfig` 那一层收成 `Vec<serde_json::Value>` 再逐项校验（与既有字段同路）——直接写成 `Vec<String>` 会让一个非法元素把整份配置打回默认。
5. **生效时点**：与已定案口径一致——规则表在 **vault 装载时**编译一次；`config.json` 的改动同样**下次装载生效**。实现上不需要重启：`config::load()` 本来就是「按需读盘」（每次调用读文件），所以在 `prepare_vault_open` 里读一次即拿到最新值——**MUST NOT** 为这个配置项引入启动期缓存把这条口径做坏。
6. **全局一份列表，而非 per-vault**（tower 倾向，我采纳并给出理由）：
   - 现有 per-vault 状态一律落在**按 vault 分文件的配置目录子目录**里（`vault-registry/<id>.json`、`vault-sessions/<id>.json`、`reading-positions/<id>.json`），而 `config.json` 是**一份全局文件**。per-vault 覆盖要新增一个 per-vault 文件 + 覆盖/合并规则 + 一条前端写入通道——那是**另一个配置面**，本 change 不做（Non-goal，登记为后续候选）。
   - 需求侧：规则**文件名**是约定（`.gitignore` / `.git/info/exclude`），实践上不随 vault 变；真要「这个 vault 别读 exclude」，本 change 给不了按 vault 区分的开关——如实记为已知边界，不作暗示。
   - 形态上仍然自洽：**全局一份列表 + 每个 vault 各自解析**（列表项是 vault 相对路径，同一份列表在多个 vault 上各自生效）。

**与既有边界的重申（不因配置项而变）**：内置规则**恒定生效**、不在配置面内、不可被用户规则的取反推翻（§2.6）；「内置 ⇒ 不可见 / 用户 ⇒ 惰性可见」的来源分类不变（§2.2）。配置项只决定**用户规则从哪些文件读**。

**配置语义写在哪儿**：与它控制的行为同处一条 requirement（fs-io「全类型递归枚举」），不另立「配置表」requirement——两个 capability 各写一半会让「忽略规则的来源」出现第二个真源（REVIEW.md 第 8 条）。（对照：`log` 配置表之所以自成一条，是因为它控制的是 diagnostics 自己的能力。）

## 3. 内置规则的代价（A1 + A2）

### 3.1 代价一：用户内容可能被静默隐藏

一个已有 vault 里若存在 `notes/target/plan.md`，本 change 之后它从文件树、**链接索引**、附件索引里一起消失——`[[plan]]` 也解析不到了。用户看到的是「我的文件不见了」，且**没有任何提示**。A3 被砍之后，剩下的 16 个名都是工具链固定输出名，误伤概率低但不为零（`dist` 与 `target` 仍是英文词）。

### 3.2 代价二：这些名字从此不能新建 / 改名

`validate_new_name`（[fs_io.rs:328](../../../src-tauri/src/fs_io.rs#L328)）复用同一份规则表——它是**有意耦合**的：如果允许建出 `target/` 而枚举又忽略它，用户在界面上既看不到也删不掉（[fs_io.rs:306](../../../src-tauri/src/fs_io.rs#L306) 起的注释写的就是这条）。代价因此是显式的：**新建/改名成这 16 个名字会被 `fs_name_invalid` 拒绝**（人话文案「`{name}` 在忽略集内，建成后不会出现在文件树里」）。注意：**用户规则命中的名字不受这条约束**——用户可以照常创建/改名成被 `.gitignore` 匹配的名字（它本来就可见可打开），只是它不进索引（§4.6）。

### 3.3 缓解（本 change 能做到的）

1. **诊断日志给一条忽略计数**（实现项，不是 UI）：枚举收口处记一行「被内置规则剪掉的条目数」。落点是 diagnostics 的事件白名单——新增 `LogEventName::VaultScanIgnored`、字段只有 `count`（十进制字符串，[logging.rs:133](../../../src-tauri/src/logging.rs#L133) 的 `allowed_fields` 与事件名是机制化护栏，新事件名要一并登记）；MUST NOT 记被忽略条目的路径或名字原文（隐私边界不变，只给计数就够用）。用途：用户报「文件不见了」时，一条日志即可判断是不是内置规则干的。
2. **可回退**：内置规则是表里的一行，回退是删一行；判定是纯函数（表不可变），回退后无残留状态。

### 3.4 与 ADR 0001 的张力（如实记）

ADR 0001 的原文是「全文件类型一等公民」——**一等公民的是文件类型**（不按扩展名过滤），不是「任何目录名都必须在树里」。既有忽略集（`.git` / `node_modules`）已经做了「按名排除非内容目录」这件事；张力成立的部分是判据从「结构上确定不是内容」（`.git` 内是对象库）退到「按名字猜不是内容」。**本 change 用来源划分显著收窄了这个张力**：现在只有「工具链固定输出名」走不可见，其余「用户声明过的不跟踪目录」一律可见（惰性）。

## 4. 用户规则的惰性化：让「不主动枚举」与「看得见」两立

### 4.1 一句话机制

**枚举只枚举「未被规则挡住」的子树；被规则挡住的条目本身仍作为一行出现在枚举结果里，但它的子孙不进本次枚举——用户展开它时才按需枚举一层。** 于是：

- 打开段成本 = 未被挡住的部分（Alex 的 vault：1,658 文件 ≈ 66ms）；
- 可见性 = 全部（挡住的东西一行不少，点开就能读）；
- 代价随注意力移动：点开哪一层付哪一层（一次 `read_dir`），不点不付。

### 4.2 分类算法（枚举侧）

对 `read_dir` 读到的每个条目 `E`（相对路径 `P`，磁盘类型 `is_dir`）：

判定顺序就是 §2.2 的三步（来源决定去向），本节只补实现口径：

| 判据（按序） | 结果 |
|---|---|
| `P` 命中**内置规则**（16 个名字字面量 + `.*.lumir-*` 模式） | **丢弃**（不出现、不递归——今日行为；用户规则的取反不参与） |
| `P` 命中**用户规则** ignore（含「祖先被排除 ⇒ 子孙全被排除」） | **出一行**（`lazy: true`），**不递归** |
| 其余 | 出一行（`lazy: false`），**递归** |

「祖先被排除 ⇒ 子孙全被排除」是 gitignore 的既有语义（不能再 re-include 一个被排除目录下的文件），`ignore` crate 的 `matched_path_or_any_parents(path, is_dir)` 正是这个口径。**推论**：用户规则命中的子树内部的一切仍是惰性（不需要逐层重新判定规则），这也是「按需枚举一层」不会越界的依据。

内置规则先判且命中即定格（§2.6），所以用户规则里的 `!target/` 走到这里不会把 `target` 放回来。

规则栈（嵌套 `.gitignore`）只在**递归进入可见目录**时逐层叠加；惰性子树内部不读它的 `.gitignore`（那里的规则不会改变结论：祖先已排除）。

### 4.3 按需枚举：新命令 + 条目上的惰性标记

- **`FsEntry` 新增 `lazy: bool`**（ts-rs 导出面变更）：`true` 表示「这一条的子树/索引面未枚举」——目录的子孙不在 entries 里（展开时按需拉取），文件不进链接索引与附件索引。前端靠它区分「空目录」与「惰性目录」（没有这个标记，两者在模型里长得一样，展开一个惰性目录会显示成空）。
- **新命令 `fs_scan_dir(dir)`**：返回该**一层**的条目，分类口径与 §4.2 完全同源（内置规则丢弃、用户规则命中出 `lazy` 行、其余正常——注意它**只枚举一层**，不递归下钻）。路径 MUST 走与所有读取路径同源的 vault 内校验（`resolve_in_vault`），**MUST NOT 为按需枚举放松边界**；目录不存在 / 不是目录 → 人话 `CommandError`。
- **它也是异步 command**（`#[command(async)]`）：一次展开可能是几万条（`.tower/worktrees` 下层），不能占 IPC 主线程（§5 同口径）。
- **调用时机**：文件树展开一个 `lazy` 目录时（`src/tree.ts` 的 `expandNode` 现在直接从内存模型取子节点，惰性目录要走命令并把结果合并进模型）。
- **物化登记**：`fs_scan_dir(dir)` 成功即把该目录登记进 vault 的「已按需展开集合」（§4.4 的 watch 判据用它）。集合随 vault 装载重建，MUST NOT 跨 vault 串用。

### 4.4 watch 侧如何复现同一判定

判定必须与枚举侧同源（spec 的既有条款：watch 与枚举共用同一份规则表），但事件路径有两种枚举侧没有的难处：**用户规则命中的子树内部的变更不该无条件投递**（`.tower/worktrees` 里的 agent 活动会变成事件风暴），以及**被删路径 stat 不到**（拿不到类型，无法判定目录限定模式）。

**判定规则（两来源分别处理）**：

```
对事件路径 P（vault 相对）：
  若任一组件（含最后一段）命中内置规则                            → 丢弃
  若任一「祖先组件」（P 去掉最后一段后的每个前缀）命中用户规则
     且 该祖先不在已按需展开集合                                  → 丢弃
  否则                                                          → 投递
```

三条要点：

1. **内置规则对全部组件照判（含最后一段）**：内置规则是**名字的纯函数**——它不含目录限定模式，判一个组件既不需要 stat 也不需要类型，所以「被删路径拿不到类型」的难处在这里根本不存在。而它的语义本来就是**类型无关**（叫 `target` 的文件与目录一样无行），因此这一行的增删事件 MUST NOT 投递。**今日的 `rel_string`（[fs_io.rs:128](../../../src-tauri/src/fs_io.rs#L128)）正是全段判定的行为，本 change 保持不变**。
   > **r2 评审 P1-2 的修法**：早期草案把最后一段从**一切**规则判定中豁免，理由是「行级事件必须实时」。那条理由只对**用户规则**成立——用户规则命中的条目**本来就有行**（惰性可见）。对内置规则豁免会让外部 `cargo build` / `npm install` 产出的 `created:target` / `created:node_modules` 透到前端，而树的 `applyChanges`（[src/tree.ts:772](../../../src/tree.ts#L772)）不做隐藏名过滤 ⇒ 树里插出一行**枚举永远不会产生的幻影行**（子孙事件仍被祖先判定挡下，留下孤零零的死行，重开才消失），违反「增量收敛后的模型与同一时刻的全量枚举一致」与 file-tree 的「内置规则名字不出现在树里」。
2. **用户规则只看祖先，最后一段一律投递**：与内置规则相反，末段是否命中用户规则**不改变「有没有行」这个事实**（命中 ⇒ 惰性行；不命中 ⇒ 普通行），所以两种情况下投递都对；而这一行的出现/消失必须实时（否则用户删掉 `.local` 后树里留一个死行）。加上「祖先必定是目录」这一事实（前缀组件不可能是文件），**用户规则侧一次 stat 都不需要**——目录限定模式（`foo/`）在祖先上可无歧义判定，末段不判也就无从歧义。
3. **用户规则的祖先：未物化 ⇒ 不投递**（`.tower/worktrees/**` 的 agent churn 不进 webview）；**已物化 ⇒ 投递**（用户展开过的地方保持实时，打开中的文档因此照常得到「外部修改」处置）。内置规则的祖先一律丢弃（连行都没有，谈不上展开）。

**投递的事件 SHALL 携带惰性标记**（`FsChange.lazy`）：投递与否由「祖先」决定，但**这一条自身的去向**（惰性 / 普通）另有下游消费者（两处索引增量补丁，§4.6）——所以在同一个判定点把标记算出来带给前端，MUST NOT 让下游各自重算（那会引出第二份规则实现）。

**同一判定在两处跑的机制**：`fs_io` 现在刻意不依赖 tauri 类型（ADR 0002 §7），且过滤发生在 `fs_io::watch` 的回调里。做法是把策略对象**下传**：`fs_io::IgnorePolicy`（纯 std 类型：**一份规则表**——内置规则匹配器 + 用户规则匹配器栈 + `Arc<Mutex<HashSet<PathBuf>>>` 的物化集合）由 `commands.rs` 构造并同时交给 `scan_workspace` / `watch` / `fs_scan_dir` / `expand_new_dir_subtrees` / `validate_new_name`——**一份策略，五个使用点**（REVIEW.md 第 8 条：同一语义只能有一个真源）。

> 实现期性能注记（不改判据）：事件路径的判定现在也走匹配器（内置规则与用户规则各一次），比名字等值贵。若成为热点，允许按「祖先组件 → 判定结果」做进程内缓存，但**语义 MUST NOT 变**（缓存失效面 = 规则重编 + 物化集合变化）。

### 4.5 规则表的来源与生效时点

- **表里有什么**：内置规则（§2.4，产品硬编码）+ 用户规则（`<root>/.gitignore` 与递归途中的嵌套 `.gitignore` + `<root>/.git/info/exclude`，§2.5）。**MUST NOT 读全局 exclude 文件**（`core.excludesFile` 在 vault 之外，读取它等于让 vault 之外的状态影响 vault 内的可见集）。
- **何时读**：vault 装载时（`prepare_vault_open`）编译一次，随 vault 存活。
- **规则文件自身变更的生效时点**：**下一次装载**。本会话不重编。
  依据与代价：① 本仓 `fs_scan_workspace`（全量重扫）**目前没有前端调用方**（走查确认），做会话内热生效要新开「重编 + 重扫 + 前端整体替换模型」一条通道，而它只能在装载路径之外再造一条会改树模型的路径（半刷新风险：规则换了索引没换，或树换了索引没换）；② **用户可感知的后果极小**——惰性化只影响「哪些子树被主动枚举/索引」，**可见集不变**（行永远可见），所以改了 `.gitignore` 之后树的样子本来就不会变，变的只是下次打开要不要为它付费。这条如实写进 spec 的已知边界。
- **若将来要热生效**：方向是「规则文件事件 → 重编 → 走与装载同一条重扫通道」，属独立 change（并需先给前端补全量重扫通道）。

### 4.6 索引口径：惰性条目不进索引（确定性优先）

**口径**：链接索引（`LinkGraph`）与附件索引（`attachmentPaths`）只由**主动枚举**的条目建出；惰性条目一律不进去，包括用户已经展开过的（展开是 UI 动作，MUST NOT 改变索引）。

**为什么不让「展开」把条目补进索引**：那会让同一份文档的 wikilink 解析结果取决于**用户点过哪些目录**（`wikilink-resolution` 的既有条款明写「同一 vault 两次打开的解析结果 MUST 一致（确定性）」）。索引的输入必须是磁盘 + 规则的纯函数，不是 UI 历史。

**watch 增量路径同样适用（r2/r3 评审 P1-3）**：§4.4 的判定让「用户规则命中的条目自身」的事件**必然投递**（行的增删要实时——这是设计意图），而两处索引的增量更新原本是**无分类的全量 upsert**：

- Rust 侧 `VaultState::apply_fs_changes`（[commands.rs:265](../../../src-tauri/src/commands.rs#L265)）：对每条非目录的 created / modified 事件无条件 `graph.upsert`；
- 前端 `main.ts` 的 `fs:entry_changed` 处理（[:1651](../../../src/main.ts#L1651)）：对每条 created / modified 文件事件无条件 `attachmentPaths.push`（既有分支是 `if deleted … else push`，两者同路）。

今天这没问题，因为 `rel_string` 把被忽略的路径全滤掉了；**按来源分开之后**，惰性条目的事件会到达这两处 ⇒ 惰性条目在会话中途进索引。必然触发的例子就在 Alex 的真实 vault 里：他的 `.gitignore` 含 `HANDOFF.md`（§1 自己盘点过）⇒ 任何外部改写它都会让它进 `LinkGraph` ⇒ `[[HANDOFF]]` **本会话内可解析、重开后不可解析**——索引从「磁盘 + 规则的纯函数」退化成「事件历史的函数」，正是本条与 spec 的确定性条款禁止的。

**口径（收敛成一句话）**：**投递的事件 MUST NOT 让惰性条目进入索引**。

- 事件 payload（`FsChange`）SHALL 携带**惰性标记**（`lazy`，与 `FsEntry.lazy` 同义；第二处 ts-rs 导出面变更），由后端在过滤/投递那一步用同一份规则表算出（created / modified 时条目类型由 `entry_kind` 已知，可精确判定）。
- 两处索引补丁 SHALL 跳过 `lazy` 事件：created / modified 且 `lazy` ⇒ 不 upsert / 不 push；**deleted ⇒ 无条件移除**（幂等：本来不在索引里就是空操作，因此删除方向不需要判类型，也就绕开了「被删路径 stat 不到、目录限定模式判不准」的歧义——该方向 MUST NOT 消费 `lazy`）。
- 树照常收行（惰性行的可见性不受影响）。

**后果（如实记，写进 spec 的已知边界）**：

- 指向惰性区域的 `[[wikilink]]` 解析为 `unresolved`；`![[img.png]]` 若图片在惰性目录里同样找不到。用户在树里点开那个文件**照常可读**（打开链路是路径直读，不查索引）。
- `wikilink_create`（`wikilink-resolution` 的既有行为）按确定性路径创建空文件、目标已存在则报错——它**不做全 vault 搜索**。因此对一个「真实存在于惰性目录、但索引里没有」的名字点「创建」，会产生一个**重复文件**。这条风险在今天就存在（任何未索引的名字都如此），B 案只是把触发面变宽；本 change 不改 `wikilink_create`，把它记为已知边界与后续候选（若日后要收，方向是「创建前做一次有界的同名探测」）。

### 4.7 六个消费点的口径（逐一交代，不留隐含假设）

| 消费点 | 口径 | 动作 |
|---|---|---|
| 文件树模型（`src/tree.ts`） | 显示**全部**条目（含惰性行）；惰性目录的子孙按需拉取 | 改：展开惰性目录 → `fs_scan_dir` 合并；`lazy` 标记区分空目录 |
| 链接索引（`VaultState::build_graph` + `apply_fs_changes`） | 只由主动枚举的条目建出；**增量路径**同样跳过惰性条目（created / modified 且 `lazy` ⇒ 不 upsert；deleted ⇒ 无条件移除） | 改代码（两行）：`apply_fs_changes` 消费 `FsChange.lazy` |
| 附件索引（`src/main.ts` 的 `attachmentPaths`） | 同上（增量路径跳过 `lazy` 的 created **与 modified**——既有分支是 `if deleted … else push`，两者同路；deleted 照旧移除） | 改代码（一行）：`fs:entry_changed` 处理里判 `change.lazy` |
| 会话恢复的「在不在 vault 内」（`src/vault-switcher.ts` 的 `restorePlan`，[:145](../../../src/vault-switcher.ts#L145)） | **不再只看枚举集合**：条目集里没有的路径，补一次 vault 内存在探测（只探测会话里的那几条路径，不改写任何文件）；存在即照常恢复 | 改：新增**批量**存在探测（§4.11），跳过计数仍**由枚举 + 探测的结果在装载完成时给出**（口径不变，来源多一个） |
| 阅读位置（`src/reading-position.ts` 的 `onVaultLoaded`，[:241-266](../../../src/reading-position.ts#L241)） | **同样不能再只看枚举集合**（r2 评审 P1-1 更正了本文早先「与集合无关 → 不改」的错误论断）：它从 `entries` 建 `available` 并对**存量键**跑 `pruneEntries`，而惰性文件（如 `.local/教程.md`）永不在枚举里 ⇒ 它们的阅读位置**每次装载都被剪掉**、随后 flush 持久化 | 改：prune 判据与会话恢复同口径——条目集里没有的键先过一次**批量存在探测**（§4.11），存在即保留；探测失败才剪 |
| watch 事件过滤（`fs_io::rel_string`） | 见 §4.4 | 改 |

> 这两条不是洁癖：**没有它们，用户从 `.local` 打开的教程会被系统丢掉两次**——下次启动时被 `restorePlan` 判成「已删除」并跳过（会话里没有这个标签了），而且它的阅读位置在**每次装载**时都被 `pruneEntries` 剪掉（读了也白读）。两条都正中 Alex 裁决里的原话场景，口径必须一起改。

### 4.8 匹配器选型：引 `ignore` crate（新依赖）

| 方案 | 优点 | 缺点 |
|---|---|---|
| **`ignore` crate（推荐）** | gitignore 语义完整（`!` 取反、`/` 锚定、`**`、目录限定、注释、转义、大小写规则），与 ripgrep 同源、被广泛验证；用它的 `gitignore` 模块即可，不必换掉自己的遍历实现 | 新增依赖（连带 `globset` 等传递依赖）；需要在依赖评审里过一遍 |
| 手写子集 | 零新依赖 | 子集必然猜错：`!` 与排除目录的交互、锚定边界、`**` 语义、注释转义——**猜错的后果是「该隐藏的没隐藏」（性能回落）或「该显示的没显示」（正是 Alex 这条约束要防的）** |

选 `ignore`：这条约束的产品语义是「按用户写的规则办事」，规则解释错了就等于产品承诺没兑现。

**合并之后它同时承担两件事**：内置规则与用户规则**编进同一类匹配器**（内置规则用 `GitignoreBuilder::add_line` 喂字面量，见 §2.3），判定链只有一条（§2.2）。于是「少一种硬编码特例」落到实处：不再存在「名字等值」与「规则匹配」两套实现，也不需要为内置名单写第二套分支。

**这是本 change 唯一的依赖新增**，已随「接受完整影响面」一并确认（2026-09-28，经 tower 转达）。

### 4.9 边界（如实记，且写进 spec）

- **非 git 仓库的 vault**：只要存在 `.gitignore` 就按它判（`.gitignore` 的存在本身就是用户的声明）；`.git/info/exclude` 只在 `<root>/.git` 是**目录**时读。
- **`.git` 是文件**（linked worktree 的 gitlink）时：不读 `info/exclude`（真身在 gitdir 里，跟着 gitlink 走会把 vault 边界外的配置读进来）。
- **不读全局 excludes**（§4.5）。
- **大小写**：匹配器按 gitignore 的规则解释（默认大小写敏感），与今日名字等值判定的逐字节口径同向；本 change 不引入折叠匹配。
- **取反不推翻内置规则**：用户 `.gitignore` 里的 `!target/` 不会把内置规则命中的 `target` 放回可见集（论证见 §2.6）；用户规则**可以**取反用户规则（`drafts/` 忽略 + `!drafts/keep/` 放回）。
- **同名文件语义不变**：内置规则写成无尾斜杠字面量 ⇒ 名为 `target` 的**文件**同样不可见（与今日一致，§2.3）；用户规则的 `foo/` 与 `foo` 按 gitignore 语义各自解释。
- **两份用户来源的优先级**：深层 `.gitignore` > 浅层 `.gitignore` > `info/exclude`（git 口径，§2.5）。
- **符号链接**：现状「指向目录的 symlink 不递归展开、按文件列出」不变。
- **vault 根自身的名字**：不参与判定（vault 根叫 `target` 也照常打开）——两类规则都只看根以下的组件。
- **惰性子树内部**：不读它的 `.gitignore`（祖先已排除，结论不会变，见 §4.2）。

### 4.10 两个用例走查（Alex 的两个现场）

**例 1：`.local/教程.md`（在 `.git/info/exclude` 里）**
打开 vault → 枚举 `.local` 这一条（`lazy: true`，不进去）→ 树里出现 `.local` 行 → 用户点开 → `fs_scan_dir(".local")` 返回 `教程.md`（不递归）→ 用户点开读。打开段为它付的钱：**一次 dirent 读取**。打开中的 `教程.md` 若被外部改写：因为 `.local` 已被物化，事件正常投递 ⇒ 外部修改提示照常。
**代价**：`[[教程]]` 在别处写会解析为 `unresolved`（§4.6）。

**例 2：`.tower/`（275,180 文件 / 35G，在 `.git/info/exclude` 里）**
枚举出 `.tower` 一行（`lazy: true`）→ 打开段为它付的钱：一次 dirent 读取；active 枚举从 170,317 文件掉到 **1,658**（M289 实测 66ms）。用户不点它，agent 的 churn 一个事件都不进 webview（未物化）；他真点了，就按层付费（`.tower` → `worktrees` / `comms` → …，每层一次 `read_dir`）。

### 4.11 `fs_paths_exist`：被枚举集之外的存在探测（两个消费点共用的读口）

§4.7 的会话恢复与阅读位置都要问同一个问题：「这个路径在 vault 里还在吗？」——而它**不在装载时的枚举结果里**（惰性可见的文件永不进枚举）。实现口径：

- **新增一条批量命令 `fs_paths_exist(paths)`**：收一组 vault 相对路径，返回其中**确实存在**的那些（每条都过与读取路径同源的 vault 内校验；只 stat、不改写任何文件，ADR 0003 的「不改写源文件」不因它放宽）。
- **为什么批量而不是逐条**：两个消费点的候选数都不小（会话条目数；阅读位置镜像的键上限见 `READING_POSITION_MAX_ENTRIES = 200`），逐条走 IPC 会把 N 次往返叠在装载路径上。一次命令、一次往返、N 次 stat（每条 ~µs 级）——上界因此是**可算的**，且不随 vault 规模增长（只随「用户读过/开过多少条目」增长）。
- **为什么不复用现成的 `fs_file_mtime`**（[commands.rs:664](../../../src-tauri/src/commands.rs#L664)）：它是**单路径**命令、且语义是「取 mtime」（doc-meta 用），逐条调用即回到 N 次 IPC 往返；本 change **不新增**第二种「按路径读元数据」的语义，只加一个专用的存在探测。
- **口径**：探测结果是「存在 / 不存在」二值；返回集合里没有的路径即「不在 vault 内」（会话恢复计入跳过、阅读位置被剪）。探测本身**MUST NOT** 被用来放宽任何边界（越界路径一律视为不存在并拒读）。

## 5. 打开段与按需枚举移出 IPC 主线程

### 5.1 机制核实（读 tauri 2.11.5 / tauri-macros 2.6.3 源码，不靠记忆）

- 宏对「同步函数 + `async` 上下文」的处理路径：`ExecutionContext::Async if function.sig.asyncness.is_none() => "sync_threadpool"`（`tauri-macros-2.6.3/src/command/wrapper.rs:264`，cargo registry 路径 `~/.cargo/registry/src/index.crates.io-*/`）。
- 生成的 body 是一个 `async move`（`wrapper.rs:388` 的 `body_async`），交给 `resolver.respond_async_serialized(...)`；该函数在 `tauri-2.11.5/src/ipc/mod.rs:371` 的 `respond_async_serialized_inner` 里走 `crate::async_runtime::spawn` ⇒ **body 在 async 运行时（tokio 多线程）里执行，不占 IPC 主线程**。
- 顺带的一层：返回值的 JSON 序列化也在同一个 spawn 出来的任务里——`ResultTag::future` 调 `value...?.body()`（`tauri-2.11.5/src/ipc/command.rs:265`），而 `impl<T: Serialize> IpcResponse for T` 的 `body()` 就是 `serde_json::to_string`（`tauri-2.11.5/src/ipc/mod.rs:183`）。同步 command 走的是 `ResultTag::block` → `resolver.respond(value)`（`command.rs:250`），即在主线程上序列化。**所以 async 化同时把「20 万条目的 VaultInfo 序列化」移出主线程**（M289 的 survey 写「响应序列化仍在主线程侧」，这一句按源码不成立——本 change 以源码为准，实现期别照抄 survey 那一行）。

### 5.2 先例与风险

`vault_open`（目录选择器那条 path，[commands.rs:590](../../../src-tauri/src/commands.rs#L590)）本来就是 `async fn`，跑的是同一段 `open_vault` 工作，已经在生产里验过（多 vault 切换、注册表 remap、启动恢复都触发它）。本 change 做的是**把 outlier 拉平**：`vault_open_path` 与新的 `fs_scan_dir` 都标 `#[command(async)]`。

- 并发/顺序语义：前端 `inFlight` 串行化 + `commit_vault_open` 单次持锁提交不变；`prepare_vault_open` 里的注册表写（`reconcile_vault`）本来就与 `vault_open` 路径同源。
- 已知不完美：body 里是**阻塞式文件 IO**（读目录、读 md），跑在 async 运行时的 worker 上会占住一个 worker（不是 `spawn_blocking`）。同仓 `vault_open` 已是这个形态；本 change 与它保持一致，**不**引入 `spawn_blocking`（那是形态分叉，且没有读数表明需要）。
- 剩下仍在主线程的：command 的参数解析（`parse_args`）与最后一步「把响应投递给 webview」。payload 的 `JSON.parse` 在 webview 主线程（§7）。
- 按需枚举的并发：两次展开同一目录 / 展开与全量重扫并发时，按「后到者以磁盘现状为准」合并（前端按路径去重，§9 的验收只判终态）。

## 6. 分段读数与「真机 5.5s vs 合成 3.1s」的 2.4s 缺口

### 6.1 缺口是什么

真机日志 09-28 的 `vault_load_open` = 5,501ms（另两条 12,416 / 12,695ms），而同形状合成的 scan+graph = 3,110ms。候选解释（M289 排序，均未坐实）：① 冷缓存（194k 条元数据 + 171MB md 不在页缓存里；同路径读数跨度 48× 指向缓存/负载主导尾部）；② 真 vault 路径更深（`canonicalize` 逐组件解析）；③ Tauri/macOS 对大 payload 的额外编码。**区分 ①②③ 只能靠在同一条真机路径上分段读数**。

### 6.2 加哪几条，口径是什么

**加 2 条（读数），不是 4 条**：

| 读数名 | 落点 | 覆盖 | 阈值 |
|---|---|---|---|
| `vault_open_scan` | `prepare_vault_open` 里 `scan_workspace` 前后打点 | 全量枚举 | **无条件记录** |
| `vault_open_graph` | 同函数里 `build_graph` 前后打点 | 建链接索引 | **无条件记录** |

口径沿用 M283 的 `vault_open_watch`：走 `logging::slow_callback`（事件名 `slow_callback`、字段 `name` / `ms`，白名单不新造字段），**刻意不设阈值**——理由同源：「日志里没有这一行」与「它很快」事后不可区分，阈值会把「没超阈值」写成「没有读数」；vault 打开是低频动作。

**按需枚举另有一条（有条件，阈值 250ms）**：`vault_scan_dir`——一次展开若超过 250ms，用户会看到明确的等待，值得留一条读数（阈值口径与前端 `phaseMs` 一致；低频、不稀释日志）。它**不是**本 change 的性能目标，只是「用户点了大目录」这件事的可观测面。

**为什么不另加「serialize / IPC」两条**：它们与前端既有的 `vault_load_open`（`phaseMs`，250ms 阈值；见 [src/main.ts](../../../src/main.ts)）是同一段，做减法即可：`序列化+传输+解析 ≈ vault_load_open − scan − graph`。要单独测序列化得让 command 返回**预序列化的 raw response**（Tauri 有 `tauri::ipc::Response` 这条通道，`tauri-2.11.5/src/ipc/mod.rs:190`），那会把 `VaultInfo` 的响应形态改掉 + 前端手工 `JSON.parse`——**本 change 不做**（收益是「多一条读数」，成本是改契约；且 async 化之后序列化已不在主线程上，它不再是我们关心的时间线）。

### 6.3 2.4s 的归因指望什么

真机跑一次之后：`vault_load_open`（前端总时长）− `vault_open_scan` − `vault_open_graph` ≈ 序列化 + 传输 + `JSON.parse`。若这个残差很小（预期 ≪ 100ms），而合成 scan+graph 只有 3.1s ⇒ **剩下的就是「同一段代码在真 vault 上比合成慢」**，即 ①/② ——那属于「冷缓存与路径深度」，不是本 change 要修的（它只影响首次打开，且 async 化之后不再冻结界面）。若残差很大，则 ③ 成立，需要另立 change（raw response / 分片传输）。

## 7. 前端侧的两段剩余边界

1. **装载后的装配段**：打开段结束（响应到达）之后，webview 主线程上还有 payload 解析 → `applyVault` → `tree.setVault`（给全部条目建节点表）。本 change 不动它；收窄可见集之后它的输入同步变小（27MB → 0.19MB），是**间接**收益，没有直接实现改动、也没有独立读数。
2. **按需展开这一段（本 change 新增的等待面）**：用户展开一个惰性目录时，`fs_scan_dir` 是异步的，返回前该目录在树里处于「展开但还没有子行」的一拍。要求：MUST NOT 阻塞主线程（§5.2）、MUST NOT 把这一拍渲染成「空目录」（靠 `lazy` 标记区分）、展开结果 MUST NOT 覆盖用户在同一拍里做的别的操作（按路径合并）。**不引入加载指示文案**（本 change 的文案增量为零；若实现期发现确需，按 deck 末位取号）。

## 8. 未验项与已知边界（照录，别读成「已覆盖」）

- **真机全链路的分段读数**：本 change 之前，真机只有 `vault_load_open` 一条（合成侧才有 scan/graph 直测）。§6 的埋点是**闭合它的手段**，读数本身要等实现后真机跑一次才有。
- **B 案在真机上的收窄幅度**：66ms 是 M289 在合成形状上**手工收口**（把目标目录移走）得到的读数，不是「读 `.gitignore` / `info/exclude` 之后」的读数——实现后必须用同一 harness 复测一次（tasks 3.2），不得把 66ms 直接写成实现结论。
- **惰性展开的真机成本分布**：`.tower/worktrees` 那类目录一层多少条、一层多少 ms，没有读数（`vault_scan_dir` 埋点就是为了它）。
- **前端装配段与树模型的耗时**：没有读数（`vault_load_tree` 三天日志零出现 ⇒ 与 250ms 阈值相比无意义；但没有真值）。
- **「内置规则误伤」的真实发生率**：无法测——本 change 只保证诊断日志里能读到忽略计数（§3.3），不保证体验上可发现。
- **惰性条目的解析降级率**：无法测（依赖用户的链接习惯）；口径已定（§4.6），后果已写进 spec。
- **`wikilink_create` 对惰性目标可能造出重复文件**：既有行为，B 案把触发面变宽（§4.6）；本 change 不改它。
- **规则不热生效**：改了 `.gitignore`（或改了 `vault.rule_files`）本会话不重编（§4.5 / §2.9）；可见集不变，只影响「哪些子树被主动索引」。
- **`vault.rule_files` 的真机覆盖**：本 change 不新增套件的场景配置键，配置项语义由单测覆盖（真机场景 67 走默认列表）；「配置项在真机上生效」这件事**未验**。

## 9. 真机场景 67 的判据设计

### 9.1 为什么「指示可动」的可判定形式是「打开段内 AX 可读」

M283 在场景 60 里实测到：套件读 AX 需要主线程空闲，而打开段（同步 command）阻塞期间 `get_app_state` 只回 `element_count: 1`（读不到任何节点）⇒ 当时「指示在场」这条正观测**在真机上不可判定**，只能改由探针承担。本 change 把打开段移出主线程之后，**同一件事从「读不到」变成「读得到」**，那条被撤下的正观测因此可以立起来：

- **判据**：点开目标 vault 之后、装载完成之前的**一次 AX 快照**里，`AXProgressIndicator` 与文件树节点同时可读。
- **修前行为**：该快照读不到任何节点（主线程被 body 占住）⇒ 判红。**修后**：异步执行，AX 可答 ⇒ 判绿。
- **为什么不是「动画帧在推进」**：一次 `get_app_state` 的往返是秒级（M283 实测采样点约在动作后 4.1s），逐帧判动画没有通道；且 spec 的判据本来就是「在场」（M252 立的口径，本 change 不改）。**MUST NOT** 把「读不到」写成「不在场」（REVIEW.md 第 2 条）。

### 9.2 为什么必须有测量放大器

收窄可见集**本身**就把打开段从秒级压到毫秒级——这是本 change 的目的，但它同时把「打开段内可观测」这个窗口抹掉了。所以场景必须自带放大器（沿用场景 60 的 20×8MB 稀疏 md 口径，把打开段撑到 ~7.5s ≫ 一次 AX 往返），**并且**这个放大器是测量工具不是产品场景：**MUST NOT** 拿该场景日志里的 `vault_load_open` 当规模读数（场景 60 已立此惯例，这里照抄）。

### 9.3 场景里的三组判据（Alex 裁决后更新）

1. **内置规则**：根级 `target/` / `dist/` / `test-results/` 探针**不在**树里；且 fixture 的 `.gitignore` 里写一条 `!target/`（取反）——它**同样不能**把 `target` 放回树里（§2.6 的口径在真机上也有判据）。
2. **用户规则（Alex 的新约束，本场景新增）**：vault 里放一份 `.gitignore`（声明 `.local/` 与一条取反 `!target/`）与 `.git/info/exclude`（声明 `.excluded-dir/`），两者各带一个 md：
   - 两个目录**行在树里**（正向断言，不许写成「读不到 ⇒ 不在」）；
   - 展开 `.local` ⇒ 其中的 md **出现在树里**、可打开（`editor.has` 到内容）；
   - 这一对正负断言同场，且**同一快照里还要有可见的真内容行**作正向见证（REVIEW.md 第 2 条）。
3. **打开段内界面可响应 + 读数落盘**：同 §9.1 与 §6.2。

### 9.4 场景的放大器与惰性探针会不会互相干扰

不会：放大器是 vault 根下的**可见** md（不被任何规则命中），惰性探针在 `.local` 之下（不可见地枚举、只在展开时付钱）。**MUST NOT** 把放大器放进 `.local`——那会把「测量放大器」与「惰性子树」两件事混在一起，读数与判据都失去区分度。

## 10. 落地地图（文件 / 符号级）

| 落点 | 改动 | 依据 |
|---|---|---|
| `src-tauri/Cargo.toml` | 新增依赖 `ignore`（只用它的 `gitignore` 模块） | §4.8 |
| `src-tauri/src/fs_io.rs` `IGNORED_NAMES` **退役** | 改为内置规则表（16 条名字字面量 + `.*.lumir-*`），编进匹配器；`is_ignored` 的名字等值判定下线（等价性由对拍测试钉住） | spec delta；§2.1 / §2.3 |
| `src-tauri/src/fs_io.rs` `IgnorePolicy`（新） | **一份规则表**：内置规则匹配器 + 用户规则匹配器栈 + 物化集合（纯 std 类型，不引 tauri），提供 `classify()`（来源决定去向） | §2 / §4.4 / §4.2 |
| `src-tauri/src/fs_io.rs` `scan_workspace` | 按 `classify()` 出 `lazy` 行、不递归；给 `FsEntry` 填 `lazy` | §4.2 |
| `src-tauri/src/fs_io.rs` `rel_string` | 换成 §4.4 的逐组件判定（内置规则祖先丢弃、用户规则祖先未物化丢弃） | §4.4 |
| `src-tauri/src/fs_io.rs` `fs_scan_dir`（新） | 一层枚举 + 同源分类 + 物化登记 | §4.3 |
| `src-tauri/src/fs_io.rs` `expand_new_dir_subtrees` / `validate_new_name` | 沿用 `IgnorePolicy`（内置规则照旧拒绝；用户规则命中的名字不拒绝） | §3.2 / spec delta |
| `src-tauri/src/fs_io.rs` 枚举收口 | 新增`VaultScanIgnored` 忽略计数（含 `LogEventName` 白名单登记） | §3.3 |
| `src-tauri/src/commands.rs` `prepare_vault_open` | 读配置 `vault.rule_files`（缺省用默认列表）、编译用户规则、构造 `IgnorePolicy` 并交给 watch / scan / graph；scan / graph 两处打点 | §2.9 / §4.5 / §6.2 |
| `src-tauri/src/config.rs` `AppConfig.vault` / `VaultConfig`（新） | 新增 `[vault]` 节与 `rule_files`（`#[serde(default)]` + 默认列表）；非法项逐项忽略并给人话 warning（`config_warning` 事件族），不得导致启动失败 | §2.9 |
| `src-tauri/src/commands.rs` `vault_open_path` | 加 `#[command(async)]`；注释写明线程语义已与 `vault_open` 拉平 | §5 |
| `src-tauri/src/commands.rs` `fs_scan_dir` command（新） | `#[command(async)]` + vault 内路径校验 + 打点 | §4.3 / §5.2 / §6.2 |
| `src-tauri/src/commands.rs` `VaultState` | 持有当前 `IgnorePolicy`（含物化集合）；装载时重建 | §4.3 / §4.4 |
| `src-tauri/src/commands.rs` `fs_paths_exist`（新） | 批量存在探测（vault 内路径校验 + 只 stat）；供会话恢复与阅读位置共用 | §4.11 |
| `src/bindings/**`（ts-rs 重导出） | `FsEntry` 新增 `lazy`（§4.3）与 `FsChange` 新增 `lazy`（§4.6）——**两处导出面变更** | §4.3 / §4.6 |
| `src-tauri/src/commands.rs` `apply_fs_changes` | 增量索引跳过惰性条目：created / modified 且 `lazy` ⇒ 不 upsert；deleted ⇒ 无条件移除 | §4.6 |
| `src/main.ts` 的 `fs:entry_changed` 处理 | 附件索引增量跳过 `lazy` 的 created / modified 事件（deleted 照旧无条件移除） | §4.6 |
| `src/tree.ts` | 惰性目录展开走 `fs_scan_dir` 并按路径合并；`lazy` 与「空目录」区分 | §4.7 / §7.2 |
| `src/main.ts` | 装配新命令；附件索引口径（只由主动枚举建出）保持并写注释 | §4.6 / §4.7 |
| `src/vault-switcher.ts` `restorePlan` | 「在不在 vault 内」补批量存在探测（条目集 + 探测），跳过计数口径不变 | §4.7 / §4.11 |
| `src/reading-position.ts` `onVaultLoaded` | `pruneEntries` 前对「不在条目集里」的存量键补同一次批量存在探测，存在即保留（r2 评审 P1-1） | §4.7 / §4.11 |
| `scripts/acceptance/lib/app.mjs` `generateBulkVault` | 加构建产物族探针（内置规则）+ `.gitignore`（含一条取反）/ `.git/info/exclude` 用户规则探针 | §9.3 |
| `scripts/acceptance/scenarios/67-*.md` | 新场景（草案见本 change 的 `acceptance-scenario.md`） | §9 |
| `docs/backlog.md` | 待归档跟踪；M289 读数落 canon（现在只在 `.tower/comms/` 的 inbox 消息里）；`wikilink_create` 的重复文件风险与「规则热生效」两条后续候选 | proposal「影响」 |

## 11. 影响面清单（AGENTS.md「影响面升级线」的对账，2026-09-28）

Alex 裁决 2 的「忽略项必须可见」**推翻了本仓一条既有同一性**：「枚举结果 = 可见集 = 文件树的数据来源」（写在 `fs-io` 与 `file-tree` 的 canonical 文本里，且是六个消费点的隐含前提）。下表是本次改动对既有设定 / 逻辑 / 实现的影响面，供节点 1 一并确认：

| # | 既有设定 / 实现 | 本 change 之后的形态 | 影响级别 |
|---|---|---|---|
| 1 | 忽略集 = 不可见集（fs-io 的 SHALL 条款 + file-tree 的「数据来源 = 枚举结果」） | 来源决定去向：内置规则 ⇒ 不可见；用户规则 ⇒ 可见但不主动枚举；两条 canonical 文本都改写 | **推翻既有设定**（跨 2 个 capability 的措辞与 6 个消费点的口径） |
| 2 | 树模型 = 枚举快照（`setVault` 一次性建满） | 快照 + 按需层（展开惰性目录发命令合并） | **改实现结构**（前端） |
| 3 | watch 判定 = 名字的纯函数（无状态、可在 fs_io 内自洽） | 需要策略对象 + 物化集合（跨层传、有生命周期、随 vault 重建） | **改实现结构**（后端） |
| 4 | 依赖面：`Cargo.toml` 无 ignore 类依赖 | 新增 `ignore` crate（§4.8）——**合并之后它同时承载内置规则与用户规则** | **新增依赖**（已确认接受） |
| 5 | 导出面：`FsEntry` 是「路径 / 类型 / 大小 / mtime」四元组；`FsChange` 是「kind / path / entry_kind」 | 两者各新增 `lazy` 字段（**两处** ts-rs 重导出 `src/bindings/**`） | **改契约**（前端全部消费点重新编译即得，行为面已逐条列在 §4.7） |
| 6 | 「在不在 vault 内」= 在枚举集合里（两个消费点：会话恢复的 `restorePlan`、阅读位置的 `pruneEntries`） | 集合 + 批量存在探测（`fs_paths_exist`） | **改判据**（不改用户可见语义：仍是在 vault 里的文件才恢复 / 才保留位置；新增一条只读命令） |
| 7 | 链接 / 附件索引覆盖「vault 里的一切」 | 覆盖「主动枚举的那部分」；惰性区域解析降级（含 `wikilink_create` 的重复文件风险） | **收窄能力边界**（写入 spec 的已知边界） |
| 8 | 忽略判定 = 名字等值（`is_ignored`）+ 一条独立的 VCS 规则路径（B 案原形态会是第二套机制） | **合并成一份规则表、一个匹配器**（内置规则也编进匹配器）；来源决定去向（内置不可见 / 用户惰性可见）；`is_ignored` 的名字等值判定退役 | **改实现结构**（消掉一种硬编码特例；语义等价由对拍测试钉住——含「同名文件也隐藏」不改判） |
| 9 | 配置面：`config.json` 只有 `version` / `last_vault` / `editor` / `ui` / `keys` / `log`（无 vault 行为配置） | 新增 `[vault]` 节与 `rule_files`（用户规则来源清单，默认 `[".gitignore", ".git/info/exclude"]`）；内置规则**不在**配置面内 | **新增配置面**（ADR 0002 §5 配置即数据；Alex 定案第 7 条「两个都要」） |

**没有变的部分（同样明确）**：vault 内路径约束（ADR 0002 §3 的安全边界）、附件大小上限、保存链路与 CAS、watch 的 debounce 与自身写盘回声判据、性能合同数字（ADR 0002 §6）、文案 deck（零新增）；**以及内置规则在语义上的等价承诺**——「任意深度 / 同名文件与目录一视同仁 / 大小写敏感 / `.lumir-` 临时文件不进树」逐条与今日一致（§2.3，由对拍测试钉住，不是口头承诺）。**本清单已于 2026-09-28 经 tower 转达 Alex 并经他确认接受**（含 `wikilink_create` 触发面变宽与惰性区域的解析降级）；下面这段回退口径保留为记录——若日后要回收，按它执行，不静默缩水。回收档位：**只保留内置规则扩集与 async 化**（回到 2840bc1 的形态，B 案另立 change），届时 spec delta 与 tasks 按提案的裁决改法一并回退。
