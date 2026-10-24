# keymap-commands 增量规格

> 起草注记（非规格正文）：本 change 给 `Escape` 补一条跨层的关闭合同——一次只关最上层、关闭后
> 焦点回还、任何焦点位置都不得落到原生关窗 / 退出路径。机制、根因链、层清单与判据落点见
> [design.md](../../design.md)。ADDED 条不与 living spec 现有 requirement 同名。

## ADDED Requirements

### Requirement: Escape 的顶层关闭语义与窗口隔离

系统 SHALL 把 `Escape` 的关闭动作收敛为「一次只关最上层」：任一可关闭层（浮层 / 菜单 / 输入条 /
hover 泡 / 全屏遮罩 / 面板，含 harness pane、搜索面板、键位面板、文件树与标签的右键菜单）打开时，
一次 `Escape` SHALL 只关闭当前**最上层**的那一层，MUST NOT 连带关闭下层；关闭后焦点 SHALL
回到该层的触发元素；层没有单一触发元素时（面板这类容器层）SHALL 回到它关闭前承接键盘的区域
（harness pane 与搜索 / 键位面板均回文档编辑器），hover 泡这类本就不持焦的层 MUST NOT 因关闭而
移动焦点；任何情形下 MUST NOT 把焦点交给 `body` / `documentElement`。「最上层」SHALL 只有一个
判据：层的打开序（后打开者在最上层），MUST NOT 由各层的处理器按各自的检查顺序各判一次。

没有可关闭层打开时，`Escape` SHALL 保持该焦点的既有归属：编辑器 widget 容器的
`editor.widget-escape`（焦点交还编辑器）、输入条的就地取消、面板的收起等；本要求 MUST NOT
新增任何**产品动作**（不关层、不移动焦点、不改状态、不退出）。在没有任何归属的焦点位置
（如 `body`）上，`Escape` MUST NOT 关闭窗口或退出应用：窗口级兜底 SHALL 消费该按键的默认行为
（`preventDefault`）以阻止原生默认关窗；该消费 MUST NOT 被理解或实现为新增产品行为——
MUST NOT 关层、MUST NOT 移动焦点、MUST NOT 改变既有归属、MUST NOT 改变 dirty / 文档内容。

`Escape` MUST NOT 关闭窗口、MUST NOT 触发应用退出——该不变量对**任何焦点位置**成立，含焦点落在
`body` 上、层内持焦件被内容重建摘除之后的情形。窗口关闭的用户入口 SHALL 仍只有红灯按钮与 `⌘Q`
（口径见「⌘W 归标签——原生菜单关闭项让出该加速键」条）；`Escape` MUST NOT 成为第三条退出路径。
为此关闭键的消费 SHALL 有一条**窗口级兜底**：未被下游处理器消费的 `Escape` MUST 在到达原生窗口
之前被消费（`preventDefault`），MUST NOT 依赖「焦点恰好落在某一层的容器内」这个前提。兜底 SHALL
挂在 `window` 的冒泡阶段并排在统一键位分发器之后；MUST NOT 在 `KEY_BINDINGS` 为 `Escape` 注册第
二条绑定（「一个 token 一条绑定」不变量不变）；MUST NOT 处理已消费（`defaultPrevented`）的事件。

「一次 `Escape` 是否归关闭路由」SHALL 由**同一份准入判断**决定，各层的就地键处理器与窗口级兜底
MUST 共用它，MUST NOT 各写一份：仅**无修饰**的 `Escape` 归关闭；输入法组合期（`isComposing` /
`keyCode === 229`）不归关闭、不消费、不关层；带修饰键的 `Escape`（⇧ / ⌘ / ⌃ / ⌥ 的组合）只消费
默认行为，MUST NOT 关闭任何层。就地键处理器先于兜底运行，因此它 MUST 执行同一份准入——MUST NOT
只看 `event.key === "Escape"` 就关层：否则带修饰键与组合期的按键在兜底看到之前就已经关了层，合同
在真实监听链上不成立（兜底只处理「没人要」的按键）。就地处理器同样 MUST 对已消费
（`defaultPrevented`）的事件让路。

每层的关闭与焦点回还 SHALL 只有一份实现：层自己的就地键处理器与窗口级兜底 MUST 调用同一个关闭
函数，MUST NOT 各写一份；层在打开 / 关闭时 SHALL 同步在层栈登记 / 注销，MUST NOT 出现「层已关闭
但仍在最上层」或反之。

#### Scenario: 浮层持焦时只收浮层

- **WHEN** harness 权限浮层打开、焦点落在浮层内的档位按钮上，按 `Escape`
- **THEN** 只收起该浮层，面板保持打开，焦点回到权限 chip；窗口仍在、应用不退出

#### Scenario: 层内持焦件被重建摘除后仍只收浮层

- **WHEN** 浮层因点选动作重建自身内容、原先持焦的按钮被从 DOM 摘除（焦点落回 `body`），随后按 `Escape`
- **THEN** 窗口级兜底按层栈关闭该浮层并回还焦点；应用不退出，文档内容与 dirty 状态逐字节不变

#### Scenario: 无层时不新增产品动作且不退出

- **WHEN** 没有任何浮层 / 面板打开、焦点在 `body` 上（例如刚点过空白处），按 `Escape`
- **THEN** 不产生任何产品动作（无关闭、无焦点移动、无状态变化）；兜底仅为安全阻止原生默认关窗，窗口不关闭、应用不退出，文档内容与 dirty 状态逐字节不变

#### Scenario: 两层打开时一次只收最上层

- **WHEN** harness 面板与面板内的权限浮层同时打开，连续按两次 `Escape`
- **THEN** 第一次只收起浮层、面板保持打开；第二次才收起面板；每次关闭后焦点分别回到权限 chip 与编辑器，窗口全程不关闭

#### Scenario: 编辑器 widget 的既有归属不被兜底改写

- **WHEN** 焦点在表格 / 代码块的块级横滚容器内按 `Escape`
- **THEN** 仍执行 `editor.widget-escape`（焦点交还编辑器），与兜底引入前逐键一致；应用不退出

#### Scenario: 就地处理器执行同一准入

- **WHEN** 权限浮层打开、焦点在档位按钮上，依次按 `⇧Escape`、`⌘Escape`（或 ⌃ / ⌥ 组合）
- **THEN** 浮层保持打开、焦点不动、应用不退出；随后按无修饰的 `Escape` 才收起浮层——就地处理器与兜底对「什么算关闭意图」的判断一致

#### Scenario: 输入法组合期不关层

- **WHEN** 中文输入法组合期（`isComposing` 为真）按 `Escape`
- **THEN** 按键归输入法处理（取消组合）；就地处理器与兜底都不消费、不关层；应用不退出、当前层保持

#### Scenario: 退出路径不受影响

- **WHEN** 文档有未保存修改、且没有任何层打开时按 `Escape`；随后按 `⌘Q`；保存后再按 `⌘Q`
- **THEN** `Escape` 不改变任何界面状态、不退出；`⌘Q` 在未保存时仍被守卫拦下并提示、应用不退出；保存后 `⌘Q` 正常退出——两条既有语义一字不变
