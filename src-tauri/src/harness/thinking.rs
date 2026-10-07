//! 思考过程与思考程度（change add-harness-thinking-display-and-effort，ADR 0008 Phase 2 提案 3）。
//!
//! 本模块收两块方向相反的职责，都与「思考」有关：
//!
//! - **输出侧（给模型 → 给人看）**：[`reasoning_text`] 从 provider 的 reasoning 项里取出**明文**
//!   思考文本，供 [`super::turn`] 转发 `reasoning_chunk` 事件。它**只读**回放项，绝不参与回放
//!   路径——M306 的捕获 / 合成 / 回传纪律一行不改（见 [`super::llm`] 模块头），这里是新增的
//!   纯函数，回放侧三组测试（capture / synthesize / replay）不受它影响。
//! - **输入侧（给人选 → 给模型）**：[`ThinkingEffort`] 三档与 [`apply_effort`] 映射表，把档位翻成
//!   各 provider 的请求参数。「该 provider + model 是否支持程度调节」的判据自 M373 起归
//!   配置 schema（`HarnessConfig::effort_supported`，能力表 = `[harness].providers.<id>.models`
//!   的逐模型声明，缺省内置 preset）——本模块的 k3 词元判定已退役，只保留请求映射这一半。
//!
//! # 官方文档核实（2026-10-07，一手文档）
//!
//! 两家都走 OpenAI Responses API（[`super::llm`] 的 `{base}/responses`），程度参数**同形**——
//! 顶层 `reasoning` 对象里的 `effort`，取值 `low` / `high` / `max`：
//!
//! - **DeepSeek**：`{"reasoning": {"effort": "low"|"high"|"max"}}`，默认 `high`
//!   （[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) 的「Control Parameter
//!   (Responses API Format)」列；[Responses API](https://api-docs.deepseek.com/guides/responses_api/)
//!   的 `reasoning` 行：「Partially supported. effort supported」）。其取值档位由兼容层映射
//!   （`min→low`、`medium→high`、`xhigh→high`、`ultra→max`），对外可请求的就是这三档。
//! - **Kimi**：`{"reasoning": {"effort": "low"|"high"|"max"}}`，默认 `max`
//!   （[Responses API](https://platform.kimi.ai/docs/api/responses) 的 `reasoning.effort` schema；
//!   [Reasoning Effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort) 指南）。
//!
//! 能力边界（哪些模型支持）的核实记录与逐模型声明在 config.rs 的模型 preset 文档
//! （`KIMI_MODEL_PRESET` / `DEEPSEEK_MODEL_PRESET`）——schema 是唯一真源，这里不复制。
//!
//! 档位命名 Low / High / Max 与默认 High 是 Alex 2026-10-06 节点 1 裁决（沿用两家命名）；
//! 档位名作为专有名词，zh/en 两档界面均保持英文原文。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 思考程度三档（Alex 2026-10-06 裁决：Low / High / Max，默认 High）。
///
/// **闭集合**：取值校验在 Rust 侧完成，前端拿到的必是三档之一（与 `UiTheme` / `HarnessProvider`
/// 同一形态）。档位名作为专有名词，zh/en 两档界面均保持英文原文，故序列化为小写英文原词。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ThinkingEffort {
    Low,
    High,
    Max,
}

/// 出厂默认档位 High（Alex 2026-10-06 裁决；新建会话回到这一档，不写回配置）。
impl Default for ThinkingEffort {
    fn default() -> Self {
        Self::High
    }
}

impl ThinkingEffort {
    /// 请求参数取值（两家同形，直接用小写英文原名）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
            Self::Max => "max",
        }
    }
}

/// 把档位写进请求体（provider 调用点的映射表，[`super::llm`] 的请求构造调用）。
///
/// 两家 Responses API 参数同形（模块头文档）：顶层 `reasoning.effort`。`supported` 为 false 时
/// **不发**该字段（把无效参数发给不支持它的模型只会换来 400 或被静默忽略，两条都不是我们
/// 想要的）——判据由调用侧从配置 schema 现算（`HarnessConfig::effort_supported`，M373：
/// 能力表的唯一真源在 `[harness].providers.<id>.models`，前端置灰读 `harness_state` 快照的
/// `thinking.supported`，同一 schema 读数）。
pub fn apply_effort(body: &mut serde_json::Value, supported: bool, effort: ThinkingEffort) {
    if !supported {
        return;
    }
    body["reasoning"] = serde_json::json!({ "effort": effort.as_str() });
}

/// 从 provider 的 reasoning 项里取出**明文**思考文本（输出侧，只读）。
///
/// 两种产出形态（两家合并口径，2026-10-07 文档核实）：
/// - `content` 数组的 `reasoning_text` part（deepseek thinking 实测形态；M306 单测的
///   `DEEPSEEK_REASONING_ITEM` 即此）；
/// - `summary` 数组的 `summary_text` part（kimi 输出 reasoning 项的形态，
///   [Responses API](https://platform.kimi.ai/docs/api/responses) 的 `ResponsesOutputReasoningItem`）。
///
/// kimi 文档写明 `content` 优先于 `summary`，故先取 `content`、为空再取 `summary`。
///
/// **只返回明文**：`encrypted_content`（kimi 的密文回放体）永不进入本函数的返回值——一致性
/// 原则的反向半边（design §5：不对人展示的也不进事件，前端永远只拿到明文思考文本）。
/// 无文本（reasoning 项缺 content / summary，或全是空串）返回 `None`，调用侧据此不产生事件。
pub fn reasoning_text(item: &serde_json::Value) -> Option<String> {
    for key in ["content", "summary"] {
        let Some(parts) = item.get(key).and_then(|v| v.as_array()) else {
            continue;
        };
        let text: String = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
            .collect();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::HarnessConfig;

    // ---- 映射表：三档 × supported 布尔 ----

    #[test]
    fn apply_effort_writes_reasoning_effort_when_supported() {
        for (effort, want) in [
            (ThinkingEffort::Low, "low"),
            (ThinkingEffort::High, "high"),
            (ThinkingEffort::Max, "max"),
        ] {
            let mut body = serde_json::json!({"model": "kimi-k3"});
            apply_effort(&mut body, true, effort);
            assert_eq!(body["reasoning"]["effort"], want);
        }
    }

    #[test]
    fn apply_effort_is_noop_when_unsupported() {
        // 不支持就不发字段：既不是发空对象，也不是发错值。
        let mut body = serde_json::json!({"model": "kimi-k2.6"});
        apply_effort(&mut body, false, ThinkingEffort::Max);
        assert!(
            body.get("reasoning").is_none(),
            "不支持 effort 不得写入 reasoning 字段：{body}"
        );
    }

    #[test]
    fn apply_effort_default_is_high() {
        assert_eq!(ThinkingEffort::default(), ThinkingEffort::High);
        assert_eq!(ThinkingEffort::default().as_str(), "high");
        // 序列化形态 = 请求参数取值（前端 chip 读数与请求字段同源）。
        assert_eq!(
            serde_json::to_value(ThinkingEffort::Low).unwrap(),
            serde_json::json!("low")
        );
        assert_eq!(
            serde_json::to_value(ThinkingEffort::Max).unwrap(),
            serde_json::json!("max")
        );
    }

    // ---- 能力判据的调用口径（真源在 config schema；这里钉「映射表消费的是 schema 读数」） ----

    #[test]
    fn effort_supported_reads_schema_presets() {
        // 出厂配置（内置 preset）：与 M372 修复后的线上口径逐条对齐。
        let config = HarnessConfig::default();
        for (provider, model, want) in [
            (crate::config::HarnessProvider::Kimi, "kimi-k3", true),
            (crate::config::HarnessProvider::Kimi, "k3-256k", true),
            (
                crate::config::HarnessProvider::Kimi,
                "kimi-code/k3-256k",
                false,
            ),
            (crate::config::HarnessProvider::Kimi, "kimi-k2.6", false),
            (
                crate::config::HarnessProvider::Kimi,
                "kimi-k2.7-code",
                false,
            ),
            (crate::config::HarnessProvider::Kimi, "kimi-k30", false),
            (
                crate::config::HarnessProvider::Deepseek,
                "deepseek-flash",
                true,
            ),
            (
                crate::config::HarnessProvider::Deepseek,
                "deepseek-v4-pro",
                true,
            ),
            (crate::config::HarnessProvider::Mock, "whatever", true),
        ] {
            assert_eq!(
                config.effort_supported(&provider, model),
                want,
                "{provider:?}/{model}"
            );
        }
        // 订阅端复合 id（kimi-code/k3-256k）在 preset 里没有逐字条目 ⇒ 置灰；
        // 用户要在配置里显式声明它（models 覆盖），不再靠词元猜测。
    }

    // ---- 输出侧：reasoning 文本提取 ----

    #[test]
    fn reasoning_text_reads_reasoning_text_parts() {
        // deepseek thinking 实测形态（M306 fixture 同形）。
        let item = serde_json::json!({
            "type": "reasoning",
            "id": "rs_1",
            "content": [{"type": "reasoning_text", "text": "先读 a.md。"}],
            "encrypted_content": "resp-0"
        });
        assert_eq!(reasoning_text(&item).as_deref(), Some("先读 a.md。"));
    }

    #[test]
    fn reasoning_text_reads_summary_parts_for_kimi_shape() {
        // kimi 输出 reasoning 项：summary 数组的 summary_text part。
        let item = serde_json::json!({
            "type": "reasoning",
            "id": "rs_2",
            "summary": [
                {"type": "summary_text", "text": "第一步。"},
                {"type": "summary_text", "text": "第二步。"}
            ],
            "encrypted_content": null
        });
        assert_eq!(reasoning_text(&item).as_deref(), Some("第一步。第二步。"));
    }

    #[test]
    fn reasoning_text_prefers_content_over_summary() {
        let item = serde_json::json!({
            "type": "reasoning",
            "content": [{"type": "reasoning_text", "text": "正文思考"}],
            "summary": [{"type": "summary_text", "text": "摘要思考"}]
        });
        assert_eq!(reasoning_text(&item).as_deref(), Some("正文思考"));
    }

    /// 密文永不进明文提取：只有 encrypted_content、没有明文 part 的项 ⇒ None。
    /// 这条是「不对人展示的也不进事件」的反向守卫（design §5）。
    #[test]
    fn reasoning_text_never_leaks_encrypted_content() {
        let item = serde_json::json!({
            "type": "reasoning",
            "id": "rs_3",
            "encrypted_content": "891a103a-secret"
        });
        assert_eq!(reasoning_text(&item), None);
        // 空 part / 空文本同样不产出（防下游渲染空思考块）。
        let empty = serde_json::json!({"content": [{"type": "reasoning_text", "text": ""}]});
        assert_eq!(reasoning_text(&empty), None);
    }
}
