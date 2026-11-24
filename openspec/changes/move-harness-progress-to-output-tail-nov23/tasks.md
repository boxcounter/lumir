# Tasks: move-harness-progress-to-output-tail-nov23

> 施工前提：节点 1 已批准——Alex 2026-11-24 回复「同意。」，D1–D6 全部按 `proposal.md` 推荐值生效。
> 本次提交做基线同步与文档承接，实现项一律未勾；未勾项不删除，放弃的就地写理由。
>
> **硬前置（有序链）**：`fix-harness-approval-visibility-nov23` →
> `refine-harness-typography-nov23` → 本 change。审批前序已归档并 `--archived` PASS；排版前序仍未
> 归档。两个前序都归档且 `--archived` PASS、排版新视觉基线经 Alex 批准落盘之前，不得实现、不得归档
> （见 §0.6–0.11）。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：Alex 2026-11-24 回复「同意。」，D1–D6 按推荐值生效；批准原话已抄进
      `proposal.md` 文首节点状态块与节点 1 裁决表
- [ ] 0.2 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」
      「断言等价于子串」「新增 / 修改 overflow 容器没先定档」）
- [ ] 0.3 不改后端命令 / 事件协议 / 快照字段；不新增 Rust 用例。若实现中发现必须动后端，停下走
      影响面升级线，不静默扩 scope
- [ ] 0.4 中途接管文案取号：D3 已批准新增「正在继续本轮…」；按 `文案-Copy.md` 当前末位 +1 取一个
      未占用号（起草时末位 D971），实现前复核，避免与并行 change 撞号；**前序 change 可能先占用
      新号**，取号以其归档后的末位为准
- [ ] 0.5 本 change **不执行**视觉基线 `--update`；running 态新像素只出候选截图（见 5.3）
- [x] 0.6 **硬前置①**：`fix-harness-approval-visibility-nov23` 已归档并
      `node scripts/openspec-archive-check.mjs --archived fix-harness-approval-visibility-nov23` PASS
      （归档提交 `12a21a97`，审计记录 `ab6ef4ad`，合并 `bae7b47f`）
- [ ] 0.7 **硬前置②**：确认 `refine-harness-typography-nov23` 已归档且
      `node scripts/openspec-archive-check.mjs --archived refine-harness-typography-nov23` PASS；
      其新视觉基线已经 Alex 逐张批准并落盘。任一未满足不得施工
- [ ] 0.8 以**两个前序归档后**的 living「进度呈现」为基线，**整块重抄**本 change 的 MODIFIED 块
      （`specs/harness/spec.md`）；审批归档后已重抄一次（本次提交，24 个 living scenario 全部保留），
      排版归档后仍须复核该 requirement 未被改写并再次整块对账；MUST NOT 只写改动段、MUST NOT 用
      当前 living 直接改
- [ ] 0.9 合并后的优先级写死为 `stopping > approval > midTakeover > waiting/generating`；
      `approval` 读前置 change 的 `pendingApprovals` 派生信号，不是新相位
- [ ] 0.10 补集成断言：尾行在 transcript 内 + `enter_snapshot(in_flight=true) + pending` → 阶段行
      读「等待批准…」、标题栏信号仍在、MUST NOT 读「正在继续本轮…」；脱离态待批 → 标题栏信号仍在、
      `scrollTop` ≤1px
- [ ] 0.11 核对排版承接值已落进实现合同：阶段行 `--text-2`（不恢复排版前阶段色）、16px gap 下净间距
      公式 `calc(var(--sp-2) - var(--sp-8))`、空态四边 `sp-8/sp-8/sp-6/sp-8`、继承 13px/1.58 +
      `--text-2` + 24px padding；「idle 零漂移」只对排版归档后的新基线，不对排版前旧基线
- [x] 0.12 文档承接（本次）：已把 Alex 2026-11-24 的批准事实、双前序归档前置、排版 CSS / 几何与
      「零漂移相对排版后基线」写进 proposal / design / tasks / spec delta；只改 docs，未动产品代码、
      测试、living spec、文案 deck 或视觉基线
- [x] 0.13 基线同步（本次）：审批前序已归档且 `--archived` PASS；delta 已按其 living「进度呈现」
      整块重抄，24 个 living scenario 全部保留并新增 19 个尾行 / 排版 scenario；未改 living spec。
      排版前序仍未归档，0.7 / 0.8 保持未完成

## 1. 先红（测试先行，旧实现上必须红）

- [ ] 1.1 新增 `tests/unit/harness-progress-tail.test.ts`（纯模型层，零 DOM）：相位 × `pending`
      × `stageWaiting` × `midTakeover` → 可见性 / 文案键 / 条形形态（不定态 / 冻结）的完整矩阵；
      断言 `stopping > approval > midTakeover > waiting/generating`、待批优先于接管、工具循环维持
      D382。**矩阵只作补充**：它可以手工预设 `stageWaiting=false` / `pending=true`，不能替代 1.2
      的事件级用例
- [ ] 1.2 扩展 `tests/visual/scenes/m347-harness-composer.spec.ts`：
      - **只发 `tool_call`、全程无 `text_chunk`** → 阶段行读 D382（旧实现停在 D381，必红）
      - **只发 `reasoning_chunk`** → 同样读 D382
      - `.lumir-hp-progress` 位于 `.lumir-hp-transcript` 内、是 `lastElementChild`、`order` 计算值
        为 1；等待 → 生成之间节点 identity 不变、高度不变、与末条内容绝对净间距 4px（±1px）且
        相位切换前后恒定
      - 终态后尾行隐藏且错误行 / 已停止标记是最后内容
      - 空态只有尾行时提示仍在；尾行显隐前后提示 `top` 位移 ≤1px；正控制用尾行自身矩形（高度 >0、
        在 transcript 视口内），**不要只断言 `scrollHeight`**（空态下它有 `clientHeight` 下限）；若
        把视口压到小于尾行高度，再补 `scrollHeight` 差值 >1px
      - **排版后 / 本 change 后 idle 对账**：在排版归档后的实现（本 change 施工前）记录 idle 空态
        提示中心 `(cx0, cy0)`，改造后断言 `|cx-cx0| ≤1px`、`|cy-cy0| ≤1px`；只测尾行显隐前后不变
        抓不到整体 2px 上移；MUST NOT 以排版前旧基线为对账起点
      - running 中触发 `compact` 标记、无 assistant 宿主的工具记录、快照 assistant 重建后，
        `lastElementChild` 仍是尾行
- [ ] 1.2a 集成测试（m347 / m756）：尾行在 transcript 内 + `enter_snapshot(in_flight=true) +
      pending` → `.lumir-hp-stage` 读「等待批准…」、标题栏段 / toggle 信号仍在（前置 change 的承载），
      MUST NOT 读「正在继续本轮…」；脱离态待批到达 → 标题栏信号仍在、`scrollTop` ≤1px
- [ ] 1.3 扩展 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`：上滚进入 detached 后，用
      **`auto_turn_started`**（不用普通发送——那会走 `follow.jumpToBottom()` 白名单）让尾行出现、
      再用 `done` 让它隐藏，各一次；`scrollTop` 位移 ≤1px、未读圆点不点亮；following 下轮次开始 /
      结束仍贴底
- [ ] 1.4 `tests/unit/harness-scroll-lock.test.ts` 新增 `layoutMutated(deltaPx)`：
      - 尾行单独出现 / 消失（`+P` / `-P`）→ 不点亮未读、`scrollTop` 不变
      - 危险次序反例：detached 基线 `H0` → 真实内容 `+C` → 尾行隐藏 `-P` → `layoutMutated(-P)`
        → `contentGrew()` → **必须未读**、`scrollTop` 不变（旧式「当前总高度当基线」会吞掉 `C`）
- [ ] 1.5 在旧实现上跑一次并留红：1.1 的矩阵、1.2 的 containment / `lastElementChild` / 工具先行、
      1.3 的 detached 不点未读、1.4 的吞未读反例必须红
- [ ] 1.6 真机场景骨架先落（6.1 的步骤表），旧实现跑出预期红：尾行在 composer 上方、不在
      transcript 末尾；工具先行时读 D381

## 2. 结构（`src/harness-panel.ts`）

- [ ] 2.1 把 `progress` 从 `panel.append(transcriptViewport, progress, taskArea, composerArea)` 中
      移出；改为 transcript 的子节点（空闲隐藏、运行时置尾）
- [ ] 2.2 新增顶层追加唯一 helper `appendTranscriptNode(node)`：append 后调 `ensureTailLast()`；
      全仓把 12 处直接 `transcript.append(...)`（含 `appendCompactMarker`、孤儿工具块、快照
      assistant、通知、错误、批准卡、空态提示）收口到它
- [ ] 2.2a 新增 `childList` MutationObserver 兜底：回调只调 `ensureTailLast()`；`progress.hidden`
      或 `lastElementChild === progress` 时直接返回（防循环）；覆盖任何绕过 helper 的追加路径
      （现有 compact / 孤儿工具 / 快照 + 未来新增），MUST NOT 维护调用点清单
- [ ] 2.2b 新增 `markAssistantOutputStarted()`：首个 `reasoning_chunk` / `tool_call` / `text_chunk`
      任一到达时把 `stageWaiting` 置假并调 `applyStage()` 重施阶段文案；三个事件处理器共用，
      MUST NOT 只挂在 `text_chunk`；该路径 MUST NOT 触发布局测量 / 置尾 / 强制回底
- [ ] 2.3 `applySendPhase`：按钮态、`hidden`、`ensureTailLast`、`dataset.phase` 与对应
      `layoutMutated` 布局测量的唯一入口；按 design §4.2 的顺序落 DOM 后调 `applyStage` 写文案。
      `applySendPhase` MUST NOT 被当作文案的唯一写点
- [ ] 2.4 `applyStage`：阶段文案的唯一 DOM 写点，由 `applySendPhase`、首个有效产出推进、审批
      集合变化重施与语言重绘共同调用；只写文本，MUST NOT 改显隐 / 位置 / `data-phase` / 条形
      形态，也不得为文案重施触发置尾 / 贴底 / 布局测量。文案优先级
      `stopping > approval > midTakeover > waiting/generating`（D381 / D382 是最后两档）；
      `approval` 读前置 change 的 `pendingApprovals` 派生信号，不是新相位；不新增第三档
- [ ] 2.5 终态次序：`aborted` 分支改为先 `dispatchActivity(terminal)`、再补「已停止」标记；
      `error` / `done` 保持既有顺序，确认尾行在同一次相位施加里隐藏；不新增第二处写 `hidden`
- [ ] 2.6 中途接管：`enter_snapshot` 的 `inFlight=true` 分支同时把 `stageWaiting` 置假；快照重建
      后由 2.2 重新挂尾
- [ ] 2.7 空态：`syncEmptyHint()` 改为排除尾行与空态提示本身的具名 helper
      （`transcriptHasContent()`），全仓只此一处；`.lumir-hp-empty` 改为按排版归档后的**内容盒中心**
      绝对定位（`position:absolute; top/right/left: var(--sp-8); bottom: var(--sp-6); display:grid;
      place-items:center; margin:0; pointer-events:none`），不参与 flex 剩余空间分配，MUST NOT 用
      `top:50%` 直接居中
- [ ] 2.8 写点边界对账：全仓 `rg "progress.hidden"` 只允许 `applySendPhase` 一处；`rg
      "transcript.append"` 只允许 `appendTranscriptNode` 与 `clearTranscriptSurface` 的清空处；
      阶段文案只经 `applyStage` 落 DOM，文本重施路径不出现置尾 / `layoutMutated` / `jumpToBottom`；
      观察器与 helper 的守卫与 design §4.5 一致

## 3. 样式（`src/harness-panel.css`）

- [ ] 3.1 `.lumir-hp-progress`：`padding: 0`、`order: 1`、
      `margin-top: calc(var(--sp-2) - var(--sp-8))`（排版后 transcript gap 16px）；保留
      `[hidden] { display:none }`
- [ ] 3.2 `.lumir-hp-stage`：`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`；
      `margin-bottom: 4px` 不变；颜色保持排版后的 `--text-2`，MUST NOT 改回排版前阶段色
- [ ] 3.3 `.lumir-hp-bar`：`margin-bottom: 0`；高度 3px 不变
- [ ] 3.4 停止冻结：`[data-phase="stopping"] .lumir-hp-bar-fill { animation: none; }`；
      eink 下同样冻结（明度分叉保留）
- [ ] 3.5 CSS 注释写明「transcript 子项默认 order 0，尾行 order 1 是唯一例外」，防止后续新子项
      把尾行挤到中间
- [ ] 3.6 三主题 / 缩放（`--lumir-hp-scale`）下高度恒定：单测 / 视觉断言覆盖 zh / en 与三主题
- [ ] 3.7 `.lumir-hp-empty` 改为按排版归档后的**内容盒中心**绝对定位：`position:absolute;
      top/right/left: var(--sp-8); bottom: var(--sp-6); display:grid; place-items:center; margin:0`；
      去掉 flex 内容盒居中；**MUST NOT 用 `top:50%` + translate 直接居中**（会相对排版后 idle 中心整体
      上移 2px）；字号 13px/1.58、`--text-2`、24px padding 继承排版 change，本 change 不改

## 4. 跟滚（`src/harness-scroll-lock.ts`）

- [ ] 4.1 新增 `layoutMutated(deltaPx: number)`：following 排一次贴底；detached 只做
      `unreadBaseline += deltaPx`（clamp ≥ 0），不改态、不点未读、不写滚动位。**MUST NOT** 把当前
      总 `scrollHeight` 直接设为新基线
- [ ] 4.2 调用点：`applySendPhase` 的布局三件事（`hidden` / 置尾 / `data-phase`）前后各读一次
      `transcript.scrollHeight`，完成后传差值；随后调 `applyStage` 写文案，文案不计入 delta；
      快照重建重挂尾行同样只测这一段；`applyStage` 的文本重施不测量；空闲重建不调用
- [ ] 4.3 顺序：尾行 DOM 变化 → `layoutMutated(delta)` → 若有新内容 `contentGrew()`；注释里写明
      delta 只含尾行自身布局变化，不能跨内容追加测量
- [ ] 4.4 `tests/unit/harness-scroll-lock.test.ts` 覆盖：following / detached × 尾行单独出现 / 消失；
      危险次序反例（`H0 → +C → -P → layoutMutated(-P) → contentGrew`）必须未读且 `scrollTop` 不变；
      detached 用例用 `auto_turn_started`，不用普通发送

## 5. 视觉

- [ ] 5.1 结构层断言全绿（1.2 / 1.3 转绿）
- [ ] 5.2 本地跑 `scripts/gate.sh visual`：整页 / 元素像素层通过；idle 态相对**排版归档后的新基线**
      零漂移（不以排版前旧基线为对账起点）
- [ ] 5.3 running 态新像素只出候选：截图落主仓 `.local/reviews/ux-improvements/progress-tail-candidates/`
      （git 外），**不**执行 `--update`；候选交 Alex 过目后再决定是否更新
- [ ] 5.4 若 idle 基线意外漂移，先定位（位置 / padding / order 的副作用），不得机械重截
- [ ] 5.5 eink 真机 / 截图：停止态无脉冲、明度分叉在场

## 6. 真机验收

- [ ] 6.1 新增真机场景（id / item 按 `scripts/acceptance/scenarios/` 当前最大值 +1 分配，不预占；
      文件名建议 `harness-progress-tail`）：
      1. 空闲：尾行不在场、transcript 空态提示在场
      2. 发送后首个分片前：尾行在 transcript 内、读「等待响应…」
      3. **工具先行**：mock 只回工具调用、无正文 → 阶段行读「正在生成回复…」（不是 D381）
      4. 正文路径：首个正文分片后仍读 D382，位置不跳
      5. 工具循环：仍读 D382，工具行在它上方
      6. 自动压缩：running 中触发 `compact` 标记 → 尾行仍在 transcript 最后（DOM 序）
      7. 停止：读「正在停止…」，条形静止（截图证据）
      8. 终态：尾行离场，回复定稿 / 「已停止」标记在末尾
      8a. 待批：mock 延迟产出需批准的调用 → 阶段行读「等待批准…」、标题栏信号仍在（面板开 / 收
          各一次）；脱离态待批 → 标题栏信号仍在、`scrollTop` 不变
      9. 空态几何：仅空态 + 尾行时，尾行显隐前后提示位置不动（截图证据）
      10. `auto_turn_started` 开始一轮（**不要用普通发送**）：上滚 detached 后阅读行不移动、不出现
          未读圆点（截图证据）
- [ ] 6.2 回扫既有验收场景 88 / 97 / 104：阶段行 AX 文本断言逐字不变；跑一遍确认无红；
      若实现改动了文案或时序，先改准场景再收口
- [ ] 6.3 证据落 `.local/acceptance/<批次>/`（git 外）；FAIL 项逐条定位，不把偶发超窗当产品
      缺陷，也不静默重跑
- [ ] 6.4 证据目录用绝对路径 `ls` 一遍再写进报告（REVIEW.md「证据只在终端跑过」条）
- [ ] 6.5 若动过标题栏内元素的事件监听，另跑场景 39（REVIEW.md「标题栏 mousedown」条）

## 7. 规格与文档

- [ ] 7.1 `specs/harness/spec.md` 的 MODIFIED 块以**两个前序归档后的 living** 为基线整条复制再改：
      不得只写改动段、不得删既有场景、不得丢掉前置的待批 / 标题栏信号条款与排版的阅读密度 / token
      条款；重抄后对照两前序 living 逐段核一遍
- [ ] 7.2 `文案-Copy.md`：D3 批准后新增中途接管句（zh / en 双档 + 消费点说明）；语言切换经既有
      `onRelabel` 重绘
- [ ] 7.3 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致），避免下次误引
- [ ] 7.4 若实现期发现新的已知边界（如停止冻结的观感备选），补进 design §9，不口头流传

## 8. 门禁

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [ ] 8.2 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式：MODIFIED 无静默丢段、
      归档队列、backlog、验收套件契约）；另跑
      `node scripts/openspec-archive-check.mjs --change move-harness-progress-to-output-tail-nov23`
      并记录 PASS
- [ ] 8.3 `scripts/gate.sh quick` 通过，照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）
- [ ] 8.4 `scripts/gate.sh visual` 通过（动过 `src/harness-panel.css` 与视觉场景，必须本地跑像素层）
- [ ] 8.5 真机场景 PASS；证据指针可 `ls`
- [ ] 8.6 视觉基线未更新；候选截图与「是否更新」的结论写进完工报告

## 9. 信息卫生

- [ ] 9.1 所有 fixture / 视觉场景 / 验收场景只用合成 vault 名与路径（如 `/tmp/lumir-*`），
      MUST NOT 出现真实 vault 名、真实人名、真实文档正文
- [ ] 9.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`（git 外）
- [ ] 9.3 本 change 无原型；若实现期新增原型 HTML，控制面板可点击、截图同步重截

## 10. 收尾

- [ ] 10.1 `tasks.md` 全部勾选，未勾项就地写放弃理由（不删任务项、不留空勾）
- [ ] 10.2 在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（五要件齐待归档 / 命中例外待裁）
- [ ] 10.3 交独立 reviewer；评审判断层不降档；verdict 绑定当前 tip
- [ ] 10.4 归档前逐条核对节点 2 五要件；归档走 `node scripts/openspec-archive.mjs <change-id>`，
      归档提交后跑 `--archived` 审计至 PASS
