# Tasks: avoid-session-restore-duplicates-nov24

> 状态：节点 1 **待评审闭合**（D1 已由 Alex 2026-11-24 裁决「采用这个。」→ 采用 A）。
> 复审 clean 前不勾选、不进入实现。实现顺序按「失败用例先行」：先写会红的测试，再改实现；
> 协议 / 行为以 `design.md` 为准。

## 0. 开工前

- [ ] 0.1 核对本 change 的 scope 与 `design.md` 的不变量清单；若实现期发现影响面升级（改排序、
      折叠存量、改 compact 身份），停下更新 proposal 并重走节点 1，不静默扩 scope。
- [ ] 0.2 逐条过一遍 `REVIEW.md`，尤其「设定类现状断言只读了 requirement 的一句话」与
      「同一语义两处真源」；确认改动面没有第二份排序 / 身份口径。

## 1. Rust 失败用例（先红）

- [ ] 1.1 查看有标题的历史会话：会话目录零新增、无临时文件、源文件 sha256 与 mtime 不变。
- [ ] 1.2 查看有未消费通知的历史会话：同样零新增（证明只延后 `inherit` 不够）。
- [ ] 1.3 查看空源：零新增、空 transcript；首次发送后才出现一份恢复文件。
- [ ] 1.4 重复查看同一源：`switched=false`、id / token 稳定、transcript 与通知不重复。
- [ ] 1.5 当前已发布文件直切（空闲 / busy）：`switched=false`、零新增；busy 下不报错。
- [ ] 1.6 A→B→A 查看：零新增；每次重建内容属于所选源。
- [ ] 1.7 需切换时的 busy / 跨 vault / 非法 id / 损坏源：原会话与 pending 不变、零新增、错误码明确。
- [ ] 1.8 首次真实发送：文件数恰好 +1；`opened_from=restore`、`restored_from` 指向所选源；
      源文件不被改写。
- [ ] 1.9 双击 / 重复发送意图：只受理一轮；一份文件、一条用户消息、一条首个 `llm_request`。
- [ ] 1.10 纯查看 A→B（源 A 有有效标题、有未消费通知）：零新增、无临时文件、不尝试发布——
      证明「纯查看」判据是 `activated=false` 而不是批次为空（session_open 恒在）。
- [ ] 1.11a 统一守卫（resume / 显式新会话，含 cron 专用会话恢复回落新建的入口）：已激活未发布
      的 pending 在发布失败时被拒；会话、input、system、writer、批次、token、健康不变。
- [ ] 1.11b compact 两个调用点：阈值触发失败 ⇒ 跳过轮换、完成本轮未压缩回答、不产生新的持久化
      错误；context overflow ⇒ 不重试、不加持久化错误、落回既有 overflow 终态；两态都不创建
      compact 文件、不替换 input / system / writer、不采用摘要，压缩请求 / 响应留在原批次。
- [ ] 1.12 撞名：既有目标逐字节不变；本次不创建空 / 半截最终文件；按发布失败告警。
- [ ] 1.13 首次发布失败 + provider 请求后失败 + 显式重试：两次真实尝试各一条 `llm_request` /
      一条 `llm_response`，失败 sidecar 一条，用户消息一条，各恰好一次、同一文件。

## 2. pending 状态、`switched` 与前端 no-op

- [ ] 2.1 后端引入 `Materialized` / `PendingRestore` 两态；身份判定先于 busy；查看路径改用
      不 `create_dir_all` 的目录解析。
- [ ] 2.2 `SessionResumeInfo` 增加 `switched: bool`，修正 `session_id` 文档；重导出
      `src/bindings/SessionResumeInfo.ts`，同步前端桩与测试桩。
- [ ] 2.3 前端恢复点击：`switched=false` 只关浮层，不 `resetView`、不清 activity、不换 token、
      不重复渲染或滚动；`switched=true` 在回执成功后退役旧 token、采纳新 token。
- [ ] 2.4 替换 pending 的保护：旧 pending 若 `activated=false`（纯查看）直接替换、零写盘；
      若已激活且未发布，先尝试一次发布，失败则拒绝切换并保留会话与缓冲。判据 MUST NOT 用
      「批次为空」。
- [ ] 2.5 cron 打开会话入口回归：当前文件直切仍只打开 / 刷新面板，不 fork。
- [ ] 2.6 统一未发布批次守卫：在 `resume_session`、`new_session` / `reset_session`、
      `begin_compacted_session` / `Session::rotate` 三处共用同一判定与同一错误码
      `harness_persistence_unpublished`；被拒操作不清健康、不写 `pending_open=reset`。
- [ ] 2.7 前端错误路径：新会话被拒显示可见错误、不清视图 / composer / 健康；compact 被拒
      不产生用户侧错误，对话继续。
- [ ] 2.8 compact 跳过的收尾：阈值路径保留未压缩 input / system / writer、完成本轮、健康告警
      可见；overflow 路径不重试、不发新持久化错误、落回既有 overflow 终态；两态都不创建
      compact writer / 文件、不采用摘要。

## 3. 初始批次与原子发布

- [ ] 3.1 初始批次固定顺序：`session_open` → `inherit?` → `notice_delivered*` → 首条
      `llm_request`；每条恰好一次。
- [ ] 3.2 原子发布：同目录 `.<session_id>.jsonl.tmp` 完整写入并关闭 → 不覆盖地发布最终
      `.jsonl`；成功后切普通 append-only；临时名清理失败不回滚、不二次发布。
- [ ] 3.3 发布失败：本次未创建最终文件；目标此前不存在则失败后仍不存在；无空 / 半截文件；
      临时残留不被列举。
- [ ] 3.4 目标撞名：不覆盖、不改 id；既有目标逐字节保留；按发布失败处理。
- [ ] 3.5 失败重试：同一 id / 同一 token / 同一批次；成功后缓冲记录各一份，不双写；
      按精确 kind 序列与计数核对（含首条 `llm_response` 与失败 sidecar）。
- [ ] 3.6 退出未发布：不留下复活文件；重启后零新增。
- [ ] 3.7 健康语义：发布失败 `state=degraded` / `severity=history` / `history_written=false` /
      `history_gap=false`；发布成功恢复 `ok`、`history_written=true`、缺口仍 false；事件载荷同键同值。
- [ ] 3.8 发布成功后的普通写失败（含部分写 / 首行重试）仍按既有口径置缺口——不得被 3.7 削弱。

## 4. provider 边界与重试

- [ ] 4.1 前置拒绝（缺 provider / Key / Base URL / 模型、图片能力闸、线程未启动）：不激活、
      零新文件、零临时文件；有可见错误作为正观测。
- [ ] 4.2 provider 请求后失败分两态：首次发布已成功 ⇒ 失败请求 / 响应与失败 sidecar 追加同一
      文件；首次发布失败 ⇒ 三者进入同一内存批次、最终文件仍不存在，后续写动作 / 显式重试按 D1
      发布。显式重试新增与实际第二次尝试对应的 `llm_request` / `llm_response`，不新增用户消息或文件。
- [ ] 4.3 发布失败期间的自动重试与显式重试共用同一身份；每次真实尝试各一条请求 / 响应；
      不新增用户消息、不产生第二份文件。
- [ ] 4.4 组合反例：首次发布失败 + provider 请求后失败 + 显式重试时发布成功；按精确 kind
      序列核对完整批次（两条 `llm_request`、两条对应 `llm_response`、首条失败 sidecar，
      各一次、同一 session id、同一文件）。

## 5. 回扫既有验收场景与桩

- [ ] 5.1 回改场景 724：恢复后行数不变；需要新行断言的段落改为「在恢复上下文里先真实发送一轮」，
      行数增长、落位、相邻与删除判据沿用原口径；分支行改为发送后才出现。
- [ ] 5.2 回改场景 206：恢复后断言「无新文件、无通知侧录」；首次发送后再断言新文件的
      `notice_delivered` 与通知「恰好上屏一次、不补唤醒」。
- [ ] 5.3 全仓回扫 `harness_resume_session` / `SessionResumeInfo` / `resume` 相关的测试桩、
      TS 单测与视觉桩，逐条改准；不只新增场景。
- [ ] 5.4 复核场景 106 / 108 / 124 / 131 等涉及恢复行数、删除、跨 vault、读数的断言是否依赖旧时序。
- [ ] 5.5 复核「新会话」与 compact 相关桩：新会话在未发布批次上会被拒；compact 被拒时
      不换 writer、不采用摘要。

## 6. 新增真机场景与回归

- [ ] 6.0 新增受限 `envChmod` 验收动作（当前不存在）：只接受 `<隔离配置>/lumir` 内相对路径，
      拒绝绝对路径与 `..`；成功 / 失败 / 中断收尾都恢复原 mode；附 `node:test` 边界测试
      （越界拒绝、正常 chmod、复位）。它是 6.4 / 6.6 / 6.8 的前置。
- [ ] 6.1 新增场景：查看零写盘（有标题 / 有通知 / 无标题无通知的纯查看 A→B / 空源 / 重复点击 /
      A→B→A）。
- [ ] 6.2 新增场景：当前项直切（空闲 / busy）、busy 下切换被拒。
- [ ] 6.3 新增场景：首次发送唯一文件、分支文件、双击只受理一轮、查看后退出不复活。
- [ ] 6.4 新增场景：provider 前置拒绝 / 后置失败 + 显式重试；`envChmod` 制造真实权限失败，
      验证发布失败、告警、同身份重试不双写，并按 4.4 的精确计数核对。
- [ ] 6.5 回跑恢复、删除、通知、跨 vault、持久化健康、重试相关既有场景全绿。
- [ ] 6.6 新增场景：发布仍失败时点另一历史 / 触发新会话被拒——有可见错误、旧 transcript 仍在、
      目录文件数不变；权限恢复后点 B ⇒ A 的完整批次恰好发布一次，再切到 B。
- [ ] 6.7 pending id / token 稳定性只在 Rust 测试断言；真机只声明可观测证据（文件数、transcript、
      通知、`switched=false` 的浮层行为与 `persistence` 事件），MUST NOT 声称真机验证了 token。
- [ ] 6.8 compact 两态 Rust 必验（1.11b）；真机尽力构造「自动压缩 + 发布失败」，构造不出来时
      登记放弃理由与 Rust 证据指针，不得声称真机已验。

## 7. 门禁与交付

- [ ] 7.1 `pnpm test`、相关 Rust 测试（`cargo test`）通过。
- [ ] 7.2 `scripts/gate.sh quick` 与本地 `scripts/gate.sh visual` 通过；照抄 `GATE RESULT` 原文行。
- [ ] 7.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过。
- [ ] 7.4 真机目标场景 PASS，证据落 `.local/acceptance/`（不落 worktree）。
- [ ] 7.5 实现 PR 合并后按流程落归档跟踪条目并归档（归档不由本提案阶段执行）。
