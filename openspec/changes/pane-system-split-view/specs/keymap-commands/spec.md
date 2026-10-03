# keymap-commands 增量规格

> 起草注记（非规格正文）：一条 ADDED，改动面 = ADR 0008 Decision 3 的命令路由泛化
> （`isEditorEvent` 泛化 + 摊平单例 commands 改为按活跃 pane 解析）+ Decision 7 的
> pane 命令族（命令本体规格在 `pane-layout` 的「pane 命令族」条目，本条只写键位与
> 分发表口径）。pane 容器 / 活跃 pane 的行为定义见 `pane-layout`。

## ADDED Requirements

### Requirement: 编辑器命令按活跃 pane 解析

编辑器命令的分发 SHALL 从「装配期把单例 `editor.commands` 摊平进全局命令表」改为
「分发时按**活跃 pane** 解析该 pane 的 `editor.commands`」——每个编辑器命令的实现
MUST NOT 在装配期绑定到某一个 pane 的闭包，活跃 pane 切换后同一命令 SHALL 作用于新的
活跃 pane。活跃 pane 的定义与跟随面见 `pane-layout` 的「活跃编辑器 pane 与焦点解耦」。

editor 作用域的判定（`isEditorEvent`）SHALL 泛化为「事件目标落在**任一**编辑器 pane 的
contentDOM 内（含其中的 widget）」；MUST NOT 保留「等于唯一编辑器 contentDOM」的单例判定。
本次泛化 MUST NOT 放宽 editor 作用域到任意焦点：焦点落在内容区之外的 chrome 上时，
editor 作用域的键 SHALL 照旧不命中（「活跃 pane 不随 chrome 焦点漂移」由活跃 pane 语义承担，
不由作用域放宽承担）。

统一键位分发表的不变量 SHALL 逐条不因本改造而改变：分发仍只有 window keydown 一条路径、
一个 token 一条绑定、每条绑定有归属命令与来由、`COMMAND_IDS` / `KEY_BINDINGS` /
`KEYLESS_COMMAND_IDS` 三者对账、归一化后重复绑定装配期失败、孤儿命令装配期拦下。
对本 requirement 而言「不变」的含义 SHALL 如实记录：单 pane 下全部键位行为与 pane 化之前
逐语义一致（活跃 pane 恒为唯一 pane，解析结果与单例闭包等价）。

#### Scenario: 焦点在哪个 pane，editor 命令就作用于哪个 pane

- **WHEN** 双 pane（A | B），焦点在 B 的 contentDOM，依次按 ⌃A（行首）、⌃K（kill 行）、
  ⌘Z（撤销）
- **THEN** 三个命令都作用于 B 的前台文档；A 的文档、选区、撤销栈逐字节不变

#### Scenario: 活跃 pane 切换后同一键作用于新 pane

- **WHEN** 双 pane，焦点在 A 按 ⌃K 杀掉一行；随后点击 B 的 contentDOM，再按 ⌃K
- **THEN** 第一次 ⌃K 作用于 A 的文档，第二次作用于 B 的文档；kill 槽按 `pane-layout`
  「会话所有权」的全局单例口径跨 pane 生效

#### Scenario: editor 作用域判定落在任一 pane 的 contentDOM

- **WHEN** 双 pane，焦点在 B 的 contentDOM 内的一个块级横滚 widget 上，按 editor 作用域的键
  （如 ⌃A）
- **THEN** 命令经同一分发器执行并作用于 B（widget 焦点委托同一命令层的既有口径不变）；
  A 的 contentDOM 同样在该作用域判定内——焦点在 A 的等价 widget 上按同一键 SHALL 作用于 A

#### Scenario: 焦点在 chrome 上 editor 作用域照旧不命中

- **WHEN** 双 pane，焦点在文件树（或大纲浮层 / 搜索框）里，按 ⌃A
- **THEN** 编辑器状态（两个 pane 的选区与文档）都保持不变，该按键不由本层接管
  （editor 作用域的边界与 pane 化之前一致）

#### Scenario: 单 pane 下行为与现状逐语义一致

- **WHEN** 单 pane 下打开文档，对全部既有 editor 作用域键逐一操作（移动 / 删除 / kill-yank /
  撤销 / 扩选 / 列表缩进 / goto-line）
- **THEN** 每个命令的行为与 pane 化之前逐语义一致（视觉场景与单测照绿，零基线更新）

#### Scenario: 装配期对账不因路由改造而放松

- **WHEN** 装配应用（构造分发器并注入命令实现），并对账 `COMMAND_IDS` / `KEY_BINDINGS` /
  `KEYLESS_COMMAND_IDS` 三者
- **THEN** 表内无重复绑定、每条命令恰好满足「有绑定」或「在默认不绑键清单里」之一、无孤儿
  命令；对账判据与 pane 化之前逐字相同（MUST NOT 因「实现改为运行时解析」而放松）
