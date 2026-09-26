//! 文件 IO / 监听 —— 全类型递归枚举 + watch 增量事件流（add-vault-workspace）。
//!
//! 职责见 ADR 0002 §3：vault 内文件的读取与变更监听全部在 Rust core 完成，
//! webview 不直接触文件系统。架构约束见 ADR 0002 §7：本模块不依赖 tauri/UI
//! 类型——watch 以 `impl Fn(Vec<FsChange>)` 回调交付纯数据，由 commands 层
//! 决定如何 emit 成 `fs:entry_changed` 事件。
//!
//! 文本文档保存使用同目录临时文件替换目标：可保存面是注册表全部文本类（md / code / text
//! 三族，editable-non-md-files 起），image/binary 类扩展名被拒绝（见 [`save_document`]）。
//! 枚举路径顺带惰性清除超龄的跨进程保存 tmp ghost（磁盘隐形累积治理，
//! 阈值见 [`GHOST_TMP_MAX_AGE`]，在途写入不受影响）。

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use ts_rs::TS;

use crate::commands::CommandError;

/// 硬编码忽略集（裁决点 C）：一等公民的是文件类型，不是 VCS 内部目录。
/// `.git` 含数万对象文件，枚举它会直接威胁性能合同（ADR 0002 §6）。
/// 枚举与 watch 共用此集合；本 change 内不可配置。保存临时文件
/// （`.{name}.lumir-{pid}`，见 [`save_document`]）经 `is_ignored` 的模式
/// 规则一并忽略：进程崩溃会留下 ghost，ghost 不进文件树、不产生 watch 事件。
pub const IGNORED_NAMES: [&str; 3] = [".git", ".DS_Store", "node_modules"];

/// 单附件大小上限（spec：建议 50MB），防止误读大文件撑破常驻内存合同。
pub const ATTACHMENT_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// watch 事件 debounce 窗口（裁决点 B）：窗口内连续事件合并为一批推送。
pub const DEBOUNCE: Duration = Duration::from_millis(100);

/// 保存临时文件 ghost 的年龄阈值：超过此值的 `.lumir-` 残留由枚举路径惰性
/// 清除（见 [`scan_workspace`]）。同进程保存的 tmp 生命周期是毫秒级
/// （create → rename），在途写入远年轻于此阈值，不会被误删；只有进程崩溃
/// 留下的跨进程 ghost 才会超龄。
pub const GHOST_TMP_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// 条目类型：文件 / 目录。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FsEntryKind {
    File,
    Dir,
}

/// 枚举条目：相对路径（`/` 分隔）、类型、大小、mtime（Unix 毫秒）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsEntry {
    /// 相对 vault 根的路径，`/` 分隔。
    pub path: String,
    pub kind: FsEntryKind,
    /// 字节数；目录为 0。
    #[ts(type = "number")]
    pub size: u64,
    /// 修改时间（Unix 毫秒）；取不到时为 null。
    #[ts(type = "number | null")]
    pub mtime_ms: Option<i64>,
}

/// watch 增量类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum FsChangeKind {
    Created,
    Modified,
    Deleted,
}

/// 单条增量：变更类型 + 相对路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsChange {
    pub kind: FsChangeKind,
    /// 相对 vault 根的路径，`/` 分隔。
    pub path: String,
    /// 条目类型（file/dir），deleted 时为 null——前端据此知道新增节点是文件还是目录。
    pub entry_kind: Option<FsEntryKind>,
}

/// `fs:entry_changed` 事件 payload：debounce 窗口合并后的一批增量（同路径去重，后发生者胜）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FsEntryChangedEvent {
    pub changes: Vec<FsChange>,
}

/// 保存临时文件模式：`.` 开头且含 `.lumir-`（如 `.note.md.lumir-123`）。
/// 精确匹配模式而非全部点文件——vault 里合法的 `.obsidian` 配置目录等
/// 仍须正常枚举。
fn is_lumir_tmp(name: &std::ffi::OsStr) -> bool {
    match name.to_str() {
        Some(s) => s.starts_with('.') && s.contains(".lumir-"),
        None => false,
    }
}

fn is_ignored(name: &std::ffi::OsStr) -> bool {
    IGNORED_NAMES.iter().any(|n| name == *n) || is_lumir_tmp(name)
}

/// 超龄 ghost tmp 惰性清除（best-effort）：仅删「名字命中 tmp 模式 + 是普通
/// 文件 + mtime 早于 `now - GHOST_TMP_MAX_AGE`」的目标。合法点文件与符号
/// 链接不动；删除失败（权限等）静默忽略——治理不得让枚举失败。
fn remove_ghost_tmp_if_stale(path: &Path, now: SystemTime) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    let Ok(mtime) = meta.modified() else {
        return false;
    };
    // 时钟回拨（mtime 晚于 now）时 duration_since 报错 → 一律视为未超龄
    let Ok(age) = now.duration_since(mtime) else {
        return false;
    };
    age >= GHOST_TMP_MAX_AGE && std::fs::remove_file(path).is_ok()
}

/// 把绝对路径转成相对 vault 根的 `/` 分隔字符串；在忽略集内或无法转换时返回 None。
fn rel_string(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => {
                if is_ignored(s) {
                    return None;
                }
                parts.push(s.to_str()?);
            }
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> Option<i64> {
    let t = meta.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_millis() as i64)
}

/// 全类型递归枚举（不按扩展名过滤，按 [`IGNORED_NAMES`] 过滤）。
/// 结果按路径排序，保证确定性；目录在前、同缀按名称的展示排序由文件树 UI 负责。
/// 顺带做保存临时文件 ghost 的惰性清除（超龄才删，见 [`GHOST_TMP_MAX_AGE`]）。
pub fn scan_workspace(root: &Path) -> Result<Vec<FsEntry>, CommandError> {
    scan_workspace_at(root, SystemTime::now())
}

/// 枚举实现本体；`now` 可注入，使 ghost tmp 的年龄判定在测试中确定可控。
fn scan_workspace_at(root: &Path, now: SystemTime) -> Result<Vec<FsEntry>, CommandError> {
    if !root.is_dir() {
        return Err(CommandError::new(
            "fs_root_not_dir",
            format!("vault 路径不是目录：{}", root.display()),
        ));
    }
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rd = std::fs::read_dir(&dir).map_err(|e| {
            CommandError::new(
                "fs_scan_failed",
                format!("无法读取目录 {}：{e}", dir.display()),
            )
        })?;
        for item in rd {
            let item = item.map_err(|e| {
                CommandError::new(
                    "fs_scan_failed",
                    format!("无法读取目录 {} 下的条目：{e}", dir.display()),
                )
            })?;
            let name = item.file_name();
            if is_ignored(&name) {
                // 跨进程崩溃残留的 tmp ghost 在磁盘隐形累积：枚举路径顺带清除
                // 超龄者；在途保存的 tmp（毫秒级）与合法点文件都不受影响
                if is_lumir_tmp(&name) {
                    remove_ghost_tmp_if_stale(&item.path(), now);
                }
                continue;
            }
            let path = item.path();
            // file_type() 不跟随 symlink：指向目录的 symlink 不递归展开。
            // 否则循环 symlink 会沿链接重复枚举直至 ELOOP 让 open_vault 失败，
            // 外部 symlink 会把 vault 外整棵树枚举进文件树（威胁 ADR 0002 §6
            // 性能合同）。symlink 条目按文件列出，读取侧由 resolve_in_vault
            // 兜底拒绝逃逸。
            let ft = match item.file_type() {
                Ok(ft) => ft,
                Err(_) => continue, // 扫描期间被删的条目直接跳过
            };
            let kind = if ft.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            };
            let Some(rel) = rel_string(root, &path) else {
                continue;
            };
            if kind == FsEntryKind::Dir {
                stack.push(path.clone());
            }
            // symlink_metadata 不跟随：symlink 条目取链接自身的元数据，
            // 避免对循环 symlink follow 时撞 ELOOP。
            let meta = std::fs::symlink_metadata(&path).ok();
            entries.push(FsEntry {
                path: rel,
                kind,
                size: meta.as_ref().filter(|m| m.is_file()).map_or(0, |m| m.len()),
                mtime_ms: meta.as_ref().and_then(mtime_ms),
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

/// vault 内路径约束（安全边界，不依赖调用方自觉）：
/// 拒绝绝对路径、`..` 穿越、符号链接逃逸；目标必须存在。
/// 返回规范化后的绝对路径。
pub fn resolve_in_vault(root: &Path, rel: &str) -> Result<PathBuf, CommandError> {
    let rel_path = Path::new(rel);
    if rel.is_empty() {
        return Err(CommandError::new("fs_path_invalid", "路径为空"));
    }
    if rel_path.is_absolute() {
        return Err(CommandError::new(
            "fs_path_escape",
            format!("只允许 vault 内的相对路径：{rel}"),
        ));
    }
    if rel_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(CommandError::new(
            "fs_path_escape",
            format!("路径不允许包含 ..：{rel}"),
        ));
    }
    let candidate = root.join(rel_path);
    let canon = candidate.canonicalize().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            CommandError::new("fs_not_found", format!("文件不存在：{rel}"))
        } else {
            CommandError::new("fs_read_failed", format!("无法访问 {rel}：{e}"))
        }
    })?;
    let canon_root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
    })?;
    if !canon.starts_with(&canon_root) {
        return Err(CommandError::new(
            "fs_path_escape",
            format!("路径指向 vault 之外（符号链接逃逸）：{rel}"),
        ));
    }
    Ok(canon)
}

/// 路径的父段（vault 相对，`/` 分隔）：`a/b/c` → `a/b`，无父段则空串。
fn parent_rel_of(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

/// 拼接 vault 相对路径（父段为空串即根下条目）。
fn join_rel(parent_rel: &str, name: &str) -> String {
    if parent_rel.is_empty() {
        name.to_string()
    } else {
        format!("{parent_rel}/{name}")
    }
}

/// 新建 / 改名的末段名校验（**唯一一份**，五个写类命令共用；忽略集复用 [`is_ignored`]
/// 的真源，不另抄一份列表——REVIEW.md 第 8 条）。
///
/// 规则（design §2.3）：非空、不含 `/`、不是 `.` / `..`、不命中枚举忽略集。忽略集那条
/// 不是洁癖：`.git` 这类名字建/改出来不进文件树、watch 事件也被 `rel_string` 吞掉，
/// 用户在界面上既看不到也删不掉——静默丢失的温床，因此在入口就拒绝。
pub fn validate_new_name(name: &str) -> Result<(), CommandError> {
    if name.is_empty() {
        return Err(CommandError::new("fs_name_invalid", "名称不能为空"));
    }
    if name.contains('/') {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("名称不能包含斜杠：{name}"),
        ));
    }
    if name == "." || name == ".." {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("{name} 不是有效的名称"),
        ));
    }
    if is_ignored(std::ffi::OsStr::new(name)) {
        return Err(CommandError::new(
            "fs_name_invalid",
            format!("{name} 在忽略集内，建成后不会出现在文件树里"),
        ));
    }
    Ok(())
}

/// 新建 / 改名的目标解析变体（写类命令的**共用一个入口**，安全边界不分散）。
///
/// 与 [`resolve_in_vault`] 的差别：目标**允许不存在**。因此父目录仍走
/// `resolve_in_vault`（继承全部逃逸防护：绝对路径 / `..` / 符号链接逃逸），
/// 末段名单独过 [`validate_new_name`]，join 之后只做 `symlink_metadata` 存在性探测
/// ——已存在即 `fs_already_exists`（不跟随后续 canonicalize，目标本来就允许不存在）。
/// 这条探测是**早失败的人话错误**，不是「撞名不覆盖」的保证本身——两种调用方的保证来源
/// 不同，别在这里读出一条不存在的原子性：
///
/// - [`create_file_entry`] / [`create_dir_entry`]：保证来自创建调用本身
///   （`create_new(true)` / `create_dir` 撞名即失败），**不存在**检查-创建窗口。
/// - [`rename_entry`]：`std::fs::rename` 的 POSIX 语义是**原子替换**已存在的目标，因此
///   这里的探测与随后的 `rename` 之间确实有一个检查-执行窗口（`rename_entry` 在写路径上
///   又显式复查了一次，把窗口收窄到两次系统调用之间；真要做到零窗口需要平台的原子排他改名，
///   本批不做——[`rename_entry`] 的注释写明取舍）。
pub fn resolve_new_in_vault(
    root: &Path,
    parent_rel: &str,
    name: &str,
) -> Result<PathBuf, CommandError> {
    validate_new_name(name)?;
    let parent = if parent_rel.is_empty() {
        root.canonicalize().map_err(|e| {
            CommandError::new(
                "fs_root_invalid",
                format!("无法解析 vault 根 {}：{e}", root.display()),
            )
        })?
    } else {
        resolve_in_vault(root, parent_rel)?
    };
    let meta = std::fs::metadata(&parent)
        .map_err(|e| CommandError::new("fs_read_failed", format!("无法访问 {parent_rel}：{e}")))?;
    if !meta.is_dir() {
        return Err(CommandError::new(
            "fs_path_invalid",
            format!("{parent_rel} 不是目录"),
        ));
    }
    let target = parent.join(name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{}", join_rel(parent_rel, name)),
        ));
    }
    Ok(target)
}

/// 移到系统废纸篓（裁决点 2）：删除必须可恢复，MUST NOT 提供永久删除路径。
///
/// 目录连子孙整棵入篓由 `trash` 的平台语义承担（macOS = NSFileManager 的 trashItem，
/// 在 Finder 里可整体放回）。失败即报错且**不留半删除状态**——crate 的删除是单次系统
/// 调用语义，这也是提示语里「未删除任何内容」承诺的依据（design §3.1）。
pub fn trash_entry(root: &Path, rel: &str) -> Result<(), CommandError> {
    let abs = resolve_in_vault(root, rel)?;
    // 空 rel 已在 resolve_in_vault 里被拒（fs_path_invalid）；这里再挡一次「解析结果
    // 就是 vault 根」的形态（防御性：vault 根永远不进废纸篓）。
    let canon_root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
    })?;
    if abs == canon_root {
        return Err(CommandError::new(
            "fs_trash_failed",
            format!("不能把 vault 根目录移到废纸篓：{rel}"),
        ));
    }
    trash::delete(&abs).map_err(|e| {
        // trash::Error 的 Display 是内部 Debug 结构（英文、带字段名），人话在前、
        // 原始错误附在尾部只作排查线索。
        CommandError::new(
            "fs_trash_failed",
            format!("移到废纸篓失败：{rel}——未删除任何内容（{e}）"),
        )
    })
}

/// 同目录改末段名（v1 不支持跨目录移动，proposal 非目标）。源走 [`resolve_in_vault`]，
/// 目标走 [`resolve_new_in_vault`]（父 = 源的父目录），并在**写路径上再复查一次**目标是否
/// 已存在——MUST NOT 覆盖既有条目。返回改名后的 vault 相对路径。
///
/// 为什么写路径要再查一次：`std::fs::rename` 的 POSIX 语义是**原子替换**已存在的目标
/// （不是「撞名即失败」），所以 `resolve_new_in_vault` 里那次探测与这里的 `rename` 之间
/// 存在真实的检查-执行窗口——窗口内外部进程在目标名建出的文件会被静默覆盖。这个复查把窗口
/// 收窄到两次系统调用之间，代价是一次 `symlink_metadata`；风险本身极低（单用户本地 vault、
/// 亚毫秒窗口、需外部进程精准撞名），失败方向也安全（宁可多报一次「已存在」也不覆盖）。
/// 真要做到零窗口需要平台的原子排他改名（macOS 的 `renamex_np(RENAME_EXCL)`，其余平台各有
/// 对应物），本批不做：那要引 libc/平台分支，收益与风险不成比例。**因此「撞名不覆盖」在
/// rename 这条路上是「复查 + 极窄窗口」，不是原子保证**——别在别处读成更强的东西。
pub fn rename_entry(root: &Path, rel: &str, new_name: &str) -> Result<String, CommandError> {
    let from = resolve_in_vault(root, rel)?;
    let parent_rel = parent_rel_of(rel).to_string();
    let to = resolve_new_in_vault(root, &parent_rel, new_name)?;
    // 写路径复查（见上面注释）：与 create 路径同一个错误码与同一句话，前端不必分辨来源。
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{}", join_rel(&parent_rel, new_name)),
        ));
    }
    std::fs::rename(&from, &to).map_err(|e| {
        CommandError::new(
            "fs_rename_failed",
            format!("改名失败：{rel} → {new_name}（{e}）"),
        )
    })?;
    Ok(join_rel(&parent_rel, new_name))
}

/// 在目录下新建**空文件**（§3.5）：目标走 [`resolve_new_in_vault`]，创建用
/// `create_new(true)` 的原子语义——撞名由内核裁定，MUST NOT 覆盖既有文件。
/// 返回新建条目的 vault 相对路径。
pub fn create_file_entry(
    root: &Path,
    parent_rel: &str,
    name: &str,
) -> Result<String, CommandError> {
    let target = resolve_new_in_vault(root, parent_rel, name)?;
    let path = join_rel(parent_rel, name);
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{path}"),
        )),
        Err(e) => Err(CommandError::new(
            "fs_create_failed",
            format!("无法新建 {path}：{e}"),
        )),
    }
}

/// 在目录下新建子目录（§3.6）：与 [`create_file_entry`] 同构，`create_dir` 本身撞名即报
/// `AlreadyExists`，原子语义等价。新建目录 MUST NOT 自动展开父目录（折叠态是用户状态）。
pub fn create_dir_entry(root: &Path, parent_rel: &str, name: &str) -> Result<String, CommandError> {
    let target = resolve_new_in_vault(root, parent_rel, name)?;
    let path = join_rel(parent_rel, name);
    match std::fs::create_dir(&target) {
        Ok(()) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CommandError::new(
            "fs_already_exists",
            format!("已存在同名条目：{path}"),
        )),
        Err(e) => Err(CommandError::new(
            "fs_create_failed",
            format!("无法新建 {path}：{e}"),
        )),
    }
}

/// 单文件 mtime（Unix 毫秒，M218 doc-meta「修改于」的数据源）：路径口径与读取链路
/// 同一个 `resolve_in_vault`；mtime 取不到（权限 / 平台不支持）为 `Ok(None)`，
/// 与 `FsEntry.mtime_ms` 同口径。
pub fn file_mtime_ms(root: &Path, rel: &str) -> Result<Option<i64>, CommandError> {
    let path = resolve_in_vault(root, rel)?;
    let meta = std::fs::metadata(&path)
        .map_err(|e| CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}")))?;
    Ok(mtime_ms(&meta))
}

/// 读取 vault 内文件并校验大小上限（人话错误，不分配超限内存）。
fn read_file_bytes(root: &Path, rel: &str, max: u64) -> Result<Vec<u8>, CommandError> {
    let path = resolve_in_vault(root, rel)?;
    let meta = std::fs::metadata(&path)
        .map_err(|e| CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}")))?;
    if !meta.is_file() {
        return Err(CommandError::new(
            "fs_not_a_file",
            format!("{rel} 不是文件（可能是目录）"),
        ));
    }
    if meta.len() > max {
        return Err(CommandError::new(
            "fs_too_large",
            format!(
                "文件 {rel} 大小 {}MB，超过 {}MB 上限，已拒绝读取",
                meta.len() / (1024 * 1024),
                max / (1024 * 1024)
            ),
        ));
    }
    std::fs::read(&path)
        .map_err(|e| CommandError::new("fs_read_failed", format!("无法读取 {rel}：{e}")))
}

/// 读文本文件：UTF-8 解码，非法编码返回人话错误，不静默替换字符。
pub fn read_text_file(root: &Path, rel: &str) -> Result<String, CommandError> {
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "fs_invalid_utf8",
            format!("文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取"),
        )
    })
}

pub fn file_revision(root: &Path, rel: &str) -> Result<String, CommandError> {
    use sha2::{Digest, Sha256};
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn read_text_snapshot(root: &Path, rel: &str) -> Result<(String, String), CommandError> {
    use sha2::{Digest, Sha256};
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let content = String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "fs_invalid_utf8",
            format!("文件 {rel} 不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取"),
        )
    })?;
    Ok((content, revision))
}

/// `document_save` 拒绝保存的扩展名（image / binary 两类，升序）。
///
/// **事实源是前端的 `src/preview/attachments.ts` 注册表**（image MIME 键 + 二进制扩展名
/// 两张表），本表是 Rust 侧的第二份——为的是「前端 bug 不得把内存内容写进图片/二进制路径」
/// 这条后端防线（M130 起有，editable-non-md-files 把 md 白名单换成这张拒绝清单）。
/// 两侧逐项对账的机器检查在 `tests/unit/registry-drift.test.ts`：它读本文件、解析本表、
/// 与注册表求差集，任一侧漂移即红（REVIEW.md 第 8 条——同一语义两处真源、改动只落一处）。
/// 改本表之前先改注册表。
const SAVE_REJECTED_EXTENSIONS: [&str; 47] = [
    "7z", "app", "avi", "avif", "bmp", "class", "db", "dll", "dmg", "doc", "docx", "dylib", "exe",
    "fig", "flac", "gif", "gz", "heic", "icns", "ico", "jar", "jpeg", "jpg", "mkv", "mov", "mp3",
    "mp4", "otf", "pdf", "png", "ppt", "pptx", "rar", "sketch", "so", "sqlite", "svg", "tar",
    "ttf", "wasm", "wav", "webp", "woff", "woff2", "xls", "xlsx", "zip",
];

/// 路径的扩展名（小写、不含点）；basename 无点（`LICENSE`/`Makefile`）返回空串——与
/// `src/preview/attachments.ts` 的 `extensionOf` 同口径（只按 basename 里最后一个点切分，
/// dotfile `.gitignore` 因此得到 `gitignore`）。
fn extension_of(rel: &str) -> String {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    match base.rfind('.') {
        Some(dot) => base[dot + 1..].to_ascii_lowercase(),
        None => String::new(),
    }
}

/// 保存 vault 内文本文档：原子替换 + revision CAS。
///
/// 可保存面（editable-non-md-files，裁决 D1/D3）= 注册表全部文本类：`.md`/`.markdown`、
/// 已知代码扩展、未收录扩展、dotfile 与 basename 无点的文件——即除 image/binary 之外的一切。
/// 守卫从 md 白名单翻转为**拒绝清单**（[`SAVE_REJECTED_EXTENSIONS`]）：image/binary 类扩展名
/// 返回 `fs_read_only`，MUST NOT 写入任何字节。（原函数名 `save_markdown` 随语义放宽改为
/// `save_document`；command 名 `document_save` 本来就叫 document，前端 IPC 零改动。）
pub fn save_document(
    root: &Path,
    rel: &str,
    expected_revision: &str,
    content: &str,
) -> Result<String, CommandError> {
    if SAVE_REJECTED_EXTENSIONS.contains(&extension_of(rel).as_str()) {
        return Err(CommandError::new(
            "fs_read_only",
            "不支持保存该文件类型（图片 / 二进制文件）",
        ));
    }
    let target = resolve_in_vault(root, rel)?;
    let actual = file_revision(root, rel)?;
    if actual != expected_revision {
        return Err(CommandError::new(
            "document_conflict",
            "文件已被外部修改，请先协调冲突",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| CommandError::new("fs_path_invalid", "目标目录无效"))?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document");
    let tmp = parent.join(format!(".{name}.lumir-{}", std::process::id()));
    // create_new 撞上同名文件 = 上次保存进程崩溃留下的 ghost（tmp 名含自身
    // pid，活着的进程互不挡道）：删除 ghost 重试一次；再失败才是真错误。
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = std::fs::remove_file(&tmp);
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)
            {
                Ok(file) => file,
                Err(e) => {
                    return Err(CommandError::new(
                        "document_write_failed",
                        format!("无法创建临时文件：{e}"),
                    ))
                }
            }
        }
        Err(e) => {
            return Err(CommandError::new(
                "document_write_failed",
                format!("无法创建临时文件：{e}"),
            ))
        }
    };
    use std::io::Write;
    if let Err(e) = file.write_all(content.as_bytes()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_failed",
            format!("无法写入文档：{e}"),
        ));
    }
    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_unknown",
            format!("文档写入结果未知：{e}"),
        ));
    }
    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CommandError::new(
            "document_write_unknown",
            format!("文档替换结果未知：{e}"),
        ));
    }
    file_revision(root, rel).map_err(|e| {
        CommandError::new(
            "document_write_unknown",
            format!("文档替换后无法确认结果：{}", e.message),
        )
    })
}

/// 读二进制附件：返回 base64（裁决点 A：invoke + base64 形态）。
pub fn read_attachment(root: &Path, rel: &str) -> Result<String, CommandError> {
    let bytes = read_file_bytes(root, rel, ATTACHMENT_MAX_BYTES)?;
    Ok(base64_encode(&bytes))
}

/// 标准 base64（带 padding）。不引 base64 crate：tauri 传递依赖里虽有但不能直接用，
/// 手写编码器约 30 行，契合本仓低依赖取向（见 Cargo.toml 注释）。
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 把 notify 事件映射为增量清单（过滤忽略集、转相对路径）。
/// 改名按 deleted(from) + created(to) 处理；FSEvents 的 Name(Any) 拆不出方向，
/// 由 flush 时的存在性探测兜底（见 [`refine_with_known`]）。
/// Metadata-only 事件（xattr 噪声）直接丢弃，避免污染 dedup 后的 kind。
fn map_event(root: &Path, ev: &notify::Event) -> Vec<FsChange> {
    use notify::event::{ModifyKind, RenameMode};
    let kind = match &ev.kind {
        EventKind::Create(_) => Some(FsChangeKind::Created),
        EventKind::Remove(_) => Some(FsChangeKind::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => Some(FsChangeKind::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => Some(FsChangeKind::Created),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            // paths = [from, to]：拆成 deleted + created
            if ev.paths.len() == 2 {
                let mut out = Vec::new();
                if let Some(p) = rel_string(root, &ev.paths[0]) {
                    out.push(FsChange {
                        kind: FsChangeKind::Deleted,
                        path: p,
                        entry_kind: None,
                    });
                }
                if let Some(p) = rel_string(root, &ev.paths[1]) {
                    out.push(FsChange {
                        kind: FsChangeKind::Created,
                        path: p,
                        entry_kind: None,
                    });
                }
                return out;
            }
            Some(FsChangeKind::Modified)
        }
        // Metadata-only 事件（xattr/mtime 噪声）不影响树展示，丢弃；
        // 内容修改走 Data(_)，改名走 Name(_)
        EventKind::Modify(ModifyKind::Metadata(_)) => None,
        EventKind::Modify(_) => Some(FsChangeKind::Modified),
        _ => None,
    };
    let Some(kind) = kind else { return Vec::new() };
    ev.paths
        .iter()
        .filter_map(|p| rel_string(root, p))
        .map(|path| FsChange {
            kind,
            path,
            entry_kind: None,
        })
        .collect()
}

/// kind 合并优先级：Deleted > Created > Modified。
/// 同路径在窗口内先建后删 → Deleted；先建后改 → 仍是 Created。
fn merge_kind(a: FsChangeKind, b: FsChangeKind) -> FsChangeKind {
    use FsChangeKind::*;
    let rank = |k| match k {
        Modified => 0,
        Created => 1,
        Deleted => 2,
    };
    if rank(b) >= rank(a) {
        b
    } else {
        a
    }
}

/// 同路径去重：按 [`merge_kind`] 合并，保序（首次出现的位置）。
fn dedup(changes: Vec<FsChange>) -> Vec<FsChange> {
    let mut out: Vec<FsChange> = Vec::with_capacity(changes.len());
    for c in changes {
        if let Some(slot) = out.iter_mut().find(|o| o.path == c.path) {
            slot.kind = merge_kind(slot.kind, c.kind);
        } else {
            out.push(c);
        }
    }
    out
}

/// flush 时按"已知路径集 + 存在性探测"修正 kind 并填充 entry_kind：
/// - FSEvents 新流会把近期变更重放为 Create（即使文件早已存在），
///   播种了全量枚举结果后，已知路径的 Created 修正为 Modified；
/// - 删除/改名常被上报为粗粒度 Modify，路径已不存在的统一修正为 Deleted；
/// - Deleted 但路径仍存在（窗口内删了又建）按 upsert 处理。
fn refine_with_known(
    root: &Path,
    known: &mut std::collections::HashSet<String>,
    changes: &mut [FsChange],
) {
    for c in changes.iter_mut() {
        // entry_kind 在 flush 时按 metadata 填充（事件本身不带）；deleted 保持 null。
        // symlink_metadata 与 scan_workspace 一致（不跟随 symlink）。
        let meta = std::fs::symlink_metadata(root.join(&c.path)).ok();
        c.entry_kind = meta.as_ref().map(|m| {
            if m.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            }
        });
        let exists = meta.is_some();
        if !exists {
            c.kind = FsChangeKind::Deleted;
            known.remove(&c.path);
            continue;
        }
        let is_new = known.insert(c.path.clone());
        c.kind = if is_new {
            FsChangeKind::Created
        } else {
            FsChangeKind::Modified
        };
    }
}

/// 正在运行的 vault 监听器；drop 即停止监听（debounce 线程随 channel 断开退出）。
pub struct VaultWatcher {
    _watcher: notify::RecommendedWatcher,
    known: std::sync::Arc<Mutex<std::collections::HashSet<String>>>,
}

impl VaultWatcher {
    /// 用全量枚举结果播种已知路径集（open 流程：先 watch 再 scan 再 seed，
    /// 消除 scan→watch 之间的事件空窗）。
    pub fn seed(&self, paths: impl IntoIterator<Item = String>) {
        self.known
            .lock()
            .expect("known paths poisoned")
            .extend(paths);
    }
}

/// 启动 vault 监听：事件经 [`DEBOUNCE`] 窗口合并去重后，以批次回调交付。
/// 与枚举共用同一忽略集。回调里不许 panic（会杀死 debounce 线程）。
pub fn watch(
    root: &Path,
    on_batch: impl Fn(Vec<FsChange>) + Send + 'static,
) -> Result<VaultWatcher, CommandError> {
    // macOS 上 FSEvents 报告的是解析符号链接后的路径（/tmp → /private/tmp，
    // $TMPDIR → /private/var/...），strip_prefix 必须对规范化根做，否则全部失配。
    let root = root.canonicalize().map_err(|e| {
        CommandError::new(
            "fs_root_invalid",
            format!("无法解析 vault 根 {}：{e}", root.display()),
        )
    })?;
    let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
    let root_owned = root.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        match res {
            Ok(ev) => {
                let changes = map_event(&root_owned, &ev);
                if !changes.is_empty() {
                    // receiver 已断开说明 VaultWatcher 已 drop，发送失败直接忽略
                    let _ = tx.send(changes);
                }
            }
            Err(e) => eprintln!("lumir: fs watch error: {e}"),
        }
    })
    .map_err(|e| CommandError::new("fs_watch_failed", format!("无法启动文件监听：{e}")))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| {
            CommandError::new(
                "fs_watch_failed",
                format!("无法监听目录 {}：{e}", root.display()),
            )
        })?;

    // debounce 线程：等到第一批事件后，持续收直到静默满一个窗口，
    // 再合并去重 + 已知路径集修正 kind，然后推送。
    let known = std::sync::Arc::new(Mutex::new(std::collections::HashSet::new()));
    let known_for_flush = known.clone();
    let root_for_flush = root.clone();
    std::thread::Builder::new()
        .name("lumir-fs-debounce".into())
        .spawn(move || {
            let flush = |pending: &mut Vec<FsChange>| {
                let mut batch = dedup(std::mem::take(pending));
                refine_with_known(
                    &root_for_flush,
                    &mut known_for_flush.lock().expect("known paths poisoned"),
                    &mut batch,
                );
                if !batch.is_empty() {
                    on_batch(batch);
                }
            };
            let mut pending: Vec<FsChange> = Vec::new();
            loop {
                match rx.recv() {
                    Ok(batch) => pending.extend(batch),
                    Err(_) => {
                        if !pending.is_empty() {
                            flush(&mut pending);
                        }
                        return; // watcher 已 drop
                    }
                }
                loop {
                    match rx.recv_timeout(DEBOUNCE) {
                        Ok(batch) => pending.extend(batch),
                        Err(mpsc::RecvTimeoutError::Timeout) => break,
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            flush(&mut pending);
                            return;
                        }
                    }
                }
                flush(&mut pending);
            }
        })
        .map_err(|e| CommandError::new("fs_watch_failed", format!("无法启动监听线程：{e}")))?;

    Ok(VaultWatcher {
        _watcher: watcher,
        known,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（同 config.rs 的纪律）：pid + 序号造唯一目录，drop 时递归删除。
    struct TempVault(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempVault {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-fs-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).expect("create temp vault");
            Self(path)
        }
        /// 造混合类型 fixture：md / 代码 / 图片字节 / 无扩展名文本 / 嵌套目录 / 忽略集。
        fn with_fixture() -> Self {
            let v = Self::new();
            let r = &v.0;
            std::fs::write(r.join("note.md"), "# hello").unwrap();
            std::fs::write(r.join("main.rs"), "fn main() {}").unwrap();
            std::fs::write(r.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
            std::fs::write(r.join("LICENSE"), "MIT").unwrap();
            std::fs::create_dir_all(r.join("sub/deep")).unwrap();
            std::fs::write(r.join("sub/deep/a.txt"), "a").unwrap();
            std::fs::create_dir_all(r.join(".git/objects")).unwrap();
            std::fs::write(r.join(".git/HEAD"), "ref").unwrap();
            std::fs::write(r.join(".DS_Store"), [0u8; 4]).unwrap();
            std::fs::create_dir_all(r.join("node_modules/pkg")).unwrap();
            std::fs::write(r.join("node_modules/pkg/index.js"), "x").unwrap();
            v
        }
    }

    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn scan_lists_all_types_and_applies_ignore_set() {
        let v = TempVault::with_fixture();
        let entries = scan_workspace(&v.0).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"note.md"));
        assert!(paths.contains(&"main.rs"));
        assert!(paths.contains(&"pic.png"));
        assert!(paths.contains(&"LICENSE"));
        assert!(paths.contains(&"sub"));
        assert!(paths.contains(&"sub/deep"));
        assert!(paths.contains(&"sub/deep/a.txt"));
        // 忽略集：自身与子孙都不出现
        assert!(!paths.iter().any(|p| p.contains(".git")));
        assert!(!paths.iter().any(|p| p.contains(".DS_Store")));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));

        let note = entries.iter().find(|e| e.path == "note.md").unwrap();
        assert_eq!(note.kind, FsEntryKind::File);
        assert_eq!(note.size, 7);
        assert!(note.mtime_ms.is_some());
        let sub = entries.iter().find(|e| e.path == "sub").unwrap();
        assert_eq!(sub.kind, FsEntryKind::Dir);
        // 排序确定（按路径字典序）
        let mut sorted = paths.clone();
        sorted.sort_unstable();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn scan_rejects_non_dir_root() {
        let v = TempVault::new();
        let f = v.0.join("f.txt");
        std::fs::write(&f, "x").unwrap();
        let err = scan_workspace(&f).unwrap_err();
        assert_eq!(err.code, "fs_root_not_dir");
    }

    #[cfg(unix)]
    #[test]
    fn scan_does_not_follow_symlink_loop() {
        let v = TempVault::with_fixture();
        // 循环 symlink：sub/loop 指回 vault 根。跟随会沿链接重复枚举直至 ELOOP。
        std::os::unix::fs::symlink(&v.0, v.0.join("sub/loop")).unwrap();
        let entries = scan_workspace(&v.0).expect("symlink 循环不应导致扫描失败");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        // symlink 条目按文件列出，不递归展开
        assert!(paths.contains(&"sub/loop"));
        assert_eq!(
            entries.iter().find(|e| e.path == "sub/loop").unwrap().kind,
            FsEntryKind::File
        );
        assert!(
            !paths.iter().any(|p| p.starts_with("sub/loop/")),
            "symlink 不应被展开枚举：{paths:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn scan_does_not_expand_external_symlink() {
        let v = TempVault::with_fixture();
        // Obsidian 常见模式：attachments 是指向 vault 外目录的 symlink
        let outside = TempVault::new();
        std::fs::create_dir_all(outside.0.join("attachments/deep")).unwrap();
        std::fs::write(outside.0.join("attachments/deep/x.png"), [0u8; 4]).unwrap();
        std::os::unix::fs::symlink(outside.0.join("attachments"), v.0.join("attachments")).unwrap();
        let entries = scan_workspace(&v.0).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        // symlink 本身作为条目出现，但 vault 外的内容不被枚举进树
        assert!(paths.contains(&"attachments"));
        assert!(
            !paths.iter().any(|p| p.starts_with("attachments/")),
            "外部 symlink 不应被展开枚举：{paths:?}"
        );
    }

    #[test]
    fn resolve_rejects_escape_and_absolute() {
        let v = TempVault::with_fixture();
        let cases = ["../outside", "sub/../../etc/passwd", "/etc/passwd"];
        for c in cases {
            let err = resolve_in_vault(&v.0, c).unwrap_err();
            assert_eq!(err.code, "fs_path_escape", "case: {c}");
        }
        let err = resolve_in_vault(&v.0, "missing.txt").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        assert!(resolve_in_vault(&v.0, "note.md").is_ok());
        assert!(resolve_in_vault(&v.0, "sub/deep/a.txt").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escape() {
        let v = TempVault::with_fixture();
        let outside = TempVault::new();
        std::fs::write(outside.0.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.0.join("secret.txt"), v.0.join("link.txt")).unwrap();
        let err = read_text_file(&v.0, "link.txt").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
    }

    #[test]
    fn read_text_file_ok_and_invalid_utf8() {
        let v = TempVault::with_fixture();
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# hello");
        // GBK 编码的"中文"不是合法 UTF-8
        std::fs::write(v.0.join("gbk.txt"), [0xd6, 0xd0, 0xce, 0xc4]).unwrap();
        let err = read_text_file(&v.0, "gbk.txt").unwrap_err();
        assert_eq!(err.code, "fs_invalid_utf8");
        assert!(err.message.contains("UTF-8"));
        // 目录按"不是文件"拒绝
        let err = read_text_file(&v.0, "sub").unwrap_err();
        assert_eq!(err.code, "fs_not_a_file");
    }

    #[test]
    fn read_attachment_ok_and_oversize_rejected_without_read() {
        let v = TempVault::with_fixture();
        let b64 = read_attachment(&v.0, "pic.png").unwrap();
        assert_eq!(b64, base64_encode(&[0x89, 0x50, 0x4e, 0x47]));

        // 稀疏文件：set_len 不占磁盘实际空间，metadata 报超限即拒、不分配内存
        let big = v.0.join("big.bin");
        std::fs::File::create(&big)
            .unwrap()
            .set_len(ATTACHMENT_MAX_BYTES + 1)
            .unwrap();
        let err = read_attachment(&v.0, "big.bin").unwrap_err();
        assert_eq!(err.code, "fs_too_large");
    }

    #[test]
    fn base64_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn watch_delivers_batched_changes_and_respects_ignore_set() {
        let v = TempVault::with_fixture();
        // FSEvents 按"历史事件点"对齐流起点：fixture 写入后先静置，让流的起点
        // 落在 fixture 之后，否则首批事件会带上 fixture 的 Create 标志。
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        // 与 open_vault 同序：watch 后枚举播种，已知路径的重放 Create 修正为 Modified
        let entries = scan_workspace(&v.0).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        // FSEvents 流注册需要时间；注册完成前的变更会以粗粒度 kind 上报
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(v.0.join("new.md"), "n").unwrap();
        std::fs::write(v.0.join("note.md"), "# hello v2").unwrap();
        std::fs::remove_file(v.0.join("main.rs")).unwrap();
        std::fs::write(v.0.join(".git/NEW"), "x").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        let has =
            |kind: FsChangeKind, path: &str| batch.iter().any(|c| c.kind == kind && c.path == path);
        assert!(has(FsChangeKind::Created, "new.md"), "batch: {batch:?}");
        assert!(has(FsChangeKind::Modified, "note.md"), "batch: {batch:?}");
        assert!(has(FsChangeKind::Deleted, "main.rs"), "batch: {batch:?}");
        // created 携带 entry_kind，前端据此知道新节点是文件还是目录；deleted 为 null
        let new_entry = batch.iter().find(|c| c.path == "new.md").unwrap();
        assert_eq!(new_entry.entry_kind, Some(FsEntryKind::File));
        let del_entry = batch.iter().find(|c| c.path == "main.rs").unwrap();
        assert_eq!(del_entry.entry_kind, None);
        assert!(
            !batch.iter().any(|c| c.path.contains(".git")),
            "batch: {batch:?}"
        );
        // 同路径去重
        let mut paths: Vec<&str> = batch.iter().map(|c| c.path.as_str()).collect();
        let before = paths.len();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(before, paths.len(), "batch: {batch:?}");
    }

    #[test]
    fn document_save_checks_revision_and_replaces_atomically() {
        let v = TempVault::with_fixture();
        let revision = file_revision(&v.0, "note.md").unwrap();
        let next = save_document(&v.0, "note.md", &revision, "# changed").unwrap();
        assert_ne!(revision, next);
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# changed");
        let err = save_document(&v.0, "note.md", &revision, "stale").unwrap_err();
        assert_eq!(err.code, "document_conflict");
    }

    /// 裁决 D1 的落点：可保存面 = 注册表全部文本类（md / 代码扩展 / 未收录扩展 /
    /// 无扩展名），image/binary 类被拒。拒绝清单是 Rust 侧第二份表，与
    /// `src/preview/attachments.ts` 的对账在 tests/unit/registry-drift.test.ts。
    #[test]
    fn document_save_allows_text_classes_and_rejects_image_binary() {
        let v = TempVault::with_fixture();
        // 文本类全部放行，且真的原子替换落盘
        for rel in ["note.md", "main.rs", "LICENSE", "sub/deep/a.txt"] {
            let revision = file_revision(&v.0, rel).unwrap();
            let next = save_document(&v.0, rel, &revision, "edited").unwrap();
            assert_ne!(revision, next, "{rel} 保存后 revision 应变");
            assert_eq!(read_text_file(&v.0, rel).unwrap(), "edited", "{rel} 应落盘");
        }
        // image / binary 类被拒——且**发生在任何 IO 之前**（这些路径在 fixture 里不存在，
        // 若守卫晚于 resolve_in_vault 就会返回 fs_not_found 而不是 fs_read_only）
        for rel in [
            "pic.png",
            "logo.jpg",
            "manual.pdf",
            "bundle.zip",
            "song.mp3",
        ] {
            let err = save_document(&v.0, rel, "any", "nope").unwrap_err();
            assert_eq!(err.code, "fs_read_only", "{rel} 必须被拒");
        }
    }

    /// 拒绝清单的判定只按 basename 的最后一个点切分（与 attachments.ts 的 extensionOf 同口径）：
    /// 目录名里的点 / 大小写 / dotfile 都不能骗过守卫，也不能误伤文本类。
    #[test]
    fn document_save_extension_classification_matches_registry_rules() {
        let v = TempVault::with_fixture();
        // 大小写不敏感（.PNG 同样是图片）
        assert_eq!(
            save_document(&v.0, "pic.PNG", "any", "x").unwrap_err().code,
            "fs_read_only"
        );
        // 扩展名只看 basename：目录名含 .png 不构成拒绝理由
        std::fs::create_dir_all(v.0.join("a.png")).unwrap();
        std::fs::write(v.0.join("a.png/notes"), "orig").unwrap();
        let revision = file_revision(&v.0, "a.png/notes").unwrap();
        assert!(save_document(&v.0, "a.png/notes", &revision, "ok").is_ok());
        // dotfile 的「扩展名」是点后整串（.gitignore → gitignore），未收录即文本类
        std::fs::write(v.0.join(".gitignore"), "orig").unwrap();
        let revision = file_revision(&v.0, ".gitignore").unwrap();
        assert!(save_document(&v.0, ".gitignore", &revision, "ok").is_ok());
    }

    #[test]
    fn document_save_recovers_from_stale_ghost_tmp() {
        let v = TempVault::with_fixture();
        // 预置与本次保存同名的 ghost（同 pid）：create_new 撞车须删除后重试成功
        let ghost = v.0.join(format!(".note.md.lumir-{}", std::process::id()));
        std::fs::write(&ghost, "stale ghost").unwrap();
        let revision = file_revision(&v.0, "note.md").unwrap();
        let next = save_document(&v.0, "note.md", &revision, "# recovered").unwrap();
        assert_ne!(revision, next);
        assert_eq!(read_text_file(&v.0, "note.md").unwrap(), "# recovered");
        assert!(!ghost.exists(), "ghost 应已被删除重试清理");
    }

    #[test]
    fn scan_ignores_lumir_tmp_ghost_but_keeps_other_dotfiles() {
        let v = TempVault::with_fixture();
        // 崩溃残留的 ghost 与合法点文件并存：模式只吞 `.lumir-` tmp
        std::fs::write(v.0.join(".note.md.lumir-4242"), "ghost").unwrap();
        std::fs::write(v.0.join(".hidden.conf"), "cfg").unwrap();
        let entries = scan_workspace(&v.0).expect("scan");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(
            !paths.iter().any(|p| p.contains(".lumir-")),
            "paths: {paths:?}"
        );
        assert!(paths.contains(&".hidden.conf"), "paths: {paths:?}");
    }

    #[test]
    fn scan_sweeps_stale_ghost_tmps_only() {
        let v = TempVault::with_fixture();
        let ghost_root = v.0.join(".note.md.lumir-4242");
        let ghost_nested = v.0.join("sub/.deep.md.lumir-4243");
        let dotfile = v.0.join(".hidden.conf");
        std::fs::write(&ghost_root, "ghost").unwrap();
        std::fs::write(&ghost_nested, "ghost").unwrap();
        std::fs::write(&dotfile, "cfg").unwrap();
        // now 前拨过阈值（不依赖改 mtime 的额外依赖）：三个文件都「超龄」，
        // 只有 lumir tmp 被清除，合法点文件必须留存
        let aged = SystemTime::now() + GHOST_TMP_MAX_AGE + Duration::from_secs(1);
        let entries = scan_workspace_at(&v.0, aged).expect("scan");
        assert!(!ghost_root.exists(), "超龄 ghost tmp 应被清除");
        assert!(!ghost_nested.exists(), "嵌套目录内的超龄 ghost 也应被清除");
        assert!(dotfile.exists(), "合法点文件不得被清除");
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(
            !paths.iter().any(|p| p.contains(".lumir-")),
            "paths: {paths:?}"
        );
        assert!(paths.contains(&".hidden.conf"), "paths: {paths:?}");
    }

    #[test]
    fn scan_keeps_fresh_ghost_tmp_in_flight() {
        let v = TempVault::with_fixture();
        let fresh = v.0.join(".note.md.lumir-4242");
        std::fs::write(&fresh, "in-flight").unwrap();
        // 未超龄：在途保存的 tmp 不得被清除（同进程 tmp 生命周期为毫秒级）
        let _ = scan_workspace(&v.0).expect("scan");
        assert!(fresh.exists(), "未超龄的 tmp 不删");
    }

    #[test]
    fn watch_does_not_emit_lumir_tmp_events() {
        let v = TempVault::with_fixture();
        std::thread::sleep(Duration::from_millis(700));
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let watcher = watch(&v.0, move |batch| {
            tx.send(batch).expect("send batch");
        })
        .expect("watch");
        let entries = scan_workspace(&v.0).expect("scan");
        watcher.seed(entries.iter().map(|e| e.path.clone()));

        std::thread::sleep(Duration::from_millis(500));
        // 一次完整保存 = tmp 创建 + rename 替换：事件流只许出现目标文件
        let revision = file_revision(&v.0, "note.md").unwrap();
        save_document(&v.0, "note.md", &revision, "# via save").unwrap();

        let batch = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("batch within 5s");
        assert!(
            batch
                .iter()
                .any(|c| c.path == "note.md" && c.kind == FsChangeKind::Modified),
            "batch: {batch:?}"
        );
        assert!(
            !batch.iter().any(|c| c.path.contains(".lumir-")),
            "tmp ghost 不得进入事件流：{batch:?}"
        );
    }

    #[test]
    fn watch_stops_when_dropped() {
        let v = TempVault::with_fixture();
        let (tx, rx) = mpsc::channel::<Vec<FsChange>>();
        let w = watch(&v.0, move |batch| {
            let _ = tx.send(batch);
        })
        .expect("watch");
        drop(w);
        std::fs::write(v.0.join("after-drop.md"), "x").unwrap();
        // debounce 线程随 channel 断开退出；不应再收到任何批次
        assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
    }

    #[test]
    fn validate_new_name_rejects_dot_slash_ignored_and_accepts_normal() {
        for bad in ["", "a/b", ".", "..", ".git", ".DS_Store", "node_modules"] {
            let err = validate_new_name(bad).unwrap_err();
            assert_eq!(err.code, "fs_name_invalid", "case: {bad:?}");
        }
        // 合法点文件不受忽略集牵连（`.gitignore` 不在 IGNORED_NAMES，也不命中 tmp 模式）
        for ok in ["note.md", "笔记.md", ".gitignore", "a.txt"] {
            assert!(validate_new_name(ok).is_ok(), "case: {ok:?}");
        }
    }

    #[test]
    fn resolve_new_rejects_escape_bad_names_and_collisions() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // 父目录逃逸：绝对路径与 `..` 穿越都被 resolve_in_vault 挡住
        for parent in ["../outside", "/etc", "sub/../../etc"] {
            let err = resolve_new_in_vault(root, parent, "x.md").unwrap_err();
            assert_eq!(err.code, "fs_path_escape", "parent: {parent}");
        }
        // 末段名非法：空 / 含斜杠 / 点 / 点点 / 忽略集三种
        for name in ["", "a/b", ".", "..", ".git", ".DS_Store", "node_modules"] {
            let err = resolve_new_in_vault(root, "", name).unwrap_err();
            assert_eq!(err.code, "fs_name_invalid", "name: {name:?}");
        }
        // 撞名：既有文件与既有目录都要挡住
        for name in ["note.md", "sub"] {
            let err = resolve_new_in_vault(root, "", name).unwrap_err();
            assert_eq!(err.code, "fs_already_exists", "name: {name}");
        }
        // 父目录不存在 / 父是文件
        let err = resolve_new_in_vault(root, "missing", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        let err = resolve_new_in_vault(root, "note.md", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_path_invalid");
        // 正常：根下与子目录下，返回父的规范化路径 + join(name)（目标允许不存在）
        let canon = root.canonicalize().unwrap();
        assert_eq!(
            resolve_new_in_vault(root, "", "new.md").unwrap(),
            canon.join("new.md")
        );
        assert_eq!(
            resolve_new_in_vault(root, "sub/deep", "new.md").unwrap(),
            canon.join("sub/deep/new.md")
        );
    }

    #[test]
    fn rename_moves_within_parent_and_never_overwrites() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        assert_eq!(
            rename_entry(root, "note.md", "renamed.md").unwrap(),
            "renamed.md"
        );
        assert!(!root.join("note.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("renamed.md")).unwrap(),
            "# hello"
        );
        // 嵌套路径：父段由源路径派生，返回路径带父段
        assert_eq!(
            rename_entry(root, "sub/deep/a.txt", "b.txt").unwrap(),
            "sub/deep/b.txt"
        );
        assert!(root.join("sub/deep/b.txt").exists());
        // 目录改名连同子孙一起走
        assert_eq!(rename_entry(root, "sub", "sub2").unwrap(), "sub2");
        assert_eq!(
            std::fs::read_to_string(root.join("sub2/deep/b.txt")).unwrap(),
            "a"
        );
        // 撞名：目标与源都逐字节不变
        let err = rename_entry(root, "renamed.md", "main.rs").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(
            std::fs::read_to_string(root.join("main.rs")).unwrap(),
            "fn main() {}"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("renamed.md")).unwrap(),
            "# hello"
        );
        // 源不存在 / 新名非法（非法时源不动）
        let err = rename_entry(root, "missing.md", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        let err = rename_entry(root, "renamed.md", ".git").unwrap_err();
        assert_eq!(err.code, "fs_name_invalid");
        assert!(root.join("renamed.md").exists());
    }

    /// 撞名必须被挡住（r1 评审 P2-2）：`std::fs::rename` 的 POSIX 语义是原子替换已存在的
    /// 目标，因此「撞名不覆盖」不能只靠 `resolve_new_in_vault` 的探测。这条单测钉的是**可观测
    /// 契约**：rename 到已存在的名字必须报 `fs_already_exists`（与 create 路径同一个码、同一句
    /// 话），源与目标逐字节不变——普通文件与既有目录两种形态都覆盖。
    ///
    /// **它钉不到窗口**：探测与复查之间那段检查-执行窗口无法用确定性测试构造（要在两次系统
    /// 调用之间插入外部进程建文件），所以这里证明的是「结果不覆盖」，不是「零窗口」；窗口的
    /// 取舍与代价写在 [`rename_entry`] 的注释里。防线上它管住的是「写路径整个失去撞名判定」
    /// 这类改动（例如某次重构改成不经 `resolve_new_in_vault` 直接 rename）。
    #[test]
    fn rename_refuses_existing_target_on_write_path() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // 目标已存在（普通文件）：报错、两边逐字节不变
        let err = rename_entry(root, "note.md", "main.rs").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert!(
            err.message.contains("已存在同名条目：main.rs"),
            "人话里要点名撞的条目：{}",
            err.message
        );
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "# hello"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("main.rs")).unwrap(),
            "fn main() {}"
        );
        // 目标已存在（目录）：同样挡住（rename 到目录名下会替换空目录或报 ENOTDIR，
        // 两种都不是我们要的语义）
        let err = rename_entry(root, "note.md", "sub").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert!(root.join("sub/deep/a.txt").exists(), "既有目录不得被动");
        assert!(root.join("note.md").exists());
        // 忽略集名与非法名走的是另一条分支（保持既有语义）
        assert_eq!(
            rename_entry(root, "note.md", ".git").unwrap_err().code,
            "fs_name_invalid"
        );
    }

    #[test]
    fn create_file_and_dir_are_atomic_and_refuse_collision() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        assert_eq!(
            create_file_entry(root, "sub", "new.md").unwrap(),
            "sub/new.md"
        );
        let meta = std::fs::metadata(root.join("sub/new.md")).unwrap();
        assert!(meta.is_file());
        assert_eq!(meta.len(), 0, "新建的是空文件");
        assert_eq!(create_dir_entry(root, "", "newdir").unwrap(), "newdir");
        assert!(root.join("newdir").is_dir());
        // 撞名不覆盖：既有文件逐字节不变
        let err = create_file_entry(root, "", "note.md").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        assert_eq!(
            std::fs::read_to_string(root.join("note.md")).unwrap(),
            "# hello"
        );
        let err = create_dir_entry(root, "", "sub").unwrap_err();
        assert_eq!(err.code, "fs_already_exists");
        // 忽略集名 / 逃逸父 / 父不存在
        let err = create_file_entry(root, "", "node_modules").unwrap_err();
        assert_eq!(err.code, "fs_name_invalid");
        let err = create_dir_entry(root, "../outside", "x").unwrap_err();
        assert_eq!(err.code, "fs_path_escape");
        let err = create_file_entry(root, "missing", "x.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        // 成功不是空口承诺：新建的两个条目真的在磁盘上
        assert!(root.join("sub/new.md").exists() && root.join("newdir").exists());
    }

    /// 删除 = 移废纸篓。**成功路径真的会往用户的废纸篓里放一个条目**：macOS 下
    /// `trash::os_limited`（list / restore）不参与编译，测试内无法把它放回。因此测试文件
    /// 用可辨识的名字（`lumir-trash-test-<pid>.txt`）且内容为空，人工清理一眼可辨；
    /// 「可恢复」这条产品承诺由 `trash` 自身的平台语义与真机场景 47 承担。
    #[test]
    fn trash_moves_entry_out_of_vault_and_reports_human_errors() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        let rel = format!("lumir-trash-test-{}.txt", std::process::id());
        let victim = root.join(&rel);
        std::fs::write(&victim, "").unwrap();
        trash_entry(root, &rel).expect("移到废纸篓");
        assert!(!victim.exists(), "入篓后 vault 内不应再有该条目");
        assert!(
            root.join("note.md").exists(),
            "只动目标条目，vault 其余内容不变"
        );
        // 错误路径一：目标不存在（菜单开着期间被外部移走）
        let err = trash_entry(root, "missing.md").unwrap_err();
        assert_eq!(err.code, "fs_not_found");
        // 错误路径二：空路径（防御性，vault 根永不进废纸篓）
        let err = trash_entry(root, "").unwrap_err();
        assert_eq!(err.code, "fs_path_invalid");
        assert!(root.join("note.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn trash_refuses_vault_root_reached_through_symlink() {
        let v = TempVault::with_fixture();
        let root = &v.0;
        // vault 内指向 vault 根的 symlink：resolve_in_vault 归一后正好是根，必须挡住
        std::os::unix::fs::symlink(root, root.join("loop")).unwrap();
        let err = trash_entry(root, "loop").unwrap_err();
        assert_eq!(err.code, "fs_trash_failed", "vault 根本身永不进废纸篓");
        assert!(root.join("note.md").exists());
    }
}
