# Proposal: harness 面板的活动在场（收起态在途 / 未读提示，跨 vault 的真在途相位）

- Change ID: `add-harness-activity-presence`
- 日期: 2026-10-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过（2026-10-28）**。Alex 原话：「add-harness-activity-presence 我无异议，
> 待我裁定的 D1~D3 都按照倾向。」三个裁决点因此逐条按「裁决点」一节的倾向落地：
> **D1** 采纳标题栏 toggle 钮右下角的小状态点（在途 = 空心环、未读回复 = 实心圆点、未读失败 =
> 实心圆点 + 外环，形状承载语义），**不做呼吸 / 脉冲动画**；
> **D2** 采纳分档——`error` 终态在面板收起时点亮「失败」档未读，`aborted`（用户主动停止）不产生未读；
> **D3** 本期**不做**跨 vault 完成的未读，只保证切回当前 vault 时在途准确，跨 vault 未读列为非目标。
> 本提案只到节点 1，不含实现。
> **r1 修订（2026-10-27）**：reviewer 判 `p2-2items` / `fix-then-merge`，两条 P2 只改制品、不动生产代码。
> P2-1 采用「终态对账只重建内容，不用该快照覆盖终态相位、不重开轮次闸门」+ 进入快照的 `afterTerminal`
> 守门，并补 done / error / aborted 之后读到 `busy:true` 不得复活 running 的确定性用例；P2-2 采用「新
> reducer 增加 `stop_clicked` 输入、内部委托既有 `reduceSendPhase`」，保持相位只有一份投影，并补停止路径
> 的全表用例。（r1 的「不改后端 busy 协议」口径已被 r2 取代：协议**语义**仍不变，但后端内部真值升级为
> 三态——见下。）
> **r2 修订（2026-10-27）**：reviewer 判 `p2-1items` / `fix-then-merge`——本地 `afterTerminal` + 布尔
> `busy` + 无条件 `busy_rejected` 仍分不清「新轮真在途」与「旧轮已发终态、busy 未释放」，反例是「终态在
> 离开期间被过滤」与「终态后立即发送被拒」。采纳后端权威合同：`Session.busy` 升级为三态轮次状态机
> （`Idle` / `Running` / `Finishing`），`is_busy()` 语义不变、新增 `in_flight()` 进快照；前端删掉终态
> 记忆与 `busy_rejected`，`harness_busy` 只触发一次快照重取。未采用「先 release 再发终态」——它会引入
> 「旧轮终态落到新轮上」的反向竞态（论证见 design §4）。改动面：`proposal.md`、`design.md`
> （§1 / §3 / §4 / §5 / §10 / §11 / §12）、`specs/harness/spec.md`、`tasks.md`（§1 / §2 / §5）。
> **r3 修订（2026-10-27）**：reviewer 判 `p2-1items` / `fix-then-merge`——r2 的「全部终态发射点」清单只
> 收了普通回合的八处，漏掉 **`run_auto_turn_acquired` 的配置级 `error`（`turn.rs:1692`）与 panic
> `error`（`:1714`）**；两处都在 `auto_turn_started` 已把面板置 running 之后、`:1729` 才释放，窗口同形。
> 本轮把 F15 改成完整清单（**10 个位点 / 11 条语句**），design §4 的 helper 改接与 §10 的第一类回归、
> tasks 1.2 / 1.4 / 1.5 及 spec 的相关条款一并点名这两条路径；Rust 回归要求走 `run_auto_turn_acquired`
> 真实入口各一条独立用例，并写明**源码级「只经 helper」断言不能替代行为用例**（r3 正是静态清单声称完整、
> 实际漏路径的现场）；交错矩阵补一行「自动回合终态 → 进入快照」。改动面：`design.md`（§1 F15、§4、§10、
> §12）、`specs/harness/spec.md`（在途判据段 + 新增 scenario）、`tasks.md`（1.2 / 1.4 / 1.5 / 5.2a）、
> 本文件的评审记录。
> **r4 修订（2026-10-28，实现评审 r1 返修）**：reviewer 判 `p1-2items` / `fix-then-merge`，两条
> 都是本 change 明示场景的可确定功能回归，处置如下（不扩行为、不改口径）：
> **P1-1** `harness_busy` 拒绝后的重取改走**只读相位通道**（`fetchActivitySnapshot`）——原实现用
> 进入档全量快照，会在已有内容的 transcript 上把历史消息 append 第二遍并强制回底；
> **P1-2** cron 点击运行**正常结束**的内容重建改走**只内容档位**（与中途接管对账合并成一次
> `fetchSnapshot("content")`），不再复用 `reloadSession`——后者经 `resetView` 以 `vault_changed`
> 结算，会把该轮刚产生的未读清掉（`reloadSession` 保留给点击运行**发起失败**的回滚）。
> 同一轮追加：**内容档快照补世代守卫**（请求之后已开始新一轮 ⇒ 整条丢弃），否则回包落地会把
> 请求之后乐观上屏的新消息清掉。三处各配一条行为回归（旧实现必红），见 m756 场景。
> 节点 2（归档评审）：实现完成后填写。

## Why

### 现场（Alex dogfood 原话）

> 为 harness 增加一个在途状态：当会话在处理中，而我收起 harness pane 时候，让我能看到一个状态提示。
> 场景比如：我问了一个问题，agent 在处理，然后我收起 harness pane，这样 content pane 获得更大宽度、
> 方便我阅读正文。但我希望 agent 处理完、有回复后，我能知道，这样就能再打开 harness pane 查看 agent
> 的处理结果或回复。另外如果会话正在处理中，我切到其他 vault，再切回当前 vault，harness pane 看上去
> 是停止的、我可以发新消息，但实际上如果我发新消息，就会提示我会话正在进行中，这可能说明在这种切换
> vault 的情况下，harness pane 的 UX 显示不准确。

两个症状是同一个缺口的两面：**harness 面板的活动状态只活在面板内部，一旦面板不在屏幕上（收起）或
不在当前会话作用域（切 vault），活动就无处呈现、也无处恢复。**

### 症状一：收起后活动不可见

- 收起 harness pane 走 `disposePaneHandle` → `harnessPanel.attachTo(null)`（`src/main.ts:461`）：
  面板 DOM 被摘下，但**事件订阅、流式态、发送相位都长驻内存**（订阅在构造期装一次
  `src/harness-panel.ts:9094`；`attachTo` 的摘下分支只摘 DOM 与浮层，见 `src/harness-panel.ts:10245-10267`）。
  也就是说「这一轮跑完了」这个事实，面板内部知道，屏幕上没有承载体。
- 收起后仍在屏幕上的 harness 承载体只有标题栏那颗 toggle 火花钮（`src/harness-panel.ts:3860`，
  样式 `src/harness-panel.css:21-61`），而它只有「开 / 合」两态（`aria-pressed`），没有第三态可表达
  「在途」或「有新结果」。
- 现有 spec 没有任何条款约束面板收起期间的活动呈现（`openspec/specs/harness/spec.md` 的「发送与停止」
  只定义发送钮两态、「进度呈现」只定义面板内的阶段行）。

### 症状二：跨 vault 往返后假 idle（这是一条可复现的相位错误，不只是观感）

切 vault 时面板做三件事，恰好把在途真相抹掉：

1. **事件按 vault 过滤**：`handleEvent` 的第一道闸是 `inCurrentVault`（`src/harness-panel.ts:8810`），
   切走后旧 vault 的在途事件一律丢弃——而后端的工具循环线程**不会因切 vault 中断**（同一处注释写明）。
2. **相位被强制归 idle**：`vaultChanged` → `resetView`（`src/harness-panel.ts:9483` / `:9402`）末尾
   `applySendPhase(finished)` 把相位刷回 idle，并把轮次闸门 `turnOpen` 关掉（`:9432`）。这不是疏漏，
   当时的理由是「旧会话那一轮的 done 事件可能永远到不了这里」（`:9448-9450` 的注释）——**用错了补偿方向**：
   正确的补偿是从后端重取真相，而不是假定「没有在途」。
3. **快照里没有在途读数**：`StateSnapshot`（`src-tauri/src/harness/session.rs:402-429`）带消息、usage、
   待批项、标题，**唯独不带 `busy`**；`restoreSnapshot`（`src/harness-panel.ts:9309`）因此无从恢复相位。

由此得到的可复现路径：vault A 发问 → 切到 B → 切回 A。此时

- 发送钮呈现空闲（`send()` 只检查本地相位，`src/harness-panel.ts:9541`），但下一句发送会被后端
  `acquire_turn` 以 `harness_busy` 拒绝（`src-tauri/src/harness.rs:303-321`）——正是 Alex 描述的
  「看上去能发、一发就被拒」；
- 更隐蔽的一半：即使不发消息，**在途轮次的后续增量也被轮次闸门丢弃**（`turnOpen === false` 时
  `GATED_EVENT_TYPES` 一律早退，`src/harness-panel.ts:8814`），回答再也上不了屏，直到终态事件
  触发收口。

后端本来就有唯一真值：`SessionContext.busy`（`src-tauri/src/harness/session.rs:549` / `:757`，
`Runtime::session_busy` 已在用，`src-tauri/src/harness.rs:459-470`）。缺的只是**把它暴露进快照**这一个字段。

### 为什么现在做

- 这是 dogfood 现场直接提出的交互缺口，当前 spec 无条款覆盖，属于新行为——按 ADR 0004 与
  [openspec-workflow.md](../../../docs/process/openspec-workflow.md) 走节点 1。
- 症状二的修复成本集中在「把后端唯一真值接进来」，越晚做，越多前端路径会继续复制「本地相位即真相」
  的假设（现有 `beginCronRun` 的忙判定、`send()` 的前置闸都是这条假设的消费者）。

## What Changes

对应 spec delta：`harness` capability 新增一条 requirement「面板收起与跨 vault 的活动在场」。
**新增行为，不改既有条款的语义**（发送钮两态、busy 协议语义、cron 通知通道均不动；后端内部真值升级为
三态，见下第 2 条）。

1. **标题栏 toggle 钮三态**：空闲（现状，零像素漂移）/ 在途 / 有未读结果。提示只承载在**始终在场**的
   那颗钮上，面板本体不新增常驻 UI。
2. **在途 = 后端轮次状态机的一个读口**：今天的 `busy` 是一位真值，把「轮次在跑」与「终态已发、尚未释放
   会话」压成同一个值，前端靠本地记忆补不出二者的差别（r2 P2-1 的两条反例）。本 change 把后端 `Session`
   的 `busy: bool` 升级为三态（`Idle` / `Running` / `Finishing`）：`is_busy()`（协议读）保持今天的语义
   ——`phase != Idle`，六个既有读点逐字不变；新增 `in_flight()`（呈现读）= 只有 `Running` 为真。
   `harness_state` 快照报 `in_flight`，面板在装载 / 切回 vault / 恢复会话时按它恢复相位；前端 MUST NOT
   保存终态记忆，也 MUST NOT 把 `harness_busy` 拒绝当作在途证据。**相位仍只由既有的 `reduceSendPhase`
   产出**（`sent` / `stop-clicked` / `finished`，`stopping` 子态与连点幂等语义逐字不变）。
3. **在途轮次的重连续**：切回一个仍在途的 vault 时（`in_flight:true`），后续增量 SHALL 继续上屏（轮次闸门
   随相位恢复）；进入快照报 `in_flight:false` 时界面直接收口（相位 idle、闸门关、清接管标志）——包括
   「离开期间终态被事件过滤」的情形，不再等一个永远不会来的事件。终态到达时以后端快照**只重建内容**一次：
   切走期间错过的正文不会以「残缺流式泡」的形式留在 transcript；对账那份快照 MUST NOT 参与相位判定。
   **不改终态与释放的次序**：改成「先释放再发终态」会让旧轮终态落到新轮上（新轮被误收口、分片被闸门丢弃），
   只是把窗口搬到反方向。
4. **未读的分类与清算**：只由**轮次终态**产生，按终态种类分档（成功回复 / 失败）；用户主动停止不产生
   未读；**重新打开面板**即清算；MUST NOT 用数字计数。
5. **作用域**：只呈现**当前 vault** 的会话活动；后台（无人值守 / 隔离 runtime）cron 运行不点亮
   （它的结果不进 transcript，走自己既有的通知通道）；点击发起的 cron 运行走交互槽位，按普通轮次呈现。
6. **可访问性与主题**：状态 SHALL 在 toggle 钮的可访问名 / 描述上可读（不单靠颜色承载，也因此可由
   真机验收的 AX 断言判定）；三主题成立（eink 不引入彩色）；不引入新快捷键、不新增动画。

## Non-goals

- **不自动展开面板、不抢焦点、不切 vault**：提示只是「告诉你去看」，开合权在用户（Alex 原话是
  「让我能看到一个状态提示」，不是替他打开）。
- **不做系统级提醒**：不发 macOS 通知、不加 Dock 徽标 / 菜单栏图标 / 声音。cron 的通知通道是另一条
  能力（change `surface-cron-notify-failure`），本 change 不碰。
- **不做未读计数、不做未读列表**：流式增量与工具行不构成可计数的「消息」单位，任何数字都是伪造读数
  （与 `harness` 既有「回到底部」钮的未读提示同一条纪律）。
- **不改 busy 协议语义**：一轮一次、在途拒第二个 `send`、在途拒绝 `new_session` / 恢复，语义逐字不变
  （只把后端内部的一位真值换成三态，见 What Changes 第 2 条）。
- **不覆盖后台子代理的 `notice` 事件**：后台完成通知仍按既有形态上屏；它的未读由所触发/所属轮次的
  终态承载，本 change 不为单一 `notice` 点亮指示。
- **不做窗口焦点态**（app 在后台 / 另一窗口在前台）：那会引入第二个事件源（窗口激活），本期只按
  「面板是否在屏幕上」判定。
- **不新增快捷键**、不改标题栏既有布局节奏（钮位与尺寸不变）。

## Impact

- 影响的 specs：`harness`（1 条 ADDED requirement）。
- 影响的代码 / 系统（概览，不写实现细节）：
  - Rust：`src-tauri/src/harness/session.rs`（`busy` 升级为三态轮次状态机 + 快照 `in_flight` 与空态
    一致性）、`src-tauri/src/harness.rs`（`acquire_turn` / `release_turn` 的写点改接三态）、
    `src-tauri/src/harness/turn.rs`（终态发射收敛到一个同时置 `Finishing` 的 helper）。
  - 前端：`src/harness-panel.ts`（相位恢复、未读状态机、toggle 三态、在途重连续与终态对账）、
    `src/harness-panel.css`（状态点）、`src/copy-data.ts`（状态文案 zh/en 双档）。
  - 测试：`tests/unit/harness-activity-presence.test.ts`（纯模型）、`tests/unit/harness-activity-wiring.test.ts`
    （装配结构对账）、`tests/visual/scenes/m756-harness-activity-presence.spec.ts`（结构断言）、
    `scripts/acceptance/scenarios/252-harness-activity-presence.md` 与 `253-harness-vault-activity.md`。
- 关联约束：
  - ADR 0002 §6：活动呈现 MUST NOT 进入编辑器 keypress-to-paint 路径（本 change 只读上一次状态、
    只在事件边界更新，不引入新定时器轮询）。
  - ADR 0004：AI-only 开发；节点 1 硬门禁由本提案承担。
  - 视觉基线：**预计零像素漂移**（空闲态不新增任何上屏像素），既有 28 个含 toggle 钮的场景照跑；
    本批不新增像素基线（基线更新 / 新增是人肉裁决点，见 `tests/visual/README.md`）。
- 影响面判定：属**新增能力**，不改既有产品设定、不推翻既有实现 → 不触发「影响面升级线」，但按新交互
  能力走节点 1。

## 裁决点（未回按倾向落地）

- **D1 提示形态（视觉裁决）**：在 toggle 火花钮右下方加一枚小状态点——在途 = 空心环、未读回复 =
  实心圆点、未读失败 = 实心圆点 + 外环（形状承载语义，颜色只做增强，eink 自然成立）。
  倾向：采纳；**不做呼吸 / 脉冲动画**（发送钮已有脉冲环，标题栏再动会在阅读时持续分散注意力，
  且省掉 `prefers-reduced-motion` 一条分支）。
- **D2 失败结果的归类**：`error` 终态在面板收起时点亮「失败」档未读；`aborted`（用户主动停止）不产生
  未读。倾向：采纳——停止是用户自己按的，提醒他只是复述他刚做的事；失败则是他需要看一眼的东西。
- **D3 跨 vault 完成的未读**：本期**不做**。场景：在 vault A 发起 → 切到 B → A 的轮次在 B 期间完成 →
  切回 A。按本提案，切回时指示呈空闲、回答由快照完整铺开（在途准确这一半是本次必修）。要做「A 有新回复」
  的跨 vault 提示，需要后端额外暴露每会话的「上一轮终态 + 已读水位」——那是第二份真源，且本轮证据
  只要求「在途显示准确」。倾向：列为非目标，若 Alex 要，单开 change。
