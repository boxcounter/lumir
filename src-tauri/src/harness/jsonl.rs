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

/// 当前 UNIX 秒时间戳。JSONL 留存记录的 `ts` 与面板消息的 `ts`（[`super::session::PanelMessage`]）
/// **共用这一个取时点**——两处各自写 `SystemTime::now()` 会漂，而两者同口径正是「面板上的时间
/// 与留存里的时间对得上」的前提（M353）。系统时钟早于 epoch 时记 0（旧写法同口径）。
pub(crate) fn unix_secs_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

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
            "ts": unix_secs_now(),
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

    /// 测试专用：直接指定留存路径（绕开 config_dir，零环境变量扰动——env 是进程全局，
    /// cargo test 并行跑，改 XDG_CONFIG_HOME 会踩到别的用例）。
    #[cfg(test)]
    fn at_path(path: PathBuf) -> Self {
        Self { path, file: None }
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

    /// 会话留存记录序列化后的完整用户消息（change add-harness-quote-cards spec「会话
    /// JSONL 留存 SHALL 记录序列化后的完整消息（含 <quote> 块）」）：投递文本在留存文件里
    /// 逐字节在场——含 <quote> 标签、三属性、转义字符与交错的问题文字，一行一条、append-only。
    #[test]
    fn record_preserves_serialized_quote_message_verbatim() {
        let dir =
            std::env::temp_dir().join(format!("lumir-harness-jsonl-quote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut writer = JsonlWriter::at_path(dir.join("vault.jsonl"));

        // 与 M342 单测同形的合成 fixture（serializeQuoteMessage 的产物）：两张卡片 +
        // 两段问题，属性值与文本含 XML 保留字符（& < "）。
        let message = "<quote file=\"reading-workflow.md\" heading=\"筛选 &amp; 排序\" lines=\"9-10\">先读结论 &lt;再读论证&gt;</quote>\n这段是什么意思？\n<quote file=\"reading-workflow.md\" heading=\"复盘\" lines=\"16-17\">每周捞出「可执行动作\"</quote>\n这里指什么？";
        for _ in 0..2 {
            writer.record(&serde_json::json!({
                "kind": "user_message",
                "text": message,
            }));
        }
        // record 的 IO 失败路径只打 stderr：文件必须真实存在、两行、消息逐字节在场。
        let content = std::fs::read_to_string(writer.path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content}");
        for line in &lines {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(
                value["payload"]["text"].as_str().unwrap(),
                message,
                "留存必须逐字节保序列化消息"
            );
            assert!(value["ts"].is_u64(), "{line}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
