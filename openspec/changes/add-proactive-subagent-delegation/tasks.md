# Tasks: add-proactive-subagent-delegation

> 提案批（本次提交）只产出 proposal / design / tasks / 两条 spec delta，下列任务全部未勾。
> 节点 1 通过后才进入实现；实现期发现意图需要变更时停下改 proposal，不静默扩 scope。

## 1. 委派策略段（`task` 工具描述）

- [ ] 1.1 在 `src-tauri/src/harness/tools.rs` 加策略段常量（单一居所，文案逐字取 design §3.1 并经 Alex 裁决后的版本），`task_definition` 的组装顺序固定为「能力说明 → 策略段 → 清单」
- [ ] 1.2 单测：描述以能力说明开头、策略段居中、清单在后；策略段恰出现一次；三个固定标签「匹配就委派」「简单任务自己做」「独立才并行」与各自判据在场；描述里不出现「必须并行」这类义务措辞；清单仍是逐定义一行 `- <name>：<description>`
- [ ] 1.3 单测（反面对照）：装配后的 system prompt 不含策略段措辞；同一条测试先断言 identity 含某条已知工具纪律（正对照，防「空串上打转」）
- [ ] 1.4 单测：`[harness.subagents].enabled=false` 时 `task` 不在工具定义里，策略段不出现（关停口径沿用 `run::gate_tool_definitions`，不新增第二个关闭点）
- [ ] 1.5 `docs/specs/subagent-definitions.md` §8「清单注入与容量告警」补一段：注入顺序为能力说明 → 策略段 → 清单，并逐字抄录 design §3.1 的策略段全文（文档与代码同一份文案；三个固定标签不得改写成同义说法）

## 2. 内建 `explore` 补 `vault_list`

- [ ] 2.1 `src-tauri/src/harness/agents.rs` 的 `BUILTIN_EXPLORE`：`tools` 加 `vault_list`（四件）、描述改为「在 vault 里列目录、按路径枚举、搜索与读取文件、加载 skill，产出结论与依据；不改文件、不跑命令。」
- [ ] 2.2 单测：内建 `explore` 的 `tools` 恰为四件且含 `vault_list`；`DEFAULT_TOOLS` 仍为只读三件（钉住「不扩缺省集」；若 Alex 裁决一并扩，本节改为断言四件并同步 design 裁决点 2 的记录）
- [ ] 2.3 检查既有断言里写死「explore 只读三件」的位置（`scripts/acceptance/scenarios/200-subagent-explore.md` 等），逐条改准
- [ ] 2.4 `docs/specs/subagent-definitions.md` §6 的 `explore` 表格与描述同步四件

## 3. `llm_request.tool_names`

- [ ] 3.1 `src-tauri/src/harness/turn.rs` 的 `record_llm_request` 追加 `tool_names`：按 `request.tools` 顺序取 `name`，只名字，恒在场（空工具集记 `[]`），与 `request_bytes` 同级
- [ ] 3.2 单测：顺序与请求一致；元素只有名字（不含 `description` / `parameters` 键）；`tools` 为空时是 `[]` 而不是缺键
- [ ] 3.3 单测（兼容）：旧记录缺 `tool_names` 时，恢复 / 读数重算 / 通知陈旧判定三条读取路径都不把它当空数组，且不改写文件
- [ ] 3.4 单测：子运行审计流水里的 `llm_request.tool_names` 不含 `task`（深度 1 层的留存级断言）

## 4. 验收场景（mock 守执行链与暴露面）

- [ ] 4.1 新增 `scripts/acceptance/scenarios/255-harness-request-tool-names.md`（mock，tier 与既有子代理场景一致）：父会话 `llm_request.tool_names` 含 `task` 且为数组；同一会话子运行审计里的 `tool_names` 不含 `task`
- [ ] 4.2 `194-subagent-disabled` 增断言：`enabled=false` 时会话 `llm_request.tool_names` 不含 `task`（与 4.1 配对形成区分度；改前先确认该断言在启用态会红）
- [ ] 4.3 `180-subagent-delegate-discovery` 的标题 / 说明改准为「委派执行链（fixture 驱动）」并显式写明「不证明模型主动选择」；`scripts/acceptance/COVERAGE.md` 重生成
- [ ] 4.4 `node scripts/acceptance/run.mjs --check` 通过；`--list` 确认 255 在 `full` 批内
- [ ] 4.5 真机跑 `node scripts/acceptance/run.mjs 180 194 200 255`（core + full 混合按 id 精确筛），逐条 PASS 证据落 `.local/acceptance/2026-10-29/`

## 5. 真实 provider 行为验收（按 design §7，不接受 mock 替代）

- [ ] 5.1 在已配置真实 provider 的本机 app（`pnpm tauri dev`）打开合成 vault（`/tmp/lumir-m102-acceptance` 或 `/tmp/lumir-probe-proactive-m800`）；全程不读取 / 不复制 / 不手改凭据文件；开工前经**设置面**（设置面板「子代理」总开关）确认并记录 `[harness.subagents].enabled` 的进入时值（预期为开启），它就是 5.7 的恢复目标值
- [ ] 5.2 格 A（多文件调研，不提子代理名）：记录首条 `llm_request.tool_names`（须含 `task`）与首条 `llm_response.tool_calls`（须有 `name=task`、`agent=explore`）；对照诊断 `subagent_started` / `subagent_finished`
- [ ] 5.3 格 B（简单单文件问题）：须无 `task` 调用，且 `tool_names` 仍含 `task`（证明是「选择不派」而非「看不见」）
- [ ] 5.4 格 C（同 A 提问，**经设置面**关闭「子代理」总开关）：`tool_names` 不含 `task`、无 `subagent_started`；关闭后先记一次读数
- [ ] 5.5 证据落 `.local/reviews/proactive-subagent-delegation-oct29/real-provider.md`：模型 id（取 `llm_request.model`）、提问原文、三格抽取表、样本限制（单模型 / 每格 N=1 / 只作存在性判据）；证据只抽字段，不含 `system` / `messages` 原文
- [ ] 5.6 失败处置按 design §7.4 执行并留痕：一次只改一处措辞、最多两轮、失败轮次不得删除；两轮仍不达标则停手上报 Alex，附两轮措辞差异与读数
- [ ] 5.7 **强制收尾（无论 5.2–5.6 成功、失败、超时或中止）**：按 design §7.5 经设置面把「子代理」总开关恢复为 5.1 记录的进入时值，并在恢复后用界面状态或**新发的**请求 `tool_names` 核实含 `task`；把「进入时值 / 格 C 关闭后读数 / 恢复动作 / 恢复后核实读数」四行写进 real-provider.md。不得读 / 备份 / 改凭据文件；恢复失败即停手上报，未恢复不得写 PASS

## 6. 台账、门禁与评审

- [ ] 6.1 删除 `docs/backlog.md` 的 M772 条目「子代理缺省工具集是否加入 `vault_list`」（本 change 承接；若 2.2 按「一并扩缺省集」落地，条目内容与结论一致再删）
- [ ] 6.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过；`bash scripts/docs-check.sh` 通过（含归档对账门禁：delta 无静默丢段）
- [ ] 6.3 `bash scripts/gate.sh quick` 全绿（改过 Rust 与验收场景；未改样式，不触发视觉档）；照抄 `GATE RESULT` 原文行进报告
- [ ] 6.4 完工报告按 design §1.1 的四层判据逐层给证据指针（①③④ 给机器读数与场景 id，②给真实 provider 三格表）；②未达标不得写完成，也不得以 mock / 单测替代
- [ ] 6.5 归档顺序：本 change 的 delta 以「工具集声明与默认收紧」含 `vault_list` 为前提，MUST 排在该 change 归档之后（design §8）；归档前由 tower 核对 living spec 的闭集合已是 9 件
- [ ] 6.6 独立评审：非作者 reviewer 结论 clean / merge 且绑定当前 tip；按「节点 2 五要件」把 proposal 的节点 2 记录填齐（任务、delta、门禁、真机、真实 provider 证据、归档队列条目）
