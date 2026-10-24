# Tasks: svg-image-quote-oct24

## 1. 后端：栅格化模块与接入

- [x] 1.1 新增 `src-tauri/src/svg_raster.rs`：`usvg` 解析（安全选项）+ `resvg` 渲染 + PNG 编码；
  `MAX_EDGE = 4096` 的尺寸夹取（`fit_to_limit`）、外部 href 恒拒（`safe_options` 的
  `resolve_string`）、系统字体一次性装载（`system_fonts`）
- [x] 1.2 模块声明落在 `fs_io.rs`（`#[path = "svg_raster.rs"]`，scope 不含 crate 根；注释就地写明
  与在 `lib.rs` 声明等价）
- [x] 1.3 `fs_io::ATTACHMENT_TARGETS` 的第二列从 bool 升级为三档 `AttachmentConversion`
  （原样 / png→WebP / SVG 栅格化→WebP），新增 `("image/svg+xml", RasterizeSvg, "webp")` 一行
- [x] 1.4 新增共用转换入口 `fs_io::convert_attachment(conversion, raw)`；`write_attachment` 改走它
- [x] 1.5 `harness::attachments::write_image_to` 改走同一转换入口（落盘名 / 尺寸回传 / 去重零改动）
- [x] 1.6 `Cargo.toml` 加 `resvg`（`default-features = false, features = ["text",
  "system-fonts"]`）+ 取舍注释；`Cargo.lock` 随构建更新
- [x] 1.7 安全条款在代码注释就地写明：MUST NOT pass-through 存 SVG、MUST NOT 用 `innerHTML` 内联
  SVG、外部资源加载关闭、尺寸上限（`svg_raster.rs` 模块文档 + `convert_attachment` 的注释）

## 2. 后端判据

- [x] 2.1 `svg_raster.rs` 单测：含 `<text>` 的合成 svg 渲染出深色字形（反向输入：无文字版本 0
  深色像素）；外部 `<image href>` 不读（反向输入：默认 resolver 渲染同一 fixture 必须有红色像素）；
  `data:` 内联图片照常渲染；巨型 viewBox 夹到 4096（正方形 + 1:200 长条）；畸形 XML / 非 UTF-8 /
  非 svg 根元素一律 `attachment_decode_failed`
- [x] 2.2 `fs_io.rs` 单测：格式表逐项命中（含 svg → `RasterizeSvg` + webp）、表外一律拒；
  svg 端到端落盘（webp 字节、尺寸取 viewBox、内容寻址去重）；畸形 svg 不落盘；
  位图三档反向用例（png 档 = 既有转码原语、原样档逐字节不变）
- [x] 2.3 `cargo test`（+ `cargo fmt --check`、`cargo clippy -D warnings`）全绿

## 3. 前端

- [x] 3.1 `src/preview/attachments.ts` 的 `QUOTABLE_TARGETS` 加 `{ source: "svg", stored: "webp" }`
  并更新区块注释（差分集从 7 种缩到 6 种）
- [x] 3.2 `src/quote-image.ts` 的契约注释更新（svg 不再走预检失败分支；D585 只剩真不支持的格式）
- [x] 3.3 `tests/unit/attachment-format-drift.test.ts`：解析面跟上三档枚举；断言 svg 行的转换
  口径必须是 `RasterizeSvg`（安全条款的机器判据）；反向输入与「不可引用清单」逐条改准
- [x] 3.4 `tests/unit/quote-image.test.ts`：svg 成功路径（两条 IPC、零 toast、位图名 + 尺寸）；
  栅格化失败回落；混合批次失败夹具换成 gif
- [x] 3.5 `tests/unit/excerpt-image-refs.test.ts`：注释口径改准（只改注释，判据未变）

## 4. 验收面

- [x] 4.1 真机验收场景 222 §④ 改写：`svg 引用 → 图片卡片 + @ 钮 + 无失败留痕`（fixture 沿用既有
  合成 `image-quote-logo.svg`）
- [x] 4.2 `node scripts/acceptance/run.mjs --check` 通过（228 个场景静态校验）
- [x] 4.3 视觉场景 `tests/visual/scenes/m633-image-quote.spec.ts`：svg 失败用例改写为成功用例；
  「状态行收口」用例的失败夹具从 svg 换成 gif（D586 的正确消费者）

## 5. 规格与门禁

- [x] 5.1 `openspec validate --all --strict` 通过（48/48）
- [x] 5.2 `node scripts/openspec-archive-check.mjs`（docs-check 的一部分）通过：MODIFIED 块逐段
  抄自 living requirement，无静默丢段（36 份 delta / 29 条 MODIFIED / 373 段）
- [x] 5.3 `scripts/gate.sh quick` 全绿（附 `GATE RESULT` 原文行与退出码）
- [x] 5.4 `pnpm test` 全绿（1292/1292）
- [x] 5.5 视觉面无整页基线变化（svg 只在「引用之后」的 harness 侧产生位图卡片，预览渲染路径
  未变；m633 场景本身零像素基线）——并在本地实跑 `m633-image-quote.spec.ts`（7/7 passed）
- [x] 5.6 `clipboard-image-paste` 的「转码压缩」增量：粘贴与引用共用同一个写入口，那一句
  「其余 image/* 子类型拒绝」在这里也有第二份，一并对准（REVIEW.md「同一语义两处真源」条）

## 6. 收尾

- [x] 6.1 归档顺序登记：`add-image-quote-to-chat` → `quote-pipeline-consistency-oct24` → 本 change
  （M662 的「svg 引用失败」场景与本规格相反，见 design D8）
- [x] 6.2 已知缺口登记：引用语境下 `attachment_decode_failed` 的 D438 文案仍写「剪贴板」——
  新增 D 编号需要动 `src/copy-data.ts` / `文案-Copy.md`（不在本 mission scope），另议
