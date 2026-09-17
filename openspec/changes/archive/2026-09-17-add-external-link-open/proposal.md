# Proposal: 标准 Markdown 链接的渲染与打开——形态矩阵（`title↗︎` / `title→`）

- Change ID: add-external-link-open（M144 立项；M145 就地补全形态矩阵）
- 日期: 2026-09-16（M144）／2026-09-17 修订（M145）
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

标准 Markdown 链接 `[title](target)` 在 Lumir 里**完全没有被渲染**：live preview 的装饰层只处理 wikilink（`[[…]]`）与图片（`![alt](path)`），`[title](target)` 停在源码态，与 `[x](note.md)` 这类相对路径链接长得一模一样，作者分不出哪个能开、也开不了。change `add-wikilink` 当初明确把它列为 non-goal（原文：「不做标准 Markdown 链接 `[text](path)` 的跳转（非 wikilink 语法，独立 change 候选）」），本 change 就是那个候选。

Alex 的原话与已定口径（2026-09-16）：「链接（[title](link)）渲染成 title↗︎，并增加打开它的快捷键」；「wikilink 内部跳转体系不动」。

**M145 修订的动因（dogfood 第 4 条反馈，2026-09-17）**：M144 只装饰了 http / https / mailto，把「相对路径不装饰」写进 Non-goals。Alex 启动真实 app 后反馈原话：「我启动后看到的链接并没有渲染成 title↗︎」——他看到的是 `[examples/](examples/README.md)` 这类相对路径链接仍是原文。tower 承认把这条口径写进 Non-goals 时未向 Alex 显式确认，属裁决疏漏。M145 补齐：**所有标准 inline 链接都装饰**，装饰与激活解耦。Alex 对应用内标记的裁决原话（逐字执行）：「内部跳转的带→，也就是 title→」。

一条现成的约束推动了实现取型：macOS 上「打开一个 URL / 一个文件」是操作系统能力，webview 不该自己拼命令。Tauri 的 `tauri-plugin-opener` 提供跨平台实现（[官方插件文档](https://v2.tauri.app/plugin/opener/)），本 change 用它——但只用它的 **Rust 侧** API，不把插件命令暴露给 webview（理由见 What Changes 第 3 条）。

## What Changes

新增两个 requirement 增量（`editor-live-preview`、`keymap-commands`），不新增 capability。**M145 起覆盖全部标准 inline 链接形态**（矩阵见下）。

**链接形态矩阵**（M145）——分类判据只看目标原文，装饰与激活解耦：

| 目标形态 | 标记 | ⌘⏎ / ⌘-Click |
|---|---|---|
| `http:` / `https:` / `mailto:` | `↗︎` | 系统默认应用（M144 行为，不回归） |
| 相对路径 `.md` / 无扩展名（含 `#fragment`） | `→` | 应用内跳转（同一 link_graph 打开链路；未解析只 toast、不创建） |
| 相对路径非 md（`.pdf` 等）与目录 | `↗︎` | 解析为 vault 内路径后交系统默认应用 |
| 纯锚点 `#section` | `→` | 只给「暂不支持锚点跳转」toast（不做文档内滚动） |
| 白名单外 scheme / 空目标 / 控制字符 | — | 保持原文，不装饰也不激活 |

语义规则：`↗︎` = 会离开本应用；`→` = 应用内跳转。

1. **链接渲染**（`editor-live-preview`）：标准 Markdown 链接按上表渲染为显示文本 + 尾部标记，`[` / `]` / `(target)` 被装饰隐藏；文档逐字节不变（ADR 0003 §3 铁律）。光标或选区触及该链接时整条显露源码——编辑态与改动前一致（改动前没有链接装饰，编辑目标时看到的就是原文），同时避免长目标被隐藏后产生中间大段"按键光标不动"的死区。**wikilink 的渲染路径逐字未动。**

2. **链接跟随**（`keymap-commands`）：`⌘⏎` 与 `⌘-Click` 落到同一条命令 `link.follow`（由 `wikilink.follow` 更名——命令现在跟随的是**链接**，不再只管 wikilink；键位与作用域不变），按上表分流：wikilink 与应用内笔记走既有跳转链路（Rust `link_graph` 解析 + 打开目标文件；wikilink 未解析 → 只提示、不创建文件；相对路径未解析 → 只提示「链接目标不存在」、不创建文件）；外链与 vault 内资产交系统默认应用；纯锚点只提示；不可用形态无操作。

3. **打开的单一入口与最小权限**：新增 invoke command `open_external_url`（外链，M144）与 `link_open_path`（vault 内资产，M145），前者在 Rust 侧校验 scheme 白名单与目标可信性，后者校验目标必须落在 vault 内且存在（拒绝绝对路径 / `..` 穿越 / 符号链接逃逸），再经 `tauri-plugin-opener` 打开。webview **不**被授予任何 `opener:*` 权限（capabilities 不动）——插件注册但它的 IPC 命令保持默认拒绝，唯一入口是本仓自己的 command，校验、诊断埋点、错误信封都只在这两处。插件默认会往页面注入"点击 `<a target=_blank>` 直接开浏览器"的脚本，本 change 显式关掉它：那是绕开校验的第二条打开路径。

4. **可观测性**：链接激活落一条 `link_open` 诊断事件（`LogEventName` 新增一项，字段白名单 `category` / `outcome` / `scheme`，`category` = `external` / `internal-md` / `asset` / `anchor` / `blocked-scheme`，`outcome` = `opened` / `unresolved` / `unsupported` / `rejected` / `failed`；`scheme` 仅外链路径有值）。系统打开类由 Rust 侧记录（判定与调用都在那一侧），其余类别由前端记录（分类只在前端）。**不记 URL / 目标原文**——那是文档内容，`logging` 模块头的隐私边界不允许正文进日志。这条事件同时是真机验收的唯一观测物（见下）。

**相对路径的解析基准（M145 的实现取型）**：`[x](../docs/a.md)` 的目标是**相对当前文件所在目录**的路径，与 wikilink 的名称匹配语义不同源（`[x](note.md)` 与 `[[note]]` 可能指向不同文件）。因此新增 `link_resolve_note` command：Rust 侧归一 `.` / `..`（以 `/` 开头按 vault 根相对、`..` 越出 vault 根即解析不到），在 link_graph 的文件全集上做**全路径**查询（不再退化为名称匹配），命中的路径交回前端走与 wikilink 同一条 `openFile`。前端不复制这套路径语义——两份实现必然漂移。

**两处 tower 裁决，Alex 未逐条点头**（M145 如实披露，留否决入口）：① 非 md 相对路径（`./doc.pdf`）带 `↗︎`（语义：会离开本应用）；② 纯锚点带 `→` 但激活仅 toast、不做文档内滚动跳转。

**M145 一并收窄的一处口径**（未向 Alex 单独确认，同此披露）：`.md` 相对路径带 `#fragment`（`note.md#sec`）按「应用内跳转 + 锚点部分忽略」处理——不做跨文件锚点定位（跨文件锚点需要 heading 与 slug 的对应规则，属独立能力）。`../` 与 `/` 开头的目标分别按「相对所在目录」与「vault 根相对」处理。

**为什么外链白名单在前端出现两次**（如实记录）：前端必须知道"这条链接看起来能不能开"才能决定渲染（`note.md` 不该长得像外链），后端必须独立校验"这条链接能不能开"（文档内容不能指挥操作系统）。两处各 3 项，各自有测试钉住（视觉场景钉前端、cargo 单测钉后端），后端是权威——前端的判断只能减少请求，绝不能代替校验。

**验收口径的偏差**（如实记录）：mission 建议"opener 断言走 M136 的 tauri stub log event gate"。自查后该机制**只存在于 chromium/Playwright**（`tests/visual/scenes/tauri-stub.ts` 注入 `window.__TAURI_INTERNALS__`），真机套件没有 stub、也没有 JS eval 通道，够不着页面内钩子。因此拆成两条：**视觉场景**用桩记录 `open_external_url` / `link_open_path` 的调用参数，断言"开的是哪个目标"且不真的唤起浏览器或打开文件；**真机验收**断言诊断日志里出现 `link_open`（真机上这两条会真的唤起系统浏览器与系统默认应用，场景正文如实写明）。后者需要一项套件能力：诊断日志按 UTC 日期命名而验收环境的 `env/` 目录跨天复用，写死日期的断言会永久假绿——因此本 change 一并给验收套件的 `file` 断言加了 glob 路径支持（取 mtime 最新的一份再断言），并反向验证过它不会取到旧文件。

## Non-goals

- **不改 wikilink**：渲染、三态、跳转、一键创建、锚点定位一律不动（Alex 口径「wikilink 内部跳转体系不动」）。未解析的 wikilink 仍然**不自动创建文件**，既有的"创建并打开"按钮保留（那是作者的显式动作，不是自动行为）——移除它会推翻已归档 `add-wikilink` 的「一键创建入口」并让既有场景变红。相对路径 md 链接解析不到时同样**不提供创建入口**（一键创建是 wikilink 的显式动作）。
- **不做跨文件锚点定位**：`[x](note.md#sec)` 跳到 `note.md`，`#sec` 忽略（口径见上）；纯锚点 `#section` 不做文档内滚动跳转。两者都需要 heading↔slug 的对应规则，属独立能力。
- **不做引用式链接**（`[text][ref]`）与**自动链接**（`<https://…>`）：前者 lezer 不把定义处的 URL 挂到引用点、拿不到目标就不猜；后者不是 `[title](target)` 形态，本版保持原文。两者都属于后续候选。
- **不做打开方式选择**（in-app 浏览器、指定应用）、不做"在新标签页打开"这类选项。
- **不引入第二套打开的键位或菜单项**：打开只有 ⌘⏎ 与 ⌘-Click 两条入口（同一条命令），不加菜单项。
- **不为 vault 内路径做百分号解码**：`[x](my%20note.md)` 这类 URL 编码写法按字面路径解析（解析不到就提示），不猜作者的编码意图。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED：链接形态分类与渲染矩阵）、`keymap-commands`（ADDED：链接跟随按类别分流；MODIFIED：鼠标路径的 ⌘ / ⌃ 拆分——把"跟随 wikilink"扩为"跟随链接"）。
- 影响的代码/系统：前端 `src/preview/links.ts`（标准链接分解 + 形态分类 `classifyLinkTarget`，判定取自 lezer 语法树、不手写词法）、`src/preview/livePreview.ts`（Link 节点的装饰与 `LinkMarkWidget`）、`src/preview/theme.ts`（`.cm-lp-link` / `.cm-lp-link-mark` 样式）、`src/main.ts`（`link.follow` 命令与鼠标路径、按类别分流）、`src/keys.ts`（命令 id 更名）、`src/ipc.ts`（`openExternalUrl` / `linkResolveNote` / `linkOpenPath` 薄封装）；Rust `src-tauri/Cargo.toml`（`tauri-plugin-opener`）、`src-tauri/src/lib.rs`（插件注册 + 三个 command 注册）、`src-tauri/src/commands.rs`（`open_external_url` / `link_resolve_note` / `link_open_path` + scheme 校验单测）、`src-tauri/src/link_graph.rs`（`relative_vault_path` + `resolve_relative` 相对路径解析与单测）、`src-tauri/src/logging.rs`（`link_open` 事件与白名单，M145 增 `category`）。测试：视觉场景 `tests/visual/scenes/render-link.spec.ts` + fixture + 基线；真机验收场景 `scripts/acceptance/scenarios/12-links.md` + fixture（含相对路径 / 资产 / 锚点 / 不可用四类）。
- 关联约束：ADR 0003 §3（铁律：装饰不改写源文件）；ADR 0002 §6（性能合同：链接装饰沿用 live preview 的视口增量纪律，激活路径不在键入路径上）；ADR 0002 §3（link graph 在 Rust core——链接的打开许可与路径校验也在 Rust 侧，同一分层）；ADR 0001 §4（键位 chorded 非 modal，无新模式）；`openspec/project.md`（配置即数据、隐私边界见 logging 模块头）。
