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
//! 备份内容即内存文档原文（UTF-8），不做格式包装：用户可直接查看恢复目录里的文件。

use std::path::{Path, PathBuf};

use crate::commands::CommandError;
use crate::config;

/// 恢复目录根：`<config_dir>/recovery`。
pub fn backup_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("recovery"))
}

/// 写崩溃备份（覆盖式；同 (vault, path) 只保留最新一份内存内容）。
pub fn backup(root: &Path, rel: &str, content: &str) -> Result<(), CommandError> {
    backup_in(&backup_dir()?, root, rel, content)
}

/// 读崩溃备份内容；无备份返回 `Ok(None)`（不是错误）。
pub fn load(root: &Path, rel: &str) -> Result<Option<String>, CommandError> {
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

fn backup_in(base: &Path, root: &Path, rel: &str, content: &str) -> Result<(), CommandError> {
    let path = entry_path(base, root, rel)?;
    let dir = path.parent().expect("备份路径必有父目录");
    std::fs::create_dir_all(dir).map_err(|e| {
        CommandError::new(
            "recovery_write_failed",
            format!("无法创建恢复目录 {}：{e}", dir.display()),
        )
    })?;
    std::fs::write(&path, content).map_err(|e| {
        CommandError::new(
            "recovery_write_failed",
            format!("无法写入崩溃备份 {}：{e}", path.display()),
        )
    })
}

fn load_in(base: &Path, root: &Path, rel: &str) -> Result<Option<String>, CommandError> {
    let path = entry_path(base, root, rel)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(CommandError::new(
            "recovery_read_failed",
            format!("无法读取崩溃备份 {}：{e}", path.display()),
        )),
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
        // 只认本模块编码规则产出的单层文件；外来名字跳过而非报错。
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(rel) = decode_path(name) {
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
        assert_eq!(load_in(&base.0, &root, "docs/guide.md").unwrap(), None);

        backup_in(&base.0, &root, "docs/guide.md", "# 内存版本\n").unwrap();
        backup_in(&base.0, &root, "README.md", "top\n").unwrap();
        assert_eq!(
            load_in(&base.0, &root, "docs/guide.md").unwrap().as_deref(),
            Some("# 内存版本\n")
        );
        // 枚举按字典序，且只含本模块写下的条目
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["README.md".to_string(), "docs/guide.md".to_string()]
        );

        // 覆盖式写入：同键只留最新一份
        backup_in(&base.0, &root, "docs/guide.md", "# 更新版本\n").unwrap();
        assert_eq!(
            load_in(&base.0, &root, "docs/guide.md").unwrap().as_deref(),
            Some("# 更新版本\n")
        );

        discard_in(&base.0, &root, "docs/guide.md").unwrap();
        assert_eq!(load_in(&base.0, &root, "docs/guide.md").unwrap(), None);
        // 幂等：再删一次不报错
        discard_in(&base.0, &root, "docs/guide.md").unwrap();
    }

    #[test]
    fn list_isolates_vaults() {
        let base = TempBase::new();
        let a = vault("vault-a");
        let b = vault("vault-b");
        backup_in(&base.0, &a, "note.md", "a\n").unwrap();
        backup_in(&base.0, &b, "note.md", "b\n").unwrap();
        assert_eq!(list_in(&base.0, &a).unwrap(), vec!["note.md".to_string()]);
        assert_eq!(
            load_in(&base.0, &a, "note.md").unwrap().as_deref(),
            Some("a\n")
        );
        assert_eq!(
            load_in(&base.0, &b, "note.md").unwrap().as_deref(),
            Some("b\n")
        );
    }

    #[test]
    fn foreign_names_are_skipped() {
        let base = TempBase::new();
        let root = vault("vault-a");
        backup_in(&base.0, &root, "note.md", "x\n").unwrap();
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
            let err = backup_in(&base.0, &root, bad, "x").unwrap_err();
            assert_eq!(err.code, "recovery_invalid_path", "输入：{bad}");
        }
        // 含 `..` 的文件名（非段）是合法的 vault 相对路径
        backup_in(&base.0, &root, "a..b.md", "x").unwrap();
        assert_eq!(
            list_in(&base.0, &root).unwrap(),
            vec!["a..b.md".to_string()]
        );
    }
}
