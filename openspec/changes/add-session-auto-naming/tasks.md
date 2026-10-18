# Tasks: add-session-auto-naming

> 提案阶段（本 mission）只到制品为止：以下任务在 Alex 节点 1（提案评审）通过后由实现批执行，逐项勾选。任务的可核对判据写在条内（测试名 / 命令 / 文件），不写「已验」这类无法对账的表述。

## 1. 配置面

- [ ] 1.1 `src-tauri/src/config.rs`：`[harness].auto_title`（bool，默认 `true`）与 `[harness].providers.<id>.title_model`（string，可选；须在该 provider 的 `models` 清单内声明，未声明 → 人话 warning + 回落生效模型；mock 无此键）。判据：`cargo test config::tests::auto_title_defaults_and_type_fallback`、`config::tests::title_model_falls_back_when_undeclared`、`config::tests::title_model_is_absent_for_mock` 全绿。
- [ ] 1.2 `HarnessConfig` 暴露唯一的模型解析口（`title_model_for(provider) -> &str`：配置值命中 `models` 清单则用之、否则回落 `provider.model`），命名调用只走这一处。判据：单测覆盖「已声明 / 未声明 / 空串」三态。
- [ ] 1.3 ts-rs 重导出 `src/bindings/HarnessConfig.ts` / `HarnessProviderConfig.ts`，`git add` 重导出产物（gate 的 bindings-drift 判据）。判据：`scripts/gate.sh quick` 的 `bindings-drift` 项 PASS。

## 2. 标题服务（新增 `src-tauri/src/harness/title.rs`）

- [ ] 2.1 素材装配纯函数：当前标题 + 首轮问答 + 最近两轮问答；用户消息先经既有 `strip_context_section`；剔除 `function_call` / `function_call_output` / `image` / reasoning；首轮 500 码点、最近两轮 400 码点、总 3000 码点上限。判据：`harness::title::tests::material_strips_context_and_tools`、`material_dedupes_first_and_recent`、`material_limits_are_codepoints` 全绿。
- [ ] 2.2 生成器 prompt 常量（`harness/prompts/title.md`，`include_str!` 单点引用）+ 解析与规范化纯函数：容忍代码块 / 前后废话；非法 JSON、未知 decision、空标题、>20 码点、与当前标题相同 → `error/invalid`；剥包裹引号 / 反引号与句末标点。判据：`harness::title::tests::parse_*`（正常 / 包裹 / 非法 / 超长 / 相同 / 标点剥离 / 无当前标题的 keep 视为 invalid）全绿。
- [ ] 2.3 漂移信号纯函数：CJK bigram + ASCII 词元 + 停用词；标题词元 ≥3、消息 ≥8 码点；`containment < 0.20` 连续两次命中；一次未命中清零、短消息不计数也不清零。判据：`harness::title::tests::drift_*`（中英文 / 短消息 / 清零 / 阈值常量）全绿。
- [ ] 2.4 调度状态机：首轮触发、5 轮周期、漂移提前（≥3 轮下限）、初始失败后每 3 轮重试、失败算一次评估、单飞行跳过、关闭开关、轮换重置。判据：`harness::title::tests::schedule_*`（含 `initial_retry_after_failure`）全绿。
- [ ] 2.5 辅助调用：不带工具；模型声明 effort 时 `effort = Low`、未声明不发；独立 20 秒超时；不写 `llm_request` / `llm_response`；usage 不进 `UsageSnapshot` / `cache_totals`。判据：`harness::title::tests::call_shape_is_tool_free_and_low_effort`、`call_usage_does_not_reach_session_readings` 全绿。
- [ ] 2.6 轮完成点接线：`turn.rs` 在正常 `done` 后做纯内存触发判定并起后台线程；结果落盘前复核「同 vault / 同 session id / 会话空闲 / auto_title 仍开」，任一不满足即丢弃并打 stderr。判据：`harness::title::tests::stale_result_is_dropped_after_rotate`、`result_is_dropped_while_busy` 全绿；单测断言会话 JSONL 不因丢弃多出记录。

## 3. 留存

- [ ] 3.1 `session_title` 记录写入（`initial` / `rename` / `keep` / `inherit` / `error`），字段 `title` / `decision` / `reason` / `model` / `ts`（`error` 带 `code`、不带 `title`）；只在会话空闲时追加。判据：`harness::jsonl::tests::session_title_records_roundtrip` 与 `harness::session::tests::title_record_is_written_only_when_idle` 全绿。
- [ ] 3.2 `effective_title(records)` 单一读取实现；列举 / 恢复 / `harness_state` 快照 / `title` 事件四条出口共用。判据：`rg "session_title" src-tauri/src` 的读取点只有 `effective_title` 一处（代码审查项）+ `harness::jsonl::tests::effective_title_last_wins` 全绿。
- [ ] 3.3 轮换继承：自动压缩与 `resume_session` 开新文件时，源会话有有效标题则追加 `decision=inherit`；「新会话」不继承。判据：`harness::session::tests::compact_inherits_title`、`resume_inherits_title`、`new_session_does_not_inherit_title` 全绿。
- [ ] 3.4 恢复充分性回归：`session_title` 记录在场时，仅凭 JSONL 重建的请求与 `llm_request` 逐字节相等；无标题记录的旧文件重建结果不变。判据：`harness::jsonl::tests::restore_sufficiency_ignores_title_sidecars` 全绿。
- [ ] 3.5 列举：`SessionSummary` 增可选 `title`，`list_sessions` 用 `effective_title`；无记录时为缺键（前端回落）。判据：`harness::tests::list_sessions_carries_title` 与 `list_sessions_omits_title_for_legacy_file` 全绿。

## 4. 前端

- [ ] 4.1 显示优先级：会话名 = `title` → `firstUserText` → 「新会话」；历史浮层行名同口径；标题硬上限 20 码点 = 截断长度，标题显示不带省略号。判据：`tests/unit/harness-session-picker.test.ts` 的 `title wins over first user text` / `fallback order` 用例全绿；`src/harness-panel.ts` 的 `applySessionName` 只读一个有效标题值。
- [ ] 4.2 `title` 事件与 `harness_state.title` 消费：原地更新标题栏会话名与已打开浮层行名；不重渲染 transcript、不改滚动 / 焦点 / 清单顺序。判据：`tests/unit/harness-session-picker.test.ts` 的 `title event updates rows in place` 用例 + 真机场景（5.3）的 AX 断言。
- [ ] 4.3 压缩 / 恢复后应用 inherit 标题，并保留既有「新会话 → 显示『新会话』」行为。判据：`tests/unit/harness-restore.test.ts` 增补用例全绿。

## 5. mock provider 与真机验收套件

- [ ] 5.1 mock fixture 顶层可选 `titles` 数组（独立队列；缺失 / 空 / 弹尽 → 空正文 → `error/invalid`），**会话 `responses` 队列不动**。判据：`harness::llm::tests::title_script_is_separate_from_responses` 全绿，且既有 fixture 驱动场景（70–77、87–98）零改动回归。
- [ ] 5.2 `scripts/acceptance/lib/app.mjs`：`SCENARIO_CONFIG_KEYS` 增 `autoTitle` / `titleModel` 并映射到配置文件 snake_case；`--check` 能挡住拼错与类型错。判据：`node scripts/acceptance/run.mjs --check` 通过。
- [ ] 5.3 新增真机验收场景（编号取落地时最大号 +1，文件名 `16x-harness-auto-title-*.md`）：①首轮命名（标题栏 + 浮层行名 + JSONL `decision=initial`）；②keep 防抖（5 轮后标题不变 + `decision=keep` 记录）；③旧文件安静回落（预置无标题记录的 JSONL，行名回落且无告警）；④关闭开关（`autoTitle: false` 时不写记录）。判据：`node scripts/acceptance/run.mjs <新编号…>` 全 PASS，证据落 `.local/acceptance/`（git 外）。
- [ ] 5.4 全量回扫既有验收场景里「会话名 = 首条用户消息截断」的期望（`rg "会话名|新会话" scripts/acceptance/scenarios/`），逐条确认：fixture 未声明 `titles` 时行为逐字节不变；有期望变化的逐条改准（口径：openspec-workflow 的「改闸 / 改语义须回扫既有场景」）。判据：回扫清单写进实现批的完成报告，未改的场景给出「行为不变」的理由。

## 6. 文档

- [ ] 6.1 核对 `docs/specs/config-reference.md` §1.5 的收录口径：`auto_title` / `title_model` 不改变会话 wire 行为，按该节「只收改变客户端 wire 行为的键」不收录，留一句确认（不复制第二份真源）。判据：`scripts/docs-check.sh` 通过。
- [ ] 6.2 `AGENTS.md` / `README.md` 无需改动（无新流程、无新目录约定）；判据：实现批完成报告写明「已核对，无需改动」。

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `cargo test` 全绿（含 §2 / §3 新增单测）
- [ ] 7.3 `pnpm test` 全绿（含 §4 前端用例）
- [ ] 7.4 `scripts/gate.sh quick` PASS（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 7.5 `scripts/gate.sh visual` 本地 PASS；标题栏文本形态若改变像素基线，按 [tests/visual/README.md](../../../tests/visual/README.md) 的纪律先给 Alex 过目再 `--update`（基线更新是人肉裁决点）
- [ ] 7.6 §5.3 新增真机验收场景全 PASS（`node scripts/acceptance/run.mjs`），证据目录可 `ls`
- [ ] 7.7 归档前与 change `add-harness-chat-completions-dialect` 对账：living spec 的「配置节 [harness]」「会话本地留存」须同时保留 wire 方言条款与本 change 的标题条款，MUST NOT 任一方在归档时被静默回退（design D17）。判据：归档 PR 的 diff 中两条 requirement 同时含 `wire_api` 与 `session_title`。
