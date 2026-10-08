//! 会话 JSONL 留存（change reshape-harness-session-recording，spec「会话本地留存」的
//! wire 口径）：留存定位是**完整会话记录**——每会话一个 append-only JSONL，按发给
//! 模型的形态直接记录（参照 Claude Code / Kimi Code 的 session wire.jsonl），
//! 分析与恢复共用同一份事实。留存落在**配置目录**（ADR 0007 双向记录机制的本地一侧），
//! **MUST NOT 写入 vault**。
//!
//! 布局：`<config_dir>/harness/sessions/<session_id>.jsonl`。首行恒为 `session_open`
//! （完整装配记录：system prompt 全文 + 每来源的路径与存在与否 + provider / 模型 /
//! 思考档位）；其后 `llm_request` / `llm_response` 严格交替成对（工具循环每次迭代与
//! 压缩调用自身都各算一次 LLM 调用）；批准 / 拒绝 / 中断 / 错误等 wire 不可推导的
//! 决策落 sidecar 记录（`approval` / `turn_aborted` / `llm_error` / `loop_max_reached`）。
//!
//! **旧形态孤儿（M309 先例）**：本布局替换了旧的 `<config_dir>/harness/<vault 消毒名>.jsonl`
//! 聚合文件——旧文件不再续写、不做迁移（探针期可接受；留存是审计侧记录，丢弃续写不阻断
//! 对话；REVIEW.md 第 21 条「消费者是谁」：运行时与产品侧零读者）。
//!
//! 写失败不阻断对话——留存是记录侧，IO / 序列化失败只打 stderr（不变量 6），
//! 不反过来弄坏运行时；打开（建文件）失败则走 CommandError（与既有建立纪律同口径）。

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

/// 生成一个时间序 session id：`s<unix_millis>-<6 位随机 base36>`（如 `s1759912345678-k3x9ab`）。
/// 时间序是为了「按时间列出会话」——未来的第一消费姿势（design §1）；随机段把同一毫秒内的
/// 多次建立区分开（`rand` 已在依赖树内，transitive 零新增）。
pub fn new_session_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut random = rand::random::<u64>();
    let mut suffix = String::with_capacity(6);
    for _ in 0..6 {
        let digit = (random % 36) as u8;
        suffix.push(match digit {
            0..=9 => (b'0' + digit) as char,
            _ => (b'a' + digit - 10) as char,
        });
        random /= 36;
    }
    format!("s{millis}-{suffix}")
}

/// session id 的形态校验（恢复命令的入参防线）：只允许 `[a-z0-9-]`、以 `s` 开头、
/// 长度有界——保证拼进 `sessions/` 目录后不可能穿越出目录（无 `.`、无路径分隔符）。
pub fn is_valid_session_id(id: &str) -> bool {
    id.len() >= 8
        && id.len() <= 64
        && id.starts_with('s')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 会话留存目录：`<config_dir>/harness/sessions`。
pub fn sessions_dir() -> Result<PathBuf, CommandError> {
    let dir = crate::config::config_dir()?
        .join("harness")
        .join("sessions");
    std::fs::create_dir_all(&dir).map_err(|e| {
        CommandError::new(
            "harness_jsonl_failed",
            format!("无法创建会话留存目录 {}：{e}", dir.display()),
        )
        .param("dir", dir.display().to_string())
        .param("reason", e.to_string())
    })?;
    Ok(dir)
}

/// 一个逻辑会话的留存句柄。append-only；首行恒为 `session_open`（构造时给定，
/// **惰性**落到第一条记录时写入——从未记录的会话不落文件）。
pub struct JsonlWriter {
    path: PathBuf,
    file: Option<File>,
    /// 尚未写出的 `session_open` 行（序列化后的 envelope）。第一条 `record` 时
    /// 随文件创建一并写盘，写盘后即 `None`——首行不变量由这个挂起行保证。
    pending_open: Option<String>,
}

impl JsonlWriter {
    /// 建一个新会话的留存文件句柄：`sessions/<session_id>.jsonl`，首行挂起
    /// `session_open` 行。文件本身惰性创建（与旧口径一致：句柄可建，文件随首条记录）。
    /// `session_open` 形状契约见 design §2（kind / session_id / vault_root / opened_from /
    /// provider / model / thinking / system / assembly / compact_summary?）。
    pub fn create(
        session_id: &str,
        session_open: &serde_json::Value,
    ) -> Result<Self, CommandError> {
        let dir = sessions_dir()?;
        let path = dir.join(format!("{session_id}.jsonl"));
        let line = serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": session_open,
        }))
        .map_err(|e| {
            CommandError::new(
                "harness_jsonl_failed",
                format!("session_open 序列化失败：{e}"),
            )
            .param("dir", dir.display().to_string())
            .param("reason", e.to_string())
        })?;
        Ok(Self {
            path,
            file: None,
            pending_open: Some(line),
        })
    }

    /// 追加一条记录。首条记录先把挂起的 `session_open` 写出。写失败只打 stderr
    /// （留存不可反过来弄坏对话）。
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
        if self.file.is_none() && !self.open_file() {
            return;
        }
        if let Some(file) = &mut self.file {
            if let Some(open) = self.pending_open.take() {
                if let Err(e) = writeln!(file, "{open}") {
                    eprintln!(
                        "lumir: harness jsonl 写入失败（{}）：{e}",
                        self.path.display()
                    );
                    return;
                }
            }
            if let Err(e) = writeln!(file, "{line}") {
                eprintln!(
                    "lumir: harness jsonl 写入失败（{}）：{e}",
                    self.path.display()
                );
            }
        }
    }

    /// 打开（创建）留存文件。`create_new` 防 session id 碰撞时静默踩别人的文件。
    /// 失败只打 stderr 并返回 false（记录侧纪律），调用侧据此跳过本条。
    fn open_file(&mut self) -> bool {
        match OpenOptions::new()
            .create_new(true)
            .append(true)
            .open(&self.path)
        {
            Ok(file) => {
                self.file = Some(file);
                true
            }
            Err(e) => {
                eprintln!(
                    "lumir: harness jsonl 打开失败（{}）：{e}",
                    self.path.display()
                );
                false
            }
        }
    }

    /// 在 `session_open` 尚未落盘时更新它的一个字段（ thinking 档位的滞后修正：
    /// 会话建立与首条记录之间用户可能切过档位，首行要反映实际发出请求时的档位）。
    /// 已落盘则为 no-op（历史不改写）。
    pub fn update_pending_open<F: FnOnce(&mut serde_json::Value)>(&mut self, update: F) {
        if self.pending_open.is_none() {
            return;
        }
        let Ok(mut envelope) =
            serde_json::from_str::<serde_json::Value>(self.pending_open.as_deref().unwrap_or(""))
        else {
            return;
        };
        if let Some(payload) = envelope.get_mut("payload") {
            update(payload);
            if let Ok(line) = serde_json::to_string(&envelope) {
                self.pending_open = Some(line);
            }
        }
    }

    /// 留存文件路径（测试与恢复用）。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 测试专用：直接指定留存路径（绕开 config_dir，零环境变量扰动——env 是进程全局，
    /// cargo test 并行跑，改 XDG_CONFIG_HOME 会踩到别的用例；REVIEW.md 第 13 条）。
    #[cfg(test)]
    fn at_path(path: PathBuf, session_open: &serde_json::Value) -> Self {
        let line = serde_json::to_string(&serde_json::json!({
            "ts": unix_secs_now(),
            "payload": session_open,
        }))
        .unwrap();
        Self {
            path,
            file: None,
            pending_open: Some(line),
        }
    }

    /// 从留存文件路径取 session id（`sessions/<session_id>.jsonl` 的文件名部分；
    /// 测试与恢复命令的解析共用）。
    pub fn session_id_from_path(path: &Path) -> Option<String> {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
    }
}

// ---------------------------------------------------------------------------
// 读取侧（恢复逻辑的消费者）：从留存文件重建会话状态
// ---------------------------------------------------------------------------

/// 一份解析后的会话留存：首行 `session_open` + 全部 payload（按文件序）。
#[derive(Debug)]
pub struct SessionFile {
    /// 首行信封的 `ts`（UNIX 秒，会话建立时刻）——会话列举的展示 / 排序素材。
    /// 历史文件缺该字段时为 `None`（宽容读，不因此判整份文件非法）。
    pub first_ts: Option<u64>,
    /// 首行 `session_open` payload（含 system 全文 / assembly / provider / model / thinking）。
    pub session_open: serde_json::Value,
    /// 全部记录的 payload（含 `session_open` 自身，按文件序）。
    pub records: Vec<serde_json::Value>,
}

/// 读取并解析一份会话留存文件。每行 envelope（`{ts, payload}`）逐条解析；首行必须是
/// `session_open`。整文件读取——会话文件是 append-only 的封闭事实，恢复一次性消费。
pub fn read_session_file(path: &Path) -> Result<SessionFile, CommandError> {
    let content = std::fs::read_to_string(path).map_err(|e| {
        CommandError::new(
            "harness_session_unreadable",
            format!("会话留存不可读（{}）：{e}", path.display()),
        )
        .param("path", path.display().to_string())
        .param("reason", e.to_string())
    })?;
    let mut records = Vec::new();
    let mut first_ts = None;
    for (index, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let envelope: serde_json::Value = serde_json::from_str(line).map_err(|e| {
            CommandError::new(
                "harness_session_invalid",
                format!("会话留存第 {} 行不是合法 JSON：{e}", index + 1),
            )
            .param("path", path.display().to_string())
        })?;
        if records.is_empty() {
            first_ts = envelope["ts"].as_u64();
        }
        records.push(envelope["payload"].clone());
    }
    let Some(session_open) = records.first().filter(|r| r["kind"] == "session_open") else {
        return Err(CommandError::new(
            "harness_session_invalid",
            format!("会话留存首行不是 session_open（{}）", path.display()),
        ));
    };
    Ok(SessionFile {
        first_ts,
        session_open: session_open.clone(),
        records,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lumir-harness-jsonl-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 合成一份最小 session_open（形状同 design §2）。
    fn session_open(id: &str) -> serde_json::Value {
        serde_json::json!({
            "kind": "session_open",
            "session_id": id,
            "vault_root": "/tmp/demo-vault",
            "opened_from": "new",
            "provider": "mock",
            "model": "mock-model",
            "thinking": "high",
            "system": "完整 system prompt 全文",
            "assembly": [
                {"source": "identity", "path": null, "exists": true, "bytes": 412},
                {"source": "agents_vault_root", "path": "/tmp/demo-vault/AGENTS.md",
                 "exists": false, "bytes": 0},
            ],
        })
    }

    #[test]
    fn session_id_is_time_ordered_randomized_and_validated() {
        let id = new_session_id();
        assert!(id.starts_with('s'), "{id}");
        assert!(is_valid_session_id(&id), "{id}");
        // 时间序：两个连续生成的 id 毫秒段单调不减。
        let other = new_session_id();
        let millis = |s: &str| s[1..s.find('-').unwrap()].parse::<u128>().unwrap();
        assert!(millis(&other) >= millis(&id));
        // 目录穿越与畸形入参一律拒。
        for bad in [
            "../etc/passwd",
            "s12345/x",
            "sABC-123456",
            "..",
            "s",
            "s.xxx-yyyyyy",
        ] {
            assert!(!is_valid_session_id(bad), "{bad}");
        }
    }

    /// 首行不变量：无论第一条记录是什么 kind，`session_open` 恒在第一行；
    /// 且 `update_pending_open` 能在落盘前修正字段、落盘后不再改写。
    #[test]
    fn first_line_is_always_session_open_and_pending_update_works() {
        let dir = tmpdir("pending-open");
        let mut writer =
            JsonlWriter::at_path(dir.join("s-testaa.jsonl"), &session_open("s-testaa"));
        // 句柄创建即挂起首行，但文件惰性——record 之前不落盘。
        assert!(!writer.path().exists(), "首条记录前文件不应创建");
        writer.update_pending_open(|open| open["thinking"] = "max".into());
        writer.record(&serde_json::json!({"kind": "llm_request", "request": {"messages": []}}));
        let content = std::fs::read_to_string(writer.path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content}");
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["payload"]["kind"], "session_open");
        assert_eq!(first["payload"]["thinking"], "max", "挂起行修正必须生效");
        // 已落盘后再改 = no-op。
        writer.update_pending_open(|open| open["thinking"] = "low".into());
        let content = std::fs::read_to_string(writer.path()).unwrap();
        assert!(content.contains("\"thinking\":\"max\""), "{content}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 引用消息序列化协议的 wire 口径（change add-harness-quote-cards 的留存条款迁移）：
    /// 序列化后的完整消息（含 `<quote>` 块）在 `llm_request.messages` 数组中逐字节在场——
    /// 含标签、三属性、转义字符与交错的问题文字。一行一条、append-only、首行 session_open。
    #[test]
    fn llm_request_preserves_serialized_quote_message_verbatim() {
        let dir = tmpdir("quote-wire");
        let id = "s1759912345678-quote1";
        let mut writer = JsonlWriter::at_path(dir.join("quote.jsonl"), &session_open(id));
        // 与 M342 单测同形的合成 fixture（serializeQuoteMessage 的产物）：两张卡片 +
        // 两段问题，属性值与文本含 XML 保留字符（& < "）。
        let message = "<quote file=\"reading-workflow.md\" heading=\"筛选 &amp; 排序\" lines=\"9-10\">先读结论 &lt;再读论证&gt;</quote>\n这段是什么意思？\n<quote file=\"reading-workflow.md\" heading=\"复盘\" lines=\"16-17\">每周捞出「可执行动作\"</quote>\n这里指什么？";
        writer.record(&serde_json::json!({
            "kind": "llm_request",
            "request": {
                "provider": "mock",
                "model": "mock-model",
                "system": "完整 system prompt 全文",
                "messages": [
                    {"role": "user", "content": [{"type": "input_text", "text": message}]},
                ],
                "params": {"thinking": "high"},
            },
        }));
        let content = std::fs::read_to_string(writer.path()).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "{content}");
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["payload"]["kind"], "session_open");
        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(
            second["payload"]["request"]["messages"][0]["content"][0]["text"]
                .as_str()
                .unwrap(),
            message,
            "留存必须逐字节保序列化消息"
        );
        assert!(second["ts"].is_u64(), "{lines:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_session_file_roundtrip_and_validation() {
        let dir = tmpdir("read-back");
        let id = "s1759912345678-readb1";
        let mut writer = JsonlWriter::at_path(dir.join("readback.jsonl"), &session_open(id));
        writer.record(&serde_json::json!({"kind": "llm_response", "text": "答。"}));
        let file = read_session_file(writer.path()).unwrap();
        assert_eq!(file.session_open["session_id"], id);
        assert_eq!(file.records.len(), 2);
        assert_eq!(file.records[1]["kind"], "llm_response");

        // 首行不是 session_open ⇒ 拒。
        let bad = dir.join("bad.jsonl");
        std::fs::write(&bad, "{\"ts\":1,\"payload\":{\"kind\":\"llm_request\"}}\n").unwrap();
        let err = read_session_file(&bad).unwrap_err();
        assert_eq!(err.code, "harness_session_invalid");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
