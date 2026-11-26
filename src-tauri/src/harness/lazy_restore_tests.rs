use super::events::EventSink;
use super::jsonl;
use super::turn;
use super::{Runtime, VaultScope};
use crate::config;
use crate::fs_io::IgnorePolicy;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

struct NullSink;
impl EventSink for NullSink {
    fn emit(&self, _payload: serde_json::Value) {}
}

struct XdgGuard(Option<std::ffi::OsString>);
impl Drop for XdgGuard {
    fn drop(&mut self) {
        match &self.0 {
            Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }
}

struct Fixture {
    root: PathBuf,
    scope: VaultScope,
    config: config::HarnessConfig,
    runtime: Runtime,
    _env: XdgGuard,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "lumir-lazy-restore-{name}-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let vault = root.join("vault");
        std::fs::create_dir_all(&vault).unwrap();
        let previous_env = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        let scope = VaultScope {
            root: vault.clone(),
            policy: {
                let defaults = config::VaultConfig::default();
                IgnorePolicy::load(&vault, &[".gitignore".to_string()], &defaults.ignore)
            },
            vault_id: "vault-lazy-restore".to_string(),
        };
        Self {
            root,
            scope,
            config: config::test_mock(None),
            runtime: Runtime::default(),
            _env: XdgGuard(previous_env),
        }
    }

    fn seed(&self, text: &str) -> (String, PathBuf) {
        self.runtime
            .acquire_turn(&self.scope, &self.config)
            .unwrap();
        let script =
            serde_json::json!({"responses": [{"text": format!("答：{text}")}]}).to_string();
        let mut client = super::llm::MockClient::from_str(&script, "lazy-restore-seed").unwrap();
        turn::run_turn_for(
            &NullSink,
            &self.runtime,
            &self.scope,
            &self.config,
            text.to_string(),
            None,
            &mut client,
        );
        self.runtime.release_turn(&self.scope);
        let id = self.runtime.current_session_id(&self.scope).unwrap();
        let path = self
            .runtime
            .with_session(&self.scope, |session| session.jsonl().path().to_path_buf())
            .unwrap();
        (id, path)
    }

    fn finish_seed(&self) {
        self.runtime.new_session(&self.scope).unwrap();
    }

    fn send(&self, text: &str, response: &str) {
        let script = serde_json::json!({"responses": [{"text": response}]}).to_string();
        self.send_script(text, &script);
    }

    fn send_script(&self, text: &str, script: &str) {
        self.runtime
            .acquire_turn(&self.scope, &self.config)
            .unwrap();
        let mut client = super::llm::MockClient::from_str(script, "lazy-restore-send").unwrap();
        turn::run_turn_for(
            &NullSink,
            &self.runtime,
            &self.scope,
            &self.config,
            text.to_string(),
            None,
            &mut client,
        );
        self.runtime.release_turn(&self.scope);
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn append_records(path: &Path, records: &[serde_json::Value]) {
    let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    for payload in records {
        writeln!(
            file,
            "{}",
            serde_json::json!({"ts": jsonl::unix_secs_now(), "payload": payload})
        )
        .unwrap();
    }
}

fn append_title_and_notice(path: &Path, suffix: &str) {
    append_records(
        path,
        &[
            super::title::inherit_payload(&format!("标题 {suffix}")),
            serde_json::json!({
                "kind": "subrun",
                "run_id": format!("run-{suffix}"),
                "agent": "research",
                "description": format!("后台任务 {suffix}"),
                "status": "completed",
                "model": "mock",
                "usage": {"input_tokens": 1, "cached_tokens": 0, "output_tokens": 1}
            }),
            serde_json::json!({
                "kind": "notice_delivered",
                "run_ids": [format!("run-{suffix}")],
                "wake_batch": format!("batch-{suffix}"),
                "shown_at": 1
            }),
        ],
    );
}

#[test]
fn viewing_restore_is_read_only_and_reuses_pending_identity() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("view");
    let (a, a_path) = fixture.seed("A");
    append_title_and_notice(&a_path, "a");
    fixture.finish_seed();
    let (b, b_path) = fixture.seed("B");
    append_title_and_notice(&b_path, "b");
    fixture.finish_seed();
    let dir = a_path.parent().unwrap();
    let before_entries = entries(dir);
    let before_a = std::fs::read(&a_path).unwrap();
    let before_b = std::fs::read(&b_path).unwrap();
    let mtime_a = std::fs::metadata(&a_path).unwrap().modified().unwrap();
    let mtime_b = std::fs::metadata(&b_path).unwrap().modified().unwrap();

    let first = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &a)
        .unwrap();
    assert!(first.switched);
    assert_eq!(
        entries(dir),
        before_entries,
        "查看不得新增 JSONL 或临时文件"
    );
    assert_eq!(
        first.messages.iter().filter(|m| m.role == "notice").count(),
        1
    );
    let second = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &a)
        .unwrap();
    assert!(!second.switched);
    assert!(second.messages.is_empty());
    assert_eq!(
        second.session_id, first.session_id,
        "同源 pending 必须复用 id"
    );
    assert_eq!(
        second.session_token, first.session_token,
        "同源 pending 必须复用 token"
    );
    assert_eq!(entries(dir), before_entries);

    fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &b)
        .unwrap();
    fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &a)
        .unwrap();
    assert_eq!(entries(dir), before_entries, "A→B→A 纯查看必须零新增");
    assert_eq!(std::fs::read(&a_path).unwrap(), before_a);
    assert_eq!(std::fs::read(&b_path).unwrap(), before_b);
    assert_eq!(
        std::fs::metadata(&a_path).unwrap().modified().unwrap(),
        mtime_a
    );
    assert_eq!(
        std::fs::metadata(&b_path).unwrap().modified().unwrap(),
        mtime_b
    );
}

#[test]
fn current_materialized_session_switches_while_busy_without_forking() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("current-busy");
    let (source, path) = fixture.seed("当前");
    let before = entries(path.parent().unwrap());
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let info = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .expect("点击当前文件在 busy 下也必须直切");
    assert!(!info.switched);
    assert_eq!(info.session_id, source);
    assert!(info.messages.is_empty());
    assert_eq!(entries(path.parent().unwrap()), before);
    fixture.runtime.release_turn(&fixture.scope);
}

#[test]
fn unpublished_batch_blocks_new_session_then_publishes_before_reset() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("guard");
    let (source, source_path) = fixture.seed("保留这批");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let dir = source_path.parent().unwrap().to_path_buf();
    std::fs::remove_dir_all(&dir).unwrap();
    fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            let payload = serde_json::json!({
                "kind": "llm_request",
                "request": {"system": session.system(), "messages": session.input()}
            });
            session.jsonl().record(&payload);
        })
        .unwrap();
    let pending_path = dir.join(format!("{}.jsonl", pending.session_id));
    assert!(!pending_path.exists(), "发布失败不得留下最终文件");
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(
        !health.history_gap.present,
        "内存批次尚在，不得制造 history_gap"
    );

    let error = fixture
        .runtime
        .new_session(&fixture.scope)
        .expect_err("未发布批次不得被新会话丢弃");
    assert_eq!(error.code, "harness_persistence_unpublished");
    assert_eq!(
        fixture
            .runtime
            .current_session_id(&fixture.scope)
            .as_deref(),
        Some(pending.session_id.as_str())
    );
    assert_eq!(
        fixture
            .runtime
            .snapshot(&fixture.scope, &fixture.config)
            .session_token,
        pending.session_token
    );

    std::fs::create_dir_all(&dir).unwrap();
    fixture
        .runtime
        .new_session(&fixture.scope)
        .expect("权限恢复后应先发布再重置");
    let file = jsonl::read_session_file(&pending_path).unwrap();
    assert_eq!(file.records[0]["kind"], "session_open");
    assert_eq!(file.records[1]["kind"], "llm_request");
}

fn kinds(file: &jsonl::SessionFile) -> Vec<&str> {
    file.records
        .iter()
        .map(|record| record["kind"].as_str().unwrap_or("unknown"))
        .collect()
}

#[test]
fn first_real_turn_publishes_exact_initial_batch_after_title_and_notices() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("initial-batch");
    let (source, source_path) = fixture.seed("源问题");
    append_title_and_notice(&source_path, "source");
    fixture.finish_seed();
    let source_bytes = std::fs::read(&source_path).unwrap();
    let source_mtime = std::fs::metadata(&source_path).unwrap().modified().unwrap();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let pending_path = source_path
        .parent()
        .unwrap()
        .join(format!("{}.jsonl", pending.session_id));
    assert!(!pending_path.exists());

    fixture.send("续聊", "继续回答");
    let file = jsonl::read_session_file(&pending_path).unwrap();
    assert_eq!(
        kinds(&file),
        vec![
            "session_open",
            "session_title",
            "notice_delivered",
            "llm_request",
            "llm_response"
        ]
    );
    assert_eq!(file.session_open["opened_from"], "restore");
    assert_eq!(file.session_open["restored_from"], source);
    assert_eq!(file.records[1]["decision"], "inherit");
    assert_eq!(file.records[2]["wake_batch"], "batch-source");
    assert_eq!(std::fs::read(&source_path).unwrap(), source_bytes);
    assert_eq!(
        std::fs::metadata(&source_path).unwrap().modified().unwrap(),
        source_mtime
    );
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(health.history_written);
    assert!(!health.history_gap.present);
}

#[test]
fn empty_source_stays_empty_until_first_real_turn() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("empty-source");
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    fixture.runtime.release_turn(&fixture.scope);
    let source = fixture.runtime.current_session_id(&fixture.scope).unwrap();
    let source_path = fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            session
                .jsonl()
                .record(&serde_json::json!({"kind": "loop_max_reached"}));
            session.jsonl().path().to_path_buf()
        })
        .unwrap();
    fixture.finish_seed();
    let before = entries(source_path.parent().unwrap());
    let info = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    assert!(info.messages.is_empty());
    assert_eq!(entries(source_path.parent().unwrap()), before);
    fixture.send("空源首问", "空源首答");
    let file = jsonl::read_session_file(
        &source_path
            .parent()
            .unwrap()
            .join(format!("{}.jsonl", info.session_id)),
    )
    .unwrap();
    assert_eq!(
        kinds(&file),
        vec!["session_open", "llm_request", "llm_response"]
    );
}

#[test]
fn collision_preserves_existing_file_and_same_identity_publishes_once_after_retry() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("collision");
    let (source, source_path) = fixture.seed("撞名");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let pending_path = source_path
        .parent()
        .unwrap()
        .join(format!("{}.jsonl", pending.session_id));
    std::fs::write(&pending_path, b"existing bytes\n").unwrap();
    fixture.send("不会覆盖", "对话仍继续");
    assert_eq!(std::fs::read(&pending_path).unwrap(), b"existing bytes\n");
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(!health.history_written);
    assert!(!health.history_gap.present);

    std::fs::remove_file(&pending_path).unwrap();
    fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            session.jsonl().record(&serde_json::json!({
                "kind": "session_title",
                "decision": "keep",
                "reason": "cadence",
                "title": "撞名"
            }));
        })
        .unwrap();
    let file = jsonl::read_session_file(&pending_path).unwrap();
    assert_eq!(file.session_open["session_id"], pending.session_id);
    assert_eq!(
        file.records
            .iter()
            .filter(|record| record["kind"] == "llm_request")
            .count(),
        1
    );
    assert_eq!(
        file.records
            .iter()
            .filter(|record| record["kind"] == "llm_response")
            .count(),
        1
    );
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(health.history_written);
    assert!(!health.history_gap.present);
}

#[test]
fn failed_provider_turn_and_explicit_retry_keep_one_file_and_exact_counts() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("provider-retry");
    let (source, source_path) = fixture.seed("失败重试");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let dir = source_path.parent().unwrap().to_path_buf();
    std::fs::remove_dir_all(&dir).unwrap();
    fixture.send_script(
        "只入队一次",
        r#"{"responses":[{"error":{"code":"harness_network_failed","message":"断","kind":"network_send"}}]}"#,
    );
    let pending_path = dir.join(format!("{}.jsonl", pending.session_id));
    assert!(!pending_path.exists());
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(!health.history_written);
    assert!(!health.history_gap.present);

    std::fs::create_dir_all(&dir).unwrap();
    let retry_turn = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .retry
        .unwrap()
        .turn;
    let failed = fixture
        .runtime
        .begin_retry(&fixture.scope, &fixture.config, retry_turn)
        .unwrap();
    let mut client = super::llm::MockClient::from_str(
        r#"{"responses":[{"text":"重试成功"}]}"#,
        "lazy-restore-explicit-retry",
    )
    .unwrap();
    turn::run_turn_resume_for(
        &NullSink,
        &fixture.runtime,
        &fixture.scope,
        &fixture.config,
        failed.user_text,
        &mut client,
    );
    fixture.runtime.release_turn(&fixture.scope);

    let file = jsonl::read_session_file(&pending_path).unwrap();
    assert_eq!(
        kinds(&file),
        vec![
            "session_open",
            "llm_request",
            "llm_response",
            "llm_error",
            "llm_request",
            "llm_response"
        ]
    );
    assert_eq!(
        fixture
            .runtime
            .current_session_id(&fixture.scope)
            .as_deref(),
        Some(pending.session_id.as_str())
    );
    let input = fixture
        .runtime
        .with_session(&fixture.scope, |session| session.input().to_vec())
        .unwrap();
    let user_messages = input
        .iter()
        .filter(|item| item["role"] == "user")
        .filter(|item| item["content"].to_string().contains("只入队一次"))
        .count();
    assert_eq!(user_messages, 1, "显式重试不得新增用户消息");
    let health = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;
    assert!(health.history_written);
    assert!(!health.history_gap.present);
}

#[test]
fn threshold_compact_skip_keeps_uncompressed_session_and_complete_batch() {
    let _xdg = super::xdg_test_lock();
    let mut fixture = Fixture::new("compact-threshold");
    let (source, source_path) = fixture.seed("阈值压缩");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let dir = source_path.parent().unwrap().to_path_buf();
    std::fs::remove_dir_all(&dir).unwrap();
    fixture.config.auto_compact = true;
    fixture.config.warn_ctx_pct = 0.0;
    fixture.send_script(
        "触发阈值",
        r#"{"responses":[
          {"text":"未压缩回答","usage":{"input_tokens":100,"cached_tokens":0,"output_tokens":1}},
          {"text":"不得采用的摘要"}
        ]}"#,
    );
    let pending_path = dir.join(format!("{}.jsonl", pending.session_id));
    assert!(!pending_path.exists());
    assert_eq!(
        fixture
            .runtime
            .current_session_id(&fixture.scope)
            .as_deref(),
        Some(pending.session_id.as_str())
    );
    let input = fixture
        .runtime
        .with_session(&fixture.scope, |session| session.input().to_vec())
        .unwrap();
    assert!(input
        .iter()
        .any(|item| item["content"].to_string().contains("未压缩回答")));
    assert!(!input
        .iter()
        .any(|item| item["content"].to_string().contains("不得采用的摘要")));

    std::fs::create_dir_all(&dir).unwrap();
    fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            session.jsonl().try_publish_pending()
        })
        .unwrap();
    let file = jsonl::read_session_file(&pending_path).unwrap();
    assert_eq!(
        kinds(&file),
        vec![
            "session_open",
            "llm_request",
            "llm_response",
            "llm_request",
            "llm_response"
        ]
    );
}

struct CollectSink(Arc<Mutex<Vec<serde_json::Value>>>);
impl EventSink for CollectSink {
    fn emit(&self, payload: serde_json::Value) {
        self.0.lock().unwrap().push(payload);
    }
}

#[test]
fn overflow_compact_skip_falls_back_to_original_error_without_retry() {
    let _xdg = super::xdg_test_lock();
    let mut fixture = Fixture::new("compact-overflow");
    let (source, source_path) = fixture.seed("超限压缩");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    let dir = source_path.parent().unwrap().to_path_buf();
    std::fs::remove_dir_all(&dir).unwrap();
    fixture.config.auto_compact = true;
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = CollectSink(events.clone());
    let mut client = super::llm::MockClient::from_str(
        r#"{"responses":[
          {"error":{"code":"context_length_exceeded","message":"too long"}},
          {"text":"不得采用的溢出摘要"},
          {"text":"不得出现的第三次请求"}
        ]}"#,
        "lazy-restore-overflow",
    )
    .unwrap();
    turn::run_turn_for(
        &sink,
        &fixture.runtime,
        &fixture.scope,
        &fixture.config,
        "触发溢出".to_string(),
        None,
        &mut client,
    );
    fixture.runtime.release_turn(&fixture.scope);

    let errors: Vec<serde_json::Value> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["type"] == "error")
        .cloned()
        .collect();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0]["code"], "context_length_exceeded");
    assert_eq!(
        fixture
            .runtime
            .current_session_id(&fixture.scope)
            .as_deref(),
        Some(pending.session_id.as_str())
    );
    assert!(!dir.join(format!("{}.jsonl", pending.session_id)).exists());
    let input = fixture
        .runtime
        .with_session(&fixture.scope, |session| session.input().to_vec())
        .unwrap();
    assert!(!input
        .iter()
        .any(|item| item["content"].to_string().contains("不得采用的溢出摘要")));

    std::fs::create_dir_all(&dir).unwrap();
    fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            session.jsonl().try_publish_pending()
        })
        .unwrap();
    let file =
        jsonl::read_session_file(&dir.join(format!("{}.jsonl", pending.session_id))).unwrap();
    assert_eq!(
        kinds(&file),
        vec![
            "session_open",
            "llm_request",
            "llm_response",
            "llm_request",
            "llm_response",
            "llm_error"
        ]
    );
}

#[test]
fn unpublished_batch_blocks_resume_then_publishes_before_switch() {
    use std::os::unix::fs::PermissionsExt;

    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("resume-guard");
    let (a, a_path) = fixture.seed("A");
    fixture.finish_seed();
    let (b, _) = fixture.seed("B");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &a)
        .unwrap();
    let dir = a_path.parent().unwrap().to_path_buf();
    let original_mode = std::fs::metadata(&dir).unwrap().permissions().mode();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    fixture
        .runtime
        .with_session(&fixture.scope, |session| {
            let payload = serde_json::json!({
                "kind": "llm_request",
                "request": {"system": session.system(), "messages": session.input()}
            });
            session.jsonl().record(&payload);
        })
        .unwrap();
    let same = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &a)
        .unwrap();
    assert!(!same.switched);
    assert_eq!(same.session_id, pending.session_id);
    assert_eq!(same.session_token, pending.session_token);
    let before = fixture
        .runtime
        .snapshot(&fixture.scope, &fixture.config)
        .persistence;

    let error = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &b)
        .expect_err("未发布批次不得被另一历史替换");
    assert_eq!(error.code, "harness_persistence_unpublished");
    assert_eq!(
        fixture
            .runtime
            .current_session_id(&fixture.scope)
            .as_deref(),
        Some(pending.session_id.as_str())
    );
    assert_eq!(
        fixture
            .runtime
            .snapshot(&fixture.scope, &fixture.config)
            .persistence,
        before
    );

    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(original_mode)).unwrap();
    let switched = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &b)
        .unwrap();
    assert!(switched.switched);
    let file =
        jsonl::read_session_file(&dir.join(format!("{}.jsonl", pending.session_id))).unwrap();
    assert_eq!(kinds(&file), vec!["session_open", "llm_request"]);
}

#[test]
fn duplicate_send_intent_accepts_only_one_turn_and_one_request() {
    let _xdg = super::xdg_test_lock();
    let fixture = Fixture::new("double-send");
    let (source, source_path) = fixture.seed("双击");
    fixture.finish_seed();
    let pending = fixture
        .runtime
        .resume_session(&fixture.scope, &fixture.config, &source)
        .unwrap();
    fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap();
    let error = fixture
        .runtime
        .acquire_turn(&fixture.scope, &fixture.config)
        .unwrap_err();
    assert_eq!(error.code, "harness_busy");
    let mut client = super::llm::MockClient::from_str(
        r#"{"responses":[{"text":"只回答一次"}]}"#,
        "lazy-restore-double-send",
    )
    .unwrap();
    turn::run_turn_for(
        &NullSink,
        &fixture.runtime,
        &fixture.scope,
        &fixture.config,
        "只发送一次".to_string(),
        None,
        &mut client,
    );
    fixture.runtime.release_turn(&fixture.scope);
    let file = jsonl::read_session_file(
        &source_path
            .parent()
            .unwrap()
            .join(format!("{}.jsonl", pending.session_id)),
    )
    .unwrap();
    assert_eq!(
        file.records
            .iter()
            .filter(|record| record["kind"] == "llm_request")
            .count(),
        1
    );
    assert_eq!(
        file.records
            .iter()
            .filter(|record| record["kind"] == "llm_response")
            .count(),
        1
    );
}
