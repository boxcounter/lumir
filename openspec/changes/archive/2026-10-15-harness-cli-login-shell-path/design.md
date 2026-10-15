# Design: harness-cli-login-shell-path

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker
与归档评审对账。

**术语**（本 change 自造词，就地定义）：**登录 shell PATH 解析** = 起一个用户登录 shell 子进程、
让它执行一条只打印 `$PATH` 的命令、把输出取回来的动作；**继承 PATH** = Lumir 进程自身环境里的 `PATH`
（launchd / 终端启动 app 时给的那份）；**回退** = 解析失败时不改写子进程环境，让 `cli_run` 子进程照常
继承 app 的 `PATH`。

## 1. 调研结论（现状事实锚点 + 本机实证）

**现状代码锚点**（worktree wt-466 @ master）：

- `cli_run`（`src-tauri/src/harness/tools.rs:894`）直接用 `std::process::Command::new(command)` 起进程，
  只设 stdout / stderr 管道，**不碰子进程环境**（`tools.rs:920` 附近）——子进程完整继承 Lumir 进程的 `PATH`。
- 判定管线在 `turn.rs`（`Decision::Allow => tools::execute(...)`，`turn.rs:872`）**之前**完成；`tools::execute`
  里 `cli_run` 是纯执行，不参与判定（`tools.rs:275`）。所以「注入 PATH」天然不触碰权限层。
- 工具执行跑在会话线程（`harness.rs:1017` 的 `thread::spawn` → `turn::run_turn`），**不在 UI 主线程**——
  首次解析的阻塞（≤5s）不会卡界面。

**本机实证（2026-10-12，只读；真实 home 路径与启动文件内容不落 git）**：

- 目标命令（`tvly`）是 `~/.local/bin` 下的一个符号链接（指向 uv 工具目录）。
- `~/.local/bin` 的 PATH 增补**同时定义在两处**：登录启动文件（`.zprofile`，追加形态）与交互启动文件
  （`.zshrc`，前置形态）。用**干净环境**（`env -i`）分别跑三种旗标，实测各文件贡献：
  - `zsh -l -c`（登录、非交互）：只读 `.zshenv` + `.zprofile` ⇒ 得 Homebrew、`~/.local/bin`（追加）、
    Obsidian、OrbStack 等；**漏** `.zshrc` 的条目。
  - `zsh -i -c`（交互、非登录）：只读 `.zshenv` + `.zshrc` ⇒ 得 pnpm / kimi-code / libpq / `~/.local/bin`
    （前置）/ nvm 等；**漏** `.zprofile` 的条目。
  - `zsh -l -i -c`（登录 + 交互）：两者结果**并集**。
- 三种旗标下 `command -v tvly` 均能解析到 `~/.local/bin/tvly`（因为 `.local/bin` 两处都有），但**完整
  PATH** 只有 `-l -i` 拿得全 ⇒ 结论：**用 `-l -i -c`**。
- 输出污染：交互式 shell 会把 `pyenv` / `starship` / `zoxide` 的 init 噪声写 stdout / stderr ⇒
  必须**标记夹取** + stderr 丢弃。
- 耗时：`zsh -l -i -c` 约 0.5s（本机），远低于 5s 超时。

**结论写进代码注释**（`login_shell_flags` 的文档注释）：实证结论只写「PATH 增补同时定义在登录与交互
启动文件两处」，**不写真实文件名内容、不写真实 home 路径**。

## 2. 行为合同

| 环节 | 合同 |
|---|---|
| 触发时机 | **惰性**：进程内首次 `cli_run` 才解析；不拖慢 app 启动 |
| shell 选择 | `$SHELL`（缺失 / 空白回落 `/bin/zsh`） |
| 旗标 | 仅当 shell 的 basename 是 `zsh` / `bash` 时用 `-l -i -c`；其余 shell **不猜**，直接回退 |
| 解析命令 | `printf '<START>%s<END>' "$PATH"`（标记夹取，抗启动文件杂输出） |
| stdin / stderr | `stdin = null`（防交互式启动文件 `read` 挂住）、`stderr = null`（丢弃杂输出） |
| 超时 | 5 秒（`SHELL_PATH_TIMEOUT`）：超时即 kill 子进程并判失败 |
| 失败判据 | 超时 / 进程错误 / 非零退出后取不到标记 / 标记中间为空白 —— 一律判「解析失败」 |
| 缓存 | 进程内 `OnceLock<Option<String>>`；**成功与失败都缓存**（失败不每条命令重试 5s 超时） |
| 注入口径 | 解析成功 ⇒ `PATH = 解析结果（在前，去重复空段）+ 继承里的额外目录（在后，去重）`；解析失败 ⇒ **不调用** `.env("PATH", …)`，子进程照常继承 |
| 权限 | 不动：判定仍只看 argv；本机制只改子进程能否找到命令 |

**为什么「解析结果在前、继承在后」**：解析结果反映用户 shell 的语义（应优先），放前面让它胜出；
把继承里多出的目录追加在后面，是为了不丢 app 启动上下文（如 `pnpm tauri dev` 注入的 `node_modules/.bin`）
里可能有用的目录。去重保证同一目录只出现一次。

**为什么「失败回退 = 不注入」而不是「注入继承值」**：注入继承值与不注入对子进程完全等价
（子进程本就继承它），但「不注入」把「本机制没生效」这件事留在代码里**零副作用**——行为逐字节回到
改动前，便于失败时判断「是不是解析挂了」。故 `merge_paths` 在解析失败时返回 `None`。

## 3. 实现要点

- 纯函数（可确定性单测）：`parse_marked_path`（标记夹取）、`merge_paths`（合并 / 回退决策）、
  `login_shell_flags`（旗标选择）。
- 子进程解析器：`resolve_path_via_shell(shell, timeout)`——读管道放独立线程、结果经 `mpsc` 通道回传，
  主路径只做**截止时间**轮询 + `recv_timeout(剩余时间)`；这样即使**孙进程**占着管道不放，
  解析也不会拖过 `timeout`。
- 缓存入口：`cli_path()` 用 `OnceLock::get_or_init` 惰性解析一次并克隆复用。
- `cli_run` 只在解析到结果时 `.env("PATH", path)`。

## 4. 覆盖与证伪

- **确定性单测**（`cargo test --lib harness::tools`）：标记夹取（干净 / 含杂输出 / 缺标记 / 空值——
  证伪「读不到被当空串」）、合并回退（解析优先 / 去重 / 空段 / 双缺）、旗标（zsh / bash 给，fish / nu 不给）。
- **受控假 shell 链路测试**：造一个名为 `zsh` 的脚本模拟 shell 执行 `-c` 命令，验证
  「起子进程 → 夹取标记 → 解析」完整链路；另用挂住的假 shell（`exec sleep`）验证超时判 `None`
  且**耗时不超 timeout**。
- **真 zsh 冒烟**（可选，`/bin/zsh` 存在才跑）：`-l -i -c` 能解析出「像个 PATH」的结果。
- **端到端 + 反向验证**（实现期做，证据记入 tasks.md）：临时测试造一个「只存在于登录 shell PATH 里」
  的裸命令，验证 `cli_run` 能跑起来；把注入行临时改成不生效，**确认该测试转红**（`cli_spawn_failed`），
  再还原——证伪「断言没有区分度」。临时测试因改动进程级 `SHELL`/`PATH`（会让同进程其它用例串场，
  REVIEW.md 第 13 条）**不入库**，等价覆盖由上述确定性用例承担。

## 5. 已知边界与后续候选

- **解析失败静默回退**：见 proposal「已知边界」。让失败可见需要一个新 diagnostics 日志事件
  （`src-tauri/src/logging.rs` 的事件白名单，本 change scope 外）——列为后续候选。
- **只对 zsh / bash 生效**：其余 shell 直接回退（不快照、不猜旗标）。
- **不持久化**：解析结果只在进程内存，重启重新解析；用户改 shell 配置无需迁移。

## 6. 偏离登记

- proposal 的「What Changes」初稿里超时时间手误写「10 秒」，实现与本文最终口径均为 **5 秒**
  （`SHELL_PATH_TIMEOUT`）；已就地改准，无功能偏离。
- 端到端验证用**临时测试**完成（跑完删除），未入 git——理由见 §4（进程级环境变量会串场）。
