//! 工具集（design §4）：**9 件 vault 操作工具 + 1 件编排工具 + 3 件调度工具**——vault_read /
//! vault_search / vault_list / vault_patch / vault_create / vault_move / vault_delete / skill_load /
//! cli_run，
//! 外加 `task`（子代理委派；change add-harness-subagents，ADR 0007 Decision 7 的「编排工具」一类）
//! 与 `cron_task_create` / `cron_task_list` / `cron_task_remove`（change
//! add-cron-conversational-registration，ADR 0007 Decision 7 的「调度工具」一类）。
//! `task` 不在 [`TOOL_NAMES`] 里：它不是 vault 操作、不走 `execute` 的 vault 工具注册表，也
//! 不受「写且需防护」判据约束。清单外扩张须经 Alex 裁决（ADR 0007）；本次扩张（vault_move /
//! vault_delete）即 change add-harness-permission-modes 的 Alex 节点 1 裁决。
//!
//! 三件调度工具另立 [`CRON_TOOL_NAMES`]，且**只在交互发送路径注册**（`run::SessionContext` 在
//! `tool_policy = None` 时追加、经 [`ToolContext::cron`] 执行）：无人值守运行与子运行天然看不见
//! 它们——「定时运行不能给自己排新任务、子代理不能排任务」由既有机制表达，不是新增开关。
//!
//! 执行层抽象（ADR 0007 Decision 3 留口）：「工具名 + JSON 参数 → JSON 结果」注册表——
//! [`execute`] 就是这个形状的唯一入口，未来 headless CLI 后端翻译成同一中间表示即可。
//!
//! 结果信封：成功 `{"ok": true, …}`；失败 `{"ok": false, "code": "…", "message": "…"}`
//! （失败**带原因回送模型**，模型据错误信息调整后重试——design §4 错误口径）。
//! 截断一律显式标 `"truncated": true`，MUST NOT 静默截断。
//!
//! cli_run 的 `purpose`（用途说明，change add-harness-permission-modes，design §3.4）是
//! schema 必填字段：模型发起调用时用一句人话自述这条命令干什么，批准卡在命令上方展示它。
//! 它是**阅读辅助、不是安全判据**——权限判定的每一层只看 argv 本身（`permissions.rs`）。
//!
//! cli_run 子进程的 PATH（change harness-cli-login-shell-path）：会话内首次调用时经用户登录
//! shell 解析一份完整 PATH、缓存并注入子进程，让裸命令（如装在 `~/.local/bin` 的 CLI）无需
//! `zsh -lc` 包裹即可被找到；解析失败回退继承 app 的 PATH。它只影响「能否找到命令」，
//! MUST NOT 影响「命令是否被放行」——权限判定照旧只看 argv（`permissions.rs`）。
//!
//! cli_run 子进程的工作目录（change add-harness-vault-workspace-list）：每次 spawn 单独设
//! `current_dir` 为当前 vault 并同步 `PWD`，不改主进程 cwd、不提供模型可填的 `cwd` 参数。

use std::io::Read;
use std::path::{Component, Path};
use std::process::Stdio;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::cron;
use crate::fs_io::{self, IgnorePolicy, PatchEdit};
use crate::logging;

use super::agents::AgentCatalog;
use super::context::SkillEntry;
use super::diff;
/// 工具执行上下文（vault 作用域 + 会话建立时快照的 Skill 清单 + 调度工具端口）。
pub struct ToolContext<'a> {
    pub root: &'a Path,
    pub policy: &'a IgnorePolicy,
    pub skills: &'a [SkillEntry],
    /// 调度工具端口（change add-cron-conversational-registration）：**只有交互发送路径**注入
    /// （`SessionContext::cron_port` 在交接契约槽位返回 `None`）。`None` 时三件调度工具对这个
    /// 运行而言就是清单外的工具名——可见面与可执行面由同一个判据控制。
    pub cron: Option<&'a dyn cron::CronPort>,
}

/// 批准预览（ask 档 approval_request 事件的载荷来源）。
pub struct ApprovalPreview {
    /// 写工具的 unified diff（vault_patch / vault_create）。
    pub diff: Option<String>,
    /// CLI 的完整 argv（cli_run）；vault_move / vault_delete 的路径清单
    /// （vault_move = `[源, 目标]`，vault_delete = `[路径]`）——design §5.1 的
    /// 「源 → 目标路径对」/「路径 + 移入废纸篓可恢复」在批准卡上的呈现由面板侧负责。
    pub argv: Option<Vec<String>>,
    /// vault_patch 的预览基准 revision（批准执行时作 expected_revision 走 CAS——
    /// 批准窗内文件被改即 document_conflict，落盘不与已批准 diff 分叉）。
    pub revision: Option<String>,
    /// cli_run 的用途说明（design §3.4）：批准卡在命令上方展示它（命令原文仍完整可见）。
    /// 事件层的载荷键名即 `purpose`（turn.rs 注入），前端有则显示、无则回落现状。
    pub purpose: Option<String>,
    /// 定时任务预览（cron_task_create / cron_task_remove，change
    /// add-cron-conversational-registration design §6.3）：五要素的待批准快照。
    /// 事件载荷键 `cron_task`；`prompt` 全文只出现在这里（不进诊断日志）。
    pub cron_task: Option<serde_json::Value>,
}

impl ApprovalPreview {
    fn empty() -> Self {
        Self {
            diff: None,
            argv: None,
            revision: None,
            purpose: None,
            cron_task: None,
        }
    }
}

/// 工具结果（信封见模块文档）。
#[derive(Debug)]
pub struct ToolOutput {
    pub value: serde_json::Value,
}

impl ToolOutput {
    pub fn ok(value: serde_json::Value) -> Self {
        let mut value = value;
        value["ok"] = serde_json::json!(true);
        Self { value }
    }

    pub fn err(code: &str, message: impl Into<String>) -> Self {
        Self {
            value: serde_json::json!({
                "ok": false,
                "code": code,
                "message": message.into(),
            }),
        }
    }

    pub fn from_command_error(e: &crate::commands::CommandError) -> Self {
        Self::err(&e.code, e.message.clone())
    }

    pub fn succeeded(&self) -> bool {
        self.value.get("ok").and_then(|v| v.as_bool()) == Some(true)
    }
}

/// 9 个 vault 操作工具的名字表（恰好清单；execute 的 match 以此为准）。
/// `vault_list` 自 change `add-harness-vault-workspace-list` 起入册（ADR 0007 Decision 7 第三次
/// 修订）：目录 / 路径发现是核心任务链的入口，不是「读操作所以不建工具」的收窄面。
pub const TOOL_NAMES: [&str; 9] = [
    "vault_read",
    "vault_search",
    "vault_list",
    "vault_patch",
    "vault_create",
    "vault_move",
    "vault_delete",
    "skill_load",
    "cli_run",
];

/// 3 件调度工具的名字表（change add-cron-conversational-registration design §2.1）：**只在交互
/// 发送路径注册**（`run::SessionContext::tool_definitions`）。`TOOL_NAMES` 保持 9 件不变——cron
/// 交接的工具白名单与子运行定义白名单都以它为界，三件调度工具因此拿不到无人值守运行与子运行。
pub const CRON_TOOL_NAMES: [&str; 3] = ["cron_task_create", "cron_task_list", "cron_task_remove"];

/// Responses API function tools 定义（`type: "function"`，JSON Schema parameters）。
/// deepseek 兼容表：`function` 类型支持，其余 type 被忽略——只发这一种。
pub fn definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "name": "vault_read",
            "description": "读取 vault 内文本文件。offset/limit 为 1 -based 行号窗口（可翻页读大文件）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "vault 相对路径"},
                    "offset": {"type": "integer", "description": "起始行（1-based）"},
                    "limit": {"type": "integer", "description": "最多读取行数"}
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_search",
            "description": "在 vault 内做大小写不敏感子串搜索（query 不是正则）。尊重忽略规则表；只搜可见文本文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "path_glob": {"type": "string", "description": "可选路径过滤，* 匹配任意字符（含 /），? 匹配单个字符"}
                },
                "required": ["query"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_list",
            "description": "列出 vault 内目录内容（目录 / 路径发现）。默认只列一层；recursive 才下钻。返回 path 与 kind=file|directory，按 path 升序分页（limit / cursor / truncated / next_cursor）。可见性与文件树同源：hidden 条目不出现、lazy 子树只出一行不展开（0 条既可能是空目录，也可能是被忽略规则过滤）。不返回正文，也不返回大小、修改时间、权限；需要这些元数据、隐藏项、多目标路径或 vault 外路径时用 cli_run。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "vault 相对目录，缺省 vault 根"},
                    "recursive": {"type": "boolean", "description": "true = 递归下钻；缺省只列一层"},
                    "path_glob": {"type": "string", "description": "可选路径过滤，* 匹配任意字符（含 /），? 匹配单个字符"},
                    "limit": {"type": "integer", "description": "本页最多条数（缺省 200，上限 1000；小于 1 按 1）"},
                    "cursor": {"type": "string", "description": "上一页返回的 next_cursor"}
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_patch",
            "description": "对既有文档做局部替换：每个 old_string 必须恰好命中一次（0 次或多次都会报错，按报错重试）。工具集中不存在整文件写。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "edits": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "old_string": {"type": "string"},
                                "new_string": {"type": "string"}
                            },
                            "required": ["old_string", "new_string"]
                        }
                    }
                },
                "required": ["path", "edits"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_create",
            "description": "新建文档（不会覆盖同名文件；父目录不存在时会自动建出）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_move",
            "description": "移动 / 重命名 vault 内条目（可跨目录；不会覆盖既有条目；目标父目录必须已存在）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "vault 相对路径（源）"},
                    "new_path": {"type": "string", "description": "vault 相对路径（目标，含新末段名）"}
                },
                "required": ["path", "new_path"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "vault_delete",
            "description": "删除 vault 内条目：移入系统废纸篓（可经 Finder 恢复），不提供永久删除。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "vault 相对路径"}
                },
                "required": ["path"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "skill_load",
            "description": "按名加载 Skill 全文（默认 SKILL.md；file 限定在该 Skill 目录内）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "file": {"type": "string", "description": "Skill 目录内的相对文件，默认 SKILL.md"}
                },
                "required": ["name"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "cli_run",
            "description": "执行命令行工具（argv 直传，无 shell 展开；默认需用户批准）。默认 60 秒超时，输出截断会标注。写 vault 内路径会被闸门改道到 vault 工具（vault_patch / vault_create / vault_move / vault_delete），不要用 cli_run 写 vault。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "args": {"type": "array", "items": {"type": "string"}},
                    "purpose": {"type": "string", "description": "一句人话说明这条命令是干什么的（用户批准时先看它，再核对命令原文）"}
                },
                "required": ["command", "purpose"]
            }
        }),
    ]
}

/// 三件调度工具的定义（change add-cron-conversational-registration design §2.3）。
///
/// 参数与 `[cron].tasks` 的字段一一对应：`create` 取 `id` / `at` / `prompt`（必填）与 `days` /
/// `vault` / `delivery` / `session` / `model`（可选，缺省同配置口径）；`list` 无参；`remove`
/// 取 `id`。`prompt` 的「自包含」无法机器判定，写在 description 里、归抽样观察。
pub fn cron_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "type": "function",
            "name": "cron_task_create",
            "description": "在 Lumir 里注册一条定时任务（只在 Lumir 运行时触发；不要另建系统级调度）。prompt 必须自包含：到点运行时是一个新会话，看不到当前这段对话。缺省触达策略 notify-then-run（到点只通知，用户点击才运行）。注册前先 cron_task_list 查重；改任务 = cron_task_remove + cron_task_create。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "任务身份：非空、不含空白、不得与既有任务重名；同时是通知标题"},
                    "at": {"type": "string", "description": "本地时间 HH:MM（00:00–23:59）"},
                    "prompt": {"type": "string", "description": "自包含的自然语言载荷：做什么、在哪个目录、产出放哪、不要做什么"},
                    "days": {"type": "array", "items": {"type": "string"}, "description": "可选，mon/tue/wed/thu/fri/sat/sun 的非空子集；缺省全周"},
                    "vault": {"type": "string", "description": "可选，目标 vault 的绝对路径；缺省当前 vault"},
                    "delivery": {"type": "string", "description": "可选：notify-then-run（缺省）/ run-then-notify / silent-run"},
                    "session": {"type": "string", "description": "可选：new（缺省）/ dedicated（每任务一个专用会话，后续触发续写）"},
                    "model": {"type": "string", "description": "可选，运行期模型 id 覆盖"}
                },
                "required": ["id", "at", "prompt"]
            }
        }),
        serde_json::json!({
            "type": "function",
            "name": "cron_task_list",
            "description": "列出本机已注册的定时任务与最近一次触发日（last_fired；无记录为 null）。只读，不修改任何文件。",
            "parameters": {"type": "object", "properties": {}}
        }),
        serde_json::json!({
            "type": "function",
            "name": "cron_task_remove",
            "description": "删除一条定时任务：删除后不再触发。id 不存在时返回错误。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "任务身份"}
                },
                "required": ["id"]
            }
        }),
    ]
}

/// 编排工具 `task` 的定义（change add-harness-subagents design §5.1；它在 9 件 vault 工具之后追加，
/// 是交互注册表的第 10 件）：工具集与三闸值不在
/// 调用参数里（它们是定义字段）；`model` / `background` 是仅有的两个调用级覆盖项。
///
/// 可用子代理清单来自 [`AgentCatalog::listing`]（名字 + 描述），MUST NOT 截断；超容量时由装载
/// 期产 warning + 诊断事件，清单本体照常完整注入。执行入口归 §3（M588），本批次只注册描述。
pub fn task_definition(catalog: &AgentCatalog) -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "name": "task",
        "description": format!(
            "把任务委派给一个子代理：子代理有独立上下文，只把摘要返回；不能再次委派；需要批准的调用会弹给用户。可用子代理：\n{}",
            catalog.listing()
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent": {"type": "string", "description": "子代理定义名（见本工具描述里的清单）"},
                "prompt": {"type": "string", "description": "自包含的任务说明：目标、范围、输出形态（结论 + 依据 + 不确定项）"},
                "description": {"type": "string", "description": "一句话任务标签，显示在工具行与诊断里"},
                "model": {"type": "string", "description": "可选，调用级模型覆盖；缺省用定义里的 model，再缺省 inherit"},
                "resume": {"type": "string", "description": "可选，run_id；在同一子代理会话上继续（通常用于续跑 partial 结果）"},
                "background": {"type": "boolean", "description": "可选，true = 后台运行：本调用立即返回 running，结果稍后以自动化通知进入会话；定义 background: true 时强制后台"}
            },
            "required": ["agent", "prompt", "description"]
        }
    })
}

/// 注册条件：定义快照非空时追加 `task`（内建 `explore` 使清单在 `enabled=true` 时恒非空）。
/// `[harness.subagents].enabled=false` 的关闭点仍是 `run::gate_tool_definitions`——这里不复制
/// 一份开关判定（单一关闭点，见该函数的注释）。
pub fn definitions_with_subagents(catalog: &AgentCatalog) -> Vec<serde_json::Value> {
    let mut definitions = definitions();
    if !catalog.definitions().is_empty() {
        definitions.push(task_definition(catalog));
    }
    definitions
}

/// 子运行结果摘要的字符上限（change add-harness-subagents design §5.2：经验初值，与
/// `cli_run` 单侧 10,000 字符同量级）。超出取头尾各一半、中间显式标 `…[截断]`。
pub const TASK_SUMMARY_LIMIT: usize = 8_000;

/// 结果信封的摘要截断：返回 `(文本, 是否截断)`。MUST NOT 静默截断——`truncated` 字段
/// 跟着信封回给父模型。
pub fn truncate_task_summary(text: &str) -> (String, bool) {
    let count = text.chars().count();
    if count <= TASK_SUMMARY_LIMIT {
        return (text.to_string(), false);
    }
    let head_len = TASK_SUMMARY_LIMIT / 2;
    let tail_len = TASK_SUMMARY_LIMIT - head_len;
    let head: String = text.chars().take(head_len).collect();
    let tail: String = text.chars().skip(count.saturating_sub(tail_len)).collect();
    (format!("{head}…[截断]…{tail}"), true)
}

/// cli_run 的 argv（command + args）：分类器 / 写目标提取的输入，也是主体串的来源
/// （单一真源——argv 只在这一处从 JSON 参数里取出，判定层与分类层不各解析一遍）。
pub fn cli_argv(args: &serde_json::Value) -> Vec<String> {
    let mut argv = Vec::new();
    if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
        argv.push(command.to_string());
    }
    if let Some(items) = args.get("args").and_then(|v| v.as_array()) {
        argv.extend(
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string),
        );
    }
    argv
}

/// 权限判定的主体串：cli = 拼接 argv；vault_* = 路径参数；skill_load = 技能名；
/// vault_search = path_glob（无则 query）；调度工具 = `id + at + days`。
///
/// 调度工具**不含 `prompt`**（change add-cron-conversational-registration design §6.2）：主体串会
/// 进缓存键、批准事件与诊断（日志字段有 256 字符上限），prompt 可能含用户的私密内容。`id + at +
/// days` 是用户对「同一条任务」最容易复述的判据；改 prompt 而时间不变时缓存放行是刻意的。
/// `cron_task_list` 走 `_` 分支（空串，读类工具的既有形态）。
pub fn permission_subject(name: &str, args: &serde_json::Value) -> String {
    match name {
        "cli_run" => cli_argv(args)
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
        "skill_load" => args
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "vault_search" => args
            .get("path_glob")
            .and_then(|v| v.as_str())
            .or_else(|| args.get("query").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        // vault_list（change add-harness-vault-workspace-list）：与 vault_search 同口径——有
        // path_glob 时它是限制面，否则取目录 path（根目录 = 空串）。只读工具，主体串只服务
        // deny 规则的定位。
        "vault_list" => args
            .get("path_glob")
            .and_then(|v| v.as_str())
            .or_else(|| args.get("path").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string(),
        "cron_task_create" | "cron_task_remove" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let at = args.get("at").and_then(|v| v.as_str()).unwrap_or("");
            let days = args
                .get("days")
                .and_then(|v| v.as_array())
                .map(|items| join_days(items))
                .unwrap_or_default();
            format!("{id} {at} {days}")
        }
        _ => args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

/// `days` 数组 → 规范化串（非字符串元素丢弃；规范化交给 `permission_cache::normalize_subject`）。
fn join_days(items: &[serde_json::Value]) -> String {
    items
        .iter()
        .filter_map(|item| item.as_str())
        .collect::<Vec<_>>()
        .join(",")
}

/// 注册表入口：工具名 + JSON 参数 → JSON 结果。
pub fn execute(name: &str, args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    execute_with_revision(name, args, ctx, None)
}

/// 批准执行入口：写工具带预览基准 revision 走（ask 档采纳后的 CAS 基准；None = 直执行，
/// revision 取执行时刻当前值——allow 档无批准窗，CAS 只守微窗口）。
pub fn execute_with_revision(
    name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
    revision: Option<&str>,
) -> ToolOutput {
    match name {
        "vault_read" => vault_read(args, ctx),
        "vault_search" => vault_search(args, ctx),
        "vault_list" => vault_list(args, ctx),
        "vault_patch" => vault_patch(args, ctx, revision),
        "vault_create" => vault_create(args, ctx),
        "vault_move" => vault_move(args, ctx),
        "vault_delete" => vault_delete(args, ctx),
        "skill_load" => skill_load(args, ctx),
        "cli_run" => cli_run(args, ctx),
        // 调度工具（change add-cron-conversational-registration）：执行侧只做参数 → 草稿的
        // 映射与回执整形，校验 / 落盘 / 重载都在端口实现里（`cron.rs` + `lib.rs`）。
        "cron_task_create" => cron_task_create(args, ctx),
        "cron_task_list" => cron_task_list(ctx),
        "cron_task_remove" => cron_task_remove(args, ctx),
        _ => ToolOutput::err("tool_unknown", format!("未知工具：{name}")),
    }
}

/// cli_run 的 `purpose` 入口校验（change add-harness-permission-modes，design §3.4）：
/// **缺省或 trim 后空白一律拒绝**（空白串与缺省同等——防空格绕过必填），在判定管线之前拦下
/// （ask 档批准卡必须已有 purpose 可展示）。非 cli_run 工具恒 Ok（本期不给 vault 写工具加
/// purpose——路径 + diff 预览已自解释，多一个字段只会稀释 cli_run 上 purpose 的显眼度）。
///
/// 返回的错误走既有统一信封（`tool_args_invalid` 家族的独立码 `cli_purpose_missing`），
/// 模型补填后重发即可。purpose 的内容**不进任何判定层**（信任边界：模型自述、阅读辅助）。
pub fn check_purpose(name: &str, args: &serde_json::Value) -> Result<(), ToolOutput> {
    if name != "cli_run" {
        return Ok(());
    }
    let purpose = args.get("purpose").and_then(|v| v.as_str()).unwrap_or("");
    if purpose.trim().is_empty() {
        return Err(ToolOutput::err(
            "cli_purpose_missing",
            "cli_run 缺少 purpose：请用一句人话补填这条命令是干什么的（用户批准时先看它），然后重发本次调用。",
        ));
    }
    Ok(())
}

/// ask 档的批准预览。返回 Err = 预览阶段就失败（如 patch 不唯一命中）——**不进批准闸**，
/// 错误直接回送模型重试（design §7）。
pub fn approval_preview(
    name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<ApprovalPreview, ToolOutput> {
    match name {
        "vault_patch" => {
            let input = parse_args::<PatchArgs>(args)?;
            let old = fs_io::read_text_file(ctx.root, &input.path)
                .map_err(|e| ToolOutput::from_command_error(&e))?;
            let revision = fs_io::file_revision(ctx.root, &input.path)
                .map_err(|e| ToolOutput::from_command_error(&e))?;
            let new = apply_edits(&old, &input.edits)?;
            Ok(ApprovalPreview {
                diff: Some(diff::unified_diff(&input.path, &old, &new)),
                argv: None,
                revision: Some(revision),
                purpose: None,
                cron_task: None,
            })
        }
        "vault_create" => {
            let input = parse_args::<CreateArgs>(args)?;
            Ok(ApprovalPreview {
                diff: Some(diff::unified_diff(&input.path, "", &input.content)),
                argv: None,
                revision: None,
                purpose: None,
                cron_task: None,
            })
        }
        // vault_move：源 → 目标路径对（design §5.1 的批准预览）。
        "vault_move" => {
            let input = parse_args::<MoveArgs>(args)?;
            Ok(ApprovalPreview {
                diff: None,
                argv: Some(vec![input.path, input.new_path]),
                revision: None,
                purpose: None,
                cron_task: None,
            })
        }
        // vault_delete：路径（面板侧附「将移入系统废纸篓，可恢复」的说明文案）。
        "vault_delete" => {
            let input = parse_args::<DeleteArgs>(args)?;
            Ok(ApprovalPreview {
                diff: None,
                argv: Some(vec![input.path]),
                revision: None,
                purpose: None,
                cron_task: None,
            })
        }
        "cli_run" => {
            let input = parse_args::<CliArgs>(args)?;
            let mut argv = vec![input.command.clone()];
            argv.extend(input.args.clone());
            let purpose = input.purpose.trim();
            Ok(ApprovalPreview {
                diff: None,
                argv: Some(argv),
                revision: None,
                purpose: (!purpose.is_empty()).then(|| purpose.to_string()),
                cron_task: None,
            })
        }
        // 定时任务注册（design §6.3）：五要素 + prompt 全文 + 「今天还触不触发」。
        // 预览不校验（校验在执行侧，失败走结构化错误回送模型），只按草稿给出待批准快照。
        "cron_task_create" => Ok(ApprovalPreview {
            diff: None,
            argv: None,
            revision: None,
            purpose: None,
            cron_task: Some(cron::create_preview(
                &cron::CronTaskDraft::from_args(args, &ctx.root.display().to_string()),
                &cron::LocalNow::now(),
            )),
        }),
        // 删除：id + at（卡片要让人看见删的是哪一条）。
        "cron_task_remove" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let at = crate::config::config_dir()
                .ok()
                .map(|dir| dir.join("config.json"))
                .and_then(|path| cron::find_task_at(&path, id));
            Ok(ApprovalPreview {
                diff: None,
                argv: None,
                revision: None,
                purpose: None,
                cron_task: Some(serde_json::json!({
                    "op": "remove",
                    "id": id,
                    "at": at,
                })),
            })
        }
        _ => Ok(ApprovalPreview::empty()),
    }
}

// ---------------------------------------------------------------------------
// 调度工具（change add-cron-conversational-registration）
// ---------------------------------------------------------------------------

/// 三件调度工具的端口取用：`None` = 本次运行没有调度工具（无人值守运行 / 子运行）。
///
/// 与工具定义的注册面同源：定义只在交互发送路径出现（`SessionContext::tool_definitions`），
/// 端口也只在交互路径注入（`SessionContext::cron_port`）。两句「未知工具」因此对这类运行是
/// 事实陈述——它确实不在本次运行的注册表里。
fn cron_port<'a>(ctx: &ToolContext<'a>) -> Result<&'a dyn cron::CronPort, ToolOutput> {
    ctx.cron.ok_or_else(|| {
        ToolOutput::err(
            "tool_unknown",
            "调度工具只在交互会话里可用（定时运行与子代理都不能排任务）",
        )
    })
}

/// 失败回执 + 诊断事件的**唯一产出点**（design §10）：`cron_task_rejected` 只在这里落，
/// 字段只有任务身份、字段名与错误码（MUST NOT 记 prompt）。
fn cron_rejected(error: cron::CronToolError) -> ToolOutput {
    logging::cron_task_rejected(
        error.task.as_deref().unwrap_or(""),
        error.field.as_deref().unwrap_or(""),
        &error.code,
    );
    ToolOutput::err(&error.code, error.message)
}

fn cron_task_create(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let port = match cron_port(ctx) {
        Ok(port) => port,
        Err(output) => return output,
    };
    let draft = cron::CronTaskDraft::from_args(args, &ctx.root.display().to_string());
    match port.create(draft) {
        Ok(outcome) => {
            // 只有线程确认过（`effect = active`）才落「注册成功」——`pending_restart` 不落，
            // 避免一条「任务已生效」的假记录（design §10 / §11）。
            if outcome.effect.is_active() {
                logging::cron_task_registered(
                    &outcome.task.id,
                    &outcome.task.at,
                    &cron::days_label(&outcome.task.days),
                    outcome.task.delivery.as_str(),
                    outcome.task.session.as_str(),
                    outcome.skip_today,
                );
            }
            let mut receipt = serde_json::json!({
                "task": {
                    "id": outcome.task.id,
                    "vault": outcome.task.vault,
                    "at": outcome.task.at,
                    "days": cron::days_json(&outcome.task.days),
                    "delivery": outcome.task.delivery.as_str(),
                    "session": outcome.task.session.as_str(),
                },
                "effect": outcome.effect.as_str(),
                "skip_today": outcome.skip_today,
            });
            // 通知送不出去（M635 / M636）：回执里带一句人话告知，模型按 `cron-reference.md`
            // 的指令原样转达——注册成功但到点不会有提醒，是用户必须当场知道的事实，不能只进日志。
            if let Some(notice) = outcome.notice {
                receipt["notice"] = serde_json::json!(notice);
            }
            ToolOutput::ok(receipt)
        }
        Err(error) => cron_rejected(error),
    }
}

fn cron_task_list(ctx: &ToolContext) -> ToolOutput {
    let port = match cron_port(ctx) {
        Ok(port) => port,
        Err(output) => return output,
    };
    match port.list() {
        Ok(tasks) => {
            let tasks: Vec<serde_json::Value> = tasks
                .into_iter()
                .map(|task| {
                    serde_json::json!({
                        "id": task.id,
                        "vault": task.vault,
                        "at": task.at,
                        "days": cron::days_json(&task.days),
                        "delivery": task.delivery.as_str(),
                        "session": task.session.as_str(),
                        "last_fired": task.last_fired,
                    })
                })
                .collect();
            ToolOutput::ok(serde_json::json!({ "tasks": tasks }))
        }
        Err(error) => cron_rejected(error),
    }
}

fn cron_task_remove(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let port = match cron_port(ctx) {
        Ok(port) => port,
        Err(output) => return output,
    };
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() {
        return cron_rejected(cron::CronToolError::missing_id());
    }
    match port.remove(id) {
        Ok(outcome) => {
            if outcome.effect.is_active() {
                logging::cron_task_removed(&outcome.id, outcome.effect.as_str());
            }
            ToolOutput::ok(serde_json::json!({
                "id": outcome.id,
                "effect": outcome.effect.as_str(),
            }))
        }
        Err(error) => cron_rejected(error),
    }
}

// ---------------------------------------------------------------------------
// 各工具实现
// ---------------------------------------------------------------------------

fn parse_args<T: for<'de> Deserialize<'de>>(args: &serde_json::Value) -> Result<T, ToolOutput> {
    serde_json::from_value(args.clone())
        .map_err(|e| ToolOutput::err("tool_args_invalid", format!("工具参数不是合法形状:{e}")))
}

#[derive(Deserialize)]
struct ReadArgs {
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
}

/// 单次读取的行数 / 字符上限（模型上下文有限，大文件走 offset/limit 翻页）。
const READ_MAX_LINES: usize = 2000;
const READ_MAX_CHARS: usize = 100_000;

fn vault_read(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<ReadArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    let content = match fs_io::read_text_file(ctx.root, &input.path) {
        Ok(content) => content,
        Err(e) => return ToolOutput::from_command_error(&e),
    };
    // 行切分：结尾换行不产生空尾行（total_lines 才是真实行数）。
    let mut lines: Vec<&str> = content.split('\n').collect();
    if content.ends_with('\n') {
        lines.pop();
    }
    let start = input.offset.map(|o| o.saturating_sub(1)).unwrap_or(0);
    if start >= lines.len() && !lines.is_empty() {
        return ToolOutput::err(
            "read_out_of_range",
            format!("offset 超出文件行数（{} 行）", lines.len()),
        );
    }
    let window = input.limit.unwrap_or(READ_MAX_LINES).min(READ_MAX_LINES);
    let slice = &lines[start..lines.len().min(start + window)];
    let mut text = slice.join("\n");
    let mut truncated = start + slice.len() < lines.len();
    // 字符级二次截断（行截断之后仍可能超长）。
    if text.chars().count() > READ_MAX_CHARS {
        text = text.chars().take(READ_MAX_CHARS).collect();
        truncated = true;
    }
    ToolOutput::ok(serde_json::json!({
        "path": input.path,
        "content": text,
        "from_line": start + 1,
        "to_line": start + slice.len(),
        "total_lines": lines.len(),
        "truncated": truncated,
    }))
}

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    path_glob: Option<String>,
}

/// 搜索结果条数上限（超出标 truncated，模型可缩小 query）。
const SEARCH_MAX_MATCHES: usize = 50;
/// 命中行片段的展示上限。
const SEARCH_SNIPPET_CHARS: usize = 200;

fn vault_search(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<SearchArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    if input.query.is_empty() {
        return ToolOutput::err("search_query_empty", "query 为空");
    }
    let entries = match fs_io::scan_workspace(ctx.root, ctx.policy) {
        Ok(entries) => entries,
        Err(e) => return ToolOutput::from_command_error(&e),
    };
    let needle = input.query.to_lowercase();
    let mut matches = Vec::new();
    let mut truncated = false;
    for entry in &entries {
        if entry.kind != fs_io::FsEntryKind::File || entry.lazy {
            continue; // 惰性条目不进搜索（与「不进索引」同口径）
        }
        if let Some(glob) = &input.path_glob {
            if !glob_match(glob, &entry.path) {
                continue;
            }
        }
        let Ok(content) = fs_io::read_text_file(ctx.root, &entry.path) else {
            continue; // 二进制 / 非 UTF-8：不是文本，跳过
        };
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                if matches.len() >= SEARCH_MAX_MATCHES {
                    truncated = true;
                    break;
                }
                matches.push(serde_json::json!({
                    "path": entry.path,
                    "line": index + 1,
                    "snippet": snippet(line),
                }));
            }
        }
        if truncated {
            break;
        }
    }
    ToolOutput::ok(serde_json::json!({
        "matches": matches,
        "truncated": truncated,
    }))
}

fn snippet(line: &str) -> String {
    let line = line.trim();
    if line.chars().count() > SEARCH_SNIPPET_CHARS {
        format!(
            "{}…",
            line.chars().take(SEARCH_SNIPPET_CHARS).collect::<String>()
        )
    } else {
        line.to_string()
    }
}

#[derive(Deserialize)]
struct ListArgs {
    path: Option<String>,
    recursive: Option<bool>,
    path_glob: Option<String>,
    /// **有符号**接收（change add-harness-vault-workspace-list r3）：工具 schema 只声明
    /// `type: integer`、没有 `minimum`，所以 `limit: -1` 是合法调用，必须走到下面的 clamp
    /// （「小于 1 按 1」）。用 `usize` 会在 Serde 阶段就把负数打成 `tool_args_invalid`，
    /// 与已批准的 delta 冲突。
    limit: Option<i64>,
    cursor: Option<String>,
}

/// 单页条数的缺省 / 上限（change add-harness-vault-workspace-list design §5.1）：有界输出是合同
/// 的一部分——整棵 vault 树 MUST NOT 一次灌进上下文。
const LIST_DEFAULT_LIMIT: usize = 200;
const LIST_MAX_LIMIT: usize = 1000;

/// 目录 / 路径发现（change add-harness-vault-workspace-list design §5）。
///
/// 枚举直接复用 [`fs_io::scan_workspace`]：它已经实现了「全类型递归枚举、hidden 丢弃、lazy 行、
/// 用户规则与 path 排序」，并在递归途中逐层登记嵌套 `.gitignore`。自写子树遍历要么重读祖先规则、
/// 要么漏规则，两种都会造出第二套目录语义（REVIEW.md「同一语义两处真源」条）。
///
/// 本函数只做三件过滤：目录前缀（一层 / 递归）、`path_glob`、`cursor` 续读；返回条目只含
/// `path` 与 `kind`——不返回正文、大小或时间（有界、可预期、不让模型把结果当 `find` 用）。
fn vault_list(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<ListArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    // `path` 按原字符串解释，**不 trim**（r4 同族）：macOS 文件名允许首尾空格，工具自己返回的
    // 条目 `path` 必须能原样作为下一次调用的 `path`（round-trip）；trim 会把「 spaced dir /x.md」
    // 指向另一个不存在的名字，静默换义。合法路径里不可能出现的空段与 `.` 段仍在下面清理。
    let raw = input.path.as_deref().unwrap_or("");
    // 绝对路径单独给码：工作区段已给出 vault 根，转换是机械的；接受两种写法会把路径歧义带进新
    // 工具的结果面（`path` 一律 vault 相对）。
    if raw.starts_with('/') {
        return ToolOutput::err(
            "list_path_absolute",
            format!("path 必须是 vault 相对路径（不要以 / 开头）：{raw}；vault 根见 system 的工作区段。"),
        );
    }
    // 词法清理：去掉空段与 `.` 段（`./notes`、`notes//` 与 `notes` 等价）。`..` 段保留，
    // 交给 `resolve_in_vault` 按逃逸拒绝——清理层 MUST NOT 让逃逸消失。
    let dir_rel = raw
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/");
    let dir_rel = dir_rel.as_str();
    // 目录校验：空 = vault 根（`resolve_in_vault` 对空串按非法路径处理，这里单独走根）；非空走与
    // 所有读取路径同源的 vault 内解析（逃逸 / 不存在 / 符号链接逃逸都由它兜）。
    if dir_rel.is_empty() {
        match ctx.root.canonicalize() {
            Ok(root) if root.is_dir() => {}
            Ok(_) => {
                return ToolOutput::err(
                    "fs_root_not_dir",
                    format!("vault 根不是目录：{}", ctx.root.display()),
                )
            }
            Err(e) => {
                return ToolOutput::err(
                    "fs_root_invalid",
                    format!("无法解析 vault 根 {}：{e}", ctx.root.display()),
                )
            }
        }
    } else {
        let resolved = match fs_io::resolve_in_vault(ctx.root, dir_rel) {
            Ok(path) => path,
            Err(e) => return ToolOutput::from_command_error(&e),
        };
        if !resolved.is_dir() {
            return ToolOutput::err("list_not_a_directory", format!("{dir_rel} 不是目录"));
        }
    }
    let scanned = match fs_io::scan_workspace(ctx.root, ctx.policy) {
        Ok(entries) => entries,
        Err(e) => return ToolOutput::from_command_error(&e),
    };
    let recursive = input.recursive.unwrap_or(false);
    let prefix = if dir_rel.is_empty() {
        String::new()
    } else {
        format!("{dir_rel}/")
    };
    // 按 path 码点升序——`scan_workspace` 已排序，这里显式再排一次：排序是本工具的契约，不把
    // 「上游碰巧排过序」当保证（上游排序口径变化不该静默改写分页顺序）。
    let mut lines: Vec<(String, &'static str)> = scanned
        .iter()
        .filter_map(|entry| {
            let rel = entry.path.as_str();
            let tail = if prefix.is_empty() {
                rel
            } else {
                rel.strip_prefix(&prefix)?
            };
            if tail.is_empty() {
                return None; // 目录自身不是它的条目
            }
            if !recursive && tail.contains('/') {
                return None; // 默认只列一层
            }
            if let Some(glob) = &input.path_glob {
                if !glob_match(glob, rel) {
                    return None;
                }
            }
            let kind = match entry.kind {
                fs_io::FsEntryKind::Dir => "directory",
                fs_io::FsEntryKind::File => "file",
            };
            Some((rel.to_string(), kind))
        })
        .collect();
    lines.sort_by(|a, b| a.0.cmp(&b.0));
    // cursor = 工具自己返回的原始 `path`，**MUST NOT 做空白规范化**（r4）：macOS 文件名允许首尾
    // 空格，`trim` 会把 `a.md ` 改写成 `a.md`，使该条目再次满足 `>` 条件而重复返回；根目录下
    // 以空格开头的路径则会被跳过。这里只按原字符串判空 / 非空并做严格大于过滤。
    if let Some(cursor) = input.cursor.as_deref() {
        if !cursor.is_empty() {
            lines.retain(|(path, _)| path.as_str() > cursor);
        }
    }
    // 有符号 clamp 后再转 usize：负数 / 0 与超过上限的值都落到合同区间（r3）。转换只发生在
    // clamp 之后，`as usize` 因此恒为安全值（1..=LIST_MAX_LIMIT）。
    let limit = input
        .limit
        .unwrap_or(LIST_DEFAULT_LIMIT as i64)
        .clamp(1, LIST_MAX_LIMIT as i64) as usize;
    let truncated = lines.len() > limit;
    lines.truncate(limit);
    let next_cursor = truncated
        .then(|| lines.last().map(|(path, _)| path.clone()))
        .flatten();
    let entries: Vec<serde_json::Value> = lines
        .iter()
        .map(|(path, kind)| serde_json::json!({"path": path, "kind": kind}))
        .collect();
    let mut value = serde_json::json!({
        "path": dir_rel,
        "entries": entries,
        "truncated": truncated,
    });
    // 契约：只有还有下一页时才出现 next_cursor（`truncated: false` 时缺席，不是 null）。
    if let Some(cursor) = next_cursor {
        value["next_cursor"] = serde_json::json!(cursor);
    }
    ToolOutput::ok(value)
}

/// 朴素 glob：`*` 匹配任意字符序列（含 `/`），`?` 匹配单个字符。star 回溯迭代实现。
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut p, mut t) = (0usize, 0usize);
    let (mut star_p, mut star_t) = (usize::MAX, 0usize);
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star_p = p;
            star_t = t;
            p += 1;
        } else if star_p != usize::MAX {
            p = star_p + 1;
            star_t += 1;
            t = star_t;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

#[derive(Deserialize)]
struct PatchArgs {
    path: String,
    edits: Vec<PatchEdit>,
}

/// 内存内应用 edits（与 `fs_io::fs_patch_file` 同一唯一命中语义，预览与执行对齐）。
fn apply_edits(old: &str, edits: &[PatchEdit]) -> Result<String, ToolOutput> {
    if edits.is_empty() {
        return Err(ToolOutput::err("patch_invalid", "edits 为空"));
    }
    let mut content = old.to_string();
    for (index, edit) in edits.iter().enumerate() {
        if edit.old_string.is_empty() {
            return Err(ToolOutput::err(
                "patch_invalid",
                format!("第 {} 处编辑的 old_string 为空串", index + 1),
            ));
        }
        let hits = content.matches(edit.old_string.as_str()).count();
        if hits != 1 {
            return Err(ToolOutput::err(
                if hits == 0 {
                    "patch_not_found"
                } else {
                    "patch_not_unique"
                },
                format!(
                    "第 {} 处编辑的 old_string 在文件中命中 {} 次（要求恰好 1 次），已拒绝整组编辑",
                    index + 1,
                    hits
                ),
            ));
        }
        content = content.replacen(edit.old_string.as_str(), &edit.new_string, 1);
    }
    Ok(content)
}

/// `expected_revision`：批准档传预览时刻的基准 revision（批准窗 CAS）；None（allow 档）
/// 取执行时刻当前值。fs_patch_file 内部对账，不一致即 document_conflict。
fn vault_patch(
    args: &serde_json::Value,
    ctx: &ToolContext,
    expected_revision: Option<&str>,
) -> ToolOutput {
    let input = match parse_args::<PatchArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    let revision = match expected_revision {
        Some(revision) => revision.to_string(),
        None => match fs_io::file_revision(ctx.root, &input.path) {
            Ok(revision) => revision,
            Err(e) => return ToolOutput::from_command_error(&e),
        },
    };
    match fs_io::fs_patch_file(ctx.root, ctx.policy, &input.path, &input.edits, &revision) {
        Ok(new_revision) => ToolOutput::ok(serde_json::json!({
            "path": input.path,
            "revision": new_revision,
        })),
        Err(e) => ToolOutput::from_command_error(&e),
    }
}

#[derive(Deserialize)]
struct CreateArgs {
    path: String,
    content: String,
}

fn vault_create(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<CreateArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    match fs_io::vault_create_file(ctx.root, ctx.policy, &input.path, &input.content) {
        Ok(path) => ToolOutput::ok(serde_json::json!({ "path": path })),
        Err(e) => ToolOutput::from_command_error(&e),
    }
}

#[derive(Deserialize)]
struct MoveArgs {
    path: String,
    new_path: String,
}

fn vault_move(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<MoveArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    match fs_io::fs_move_entry(ctx.root, ctx.policy, &input.path, &input.new_path) {
        Ok(path) => ToolOutput::ok(serde_json::json!({ "path": path })),
        Err(e) => ToolOutput::from_command_error(&e),
    }
}

#[derive(Deserialize)]
struct DeleteArgs {
    path: String,
}

/// vault_delete：**只有移入系统废纸篓一条路径**（`trash_entry`），本工具集里物理上做不到
/// 永久删除（design §5.3）。失败不留半删除状态（`trash` crate 的单次系统调用语义）。
/// `hidden` 档命中的路径在 `trash_entry` 里被拒（树里没有行 ⇒ 没有正当删除入口）。
fn vault_delete(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<DeleteArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    match fs_io::trash_entry(ctx.root, ctx.policy, &input.path) {
        Ok(()) => ToolOutput::ok(serde_json::json!({ "path": input.path })),
        Err(e) => ToolOutput::from_command_error(&e),
    }
}

#[derive(Deserialize)]
struct SkillArgs {
    name: String,
    file: Option<String>,
}

/// skill_load 内容上限（SKILL.md 是教模型用法的文本，远超此上限基本是读错文件）。
const SKILL_MAX_BYTES: u64 = 200 * 1024;

fn skill_load(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<SkillArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    // 名称即单段目录名：带路径分隔符 / .. / 隐藏项即拒（spec「路径逃逸拒绝」场景）。
    if input.name.is_empty()
        || input.name.starts_with('.')
        || input.name.contains('/')
        || input.name.contains('\\')
        || input.name == ".."
    {
        return ToolOutput::err(
            "skill_name_invalid",
            format!(
                "技能名不合法（必须是 Skill 根下的单段目录名）：{}",
                input.name
            ),
        );
    }
    let Some(skill) = ctx.skills.iter().find(|s| s.name == input.name) else {
        let available: Vec<&str> = ctx.skills.iter().map(|s| s.name.as_str()).collect();
        return ToolOutput::err(
            "skill_not_found",
            format!(
                "技能 {} 不存在（可用：{}）",
                input.name,
                available.join(", ")
            ),
        );
    };
    let file = input.file.as_deref().unwrap_or("SKILL.md");
    // file 限定在 Skill 目录内：逐段校验，拒绝绝对路径与 ..
    let relative = Path::new(file);
    if relative.is_absolute()
        || relative.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return ToolOutput::err(
            "skill_path_escape",
            format!("skill_load 的文件必须限定在技能目录内：{file}"),
        );
    }
    let target = skill.dir.join(relative);
    let metadata = match std::fs::metadata(&target) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => {
            return ToolOutput::err(
                "skill_file_missing",
                format!("技能 {} 里没有文件 {file}", input.name),
            )
        }
    };
    if metadata.len() > SKILL_MAX_BYTES {
        return ToolOutput::err(
            "skill_too_large",
            format!("{file} 超过 {}KB 上限", SKILL_MAX_BYTES / 1024),
        );
    }
    match std::fs::read_to_string(&target) {
        Ok(content) => ToolOutput::ok(serde_json::json!({
            "name": input.name,
            "file": file,
            "content": content,
        })),
        Err(e) => ToolOutput::err("skill_read_failed", format!("读取 {file} 失败：{e}")),
    }
}

#[derive(Deserialize)]
struct CliArgs {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    /// 用途说明（change add-harness-permission-modes，design §3.4）：schema 必填，但这里收成
    /// 缺省空串——缺省与空白由 [`check_purpose`] 在判定管线之前按统一信封拒绝（走 serde 必填
    /// 会得到泛泛的 `tool_args_invalid`，模型拿不到「补填用途」这条人话指引）。
    #[serde(default)]
    purpose: String,
}

/// CLI 输出单侧截断上限（超出标 truncated）。
const CLI_MAX_CHARS: usize = 10_000;
/// CLI 超时（毫秒）：阻塞 wait 的轮询上限，超时即 kill（无 tokio 的条件变量替代）。
const CLI_TIMEOUT_MS: u128 = 60_000;

/// 登录 shell PATH 解析超时（change harness-cli-login-shell-path）：解析在独立子进程里跑，
/// 用户的 zsh / bash 启动文件可能挂住（交互式读 stdin、慢插件），超时即放弃、回退继承 PATH。
const SHELL_PATH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// PATH 解析的夹取标记：启动文件（starship / pyenv / zoxide 的 init）会往 stdout 打杂输出，
/// 用一对标记把真正的 PATH 夹在中间再切出来——比「取整行」更抗尾部杂输出。
const PATH_MARKER_START: &str = "__LUMIR_PATH_START__";
const PATH_MARKER_END: &str = "__LUMIR_PATH_END__";

/// 会话内首次 cli_run 时解析一次的登录 shell PATH（含失败结果）。
/// 惰性初始化（不拖慢 app 启动）、进程内单例；失败也缓存，避免每条命令都重试一遍超时。
static CLI_PATH: OnceLock<Option<String>> = OnceLock::new();

/// cli_run 子进程要用的 PATH：解析到登录 shell 的完整 PATH 就注入，否则返回 None
/// （不改子进程环境，照常继承 app 自身的 PATH——回退语义）。
fn cli_path() -> Option<String> {
    CLI_PATH
        .get_or_init(|| {
            let inherited = std::env::var("PATH").ok();
            merge_paths(resolve_login_shell_path().as_deref(), inherited.as_deref())
        })
        .clone()
}

/// 经用户登录 shell 解析完整 PATH。shell 取 `$SHELL`（缺失或空白时回落 `/bin/zsh`）。
fn resolve_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    resolve_path_via_shell(Path::new(&shell), SHELL_PATH_TIMEOUT)
}

/// 已知 shell 的「登录 + 交互」旗标。zsh 的 `-l -c` 只读登录启动文件、`-i -c` 只读交互
/// 启动文件——实证（2026-10-12，本机 zsh，见 change harness-cli-login-shell-path）PATH 增补
/// 同时定义在两者里，只取其一都拿不全，故用 `-l -i -c` 同时加载。其余 shell（fish / nu 等）
/// 的启动文件与旗标语义不同，不猜——返回 None 即回落继承 PATH。
fn login_shell_flags(shell: &Path) -> Option<[&'static str; 3]> {
    match shell.file_name().and_then(|name| name.to_str()) {
        Some("zsh") | Some("bash") => Some(["-l", "-i", "-c"]),
        _ => None,
    }
}

/// 起 `shell -l -i -c '<只打印 PATH 的命令>'` 取 PATH。整个解析受 `timeout` 约束：
/// 超时 / 进程错误 / 标记缺失或为空白，一律返回 None（不把「读不到」当空串）。
fn resolve_path_via_shell(shell: &Path, timeout: std::time::Duration) -> Option<String> {
    let flags = login_shell_flags(shell)?;
    let script = format!("printf '%s%s%s' '{PATH_MARKER_START}' \"$PATH\" '{PATH_MARKER_END}'");
    let mut child = std::process::Command::new(shell)
        .args(flags)
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // 读管道放独立线程（阻塞 read 等 EOF），结果经通道回传；主路径只做截止时间轮询，
    // 且只 recv_timeout 到截止时间——孙进程占着管道不放也不会把解析拖过 timeout。
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(_) => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let _ = child.wait();
    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
    let output = rx
        .recv_timeout(remaining.max(std::time::Duration::from_millis(1)))
        .ok()?;
    parse_marked_path(&String::from_utf8_lossy(&output))
}

/// 从（可能夹带启动文件杂输出的）shell 输出里切出夹在标记之间的 PATH。标记缺失或中间为空白
/// 时返回 None。
fn parse_marked_path(output: &str) -> Option<String> {
    let start = output.find(PATH_MARKER_START)? + PATH_MARKER_START.len();
    let rest = &output[start..];
    let end = rest.find(PATH_MARKER_END)?;
    let path = rest[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// 决策：解析到 PATH ⇒ 「解析结果在前 + 应用继承到的额外目录去重追加在后」；
/// 解析失败（None / 空白）⇒ None（不改子进程环境，回退继承 app 的 PATH）。
/// 解析结果优先，是为了让用户 shell 的语义胜出；追加继承里的额外目录，是为了不丢
/// app 启动上下文（如 dev 工具链）注入的目录。
fn merge_paths(resolved: Option<&str>, inherited: Option<&str>) -> Option<String> {
    let resolved = resolved.map(str::trim).filter(|s| !s.is_empty())?;
    let mut segments: Vec<&str> = Vec::new();
    for segment in resolved
        .split(':')
        .chain(inherited.into_iter().flat_map(|value| value.split(':')))
    {
        if segment.is_empty() || segments.contains(&segment) {
            continue;
        }
        segments.push(segment);
    }
    Some(segments.join(":"))
}

fn cli_run(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<CliArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    if input.command.trim().is_empty() {
        return ToolOutput::err("cli_command_empty", "command 为空");
    }
    let mut command = std::process::Command::new(&input.command);
    command
        .args(&input.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 工作区合同（change add-harness-vault-workspace-list design §3）：每个子进程**单独**以当前
        // vault 为工作目录，并同步 PWD——「相对路径 = vault 内路径」这条事实在子进程里成立，
        // `pwd` 因此返回当前 vault。刻意不用 `std::env::set_current_dir`：主进程 cwd 是全局状态，
        // 多 vault / 子代理 / 后台运行会互相污染。也不给模型可填的 `cwd` 参数（外部目标用绝对路径）。
        .current_dir(ctx.root)
        .env("PWD", ctx.root);
    // 注入型环境变量的防御性清空（change readonly-allowlist-tightening-oct23 取值 D3）：
    // `RIPGREP_CONFIG_PATH` 能给 rg 注入 `--pre`、`LESSOPEN` / `LESSCLOSE` 能让 less 执行
    // 过滤器、`GREP_OPTIONS` 能给 grep 塞旗标。这些变量由 app 进程继承、模型不能设置，
    // **不是 argv 判据的一部分**（spec 不依赖它）——这里清空是给未来的 spawn 形态变化留防线。
    for name in [
        "RIPGREP_CONFIG_PATH",
        "LESSOPEN",
        "LESSCLOSE",
        "GREP_OPTIONS",
    ] {
        command.env_remove(name);
    }
    // 登录 shell PATH（change harness-cli-login-shell-path）：只在解析到结果时注入，
    // 解析失败什么都不做、子进程照常继承 app 的 PATH。权限判定不在此处、不受影响。
    if let Some(path) = cli_path() {
        command.env("PATH", path);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            return ToolOutput::err(
                "cli_spawn_failed",
                format!("无法启动 {}：{e}", input.command),
            )
        }
    };
    let started = std::time::Instant::now();
    // 管道 draining 必须在独立线程：阻塞 read 等 EOF，主路径只做超时轮询。
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed().as_millis() > CLI_TIMEOUT_MS {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return ToolOutput::err(
                        "cli_timeout",
                        format!(
                            "{} 超时（{} 秒），已终止",
                            input.command,
                            CLI_TIMEOUT_MS / 1000
                        ),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(e) => {
                let _ = child.kill();
                return ToolOutput::err("cli_wait_failed", format!("等待子进程失败：{e}"));
            }
        }
    }
    let exit_code = child.wait().ok().and_then(|status| status.code());
    let stdout_buf = stdout_thread.join().unwrap_or_default();
    let stderr_buf = stderr_thread.join().unwrap_or_default();
    let (stdout_text, stdout_truncated) = truncate_cli_output(&stdout_buf);
    let (stderr_text, stderr_truncated) = truncate_cli_output(&stderr_buf);
    ToolOutput::ok(serde_json::json!({
        "command": input.command,
        "args": input.args,
        "exit_code": exit_code,
        "stdout": stdout_text,
        "stderr": stderr_text,
        "truncated": stdout_truncated || stderr_truncated,
    }))
}

/// CLI 输出转文本 + 截断标记。非 UTF-8 用 lossy（外部工具输出我们不定编码，
/// 截断与标记显式，不静默）。
fn truncate_cli_output(bytes: &[u8]) -> (String, bool) {
    let text = String::from_utf8_lossy(bytes);
    if text.chars().count() > CLI_MAX_CHARS {
        (
            format!(
                "{}…[截断]",
                text.chars().take(CLI_MAX_CHARS).collect::<String>()
            ),
            true,
        )
    } else {
        (text.into_owned(), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn ctx<'a>(
        root: &'a Path,
        policy: &'a IgnorePolicy,
        skills: &'a [SkillEntry],
    ) -> ToolContext<'a> {
        ToolContext {
            root,
            policy,
            skills,
            cron: None,
        }
    }

    /// 独立测试 vault：tmp 目录 + 生产口径忽略表。
    fn fixture_vault(name: &str) -> (PathBuf, IgnorePolicy) {
        let root = std::env::temp_dir().join(format!(
            "lumir-harness-tools-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        (root, policy)
    }

    #[test]
    fn glob_star_and_question() {
        assert!(glob_match("*.md", "notes/a.md"));
        assert!(glob_match("docs/*", "docs/a/b.md"));
        assert!(glob_match("a?c", "abc"));
        assert!(!glob_match("a?c", "ac"));
        assert!(!glob_match("*.md", "notes/a.txt"));
        assert!(glob_match("*", "anything"));
        assert!(glob_match("**/b.md", "x/y/b.md"));
    }

    #[test]
    fn vault_read_pages_and_truncates() {
        let (root, policy) = fixture_vault("read");
        std::fs::write(
            root.join("a.md"),
            (1..=10).map(|i| format!("line{i}\n")).collect::<String>(),
        )
        .unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let args = serde_json::json!({"path": "a.md", "offset": 3, "limit": 2});
        let out = vault_read(&args, &ctx);
        assert!(out.succeeded());
        assert_eq!(out.value["content"], "line3\nline4");
        assert_eq!(out.value["from_line"], 3);
        assert_eq!(out.value["to_line"], 4);
        // 窗口外还有内容 ⇒ 显式标 truncated（翻页语义）
        assert_eq!(out.value["truncated"], true);
        // 全量读（10 行 < 上限）⇒ 不截断
        let out = vault_read(&serde_json::json!({"path": "a.md"}), &ctx);
        assert_eq!(out.value["truncated"], false);
        assert_eq!(out.value["total_lines"], 10);
        let out = vault_read(&serde_json::json!({"path": "a.md", "offset": 99}), &ctx);
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "read_out_of_range");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn vault_search_respects_ignore_and_globs() {
        let (root, _policy) = fixture_vault("search");
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/a.md"), "Hello Needle world\n").unwrap();
        std::fs::write(root.join("docs/b.txt"), "needle\n").unwrap();
        std::fs::write(root.join("c.md"), "Needle\n").unwrap();
        std::fs::write(root.join("ignored.log"), "needle\n").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.log\n").unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);
        let out = vault_search(&serde_json::json!({"query": "needle"}), &ctx);
        let matches = out.value["matches"].as_array().unwrap();
        let paths: Vec<&str> = matches
            .iter()
            .map(|m| m["path"].as_str().unwrap())
            .collect();
        assert!(paths.contains(&"docs/a.md"), "{paths:?}");
        assert!(paths.contains(&"docs/b.txt"), "{paths:?}");
        assert!(paths.contains(&"c.md"), "{paths:?}");
        assert!(
            !paths.iter().any(|p| p.contains("ignored.log")),
            "{paths:?}"
        );
        let out = vault_search(
            &serde_json::json!({"query": "needle", "path_glob": "*.txt"}),
            &ctx,
        );
        let matches = out.value["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["path"], "docs/b.txt");
        std::fs::remove_dir_all(&root).ok();
    }

    /// `vault_list` 默认只列一层、按码点排序（change add-harness-vault-workspace-list design §5）。
    ///
    /// 用户规则命中的文件是**惰性可见**（与文件树同口径，出现在结果里），hidden 档命中的条目不出现
    /// ——这两条都是复用 fs-io 分类的直接后果，不是本工具的第二套规则。
    #[test]
    fn vault_list_lists_one_layer_by_default() {
        let (root, _policy) = fixture_vault("list-one-layer");
        std::fs::create_dir_all(root.join("notes/2026")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("a.md"), "A\n").unwrap();
        std::fs::write(root.join("notes/b.md"), "B\n").unwrap();
        std::fs::write(root.join("notes/2026/c.md"), "C\n").unwrap();
        std::fs::write(root.join("ignored.log"), "x\n").unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: x\n").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.log\n").unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);

        let out = vault_list(&serde_json::json!({}), &ctx);
        assert!(out.succeeded(), "{out:?}");
        let entries = out.value["entries"].as_array().unwrap();
        let paths: Vec<&str> = entries
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(
            paths,
            vec![".gitignore", "a.md", "ignored.log", "notes"],
            "{out:?}"
        );
        // 一条一层：嵌套条目不出现在根列表里。
        assert!(!paths.iter().any(|p| p.contains("notes/b.md")));
        // hidden 档（`.git`）不出现。
        assert!(!paths.iter().any(|p| p.starts_with(".git/")), "{paths:?}");
        // kind 两值：目录 / 文件。
        let notes = entries.iter().find(|e| e["path"] == "notes").unwrap();
        assert_eq!(notes["kind"], "directory");
        let a = entries.iter().find(|e| e["path"] == "a.md").unwrap();
        assert_eq!(a["kind"], "file");
        assert_eq!(out.value["truncated"], false);
        assert!(out.value.get("next_cursor").is_none(), "{out:?}");
        // 注册表入口同一条实现（名字 → 函数的接线不是「只在单测里存在」的第二条路径）。
        let via_registry = execute("vault_list", &serde_json::json!({}), &ctx);
        assert!(via_registry.succeeded(), "{via_registry:?}");
        assert_eq!(
            via_registry.value["entries"].as_array().unwrap().len(),
            entries.len()
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// 递归下钻与 `path_glob` 过滤（与 `vault_search` 同一 glob 写法）。
    #[test]
    fn vault_list_recursive_and_path_glob() {
        let (root, _policy) = fixture_vault("list-recursive");
        std::fs::create_dir_all(root.join("notes/2026")).unwrap();
        std::fs::write(root.join("notes/b.md"), "B\n").unwrap();
        std::fs::write(root.join("notes/2026/c.md"), "C\n").unwrap();
        std::fs::write(root.join("notes/2026/d.txt"), "D\n").unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);

        let out = vault_list(
            &serde_json::json!({"path": "notes", "recursive": true}),
            &ctx,
        );
        let paths: Vec<&str> = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(
            paths,
            vec![
                "notes/2026",
                "notes/2026/c.md",
                "notes/2026/d.txt",
                "notes/b.md"
            ]
        );
        // 不带 recursive 时同一目录只返回一层。
        let out = vault_list(&serde_json::json!({"path": "notes"}), &ctx);
        let paths: Vec<&str> = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, vec!["notes/2026", "notes/b.md"]);
        // 词法清理：`./notes`、`notes//` 与 `notes` 等价（不因写法差异返回空页）。
        for spelling in ["notes", "./notes", "notes/", "notes//"] {
            let out = vault_list(&serde_json::json!({"path": spelling}), &ctx);
            let paths: Vec<&str> = out.value["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| e["path"].as_str().unwrap())
                .collect();
            assert_eq!(paths, vec!["notes/2026", "notes/b.md"], "{spelling}");
        }
        // glob 只看路径（`*` 跨 `/`，与 vault_search 同口径）。
        let out = vault_list(
            &serde_json::json!({"path": "notes", "recursive": true, "path_glob": "*.md"}),
            &ctx,
        );
        let paths: Vec<&str> = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, vec!["notes/2026/c.md", "notes/b.md"]);
        std::fs::remove_dir_all(&root).ok();
    }

    /// 分页无状态且稳定：三页拼起来恰为全集，`truncated` / `next_cursor` 严格配对。
    #[test]
    fn vault_list_paginates_stably() {
        let (root, policy) = fixture_vault("list-pages");
        std::fs::create_dir_all(root.join("pages")).unwrap();
        for index in 1..=5 {
            std::fs::write(root.join(format!("pages/p{index}.md")), "x\n").unwrap();
        }
        let ctx = ctx(&root, &policy, &[]);
        let mut collected: Vec<String> = Vec::new();
        let mut cursor: Option<String> = None;
        let mut pages = 0;
        loop {
            let mut args = serde_json::json!({"path": "pages", "limit": 2});
            if let Some(cursor) = &cursor {
                args["cursor"] = serde_json::json!(cursor);
            }
            let out = vault_list(&args, &ctx);
            assert!(out.succeeded(), "{out:?}");
            pages += 1;
            assert!(pages <= 5, "翻页未收敛：{out:?}");
            let entries = out.value["entries"].as_array().unwrap();
            collected.extend(
                entries
                    .iter()
                    .map(|e| e["path"].as_str().unwrap().to_string()),
            );
            let truncated = out.value["truncated"].as_bool().unwrap();
            match out.value.get("next_cursor").and_then(|v| v.as_str()) {
                Some(next) => {
                    assert!(truncated, "只有还有下一页时才带 next_cursor：{out:?}");
                    assert_eq!(
                        Some(next.to_string()),
                        entries
                            .last()
                            .map(|e| e["path"].as_str().unwrap().to_string())
                    );
                    cursor = Some(next.to_string());
                }
                None => {
                    assert!(!truncated, "truncated 必须与 next_cursor 配对：{out:?}");
                    break;
                }
            }
        }
        assert_eq!(
            collected,
            vec![
                "pages/p1.md",
                "pages/p2.md",
                "pages/p3.md",
                "pages/p4.md",
                "pages/p5.md"
            ]
        );
        assert_eq!(pages, 3);
        std::fs::remove_dir_all(&root).ok();
    }

    /// `cursor` 不做空白规范化（change add-harness-vault-workspace-list r4）：macOS 文件名允许
    /// 首尾空格，工具返回的 `next_cursor` 就是原始 `path`，续读必须原样接受它。旧实现 `trim`
    /// 后比较会在两种形态上破坏「无重复无遗漏」：
    /// - 尾随空格（`a.md ` → 比较值 `a.md`）⇒ 该条目仍 `>` 游标，被重复返回；
    /// - 前导空格（` b.md` → 比较值 `b.md`）⇒ 该条目不再 `>` 游标，被跳过。
    #[test]
    fn vault_list_cursor_keeps_path_whitespace() {
        let (root, _policy) = fixture_vault("list-cursor-space");
        for name in [" b.md", "a.md ", "c.md"] {
            std::fs::write(root.join(name), "x\n").unwrap();
        }
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);

        // 逐页（limit = 1）收集：三页拼起来恰为码点序全集，无重复无遗漏。
        let mut collected: Vec<String> = Vec::new();
        let mut cursor: Option<String> = None;
        for page in 0..3 {
            let mut args = serde_json::json!({"limit": 1});
            if let Some(cursor) = &cursor {
                args["cursor"] = serde_json::json!(cursor);
            }
            let out = vault_list(&args, &ctx);
            assert!(out.succeeded(), "第 {page} 页失败：{out:?}");
            let entries = out.value["entries"].as_array().unwrap();
            assert_eq!(entries.len(), 1, "第 {page} 页：{out:?}");
            collected.push(entries[0]["path"].as_str().unwrap().to_string());
            let truncated = out.value["truncated"].as_bool().unwrap();
            let next = out.value.get("next_cursor").and_then(|v| v.as_str());
            if page < 2 {
                assert!(truncated, "第 {page} 页应还有下一页：{out:?}");
                // 游标逐字节保留原始 path（含空格）。
                assert_eq!(next, Some(collected[page].as_str()), "{out:?}");
                cursor = next.map(str::to_string);
            } else {
                assert!(!truncated, "末页不应再截断：{out:?}");
                assert!(next.is_none(), "{out:?}");
            }
        }
        assert_eq!(collected, vec![" b.md", "a.md ", "c.md"]);
        std::fs::remove_dir_all(&root).ok();
    }

    /// `path` 与 `cursor` 同一口径（change add-harness-vault-workspace-list r4）：按原字符串解释，
    /// 不做空白规范化。工具返回的条目 `path` 必须能原样传回——含首尾空格的目录名因此可达；去掉
    /// 空格的名字是**另一个**名字，应如实报 `fs_not_found` 而不是静默换义。
    #[test]
    fn vault_list_path_keeps_whitespace_round_trip() {
        let (root, _policy) = fixture_vault("list-path-space");
        std::fs::create_dir_all(root.join(" spaced dir ")).unwrap();
        std::fs::write(root.join(" spaced dir /x.md"), "x\n").unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);

        // 列根：目录条目逐字节带空格。
        let out = vault_list(&serde_json::json!({}), &ctx);
        let dir_path = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["path"].as_str().unwrap())
            .find(|path| path.contains("spaced"))
            .expect("根下应有带空格的目录")
            .to_string();
        assert_eq!(dir_path, " spaced dir ");

        // 原样传回 ⇒ 列出它的子项（round-trip）。
        let out = vault_list(&serde_json::json!({"path": dir_path}), &ctx);
        assert!(out.succeeded(), "{out:?}");
        let paths: Vec<&str> = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, vec![" spaced dir /x.md"]);

        // 去掉空格的名字不是同一个目录：如实报不存在（不静默换成另一个目录）。
        let out = vault_list(&serde_json::json!({"path": "spaced dir"}), &ctx);
        assert_eq!(out.value["code"], "fs_not_found", "{out:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// `limit` 的边界夹取（change add-harness-vault-workspace-list r3）：工具 schema 只声明
    /// `type: integer`，负数与 0 都是合法调用，必须按「小于 1 按 1」返回一页，MUST NOT 被
    /// Serde 反序列化提前拒掉；超过上限按 1000。三种边界都是必红断言（旧实现用 `usize`
    /// 接收，`-1` 会直接落 `tool_args_invalid`）。
    #[test]
    fn vault_list_limit_is_clamped_not_rejected() {
        let (root, policy) = fixture_vault("list-limit");
        std::fs::create_dir_all(root.join("batch")).unwrap();
        for index in 1..=1005 {
            std::fs::write(root.join(format!("batch/p{index:04}.md")), "x\n").unwrap();
        }
        let ctx = ctx(&root, &policy, &[]);

        // 负数 / 0：按 1 返回一页（不是参数错误）。
        for limit in [-1i64, 0] {
            let out = vault_list(&serde_json::json!({"path": "batch", "limit": limit}), &ctx);
            assert!(out.succeeded(), "limit={limit} 不得被参数校验拒绝：{out:?}");
            let entries = out.value["entries"].as_array().unwrap();
            assert_eq!(entries.len(), 1, "limit={limit} 应按 1：{out:?}");
            assert_eq!(entries[0]["path"], "batch/p0001.md");
            assert_eq!(out.value["truncated"], true);
            assert_eq!(out.value["next_cursor"], "batch/p0001.md");
        }

        // 超过上限：按 1000（不是 1001）。
        let out = vault_list(&serde_json::json!({"path": "batch", "limit": 1001}), &ctx);
        assert!(out.succeeded(), "{out:?}");
        let entries = out.value["entries"].as_array().unwrap();
        assert_eq!(entries.len(), LIST_MAX_LIMIT, "{out:?}");
        assert_eq!(entries[0]["path"], "batch/p0001.md");
        assert_eq!(out.value["truncated"], true);
        assert_eq!(out.value["next_cursor"], "batch/p1000.md");

        // 分页稳定：从 cursor 续读到剩余 5 条，无重复无遗漏。
        let out = vault_list(
            &serde_json::json!({"path": "batch", "limit": 1001, "cursor": "batch/p1000.md"}),
            &ctx,
        );
        let entries = out.value["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 5, "{out:?}");
        assert_eq!(entries[0]["path"], "batch/p1001.md");
        assert_eq!(entries[4]["path"], "batch/p1005.md");
        assert_eq!(out.value["truncated"], false);
        assert!(out.value.get("next_cursor").is_none(), "{out:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// hidden 档不出现、lazy 档出现为一行且不下钻（与文件树 / vault_search 同一套分类）。
    #[test]
    fn vault_list_respects_hidden_and_lazy() {
        let (root, _policy) = fixture_vault("list-hidden-lazy");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: x\n").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "x\n").unwrap();
        std::fs::write(root.join("a.md"), "A\n").unwrap();
        let defaults = crate::config::VaultConfig::default();
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()], &defaults.ignore);
        let ctx = ctx(&root, &policy, &[]);

        let out = vault_list(&serde_json::json!({"recursive": true}), &ctx);
        let paths: Vec<&str> = out.value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["path"].as_str().unwrap())
            .collect();
        assert!(paths.contains(&"a.md"), "{paths:?}");
        assert!(
            paths.contains(&"node_modules"),
            "lazy 目录出一行：{paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.starts_with(".git")),
            "hidden 档不出现：{paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.starts_with("node_modules/")),
            "lazy 子树不展开（recursive 也不展开）：{paths:?}"
        );
        // 显式列出惰性目录本身同样为空（与 vault_search 不搜惰性条目同口径）：这是**决定**，
        // 不是漏实现——惰性语义是「不枚举」，不因调用方点名而改变。
        let out = vault_list(
            &serde_json::json!({"path": "node_modules", "recursive": true}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["entries"].as_array().unwrap().len(), 0, "{out:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 越界 / 非法目标各自有可区分错误码；不返回 vault 外任何条目。
    #[test]
    fn vault_list_rejects_out_of_vault_targets() {
        let (root, policy) = fixture_vault("list-reject");
        std::fs::write(root.join("a.md"), "A\n").unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let escape = vault_list(&serde_json::json!({"path": "../outside"}), &ctx);
        assert_eq!(escape.value["code"], "fs_path_escape", "{escape:?}");
        let absolute = vault_list(&serde_json::json!({"path": "/etc"}), &ctx);
        assert_eq!(absolute.value["code"], "list_path_absolute", "{absolute:?}");
        let missing = vault_list(&serde_json::json!({"path": "missing"}), &ctx);
        assert_eq!(missing.value["code"], "fs_not_found", "{missing:?}");
        let not_dir = vault_list(&serde_json::json!({"path": "a.md"}), &ctx);
        assert_eq!(not_dir.value["code"], "list_not_a_directory", "{not_dir:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 结果只含 `path` 与 `kind`：不返回正文、大小、时间（不把 vault_list 变成 find 的 JSON 翻版）。
    #[test]
    fn vault_list_returns_only_path_and_kind() {
        let (root, policy) = fixture_vault("list-shape");
        std::fs::write(root.join("big.md"), "内容".repeat(2000)).unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let out = vault_list(&serde_json::json!({}), &ctx);
        assert!(out.succeeded(), "{out:?}");
        for entry in out.value["entries"].as_array().unwrap() {
            let keys: Vec<&str> = entry
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            let mut keys = keys;
            keys.sort_unstable();
            assert_eq!(keys, vec!["kind", "path"], "{entry}");
        }
        let serialized = serde_json::to_string(&out.value).unwrap();
        assert!(!serialized.contains("内容"), "{serialized}");
        assert!(!serialized.contains("\"size\"") && !serialized.contains("mtime"));
        std::fs::remove_dir_all(&root).ok();
    }

    /// `cli_run` 的工作区合同（change add-harness-vault-workspace-list design §3）：子进程从当前
    /// vault 启动、`PWD` 同步、主进程 cwd 不变。
    #[test]
    fn cli_run_uses_vault_as_working_directory() {
        let (root, policy) = fixture_vault("cli-cwd");
        let ctx = ctx(&root, &policy, &[]);
        let before = std::env::current_dir().unwrap();
        let out = cli_run(&serde_json::json!({"command": "pwd"}), &ctx);
        assert!(out.succeeded(), "{out:?}");
        let printed = out.value["stdout"].as_str().unwrap().trim().to_string();
        assert_eq!(
            Path::new(&printed).canonicalize().unwrap(),
            root.canonicalize().unwrap(),
            "pwd 必须返回当前 vault（不是 /、不是主进程 cwd）"
        );
        // PWD 与真实工作目录一致（子进程看到的环境不撒谎）。
        let out = cli_run(
            &serde_json::json!({"command": "printenv", "args": ["PWD"]}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(
            out.value["stdout"].as_str().unwrap().trim(),
            root.display().to_string()
        );
        assert_eq!(
            std::env::current_dir().unwrap(),
            before,
            "主进程 cwd MUST NOT 被 cli_run 改动"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// A/B 两个 vault 各落自己的根（每次 spawn 独立设置，不依赖上次调用）。
    #[test]
    fn cli_run_roots_follow_current_vault() {
        let (root_a, policy_a) = fixture_vault("cli-cwd-a");
        let (root_b, policy_b) = fixture_vault("cli-cwd-b");
        let before = std::env::current_dir().unwrap();
        for (root, policy) in [(&root_a, &policy_a), (&root_b, &policy_b)] {
            let ctx = ctx(root, policy, &[]);
            let out = cli_run(&serde_json::json!({"command": "pwd"}), &ctx);
            assert!(out.succeeded(), "{out:?}");
            let printed = out.value["stdout"].as_str().unwrap().trim().to_string();
            assert_eq!(
                Path::new(&printed).canonicalize().unwrap(),
                root.canonicalize().unwrap()
            );
        }
        assert_eq!(std::env::current_dir().unwrap(), before);
        std::fs::remove_dir_all(&root_a).ok();
        std::fs::remove_dir_all(&root_b).ok();
    }

    #[test]
    fn patch_unique_hit_error_feeds_back() {
        let old = "foo\nbar\nfoo\n";
        let edits = vec![PatchEdit {
            old_string: "foo".into(),
            new_string: "x".into(),
        }];
        let err = apply_edits(old, &edits).unwrap_err();
        assert_eq!(err.value["code"], "patch_not_unique");
        let edits = vec![PatchEdit {
            old_string: "missing".into(),
            new_string: "x".into(),
        }];
        let err = apply_edits(old, &edits).unwrap_err();
        assert_eq!(err.value["code"], "patch_not_found");
        let edits = vec![PatchEdit {
            old_string: "bar".into(),
            new_string: "BAR".into(),
        }];
        assert_eq!(apply_edits(old, &edits).unwrap(), "foo\nBAR\nfoo\n");
    }

    #[test]
    fn create_refuses_existing_o_excl() {
        let (root, policy) = fixture_vault("create");
        std::fs::write(root.join("a.md"), "old").unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let out = vault_create(&serde_json::json!({"path": "a.md", "content": "new"}), &ctx);
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "fs_already_exists");
        // 父目录不存在 ⇒ 自动补建（mkdir -p 语义，change add-harness-permission-modes）。
        let out = vault_create(
            &serde_json::json!({"path": "sub/b.md", "content": "x"}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert!(root.join("sub").is_dir());
        let out = vault_create(&serde_json::json!({"path": "b.md", "content": "new"}), &ctx);
        assert!(out.succeeded());
        assert_eq!(std::fs::read_to_string(root.join("b.md")).unwrap(), "new");
        std::fs::remove_dir_all(&root).ok();
    }

    /// M410 r3 finding 的 harness 层用例：深层路径直接 vault_create 成功（mkdir -p 语义）。
    /// 父目录补建实际落在 `fs_io::vault_create_file` → `ensure_parent_dirs`（fs_io 专用、
    /// 唯一一份）；本用例钉的是「模型经工具层直调深层路径」这条承诺链不断（fs 层语义不改）。
    #[test]
    fn vault_create_deep_path_creates_missing_parents() {
        let (root, policy) = fixture_vault("create-deep");
        let ctx = ctx(&root, &policy, &[]);
        let out = vault_create(
            &serde_json::json!({"path": "deep/a/b/c.md", "content": "x"}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["path"], "deep/a/b/c.md");
        assert!(root.join("deep/a/b").is_dir());
        assert_eq!(
            std::fs::read_to_string(root.join("deep/a/b/c.md")).unwrap(),
            "x"
        );
        // 已存在的深层文件照样拒（O_EXCL 语义不随补建改变）。
        let out = vault_create(
            &serde_json::json!({"path": "deep/a/b/c.md", "content": "y"}),
            &ctx,
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "fs_already_exists");
        std::fs::remove_dir_all(&root).ok();
    }

    /// cli_run 的 purpose 校验（design §3.4）：缺省 / 空白串 / 纯空格同等拒绝，非空即过；
    /// 其他工具不受影响（本期 vault 写工具不加 purpose）。
    #[test]
    fn cli_purpose_requires_non_blank() {
        for args in [
            serde_json::json!({"command": "ls"}),
            serde_json::json!({"command": "ls", "purpose": ""}),
            serde_json::json!({"command": "ls", "purpose": "   "}),
            serde_json::json!({"command": "ls", "purpose": "\n\t"}),
            serde_json::json!({"command": "ls", "purpose": 1}),
        ] {
            let err = check_purpose("cli_run", &args).unwrap_err();
            assert_eq!(err.value["code"], "cli_purpose_missing", "{args}");
            assert!(
                err.value["message"].as_str().unwrap().contains("purpose"),
                "{args}"
            );
        }
        assert!(check_purpose(
            "cli_run",
            &serde_json::json!({"command": "ls", "purpose": " 列目录 "})
        )
        .is_ok());
        // 非 cli_run：恒过（purpose 不进判定层，也不给 vault 工具加这一字段）。
        assert!(check_purpose("vault_patch", &serde_json::json!({"path": "a.md"})).is_ok());
    }

    /// vault_move / vault_delete 的注册表路径与结果信封（成功 `{"ok": true, "path": …}`）。
    #[test]
    fn vault_move_and_delete_through_registry() {
        let (root, policy) = fixture_vault("move-delete");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("a.md"), "A").unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let out = execute(
            "vault_move",
            &serde_json::json!({"path": "a.md", "new_path": "sub/a.md"}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["path"], "sub/a.md");
        assert!(!root.join("a.md").exists());
        assert_eq!(std::fs::read_to_string(root.join("sub/a.md")).unwrap(), "A");

        let out = execute(
            "vault_delete",
            &serde_json::json!({"path": "sub/a.md"}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["path"], "sub/a.md");
        assert!(!root.join("sub/a.md").exists());
        // 逃逸路径照样被拒（两端防护）。
        let out = execute(
            "vault_move",
            &serde_json::json!({"path": "sub", "new_path": "../escaped"}),
            &ctx,
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "fs_path_escape");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 批准预览：cli_run 带完整 argv + purpose，vault_move / vault_delete 带路径清单。
    #[test]
    fn approval_previews_carry_command_paths_and_purpose() {
        let (root, policy) = fixture_vault("preview");
        std::fs::write(root.join("a.md"), "old").unwrap();
        let ctx = ctx(&root, &policy, &[]);

        let preview = approval_preview(
            "cli_run",
            &serde_json::json!({"command": "npm", "args": ["install"], "purpose": " 装依赖 "}),
            &ctx,
        )
        .unwrap();
        assert_eq!(
            preview.argv.unwrap(),
            vec!["npm".to_string(), "install".into()]
        );
        assert_eq!(preview.purpose.as_deref(), Some("装依赖"));

        let preview = approval_preview(
            "vault_move",
            &serde_json::json!({"path": "a.md", "new_path": "notes/b.md"}),
            &ctx,
        )
        .unwrap();
        assert_eq!(
            preview.argv.unwrap(),
            vec!["a.md".to_string(), "notes/b.md".into()]
        );
        assert!(preview.purpose.is_none());

        let preview =
            approval_preview("vault_delete", &serde_json::json!({"path": "a.md"}), &ctx).unwrap();
        assert_eq!(preview.argv.unwrap(), vec!["a.md".to_string()]);
        assert!(preview.diff.is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    /// 批准窗 CAS 的**接线**直测：预览取到的 revision 必须被当作执行基准，批准窗内文件被改即
    /// `document_conflict`。整合层的同一条链另见 `harness_runtime` 的
    /// `read_only_patch_approval_window_cas_conflict`（只读档 = Always Ask，patch 有批准窗）；
    /// 这条直测与档位无关，守住「接线本身不退化」。
    #[test]
    fn approval_preview_revision_guards_execute_window() {
        let (root, policy) = fixture_vault("cas-window");
        std::fs::write(root.join("a.md"), "old\n").unwrap();
        let ctx = ctx(&root, &policy, &[]);
        let args = serde_json::json!({
            "path": "a.md",
            "edits": [{"old_string": "old", "new_string": "patched"}],
        });
        let preview = approval_preview("vault_patch", &args, &ctx).unwrap();
        let revision = preview.revision.clone().expect("patch 预览带基准 revision");
        assert!(preview.diff.as_deref().unwrap().contains("-old"));

        // 批准窗内文件被外部修改 ⇒ 以预览基准执行必须被 CAS 拒掉（零覆盖）。
        std::fs::write(root.join("a.md"), "old\n用户手改\n").unwrap();
        let out = execute_with_revision("vault_patch", &args, &ctx, Some(&revision));
        assert!(!out.succeeded(), "{out:?}");
        assert_eq!(out.value["code"], "document_conflict");
        assert_eq!(
            std::fs::read_to_string(root.join("a.md")).unwrap(),
            "old\n用户手改\n"
        );

        // 同一参数走「执行时刻当前值」（None）则照常成功——证明上一条的失败来自基准对账，
        // 不是参数或命中语义错。`old_string` 在新内容里唯一命中 ⇒ 替换后为 patched + 用户那行。
        let out = execute_with_revision("vault_patch", &args, &ctx, None);
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(
            std::fs::read_to_string(root.join("a.md")).unwrap(),
            "patched\n用户手改\n"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// 工具集扩为 9：名字表、definitions 与 execute 注册表同源（清单外一律 tool_unknown）。
    #[test]
    fn tool_registry_has_nine_tools() {
        assert_eq!(TOOL_NAMES.len(), 9);
        let defined: Vec<String> = definitions()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(defined, TOOL_NAMES.to_vec());
        // cli_run 的 purpose 是 schema 必填（缺省即被入口校验拦下，但 schema 也要声明）。
        let cli = definitions()
            .into_iter()
            .find(|tool| tool["name"] == "cli_run")
            .unwrap();
        assert_eq!(
            cli["parameters"]["required"],
            serde_json::json!(["command", "purpose"])
        );
        // vault_list（change add-harness-vault-workspace-list）：参数面恰好五项、无必填项。
        let list = definitions()
            .into_iter()
            .find(|tool| tool["name"] == "vault_list")
            .unwrap();
        let mut properties: Vec<&str> = list["parameters"]["properties"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        properties.sort_unstable();
        assert_eq!(
            properties,
            vec!["cursor", "limit", "path", "path_glob", "recursive"]
        );
        assert!(
            list["parameters"].get("required").is_none(),
            "vault_list 全部参数可选：{list}"
        );
        assert_eq!(
            permission_subject(
                "vault_move",
                &serde_json::json!({"path": "a.md", "new_path": "b.md"})
            ),
            "a.md"
        );
        assert_eq!(
            permission_subject("vault_delete", &serde_json::json!({"path": "a.md"})),
            "a.md"
        );
        // argv 的单一取法：主体串由 cli_argv 拼出。
        let args = serde_json::json!({"command": "echo", "args": ["hi"], "purpose": "打招呼"});
        assert_eq!(cli_argv(&args), vec!["echo".to_string(), "hi".to_string()]);
        assert_eq!(permission_subject("cli_run", &args), "echo hi");
    }

    /// `vault_list` 的 description 承担「何时不该用它」的边界（change add-harness-vault-workspace-list
    /// 的内部证据：10/28 的真实会话里 vault_list 返回 0 条时归因不明，模型随后转去 `cli_run` 取
    /// 时间戳——见 `.local/reports/harness-tool-principles-oct29/internal-evidence.md` 的 F5）。
    /// 边界句一旦被删就回到旧描述，工具选择随之退回原状——逐句钉住，缺失时报出是哪一句。能力面
    /// （参数恰好五项、无必填）由 `tool_registry_has_nine_tools` 钉住，这里只钉文本，不另立一份
    /// schema 断言。
    #[test]
    fn vault_list_description_keeps_boundaries() {
        let list = definitions()
            .into_iter()
            .find(|tool| tool["name"] == "vault_list")
            .unwrap();
        let description = list["description"].as_str().unwrap();
        // design §5.1 的三组边界各句都钉住（删任何一句即红），失败信息点出缺的是哪一组、哪一句。
        for (group, clause) in [
            // ① 可见性与文件树同源：hidden 不可见、lazy 不展开、0 条有歧义。
            ("可见性", "可见性与文件树同源"),
            ("可见性", "hidden 条目不出现"),
            ("可见性", "lazy 子树只出一行不展开"),
            ("可见性", "也可能是被忽略规则过滤"),
            // ② 契约不返回的东西：正文，以及大小 / 修改时间 / 权限这类元数据。
            ("不返回", "不返回正文"),
            ("不返回", "不返回大小、修改时间、权限"),
            // ③ 越界能力的出口：元数据 / 隐藏项 / 多目标路径 / vault 外路径 → cli_run。
            ("cli_run 出口", "需要这些元数据、隐藏项"),
            ("cli_run 出口", "多目标路径或 vault 外路径时用 cli_run"),
        ] {
            assert!(
                description.contains(clause),
                "vault_list description 缺少「{group}」边界句「{clause}」：{description}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 调度工具（change add-cron-conversational-registration）
    // -----------------------------------------------------------------------

    struct CreatePort {
        outcome: cron::CronCreateOutcome,
        seen: std::sync::Mutex<Option<cron::CronTaskDraft>>,
    }

    impl CreatePort {
        fn new(outcome: cron::CronCreateOutcome) -> Self {
            Self {
                outcome,
                seen: std::sync::Mutex::new(None),
            }
        }
    }

    impl cron::CronPort for CreatePort {
        fn create(
            &self,
            draft: cron::CronTaskDraft,
        ) -> Result<cron::CronCreateOutcome, cron::CronToolError> {
            *self.seen.lock().unwrap() = Some(draft);
            Ok(self.outcome.clone())
        }
        fn list(&self) -> Result<Vec<cron::CronTaskSummary>, cron::CronToolError> {
            unreachable!("本用例不走 list")
        }
        fn remove(&self, _id: &str) -> Result<cron::CronRemoveOutcome, cron::CronToolError> {
            unreachable!("本用例不走 remove")
        }
    }

    struct ListPort(Vec<cron::CronTaskSummary>);

    impl cron::CronPort for ListPort {
        fn create(
            &self,
            _draft: cron::CronTaskDraft,
        ) -> Result<cron::CronCreateOutcome, cron::CronToolError> {
            unreachable!("本用例不走 create")
        }
        fn list(&self) -> Result<Vec<cron::CronTaskSummary>, cron::CronToolError> {
            Ok(self.0.clone())
        }
        fn remove(&self, _id: &str) -> Result<cron::CronRemoveOutcome, cron::CronToolError> {
            unreachable!("本用例不走 remove")
        }
    }

    struct FailPort(cron::CronToolError);

    impl cron::CronPort for FailPort {
        fn create(
            &self,
            _draft: cron::CronTaskDraft,
        ) -> Result<cron::CronCreateOutcome, cron::CronToolError> {
            Err(self.0.clone())
        }
        fn list(&self) -> Result<Vec<cron::CronTaskSummary>, cron::CronToolError> {
            Err(self.0.clone())
        }
        fn remove(&self, _id: &str) -> Result<cron::CronRemoveOutcome, cron::CronToolError> {
            Err(self.0.clone())
        }
    }

    fn cron_task(id: &str) -> crate::config::CronTask {
        crate::config::CronTask {
            id: id.to_string(),
            vault: "/tmp/vault-a".to_string(),
            at: "21:00".to_string(),
            days: crate::config::CronWeekday::ALL.to_vec(),
            prompt: "写今日 log".to_string(),
            delivery: crate::config::DeliveryPolicy::NotifyThenRun,
            session: crate::config::SessionShape::New,
            model: None,
        }
    }

    fn cron_ctx<'a>(
        root: &'a Path,
        policy: &'a IgnorePolicy,
        skills: &'a [SkillEntry],
        port: &'a dyn cron::CronPort,
    ) -> ToolContext<'a> {
        ToolContext {
            root,
            policy,
            skills,
            cron: Some(port),
        }
    }

    /// 三件调度工具的名字表与定义同源；`definitions()` 的 9 件清单不掺它们
    /// （cron 交接 / 子运行的白名单都以 `TOOL_NAMES` 为界）。
    #[test]
    fn cron_tool_definitions_match_the_name_table() {
        let defined: Vec<String> = cron_definitions()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            defined,
            CRON_TOOL_NAMES.map(str::to_string).to_vec(),
            "定义面与名字表必须同源"
        );
        for name in CRON_TOOL_NAMES {
            assert!(
                !TOOL_NAMES.contains(&name),
                "{name} 不属于 vault 工具名表（否则无人值守运行会拿到它）"
            );
            assert!(
                !definitions().iter().any(|tool| tool["name"] == name),
                "{name} 不在 9 件 vault 定义里"
            );
        }
        // `create` 的三个必填参数与 design §2.3 一致。
        let create = cron_definitions()
            .into_iter()
            .find(|tool| tool["name"] == "cron_task_create")
            .unwrap();
        assert_eq!(
            create["parameters"]["required"],
            serde_json::json!(["id", "at", "prompt"])
        );
    }

    /// 没有端口（无人值守运行 / 子运行）时，三件调度工具就是清单外的工具名：不可执行。
    #[test]
    fn cron_tools_are_unknown_without_a_port() {
        let (root, policy) = fixture_vault("cron-no-port");
        let skills: Vec<SkillEntry> = Vec::new();
        let empty_ctx = ctx(&root, &policy, &skills);
        let out = execute(
            "cron_task_create",
            &serde_json::json!({"id": "a", "at": "21:00", "prompt": "p"}),
            &empty_ctx,
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "tool_unknown");
        std::fs::remove_dir_all(&root).ok();
    }

    /// `create` 回执：参数 → 草稿的映射（`vault` 缺省填当前 vault 根）、`effect` / `skip_today`
    /// 原样投影。区分度：把 `skip_today` 写死 false、或漏掉 vault 缺省，本用例必 FAIL。
    #[test]
    fn cron_task_create_receipt_maps_draft_and_effect() {
        let (root, policy) = fixture_vault("cron-create");
        let skills: Vec<SkillEntry> = Vec::new();
        let port = CreatePort::new(cron::CronCreateOutcome {
            task: cron_task("daily-log"),
            effect: cron::CronEffect::Active,
            skip_today: true,
            notice: None,
        });
        let out = execute(
            "cron_task_create",
            &serde_json::json!({"id": "daily-log", "at": "21:00", "prompt": "写今日 log"}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert!(out.succeeded(), "{:?}", out.value);
        assert_eq!(out.value["effect"], "active");
        assert_eq!(out.value["skip_today"], serde_json::json!(true));
        assert_eq!(out.value["task"]["id"], "daily-log");
        assert_eq!(out.value["task"]["days"][0], "mon");
        assert_eq!(out.value["task"]["delivery"], "notify-then-run");

        let seen = port.seen.lock().unwrap().clone().expect("端口应收到草稿");
        assert_eq!(
            seen.vault,
            Some(serde_json::Value::String(root.display().to_string())),
            "vault 缺省必须落成当前 vault 根"
        );
        assert!(seen.days.is_none(), "没给的键不进草稿");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 注册回执的通知送不出去告知（M635）：`notice` 在场时原样进回执；缺席时回执里**没有这个
    /// 键**（不是空串）——模型按「有没有 notice」决定要不要转达，空串会被读成「说坏了但没话说」。
    #[test]
    fn cron_task_create_receipt_carries_notify_permission_notice() {
        let (root, policy) = fixture_vault("cron-create-notice");
        let skills: Vec<SkillEntry> = Vec::new();
        let notice = cron::notify_permission_notice(
            cron::NotifyPermission::Unrecognized,
            crate::config::UiLanguage::Zh,
        )
        .unwrap();

        let port = CreatePort::new(cron::CronCreateOutcome {
            task: cron_task("daily-log"),
            effect: cron::CronEffect::Active,
            skip_today: false,
            notice: Some(notice),
        });
        let out = execute(
            "cron_task_create",
            &serde_json::json!({"id": "daily-log", "at": "21:00", "prompt": "写今日 log"}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert!(out.succeeded(), "{:?}", out.value);
        assert_eq!(out.value["notice"], notice);

        let port = CreatePort::new(cron::CronCreateOutcome {
            task: cron_task("daily-log"),
            effect: cron::CronEffect::Active,
            skip_today: false,
            notice: None,
        });
        let out = execute(
            "cron_task_create",
            &serde_json::json!({"id": "daily-log", "at": "21:00", "prompt": "写今日 log"}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert!(out.succeeded(), "{:?}", out.value);
        assert!(
            out.value.get("notice").is_none(),
            "通知送得出去时回执 MUST NOT 出现 notice 键：{:?}",
            out.value
        );
        std::fs::remove_dir_all(&root).ok();
    }

    /// `list` 回执：`last_fired` 缺席时是 null；给出时原样带出。
    #[test]
    fn cron_task_list_receipt_reports_last_fired() {
        let (root, policy) = fixture_vault("cron-list");
        let skills: Vec<SkillEntry> = Vec::new();
        let mut summary = cron::CronTaskSummary {
            id: "a".to_string(),
            vault: "/tmp/v".to_string(),
            at: "21:00".to_string(),
            days: crate::config::CronWeekday::ALL.to_vec(),
            delivery: crate::config::DeliveryPolicy::NotifyThenRun,
            session: crate::config::SessionShape::New,
            last_fired: None,
        };
        let port = ListPort(vec![summary.clone()]);
        let out = execute(
            "cron_task_list",
            &serde_json::json!({}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert!(out.succeeded(), "{:?}", out.value);
        assert!(out.value["tasks"][0]["last_fired"].is_null());

        summary.last_fired = Some("2026-10-19".to_string());
        let port = ListPort(vec![summary]);
        let out = execute(
            "cron_task_list",
            &serde_json::json!({}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert_eq!(out.value["tasks"][0]["last_fired"], "2026-10-19");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 失败回执：错误码与 message 原样回送（模型据此重试）；缺 `id` 的 remove 被入口拦下。
    #[test]
    fn cron_tool_failures_use_the_structured_envelope() {
        let (root, policy) = fixture_vault("cron-fail");
        let skills: Vec<SkillEntry> = Vec::new();
        let port = FailPort(cron::CronToolError {
            code: "cron_task_not_found".to_string(),
            message: "任务 id \"x\" 不存在".to_string(),
            field: Some("id".to_string()),
            reason: Some("不存在该任务".to_string()),
            task: Some("x".to_string()),
        });
        let out = execute(
            "cron_task_remove",
            &serde_json::json!({"id": "x"}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "cron_task_not_found");
        assert!(out.value["message"].as_str().unwrap().contains("不存在"));

        let out = execute(
            "cron_task_remove",
            &serde_json::json!({"id": "  "}),
            &cron_ctx(&root, &policy, &skills, &port),
        );
        assert_eq!(out.value["code"], "cron_task_invalid");
        assert_eq!(out.value["message"], "id：缺失或不是字符串");
        std::fs::remove_dir_all(&root).ok();
    }

    /// 主体串（design §6.2）：`id + at + days`，**不含 prompt**；改 prompt 不改缓存键。
    #[test]
    fn cron_permission_subject_is_id_at_days_without_prompt() {
        let first = serde_json::json!({
            "id": "daily-log", "at": "21:00", "prompt": "写今日 log",
            "days": ["mon", "wed"]
        });
        let renamed_prompt = serde_json::json!({
            "id": "daily-log", "at": "21:00", "prompt": "换一段完全不同的载荷",
            "days": ["mon", "wed"]
        });
        let later = serde_json::json!({
            "id": "daily-log", "at": "22:00", "prompt": "写今日 log",
            "days": ["mon", "wed"]
        });
        assert_eq!(
            permission_subject("cron_task_create", &first),
            "daily-log 21:00 mon,wed"
        );
        assert_eq!(
            permission_subject("cron_task_create", &first),
            permission_subject("cron_task_create", &renamed_prompt),
            "改 prompt 不改变「它是哪条任务」"
        );
        assert_ne!(
            permission_subject("cron_task_create", &first),
            permission_subject("cron_task_create", &later),
            "改时间必须换缓存键"
        );
        assert_eq!(
            crate::harness::permission_cache::normalize_subject(&permission_subject(
                "cron_task_remove",
                &serde_json::json!({"id": "daily-log"})
            )),
            "daily-log",
            "remove 只有 id；空白由 permission_cache::normalize_subject 归一（缓存键口径）"
        );
        assert_eq!(
            permission_subject("cron_task_list", &serde_json::json!({})),
            ""
        );
    }

    /// 批准预览：`cron_task` 载荷带五要素 + prompt 全文 + `skip_today`；其余预览字段为空。
    #[test]
    fn cron_create_approval_preview_carries_the_five_elements() {
        let (root, policy) = fixture_vault("cron-preview");
        let skills: Vec<SkillEntry> = Vec::new();
        let args = serde_json::json!({
            "id": "daily-log", "at": "21:00", "prompt": "写今日 log",
            "days": ["mon"], "delivery": "run-then-notify", "session": "dedicated"
        });
        let preview = approval_preview("cron_task_create", &args, &ctx(&root, &policy, &skills))
            .expect("预览不校验参数");
        assert!(preview.diff.is_none());
        assert!(preview.argv.is_none());
        let cron_task = preview.cron_task.expect("create 预览必须带 cron_task");
        assert_eq!(cron_task["op"], "create");
        assert_eq!(cron_task["id"], "daily-log");
        assert_eq!(cron_task["at"], "21:00");
        assert_eq!(cron_task["days"], serde_json::json!(["mon"]));
        assert_eq!(cron_task["delivery"], "run-then-notify");
        assert_eq!(cron_task["session"], "dedicated");
        assert_eq!(cron_task["vault"], root.display().to_string());
        assert_eq!(cron_task["prompt"], "写今日 log");
        assert!(cron_task["skip_today"].is_boolean());
        std::fs::remove_dir_all(&root).ok();
    }

    /// 删除预览：id + at（at 从配置文件只读查出；文件不存在时为 null）。
    #[test]
    fn cron_remove_approval_preview_looks_up_the_existing_at() {
        let (root, policy) = fixture_vault("cron-preview-remove");
        let skills: Vec<SkillEntry> = Vec::new();
        let _xdg = crate::harness::xdg_test_lock();
        struct XdgGuard(Option<std::ffi::OsString>);
        impl Drop for XdgGuard {
            fn drop(&mut self) {
                match &self.0 {
                    Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                    None => std::env::remove_var("XDG_CONFIG_HOME"),
                }
            }
        }
        let _env = XdgGuard(std::env::var_os("XDG_CONFIG_HOME"));
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::fs::create_dir_all(root.join("xdg/lumir")).unwrap();
        std::fs::write(
            root.join("xdg/lumir/config.json"),
            r#"{"cron":{"tasks":[{"id":"daily-log","vault":"/tmp/v","at":"21:00","prompt":"p"}]}}"#,
        )
        .unwrap();

        let preview = approval_preview(
            "cron_task_remove",
            &serde_json::json!({"id": "daily-log"}),
            &ctx(&root, &policy, &skills),
        )
        .unwrap();
        let cron_task = preview.cron_task.expect("remove 预览必须带 cron_task");
        assert_eq!(cron_task["op"], "remove");
        assert_eq!(cron_task["id"], "daily-log");
        assert_eq!(cron_task["at"], "21:00");

        let preview = approval_preview(
            "cron_task_remove",
            &serde_json::json!({"id": "missing"}),
            &ctx(&root, &policy, &skills),
        )
        .unwrap();
        assert!(preview.cron_task.unwrap()["at"].is_null());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skill_load_confined_to_skill_root() {
        let (root, policy) = fixture_vault("skill");
        std::fs::create_dir_all(root.join(".agents/skills/demo")).unwrap();
        std::fs::write(root.join(".agents/skills/demo/SKILL.md"), "demo body").unwrap();
        std::fs::write(root.join(".agents/skills/demo/secret.txt"), "nope").unwrap();
        std::fs::write(root.join("outside.txt"), "outside").unwrap();
        let skills = super::super::context::discover_skills(&root);
        let ctx = ctx(&root, &policy, &skills);
        let out = skill_load(&serde_json::json!({"name": "demo"}), &ctx);
        assert!(out.succeeded());
        assert_eq!(out.value["content"], "demo body");
        let out = skill_load(&serde_json::json!({"name": "../demo"}), &ctx);
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "skill_name_invalid");
        let out = skill_load(
            &serde_json::json!({"name": "demo", "file": "../outside.txt"}),
            &ctx,
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "skill_path_escape");
        let out = skill_load(&serde_json::json!({"name": "missing"}), &ctx);
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "skill_not_found");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cli_runs_argv_without_shell() {
        let (root, policy) = fixture_vault("cli-argv");
        let ctx = ctx(&root, &policy, &[]);
        let out = cli_run(
            &serde_json::json!({"command": "echo", "args": ["hi"]}),
            &ctx,
        );
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["stdout"].as_str().unwrap().trim(), "hi");
        let out = cli_run(
            &serde_json::json!({"command": "definitely-not-a-real-cmd-xyz"}),
            &ctx,
        );
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "cli_spawn_failed");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn parse_marked_path_isolates_path_from_chatter() {
        assert_eq!(
            parse_marked_path(&format!("{PATH_MARKER_START}/a:/b{PATH_MARKER_END}")).as_deref(),
            Some("/a:/b")
        );
        // 启动文件杂输出落在标记前后都不进结果（尾部杂输出是「取整行」口径会踩的坑）。
        let noisy = format!(
            "pyenv: init ok\nwarning: whatever\n{PATH_MARKER_START}/usr/bin:/bin{PATH_MARKER_END}\nbye\n"
        );
        assert_eq!(parse_marked_path(&noisy).as_deref(), Some("/usr/bin:/bin"));
        // 「读不到」不是「为空」：标记缺失 / 只有起点 / 中间为空白，一律 None。
        assert_eq!(parse_marked_path("no markers here"), None);
        assert_eq!(parse_marked_path(PATH_MARKER_START), None);
        assert_eq!(
            parse_marked_path(&format!("{PATH_MARKER_START}{PATH_MARKER_END}")),
            None
        );
        assert_eq!(
            parse_marked_path(&format!("{PATH_MARKER_START}   {PATH_MARKER_END}")),
            None
        );
    }

    #[test]
    fn merge_paths_prefers_resolved_and_appends_inherited_extras() {
        // 解析成功：解析结果在前，继承里多出的目录追加在后，重复目录只留一份。
        assert_eq!(
            merge_paths(Some("/a:/b"), Some("/b:/c:/a")).as_deref(),
            Some("/a:/b:/c")
        );
        // 无继承值：原样用解析结果（空段丢弃）。
        assert_eq!(
            merge_paths(Some("/a::/a:/b"), None).as_deref(),
            Some("/a:/b")
        );
        // 解析失败（None / 空白）⇒ 不改环境，回退继承（None = 不注入）。
        assert_eq!(merge_paths(None, Some("/usr/bin:/bin")), None);
        assert_eq!(merge_paths(Some("   "), Some("/usr/bin")), None);
        assert_eq!(merge_paths(None, None), None);
    }

    #[test]
    fn login_shell_flags_only_for_known_shells() {
        assert_eq!(
            login_shell_flags(Path::new("/bin/zsh")),
            Some(["-l", "-i", "-c"])
        );
        assert_eq!(
            login_shell_flags(Path::new("/usr/local/bin/bash")),
            Some(["-l", "-i", "-c"])
        );
        // 未知 shell 不猜旗标 ⇒ 回落继承 PATH。
        assert_eq!(login_shell_flags(Path::new("/opt/homebrew/bin/fish")), None);
        assert_eq!(login_shell_flags(Path::new("nu")), None);
    }

    /// 子运行摘要信封的截断（§3.4）：空串原样、恰好上限不截断、超限保留头尾并显式标记。
    #[test]
    fn task_summary_truncation_keeps_head_and_tail() {
        let (empty, truncated) = truncate_task_summary("");
        assert_eq!(empty, "");
        assert!(!truncated);

        let exact: String = "a".repeat(TASK_SUMMARY_LIMIT);
        let (kept, truncated) = truncate_task_summary(&exact);
        assert_eq!(kept.chars().count(), TASK_SUMMARY_LIMIT);
        assert!(!truncated);

        let long: String = "0123456789".repeat(900);
        let (cut, truncated) = truncate_task_summary(&long);
        assert!(truncated);
        assert!(cut.contains("…[截断]…"));
        assert!(cut.starts_with("0123456789"));
        assert!(cut.ends_with("0123456789"));
        assert!(cut.chars().count() <= TASK_SUMMARY_LIMIT + "…[截断]…".chars().count());
    }

    /// 受控假 shell：验证「起子进程 → 夹取标记 → 解析」完整链路。真 zsh 会读用户启动文件，
    /// 结果随本机环境变，不能拿来做确定性断言；这里用脚本模拟 shell 执行 `-c` 命令。
    #[cfg(unix)]
    fn fake_shell(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn resolve_path_via_shell_round_trips_marker() {
        let dir = std::env::temp_dir().join(format!("lumir-shell-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // argv = <fake> -l -i -c <script>；shift 3 后 eval 那段脚本（等价于 shell 执行命令）。
        let shell = fake_shell(&dir, "zsh", "shift 3\neval \"$1\"");
        let got = resolve_path_via_shell(&shell, std::time::Duration::from_secs(5));
        let got = got.expect("假 shell 应回传夹取标记里的 PATH");
        assert!(got.contains('/'), "解析结果不像 PATH：{got}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn resolve_path_via_shell_fails_closed_on_hang() {
        let dir = std::env::temp_dir().join(format!("lumir-shell-hang-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // exec 让 sleep 顶替 /bin/sh 本体，kill 能直接收掉（不留 30s 孤儿进程）。
        let shell = fake_shell(&dir, "zsh", "exec sleep 30");
        let started = std::time::Instant::now();
        let got = resolve_path_via_shell(&shell, std::time::Duration::from_millis(300));
        assert_eq!(got, None, "挂住的 shell 必须判 None（回退继承）");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "超时未生效，实际耗时 {:?}",
            started.elapsed()
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 真 zsh 冒烟（可选）：/bin/zsh 存在才跑。登录 + 交互会读用户启动文件，结果随环境变，
    /// 故只断言「解析成功且像个 PATH」，不逐字断言。CI 干净环境与开发机都应通过。
    #[cfg(unix)]
    #[test]
    fn resolve_login_shell_path_from_real_zsh() {
        if !Path::new("/bin/zsh").exists() {
            return;
        }
        let got = resolve_path_via_shell(Path::new("/bin/zsh"), std::time::Duration::from_secs(10));
        let got = got.expect("/bin/zsh -l -i -c 应能解析出 PATH");
        assert!(got.contains(':'), "解析结果不像 PATH：{got}");
        assert!(
            got.contains("/usr/bin") || got.contains("/bin"),
            "缺基本目录：{got}"
        );
    }
}
