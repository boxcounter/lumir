//! Harness 运行时集成测试（M302）：mock provider 驱动工具循环，覆盖 mission 单测清单——
//! 多轮往返 / loop_max 终止 / 权限判定顺序（deny > allow）/ ask 挂起-采纳-拒绝 /
//! patch 唯一命中错误回送 / O_EXCL 拒绝 / skill_load 根外路径拒绝 / 自动压缩（阈值 + 超限重试）/
//! JSONL 留存与会话边界。
//!
//! 环境隔离：XDG_CONFIG_HOME（JSONL 落点）与 HOME（Skill 发现）都指向临时目录，
//! 不碰真实 `~/.config/lumir` 与 `~/.agents`（REVIEW.md 第 13 条）。多测串行（静态锁），
//! 因为 env 是进程全局。

use lumir_lib::commands::CommandError;
use lumir_lib::config::{HarnessConfig, HarnessModelSpec, HarnessPermissions, HarnessProvider};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::llm::{LlmClient, MockClient};
use lumir_lib::harness::thinking::ThinkingEffort;
use lumir_lib::harness::turn;
use lumir_lib::harness::{Runtime, VaultScope};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// 隔离环境的测试夹具：临时 XDG_CONFIG_HOME + HOME + 合成 vault。
struct Fixture {
    root: PathBuf,
    previous_xdg: Option<std::ffi::OsString>,
    previous_home: Option<std::ffi::OsString>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root =
            std::env::temp_dir().join(format!("lumir-m302-it-{}-{}", name, std::process::id()));
        if root.exists() {
            std::fs::remove_dir_all(&root).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
        std::env::set_var("HOME", root.join("home"));
        std::fs::create_dir_all(root.join("xdg")).unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        std::fs::create_dir_all(root.join("vault")).unwrap();
        Self {
            root,
            previous_xdg,
            previous_home,
            _guard: guard,
        }
    }

    fn vault(&self) -> PathBuf {
        self.root.join("vault")
    }

    fn scope(&self) -> VaultScope {
        VaultScope {
            root: self.vault(),
            policy: IgnorePolicy::load(&self.vault(), &[".gitignore".to_string()]),
            vault_id: VAULT_ID.to_string(),
        }
    }

    /// 会话留存目录读口（新布局 `sessions/<vault 稳定 id>/`）：测试侧路径的单一来源。
    fn sessions_dir(&self) -> PathBuf {
        self.root.join("xdg/lumir/harness/sessions").join(VAULT_ID)
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.vault().join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
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

/// 收集事件的 sink。
#[derive(Clone, Default)]
struct CollectSink(Arc<Mutex<Vec<serde_json::Value>>>);

impl EventSink for CollectSink {
    fn emit(&self, payload: serde_json::Value) {
        self.0.lock().unwrap().push(payload);
    }
}

impl CollectSink {
    fn events(&self) -> Vec<serde_json::Value> {
        self.0.lock().unwrap().clone()
    }

    fn types(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|e| e.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .collect()
    }

    fn wait_for<F: Fn(&[serde_json::Value]) -> bool>(&self, predicate: F, what: &str) {
        for _ in 0..500 {
            if predicate(&self.events()) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("等待超时：{what}；已收到事件 {:?}", self.types());
    }
}

fn mock_config() -> HarnessConfig {
    HarnessConfig {
        provider: HarnessProvider::Mock,
        ..Default::default()
    }
}

/// 给 Fixture 挂一个 Runtime（默认不建，谁用谁挂）。
trait RuntimeExt {
    fn runtime(&self) -> Runtime;
}
impl RuntimeExt for Fixture {
    fn runtime(&self) -> Runtime {
        Runtime::default()
    }
}

/// 某工具的最后一个 tool_call 事件（终态事件 status 必须是契约内的 done——
/// m303 面板按非 done 即 started 归并，细分状态在 summary）。
fn last_tool_call_event(sink: &CollectSink, name: &str) -> serde_json::Value {
    let events = sink.events();
    let mut found: Option<serde_json::Value> = None;
    for event in events {
        if event["type"] == "tool_call" && event["name"] == name {
            found = Some(event);
        }
    }
    found.unwrap_or_else(|| panic!("没有 {name} 的 tool_call 事件"))
}

/// 面板消息 role 序列。
fn panel_roles(fixture: &Fixture, runtime: &Runtime) -> Vec<String> {
    let snapshot = runtime.snapshot(&fixture.scope(), &mock_config());
    snapshot.messages.iter().map(|m| m.role.clone()).collect()
}

/// M306 回放契约：LLM 轮产出 reasoning 项时，回放 input 里它必须原样在列、
/// 且紧随其 assistant message 之前（deepseek thinking 模式强制回传，不回传
/// 下一轮即被 provider 以 400 拒绝）。mock 路径驱动，钉的是 turn 层的落点契约。
#[test]
fn reasoning_replay_item_precedes_assistant_message() {
    let f = Fixture::new("reasoning-replay");
    f.write("a.md", "content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"text": "先读文件。",
         "reasoning": {"type":"reasoning","id":"rs_1","status":"completed","content":[{"type":"reasoning_text","text":"需要先读 a.md。"}],"encrypted_content":"resp-0"},
         "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "读完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "reasoning").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "这段讲了什么".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    // 期望序列：user / reasoning / assistant / function_call / function_call_output / assistant。
    let kinds: Vec<String> = input
        .iter()
        .map(|it| {
            it.get("type")
                .and_then(|t| t.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| it["role"].as_str().unwrap_or("?").to_string())
        })
        .collect();
    assert_eq!(
        kinds,
        vec![
            "user",
            "reasoning",
            "assistant",
            "function_call",
            "function_call_output",
            "assistant"
        ],
        "{kinds:?}"
    );
    // 原样在列：reasoning 项的 content / encrypted_content 不得被重建或丢弃。
    let reasoning = &input[1];
    assert_eq!(reasoning["content"][0]["type"], "reasoning_text");
    assert_eq!(reasoning["content"][0]["text"], "需要先读 a.md。");
    assert_eq!(reasoning["encrypted_content"], "resp-0");
    assert_eq!(sink.types().last().unwrap(), "done");
}

/// M360 回归（Alex 2026-10-07 真机 dogfood 第一条对话即 400 的根因）：
/// **一轮里两条以上工具调用时，调用项必须成组入 input**——全部 `function_call` 在前、
/// 全部 `function_call_output` 在后。
///
/// 根因（2026-10-07 对真 API 逐项变异实测，M360）：provider 兼容层把 `function_call`
/// 并进**相邻的** assistant 消息；调用与输出交错（`fc1, fco1, fc2, fco2`）时，第二条调用
/// 落进一条新的、没有 reasoning 的 assistant 消息，deepseek thinking 模式即 400
/// ``The `reasoning_text` in the thinking mode must be passed back to the API``。报错文案
/// 指向 reasoning，实际触发条件是**项序**：同两条调用、连 reasoning 整项删掉也照旧 400，
/// 而只把两组调用对改成 `fc1, fc2, fco1, fco2` 就 200（现场见 §fix note）。
///
/// 判据的区分度：旧实现（每条调用各自「调用项 + 输出项」交错压栈）产出的序列是
/// `… fc1, fco1, fc2, fco2`，与本断言逐位不同 ⇒ 旧代码必红（已实测）。
/// 期望序列的第 2 轮形态（M372）：无正文的工具轮只留 reasoning 项、不落空 assistant
/// 消息项——空 `output_text` 进下一次请求会被订阅端 400（`text content is empty`）。
#[test]
fn multi_call_round_groups_call_items_before_outputs() {
    let f = Fixture::new("multi-call-grouping");
    f.write("a.md", "content\n");
    f.write("b.md", "content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"reasoning": {"type":"reasoning","id":"rs_1","status":"completed","content":[{"type":"reasoning_text","text":"两个文件都要读。"}],"encrypted_content":"resp-0"},
         "tool_calls": [
            {"id": "call_1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"},
            {"id": "call_2", "name": "vault_read", "arguments": "{\"path\":\"b.md\"}"}
        ]},
        {"text": "读完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "multi-call").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "两个文件都读一下".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    let kinds: Vec<String> = input
        .iter()
        .map(|it| {
            it.get("type")
                .and_then(|t| t.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| it["role"].as_str().unwrap_or("?").to_string())
        })
        .collect();
    // M372 起第 1 轮（reasoning + 调用、无正文）不落空正文 assistant 消息项——空
    // output_text 进下一次请求会被 Kimi Code 订阅端整条 400（`text content is empty`）；
    // reasoning 项按 M306 原样回传。故序列是 reasoning 直接接成组调用项。
    assert_eq!(
        kinds,
        vec![
            "user",
            "reasoning",
            "function_call",
            "function_call",
            "function_call_output",
            "function_call_output",
            "assistant"
        ],
        "调用项须成组（全部 function_call 在前、全部输出在后）：{kinds:?}"
    );
    // M372 守卫：input 里任何 assistant 消息项都不得是空正文。
    for it in &input {
        if it["role"] == "assistant" {
            let text = it["content"][0]["text"].as_str().unwrap_or("");
            assert!(!text.is_empty(), "assistant 项不得为空正文：{it}");
        }
    }
    // 成组之外还要配对：输出项按调用顺序与调用项一一对应（call_id 同序）。
    let call_ids: Vec<&str> = input
        .iter()
        .filter(|it| it["type"] == "function_call")
        .filter_map(|it| it["call_id"].as_str())
        .collect();
    let output_ids: Vec<&str> = input
        .iter()
        .filter(|it| it["type"] == "function_call_output")
        .filter_map(|it| it["call_id"].as_str())
        .collect();
    assert_eq!(call_ids, vec!["call_1", "call_2"], "{input:#?}");
    assert_eq!(output_ids, call_ids, "输出须与调用同序配对：{input:#?}");
    // 两条调用都真的执行了（不是靠丢调用来凑顺序）。
    let tool_msgs = runtime
        .snapshot(&f.scope(), &mock_config())
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .count();
    assert_eq!(tool_msgs, 2);
    assert_eq!(sink.types().last().unwrap(), "done");
}

#[test]
fn tool_loop_roundtrip_with_fixture_file() {
    let f = Fixture::new("roundtrip");
    f.write("notes/demo.md", "demo content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/harness-fixtures/mock_basic.json"),
    )
    .unwrap();
    let mut client = MockClient::from_str(&script, "mock_basic.json").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "这段讲了什么".to_string(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 事件序列：文本 chunk → 工具 started/done → usage → 文本 → usage → done。
    let types = sink.types();
    assert!(types.contains(&"text_chunk".to_string()), "{types:?}");
    assert!(types.contains(&"tool_call".to_string()), "{types:?}");
    assert!(types.contains(&"usage".to_string()), "{types:?}");
    assert_eq!(types.last().unwrap(), "done", "{types:?}");

    // 面板：user / assistant / tool / assistant 依次入账。
    assert_eq!(
        panel_roles(&f, &runtime),
        vec!["user", "assistant", "tool", "assistant"]
    );

    // 用量：mock 第二轮 input 1400 / 窗口 131072 ≈ 1.1%，cache 1000/1400 ≈ 71.4%。
    let snapshot = runtime.snapshot(&f.scope(), &mock_config());
    assert!((snapshot.usage.ctx_pct - 1400.0 * 100.0 / 131072.0).abs() < 0.2);
    assert!((snapshot.usage.cache_pct - 1000.0 * 100.0 / 1400.0).abs() < 0.2);

    // wire 留存：配置目录（不是 vault）有记录——首行 session_open，其后 llm_request /
    // llm_response 成对，工具调用与结果逐字节在 llm_request.messages 里。
    let path = harness_jsonl_path(&f);
    let file = read_session_file(&path);
    assert_eq!(file.session_open["kind"], "session_open");
    assert_eq!(file.session_open["provider"], "mock");
    assert!(
        file.session_open["system"]
            .as_str()
            .unwrap()
            .contains("Lumir 的内置助手"),
        "{:?}",
        file.session_open
    );
    // 装配清单在场，「vault 根 AGENTS.md / AGENTS.local.md 均不存在」如实记 exists:false。
    let assembly = file.session_open["assembly"].as_array().unwrap();
    assert_eq!(assembly.len(), 6, "{assembly:?}");
    let vault_root = assembly
        .iter()
        .find(|s| s["source"] == "agents_vault_root")
        .unwrap();
    assert_eq!(vault_root["exists"], false, "{vault_root:?}");
    let vault_local = assembly
        .iter()
        .find(|s| s["source"] == "agents_vault_root_local")
        .unwrap();
    assert_eq!(vault_local["exists"], false, "{vault_local:?}");
    assert_eq!(vault_local["bytes"], 0, "{vault_local:?}");
    let kinds: Vec<&str> = file
        .records
        .iter()
        .skip(1)
        .map(|r| r["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        vec!["llm_request", "llm_response", "llm_request", "llm_response"],
        "{kinds:?}"
    );
    // 第一轮响应（records[2]）带工具调用；工具读到的原文逐字节在第二轮请求的 messages 里。
    assert_eq!(file.records[2]["tool_calls"][0]["name"], "vault_read");
    let second_request = &file.records[3]["request"];
    assert_eq!(second_request["system"], file.session_open["system"]);
    let wire = serde_json::to_string(&second_request["messages"]).unwrap();
    assert!(wire.contains("demo content"), "{wire}");
    // usage 并入 llm_response（独立的 usage 事件类已废弃）。
    assert_eq!(file.records[2]["usage"]["output_tokens"], 20);
    // mock provider 的因果链字段。
    assert!(file.records[2]["mock_fixture"]
        .as_str()
        .unwrap()
        .ends_with("mock_basic.json"));
    // 被 wire 覆盖的旧事件类一律不得出现。
    let raw = std::fs::read_to_string(&path).unwrap();
    for legacy in [
        "user_message",
        "assistant_text",
        "tool_call",
        "tool_result",
        "tool_denied",
    ] {
        assert!(
            !raw.contains(&format!("\"kind\":\"{legacy}\"")),
            "{legacy}: {raw}"
        );
    }
}

/// 读取并解析夹具的唯一一份会话留存（`sessions/<session_id>.jsonl` 布局——文件名是
/// `jsonl::new_session_id` 的产物，测试侧不复刻生成算法，REVIEW.md 第 8 条：两份真源
/// 会漂）。一个 Fixture 只有一个 vault 且大多数场景只跑一个会话，目录里恰有一份 `.jsonl`，
/// 直接取它；多会话场景（压缩 / 重置 / 恢复）用 `harness_jsonl_files` 自取。
fn harness_jsonl_path(fixture: &Fixture) -> PathBuf {
    let mut files = harness_jsonl_files(fixture);
    assert_eq!(files.len(), 1, "应恰有一份 JSONL 留存：{files:?}");
    files.pop().unwrap()
}

/// 本测试的 vault 稳定 id（会话留存目录名）：`Fixture::scope()` 与留存读取口共用同一份字面量
/// （REVIEW.md 第 8 条：两份真源会漂）。
const VAULT_ID: &str = "vault-test-1";

/// 列出夹具留存的全部会话文件（按文件名排序——session id 时间序，即建立顺序）。
/// 新布局：目录名 = vault 注册表 id（`sessions/<vault 稳定 id>/*.jsonl`）。
fn harness_jsonl_files(fixture: &Fixture) -> Vec<PathBuf> {
    let dir = fixture.sessions_dir();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("读留存目录 {} 失败：{e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
        .collect();
    files.sort();
    files
}

/// 解析一份会话留存（首行 session_open 的不变量由读取侧钉死）。
fn read_session_file(path: &Path) -> lumir_lib::harness::jsonl::SessionFile {
    lumir_lib::harness::jsonl::read_session_file(path).expect("留存可解析")
}

/// 单测驱动的轮次入口：这些场景不带编辑器上下文，节恒为 `None`。上下文节的串味回归
/// 另见 `context_section_not_confused_by_bracket_in_message`（直接调 `turn::run_turn_for`
/// 并把节作为结构化值传入）。
fn drive_turn(
    sink: &CollectSink,
    runtime: &Runtime,
    scope: &VaultScope,
    config: &HarnessConfig,
    message: String,
    client: &mut dyn LlmClient,
) {
    turn::run_turn_for(sink, runtime, scope, config, message, None, client);
}

/// 回归（M309）：用户正文含 `\n\n[` 时，压缩重注入的上下文节不得串味。旧实现从拼好的
/// user 消息里 `split("\n\n[")` 重解析，切分点被正文里的方括号段落前移 → 存的「节」是
/// 正文。新实现由调用侧把 `assemble_user_message` 同一次生成的节结构化传入，压缩后
/// 重注入的仍是干净节。
#[test]
fn context_section_not_confused_by_bracket_in_message() {
    let f = Fixture::new("ctx-section");
    let mut config = mock_config();
    config.warn_ctx_pct = 50.0; // 一轮 usage 越阈值即触发自动压缩续聊
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();

    let block = turn::ContextBlock {
        path: Some("a/b.md".to_string()),
        selection: Some(turn::RangeBlock {
            from_line: Some(3),
            to_line: Some(7),
            text: Some("选中文本".to_string()),
        }),
        viewport_range: None,
    };
    let expected_section = turn::context_section(&block).unwrap();
    let bracketed = format!("[{expected_section}]");
    // 正文含 `\n\n[`——旧实现的分隔符会在这里切错。
    let body = "看这段\n\n[正文里的方括号段落，不是上下文]";
    let assembled = turn::assemble_user_message(body, &block);
    assert_eq!(
        assembled.context_section.as_deref(),
        Some(bracketed.as_str())
    );

    let script = r#"{"responses": [
        {"text": "长回答。", "usage": {"input_tokens": 120000, "cached_tokens": 60000, "output_tokens": 500}},
        {"text": "会话摘要：前面在聊上下文节。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "ctx-section").unwrap();
    turn::run_turn_for(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        assembled.text,
        assembled.context_section,
        &mut client,
    );
    runtime.release_turn(&f.scope());

    assert!(
        sink.types().contains(&"compact".to_string()),
        "应触发压缩：{:?}",
        sink.types()
    );
    // 压缩后历史：必须有一条 user 项正好是干净上下文节（带方括号）。
    let input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    assert!(
        input.iter().any(|it| {
            it["role"] == "user" && it["content"][0]["text"].as_str() == Some(bracketed.as_str())
        }),
        "压缩后应重注入干净上下文节：{input:#?}"
    );
    // 反例：串味文本（正文混入的方括号段落）不得作为「节」出现。
    assert!(
        !input.iter().any(|it| {
            it["content"][0]["text"]
                .as_str()
                .map(|t| t.starts_with("[看这段"))
                .unwrap_or(false)
        }),
        "上下文节不得串味：{input:#?}"
    );
}

#[test]
fn loop_max_terminates_with_notice() {
    let f = Fixture::new("loopmax");
    f.write("a.md", "x\n");
    let mut config = mock_config();
    config.loop_max = 2;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    // 两轮都继续调工具（读类 allow，直执行）→ 第二轮后应触发 loop_max 提示。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]}
    ]}"#;
    let mut client = MockClient::from_str(script, "loop").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let notice = snapshot
        .messages
        .iter()
        .find(|m| m.text.as_deref().unwrap_or("").contains("工具循环上限"))
        .expect("有 loop_max 提示");
    assert!(notice.text.as_deref().unwrap().contains('2'));
    // 工具恰执行 2 次（第三轮不存在）。
    let tool_msgs = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .count();
    assert_eq!(tool_msgs, 2);
    assert_eq!(sink.types().last().unwrap(), "done");
}

#[test]
fn deny_beats_allow_and_default_layering() {
    let f = Fixture::new("deny");
    f.write("a.md", "old\n");
    let mut config = mock_config();
    // deny 一条同时命中 allow 的规则：deny 赢，不进展批准闸。
    config.permissions = HarnessPermissions {
        allow: vec!["vault_patch".into()],
        deny: vec!["vault_patch".into()],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"new\"}]}"}]},
        {"text": "好的，那我不改了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "deny").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改一下".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 无 approval_request 事件；工具消息 status=denied；磁盘未变。
    assert!(!sink.types().contains(&"approval_request".to_string()));
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("denied"));
    // 事件终态 status 必须是契约内的 "done"（细分状态放 summary，r1 P1-1）。
    let event = last_tool_call_event(&sink, "vault_patch");
    assert_eq!(event["status"], "done", "{event}");
    assert!(
        event["summary"].as_str().unwrap().contains("denied"),
        "{event}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n"
    );
}

/// ask 档的采纳 / 拒绝语义（approval gate）：默认档下仍逐个问的写工具是 `vault_delete`
/// （裁决点 1 落 B）——vault_patch / vault_create / vault_move 在 vault_write 档已免闸
/// （design §2），批准闸的载体因此换成 vault_delete。
#[test]
fn ask_gate_approve_executes_and_reject_leaves_disk() {
    for (approve, expected_disk, expected_status) in
        [(true, None, "done"), (false, Some("old\n"), "rejected")]
    {
        let f = Fixture::new(if approve { "approve" } else { "reject" });
        f.write("a.md", "old\n");
        let config = mock_config();
        let runtime = f.runtime();
        runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
        let sink = CollectSink::default();
        let script = r#"{"responses": [
            {"tool_calls": [{"id": "c1", "name": "vault_delete",
                "arguments": "{\"path\":\"a.md\"}"}]},
            {"text": "收到。"}
        ]}"#;
        let mut client = MockClient::from_str(script, "gate").unwrap();
        let worker = {
            let sink = sink.clone();
            let runtime = runtime.clone();
            let scope = f.scope();
            let config = config.clone();
            std::thread::spawn(move || {
                drive_turn(
                    &sink,
                    &runtime,
                    &scope,
                    &config,
                    "删掉 a.md".into(),
                    &mut client,
                );
            })
        };
        // 等批准请求挂出，路径预览附在事件上（vault_delete 无 diff，只有 argv 路径）。
        sink.wait_for(
            |events| {
                events
                    .iter()
                    .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
            },
            "approval_request 事件",
        );
        let request = sink
            .events()
            .into_iter()
            .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
            .unwrap();
        assert_eq!(request["tool"], "vault_delete");
        assert_eq!(request["argv"], serde_json::json!(["a.md"]));
        let id = request["id"].as_str().unwrap().to_string();
        // 面板状态里 pending_approval 可见（harness_state 形状）。
        let pending = runtime.snapshot(&f.scope(), &config).pending_approval;
        assert_eq!(pending.map(|p| p.id), Some(id.clone()));
        // 采纳 / 拒绝（拒绝带原因，随结果回送模型）。
        runtime
            .with_session(&f.scope(), |s| {
                s.resolve_approval(
                    &id,
                    approve,
                    (!approve).then(|| "先别删".to_string()),
                    false,
                )
            })
            .expect("resolve ok")
            .expect("resolve ok");
        worker.join().unwrap();

        let disk = std::fs::read_to_string(f.vault().join("a.md")).ok();
        assert_eq!(
            disk,
            expected_disk.map(str::to_string),
            "采纳⇒进废纸篓；拒绝⇒原样"
        );
        let snapshot = runtime.snapshot(&f.scope(), &config);
        let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
        assert_eq!(tool.status.as_deref(), Some(expected_status));
        // 事件终态一律 "done"（r1 P1-1）：采纳/拒绝都不发细分值，细分只在 summary。
        let event = last_tool_call_event(&sink, "vault_delete");
        assert_eq!(event["status"], "done", "{event}");
        if approve {
            assert_eq!(event["summary"], "成功", "{event}");
        } else {
            assert!(
                event["summary"].as_str().unwrap().contains("rejected"),
                "{event}"
            );
        }
        if !approve {
            // 拒绝原因随工具结果回送模型（JSONL 里 tool_result 带 approval_rejected + 原因）。
            assert!(tool.text.as_deref().unwrap().contains("approval_rejected"));
            assert!(tool.text.as_deref().unwrap().contains("先别删"));
        }
        assert!(snapshot.pending_approval.is_none(), "批准后 pending 清空");
    }
}

#[test]
fn patch_not_unique_error_feeds_back_without_gate() {
    let f = Fixture::new("notunique");
    f.write("a.md", "dup\nfoo\ndup\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    // old_string "dup" 命中 2 次：预览阶段失败 → 错误直接回送模型，不进批准闸。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"dup\",\"new_string\":\"x\"}]}"}]},
        {"text": "我换一处试试。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "notunique").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    assert!(!sink.types().contains(&"approval_request".to_string()));
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(tool.text.as_deref().unwrap().contains("patch_not_unique"));
    // 事件终态 status=done，细分 error 在 summary（r1 P1-1）。
    let event = last_tool_call_event(&sink, "vault_patch");
    assert_eq!(event["status"], "done", "{event}");
    assert!(
        event["summary"].as_str().unwrap().contains("error"),
        "{event}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "dup\nfoo\ndup\n"
    );
}

#[test]
fn create_o_excl_refuses_overwrite() {
    let f = Fixture::new("oexcl");
    f.write("a.md", "old\n");
    let mut config = mock_config();
    // allow 命中免闸，直接撞 O_EXCL。
    config.permissions = HarnessPermissions {
        allow: vec!["vault_create".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_create",
            "arguments": "{\"path\":\"a.md\",\"content\":\"new\"}"}]},
        {"text": "那我换个名字。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "oexcl").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "建 a.md".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(tool.text.as_deref().unwrap().contains("fs_already_exists"));
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n"
    );
}

#[test]
fn skill_load_rejects_escape_and_unknown() {
    let f = Fixture::new("skill");
    f.write(".agents/skills/demo/SKILL.md", "demo body");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [
            {"id": "c1", "name": "skill_load", "arguments": "{\"name\":\"../outside\"}"},
            {"id": "c2", "name": "skill_load", "arguments": "{\"name\":\"missing\"}"}
        ]},
        {"text": "两个都失败了，符合预期。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "skill").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "加载技能".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tools: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 2);
    assert!(tools[0]
        .text
        .as_deref()
        .unwrap()
        .contains("skill_name_invalid"));
    assert!(tools[1]
        .text
        .as_deref()
        .unwrap()
        .contains("skill_not_found"));
}

#[test]
fn auto_compact_triggers_over_threshold() {
    let f = Fixture::new("compact");
    let mut config = mock_config();
    config.warn_ctx_pct = 50.0;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    // 第一轮：usage 越阈值（120000/131072 ≈ 91.6%）→ 自动压缩（摘要消耗一条脚本）。
    let script = r#"{"responses": [
        {"text": "长回答。", "usage": {"input_tokens": 120000, "cached_tokens": 60000, "output_tokens": 500}},
        {"text": "会话摘要：用户问了_threshold 压缩。"},
        {"text": "压缩后继续。"}
    ]}"#;
    // 注意：阈值压缩发生在轮完成时（calls 为空），压缩后直接 break——
    // 第三条脚本是「压缩后的下一轮提问」才会用到；本轮只弹两条。
    let mut client = MockClient::from_str(script, "compact").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问个大的".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let types = sink.types();
    assert!(types.contains(&"compact".to_string()), "{types:?}");
    let compact = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("compact"))
        .unwrap();
    assert!(compact["summary"].as_str().unwrap().contains("会话摘要"));

    // 面板有 compact 消息；LLM 历史已换成摘要 + 上下文注入（不静默截断）。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    assert!(snapshot.messages.iter().any(|m| m.role == "compact"));
    // 压缩后 usage 仍是压缩前读数（下轮请求才更新）——但历史已被替换。
    // 用第二轮验证新历史生效：
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(script, "compact2").unwrap();
    // 弹掉前两条（它们是为上一轮写的）——直接快进：本轮脚本只用第三条。
    client2.complete(
        &lumir_lib::harness::llm::Request {
            system: "x".into(),
            input: vec![],
            tools: vec![],
            effort: Default::default(),
        },
        &lumir_lib::harness::llm::DiscardStreamSink,
    );
    client2.complete(
        &lumir_lib::harness::llm::Request {
            system: "x".into(),
            input: vec![],
            tools: vec![],
            effort: Default::default(),
        },
        &lumir_lib::harness::llm::DiscardStreamSink,
    );
    drive_turn(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "接着问".into(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    // user 消息 = 压缩摘要注入 + 上下文节 + 两条真实提问。
    let users: Vec<&str> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "user")
        .filter_map(|m| m.text.as_deref())
        .collect();
    assert!(users.iter().any(|t| t.contains("接着问")), "{users:?}");
}

#[test]
fn context_overflow_retries_once_after_compact() {
    let f = Fixture::new("overflow");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    // 第一条：上下文超限错误 → 自动压缩（弹第二条作摘要）→ 重试（弹第三条）成功。
    let script = r#"{"responses": [
        {"error": {"code": "context_length_exceeded", "message": "input too long"}},
        {"text": "摘要：前面在聊溢出重试。"},
        {"text": "重试成功。", "usage": {"input_tokens": 100, "cached_tokens": 50, "output_tokens": 5}}
    ]}"#;
    let mut client = MockClient::from_str(script, "overflow").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let types = sink.types();
    // 有 compact 事件 + 最终 done（重试成功，无 error 终态）。
    assert!(types.contains(&"compact".to_string()), "{types:?}");
    assert!(!types.contains(&"error".to_string()), "{types:?}");
    assert_eq!(types.last().unwrap(), "done");
    let snapshot = runtime.snapshot(&f.scope(), &config);
    assert!(snapshot
        .messages
        .iter()
        .any(|m| m.text.as_deref() == Some("重试成功。")));
}

#[test]
fn vault_scoping_switch_restore_and_reset() {
    let f = Fixture::new("scoping");
    let runtime = f.runtime();
    let config = mock_config();

    // vault A 提问一轮。
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink_a = CollectSink::default();
    let mut client = MockClient::from_str(r#"{"responses": [{"text": "A 的回答"}]}"#, "a").unwrap();
    drive_turn(
        &sink_a,
        &runtime,
        &f.scope(),
        &config,
        "A 的问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 切到 vault B（另一个根目录）：空会话、独立状态。
    let vault_b = f.root.join("vault-b");
    std::fs::create_dir_all(&vault_b).unwrap();
    let scope_b = VaultScope {
        root: vault_b.clone(),
        policy: IgnorePolicy::load(&vault_b, &[".gitignore".to_string()]),
        // 刻意与 A 共用同一个 vault 目录名：**归属判据是首行 vault_root、不是目录**——
        // 这一现场正是「文件被手工挪进别的 vault 目录」的形态（design §3）。
        vault_id: VAULT_ID.to_string(),
    };
    let snap_b = runtime.snapshot(&scope_b, &config);
    assert!(snap_b.messages.is_empty(), "B 是空会话");

    // 切回 A：会话原样恢复。
    let snap_a = runtime.snapshot(&f.scope(), &config);
    assert_eq!(snap_a.messages.len(), 2, "A 的会话还在");

    // 新会话重置：消息清空；留存是文件边界口径——旧文件封闭不再追加，
    // 下一次建立会话开新文件（首行 opened_from=reset）。
    let first_file = harness_jsonl_path(&f);
    let first_lines = std::fs::read_to_string(&first_file)
        .unwrap()
        .lines()
        .count();
    runtime.reset_session(&f.scope());
    let snap = runtime.snapshot(&f.scope(), &config);
    assert!(snap.messages.is_empty(), "重置后空态");
    // 重置后再问一轮：新文件建立（opened_from=reset），旧文件逐字节不变（封闭）。
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(r#"{"responses": [{"text": "新话题"}]}"#, "b").unwrap();
    drive_turn(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "新话题问题".into(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());
    let files = harness_jsonl_files(&f);
    assert_eq!(files.len(), 2, "重置后应有两份会话留存：{files:?}");
    assert_eq!(
        std::fs::read_to_string(&first_file)
            .unwrap()
            .lines()
            .count(),
        first_lines,
        "旧文件封闭不再追加"
    );
    // 同毫秒建立的 id 按随机段排序——按身份（≠ 旧文件）取新文件，不依赖目录序。
    let second_path = files.iter().find(|p| **p != first_file).unwrap();
    let second = read_session_file(second_path);
    assert_eq!(second.session_open["opened_from"], "reset");
    let kinds: Vec<&str> = second
        .records
        .iter()
        .skip(1)
        .map(|r| r["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, vec!["llm_request", "llm_response"], "{kinds:?}");
    // 系统上下文重新装配（新会话对象）。
    let snap = runtime.snapshot(&f.scope(), &config);
    assert_eq!(snap.messages.len(), 2);
}

/// M350 不变量：**任意会话状态下调用 new_session 均成功，结果恒为新空会话**。
/// 回归现场：面板「New session → 报错 → 再点仍报错」——旧实现用 with_session 探测 busy，
/// 无会话时被 harness_no_session 短路，而「还没有会话」恰恰是成功态。
#[test]
fn new_session_idempotent_across_session_states() {
    let f = Fixture::new("newsession");
    let runtime = f.runtime();
    let config = mock_config();

    // 1) 无会话态：平凡成功；连续两次仍成功（幂等）。
    runtime.new_session(&f.scope()).unwrap();
    runtime.new_session(&f.scope()).unwrap();
    assert!(
        runtime.snapshot(&f.scope(), &config).messages.is_empty(),
        "无会话新会话后仍是空会话"
    );
    // 同一状态（无会话）下 with_session 的语义未动：approve 等路径仍需 harness_no_session。
    // 这一条把两条路径钉开——若 new_session 退回 with_session 探 busy，上面的 unwrap 即红。
    let no_session = runtime
        .with_session(&f.scope(), |s| s.is_busy())
        .unwrap_err();
    assert_eq!(no_session.code, "harness_no_session");

    // 2) 有会话空闲态：消息历史清空。
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let mut client =
        MockClient::from_str(r#"{"responses": [{"text": "早先的回答"}]}"#, "n").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "早先的问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert!(
        !panel_roles(&f, &runtime).is_empty(),
        "提问后会话应有消息历史"
    );
    runtime.new_session(&f.scope()).unwrap();
    assert!(
        runtime.snapshot(&f.scope(), &config).messages.is_empty(),
        "新会话后消息历史清空"
    );
    // 再调一次：仍成功、仍为空。
    runtime.new_session(&f.scope()).unwrap();
    assert!(
        runtime.snapshot(&f.scope(), &config).messages.is_empty(),
        "连续新会话仍为空"
    );

    // 3) busy 态：仍是 harness_busy 错误信封（不丢在途会话）。
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let err: CommandError = runtime.new_session(&f.scope()).unwrap_err();
    assert_eq!(err.code, "harness_busy");
    // 失败无副作用：会话对象还在、仍 busy——再 acquire 照旧被拒。
    let again: CommandError = runtime
        .acquire_turn(&f.scope(), &mock_config())
        .unwrap_err();
    assert_eq!(again.code, "harness_busy", "失败的新会话不该丢掉在途会话");
    runtime.release_turn(&f.scope());
}

#[test]
fn busy_turn_rejects_second_send() {
    let f = Fixture::new("busy");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let err: CommandError = runtime
        .acquire_turn(&f.scope(), &mock_config())
        .unwrap_err();
    assert_eq!(err.code, "harness_busy");
    runtime.release_turn(&f.scope());
}

#[test]
fn unknown_tool_error_feeds_back() {
    let f = Fixture::new("unknowntool");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "fs_delete", "arguments": "{}"}]},
        {"text": "没有这个工具，算了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "unknown").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "删文件".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert!(tool.text.as_deref().unwrap().contains("tool_unknown"));
}

/// `vault_patch` 在**默认档（vault_write）免闸直执行**——这是 change
/// add-harness-permission-modes 的语义（design §2）：默认档的行为差分正是「vault 写工具免闸」。
///
/// 与只读档的对照：2026-10-09 Alex 把 `read_only` 定为 Always Ask 后，patch 在只读档**重新**
/// 进批准闸，批准窗 CAS 的整合用例随之复活（`read_only_patch_approval_window_cas_conflict`）。
/// 本用例守的是另一半：**默认档不得重新长出批准闸**（长了就变红）。
#[test]
fn vault_patch_bypasses_gate_and_writes_immediately_in_default_mode() {
    let f = Fixture::new("patch-ungated");
    f.write("a.md", "old\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
        {"text": "改好了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "patch-ungated").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改成 patched".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    assert!(
        !sink.types().contains(&"approval_request".to_string()),
        "vault_write 档 patch 不该进批准闸：{:?}",
        sink.types()
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "patched\n"
    );
    let tool = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .find(|m| m.role == "tool")
        .unwrap();
    assert_eq!(tool.status.as_deref(), Some("done"));
}

#[test]
fn cli_run_gated_and_allow_rule_executes() {
    // allow 规则：cli(echo *) 免闸直执行。
    let f = Fixture::new("cliallow");
    let mut config = mock_config();
    config.permissions = HarnessPermissions {
        allow: vec!["cli(echo *)".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"echo\",\"args\":[\"hello\"],\"purpose\":\"打个招呼\"}"}]},
        {"text": "执行完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cli").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "跑 echo".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("done"));
    assert!(tool.text.as_deref().unwrap().contains("hello"));
    // approval_request 未出现（allow 免闸）。
    assert!(!sink.types().contains(&"approval_request".to_string()));
}

/// M305 回归（下游一侧）：一轮里 output.calls 的每条调用恰好执行一次、恰好压入一对
/// function_call / function_call_output，不出现同一 call_id 重复入 input。
///
/// 重复入表的根因在 SSE 解析层（output_item.done 与 completed 双收集），已由 llm.rs 的
/// 单测钉死；MockClient 直接合成 TurnOutput 不走 SSE，所以这里钉的是 handle_call 这一侧：
/// 只要上游每条调用只给一次，input 里就不会有重复项。两条独立断言合起来覆盖整条链路。
#[test]
fn each_call_enters_input_exactly_once() {
    let f = Fixture::new("dedupe-input");
    f.write("a.md", "content\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [
            {"id": "call_1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"},
            {"id": "call_2", "name": "vault_search", "arguments": "{\"query\":\"content\"}"}
        ]},
        {"text": "读完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "dedupe").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "读".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let call_ids: Vec<String> = runtime
        .with_session(&f.scope(), |s| {
            s.input()
                .iter()
                .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("function_call"))
                .map(|item| {
                    item.get("call_id")
                        .and_then(|c| c.as_str())
                        .unwrap_or_default()
                        .to_string()
                })
                .collect()
        })
        .unwrap();
    assert_eq!(
        call_ids,
        vec!["call_1", "call_2"],
        "每条调用恰好入一次 input（无重复 call_id）"
    );

    // 工具恰好执行 2 次（面板 tool 消息数）。
    let tool_msgs = runtime
        .snapshot(&f.scope(), &mock_config())
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .count();
    assert_eq!(tool_msgs, 2);
}

// ---------------------------------------------------------------------------
// M362：思考过程呈现与思考程度（change add-harness-thinking-display-and-effort）
// ---------------------------------------------------------------------------

/// 事件类型序列（不含 done 之外的分片内容），便于逐位断言转发顺序。
fn event_types(sink: &CollectSink) -> Vec<String> {
    sink.types()
}

/// 一轮里两次 LLM 往返各产出一个思考块：分片按块序号（0、1）转发，且**思考块在正文之前**。
/// 同时核回放侧照旧（两个 reasoning 项原样入 input、各紧随其 assistant 之前）——新事件是
/// 纯输出侧增量，M306 回放路径零改动。
#[test]
fn reasoning_chunks_forwarded_in_order_with_block_index() {
    let f = Fixture::new("reasoning-blocks");
    f.write("a.md", "正文\n");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"text": "先读。",
         "reasoning_chunks": ["第一块甲", "第一块乙"],
         "reasoning": {"type":"reasoning","id":"rs_1","content":[{"type":"reasoning_text","text":"回放思考一"}]},
         "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "读完了。",
         "reasoning_chunks": ["第二块"],
         "reasoning": {"type":"reasoning","id":"rs_2","content":[{"type":"reasoning_text","text":"回放思考二"}]}}
    ]}"#;
    let mut client = MockClient::from_str(script, "reasoning-blocks").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 转发顺序逐位钉死：每轮的思考分片都在该轮正文之前；两轮各自的块序号 0 / 1。
    assert_eq!(
        event_types(&sink),
        vec![
            "reasoning_chunk",
            "reasoning_chunk",
            "text_chunk",
            "tool_call",
            "tool_call",
            "reasoning_chunk",
            "text_chunk",
            "done"
        ],
        "{:?}",
        sink.events()
    );
    let chunks: Vec<(String, u64)> = sink
        .events()
        .iter()
        .filter(|e| e["type"] == "reasoning_chunk")
        .map(|e| {
            (
                e["text"].as_str().unwrap().to_string(),
                e["index"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        chunks,
        vec![
            ("第一块甲".to_string(), 0),
            ("第一块乙".to_string(), 0),
            ("第二块".to_string(), 1),
        ],
        "同一块的多个分片共用 index，跨轮递增"
    );

    // 回放侧零改动：两个 reasoning 项都在 input 里，且各紧随其 assistant 之前。
    let kinds: Vec<String> = runtime
        .with_session(&f.scope(), |s| {
            s.input()
                .iter()
                .map(|it| {
                    it.get("type")
                        .and_then(|t| t.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| it["role"].as_str().unwrap_or("?").to_string())
                })
                .collect()
        })
        .unwrap();
    assert_eq!(
        kinds,
        vec![
            "user",
            "reasoning",
            "assistant",
            "function_call",
            "function_call_output",
            "reasoning",
            "assistant"
        ],
        "{kinds:?}"
    );
}

/// 只给回放项、不给展示分片（老 fixture / 只发 `output_item.done` 的 provider）时，
/// 展示侧退回「从回放项提取明文、整段作一个分片」——思考不丢，且密文永不进事件。
#[test]
fn reasoning_falls_back_to_captured_item_text_when_no_chunks() {
    let f = Fixture::new("reasoning-fallback");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"text": "答。",
         "reasoning": {"type":"reasoning","id":"rs_1","encrypted_content":"secret-enc",
                       "content":[{"type":"reasoning_text","text":"从回放项提取的思考"}]}}
    ]}"#;
    let mut client = MockClient::from_str(script, "reasoning-fallback").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let chunks: Vec<serde_json::Value> = sink
        .events()
        .into_iter()
        .filter(|e| e["type"] == "reasoning_chunk")
        .collect();
    assert_eq!(chunks.len(), 1, "{chunks:?}");
    assert_eq!(chunks[0]["text"], "从回放项提取的思考");
    assert_eq!(chunks[0]["index"], 0);
    // 密文不出现在事件里（一致性原则的反向半边）。
    assert!(!serde_json::to_string(&chunks)
        .unwrap()
        .contains("secret-enc"));
}

/// 反向验证（design §6 第 4 条）：fixture 不含 reasoning 时整轮零思考事件——
/// 防「恒真空转」（正观测由上面两条提供）。
#[test]
fn no_reasoning_yields_zero_reasoning_events() {
    let f = Fixture::new("reasoning-absent");
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [{"text": "没有思考的一轮。"}]}"#;
    let mut client = MockClient::from_str(script, "reasoning-absent").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(
        sink.types()
            .iter()
            .filter(|t| t.as_str() == "reasoning_chunk")
            .count(),
        0,
        "{:?}",
        sink.types()
    );
}

/// 档位链路的端到端：`Runtime::set_thinking_effort` 写会话 → `build_request` 读会话 →
/// 请求对象带着它到达 client（mock 记录入库）。这是「切档位后下一轮请求携带映射后参数」
/// 在 core 侧的机读口（真机验收断言经 `MockClient::received_efforts` 同源）。
#[test]
fn session_thinking_effort_reaches_request() {
    let f = Fixture::new("thinking-effort");
    let runtime = f.runtime();
    // 无会话时也能落档位（面板一打开就可能点 chip）——这里顺带核「即时建会话」。
    runtime
        .set_thinking_effort(&f.scope(), &mock_config(), ThinkingEffort::Max)
        .unwrap();
    assert_eq!(
        runtime.snapshot(&f.scope(), &mock_config()).thinking.level,
        ThinkingEffort::Max
    );
    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let mut client = MockClient::from_str(r#"{"responses":[{"text":"答。"}]}"#, "effort").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(client.received_efforts(), &[ThinkingEffort::Max]);
}

/// 新会话重置默认（Alex 裁决点 1：会话内生效、不写回配置、新会话回到 High）：
/// 切到 Max → 开新会话 → 快照读回 High，且下一轮请求按 High 构造。
#[test]
fn new_session_resets_thinking_effort_to_default_high() {
    let f = Fixture::new("thinking-reset");
    let runtime = f.runtime();
    runtime
        .set_thinking_effort(&f.scope(), &mock_config(), ThinkingEffort::Low)
        .unwrap();
    runtime.new_session(&f.scope()).unwrap();
    assert_eq!(
        runtime.snapshot(&f.scope(), &mock_config()).thinking.level,
        ThinkingEffort::High,
        "新会话回到默认 High"
    );

    runtime.acquire_turn(&f.scope(), &mock_config()).unwrap();
    let sink = CollectSink::default();
    let mut client = MockClient::from_str(r#"{"responses":[{"text":"答。"}]}"#, "reset").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &mock_config(),
        "问题".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(client.received_efforts(), &[ThinkingEffort::High]);
}

/// 快照的思考能力标记按 provider + model 从配置声明现算（前端 chip 置灰判据）：
/// M381 config-only——能力真源是 `[harness].providers.<id>.models` 声明（内置 preset 已
/// 彻底删除），声明什么读什么；未列出 = 不支持。mock 恒定支持。无会话的空态也要给对
/// （面板一打开即读）。
#[test]
fn snapshot_thinking_capability_follows_provider_and_model() {
    let f = Fixture::new("thinking-capability");
    let runtime = f.runtime();

    assert!(
        runtime
            .snapshot(&f.scope(), &mock_config())
            .thinking
            .supported
    );

    // kimi 侧声明清单：k3 系 effort=true、k2 系 effort=false（声明驱动，与模型名的任何
    // 内在属性无关——同一个 id 换个声明读数跟着翻，见 config.rs 单测）。
    let kimi = |model: &str| {
        let mut config = mock_config();
        config.provider = HarnessProvider::Kimi;
        config.providers.kimi.model = model.to_string();
        config.providers.kimi.models = vec![
            HarnessModelSpec {
                id: "kimi-k3".into(),
                effort: true,
                window: 1_048_576,
            },
            HarnessModelSpec {
                id: "kimi-k2.6".into(),
                effort: false,
                window: 262_144,
            },
            HarnessModelSpec {
                id: "kimi-k2.7-code".into(),
                effort: false,
                window: 262_144,
            },
            HarnessModelSpec {
                id: "kimi-k2".into(),
                effort: false,
                window: 131_072,
            },
        ];
        config
    };
    // 声明支持 ⇒ 快照支持。
    assert!(
        runtime
            .snapshot(&f.scope(), &kimi("kimi-k3"))
            .thinking
            .supported
    );
    // 声明不支持 ⇒ 前端置灰；未列出的 id（kimi-k30、复合 id）同判不支持。
    for model in [
        "kimi-k2.6",
        "kimi-k2.7-code",
        "kimi-k2",
        "kimi-k30",
        "kimi-code/k3-256k",
    ] {
        let snapshot = runtime.snapshot(&f.scope(), &kimi(model));
        assert!(!snapshot.thinking.supported, "{model} 应标记不支持");
        // 能力与档位分开：不支持时档位读数仍是默认 High（前端 chip 显示读数 + 置灰）。
        assert_eq!(snapshot.thinking.level, ThinkingEffort::High, "{model}");
    }
    // 空清单（config-only 缺省形态）：任何模型都不支持。
    let mut empty = mock_config();
    empty.provider = HarnessProvider::Kimi;
    assert!(!runtime.snapshot(&f.scope(), &empty).thinking.supported);
}

// ---------------------------------------------------------------------------
// 三档权限模式 + cli_run 分类闸门（change add-harness-permission-modes，M407）
// ---------------------------------------------------------------------------

/// 判定矩阵的三档 × 五类调用面（design §2）走**判定管线**逐格核验（mock provider 的整链路
/// 只覆盖代表性几格，逐格矩阵在 `permissions.rs` 单测里；这条额外钉一件事：**模式来自配置**，
/// 运行时真的读它——config 字段接不上判定管线时本用例必红）。
///
/// 只读档按 2026-10-09 Alex 裁决的 **Always Ask** 语义（design §2 修订）：vault_patch 进批准闸、
/// 拒绝后磁盘不变；vault_write / full_access 两档免闸直执行。用例对只读档的那一格**拒绝**掉，
/// 从而额外钉住「批准闸挂了、拒绝生效」这条链。
#[test]
fn permission_mode_is_read_from_config_per_call_face() {
    use lumir_lib::config::PermissionMode;

    let f = Fixture::new("mode-matrix");
    f.write("a.md", "old\n");
    let runtime = f.runtime();

    for (mode, expect_gate, expect_status, expect_disk) in [
        (PermissionMode::ReadOnly, true, "rejected", "old\n"),
        (PermissionMode::VaultWrite, false, "done", "new\n"),
        (PermissionMode::FullAccess, false, "done", "new\n"),
    ] {
        f.write("a.md", "old\n");
        let mut config = mock_config();
        config.permission_mode = mode;
        runtime.acquire_turn(&f.scope(), &config).unwrap();
        let sink = CollectSink::default();
        let script = r#"{"responses": [
            {"tool_calls": [{"id": "c1", "name": "vault_patch",
                "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"new\"}]}"}]},
            {"text": "好。"}
        ]}"#;
        let mut client = MockClient::from_str(script, "mode-matrix").unwrap();
        if expect_gate {
            // 只读档要等批准：在工作线程里跑轮次，主线程挂起-拒绝。
            let worker = {
                let sink = sink.clone();
                let runtime = runtime.clone();
                let scope = f.scope();
                let config = config.clone();
                std::thread::spawn(move || {
                    drive_turn(
                        &sink,
                        &runtime,
                        &scope,
                        &config,
                        "改一下".into(),
                        &mut client,
                    );
                })
            };
            sink.wait_for(
                |events| {
                    events
                        .iter()
                        .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
                },
                "只读档的批准请求",
            );
            let id = sink
                .events()
                .into_iter()
                .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
                .and_then(|e| e["id"].as_str().map(str::to_string))
                .expect("批准请求 id");
            runtime
                .with_session(&f.scope(), |s| {
                    s.resolve_approval(&id, false, Some("先别改".into()), false)
                })
                .unwrap()
                .unwrap();
            worker.join().unwrap();
        } else {
            drive_turn(
                &sink,
                &runtime,
                &f.scope(),
                &config,
                "改一下".into(),
                &mut client,
            );
        }
        runtime.release_turn(&f.scope());

        assert_eq!(
            sink.types().contains(&"approval_request".to_string()),
            expect_gate,
            "{mode:?} 的批准闸与否"
        );
        let tool = runtime
            .snapshot(&f.scope(), &config)
            .messages
            .into_iter()
            .rev()
            .find(|m| m.role == "tool")
            .unwrap();
        assert_eq!(tool.status.as_deref(), Some(expect_status), "{mode:?}");
        assert_eq!(
            std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
            expect_disk,
            "{mode:?} 的落盘结果"
        );
    }
}

/// 只读档重新拥有批准闸 ⇒ `vault_patch` 的**批准窗 CAS** 在整合层复活（M407 r1 时该路径因
/// 三档全不 gate 而不可达；Alex 2026-10-09 把 read_only 改成 Always Ask 后又可达）。
///
/// 场景（原 `patch_conflict_when_file_changes_during_approval`）：批准窗内文件被外部修改，
/// old_string 在新内容里仍唯一命中——若无 CAS 基准，patch 会静默应用到新内容上。采纳执行必须
/// 以预览基准 revision 走 CAS，变了就 `document_conflict` 回送模型，落盘不与已批准 diff 分叉。
#[test]
fn read_only_patch_approval_window_cas_conflict() {
    use lumir_lib::config::PermissionMode;

    let f = Fixture::new("approval-cas");
    f.write("a.md", "old\n");
    let mut config = mock_config();
    config.permission_mode = PermissionMode::ReadOnly;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
        {"text": "文件被改了，我需要重新生成 diff。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cas").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "改成 patched".into(),
                &mut client,
            );
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "approval_request 事件",
    );
    // 批准卡在只读档也带 diff 预览（写工具的预览不因档位而变）。
    let request = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .unwrap();
    let diff = request["diff"].as_str().expect("patch 附 diff 预览");
    assert!(diff.contains("-old") && diff.contains("+patched"), "{diff}");
    // 批准窗内：文件被外部修改。
    std::fs::write(f.vault().join("a.md"), "old\n用户手改的一行\n").unwrap();
    let id = request["id"].as_str().unwrap().to_string();
    runtime
        .with_session(&f.scope(), |s| s.resolve_approval(&id, true, None, false))
        .expect("resolve ok")
        .expect("resolve ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 结果：document_conflict 回送模型；磁盘保持用户改后的内容（无分叉、无覆盖）。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tool = snapshot.messages.iter().find(|m| m.role == "tool").unwrap();
    assert_eq!(tool.status.as_deref(), Some("error"));
    assert!(
        tool.text.as_deref().unwrap().contains("document_conflict"),
        "{}",
        tool.text.as_deref().unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("a.md")).unwrap(),
        "old\n用户手改的一行\n"
    );
}

/// purpose 链（design §3.4 + 5.1 任务）：
/// ① 缺 purpose 的 cli_run **不执行**、回送补填错误（`cli_purpose_missing`），模型补填后重发成功；
/// ② 粉饰性 purpose 不改变判定——黑名单命令（`rm`）在任何档都进批准闸，purpose 只影响阅读。
#[test]
fn cli_purpose_required_and_never_widens_permission() {
    let f = Fixture::new("purpose");
    let mut config = mock_config();
    // allow 规则让 echo 免闸：这样「缺 purpose 被拒」只可能来自 purpose 校验，不是权限层。
    config.permissions = HarnessPermissions {
        allow: vec!["cli(echo *)".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    // 第 1 轮：缺 purpose（同一条命令，若放行会直执行）⇒ 拒；第 2 轮：补填后重发 ⇒ 执行。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"echo\",\"args\":[\"hello\"]}"}]},
        {"tool_calls": [{"id": "c2", "name": "cli_run",
            "arguments": "{\"command\":\"echo\",\"args\":[\"hello\"],\"purpose\":\"打印一句问候\"}"}]},
        {"text": "完成。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "purpose").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "跑 echo".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let tools: Vec<_> = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 2, "两次调用各一条工具行：{tools:?}");
    let first = &tools[0];
    assert_eq!(first.status.as_deref(), Some("error"));
    assert!(
        first
            .text
            .as_deref()
            .unwrap()
            .contains("cli_purpose_missing"),
        "{first:?}"
    );
    assert!(
        first.text.as_deref().unwrap().contains("purpose"),
        "{first:?}"
    );
    let second = &tools[1];
    assert_eq!(second.status.as_deref(), Some("done"), "{second:?}");
    assert!(
        second.text.as_deref().unwrap().contains("hello"),
        "{second:?}"
    );
    // allow 规则生效路径上没出现过批准闸。
    assert!(!sink.types().contains(&"approval_request".to_string()));

    // ② 粉饰性 purpose 不放宽任何判定：黑名单命令在 allow 规则 + vault_write 档下仍进批准闸。
    let mut deny_config = mock_config();
    deny_config.permissions = HarnessPermissions {
        allow: vec!["cli(rm *)".into()],
        deny: vec![],
    };
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &deny_config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"rm\",\"args\":[\"-rf\",\"/tmp/lumir-m407-none\"] ,\"purpose\":\"清理临时文件（无害）\"}"}]},
        {"text": "算了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "purpose-black").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = deny_config.clone();
        std::thread::spawn(move || {
            drive_turn(&sink, &runtime, &scope, &config, "清理".into(), &mut client);
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "黑名单命令的 approved 请求",
    );
    // 拒绝掉，让本轮收口（黑名单命令绝不能被 purpose 放行）。
    let id = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .and_then(|e| e["id"].as_str().map(str::to_string))
        .expect("有批准请求 id");
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&id, false, Some("不许删".into()), false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
}

/// purpose 链的第二半（tasks 6.8）：「带 purpose 的调用在批准卡载荷中 purpose 与命令同达」——
/// 载荷同时含完整 argv（命令原文不被替代）与 purpose 句。
#[test]
fn cli_purpose_reaches_approval_card_payload_with_full_command() {
    let f = Fixture::new("purpose-payload");
    let config = mock_config(); // vault_write 档：写命令逐个问
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"npm\",\"args\":[\"install\",\"--save\",\"lodash\"],\"purpose\":\"装一个依赖\"}"}]},
        {"text": "算了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "purpose-payload").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "装依赖".into(),
                &mut client,
            );
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "cli_run 的批准请求",
    );
    let request = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .unwrap();
    assert_eq!(request["tool"], "cli_run");
    assert_eq!(request["purpose"], "装一个依赖");
    // 命令原文完整在场（不被 purpose 替代或截断）。
    assert_eq!(
        request["argv"],
        serde_json::json!(["npm", "install", "--save", "lodash"])
    );
    let id = request["id"].as_str().unwrap().to_string();
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&id, false, Some("先不装".into()), false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
}

/// 重定向链（design §4.3）：cli_run 写 vault 内目标 ⇒ 收到固定标记的结构化拒绝 ⇒ 模型下一轮
/// 改调 vault_move ⇒ 按 vault_write 档放行 ⇒ vault 终态正确。闸门不做自动翻译，重试全靠模型。
#[test]
fn cli_write_into_vault_redirects_to_vault_tool() {
    let f = Fixture::new("redirect");
    f.write("notes/a.md", "正文\n");
    let config = mock_config(); // 默认档 vault_write
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"mv\",\"args\":[\"notes/a.md\",\"notes/b.md\"],\"purpose\":\"把笔记改名\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_move",
            "arguments": "{\"path\":\"notes/a.md\",\"new_path\":\"notes/b.md\"}"}]},
        {"text": "换工具做完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "redirect").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "改名".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let tools: Vec<_> = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .filter(|m| m.role == "tool")
        .collect();
    let cli_row = tools
        .iter()
        .find(|m| m.name.as_deref() == Some("cli_run"))
        .expect("cli_run 工具行");
    // 工具行正文是结果信封的 JSON 串：解析出来再看 message 原文（信封里的引号是转义过的）。
    let envelope: serde_json::Value =
        serde_json::from_str(cli_row.text.as_deref().unwrap()).expect("结果信封是 JSON");
    assert_eq!(envelope["code"], "cli_redirected_to_vault_tool");
    let text = envelope["message"].as_str().unwrap();
    assert!(
        text.contains("<<<LUMIR_REDIRECT_VAULT_TOOL>>>"),
        "固定标记必须逐字在场：{text}"
    );
    assert!(
        text.contains("<<<END_LUMIR_REDIRECT_VAULT_TOOL>>>"),
        "{text}"
    );
    assert!(
        text.contains(r#""suggested_tool":"vault_move""#),
        "载荷建议工具：{text}"
    );
    assert!(
        text.contains(r#""targets":["notes/a.md","notes/b.md"]"#),
        "载荷列出全部 vault 内写目标：{text}"
    );
    // 重定向不执行任何东西（文件没动），也不进批准闸。
    assert!(!sink.types().contains(&"approval_request".to_string()));
    // 模型改用的 vault_move 生效：终态正确。
    let move_row = tools
        .iter()
        .find(|m| m.name.as_deref() == Some("vault_move"))
        .expect("vault_move 工具行");
    assert_eq!(move_row.status.as_deref(), Some("done"), "{move_row:?}");
    assert!(!f.vault().join("notes/a.md").exists());
    assert_eq!(
        std::fs::read_to_string(f.vault().join("notes/b.md")).unwrap(),
        "正文\n"
    );
}

/// vault_delete（design §5.1/§5.3）：vault_write 档仍逐个问（裁决点 1 落 B）、批准预览带路径；
/// 批准后条目进废纸篓（vault 内消失）。工具集里**没有永久删除路径**（底层只有 trash_entry）。
#[test]
fn vault_delete_asks_in_vault_write_and_trashes_on_approve() {
    let f = Fixture::new("vault-delete");
    f.write("notes/a.md", "要删的\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_delete",
            "arguments": "{\"path\":\"notes/a.md\"}"}]},
        {"text": "删掉了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "vault-delete").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "删掉 a.md".into(),
                &mut client,
            );
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "vault_delete 的批准请求",
    );
    let request = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .unwrap();
    assert_eq!(request["tool"], "vault_delete");
    // 批准预览带路径（面板据此显示「路径 + 移入废纸篓可恢复」）。
    assert_eq!(request["argv"], serde_json::json!(["notes/a.md"]));
    let id = request["id"].as_str().unwrap().to_string();
    runtime
        .with_session(&f.scope(), |s| s.resolve_approval(&id, true, None, false))
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    assert!(!f.vault().join("notes/a.md").exists(), "批准后进废纸篓");
}

/// 会话内批准缓存（design §6）：命中即第 5 层短路（同一 `(工具, 主体串)` 不再问）；
/// 三层模式无关的判定永远先于缓存（黑名单不受缓存放行）。
///
/// 本条直接按运行时命名空间写缓存，钉的是「写进去之后判定管线确实会免问」这条语义；
/// 写入 transport 本身（harness_approve 的 remember → gated_execute）由
/// `approval_remember_writes_cache_and_decision_visible` 承担。
#[test]
fn session_approval_cache_skips_gate_for_same_subject_only() {
    use lumir_lib::harness::permission_cache;

    let f = Fixture::new("cache");
    f.write("notes/a.md", "一\n");
    f.write("notes/b.md", "二\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    // 命名空间 = (vault 根, 会话 id)——与 turn.rs 的取法同源（留存文件名的 id 段）。
    let namespace = runtime
        .with_session(&f.scope(), |s| {
            let id = lumir_lib::harness::jsonl::JsonlWriter::session_id_from_path(s.jsonl().path())
                .expect("会话 id");
            permission_cache::Namespace::new(f.scope().key(), id)
        })
        .unwrap();
    permission_cache::remember(&namespace, "vault_delete", "notes/a.md");

    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_delete",
            "arguments": "{\"path\":\"notes/a.md\"}"}]},
        {"text": "删掉了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cache-hit").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "删 a.md".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    // 命中缓存 ⇒ vault_delete 不问（vault_write 档本来要问）且直接执行。
    assert!(
        !sink.types().contains(&"approval_request".to_string()),
        "缓存命中不该再问：{:?}",
        sink.types()
    );
    assert!(!f.vault().join("notes/a.md").exists());

    // 另一主体串（b.md）不受影响，仍逐个问。
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_delete",
            "arguments": "{\"path\":\"notes/b.md\"}"}]},
        {"text": "好。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cache-miss").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "删 b.md".into(),
                &mut client,
            );
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "未缓存主体串仍要问",
    );
    let id = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .and_then(|e| e["id"].as_str().map(str::to_string))
        .unwrap();
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&id, false, Some("先留着".into()), false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 黑名单成员即使被缓存也不放行（第 3 层先于缓存）——用 cli_run 的 rm 写一条缓存再调用。
    let mut config2 = mock_config();
    config2.permissions = HarnessPermissions {
        allow: vec![],
        deny: vec![],
    };
    runtime.acquire_turn(&f.scope(), &config2).unwrap();
    permission_cache::remember(&namespace, "cli_run", "rm -rf /tmp/lumir-m407-cache");
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"rm\",\"args\":[\"-rf\",\"/tmp/lumir-m407-cache\"],\"purpose\":\"清理\"}"}]},
        {"text": "好。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "cache-black").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config2.clone();
        std::thread::spawn(move || {
            drive_turn(&sink, &runtime, &scope, &config, "清理".into(), &mut client);
        })
    };
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "黑名单命令不受缓存影响",
    );
    let id = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .and_then(|e| e["id"].as_str().map(str::to_string))
        .unwrap();
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&id, false, Some("不许".into()), false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
}

/// 「采纳且本会话不再问」transport 整合用例（tasks 4.2 前半句的后端半边，M413）：
/// 批准时 remember=true ⇒ `(工具, 主体串)` 写入会话内批准缓存，同会话同主体串后续调用免闸；
/// 工具行 decision 字段如实带 approved / rejected，批准卡事件与快照带 purpose 与 remember。
#[test]
fn approval_remember_writes_cache_and_decision_visible() {
    use lumir_lib::harness::permission_cache;

    let f = Fixture::new("remember");
    f.write("a.md", "一\n");
    f.write("b.md", "二\n");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_delete",
            "arguments": "{\"path\":\"a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_delete",
            "arguments": "{\"path\":\"b.md\"}"}]},
        {"text": "收到。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "remember").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(
                &sink,
                &runtime,
                &scope,
                &config,
                "删掉这两个文件".into(),
                &mut client,
            );
        })
    };
    // 第一张批准卡（a.md）：采纳且本会话不再问。
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "第一张批准卡",
    );
    let first = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .unwrap();
    assert_eq!(first["tool"], "vault_delete");
    assert_eq!(first["argv"], serde_json::json!(["a.md"]));
    let first_id = first["id"].as_str().unwrap().to_string();
    // 快照镜像：purpose 缺席（非 cli_run）、remember 恒 true（次级动作可见性）。
    let pending = runtime
        .snapshot(&f.scope(), &config)
        .pending_approval
        .expect("第一张卡在快照里");
    assert_eq!(pending.id, first_id);
    assert!(pending.purpose.is_none());
    assert!(pending.remember, "批准闸请求恒支持 remember 次级动作");

    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&first_id, true, None, true)
        })
        .unwrap()
        .unwrap();
    // 第二张批准卡（b.md）：普通采纳（remember=false）——b.md 不得被记住。
    sink.wait_for(
        |events| {
            events
                .iter()
                .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
                .count()
                >= 2
        },
        "第二张批准卡",
    );
    let second = sink
        .events()
        .into_iter()
        .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .nth(1)
        .unwrap();
    let second_id = second["id"].as_str().unwrap().to_string();
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&second_id, true, None, false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    // 两张卡都采纳执行（a.md / b.md 都进废纸篓）。
    assert!(!f.vault().join("a.md").exists());
    assert!(!f.vault().join("b.md").exists());

    // 工具行 decision：approved（两张卡都过闸采纳）；allow 路径无 decision 的反面由
    // harness.rs 单测 restored_tool_decision_backfilled_from_approval_sidecars 承担。
    let snapshot = runtime.snapshot(&f.scope(), &config);
    let tools: Vec<_> = snapshot
        .messages
        .iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].decision.as_deref(), Some("approved"));
    assert_eq!(tools[1].decision.as_deref(), Some("approved"));

    // 会话内批准缓存只记了 remember=true 的那条：a.md 免闸、b.md 仍问。
    let namespace = runtime
        .with_session(&f.scope(), |s| {
            let id = lumir_lib::harness::jsonl::JsonlWriter::session_id_from_path(s.jsonl().path())
                .expect("会话 id");
            permission_cache::Namespace::new(f.scope().key(), id)
        })
        .unwrap();
    assert!(permission_cache::is_remembered(
        &namespace,
        "vault_delete",
        "a.md"
    ));
    assert!(
        !permission_cache::is_remembered(&namespace, "vault_delete", "b.md"),
        "普通采纳 MUST NOT 记缓存"
    );

    // a.md 同主体串再调：缓存命中 ⇒ 免闸直执行（无第二张批准卡）。
    // 注：与既有 cache 用例同口径——判定前显式重写一次缓存键（并行用例的命名空间
    // 整表互换可能清掉本表的中间态；重写的是同一条记忆，语义等价）。
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let namespace = runtime
        .with_session(&f.scope(), |s| {
            let id = lumir_lib::harness::jsonl::JsonlWriter::session_id_from_path(s.jsonl().path())
                .expect("会话 id");
            permission_cache::Namespace::new(f.scope().key(), id)
        })
        .unwrap();
    permission_cache::remember(&namespace, "vault_delete", "a.md");
    f.write("a.md", "三\n");
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c3", "name": "vault_delete",
            "arguments": "{\"path\":\"a.md\"}"}]},
        {"text": "好。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "remember-hit").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "再删一次".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert!(
        !sink.types().contains(&"approval_request".to_string()),
        "缓存命中不该再问：{:?}",
        sink.types()
    );
    assert!(!f.vault().join("a.md").exists());
    permission_cache::clear();
}

/// 黑名单 wrapper 递归的整合用例（backlog 2026-10-10 Alex 裁决「堵」）：full_access 档下
/// `sudo rm` 仍进批准闸（自动放行被黑名单递归层拦住）；`sudo ls` 不误伤（只读放行）。
#[test]
fn wrapper_recursion_gates_sudo_rm_in_full_access() {
    let f = Fixture::new("wrapper-sudo");
    let mut config = mock_config();
    config.permission_mode = lumir_lib::config::PermissionMode::FullAccess;
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "cli_run",
            "arguments": "{\"command\":\"sudo\",\"args\":[\"rm\",\"-rf\",\"/tmp/lumir-m413-none\"],\"purpose\":\"清理临时目录\"}"}]},
        {"text": "好。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "wrapper-sudo").unwrap();
    let worker = {
        let sink = sink.clone();
        let runtime = runtime.clone();
        let scope = f.scope();
        let config = config.clone();
        std::thread::spawn(move || {
            drive_turn(&sink, &runtime, &scope, &config, "清理".into(), &mut client);
        })
    };
    // full_access 档：裸 rm 本免闸，sudo rm 必须仍问（裁决「堵」的判据）。
    sink.wait_for(
        |events| {
            events
                .iter()
                .any(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        },
        "sudo rm 在 full_access 档仍进批准闸",
    );
    let id = sink
        .events()
        .into_iter()
        .find(|e| e.get("type").and_then(|t| t.as_str()) == Some("approval_request"))
        .and_then(|e| e["id"].as_str().map(str::to_string))
        .unwrap();
    runtime
        .with_session(&f.scope(), |s| {
            s.resolve_approval(&id, false, Some("不许".into()), false)
        })
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    runtime.release_turn(&f.scope());
    let tool = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .find(|m| m.role == "tool")
        .unwrap();
    assert_eq!(tool.status.as_deref(), Some("rejected"));
    assert_eq!(tool.decision.as_deref(), Some("rejected"));

    // sudo ls：ReadOnly 分类，full_access（与任何档）直接放行——不误伤。
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c2", "name": "cli_run",
            "arguments": "{\"command\":\"sudo\",\"args\":[\"ls\",\"-la\"],\"purpose\":\"看一下目录\"}"}]},
        {"text": "列完了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "wrapper-sudo-ls").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "列目录".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert!(
        !sink.types().contains(&"approval_request".to_string()),
        "sudo ls 不得误伤：{:?}",
        sink.types()
    );
    let tools: Vec<_> = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .filter(|m| m.role == "tool")
        .collect();
    assert_eq!(tools.len(), 2, "两轮各一条工具行");
    let tool = &tools[1];
    assert_eq!(tool.status.as_deref(), Some("done"));
    assert_eq!(tool.decision, None, "免闸路径没有批准决定");
}

/// vault_move 工具（design §5.1）：跨目录移动成立（目标父目录已存在）+ 撞名不覆盖
/// （源与既有目标都逐字节不变）+ 目标父目录不存在时回 `fs_not_found`。
#[test]
fn vault_move_executes_and_refuses_overwrite() {
    let f = Fixture::new("vault-move");
    f.write("a.md", "A\n");
    f.write("b.md", "B\n");
    f.write("sub/keep.md", "k\n");
    let config = mock_config(); // vault_write 档：vault_move 免闸
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_move",
            "arguments": "{\"path\":\"a.md\",\"new_path\":\"sub/a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_move",
            "arguments": "{\"path\":\"b.md\",\"new_path\":\"sub/a.md\"}"}]},
        {"tool_calls": [{"id": "c3", "name": "vault_move",
            "arguments": "{\"path\":\"b.md\",\"new_path\":\"missing/a.md\"}"}]},
        {"text": "好。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "vault-move").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "挪一下".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    // 第一次跨目录移动成立。
    assert!(!f.vault().join("a.md").exists());
    assert_eq!(
        std::fs::read_to_string(f.vault().join("sub/a.md")).unwrap(),
        "A\n"
    );
    let tools: Vec<_> = runtime
        .snapshot(&f.scope(), &config)
        .messages
        .into_iter()
        .filter(|m| m.role == "tool" && m.name.as_deref() == Some("vault_move"))
        .collect();
    assert_eq!(tools.len(), 3, "{tools:?}");
    assert_eq!(tools[0].status.as_deref(), Some("done"), "{tools:?}");
    // 第二次撞名 ⇒ fs_already_exists，且既有目标与源都逐字节不变。
    assert!(
        tools[1]
            .text
            .as_deref()
            .unwrap()
            .contains("fs_already_exists"),
        "{tools:?}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("sub/a.md")).unwrap(),
        "A\n"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("b.md")).unwrap(),
        "B\n"
    );
    // 第三次目标父目录不存在 ⇒ fs_not_found（不隐式建目录）。
    assert!(
        tools[2].text.as_deref().unwrap().contains("fs_not_found"),
        "{tools:?}"
    );
    assert_eq!(
        std::fs::read_to_string(f.vault().join("b.md")).unwrap(),
        "B\n"
    );
}

/// vault_create 自动建父目录（M405 修订的 mkdir -p 语义）在工具链路上成立：
/// 模型直接写 `drafts/notes/x.md` 即可，不必先建目录。
#[test]
fn vault_create_auto_creates_parent_dirs_through_tool_chain() {
    let f = Fixture::new("create-parents");
    let config = mock_config();
    let runtime = f.runtime();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_create",
            "arguments": "{\"path\":\"drafts/notes/x.md\",\"content\":\"新稿\"}"}]},
        {"text": "建好了。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "create-parents").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "新建".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(
        std::fs::read_to_string(f.vault().join("drafts/notes/x.md")).unwrap(),
        "新稿"
    );
}
