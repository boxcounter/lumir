# Design: SVG 引用的栅格化

> 技术设计与取舍。安全条款的**唯一正文**在 `src-tauri/src/svg_raster.rs` 的模块文档里
>（代码与约束放在一起，改代码的人一定读得到）；本文写「为什么这样选」，不复刻条款原文。

## D1 依赖选型：`resvg` + `usvg`（纯 Rust，零外部进程）

| 候选 | 评价 |
|---|---|
| **`resvg`（选定）** | 纯 Rust（`usvg` 解析 + `tiny-skia` 光栅化），零 C 依赖、零外部进程、零网络。一条 `Tree::from_data` + `resvg::render` 就能出位图，与本仓既有的 `image` 转码链同族（都是内存里的字节进、字节出）。 |
| 系统级渲染器（`qlmanage` / `rsvg-convert` / headless Chromium） | 外部进程 + 路径 quoting 注入面 + 启动开销，且要处理「进程没装 / 版本不同」的降级——本仓对「外部进程」一贯是能不用就不用（同 `trash` / `rfd` / `notify-rust` 的取舍先例）。 |
| 自写 SVG 子集解析 | 必然猜错（路径语法 / transform / 渐变 / clipPath …），猜错的后果是「引用的图与原图不同形」且无人能定位。 |

**feature 面**：`default-features = false, features = ["text", "system-fonts", "raster-images"]`
——`<text>` 的字体面（fontdb 装系统字体）、纯矢量渲染与 `<image>` 的**内嵌位图**。关掉的是
`svgz`（flate2：`.svgz` 不在图片注册表里）与 `memmap-fonts`（memmap2：字体一次性装进内存，
几十毫秒，不是瓶颈）。

`raster-images` 必须开着：resvg 在缺它时把 `<image>` 的**全部位图**丢弃（只打一条 warn），
包括 `data:` URI 里的内嵌 PNG——那会让「SVG 里内嵌一张图」悄悄少一块。`data:` 是内联载荷
（零 I/O、零外部引用），与 D2 要关的「外部资源加载」不是一回事。代价：`gif` + `zune-jpeg`
两个解码器进依赖树（`image-webp` 已在 `image` 的 webp feature 里）。少了这两个，安全条款 2 的
判据也就失去区分度——见 D2 的反向输入。

**代价（如实登记）**：约 20 个新 crate、一次全量编译变长、二进制体积增大。相对「SVG 永远不可
引用」的产品缺口，这是本次裁决（Alex 2026-10-24「采纳 A」）接受的价格。

## D2 外部资源：默认 resolver 会读本地文件，必须显式关掉

`usvg` 的 `ImageHrefResolver` 有两个回调：

- `resolve_data`（`data:` URI）——**内联载荷**，base64 / percent 解码，零 I/O。保留默认。
- `resolve_string`（任意字符串 href）——**默认实现把 href 当文件路径 `std::fs::read`**，文档
  原话是「you can forbid access to local files (which is allowed by default)」。一张带
  `<image href="/Users/…/secret.png">` 或 `href="../../x.png"` 的 SVG 就能把 vault 之外的文件
  读进渲染结果。**换成恒 `None` 的闭包**。

判据不是「相信文档」：`svg_raster.rs` 的 `external_file_href_is_not_read` 用**默认 resolver**
渲染同一份 fixture，断言红色像素**确实出现**（证明危险真实存在、断言有区分度），再用生产选项
断言红色像素为 0。第二个方向由 `inline_data_uri_image_is_kept` 兜住——关外部引用不等于关掉所有
`<image>`。

`<use href="#id">` 这类文档内引用由 usvg 在解析期解析，不产生文件 I/O；`@import` / 外部样式表
usvg 不解析（CSS 支持本身就是最小集）。

## D3 尺寸：小字节、大画布是 SVG 特有的攻击面

现有保护只有 50MB **输入字节**上限——它拦不住 `viewBox="0 0 100000 100000"`：几十字节就能让
pixmap 申请 100000×100000×4B ≈ 40GB。因此 `fit_to_limit` 在渲染前把**最长边**夹到 4096（短边按
同一比例缩，不改变长宽比），最坏情形（正方形）因此停在 4096×4096×4B ≈ 67MB——与 50MB 输入上限
同一量级。

夹取的是**像素尺寸**，不是坐标系的数值：`resvg::render` 用同一个 `scale` 做 `Transform`，因此
夹取只改变采样密度，不改变构图。

## D4 接入点：扩表的一行，而不是旁开一条路

M662 已把「哪些源格式可写」收敛成一张表（`fs_io::ATTACHMENT_TARGETS`），读回侧与前端从它派生。
本 change 的接法是**在表里加一行**、并把第二列从 bool 升级成三档枚举：

```text
("image/png",      PngToWebp,    "webp")
("image/jpeg",     Passthrough,  "jpg")
("image/webp",     Passthrough,  "webp")
("image/svg+xml",  RasterizeSvg, "webp")   ← 新增
```

两条写调用链（vault 附件 / harness 贴图）都必须走 `convert_attachment(conversion, raw)`——转换
口径只在表里定义一次（REVIEW.md「同一语义两处真源」条）。落盘名、去重、原子写、watch 事件流全部
复用既有实现。

**为什么不把 SVG 嗅探塞进 `transcode_png_to_webp`**：那样「这是 SVG 还是 PNG」由函数体内的字节
嗅探决定，而不是表——转换口径就有两个真源，且函数名会说谎。

## D5 字体：`<text>` 是渲染快照，不是文本

`usvg` 不内嵌字体，`<text>` 要 fontdb 且必须自己装系统字体。`system_fonts()` 用
`OnceLock<Arc<Database>>` 做进程内一次性装载（`load_system_fonts` 遍历系统字体目录，几十毫秒
量级）——引用一张与引用十张的成本必须同阶。

语义后果（survey §4.5 第 5 条，**接受**）：引用的是**渲染这一刻的快照**，与 Chromium 里的预览
可能不同形（字体族解析不同、缺字体时字形退到 fallback 或丢失）。这是位图语义的必然代价，不是
缺陷；纯文字型 SVG 因此「看起来像图片」而不是「可编辑文本」，与裁决一致。

## D6 失败面与文案边界

| 情形 | 错误码 | 人话来源 |
|---|---|---|
| MIME 不在表内（gif / heic / avif / bmp / ico） | `attachment_type_unsupported` | 引用路径 D585 / 粘贴路径 D436 |
| 字节超 50MB | `attachment_too_large` | D437 |
| base64 坏 / SVG 解析失败 / 画布尺寸非法 | `attachment_decode_failed` | D438 |
| PNG 编码失败 | `attachment_encode_failed` | D439 |

**已知缺口（不在本 change 的改动面）**：D438 的模板文案是「无法解码**剪贴板**图片：{reason}」，
在引用语境下措辞仍偏粘贴。要做到「按调用点分码」需要新增一条 D 编号（`src/copy-data.ts` +
`文案-Copy.md`），本 mission 的 scope 不含那两个文件，故先如实登记为后续项；栅格化失败是少数
路径（畸形 SVG），措辞瑕疵不影响可判性。

## D7 `MUST NOT` 用 `innerHTML` 内联 SVG（继承既有约束）

本方案下前端拿到的只有 `pasted-<hash16>.webp`，没有任何路径需要把 SVG 源码注入 DOM——那条禁令
因此不需要新的代码防线。反向约束：**不要把这条路径改成回传 SVG 源码**（那会让禁令重新变成活
约束，并把「解析用户 XML」的面搬回 webview）。

## D8 归档顺序

- `add-image-quote-to-chat`（活跃）：本 change 的 harness 增量依附于它的「图片摘录到对话」。
- `quote-pipeline-consistency-oct24`（活跃，M662）：它的 harness 增量有一条
  「**Scenario: svg 引用失败**」。本 change 让 svg 走成功路径，两者**相反**——归档顺序 MUST 是
  `add-image-quote-to-chat` → `quote-pipeline-consistency-oct24` → 本 change；三者同时在场时以
  本规格为准（svg 成功、D585/D586 只留给真正不支持的类型）。这条顺序由 tower 在批次收尾的归档
  待办里跟踪。
