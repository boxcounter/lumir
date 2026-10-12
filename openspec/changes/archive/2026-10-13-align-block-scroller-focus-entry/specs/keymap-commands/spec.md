# keymap-commands 增量规格

## MODIFIED Requirements

### Requirement: 轨道 D 的 widget 滚动键纳入统一键位表

块级横滚容器（livePreview 的 grid 表格 widget、以及围栏 / 缩进代码块的横滚容器，`tabindex=0`）的
焦点作用域键——`←`、`→`、`Home`、`End`、`Escape`——SHALL 由统一键位表分发，MUST NOT 在
`livePreview.ts` 保留并列的 keydown 手柄（同一物理组合两处各写一份即 M131 要消灭的旁路形态）。

这些物理键在文本编辑中另有语义（原生 caret / 行首尾 / 取消），故绑定 SHALL 带**命中条件**；条件
不满足时 SHALL NOT 消费事件（不 `preventDefault`），文本编辑中的同名键 SHALL 照旧走原生路径。
命中条件 SHALL 表达「容器自身持有这次按键的焦点」，且 SHALL 只此一处实现、由所有块级横滚容器共用
（判据的 class 集合与 `closest(...)` 判定 SHALL 单一来源于 `src/keys.ts`）：新增一种容器时 MUST NOT
各写一份判定——同语义两处真源正是归档后会漂移的那种缺口。命令 SHALL 接收触发事件以定位事件目标，
MUST NOT 依赖全局焦点猜测。行为 SHALL 与迁移前一致：左右各 120px 步进、`Home` 横向回最左、`End`
横向到最右、`Escape` 把焦点交还编辑器。

**焦点入口（M474 起）**：编辑器内容区里的 `Tab` 已被列表缩进命令 `editor.list-indent` 接管
（见本 spec 的「列表项缩进键（TAB / SHIFT+TAB）」requirement，Alex 裁决 D1a）⇒ 从编辑器按 `Tab`
走原生焦点遍历这条入口不再存在。M474 因此新增**有默认绑定**的编辑器命令 `editor.focus-block-scroll`
（`⌃⌥S`）：它把焦点交给**当前光标所在块的块级横滚容器**（表格容器与围栏 / 缩进代码块的横滚容器同
判据）；光标不在任何块内、或所在块没有容器（`editor.code_block_wrap = true` 的折行档）时 SHALL 静默
无操作——不报错、不动文档。命令 SHALL 由统一键位表分发（与五条滚动键同一条通路），MUST NOT 另加
`keydown` 路径。容器本身仍是 `tabindex=0`、键位分发与命中条件**均不变**；场景 21 实测 `AXPress`
点容器节点（`role=region` → AXGroup）不改变焦点（`focused=AXTextArea`，证据
`test-results/acceptance/2026-09-26-m239-21/21-wrap-default/`），AX 里该节点既无 bbox 也无
`AXPress` 动作，故点选不构成入口——焦点入口只由本键提供。

本 requirement 取代 change `keymap-unify` 增量中「widget 自己的焦点作用域键（Escape / Home / End /
左右方向键）仍由该 widget 现有手柄先消费，本层对已消费事件让路」一句——该句描述的是收编前的分工，
已不再成立，归档时已按本 requirement 修订（原句见
`openspec/changes/archive/2026-09-13-keymap-unify`）。本 change 修订本 requirement 的两种情形：其一，
容器从「表格滚动容器」泛化为「块级横滚容器」，把围栏 / 缩进代码块新引入的横滚容器纳入同一判据
（该容器由 `editor-live-preview` 的「折行渲染与代码块横滚容器」要求产生，命令侧不再各写一份）；
其二，命中条件的语义由「事件目标落在容器内」明确为「容器自身持有焦点」——后者才能把光标落在块内
文本时的方向键留给 caret 路径，与前一条 requirement 的「文本中的方向键不受影响」自洽。

#### Scenario: 容器焦点内的滚动键

- **WHEN** 焦点落在超宽表格的滚动容器上，依次按下 `→` 与 `End`
- **THEN** 容器横向滚动 120px、随后滚到最右（右缘覆盖表格自然宽）；按 `Home` 回到最左；按 `Escape`
  后焦点回到编辑器内容区

#### Scenario: 代码块容器与表格容器同判据同行为

- **WHEN** 默认折行口径下打开含超长代码行的 Markdown，把光标放进该代码块、按 `⌃⌥S`
  （`editor.focus-block-scroll`）把焦点交给代码块横滚容器，依次按下 `→`、`End`、`Home`、`Escape`
- **THEN** 与表格容器完全同形的结果：横向滚动 120px、滚到最右、回到最左，`Escape` 把焦点交还编辑器
  内容区；全程文档内容逐字节不变。MUST NOT 出现「容器焦点了但方向键无反应」的第三种状态

#### Scenario: 文本中的方向键不受影响

- **WHEN** 焦点在编辑器文本中（不在块级横滚容器里）按下 `←`
- **THEN** 光标按原生路径左移一个字符（绑定条件不满足，事件未被消费）

#### Scenario: 光标落在块内文本时方向键仍归 caret

- **WHEN** 在 md 模式里把光标点进代码块的源码文本（焦点在编辑器内容区，容器未成为活动元素），按 `←`
- **THEN** 光标按原生路径移动，容器不横向滚动、事件未被消费；命令的命中条件 MUST NOT 把「光标在某
  容器内的文本里」误读成「该容器持有焦点」
