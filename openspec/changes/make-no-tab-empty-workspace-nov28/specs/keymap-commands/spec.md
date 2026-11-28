# keymap-commands 增量规格

> 起草注记（非规格正文）：本 change 后无 Tab 是空工作区。本增量只改「跳转到指定行与行号可见面」
> 里的两处表述——「单 pane 未命名 scratch」不再存在，行号条件按「无标签 pane / 空工作区」表述；
> 另清扫「行号 gutter 的右键复制」里不可达的「有标签 pane 中前台是未命名文档」状态（无路径即空
> 工作区，既无 gutter 也无本手势）。`gutterVisible(hasTabs, …)` 的判据、两档、⌥G 语义与右键复制
> 的其余条款逐字不变。机制见 [design.md](../../design.md)。

## MODIFIED Requirements

### Requirement: 跳转到指定行与行号可见面（editor.goto-line）

编辑器 SHALL 提供「按行号定位」的能力，命令 id 为 `editor.goto-line`，实现 SHALL 落在编辑器内核（`src/editor.ts` 的 commands 记录），并 SHALL 经统一键位表（`src/keys.ts` 的 `KEY_BINDINGS` + 分发器）分发——MUST NOT 另开旁路（编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是「统一键位分发表」点名的漂移形态）。

默认键位 SHALL 是 `⌥G`，token MUST 写 `Alt-KeyG`：含 Alt 的组合按物理键（`KeyboardEvent.code`）判定——macOS 的 Alt 层替换字符（⌥G 的 `event.key` 是 `©`），`e.key` 判不出用户按的是哪个键（与既有的 `Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF` 同款口径）。键位占用 SHALL 按三条独立来源核实（表内 / 原生菜单 accelerator / macOS 系统级），结论 SHALL 写在绑定对象的 `doc` 与实现处注释里（表即文档）。作用域 SHALL 随命令归属机械派生为 `editor`（命令 id 属编辑器内核组，前缀与作用域 MUST NOT 互相打脸）：`⌥G` 是「⌥ 系 Emacs 键位集」（M132）的成员，与 ⌃N/⌃P/⌃F/⌃B/⌃E、⌥V、⌥D、⌥⌫ 同族。绑定 SHALL 可经 `[keys]` 重绑 / 解绑：默认键位是单段、无空白，配置层的形态校验因此放行（含空白的 chord 会被拒，见本 requirement 末尾的已知边界）。

行号口径 SHALL 在 md 与只读 code 模式下是**同一条**：计数单位是 `view.state.doc` 的**源文档逻辑行**（硬换行分隔、1 基、总行数 = `doc.lines`），软换行（视觉行）MUST NOT 参与计数——因此两个模式跳到的行号都与各自 gutter 显示的行号一致。**两个模式的行号 gutter 在场 SHALL 由同一个开关决定**：`[ui] line_numbers` 的 `"on"` / `"off"` 两档（默认 `"off"`；启动真源、运行期切换与持久化的口径见「行号开关命令（view.toggle-line-numbers）」条），取值由 Rust 侧闭集合校验；md 与只读 code MUST NOT 各自再判一套档位，也 MUST NOT 存在「code 恒常显」的例外。**上述两档与 ⌥G 临时档都只在「该文档 pane 有带路径标签」时才成立**（change fix-no-tab-empty-state-nov27）：任一文档 pane 没有带路径标签（含单 pane 与分栏的无标签 pane，即空工作区）时 MUST NOT 显示行号 gutter，`"on"` 档与 ⌥G 打开期间都不例外；有带路径标签进入后按本档恢复。判据 SHALL 是 per-pane 的 `hasTabs`（与标签条 / 空工作区同一定义），并与两个开关合成在**同一个纯函数**里（`src/line-numbers.ts` 的 `gutterVisible`），`src/editor.ts` 的 `gutterExtensions()` 是唯一消费者——别处 MUST NOT 另写一份「无标签 ⇒ 无 gutter」的表达式。`"on"` 下 gutter SHALL 常驻在场、与跳转输入条无关；`"off"` 下 gutter SHALL 在文档打开时不在场，唯一例外是**跳转输入条打开期间 SHALL 临时在场**（md 与 code 一致），输入条收起（Enter / Escape / `⌃G` / `focusout` 到浮层之外 / 前台会话切换）时 SHALL 卸除。gutter 在场时装的是同一套 `lineNumbers()`（行号即源文档逻辑行号），当前行的行号 SHALL 有高亮（`highlightActiveLineGutter`，只给行号加底、MUST NOT 改正文行的底色）。**装 / 卸 gutter 的几何 SHALL 按窗口分两档**：① md 的任意窗口宽度、以及 code 左侧余量足以容纳 gutter 的窗口（判据取 1200px 定窗）——正文列仍居中、行号贴正文列左缘且不被裁切，开关瞬间 `.cm-content` 的实测 rect 逐值不变；② code 左侧余量不足的窗口——允许正文列左移一个 gutter 宽，但 MUST NOT 出现横向滚动、MUST NOT 裁切行号，正文从 gutter 右缘起排（边界见 design §4.2）。触发命令 SHALL 呈现一个小浮层输入条：输入框 SHALL 预填当前行号（1 基）并全选，SHALL 只接受数字字符（其余按键在输入框内不产生字符），并 SHALL 显示文档总行数（`共 M 行`）——输入条与 gutter 是行号可见面的两处；modeline 的 meta 段仍只给总行数，行号开关的指示钮是新增的独立 requirement（`ui-design-system` 的「行号指示钮」），MUST NOT 把行号读数塞进 meta。

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
- **THEN** `"on"`：md 与 code 的 gutter 都常驻在场，行号 = 源文档逻辑行号（1 基、与 `doc.lines` 同口径）、当前行的行号有高亮而正文行底色不变，输入条的开 / 关不改变在场；`"off"`（默认）：md 与 code 在文档打开时都没有 gutter，按 `⌥G` 后两种模式的 gutter 都临时在场，输入条收起后都重新消失；几何按窗口分两档（与本条 P3 的 `⌥G` 命令口径一致）：md 任意宽度与 code 左侧余量充足的宽窗下正文列仍居中、行号贴正文列左缘且不被裁切、开关瞬间 `.cm-content` 的实测 rect 逐值不变；code 左侧余量不足的窄窗允许正文列左移一个 gutter 宽，但 MUST NOT 出现横向滚动、MUST NOT 裁切行号（边界见 design §4.2 / §10.1）；frontmatter 区块覆盖的源行没有行号（块级替换折成 widget 行块的既有边界）

#### Scenario: 无带路径标签的文档 pane 没有行号（含 ⌥G 临时档）

- **WHEN** `[ui] line_numbers = "on"`，依次观察：① 单 pane 的无标签空工作区；② 分栏后无标签的空 pane；随后在空 pane 打开一份带路径文档
- **THEN** ① 与 ② 都没有行号 gutter（`on` 档不覆盖 per-pane 的「无标签」条件）；空工作区的正文不是焦点落点，`⌥G` 因此没有编辑器目标（焦点在主操作上时不打开输入条）；打开文档后，该 pane 立即按 `"on"` 档恢复行号，行号与源文档逻辑行号一致；全程 MUST NOT 改动文档、dirty、选区或阅读位置

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
无路径的空工作区没有 gutter、也没有本手势（见下面「无标签 pane 没有 gutter」Scenario）；实现的
失败兜底 MUST NOT 为无路径编造路径——该分支是防再犯的兜底，正常产品路径不可达。

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
不可用或写入被拒（权限拒绝）时，SHALL 给失败 toast 与一条 console 诊断线索；
MUST NOT 显示成功提示，MUST NOT 静默吞掉失败。成功与失败 MUST NOT 同时出现。

本要求 MUST NOT 改变行号 gutter 的在场合同：`[ui] line_numbers` 的 `"on"` / `"off"` 两档语义与
`⌥G` 的跳转临时 gutter MUST 逐字不变（见「跳转到指定行与行号可见面」与「行号开关命令」两条），开关的
读取 / 回写时机也不变。右键能力只在 `lineNumbers()` 实际安装时存在；`"off"` 档且跳转输入条
未打开时没有 gutter，也就没有本手势（不复制、不反馈）。**没有带路径标签的文档 pane 本来就没有
gutter**（per-pane `hasTabs` 条件，见同两条），因此其原位置右键同样没有本手势——本要求不新增
第二处「无标签」判断。本要求 MUST NOT 新增命令、键位、配置项、
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

#### Scenario: 无标签 pane 没有 gutter、也没有本手势

- **WHEN** `ui.line_numbers = "on"`，关掉某文档 pane 的最后一个标签（或分栏得到一个空 pane），在原来的行号列位置右键；再在该 pane 打开一份带路径文档后重复
- **THEN** 空 pane 没有行号 gutter，原位置右键不写剪贴板、不出现成功 / 失败反馈、不产生 console 诊断；打开文档后 gutter 按 `"on"` 档恢复，同一位置右键恢复既有的复制行为与反馈

#### Scenario: 开关关闭且输入条未打开时没有 gutter、也没有本手势

- **WHEN** `ui.line_numbers = "off"` 且跳转输入条未打开，打开 md 或 code 文档并在原 gutter 位置右键
- **THEN** 没有行号 gutter，也没有复制动作与成功 / 失败反馈；剪贴板不变；打开跳转输入条后临时 gutter 出现，此时右键复制恢复可用

#### Scenario: 无路径文档不编造路径

- **WHEN** 某个 pane 的前台是空工作区（`path` 缺失、结构性只读），用户在原行号列位置右键（正常产品路径下没有 gutter，本 Scenario 只钉「不得编造路径」的兜底）
- **THEN** 没有本手势：不写剪贴板、不出现成功 / 失败反馈、不产生 console 诊断；实现即使被防御性调用也 MUST NOT 输出 `undefined:{line}`、`: {line}` 或任何编造的路径
