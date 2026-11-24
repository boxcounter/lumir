# Proposal: 查看历史零写盘，首次续聊才原子创建恢复会话

- Change ID: `avoid-session-restore-duplicates-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（缺陷报告、节点 1 裁决），AI agent（诊断与起草）

> **节点状态**：节点 1 **待 Alex**；未批准不进入实现。
> 本提案只改制品：不改 living spec、不改产品代码、不改测试代码、不改 `docs/backlog.md`。
>
> **唯一需要裁决的点是 D1**（恢复文件首次发布失败时是否仍允许本轮对话继续，推荐 A）。
> 其余方向——查看零写盘、当前项直切、重复 pending 复用身份、A/B 查看零新增、保留分支、
> 存量不迁移——都是本需求的直接约束，不拆成裁决点（见「需要 Alex 裁决的事项」）。

## Why

### 现场：连续点击历史项产生同名重复项

用户在会话浮层里连续点击同一历史会话（或先点 A、再点 B、再点回 A），期望只是「看内容」，
实际每次都新增一行同名会话。回看清单时无法区分「同一份历史被看了三次」与「真的开了三个分支」，
行数与磁盘文件数都被查看动作污染。

### 精确根因：查看被实现成了「立即新建会话文件」

- **每次点击都铸新身份并立刻建 writer**：`src-tauri/src/harness.rs` 的 `Runtime::resume_session`
  无条件铸造新 session id、构造 `JsonlWriter::create`，用它替换当前内存会话（约 `harness.rs:803`、
  `:890`）。恢复入口没有「所点文件就是当前文件」或「同一未激活恢复」的分支。
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
  继续有效；D1 的推荐 A 正是它的延伸（详见 design §6）。
- 变更默认直接切断：既有重复文件不迁移、不折叠、不回填；本 change 不引入双读 / 双写 / 过渡期。
- 受影响的历史验收场景必须**回改**，不能只加新场景：场景 724 目前把「点击恢复」预期为立刻
  四行变五行；场景 206 在首次发送前断言新文件含 `notice_delivered`。两者都会按新语义改准。

## What Changes

1. **查看零写盘**：点击历史项 SHALL 只读源文件并重建内存投影（input、panel、usage、title、
   通知），MUST NOT 创建目录 / 临时文件 / JSONL / sidecar，MUST NOT 改动源文件字节与 mtime。
2. **当前项直切**：所点文件就是当前活跃会话的已发布文件时，直接返回（`switched=false`），
   不 fork、不新增文件、不重放 transcript；busy 下也成功。
3. **重复查看复用身份**：同一份未激活恢复被重复点击时，复用查看阶段已分配的 session id 与
   持久化 token，不重复重建 transcript 或通知。
4. **A/B 查看零新增**：A→B→A 只替换内存投影；未发送即退出不产生任何新文件，重启不复活空恢复文件。
5. **首次真实发送才发布**：第一条真实 `llm_request` 触发恢复文件激活，恰好创建一份
   `opened_from=restore`、`restored_from=<源 id>` 的 JSONL。
6. **原子发布**：初始批次（`session_open` → `inherit?` → `notice_delivered*` → 首条
   `llm_request`）先写同目录临时文件，完整关闭后以不覆盖方式发布最终 JSONL；失败与重试按 D1。
7. **分支保留**：源行再次查看并在另一分支真实发送后，仍产生独立的第二份恢复文件；两份各自可删。
8. **存量不迁移**：既有重复文件不删除、不折叠、不回填、不迁移；现有单文件删除继续可用。
9. **身份不混用**：compact 仍由 `opened_from=compact` 标识；只有显式恢复产生 `restored_from`，
   两者 MUST NOT 混用。

对应的 spec 增量：`harness` 的「会话边界」「会话本地留存」「留存健康状态」三条 MODIFIED
（整条复制 living 正文再改，见 `specs/harness/spec.md`）。

## Non-goals

- 不整理、折叠、合并或迁移存量重复项；不新增「清理重复会话」入口。
- 不改每文件一行的列表身份，不改最后活动时间算法，不改排序。
- 不改自动压缩、标题生成、删除、搜索或完整会话管理 UI。
- 不引入双读、双写、旧路径兼容层或迁移脚本。
- 不承诺文件系统与 provider 调用是一个分布式事务；不承诺 `fsync`、断电持久性。
- 不修复既有损坏 JSONL，不对发布成功之后的 append-only 写入引入原子性。
- 本提案阶段不改 living spec、产品代码、测试与 backlog。

## Impact

- **spec**：`harness` 的「会话边界」「会话本地留存」「留存健康状态」（三条 MODIFIED）。
- **Rust**：`src-tauri/src/harness.rs`（`resume_session` / `acquire_turn` / 会话替换）、
  `harness/session.rs`（pending restore 状态与初始批次）、`harness/jsonl.rs`（原子发布）。
  发送记录路径不改第二事实源：仍由 `turn::record_llm_request` 同点落盘。
- **IPC**：`SessionResumeInfo` 增加 `switched: bool`；`session_id` 文档改为「当前或待激活身份，
  不保证文件已存在」。`session_token` 语义不变（查看阶段即分配，首次发布不重铸）。
- **前端**：`src/harness-panel.ts` 的恢复点击、persistence token 采纳与 `switched=false` 的
  no-op 分支；`src/main.ts` 的 cron 打开会话入口至少回归（同一后端语义）。
- **ts-rs**：`src/bindings/SessionResumeInfo.ts` 重导出。
- **测试**：Rust session / title / subagent / writer 测试；相关 TS / visual 桩；
  真机验收场景新增与 724 / 206 回改。
- **视觉**：无视觉变更、无原型，不涉及视觉保真合同。

## 需要 Alex 裁决的事项

### D1（唯一裁决点）：恢复文件首次发布失败时，是否仍允许本轮对话继续

**推荐 A：保留「写失败不阻断对话」，缓冲初始记录并复用同一身份重试。**

语义：

- 第一条真实 `llm_request` 触发激活；初始内容先写同目录临时文件，完整关闭后原子、不覆盖地发布
  最终 JSONL。
- 发布失败时，最终 `.jsonl` **不存在**；临时文件名不以 `.jsonl` 结尾，不是会话清单消费者。
- `session_open`、`inherit`、`notice_delivered` 与已产生的 history 记录保留在内存初始批次中，
  后续记录继续加入该批次。
- 对话继续；既有 persistence 告警说明「对话暂未保存」，并明示「现在退出，这段对话将无法恢复」。
- 后续写动作用**同一个 session id、同一个 token、同一份初始批次**重试发布；成功后每条记录
  恰好出现一次，当前写健康可恢复 `ok`，且 MUST NOT 制造虚假的 `history_gap`。
- 退出前始终未发布成功：新增对话随内存消失；源文件不动；重启 MUST NOT 自动复活空恢复文件。

**备选 B：首次发布失败就拒绝首次发送**，回滚 composer，修复后重试同一身份。

B 的行为更直观，但会把「激活成功」同步塞进 `harness_send` 的受理路径，并给「写失败不阻断对话」
增加一个例外，前后端改动面更大；A 与既有全局合同一致，且失败可见性由健康告警承担。

无论选 A 还是 B，查看零写盘、当前项直切、重复 pending 复用身份、A/B 零新增、分支与存量不迁移
都不变。若 Alex 选 B，只替换 design §6 与 spec 中「留存健康状态」的 pending 规则、以及
`harness_send` 的失败返回语义，其余条款照旧。

## 验收口径

提案阶段不跑实现验收。实现期的真机矩阵见 `design.md` §9 与 `tasks.md` §6，至少覆盖：

- 连续点击同一历史项、A→B→A、空源、当前项直切（含 busy）；
- 首次真实发送文件数恰好 +1，`restored_from` 指向所选源，源字节与 mtime 不变；
- 双击 / 重复发送意图只受理一轮；从源行建立第二分支；
- 查看后退出未发布、重启不复活；
- provider 前置拒绝零文件；provider 请求后失败仍是真实轮次，重试追加同一文件；
- 真实 OS 权限失败下的发布失败与重试（同一 id 只发布一份，不双写）；
- 损坏源 / 跨 vault / busy 查看零副作用；
- 旧场景 724（行数触发点）与 206（`notice_delivered` 首帧）回改后 PASS。

## 关联材料

- 诊断与方案报告：会话任务 `agent-9fi1wusq` 的 `output.log`（只读；结论已并入本提案）。
- 流程与制品约定：`docs/process/openspec-workflow.md`。
- 反复踩坑清单：`REVIEW.md`（尤其「设定类现状断言只读了 requirement 的一句话」「同一语义两处真源」）。
- 被回改的验收场景：`scripts/acceptance/scenarios/724-harness-session-order.md`、
  `scripts/acceptance/scenarios/206-subagent-notice-restore.md`。
