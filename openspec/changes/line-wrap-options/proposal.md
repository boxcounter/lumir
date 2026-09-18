# Proposal: 折行显示选项——文件级默认折行、代码块默认不折行

- Change ID: line-wrap-options
- 日期: 2026-09-18
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 实测原话（2026-09-18）：「代码块——折行选项，默认不折行」「文件的折行选项，默认折行」。
两句话要的是同一件事的两个方向：**折行按块类型取不同默认**，而不是全编辑器一个恒开的开关。

**一、现状是「一切皆折行」，且没有运行期开关。** 折行在 Lumir 里是一条写死的扩展：
`src/editor.ts:1227` 的 `EditorView.lineWrapping` 装在 `sessionState()` 的扩展数组里，对每个会话、
md 与只读 code 两种模式同样生效；`rg -n "lineWrapping" src/` 全仓只命中这一处，项目自己的样式里
没有任何 `white-space` 覆盖（`src/style.css` 的 `white-space` 命中都属表格 cell、masthead、文件树等
非编辑器内容面）。CM6 侧的实现口径是「内容元素上的一个 class」：基座把 `white-space: pre` 放在
`.cm-content` 上，`lineWrapping` 再加一个 `.cm-lineWrapping` 把内容改成
`white-space: break-spaces; word-break: break-word; overflow-wrap: anywhere`，且 `.cm-line` 自身
不带 `white-space` 声明（上游 [view/src/theme.ts](https://raw.githubusercontent.com/codemirror/view/main/src/theme.ts)；
本仓锁定 `@codemirror/view@6.43.11`，`pnpm-lock.yaml:108`）。也就是说折行是**整块内容元素**的开关，
不是逐块能力——要让代码块与正文取不同口径，必须先补一层「按块类型覆盖」的机制，本 change 补的
就是这一层（机制与四组合口径见 design §2.2–§2.4）。

**二、代码块折行的代价，以及本仓既有的对照做法。** 代码块被折行后，缩进对齐与「一行一条语句」的
阅读节奏都会碎掉。本仓对块级结构化内容一贯给横向滚动容器，只有代码块例外：

- 表格：`src/preview/livePreview.ts:259-278` 用 CM6 的 `BlockWrapper` 把表格所在行区间包进
  `div.cm-lp-table-scroll`，样式在 `src/style.css:273-289`（`overflow-x: auto`），容器带
  `tabindex=0` / `role=region` / `aria-label`（`src/preview/livePreview.ts:262`）；
- 块级公式与 mermaid：`src/preview/theme.ts:196`、`:218` 各自 `overflowX: "auto"`；
- 代码块：只有行装饰与背景色——`src/preview/livePreview.ts:792-798` 对 `FencedCode` / `CodeBlock`
  只出 `Decoration.line({ class: "cm-lp-codeblock-line" })` 与 token 着色，样式
  `src/preview/theme.ts:59` 只有 `backgroundColor` 与等宽字体，**既没有 `white-space` 也没有
  `overflow`**——长行只能折。（顺带更正一个常见误解：代码块**不是 widget**，是行装饰；
  `rg -n "cm-lp-codeblock" src/` 只有加类与样式两处。这一结构决定了实现形态，见 design §0 与 §2.3。）

**三、与 Emacs 的对应物。** 当前阶段定位是 Emacs keybinding PKM（ADR 0006），这条需求在 Emacs 里
有直接对应物，且形态同构：默认「继续行」即折行（[Continuation
Lines](https://www.gnu.org/software/emacs/manual/html_node/emacs/Continuation-Lines.html)：
「By default, continued lines are wrapped at the right window edge」）；`toggle-truncate-lines`
就地翻转 `truncate-lines`，「works by locally changing the variable `truncate-lines`」，且
「Setting the variable `truncate-lines` in any way makes it local to the current buffer; until that
time, the default value, which is normally `nil`, is in effect」——**默认值来自全局设定、翻转是
缓冲区内的一次性状态、不落盘**（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。
本提案的形态与之逐条对应：配置项给默认，命令给标签页内的瞬态翻转，不做 per-file 持久化。
该页还给出截断场景的行为底线：「Horizontal scrolling automatically causes line truncation」——
即截断从来与「可横向滚动」配套，这也是本提案「不折行时文字必须仍然可达」那条底线的依据。

顺带一条支撑「默认不占键位」的事实：Emacs 里这条命令的规范键 `C-x x t` 是**多段 chord**，
而本版键位层明确不支持多段 chord（含空白的键位被拒，`src-tauri/src/config.rs:283-288`）。
把默认键位留给用户按 `[keys]` 自定因此是唯一自洽的选择，不是图省事。

## What Changes

1. **新增两个配置项**（`[editor]` 表，沿用「JSON 键名 = Rust 字段名」的既有口径，见
   `src-tauri/src/config.rs:70-75`）：`editor.line_wrap`（bool，默认 `true`）——文件级折行；
   `editor.code_block_wrap`（bool，默认 `false`）——代码块折行。两项只在启动装载（现状如此：
   `src/main.ts:805` 是全仓唯一读取点），改配置需重启，运行期变更由命令承担。
2. **新增两条命令**：`view.toggle-line-wrap` 与 `view.toggle-code-block-wrap`，作用域 `global`，
   **默认不占任何键位**，由 `[keys]` 绑定后可用（覆盖层零改动：`src/keys.ts:422-460` 的覆盖本来就是
   「任意键 → 任意命令」的映射）。「默认不绑键」这次是要**签字**的状态，因此落到一份显式清单
   `src/keys.ts` 的 `KEYLESS_COMMAND_IDS` 上，并修订「每条命令至少一条绑定」这条既有不变量为三项
   对账（见第 5 点与 design §2.6）。
3. **折行的生效口径（四组合）**：

   | 文件级 `line_wrap` | 代码块级 `code_block_wrap` | 正文行 | 代码块 |
   |---|---|---|---|
   | `true`（默认） | `false`（默认） | 在阅读栏内折行 | 不折行，块内横向滚动 |
   | `true` | `true` | 在阅读栏内折行 | 在阅读栏内折行（现状） |
   | `false` | `false` | 不折行，编辑区可横向平移 | 不折行，块内横向滚动 |
   | `false` | `true` | 不折行，编辑区可横向平移 | 在阅读栏内折行 |

   判定口径是「一元素一条规则」：代码块行由 `code_block_wrap` 裁决，其余所有行由 `line_wrap` 裁决；
   表格 / 块级公式 / mermaid 维持现状（它们各有自己的容器，不在本 change 的作用面内）。
4. **代码块补上块级横滚容器**：生效口径为「不折行」时，围栏与缩进代码块 SHALL 获得一个块级横滚
   容器，机制复用表格已跑通的 `BlockWrapper`（**不**换成 replace widget，理由见 Non-goals）。
   容器 SHALL 可聚焦、带无障碍名，并与表格滚动容器**共用同一判据**，使既有五条 widget 滚动键
   （`←` `→` `Home` `End` `Escape`）对代码块同样生效——不新增第二条按键通路（本项 MODIFY 既有
   requirement「轨道 D 的 widget 滚动键纳入统一键位表」，判据的 class 单一来源仍在 `src/keys.ts`）。
5. **键位表不变量放宽一处**：既有 requirement 规定「表内的每条命令 SHALL 至少有一条绑定」
   （`openspec/specs/keymap-commands/spec.md` 的「统一键位分发表」），与「两条默认不绑键的新命令」
   正面冲突。改为三项对账：`COMMAND_IDS` 每条命令要么有绑定、要么在 `KEYLESS_COMMAND_IDS` 里；
   该清单不得含幻影 id、不得与绑定表有交集。同时要求键位面板对未绑定行**说清成因与下一步**
   （既有文案 D66 只覆盖「配置解绑 / 尚未绑定」两种成因，需扩到「默认不占键位，可用 `[keys]`
   绑定」）。
6. **状态归属：标签页级（= Emacs 的 buffer-local）**。两条命令翻转的是**当前标签页**的瞬态显示
   状态，不写文档、不进撤销栈、不改变 dirty、不落盘、不回写 `config.json`；新标签页取配置默认
   （与 Emacs「设了就 buffer-local、新 buffer 走默认值」一致）。理由与替代方案见 design §2.2、§3。
7. **不折行时文字必须仍然可达**：不折行意味着超宽内容不再被压进同一行宽，它 SHALL 由容器
   （文件级 = 编辑区 `.cm-scroller` 的横向平移；代码块级 = 块内容器的横向滚动）呈现，
   MUST NOT 出现「文字被裁掉且无法到达」的状态。这是本 change 唯一的「不能退化」底线条款，
   依据见 Why 第三节的 Emacs 引文。

## 命令面（评审时先看这一节）

| 项 | `view.toggle-line-wrap` | `view.toggle-code-block-wrap` |
|---|---|---|
| 默认绑定 | 无（不占键位；登记在 `KEYLESS_COMMAND_IDS`） | 无（同上） |
| 作用域 | `global`（焦点在文件树 / 搜索框 / 浮层里同样命中） | `global` |
| 生效对象 | md 与只读 code 模式的整篇正文行 | 仅 md live preview 里的围栏 / 缩进代码块 |
| 状态归属 | 当前标签页；新标签页回落配置默认 | 同左 |
| 反馈 | 无 toast、无常驻指示（翻转结果即时可见，见 Non-goals） | 同左 |
| 落盘 | 不落盘、不回写配置（`config.json` 前后逐字节不变） | 同左 |
| id 前缀 | `view.`（**不用** `editor.`）：本仓 `editor.` 前缀 = editor 作用域命令，作用域由命令清单机械派生（`src/keys.ts:451`），前缀与作用域 MUST NOT 互相打脸 | 同左 |

## Non-goals

- **不做 per-file 持久化、不回写配置**：toggle 只改运行期状态。配置面（`config.json`）是用户手编的
  输入面（ADR 0002 §5「配置即数据」）；回写会把它变成应用状态存储，并新增第二条写通道——现状全仓
  只有 `last_vault` 一条运行期写（`src-tauri/src/commands.rs:394-428`）。Emacs 的
  `toggle-truncate-lines` 同样不落盘（见 Why 引文）。
- **不做配置热重载**：现状 `config_get` 只在启动读一次（`src/main.ts:805`，无 watcher）。新增配置项
  不改变这个时点（改配置需重启），运行期翻转由命令承担。
- **不引入逐字段的类型容忍**：`Option<bool>` 遇到类型不符（`{"editor": {"line_wrap": "yes"}}`）会走
  整文件回落（全部默认 + warning），与 `editor.mode` 给错类型同路。这是既有解析模型的性质，
  本 change 只**如实记录并用单测钉住**，不改解析模型——那会是一处与 `editor.mode` 不一致的特例。
- **不改代码块的渲染结构**：不把代码块换成 replace widget——那会丢掉源码的可选中与可编辑
  （md 模式的代码块是可编辑原文），与既有 requirement「Markdown 渲染保真」第 2 条
  「源码 SHALL 保持可选中的原文」冲突。
- **不做逐块类型 / 逐语言的更细粒度配置**：列表、引用、表格、公式、mermaid 的折行一律维持现状；
  不给代码块加「按语言决定折行」这类维度（无需求支撑）。
- **只读 code 模式（非 md 文件）的正文行不算「代码块」**：它跟随 `editor.line_wrap`；
  `editor.code_block_wrap` 只管 md 里的围栏 / 缩进代码块。code 模式下按代码块 toggle 无作用对象，
  MUST NOT 报错、MUST NOT 给提示（写进 spec，避免被读成漏实现）。
- **不加原生菜单入口**（View 菜单项 / 勾选项）：可见面会从「配置 + 命令」扩成「配置 + 命令 + 菜单」，
  并背上菜单结构假设与 accelerator 冲突核对那一套；本 change 的可见面收敛在键位面板里（见 D2）。
- **不做 `M-x` / 命令面板**：那是通用能力（现有 51 条命令里被 `/keys` 解绑的同样受益），远超本
  change 的边界，且需要新增「按 id 调用命令」的入口——现状全仓不存在这样的通道
  （唯一无事件按 id 调用是菜单桥 `src/main.ts:473-480`）。
- **不加折行状态的常驻指示（无 mode line）与 toast 播报**：翻转的可见结果就是反馈。若 dogfood 后
  发现「看不见当前状态」是真实痛点，按手感证据另提 change（候选落点：masthead 指示段，仿 Emacs
  mode line）。这是本提案自觉接受的观测缺口，见 D5 与 design §2.7。
- **不做折行增强**：不引入 Emacs `visual-line-mode` / `adaptive-wrap` 那类「按词折 + 悬挂缩进」的
  口径，本 change 只有「折 / 不折」二态。
- **不预置任何默认键位**，包括 Emacs 的 `C-x x t`（本版键位层不支持多段 chord）。
- **不动视觉容差、不引入新配色 / 新排版变量**；代码块横滚容器 MUST NOT 用 margin 表达间距
  （CM 的行高测量不含 margin，口径见 `src/style.css:284-288` 的 M110 注释）。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED ×3：折行口径与配置来源、折行渲染与代码块横滚容器、
  折行开关的瞬态口径）；`keymap-commands`（MODIFIED ×3：统一键位分发表放宽不变量、轨道 D 泛化为
  块级横滚容器、键位查看面板的未绑定行说明；ADDED ×1：折行开关命令）。
- 影响的代码/系统：`src-tauri/src/config.rs`（`EditorConfig` 两个布尔字段 + 宽容镜像与逐字段回落）、
  `src/editor.ts`（折行状态与会话级重配）、`src/preview/livePreview.ts`（代码块横滚容器 +
  表格容器补共享 class）、`src/preview/theme.ts` 与 `src/style.css`（行级 `white-space`、
  容器背景底板）、`src/keys.ts`（两个命令 id、`KEYLESS_COMMAND_IDS`、块级横滚容器 class 的单一来源）、
  `src/bindings-panel.ts`（未绑定行说明）、`src/bindings/*`（ts-rs 生成物，随 `cargo test` 更新，
  漂移门禁在 `scripts/gate.sh:61-70`）。
- 影响的测试/验收：`src-tauri/src/config.rs` 内的 Rust 单测（既有先例
  `missing_log_table_defaults_to_info`，`:519-526`）、`tests/unit/keys.test.ts`、
  `tests/visual/scenes/m131-keymap-table.spec.ts`（无孤儿命令的判据改为三项对账）、
  `m133-describe-bindings.spec.ts`（行数 / 未绑定行数 / 未绑定说明）、`render-codeblock.spec.ts`
  （新增超长代码行的容器与横滚断言）、`scripts/acceptance/scenarios/`（新增折行场景，含配置默认与
  `[keys]` 绑定后触发两条路径）、`scripts/acceptance/lib/app.mjs`（`writeConfig` 增两个可选字段）。
- 影响的文档：`文案-Copy.md` D66（未绑定行说明扩到「默认不占键位」这一成因，编号沿用、附修订记录）。
- 视觉基线：默认口径下只有「超过栏宽的代码行」行为变化；既有 fixture 的代码行都短于栏宽
  （`tests/visual/fixtures/render-codeblock/languages.md` 最长代码行 45 字符），故既有整页基线预计
  不变——真变了，就是实现引入了与折行无关的位移，按缺陷处理。任何基线更新仍走 Alex 人肉过目
  （AGENTS.md 硬规则）。
- 关联约束：ADR 0006（Emacs keybinding 定位，本 change 与该定位一致）、ADR 0002 §5（配置即数据 +
  schema 校验）、ADR 0003 §3（不改写源文件——两条命令都不碰文档）、ADR 0002 §6（性能合同：折行切换
  是扩展 reconfigure，不重解析、不重建视图）、ADR 0001 §4（键位形态）、ADR 0004 §5（功能变更走
  OpenSpec）。
- 性能：toggle 只有一次 `Compartment.reconfigure`；代码块容器是装饰层在既有视口增量纪律内多包一层
  div；无新增解析、无全量构建。

## 待 Alex 裁决

- **D1｜标签页级 vs 应用级翻转**：本提案取标签页级（真源在会话对象上，= Emacs buffer-local）。
  若要全局（切标签页也一致），规格上把「标签页」改为「应用运行期」即可，实现侧要多一次对全部会话
  reconfigure 的遍历，并另存一个模块级初值——见 design §2.2。
- **D2｜要不要原生菜单入口**（View 菜单项 / 勾选项）：本提案不做（理由见 Non-goals），可见面只有
  「配置项 + 命令 + 键位面板」。若你要菜单入口，本 change 需新增一节 requirement、菜单 accelerator
  冲突核对与菜单结构断言，工作量为本 change 的约一半。
- **D3｜命令作用域 `global` vs `editor`**：本提案取 `global`（焦点在文件树 / 搜索框 / 浮层里也生效，
  与 `tab.*`、`toc.toggle` 同族），id 前缀因此取 `view.`。若你要「只有焦点在编辑器里才生效」，
  改动是把 id 改回 `editor.` 前缀并放进 `EDITOR_COMMAND_IDS`，行为差异仅在「哪些焦点下按键有效」。
- **D4｜代码块容器的键盘可达性是否随本 change 一起做**：本提案做了（复用既有五条 widget 滚动键，
  代价是 MODIFY 轨道 D 一条既有 requirement）。若要把这部分切出去，本 change 收缩为纯折行二态，
  代码块容器只保留鼠标 / 触控板可达——代价是它与表格容器「同形而不同能力」。
- **D5｜要不要折行状态的播报 / 常驻指示**：本提案不加（无 toast、无 mode line，理由见 Non-goals）。
  若你要「按一下有回声」或让界面上一眼看出当前口径，最小落点是两条 toast 文案（`文案-Copy.md`
  续号）+ 1 个实现文件 + 1 个真机场景；常驻指示的落点建议复用 masthead 指示段（仿 Emacs mode line）。
