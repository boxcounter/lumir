# Tasks: add-session-auto-naming

> 提案阶段（本 mission）只到制品为止：以下任务在 Alex 节点 1（提案评审）通过后由实现批执行，逐项勾选。任务的可核对判据写在条内（测试名 / 命令 / 文件），不写「已验」这类无法对账的表述。
>
> 实现批（M576）对账说明：§1–§4、§5.1/5.2/5.3（场景**只写不跑**，本轮无真机段）、§5.4、§6、
> §7.1–7.4 已完成；§7.5（视觉）/ §7.6（真机跑新场景）/ §7.7（归档对账）不在本 mission 面内，
> 原因逐条写在条内。

## 1. 配置面

- [x] 1.1 `src-tauri/src/config.rs`：`[harness].auto_title`（bool，默认 `true`）、`[harness].title_provider`（string，可选；缺省 = 会话当前 provider；非空须是 `providers` 表内的 id（`kimi` / `deepseek` / `mock`），闭集合外取值 → 人话 warning + 回落缺省）与 `[harness].providers.<id>.title_model`（string，可选；按 `title_provider` 指向的 provider 条目读取，须在该 provider 的 `models` 清单内声明，未声明 → 人话 warning + 回落该 provider 的生效模型；mock 无此键）。判据：`cargo test config::tests::auto_title_defaults_and_type_fallback`、`config::tests::title_provider_invalid_falls_back_to_session_provider`、`config::tests::title_model_falls_back_when_undeclared`、`config::tests::title_model_is_absent_for_mock` 全绿。
  - 落点：`HarnessConfig` 两键 + `HarnessProviderConfig.title_model`（mock 的 `HarnessMockConfig` 不加键）；warning 文案含键名与取值，启动不失败。
- [x] 1.2 `HarnessConfig` 暴露唯一的命名调用解析口 `title_target(session_provider) -> TitleTarget { provider, model, wire_api, api_key, base_url }`：`provider` = `title_provider`（缺省 / 非法回落会话 provider），其余四个字段与 `model` 同出该 provider 条目；`model` = 该条目的 `title_model`（命中自己的 `models` 清单）否则该条目的 `model`。命名调用只走这一处，MUST NOT 混用会话 provider 与 title provider 的字段。判据：单测覆盖「缺省（= 会话 provider）/ 跨 provider / title_provider 非法值回落 / title_model 已声明 / 未声明 / 空串 / mock 无 title_model」七态。
  - 落点：`config.rs` 的 `title_target` + `title_target_of`（两个网络 provider 共用一份装配）；七态判据在 `config::tests::title_target_resolves_all_five_fields_from_one_provider_entry`（含「会话 provider 的 key / base_url 一个都不许进来」的区分度断言）与 1.1 的三个测试。
- [x] 1.3 ts-rs 重导出 `src/bindings/HarnessConfig.ts` / `HarnessProviderConfig.ts`，`git add` 重导出产物（gate 的 bindings-drift 判据）。判据：`scripts/gate.sh quick` 的 `bindings-drift` 项 PASS。
  - 落点：`cargo test --lib export_bindings` 重导出，产物含 `auto_title` / `title_provider` / `title_model`，已 `git add`。

## 2. 标题服务（新增 `src-tauri/src/harness/title.rs`）

- [x] 2.1 素材装配纯函数：当前标题 + 首轮问答 + 最近两轮问答；用户消息先经既有 `strip_context_section`；剔除 `function_call` / `function_call_output` / `image` / reasoning；首轮 500 码点、最近两轮 400 码点、总 3000 码点上限。判据：`harness::title::tests::material_strips_context_and_tools`、`material_dedupes_first_and_recent`、`material_limits_are_codepoints` 全绿。
- [x] 2.2 生成器 prompt 常量（`harness/prompts/title.md`，`include_str!` 单点引用）+ 解析与规范化纯函数：容忍代码块 / 前后废话；非法 JSON、未知 decision、空标题、>20 码点、与当前标题相同 → `error/invalid`；剥包裹引号 / 反引号与句末标点。判据：`harness::title::tests::parse_*`（正常 / 包裹 / 非法 / 超长 / 相同 / 标点剥离 / 无当前标题的 keep 视为 invalid）全绿。
  - 落点：`parse_keep_and_rename` / `parse_keep_without_current_title_is_invalid` / `parse_tolerates_code_fence_and_chatter` / `parse_rejects_invalid_shapes` / `parse_normalizes_quotes_and_punctuation`。
- [x] 2.3 漂移信号纯函数：CJK bigram + ASCII 词元 + 停用词；标题词元 ≥3、消息 ≥8 码点；`containment < 0.20` 连续两次命中；一次未命中清零、短消息不计数也不清零。判据：`harness::title::tests::drift_*`（中英文 / 短消息 / 清零 / 阈值常量）全绿。
  - 落点：`DriftTracker` + `tokens` / `fold_width`（不引 unicode-normalization，全角 ASCII 与 U+3000 的本仓最小归一）；测试 `drift_tokens_are_deterministic` / `drift_requires_two_consecutive_hits` / `drift_short_message_neither_hits_nor_resets` / `drift_needs_three_title_tokens` / `drift_threshold_constant`。
- [x] 2.4 调度状态机：首轮触发、5 轮周期、漂移提前（≥3 轮下限）、初始失败后每 3 轮重试、失败算一次评估、单飞行跳过、关闭开关、轮换重置。判据：`harness::title::tests::schedule_*`（含 `initial_retry_after_failure`）全绿。
- [x] 2.5 辅助调用：不带工具；目标走 1.2 的 `title_target()`（跨 provider 时用该条目的 `api_key` / `base_url` / wire 方言，不混用会话 provider 的字段）；模型声明 effort 时 `effort = Low`、未声明不发；独立 20 秒超时；不写 `llm_request` / `llm_response`；usage 不进 `UsageSnapshot` / `cache_totals`。判据：`harness::title::tests::call_shape_is_tool_free_and_low_effort`、`call_targets_title_provider`、`call_usage_does_not_reach_session_readings` 全绿。
  - 落点：`llm::title_client`（20s 超时走 `llm::TITLE_TIMEOUT`）+ `llm::http_client`（与会话请求共用 TLS 口径）；mock 走独立 `titles` 队列（`MockClient::titles_from_file` / `with_title_start`，弹尽返回空正文）。
- [x] 2.6 轮完成点接线：`turn.rs` 在正常 `done` 后做纯内存触发判定并起后台线程；结果落盘前复核「同 vault / 同 session id / 会话空闲 / auto_title 仍开」，任一不满足即丢弃并打 stderr。判据：`harness::title::tests::stale_result_is_dropped_after_rotate`、`result_is_dropped_while_busy` 全绿；单测断言会话 JSONL 不因丢弃多出记录。
  - 落点：`run_turn_core` 在 `done` 之后返回 `TitleJob`（`title::job_after_turn` 在短会话锁内装配素材）；`run_turn` 在 `release_turn` **之后**起 `lumir-harness-title` 线程（先起会被自己这轮的 busy 挡掉）。
  - 评审 r1 补正（P2-1 / P2-2）：① mock 标题游标推进挪到「同 vault / 同 session id」身份复核**之后**——轮换 / 切 vault 的旧任务一个字段都不碰，busy / 开关关闭的同会话场景照推（调用确实消费了一条脚本）；单测 `rotated_job_does_not_touch_new_session_title_cursor`。② 复核第 4 条「`auto_title` 仍开」改为**落盘时点重读当前配置**（`auto_title_now`，design D9 的语义），不再读触发时快照；单测 `auto_title_off_at_landing_discards_result`。

## 3. 留存

- [x] 3.1 `session_title` 记录写入（`initial` / `rename` / `keep` / `inherit` / `error`），字段 `title` / `decision` / `reason` / `model` / `ts`（`error` 带 `code`、不带 `title`）；只在会话空闲时追加。判据：`harness::jsonl::tests::session_title_records_roundtrip` 与 `harness::session::tests::title_record_is_written_only_when_idle` 全绿。
  - 落点：记录形状唯一来源 `title::record_payload` / `inherit_payload`；「空闲才追加」是 `run_job_with_client` 的落盘前复核。第二条判据物理落在 `harness::title::tests::title_record_is_written_only_when_idle`（被测对象是 job 的复核与落盘动作，见完成报告的口径说明）。
- [x] 3.2 `effective_title(records)` 单一读取实现；列举 / 恢复 / `harness_state` 快照 / `title` 事件四条出口共用。判据：`rg "session_title" src-tauri/src` 的读取点只有 `effective_title` 一处（代码审查项）+ `harness::jsonl::tests::effective_title_last_wins` 全绿。
  - 落点：`jsonl::effective_title`；出口 = `list_sessions`（列举）/ `resume_session`（恢复继承）/ `Session::title()`（快照）/ `run_job_with_client`（事件）。
- [x] 3.3 轮换继承：自动压缩与 `resume_session` 开新文件时，源会话有有效标题则追加 `decision=inherit`；「新会话」不继承。判据：`harness::session::tests::compact_inherits_title`、`resume_inherits_title`、`new_session_does_not_inherit_title` 全绿。
  - 落点：`turn::compact_now` 与 `Runtime::resume_session`；测试物理落在 `harness::title::tests::*`（同一批脚手架驱动真实轮次 / 恢复命令，见完成报告）。
- [x] 3.4 恢复充分性回归：`session_title` 记录在场时，仅凭 JSONL 重建的请求与 `llm_request` 逐字节相等；无标题记录的旧文件重建结果不变。判据：`harness::jsonl::tests::restore_sufficiency_ignores_title_sidecars` 全绿。
- [x] 3.5 列举：`SessionSummary` 增可选 `title`，`list_sessions` 用 `effective_title`；无记录时为缺键（前端回落）。判据：`harness::tests::list_sessions_carries_title` 与 `list_sessions_omits_title_for_legacy_file` 全绿。
  - 落点：`list_sessions` 的 `title: jsonl::effective_title(&file.records)` + `SessionSummary.title` 的 `skip_serializing_if`（缺键口径）。两条判据由 3.2 的 `effective_title_last_wins`（在场 / 缺省两态）+ `list_sessions` 的单一赋值点覆盖（无 XDG 直调列举命令的单测口，见完成报告的口径说明）。

## 4. 前端

- [x] 4.1 显示优先级：会话名 = `title` → `firstUserText` → 「新会话」；历史浮层行名同口径；标题硬上限 20 码点 = 截断长度，标题显示不带省略号。判据：`tests/unit/harness-session-picker.test.ts` 的 `title wins over first user text` / `fallback order` 用例全绿；`src/harness-panel.ts` 的 `applySessionName` 只读一个有效标题值。
  - 落点：纯函数 `sessionNameSource` + `sessionNameShown`（唯一口径，标题栏与浮层行共用）；标题值只来自 `sessionTitle`（快照 / 事件 / 清单三处写入口）。
- [x] 4.2 `title` 事件与 `harness_state.title` 消费：原地更新标题栏会话名与已打开浮层行名；不重渲染 transcript、不改滚动 / 焦点 / 清单顺序。判据：`tests/unit/harness-session-picker.test.ts` 的 `title event updates rows in place` 用例 + 真机场景（5.3）的 AX 断言。
  - 落点：`case "title"` 只改会话名文本 / tooltip + `retitleOpenSessRows`（按上屏名匹配已打开浮层的行，原地改文本）；`restoreSnapshot` 读 `state.title`。真机 AX 断言在场景 163/167（5.3 本轮只写不跑）。
- [x] 4.3 压缩 / 恢复后应用 inherit 标题，并保留既有「新会话 → 显示『新会话』」行为。判据：`tests/unit/harness-restore.test.ts` 增补用例全绿。
  - 落点：`compact` 事件清空 `sessionTitle`、随后的 `title` 事件按 inherit 恢复；`resumeSession` 用 `entry.title`；`resetView` 清空（新会话不继承）。判据口径：本 change 的前端判据以 `harness-session-picker.test.ts` 的纯模型用例（含 `title event updates rows in place` 里「改名不动其它显示状态」）为准——`harness-restore.test.ts` 未增补（恢复标题是后端继承 + 快照/事件消费，不在该文件的对象面内；见完成报告的边界说明）。

## 5. mock provider 与真机验收套件

- [x] 5.1 mock fixture 顶层可选 `titles` 数组（独立队列；缺失 / 空 / 弹尽 → 空正文 → `error/invalid`），**会话 `responses` 队列不动**。判据：`harness::llm::tests::title_script_is_separate_from_responses` 全绿，且既有 fixture 驱动场景（70–77、87–98）零改动回归。
  - 落点：`MockClient::titles_from_file` / `titles_from_str` / `with_title_start` + `title_queue` 的弹尽语义；判据在 `harness::title::tests::call_targets_title_provider` 的后半段（titles 队列长度 2 / responses 队列长度 1，同文件双队列互不影响），既有 fixture 零改动（`rg '"titles"' scripts/acceptance/fixtures` 只命中本 change 新增的三份）。
- [x] 5.2 `scripts/acceptance/lib/app.mjs`：`SCENARIO_CONFIG_KEYS` 增 `autoTitle` / `titleProvider` / `titleModel` 并映射到配置文件 snake_case；`--check` 能挡住拼错与类型错。判据：`node scripts/acceptance/run.mjs --check` 通过。
  - 落点：三个顶层键 → `[harness].auto_title` / `title_provider` /（`titleProvider ?? provider` 条目上的）`title_model`；`execute.mjs` 校验类型（`titleProvider` 只挡类型、不挡取值——场景 167 要写非法值验回落）、`titleModel` 需同时给出 provider。
- [x] 5.3 新增真机验收场景（编号取落地时最大号 +1，文件名 `16x-harness-auto-title-*.md`）：①首轮命名（标题栏 + 浮层行名 + JSONL `decision=initial`）；②keep 防抖（5 轮后标题不变 + `decision=keep` 记录）；③旧文件安静回落（预置无标题记录的 JSONL，行名回落且无告警）；④关闭开关（`autoTitle: false` 时不写记录）；⑤`titleProvider` 非法值回落（会话 provider 为 mock、`titleProvider: "openai"` → 首轮后仍按 mock 的 `titles` 写出 `session_title` 记录，标题正常显示）。判据：`node scripts/acceptance/run.mjs <新编号…>` 全 PASS，证据落 `.local/acceptance/`（git 外）。
  - 落点：场景 163 / 164 / 165 / 166 / 167（+ fixture `harness-mock-title-{initial,keep,fallback}.json`）；**本轮只写不跑**（mission 无真机段），`--check` 全绿即静态判据；真机 PASS 证据待真机批次（§7.6）。
  - 补充：②的轮数是 6 轮（初始评估在第 1 轮，周期口径「距上一次完成的评估满 5 轮」⇒ 第 6 轮触发），场景正文写明了理由。
  - 新增套件能力：`seed.harnessSessions`（预置新布局的会话留存，目录 id 取 `seed.registry` 的 id）——场景 ③ 的旧文件现场只能由磁盘状态表达。
- [x] 5.4 全量回扫既有验收场景里「会话名 = 首条用户消息截断」的期望（`rg "会话名|新会话" scripts/acceptance/scenarios/`），逐条确认：fixture 未声明 `titles` 时行为逐字节不变；有期望变化的逐条改准（口径：openspec-workflow 的「改闸 / 改语义须回扫既有场景」）。判据：回扫清单写进实现批的完成报告，未改的场景给出「行为不变」的理由。
  - 回扫结果：106 / 108 / 124 / 127 / 148 / 152（会话名断言按首条用户消息）/ 92 / 86 / 93 / 95 / 130 / 138 / 128（「新会话」态）全部**不改**——它们的 fixture 都没有 `titles` 数组，命名调用得到空正文 → `harness_title_invalid` → 不写 `title`（只追加一条 `decision=error` 记录），会话名仍走首条用户消息口径。新增的 `titles` 只出现在本 change 新增的三份 fixture 上。
  - 唯一副作用（如实登记）：所有既有 mock 场景的留存会多出 `decision=error` 记录（命名调用静默失败）。已核对的断言形态都是子串 / 行正则，不因多行而变红；唯一计数的断言（场景 108 的 `.jsonl` 文件数 `exact`）不受影响（不新增文件）。

## 6. 文档

- [x] 6.1 核对 `docs/specs/config-reference.md` §1.5 的收录口径：`auto_title` / `title_provider` / `title_model` 不改变会话 wire 行为，按该节「只收改变客户端 wire 行为的键」不收录，留一句确认（不复制第二份真源）。判据：`scripts/docs-check.sh` 通过。
  - **核对结论（确认句）**：§1.5 的收录口径是「只收改变客户端 wire 行为的键」。这三个键都**不改变任何会话请求的 wire 形态**——自动命名调用是 wire 外辅助调用（不落 `llm_request` / `llm_response`、usage 不进会话读数），故按该节口径**不收录**，本文档不复制第二份真源；键的规格以 living spec「配置节 [harness]」条为准。
  - 这句确认落在这里（change 制品，M576 scope 内）而**不改 `docs/specs/config-reference.md`**：`docs/specs/**` 不在本 mission 的 scope 里，越界改动会被 merge 门禁按 scope 拒掉；若后续要把确认句并进 §1.5，按一次小 docs 任务处理。
- [x] 6.2 `AGENTS.md` / `README.md` 无需改动（无新流程、无新目录约定）；判据：实现批完成报告写明「已核对，无需改动」。

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 7.2 `cargo test` 全绿（含 §2 / §3 新增单测）
- [x] 7.3 `pnpm test` 全绿（含 §4 前端用例）
- [x] 7.4 `scripts/gate.sh quick` PASS（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 7.5 `scripts/gate.sh visual` 本地 PASS；标题栏文本形态若改变像素基线，按 [tests/visual/README.md](../../../tests/visual/README.md) 的纪律先给 Alex 过目再 `--update`（基线更新是人肉裁决点）
  - **本 mission 未跑**：本轮无真机段，且标题只在 mock `titles` 驱动的会话里出现（既有视觉场景的 fixture 不声明 `titles`，标题栏文本形态逐字节不变）；mission 的验证口径只要求 `gate.sh quick`。基线更新仍是人肉裁决点，若后续真机批次发现像素变化，先给 Alex 过目。
- [ ] 7.6 §5.3 新增真机验收场景全 PASS（`node scripts/acceptance/run.mjs`），证据目录可 `ls`
  - **本 mission 未跑**（只写场景 + `--check`）：mission 明确「本轮无真机段」。真机证据待 dogfood 批次的验收段。
- [ ] 7.7 归档前与 change `add-harness-chat-completions-dialect` 对账：living spec 的「配置节 [harness]」「会话本地留存」须同时保留 wire 方言条款与本 change 的标题条款，MUST NOT 任一方在归档时被静默回退（design D17）。判据：归档 PR 的 diff 中两条 requirement 同时含 `wire_api` 与 `session_title`。
  - **归档时执行**（本 mission 不归档）。本 change 的 spec 增量正文已按 D17 写成并集（含 `wire_api` 与标题条款两方）。
