# Proposal: 区分「等待批准」与「生成中」，并让审批信号在滚动区外恒在

- Change ID: `fix-harness-approval-visibility-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（方向裁决、节点 1），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1（提案评审）已获 Alex 明确「同意」（2026-11-24）**。裁决原话为对整个提案的同意；
>   D1–D6 均按本文件推荐值生效：D1「等待批准…」、D2 标题栏 harness 段状态词（面板收起时由
>   toggle 徽标承担同一状态）、D3 停止中 > 等待批准 > 等待响应 / 生成中、D4 子运行待批不计入
>   父会话、D5 发送末尾按最终几何再回底一次（仅发送白名单）、D6 不加脱离态浮钮强调态 / sticky
>   提示。实现自 2026-11-24 起在本分支进行。
> - 方向早已由 Alex 批准（用户报告并要求安排）：区分等待批准与生成中；`pendingApprovals` 为唯一
>   判据；进度文案 / 阶段行与标题栏同源提示；滚动区外必须有审批信号；决策 / 撤回 / 快照重建
>   正确清算；不强制回底、不改变 detached 阈值与跟滚语义；发送末尾按最终几何再回底一次，仅限
>   发送白名单。
> - 本稿有一处**起草期发现**改变了调研建议的落点：面板打开（分栏）时标题栏 toggle 徽标是
>   **隐藏的**（既有退让条款），所以「把同一状态同步进徽标」在用户正看着 transcript 时不成立。
>   滚动区外的信号改落在标题栏 harness 段（`.lumir-hp-seg`）。见 D2 与「关键事实」。
> - **实现与节点 2 材料（2026-11-24）**：最终 tip `7cde918f`，独立评审 r4 clean / merge；完整视觉
>   `GATE RESULT: 15/15 PASS（SKIP 0）`，基线未更新。真机 725 与既有场景安排在 Alex 指定的
>   11:32–13:32 窗口，PASS 后方可归档。
> - 本 change 的 living spec 改动以 delta 形式留在本目录内，归档时并入，不提前改写。
> - r1 独立评审 `needs-changes` 的六项已并入本稿：终态统一撤回与 stale 清理、enter 前置不变量、
>   标题栏会话名链路可收缩、尾行 change 的硬前置门禁与优先级、detached 场景事件顺序、m384 的
>   running 桩与不重复播报断言。

## Why

### 现场

用户报告：一轮对话里模型调用了需要批准的写工具，底部一直显示「处理中 / 正在生成回复…」，
**看不出它在等自己批准**；等了两分钟手动上滚才看到批准卡，主观上读成「卡死」。

这不是错觉，是两条独立缺陷叠加的结果：

1. **「等待批准」没有独立状态，被渲染成「生成中」**（确证）。后端在批准闸上阻塞等用户决策，
   这一轮始终 `in_flight`：`src-tauri/src/harness/run.rs:572-592` 在 `park_approval` 之后
   `rx.recv()`，不超时。前端相位因此始终 `running`；而阶段行只有三档文案
   （`src/harness-panel.ts:5996-5999`：等待响应 / 正在生成回复 / 正在停止），没有「等待批准」
   这一档。标题栏活动状态也只报「处理中」（`src/harness-panel.ts:5976-5990`）。用户看到的是
   与「模型正在干活」完全一样的面孔。
2. **脱离态下审批不可发现**（确证）。批准卡就地挂在 transcript 内的工具行下方
   （`src/harness-panel.ts:7255-7446`），随内容滚动；而跟滚合同规定脱离态下新增内容
   **零写入**（`src/harness-scroll-lock.ts:197-203`；`openspec/specs/harness/spec.md:1989-1991`
   与场景 `:2030-2033`）。脱离态的唯一未读载体是 26px 浮钮上的一个圆点。用户没意识到自己
   已经脱离（一次轻扫、动量尾巴或 16px 以内的误触都足够），于是「处理中」一直在屏上，
   审批卡却在屏外。

### 关键事实（起草依据，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 待决批准项的唯一真源是面板的 `pendingApprovals` Map（父会话；子运行另有 `taskApprovals`） | `src/harness-panel.ts:4130`、`:4183` |
| F2 | 决策时 `pendingApprovals.delete(id)`，卡就地收敛为终态记录 | `src/harness-panel.ts:7424`、`:7114` |
| F3 | 只有停止 / 中断收回全部待决项：撤卡、解壳回工具行、`pendingApprovals.clear()`；**done / error 今天不走这条清理**（缺陷） | `src/harness-panel.ts:8776-8791`、`:8729-8745`、`:8801-8815` |
| F4 | 清面（换会话 / 切 vault / 新会话）清空 `pendingApprovals` 与 `decidedApprovals` | `src/harness-panel.ts:9291-9300` |
| F5 | 快照回填按 `pending_approvals` 列表逐项重建（事件与快照同一份解析）；列表只在在途时有意义，空闲相位按陈旧项处理 | `src/harness-panel.ts:9176-9205`、`:8553-8566` |
| F6 | 阶段行三档文案由 `applyStage()` 一处落 DOM，`stopping` 优先 | `src/harness-panel.ts:5992-5999` |
| F7 | 标题栏活动状态的三处承载（`data-activity` / 视觉隐藏的 `aria-live` 文本 / `title`）由 `applyActivityBadge()` 一处写 | `src/harness-panel.ts:5976-5990`、`:3481-3490` |
| F8 | **面板打开（分栏）时 toggle 钮被既有退让条款隐藏**——活动徽标因此不在屏上 | `src/main.ts:754-757`（`setChromeRetreat`）、`src/harness-panel.ts:10104-10106`；现场 `tests/visual/scenes/m303-harness-panel.spec.ts:129`、`harness-async-adversarial.spec.ts:421` |
| F9 | 面板打开时标题栏在场的是 harness 段 `.lumir-hp-seg`（会话名 + 新建会话钮） | `src/harness-panel.ts:3496-3538`、`:10071` |
| F10 | 进度块挂在 transcript 视口之外、composer 之上；进度块显隐使 transcript 视口高度变化约 28px | `src/harness-panel.ts:3927`、`src/harness-scroll-lock.ts:148-155`、`src/harness-panel.css:1789-1807` |
| F11 | 发送在 `appendUserMessage` 内先回底一次；此时 composer 仍有卡片、进度块尚未出现；清 composer 与进度块显隐都发生在这次写底之后 | `src/harness-panel.ts:6107-6142`、`:9512-9517` |
| F12 | 跟滚阈值与两态判据只有一份实现（`FOLLOW_ATTACH_PX` 6 / `FOLLOW_DETACH_PX` 16），脱离态零写入 | `src/harness-scroll-lock.ts:35-39`、`:175-237` |
| F13 | 子运行透传的批准卡挂在任务区（transcript 之外），是「审批可见面放在滚动区外」的既有先例 | `src/harness-panel.ts:8048`、`:3910-3927` |
| F14 | 终态对账（`content`）不改相位；done / error 先派终态再请求快照，因此快照落地时相位已是 idle | `src/harness-panel.ts:8741`、`:8810`、`:9102`、`:9211-9214` |
| F15 | 进入快照（`enter`）**不清面**；其调用点只有构造（空面）、`vaultChanged`（先 `resetView`）、`reloadSession`（先 `resetView`） | `src/harness-panel.ts:9123`、`:9425`、`:9458`、`:9691-9695` |
| F16 | 重新打开面板经 `attachTo` 挂回，**不调** `fetchSnapshot()`；跨开合保留的是本地状态 | `src/harness-panel.ts:10015-10060` |

结论：修复不需要新后端事件或快照字段；需要的是**一个派生状态（待批）+ 两个同源的可见承载
（段状态词 / toggle 徽标）+ 单一写点与完整清算**，以及发送路径的一处最终几何回底。

### 为什么现在做

- 这是「误判卡死」的直接成因，且随长回答 + 上滚阅读的组合稳定复发；不是偶发观感问题。
- 改动自包含：不碰消息语义、复制源、后端协议、跟滚阈值与两态判据。
- **今天**阶段行在 transcript 之外（F10），单加档就能让脱离态用户看到；但
  `move-harness-progress-to-output-tail-nov23` 会把进度搬进 transcript，届时该信号随内容滚出
  视口。因此本 change 同时立标题栏信号，不把修复建立在「进度恰好在滚动区外」这个会消失的位置上。
- 与 `move-harness-progress-to-output-tail-nov23` 是**顺序依赖**：本 change 先把「滚动区外必须
  有审批信号」立成不变量，尾行提案再以它为前置（见「与相邻 change 的关系」）。

## What Changes

### 1. 阶段行新增「等待批准」档

阶段指示由三档文案扩为四档：等待响应 / 生成中 / **等待批准** / 停止中。

- 判据：相位为 `running` 且**当前会话**的 `pendingApprovals` 非空。判据只有这一个来源，
  MUST NOT 由事件种类、相位、文案、计时或另一枚本地布尔推断。
- 优先级：**停止中 > 等待批准 > 等待响应 / 生成中**。用户已点停止时读「正在停止…」，
  MUST NOT 因待决项尚未收回而误读成「等待批准」。
- 没有待决项时 MUST NOT 出现该档：等待响应 / 生成中照旧；这是「无审批不误报」的对照组。
- 阶段行文案为「等待批准…」（与既有三档同族的省略号形态）；实现期取 **D976**（deck 末位 D975
  之后——`global-line-numbers-toggle-nov23` 先落，占 D972–D975）。

### 2. 标题栏同源提示：两个互斥可见的承载，同一份状态

标题栏 SHALL 提供**滚动区外**的审批信号，且不随 transcript 滚动：

- **面板打开时**：标题栏 harness 段 `.lumir-hp-seg`（F9）在待批期间显示状态词「等待批准」。
  它是可见文本、`flex: none`、优先于会话名占位（会话名先省略），MUST NOT 被段的溢出裁切吞掉。
- **面板收起时**：既有 toggle 钮的活动状态承载同一状态——`aria-live` 状态文本与悬停提示
  都由「处理中」改读「等待批准」（F7）。状态点的形状与配色保持既有「在途」档，MUST NOT 为
  待批新增第四种形状 / 颜色。
- 两者同源（同一判据、同一文案键），且**互斥可见**：段在面板收起时隐藏，toggle 在面板打开时
  隐藏（F8）。同一时刻只有一个可见承载，也只有一个 `aria-live` 区域在场，MUST NOT 双显 / 双播报。
- 状态词随界面语言重绘；eink 下不引入彩色（文字取 `--pending`，三主题均有定义）。
- 窄段下状态词 MUST NOT 被裁切：会话名链路（`.lumir-hp-sessionwrap` / `.lumir-hp-session` /
  `.lumir-hp-sname`）全部允许收缩并设 `min-width: 0`，状态词与新建钮 `flex: none`；测试必须制造
  「窄段 + 长会话名」，断言状态词与加号钮都在段矩形内，且会话名较无待批时确实变窄。

### 3. 单一写点与完整清算

- 派生判据只有一处：`hasPendingApprovals()`（`pendingApprovals.size > 0`）。`applyStage()` 与
  `applyActivityBadge()` 都读它；段状态词由同一份施加函数写。MUST NOT 在批准事件处理器里另写
  一份文案或可见性逻辑，MUST NOT 引入与待决集合并行的本地标志。
- 下列每个出口 SHALL 经同一路径重施一次，且 MUST NOT 残留「等待批准」幻影（阶段行 / 段状态词 /
  toggle 状态 / `aria-live` 文本四处都不得残留）：
  - 批准项到达（非 `idle` 时落卡 + Map 写入之后）；
  - 采纳 / 拒绝（`pendingApprovals.delete` 之后）；
  - 终态统一撤回（`done` / `error` / `aborted` 撤卡 + 清集合之后，施加终态之前）；
  - 进入快照 / 中途接管（相位回填之后、在途待决列表重建之后；`enter` 的前置清面由调用点保证）；
  - 终态对账快照（清面 + 重放之后；空闲列表按 stale 丢弃）；
  - 切会话 / 切 vault / 新会话（视图复位，相位回 idle）。
- **进入快照不自身清面**：`enter` 的全部调用点 SHALL 保证在此前已完成视图构造（空面）或
  `resetView`（清面 + 清待决集合）；这是前置不变量，`restoreSnapshot` 只按列表重建，不能替代清面。
  终态对账（`content`）才是「先清面再重放」；列表为空时旧待决集合 MUST NOT 残留。
- **终态统一撤回**：`done` / `error` / `aborted` 任一终态收尾时，仍挂在待决集合里的批准项 SHALL
  在同一同步批次内撤回——撤卡、恢复工具行并标注未执行（done / error；新增文案键）或已停止
  （aborted，沿用 D383）、清空集合、使决策闭包失效；MUST NOT 只隐藏状态词而留下可点的卡。
  `done` / `error` 今天没有这条清理，是本 change 要补的缺陷。
- **新一轮前清 stale**：`sent` / `auto_turn_started` 开始前，若上一相位为空闲，再清一次上一视图
  遗留的待决项，使新一轮 MUST NOT 继承旧待批（覆盖「旧快照缺在途读数、带待决卡、相位 idle」的
  反例）；处理中的轮次不清合法待批。
- 相位为 `idle` 时 MUST NOT 存在可见待批状态或可决策卡：快照中的待决列表按陈旧项丢弃（不落卡、
  不入集合），live 批准请求在空闲相位同样按陈旧处理；旧快照缺在途读数时 MUST NOT 伪造在途。
- 同一待批集合期间状态词 MUST NOT 闪烁或重复播报（文本值不变即不重播）。

### 4. 子运行边界

子运行透传的批准卡不计入本条判据（F13）：它们由任务区承载、本就在 transcript 之外可见，
且当前会话未必在等该决策。父会话的阶段行与标题栏 MUST NOT 因子运行的待批项翻成「等待批准」。
父会话自己的 `pendingApprovals` 为空时，子运行卡再多也不改变父会话状态。

### 5. 滚动合同不变；发送按最终几何回底一次

- 待批状态的出现、退场与文案切换 MUST NOT 写滚动位（`scrollTop` 变化 ≤ 1px）、MUST NOT 强制
  回底、MUST NOT 点亮未读。批准卡本身到达仍按既有「新内容」口径处理（脱离态只点亮未读）。
- 跟滚阈值（回底容差 / 脱离阈值）、两态判据、输入通道判据 MUST NOT 因本 change 改动；MUST NOT
  在内容增长 / 尺寸变化时自动复跟；MUST NOT 用强制回底掩盖脱离态合同。
- 发送仍是既有「强制回底白名单」动作。发送时输入区清空（卡片移除）与进度块显隐都会改变
  transcript 的几何，而既有写底发生在这些变化之前（F11）：写底值按「卡片仍在输入区、进度块
  尚未出现」的旧几何计算，留下一个未贴底窗口。发送函数 SHALL 在同步布局稳定后（composer 已清、
  进度块已显隐落定）**再执行一次回底**（幂等），使写底值、回声基准与最终滚动上限一致。
  该第二次回底 MUST NOT 扩散到非白名单事件（批准卡、流式增量、工具行、通知、错误行、终态）。

### 6. 规格与验收回扫

- `harness` 的「进度呈现」用 **MODIFIED** 整块替换（整条复制现行正文再改）：四档状态矩阵、
  优先级、滚动区外信号、清算矩阵、滚动合同与发送最终几何都并入该条。
- 回扫既有验收场景读阶段行 / 活动状态的断言：88（等待响应）、97（流式可见）、104（停止即时性）、
  110 / 151（批准卡）、252 / 253（活动在场）——本 change 不改编既有三档文案与三态语义，期望应
  逐字不变；实现后全量跑一遍确认。
- 视觉场景扩展：`m347-harness-composer`（阶段行待批档 + 无审批对照、idle 遗留待批 → 发送）、
  `m756-harness-activity-presence`（toggle 状态 + 面板收起本地保留 + enter/content 两种快照 × 空/非空
  × 面板开/收 + 终态撤回 + 新一轮不复活）、`m638-harness-scroll-lock`（先上滚后审批到达的未读与
  不动视口 + 待批后上滚不强制未读 + 引用卡发送的最终几何）、`m384-harness-approval-decided`
  （改用 `in_flight:true` 或先 `sent` 的 running 桩；决策前正断言待批，覆盖多项/最后一项/回落，
  MutationObserver 验不重复播报）。
- 新增真机场景一条（编号实现时按套件当前最大值 +1 分配，不预占）：覆盖引用卡发送 → 上滚 →
  待批 → 标题栏信号 → 回底 → 决策 → 撤回；截图证据留 `.local/acceptance/`。
- 窄段几何断言：标题栏段压窄 + 长会话名时，状态词与加号钮都在段矩形内，会话名宽度较无待批时变小。
- 视觉基线：本 change **不执行** `--update`。待批是新的运行态像素，只出候选截图（`.local/`）；
  idle 态与无待批的运行态既有基线应零漂移。

## Non-goals

- 不搬进度指示的位置（属 `move-harness-progress-to-output-tail-nov23`），不改阶段行的现有三档文案。
- 不改跟滚阈值、滞回取值、自动复跟语义、输入通道判据。
- 不在批准卡到达 / 快照回填时强制回底——那是既有 spec 与场景的明文禁止。
- 不做脱离态浮钮的强调态、不做常驻 sticky 提示（备选，见 D6；若 Alex 认为段状态词不够再单开）。
- 不改后端事件协议、快照字段、Rust 命令；不重设计**有效 running 待批卡**的布局与决策操作。
  终态统一撤回（done / error / aborted 撤卡、标未执行 / 已停止）与 idle 待批按 stale 丢弃
  （不渲染可决策卡）属于本 change 的明确行为变化，不在 Non-goal 内。
- 不把子运行待批计入父会话状态；不改任务区的既有可见面。
- 不更新视觉基线；不碰 `docs/backlog.md`（本 change 无既有 backlog 条目，归档跟踪条目在实现 PR 落）。

## 节点 1 裁决点（D1–D6，待批）

| # | 裁决点 | 推荐值 | 备选 / 代价 |
|---|---|---|---|
| **D1** | 阶段行待批文案 | **「等待批准…」**（与 D416「等待批准」同词，加省略号同 D381 族） | 「等你批准…」/「需要你批准…」：更口语，但与工具行尾注、标题栏状态不同词，需多一条映射且三处读法不一致 |
| **D2** | 面板打开时的滚动区外信号落在哪 | **标题栏 harness 段 `.lumir-hp-seg` 的状态词**（面板打开时可见；面板收起时由 toggle 徽标承担同一状态） | ① 让 toggle 钮在待批时强行显示：该钮在分栏态是隐藏的退让对象，点它还会关面板，语义混淆；② 只做脱离态浮钮强调：不新增元素，但只在已脱离时可见，跟随态没有滚动区外信号，且「回到底部」钮的名字会被读成「点击批准」；③ sticky toast：新浮层，遮挡与关闭成本最高 |
| **D3** | 待批与停止的优先级 | **停止中 > 等待批准 > 等待响应 / 生成中** | 待批最高：用户已点停止时还读「等待批准」，与「正在停止」的即时反馈相反 |
| **D4** | 子运行待批是否计入父会话 | **不计入**（任务区已可见） | 计入：父会话会在自己没等决策时误报「等待批准」，且任务区与标题栏双信号互相矛盾 |
| **D5** | 发送末尾按最终几何再回底一次 | **做，仅发送白名单** | 不做：卡片移除 / 进度块出现留下未贴底窗口（实现期实测已把缺口方向改写为准：净缺口 = 进度块高度 − 被移除的输入区高度；composer 高度不变的纯文本发送实测 28px，46px 引用卡路径被浏览器夹回上限——见 design §5.2 的实现期实测） |
| **D6** | 是否加脱离态浮钮强调态 / sticky 提示 | **不加**，留作备选 | 加：标题栏信号之外再叠一层可见面，浮钮语义从「回底」变成「待批准」有歧义；若 D2 批准后仍觉得不够醒目，再单开一条 change |

D1 / D2 是文案与可见面的产品取舍；D3–D5 是行为口径；D6 是明确的「不默认扩面」重申。

## 与相邻 change 的关系（顺序依赖，不合并）

`move-harness-progress-to-output-tail-nov23`（下称「尾行提案」）把进度指示从 transcript 外搬到
transcript 内的输出尾行；它的 design §9.7 已承认「脱离态看不到尾行」。本 change 与它是
**有序链**，不是同一个 change：

1. **本 change 先落**：先立「待批状态 + 滚动区外审批信号 + 清算矩阵」。归档后 living spec 的
   「进度呈现」含这些条款。
2. **尾行提案后落**：它的 MODIFIED 块必须以本 change 归档后的 living 为基线**整块重抄**，
   并把「滚动区外必须有审批信号」写成不变量——尾行移入滚动区 MUST NOT 削弱标题栏信号；
   其 design §9.7 的「脱离态看不到尾行」只描述进度指示本身，不覆盖审批信号。
3. 不合并的理由：尾行提案的 D1–D6 全未裁，位置决策与一个新的可见性合同绑在一起会互相污染
   裁决面；本 change 是已批方向的收口，尾行提案是未裁的位置决策。
4. 取号顺延：`global-line-numbers-toggle-nov23` 先落并占用 D972–D975，本 change 实现期顺延取
   D976–D977；尾行提案的「正在继续本轮…」候选号 D972 须以本 change 归档后的 deck 末位复核，
   不在提案期硬占。
5. 尾行 change 的 `tasks.md` 已加硬前置门禁：本 change 归档且 `--archived` PASS 之前不得开始；
   其 MODIFIED 块必须重抄本 change 归档后的 living，优先级合并为
   `stopping > approval > midTakeover > waiting/generating`，并补尾行内待批与标题栏信号的集成测试。

## Impact

- 影响的 specs：`harness`（MODIFIED「进度呈现」）。
- 影响的代码 / 系统：
  - `src/harness-panel.ts`：`applyStage` / `applyActivityBadge` 的派生判据与文案；`.lumir-hp-seg`
    的状态词节点；`appendApproval` / 决策 / 停止撤回 / 清面 / 快照回填后的同一路径重施；
    `send()` 末尾的最终几何回底。
  - `src/harness-panel.css`：段状态词的排版与显隐（只在待批时可见，idle 零像素）；会话名链路
    （wrapper / 按钮 / 名称文本）改 `flex: 0 1 auto` + `min-width: 0`，状态词与加号钮保持 `flex: none`。
  - `src/copy-data.ts` + `文案-Copy.md`：阶段行待批文案与 done / error 撤卡标签「未执行」
    （实现期取号）；D416 的消费点扩为工具行尾注 + 标题栏两承载（同一串，MUST NOT 另立同文重复键）；
    aborted 的 D383「已停止」不变。
  - 测试：`tests/unit/harness-approval-signal.test.ts`（新，纯判据）、
    `tests/unit/harness-panel-control.test.ts` 或同族接线断言、`tests/visual/scenes/{m347,m756,m638,m384}-*.spec.ts`、
    真机套件新增一条场景。
- 关联约束：
  - ADR 0002 第 6 条性能合同：待批是相位级状态，只在批准集合变化时写 DOM；流式分片路径零新增
    节点、零新增布局读取。
  - ADR 0004：节点 1 待批，未批准不进入实现。
  - 仓库信息卫生：视觉 / 真机 fixture 只用合成 vault 名、文件名与消息文本。
  - 视觉基线是人肉裁决点：本 change 不 `--update`，新运行态只出候选截图。

## 与 ADR 的关系

不需要 ADR：只改一个 capability 的呈现状态、一个滚动区外的可见信号与发送路径的一处幂等回底；
不改技术选型、不改分层、不改后端协议。

## 节点 2（归档记录）

**放行方式：机器 + 独立评审放行（`docs/process/openspec-workflow.md`「节点 2」五要件）。**
归档前读数时间：2026-11-24 11:43 +0800（Asia/Shanghai）。

### 归档前五要件

1. **方案已批准**：Alex 2026-11-24 对整条提案明确「同意」；D1–D6 按推荐值生效（见本文件「节点状态」）。
   实现期无静默扩 scope；r1–r4 评审发现的 P1/P2 均在同一 change 内收口。
2. **独立 reviewer clean / merge**：r4 复审 **`clean/merge`**，评审 tip
   **`7cde918f332fbd3af0c274785592d999f43614fc`**，报告
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/approval-visibility-nov24/review.md`。
   r4 之后只有两个 **test-only 验收场景**提交，不改产品 / 测试行为、不新增合同：
   `ec12558438a3e38c4a9f64a933e544b624ea503b`（composer inline cards 后的 `typeInNode` locator）与
   `983cad9336871521f85d983e9ba67329d1ff1738`（重开面板白名单回底后的回底步骤顺序）。
   r4 复跑：`pnpm test` 1899/1899、五场景结构 60/60、三套 tsc、`git diff --check` 通过。
3. **tasks 完成或放弃理由**：全部勾选。真机红侧的 1.8 / 1.9 放弃旧实现红跑（11:32–13:32 窗口
   只用于最终验收，未保留旧构建），理由与替代证据就地写在 tasks；不虚报真机红。
4. **门禁与真机证据**：
   - 完整视觉：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0，基线未更新
     （`/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/approval-visibility-nov24/gate-visual-final.log`）。
   - r4 单测 1899/1899、五场景结构 60/60、三套 tsc；rebase 后当前单测 1900/1900。
   - 真机首轮：10 个选中场景中 88 / 97 / 104a / 104b / 110 / 151 / 188 / 253 / 49（252）全 PASS；
     725 FAIL（composer inline cards 后旧 locator `Agent|avis-quote` 过期）。日志
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/approval-visibility-nov24/acceptance-725-related.log`，
     证据 `.local/acceptance/2026-11-24-approval-visibility/`。
   - 725 r2：越过输入定位后，在「点浮钮回底」FAIL——重开面板走 `attachTo` 既有白名单强制回底，
     浮钮按合同退场；场景顺序错误，非产品回归。日志 `.../acceptance-725-r2.log`，证据
     `.local/acceptance/2026-11-24-approval-visibility-r2/`。
   - 725 r3（test-only 修正 `ec125584` + `983cad93` 后）：**PASS 1/1，33.8s**。日志
     `.../acceptance-725-r3.log`，证据 `.local/acceptance/2026-11-24-approval-visibility-r3/`。
5. **规格对账无丢段**：
   - `node scripts/openspec-archive-check.mjs --change fix-harness-approval-visibility-nov23`：
     `PASS（扫过 1 份 delta，1 条 MODIFIED，对比 5 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目）`。
   - `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：`39 passed, 0 failed`。
   - `bash scripts/docs-check.sh`：PASS（含归档对账、链接、验收场景契约与 backlog 门禁）。
   - `git diff --check`：通过。归档跟踪队列条目唯一（`docs/backlog.md`）。

### 有序链位置

本 change 是有序链的**前一环**；后一环 `move-harness-progress-to-output-tail-nov23` 尚未实现，
其 tasks 已带硬前置门禁：必须以本 change 归档后的 living「进度呈现」为基线整块重抄，并把
「滚动区外必须有审批信号」写成不变量（见本文件「与相邻 change 的关系」）。

### 归档后

- **归档提交**：`12a21a972fe0f8e22cb94ddc940504c466a8692c`（2026-11-24）。
  归档目录：`openspec/changes/archive/2026-11-24-fix-harness-approval-visibility-nov23/`。
- **包装器输出**：`Change 'fix-harness-approval-visibility-nov23' archived as
  '2026-11-24-fix-harness-approval-visibility-nov23'`；`harness: update`（1 modified，+0 / ~1 / -0）。
- **修链**：`归档后修链 0 处（扫过 4 篇 Markdown / 3 条相对链接）`；
  `openspec-links: PASS（校验 685 条相对链接，全部可达）`；`openspec-archive: PASS`。
- **`--archived` 审计**：`PASS（openspec/changes/archive/2026-11-24-fix-harness-approval-visibility-nov23：
  1 条 MODIFIED，对比 5 段；人工恢复 0 段，声明认领 0 段）`，时间 2026-11-24T11:45:11+0800
  （Asia/Shanghai）。日志
  `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/approval-visibility-nov24/archive-audit.log`。
- **归档后 validate**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：
  `38 passed, 0 failed`（归档前为 39；归档后活跃 change 少一条）。
- 归档后仍保留的链约束：后一环 `move-harness-progress-to-output-tail-nov23` 必须以本归档后的
  living「进度呈现」为基线整块重抄，并把「滚动区外必须有审批信号」写成不变量。
