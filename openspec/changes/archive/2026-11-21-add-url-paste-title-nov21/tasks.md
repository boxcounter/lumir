# Tasks: add-url-paste-title-nov21

## 1. 前端纯判据

- [x] 1.1 新增 `src/paste-url.ts`：`pastedHttpUrl` / `markdownLinkFor` / `markdownLinkLabel` /
      `pendingUrlTitleField` / `urlTitleReplacement` / `PasteUrlTitlePort`。
- [x] 1.2 新增 `tests/unit/paste-url.test.ts`：单个 URL 识别、失败输入、标题转义（用真 markdown
      解析器回读）、超长 / 空标题、区间映射、区间内编辑放弃、id 唯一。

## 2. 编辑器接线

- [x] 2.1 `src/editor.ts`：paste 处理器在图片通道之后、HTML-only 降级之前接管单 URL 空选区粘贴；
      先插入 URL，再异步取标题。
- [x] 2.2 `src/editor.ts`：`pendingUrlTitleField` 进基础层；`setPasteUrlTitlePort` 进
      `EditorHandle`；异步改写只在 URL 切片仍匹配时派发。
- [x] 2.3 `src/main.ts` / `src/ipc.ts`：装配层注入 `fetchUrlTitle`（`fetch_url_title` command）。

## 3. Rust 网络与标题提取

- [x] 3.1 新增 `src-tauri/src/url_title.rs`：纯函数 `extract_title` + `fetch_title` + 字节 / 标题
      上限；单测用 `127.0.0.1` 一次性 TCP server 覆盖成功 / 404 / 非 HTML / 无标题 / GBK / 超时。
- [x] 3.2 `src-tauri/src/commands.rs` 新增 `fetch_url_title` command（async 线程语义 + 错误信封）；
      `src-tauri/src/lib.rs` 注册模块与 handler。不新增 Cargo 依赖。

## 4. 浏览器与真机

- [x] 4.1 新增 `tests/visual/scenes/url-paste-title.spec.ts`：成功、无标题、网络错误、延迟 + 等待
      期编辑、有选区、非 URL / Markdown；桩 `fetch_url_title` 记录请求。
- [x] 4.2 新增真机场景 `269-url-paste-and-cjk-boundary-nov21` 的 B / C 段（配合 CJK change 的 A 段），
      并 `coverage.mjs` 重生成覆盖表。

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `pnpm exec tsc --noEmit` 通过
- [x] 5.3 `node tests/unit/run.mjs` 全绿
- [x] 5.4 `cargo test --manifest-path src-tauri/Cargo.toml url_title::tests` 9/9 PASS
- [x] 5.5 `LUMIR_VISUAL_PORT=4282` 跑 `url-paste-title` / `url-cjk-boundary-nov21`：7/7 PASS；`render-link` 像素差见 `fix-bare-url-cjk-boundary-nov21` 的 2.4 注记
- [x] 5.6 `node scripts/acceptance/run.mjs --check` 与 `coverage.mjs --check` PASS
- [x] 5.7 未更新任何视觉基线；未新增 npm / cargo 依赖
