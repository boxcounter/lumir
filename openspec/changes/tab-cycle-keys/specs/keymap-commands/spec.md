# keymap-commands 增量规格

## MODIFIED Requirements

### Requirement: 标签命令族——关闭 / 循环切换 / 序号直达

系统 SHALL 提供标签命令族，命令 id SHALL 为 `tab.close`、`tab.next`、`tab.prev` 与
`tab.goto-1` … `tab.goto-9`（九条各一个 id：命令层没有参数通道，序号只能落在 id 上，
这样 `[keys]` 配置重绑与键位面板都能如实显示「⌘3 → tab.goto-3」）。作用域一律 SHALL 为
`global`（标签是窗口级对象，焦点在文件树 / 搜索框 / 大纲浮层里时同样要能切，与 ⌘F / ⌘⇧O
同一理由），实现 SHALL 落在装配层（`src/main.ts`），能力（会话与切换）SHALL 在
`src/editor.ts`。

默认绑定 SHALL 为：`⌘W` → `tab.close`、`⌃⇥` → `tab.next`、`⌃⇧⇥` → `tab.prev`、
`⌘}` → `tab.next`、`⌘{` → `tab.prev`、`⌘1`…`⌘9` → `tab.goto-1` … `tab.goto-9`。
`⌘}` / `⌘{` 物理上是 `⇧⌘]` / `⇧⌘[`（US 布局上 `}` / `{` 必须按 Shift；方向映射按
macOS 惯例：`}` 侧 = 下一个、`{` 侧 = 上一个），键位表内的 token 形态 SHALL 是
`Cmd-}` / `Cmd-{`（`{` / `}` ∈ SHIFT_IMPLIED_KEYS，Shift 已隐含在字符里），MUST NOT
写成 `Cmd-Shift-[` / `Cmd-Shift-]`（归一化后永不命中）。同一命令两条绑定（`⌃⇥` 与
`⌘}` 同指 `tab.next`、`⌃⇧⇥` 与 `⌘{` 同指 `tab.prev`）SHALL 走同一个命令实现，
MUST NOT 因触发键不同而行为分叉。全部 SHALL 进 `KEY_BINDINGS` 与
`GLOBAL_COMMAND_IDS`，因此 `[keys]` 配置 SHALL 能像其余命令一样对它们重绑或解绑，
`app.describe-bindings` 面板 SHALL 自动列出它们（面板渲染的是生效表与 `COMMAND_IDS`）；
每条绑定的 `doc` 字段 SHALL 写明取该键的来由与作用域理由。

序号越界（标签数少于序号）SHALL 为无操作——MUST NOT 退化为「跳到最后一个」这类隐式兜底。
`⌃⇥` / `⌃⇧⇥` / `⌘}` / `⌘{` 在标签数少于 2 时 SHALL 为无操作；循环切换在首 / 尾
标签处 SHALL 环绕（末端回卷到第一个、首端回卷到最后一个）。

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

#### Scenario: 键位冲突核对的留痕

- **WHEN** 新增绑定前核对与既有绑定及原生菜单 accelerator 的冲突
- **THEN** 核对结论 SHALL 记在绑定的 `doc` 字段与 change 的 proposal 里，逐键给出三条独立来源（表内 / 原生菜单 accelerator / 系统级）的结论；`⌘W` 的冲突与处置（在 `src-tauri/src/lib.rs` 让出该键）SHALL 一并留痕
