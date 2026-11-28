# keymap-commands 增量规格

> 起草注记（非规格正文）：本 change 后无 Tab 是空工作区。本增量只改「跳转到指定行与行号可见面」
> 里的两处表述——「单 pane 未命名 scratch」不再存在，行号条件按「无标签 pane / 空工作区」表述；
> `gutterVisible(hasTabs, …)` 的判据、两档与 ⌥G 语义逐字不变。机制见 [design.md](../../design.md)。

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

