# Tasks: harness-cli-login-shell-path

## 1. 实证定位（旗标选择）

- [x] 1.1 只读查清本机 PATH 增补项定义在哪个（些）zsh 启动文件；用干净环境（`env -i`）分别实测
      `-l` / `-i` / `-l -i` 三种旗标各自的贡献，据此定旗标 —— 结论：增补**同时**定义在登录启动文件
      （`.zprofile`）与交互启动文件（`.zshrc`）两处 ⇒ 用 **`-l -i -c`**；`-l -c` 漏 `.zshrc`、
      `-i -c` 漏 `.zprofile`。真实 home 路径与启动文件内容**不落 git**，只写「定义在 X」。
      证据：三种旗标下的 PATH 逐段实测（干净环境）+ `command -v tvly` 三档均命中；写进
      `login_shell_flags` 的文档注释与 design §1
- [x] 1.2 确认输出污染与耗时：交互式 shell 把 `pyenv`/`starship`/`zoxide` init 噪声写 stdout/stderr
      ⇒ 采用标记夹取 + stderr 丢弃；`zsh -l -i -c` 实测约 0.5s，远低于 5s 超时。
      证据：design §1「输出污染」「耗时」两条

## 2. 实现（src-tauri/src/harness/tools.rs）

- [x] 2.1 纯函数三件：`parse_marked_path`（标记夹取）、`merge_paths`（合并 / 回退决策）、
      `login_shell_flags`（只对 zsh/bash 给 `-l -i -c`）
- [x] 2.2 子进程解析器 `resolve_path_via_shell(shell, timeout)`：`stdin` 空、`stderr` 丢弃、标记夹取、
      截止时间轮询 + `recv_timeout(剩余)`（孙进程占管道也不拖过 timeout）
- [x] 2.3 缓存入口 `cli_path()`：`OnceLock` 惰性解析一次（成功与失败都缓存），读 `$SHELL`（缺省
      `/bin/zsh`），走 `merge_paths`
- [x] 2.4 `cli_run`（`tools.rs:894`）的 `Command` 构造处：只在 `cli_path()` 返回 `Some` 时
      `.env("PATH", path)`；解析失败不注入。**权限层零改动**
- [x] 2.5 模块头补一段 cli_run 执行环境说明（工具集注释）

## 3. 测试与验证

- [x] 3.1 Rust 单测：标记夹取（干净 / 含杂输出 / 缺标记 / 空值）、合并回退（解析优先 / 去重 / 空段 /
      双缺）、旗标（zsh / bash 给，fish / nu 不给）
- [x] 3.2 受控假 shell 链路测：`zsh` 脚本模拟 shell 执行 `-c` ⇒ 验证起进程 → 夹取 → 解析链路；
      挂住的假 shell（`exec sleep`）⇒ 验证超时判 `None` 且耗时不超 timeout
- [x] 3.3 真 zsh 冒烟（`/bin/zsh` 存在才跑）：`-l -i -c` 解析出「像个 PATH」的结果
- [x] 3.4 端到端 + 反向验证：临时测试造「只存在于登录 shell PATH 里」的裸命令 ⇒ `cli_run` 能跑；
      临时关掉注入 ⇒ 同测试转红（`cli_spawn_failed`）⇒ 还原。临时测试跑完删除（原因见 design §4）
- [x] 3.5 `cargo test` 全绿（照抄结果行）
      —— M519 归档对账复跑（2026-10-15）：lib `test result: ok. 472 passed; 0 failed`；
      各 integration 目标合计 94 passed / 0 failed（7+41+2+16+6+22）；含
      `parse_marked_path` / `merge_paths` / `login_shell_flags` / `resolve_path_via_shell` 全组
- [x] 3.6 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
      —— M519 归档对账复跑（2026-10-15）：`GATE RESULT: 9/9 PASS（SKIP 1）`，退出码 0；
      SKIP 1 = `tsc-visual`（tests/visual 依赖未装，SKIP 单列）；`openspec-validate` PASS

## 4. 提案与归档

- [x] 4.1 OpenSpec change 提案（proposal / design / tasks / specs delta）随实现同 PR；记录 Alex
      2026-10-12 裁决原文与「Claude Code shell 快照轻量版」路线
- [x] 4.2 `openspec validate --all --strict` 通过
- [x] 4.3 信息卫生：改动面一次 text 级 grep 清扫（无真实 home 路径 / 无启动文件内容 / 无凭据）
- [x] 4.4 归档前逐条对账：tasks / spec 增量（ADDED ×1）/ 实现三者一致；确认权限层逐字未动
