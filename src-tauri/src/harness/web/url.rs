use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
}

impl Origin {
    pub fn from_url(raw: &str) -> Result<Self, String> {
        if raw.is_empty() || raw.chars().any(char::is_control) || raw.contains('\\') {
            return Err("URL 为空、含控制字符或反斜杠".to_string());
        }
        let Some((scheme, authority)) = raw.split_once("://") else {
            return Err("URL 缺少 scheme 或 authority".to_string());
        };
        if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
            return Err("只支持 HTTP / HTTPS origin".to_string());
        }
        if authority.is_empty() || authority.starts_with('/') {
            return Err("URL 缺少 host，不做修复解析".to_string());
        }
        let url = reqwest::Url::parse(raw).map_err(|error| error.to_string())?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err("origin 不得包含用户凭据".to_string());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "URL 缺少 host".to_string())?
            .to_ascii_lowercase();
        let host = host.strip_suffix('.').unwrap_or(&host).to_string();
        if host.is_empty() {
            return Err("URL 缺少 host".to_string());
        }
        Ok(Self {
            scheme: url.scheme().to_ascii_lowercase(),
            host,
            port: url.port(),
        })
    }

    pub fn as_str(&self) -> String {
        match self.port {
            Some(port) => format!("{}://{}:{port}", self.scheme, self.host),
            None => format!("{}://{}", self.scheme, self.host),
        }
    }

    pub fn deny_rule(&self) -> String {
        format!("web_fetch({})", self.as_str())
    }

    pub fn from_canonical_deny_rule(rule: &str) -> Option<Self> {
        let raw = rule.strip_prefix("web_fetch(")?.strip_suffix(')')?;
        if raw.contains('(') || raw.contains(')') {
            return None;
        }
        let origin = Self::from_url(raw).ok()?;
        (origin.deny_rule() == rule).then_some(origin)
    }
}

pub fn canonical_web_fetch_origins(rules: &[Value]) -> Vec<String> {
    rules
        .iter()
        .filter_map(Value::as_str)
        .filter_map(Origin::from_canonical_deny_rule)
        .map(|origin| origin.as_str())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_normalizes_case_default_port_and_discards_path_query_fragment() {
        let origin = Origin::from_url("HTTPS://EXAMPLE.COM:443/a?q=1#fragment").unwrap();
        assert_eq!(origin.scheme, "https");
        assert_eq!(origin.host, "example.com");
        assert_eq!(origin.port, None);
        assert_eq!(origin.as_str(), "https://example.com");
        assert_eq!(origin.deny_rule(), "web_fetch(https://example.com)");

        let origin = Origin::from_url("http://Example.Org:8080/a").unwrap();
        assert_eq!(origin.as_str(), "http://example.org:8080");

        let origin = Origin::from_url("HTTPS://EXAMPLE.COM.:443/a").unwrap();
        assert_eq!(origin.as_str(), "https://example.com");
    }

    #[test]
    fn origin_rejects_non_http_userinfo_missing_host_and_control_characters() {
        for raw in [
            "file:///tmp/a",
            "ftp://example.com",
            "https://user:pass@example.com",
            "https:///missing-host",
            "https://example.com/\n injected",
        ] {
            assert!(Origin::from_url(raw).is_err(), "{raw:?}");
        }
    }

    #[test]
    fn canonical_deny_rule_requires_exact_canonical_origin() {
        for raw in [
            "web_fetch(https://example.com)",
            "web_fetch(http://example.org:8080)",
        ] {
            let origin = Origin::from_canonical_deny_rule(raw).unwrap();
            assert_eq!(origin.deny_rule(), raw);
        }
        for raw in [
            "web_fetch(HTTPS://EXAMPLE.COM)",
            "web_fetch(https://example.com:443)",
            "web_fetch(https://example.com/)",
            "web_fetch(https://example.com/path)",
            " web_fetch(https://example.com)",
            "web_fetch(https://user@example.com)",
            "web_search(https://example.com)",
            "web_fetch(not a url)",
        ] {
            assert!(Origin::from_canonical_deny_rule(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn canonical_origin_projection_ignores_every_noncanonical_rule() {
        let rules = vec![
            serde_json::json!("web_fetch(https://example.com)"),
            serde_json::json!("web_fetch(HTTPS://EXAMPLE.COM)"),
            serde_json::json!("web_fetch(https://example.com:443)"),
            serde_json::json!("cli(rm *)"),
            serde_json::json!(17),
        ];
        assert_eq!(
            canonical_web_fetch_origins(&rules),
            vec!["https://example.com".to_string()]
        );
    }
}
