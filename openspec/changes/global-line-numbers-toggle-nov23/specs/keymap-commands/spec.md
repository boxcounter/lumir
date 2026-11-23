# keymap-commands 增量规格

> 改名通道说明：本 change 把行号从「md 专属三档、code 恒常显」改成「md / code 共用一个全局
> 开关」。两条既有 requirement 的**场景标题**随语义改裁失效（「md 模式的行号 gutter 三档」「档位
> 由配置装载、不进运行期」，以及右键条的 `on-demand` 场景），而 `openspec validate --all
> --strict` 对 MODIFIED 按场景标题逐字比对、不允许改名（改名会被判成静默丢场景）。照仓内先例
> （`scrollbar-tiers-oct24` 的「改名通道说明」）改走 **REMOVED + 新名 ADDED**：旧条整条移除，
> 实质内容逐段承接在新条里——能力、命令 id、实现落点都不变，只有 requirement 名与场景名随语义
> 更新；`editor.goto-line` 的落点 / 钳制 / 取消语义、右键复制的剪贴板 / 反馈 / 零副作用口径逐条
> 不变。设计依据见 [design.md](../../design.md)，节点 1 裁决见 [proposal.md](../../proposal.md)。

## REMOVED Requirements

### Requirement: 跳转到指定行命令（editor.goto-line）

**Reason**: 该条的行号 gutter 段与两条场景断言（三档 /「不进运行期」）被本 change 的全局开关
改裁整体推翻；MODIFIED 的归档规则不允许改场景标题，故以新名 requirement 整条承接。
**Migration**: 见本 delta 的「跳转到指定行与行号可见面（editor.goto-line）」——命令 id、`⌥G`
默认键位、行号口径、输入条行为与全部已知边界逐条承接，只有 gutter 在场合同改为两档 + 跳转临时档。

### Requirement: 行号 gutter 的右键复制（`{path}:{line}`）

**Reason**: 该条正文与一条场景引用了已退场的 `[ui] markdown_line_numbers` 三档；场景标题
「`on-demand` 档的临时 gutter……」随档位退场失效，MODIFIED 不允许改名，故以新名 requirement
整条承接。
**Migration**: 见本 delta 的「行号 gutter 的右键复制（`{path}:{line}`，随行号开关在场）」——
手势、路径口径、行号口径、失败反馈与零副作用逐条承接，只有在场合同改为 `[ui] line_numbers`
两档 + 跳转临时 gutter。

## ADDED Requirements

### Requirement: 跳转到指定行与行号可见面（editor.goto-line）

编辑器 SHALL 提供「按行号定位」的能力，命令 id 为 `editor.goto-line`，实现 SHALL 落在编辑器内核（`src/editor.ts` 的 commands 记录），并 SHALL 经统一键位表（`src/keys.ts` 的 `KEY_BINDINGS` + 分发器）分发——MUST NOT 另开旁路（编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是「统一键位分发表」点名的漂移形态）。

默认键位 SHALL 是 `⌥G`，token MUST 写 `Alt-KeyG`：含 Alt 的组合按物理键（`KeyboardEvent.code`）判定——macOS 的 Alt 层替换字符（⌥G 的 `event.key` 是 `©`），`e.key` 判不出用户按的是哪个键（与既有的 `Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF` 同款口径）。键位占用 SHALL 按三条独立来源核实（表内 / 原生菜单 accelerator / macOS 系统级），结论 SHALL 写在绑定对象的 `doc` 与实现处注释里（表即文档）。作用域 SHALL 随命令归属机械派生为 `editor`（命令 id 属编辑器内核组，前缀与作用域 MUST NOT 互相打脸）：`⌥G` 是「⌥ 系 Emacs 键位集」（M132）的成员，与 ⌃N/⌃P/⌃F/⌃B/⌃E、⌥V、⌥D、⌥⌫ 同族。绑定 SHALL 可经 `[keys]` 重绑 / 解绑：默认键位是单段、无空白，配置层的形态校验因此放行（含空白的 chord 会被拒，见本 requirement 末尾的已知边界）。

行号口径 SHALL 在 md 与只读 code 模式下是**同一条**：计数单位是 `view.state.doc` 的**源文档逻辑行**（硬换行分隔、1 基、总行数 = `doc.lines`），软换行（视觉行）MUST NOT 参与计数——因此两个模式跳到的行号都与各自 gutter 显示的行号一致。**两个模式的行号 gutter 在场 SHALL 由同一个开关决定**：`[ui] line_numbers` 的 `"on"` / `"off"` 两档（默认 `"off"`；启动真源、运行期切换与持久化的口径见「行号开关命令（view.toggle-line-numbers）」条），取值由 Rust 侧闭集合校验；md 与只读 code MUST NOT 各自再判一套档位，也 MUST NOT 存在「code 恒常显」的例外。`"on"` 下 gutter SHALL 常驻在场、与跳转输入条无关；`"off"` 下 gutter SHALL 在文档打开时不在场，唯一例外是**跳转输入条打开期间 SHALL 临时在场**（md 与 code 一致），输入条收起（Enter / Escape / `⌃G` / `focusout` 到浮层之外 / 前台会话切换）时 SHALL 卸除。gutter 在场时装的是同一套 `lineNumbers()`（行号即源文档逻辑行号），当前行的行号 SHALL 有高亮（`highlightActiveLineGutter`，只给行号加底、MUST NOT 改正文行的底色）。**装 / 卸 gutter 的几何 SHALL 按窗口分两档**：① md 的任意窗口宽度、以及 code 左侧余量足以容纳 gutter 的窗口（判据取 1200px 定窗）——正文列仍居中、行号贴正文列左缘且不被裁切，开关瞬间 `.cm-content` 的实测 rect 逐值不变；② code 左侧余量不足的窗口——允许正文列左移一个 gutter 宽，但 MUST NOT 出现横向滚动、MUST NOT 裁切行号，正文从 gutter 右缘起排（边界见 design §4.2）。触发命令 SHALL 呈现一个小浮层输入条：输入框 SHALL 预填当前行号（1 基）并全选，SHALL 只接受数字字符（其余按键在输入框内不产生字符），并 SHALL 显示文档总行数（`共 M 行`）——输入条与 gutter 是行号可见面的两处；modeline 的 meta 段仍只给总行数，行号开关的指示钮是新增的独立 requirement（`ui-design-system` 的「行号指示钮」），MUST NOT 把行号读数塞进 meta。

确认（Enter）SHALL 把光标移到第 n 行行首并把该行滚到视口居中：落点 SHALL 复用编辑器既有的 1-based 行定位原语（`revealLine`，其滚动口径与 `editor.recenter`、wikilink 锚点跳转同为 `scrollIntoView` 的 `y:"center"`），MUST NOT 另写一套落点算式。完成后焦点 SHALL 交还编辑器（后续按键落回文本上下文）。整条路径 MUST NOT 改动文档（ADR 0003 §3）、MUST NOT 进撤销栈、MUST NOT 改 dirty、MUST NOT 触发写盘。

数字的解释与钳制 SHALL 只有一条规则：输入的数字按 `[1, 总行数]` 钳制后的值即落点（Emacs `goto-line` 的 `(forward-line (1- line))` 到头即停口径：越界不报错、停在文档边界）；解析不出数字（空串）时 SHALL 按预填值解释，因此空输入 + Enter 是「停在当前行」。取消（Escape 或 `⌃G`）SHALL 收起输入条且不动光标、不动选区、不动文档；焦点离开输入条（focusout 到浮层之外）与前台会话发生切换（切标签 / 被外部打开请求置换）SHALL 同样收起且**不跳转**——落点行号只对打开时的那份文档有意义，MUST NOT 跨会话跳转。输入条打开期间再按同键 SHALL 就地消费为无操作（不重复打开、不清空已输入内容、不把 Alt 层字符打进输入框）。

输入条自己的键（Enter / Escape / `⌃G` / `⌥G`）MUST NOT 进 `KEY_BINDINGS`：表内一个 token 只能有一条绑定，Escape 已归 `editor.widget-escape`（带 `when` 条件），这些键由输入条就地消费——理由与既有的搜索面板 / 大纲浮层 / vault 切换器同款（作用域判定看事件目标是否在 contentDOM 内，而输入条持有焦点时事件目标在浮层里，表内绑定不命中，两处不构成同一物理键的第二条分发路径）。

已知边界（如实记录，MUST NOT 当成缺陷回头修）：① 焦点不在编辑器内容区时 `⌥G` 不命中（`editor` 作用域的既有边界，与 ⌃N 一族相同）；② 不做 Emacs 的 `goto-line-history`（行号历史）与 `goto-line` 的 `push-mark` 回跳（本仓 v0 无 mark ring）；③ 不做 `M-g` 家族的其它成员（`M-g c` 按字符位置、`M-g TAB` 按列）；④ 输入面只有行号一种语法，不做百分比 / 字符位置 / 列的输入形式；⑤ md 的 gutter 在**被块级替换覆盖的源行**上没有行号（frontmatter 区块恒缺——它始终是一个块级 replace widget；块级数学 / mermaid 在该块因光标落进其内部而回退为源码时补上）——这是 CM 的 gutter 对 widget 行块的默认行为，本 change 不为它新增 `lineNumberWidgetMarker` 提供者；⑥ 行号开关可在运行期切换（`view.toggle-line-numbers`，见该条），但切换只改 gutter 的在场，不改本命令的落点 / 钳制 / 取消语义；`"off"` 下只有跳转输入条能临时带出 gutter，除此之外没有第三个行号可见面。

#### Scenario: 表的不变量与三条来源的冲突核对

- **WHEN** 装配应用（构造分发器并注入命令实现），并对 `⌥G` 的三条来源逐条复核
- **THEN** 表内无重复绑定、`editor.goto-line` 既有实现也不在默认不绑键清单里，装配不抛错；`Alt-KeyG` 是表内新 token（与 ⌥V / ⌥D / ⌥B / ⌥F 的既有 token 不同）；原生菜单 accelerator 集合里没有 ⌥G（预置项里唯一的 ⌥ 系是 ⌥⌘H）；macOS 系统级不占用 ⌥G——三条结论各自在绑定对象的 `doc` 里可读

#### Scenario: md 模式跳到指定行

- **WHEN** 打开一个 md 文档，按 `⌥G`，在输入条里键入 `n`（`n` 在 `[1, 总行数]` 内）后按 Enter
- **THEN** 光标落在第 `n` 行的行首（不是第 `n` 个视觉行、不是第 `n` 个字符），该行滚到视口居中，且第 `n` 行在 gutter 里的行号就是 `n`（`"off"` 档下 gutter 因输入条在场而临时在场，见「行号 gutter 的两档与跳转临时档」）；文档逐字节不变、dirty 不变、没有写盘；随后按键落在编辑器上（焦点已交还）

#### Scenario: 行号 gutter 的两档与跳转临时档

- **WHEN** 以 `[ui] line_numbers` 的 `"on"` / `"off"` 分别启动应用，各自打开同一份 md 文档（含 frontmatter 区块）与一个只读 code 文件，并在每份文档上按一次 `⌥G` 再收起
- **THEN** `"on"`：md 与 code 的 gutter 都常驻在场，行号 = 源文档逻辑行号（1 基、与 `doc.lines` 同口径）、当前行的行号有高亮而正文行底色不变，输入条的开 / 关不改变在场；`"off"`（默认）：md 与 code 在文档打开时都没有 gutter，按 `⌥G` 后两种模式的 gutter 都临时在场，输入条收起后都重新消失；两档下正文列都仍居中、行号贴正文列左缘且不被裁切，frontmatter 区块覆盖的源行没有行号（块级替换折成 widget 行块的既有边界）

#### Scenario: 取值由配置装载、非法值回落、旧键退场

- **WHEN** 配置文件里 `[ui] line_numbers` 缺失 / 取 `"on"` / 取 `"off"` / 取档外值（如 `"toggle"`）；另一轮写入已退场的 `[ui] markdown_line_numbers`
- **THEN** 缺失时按默认 `"off"` 生效且不产生 warning；取两档内任一值时按该档生效；取档外值时回落 `"off"` 并产生一条人话 warning（与 `ui.theme` 同款）；旧键不参与生效值、不迁移、不双读，携带**非 `null` 值**时只产生一条「该键已退场」的 warning，显式 `null` 与缺席同义、不产生 warning。运行期切换归「行号开关命令（view.toggle-line-numbers）」条：切换即时生效并回写本键，不再是「装载时读一次」的瞬态口径

#### Scenario: code 模式与 md 模式同一行号口径

- **WHEN** 以只读 code 模式打开一个非 md 文件，按 `⌥G` 键入 `n` 后按 Enter；随后把同一份内容以 md 模式打开，重复同一动作（分别在 `"on"` 与 `"off"` 两档下各跑一轮）
- **THEN** 每轮两次落点都是同一行的同一位置（第 `n` 行行首），且与各自模式 gutter 里该行的行号一致（`"on"` 下两模式 gutter 常驻；`"off"` 下两模式的 gutter 在输入条打开期间临时在场，见「行号 gutter 的两档与跳转临时档」）；文档逐字节不变（只读保证不因本命令放宽）；模式只改呈现，不改行号口径

#### Scenario: 输入条预填当前行号与总行数

- **WHEN** 光标停在第 `k` 行时按 `⌥G`
- **THEN** 输入框已预填 `k`（全选态，键入即替换）、提示行显示 `共 M 行`（`M` = `doc.lines`）；输入框只接受数字字符（键入字母不产生字符，输入串仍是原值）

#### Scenario: 越界与零值的钳制

- **WHEN** 在总行数为 `M` 的文档里分别输入 `M + 10` 与 `0`（或直接清空后输入 `0`）后按 Enter
- **THEN** 前者的落点是第 `M` 行（最后一行）的行首、后者是第 1 行的行首；两次都不报错、不加提示、不阻塞，文档逐字节不变

#### Scenario: 空输入、取消与失效路径

- **WHEN** 打开输入条后分别：① 直接按 Enter；② 按 Escape；③ 再打开一次按 `⌃G`；④ 再打开后点浮层之外的区域；⑤ 再打开后按 `⌘1` 切到另一个标签
- **THEN** ① 落在打开时的当前行（无位移，预填值的含义）；② ③ ④ 收起输入条、光标与选区与文档全部不变；⑤ 收起且**不跳转**（前台文档已换，落点行号对它无意义）

#### Scenario: 打开期间再按同键无操作

- **WHEN** 输入条已打开、输入框里已有内容时按下 `⌥G`
- **THEN** 输入条不重复打开、已输入内容不被清空、也没有 Alt 层字符（`©`）被打进输入框；随后仍可正常键入数字并按 Enter 完成跳转

#### Scenario: [keys] 重绑与解绑

- **WHEN** 配置 `{"keys": {"Ctrl-j": "editor.goto-line"}}` 后启动并按 `⌃J`；再以 `{"keys": {"Alt-KeyG": null}}` 启动并按 `⌥G`
- **THEN** 前者照常打开输入条（重绑生效）；后者不打开输入条、该按键落回原生路径（解绑生效）；其余默认绑定逐条不变

#### Scenario: 键位面板与命令清单一致

- **WHEN** 按 `⌘/` 打开键位查看面板
- **THEN** 生效表里出现 `⌥G → editor.goto-line` 一行（带绑定对象的来由说明）；经 `[keys]` 重绑后该行显示用户配置的键位与「用户配置重绑」来由；命令不在「未绑定」行里（它有默认绑定）

### Requirement: 行号 gutter 的右键复制（`{path}:{line}`，随行号开关在场）

在 md 与只读 code 模式下，当行号 gutter（`lineNumbers()`）实际安装且可见时，用户在 gutter 的
可见面上右键，系统 SHALL 把**当前文档路径**与**指针所在行的 1-based 源文档逻辑行号**以精确形式
`{path}:{line}` 写入系统剪贴板：花括号是占位说明，输出 MUST NOT 含字面花括号；路径与行号之间
只有一个 `:`，冒号两侧 MUST NOT 有空格或其它字符。

路径口径 SHALL 复用会话的 `path` 原样——vault 内文档是 **vault 相对路径**（与 modeline 路径段 /
快速打开 / harness 路径链接同一份语义），vault 外只读文档是**绝对路径**（沿用既有外部路径
语义）。实现 MUST NOT 重写、补全、规范化或另算一份路径；MUST NOT 为无路径文档编造路径。
文档没有路径（未命名文档 / 空态）时 MUST NOT 写剪贴板、MUST NOT 显示成功提示，SHALL 走失败
反馈（见下）。

行号口径 SHALL 与 gutter 显示的行号一致：计数单位是 `view.state.doc` 的**源文档逻辑行**（硬换行
分隔、1 基、总行数 = `doc.lines`），软换行（视觉行）MUST NOT 参与计数。右键落在 gutter 的某个
行号元素上时取该行；落在 gutter 的空白处（块级 widget 覆盖的源行没有渲染数字、首行上方或末行
下方的留白）时，按该垂直位置对应的源行处理，边界处自然钳到首行 / 末行。这是 gutter 的
`BlockInfo` 语义，MUST NOT 为它新增第二份「行号 → 位置」映射。

右键复制 MUST NOT 修改文档内容、选区、dirty、撤销栈、模式、行号开关或阅读位置（滚动位置与
滚动快照）；MUST NOT 派发文档事务；MUST NOT 移动焦点。它只写剪贴板并给用户反馈。右键的
`mousedown` 默认行为（辅助键抢焦点）SHALL 被消费：`"off"` 档下由跳转输入条带出的临时 gutter
因此 MUST NOT 在 `focusout` 中先被卸除，焦点 SHALL 保持右键前的归属，右键之后临时 gutter 与输入条
仍在场（直到用户按 Escape 收起）。原生的 `contextmenu` 默认行为 SHALL 被消费（不弹出浏览器 /
系统菜单）。

成功时 SHALL 复用既有 toast 机制（success tone）并逐字显示复制出去的 `{path}:{line}`。剪贴板
不可用、写入被拒（权限拒绝）或文档没有路径时，SHALL 给失败 toast 与一条 console 诊断线索；
MUST NOT 显示成功提示，MUST NOT 静默吞掉失败。成功与失败 MUST NOT 同时出现。

本要求 MUST NOT 改变行号 gutter 的在场合同：`[ui] line_numbers` 的 `"on"` / `"off"` 两档语义与
`⌥G` 的跳转临时 gutter MUST 逐字不变（见「跳转到指定行与行号可见面」与「行号开关命令」两条），开关的
读取 / 回写时机也不变。右键能力只在 `lineNumbers()` 实际安装时存在；`"off"` 档且跳转输入条
未打开时没有 gutter，也就没有本手势（不复制、不反馈）。本要求 MUST NOT 新增命令、键位、配置项、
右键菜单或持久化状态；行号开关命令是另一条 requirement，不属本手势。

#### Scenario: md 模式首行 / 末行复制 vault 相对路径

- **WHEN** 打开一个 vault 内 md 文档（`ui.line_numbers = "on"`，路径含空格与中文），在行号 gutter 的第 1 行与末行上分别右键
- **THEN** 剪贴板分别是 `{path}:1` 与 `{path}:{末行号}`（路径逐字、1 基、无字面花括号）；出现 success tone 的成功提示且逐字包含复制出去的串；文档逐字节不变、dirty 不变、选区与滚动位置不变，原生右键菜单不出现

#### Scenario: code 模式首行 / 末行同一口径

- **WHEN** 打开一个只读 code 模式文本文件（`ui.line_numbers = "on"`），在行号 gutter 的首行与末行上右键
- **THEN** 剪贴板分别是 `{path}:1` 与 `{path}:{末行号}`，成功反馈与零副作用同 md 场景；行号与 gutter 显示的数字一致

#### Scenario: vault 外只读文档沿用绝对路径

- **WHEN** 通过快速打开打开一个 vault 外文件（只读会话，`ui.line_numbers = "on"`），在其行号 gutter 上右键
- **THEN** 剪贴板以该文件的**绝对路径**起头并接 1-based 行号（`/…/name.md:1`），MUST NOT 改写成 vault 相对路径；文档仍只读、逐字节不变、不产生 dirty

#### Scenario: 剪贴板被拒时失败反馈、不假装成功

- **WHEN** 浏览器 / webview 拒绝 `navigator.clipboard.writeText`（权限被拒），用户在行号 gutter 上右键
- **THEN** 出现失败 toast（含失败原因），MUST NOT 出现成功提示；剪贴板内容不变，文档、选区、dirty 与滚动位置均不变

#### Scenario: replace 块与软换行的源行号

- **WHEN** 文档含 frontmatter 块（块级 replace 覆盖的源行没有可见数字）与一条会折成多个视觉行的长行，分别在 frontmatter 的 gutter 空白处、后续正文的可见行号、长行的行号上右键
- **THEN** frontmatter 空白处复制该块起始源行号（如 `{path}:1`），后续正文复制实际源行号（如 `{path}:5`），长行复制源逻辑行号（不是视觉行序号）；文档与选区不变

#### Scenario: 右键不产生撤销步，也不动阅读位置

- **WHEN** 在 code 模式文档上先键入一处修改（文档变 dirty），在行号 gutter 上右键复制，随后按一次撤销；或文档已滚到非首屏位置时右键
- **THEN** 右键前后文档字节与 dirty 状态不变，剪贴板正确；一次撤销只撤销此前那次键入（回到键入前内容与 clean），不撤销右键（右键没有制造历史步）；右键不改变视口，切走再切回时非首屏位置按既有滚动快照恢复（不回篇首）

#### Scenario: `off` 档的临时 gutter 也能复制且不收起输入条

- **WHEN** `ui.line_numbers = "off"`（默认），打开 md 文档后按 `⌥G` 带出行号 gutter（跳转输入条持焦），在 gutter 第 1 行上右键；对只读 code 文件重复同一动作
- **THEN** md 与 code 的剪贴板都是 `{path}:1` 并出现成功提示；跳转输入条仍打开且仍持焦，gutter 仍在场（右键的 mousedown 默认行为被消费，没有触发输入条的 focusout 卸载）；随后按 `Escape` 输入条与 gutter 按既有合同收起

#### Scenario: 开关关闭且输入条未打开时没有 gutter、也没有本手势

- **WHEN** `ui.line_numbers = "off"` 且跳转输入条未打开，打开 md 或 code 文档并在原 gutter 位置右键
- **THEN** 没有行号 gutter，也没有复制动作与成功 / 失败反馈；剪贴板不变；打开跳转输入条后临时 gutter 出现，此时右键复制恢复可用

#### Scenario: 无路径文档不编造路径

- **WHEN** 文档没有路径（未命名 / 空态）而 gutter 在场，用户在 gutter 上右键
- **THEN** 不写剪贴板，出现失败反馈与一条 console 诊断线索（`navigator.clipboard` 未被调用）；MUST NOT 输出 `undefined:{line}`、`: {line}` 或任何编造的路径

### Requirement: 行号开关命令（view.toggle-line-numbers）

行号 gutter 的全局开关 SHALL 由统一键位表分发一条全局命令：`view.toggle-line-numbers`。它 SHALL
进 `NON_TAB_GLOBAL_COMMAND_IDS`（作用域因此机械派生为 `global`——焦点在左栏 / 搜索框 / 浮层 /
harness composer 内时同样命中），MUST NOT 取 `editor.` 前缀（本仓 `editor.` 前缀 = 编辑器作用域
命令，前缀与作用域 MUST NOT 互相打脸）。命令实现 SHALL 落在装配层（`src/main.ts`），并与
modeline 右段的行号指示钮共用同一条实现路径（见 `ui-design-system` 的「行号指示钮」）。

**配置与启动真源**：`[ui] line_numbers` SHALL 取 `"on"` / `"off"`（默认 `"off"`）字符串枚举，
取值由 Rust 侧闭集合校验；非法值 SHALL 回落 `"off"` 并产生一条人话 warning（与 `ui.theme`
同款）。启动装载 SHALL 读一次并施加到全部文档 pane。已退场的 `[ui] markdown_line_numbers`
MUST NOT 被读取为生效值、MUST NOT 迁移、MUST NOT 双读；它携带**非 `null` 值**时 SHALL 只产生
一条「该键已退场、取值被忽略」的启动 warning；显式 `"markdown_line_numbers": null` 与键缺席
同义，MUST NOT 告警。

**运行期单一真源**：`<html data-line-numbers="on|off">` SHALL 是运行期唯一生效面，唯一写入者
SHALL 是同一个施加函数（启动施加与运行期切换共用它）。命令与指示钮 MUST 从该属性读当前值，
MUST NOT 另存第三份「当前开关」状态。切换 SHALL 即时生效到**全部文档 pane 的全部会话**（含
后台标签、后台 pane 与非活跃会话），MUST NOT 要求重启或整窗 reload；切换只改 gutter 的在场，
MUST NOT 改动文档、选区、dirty、撤销栈、模式或阅读位置。

**持久化与失败降级**：切换 SHALL 经通用合并写通道把新值回写 `config.json` 的 `[ui] line_numbers`
（`config_set_ui_value`，其余字段逐键保留）。写回失败 SHALL NOT 阻塞或回滚运行期切换——开关保持
已切换状态，并以 toast 告知「重启后将回到配置文件值」，另记一条诊断日志（与 `ui.theme` /
`ui.language` 同一条降级口径）。开关是全局持久偏好，MUST NOT 按 pane、MUST NOT 按 vault。

**默认键位**：SHALL 是 `⌘⇧N`（token `Cmd-Shift-N`，单段、无空白——用户可经 `[keys]` 重绑 /
解绑；MUST NOT 采用含空白的多段 chord 作默认键位）。键位占用 SHALL 按三条独立来源核实并写进
绑定对象的 `doc`：① 表内（`src/keys.ts` 即真源，⌘⇧N 不在现表）；② 原生菜单 accelerator 集合
（muda 预置项：⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A / ⌘M / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q，不含 ⌘⇧N）；
③ macOS 系统级。第③条 MUST 在实现前实机复核并记录结论；若被系统占用，MUST 停手上报裁决，
MUST NOT 自行改用备选键位。该命令默认有绑定，因此 MUST NOT 进 `KEYLESS_COMMAND_IDS`。

**命令元数据**：`COMMAND_META` SHALL 收录本命令的标签与别名（键位面板与查找共用同一份元数据，
`COMMAND_IDS` 与 `COMMAND_META` 的键集相等由单测守住）。命令标签与指示钮文案 SHALL 走界面文案
表（`ui-language` 的取值列），`on` / `off` 是读数、不译文。

#### Scenario: 默认 off，两个模式都没有 gutter

- **WHEN** 配置文件没有 `[ui] line_numbers`（或显式为 `"off"`）并启动，分别打开一个 md 文档与一个只读 code 文件
- **THEN** 两种模式都没有行号 gutter；`<html data-line-numbers>` 为 `"off"`；modeline 行号指示钮的可见文本为 `off`；`⌥G` 仍能打开跳转输入条（临时 gutter 归「跳转到指定行与行号可见面」条）

#### Scenario: 命令切换即时生效

- **WHEN** 焦点在编辑器内按 `⌘⇧N`（当前为 `off`）
- **THEN** md 与 code 的 gutter 立即出现、行号 = 源文档逻辑行号；`<html data-line-numbers>` 变为 `"on"`；指示钮文本同步变为 `on`；再按一次，gutter 立即消失、属性与钮文本回到 `"off"`；两次切换都不重启、不整窗 reload，文档字节 / dirty / 选区 / 滚动位置不变

#### Scenario: 开关与跳转临时 gutter 的交叉态

- **WHEN** ① 当前 `"on"`，按 `⌥G` 打开输入条后按 `⌘⇧N` 切到 `"off"`，再收起输入条；② 当前 `"off"`，按 `⌥G` 打开输入条后按 `⌘⇧N` 切到 `"on"`，再收起输入条
- **THEN** ① 切到 `"off"` 的瞬间 gutter 仍在场（输入条还开着），收起输入条后卸除；② 切到 `"on"` 后 gutter 保持在场，收起输入条后仍常驻（不因收起而消失）；两种顺序都不改变文档字节、选区与滚动位置

#### Scenario: 焦点不在编辑器内同样命中

- **WHEN** 焦点在左栏文件树、搜索框、大纲浮层或 harness composer 内按 `⌘⇧N`
- **THEN** 开关照常切换（作用域为 `global` 的绑定与焦点无关），当前文档 pane 的 gutter 随之变化

#### Scenario: 指示钮与命令同一条实现

- **WHEN** 点击 modeline 右段的行号指示钮
- **THEN** 与按 `⌘⇧N` 产生逐项相同的效果（属性、gutter、钮文本、配置回写都相同）；改经 `[keys]` 重绑 / 解绑后钮仍可用（它是另一条同源入口）

#### Scenario: 全部 pane 与后台会话同步

- **WHEN** 双 pane（各有一个 md 或 code 前台会话）时按 `⌘⇧N`；或切到标签 A 按 `⌘⇧N` 后再切到后台标签 B
- **THEN** 两个 pane 的前台会话同时变化；切回后台标签 B 时它已是新状态（后台会话经 state 重配，不是切回时才补）

#### Scenario: 新 pane 继承当前值

- **WHEN** 当前为 `"on"` 时执行 `pane.split` 新建一个文档 pane
- **THEN** 新 pane 从第一帧起就有 gutter（它从运行期唯一真源读当前值），与既有 pane 同口径

#### Scenario: 重启后保持

- **WHEN** 切到 `"on"` 并成功回写后退出应用、再启动
- **THEN** 首帧装配置后 md 与 code 都有 gutter，指示钮文本为 `on`——`config.json` 的 `[ui] line_numbers` 是启动真源

#### Scenario: 写回失败不回滚

- **WHEN** 配置写通道失败（磁盘只读 / 权限拒绝）时按 `⌘⇧N` 切到 `"on"`
- **THEN** gutter 保持在场、指示钮保持 `on`、`<html data-line-numbers>` 为 `"on"`；出现 toast 说明「已生效、未写入配置、重启后回落到配置文件值」，并记一条诊断日志；应用其他行为不受影响；再次切换照常工作

#### Scenario: 可重绑与解绑

- **WHEN** 在 `[keys]` 里把 `⌘⇧N` 重绑到另一组合，或把 `view.toggle-line-numbers` 解绑
- **THEN** 重绑后新组合生效、`⌘⇧N` 不再触发；解绑后 `⌘⇧N` 无操作，键位面板（`⌘/`）里该命令显示「未绑定」并给出成因；指示钮仍可用

#### Scenario: 旧键退场与非法值回落

- **WHEN** 配置文件写入 `[ui] markdown_line_numbers = "always"` 且没有 `line_numbers`；另一轮写入 `[ui] line_numbers = "toggle"`；第三轮写入 `"markdown_line_numbers": null` 且没有 `line_numbers`
- **THEN** 第一轮的行号开关为 `"off"`（旧键不参与生效值），并出现一条「`ui.markdown_line_numbers` 已退场、取值被忽略」的 warning；第二轮回落 `"off"` 并出现一条「取值非法」的 warning；第三轮为 `"off"` 且**不产生**任何关于旧键的 warning（显式 `null` 与键缺席同义）；三种情形都不影响 `last_vault` / `[editor]` / `[keys]` 等其它配置

#### Scenario: 无孤儿命令对账不变

- **WHEN** 对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` / `COMMAND_META` 四者
- **THEN** 新命令有默认绑定、不在默认不绑键清单里、在 `COMMAND_META` 里有标签与别名；键位面板的分组里恰有一行（「全局」组经 `NON_TAB_GLOBAL_COMMAND_IDS` 自动收纳，没有落进兜底「其他」组）
