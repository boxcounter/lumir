//! 会话 JSONL 留存（design 提案点 9 / spec「会话本地留存」）：提问、回答、工具调用与
//! 结果、采纳 / 拒绝决策、usage 全部 append-only 落**配置目录**（ADR 0007 双向记录
//! 机制的本地一侧），**MUST NOT 写入 vault**。
//!
//! 路径：`<config_dir>/harness/<vault 根路径消毒>.jsonl`。每行一个 JSON 对象（含 unix
//! 秒时间戳与 kind 字段）；文件随会话对象首次记录时创建，「新会话」重置只丢内存句柄、
//! 文件继续追加（重置本身也记一条 `session_reset`）。写失败不阻断对话——留存是记录
//! 侧，丢一条记 stderr，不反过来弄坏运行时。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::commands::CommandError;

/// 一个 vault 会话的留存句柄。
pub struct JsonlWriter {
    path: PathBuf,
    file: Option<File>,
}

impl JsonlWriter {
    /// 打开（惰性建文件）：解析配置目录 + 按 vault 根算留存路径。此时不创建文件。
    pub fn open(vault_root: &Path) -> Result<Self, CommandError> {
        let dir = crate::config::config_dir()?.join("harness");
        std::fs::create_dir_all(&dir).map_err(|e| {
            CommandError::new(
                "harness_jsonl_failed",
                format!("无法创建会话留存目录 {}：{e}", dir.display()),
            )
            .param("dir", dir.display().to_string())
            .param("reason", e.to_string())
        })?;
        Ok(Self {
            path: dir.join(format!("{}.jsonl", sanitize(vault_root))),
            file: None,
        })
    }

    /// 追加一条记录。IO 失败只打 stderr（留存不可反过来弄坏对话）。
    pub fn record(&mut self, payload: &serde_json::Value) {
        let line = match serde_json::to_string(&serde_json::json!({
            "ts": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            "payload": payload,
        })) {
            Ok(line) => line,
            Err(e) => {
                eprintln!("lumir: harness jsonl 序列化失败：{e}");
                return;
            }
        };
        if self.file.is_none() {
            match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
            {
                Ok(file) => self.file = Some(file),
                Err(e) => {
                    eprintln!(
                        "lumir: harness jsonl 打开失败（{}）：{e}",
                        self.path.display()
                    );
                    return;
                }
            }
        }
        if let Some(file) = &mut self.file {
            if let Err(e) = writeln!(file, "{line}") {
                eprintln!(
                    "lumir: harness jsonl 写入失败（{}）：{e}",
                    self.path.display()
                );
            }
        }
    }

    /// 留存文件路径（jsonl 自检用）。
    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// vault 根路径 → 文件名安全串（**可逆编码**，防碰撞；M309）：字母数字与 `-` `.` 原样
/// 保留，`_` 转义为 `__`，其余任何字符按 UTF-8 字节编成 `_xHH`。旧映射把非常规字符
/// 统一压成 `_`，`/tmp/a b` 与 `/tmp/a_b` 因此同名；新编码下前者是
/// `_x2ftmp_x2fa_x20b`、后者是 `_x2ftmp_x2fa__b`，不再碰撞。
///
/// **存量兼容（探针期，M309）**：本编码替换了旧映射，旧文件名不再被续写——本机已存在的
/// 旧 JSONL 文件成为孤儿，不做迁移（探针期可接受；留存是审计侧记录，丢弃续写不阻断对话）。
fn sanitize(root: &Path) -> String {
    let raw = root.display().to_string();
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.') {
            out.push(c);
        } else if c == '_' {
            out.push_str("__");
        } else {
            let mut buf = [0u8; 4];
            for byte in c.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("_x{byte:02x}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_is_collision_free_and_reversible_shape() {
        // 回归：旧映射把两者都压成 `_tmp_a_b`；新编码必须区分（M309 碰撞对单测）。
        assert_ne!(
            sanitize(Path::new("/tmp/a b")),
            sanitize(Path::new("/tmp/a_b")),
        );
        assert_eq!(sanitize(Path::new("/tmp/a b")), "_x2ftmp_x2fa_x20b");
        assert_eq!(sanitize(Path::new("/tmp/a_b")), "_x2ftmp_x2fa__b");
        // 常规字符原样、`_` 双写、`-` `.` 不转义。
        assert_eq!(sanitize(Path::new("plain")), "plain");
        assert_eq!(sanitize(Path::new("a-b.c_d")), "a-b.c__d");
        // 非 ASCII 按 UTF-8 字节编码（可逆）。
        assert_eq!(sanitize(Path::new("笔记")), "_xe7_xac_x94_xe8_xae_xb0");
    }

    #[test]
    fn sanitize_never_emits_path_separator() {
        // 防目录穿越：产物里不得出现 `/` 或 `\`。
        for raw in ["/tmp/a/b", "\\windows\\path", "..\\.."] {
            let name = sanitize(Path::new(raw));
            assert!(!name.contains('/'), "{raw} -> {name}");
            assert!(!name.contains('\\'), "{raw} -> {name}");
        }
    }
}
