# Tasks: avoid-session-restore-duplicates-nov24

> 状态：节点 1 待 Alex。未批准不勾选、不进入实现。
> 实现顺序按「失败用例先行」：先写会红的测试，再改实现；协议 / 行为以 `design.md` 为准。

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

## 2. pending 状态、`switched` 与前端 no-op

- [ ] 2.1 后端引入 `Materialized` / `PendingRestore` 两态；身份判定先于 busy；查看路径改用
      不 `create_dir_all` 的目录解析。
- [ ] 2.2 `SessionResumeInfo` 增加 `switched: bool`，修正 `session_id` 文档；重导出
      `src/bindings/SessionResumeInfo.ts`，同步前端桩与测试桩。
- [ ] 2.3 前端恢复点击：`switched=false` 只关浮层，不 `resetView`、不清 activity、不换 token、
      不重复渲染或滚动；`switched=true` 在回执成功后退役旧 token、采纳新 token。
- [ ] 2.4 替换 pending 的保护：旧批次为空直接替换；旧批次含未发布 history 时先尝试一次发布，
      失败则拒绝切换并保留旧会话与缓冲。
- [ ] 2.5 cron 打开会话入口回归：当前文件直切仍只打开 / 刷新面板，不 fork。

## 3. 初始批次与原子发布

- [ ] 3.1 初始批次固定顺序：`session_open` → `inherit?` → `notice_delivered*` → 首条
      `llm_request`；每条恰好一次。
- [ ] 3.2 原子发布：同目录 `.<session_id>.jsonl.tmp` 完整写入并关闭 → 不覆盖地发布最终
      `.jsonl`；成功后切普通 append-only；临时名清理失败不回滚、不二次发布。
- [ ] 3.3 发布失败：最终 `.jsonl` 不存在、无空 / 半截文件；临时残留不被列举。
- [ ] 3.4 目标撞名：不覆盖、不静默换 id，按发布失败处理。
- [ ] 3.5 失败重试：同一 id / 同一 token / 同一批次；成功后缓冲记录各一份，不双写。
- [ ] 3.6 退出未发布：不留下复活文件；重启后零新增。
- [ ] 3.7 健康语义：发布失败 `state=degraded` / `severity=history` / `history_written=false` /
      `history_gap=false`；发布成功恢复 `ok`、`history_written=true`、缺口仍 false；事件载荷同键同值。
- [ ] 3.8 发布成功后的普通写失败（含部分写 / 首行重试）仍按既有口径置缺口——不得被 3.7 削弱。

## 4. provider 边界与重试

- [ ] 4.1 前置拒绝（缺 provider / Key / Base URL / 模型、图片能力闸、线程未启动）：不激活、
      零新文件、零临时文件；有可见错误作为正观测。
- [ ] 4.2 provider 请求后失败：文件已发布；失败与显式重试追加同一文件，不新增行。
- [ ] 4.3 发布失败期间的重试与显式重试共用同一身份，不产生第二份文件或第二份请求记录。

## 5. 回扫既有验收场景与桩

- [ ] 5.1 回改场景 724：恢复后行数不变；需要新行断言的段落改为「在恢复上下文里先真实发送一轮」，
      行数增长、落位、相邻与删除判据沿用原口径；分支行改为发送后才出现。
- [ ] 5.2 回改场景 206：恢复后断言「无新文件、无通知侧录」；首次发送后再断言新文件的
      `notice_delivered` 与通知「恰好上屏一次、不补唤醒」。
- [ ] 5.3 全仓回扫 `harness_resume_session` / `SessionResumeInfo` / `resume` 相关的测试桩、
      TS 单测与视觉桩，逐条改准；不只新增场景。
- [ ] 5.4 复核场景 106 / 108 / 124 / 131 等涉及恢复行数、删除、跨 vault、读数的断言是否依赖旧时序。

## 6. 新增真机场景与回归

- [ ] 6.1 新增场景：查看零写盘（有标题 / 有通知 / 空源 / 重复点击 / A→B→A）。
- [ ] 6.2 新增场景：当前项直切（空闲 / busy）、busy 下切换被拒。
- [ ] 6.3 新增场景：首次发送唯一文件、分支文件、双击只受理一轮、查看后退出不复活。
- [ ] 6.4 新增场景：provider 前置拒绝 / 后端失败重试；`envChmod` 制造真实权限失败，验证
      发布失败、告警、重试同身份不双写。
- [ ] 6.5 回跑恢复、删除、通知、跨 vault、持久化健康、重试相关既有场景全绿。

## 7. 门禁与交付

- [ ] 7.1 `pnpm test`、相关 Rust 测试（`cargo test`）通过。
- [ ] 7.2 `scripts/gate.sh quick` 与本地 `scripts/gate.sh visual` 通过；照抄 `GATE RESULT` 原文行。
- [ ] 7.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过。
- [ ] 7.4 真机目标场景 PASS，证据落 `.local/acceptance/`（不落 worktree）。
- [ ] 7.5 实现 PR 合并后按流程落归档跟踪条目并归档（归档不由本提案阶段执行）。
