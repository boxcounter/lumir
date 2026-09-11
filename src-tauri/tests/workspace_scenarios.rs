use lumir_lib::{config, workspaces::*};
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
fn scenario_valid_id_rejects_path_escape_for_vault_commands() {
    let f = Fixture::new();
    assert!(vault_register("../config".into(), f.vault("v")).is_err());
    assert!(vault_remap("../config".into(), f.vault("v2")).is_err());
}

#[test]
fn scenario_editor_measure_valid_value_has_no_warning() {
    let f = Fixture::new();
    let p = f.root.join("measure-valid.json");
    fs::write(&p, r#"{"editor":{"measure":720}}"#).unwrap();
    let loaded = config::load_from(&p);
    assert_eq!(loaded.config.editor.measure, 720);
    assert!(loaded.warnings.is_empty());
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
