# keymap-commands delta（change fix-text-input-select-all-nov26）

## MODIFIED Requirements

### Requirement: 统一键位分发表

全应用的键位绑定 SHALL 收敛为唯一一张 key → command 表（`src/keys.ts` 的 `KEY_BINDINGS`），每条绑定 SHALL
标注作用域与归属命令，并 SHALL 附一句来由说明（表即文档）。作用域取值有**三种**：`global`（任意焦点都生效）、
`editor`（事件目标落在编辑器内容区内才生效，含其中的 widget）与 **`text`（文本面：事件目标落在编辑器内容区内
**或** harness 面板的 composer 输入区内才生效）**。作用域 SHALL 由命令归属**机械派生**，且派生 SHALL 只有一处
实现（默认表的对账、装配期校验、配置覆盖三处共用同一函数）——`text` 面的命令族 SHALL 恰为「在 composer 内同
样成立的文本编辑命令」那一族（Emacs 文本导航族，见 harness 的「composer 的 Emacs 文本导航族」，加上全选
`editor.select-all`——M627：composer 是混排 contenteditable，引擎原生 selectAll 选不到全文，⌘A 必须由本层
按面分派，见 harness 的「composer 的全选」），其余编辑器命令仍派生为 `editor`，其余命令仍派生为 `global`。
`text` 面里另有**一条附加面**（change fix-text-input-select-all-nov26）：`editor.select-all` 的绑定 SHALL 由命令清单
`NATIVE_INPUT_HOST_COMMAND_IDS` 派生一个 `inputHosts` 标记（MUST NOT 在绑定表里手写；清单与绑定表由单测双向
对账），分发器对带该标记的 `text` 绑定 SHALL 在原生输入宿主（`input` / `textarea` / contenteditable）内同样命中
——⌘A 是平台级全选动作，落面是「当前聚焦的那个输入面」，与它是不是 CM 面无关。族内其余命令 MUST NOT 因这条
附加面放宽到原生宿主（它们的实现作用于编辑器文档）。附加面不改派生结果：`scopeOfCommand` 仍是三值，
`editor.select-all` 仍派生为 `text`。`text` 作用域的命令实现 SHALL 按事件目标所属的**面**分派
（编辑器内容区内 → 编辑器侧实现；composer 内 → composer 侧实现），分派 SHALL 收口在**一处**装配层包装——
MUST NOT 每条命令各写一份面判定。`editor.select-all` 是同一收口的另一形态：它的落面比两处 CM 面宽（含原生
输入宿主），由装配层的 `selectAllAt` 一处分派（键盘按事件目标、菜单按当前焦点），MUST NOT 在浮层 / 输入框里
各写一份就地分支。`editor` 作用域的命令 MUST NOT 因本增量放宽：焦点在 composer 内时它们照旧
不命中（越界边界不放宽到 composer）。绑定 SHALL 全平台无条件生效（表内不做平台门）：当前运行目标只有 macOS
（Tauri 桌面），跨平台日期未定，无测试覆盖的平台分支只会成为死代码；迁移前的两处平台门因此消失且 SHALL 被
如实记录——⌃N/P/F/B/E 原为 mac-only（`{ mac: "Ctrl-n" }`）现对全部平台生效（⌃N 在部分桌面环境是系统级
「新建」惯例），`Mod-Enter` 迁为 `⌘Enter` 后非 mac 的 Ctrl-Enter 变体不再存在。将来引入跨平台目标时 SHALL
重新引入平台门（给 ⌃ 系绑定加平台维度，或把 ⌃N 一类让回系统惯例）。命令实现 SHALL 按归属留在各自模块
（编辑器侧命令在 `src/editor.ts`，文本面在 composer 内的实现由 harness 面板提供，文档与链接命令在装配层
`src/main.ts`），并 SHALL 由装配处注入分发器。

分发 SHALL 只有一条路径：一个挂在 window 上的 keydown 分发器。MUST NOT 存在并列的键位旁路——编辑器 keymap、
`domEventHandlers`、裸 window 监听各注册一份同一物理组合，是同一组合多处漂移的成因（⌘A/⌃A 曾都当全选、
⌘S/⌃S 曾都当保存）。`text` 作用域**不构成例外的旁路**：同一物理键在编辑器与 composer 两处 SHALL 共用**同一条
绑定**（作用域覆盖两个面、实现在面内分派），MUST NOT 为 composer 另立第二条同 token 绑定。浮层 / 内联编辑 /
设置里的原生输入框同样 MUST NOT 各自就地处理 ⌘A（本地 `case "Cmd-A"` 或 `input.select()` 副本）——它 SHALL 由
本表这一条绑定按输入面统一分派（合同 `docs/specs/text-input-faces.md` 的 T1–T3）；新增原生文本输入面因此
MUST NOT 需要新增分派分支。每条绑定 SHALL 有
归属命令；每条命令 SHALL 要么至少有一条绑定，要么登记在默认不绑键清单里（`src/keys.ts` 的
`KEYLESS_COMMAND_IDS`）——两者皆不占的命令即孤儿命令，SHALL 由装配期校验拦下。这份清单是「默认不绑键」的
**显式出口**，不是判据的放松：清单项 MUST NOT 同时出现在 `KEY_BINDINGS` 里（否则清单在说谎），清单 MUST NOT
含 `COMMAND_IDS` 之外的 id，且「有实现但既不绑键也没登记」的命令 MUST NOT 通过校验——M131 要消灭的正是
「命令实现了但没人绑」那种静默状态，本版把它的反面（有意的默认不绑键）变成要签字的决定。归一化后重复的绑定
SHALL 在装配期直接失败（MUST NOT 让后注册者静默覆盖前者，也 MUST NOT 让缺实现的绑定静默失效）——这条对
`text` 作用域同样成立：作用域是**命令的属性**，不是给同一 token 开第二条绑定的口子。

分发器 SHALL 对已经消费的事件让路（`defaultPrevented` 直接返回且不改 chord 状态），SHALL 在输入法组合期
（`isComposing` 或 keyCode 229）不接管，并 SHALL 在命中绑定时吞掉默认行为——命令本身无事可做时同样吞掉
（例如撤销栈为空时的 ⌘Z），MUST NOT 把按键放回原生 contenteditable 路径。

配置与面板的覆盖面 SHALL 随作用域机械生长：`[keys]` 的覆盖（重绑 / 解绑）对 `text` 面命令与其余命令一视同仁
（作用域按命令派生，重绑后不变），键位查看面板 SHALL 列出生效表里的 `text` 面命令（分组仍是**功能族**这一
呈现层概念，MUST NOT 因新增作用域而改变作用域语义）。

#### Scenario: 表的不变量

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 表内无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令（每条命令都有绑定或已在默认不绑键
  清单里登记），装配不抛错；每条绑定的作用域与它的命令归属一致（由同一个派生函数判定）

#### Scenario: 默认不绑键的命令是显式登记

- **WHEN** 对账 `COMMAND_IDS`、`KEY_BINDINGS` 与 `KEYLESS_COMMAND_IDS` 三者
- **THEN** 每条命令恰好满足「有绑定」或「在清单里」之一；清单里没有 `COMMAND_IDS` 之外的 id；清单与绑定表无
  交集（同一命令不会既声明默认不绑键又带着默认绑定）；把这两类对账任一处破坏，校验即失败（判据 MUST NOT
  退化成「只要没崩就算过」）

#### Scenario: editor 作用域不越界

- **WHEN** 焦点不在编辑器内（例如焦点在页面其它区域、或 harness 面板的 composer 输入区内）时按下 `editor`
  作用域的键（如 ⌥G）
- **THEN** 编辑器状态（选区与文档）保持不变，该按键不由本层接管

#### Scenario: text 作用域在两个文本面上各归其位

- **WHEN** 光标在编辑器里按 ⌃A，随后把焦点移进 harness composer 再按 ⌃A
- **THEN** 第一次落点是编辑器当前行的行首（编辑器行为与本增量之前逐条一致）；第二次落点是 composer 内当前
  逻辑行的行首，**编辑器状态同时保持不变**（面内分派互不串台）

#### Scenario: 同一 token 不因作用域而变成两条绑定

- **WHEN** 对账 `KEY_BINDINGS` 里归一到同一序列的绑定（前缀拼写、大小写、Shift 隐含符都归一后）
- **THEN** 每条 token 仍只有一条绑定；给 `text` 面命令另加一条同 token 的 composer 绑定会被装配期以「重复
  绑定」拦下（MUST NOT 静默保留其一）

#### Scenario: ⌘A 在原生输入宿主上由同一分派接管

- **WHEN** 焦点在浮层筛选框 / 文件树内联编辑框 / 设置文本框等原生输入宿主内按下 ⌘A，随后把焦点移回编辑器再按 ⌘A
- **THEN** 第一次选中该输入宿主的全部输入内容（`defaultPrevented` 为真，编辑器文档与选区不变）；第二次选中整篇
  文档；两处都不存在第二份就地实现（静态对账：除两个只读全屏遮罩外，源码里没有本地 `Cmd-A` 处理）

#### Scenario: global 作用域不受焦点影响

- **WHEN** 焦点不在编辑器内时按下 ⌘S
- **THEN** 保存照常按保存链路执行（作用域为 global 的绑定与焦点无关）

#### Scenario: widget 焦点委托同一命令层

- **WHEN** 焦点落在编辑器内的 widget（表格滚动容器）上时按下 editor 作用域的键（如 ⌃A）
- **THEN** 命令经同一分发器执行、作用于 CM 的当前选区；widget 自己的焦点作用域键（Escape / Home / End /
  左右方向键）同样经统一键位表分发——`Escape` / `Home` / `End` 以 `when` 条件限定在 widget 焦点时命中，
  `←` / `→` 自 M795 起绑在水平移动命令上、容器滚动作为该命令的焦点分支（一条 token 一条绑定；
  可观察行为不变：容器持焦时滚动、文本里移光标）

### Requirement: ⌘A 归文本面——原生菜单全选项让出该加速键（M627）

macOS 原生 `Menu::default()` 的 Edit 子菜单里的**预置** Select All 项自带 `⌘A`
key equivalent，菜单键等价在 NSApplication 分发阶段就被截获，webview 的 keydown 收不到该键。
系统 SHALL 在 `src-tauri/src/lib.rs` 把该预置项换成**不带加速键**的自定义菜单项（与 ⌘Z / ⌘W
的让位同一先例），点击经 `app:menu_command` 交回前端，由前端落到同一个全选命令。

`⌘A` SHALL 由统一键位层按**输入面**分发（change fix-text-input-select-all-nov26）：焦点在编辑器内容区内 →
编辑器全选；焦点在 harness composer 内 → composer 全选（见 harness 的「composer 的全选」）；焦点在原生输入
宿主（`input` / `textarea` / contenteditable）内 → 选中该宿主的全部内容（调用宿主自身的全选并 `preventDefault`
显式接管）；焦点不在任何可编辑文本宿主内 → 不消费该键。落面判定 SHALL 只有一处装配层实现（`selectAllAt`），
键盘按事件目标、菜单按当前焦点走同一个函数；输入面 MUST NOT 各自就地处理该键（合同
`docs/specs/text-input-faces.md` 的 T1–T3）。菜单点击没有键盘事件可判面，SHALL 按**当前焦点**路由到
同一个命令——焦点在原生输入宿主时选中其内容，composer 持焦时选 composer 全文，其余情况选编辑器全文
（与让位前的原生行为等价）。
菜单手术的结构性假设（Edit 子菜单存在、末位项确为预置 Select All、文案匹配）SHALL 在替换前
校验，校验失败时保留默认菜单不改动并打 stderr 警告。

#### Scenario: 键盘与菜单两条路进同一个命令

- **WHEN** 焦点在 composer 内，分别按 `⌘A` 与点击 Edit 菜单的 Select All
- **THEN** 两条路都选中 composer 的全部块（含原子卡片）；焦点在编辑器内时两条路都选中整篇文档

#### Scenario: 原生输入宿主里的 ⌘A 不被编辑器截走

- **WHEN** 文件树内联重命名的输入框持焦（已有输入串），按 `⌘A` 或点击 Edit 菜单的 Select All
- **THEN** 两条路都选中输入框内的全部输入内容，编辑器文档与选区不变；键盘路径的 `defaultPrevented` 为真

#### Scenario: 焦点不在文本面时不抢焦点

- **WHEN** 焦点在文件树行 / 按钮等非可编辑元素上按下 `⌘A`
- **THEN** 本层不消费该键、不改变任何面的选区（`defaultPrevented` 为假）

#### Scenario: 结构假设不成立时不动菜单

- **WHEN** 默认菜单里找不到 Edit 子菜单，或其末位项不是文案为 `Select All` 的预置项
- **THEN** 该子菜单不被改动、打一条 stderr 警告，其余菜单改造照常进行
