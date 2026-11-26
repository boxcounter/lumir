use std::net::IpAddr;

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

/// 解析前的静态主机拒绝：只用到 URL 里已写死的字面量，与 provider 配置、DNS、网络都无关。
/// 调用点有两处，缺一不可——`basic_args` 在 provider 解析与批准预览之前先拦一次（任何配置状态
/// 都不得掩盖 URL 安全拒绝），`run_preflight` 每个 hop 再拦一次（redirect 目标不经 `basic_args`）。
pub(crate) fn blocked_host(host: &str) -> Option<&'static str> {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let host = host.strip_suffix('.').unwrap_or(host);
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".local") {
        return Some("localhost / .local 目标被禁止");
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !globally_routable(ip) {
            return Some("IP 目标不是全局单播地址");
        }
    }
    None
}

pub(crate) fn globally_routable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ipv4_globally_routable(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                ipv4_globally_routable(mapped)
            } else if let Some(compatible) = ip.to_ipv4() {
                ipv4_globally_routable(compatible)
            } else {
                ipv6_globally_routable(ip)
            }
        }
    }
}

fn ipv4_globally_routable(ip: std::net::Ipv4Addr) -> bool {
    let octets = ip.octets();
    let value = u32::from(ip);
    !(octets[0] == 0
        || octets[0] == 10
        || octets[0] == 127
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
        || (octets[0] == 169 && octets[1] == 254)
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
        || (octets[0] >= 224)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
        || value == u32::MAX)
}

fn ipv6_globally_routable(ip: std::net::Ipv6Addr) -> bool {
    let segments = ip.segments();
    !(segments[0] == 0
        || (segments[0] & 0xff00) == 0xff00
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0000)
        || (segments[0] == 0x2001 && segments[1] == 0x0002)
        || (segments[0] == 0x2002)
        || ((segments[0] & 0xfff0) == 0x3ff0)
        || (segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0010)
        || (segments[0] == 0x2001 && (segments[1] & 0xfff0) == 0x0020)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] & 0xe000) != 0x2000)
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

    #[test]
    fn blocked_host_rejects_local_names_and_non_global_ip_literals() {
        for host in [
            "localhost",
            "LOCALHOST",
            "localhost.",
            "printer.local",
            "printer.local.",
            "127.0.0.1",
            "10.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
        ] {
            assert!(blocked_host(host).is_some(), "{host}");
        }
        for host in [
            "example.com",
            "example.com.",
            "93.184.216.34",
            "2001:4860:4860::8888",
        ] {
            assert!(blocked_host(host).is_none(), "{host}");
        }
    }

    #[test]
    fn global_ip_rules_cover_reserved_and_mapped_addresses() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "224.0.0.1",
            "240.0.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "0.0.0.0",
            "255.255.255.255",
            "::1",
            "::",
            "ff02::1",
            "2001:db8::1",
            "3fff::1",
            "3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "2002:7f00:1::",
            "2002:c0a8:101::",
            "2002:5db8:d822::",
            "2001::1",
            "2001:0:5db8:d822::1",
            "2001:2::1",
            "2001:10::1",
            "2001:20::1",
            "fd00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(!globally_routable(ip), "{ip}");
        }
        for ip in [
            "93.184.216.34",
            "203.0.114.1",
            "2001:4860:4860::8888",
            "::ffff:93.184.216.34",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(globally_routable(ip), "{ip}");
        }
    }
}
