//! SVG 源图片的栅格化（change svg-image-quote-oct24；方向裁决：Alex 2026-10-24「好，采纳 A」）。
//!
//! 背景：预览 / 枚举层认 10 种图片扩展名（含 svg），而写入口只收位图，且 Kimi / DeepSeek /
//! OpenAI 三家的图片输入都不收 SVG——SVG 引用因此必然走「枚举成功 → 落盘拒绝」的半成功路径。
//! 本模块是那条路径的出口：把 SVG 渲成位图，再交回既有位图链路（PNG → WebP → 内容寻址落盘）。
//! 动机、方案对比与安全条款的来源见 survey 报告
//! `.local/reports/quote-image-pipeline-oct24.md` §4.4（方案 C）与 §4.5。
//!
//! # 安全条款（survey §4.5，逐条落地；改本文件前先读一遍）
//!
//! 1. **MUST NOT pass-through 原样存 SVG。** 本模块只产出位图（PNG），调用方写进 harness 存储的
//!    永远是 `pasted-<hash16>.webp`。SVG 是带外部引用的 XML（`<image href>` / CSS / `url(#…)`），
//!    原样留存等于让每一个渲染点去解析用户 vault 里的任意 XML。
//! 2. **外部资源加载显式关闭**（[`safe_options`]）：usvg 的默认 string resolver 把 `href` 当文件
//!    路径 `std::fs::read`（绝对路径、相对路径、`file:` 之外的一切路径形态都会被读），这是本能力
//!    唯一会触碰 vault 之外文件的面，因此换成恒 `None` 的闭包。`data:` URI 保留默认 resolver：
//!    它是**内联载荷**（base64 / percent 编码），零 I/O、零外部引用。`<use href="#id">` 这类
//!    文档内引用由 usvg 在解析期解析，不产生文件 I/O。
//! 3. **尺寸上限**（[`fit_to_limit`]）：viewBox → 位图尺寸的换算在本模块做，最长边夹到
//!    [`MAX_EDGE`]。50MB 的**输入字节**上限拦不住 `viewBox="0 0 100000 100000"`——小字节、大画布，
//!    不夹取就是一次内存放大（4096×4096×4B ≈ 67MB 是上限代价）。
//! 4. **产物走既有位图链路**：本模块只产 PNG，转码 / 命名 / 缩略图 / 投递 / 恢复全部复用既有
//!    实现（`fs_io::convert_attachment` → `transcode_png_to_webp`）——`image_dimensions` 只解位图，
//!    落盘名仍是 `pasted-<hash16>.webp`，链路零改动。
//! 5. **`<text>` 依赖系统字体**（[`system_fonts`] + fontdb 装载系统字体）：引用的是**渲染这一刻的
//!    快照**，与 Chromium 里的预览可能不同形——这是接受的语义，不是缺陷。
//!
//! 另：本仓任何路径 **MUST NOT 用 `innerHTML` 内联 SVG**（survey §4.5 第 3 条）。栅格化方案下前端
//! 拿到的只有位图引用名，那条禁令因此不需要额外的代码防线——但也别「顺手」把这条路径改成回传
//! SVG 源码：那会把禁令重新变回活约束。
//!
//! `mod` 声明的位置：本文件由 [`crate::fs_io`] 用 `#[path]` 声明（见该文件的模块声明处）——本
//! mission 的改动面不含 `lib.rs`，`#[path]` 指回 `src/svg_raster.rs` 与在 crate 根声明等价。

use std::sync::{Arc, OnceLock};

// `usvg` / `tiny_skia` 从 `resvg` 的**重导出**取，不各立一条直接依赖：三个 crate 的版本必须
// 精确配套（`resvg::render` 收的就是它自己那份 `usvg::Tree` 与 `tiny_skia::PixmapMut`），
// 逐条声明反而引入「声明版本与 resvg 期望版本不一致」的漂移面。
use resvg::{tiny_skia, usvg};

use crate::commands::CommandError;

/// 栅格化输出的最长边上限（像素）。survey §4.5 第 2 条的建议值：够看清一张图的细节，又让最坏
/// 情形（正方形）的 pixmap 停在 4096×4096×4B ≈ 67MB——与 50MB 输入上限同一量级，不会把内存
/// 合同（ADR 0002 §6）撕开。
pub(crate) const MAX_EDGE: u32 = 4096;

/// 系统字体库（进程内只装载一次）。
///
/// `<text>` 的渲染依赖字体，usvg 需要 fontdb 且要**自己装系统字体**（它不内嵌任何字体）。
/// `load_system_fonts` 会遍历系统字体目录（数百个字体文件，几十毫秒量级），因此在这里做一次性
/// 缓存：引用一张 SVG 与引用十张的成本必须同阶，不能每张图重扫一遍字体目录。
///
/// 代价与语义：引用的是**渲染快照**——同一份 SVG 在别的机器 / 别的系统字体集上可能不同形，
/// 预览（Chromium）与本产物也可能不同形（survey §4.5 第 5 条，接受的语义）。
fn system_fonts() -> Arc<usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

/// 栅格化用的解析选项（安全条款 2 的唯一落点）。
///
/// `resolve_string: None` 恒拒——**这是本模块的安全边界，MUST NOT 换成默认 resolver**：默认实现
/// 把 `href` 当文件路径直接 `std::fs::read`（`usvg::ImageHrefResolver::default_string_resolver`），
/// 一张带 `<image href="/etc/passwd">` 或 `href="../../secret.png"` 的 SVG 就能把 vault 之外的
/// 文件读进渲染结果。`resolve_data` 保留默认：`data:` URI 是内联载荷，没有任何 I/O。
fn safe_options() -> usvg::Options<'static> {
    usvg::Options {
        fontdb: system_fonts(),
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: usvg::ImageHrefResolver::default_data_resolver(),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    }
}

/// 位图目标尺寸与渲染缩放（安全条款 3）：最长边夹到 [`MAX_EDGE`]，短边按同一比例缩。
///
/// 返回 `(宽, 高, scale)`：`scale` 与像素尺寸同源，调用方用同一个值做 `Transform::from_scale`，
/// 因此夹取不会改变长宽比（唯一例外是浮点 `ceil` 多出的 1 像素被 clamp 掉，肉眼不可见）。
/// 输入要求：`width` / `height` 有限且为正（调用方先校验）。
fn fit_to_limit(width: f32, height: f32) -> (u32, u32, f32) {
    let longest = width.max(height);
    let limit = MAX_EDGE as f32;
    let scale = if longest > limit {
        limit / longest
    } else {
        1.0
    };
    let px_w = (width * scale).ceil().clamp(1.0, limit) as u32;
    let px_h = (height * scale).ceil().clamp(1.0, limit) as u32;
    (px_w, px_h, scale)
}

/// SVG 字节 → PNG 字节（无损位图，带直通 alpha）。
///
/// 链路：`usvg` 解析（安全选项）→ 尺寸夹取 → `resvg` 渲染到 pixmap → PNG 编码。
/// 失败一律 `attachment_decode_failed` / `attachment_encode_failed`——沿用写入口既有的错误
/// 码族（`src/copy-data.ts` 的 ERROR_COPY 已有映射），不新造码。
pub(crate) fn rasterize_svg_to_png(bytes: &[u8]) -> Result<Vec<u8>, CommandError> {
    rasterize_with(bytes, &safe_options())
}

/// 栅格化核心（选项由调用方给）：生产路径一律经 [`safe_options`]，本函数暴露选项只为一件事——
/// 单测能证明「默认 resolver 真的会读外部文件」（见 tests 的反向输入）。
fn rasterize_with(bytes: &[u8], opt: &usvg::Options<'_>) -> Result<Vec<u8>, CommandError> {
    let tree = usvg::Tree::from_data(bytes, opt).map_err(|e| {
        CommandError::new(
            "attachment_decode_failed",
            format!("无法解析 SVG 图片：{e}"),
        )
        .param("reason", e.to_string())
    })?;
    let size = tree.size();
    let (width, height) = (size.width(), size.height());
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(CommandError::new(
            "attachment_decode_failed",
            "无法栅格化 SVG 图片：画布尺寸非法（viewBox / width / height 必须是正数）",
        )
        .param("reason", format!("size={width}x{height}")));
    }
    let (px_w, px_h, scale) = fit_to_limit(width, height);
    let mut pixmap = tiny_skia::Pixmap::new(px_w, px_h).ok_or_else(|| {
        CommandError::new(
            "attachment_decode_failed",
            format!("无法分配位图：{px_w}×{px_h}"),
        )
        .param("reason", "pixmap allocation failed")
    })?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    // `encode_png` 内部做 premultiplied → straight alpha 的还原（tiny-skia 的 `take_demultiplied`），
    // 因此下游 `image` crate 解出来的像素是标准直通 alpha，与 png 粘贴路径逐像素同口径。
    pixmap.encode_png().map_err(|e| {
        CommandError::new("attachment_encode_failed", format!("无法编码位图：{e}"))
            .param("reason", e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 解 PNG（下游 `transcode_png_to_webp` 走的就是 `image` crate，这里同一条解码口径）。
    fn decode_png(png: &[u8]) -> image::RgbaImage {
        let decoded = image::load_from_memory_with_format(png, image::ImageFormat::Png)
            .expect("栅格化产物必须是合法 PNG");
        decoded.to_rgba8()
    }

    /// 深色不透明像素数（白底黑字判据：字体装了才有字形，没装就只剩白底）。
    fn dark_pixels(img: &image::RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p[3] > 200 && p[0] < 80 && p[1] < 80 && p[2] < 80)
            .count()
    }

    /// 明显红色像素数（外部图片判据：真的读进来了才有红）。
    fn red_pixels(img: &image::RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p[3] > 200 && p[0] > 200 && p[1] < 60 && p[2] < 60)
            .count()
    }

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lumir-svg-raster-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 白底 + 黑字，200×80。字体族只给一个 macOS / CI 都在的通用家族。
    const TEXT_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
  <rect width="200" height="80" fill="#ffffff"/>
  <text x="12" y="56" font-family="Helvetica" font-size="44" fill="#000000">Lumir</text>
</svg>"##;

    #[test]
    fn rasterizes_text_with_system_fonts() {
        let img = decode_png(&rasterize_svg_to_png(TEXT_SVG.as_bytes()).expect("渲染成功"));
        assert_eq!(
            img.dimensions(),
            (200, 80),
            "位图尺寸取 viewBox / width-height"
        );
        assert!(
            dark_pixels(&img) > 0,
            "字体没装载时 usvg 会丢掉字形、只剩白底——这条断言即 fontdb 生效的判据"
        );
        // 反向输入（断言有区分度）：同一形状不带 <text> 时，深色像素必须为 0。
        let no_text = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
  <rect width="200" height="80" fill="#ffffff"/>
</svg>"##;
        let bare = decode_png(&rasterize_svg_to_png(no_text.as_bytes()).expect("渲染成功"));
        assert_eq!(dark_pixels(&bare), 0, "无文字的形状不该有深色像素");
    }

    #[test]
    fn external_file_href_is_not_read() {
        let dir = tmpdir("external");
        let red_path = dir.join("red.png");
        image::RgbImage::from_pixel(8, 8, image::Rgb([255, 0, 0]))
            .save(&red_path)
            .unwrap();
        assert!(
            red_path.is_file(),
            "夹具得真的在盘上，否则本用例不构成反向输入"
        );

        let svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <image href="{href}" width="40" height="40"/>
</svg>"##,
            href = red_path.display()
        );

        // 安全条款 2：生产选项下，外部文件的字节 MUST NOT 进渲染结果。
        let img = decode_png(&rasterize_svg_to_png(svg.as_bytes()).expect("渲染成功"));
        assert_eq!(
            red_pixels(&img),
            0,
            "外部 href 被读进来了——resolve_string 的关闭失效了"
        );

        // 反向输入（REVIEW.md「断言等价于子串」条的判据有区分度要求）：用**默认** resolver 渲染
        // 同一份 SVG 时必须读到红色。它证明上一条断言不是「本来就渲染不出东西」的空转，也把
        // 「默认 resolver 会读本地文件」这条危险钉在测试里。
        let dangerous =
            decode_png(&rasterize_with(svg.as_bytes(), &usvg::Options::default()).unwrap());
        assert!(
            red_pixels(&dangerous) > 0,
            "默认 resolver 没读到本地文件：本用例的前提变了，安全条款 2 的判据需要重写"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inline_data_uri_image_is_kept() {
        // data: URI 是内联载荷（零 I/O）。它必须仍然渲染——否则「关掉外部资源」会退化成
        // 「所有 <image> 都不渲染」，那是另一种失真（survey §4.5 只要求关外部引用）。
        let red_png = {
            let img = image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0]));
            let mut buf = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgb8(img)
                .write_to(&mut buf, image::ImageFormat::Png)
                .unwrap();
            buf.into_inner()
        };
        let svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <image href="data:image/png;base64,{data}" width="20" height="20"/>
</svg>"##,
            data = crate::fs_io::base64_encode(&red_png)
        );
        let img = decode_png(&rasterize_svg_to_png(svg.as_bytes()).expect("渲染成功"));
        assert!(red_pixels(&img) > 0, "内联 data: 图片应当照常渲染");
    }

    #[test]
    fn huge_viewbox_is_clamped_to_max_edge() {
        // 小字节、大画布：这是 SVG 特有、png 路径不存在的攻击面（50MB 输入上限拦不住）。
        let square = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000 100000">
  <rect width="100000" height="100000" fill="#336699"/>
</svg>"##;
        let img = decode_png(&rasterize_svg_to_png(square.as_bytes()).expect("渲染成功"));
        assert_eq!(
            img.dimensions(),
            (MAX_EDGE, MAX_EDGE),
            "正方形夹到 4096×4096"
        );

        // 长宽比 1:200：最长边照样停在 4096，短边按同一比例缩（夹取不改长宽比）。
        let thin = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 200000">
  <rect width="1000" height="200000" fill="#336699"/>
</svg>"##;
        let img = decode_png(&rasterize_svg_to_png(thin.as_bytes()).expect("渲染成功"));
        assert_eq!(
            img.dimensions(),
            (21, MAX_EDGE),
            "1000×200000 → 20.48 ≈ 21 像素宽"
        );
    }

    #[test]
    fn malformed_xml_is_rejected() {
        let err = rasterize_svg_to_png(b"<svg><rect").unwrap_err();
        assert_eq!(err.code, "attachment_decode_failed");
        // 非 UTF-8 同样走同一条失败面（usvg 只收 UTF-8 文本）。
        let err = rasterize_svg_to_png(&[0xff, 0xfe, 0x00]).unwrap_err();
        assert_eq!(err.code, "attachment_decode_failed");
        // 不是 SVG 的合法 XML 也会被 usvg 拒（根元素不是 svg）。
        let err = rasterize_svg_to_png(b"<html><body>x</body></html>").unwrap_err();
        assert_eq!(err.code, "attachment_decode_failed");
    }
}
