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

/// vault 根路径 → 文件名安全串：路径分隔符与非常规字符统一 `_`（避免目录穿越）。
fn sanitize(root: &Path) -> String {
    let raw = root.display().to_string();
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_separators() {
        assert_eq!(
            sanitize(Path::new("/tmp/a b/vault.md")),
            "_tmp_a_b_vault.md"
        );
        assert_eq!(sanitize(Path::new("plain")), "plain");
    }
}
