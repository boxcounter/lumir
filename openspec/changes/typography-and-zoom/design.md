# Design: typography-and-zoom

本 change 的现状盘点（逐条给文件:行号）、落点、机制选择与被否决方案。
盘点是 2026-09-24 在 worktree `wt-193`（base master `329224d`）上实测所得；**该 worktree 没有
`node_modules`**，凡涉及 CM6 内部契约的结论都在主 checkout 的 `node_modules` 上核过并标明版本，
无法复核的一律标注「待实现期复核」并列进 §4。

## 0. 对任务书前提的两处更正

1. **「字体 token 在 `src/style.css`」只对了一半。** 字体**族**确实只有那一处真源
   （`--font-body` / `--font-display` / `--font-mono`，`src/style.css:10-12`），但**编辑器内容的
   字号不在那里**：它今天在两处各写一份 16px —— `src/style.css:28` 与 `src/editor.ts:1196`
   （CM 主题）。后者带一层作用域类（见 §1.2），因此在 CSS 层真正生效的是 `editor.ts` 那一份。
   「字号选择」要开的口子因此**必须落在 CM 主题这一侧**，不是把 `style.css` 的某个值改掉就行。
2. **`font-size` 不是「一个元素一个值」。** 正文排版是相对量化的（标题 `1.04em`–`1.78em`、列表
   标记 `.85em`、引用 / 公式 `.92em`、frontmatter 字号 `.82em`，`src/preview/theme.ts:60-65`、
   `:152-160`、`:193`、`:241`、`:358`）——所以改一个 token 会**按比例带动全套正文排版**。这既是
   本 change 的实现便利（一处生效、全篇文章同步），也决定了影响面（整篇像素都会变，§6）。

## 1. 现状盘点

### 1.1 排版 token 与它的消费面

| 事实 | 锚点 |
|---|---|
| token 层只有一组：`--font-body`（`-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif`）、`--font-display`（`"Songti SC", "STSong", ui-serif, Georgia, serif`）、`--font-mono`（`ui-monospace, "SF Mono", Menlo, monospace`）、`--line-height: 1.75`、`--measure: 80%`、`--nav-width: 244px` | `src/style.css:9-13` |
| shell 的排版也吃同一组 token：`body`（13px + `--font-body` `:25`）、`.masthead-vault`（`--font-display` `:61`）、`.ft-row`（13px + `--font-body` `:167`）、filetree / ft-empty（`:190`）、大纲浮层（`--font-display` `:397`）、面板键位（`--font-mono` `:414` `:420`）、搜索面板（`:553`） | `src/style.css` 同上 |
| **token 化不彻底的两处（既有漂移）**：`.filetree` 与 `.ft-empty` 把正文族写成了字面量 `-apple-system, "PingFang SC", sans-serif`，而不是 `var(--font-body)` | `src/style.css:111`、`:226` |
| 编辑器侧的字体引用：`.cm-editor` = `var(--font-body)`、md 正文 = `var(--font-body)`、code 模式 = `var(--font-mono)`（同一个 `baseTheme`，按模式二选一）；围栏代码块 / frontmatter / 列表标记 / mermaid 源码 / 表格管道 = `var(--font-mono)`；标题与 callout 标签 = `var(--font-display)` | `src/preview/theme.ts:56`、`:108`、`:152`、`:160`、`:205`、`:241`、`:308`、`:319`、`:341`、`:349`；`src/editor.ts:1186` |
| 阅读栏宽是**百分比**：`.cm-scroller` 的网格列 `minmax(0, var(--measure))`（md）/ `minmax(max-content, 1fr)` + `minmax(0, var(--measure))`（code），列宽随编辑区宽度走，**与字号无关** | `src/editor.ts:1191-1192` |
| 行高是**无单位**的 `1.75`（`--line-height`），因此随字号等比变化；CM 侧 `.cm-scroller { lineHeight: "var(--line-height, 1.75)" }` | `src/style.css:13`、`src/editor.ts:1190` |

### 1.2 字号的两处写值与「哪一份生效」

| 事实 | 锚点 |
|---|---|
| 写值 ①：`.cm-content { font-size:16px; line-height:1.75; }`（作者样式） | `src/style.css:28` |
| 写值 ②：CM 主题 `.cm-content { fontFamily: "inherit", fontSize: "16px", … }` | `src/editor.ts:1196` |
| CM 主题的选择器**带一层作用域类**：`EditorView.theme(spec)` → `buildTheme(".<生成类>", spec)`，其 `finish` 把不含 `&` 的选择器改写成 `主选择器 + " " + sel`；该生成类同时被加到编辑器根元素上（`themeClasses`）。故主题里的 `.cm-content` 实际是 `.<生成类> .cm-content`，specificity 0,2,0 > 作者的 0,1,0 → **写值 ② 生效** | `node_modules/@codemirror/view/dist/index.js:6788-6800`（`buildTheme`）、`:8744-8749`（`static theme`）、`:8261-8268`（`themeClasses`）；`@codemirror/view@6.43.11` |
| 同一份值两处写 = 改一处就漏另一处（REVIEW.md 第 8 条同族）：今天两处恰好都是 16px，所以看不出来 | 上两行 |
| `.cm-content` 上的 `line-height:1.75`（作者样式）与 `.cm-scroller` 的 `lineHeight`（主题）是两个元素上的两个声明，互不竞争：前者是直接声明，恒压过从 scroller 继承来的值 | `src/style.css:28`、`src/editor.ts:1190` |

### 1.3 配置通道（M180 先例）与装配点

| 事实 | 锚点 |
|---|---|
| 配置根 `AppConfig`：`version` / `last_vault` / `editor` / `keys` / `log`；`EditorConfig` 今天三个字段（`mode` / `line_wrap` / `code_block_wrap`） | `src-tauri/src/config.rs:44-56`、`:70-95` |
| 解析侧宽容镜像 `RawEditorConfig`：`mode: Option<String>`、两个 `Option<bool>`；`#[serde(default)]` | `src-tauri/src/config.rs:151-166` |
| 逐字段校验 `validate()` 的 editor 分支；`editor.mode` 的取值校验是「未知值 → warning + 回落」的模板，新增字符串字段照它写 | `src-tauri/src/config.rs:231-283` |
| **类型不符走整文件回落**：`Option<bool>` / `Option<String>` 遇到类型错（`"line_wrap": "yes"` / `"mode": 1`）在 serde 解析期即失败 → `AppConfig::default()`（**含 `last_vault: None`**）+ 一条 warning。这是既有解析模型的性质，M180 明确裁决不发明「逐字段类型容忍」（否则与 `editor.mode` 同类不同治） | `src-tauri/src/config.rs:255-272`（注释原文）、`:189-227`（`load_from` 两条回落分支） |
| `[keys]` / `[log]` 两表走的是另一种形态：整表收成 `serde_json::Value` 后逐项判定，错形状只丢自己（不拖垮整文件） | `src-tauri/src/config.rs:142-150`、`:303`（`validate_keys`）、`:343`（`validate_log`） |
| 前端唯一消费点：`configGet().then(...)` → `editor.setMode(...)` / `editor.setWrap(...)` / `applyKeyConfig(...)`；无 watcher、无热重载 | `src/main.ts:830-841`；`configGet` 定义在 `src/ipc.ts:38` |
| 运行期只写 `last_vault` 一个字段（两处写入点，同纪律：读整 JSON → 只改该字段 → tmp+rename） | `src-tauri/src/commands.rs` 的 `write_last_vault_to`、`src-tauri/src/workspaces.rs` 的 `vault_remap`（M180 design §1.1 已列行号，本 change 不动它们） |
| ts-rs 导出目标 `src/bindings/`；漂移门禁比对 `git status --porcelain -- src/bindings/` | `src-tauri/src/config.rs:42-43` 等；`scripts/gate.sh:61-70` |
| 验收 harness 的 `writeConfig` 只认 `mode` / `lineWrap` / `codeBlockWrap`（新增字段要一并扩） | `scripts/acceptance/lib/app.mjs:28-45` |
| 视觉 harness 的 `config_get` 桩只出 `editor.mode` + `keys`；需要额外字段的场景用 `patchEditorConfig` 在桩之后再包一层（M180 的 `render-codeblock.spec.ts` 就是这么做的） | `tests/visual/scenes/tauri-stub.ts:66-67`、`:197-207`；`tests/visual/scenes/render-codeblock.spec.ts:465-486` |

### 1.4 键位表与候选键占用

| 事实 | 锚点 |
|---|---|
| 唯一分发表 `KEY_BINDINGS`：47 条字面量 + 9 条 `TAB_GOTO_BINDINGS` 生成；表内无 `Cmd-=` / `Cmd-+` / `Cmd--` / `Cmd-0` | `src/keys.ts:285-362`、`:265-270` |
| 命令 id 分组清单：`EDITOR_COMMAND_IDS`（editor 作用域）/ `NON_TAB_GLOBAL_COMMAND_IDS`（全局）；作用域由 `applyKeyOverrides` 机械派生（非 editor 子集 → `global`） | `src/keys.ts:166-184`、`:499` |
| 「无孤儿命令」不变量与默认不绑键清单 `KEYLESS_COMMAND_IDS`（M180 的三项对账） | `src/keys.ts:196-214`；`openspec/specs/keymap-commands/spec.md` 的「统一键位分发表」 |
| 原生菜单 accelerator 集合（muda 0.19.3）：⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q——**无 ⌘= / ⌘− / ⌘0** | muda `src/items/predefined.rs:300-342` |
| tauri 默认菜单结构（macOS）：App / File / Edit / **View（只有 Fullscreen，⌃⌘F）** / Window（Minimize ⌘M、Maximize「Zoom」**不带 accelerator**、Close）+ Help（macOS 上空） | tauri 2.11.5 `src/menu/menu.rs:191-235` |
| token 口径陷阱（既有先例）：单字符键名一律大写在 token 里；含 Alt 的组合按**物理键**（`KeyboardEvent.code`）判定；US 布局上需 Shift 才打出的符号按「Shift 已隐含在字符里」归一 | `src/keys.ts:272-284`、`:399-420`、`:434-445` |
| 键位面板渲染的是 `binding.key` **原文**（不做美化），分组表 `BINDING_GROUPS` 里 `view.*` 命令落「全局」组；面板未绑定行的成因说明有两档（M180 的 D66） | `src/bindings-panel.ts:32-45`、`:91-94`、`:104`、`:110` |
| 面板场景的两条断言按表派生（不会因新增绑定而失效）：行数 = `KEY_BINDINGS.length + KEYLESS_COMMAND_IDS.length`、未绑定行数 = `KEYLESS_COMMAND_IDS.length`；分组标题数组是**冻结**的 9 个 | `tests/visual/scenes/m133-describe-bindings.spec.ts:66-70` |

### 1.5 webview 缩放通道（一个真实存在的旁路）

| 事实 | 锚点 |
|---|---|
| Tauri 提供 `zoom_hotkeys_enabled`（builder 开关）+ `Webview::set_zoom(scale_factor)`；macOS / Linux 上是**注入一段 polyfill**，Windows 走 WebView2 原生设置 | tauri 2.11.5 `src/webview/mod.rs:1041-1054`、`:2091-2102`；`src/manager/webview.rs:555-557` |
| polyfill 的确切行为：`keydown`（macOS 看 `metaKey`）里接 ⌘− / ⌘= / ⌘+ / ⌘0，步进 **0.2**、上下限 0.2–10、`zoomLevel` 起点 1（**每次启动重置**），调 `plugin:webview|set_webview_zoom`；另有 `mousewheel` + Ctrl 路径（该路径在 `:32` 调 `event.preventDefault()` 压住页面滚动）。**`keydown` 路径不调用 `preventDefault`**（`:12-28`）——这条差异对本 change 有意义：键盘路径与统一键位表会同时收到同一批事件（我们不绑它们时无冲突；一旦两处都接管就是双处理） | tauri 2.11.5 `src/webview/scripts/zoom-hotkey.js:12-28`（keydown）、`:30-42`（mousewheel，`preventDefault` 在 `:32`） |
| 本项目**未启用**（`src-tauri` 全仓零命中；Tauri 侧默认 `false`）。启用需 ACL 权限 `core:webview:allow-set-webview-zoom`（本仓 `src-tauri/capabilities/default.json` 只有两条 event 权限） | `tauri-runtime-2.11.3/src/webview.rs:526`；`src-tauri/capabilities/default.json` |
| 结论：它是「整体缩放」的最省实现，但它是一条**表外**的键位通路（不进 `KEY_BINDINGS`、不显示在键位面板、不可 `[keys]` 重绑），与「分发只有一条路径」的不变量正面冲突 → 推荐形态下 MUST NOT 启用；若 D4 取备选 B，也应通过**自己的命令**调缩放，而不是开这个开关 | 由上述三条推出 |

### 1.6 重测量通道

| 事实 | 锚点 |
|---|---|
| 已有消费者在字体 / 字号变化时重测：列表标记宽度由 canvas 按 `parseFloat(computedStyle.fontSize) * .85` 与字体族量出，并在「`documentElement` 的 style / class 属性变化」与「`document.fonts` loadingdone」时重测 | `src/preview/lists.ts:38-48`、`:62-66`、`:81-97` |
| **该消费者读的是 token 的字符串值，不是 CSS 引用**：`context.font = \`${…}px ${style.getPropertyValue("--font-mono")}\`` ——`getPropertyValue("--font-mono")` 拿到的是 token 的**值**，所以「把渲染引用换成 `--editor-mono-family`」不会带着它走。非默认 `mono_font_family` 下就会分叉：标记**渲染**用新族、**测量**仍按 shell 的 `--font-mono` 算宽度 → 列表标记与正文对不齐（这是本 change 必须一并收口的第二处「同语义两处来源」） | `src/preview/lists.ts:44` |
| 该观察者的存在正好说明：**在 `documentElement` 上改 CSS 变量是这类消费者的既有触发条件**（`attributeFilter: ["style", "class"]`） | `src/preview/lists.ts:63` |
| CM 自身对内容盒尺寸变化有观察通道（`ResizeObserver` / 几何变化检测）→ 字号变化**可能**会被自动重测量；这条**必须实测**，不能假设（见 §4-1） | 待实现期复核（本 worktree 无 `node_modules`；§4-1 给判据与退路） |
| 同类缺陷的既有形态：`coordsAtPos` / 行高 / 滚动揭示一旦不匹配就是「光标画在别处」那一族（M103 垂直移动、M110 水平移动、M113/M118 表格与公式边界） | `openspec/specs/keymap-commands/spec.md` 的「编辑器光标命令的硬化底座」 |

### 1.7 视觉基线与容差

| 事实 | 锚点 |
|---|---|
| 基线共 30 张（整页 + 元素级），13 个快照目录；口径 `deviceScaleFactor=1`、1200×800 CSS px（= `tauri.conf.json` 的窗口尺寸） | `find tests/visual/baselines -name '*.png' \| wc -l`；`tests/visual/README.md:23-25`；`src-tauri/tauri.conf.json` |
| 像素层只在本地跑（CI 置 `LUMIR_VISUAL_STRUCTURAL=1` 只跑结构 / 计算属性断言） | `tests/visual/README.md:27-58`；AGENTS.md「视觉门禁分层」 |
| 容差是**比例**（`maxDiffPixelRatio`，现行 0.001 ≈ 1200×800 下 960 像素）：删 / 移 UI 的像素可能落在容差里静默假绿 | `tests/visual/README.md:119-136`；REVIEW.md 第 3 条 |
| 既有场景里已经有**按计算属性断言字体**的先例（end-marker 场景断言末尾标记的 `fontFamily` 命中 `Songti\|STSong\|serif`） | `tests/visual/scenes/end-marker.spec.ts:240-244` |
| 结论：字号 / 字体一变，整页像素必然变（§0-2 的相对量化）→ 新增的非默认口径必须用**独立基线**，且默认口径必须可断言「零变化」 | 由上述推出 |

### 1.8 面板与文案

- 三条新命令会自动落进面板的「全局」组（`BINDING_GROUPS` 用 `NON_TAB_GLOBAL_COMMAND_IDS`），
  因此**不新增分组、不新增文案**（分组标题与说明串都在 `文案-Copy.md` 的 D63–D67 一带）。
- 面板把 `binding.key` 原样显示（`src/bindings-panel.ts:104`），因此新绑定会以
  `Cmd-=` / `Cmd-+` / `Cmd--` / `Cmd-0` 的字样出现——`Cmd--`（减号键的 token 形态，见 §2.5）读起来
  生硬，但面板是**自用查看器**（M133 的口径：只回答「某个键现在归谁」），不为它改显示层；
  真要美化另案。

## 2. 设计落点

### 2.1 配置面（Rust）

三个字段，沿用 `EditorConfig` 的既有形状（`src-tauri/src/config.rs:70-95` 与 `:155`）：

| 字段 | Rust 类型 | 默认 | 校验 |
|---|---|---|---|
| `font_family` | `Option<String>`（`EditorConfig.font_family: Option<String>`） | `None` = 基线观感 | 缺省 / 空串 / 纯空白 → `None` + warning；其余原样下发给前端（CSS 值合法性由前端判定，见 §2.2） |
| `mono_font_family` | 同上 | `None` = 基线观感 | 同上 |
| `font_size` | `Option<f64>`（`EditorConfig.font_size: f64`，默认 16） | `16` | 区间 [12, 32]，越界 → 回落 16 + warning |

- `validate()` 的 editor 分支按 `editor.mode` 的模板加三条（`src-tauri/src/config.rs:231-283`）。
- **合法的「缺省」形态**：`EditorConfig` 里 `font_family` 用 `Option<String>` 是刻意的——`None`
  表达「沿用基线」，与空串 / 非法值区分开：前者是正常状态，后者要 warning。TS 侧类型因此是
  `font_family: string | null`（ts-rs 导出，前端消费时 `""`/`null` 一律等价于基线）。
- **类型不符的边界如实登记**：`"font_size": "16"`（带引号）或 `"font_family": 16` 会在 serde 解析期
  失败 → **整文件回落**（全部默认 + warning），连 `last_vault` 一起丢（`AppConfig::default()` 的
  `last_vault = None`），下次启动要重新打开 vault。这是 M180 明确裁决过、不发明「逐字段类型容忍」的
  既有性质（`src-tauri/src/config.rs:255-272` 的注释原文）。本 change **沿用**它，并给两条防线：
  ① 单测钉住这条边界（含「`last_vault` 也回到 None」这一条，让代价可见）；② 模块头注释里点明
  `font_size` 是数值字段、错打成字符串的代价。
  - 代价如实说：`font_size` 是**第一个**数值配置字段，错打概率比布尔高（多引号、小数、`1e1`）。
    若你更看重「一个错字不该让我丢掉 vault」，替代形态是把该字段收成 `serde_json::Value` 后逐项
    判定（`[keys]` / `[log]` 那条路，`src-tauri/src/config.rs:142-150`）——代价是与 `editor.mode`
    形成「同类不同治」，正是 M180 拒绝的那件事。本提案**取前者**（形态一致优先），把代价写在这里
    等你一句话；改后者只需换一处类型 + 一条单测。
- 命令 id 清单 MUST NOT 出现在 Rust 侧（`src-tauri/src/config.rs:12-15` 的既有裁决）；本 change 不新增
  任何 Rust 侧的命令知识。
- ts-rs 自动导出 → `src/bindings/EditorConfig.ts` 必须随实现提交（`scripts/gate.sh:61-70` 的漂移门禁）。

### 2.2 token 分层与「配置只影响编辑器」的结构性保证

新增三个**编辑器作用域** token（默认值就是今天的观感），放在 `src/style.css` 的 `:root` 里：

```css
--editor-font-family: var(--font-body);   /* 正文族（md 正文 / .cm-editor） */
--editor-mono-family: var(--font-mono);   /* 等宽族（code 模式 / 代码块 / frontmatter / 列表标记…） */
--editor-font-size: 16px;                 /* 编辑器内容字号（今天写在 style.css:28 与 editor.ts:1196 的那个 16px） */
```

- 编辑器侧的引用一律改走这一层：`src/editor.ts:1186`（`fontFamily` 按模式二选一 → `--editor-font-family`
  / `--editor-mono-family`）、`:1196`（`fontSize` → `var(--editor-font-size)`）、`src/preview/theme.ts`
  里所有编辑器内的 `var(--font-body)` / `var(--font-mono)`。`--font-display`（标题 / 装饰）**保持原样**
  ——D3 推荐形态下标题族不可配。
- **为什么分层而不是直接覆盖 `--font-body`**：直接覆盖 shell token 会让左栏、masthead、面板的字体
  一起漂（D1 备选①），而分层让「配置只影响编辑器」变成结构事实——shell 的规则引用的仍是
  `--font-body` / `--font-mono`，编辑器引用的是一层可被覆盖的别名。
- **顺带收口 §1.2 的双写**：`16px` 的真源收敛到 `--editor-font-size` 的默认值一处；`src/style.css:28`
  与 `src/editor.ts:1196` 都不再各写一份数字（前者只留 `line-height` 那半句，或整条删掉——实现期按
  「哪一条真正生效」实测后决定，判据是 `getComputedStyle(.cm-content)` 逐项与今天相同）。
  这条是 REVIEW.md 第 8 条的直接落点：**同一语义两处真源，改一处就漏另一处**。
- **测量与渲染 MUST 同源（本 change 的第二处「同一语义两处来源」）**：`src/preview/lists.ts:44` 用
  `getPropertyValue("--font-mono")` 把字体族读成**字符串**喂给 canvas 测量——它不受 CSS 引用改名
  影响，改 token 时不会被带着走。实现 SHALL 让它读 `--editor-mono-family`（即与标记渲染同一个 token
  名），并 SHALL 有断言钉住「标记渲染的族与测量用的族逐字相同」（默认与非默认 mono 族各一条）。
  REVIEW.md 第 8 条的第二种形态：一处是 CSS 引用、一处是 JS 取值，改名时只有前者会跟着变。
- **值的安全施加**（用户写的是 CSS 值，不是 HTML，但仍要挡住「非法值把观感打回浏览器默认字体」）：
  施加前 SHALL 用 `CSS.supports("font-family", 值)` 判定（含拼接后的完整值）；不通过（含空串）→
  记 warning + 保持基线。通过时写进 token 的完整值是 **`<用户值>, <基线后备栈>`**（例：正文 =
  `"LXGW WenKai", -apple-system, "PingFang SC", sans-serif`）——这样「本机没装这个字体 / 字族名写错」
  退化成**基线观感**，而不是浏览器的默认衬线体（后者是最难自己发现的那类退化）。
  为什么不能只写用户值：CSS 变量替换出非法值时，声明在 computed-value 阶段失效并回落到
  **initial** 值（浏览器默认字体），不是我们希望的「下一个候选」。

### 2.3 施加机制：CSS 变量（本 change）vs Compartment 重配（M180）

- **选择：CSS 变量 + 显式重测量**。理由：
  1. 字号 / 字体是**纯样式值**，不是 CM 扩展；M180 用 `Compartment.reconfigure` 是因为折行本身
     是 CM 扩展（`EditorView.lineWrapping`），与本 change 的对象不同类。
  2. 一份变量天然覆盖**全部会话**（含后台标签页）与**两种模式**——应用级口径因此不需要像 M180 那样
     遍历 `sessions` 重配（`src/editor.ts` 的 `reconfigureWrap` 那套），少一处「漏掉某个会话」的
     出错面（M180 design §2.2 明确记过这个陷阱）。
  3. 施加点唯一：`documentElement.style.setProperty(...)`（与 §1.6 记的既有观察者相容——`lists.ts`
     的 `MutationObserver` 正是盯 `documentElement` 的 `style` 属性）。
- **代价如实记录**：CSS 变量不在 CM 的状态里，所以「变更后必须重测量」要靠显式调用（§2.6），而
  `Compartment` 路线会顺带触发 CM 的更新周期。这条代价换来的收益是「一次赋值管全部会话」。
- **单一写入路径**：新增一个模块级函数（建议 `applyTypography(values)`，落点在装配层，与
  `applyKeyConfig` 并列），启动配置与三条命令都只经它写值——MUST NOT 出现第二处 `setProperty`。

### 2.4 字号步进的口径

- **真源**：一份**应用运行期**的值 `fontSizePx: number`（初值取配置值，配置未到之前取 TS 侧出厂默认
  16）。全部会话一致；新标签页取当前运行期值而不是配置默认（与 M180 的 D1 口径同形）。
- **档位**：每次 ×1.1 后 `Math.round` 到整数 px；向下为 `Math.round(size / 1.1)`。从 16 出发向上：
  18 → 20 → 22 → 24 → 26 → 29 → 32（7 步到顶）；向下：15 → 14 → 13 → 12（4 步到底）。
  - 为什么是 1.1 而不是 Emacs 的 1.2：1.2 的步幅在正文尺寸上偏猛（16 → 19.2 → 23 → 27.6），
    1.1 更接近「按一下有感觉、不至于过冲」。这是审美以外的**可逆性**考虑：步幅越细，试错成本越低。
  - 为什么取整：整数 px 让视觉断言与真机读数可逐值比对（浮点会让「当前字号是多少」变成一个
    不稳定问题），也让 `--editor-font-size` 的值在配置与运行期之间可直接比较。
- **上下限**：[12, 32]。12 是 13px 的 shell 字号附近（再小不可读）、32 = 2× 默认（与 Emacs 反复 ×1.2
  跑到 2× 的步数同量级）。到界后继续按：**无变化、无提示、不报错**（不弹 toast、不写日志噪音）。
- **`reset` 的语义**：回到**当前配置值**（不是出厂 16px）——Emacs 的 `C-x C-0` 是「restore the
  default (global) font size」，配置值就是本仓的「global」。若配置值本身越界（不可能，§2.1 已回落），
  以回落后的值为准。
- **不落盘**：三条命令都不写 `config.json`（本 change 不新增任何配置写入路径）。`config.json` 的
  内容与 mtime 在命令前后逐字节不变——这是可断言的（与 M180 的验收口径同形）。
- **作用面只有字号**：字体族不参与步进（没有「下一档字体」这种语义），命令只动 `--editor-font-size`。

### 2.5 命令面与键位

- 命令 id：`view.text-scale-up` / `view.text-scale-down` / `view.text-scale-reset`，进
  `NON_TAB_GLOBAL_COMMAND_IDS`（`src/keys.ts:166-184`），作用域由既有派生逻辑给 `global`
  （`src/keys.ts:499`）。实现落在装配层 `src/main.ts` 的 `commands` 记录（`:393-420` 那处），
  能力（运行期真源 + 施加）在编辑器模块。
- **id 命名取 `text-scale` 而不是 `zoom`**：它如实说明改的是**文字**大小（Emacs 的命名）。若 D4 取
  备选 B（整体缩放），id 应改为 `view.zoom-*`——前缀 / 名字与语义 MUST NOT 互相打脸，这是 M180 的
  D3 与 `editor.` 前缀那条纪律的同一条理由。
- **默认绑定**（四条绑定 / 三条命令）：

| token | 命令 | 来由 |
|---|---|---|
| `Cmd-=` | `view.text-scale-up` | mac / 浏览器惯例的放大键 |
| `Cmd-+` | `view.text-scale-up` | 同一物理键的字符形态（⌘⇧=）——浏览器对放大同时接受这两个。**两条绑定同一命令**是表内既有形态（撤销就有 `Ctrl-/` 与 `Ctrl-_` 两条） |
| `Cmd--` | `view.text-scale-down` | 缩小；token 形态见下 |
| `Cmd-0` | `view.text-scale-reset` | 回到配置字号（Emacs 的 `C-x C-0` 同义） |

- **token 陷阱（本 change 最大的静默失配风险，必须单测钉住）**：减号键的事件 token 是
  `keyToken` 拼出来的 `"Cmd" + "-" + "-" = "Cmd--"`（`src/keys.ts:429-445` 的 `[...mods, event.key].join("-")`，
  `event.key === "-"`），而表内写法 `Cmd--` 经 `normalizeKey` 仍是 `Cmd--`（`src/keys.ts:406-420`）。
  因此表内 **MUST 写 `Cmd--`**，MUST NOT 写 `Cmd-Minus`（含 Alt 的组合才按物理键 `code` 判定，
  见 `src/keys.ts:434-439`；⌘− 不带 Alt，写 `Cmd-Minus` 永远不命中，而且**不报错**）。
  同族风险：⌘⇧= 在真机 macOS 上 `event.key === "+"`（归一成 `Cmd-+`），但合成事件（Playwright
  `Meta+Shift+Equal`）可能给 `key === "="` + `shiftKey` → 归一成 `Cmd-Shift-=`（**不命中**）。
  两条都要在实现期用实测钉住，别用「注入了按键就算验过」当判据。
- **冲突复核（三条来源，见 §1.4）**：表内空、原生菜单 accelerator 集合空、`⌘=` / `⌘−` / `⌘0` 不是
  macOS 系统菜单键。另加一条**必须保持的反向约束**：MUST NOT 启用 Tauri 的 `zoom_hotkeys_enabled`
  （§1.5：它会在表外再接管同一批键）。
- **`[keys]` 可重绑**：三条命令的 token 都是单段、无空白，因此 `[keys]` 能重绑 / 解绑（`config.rs`
  只拒绝含空白的 token）。这也是不取 Emacs chord 的代价换算（D4）。
- **面板**：三条命令自动落「全局」组；默认全都有绑定，所以 `KEYLESS_COMMAND_IDS` 不变、未绑定行数
  仍为 0；`m133` 的两条行数断言按表派生，会自动跟随（§1.8）。

### 2.6 重测量纪律

- 每次 `applyTypography`（启动配置 / 命令）之后，SHALL 对**全部会话**请求一次重测量：前台会话
  `view.requestMeasure()`；后台会话各自持有 `state` 而没有 `view`（`src/editor.ts` 的会话模型），
  实现期按既有的分岔形态处理（切回前台时 CM 自己会测量；后台会话不需要立即测）。
- 判据（可断言，不是「调用了就算」）：改字号后，光标所在行的 `getBoundingClientRect().height`
  等于「新字号 × 行高」的实测值；`coordsAtPos(head)` 与 DOM 选区矩形一致；列表标记宽度按新字号重测
  （`src/preview/lists.ts` 的消费者）。
- **不要假设 CM 自动重测量**：CM 对内容盒尺寸有观察通道，字号变化很可能自动触发测量，但这条
  **必须实测确认**（§4-1）。若实测已自动 → 保留断言、不额外调用；若实测滞后一帧或未触发 → 显式
  `requestMeasure()` 并保留断言。两条路都必须留同一条断言，避免「改成显式调用」之后被后人删掉。
- **滚动与光标可见**：字号变化会改文档高度。理想结果是视口锚不跳（CM 的滚动锚定会按高度差修正），
  判据是「光标仍在视口内」；若实测出现明显跳动，退路是复用 M103 已有的揭示原语把光标行滚入视区
  （`editor.recenter` 那条路用的是 `revealLine` 同款 y 口径）。

### 2.7 几何与性能影响

- **栏宽不联动**：`--measure` 保持 `80%`（相对编辑区宽）→ 字号变大时**每行字数变少**（16px→32px
  时每行字符数约减半）。这是本 change 自觉接受的后果（Non-goals 已登记），替代方案（把栏宽改成
  `ch` / 相对字号）会改动阅读栏的既有口径与全部基线，另案。
- **行高自动跟随**：`--line-height: 1.75` 无单位 → 与字号等比，不需要第二处改动。
- **性能**：一次样式重算 + 一次视口级重测量。CM 的行高测量是视口有界的既有路径（不随文档长度增长），
  无解析、无遍历、无 IO。ADR 0002 §6 的四条阈值不受影响；冷启动不新增 IO（沿用 `config_get` 一次）。
- **像素面**（详见 §6）：默认口径逐像素不变；非默认口径必然改变整页像素（`em` 比例联动）。

### 2.8 默认值与「两处写值」的处置

- TS 侧出厂默认常量（`DEFAULT_FONT_SIZE = 16` 等，落点与 `src/preview/theme.ts:23` 的
  `DEFAULT_LINE_WRAP` 同族）与 Rust 的 `Default` 是同一语义的两份写值。既有先例就是
  `initialMode` 对 `EditorConfig::default().mode`（M180 design §2.7 已固化处置）：**两侧各写一份，
  各有单测钉住，常量处各留一行指针注释指向对方**。
- `--editor-font-size` 的默认值 16px 是**第三份**写值（CSS 层）。处置同 M180：它是「CSS 那层的默认」，
  与 TS 出厂默认必须逐项一致，实现期用计算属性断言钉住（默认配置下
  `getComputedStyle(.cm-content).fontSize === "16px"`）。

## 3. 被否决的方案与理由

| 方案 | 否决理由 |
|---|---|
| 直接覆盖 shell token（`--font-body` / `--font-mono` / `body` 字号） | 左栏 / masthead / 面板的字号与字体一起变（D1 备选①）。会把「界面密度」这个更大的话题卷进来，`src/style.css` 里每个字号与 `--nav-width` 都要重估，基线全量重拍 |
| 启用 Tauri 的 `zoom_hotkeys_enabled` 拿现成缩放 | 它在表外再注册一条 keydown 通路（不 display 在键位面板、不可 `[keys]` 重绑），与「分发只有一条路径」正面冲突；且步进 0.2、起点每次启动重置、需要 ACL 权限（§1.5） |
| 走 Compartment 重配（照搬 M180） | 字号 / 字体是纯样式值，不是 CM 扩展；重配要遍历全部会话（M180 那个「漏掉后台会话」的出错面），而 CSS 变量一次赋值天然覆盖全部会话与两种模式（§2.3） |
| 把用户字体值直接写进 token（不加后备栈、不做 `CSS.supports` 判定） | CSS 变量替换出非法值时声明在 computed-value 阶段失效 → 回落到浏览器 **initial**（默认衬线体），是最难自己发现的退化形态；「字族名写错 / 本机没装」也会走到同一个坑（§2.2） |
| 字号用固定阶梯表（如 12/13/14/16/18/20/22/24/28/32） | 多一份表要维护，且配置值可能落在阶梯外（要做「最近档」映射，又是一条规则）；倍数步进（1.1）只依赖一个常量，且与 Emacs 的 `text-scale-mode-step` 同形（§2.4） |
| 命令切的字号持久化（写回 `config.json`） | 新增第三条配置写通道（现状只写 `last_vault` 一个字段），把「配置即数据」的输入面变成应用状态存储（ADR 0002 §5）；与 M180 的 toggle 纪律不一致（D5） |
| 默认键位取 Emacs 的 `C-x C-=` / `C-x C--` / `C-x C-0` | `[keys]` 明确拒绝含空白的键位（`config.rs:316-318`）→ 这三条命令会变成「用户改不了键」。Emacs 的语义由 ⌘ 系承担（本仓既有的 ⌘/⌃ 分工）（D4-A） |
| 顺手把 `font_size` 做成 `serde_json::Value` + 逐字段类型容忍 | 会与 `editor.mode` / `line_wrap` 形成「同类不同治」，正是 M180 明确拒绝的那件事（`config.rs:255-272` 注释原文）。代价（数值错打 → 整文件回落 → 连 `last_vault` 一起丢）改为**如实登记 + 单测钉住**（§2.1） |
| 顺手把 `--measure` 改成随字号联动（`ch` 或 `calc`） | 阅读栏宽是 ADR 0006 §3 基线的一部分，改动会牵动全部整页基线；本 change 只开字号口，栏宽另案（Non-goals） |
| 顺手改 `src/style.css:111` / `:226` 那两处字面量字体族 | 属 shell 面的 token 化清理，与本 change 的作用面（编辑器）无关；并入会让「默认口径零变化」这条硬要求的核对面变大。已按协议另提 finding |
| 顺手做字体候选清单 + 循环命令 / 系统字体枚举浮层 | 前者是第二处真源（清单在代码、选择在配置），且「清单里没有我要的字体」无处可去；后者需要原生枚举（WKWebView 无 JS API）+ 新浮层（D2） |
| 顺手做整页缩放的 toast / 常驻读数（mode line 式） | 新增可见面 → 新增文案、视觉覆盖与「何时不播报」的判定，超边界；字号变化的可见结果就是反馈（与 M180 的 D5 同口径） |
| 为字号步进引入鼠标滚轮 + 修饰键路径 | 需要新增第二条输入通路（wheel），无需求支撑（Non-goals） |

## 4. 实现期必须验证 / 未决的点

0. **CM 主题选择器的 specificity 结论**：本文 §1.2 的「写值 ② 生效」是在主 checkout 的
   `node_modules/@codemirror/view@6.43.11` 上读源码得到的（`buildTheme` 的选择器改写 + `themeClasses`）。
   实现期 SHALL 用**运行期实测**复核一次（默认配置下把 `src/style.css:28` 的 16px 临时改成 20px，
   读 `getComputedStyle(.cm-content).fontSize`：若仍是 16px，则 ② 生效成立）。**判据是读数，不是注释。**
1. **CM 是否自动重测量**（§2.6）：改字号后不显式调用，检查光标矩形 / 行高是否立即正确。
   实测结论写回本节；无论哪条成立，断言都保留（§2.6 的判据）。
2. **⌘− 与 ⌘⇧= 的 token 形态**（§2.5）：单测钉住「真实事件 token 与表内 token 相等」——
   ⌘− 应为 `Cmd--`、真机 ⌘⇧= 应为 `Cmd-+`；并用一次真机按键确认（视觉层的合成事件可能给
   另一种形态，那种差异要如实写进场景注释，不能靠放宽断言掩盖）。
3. **配置类型不符的后果**（§2.1）：单测断言 `{"editor":{"font_size":"16"}}` 下
   `font_size` / `font_family` / `mode` / `line_wrap` 与 `last_vault` **一起**回到默认、warning 恰一条。
4. **非默认字体的退化形态**（§2.2）：① 语法非法的值 → warning + 观感与基线逐像素相同；
   ② 语法合法但本机没有的字族名 → 呈现为基线后备栈（可用 `getComputedStyle` 的 `fontFamily`
   逐项比对，或对该行做元素级截图比对）。
5. **字号变化后的滚动行为**（§2.6）：若出现明显跳动，按 M103 的揭示原语处理，并把读数写回本节。
6. **面板行数与分组**（§1.8）：`m133` 的两条断言是否自动跟随（行数 = `KEY_BINDINGS.length +
   KEYLESS_COMMAND_IDS.length`）——实跑确认，**不要顺手改断言**；分组标题数组必须原样不变
   （新增分组会牵动文案与两份断言）。
7. **既有 30 张基线逐张零差异**（§6）：本 change 的前提是「默认口径不变」；任何一张变了都先当缺陷查。
8. **验收 harness 的 `writeConfig` 扩展**（`scripts/acceptance/lib/app.mjs:28-45`）：三个新字段传了才写，
   与 M180 的 `lineWrap` / `codeBlockWrap` 同形；不改这一处，真机场景就没有配置通道。

## 5. 与 REVIEW.md 的对表（本 change 的落点）

| REVIEW.md 条目 | 本 change 的落点 |
|---|---|
| 1 断言等价于子串 / 无区分度 | 重测量与字号的断言用**读数**（`getComputedStyle` 的 px 值、`getBoundingClientRect` 的高度、`coordsAtPos` 与 DOM 选区矩形），不用「命令被调用过」型判据；token 形态的单测要先造一个必须 FAIL 的输入（写 `Cmd-Minus` 看它不命中） |
| 3 容差吞掉真实变化 | §6：默认口径要求逐张零差异；新增非默认口径用**独立基线**，不改既有基线；新场景必须是「会 FAIL 的输入」——默认配置下跑新场景应先红（未实现前） |
| 6 覆盖声明超出真实验证 | tasks 的每条要求可 `ls` 的证据指针（场景名 + PASS 计数）；跑不动的写「未验」 |
| 7 证据只在终端跑过 | 证据落 `test-results/<mission>/`，不落 worktree 内 |
| 8 同一语义两处真源 | ① 16px 的双写收敛到 `--editor-font-size`（§2.2）；② 编辑器字体引用收敛到 editor token 层；③ 出厂默认三处写值（Rust / TS / CSS）按 M180 的处置：两侧单测 + 指针注释 + 计算属性断言 |
| 9 声明即被消费 | 三个配置项都有消费者（启动应用 + 命令），不留假开关；`font_size` 的区间校验与回落必须有断言（「能配但不生效」正是 `editor.measure` 的旧坑） |
| 11 真机键盘注入丢键 | 真机场景的判据走**回读**（读计算属性 / AX 里的字号读数或元素几何），不以注入次数当判据 |
| 13 测试污染真实环境 | 视觉与真机场景都用隔离配置目录（`XDG_CONFIG_HOME`）；本 change 的配置改动只落在隔离目录里 |

## 6. 像素基线的处置口径（D6 的落地）

1. **默认口径 = 零变更（硬要求）**：`font_size` 缺省 16、字体族缺省引用基线 → 30 张既有基线**逐张
   零差异**。实现后必须本地跑全量像素层（`bash scripts/gate.sh visual` / `scripts/visual/run.sh`，
   不是 CI 的结构模式——CI 不跑像素，`tests/visual/README.md:27-58`）。
2. **任何既有基线变了 → 按缺陷处理**：先查是不是引入了与字体无关的位移（例如把 16px 移到了别处
   导致行高差、或 `--measure` 被顺手改动）。**不允许**用「有意变更」重拍掩盖（REVIEW.md 第 3 条：
   0.001 的比例容差能吞掉约 960 像素的真实变化）。
3. **新增基线只增不改，控制在 1–2 张代表值**：建议 ① 一档大字号（如 24px）的整页；② 自定义字体
   （一个与本机已装字体明显不同的族）的元素级或整页。**不**为每一档都留基线（那就成了 8 张 × 多场景
   的膨胀，且每档之间的差异是同一机制的重复）。
4. **新增基线待 Alex 过目**才生效（AGENTS.md 硬规则：基线更新是人肉裁决点）。
5. **场景侧的默认口径钉死**：新场景之外，既有场景的 `config_get` 桩仍不带排版字段（
   `tests/visual/scenes/tauri-stub.ts:197-207`）→ 既有场景天然跑默认口径；新增能力走
   `patchEditorConfig` 那条既有形态（`render-codeblock.spec.ts:465-486`）或扩桩，**MUST NOT** 让某个
   既有场景意外带上非默认字号。
