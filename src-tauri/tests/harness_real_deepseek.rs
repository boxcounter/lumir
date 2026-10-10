//! 真 provider 冒烟（M306，Alex 裁决：真 API 验证由 agent 自测，不再让他手工测试+粘贴报错）。
//!
//! 驱动「提问 → vault_read 工具调用 → 结果回送 → 模型收尾」全链路后**再追问一轮**
//! （二轮是 regression 点：deepseek thinking 模式要求 reasoning 原样回传，不回传
//! 即 400 `The `reasoning_text` in the thinking mode must be passed back to the API`）。
//!
//! 运行：`cargo test --test harness_real_deepseek -- --ignored --nocapture`
//! 默认 `#[ignore]`（烧真 token，门禁不跑）。无 key 环境自动 SKIP（通过）。
//!
//! **key 纪律**：只从 `~/.config/lumir/config.json` 原地读（`LUMIR_CONFIG_JSON` 可改路径），
//! 绝不打印、绝不写入任何日志 / 断言消息 / JSONL；断言失败时只输出事件 code。
//! 模型 id 可用 `LUMIR_DEEPSEEK_MODEL` 临时覆盖（不改 Alex 的 config 文件）。

use lumir_lib::config::{HarnessConfig, HarnessProvider};
use lumir_lib::fs_io::IgnorePolicy;
use lumir_lib::harness::events::EventSink;
use lumir_lib::harness::{turn, Runtime, VaultScope};

use std::path::Path;
use std::sync::{Arc, Mutex};

/// 收集事件的 sink（与 harness_runtime.rs 同形）。
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

    /// 事件 type 序列（诊断只允许看这个，message/body 不进断言输出）。
    fn types(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|e| e.get("type").and_then(|t| t.as_str()).map(str::to_string))
            .collect()
    }

    /// error 事件的 code 列表（不放 message——可能携带请求体回显）。
    fn error_codes(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("error"))
            .filter_map(|e| e.get("code").and_then(|c| c.as_str()).map(str::to_string))
            .collect()
    }
}

/// 从 ~/.config/lumir/config.json 原地读 deepseek 配置（key 不落任何输出）。
/// 缺文件 / 缺 key ⇒ None（调用方 SKIP）。
fn deepseek_config_from_disk() -> Option<(String, String, Option<String>)> {
    let path = std::env::var("LUMIR_CONFIG_JSON").unwrap_or_else(|_| {
        format!(
            "{}/.config/lumir/config.json",
            std::env::var("HOME").unwrap_or_else(|_| "/Users/boxcounter".into())
        )
    });
    let text = std::fs::read_to_string(Path::new(&path)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let section = value.get("harness")?.get("providers")?.get("deepseek")?;
    let key = section.get("api_key")?.as_str()?.trim().to_string();
    if key.is_empty() {
        return None;
    }
    let model = section
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("deepseek-flash")
        .to_string();
    let base_url = section
        .get("base_url")
        .and_then(|b| b.as_str())
        .map(str::to_string);
    Some((key, model, base_url))
}

#[test]
#[ignore = "真 provider 冒烟：烧真 token，默认门禁不跑；无 key 环境自动 SKIP"]
fn real_deepseek_two_turns_tool_call_and_reasoning_replay() {
    // —— 环境隔离：临时 vault + XDG_CONFIG_HOME（JSONL 落点），不碰真实配置目录 ——
    let root = std::env::temp_dir().join(format!("lumir-m306-real-{}", std::process::id()));
    if root.exists() {
        std::fs::remove_dir_all(&root).unwrap();
    }
    std::fs::create_dir_all(root.join("xdg")).unwrap();
    std::fs::create_dir_all(root.join("vault")).unwrap();
    std::fs::write(root.join("vault/smoke.md"), " Lumir 冒烟\n第二行\n").unwrap();
    let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
    std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));

    let run = || -> Result<(), String> {
        let Some((api_key, configured_model, base_url)) = deepseek_config_from_disk() else {
            eprintln!("[smoke] 无 deepseek key（config.json 缺失或未配置），SKIP");
            return Ok(());
        };
        // LUMIR_DEEPSEEK_MODEL 临时覆盖（核实正确 id 时用它，不改 Alex 的 config）。
        let model = std::env::var("LUMIR_DEEPSEEK_MODEL")
            .ok()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(configured_model);

        let mut config = HarnessConfig {
            provider: HarnessProvider::Deepseek,
            ..Default::default()
        };
        config.providers.deepseek.api_key = api_key;
        config.providers.deepseek.model = model.clone();
        config.providers.deepseek.base_url = base_url;

        let mut client = lumir_lib::harness::llm::client(&config)
            .map_err(|e| format!("client 装配失败：code={}", e.code))?;

        let scope = VaultScope {
            root: root.join("vault"),
            policy: IgnorePolicy::load(&root.join("vault"), &[".gitignore".to_string()]),
            vault_id: "vault-test-1".to_string(),
        };
        let runtime = Runtime::default();

        // —— 一轮：提问 → 必触发 vault_read（默认读类 allow，免批准闸）→ 回送 → 收尾 ——
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = CollectSink::default();
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "请用 vault_read 读取 smoke.md（path 填 \"smoke.md\"），然后用一句话说出文件第一行。"
                .to_string(),
            None,
            client.as_mut(),
        );
        runtime.release_turn(&scope);
        let types = sink.types();
        assert!(
            sink.error_codes().is_empty(),
            "一轮不允许 error 事件：codes={:?} types={types:?}",
            sink.error_codes()
        );
        assert!(
            types.iter().any(|t| t == "tool_call"),
            "一轮应触发工具调用：types={types:?}"
        );
        assert_eq!(types.last().map(String::as_str), Some("done"), "一轮须完成");

        // —— 二轮：追问（regression 点：一轮的 reasoning + 完整工具轮必须在回放 input 里）——
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink2 = CollectSink::default();
        turn::run_turn_for(
            &sink2,
            &runtime,
            &scope,
            &config,
            "这个文件一共有几行？只回答数字。".to_string(),
            None,
            client.as_mut(),
        );
        runtime.release_turn(&scope);
        let types2 = sink2.types();
        assert!(
            sink2.error_codes().is_empty(),
            "二轮不允许 error 事件（reasoning 回放被拒即在此暴露）：codes={:?} types={types2:?}",
            sink2.error_codes()
        );
        assert_eq!(
            types2.last().map(String::as_str),
            Some("done"),
            "二轮须完成：types={types2:?}"
        );

        // 回放 input 含一轮的完整工具轮（function_call + output），reasoning 项在列。
        let input = runtime
            .with_session(&scope, |s| s.input().to_vec())
            .map_err(|e| e.code)?;
        let has_fc = input.iter().any(|it| it["type"] == "function_call");
        let has_fco = input.iter().any(|it| it["type"] == "function_call_output");
        assert!(has_fc && has_fco, "回放 input 应含完整工具轮");
        let reasoning_count = input.iter().filter(|it| it["type"] == "reasoning").count();
        // M360：这里原先是「只打印不判」——reasoning 捕获整条链路坏掉也照绿（M306 的修复
        // 因此从未被这条真 API 用例验证过）。捕获必须断言，缺字段即 FAIL。
        assert!(
            reasoning_count >= 1,
            "带 tools 的轮次必须捕获 reasoning 项并回放（缺即 400 的根因），input={input:#?}"
        );
        println!(
            "[smoke] PASS model={model} rounds_ok input_items={} reasoning_items={reasoning_count}",
            input.len()
        );
        Ok(())
    };

    let result = run();
    match &previous_xdg {
        Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
        None => std::env::remove_var("XDG_CONFIG_HOME"),
    }
    std::fs::remove_dir_all(&root).ok();
    result.unwrap();
}

/// M360 真 API 回归：**一轮里两条工具调用**的回放（Alex 2026-10-07 dogfood 第一条对话的现场形态）。
///
/// 现场：一轮里两个 vault_read 完成后的下一个请求被 400
/// ``The `reasoning_text` in the thinking mode must be passed back to the API``。根因不是
/// reasoning 丢失（它一直在回放里），而是**项序**：调用与输出交错（`fc1, fco1, fc2, fco2`）时，
/// 兼容层把第二条 `function_call` 并进一条新的、没有 reasoning 的 assistant 消息 ⇒ 400。
/// 同请求体逐项变异实测：交错 400 / 成组（`fc1, fc2, fco1, fco2`）200 / 把 reasoning 整项删掉
/// 且仍交错也 400（口径全文见 `harness/llm.rs` §reasoning 回传纪律 M360 段）。
///
/// 断言：无 error 事件、终态 done、**每个回放轮次里调用项成组在输出项之前**——最后一条是
/// 旧实现（逐条「调用项 + 输出项」压栈）必红的判据。
///
/// 运行：`cargo test --test harness_real_deepseek -- --ignored --nocapture`
#[test]
#[ignore = "真 provider 冒烟：烧真 token，默认门禁不跑；无 key 环境自动 SKIP"]
fn real_deepseek_multi_call_round_replays_grouped() {
    let root = std::env::temp_dir().join(format!("lumir-m360-real-{}", std::process::id()));
    if root.exists() {
        std::fs::remove_dir_all(&root).unwrap();
    }
    std::fs::create_dir_all(root.join("xdg")).unwrap();
    std::fs::create_dir_all(root.join("home")).unwrap();
    std::fs::create_dir_all(root.join("vault")).unwrap();
    std::fs::write(root.join("vault/smoke.md"), " 冒烟甲\n第二行\n").unwrap();
    std::fs::write(root.join("vault/notes.md"), " 冒烟乙\n").unwrap();
    let previous_xdg = std::env::var_os("XDG_CONFIG_HOME");
    let previous_home = std::env::var_os("HOME");
    // 连接信息必须在改 HOME 之前读（改后 ~/.config/lumir 就指向临时目录了）。
    let connection = deepseek_config_from_disk();
    std::env::set_var("XDG_CONFIG_HOME", root.join("xdg"));
    std::env::set_var("HOME", root.join("home"));

    let run = || -> Result<(), String> {
        let Some((api_key, configured_model, base_url)) = connection.clone() else {
            eprintln!("[smoke] 无 deepseek key（config.json 缺失或未配置），SKIP");
            return Ok(());
        };
        let model = std::env::var("LUMIR_DEEPSEEK_MODEL")
            .ok()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(configured_model);
        let mut config = HarnessConfig {
            provider: HarnessProvider::Deepseek,
            ..Default::default()
        };
        config.providers.deepseek.api_key = api_key;
        config.providers.deepseek.model = model.clone();
        config.providers.deepseek.base_url = base_url;

        let mut client = lumir_lib::harness::llm::client(&config)
            .map_err(|e| format!("client 装配失败：code={}", e.code))?;
        let scope = VaultScope {
            root: root.join("vault"),
            policy: IgnorePolicy::load(&root.join("vault"), &[".gitignore".to_string()]),
            vault_id: "vault-test-1".to_string(),
        };
        let runtime = Runtime::default();
        runtime.acquire_turn(&scope, &config).unwrap();
        let sink = CollectSink::default();
        turn::run_turn_for(
            &sink,
            &runtime,
            &scope,
            &config,
            "请在同一轮里并行发起两次 vault_read：分别读取 smoke.md 与 notes.md，\
             然后用一句话说明两个文件各有几行。"
                .to_string(),
            None,
            client.as_mut(),
        );
        runtime.release_turn(&scope);

        let types = sink.types();
        assert!(
            sink.error_codes().is_empty(),
            "一轮两条工具调用不允许 error 事件（M360 现场即此处 400）：codes={:?} types={types:?}",
            sink.error_codes()
        );
        assert_eq!(types.last().map(String::as_str), Some("done"), "{types:?}");

        let input = runtime
            .with_session(&scope, |s| s.input().to_vec())
            .map_err(|e| e.code)?;
        let kind = |item: &serde_json::Value| -> String {
            item.get("type")
                .and_then(|t| t.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| item["role"].as_str().unwrap_or("?").to_string())
        };
        let calls = input
            .iter()
            .filter(|it| kind(it) == "function_call")
            .count();
        let outputs = input
            .iter()
            .filter(|it| kind(it) == "function_call_output")
            .count();
        assert!(
            calls >= 2 && calls == outputs,
            "本用例的目标形态是「一轮两条调用、成对回放」，实际 calls={calls} outputs={outputs}：\
             input={input:#?}"
        );
        // 成组判据：任一 function_call 之后不得再出现 function_call_output（即全部调用项在前）。
        let first_output = input
            .iter()
            .position(|it| kind(it) == "function_call_output")
            .expect("有输出项");
        let last_call = input
            .iter()
            .rposition(|it| kind(it) == "function_call")
            .expect("有调用项");
        assert!(
            last_call < first_output,
            "调用项须成组在输出项之前（last_call={last_call} first_output={first_output}）：\
             kinds={:?}",
            input.iter().map(kind).collect::<Vec<_>>()
        );
        let reasoning_count = input.iter().filter(|it| kind(it) == "reasoning").count();
        assert!(reasoning_count >= 1, "带 tools 的轮次要捕获 reasoning 项");
        println!(
            "[smoke] PASS model={model} multi_call input_items={} calls={calls} \
             reasoning_items={reasoning_count}",
            input.len()
        );
        Ok(())
    };

    let result = run();
    match &previous_xdg {
        Some(v) => std::env::set_var("XDG_CONFIG_HOME", v),
        None => std::env::remove_var("XDG_CONFIG_HOME"),
    }
    match &previous_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }
    std::fs::remove_dir_all(&root).ok();
    result.unwrap();
}
