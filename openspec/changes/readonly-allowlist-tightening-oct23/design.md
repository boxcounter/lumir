# Design: 只读白名单的能力断言与逐成员收紧

- Change ID: `readonly-allowlist-tightening-oct23`
- 日期: 2026-10-23
- 分支基线：master `40e6ae01`（行号是起草时在该基线上逐一读过的位置；实现前以符号名为准）

本文只写「怎么做到 proposal 已裁的行为」与「为什么这样做」。所有安全判据按**输入分布**表述
（任意 argv、任意仓库配置），不按 finding 里的四个案例打补丁。

## 0. 事实清单（起草时核对过原文 + 本机实测）

| 事实 | 锚点（master `40e6ae01`） | 与本 change 的关系 |
|---|---|---|
| 只读分类在模式层三档一律 Allow | `src-tauri/src/harness/permissions.rs:191-205`（`mode_layer` 的 `cli_run` 分支） | 这是「白名单成员免闸」的实现位置；判据一错，三个档一起漏 |
| 只读白名单 28 条（含 `base64`） | `permissions.rs:250-254`（`READ_ONLY_COMMANDS`） | 逐个成员的处置表见 §3 |
| 已知写动词 24 条 / 解释器 / shell 包装器 / 危险黑名单 | `permissions.rs:259-284`、`:289`、`:294-308`、`:312`、`:315` | 本 change 不新增成员、不改层序，只补参数级形态 |
| shell 元字符保守归写 | `permissions.rs:320`、`:352-357` | 写/执行形态都不含元字符，因此在这条之后仍会漏；拒判必须放在返回只读之前 |
| 分类判序 | `permissions.rs:327-392`（`classify_cli`） | 落点：危险判定的参数级扩展 + 返回只读前的写形态检查 |
| `sed` 现有判据只看 `-i` | `permissions.rs:377-386` | `w` / `W` / `e` 与 `-f` 全不在判据里；捆绑短选项也会绕过 `-i` |
| `git` 子命令取「第一个非 flag 参数」 | `permissions.rs:604-609`（`git_subcommand`）、`:613-667`（`classify_git`） | `-c` 的值被误当子命令（巧合安全）；`--git-dir=` 等被放过 |
| 写目标提取按命令族 | `permissions.rs:770-808`（`write_targets`） | 新增写形态要补提取，否则 vault 内写会掉成普通写（§5） |
| 间接包装器递归复用 `classify_cli` | `permissions.rs:467-526`、`:542-587` | `sudo base64 -o …` 自动继承收紧，无需另写判据 |
| `cli_run` spawn：stdout/stderr 管道，stdin 不设置（继承 app） | `src-tauri/src/harness/tools.rs:1209-1230` | `less` 非交互、stdin 非管道 ⇒ `-o` 与 `+cmd` 当前不可达（§3 的 less 行） |
| 主体串 = argv 用空格拼接 | `src-tauri/src/harness/tools.rs:364-378`、`:387-393` | 参数级拒判必须看 argv；主体串拼接后无法可靠还原 argv |
| `fs_patch_file` 不查 hidden 档 | `src-tauri/src/fs_io.rs:1559-1576`；对照 `:879-908`、`:803` | 与 git 可达链有关；已单列 finding，不在本 change scope |

### 0.1 本机实测记录（2026-10-23，合成目录，无真实 vault 内容）

平台：macOS 26.6.2、git 2.50.1 (Apple Git-155)、ripgrep 15.2.0、file 5.41、BSD sed / BSD base64。

| 探针 | 结果 |
|---|---|
| `base64 -i a.txt -o b64.out` | 写出 17 字节；`base64 -o b64.out a.txt` 报 `invalid argument`（输入要用 `-i`） |
| `sed -n 'w sed-w.out' a.txt` | 写出 12 字节 |
| `sed -n -f script.sed a.txt`（脚本内容 `w sed-f.out`） | 写出 12 字节 |
| `sed -ni 's/hello/bye/' inplace.txt` | BSD sed 把 `-ni` 解析成 `-n` + 脚本 `i`，报语法错误；**GNU sed 会把 `-ni` 当 `-n -i`**（捆绑旗标在 GNU getopt 下成立） |
| `rg --pre /usr/bin/touch needle .` | `touch` 被执行（flag 文件 mtime 前进） |
| `rg --pre ./pre.sh needle .`（脚本 `touch flag; cat "$1"`） | 脚本被执行，flag 文件落盘 |
| `rg --hostname-bin=./hostbin.sh needle .` | 脚本被执行 |
| `git config core.fsmonitor ./fsmon.sh` 后 `git status` | 脚本被执行（flag 落盘） |
| `git config diff.external ./extdiff.sh` 后 `git diff` | 脚本被执行 |
| `git --git-dir=… --work-tree=… diff`（目标仓库 config 设 `diff.external`） | 脚本被执行 |
| `git -c diff.external=… diff`（空格形态） | 脚本被执行；**但当前分类器把它判成写**（`-c` 的值被当子命令），不是只读绕过 |
| `git -cdiff.external=… diff`（粘连形态） | git 自己报 `unknown option: -cdiff...` |
| `xxd -r -p hex.txt out.bin` | 写出 6 字节 |
| `xxd a.txt out.hex`（普通 dump，两个位置参数） | 写出 64 字节；`xxd -c 16 a.txt`（取值旗标 + 单位置参数）不落盘；`xxd - out.hex` 同样写（`-` 计输入位置参数） |
| `file -C -m magicdir/mymagic` | 在**当前目录**写出 `magic.mgc`（不是 `-m` 指定路径旁边） |
| `find . -fls out` / `find . -fprint out` | 本机 BSD find 报 `unknown primary or operator`；GNU find 支持（本 change 仍覆盖，分类器是文本级、跨平台） |
| `less -o out a.txt` / `less '+!touch flag' a.txt`（非 tty、stdin 非管道） | 均无落盘，进程不阻塞 |

### 0.2 finding 第 4 条的更正

finding 原文把 `git -c diff.external=/tmp/evil diff` 列为只读绕过。实测与代码对照：**按字面不成立**
——`git_subcommand` 取第一个非 flag 参数，`-c` 的取值 `diff.external=/tmp/evil` 被当成子命令，落
「未知 ⇒ 写」（`permissions.rs:605-609`、`:665`）。粘连形态被 git 自己拒绝。

但该条指向的风险真实存在、且更强：`--config-env=` / `--git-dir=` / `--work-tree=` 这类「值在等号
后」的全局 flag 不产生非 flag 参数，子命令仍被认成 `diff` / `status` ⇒ 判只读；而**不需要任何
argv 花招**的形态是仓库自身 config——`core.fsmonitor` 让 `git status` 执行程序、`diff.external`
让 `git diff` 执行程序（§0.1 实测）。仓库 config 的内容不在 argv 可见范围内，这是 git 处置
（Q1）必须回答的问题，也是本设计不把 git 归入「补几个 flag 就完事」的原因。

## 1. 不变量（判据的唯一表述）

**P（只读的能力断言）**：一次 `cli_run` 被判为只读，当且仅当该分类对**任意 argv** 成立：
这次调用不写文件、不执行外部程序（不 spawn 由该命令自行启动的程序）。

推论：

1. 白名单不是「安全命令清单」，是「**在可静态证明的形态子集内**不写不执行的命令清单」。成员名
   只决定「值得做形态判定」，不决定结论。
2. 判定必须 fail-closed：形态判不明确 → 降为写（问一次），MUST NOT 升为只读。
3. 执行能力与写能力分档：执行能力 → 危险（任何档都问，含 `full_access`）；写能力 → 写（按模式
   默认分层，`full_access` 免闸）。这与既有三档语义一一对应：`full_access` 的承诺是「写免问、
   危险仍问」，不是「任意命令执行免问」。
4. 判据的输入是 **argv + 执行环境**，不是主体串（空格拼接会丢边界、把 `-o /tmp/x` 与
   `-o/tmp/x` 拼成不可区分的一串）。

## 2. 分类器的改动结构

### 2.1 判序（只在两处插入，层序不变）

```text
classify_cli(argv):
  1. 危险黑名单（既有整命令 / 包装器）
     + 新增「白名单成员的执行形态」（rg --pre 系、sed e）→ Dangerous
  2. 间接包装器递归（sudo / xargs / find -exec）—— 不变，自动继承本函数
  3. 解释器（python/node/…）—— 不变
  4. shell 元字符 —— 不变
  5. 已知写动词 —— 不变
  6. 条件成员：find / sed / git —— 各分支内补形态判定
  7. 白名单成员 —— 先查写形态表，命中 → Write；否则 ReadOnly
  8. 未知命令 —— Write（不变）
```

两处改动：

- **第 1 步**新增执行形态：`dangerous_prefix_forms(name, args)`，保证危险层先于 allow 规则与
  会话缓存（既有层序天然满足）。
- **第 7 步**把「白名单 ⇒ 只读」改成「白名单 ∧ 不含写形态 ⇒ 只读」。

### 2.2 写形态表（命中即写）

| 成员 | 命中条件（argv 任一参数） | 说明 |
|---|---|---|
| `base64` | `-o`、以 `-o` 起首的粘连形态、`--output`、`--output=…` | 本机实测写文件；`-o -`（stdout）也会被拒，属可接受的过度保守 |
| `xxd` | **第二个位置参数**（按旗标语法跳过取值旗标的值后计数；`-` 计为位置参数） | `xxd infile outfile` 的普通 dump 与 `xxd -r infile outfile` 都会把结果写进第二个文件（实测） |
| `file` | `-C`、`--compile`、含 `C` 的短旗标簇 | 编译 magic 并写 `<name>.mgc` |
| `tree` | `-o`、以 `-o` 起首、`-R` | tree(1) man：`-o filename` 把输出写文件；`-R` 每层写 `00Tree.html` |
| `less` | `-o`、`-O`、`--log-file[=…]` | 防御性（当前 spawn 不可达，见 §0） |
| `find` | `-fprint`、`-fprint0`、`-fprintf`、`-fls` | GNU find 的写原语；BSD find 无，但分类器跨平台 |
| `sed` | 见 §2.3 | 脚本级判定 |

`xxd` 的位置参数计数：`-c` / `-g` / `-l` / `-n` / `-o` / `-s` 各取一个值（含 `-c16` 这类粘连形态），其后的 token 计为位置参数；`-` 单独成 token 时计为一个位置参数。位置参数 ≥ 2 即写——`xxd infile outfile` 与 `xxd -r infile outfile` 同形，`xxd infile` 只写 stdout 仍只读。

短旗标簇的判据：单 `-` 起首、非 `--`、全部字符都在该命令的旗标字母表内（排除「把值粘在旗标后」
的歧义）；命中即写。命中不了也只会落回「不写」以外的更高保守侧（未知形态 → 写），不会误放行。

### 2.3 `sed`：保守脚本扫描

`sed` 的写/执行能力不在旗标，在**脚本语言**里：`w file` / `W file` 写文件，`e` / `s///e` 执行
命令（GNU），`-f script` 把脚本藏进文件。判据分两步：

**第一步：取脚本源**

- `--expression=…` 与 `--expression X`（分写形态）→ 脚本源；
- `-e X` → 下一个参数；`-eX` → 粘连段；
- `--file=…` / `--file X` / `-f X` / `-fX` / 含 `f` 的短旗标簇 → **直接归写**（脚本体在分类时不可见；`--file` 的分写形态必须显式识别，否则脚本文件名会被误当成脚本正文去扫描）；
- `-i` / `--in-place[=…]` / 含 `i` 的短旗标簇 → **归写**（把既有 `-i` 判定从「整参数前缀」改为
  「旗标簇展开」，堵 GNU sed 的 `-ni` / `-Ei` 绕过）；
- 没有 `-e` / `-f` 时，第一个非 flag 参数是脚本源，其余是输入文件。

**第二步：扫描脚本源**（每个 `-e` 独立扫描，结果按 危险 > 写 > 只读 合并）

- 只在**命令位**识别命令字母；地址段（数字 / `$` / `/…/`（含 `\/` 转义）/ `\c…c` / `~N` / `,` /
  `!`）先跳过，正则里的 `w` / `e` 不算命令。
- 命令位字母：
  - `s` / `y`：按首字符取分隔符，连续跳过两个「未转义分隔符」包住的字段，再读旗标字母——
    出现 `w` → 写，出现 `e` → 危险（`s///e` 是 GNU 的执行形态）。
  - `w` / `W` → 写；`e` → 危险。
  - `r` / `R` → 继续（只读外泄与既有 `cat` 同级，不在本不变量范围内）。
  - `a` / `i` / `c` → 文本直到未转义换行，跳过。
  - `#` → 注释到行尾；`:` / `b` / `t` / `T` → 标签到分隔符；其余单字母命令 → 继续。
  - `{` / `}` / `;` / 换行 → 回到命令位。
- **任何无法完整解析的形态**（未闭合的分隔符 / 引号、未知字母、长度超限）→ **归写**（fail-closed；
  不是危险——分类器无法证明它会执行程序）。

关键口径：扫描器**只有完整解析成功才返回只读**；「大部分像只读」不是放行理由。`sed` 因此保留在
白名单里，但只对可静态证明的脚本生效（取值 D2）。

### 2.4 `git`：子命令收缩 + 全局 flag 白名单（Q1-A）

**全局 flag 解析改为白名单**：

```text
i = 0
while args[i] 以 '-' 起首:
    if args[i] ∈ {"-P", "--no-pager", "--no-optional-locks", "--no-replace-objects"}:
        i += 1
    else:
        return Write            // -c / --config-env / --exec-path / --git-dir / --work-tree / -C / --bare …
若没有非 flag 参数 → Write（裸 git，不变）
sub = args[i]
```

- 白名单里刻意**没有** `-p` / `--paginate`：它会强制分页器，分页器是 `core.pager` 指定的程序。
- `git --version` 维持既有早退（只读；不执行任何子命令）。
- 表外全局 flag 一律写：`-c` / `--config-env` / `--exec-path` / `--git-dir` / `--work-tree` /
  `-C` / `--bare` / `--namespace`。它们要么直接注入配置，要么把 git 指向一份模型可写的仓库配置。

**只读子命令族收缩**：

| 保留（只读） | 移除（→ 写） | 移除理由 |
|---|---|---|
| `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 的纯列表形态 / `remote -v` | `status` / `diff` / `log` / `show` / `blame` | 会执行仓库 config / gitattributes 指定的程序：`core.fsmonitor`（status）、`diff.external` 与 textconv（diff / log -p / show / blame）、`log.showSignature` → `gpg.program`（log / show） |

保留族的依据是「执行面不存在」而不是「没听说过出问题」：这几个子命令既不进 diff 机制、不查
fsmonitor、不验签；分页器因 stdout 非 tty 不启动；alias 不能覆盖内建子命令；hooks 不在这些
路径上触发。这条判据在实现期必须实测背书（tasks 1.11）：在 `log.showSignature=true` + 恶意
`gpg.program`（并覆盖 `core.fsmonitor` / `diff.external` / textconv）的仓库 config 下逐个跑
保留族，任一触发执行即移出保留族。若未来 git 给其中之一新增执行型配置，需回到本节重新评估
（§8 残余）。

### 2.5 判定管线上的落点

分类只产出三态；`decide` 的层序一字不改：

- 写形态 → `Write` → 第 2 层（vault 内写重定向）→ 第 5 层（`read_only` / `vault_write` 问，
  `full_access` 放行）；
- 执行形态 → `Dangerous` → 第 3 层（任何档问，allow 规则与会话缓存都绕不过）。

`mode_layer`、`DecisionReason`、重定向载荷、缓存语义全部不动。

## 3. 逐成员处置表（28 条白名单 + 3 个条件成员）

「无」= 2026-10-23 核对本机 man / `--help`，未发现 argv 级的写文件或执行程序形态。

| # | 成员 | 现状 | 写 / 执行能力（依据） | 处置 |
|---|---|---|---|---|
| 1 | `ls` | 只读 | 无 | 不变 |
| 2 | `cat` | 只读 | 无（读任意文件与读边界无关，Non-goal） | 不变 |
| 3 | `head` | 只读 | 无 | 不变 |
| 4 | `tail` | 只读 | 无（`-f` 只读等待） | 不变 |
| 5 | `wc` | 只读 | 无 | 不变 |
| 6 | `file` | 只读 | `-C` 编译 magic，写 `<name>.mgc`（实测） | `-C` / `--compile` / 含 `C` 的旗标簇 → 写 |
| 7 | `stat` | 只读 | 无 | 不变 |
| 8 | `pwd` | 只读 | 无 | 不变 |
| 9 | `which` | 只读 | 无 | 不变 |
| 10 | `whereis` | 只读 | 无 | 不变 |
| 11 | `echo` | 只读 | 无（只写 stdout） | 不变 |
| 12 | `printf` | 只读 | 无（只写 stdout） | 不变 |
| 13 | `date` | 只读 | 无文件写；设系统时钟需 root | 不变（残余登记，§8） |
| 14 | `uname` | 只读 | 无 | 不变 |
| 15 | `du` | 只读 | 无 | 不变 |
| 16 | `df` | 只读 | 无 | 不变 |
| 17 | `rg` | 只读 | `--pre` / `--pre-glob` / `--hostname-bin` 执行指定程序（实测） | 三形态 → **危险** |
| 18 | `grep` | 只读 | 无 | 不变 |
| 19 | `egrep` | 只读 | 同 grep | 不变 |
| 20 | `fgrep` | 只读 | 同 grep | 不变 |
| 21 | `tree` | 只读 | `-o filename` 写输出文件；`-R` 每层写 `00Tree.html`（tree(1) man；本机未安装） | `-o` / `-R` → 写 |
| 22 | `less` | 只读 | `-o` / `-O` / `--log-file`（仅管道输入）；`+cmd` 交互命令（需 tty） | 拒判 → 写（防御性；当前 spawn 不可达） |
| 23 | `more` | 只读 | 无 argv 级（macOS 只支持 `+/pattern`、`+num`；`!` 需交互） | 不变 |
| 24 | `jq` | 只读 | 无（可读文件，与 `cat` 同级） | 不变 |
| 25 | `xxd` | 只读 | 第二个位置参数是输出文件——普通 dump 与 `-r` 同形（实测） | 出现第二个位置参数 → 写 |
| 26 | `od` | 只读 | 无 | 不变 |
| 27 | `hexdump` | 只读 | 无（`-e` 格式串不执行程序） | 不变 |
| 28 | `base64` | 只读 | `-o` / `--output` 写文件（实测） | 写形态 → 写 |
| 29 | `find` | 条件只读 | `-exec*` 已递归；`-fprint` / `-fprint0` / `-fprintf` / `-fls` 写文件（GNU） | 四个写原语 → 写 |
| 30 | `sed` | 条件只读（只看 `-i`） | `w` / `W` / `s///w` 写；`e` / `s///e` 执行（GNU）；`-f` 脚本体不可见；`-ni` 捆绑绕过现有 `-i` | §2.3：写形态 → 写，执行形态 → 危险 |
| 31 | `git` | 条件只读 | 仓库 config 驱动执行（`core.fsmonitor` / `diff.external`，实测）；表外全局 flag 注入配置或指向 foreign repo | §2.4 拆档（Q1-A） |

`find -exec` 的递归、`sudo` / `xargs` 的递归不变：它们调用同一个 `classify_cli`，上表的收紧自动
传递到被包装命令。

## 4. 为什么不是更省事的方案

- **整表移除 28 条**：把 `cat` / `ls` / `rg` 也逐次问，等于取消只读档的意义；错的是判据，不是
  成员名单。
- **只修 finding 点名的 4 个**：上表另外查出 `xxd` 的双位置参数、`file -C`、`tree -o`、`sed -f`、GNU find 的
  写原语、`rg --hostname-bin`，以及 git 的仓库 config 面。按案例打补丁会把它们留在原地。
- **沙箱**：`sandbox-exec` / seatbelt 是另一条路线（执行隔离），与本 change 的分类判据不互斥，
  但工程量和平台耦合都高；本 change 不做，也不假装做了。

## 5. 写目标提取（重定向承诺的补全）

分类为写之后，第 2 层仍要判断「写目标是否在 vault 内」。新增写形态必须补进 `write_targets`
（`permissions.rs:770-808`），否则 vault 内的 `base64 -o notes/x` 会掉成普通写（问一次），违背
「vault 内写改道到 vault 工具」的既有承诺：

| 成员 | 目标取法 |
|---|---|
| `base64` | `-o` / `--output` 的取值（两种形态，复用既有 `option_values`） |
| `tree` | `-o` 的取值；`-R` 写到每层的固定名 `00Tree.html`，无可提取目标 → 不重定向 |
| `xxd` | **第二个位置参数**（不限于 `-r`；第一个是输入） |
| `find` | `-fprint` / `-fprint0` / `-fprintf` / `-fls` 的下一个参数 |
| `file -C` | 无目标可取（写到 cwd 的固定名 `magic.mgc`）→ 不重定向，落普通写 |
| `less -o` | 同上（且当前不可达）→ 不重定向 |

`suggested_tool` 映射：`base64` / `tree` / `xxd` / `find` 的写目标都建议 `vault_create`
（新建产物）或 `vault_patch`（覆盖既有文件）——按目标是否存在走既有分流；拿不准时不给建议
（`None`），不编造。

## 6. 测试面（表驱动 + 反向验证 + 跨档矩阵）

1. **分类表驱动**：每个成员至少两条——`(argv, 期望 ReadOnly)` 的正例与 `(argv, 期望非 ReadOnly)`
   的反例。新增/改动的 9 个成员必须覆盖 §2.2–§2.4 的每一条命中条件（含 `--output=…` 的等号形态、
   `-o` 粘连形态、旗标簇形态）。
2. **反向验证**（REVIEW.md「断言等价于子串」条）：每个拒判配一条**只差一个 token / 一个字符**的
   正例，证明它仍只读（`base64 -d` vs `base64 -o`、`sed 's/a/b/'` vs `sed 'w x'`、`rg needle` vs
   `rg --pre c needle`、`git rev-parse HEAD` vs `git status`）；每条正例再配一条改坏的输入，
   确认断言真的会红。
3. **跨档矩阵**：写形态在 `read_only` / `vault_write` 档 `Ask`、`full_access` 档 `Allow`；执行形态
   三档全 `Ask`；且在 `full_access` 下不被 allow 规则或会话缓存解锁（危险层先于两者）。
4. **重定向**：`base64 -o notes/x` / `tree -o notes/x` / `xxd in notes/x`（普通形态）与 `xxd -r in notes/x` / `find … -fprint notes/x`
   在 vault 内触发重定向（targets 与 suggested_tool 正确），vault 外落普通写。
5. **包装器继承**：`sudo base64 -o …` / `xargs rg --pre …` 的分类与被包装命令一致（既有递归的
   回归面）。
6. **`sed` 扫描器专项**：地址与正则里的 `w` / `e` 不误判（`/w/ p`、`s/e/x/`）；`s/a/b/w out` 与
   `s/a/b/e` 命中；`-f` / `-ni` 命中；未闭合分隔符 → 写。

## 7. 与 M649 的对齐（同改一条 requirement）

M649（`harness-permission-rules-oct23`）在起草基线（`40e6ae01`）上尚未并入 master；2026-10-23
r1 评审时它已合并 master（merge `9e783038`）但未归档，living spec 仍是本 delta 的基线原文。
两条 change 都 MODIFIED「cli_run 命令分类与 vault 写重定向」，归档时 `openspec archive` 对
MODIFIED 是**整块替换**，因此：

1. **判据层**：M649 的受限解包对每个子命令复用 `classify_cli`（其 design §2.4）。本 change 的
   收紧自动生效：`bash -lc "rg --pre c x"` → 子命令危险 ⇒ 整条危险；`bash -lc "sed -n 'w /tmp/x' f"`
   → 子命令写 ⇒ 解包失败、整条危险。本 change 不需要为解包另写任何判据。
2. **M649 的测试表与示例要跟着改**：其 design §2.6 的正例表里有 `bash -c "git status"` 与
   `bash -lc "git diff --stat"`；Q1-A 之后它们是写 ⇒ 解包失败 ⇒ 危险。若两条 change 都落地，
   这两行必须换成保留族（如 `git rev-parse HEAD`）。其 spec delta 的「`git` 只读子命令族」措辞
   同步收缩。
3. **归档顺序**：本 delta 以 master 原文为基线。若 M649 先归档，本 change 的 MODIFIED 块必须在
   归档前重写为「master 原文 + M649 的解包段 + 本 change 的收紧段」；反之同理。tasks 第 3 组
   有对应项。
4. M649 的 Non-goals 已把 `sed w` / `base64 -o` / `rg --pre` / git 配置面显式留给「另行处理」，
   本 change 就是那个另行处理。

## 8. 残余面（本 change 不消除，如实登记）

- **环境变量**：`RIPGREP_CONFIG_PATH`（可给 rg 注入 `--pre`）、`LESSOPEN` / `LESSCLOSE`、
  `GREP_OPTIONS`、`PAGER` 由 app 进程继承，模型不能设置。取值 D3 在 spawn 时清空前四项（防御性），
  但它不是 argv 判据的一部分，spec 不依赖它。
- **`date`**：设系统时钟需 root；非文件写，保留。
- **`file -C`**：写到 cwd 的固定名 `magic.mgc`，目标不可选；归写后由批准闸兜底。
- **`less +cmd`**：只在交互终端成立；`cli_run` 的 stdout 是管道，当前不可达。
- **git 保留族的未来特性**：若 git 给 `rev-parse` / `ls-files` / `describe` / `shortlog` /
  `stash list` / `branch`·`tag` 列表 / `remote -v` 新增执行型配置，需重开 Q1。
- **隐藏文件写入面**：`vault_patch` 可改既有 `.git/config`（已单列 finding）。本 change 把
  `git status` / `diff` 降写后，默认档的零批准链被堵住；但 hidden 面本身仍应另行处置。
- **读侧**：`cat` / `grep` 可读 vault 外文件，只读白名单不承担读隔离（Non-goal）。

## 9. 裁决点与取值

- **Q1 git 处置**：A 拆档（倾向）/ B 整族移除 / C 保持 + spawn 加固。逐条理由见 proposal。
- **D1** 写形态 → 写、执行形态 → 危险。
- **D2** `sed` 保留 + 保守脚本扫描（不整成员移除）。
- **D3** `less` / `more` 保留；`less -o` 防御性拒判；spawn 清空四个注入型环境变量。

## 10. 影响面

- spec：`harness` 的「cli_run 命令分类与 vault 写重定向」一条（MODIFIED 整块）。
- 代码：`src-tauri/src/harness/permissions.rs`（主改动）、`src-tauri/src/harness/tools.rs`
  （spawn 环境清理与可能的重定向目标接线）、对应单测。
- 验收：`scripts/acceptance/scenarios/` 回扫 + 新增场景（见 tasks 第 2 组）。
- 文档：本 change 的 design 与 tasks；`docs/backlog.md` 的 finding 落账由 tower 记账。
