//! 权限判定管线（change add-harness-permission-modes，design §1–§4）：五层短路，**前四层
//! 与权限模式无关**，模式只决定最底层的默认分层。
//!
//! ```text
//! 1. deny 规则命中            → Deny（回送模型，不进批准闸）      [既有语义不变]
//! 2. cli_run ∧ 分类为写 ∧ 写目标解析进 vault 内
//!                            → Redirect（固定标记 + 建议 vault 工具，design §4）
//! 3. 危险黑名单命中           → Ask（任何档都问，含 full_access）
//! 4. allow 规则命中           → Allow                            [既有语义不变]
//! 5. 模式默认分层             → 见 [`mode_layer`]（会话内批准缓存在此层短路）
//! ```
//!
//! 两处「在 allow 规则之前」的层是刻意的（design §1）：重定向是 Alex 诉求的原点（vault 内写
//! 走 vault 工具、不过 cli_run），黑名单是「任何档都问」的绝对层——用户 allow 规则都绕不过它们。
//! deny 规则永远第一（用户显式拒绝优先于一切）。
//!
//! 规则语法（既有，未改）：tool 级（`vault_patch`）或 tool(模式) 级（`cli(demo *)`）——模式对
//! **主体串**做前缀 + `*` 通配。主体串取法见 [`super::tools::permission_subject`]。
//!
//! cli_run 分类表（design §3）是**代码内的唯一真源**：config 规则表管「用户加减项」，不管分类
//! （REVIEW.md 第 8 条：同一个语义不许两处各判一半）。保守默认一律归写——错误方向是「多问一次」，
//! 不是「误放行」。
//!
//! 会话内批准缓存的**模块**在 [`super::permission_cache`]（design §6）；判定只消费它的一个
//! 布尔（[`Judge::cached`]），缓存本身不在这里持有状态——判定函数保持纯函数，单测不必碰全局态。
//!
//! 三档语义（design §2，2026-10-09 Alex 裁决后的现行口径）：`read_only` = **Always Ask**
//! （读类自动放行、一切写逐个问）；`vault_write`（默认）= vault 写工具放行（`vault_delete`
//! 逐个问）加 cli_run 经分类；`full_access` = 写命令免闸（vault 内写仍走第 2 层重定向）。
//! **模式层不再产生 Deny**——`Decision::Deny` 只可能来自第 1 层的用户 deny 规则。

// 会话内批准缓存（design §6）是同级模块 [`super::permission_cache`]（M413 起收编为
// `harness.rs` 的正常模块声明）；本模块只消费它的一个布尔（[`Judge::cached`]）。

use std::path::{Component, Path};

use crate::config::{HarnessPermissions, PermissionMode};

/// 判定结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Ask,
    /// 拒绝：**只有用户 deny 规则**能走到这里（design §1 第 1 层）。模式层不再产生 Deny——
    /// 2026-10-09 Alex 裁决把 `read_only` 从「拒绝写」改成「写一律逐个问」（Kimi Code 的
    /// Always Ask 语义），因此三档的模式层只产出 Allow / Ask 两种。
    Deny,
    /// cli_run 写 vault 内目标：硬重定向（design §4.2 的固定标记 + JSON 载荷）。
    Redirect(Redirect),
}

/// 读类工具：默认 allow（三档一致）。
const READ_TOOLS: [&str; 3] = ["vault_read", "vault_search", "skill_load"];

/// 判定一次工具调用（design §1 的五层管线）。
///
/// `subject`：模式匹配的主体串（cli 为拼接 argv，vault 工具为路径参数）。
/// `judge`：模式 / vault 根（重定向判定用）/ argv（cli_run 分类与写目标提取用）/ 缓存命中。
pub fn decide(
    permissions: &HarnessPermissions,
    tool: &str,
    subject: &str,
    judge: &Judge,
) -> Decision {
    // 第 1 层：用户显式 deny 优先于一切（含重定向与黑名单）。
    if matches_rule(&permissions.deny, tool, subject) {
        return Decision::Deny;
    }

    let class = (tool == "cli_run")
        .then(|| judge.argv.as_deref().map(classify_cli))
        .flatten();

    // 第 2 层：vault 内写硬重定向（任何档，含 full_access；design §4 + 裁决点 6）。
    if class == Some(CliClass::Write) {
        if let Some(redirect) = redirect_for(judge.root, judge.argv.as_deref().unwrap_or(&[])) {
            return Decision::Redirect(redirect);
        }
    }

    // 第 3 层：危险黑名单（任何档都问，不静默 deny——用户在批准卡里看得到完整命令）。
    if class == Some(CliClass::Dangerous) {
        return Decision::Ask;
    }

    // 第 4 层：用户显式 allow。
    if matches_rule(&permissions.allow, tool, subject) {
        return Decision::Allow;
    }

    // 第 5 层：模式默认分层（会话内批准缓存命中即在此层短路——它不解锁上面三层）。
    if judge.cached {
        return Decision::Allow;
    }
    mode_layer(tool, class, judge.mode)
}

/// 判定的输入面（工具名与主体串之外的一切）：模式、vault 根、cli argv、会话内缓存命中。
pub struct Judge<'a> {
    pub mode: PermissionMode,
    /// vault 根（重定向的 vault 内判定用）。
    pub root: &'a Path,
    /// cli_run 的 argv（command + args）；非 cli_run 传 `None`。持有所有权：调用点只需从参数
    /// 里取出一次（[`super::tools::cli_argv`]），判定层不必再操心借用窗口。
    pub argv: Option<Vec<String>>,
    /// 会话内批准缓存命中（design §6：`(工具, 规范化主体串)` 精确匹配）。
    pub cached: bool,
}

/// 模式默认分层（design §2 语义表逐格）——判定管线的最底层。
fn mode_layer(tool: &str, class: Option<CliClass>, mode: PermissionMode) -> Decision {
    if READ_TOOLS.contains(&tool) {
        return Decision::Allow;
    }
    match tool {
        // cli_run：只读白名单任何档放行；写命令在 full_access 自动放行（vault 内目标已在
        // 第 2 层被重定向掉），其余档逐个问。Dangerous 到不了这里（第 3 层已短路）。
        "cli_run" => match class {
            Some(CliClass::ReadOnly) => Decision::Allow,
            Some(CliClass::Write) => match mode {
                PermissionMode::FullAccess => Decision::Allow,
                PermissionMode::ReadOnly | PermissionMode::VaultWrite => Decision::Ask,
            },
            _ => Decision::Ask,
        },
        // vault 写工具（patch / create / move）：`read_only` 档逐个问、`vault_write`（默认）与
        // `full_access` 档放行。
        //
        // `read_only` = **Always Ask**（Alex 2026-10-09 裁决，design §2 修订）：该档的承诺是
        // 「读自动放行、一切写逐个问」，不是「一切写都拒」——一档全拒的只读没有实用价值
        // （原「Deny 而非 Ask」口径作废）。默认档的行为差分不变：vault 写工具免闸。
        "vault_patch" | "vault_create" | "vault_move" => match mode {
            PermissionMode::ReadOnly => Decision::Ask,
            PermissionMode::VaultWrite | PermissionMode::FullAccess => Decision::Allow,
        },
        // vault_delete：Vault Write 档仍逐个问（裁决点 1 落 B）——删除是移入废纸篓、可恢复，
        // 但打断成本高于 patch；与「危险黑名单任何档都问」同一安全侧。只读档同为逐个问
        // （Always Ask），语义与上面三个写工具一致。
        "vault_delete" => match mode {
            PermissionMode::FullAccess => Decision::Allow,
            PermissionMode::ReadOnly | PermissionMode::VaultWrite => Decision::Ask,
        },
        // 清单外工具：调度层在判定之前已按 `tool_unknown` 短路，这里只兜底保守问。
        _ => Decision::Ask,
    }
}

// ---------------------------------------------------------------------------
// cli_run 命令分类（design §3）
// ---------------------------------------------------------------------------

/// cli_run 命令分类三态（design §3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliClass {
    ReadOnly,
    Write,
    Dangerous,
}

/// 只读白名单（design §3.1，裁决点 2 按初始表落地）：任意参数形态皆为纯读。含条件形态的
/// `find` / `sed` / `git` 不在本表（各自走到 [`classify_cli`] 的分支）。
const READ_ONLY_COMMANDS: [&str; 28] = [
    "ls", "cat", "head", "tail", "wc", "file", "stat", "pwd", "which", "whereis", "echo", "printf",
    "date", "uname", "du", "df", "rg", "grep", "egrep", "fgrep", "tree", "less", "more", "jq",
    "xxd", "od", "hexdump", "base64",
];

/// 已知写动词（design §3.2）：整 argv 落入写分类，走模式默认分层。原则是**拿不准就写**——
/// 这张表的意义是把「我们认得的写」写明白，落表外的未知命令同样归写（默认保守），
/// 因此它不是许可清单，退化时不会误放行。
const WRITE_COMMANDS: [&str; 24] = [
    "cp",
    "mv",
    "ln",
    "touch",
    "mkdir",
    "rmdir",
    "tee",
    "truncate",
    "install",
    "chmod",
    "chown",
    "curl",
    "wget",
    "scp",
    "rsync",
    "npm",
    "pnpm",
    "yarn",
    "cargo",
    "make",
    "tar",
    "ssh",
    "kill",
    "launchctl",
];

/// 解释器 / eval 形态（design §3.2）：`-c` / `-e` 或脚本文件参数可做任何事，一律写。
/// 逐个参数形态判定没有意义（`python3 script.py` 与 `python3 -c …` 同样不可静态验证），
/// 整命令名归写——与「语义单一，可经 allow / deny 规则精确加减」的 design 口径一致。
const INTERPRETERS: [&str; 5] = ["python", "python3", "node", "ruby", "perl"];

/// shell 包装器类（design §3.3，tower 已裁决归危险）：包装器的全部用途是组合任意命令，
/// 内部对分类表完全不可见（`bash -c "rm -rf …"` 的命令名是 `bash`）。归写会让 full_access
/// 档免闸——那是唯一绕开黑名单的口径洞，故归危险（任何档都问）。
const DANGEROUS_WRAPPERS: [&str; 13] = [
    "sh",
    "bash",
    "zsh",
    "dash",
    "fish",
    "csh",
    "ksh",
    "cmd",
    "powershell",
    "pwsh",
    "osascript",
    "eval",
    "exec",
];

/// 危险黑名单的整命令成员（design §3.3）：删除类 `rm`（任何形态——Alex 点名的那类）、
/// 关机 / 重启类、裸写类 `dd`。
const DANGEROUS_COMMANDS: [&str; 6] = ["rm", "shutdown", "reboot", "halt", "poweroff", "dd"];

/// 危险黑名单的磁盘类（design §3.3）：`fdisk` / `parted` 整命令，`mkfs` 系按前缀判。
const DANGEROUS_DISK: [&str; 2] = ["fdisk", "parted"];

/// shell 元字符（design §3.2）：argv 直传下它们是**字面参数**（无害），仍保守按写处理——
/// 一是防未来出现 shell 化执行路径时分类表变成隐患，二是模型把复合命令塞进单参数本身
/// 就说明意图是复合写。
const SHELL_META: [&str; 10] = ["|", ";", "&&", "||", ">", ">>", "<", "`", "$(", "${"];

/// argv → 三态分类（design §3）。输入是 argv 数组（command + args），比主体串拼接信息全。
///
/// 判序：危险（黑名单整表，含包装器）→ 间接调用包装器递归（sudo / xargs / find -exec 系，
/// 取被包装命令再分类，取不出归危险）→ 保守降级（解释器 / 元字符 / 已知写动词）→ 只读白名单
/// → 未知归写。危险先判是因为黑名单与白名单的交集按黑名单处理（更保守侧赢，design §3.3）。
pub fn classify_cli(argv: &[String]) -> CliClass {
    let Some(command) = argv.first() else {
        return CliClass::Write;
    };
    // 小写化再查表：macOS 默认文件系统大小写不敏感（`BASH` 会解析到 `bash`），
    // 白名单成员被小写化只会掉进「未知 ⇒ 写」的保守侧，不会误放行。
    let name = command_basename(command);
    if name.is_empty() {
        return CliClass::Write;
    }
    let args = &argv[1..];

    if is_dangerous(&name, args) {
        return CliClass::Dangerous;
    }
    // 间接调用包装器（sudo / xargs / find -exec 系）：按命令名字面匹配会让 `sudo rm` 在
    // full_access 档免闸绕过黑名单（backlog 2026-10-10 Alex 裁决「堵」）——先递归取被包装
    // 命令再进分类管线；取不出确定形态保守归危险（任何档都问）。放在解释器 / 元字符检查
    // 之前：`sudo bash -c "a;b"` 的外层参数带元字符，先判元字符会落「写」被 full_access 放行。
    if let Some(class) = classify_wrapped(&name, args) {
        return class;
    }
    if INTERPRETERS.contains(&name.as_str()) {
        return CliClass::Write;
    }
    if args
        .iter()
        .any(|arg| SHELL_META.iter().any(|meta| arg.contains(meta)))
    {
        return CliClass::Write;
    }
    if WRITE_COMMANDS.contains(&name.as_str()) {
        return CliClass::Write;
    }
    match name.as_str() {
        // find 的 `-exec` 可执行任意命令、`-delete` 直接删文件；`-execdir` / `-ok` / `-okdir`
        // 是同一能力（分别在不同目录执行 / 交互确认），一并按写处理。
        "find" => {
            if args.iter().any(|arg| {
                matches!(
                    arg.as_str(),
                    "-delete" | "-exec" | "-execdir" | "-ok" | "-okdir"
                )
            }) {
                CliClass::Write
            } else {
                CliClass::ReadOnly
            }
        }
        // sed 带 -i / --in-place（含 `-i.bak` 这类后缀形态）即就地写。
        "sed" => {
            if args
                .iter()
                .any(|arg| arg == "-i" || arg.starts_with("-i") || arg.starts_with("--in-place"))
            {
                CliClass::Write
            } else {
                CliClass::ReadOnly
            }
        }
        "git" => classify_git(args),
        other if READ_ONLY_COMMANDS.contains(&other) => CliClass::ReadOnly,
        // 未知命令：保守归写（错误方向是多问一次，不是误放行）。
        _ => CliClass::Write,
    }
}

/// 命令名的查表形态：取末段（`/bin/rm` → `rm`）并小写。
fn command_basename(command: &str) -> String {
    Path::new(command)
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 危险黑名单命中（design §3.3）。
fn is_dangerous(name: &str, args: &[String]) -> bool {
    if DANGEROUS_WRAPPERS.contains(&name) || DANGEROUS_COMMANDS.contains(&name) {
        return true;
    }
    // mkfs 系（mkfs / mkfs.ext4 / …）按前缀判。
    if name == "mkfs" || name.starts_with("mkfs.") {
        return true;
    }
    if DANGEROUS_DISK.contains(&name) {
        return true;
    }
    // diskutil 只在破坏形态（erase* / *Partition*）入黑名单；其余形态（list / info）落
    // 「未知 ⇒ 写」，仍要过闸。
    if name == "diskutil" {
        return args.iter().any(|arg| {
            let lower = arg.to_lowercase();
            lower.contains("erase") || lower.contains("partition")
        });
    }
    if name == "git" {
        return match git_subcommand(args).as_deref() {
            Some("clean") => true,
            Some("reset") => args.iter().any(|arg| arg == "--hard"),
            _ => false,
        };
    }
    false
}

// ---------------------------------------------------------------------------
// 间接调用包装器递归（backlog 2026-10-10 Alex 裁决「堵」）
// ---------------------------------------------------------------------------

/// sudo 的取值 flag：flag 单独成参数时吞掉下一个参数，`-uVALUE` 粘连形态吞自己。
const SUDO_VALUE_FLAGS: [&str; 9] = ["-u", "-g", "-h", "-p", "-C", "-T", "-D", "-r", "-t"];

/// xargs 的取值 flag（BSD/GNU 共有集）：同上两种形态。
const XARGS_VALUE_FLAGS: [&str; 11] = [
    "-I", "-J", "-L", "-n", "-d", "-D", "-E", "-P", "-R", "-S", "-s",
];

/// 包装器名单内的命令：把被包装命令取出来递归分类。返回 None = 不是包装器（走正常路径）；
/// Some(class) = 整条调用的分类（被包装命令的分类，取不出时保守归危险——「任何档都问」的
/// 唯一表达，full_access 也放不过）。递归只在名单内展开，不做通用 shell 语义解析。
fn classify_wrapped(name: &str, args: &[String]) -> Option<CliClass> {
    match name {
        "sudo" => Some(match extract_wrapped_command(args, &SUDO_VALUE_FLAGS) {
            Some(argv) => classify_cli(&argv),
            // 取不出被包装命令（裸 sudo / 只有 flag）：保守归危险，不问形态不漏拦。
            None => CliClass::Dangerous,
        }),
        "xargs" => Some(match extract_wrapped_command(args, &XARGS_VALUE_FLAGS) {
            Some(argv) => classify_cli(&argv),
            None => CliClass::Dangerous,
        }),
        // find 只在带 -exec / -execdir / -ok / -okdir 时进递归；否则走既有分支。
        "find" => classify_find_exec(args),
        _ => None,
    }
}

/// 从包装器参数里取被包装 argv：`--` 截断 flag 段；flag 跳过（取值 flag 吞掉下一个参数，
/// `-uVALUE` 粘连形态吞自己）；第一个非 flag token 是被包装命令，其后全部原样作为它的参数。
///
/// 收紧口径（M413 r1 P2-1）：取值 flag 表是**乐观名单**——拿不准的「带值形态」若照常跳过，
/// 值会被误当命令名（`sudo --user root rm` 的 `root`、`xargs --max-args 1 rm` 的 `1`），
/// 落「未知 ⇒ 写」被 full_access 放行（取错比取不出更糟）。故两类一律视为**取不出**（返回
/// None → 保守归危险，宁多问）：未识别的 `--xxx` 长选项（表内全是短 flag，长选项带不带值
/// 静态不可分）、`KEY=value` 环境赋值形态（sudo 支持、xargs 不支持，包装器间语义不同）。
fn extract_wrapped_command(args: &[String], value_flags: &[&str]) -> Option<Vec<String>> {
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--" {
            index += 1;
            break;
        }
        // 未识别的长选项：保守取不出（见上方 doc）。`--` 已在上支处理。
        if arg.starts_with("--") {
            return None;
        }
        // `-` 单独成参数不是 flag（虽然 edge，按命令 token 处理）；非 flag token 里
        // 的 KEY=value 环境赋值形态同样取不出（sudo 认、xargs 不认，包装器间语义不同）。
        if !arg.starts_with('-') || arg == "-" {
            if looks_like_env_assignment(arg) {
                return None;
            }
            break;
        }
        if looks_like_env_assignment(arg) {
            return None;
        }
        let takes_value = value_flags.contains(&arg.as_str())
            || value_flags
                .iter()
                .any(|flag| arg.starts_with(flag) && arg.len() > flag.len());
        index += if takes_value && value_flags.contains(&arg.as_str()) {
            2
        } else {
            1
        };
    }
    (index < args.len()).then(|| args[index..].to_vec())
}

/// `KEY=value` 环境赋值形态：`FOO=bar` 是（sudo 认），`-x=y` / `=x` / `9LIVES=x` 不是。
fn looks_like_env_assignment(arg: &str) -> bool {
    let Some(key) = arg.split_once('=').map(|(key, _)| key) else {
        return false;
    };
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// find 的 `-exec` / `-execdir` / `-ok` / `-okdir` 子句：命令是该 flag 的下一 token，参数到
/// `;` / `\;` / `+` 终止符为止；整条 find 的分类 = 各子句分类的保守合并（危险 > 写 > 只读）。
/// 子句取不完整（flag 后没有命令、没有终止符）保守归危险。无 exec 系 flag 返回 None
/// （走既有分支：`-delete` 归写、纯查找到只读）。
fn classify_find_exec(args: &[String]) -> Option<CliClass> {
    const EXEC_FLAGS: [&str; 4] = ["-exec", "-execdir", "-ok", "-okdir"];
    if !args.iter().any(|arg| EXEC_FLAGS.contains(&arg.as_str())) {
        return None;
    }
    let mut overall = CliClass::ReadOnly;
    let mut incomplete = false;
    let mut index = 0;
    while index < args.len() {
        if !EXEC_FLAGS.contains(&args[index].as_str()) {
            index += 1;
            continue;
        }
        let Some(command) = args.get(index + 1) else {
            incomplete = true;
            break;
        };
        let mut end = index + 2;
        while end < args.len() && !is_exec_terminator(&args[end]) {
            end += 1;
        }
        if end >= args.len() {
            // 没有终止符：find 语法非法，保守归危险。
            incomplete = true;
            break;
        }
        let mut argv = vec![command.clone()];
        argv.extend(args[index + 2..end].iter().cloned());
        overall = max_class(overall, classify_cli(&argv));
        index = end + 1;
    }
    // exec 子句之外的写形态折进 overall：`-delete` 直接删文件，`-fprint` / `-fprintf` 把输出
    // 写进文件。master 上这些形态仅经「-exec 存在 ⇒ 写」兜底；递归后若只看护 exec 子句，它们
    // 会被吞（`find . -exec ls {} \; -delete` 曾因此归 ReadOnly，在 read_only 档静默放行——
    // M413 r1 P1-1 回归，修复即本段）。
    if args
        .iter()
        .any(|arg| matches!(arg.as_str(), "-delete" | "-fprint" | "-fprintf"))
    {
        overall = max_class(overall, CliClass::Write);
    }
    if incomplete {
        return Some(CliClass::Dangerous);
    }
    Some(overall)
}

/// find -exec 子句的终止符：argv 直传下 `;` 与 `\;` 两种形态都可能出现（`+` 是批量形态）。
fn is_exec_terminator(arg: &str) -> bool {
    arg == ";" || arg == "\\;" || arg == "+"
}

/// 保守合并：危险 > 写 > 只读。
fn max_class(a: CliClass, b: CliClass) -> CliClass {
    use CliClass::*;
    match (a, b) {
        (Dangerous, _) | (_, Dangerous) => Dangerous,
        (Write, _) | (_, Write) => Write,
        _ => ReadOnly,
    }
}

/// git 子命令（跳过全局 flag 后的第一个非 flag 参数）。
fn git_subcommand(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| !arg.starts_with('-'))
        .map(|arg| arg.to_lowercase())
}

/// git 白名单（design §3.1）：只读子命令族；`branch` / `tag` 仅列表形态、`stash list`、
/// `remote -v`；其余子命令（`add` `commit` `push` `checkout` `reset` `clean` …）→ 写。
fn classify_git(args: &[String]) -> CliClass {
    // `git --version` 无子命令，是纯读形态（单列一条，不与「裸 git」混判）。
    if args.iter().any(|arg| arg == "--version") {
        return CliClass::ReadOnly;
    }
    let Some(index) = args.iter().position(|arg| !arg.starts_with('-')) else {
        // 裸 `git`（无子命令）：拿不准就写（保守默认）。
        return CliClass::Write;
    };
    let sub = args[index].to_lowercase();
    let rest = &args[index + 1..];
    match sub.as_str() {
        "status" | "diff" | "log" | "show" | "ls-files" | "rev-parse" | "blame" | "describe"
        | "shortlog" => CliClass::ReadOnly,
        "branch" => {
            if rest
                .iter()
                .all(|arg| GIT_BRANCH_LIST_FLAGS.contains(&arg.as_str()))
            {
                CliClass::ReadOnly
            } else {
                CliClass::Write
            }
        }
        "tag" => {
            if rest
                .iter()
                .all(|arg| GIT_TAG_LIST_FLAGS.contains(&arg.as_str()) || arg.starts_with("--sort="))
            {
                CliClass::ReadOnly
            } else {
                CliClass::Write
            }
        }
        "stash" => {
            if rest.first().map(String::as_str) == Some("list") {
                CliClass::ReadOnly
            } else {
                CliClass::Write
            }
        }
        "remote" => {
            if !rest.is_empty()
                && rest
                    .iter()
                    .all(|arg| matches!(arg.as_str(), "-v" | "--verbose"))
            {
                CliClass::ReadOnly
            } else {
                CliClass::Write
            }
        }
        _ => CliClass::Write,
    }
}

/// `git branch` 的纯列表 flag；出现其余参数（名字 / `-d` / `-m` / `-c` …）即写形态。
const GIT_BRANCH_LIST_FLAGS: [&str; 14] = [
    "-a",
    "--all",
    "-r",
    "--remotes",
    "-l",
    "--list",
    "-v",
    "-vv",
    "--verbose",
    "--show-current",
    "-i",
    "--ignore-case",
    "--merged",
    "--no-merged",
];

/// `git tag` 的纯列表 flag；出现其余参数（tag 名 / `-d` / `-a` / `-m` …）即写形态。
/// `--sort=<key>` 与 `--contains=<rev>` 形态按前缀另判（见 [`classify_git`]）。
const GIT_TAG_LIST_FLAGS: [&str; 9] = [
    "-l",
    "--list",
    "-n",
    "--ignore-case",
    "-i",
    "--contains",
    "--no-contains",
    "--points-at",
    "--merged",
];

// ---------------------------------------------------------------------------
// vault 内写重定向（design §4）
// ---------------------------------------------------------------------------

/// 重定向错误码（design §4.2，常量唯一真源）。
pub const REDIRECT_ERROR_CODE: &str = "cli_redirected_to_vault_tool";
/// 载荷固定标记（DeepSeek 式；模型按标记文本识别并改道，design §4.2）。
pub const REDIRECT_MARKER_OPEN: &str = "<<<LUMIR_REDIRECT_VAULT_TOOL>>>";
pub const REDIRECT_MARKER_CLOSE: &str = "<<<END_LUMIR_REDIRECT_VAULT_TOOL>>>";

/// 一次重定向的载荷：写目标（vault 相对路径）+ 建议工具（给不出明确对应则缺省）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redirect {
    pub targets: Vec<String>,
    pub suggested_tool: Option<&'static str>,
}

impl Redirect {
    /// 载荷 JSON（字段序固定 `reason` / `targets` / `suggested_tool`——单测逐字节钉死，
    /// 手写拼装而不是走 serde_json 的 map，避免 map 实现变化改掉字节序）。
    pub fn payload(&self) -> String {
        let targets = self
            .targets
            .iter()
            .map(|target| serde_json::to_string(target).unwrap_or_else(|_| format!("\"{target}\"")))
            .collect::<Vec<_>>()
            .join(",");
        let mut payload = format!("{{\"reason\":\"write_target_in_vault\",\"targets\":[{targets}]");
        if let Some(tool) = self.suggested_tool {
            payload.push_str(&format!(",\"suggested_tool\":\"{tool}\""));
        }
        payload.push('}');
        payload
    }

    /// 回送模型的人话说明 + 固定标记包裹的结构化载荷（design §4.2）。
    pub fn message(&self) -> String {
        let suggested = match self.suggested_tool {
            Some(tool) => format!("建议改用 {tool}。"),
            None => String::new(),
        };
        format!(
            "写目标在 vault 内（{}），已被闸门改道：请改用 vault 工具完成 vault 内写操作，\
             不要经 cli_run 写 vault。可用工具：vault_patch（局部替换）/ vault_create（新建，\
             自动建父目录）/ vault_move（移动 / 重命名）/ vault_delete（删除）。{suggested}\n\
             {REDIRECT_MARKER_OPEN}\n{}\n{REDIRECT_MARKER_CLOSE}",
            self.targets.join("、"),
            self.payload()
        )
    }
}

/// 分类为写的 cli_run → 判定写目标是否进 vault（design §4.1）。有进 vault 的目标才重定向；
/// 判定不确定时返回 `None`（落回正常写分类）——**宁漏勿错**。
fn redirect_for(root: &Path, argv: &[String]) -> Option<Redirect> {
    let targets: Vec<String> = write_targets(argv)
        .into_iter()
        .filter_map(|target| vault_relative(root, &target))
        .collect();
    if targets.is_empty() {
        return None;
    }
    Some(Redirect {
        targets,
        suggested_tool: suggested_tool(argv),
    })
}

/// 写目标提取（design §4.1，按命令族的参数形态取「被写的一侧」）。
fn write_targets(argv: &[String]) -> Vec<String> {
    let Some(command) = argv.first() else {
        return Vec::new();
    };
    let name = command_basename(command);
    let args = &argv[1..];
    let mut targets: Vec<String> = Vec::new();
    match name.as_str() {
        // cp / mv / ln：全部路径参数（源在 vault 内同样是 vault 资产）。
        "cp" | "mv" | "ln" => targets.extend(non_flag_args(args)),
        // sed 仅就地形态（带 -i）才写；**非 flag 参数里的第一个是脚本**（`s/a/b/`），
        // 被写的是其后的文件参数。
        "sed" => {
            if args
                .iter()
                .any(|arg| arg == "-i" || arg.starts_with("-i") || arg.starts_with("--in-place"))
            {
                let mut rest = non_flag_args(args);
                rest.next();
                targets.extend(rest);
            }
        }
        "tee" | "truncate" | "touch" | "mkdir" => targets.extend(non_flag_args(args)),
        // dd 的写侧是 of= 值（if= 是读侧，不入写目标）。
        "dd" => targets.extend(
            args.iter()
                .filter_map(|arg| arg.strip_prefix("of="))
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        ),
        // curl -o / --output（含 --output=path 形态）；wget -O / --output-document。
        "curl" => targets.extend(option_values(args, &["-o", "--output"])),
        "wget" => targets.extend(option_values(args, &["-O", "--output-document"])),
        _ => {}
    }
    // 字面重定向 token（`>` / `>>`）：argv 直传下它们是普通参数，但形态上就是写目标。
    targets.extend(redirect_targets(args));
    targets
}

/// 非 flag 参数（不以 `-` 起首）。
fn non_flag_args(args: &[String]) -> impl Iterator<Item = String> + '_ {
    args.iter()
        .filter(|arg| !arg.starts_with('-') && !arg.is_empty())
        .cloned()
}

/// `-o path` / `--output=path` 两种形态的取值。
fn option_values(args: &[String], flags: &[&str]) -> Vec<String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if flags.contains(&arg.as_str()) {
            if let Some(value) = args.get(index + 1).filter(|value| !value.starts_with('-')) {
                values.push(value.clone());
            }
            index += 2;
            continue;
        }
        if let Some((flag, value)) = arg.split_once('=') {
            if flags.contains(&flag) && !value.is_empty() {
                values.push(value.to_string());
            }
        }
        index += 1;
    }
    values
}

/// 字面重定向 token 后的参数：`[">", "a.md"]` 与 `[">a.md"]` 两种形态都取。
fn redirect_targets(args: &[String]) -> Vec<String> {
    let mut targets = Vec::new();
    for (index, arg) in args.iter().enumerate() {
        if arg == ">" || arg == ">>" {
            if let Some(next) = args.get(index + 1) {
                targets.push(next.clone());
            }
        } else if let Some(rest) = arg.strip_prefix(">>").or_else(|| arg.strip_prefix('>')) {
            if !rest.is_empty() {
                targets.push(rest.to_string());
            }
        }
    }
    targets
}

/// 建议的 vault 工具（design §4.2 的映射，含 M405 修订的 mkdir→vault_create）。
fn suggested_tool(argv: &[String]) -> Option<&'static str> {
    let name = argv.first().map(|command| command_basename(command))?;
    match name.as_str() {
        "mv" | "cp" | "ln" => Some("vault_move"),
        "rm" | "rmdir" => Some("vault_delete"),
        "sed" | "tee" | "truncate" | "dd" | "curl" | "wget" => Some("vault_patch"),
        "touch" | "mkdir" => Some("vault_create"),
        _ => {
            let args = &argv[1..];
            if args
                .iter()
                .any(|arg| arg == ">" || arg == ">>" || arg.starts_with('>'))
            {
                Some("vault_patch")
            } else {
                None
            }
        }
    }
}

/// 单个写目标 → vault 相对路径（design §4.1 的 out-of-vault / in-vault 判定）。
///
/// - `..` 逃逸一律不重定向（词法阶段就拒）。
/// - 绝对路径：词法规范化后必须落在 vault 根之下（根的前缀比较走 canonicalize 后的根）。
/// - 相对路径：不以 `/` 起首、也不以 `..` 起首（上面已挡），且**存在性佐证**——目标已在 vault
///   内，或父目录在 vault 内存在。佐证是必要的：cli_run 进程的 cwd 是 app 进程工作目录、不是
///   vault 根（`tools.rs` 现行 spawn 不设 `current_dir`），没有佐证就会把 `build.sh` 这类显然
///   指向 vault 外的相对路径误伤。
fn vault_relative(root: &Path, target: &str) -> Option<String> {
    let target = target.trim();
    if target.is_empty() {
        return None;
    }
    let path = Path::new(target);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    let root_canon = root.canonicalize().ok()?;
    let normalized = normalize(path);
    if normalized.as_os_str().is_empty() {
        return None;
    }
    if path.is_absolute() {
        let rel = normalized.strip_prefix(&root_canon).ok()?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        return (!rel.is_empty()).then_some(rel);
    }
    let rel = normalized.to_string_lossy().replace('\\', "/");
    if rel.is_empty() {
        return None;
    }
    let absolute = root.join(&normalized);
    if std::fs::symlink_metadata(&absolute).is_ok() {
        // 存在（或悬空链接）：canonicalize 得出来就要求仍在 vault 内（符号链接逃逸挡在重定向前）。
        return match absolute.canonicalize() {
            Ok(canon) if !canon.starts_with(&root_canon) => None,
            _ => Some(rel),
        };
    }
    // 不存在：父目录在 vault 内存在 ⇒ 视为 vault 内新建目标（`mkdir` / `touch` 常见形态）。
    let parent = normalized.parent()?;
    if parent.as_os_str().is_empty() {
        return None;
    }
    let parent_abs = root.join(parent);
    let parent_canon = parent_abs.canonicalize().ok()?;
    if !parent_canon.starts_with(&root_canon) || !parent_canon.is_dir() {
        return None;
    }
    Some(rel)
}

/// 词法规范化：去掉 `.` 段与重复分隔符（**不**解析 `..`——它在判定入口就被拒）。
fn normalize(path: &Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                out.push(component.as_os_str())
            }
            Component::Normal(segment) => out.push(segment),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 规则表匹配（既有语义，未改）
// ---------------------------------------------------------------------------

/// 规则清单任一条命中即 true。
fn matches_rule(rules: &[String], tool: &str, subject: &str) -> bool {
    rules.iter().any(|rule| rule_matches(rule, tool, subject))
}

/// 单条规则匹配：tool 级等值，或 `tool(模式)` 的 subject 前缀 / 等值匹配。
fn rule_matches(rule: &str, tool: &str, subject: &str) -> bool {
    match parse_rule(rule) {
        ParsedRule::Tool(name) => canonical_tool(name) == tool,
        ParsedRule::Pattern {
            tool: name,
            pattern,
        } => {
            if canonical_tool(name) != tool {
                return false;
            }
            match pattern.strip_suffix('*') {
                Some(prefix) => subject.starts_with(prefix),
                None => subject == pattern,
            }
        }
        ParsedRule::Unparsable => false,
    }
}

/// 规则语法里的工具名 → 实际工具名。design §6 的规则示例用 `cli(demo *)` 这种
/// 写法——规则层的工具名是 `cli`，实际工具是 `cli_run`。只收这一个文档化别名，
/// 不发明一般性的前缀匹配（那会让 `vault` 意外命中 `vault_patch` 与 `vault_read`）。
fn canonical_tool(name: &str) -> &str {
    if name == "cli" {
        "cli_run"
    } else {
        name
    }
}

enum ParsedRule<'a> {
    Tool(&'a str),
    Pattern { tool: &'a str, pattern: &'a str },
    Unparsable,
}

/// 规则语法解析：`tool` 或 `tool(模式)`；括号须配对且模式非空，否则 Unparsable。
fn parse_rule(rule: &str) -> ParsedRule<'_> {
    let rule = rule.trim();
    if let Some(open) = rule.find('(') {
        if !rule.ends_with(')') || open == 0 {
            return ParsedRule::Unparsable;
        }
        let pattern = &rule[open + 1..rule.len() - 1];
        if pattern.trim().is_empty() {
            return ParsedRule::Unparsable;
        }
        ParsedRule::Pattern {
            tool: rule[..open].trim(),
            pattern,
        }
    } else if rule.is_empty() {
        ParsedRule::Unparsable
    } else {
        ParsedRule::Tool(rule)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn perms(allow: &[&str], deny: &[&str]) -> HarnessPermissions {
        HarnessPermissions {
            allow: allow.iter().map(|s| s.to_string()).collect(),
            deny: deny.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// 判定用的默认上下文：vault_write 档、cli argv 由调用点给、无缓存。
    fn judge(root: &Path, argv: Option<Vec<String>>) -> Judge<'_> {
        Judge {
            mode: PermissionMode::VaultWrite,
            root,
            argv,
            cached: false,
        }
    }

    fn argv(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// 独立测试 vault 根（重定向判定读真实文件系统上是否存在）。
    fn fixture_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lumir-harness-perms-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/a.md"), "x\n").unwrap();
        root
    }

    // -----------------------------------------------------------------------
    // 既有规则语义（回归：五层重构不得改动 deny > allow 的优先序与匹配语法）
    // -----------------------------------------------------------------------

    #[test]
    fn default_layering_is_vault_write() {
        let root = fixture_root("default");
        let p = HarnessPermissions::default();
        let j = judge(&root, None);
        assert_eq!(decide(&p, "vault_read", "a.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_search", "q", &j), Decision::Allow);
        assert_eq!(decide(&p, "skill_load", "demo-skill", &j), Decision::Allow);
        // 默认档 vault_write：vault 写工具免闸（相对旧默认的差分之一）。
        assert_eq!(decide(&p, "vault_patch", "a.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_create", "b.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_move", "a.md", &j), Decision::Allow);
        // vault_delete 逐个问（裁决点 1 落 B）。
        assert_eq!(decide(&p, "vault_delete", "a.md", &j), Decision::Ask);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deny_beats_allow_and_default() {
        let root = fixture_root("deny");
        let p = perms(&["cli(demo *)"], &["cli(demo *)"]);
        assert_eq!(
            decide(&p, "cli_run", "demo search x", &judge(&root, None)),
            Decision::Deny
        );
        // deny 命中即拒绝，即使默认分层是 allow 的工具
        let p = perms(&[], &["vault_read"]);
        assert_eq!(
            decide(&p, "vault_read", "a.md", &judge(&root, None)),
            Decision::Deny
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn allow_rule_skips_gate() {
        let root = fixture_root("allow");
        let p = perms(&["cli(demo *)"], &[]);
        let j = judge(&root, Some(argv(&["demo", "search", "x"])));
        assert_eq!(decide(&p, "cli_run", "demo search x", &j), Decision::Allow);
        let p = perms(&["vault_patch"], &[]);
        assert_eq!(
            decide(&p, "vault_patch", "a.md", &judge(&root, None)),
            Decision::Allow
        );
        // 黑名单成员不受 allow 规则影响（第 3 层在 allow 之前）。
        let p = perms(&["cli(rm *)"], &[]);
        let j = judge(&root, Some(argv(&["rm", "-rf", "/tmp/x"])));
        assert_eq!(decide(&p, "cli_run", "rm -rf /tmp/x", &j), Decision::Ask);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn pattern_prefix_star_matching() {
        let root = fixture_root("pattern");
        let p = perms(&["cli(ls *)"], &[]);
        let j = judge(&root, Some(argv(&["ls", "-la"])));
        assert_eq!(decide(&p, "cli_run", "ls -la", &j), Decision::Allow);
        let j = judge(&root, Some(argv(&["ls"])));
        assert_eq!(decide(&p, "cli_run", "ls", &j), Decision::Allow);
        let p = perms(&["cli(npm run *)"], &[]);
        let j = judge(&root, Some(argv(&["npm", "run", "test"])));
        assert_eq!(decide(&p, "cli_run", "npm run test", &j), Decision::Allow);
        // 未命中规则的 npm 形态：分类为写 ⇒ vault_write 档逐个问。
        let j = judge(&root, Some(argv(&["npm", "install"])));
        assert_eq!(decide(&p, "cli_run", "npm install", &j), Decision::Ask);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn tool_level_rule_blocks_all_subjects() {
        let root = fixture_root("tool-level");
        let p = perms(&[], &["cli_run"]);
        assert_eq!(
            decide(&p, "cli_run", "anything at all", &judge(&root, None)),
            Decision::Deny
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn unparsable_rules_never_match() {
        let root = fixture_root("unparsable");
        let p = perms(&["cli(", "()", "vault_read()"], &["(unbalanced"]);
        assert_eq!(
            decide(&p, "cli_run", "ls", &judge(&root, Some(argv(&["ls"])))),
            Decision::Allow
        );
        assert_eq!(
            decide(&p, "vault_read", "a.md", &judge(&root, None)),
            Decision::Allow
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn pattern_applies_to_path_subject_for_vault_tools() {
        let root = fixture_root("path-pattern");
        let p = perms(&["vault_patch(docs/*)"], &[]);
        let j = judge(&root, None);
        assert_eq!(decide(&p, "vault_patch", "docs/a.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_patch", "notes/a.md", &j), Decision::Allow);
        // 只读档下 deny 规则仍先于模式层（allow 规则同理，见 allow_rule_skips_gate）。
        let denied = perms(&[], &["vault_patch(docs/*)"]);
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, None)
        };
        assert_eq!(
            decide(&denied, "vault_patch", "docs/a.md", &j),
            Decision::Deny
        );
        std::fs::remove_dir_all(&root).ok();
    }

    // -----------------------------------------------------------------------
    // 三档语义表（design §2 逐格）
    // -----------------------------------------------------------------------

    #[test]
    fn read_only_mode_is_always_ask_for_writes() {
        let root = fixture_root("read-only");
        let p = HarnessPermissions::default();
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, None)
        };
        // 读类：三档一致放行。
        assert_eq!(decide(&p, "vault_read", "a.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_search", "q", &j), Decision::Allow);
        assert_eq!(decide(&p, "skill_load", "demo", &j), Decision::Allow);
        // 写工具：**Ask 而非 Deny**（Alex 2026-10-09 裁决：read_only = Always Ask，design §2 修订）。
        for tool in ["vault_patch", "vault_create", "vault_move", "vault_delete"] {
            assert_eq!(decide(&p, tool, "notes/a.md", &j), Decision::Ask, "{tool}");
        }
        // cli_run 只读白名单放行、写命令逐个问。
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, Some(argv(&["ls", "-la"])))
        };
        assert_eq!(decide(&p, "cli_run", "ls -la", &j), Decision::Allow);
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, Some(argv(&["cargo", "build"])))
        };
        assert_eq!(decide(&p, "cli_run", "cargo build", &j), Decision::Ask);
        // 只读档下没有「模式层 Deny」这条路径：无 deny 规则时任何调用面都不产出 Deny。
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, None)
        };
        for tool in ["vault_patch", "vault_create", "vault_move", "vault_delete"] {
            assert_ne!(decide(&p, tool, "notes/a.md", &j), Decision::Deny, "{tool}");
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn full_access_allows_writes_but_still_asks_dangerous() {
        let root = fixture_root("full-access");
        let p = HarnessPermissions::default();
        let j = Judge {
            mode: PermissionMode::FullAccess,
            ..judge(&root, None)
        };
        for tool in ["vault_patch", "vault_create", "vault_move", "vault_delete"] {
            assert_eq!(
                decide(&p, tool, "notes/a.md", &j),
                Decision::Allow,
                "{tool}"
            );
        }
        // 写命令自动放行（vault 外目标）。
        let j = Judge {
            mode: PermissionMode::FullAccess,
            ..judge(&root, Some(argv(&["npm", "install"])))
        };
        assert_eq!(decide(&p, "cli_run", "npm install", &j), Decision::Allow);
        // 危险黑名单任何档都问——含 full_access。
        for (cmd, argv_items) in [
            ("rm -rf /tmp/x", vec!["rm", "-rf", "/tmp/x"]),
            ("bash -c \"rm -rf /\"", vec!["bash", "-c", "rm -rf /"]),
            ("shutdown -h now", vec!["shutdown", "-h", "now"]),
        ] {
            let j = Judge {
                mode: PermissionMode::FullAccess,
                ..judge(&root, Some(argv(&argv_items)))
            };
            assert_eq!(decide(&p, "cli_run", cmd, &j), Decision::Ask, "{cmd}");
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn allow_rule_applies_in_read_only_mode_but_not_to_denied_tools() {
        let root = fixture_root("allow-readonly");
        // allow 规则在任何档生效（裁决点 5 落 A）——包括只读档的 cli_run 写命令。
        let p = perms(&["cli(npm run *)"], &[]);
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, Some(argv(&["npm", "run", "test"])))
        };
        assert_eq!(decide(&p, "cli_run", "npm run test", &j), Decision::Allow);
        std::fs::remove_dir_all(&root).ok();
    }

    // -----------------------------------------------------------------------
    // 分类器（design §3 三张表）
    // -----------------------------------------------------------------------

    #[test]
    fn read_only_whitelist_members() {
        for items in [
            vec!["ls", "-la"],
            vec!["cat", "a.md"],
            vec!["head", "-n", "5", "a.md"],
            vec!["tail", "-f", "a.md"],
            vec!["wc", "-l", "a.md"],
            vec!["file", "a.md"],
            vec!["stat", "a.md"],
            vec!["pwd"],
            vec!["which", "rg"],
            vec!["whereis", "sed"],
            vec!["echo", "hi"],
            vec!["printf", "%s", "hi"],
            vec!["date"],
            vec!["uname", "-a"],
            vec!["du", "-sh", "."],
            vec!["df", "-h"],
            vec!["rg", "needle"],
            vec!["grep", "-n", "needle", "a.md"],
            vec!["egrep", "x"],
            vec!["fgrep", "x"],
            vec!["tree", "-L", "2"],
            vec!["less", "a.md"],
            vec!["more", "a.md"],
            vec!["jq", ".x", "a.json"],
            vec!["xxd", "a.md"],
            vec!["od", "-c", "a.md"],
            vec!["hexdump", "a.md"],
            vec!["base64", "-d", "a.txt"],
            vec!["find", ".", "-name", "*.md"],
            vec!["sed", "s/a/b/", "a.md"],
            vec!["git", "status"],
            vec!["git", "diff", "HEAD"],
            vec!["git", "log", "--oneline"],
            vec!["git", "show", "HEAD"],
            vec!["git", "branch", "-a"],
            vec!["git", "tag", "-l"],
            vec!["git", "ls-files"],
            vec!["git", "rev-parse", "HEAD"],
            vec!["git", "blame", "a.md"],
            vec!["git", "describe", "--tags"],
            vec!["git", "shortlog", "-sn"],
            vec!["git", "stash", "list"],
            vec!["git", "remote", "-v"],
            vec!["git", "--version"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{argv:?}");
        }
    }

    #[test]
    fn conservative_downgrade_falls_to_write() {
        for items in [
            // 解释器 eval 形态
            vec!["python3", "-c", "print(1)"],
            vec!["python", "script.py"],
            vec!["node", "-e", "1"],
            vec!["ruby", "-e", "1"],
            vec!["perl", "-e", "1"],
            // 参数含 shell 元字符（argv 直传下是字面参数，仍保守按写）
            vec!["echo", "a; b"],
            vec!["cat", "a.md", "&&", "rm", "b"],
            vec!["ls", "|", "wc"],
            vec!["tee", "a.md", ">", "/dev/null"],
            // 已知写动词
            vec!["cp", "a.md", "b.md"],
            vec!["mv", "a.md", "b.md"],
            vec!["mkdir", "notes"],
            vec!["touch", "a.md"],
            vec!["cargo", "build"],
            vec!["git", "push"],
            vec!["git", "add", "."],
            vec!["git", "checkout", "master"],
            vec!["git", "branch", "new-branch"],
            vec!["git", "tag", "v1"],
            vec!["git", "stash", "push"],
            vec!["git", "remote"],
            vec!["sed", "-i", "s/a/b/", "a.md"],
            vec!["sed", "-i.bak", "s/a/b/", "a.md"],
            vec!["find", ".", "-name", "x", "-delete"],
            // 注意：`find . -exec rm {} ;` 自 M413 起归危险（被包装命令递归分类）——
            // 用例在 wrapper_recursion_classifies_wrapped_command，不再属于本条。
            // 未知命令（保守默认）
            vec!["definitely-not-a-real-cmd-xyz"],
            vec!["awk", "{print}"],
            vec![],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
    }

    #[test]
    fn dangerous_blacklist_hits_all_wrapper_forms() {
        for items in [
            vec!["rm", "-rf", "/"],
            vec!["rm", "notes/a.md"],
            vec!["/bin/rm", "-rf", "x"],
            vec!["bash", "-c", "rm -rf /"],
            vec!["sh", "-c", "echo hi"],
            vec!["zsh"],
            vec!["dash"],
            vec!["fish"],
            vec!["csh"],
            vec!["ksh"],
            vec!["cmd"],
            vec!["powershell"],
            vec!["pwsh"],
            vec!["osascript", "-e", "1"],
            vec!["eval", "x"],
            vec!["exec", "x"],
            vec!["shutdown", "-h", "now"],
            vec!["reboot"],
            vec!["halt"],
            vec!["poweroff"],
            vec!["mkfs"],
            vec!["mkfs.ext4", "/dev/disk2"],
            vec!["fdisk", "-l"],
            vec!["parted", "-l"],
            vec!["diskutil", "eraseDisk"],
            vec!["diskutil", "partitionDisk"],
            vec!["dd", "if=/dev/zero", "of=/tmp/x"],
            vec!["git", "reset", "--hard"],
            vec!["git", "clean", "-fd"],
            // 交集侧赢：白名单形态 + 危险参数（"BASH" 在大小写不敏感文件系统上解析到 bash）
            vec!["BASH", "-c", "x"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
        // `git reset`（非 --hard）/ `git clean` 的区分：前者不是黑名单成员。
        let soft_reset = argv(&["git", "reset", "--soft", "HEAD~1"]);
        assert_eq!(classify_cli(&soft_reset), CliClass::Write);
        // diskutil 的非破坏形态落「未知 ⇒ 写」（仍过闸，不在黑名单）。
        let diskutil_list = argv(&["diskutil", "list"]);
        assert_eq!(classify_cli(&diskutil_list), CliClass::Write);
    }

    /// 反向验证（REVIEW.md 第 1 条）：把一条白名单形态的期望改坏，分类结果必须不同——
    /// 确认断言有区分度（`git branch` 列表形态 vs 写形态、`sed` 有无 -i）。
    #[test]
    fn classification_assertions_have_discrimination() {
        assert_ne!(
            classify_cli(&argv(&["git", "branch", "-a"])),
            CliClass::Write,
            "列表形态必须与写形态可分"
        );
        assert_eq!(
            classify_cli(&argv(&["git", "branch", "-D", "x"])),
            CliClass::Write
        );
        assert_ne!(
            classify_cli(&argv(&["sed", "s/a/b/", "a.md"])),
            classify_cli(&argv(&["sed", "-i", "s/a/b/", "a.md"]))
        );
        assert_ne!(
            classify_cli(&argv(&["find", ".", "-name", "x"])),
            classify_cli(&argv(&["find", ".", "-name", "x", "-delete"]))
        );
    }

    // -----------------------------------------------------------------------
    // 重定向（design §4）
    // -----------------------------------------------------------------------

    #[test]
    fn write_target_extraction_per_command_family() {
        assert_eq!(
            write_targets(&argv(&["cp", "a.md", "notes/b.md"])),
            vec!["a.md", "notes/b.md"]
        );
        assert_eq!(
            write_targets(&argv(&["mv", "-f", "a.md", "notes/b.md"])),
            vec!["a.md", "notes/b.md"]
        );
        assert_eq!(
            write_targets(&argv(&["ln", "a.md", "b.md"])),
            vec!["a.md", "b.md"]
        );
        assert_eq!(
            write_targets(&argv(&["sed", "s/a/b/", "x.md"])),
            Vec::<String>::new()
        );
        assert_eq!(
            write_targets(&argv(&["sed", "-i", "s/a/b/", "x.md"])),
            vec!["x.md"]
        );
        assert_eq!(write_targets(&argv(&["tee", "a.md"])), vec!["a.md"]);
        assert_eq!(write_targets(&argv(&["touch", "a.md"])), vec!["a.md"]);
        assert_eq!(
            write_targets(&argv(&["mkdir", "-p", "notes/x"])),
            vec!["notes/x"]
        );
        assert_eq!(
            write_targets(&argv(&["dd", "if=/dev/zero", "of=notes/a.bin"])),
            vec!["notes/a.bin"]
        );
        assert_eq!(
            write_targets(&argv(&["curl", "-o", "notes/a.md", "https://x"])),
            vec!["notes/a.md"]
        );
        assert_eq!(
            write_targets(&argv(&["curl", "--output=notes/a.md", "https://x"])),
            vec!["notes/a.md"]
        );
        assert_eq!(
            write_targets(&argv(&["wget", "-O", "notes/a.md", "https://x"])),
            vec!["notes/a.md"]
        );
        assert_eq!(
            write_targets(&argv(&["echo", "hi", ">", "notes/a.md"])),
            vec!["notes/a.md"]
        );
        assert_eq!(
            write_targets(&argv(&["echo", "hi", ">>notes/a.md"])),
            vec!["notes/a.md"]
        );
    }

    #[test]
    fn redirect_fires_for_vault_targets_only() {
        let root = fixture_root("redirect");
        let p = HarnessPermissions::default();
        // 既有 vault 内文件 + 写形态 ⇒ 重定向（vault_write 档，写命令本来会 ask）。
        let cli = argv(&["mv", "notes/a.md", "notes/b.md"]);
        let decision = decide(
            &p,
            "cli_run",
            "mv notes/a.md notes/b.md",
            &judge(&root, Some(cli.clone())),
        );
        match decision {
            Decision::Redirect(redirect) => {
                assert_eq!(redirect.targets, vec!["notes/a.md", "notes/b.md"]);
                assert_eq!(redirect.suggested_tool, Some("vault_move"));
            }
            other => panic!("应重定向，得到 {other:?}"),
        }
        // vault 外目标（绝对路径）⇒ 不重定向，落正常写分类 ⇒ vault_write 档逐个问。
        let cli = argv(&["tee", "/tmp/lumir-outside.md"]);
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tee /tmp/lumir-outside.md",
                &judge(&root, Some(cli.clone()))
            ),
            Decision::Ask
        );
        // 相对路径、vault 内不存在、父目录也不存在 ⇒ 判定不确定不重定向（宁漏勿错）。
        let cli = argv(&["touch", "build.sh"]);
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "touch build.sh",
                &judge(&root, Some(cli.clone()))
            ),
            Decision::Ask
        );
        // 相对路径指向 vault 内已存在目录下的新文件 ⇒ 重定向（父目录存在性佐证）。
        let cli = argv(&["touch", "notes/new.md"]);
        match decide(
            &p,
            "cli_run",
            "touch notes/new.md",
            &judge(&root, Some(cli.clone())),
        ) {
            Decision::Redirect(redirect) => {
                assert_eq!(redirect.targets, vec!["notes/new.md"]);
                assert_eq!(redirect.suggested_tool, Some("vault_create"));
            }
            other => panic!("应重定向，得到 {other:?}"),
        }
        // `..` 逃逸的**目标**不进载荷，但同一 argv 里的 vault 内**源**照旧触发重定向
        // （design §4.1：cp/mv/ln 的源与目标都提取——源在 vault 内同样是 vault 资产）。
        let cli = argv(&["cp", "notes/a.md", "../escape.md"]);
        match decide(
            &p,
            "cli_run",
            "cp notes/a.md ../escape.md",
            &judge(&root, Some(cli.clone())),
        ) {
            Decision::Redirect(redirect) => {
                assert_eq!(redirect.targets, vec!["notes/a.md"], "逃逸目标被丢弃");
            }
            other => panic!("源在 vault 内 ⇒ 应重定向，得到 {other:?}"),
        }
        // 整条 argv 的写目标都不在 vault 内（`..` 逃逸）⇒ 不重定向，落正常写分类逐个问。
        let cli = argv(&["tee", "../escape.md"]);
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tee ../escape.md",
                &judge(&root, Some(cli.clone()))
            ),
            Decision::Ask
        );
        // 危险命令不进重定向（第 3 层 Ask）。
        let cli = argv(&["rm", "notes/a.md"]);
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "rm notes/a.md",
                &judge(&root, Some(cli.clone()))
            ),
            Decision::Ask
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// 重定向在**任何档**都成立（裁决点 6 落 A）——full_access 也不例外；且用户 allow 规则
    /// 绕不过它（第 2 层在 allow 之前）。
    #[test]
    fn redirect_is_absolute_across_modes_and_allow_rules() {
        let root = fixture_root("redirect-absolute");
        let p = perms(&["cli(mv *)"], &[]);
        let cli = argv(&["mv", "notes/a.md", "notes/b.md"]);
        for mode in [
            PermissionMode::ReadOnly,
            PermissionMode::VaultWrite,
            PermissionMode::FullAccess,
        ] {
            let j = Judge {
                mode,
                ..judge(&root, Some(cli.clone()))
            };
            assert!(
                matches!(
                    decide(&p, "cli_run", "mv notes/a.md notes/b.md", &j),
                    Decision::Redirect(_)
                ),
                "{mode:?}"
            );
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// 载荷与说明逐字节钉死（含固定标记）；并做一次反向验证——改一个字符断言必红
    /// （REVIEW.md 第 1 条：先造一个必须 FAIL 的输入）。
    #[test]
    fn redirect_payload_and_message_are_byte_exact() {
        let redirect = Redirect {
            targets: vec!["notes/a.md".to_string()],
            suggested_tool: Some("vault_move"),
        };
        assert_eq!(
            redirect.payload(),
            r#"{"reason":"write_target_in_vault","targets":["notes/a.md"],"suggested_tool":"vault_move"}"#
        );
        // 给不出建议工具时缺省该键（design §4.2）。
        let no_hint = Redirect {
            targets: vec!["notes/a.md".to_string()],
            suggested_tool: None,
        };
        assert_eq!(
            no_hint.payload(),
            r#"{"reason":"write_target_in_vault","targets":["notes/a.md"]}"#
        );
        // JSON 转义：目标串里的引号必须转义，不许拼出坏 JSON。
        let escaped = Redirect {
            targets: vec!["no\"tes/a.md".to_string()],
            suggested_tool: None,
        };
        assert_eq!(
            escaped.payload(),
            r#"{"reason":"write_target_in_vault","targets":["no\"tes/a.md"]}"#
        );
        let message = redirect.message();
        assert!(message.contains(REDIRECT_MARKER_OPEN), "{message}");
        assert!(message.contains(REDIRECT_MARKER_CLOSE), "{message}");
        assert!(
            message.contains("写目标在 vault 内（notes/a.md）"),
            "{message}"
        );
        assert!(message.contains("建议改用 vault_move"), "{message}");
        assert!(message.contains(&redirect.payload()), "{message}");
        assert_eq!(REDIRECT_ERROR_CODE, "cli_redirected_to_vault_tool");

        // 反向验证：把期望的标记串改一个字符，比对必须失败。
        let mutated = message.replace(REDIRECT_MARKER_OPEN, "<<<LUMIR_REDIRECT_VAULT_TOOOOL>>>");
        assert!(
            !mutated.contains(REDIRECT_MARKER_OPEN),
            "反向验证输入必须真的不同"
        );
        let mutated = redirect
            .payload()
            .replace("\"vault_move\"", "\"vault_movex\"");
        assert_ne!(mutated, redirect.payload());
    }

    #[test]
    fn redirect_suggested_tool_mapping() {
        assert_eq!(suggested_tool(&argv(&["mv", "a", "b"])), Some("vault_move"));
        assert_eq!(suggested_tool(&argv(&["cp", "a", "b"])), Some("vault_move"));
        assert_eq!(suggested_tool(&argv(&["rm", "a"])), Some("vault_delete"));
        assert_eq!(suggested_tool(&argv(&["rmdir", "a"])), Some("vault_delete"));
        assert_eq!(
            suggested_tool(&argv(&["sed", "-i", "s/a/b/", "a.md"])),
            Some("vault_patch")
        );
        assert_eq!(
            suggested_tool(&argv(&["touch", "notes/a.md"])),
            Some("vault_create")
        );
        // mkdir 重定向到 vault_create（M405 修订：vault_create 自动建父目录，不再有 mkdir 缺口）。
        assert_eq!(
            suggested_tool(&argv(&["mkdir", "notes/x"])),
            Some("vault_create")
        );
        assert_eq!(suggested_tool(&argv(&["tee", "a.md"])), Some("vault_patch"));
        assert_eq!(
            suggested_tool(&argv(&["echo", "x", ">", "a.md"])),
            Some("vault_patch")
        );
        assert_eq!(suggested_tool(&argv(&["cargo", "build"])), None);
    }

    // -----------------------------------------------------------------------
    // 间接调用包装器递归（backlog 2026-10-10 Alex 裁决「堵」：sudo / xargs / find -exec
    // 在 full_access 档不得绕过危险黑名单）
    // -----------------------------------------------------------------------

    #[test]
    fn wrapper_recursion_classifies_wrapped_command() {
        // 被包装命令是黑名单成员 ⇒ 整条 Dangerous（full_access 也问）。
        for items in [
            vec!["sudo", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "-u", "root", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "-uroot", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "--", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "bash", "-c", "rm -rf /"],
            // 外层参数带 shell 元字符：包装器递归先于元字符检查，仍按被包装命令判危险。
            vec!["sudo", "bash", "-c", "rm a; rm b"],
            vec!["xargs", "rm"],
            vec!["xargs", "-0", "-n", "1", "rm"],
            vec!["xargs", "-I{}", "rm", "{}"],
            vec!["find", ".", "-exec", "rm", "{}", ";"],
            vec!["find", ".", "-name", "x", "-exec", "rm", "{}", "\\;"],
            vec!["find", ".", "-execdir", "rm", "{}", "+"],
            vec!["find", ".", "-ok", "rm", "{}", ";"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
        // 被包装命令是写动词 ⇒ 整条 Write（模式默认分层，full_access 放行——黑名单只管黑名单）。
        for items in [
            vec!["sudo", "make"],
            vec!["xargs", "npm", "install"],
            vec!["find", ".", "-exec", "sed", "-i", "s/a/b/", "{}", ";"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
        // 被包装命令是只读白名单 ⇒ 整条 ReadOnly（sudo ls 不误伤）。
        for items in [
            vec!["sudo", "ls", "-la"],
            vec!["sudo", "-u", "deploy", "ls"],
            vec!["xargs", "ls"],
            vec!["xargs", "-I{}", "cat", "{}"],
            vec!["find", ".", "-exec", "ls", "{}", ";"],
            vec!["find", ".", "-name", "*.md"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{argv:?}");
        }
        // 取不出确定形态 ⇒ 保守归危险（宁多问勿漏拦）。
        for items in [
            vec!["sudo"],
            vec!["sudo", "-l"],
            vec!["xargs"],
            vec!["xargs", "-0"],
            vec!["find", ".", "-exec"],
            vec!["find", ".", "-exec", "rm", "{}"],
            // 收紧口径（r1 P2-1）：乐观 flag 表拿不准的「带值形态」取错比取不出更糟——
            // 未识别长选项 / 环境赋值一律视为取不出，值不得被误当命令名。
            vec!["sudo", "--user", "root", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "--user=root", "rm", "-rf", "/tmp/x"],
            vec!["sudo", "FOO=bar", "rm", "-rf", "/tmp/x"],
            vec!["xargs", "--max-args", "1", "rm"],
            vec!["xargs", "--verbose", "ls"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
        // find 既有形态不受影响：-delete 归写、纯查找归只读。
        assert_eq!(
            classify_cli(&argv(&["find", ".", "-name", "x", "-delete"])),
            CliClass::Write
        );
        // r1 P1-1 回归反例：exec 子句之外的写形态不得被递归吞掉——
        // `find . -exec ls {} \; -delete` 必须仍归写（read_only 档逐个问，不静默放行）；
        // `-fprint` / `-fprintf` 同族（输出写文件）一并折进。
        assert_eq!(
            classify_cli(&argv(&["find", ".", "-exec", "ls", "{}", "\\;", "-delete"])),
            CliClass::Write
        );
        assert_eq!(
            classify_cli(&argv(&[
                "find", ".", "-exec", "ls", "{}", ";", "-fprint", "out.txt"
            ])),
            CliClass::Write
        );
        assert_eq!(
            classify_cli(&argv(&[
                "find", ".", "-exec", "ls", "{}", ";", "-fprintf", "%s", "out.txt"
            ])),
            CliClass::Write
        );
        // 反向区分（REVIEW.md 第 1 条）：修复前 `find . -exec ls {} \; -delete` 归 ReadOnly，
        // 本断言对修复前代码必红。
        assert_ne!(
            classify_cli(&argv(&["find", ".", "-exec", "ls", "{}", "\\;", "-delete"])),
            CliClass::ReadOnly
        );
        // 短 flag 取值路径不被收紧误伤：`sudo -u root ls` 照旧只读。
        assert_eq!(
            classify_cli(&argv(&["sudo", "-u", "root", "ls"])),
            CliClass::ReadOnly
        );
        // 区分度自证（REVIEW.md 第 1 条）：旧实现（sudo/xargs 落「未知 ⇒ 写」）在本表上
        // 第一组全部判 Write 而非 Dangerous——本断言对旧实现必红。
        assert_ne!(
            classify_cli(&argv(&["sudo", "rm", "-rf", "/tmp/x"])),
            CliClass::Write
        );
    }

    /// 裁决判据落在判定管线：sudo rm 在 full_access 档仍 Ask；sudo ls 不误伤（任何档放行）；
    /// allow 规则与批准缓存都绕不过黑名单递归层（第 3 层在 allow / 缓存之前）。
    #[test]
    fn wrapper_recursion_holds_across_modes_rules_and_cache() {
        let root = fixture_root("wrapper-pipeline");
        let p = HarnessPermissions::default();
        let cli = argv(&["sudo", "rm", "-rf", "/tmp/x"]);
        for mode in [
            PermissionMode::ReadOnly,
            PermissionMode::VaultWrite,
            PermissionMode::FullAccess,
        ] {
            let j = Judge {
                mode,
                ..judge(&root, Some(cli.clone()))
            };
            assert_eq!(
                decide(&p, "cli_run", "sudo rm -rf /tmp/x", &j),
                Decision::Ask,
                "{mode:?}"
            );
        }
        // sudo ls：full_access 与默认档都放行（ReadOnly 分类）。
        let cli = argv(&["sudo", "ls", "-la"]);
        for mode in [PermissionMode::VaultWrite, PermissionMode::FullAccess] {
            let j = Judge {
                mode,
                ..judge(&root, Some(cli.clone()))
            };
            assert_eq!(
                decide(&p, "cli_run", "sudo ls -la", &j),
                Decision::Allow,
                "{mode:?}"
            );
        }
        // allow 规则（cli(sudo *)）+ full_access + 缓存命中：sudo rm 仍 Ask。
        let p = perms(&["cli(sudo *)"], &[]);
        let j = Judge {
            mode: PermissionMode::FullAccess,
            cached: true,
            ..judge(&root, Some(argv(&["sudo", "rm", "-rf", "/tmp/x"])))
        };
        assert_eq!(
            decide(&p, "cli_run", "sudo rm -rf /tmp/x", &j),
            Decision::Ask
        );
        // xargs / find -exec 同路。
        let j = Judge {
            mode: PermissionMode::FullAccess,
            ..judge(&root, Some(argv(&["xargs", "rm"])))
        };
        assert_eq!(decide(&p, "cli_run", "xargs rm", &j), Decision::Ask);
        let j = Judge {
            mode: PermissionMode::FullAccess,
            ..judge(&root, Some(argv(&["find", ".", "-exec", "rm", "{}", ";"])))
        };
        assert_eq!(
            decide(&p, "cli_run", "find . -exec rm {} ;", &j),
            Decision::Ask
        );
        // r1 P1-1 判据落管线：`-delete` 折进后 `find . -exec ls {} \; -delete` 归写，
        // read_only（Always Ask）档逐个问——修复前归 ReadOnly 会被静默放行。
        let j = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(
                &root,
                Some(argv(&["find", ".", "-exec", "ls", "{}", "\\;", "-delete"])),
            )
        };
        assert_eq!(
            decide(&p, "cli_run", "find . -exec ls {} \\; -delete", &j),
            Decision::Ask
        );
        std::fs::remove_dir_all(&root).ok();
    }

    // -----------------------------------------------------------------------
    // 会话内批准缓存（design §6：只短路第 5 层）
    // -----------------------------------------------------------------------

    #[test]
    fn cache_short_circuits_mode_layer_only() {
        let root = fixture_root("cache");
        let p = HarnessPermissions::default();
        let cached = Judge {
            cached: true,
            ..judge(&root, Some(argv(&["npm", "install"])))
        };
        // 缓存命中 ⇒ 第 5 层短路（vault_write 档下写命令不再问）。
        assert_eq!(
            decide(&p, "cli_run", "npm install", &cached),
            Decision::Allow
        );
        // 但重定向层（第 2 层）先于缓存：vault 内写仍改道。
        let cli = argv(&["tee", "notes/a.md"]);
        let cached = Judge {
            cached: true,
            ..judge(&root, Some(cli.clone()))
        };
        assert!(matches!(
            decide(&p, "cli_run", "tee notes/a.md", &cached),
            Decision::Redirect(_)
        ));
        // 黑名单（第 3 层）先于缓存：缓存不解锁危险命令。
        let cli = argv(&["rm", "-rf", "/tmp/x"]);
        let cached = Judge {
            cached: true,
            ..judge(&root, Some(cli.clone()))
        };
        assert_eq!(
            decide(&p, "cli_run", "rm -rf /tmp/x", &cached),
            Decision::Ask
        );
        // deny 规则（第 1 层）先于缓存。
        let p = perms(&[], &["vault_patch"]);
        let cached = Judge {
            cached: true,
            ..judge(&root, None)
        };
        assert_eq!(decide(&p, "vault_patch", "a.md", &cached), Decision::Deny);
        // 缓存命中把模式层判成 Allow：**包括只读档下的 vault 写工具**（design §6 的字面读法——
        // 缓存只在第 5 层短路、不解锁上面三层；用户在更宽的档位显式给过会话内授权，切到更严的
        // 档位不回收。口径留节点 2 裁决，见 review-request 第三节）。
        let cached = Judge {
            mode: PermissionMode::ReadOnly,
            cached: true,
            ..judge(&root, None)
        };
        assert_eq!(
            decide(
                &HarnessPermissions::default(),
                "vault_patch",
                "a.md",
                &cached
            ),
            Decision::Allow
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
