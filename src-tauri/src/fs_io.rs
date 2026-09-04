//! 文件 IO / 监听 —— 全类型递归枚举 + watch 增量事件流（add-vault-workspace）。
//!
//! 职责见 ADR 0002 §3：vault 内文件的读取与变更监听全部在 Rust core 完成，
//! webview 不直接触文件系统。架构约束见 ADR 0002 §7：本模块不依赖 tauri/UI
//! 类型——watch 以 `impl Fn(Vec<FsChange>)` 回调交付纯数据，由 commands 层
//! 决定如何 emit 成 `fs:entry_changed` 事件。
//!
//! 本 change 为只读（M1 出口是只读浏览）：不写文件、不改名、不删除。

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use ts_rs::TS;

use crate::commands::CommandError;

/// 硬编码忽略集（裁决点 C）：一等公民的是文件类型，不是 VCS 内部目录。
/// `.git` 含数万对象文件，枚举它会直接威胁性能合同（ADR 0002 §6）。
/// 枚举与 watch 共用此集合；本 change 内不可配置。
pub const IGNORED_NAMES: [&str; 3] = [".git", ".DS_Store", "node_modules"];

/// 单附件大小上限（spec：建议 50MB），防止误读大文件撑破常驻内存合同。
pub const ATTACHMENT_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// watch 事件 debounce 窗口（裁决点 B）：窗口内连续事件合并为一批推送。
pub const DEBOUNCE: Duration = Duration::from_millis(100);

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

fn is_ignored(name: &std::ffi::OsStr) -> bool {
    IGNORED_NAMES.iter().any(|n| name == *n)
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
pub fn scan_workspace(root: &Path) -> Result<Vec<FsEntry>, CommandError> {
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
                continue;
            }
            let path = item.path();
            let meta = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue, // 扫描期间被删的条目直接跳过
            };
            let kind = if meta.is_dir() {
                FsEntryKind::Dir
            } else {
                FsEntryKind::File
            };
            let Some(rel) = rel_string(root, &path) else {
                continue;
            };
            if kind == FsEntryKind::Dir {
                stack.push(path);
            }
            entries.push(FsEntry {
                path: rel,
                kind,
                size: if meta.is_file() { meta.len() } else { 0 },
                mtime_ms: mtime_ms(&meta),
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
        let meta = std::fs::metadata(root.join(&c.path)).ok();
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
}
