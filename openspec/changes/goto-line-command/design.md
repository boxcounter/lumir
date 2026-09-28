# Design: goto-line-command

## 1. 现状锚点（全部 file:line，2026-09-27 在 `feat/proposal-goto-line-command-m261` 基线上核对；§1.4 的 md 行号面锚点在节点 1 改判后于 `feat/amend-goto-line-proposal-md-gutter-m271` 上重核）

### 1.1 落点原语已经存在，本 change 只接一个命令

- `EditorSession.revealLine(line: number)`（`src/editor.ts:1037` 的接口、`:2019` 的实现）：`Math.max(1, Math.min(line, view.state.doc.lines))` 钳制 → `doc.line(n).from` 取行首 → `dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) })`。**1-based 源文档行 + 行首落点 + 居中**三件事它都做了，正是 goto-line 的语义。
- 既有消费者一处：`src/link-follow.ts:158`（wikilink 锚点跳转）。本 change 是它第二个消费者——MUST NOT 另写一套「行号 → 位置 → 滚动」的算式（REVIEW.md 第 8 条：同一语义两处真源即漂移）。
- 居中的既有口径：`recenter`（`src/editor.ts:779`）与 `revealLine` 同用 `y: "center"`；`⌃L` 的绑定 doc（`src/keys.ts:385`）把这条口径写进了表。Emacs 的 `goto-line` 只做最小滚动（不居中），本仓取居中——与 wikilink 锚点跳转、`⌃L` 一致，**是知情接受的偏差**（跳转后目标行在视口中央比「在可能贴边的最小滚动位」更可读）。
- 光标位置：`revealLine` 用 `{ anchor: pos }` 折叠选区，不产生选区；`⌃G`（keyboard-quit）之外的取消路径都不碰选区。

### 1.2 键位统一层与「浮层就地键」的既有机制

- 唯一分发表在 `src/keys.ts:357` 的 `KEY_BINDINGS`；命令清单 `COMMAND_IDS`（`:262`）由内核组 + 全局组拼出；作用域由命令归属派生（`applyKeyOverrides` 的说明，`src/keys.ts:629` 起：编辑器组 → `editor`，其余 → `global`，配置 MUST NOT 指定作用域）。
- 分发器的三条与本 change 相关的判定（`src/keys.ts` 的 `Keymap.handle`）：
  - **打字键守卫**（`:743`）：事件目标是可编辑宿主（`isEditableHost`，`:521`，INPUT / TEXTAREA / contenteditable）且是「打字键」时直接让路。`isTypingKey`（`:528-535`）要求 `!event.altKey`，**⌥G 因此不算打字键**，守卫不拦它。
  - **作用域判定**（`:762`）：`binding.scope === "editor" && !ctx.isEditorEvent(event)` → 不消费、不 preventDefault。输入条持有焦点时事件目标是浮层里的 input（不在 contentDOM 内），故 `⌥G` 在这条上让路。
  - 两条合起来的结论：**输入条打开期间 `⌥G` 会落到原生路径**（macOS 的 Alt 层会往输入框里打 `©`）。这与 M180 注释里点名的「容器级的就地键挂点（走 DOM 冒泡与各自的 keydown 处理器）」是同一种处境——**输入条必须就地消费 `⌥G`**，否则「再按一次同键」会把 `©` 打进行号框（数字过滤器会挡掉字符，但仍是可见的错误行为）。delta 里「打开期间再按同键就地消费为无操作」这一句就是为它写的。
  - 同理，Enter / Escape / `⌃G` 也由输入条就地消费：Escape 在表内已被 `editor.widget-escape` 占用（带 `when: isWidgetKeyTarget` 条件），表内一个 token 只能有一条绑定，这是搜索面板 / 大纲浮层 / vault 切换器 / 键位面板四处反复记录过的同一理由。
- `[keys]` 覆盖：`applyKeyOverrides`（`src/keys.ts:629`）单键重绑 / 解绑，作用域随命令归属派生；Rust 侧 `validate_keys`（`src-tauri/src/config.rs:546`）只校验形状——空或含空白（`多段 chord 暂不支持`，`:561`）一律 warning + 忽略。`Alt-KeyG` 形态合法 → 默认键位可重绑、可解绑（D1 推荐项的前提）。

### 1.3 浮层基座与挂点

- 大纲浮层是最好的形态先例：`src/toc.ts:301` 建 `.lumir-toc`、`:333` 由装配层把它 append 到 `options.mount`（`src/main.ts` 传的是 `shell.modeline`）、`:347` 在浮层上挂 `keydown` 就地消费（↑↓ / ⌃N⌃P / Enter / Esc）、`:363` 在 `focusout` 时收起（焦点跑到浮层之外才关）、`:565` 写 `left` 做水平夹取。
- 定位口径：`.lumir-toc { position: absolute; bottom: 100%; … }`（`src/style.css:1349`），因为 `.modeline` 是 `position: relative`（`src/style.css:512`）——浮层**紧贴 modeline 上沿向上展开**。这正是 Emacs echo area（底栏上一行）在「不占常驻布局」约束下的对应位置（D2 推荐项的形态）。
- 样式 tokens 复用：`--preview-bg` / `--border` / `--r10` / `--shadow-raise`（`.lumir-toc` 与 `.vault-pop` 同款），零新色值。
- 输入框先例：`.lumir-toc-input`（`src/style.css:1386`）；输入筛选的文案常量复用风格见 `src/list-filter.ts`（同一动作在两处说两种话正是文案 deck 要防的漂移）。

### 1.4 行号的可见面现状（2026-09-27 节点 1 改判 + 2026-09-28 二次改判后重核）

- code 模式：`lineNumbers()`（`src/editor.ts:3` 的导入、`:1437` 的三元分支的 else 支）在只读 code 的模式扩展里，gutter 显示行号（**恒常显、不进配置**）。
- md 模式（`:1436` 的 then 支）：今天只装 live preview 与 `endMarker`，**无行号**。本 change 把它补上——在场时机由 `[ui] markdown_line_numbers` 三档决定（默认 `on-demand`：只随跳转输入条出现），形态口径见 §5。
- md 无行号是历史形态，不构成约束：M62「原型—生产一致性」期把阅读 gutter 与 activeLine 一并去掉（`docs/design-parity-contract/README.md:18`、`:23`），该契约已随 ADR 0006 失效（同文件 `:3`，2026-09-12）。同一批改动里「**正文列居中**」至今生效（`src/editor.ts:1383-1390` 的 md 模板 = 中列定值 `--layout-doc-measure` + 两侧 `minmax(24px, 1fr)` 等分；content-width spec 从反面把 code 模式写作「列不居中」）——本 change **只动行号面，MUST NOT 连带改掉正文居中**，且装 / 卸那一瞬也不许改动它的几何（§5.2 第 1 条）。
- **装上 md gutter 后的三处交互面**（实现期逐条核，条目已落 tasks 2.9–2.14；`on-demand` 默认档下这几条只在**输入条打开期间**成立）：
  1. **网格落点**：`.cm-gutters` 的 base 规则是 col1 / row1（`src/editor.ts:1399-1404`），而 md 在有 doc-title 落点时 `.cm-content` 被移到 `gridRow: 2`（`src/preview/theme.ts:368-379`）⇒ md 的 gutter 必须与正文**同行**，否则行号整体上移一个标题节点的高度。
  2. **块级替换覆盖的源行没有行号**：md 的块级 replace——frontmatter（`src/preview/livePreview.ts:492-500`）、块级数学（`src/preview/math.ts:365-367`）、mermaid（`src/preview/mermaid.ts:400-402`）——把跨行范围折成一个 widget 行块；CM 的 lineNumbers 对 widget 行块**只在 `lineNumberWidgetMarker` facet 有提供者时**才产出 gutter 元素，本仓无提供者（`@codemirror/view@6.43.11` 的 `widgetMarker` 返回 null、`UpdateContext.widget` 因此不 addElement）⇒ 这些源行**缺号**。块级数学 / mermaid 的装饰在选区与块范围相交时撤销（`src/preview/math.ts:359`、`src/preview/mermaid.ts:395`）——落到块**内部**的行会让该块回退为源码、行号随之出现；frontmatter 是**始终替换**的块（选中时改由 widget 内显示原文，仍是同一个 widget），其覆盖区间的行号恒缺。
  3. **横向滚动余量**：`getScrollMargins(view).left` 由 gutter 插件提供（`@codemirror/view` 的 gutter 插件在 fixed 时给出 `{left: gutterWidth}`；本仓两处注释留痕：`src/editor.ts:2083`、`src/scroll-position.ts:42`，后者记着 code 模式实测 34px）⇒ md 在 gutter **在场**时（`always` 档，或 `on-demand` 档下输入条打开期间）该值从 0 变为行号列宽，凡依赖横向 `scrollLeft` 恢复的路径与相关视觉场景要按「在场 / 不在场」两态核对。
- md 的行块高度**不均匀**（标题、图片、表格、callout、公式 widget 各有高度），而行号锚在行块顶部（CM 的 gutter 元素高度 = 行块高度）⇒「行号纵向对准其行」在 md 是 code 模式没有的压力面（code 行高恒定），MUST 用几何断言钉住（§5.2 第 2 条）。
- modeline 右段：`src/main.ts:1008` 的 `syncModelineMeta` 拼 `` `${language} · ${lines} 行 · UTF-8` ``，`lines = view.state.doc.lines`（**总行数**，不是光标行号）。口径注释在 `src/main.ts:994-1007` 与 `src/style.css:508-511`：「只读派生、零新状态」——D2 备选（modeline 内联输入）与 D4 的另一备选（modeline 常驻光标行号段）都要动这条口径，故都不取。

## 2. 键位（裁决点 D1）

### 2.1 候选与推荐

| 候选 | 形态 | 可经 `[keys]` 重绑 | 与 M132 键位集的一致性 | 冲突 |
|---|---|---|---|---|
| **`⌥G`（推荐）** | 单段，token `Alt-KeyG` | 是 | 高：`Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF` 已是同族 | 零（见 2.2） |
| `⌘L`（备选 a） | 单段 `Cmd-l` | 是 | 低：⌘ 系归 mac 惯例，是「跳到行」的 Xcode 惯例，但不是 Emacs 键 | 零（同一套三来源核对需要重做一遍） |
| `M-g g`（备选 b） | 两段 chord | **否**（`validate_keys` 拒绝含空白） | 最高（与 Emacs 逐字一致） | 零，但需要先扩配置层与键位面板 |

推荐 `⌥G` 的理由：它同时满足「Emacs 肌肉记忆的第一段」（Emacs 里 `M-g` 是前缀，用户按下的第一个组合就是 ⌥G）与「单段可重绑」（M195 对 `C-x C-=` 的既有裁决：把默认键位押在 chord 上等于让用户改不了键）。

代价如实记账（写进 proposal 的「边界与已知限制」）：单段化之后，Emacs 的 `M-g c` / `M-g TAB` 将来没有安放处——要接它们就得先把 `[keys]` 的 chord 支持打开（Rust 侧形态校验 + 面板渲染 + 配置文档），那时可把整族迁到真 chord。这是**有意的两步走**，不是遗漏。

### 2.2 冲突核对（三条独立来源，逐条可复核）

- **表内**：`src/keys.ts` 现表无 `Alt-KeyG`（实测 grep 零命中；同族的 `Alt-KeyV` `:384` / `Alt-KeyD` `:391` / `Alt-KeyF` `:406` / `Alt-KeyB` `:407` 是不同 token）。
- **原生菜单 accelerator**：tauri 的 `Menu::default()` 逐项来自 muda `items/predefined.rs` 的 `accelerator()`，清单在 `src/keys.ts` 文件头逐条留痕（Copy ⌘C / Cut ⌘X / Paste ⌘V / Undo ⌘Z / Redo ⇧⌘Z / SelectAll ⌘A / Minimize ⌘M / Fullscreen ⌃⌘F / Hide ⌘H / HideOthers ⌥⌘H / CloseWindow ⌘W / Quit ⌘Q）；本应用自建项里唯一带 accelerator 的是 `CmdOrCtrl+Q`（`src-tauri/src/lib.rs:305`）。**唯一的 ⌥ 系预置是 ⌥⌘H**，⌥G 不在其中；菜单键等价只截获带 accelerator 的项（M149 对 ⌘W 的实证），故 ⌥G 会到达 webview 的 keydown。
- **系统级**：macOS 不给系统菜单预置 ⌥G（Option 系的系统快捷键都是 ⌥⌘ 组合，如 ⌥⌘Esc 强制退出、⌥⌘D 隐藏 Dock）。真正会「抢」⌥G 的是文本输入系统的特殊字符层（US 布局上 ⌥G 打出 `©`）——它在我们自己的分发器**下游**，命中绑定时 `preventDefault` 即挡住；同族先例是 `Alt-KeyV`（`√`）与 `Alt-KeyD`（`∂`），已在真机上跑过（`scripts/acceptance/scenarios/26-svg-scroll-stability.md:47` 的 `alt+v` 注入）。

### 2.3 token 形态（静默失配的最大风险）

含 Alt 的组合按**物理键**（`KeyboardEvent.code`）判定：macOS 的 Alt 层替换字符（⌥G 的 `event.key === "©"`），`e.key` 判不出用户按的键。表内因此 MUST 写 `Alt-KeyG`（与 `Alt-KeyV` / `Alt-KeyD` 的写法同源），MUST NOT 写 `Alt-g` 或任何基于字符的形态——写错不报错、只是永远不命中（M131 文件头的 token 口径、M195 段的同类警示）。

## 3. 交互形态（裁决点 D2）

### 3.1 两个候选的具体形态

- **A（推荐）小浮层输入条**：`position: absolute; bottom: 100%`，挂在 `shell.modeline` 上（与 `.lumir-toc` 同挂点同定位），宽度定值（约 200px 量级，比大纲浮层的 300px 窄——它只有一行动态内容），内含一行：`[输入框（预填当前行号、全选）] 共 M 行`。打开时取焦点（`input.focus()` + `select()`），关闭时把焦点交还编辑器（`view.focus()`）。Esc / `⌃G` / Enter / `⌥G` 就地消费；`focusout` 到浮层外即收起。
- **B modeline 内联输入**：把 modeline 左段（`.modeline-path` / `.modeline-section`）临时换成一个输入框，输入确认后恢复。

### 3.2 为什么推荐 A

1. **本应用已有「浮层即 minibuffer」的既有形态**：⌘F 搜索面板、⌘⇧O 大纲浮层、⌘O vault 切换器、⌘/ 键位面板——用户已经学会「命令会在底栏附近开一个小层」。
2. **位置语义仍是 Emacs 的 echo area**：浮层贴着 modeline 上沿向上展开（`.lumir-toc` 的既有定位），视觉上就在底栏那一行的上方，只是不占常驻布局——两全。
3. **不动一个「零状态」的常驻组件**：modeline 的口径是「信息全部只读派生、零新状态」（`src/main.ts:994-1007`），左段有大纲指示段（`src/toc.ts` 独占写入）、右段有窄窗退让（`src/modeline.ts` 的 `identityView`，`<640px` 时版本号退入）。内联输入要在里面加一个瞬态输入态并与退让逻辑互动，而收益只是「位置更像 Emacs 一点」。
4. **基座几乎免费**：定位、`focusout` 收起、就地键消费、样式 tokens 都能照 `.lumir-toc` 抄一遍（不是复用同一个 DOM 组件——它是大纲专用的列表浮层；复用它的**形态与口径**）。

### 3.3 取 B 时的改写面（备选）

- delta：把「小浮层输入条」改写为「modeline 左段内联输入条」，并把「输入条自己的键不进 `KEY_BINDINGS`」的理由换成「输入框在 modeline 里，作用域判定同上」。
- 新增 ui-design-system 的 MODIFIED requirement（modeline 的「只读派生、零新状态」口径要为这个瞬态态开口子）。
- tasks：新增一条「modeline 内联态的布局与退让互动」实现任务；视觉场景要覆盖窄窗（`<640px`）下的退让不被打断；整页基线涉及 modeline 的都要重拍。

## 4. 语义口径（裁决点 D3）

| 项 | 口径 | 依据 |
|---|---|---|
| 计数单位 | 源文档逻辑行（`doc.lines` 口径，硬换行分隔，1 基） | 与 md / code 两个模式的 gutter 行号同源（md 的 gutter 见 §5）；软换行不计，与 Emacs「logical line」一致（`M-g g` 计数的是 buffer line） |
| 落点 | 该行行首（`doc.line(n).from`）+ 光标折叠、无选区 | `revealLine` 既有行为 |
| 滚动 | 目标行居中（`y: "center"`） | 与 `⌃L` / wikilink 锚点跳转同口径；Emacs 只做最小滚动，本仓取居中（知情偏差） |
| 越界 | 钳制到 `[1, 总行数]`，不报错 | Emacs `(forward-line (1- line))` 到头即停（[emacs-mirror/emacs, lisp/simple.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/simple.el) 的 `goto-line`）；零新文案 |
| 空输入 | 按预填值（当前行号）解释 | Emacs 的 `RET` 用默认值同款（`goto-line-read-args` 的 `read-number` 第二默认是 `line-number-at-pos`） |
| 不采纳的 Emacs 默认 | 「光标处或紧随其后的数字」优先作默认值 | 收益小、判定面要自造（数字两侧的边界），v0 只给当前行号 |
| 取消 | Esc / `⌃G` / `focusout` / 会话切换 → 收起且不跳转 | 会话切换不跳转是本仓多标签语义的必要补充（Emacs 单 buffer 无此情形） |
| 焦点 | 跳转后交还编辑器；取消后交还编辑器 | 与 `editor.widget-escape` 的 `view.focus()` 同款 |
| 文档 | 零改动、不进撤销栈、不改 dirty、不写盘 | ADR 0003 §3；`revealLine` 只 dispatch 选区与滚动 effect |
| 输入字符 | 只接受数字字符 | 把「非法输入」这一整类从解析面消掉，只剩空串一种情形 |

## 5. md 模式的行号 gutter（裁决点 D4，2026-09-27 节点 1 改判 + 2026-09-28 二次改判）

### 5.1 两次改判与三档口径（含配置链路）

Alex 原话（2026-09-27，第一次改判）：「**采纳建议。但有一个我希望改动：md 文档不应该是豁免 line number gutter——我有时候需要查看 line number。**」

Alex 原话（2026-09-28，二次改判）：「**显示行号是可配置的，markdown 默认不显示、go-to-line 时出现、完成后隐藏。代码默认显示**」「**三档可以。确认走这条路（现在 amend 提案、M281 直接转向）**」

- **形态取可配置三档**：`[ui] markdown_line_numbers` 只管 md，取 `"on-demand"`（默认）/ `"always"` / `"off"` 之一；行号仍是 CM 行块 → 源文档逻辑行号（1 基），与 `doc.lines` 同口径、与 §4 的落点口径一致。三档共用同一套 `lineNumbers()` + `highlightActiveLineGutter()`（**不**装 `highlightActiveLine`——只给行号加底，正文行的整行底色不在本 change 内，理由同第一次改判）。差别只在**在场时机**：

  | 取值 | md 的 gutter 在场时机 | 来源 |
  |---|---|---|
  | `"on-demand"`（**默认**） | md 文档打开时**不在场**；跳转输入条打开（`⌥G` / 重绑键）时**装入**；输入条收起（Enter / Escape / `⌃G` / `focusout` 到浮层之外 / 前台会话切换）时**卸除** | Alex 二次改判原话「markdown 默认不显示、go-to-line 时出现、完成后隐藏」 |
  | `"always"` | 常驻在场，与任何命令无关（2026-09-27 第一次改判的形态） | 给「我经常要看行号」的用法（原话「我有时候需要查看 line number」） |
  | `"off"` | 恒不在场（输入条打开时也不在场） | 完全退出 md 的行号面 |

- **`always` 档下** `on-demand` 的瞬态口径不适用：gutter 常驻，输入条的开 / 关**不**触发装 / 卸（`mdGutterExtensions()` 的返回值与输入条状态无关）。`off` 档同理（恒空）。
- **code 模式不进配置**：只读 code 的 gutter 恒常显（Alex 原话「代码默认显示」），既有形态逐值不变——它不参与 compartment 的重配，也不读这个键。
- **配置链路照 `[ui] theme` 的先例**（`docs/specs/config-reference.md` §1.3、`src-tauri/src/config.rs` 的 `RawUiConfig` → `validate()` 模板）：新键加进 `UiConfig` 与 `RawUiConfig`，取值校验在 **Rust 侧**用闭集合枚举完成（`"light"` / `"dark"` / `"eink"` 的同款写法），缺字段 → 回落默认 `on-demand` 且**不**告警，取值不在三档内 → 回落默认 + 一条人话 warning；类型不符（`"markdown_line_numbers": 2`）与 `ui.theme` 同路，在 serde 解析期失败 → 整文件回落。前端拿到的必是三档之一（`src/bindings/MarkdownLineNumbers.ts`，ts-rs 导出），不再判非法。
- **装载时读一次、重启生效**（取成本简单者，理由写明）：在 `src/main.ts` 的装载路径里读 `snapshot.config.ui.markdown_line_numbers` 一次并喂给编辑器（`editor.setMarkdownLineNumbers`），与 `editor.mode` / `editor.font_size` 同路——**运行期 MUST NOT 回写**。不取 live 切换的理由：`[ui] theme` 之所以 live，是因为它**有**一个运行期落点（modeline 主题钮 / `⌘⇧T`）与回写通道（`config_set_ui_value`）；本 change 不提供任何切换这个键的命令 / 键位 / UI（Non-goals），因此没有 live 的触发源——为它铺一条回写通道等于为无入口的开关注册持久化面，收益为零而多一处状态。要 live 得先有 UI 落点，那是另一个改动。
- **不取「跳转输入条在场时才显示」作为唯一形态**（第一次改判时被否的 (i)）：它现在正是 `on-demand` 档，但**只是三档之一**、不再是唯一形态；`always` 保留了「打开文档即可见」的能力，因此第一次改判的意图没有丢，只是不再强加给所有人。
- **与 Emacs 的对应关系（别把两个面混成一个）**：Emacs 的行号可见面有两个——mode line 上的当前行号（`line-number-mode`，`(define-minor-mode line-number-mode … :init-value t)` 默认开，[lisp/simple.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/simple.el)）与 buffer 内的行号 gutter（`display-line-numbers`，**默认 Off**、`M-x display-line-numbers-mode` 可随时开关，[lisp/display-line-numbers.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/display-line-numbers.el) 文件头 + [lisp/cus-start.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/cus-start.el) 的 `(const :tag "Off" :value nil)`）。本 change 的 `on-demand` 默认档与 Emacs「默认 Off、按需出现」的形状同向，但**开关是可配置的静态档位、不是可随时 toggle 的运行期命令**（本 change 不提供命令 / 键位 / UI，见 Non-goals）。
- **modeline 常驻光标行号段仍不做**（D4 的另一备选）：`always` 档下「我在第几行」在视口内已有答案（当前行号另有高亮），再加一段常驻段是重复面，且要动 modeline 的「只读派生、零新状态」口径与窄窗退让（`src/modeline.ts` 的 `identityView`）。

### 5.2 呈现与几何口径（实现期必须钉住的五条）

1. **正文列仍居中 + 开关瞬间不跳动**（守恒条款）：md 的 scroller 模板与其两侧等分轨道不为 gutter 改写（`src/editor.ts:1383-1390`）；gutter 落在**左侧空余轨道**内并贴正文列左缘，md 侧 MUST NOT 取 code 模式的模板（那条模板让正文列不居中）。窄窗下左轨道的下界要容下行号自然宽，**MUST NOT 让行号被裁**。**`on-demand` 档下装 / 卸 gutter 的那一瞬，正文列几何 MUST NOT 变化**（判据是实测 rect：同一文档在 gutter 不在场与在场两态下 `.cm-content` 的 left / right / width 逐值相同，容差按视觉门禁口径），宽窗（1200px）与窄窗（640px）两档都要成立——这是「瞬态可见面」不会变成「跳一下就重排」的硬判据。两条同时成立时的精确取值由几何断言裁定（实测 rect，不用 CSS 声明值），并随整页基线走 Alex 过目（`always` 档）。
2. **行号纵向对准其行**：md 的行块高度不均匀（标题 / 图片 / 表格 / callout / 公式 widget），MUST 用几何断言核「行号元素的顶 = 该行内容盒的顶」（容差按视觉门禁口径），覆盖标题行、图片行、表格 widget 行三类。
3. **配色与分隔**：gutter 的取色沿用 code 模式的既有 tokens（`src/editor.ts:1399-1404`：`--text-3` 文字色、`--frame` 底、`--border` 右缘）。md 侧**只留提示档文字色，去掉 `--frame` 底与右缘分隔线**（理由：阅读视图是「正文居中、无框体面」的观感，多一块底色与一条竖线会把行号读成 UI 边框而不是辅助信息）。这是观感裁决点，改动随整页基线请 Alex 过目，MUST NOT 静默 `--update`。
4. **规则归属**：md 的 gutter grid / 配色规则 SHALL 与 md 的其它 grid 真源同居（`src/preview/theme.ts:368-379` 的 doc-title 行、`:523-546` 的 end marker 列），MUST NOT 让 `src/editor.ts:1399` 的 base 规则在有 doc-title 落点时把行号整体上移一个标题高度（§1.4 第 1 条）；哪一条是 md 的真源要在实现处写明（REVIEW.md 第 8 条：同一语义两处真源即漂移）。

### 5.3 实现方案：gutter 走独立的 Compartment

`on-demand` 要求 gutter 能在运行期装 / 卸，而**不能**顺带重建 live preview。落点因此从 `modeExtensions`（装载进 `modeCompartment`，重配会整批重建装饰层与语法树的装配）里抽出来，单独放一个 `mdGutterCompartment = new Compartment()`：

- **`sessionState` 的 md 分支**：`modeCompartment.of(modeExtensions(mode, path, editable))` 里，md 那一支把 gutter 写成 `mdGutterCompartment.of(mdGutterExtensions())`；code 分支照旧**直接**装 `[lineNumbers(), highlightActiveLineGutter()]`（不进 compartment——它不参与开关，形态逐值不变）。
- **`mdGutterExtensions()` 是唯一的在场判据**：`off` → `[]`；`always` → `[lineNumbers(), highlightActiveLineGutter()]`；`on-demand` → 由「跳转输入条是否打开」这个**编辑器内的瞬态标志**决定装或空。任何别处 MUST NOT 自行判断在场（REVIEW.md 第 8 条）。
- **装 / 卸的唯一写入路径**是 `reconfigureMdGutter()`（照既有 `reconfigureWrap()` 的分流：前台会话走一次 `view.dispatch`，后台会话只换代 state 不碰 view）——因此「切标签后切回来」不会残留上一轮装上的 gutter。
- **compartment 的实例只出现一次**（只在 md 分支里）：CM 的 `Configuration.resolve` 对同一 compartment 出现两次直接抛 `Duplicate use of compartment in extensions`（`@codemirror/state` 的 `flatten`），所以 `mdGutterExtensions()` 返回的数组 MUST NOT 重复引用它。对 code 会话的 state 施加这条 reconfigure effect 是安全的（未被引用的 compartment 项在 resolve 时自然落空）。
- **输入条的开 / 关是触发源**：`src/goto-line.ts` 的浮层在 `open()` / 收起（`confirm` 后的 `dismiss`、`close`、`focusout`）处各通知一次装配层，装配层转成 `editor.setGotoLineGutterVisible(on)`；`on-demand` 档下编辑器据此重配。`always` / `off` 档下这个标志被忽略（`mdGutterExtensions()` 不看它）。
- **装配层读一次配置**：`src/main.ts` 在装载路径把 `snapshot.config.ui.markdown_line_numbers` 交给 `editor.setMarkdownLineNumbers(tier)`——它在 `makeSession` 之前生效，新会话的 state 从第一帧起就是对的（不会出现「先装上再卸掉」的一帧闪烁）。

### 5.4 与 delta / 边界的对应

- delta 侧：本 change 的 spec 增量只落 `keymap-commands`，md 的行号 gutter（三档在场时机）记在同一条 ADDED requirement 的「行号口径 / 可见面」子句里（scenario 见增量文件）；改判引入的可见面变更、缺号边界与配置档位同步写进 requirement 与它的已知边界段。
- 缺号的处置取**不改**：不新增 `lineNumberWidgetMarker` 提供者（机制与 file:line 见 §1.4 第 2 条）。理由：本 change 的落点是「md 不再豁免行号面」，块起始行该不该显示号是**另一个形态决定**；新增提供者会让「块起始行的行号」与「被块覆盖的行」两种语义并存，收益只在 frontmatter 区块。若 Alex 要它，实现期加一条 facet 提供者即可（记为可选后续，不改本 change 的 delta）。

## 6. 实现落点与分层（tasks 的执行依据）

- `src/goto-line.ts`（**新增**），按本仓「纯逻辑在独立模块、DOM 适配在装配侧」的分层（先例：`src/list-indent.ts`、`src/content-width.ts`、`src/table-fullscreen.ts`）：
  - 纯逻辑层：`resolveGotoLine(raw: string, fallbackLine: number, totalLines: number): number` —— 解析 + 钳制，**零 DOM**，`tests/unit/goto-line.test.ts` 直接断言（含 `""` / `"0"` / `"M+10"` / 超长数字串 / 前导零）。
  - DOM 适配层：`createGotoLinePrompt({ mount, onJump })` → `{ open(defaultLine: number, totalLines: number), close() }`，含浮层 DOM、就地键消费、`focusout` 收起、`hidden` 常态。
  - 文案常量（读屏名 / 占位 / `共 {M} 行` 模板）放在本模块，进 `文案-Copy.md` 的 deck（编号 D152 起，实现期先核末位编号）。
- `src/editor.ts`：`EDITOR_CORE_COMMAND_IDS`（`src/keys.ts:135`）加 `editor.goto-line`；`commands` 记录里接一条注入的 opener（沿用 `setTableFullscreen` / `refreshPreview` 同款注入口），确认回调先 `view.focus()` 再调既有 `revealLine(n)`。
- `src/keys.ts`：`{ key: "Alt-KeyG", command: "editor.goto-line", scope: "editor", doc: … }`——doc 里写三条来源核对结论（表即文档）与「⌥G 是 M-g 的单段近亲」的来由。
- `src/main.ts`：装配浮层（`mount: shell.modeline`）、注入 editor 的 opener、在会话切换处收起输入条。
- `src/style.css`：`.lumir-goto` / `.lumir-goto-input` / `.lumir-goto-hint`，tokens 复用，`[hidden]` 分支与 `.lumir-toc[hidden]` 同款。
- 键位面板（`src/bindings-panel.ts`）零改动：它按 `EDITOR_COMMAND_IDS` 分组渲染，新命令自动落到「编辑器」组（**面板因此多一行**——相关视觉场景若按列表派生断言则零改，若渲染文本硬编码行数则同批更新）。
- md 的行号 gutter（D4 两次改判的落点，口径见 §5）：`src/editor.ts` 的 md 分支把 `lineNumbers()` 与 `highlightActiveLineGutter()`（**不**装 `highlightActiveLine`）装进 **`mdGutterCompartment`**，在场由 `mdGutterExtensions()` 按三档 + 输入条状态决定（§5.3）；gutter 的 grid 落点与配色规则落在 md 的 grid 真源处（`src/preview/theme.ts` 的 doc-title 段与 end marker 段之间），与 §5.2 第 4 条一致。
- `src/goto-line.ts`：浮层在 `open()` 与三条收起路径处各通知一次装配层（`onOpen` / `onClose`），装配层转成编辑器的 gutter 装 / 卸（§5.3）——`on-demand` 档的 gutter 因此与输入条同生灭。
- `src-tauri/src/config.rs`：`MarkdownLineNumbers` 枚举 + `UiConfig.markdown_line_numbers` + `RawUiConfig` 的 `Option<String>` + `validate()` 的三档匹配与 warning + 单测（照 `ui.theme` 的模板）；`src/bindings/**` 由 ts-rs 重导出；`docs/specs/config-reference.md` §1.3 加行。
- 受 md gutter 影响的既有断言 / 判据（实现期 MUST 逐处重核：`on-demand` 默认档下 md **没有** gutter，凡以「md 有 / 无行号」当判据的原断言的判别力因此恢复——能回到更强原判据的回去，回不去的写原因；MUST NOT 静默放宽——REVIEW.md 第 1 条同族）：
  - `tests/visual/scenes/markdown-parser.spec.ts:112`（md 的 `.cm-lineNumbers` 计数断言按新默认重核）；
  - `tests/visual/scenes/end-marker.spec.ts:561`（把 `.cm-lineNumbers` 在场当「code 模式」判据——默认档下该判据重新成立，但 `always` 档下失效 ⇒ 判据 MUST NOT 依赖这个键的取值）；
  - `tests/visual/scenes/m130-text-open-trap.spec.ts:84-85` 与 `end-marker.spec.ts:543` 的「code 模式特征 = 行号 gutter」口径注释（口径随档位而变，注释要写清）；
  - `tests/visual/scenes/doc-title.spec.ts` 的 `firstElementChild` 判据（默认档下 gutter 不在场 ⇒ 原判据可能重成立）；
  - `src/editor.ts` 与 `src/scroll-position.ts` 的注释里关于 `getScrollMargins().left` 在 md 上非零的记述（默认档下来源改口径：只有 gutter 在场时非零）；
  - 含 md 编辑区的整页基线（`on-demand` 默认档下应当逐张不变——这是本轮的硬判据；`always` 档新增的那张新场景基线除外）。

## 7. 性能与真机验证

- 跳到远处的行（1MB 文档跳到末行）的代价不在「找行」：`doc.line(n)` 是 rope 上的树下降（行数是构造期缓存的字段，见 `src/main.ts:997-1000` 的同源说明），而是 `scrollIntoView` 触发的**视口重建**（装饰层与语法树在新视口上重算）。这是**一次性跳转**，不是键入路径，ADR 0002 §6 的 `<16ms` 是键入型指标。`on-demand` 档下打开输入条会多一次 gutter 的 compartment 重配（装一列行号）：它只在新视口那次重建之外多一次 DOM 插入，不引入新的视口重建（真机读数时顺带看一次 md 长文档打开 / 收起输入条的延迟，异常另落 finding）。
- 因此本 change 不设性能阈值，但要求：**真机量一次读数并落档**（`test-results/`），先量 1MB fixture 跳末行的时间（KimiCU 注入 → 读取到目标内容可见），读数如实写进 review-request；若出现秒级卡顿，另落 finding（性能修复不在本 change 范围）。
- 真机验收（场景 56）走 KimiCU `key: alt+g` 真实注入 + 编辑器回读，**不用 `set_value` 伪造键盘语义**（`set_value` 不经键位分发链路，验不到 `keys.ts`——套件 README 的既有纪律）。

## 8. 已知边界（同步写进 delta 与 proposal）

1. 焦点不在编辑器内容区时 `⌥G` 不命中（`editor` 作用域，与 ⌃N 一族同边界）。
2. **md gutter 的缺号区**：被块级替换覆盖的源行不显示行号（frontmatter 区块恒缺；块级数学 / mermaid 在块回退为源码时补上）——机制见 §1.4 第 2 条；本 change 不新增 `lineNumberWidgetMarker` 提供者（§5.4）。
3. **`always` 档下 md gutter 常显本身是阅读视图的可见变更**：正文列左缘多一列行号，含 md 编辑区的整页视觉基线要重拍并请 Alex 过目（AGENTS.md 的基线纪律；MUST NOT 静默 `--update`）。**默认的 `on-demand` 档不产生这个变化**（md 打开时无行号 ⇒ 既有整页基线逐张不变），`off` 档同理。
4. 单段 `⌥G` 与 Emacs `M-g` 前缀语义有落差（D1 的知情代价）。
5. 无行号历史、无 mark 回跳、无 `M-g c` / `M-g TAB`。
6. 越界静默钳制（D3 推荐项），缓解是输入条里的 `共 M 行`。
7. **不做 md 行号 gutter 的运行期开关**：三档是配置项的静态取值（装载时读一次、重启生效），没有命令 / 键位 / UI 能切换它（`[ui] theme` 的 live 切换有 modeline 主题钮那个落点作触发源，本 change 没有对应落点，见 §5.1）。
8. 本 change 的 spec 增量只落 `keymap-commands`（md 的行号 gutter 三档记在同一条 ADDED requirement 的可见面 / 配置子句里）；`ui-design-system` 零增量（modeline 不动，`src/modeline.ts` 的窄窗退让不受影响）。**归属缺口如实记账**：今天没有任何 capability 拥有「编辑器行号 gutter 的可见面」——code 模式的 gutter 也未被任何 requirement 覆盖，只在 content-width 的一条 scenario 的 WHEN 子句里被顺带提到；md gutter 的长期归属应是 `editor-live-preview`（其 Purpose 写着「md 模式 = 高亮 + live preview 装饰层」）。本 change 不顺手新建 capability delta（那会扩大节点 1 已裁决的范围），缺口另落 finding。
