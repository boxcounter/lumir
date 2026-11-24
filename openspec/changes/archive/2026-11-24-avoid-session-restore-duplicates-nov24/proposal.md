# Proposal: 查看历史零写盘，首次续聊才原子创建恢复会话

- Change ID: `avoid-session-restore-duplicates-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（缺陷报告、节点 1 裁决），AI agent（诊断与起草）

> **节点状态**：已归档；节点 1 已闭合，节点 2 五要件与 `--archived` 审计均通过。
> 2026-11-24 Alex 已对 D1 裁决「采用这个。」——采用 A（首次发布失败仍允许本轮对话继续、
> 初始记录内存缓冲、同一 session id / token 重试）。D1 之外的方向按本需求的直接约束处理。
> 独立评审 r1（agent-361，绑定 tip `604660d7`）与 r2（绑定 `6fe5007c`）判 needs-changes；
> 制品修订后，r4 已 clean / ready-for-Alex。
> 本提案只改制品：不改 living spec、不改产品代码、不改测试代码、不改 `docs/backlog.md`。

## Why

### 现场：连续点击历史项产生同名重复项

用户在会话浮层里连续点击同一历史会话（或先点 A、再点 B、再点回 A），期望只是「看内容」，
实际每次都新增一行同名会话。回看清单时无法区分「同一份历史被看了三次」与「真的开了三个分支」，
行数与磁盘文件数都被查看动作污染。

### 精确根因：查看被实现成了「立即新建会话文件」

- **每次点击都铸新身份并立刻建 writer**：`src-tauri/src/harness.rs` 的 `Runtime::resume_session`
  无条件铸造新 session id、构造 `JsonlWriter::create`，用它替换当前内存会话（约 `harness.rs:803`、
  `:890`）。恢复入口没有「所点文件就是当前文件」或「同一份未发布的 pending 恢复」的分支。
- **查看阶段就有立即写盘**：源有有效标题时立刻写 `inherit` 侧录；有未消费通知时立刻写
  `notice_delivered`（约 `harness.rs:890`、`:903`）。两者都会触发物理 JSONL 创建——所以
  「只延后 `session_open`」并不足够。
- **目录本身在查看路径上就被创建**：`jsonl::vault_sessions_dir` 内部 `create_dir_all`
  （`src-tauri/src/harness/jsonl.rs:127`），而恢复在读完源文件之前就调用它（`harness.rs:685`）。
  今天即使因跨 vault / 损坏源而恢复失败，也可能已经建了空目录。
- **writer 不是原子发布**：首条记录先 `create_new` 最终文件，再逐行写 `session_open` 与 payload
  （`jsonl.rs:654`、`:671`、`:717`）。权限或写失败会留下空文件或半截最终文件——而空文件在会话
  清单里是一条合法行。
- **前端没有幂等分支**：每次点击都调用恢复命令并整体重置视图（`src/harness-panel.ts:10656`、
  `:10733`），没有「同一 pending 复用」或「当前文件直切」的短路。

### 为什么上一个排序 change 不构成拒绝理由

前次 change `rank-harness-sessions-by-last-activity-nov23` 解决的是**排序与行身份**：一份文件一行、
不折叠、活动时间沿 `restored_from` 链继承。它没有、也不应推出「点击查看必须立刻新增文件」。
更早的 M392 建立的「恢复 = 开新文件」边界也在本 change 被**有意修正**：那条边界描述的是发送后的
文件身份，不是查看阶段的写盘副作用。本 change 把「恢复 = 开新文件」改成「查看 = 重建内存；
首次真实请求 = 原子发布一份文件」。每文件一行、排序、compact 不沿链、源行保留等既有条款全部保留。

### 为什么必须同时改发布方式

只把 `inherit` / `notice_delivered` 延后，仍然会走现有 writer：首条 `llm_request` 时先创建最终
文件再写行，失败即留下空 / 半截文件；而查看阶段一旦失败，用户看到的是「点了历史但什么都没发生」。
本 change 把恢复文件的**首次发布**做成临时文件 + 原子、不覆盖发布，发布成功是唯一提交点。

### 约束继承

- 全局合同「留存写失败不阻断对话」（`openspec/specs/harness/spec.md` 的「留存健康状态」条）
  继续有效；D1 已裁决采用 A，A 正是它的延伸（详见 design §6）。
- 变更默认直接切断：既有重复文件不迁移、不折叠、不回填；本 change 不引入双读 / 双写 / 过渡期。
- 受影响的历史验收场景必须**回改**，不能只加新场景：场景 724 目前把「点击恢复」预期为立刻
  四行变五行；场景 206 在首次发送前断言新文件含 `notice_delivered`。两者都会按新语义改准。

## What Changes

1. **查看零写盘**：点击历史项 SHALL 只读源文件并重建内存投影（input、panel、usage、title、
   通知），MUST NOT 创建目录 / 临时文件 / JSONL / sidecar，MUST NOT 改动源文件字节与 mtime。
2. **当前项直切**：所点文件就是当前活跃会话的已发布文件时，直接返回（`switched=false`），
   不 fork、不新增文件、不重放 transcript；busy 下也成功。
3. **重复查看复用身份**：同一份未发布的 pending 恢复被重复点击时，复用查看阶段已分配的 session id 与
   持久化 token，不重复重建 transcript 或通知。
4. **A/B 查看零新增**：A→B→A 只替换内存投影；未发送即退出不产生任何新文件，重启不复活空恢复文件。
5. **首次真实发送才发布**：第一条真实 `llm_request` 触发恢复文件激活，恰好创建一份
   `opened_from=restore`、`restored_from=<源 id>` 的 JSONL。
6. **原子发布**：初始批次（`session_open` → `inherit?` → `notice_delivered*` → 首条
   `llm_request`）先写同目录临时文件，完整关闭后以不覆盖方式发布最终 JSONL；失败的语义按 D1：
   本次发布 MUST NOT 创建空 / 半截最终文件；失败前目标不存在则失败后仍不存在；因撞名失败时
   既有目标逐字节保留、不覆盖、不改 id。
7. **分支保留**：源行再次查看并在另一分支真实发送后，仍产生独立的第二份恢复文件；两份各自可删。
8. **存量不迁移**：既有重复文件不删除、不折叠、不回填、不迁移；现有单文件删除继续可用。
9. **身份不混用**：compact 仍由 `opened_from=compact` 标识；只有显式恢复产生 `restored_from`，
   两者 MUST NOT 混用。
10. **未发布批次不因替换而丢失**：任何替换 / 轮换当前会话的路径（查看另一历史、显式「新会话」、
    自动压缩）在 pending 已激活且仍有未发布 history 时，先尝试一次发布；仍失败则查看切换 /
    新会话拒绝该操作并保留当前会话、input、writer、缓冲与健康；compact 为内部「跳过压缩」
    （阈值路径完成本轮、overflow 路径落回既有终态），同样不丢缓冲、不产生持久化用户错误。
    纯查看（从未激活）没有批次，替换恒为零写盘。

对应的 spec 增量：`harness` 的「会话边界」「会话本地留存」「留存健康状态」三条 MODIFIED
（整条复制 living 正文再改，见 `specs/harness/spec.md`）。

## Non-goals

- 不整理、折叠、合并或迁移存量重复项；不新增「清理重复会话」入口。
- 不改每文件一行的列表身份，不改最后活动时间算法，不改排序。
- 不改自动压缩的**触发阈值、摘要调用与摘要内容算法**（本 change 只改未发布批次下的轮换 /
  跳过语义）；不改标题生成、删除、搜索或完整会话管理 UI。
- 不引入双读、双写、旧路径兼容层或迁移脚本。
- 不承诺文件系统与 provider 调用是一个分布式事务；不承诺 `fsync`、断电持久性。
- 不修复既有损坏 JSONL，不对发布成功之后的 append-only 写入引入原子性。
- 本提案阶段不改 living spec、产品代码、测试与 backlog。

## Impact

- **spec**：`harness` 的「会话边界」「会话本地留存」「留存健康状态」（三条 MODIFIED）。
- **Rust**：`src-tauri/src/harness.rs`（`resume_session` / `acquire_turn` / 会话替换）、
  `harness/session.rs`（pending restore 状态与初始批次）、`harness/jsonl.rs`（原子发布）。
  发送记录路径不改第二事实源：仍由 `turn::record_llm_request` 同点落盘。
- **IPC**：`SessionResumeInfo` 增加 `switched: bool`；`session_id` 文档改为「当前或未发布身份，
  不保证文件已存在」。`session_token` 语义不变（查看阶段即分配，首次发布不重铸）。
- **前端**：`src/harness-panel.ts` 的恢复点击、persistence token 采纳与 `switched=false` 的
  no-op 分支；`src/main.ts` 的 cron 打开会话入口至少回归（同一后端语义）。
- **ts-rs**：`src/bindings/SessionResumeInfo.ts` 重导出。
- **测试**：Rust session / title / subagent / writer 测试；相关 TS / visual 桩；
  真机验收场景新增与 724 / 206 回改。
- **验收 DSL**：新增受限 `envChmod` 动作（当前套件没有该动作）：只接受隔离配置目录内路径、
  拒绝绝对路径与 `..`，场景成功 / 失败 / 中断收尾都恢复原 mode，并附 `node:test` 边界测试。
- **视觉**：无视觉变更、无原型，不涉及视觉保真合同。

## D1（已裁决）：恢复文件首次发布失败时仍允许本轮对话继续

**2026-11-24 Alex 裁决：「采用这个。」→ 采用 A。**

语义：

- 第一条真实 `llm_request` 触发激活；初始内容先写同目录临时文件，完整关闭后原子、不覆盖地发布
  最终 JSONL。
- 发布失败时，**本次发布 MUST NOT 创建空 / 半截的最终 `.jsonl`**：失败前目标不存在则失败后仍
  不存在；因撞名失败时既有目标 MUST 逐字节保留、不覆盖、不改 id。临时文件名不以 `.jsonl`
  结尾，不是会话清单消费者。
- 激活后，`session_open`、`inherit`、`notice_delivered` 与已产生的 history 记录保留在内存批次中，
  后续记录继续加入该批次。
- 对话继续；既有 persistence 告警说明「对话暂未保存」，并明示「现在退出，这段对话将无法恢复」。
- 后续写动作用**同一个 session id、同一个 token、同一份缓冲批次**重试发布；成功后每条记录
  恰好出现一次，当前写健康可恢复 `ok`，且 MUST NOT 制造虚假的 `history_gap`。
- 任何替换 / 轮换当前会话的操作（查看另一历史、显式「新会话」、自动压缩）在批次已激活且仍有
  未发布 history 时，先尝试一次发布；仍失败时查看切换 / 新会话拒绝并可见报错，compact 为内部
  「跳过压缩」（阈值路径完成本轮、overflow 路径落回既有终态），两者都保留会话与缓冲。
- 退出前始终未发布成功：新增对话随内存消失；源文件不动；重启 MUST NOT 自动复活空恢复文件。

**未采用备选 B（首次发布失败就拒绝首次发送）**：D1 已裁决 A，B 不再保留可执行合同。
B 不是局部替换——若未来重启 B，至少同时改写「会话本地留存」的失败 / 重试 / 未发布退出正文与
场景、`harness_send` 受理路径（撤回本次触发记录、保证 provider 未被调用）、前端错误与 composer
回滚、tasks 与验收矩阵；不能只改健康条。

## 验收口径

提案阶段不跑实现验收。实现期的真机矩阵见 `design.md` §9 与 `tasks.md` §6，至少覆盖：

- 连续点击同一历史项、A→B→A（含带标题与通知的纯查看）、空源、当前项直切（含 busy）；
- 首次真实发送文件数恰好 +1，`restored_from` 指向所选源，源字节与 mtime 不变；
- 双击 / 重复发送意图只受理一轮；从源行建立第二分支；
- 查看后退出未发布、重启不复活；
- provider 前置拒绝零文件；provider 请求后失败分两态（已发布则追加；未发布则请求 / 失败响应 /
  sidecar 进内存批次、最终文件仍不存在）；
- 首次发布失败叠加 provider 失败后的显式重试：每次真实尝试各一条请求 / 响应、同一文件、
  不新增用户消息；
- 真实 OS 权限失败（新增 `envChmod`）下：**发布仍失败则拒绝切换 / 新会话**为真机必验；
  compact 的阈值 / overflow 两态为 Rust 必验、真机尽力构造（构造不出时登记放弃理由）；
  权限恢复后切换时旧 pending 恰好发布一次；
- 损坏源 / 跨 vault / busy 查看零副作用；
- 旧场景 724（行数触发点）与 206（`notice_delivered` 首帧）回改后 PASS。

## 评审闭合（r1 / r2）

### r1（绑定 tip `604660d7`）

| 评审项 | 本版关闭方式 |
|---|---|
| P1-1 | pending 判据改为「是否已激活（首次真实 `llm_request`）」；纯查看不构造批次（design §3 / §5.1、tasks 2.4）；新增「带标题 + 通知的纯查看 A→B 零发布」Rust 反例（tasks 1.10）与 spec 场景 |
| P1-2 | 「未发布批次不得丢弃」提升为 resume / 显式新会话 / compact rotate 的统一守卫；被拒操作不清健康、不换 writer；tasks 1.11 / 2.6 / 2.8 与 spec 场景承接 |
| P1-3 | tasks 6.0 新增受限 `envChmod` 的实现、路径边界单测与 mode 复位；新增「拒绝切换」「权限恢复后发布再切换」真机场景（tasks 6.6）；id / token 稳定性归 Rust 测试，真机只声明可观测证据 |
| P2-1 | proposal / design / spec / tasks 统一为「本次不创建空 / 半截；目标不存在则仍不存在；撞名既有目标逐字节保留」 |
| P2-2 | 删除 B 的可执行合同；记录「非局部替换」的完整范围 |
| P2-3 | 口径改为「每次真实 provider 尝试各一条请求」，显式重试不新增用户消息 / 文件；新增全批次精确计数场景（spec「显式重试后的批次精确计数」、tasks 4.4） |
| P2-4 | 恢复算法引用改为 change `reshape-harness-session-recording` 的 design §6.2，不再指向本 design |

### r2（绑定 tip `6fe5007c`）

| 评审项 | 本版关闭方式 |
|---|---|
| r2 P2-1 | compact 守卫改为内部「跳过压缩」：阈值路径完成本轮、以既有健康告警为可见反馈；overflow 路径不重试、不加持久化错误、落回既有 overflow 终态；两个调用点在 design §3.1 / spec / tasks 1.11a / 1.11b / 2.8 分别写清。验收改为「切换 / 新会话真机必验；compact 两态 Rust 必验、真机尽力」；Non-goal 收窄为不改触发阈值 / 摘要调用 / 摘要算法 |
| r2 P2-2 | provider 后置失败拆两态：已发布则追加；未发布则请求 / 失败响应 / 失败 sidecar 进入内存批次、最终文件仍不存在；design §5.1、spec 两个场景、tasks 4.2 同步 |
| r2 P2-3 | 健康条撞名措辞改为「本次未创建空 / 半截；既有目标逐字节保留」；delta 全篇统一 pending 恢复 / `activated=false|true` 术语，删除 pending 与 activated 混用的自相矛盾短语，并修正 r1 闭合映射任务号 |

## 节点 2（归档记录）

**放行方式：机器 + 独立评审放行（`docs/process/openspec-workflow.md`「节点 2」五要件）。**

### 实现与验收事实

- 恢复查看只重建内存；首次真实 `llm_request` 才以同目录临时文件 + `hard_link` 原子发布一份 JSONL。
  同源 pending 复用 id/token，当前文件 busy 直切，发布失败保留内存批次并以同身份重试，未发布批次守卫
  分流 resume / new_session / compact。`SessionResumeInfo.switched` 与前端 no-op、受限 `envChmod` 均已落地。
- 场景 724 按真实发送后的 `max(本文件, restored_from 祖先链)` 活动时间改准：分支自己的当前活动不被
  源时间覆盖，保留每文件一行、恢复不置顶（无自有轮次时）、sidecar 不计、compact 不沿链、删除与
  打开期间不重排等原语义。场景 206 改为首次真实发送后才断言恢复文件的 `notice_delivered`，通知恰好
  上屏一次且不补唤醒。
- 恢复回包竞态已修：成功回包先判视图代际，stale 不关闭新浮层、不推进 persistence 序号；真实 deferred
  Promise 测试覆盖旧 `switched=false` 关闭新浮层、旧 switched 取消健康快照，以及当前代 no-op。
  修前两条红，修后相关 42/42 绿。
- 自动化门禁：`GATE RESULT: 15/15 PASS（SKIP 0）`（完整 visual，基线未更新）；quick 全绿；
  `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `bash scripts/docs-check.sh` 通过。
- 最终真机：106 + 724 + 728–733 共 **8/8 PASS、171 条断言**，证据目录
  `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-24-session-lazy-restore-final/`，
  日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/session-lazy-restore/acceptance-final.log`。
- compact 真机两态未构造「低上下文 + 目录只读」叠加环境，未声称已验；Rust 必验证据为
  `src-tauri/src/harness/lazy_restore_tests.rs` 的
  `threshold_compact_skip_keeps_uncompressed_session_and_complete_batch` 与
  `overflow_compact_skip_falls_back_to_original_error_without_retry`。

### 归档前五要件

1. **方案已批准**：节点 1 已闭合，D1 采用 A（首次发布失败仍允许本轮对话继续、内存缓冲、同 id/token
   重试），实现期未改排序、折叠存量或 compact 身份。
2. **独立 reviewer clean / merge**：agent-372 的 r2 绑定
   `fe475484132fbf8b739ec89717ef881b95ad89b1`，无 P1 / P2 findings；文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/session-lazy-restore-final-r2.md`。
3. **tasks 完成或有放弃理由**：除 6.8 真机 compact 未构造外全部勾选；未构造原因与 Rust 证据就地记录于
   `tasks.md`「执行备注」。
4. **要求的门禁与真机证据通过**：完整 visual 15/15、quick / docs / validate 全绿；最终 8 个真机场景全绿，
   证据落 `.local/`。
5. **规格对账无丢段**：`scripts/openspec-archive-check.mjs` 门禁模式随 docs-check PASS；
   `validate --all --strict` PASS；`docs/backlog.md` 的归档跟踪队列条目唯一。

### 归档后

- **归档提交**：`63645e496aeb3f3f9c9a8f560a89682f33218a49`（2026-11-24）。
  归档目录：`openspec/changes/archive/2026-11-24-avoid-session-restore-duplicates-nov24/`。
- **包装器输出**：`Change 'avoid-session-restore-duplicates-nov24' archived as
  '2026-11-24-avoid-session-restore-duplicates-nov24'`；`harness: update`（3 modified，+0 / ~3 / -0）。
- **修链**：`归档后修链 0 处（扫过 4 篇 Markdown / 0 条相对链接）`；
  `openspec-links: PASS（校验 696 条相对链接，全部可达）`；`openspec-archive: PASS`。
- **`--archived` 审计**：`PASS（openspec/changes/archive/2026-11-24-avoid-session-restore-duplicates-nov24：
  3 条 MODIFIED，对比 139 段；人工恢复 0 段，声明认领 0 段）`，时间 2026-11-24T23:43:29+0800
  （Asia/Shanghai）。

## 关联材料

- 诊断与方案报告：会话任务 `agent-9fi1wusq` 的 `output.log`（只读；结论已并入本提案）。
- 独立评审 r1：`.local/reviews/session-lazy-restore-proposal-r1.md`（verdict needs-changes，
  绑定 tip `604660d7`；闭合映射见上节）。
- 独立评审 r2：`.local/reviews/session-lazy-restore-proposal-r2.md`（verdict needs-changes，
  绑定 tip `6fe5007c`；闭合映射见上节）。
- 流程与制品约定：`docs/process/openspec-workflow.md`。
- 反复踩坑清单：`REVIEW.md`（尤其「设定类现状断言只读了 requirement 的一句话」「同一语义两处真源」）。
- 被回改的验收场景：`scripts/acceptance/scenarios/724-harness-session-order.md`、
  `scripts/acceptance/scenarios/206-subagent-notice-restore.md`。
