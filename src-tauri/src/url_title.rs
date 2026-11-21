//! 粘贴 URL 取标题（change add-url-paste-title-nov21）。
//!
//! 只做一件事：给一个 http / https URL，返回网页 `<title>` 的**纯文本**；拿不到就返回
//! `None`（正常结果）或错误（由 command 层转成错误信封）。调用方（前端编辑器）对失败
//! 一律保留原始 URL，不把这里当成必须成功的路径。
//!
//! 边界（有意收窄，均可在 tests 里复跑）：
//! - 只认 http / https；其它 scheme 直接拒绝（与 `open_external_url` 的白名单同源）。
//! - 只读 2xx；重定向由 reqwest 跟随（默认上限 10 跳）。
//! - `Content-Type` 头部必须存在；取第一个 `;` 前的 media type、trim 后**精确等于**
//!   `text/html` 或 `application/xhtml+xml`。`text/html-anything` 之类的 MIME 前缀伪装
//!   不接受；缺失头部视为没有标题。
//! - 正文最多 512 KiB；标题最多 500 个字符（超长视为不可用，不截断）。
//! - 只解码 UTF-8；Content-Type 显式声明非 UTF-8 的页面视为没有标题（不猜编码、
//!   不引入 `encoding_rs` 之类的第二个解码器）。
//! - 不执行 JS、不解析完整 DOM：只在原始 HTML 里找第一处 `<title>`（跳过 HTML 注释与
//!   `script` / `style` / `textarea` raw-text 元素），解码常见实体、折叠空白。属性里含
//!   `>` 等更复杂的页面仍可能拿不到；失败路径本来就是「保留 URL」，不构成数据损坏。

use std::io::Read;
use std::time::Duration;

/// 一次取标题的总超时（连接 + 响应体读取）。
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
/// 响应体读取上限：标题在 `<head>` 里，512 KiB 足够覆盖常见页面，避免整站下载。
const MAX_BODY_BYTES: u64 = 512 * 1024;
/// 标题字符数上限：超长标题不是「可用标题」，返回 None 保留 URL。
pub const MAX_TITLE_CHARS: usize = 500;

/// 从 HTML 原文里取 `<title>` 的纯文本；没有 / 空 / 超长返回 None。
pub fn extract_title(html: &str) -> Option<String> {
    // `to_ascii_lowercase` 只改 ASCII、字节长度不变，索引可直接回用到原文切片。
    let lower = html.to_ascii_lowercase();
    let mut search = 0;
    while let Some(relative) = lower[search..].find("<title") {
        let open = search + relative;
        let after = open + "<title".len();
        // 标签名边界：`<titlebar>` 不是 title。
        let boundary = html[after..].chars().next()?;
        if boundary != '>' && !boundary.is_ascii_whitespace() {
            search = after;
            continue;
        }
        if inside_comment(&lower, open) || inside_raw_text(&lower, open) {
            search = after;
            continue;
        }
        let content_start = lower[after..].find('>')? + after + 1;
        let close = lower[content_start..].find("</title")? + content_start;
        let title = normalize_title(&decode_entities(&html[content_start..close]));
        if title.is_empty() {
            return None;
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return None;
        }
        return Some(title);
    }
    None
}

/// 位置 `pos` 是否落在未闭合的 `<!-- ... -->` 里。
fn inside_comment(lower: &str, pos: usize) -> bool {
    let before = &lower[..pos];
    match before.rfind("<!--") {
        Some(start) => before[start + 4..].find("-->").is_none(),
        None => false,
    }
}

/// 位置 `pos` 是否落在 `script` / `style` / `textarea` 的 raw-text 内容里。
///
/// 这些元素的内容按纯文本解析，里面出现的 `<title>` 不是文档标题。只做前向扫描：
/// 找最近一个未闭合的开标签；没有闭合标签即视为仍在元素内。
fn inside_raw_text(lower: &str, pos: usize) -> bool {
    ["script", "style", "textarea"].iter().any(|tag| {
        let open_tag = format!("<{tag}");
        let before = &lower[..pos];
        let Some(open) = before.rfind(&open_tag) else {
            return false;
        };
        // 注释里的 `<script>` 不是开标签（例如 `<!-- <style> --> <title>real</title>`）。
        if inside_comment(lower, open) {
            return false;
        }
        let after_open = &before[open + open_tag.len()..];
        let boundary = after_open.chars().next();
        if !matches!(boundary, Some(ch) if ch == '>' || ch == '/' || ch.is_ascii_whitespace()) {
            return false;
        }
        // 该开标签之后、pos 之前没有闭合标签 ⇒ 仍在 raw-text 内。
        before[open..].find(&format!("</{tag}")).is_none()
    })
}

/// 控制字符 → 空格，连续空白折叠成一个空格并 trim（标题里的换行不能把链接拆行）。
fn normalize_title(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 常见 HTML 实体解码；未知实体保持原文（不猜、不报错）。
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find('&') {
        out.push_str(&rest[..index]);
        let tail = &rest[index..];
        if let Some(semicolon) = tail.find(';') {
            let entity = &tail[1..semicolon];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16)
                        .ok()
                        .and_then(char::from_u32)
                }
                _ if entity.starts_with('#') => {
                    entity[1..].parse::<u32>().ok().and_then(char::from_u32)
                }
                _ => None,
            };
            if let Some(character) = decoded {
                out.push(character);
                rest = &tail[semicolon + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &rest[1..];
    }
    out.push_str(rest);
    out
}

/// 取标题（真实网络路径）；错误只表示「请求本身失败」，没有可用标题是 `Ok(None)`。
pub fn fetch_title(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<Option<String>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("URL 解析失败：{e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("只支持 http、https：{url}"));
    }
    let response = client
        .get(parsed)
        .send()
        .map_err(|e| format!("请求网页失败：{e}"))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    // 头部必须存在；media type 取第一个 `;` 前、trim 后**精确**匹配，不接受
    // `text/html-anything` 这类前缀伪装。charset 独立解析（同一头部、`;` 分段）。
    let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) else {
        return Ok(None);
    };
    let content_type = content_type.to_str().unwrap_or("").to_ascii_lowercase();
    let media_type = content_type.split(';').next().unwrap_or("").trim();
    if media_type != "text/html" && media_type != "application/xhtml+xml" {
        return Ok(None);
    }
    if let Some(charset) = charset_of(&content_type) {
        if charset != "utf-8" && charset != "utf8" {
            return Ok(None);
        }
    }
    let mut body = Vec::new();
    response
        .take(MAX_BODY_BYTES)
        .read_to_end(&mut body)
        .map_err(|e| format!("读取网页内容失败：{e}"))?;
    Ok(extract_title(&String::from_utf8_lossy(&body)))
}

/// `Content-Type` 里的 charset（去掉引号、转小写）；没有则 None（按 UTF-8 处理）。
fn charset_of(content_type: &str) -> Option<String> {
    for part in content_type.split(';').skip(1) {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("charset") {
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_ascii_lowercase());
            }
        }
    }
    None
}

/// 一个只服务一次的确定性 HTTP 服务器（测试专用，`url_title` 与 `commands` 的回归共用）：
/// 绑定 `127.0.0.1` 随机端口、只 accept 一次，不依赖外网。
///
/// accept 是**有界**的（5 秒）：被测命令若在发请求前就失败（例如在运行时上下文里 panic），
/// 服务器线程必须自己退出，否则 `join()` 永久挂住，回归会以「测试超时」而不是「断言失败」
/// 收场（fix/url-title-blocking-nov21 的红色探针就踩过这个坑）。
#[cfg(test)]
pub(crate) fn serve_once(
    status: &'static str,
    content_type: Option<&'static str>,
    body: &'static str,
    delay: Duration,
) -> (String, std::thread::JoinHandle<()>) {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let address = listener.local_addr().expect("addr");
    listener.set_nonblocking(true).expect("nonblocking");
    let handle = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(e) => panic!("accept: {e}"),
            }
        };
        stream.set_nonblocking(false).expect("blocking");
        let mut buffer = [0u8; 1024];
        let _ = stream.read(&mut buffer);
        std::thread::sleep(delay);
        let content_type_header = content_type
            .map(|value| format!("Content-Type: {value}\r\n"))
            .unwrap_or_default();
        let response = format!(
            "HTTP/1.1 {status}\r\n{content_type_header}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    });
    (format!("http://{address}/"), handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn title_basic_and_attributes() {
        assert_eq!(extract_title("<title>Hello</title>"), Some("Hello".into()));
        assert_eq!(
            extract_title("<html><head><TITLE lang=\"zh\">\n  标题  文本 \n</TITLE></head></html>"),
            Some("标题 文本".into())
        );
    }

    #[test]
    fn title_entities_and_control_chars() {
        assert_eq!(
            extract_title("<title>A &amp; B &lt;x&gt; &#39;q&#x27; &nbsp; C</title>"),
            Some("A & B <x> 'q' C".into())
        );
        assert_eq!(
            extract_title("<title>a\u{0}b\u{1}c</title>"),
            Some("a b c".into())
        );
    }

    #[test]
    fn title_missing_empty_or_too_long() {
        assert_eq!(extract_title("<html><body>no title</body></html>"), None);
        assert_eq!(extract_title("<title></title>"), None);
        assert_eq!(extract_title("<title>   </title>"), None);
        assert_eq!(
            extract_title(&format!("<title>{}</title>", "中".repeat(MAX_TITLE_CHARS))),
            Some("中".repeat(MAX_TITLE_CHARS))
        );
        assert_eq!(
            extract_title(&format!(
                "<title>{}</title>",
                "中".repeat(MAX_TITLE_CHARS + 1)
            )),
            None
        );
    }

    #[test]
    fn title_skips_comments_and_non_title_tags() {
        assert_eq!(
            extract_title("<!-- <title>注释里的假标题</title> --><title>真标题</title>"),
            Some("真标题".into())
        );
        assert_eq!(extract_title("<titlebar>不是 title</titlebar>"), None);
        assert_eq!(
            extract_title("<!-- <style> --> <title>注释外的真标题</title>"),
            Some("注释外的真标题".into()),
            "注释里的 raw-text 开标签不得遮蔽后面的真标题"
        );
    }

    #[test]
    fn title_skips_script_style_and_textarea_raw_text() {
        assert_eq!(
            extract_title("<script>\"<title>fake</title>\"</script><title>real</title>"),
            Some("real".into()),
            "script raw-text 里的 <title> 不是文档标题"
        );
        assert_eq!(
            extract_title("<style>.x{content:'<title>fake</title>'}</style><title>real</title>"),
            Some("real".into()),
            "style raw-text 里的 <title> 不是文档标题"
        );
        assert_eq!(
            extract_title("<textarea><title>fake</title></textarea><title>real</title>"),
            Some("real".into()),
            "textarea RCDATA 里的 <title> 不是文档标题"
        );
        assert_eq!(
            extract_title("<script><title>fake</title>"),
            None,
            "未闭合的 script 里没有可用标题"
        );
        // 反向观测：没有 raw-text 的普通页面仍照常取到标题。
        assert_eq!(extract_title("<title>real</title>"), Some("real".into()));
    }

    #[test]
    fn charset_parsing() {
        assert_eq!(charset_of("text/html; charset=utf-8"), Some("utf-8".into()));
        assert_eq!(charset_of("text/html;charset=\"GBK\""), Some("gbk".into()));
        assert_eq!(charset_of("text/html"), None);
    }

    #[test]
    fn rejects_non_http_schemes_before_network() {
        let client = client(Duration::from_millis(100));
        assert!(fetch_title(&client, "mailto:someone@example.invalid").is_err());
        assert!(fetch_title(&client, "file:///tmp/x").is_err());
        assert!(fetch_title(&client, "not a url").is_err());
    }

    fn client(timeout: Duration) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(timeout)
            .user_agent("Lumir/test")
            .build()
            .expect("test client")
    }

    #[test]
    fn fetch_success_reads_title() {
        let (url, server) = serve_once(
            "200 OK",
            Some("text/html; charset=utf-8"),
            "<html><head><title>来自本地服务器</title></head></html>",
            Duration::ZERO,
        );
        let result = fetch_title(&client(Duration::from_secs(2)), &url);
        server.join().expect("server");
        assert_eq!(result, Ok(Some("来自本地服务器".into())));
    }

    #[test]
    fn fetch_non_success_and_non_html_and_no_title_are_none() {
        for (status, content_type, body) in [
            ("404 Not Found", "text/html", "<title>404</title>"),
            ("200 OK", "application/json", "{\"title\":\"x\"}"),
            ("200 OK", "text/html", "<html><body>no title</body></html>"),
            (
                "200 OK",
                "text/html; charset=gbk",
                "<title>编码不可信</title>",
            ),
        ] {
            let (url, server) = serve_once(status, Some(content_type), body, Duration::ZERO);
            let result = fetch_title(&client(Duration::from_secs(2)), &url);
            server.join().expect("server");
            assert_eq!(result, Ok(None), "{status} / {content_type} / {body}");
        }
    }

    #[test]
    fn fetch_requires_present_exact_html_media_type() {
        let cases: [(
            &str,
            Option<&'static str>,
            &'static str,
            Option<&'static str>,
        ); 6] = [
            ("缺失头部", None, "<title>x</title>", None),
            (
                "text/html 前缀伪装",
                Some("text/html-anything"),
                "<title>x</title>",
                None,
            ),
            (
                "xhtml 前缀伪装",
                Some("application/xhtml+xml-anything"),
                "<title>x</title>",
                None,
            ),
            (
                "精确 text/html",
                Some("text/html"),
                "<title>x</title>",
                Some("x"),
            ),
            (
                "精确 xhtml",
                Some("application/xhtml+xml"),
                "<title>x</title>",
                Some("x"),
            ),
            (
                "media type 前后空白 + 大写",
                Some(" Text/HTML ; charset=UTF-8"),
                "<title>x</title>",
                Some("x"),
            ),
        ];
        for (label, content_type, body, expected) in cases {
            let (url, server) = serve_once("200 OK", content_type, body, Duration::ZERO);
            let result = fetch_title(&client(Duration::from_secs(2)), &url);
            server.join().expect("server");
            assert_eq!(
                result,
                Ok(expected.map(str::to_string)),
                "{label}：{content_type:?}"
            );
        }
    }

    #[test]
    fn fetch_timeout_is_error() {
        let (url, server) = serve_once(
            "200 OK",
            Some("text/html"),
            "<title>迟到</title>",
            Duration::from_millis(300),
        );
        let result = fetch_title(&client(Duration::from_millis(50)), &url);
        server.join().expect("server");
        assert!(result.is_err(), "超时必须走失败路径（前端保留 URL）");
    }
}
