# goto-line-command 增量规格

## ADDED Requirements

### Requirement: 跳转到指定行命令（editor.goto-line）

编辑器 SHALL 提供「按行号定位」的能力，命令 id 为 `editor.goto-line`，实现 SHALL 落在编辑器内核（`src/editor.ts` 的 commands 记录），并 SHALL 经统一键位表（`src/keys.ts` 的 `KEY_BINDINGS` + 分发器）分发——MUST NOT 另开旁路（编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是「统一键位分发表」点名的漂移形态）。

默认键位 SHALL 是 `⌥G`，token MUST 写 `Alt-KeyG`：含 Alt 的组合按物理键（`KeyboardEvent.code`）判定——macOS 的 Alt 层替换字符（⌥G 的 `event.key` 是 `©`），`e.key` 判不出用户按的是哪个键（与既有的 `Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF` 同款口径）。键位占用 SHALL 按三条独立来源核实（表内 / 原生菜单 accelerator / macOS 系统级），结论 SHALL 写在绑定对象的 `doc` 与实现处注释里（表即文档）。作用域 SHALL 随命令归属机械派生为 `editor`（命令 id 属编辑器内核组，前缀与作用域 MUST NOT 互相打脸）：`⌥G` 是「⌥ 系 Emacs 键位集」（M132）的成员，与 ⌃N/⌃P/⌃F/⌃B/⌃E、⌥V、⌥D、⌥⌫ 同族。绑定 SHALL 可经 `[keys]` 重绑 / 解绑：默认键位是单段、无空白，配置层的形态校验因此放行（含空白的 chord 会被拒，见本 requirement 末尾的已知边界）。

行号口径 SHALL 在 md 与只读 code 模式下是**同一条**：计数单位是 `view.state.doc` 的**源文档逻辑行**（硬换行分隔、1 基、总行数 = `doc.lines`），软换行（视觉行）MUST NOT 参与计数——因此两个模式跳到的行号都与各自 gutter 显示的行号一致。**md 模式的行号 gutter SHALL 可配置**：`[ui] markdown_line_numbers` SHALL 取 `"on-demand"`（默认）/ `"always"` / `"off"` 三档之一，取值由 Rust 侧闭集合校验、只管 md；`"on-demand"` 下 gutter SHALL 在 md 文档打开时不在场、在跳转输入条打开时装上、在输入条收起（Enter / Escape / `⌃G` / `focusout` 到浮层之外 / 前台会话切换）时卸除；`"always"` 下 SHALL 常驻在场、与任何命令无关；`"off"` 下 SHALL 恒不在场（输入条打开时也不在场）。**code 模式的行号 gutter SHALL 恒常显、MUST NOT 进这个配置**（Alex 二次改判，2026-09-28：「显示行号是可配置的，markdown 默认不显示、go-to-line 时出现、完成后隐藏。代码默认显示」）。gutter 在场时装的是同一套 `lineNumbers()`（行号即源文档逻辑行号），当前行的行号 SHALL 有高亮（`highlightActiveLineGutter`，只给行号加底、MUST NOT 改正文行的底色）。**装 / 卸 gutter SHALL NOT 改变正文列的几何**——正文列仍居中、行号贴正文列左缘且不被裁切，开关瞬间 `.cm-content` 的实测 rect 逐值不变（判据见 change 的 design §5.2 第 1 条）。本 change MUST NOT 提供**运行期**切换档位的命令 / 键位 / UI：档位 SHALL 在装载时读取一次并生效到全部会话，运行期 MUST NOT 回写。触发命令 SHALL 呈现一个小浮层输入条：输入框 SHALL 预填当前行号（1 基）并全选，SHALL 只接受数字字符（其余按键在输入框内不产生字符），并 SHALL 显示文档总行数（`共 M 行`）——输入条与 md 的 gutter 是行号可见面的两处，modeline 右段不动（它仍只给总行数）。

确认（Enter）SHALL 把光标移到第 n 行行首并把该行滚到视口居中：落点 SHALL 复用编辑器既有的 1-based 行定位原语（`revealLine`，其滚动口径与 `editor.recenter`、wikilink 锚点跳转同为 `scrollIntoView` 的 `y:"center"`），MUST NOT 另写一套落点算式。完成后焦点 SHALL 交还编辑器（后续按键落回文本上下文）。整条路径 MUST NOT 改动文档（ADR 0003 §3）、MUST NOT 进撤销栈、MUST NOT 改 dirty、MUST NOT 触发写盘。

数字的解释与钳制 SHALL 只有一条规则：输入的数字按 `[1, 总行数]` 钳制后的值即落点（Emacs `goto-line` 的 `(forward-line (1- line))` 到头即停口径：越界不报错、停在文档边界）；解析不出数字（空串）时 SHALL 按预填值解释，因此空输入 + Enter 是「停在当前行」。取消（Escape 或 `⌃G`）SHALL 收起输入条且不动光标、不动选区、不动文档；焦点离开输入条（focusout 到浮层之外）与前台会话发生切换（切标签 / 被外部打开请求置换）SHALL 同样收起且**不跳转**——落点行号只对打开时的那份文档有意义，MUST NOT 跨会话跳转。输入条打开期间再按同键 SHALL 就地消费为无操作（不重复打开、不清空已输入内容、不把 Alt 层字符打进输入框）。

输入条自己的键（Enter / Escape / `⌃G` / `⌥G`）MUST NOT 进 `KEY_BINDINGS`：表内一个 token 只能有一条绑定，Escape 已归 `editor.widget-escape`（带 `when` 条件），这些键由输入条就地消费——理由与既有的搜索面板 / 大纲浮层 / vault 切换器同款（作用域判定看事件目标是否在 contentDOM 内，而输入条持有焦点时事件目标在浮层里，表内绑定不命中，两处不构成同一物理键的第二条分发路径）。

已知边界（如实记录，MUST NOT 当成缺陷回头修）：① 焦点不在编辑器内容区时 `⌥G` 不命中（`editor` 作用域的既有边界，与 ⌃N 一族相同）；② 不做 Emacs 的 `goto-line-history`（行号历史）与 `goto-line` 的 `push-mark` 回跳（本仓 v0 无 mark ring）；③ 不做 `M-g` 家族的其它成员（`M-g c` 按字符位置、`M-g TAB` 按列）；④ 输入面只有行号一种语法，不做百分比 / 字符位置 / 列的输入形式；⑤ md 的 gutter 在**被块级替换覆盖的源行**上没有行号（frontmatter 区块恒缺——它始终是一个块级 replace widget；块级数学 / mermaid 在该块因光标落进其内部而回退为源码时补上）——这是 CM 的 gutter 对 widget 行块的默认行为，本 change 不为它新增 `lineNumberWidgetMarker` 提供者；⑥ md 的 gutter 档位只在**装载时**读取、重启生效，没有命令 / 键位 / UI 能在运行期切换（`always` / `off` 并非「随时 toggle」，见 requirement 正文）。

#### Scenario: 表的不变量与三条来源的冲突核对

- **WHEN** 装配应用（构造分发器并注入命令实现），并对 `⌥G` 的三条来源逐条复核
- **THEN** 表内无重复绑定、`editor.goto-line` 既有实现也不在默认不绑键清单里，装配不抛错；`Alt-KeyG` 是表内新 token（与 ⌥V / ⌥D / ⌥B / ⌥F 的既有 token 不同）；原生菜单 accelerator 集合里没有 ⌥G（预置项里唯一的 ⌥ 系是 ⌥⌘H）；macOS 系统级不占用 ⌥G——三条结论各自在绑定对象的 `doc` 里可读

#### Scenario: md 模式跳到指定行

- **WHEN** 打开一个 md 文档，按 `⌥G`，在输入条里键入 `n`（`n` 在 `[1, 总行数]` 内）后按 Enter
- **THEN** 光标落在第 `n` 行的行首（不是第 `n` 个视觉行、不是第 `n` 个字符），该行滚到视口居中，且第 `n` 行在 gutter 里的行号就是 `n`（`on-demand` 档下 gutter 因输入条在场而在场，见「md 模式的行号 gutter 三档」）；文档逐字节不变、dirty 不变、没有写盘；随后按键落在编辑器上（焦点已交还）

#### Scenario: md 模式的行号 gutter 三档

- **WHEN** 以 `[ui] markdown_line_numbers` 的三种取值分别启动应用并打开同一份 md 文档（含 frontmatter 区块）
- **THEN** `"on-demand"`（默认）：打开时没有行号 gutter，按 `⌥G` 打开输入条后 gutter 在场且行号 = 源文档逻辑行号（1 基、与 `doc.lines` 同口径）、当前行的行号有高亮而正文行底色不变，输入条收起后 gutter 重新消失；`"always"`：gutter 常驻在场，与是否按过命令无关，输入条的开 / 关不改变它的在场；`"off"`：任何时刻都没有 gutter（输入条打开时也没有）。三档下正文列都仍居中、行号贴正文列左缘且不被裁切，frontmatter 区块覆盖的源行没有行号（块级替换折成 widget 行块的既有边界）；**装 / 卸 gutter 的瞬间正文列几何逐值不变**（`"on-demand"` 档下用实测 rect 核，宽窗与窄窗各一次）

#### Scenario: 档位由配置装载、不进运行期

- **WHEN** 配置文件里 `[ui] markdown_line_numbers` 缺失 / 取三档内任一值 / 取档外值（如 `"toggle"`）
- **THEN** 缺失时按默认 `"on-demand"` 生效且不产生 warning；取档内值时按该档生效；取档外值时回落 `"on-demand"` 并产生一条人话 warning（与 `ui.theme` 同款）；三档都只在装载时读一次——装载后改配置不改变当前会话，且不存在切换它的命令 / 键位 / UI

#### Scenario: code 模式与 md 模式同一行号口径

- **WHEN** 以只读 code 模式打开一个非 md 文件，按 `⌥G` 键入 `n` 后按 Enter；随后把同一份内容以 md 模式打开，重复同一动作
- **THEN** 两次落点都是同一行的同一位置（第 `n` 行行首），且与各自模式 gutter 里该行的行号一致（code 恒有 gutter；md 的 gutter 在输入条打开期间在场，见「md 模式的行号 gutter 三档」）；文档逐字节不变（只读保证不因本命令放宽）；模式只改呈现，不改行号口径

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
