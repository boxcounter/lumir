use lumir_lib::{commands, config, fs_io, link_graph::LinkGraph, workspaces::*};
use std::{fs, path::PathBuf, sync::Mutex};

static ENV: Mutex<()> = Mutex::new(());

struct Fixture {
    root: PathBuf,
    previous: Option<std::ffi::OsString>,
    _guard: std::sync::MutexGuard<'static, ()>,
}
impl Fixture {
    fn new() -> Self {
        let guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/workspace-scenarios")
            .join(format!("{}", std::process::id()));
        if root.exists() {
            fs::remove_dir_all(&root).unwrap();
        }
        fs::create_dir_all(&root).unwrap();
        let previous = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", &root);
        Self {
            root,
            previous,
            _guard: guard,
        }
    }
    fn vault(&self, name: &str) -> String {
        let p = self.root.join(name);
        fs::create_dir_all(&p).unwrap();
        p.canonicalize().unwrap().display().to_string()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        match &self.previous {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn scenario_reconcile_reuses_persisted_vault_identity() {
    let f = Fixture::new();
    let path = f.vault("vault");
    vault_register("persisted-id".into(), path.clone()).unwrap();
    reconcile_vault(std::path::Path::new(&path)).unwrap();
    reconcile_vault(std::path::Path::new(&path)).unwrap();
    let dir = config::config_dir().unwrap().join("workspaces");
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    let v: VaultWorkspace =
        serde_json::from_str(&fs::read_to_string(dir.join("persisted-id.json")).unwrap()).unwrap();
    assert_eq!(v.id, "persisted-id");
    assert_eq!(v.path, path);
}

#[test]
fn scenario_remap_preserves_identity_and_updates_last_vault() {
    let f = Fixture::new();
    let old = f.vault("old");
    vault_register("stable".into(), old.clone()).unwrap();
    let new = f.root.join("new");
    fs::rename(&old, &new).unwrap();
    let new = new.canonicalize().unwrap().display().to_string();
    fs::write(config::config_dir().unwrap().join("config.json"), "42").unwrap();
    vault_remap("stable".into(), new.clone()).unwrap();
    let v: VaultWorkspace = serde_json::from_str(
        &fs::read_to_string(config::config_dir().unwrap().join("workspaces/stable.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(v.id, "stable");
    assert_eq!(v.path, new);
    assert_eq!(config::load().unwrap().config.last_vault, Some(new));
}

#[test]
fn scenario_remap_candidate_short_circuits_stale_vault_detection() {
    let f = Fixture::new();
    let old = f.vault("moved");
    vault_register("stable".into(), old.clone()).unwrap();
    fs::remove_dir_all(&old).unwrap();
    let unknown = f.vault("new");
    let candidates = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, "stable");
    let fresh = vault_register("fresh".into(), unknown).unwrap();
    assert_eq!(fresh.id, "fresh");
}

#[test]
fn scenario_registered_vault_not_blocked_by_ghost_registry_entries() {
    let f = Fixture::new();
    let registered = f.vault("registered");
    vault_register("registered-id".into(), registered.clone()).unwrap();
    // 幽灵项：注册路径已消失的其他 vault（冒烟实证 vault-60196-1 / vault-64466-1 形态）。
    let ghost = f.vault("ghost");
    vault_register("ghost-1".into(), ghost.clone()).unwrap();
    fs::remove_dir_all(&ghost).unwrap();
    // 打开已注册路径：remap 门不拦截，直接打开。
    assert!(remap_gate(std::path::Path::new(&registered))
        .unwrap()
        .is_none());
    assert!(is_registered(std::path::Path::new(&registered)).unwrap());
}

#[test]
fn scenario_unregistered_path_hits_remap_gate_only_with_ghost_entries() {
    let f = Fixture::new();
    // 注册表干净（无失效项）时，未注册路径直接打开，无候选。
    let unknown = f.vault("unknown");
    assert!(remap_gate(std::path::Path::new(&unknown))
        .unwrap()
        .is_none());
    // 出现幽灵项后，同一未注册路径才被 remap 门拦下并给出候选。
    let ghost = f.vault("ghost");
    vault_register("ghost-1".into(), ghost.clone()).unwrap();
    fs::remove_dir_all(&ghost).unwrap();
    let gate = remap_gate(std::path::Path::new(&unknown)).unwrap();
    let candidates = gate.expect("未注册路径应出现 remap 候选");
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, "ghost-1");
}

fn registry_dir() -> PathBuf {
    config::config_dir().unwrap().join("workspaces")
}

fn read_entry(id: &str) -> VaultWorkspace {
    serde_json::from_str(&fs::read_to_string(registry_dir().join(format!("{id}.json"))).unwrap())
        .unwrap()
}

fn read_entry_raw(id: &str) -> String {
    fs::read_to_string(registry_dir().join(format!("{id}.json"))).unwrap()
}

/// 把注册项的 `missing_since` 回拨 `ago_ms`，模拟「失效已持续一段时间」。
/// 治理按墙钟判断宽限期，测试无法等待 24h，故直接构造超龄的注册项。
fn stamp_missing_since(id: &str, ago_ms: i64) {
    let path = registry_dir().join(format!("{id}.json"));
    let mut v = read_entry(id);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    v.missing_since = Some(now - ago_ms);
    v.archived_at = None;
    fs::write(&path, serde_json::to_vec_pretty(&v).unwrap()).unwrap();
}

#[test]
fn scenario_stale_registry_entry_stays_candidate_within_grace() {
    let f = Fixture::new();
    let moved = f.vault("moved");
    vault_register("stable".into(), moved.clone()).unwrap();
    fs::remove_dir_all(&moved).unwrap();
    let unknown = f.vault("new");
    // 首次观测即记账，但未超宽限期：仍是候选——覆盖「移动 vault 后重新打开」
    // 的交互窗口，remap 恢复入口不被过早掐断。
    let candidates = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, "stable");
    let entry = read_entry("stable");
    assert!(entry.missing_since.is_some(), "首次观测应记账");
    assert!(entry.archived_at.is_none(), "宽限期内不得归档");
}

#[test]
fn scenario_legacy_registry_entry_without_governance_fields_still_reads() {
    let f = Fixture::new();
    let ghost = f.vault("ghost");
    vault_register("ghost-1".into(), ghost.clone()).unwrap();
    fs::remove_dir_all(&ghost).unwrap();
    // 存量注册项只有 id / path（磁盘上幽灵项的既有形态）：缺治理字段仍须可解析
    let legacy = format!(
        "{{\"id\":\"ghost-1\",\"path\":{}}}",
        serde_json::to_string(&ghost).unwrap()
    );
    fs::write(registry_dir().join("ghost-1.json"), legacy).unwrap();
    let entry = read_entry("ghost-1");
    assert!(entry.missing_since.is_none() && entry.archived_at.is_none());
    // 首次观测即记账，且宽限期内仍是候选（向后兼容 + 治理同时成立）
    let unknown = f.vault("unknown");
    let candidates = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert_eq!(candidates.len(), 1);
    assert!(read_entry("ghost-1").missing_since.is_some());
}

#[test]
fn scenario_registry_ghost_archived_after_grace_stops_polluting_candidates() {
    let f = Fixture::new();
    let ghost = f.vault("ghost");
    vault_register("ghost-1".into(), ghost.clone()).unwrap();
    fs::remove_dir_all(&ghost).unwrap();
    // 失效已持续超过宽限期
    stamp_missing_since("ghost-1", 25 * 60 * 60 * 1000);
    let unknown = f.vault("unknown");
    // 枚举路径惰性治理：本轮即归档，归档项不再是候选，remap 门也不再拦路
    let candidates = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert!(candidates.is_empty(), "归档项不得作为候选：{candidates:?}");
    assert!(remap_gate(std::path::Path::new(&unknown))
        .unwrap()
        .is_none());
    let archived = read_entry("ghost-1");
    assert!(archived.archived_at.is_some(), "超龄幽灵项应被归档");
    assert!(
        archived.missing_since.is_some(),
        "归档是标记：原始失效时间保留，注册项文件不删"
    );
    // 幂等：重复治理不再改写（标记值收敛）
    let before = read_entry_raw("ghost-1");
    let _ = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert_eq!(read_entry_raw("ghost-1"), before, "重复治理必须收敛");
}

#[test]
fn scenario_registry_sweep_leaves_valid_entries_untouched() {
    let f = Fixture::new();
    let live = f.vault("live");
    vault_register("live-id".into(), live.clone()).unwrap();
    let before = read_entry_raw("live-id");
    let unknown = f.vault("unknown");
    // 有效注册项不参与治理：不落 missing_since / archived_at，文件逐字节不变
    assert!(remap_candidates(std::path::Path::new(&unknown))
        .unwrap()
        .is_empty());
    assert_eq!(read_entry_raw("live-id"), before);
    assert!(read_entry("live-id").missing_since.is_none());
}

#[test]
fn scenario_archived_registry_entry_recovers_when_path_returns() {
    let f = Fixture::new();
    let path = f.vault("external");
    vault_register("ext-id".into(), path.clone()).unwrap();
    fs::remove_dir_all(&path).unwrap();
    stamp_missing_since("ext-id", 25 * 60 * 60 * 1000);
    let unknown = f.vault("unknown");
    let _ = remap_candidates(std::path::Path::new(&unknown)).unwrap();
    assert!(read_entry("ext-id").archived_at.is_some(), "先归档");
    // 外置卷重新挂载：路径恢复后既有身份复位，不新注册 id
    fs::create_dir_all(&path).unwrap();
    let v = reconcile_vault(std::path::Path::new(&path)).unwrap();
    assert_eq!(v.id, "ext-id");
    assert!(v.archived_at.is_none());
    let entry = read_entry("ext-id");
    assert!(
        entry.missing_since.is_none() && entry.archived_at.is_none(),
        "路径恢复应清除治理标记：{entry:?}"
    );
}

#[test]
fn scenario_valid_id_rejects_path_escape_for_vault_commands() {
    let f = Fixture::new();
    assert!(vault_register("../config".into(), f.vault("v")).is_err());
    assert!(vault_remap("../config".into(), f.vault("v2")).is_err());
}

// ---------------------------------------------------------------------------
// M159（change startup-restore-off-main-thread）：启动恢复与用户打开的让位规则。
//
// 无线程构造：恢复线程的两阶段 API（`begin_restore` → 备好打开 → `finish_restore`）都是
// 普通函数，测试里按同样的顺序直接调，不真起线程、不依赖 AppHandle（`fs_io::watch` 只
// 需要目录与回调）。世代号是唯一的并发判据，因此这条路能覆盖 spec 的让位场景。
// ---------------------------------------------------------------------------

/// 备好一个可提交的打开结果（生产路径由 `commands::prepare_vault_open` 产出，它需要
/// AppHandle；测试只关心状态机，因此直接装配：entries/graph 取空，watcher 对真实目录建流）。
fn prepared_open(root: &str) -> commands::PreparedVaultOpen {
    let path = PathBuf::from(root);
    commands::PreparedVaultOpen {
        root: path.clone(),
        vault_id: "test-vault".into(),
        entries: vec![],
        watcher: fs_io::watch(&path, |_| {}).expect("watch temp vault"),
        graph: LinkGraph::new(),
    }
}

/// 用户抢先成功打开 vault 后到达的过期恢复结果被整体丢弃：当前 vault 仍是用户那个，
/// 失败提示也不落地（spec「恢复结果不覆盖用户已打开的 vault」）。
#[test]
fn scenario_stale_restore_result_discarded_after_user_opened_vault() {
    let f = Fixture::new();
    let restored = f.vault("restore-a");
    let user = f.vault("user-b");
    let state = commands::VaultState::default();

    let generation = state.begin_restore(); // 恢复开始：进行态 + 记下当时的世代
    assert!(state.status().unwrap().restore_pending);

    // 用户抢先成功打开 B（与 vault_open command 同一条路：无条件提交）
    assert!(commands::commit_vault_open(
        &state,
        prepared_open(&user),
        None
    ));

    // 恢复线程随后提交（成功结果）与其失败提示：世代不符 → 整包丢弃
    assert!(!state.finish_restore(
        generation,
        commands::RestoreOutcome::Opened(Box::new(prepared_open(&restored)))
    ));
    let status = state.status().unwrap();
    assert_eq!(
        status.vault.as_ref().map(|v| v.root.as_str()),
        Some(user.as_str())
    );
    assert_eq!(status.notice, None, "过期恢复的提示也必须被丢弃");
    assert!(!status.restore_pending, "结束路径必须清掉进行态");
}

/// 用户在恢复期间打开失败（没有提交）不产生世代跃迁，因此恢复结果照常生效——与前端
/// 「只有成功装载才让位」对称（design §4.2 的真值表第 3、4、5 行）。
#[test]
fn scenario_restore_applies_when_user_open_did_not_commit() {
    let f = Fixture::new();
    let restored = f.vault("restore-c");
    let state = commands::VaultState::default();

    let generation = state.begin_restore();
    // picker 取消 / 打开异常 / remap 候选短路：任何一条都没有提交，世代不变
    assert!(state.finish_restore(
        generation,
        commands::RestoreOutcome::Opened(Box::new(prepared_open(&restored)))
    ));

    let status = state.status().unwrap();
    assert_eq!(
        status.vault.as_ref().map(|v| v.root.as_str()),
        Some(restored.as_str())
    );
    assert!(!status.restore_pending);
}
