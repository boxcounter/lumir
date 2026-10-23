# harness 增量规格

> 起草注记（非规格正文）：本 change 只改一条 requirement——「cli_run 命令分类与 vault 写重定向」。
> 机制、逐成员处置与实测证据见 [design.md](../../design.md)；与 M649（`harness-permission-rules-oct23`）
> 的 delta 合并口径见 design §7。MODIFIED 块基于当前 living spec（`openspec/specs/harness/spec.md`，
> master `40e6ae01`）的原文整块复制后修改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: cli_run 命令分类与 vault 写重定向

系统 SHALL 在权限判定前对每次 `cli_run` 调用做命令分类：按命令名白名单与参数形态判定为**只读**（如 `ls` / `cat` / `rg` / `git` 的只读子命令族 / 静态度量后可证明不含写与执行命令的 `sed` / `jq` 等；白名单成员的具体清单与每成员的可接受形态以本条下方「只读分类的能力断言」为准）、**危险**（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / `git reset --hard` / `git clean` / shell 包装器类，以及白名单成员的可执行参数形态，见本条下方「只读分类的能力断言」）或**写**（其余一切，含未知命令——保守默认）。shell 包装器命令（`sh` / `bash` / `zsh` / `dash` / `fish` / `csh` / `ksh` / `cmd` / `powershell` / `pwsh` / `osascript` / `eval` / `exec` 等）SHALL 归为危险——内容不可知即视同潜在危险，任何档都逐个问（tower 已裁决，Alex「危险命令任何档都问」分界的推论）。任一参数含 shell 元字符（`|` `;` `&&` `||` `>` `>>` `<` 等）的调用 SHALL 保守归为写。三者均 MUST NOT 按命令名白名单放行。

**只读分类的能力断言**：一次 `cli_run` 调用被判为只读，SHALL 意味着按该调用的 argv 与其执行环境，这次调用不写文件、也不执行外部程序（不由该命令自行启动任何程序）。这是一条对任意 argv 成立的能力断言，MUST NOT 以「该命令的常见用法是只读」为放行依据；形态判定不明确时 SHALL 归为写，MUST NOT 归为只读。白名单成员出现写文件形态时 SHALL 归为写：`base64` 的 `-o` / `--output`，`xxd` 的第二个位置参数（输出文件；`-r` 与普通 dump 形态相同），`file` 的 `-C` / `--compile`，`tree` 的 `-o` / `-R`，`less` 的 `-o` / `-O` / `--log-file`，`find` 的 `-fprint` / `-fprint0` / `-fprintf` / `-fls`，`sed` 脚本的 `w` / `W` 命令与 `s///w` 标志。白名单成员出现执行外部程序的形态时 SHALL 归为危险：`rg` 的 `--pre` / `--pre-glob` / `--hostname-bin`，`sed` 脚本的 `e` 命令与 `s///e` 标志——危险层任何权限档都逐个问，MUST NOT 被 allow 规则或会话缓存解锁。`sed` 的脚本源（`-e` / `--expression=` / 无 `-e`·`-f` 时的第一个非 flag 参数）SHALL 经静态扫描判定；`-f` / `--file` 形态（脚本体在分类时不可见）与无法完整解析的脚本 SHALL 归为写。`sed` 的就地写判定 SHALL 按短旗标簇展开（`-i` 与 `-ni` 一类捆绑形态同等命中）。

`git` 的只读子命令族 SHALL 只包含不触发 diff 机制、不读取执行型仓库配置的子命令：`rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch` 与 `tag` 的纯列表形态 / `remote -v`。`status` / `diff` / `log` / `show` / `blame` SHALL 归为写——这些子命令会执行仓库 config 或 gitattributes 指定的外部程序（`core.fsmonitor`、`diff.external`、textconv、`log.showSignature` 的 gpg），而仓库配置的内容不在 argv 的可见范围内。`git` 的全局 flag SHALL 走白名单（`-P` / `--no-pager` / `--no-optional-locks` / `--no-replace-objects`）；表外全局 flag（含 `-c` / `--config-env` / `--exec-path` / `--git-dir` / `--work-tree`）SHALL 归为写。`git --version` 不受本节限制，仍为只读。

间接调用包装器（`sudo` / `xargs` / `find` 的 `-exec` / `-execdir` / `-ok` / `-okdir`，2026-10-10 Alex 裁决「堵」）SHALL 递归提取被包装命令、以其分类为本条调用的分类：`sudo rm` 视同 `rm`（危险），`sudo ls` 视同 `ls`（只读，不得误伤）。被包装命令取不出确定形态（裸 `sudo` / `xargs` 无命令 / `-exec` 子句不完整）SHALL 保守归为危险——任何档都逐个问。递归 MUST NOT 展开到包装器名单之外（不做通用 shell 语义解析），且 MUST 先于 shell 元字符保守规则判定（`sudo bash -c "a;b"` 按被包装命令判，不因外层参数带元字符落「写」被 `full_access` 放行）。

分类为写、且写目标解析进 vault 内的 `cli_run` 调用，**任何权限档都 SHALL 直接拒绝**并回送结构化重定向提示：固定错误码（`cli_redirected_to_vault_tool`）+ 固定标记文本包裹的 JSON 载荷（`reason` / `targets` / `suggested_tool` 字段固定），指明应改用哪个 vault 工具（`vault_patch` / `vault_create` / `vault_move` / `vault_delete`）。`suggested_tool` SHALL 按写动词形态映射（`mv`/`cp`→`vault_move`、`rm`→`vault_delete`、`sed -i`/重定向→`vault_patch`、`touch`/新文件→`vault_create`、`mkdir`→`vault_create`）——`mkdir` 的落点是 `vault_create`：建目录不另立工具，`vault_create` SHALL 自动创建缺失的父目录（`mkdir -p` 语义）。目标是否「在 vault 内」的判定不确定时 SHALL NOT 重定向，回落正常写分类。闸门 MUST NOT 自动把 cli_run 改写成 vault 工具调用——重定向只经回送文本由模型自行改道。

#### Scenario: vault 内写被重定向

- **WHEN** 任意模式下模型调用 `cli_run("mv", ["notes/a.md", "notes/b.md"])`
- **THEN** 调用被拒绝（不执行），tool result 含固定标记文本与 JSON 载荷（targets 含 `notes/a.md` / `notes/b.md`，suggested_tool 为 `vault_move`）

#### Scenario: mkdir 写被重定向到 vault_create

- **WHEN** 任意模式下模型调用 `cli_run("mkdir", ["notes/2026"])`（写目标 `notes/2026` 解析进 vault 内）
- **THEN** 调用被拒绝（不执行），tool result 的 `suggested_tool` 为 `vault_create`；下一轮模型经 `vault_create` 在该目录下落文件即连带建出父目录（`mkdir -p` 语义，不另立目录工具）

#### Scenario: 模型改道 vault 工具完成写

- **WHEN** 模型收到上述重定向结果后，下一轮改调 `vault_move(path: "notes/a.md", new_path: "notes/b.md")`
- **THEN** `vault_move` 按模式语义表执行（默认档直接放行），文件完成移动，工具循环继续

#### Scenario: vault 外写不被重定向

- **WHEN** 模型调用 `cli_run("npm", ["install"])`（写目标不在 vault 内）
- **THEN** 调用按模式语义表处理（默认档逐个问），回送中 MUST NOT 出现重定向标记

#### Scenario: 元字符参数保守归类

- **WHEN** 模型调用 `cli_run("ls", ["-la;", "rm", "-rf", "/tmp/x"])`（参数含元字符）
- **THEN** 调用 MUST NOT 因 `ls` 在白名单而放行——整调用按写分类（`read_only` / `vault_write` 档逐个问，`full_access` 档放行）

#### Scenario: shell 包装器任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("bash", ["-c", "rm -rf /tmp/x"])`
- **THEN** 调用进入批准闸（批准卡显示完整命令），MUST NOT 自动放行——shell 包装器内容不可知，视同潜在危险；MUST NOT 走进 vault 写重定向层

#### Scenario: 间接调用包装器递归（sudo / xargs / find -exec）

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("sudo", ["rm", "-rf", "/tmp/x"])`（或 `xargs rm` / `find . -exec rm {} \;` 形态）
- **THEN** 调用进入批准闸，MUST NOT 自动放行——被包装命令是黑名单成员，视同直接调用；用户 allow 规则与「本会话不再问」缓存 MUST NOT 解锁本层
- **AND** 同模式下调用 `cli_run("sudo", ["ls", "-la"])` 直接放行（被包装命令是只读白名单，不得误伤）
- **AND** 调用 `cli_run("sudo", [])`（取不出被包装命令）进入批准闸——保守归危险，宁多问勿漏拦

#### Scenario: 白名单成员的写形态归写

- **WHEN** 默认 `vault_write` 档下模型调用 `cli_run("base64", ["-i", "a.txt", "-o", "/tmp/out.b64"])`，或调用 `cli_run("xxd", ["in.bin", "/tmp/out.hex"])`（普通 dump 形态）、`cli_run("xxd", ["-r", "in.hex", "/tmp/out.bin"])`、`cli_run("file", ["-C", "-m", "magic"])`、`cli_run("find", [".", "-name", "*.md", "-fprint", "/tmp/list.txt"])`
- **THEN** 每次调用都按写分类、进入批准闸（MUST NOT 因命令名在白名单而放行）
- **AND** 同档下 `cli_run("base64", ["-d", "a.txt"])`、`cli_run("xxd", ["a.bin"])`（只有一个位置参数，输出到 stdout）、`cli_run("xxd", ["-c", "16", "a.bin"])`（取值旗标的值不计位置参数）、`cli_run("find", [".", "-name", "*.md"])` 仍直接执行（不含写形态）

#### Scenario: sed 脚本的写命令、脚本文件与解析失败

- **WHEN** 默认档模型调用 `cli_run("sed", ["-n", "w /tmp/out.txt", "a.md"])` 或 `cli_run("sed", ["-f", "script.sed", "a.md"])`
- **THEN** 调用按写分类、进入批准闸——前者脚本含 `w` 命令，后者脚本体在分类时不可见
- **AND** 同档下 `cli_run("sed", ["s/a/b/", "a.md"])` 直接执行（脚本可完整解析且不含写 / 执行命令）
- **AND** 无法解析的脚本（如未闭合分隔符）同样按写分类，MUST NOT 按只读放行

#### Scenario: 白名单成员的可执行形态归危险

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("rg", ["--pre", "/tmp/pre.sh", "needle", "."])` 或 `cli_run("rg", ["--hostname-bin=/tmp/bin", "needle", "."])`
- **THEN** 调用进入批准闸，MUST NOT 自动放行——这两个形态会对每个待搜文件 / 为取主机名执行外部程序
- **AND** 同模式下 `cli_run("rg", ["needle", "."])` 直接执行
- **AND** `sed` 脚本含 `e` 或 `s///e` 时同样按危险分类（任何档都问）

#### Scenario: git 只读子命令族收缩

- **WHEN** 默认档模型调用 `cli_run("git", ["status"])` 或 `cli_run("git", ["diff"])`
- **THEN** 调用按写分类、进入批准闸——这两个子命令会执行仓库配置指定的外部程序（`core.fsmonitor` / `diff.external`）
- **AND** 同档下 `cli_run("git", ["rev-parse", "HEAD"])`、`cli_run("git", ["ls-files"])`、`cli_run("git", ["branch", "-a"])` 仍直接执行

#### Scenario: git 全局 flag 归写

- **WHEN** 模型调用 `cli_run("git", ["--git-dir", "/tmp/other/.git", "diff"])` 或 `cli_run("git", ["-c", "diff.external=/tmp/x", "diff"])` 或 `cli_run("git", ["-cdiff.external=/tmp/x", "diff"])`
- **THEN** 调用按写分类、进入批准闸——全局 flag 不在白名单内（`-c` / `--config-env` / `--exec-path` / `--git-dir` / `--work-tree` 可注入或指向执行型仓库配置）
- **AND** `cli_run("git", ["--no-pager", "rev-parse", "HEAD"])` 仍直接执行（白名单内全局 flag + 保留子命令）
