# Proposal: 把 harness 生成中进度移到 transcript 的输出尾行

- Change ID: `move-harness-progress-to-output-tail-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（方向裁决、节点 1），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1（提案评审）已批准**：Alex 2026-11-24 在解释进度尾行方案后回复「同意。」，D1–D6 全部按
>   本文件推荐值生效。批准只覆盖方向与裁决点，不代表本 change 已实现或已归档。
> - 本 change 未进入实现；`tasks.md` 的实现项全部未勾是刻意的。本次提交只做文档承接：把已裁事实、
>   两个前序的归档前置与 `refine-harness-typography-nov23` 的排版几何写进 proposal / design /
>   tasks / spec delta。
> - 本 change 只到提案层：living spec 的改动以 delta 形式留在本 change 目录内，归档时并入，不提前改写。

## 前置门禁（硬）

三项 change 的顺序固定为：

`fix-harness-approval-visibility-nov23` → `refine-harness-typography-nov23` → 本 change。

1. **两个前序都先归档**：任一前序未归档、或 `node scripts/openspec-archive-check.mjs --archived
   <change-id>` 未 PASS 之前，本 change **不得进入实现**，也不得归档。
2. **排版新基线先过 Alex**：`refine-harness-typography-nov23` 的候选视觉基线须经 Alex 逐张过目并
   批准落盘；未批准前本 change 不得施工，也不得把候选图当正式基线。
3. **delta 以两前序归档后的 living 为基线**：实现第一步是把两个前序归档后的 living「进度呈现」
   **整块重抄**进本 change 的 delta；当前 delta 只是承接草案（见 `specs/harness/spec.md` 的起草
   注记），不得直接当作最终基线，也不得提前改写 living spec。
4. **承接排版几何**（以 `refine-harness-typography-nov23` 归档后的 CSS / token 为准）：阶段行取
   `--text-2`；transcript gap 为 16px，尾行 2px 净间距公式为 `calc(var(--sp-2) - var(--sp-8))`；
   空态绝对定位四边 `top/right/left: var(--sp-8); bottom: var(--sp-6)`，并继承排版后的 13px/1.58、
   `--text-2`、24px padding。MUST NOT 恢复排版前的阶段色、间距公式或空态配方；排版归档后的
   living / CSS 是唯一基线。
5. **「idle 零漂移」只相对排版后的新基线**：以 `refine-harness-typography-nov23` 归档后的 idle
   空态 / 整页基线为对账起点；MUST NOT 承诺相对排版前旧基线的零漂移，也不得为凑零漂移改回排版前
   旧值。
6. 合并后的文案优先级 SHALL 为 `stopping > approval > midTakeover > waiting/generating`。
   `approval` 是前置 change 的 `pendingApprovals` 派生信号，不是新相位；待批优先于中途接管——
   接管期有 pending 时读「等待批准…」，不读「正在继续本轮…」。
7. 集成测试必须覆盖：尾行在 transcript 内时，`enter_snapshot(in_flight=true) + pending` 读
   「等待批准…」且标题栏审批信号仍在；脱离态下待批到达时标题栏信号仍在、`scrollTop` 不变。

## Why

### 现场

harness 的「生成中进度」今天是挂在 transcript 滚动区**之外**、composer 之上的固定块：
`src/harness-panel.ts:3927` 的 `panel.append(transcriptViewport, progress, taskArea, composerArea)`。
它由两件东西组成——阶段行（等待响应 / 正在生成回复 / 正在停止）与 3px 不定态条
（`src/harness-panel.ts:3706-3718`），显隐只由相位翻一位 `progress.hidden`（`:5903`）。

位置带来的两个症状：

1. **视口高度变化，阅读被拽动**。进度块显隐时 transcript 视口高度 ±约 28px（阶段行 + 条形 +
   间距）。跟滚控制器里有一条历史现场就记着这个尺寸（`src/harness-scroll-lock.ts:148-155`：
   「发送后进度条占掉 28px 视口高」）。视口变矮后浏览器会夹取滚动位；脱离态上滚阅读时，
   轮次开始 / 结束会让阅读行轻微移动。移到尾行后，这类变化从「视口变矮」变成「内容变高」——
   跟滚模型必须把「布局变化」与「新内容」分开，否则尾行出现会被读成新内容、点亮假未读
   （处置见 What Changes 第 3 节第 5 条与 design §5）。
2. **语义错位**。进度说的是「本轮还在产出」，是**输出**的状态；挂在输入区上方，读者会先把它
   读成 composer 的状态，再反应过来它是这一轮回复的。

### 为什么现在做

- 这是位置造成的结构性问题，不是文案或动画问题；dogfood 里长回答 + 上滚阅读的组合会稳定撞上。
- 改动自包含：一个元素的位置 + 一处相位施加 + 一条跟滚入口；不碰消息语义、复制源、快照重建、
  后端协议与事件类型。

### 关键事实（起草依据）

- **等待期没有 assistant 元素**：`ensureStreamingMessage` 只在首个 `reasoning_chunk` / `tool_call` /
  `text_chunk` 到达时才建流式泡（`src/harness-panel.ts:7606-7614`）；发送后、首个分片前，transcript
  里没有任何本轮 assistant 宿主。把进度塞进消息内部在这段没有落点。
- **首个产出不一定是正文**：思考分片与工具调用都可能先于正文到达；现行代码只有 `text_chunk`
  把 `stageWaiting` 翻假（`src/harness-panel.ts:8498-8503`），所以「先调工具、全程无正文」会一直
  停在 D381。阶段推进必须改为三者任一。
- **中途接管也可能没有宿主**：进入快照报 `in_flight=true` 时，本轮可能尚无 assistant 元素；
  尾行方案对它天然成立。
- **transcript 是 flex 列**：`overflow-y: auto`、`display: flex`；施工基线取排版归档后的
  `gap: var(--sp-8)`（16px）与 `16px 16px 12px` 外侧 padding（`refine-harness-typography-nov23`），
  视觉序可由 `order` 控制；子项自身的 `padding` 会与容器左右 padding 叠加。
- **空态判据按子节点数**：`syncEmptyHint()` 用 `transcript.childElementCount > 1` 判「有内容」
  （`src/harness-panel.ts:6044-6049`）；尾行进入 transcript 后必须把这个判据改准，否则空态提示
  会被误撤。

## What Changes

### 1. 位置：transcript 内的输出尾行（单一元素）

进度改为 transcript 滚动区**文档流内**的最后一个兄弟节点，不再挂在 composer 上方：

```
.lumir-hp-transcript-viewport          ← 视口层（「回到底部」浮钮仍在这一层）
  .lumir-hp-transcript                 ← 滚动容器
    … 用户气泡 / assistant 块 / 工具块 / 通知 / 错误行 / 批准卡 …
    .lumir-hp-progress                 ← 唯一一行；running 时显示，idle 时 display:none
  .lumir-hp-jumpbottom                 ← 浮钮，不随内容滚动
```

- **不采用浮层贴底**：浮层要靠在滚动内容上补底 padding 才能不压字，padding 变化又会改滚动几何，
  与跟滚模型互相牵扯（REVIEW.md「新增 / 修改 overflow 容器没先定档」同族风险）。
- **不塞进 assistant 消息内部**：会与 `finalizeStreamingMessage`、工具块封板、快照重建、复制源
  耦合；消息元素一被替换就要重新挂载；等待期与中途接管期没有宿主。
- **单一元素**：跨相位复用同一节点，文案原地切换；相位跃迁 MUST NOT 重建、替换或重新插入。
- **顶层追加唯一入口**：新增 `appendTranscriptNode()` 作为 transcript 顶层追加的唯一 helper；
  另设 `childList` 观察器兜底，任何绕过 helper 的追加（compact 标记、孤儿工具记录、快照
  assistant、未来新增路径）都会被重新置尾。MUST NOT 靠逐个调用点手工枚举。
- **空态几何独立**：空态提示改为按排版归档后的**内容盒中心**绝对定位（`top/right/left:
  var(--sp-8); bottom: var(--sp-6)` + `grid` 居中；MUST NOT 用 `top:50%` 直接居中，会相对排版后的
  idle 中心整体上移 2px），尾行出现 / 消失不改变它的位置；字号 13px/1.58、`--text-2`、24px
  padding 继承排版 change，本 change 不再改。
  判据是提示 `top` 位移 ≤1px，且本 change 施工前（排版归档后）与新 idle 的中心差 ≤1px；正控制用
  尾行自身矩形（空态下 `scrollHeight` 有 `clientHeight` 下限，不能单独作正控制）。

### 2. 状态矩阵（逐条写死）

| 状态 | 尾行 | 文案 | 条形 |
|---|---|---|---|
| 空闲 / 面板收起后重开 | 不显示（零像素、不参与 flex 间距；节点可能暂时不在 transcript 内） | — | — |
| 已发送、首个有效助手产出前 | 显示 | D381 等待响应… | 不定态滑动 |
| 生成中（含工具循环） | 显示，原地换字 | D382 正在生成回复… | 不定态滑动 |
| 停止中（`stopping`） | 显示 | D400 正在停止… | **冻结**（无位移、无脉冲） |
| 运行中待批（非接管） | 显示，原地换字 | 「等待批准…」（前置 change 提供） | 不定态滑动 |
| 中途接管（进入快照 `in_flight=true`，无待批） | 重建后挂尾 | 新增「正在继续本轮…」（D972 候选，见 D3） | 不定态滑动 |
| 中途接管 + 待批 | 重建后挂尾 | **「等待批准…」**（待批优先于接管，MUST NOT 读「正在继续本轮…」） | 不定态滑动 |
| 正常结束 / 出错 / 用户停止 | **终态处理前先隐藏** | — | — |
| 从历史恢复（不在途） | 不显示 | — | — |
| 自动回合（唤醒链） | 同「已发送」 | D381 → D382 | 同上 |
| 点击发起的 cron 运行 | 同「已发送」 | 同上 | 同上 |

工具循环期间**不新增第三档文案**（D4）：工具行已经在说「正在调用什么」，尾行重复一遍是噪声。

「首个有效助手产出」= `reasoning_chunk` / `tool_call` / `text_chunk` **任一**；三者共用一处推进
函数。不能只由 `text_chunk` 推进——模型先思考或先调用工具、全程没有正文的轮次同样已经离开
「等待响应」。

### 3. 不变量（评审按这几条核）

1. **最后可见项**：运行中尾行恒为 transcript 的最后可见内容；新内容（流式段、工具块、通知、
   错误行、批准卡）到达后它仍在其后。视觉序由 `order` 保证，DOM 序也置尾（读屏 / 全选顺序）。
2. **不遮挡**：尾行在文档流里占位，不与正文重叠；不引入浮层、不补底 padding。
3. **不跳动**：单行（nowrap + ellipsis），高度与文案 / 语言无关恒定；条形 3px 恒定；相位切换
   MUST NOT 重建节点、MUST NOT 改高度、MUST NOT 改与上方内容的间距；尾行出现 / 消失 MUST NOT
   移动它上方的任何内容。
4. **空态排除尾行**：空态提示的在场判定 MUST 排除尾行（尾行不是内容）。
5. **detached 不假未读**：尾行显隐是布局变化、不是新内容；脱离态下 MUST NOT 点亮未读，
   MUST NOT 改变阅读位置（`scrollTop` 变化 ≤ 1px）；未读基线随该布局变化重设。
6. **终态先离场**：`done` / `aborted` / `error` 分支 SHALL 先隐藏尾行，再追加「已停止」标记或
   错误行，避免「进度还在跑、下面已有结果」的误读。
7. **单一写点**：尾行的显隐、文案与条形形态由面板的相位施加函数一处落 DOM；流式分片的
   「等待 → 生成」推进 MUST NOT 另写一份可见性或位置逻辑。
8. **eink 口径不变**：明度 / 线宽表达、无彩色；停止态冻结在 eink 下同样成立。
9. **空态几何独立**：空态提示的位置 MUST NOT 随尾行显隐变化；不能靠 flex 剩余空间分配（auto
   margin）居中，否则尾行一出现提示就会移动。
10. **顶层追加唯一入口**：transcript 的所有顶层追加经唯一 helper 置尾；另设 childList 运行时
    兜底，覆盖 compact 标记、孤儿工具记录、快照 assistant 等全部路径，MUST NOT 依赖人工枚举
    调用点。

### 4. 规格与验收回扫

- `harness` 的「进度呈现」用 **MODIFIED** 整块替换（整条复制现行正文再改）：位置、状态矩阵、
  不变量、停止冻结、中途接管文案、空态与跟滚的口径都并入该条。
- 回扫既有验收场景：88 / 97 / 104 读的是阶段行的 AX 文本（`等待响应…` / `正在生成回复…` /
  `正在停止…` 的在场与离场），本 change 不改编文案，期望应逐字不变；实现后全量跑一遍确认。
- 视觉场景 `m347-harness-composer.spec.ts` 的进度断言需要从「可见 / 文案」增强为「在 transcript
  内、是最后可见子项、高度恒定、停止态无动画」；`m638-harness-scroll-lock.spec.ts` 扩展
  「脱离态下轮次开始 / 结束不拽视口、不假未读」。
- 新增真机场景一条（编号实现时按套件当前最大值 +1 分配，不预占）：覆盖等待 / 生成 / 停止 /
  终态四个状态的尾行位置与文案，截图证据留 `.local/acceptance/`。
- 视觉基线：本 change **不执行** `--update`。running 态的新像素只出候选截图（`.local/`），
  idle 态相对**排版归档后的新 idle 基线**零漂移（不以排版前旧基线为对账起点）；确需更新时按人肉
  裁决点先送 Alex 过目。

## Non-goals

- **不改排版**：transcript gap / padding、阶段行颜色、空态字号与配色全部由
  `refine-harness-typography-nov23` 承担并先落盘；本 change 只承接、不提前移动进度、不改排版值，
  MUST NOT 恢复排版前的阶段色、旧间距或旧空态偏移。
- 不改阶段行 / 条形文案（中途接管新增一句除外，见 D3；前置 change 提供的待批文案不在本 change
  的改动面内），不新增百分比、耗时或 token 读数。
- 不改工具行的呈现与折叠口径；不加第三档「正在执行工具…」。
- 不改发送钮两态、不改后端事件协议、不改快照字段、不新增 Rust 命令。
- 不做浮层、不做常驻角标、不做动画曲线微调、不新增全局键位。
- 不改消息元素内部结构（复制源、快照重建、空消息规则都不动）。
- 不更新视觉基线；不碰 `docs/backlog.md`（本 change 无 backlog 条目）。
- 不改审批可见性 / 待批状态：该能力由前置 change `fix-harness-approval-visibility-nov23` 提供；
  本 change 只保证尾行移入 transcript 后不削弱它，MUST NOT 重写或删除其条款。

## 节点 1 裁决点（D1–D6，已批准）

Alex 2026-11-24 回复「同意。」，以下推荐值全部生效；批准原话已回填文首节点状态块。

| # | 裁决点 | 推荐值 | 备选 / 代价 |
|---|---|---|---|
| **D1** | 进度放在哪 | **transcript 内的输出尾行**：文档流占位、跨状态同一元素、不遮挡、不抢布局 | 塞进 assistant 消息内部：视觉上更「属于这一轮」，但与消息定稿 / 工具块封板 / 快照重建耦合，等待期与中途接管期无宿主；浮层贴底：要补底 padding，改滚动几何 |
| **D2** | 停止态条形 | **冻结**（`animation: none`，条形回到静态基准位） | 继续滑动：运动暗示「还在推进」，与「停止」语义相反；用户会误以为停止没生效 |
| **D3** | 中途接管文案 | **新增一句「正在继续本轮…」**（拟取 D972，实现前按 `文案-Copy.md` 末位复核） | 复用 D382「正在生成回复…」：不新增文案，但接管期还没开始生成，读数不准确；且无法与普通生成区分 |
| **D4** | 工具循环期文案 | **维持 D382**，工具细节归工具行 | 新增第三档「正在执行工具…」：与工具行重复，且要多一条状态与文案 |
| **D5** | 是否保留 3px 不定态条 | **保留**（spec 现行要求；eink 靠明度表达） | 只留文字：更安静，但「处理中」的连续信号只剩文字，长工具循环的可感知性下降 |
| **D6** | 视觉基线怎么处理 | **本次不 `--update`**：running 态只交候选截图，idle 基线相对排版归档后的新基线零漂移；确需更新时人肉裁决点先过 Alex | 机械 `--update`：违反基线纪律，且会把「位置变化」静默吞掉 |

D1–D5 是行为 / 观感取舍；D6 是既有流程的重申，列出来是为了让实现者不要顺手更新基线。

**D3 的边界**：新句只在接管期且**没有待批项**时使用；待批优先于接管（前置 change 的硬要求），
不得用「正在继续本轮…」覆盖「等待批准…」。

## Impact

- 影响的 specs：`harness`（MODIFIED「进度呈现」）。
- 影响的代码 / 系统：
  - `src/harness-panel.ts`：进度节点的挂载位置、顶层追加 helper 与 `childList` 兜底、
    `applySendPhase` / `applyStage`、首个有效产出推进、终态分支次序、中途接管标志、空态判据。
  - `src/harness-panel.css`：尾行在 flex 列中的 `order` / `margin` / 单行省略 / 停止冻结；空态
    提示的独立居中。
  - `src/harness-scroll-lock.ts`：跟滚控制器新增一个「布局变化」入口（非内容增长）。
  - 测试：新增「尾行内待批 + 标题栏信号」集成断言（`enter_snapshot(in_flight=true) + pending`
    → 等待批准；脱离态待批 → 标题栏信号仍在、`scrollTop` 不变）；`tests/unit/harness-scroll-lock.test.ts`、新的纯模型单测、
    `tests/visual/scenes/m347-harness-composer.spec.ts`、`tests/visual/scenes/m638-harness-scroll-lock.spec.ts`；
    真机套件新增一条场景。
  - `文案-Copy.md`：中途接管一句（D3 批准后取号）。
- 关联约束：
  - ADR 0002 第 6 条性能合同：尾行只在相位跃迁时改 DOM；流式分片路径零新增节点、零新增布局
    读取；不定态动画只作用于 `transform` / `opacity`。
  - ADR 0004：节点 1 已批准（2026-11-24）；实现仍受两个前序归档与排版基线批准的前置门禁约束。
  - 仓库信息卫生：视觉 / 真机 fixture 只用合成 vault 名与路径。

## 与相邻 change 的关系（有序链，后落）

顺序固定为 `fix-harness-approval-visibility-nov23` → `refine-harness-typography-nov23` → 本 change。

- **第一前序**：`fix-harness-approval-visibility-nov23`（待批状态 + 滚动区外审批信号 + 清算）。
  它先归档；本 change 的实现与 delta 基线都必须等它归档且 `--archived` PASS。
- **第二前序**：`refine-harness-typography-nov23`（阅读密度、720px 阅读宽、任务文字 `--text-2`、
  横线表、composer / 空态排版）。它必须紧随审批可见性之后归档，且其新视觉基线经 Alex 批准落盘；
  本 change 继承它的阶段行 `--text-2`、16px transcript gap 与 `16px 16px 12px` 外侧 padding、
  空态 13px/1.58 / `--text-2` / 24px padding。
- **本 change 的约束**：MODIFIED 块整块重抄**两个前序归档后**的 living；优先级
  `stopping > approval > midTakeover > waiting/generating`；标题栏审批信号 MUST NOT 因尾行移入
  transcript 而消失（design §9.7）。
- **不合并**：两个前序各自解决已裁的审批可见性与排版问题，本 change 是位置决策；合并会污染
  裁决面与基线归属。
- **取号**：前序 change 可能先占用 deck 新号；本 change 的 D3 候选号（起草时为 D972）在实现前
  按 `文案-Copy.md` 末位复核，不硬占。

## 与 ADR 的关系

不需要 ADR：只改一个 capa 的呈现位置与一条跟滚入口，不改技术选型、不改分层、不改后端协议。
