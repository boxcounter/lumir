//! 按 vault 的标签会话持久化（change multi-vault-workspaces，design §2/§3）。
//!
//! **为什么与注册项分开存放**（design §2）：注册项文件是身份（id ↔ path，remap 的锚点），
//! 它的读取路径对解析失败一律跳过（`workspaces.rs` 的三处读取）——把易变的界面状态混进
//! 身份文件，一次会话写坏就会升级成「vault 从列表与 remap 候选中消失」。会话单独落在
//! `vault-sessions/<id>.json` 后，损坏的最大后果只是「没有标签历史」。
//!
//! **写入纪律**：tmp + rename 原子替换（与注册项同）；解析失败 / `version` 不匹配 /
//! 字段类型非法一律按「无历史」处理并记 warning（ADR 0002 §5 的逐字段纪律），不抛错、
//! 不阻断打开。**读取纪律**：越界条目（绝对路径 / `..` / 带根前缀）静默丢弃——会话文件
//! 在配置目录里、是可被手工修改的面，不该成为打开 vault 之外文件的入口（ADR 0003）。
//!
//! **生命周期**：注册项只归档不删除，会话文件不参与注册表治理（`sweep_registry` 不碰它），
//! 也不做删除；孤儿文件只可能来自手工操作，属无害残留。

use crate::{commands::CommandError, config, workspaces};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use ts_rs::TS;

/// 会话 schema 版本：与文件不符者按「无历史」处理（不尝试向后兼容解释）。
pub const SESSION_VERSION: u32 = 1;

/// 一个 vault 的标签会话（唯一类型定义点，TS 类型由 ts-rs 导出）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultSession {
    pub version: u32,
    /// 有序的 vault 相对路径（固定标签；预览标签不入盘，design §4.2）。
    pub tabs: Vec<String>,
    /// 激活项（vault 相对路径）；非法值落为 null（前端按「退化到第一个可打开的标签」处理）。
    pub active: Option<String>,
    /// 落盘时间（Unix 毫秒）：写入侧填，读取侧不参与判断。
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// 会话目录：与注册表同级（design §2）。
pub fn sessions_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("vault-sessions"))
}

/// 读某 vault 的会话（目录可注入：测试不碰真实配置目录）。
///
/// 返回 `None` = 无历史：文件缺失 / 不可读 / 不是合法 JSON / 字段类型非法 / `version`
/// 不匹配——五种情况对调用方的语义完全相同（spec：会话损坏等价于无历史），只在后两类
/// 记 warning（缺失是首次打开某 vault 的常态，不报警）。
pub fn load_from(dir: &Path, id: &str) -> Option<VaultSession> {
    let path = dir.join(format!("{id}.json"));
    let Ok(text) = fs::read_to_string(&path) else {
        return None;
    };
    match serde_json::from_str::<VaultSession>(&text) {
        Ok(session) if session.version == SESSION_VERSION => Some(sanitize(session)),
        Ok(session) => {
            eprintln!(
                "lumir: vault 会话版本 v{} 不是本版支持的 v{SESSION_VERSION}（按无历史处理）：{}",
                session.version,
                path.display()
            );
            None
        }
        Err(e) => {
            eprintln!(
                "lumir: vault 会话不可解析（按无历史处理）：{}：{e}",
                path.display()
            );
            None
        }
    }
}

/// 条目校验（change task 2.2）：只接受结构上合法的 vault 相对路径，其余条目丢弃、激活项
/// 落为 `None`。**写入与读取共用**：写入侧让盘上不出现绝对路径（spec：MUST NOT 存绝对
/// 路径），读取侧给手工改过的文件兜底（spec：越界条目被丢弃、MUST NOT 被打开）。
/// 绝对路径 / 含 `..` / 带根或盘符前缀的形态在这里拦掉——前两道与
/// [`crate::fs_io::resolve_in_vault`] 同源；符号链接逃逸要 vault 根才能判定，权威判定仍在
/// 打开时的 `resolve_in_vault`（这里只拦「文本上就出界」的形态）。
fn sanitize(mut session: VaultSession) -> VaultSession {
    session.tabs.retain(|tab| valid_entry(tab));
    if session
        .active
        .as_deref()
        .is_some_and(|active| !valid_entry(active))
    {
        session.active = None;
    }
    session
}

fn valid_entry(entry: &str) -> bool {
    if entry.is_empty() {
        return false;
    }
    let path = Path::new(entry);
    if path.is_absolute() {
        return false;
    }
    !path.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    })
}

/// 落盘（目录可注入）：tmp + rename 原子替换，与注册项落盘（`workspaces::write_entry`）
/// 同纪律。返回 io::Result——降级语义由调用方给（见 [`vault_session_put`]）。
fn save_to(dir: &Path, id: &str, session: &VaultSession) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("{id}.json"));
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(session)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &path)
}

/// 读某 vault 的标签会话；无历史返回 null（不是错误——首次打开 / 损坏 / 版本不匹配都走这条路）。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_session_get(vault_id: String) -> Result<Option<VaultSession>, CommandError> {
    workspaces::valid_id(&vault_id)?;
    Ok(load_from(&sessions_dir()?, &vault_id))
}

/// 写某 vault 的标签会话（前端在标签变化后防抖写、切换前与退出前 flush）。
///
/// 写失败返回 `Ok(())` 并记 warning——与 `last_vault` 写失败同口径（M127），MUST NOT 拦停
/// 切换与打开：会话只影响「下次打开这个 vault 时恢复什么」，不值得让用户的一次切换失败。
/// 只有 `vault_id` 非法才返回错误信封：id 是文件名，这是路径逃逸防护（`workspaces::valid_id`），
/// 不是写失败。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_session_put(
    vault_id: String,
    tabs: Vec<String>,
    active: Option<String>,
) -> Result<(), CommandError> {
    workspaces::valid_id(&vault_id)?;
    let dir = sessions_dir()?;
    // 入口同一校验（见 [`sanitize`]）：盘上不出现绝对路径 / 越界条目。
    let session = sanitize(VaultSession {
        version: SESSION_VERSION,
        tabs,
        active,
        updated_at: workspaces::now_ms(),
    });
    if let Err(e) = save_to(&dir, &vault_id, &session) {
        eprintln!(
            "lumir: 记录 vault 会话失败（已忽略，切换与打开不受影响）：{}：{e}",
            dir.join(format!("{vault_id}.json")).display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向）：pid + 序号造唯一目录，Drop 时删除。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-vault-session-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn session(tabs: &[&str], active: Option<&str>) -> VaultSession {
        VaultSession {
            version: SESSION_VERSION,
            tabs: tabs.iter().map(|t| t.to_string()).collect(),
            active: active.map(|a| a.to_string()),
            updated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn round_trip_keeps_order_active_and_leaves_no_partial_file() {
        let dir = TempDir::new();
        let written = session(&["docs/a.md", "README.md"], Some("docs/a.md"));
        save_to(dir.path(), "vault-1", &written).expect("write session");
        assert_eq!(load_from(dir.path(), "vault-1"), Some(written));
        // 原子替换：临时文件不得留在盘上（否则下次读到的可能是半个 JSON）
        assert!(!dir.path().join("vault-1.json.tmp").exists());
    }

    #[test]
    fn missing_file_is_no_history() {
        let dir = TempDir::new();
        assert_eq!(load_from(dir.path(), "absent"), None);
    }

    #[test]
    fn corrupt_versionless_future_and_wrong_typed_files_are_all_no_history() {
        let dir = TempDir::new();
        fs::write(dir.path().join("bad.json"), "{not json").unwrap();
        assert_eq!(load_from(dir.path(), "bad"), None);

        // 缺 version：无法判定 schema，与损坏等价
        fs::write(dir.path().join("nover.json"), r#"{"tabs":["a.md"]}"#).unwrap();
        assert_eq!(load_from(dir.path(), "nover"), None);

        // 版本不匹配（更高版本应用写入）：不尝试解释
        fs::write(
            dir.path().join("future.json"),
            r#"{"version":99,"tabs":["a.md"],"active":null,"updated_at":0}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "future"), None);

        // 字段类型非法（tabs 不是数组）
        fs::write(
            dir.path().join("wrongtype.json"),
            r#"{"version":1,"tabs":"a.md","active":null,"updated_at":0}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "wrongtype"), None);
    }

    #[test]
    fn out_of_bounds_entries_are_dropped_and_valid_ones_survive() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("v.json"),
            r#"{"version":1,"tabs":["ok.md","/etc/passwd","../outside.md","docs/../../up.md","sub/ok.md",""],"active":"../outside.md","updated_at":1}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "v").expect("合法条目应照常返回");
        assert_eq!(loaded.tabs, vec!["ok.md", "sub/ok.md"]);
        assert_eq!(loaded.active, None, "非法激活项落为 null");
    }

    #[test]
    fn write_failure_is_reported_and_leaves_other_sessions_intact() {
        let dir = TempDir::new();
        let first = session(&["a.md"], Some("a.md"));
        save_to(dir.path(), "a", &first).expect("write a");

        // 目标目录的父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.path().join("blocker");
        fs::write(&blocker, "x").unwrap();
        assert!(save_to(&blocker.join("sessions"), "b", &session(&["b.md"], None)).is_err());

        // 失败不 panic（上面那行不炸即证），也不影响其它 vault 的会话（独立文件、单一写者）
        assert_eq!(load_from(dir.path(), "a"), Some(first));
        assert_eq!(load_from(dir.path(), "b"), None);
    }
}
