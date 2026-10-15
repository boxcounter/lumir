//! 窗口底色跟随主题（M525，openspec/specs/app-window「窗口底色跟随主题」合同）。
//!
//! 为什么有这一层：原生窗口底色（macOS 上即 `NSWindow` 的 background color）是
//! WKWebView **未绘制区域**的呈现色——冷启动首帧、后台化/遮挡后的揭示重绘间隙，
//! webview 尚未（重新）合成内容时用户看到的就是它。默认是白，深色主题下呈「白闪」；
//! 这里把它钉成当前主题的 `--content-bg` 解析值，网页内的未绘制区由 CSS body 底色
//! （`var(--content-bg)`，src/style.css）兜底，两层同色。
//!
//! 平台行为（tauri 2.11.5 / wry 0.55 / tao 0.35 源码核对，不是凭记忆）：
//! - `WebviewWindow::set_background_color` 同时打**窗口层**与 **webview 层**。
//!   macOS 上窗口层（NSWindow `setBackgroundColor`）可用且**运行时可改**；webview 层
//!   在 macOS 上是 no-op（wry 的 `set_background_color` 的 macOS 分支只在 `transparent`
//!   feature 下编译，未开时静默 `Ok`）——正合需要：网页内的未绘制区已由 CSS 管，
//!   窗口层只管 webview 整体缺席的间隙。
//! - 本 crate 未开 tauri 的 `transparent` feature（Cargo.toml 默认特性集），因此
//!   wry 不会用 `drawsBackground` 私有 KVC 关 WKWebView 自绘——运行期改色只动
//!   NSWindow 层，不碰 webview 的自绘行为。
//!
//! 色值真源：CSS token（src/style.css 三主题块，逐值权威文本是
//! docs/specs/design-tokens-v1.md）。运行期同步由前端 applyTheme（src/main.ts，
//! data-theme 唯一施加点）读 `getComputedStyle(body)` 解析值经
//! [`window_set_background_color`] 送达——Rust 侧不存运行期色值表（REVIEW.md 第 8 条）。
//! 唯一的例外是启动路径：webview JS 运行前窗口就要有色，`[ui] theme` → RGB 的映射以
//! [`CONTENT_BG_*`] 常量存在，由本模块测试解析 style.css / tauri.conf.json 逐值比对
//! 钉死——改 token 忘改表 = cargo test 红。

use tauri::window::Color;
use tauri::Manager;

use crate::commands::CommandError;
use crate::config::{self, UiTheme};

/// light 档 `--content-bg`（#fdfdfc）。启动常量，真源是 src/style.css 的 token 块。
const CONTENT_BG_LIGHT: (u8, u8, u8) = (0xfd, 0xfd, 0xfc);
/// dark 档 `--content-bg`（#222326）。
const CONTENT_BG_DARK: (u8, u8, u8) = (0x22, 0x23, 0x26);
/// eink 档 `--content-bg`（#ffffff）。
const CONTENT_BG_EINK: (u8, u8, u8) = (0xff, 0xff, 0xff);

/// `[ui] theme` → `--content-bg` 的启动映射。仅启动路径使用（webview JS 运行前）；
/// 运行期色值一律来自前端计算样式（见模块头）。
fn content_bg_of(theme: UiTheme) -> (u8, u8, u8) {
    match theme {
        UiTheme::Light => CONTENT_BG_LIGHT,
        UiTheme::Dark => CONTENT_BG_DARK,
        UiTheme::Eink => CONTENT_BG_EINK,
    }
}

fn set_window_background(
    window: &tauri::WebviewWindow,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), CommandError> {
    window
        .set_background_color(Some(Color(r, g, b, 0xff)))
        .map_err(|e| {
            CommandError::new("window_background_failed", format!("设置窗口底色失败：{e}"))
                .param("reason", e)
        })
}

/// 启动路径的窗口底色施加（在 `lumir-vault-restore` 线程上、先于 vault 恢复执行）。
///
/// 时序：窗口在 setup 里已 show()（底色先取构建配置 `backgroundColor`，见
/// tauri.conf.json 与本模块测试的逐值钉死），这里把底色拨到配置主题档——与 webview
/// 首帧竞赛，通常落在首帧之前；即使落后，也只是深色档下短暂呈现出厂浅色，随后
/// applyTheme 的运行期同步会再校正一次。`config::load` 的这次小读在线程侧——
/// M159 的硬约束是 setup 主线程 MUST NOT 同步 load config，线程侧读与恢复路径的
/// 既有读同惯例；配置读失败回落 light（与出厂档一致，零可感差异）。
pub(crate) fn apply_startup_window_background(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) else {
        eprintln!("lumir: 未找到主窗口，启动窗口底色未施加");
        return;
    };
    let theme = config::load()
        .map(|snapshot| snapshot.config.ui.theme)
        .unwrap_or(UiTheme::Light);
    let (r, g, b) = content_bg_of(theme);
    if let Err(e) = set_window_background(&window, r, g, b) {
        eprintln!("lumir: 施加启动窗口底色失败（保持构建配置档）：{e}");
    }
}

/// 运行期同步原生窗口底色（前端 `applyTheme` 的唯一伴生 invoke，M525）。
///
/// 色值由前端从 `getComputedStyle(body)` 读取（CSS token 是唯一真源，本 command
/// 不判色值、不持色值表）。失败是装饰性的：合同要求只降级（前端 console 线索），
/// MUST NOT 阻断主题切换。webview 层在 macOS 上是 no-op（见模块头），平台错误只会
/// 来自窗口层设置本身——实践中 NSSetBackgroundColor 不失败，这里是契约完整性兜底。
#[tauri::command(rename_all = "snake_case")]
pub fn window_set_background_color(
    app: tauri::AppHandle,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), CommandError> {
    let Some(window) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) else {
        return Err(CommandError::new(
            "window_background_failed",
            "设置窗口底色失败：主窗口不存在",
        )
        .param("reason", "主窗口不存在"));
    };
    set_window_background(&window, r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_to_rgb(hex: &str) -> Option<(u8, u8, u8)> {
        let hex = hex.strip_prefix('#')?;
        if hex.len() != 6 {
            return None;
        }
        let n = u32::from_str_radix(hex, 16).ok()?;
        Some((
            ((n >> 16) & 0xff) as u8,
            ((n >> 8) & 0xff) as u8,
            (n & 0xff) as u8,
        ))
    }

    /// 解析 src/style.css 指定主题块里 `--content-bg` 的值（如 `#222326`）。
    /// 找不到 / 形状不符返回 None——调用方断言必须命中（None 即红）。
    fn css_content_bg(theme: &str) -> Option<(u8, u8, u8)> {
        let css = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/style.css"))
            .ok()?;
        let start = css.find(&format!(":root[data-theme=\"{theme}\"]"))?;
        let block = &css[start..];
        let block = &block[..block.find('}')?];
        let line = block.lines().find(|l| l.contains("--content-bg:"))?;
        let raw = line.split("--content-bg:").nth(1)?.trim();
        let hex = raw.trim_end_matches(';').trim();
        hex_to_rgb(hex)
    }

    /// 启动表（Rust 侧唯一的色值副本）必须与 CSS token 逐值一致——这是「运行期
    /// 单一真源 + 启动例外」这条纪律的机器兜底（REVIEW.md 第 8 条）。
    #[test]
    fn startup_table_matches_css_tokens() {
        assert_eq!(Some(CONTENT_BG_LIGHT), css_content_bg("light"));
        assert_eq!(Some(CONTENT_BG_DARK), css_content_bg("dark"));
        assert_eq!(Some(CONTENT_BG_EINK), css_content_bg("eink"));
    }

    /// 构建配置 `backgroundColor`（webview JS 运行前的窗口底色兜底，含冷启动首帧）
    /// 必须与 light token 逐值一致——它是静态值，只能钉出厂档。
    #[test]
    fn conf_background_color_matches_light_token() {
        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"))
                .unwrap(),
        )
        .unwrap();
        let color = conf["app"]["windows"][0]["backgroundColor"]
            .as_str()
            .unwrap();
        assert_eq!(Some(CONTENT_BG_LIGHT), hex_to_rgb(color));
    }
}
