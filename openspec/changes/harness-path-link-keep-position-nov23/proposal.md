# Proposal: harness 路径链接保持位置，已打开标签闪一次

- Change ID: `harness-path-link-keep-position-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（裁决、节点 1），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1 已批准**（Alex 2026-11-23，回话「按推荐」；本批三项一次覆盖）。L1–L4 逐条落值见
>   下方裁决点表，批准值与推荐值一致。
> - **实现与节点 2 材料已备（2026-11-24）**：实现已落地并 rebase 到 master `ede07e84`，当前 tip
>   `49fca425`；`git range-diff` 证明与独立评审 tip `2b669b21` 的三个补丁逐一相同。独立评审 r3
>   clean / merge；真机 221 PASS（26.9s）；quick `GATE RESULT: 13/13 PASS（SKIP 0）`；完整视觉
>   `GATE RESULT: 15/15 PASS（SKIP 0）`。living spec 仍由归档包装器并入，不提前改写。
> - **评审返修（2026-11-23）**：独立评审 needs-changes 四项已修——① 工具卡片 `offset` 统一为
>   「滚动落行、不产生正文行高亮、只闪标签」（保留既有禁令）；② 正文 / 卡片路径按钮加按钮级
>   `mousedown.preventDefault()`，焦点留在 composer；③ `TabsHandle.dispose()` 接入
>   `disposePaneHandle` 并补「闪烁中收 pane」；④ 真机改用 `recordEditor` + `unchangedSince`
>   逐字节判据。L1–L4 批准值不变。

## Why

### 现场：点一条裸路径，界面「什么都不发生」

harness 面板的路径链接走唯一打开链路：

| 环节 | 位置 | 行为 |
|---|---|---|
| 链接激活 | `src/harness-panel.ts:1856` | 正文链接触发 `ctx.openFile(path, line, lineEnd)` |
| 装配 | `src/main.ts:3293-3296` | `openVaultPath` → `jumpPlanFor(handle, path, line)` |
| 跳转编排 | `src/harness-path-link.ts:366-383` | `open(path)`；`line === undefined` 直接返回 |
| 打开既有文件 | `src/main.ts:2876-2882` → `activateSessionInOwnerPane` → `tabs.activateTab` | 已在前台时 `activate()` 早退（`src/editor.ts:2907`） |
| 切后台标签 | `src/editor.ts:2919`、`:2948` | 离开时存 `scrollSnapshot`，切入时恢复该会话自己的位置 |
| 行锚 | `src/editor.ts` 的 `revealLineAt` | 选区移到行首 + 滚到居中 + 瞬态行高亮 |
| 标签反馈 | `src/tabs.ts:280-296` | **只有 `.is-active`，没有任何闪烁态** |

两个结论：

1. **裸路径 + 已在前台**今天确实不滚、不动选区（`openPathAtLine` 无行号时直接返回）。
   现场看到的「滚动」是带行号锚的链接——那种链接的滚动是显式意图，不该改。
2. **真正的缺陷是缺乏反馈**：裸路径点击一个已在前台的文档时，界面没有任何可见变化，用户
   无法判断「点到了 / 文件在哪」。标签栏没有闪烁 / 定位态，唯一反馈是 `.is-active`（本来
   就在）。

### 分档现状与目标

| 情形 | 今天 | 本 change 后 |
|---|---|---|
| 已打开 + 前台 + 无行锚 | 不滚、不动；**无反馈** | 不滚、不动选区 / caret、不重载、不切活跃 pane；**闪一次标签** |
| 已打开 + 前台 + 有行锚 | 滚到目标行居中 + 行高亮 | 不变；**同时闪一次标签** |
| 已打开 + 同 pane 后台 + 无行锚 | 切标签、恢复自身滚动位置 | 不变；**闪一次标签** |
| 未打开 | 新标签打开，视口在篇首 | 不变；**不闪**（新标签本身即反馈） |
| 同文件在另一 pane | 结构上不可达（见下） | 不设计新语义 |
| 同名不同目录 / 不同拼写 | 不同路径，各开标签 | 不变（不做 alias 去重） |
| 目录路径 | 左栏定位 + 树行高亮 | 不变（不碰编辑器视口） |

结构性事实：`pane-layout` 明文「harness 在场时文档 pane 至多一个」，harness 面板只能挂在第二
pane，因此「同文件在另一 pane」的 `moveSessionToPane` 分支今天不可达；本 change 不为它设计
新语义。

### 为什么工具卡片也适用

工具卡片的路径与正文路径共用 `openVaultPath` 同一条链路（`src/main.ts:3293-3296`、
`src/harness-panel.ts:4258`）。如果只改正文，同一份路径在两个入口会有两种反馈，属于「同一
语义两处真源」。因此同一判定覆盖卡片。**但落点反馈按既有口径分叉**：正文行锚是「滚动 +
行高亮」；卡片带 `offset` 只滚动落行、**不产生行高亮**（卡片不传 `lineEnd`，既有禁令），
标签照常闪一次。不得为了「同一条判定」把卡片高亮加回来。

## What Changes

1. **前台裸路径短路**：`openVaultPath` 先判定
   `existing = editor.sessionForPath(path)`、`foreground = existing === editor.activeSession()`；
   当 `foreground && line === undefined` 时**完全不调 `openPathAtLine`**（连 `openFile` 也不调，
   避免 `activatePane` / `syncActiveDocument` 等副作用），只闪该标签。
2. **其余情形保留既有链路**；打开成功后若 `existing` 存在，闪一次标签。
3. **`TabsHandle.flash(session)`**：按会话对象记账（不是只在 DOM 上挂 class）；全量重建时按
   `session === flashedSession` 重新施加；计时结束 / 会话关闭 / 组件卸载时清理；重复触发重置
   计时；同一时刻至多一个标签闪烁。新增 `TabsHandle.dispose()`，由 `disposePaneHandle` 在销毁
   编辑器前调用（或登记进 `assembly.unsubs`）；收 pane / 双 pane 收拢时清空计时器与状态，
   回调发现卸载时先清状态再返回。
4. **视觉**：`.tab.is-flash { background: var(--sel-band); }`，排在 `.tab.is-active` 与
   `:hover` 之后；eink 同值；时长复用 `NAVIGATION_HIGHLIGHT_MS`（1400ms），不新造时长。
5. **规格**：
   - `harness`「输出中的 vault 路径可点击」MODIFIED：写入分档行为、卡片同口径、焦点留在
     composer、CL-2 对无位移点击不适用。
   - `multi-tabs` ADDED「标签的短暂导航高亮」：行为与视觉合同（底色、时长、重建保持、清理、
     几何不变、eink）。
6. **判定收成纯函数**：`harness-path-link.ts` 里把「已打开 × 前台 × 无行锚」抽成可单测的
   判定；`openPathAtLine` 本身不改成两种语义。
7. **路径按钮的焦点**：`src/harness-panel.ts` 的 `createPathLinkEl`（正文与卡片共用）增加
   **按钮级** `mousedown` → `preventDefault()`，使鼠标按下不夺走 composer 焦点；不挂容器级
   监听；既有 `click` 与 Enter 激活不变。

## 节点 1 裁决点（已批准）

| # | 裁决点 | 推荐值 | 批准值 | 备选 / 代价 |
|---|---|---|---|---|
| **L1** | 行锚链接是否保持滚动 | **保持**（滚到目标行 + 行高亮） | **保持** | 一律不滚：`:39` 这类链接失去「带我去那行」的唯一意义 |
| **L2** | 裸路径点击是否切换活跃 pane | **不切**：焦点在 harness 时 harness 仍是活跃 pane，只闪标签 | **不切** | 切换：把键盘上下文从 composer 挪走，打断正在提问的用户 |
| **L3** | 闪烁时长与视觉 | **1400ms + `--sel-band`**；已打开即闪（含行锚），未打开不闪 | **同左** | 1200ms（树定位语义）：与行高亮不同拍；`--sel`：light 下与激活标签底色太近 |
| **L4** | 工具卡片是否同规则 | **适用**（同一条打开链路） | **适用** | 只改正文：同一路径两个入口两种反馈，属两处真源 |

L4 的「同规则」指打开与视口位置判定，**不含行高亮**：卡片 `offset` 沿用既有「只落行、不产生
行高亮」禁令（评审返修一并钉死）；正文行锚才是「滚动 + 行高亮」。

## Non-goals

- **不改行锚的滚动与高亮**：`路径:行号` / `:起-止` 仍滚到目标行并高亮。
- **不给新标签加闪烁**：新标签本身就是反馈；闪烁只用于「已打开、需要告诉你在哪」。
- **不改目录链接**：目录仍只做左栏定位 + 树行高亮，不碰编辑器、不闪标签。
- **不做同名 / 不同路径的 alias 去重**：同名不同目录是不同文件，各开标签。
- **不为跨 pane 设计新语义**：该分支结构上不可达；未来若可达，另行提案。
- **不改路径识别 / 候选校验 / 行号解析**；不改打开链路的通用语义（`openFile` / `activate`）。
- **不给工具卡片 `offset` 加行高亮**：既有禁令保留；卡片只滚动落行 + 闪标签。要加卡片高亮
  属于新的行为变更，另行送裁。
- **不把焦点移入编辑器**；点击后焦点仍留在发起点击的 harness composer。实现上只用按钮级
  `mousedown.preventDefault()`，MUST NOT 用容器级监听（REVIEW.md「标题栏 preventDefault」条
  的同族纪律）。
- **不让闪烁状态靠 DOM 自然消失**：必须有显式 `dispose()` 与卸载清理。
- **不新增配置 / 命令 / 键位**；不改标签的激活态、dirty 点、关闭按钮。

## Impact

- 影响的 specs：`harness`（1 条 MODIFIED）、`multi-tabs`（1 条 ADDED）。
- 影响的代码 / 系统：
  - `src/main.ts`：`openVaultPath` 的前台 / 裸路径判定与闪烁调用；`disposePaneHandle` 调
    `TabsHandle.dispose()`。
  - `src/tabs.ts`：`flash(session)` / `dispose()` API、按会话记账、`renderTabs` 重建时重新
    施加、卸载清理。
  - `src/style.css`：`.tab.is-flash` 与 eink 规则；排在 `.is-active` / `:hover` 之后。
  - `src/harness-panel.ts`：`createPathLinkEl` 增加按钮级 `mousedown` 拦焦点（正文与卡片
    共用）。
  - `src/harness-path-link.ts`：把分档判定抽成纯函数（不 fork `openPathAtLine`）。
  - 测试：`tests/unit/` 的分档矩阵；`tests/visual/scenes/` 的链接点击场景（m632 / 新建）含
    正文 / 卡片 mousedown、卡片 `offset` 无高亮、闪烁中收 pane；真机场景 221 扩展裸路径已
    打开现场，用 `recordEditor` + `unchangedSince` 做逐字节比较，并同步 `COVERAGE.md`。
- 关联约束：
  - 性能合同无关：只多一次 `sessionForPath` 查找与一次 class 写入，不进入按键路径。
  - 不写盘、不改源文件；ADR 0003 无关。
  - 视觉基线：闪烁是瞬态，截图前必须等它消退，MUST NOT 拍进基线。
- 仓库信息卫生：测试与验收场景只用合成路径 / 文档名。

## 与 ADR 的关系

不需要 ADR：只改一个导航入口的落点反馈与一条标签视觉态，不改分层、不改打开链路的通用语义。
