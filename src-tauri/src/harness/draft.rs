//! composer 草稿 sidecar（change composer-draft-persistence，design §3/§5/§7；spec
//! 「composer 草稿自动保存与恢复」）。
//!
//! 落点 `<config_dir>/harness/drafts/<vault 稳定 id>.json`——与会话留存
//! `sessions/<vault 稳定 id>/`、图片附件 `attachments/<vault 稳定 id>/` **同族的兄弟根**，
//! **MUST NOT 触碰 vault**（沿用会话留存铁律，`jsonl.rs:4-5`、ADR 0003）。目录名纪律复用
//! [`jsonl::vault_dir_name`]（`valid_id` 且 ≠ `_orphaned`）；id 不合格即**静默不落盘**——
//! 与附件的「拒绝落盘 + 人话错误」不同：草稿是无副作用的 UI 状态，「没有可归属身份」不等于
//! 错误（design §3；附件那张丢掉的图会被误以为已投递，草稿不会）。
//!
//! **本模块只做搬运**：载荷是前端序列化的块模型 JSON（`{"version":1,"blocks":[…]}`），后端
//! **不解析、不解释其结构**——(反)序列化的唯一实现点在 `src/quote-card.ts`（REVIEW.md 第 8
//! 条：同一语义不造两处真源）。IPC 面因此是 JSON String（`harness` 模块的既有纪律：命令
//! 返回值不为此新增 ts-rs 类型，见 `harness.rs` 模块头），也不产生新的 bindings 导出。
//!
//! **写入纪律**：tmp + rename 原子替换（与 `reading_position.rs` / `vault_session.rs` 同，
//! 不复制第二份实现）。**读取纪律**：缺失 / 不可读等价于「没有草稿」，一律不抛错。
//! **清除**（发送成功后）走空载荷 `""`——文件被删除，`MUST NOT` 留下一个空壳草稿。
//!
//! **写失败**：返回 `harness_draft_write_failed` 信封，由前端降级为一条人话 warning
//! （spec「写失败 SHALL 降级为人话 warning」）——后端若吞掉，前端就无从知道「没保存成」，
//! 那正是 spec 禁止的「谎报已保存」。写失败 MUST NOT 阻断输入：调用方 catch 后输入区照常。

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::CommandError;
use crate::config;

use super::jsonl;

/// 草稿目录：`<config_dir>/harness/drafts`（与 `sessions/` / `attachments/` 并列的兄弟根）。
/// 目录本身按需创建（写入时），读取不创建。
pub fn drafts_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("harness").join("drafts"))
}

/// 一个 vault 的草稿文件路径：`<dir>/<vault 稳定 id>.json`。id 不合格返回 `None`
/// （调用方静默不落盘，MUST NOT 落任何兜底目录——兜底目录读侧恒命不中，是静默丢草稿）。
fn draft_path(dir: &Path, vault_id: &str) -> Option<PathBuf> {
    jsonl::vault_dir_name(vault_id).map(|name| dir.join(format!("{name}.json")))
}

/// 读一个 vault 的草稿原文（目录可注入）。文件缺失 / 不可读 / id 不合格 → `None`——三种
/// 情况对调用方语义相同（没有草稿）。**内容不解析**（解释点在前端）。
pub fn load_from(dir: &Path, vault_id: &str) -> Option<String> {
    let path = draft_path(dir, vault_id)?;
    fs::read_to_string(path).ok()
}

/// 落盘（目录可注入）：tmp + rename 原子替换。id 不合格 = 静默不落盘（返回 `Ok`），
/// 与「无 vault」同一条路径——调用方区分不出、也不需要区分。
fn save_to(dir: &Path, vault_id: &str, text: &str) -> Result<(), CommandError> {
    let Some(path) = draft_path(dir, vault_id) else {
        return Ok(());
    };
    let tmp = path.with_extension("json.tmp");
    write_atomic(dir, &tmp, &path, text)
}

/// 清除一个 vault 的草稿（发送成功后）：删文件。文件本就不在 = 已是目标态，不报错。
fn clear_from(dir: &Path, vault_id: &str) -> Result<(), CommandError> {
    let Some(path) = draft_path(dir, vault_id) else {
        return Ok(());
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            // 删除失败 = 盘上留着一份已发送内容的草稿，下次装载会把它恢复回来。如实记一条
            // stderr（它是可见、可自行删除的残留），但**不**报成「保存失败」——发送本身成功，
            // 那条 toast 会说反事实（spec 的「写失败降级 warning」针对的是保存那一路）。
            eprintln!(
                "lumir: 清除 composer 草稿失败（已忽略）：{}：{e}",
                path.display()
            );
            Ok(())
        }
    }
}

/// tmp + rename 原子替换的落盘实现（目录按需创建）。
fn write_atomic(dir: &Path, tmp: &Path, path: &Path, text: &str) -> Result<(), CommandError> {
    let fail = |e: std::io::Error| {
        CommandError::new("harness_draft_write_failed", format!("草稿保存失败：{e}"))
            .param("reason", e.to_string())
    };
    fs::create_dir_all(dir).map_err(fail)?;
    fs::write(tmp, text).map_err(fail)?;
    fs::rename(tmp, path).map_err(fail)
}

/// 读命令的核心（目录可注入）：`vault_id = None` = 无 vault / 未打开 → 空。
pub fn get_for(dir: &Path, vault_id: Option<&str>) -> Option<String> {
    load_from(dir, vault_id?)
}

/// 写命令的核心（目录可注入）：`vault_id = None` = 无 vault → 静默不落盘（`Ok(())`，
/// 不报错、不落兜底目录）；空载荷 = 清除。
pub fn put_for(dir: &Path, vault_id: Option<&str>, draft_json: &str) -> Result<(), CommandError> {
    let Some(vault_id) = vault_id else {
        return Ok(());
    };
    if draft_json.is_empty() {
        return clear_from(dir, vault_id);
    }
    save_to(dir, vault_id, draft_json)
}

/// 当前 vault 的稳定 id；**无 vault 时 `None`**（`vault_not_open` 在这里不是错误——
/// 草稿是无副作用 UI 状态，spec：无 vault MUST NOT 报错、MUST NOT 落盘）。
fn current_vault_id(vault: &crate::commands::VaultState) -> Option<String> {
    vault
        .root_policy_and_id()
        .ok()
        .map(|(_, _, vault_id)| vault_id)
}

/// 读当前 vault 的草稿（JSON String 原文；无草稿 / 无 vault → null）。前端解析并还原块序列。
///
/// 前端**不传 vault**：落点按当前 `VaultScope.vault_id` 解析（`harness_write_image` 同形态）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_draft_get(
    vault: tauri::State<'_, crate::commands::VaultState>,
) -> Result<Option<String>, CommandError> {
    Ok(get_for(&drafts_dir()?, current_vault_id(&vault).as_deref()))
}

/// 写当前 vault 的草稿（`draft_json` 是块模型 JSON 原文；空串 = 清除）。
///
/// 无 vault → 静默 `Ok(())`（不落盘、不报错）；写失败 → `harness_draft_write_failed` 信封，
/// 前端降级为人话 warning 且不阻断输入（spec）。
#[tauri::command(rename_all = "snake_case")]
pub fn harness_draft_put(
    vault: tauri::State<'_, crate::commands::VaultState>,
    draft_json: String,
) -> Result<(), CommandError> {
    put_for(
        &drafts_dir()?,
        current_vault_id(&vault).as_deref(),
        &draft_json,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 无 tempfile 依赖（低依赖取向，同 `reading_position.rs` 的测试口径）。
    struct TempDir(PathBuf);
    static SEQ: AtomicU32 = AtomicU32::new(0);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lumir-harness-draft-test-{}-{}",
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

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .map(|it| {
                it.map(|e| e.unwrap().file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    const DRAFT: &str = r#"{"version":1,"blocks":[{"kind":"paragraph","text":"hi"}]}"#;

    #[test]
    fn round_trip_keeps_text_and_leaves_no_partial_file() {
        let dir = TempDir::new();
        put_for(dir.path(), Some("vault-1"), DRAFT).expect("写草稿");
        assert_eq!(get_for(dir.path(), Some("vault-1")).as_deref(), Some(DRAFT));
        // 原子替换：临时文件不得留在盘上（半个 JSON 会被前端当作损坏草稿）。
        assert!(!dir.path().join("vault-1.json.tmp").exists());
        // 目录里只有这一份文件 —— 草稿不往 vault 里落任何东西的前提，是这里也不留垃圾。
        assert_eq!(entries(dir.path()), vec!["vault-1.json".to_string()]);
    }

    #[test]
    fn missing_file_and_unreadable_dir_are_no_draft() {
        let dir = TempDir::new();
        assert_eq!(get_for(dir.path(), Some("absent")), None);
        // 目录都不存在（首次读）：不是错误。
        assert_eq!(get_for(&dir.path().join("nope"), Some("vault-1")), None);
    }

    #[test]
    fn overwrite_replaces_content_and_stale_tmp_is_not_read_back() {
        let dir = TempDir::new();
        put_for(dir.path(), Some("v"), DRAFT).unwrap();
        put_for(dir.path(), Some("v"), "{\"version\":1,\"blocks\":[]}").unwrap();
        assert_eq!(
            get_for(dir.path(), Some("v")).as_deref(),
            Some("{\"version\":1,\"blocks\":[]}")
        );
        // 上一次写入残留的 tmp（假想被中断）不是读取面：读的是 <id>.json。
        fs::write(dir.path().join("v.json.tmp"), "garbage").unwrap();
        assert_eq!(
            get_for(dir.path(), Some("v")).as_deref(),
            Some("{\"version\":1,\"blocks\":[]}")
        );
    }

    #[test]
    fn empty_payload_clears_the_file() {
        let dir = TempDir::new();
        put_for(dir.path(), Some("v"), DRAFT).unwrap();
        assert!(dir.path().join("v.json").exists());
        put_for(dir.path(), Some("v"), "").expect("清除");
        assert_eq!(get_for(dir.path(), Some("v")), None);
        assert!(!dir.path().join("v.json").exists());
        assert!(entries(dir.path()).is_empty(), "清除不留空壳文件");
        // 再清一次（文件已不在）= 目标态已达成，不报错。
        put_for(dir.path(), Some("v"), "").expect("重复清除");
    }

    #[test]
    fn no_vault_writes_nothing_and_reports_no_error() {
        let dir = TempDir::new();
        assert!(get_for(dir.path(), None).is_none(), "无 vault 读不到草稿");
        put_for(dir.path(), None, DRAFT).expect("无 vault 写入静默成功");
        put_for(dir.path(), None, "").expect("无 vault 清除静默成功");
        // MUST NOT 落任何文件、MUST NOT 建兜底目录（目录里一个条目都不该多出来）。
        assert!(
            entries(dir.path()).is_empty(),
            "无 vault 不落盘、不建兜底目录"
        );
    }

    #[test]
    fn path_escape_ids_are_rejected_silently() {
        let base = TempDir::new();
        let dir = base.path().join("drafts");
        let outside = base.path().join("outside.json");
        let too_long = "x".repeat(200);
        // 非法 id（路径分隔符 / `..` / 保留名 / 空串 / 超长）：读写清一律静默 no-op。
        for bad in [
            "../outside",
            "..",
            "a/b",
            "_orphaned",
            "",
            too_long.as_str(),
        ] {
            put_for(&dir, Some(bad), DRAFT).expect("非法 id 静默成功");
            assert!(get_for(&dir, Some(bad)).is_none(), "{bad}");
            // 清除同一条路径：同样静默。
            put_for(&dir, Some(bad), "").expect("非法 id 清除静默成功");
            assert!(!outside.exists(), "不得越出目录写文件：{bad}");
            assert!(!dir.exists(), "非法 id 连目录都不该建：{bad}");
        }
    }

    #[test]
    fn write_failure_reports_an_envelope_and_leaves_other_vaults_intact() {
        let dir = TempDir::new();
        put_for(dir.path(), Some("a"), DRAFT).unwrap();
        // 目标是普通文件 → create_dir_all 必失败。
        let blocker = dir.path().join("blocker");
        fs::write(&blocker, "x").unwrap();
        let err = save_to(&blocker.join("drafts"), "b", DRAFT).unwrap_err();
        assert_eq!(err.code, "harness_draft_write_failed");
        assert!(err.message.starts_with("草稿保存失败："), "{}", err.message);
        assert!(
            err.params.contains_key("reason"),
            "带 reason 参数供前端代入"
        );
        // 失败不 panic，也不影响别的 vault 的草稿（独立文件、单一写者）。
        assert_eq!(get_for(dir.path(), Some("a")).as_deref(), Some(DRAFT));
        assert_eq!(get_for(dir.path(), Some("b")), None);
    }
}
