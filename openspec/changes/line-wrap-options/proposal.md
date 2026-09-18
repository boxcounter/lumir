# Proposal: 折行选项——文件默认折行、代码块默认不折行

- Change ID: line-wrap-options
- 日期: 2026-09-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 实测原话（2026-09-18）：**「代码块——折行选项，默认不折行」**、**「文件的折行选项，默认折行」**。

这两句话与现状的关系并不相同，逐条说清：

**一、文件级折行已是现行行为，缺的是「关掉」的手段。** 编辑器每个会话的扩展列表里都无条件装有
`EditorView.lineWrapping`（`src/editor.ts:1227`，在 `sessionState(...)` 的扩展数组内），对 md 模式与
只读 code 模式一视同仁。所以「文件默认折行」今天已成立，但没有对应的开关。Emacs 侧的对应物是
`truncate-lines`：官方手册写明折行是缺省、「By default, continued lines are wrapped at the right
window edge」，截断由 `C-x x t`（`toggle-truncate-lines`）**按 buffer 局部**开与关
（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。
Lumir 当前阶段定位就是 Emacs keybinding PKM（[ADR 0006](docs/adr/0006-agent-positioning-deferred.md)），
这个开关是同一手感的缺口。

**二、代码块今天也是「折行」，Alex 要的默认是「不折行」——落地后是一次可见的默认行为变更。**
围栏代码块在 live preview 里不是 widget，而是普通文档行加装饰：`src/preview/livePreview.ts:792-798`
只对块内每一行 push `Decoration.line({ class: "cm-lp-codeblock-line" })`，样式里只有背景色与等宽
字体（`src/preview/theme.ts:59`）；既没有自己的横向滚动容器，也没有任何 `white-space` 覆盖。因此代码
块行继承 `.cm-content` 上 `cm-lineWrapping` 带来的 `white-space: break-spaces`（CM 基础主题；给它
加这个类正是 `EditorView.lineWrapping` 的实现方式），超长代码行今天**折行**显示。

**证据（本仓现值）**：`grep -rn "cm-lp-codeblock" src/` 只有 `livePreview.ts:794` 与 `theme.ts:59`
两处；`theme.ts:59` 那条规则里没有 `overflow` 也没有 `white-space`。

结论：本 change 落地后，含超长代码行的文档看起来会变（折行 → 截断 + 块内横滚）。这是 Alex 要的口径，
但必须作为**默认行为变更**显式记录，不能包装成「只是多了一个开关」悄悄发生。

配置面已向 Alex 声明，提案评审时可改：两个全局配置项（配置即数据惯例，ADR 0002 第 5 条）+ 两个可绑定
命令（默认不占键位，走 M132 的 `[keys]` 重绑），不做 per-file 持久化。

## What Changes

1. **两个新配置项，落在既有 `editor` 表内**（与 `editor.mode` 同表、同命名风格——JSON 键名就是 Rust
   字段名的 snake_case，本仓不给配置字段做 serde rename，`src-tauri/src/config.rs:49`）：

   ```json
   { "editor": { "mode": "md", "line_wrap": true, "code_block_wrap": false } }
   ```

   - `editor.line_wrap`（布尔，出厂 `true`）：文档正文的折行。`false` = 截断（Emacs 的 truncate 语义）。
   - `editor.code_block_wrap`（布尔，出厂 `false`）：围栏代码块的折行。`false` = 代码块不折行，超长行
     在**代码块自己**的横向滚动容器里滚动，文档其余部分照常。
   - 两者独立：代码块行上的判定以 `editor.code_block_wrap` 为准（更具体者优先），其余行以
     `editor.line_wrap` 为准。同一元素上的 `white-space` MUST NOT 有第二条规则参与判定。
   - 取值来自**启动时读一次**的配置（与 `editor.mode` 同一口径）：运行期改 `config.json` 不生效，
     本版不引入配置热重载（现状：`configGet()` 只在启动调用一次，`src/main.ts:805`）。

2. **代码块的「不折行」是块内横滚，不是整窗横滚。** 超长代码行 SHALL 在代码块自己的滚动容器里横向
   滚动，MUST NOT 让编辑器整体（含标题、正文）出现横向滚动。落点是既有机制——表格已经这么做：
   `.cm-lp-table-scroll` 是 rank 10 的外层 wrapper（`overflow-x: auto`，`src/style.css:273-289`），由
   `EditorView.blockWrappers` 注入（`src/preview/livePreview.ts:234-279`、`:317`）。代码块复用同一
   机制，不新建第二套方案。

3. **两个 toggle 命令**：`editor.toggle-line-wrap` 与 `editor.toggle-code-block-wrap`，作用域
   `global`（与 `tab.close` / `toc.toggle` 同理由：它作用于当前标签页这一窗口级对象，用户可能在
   文件树或浮层里持有焦点时切换），实现落在装配层（`src/main.ts`）。**默认不绑键**——这是 Emacs
   `toggle-truncate-lines` 的「局部开关」语义在 Lumir 的落点，`[keys]` 配置 SHALL 能像其余命令一样
   把它们绑上键。它们的 `doc` 字段 SHALL 写明「默认不绑键、经 `[keys]` 配置绑定后可用」。

4. **toggle 是瞬态，不回写配置、不落盘**。语义按 Emacs 的 buffer 局部模型：当前标签页翻转，
   该标签页关闭或应用重启后回到配置值；新开的标签页从配置值开始。`config.json` MUST NOT 因翻转而
   被写入（配置是输入，不是运行期状态）。翻转 SHALL 立即生效，MUST NOT 要求重新打开文件。

5. **翻转要有可观测的反馈**。代码块开关在「文档里没有超长代码行」时翻转是看不出区别的，
   文件开关在没有超长行的文档上同理。因此翻转 SHALL 给出一次瞬态提示（沿用既有 toast，
   `src/main.ts:110`），写明是哪一项折行、变成什么状态。文案进 `文案-Copy.md`。

6. **键位层的「无孤儿命令」不变量需要一条显式出口**。现行 living spec 要求「表内的每条命令 SHALL
   至少有一条绑定」（`openspec/specs/keymap-commands/spec.md:12`），并有门禁在守：`src/keys.ts` 的
   `COMMAND_IDS` 逐条必须能在 `KEY_BINDINGS` 里找到绑定（`tests/visual/scenes/m131-keymap-table.spec.ts:52-66`）。
   两条默认不绑键的命令会让这条不变量不成立。本 change 的口径是**显式登记**而不是放宽：`src/keys.ts`
   新增一份「默认不绑键」清单（`KEYLESS_COMMAND_IDS`），不变量改为「每条命令要么有绑定、要么在该
   清单里登记；两者都不占的才算孤儿；登记项 MUST NOT 同时出现在绑定表里」。这样「默认不绑键」是一个
   有人签字的决定，不是遗漏——形如 M131 消灭的「命令实现了但没人绑」那种静默状态。

## 裁决点（提案评审时请 Alex 定，逐条都可改）

| # | 待定 | 本提案的默认取向 | 换一种的话代价有多大 |
|---|---|---|---|
| D1 | 配置项命名与默认值 | `editor.line_wrap` 默认 `true`、`editor.code_block_wrap` 默认 `false` | 改名只动 Rust 侧字段名与两个 delta 的措辞；默认值反向则与 Alex 原话相反，不提议 |
| D2 | 两个 toggle 默认不绑键 | 保持不绑（`KEYLESS_COMMAND_IDS`） | **代价是可达性**：Lumir 的键位层不支持多段 chord（`[keys]` 里含空白的键位被拒，`src-tauri/src/config.rs:283-288`），因此没有 Emacs 那种 `C-x x t` 的写法，也未实现 `M-x`。不绑键 = 只能靠手改 `config.json` 才能触发（改完需重启，见 D3）。若 Alex 要「装好就能用」，改动是给两条命令各加一条默认绑定（并在三条来源上核对冲突：表内 / 原生菜单 accelerator / 系统级，核对手续见 `keymap-commands` 的「标签命令族」requirement 的同名 scenario），此时它们退出 `KEYLESS_COMMAND_IDS` |
| D3 | 是否需要热生效 | 不引入：配置仍是启动读一次（与 `editor.mode` 一致） | 引入配置监听或「重载配置」命令是新能力（新增命令 id、新增文件监听、失败路径），建议单独立 change；本 change 用 toggle 命令承担「运行期改主意」的需求 |
| D4 | 翻转反馈 | 加一次瞬态 toast（第 5 条） | 若不要反馈，删掉该条 requirement 与对应 scenario、删掉 `文案-Copy.md` 条目即可；但那时「翻转生效了吗」在无超长行的文档上不可自证 |

## Non-goals

- **不做 per-file 持久化**：不写 `config.json`、不写任何 per-file 状态、不做「记住这个文件的折行」。
  瞬态值随标签页存活，重启即回配置默认。
- **不做菜单入口**：不在 macOS 原生菜单加「视图 → 折行」项。菜单通道（`app:menu_command` →
  `MENU_COMMANDS`，`src/main.ts:473-480`）技术上可用，但那会把本 change 的可见面从「配置 + 命令」
  扩成「配置 + 命令 + 原生菜单」，还要背上菜单结构假设校验那一套（`keymap-commands` 的「菜单与命令层
  一致」requirement）。若 D2 选择可达性优先，请在这两处之间选一处，不要都做。
- **不做 M-x / 命令面板**：那是通用的「无键位命令怎么触发」能力，覆盖面远大于折行（现有 51 条命令里
  被 `[keys]` 解绑的同样受益），本 change 不顺手起一个半成品。
- **不改代码块之外的结构**：表格（`.cm-lp-table-scroll`）、块级公式与 mermaid 的横向滚动容器现状不动
  （表格是 `overflow-x: auto` 的真源，本 change 只复用它的机制，不重构它）。
- **不做 per-language / per-block 折行**：只有「文件级」与「代码块级」两个粒度。
- **不做折行宽度、字号、栏宽（`--measure`）的可配置化**：`--measure` 是 `:root` 静态变量
  （`src/style.css:9`），本 change 不碰。
- **不改只读 code 模式的可编辑性**：折行是视图属性，与 `editable(false)` 的只读保证无关。
- **不引入新视觉语言**：滚动容器的样式沿用既有 editorial token 与既有 `overflow` 写法。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED ×2：折行口径与配置来源、折行开关的瞬态口径）、
  `keymap-commands`（MODIFIED ×2：统一键位分发表、键位查看面板；ADDED ×1：折行开关命令）。
- 影响的代码/系统：
  - Rust 配置层：`src-tauri/src/config.rs`（`EditorConfig` 增两个字段 + `RawEditorConfig` 容忍缺省 +
    `validate()` 逐字段回落与 warning + 单测）。
  - 前端：`src/bindings/EditorConfig.ts`（ts-rs 重新导出，bindings 漂移门禁会比对）、
    `src/editor.ts`（新增一个 wrap Compartment 与会话级折行状态，逐会话持有）、`src/preview/`
    （代码块的 block wrapper + 折行类）、`src/keys.ts`（两个新命令 id + `KEYLESS_COMMAND_IDS`）、
    `src/main.ts`（配置应用与两个命令实现）、`src/style.css` 或 live preview 主题（代码块滚动容器样式）。
  - 无 Rust 行为变更、无 IPC 协议变更（`config_get` 的返回体多两个字段，属 ts-rs 自动导出）。
- 影响的测试/验收：
  - 需**改**的既有门禁：`tests/visual/scenes/m131-keymap-table.spec.ts`（无孤儿命令的两处循环改为
    「绑定 ∪ 默认不绑键清单」的对账）、`tests/visual/scenes/m133-describe-bindings.spec.ts`（分组
    标题数组不变，但「无未绑定行」与行数断言要跟着变）、`src/bindings-panel.ts` 的分组表（两条命令
    归入既有「全局」组，不新增分组）。
  - 需**新增**的：折行的视觉场景（含一条**超过栏宽**的代码行 fixture——这一点是硬要求，见下）、
    真机验收场景（WKWebView 下横向滚动与 toggle 生效）。
  - **基线风险（REVIEW.md 第 3 条的现场）**：现有代码块 fixture 的最长行是 45 字符
    （`tests/visual/fixtures/render-codeblock/languages.md`），远短于栏宽，因此本次默认值变更在现有
    基线上**看不出任何差异**——这正是「容差吞掉真实变化」的温床（0.001 在 1200×800 下约等于 960 像素）。
    所以视觉验收 MUST 自带一条超长代码行 fixture，并在 tasks 里要求逐张核对出现过代码块的基线。
  - 真机验收 harness 的配置写入目前只支持 `editor.mode` 与 `keys`
    （`scripts/acceptance/lib/app.mjs:28-33`），需扩出两个折行字段。
- 影响的文档：`文案-Copy.md`（翻转提示的新条目；键位面板分组标题不变，故 D63–D67 不动）。
- 关联约束：ADR 0002 第 5 条（配置即数据 + schema 校验——新字段走既有 `validate()` 回落路径）、
  ADR 0002 第 6 条（性能合同——代码块的块范围发现必须视口有界，与表格 wrapper 同一纪律）、
  ADR 0003 第 3 条（不改写源文件——折行是纯视图属性，文档与磁盘逐字节不变）、
  ADR 0006（Emacs keybinding PKM 定位）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
- 性能：折行切换是状态重配（Compartment reconfigure），不重建 EditorView、不重解析文档。代码块的
  块范围发现与既有表格发现同形（视口有界），不新增全文档扫描。
