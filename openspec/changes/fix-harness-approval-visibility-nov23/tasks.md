# Tasks: fix-harness-approval-visibility-nov23

> 施工前提：**节点 1 待批**。本文件是按推荐值（D1–D6）写的施工清单，未获节点 1 通过前
> **不进入实现**；批准值不同时先改 `proposal.md` / `design.md` / spec delta，再动工。
> 实现期勾选；未勾项不删除，放弃的就地写理由。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：把 Alex 的裁决原话（含 D1–D6 的取值）抄进 `proposal.md` 的节点状态块
- [x] 0.2 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」
      「断言等价于子串」「读不到当成空」「新增 / 修改 overflow 容器没先定档」）
- [x] 0.3 红线：不改 `src-tauri/**`（无新事件 / 快照字段 / 命令）；不改跟滚阈值
      （`src/harness-scroll-lock.ts` 的 `FOLLOW_ATTACH_PX` / `FOLLOW_DETACH_PX`）、不改两态判据、
      不在批准卡 / 快照回填时强制回底
- [x] 0.4 红线：不提前改写 `openspec/specs/harness/spec.md`；delta 留在 change 目录，归档时并入
- [x] 0.5 红线：不把待批塞进 `src/harness-activity.ts` 的相位状态机；待批是派生信号，不是新相位 /
      新 `ActivityEvent`
- [x] 0.5a 红线：`done` / `error` / `aborted` 必须走同一个 `withdrawPendingApprovals`（撤卡、标未执行、
      清集合、失效决策），不得只隐藏状态词；`sent` / `auto_turn_started` 前必须清 stale 待批
- [x] 0.5b 红线：相位 `idle` 时不渲染可决策卡、不入待决集合；快照 / live 批准项同一判据
- [x] 0.5c 红线：`enter` 快照不清面；只按「构造空面 / `resetView` 已清」的前置不变量写测试，
      不得声称 enter 自身清面
- [x] 0.5d 红线：会话名链路（wrapper / button / sname）必须允许收缩；只改 sname 不算完成
- [x] 0.6 红线：视觉基线不 `--update`；待批运行态只出候选截图（`.local/`），更新基线须 Alex 过目
- [x] 0.7 开工前核对分支 tip：`move-harness-progress-to-output-tail-nov23` 尚未实现；若它先落，
      停下重核 spec delta 的 MODIFIED 基线（本 change 应排在它之前，见 proposal「与相邻 change
      的关系」）

## 1. 先红（测试先行，旧实现上必须红）

- [x] 1.1 新增 `tests/unit/harness-approval-signal.test.ts`：表驱动覆盖
      `stageCopyKey(phase, pending, stageWaiting)` 与 `activityStatusKey(phase, unread, pending)`：
      running + pending → 待批键；running 无 pending → D381 / D382；stopping + pending → D400；
      **idle + pending → 无待批键（陈旧数据）**；idle 未读两档 → D871 / D872；stopping 无 pending →
      D870；done / error 后的终态相位 → 无待批键
- [x] 1.2 扩展接线断言（同 `tests/unit/harness-activity-wiring.test.ts` 的读源风格，或新
      `tests/unit/harness-approval-wiring.test.ts`）：`refreshApprovalSignal` 的调用点
      （append / decide / clear / restore 末尾）在场；`withdrawPendingApprovals` 在
      `done` / `error` / `aborted` 三个终态分支与 `sent` / `auto_turn_started` 前各调一次；
      `appendApproval` 对 `idle` 有 stale 守卫；`applyStage` / `applyActivityBadge` 都只读
      `hasPendingApprovals()`，全仓无第二处 `pendingApprovals.size > 0` 判据；无并行的本地布尔标志；
      `enter` 的三个调用点（构造 / `vaultChanged` / `reloadSession`）与「构造空面 / `resetView` 前置」
      对账，出现新调用点即红
- [x] 1.3 扩展 `tests/visual/scenes/m347-harness-composer.spec.ts`：生成中注入 `approval_request`
      → `.lumir-hp-stage` 读「等待批准…」；再注入 `text_chunk` → 仍读「等待批准…」；决策后回落
      「正在生成回复…」；无审批的对照组先注入正文分片、再注入工具调用，仍读「正在生成回复…」；
      **idle 遗留待批 → 发送**：旧快照 `in_flight:false + pending_approvals` 不落卡，发送后新轮读
      D381、MUST NOT 出现「等待批准」
- [x] 1.4 扩展 `tests/visual/scenes/m756-harness-activity-presence.spec.ts`：
      - **enter**：`in_flight:true + 非空` → `.lumir-hp-seg-status` 可见且读「等待批准」、toggle
        `activityStatus` / `title` 同源、`data-activity=inflight`；`in_flight:true + 空` → 段隐藏、
        toggle 读「处理中」；`in_flight:false + 非空` → 无卡、无状态（旧快照 stale）
      - **content**：先以 `in_flight:true` 进入（`midTakeover=true`），再 fire done / error 触发
        `content` 对账；快照返回非空 / 空列表 × 面板开 / 收 → 相位 idle、阶段行隐藏、toggle 按
        idle / 未读档；非空列表不复活卡
      - **终态撤回**：待批时 done / error / aborted 各一条 → 撤卡、工具行按 reason 标未执行 / 已停止、
        状态退场；done/error 后 next `sent` 不复活
      - **面板开合**：收起后注入待批 → toggle 读「等待批准」、段隐藏；重开 → 段状态保留
        （`attachTo` 不拉快照；这是本地保留，不得记作快照重建覆盖）
- [x] 1.5 扩展 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`：
      (a) **先上滚进入脱离态，再注入 `approval_request`** → `scrollTop` 变化 ≤1px、未读点亮、
      段状态词在场、浮钮可访问名含「有新内容」；(b) **待批已存在后上滚、期间无新内容** → 不要求
      未读、不强制回底；(c) 待批时点浮钮回底 → 卡进入视口、状态仍在；(d) 停止 / done / error
      撤回后无「等待批准」残留
- [x] 1.6 扩展 `tests/visual/scenes/m384-harness-approval-decided.spec.ts`：现有桩没有 `in_flight`，
      必须改用 `in_flight:true` 的独立桩或先发 `sent` 建立 running；**决策前先正断言「等待批准…」
      真实可见**；采纳 / 拒绝后段状态词退场、阶段行回落、toggle 回落；覆盖「仍有多项」「最后一项」
      「回落 D381 / D382」三种；拒绝附原因时终态记录可见且无待批状态；**MutationObserver** 断言
      重复批准事件 / 流式分片期间状态文本没有新的 mutation（不能只看最终字符串相同）
- [x] 1.7 新增 m638 发送最终几何用例：用 transcript 的引用手势插入一张 quote card（复用
      `m423-message-excerpt.spec.ts` 的选择 / 点击流程），在同一页面 task 内点击发送并立即读
      `{ scrollTop, max }`——旧实现必红（差值 ≥ 约 28px）；同时断言 quote card 确实移除、进度块
      确实显示、回声基准已刷新；再等两帧断言仍贴底、浮钮 hidden；保留旧实现红侧读数
- [ ] 1.8 真机场景骨架先落（步骤表见 7.3），旧实现跑出预期红：待批时 AX 读不到「等待批准…」、
      面板收起后 toggle help 仍读「处理中」
      （未跑：真机由主会话串行安排；场景文件已随本分支落，见 7.3）
- [ ] 1.9 在旧实现上跑 1.1–1.8 并留红：日志与证据落 `.local/`（结构场景的「无待批不显示」旧实现
      天然绿，不作红判据）
      （未跑真机红；单测红与四个视觉场景的修前红日志已落 `.local/missions/approval-visibility-nov24/red/`）
- [x] 1.10 窄段几何：在 m756 里把标题栏段压窄（取固定项之和以上、但不足以容纳长会话名的宽度）
      并注入长会话名，断言 `.lumir-hp-seg-status` 与 `.lumir-hp-seg-new` 的矩形都在段矩形内、
      `.lumir-hp-sname` 宽度较无待批时确实变小且省略号生效；旧实现（链路 `flex:none`）必红

## 2. 纯判据与文案键

- [x] 2.1 `src/harness-panel.ts` 导出 `stageCopyKey(phase, pending, stageWaiting)` 与
      `activityStatusKey(phase, unread, pending)`（纯函数、零 DOM；键类型收窄到 deck 键联合）
- [x] 2.2 面板内 `hasPendingApprovals(): boolean` 一处实现（`pendingApprovals.size > 0`）；
      `approvalSignalActive(phase)` = `phase === "running" && hasPendingApprovals()`
- [x] 2.3 `文案-Copy.md` 取号：按当前末位新增阶段行「等待批准…」/「Awaiting approval…」与
      撤回标签「未执行」/「Not executed」（done / error 的待批撤卡；aborted 仍用 D383）；在 deck 行
      注明消费点 `applyStage` / `withdrawPendingApprovals`；D416 的消费点扩为 `appendApproval` /
      `relabelApproval` + `applyActivityBadge`，注明同一串服务两处、MUST NOT 另立同文重复键
- [x] 2.4 `src/copy-data.ts` 增新键；`tests/unit/copy.test.ts` 全量漂移门禁转绿
- [x] 2.5 单测全绿（1.1 转绿）

## 3. 标题栏承载（段状态词 + toggle 状态）

- [x] 3.1 `.lumir-hp-seg` 内新增 `.lumir-hp-seg-status`：位置在会话名钮之后、加号钮之前；
      `role="status"`、初始 `hidden`、文本为空；`seg.append(sessionWrap, segStatus, segNew)`
- [x] 3.2 `src/harness-panel.css`：`.lumir-hp-seg-status` 按 design §6.1 落值——`flex: none`、
      `nowrap`、`--fs-meta` × scale、`--fw-medium`、`color: var(--pending)`、无底色 / 边框 / 阴影；
      `[hidden]` 时 `display: none`；**收缩链路**：`.lumir-hp-sessionwrap` 与 `.lumir-hp-session`
      改 `flex: 0 1 auto` + `min-width: 0`，`.lumir-hp-sname` 设 `min-width: 0`（保留 ellipsis）；
      `.lumir-hp-seg-new` 保持 `flex: none`；只改 sname 不算完成
- [x] 3.3 `applyActivityBadge()` 改为标题栏状态的**唯一写点**：算出的状态词同时写
      `activityStatus.textContent`、`toggleButton.title`、`segStatus.textContent` /
      `segStatus.hidden`；`data-activity` 维持 `inflight`（待批不新增第四态）；写 `activityStatus`
      与段状态词前先比较旧值，相同不写（避免同一待批集合重复触发 `aria-live` 播报）
- [x] 3.4 `applyLabels()` 末尾的既有 `applyActivityBadge()` 调用覆盖语言切换重取；确认段状态词
      随 zh ↔ en 重绘（不新增调用点）
- [x] 3.5 结构断言：段状态词不越出段矩形、不压会话名 / 加号钮；**窄段 + 长会话名**下状态词与
      加号钮都在段内且 sname 实际变窄；面板收起时段整体 hidden、
      toggle 的 `aria-live` 是唯一在场 live 区域；面板打开时反之

## 4. 阶段行

- [x] 4.1 `applyStage()` 改用 `stageCopyKey(activity.phase, hasPendingApprovals(), stageWaiting)`；
      删除原有的三元表达式分支（优先级只在纯选择器一处）
- [x] 4.2 `stopping` 优先保持：待批未收回时仍读 D400
- [x] 4.3 阶段行文案不变的部分（D381 / D382 / D400）逐字不动；新增档只在待批时出现

## 5. 清算接线

- [x] 5.1 新增 `refreshApprovalSignal()`（design §3.3）：`phase !== idle` 时 `applyStage()`；
      无条件 `applyActivityBadge()`
- [x] 5.1a 新增 `withdrawPendingApprovals(reason)`：撤卡、恢复工具行并按 reason 标注（done / error
      → 新文案「未执行」；aborted → D383「已停止」）、清集合、失效决策、`settledApprovalCalls.clear()`；
      `done` / `error` / `aborted` 在 `dispatchActivity(terminal)` 前各调一次（`aborted` 用同一函数
      替换内联循环）
- [x] 5.1c （独立评审 r1 / r2）`settledAwaitingDone` 单槽改为按**真实调用身份**配对：
      live 路径用 `tool_call started` 行的 call_id（`startedCallIds` → `pending.callId`，
      `approval_request.id` 是独立的 `ap-N`，MUST NOT 假设二者相等）；快照恢复的待批没有
      call_id，按工具名 + 到达顺序 FIFO 兜底（快照列表序 = 调用序，不是决策序；同名反序 done 的
      归属限制见 design §4）。有
      call_id 的重复 done 幂等；无 call_id 的旧事件只有 FIFO、不承诺幂等。配对表在正常终态与
      新一轮无条件清理。m384 用真实 `ap-N ≠ call_...` 覆盖同名 / 异名 / 反序 / 成功失败 /
      重复 done 不消费下一项、快照 FIFO、终态后新旧 call_id 碰撞
- [x] 5.1b `sent` / `auto_turn_started` 在置 `turnOpen` 前、且上一相位为 `idle` 时无条件清 stale
      （集合为空也要清配对表）；处理中的轮次不清合法待批；`appendApproval` 在**函数入口**判
      `idle` 并直接返回
      （MUST NOT 先建流式泡 / 工具块、不落卡、不入集合）
- [x] 5.2 `appendApproval`（**非 idle 路径**）：`pendingApprovals.set` + `relabelApproval` 之后、
      `follow.contentGrew()` 之前调用；idle 入口早退见 5.1b
- [x] 5.3 `decide`：`delete` + `settleApprovalRecord` 之后调用（幂等早退路径不重复调用）
- [x] 5.4 aborted 分支：用 `withdrawPendingApprovals("aborted")` 替换现有内联撤卡循环，位置在
      `dispatchActivity(terminal)` 之前；MUST NOT 保留第二份 `pendingApprovals.clear()` 路径
- [x] 5.5 `clearTranscriptSurface()`：清 Map 之后调用（覆盖换会话 / 切 vault / 新会话 / 对账清面）
- [x] 5.6 `restoreSnapshot()`：待决列表重放结束后**无条件**调用（含列表为空——这是幻影的主要出口）；
      明确它只重算现有 Map，不能删除 enter 快照已不含的旧 id——`enter` 依赖「构造 / `resetView`
      已清」的前置不变量，`content` 依赖 5.5 的清面。MUST NOT 在 `enter` 内新增清面逻辑来掩盖
- [x] 5.7 子运行路径（`attachTaskApproval` / `taskApprovals`）MUST NOT 调 `refreshApprovalSignal`；
      父会话状态不受子运行待批影响
- [x] 5.8 接线断言转绿（1.2）；确认全仓只有一个 `pendingApprovals.size > 0` 判据
- [x] 5.9 `enter` 三个调用点对账：构造（空面）、`vaultChanged`（先 `resetView`）、`reloadSession`
      （先 `resetView`）；出现新调用点必须补前置清理或改合同，不静默放行

## 6. 发送最终几何

- [x] 6.1 `send()` 内 `dispatchActivity({ type: "sent" })` 之后加 `follow.jumpToBottom()`，就地注释
      写明「发送 = 白名单；写底须用 composer 清空与进度块显隐落定后的最终几何；幂等」
- [x] 6.2 只在 `send()` 加；自动回合（`dispatchActivity(sent)` 的另一调用点）与 cron / retry 不加
- [x] 6.3 m638 新用例转绿（1.7）：同 task 读数 `scrollTop == max`（±1px），两帧后仍贴底
- [x] 6.4 回归：m638 既有 1–9 条全绿（脱离态零写入、阈值、白名单、不足一屏均不变）

## 7. 场景与门禁

- [ ] 7.1 视觉场景转绿：m347 / m756 / m638 / m384 的新增断言；跑 `scripts/gate.sh visual`
      （整页 / 元素像素层；待批运行态只出候选截图，不 `--update`）
      （四场景在结构模式全绿 36/36；`scripts/gate.sh visual` 的整页像素层未跑——主会话串行约束，见交接）
- [x] 7.1a （独立评审 P2）m756 补 content 四格（非空 / 空 × 面板开 / 收）、面板收起时的
      done / error / aborted 撤回、待批时新建会话与切会话（真实 resume 通道）；m822 补子运行
      待批不改变父会话阶段行 / 标题栏（真实渲染卡片）
- [ ] 7.2 既有真机场景回扫：88 / 97 / 104 / 110 / 151 / 188 / 252 / 253 的闸 / 阶段行 / 活动状态
      期望逐条核对；过期期望就地改准（不改的也留一条核对记录）；新增 done / error 撤卡的场景
      期望逐条改准
      （未跑：真机回扫由主会话串行安排）
- [x] 7.3 新增真机场景一条（编号按套件当前最大值 +1，实现时分配）：引用卡 → 发送 → **先上滚**
      → 待批到达 → 标题栏信号 / 未读 → 回底 → 采纳 → 第二条待批 → 停止撤回；补一条对照：
      待批已存在后上滚、无新内容 → 不要求未读、不强制回底；断言含 AX「等待批准…」、面板收起后
      toggle help「对话面板 · 等待批准」、`scrollTop` 截图证据；落 `.local/acceptance/`
      （场景与 fixture 已写、`--check` PASS；真机未跑）
- [ ] 7.4 `scripts/gate.sh quick` 全绿（含 `pnpm test`、tsc、docs-check、`validate --all --strict`）（未跑全量 `gate.sh quick`；本分支已单独跑 `pnpm test` / `tsc` / `docs-check` / `validate`，见 7.6 / 7.7）
- [ ] 7.5 `scripts/gate.sh visual` 全绿（本地像素层；CI 结构层不代表像素层）（未跑：整页像素层归主会话）
- [x] 7.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` PASS
- [x] 7.7 `scripts/docs-check.sh` PASS（含 MODIFIED 对账、链接、验收场景契约、backlog 门禁）
- [x] 7.8 证据归档：门禁日志、红 / 绿两侧读数、候选截图落 `.local/`（不落 worktree）；报告里给
      可 `ls` 的绝对路径
- [x] 7.9 仓库信息卫生：视觉 / 真机 fixture 只用合成 vault 名、文件名、消息文本；提交前对改动面做
      一次 text 级 grep 清扫

## 8. 归档准备与相邻 change 衔接

- [ ] 8.1 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条记录（五要件状态：待归档 /（未做：本分支只到实现提交，合并 / 归档由 tower 批次收尾执行）
      命中例外），供 `scripts/openspec-archive-check.mjs` 门禁识别
- [ ] 8.2 `proposal.md` 的节点 2 块按五要件填写：节点 1 原话、reviewer verdict 与 tip、tasks（未做：节点 2 在归档时填写）
      完成情况、门禁与真机证据指针、`openspec-archive-check.mjs` 门禁模式读数、`validate` 读数、
      队列条目唯一
- [ ] 8.3 归档时记录链位置：本 change 是前一环；后一环 `move-harness-progress-to-output-tail-nov23`（未做：归档时记录）
      必须以本 change 归档后的 living「进度呈现」为基线整块重抄，并把「滚动区外必须有审批信号」
      写成不变量
- [ ] 8.4 归档后跑 `node scripts/openspec-archive-check.mjs --archived fix-harness-approval-visibility-nov23`（未做：归档后执行）
      并取得 PASS，把归档提交 hash、包装器输出、修链读数与审计时间追加进节点 2 块
