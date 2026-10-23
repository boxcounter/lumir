# Proposal: 收紧只读白名单——被判只读的命令不得自带写文件 / 执行程序能力

- Change ID: `readonly-allowlist-tightening-oct23`
- 日期: 2026-10-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**待 Alex 裁决**（2026-10-23 起草）。一个裁决点 Q1（git 的处置梯度）；
> 其余为起草期取值 D1–D3，不同意时直接否掉即可，不回即按倾向落地。
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

### 实测证据（2026-10-23，本机 macOS 26.6.2 / git 2.50.1 / ripgrep 15.2.0 / file 5.41 / BSD sed·base64）

全部探针在合成目录 `/tmp/lumir-probe-m652` 下执行，无真实 vault 内容。

| # | 形态 | 结果 | 与 finding 的关系 |
|---|---|---|---|
| 1 | `base64 -i a.txt -o out.b64` | 写出文件（17 字节） | 能力成立。finding 写的 `base64 -o out a.txt` 在本机报 `invalid argument`——macOS 版 base64 用 `-i` 指定输入，示例形态不成立，能力本身成立 |
| 2 | `sed -n 'w out.txt' a.txt` | 写出文件 | 与 finding 一致 |
| 2b | `sed -n -f script.sed a.txt`（脚本内含 `w`） | 写出文件 | finding 未列：**脚本走文件时内容在分类期不可见**，静态判据看不到 `w` |
| 3 | `rg --pre /usr/bin/touch needle .` | 执行了指定程序（flag 文件 mtime 更新）；`rg --pre ./pre.sh` 同样执行 | 与 finding 一致 |
| 3b | `rg --hostname-bin=./hostbin.sh needle .` | 执行了指定程序 | finding 未列，同一执行能力 |
| 4 | `git status`（仓库 config 设 `core.fsmonitor`） | 执行了 config 指定的程序 | **finding 第 4 条的字面形态不成立、但风险更大**，见下 |
| 4b | `git diff`（仓库 config 设 `diff.external`） | 执行了 config 指定的程序 | 同上 |
| 5 | `xxd -r hex.txt out.bin` | 写出文件 | finding 未列（第二位置参数是输出文件） |
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

**可达性不是理论**：`vault_patch` 对既有隐藏文件不做 hidden 档判定（`src-tauri/src/fs_io.rs:1559`
的 `fs_patch_file` 只走 `resolve_in_vault`），默认档免闸；「改 `.git/config` → `git status`」是一条
零批准的执行链。我已经把这条单独登记为 finding（隐藏文件写入面本身，不在本 change scope）；
本 change 只负责把下游的只读 git 拆掉。

## What Changes

1. **只读分类的能力断言（spec 条款）**。在被修改的 requirement 里写死：判为只读 = 按 argv 与其
   执行环境不写文件、不执行外部程序；MUST NOT 以「常见用法」为放行依据；形态判不明确即归写。
2. **参数级拒判（写形态 → 写）**。白名单成员出现写文件形态时降为写：`base64 -o/--output`、
   `xxd -r`、`file -C`、`tree -o`/`-R`、`less -o`、`find -fprint/-fprint0/-fprintf/-fls`、
   `sed` 脚本的 `w`/`W` 与 `s///w`。
3. **执行形态（→ 危险）**。`rg --pre/--pre-glob/--hostname-bin`、`sed` 脚本的 `e`/`s///e` 归为
   危险——「任意命令执行」与 shell 包装器同级，任何档都逐个问，full_access 也不例外。
4. **git 拆档（Q1）**。只读子命令族收缩为不触发 diff 机制、不读执行型仓库配置的一族
   （`rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 列表 /
   `remote -v`）；`status` / `diff` / `log` / `show` / `blame` 降为写；全局 flag 走白名单。
5. **重定向写目标补全**。新增的写形态若目标是 vault 内路径（`base64 -o`、`tree -o`、
   `xxd -r` 的输出、`find -fprint` 系），仍按既有「vault 内写改道」条款重定向，不掉成普通写。

逐成员处置表（完整 31 行在 design §3）摘要：

| 成员 | 处置 |
|---|---|
| `base64` | `-o` / `--output` 形态 → 写 |
| `xxd` | `-r` 形态 → 写 |
| `file` | `-C` / `--compile` 形态 → 写 |
| `tree` | `-o` / `-R` 形态 → 写（文档口径，本机未安装） |
| `less` | `-o` / `-O` / `--log-file` → 写（防御性；当前 spawn 形态下不可达） |
| `find` | `-fprint` / `-fprint0` / `-fprintf` / `-fls` → 写（GNU find 形态） |
| `sed` | 脚本含 `w`/`W`/`s///w`、`-f` 脚本文件、解析失败 → 写；脚本含 `e`/`s///e` → 危险 |
| `rg` | `--pre` / `--pre-glob` / `--hostname-bin` → 危险 |
| `git` | 只读子命令族收缩 + 全局 flag 白名单（Q1） |
| 其余 22 个成员 | 2026-10-23 逐一核对 man / help，无 argv 级写或执行形态 → 不变 |

## Non-goals

- **不做 OS 沙箱**（`sandbox-exec` 一类）。本 change 修的是分类器的判据，不是执行隔离；真沙箱是
  另一个量级的提案。
- **不引入 `ask` 规则层**，不改判定层序，不改危险黑名单既有成员与「任何档都问」承诺。
- **不改 M649 的受限解包判据**。解包复用同一份 `classify_cli`，子命令自动继承本 change 的收紧；
  两者对同一 requirement 的 delta 合并口径见 design §7。
- **不修隐藏文件可被 `vault_patch` 改写**（已单列 finding），也不做读侧隔离——`cat` / `grep` 今天
  就能读 vault 外文件，只读白名单不承担读边界。
- 不把环境变量注入纳入 argv 判据（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `GREP_OPTIONS` 由 app 进程
  继承、模型不可设置）；取值 D3 在 spawn 侧做一次防御性清空，spec 不依赖它。

## 起草期取值（不同意请直接否）

| # | 取值 | 倾向与理由 |
|---|---|---|
| D1 | 写形态归「写」、执行形态归「危险」 | 与既有三档语义一一对应：写形态在 full_access 免闸（与 `cp` / `tee` 同档），执行形态任何档都问（与 shell 包装器同承诺）。若把 `base64 -o` 也归危险，等于给「任意路径写」新开一个全档拦截层，超出本 finding 的范围 |
| D2 | `sed` 保留在白名单，用保守脚本扫描而不是整成员移除 | 移除会让 `sed 's/a/b/'` 这种最常见的只读替换也逐次问；扫描器只对「能完整解析且无 `w`/`W`/`e`」的脚本放行，其余一律降写（fail-closed） |
| D3 | `less` / `more` 保留，`less` 的 `-o` 做防御性拒判；spawn 时清空四个注入型环境变量（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `LESSCLOSE` / `GREP_OPTIONS`） | 当前 spawn 下 `less` 非 tty、stdin 非管道，`-o` 与 `+cmd` 都不可达；拒判是给未来 spawn 形态变化留的防线，不给成员移除的代价。环境变量由 app 进程继承、模型不能设置，清空是防御性硬化，不写进 spec 判据 |

## 裁决点

- **Q1 git 的处置梯度**。三条路：
  - **A（倾向）拆档**：保留 `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` /
    `branch`·`tag` 列表 / `remote -v`；`status` / `diff` / `log` / `show` / `blame` 降为写。
    默认档下 `git status`、`git diff` 会开始问。理由是这两族正好是会执行仓库 config 的
    （`core.fsmonitor` / `diff.external` / textconv / `log.showSignature`），其余子命令不触发。
  - **B 整族移除**：全部 git 归写。残余面最小、实现最简单；代价是 `git rev-parse HEAD` 这类纯元
    数据查询也逐次问。
  - **C 保持 + spawn 加固**：保留全部只读子命令，执行时注入 `-c core.fsmonitor=false`、
    `--no-ext-diff`、`--no-textconv`。不倾向：判据分散到每个子命令的每个执行路径，textconv /
    `log.showSignature` 等按驱动 / 按配置开的口子难以穷举，日后 git 新增一个执行型配置就再破一次。

## Impact

- 影响的 specs：`harness`（MODIFIED 1 条：`cli_run 命令分类与 vault 写重定向`）。
- 影响的代码 / 系统：`src-tauri/src/harness/permissions.rs`（分类表、参数级拒判、sed 扫描、
  git 子命令表、`write_targets`）、`src-tauri/src/harness/tools.rs`（spawn 环境清理，D3）、
  对应单测；`scripts/acceptance/` 的既有场景回扫与新增场景。
- 关联约束：
  - ADR 0002 性能合同：分类只在工具调用路径，不进 keypress-to-paint。
  - ADR 0004：本文件与 design 必须让 Alex 不看代码就能裁决。
  - `docs/process/openspec-workflow.md`「改权限 / 闸语义的 change：tasks 必须含回扫既有验收场景的
    闸期望」——tasks 第 2 组。
  - M649（`harness-permission-rules-oct23`）与本 change 同改一条 requirement；起草时该提案**尚未
    并入 master**（`git merge-base --is-ancestor` 不成立），delta 以 master 原文为基线，合并顺序
    处置见 design §7。
