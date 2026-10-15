# harness 增量规格

> 起草注记（非规格正文）：本 change 让 `cli_run` 的子进程带上「用户登录 shell 解析出的完整 PATH」，
> 使裸命令无需 `zsh -lc` 包裹即可被找到（Alex 2026-10-12 裁决的「登录 shell 取 PATH」方案，
> Claude Code shell 快照路线的轻量版——只取 PATH，不快照函数 / 别名）。与 living spec 的
> 「工具循环」「权限机制」「cli_run 命令分类与 vault 写重定向」对齐。旗标（`-l -i`）、超时、缓存与
> 合并 / 回退口径见 [design.md](../../design.md)。本 change MUST NOT 改动权限模型。

## ADDED Requirements

### Requirement: cli_run 执行环境（登录 shell PATH）

系统 SHALL 在进程内**首次**执行 `cli_run` 时经用户登录 shell 解析一份完整 `PATH`，并把解析结果注入
此后每个 `cli_run` 子进程的环境变量 `PATH`——目的是让裸命令（如装在用户 shell 启动文件追加目录里的
CLI）无需 `zsh -lc` 一类包裹即可被找到，从而不再因「找不到命令」逐条进入批准闸。

shell SHALL 取环境变量 `SHELL`（缺失或 trim 后为空白时回落 `/bin/zsh`）。当 shell 的 basename 为
`zsh` 或 `bash` 时，系统 SHALL 以**登录 + 交互**旗标（`-l -i -c`）执行一条只打印 `PATH` 的命令
（实证：PATH 增补同时定义在登录启动文件与交互启动文件两处，只加载其一拿不全）；其余 shell MUST NOT
猜测旗标，直接按解析失败处理。解析 SHALL 在独立子进程内进行，`stdin` 置空、`stderr` 丢弃；输出 SHALL
用一对固定标记夹取 `PATH`（启动文件会向 stdout 打杂输出，MUST NOT 被当作 PATH）。解析 SHALL 带超时
（默认 5 秒）：超时 / 子进程错误 / 取不到标记 / 标记之间为空白，一律判**解析失败**。解析结果 SHALL
在进程内缓存复用（成功与失败都缓存），MUST NOT 每次 `cli_run` 都重新解析。

解析成功时注入的 `PATH` SHALL 为「解析结果在前 + 应用继承到的额外目录去重追加在后」（空段丢弃）；
解析失败时 MUST NOT 改写子进程环境——`cli_run` 子进程照常继承应用自身 `PATH`。本机制 MUST NOT 改动
权限模型：解析出的 `PATH` 只影响子进程能否找到命令，MUST NOT 影响命令是否被放行——命令分类、危险
黑名单、shell 包装器规则、allow / deny 规则、模式默认分层与批准缓存全部照旧只以 argv 为判据。

#### Scenario: 裸命令找到登录 shell 里的工具

- **WHEN** 用户 shell 的启动文件把某工具目录追加进 PATH，且该目录不在应用进程自身 PATH 里；模型调用
  `cli_run("tvly", ["--version"])`（裸命令，无 `zsh -lc` 包裹）
- **THEN** 子进程带上解析出的完整 PATH，命令被正常找到并执行，MUST NOT 出现「command not found」

#### Scenario: 解析失败回退继承 PATH

- **WHEN** 登录 shell 解析超时，或输出的标记之间为空（启动文件挂住 / 子进程被 kill / 启动文件把 PATH 清空）
- **THEN** `cli_run` 子进程不改写 PATH、照常继承应用自身环境，命令执行行为与本次改动前一致；
  AND 该失败结果被缓存，后续 `cli_run` MUST NOT 反复触发超时重试

#### Scenario: 只对已知 shell 解析

- **WHEN** `$SHELL` 指向 zsh / bash 之外的 shell（如 fish / nu），或缺失、为空白
- **THEN** zsh / bash ⇒ 以 `-l -i -c` 解析；其他 shell ⇒ 不猜旗标、按解析失败回退继承 PATH；
  `$SHELL` 缺失或空白 ⇒ 以 `/bin/zsh` 解析

#### Scenario: 权限判定不受 PATH 注入影响

- **WHEN** 解析出的 PATH 让某个此前找不到的命令变得可执行（如裸 `tvly`）
- **THEN** 该命令仍按既有分类走判定管线（只读直接放行、写在对应档逐个问、危险黑名单任何档都问），
  PATH 注入 MUST NOT 使任何命令免于判定；`zsh -lc` 一类 shell 包装器仍归危险、任何档都逐个问
