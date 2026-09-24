# Proposal: 排版可配（字体 / 字号）与字号步进快捷键

- Change ID: typography-and-zoom
- 日期: 2026-09-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

用户需求原话（2026-09-24）：**「需求：字体选择、字号选择、放大缩小快捷键」**。

三句话落在同一个轴上：**读起来舒不舒服**。本提案把三件事收敛成一条口径——**配置给基准、快捷键在运行期步进、默认口径逐项不变**——并把唯一一处真正需要你拍板的分叉（「放大缩小」改的是**字号**还是**整个界面**）单独拎出来（见「须提请 Alex 节点 1 裁决的选项」D1 / D4）。

### 一、现状：排版基线是一层 token，但没有任何配置出口

| # | 现状事实 | 锚点（可复核） |
|---|---|---|
| 1 | 排版基线今天是一层 CSS token：`--font-body`（系统无衬线 + PingFang）、`--font-display`（宋体族）、`--font-mono`（等宽族）、`--line-height: 1.75`、`--measure: 80%`（阅读栏宽） | `src/style.css:9-13` |
| 2 | 三个 token **没有配置出口**：`[editor]` 表今天只有 `mode` / `line_wrap` / `code_block_wrap` | `src-tauri/src/config.rs:70-95`（`EditorConfig`）、`:155`（解析侧镜像 `RawEditorConfig`）、`:231`（`validate`） |
| 3 | 编辑器内容的字号今天**两处写死 16px**：`src/style.css:28` 的 `.cm-content { font-size:16px }` 与 `src/editor.ts:1196` 的 CM 主题 `.cm-content { fontSize: "16px" }`。CM 主题的生成规则带一层作用域类（`EditorView.theme` → `buildTheme(".<生成类>", spec)`；无 `&` 的选择器一律改写为 `主选择器 + " " + sel`），specificity 0,2,0 压过前者的 0,1,0 → **真正生效的是 editor.ts 那一份**，style.css 那一份是同一语义的第二处写值（REVIEW.md 第 8 条同族） | `src/style.css:28`、`src/editor.ts:1196`、`node_modules/@codemirror/view/dist/index.js:6788-6800`、`:8744-8749`（`@codemirror/view@6.43.11`） |
| 4 | 正文排版整体**相对量化**：标题 `1.04em`–`1.78em`、列表标记 `.85em`、引用 / 公式 `.92em`……因此「改一个字号」会按比例带动全套正文排版，不需要逐元素改 | `src/preview/theme.ts:60-65`、`:152-160`、`:193`、`:241` 等 |
| 5 | 字体族在编辑器内的分布：md 正文 = `--font-body`、code 模式 = `--font-mono`（同一个 `baseTheme` 按模式二选一，`src/editor.ts:1186`）；围栏代码块 / frontmatter / 列表标记 / mermaid 源码 = `--font-mono`；标题与 callout 标签 = `--font-display` | `src/editor.ts:1186`、`src/preview/theme.ts:56`、`:108`、`:152`、`:160`、`:241`、`:308`、`:319` |
| 6 | 字体 / 字号变化**需要重新测量**：列表标记宽度由 canvas 按 `parseFloat(computedFontSize) * .85` + `--font-mono` 量出，并在「`documentElement` 的 style / class 变化」与「`document.fonts` loadingdone」时重测 | `src/preview/lists.ts:38-48`、`:62-66` |
| 7 | 基线的 token 化并不彻底：`.filetree` 与 `.ft-empty` 把正文族写成了字面量（`font-family: -apple-system, "PingFang SC", sans-serif`）而非 `var(--font-body)` | `src/style.css:111`、`:226` |
| 8 | 视觉基线共 **30 张整页 / 元素 PNG**（13 个快照目录），以 `deviceScaleFactor=1`、1200×800 CSS px 为口径。字号或字体一变，整页像素必然变——「默认口径零变化」因此是一条可断言、也必须断言的硬要求 | `find tests/visual/baselines -name '*.png' \| wc -l` = 30；`tests/visual/README.md:23-25` |

### 二、键位占用核实（候选键逐条核，三条独立来源）

| 候选键 | 表内（`src/keys.ts` 即真源） | 原生菜单 accelerator（muda 0.19.3） | 系统级 / webview |
|---|---|---|---|
| ⌘= | 空（全表 47 条字面量 + 9 条生成绑定逐个核过） | 不在集合里 | 见下「一个真实存在的旁路」 |
| ⌘+（⌘⇧= 的字符形态） | 空 | 不在集合里 | 同上 |
| ⌘− | 空（表里唯一的减号键是 `Ctrl-Alt-Minus` → `editor.redo`，即 ⌃⌥⇧−） | 不在集合里 | 同上 |
| ⌘0 | 空 | 不在集合里 | 同上 |

- **相邻的 ⌘ 系已占用键（说明这批键不是「没人管」的空地）**：⌘S 保存、⌘A 全选、⌘Z/⇧⌘Z 撤销重做、⌘F 文件内搜索、⌘/ 键位面板（`app.describe-bindings`，M133）、⌘⇧O 大纲、⌘O vault 切换器、⌘W 关标签、⌘1–9 直达标签。本 change 要用的四个 token（`Cmd-=` / `Cmd-+` / `Cmd--` / `Cmd-0`）不在这批里。

- **表内**：`src/keys.ts:285-362`（`KEY_BINDINGS` 47 条字面量 + `TAB_GOTO_BINDINGS` 9 条生成）。核到 ⌘ 系全部绑定后，`Cmd-=` / `Cmd-+` / `Cmd--` / `Cmd-0` 四个 token 均无占用。
- **原生菜单**：muda 0.19.3 的 `PredefinedMenuItemType::accelerator()` 逐项为 ⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M / ⌃⌘F（Fullscreen）/ ⌘H / ⌥⌘H / ⌘W / ⌘Q（muda `src/items/predefined.rs:300-342`），**没有** ⌘= / ⌘− / ⌘0；tauri 2.11.5 默认菜单里 View 子菜单只有 Fullscreen 一项、Window 子菜单的 Maximize（文案「Zoom」）不带 accelerator（tauri `src/menu/menu.rs:191-235`）。
- **一个真实存在的旁路（本 change 必须显式否掉）**：Tauri 内建「webview 缩放热键」——`zoom_hotkeys_enabled` 为真时会注入一段 polyfill，**自己接管 ⌘= / ⌘+ / ⌘− / ⌘0**（每次 20%，起点 1.0）并调用 `plugin:webview|set_webview_zoom`（tauri 2.11.5 `src/webview/scripts/zoom-hotkey.js`、`src/manager/webview.rs:555`）。本项目**未启用**（`src-tauri` 全仓零命中；Tauri 侧默认 `false`：tauri-runtime 2.11.3 `src/webview.rs:526`）。启用它就会让同一物理键存在**第二条分发路径**，与「分发只有一条路径」的不变量正面冲突（`openspec/specs/keymap-commands/spec.md` 的「统一键位分发表」）。

### 三、Emacs 对应物（ADR 0006 的当前阶段定位）

Emacs 的 `text-scale-adjust`：「To increase the font size of the `default` face in the current buffer, type `C-x C-+` or `C-x C-=`. To decrease it, type `C-x C--`. To restore the default (global) font size, type `C-x C-0`」；「Each step scales the text height by a factor of 1.2」；作用面是 `default` face（**buffer 局部**），另有全局变体 `C-x C-M-±`（[Text Scale](https://www.gnu.org/software/emacs/manual/html_node/emacs/Text-Scale.html)）。

对应关系：配置项 = 基准字号（也就是 `C-x C-0` 回到的那份「global」值）、命令 = 运行期步进、倍率取 1.1（比 1.2 细一档，代价是多按一次；见 design §2.4）。两处**自觉的偏离**：

1. **键位不取 Emacs 原键**：`C-x C-=` 是多段 chord。本版键位层虽支持 chord，但 `[keys]` 配置**明确拒绝含空白的键位**（`src-tauri/src/config.rs:316-318`）——把默认键位押在 chord 上，等于把这三条命令变成「用户改不了键」。因此默认键位取 mac 惯例的 ⌘ 系，与「⌘ 系归 macOS 惯例、⌃ 系归 Emacs 惯例」的既有分工一致（`src/keys.ts:274-284`）。
2. **作用面是应用运行期，不是 buffer 局部**：Emacs 是 buffer-local，本提案推荐应用级（一份值管全部会话），与 M180 的折行裁决（D1「应用级。」）同口径；代价与替代方案见 D5 与 design §2.4。

### 四、与相邻需求的边界（本 change 不承揽的部分）

1. **整体界面缩放**（连左栏 / masthead 一起变大）：这是**另一个需求**，不是本需求的同义改写。本提案把它作为 D4 的备选摆到台面上，推荐形态下不做（否决理由见 design §3）。
2. **排版基线的再设计**（换哪套字体族 / 行高 / 栏宽 / 对比度）：归你的视觉裁决。本 change 只开配置口，**不替你定字体审美观**，也不动 `--font-display` 的默认值与 `--measure` / `--line-height`。
3. **配置热重载**：现状 `config_get` 只在启动读一次（`src/main.ts:830-841` 是全仓唯一消费点），本 change 不改这个时点——字体改动需重启，字号有快捷键（D2 的取舍）。
4. **字重 / 字距 / 行高的配置**：无需求支撑（Non-goals）。
5. **鼠标滚轮 + 修饰键缩放**（Emacs 也有 `mouse-wheel-text-scale`）：无需求支撑（Non-goals）。

### 五、与既有制品的关系

- **ADR 0006 §3**「删除三主题实现，收敛到单套排版基线（字体 / 行高 / 栏宽 / 对比度的单层 token）」——本 change 是给这套基线**开配置口**，不是替换它：默认口径逐项不变，是一条硬要求。
- **M180 `line-wrap-options` 先例**（`openspec/changes/archive/2026-09-18-line-wrap-options/`）：`[editor]` 配置项 + `view.*` 全局命令 + 应用运行期口径 + 不落盘。本 change **沿用**这三条纪律，**偏离一处**：M180 的翻转是 CM 扩展重配（`Compartment`），本 change 走 CSS 变量（理由与代价见 design §2.3）。

## What Changes

1. **新增三个配置项**（`[editor]` 表，沿用「JSON 键名 = Rust 字段名」的既有口径）：`font_family`（正文族，string，缺省 = 基线观感）、`mono_font_family`（等宽族，string，同上）、`font_size`（数值，默认 16，合法区间 [12, 32]；区间外返回值回落默认并附 warning）。三项都只在启动装载时读一次。（delta：`typography` / 编辑器排版的 token 层与其配置来源）

2. **新增一层编辑器作用域的排版 token**：`--editor-font-family` / `--editor-mono-family` / `--editor-font-size`，默认值分别引用基线的 `--font-body` / `--font-mono` / `16px`。编辑器内一切字体族与字号引用 SHALL 收敛到这一层（`src/editor.ts` 的 `baseTheme` 与 `src/preview/theme.ts`），MUST NOT 再直接引用 shell 基线 token——这样「配置只影响编辑器、shell 保持基线」是**结构性**保证，不靠逐处记得改。默认值就是今天的观感，因此出厂默认口径逐项不变。顺带收起第 3 条那条双写（`src/style.css:28` 与 `src/editor.ts:1196` 今天各写一份 16px）。（delta：`typography` / 编辑器内字体引用的单一来源）

3. **新增三条命令**：`view.text-scale-up` / `view.text-scale-down` / `view.text-scale-reset`，作用域 `global`，默认键位 **⌘= 与 ⌘+（放大）、⌘−（缩小）、⌘0（回到配置字号）**。（delta：`keymap-commands` / 字号步进命令与默认键位）

4. **步进口径**：每次 ×1.1 后取整为整数 px；上下限 12px / 32px，到界后继续按**无变化、无提示、不报错**；`reset` 回到**当前配置值**（不是出厂 16px）。状态是**应用运行期**的一份值：全部会话取同一口径（新标签页取当前运行期值，不是配置默认），不写文档、不进撤销栈、不改变 dirty、**不落盘、不回写 `config.json`**（与 M180 的 toggle 同纪律，ADR 0002 §5「配置即数据」）。

5. **变更后重测量**：应用排版值（启动配置或命令）之后 SHALL 让各会话重新测量（`requestMeasure`），保证行高、光标矩形、列表标记宽度与画面对齐。这是本 change 最容易漏掉的一环：**CSS 换了但 CM 没重测**的表现是光标矩形与画面错位（M103 / M110 缺陷族同形态）。消费点已有同族先例（`src/preview/lists.ts:62-66` 监听 `documentElement` 的 style 变化并重测）。（delta：`typography` / 排版变更后的重测量）

6. **出厂默认口径不变**：默认配置下，字号、字体族、行高、栏宽逐项与今天相同；**既有 30 张基线逐张零差异**是硬要求。反过来，任何一张既有基线在本 change 后变化，就说明实现引入了与字体无关的位移——按缺陷处理，不按「有意变更」重拍。（delta：`typography` / 出厂默认口径不变）

## 命令面（评审时先看这一节）

| 项 | `view.text-scale-up` | `view.text-scale-down` | `view.text-scale-reset` |
|---|---|---|---|
| 默认绑定 | ⌘=（主体）+ ⌘+（同一物理键的字符形态，浏览器惯例） | ⌘− | ⌘0 |
| 作用域 | `global`（焦点在左栏 / 搜索框 / 浮层里同样命中） | `global` | `global` |
| 生效对象 | 编辑器内容字号（md 正文 + md 代码块 + code 模式，同一个 token） | 同左 | 同左 |
| 状态归属 | 应用运行期（全部会话一致；新标签页取当前运行期值） | 同左 | 同左 |
| 到界行为 | 已在 32px → 无变化、无提示、不报错 | 已在 12px → 同左 | 回到配置值（不是出厂值） |
| 落盘 | 不落盘、不回写（`config.json` 前后逐字节不变） | 同左 | 同左 |
| id 前缀 | `view.`（**不用** `editor.`）：本仓 `editor.` 前缀 = editor 作用域命令，作用域由命令清单机械派生（`src/keys.ts:499`），前缀与作用域 MUST NOT 互相打脸 | 同左 | 同左 |
| 命名里的 `text-scale` | 取自 Emacs 的 `text-scale-adjust`——它改的是**文字**大小。若 D4 裁决取「整体 webview 缩放」，id 应改成 `view.zoom-*`（如实说改的是什么） | 同左 | 同左 |

## 须提请 Alex 节点 1 裁决的选项

六项都给了推荐项，**推荐项已默认写进 delta 与 tasks**；若裁决改成备选，delta 与 tasks 按备选列改写，不静默扩 scope。

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **作用面**：配置与 ⌘= / ⌘− / ⌘0 作用于**编辑器内容**，还是**整个界面**（含左栏 / masthead / 浮层字号）？ | 编辑器内容（正文 + 代码）；shell 保持基线——这条由 token 分层结构性保证（What Changes #2） | ① 全界面一起变 | 推荐项给的是「阅读舒适度」这件需求本身。全界面一起变会动 `src/style.css` 的每个字号与 `--nav-width` 等布局常量，基线全量重拍，并把「界面密度」这个更大的话题卷进来。若你真实感受到的是**界面整体太小**（不只是正文），那不是字号问题——请直接看 D4 的备选 B |
| D2 | **字体选择开放度** | 配置里写**自由字符串**（CSS font-family 值），缺省 = 基线；**重启生效**（与 `editor.mode` 同口径） | ① 内置候选清单 + 循环命令（运行期可换）；② 系统字体枚举 + 选择浮层 | 推荐项零新 UI、零新维护表，且「用户自己的字体」不需要应用替他列清单。①的代价是候选清单成为第二处真源（清单在代码里、选择在配置里），且「清单里没有我要的字体」无处可去；②要新造原生枚举 + 一个新浮层：WKWebView 没有枚举本地字体的 JS API（Local Font Access API 只有桌面版 Chromium 支持，[caniuse 记 Safari 不支持](https://caniuse.com/mdn-api_permissions_permission_local-fonts)），远超本 change |
| D3 | **正文与代码字体分设还是一体** | **分设两个字段**（`font_family` / `mono_font_family`）；标题族 `--font-display` 不可配 | ① 一个字段同时管正文与代码；② 再加第三个字段管标题 | 「一体」会把功能约束卷进审美选择：等宽是**功能**要求（代码对齐、列表标记按等宽测量 `src/preview/lists.ts:44`、表格管道对齐），一个比例字体会破坏它们。②把标题审美裁决卷进本 change，而标题族正是你要拍板的视觉面（本提案刻意不碰） |
| D4 | **放缩语义与默认键位** | **字号步进**（改编辑器内容字号）+ ⌘= / ⌘+ / ⌘− / ⌘0（mac 惯例） | A. 同上但键位取 Emacs 的 `C-x C-=` / `C-x C--` / `C-x C-0`（多段 chord）；B. **整体 webview 缩放**（`set_zoom`，界面一起变大）+ 同一组 ⌘ 键 | 推荐项的理由：你原话把「字号选择」与「放大缩小快捷键」并列，最自然的读法是**同一件事的两端**（配置给基准、快捷键在运行期步进）；整体缩放会引入**第二条互相独立的缩放轴**（配置 16px × 缩放 1.2 ≠ 你以为的 16px），同一视觉结果两个真源。A 的代价是实打实的：`[keys]` 不能重绑含空白的键位（`src-tauri/src/config.rs:316-318`），默认押 chord 等于这三条命令用户改不了键。B 的代价见 design §3（视觉基线在非 100% 缩放下的可比性、双轴语义，以及必须自己实现而不能启用 Tauri 的缩放热键 polyfill） |
| D5 | **命令切的字号是否持久化** | **不持久化**：命令只改应用运行期，重启回到配置值；⌘0 = 回到**配置值** | ① 持久化（命令改了写回 `config.json` 的 `editor.font_size`）；② ⌘0 回到出厂 16px | 推荐项与 M180 的 toggle 同纪律，且与 Emacs 逐条对应（`C-x C-0` 回到「default (global) font size」= 配置口径）。①会新增第三条配置写通道（现状运行期只写 `last_vault` 一个字段），把「配置即数据」的输入面变成应用状态存储；②会让「我配置了 18px，⌘0 却给我 16px」看起来像 bug |
| D6 | **像素基线受影响面的处置口径** | **默认口径既有基线逐张零变更**（硬要求）+ 只**新增**非默认口径的独立基线（1–2 张代表值：大字号、自定义字体），新增基线待你过目 | 允许重拍既有基线 | 推荐项把「默认不变」变成可失败的门禁：既有基线若变了，就是实现引入了与字体无关的位移（REVIEW.md 第 3 条：容差会吞掉真实变化）。备选项在推荐形态下**不应发生**——真发生了先当缺陷查，不要用重拍掩盖 |

**未列入裁决面的硬约束**（写进 delta，不由节点 1 逐条选）：不落盘、不回写（ADR 0002 §5）；不改写源文件（ADR 0003 §3，本 change 只改显示）；不启用 Tauri 的 webview 缩放热键（第二条分发路径）；默认口径逐像素不变；不新增可见 UI；推荐形态下零新增文案（键位面板会自动多出三行，分组与文案都不动）；`config.json` 的既有字段与未知字段行为不变。

## capability 归属

**结论**：**宿主 = 新建 capability `typography`**；**配套 delta = `keymap-commands`**（新增 requirement「字号步进命令与默认键位」）。

| 本 change 的条款 | 为什么落在这里 |
|---|---|
| 排版 token 层、它的默认值、配置来源、编辑器内引用纪律 | 这是 `src/style.css` `:root` 那一层排版基线的可配面（ADR 0006 §3 的单套排版基线今天**没有 living spec 居所**）。塞进 `editor-live-preview` 会把那份 spec 的 Purpose（单内核双模式 + live preview 装饰 + 性能合同）撑歪：字号与字体族在 md 与 code **两种模式**下同样生效，其中一部分元素（围栏代码块、frontmatter、列表标记）与 live preview 无关 |
| 字号步进的口径（档位 / 上下限 / 重置语义 / 作用域 / 不落盘） | 与上一条同层：它是排版 token 的**运行期写入路径**，不是某个编辑功能的开关。M180 把折行放进 `editor-live-preview` 是因为折行确实是「Markdown / 代码块怎么呈现」，本 change 不是同一件事 |
| 排版变更后的重测量与坐标正确 | 这是一条跨渲染层的**不变量**（CSS 变了必须重测），写成 `typography` 的独立 requirement 才能被复用与回归 |
| 三条命令的 id、作用域、默认键位、占用核实、以及「不得启用 Tauri 缩放热键」 | 归 `keymap-commands`：命令清单与默认绑定表的单一真源在那里（`src/keys.ts`），「分发只有一条路径」的不变量也在那里 |

成本如实记录：新建 capability 会在 archive 时由 CLI 写入占位 Purpose，**需手写替换**后再跑一次 validate（`docs/process/openspec-workflow.md` 的批次收尾 checklist 已记这条）。

## Non-goals

- **不做整体界面缩放**（推荐形态下）：不改 `--nav-width` / 左栏字号 / masthead 字号 / 浮层字号；不启用 Tauri 的 `zoom_hotkeys_enabled`（它是上述「第二条分发路径」）。
- **不做字重 / 字距 / 行高 / 栏宽的配置**：只开字体族与字号两个轴，且不动 `--line-height` / `--measure` 的默认值。
- **不做字号与栏宽的联动**：`--measure` 保持 `80%`（相对编辑区宽度）。因此**字号越大，每行字数越少**——这是本 change 自觉接受、并写进 spec 的已知后果（若 dogfood 后觉得大字号下每行过短，另案把栏宽改成相对字号量）。
- **不做字体枚举 UI / 候选清单 / picker**：字体走配置字符串 + 重启（D2 推荐）。
- **不做原生菜单入口**（View 菜单项 / 勾选项）：与 M180 的 D2 同口径，可见面收敛在「配置文件 + 键位面板」。
- **不做 `M-x` / 命令面板**：那是通用能力（含被 `[keys]` 解绑的命令），超本 change 边界。
- **不做逐标签 / 逐文档的字号**：应用级一份值（与 M180 的折行 D1 同口径）；Emacs 的 buffer-local 粒度不在本版。
- **不做鼠标滚轮 + 修饰键缩放**：Emacs 有 `mouse-wheel-text-scale`，本版无需求支撑。
- **不做配置热重载**：字体改动需重启（`config_get` 只在启动读一次，本 change 不改这个时点）。
- **不做 CJK / 拉丁分设字体**：一个 family 字符串里用户自己写字体栈即可。
- **不给 `--font-display`（标题 / 装饰）开配置口**：那属于你要拍板的视觉审美面，本提案刻意不碰；也不顺手把 `src/style.css:111` / `:226` 那两处字面量改成 token（那是 shell 面的清理，与本 change 的作用面无关）。
- **不改进编辑器内的渲染结构**：不把代码块换成 `<pre>` 副本、不动表格 / 公式 / mermaid 的排版结构；本 change 只改「字号与字体族的取值从哪来」。
- **不做 zoom 的 toast / 常驻读数**：字号变化的可见结果就是反馈（与 M180 的 D5 同口径）。

## Impact

- **影响的 specs**：**`typography`（新建）** —— ADDED ×4（排版 token 层与其配置来源、编辑器内字体引用的单一来源、排版变更后的重测量、出厂默认口径不变）；**`keymap-commands`** —— ADDED ×1（字号步进命令与默认键位，含占用核实与「不得启用 webview 缩放热键」）。
- **影响的代码/系统**：
  - `src-tauri/src/config.rs`：`EditorConfig` +3 字段（`:70-95`）、`RawEditorConfig` 镜像 +3（`:155`）、`validate` 的 editor 分支 +3（`:231-283`）、单测；
  - `src/style.css`：`:root` 新增三个编辑器 token（默认值 = 今天的观感）；收起 `.cm-content` 那处重复的 16px（`:28`）；
  - `src/editor.ts`：`baseTheme` 的字体族 / 字号改引用编辑器 token（`:1186`、`:1196`）；施加点（写 token + 请求重测量）；三条命令实现与运行期真源；
  - `src/preview/theme.ts`：编辑器内字体引用改引用编辑器 token（代码块、frontmatter、列表标记等）；
  - `src/main.ts`：`config_get` 接线处（`:830-841`）加一次排版配置应用；
  - `src/keys.ts`：3 个命令 id 进 `NON_TAB_GLOBAL_COMMAND_IDS`（`:166-184`）、4 条默认绑定、每条绑定带 `doc`；
  - `src/bindings/*`：ts-rs 生成物随 `cargo test` 更新（漂移门禁在 `scripts/gate.sh:61-70`）；
  - `src/bindings-panel.ts`：**不改**（三条命令自动落既有「全局」组，分组标题数组与文案都不动）。
- **影响的测试/验收**：`src-tauri/src/config.rs` 内的 Rust 单测（新字段默认值 / 越界回落 / 类型不符走整文件回落）；`tests/unit/keys.test.ts`（新绑定的 token 形态，尤其减号键）；新增视觉场景 `tests/visual/scenes/typography.spec.ts`（配置生效 + 步进 + 上下限 + 重置 + 重测量后的坐标正确）+ 既有 30 张基线逐张核对；`scripts/acceptance/`（新增验收场景 + `lib/app.mjs` 的 `writeConfig` 扩三个字段）。
- **视觉基线**：默认口径**零变更**（硬要求）；新增基线只增不改、数量控制在 1–2 张代表值，且按 AGENTS.md 硬规则**待你过目**后才生效。
- **性能**：应用一次排版值 = 一次样式重算 + 一次视口级重测量（CM 的行高测量是视口有界的既有路径）；无解析、无文档遍历、无新增 IO、无新增启动 IO（沿用 `config_get` 那一次）。不触碰 ADR 0002 §6 的四条阈值。
- **关联约束**：ADR 0006 §3（单套排版基线：本 change 给它开配置口，不替换它）、ADR 0002 §5（配置即数据 + schema 校验）、ADR 0002 §6（性能合同）、ADR 0001 §3（非目标）、ADR 0001 §4（键位形态 chorded + 非 modal）、ADR 0003 §3（不改写源文件）、ADR 0004 §5（功能变更走 OpenSpec）。
