//! 草稿归属回归（M848，finding `20261119-worker-persistence-faults-bug-vault-scope-vault-vault`）：
//! 草稿命令的落点**只**由调用方传入的 vault id 决定，不读「当前打开的 vault」。
//!
//! 判据是「谁的文件被读 / 被写」：切 vault 之后才执行的旧写只许落在旧 vault 的文件，晚到的
//! 旧读只许返回旧 vault 的内容。旧实现按命令**执行时**的当前 scope 解析落点，因此这些交错
//! 会串台（旧写落新 vault + 旧草稿丢失）——本文件把交错写成确定性断言。
//!
//! 环境隔离与串行纪律同 `abort_turn.rs`：XDG_CONFIG_HOME / HOME 指临时目录；env 是进程全局，
//! 测试用静态锁串行。

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use lumir_lib::harness::draft::{drafts_dir, harness_draft_get, harness_draft_put};

static ENV_LOCK: Mutex<()> = Mutex::new(());

const A: &str = r#"{"version":2,"text":"vault-a 的字","caret":3,"cards":[]}"#;
const A_LATE: &str = r#"{"version":2,"text":"vault-a 迟到的字","caret":5,"cards":[]}"#;
const B: &str = r#"{"version":2,"text":"vault-b 的字","caret":0,"cards":[]}"#;

/// 隔离配置目录的夹具：每个用例独占一份 `XDG_CONFIG_HOME`，Drop 复原。
struct Fixture {
    root: PathBuf,
    previous_xdg: Option<OsString>,
    previous_home: Option<OsString>,
    _guard: MutexGuard<'static, ()>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(format!(
            "lumir-m848-draft-vault-{}-{}",
            name,
            std::process::id()
        ));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(root.join("xdg")).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::env::set_var("HOME", root.join("home"));
        Self {
            root,
            previous_xdg,
            previous_home,
            _guard: guard,
        }
    }

    fn dir(&self) -> PathBuf {
        drafts_dir().expect("配置目录")
    }

    fn file(&self, vault_id: &str) -> PathBuf {
        self.dir().join(format!("{vault_id}.json"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        match &self.previous_xdg {
            Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
        match &self.previous_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        std::fs::remove_dir_all(&self.root).ok();
    }
}

fn read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|it| {
            it.map(|e| e.unwrap().file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn put(vault_id: Option<&str>, draft: &str) {
    harness_draft_put(vault_id.map(str::to_string), draft.to_string()).expect("写草稿");
}

fn get(vault_id: Option<&str>) -> Option<String> {
    harness_draft_get(vault_id.map(str::to_string)).expect("读草稿")
}

/// 旧 vault 的在途写晚于切 vault：它只落在旧 vault 的文件，新 vault 的草稿逐字节不变。
#[test]
fn late_write_after_switch_lands_on_its_own_vault() {
    let f = Fixture::new("late-write");
    put(Some("vault-a"), A);
    // 切到 vault-b：b 的草稿先落盘（此时后端「当前 vault」已是 b）。
    put(Some("vault-b"), B);
    // vault-a 的在途写此刻才执行——旧实现会按当前 scope 写进 b.json。
    put(Some("vault-a"), A_LATE);

    assert_eq!(read(&f.file("vault-b")), Some(B.to_string()), "新 vault 不被旧写污染");
    assert_eq!(
        read(&f.file("vault-a")),
        Some(A_LATE.to_string()),
        "旧 vault 的迟到写落在自己的文件"
    );
    assert_eq!(
        entries(&f.dir()),
        vec!["vault-a.json".to_string(), "vault-b.json".to_string()],
        "只有两份草稿文件"
    );
}

/// 旧 vault 的读晚到：返回的仍是旧 vault 的内容，不是新 vault 的。
#[test]
fn late_read_returns_its_own_vault() {
    let f = Fixture::new("late-read");
    put(Some("vault-a"), A);
    put(Some("vault-b"), B);

    // 交错：先读 b，再读「晚到的 a」——两次互不影响。
    assert_eq!(get(Some("vault-b")), Some(B.to_string()));
    assert_eq!(get(Some("vault-a")), Some(A.to_string()));
    // 读不产生写：两份文件保持原样。
    assert_eq!(read(&f.file("vault-a")), Some(A.to_string()));
    assert_eq!(read(&f.file("vault-b")), Some(B.to_string()));
}

/// 同 vault 的正常读写往返（归属正确时语义与改动前一致）。
#[test]
fn same_vault_round_trip() {
    let f = Fixture::new("round-trip");
    put(Some("vault-a"), A);
    assert_eq!(get(Some("vault-a")), Some(A.to_string()));
    put(Some("vault-a"), A_LATE);
    assert_eq!(get(Some("vault-a")), Some(A_LATE.to_string()));
    assert_eq!(entries(&f.dir()), vec!["vault-a.json".to_string()]);
}

/// 清除只删自己 vault 的那一份（发送成功后的 clear 不会顺手删掉别的 vault）。
#[test]
fn clear_is_scoped_to_its_own_vault() {
    let f = Fixture::new("clear");
    put(Some("vault-a"), A);
    put(Some("vault-b"), B);
    put(Some("vault-a"), "");

    assert!(!f.file("vault-a").exists(), "清除删掉目标文件");
    assert_eq!(read(&f.file("vault-b")), Some(B.to_string()), "别的 vault 不动");
    assert_eq!(get(Some("vault-a")), None);
}

/// 无 vault（`None`）：读恒空、写静默 no-op，且不建草稿目录。
#[test]
fn no_vault_reads_nothing_and_writes_nothing() {
    let f = Fixture::new("no-vault");
    assert_eq!(get(None), None);
    put(None, A);
    put(None, "");
    assert!(!f.dir().exists(), "无 vault 不建目录、不落盘");
}

/// id 形状非法：读写清一律静默 no-op，且不得越出草稿目录。
#[test]
fn invalid_ids_are_silent_noops_and_cannot_escape() {
    let f = Fixture::new("invalid");
    let too_long = "x".repeat(200);
    for bad in ["../escape", "..", "a/b", "_orphaned", "", too_long.as_str()] {
        put(Some(bad), A);
        assert_eq!(get(Some(bad)), None, "{bad}");
        put(Some(bad), "");
    }
    assert!(!f.dir().exists(), "非法 id 连草稿目录都不该建");
    assert!(
        !f.root.join("xdg/lumir/harness/escape.json").exists(),
        "不得越出草稿目录"
    );
}
