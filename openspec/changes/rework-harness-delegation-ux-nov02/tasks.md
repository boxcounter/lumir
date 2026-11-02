# Tasks: rework-harness-delegation-ux-nov02

## 1. 制品与合同

- [x] 1.1 起草 proposal / design / spec delta / tasks，记录 Alex 2026-11-02「好，请你动手」为节点 1 批准（proposal「节点 1 批准记录」），设计含信息层级、状态归属与视觉保真合同
- [x] 1.2 不新增批准范围外的行为；design §7 的 C1–C16 各自在实现或测试里有落点

## 2. 僵尸行、跨 vault 与 live 状态恢复

- [x] 2.1 写判别性单测：resume 段合并（`segments = 2`、rounds/steps 累计）在旧实现必红
- [x] 2.2 `clearTranscriptSurface()` 清 `taskList` 子节点；`renderTaskArea()` 按 `data-run` 对账，任何不在可见集合里的行节点一律移除
- [x] 2.3 后端 `harness_state` 新增 `live_subruns`（活动表 + 每回合 progress 更新；收尾即移除），ts-rs / 前端类型同步
- [x] 2.4 前端 `applyTaskReadings` 以 `live_subruns` 为在跑行权威来源：在表建行 / 更新，不在表移除；缺键不应用
- [ ] 2.5 新增真机场景 `240-harness-subagent-vault-switch.md`：起子运行 → 切 vault B → 切回 A → 断言行与 Stop 恢复 / 收尾不复活；先在旧实现证明会红

## 3. resume 身份与终态语义

- [x] 3.1 `reduceSubruns` 合并同 `run_id` 的 started：段基线 + `segments + 1`，rounds / steps / token 跨段累计
- [x] 3.2 `task` 行与通知共用同一终态词表；停止 / 失败 / 部分结果在行与详情里如实显示，通知不再复述为「成功」

## 4. 目标 UX 落点

- [x] 4.1 控制区出现条件收窄为「≥2 在跑 / 后台 / 待批 / 待确认失败」；单前台 run 只出现在 `task` 行
- [x] 4.2 `task` 行为运行态主载体：状态词 + description + agent + 用时 + 「停止」；运行期间不被工具块折叠
- [x] 4.3 终态行就地翻面（状态词、语义色、用时、触顶原因进折叠行），保留行身份
- [x] 4.4 后台 partial / failed / stopped 保留一行至「知道了」；确认状态随会话隔离
- [x] 4.5 空态零占位：删除完成数汇总与常驻用量块；`enabled = false` 维持不出现
- [x] 4.6 触顶提示与「继续」移入对话流（自动提示形态），控制区不再承载
- [x] 4.7 后台完成通知删除「详情见任务面板」，只保留 agent / description / 终态 / 摘要首行

## 5. 用量与 reads

- [x] 5.1 删除常驻 `Subtask usage (by model)` 块及其标题 / 样式 / 文案
- [x] 5.2 `task` 行详情补单次用量（live 与恢复同形，按 run 累计；恢复路径按 `run_id` 累加信封用量）
- [x] 5.3 会话聚合改为会话浮层「本会话子任务用量」按需段：单桶只显示总量，≥2 桶按模型分组；无读数整段不出现
- [x] 5.4 `rounds` 从行内读数与默认详情移除，只在 `stopped_by = rounds` 时作为原因出现

## 6. 视觉、滚动与文案

- [x] 6.1 控制区列表内部滚动（`max-height: min(40vh, 320px)` + `overflow-y: auto`），滚动条归隐藏档并登记注册表
- [x] 6.2 文案表增删改齐：删除 D516 / 完成数汇总 / 常驻用量标题；新增「知道了」「本会话子任务用量」「N 段」「轮次预算」等；注释同步（无未消费键）
- [x] 6.3 视觉场景 `m607-subagents-catalog-removed.spec.ts` 改为「只有 `subrun_usage` 时空态不占位」，新增控制区 / 对话行 / 详情用量的结构断言（不动像素基线）

## 7. 回扫与验证

- [x] 7.1 回扫既有真机场景期望：201（行读数 / 停止判据）、192（用量入口改会话浮层）、199（删除详情指引）、203 / 204（触顶提示落点）、194 / 198 / 206 保持
- [x] 7.2 `node --test tests/unit/harness-subagents.test.ts` 通过；tsc（`pnpm exec tsc --noEmit`）通过
- [ ] 7.3 `scripts/gate.sh quick` 全绿（含 docs-check / bindings-drift / 单测）
- [ ] 7.4 `scripts/gate.sh visual` 全绿（不更新像素基线）
- [ ] 7.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `node scripts/openspec-archive-check.mjs` 门禁模式 PASS
- [ ] 7.6 相关真机场景（201 / 240 / 192 / 203）在真机环境执行 PASS；证据落 `.local/acceptance/`（真机时段由 tower 统一协调）
- [ ] 7.7 信息卫生清扫（改动面无真实 vault 内容）；证据指针可 `ls`
