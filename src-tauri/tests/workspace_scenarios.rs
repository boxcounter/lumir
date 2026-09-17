use lumir_lib::{commands, config, fs_io, link_graph::LinkGraph, vault_session, workspaces::*};
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

// ---------------------------------------------------------------------------
// M162（change multi-vault-workspaces）：打开记账、注册表列表与按 vault 的会话存储。
//
// 覆盖 change tasks 1.1 / 1.2 / 1.5 / 2.3 / 2.4 的判定面。记账与列表都用生产路径上的
// 函数（`commands::remember_open` / `workspaces::list_vaults` / `vault_session::*`），
// 不是测试专用替身；打开链路里需要 `AppHandle` 的那一段（command 注册、async 派发）由
// 真机验收覆盖。
// ---------------------------------------------------------------------------

/// 设定注册项的 `last_opened_at`：排序测试需要确定的时刻（`mark_opened` 取当前时间，
/// 同一毫秒内多次调用排不出先后）。
fn stamp_last_opened(id: &str, at_ms: i64) {
    let path = registry_dir().join(format!("{id}.json"));
    let mut v = read_entry(id);
    v.last_opened_at = Some(at_ms);
    fs::write(&path, serde_json::to_vec_pretty(&v).unwrap()).unwrap();
}

fn session_dir() -> PathBuf {
    config::config_dir().unwrap().join("vault-sessions")
}

#[test]
fn scenario_vault_list_reports_name_availability_and_tab_count() {
    let f = Fixture::new();
    let live = f.vault("notes-2026");
    vault_register("live".into(), live).unwrap();
    let gone = f.vault("notes-gone");
    vault_register("gone".into(), gone.clone()).unwrap();
    fs::remove_dir_all(&gone).unwrap();
    // 会话里的合法固定标签数就是列表行的标签数（越界条目在写入侧就被丢弃）
    vault_session::vault_session_put(
        "live".into(),
        vec!["a.md".into(), "b.md".into(), "../escape.md".into()],
        Some("a.md".into()),
    )
    .unwrap();

    let entries = list_vaults(&registry_dir(), &session_dir()).unwrap();
    assert_eq!(entries.len(), 2, "失效项必须保留在列表里：{entries:?}");
    let live_entry = entries
        .iter()
        .find(|e| e.id == "live")
        .expect("live 在列表里");
    assert_eq!(live_entry.name, "notes-2026", "显示名 = 路径的目录名");
    assert!(live_entry.available);
    assert_eq!(live_entry.tab_count, 2, "摘要数字与将被恢复的标签数同源");
    let gone_entry = entries
        .iter()
        .find(|e| e.id == "gone")
        .expect("gone 在列表里");
    assert_eq!(gone_entry.name, "notes-gone");
    assert!(
        !gone_entry.available,
        "路径不可用项保留并标 available: false"
    );
    assert_eq!(gone_entry.tab_count, 0, "无会话 = 无历史");
}

#[test]
fn scenario_vault_list_sorts_recent_first_and_unavailable_last() {
    let f = Fixture::new();
    let delta = f.vault("delta");
    for (id, name, opened) in [
        ("a", "alpha", 1_000),
        ("b", "beta", 3_000),
        ("c", "gamma", 2_000),
    ] {
        vault_register(id.into(), f.vault(name)).unwrap();
        stamp_last_opened(id, opened);
    }
    // 从未记账的项（升级上来的存量注册项）沉到有记录的项之后
    vault_register("e".into(), f.vault("epsilon")).unwrap();
    // 最近打开的 d 路径已失效：即使时间最新，也必须沉到可用项之后
    vault_register("d".into(), delta.clone()).unwrap();
    stamp_last_opened("d", 9_000);
    fs::remove_dir_all(&delta).unwrap();

    let order: Vec<String> = list_vaults(&registry_dir(), &session_dir())
        .unwrap()
        .into_iter()
        .map(|e| e.id)
        .collect();
    assert_eq!(
        order,
        ["b", "c", "a", "e", "d"],
        "最近打开倒序 + 不可用项沉底"
    );
}

#[test]
fn scenario_vault_list_skips_corrupt_registry_entries() {
    let f = Fixture::new();
    let ok = f.vault("ok");
    vault_register("ok-id".into(), ok).unwrap();
    // 单个注册项损坏（不是合法 JSON / 缺 path）不拖垮整表
    fs::write(registry_dir().join("broken.json"), "{not json").unwrap();
    fs::write(registry_dir().join("legacy.json"), r#"{"id":"legacy"}"#).unwrap();

    let entries = list_vaults(&registry_dir(), &session_dir()).unwrap();
    assert_eq!(entries.len(), 1, "其余项照常返回：{entries:?}");
    assert_eq!(entries[0].id, "ok-id");
}

#[test]
fn scenario_open_memory_is_written_only_for_real_opens() {
    let f = Fixture::new();
    let live = f.vault("live");
    vault_register("live".into(), live.clone()).unwrap();
    // 真打开：last_vault 与 last_opened_at 在同一次成功路径上写
    commands::remember_open(&commands::VaultInfo {
        vault_id: "live".into(),
        root: live.clone(),
        entries: vec![],
        remap_candidates: vec![],
    });
    assert!(
        read_entry("live").last_opened_at.is_some(),
        "打开成功即记账"
    );
    assert_eq!(
        config::load().unwrap().config.last_vault,
        Some(live.clone())
    );

    // remap 门短路（候选非空 = 这次没有打开任何 vault）：两个记忆都不写
    let other = f.vault("other");
    vault_register("other".into(), other.clone()).unwrap();
    commands::remember_open(&commands::VaultInfo {
        vault_id: "other".into(),
        root: other,
        entries: vec![],
        remap_candidates: vec![read_entry("live")],
    });
    assert!(
        read_entry("other").last_opened_at.is_none(),
        "被 remap 门拦下的打开不记账"
    );
    assert_eq!(
        config::load().unwrap().config.last_vault,
        Some(live),
        "上次打开的 vault 仍是那个真打开过的"
    );
}

#[test]
fn scenario_last_opened_at_survives_governance_sweep_and_remap() {
    let f = Fixture::new();
    let moved = f.vault("moved");
    vault_register("stable".into(), moved.clone()).unwrap();
    mark_opened("stable");
    let stamped = read_entry("stable").last_opened_at.expect("打开记账");

    // 治理写盘（超龄失效 → 归档）不得清掉打开历史
    fs::remove_dir_all(&moved).unwrap();
    stamp_missing_since("stable", 25 * 60 * 60 * 1000);
    let unknown = f.vault("unknown");
    assert!(remap_candidates(std::path::Path::new(&unknown))
        .unwrap()
        .is_empty());
    let archived = read_entry("stable");
    assert!(archived.archived_at.is_some(), "先确认治理写确实发生了");
    assert_eq!(archived.last_opened_at, Some(stamped), "治理不清打开历史");

    // 重映射（vault_register 的复位路径）：复位失效标记，但保留打开历史
    vault_remap("stable".into(), f.vault("restored")).unwrap();
    let remapped = read_entry("stable");
    assert!(
        remapped.missing_since.is_none() && remapped.archived_at.is_none(),
        "重映射复位治理标记"
    );
    assert_eq!(remapped.last_opened_at, Some(stamped), "重定位不清打开历史");
}

#[test]
fn scenario_session_commands_round_trip_and_reject_out_of_bounds_entries() {
    let f = Fixture::new();
    vault_register("v1".into(), f.vault("v")).unwrap();
    // 越界条目（绝对路径 / `..`）在写入侧就被丢弃（spec：MUST NOT 存绝对路径），
    // 合法条目与顺序原样保留；激活项同理落为 null
    vault_session::vault_session_put(
        "v1".into(),
        vec![
            "a.md".into(),
            "/etc/passwd".into(),
            "../escape.md".into(),
            "sub/b.md".into(),
        ],
        Some("../escape.md".into()),
    )
    .unwrap();
    let loaded = vault_session::vault_session_get("v1".into())
        .unwrap()
        .expect("有历史");
    assert_eq!(loaded.version, 1);
    assert_eq!(loaded.tabs, ["a.md", "sub/b.md"], "存的就是恢复顺序");
    assert_eq!(loaded.active, None, "非法激活项不落盘");

    // id 是文件名：越界 id 一律拒绝（路径逃逸防护），读写同口径
    assert!(vault_session::vault_session_get("../config".into()).is_err());
    assert!(vault_session::vault_session_put("../config".into(), vec![], None).is_err());
}

#[test]
fn scenario_session_put_degrades_write_failure_to_warning() {
    // Fixture 只为隔离配置目录而存在（会话目录由 config_dir 推导），本身不参与断言
    let _f = Fixture::new();
    let dir = config::config_dir().unwrap();
    fs::create_dir_all(&dir).unwrap();
    // 会话目录被一个普通文件占位 → create_dir_all 必失败
    fs::write(dir.join("vault-sessions"), "x").unwrap();
    assert!(
        vault_session::vault_session_put("v1".into(), vec!["a.md".into()], None).is_ok(),
        "写失败降级为 warning（Ok）：切换与打开不被拦停"
    );
    assert_eq!(vault_session::vault_session_get("v1".into()).unwrap(), None);
}
