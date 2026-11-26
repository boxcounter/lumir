# Skill 候选交互合同

> 来源：Alex 2026-11-25 在 Lumir 0.16.0 的三项实测缺陷报告。本文是
> [渲染/交互缺陷合同先行规则](../process/rendering-defect-contract-first.md) 要求的专项质量合同；
> 产品增量归 OpenSpec change `fix-skill-menu-ux-nov25`，S1 / S2 的游标、武装与真实 clip 口径由
> `selector-reveal-auto-select-nov25` 收紧；接受键从「全名或显式导航才武装」改为「有效高亮即接受」
> 由 change `fix-skill-enter-accept-nov26` 落地（Alex 2026-11-26「认可这个方案」）。
>
> 转移语义与通用不变量（游标 / 武装 / 真实 clip / 最小揭示 / IME / ARIA）的统一居所是
> [selector-contract.md](selector-contract.md)。本文只保留 Skill 表面的专属口径（S3 宽度、S4 滚动面、
> 空态与零候选），不重抄通用条款。

## 输入分布

判据不得只覆盖一个名称或一个窗口。相关输入维度为：

- **键盘类型**：ArrowDown / ArrowUp、Ctrl+N / Ctrl+P；另含 Shift+Arrow、Ctrl+Shift+N/P、带 Meta / Alt 的同名键与 IME composition 作不接管对照。
- **列表长度**：单项、恰好一屏、超出一屏；游标初态为首项 / 按名字保留项 / 全名项，矩阵另含中间项与末项。
- **可见窗口位置**：候选滚动区在顶部、中部、底部；高亮由键盘、指针悬停及二者交替改变。
- **宿主可用宽度**：窄 pane（可用宽低于组件下限）、正常 pane、超宽 pane；内容含短名称/短描述与长名称/长描述。
- **主题与缩放**：light / dark / eink，候选字号继续随共享 Harness 缩放比变化。

## 不变量

### S1 — 同类导航键只有一个高亮移动语义

候选打开即有唯一游标（首项 / 按名字保留 / 全名项，口径见 selector-contract C4）。候选打开且非 IME
composition 时，Ctrl+N 与 ArrowDown 恒产生相同的下一项状态，Ctrl+P 与 ArrowUp 恒产生相同上一项状态。
对任意列表长度与当前游标，四类键均到端停住、不环绕；首项按上、末项按下停在原位。

候选消费这四次导航：事件 MUST `preventDefault`，composer 文档、caret 与撤销栈 MUST 不变。候选关闭时
本合同不接管按键，既有 Emacs 行移动 MUST 保持。Shift+Arrow 与 Ctrl+Shift+N/P 继续走原生选区路径且不被
候选消费，既有扩选 MUST 保持；Shift+Arrow 扩选使 caret 离开 Skill token 后，候选按既有
`selectionSet → syncSkillMenu()` 路径关闭，Ctrl+Shift+N/P 另保留旧主动关闭路径，两者均不强制保留候选。
Meta / Alt 组合与 IME composition MUST NOT 被这条候选导航吞掉；候选打开且 `items` 非空时，**无修饰**
Enter / Tab 接受当前高亮（C4「有效高亮即接受」）：Shift+Enter 仍换行、Shift+Tab 仍回退焦点、
Alt / Meta 组合保持原义，Escape 关闭与「关闭后 Enter 发送原文」的合同见 S5。

### S2 — 高亮项始终完整可见，候选盒不被祖先裁切

真实可见带 = `menuRect ∩ panelRect ∩ viewport`（再扣掉菜单自身的边框与 padding），不是菜单的
`clientHeight`。候选盒 SHALL 完整落在面板与视口内（面板是 `.lumir-harness`，允许向上覆盖 transcript；
高度不足时收缩 `max-height`），因为被裁区里的行无法靠 `scrollTop` 搬进屏幕。

垂直放置：下方放得下 ⇒ 放在 caret 下方；否则上翻（允许覆盖 transcript）。下方放置 SHALL 以控制行
`.lumir-hp-ctl` 的顶缘为界，MUST NOT 压住控制行；上翻 SHALL 先按上方可用空间收缩 `max-height`，
MUST NOT 让盒底越过 caret（不得把 caret 与 composer 当前行压住）；上方连一行都放不下才回落到下方。
`max-height` 的上限唯一真源是 CSS（`.lumir-hp-skill-menu`），上限 MUST 取「清空 inline 后实测的受约束
高度」，MUST NOT 把 `getComputedStyle` 的字符串按 px 解析（百分比等非 px 计算值会被静默误读）；JS 只按
可用空间再收缩，MUST NOT 另留硬编码上限。

候选在窗口缩放、面板尺寸变化（含分隔条拖动）与同状态回包（token / 游标 / items 不变）后 SHALL 按新的
真实 clip 重新夹取；揭示只在游标改变、或重排前完整可见的游标被新几何挤出带时发生——用户手动滚开的候选
位置 MUST NOT 被同状态回包或尺寸变化拉回游标项（稳定阅读优先；resize 只为「原本可见的游标被裁掉」补
揭示，MUST NOT 借机回弹到高亮首项）。「重排前完整可见」SHALL 按上一次放置确立的几何判定（上一次放置后
游标完整在带内、且此后用户没有滚动过候选），MUST NOT 按几何变化后的 clip 判定——面板 / 视口收缩的事件
到达时浏览器已把新尺寸应用到 clip 上。这种重排 MUST NOT 重建 items、MUST NOT 改动游标。重排为读取自然
高度会先清空 inline `max-height`——这一步造成的滚动钳制 MUST NOT 泄漏到揭示判据：候选自身 `scrollTop`
SHALL 在定高后恢复，已完整可见目标的 `scrollTop` MUST NOT 因此改变。

**场景——C3 跨拍让位例外的适用范围**：Skill 候选的放置与揭示在同一拍内完成（`placeSkillMenu` 读几何后
立即写样式并揭示），不存在「游标改变之后、写拍之前」可被用户滚动插入的窗口，因此
[selector-contract.md](selector-contract.md) C3 的跨拍让位例外在本表面不成立：

- 用户在游标改变之前滚开（或刚发生一次同状态重排）⇒ 随后的游标改变仍 SHALL 按 C3 揭示新 option；
  让位 MUST NOT 因为「用户刚滚过」而延长到下一拍。
- 让位只作用于没有游标变化的重排（同状态回包 / resize，见上段），MUST NOT 被扩展成「游标改变可以不
  揭示」——那是可见性保证失效，不是稳定阅读优先。

任意游标改变后，当前 option 的上下缘 SHALL 落在真实可见带内（允许 1px 几何取整容差）。若它已完整可见，
候选 `scrollTop` MUST 不变；越界时只滚动候选到带边缘并保留一行上下文。首尾、长列表与指针/键盘交替满足
同一条，禁止借整页、transcript 或 composer 滚动完成揭示。指针选意只认真实指针移动，揭示滚动不得改动
键盘刚选中的游标。

### S3 — 宽度随可用空间增长且始终受边界约束

令 `avail = max(0, hostWidth − 2 × 8px)`、`cap = min(48 × fontSize, avail)`、`target = min(max(200px, 0.85 × avail), cap)`。候选宽度 SHALL 为 `min(max(naturalWidth, target), cap)`。

这条公式同时要求：窄 pane 不越界；正常 pane 的短内容不再停留在过小自然宽；超宽 pane 不被拉成无上限横带；长描述可超过旧 26em 但不超过 48em 或可用宽；共享缩放增大字号时 em 上限同步增大。通用 list 浮层不继承这个 Skill 专用目标宽与 48em 上限。

### S4 — 滚动面与交互件边界不变

候选继续归滚动条细条档；其右缘 12px 内 MUST NOT 新增常驻可交互件。长列表断言 MUST 先证明 `scrollHeight > clientHeight`，避免在不溢出的菜单上空测滚动。

### S5 — 接受 / 发送的边界与异步稳定

菜单存在有效高亮项时，无修饰 `Enter` / `Tab` SHALL 接受 `items[highlighted]`——把当前 token 替换为
`/完整名 ` 并创建引用，MUST NOT 发送；不要求 token 是全名，也不要求候选唯一。接受之后再按 `Enter`
才是发送。方向键 / `⌃N` / `⌃P` / 指针移动只改变高亮，接受键始终作用于当前高亮项，到端停住、
不环绕的既有语义不变。

无候选（前缀零命中或 token 已结束）时 `Enter` SHALL 发送普通文本。`Esc` 关闭候选后 `Enter` SHALL
发送未改写的原文（`/tmp` 等字样保持原义），MUST NOT 接受任何项，候选 MUST NOT 因这次发送重新打开。

catalog / 索引回包 SHALL 按名字保留当前高亮与接受目标，目标消失才回落（全名项 > 首项）。接受动作在按键时刻定格
目标：晚到回包 MUST NOT 把已接受的项换成另一项；候选已因 `Esc` / 接受 / 失焦 / 换会话关闭时，旧回包
MUST NOT 重开候选、改写 composer 文本或新增 / 替换引用。

`data-armed` 保留为观测位：菜单打开且 `items` 非空时恒为 `"true"`，关闭时移除；它不是视觉差异，
MUST NOT 被样式消费（C4「有效高亮即接受」的证据位）。

## 证伪方式

- Node 属性/矩阵测试：键盘类型 × 列表长度 × 高亮位置，以及宿主宽度 × 自然宽 × 字号分布。
- 浏览器矩阵：两类键盘族驱动短/一屏/长列表，从首到末再返回，逐拍读 option 与菜单矩形；中部先经指针悬停再交替使用两类键盘。记录候选之外的滚动读数，必须全程不变。
- 浏览器尺寸矩阵：三主题 × 窄/正常/超宽 pane，长短描述分别测；长列表先断言溢出再测揭示。
- 真 WKWebView：合成 Skill fixture 驱动 Ctrl+N/P、长列表与宽度截图；场景只作真栈验收，不用 AX 不可读的几何值冒充 DOM 断言。
