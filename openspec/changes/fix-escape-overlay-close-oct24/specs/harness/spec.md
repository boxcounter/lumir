# harness 增量规格

> 起草注记（非规格正文）：本 change 只改「浮层可访问性」一条——把浮层清单补全、把「选定后重建
> 自身内容」的焦点落点写死、并把 Escape 收浮层与窗口退出隔离。根因链、层清单与判据落点见
> [design.md](../../design.md)。MODIFIED 条基于当前 living spec
> （`openspec/specs/harness/spec.md`，master `152559fc`）的原文整块复制后改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: 浮层可访问性

harness 的**菜单型浮层**（模型 chip 的 provider 浮层、权限浮层、合并选择器浮层、标题栏 harness 段的会话浮层）SHALL 对辅助技术可达：浮层 MUST NOT 嵌在 `<button>` 元素内（WKWebView 将嵌套按钮当叶子、不暴露其内容）；浮层 SHALL 以 `role="menu"` 及菜单项角色（provider 项 `menuitemradio` + `aria-checked`）呈现，触发钮 SHALL 带 `aria-haspopup="menu"` 与随开合翻转的 `aria-expanded`。harness 面板的**全部可关闭层**（上列菜单型浮层，以及 Context hover 泡、effort 提示与面板本体）打开时，Escape SHALL 先收**最上层**那一层（「最上层」的判据与「什么算关闭意图」的准入见 `keymap-commands` 的「Escape 的顶层关闭语义与窗口隔离」条），无层打开时 Escape 才收面板；Escape 收层 MUST NOT 关闭窗口或退出应用。hover 泡与 effort 提示不持焦，不属于上文的 `role="menu"` 口径——本条不改变它们的既有呈现形态。effort 提示（effort 读数悬停时出现）打开时按 Escape SHALL 只收起该提示，焦点 MUST NOT 移动，面板与窗口保持。

浮层因用户动作重建自身内容时（点选权限档位、切换 provider / model / effort 后按新值重绘列表），若重建前焦点在该浮层内，重建后焦点 SHALL 留在浮层内的**同一语义项**上——语义键 SHALL 为「段 + 该项 id」（provider 段取 provider id、model 段取当前 provider 的 model id、effort 段取 effort id），且 MUST 按**重建时的当前状态**取键，MUST NOT 取点击目标：写回失败回滚后的重建要落回回滚后的当前项，而不是失败的新项。焦点 MUST NOT 落到 `body` / `documentElement` 或浮层之外；该层没有可回落的对应项时 SHALL 把焦点交给触发钮。重建 MUST NOT 改变浮层的开合状态（开-闭跃迁与「自身重建不得改变可见态」的通用口径见 `docs/specs/overlay-visibility.md` 的 O6，本条补的是重建后的**焦点位置**与它关闭时的窗口隔离面）。

#### Scenario: 浮层项读屏可达

- **WHEN** 打开模型 chip 的 provider 浮层或会话名浮层
- **THEN** 浮层项在 WKWebView 的 AX 树中逐个暴露（可经辅助技术定位并激活）

#### Scenario: Escape 分层

- **WHEN** 任一浮层打开时按 Escape
- **THEN** 只收起浮层，面板保持打开；浮层全关时再按 Escape 才收起面板

#### Scenario: 选择档位后 Escape 只收浮层

- **WHEN** 打开权限浮层、点选「完全访问」（浮层保持打开并按新档重建内容），随后按 Escape
- **THEN** 只收起浮层，焦点回到权限 chip，harness 面板与窗口仍在、Lumir 进程不退出；文档内容与 dirty 状态逐字节不变

#### Scenario: 重建后焦点仍在浮层内

- **WHEN** 打开合并选择器，分别选择另一个 provider、另一个 model、另一档 effort（浮层保持打开并重建列表）
- **THEN** 每种选择后焦点都停在刚选中的那一项上（同一段 + 同一 id），不是 `body`；随后的 ↑↓ / Enter / Escape 仍在该浮层内生效

#### Scenario: 写回失败回滚后焦点落在回滚项

- **WHEN** 选择另一个 provider（或 model / effort）而配置写回失败，浮层按回滚后的值重建内容
- **THEN** 焦点落在回滚后的当前项上（不是失败的新项、不是 `body`）；错误行可见，浮层保持打开

#### Scenario: effort 提示按 Escape 只收提示

- **WHEN** 悬停 effort 读数使提示打开，按 Escape
- **THEN** 只收起该提示，焦点与面板状态不变，窗口与应用保持
