//! 按 vault 的文档阅读位置持久化（change remember-reading-position，design §3/§2.4）。
//!
//! **为什么与标签列表分开存**（design §3 候选 B 的取舍）：标签文件的写入触发点是**标签集合
//! 变化**，而位置随滚动改写——混进同一个文件会让每一次滚动牵动「打开哪些标签」这个关键状态
//! （写放大），且「按 vault 持久化标签列表」那条 requirement 的禁止语义正是「内容不含滚动
//! 位置」。本文件与 `vault-sessions/` 并列落在配置目录：
//!
//! - **键**是 vault 相对路径（与标签列表同口径：vault 重定位后仍然有效，MUST NOT 存绝对路径）。
//! - **值**是「文档位置锚 + 纵向相对偏移 + 横向位置 + 写入时刻」，值语义由前端构造（唯一构造
//!   点见 `src/reading-position.ts` 与 `src/editor.ts` 的 `readScrollPosition`），本模块不解释
//!   它、只做逐字段校验与容量治理。
//!
//! **写入纪律**：tmp + rename 原子替换（与注册项、标签会话同）；写失败由命令降级为 warning，
//! 不拦停打开 / 切换 / 退出。**读取纪律**：文件缺失 / 不可读 / 不是合法 JSON / 字段类型非法 /
//! `version` 不匹配，五种情况对调用方的语义完全相同——「没有阅读位置历史」，一律不抛错。
//! **键校验**复用 [`crate::vault_session::valid_entry`]：绝对路径 / 含 `..` / 带根或盘符前缀
//! 一律丢弃，写入与读取共用同一份判定（REVIEW.md 第 8 条：同一语义不造两处真源）。
//!
//! **容量**：每个 vault 的条目数有上限（[`MAX_ENTRIES`]），超出按写入时刻最旧者淘汰——只防
//! 无界增长，不做「按时效失效」（「几个月前读一半的书」不该因为时间被丢掉，design §3 候选②）。

use crate::{commands::CommandError, config, vault_session, workspaces};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use ts_rs::TS;

/// 位置 schema 版本：与文件不符者按「无历史」处理（不尝试向后兼容解释）。
pub const READING_POSITION_VERSION: u32 = 1;

/// 每个 vault 的条目上限，超出按 `at` 最旧者淘汰。
///
/// **与前端同值**（`src/reading-position.ts` 的 `READING_POSITION_MAX_ENTRIES`）：本模块是
/// **权威**——手改过的文件、别的写者都可能送来超限内容，读侧与写侧都在这里收口；前端那份只
/// 守住内存与载荷上界（它自己产出的条目永不超过这里能接受的量）。两处任一处改动都必须同步，
/// 判定分散在两个技术栈里是这套存储的既有限制（Rust 侧无法把常量经 ts-rs 导出）。
pub const MAX_ENTRIES: usize = 200;

/// 一份文档的阅读位置（唯一类型定义点，TS 类型由 ts-rs 导出）。
///
/// 三个量的语义**由前端定义**（本模块不参与换算）：`pos` 是文档位置锚（视口顶附近的行块起始
/// 位置），`y` / `x` 是该锚的字符盒相对滚动容器顶 / 左的实际偏移。`at` 只用于容量淘汰，不参与
/// 恢复判定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReadingPositionEntry {
    pub pos: f64,
    pub y: f64,
    pub x: f64,
    /// 写入时刻（Unix 毫秒）：写入侧填，读取侧只用于淘汰排序。
    #[ts(type = "number")]
    pub at: i64,
}

/// 一个 vault 的阅读位置表（version + 键为 vault 相对路径的条目）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ReadingPositions {
    pub version: u32,
    pub entries: HashMap<String, ReadingPositionEntry>,
}

/// 位置目录：与注册表、标签会话同级（design §3 推荐 A）。
pub fn positions_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("reading-positions"))
}

/// 读某 vault 的阅读位置（目录可注入：测试不碰真实配置目录）。
///
/// 返回 `None` = 没有历史：文件缺失 / 不可读 / 不是合法 JSON / 字段类型非法 / `version`
/// 不匹配——五种情况对调用方的语义完全相同（spec：读不到或版本不符等价于无历史），只在后两
/// 类记 warning（缺失是首次读到某 vault 的常态，不报警）。
pub fn load_from(dir: &Path, id: &str) -> Option<ReadingPositions> {
    let path = dir.join(format!("{id}.json"));
    let Ok(text) = fs::read_to_string(&path) else {
        return None;
    };
    match serde_json::from_str::<ReadingPositions>(&text) {
        Ok(positions) if positions.version == READING_POSITION_VERSION => Some(sanitize(positions)),
        Ok(positions) => {
            eprintln!(
                "lumir: 阅读位置版本 v{} 不是本版支持的 v{READING_POSITION_VERSION}（按无历史处理）：{}",
                positions.version,
                path.display()
            );
            None
        }
        Err(e) => {
            eprintln!(
                "lumir: 阅读位置不可解析（按无历史处理）：{}：{e}",
                path.display()
            );
            None
        }
    }
}

/// 条目校验与容量治理：**写入与读取共用**。
///
/// 键用 [`vault_session::valid_entry`]（绝对路径 / 含 `..` / 带根前缀一律丢弃）；值要求三个量
/// 有限、锚非负（ADR 0002 §5 的逐字段纪律：非法值不带进内存镜像）；超限时按 `at` 最旧者淘汰，
/// `at` 相同时按键名定序，保证同一份输入淘汰结果稳定（可断言）。
fn sanitize(mut positions: ReadingPositions) -> ReadingPositions {
    positions
        .entries
        .retain(|key, entry| vault_session::valid_entry(key) && valid_entry(entry));
    if positions.entries.len() > MAX_ENTRIES {
        let mut by_age: Vec<(String, i64)> = positions
            .entries
            .iter()
            .map(|(key, entry)| (key.clone(), entry.at))
            .collect();
        // 最旧的排前面；同刻按键名定序（稳定淘汰，不看 HashMap 的遍历顺序）。
        by_age.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        for (key, _) in by_age
            .into_iter()
            .take(positions.entries.len() - MAX_ENTRIES)
        {
            positions.entries.remove(&key);
        }
    }
    positions
}

fn valid_entry(entry: &ReadingPositionEntry) -> bool {
    entry.pos.is_finite() && entry.pos >= 0.0 && entry.y.is_finite() && entry.x.is_finite()
}

/// 落盘（目录可注入）：tmp + rename 原子替换，与注册项落盘（`workspaces::write_entry`）同纪律。
/// 返回 io::Result——降级语义由调用方给（见 [`reading_position_put`]）。
fn save_to(dir: &Path, id: &str, positions: &ReadingPositions) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("{id}.json"));
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(positions)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, &path)
}

/// 读某 vault 的阅读位置；无历史返回 null（不是错误——首次读到 / 损坏 / 版本不匹配都走这条路）。
#[tauri::command(rename_all = "snake_case")]
pub fn reading_position_get(vault_id: String) -> Result<Option<ReadingPositions>, CommandError> {
    workspaces::valid_id(&vault_id)?;
    Ok(load_from(&positions_dir()?, &vault_id))
}

/// 写某 vault 的阅读位置（前端在滚动停止后防抖写、切换文件 / 标签 / vault 前与退出前 flush）。
///
/// 载荷是**整份内存镜像**（前端合并后的全量条目，≤ 上限），不是增量补丁：并发写同一份文件只
/// 可能「后写覆盖先写」（design §7 第 9 条接受的最坏结果），不需要合并语义。
///
/// 写失败返回 `Ok(())` 并记 warning——与 `last_vault`、标签会话写失败同口径：位置只影响「下次
/// 打开这份文档从哪里开始」，不值得让用户的一次切换或退出失败。只有 `vault_id` 非法才返回错误
/// 信封：id 是文件名，这是路径逃逸防护（`workspaces::valid_id`），不是写失败。
#[tauri::command(rename_all = "snake_case")]
pub fn reading_position_put(
    vault_id: String,
    entries: HashMap<String, ReadingPositionEntry>,
) -> Result<(), CommandError> {
    workspaces::valid_id(&vault_id)?;
    let dir = positions_dir()?;
    // 入口同一校验（见 [`sanitize`]）：盘上不出现绝对路径 / 越界键，条目数不超上限。
    let positions = sanitize(ReadingPositions {
        version: READING_POSITION_VERSION,
        entries,
    });
    if let Err(e) = save_to(&dir, &vault_id, &positions) {
        eprintln!(
            "lumir: 记录阅读位置失败（已忽略，打开与切换不受影响）：{}：{e}",
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
                "lumir-reading-position-test-{}-{}",
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

    fn entry(pos: f64, at: i64) -> ReadingPositionEntry {
        ReadingPositionEntry {
            pos,
            y: 48.0,
            x: 0.0,
            at,
        }
    }

    fn positions(pairs: &[(&str, f64, i64)]) -> ReadingPositions {
        ReadingPositions {
            version: READING_POSITION_VERSION,
            entries: pairs
                .iter()
                .map(|(key, pos, at)| (key.to_string(), entry(*pos, *at)))
                .collect(),
        }
    }

    #[test]
    fn round_trip_keeps_values_and_leaves_no_partial_file() {
        let dir = TempDir::new();
        let written = positions(&[("docs/a.md", 1234.0, 1_700_000_000_000)]);
        save_to(dir.path(), "vault-1", &written).expect("write positions");
        assert_eq!(load_from(dir.path(), "vault-1"), Some(written));
        // 原子替换：临时文件不得留在盘上（否则下次读到的可能是半个 JSON）
        assert!(!dir.path().join("vault-1.json.tmp").exists());
        // 目录里只有这一份文件（不在 vault 目录里造文件的前提是这里也不留垃圾）
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["vault-1.json".to_string()]);
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
        fs::write(dir.path().join("nover.json"), r#"{"entries":{}}"#).unwrap();
        assert_eq!(load_from(dir.path(), "nover"), None);

        // 版本不匹配（更高版本应用写入）：不尝试解释
        fs::write(
            dir.path().join("future.json"),
            r#"{"version":99,"entries":{}}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "future"), None);

        // 字段类型非法（pos 是字符串）
        fs::write(
            dir.path().join("wrongtype.json"),
            r#"{"version":1,"entries":{"a.md":{"pos":"0","y":0,"x":0,"at":1}}}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "wrongtype"), None);
    }

    #[test]
    fn out_of_bounds_keys_and_non_finite_values_are_dropped() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("v.json"),
            r#"{"version":1,"entries":{
                "ok.md":{"pos":10,"y":1,"x":0,"at":1},
                "sub/ok.md":{"pos":20,"y":1,"x":0,"at":2},
                "/etc/passwd":{"pos":30,"y":1,"x":0,"at":3},
                "../outside.md":{"pos":40,"y":1,"x":0,"at":4},
                "docs/../../up.md":{"pos":50,"y":1,"x":0,"at":5},
                "":{"pos":60,"y":1,"x":0,"at":6},
                "negative.md":{"pos":-1,"y":1,"x":0,"at":7}
            }}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "v").expect("合法条目应照常返回");
        let mut keys: Vec<&String> = loaded.entries.keys().collect();
        keys.sort();
        assert_eq!(keys, vec!["ok.md", "sub/ok.md"]);
    }

    #[test]
    fn entries_beyond_the_cap_evict_the_oldest_by_timestamp() {
        let dir = TempDir::new();
        // 201 条：at 递增，最旧的是 f000.md
        let pairs: Vec<(String, f64, i64)> = (0..MAX_ENTRIES + 1)
            .map(|i| (format!("f{i:03}.md"), i as f64, i as i64))
            .collect();
        let mut entries = HashMap::new();
        for (key, pos, at) in &pairs {
            entries.insert(key.clone(), entry(*pos, *at));
        }
        let written = sanitize(ReadingPositions {
            version: READING_POSITION_VERSION,
            entries,
        });
        assert_eq!(written.entries.len(), MAX_ENTRIES);
        assert!(!written.entries.contains_key("f000.md"), "最旧的一条被淘汰");
        assert!(written.entries.contains_key("f200.md"), "最新的一条留下");

        // 落盘后再读回来仍是上限内的那些（读侧同样收口）
        save_to(dir.path(), "vault-1", &written).expect("write positions");
        let loaded = load_from(dir.path(), "vault-1").expect("读回");
        assert_eq!(loaded.entries.len(), MAX_ENTRIES);
        assert!(!loaded.entries.contains_key("f000.md"));
    }

    #[test]
    fn write_failure_is_reported_and_leaves_other_vaults_intact() {
        let dir = TempDir::new();
        let first = positions(&[("a.md", 5.0, 1)]);
        save_to(dir.path(), "a", &first).expect("write a");

        // 目标目录的父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.path().join("blocker");
        fs::write(&blocker, "x").unwrap();
        assert!(save_to(&blocker.join("positions"), "b", &positions(&[])).is_err());

        // 失败不 panic（上面那行不炸即证），也不影响其它 vault 的位置（独立文件、单一写者）
        assert_eq!(load_from(dir.path(), "a"), Some(first));
        assert_eq!(load_from(dir.path(), "b"), None);
    }
}
