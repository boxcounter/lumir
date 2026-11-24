# Tasks: move-harness-progress-to-output-tail-nov23

> 施工前提：节点 1 已批准——Alex 2026-11-24 回复「同意。」，D1–D6 全部按 `proposal.md` 推荐值生效。
> 本次提交实现尾行合同与测试，不归档；未勾项不删除，放弃的就地写理由。
>
> **硬前置（有序链）已满足**：`fix-harness-approval-visibility-nov23` →
> `refine-harness-typography-nov23` → 本 change。两个前序均已归档且开工复跑 `--archived` PASS，
> 排版新视觉基线已经 Alex 批准落盘（见 §0.6–0.11）。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：Alex 2026-11-24 回复「同意。」，D1–D6 按推荐值生效；批准原话已抄进
      `proposal.md` 文首节点状态块与节点 1 裁决表
- [x] 0.2 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」
      「断言等价于子串」「新增 / 修改 overflow 容器没先定档」）
- [x] 0.3 不改后端命令 / 事件协议 / 快照字段；不新增 Rust 用例。若实现中发现必须动后端，停下走
      影响面升级线，不静默扩 scope
- [x] 0.4 中途接管文案取号：D3 已批准新增「正在继续本轮…」；实现前复核 deck 当前末位为 D982，
      本 change 取下一未占用号 **D983**
- [x] 0.5 本 change **不执行**视觉基线 `--update`；running 态新像素只出候选截图（见 5.3）
- [x] 0.6 **硬前置①**：`fix-harness-approval-visibility-nov23` 已归档并
      `node scripts/openspec-archive-check.mjs --archived fix-harness-approval-visibility-nov23` PASS
      （归档提交 `12a21a97`，审计记录 `ab6ef4ad`，合并 `bae7b47f`）
- [x] 0.7 **硬前置②**：`refine-harness-typography-nov23` 已归档，开工复跑
      `node scripts/openspec-archive-check.mjs --archived refine-harness-typography-nov23` PASS；
      其 20 张新视觉基线已经 Alex 逐张批准并落盘
- [x] 0.8 以**两个前序归档后**的 living「进度呈现」为基线，**整块重抄**本 change 的 MODIFIED 块
      （`specs/harness/spec.md`）；开工对账确认 24 个 living scenario 全部保留，另加 19 个尾行 /
      排版 scenario；MUST NOT 只写改动段、MUST NOT 丢失审批 / 排版增量
- [x] 0.9 合并后的优先级写死为 `stopping > approval > midTakeover > waiting/generating`；
      `approval` 读前置 change 的 `pendingApprovals` 派生信号，不是新相位
- [x] 0.10 补集成断言：尾行在 transcript 内 + `enter_snapshot(in_flight=true) + pending` → 阶段行
      读「等待批准…」、标题栏信号仍在、MUST NOT 读「正在继续本轮…」；脱离态待批 → 标题栏信号仍在、
      `scrollTop` ≤1px（m756 / m638）
- [x] 0.11 核对排版承接值已落进实现合同：阶段行 `--text-2`（不恢复排版前阶段色）、16px gap 下净间距
      公式 `calc(var(--sp-2) - var(--sp-8))`、空态四边 `sp-8/sp-8/sp-6/sp-8`、继承 13px/1.58 +
      `--text-2` + 24px padding；「idle 零漂移」只对排版归档后的新基线，不对排版前旧基线
- [x] 0.12 文档承接（本次）：已把 Alex 2026-11-24 的批准事实、双前序归档前置、排版 CSS / 几何与
      「零漂移相对排版后基线」写进 proposal / design / tasks / spec delta；只改 docs，未动产品代码、
      测试、living spec、文案 deck 或视觉基线
- [x] 0.13 基线同步：两个前序均已归档且 `--archived` PASS；delta 已按两项归档后的 living「进度呈现」
      整块重抄，24 个 living scenario 全部保留并新增 19 个尾行 / 排版 scenario；未改 living spec

## 1. 先红（测试先行，旧实现上必须红）

- [x] 1.1 新增 `tests/unit/harness-progress-tail.test.ts`（纯模型层，零 DOM）：相位 × `pending`
      × `stageWaiting` × `midTakeover` → 可见性 / 文案键 / 条形形态（不定态 / 冻结）的完整矩阵；
      断言 `stopping > approval > midTakeover > waiting/generating`、待批优先于接管、工具循环维持
      D382。**矩阵只作补充**：它可以手工预设 `stageWaiting=false` / `pending=true`，不能替代 1.2
      的事件级用例
- [x] 1.2 扩展 `tests/visual/scenes/m347-harness-composer.spec.ts`：
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
        `lastElementChild` 仍是尾行；孤儿工具另有「空 assistant + tool」快照 fixture，证明工具块直接在
        transcript 顶层、无 assistant 宿主且末位仍为尾行（m756）
      - 纯文案重施零测量：wiring 反例覆盖 `applyStage` / 首个产出 / 待批重施 / `relabelOnly`，
        真实 ⌘⇧L 下 `scrollHeight` getter 计数为 0，identity / `data-phase` / 条形 / 滚动位不变
- [x] 1.2a 集成测试（m347 / m756）：尾行在 transcript 内 + `enter_snapshot(in_flight=true) +
      pending` → `.lumir-hp-stage` 读「等待批准…」、标题栏段 / toggle 信号仍在（前置 change 的承载），
      MUST NOT 读「正在继续本轮…」；脱离态待批到达 → 标题栏信号仍在、`scrollTop` ≤1px
- [x] 1.3 扩展 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`：上滚进入 detached 后，用
      **`auto_turn_started`**（不用普通发送——那会走 `follow.jumpToBottom()` 白名单）让尾行出现、
      再用 `done` 让它隐藏，各一次；`scrollTop` 位移 ≤1px、未读圆点不点亮；following 下轮次开始 /
      结束仍贴底
- [x] 1.4 `tests/unit/harness-scroll-lock.test.ts` 新增 `layoutMutated(deltaPx)`：
      - 尾行单独出现 / 消失（`+P` / `-P`）→ 不点亮未读、`scrollTop` 不变
      - 危险次序反例：detached 基线 `H0` → 真实内容 `+C` → 尾行隐藏 `-P` → `layoutMutated(-P)`
        → `contentGrew()` → **必须未读**、`scrollTop` 不变（旧式「当前总高度当基线」会吞掉 `C`）
- [x] 1.5 在旧实现上跑一次并留红：1.1 的矩阵、1.2 的 containment / `lastElementChild` / 工具先行、
      1.3 的 detached 不点未读、1.4 的吞未读反例必须红（主仓 `.local/reviews/ux-improvements/
      progress-tail-candidates/before-unit-red.log`、`before-visual-red*.log`）
- [ ] 1.6 真机场景骨架已落并通过静态校验（6.1 / 727）；旧实现真机红**未跑**——本 worker 不启动
      真机，待主会话串行复跑 727 与 88 / 97 / 104

## 2. 结构（`src/harness-panel.ts`）

- [x] 2.1 把 `progress` 从 `panel.append(transcriptViewport, progress, taskArea, composerArea)` 中
      移出；改为 transcript 的子节点（空闲隐藏、运行时置尾）
- [x] 2.2 新增顶层追加唯一 helper `appendTranscriptNode(node)`：append 后调 `ensureTailLast()`；
      全仓把 12 处直接 `transcript.append(...)`（含 `appendCompactMarker`、孤儿工具块、快照
      assistant、通知、错误、批准卡、空态提示）收口到它
- [x] 2.2a 新增 `childList` MutationObserver 兜底：回调只调 `ensureTailLast()`；`progress.hidden`
      或 `lastElementChild === progress` 时直接返回（防循环）；覆盖任何绕过 helper 的追加路径
      （现有 compact / 孤儿工具 / 快照 + 未来新增），MUST NOT 维护调用点清单
- [x] 2.2b 新增 `markAssistantOutputStarted()`：首个 `reasoning_chunk` / `tool_call` / `text_chunk`
      任一到达时把 `stageWaiting` 置假并调 `applyStage()` 重施阶段文案；三个事件处理器共用，
      MUST NOT 只挂在 `text_chunk`；该路径 MUST NOT 触发布局测量 / 置尾 / 强制回底
- [x] 2.3 `applySendPhase`：按钮态、`hidden`、`ensureTailLast`、`dataset.phase` 与对应
      `layoutMutated` 布局测量的唯一入口；按 design §4.2 的顺序落 DOM 后调 `applyStage` 写文案。
      `applySendPhase` MUST NOT 被当作文案的唯一写点
- [x] 2.4 `applyStage`：阶段文案的唯一 DOM 写点，由 `applySendPhase`、首个有效产出推进、审批
      集合变化重施与语言重绘共同调用；只写文本，MUST NOT 改显隐 / 位置 / `data-phase` / 条形
      形态，也不得为文案重施触发置尾 / 贴底 / 布局测量。文案优先级
      `stopping > approval > midTakeover > waiting/generating`（D381 / D382 是最后两档）；
      `approval` 读前置 change 的 `pendingApprovals` 派生信号，不是新相位；不新增第三档
- [x] 2.5 终态次序：`aborted` 分支改为先 `dispatchActivity(terminal)`、再补「已停止」标记；
      `error` / `done` 保持既有顺序，确认尾行在同一次相位施加里隐藏；不新增第二处写 `hidden`
- [x] 2.6 中途接管：`enter_snapshot` 的 `inFlight=true` 分支同时把 `stageWaiting` 置假；快照重建
      后由 2.2 重新挂尾
- [x] 2.7 空态：`syncEmptyHint()` 改为排除尾行与空态提示本身的具名 helper
      （`transcriptHasContent()`），全仓只此一处；`.lumir-hp-empty` 改为按排版归档后的**内容盒中心**
      绝对定位（`position:absolute; top/right/left: var(--sp-8); bottom: var(--sp-6); display:grid;
      place-items:center; margin:0; pointer-events:none`），不参与 flex 剩余空间分配，MUST NOT 用
      `top:50%` 直接居中
- [x] 2.8 写点边界对账：全仓 `rg "progress.hidden"` 只允许 `applySendPhase` 一处；`rg
      "transcript.append"` 只允许 `appendTranscriptNode` 与 `clearTranscriptSurface` 的清空处；
      阶段文案只经 `applyStage` 落 DOM，文本重施路径不出现置尾 / `layoutMutated` / `jumpToBottom`；
      观察器与 helper 的守卫与 design §4.5 一致

## 3. 样式（`src/harness-panel.css`）

- [x] 3.1 `.lumir-hp-progress`：`padding: 0`、`order: 1`、
      `margin-top: calc(var(--sp-2) - var(--sp-8))`（排版后 transcript gap 16px）；保留
      `[hidden] { display:none }`
- [x] 3.2 `.lumir-hp-stage`：`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`；
      `margin-bottom: 4px` 不变；颜色保持排版后的 `--text-2`，MUST NOT 改回排版前阶段色
- [x] 3.3 `.lumir-hp-bar`：`margin-bottom: 0`；高度 3px 不变
- [x] 3.4 停止冻结：`[data-phase="stopping"] .lumir-hp-bar-fill { animation: none; }`；
      eink 下同样冻结（明度分叉保留）
- [x] 3.5 CSS 注释写明「transcript 子项默认 order 0，尾行 order 1 是唯一例外」，防止后续新子项
      把尾行挤到中间
- [x] 3.6 三主题 / 缩放（`--lumir-hp-scale`）下高度恒定：单测 / 视觉断言覆盖 zh / en 与三主题
- [x] 3.7 `.lumir-hp-empty` 改为按排版归档后的**内容盒中心**绝对定位：`position:absolute;
      top/right/left: var(--sp-8); bottom: var(--sp-6); display:grid; place-items:center; margin:0`；
      去掉 flex 内容盒居中；**MUST NOT 用 `top:50%` + translate 直接居中**（会相对排版后 idle 中心整体
      上移 2px）；字号 13px/1.58、`--text-2`、24px padding 继承排版 change，本 change 不改

## 4. 跟滚（`src/harness-scroll-lock.ts`）

- [x] 4.1 新增 `layoutMutated(deltaPx: number)`：following 排一次贴底；detached 只做
      `unreadBaseline += deltaPx`（clamp ≥ 0），不改态、不点未读、不写滚动位。**MUST NOT** 把当前
      总 `scrollHeight` 直接设为新基线
- [x] 4.2 调用点：`applySendPhase` 的布局三件事（`hidden` / 置尾 / `data-phase`）前后各读一次
      `transcript.scrollHeight`，完成后传差值；随后调 `applyStage` 写文案，文案不计入 delta；
      快照重建重挂尾行同样只测这一段；`applyStage` 的文本重施不测量；空闲重建不调用
- [x] 4.3 顺序：尾行 DOM 变化 → `layoutMutated(delta)` → 若有新内容 `contentGrew()`；注释里写明
      delta 只含尾行自身布局变化，不能跨内容追加测量
- [x] 4.4 `tests/unit/harness-scroll-lock.test.ts` 覆盖：following / detached × 尾行单独出现 / 消失；
      危险次序反例（`H0 → +C → -P → layoutMutated(-P) → contentGrew`）必须未读且 `scrollTop` 不变；
      detached 用例用 `auto_turn_started`，不用普通发送

## 5. 视觉

- [x] 5.1 结构层断言全绿（1.2 / 1.3 转绿）
- [x] 5.2 Alex 批准 10 张 running 基线后，本地完整跑 `LUMIR_VISUAL_PORT=4398 scripts/gate.sh visual`：
      `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；1368 passed / 0 failed / 1 skipped；
      idle 相对排版归档后的新基线零漂移，其余 98 张基线哈希不变
- [x] 5.3 running 态新像素只出候选：三主题 × 三宽度 + 空态接管共 10 张实图已落主仓
      `.local/reviews/ux-improvements/progress-tail-candidates/`（git 外），**不**执行 `--update`；
      候选交 Alex 过目后再决定是否更新
- [x] 5.4 idle 基线未发生意外漂移（最终失败清单仅 10 张 running 图）；未机械重截、未更新基线
- [x] 5.5 eink 计算样式与截图证据：停止态 `animation:none`、满宽明度条在场；真机截图归 727 主会话

## 6. 真机验收

- [x] 6.1 新增真机场景 **727**（当前最大值 726 +1，`727-harness-progress-tail`；静态校验 PASS，
      真机执行归主会话）：
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
- [x] 6.2 已回扫既有验收场景 88 / 97 / 104：阶段行 AX 文本断言逐字不变，静态校验与真机均 PASS；
      727 的工具窗口修正后同批其余步骤保持通过（`acceptance-727-related.log` / r2 后续日志）
- [x] 6.3 证据落 `.local/acceptance/2026-11-24-progress-tail-r2/`（git 外）；初次工具窗口与 stopping
      窗口 FAIL 已逐条定位并修 fixture 时序，未静默重跑或把终态截图冒充生成中
- [x] 6.4 证据目录已用绝对路径 `ls` 核对（REVIEW.md「证据只在终端跑过」条）
- [x] 6.5 未动标题栏内元素的事件监听，无需另跑场景 39（REVIEW.md「标题栏 mousedown」条）

## 7. 规格与文档

- [x] 7.1 `specs/harness/spec.md` 的 MODIFIED 块以**两个前序归档后的 living** 为基线整条复制再改：
      不得只写改动段、不得删既有场景、不得丢掉前置的待批 / 标题栏信号条款与排版的阅读密度 / token
      条款；重抄后对照两前序 living 逐段核一遍
- [x] 7.2 `文案-Copy.md`：D3 批准后新增中途接管句 **D983**（zh / en 双档 + 消费点说明）；
      语言切换经既有 `onRelabel` 重绘
- [x] 7.3 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致），避免下次误引
- [x] 7.4 实现期未发现超出 design §9 既有清单的新边界，无新增条目

## 8. 门禁

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过：
      `Totals: 37 passed, 0 failed (37 items)`
- [x] 8.2 `bash scripts/docs-check.sh` PASS（含 archive-check 门禁模式：MODIFIED 无静默丢段、
      归档队列、backlog、验收套件契约）；另跑
      `node scripts/openspec-archive-check.mjs --change move-harness-progress-to-output-tail-nov23`
      PASS（1 条 MODIFIED，对比 59 段）
- [x] 8.3 `scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
- [x] 8.4 `LUMIR_VISUAL_PORT=4398 scripts/gate.sh visual` 与像素层通过：
      `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；1368 passed / 0 failed / 1 skipped
- [x] 8.5 真机 727 PASS（1/1，40 断言，92.7s，runner 退出码 0）；证据指针已 `ls`：
      `.local/acceptance/2026-11-24-progress-tail-r2/727-harness-progress-tail/`
- [x] 8.6 Alex 已明确「批准进度尾行基线」：仅 9 张矩阵 running + empty-running 共 10 张已更新；
      其余 98 张基线与容差不改；前后哈希清单及 light-narrow 反向验证证据已落主仓指定目录

## 9. 信息卫生

- [x] 9.1 所有 fixture / 视觉场景 / 验收场景只用合成 vault 名与路径（如 `/tmp/lumir-*`），
      MUST NOT 出现真实 vault 名、真实人名、真实文档正文
- [x] 9.2 提交前已对改动面做 text 级清扫（无本机用户路径 / 私钥 / 常见密钥形态）；
      截图类证据只落 `.local/`（git 外）
- [x] 9.3 本 change 无原型；实现期未新增原型 HTML

## 10. 收尾

- [x] 10.1 `tasks.md` 全部勾选；1.6 的旧实现真机红未跑已就地说明（worker 未启动该轮真机），
      其余未完成事项均已收口，不删任务项、不留空勾
- [x] 10.2 已在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（五要件齐待归档）
- [x] 10.3 独立 reviewer final r2 判 clean / merge，verdict 绑定 `7bbd9010`；评审判断层未降档
- [x] 10.4 已核对节点 2 五要件并归档（提交 `44410018`）；随后
      `node scripts/openspec-archive-check.mjs --archived move-harness-progress-to-output-tail-nov23`
      PASS（1 条 MODIFIED，对比 59 段；人工恢复 0 段，声明认领 0 段）
