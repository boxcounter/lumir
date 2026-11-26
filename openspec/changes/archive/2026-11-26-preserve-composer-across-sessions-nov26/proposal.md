# Proposal: 新建 / 切换会话保留 composer

- Change ID: `preserve-composer-across-sessions-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-26）。Alex 对「新建、切换会话时保留 composer」的方案回复
> 「采纳」。批准的合同逐字如下：
> **新建或选择其他会话只切换消息列表；composer 的文字、引用卡、图片、Skill、光标和撤销历史全部
> 保留；下一次发送到当前选中会话；只有发送成功或用户手动删除才清除；切换 vault 仍恢复各 vault
> 自己的草稿，不跨 vault 混用。**
> 范围：只覆盖**同一个 vault 内**的新建 / 选择 / 恢复 / 重载会话；切 vault 的 per-vault 草稿
> 恢复与「发送成功清空」语义逐字不动。
> 节点 2（归档评审）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md`「节点 2 五要件」），
> 逐要件事实见本文末「归档记录」。

## Why

### 现象

用户在 composer 里写了一段问题、引用了一两段摘录、贴了一张图、用 `/` 选了一个 Skill，
此时想「先看一眼另一个会话」或「开一个新会话再问」——只要点标题栏的「＋新会话」，或在
会话浮层里选另一条历史，刚写的内容连同引用卡、图片、Skill、光标位置与撤销历史**全部消失**；
盘上的草稿也被删掉，切走再切回、重启应用都找不回来。用户没有发送、也没有手动删除，内容
却没了。

### 机制（根因，基线 `a9152deca`）

两条入口在成功回包里复用同一段「清渲染面 + 清输入区 + 清草稿」的组合：

- `src/harness-panel.ts` 的 `startNewSession()`（约 `10807`）：`resetView(...)` 之后
  `resetComposer()` + `void draft.clear()`；
- `src/harness-panel.ts` 的 `reloadTargetSession()`（约 `10905`）：`resetView(...)` 之后
  同样的 `resetComposer()` + `void draft.clear()`（cron 发起失败回滚与「打开会话通知」的重载
  通道共用它）；
- 选择历史会话的 `resumeSession()`（约 `11138`）不清 composer——所以「选择会话清空」的实际
  体验来自用户此前点过「＋新会话」，或来自重载通道。

`resetComposer()` 会 `composerView.setState(createComposerState(...))`——换 `EditorState`
即**换掉整条 CodeMirror history**；`draft.clear()` 会把该 vault 的盘上草稿写空（删除）。
`resetView()` 本身只清 transcript / 会话视图，输入区不在它的职责内；两条入口把「换会话视图」
误解成了「换输入区」。

现行 living spec 把这一行为写成了合同：`openspec/specs/harness/spec.md` 的「CM composer 的
单一 history」条（约 `3453`）写死「新会话与会话重载 MUST 同时清除当前 bound vault 的盘上
草稿」、并把新会话 / 会话重载列入「必须新建 `EditorState` 重置 history」的装载 / 复位面。
本 change 以 MODIFIED delta **有意 supersede** 该写法：新合同是「会话切换只换消息列表，输入区
原样保留」，只有发送成功与用户手动删除才清空。

### 为什么是现在

- 这是**静默丢字**：用户没有任何「我要放弃输入」的动作，内容与草稿却一起消失，撤销也救不回
  （history 已被换掉）；
- 与「会话列表可切换 / 可恢复」的既有能力组合后，误触面积变大：会话浮层本来用于回看，现在
  回看的路径旁边就是「＋新会话」，代价却是丢掉正在写的问题；
- 修复面小且可机器判定：输入区状态、卡片 / Skill 投影、草稿写盘调用与撤销历史都能在
  chromium 场景里逐字段断言。

## What Changes

1. **会话切换只换消息列表（`harness` 修改「CM composer 的单一 history」条）**
   新建会话、选择 / 恢复其他历史会话、会话重载（cron 回滚与通知打开通道）MUST NOT 复位
   composer：文字、引用 / 消息摘录 / 图片卡片、Skill 引用、光标与 CodeMirror 撤销历史原样
   保留；下一次发送进入**当前选中**的会话。这些切换 MUST NOT 清除当前 vault 的盘上草稿；
   草稿只在发送成功（`clearSent`）或用户手动删除时清除。
2. **切 vault 的 per-vault 草稿恢复逐字不变**
   切 vault 仍是「换输入区」：丢弃旧 vault 的待写、按新 vault 的稳定 id 读回它自己的草稿；
   MUST NOT 把 A 的内容带进 B，也 MUST NOT 把 B 的草稿写进 A。
3. **会话切换作废在途的草稿恢复**
   切 vault 后的草稿读回是异步的；会话切换必须让它不再拥有输入区——迟到的读回 MUST NOT
   `resetComposer` 重建编辑史、MUST NOT 覆盖切换后保留的内容（新增一条 scenario，与切 vault
   的草稿恢复区分）。
4. **失败面与发送意图不变**
   `harness_new_session` 被拒绝时只追加错误行、不动输入区与草稿；`pendingSend` / IME 的
   「新会话取消」仍只取消**发送意图**与旧视图的插卡队列，MUST NOT 清内容。
5. **判据**
   - 浏览器层（`tests/visual/scenes/`，真面板 + 真 CodeMirror + 桩后端）：纯文本 + caret、
     引用卡 / 图片卡 / Skill、撤销历史跨新建与会话重载保留；`harness_draft_put("")` 不再发生；
     失败回包不清；在途草稿读回不覆盖 / 不重建切换后的输入区与 history；切 vault 仍按 vault
     恢复草稿；**发送时的后端会话身份与切换世代等于刚选中的会话**（新建与选择后各发一次，
     载荷含保留的文字 / 引用卡 / Skill）。
   - 先红后绿：新增 / 改准的场景先在未修复代码上判红并留证，再进实现。
   - 真机层：新增验收场景 878（新建与选择会话保留输入区），本轮只落场景文件、不执行。

## Non-goals

- **不改切 vault 的输入区语义**：per-vault 草稿的装载、归属绑定、在途读写世代全部不动。
- **不改发送成功 / 失败语义**：`performSend` 的成功清空、`clearSent` 的归属判据、同步拒绝的
  回滚合并（`mergeRejectedComposerContent`）都不动。
- **不改 pendingSend / IME 的取消口径**：新会话 / 切视图仍取消延迟发送与旧视图插卡队列；
  本 change 只保证它不清内容。
- **不做撤销历史跨进程恢复**：重启后的草稿恢复仍是新的编辑史（既有条目不 supersede）。
- **不改草稿的格式、落点与防抖**：`harness_draft_put("")` 仍只由发送成功 / 手动删除触发。
- **不改 cron 点击发起运行（`beginCronRun`）的切屏语义**：它是「面板切到这次运行」，不在
  本次「新建 / 选择 / 恢复会话」的批准范围内。

## 影响面与风险

- **会话名与活动记录**：`resetView` 仍清 transcript、会话名、未读与档位读数；它们随会话切换，
  与输入区保留互不冲突。
- **在途草稿读回**：新增的作废点只作用于「会话切换之后」，切 vault 自己的恢复仍走同一次
  `restoreDraft()`，不会因为作废而失效（判据见 design §3）。
- **旧会话草稿的归属**：不再在新会话成功时删草稿，意味着用户点「＋新会话」后直接退出应用，
  下次启动会恢复这段未发送内容——这是批准合同「只有发送成功或用户手动删除才清除」的直接
  结果，不是泄漏。
- **测试期望的回扫**：`tests/visual/scenes/m831-harness-composer-codemirror.spec.ts` 有两条断言
  旧行为的用例（新会话清空 + 新会话删草稿），必须同批改准；其余点 `.lumir-hp-seg-new` 的
  场景只把「新会话」当视图换代信号，输入区在那一刻为空，判据不受影响（tasks 5.3 逐条回扫）。

## 证据计划

- 先红：新增场景在未修复实现上跑，把失败断言与调用记录落
  `.local/missions/preserve-composer-across-sessions-nov26/`（git 外）。
- 后绿：同一场景在修复后 PASS；`m831` 改准后的用例 PASS；相关既有场景回归 PASS。
- 制品门禁：`bash scripts/docs-check.sh`、`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`。
- 真机：场景 878 实现批不执行（任务说明明确不跑真机）；发布批补跑——r3 **PASS**（19 断言，
  `.local/acceptance/2026-11-26-release-0.19.0-r3/`），见 tasks 5.1 与下方「归档记录」。

## 归档记录

### 归档前（节点 2 五要件）

1. **方案已批准**：节点 1 为 Alex 2026-11-26 对「新建、切换会话时保留 composer」回复「采纳」，
   合同逐字见本文头部；实现只落地该合同（`src/harness-panel.ts` 的
   `holdComposerAcrossSessionSwitch()` 与两处入口替换），返修 r1 只改 delta 语义与测试判据，
   未扩大范围。
2. **独立评审**：K3 独立复审 **clean / merge**（P1 / P2 / P3 均为 0），绑定 tip
   `08148f2be004c2d86034f0c4a631ee76ae0e84db`，verdict
   `.local/reviews/preserve-composer-across-sessions-nov26/k3-verdict.md`。该 tip 之后的增量为
   合并提交 `27458d6f` 与两次场景对齐 `58ab5fd1` / `f5e9205e`（只改
   `scripts/acceptance/scenarios/*.md`），`src/**` 零改动。
3. **tasks 完成**：`tasks.md` 全勾（5.1 / 5.2 记录真机与归档结果），无放弃项。
4. **门禁与真机证据**：
   - quick：`GATE RESULT: 13/13 PASS（SKIP 0）`，日志
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/harness-ux-integration-nov26/gate-quick-release-0.19.0-r2.log`；
   - 集成测试：Rust 1382 passed / 0 failed / 6 ignored；前端单测 2075 passed；相关视觉结构 135
     passed / 1 skipped；
   - 首轮完整 visual：`GATE RESULT: 14/15 PASS（SKIP 0）`，唯一 FAIL 是当时未修的 `tsc-unit`
     （既有问题，`92008fdb` 修掉），`visual-regression` PASS（1287s），日志
     `.local/missions/harness-ux-integration-nov26/gate-visual-release-0.19.0.log`；
   - 最终完整 visual：14 个 quick 项全 PASS，`visual-regression` 1839 passed / 1 failed（唯一失败
     是既有 IME 低频定时用例，`tests/visual/scenes/editing-oracle.spec.ts:1143`，与本批改动面无
     交集），该用例双引擎复跑 2/2 PASS，日志
     `.local/missions/harness-ux-integration-nov26/gate-visual-release-0.19.0-final.log` 与
     `ime-low-frequency-release-recheck.log`；**不声称完整 gate 15/15**；
   - 真机：场景 878 r3 **PASS**（19 断言、26.9s），证据
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-26-release-0.19.0-r3/`；
     首轮与 r2 的失败均为场景期望对齐真实行为（`58ab5fd1` / `f5e9205e`），产品代码未改。
5. **规格对账**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（扫过 15 份 delta / 18 条
   MODIFIED / 285 段 / 无静默丢段；归档队列 1 项已完成 change 有唯一条目）；`validate --all
   --strict` 41 passed / 0 failed；`docs/backlog.md` 归档队列有且仅有一条本 change 条目。

### 归档后

- **归档提交**：`6203c5db`（归档目录 + 并入后的 living spec 一起提交；`openspec/specs/harness/spec.md`
  46 行增 / 少量改写，归档制品按 rename 记录）。
- **包装器实际输出**：`Change 'preserve-composer-across-sessions-nov26' archived as
  '2026-11-26-preserve-composer-across-sessions-nov26'.`；`harness: update`（`~ 1 modified`），
  `Totals: + 0, ~ 1, - 0, → 0`。
- **修链读数**：`归档后修链 0 处（扫过 4 篇 Markdown / 1 条相对链接）`；
  `openspec-links: PASS（校验 709 条相对链接，全部可达）`。
- **归档后审计**：`node scripts/openspec-archive-check.mjs --archived
  preserve-composer-across-sessions-nov26` → `PASS（1 条 MODIFIED，对比 23 段；人工恢复 0 段，
  声明认领 0 段）`（2026-11-26）。
- **docs-check**：归档后复跑 PASS（归档队列随 change 离开活跃区自然核销；backlog 78/80 行）。
