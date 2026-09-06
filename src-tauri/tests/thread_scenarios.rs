use lumir_lib::{config, threads::*};
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
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/thread-scenarios").join(format!("{}", std::process::id()));
        if root.exists() { fs::remove_dir_all(&root).unwrap(); }
        fs::create_dir_all(&root).unwrap();
        let previous = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", &root);
        Self { root, previous, _guard: guard }
    }
    fn vault(&self, name: &str) -> String {
        let p = self.root.join(name);
        fs::create_dir_all(&p).unwrap();
        p.canonicalize().unwrap().display().to_string()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        match &self.previous { Some(v) => std::env::set_var("XDG_CONFIG_HOME", v), None => std::env::remove_var("XDG_CONFIG_HOME") }
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn scenario_create_thread_persistence_roundtrip_and_four_states() {
    let _f = Fixture::new();
    let mut t = thread_create("研究".into(), "v".into()).unwrap();
    for status in [ThreadStatus::Active, ThreadStatus::Paused, ThreadStatus::Completed, ThreadStatus::Archived] {
        t.status = status.clone();
        thread_update(t.clone()).unwrap();
        let loaded = thread_list("v".into()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, t.id);
        assert_eq!(loaded[0].title, "研究");
        assert_eq!(loaded[0].status, status);
    }
}

#[test]
fn scenario_corrupt_thread_is_quarantined_without_blocking_load() {
    let _f = Fixture::new();
    let t = thread_create("保留".into(), "v".into()).unwrap();
    let bad = config::config_dir().unwrap().join("threads/broken.json");
    fs::write(&bad, "{broken").unwrap();
    let loaded = thread_list("v".into()).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, t.id);
    assert!(!bad.exists());
    assert!(bad.with_extension("json.corrupt").exists());
    assert_eq!(thread_list("v".into()).unwrap().len(), 1);
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
    let v: VaultWorkspace = serde_json::from_str(&fs::read_to_string(dir.join("persisted-id.json")).unwrap()).unwrap();
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
    let v: VaultWorkspace = serde_json::from_str(&fs::read_to_string(config::config_dir().unwrap().join("workspaces/stable.json")).unwrap()).unwrap();
    assert_eq!(v.id, "stable");
    assert_eq!(v.path, new);
    assert_eq!(config::load().unwrap().config.last_vault, Some(new));
}

#[test]
fn scenario_multiple_vault_threads_are_isolated() {
    let f = Fixture::new();
    let a = f.vault("a");
    let b = f.vault("b");
    vault_register("a".into(), a.clone()).unwrap();
    vault_register("b".into(), b.clone()).unwrap();
    lumir_lib::commands::write_last_vault(std::path::Path::new(&a)).unwrap();
    let ta = thread_create("A".into(), "a".into()).unwrap();
    lumir_lib::commands::write_last_vault(std::path::Path::new(&b)).unwrap();
    let tb = thread_create("B".into(), "b".into()).unwrap();
    let visible = thread_list("b".into()).unwrap();
    assert!(visible.iter().any(|t| t.id == tb.id));
    assert!(!visible.iter().any(|t| t.id == ta.id), "vault B 不得看到 vault A 的 Thread");
}

#[test]
fn scenario_editor_measure_invalid_value_falls_back_with_warning() {
    let f = Fixture::new();
    let p = f.root.join("measure.json");
    for value in ["0", "-1", "2001", "1.5", "\"wide\"", "true"] {
        fs::write(&p, format!("{{\"editor\":{{\"measure\":{value}}}}}")).unwrap();
        let loaded = config::load_from(&p);
        assert_eq!(loaded.config.editor.measure, 480);
        assert!(loaded.warnings.iter().any(|w| w.contains("editor.measure")));
    }
}
