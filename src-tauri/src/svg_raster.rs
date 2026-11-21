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
//! 6. **递归 / 循环引用交给 usvg 的解析期防护**（resvg 0.50 起）：clipPath / mask / pattern /
//!    filter 的 `feImage` / marker 之间经 `url(#…)` 成环的引用会被检出、当作缺失处理；
//!    `xlink:href` 链走进环也不再死循环。`<use>` 的展开深度由 [`safe_options`] 钉在
//!    [`usvg::DEFAULT_MAX_DEPTH`]（1024，与 0.48 的硬编码上限同值）。本模块不自己写递归探测，
//!    但回归判据 MUST 用「旧版真的挂死 / abort」的输入（见 tests 的
//!    `dangerous_recursive_references_terminate`），不能拿普通 SVG 的空转当覆盖。
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
/// 文件读进渲染结果。`resolve_data` 保留默认：`data:` URI 是内联载荷，没有任何 I/O；即使内联的是
/// 一张子 SVG，usvg 也经 `from_data_nested` 强制把它的 `resolve_string` 关掉（安全条款 2 的递归
/// 版本，回归见 tests 的 `external_href_inside_inline_svg_data_uri_is_not_read`）。
///
/// `max_depth` 显式钉在默认值：0.50 起它是 `Options` 的字段，不再硬编码——不钉住的话，上游改
/// 默认值就会静默放宽 `<use>` 展开的递归深度上限（0.48 的上限就是 1024，这里保持同值）。
fn safe_options() -> usvg::Options<'static> {
    usvg::Options {
        fontdb: system_fonts(),
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: usvg::ImageHrefResolver::default_data_resolver(),
            resolve_string: Box::new(|_, _| None),
        },
        max_depth: usvg::DEFAULT_MAX_DEPTH,
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

    /// 明显绿色像素数。
    fn green_pixels(img: &image::RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p[3] > 200 && p[0] < 60 && p[1] > 90 && p[2] < 60)
            .count()
    }

    /// 明显蓝色像素数。
    fn blue_pixels(img: &image::RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p[3] > 200 && p[0] < 60 && p[1] < 60 && p[2] > 200)
            .count()
    }

    /// 明显黑色像素数。
    fn black_pixels(img: &image::RgbaImage) -> usize {
        img.pixels()
            .filter(|p| p[3] > 200 && p[0] < 60 && p[1] < 60 && p[2] < 60)
            .count()
    }

    /// 非全透明像素数。
    fn opaque_pixels(img: &image::RgbaImage) -> usize {
        img.pixels().filter(|p| p[3] > 0).count()
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

    // 危险输入（递归 / 循环引用）的回归夹具。判据不是「上游说修了」，而是 resvg 0.48.1 实测：
    //   clip_path_cycle / pattern_inherited_fill   → 栈溢出 SIGABRT（进程直接死）
    //   gradient_href_loop / gradient_href_long_chain → 20s 不返回（死循环）
    // 0.50.0 下全部 200×200 秒回。夹具都是最小合成图形，不含真实文档内容。

    /// 三个 clipPath 首尾相接成环（间接自引用）。
    const CLIP_PATH_CYCLE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <clipPath id="a" clip-path="url(#b)"><rect x="40" y="20" width="120" height="160"/></clipPath>
  <clipPath id="b" clip-path="url(#c)"><rect x="20" y="40" width="160" height="120"/></clipPath>
  <clipPath id="c" clip-path="url(#a)"><rect x="60" y="60" width="120" height="120"/></clipPath>
  <rect x="62" y="62" width="96" height="96" fill="#ff0000"/>
  <rect width="200" height="200" fill="#008000" clip-path="url(#a)"/>
</svg>"##;

    /// pattern 通过父分组继承的 `fill` 引用回自己（继承属性形成的环）。
    const PATTERN_INHERITED_FILL_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g fill="url(#p)">
    <pattern id="p" patternUnits="userSpaceOnUse" width="40" height="40">
      <rect width="20" height="20" fill="#008000"/>
      <rect x="22" y="22" width="16" height="16" stroke="#0000ff" stroke-width="4"/>
    </pattern>
    <rect x="20" y="20" width="160" height="160" stroke="#00008b"/>
  </g>
</svg>"##;

    /// marker → pattern → marker 的两跳环。
    const MARKER_PATTERN_CYCLE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <marker id="m" refX="20" refY="20" markerWidth="40" markerHeight="40" markerUnits="userSpaceOnUse">
    <rect x="2" y="2" width="36" height="36" fill="url(#p)" stroke="#0000ff" stroke-width="4"/>
  </marker>
  <pattern id="p" patternUnits="userSpaceOnUse" width="20" height="20">
    <path d="M 2 10 L 18 10" stroke="#008000" stroke-width="8" marker-start="url(#m)"/>
  </pattern>
  <rect x="20" y="100" width="160" height="80" fill="url(#p)"/>
  <path d="M 50 50 L 150 50" stroke="#000000" stroke-width="2" marker-start="url(#m)"/>
</svg>"##;

    /// mask → marker → mask 的两跳环。
    const MASK_MARKER_CYCLE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
    <path d="M 40 140 L 160 140" stroke="#ffffff" stroke-width="40" marker-start="url(#mk)"/>
  </mask>
  <marker id="mk" refX="20" refY="20" markerWidth="40" markerHeight="40" markerUnits="userSpaceOnUse">
    <rect x="2" y="2" width="36" height="36" fill="#ffffff" stroke="#0000ff" stroke-width="4" mask="url(#m)"/>
  </marker>
  <rect x="20" y="100" width="160" height="80" fill="#008000" mask="url(#m)"/>
  <path d="M 100 40 L 100 90" stroke="#0000ff" stroke-width="4" marker-start="url(#mk)"/>
</svg>"##;

    /// feImage 引用包含它的那个元素（filter 自引用）。
    const FE_IMAGE_SELF_CYCLE_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
  <defs><filter id="f"><feImage xlink:href="#r"/></filter></defs>
  <rect id="r" x="20" y="20" width="160" height="160" fill="#ff0000" filter="url(#f)"/>
</svg>"##;

    /// `xlink:href` 从 c 引入 a↔b 的环。
    const GRADIENT_HREF_LOOP_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
  <linearGradient id="a" xlink:href="#b"/>
  <linearGradient id="b" xlink:href="#a" spreadMethod="reflect"/>
  <linearGradient id="c" xlink:href="#a" x2="0.25">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="1" stop-color="#000000"/>
  </linearGradient>
  <rect x="20" y="20" width="160" height="160" fill="url(#c)"/>
</svg>"##;

    /// 长链 g1→g2→…→g10→g3：环不包含链首元素（0.48 在这里死循环得最久）。
    const GRADIENT_HREF_LONG_CHAIN_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
  <linearGradient id="g1" xlink:href="#g2" x2="0.25"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>
  <linearGradient id="g2" xlink:href="#g3"/>
  <linearGradient id="g3" xlink:href="#g4"/>
  <linearGradient id="g4" xlink:href="#g5"/>
  <linearGradient id="g5" xlink:href="#g6"/>
  <linearGradient id="g6" xlink:href="#g7"/>
  <linearGradient id="g7" xlink:href="#g8"/>
  <linearGradient id="g8" xlink:href="#g9"/>
  <linearGradient id="g9" xlink:href="#g10"/>
  <linearGradient id="g10" xlink:href="#g3"/>
  <rect x="20" y="20" width="160" height="160" fill="url(#g1)"/>
</svg>"##;

    const DANGEROUS_FIXTURES: [&str; 7] = [
        "clip_path_cycle",
        "pattern_inherited_fill",
        "marker_pattern_cycle",
        "mask_marker_cycle",
        "fe_image_self_cycle",
        "gradient_href_loop",
        "gradient_href_long_chain",
    ];

    fn dangerous_svg(name: &str) -> &'static str {
        match name {
            "clip_path_cycle" => CLIP_PATH_CYCLE_SVG,
            "pattern_inherited_fill" => PATTERN_INHERITED_FILL_SVG,
            "marker_pattern_cycle" => MARKER_PATTERN_CYCLE_SVG,
            "mask_marker_cycle" => MASK_MARKER_CYCLE_SVG,
            "fe_image_self_cycle" => FE_IMAGE_SELF_CYCLE_SVG,
            "gradient_href_loop" => GRADIENT_HREF_LOOP_SVG,
            "gradient_href_long_chain" => GRADIENT_HREF_LONG_CHAIN_SVG,
            other => panic!("未知的危险输入：{other}"),
        }
    }

    /// 环被切断后仍要渲染出「该有的内容」——只判「没挂」会让一张空白位图也算通过。
    fn check_dangerous_output(name: &str, img: &image::RgbaImage) {
        assert_eq!(img.dimensions(), (200, 200), "{name}: 位图尺寸");
        match name {
            "clip_path_cycle" => {
                assert!(
                    green_pixels(img) > 5000,
                    "{name}: 切断环后 clip 仍应生效，留下裁剪后的绿色区域"
                );
                assert_eq!(img.get_pixel(10, 10)[3], 0, "{name}: 裁剪区域之外必须透明");
                let center = img.get_pixel(100, 100);
                assert!(
                    center[1] > 90 && center[0] < 60 && center[2] < 60,
                    "{name}: 中心应落在裁剪区内的绿色上"
                );
            }
            "pattern_inherited_fill" => {
                assert!(green_pixels(img) > 1000, "{name}: pattern 的绿色块");
                assert!(blue_pixels(img) > 1000, "{name}: pattern 的蓝色描边");
            }
            "marker_pattern_cycle" => {
                assert!(
                    green_pixels(img) > 1000,
                    "{name}: marker/pattern 的绿色笔画"
                );
                assert!(blue_pixels(img) > 100, "{name}: marker 的蓝色描边");
                assert!(black_pixels(img) > 50, "{name}: 普通 path 的黑色描边");
            }
            "mask_marker_cycle" => {
                assert!(green_pixels(img) > 1000, "{name}: mask 内的绿色");
                assert!(blue_pixels(img) > 100, "{name}: marker 的蓝色描边");
            }
            "fe_image_self_cycle" => {
                assert!(
                    red_pixels(img) > 10_000,
                    "{name}: feImage 自引用被拒后，红色矩形照常渲染"
                );
            }
            "gradient_href_loop" => {
                // 不把环的切断点写死（上游换一条边切断，方向会变），只断言「渐变还在」：
                // 多个灰阶说明 stop 生效，而不是退化成纯色。
                let shades: std::collections::HashSet<u8> =
                    img.pixels().filter(|p| p[3] == 255).map(|p| p[0]).collect();
                assert!(
                    shades.len() > 20,
                    "{name}: 渐变应有多个灰阶，实际只有 {} 种",
                    shades.len()
                );
            }
            "gradient_href_long_chain" => {
                // 长链进入环后没有可继承的 stop，0.50 渲染成纯黑。本用例只判「终止 + 有输出」，
                // 具体的降级形态属于上游语义，不在这里写死。
                assert!(opaque_pixels(img) > 10_000, "{name}: 长链也要有可见输出");
            }
            other => panic!("未知的危险输入：{other}"),
        }
    }

    const DANGER_CHILD_ENV: &str = "LUMIR_SVG_RASTER_DANGER_FIXTURE";
    const DANGER_DEADLINE: std::time::Duration = std::time::Duration::from_secs(20);

    /// 子进程入口：由 [`dangerous_recursive_references_terminate`] 以 `--ignored --exact` 驱动。
    #[test]
    #[ignore = "由 dangerous_recursive_references_terminate 以子进程驱动"]
    fn dangerous_fixture_child() {
        let name = std::env::var(DANGER_CHILD_ENV).unwrap_or_else(|_| {
            panic!("本用例只能由 dangerous_recursive_references_terminate 以子进程驱动")
        });
        let img = decode_png(
            &rasterize_svg_to_png(dangerous_svg(&name).as_bytes())
                .unwrap_or_else(|e| panic!("{name}: 解析失败 {e:?}")),
        );
        check_dangerous_output(&name, &img);
    }

    fn run_dangerous_fixture_in_subprocess(name: &str) {
        let exe = std::env::current_exe().expect("测试二进制路径");
        let mut child = std::process::Command::new(exe)
            .args([
                "--ignored",
                "--exact",
                "fs_io::svg_raster::tests::dangerous_fixture_child",
            ])
            .env(DANGER_CHILD_ENV, name)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("启动子进程");

        let deadline = std::time::Instant::now() + DANGER_DEADLINE;
        loop {
            if let Some(status) = child.try_wait().expect("try_wait") {
                use std::io::Read;
                let mut out = String::new();
                let mut err = String::new();
                if let Some(mut s) = child.stdout.take() {
                    let _ = s.read_to_string(&mut out);
                }
                if let Some(mut s) = child.stderr.take() {
                    let _ = s.read_to_string(&mut err);
                }
                assert!(
                    status.success(),
                    "fixture {name} 子进程失败（{status}）\n--- stdout ---\n{out}\n--- stderr ---\n{err}"
                );
                // `--exact` 匹配不到测试名时 libtest 跑 0 个用例并返回 0——不核这一行，
                // 测试名一漂移整组危险输入就静默变成空转（REVIEW.md「假绿」条）。
                assert!(
                    out.contains("1 passed"),
                    "fixture {name} 的子进程没有真正跑到用例（测试名漂移？）：\n{out}"
                );
                return;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!(
                    "fixture {name} 超过 {}s 未结束：递归 / 循环引用防护回归，疑似死循环",
                    DANGER_DEADLINE.as_secs()
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    /// 递归 / 循环引用的终止性回归。放子进程跑：若未来版本的防护回归，本进程不会跟着挂死或
    /// 栈溢出 abort，父用例在 20s 后杀子进程并给出具体夹具名。
    #[test]
    fn dangerous_recursive_references_terminate() {
        for name in DANGEROUS_FIXTURES {
            run_dangerous_fixture_in_subprocess(name);
        }
    }

    /// `<use>` 展开深度上限：0.50 起 `Options::max_depth` 从硬编码变成字段，默认 1024 与 0.48
    /// 的硬编码上限同值。`safe_options` 显式钉住该常量，本用例锁住「超限即拒」的边界。
    #[test]
    fn use_nesting_beyond_depth_limit_is_rejected() {
        const DEPTH: usize = 1100;
        let mut svg = String::from(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><defs>"##,
        );
        for i in 0..DEPTH {
            if i + 1 == DEPTH {
                svg.push_str(&format!(
                    r##"<g id="g{i}"><rect width="20" height="20" fill="#ff0000"/></g>"##
                ));
            } else {
                svg.push_str(&format!(r##"<g id="g{i}"><use href="#g{}"/></g>"##, i + 1));
            }
        }
        svg.push_str(r##"</defs><use href="#g0"/></svg>"##);

        let err = rasterize_svg_to_png(svg.as_bytes()).unwrap_err();
        assert_eq!(err.code, "attachment_decode_failed");

        // 反向输入：普通深度的 <use> 引用照常渲染——上限不能把正常文档一起拒掉。
        let ok = r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <defs><rect id="r" width="10" height="10" fill="#000000"/></defs>
  <use href="#r"/>
</svg>"##;
        let img = decode_png(&rasterize_svg_to_png(ok.as_bytes()).expect("普通 use 应当渲染"));
        assert!(dark_pixels(&img) > 0, "普通 <use> 引用必须照常渲染");
    }

    /// 内联子 SVG（`data:image/svg+xml`）里的外部 href 同样不能读：usvg 对嵌套文档强制关闭
    /// `resolve_string`（`from_data_nested`）。这条是安全条款 2 的递归版本——只测顶层
    /// `<image href>` 会漏掉「包一层 data URI」的绕过面。
    #[test]
    fn external_href_inside_inline_svg_data_uri_is_not_read() {
        let dir = tmpdir("nested-svg");
        let red_path = dir.join("red.png");
        image::RgbImage::from_pixel(8, 8, image::Rgb([255, 0, 0]))
            .save(&red_path)
            .unwrap();
        assert!(
            red_path.is_file(),
            "夹具得真的在盘上，否则本用例不构成反向输入"
        );

        let nested = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <rect width="20" height="20" fill="#0000ff"/>
  <image href="{href}" width="20" height="20"/>
</svg>"##,
            href = red_path.display()
        );
        let outer = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <image href="data:image/svg+xml;base64,{data}" width="20" height="20"/>
</svg>"##,
            data = crate::fs_io::base64_encode(nested.as_bytes())
        );

        let img = decode_png(&rasterize_svg_to_png(outer.as_bytes()).expect("渲染成功"));
        assert!(
            blue_pixels(&img) > 0,
            "嵌套 SVG 本身应当渲染——否则本用例是空转，判不出外部 href 有没有被读"
        );
        assert_eq!(
            red_pixels(&img),
            0,
            "嵌套 SVG 里的外部 href 被读进来了：from_data_nested 的 resolve_string 关闭失效"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
