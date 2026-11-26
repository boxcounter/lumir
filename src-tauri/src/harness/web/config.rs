use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::config::{
    ConfigDiagnostic, DiagnosticSeverity, HarnessConfig, HarnessProviderConfig, ProviderPreset,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebApproval {
    #[default]
    AllowAll,
    Ask,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebAccessConfigStatus {
    #[default]
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WebAccessConfig {
    pub enabled: bool,
    pub approval: WebApproval,
    pub status: WebAccessConfigStatus,
}

impl Default for WebAccessConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            approval: WebApproval::AllowAll,
            status: WebAccessConfigStatus::Valid,
        }
    }
}

impl WebAccessConfig {
    pub fn is_valid_and_enabled(self) -> bool {
        self.enabled && self.status == WebAccessConfigStatus::Valid
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum WebProviderStatus {
    Ready,
    NotEvaluated,
    Missing,
    MissingKey,
    Ambiguous,
    CustomBaseUrl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebProviderUnavailable {
    Missing,
    MissingKey,
    Ambiguous,
    CustomBaseUrl,
}

impl WebProviderUnavailable {
    pub fn status(self) -> WebProviderStatus {
        match self {
            Self::Missing => WebProviderStatus::Missing,
            Self::MissingKey => WebProviderStatus::MissingKey,
            Self::Ambiguous => WebProviderStatus::Ambiguous,
            Self::CustomBaseUrl => WebProviderStatus::CustomBaseUrl,
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ResolvedWebProvider {
    pub provider_id: String,
    pub api_key: String,
}

impl std::fmt::Debug for ResolvedWebProvider {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResolvedWebProvider")
            .field("provider_id", &self.provider_id)
            .field("api_key", &"[REDACTED]")
            .finish()
    }
}

pub type WebProviderResolution = Result<ResolvedWebProvider, WebProviderUnavailable>;

pub fn validate_web_access(raw: Option<&Value>) -> (WebAccessConfig, Option<ConfigDiagnostic>) {
    let invalid = || {
        (
            WebAccessConfig {
                enabled: false,
                approval: WebApproval::Ask,
                status: WebAccessConfigStatus::Invalid,
            },
            Some(ConfigDiagnostic {
                code: "web_access_config_invalid".to_string(),
                path: Some("harness.web_access".to_string()),
                severity: DiagnosticSeverity::RejectOnWrite,
                message: "配置项 harness.web_access 显式非法；网页访问已按 enabled=false、approval=ask 关闭，请显式修复 enabled / approval".to_string(),
            }),
        )
    };
    let Some(raw) = raw else {
        return (
            WebAccessConfig {
                enabled: true,
                approval: WebApproval::AllowAll,
                status: WebAccessConfigStatus::Valid,
            },
            None,
        );
    };
    let Some(table) = raw.as_object() else {
        return invalid();
    };
    let enabled = match table.get("enabled") {
        None => true,
        Some(Value::Bool(value)) => *value,
        Some(_) => return invalid(),
    };
    let approval = match table.get("approval") {
        None => WebApproval::AllowAll,
        Some(Value::String(value)) if value == "allow_all" => WebApproval::AllowAll,
        Some(Value::String(value)) if value == "ask" => WebApproval::Ask,
        Some(_) => return invalid(),
    };
    (
        WebAccessConfig {
            enabled,
            approval,
            status: WebAccessConfigStatus::Valid,
        },
        None,
    )
}

pub fn resolve_web_provider(config: &HarnessConfig) -> WebProviderResolution {
    if let Some((id, entry)) = config.active_provider() {
        if entry.preset == ProviderPreset::Deepseek {
            return resolve_deepseek_entry(id, entry);
        }
    }

    let mut candidates = config.providers.iter().filter(|(_, entry)| {
        entry.preset == ProviderPreset::Deepseek
            && !entry.api_key.trim().is_empty()
            && official_base_url(entry)
    });
    match (candidates.next(), candidates.next()) {
        (Some((id, entry)), None) => {
            return Ok(ResolvedWebProvider {
                provider_id: id.clone(),
                api_key: entry.api_key.clone(),
            });
        }
        (Some(_), Some(_)) => return Err(WebProviderUnavailable::Ambiguous),
        _ => {}
    }

    let deepseek_entries: Vec<_> = config
        .providers
        .values()
        .filter(|entry| entry.preset == ProviderPreset::Deepseek)
        .collect();
    if deepseek_entries
        .iter()
        .any(|entry| !official_base_url(entry))
    {
        Err(WebProviderUnavailable::CustomBaseUrl)
    } else if deepseek_entries.is_empty() {
        Err(WebProviderUnavailable::Missing)
    } else {
        Err(WebProviderUnavailable::MissingKey)
    }
}

fn resolve_deepseek_entry(id: &str, entry: &HarnessProviderConfig) -> WebProviderResolution {
    if !official_base_url(entry) {
        return Err(WebProviderUnavailable::CustomBaseUrl);
    }
    if entry.api_key.trim().is_empty() {
        return Err(WebProviderUnavailable::MissingKey);
    }
    Ok(ResolvedWebProvider {
        provider_id: id.to_string(),
        api_key: entry.api_key.clone(),
    })
}

fn official_base_url(entry: &HarnessProviderConfig) -> bool {
    let official = ProviderPreset::Deepseek
        .official_base_url()
        .expect("DeepSeek 必有官方地址");
    entry
        .base_url
        .as_deref()
        .map(|url| url.trim().trim_end_matches('/') == official)
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{test_harness, test_provider, HarnessConfig, ProviderPreset};

    fn deepseek(
        id: &str,
        key: &str,
        base_url: Option<&str>,
    ) -> (String, crate::config::HarnessProviderConfig) {
        let mut entry = test_provider(ProviderPreset::Deepseek, key, &[]);
        entry.base_url = base_url.map(str::to_string);
        (id.to_string(), entry)
    }

    fn config(
        active: &str,
        entries: Vec<(String, crate::config::HarnessProviderConfig)>,
    ) -> HarnessConfig {
        HarnessConfig {
            provider: active.to_string(),
            providers: entries.into_iter().collect(),
            ..Default::default()
        }
    }

    #[test]
    fn web_provider_active_deepseek_uses_only_that_entry_without_models() {
        let active = deepseek(
            "deepseek-active",
            "active-secret",
            Some("https://api.deepseek.com/"),
        );
        let other = deepseek("deepseek-other", "other-secret", None);
        let harness = config("deepseek-active", vec![active, other]);
        let resolved = resolve_web_provider(&harness).expect("active 官方条目可用");
        assert_eq!(resolved.provider_id, "deepseek-active");
        assert_eq!(resolved.api_key, "active-secret");
        assert!(
            !harness.providers["deepseek-active"].configured,
            "测试必须证明不依赖 models/configured"
        );
    }

    #[test]
    fn web_provider_active_deepseek_never_falls_back() {
        for (key, base_url, expected) in [
            ("", None, WebProviderUnavailable::MissingKey),
            ("   ", None, WebProviderUnavailable::MissingKey),
            (
                "active-secret",
                Some("https://example.invalid/v1"),
                WebProviderUnavailable::CustomBaseUrl,
            ),
        ] {
            let active = deepseek("deepseek-active", key, base_url);
            let other = deepseek("deepseek-other", "other-secret", None);
            let harness = config("deepseek-active", vec![active, other]);
            assert_eq!(resolve_web_provider(&harness), Err(expected));
        }
    }

    #[test]
    fn web_provider_non_deepseek_active_accepts_only_one_official_candidate() {
        let kimi = (
            "kimi-work".to_string(),
            test_provider(ProviderPreset::Kimi, "kimi-secret", &[]),
        );
        let official = deepseek("deepseek-official", "official-secret", None);
        let harness = config("kimi-work", vec![kimi.clone(), official]);
        let resolved = resolve_web_provider(&harness).expect("唯一候选可用");
        assert_eq!(resolved.provider_id, "deepseek-official");
        assert_eq!(resolved.api_key, "official-secret");

        let second = deepseek(
            "deepseek-second",
            "second-secret",
            Some("https://api.deepseek.com/"),
        );
        let first = deepseek("deepseek-official", "official-secret", None);
        let harness = config("kimi-work", vec![kimi.clone(), first, second]);
        assert_eq!(
            resolve_web_provider(&harness),
            Err(WebProviderUnavailable::Ambiguous)
        );

        let custom = deepseek(
            "deepseek-custom",
            "custom-secret",
            Some("https://example.invalid"),
        );
        let harness = config("kimi-work", vec![kimi, custom]);
        assert_eq!(
            resolve_web_provider(&harness),
            Err(WebProviderUnavailable::CustomBaseUrl)
        );
    }

    #[test]
    fn web_provider_missing_is_distinct_from_missing_key() {
        let kimi = (
            "kimi-work".to_string(),
            test_provider(ProviderPreset::Kimi, "kimi-secret", &[]),
        );
        let harness = config("kimi-work", vec![kimi.clone()]);
        assert_eq!(
            resolve_web_provider(&harness),
            Err(WebProviderUnavailable::Missing)
        );
        let harness = config(
            "kimi-work",
            vec![kimi, deepseek("deepseek-empty", "", None)],
        );
        assert_eq!(
            resolve_web_provider(&harness),
            Err(WebProviderUnavailable::MissingKey)
        );
    }

    #[test]
    fn web_provider_without_active_can_still_resolve_unique_candidate() {
        let harness = config("", vec![deepseek("deepseek-only", "only-secret", None)]);
        let resolved = resolve_web_provider(&harness).expect("无 active 时仍按唯一候选规则");
        assert_eq!(resolved.provider_id, "deepseek-only");
    }

    #[test]
    fn web_access_validation_distinguishes_every_missing_key_from_explicit_null() {
        for raw in [None, Some(&serde_json::json!({}))] {
            let (config, diagnostic) = validate_web_access(raw);
            assert!(config.enabled);
            assert_eq!(config.approval, WebApproval::AllowAll);
            assert_eq!(config.status, WebAccessConfigStatus::Valid);
            assert!(diagnostic.is_none());
        }
        for raw in [
            serde_json::json!(null),
            serde_json::json!({"enabled": null}),
            serde_json::json!({"approval": null}),
        ] {
            let (config, diagnostic) = validate_web_access(Some(&raw));
            assert!(!config.enabled);
            assert_eq!(config.approval, WebApproval::Ask);
            assert_eq!(config.status, WebAccessConfigStatus::Invalid);
            assert_eq!(diagnostic.unwrap().code, "web_access_config_invalid");
        }
    }

    #[test]
    fn web_provider_test_harness_helper_does_not_change_resolution_rules() {
        let harness = test_harness(
            "deepseek-work",
            test_provider(ProviderPreset::Deepseek, "secret", &[]),
        );
        assert!(resolve_web_provider(&harness).is_ok());
    }
}
