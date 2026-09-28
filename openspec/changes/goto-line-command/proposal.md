# Proposal: 跳转到指定行号（Emacs `goto-line`）

- Change ID: goto-line-command
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 需求原话（2026-09-27）：**「增加类似 Emacs 那样跳转到指定行号的快捷键。」**

### 一、今天没有任何「按行号定位」的路径

Lumir 现有的位置跳转全是**结构位置**：⌘⇧O 跳标题（能力在 `src/toc.ts`）、⌘⏎ 跳链接目标（`src/link-follow.ts:158` 调 `editor.revealLine(result.anchor.line)`）、⌃L 把光标行滚到视口居中（`src/editor.ts:779` 的 `recenter`）。唯独没有「跳到第 N 行」——Emacs 里这是 `goto-line`：

> `M-g M-g`、`M-g g`：Read a number n and move point to the beginning of line number n（`goto-line`）。Line 1 is the beginning of the buffer. If point is on or just after a number in the buffer, that is the default for n. Just type RET in the minibuffer to use it. …… `goto-line` has its own history list. —— [GNU Emacs Manual, 9.2 Changing the Location of Point](https://www.gnu.org/software/emacs/manual/html_node/emacs/Moving-Point.html)

`M-g` 在 Emacs 里是一个「按位置跳转」的前缀（`M-g g` 行 / `M-g c` 字符位置 / `M-g TAB` 列）。本 change 只取唯一被点名的成员 `M-g g`（= `goto-line`）。

### 二、md 模式下**看不见任何行号**，跳转的落点无从自查（节点 1 裁决：这一面要一并补上）

- code 模式有 gutter 行号：`src/editor.ts:1437` 的 `lineNumbers()` 挂在只读 code 的模式扩展里。
- md 模式没有行号（同一处只装 live preview 与结束标记）；modeline 右段给出的只有**总行数**——`src/main.ts:1008` 的 `syncModelineMeta` 拼 `` `${language} · ${lines} 行 · UTF-8` ``，`lines` 取 `view.state.doc.lines`。

Emacs 的行号可见面有两个，别把两者混成一个：mode line 上的当前行号 `line-number-mode`（`(define-minor-mode line-number-mode … :init-value t)` 默认开，[emacs-mirror/emacs, lisp/simple.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/simple.el)）与 buffer 内的行号 gutter `display-line-numbers`（**默认 Off**，`M-x display-line-numbers-mode` 可随时开关：[lisp/display-line-numbers.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/display-line-numbers.el) 与 [lisp/cus-start.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/cus-start.el) 的 `(const :tag "Off" :value nil)`）。Alex 节点 1 裁决（2026-09-27）要的是**后者在 md 模式可用**：md 文档不再豁免行号 gutter。**Alex 的二次改判（2026-09-28）**把形态从「常显」收成**可配置三档**——`[ui] markdown_line_numbers` 取 `"on-demand"`（默认：跳转输入条在场时显示、完成后隐藏）/ `"always"`（常显）/ `"off"`（恒不显示），只管 md；code 模式恒常显、不进配置。输入条里的行号可见面保留。**仍不做 modeline 常驻行号段**（取舍见裁决点 D4 与二次改判节）。

### 三、键位形态的既有约束决定了不能照抄 Emacs 的原生键

Emacs 的 `M-g g` 是**两段 chord**。本仓的 `[keys]` 配置层拒绝含空白的键位——`src-tauri/src/config.rs:546` 的 `validate_keys` 对「空或含空白」一律 warning + 忽略。M195 因此把 Emacs 的三段 chord `C-x C-=` 改成 ⌘ 系单段键，理由写在 `src/keys.ts` 的字号段注释里：「把默认键位押在 chord 上等于把这三条命令变成『用户改不了键』」。本 change 沿用同一裁决取**单段**默认键（D1），并把「要不要为 M-g 一族打开 chord 支持」作为代价可读的备选摆出来。

### 四、⌥ 系 Emacs 键位集（M132）已成一族，缺的正是 M-g

`src/keys.ts:357` 的 `KEY_BINDINGS` 里 Emacs 键位已按「⌘ 系归 macOS 惯例、⌃ 系归 Emacs 惯例」成族：⌃N/⌃P/⌃F/⌃B/⌃E/⌃A、⌃V/⌥V、⌃L、⌃D/⌃H/⌃T、⌥D/⌥⌫、⌃K/⌃Y、⌃G 与 ⌃⇧ 系扩选。其中 ⌥ 单修饰的四个 token 全是 `Alt-KeyX` 形态（`Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF`，见 `src/keys.ts:384`、`:391`、`:406-407`）。本 change 新增的 `⌥G` 是同一族的自然延伸。

### 五、需求面在哪

真实场景是「拿到一个行号，想立刻跳到那一行」：从错误日志 / stack trace / code review 批注 / 同事贴的行号跳到对应位置。今天只能靠 ⌃F 搜那段文本、或在 code 模式里用 gutter 目视滚动——md 模式连目视的锚都没有。

## What Changes

1. **新命令 `editor.goto-line` + 默认键位 `⌥G`**（token `Alt-KeyG`）：命令 id 进 `EDITOR_CORE_COMMAND_IDS`（作用域因此机械派生为 `editor`，与 ⌃N 一族同边界——id 前缀与作用域 MUST NOT 互相打脸），绑定进 `KEY_BINDINGS` 并带来由说明与三条来源的冲突核对结论（表即文档）。实现落在编辑器内核的 commands 记录；落点复用**既有的** `revealLine`（`src/editor.ts:2019`：1-based 钳制 + 行首落点 + `y:"center"` 居中），MUST NOT 另写一套落点算式。绑定可经 `[keys]` 重绑 / 解绑——默认键位是单段、无空白，配置层的形状校验放行。

2. **交互形态：挂 modeline 之上的小浮层输入条**（D2 推荐）：一行输入框（预填当前行号并全选）+ 一行 `共 M 行` 提示，向上展开——与大纲浮层 `.lumir-toc` 同一挂点（`shell.modeline`）、同一 `bottom: 100%` 定位口径与同一套 tokens（`src/style.css:1349` 起）。Enter 跳转、Escape / ⌃G 取消、焦点离开输入条即收起；输入框只接受数字字符。

3. **跳转语义**：1-based **源文档逻辑行**（`doc.lines` 口径，软换行不计），md 与只读 code 模式**同一条口径**，且**两个模式都显示行号 gutter**（md 的 gutter 由本 change 补上），因此跳到的行号与 gutter 显示的行号在两种模式下都一致；落点是该行行首、该行滚到视口居中；完成后焦点交还编辑器。整条路径**零文档改动**（ADR 0003 §3）：不进撤销栈、不改 dirty、不写盘。

4. **输入口径只有一条规则**：输入的数字按 `[1, 总行数]` 钳制后即落点（越界不报错——Emacs `(forward-line (1- line))` 到头即停的同款语义）；空输入按预填的当前行解释（Emacs 的 `RET` 用默认值同款）。

5. **md 模式的行号 gutter 改为可配置三档**（D4 经 2026-09-27 改判 + **2026-09-28 二次改判**）：md 与只读 code 装同一个 `lineNumbers()` / `highlightActiveLineGutter()`，行号是源文档逻辑行号（与 `doc.lines` 同口径、与跳转落点一致）；差别在**在场时机**，由 `[ui] markdown_line_numbers` 决定，三档 = `"on-demand"`（默认：跳转输入条在场时显示、输入条收起时隐藏）/ `"always"`（常显）/ `"off"`（恒不显示）。code 模式恒常显、**不进配置**。md 的**正文列保持居中**，gutter 落在左侧空余轨道并贴正文列左缘，且**开关瞬间正文列 MUST NOT 跳动**（几何口径与验证要求见 [design.md](design.md) §5.2）。输入条里仍显示当前行号（预填值）与总行数（提示行）。**modeline 常驻行号段仍不在本 change**（D4 的另一备选）：gutter 的常显档下「我在第几行」在视口内已有答案，再加一段常驻段是重复面，且要动 modeline 的「只读派生、零新状态」口径与窄窗退让。

6. **真机验收场景 56**（编号声明见 [tasks.md](tasks.md) §6）：走**默认键** `⌥G`（套件的 `key` 动作支持 `alt+g`——先例 `scripts/acceptance/scenarios/26-svg-scroll-stability.md:47` 的 `alt+v`），覆盖 md / code 两模式跳转、越界钳制、取消与零文档改动；另用 `[keys]` 重绑通道（先例 `scripts/acceptance/scenarios/43-list-tab-indent.md:10` 的 `config: keys:`）证明可重绑。

## Alex 节点 1 裁决（2026-09-27）

原话：**「采纳建议。但有一个我希望改动：md 文档不应该是豁免 line number gutter——我有时候需要查看 line number。」**

- **D1 / D2 / D3** 按推荐项落槌，delta 与 tasks 的这三项不动。
- **D4 改判**：md 文档不再豁免行号 gutter——md 装行号 gutter，输入条内的行号可见面保留（见下表的 D4 行与 [design.md](design.md) §5）。
- 下表保留「备选」列作可读的取舍记账；裁决已落地，改判备选不再是默认路径，而是新的改判请求（改写动作见 [tasks.md](tasks.md) 末表）。
- **本表已被 2026-09-28 的二次改判取代了 D4 行**：D4 的形态以「二次改判」节为准，D1 / D2 / D3 不变。

| # | 裁决点 | 落槌形态（已写进 delta） | 备选（裁决后可读的取舍记账） | 取舍 |
|---|---|---|---|---|
| D1 | 默认键位 | **`⌥G`**（token `Alt-KeyG`）：M-g 的单段近亲，与 M132 的 `Alt-KeyV/D/B/F` 同族；可经 `[keys]` 重绑 | (a) `⌘L`（Xcode / mac 惯例的「跳到行」）；(b) 严格 `M-g g` 两段 chord | 推荐项是唯一同时满足「Emacs 肌肉记忆的第一段」与「单段可重绑」的选项：Emacs 里 ⌥G 正是 `M-g` 前缀，按下的第一段就是它。代价如实记账：单段化后 `M-g c` / `M-g TAB` 将来无处安放，要接它们得先扩 `[keys]` 的 chord 支持（那时整族迁到真 chord）。⌘L 可发现性更高但不是 Emacs 键；真 chord 与既有裁决（M195）正面冲突，且要动 Rust 侧配置层与键位面板——是另一个 change |
| D2 | 交互形态 | **小浮层输入条**，挂 modeline 之上、向上展开 | modeline 内联输入（把左段临时换成输入框） | 推荐项：浮层族（⌘F 搜索面板、⌘⇧O 大纲、⌘O 切换器、⌘/ 键位面板）在本应用就是「minibuffer 的替代形态」，挂点与 `.lumir-toc` 完全同款；且它紧贴 modeline 上沿，**位置语义就是 Emacs 的 echo area**，只是不占常驻布局。备选更 Emacs（真的在底栏里读输入），代价是把 modeline 从「只读派生、零新状态」（`src/style.css:508-511`、`src/main.ts:994-1007` 的口径）改成有一个瞬态输入态，还要与右段的窄窗退让（`src/modeline.ts`）互动——一个一次性输入条不值得动一个常驻布局组件 |
| D3 | 输入与越界口径 | **预填当前行号 + 数字按 `[1, 总行数]` 钳制**（越界静默停在文档边界；空输入 = 当前行） | 越界拒绝：保留输入条 + 提示「超出文档行数」要求改正 | 推荐项用一条规则覆盖全部输入面，与 Emacs 的到头即停同源，零新文案；且预填值本身就把「我现在第几行」答了。备选更防错，代价是多一条提示文案与一个阻塞态——而钳制后的落点用户一眼可见（文档边界） |
| D4 | 行号可见面 | **2026-09-27 节点 1 改判：md 模式也装行号 gutter**（与只读 code 同一个 `lineNumbers()`；正文列仍居中、gutter 贴正文列左缘）+ 输入条内仍显示当前行号与 `共 M 行`——**2026-09-28 二次改判把「常显」收成可配置三档**（见下节，本行的形态以二次改判为准） | (i) 只在跳转输入条在场时显示 gutter（起草期的 D4 推荐项——**二次改判后成为默认档 `on-demand`**）；(ii) 同批给 modeline 右段加常驻光标行号段（Emacs `line-number-mode` 的对应物） | 落槌形态出自 Alex 的原话要求：md 文档不应该是豁免行号 gutter。备选 (ii) 不作为本 change 的形态——gutter 在场时「我在第几行」在视口内已有答案（当前行号另有高亮），再加一段常驻段是重复面，且要动 modeline 的「只读派生、零新状态」口径与右段窄窗退让（`src/modeline.ts`）。代价如实记账：md 阅读视图的行号面（`always` 档下含 md 编辑区的整页基线整批重拍 + 人肉过目）、块级替换覆盖的源行缺号（见「边界与已知限制」第 2 条）、开关的实现代价（gutter 走 CM 的 compartment 重配，且开关瞬间正文列 MUST NOT 跳动） |

## Alex 节点 1 二次改判（2026-09-28）：D4 再改为可配置三档

原话：**「显示行号是可配置的，markdown 默认不显示、go-to-line 时出现、完成后隐藏。代码默认显示」「三档可以。确认走这条路（现在 amend 提案、M281 直接转向）」**

落定形态（`[ui]` 表的新键 `markdown_line_numbers`，只管 md；code 模式恒常显、不进配置）：

| 取值 | 行为 | 是 |
|---|---|---|
| `"on-demand"` | **默认**：md 文档打开时无行号 gutter；按 `⌥G` 打开跳转输入条时 gutter 出现；输入条收起（Enter / Escape / `⌃G` / `focusout` / 会话切换）后重新隐藏 | 默认档（Alex 原话「markdown 默认不显示、go-to-line 时出现、完成后隐藏」） |
| `"always"` | md 文档常驻显示行号 gutter（2026-09-27 裁决的形态） | 给「我经常要看行号」的用户（Alex 原话「我有时候需要查看 line number」） |
| `"off"` | md 文档恒不显示行号 gutter（输入条打开时也不显示） | 完全退出 md 的行号面 |

- 三档的**默认值是 `on-demand`**，因为它是 Alex 2026-09-28 指定的默认（原话「markdown 默认不显示」）；`always` 保留了 2026-09-27 那次改判的意图，只是不再强加给所有人。
- **配置链路照 `[ui] theme` 的先例**（同一 `[ui]` 表、Rust 侧闭集合校验 + 缺字段回落默认 + 非法取值 warning 回落，见 [design.md](design.md) §5.1）：取值校验在 Rust 侧完成，前端拿到的必是三档之一；**装载时读一次、重启生效**（与 `editor.mode` / `editor.font_size` 同路：运行期 MUST NOT 回写——本 change 不提供切换它的命令 / 键位 / UI，理由见 [design.md](design.md) §5.1）。
- **实施顺序**（Alex 原话「现在 amend 提案、M281 直接转向」）：先按本节 amend 提案四件套，再在同一 mission 里改实现；已批准的 22 张常显基线重拍随之作废（md 默认无 gutter ⇒ 既有基线继续有效），重拍轮由 tower 叫停。

## Non-goals

- **不做 `M-g` 家族的其它成员**：`M-g c`（按字符位置跳）与 `M-g TAB`（按列）不在本 change，输入面只有行号一种语法。
- **不为 `M-g g` 打开 `[keys]` 的 chord 支持**：要动的东西跨 capability（Rust 侧 `validate_keys` 的形态校验、键位面板对 chord 的渲染、配置文档），是 D1 备选 (b) 的前置，另立 change。
- **不做行号历史**：Emacs 的 `goto-line-history` / `goto-line-history-local`（跨 buffer 共享或每 buffer 独立）不实现。
- **不做跳转前的 mark 压栈与回跳**：Emacs 的 `goto-line` 会 `push-mark`（`C-x C-x` 可回跳）；Lumir v0 没有 mark ring（扩选只有 anchor/head 两端），不为此新建一套。
- **不做 md gutter 的开关 UI**：三档由 `[ui] markdown_line_numbers` 配置（2026-09-28 二次改判），但**没有**命令、键位或界面控件能切换它，也不做运行期切换——改配置后**重启生效**（Emacs 的 `display-line-numbers` 可随时 toggle，本 change 只有装载时读一次的静态档位；做运行期切换要连带动 `[ui]` 回写通道与一个 UI 落点，不在本次请求里）。**不做 modeline 常驻行号段**（D4 的另一备选）。
- **Rust 侧的改动只限配置面的读取与校验**：`src-tauri/**` 的唯一增量是 `[ui] markdown_line_numbers` 的解析 / 闭集合校验 / 回落（照 `ui.theme` 先例）与其单测；**不新增 IPC 通道、不新增命令**（配置经既有 `config_get` 快照下发，与 `ui.theme` / `ui.content_width` 同一条路）。
- **不改文档、不改源文件字节**：不插入行号、不做任何写盘；跳转只改选区与滚动（ADR 0003 §3）。
- **不做「跳转历史 / 最近位置」侧栏**：不在本 change 的形态范围内。

## Impact

- **影响的 specs**：`keymap-commands`（ADDED ×1：「跳转到指定行命令（`editor.goto-line`）」，**11 条 scenario**——8 条命令与输入面、1 条键位面板、1 条「md 模式的行号 gutter（三档）」、1 条 `[ui] markdown_line_numbers` 配置档位）。**不新建 capability**——键位分发、编辑器命令的硬化口径（`编辑器光标命令的硬化底座`）与「`[keys]` 覆盖」都是 keymap-commands 的既有 requirement，本 change 只在同一 capability 内加一条命令族要求；md 的行号 gutter 记在同一条 requirement 的可见面子句里（归属缺口见 [design.md](design.md) §8 第 8 条）。`ui-design-system` **零增量**（modeline 不动）；`content-width` **零增量**，但 md「正文列居中」的守恒条款受本 change 约束（开关 gutter 瞬间也必须守恒，[design.md](design.md) §5.2 第 1 条）。
- **影响的代码/系统**（实现期；本 mission 零产品代码改动）：`src/keys.ts`（命令 id + 一条绑定）、`src/editor.ts`（commands 记录 + 注入输入条 opener，复用既有 `revealLine`；md 的 gutter 走**独立的 Compartment**，默认不装、输入条在场时装、收起时卸）、`src/goto-line.ts`（**新增**：纯逻辑 + 浮层 DOM 适配）、`src/main.ts`（装配：浮层挂 `shell.modeline`；装载时把 `ui.markdown_line_numbers` 喂给编辑器；输入条开 / 关转成 gutter 的装 / 卸）、`src/style.css`（输入条样式，复用 tokens）、`src/preview/theme.ts`（md gutter 的 grid 落点与配色，与 doc-title / end marker 的 grid 真源同居）、`src-tauri/src/config.rs`（`[ui] markdown_line_numbers` 的枚举 + 校验 + 回落 + 单测；**本 change `src-tauri/**` 的唯一改动面**）、`src/bindings/**`（ts-rs 重导出）、`docs/specs/config-reference.md`（新键条目）、`文案-Copy.md`（D152 起的输入条文案）。
- **影响的测试/验收**：`tests/unit/goto-line.test.ts`（新增，纯逻辑层）、`tests/unit/keys.test.ts`（表的不变量对账自动纳入新绑定；逐条口径不变）、`tests/visual/scenes/`（新增输入条场景；md 行号 gutter 的**三档在场时机** + 结构 + 实测几何断言，含「开关瞬间正文列不跳动」的宽窗 / 640px 两档几何判据；含 md 编辑区的整页基线逐张核对——`on-demand` 默认档下既有基线**应当逐张不变**，`markdown-parser.spec.ts` 的「md 无行号」断言按新默认重核（`always` 档下才翻转）、`end-marker.spec.ts` 以 `.cm-lineNumbers` 当模式判据的辅助函数重核、`m130-text-open-trap.spec.ts` 的口径注释；键位面板因多一行而变化的相关场景逐张核对）、`src-tauri/src/config.rs` 的单测（新键的三档 + 非法取值 + 类型不符三条）、`scripts/acceptance/scenarios/56-goto-line.md`（新增，编号声明见 tasks.md §6）。
- **关联约束**：ADR 0003 §3（跳转零文档改动）、ADR 0002 §6（性能合同——跳到远处的行要量一次可见延迟并把读数落档，见 design §7）、ADR 0001 §4（chorded + 非 modal 不变）、ADR 0006（Emacs keybinding 定位）、ADR 0004 第 5 条（功能变更走 OpenSpec）、ADR 0002 第 5 条（配置即数据——`[ui] markdown_line_numbers` 是**配置项**而不是状态：装载时读一次、前端不持有它的写回路径；键位仍复用既有 `[keys]`）、`docs/design-parity-contract/README.md`（该契约已随 ADR 0006 失效：其中「阅读 gutter 去除」不构成约束，「正文居中」保留——见 [design.md](design.md) §1.4）。

## 边界与已知限制

1. **焦点不在编辑器内容区时 ⌥G 不命中**：`editor` 作用域的既有边界，与 ⌃N / ⌃P / ⌥V 一族完全相同（焦点在文件树、搜索输入框、浮层里时先点回正文）。不做成 `global`：本命令改的是编辑器文档的光标位置，取 global 会让「命令 id 前缀 = 作用域」的机械派生出现例外（`view.` 前缀才是应用运行期显示口径一族）。
2. **md 的 gutter 有缺号区**：被块级替换覆盖的源行不显示行号——frontmatter 区块恒缺（它始终是一个块级 replace widget），块级数学 / mermaid 在块回退为源码时会补上（机制见 [design.md](design.md) §1.4 第 2 条）。这是 CM 的 gutter 对 widget 行块的默认行为，本 change 不为它新增 `lineNumberWidgetMarker` 提供者。
3. **单段化 `⌥G` 与 Emacs 的 `M-g` 前缀语义有落差**：Emacs 里单独按 `M-g` 什么都不发生（前缀等待下一段）；本 change 让它直接开输入条。这是知情接受的偏差，换来默认键位可重绑（D1）。
4. **无行号历史、无 mark 回跳**（见 Non-goals）：重复跳转不从历史里取上一个值。
5. **越界静默钳制**（D3 推荐项）：输入远大于总行数的值会停在最后一行且不报错——用户可能误以为「文档还有那么长」。缓解是输入条同时显示 `共 M 行`；若 Alex 要更强的防错，D3 取备选。
6. **`on-demand` 档的 gutter 是瞬态可见面**：md 打开时正文列左缘没有行号；按 `⌥G` 打开输入条时行号列出现、收起后消失（开关 MUST NOT 让正文列跳动，判据见 [design.md](design.md) §5.2 第 1 条）。`always` 档下才是「正文列左缘多一列常驻行号」的阅读视图变化——要那种形态把配置改成 `always`；整页视觉基线在 `always` 档下要重拍并请 Alex 过目（MUST NOT 静默 `--update`）。**三档都不提供运行期切换 / 命令 / 键位 / UI**（[design.md](design.md) §5.1）。
