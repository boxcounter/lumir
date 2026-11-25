# 选择器合同（游标 / 武装 / 揭示 / ARIA）

> 适用面：所有「输入 → 候选列表 → 接受或发送」的浮层选择器。当前已接入的实现是 harness Skill
> 候选（[skill-menu.md](skill-menu.md)）与行内 `[[` 候选（`openspec/specs/wikilink-suggestion/spec.md`）；
> Quick Open / TOC / Vault 切换器按本合同的转移与不变量分阶段接入，接入前各自的 living spec 仍是
> 行为真源。
>
> 本文只固定**转移语义与不变量**，不固定各表面的初态策略、空态策略与视觉呈现——那些按任务不同，
> 登记在各表面自己的 spec 里。来源：Alex 2026-11-25 对 Skill / wikilink 两个选择器缺陷的裁决
> （「选择器按推荐」），以及 [渲染/交互缺陷合同先行规则](../process/rendering-defect-contract-first.md)。

## 术语

| 术语 | 定义 |
|---|---|
| `items` | 当前可激活项的有序列表；分隔线、空态行、删除钮等非可激活件不进列表 |
| 游标（`highlighted` / `cursor`） | 唯一的「当前行」。打开即有，`items` 非空时 MUST NOT 为无 |
| 武装（`armed`） | 接受键（Enter / Tab 等）是否作用在当前行上。与游标分离，见 C4 |
| 标记（`marker`） | 当前 / 已提交项的身份（TOC 的当前段、Vault 的当前 vault 等），不是游标 |
| 真实 clip | `menuRect ∩ 祖先裁切矩形 ∩ 视口`。对 Skill 是 `menuRect ∩ panelRect ∩ viewport`；对 `position: fixed` 的 wikilink 是 `menuRect ∩ viewport` |
| 滚动口 | 真正持有 `overflow: auto` 的元素（Skill 菜单自身、wikilink 的 list）。揭示只写它的 `scrollTop` |

## 输入分布

判据不得只覆盖一个用例。相关输入维度为：

- **列表长度**：单项、恰好一屏、超出一屏；游标在首项、中间项、末项。
- **可见窗口**：滚动区在顶部、中部、底部；真实 clip 的上下缘都被祖先或视口收窄。
- **驱动方式**：方向键、⌃N / ⌃P、指针移动、二者交替、异步结果晚到、IME 组合。
- **主题与缩放**：light / dark / eink；共享字号缩放改变行高。

## 不变量

### C1 — 单一游标，ARIA 与它逐拍一致

`items` 非空时任意时刻 SHALL 恰好有一个游标：可见标记至多一个，`aria-selected="true"` 的 option
至多一个，焦点宿主的 `aria-activedescendant` SHALL 指向同一个 option 的 id（无游标时三处同时为空）。
`aria-current` 只表示**已提交 / 当前项**（标记），MUST NOT 拿来表示游标；两者在同一列表里并存时，
MUST 能同时读出「现在在哪」与「按 Enter 会做什么」。

### C2 — 盒必须先等于真实 clip

菜单盒 SHALL 完整落在真实 clip 内：盒的上下缘不得越过任何裁切祖先的矩形与视口。祖先高度不足时
SHALL 收缩菜单自己的 `max-height`，MUST NOT 让盒底伸到裁切区外面——被裁区里的行物理上无法靠
`scrollTop` 搬进屏幕，任何「揭示算法」在盒越界时都只是假绿。

Skill 候选允许向上覆盖 transcript；垂直夹取宿主 SHALL 是**面板**（`.lumir-harness`，`overflow: hidden`
的持有者），MUST NOT 是 composer 区。行高与高度估算 MUST 取实测值，MUST NOT 另留一份硬编码行高。
`max-height` 上限的唯一真源是 CSS；该上限 MUST 取实测的受约束高度，MUST NOT 把 `getComputedStyle`
的字符串按 px 解析（百分比等非 px 计算值会被静默误读）。真实 clip 变化（窗口缩放、祖先尺寸变化、同状态
回包）后 SHALL 按新 clip 重新夹取；这种重排 MUST NOT 重建 items 或改动游标。

### C3 — 最小揭示：带内不动，越界留一行上下文

游标改变后，游标 option SHALL 完整落在**真实 clip**（扣掉滚动容器的边框与 padding）内。

- 已完整落在带内 ⇒ 滚动口的 `scrollTop` MUST NOT 改变。
- 越界 ⇒ 只滚动到带边缘，并在游标与带边缘之间保留**一行上下文**（一行 = 当前 option 的高度）。
  带高 ≥ 2 行时留满一行；带高不足 2 行时把剩余空间（带高 − 一行）全部留给上下文；带比一行还窄时
  余量取 0，目标比带还高时对齐上缘。
- 首尾 ⇒ 自然 clamp 到 `[0, scrollHeight − clientHeight]`，MUST NOT 补人造空白。
- 揭示 MUST NOT 滚动整页、transcript、编辑器或 composer；MUST NOT 移动 composer caret。
- 重排内部为测量清空 `max-height` 等动作造成的瞬时钳制 MUST NOT 泄漏到揭示判据：滚动口的 `scrollTop`
  SHALL 在定高后恢复，已完整可见目标 MUST NOT 因此改变位置。

推导这条规则的两个反例：每次居中会让列表每按一键都动、并让静止指针下的行被换掉；只在滚动口边缘
贴边（零余量）则选中项永远贴边、下一项直接消失。

### C4 — `highlighted` 与 `armed` 分离

| 事件 | `highlighted` | `armed` |
|---|---|---|
| 候选打开 / query 变化 | 自动：全名项 > 按名字保留 > 首项 | 仅当 token 前缀逐字等于某项全名 |
| 同一 token 的重复同步（前缀未变） | 保留 | 保留 |
| 方向键 / ⌃N / ⌃P | 移动（到端停住、不环绕） | 置真 |
| 指针真实移动（`mousemove`） | 跟随到指针下的行 | 置真 |
| 异步结果晚到（catalog / 索引） | 按名字保留 > 首项 | 只允许保持原值；MUST NOT 从假变真（例外：候选首次出现且 token 已是全名，按全名规则置真） |
| 组合期 | 候选关闭 | 候选关闭 |

规则细化：

- **query 变化不得继承 `armed`**（全名情形除外）。用户按过方向键后再键入一个字符，Enter 回到发送
  语义——否则「刚才选过」会被一次无关的输入延长成一次 Skill 调用。
- 武装项被过滤掉时 MUST 解除武装；回落首项不得连带武装。
- 指针选意只认**真实指针移动**：揭示滚动把另一行搬到静止指针下面不算「指针主动选择」，MUST NOT
  因此改掉键盘刚选中的游标。视觉上 hover 可以改变底色，但 MUST NOT 抹掉游标标记（C6）。
- 接受键作用于 `items[highlighted]`；`armed === false` 时接受键 MUST NOT 激活任何 item，按各表面的
  默认语义处理（发送普通文本 / 原生 Tab / 关闭等）。
- 命名边界：`/tmp` 这类路径前缀不是全名（`tmp` ≠ `tmp-acc`），MUST NOT 武装。判据只看「token 前缀
  是否逐字等于某项全名」：若某项 Skill 的全名恰好是 `tmp`，`/tmp` 就是它的全名，按全名规则武装
  （`tests/unit/skill-menu.test.ts` 钉住该边界）。

### C5 — IME：组合期冻结，结束后按最终文档重算一次

组合期 MUST NOT 触发候选、导航候选或接受候选；已打开的候选 SHALL 在 `compositionstart` 关闭。
`compositionend` 之后 SHALL 按**最终文档**重算一次（CM 的 pending MutationRecord 清空后），MUST NOT
在 `compositionend` 的同步路径里抢确认 `Enter`——确认拍归输入法，候选只看组合结束后的文档。

### C6 — 游标呈现：两种已登记变体，hover 不抹掉标记

同一时刻至多一个游标标记，且该标记 SHALL 在 hover 下仍然可辨。允许两种已登记呈现，按行形状选择，
MUST NOT 为了「统一」强行改成一种：

- **band**：单行行（Quick Open / TOC / wikilink）——`--sel` 底 + inset 1px `currentColor`；
- **bar**：两列密集行（Skill）——`--hover` 底 + 2px `--accent` 左条，eink 下另加 1px outline。

两种变体都必须满足「eink 靠线宽 / 明度而不是色相」「hover 不得移除游标标记」「当前项（标记）与
游标可区分」。悬停底色与游标底色叠加时，游标标记的线宽 / 描边 MUST 保留。

### C7 — 键盘等价与消费口径

↑ / ↓ 与 ⌃N / ⌃P 在候选打开且非组合期时 SHALL 产生相同的下一项 / 上一项状态；到端停住、不环绕。
被消费的键 MUST `preventDefault`，且 MUST NOT 改变文档、caret 或产生撤销步；未消费的键 MUST NOT
被吞。修饰组合（Shift / Meta / Alt）与扩选语义按各表面 spec 保留。

### C8 — 打开与关闭不改变阅读位置

候选的打开、揭示与关闭 MUST NOT 改变页面、transcript、编辑器与 composer 的滚动位置；关闭路径的
焦点口径（主动关闭交还、被动关闭不抢）按各表面 spec。

## 开放项（由接入方各自登记，不在本合同内）

- 初态策略（首项 / 标记项 / 无游标）与空态策略（`keep-open` / `close`）——Quick Open、TOC、Vault
  切换器的差异见各自的 living spec。
- 是否允许覆盖相邻内容（Skill 允许覆盖 transcript；wikilink 贴 caret 翻转）——由几何合同决定，但
  都必须满足 C2。
- 具体 token 与行距——见 [design-tokens-v1.md](design-tokens-v1.md) 与各表面 spec。

## 证伪方式

- **纯函数表驱动 + 属性矩阵**（`tests/unit/selector-reveal.test.ts`、`tests/unit/skill-menu.test.ts`）：
  揭示函数在 `scrollTop × 带内位置 × 行高 × 余量` 上断言 C3；状态机在 `事件 × 列表长度 × 前缀`
  上断言 C4。
- **浏览器几何矩阵**（`tests/visual/scenes/skill-hybrid.spec.ts`、`wikilink-suggestion.spec.ts`）：
  oracle 一律取真实 clip（`menuRect ∩ panelRect ∩ viewport`），并单独断言盒不越界；先证明列表真的
  溢出再测揭示；记录候选之外的滚动读数，全程不变。
- **状态可观测性**：候选根节点暴露 `data-armed="true"|"false"`，供机器断言「视觉高亮 ≠ 接受承诺」；
  它不是视觉差异，MUST NOT 被样式消费。
- 真 WKWebView 只用截图留证，不用 AX 冒充几何断言（见各验收场景）。
