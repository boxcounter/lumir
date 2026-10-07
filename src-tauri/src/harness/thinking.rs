//! 思考过程与思考程度（change add-harness-thinking-display-and-effort，ADR 0008 Phase 2 提案 3）。
//!
//! 本模块收两块方向相反的职责，都与「思考」有关：
//!
//! - **输出侧（给模型 → 给人看）**：[`reasoning_text`] 从 provider 的 reasoning 项里取出**明文**
//!   思考文本，供 [`super::turn`] 转发 `reasoning_chunk` 事件。它**只读**回放项，绝不参与回放
//!   路径——M306 的捕获 / 合成 / 回传纪律一行不改（见 [`super::llm`] 模块头），这里是新增的
//!   纯函数，回放侧三组测试（capture / synthesize / replay）不受它影响。
//! - **输入侧（给人选 → 给模型）**：[`ThinkingEffort`] 三档与 [`apply_effort`] 映射表，把档位翻成
//!   各 provider 的请求参数；[`supported`] 给出「该 provider + model 是否支持程度调节」，供
//!   `harness_state` 快照把置灰判据交给前端（Alex 2026-10-06 裁决点 2：不支持即置灰）。
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
//! **参数名与取值同形，但能力边界不同**：Kimi 的 `reasoning_effort` / `reasoning.effort` 只
//! 由 **k3 系**模型支持——[Thinking Models](https://platform.kimi.ai/docs/guide/use-thinking-models)
//! 的请求字段对照表写明 `kimi-k2.7-code` / `kimi-k2.6` 的 `reasoning_effort` 为「Not supported」，
//! 且 Responses 端点「currently supports kimi-k3」。故 [`supported`] 对 kimi 按模型判定：仅 k3 系
//! 为真，其余置灰（MUST NOT 把无效参数发给不支持它的模型）。DeepSeek 侧现役模型都支持。
//!
//! 档位命名 Low / High / Max 与默认 High 是 Alex 2026-10-06 节点 1 裁决（沿用两家命名）；
//! 档位名作为专有名词，zh/en 两档界面均保持英文原文。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::HarnessProvider;

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

/// 该 provider + model 是否支持思考程度调节（前端 chip 置灰判据）。
///
/// - **mock**：fixture 驱动，收到什么记什么（验收要断言档位确实到达请求）⇒ 恒定支持。
/// - **deepseek**：现役 `deepseek-flash` / `deepseek-v4-pro` 都支持 `reasoning.effort`（文档见模块头）。
/// - **kimi**：仅 k3 系模型支持 `reasoning.effort`；k2.x（含 `kimi-k2.6` / `kimi-k2.7-code`）不支持
///   （文档见模块头）。kimi 的 Responses 端点「currently supports kimi-k3」，故非 k3 系在此置灰。
pub fn supported(provider: &HarnessProvider, model: &str) -> bool {
    match provider {
        HarnessProvider::Mock | HarnessProvider::Deepseek => true,
        HarnessProvider::Kimi => is_kimi_k3(model),
    }
}

/// k3 系模型判定：按**非字母数字字符切词元**后存在恰为 `k3` 的词元。
///
/// 命中：`kimi-k3`（出厂默认）/ `kimi-k3-turbo`（将来的开放平台变体）/ `k3-256k` /
/// `kimi-code/k3-256k`（Kimi Code 订阅端 id——M372 实测 Alex 配置的就是它，K3-256k 支持
/// effort，chip 此前被误判置灰）。
///
/// **不做前缀宽容**（`kimi-k30` / `k3x` 不算）：模型 id 是外部契约，只认官方命名形态，
/// 宁可置灰也不错发。词元判定对两类官方命名（`kimi-k3` 系与订阅端 `k3-…` 系）同一条规则
/// 覆盖，避免按前缀枚举漏掉订阅端新变体（如将来的 `k3-1m`）。
fn is_kimi_k3(model: &str) -> bool {
    model
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|token| token == "k3")
}

/// 把档位写进请求体（provider 调用点的映射表，[`super::llm`] 的请求构造调用）。
///
/// 两家 Responses API 参数同形（模块头文档）：顶层 `reasoning.effort`。provider 不支持时**不发**
/// 该字段（把无效参数发给不支持它的模型只会换来 400 或被静默忽略，两条都不是我们想要的），
/// 由前端置灰兜住「用户看不到可选」这一层（Alex 裁决点 2）。
pub fn apply_effort(
    body: &mut serde_json::Value,
    provider: &HarnessProvider,
    model: &str,
    effort: ThinkingEffort,
) {
    if !supported(provider, model) {
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

    fn kimi() -> HarnessProvider {
        HarnessProvider::Kimi
    }
    fn deepseek() -> HarnessProvider {
        HarnessProvider::Deepseek
    }
    fn mock() -> HarnessProvider {
        HarnessProvider::Mock
    }

    // ---- 能力判定（前端置灰判据）----

    #[test]
    fn support_is_provider_and_model_dependent() {
        // kimi：仅 k3 系（文档：k2.6 / k2.7-code 的 reasoning_effort 是「Not supported」）。
        assert!(supported(&kimi(), "kimi-k3"));
        assert!(supported(&kimi(), "kimi-k3-turbo"));
        // Kimi Code 订阅端 id（M372：Alex 实测配置；K3-256k 是 k3 系、支持 effort）。
        assert!(supported(&kimi(), "k3-256k"));
        assert!(supported(&kimi(), "kimi-code/k3-256k"));
        // 将来的订阅端变体同规则命中（如 k3-1m）。
        assert!(supported(&kimi(), "k3-1m"));
        assert!(!supported(&kimi(), "kimi-k2.6"));
        assert!(!supported(&kimi(), "kimi-k2.7-code"));
        // 历史出厂默认值（M365 前的 `DEFAULT_KIMI_MODEL`）：kimi-k2 已于 2026-05-25 退役（404），
        // 它不是 k3 系 ⇒ 置灰（旧配置若尚未被 M365 的迁移改写，判定不变）。
        assert!(!supported(&kimi(), "kimi-k2"));
        // 现役出厂默认值必须可用——它是 harness 的首次会话形态，灰了就没人能动档位。
        assert!(supported(&kimi(), crate::config::DEFAULT_KIMI_MODEL));
        // 前缀不宽容：kimi-k30 不是 k3 系命名。
        assert!(!supported(&kimi(), "kimi-k30"));
        // deepseek：现役模型都支持；未知模型也按支持（provider 级能力，模型加白名单只会漏）。
        assert!(supported(&deepseek(), "deepseek-flash"));
        assert!(supported(&deepseek(), "deepseek-v4-pro"));
        // mock：fixture 驱动，恒定支持（验收要断言档位到达请求）。
        assert!(supported(&mock(), "whatever"));
    }

    // ---- 映射表：三档 × 各 provider ----

    #[test]
    fn apply_effort_writes_reasoning_effort_for_both_real_providers() {
        for (provider, model) in [(deepseek(), "deepseek-flash"), (kimi(), "kimi-k3")] {
            for (effort, want) in [
                (ThinkingEffort::Low, "low"),
                (ThinkingEffort::High, "high"),
                (ThinkingEffort::Max, "max"),
            ] {
                let mut body = serde_json::json!({"model": model});
                apply_effort(&mut body, &provider, model, effort);
                assert_eq!(
                    body["reasoning"]["effort"], want,
                    "{provider:?}/{model} 的 {effort:?} 应映射为 {want}"
                );
            }
        }
    }

    #[test]
    fn apply_effort_is_noop_for_unsupported_provider() {
        // 不支持就不发字段：既不是发空对象，也不是发错值。
        for model in ["kimi-k2.6", "kimi-k2.7-code", "kimi-k2"] {
            let mut body = serde_json::json!({"model": model});
            apply_effort(&mut body, &kimi(), model, ThinkingEffort::Max);
            assert!(
                body.get("reasoning").is_none(),
                "{model} 不支持 effort，不得写入 reasoning 字段：{body}"
            );
        }
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
