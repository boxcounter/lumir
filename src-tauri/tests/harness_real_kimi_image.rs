//! 真 provider 冒烟（M440，change harness-composer-image-paste tasks 5.1）：实测当前配置的
//! Kimi 模型是否接受 `input_image`（base64 data URL 形态）——harness 打的是 Kimi 的
//! Responses 端点（`https://api.moonshot.cn/v1`），该端点对图片输入的接受性此前没有
//! 本地证据（proposal 外部信源节），本用例补上实测结论，作为 Alex 配置里各模型
//! `vision` 声明值的依据。
//!
//! 运行：`cargo test --test harness_real_kimi_image -- --ignored --nocapture`
//! 默认 `#[ignore]`（烧真 token，门禁不跑）。无 key 环境自动 SKIP（通过）。
//! 模型 id 可用 `LUMIR_KIMI_MODEL` 临时覆盖（不改 Alex 的 config 文件）。
//!
//! **key 纪律**：只从 `~/.config/lumir/config.json` 原地读（`LUMIR_CONFIG_JSON` 可改路径），
//! 绝不打印、绝不写入任何日志 / 断言消息 / JSONL；断言失败时只输出事件 code。

use lumir_lib::config::{HarnessConfig, HarnessProvider};
use lumir_lib::fs_io;
use lumir_lib::harness::llm::{self};
use lumir_lib::harness::thinking::ThinkingEffort;

/// 从 ~/.config/lumir/config.json 原地读 kimi 配置（key 不落任何输出）。
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

/// 合成 64×64 纯红 png（fixture 全合成；问颜色是为了让「模型真读到了图」可判定）。
fn red_square_png() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 32, 32]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageFormat::Png)
        .unwrap();
    buf.into_inner()
}

#[test]
#[ignore = "真 provider 冒烟：烧真 token，默认门禁不跑；无 key 环境自动 SKIP"]
fn real_kimi_accepts_input_image_data_url() {
    let run = || -> Result<(), String> {
        let Some((api_key, configured_model, base_url)) = kimi_config_from_disk() else {
            eprintln!("[smoke] 无 kimi key（config.json 缺失或未配置），SKIP");
            return Ok(());
        };
        // LUMIR_KIMI_MODEL 临时覆盖（核实正确 id 时用它，不改 Alex 的 config）。
        let model = std::env::var("LUMIR_KIMI_MODEL")
            .ok()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(configured_model);

        let mut config = HarnessConfig {
            provider: HarnessProvider::Kimi,
            ..HarnessConfig::default()
        };
        config.providers.kimi.api_key = api_key;
        config.providers.kimi.model = model.clone();
        config.providers.kimi.base_url = base_url;

        let mut client = llm::client(&config, "vault-smoke-1")
            .map_err(|e| format!("client 装配失败：code={}", e.code))?;

        // 直发一条含 input_image（data URL）的 user 消息，不带工具——判据就是
        // 「端点接受 input_image data URL 形态」这一件事；展开/引用链路由 mock 验收覆盖。
        let data_url = format!(
            "data:image/png;base64,{}",
            fs_io::base64_encode(&red_square_png())
        );
        let request = llm::Request {
            system: "You are a helpful assistant.".to_string(),
            input: vec![serde_json::json!({
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "这张图片是什么颜色的？只回答颜色名。"},
                    {"type": "input_image", "image_url": data_url},
                ],
            })],
            tools: Vec::new(),
            effort: ThinkingEffort::default(),
        };
        let output = client.complete(&request, &llm::DiscardStreamSink);
        let Some(error) = &output.error else {
            // 无 error：端点接受了 input_image。再判「真读到了图」——回答应含红色词。
            let text = output.text.to_lowercase();
            assert!(
                text.contains("红") || text.contains("red"),
                "模型应答出图片颜色（红/red），实际答非所图——投递形态或模型能力存疑：{text}"
            );
            println!("[smoke] PASS model={model} accepted=input_image(data URL) vision_read=true");
            return Ok(());
        };
        // 被拒：只输出 code + 端点消息不含 key（message 可能携带请求回显，截断防灌屏）。
        eprintln!(
            "[smoke] FAIL model={model} rejected code={} message={:.200}",
            error.code, error.message
        );
        Err(format!("rejected: code={}", error.code))
    };

    let result = run();
    result.unwrap();
}
