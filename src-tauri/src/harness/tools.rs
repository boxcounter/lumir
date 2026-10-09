//! 工具集（design §4）：**恰好 8 个**——vault_read / vault_search / vault_patch /
//! vault_create / vault_move / vault_delete / skill_load / cli_run。清单外扩张须经 Alex 裁决
//! （ADR 0007）；本次扩张（vault_move / vault_delete）即 change add-harness-permission-modes
//! 的 Alex 节点 1 裁决。
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

use std::io::Read;
use std::path::{Component, Path};
use std::process::Stdio;

use serde::Deserialize;

use crate::fs_io::{self, IgnorePolicy, PatchEdit};

use super::context::SkillEntry;
use super::diff;

/// 工具执行上下文（vault 作用域 + 会话建立时快照的 Skill 清单）。
pub struct ToolContext<'a> {
    pub root: &'a Path,
    pub policy: &'a IgnorePolicy,
    pub skills: &'a [SkillEntry],
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
}

impl ApprovalPreview {
    fn empty() -> Self {
        Self {
            diff: None,
            argv: None,
            revision: None,
            purpose: None,
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

/// 8 个工具的名字表（恰好清单；execute 的 match 以此为准）。
pub const TOOL_NAMES: [&str; 8] = [
    "vault_read",
    "vault_search",
    "vault_patch",
    "vault_create",
    "vault_move",
    "vault_delete",
    "skill_load",
    "cli_run",
];

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
/// vault_search = path_glob（无则 query）。
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
        _ => args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    }
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
        "vault_patch" => vault_patch(args, ctx, revision),
        "vault_create" => vault_create(args, ctx),
        "vault_move" => vault_move(args, ctx),
        "vault_delete" => vault_delete(args, ctx),
        "skill_load" => skill_load(args, ctx),
        "cli_run" => cli_run(args),
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
            })
        }
        "vault_create" => {
            let input = parse_args::<CreateArgs>(args)?;
            Ok(ApprovalPreview {
                diff: Some(diff::unified_diff(&input.path, "", &input.content)),
                argv: None,
                revision: None,
                purpose: None,
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
            })
        }
        _ => Ok(ApprovalPreview::empty()),
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
    match fs_io::fs_patch_file(ctx.root, &input.path, &input.edits, &revision) {
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
    match fs_io::vault_create_file(ctx.root, &input.path, &input.content) {
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
    match fs_io::fs_move_entry(ctx.root, &input.path, &input.new_path) {
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
fn vault_delete(args: &serde_json::Value, ctx: &ToolContext) -> ToolOutput {
    let input = match parse_args::<DeleteArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    match fs_io::trash_entry(ctx.root, &input.path) {
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

fn cli_run(args: &serde_json::Value) -> ToolOutput {
    let input = match parse_args::<CliArgs>(args) {
        Ok(input) => input,
        Err(output) => return output,
    };
    if input.command.trim().is_empty() {
        return ToolOutput::err("cli_command_empty", "command 为空");
    }
    let mut child = match std::process::Command::new(&input.command)
        .args(&input.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
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
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()]);
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
        let policy = IgnorePolicy::load(&root, &[".gitignore".to_string()]);
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

    /// 批准窗 CAS 的**接线**直测（模式设计变更后 patch 不再进批准闸，整合层那条用例已退役——
    /// 见 `harness_runtime` 的 `vault_patch_bypasses_gate_and_writes_immediately_in_default_mode`）：
    /// 预览取到的 revision 必须被当作执行基准，批准窗内文件被改即 `document_conflict`。
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

    /// 工具集扩为 8：名字表、definitions 与 execute 注册表同源（清单外一律 tool_unknown）。
    #[test]
    fn tool_registry_has_eight_tools() {
        assert_eq!(TOOL_NAMES.len(), 8);
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
        let out = cli_run(&serde_json::json!({"command": "echo", "args": ["hi"]}));
        assert!(out.succeeded(), "{out:?}");
        assert_eq!(out.value["stdout"].as_str().unwrap().trim(), "hi");
        let out = cli_run(&serde_json::json!({"command": "definitely-not-a-real-cmd-xyz"}));
        assert!(!out.succeeded());
        assert_eq!(out.value["code"], "cli_spawn_failed");
    }
}
