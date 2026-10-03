//! 按 vault 的 pane 布局会话持久化（change multi-vault-workspaces，design §2/§3；change
//! pane-system-split-view，design §7 扩成 pane 布局）。
//!
//! **为什么与注册项分开存放**（design §2）：注册项文件是身份（id ↔ path，remap 的锚点），
//! 它的读取路径对解析失败一律跳过（`vault_registry.rs` 的三处读取）——把易变的界面状态混进
//! 身份文件，一次会话写坏就会升级成「vault 从列表与 remap 候选中消失」。会话单独落在
//! `vault-sessions/<id>.json` 后，损坏的最大后果只是「没有布局历史」。
//!
//! **写入纪律**：tmp + rename 原子替换（与注册项同）；解析失败 / `version` 不匹配 /
//! 字段类型非法一律按「无历史」处理并记 warning（ADR 0002 §5 的逐字段纪律），不抛错、
//! 不阻断打开。**读取纪律**：越界条目（绝对路径 / `..` / 带根前缀）静默丢弃——会话文件
//! 在配置目录里、是可被手工修改的面，不该成为打开 vault 之外文件的入口（ADR 0003）。
//!
//! **schema v2 与 v1 的兼容**（pane-system-split-view tasks 5.1）：v2 落 `panes` 数组 +
//! `harness_pane` + `pane_split_ratio`；v1 是上一版（顶层 `tabs` / `active`、无 `panes`），
//! **读取侧**按「单 pane = 顶层 tabs/active」解释——字段向后兼容在读取侧做，不写双份真源。
//! 其余版本按「无历史」。写侧恒落 v2（盘上不出现顶层 `tabs`/`active` 的旧形状）。
//!
//! **生命周期**：注册项只归档不删除，会话文件不参与注册表治理（`sweep_registry` 不碰它），
//! 也不做删除；孤儿文件只可能来自手工操作，属无害残留。

use crate::{commands::CommandError, config, vault_registry};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use ts_rs::TS;

/// 会话 schema 版本（写侧恒落这一版）。
pub const SESSION_VERSION: u32 = 2;

/// 上一版 schema（无 `panes` 字段）：本期仍读，按单 pane 解释（tasks 5.1 的向后兼容）。
pub const LEGACY_SESSION_VERSION: u32 = 1;

/// pane 数上限：越界的 `panes` 由 [`sanitize`] 截断。
/// 与 `src/pane-layout.ts` 的 `MAX_PANES` 同值——`session-schema-drift.test.ts` 对账两处。
pub const MAX_PANES: usize = 2;

/// 分隔条比例的合法区间：任一 pane 至少留两成宽。
/// 与 `src/pane-layout.ts` 的 `SPLIT_RATIO_MIN` / `SPLIT_RATIO_MAX` 同值（对账同上）——
/// 落盘值与施加值同区间，避免「盘上存 0.05、显示却是 0.2」的双真源。
pub const SPLIT_RATIO_MIN: f64 = 0.2;
pub const SPLIT_RATIO_MAX: f64 = 0.8;

/// 缺 `pane_split_ratio` 时的默认（对半分，与前端初值同）。
pub const DEFAULT_SPLIT_RATIO: f64 = 0.5;

/// 一个 pane 的会话：有序的相对路径 + 激活项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct PaneSession {
    /// 有序的 vault 相对路径（固定标签；预览标签不入盘）。
    pub tabs: Vec<String>,
    /// 激活项（vault 相对路径）；非法值落为 null（前端按「退化到第一个可打开的标签」处理）。
    pub active: Option<String>,
}

/// 一个 vault 的 pane 布局会话（唯一类型定义点，TS 类型由 ts-rs 导出）。
///
/// **`harness_pane` 是 ADR 0008 Decision 6 登记的 Phase 2 契约位**：Phase 1 恒 `false`，
/// 只随 schema 落盘、**无消费者**（读取侧也不解释它，见 `SessionFile`）。Phase 2 harness
/// 归位 pane 后，消费点在装配层的布局恢复一带（`src/main.ts` 的 `applyPaneCount`）——
/// 届时它决定 harness pane 的落位。此处与 design §10 的标注同源，防「声明了却没有消费者」
/// 误判；不给它造一个假的 Phase 1 消费者。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultSession {
    pub version: u32,
    /// 各 pane 的会话，按横向顺序。空数组由 [`sanitize`] 补成「单空 pane」，读取侧因此恒有
    /// 至少一个 pane（前端据此区分「单 pane」与「分栏」）。
    pub panes: Vec<PaneSession>,
    pub harness_pane: bool,
    /// 分隔条位置（`SPLIT_RATIO_MIN..=SPLIT_RATIO_MAX`；越界 / 非有限值由 [`sanitize`] 钳制）。
    pub pane_split_ratio: f64,
    /// 落盘时间（Unix 毫秒）：写入侧填，读取侧不参与判断。
    #[ts(type = "number")]
    pub updated_at: i64,
}

/// 会话目录：与注册表同级（design §2）。
pub fn sessions_dir() -> Result<PathBuf, CommandError> {
    Ok(config::config_dir()?.join("vault-sessions"))
}

/// 盘上文件的形状：读取侧**唯一**的反序列化目标，同时容纳 v1 与 v2（按 `version` 分流，
/// 见 [`SessionFile::into_session`]）。`harness_pane` 不在此列——Phase 1 无消费者，读也白读
/// （serde 默认忽略未知字段，v2 文件里的它不会让解析失败）。
#[derive(Deserialize)]
struct SessionFile {
    version: u32,
    /// v1 的顶层标签列表（v2 文件没有它）。
    #[serde(default)]
    tabs: Vec<String>,
    /// v1 的顶层激活项。
    #[serde(default)]
    active: Option<String>,
    /// v2 的各 pane 会话（v1 文件没有它）。
    #[serde(default)]
    panes: Option<Vec<PaneSession>>,
    #[serde(default)]
    pane_split_ratio: Option<f64>,
    #[serde(default)]
    updated_at: i64,
}

impl SessionFile {
    /// 按 `version` 解释成当前形态；不支持的版本返回 `None`（调用方按无历史处理）。
    fn into_session(self, path: &Path) -> Option<VaultSession> {
        match self.version {
            SESSION_VERSION => {
                let Some(panes) = self.panes else {
                    // v2 必须带 panes：缺了就是残缺文件，不当 v1 兜底（版本是唯一分流键）。
                    eprintln!(
                        "lumir: vault 会话 v{SESSION_VERSION} 缺 panes 字段（按无历史处理）：{}",
                        path.display()
                    );
                    return None;
                };
                Some(VaultSession {
                    version: SESSION_VERSION,
                    panes,
                    harness_pane: false,
                    pane_split_ratio: self.pane_split_ratio.unwrap_or(DEFAULT_SPLIT_RATIO),
                    updated_at: self.updated_at,
                })
            }
            LEGACY_SESSION_VERSION => Some(VaultSession {
                version: SESSION_VERSION,
                // v1 只有一份顶层标签列表 ⇒ 恰好一个 pane（「单 pane = 顶层 tabs/active」）。
                panes: vec![PaneSession {
                    tabs: self.tabs,
                    active: self.active,
                }],
                harness_pane: false,
                pane_split_ratio: DEFAULT_SPLIT_RATIO,
                updated_at: self.updated_at,
            }),
            other => {
                eprintln!(
                    "lumir: vault 会话版本 v{other} 不是本版支持的 v{SESSION_VERSION}（按无历史处理）：{}",
                    path.display()
                );
                None
            }
        }
    }
}

/// 读某 vault 的会话（目录可注入：测试不碰真实配置目录）。
///
/// 返回 `None` = 无历史：文件缺失 / 不可读 / 不是合法 JSON / 字段类型非法 / `version`
/// 不被支持——这些情况对调用方的语义完全相同（会话损坏等价于无历史），只在部分情形记
/// warning（缺失是首次打开某 vault 的常态，不报警）。
pub fn load_from(dir: &Path, id: &str) -> Option<VaultSession> {
    let path = dir.join(format!("{id}.json"));
    let Ok(text) = fs::read_to_string(&path) else {
        return None;
    };
    match serde_json::from_str::<SessionFile>(&text) {
        Ok(file) => file.into_session(&path).map(sanitize),
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
/// 落为 `None`；pane 数截到 [`MAX_PANES`]、空 panes 补一个空 pane、比例钳进
/// `SPLIT_RATIO_MIN..=SPLIT_RATIO_MAX`。**写入与读取共用**：写入侧让盘上不出现绝对路径与
/// 越界比例（spec：MUST NOT 存绝对路径），读取侧给手工改过的文件兜底（spec：越界条目被
/// 丢弃、MUST NOT 被打开）。绝对路径 / 含 `..` / 带根或盘符前缀的形态在这里拦掉——前两道与
/// [`crate::fs_io::resolve_in_vault`] 同源；符号链接逃逸要 vault 根才能判定，权威判定仍在
/// 打开时的 `resolve_in_vault`（这里只拦「文本上就出界」的形态）。
fn sanitize(mut session: VaultSession) -> VaultSession {
    for pane in &mut session.panes {
        pane.tabs.retain(|tab| valid_entry(tab));
        if pane
            .active
            .as_deref()
            .is_some_and(|active| !valid_entry(active))
        {
            pane.active = None;
        }
    }
    session.panes.truncate(MAX_PANES);
    if session.panes.is_empty() {
        // 读取侧对「至少一个 pane」的兜底：空 panes 等价于单 pane 空态，前端无需再判空。
        session.panes.push(PaneSession {
            tabs: Vec::new(),
            active: None,
        });
    }
    session.pane_split_ratio = clamp_ratio(session.pane_split_ratio);
    session
}

/// 比例钳制：NaN（手改文件 / 非法值可造）落默认；±inf 与越界值一样夹进合法区间
///（`f64::clamp` 本身就把 +inf 收到上限、-inf 收到下限，只有 NaN 需要单独处理）。
fn clamp_ratio(value: f64) -> f64 {
    if value.is_nan() {
        return DEFAULT_SPLIT_RATIO;
    }
    value.clamp(SPLIT_RATIO_MIN, SPLIT_RATIO_MAX)
}

/// `pub(crate)`：阅读位置（`reading_position.rs`）的键与标签列表同口径，复用这一份判定而不是
/// 另抄一份（REVIEW.md 第 8 条：同一语义不造两处真源）。
pub(crate) fn valid_entry(entry: &str) -> bool {
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

/// 落盘（目录可注入）：tmp + rename 原子替换，与注册项落盘（`vault_registry::write_entry`）
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

/// 读某 vault 的 pane 布局会话；无历史返回 null（不是错误——首次打开 / 损坏 / 版本不支持
/// 都走这条路，v1 旧文件按单 pane 解释后照常返回）。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_session_get(vault_id: String) -> Result<Option<VaultSession>, CommandError> {
    vault_registry::valid_id(&vault_id)?;
    Ok(load_from(&sessions_dir()?, &vault_id))
}

/// 写某 vault 的 pane 布局会话（前端在 pane / 标签 / 激活项 / 分隔条变化后防抖写，切换前与
/// 退出前 flush）。
///
/// 写失败返回 `Ok(())` 并记 warning——与 `last_vault` 写失败同口径（M127），MUST NOT 拦停
/// 切换与打开：会话只影响「下次打开这个 vault 时恢复什么」，不值得让用户的一次切换失败。
/// 只有 `vault_id` 非法才返回错误信封：id 是文件名，这是路径逃逸防护（`vault_registry::valid_id`），
/// 不是写失败。
#[tauri::command(rename_all = "snake_case")]
pub fn vault_session_put(
    vault_id: String,
    panes: Vec<PaneSession>,
    pane_split_ratio: f64,
) -> Result<(), CommandError> {
    vault_registry::valid_id(&vault_id)?;
    let dir = sessions_dir()?;
    // 入口同一校验（见 [`sanitize`]）：盘上不出现绝对路径、越界比例与超量 pane。
    let session = sanitize(VaultSession {
        version: SESSION_VERSION,
        panes,
        harness_pane: false, // Phase 1 恒 false（见 VaultSession 的注释）
        pane_split_ratio,
        updated_at: vault_registry::now_ms(),
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

    fn pane(tabs: &[&str], active: Option<&str>) -> PaneSession {
        PaneSession {
            tabs: tabs.iter().map(|t| t.to_string()).collect(),
            active: active.map(|a| a.to_string()),
        }
    }

    fn session(panes: Vec<PaneSession>, ratio: f64) -> VaultSession {
        VaultSession {
            version: SESSION_VERSION,
            panes,
            harness_pane: false,
            pane_split_ratio: ratio,
            updated_at: 1_700_000_000_000,
        }
    }

    fn single(tabs: &[&str], active: Option<&str>) -> VaultSession {
        session(vec![pane(tabs, active)], DEFAULT_SPLIT_RATIO)
    }

    #[test]
    fn round_trip_keeps_panes_ratio_and_leaves_no_partial_file() {
        let dir = TempDir::new();
        let written = session(
            vec![
                pane(&["docs/a.md", "README.md"], Some("docs/a.md")),
                pane(&["b.md"], Some("b.md")),
            ],
            0.35,
        );
        save_to(dir.path(), "vault-1", &written).expect("write session");
        assert_eq!(load_from(dir.path(), "vault-1"), Some(written));
        // 原子替换：临时文件不得留在盘上（否则下次读到的可能是半个 JSON）
        assert!(!dir.path().join("vault-1.json.tmp").exists());
    }

    #[test]
    fn written_file_uses_v2_shape_without_legacy_top_level_fields() {
        let dir = TempDir::new();
        save_to(
            dir.path(),
            "v",
            &session(vec![pane(&["a.md"], Some("a.md"))], 0.5),
        )
        .expect("write");
        let text = fs::read_to_string(dir.path().join("v.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["version"], 2);
        assert_eq!(json["panes"][0]["tabs"][0], "a.md");
        assert_eq!(json["pane_split_ratio"], 0.5);
        assert_eq!(json["harness_pane"], false);
        // 不写双份真源：顶层没有旧形状的 tabs / active
        assert!(json.get("tabs").is_none(), "v2 不写顶层 tabs");
        assert!(json.get("active").is_none(), "v2 不写顶层 active");
        // 格式契约（验收场景 17 的 file 断言用正则匹配盘上文本、依赖标签数组**逐行**打印）：
        // 换成紧凑格式会让那条断言静默失配，故在这里钉住换行结构。
        assert!(
            text.contains("\"tabs\": [\n"),
            "标签数组必须逐行打印（场景 17 的 file 正则依赖换行结构）：{text}"
        );
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

        // 版本不被支持（更高版本应用写入）：不尝试解释
        fs::write(
            dir.path().join("future.json"),
            r#"{"version":99,"panes":[{"tabs":["a.md"],"active":null}],"pane_split_ratio":0.5,"updated_at":0}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "future"), None);

        // 字段类型非法（panes 不是数组）
        fs::write(
            dir.path().join("wrongtype.json"),
            r#"{"version":2,"panes":"a.md","pane_split_ratio":0.5,"updated_at":0}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "wrongtype"), None);

        // v2 缺 panes：残缺文件按无历史，不回落成 v1 解释
        fs::write(
            dir.path().join("nopanes.json"),
            r#"{"version":2,"pane_split_ratio":0.5,"updated_at":0,"tabs":["a.md"],"active":"a.md"}"#,
        )
        .unwrap();
        assert_eq!(load_from(dir.path(), "nopanes"), None);
    }

    #[test]
    fn legacy_v1_file_is_read_as_a_single_pane() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("v1.json"),
            r#"{"version":1,"tabs":["a.md","docs/b.md"],"active":"docs/b.md","updated_at":7}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "v1").expect("v1 旧文件应照常读出来");
        assert_eq!(loaded.version, SESSION_VERSION, "读侧统一升到当前 schema");
        assert_eq!(
            loaded.panes,
            vec![pane(&["a.md", "docs/b.md"], Some("docs/b.md"))]
        );
        assert_eq!(
            loaded.pane_split_ratio, DEFAULT_SPLIT_RATIO,
            "v1 无比例，落默认"
        );
        assert_eq!(loaded.updated_at, 7, "updated_at 原样带过");
        assert!(!loaded.harness_pane);
    }

    #[test]
    fn out_of_bounds_entries_are_dropped_per_pane_and_valid_ones_survive() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("v.json"),
            r#"{"version":2,"panes":[{"tabs":["ok.md","/etc/passwd","../outside.md","docs/../../up.md","sub/ok.md",""],"active":"../outside.md"},{"tabs":["/abs.md","keep.md"],"active":"/abs.md"}],"pane_split_ratio":0.5,"updated_at":1}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "v").expect("合法条目应照常返回");
        assert_eq!(
            loaded.panes,
            vec![
                pane(&["ok.md", "sub/ok.md"], None),
                pane(&["keep.md"], None),
            ],
            "逐 pane 丢弃越界条目；非法激活项落 null"
        );
    }

    #[test]
    fn ratio_out_of_range_and_non_finite_are_clamped() {
        let dir = TempDir::new();
        let cases = [
            ("-0.5", SPLIT_RATIO_MIN),
            ("1.5", SPLIT_RATIO_MAX),
            ("0.4", 0.4),
            ("0.0", 0.2),
            ("1.0", 0.8),
        ];
        for (raw, expected) in cases {
            fs::write(
                dir.path().join("r.json"),
                format!(r#"{{"version":2,"panes":[{{"tabs":[],"active":null}}],"pane_split_ratio":{raw},"updated_at":0}}"#),
            )
            .unwrap();
            let loaded = load_from(dir.path(), "r").expect("会话可读");
            assert_eq!(
                loaded.pane_split_ratio, expected,
                "比例 {raw} 应收敛到 {expected}"
            );
        }
        // NaN 走 JSON 造不出来（serde_json 不接受裸 NaN），但手改经其他工具可写；用非有限值的
        // 直接构造覆盖 clamp_ratio 的分支。
        assert_eq!(clamp_ratio(f64::NAN), DEFAULT_SPLIT_RATIO);
        assert_eq!(clamp_ratio(f64::INFINITY), SPLIT_RATIO_MAX);
        assert_eq!(clamp_ratio(f64::NEG_INFINITY), SPLIT_RATIO_MIN);
    }

    #[test]
    fn ratio_missing_falls_back_to_default() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("noratio.json"),
            r#"{"version":2,"panes":[{"tabs":["a.md"],"active":null}],"updated_at":0}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "noratio").expect("会话可读");
        assert_eq!(loaded.pane_split_ratio, DEFAULT_SPLIT_RATIO);
    }

    #[test]
    fn panes_beyond_the_cap_are_truncated_and_empty_panes_become_one_empty_pane() {
        let dir = TempDir::new();
        fs::write(
            dir.path().join("many.json"),
            r#"{"version":2,"panes":[{"tabs":["a.md"],"active":"a.md"},{"tabs":["b.md"],"active":null},{"tabs":["c.md"],"active":null}],"pane_split_ratio":0.5,"updated_at":0}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "many").expect("会话可读");
        assert_eq!(loaded.panes.len(), MAX_PANES, "超出上限的 pane 被截断");
        assert_eq!(loaded.panes[1], pane(&["b.md"], None));

        fs::write(
            dir.path().join("empty.json"),
            r#"{"version":2,"panes":[],"pane_split_ratio":0.5,"updated_at":0}"#,
        )
        .unwrap();
        let loaded = load_from(dir.path(), "empty").expect("会话可读");
        assert_eq!(
            loaded.panes,
            vec![pane(&[], None)],
            "空 panes 补成单空 pane"
        );
    }

    #[test]
    fn write_failure_is_reported_and_leaves_other_sessions_intact() {
        let dir = TempDir::new();
        let first = single(&["a.md"], Some("a.md"));
        save_to(dir.path(), "a", &first).expect("write a");

        // 目标目录的父路径是一个普通文件 → create_dir_all 必失败
        let blocker = dir.path().join("blocker");
        fs::write(&blocker, "x").unwrap();
        assert!(save_to(&blocker.join("sessions"), "b", &single(&["b.md"], None)).is_err());

        // 失败不 panic（上面那行不炸即证），也不影响其它 vault 的会话（独立文件、单一写者）
        assert_eq!(load_from(dir.path(), "a"), Some(first));
        assert_eq!(load_from(dir.path(), "b"), None);
    }
}
