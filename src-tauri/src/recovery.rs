//! 崩溃备份（M127，change save-hardening）：编辑器 dirty 内容持久化到应用恢复
//! 目录，进程崩溃 / 强杀后下次启动据此给用户恢复入口。
//!
//! 与 fs_io 的职责边界：fs_io 只管 vault 内文件与 watch。备份落在配置目录下的
//! `recovery/`（不在 vault 内），故不进文件树、不进 watch 事件流；本模块自持读写，
//! 不挤压 fs_io 的职能。
//!
//! ## 定位规则
//!
//! `<config_dir>/recovery/<vault-key>/<path-key>`：
//! - `vault-key` = vault 根绝对路径字符串的 SHA-256 前 16 个十六进制字符；
//! - `path-key` = vault 相对路径的百分号编码（只保留 `[A-Za-z0-9_-]`，其余字节
//!   写成 `%XX`）——`/` 也在转义之列，故落盘恒为单层文件，`..` 与绝对路径都不可能
//!   越出 `vault-key` 目录。
//!
//! ## 存储格式
//!
//! 每个备份是一个 JSON 信封：`{"base_revision": "<rev>", "content": "<内存原文>"}`。
//! `base_revision` 是备份写入时编辑器已知的磁盘 revision，恢复侧据此对账：恢复以
//! 它（而非恢复时刻的磁盘 revision）作保存基准，备份之后磁盘若被外部修改，随后的
//! 保存按 CAS 报冲突，MUST NOT 静默覆盖较新的磁盘版本（评审 round 1 P2-1 修复）。
//! 信封解析失败（老格式备份 / 外部写坏的文件）按「原文即内容、基准未知」降级读取；
//! 基准未知在恢复侧等价于必定冲突，同样不会静默覆盖。
//!
//! 写入是 tmp + rename 原子替换：备份是崩溃路径上的最后副本，半个信封等于内容全丢。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::commands::CommandError;
use crate::config;

/// 原子写入的临时文件名前缀。解码回来是含 NUL 的路径，`validate_rel` 必拒，
/// 故 `list` 不会把写残的临时文件当成残留备份。
const TMP_PREFIX: &str = "%00tmp%00";

/// 单个备份的读取结果。
pub struct BackupEntry {
    /// 内存文档原文。
    pub content: String,
    /// 备份写入时的磁盘 revision（恢复侧的 CAS 基准）；老格式备份为 None。
    pub base_revision: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct BackupFile {
    #[serde(default)]
    base_revision: Option<String>,
    content: String,
}

/// 恢复目录根：`<config_dir>/recovery`。
pub fn backup_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("recovery"))
}

/// 写崩溃备份（覆盖式；同 (vault, path) 只保留最新一份内存内容 + CAS 基准）。
pub fn backup(
    root: &Path,
    rel: &str,
    content: &str,
    base_revision: &str,
) -> Result<(), CommandError> {
    backup_in(&backup_dir()?, root, rel, content, base_revision)
}

/// 读崩溃备份；无备份返回 `Ok(None)`（不是错误）。
pub fn load(root: &Path, rel: &str) -> Result<Option<BackupEntry>, CommandError> {
    load_in(&backup_dir()?, root, rel)
}

/// 删除崩溃备份；本就不存在也视为成功（幂等）。
pub fn discard(root: &Path, rel: &str) -> Result<(), CommandError> {
    discard_in(&backup_dir()?, root, rel)
}

/// 列出该 vault 的残留备份（vault 相对路径，字典序）；无残留返回空表。
pub fn list(root: &Path) -> Result<Vec<String>, CommandError> {
    list_in(&backup_dir()?, root)
}

fn backup_in(
    base: &Path,
    root: &Path,
    rel: &str,
    content: &str,
    base_revision: &str,
) -> Result<(), CommandError> {
    let path = entry_path(base, root, rel)?;
    let dir = path.parent().expect("备份路径必有父目录");
    std::fs::create_dir_all(dir).map_err(|e| {
        CommandError::new(
            "recovery_write_failed",
            format!("无法创建恢复目录 {}：{e}", dir.display()),
        )
    })?;
    let file = BackupFile {
        base_revision: Some(base_revision.to_string()),
        content: content.to_string(),
    };
    let bytes = serde_json::to_vec(&file).expect("备份信封可序列化");
    let name = path.file_name().expect("备份路径有文件名");
    let tmp = dir.join(format!("{TMP_PREFIX}{}", name.to_string_lossy()));
    std::fs::write(&tmp, bytes).map_err(|e| {
        CommandError::new(
            "recovery_write_failed",
            format!("无法写入崩溃备份 {}：{e}", tmp.display()),
        )
    })?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        CommandError::new(
            "recovery_write_failed",
            format!("无法落盘崩溃备份 {}：{e}", path.display()),
        )
    })
}

fn load_in(base: &Path, root: &Path, rel: &str) -> Result<Option<BackupEntry>, CommandError> {
    let path = entry_path(base, root, rel)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(CommandError::new(
                "recovery_read_failed",
                format!("无法读取崩溃备份 {}：{e}", path.display()),
            ))
        }
    };
    Ok(Some(parse_backup(&text)))
}

/// 信封解析失败按老格式原文降级（基准未知）：宁可让恢复侧必定冲突，也不丢内容。
fn parse_backup(text: &str) -> BackupEntry {
    match serde_json::from_str::<BackupFile>(text) {
        Ok(file) => BackupEntry {
            content: file.content,
            base_revision: file.base_revision,
        },
        Err(_) => BackupEntry {
            content: text.to_string(),
            base_revision: None,
        },
    }
}

fn discard_in(base: &Path, root: &Path, rel: &str) -> Result<(), CommandError> {
    let path = entry_path(base, root, rel)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(CommandError::new(
            "recovery_discard_failed",
            format!("无法删除崩溃备份 {}：{e}", path.display()),
        )),
    }
}

fn list_in(base: &Path, root: &Path) -> Result<Vec<String>, CommandError> {
    let dir = base.join(vault_key(root));
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(CommandError::new(
                "recovery_list_failed",
                format!("无法枚举恢复目录 {}：{e}", dir.display()),
            ))
        }
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        // 只认本模块编码规则产出的备份；写残的临时文件与外来名字跳过而非报错。
        if let Some(rel) = decode_path(name) {
            if validate_rel(&rel).is_ok() {
                out.push(rel);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// 单个备份的绝对路径（vault-key 目录 + path-key 文件名）。
fn entry_path(base: &Path, root: &Path, rel: &str) -> Result<PathBuf, CommandError> {
    validate_rel(rel)?;
    Ok(base.join(vault_key(root)).join(encode_path(rel)))
}

/// vault 根 → 目录名：绝对路径字符串的 SHA-256 前 16 位十六进制。
fn vault_key(root: &Path) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!(
        "{:x}",
        Sha256::digest(root.display().to_string().as_bytes())
    );
    digest[..16].to_string()
}

/// vault 相对路径的合法性：非空、非绝对、无 NUL、段不为空且不是 `.` / `..`。
/// 编码本身已堵死逃逸，这里拒绝的是「备份它没有意义」的输入，错误在人话层可见。
fn validate_rel(rel: &str) -> Result<&str, CommandError> {
    let ok = !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains('\0')
        && !rel
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..");
    if ok {
        Ok(rel)
    } else {
        Err(CommandError::new(
            "recovery_invalid_path",
            format!("崩溃备份路径非法：{rel}"),
        ))
    }
}

/// 路径 → 单层文件名：`[A-Za-z0-9_-]` 原样保留，其余字节 `%XX`（`.` 也转义，
/// 杜绝 `.` / `..` 这类特殊文件名）。
fn encode_path(rel: &str) -> String {
    let mut out = String::with_capacity(rel.len());
    for b in rel.as_bytes() {
        if b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_' {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 单层文件名 → 路径；非法编码返回 None（调用方跳过）。
fn decode_path(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（同 config.rs / fs_io.rs 的纪律）：pid + 序号造唯一目录，
    /// drop 时递归删除。测试不碰真实配置目录——所有 *_in 函数显式接受 base。
    struct TempBase(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempBase {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-recovery-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).expect("create temp base");
            Self(path)
        }
    }

    impl Drop for TempBase {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn vault(name: &str) -> PathBuf {
        PathBuf::from("/tmp").join(name)
    }

    /// 便利：读某个备份的正文（无备份返回 None）。
    fn content_of(base: &Path, root: &Path, rel: &str) -> Option<String> {
        load_in(base, root, rel).unwrap().map(|e| e.content)
    }

    #[test]
    fn encode_is_single_segment_and_roundtrips() {
        let encoded = encode_path("docs/guide.md");
        assert!(!encoded.contains('/'), "编码后必须是单层文件名：{encoded}");
        assert_eq!(decode_path(&encoded).as_deref(), Some("docs/guide.md"));
        // `.` / `..` 不落成特殊文件名
        assert_eq!(encode_path(".."), "%2E%2E");
        assert_eq!(decode_path(&encode_path("..")).as_deref(), Some(".."));
        assert_eq!(decode_path("%ZZ"), None);
        assert_eq!(decode_path("%2"), None);
    }

    #[test]
    fn backup_load_discard_roundtrip() {
        let base = TempBase::new();
        let root = vault("vault-a");
        assert_eq!(list_in(&base.0, &root).unwrap(), Vec::<String>::new());
        assert!(load_in(&base.0, &root, "docs/guide.md").unwrap().is_none());

        backup_in(&base.0, &root, "docs/guide.md", "# 内存版本\n", "rev-1").unwrap();
        backup_in(&base.0, &root, "README.md", "top\n", "rev-2").unwrap();
        let guide = load_in(&base.0, &root, "docs/guide.md").unwrap().unwrap();
        assert_eq!(guide.content, "# 内存版本\n");
        assert_eq!(guide.base_revision.as_deref(), Some("rev-1"));
        // 枚举按字典序，且只含本模块写下的条目
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["README.md".to_string(), "docs/guide.md".to_string()]
        );

        // 覆盖式写入：同键只留最新一份（内容与基准一起换）
        backup_in(&base.0, &root, "docs/guide.md", "# 更新版本\n", "rev-2").unwrap();
        let updated = load_in(&base.0, &root, "docs/guide.md").unwrap().unwrap();
        assert_eq!(updated.content, "# 更新版本\n");
        assert_eq!(updated.base_revision.as_deref(), Some("rev-2"));

        discard_in(&base.0, &root, "docs/guide.md").unwrap();
        assert!(load_in(&base.0, &root, "docs/guide.md").unwrap().is_none());
        // 幂等：再删一次不报错
        discard_in(&base.0, &root, "docs/guide.md").unwrap();
    }

    #[test]
    fn legacy_raw_backup_reads_content_without_base_revision() {
        let base = TempBase::new();
        let root = vault("vault-a");
        backup_in(&base.0, &root, "note.md", "x\n", "rev-1").unwrap();
        // 老格式（信封之前）的备份：原文即内容，无基准
        let entry_path = entry_path(&base.0, &root, "note.md").unwrap();
        std::fs::write(&entry_path, "裸文本内容\n").unwrap();
        let entry = load_in(&base.0, &root, "note.md").unwrap().unwrap();
        assert_eq!(entry.content, "裸文本内容\n");
        assert_eq!(entry.base_revision, None);
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["note.md".to_string()]
        );

        // 信封缺 base_revision（向前兼容）：内容仍可读，基准为 None
        std::fs::write(&entry_path, "{\"content\":\"只有正文\"}").unwrap();
        let entry = load_in(&base.0, &root, "note.md").unwrap().unwrap();
        assert_eq!(entry.content, "只有正文");
        assert_eq!(entry.base_revision, None);
    }

    #[test]
    fn partial_write_leaves_no_pending_backup_entry() {
        let base = TempBase::new();
        let root = vault("vault-a");
        let dir = base.0.join(vault_key(&root));
        std::fs::create_dir_all(&dir).unwrap();
        // 模拟 tmp + rename 中途崩溃：临时文件留在目录里
        let entry_path = entry_path(&base.0, &root, "note.md").unwrap();
        let name = entry_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        std::fs::write(dir.join(format!("{TMP_PREFIX}{name}")), "{ 半个信封").unwrap();
        assert_eq!(list_in(&base.0, &root).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn list_isolates_vaults() {
        let base = TempBase::new();
        let a = vault("vault-a");
        let b = vault("vault-b");
        backup_in(&base.0, &a, "note.md", "a\n", "rev-a").unwrap();
        backup_in(&base.0, &b, "note.md", "b\n", "rev-b").unwrap();
        assert_eq!(list_in(&base.0, &a).unwrap(), vec!["note.md".to_string()]);
        assert_eq!(content_of(&base.0, &a, "note.md").as_deref(), Some("a\n"));
        assert_eq!(content_of(&base.0, &b, "note.md").as_deref(), Some("b\n"));
    }

    #[test]
    fn foreign_names_are_skipped() {
        let base = TempBase::new();
        let root = vault("vault-a");
        backup_in(&base.0, &root, "note.md", "x\n", "rev-1").unwrap();
        let dir = base.0.join(vault_key(&root));
        std::fs::write(dir.join("%ZZ"), "外来文件").unwrap();
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["note.md".to_string()]
        );
    }

    #[test]
    fn invalid_relative_paths_rejected() {
        let base = TempBase::new();
        let root = vault("vault-a");
        for bad in ["", "/etc/passwd", "a/../b", "../escape.md", "a//b", "a/./b"] {
            let err = backup_in(&base.0, &root, bad, "x", "rev-1").unwrap_err();
            assert_eq!(err.code, "recovery_invalid_path", "输入：{bad}");
        }
        // 含 `..` 的文件名（非段）是合法的 vault 相对路径
        backup_in(&base.0, &root, "a..b.md", "x", "rev-1").unwrap();
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["a..b.md".to_string()]
        );
    }
}
