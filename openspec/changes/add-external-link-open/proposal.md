# Proposal: 外链渲染与打开——`[title](url)` 渲染为 title↗︎，⌘⏎ / ⌘-Click 交给系统浏览器

- Change ID: add-external-link-open
- 日期: 2026-09-16
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

标准 Markdown 链接 `[title](url)`（下称"外链"）目前在 Lumir 里**完全没有被渲染**：live preview 的装饰层只处理 wikilink（`[[…]]`）与图片（`![alt](path)`），`[title](url)` 停在源码态，与 `[x](note.md)` 这类相对路径链接长得一模一样，作者分不出哪个能开、也开不了。change `add-wikilink` 当初明确把它列为 non-goal（原文：「不做标准 Markdown 链接 `[text](path)` 的跳转（非 wikilink 语法，独立 change 候选）」），本 change 就是那个候选。

Alex 的原话与已定口径（2026-09-16）：「链接（[title](link)）渲染成 title↗︎，并增加打开它的快捷键」；「wikilink 内部跳转体系不动」。落点：外链 `[title](url)` 渲染为 `title` + `↗︎` 标记，⌘⏎ / ⌘-Click 在系统默认浏览器打开；同一组快捷键在 wikilink 上仍走既有跳转链路；wikilink 未解析时只给提示、不创建文件。

一条现成的约束推动了实现取型：macOS 上「打开一个 URL」是操作系统能力，webview 不该自己拼命令。Tauri 的 `tauri-plugin-opener` 提供跨平台实现（[官方插件文档](https://v2.tauri.app/plugin/opener/)），本 change 用它——但只用它的 **Rust 侧** API，不把插件命令暴露给 webview（理由见 What Changes 第 2 条）。

## What Changes

新增两个 requirement 增量（`editor-live-preview`、`keymap-commands`），不新增 capability。

1. **外链渲染**（`editor-live-preview`）：标准 Markdown 链接的 scheme 属于外链白名单（`http` / `https` / `mailto`）时，md 模式渲染为 `title` + 尾部 `↗︎` 标记，`[` / `]` / `(url)` 被装饰隐藏；文档逐字节不变（ADR 0003 §3 铁律）。光标或选区触及该链接时整条显露源码——编辑态与改动前一致（改动前没有链接装饰，编辑 URL 时看到的就是原文），同时避免长 URL 被隐藏后产生中间大段"按键光标不动"的死区。非外链形态（相对路径、纯锚点、白名单外 scheme）保持原文不装饰，与"能开的才看起来能开"一致。**wikilink 的渲染路径逐字未动。**

2. **链接跟随**（`keymap-commands`）：`⌘⏎` 与 `⌘-Click` 落到同一条命令 `link.follow`（由 `wikilink.follow` 更名——命令现在跟随的是**链接**，不再只管 wikilink；键位与作用域不变）。光标/点击处是 wikilink → 走既有跳转链路（Rust `link_graph` 解析 + 打开目标文件 + 锚点定位），未解析 → 只提示、不创建文件；是外链 → 交给系统默认应用；两者都不是 → 无操作。

3. **外链打开的单一入口与最小权限**：新增 invoke command `open_external_url`，在 Rust 侧校验 scheme 白名单与目标可信性，再经 `tauri-plugin-opener` 打开。webview **不**被授予任何 `opener:*` 权限（capabilities 不动）——插件注册但它的 IPC 命令保持默认拒绝，唯一入口是本仓自己的 command，scheme 校验、诊断埋点、错误信封都只在一个地方。插件默认会往页面注入"点击 `<a target=_blank>` 直接开浏览器"的脚本，本 change 显式关掉它：那是绕开校验的第二条打开路径。

4. **可观测性**：打开尝试落一条 `link_open` 诊断事件（`LogEventName` 新增一项，字段白名单 `scheme` / `outcome`，`outcome` = `opened` / `rejected` / `failed`）。**不记 URL 原文**——URL 是文档内容，`logging` 模块头的隐私边界不允许正文进日志。这条事件同时是真机验收的唯一观测物（见下）。

**为什么外链白名单在前端出现两次**（如实记录）：前端必须知道"这条链接看起来能不能开"才能决定渲染（`note.md` 不该长得像外链），后端必须独立校验"这条链接能不能开"（文档内容不能指挥操作系统）。两处各 3 项，各自有测试钉住（视觉场景钉前端、cargo 单测钉后端），后端是权威——前端的判断只能减少请求，绝不能代替校验。

**验收口径的偏差**（如实记录）：mission 建议"opener 断言走 M136 的 tauri stub log event gate"。自查后该机制**只存在于 chromium/Playwright**（`tests/visual/scenes/tauri-stub.ts` 注入 `window.__TAURI_INTERNALS__`），真机套件没有 stub、也没有 JS eval 通道，够不着页面内钩子。因此拆成两条：**视觉场景**用桩记录 `open_external_url` 的调用参数，断言"开的是哪个 URL"且不真的唤起浏览器；**真机验收**断言诊断日志里出现 `link_open`（真机上这条会真的唤起一次系统浏览器，用保留域 `example.invalid`，场景正文如实写明）。后者需要一项套件能力：诊断日志按 UTC 日期命名而验收环境的 `env/` 目录跨天复用，写死日期的断言会永久假绿——因此本 change 一并给验收套件的 `file` 断言加了 glob 路径支持（取 mtime 最新的一份再断言），并反向验证过它不会取到旧文件。

## Non-goals

- **不改 wikilink**：渲染、三态、跳转、一键创建、锚点定位一律不动（Alex 口径「wikilink 内部跳转体系不动」）。未解析的 wikilink 仍然**不自动创建文件**，既有的"创建并打开"按钮保留（那是作者的显式动作，不是自动行为）——移除它会推翻已归档 `add-wikilink` 的「一键创建入口」并让既有场景变红。
- **不做相对路径链接的跳转**：`[x](note.md)` 保持原文不装饰、激活无操作。是否把 vault 内相对路径链接接进跳转体系是另一个能力（与 wikilink 的关系需要单独裁决），本 change 不碰。
- **不做引用式链接**（`[text][ref]`）与**自动链接**（`<https://…>`）：前者 lezer 不把定义处的 URL 挂到引用点、拿不到目标就不猜；后者不是 Alex 指定的 `[title](url)` 形态，本版保持原文。两者都属于后续候选。
- **不做打开方式选择**（in-app 浏览器、指定应用）、不做"在新标签页打开"这类选项。
- **不引入第二套打开的键位或菜单项**：打开只有 ⌘⏎ 与 ⌘-Click 两条入口（同一条命令），不加菜单项。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED：外链渲染）、`keymap-commands`（ADDED：链接跟随；MODIFIED：鼠标路径的 ⌘ / ⌃ 拆分——把"跟随 wikilink"扩为"跟随链接"）。
- 影响的代码/系统：前端 `src/preview/links.ts`（新增：标准链接分解与外链判定，判定取自 lezer 语法树、不手写词法）、`src/preview/livePreview.ts`（Link 节点的装饰与 `↗︎` widget）、`src/preview/theme.ts`（`.cm-lp-link` / `.cm-lp-link-mark` 样式）、`src/main.ts`（`link.follow` 命令与鼠标路径）、`src/keys.ts`（命令 id 更名）、`src/ipc.ts`（`openExternalUrl` 薄封装）；Rust `src-tauri/Cargo.toml`（`tauri-plugin-opener`）、`src-tauri/src/lib.rs`（插件注册 + command 注册）、`src-tauri/src/commands.rs`（`open_external_url` + scheme 校验单测）、`src-tauri/src/logging.rs`（`link_open` 事件与白名单）。测试：视觉场景 `tests/visual/scenes/render-link.spec.ts` + fixture + 基线；真机验收场景 `scripts/acceptance/scenarios/12-links.md` + fixture。
- 关联约束：ADR 0003 §3（铁律：装饰不改写源文件）；ADR 0002 §6（性能合同：外链装饰沿用 live preview 的视口增量纪律，激活路径不在键入路径上）；ADR 0002 §3（link graph 在 Rust core——外链的打开许可也在 Rust 侧，同一分层）；ADR 0001 §4（键位 chorded 非 modal，无新模式）；`openspec/project.md`（配置即数据、隐私边界见 logging 模块头）。
