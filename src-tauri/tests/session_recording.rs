//! wire 形态会话留存的验收测试（change reshape-harness-session-recording）：
//! 记录形状（首行 session_open / 请求-响应成对 / 思考落盘 / 装配清单）、
//! **恢复充分性属性测试**（仅凭 JSONL 逐字节重建任意一轮发给模型的请求，含反向验证）、
//! 恢复命令 roundtrip（灌回 system + input、续写新文件）、文件边界（重置 / 压缩）、
//! sidecar 决策类收口（approval / llm_error / loop_max_reached 在列，11 类旧 kind 绝迹）。
//!
//! 环境隔离与 harness_runtime.rs 同口径：XDG_CONFIG_HOME + HOME 指向临时目录，
//! 多测串行（静态锁，env 是进程全局；REVIEW.md 第 13 条）。

use lumir_lib::config::{HarnessConfig, HarnessPermissions, HarnessProvider};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::jsonl;
use lumir_lib::harness::llm::{self, LlmClient, MockClient};
use lumir_lib::harness::session;
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
            std::env::temp_dir().join(format!("lumir-rsr-it-{}-{}", name, std::process::id()));
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
        }
    }

    fn write(&self, rel: &str, content: &str) {
        let path = self.vault().join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    /// 列出留存的全部会话文件（按文件名排序 = 建立顺序，session id 时间序）。
    fn session_files(&self) -> Vec<PathBuf> {
        let dir = self.root.join("xdg/lumir/harness/sessions");
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("读留存目录 {} 失败：{e}", dir.display()))
            .map(|entry| entry.unwrap().path())
            .filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
            .collect();
        files.sort();
        files
    }

    fn read(&self, path: &Path) -> jsonl::SessionFile {
        jsonl::read_session_file(path).expect("留存可解析")
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

fn mock_config() -> HarnessConfig {
    HarnessConfig {
        provider: HarnessProvider::Mock,
        ..Default::default()
    }
}

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

/// 一轮含 `<quote>` 引用消息 + 两个思考块（kimi encrypted_content 形 + deepseek
/// reasoning_text parts 形，各一轮）+ 一次工具循环的工具调用。fixture 全部合成。
fn quote_and_thinking_script() -> &'static str {
    r#"{"responses": [
        {"text": "先读文件。",
         "reasoning": {"type":"reasoning","id":"rs_1","status":"completed",
                       "content":[{"type":"reasoning_text","text":"需要先读 a.md。"}],
                       "encrypted_content":"resp-0"},
         "tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}],
         "usage": {"input_tokens": 100, "cached_tokens": 40, "output_tokens": 5}},
        {"text": "读完了。",
         "reasoning": {"type":"reasoning","id":"rs_2",
                       "content":[{"type":"reasoning_text","text":"读完确认无误。"}]},
         "usage": {"input_tokens": 200, "cached_tokens": 100, "output_tokens": 5}}
    ]}"#
}

/// 与 M342 单测同形的合成引用消息（serializeQuoteMessage 的产物）：属性值含 XML 保留字符。
const QUOTE_MESSAGE: &str = "<quote file=\"reading-workflow.md\" heading=\"筛选 &amp; 排序\" lines=\"9-10\">先读结论 &lt;再读论证&gt;</quote>\n这段是什么意思？";

/// 跑一轮「引用 + 思考 + 工具循环」的标准回合，返回（夹具, 留存文件路径）。
fn run_quote_turn(name: &str) -> (Fixture, PathBuf) {
    let f = Fixture::new(name);
    f.write("a.md", "demo body\n");
    let config = mock_config();
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let mut client = MockClient::from_str(quote_and_thinking_script(), "quote-thinking").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        QUOTE_MESSAGE.to_string(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    assert_eq!(sink.0.lock().unwrap().last().unwrap()["type"], "done");
    let files = f.session_files();
    assert_eq!(files.len(), 1, "应恰有一份会话留存：{files:?}");
    (f, files[0].clone())
}

/// 从留存记录里取「会话轮次」的 llm_request / llm_response 对（design §3 不变量 2、
/// 不变量 4 的判定口径）：压缩调用是内部汇总调用（system 是压缩指令），按
/// `request.system == session_open.system` 排除。
fn conversation_pairs(file: &jsonl::SessionFile) -> Vec<(&serde_json::Value, &serde_json::Value)> {
    let system = file.session_open["system"].as_str().unwrap();
    let mut pairs = Vec::new();
    let mut pending_request: Option<&serde_json::Value> = None;
    for record in file.records.iter().skip(1) {
        match record["kind"].as_str().unwrap_or("") {
            "llm_request" => {
                assert!(
                    pending_request.is_none(),
                    "llm_request 未配对（前一条请求缺响应）：{record}"
                );
                if record["request"]["system"].as_str() == Some(system) {
                    pending_request = Some(record);
                }
            }
            "llm_response" => {
                if let Some(request) = pending_request.take() {
                    pairs.push((request, record));
                }
                // 压缩响应没有对应的会话轮次请求（pending 为 None），如实跳过。
            }
            // sidecar 决策类记录不参与配对。
            _ => {}
        }
    }
    assert!(
        pending_request.is_none(),
        "末条 llm_request 缺响应：{pending_request:?}"
    );
    pairs
}

/// 恢复充分性（design §5 核心判据，任务 2.1）：仅凭 JSONL 逐字节重建任意一轮发给
/// 模型的请求。返回 Err(原因) 而非 panic，供反向验证（手改重建结果必红）使用。
///
/// 重建链：request[i+1].messages 必须是 request[i].messages 的**逐字节前缀延伸**——
/// 延伸段 = 第 i 个响应经回放构造器产出的项（assistant 消息按 M372 空正文跳过 +
/// reasoning 回放项原样在前（M306））+ function_call 项（M360 成组）+
/// function_call_output 项（输出文本是模型**输入**数据，只在 wire 的下一条请求里
/// 在场——校验其 call_id 与调用同序配对，而不从响应重建）。用户消息同理只在
/// request[0].messages 在场。逐字节性：所有比较走 serde_json::Value 相等
/// （= JSON 线格式逐字节，键序由序列化器钉死）。
fn check_recovery_sufficient(path: &Path) -> Result<(), String> {
    let file = jsonl::read_session_file(path).map_err(|e| e.message)?;
    // 不变量 1：首行 session_open（read_session_file 已钉）+ session_id 一致。
    let open = &file.session_open;
    let system = open["system"]
        .as_str()
        .ok_or("session_open 缺 system")?
        .to_string();
    // 不变量 2：请求-响应严格交替成对（含压缩调用——它们同样必须成对）。
    let mut expect_response = false;
    for record in file.records.iter().skip(1) {
        let kind = record["kind"].as_str().unwrap_or("");
        match kind {
            "llm_request" => {
                if expect_response {
                    return Err("两条 llm_request 连续出现（请求-响应未成对）".into());
                }
                expect_response = true;
            }
            "llm_response" => {
                if !expect_response {
                    return Err("llm_response 没有对应的 llm_request".into());
                }
                expect_response = false;
            }
            _ => {}
        }
    }
    if expect_response {
        return Err("末条 llm_request 缺 llm_response".into());
    }
    let pairs = conversation_pairs(&file);
    if pairs.is_empty() {
        return Err("没有会话轮次请求可重建".into());
    }
    // 不变量 4：会话轮次请求体的 system 与首行 session_open.system 逐字节一致。
    for (request, _) in &pairs {
        if request["request"]["system"].as_str() != Some(system.as_str()) {
            return Err("llm_request.system 与会话 system 不一致".into());
        }
    }
    // 重建链：前缀延伸 + 响应回放项一致性（不变量 3 的机器可检形态）。
    for i in 0..pairs.len() {
        let (request, response) = pairs[i];
        let messages = request["request"]["messages"]
            .as_array()
            .ok_or("llm_request 缺 messages")?;
        // system 必须能从 session_open 重建（此处即逐字节一致断言）。
        if i + 1 < pairs.len() {
            let (next_request, _) = pairs[i + 1];
            let next = next_request["request"]["messages"]
                .as_array()
                .ok_or("下一条 llm_request 缺 messages")?;
            if next.len() <= messages.len() {
                return Err(format!(
                    "历史未增长：第 {} 轮 {} 条 → 第 {} 轮 {} 条",
                    i,
                    messages.len(),
                    i + 1,
                    next.len()
                ));
            }
            // 前缀逐字节一致。
            for (index, item) in messages.iter().enumerate() {
                if next[index] != *item {
                    return Err(format!(
                        "历史接续不一致：第 {i} 轮第 {index} 项在下一条请求里变了"
                    ));
                }
            }
            let delta = &next[messages.len()..];
            // 期望的响应回放头：reasoning 回放项（M306：原样、紧随其 assistant 之前，
            // 取 llm_response.reasoning——design §2 的回放项键）+ assistant 消息
            // （M372：空正文跳过）——与线上构造器逐字节同源。
            let mut expected_head: Vec<serde_json::Value> = session::assistant_item(
                response["text"].as_str().unwrap_or(""),
                response.get("reasoning"),
            );
            // 工具轮：reasoning 直接接成组调用项（M372：无空正文 assistant 项）。
            let calls = response["tool_calls"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            for call in &calls {
                expected_head.push(session::function_call_item(
                    call["id"].as_str().unwrap_or(""),
                    call["name"].as_str().unwrap_or(""),
                    call["arguments"].as_str().unwrap_or(""),
                ));
            }
            if delta.len() < expected_head.len() {
                return Err(format!(
                    "延伸段短于响应回放项：{delta:?} vs {expected_head:?}"
                ));
            }
            for (index, item) in expected_head.iter().enumerate() {
                if delta[index] != *item {
                    return Err(format!(
                        "响应回放项不一致（不变量 3）：延伸段第 {index} 项\n实际：{}\n期望：{}",
                        serde_json::to_string(&delta[index]).unwrap(),
                        serde_json::to_string(item).unwrap()
                    ));
                }
            }
            // 延伸段其余必须是 function_call_output 项，call_id 与调用同序配对
            // （M360：输出随调用成组在后）。
            let outputs = &delta[expected_head.len()..];
            if outputs.len() != calls.len() {
                return Err(format!(
                    "输出项数（{}）与调用数（{}）不等",
                    outputs.len(),
                    calls.len()
                ));
            }
            for (index, output) in outputs.iter().enumerate() {
                if output["type"].as_str() != Some("function_call_output") {
                    return Err(format!("延伸段尾项不是输出项：{output}"));
                }
                if output["call_id"] != calls[index]["id"] {
                    return Err(format!(
                        "输出项 call_id 与调用不配对：{} vs {}",
                        output["call_id"], calls[index]["id"]
                    ));
                }
            }
        }
    }
    Ok(())
}

/// 记录形状：首行 session_open（system 全文 + assembly 含 exists:false + provider /
/// model / thinking）、请求-响应成对、思考落盘（两种 provider 形状）、`<quote>` 消息
/// 逐字节在场、旧事件类绝迹。
#[test]
fn wire_shape_records_full_session() {
    let (f, path) = run_quote_turn("wire-shape");
    let file = f.read(&path);
    let open = &file.session_open;
    assert_eq!(open["kind"], "session_open");
    assert_eq!(open["provider"], "mock");
    // model 字段在场（mock 档无自己的模型，config-only 缺省下为空串——如实记录）。
    assert!(open.get("model").is_some());
    assert_eq!(open["thinking"], "high");
    assert!(
        open["system"]
            .as_str()
            .unwrap()
            .contains("Lumir 的内置助手"),
        "{open:?}"
    );
    // 装配清单：五个来源全在场，vault 根 AGENTS.md 不存在如实记 exists:false。
    let assembly = open["assembly"].as_array().unwrap();
    assert_eq!(assembly.len(), 5, "{assembly:?}");
    let vault_root = assembly
        .iter()
        .find(|s| s["source"] == "agents_vault_root")
        .unwrap();
    assert_eq!(vault_root["exists"], false, "{vault_root:?}");
    assert_eq!(vault_root["bytes"], 0);
    let skill_index = assembly
        .iter()
        .find(|s| s["source"] == "skill_index")
        .unwrap();
    assert_eq!(skill_index["skills"], 0);

    let pairs = conversation_pairs(&file);
    assert_eq!(pairs.len(), 2, "两轮工具循环 = 两对请求/响应");
    let (request0, response0) = pairs[0];
    // `<quote>` 消息逐字节在场。
    let first_user = &request0["request"]["messages"][0];
    assert_eq!(
        first_user["content"][0]["text"].as_str().unwrap(),
        QUOTE_MESSAGE
    );
    // 思考落盘（裁决点 1，design §2 双字段物理分离）：reasoning = 回放项原文
    // （provider 方言在场），thinking = 展示文本（字符串，密文永不入内）。
    assert_eq!(response0["reasoning"]["encrypted_content"], "resp-0");
    assert_eq!(
        response0["reasoning"]["content"][0]["text"],
        "需要先读 a.md。"
    );
    assert_eq!(response0["thinking"], "需要先读 a.md。");
    assert!(
        response0["thinking"].is_string(),
        "thinking 必须是展示文本字符串，不是回放项对象：{response0:?}"
    );
    let (_, response1) = pairs[1];
    assert_eq!(
        response1["reasoning"]["content"][0]["text"],
        "读完确认无误。"
    );
    assert_eq!(response1["thinking"], "读完确认无误。");
    // usage 并入响应；工具调用带原文参数；mock 因果链在场。
    assert_eq!(response0["usage"]["input_tokens"], 100);
    assert_eq!(
        response0["tool_calls"][0]["arguments"],
        "{\"path\":\"a.md\"}"
    );
    assert!(response0["mock_fixture"]
        .as_str()
        .unwrap()
        .contains("quote-thinking"));
    // 思考回放语义（M306 / M360）：reasoning 回放项原样、紧随其 assistant 之前入下一条请求。
    let messages1 = pairs[1].0["request"]["messages"].as_array().unwrap();
    assert_eq!(
        messages1[1], response0["reasoning"],
        "reasoning 回放项逐字节回放"
    );
    assert_eq!(messages1[1]["type"], "reasoning");
    assert_eq!(messages1[2]["role"], "assistant");
    assert_eq!(messages1[2]["content"][0]["text"], "先读文件。");
    // 工具结果（模型输入数据）逐字节在下一条请求的 messages 里。
    let wire = serde_json::to_string(&messages1).unwrap();
    assert!(wire.contains("demo body"), "{wire}");

    // 11 类被废弃的旧事件类一律不得出现（sidecar 只留决策类）。
    let raw = std::fs::read_to_string(&path).unwrap();
    for legacy in [
        "user_message",
        "assistant_text",
        "tool_call",
        "tool_result",
        "usage",
        "tool_denied",
        "compact",
        "session_reset",
        "approval_overwritten",
        "approval_withdrawn",
        "turn_abort_requested",
    ] {
        assert!(
            !raw.contains(&format!("\"kind\":\"{legacy}\"")),
            "废弃 kind {legacy} 绝迹：{raw}"
        );
    }
    check_recovery_sufficient(&path).expect("恢复充分性成立");
    let _ = f;
}

/// 恢复充分性属性测试的正向判据：一轮引用 + 思考 + 工具循环对话，
/// 仅凭 JSONL 逐字节重建每一轮发给模型的请求（check_recovery_sufficient 全绿）。
#[test]
fn recovery_sufficiency_holds_for_tool_loop_turn() {
    let (_f, path) = run_quote_turn("recovery-prop");
    check_recovery_sufficient(&path).expect("恢复充分性成立");
}

/// 反向验证（REVIEW.md 第 1 条纪律：先造一个必让它 FAIL 的输入实测一次）：
/// 手改重建链上的一个字节——响应正文、reasoning 项、调用参数、输出结果、system
/// 各改一处，断言重建校验如实变红。
#[test]
fn recovery_sufficiency_fails_on_tampering() {
    // 篡改用例：（篡改函数, 篡改点名称）。
    type Tamper = fn(&str) -> String;
    let cases: Vec<(Tamper, &str)> = vec![
        // 响应正文被改（只改响应、不改下一条请求里的副本）：延伸段与响应回放项不一致。
        (|raw| raw.replacen("先读文件。", "先读文件!", 1), "响应正文"),
        // reasoning 密文被改（只改响应侧、不改回放进下一条请求的副本）：回放项不一致。
        (|raw| raw.replacen("resp-0", "resp-X", 1), "reasoning 项"),
        // 响应侧的调用参数被改（只改响应、不改下一条请求里的调用项）：
        // function_call 项与响应回放不一致——不变量 3 的判据正是这道分叉。
        (
            |raw| {
                raw.replacen(
                    r#""arguments":"{\"path\":\"a.md\"}""#,
                    r#""arguments":"{\"path\":\"b.md\"}""#,
                    1,
                )
            },
            "调用参数",
        ),
        // 首条请求里的用户消息被改（下一条请求里的副本未动）：前缀一致性如实变红。
        (|raw| raw.replacen("先读结论", "先读结沦", 1), "用户消息"),
        // session_open 的 system 被改：请求体 system 与首行不一致。
        (
            |raw| raw.replacen("Lumir 的内置助手", "Lumir 的冒牌助手", 1),
            "system",
        ),
    ];
    for (index, (tamper, what)) in cases.iter().enumerate() {
        let (_f, path) = run_quote_turn(&format!("tamper-{index}"));
        let raw = std::fs::read_to_string(&path).unwrap();
        let tampered = tamper(&raw);
        assert_ne!(tampered, raw, "{what}：篡改函数未生效");
        let tampered_path = path.with_file_name(format!("tampered-{index}.jsonl"));
        std::fs::write(&tampered_path, &tampered).unwrap();
        assert!(
            check_recovery_sufficient(&tampered_path).is_err(),
            "{what}：手改一处后重建校验必须变红，实际仍绿——判据没有区分度"
        );
    }
}

/// 恢复命令 roundtrip：从留存文件重建 Session——最后一条会话轮次 llm_request 的
/// 完整请求体（system + messages）原样灌回，锚点之后配对的末尾 llm_response 按
/// design §6.2 第 4 步折叠进灌回的 input（reasoning 回放项 + assistant 消息）；
/// 新会话续写新 JSONL（opened_from=restore、restored_from=源 id），新发出的请求
/// 以恢复的历史为前缀（恢复事实真正回流到发送路径）。
#[test]
fn resume_rebuilds_session_and_continues_in_new_file() {
    let f = Fixture::new("resume");
    f.write("a.md", "demo body\n");
    let config = mock_config();
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let mut client = MockClient::from_str(quote_and_thinking_script(), "resume-src").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        QUOTE_MESSAGE.to_string(),
        &mut client,
    );
    runtime.release_turn(&f.scope());
    let files = f.session_files();
    assert_eq!(files.len(), 1);
    let source_path = files[0].clone();
    let source_id = jsonl::JsonlWriter::session_id_from_path(&source_path).unwrap();
    let source_file = f.read(&source_path);
    let pairs = conversation_pairs(&source_file);
    let (anchor, trailing) = pairs.last().unwrap();
    let last_messages = anchor["request"]["messages"].as_array().unwrap().clone();
    // 合同期望的灌回结果 = 锚点 messages + 末尾响应折叠（reasoning 回放项 + assistant 消息）。
    let mut expected = last_messages.clone();
    for item in session::assistant_item(
        trailing["text"].as_str().unwrap_or(""),
        trailing.get("reasoning"),
    ) {
        expected.push(item);
    }

    // 恢复：新会话 id 立即给出；新文件惰性——首条记录时才创建。
    let info = runtime
        .resume_session(&f.scope(), &config, &source_id)
        .expect("恢复成功");
    assert!(jsonl::is_valid_session_id(&info.session_id));
    assert_ne!(info.session_id, source_id);
    assert_eq!(info.restored_items, expected.len());
    // 灌回的 input = 锚点请求逐字节 + 末尾响应折叠（design §6.2 第 4 步——
    // 末轮答复不丢，模型续聊时看得见自己的最后一答）。
    let restored_input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    assert_eq!(restored_input, expected, "灌回 = 锚点请求 + 末尾响应折叠");
    // 折叠内容逐项在位：reasoning 回放项原样、assistant 消息是末轮正文。
    let tail = &restored_input[last_messages.len()..];
    assert_eq!(tail[0], trailing["reasoning"], "reasoning 回放项原样折叠");
    assert_eq!(tail[1]["role"], "assistant");
    assert_eq!(tail[1]["content"][0]["text"], "读完了。");

    // 续聊：新发的请求以恢复的历史为逐字节前缀；新文件随首条记录创建。
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(
        r#"{"responses": [{"text": "接着上面继续。"}]}"#,
        "resume-cont",
    )
    .unwrap();
    drive_turn(
        &sink2,
        &runtime,
        &f.scope(),
        &config,
        "继续".to_string(),
        &mut client2,
    );
    runtime.release_turn(&f.scope());
    // 新文件首行：opened_from=restore + restored_from=源会话 id（谱系链）；
    // system / assembly 沿用源文件的装配事实。
    let files_now = f.session_files();
    assert_eq!(files_now.len(), 2, "恢复续写新文件：{files_now:?}");
    let new_path = files_now
        .iter()
        .find(|p| {
            jsonl::JsonlWriter::session_id_from_path(p).as_deref() == Some(info.session_id.as_str())
        })
        .expect("新文件即恢复返回的 session id");
    let new_file = f.read(new_path);
    assert_eq!(new_file.session_open["opened_from"], "restore");
    assert_eq!(new_file.session_open["restored_from"], source_id);
    assert_eq!(
        new_file.session_open["system"],
        source_file.session_open["system"]
    );
    assert_eq!(
        new_file.session_open["assembly"],
        source_file.session_open["assembly"]
    );
    let pairs = conversation_pairs(&new_file);
    assert_eq!(pairs.len(), 1);
    let continued_messages = pairs[0].0["request"]["messages"].as_array().unwrap();
    assert!(
        continued_messages.len() > expected.len(),
        "新请求在恢复历史之后延伸"
    );
    for (index, item) in expected.iter().enumerate() {
        assert_eq!(
            continued_messages[index], *item,
            "恢复的历史是新请求的逐字节前缀"
        );
    }
    // 源文件封闭：行数不变。
    let before_lines = std::fs::read_to_string(&source_path)
        .unwrap()
        .lines()
        .count();
    let source_now = f.read(&source_path);
    assert_eq!(source_now.records.len(), source_file.records.len());
    assert_eq!(
        std::fs::read_to_string(&source_path)
            .unwrap()
            .lines()
            .count(),
        before_lines
    );

    // 防线：形态校验与 vault 归属校验。
    let err = runtime
        .resume_session(&f.scope(), &config, "../etc/passwd")
        .unwrap_err();
    assert_eq!(err.code, "harness_session_invalid");
    let vault_b = f.root.join("vault-b");
    std::fs::create_dir_all(&vault_b).unwrap();
    let scope_b = VaultScope {
        root: vault_b,
        policy: IgnorePolicy::load(&f.root.join("vault-b"), &[".gitignore".to_string()]),
    };
    let err = runtime
        .resume_session(&scope_b, &config, &source_id)
        .unwrap_err();
    assert_eq!(err.code, "harness_session_vault_mismatch");
}

/// 恢复折叠的边界用例（design §6.2 第 4 步的「带悬空调用」形态）：会话结束在
/// loop_max 收口——最后一条 llm_response 带 tool_calls、调用已执行且输出已入历史，
/// 但那些输出从未进任何 llm_request（模型输入数据，wire 里无处可取）。折叠按 design
/// 边界口径原样灌回 function_call 项（无输出项）——灌回结果如实可答，不静默截断。
#[test]
fn resume_folds_trailing_response_with_dangling_tool_calls() {
    let f = Fixture::new("resume-dangling");
    f.write("a.md", "x\n");
    let mut config = mock_config();
    config.loop_max = 2;
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    // 两轮都继续调工具：第二轮的调用执行完（fc2/fco2 入历史）即触 loop_max 收口——
    // 末条响应带悬空调用（其输出不在任何请求体里）。
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]}
    ]}"#;
    let mut client = MockClient::from_str(script, "dangling").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let files = f.session_files();
    let source = f.read(&files[0]);
    let pairs = conversation_pairs(&source);
    assert_eq!(pairs.len(), 2);
    let (anchor, trailing) = pairs[1];
    assert_eq!(trailing["tool_calls"][0]["id"], "c2");
    let anchor_messages = anchor["request"]["messages"].as_array().unwrap().clone();
    // 线上会话此刻持有的 input（含 fc2/fco2）——wire 只能重建到锚点 + 折叠。
    let live_input = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    assert!(
        live_input
            .iter()
            .any(|i| i["type"] == "function_call_output" && i["call_id"] == "c2"),
        "现场实证：c2 的输出已入历史但不在任何请求体里"
    );

    let source_id = jsonl::JsonlWriter::session_id_from_path(&files[0]).unwrap();
    let info = runtime
        .resume_session(&f.scope(), &config, &source_id)
        .expect("恢复成功");
    let restored = runtime
        .with_session(&f.scope(), |s| s.input().to_vec())
        .unwrap();
    // 折叠结果 = 锚点 messages + 悬空的 function_call 项（design 边界口径：原样灌回，
    // 无输出项可灌——响应未携带、wire 里也没有）。
    assert_eq!(
        info.restored_items,
        anchor_messages.len() + 1,
        "折叠恰好新增一条 function_call 项"
    );
    assert_eq!(restored[..anchor_messages.len()], anchor_messages[..]);
    let tail = &restored[anchor_messages.len()..];
    assert_eq!(tail.len(), 1, "{tail:?}");
    assert_eq!(tail[0]["type"], "function_call");
    assert_eq!(tail[0]["call_id"], "c2");
    assert_eq!(tail[0]["name"], "vault_read");
    // 区分度反向自证：悬空项不得凭空长出输出项（那需要 wire 里没有的第二事实源）。
    assert!(
        !restored
            .iter()
            .any(|i| i["type"] == "function_call_output" && i["call_id"] == "c2"),
        "悬空调用按原样灌回，不得伪造输出项"
    );
}

/// 压缩的文件边界：旧文件封闭（压缩调用自身的 llm_request / llm_response 落在旧文件
/// 末尾），新文件首行 opened_from=compact 且 compact_summary 在场，压缩后继续的轮次
/// 只追加进新文件。
#[test]
fn compact_closes_old_file_and_opens_summary_file() {
    let f = Fixture::new("compact-boundary");
    let mut config = mock_config();
    config.warn_ctx_pct = 50.0;
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"text": "长回答。", "usage": {"input_tokens": 120000, "cached_tokens": 60000, "output_tokens": 500}},
        {"text": "会话摘要：前面在聊阈值压缩。"},
        {"text": "压缩后继续。"}
    ]}"#;
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

    // 压缩在轮末触发：新文件此刻还只有挂起句柄（惰性，首条记录时创建）——旧文件唯一。
    let files = f.session_files();
    assert_eq!(files.len(), 1, "压缩后新文件惰性未建：{files:?}");
    let old = f.read(&files[0]);
    // 旧文件：会话轮次对 + 压缩调用对（压缩请求体 system 是压缩指令，被会话轮次判据排除）。
    let old_pairs = conversation_pairs(&old);
    assert_eq!(old_pairs.len(), 1, "旧文件里一轮会话轮次：{old_pairs:?}");
    let kinds: Vec<&str> = old
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
    let compact_request = &old.records[old.records.len() - 2];
    assert_ne!(
        compact_request["request"]["system"], old.session_open["system"],
        "压缩调用的 system 是压缩指令，不是会话 system"
    );
    let compact_response = old.records.last().unwrap();
    assert_eq!(compact_response["text"], "会话摘要：前面在聊阈值压缩。");

    // 压缩后的轮次只进新文件；旧文件封闭。
    let old_lines = std::fs::read_to_string(&files[0]).unwrap().lines().count();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink2 = CollectSink::default();
    let mut client2 = MockClient::from_str(script, "compact2").unwrap();
    client2.complete(
        &llm::Request {
            system: "x".into(),
            input: vec![],
            tools: vec![],
            effort: Default::default(),
        },
        &llm::DiscardStreamSink,
    );
    client2.complete(
        &llm::Request {
            system: "x".into(),
            input: vec![],
            tools: vec![],
            effort: Default::default(),
        },
        &llm::DiscardStreamSink,
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
    // 新文件随首条记录创建：首行 compact + 摘要；系统上下文重新装配（三处装配点之一）。
    // 注意不依赖目录排序——同毫秒建立的 id 按随机段排序，按身份（≠ 旧文件）取。
    let files_now = f.session_files();
    assert_eq!(files_now.len(), 2, "压缩开新文件：{files_now:?}");
    let new_path = files_now
        .iter()
        .find(|p| **p != files[0])
        .expect("新文件即非旧文件的那份");
    let new = f.read(new_path);
    assert_eq!(new.session_open["opened_from"], "compact");
    assert_eq!(
        new.session_open["compact_summary"],
        "会话摘要：前面在聊阈值压缩。"
    );
    assert!(new.session_open["system"]
        .as_str()
        .unwrap()
        .contains("Lumir 的内置助手"));
    // 新文件承接了压缩后的轮次：首行之外有记录。
    assert!(new.records.len() > 1, "新文件承接压缩后的轮次");
    check_recovery_sufficient(new_path).expect("新文件的恢复充分性成立");
    assert_eq!(
        std::fs::read_to_string(&files[0]).unwrap().lines().count(),
        old_lines,
        "旧文件封闭不再追加"
    );
}

/// sidecar 决策类收口：批准决定（llm_error / loop_max_reached 见下两条）——
/// approval 在列，且作为非 wire 记录不打断请求-响应配对。
#[test]
fn sidecar_records_approval_decision() {
    let f = Fixture::new("sidecar-approval");
    f.write("a.md", "old\n");
    let config = mock_config();
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"patched\"}]}"}]},
        {"text": "收到。"}
    ]}"#;
    let mut client = MockClient::from_str(script, "approval").unwrap();
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
    for _ in 0..500 {
        if sink
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "approval_request")
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let id = sink
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "approval_request")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    runtime
        .with_session(&f.scope(), |s| s.resolve_approval(&id, true, None))
        .expect("resolve ok")
        .expect("resolve ok");
    worker.join().unwrap();
    runtime.release_turn(&f.scope());

    let files = f.session_files();
    let file = f.read(&files[0]);
    let approval = file
        .records
        .iter()
        .find(|r| r["kind"] == "approval")
        .expect("approval sidecar 在列");
    assert_eq!(approval["tool"], "vault_patch");
    assert_eq!(approval["decision"], "approved");
    // sidecar 不打断配对：会话轮次对完整。
    assert_eq!(conversation_pairs(&file).len(), 2);
    check_recovery_sufficient(&files[0]).expect("恢复充分性成立");
}

/// sidecar 决策类：LLM 调用失败——llm_response 带 error 字段（wire 成对），
/// llm_error sidecar 在列（决策类）。
#[test]
fn sidecar_records_llm_error() {
    let f = Fixture::new("sidecar-error");
    let config = mock_config();
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"error": {"code": "rate_limit", "message": "slow down"}}
    ]}"#;
    let mut client = MockClient::from_str(script, "error").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let files = f.session_files();
    let file = f.read(&files[0]);
    let kinds: Vec<&str> = file
        .records
        .iter()
        .skip(1)
        .map(|r| r["kind"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        vec!["llm_request", "llm_response", "llm_error"],
        "{kinds:?}"
    );
    assert_eq!(file.records[2]["error"], "rate_limit: slow down");
    check_recovery_sufficient(&files[0]).expect("失败轮同样满足成对不变量");
}

/// sidecar 决策类：工具循环上限——loop_max_reached 在列，且提示文本照常入历史。
#[test]
fn sidecar_records_loop_max() {
    let f = Fixture::new("sidecar-loopmax");
    f.write("a.md", "x\n");
    let mut config = mock_config();
    config.loop_max = 2;
    let runtime = Runtime::default();
    runtime.acquire_turn(&f.scope(), &config).unwrap();
    let sink = CollectSink::default();
    let script = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]},
        {"tool_calls": [{"id": "c2", "name": "vault_read", "arguments": "{\"path\":\"a.md\"}"}]}
    ]}"#;
    let mut client = MockClient::from_str(script, "loopmax").unwrap();
    drive_turn(
        &sink,
        &runtime,
        &f.scope(),
        &config,
        "问".into(),
        &mut client,
    );
    runtime.release_turn(&f.scope());

    let files = f.session_files();
    let file = f.read(&files[0]);
    let record = file
        .records
        .iter()
        .find(|r| r["kind"] == "loop_max_reached")
        .expect("loop_max_reached sidecar 在列");
    assert_eq!(record["loop_max"], 2);
}

/// deny 类工具的 wire 留痕（tool_denied 事件类已废弃的替代口径）：带 permission_denied
/// 错误码的工具结果随历史逐字节进下一条 llm_request.messages。
#[test]
fn sidecar_deny_result_lives_in_next_request() {
    let f2 = Fixture::new("sidecar-deny");
    f2.write("a.md", "old\n");
    let mut config2 = mock_config();
    config2.permissions = HarnessPermissions {
        allow: vec![],
        deny: vec!["vault_patch".into()],
    };
    let runtime2 = Runtime::default();
    runtime2.acquire_turn(&f2.scope(), &config2).unwrap();
    let sink2 = CollectSink::default();
    let script2 = r#"{"responses": [
        {"tool_calls": [{"id": "c1", "name": "vault_patch",
            "arguments": "{\"path\":\"a.md\",\"edits\":[{\"old_string\":\"old\",\"new_string\":\"new\"}]}"}]},
        {"text": "好的，那我不改了。"}
    ]}"#;
    let mut client2 = MockClient::from_str(script2, "deny").unwrap();
    drive_turn(
        &sink2,
        &runtime2,
        &f2.scope(),
        &config2,
        "改一下".into(),
        &mut client2,
    );
    runtime2.release_turn(&f2.scope());
    let files2 = f2.session_files();
    let file2 = f2.read(&files2[0]);
    let pairs2 = conversation_pairs(&file2);
    let wire = serde_json::to_string(&pairs2[1].0["request"]["messages"]).unwrap();
    assert!(
        wire.contains("permission_denied"),
        "deny 结果随历史进下一条 llm_request.messages：{wire}"
    );
    check_recovery_sufficient(&files2[0]).expect("deny 轮恢复充分性成立");
}
