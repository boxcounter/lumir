# Design: goto-line-command

## 1. 现状锚点（全部 file:line，2026-09-27 在 `feat/proposal-goto-line-command-m261` 基线上核对）

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

### 1.4 行号的可见面现状

- code 模式：`lineNumbers()`（`src/editor.ts:1437`）在只读 code 的模式扩展里，gutter 显示行号。
- md 模式：只装 live preview，无行号。
- modeline 右段：`src/main.ts:1008` 的 `syncModelineMeta` 拼 `` `${language} · ${lines} 行 · UTF-8` ``，`lines = view.state.doc.lines`（**总行数**，不是光标行号）。口径注释在 `src/main.ts:994-1007` 与 `src/style.css:508-511`：「只读派生、零新状态」——D2 备选（modeline 内联输入）与 D4 备选（modeline 常驻行号段）都要动这条口径，故都不取。

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
| 计数单位 | 源文档逻辑行（`doc.lines` 口径，硬换行分隔，1 基） | 与 code 模式的 gutter 行号同源；软换行不计，与 Emacs「logical line」一致（`M-g g` 计数的是 buffer line） |
| 落点 | 该行行首（`doc.line(n).from`）+ 光标折叠、无选区 | `revealLine` 既有行为 |
| 滚动 | 目标行居中（`y: "center"`） | 与 `⌃L` / wikilink 锚点跳转同口径；Emacs 只做最小滚动，本仓取居中（知情偏差） |
| 越界 | 钳制到 `[1, 总行数]`，不报错 | Emacs `(forward-line (1- line))` 到头即停（[emacs-mirror/emacs, lisp/simple.el](https://raw.githubusercontent.com/emacs-mirror/emacs/master/lisp/simple.el) 的 `goto-line`）；零新文案 |
| 空输入 | 按预填值（当前行号）解释 | Emacs 的 `RET` 用默认值同款（`goto-line-read-args` 的 `read-number` 第二默认是 `line-number-at-pos`） |
| 不采纳的 Emacs 默认 | 「光标处或紧随其后的数字」优先作默认值 | 收益小、判定面要自造（数字两侧的边界），v0 只给当前行号 |
| 取消 | Esc / `⌃G` / `focusout` / 会话切换 → 收起且不跳转 | 会话切换不跳转是本仓多标签语义的必要补充（Emacs 单 buffer 无此情形） |
| 焦点 | 跳转后交还编辑器；取消后交还编辑器 | 与 `editor.widget-escape` 的 `view.focus()` 同款 |
| 文档 | 零改动、不进撤销栈、不改 dirty、不写盘 | ADR 0003 §3；`revealLine` 只 dispatch 选区与滚动 effect |
| 输入字符 | 只接受数字字符 | 把「非法输入」这一整类从解析面消掉，只剩空串一种情形 |

## 5. 实现落点与分层（tasks 的执行依据）

- `src/goto-line.ts`（**新增**），按本仓「纯逻辑在独立模块、DOM 适配在装配侧」的分层（先例：`src/list-indent.ts`、`src/content-width.ts`、`src/table-fullscreen.ts`）：
  - 纯逻辑层：`resolveGotoLine(raw: string, fallbackLine: number, totalLines: number): number` —— 解析 + 钳制，**零 DOM**，`tests/unit/goto-line.test.ts` 直接断言（含 `""` / `"0"` / `"M+10"` / 超长数字串 / 前导零）。
  - DOM 适配层：`createGotoLinePrompt({ mount, onJump })` → `{ open(defaultLine: number, totalLines: number), close() }`，含浮层 DOM、就地键消费、`focusout` 收起、`hidden` 常态。
  - 文案常量（读屏名 / 占位 / `共 {M} 行` 模板）放在本模块，进 `文案-Copy.md` 的 deck（编号 D152 起，实现期先核末位编号）。
- `src/editor.ts`：`EDITOR_CORE_COMMAND_IDS`（`src/keys.ts:135`）加 `editor.goto-line`；`commands` 记录里接一条注入的 opener（沿用 `setTableFullscreen` / `refreshPreview` 同款注入口），确认回调先 `view.focus()` 再调既有 `revealLine(n)`。
- `src/keys.ts`：`{ key: "Alt-KeyG", command: "editor.goto-line", scope: "editor", doc: … }`——doc 里写三条来源核对结论（表即文档）与「⌥G 是 M-g 的单段近亲」的来由。
- `src/main.ts`：装配浮层（`mount: shell.modeline`）、注入 editor 的 opener、在会话切换处收起输入条。
- `src/style.css`：`.lumir-goto` / `.lumir-goto-input` / `.lumir-goto-hint`，tokens 复用，`[hidden]` 分支与 `.lumir-toc[hidden]` 同款。
- 键位面板（`src/bindings-panel.ts`）零改动：它按 `EDITOR_COMMAND_IDS` 分组渲染，新命令自动落到「编辑器」组（**面板因此多一行**——相关视觉场景若按列表派生断言则零改，若渲染文本硬编码行数则同批更新）。

## 6. 性能与真机验证

- 跳到远处的行（1MB 文档跳到末行）的代价不在「找行」：`doc.line(n)` 是 rope 上的树下降（行数是构造期缓存的字段，见 `src/main.ts:997-1000` 的同源说明），而是 `scrollIntoView` 触发的**视口重建**（装饰层与语法树在新视口上重算）。这是**一次性跳转**，不是键入路径，ADR 0002 §6 的 `<16ms` 是键入型指标。
- 因此本 change 不设性能阈值，但要求：**真机量一次读数并落档**（`test-results/`），先量 1MB fixture 跳末行的时间（KimiCU 注入 → 读取到目标内容可见），读数如实写进 review-request；若出现秒级卡顿，另落 finding（性能修复不在本 change 范围）。
- 真机验收（场景 56）走 KimiCU `key: alt+g` 真实注入 + 编辑器回读，**不用 `set_value` 伪造键盘语义**（`set_value` 不经键位分发链路，验不到 `keys.ts`——套件 README 的既有纪律）。

## 7. 已知边界（同步写进 delta 与 proposal）

1. 焦点不在编辑器内容区时 `⌥G` 不命中（`editor` 作用域，与 ⌃N 一族同边界）。
2. md 模式无常驻行号可见面（D4 取推荐项）。
3. 单段 `⌥G` 与 Emacs `M-g` 前缀语义有落差（D1 的知情代价）。
4. 无行号历史、无 mark 回跳、无 `M-g c` / `M-g TAB`。
5. 越界静默钳制（D3 推荐项），缓解是输入条里的 `共 M 行`。
6. 本 change 的 spec 增量只落 `keymap-commands`；`ui-design-system` 零增量（modeline 不动）。
