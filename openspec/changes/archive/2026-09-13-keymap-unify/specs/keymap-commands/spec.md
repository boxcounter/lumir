# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 统一键位分发表

全应用的键位绑定 SHALL 收敛为唯一一张 key → command 表（`src/keys.ts` 的 `KEY_BINDINGS`），每条绑定 SHALL 标注作用域与归属命令，并 SHALL 附一句来由说明（表即文档）。作用域取值只有两种：`global`（任意焦点都生效）与 `editor`（事件目标落在编辑器内容区内才生效，含其中的 widget）。绑定 SHALL 全平台无条件生效（表内不做平台门）：当前运行目标只有 macOS（Tauri 桌面），跨平台日期未定，无测试覆盖的平台分支只会成为死代码；迁移前的两处平台门因此消失且 SHALL 被如实记录——⌃N/P/F/B/E 原为 mac-only（`{ mac: "Ctrl-n" }`）现对全部平台生效（⌃N 在部分桌面环境是系统级「新建」惯例），`Mod-Enter` 迁为 `⌘Enter` 后非 mac 的 Ctrl-Enter 变体不再存在。将来引入跨平台目标时 SHALL 重新引入平台门（给 ⌃ 系绑定加平台维度，或把 ⌃N 一类让回系统惯例）。命令实现 SHALL 按归属留在各自模块（编辑器侧命令在 `src/editor.ts`，文档与链接命令在装配层 `src/main.ts`），并 SHALL 由装配处注入分发器。

分发 SHALL 只有一条路径：一个挂在 window 上的 keydown 分发器。MUST NOT 存在并列的键位旁路——编辑器 keymap、`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是同一组合多处漂移的成因（⌘A/⌃A 曾都当全选、⌘S/⌃S 曾都当保存）。表内的每条命令 SHALL 至少有一条绑定，每条绑定 SHALL 有归属命令；归一化后重复的绑定 SHALL 在装配期直接失败（MUST NOT 让后注册者静默覆盖前者，也 MUST NOT 让缺实现的绑定静默失效）。

分发器 SHALL 对已经消费的事件让路（`defaultPrevented` 直接返回且不改 chord 状态），SHALL 在输入法组合期（`isComposing` 或 keyCode 229）不接管，并 SHALL 在命中绑定时吞掉默认行为——命令本身无事可做时同样吞掉（例如撤销栈为空时的 ⌘Z），MUST NOT 把按键放回原生 contenteditable 路径。

#### Scenario: 表的不变量

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

#### Scenario: editor 作用域不越界

- **WHEN** 焦点不在编辑器内（例如焦点在页面其它区域）时按下 editor 作用域的键（如 ⌃A）
- **THEN** 编辑器状态（选区与文档）保持不变，该按键不由本层接管

#### Scenario: global 作用域不受焦点影响

- **WHEN** 焦点不在编辑器内时按下 ⌘S
- **THEN** 保存照常按保存链路执行（作用域为 global 的绑定与焦点无关）

#### Scenario: widget 焦点委托同一命令层

- **WHEN** 焦点落在编辑器内的 widget（表格滚动容器）上时按下 editor 作用域的键（如 ⌃A）
- **THEN** 命令经同一分发器执行、作用于 CM 的当前选区；widget 自己的焦点作用域键（Escape / Home / End / 左右方向键）仍由该 widget 现有手柄先消费，本层对已消费事件让路

### Requirement: ⌘ 与 ⌃ 分离

键位 token SHALL 逐修饰键记录（Cmd / Ctrl / Alt / Shift），MUST NOT 把 ⌘（metaKey）与 ⌃（ctrlKey）合并为同一修饰。⌘ 系绑定 SHALL 遵循 macOS 惯例，⌃ 系 SHALL 遵循 Emacs 惯例。归一化 SHALL 与运行期事件同源：表内写法与事件 token 走同一归一化函数，修饰前缀顺序与大小写无关。两类字符陷阱 SHALL 有明确口径：US 布局上需 Shift 才能打出的符号（如 `_`）按「Shift 已隐含在字符里」归一（⌃_ 在 mac 键盘上物理是 ⌃⇧-，表内写 `Ctrl-_` 即可匹配）；含 Alt 的组合 SHALL 按物理键（`KeyboardEvent.code`）判定——macOS 的 Alt 层会替换字符（⌥⇧- 给的是 `—`、⌥a 给的是 `å`），`e.key` 判别不了用户按的键，⌃⌥_ 这类别名因此以物理键名入表（`Ctrl-Alt-Minus`）。纯修饰键 SHALL NOT 参与键位判定。

绑定裁决：`⌘A` = 全选（D2）；`⌃A` = 行首（D2，Emacs `C-a`，与 ⌃E 行尾对称）；`⌘S` = 保存唯一键（D3）；`⌃S` SHALL 解绑（预留给 isearch），MUST NOT 触发保存。

#### Scenario: ⌃A 到行首、⌘A 全选

- **WHEN** 光标停在某正文行中段，按下 ⌃A
- **THEN** 光标折叠到该行行首（不形成选区、不全选）；随后按下 ⌘A 才选中整篇文档

#### Scenario: ⌘S 与 ⌃S

- **WHEN** 文档 dirty 时按下 ⌃S，再按下 ⌘S
- **THEN** ⌃S 不产生任何写入、dirty 不变、无保存反馈；⌘S 走保存链路落盘并清除 dirty

### Requirement: 编辑器光标命令的硬化底座

所有光标移动命令 SHALL 建在既有 widget 硬化原语上：caret 与滚动按可见侧取 assoc、`scrollIntoView` 传 SelectionRange 而非裸位置、坐标测量退化时回退、跨块级原子 widget 时钳制落点。MUST NOT 换用 CM stock 光标命令，也 MUST NOT 把按键留给原生 contenteditable 路径（M103 垂直移动、M110/M111 水平移动、M113/M118 表格与公式边界的缺陷族同根因）。键位来源变更（从 CM keymap 迁入统一表）MUST NOT 改变既有移动语义。

行首命令 SHALL 与行尾命令对称：同取文本行边界（硬边界，段落语义，不受软换行截断），落点紧贴隐藏 replace（表格管道符、块级公式边界）时按可见侧测量，避免揭示滚动把整窗内容拉偏。

#### Scenario: 既有 6 键行为不变

- **WHEN** 在表格围绕的文档中用 ⌃N/⌃P/⌃F/⌃B/⌃E 与 ArrowUp/ArrowDown 移动光标
- **THEN** 落点、跨表格路由、列位保持与滚动揭示与迁移前逐场景一致（既有视觉场景全绿、零基线更新）

#### Scenario: ⌃A 落点在隐藏内容邻接位

- **WHEN** 光标在 grid 表格行内，按下 ⌃A
- **THEN** 光标落在该表格行的可见行首（行内第一个可测量位置：隐藏管道符零宽，视觉位置即首 cell 起点），坐标不退化且不出现整窗内容下挫

### Requirement: 撤销与重做

编辑器 SHALL 提供撤销与重做能力，撤销栈由 CM 的 history 扩展持有（线性双栈 `done` / `undone`，暂不提供 Emacs 链式 undo）。绑定：`⌘Z` = 撤销、`⌘⇧Z` = 重做、`⌃/` = 撤销（Emacs 规范绑定）、`⌃_` = 撤销（Emacs 别名）、`⌃⌥_` = 重做（Emacs 系别名）。同一命令 SHALL 既是键盘路径也是菜单路径的落点。

文档装载事务（打开文件、外部重载、vault 复位产生的整篇替换）SHALL NOT 进入撤销史，且 SHALL 使被替换掉的旧撤销事件失效——撤销 MUST NOT 跨文档把上一个文档的内容搬进当前文档。撤销 / 重做产生的文档变化 SHALL 与保存链路保持一致：dirty SHALL 仍以「当前文本与已保存基线比较」判定，因此撤销回到已保存内容时 dirty SHALL 收窄为 false；撤销 / 重做 SHALL 照常参与自动保存 debounce 与 dirty 守卫。

#### Scenario: 撤销回到已保存内容

- **WHEN** 打开一个已保存文件，输入若干字符使文档 dirty，然后按下 ⌘Z
- **THEN** 文档回到打开时的内容，dirty 收窄为 false（masthead 未保存标记与后端 dirty 镜像一并复位）

#### Scenario: Emacs 别名与重做

- **WHEN** 输入后依次按下 ⌃/（撤销）、⌃⌥_（重做）
- **THEN** 文档先回到输入前，再恢复到输入后；⌃_ 与 ⌘⇧Z 同样分别产生撤销与重做

#### Scenario: 撤销不跨文档

- **WHEN** 在文件 A 中编辑并保存后切换到文件 B，然后按下 ⌘Z（或 ⌘⇧Z）
- **THEN** 文件 B 的内容保持不变，不出现文件 A 的内容被"撤"进 B 的情况

#### Scenario: 只读模式下撤销无事发生

- **WHEN** 当前文档以只读 code 模式打开（M130 方向 A）时按下 ⌘Z
- **THEN** 文档内容不变（只读保证不因撤销能力而放宽）

### Requirement: 菜单与命令层一致

macOS 原生菜单 MUST NOT 提供第二套撤销：Edit 子菜单 MUST NOT 保留直连原生 responder chain 撤销栈的预置 Undo/Redo 项（Lumir 的文档由编辑器内核持有，撤销栈只有一份）。菜单的撤销 / 重做入口 SHALL 经事件交回前端同一命令层执行，MUST NOT 自带 accelerator——⌘Z / ⌘⇧Z SHALL 留给 webview 的 keydown 路径由统一键位层接管，使键盘与菜单两条路进同一个命令实现。

菜单改造 SHALL 对 tauri 默认菜单结构做校验：结构假设不成立时 SHALL 保持默认菜单不改动并留下可诊断的告警，MUST NOT 静默产生半改造的菜单（例如改了撤销项却丢掉退出守卫）。

#### Scenario: 菜单不占 ⌘Z

- **WHEN** 应用启动完成（macOS）
- **THEN** Edit 子菜单的撤销 / 重做项为自定义项且不带 accelerator；⌘Z / ⌘⇧Z 由统一键位层处理，菜单点击经事件通道落到同一命令实现

#### Scenario: 结构假设不成立时的降级

- **WHEN** tauri 升级改动了默认菜单结构（app 子菜单、Edit 子菜单或预置项文案不匹配）
- **THEN** 对应改造整体跳过、保留默认菜单，并输出告警；退出守卫与撤销项之间不出现互相覆盖
