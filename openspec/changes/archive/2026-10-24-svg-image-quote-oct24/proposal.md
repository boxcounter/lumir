# Proposal: SVG 引用走栅格化（svg → 位图 → 既有 png→WebP 链路）

- Change ID: `svg-image-quote-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**方向已裁**——Alex 2026-10-24「好，采纳 A」，A = 栅格化（调查报告
> `.local/reports/quote-image-pipeline-oct24.md` §4.4 的方案 C）。本 proposal 无待裁裁决点，
> 安全条款逐条照 survey §4.5 落地。
> 节点 2（归档评审）：**通过**（2026-10-24 Alex 原话：「第一组和第二组都可以归档了。」）。

## Why

预览 / 枚举层认 10 种图片扩展名（含 `svg`），而写入口只收位图（png / jpeg / webp）——点一张
svg 的「引用」必然走「枚举成功 → 落盘拒绝」的半成功路径（现场报错
`Unsupported clipboard image format: image/svg+xml`，Alex 2026-10-24 反馈 #3；结构分析见 survey
报告 §4.3）。**扩白名单解决不了它**：Kimi / DeepSeek / OpenAI 三家的图片输入都不收 SVG
（[Kimi 视觉模型文档](https://platform.kimi.com/docs/guide/use-kimi-vision-model)：
「SVG 不支持作为图片输入」；[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)；
[OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)），
SVG 无论从剪贴板、vault 路径还是 harness 存储来，都进不了 image part。

唯一的「真正可引用」路径是**把它渲成位图**：栅格化后落盘名仍是 `pasted-<hash16>.webp`，
`image_dimensions` 只解位图，缩略图 / 投递 / 恢复全部零改动（survey §4.5 第 4 条）——这是方案 C
相对「扩格式」的最大优势。

## What Changes

1. **写入口的格式表升级为三档转换**：`fs_io::ATTACHMENT_TARGETS` 的第二列从「是否转码」的
   bool 换成三档枚举（原样 / png→WebP / **SVG 栅格化→WebP**），并新增一行
   `("image/svg+xml", RasterizeSvg, "webp")`。两条写调用链（vault 附件 `write_attachment` 与
   harness 贴图 `write_image`）走**同一个**转换入口 `fs_io::convert_attachment`——格式面仍然只有
   一处判定面（M662 收敛的那张表），不旁开第二条路。
2. **新增 `src-tauri/src/svg_raster.rs`**：`usvg` 解析 → `resvg` 渲染 → PNG 编码。安全条款
   （survey §4.5）逐条落地：**MUST NOT pass-through 原样存 SVG**、外部资源加载**显式关闭**
   （`file:` / `http(s)` / 任意路径引用一律不解析）、viewBox → 位图尺寸**最长边夹 4096**、
   `<text>` 依赖系统字体（接受「引用的是渲染快照」语义）。
3. **前端可引用表加 `svg`**：`src/preview/attachments.ts` 的 `QUOTABLE_TARGETS` 多一行
   `{ source: "svg", stored: "webp" }`（镜像同一张 Rust 表，跨层漂移断言照旧双向对账）。
   引用路径因此**零分支差异**：svg 与 png 同一条路径，预检放行、两条 IPC 照常。
4. **失败面的边界收窄**：D585（「暂不支持引用该格式」）与 D586（「N 张图片未能引用」）**保留**，
   但只命中真正不支持的类型（gif / heic / avif / bmp / ico）。svg 的栅格化失败（畸形 XML /
   尺寸非法）按写入口既有码族回落（`attachment_decode_failed`）。
5. **判据跟着改**：Rust 单测（合成 fixture：含 `<text>`、含外部 `<image href>`、巨型 viewBox、
   畸形 XML、位图三档反向用例）、前端单测（漂移断言 + 引用事务）、真机验收场景 222 的 §④
   从「svg 引用失败」改写为「svg 引用成功」，视觉场景 `m633` 的失败夹具换成 gif。

## Non-goals

- **SVG 源码按文本投递**（survey §4.4 方案 E）：不做。它是「模型读到标记、没有像素」的折中，
  与本次裁决的位图语义并存会产出两种「图片块」，人侧不可分辨。
- **扩其它格式白名单**（gif / heic / avif / bmp / ico）：没有裁决就不扩。本 change 只把 svg 从
  差集里摘出来——扩格式需要单独裁决（gif 是三家 provider 交集里唯一零风险候选，survey §4.2）。
- **改投递协议 / 落盘名形态 / 缩略图 / 恢复路径**：一律零改动（栅格化的目的就是不碰它们）。
- **SVG 的预览渲染**：预览仍由 WKWebView 渲染原文件，本 change 只动「引用进对话」这条路径。
- **CSS `@import` / 外部字体的加载**：usvg 不做网络请求、也不解析外部样式表；系统字体之外的
  字体不加载（快照语义）。

## Impact

- 影响的 specs：`fs-io`（MODIFIED「二进制附件写入」+ ADDED「SVG 源的栅格化与安全边界」）、
  `harness`（ADDED「SVG 引用的栅格化成功路径」）、`clipboard-image-paste`（MODIFIED「转码压缩」
  ——粘贴与引用共用同一个写入口，「其余 image/* 子类型拒绝」那句话在这里也有一份）。
- 影响的代码：`src-tauri/src/svg_raster.rs`（新）、`src-tauri/src/fs_io.rs`、
  `src-tauri/src/harness/attachments.rs`（转换入口调用）、`src-tauri/Cargo.toml` /
  `Cargo.lock`（新依赖 `resvg`）、`src/preview/attachments.ts`、`src/quote-image.ts`（注释与
  契约说明）、`tests/unit/**`、`tests/visual/scenes/m633-image-quote.spec.ts`、
  `scripts/acceptance/scenarios/222-image-quote-to-chat.md`。
- 关联约束：ADR 0002 §6（常驻内存合同——栅格化的尺寸夹取是它的直接约束）、ADR 0004（AI-only，
  判据必须机器可执行）、REVIEW.md「同一语义两处真源」条（格式表只有一处判定面）。
- **依赖代价**：新增 `resvg`（连带 `usvg` / `tiny-skia` / `fontdb` / `harfrust` / `skrifa` /
  `roxmltree` 等约 20 个 crate，纯 Rust、零 C 依赖、零外部进程）。取舍见
  [design.md](design.md) D1。
