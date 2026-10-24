# Design: 只读白名单的能力断言与逐成员收紧

- Change ID: `readonly-allowlist-tightening-oct23`
- 日期: 2026-10-23
- 分支基线：master `40e6ae01`（行号是起草时在该基线上逐一读过的位置；实现前以符号名为准）

本文只写「怎么做到 proposal 已裁的行为」与「为什么这样做」。所有安全判据按**输入分布**表述
（任意 argv、任意仓库配置），不按 finding 里的四个案例打补丁。

## 0. 事实清单（起草时核对过原文 + 本机实测）

| 事实 | 锚点（master `152559fc`，2026-10-24 实现期回填） | 与本 change 的关系 |
|---|---|---|
| 只读分类在模式层三档一律 Allow | `src-tauri/src/harness/permissions.rs:191-205`（`mode_layer` 的 `cli_run` 分支） | 这是「白名单成员免闸」的实现位置；判据一错，三个档一起漏 |
| 只读白名单 28 条（含 `base64`） | `permissions.rs:254-257`（`READ_ONLY_COMMANDS`） | 逐个成员的处置表见 §3 |
| 已知写动词 24 条 / 解释器 / shell 包装器 / 危险黑名单 | `permissions.rs:402-460`（`WRITE_COMMANDS` / `INTERPRETERS` / `DANGEROUS_WRAPPERS` / `DANGEROUS_COMMANDS` / `DANGEROUS_DISK`） | 本 change 不新增成员、不改层序，只补参数级形态 |
| shell 元字符保守归写 | `permissions.rs:467`（`SHELL_META`）、`:715`（分类时的元字符判定） | 写/执行形态都不含元字符，因此在这条之后仍会漏；拒判必须放在返回只读之前 |
| 分类判序 | `permissions.rs:676-756`（`classify_cli` / `classify_cli_at`） | 落点：危险判定的参数级扩展 + 返回只读前的写形态检查 |
| `sed` 现有判据只看 `-i` | `permissions.rs:1138-1415`（`classify_sed` 与脚本扫描） | `w` / `W` / `e` 与 `-f` 全不在判据里；捆绑短选项也会绕过 `-i` |
| `git` 子命令取「第一个非 flag 参数」 | `permissions.rs:1417-1497`（`git_subcommand_index` / `git_effective_subcommand` / `git_read_only_subcommand`）、`:1499-1603`（`classify_git`） | `-c` 的值被误当子命令（巧合安全）；`--git-dir=` 等被放过 |
| 写目标提取按命令族 | `permissions.rs:1622-1689`（`write_targets`） | 新增写形态要补提取，否则 vault 内写会掉成普通写（§5） |
| 间接包装器递归复用 `classify_cli` | `permissions.rs:839-1136`（`classify_wrapped` 及 sudo / xargs / find -exec 分支） | `sudo base64 -o …` 自动继承收紧，无需另写判据 |
| `cli_run` spawn：stdout/stderr 管道，stdin 不设置（继承 app） | `src-tauri/src/harness/tools.rs:1212-1250`（`cli_run`） | `less` 非交互、stdin 非管道 ⇒ `-o` 与 `+cmd` 当前不可达（§3 的 less 行） |
| 主体串 = argv 用空格拼接 | `src-tauri/src/harness/tools.rs:387-422`（`permission_subject`） | 参数级拒判必须看 argv；主体串拼接后无法可靠还原 argv |
| `fs_patch_file` 的 hidden 闸 | `src-tauri/src/fs_io.rs:1798-1912`（`fs_patch_file` 调用 `validate_not_hidden`）、`:1005-1035`（判定与两种命中形态） | M656 已落地（merge `c9a4d03`）：git 可达链的默认档免闸写入口已关闭；真机复核见场景 231b（2026-10-24 PASS） |

### 0.1 本机实测记录（2026-10-23 起草期；2026-10-24 补 git `--output` 探针；合成目录，无真实 vault 内容）

平台：macOS 26.6.2、git 2.50.1 (Apple Git-155)、ripgrep 15.2.0、file 5.41、BSD sed / BSD base64。
`--output` 探针在 `/tmp/lumir-probe-m657`，其余在 `/tmp/lumir-probe-m652`。

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
| `git log --output=o` / `git show --output=o` / `git shortlog --output=o` | 写出 13 / 128 / 19 字节；空格分写形态（`--output o`）同样成立 |
| `git diff --output=v` / `git blame --output=v`（`v` 为既有 18 字节文件） | 创建文件并截为 0 字节；空格分写形态同样成立 |
| `git log -o o` / `git show -o o` / `git diff -o o` | 不被接受（exit 128）；短旗标形态不成立 |
| `xxd -r -p hex.txt out.bin` | 写出 6 字节 |
| `xxd a.txt out.hex`（普通 dump，两个位置参数） | 写出 64 字节；`xxd -ps a.txt t2`（原子簇选项）写出 25 字节；`xxd -c 16 a.txt`（取值旗标 + 单位置参数）不落盘；`xxd - out.hex` 同样写（`-` 计输入位置参数） |
| `file -C -m magicdir/mymagic` | 在**当前目录**写出 `magic.mgc`（不是 `-m` 指定路径旁边） |
| `find . -fls out` / `find . -fprint out` | 本机 BSD find 报 `unknown primary or operator`；GNU find 支持（本 change 仍覆盖，分类器是文本级、跨平台） |
| `less -o out a.txt` / `less '+!touch flag' a.txt`（非 tty、stdin 非管道） | 均无落盘，进程不阻塞 |

### 0.2 finding 第 4 条的更正

finding 原文把 `git -c diff.external=/tmp/evil diff` 列为只读绕过。实测与代码对照：**按字面不成立**
——`git_subcommand` 取第一个非 flag 参数，`-c` 的取值 `diff.external=/tmp/evil` 被当成子命令，落
「未知 ⇒ 写」（`permissions.rs:1417-1435` 的 `git_subcommand_index`、`:1499-1603` 的
`classify_git`）。粘连形态被 git 自己拒绝。

但该条指向的风险真实存在、且更强：`--config-env=` / `--git-dir=` / `--work-tree=` 这类「值在等号
后」的全局 flag 不产生非 flag 参数，子命令仍被认成 `diff` / `status` ⇒ 判只读；而**不需要任何
argv 花招**的形态是仓库自身 config——`core.fsmonitor` 让 `git status` 执行程序、`diff.external`
让 `git diff` 执行程序（§0.1 实测）。仓库 config 的内容不在 argv 可见范围内，这是 git 处置
（Q1）必须回答的问题。2026-10-24 裁决把它答成「只读族保持只读 + 写入口（M656）关闭 +
不可信仓库面登记为残余」，结论与论证见 §2.4。

### 0.3 实现期回填（2026-10-24，M664 实现 / M711 真机）

- **真机读数**：场景 231（写形态 / 执行形态 / git 只读族）32 断言 PASS；场景 231b（hidden 写
  入口）8 断言 PASS。证据 `.local/acceptance/2026-10-24-m711/`。
- **231 的关键读数**：`git status` / `git diff` / `git rev-parse` / `base64 -d` 四条只读调用在
  `vault_write` 档确实执行（wire 留存 `call_ro1`–`call_ro4`）；三张写形态卡（`base64 -o` /
  `--git-dir` / `git log --output`）确实进闸并以 `approval_rejected` 收尾；`rg --pre` 在
  `full_access` 档仍进闸（`call_x1`）。
- **231b 的关键读数**：`vault_patch(".git/config")` 被 `fs_name_invalid` 拒绝、原因点名 hidden
  档，文件 sha256 与 mtime 均未变——§8 的 git 前提依赖因此有产品链路级证据，不只是 Rust 单测
  （`fs_patch_file_refuses_hidden_target_and_respects_policy`）。
- **实现增量（超出 design §2.4 字面、同属既有承诺）**：`git` 的危险子命令识别跳过全局 flag
  及其分写取值（`git -C <path> clean -fd` 不会因 `-C` 落写而在 `full_access` 免闸）；
  `write_targets` 的 `sed -i` 目标提取改用同一份 sed 参数解析。
- **一致性边界（3.2 未做，不得提前做）**：本 delta 的 MODIFIED 块仍以 master 原文为基线，
  **不含** M649 的受限解包段；M649 未归档，归档前必须按 §7 第 3 条重写（否则整块替换会静默
  抹掉解包段）。本批只核对本 change 自身四者一致，不动这段并集。

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

**P 的判据边界（git 的显式前提）**：判据的输入是 argv 与执行环境中**可由 argv 静态判定**的部分；
运行环境中既存的配置文件不是判据输入。对 git 而言，仓库自身配置（`core.fsmonitor` /
`diff.external` / textconv / `gpg.program`）就是这类既存输入——所以 git 只读族保持只读不是 P 的
反例，而是一条写明的前提：仓库配置在 vault 内没有默认档的免闸写入口，隐藏路径的 patch / move /
delete 由 M656 归入 hidden 档拒绝。前提不成立的情形（不可信仓库）按残余登记（§8），不假装 P
覆盖了它。

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

`xxd` 的位置参数计数：`-c` / `-g` / `-l` / `-n` / `-o` / `-s` 各取一个值（含 `-c16` 这类粘连形态），其后的 token 计为位置参数；`-` 单独成 token 时计为一个位置参数。**取值消耗以 token 起首字母判定，MUST NOT 对簇做单字母展开**：`-s` / `-s0` / `-c 16` / `-c16` 成立；`-ps` 这类以非取值字母起首的簇是 xxd 的原子选项，`-s` 不消耗后续 token——按簇展开读法会把 `xxd -ps a.txt out.hex` 的 `a.txt` 误当 `-s` 的值、只剩 1 个位置参数而漏判（fail-open；实测该形态写 `out.hex`）。位置参数 ≥ 2 即写——`xxd infile outfile` 与 `xxd -r infile outfile` 同形，`xxd infile` 只写 stdout 仍只读。新版 xxd 的 `-R when`（colorize）刻意不列入取值表：把它当取值旗标会在不支持该旗标的平台上吞掉输入文件、反而 fail-open；不列入只导致过度保守（`xxd -R never a.txt` 会被当两个位置参数 → 写）。

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

### 2.4 `git`：只读族保持只读 + 全局 flag 白名单（Q1，2026-10-24 裁决）

**只读子命令族保持现状**：`status` / `diff` / `log` / `show` / `blame` 与既有保留族
（`rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 的纯列表形态 /
`remote -v`）继续判只读、三档免闸；其余子命令（`add` / `commit` / `push` / `checkout` / …）仍落写。
本 change 不为子命令族写任何收缩代码——原起草倾向 A 的「拆档」已被 Alex 2026-10-24 否决，
裁决原话与理由见 proposal「裁决点 Q1」。

安全论证（替代原「保留族执行面不存在」的论证）：

- 执行面来自**仓库配置**而不是 argv（§0.1 的 `core.fsmonitor` / `diff.external` 实测）。拆档只能
  把零批准链的下游一步变成问一次，写入口敞开时它只是把链推迟一步；裁决据此把修复点移到写入口。
- 写入口由 M656 关闭：`vault_patch` / `vault_move` / `vault_delete` 对隐藏路径（含 `.git/config`）
  直接拒绝；`cli_run` 侧对 vault 内 `.git/config` 的写在默认档至少进一次闸（vault 内目标还会被
  重定向到 vault 工具，最终同样撞 hidden 拒绝）。默认档的零批准链因此不再成立。
- 因此「`git status` 免闸」的前提是「vault 仓库配置没有默认档的免闸写入口」；前提不成立的面
  （不可信仓库）在 §8 如实登记，本 change 不兜。

**全局 flag 白名单（argv 层）**：

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
  `-C` / `--bare` / `--namespace`。信任范围只覆盖 vault 自身仓库；argv 明示注入配置（`-c`）或
  指向别处仓库配置（`--git-dir` / `--work-tree` / `-C`）时不在此列，必须归写。
- 这条与「git 只读族保持只读」不矛盾：前者看 argv 明示的外部输入，后者信的是 vault 自身仓库
  配置的免闸写入口已关（M656）。过度保守的代价可接受：`git -c core.quotepath=false status` 这类
  形态会进闸，改用不带 `-c` 的形态即可。

**只读子命令上的写形态（Q1 改裁的连带补全）**：`git log` / `show` / `shortlog` 的
`--output=<file>` 与 `--output <file>` 写文件；`git diff` / `blame` 的同形态会创建文件并把既有
文件截为 0 字节（§0.1 实测）。因此只读子命令族出现 `--output` 或 `--output=…` 参数时 → `Write`；
`write_targets` 取其值（§5），vault 内目标仍走重定向。`-o` 短形态在这些子命令上不被接受
（实测 exit 128），不列入；`--` 之后的同名字符串（pathspec）也会被保守判写，属可接受的过度
保守。这条是 Q1 改裁的连带补全——原倾向把这几条降写，写形态不需要单列；保持只读后不补，
§1 的 P 在 git 上不成立。

**为什么不做 spawn 加固（原选项 C）**：`-c core.fsmonitor=false --no-ext-diff --no-textconv`
一类执行期注入把判据分散到每个子命令的每个执行路径，textconv / `log.showSignature` 等按驱动 /
按配置开的口子难以穷举，日后 git 新增执行型配置就再破一次。写入口关闭是单点，且 M656 的拒绝
语义可直接验证；本 change 对 git 只落 argv 判据。

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
| 31 | `git` | 条件只读 | 仓库 config 驱动执行（`core.fsmonitor` / `diff.external`，实测）；表外全局 flag 注入配置或指向 foreign repo；只读子命令的 `--output` 写文件 / 截断文件（实测） | 只读族保持只读（Q1，2026-10-24 裁决）；全局 flag 白名单（表外 → 写）；`--output` → 写；仓库配置的默认档免闸写入口由 M656 关闭（§8） |

`find -exec` 的递归、`sudo` / `xargs` 的递归不变：它们调用同一个 `classify_cli`，上表的收紧自动
传递到被包装命令。

## 4. 为什么不是更省事的方案

- **整表移除 28 条**：把 `cat` / `ls` / `rg` 也逐次问，等于取消只读档的意义；错的是判据，不是
  成员名单。
- **git 拆档**（原倾向 A）：2026-10-24 Alex 否决——`status` / `diff` / `log` 是最高频命令，全部
  降写会让只读档名存实亡；且拆档只是把零批准链的下游一步变成问一次，写入口仍在。改裁为
  「只读族保持 + 写入口（M656）关闭」，见 §2.4。
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
| `git` | 只读子命令的 `--output` / `--output=…` 的取值（空格与等号两形态）；`diff` / `blame` 的截断语义与普通写相同 |

`suggested_tool` 映射：`base64` / `tree` / `xxd` / `find` / `git` 的写目标都建议 `vault_create`
（新建产物）或 `vault_patch`（覆盖既有文件）——按目标是否存在走既有分流；拿不准时不给建议
（`None`），不编造。`git diff --output` / `git blame --output` 会截断既有文件，映射规则同上
（`vault_patch`）。

## 6. 测试面（表驱动 + 反向验证 + 跨档矩阵）

1. **分类表驱动**：每个成员至少两条——`(argv, 期望 ReadOnly)` 的正例与 `(argv, 期望非 ReadOnly)`
   的反例。新增/改动的 9 个成员必须覆盖 §2.2–§2.4 的每一条命中条件（含 `--output=…` 的等号形态、
   `-o` 粘连形态、旗标簇形态）。
2. **反向验证**（REVIEW.md「断言等价于子串」条）：每个拒判配一条**只差一个 token / 一个字符**的
   正例，证明它仍只读（`base64 -d` vs `base64 -o`、`sed 's/a/b/'` vs `sed 'w x'`、`rg needle` vs
   `rg --pre c needle`、`git status` vs `git -C /tmp/other status`、`git log` vs
   `git log --output=/tmp/x`）；每条正例再配一条改坏的输入，确认断言真的会红。git 的正例从
   `git status` / `git diff` / `git log -1` 起（Q1 2026-10-24 裁决：保持只读），反例是表外全局
   flag（`git -C …` / `git --git-dir=…`）、只读子命令的 `--output` 与写子命令（`git commit`）。
3. **跨档矩阵**：写形态在 `read_only` / `vault_write` 档 `Ask`、`full_access` 档 `Allow`；执行形态
   三档全 `Ask`；且在 `full_access` 下不被 allow 规则或会话缓存解锁（危险层先于两者）。
4. **重定向**：`base64 -o notes/x` / `tree -o notes/x` / `xxd in notes/x`（普通形态）与 `xxd -r in notes/x` / `find … -fprint notes/x` / `git log --output=notes/x`
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
2. **M649 的测试表与示例不受影响**：其正例 `bash -c "git status"` / `bash -lc "git diff --stat"`
   在 Q1 改裁（2026-10-24）后仍是只读（§2.4），解包照旧放行；其 spec delta 对「`git` 只读子命令族」
   的措辞也无需收缩。M649 只需继承本 change 的全局 flag 白名单：`bash -lc "git -c … status"`
   因表外全局 flag 归写而解包失败 ⇒ 危险，该变化由既有递归自动生效。
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
- **git 只读族 + 仓库配置（前提依赖）**：`core.fsmonitor` / `diff.external` / textconv /
  `log.showSignature` → `gpg.program` 会让 `git status` / `diff` / `log` 执行仓库配置指定的程序
  （§0.1 实测）。本 change 保留这些子命令为只读，前提是仓库配置在 vault 内没有默认档的免闸
  写入口——由 M656（`vault_patch` / `vault_move` / `vault_delete` 对隐藏路径直接拒绝）提供。
  **M656 已落地**（merge `c9a4d03`）并有真机复核（场景 231b，2026-10-24 PASS：`vault_patch`
  指名 `.git/config` 被 `fs_name_invalid` 拒绝且文件未变），前提成立；实施顺序 M656 → 本
  change（tasks 3.4 已勾）。
  前提本身还依赖 `.git` 仍在忽略策略的 hidden 档（默认配置）：用户显式把 `.git` 配成可见即自行
  放开写入口（config 即数据，M656 不做名字级特判），这一用户选择不在本 change 的兜底范围内。
- **不可信仓库**：vault 的仓库配置在成为 vault 之前已被写入、或由 vault 之外的进程改写时，
  `git status` / `diff` 仍会执行其中的程序。这是「仓库来源可信」的运行环境假设，本 change 的
  分类器只看 argv，无法也不打算消除；读侧与仓库来源校验不在 scope。
- **git 未来新增执行型配置**：判据不再依赖「保留族执行面为零」，而依赖「仓库配置的免闸写入口
  关闭」；新增执行型配置不破该前提，无需重开 Q1。若未来出现 argv 级的 git 注入面（新的全局
  flag），按 §2.4 的全局 flag 白名单增补。
- **读侧**：`cat` / `grep` 可读 vault 外文件，只读白名单不承担读隔离（Non-goal）。

## 9. 裁决点与取值

- **Q1 git 处置（已裁决 2026-10-24）**：git 只读子命令族保持只读、不拆档；argv 层只收紧全局
  flag 白名单。原选项 A（拆档）被 Alex 否决，B / C 不采纳；裁决原话与安全论证见 proposal
  「裁决点 Q1」。
- **D1** 写形态 → 写、执行形态 → 危险。
- **D2** `sed` 保留 + 保守脚本扫描（不整成员移除）。
- **D3** `less` / `more` 保留；`less -o` 防御性拒判；spawn 清空四个注入型环境变量。

## 10. 影响面

- spec：`harness` 的「cli_run 命令分类与 vault 写重定向」一条（MODIFIED 整块）。
- 代码：`src-tauri/src/harness/permissions.rs`（主改动）、`src-tauri/src/harness/tools.rs`
  （spawn 环境清理与可能的重定向目标接线）、对应单测。
- 验收：`scripts/acceptance/scenarios/` 回扫 + 新增场景（见 tasks 第 2 组）。
- 文档：本 change 的 design 与 tasks；`docs/backlog.md` 的 finding 落账由 tower 记账。
