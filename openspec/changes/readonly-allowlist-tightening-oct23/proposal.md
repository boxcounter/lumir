# Proposal: 收紧只读白名单——被判只读的命令不得自带写文件 / 执行程序能力

- Change ID: `readonly-allowlist-tightening-oct23`
- 日期: 2026-10-23（2026-10-24 修订：Q1 改裁，见「裁决点」）
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**已裁决**（2026-10-23 起草；2026-10-24 Alex 就唯一裁决点 Q1 给出裁决——
> 原倾向「git 拆档」被否决，改裁为「git 只读子命令族保持只读、不拆档」，原话与改写后的安全
> 论证见「裁决点」。起草期取值 D1–D3 未被否，按倾向落地；其余内容维持原稿）。
> 节点 2（归档评审）：实现完成后填写。

## Why

Alex 2026-10-23 对一条 finding 的处置原话：

> 「M649 发现的一个安全隐患：权限只读白名单里几个命令本身带写/执行能力（base64 -o 能写文件、
> rg --pre 能执行任意命令等），在 vault_write 档下会被静默放行。这是改动前就存在的面，建议
> 单独立项修」——已点头。finding 全文在
> `.tower/comms/findings/20261023-worker-proposal-permission-rul-vuln-sed-w-base64-o-rg-pre-git-c-diff-external.md`。

**这不是几个命令的个案，是白名单的判据写错了。** 只读分类站在判定管线的最底层：`mode_layer`
对「只读」在三个档位一律返回 Allow（`src-tauri/src/harness/permissions.rs:191-205`），前面的
危险黑名单、元字符与写命令表都不认识这些命令的参数形态。于是 `base64 -i a.txt -o /tmp/out`
与 `cp a.txt /tmp/out` 在权限上是两件事：前者免闸，后者进闸。白名单把「命令名的常见用途是读」
当成了「这条 argv 是只读」——前者是印象，后者才是判据。**只读分类必须是一条能力断言：判了
只读，就等于承诺这次调用不写文件、不执行外部程序。**

### 实测证据（2026-10-23 起草期；2026-10-24 补 git `--output` 探针。本机 macOS 26.6.2 / git 2.50.1 / ripgrep 15.2.0 / file 5.41 / BSD sed·base64）

探针在合成目录下执行，无真实 vault 内容：起草期为 `/tmp/lumir-probe-m652`，#4c 为
`/tmp/lumir-probe-m657`。

| # | 形态 | 结果 | 与 finding 的关系 |
|---|---|---|---|
| 1 | `base64 -i a.txt -o out.b64` | 写出文件（17 字节） | 能力成立。finding 写的 `base64 -o out a.txt` 在本机报 `invalid argument`——macOS 版 base64 用 `-i` 指定输入，示例形态不成立，能力本身成立 |
| 2 | `sed -n 'w out.txt' a.txt` | 写出文件 | 与 finding 一致 |
| 2b | `sed -n -f script.sed a.txt`（脚本内含 `w`） | 写出文件 | finding 未列：**脚本走文件时内容在分类期不可见**，静态判据看不到 `w` |
| 3 | `rg --pre /usr/bin/touch needle .` | 执行了指定程序（flag 文件 mtime 更新）；`rg --pre ./pre.sh` 同样执行 | 与 finding 一致 |
| 3b | `rg --hostname-bin=./hostbin.sh needle .` | 执行了指定程序 | finding 未列，同一执行能力 |
| 4 | `git status`（仓库 config 设 `core.fsmonitor`） | 执行了 config 指定的程序 | **finding 第 4 条的字面形态不成立、但风险更大**，见下 |
| 4b | `git diff`（仓库 config 设 `diff.external`） | 执行了 config 指定的程序 | 同上 |
| 4c | `git log --output=out` / `git show --output=out` / `git shortlog --output=out`；`git diff --output=v` / `git blame --output=v`（`v` 是既有文件） | 前三者写出文件（13 / 128 / 19 字节）；后两者创建文件并把既有 18 字节文件截为 0 字节；空格分写形态（`--output v`）同样成立；`-o` 短形态不被接受（exit 128） | **Q1 改裁后新增的必补形态**：status/diff/log/show/blame 保持只读，`--output` 是这几条子命令的 argv 级写入口，不补则能力断言在 git 上不成立 |
| 5 | `xxd a.txt out.hex`（普通 dump）/ `xxd -r hex.txt out.bin` | 均写出第二个位置参数文件（普通形态 64 字节，`-r` 形态 6 字节） | finding 未列：**两个位置参数 = 输入 + 输出**是 xxd 的主接口形态，与 `-r` 无关 |
| 6 | `file -C -m magic` | 在当前目录写出 `magic.mgc` | finding 未列 |
| 7 | `tree -o out.txt .` / `tree -R` | tree(1) man（2.3.2）：`-o filename` 把输出写文件；`-R` 每层写一个 `00Tree.html`。**本机未安装 tree，未实测** | finding 未列（文档口径） |
| 8 | `less -o log file` | 官方 man：仅当输入是管道时写；`cli_run` 的 stdin 继承 app（非管道），**未实测可达** | finding 未列（防御性处置） |

**finding 第 4 条的更正（重要）**：`git -c diff.external=/tmp/evil diff` 在当前分类器下**不**被判
只读——`git_subcommand` 取第一个非 flag 参数当子命令（`permissions.rs:604-609`），`-c` 的值
`diff.external=/tmp/evil` 正好被当成子命令，落「未知 ⇒ 写」。粘连形态 `-cdiff.external=…` 被 git
自己拒绝（`unknown option`）。所以字面形态是安全的，但这是**误打误撞**：`--config-env=` /
`--git-dir=` / `--work-tree=` 这类「值写在等号后」的全局 flag 仍被认成正常子命令，而且更强的一条
根本不需要 argv 花招——**仓库自己的 config 就能让只读子命令执行程序**：`core.fsmonitor` 让
`git status` 执行命令、`diff.external` 让 `git diff` 执行命令（上表 #4/#4b 实测），
`git --git-dir=… --work-tree=… diff` 指向外部仓库同样执行。仓库 config 的内容不在 argv 可见范围，
**任何只做 argv 判定的方案都堵不住它**——这正是 git 处置（Q1）的由来。

**Q1 还带出一条 argv 级写形态**：`git log` / `show` / `shortlog` 的 `--output` 写文件，
`git diff` / `blame` 的 `--output` 会创建文件并把既有文件截为 0 字节（表 #4c 实测）。原倾向
（把这几个子命令降写）把它顺带盖住了；改裁为「保持只读」后必须单独补拒判。

**可达性不是理论**：`vault_patch` 对既有隐藏文件不做 hidden 档判定（`src-tauri/src/fs_io.rs:1559`
的 `fs_patch_file` 只走 `resolve_in_vault`），默认档免闸；「改 `.git/config` → `git status`」是一条
零批准的执行链。这条已单独登记为 finding（`20261023-worker-proposal-readonly-allow-vuln-vault-patch-git-config-hidden-patch-git.md`）
并由 Alex 点头立项（M656，隐藏文件写入面本身）——**修的是写入口，不是下游**：M656 落地后，
`.git/config` 一类 hidden 路径的 patch / move / delete 被直接拒绝，仓库配置不再有默认档免闸
写入口，只读 git 的免闸前提才成立。本 change 因此保留 git 只读子命令族（2026-10-24 裁决），
残余风险（把不可信仓库打开为 vault）见 Non-goals 与 design §8。

## What Changes

1. **只读分类的能力断言（spec 条款）**。在被修改的 requirement 里写死：判为只读 = 按 argv 与其
   执行环境中可由 argv 静态判定的部分不写文件、不执行外部程序；运行环境中既存的配置文件不在
   判据内（git 的仓库配置面见第 4 条，其默认档免闸写入口由 M656 关闭）；MUST NOT 以「常见
   用法」为放行依据；形态判不明确即归写。
2. **参数级拒判（写形态 → 写）**。白名单成员出现写文件形态时降为写：`base64 -o/--output`、
   `xxd` 的双位置参数（含 `-r`）、`file -C`、`tree -o`/`-R`、`less -o`、`find -fprint/-fprint0/-fprintf/-fls`、
   `sed` 脚本的 `w`/`W` 与 `s///w`。
3. **执行形态（→ 危险）**。`rg --pre/--pre-glob/--hostname-bin`、`sed` 脚本的 `e`/`s///e` 归为
   危险——「任意命令执行」与 shell 包装器同级，任何档都逐个问，full_access 也不例外。
4. **git：只读族保持只读 + 全局 flag 白名单（Q1，2026-10-24 裁决）**。`status` / `diff` / `log` /
   `show` / `blame` 与既有保留族（`rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` /
   `branch`·`tag` 列表 / `remote -v`）继续判只读、三档免闸——拆档会让只读档名存实亡（Alex
   原话见「裁决点」）。argv 层只收紧全局 flag：`-P` / `--no-pager` / `--no-optional-locks` /
   `--no-replace-objects` 放行，表外一律写（`-c` 在 argv 里直接注入配置，`--git-dir` /
   `--work-tree` / `-C` 把 git 指向信任范围之外的仓库配置）。仓库配置的默认档免闸写入口由 M656 关闭
   （见 Why 末段）。只读子命令的 `--output` / `--output=…` 归写（`log` / `show` / `shortlog`
   写文件，`diff` / `blame` 创建或截断目标文件；Why 表 #4c 实测），`write_targets` 提取其目标，
   vault 内仍走重定向。
5. **重定向写目标补全**。新增的写形态若目标是 vault 内路径（`base64 -o`、`tree -o`、
   `xxd` 的输出位置参数、`find -fprint` 系），仍按既有「vault 内写改道」条款重定向，不掉成普通写。

逐成员处置表（完整 31 行在 design §3）摘要：

| 成员 | 处置 |
|---|---|
| `base64` | `-o` / `--output` 形态 → 写 |
| `xxd` | 第二个位置参数 → 写（`-r` 与普通 dump 同形） |
| `file` | `-C` / `--compile` 形态 → 写 |
| `tree` | `-o` / `-R` 形态 → 写（文档口径，本机未安装） |
| `less` | `-o` / `-O` / `--log-file` → 写（防御性；当前 spawn 形态下不可达） |
| `find` | `-fprint` / `-fprint0` / `-fprintf` / `-fls` → 写（GNU find 形态） |
| `sed` | 脚本含 `w`/`W`/`s///w`、`-f` 脚本文件、解析失败 → 写；脚本含 `e`/`s///e` → 危险 |
| `rg` | `--pre` / `--pre-glob` / `--hostname-bin` → 危险 |
| `git` | 只读子命令族保持只读（Q1，2026-10-24 裁决）；全局 flag 白名单，表外 → 写；只读子命令的 `--output` → 写 |
| 其余 22 个成员 | 2026-10-23 逐一核对 man / help，无 argv 级写或执行形态 → 不变 |

## Non-goals

- **不做 OS 沙箱**（`sandbox-exec` 一类）。本 change 修的是分类器的判据，不是执行隔离；真沙箱是
  另一个量级的提案。
- **不引入 `ask` 规则层**，不改判定层序，不改危险黑名单既有成员与「任何档都问」承诺。
- **不改 M649 的受限解包判据**。解包复用同一份 `classify_cli`，子命令自动继承本 change 的收紧；
  两者对同一 requirement 的 delta 合并口径见 design §7。
- **不修隐藏文件可被 `vault_patch` 改写**（已单列 finding 并由 Alex 批准立项 M656），也不做读侧
  隔离——`cat` / `grep` 今天就能读 vault 外文件，只读白名单不承担读边界。M656 是本 change
  「git 只读族保持只读」的前置依赖（见 Impact）。
- **不消除「不可信仓库」面**：vault 的仓库配置在成为 vault 之前已被写入、或由 vault 之外进程
  改写时，`git status` / `diff` 仍会执行其中的 `core.fsmonitor` / `diff.external`。本 change 的
  判据只看 argv，这一面如实登记（design §8），不靠执行期注入兜。
- 不把环境变量注入纳入 argv 判据（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `GREP_OPTIONS` 由 app 进程
  继承、模型不可设置）；取值 D3 在 spawn 侧做一次防御性清空，spec 不依赖它。

## 起草期取值（不同意请直接否）

| # | 取值 | 倾向与理由 |
|---|---|---|
| D1 | 写形态归「写」、执行形态归「危险」 | 与既有三档语义一一对应：写形态在 full_access 免闸（与 `cp` / `tee` 同档），执行形态任何档都问（与 shell 包装器同承诺）。若把 `base64 -o` 也归危险，等于给「任意路径写」新开一个全档拦截层，超出本 finding 的范围 |
| D2 | `sed` 保留在白名单，用保守脚本扫描而不是整成员移除 | 移除会让 `sed 's/a/b/'` 这种最常见的只读替换也逐次问；扫描器只对「能完整解析且无 `w`/`W`/`e`」的脚本放行，其余一律降写（fail-closed） |
| D3 | `less` / `more` 保留，`less` 的 `-o` 做防御性拒判；spawn 时清空四个注入型环境变量（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `LESSCLOSE` / `GREP_OPTIONS`） | 当前 spawn 下 `less` 非 tty、stdin 非管道，`-o` 与 `+cmd` 都不可达；拒判是给未来 spawn 形态变化留的防线，不给成员移除的代价。环境变量由 app 进程继承、模型不能设置，清空是防御性硬化，不写进 spec 判据 |

## 裁决点

- **Q1 git 的处置梯度——已裁决（2026-10-24）**。

  Alex 2026-10-24 否决原倾向（A 拆档），原话：

  > 「我不同意你的倾向——git diff / log / status 是最常用的命令，全部降为写意味着 ReadOnly
  > 这一档是没有实际使用可能性的。」

  **裁决：git 只读子命令族保持只读、不拆档。** `status` / `diff` / `log` / `show` / `blame`
  与既有保留族继续在三档免闸；argv 层只收紧全局 flag 白名单（`-c` / `--git-dir` / `--work-tree` /
  `-C` 一类归写）。

  安全论证随之改写（原论证把拆档当兜底，现改为修写入口）：

  1. 拆档针对的是「`vault_patch` 改 `.git/config` → `git status` 免闸执行 fsmonitor」这条零批准
     执行链。拆档只把链条的下游一步变成问一次，写入口本身仍然敞着；Alex 已把写入口点头立项
     （M656）。入口关闭后，这条链不再存在，下游无需再降档。
  2. 把 `git status` / `diff` / `log` 降为写，代价是最高频的只读查询逐次进闸——只读档剩下的
     `rev-parse` / `ls-files` 一类日常几乎不用，档位名存实亡。
  3. 残余风险如实写明、不由本 change 兜：把**不可信仓库**（配置在成为 vault 前已被写入、或由
     vault 之外进程改写）打开为 vault 时，git 仍会执行仓库配置指定的程序。这是「仓库来源可信」
     的运行环境假设；读侧与仓库来源校验不在本 change scope（design §8）。

  保持只读的连带补全：`status` / `diff` / `log` / `show` / `blame` 的 argv 级写形态（`--output`）
  必须单独拒判（Why 表 #4c 实测：`log` / `show` / `shortlog` 写文件，`diff` / `blame` 会把既有
  文件截为 0 字节）。原倾向 A 把这些子命令降写，写形态被顺带盖住；改裁后不补这一条，能力
  断言在 git 上不成立。

  原草案的另两条路（B 整族移除 / C 保持 + spawn 加固）不再采纳：B 与上述裁决直接冲突；
  C 的执行期注入把判据分散到每个子命令的每个执行路径，textconv / `log.showSignature` 等按驱动 /
  按配置开的口子难以穷举。本 change 对 git 只落 argv 判据，不做 spawn 注入；C 的加固不在本
  change 范围内。

## Impact

- 影响的 specs：`harness`（MODIFIED 1 条：`cli_run 命令分类与 vault 写重定向`）。
- 影响的代码 / 系统：`src-tauri/src/harness/permissions.rs`（分类表、参数级拒判、sed 扫描、
  git 全局 flag 白名单、`write_targets`）、`src-tauri/src/harness/tools.rs`（spawn 环境清理，D3）、
  对应单测；`scripts/acceptance/` 的既有场景回扫与新增场景。
- 关联约束：
  - ADR 0002 性能合同：分类只在工具调用路径，不进 keypress-to-paint。
  - ADR 0004：本文件与 design 必须让 Alex 不看代码就能裁决。
  - **前置依赖 M656**（`vault-patch-hidden-deny-oct24`）：git 只读族保持只读的安全前提是仓库
    配置没有默认档免闸写入口。M656 未落地前不得以「写入口已关闭」为由实施 / 合并本 change；
    实施顺序 M656 → 本 change（tasks 3.4）。
  - `docs/process/openspec-workflow.md`「改权限 / 闸语义的 change：tasks 必须含回扫既有验收场景的
    闸期望」——tasks 第 2 组。
  - M649（`harness-permission-rules-oct23`）与本 change 同改一条 requirement。起草基线
    （`40e6ae01`）上该提案尚未并入；2026-10-23 r1 评审时它已合并 master（merge `9e783038`）但
    未归档，living spec 仍是本 delta 的基线原文。delta 以 master 原文为基线，合并顺序处置见
    design §7。
