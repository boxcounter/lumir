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
//! （REVIEW.md 「同一语义两处真源」条：同一个语义不许两处各判一半）。保守默认一律归写——错误方向是「多问一次」，
//! 不是「误放行」。
//!
//! 会话内批准缓存的**模块**在 [`super::permission_cache`]（design §6）；判定只消费它的一个
//! 布尔（[`Judge::cached`]），缓存本身不在这里持有状态——判定函数保持纯函数，单测不必碰全局态。
//!
//! 三档语义（design §2，2026-10-09 Alex 裁决后的现行口径）：`read_only` = **Always Ask**
//! （读类自动放行、一切写逐个问）；`vault_write`（默认）= vault 写工具放行（`vault_delete`
//! 逐个问）加 cli_run 经分类；`full_access` = 写命令免闸（vault 内写仍走第 2 层重定向）。
//! **模式层不再产生 Deny**——`Decision::Deny` 只可能来自第 1 层的用户 deny 规则。
//!
//! M459（change add-approval-decision-reason）：判定除结论外还产出**判定依据**
//! （[`DecisionReason`]，`Verdict::reason`）——「这次为什么进闸 / 为什么被拒」的唯一产出点。
//! 层序与结论一律未改，只是把「哪一层拦的」一并返回；批准卡依据行与 deny 回送文案都消费它。

// 会话内批准缓存（design §6）是同级模块 [`super::permission_cache`]（M413 起收编为
// `harness.rs` 的正常模块声明）；本模块只消费它的一个布尔（[`Judge::cached`]）。

use std::path::{Component, Path};

use serde::Serialize;
use ts_rs::TS;

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

/// 判定依据（M459，change add-approval-decision-reason）：这次调用**为什么**走到这个结论。
/// 批准卡「判定依据」行与 deny 回送文案的共同数据源——前端只按 `kind` 取文案，MUST NOT 自行推导层级。
///
/// 只列**有消费者**的层（REVIEW.md 「声明了却没有消费者」条）：`DenyRule` 只进回送模型的错误文案（deny 不产批准卡，
/// 见 change design §3）；其余三个变体随批准请求事件与 `harness_state` 快照两条通道到前端。
/// 自动放行的层（allow 规则命中 / 会话内缓存命中 / 只读白名单 / vault 内写重定向）**不产出依据**
/// ——它们没有「被拦下」的界面面。序列化形状是 internally tagged（`{"kind": …, …}`，serde 与
/// ts-rs 共用同一份定义）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum DecisionReason {
    /// 第 1 层：用户 deny 规则命中（`rule` = 命中的规则原文）。
    DenyRule { rule: String },
    /// 第 3 层：危险黑名单 · shell 包装器（`command` = 包装器命令名，如 `zsh`）。
    DangerousWrapper { command: String },
    /// 第 3 层：危险黑名单 · 其余成员。**不点名**：`sudo rm -rf …` 这类调用的命中者是包装器递归
    /// 展开后的内层命令，外层 argv[0] 点名会写出错误主词（change design §2 裁决点 2）。
    DangerousCommand,
    /// 第 5 层：模式默认分层（`mode` = 判定当时读到的档位；前端据它取档名与档释义）。
    ModeDefault { mode: PermissionMode },
}

/// 判定输出（M459）：结论 + 依据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    pub decision: Decision,
    /// 判定依据：`None` = 自动放行的层。不变式：`decision == Decision::Ask` 时恒为 `Some`。
    pub reason: Option<DecisionReason>,
}

impl Verdict {
    /// 自动放行的层（allow 规则 / 缓存 / 只读白名单 / vault 内写重定向）：无依据可讲。
    fn auto(decision: Decision) -> Self {
        Self {
            decision,
            reason: None,
        }
    }
}

/// 读类工具：默认 allow（三档一致）。
///
/// `vault_list`（change add-harness-vault-workspace-list）：目录 / 路径发现是读操作，无副作用，
/// 因此落在读类——三档直接放行、不进批准闸。
///
/// `cron_task_list` 是读类（change add-cron-conversational-registration design §6.1）：它读的是配置
/// 与去重状态、不是 vault——但「读类默认放行」依赖的是「没有副作用」，不依赖被读对象的类型。
const READ_TOOLS: [&str; 5] = [
    "vault_read",
    "vault_search",
    "vault_list",
    "skill_load",
    "cron_task_list",
];

/// 判定一次工具调用（design §1 的五层管线）。
///
/// `subject`：模式匹配的主体串（cli 为拼接 argv，vault 工具为路径参数）。
/// `judge`：模式 / vault 根（重定向判定用）/ argv（cli_run 分类与写目标提取用）/ 缓存命中。
///
/// 返回 [`Verdict`]：结论 + 判定依据（M459）。层序与结论与 M459 前逐字节一致。
pub fn decide(
    permissions: &HarnessPermissions,
    tool: &str,
    subject: &str,
    judge: &Judge,
) -> Verdict {
    // 第 1 层：用户显式 deny 优先于一切（含重定向与黑名单）。规则原文随依据带出（回送文案用）。
    if let Some(rule) = matching_rule(&permissions.deny, tool, subject) {
        return Verdict {
            decision: Decision::Deny,
            reason: Some(DecisionReason::DenyRule {
                rule: rule.to_string(),
            }),
        };
    }

    let class = (tool == "cli_run")
        .then(|| judge.argv.as_deref().map(classify_cli))
        .flatten();

    // 第 2 层：vault 内写硬重定向（任何档，含 full_access；design §4 + 裁决点 6）。
    if class == Some(CliClass::Write) {
        if let Some(redirect) = redirect_for(judge.root, judge.argv.as_deref().unwrap_or(&[])) {
            return Verdict::auto(Decision::Redirect(redirect));
        }
    }

    // 第 3 层：危险黑名单（任何档都问，不静默 deny——用户在批准卡里看得到完整命令）。
    if class == Some(CliClass::Dangerous) {
        return Verdict {
            decision: Decision::Ask,
            reason: Some(dangerous_reason(judge.argv.as_deref().unwrap_or(&[]))),
        };
    }

    // 第 4 层：用户显式 allow。
    if matching_rule(&permissions.allow, tool, subject).is_some() {
        return Verdict::auto(Decision::Allow);
    }

    // 第 5 层：模式默认分层（会话内批准缓存命中即在此层短路——它不解锁上面三层）。
    if judge.cached {
        return Verdict::auto(Decision::Allow);
    }
    let decision = mode_layer(tool, class, judge.mode);
    // 本层产 Ask 时才带依据（放行无需解释）；档位取自判定输入，不让前端读自己那份读数。
    let reason =
        (decision == Decision::Ask).then_some(DecisionReason::ModeDefault { mode: judge.mode });
    Verdict { decision, reason }
}

/// 危险黑名单命中的依据：只看**外层 argv[0]**——包装器类点名（`zsh -lc …` 的「内容不可知」
/// 正是用户疑惑的原点），其余成员走统一句（不点名，理由见 [`DecisionReason::DangerousCommand`]）。
/// argv 为空（cli_run 无命令形态）时按「其余成员」给句。
fn dangerous_reason(argv: &[String]) -> DecisionReason {
    let name = argv
        .first()
        .map(|command| command_basename(command))
        .unwrap_or_default();
    let args = argv.get(1..).unwrap_or(&[]);
    match dangerous_kind(&name, args) {
        Some(DangerousKind::Wrapper) => DecisionReason::DangerousWrapper { command: name },
        _ => DecisionReason::DangerousCommand,
    }
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
        // 调度工具（change add-cron-conversational-registration design §6.1，Alex 节点 1 裁决 2）：
        // `create` / `remove` 与 `vault_delete` 同形——定时任务是**持续性开销**，批准的一刻是
        // 用户唯一能看见「它以后每天会自己跑」的时机；`full_access` 档的承诺是不打断。`list`
        // 在读类白名单里，三档放行。
        "cron_task_create" | "cron_task_remove" => match mode {
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

/// 只读白名单（design §3.1，裁决点 2 按初始表落地；change readonly-allowlist-tightening-oct23
/// 起是**能力断言**下的成员清单，不再等于「任意参数形态皆为纯读」）。
///
/// 成员名只决定「值得做形态判定」，结论由 [`whitelist_write_form`] 给出：出现写文件形态的
/// argv 降为写（design §2.2）。含条件形态的 `find` / `sed` / `git` 不在本表（各自走到
/// [`classify_cli_at`] 的分支）。
const READ_ONLY_COMMANDS: [&str; 28] = [
    "ls", "cat", "head", "tail", "wc", "file", "stat", "pwd", "which", "whereis", "echo", "printf",
    "date", "uname", "du", "df", "rg", "grep", "egrep", "fgrep", "tree", "less", "more", "jq",
    "xxd", "od", "hexdump", "base64",
];

/// 白名单成员的写文件形态（change readonly-allowlist-tightening-oct23 design §2.2）：命中即写，
/// 走模式默认分层（`full_access` 免闸，与 `cp` / `tee` 同档，D1）。
///
/// 判据是**参数形态**，不是命令名的常见用途——`base64` 在表内不等于 `base64 -o` 可放行。
/// 逐成员依据（本机实测 / man）见 design §3 处置表：`base64 -o`、`xxd` 的第二位置参数、
/// `file -C`、`tree -o`·`-R`、`less -o`·`-O`、`find -fprint` 系。
///
/// 短旗标簇按 design §2.2 末段处理：单 `-` 起首、非 `--`、写形态字母之前只出现该命令的
/// 无值旗标字母；一旦遇到字母表外字符（值粘连形态）即停——只会落到「没命中」，不会误判。
fn whitelist_write_form(name: &str, args: &[String]) -> bool {
    match name {
        // BSD base64：`-o file` 写出文件；无值旗标 `-d` / `-D` / `-h`，`-b` / `-i` 取值。
        "base64" => args.iter().any(|arg| {
            short_flag_cluster_hits(arg, "dDh", &['o'])
                || arg == "--output"
                || arg.starts_with("--output=")
        }),
        // xxd 的第二个位置参数是输出文件（普通 dump 与 `-r` 同形，实测）。
        "xxd" => xxd_positionals(args).len() >= 2,
        // file：`-C` 编译 magic 并在当前目录写 `magic.mgc`。
        "file" => args.iter().any(|arg| {
            short_flag_cluster_hits(arg, "bcdEhIiklLnNpPrsSvz0", &['C']) || arg == "--compile"
        }),
        // tree：`-o file` 写输出、`-R` 每层写 `00Tree.html`（tree(1) man；本机未安装）。
        "tree" => args
            .iter()
            .any(|arg| short_flag_cluster_hits(arg, "adDfFghilnNpqrsStuUvxCAJ", &['o', 'R'])),
        // less：`-o` / `-O` / `--log-file` 写日志（防御性——当前 spawn 非 tty，D3）。
        "less" => args.iter().any(|arg| {
            short_flag_cluster_hits(arg, "aABcCdDeEfFgGiIJKlLmMnNqQrRsSuUVvX", &['o', 'O'])
                || arg == "--log-file"
                || arg.starts_with("--log-file=")
        }),
        _ => false,
    }
}

/// 短旗标簇里是否出现写形态字母：单 `-` 起首、非 `--`，逐字符扫描，命中 `write_letters` 即真；
/// 遇到 `plain_flags`（该命令的无值旗标字母集）外字符即停——那是值粘连形态或未知字母，
/// 判为「不命中」，由调用方的保守默认兜底（未知命令落写，不会因此误放行）。
fn short_flag_cluster_hits(arg: &str, plain_flags: &str, write_letters: &[char]) -> bool {
    let Some(cluster) = arg.strip_prefix('-') else {
        return false;
    };
    if cluster.is_empty() || cluster.starts_with('-') {
        return false;
    }
    for ch in cluster.chars() {
        if write_letters.contains(&ch) {
            return true;
        }
        if !plain_flags.contains(ch) {
            return false;
        }
    }
    false
}

/// xxd 的位置参数（design §2.2）：取值旗标按 **token 首字母** 判定——`-s` / `-s0` / `-c 16` /
/// `-c16` 的 `-s` / `-c` 吞一个值；`-ps` 这类以非取值字母起首的簇是原子选项，不吞值。
///
/// MUST NOT 对簇做单字母展开：`xxd -ps a.txt out.hex` 若把 `a.txt` 读成 `-s` 的值，只剩一个
/// 位置参数而漏判（实测该形态确实写文件，fail-open）。`-` 单独成 token 计为位置参数。
fn xxd_positionals(args: &[String]) -> Vec<String> {
    // xxd 的取值旗标（-c cols / -g group / -l len / -n name / -o offset / -s seek）。
    const VALUE_FLAGS: [char; 6] = ['c', 'g', 'l', 'n', 'o', 's'];
    let mut positionals = Vec::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "-" || !arg.starts_with('-') {
            positionals.push(arg.clone());
            index += 1;
            continue;
        }
        let mut chars = arg.chars().skip(1);
        if let Some(first) = chars.next() {
            // 首字母是取值旗标且后面没有粘连值 ⇒ 吞掉下一个 token。
            if VALUE_FLAGS.contains(&first) && chars.next().is_none() {
                index += 1;
            }
        }
        index += 1;
    }
    positionals
}

/// `rg` 的执行形态（change readonly-allowlist-tightening-oct23 proposal 第 3 条 +
/// change rg-zip-flags-dangerous-oct24）：`--pre` / `--pre-glob` / `--hostname-bin` 会执行指定
/// 程序，`-z` / `--search-zip` 的解压搜索会调起外部解压程序（实测 `gzip -d -c <file>`）——
/// 同族，归危险，任何档都逐个问（危险层先于 allow 规则与会话缓存）。
const RG_EXEC_FLAGS: [&str; 4] = ["--pre", "--pre-glob", "--hostname-bin", "--search-zip"];

/// `rg` 的取值短旗标（`rg --help` 的十四项）：短旗标簇里一旦出现，其后字符是它的粘连值，
/// 不再是旗标字母。`-z` 的簇内扫描靠它区分 `-zH`（zip + with-filename 两个 flag）与
/// `-ez`（pattern 是 `z`）。
const RG_VALUE_SHORT_FLAGS: [char; 14] = [
    'A', 'B', 'C', 'E', 'M', 'T', 'd', 'e', 'f', 'g', 'j', 'm', 'r', 't',
];

/// `-z`（`--search-zip` 的短名）在短旗标簇内是否出现：`rg -zH` 实测成立（ripgrep 15.2），
/// 只按整 token 匹配会漏掉捆绑形态。长形态无缩写（实测 `rg --search` 被拒），由
/// [`RG_EXEC_FLAGS`] 的整 flag / `=` 判据覆盖。簇内遇到取值旗标即停；未知字母按无值继续扫
/// ——错误方向是多问一次，不是漏判。
fn rg_search_zip_short_form(args: &[String]) -> bool {
    args.iter().any(|arg| {
        let Some(cluster) = arg.strip_prefix('-') else {
            return false;
        };
        if cluster.is_empty() || cluster.starts_with('-') {
            return false;
        }
        cluster
            .chars()
            .take_while(|ch| !RG_VALUE_SHORT_FLAGS.contains(ch))
            .any(|ch| ch == 'z')
    })
}

fn rg_exec_form(args: &[String]) -> bool {
    args.iter().any(|arg| {
        RG_EXEC_FLAGS.iter().any(|flag| {
            arg == flag
                || arg
                    .strip_prefix(flag)
                    .is_some_and(|rest| rest.starts_with('='))
        })
    }) || rg_search_zip_short_form(args)
}

/// find 的写原语（GNU find；BSD find 无 `-fls` 等，分类器是文本级、跨平台）。
/// 单一真源：`-exec` 递归路径与无 exec 的普通路径都从这里判（REVIEW.md 「同一语义两处真源」条）。
const FIND_WRITE_PRIMARIES: [&str; 4] = ["-fprint", "-fprint0", "-fprintf", "-fls"];

fn find_write_primitive(args: &[String]) -> bool {
    args.iter()
        .any(|arg| FIND_WRITE_PRIMARIES.contains(&arg.as_str()))
}

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
///
/// 受限解包形态（[`unpackable_script`] 命中）**不适用**本条：脚本里的 `;` `|` 由逐子命令
/// 判定取代（change harness-permission-rules-oct23 design §2.4 硬约束 2）。非解包形态下
/// 一字不动。
const SHELL_META: [&str; 10] = ["|", ";", "&&", "||", ">", ">>", "<", "`", "$(", "${"];

// ---------------------------------------------------------------------------
// shell 包装器受限解包（change harness-permission-rules-oct23 A2 / design §2）
// ---------------------------------------------------------------------------

/// 可解包的 wrapper 名单（design §2.1 第 1 条）：只收 `-c` 族语义稳定的四种。
/// `fish` / `csh` / `ksh` / `cmd` / `powershell` / `pwsh` / `osascript` / `eval` / `exec`
/// 的 flag 组合形态各异、收益小，一律不解包（维持危险）。
const UNPACK_WRAPPERS: [&str; 4] = ["sh", "bash", "zsh", "dash"];

/// 嵌套解包深度上限（design §2.3 第 5 条）：`bash -lc "bash -lc \"ls\""` 是 2 层。
const UNPACK_MAX_DEPTH: u32 = 2;

/// 单脚本的子命令数上限（design §2.3 第 3 条，解析成本上限，非安全语义）。
const UNPACK_MAX_COMMANDS: usize = 16;

/// 单脚本字节数上限（同上）。
const UNPACK_MAX_SCRIPT_BYTES: usize = 4096;

/// 无害重定向的整 token 字面量（design §2.2 / Q3 裁决）：只合并输出流或丢进 `/dev/null`，
/// 不碰文件系统。`>>` 与 `<` 刻意不在集内（前者写文件、后者可读任意文件外泄）。
const HARMLESS_REDIRECTS: [&str; 4] = ["2>/dev/null", "1>/dev/null", ">/dev/null", "2>&1"];

/// 可解包形态判据（design §2.1，全部满足才算）：wrapper 名 × 恰好 `-c` / `-lc` / `-cl` ×
/// 恰好一个脚本参数。返回脚本原文。`bash script.sh` / `bash -lc a b` / 裸 `bash` /
/// `-x` / `-e` / `--login` 等形态一律不是解包形态（维持危险）。
fn unpackable_script<'a>(name: &str, args: &'a [String]) -> Option<&'a str> {
    if !UNPACK_WRAPPERS.contains(&name) {
        return None;
    }
    if args.len() != 2 {
        return None;
    }
    let flag = args[0].strip_prefix('-')?;
    if flag.is_empty() || flag.starts_with('-') {
        return None;
    }
    if !flag.chars().all(|ch| ch == 'l' || ch == 'c') || !flag.contains('c') {
        return None;
    }
    Some(&args[1])
}

/// 解包判定（design §2.4）：只有「整条脚本都是只读子命令」才降到 [`CliClass::ReadOnly`]；
/// 其余一律 [`CliClass::Dangerous`]——**MUST NOT** 降为写，否则 `full_access` 会静默放行
/// 包装脚本（Q4 裁决）。
fn classify_unpacked_script(script: &str, depth: u32) -> CliClass {
    if depth >= UNPACK_MAX_DEPTH || script.len() > UNPACK_MAX_SCRIPT_BYTES {
        return CliClass::Dangerous;
    }
    let Some(commands) = split_linear_script(script) else {
        return CliClass::Dangerous;
    };
    if commands.is_empty() || commands.len() > UNPACK_MAX_COMMANDS {
        return CliClass::Dangerous;
    }
    // 子命令分类复用同一个 classify 入口（REVIEW.md 「同一语义两处真源」条）——
    // 未知命令 / `cd` / 解释器 / 写动词都会落非 ReadOnly，从而整条维持危险。
    if commands
        .iter()
        .all(|sub| classify_cli_at(sub, depth + 1) == CliClass::ReadOnly)
    {
        CliClass::ReadOnly
    } else {
        CliClass::Dangerous
    }
}

/// 线性脚本的词法切分（design §2.2 的保守子集）：产出「子命令 × argv」列表。
///
/// 只认 `;` `&&` `||` `|` 四种分隔与本表四个无害重定向；单 / 双引号内按字面、引号内不解析
/// 变量；其余任何 `$` 反引号括弧反斜杠换行 `&`（后台）`<` `>`（白名单外）都是**失败**
/// （`None`），整条调用随后按危险处理。任何产出都是保守侧：`#` / glob 按字面当参数，
/// 误判方向只会是多问一次。
fn split_linear_script(script: &str) -> Option<Vec<Vec<String>>> {
    /// 收尾当前词（`''` 这种空引号参数也要保留：shell 里它是真实参数）。
    fn flush(word: &mut String, started: &mut bool, words: &mut Vec<String>) {
        if *started {
            words.push(std::mem::take(word));
            *started = false;
        }
    }
    /// 结束一个子命令：空子命令（`;;` / 首尾分隔符 / 只有重定向）一律失败。
    fn end_command(words: &mut Vec<String>, commands: &mut Vec<Vec<String>>) -> Option<()> {
        if words.is_empty() {
            return None;
        }
        commands.push(std::mem::take(words));
        Some(())
    }

    let mut commands: Vec<Vec<String>> = Vec::new();
    let mut words: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut word_started = false;
    let mut expecting_command = true;
    let mut index = 0;

    while index < script.len() {
        let rest = &script[index..];
        let ch = rest.chars().next()?;

        // 重定向识别先于通用词法（design §2.2 补充口径）：只在词边界处整段匹配，
        // 命中即丢弃、不参与 argv——`2>&1` 里的 `&` 与 `2>` 里的 `>` 因此不会触发失败分支。
        // 匹配后紧跟的必须是词边界（空白 / 分隔符 / 结尾）：`>/dev/null2` 在 shell 里写的是
        // 另一个文件，不能让「白名单字面量 + 粘连尾巴」蒙混成无害形态（fail-closed）。
        if !word_started {
            if let Some(redirect) = HARMLESS_REDIRECTS
                .iter()
                .find(|literal| rest.starts_with(**literal))
            {
                let tail = &rest[redirect.len()..];
                let boundary = tail
                    .chars()
                    .next()
                    .is_none_or(|next| matches!(next, ' ' | '\t' | ';' | '&' | '|'));
                if !boundary {
                    return None;
                }
                index += redirect.len();
                continue;
            }
        }

        match ch {
            ' ' | '\t' => {
                flush(&mut word, &mut word_started, &mut words);
                index += 1;
            }
            // 多行脚本一律不解包：换行是最容易藏东西的地方。
            '\n' | '\r' => return None,
            ';' => {
                flush(&mut word, &mut word_started, &mut words);
                end_command(&mut words, &mut commands)?;
                expecting_command = true;
                index += 1;
            }
            '&' => {
                if !rest.starts_with("&&") {
                    // 后台执行（单 `&`）。
                    return None;
                }
                flush(&mut word, &mut word_started, &mut words);
                end_command(&mut words, &mut commands)?;
                expecting_command = true;
                index += 2;
            }
            '|' => {
                let width = if rest.starts_with("||") { 2 } else { 1 };
                flush(&mut word, &mut word_started, &mut words);
                end_command(&mut words, &mut commands)?;
                expecting_command = true;
                index += width;
            }
            '\'' => {
                let body = &rest[1..];
                let end = body.find('\'')?;
                word.push_str(&body[..end]);
                word_started = true;
                expecting_command = false;
                index += 1 + end + 1;
            }
            '"' => {
                let body = &rest[1..];
                let mut offset = 0;
                loop {
                    let inner = body[offset..].chars().next()?;
                    match inner {
                        '"' => break,
                        // 变量、命令替换、转义都超出保守子集。
                        '$' | '`' | '\\' => return None,
                        other => {
                            word.push(other);
                            offset += other.len_utf8();
                        }
                    }
                }
                word_started = true;
                expecting_command = false;
                index += 1 + offset + 1;
            }
            // 变量 / 命令替换 / 子 shell / 分组 / 转义 / 非白名单重定向：一律失败。
            '$' | '`' | '(' | ')' | '{' | '}' | '\\' | '<' | '>' => return None,
            _ => {
                word.push(ch);
                word_started = true;
                expecting_command = false;
                index += ch.len_utf8();
            }
        }
    }

    flush(&mut word, &mut word_started, &mut words);
    if !words.is_empty() {
        commands.push(words);
    }
    // 空脚本 / 尾随分隔符 / 只有重定向：没有可判定的子命令。
    if expecting_command {
        return None;
    }
    Some(commands)
}

/// argv → 三态分类（design §3）。输入是 argv 数组（command + args），比主体串拼接信息全。
///
/// 判序：危险（黑名单整表，含包装器）→ 间接调用包装器递归（sudo / xargs / find -exec 系，
/// 取被包装命令再分类，取不出归危险）→ 保守降级（解释器 / 元字符 / 已知写动词）→ 只读白名单
/// → 未知归写。危险先判是因为黑名单与白名单的交集按黑名单处理（更保守侧赢，design §3.3）。
pub fn classify_cli(argv: &[String]) -> CliClass {
    classify_cli_at(argv, 0)
}

/// 带递归预算的分类入口（change harness-permission-rules-oct23 design §2.4）：`depth` 是
/// 「已进入的包装层数」，公共入口传 0；sudo / xargs / find -exec 递归与 shell 解包共用。
fn classify_cli_at(argv: &[String], depth: u32) -> CliClass {
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

    // 受限解包（design §2.4）：形态命中即走解包判定，结论只有只读 / 危险两种。
    // 放在危险黑名单之前——包装器本身在黑名单里，先判黑名单就永远解不开；非解包形态
    // （`bash script.sh` / 多重 flag / 裸包装器）落到下面的黑名单分支，行为与改动前一致。
    if let Some(script) = unpackable_script(&name, args) {
        return classify_unpacked_script(script, depth);
    }
    if is_dangerous(&name, args) {
        return CliClass::Dangerous;
    }
    // 间接调用包装器（sudo / xargs / find -exec 系）：按命令名字面匹配会让 `sudo rm` 在
    // full_access 档免闸绕过黑名单（backlog 2026-10-10 Alex 裁决「堵」）——先递归取被包装
    // 命令再进分类管线；取不出确定形态保守归危险（任何档都问）。放在解释器 / 元字符检查
    // 之前：`sudo bash -c "a;b"` 的外层参数带元字符，先判元字符会落「写」被 full_access 放行。
    if let Some(class) = classify_wrapped(&name, args, depth) {
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
        // 是同一能力（分别在不同目录执行 / 交互确认）。`-fprint` 系把输出写进文件
        // （change readonly-allowlist-tightening-oct23 design §2.2），一并按写处理。
        "find" => {
            if args.iter().any(|arg| {
                matches!(
                    arg.as_str(),
                    "-delete" | "-exec" | "-execdir" | "-ok" | "-okdir"
                )
            }) || find_write_primitive(args)
            {
                CliClass::Write
            } else {
                CliClass::ReadOnly
            }
        }
        // sed 的写 / 执行能力在脚本语言里：`w` / `W` / `s///w` 写文件、`e` / `s///e` 执行
        // 命令、`-f` 把脚本藏进文件（design §2.3）。执行形态已由危险层先判，这里只剩只读 / 写。
        "sed" => classify_sed(args),
        "git" => classify_git(args),
        // 白名单成员：能力断言（判只读 = 不写文件、不执行程序）——先查写形态表（design §2.2），
        // 命中即写；未命中才只读。
        other if READ_ONLY_COMMANDS.contains(&other) => {
            if whitelist_write_form(other, args) {
                CliClass::Write
            } else {
                CliClass::ReadOnly
            }
        }
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

/// 危险黑名单命中的类别（M459）：`is_dangerous` 与判定依据共用这一次判定——同一语义不许两处
/// 各判一半（REVIEW.md 「同一语义两处真源」条）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DangerousKind {
    /// shell 包装器类（`sh` / `bash` / `zsh` / … / `eval` / `exec`）。
    Wrapper,
    /// 其余危险成员（`rm` / 关机重启 / `dd` / `mkfs` 系 / 磁盘类 / `git clean`·`reset --hard`）。
    Command,
}

/// 危险黑名单命中（design §3.3），命中时带出类别。
fn dangerous_kind(name: &str, args: &[String]) -> Option<DangerousKind> {
    if DANGEROUS_WRAPPERS.contains(&name) {
        return Some(DangerousKind::Wrapper);
    }
    if DANGEROUS_COMMANDS.contains(&name) {
        return Some(DangerousKind::Command);
    }
    // mkfs 系（mkfs / mkfs.ext4 / …）按前缀判。
    if name == "mkfs" || name.starts_with("mkfs.") {
        return Some(DangerousKind::Command);
    }
    if DANGEROUS_DISK.contains(&name) {
        return Some(DangerousKind::Command);
    }
    // diskutil 只在破坏形态（erase* / *Partition*）入黑名单；其余形态（list / info）落
    // 「未知 ⇒ 写」，仍要过闸。
    if name == "diskutil" {
        return args
            .iter()
            .any(|arg| {
                let lower = arg.to_lowercase();
                lower.contains("erase") || lower.contains("partition")
            })
            .then_some(DangerousKind::Command);
    }
    if name == "git" {
        return match git_effective_subcommand(args).as_deref() {
            Some("clean") => Some(DangerousKind::Command),
            Some("reset") if args.iter().any(|arg| arg == "--hard") => Some(DangerousKind::Command),
            _ => None,
        };
    }
    // 白名单成员的执行形态（change readonly-allowlist-tightening-oct23 design §2.1 / §2.3）：
    // 归危险而不是写——「任意命令执行」与 shell 包装器同级，任何档都逐个问。放在危险层
    // （而不是第 7 步）是必须的：危险层先于 allow 规则与会话缓存，full_access 也放不过。
    if name == "rg" && rg_exec_form(args) {
        return Some(DangerousKind::Command);
    }
    if name == "sed" && classify_sed(args) == CliClass::Dangerous {
        return Some(DangerousKind::Command);
    }
    None
}

fn is_dangerous(name: &str, args: &[String]) -> bool {
    dangerous_kind(name, args).is_some()
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
fn classify_wrapped(name: &str, args: &[String], depth: u32) -> Option<CliClass> {
    match name {
        "sudo" => Some(match extract_wrapped_command(args, &SUDO_VALUE_FLAGS) {
            Some(argv) => classify_cli_at(&argv, depth + 1),
            // 取不出被包装命令（裸 sudo / 只有 flag）：保守归危险，不问形态不漏拦。
            None => CliClass::Dangerous,
        }),
        "xargs" => Some(match extract_wrapped_command(args, &XARGS_VALUE_FLAGS) {
            Some(argv) => classify_cli_at(&argv, depth + 1),
            None => CliClass::Dangerous,
        }),
        // find 只在带 -exec / -execdir / -ok / -okdir 时进递归；否则走既有分支。
        "find" => classify_find_exec(args, depth),
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
fn classify_find_exec(args: &[String], depth: u32) -> Option<CliClass> {
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
        overall = max_class(overall, classify_cli_at(&argv, depth + 1));
        index = end + 1;
    }
    // exec 子句之外的写形态折进 overall：`-delete` 直接删文件，`-fprint` 系把输出写进文件。
    // master 上这些形态仅经「-exec 存在 ⇒ 写」兜底；递归后若只看护 exec 子句，它们会被吞
    // （`find . -exec ls {} \; -delete` 曾因此归 ReadOnly，在 read_only 档静默放行——M413 r1
    // P1-1 回归，修复即本段）。写原语表与普通路径共用 [`find_write_primitive`]：`-fprint0` /
    // `-fls` 在两条路径上必须同判（REVIEW.md 「同一语义两处真源」条）。
    if args.iter().any(|arg| arg == "-delete") || find_write_primitive(args) {
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

// ---------------------------------------------------------------------------
// sed 保守脚本扫描（change readonly-allowlist-tightening-oct23 design §2.3）
// ---------------------------------------------------------------------------

/// 单脚本字符上限：超限按解析失败处理（归写，fail-closed）。
const SED_SCRIPT_MAX_CHARS: usize = 4096;

/// sed 的取值长选项（分写与等号两形态）：`--expression` 取脚本，`--file` 是不可见脚本，
/// `--line-length` 只是取值——不识别它会把值误当脚本正文，后面真正的脚本反而漏扫。
const SED_LONG_VALUE_FLAGS: [&str; 3] = ["--expression", "--file", "--line-length"];

/// sed 的无值长选项；表外的长选项一律按解析失败归写（保守侧）。
const SED_LONG_FLAGS: [&str; 12] = [
    "--posix",
    "--debug",
    "--sandbox",
    "--quiet",
    "--silent",
    "--regexp-extended",
    "--separate",
    "--unbuffered",
    "--null-data",
    "--follow-symlinks",
    "--binary",
    "--in-place",
];

/// sed 参数解析结果（design §2.3 第一步）。
struct SedInvocation<'a> {
    /// 脚本源：逐个 `-e` / `--expression`；无 `-e` / `-f` 时是第一个位置参数。
    scripts: Vec<&'a str>,
    /// `-f` / `--file`：脚本体在分类期不可见。
    file_script: bool,
    /// `-i` / `--in-place`（含短旗标簇形态，堵 GNU `-ni` / `-Ei` 绕过）。
    in_place: bool,
    /// 输入文件——就地写形态的重定向目标。
    files: Vec<&'a str>,
}

/// 解析 sed 的 flag 与脚本源。`None` = 形态不明确（未知 flag / 缺取值 / 没有脚本源）→ 归写。
fn parse_sed_args(args: &[String]) -> Option<SedInvocation<'_>> {
    let mut scripts: Vec<&str> = Vec::new();
    let mut file_script = false;
    let mut in_place = false;
    let mut operands: Vec<&str> = Vec::new();
    let mut index = 0;
    let mut options_ended = false;
    while index < args.len() {
        let arg = args[index].as_str();
        // `-` 单独成 token 是输入文件（stdin），不是 flag。
        if options_ended || arg == "-" || !arg.starts_with('-') {
            operands.push(arg);
            index += 1;
            continue;
        }
        if arg == "--" {
            options_ended = true;
            index += 1;
            continue;
        }
        if arg.starts_with("--") {
            let (flag, inline) = match arg.split_once('=') {
                Some((flag, value)) => (flag, Some(value)),
                None => (arg, None),
            };
            if SED_LONG_VALUE_FLAGS.contains(&flag) {
                let takes_separate_value = inline.is_none();
                match flag {
                    "--expression" => {
                        scripts.push(match inline {
                            Some(value) => value,
                            None => args.get(index + 1)?.as_str(),
                        });
                    }
                    "--file" => file_script = true,
                    _ => {}
                }
                if takes_separate_value {
                    index += 1;
                }
                index += 1;
                continue;
            }
            if SED_LONG_FLAGS.contains(&flag) && inline.is_none() {
                if flag == "--in-place" {
                    in_place = true;
                }
                index += 1;
                continue;
            }
            return None;
        }
        // 短旗标簇：`-ni` / `-Ei` 是 `-n -i`，`-ne 's/x/y/'` 是 `-n -e …`。
        let cluster = arg.as_bytes();
        let mut position = 1;
        while position < cluster.len() {
            match cluster[position] {
                b'n' | b'E' | b'r' | b's' | b'u' | b'z' => position += 1,
                b'e' => {
                    let rest = &arg[position + 1..];
                    if rest.is_empty() {
                        scripts.push(args.get(index + 1)?.as_str());
                        index += 1;
                    } else {
                        scripts.push(rest);
                    }
                    position = cluster.len();
                }
                b'f' => {
                    // 脚本体在分类期不可见：值（粘连或分写）已被吃掉，只记形态。
                    file_script = true;
                    if position + 1 == cluster.len() {
                        args.get(index + 1)?;
                        index += 1;
                    }
                    position = cluster.len();
                }
                b'i' => {
                    // `-i` / `-i.bak` / 簇内 `i`：余下是备份后缀。
                    in_place = true;
                    position = cluster.len();
                }
                b'l' => {
                    // `-l N`（GNU 行宽）取值：不识别会把它误当脚本源。
                    if position + 1 == cluster.len() {
                        args.get(index + 1)?;
                        index += 1;
                    }
                    position = cluster.len();
                }
                _ => return None,
            }
        }
        index += 1;
    }
    if file_script {
        return Some(SedInvocation {
            scripts,
            file_script,
            in_place,
            files: operands,
        });
    }
    if scripts.is_empty() {
        // 没有 -e / -f 时第一个位置参数是脚本源。
        let (script, rest) = operands.split_first()?;
        scripts.push(script);
        return Some(SedInvocation {
            scripts,
            file_script,
            in_place,
            files: rest.to_vec(),
        });
    }
    Some(SedInvocation {
        scripts,
        file_script,
        in_place,
        files: operands,
    })
}

/// sed 的三态分类（design §2.3）：`-f`（脚本不可见）与就地写归写；脚本里出现 `w` / `W` /
/// `s///w` 归写、`e` / `s///e` 归危险；只有**完整解析成功且无写 / 执行命令**的脚本才只读。
fn classify_sed(args: &[String]) -> CliClass {
    let Some(invocation) = parse_sed_args(args) else {
        return CliClass::Write;
    };
    let mut class = CliClass::ReadOnly;
    for script in &invocation.scripts {
        class = max_class(class, scan_sed_script(script));
    }
    if invocation.file_script || invocation.in_place {
        class = max_class(class, CliClass::Write);
    }
    class
}

/// sed 脚本静态扫描（design §2.3 第二步）：只在命令位识别命令字母，地址段（数字 / `$` /
/// `/…/` / `\c…c` / `~N` / `,` / `!`）先跳过——正则里的 `w` / `e` 不算命令。
///
/// 任何无法完整解析的形态（未闭合分隔符 / 未知字母 / 长度超限）归写：分类器无法证明它
/// 会执行程序，所以不是危险；但也不能放行。
fn scan_sed_script(script: &str) -> CliClass {
    let chars: Vec<char> = script.chars().collect();
    if chars.len() > SED_SCRIPT_MAX_CHARS {
        return CliClass::Write;
    }
    let mut index = 0;
    let mut class = CliClass::ReadOnly;
    while index < chars.len() {
        // 命令位：跳过分隔符与块尾。
        while index < chars.len() && matches!(chars[index], ' ' | '\t' | ';' | '\n' | '\r' | '}') {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        if chars[index] == '#' {
            skip_sed_to_line_end(&chars, &mut index);
            continue;
        }
        if skip_sed_addresses(&chars, &mut index).is_err() {
            return max_class(class, CliClass::Write);
        }
        skip_sed_blanks(&chars, &mut index);
        while chars.get(index) == Some(&'!') {
            index += 1;
            skip_sed_blanks(&chars, &mut index);
        }
        let Some(&letter) = chars.get(index) else {
            // 只有地址没有命令：脚本非法，形态不可证。
            return max_class(class, CliClass::Write);
        };
        index += 1;
        match letter {
            '{' => {}
            's' | 'y' => match scan_sed_substitute(&chars, &mut index, letter) {
                Ok(found) => class = max_class(class, found),
                Err(()) => return max_class(class, CliClass::Write),
            },
            'w' | 'W' => {
                class = max_class(class, CliClass::Write);
                skip_sed_to_command_end(&chars, &mut index);
            }
            // GNU 的 `e` 把余下文本当 shell 命令执行。
            'e' => {
                class = max_class(class, CliClass::Dangerous);
                skip_sed_to_line_end(&chars, &mut index);
            }
            // `r` / `R` 读文件（只读外泄与 `cat` 同级，不在本不变量范围内）。
            'r' | 'R' => skip_sed_to_command_end(&chars, &mut index),
            // `a` / `i` / `c` 的文本可能含 `;` `}`：按「到未转义换行」跳过。
            'a' | 'i' | 'c' => skip_sed_text(&chars, &mut index),
            ':' | 'b' | 't' | 'T' => skip_sed_to_command_end(&chars, &mut index),
            'd' | 'D' | 'g' | 'G' | 'h' | 'H' | 'n' | 'N' | 'p' | 'P' | 'q' | 'Q' | 'x' | 'z'
            | 'l' | 'F' | '=' | 'v' => skip_sed_to_command_end(&chars, &mut index),
            // 未知字母：sed 语法非法或形态不可证。
            _ => return max_class(class, CliClass::Write),
        }
    }
    class
}

/// `s` / `y` 的字段与旗标：两个分隔字段后读旗标——`w` → 写，`e` → 危险（GNU `s///e`）。
fn scan_sed_substitute(chars: &[char], index: &mut usize, letter: char) -> Result<CliClass, ()> {
    let Some(&delim) = chars.get(*index) else {
        return Err(());
    };
    // 分隔符不能是换行；反斜杠作分隔符的读法与转义歧义太大，按不可解析处理。
    if delim == '\n' || delim == '\\' {
        return Err(());
    }
    // `s/regexp/replacement/flags`：首分隔符只出现一次，两个字段共用中间那个分隔符。
    *index += 1;
    skip_sed_field(chars, index, delim)?;
    *index += 1;
    skip_sed_field(chars, index, delim)?;
    *index += 1;
    if letter == 'y' {
        // `y` 没有旗标（POSIX / GNU 一致）。
        skip_sed_to_command_end(chars, index);
        return Ok(CliClass::ReadOnly);
    }
    let mut class = CliClass::ReadOnly;
    while let Some(&flag) = chars.get(*index) {
        match flag {
            ';' | '\n' | '}' => break,
            'w' => {
                class = max_class(class, CliClass::Write);
                skip_sed_to_command_end(chars, index);
                break;
            }
            'e' => {
                class = max_class(class, CliClass::Dangerous);
                skip_sed_to_line_end(chars, index);
                break;
            }
            'g' | 'p' | 'i' | 'I' | 'm' | 'M' | '0'..='9' | ' ' | '\t' => *index += 1,
            _ => return Err(()),
        }
    }
    Ok(class)
}

/// 跳过 `s` / `y` 的一个字段：从当前位置扫到下一个未转义分隔符（**不吞**终止分隔符）。
fn skip_sed_field(chars: &[char], index: &mut usize, delim: char) -> Result<(), ()> {
    while let Some(&ch) = chars.get(*index) {
        match ch {
            '\\' => *index += 2,
            '\n' => return Err(()),
            other if other == delim => return Ok(()),
            _ => *index += 1,
        }
    }
    Err(())
}

/// 跳过一个以 `delim` 包裹的字段（`\` 转义下一字符）；未闭合 / 遇换行即失败。
fn skip_sed_delimited(chars: &[char], index: &mut usize, delim: char) -> Result<(), ()> {
    if chars.get(*index) != Some(&delim) {
        return Err(());
    }
    *index += 1;
    while let Some(&ch) = chars.get(*index) {
        match ch {
            '\\' => *index += 2,
            '\n' => return Err(()),
            other if other == delim => {
                *index += 1;
                return Ok(());
            }
            _ => *index += 1,
        }
    }
    Err(())
}

/// 地址段（design §2.3）：数字（含 `first~step`）、`$`、`/re/`、`\cre c`、`+N` / `~N`，
/// 可用 `,` 连成范围。
fn skip_sed_addresses(chars: &[char], index: &mut usize) -> Result<(), ()> {
    if !skip_sed_address(chars, index)? {
        return Ok(());
    }
    if chars.get(*index) == Some(&',') {
        *index += 1;
        skip_sed_blanks(chars, index);
        if !skip_sed_address(chars, index)? {
            return Err(());
        }
    }
    Ok(())
}

/// 单个地址；`Ok(false)` = 当前位置不是地址（命令位），`Err` = 形态不可解析。
fn skip_sed_address(chars: &[char], index: &mut usize) -> Result<bool, ()> {
    let Some(&ch) = chars.get(*index) else {
        return Ok(false);
    };
    match ch {
        '0'..='9' => {
            while chars.get(*index).is_some_and(|c| c.is_ascii_digit()) {
                *index += 1;
            }
            if chars.get(*index) == Some(&'~') {
                *index += 1;
                let start = *index;
                while chars.get(*index).is_some_and(|c| c.is_ascii_digit()) {
                    *index += 1;
                }
                if *index == start {
                    return Err(());
                }
            }
            Ok(true)
        }
        '$' => {
            *index += 1;
            Ok(true)
        }
        // `,+N` / `,~N`（GNU 相对地址形态）。
        '+' | '~' => {
            *index += 1;
            let start = *index;
            while chars.get(*index).is_some_and(|c| c.is_ascii_digit()) {
                *index += 1;
            }
            if *index == start {
                return Err(());
            }
            Ok(true)
        }
        '/' => {
            skip_sed_delimited(chars, index, '/')?;
            Ok(true)
        }
        // `\c regex c`：任意非字母、非换行的分隔符。
        '\\' => {
            let Some(&delim) = chars.get(*index + 1) else {
                return Err(());
            };
            if delim == '\n' || delim.is_alphanumeric() {
                return Err(());
            }
            *index += 1;
            skip_sed_delimited(chars, index, delim)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// 跳过一个命令的参数（`;` / 换行 / 块尾 `}` 三种终止符）。
fn skip_sed_to_command_end(chars: &[char], index: &mut usize) {
    while let Some(&ch) = chars.get(*index) {
        if matches!(ch, ';' | '\n' | '}') {
            return;
        }
        *index += 1;
    }
}

/// 跳到行尾（`e` 的命令文本与注释可含 `;`）。
fn skip_sed_to_line_end(chars: &[char], index: &mut usize) {
    while let Some(&ch) = chars.get(*index) {
        if ch == '\n' {
            return;
        }
        *index += 1;
    }
}

/// `a` / `i` / `c` 的文本：按「到未转义换行」跳过，`\` 转义下一字符（`\` + 换行是续行）。
fn skip_sed_text(chars: &[char], index: &mut usize) {
    while let Some(&ch) = chars.get(*index) {
        match ch {
            '\\' => *index += 2,
            '\n' => {
                *index += 1;
                return;
            }
            _ => *index += 1,
        }
    }
}

fn skip_sed_blanks(chars: &[char], index: &mut usize) {
    while chars.get(*index).is_some_and(|ch| matches!(ch, ' ' | '\t')) {
        *index += 1;
    }
}

/// git 全局 flag 白名单（design §2.4，Q1 2026-10-24 裁决）：只有这几枚可以出现在子命令之前；
/// 表外全局 flag 一律归写——`-c` 在 argv 里直接注入配置，`--git-dir` / `--work-tree` / `-C`
/// 把 git 指向信任范围之外（vault 之外）的仓库配置。
const GIT_GLOBAL_PASSTHROUGH: [&str; 4] = [
    "-P",
    "--no-pager",
    "--no-optional-locks",
    "--no-replace-objects",
];

/// 跳过白名单全局 flag 后的子命令下标；表外全局 flag / 裸 git（没有子命令）都返回 `None`。
fn git_subcommand_index(args: &[String]) -> Option<usize> {
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if !arg.starts_with('-') {
            return Some(index);
        }
        if GIT_GLOBAL_PASSTHROUGH.contains(&arg.as_str()) {
            index += 1;
            continue;
        }
        return None;
    }
    None
}

/// 危险判定用的有效子命令：跳过全局 flag **及其分写取值**（`-C <path>` / `--git-dir <path>` …）。
/// 与分类侧的全局 flag 白名单目的不同——这里要认出「`-C` 指向的仓库里跑的是 `clean`」，
/// 不能因为子命令前面有表外全局 flag 就让 `git -C /tmp/x clean -fd` 在 `full_access` 档免闸。
fn git_effective_subcommand(args: &[String]) -> Option<String> {
    const VALUE_FLAGS: [&str; 8] = [
        "-C",
        "-c",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--config-env",
        "--exec-path",
        "--super-prefix",
    ];
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if !arg.starts_with('-') {
            return Some(arg.to_lowercase());
        }
        index += if VALUE_FLAGS.contains(&arg.as_str()) {
            2
        } else {
            1
        };
    }
    None
}

/// git 只读子命令族（design §2.4）：`status` / `diff` / `log` / `show` / `blame` 与既有保留族。
/// 其余子命令（`add` / `commit` / `push` / `checkout` / `reset` / `clean` …）→ 写。
fn git_read_only_subcommand(sub: &str, rest: &[String]) -> bool {
    match sub {
        "status" | "diff" | "log" | "show" | "blame" | "rev-parse" | "ls-files" | "describe"
        | "shortlog" => true,
        // `branch` / `tag` 只认纯列表形态。
        "branch" => rest
            .iter()
            .all(|arg| GIT_BRANCH_LIST_FLAGS.contains(&arg.as_str())),
        "tag" => rest
            .iter()
            .all(|arg| GIT_TAG_LIST_FLAGS.contains(&arg.as_str()) || arg.starts_with("--sort=")),
        "stash" => rest.first().map(String::as_str) == Some("list"),
        "remote" => {
            !rest.is_empty()
                && rest
                    .iter()
                    .all(|arg| matches!(arg.as_str(), "-v" | "--verbose"))
        }
        _ => false,
    }
}

/// 只读子命令是否出现 `--output` / `--output=<file>` 形态（design §2.4）——**出现即写**，
/// 不要求后面确实跟值（`--` 之后的同名 pathspec 也保守判写；孤立 `--output` 由 git 自己报错）。
fn git_output_form(args: &[String]) -> bool {
    args.iter()
        .any(|arg| arg == "--output" || arg.starts_with("--output="))
}

/// 只读子命令的 `--output` 写目标（空格与等号两形态；`write_targets` 用）。
fn git_output_target(args: &[String]) -> Option<String> {
    option_values(args, &["--output"]).into_iter().next()
}

/// git 分类（design §2.4）：全局 flag 白名单 → 只读子命令族 → `--output` 写形态。
fn classify_git(args: &[String]) -> CliClass {
    // `git --version` 无子命令，是纯读形态（单列一条，不与「裸 git」混判）。
    if args.iter().any(|arg| arg == "--version") {
        return CliClass::ReadOnly;
    }
    let Some(index) = git_subcommand_index(args) else {
        // 裸 `git`（无子命令）/ 表外全局 flag：拿不准就写（保守默认）。
        return CliClass::Write;
    };
    let sub = args[index].to_lowercase();
    let rest = &args[index + 1..];
    if !git_read_only_subcommand(&sub, rest) {
        return CliClass::Write;
    }
    if git_output_form(rest) {
        return CliClass::Write;
    }
    CliClass::ReadOnly
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
    let suggested_tool = suggested_tool(argv, root, &targets);
    Some(Redirect {
        targets,
        suggested_tool,
    })
}

/// 写目标提取（design §4.1，按命令族的参数形态取「被写的一侧」；change
/// readonly-allowlist-tightening-oct23 design §5 补新增写形态的目标）。
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
        // sed 仅就地形态（带 -i，含 `-ni` 簇）才写；脚本源与输入文件由同一个解析器给出
        // （`-e` 形态下没有位置参数脚本，MUST NOT 再用「跳过第一个非 flag 参数」的旧读法）。
        "sed" => {
            if let Some(invocation) = parse_sed_args(args) {
                if invocation.in_place {
                    targets.extend(invocation.files.iter().map(|file| file.to_string()));
                }
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
        // base64：`-o` / `--output` 的取值（两种形态，复用 option_values）。
        "base64" => targets.extend(option_values(args, &["-o", "--output"])),
        // tree：`-o` 的取值；`-R` 写到每层的固定名 `00Tree.html`，无可提取目标。
        "tree" => targets.extend(option_values(args, &["-o"])),
        // xxd：第二个位置参数（不限于 `-r`；第一个是输入）。
        "xxd" => {
            if let Some(output) = xxd_positionals(args).get(1) {
                targets.push(output.clone());
            }
        }
        // find：写原语的下一个参数是目标文件。
        "find" => {
            for (index, arg) in args.iter().enumerate() {
                if FIND_WRITE_PRIMARIES.contains(&arg.as_str()) {
                    if let Some(value) = args.get(index + 1) {
                        targets.push(value.clone());
                    }
                }
            }
        }
        // git：只在只读子命令族出现 `--output` 时才有可重定向目标（写子命令的
        // `--output` 不是它被归写的理由，避免误改道）。
        "git" => {
            if let Some(index) = git_subcommand_index(args) {
                let sub = args[index].to_lowercase();
                let rest = &args[index + 1..];
                if git_read_only_subcommand(&sub, rest) {
                    targets.extend(git_output_target(rest));
                }
            }
        }
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
///
/// 新增写形态（`base64 -o` / `tree -o` / `xxd` 输出 / `find -fprint` / `git --output`）没有
/// 固定的新建 / 覆盖语义：按目标在 vault 内是否存在分流——已存在 ⇒ `vault_patch`（覆盖），
/// 否则 `vault_create`（design §5）。`targets` 是已经过 vault 内判定的相对路径。
fn suggested_tool(argv: &[String], root: &Path, targets: &[String]) -> Option<&'static str> {
    let name = argv.first().map(|command| command_basename(command))?;
    match name.as_str() {
        "mv" | "cp" | "ln" => Some("vault_move"),
        "rm" | "rmdir" => Some("vault_delete"),
        "sed" | "tee" | "truncate" | "dd" | "curl" | "wget" => Some("vault_patch"),
        "touch" | "mkdir" => Some("vault_create"),
        "base64" | "tree" | "xxd" | "find" | "git" => Some(overwrite_or_create(root, targets)),
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

/// 写目标的建议工具：只要有一个目标已存在（覆盖语义成立）就建议 `vault_patch`，否则新建
/// 产物建议 `vault_create`。目标存在性只看词法路径（`vault_relative` 已挡逃逸）。
fn overwrite_or_create(root: &Path, targets: &[String]) -> &'static str {
    if targets
        .iter()
        .any(|target| root.join(target).symlink_metadata().is_ok())
    {
        "vault_patch"
    } else {
        "vault_create"
    }
}

/// 单个写目标 → vault 相对路径（design §4.1 的 out-of-vault / in-vault 判定；change
/// `add-harness-vault-workspace-list` design §4 改为「词法规则 + symlink 否决」）。
///
/// - `..` 逃逸一律不重定向（词法阶段就拒）。
/// - 绝对路径：必须解析到 vault 根之下（已存在的祖先 canonicalize 后比较，拼回尚不存在的尾段）。
/// - 相对路径：**无条件**视为 vault 内目标。`cli_run` 子进程的工作目录就是当前 vault
///   （`tools.rs` 每次 spawn 设 `current_dir`），所以「不含 `..` 的相对路径」与「vault 内路径」
///   是同一件事——**包括根目录下尚不存在的新文件**。MUST NOT 再以「目标 / 父目录是否存在」作为
///   归属佐证：cwd 不再是主进程目录，存在性不再携带归属信息（旧实现靠它猜 cwd）。
/// - symlink 否决：目标自身（不存在时取最近的已存在祖先）canonicalize 后必须仍在根内，否则
///   不重定向（真实落点在 vault 外，按绝对路径逃逸同档处理）。
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
    let absolute = if path.is_absolute() {
        normalized.clone()
    } else {
        root.join(&normalized)
    };
    // 逃逸 / symlink 否决的单一判定：解析结果的根内相对段（None ⇒ 不在 vault 内）。
    let inside = resolve_inside(&root_canon, &absolute)?;
    if path.is_absolute() {
        let rel = inside.to_string_lossy().replace('\\', "/");
        return (!rel.is_empty()).then_some(rel);
    }
    let rel = normalized.to_string_lossy().replace('\\', "/");
    (!rel.is_empty()).then_some(rel)
}

/// `target` 解析到 `root_canon` 之下时的根内相对路径：把**最近的已存在祖先** canonicalize，
/// 再把尚不存在的尾段拼回去。目标自身存在时就是它的 canonicalize 结果——因此指向根外的
/// 符号链接（目标自身或路径上的祖先）在这里落 `None`，与绝对路径逃逸同一处理。
fn resolve_inside(root_canon: &Path, target: &Path) -> Option<std::path::PathBuf> {
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    let mut probe = target.to_path_buf();
    loop {
        if let Ok(canon) = probe.canonicalize() {
            let mut full = canon;
            for segment in suffix.iter().rev() {
                full.push(segment);
            }
            return full.strip_prefix(root_canon).ok().map(Path::to_path_buf);
        }
        let name = probe.file_name()?.to_os_string();
        suffix.push(name);
        probe = probe.parent()?.to_path_buf();
    }
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

/// 首个命中的规则原文（无命中为 `None`）——M459 起 `decide` 用它的带值形态（deny 规则原文要
/// 随依据回送）；匹配语义完全共用 [`rule_matches`]，不存在第二份匹配实现（REVIEW.md 「同一语义两处真源」条）。
fn matching_rule<'a>(rules: &'a [String], tool: &str, subject: &str) -> Option<&'a str> {
    rules
        .iter()
        .find(|rule| rule_matches(rule, tool, subject))
        .map(String::as_str)
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
                Some(prefix) => word_prefix_matches(prefix, subject),
                None => subject == pattern,
            }
        }
        ParsedRule::Unparsable => false,
    }
}

/// 词边界前缀匹配（change harness-permission-rules-oct23 Q2 / design §3.3）：
/// 主体串以 `prefix` 开头，或——仅当 `prefix` 以空格结尾（星号前是空格，生成规则的标准
/// 形态）——与去掉该尾随空格后的串**逐字相等**。等值容差只到「完全相等」为止，词边界
/// 不放宽：`git pushx` 既不以 `"git push "` 开头、也不等于 `"git push"`。
///
/// 单一实现：规则匹配与会话内批准缓存的前缀键共用它（REVIEW.md「同一语义两处真源」条）。
pub(crate) fn word_prefix_matches(prefix: &str, subject: &str) -> bool {
    subject.starts_with(prefix) || (prefix.ends_with(' ') && subject == prefix.trim_end())
}

// ---------------------------------------------------------------------------
// 批准卡次级动作的派生（change harness-permission-rules-oct23 A1 / A3 / design §3.1）
// ---------------------------------------------------------------------------

/// 一次过闸调用的两枚次级动作派生量——**单一真源**：批准卡按钮文案、会话记忆键、
/// 持久规则文本全部从这里取，三处因此不可能漂移。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionActions {
    /// 会话记忆的缓存键：`cli_run` 是带尾随空格的**前缀键**（词边界自描述，见
    /// [`super::permission_cache`]），vault / 调度工具是精确主体串。
    pub remember_key: String,
    /// 按钮上显示的粒度（前缀原文 / 路径原文，没有尾随空格——给人看的形态）。
    pub remember_label: String,
    /// 持久规则文本；`None` = 该工具不提供持久入口（`vault_delete` / `cron_task_*`，
    /// 见 design §3.2 与 Q7 裁决）。
    pub rule: Option<String>,
}

/// 派生一次过闸调用的两枚次级动作（design §3.1 表逐行）：`cli_run` 取「命令 + 首个非 flag
/// 参数」（第二词是 flag 或无参数时退化为命令名）；vault 写工具取路径目录段；`vault_delete`
/// 与 `cron_task_*` 只给会话记忆、不给持久规则。
///
/// 规则文本 MUST 是 [`parse_rule`] 可解析、且能真实命中同族调用的字符串：含换行或空路径时
/// 返回 `None`（不给按钮）——退化成「多问一次」可接受，退化成「误放行」不可接受。
/// 返回值 `None` 只表示「这张卡没有可派的次级动作」。
pub fn permission_prefix(
    tool: &str,
    argv: Option<&[String]>,
    subject: &str,
) -> Option<PermissionActions> {
    match tool {
        "cli_run" => {
            let argv = argv?;
            let command = argv.first()?.as_str();
            if command.is_empty() {
                return None;
            }
            // 第二词是 flag（`npm --version`）时退化为单词前缀——按钮上显示实际文本，
            // 授权面在按下前可见（Q1 裁决）。
            let second = argv
                .get(1)
                .map(String::as_str)
                .filter(|arg| !arg.is_empty() && !arg.starts_with('-'));
            let prefix = match second {
                Some(second) => format!("{command} {second}"),
                None => command.to_string(),
            };
            if prefix.contains('\n') || prefix.contains('\r') {
                return None;
            }
            Some(PermissionActions {
                remember_key: format!("{prefix} "),
                rule: Some(format!("cli({prefix} *)")),
                remember_label: prefix,
            })
        }
        // vault 写工具（design §3.1）：路径含目录段 ⇒ 目录前缀规则；根目录文件 ⇒ 精确规则。
        // `vault_delete` 不在本支（Q7：删除不给一键永久授权）。
        "vault_patch" | "vault_create" | "vault_move" => {
            let path = subject.trim();
            if path.is_empty() || path.contains('\n') || path.contains('\r') {
                return None;
            }
            let rule = match path.rfind('/') {
                Some(index) => format!("{tool}({}*)", &path[..=index]),
                None => format!("{tool}({path})"),
            };
            Some(PermissionActions {
                remember_key: path.to_string(),
                remember_label: path.to_string(),
                rule: Some(rule),
            })
        }
        // 会话内的既有记忆能力保留（精确主体串），持久入口不给（Q7 裁决）。
        "vault_delete" | "cron_task_create" | "cron_task_remove" => {
            let label = super::permission_cache::normalize_subject(subject);
            if label.is_empty() {
                return None;
            }
            Some(PermissionActions {
                remember_key: label.clone(),
                remember_label: label,
                rule: None,
            })
        }
        _ => None,
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

    /// 判定结论投影：本模块的回归断言只看结论（五层短路出来的 `Decision`），M459 起
    /// `super::decide` 返回带依据的 `Verdict`——本地的同名函数把它投影回 `Decision`，既有
    /// 断言因此逐字不改。**依据映射**的断言直接调 `super::decide`（见本模块末段）。
    fn decide(
        perms: &HarnessPermissions,
        tool: &str,
        subject: &str,
        judge: &Judge<'_>,
    ) -> Decision {
        super::decide(perms, tool, subject, judge).decision
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
        // 读类：三档一致放行。`vault_list` 自 change add-harness-vault-workspace-list 起属读类
        // （目录发现无副作用），任何档都不进批准闸；它的三档矩阵另有专测
        // （`vault_list_auto_allows_in_all_modes`），这里只钉只读档这一格。
        assert_eq!(decide(&p, "vault_read", "a.md", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_search", "q", &j), Decision::Allow);
        assert_eq!(decide(&p, "vault_list", "notes", &j), Decision::Allow);
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

    /// `vault_list` 是读类工具：**三档**都直接放行，且不产判定依据（自动放行的层没有「被拦下」的
    /// 界面面）。change add-harness-vault-workspace-list design §7 的「三档 auto-allow」判据落点。
    #[test]
    fn vault_list_auto_allows_in_all_modes() {
        let root = fixture_root("vault-list-modes");
        let p = HarnessPermissions::default();
        let subject = super::super::tools::permission_subject(
            "vault_list",
            &serde_json::json!({"path": "notes", "path_glob": "*.md"}),
        );
        assert_eq!(subject, "*.md", "主体串取 path_glob（有则）");
        for mode in [
            PermissionMode::ReadOnly,
            PermissionMode::VaultWrite,
            PermissionMode::FullAccess,
        ] {
            for subject in ["notes", "*.md", ""] {
                let j = Judge {
                    mode,
                    ..judge(&root, None)
                };
                let verdict = super::decide(&p, "vault_list", subject, &j);
                assert_eq!(verdict.decision, Decision::Allow, "{mode:?} {subject:?}");
                assert!(verdict.reason.is_none(), "自动放行不产依据：{mode:?}");
            }
        }
        // 读类不是「不可拒绝」：deny 规则仍优先（第 1 层先于模式层）。
        let p = perms(&[], &["vault_list(secret*)"]);
        assert_eq!(
            super::decide(&p, "vault_list", "secret/notes", &judge(&root, None)).decision,
            Decision::Deny
        );
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
            // 解包形态但脚本不满足安全集（变量 / 非白名单重定向 / 非只读子命令）——失败即危险。
            // 解包成功且全只读的形态不在此表（见 unpack_* 用例）。
            vec!["sh", "-c", "echo $HOME"],
            vec!["bash", "script.sh"],
            vec!["bash", "-x", "-c", "ls"],
            vec!["zsh", "-lc", "rm -rf /tmp/x"],
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

    /// 反向验证（REVIEW.md 「断言等价于子串」条）：把一条白名单形态的期望改坏，分类结果必须不同——
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
        // change readonly-allowlist-tightening-oct23 design §6.2 的拒判反向验证：每条拒判
        // 配一条只差一个 token 的正例，确认断言真的在判形态而不是判命令名。
        for (positive, negative) in [
            (
                vec!["base64", "-d", "a.txt"],
                vec!["base64", "-o", "/tmp/out.b64", "a.txt"],
            ),
            (vec!["xxd", "a.bin"], vec!["xxd", "a.bin", "/tmp/out.hex"]),
            (vec!["file", "a.md"], vec!["file", "-C", "-m", "magic"]),
            (
                vec!["tree", "-L", "2", "."],
                vec!["tree", "-o", "/tmp/x", "."],
            ),
            (vec!["less", "a.md"], vec!["less", "-o", "/tmp/log", "a.md"]),
            (
                vec!["find", ".", "-name", "*.md"],
                vec!["find", ".", "-name", "*.md", "-fprint", "/tmp/x"],
            ),
            (
                vec!["sed", "s/a/b/", "a.md"],
                vec!["sed", "w /tmp/x", "a.md"],
            ),
            (
                vec!["rg", "needle", "."],
                vec!["rg", "--pre", "/tmp/x", "needle", "."],
            ),
            (
                vec!["git", "status"],
                vec!["git", "-C", "/tmp/other", "status"],
            ),
            (vec!["git", "log"], vec!["git", "log", "--output=/tmp/x"]),
        ] {
            let positive = argv(&positive);
            let negative = argv(&negative);
            assert_eq!(classify_cli(&positive), CliClass::ReadOnly, "{positive:?}");
            assert_ne!(
                classify_cli(&negative),
                CliClass::ReadOnly,
                "拒判必须有区分度：{negative:?}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 只读白名单的能力断言（change readonly-allowlist-tightening-oct23）
    // -----------------------------------------------------------------------

    /// 每个白名单成员的写形态 → 写（design §2.2 逐成员，含 `--flag=value`、短旗标簇与
    /// 位置参数计数形态）。每条都在对应正例里有一条只差一个 token 的只读对照。
    #[test]
    fn whitelist_write_forms_downgrade_to_write() {
        for items in [
            // base64：`-o` / `--output`（实测写出文件；`-o -` 也保守拒判）。
            vec!["base64", "-i", "a.txt", "-o", "/tmp/out.b64"],
            vec!["base64", "-o", "/tmp/out.b64", "a.txt"],
            vec!["base64", "--output", "/tmp/out.b64", "a.txt"],
            vec!["base64", "--output=/tmp/out.b64", "a.txt"],
            vec!["base64", "-do", "/tmp/out.b64", "a.txt"],
            // xxd：第二个位置参数是输出文件（普通 dump 与 `-r` 同形）。
            vec!["xxd", "in.bin", "out.hex"],
            vec!["xxd", "-ps", "in.bin", "out.hex"],
            vec!["xxd", "-r", "in.hex", "out.bin"],
            vec!["xxd", "-", "out.hex"],
            vec!["xxd", "-c", "16", "in.bin", "out.hex"],
            vec!["xxd", "-c16", "in.bin", "out.hex"],
            // file：`-C` 编译 magic 并写 `magic.mgc`。
            vec!["file", "-C", "-m", "magic"],
            vec!["file", "--compile", "-m", "magic"],
            vec!["file", "-bC", "-m", "magic"],
            // tree：`-o` 写输出、`-R` 每层写 `00Tree.html`。
            vec!["tree", "-o", "out.txt", "."],
            vec!["tree", "-R", "."],
            vec!["tree", "-aR", "."],
            // less：`-o` / `-O` / `--log-file`（防御性，当前 spawn 不可达）。
            vec!["less", "-o", "log", "a.md"],
            vec!["less", "-O", "log", "a.md"],
            vec!["less", "--log-file", "log", "a.md"],
            vec!["less", "--log-file=log", "a.md"],
            // find：GNU 的四个写原语。
            vec!["find", ".", "-name", "*.md", "-fprint", "/tmp/list.txt"],
            vec!["find", ".", "-fprint0", "/tmp/list.txt"],
            vec!["find", ".", "-fprintf", "/tmp/list.txt", "%p\n"],
            vec!["find", ".", "-fls", "/tmp/list.txt"],
            // exec 递归路径与普通路径必须同判（REVIEW.md「同一语义两处真源」条）。
            vec![
                "find",
                ".",
                "-exec",
                "ls",
                "{}",
                ";",
                "-fprint0",
                "/tmp/list.txt",
            ],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
    }

    /// 写形态的**对照正例**：只差一个 token / 一个字符，仍须只读（design §6.2 反向验证）。
    #[test]
    fn whitelist_non_write_forms_stay_read_only() {
        for items in [
            vec!["base64", "-d", "a.txt"],
            vec!["base64", "-i", "a.txt"],
            vec!["xxd", "a.bin"],
            vec!["xxd", "-ps", "a.bin"],
            vec!["xxd", "-c", "16", "a.bin"],
            vec!["xxd", "-c16", "a.bin"],
            vec!["xxd", "-l", "16", "a.bin"],
            vec!["xxd", "-s", "0", "a.bin"],
            vec!["xxd", "-o", "16", "a.bin"],
            vec!["file", "a.md"],
            vec!["file", "-m", "magic", "a.md"],
            vec!["tree", "-L", "2", "."],
            vec!["less", "a.md"],
            vec!["find", ".", "-name", "*.md"],
            vec!["rg", "needle", "."],
            // `--pretty` 以 `--pre` 起首——前缀匹配会把只读查询误判危险，必须按完整 flag 判。
            vec!["rg", "--pretty", "needle", "."],
            // `--no-search-zip` 是 `--search-zip` 的否定形态：关掉解压，不执行任何程序。
            vec!["rg", "--no-search-zip", "needle", "."],
            // `-ez` 的 `z` 是 `-e` 的粘连值（pattern 为 `z`），不是 `--search-zip` 的短旗标。
            vec!["rg", "-ez", "needle", "."],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{argv:?}");
        }
    }

    /// xxd 的位置参数计数专项（design §2.2 的取值旗标口径，tasks 1.9 点名项）：
    /// `-ps` 是原子簇、不吞值；`-c` / `-s` 等取值旗标吞一个值（分写与粘连两形态）。
    #[test]
    fn xxd_positional_counting() {
        assert_eq!(
            classify_cli(&argv(&["xxd", "-ps", "in.bin", "out.hex"])),
            CliClass::Write,
            "原子簇 + 两个位置参数必须命中写形态"
        );
        assert_eq!(
            classify_cli(&argv(&["xxd", "-ps", "in.bin"])),
            CliClass::ReadOnly
        );
        assert_eq!(
            classify_cli(&argv(&["xxd", "-c16", "in.bin"])),
            CliClass::ReadOnly
        );
        assert_eq!(
            classify_cli(&argv(&["xxd", "-c", "16", "in.bin"])),
            CliClass::ReadOnly
        );
        // 反向：位置参数计数被改坏（少一个 token）时结论必须翻转。
        let mut fewer = argv(&["xxd", "-ps", "in.bin", "out.hex"]);
        fewer.pop();
        assert_eq!(classify_cli(&fewer), CliClass::ReadOnly);
        assert_eq!(
            xxd_positionals(&argv(&["-ps", "in.bin", "out.hex"])),
            vec!["in.bin", "out.hex"]
        );
    }

    /// 执行形态 → 危险（design §2.1 / §2.3）：rg 的 `--pre` 系 / `-z`·`--search-zip` 与
    /// sed 脚本的 `e` / `s///e`。
    #[test]
    fn exec_forms_are_dangerous() {
        for items in [
            vec!["rg", "--pre", "/tmp/pre.sh", "needle", "."],
            vec!["rg", "--pre=/tmp/pre.sh", "needle", "."],
            vec!["rg", "--pre-glob", "*.md", "needle", "."],
            vec!["rg", "--hostname-bin", "/tmp/bin", "needle", "."],
            vec!["rg", "--hostname-bin=/tmp/bin", "needle", "."],
            // `-z` / `--search-zip` 调起外部解压程序（gzip -d 等）。
            vec!["rg", "-z", "needle", "a.txt.gz"],
            vec!["rg", "--search-zip", "needle", "a.txt.gz"],
            // 短旗标簇里的 `-z`（实测 ripgrep 15.2 接受 `-zH` / `-zn` 捆绑）。
            vec!["rg", "-zH", "needle", "a.txt.gz"],
            vec!["rg", "-nz", "needle", "a.txt.gz"],
            vec!["sed", "-n", "e ls", "a.md"],
            vec!["sed", "s/a/b/e", "a.md"],
            vec!["sed", "1e date", "a.md"],
            vec!["sed", "/x/!e date", "a.md"],
            vec!["sed", "-e", "s/a/b/", "-e", "e date", "a.md"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
    }

    /// sed 保守脚本扫描（design §2.3）：写命令 / 脚本文件 / 就地簇 / 解析失败。
    #[test]
    fn sed_script_scanner_cases() {
        for items in [
            // 脚本里的写命令。
            vec!["sed", "-n", "w out.txt", "a.md"],
            vec!["sed", "-n", "W out.txt", "a.md"],
            vec!["sed", "s/a/b/w out.txt", "a.md"],
            vec!["sed", "1w out.txt", "a.md"],
            vec!["sed", "$w out.txt", "a.md"],
            // 脚本文件：脚本体在分类期不可见（四种形态）。
            vec!["sed", "-f", "script.sed", "a.md"],
            vec!["sed", "-fscript.sed", "a.md"],
            vec!["sed", "--file", "script.sed", "a.md"],
            vec!["sed", "--file=script.sed", "a.md"],
            vec!["sed", "-nf", "script.sed", "a.md"],
            // 就地写的短旗标簇（GNU `-ni` / `-Ei` 绕过与 `-i.bak` 后缀）。
            vec!["sed", "-ni", "s/a/b/", "a.md"],
            vec!["sed", "-Ei", "s/a/b/", "a.md"],
            vec!["sed", "-i.bak", "s/a/b/", "a.md"],
            vec!["sed", "--in-place=.bak", "s/a/b/", "a.md"],
            vec!["sed", "--in-place", "s/a/b/", "a.md"],
            // `-l` 取值不能被当成脚本源（否则真脚本 `w /tmp/x` 漏扫）。
            vec!["sed", "-l", "100", "w /tmp/x", "a.md"],
            // 解析失败 → 写（不是危险：无法证明它会执行程序）。
            vec!["sed", "s/a/b", "a.md"],
            vec!["sed", "/unclosed", "a.md"],
            vec!["sed", "o", "a.md"],
            vec!["sed", "s/a/b/unknown-flag", "a.md"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
        // 对照正例：地址 / 正则里的同名次字母不算命令。
        for items in [
            vec!["sed", "s/a/b/", "a.md"],
            vec!["sed", "/w/ p", "a.md"],
            vec!["sed", "s/e/x/", "a.md"],
            vec!["sed", "y/ab/cd/", "a.md"],
            vec!["sed", "2d", "a.md"],
            vec!["sed", "1,5d", "a.md"],
            vec!["sed", "/a\\/b/p", "a.md"],
            vec!["sed", "\\,foo,p", "a.md"],
            vec!["sed", "1!d", "a.md"],
            vec!["sed", "a text", "a.md"],
            // 多行脚本（换行是分隔符，不触发 shell 元字符层）。
            vec!["sed", "s/a/b/g\np", "a.md"],
            vec!["sed", "-e", "s/a/b/", "-e", "p", "a.md"],
            vec!["sed", "--expression=s/a/b/", "a.md"],
            vec!["sed", "-ne", "s/a/b/", "a.md"],
            vec!["sed", "-l", "100", "s/a/b/", "a.md"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{argv:?}");
        }
        // 扫描器专项：含 `;` 的多命令脚本在 argv 层会先落 shell 元字符的写分类，
        // 扫描结论只能直接对它断言（design §6.6）。
        for (script, expected) in [
            ("s/a/b/g;p", CliClass::ReadOnly),
            ("{p;}", CliClass::ReadOnly),
            ("/w/ p; s/e/x/", CliClass::ReadOnly),
            ("s/a/b/; w out", CliClass::Write),
            ("w out; p", CliClass::Write),
            ("s/a/b/g\ne date", CliClass::Dangerous),
            ("e ls", CliClass::Dangerous),
            ("1e date", CliClass::Dangerous),
            // 反向验证：删掉一个字符后结论必须翻转（区分度）。
            ("s/a/b", CliClass::Write),
        ] {
            assert_eq!(scan_sed_script(script), expected, "{script:?}");
        }
    }

    /// git（Q1 2026-10-24 裁决）：常用只读子命令族保持只读、三档免闸；全局 flag 白名单，
    /// 表外归写；只读子命令的 `--output` 归写。
    #[test]
    fn git_read_only_family_and_global_flag_whitelist() {
        for items in [
            vec!["git", "status"],
            vec!["git", "diff"],
            vec!["git", "log", "-1"],
            vec!["git", "show", "HEAD"],
            vec!["git", "blame", "a.md"],
            vec!["git", "rev-parse", "HEAD"],
            vec!["git", "ls-files"],
            vec!["git", "describe", "--tags"],
            vec!["git", "shortlog", "-sn"],
            vec!["git", "stash", "list"],
            vec!["git", "branch", "-a"],
            vec!["git", "tag", "-l"],
            vec!["git", "remote", "-v"],
            vec!["git", "--version"],
            // 白名单全局 flag：不改变只读结论。
            vec!["git", "--no-pager", "status"],
            vec!["git", "-P", "rev-parse", "HEAD"],
            vec!["git", "--no-optional-locks", "status"],
            vec!["git", "--no-replace-objects", "log", "-1"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{argv:?}");
        }
        for items in [
            // 表外全局 flag：配置注入或指向 vault 之外的仓库。
            vec!["git", "-C", "/tmp/other", "status"],
            vec!["git", "--git-dir=/tmp/x/.git", "diff"],
            vec!["git", "--git-dir", "/tmp/x/.git", "diff"],
            vec!["git", "--work-tree=/tmp/x", "status"],
            vec!["git", "-c", "diff.external=/tmp/x", "diff"],
            vec!["git", "-cdiff.external=/tmp/x", "diff"],
            vec!["git", "--config-env=diff.external=ENV", "diff"],
            vec!["git", "--exec-path=/tmp/x", "status"],
            vec!["git", "--bare", "status"],
            vec!["git", "--namespace=foo", "log"],
            // `-p` / `--paginate` 刻意不在白名单：分页器是 `core.pager` 指定的程序。
            vec!["git", "-p", "status"],
            vec!["git"],
            // 只读子命令的 argv 级写形态。
            vec!["git", "log", "--output=/tmp/x"],
            vec!["git", "log", "--output", "/tmp/x"],
            vec!["git", "diff", "--output=/tmp/v"],
            vec!["git", "show", "--output=/tmp/x", "HEAD"],
            vec!["git", "shortlog", "--output=/tmp/x", "-sn"],
            vec!["git", "blame", "--output=/tmp/x", "a.md"],
            // `--` 之后的同名参数（pathspec）也保守判写（design §2.4）。
            vec!["git", "log", "--", "--output"],
            // 写子命令仍按写分类。
            vec!["git", "commit", "-m", "x"],
            vec!["git", "push"],
            vec!["git", "add", "."],
            vec!["git", "checkout", "master"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
    }

    /// 危险黑名单的子命令识别必须穿透全局 flag：`git -C /tmp/x clean -fd` 在 `full_access`
    /// 档也不能免闸（否则「危险任何档都问」被一个全局 flag 绕开）。
    #[test]
    fn git_dangerous_hits_survive_global_flags() {
        for items in [
            vec!["git", "-C", "/tmp/x", "clean", "-fd"],
            vec!["git", "--git-dir=/tmp/x/.git", "clean", "-fd"],
            vec!["git", "-c", "x=y", "reset", "--hard"],
            vec!["git", "-P", "clean", "-n"],
            vec!["git", "reset", "--hard"],
            vec!["git", "clean", "-fd"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
    }

    /// 包装器继承（design §6.5）：sudo / xargs / 受限解包复用同一个 `classify_cli`，
    /// 被包装命令的写 / 执行形态自动继承。
    #[test]
    fn wrapper_recursion_inherits_new_forms() {
        for items in [
            vec!["sudo", "base64", "-o", "/tmp/x", "a.txt"],
            vec!["sudo", "sed", "-n", "w /tmp/x", "a.md"],
            vec!["xargs", "xxd", "in.bin", "out.hex"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Write, "{argv:?}");
        }
        for items in [
            vec!["xargs", "rg", "--pre", "/tmp/x", "needle"],
            vec!["bash", "-lc", "rg --pre /tmp/x needle ."],
            // `-z` 与只读子命令组合：整条仍须危险（不是写，更不是只读）。
            vec!["bash", "-lc", "rg -z needle a.txt.gz"],
            vec!["xargs", "rg", "--search-zip", "needle"],
            vec!["sudo", "sed", "s/a/b/e", "a.md"],
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
        // 对照正例：包装器内的只读成员不得误伤。
        assert_eq!(
            classify_cli(&argv(&["sudo", "base64", "-d", "a.txt"])),
            CliClass::ReadOnly
        );
        assert_eq!(
            classify_cli(&argv(&["bash", "-lc", "rg --no-search-zip needle ."])),
            CliClass::ReadOnly,
            "否定形态没有执行面，解包仍应放行"
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

    /// 新增写形态的目标提取（change readonly-allowlist-tightening-oct23 design §5）：
    /// vault 内写仍走重定向，而不是掉成普通写。
    #[test]
    fn write_target_extraction_for_new_forms() {
        assert_eq!(
            write_targets(&argv(&["base64", "-o", "notes/a.b64", "a.txt"])),
            vec!["notes/a.b64"]
        );
        assert_eq!(
            write_targets(&argv(&["base64", "--output=notes/a.b64", "a.txt"])),
            vec!["notes/a.b64"]
        );
        assert_eq!(
            write_targets(&argv(&["tree", "-o", "notes/tree.txt", "."])),
            vec!["notes/tree.txt"]
        );
        assert_eq!(
            write_targets(&argv(&["xxd", "in.bin", "notes/out.hex"])),
            vec!["notes/out.hex"]
        );
        assert_eq!(
            write_targets(&argv(&["xxd", "-r", "in.hex", "notes/out.bin"])),
            vec!["notes/out.bin"]
        );
        assert_eq!(
            write_targets(&argv(&["find", ".", "-fprint", "notes/list.txt"])),
            vec!["notes/list.txt"]
        );
        assert_eq!(
            write_targets(&argv(&["find", ".", "-fprintf", "notes/list.txt", "%p\\n"])),
            vec!["notes/list.txt"]
        );
        assert_eq!(
            write_targets(&argv(&["find", ".", "-fls", "notes/list.txt"])),
            vec!["notes/list.txt"]
        );
        assert_eq!(
            write_targets(&argv(&["git", "log", "--output=notes/out.txt"])),
            vec!["notes/out.txt"]
        );
        assert_eq!(
            write_targets(&argv(&["git", "diff", "--output", "notes/out.txt"])),
            vec!["notes/out.txt"]
        );
        // 就地写的短旗标簇与 `-e` 形态（旧读法在 `-e` 下会漏掉输入文件）。
        assert_eq!(
            write_targets(&argv(&["sed", "-ni", "s/a/b/", "notes/a.md"])),
            vec!["notes/a.md"]
        );
        assert_eq!(
            write_targets(&argv(&["sed", "-i", "-e", "s/a/b/", "notes/a.md"])),
            vec!["notes/a.md"]
        );
        // 反向：不含写形态时没有目标（不掉进重定向）。
        for items in [
            vec!["base64", "-d", "a.txt"],
            vec!["xxd", "in.bin"],
            vec!["tree", "-R", "."],
            vec!["find", ".", "-name", "*.md"],
            vec!["git", "commit", "--output=x"],
        ] {
            assert!(
                write_targets(&argv(&items)).is_empty(),
                "{items:?} 不应有写目标"
            );
        }
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
        // 相对路径、vault 内不存在、父目录也不存在 ⇒ **仍重定向**（change
        // add-harness-vault-workspace-list）：`cli_run` 的 cwd 就是 vault，根目录下的相对路径
        // 与 vault 内路径是同一件事，不再靠「父目录是否存在」猜归属。根下新文件 ⇒ `vault_create`。
        let cli = argv(&["touch", "build.sh"]);
        match decide(
            &p,
            "cli_run",
            "touch build.sh",
            &judge(&root, Some(cli.clone())),
        ) {
            Decision::Redirect(redirect) => {
                assert_eq!(redirect.targets, vec!["build.sh"]);
                assert_eq!(redirect.suggested_tool, Some("vault_create"));
            }
            other => panic!("根目录相对新文件应重定向，得到 {other:?}"),
        }
        // 相对路径指向 vault 内已存在目录下的新文件 ⇒ 重定向。
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

    /// 相对写目标的归属判定（change add-harness-vault-workspace-list design §4）：词法规则无条件
    /// 成立（相对且不含 `..` ⇒ vault 内，含根下新文件），symlink 否决只做安全收口。
    #[test]
    fn vault_relative_uses_lexical_rule_with_symlink_veto() {
        let root = fixture_root("vault-relative");
        // 相对：不存在也算 vault 内（根下新文件是旧实现漏掉的那一格）。
        assert_eq!(vault_relative(&root, "a.md"), Some("a.md".to_string()));
        assert_eq!(
            vault_relative(&root, "notes/new.md"),
            Some("notes/new.md".to_string())
        );
        assert_eq!(
            vault_relative(&root, "notes/a.md"),
            Some("notes/a.md".to_string())
        );
        // `..` 逃逸与根外绝对路径：不重定向。
        assert_eq!(vault_relative(&root, "../escape.md"), None);
        assert_eq!(vault_relative(&root, "notes/../../escape.md"), None);
        assert_eq!(vault_relative(&root, "/etc/hosts"), None);
        // 根自身 / 空路径：不是写目标。
        assert_eq!(vault_relative(&root, "."), None);
        assert_eq!(vault_relative(&root, "  "), None);
        // 根内绝对路径（含尚不存在的尾段）⇒ 相对载荷。
        let absolute = root.join("notes/a.md");
        assert_eq!(
            vault_relative(&root, &absolute.display().to_string()),
            Some("notes/a.md".to_string())
        );
        let absolute_new = root.join("newdir/x.md");
        assert_eq!(
            vault_relative(&root, &absolute_new.display().to_string()),
            Some("newdir/x.md".to_string())
        );
        // symlink 否决：目标自身指向根外、以及路径上的祖先指向根外，都不重定向。
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", root.join("outside-link.md")).unwrap();
            assert_eq!(vault_relative(&root, "outside-link.md"), None);
            std::os::unix::fs::symlink("/tmp", root.join("outside-dir")).unwrap();
            assert_eq!(vault_relative(&root, "outside-dir/new.md"), None);
            // 指向**根内**的符号链接不算逃逸：归属仍成立。
            std::os::unix::fs::symlink(root.join("notes"), root.join("inner-dir")).unwrap();
            assert_eq!(
                vault_relative(&root, "inner-dir/new.md"),
                Some("inner-dir/new.md".to_string())
            );
        }
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
        // 根目录下尚不存在的新文件（旧实现的存在性佐证会把它漏成普通写，full_access 下即放行）。
        let cli = argv(&["touch", "root-new.md"]);
        for mode in [
            PermissionMode::ReadOnly,
            PermissionMode::VaultWrite,
            PermissionMode::FullAccess,
        ] {
            let j = Judge {
                mode,
                ..judge(&root, Some(cli.clone()))
            };
            match decide(&p, "cli_run", "touch root-new.md", &j) {
                Decision::Redirect(redirect) => {
                    assert_eq!(redirect.targets, vec!["root-new.md"], "{mode:?}");
                    assert_eq!(redirect.suggested_tool, Some("vault_create"), "{mode:?}");
                }
                other => panic!("{mode:?} 下根目录新文件应重定向，得到 {other:?}"),
            }
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// 新增写形态的重定向（change readonly-allowlist-tightening-oct23 §5）：vault 内目标仍按
    /// 既有「写目标在 vault 内改道」条款处理，绝不掉成普通写；vault 外 / 无可提取目标落普通写。
    #[test]
    fn redirect_covers_new_write_forms() {
        let root = fixture_root("redirect-new-forms");
        let p = HarnessPermissions::default();
        // (argv, 期望 targets, 期望 suggested_tool)。
        let cases: Vec<(Vec<&str>, Vec<&str>, Option<&str>)> = vec![
            (
                vec!["base64", "-o", "notes/new.b64", "a.txt"],
                vec!["notes/new.b64"],
                Some("vault_create"),
            ),
            (
                vec!["base64", "--output=notes/a.md", "a.txt"],
                vec!["notes/a.md"],
                Some("vault_patch"),
            ),
            (
                vec!["tree", "-o", "notes/tree.txt", "."],
                vec!["notes/tree.txt"],
                Some("vault_create"),
            ),
            (
                vec!["xxd", "in.bin", "notes/out.hex"],
                vec!["notes/out.hex"],
                Some("vault_create"),
            ),
            (
                vec!["xxd", "-r", "in.hex", "notes/a.md"],
                vec!["notes/a.md"],
                Some("vault_patch"),
            ),
            (
                vec!["find", ".", "-name", "*.md", "-fprint", "notes/list.txt"],
                vec!["notes/list.txt"],
                Some("vault_create"),
            ),
            (
                vec!["git", "log", "--output=notes/out.txt"],
                vec!["notes/out.txt"],
                Some("vault_create"),
            ),
            (
                vec!["git", "diff", "--output", "notes/a.md"],
                vec!["notes/a.md"],
                Some("vault_patch"),
            ),
            (
                vec!["sed", "-ni", "s/a/b/", "notes/a.md"],
                vec!["notes/a.md"],
                Some("vault_patch"),
            ),
        ];
        for (items, expected_targets, expected_tool) in cases {
            let cli = argv(&items);
            match decide(&p, "cli_run", "x", &judge(&root, Some(cli))) {
                Decision::Redirect(redirect) => {
                    assert_eq!(redirect.targets, expected_targets, "{items:?}");
                    assert_eq!(redirect.suggested_tool, expected_tool, "{items:?}");
                }
                other => panic!("{items:?} 应重定向，得到 {other:?}"),
            }
        }
        // vault 外目标 ⇒ 不重定向，落正常写分类（vault_write 档逐个问）。
        for items in [
            vec!["base64", "-o", "/tmp/lumir-outside.b64", "a.txt"],
            vec!["xxd", "in.bin", "/tmp/lumir-outside.hex"],
            vec!["git", "log", "--output=/tmp/lumir-outside.txt"],
            // tree -R 无可提取目标（每层固定名 00Tree.html）⇒ 普通写。
            vec!["tree", "-R", "."],
            // file -C 写到 cwd 的固定名 magic.mgc ⇒ 普通写。
            vec!["file", "-C", "-m", "magic"],
        ] {
            let cli = argv(&items);
            assert_eq!(
                decide(&p, "cli_run", "x", &judge(&root, Some(cli))),
                Decision::Ask,
                "{items:?}"
            );
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// 跨档矩阵（design §6.3）：写形态按模式分层（`read_only` / `vault_write` → Ask、
    /// `full_access` → Allow）；执行形态三档全 Ask，且 allow 规则与会话缓存都绕不过。
    #[test]
    fn new_write_and_exec_forms_across_permission_modes() {
        let root = fixture_root("modes-new-forms");
        let p = HarnessPermissions::default();
        for items in [
            vec!["base64", "-o", "/tmp/lumir-x.b64", "a.txt"],
            vec!["sed", "-n", "w /tmp/lumir-x.txt", "a.md"],
            vec!["git", "log", "--output=/tmp/lumir-x.txt"],
        ] {
            for (mode, expected) in [
                (PermissionMode::ReadOnly, Decision::Ask),
                (PermissionMode::VaultWrite, Decision::Ask),
                (PermissionMode::FullAccess, Decision::Allow),
            ] {
                let j = Judge {
                    mode,
                    ..judge(&root, Some(argv(&items)))
                };
                assert_eq!(
                    decide(&p, "cli_run", "x", &j),
                    expected,
                    "{items:?} {mode:?}"
                );
            }
        }
        // 执行形态：任何档 + allow 规则 + 会话缓存都不解锁。
        let permissive = HarnessPermissions {
            allow: vec!["cli(*)".to_string(), "cli_run".to_string()],
            deny: Vec::new(),
        };
        for items in [
            vec!["rg", "--pre", "/tmp/lumir-pre.sh", "needle", "."],
            // `-z` 与 `--pre` 同族：full_access + allow 规则 + 缓存都不得解锁。
            vec!["rg", "-z", "needle", "a.txt.gz"],
            vec!["rg", "--search-zip", "needle", "a.txt.gz"],
            vec!["sed", "s/a/b/e", "a.md"],
        ] {
            for mode in [
                PermissionMode::ReadOnly,
                PermissionMode::VaultWrite,
                PermissionMode::FullAccess,
            ] {
                for cached in [false, true] {
                    let j = Judge {
                        mode,
                        cached,
                        ..judge(&root, Some(argv(&items)))
                    };
                    assert_eq!(
                        decide(&permissive, "cli_run", "x", &j),
                        Decision::Ask,
                        "{items:?} {mode:?} cached={cached}"
                    );
                }
            }
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// 载荷与说明逐字节钉死（含固定标记）；并做一次反向验证——改一个字符断言必红
    /// （REVIEW.md 「断言等价于子串」条：先造一个必须 FAIL 的输入）。
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
        let root = fixture_root("suggested");
        let no_targets: Vec<String> = Vec::new();
        let suggest = |items: &[&str]| suggested_tool(&argv(items), &root, &no_targets);
        assert_eq!(suggest(&["mv", "a", "b"]), Some("vault_move"));
        assert_eq!(suggest(&["cp", "a", "b"]), Some("vault_move"));
        assert_eq!(suggest(&["rm", "a"]), Some("vault_delete"));
        assert_eq!(suggest(&["rmdir", "a"]), Some("vault_delete"));
        assert_eq!(
            suggest(&["sed", "-i", "s/a/b/", "a.md"]),
            Some("vault_patch")
        );
        assert_eq!(suggest(&["touch", "notes/a.md"]), Some("vault_create"));
        // mkdir 重定向到 vault_create（M405 修订：vault_create 自动建父目录，不再有 mkdir 缺口）。
        assert_eq!(suggest(&["mkdir", "notes/x"]), Some("vault_create"));
        assert_eq!(suggest(&["tee", "a.md"]), Some("vault_patch"));
        assert_eq!(suggest(&["echo", "x", ">", "a.md"]), Some("vault_patch"));
        assert_eq!(suggest(&["cargo", "build"]), None);
        // 新增写形态（design §5）：目标已存在 ⇒ vault_patch，否则 vault_create。
        let existing = vec!["notes/a.md".to_string()];
        let fresh = vec!["notes/new.b64".to_string()];
        assert_eq!(
            suggested_tool(&argv(&["base64", "-o", "notes/a.md"]), &root, &existing),
            Some("vault_patch")
        );
        assert_eq!(
            suggested_tool(&argv(&["base64", "-o", "notes/new.b64"]), &root, &fresh),
            Some("vault_create")
        );
        assert_eq!(
            suggested_tool(
                &argv(&["git", "log", "--output=notes/a.md"]),
                &root,
                &existing
            ),
            Some("vault_patch")
        );
        assert_eq!(
            suggested_tool(
                &argv(&["find", ".", "-fprint", "notes/new.txt"]),
                &root,
                &fresh
            ),
            Some("vault_create")
        );
        std::fs::remove_dir_all(&root).ok();
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
        // 反向区分（REVIEW.md 「断言等价于子串」条）：修复前 `find . -exec ls {} \; -delete` 归 ReadOnly，
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
        // 区分度自证（REVIEW.md 「断言等价于子串」条）：旧实现（sudo/xargs 落「未知 ⇒ 写」）在本表上
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

    // -----------------------------------------------------------------------
    // 判定依据（M459，change add-approval-decision-reason）
    // -----------------------------------------------------------------------

    /// 层级映射真值表：四个变体各由哪一层产出、带什么载荷；自动放行的层一律 `None`。
    #[test]
    fn reason_mapping_covers_every_gated_layer() {
        let root = fixture_root("reason");
        let default = HarnessPermissions::default();

        // 第 1 层：deny 规则命中 → DenyRule（带命中的规则原文；多条命中取配置顺序里的第一条）。
        let p = perms(&[], &["cli(npm run deploy*)"]);
        let v = super::decide(
            &p,
            "cli_run",
            "npm run deploy --prod",
            &judge(&root, Some(argv(&["npm", "run", "deploy", "--prod"]))),
        );
        assert_eq!(v.decision, Decision::Deny);
        assert_eq!(
            v.reason,
            Some(DecisionReason::DenyRule {
                rule: "cli(npm run deploy*)".into()
            })
        );
        let p = perms(&[], &["cli(demo *)", "cli_run"]);
        let v = super::decide(&p, "cli_run", "demo x", &judge(&root, None));
        assert_eq!(
            v.reason,
            Some(DecisionReason::DenyRule {
                rule: "cli(demo *)".into()
            })
        );

        // 第 3 层：shell 包装器点名（Alex 2026-10-12 现场那一类）。样本必须**不可解包**——
        // 解包成立的只读形态根本不过闸（change harness-permission-rules-oct23 A2）。
        let v = super::decide(
            &default,
            "cli_run",
            "zsh -lc rm -rf /tmp/x",
            &judge(&root, Some(argv(&["zsh", "-lc", "rm -rf /tmp/x"]))),
        );
        assert_eq!(v.decision, Decision::Ask);
        assert_eq!(
            v.reason,
            Some(DecisionReason::DangerousWrapper {
                command: "zsh".into()
            })
        );
        // 绝对路径同样取 basename（`/bin/zsh` → `zsh`）。
        let v = super::decide(
            &default,
            "cli_run",
            "/bin/bash -c rm -rf /",
            &judge(&root, Some(argv(&["/bin/bash", "-c", "rm -rf /"]))),
        );
        assert_eq!(
            v.reason,
            Some(DecisionReason::DangerousWrapper {
                command: "bash".into()
            })
        );

        // 第 3 层其余成员：统一句、不点名（`sudo rm …` 的命中者是递归展开后的内层命令，
        // 外层 argv[0] 点名会写出错误主词）。
        for cli in [
            argv(&["rm", "-rf", "/tmp/x"]),
            argv(&["sudo", "rm", "-rf", "/tmp/x"]),
            argv(&["xargs", "rm"]),
            argv(&["git", "clean", "-fdx"]),
            argv(&["find", ".", "-exec", "rm", "{}", ";"]),
        ] {
            let subject = cli.join(" ");
            let v = super::decide(&default, "cli_run", &subject, &judge(&root, Some(cli)));
            assert_eq!(v.decision, Decision::Ask, "{subject}");
            assert_eq!(
                v.reason,
                Some(DecisionReason::DangerousCommand),
                "{subject}"
            );
        }

        // 第 5 层：模式默认分层带**当时判定的档位**（不是前端自己那份读数）。
        let v = super::decide(
            &default,
            "cli_run",
            "npm install",
            &judge(&root, Some(argv(&["npm", "install"]))),
        );
        assert_eq!(v.decision, Decision::Ask);
        assert_eq!(
            v.reason,
            Some(DecisionReason::ModeDefault {
                mode: PermissionMode::VaultWrite
            })
        );
        let v = super::decide(&default, "vault_delete", "a.md", &judge(&root, None));
        assert_eq!(
            v.reason,
            Some(DecisionReason::ModeDefault {
                mode: PermissionMode::VaultWrite
            })
        );
        let read_only = Judge {
            mode: PermissionMode::ReadOnly,
            ..judge(&root, None)
        };
        let v = super::decide(&default, "vault_patch", "a.md", &read_only);
        assert_eq!(v.decision, Decision::Ask);
        assert_eq!(
            v.reason,
            Some(DecisionReason::ModeDefault {
                mode: PermissionMode::ReadOnly
            })
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// 不变式（前端与错误文案共享的契约）：Ask 恒带**可上卡的三类依据**（MUST NOT 是 `DenyRule`）、
    /// Deny 恒带 `DenyRule`（规则原文，进回送文案）、自动放行的层（Allow / Redirect）恒不带依据。
    #[test]
    fn reason_presence_matches_the_decision() {
        let root = fixture_root("reason-invariant");
        let default = HarnessPermissions::default();
        let check = |p: &HarnessPermissions, tool: &str, subject: &str, j: &Judge<'_>| {
            let v = super::decide(p, tool, subject, j);
            let card_reason = matches!(
                v.reason.as_ref(),
                Some(DecisionReason::DangerousWrapper { .. })
                    | Some(DecisionReason::DangerousCommand)
                    | Some(DecisionReason::ModeDefault { .. })
            );
            match v.decision {
                Decision::Ask => assert!(
                    card_reason,
                    "{tool} {subject}: Ask 必须带可上卡的依据，实际 {:?}",
                    v.reason
                ),
                Decision::Deny => assert!(
                    matches!(v.reason.as_ref(), Some(DecisionReason::DenyRule { .. })),
                    "{tool} {subject}: Deny 必须带规则原文，实际 {:?}",
                    v.reason
                ),
                _ => assert!(
                    v.reason.is_none(),
                    "{tool} {subject}: 自动放行的层不该带依据，实际 {:?}",
                    v.reason
                ),
            }
        };
        // 自动放行的层：只读白名单、默认档写工具、allow 规则、缓存命中、vault 内写重定向。
        check(&default, "vault_read", "a.md", &judge(&root, None));
        check(&default, "vault_patch", "a.md", &judge(&root, None));
        check(
            &default,
            "cli_run",
            "ls -la",
            &judge(&root, Some(argv(&["ls", "-la"]))),
        );
        check(
            &default,
            "cli_run",
            "tee notes/a.md",
            &judge(&root, Some(argv(&["tee", "notes/a.md"]))),
        );
        check(
            &perms(&["vault_patch"], &[]),
            "vault_patch",
            "a.md",
            &judge(&root, None),
        );
        let cached = Judge {
            cached: true,
            ..judge(&root, Some(argv(&["npm", "install"])))
        };
        check(&default, "cli_run", "npm install", &cached);
        // 被拦下的层：deny 规则、危险黑名单、模式默认分层。
        check(
            &perms(&[], &["vault_patch"]),
            "vault_patch",
            "a.md",
            &judge(&root, None),
        );
        check(
            &default,
            "cli_run",
            "rm -rf /tmp/x",
            &judge(&root, Some(argv(&["rm", "-rf", "/tmp/x"]))),
        );
        check(
            &default,
            "cli_run",
            "npm install",
            &judge(&root, Some(argv(&["npm", "install"]))),
        );
        check(&default, "vault_delete", "a.md", &judge(&root, None));
        std::fs::remove_dir_all(&root).ok();
    }

    /// 危险类别真值表（M459 把 `is_dangerous` 改成 `dangerous_kind().is_some()` 的伴随断言）：
    /// 包装器与其余成员分得开，且 `is_dangerous` 的既有语义逐格不变。
    #[test]
    fn dangerous_kind_separates_wrappers_from_other_members() {
        let kind = |name: &str, args: &[&str]| dangerous_kind(name, &argv(args));
        for name in [
            "sh",
            "bash",
            "zsh",
            "dash",
            "fish",
            "csh",
            "ksh",
            "pwsh",
            "osascript",
            "eval",
        ] {
            assert_eq!(
                kind(name, &["-c", "x"]),
                Some(DangerousKind::Wrapper),
                "{name}"
            );
        }
        assert_eq!(kind("rm", &["-rf", "/tmp/x"]), Some(DangerousKind::Command));
        assert_eq!(kind("shutdown", &[]), Some(DangerousKind::Command));
        assert_eq!(kind("dd", &["if=x"]), Some(DangerousKind::Command));
        assert_eq!(kind("mkfs", &["/dev/x"]), Some(DangerousKind::Command));
        assert_eq!(kind("mkfs.ext4", &["/dev/x"]), Some(DangerousKind::Command));
        assert_eq!(kind("fdisk", &[]), Some(DangerousKind::Command));
        assert_eq!(
            kind("diskutil", &["eraseDisk"]),
            Some(DangerousKind::Command)
        );
        assert_eq!(
            kind("git", &["clean", "-fdx"]),
            Some(DangerousKind::Command)
        );
        assert_eq!(
            kind("git", &["reset", "--hard"]),
            Some(DangerousKind::Command)
        );
        // 非黑名单形态：破坏性形态之外的 diskutil / git 与普通命令都不入表。
        assert_eq!(kind("diskutil", &["list"]), None);
        assert_eq!(kind("git", &["reset", "--soft"]), None);
        assert_eq!(kind("git", &["status"]), None);
        assert_eq!(kind("ls", &["-la"]), None);
        // 单一真源（REVIEW.md 「同一语义两处真源」条）：`is_dangerous` 与类别判定同源。
        assert!(is_dangerous("zsh", &argv(&["-lc", "pwd"])));
        assert!(is_dangerous("git", &argv(&["reset", "--hard"])));
        assert!(!is_dangerous("git", &argv(&["reset", "--soft"])));
        assert!(!is_dangerous("ls", &argv(&["-la"])));
    }

    /// 调度工具的三档矩阵（change add-cron-conversational-registration design §6.1）：
    /// 3 工具 × 3 档逐格断言。区分度：把任意一格改错（如 `list` 在 `read_only` 档落到 Ask、
    /// 或 `create` 在 `vault_write` 档被放行）本用例必 FAIL。
    #[test]
    fn cron_tools_matrix_is_decision_per_mode() {
        let root = fixture_root("cron-matrix");
        let p = HarnessPermissions::default();
        for mode in [
            PermissionMode::ReadOnly,
            PermissionMode::VaultWrite,
            PermissionMode::FullAccess,
        ] {
            let j = Judge {
                mode,
                root: &root,
                argv: None,
                cached: false,
            };
            // list：读类，三档放行。
            assert_eq!(
                decide(&p, "cron_task_list", "", &j),
                Decision::Allow,
                "list 在 {mode:?} 档必须直接放行"
            );
            // create / remove：只读与默认档逐个问，full_access 放行。
            let expected = match mode {
                PermissionMode::FullAccess => Decision::Allow,
                PermissionMode::ReadOnly | PermissionMode::VaultWrite => Decision::Ask,
            };
            for tool in ["cron_task_create", "cron_task_remove"] {
                assert_eq!(
                    decide(&p, tool, "daily-log 21:00 mon,tue", &j),
                    expected,
                    "{tool} 在 {mode:?} 档的档位不符"
                );
            }
        }
        std::fs::remove_dir_all(&root).ok();
    }

    /// 序列化形状：internally tagged 的 `kind` + snake_case（前端按 `kind` 取文案，事件与快照
    /// 两条通道同吃这一份 serde 定义）。
    #[test]
    fn reason_serializes_with_snake_case_kind_tag() {
        let json = |reason: &DecisionReason| serde_json::to_value(reason).unwrap();
        assert_eq!(
            json(&DecisionReason::DangerousWrapper {
                command: "zsh".into()
            }),
            serde_json::json!({"kind": "dangerous_wrapper", "command": "zsh"})
        );
        assert_eq!(
            json(&DecisionReason::DangerousCommand),
            serde_json::json!({"kind": "dangerous_command"})
        );
        assert_eq!(
            json(&DecisionReason::ModeDefault {
                mode: PermissionMode::VaultWrite
            }),
            serde_json::json!({"kind": "mode_default", "mode": "vault_write"})
        );
        assert_eq!(
            json(&DecisionReason::DenyRule {
                rule: "cli(npm run deploy*)".into()
            }),
            serde_json::json!({"kind": "deny_rule", "rule": "cli(npm run deploy*)"})
        );
    }

    // -----------------------------------------------------------------------
    // shell 包装器受限解包（change harness-permission-rules-oct23 A2 / design §2.6）
    // -----------------------------------------------------------------------

    /// 正例表（design §2.6 第一张表逐行）：全部子命令只读 + 安全分隔符 / 重定向 ⇒ 只读。
    #[test]
    fn unpacked_read_only_scripts_are_read_only() {
        for script in [
            // Alex 的原现场：分号 + /dev/null 丢弃 + 管道。
            "ls -la 2>/dev/null; echo ---; ls docs | tail -5",
            "cat a.md >/dev/null",
            "rg foo notes | head -20 2>&1",
            "git status",
            "git diff --stat",
            // 嵌套恰好 2 层。
            "bash -c \"ls\"",
            // 双引号内的空格按字面并入同一词。
            "echo \"hello world\"",
            // `&&` / `||` 与四种白名单重定向。
            "ls && echo ok || echo fail",
            "ls 1>/dev/null",
            "ls 2>&1 | tail -1",
        ] {
            let argv = argv(&["bash", "-lc", script]);
            assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{script}");
        }
        // 四种 wrapper 名 × 三种 flag 形态（`-c` / `-lc` / `-cl`）。
        for wrapper in ["sh", "bash", "zsh", "dash"] {
            for flag in ["-c", "-lc", "-cl"] {
                let argv = argv(&[wrapper, flag, "ls -la"]);
                assert_eq!(classify_cli(&argv), CliClass::ReadOnly, "{wrapper} {flag}");
            }
        }
    }

    /// 反例表（design §2.6 第二张表逐行）：任何一条失败判据都维持**危险**（不是写）。
    #[test]
    fn unpack_failures_stay_dangerous() {
        // 形态判据不满足：脚本文件 / 多重 flag / 多余参数 / 裸包装器 / 非名单包装器。
        for items in [
            vec!["bash", "script.sh"],
            vec!["bash", "-x", "-c", "ls"],
            vec!["bash", "-lc", "ls", "extra"],
            vec!["bash"],
            vec!["bash", "-c"],
            vec!["fish", "-c", "ls"],
            vec!["pwsh", "-c", "ls"],
            vec!["osascript", "-e", "ls"],
            vec!["bash", "-lc", "ls", "-la"], // 两个脚本参数：argc 不合约
        ] {
            let argv: Vec<String> = items.iter().map(|s| s.to_string()).collect();
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{argv:?}");
        }
        // 脚本词法 / 子命令判定失败。
        for script in [
            "ls; rm -rf /tmp/x",
            "mkdir x",
            "ls > notes/a.md",
            "ls >> notes/a.md",
            "cat < /etc/passwd",
            "ls $(rm -rf /)",
            "echo $HOME",
            "echo `id`",
            "ls & rm x",
            "ls\nrm -rf /",
        ] {
            let argv = argv(&["sh", "-c", script]);
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{script}");
        }
        // 反向对照：合法多命令脚本仍是只读（防止本表退化成「见到 `;` 就危险」）。
        assert_eq!(
            classify_cli(&argv(&["sh", "-c", "ls; ls"])),
            CliClass::ReadOnly
        );
        for script in [
            "cd docs && ls",
            "ls | xargs rm",
            "bash -c \"bash -c 'ls'\"",
            "ls 2>/dev/null2",
            "ls >/dev/null2",
            "ls 2>&1&",
            "()",
            "{}",
            "ls \\; rm x",
            "",
            ";",
            "ls;",
            ">/dev/null",
        ] {
            let argv = argv(&["bash", "-lc", script]);
            assert_eq!(classify_cli(&argv), CliClass::Dangerous, "{script}");
        }
        // 子命令数 > 16 / 脚本 > 4096 字节。
        let many = vec!["ls"; 17].join("; ");
        assert_eq!(
            classify_cli(&argv(&["bash", "-lc", &many])),
            CliClass::Dangerous,
            "子命令数超上限"
        );
        let huge = format!("echo {}", "a".repeat(5000));
        assert_eq!(
            classify_cli(&argv(&["bash", "-lc", &huge])),
            CliClass::Dangerous,
            "脚本超字节上限"
        );
    }

    /// 反向验证（REVIEW.md「断言等价于子串」条）：每条放宽只差一个字符就必须变红——
    /// 证明只读结论不是靠子串巧合。
    #[test]
    fn unpack_relaxation_is_character_sensitive() {
        let positives = [
            "ls -la 2>/dev/null; echo ---; ls docs | tail -5",
            "rg foo notes | head -20 2>&1",
            "cat a.md >/dev/null",
        ];
        for script in positives {
            assert_eq!(
                classify_cli(&argv(&["bash", "-lc", script])),
                CliClass::ReadOnly,
                "{script}"
            );
        }
        // 把 `;` 改 `&`（后台）、`|` 改 `&`、白名单重定向改非法重定向、只读命令名改未知命令。
        for script in [
            "ls -la 2>/dev/null & echo ---; ls docs | tail -5",
            "rg foo notes & head -20 2>&1",
            "cat a.md >>/dev/null",
            "cat a.md >/dev/nullx",
            "ls2 -la 2>/dev/null; echo ---; ls docs | tail -5",
        ] {
            assert_eq!(
                classify_cli(&argv(&["bash", "-lc", script])),
                CliClass::Dangerous,
                "{script}"
            );
        }
    }

    /// 判定级（design §2.6 末段 / tasks 1.6）：解包失败样本在 `full_access` 档仍产 Ask；
    /// 解包成功样本在 `vault_write` 档直接 Allow 且不产判定依据。
    #[test]
    fn unpack_decisions_respect_the_layer_order() {
        let root = fixture_root("unpack-decisions");
        let p = HarnessPermissions::default();
        for script in [
            "mkdir x",           // 非只读子命令：维持危险，MUST NOT 降为写
            "ls; rm -rf /tmp/x", // 混合脚本
        ] {
            let call = argv(&["bash", "-lc", script]);
            let j = Judge {
                mode: PermissionMode::FullAccess,
                root: &root,
                argv: Some(call.clone()),
                cached: false,
            };
            let verdict = super::decide(&p, "cli_run", &call.join(" "), &j);
            assert_eq!(verdict.decision, Decision::Ask, "{script}");
            assert!(
                matches!(
                    verdict.reason,
                    Some(DecisionReason::DangerousWrapper { .. })
                ),
                "{script}"
            );
        }
        let script = "ls -la 2>/dev/null; echo ---; ls docs | tail -5";
        let call = argv(&["bash", "-lc", script]);
        let j = Judge {
            mode: PermissionMode::VaultWrite,
            root: &root,
            argv: Some(call.clone()),
            cached: false,
        };
        let verdict = super::decide(&p, "cli_run", &call.join(" "), &j);
        assert_eq!(verdict.decision, Decision::Allow);
        assert!(verdict.reason.is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    // -----------------------------------------------------------------------
    // 前缀生成器与规则等值容差（change harness-permission-rules-oct23 A1 / A3）
    // -----------------------------------------------------------------------

    fn actions(tool: &str, call: Option<&[&str]>, subject: &str) -> Option<PermissionActions> {
        let call = call.map(argv);
        permission_prefix(tool, call.as_deref(), subject)
    }

    #[test]
    fn permission_prefix_covers_cli_and_vault_tools() {
        // cli_run：两词前缀（命令 + 首个非 flag 参数）。
        let a = actions(
            "cli_run",
            Some(&["tvly", "search", "prompt caching"]),
            "tvly search prompt caching",
        )
        .unwrap();
        assert_eq!(a.remember_label, "tvly search");
        assert_eq!(a.remember_key, "tvly search ");
        assert_eq!(a.rule.as_deref(), Some("cli(tvly search *)"));
        // 第二词是 flag ⇒ 退化为单词前缀（按钮上显示的就是实际更宽的授权面）。
        let a = actions("cli_run", Some(&["npm", "--version"]), "npm --version").unwrap();
        assert_eq!(a.remember_label, "npm");
        assert_eq!(a.rule.as_deref(), Some("cli(npm *)"));
        // 无第二词同理。
        let a = actions("cli_run", Some(&["pwd"]), "pwd").unwrap();
        assert_eq!(a.rule.as_deref(), Some("cli(pwd *)"));
        // 空命令 / 无 argv ⇒ 不给次级动作。
        assert!(actions("cli_run", Some(&[]), "").is_none());
        assert!(actions("cli_run", None, "tvly search x").is_none());
        // 含换行的前缀无法安全表达 ⇒ 不给（退化为多问一次，不误放行）。
        assert!(actions("cli_run", Some(&["a\nb", "x"]), "a\nb x").is_none());

        // vault 写工具：目录段前缀 / 根级精确。
        let a = actions("vault_patch", None, "notes/a.md").unwrap();
        assert_eq!(a.remember_key, "notes/a.md");
        assert_eq!(a.rule.as_deref(), Some("vault_patch(notes/*)"));
        let a = actions("vault_move", None, "docs/2026/x.md").unwrap();
        assert_eq!(a.rule.as_deref(), Some("vault_move(docs/2026/*)"));
        let a = actions("vault_create", None, "a.md").unwrap();
        assert_eq!(a.remember_key, "a.md");
        assert_eq!(a.rule.as_deref(), Some("vault_create(a.md)"));
        // 空路径 ⇒ 不给。
        assert!(actions("vault_patch", None, "  ").is_none());

        // vault_delete / 调度工具：有会话记忆、无持久规则（Q7 裁决）。
        for tool in ["vault_delete", "cron_task_create", "cron_task_remove"] {
            let a = actions(tool, None, "notes/a.md").unwrap();
            assert_eq!(a.remember_key, "notes/a.md");
            assert_eq!(a.rule, None, "{tool}");
        }
        // 读类工具永不过闸 ⇒ 没有次级动作可派。
        assert!(actions("vault_read", None, "a.md").is_none());
    }

    #[test]
    fn generated_rules_actually_match_their_family() {
        let root = fixture_root("generated-rules");
        let cli = actions("cli_run", Some(&["tvly", "search", "x"]), "tvly search x").unwrap();
        let p = perms(&[cli.rule.as_deref().unwrap()], &[]);
        // 同类另一条查询：命中。
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tvly search 另一个问题",
                &judge(&root, Some(argv(&["tvly", "search", "另一个问题"])))
            ),
            Decision::Allow
        );
        // 无参数的等值形态：命中（Q2 容差）。
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tvly search",
                &judge(&root, Some(argv(&["tvly", "search"])))
            ),
            Decision::Allow
        );
        // 不同子命令：不命中（vault_write 档 ⇒ 逐个问）。
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tvly save x",
                &judge(&root, Some(argv(&["tvly", "save", "x"])))
            ),
            Decision::Ask
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// Q2 等值容差只到「完全相等」为止：词边界不放宽。
    #[test]
    fn rule_equality_tolerance_respects_word_boundary() {
        let root = fixture_root("eq-tolerance");
        let p = perms(&["cli(git push *)"], &[]);
        for (subject, call, expected) in [
            ("git push", vec!["git", "push"], Decision::Allow),
            (
                "git push origin main",
                vec!["git", "push", "origin", "main"],
                Decision::Allow,
            ),
            ("git pushx", vec!["git", "pushx"], Decision::Ask),
            ("git pushx y", vec!["git", "pushx", "y"], Decision::Ask),
        ] {
            assert_eq!(
                decide(&p, "cli_run", subject, &judge(&root, Some(argv(&call)))),
                expected,
                "{subject}"
            );
        }
        // 星号前无空格的手写形态保持既有裸前缀语义（本 change 不改）。
        let p = perms(&["cli(tvly*)"], &[]);
        assert_eq!(
            decide(
                &p,
                "cli_run",
                "tvlyx",
                &judge(&root, Some(argv(&["tvlyx"])))
            ),
            Decision::Allow
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
