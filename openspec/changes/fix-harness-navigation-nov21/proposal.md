# Proposal: 修复 harness 两条既有导航路径（`path:line` 句末标点解析 / cron 结果通知点击不抢正文焦点）

- Change ID: `fix-harness-navigation-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：Alex 2026-11-21 在需求批逐字提出下方两条缺陷，并以「请你继续」确认推进；
> 批准面按原需求逐条展开，实现中没有新增行为裁决点（见「起草期取值」）。
>
> 实现评审 r1（2026-11-21，`non-clean`）：三条 findings 全部在批准面内处置——P1 点号守卫误放行
> `.foo` / `..5` / `.-3` / `._3` / `./3`（改为连续点号段整体判定，spec 同步改准）；P2 `cron:run`
> 显式发起的 composer 聚焦补回归断言；P3 range + 英文句号的视觉 / 真机 fixture 标点改准。
> 处置记录与读数见 `tasks.md` §6。

## Why

Alex 2026-11-21 的原始需求（逐字，两条独立缺陷）：

> 「harness pane 的 `design.md:69` 点击行号解析（不是 Cmd+P）」
> 「cron 通知点击后 harness pane 展开但正文焦点不抢（现有 openHarnessPane 未生效需诊断）」

两条都是**既有路径**的缺陷，不是新能力：

1. **`path:line` 的行号解析在句末标点后失效**。`src/harness-path-link.ts` 的 `lineSuffixAt` 在
   后缀之后用一个「路径延续字符」拒绝类（`[A-Za-z0-9_.\-/]`）判定畸形；英文行文里最常见的
   「见 `design.md:69.`」把句末句号算进了这个类，于是**整个 `:69` 后缀被拒**、链接退化成
   `design.md`，点击只开到文件第 1 行。行号不是「没写」，而是被静默吞掉。
   - 复现：Chromium 真实渲染 + 真实点击（`design.md:69.` → 链接文本 `design.md`，编辑器停在第 1
     行）；同一形态写成 `design.md:69` / `design.md:69。` / `design.md:69，` 都正确。
   - 为什么 Cmd+P 能绕过：快速打开要求后缀消耗到**输入串末尾**，用户手输时不会带句号；而
     harness 正文里的句号是行文的一部分。修复必须落在 harness 的 `path:line` 解析上，不能把该
     入口改道快速打开。
2. **cron 结果通知点击抢走正文焦点**。`src/main.ts` 的 `handleCronOpenSession` 调用无参
   `openHarnessPane()`；后者无条件 `harnessPanel.focusComposer()`。pane 关闭时点结果通知 ⇒ pane
   展开、会话恢复，但正文编辑器的焦点被 composer 抢走——用户接下来的键入落进对话输入区，且
   「pane 已存在也要确保可见 / 内容恢复」的路径没有被显式表达（只靠随后的 `vaultChanged` 重装）。
   - 复现：Chromium 里经真实 `cron:open_session` listen 回调注入事件，pane 关闭时点击后
     `document.activeElement` 在 `.lumir-harness` 内（旧代码判红）。

## What Changes

1. **句末标点不再吞掉行号后缀**（`harness` 规格的既有 requirement 就地改准）：`:行号` /
   `:行号:列号` / `:起-止` 后缀后紧跟**句末句号 / 省略号**时后缀 SHALL 成立（可点范围止于数字，
   标点留作文本）；**连续点号段之后仍接路径延续字符**时（`.5` / `..5` / `.foo` / `.-3` / `._3` /
   `./3`）仍按畸形后缀处理。字母 / 斜杠 / 下划线 / 连字符的既有拒绝口径逐字不变。
2. **cron 结果通知点击不抢正文焦点**（`cron` 规格的既有 requirement 就地改准）：点击结果通知
   SHALL 唤起窗口、展开 harness pane 并恢复该次运行的会话，但 MUST NOT 把键盘焦点从正文编辑器
   拿走；正文焦点与阅读位置 SHALL 保持点击前的状态。显式打开 / 切换 harness 的既有 composer
   聚焦行为 MUST NOT 改变。
3. **实现面最小**：解析只改 `lineSuffixAt` 的后缀后置守卫；焦点只给 `openHarnessPane` 增加一个
   可选参数（缺省 true），`handleCronOpenSession` 传 `false`，其余调用方逐字不变。
4. **测试与验收**：单测覆盖句号 / 省略号 / 行范围 / 行列 / 小数反例；视觉场景覆盖句号形态落行 +
   高亮、cron pane 关闭 / 已打开两态的焦点与滚动不变、显式 toggle 聚焦不变；真机新增两个验收
   场景（路径形态 tier full；cron 通知点击 tier bundle）。

## 起草期取值（均落在原需求批准面内）

| # | 取值 | 理由 | 若选另一侧 |
|---|---|---|---|
| D1 | 连续点号段之后仍接路径延续字符（字母 / 数字 / `_` / `-` / `/`）才拒绝 | `.5` / `..5` / `.foo` / `.-3` 都是小数 / 版本号 / 路径的延续；`.` / `...` 是句子收尾，必须保留行号 | 只拒绝「点后紧跟数字」：评审 r1 P1 实证会误放行 `.foo` / `..5` / `.-3` / `._3` / `./3` |
| D2 | `openHarnessPane(focusComposer = true)` 用布尔缺省参数 | 与既有 `closeHarnessPane(focusDoc = true)` 同形；调用点少、语义直观 | 另造 `revealHarnessPane()`：两条打开路径要各自维护 pane 存在性判定，容易分叉 |
| D3 | pane 已存在时 cron 路径保持「不抢焦点」的既有早退 | 已存在 = 已可见；内容恢复由 `vaultChanged` 重装承担，无需新增激活动作 | 激活 harness pane：会改活跃 pane / modeline，与「不抢正文」的意图相反 |
| D4 | 不改用户消息气泡的纯文本渲染 | 本需求是「harness transcript 的 `path:line` 解析」；用户消息按块纯文本沉淀是既有设计（引用卡片 / 复制源） | 顺带把用户消息链接化：超出原需求，且要重做复制源与卡片交错语义 |

## Non-goals

- 不改快速打开（`src/quick-open.ts`）的输入解析与落点；不改工具卡片 / wikilink / ⌥G 的高亮或焦点
  行为。
- 不改 `lineSuffixAt` 的三种后缀形状与 `止 < 起` / 越界 / 空白的既有口径。
- 不新增依赖、不新增配置项、不更新视觉基线。
- 不改 cron 通知的投递、台账、跨进程 relaunch 链路；只改「点击已到达前端之后」的焦点落点。

## Impact

- **影响的 specs**：`harness`（MODIFIED ×1：输出中的 vault 路径可点击）、`cron`（MODIFIED ×1：
  通知的投递与点击唤起）。
- **影响的代码**：`src/harness-path-link.ts`（后缀守卫）、`src/main.ts`（`openHarnessPane` 参数与
  `handleCronOpenSession` 调用点）。
- **测试面**：`tests/unit/harness-path-link.test.ts`、
  `tests/visual/scenes/harness-navigation-nov21.spec.ts`（新增）、既有
  `tests/visual/scenes/m632-path-line-range-link.spec.ts`（回归复跑）；真机新增场景
  `269-harness-path-line-sentence-period.md` / `270-cron-open-session-keeps-doc-focus.md`。
- **关联约束**：不改性能合同（解析仍是字符扫描，零 IPC）；不改「不改写源文件」铁律；不改配置即
  数据形态。

## 观测闸三问

- **怎么知道用户用了它**：路径点击与通知点击都是显式动作，dogfood 直接可感知；无埋点。
- **怎么知道它有效**：句末句号形态的链接文本仍是整段 `path:line`，点击落到目标行；点结果通知后
  直接键入，字符落在正文而不是对话输入区。
- **出问题怎么发现**：单测（后缀边界正反例）、视觉场景（链接文本 / 落点 / 高亮 / 焦点 / 滚动）、
  真机场景（AX 按钮名 + 键入落点）；旧代码上这两条视觉判据已实测判红（证据见 change 的 design
  §4 与 `.local/missions/harness-navigation-nov21/`）。
