# Tasks: add-harness-activity-presence

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重新走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 只读调查：面板收起（`attachTo(null)`）后的状态存活、`sendPhase` 的唯一写入口、快照
      `StateSnapshot` 缺在途读数、`resetView` 强刷 idle、事件按 vault 过滤、cron 两槽位差异
      （事实表见 `design.md` §1，逐条 file:line）
- [x] 0.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 实跑通过：`✓ change/add-harness-activity-presence`，
      `Totals: 34 passed, 0 failed (34 items)`，退出码 0；`scripts/docs-check.sh` PASS；归档对账门禁 PASS
      （r1 / r2 / r3 三次修订后各复跑一次，读数相同）
- [x] 0.4 Alex 节点 1 评审：D1 提示形态 / D2 失败未读归类 / D3 跨 vault 未读是否要做；裁决结果回填
      proposal 的「评审记录」块（2026-10-28 通过，原话「我无异议，待我裁定的 D1~D3 都按照倾向」：
      D1 采纳状态点、无动画；D2 失败点亮未读档、`aborted` 不产生未读；D3 不做跨 vault 未读）

## 1. 后端：轮次状态机（三态）与快照的呈现读

- [x] 1.1 `src-tauri/src/harness/session.rs`：`Session` 的 `busy: bool` 升级为三态轮次状态
      （`Idle` / `Running` / `Finishing`）；`is_busy()` 改为 `phase != Idle`——F14 的六个读点语义逐条核对
      不变；新增 `in_flight()`（仅 `Running` 为真），两个读口由同一状态派生，MUST NOT 各存一份
- [x] 1.2 写点各一处：`acquire_turn` 只接受 `Idle`（非 `Idle` 一律 `harness_busy`，语义逐字不变）；
      `release_turn` 任意状态 → `Idle`（幂等保持）；**终态发射收敛到一个 helper**（`Running → Finishing`
      后再发事件）——F15 的 **10 个位点 / 11 条语句**逐条改接，其中**必须包含自动唤醒回合
      `run_auto_turn_acquired` 的配置级 `error`（`turn.rs:1692`）与 panic `error`（`:1714`）**；漏一处就是
      假在途
- [x] 1.3 `StateSnapshot` 增 `in_flight: bool`（空态同形 `false`，键恒在场）；`src-tauri/src/harness.rs`
      的 `harness_state` 走同一份 `Runtime::snapshot`，不新增第二条读值路径；MUST NOT 把 `busy` 也塞进快照
- [x] 1.4 Rust 用例（第一类确定性回归，行为层）：三态转移（`Idle→Running→Finishing→Idle`）与两读口分工
      （`Finishing` 时 `is_busy()==true` 而 `in_flight()==false`）；**逐条终态路径**驱动后都进入 `Finishing`
      且快照 `in_flight==false`——可驱动的六条各一条行为用例：普通回合的正常 done / 配置级 error /
      空响应 error / aborted，**自动唤醒回合两条**（`run_auto_turn_acquired` 的配置级 `error` `:1692` 与
      panic `:1714`，走真实入口、不走 helper 直调）；其余三条（入队失败 `:442`、压缩重试失败 `:573`、
      LLM 错误 `:581`）以 helper 级单测 + 1.5 的源码断言兜底，测试注释写明这是覆盖边界而非漏项；
      空态快照键在场；序列化后的线上形状断言
- [x] 1.5 语义守卫与静态兜底：`Finishing` 下 `acquire_turn` 与 `new_session` 仍按 `harness_busy` 拒绝
      （协议不变）；源码级断言「终态发射只经 1.2 的 helper」——**只作静态兜底，MUST NOT 替代 1.4 的逐路径
      行为用例**（r3 现场：清单声称完整、实际漏了两条自动回合路径，静态断言抓不到）

## 2. 前端：相位以后端呈现读为真源（且只在进入点回填）

- [x] 2.1 快照按用途分档：**进入快照**（面板挂载 / `vaultChanged` / `reloadSession`）才允许改相位与
      `turnOpen`；**对账快照**（§4.2）只重建内容。`restoreSnapshot` 必须显式带档位参数，
      MUST NOT 出现「某条路径走了完整恢复却只想重建内容」的形态
- [x] 2.2 世代守卫：`phaseEpoch` 随事件推进自增，快照请求记 epoch；响应 epoch 不一致时**按档位分开**——
      **进入档只丢弃相位部分**（不应用 `in_flight`，消息 / usage 等照旧应用）；**只内容档整条丢弃**
      （清面 + 重放会把请求之后乐观上屏的新消息清掉，实现评审 r1 的追加项）。另：`resetView` 视图换代
      推进 `snapshotSeq`，作废上一代视图的全部在途快照
- [x] 2.3 进入快照按 `in_flight` 应用：`true` ⇒ running + `turnOpen` 置真 + 置「中途接管」标志；
      `false` ⇒ idle + 关 `turnOpen` + 清接管标志（**收口**——覆盖「离开期间终态被过滤」）；
      **删除终态记忆（原 `afterTerminal`）**：前端不保存任何轮次观察史
- [x] 2.4 `harness_busy` 拒绝的处置（r2 P2-1）：只上错误行 + 走**只读相位通道**
      （`fetchActivitySnapshot`：按 `in_flight` 应用 2.3 的相位与闸门，**不重放内容**）；
      **MUST NOT 直接改相位**（删除原 `busy_rejected`），拒绝不得作为在途证据，也 MUST NOT 用
      进入档全量恢复（已有内容的 transcript 会重复上屏、并强制回底——实现评审 r1 P1-1）
- [x] 2.5 终态置假之后 `turnOpen` MUST NOT 被任何快照或对账路径重开（接线层单一函数施加）
- [x] 2.6 删除 / 改写 `resetView` 里「相位归 idle」那条口径的注释，写明「复位后由进入快照的 `in_flight`
      回填」的次序，并注明「对账快照不回填相位」「终态已发、尚未释放的窗口由后端报不在途」（注释不得继续
      描述旧行为）

## 3. 未读状态机与呈现

- [x] 3.1 纯函数状态机（`design.md` §3 的转移表）：入参含 `mounted`，出参 `{ phase, unread }`；
      相位逐条委托既有 `reduceSendPhase`（`sent` / `stop_clicked` / `finished` 三个事件），
      **必须包含 `stop_clicked` 输入**（r1 P2-2：否则 stopping 会有两个持有者）；无 DOM、可零 DOM 单测
- [x] 3.2 接线：`done` / `error` / `aborted` 三个终态把 `mountEl !== null` 传进状态机；停止按钮点击
      经状态机的 `stop_clicked` 输入（不绕过状态机直接调 `applySendPhase`）；`attachTo(null)`
      MUST NOT 清相位、MUST NOT 清未读（收起 ≠ 复位）；`attachTo(mount)` 清未读
- [x] 3.3 `vaultChanged` 清未读（作用域口径）；无人值守 cron 与 `notice` 不进入状态机
- [x] 3.4 toggle 钮三态：状态点子元素常驻 DOM，经单一函数施加 `data-activity`；空闲态 `display:none`
      保证零像素漂移
- [x] 3.5 可访问性：三态经 `aria-describedby` 指向视觉隐藏的状态文本；终态经 `aria-live="polite"` 播报一次；
      三态文案同时写进 toggle 的 `title`（M779 真机定位：WKWebView 把钮当叶子节点，钮内文本与 `aria-describedby`
      在 AX dump 里读不到，`title`——AX `help`——是唯一可判定通道；写点仍只有 `applyActivityBadge` 一处）
- [x] 3.6 文案：`src/copy-data.ts` 增状态文案 zh/en 双档（处理中 / 有新的回复 / 有失败结果），
      随 `onRelabel` 重绘；不新增中文字面量（`tests/unit/copy.test.ts` 迁移门禁）
- [x] 3.7 样式：`src/harness-panel.css` 状态点（6×6、锚在钮内右下、三态形状、三主题、无动画）；
      所有取值走 token 层

## 4. 在途轮次的重连续与终态对账

- [x] 4.1 「中途接管」标志：由**进入快照**把相位拉到 running 时置位，`sent` / 终态后清除
- [x] 4.2 终态到达且标志置位时按后端快照重建渲染面一次（**只内容档位** `fetchSnapshot("content")`，
      与 `cronRunAdopted` 的收尾合并成同一次请求）：MUST NOT 读该快照的 `in_flight`、MUST NOT 改相位、
      MUST NOT 重开 `turnOpen`、MUST NOT 走会清未读的 `reloadSession`（实现评审 r1 P1-2）；
      重建 MUST NOT 违反「强制回底白名单」（终态不在白名单里，视口不因对账被拽回底部）；
      视图换代（`resetView`）MUST 作废在途快照（推进 `snapshotSeq`），否则新建会话会把旧会话消息
      重放进新视图（实现评审 r1 P1）
- [x] 4.3 `done` / `error` / `aborted` 三类终态一致处理（重建幂等；无新消息时是空动作）

## 5. 测试与验收场景（随实现同批）

- [x] 5.1 `tests/unit/harness-activity-presence.test.ts`：状态机全表（每条转移一条断言）、
      `opened` 清未读、`aborted` 不置未读、`vault_changed` 清未读、epoch 不一致时模型不应用该进入快照
      （相位不动；消息 / 读数的过期处置属接线层，按档位分开——见 2.2）
- [x] 5.2 `tests/unit/harness-activity-wiring.test.ts`：源码级结构对账（进入快照路径按 `in_flight` 调
      相位 / 闸门恢复、**对账路径只走内容档位且不读 `in_flight`**、三类终态传 `mounted`、停止点击经
      状态机、`harness_busy` 只走只读相位通道不直接改相位、`attachTo(null)` 不复位、三态由唯一函数施加、
      只内容档的世代守卫与视图换代作废（`resetView` 推进 `snapshotSeq`））
      ——同一层、同一理由见 `tests/unit/harness-cron-click-run.test.ts`
- [x] 5.2a **r2 / r3 P2-1 第二类回归 + 新轮/旧轮交错矩阵**（纯模型层，与 §1.4 的后端第一类回归成对）：
      按 `design.md` §10 的 11 行矩阵逐行断言（旧轮已观察终态后快照报不在途 ⇒ 不复活；离开期间终态被
      过滤 ⇒ 进入快照收口；旧轮结束后新轮在途 ⇒ running；`stopping` 下两种 `in_flight` ⇒ 保持 stopping；
      对账快照不动相位；自动回合两次终态未读只一枚；同 vault 重复进入快照幂等；**自动回合在配置错误 /
      panic 上结束后的进入快照 ⇒ idle**）；模型里 MUST NOT 存在「`harness_busy` ⇒ running」这条转移
      （源码级断言），每条断言写明「实现改成直接改相位 / 靠本地终态记忆时它必红」
- [x] 5.2b **r1 P2-2 确定性回归（保持不变）**：`idle + stop_clicked ⇒ idle`、
      `running + stop_clicked ⇒ stopping`、`stopping + stop_clicked ⇒ stopping`（幂等）、
      `stopping + terminal ⇒ idle`、`stopping + enter_snapshot(inFlight:true|false) ⇒ stopping`；
      并逐条断言相位输出与 `reduceSendPhase` 的同事件输出相等（委托而非重写）
- [x] 5.3 先红证据：红跑 = M777 在 master `9232ab3a`（含本 change 合并）跑 252 / 253，两条判红，观测面正是
      「无状态文本 / 切回呈空闲」——证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-28-m777-dev/252-harness-activity-presence/`
      与 `.../253-harness-vault-activity/`；绿跑 = M779 修复分支，252 34/0、253 29/0（证据根
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-28-m779/`）。口径边界（不夸大）：两跑的
      252 / 253 判据文本不同（M779 把在途判据移到收起态、角色改 AXCheckBox），这对红绿证明的是「根因修复前后
      判据由红转绿」，MUST NOT 被读成「实现前的红」——实现前那次红始终未跑，见下方「真机批（M777）」记录
- [x] 5.4 新增 `scripts/acceptance/scenarios/252-harness-activity-presence.md`：收起期间完成 → 在途 →
      未读 → 打开面板后状态文本消失、回答在场；失败轮次点亮失败档；停止不点亮
- [x] 5.5 新增 `scripts/acceptance/scenarios/253-harness-vault-activity.md`：跨 vault 往返仍在途 → 切回后
      发送钮为停止态 + 状态文本为处理中 + 后续增量上屏 + 终态后完整回答（对账生效）；完成后往返
      （切走 → 该轮结束 → 切回）：指示空闲、快照完整铺开；重复切换 A→B→A→B→A 不丢在途态、终态只收口一次
- [x] 5.6 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`；`node scripts/acceptance/run.mjs --check` 绿
- [x] 5.7 `tests/visual/scenes/m756-harness-activity-presence.spec.ts`：三态结构断言 + 状态点锚在钮矩形内
      + 空闲态无新增节点上屏；**不新增整页像素基线**（基线新增是 Alex 人肉裁决点）
- [x] 5.8 回扫既有整页基线：`gate visual` 全量整页像素跑绿（`visual-regression` 604s，888+ 场景 0 失败、
      零基线改动——git 里 `tests/visual/baselines/**` 无 mtime 变更），`hp-toggle` 命中的场景逐条在内

## 6. 门禁与证据

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` PASS（提案期读数：见完工报告）
- [x] 6.2 `node tests/unit/run.mjs` + 三份 `tsc --noEmit`（根 / 单测 / 视觉）全绿
- [x] 6.3 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行与退出码）
- [x] 6.4 `scripts/gate.sh visual` 全绿：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0
      （`visual-regression` 604s，`isolation-runs` 1s；动过 `src/harness-panel.css`，本地整页像素层已跑）
- [x] 6.5 真机跑 252 / 253（M779 批，2026-10-28）：252 PASS 34/0、253 PASS 29/0；另连带 125 PASS 16/0、
      165 PASS 10/0（存量会话旧拼写归属的既有场景）——证据根
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-28-m779/`（summary.md / results.json
      与各场景 steps.md、shots/、ax/）。170 未运行（不在本 change 的验收面）
- [x] 6.6 `bash scripts/docs-check.sh` PASS

## 7. 收尾

- [x] 7.1 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条记录（五要件状态如实写）
- [x] 7.2 节点 2：五要件齐（逐条事实与指针见 proposal「节点 2 记录（归档前）」块）——M779 独立评审
      clean / merge、真机 252 / 253 / 125 / 165 全绿、quick 13/13 与 visual 15/15、归档对账门禁与
      `validate --all --strict` PASS；未命中例外类别，由 M787 执行归档；归档后读数见 proposal 同块

## 真机批（2026-10-28 自动窗口，M777）——**当轮未通过**（历史记录：该轮判红是 M779 的先红证据，
缺口已由下方 M779 批闭合）

环境：主仓 master `9232ab3a`（含本 change 合并），dev flavour（`pnpm tauri dev`）、隔离
`XDG_CONFIG_HOME`、合成 vault、端口 1430、`caffeinate -dimsu`；起跑前安装版实例已按
`scripts/acceptance/README.md`「安装版实例」条正常退出（空闲 ≥10 分钟 + 无未保存标记 + ⌘Q）。
其余场景（254 / 169 / cron 类）同批跑的记录见另两份 change 的 tasks。

证据根：`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-28-m777-dev/`

- **5.3 先红证据：未做**。旧构建红跑只在「本分支绿跑成立」时才有放行意义；本轮绿跑没有成立，
  先红不构成任何归档依据，故未另起一次旧 commit 构建（省一次全量重编）。要补时以
  `4976ae7d`（本 change 合并前一个 master tip）为基线。
- **6.5 真机 252 / 253：FAIL（两条都判红，253 复跑一次结论相同）**
  - `252-harness-activity-presence`（场景段 68.4s）：
    PASS —— pane 出现、空闲态无状态文本、发送后发送钮切「停止」（面板内**在途**承载体）。
    FAIL ① `ax.has "处理中"`（在途那一刻，停止钮在、状态文本不在 AX 里）；
    FAIL ② `node { role: AXButton, name: "对话面板" }`——该钮的 AX 角色实测是 **AXCheckBox**
    （`Value: 0`，`aria-pressed` 家族），场景写死了 AXButton；
    FAIL ③ 随后等「有新的回复」60s 超时（`do` 动作失败 ⇒ 后续步骤跳过，未读两档与停止档
    本轮**未取得任何观测**）。
  - `253-harness-vault-activity`（场景段 68–70s，两跑一致）：
    PASS —— 切到 B 时面板无 A 的在途态、装载完成即可断言。
    FAIL ① 切回 A 后 `ax.has "处理中"` 不存在；FAIL ② 打开面板后发送钮呈「发送」（＝假空闲），
    「停止」不在；FAIL ③ 等 `VAULT-C 第三片。` 60s 超时（面板已打开）。
    **「后端已完成该轮」：当时观察到，当前不可独立复核（原卷已丢失）**。复跑期间直接在套件的
    活动隔离目录读到 `env/lumir/harness/sessions/acc-a/s1793159456614-olm8x7.jsonl`：
    `llm_request` @03:50:56 → `llm_response` @03:51:12、全文含 `VAULT-A/B/C` 三片。但随后的
    bundle 跑批在拷贝**之前**就把该目录重置了，`…-253-rerun/env-snapshot/` 因此是空目录；已按
    文件名与 session id 全量检索 `.local/`，无任何副本——**这条读数不能再按指针复核，不得当作
    已落盘的证据引用**。要重新取得它：重跑 253，并在任何后续跑批之前把
    `env/lumir/harness/sessions/` 整体拷到该场景目录下。
    可复核的部分只有 `steps.md` 与 `ax/` dump：切回后发送钮是 `AXButton (发送)`、composer 与
    transcript 全空（两跑一致）。据此能确定的是**「切回后呈空会话 + 假空闲」这一症状成立**；
    「该轮后端是否仍在跑 / 已跑完」需要重跑取证后才能定论。
- **诊断（供下一轮定位，未改动任何代码）**
  1. AX 面：三态的状态文本由 `src/harness-panel.ts:6829` 写进 `aria-describedby` 指向的
     clip 隐藏 span（`.lumir-hp-toggle-status`，`src/harness-panel.css:120`），KimiCU 的 AX dump
     不暴露描述属性——`处理中` / `有新的回复` / `有失败结果` 在 252 / 253 的全部 dump 里零命中。
     场景头部的「已知首跑风险（AX 面）」正是这条；要么改判据载体（toggle 的可读描述 / 截图 +
     送钮两态），要么让实现把状态挂到能进 AX 的属性上。**改哪一侧都不在本任务授权内**
     （任务约束：只执行不修改 `scripts/acceptance`）。
  2. 角色映射：toggle 实测 `AXCheckBox`，场景的 `node: { role: AXButton }` 恒红——属场景面
     （同族登记见 `scripts/acceptance/README.md`「`aria-haspopup` 的钮在 AX 里不是 AXButton」）。
  3. 253 的空会话 + 假空闲是**产品面**，与 AX 面无关（发送钮是真实 AXButton，停止→发送的翻转
     是行为读数）。判据不依赖上文那条不可复核的后端读数：无论该轮当时仍在途还是已结束，切回后
     都不该呈现为一个空白新会话。修好前本 change 的核心承诺在真机不成立。

## 真机返修批（2026-10-28，M779）——**PASS，上文证据缺口已闭合**

**根因（定位结论：不在前端快照消费侧）**：同一个 vault 被后端当成两个会话桶——启动恢复用配置里的
`/tmp/lumir-m102-acceptance`（原始拼写）打开，vault 列表用注册表里的
`/private/tmp/lumir-m102-acceptance`（规范化拼写）切回；harness 会话表按根路径字符串分桶
（`VaultScope::key()`，M312 设计不改），切回时 `harness_state` 命中不了原会话、返回
`StateSnapshot::empty`，面板如实渲染「空闲空会话」，而那一轮其实在旧桶里跑完（M777 现场 JSONL 的
`VAULT-A/B/C` 三片即此）。252 的判红另有两条承载面原因：三态文案只写进 `aria-describedby` 指向的隐藏
span（WKWebView 把钮当叶子节点 ⇒ 钮内文本不进 AX 树，dump 也不打印 AXDescription），以及场景把 toggle
角色写死 `AXButton`（实测 `AXCheckBox`）。

**修复（tower 裁决 A，依据见 `.tower/comms/missions/M779-fix-harness-activity-real-vault-restore.md`
的 Notes）**：

- `src-tauri/src/commands.rs`：新增 `canonical_vault_root`，`prepare_vault_open` 一进来就归一——启动恢复 /
  列表切换 / cron 目标三条来路因此同一把键、同一个根字符串；规范化失败拒绝打开并如实报错。
- `src-tauri/src/harness.rs`：会话归属判据改比**目录身份**（`session_belongs_to_scope`：逐字相等快速通过，
  否则两侧 `canonicalize` 后比，取不到身份不认）；存量 JSONL 不改写、不改分桶。
- `src/harness-panel.ts`：三态文案同时写进 toggle 的 `title`（AX `help`），写点仍只有 `applyActivityBadge`
  一处；空闲态 `title` 逐字等于既有 `D327`（零漂移）。
- 252 / 253 判据按真机可观测面修正：角色改 `AXCheckBox`；在途判据移到收起态；「打开即清算」从展开态的
  恒真负向断言改成收起后可观测的判据。
- 回归：`src-tauri/tests/workspace_scenarios.rs`（两种拼写同一根 + 注册表路径一致）、
  `src-tauri/tests/harness_runtime.rs`（归一前两把键、归一后同一会话读回）、`src-tauri/src/harness.rs`
  的归属判据六形态单测、`tests/visual/scenes/m756-harness-activity-presence.spec.ts`（A→B→A 往返，桩带
  真后端的 vault 键——旧桩缺该键使 `inCurrentVault` 准入分支从未被覆盖）、
  `tests/unit/harness-activity-wiring.test.ts`（title 载体的单一写点）。

**证据**：

- 真机（M779，2026-10-28）：252 PASS 34/0、253 PASS 29/0、125 PASS 16/0、165 PASS 10/0——
  `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-28-m779/`（`summary.md` /
  `results.json` / 各场景 `steps.md`、`shots/`、`ax/`）。125 / 165 是刻意预置 `/tmp` 原始拼写旧会话的
  场景，用来验证归属判据没把存量会话判成孤儿。
- 门禁：`scripts/gate.sh quick`（tip `dbbed73a`）`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；
  `scripts/gate.sh visual` 由独立 reviewer 在最终 tip 空载复跑 `GATE RESULT: 15/15 PASS（SKIP 0）`，
  退出码 0（`visual-regression` 896 passed / 1 skipped，578s）。worker 自跑那一轮因并行真机批满载判
  `GATE RESULT: 14/15 PASS（SKIP 0）`（唯一红是 `acceptance-suite` 的 settle 自测），如实留痕，以
  reviewer 空载复跑为准。
- 评审：`.tower/comms/reviews/review-feat-fix-harness-activity-real-vault-restore-reviewer-fix-harness-activity-r1.md`
  （`status: clean` / `merge: merge`，`reviewed_commit: dbbed73a`；合并 tip `71d38148` 是同一批提交的
  rebase，四条提交 `git patch-id --stable` 实测逐一相同）。
- 规格对账：`bash scripts/docs-check.sh` PASS（退出码 0，含归档对账门禁 / 归档队列 / backlog 出口）；
  `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 36 passed, 0 failed (36 items)`，
  退出码 0（归档前读数；归档后复跑读数见 proposal「节点 2 记录」块）。
