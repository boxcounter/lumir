# Skill 候选交互合同

> 来源：Alex 2026-11-25 在 Lumir 0.16.0 的三项实测缺陷报告。本文是
> [渲染/交互缺陷合同先行规则](../process/rendering-defect-contract-first.md) 要求的专项质量合同；
> 产品增量归 OpenSpec change `fix-skill-menu-ux-nov25`。

## 输入分布

判据不得只覆盖一个名称或一个窗口。相关输入维度为：

- **键盘类型**：ArrowDown / ArrowUp、Ctrl+N / Ctrl+P；另含带 Meta / Alt 的同名键与 IME composition 作不接管对照。
- **列表长度**：单项、恰好一屏、超出一屏；高亮初态为未选择、首项、中间项、末项。
- **可见窗口位置**：候选滚动区在顶部、中部、底部；高亮由键盘、指针悬停及二者交替改变。
- **宿主可用宽度**：窄 pane（可用宽低于组件下限）、正常 pane、超宽 pane；内容含短名称/短描述与长名称/长描述。
- **主题与缩放**：light / dark / eink，候选字号继续随共享 Harness 缩放比变化。

## 不变量

### S1 — 同类导航键只有一个高亮移动语义

候选打开且非 IME composition 时，Ctrl+N 与 ArrowDown 恒产生相同的下一项状态，Ctrl+P 与 ArrowUp 恒产生相同上一项状态。对任意列表长度与当前高亮，四类键均到端停住、不环绕；从被动态按下方向键 / Ctrl+N 到首项，按上方向键 / Ctrl+P 到末项。

候选消费这四次导航：事件 MUST `preventDefault`，composer 文档、caret 与撤销栈 MUST 不变。候选关闭时本合同不接管按键，既有 Emacs 行移动 MUST 保持。Ctrl+Shift+N/P 继续走旧的关候选但不消费路径，既有扩选 MUST 保持；Meta / Alt 组合与 IME composition MUST NOT 被这条候选导航吞掉；Enter / Tab 接受、Escape 关闭的既有合同不变。

### S2 — 高亮项始终完整可见

任意高亮改变后，当前 option 的上下缘 SHALL 落在候选滚动视口上下缘内（允许 1px 几何取整容差）。若它已完整可见，候选 `scrollTop` MUST 不变；若它从上方或下方离开视口，只滚动候选到恰好揭示它的最近位置。首尾、长列表与指针/键盘交替满足同一条，禁止借整页、transcript 或 composer 滚动完成揭示。

### S3 — 宽度随可用空间增长且始终受边界约束

令 `avail = max(0, hostWidth − 2 × 8px)`、`cap = min(48 × fontSize, avail)`、`target = min(max(200px, 0.85 × avail), cap)`。候选宽度 SHALL 为 `min(max(naturalWidth, target), cap)`。

这条公式同时要求：窄 pane 不越界；正常 pane 的短内容不再停留在过小自然宽；超宽 pane 不被拉成无上限横带；长描述可超过旧 26em 但不超过 48em 或可用宽；共享缩放增大字号时 em 上限同步增大。通用 list 浮层不继承这个 Skill 专用目标宽与 48em 上限。

### S4 — 滚动面与交互件边界不变

候选继续归滚动条细条档；其右缘 12px 内 MUST NOT 新增常驻可交互件。长列表断言 MUST 先证明 `scrollHeight > clientHeight`，避免在不溢出的菜单上空测滚动。

## 证伪方式

- Node 属性/矩阵测试：键盘类型 × 列表长度 × 高亮位置，以及宿主宽度 × 自然宽 × 字号分布。
- 浏览器矩阵：两类键盘族驱动短/一屏/长列表，从首到末再返回，逐拍读 option 与菜单矩形；中部先经指针悬停再交替使用两类键盘。记录候选之外的滚动读数，必须全程不变。
- 浏览器尺寸矩阵：三主题 × 窄/正常/超宽 pane，长短描述分别测；长列表先断言溢出再测揭示。
- 真 WKWebView：合成 Skill fixture 驱动 Ctrl+N/P、长列表与宽度截图；场景只作真栈验收，不用 AX 不可读的几何值冒充 DOM 断言。
