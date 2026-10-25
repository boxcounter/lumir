//! 真 provider 冒烟（M443，change harness-cache-metrics tasks 4.1）：实测 kimi 的 Responses
//! 响应里 `cache_write_tokens` 的**嵌套路径**——本仓此前无该字段的实测样本（官方 schema 只
//! 说 usage 含它，`llm.rs` 的旧注释自陈「暂不展示」），解析层因此先按「详情块优先、顶层回退」
//! 两路兜底。本用例把路径钉死，结论回写 `openspec/changes/harness-cache-metrics/design.md` §6
//! 与 `llm.rs::collect_final_response` 的注释。
//!
//! **2026-10-11 实测结论（本机配置：model `k3-256k`，base_url `https://api.kimi.com/coding/v1`）**：
//!
//! ```jsonc
//! "usage": {
//!   "input_tokens": 2641,
//!   "input_tokens_details": { "cache_write_tokens": 0, "cached_tokens": 1024 },
//!   "output_tokens": 59,
//!   "output_tokens_details": { "reasoning_tokens": 45 },
//!   "total_tokens": 2700
//! }
//! ```
//!
//! - **路径**：`usage.input_tokens_details.cache_write_tokens`（与 `cached_tokens` 同层）；
//!   顶层 `usage.cache_write_tokens` **不存在**。
//! - **取值**：该端点（Kimi Code 订阅兼容层）恒报 `0`——官方平台的「缓存写单独计费」口径
//!   在订阅端点上不体现；`cached_tokens` 照常工作（同一前缀重发：1024 → 2641 全命中，见下）。
//!   因此面板的缓存写入行在真机上（零值不渲染）常态不出现，这是如实读数、不是缺陷。
//!
//! 运行：`cargo test --test harness_real_kimi_cache -- --ignored --nocapture`
//! 默认 `#[ignore]`（烧真 token，门禁不跑）。无 key 环境自动 SKIP（通过）。
//! 模型 id 可用 `LUMIR_KIMI_MODEL` 临时覆盖（不改 Alex 的 config 文件）。
//!
//! **key 纪律**：只从 `~/.config/lumir/config.json` 原地读（`LUMIR_CONFIG_JSON` 可改路径），
//! 绝不打印、绝不写入任何日志 / 断言消息 / JSONL；HTTP 失败只输出状态码与错误 code，
//! 不输出响应体（防回显）。

use lumir_lib::config;
use lumir_lib::harness::llm::{self, DiscardStreamSink, Request};

/// 从 `~/.config/lumir/config.json` 原地读 kimi 配置（key 不落任何输出）。
/// 缺文件 / 缺 key ⇒ None（调用方 SKIP）。
fn kimi_config_from_disk() -> Option<(String, String, Option<String>)> {
    let path = std::env::var("LUMIR_CONFIG_JSON").unwrap_or_else(|_| {
        // HOME 缺失时回落空串（读取失败 ⇒ SKIP），不硬编码本机用户名（信息卫生）。
        format!(
            "{}/.config/lumir/config.json",
            std::env::var("HOME").unwrap_or_default()
        )
    });
    let text = std::fs::read_to_string(std::path::Path::new(&path)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let section = value.get("harness")?.get("providers")?.get("kimi")?;
    let key = section.get("api_key")?.as_str()?.trim().to_string();
    if key.is_empty() {
        return None;
    }
    let model = section
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("kimi-k3")
        .to_string();
    let base_url = section
        .get("base_url")
        .and_then(|b| b.as_str())
        .map(str::to_string);
    Some((key, model, base_url))
}

/// 一段足够长的**合成**前缀（信息卫生：不含任何真实 vault 内容）——让 provider 的自动前缀
/// 缓存真的有东西可缓存，`cached_tokens` 的「重发全命中」判据才成立。
fn synthetic_prefix(marker: &str) -> String {
    let unit = format!("{marker} 这是一段用于触发前缀缓存的合成填充文本，不含任何真实内容。");
    unit.repeat(150)
}

/// usage 对象的**键形状**（键名 + 值类型，不打印值——脱敏口径）。
fn usage_shape(value: &serde_json::Value) -> Vec<String> {
    fn walk(value: &serde_json::Value, prefix: &str, out: &mut Vec<String>) {
        let type_name = |v: &serde_json::Value| match v {
            serde_json::Value::Object(map) => format!("object[{}]", map.len()),
            serde_json::Value::Array(items) => format!("array[{}]", items.len()),
            serde_json::Value::String(_) => "string".to_string(),
            serde_json::Value::Number(_) => "number".to_string(),
            serde_json::Value::Bool(_) => "bool".to_string(),
            serde_json::Value::Null => "null".to_string(),
        };
        if let Some(map) = value.as_object() {
            for (key, child) in map {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                out.push(format!("{path}: {}", type_name(child)));
                if child.is_object() {
                    walk(child, &path, out);
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(value, "", &mut out);
    out
}

#[test]
#[ignore = "真 provider 冒烟：烧真 token，默认门禁不跑；无 key 环境自动 SKIP"]
fn real_kimi_reports_cache_write_tokens_path() {
    let run = || -> Result<(), String> {
        let Some((api_key, configured_model, base_url)) = kimi_config_from_disk() else {
            eprintln!("[smoke] 无 kimi key（config.json 缺失或未配置），SKIP");
            return Ok(());
        };
        let model = std::env::var("LUMIR_KIMI_MODEL")
            .ok()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(configured_model);
        let base = base_url
            .unwrap_or_else(|| "https://api.moonshot.cn/v1".to_string())
            .trim_end_matches('/')
            .to_string();
        let http = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("http client 构建失败：{e}"))?;
        let raw_usage = |label: &str| -> Result<serde_json::Value, String> {
            let prompt = format!("{}\n\n只回复两个字：收到", synthetic_prefix("A"));
            let response = http
                .post(format!("{base}/responses"))
                .bearer_auth(&api_key)
                .json(&serde_json::json!({
                    "model": model,
                    "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
                    "store": false,
                }))
                .send()
                .map_err(|e| format!("请求发送失败：{e}"))?;
            let status = response.status();
            if !status.is_success() {
                // 只回错误 code（不打印响应体：防回显请求内容）。
                let text = response.text().unwrap_or_default();
                let code = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| {
                        v.get("error")
                            .and_then(|e| e.get("code"))
                            .and_then(|c| c.as_str())
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "<无 code>".to_string());
                return Err(format!("HTTP {status}（error code: {code}）"));
            }
            let payload: serde_json::Value =
                response.json().map_err(|e| format!("响应不是 JSON：{e}"))?;
            let usage = payload
                .get("usage")
                .cloned()
                .ok_or_else(|| "响应里没有 usage 对象".to_string())?;
            if label == "first" {
                for line in usage_shape(&usage) {
                    eprintln!("[smoke] usage 键形状 {line}");
                }
            }
            Ok(usage)
        };

        // ① 裸 HTTP 两次（同一段合成前缀）：第一次把 usage 键形状打出来（脱敏），
        //    第二次验证「重发同一前缀 ⇒ 全命中」——证明该端点上的前缀缓存确实在工作。
        let first = raw_usage("first")?;
        let second = raw_usage("second")?;
        eprintln!("[smoke] 首见 / 重发：{first} ／ {second}");
        // 路径钉死：`input_tokens_details.cache_write_tokens` 必须在场（数值型）。
        let details = first
            .get("input_tokens_details")
            .ok_or_else(|| "usage 里没有 input_tokens_details".to_string())?;
        details
            .get("cache_write_tokens")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "input_tokens_details 里没有数值型的 cache_write_tokens".to_string())?;
        let input = first
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cached_second = second
            .get("input_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if input == 0 || cached_second < input {
            return Err(format!(
                "重发同一前缀未全命中（input={input} cached={cached_second}）——前缀缓存未生效，本判据无输入"
            ));
        }

        // ② harness 客户端（与生产同一条链路：装配 → 请求 → SSE 解析 → Usage）：同一请求发两次
        //    ——provider 侧第一次把该前缀写进缓存，第二次必须全命中，解析层的 `cached_tokens`
        //    因此必须带上非零值（判据是「解析层真的把 provider 报的缓存命中带出来了」）。
        //    注：system 段（instructions）也参与前缀，故必须连 system 一起逐字节相同才命中。
        let mut config = config::test_harness(
            "kimi",
            config::test_provider(config::ProviderPreset::Kimi, &api_key, &[]),
        );
        {
            let entry = config.providers.get_mut("kimi").unwrap();
            entry.model = model.clone();
            entry.base_url = Some(base.clone());
        }
        let mut client = llm::client(&config, "vault-smoke-1")
            .map_err(|e| format!("client 装配失败：{}", e.code))?;
        let make_request = || Request {
            system: "你是一个只回复用户要求的助手。".to_string(),
            input: vec![serde_json::json!({
                "role": "user",
                "content": [{"type": "input_text", "text": format!("{}\n\n只回复两个字：收到", synthetic_prefix("A"))}],
            })],
            tools: Vec::new(),
            effort: Default::default(),
        };
        let warm = client.complete(&make_request(), &DiscardStreamSink);
        if let Some(error) = warm.error {
            return Err(format!("harness 调用失败（error code: {}）", error.code));
        }
        let output = client.complete(&make_request(), &DiscardStreamSink);
        if let Some(error) = output.error {
            return Err(format!("harness 调用失败（error code: {}）", error.code));
        }
        let usage = output
            .usage
            .ok_or_else(|| "harness 调用未带回 usage".to_string())?;
        eprintln!(
            "[smoke] harness 侧解析（同一请求发两次的第二次）：input={} cached={} output={} cache_write_tokens={}",
            usage.input_tokens, usage.cached_tokens, usage.output_tokens, usage.cache_write_tokens
        );
        if usage.cached_tokens == 0 {
            return Err(format!(
                "harness 解析层没带出 provider 报的缓存命中（cached_tokens={}）",
                usage.cached_tokens
            ));
        }
        Ok(())
    };

    match run() {
        Ok(()) => {}
        Err(message) => panic!("[smoke] {message}"),
    }
}
