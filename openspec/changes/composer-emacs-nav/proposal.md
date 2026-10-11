# Proposal: composer 的 Emacs 文本导航整族收回键位表与模型层

- Change ID: composer-emacs-nav
- 日期: 2026-10-11
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：**通过**（Alex，2026-10-11，tower 转述「按倾向」）——六个裁决点逐条按起草
> 倾向落槌：① 同一物理键在两侧怎么进表 → **A**（单绑定 + 作用域加 `text` + 命令内按事件目标分派）；
> ② 接管面 → **A**（整族一次接管）；③ ⌥F / ⌥B 在 composer 内的语义 → **A**（按词扩选；知情接受的
> 行为变更：composer 里的 ⌥F 从「原生词移动」变为「按词扩选」，两侧此后都没有词移动键位）；
> ④ ⌃K / ⌃Y 的 kill 槽归属 → **A**（与编辑器共用同一个槽）；⑤ 与在途 `composer-intercard-caret`
> 的衔接 → **A**（本 change 吸收其方案 C；M444 收缩为边界光标位 + 输入物化 + DOM 往返，已先落地）；
> ⑥ composer 的「行」口径 → **A**（逻辑行）。
> 节点 2（归档评审）：留白（实现完成后填写）。
>
> 起草注记（非规格正文）：本 change 的**提案期只出提案**（节点 1 通过前的措辞，实现见 M453 的
> 同一分支提交）。全部事实性断言对着本 worktree
> （基于 master `f64aaf0`）的源码逐行核实，「实测 / 静态推断」的标注见 §逐键现状 与其后的「证据口径」段。

## Why

**触发**：Alex 裁决（2026-10-11，tower 转述）「composer 的 Emacs 导航整族『要管』」。前因是 worker-m444
的 finding（`.tower/comms/findings/20261011-worker-m444-improve-composer-emacs-b-f.md`，摘录）：composer 的
Emacs 导航整族（⌃B/⌃F/⌃A/⌃E/⌃N/⌃P/⌥F/⌥B/⌃D/⌃H/⌃K/⌃Y…）**全部走 macOS 文本系统原生路径**——不在应用键位表
（`src/keys.ts:459-460` 的 `Ctrl-b` / `Ctrl-f` 作用域是 `editor`，焦点在 composer 里不命中），composer 的
keydown 对所有修饰键直接 `return`（`src/harness-panel.ts:5002`），与编辑器侧「原生 caret 进不了原子范围
⇒ 收回模型层」的做法（`src/editor.ts:385-395`）不一致，且**无任何机器判据**。
（finding 的机制描述有一处不确——「对所有修饰键直接 `return`」只对 ⌘/⌃ 系成立；⌥ 系键不经那一行，其中
⌥⌫ 甚至不走原生路径。逐类的更正在下节「现状锚点」第 3 条。）

**症结（诊断）**：不是「少了几条键位绑定」，而是 **composer 这一文本面上的键位归属与编辑语义同时不受本仓
的单一真源约束**：编辑器侧的移动 / 删除 / kill-yank / 扩选整族已在 `src/keys.ts` 的 `KEY_BINDINGS` 里逐条
登记、由 `src/editor.ts` 的模型层实现、由 `tests/unit` 与 `visual` 两层钉住；同一个物理键在 composer 里
却由引擎的原生 caret 路径决定行为——既不可配（不进 `[keys]` 覆盖面）、不可查（不进键位查看面板）、也没有
判据。同一族键在一次按键序列里可能「模型算一半、引擎算一半」。Lumir 的当前阶段定位是 Emacs keybinding
PKM（[ADR 0006](../../../docs/adr/0006-agent-positioning-deferred.md) §2），而 composer 是 harness 面板
里 Alex 高频输入区——这一族的语义一致性属于定位本身，不是打磨项。

**现状锚点**（逐条已核实，均为静态读源码 + 既有测试，非真机实测）：

- **表内只有两个作用域**：`KeyScope = "global" | "editor"`（`src/keys.ts:169`）；`editor` 的判据是
  「事件目标在编辑器内容区（contentDOM）内」（`src/keys.ts:12-17`、装配处 `src/main.ts:2362-2372` 的
  `isEditorEvent`）。composer 是 harness 面板里的 `contenteditable` 容器（`.lumir-hp-composer`），**不在**
  任何 pane 的 contentDOM 内 ⇒ 族内绑定全部不命中。
- **表内族清单**（`src/keys.ts:451-521`，作用域均 `editor`）：⌃F `editor.cursor-forward`、⌃B
  `editor.cursor-backward`、⌃A `editor.line-start`、⌃E `editor.line-end`、⌃N `editor.cursor-down`、⌃P
  `editor.cursor-up`、⌃D `editor.delete-char-forward`、⌃H `editor.delete-char-backward`、⌥D
  `editor.delete-word-forward`、⌥⌫ `editor.delete-word-backward`、⌃T `editor.transpose-chars`、⌃K
  `editor.kill-line`、⌃Y `editor.yank`、扩选六键 ⌃⇧F/B/N/P/A/E、按词扩选 ⌥F / ⌥B
  （`editor.extend-word-forward` / `-backward`）。
- **composer 的 keydown 里族的实际出路要逐类看**（`src/harness-panel.ts:4972-5027`；此处**更正 finding
  原文的机制描述**——它写「对所有修饰键直接 `return`」，系沿用未核，只对 ⌘/⌃ 系成立）：
  - `mod = event.metaKey || event.ctrlKey`（`:4990`，**不含 `altKey`**）：⌘/⌃ 系在 `:5002` 直接 `return`
    （例外是 `⌘Z` / `⌘⇧Z` / `⌘Y`，在 `:4991-5001` 被面板自管的撤销栈拦下）⇒ 族内 ⌃ 系各键原样下传给引擎；
  - ⌥F / ⌥B / ⌥D **不经 `:5002`**：后续分支（Enter / Backspace / Delete）都不命中（macOS 的 Alt 层把字母
    替换成别的字符，`event.key` 不是 `f` / `b` / `d`），因此**落空放行**给引擎——与 ⌃ 系殊途同归，同样走
    原生路径；
  - **⌥⌫ 是另一条出路**：它不经 `:5002`，但命中 `:5016` 的 Backspace 分支（macOS 上 Alt 不改变该键的
    `event.key`），于是被面板当作**普通退格**消费（逐字符删、词级语义丢失）；只有在 `caretFromDom()` 读不
    回光标时（`:5017-5018`，例如 M444 记的边界位）才 `return` 而退回原生路径 ⇒ 族内 ⌥⌫ 今天**既不等于
    表内 `editor.delete-word-backward`、也不等于原生词删除**；
  - Enter / ⇧Enter / 裸 Backspace / Delete / 粘贴 / 拖入另由面板的就地路径按模型层处理
    （`:5003-5027`、`:5033` 起）。

  上一条（⌥⌫）是对源码路径的**静态推断**：判据是「`altKey` 不改变 ⌫ 键的 `event.key`」，佐证是表内
  `Alt-Backspace` 以物理键名形态存在（该组合没有 Alt 层字符替换）——仍列入实现期的真机探针。
- **该族在编辑器侧的接管先例**（`src/editor.ts:385-395`）：原生 contenteditable 路径下 ⌃F / ⌃B 无法进入
  CodeMirror 的 replace 原子范围（公式 widget），在边界卡住后回弹跳过，故改由 CM 派发、落点钳制到原子内部
  ——「原子结构上的导航不交给引擎」是编辑器侧已落定的结论。
- **composer 侧的原子结构是同形的**：顶层块只有原子卡片（`.lumir-hp-qcard`，composer 态
  `contentEditable = "false"`，`src/harness-panel.ts:2337` / `:2394`）与段落（`.lumir-hp-qpara`）；卡片
  在模型里是一整块，光标位只有「块下标 + 段内偏移」两维（`ComposerCaret`，`:220-231`），卡片上的偏移恒 0
  （= 该块前缘），「卡片后缘」用下一块前缘表达。**删除族已有卡片按整体作用的语义**
  （`backspaceAtCaret` / `deleteForwardAtCaret` / `deleteSelectionRange`，`:457-530`），但那只服务
  Backspace / Delete 两键，同族的 ⌃D / ⌃H 走的是引擎原生路径，不经过这些函数。
- **DOM↔模型的光标往返今日不对称**：`caretFromDom` 对「选区锚在 composer 元素自身」的位置返回 `null`
  （`:2625-2628` 的爬升循环走出 composer 即放弃），而 `setDomCaret` 反过来会把卡片前缘写成
  `range.setStart(composer, index)`（`:2672-2673`）——**写得出、读不回**。这一处与 `composer-intercard-caret`
  （M444，已合并的提案）的裁决点 1 是同一处缺口。
- **`⌥F` / `⌥B` 在表内的语义不是词移动，而是按词扩选**（`src/keys.ts:520-521`），且**本表无法再给这两个
  token 绑第二条绑定**——token 口径规定含 Alt 的组合只按物理键（`KeyboardEvent.code`）判定、忽略 Shift，
  故 `⌥⇧F/B` 与 `⌥F/B` 归一到同一 token（`openspec/specs/keymap-commands/spec.md:224` 的已知限制条：
  「本版 MUST NOT 再绑 bare `⌥F` / `⌥B` 的单词移动」）。composer 里今天按 ⌥F 走的是 macOS 原生的**词移动**
  ——同族键在两侧语义不同（本 change 的裁决点 3）。
- **装配期不变量「一个 token 一条绑定」是硬约束**：`Keymap` 构造函数对归一到同一序列的两条绑定直接抛错
  （`src/keys.ts:830-834`），单测 `tests/unit/keys.test.ts:105` 另有一条「作用域与命令组一致」的对账
  （`binding.scope` 必须等于「命令在 editor 组则为 editor，否则 global」）。⇒ **同 token 不能有两条默认绑定**，
  新增 composer 绑定必须与既有 editor 绑定共用一条。
- **配置与面板的覆盖面对作用域敏感**：`[keys]` 覆盖时作用域**机械派生**自命令分组
  （`src/keys.ts:793`：命令在 `EDITOR_COMMAND_IDS` 里则 `editor`，否则 `global`），键位查看面板渲染的正是
  这份生效表（`openspec/specs/keymap-commands/spec.md` 的「键位配置覆盖」「键位查看面板」两条）。
- **kill 槽是模块级单例**（`src/editor.ts:709`，注释自陈「跨 pane 共享，kill ring 在 Emacs 本就是全局的」），
  未导出；`editor.kill-line` / `editor.yank` 的实现在 `src/editor.ts:717-773`。
- **基准读数（本次实跑）**：`node tests/unit/run.mjs` = `tests 794 / pass 794 / fail 0`（2026-10-11，本
  worktree）。`tests/unit/keys.test.ts` 全文零处提到 composer，`tests/unit/harness-composer.test.ts` 只覆盖
  换行 / 视口 / 块序不变量——**这一族键今天在 unit 层没有任何判据**（可验：`rg -n composer tests/unit/keys.test.ts`
  零命中）。

**本 change 与 finding 建议的两条路的关系**：finding 给的是 (a) 收回模型层 / (b) 补真机验收探针两条路。
**这两条不是二选一**——编辑器侧的做法是「**键位归表 + 语义归模型层**」（`src/keys.ts` 登记绑定、实现走 CM
派发），本提案按同一形状落：键位层的接管（表内作用域扩展 + 配置 / 面板覆盖）与模型层的接管（纯函数移动 /
删除 / 扩选）是同一件事的两面。探针（读光标落点 / 可见性 / 打字落点三组读数）是**验收判据**的组成部分，不是
替代品。

## What Changes

逐条对应 `specs/` 增量里的一个 requirement：

1. **文本面作用域**（`keymap-commands`，MODIFIED「统一键位分发表」）：作用域取值由两种扩为三种，新增
   **`text`**（事件目标落在编辑器内容区内**或** harness composer 内才生效）。族内绑定的作用域由 `editor`
   改判 `text`；**命令 id 不变**（`editor.*` 仍是文本编辑命令的归属命名，作用域表达「在哪生效」）；
   **实现按事件目标所属面分派**——目标在 composer 内走 composer 侧模型层实现，否则走既有编辑器实现；
   分派点集中在一处（装配层包装），MUST NOT 每个命令各写一遍面判定。**族外的 editor 命令（⌥G、widget 族、
   Tab 缩进等）作用域不变**，在 composer 内照旧不命中（这是「editor 作用域不越界」的既有防线）。配置覆盖的
   作用域派生与键位面板的呈现随之获得 `text` 面，**「一个 token 一条绑定」不变量一字不改**。
2. **composer 的 Emacs 文本导航族**（`harness`，ADDED）：整族在 composer 内的行为合同——移动族（⌃F/⌃B/⌃A/
   ⌃E/⌃N/⌃P）在块序列上的停靠点规则（原子卡片按整体一步跨过；段落末缘与紧邻卡片前缘是同一视觉位的归一）、
   删除族（⌃D/⌃H/⌥D/⌥⌫）与 kill-yank（⌃K/⌃Y）、转置（⌃T）、扩选六键 + 按词扩选（⌥F/⌥B）的落法；
   **导航 MUST NOT 改块序列、MUST NOT 成撤销步、MUST NOT 整面重渲**；删除族与 kill-yank 复用既有模型层
   函数与 **kill 槽单一真源**；⌃Y 的多行内容经既有 `insertPlainTextAtCaret` 拆段。
3. **混排对话输入区**（`harness`，MODIFIED）：把「光标可在任意卡片前后继续输入」写实到导航层——
   相邻卡片之间的边界位是可用导航到达的合法光标位，且键盘导航在该处与在段落内行为一致（同一套停靠点规则）。
   > 归档对账注记：本条基于**当前 living spec 文本**起草；`harness-composer-image-paste` 与
   > `composer-intercard-caret` 对同一条 requirement 各有一份在途 MODIFIED/ADDED，归档时须按当时的文本
   > 重新落准（见 tasks §6）。

**明确不做**（逐条理由见 §逐键定档表与 Non-goals）：不接管 ⌃G、⌥G、滚动族（⌃V/⌥V/⌃L）、Tab/⇧Tab、
撤销族（⌘Z/⌘⇧Z/⌘Y 与 Emacs 别名 ⌃/ / ⌃_），不新增「词移动」键位。

## 逐键定档表

**表 1 —— 族内接管键**（作用域由 `editor` 改判 `text`；命令 id 与编辑器侧实现均不变，新增 composer 侧实现）：

| 键 | 表内命令（`src/keys.ts`） | 编辑器侧语义 | composer 侧接管语义 |
|---|---|---|---|
| ⌃F / ⌃B | `editor.cursor-forward` / `-backward` | 段内前进 / 后退一字符，跨原子块钳制 | 段内字符步进（代理对整体一步）；**原子卡片整体一步跨过** |
| ⌃A / ⌃E | `editor.line-start` / `line-end` | 文本行行首 / 行尾（硬边界，段落语义） | 段落内**逻辑行**行首 / 行尾（`\n` 为行界，与 composer 质量合同 HC1 的「行」同口径） |
| ⌃N / ⌃P | `editor.cursor-down` / `cursor-up` | 逐视觉行上移 / 下移，跨原子块 | 段内逻辑行步进；出段落则跨块（卡片不产生停靠行） |
| ⌃D / ⌃H | `editor.delete-char-forward` / `-backward` | 后删 / 前删一字符（选区则删选区） | 复用 `deleteForwardAtCaret` / `backspaceAtCaret`（卡片前缘 / 段末遇卡片 ⇒ 整块删，与 Delete / Backspace 键同口径） |
| ⌥D / ⌥⌫ | `editor.delete-word-forward` / `-backward` | kill 到词尾 / 词首（并入 kill 槽） | 同语义，在段落内按词边界 kill；跨块时**只到块边界**，不越过卡片 |
| ⌃K | `editor.kill-line` | kill 到行尾，已在行尾则连带换行 | kill 到**段内逻辑行**行尾；已在行尾则连带该行换行（段末行尾时并入 kill 槽但不跨卡片） |
| ⌃Y | `editor.yank` | 插入 kill 槽（替换选区） | 插入到段落（多行经 `insertPlainTextAtCaret` 拆成多个段落块）；卡片边界位插入则先物化段落（与 M444 的物化口径一致） |
| ⌃T | `editor.transpose-chars` | 字符转置 | 段落内字符转置（段首 / 段末 / 卡片边界处无动作——Emacs 在 buffer 边界同样 no-op） |
| ⌃⇧F / ⌃⇧B / ⌃⇧N / ⌃⇧P / ⌃⇧A / ⌃⇧E | `editor.extend-*` 六键 | 扩选对称 | 同语义扩选：**anchor 不动、head 按上表同一套停靠点移动**（与移动族共用同一份移动纯函数） |
| ⌥F / ⌥B | `editor.extend-word-forward` / `-backward` | 按词扩选 | **按词扩选**（与表内语义一致；不是词移动——见裁决点 3） |

**表 2 —— 族内例外（本 change 不接管，逐条理由）**：

| 键 | 不接管的理由 |
|---|---|
| ⌃G `editor.keyboard-quit` | composer 里没有「可中止的对象」；原生 `cancelOperation` 的行为（清选 / 取消组合）已够用，接管只会引入一个空动作。登记为族内显式例外 |
| ⌃V / ⌥V / ⌃L（翻屏 / recenter） | 视口滚动与 caret 落点无关，不存在「原子结构走不进去」的问题；composer 有自己的视口合同 HC2（`docs/specs/harness-composer.md`），本 change 不并轨 |
| ⌥G `editor.goto-line` | composer 的内容不进 vault、没有行号定位语义 |
| Tab / ⇧Tab（`editor.list-indent` / `-outdent`） | 属列表缩进族、不是 Emacs 导航族；composer 没有 Markdown 列表语法语义 |
| ⌘Z / ⌘⇧Z / ⌘Y、⌃/ / ⌃_ / ⌃⌥- | 撤销族不是导航族；且 composer 的撤销已由面板的就地分支承担（`src/harness-panel.ts:4991-5001`）。⌃/ 与 ⌃_ 在 composer 内今天**既不撤销也无其它语义**（引擎无对应绑定）——如实登记为已知缺口，另案（见 Non-goals） |

### 逐键现状：预期正常面 / 预期失效面

按「族内键今天在 composer 里各自是什么处境」分三类（**全部为静态推断**，判据见下段「证据口径」）：

- **预期今天工作正常（不涉及原子块边界）**：段内字符移动（⌃F/⌃B 在段落内部）、段内逻辑行移动
  （⌃A/⌃E/⌃N/⌃P 在单段落内）、段内字符删除（⌃D/⌃H）、段内 kill/yank（⌃K/⌃Y）、段内转置（⌃T）——
  语义与编辑器侧**大体同形**，走原生路径不产生可见缺陷。
- **预期在卡片边界 / 原子块处出错或不可控**：⌃F / ⌃B 在卡片边界（原子 `contenteditable=false` 元素）上——
  编辑器侧同形场景的实测结论是「原生 caret 进不了原子范围、边界卡住后回弹跳过」（`src/editor.ts:385-395`），
  composer 侧没有理由不同，但**未经 composer 实测**；⌃D / ⌃H 在卡片边界上引擎如何处理整块元素
  （跨过？进入？删掉卡片？）不可控；⌃N / ⌃P 跨段落时要跨过卡片，行为同样不可控；⌃K / ⌃Y 在「卡片相邻」的
  段落处行为不可控。
- **预期今天与表内语义不同、或干脆无动作**：⌥F / ⌥B 走 macOS 原生的**词移动**，而表内这两个 token 是**按词
  扩选**（同键两义，本 change 裁决点 3）；**⌥D 走原生词删除，但不并入应用的 kill 槽**——表内的
  `editor.delete-word-forward` 是 kill 语义，今天在 composer 里按 ⌥D 删掉的文本用 ⌃Y 拿不回来；**⌥⌫ 连
  原生词删除都不是**：它被面板的 Backspace 分支当普通退格消费（见上「现状锚点」第 3 条）；扩选六键
  ⌃⇧F/B/N/P/A/E 在 macOS 文本系统的标准绑定里**没有**对应的 Emacs 扩选动作 ⇒ 预期在 composer 内**无动作**
  （静态推断）。

**实测项（本提案不声称，列为实现期探针）**：composer 内原生 caret 在原子卡片边界上的三组读数——光标落点、
光标可见性、打字落点（照 `composer-intercard-caret` tasks §1 的口径）；探针结论同时是实现期反向验证的对照组
证据（证明旧路径确实不可用，见下节）。

**证据口径（诚实声明）**：上两段与表的「今日路径」一律是**静态推断**——依据是三处源码事实（族内绑定作用域为
`editor`、`isEditorEvent` 只认 contentDOM、composer keydown 的逐类出路：⌘/⌃ 系在 `:5002` 放行、⌥F/⌥B/⌥D
落空放行、⌥⌫ 被 `:5016` 当普通退格）与编辑器侧的既有实测记录（`src/editor.ts:385-395`，M110/M111 现场，
**那是编辑器、不是 composer**）。**本提案不声称 composer 内原生 caret 的具体行为**（光标落点 / 是否画得出 /
打字落在哪个节点）——那不是能靠读源码得到的。唯一在本次会话内**实跑**的是单元测试基准（794/794 绿）与
「`tests/unit/keys.test.ts` 零处提到 composer」这一检索事实。

## 机器判据（概要；落法与逐条断言见 design §5）

接管一个「今天没有任何判据」的族，判据必须与实现同 PR 落地，否则又是「行为靠手感、没人能证伪」：

1. **模型层单测矩阵**（`tests/unit`，零 DOM）：小块序列**全枚举**（0–3 块：卡片 / 段落 / 空段落 / 含 `\n` /
   相邻卡片 / 以卡片开头与结尾）× 全部起始光标——停靠点序列与归一等价类（一步必有位移）、移动族落点
   （含代理对整步、卡片一步跨过、⌃N/⌃P 的卡片跳过）、删除族（⌃D ≡ Delete、⌃H ≡ Backspace 的对账断言；
   词级 kill 不跨块）、kill-yank（相接合并、跨面共槽、**kill 内容不含卡片**）、⌃T 三档、扩选 anchor 不动；
   以及一条横贯不变量：**导航命令的返回块序列与入参逐字节相等**。
2. **keys 层单测**（`tests/unit/keys.test.ts`）：表对账（token 唯一、作用域与命令面一致、`text` 面清单与
   design §4 的键表逐条对应）、分发器三分支（composer 内族内命中 / composer 内族外 editor 命令不命中 /
   contentDOM 内行为与今天一致）、`[keys]` 对 `text` 面命令的重绑与解绑。
3. **真机验收场景**（`scripts/acceptance`，WKWebView，mock provider，fixture 全合成）：逐键落点（段落 /
   相邻卡片 / 卡片边界三类起点）、卡片边界一步跨过、**导航零 DOM 变更**（MutationObserver 计数 = 0，同时是
   「MUST NOT 整面重渲」与 ADR 0002 §6 的判据）、**导航不成撤销步**（导航后 ⌘Z 回到编辑前态）、删除族按整卡、
   **⌥⌫ 确实走表**（面板让位生效：`alpha beta` 行尾按 ⌥⌫ 删掉整个词——今天它被面板当普通退格消费，见 design
   §4.5 的「面板先消费、分发器让路」陷阱）、kill-yank 跨面、扩选 anchor、族外键（⌥G / ⌃V / Tab）不回退。
4. **反向验证**（合同先行口径）：命令改回原生路径 ⇒ 落点断言 MUST 变红；导航改为整面重渲 ⇒ 零 DOM 变更断言
   MUST 变红；⌥⌫ 改为跨块删卡 ⇒ 不跨块断言 MUST 变红；面板就地分支放回「带修饰键也处理」⇒ ⌥⌫ 走表那条 MUST
   变红。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 同一个物理键在编辑器与 composer 两侧怎么进表 | A. **单绑定 + 作用域加 `text`（文本面）+ 命令内按事件目标分派**；B. 同 token 允许两条作用域互斥的绑定（`editor` 一条、`composer` 一条，装配期「重复绑定」判据放宽为「互斥才允许」）；C. composer 的就地 keydown 自己接管整族，表不动 | **倾向 A**。B 与表内已落定的「一个 token 一条绑定」正面冲突（该不变量在 `openspec/specs/keymap-commands/spec.md:224` 已被用来**否决**「再给 ⌥F 绑一条词移动」，先例明确），且会让 `[keys]` 的「重绑 / 解绑某个键」对同名两条绑定产生歧义、键位面板一行变两行。C 会让这一族既不可配（不进 `[keys]`）又不可查（不进面板），并新增一条与既有 editor 绑定并列的旁路——与「分发 SHALL 只有一条路径」的意图相悖。A 的代价是「一个命令 id 的实现在两个面上分派」，用**一处**包装收口（REVIEW.md 第 8 条：同一语义不许两处真源） |
| 2 | 接管面 | A. **整族一次接管**（表 1 全部）；B. 只接管移动 + 删除（⌃F/B/A/E/N/P/⌃D/⌃H/⌥D/⌥⌫），kill-yank / 转置 / 扩选 / 按词扩选留原生；C. 只接管水平移动（= M444 方案 C） | **倾向 A**。finding 的核心指控是**族内不一致**（「一次按键序列里模型算一半、引擎算一半」）：B 只是把不一致的边界从「移动 vs 删除」挪到「删除 vs kill-yank」，扩选族（⌃⇧F/B…）不跟着走模型还会出现「移动走模型、扩选走引擎」的自相矛盾；C 是 M444 的实测触发的后备，本 change 一并吸收（裁决点 5）。A 的增量代价主要是 kill 槽归属与转置语义（裁决点 4 与其表 1 条款） |
| 3 | ⌥F / ⌥B 在 composer 内是哪个语义 | A. **按词扩选**（与表内 `editor.extend-word-forward/backward` 一致）；B. 词移动（随 macOS 原生，本 change 不动这两键）；C. 让 ⌥F 在 composer 里当词移动、在编辑器里当扩选（同 token 两语义） | **倾向 A**。本仓表内这两个 token 已归扩选（`src/keys.ts:520-521`），且**无法**再加第二条绑定（token 口径忽略 Shift，`openspec/specs/keymap-commands/spec.md:224`）——C 是同一物理键在两个面上语义相反，正好是本次要消灭的那类不一致。选 A 的已知代价：**composer 里按 ⌥F 将从「词移动」变成「按词扩选」**（今天的词移动随本 change 消失，两侧都没有词移动键位）——这是知情的行为变更，不是遗漏；若要补词移动，须先改 token 口径（含 Alt 组合纳入 Shift 判定），属另一 change |
| 4 | ⌃K / ⌃Y 的 kill 槽归属 | A. **与编辑器共用同一个 kill 槽**（Emacs 语义：一个 kill ring；本仓已有「模块级单例、跨 pane 共享」的先例与明文口径，`src/editor.ts:704-709`）；B. composer 独立一个槽；C. 不接管 ⌃K / ⌃Y | **倾向 A**。两个槽就是「同一个会话里 ⌃K 杀的内容在另一处 ⌃Y 插不出来」——第二个真源，且与既有 pane 间共享的口径打架。实现面收口：把 `killSlot` 从 `src/editor.ts` 提到共用模块并导出（编辑器侧实现改为引用它），MUST NOT 复制一份；代价是 `src/editor.ts` 之外的写入面扩大一格（已在 Impact 列明） |
| 5 | 与在途 `composer-intercard-caret`（M444）的衔接 | A. **本 change 吸收 M444 的方案 C**（键位层接管水平移动），M444 收缩为「边界光标位模型 + 输入物化 + DOM 往返」；B. 两 change 各自独立（本 change 不动 ⌃B / ⌃F，交给 M444 的实测闸决定）；C. 合并为一个 change（M444 撤回，内容并入本 change） | **倾向 A**，且 B 不只是次序偏好而是**结构必然**：M444 tasks 3.2 的原话是「`src/keys.ts` 加 composer 作用域的 `Ctrl-b` / `Ctrl-f` 绑定……与 `editor` 作用域互不命中」——那正是同一 token 的第二条绑定（本 change 裁决点 1 的备选 B 形态），在今天的装配期判据下**建不起来**（`src/keys.ts:830-834` 直接抛「重复绑定」，`tests/unit/keys.test.ts:105` 的作用域对账也不放行）。所以 ⌃B / ⌃F 只能由一处接管，两个 change 无法各自持有。A 的分工与依赖方向清晰：**M444 提供模型层的前置**（边界光标位的表示 + `caretFromDom`/`setDomCaret` 往返对称 + 输入物化），**本 change 在其上铺导航族**（停靠点序列、移动 / 删除 / 扩选语义）。落地次序：M444 先（或与 M447 同批）——若 M444 先落地，其裁决点 2 的实测闸与 tasks §3 整体标注「未触发，由 M447 接管」；若 Alex 希望一次做完，取 C（由 tower 处理 M444 的撤回） |
| 6 | composer 的「行」口径 | A. **逻辑行**（`\n` 为行界，纯模型可判，与既有 HC1 的「行」同口径）；B. 视觉行（换行折行后的渲染行，需 DOM 测量） | **倾向 A**。HC1/HC2 的「行」定义已经是逻辑行（`docs/specs/harness-composer.md`：段落按「尾随换行不产生行盒」计，卡片不占文本行），B 会让同一份合同里出现两个「行」的定义，且把导航拖回 DOM 测量（判据从纯函数退化为需要渲染环境）。B 的收益（长段落按折行上下移动）留 dogfood 后再看 |

## Non-goals

- **编辑器侧的键位与语义**：除族内绑定作用域由 `editor` 改判 `text`、编辑器侧实现被包进一处分派包装之外，
  编辑器侧的命令实现、落点语义、CM 派发路径逐字节不变；MUST NOT 借本 change 改编辑器行为。
- **不新增任何物理键位**：不引入 Emacs 前缀 / chord（`C-x` 系、`C-x C-s`）、不引入 isearch（⌃S）、不引入
  mark mode 与 `C-@` / `C-SPC`；不新增「词移动」键位（理由见裁决点 3）。
- **不接管撤销族**：⌘Z / ⌘⇧Z / ⌘Y 保持面板就地路径；Emacs 别名 ⌃/ 与 ⌃_ 在 composer 内今天无动作，本
  change 不顺手修（它要求把面板的 ⌘Z 分支迁进表，属另一处结构变更）。登记为后续项。
- **不改 composer 的块模型与投递协议**：`ComposerBlock` / `serializeQuoteMessage` / `serializeDelivery` /
  快照恢复口径一律不动；导航 MUST NOT 改动块序列（因此也不会改动 wire 形态）。
- **不改卡片外观与几何**：`lumir-hp-qcard` 一族样式零改动；导航不产生新的视觉元素（**无「此处可输入」
  提示**，可发现性留 dogfood 后再看）。
- **不接管滚动族与 Tab 系**：⌃V / ⌥V / ⌃L 走引擎滚动；Tab / ⇧Tab 归列表缩进族。
- **不做多光标 / 区域（region）复制粘贴**：扩选族产出的选区只供删除与复制，不引入 Emacs 的 region 语义。
- **不做 kill ring 的持久化与多项环**：沿用既有单槽（`src/editor.ts:704` 自陈「kill ring 后续」）。

## Impact

- **影响的 specs**：`keymap-commands`（MODIFIED ×1：统一键位分发表——作用域三值 + composer 分派）；
  `harness`（ADDED ×1：composer 的 Emacs 文本导航族；MODIFIED ×1：混排对话输入区）
- **影响的代码 / 系统**：
  - `src/keys.ts`：`KeyScope` 加第三值 `text`；族内绑定作用域改判；作用域派生（`applyKeyOverrides` 与
    装配期对账）按新的命令面分组机械生成——**派生只有一处**（`tests/unit/keys.test.ts:105` 的「作用域与
    命令组一致」对账须同步收紧为这条单一函数，不许两处各写一份）；
  - `src/main.ts`：`isEditorEvent` 旁新增 composer 面判定（装配层持有面板句柄与 pane 布局，是唯一能同时
    看见两个面的地方）；族内命令的**一处**面内分派包装；
  - `src/harness-panel.ts`：面板句柄新增「composer 侧文本面命令入口」（按命令 id 分派到模型层），
    以及新一批**纯函数**移动 / 删除 / 扩选 / 转置原语（与既有 `backspaceAtCaret` / `insertPlainTextAtCaret`
    同层、零 DOM 依赖，供 `tests/unit` 直接驱动）；就地 keydown 的 Backspace / Delete 分支收窄为**不带修饰键**
    的那一拍——面板的处理器先于 window 分发器、分发器又对已消费事件让路，不收窄则 ⌥⌫ 被当普通退格消费、表内
    绑定永不命中（design §4.5）；
  - `src/editor.ts`：`killSlot` 提为共用模块并导出（编辑器侧实现改为引用），kill/yank 语义一字不改；
  - `docs/specs/harness-composer.md`：新增一条不变量条款（停靠点序列 + 导航不改块序列/不成撤销步/不重渲）
    ——**合同先行**（`docs/process/rendering-defect-contract-first.md`），若 M444 已在该文件落过边界光标位
    条款，本 change 在其后追加导航条款、不重复定义；
  - `tests/unit`：新一批移动 / 删除 / 扩选的模型层枚举与属性用例；keys 层的表对账（token 唯一、作用域与
    命令面一致、`[keys]` 对 `text` 面命令的重绑 / 解绑）与分发器用例（composer 目标命中 / contentDOM 目标
    / chrome 目标三分支）；
  - `scripts/acceptance`：真机场景（导航族落点 / 卡片边界一步跨过 / 删除族按整卡 / kill-yank 跨面 /
    扩选 anchor 不动 / 导航零 DOM 变更与零撤销步）；
  - 文案（`文案-Copy.md` + `src/copy-data.ts`）：`text` 面命令的来由文案（D-code 取空闲段，zh/en 双档）；
    键位查看面板**不新增分组**（`text` 面命令按功能族归入既有分组）。
- **关联约束**：ADR 0006 §2（Emacs keybinding PKM 定位——本 change 是该定位在 composer 上的具体化）；
  ADR 0002 §6（性能合同：导航 MUST NOT 整面重渲，只写选区与滚动位，不进 keypress-to-paint 的重路径）；
  `openspec/specs/keymap-commands/spec.md`（一个 token 一条绑定 / 分发只有一条路径 / 配置与面板覆盖面）；
  ADR 0003（composer 不触碰 vault——本 change 只改内存模型与选区）；REVIEW.md 第 8 条（同语义不许两处真源：
  作用域派生、停靠点规则、kill 槽各只有一处）；仓库信息卫生（验收 fixture 全合成）。

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：零埋点前提下最直接的可见面是**键位查看面板**（⌘/）——接管后这一族以 `text` 作用域
  出现在面板里，`[keys]` 也能重绑 / 解绑（今天它们不在表内、面板里查不到）；Alex 在面板里看到这一族即知
  「它归了表」。行为侧的天然痕迹在 composer 自身：导航 / 删除 / kill-yank 改的是**待发送文本**，发送后随
  wire 记录落进会话 JSONL，可用 `llm_request` 里的文本与 composer 操作对账。
- **怎么知道它有效**：主判 Alex dogfood 手感——在 composer 里贴两张图 + 打一段字，整族按一遍（⌃B/⌃F 在
  卡片边界一步跨过、⌃D/⌃H 删卡按整块、⌃K/⌃Y 与编辑器共用槽、⌃⇧F 扩选）。辅判：编辑器与 composer 两侧
  用同一族键做同一件事时行为是否一致（不一致 = 落法有问题）。
- **出问题怎么发现**：机器面三层兜底——模型层单测（停靠点 / 删除 / 扩选的全枚举与属性断言，零 DOM）、
  分发器单测（composer 目标命中、族外 editor 命令在 composer 内不命中、`[keys]` 覆盖生效）、真机验收场景
  （落点 / 卡片一步跨过 / 扩选 anchor / 零 DOM 变更 / 零撤销步）。失败形态（光标落到错块、卡片被吞、
  导航把块序列改坏）都有可判据的模型读数，不静默。反向验证按合同先行的口径做：把某条命令临时改回原生
  路径，断言 MUST 变红。
