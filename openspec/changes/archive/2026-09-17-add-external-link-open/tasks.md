# Tasks: add-external-link-open

> 正常循环：实现、验证与提案同批落地（AI-only 开发模式，ADR 0004）。经 Alex 提案评审（节点 1）通过后归档。

## 1. 外链渲染（editor-live-preview）

- [x] 1.1 新增 `src/preview/links.ts`：标准链接分解（`Link` 节点 + `URL` 子节点 + 两个 `LinkMark` 定出显示文本区间）与外链判定（scheme 白名单 `http` / `https` / `mailto`，尖括号包裹形式与反斜杠转义解码，含空白/控制字符的目标拒绝）
- [x] 1.2 `src/preview/livePreview.ts`：`Link` 节点装饰——显示文本加 `.cm-lp-link`（`title` = URL）、`[` 与 `](url)` 走 replace 隐藏、尾部插入 `↗︎` widget；表格内放行并按单个 cell 槽位收窄
- [x] 1.3 选区触及链接即整条显露源码（口径同 callout 首行的显露），避免长 URL 隐藏后的光标死区
- [x] 1.4 `src/preview/theme.ts`：`.cm-lp-link` / `.cm-lp-link-mark` 样式（沿用 wikilink 的 accent，符合「朱红留给链接与错误态」的设计基线）
- [x] 1.5 wikilink 渲染路径逐字未动（`git diff` 无 wikilink 渲染路径的改动）

## 2. 链接跟随（keymap-commands）

- [x] 2.1 命令 id `wikilink.follow` → `link.follow`（键位与作用域不变）；绑定 `doc` 写清新语义
- [x] 2.2 `src/main.ts`：`followLinkAt(pos)` 统一键盘（选区 head）与鼠标（`posAtCoords`）两条路径——wikilink 走既有链路（含未解析只提示不建文件），外链交 `openExternalLink`，其余位置无操作
- [x] 2.3 ⌘-Click 不再以 `currentPath` 提前返回（外链不需要 vault 上下文），wikilink 仍要求 vault 上下文

## 3. Rust 侧：opener 接入与最小权限

- [x] 3.1 `src-tauri/Cargo.toml` 引入 `tauri-plugin-opener`（用 Rust 侧 API，不暴露插件 IPC）
- [x] 3.2 `src-tauri/src/lib.rs` 注册插件（`open_js_links_on_click(false)`——关掉插件注入的"点击 `<a target=_blank>` 直接开浏览器"脚本，避免绕开校验的第二条打开路径）与 `open_external_url` command
- [x] 3.3 `src-tauri/src/commands.rs` 实现 `open_external_url`：scheme 白名单 + 目标可信性校验（拒绝 → `open_url_rejected`），经 `app.opener().open_url` 打开（失败 → `open_url_failed`）
- [x] 3.4 capabilities **不新增任何 `opener:*` 权限**：webview 对插件 IPC 保持默认拒绝，唯一入口是本仓 command（最小权限集 + 单一入口）
- [x] 3.5 `src-tauri/src/logging.rs` 新增 `LogEventName::LinkOpen` 与 `link_open()` 埋点入口，字段白名单 `scheme` / `outcome`（**不记 URL 原文**）；`src/bindings/LogEventName.ts` 由 `cargo test` 重导出
- [x] 3.6 cargo 单测：scheme 白名单（大小写归一、白名单外/无 scheme 归 `other`）、尖括号包裹形式、空白/控制字符拒绝

## 4. 文案与记录

- [x] 4.1 `文案-Copy.md` 补录新增文案（D77–D79：外链标记、外链拒绝提示、外链打开失败提示），编号沿 D 系追加；命令更名（`wikilink.follow` → `link.follow`）不是用户可见文案，记在文案册的「文案实现备注」里而不占编号
- [x] 4.2 `docs/backlog.md` 记录本项核销（口径、落点、证据指针）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`openspec validate add-external-link-open --strict` 亦通过）
- [x] 5.2 `scripts/gate.sh quick` 全绿（7/7：cargo-fmt / cargo-clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / openspec-validate）
- [x] 5.3 视觉：新增 `tests/visual/scenes/render-link.spec.ts` + `tests/visual/fixtures/render-link/links.md` + 整页基线 `render-link-chromium-darwin.png`；场景断言渲染态、源码显露、**表格 cell 内的外链照常渲染且表格仍是 grid（六条用例之一）**、文档逐字节不变、⌘⏎ 与 ⌘-Click 经桩记录打开的目标（零浏览器启动）、链接起点也命中；配套 Node 侧纯函数断言钉住 scheme 白名单与解码口径。`scripts/gate.sh visual` 全绿（8/8，视觉回归 155–160s）
- [x] 5.4 真机验收：新增 `scripts/acceptance/scenarios/12-links.md` + fixture `links.md` / `links-wiki.md` / `links-missing.md`；`node scripts/acceptance/run.mjs --check` 全绿（20 场景）；单场景先跑 FAIL 一条**本场景自造的跨步骤断言**（`ax.not` 被上一步残留 toast 命中），改成 `ax.count max:1` 后 PASS
- [x] 5.5 套件能力：`file` 断言支持 glob 路径（`path` 含 `*` 时取匹配文件里 mtime 最新的一份再断言），`checkScenario` 与 README 断言表同步；`12-links` 据此用 `env:logs/*.jsonl` 断言 `link_open` 落盘 + 日志无 URL 原文。**反向验证**：植入 mtime 更晚且不含该事件的文件 → 如实 FAIL（不取旧文件、断言不空转），移除后 PASS
- [x] 5.6 全量真机回归 **20/20 PASS（223 断言，约 7 分钟）**，证据归档 `test-results/acceptance/2026-09-16/`（worktree 本地，git 外）；`12-links` 单场景 24 断言全 PASS，含 title↗︎ 在真实 WKWebView 上屏、⌘⏎ 走通 opener（诊断日志 `link_open` `scheme=https` `outcome=opened`，无 URL 原文）

## 6. 形态矩阵补全（M145，2026-09-17 修订）

> 动因：Alex dogfood 反馈「我启动后看到的链接并没有渲染成 title↗︎」——M144 把「相对路径不装饰」写进 Non-goals 时未显式确认，属裁决疏漏。本节把口径扩到全部标准 inline 链接，规格增量（proposal / 两个 spec delta）在同一次修订里就地更新，避免归档后 living spec 出现自相矛盾的两条 requirement。

- [x] 6.1 `src/preview/links.ts`：`classifyLinkTarget` 五类形态分类（external / internal / asset / anchor / blocked），判据只看目标原文；`standardLinkParts` 不变，`externalUrlOf` / `externalLinkAt` 被分类器与 `standardLinkAt` 取代
- [x] 6.2 `src/preview/livePreview.ts`：`Link` 分支对全部可装饰形态出标记（`LinkMarkWidget` 按类别出 `↗︎` / `→`），blocked 形态保持原文；`title` 属性外链给解码后 URL、其余给目标原文
- [x] 6.3 `src-tauri/src/link_graph.rs`：`relative_vault_path`（`./` `..` 归一、`/` 开头按 vault 根相对、`#fragment` 忽略、越界即 None）+ `resolve_relative`（全路径精确查询，无扩展名补 `.md`，**不退化到名称匹配**）+ 4 条单测
- [x] 6.4 `src-tauri/src/commands.rs` + `lib.rs`：新增 command `link_resolve_note`（相对路径 md 解析，解析不到返回 null = 不是错误）与 `link_open_path`（vault 内非 md / 目录交系统默认应用，目标经 `fs_io::resolve_in_vault` 校验：拒绝绝对路径 / `..` / 符号链接逃逸，必须存在）
- [x] 6.5 `src-tauri/src/logging.rs`：`link_open` 事件白名单扩为 `category` / `outcome` / `scheme`，Rust 侧埋点签名同步改为 `link_open(category, outcome, scheme)`
- [x] 6.6 `src/main.ts` + `src/ipc.ts`：`linkTargetAt` 按类别返回五态，`followLink` 分流（wikilink / 应用内笔记 → 应用内跳转；外链 / vault 内资产 → 系统默认应用；纯锚点 → toast；blocked → 无操作 + 诊断）；相对路径未解析只 toast、不创建文件
- [x] 6.7 capabilities **仍不新增任何 `opener:*` 权限**：`link_open_path` 与 `open_external_url` 走同一条最小权限路径（Rust 侧 API，webview 对插件 IPC 默认拒绝）
- [x] 6.8 `文案-Copy.md` 补 D80–D83（应用内标记、链接目标不存在、锚点不支持、vault 内文件打开失败）并同步「文案实现备注」里 widget 名与文案落点
- [x] 6.9 视觉：`tests/visual/scenes/render-link.spec.ts` 扩到 12 条用例（分类纯函数、全形态渲染与标记顺序、表格 cell 内外链与内链、源码显露、⌘⏎ 与 ⌘-Click 分流、相对 md 跳转成功 / 未解析、锚点 toast、blocked 无副作用、资产打开与被拒）；fixture `links.md` 扩到 13 条链接；整页基线 `render-link-chromium-darwin.png` 更新（前后对比说明见 review-request）；`stubTauri` 增 `noteLinks` 桩与 `__openedPaths` / `__noteResolves` 记录
- [x] 6.10 真机验收：新增 fixture `note.md` / `notes.txt` / `links-relative.md` / `links-missing-relative.md` / `links-anchor.md` / `links-asset.md` / `links-blocked.md`，`12-links.md` 扩到 25 步（含四类新形态的渲染与激活、`link_open` 各类别诊断断言）；`node scripts/acceptance/run.mjs --check` 全绿
- [x] 6.11 验证：`scripts/gate.sh quick` + `scripts/gate.sh visual` 全绿；`node scripts/acceptance/run.mjs 12` 单场景 PASS 并附证据
- [x] 6.12 `docs/backlog.md` 记录 M145 的核销与两处待 Alex 复核的裁决（非 md 带 ↗︎、锚点带 → 仅 toast）
