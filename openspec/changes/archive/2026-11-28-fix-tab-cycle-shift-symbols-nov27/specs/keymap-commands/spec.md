## MODIFIED Requirements

### Requirement: 标签命令族——关闭 / 循环切换 / 序号直达

系统 SHALL 提供标签命令族，命令 id SHALL 为 `tab.close`、`tab.next`、`tab.prev` 与
`tab.goto-1` … `tab.goto-9`（九条各一个 id：命令层没有参数通道，序号只能落在 id 上，
这样 `[keys]` 配置重绑与键位面板都能如实显示「⌘3 → tab.goto-3」）。作用域一律 SHALL 为
`global`（标签是窗口级对象，焦点在文件树 / 搜索框 / 大纲浮层里时同样要能切，与 ⌘F / ⌘⇧O
同一理由），实现 SHALL 落在装配层（`src/main.ts`），能力 SHALL 在 `src/editor.ts`
（会话 API）与 `src/tabs.ts`（标签栏与切换 / 循环，M151 从装配层抽出）。

默认绑定 SHALL 为：`⌘W` → `tab.close`、`⌃⇥` → `tab.next`、`⌃⇧⇥` → `tab.prev`、
`⌘}` → `tab.next`、`⌘{` → `tab.prev`、`⌘⇧,` → `tab.prev`、`⌘⇧.` → `tab.next`、
`⌘1`…`⌘9` → `tab.goto-1` … `tab.goto-9`。
`⌘}` / `⌘{` 物理上是 `⇧⌘]` / `⇧⌘[`（US 布局上 `}` / `{` 必须按 Shift；方向映射按
macOS 惯例：`}` 侧 = 下一个、`{` 侧 = 上一个），键位表内的 token 形态 SHALL 是
`Cmd-}` / `Cmd-{`（`{` / `}` ∈ SHIFT_IMPLIED_KEYS，Shift 已隐含在字符里）。
**同一物理键的两种事件形态 SHALL 归一到同一 token**（change fix-tab-cycle-shift-symbols-nov27）：
WKWebView 实测给出 `key="]"` / `key="["` + `shiftKey`（合成注入通道；NSEvent `characters` 是未 Shift 的字符；
WebKit `keyForKeyEvent` 在无 Control 时取 `[event characters]`），归一层 SHALL 按 US 布局的
「未 Shift 字符 → Shift 后字符」表（`SHIFTED_SYMBOLS`，与键位面板字形同一来源）把它折成
`Cmd-}` / `Cmd-{`；表内 MUST 仍只写一条绑定，MUST NOT 为同一物理键再写
`Cmd-Shift-]` / `Cmd-Shift-[` 的第二条绑定（`Keymap` 的重复绑定检查会拒绝）。
`⌘⇧,` / `⌘⇧.`（M627）同理：物理键的 Shift 形态是 `<` / `>`，token SHALL 是 `Cmd-<` / `Cmd->`，
未 Shift 字符形态（`key=","` / `key="."` + `shiftKey`）SHALL 归一到同一 token；方向映射取
「`,` 在 `.` 左侧」的直觉（`⌘⇧,` = 上一个、
`⌘⇧.` = 下一个，tower 拟定的假设，待 Alex 验收确认）。同一命令多条绑定（`⌃⇥` / `⌘}` /
`⌘⇧.` 同指 `tab.next`，`⌃⇧⇥` / `⌘{` / `⌘⇧,` 同指 `tab.prev`）SHALL 走同一个命令实现，
MUST NOT 因触发键不同而行为分叉。全部 SHALL 进 `KEY_BINDINGS` 与
`GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它们重绑或解绑，
`app.describe-bindings` 面板 SHALL 自动列出它们（面板渲染的是生效表与 `COMMAND_IDS`）；
每条绑定的 `doc` 字段 SHALL 写明取该键的来由与作用域理由。

序号越界（标签数少于序号）SHALL 为无操作——MUST NOT 退化为「跳到最后一个」这类隐式兜底。
`⌃⇥` / `⌃⇧⇥` / `⌘}` / `⌘{` / `⌘⇧,` / `⌘⇧.` 在标签数少于 2 时 SHALL 为无操作；循环切换在
首 / 尾标签处 SHALL 环绕（末端回卷到第一个、首端回卷到最后一个）。

#### Scenario: 表的不变量在新增绑定后仍成立

- **WHEN** 装配应用（构造分发器并注入命令实现）
- **THEN** 新增绑定后表内仍无重复绑定、每条绑定都有归属命令与来由、清单里没有孤儿命令，装配不抛错

#### Scenario: 序号直达与循环切换在边界上不越界

- **WHEN** 打开的标签数少于按下的序号（如只有 2 个标签时按 ⌘5），或标签数少于 2 时按 ⌃⇥
- **THEN** 前台标签不变，不出现任何隐式兜底跳转

#### Scenario: ⌘} / ⌘{ 与 ⌃⇥ 系同命令同语义

- **WHEN** 打开三个标签且前台是第二个，按 `⌘}`（物理 `⇧⌘]`）一次，再按 `⌘{`（物理 `⇧⌘[`）两次
- **THEN** 第一次后前台切到第三个标签；随后两次依次切到第二个、再回卷到第一个
  （与 `⌃⇥` / `⌃⇧⇥` 走同一条 `tab.next` / `tab.prev` 实现，环绕口径逐字相同）

#### Scenario: 同一物理键的两种事件形态命中同一命令

- **WHEN** 打开三个标签且前台是第一个，依次派发两种形态的 `⌘⇧]` 键按下事件：`key="}"` + `shiftKey`
  （Shift 后形态），以及 `key="]"` + `shiftKey`（WKWebView 实测形态）
- **THEN** 两次都 MUST 归一到 `Cmd-}` 并触发 `tab.next`（前台依次切到第二个、第三个标签）；
  两次之间不得出现「一次命中、一次静默」的差异，也不得因为第二种形态改变 `[keys]` 的重绑口径

#### Scenario: ⌘⇧, / ⌘⇧. 与既有循环键同命令同语义（M627）

- **WHEN** 打开三个标签且前台是第二个，按 `⌘⇧.`（物理 `⇧⌘>`）一次，再按 `⌘⇧,`（物理 `⇧⌘<`）两次
- **THEN** 第一次后前台切到第三个标签；随后两次依次切到第二个、再回卷到第一个
  （与 `⌃⇥` / `⌘}` / `⌃⇧⇥` / `⌘{` 走同一条 `tab.next` / `tab.prev` 实现，环绕口径逐字相同）；
  焦点在 harness composer 内时同样成立（作用域 `global`）

#### Scenario: 键位冲突核对的留痕

- **WHEN** 新增绑定前核对与既有绑定及原生菜单 accelerator 的冲突
- **THEN** 核对结论 SHALL 记在绑定的 `doc` 字段与 change 的 proposal 里，逐键给出三条独立来源（表内 / 原生菜单 accelerator / 系统级）的结论；`⌘W` 的冲突与处置（在 `src-tauri/src/lib.rs` 让出该键）SHALL 一并留痕
