# Tasks: add-approval-decision-reason

> 实现期注记（M459）：逐条勾选时附证据指针与如实登记的偏离。两处口径修正见
> [design.md](design.md) §3（deny 层落工具行而非批准卡）与 §4.3（规则原文领读），
> proposal 的「评审记录」块记了来历。

## 1. 判定管线的层产出（Rust）

- [x] 1.1 `src-tauri/src/harness/permissions.rs`：新增 `DecisionReason` 枚举（`DenyRule { rule }` /
      `DangerousWrapper { command }` / `DangerousCommand` / `ModeDefault { mode }`，internally tagged
      `kind` + snake_case，ts-rs 导出）与 `Verdict { decision, reason: Option<DecisionReason> }`；
      `decide()` 改返回 `Verdict`（五层短路顺序一律不变，只多带层级）
      —— `permissions.rs:59-146`（`decide`）/ `:59-104`（枚举与 `Verdict`）；单测
      `reason_presence_matches_the_decision` 钉住不变式（Ask ⟹ 三选一的可上卡依据、Deny ⟹ `DenyRule`、
      自动放行的层 ⟹ `None`）
- [x] 1.2 危险命中的「包装器 or 其余」收成单一真源：`dangerous_kind()` 产出类别、`is_dangerous()` 改为它
      `.is_some()`；`DangerousWrapper` 的 `command` 取外层 argv[0] 的 basename，`DangerousCommand` 不带载荷
      —— `dangerous_kind`（`permissions.rs:315+`）与 `dangerous_reason`；单测
      `dangerous_kind_separates_wrappers_from_other_members`（10 个包装器 + 其余成员 + 非黑名单形态逐格）
- [x] 1.3 `turn.rs`：`handle_call` 收 `Verdict`；`gated_execute` 经 `GatedCall` 结构体收 `reason`
      并同时喂 `ApprovalRequest` 与事件函数；deny 分支走 `denied_message()`（规则原文领读 + 80 字符超限退回）
      —— `turn.rs` 的 `GatedCall` / `denied_message` / `SUMMARY_MESSAGE_LIMIT`（与 `summarize_result`
      共用同一常量，80 字符只有一处声明）；**偏离**：`gated_execute` 参数从 7 个涨到 8 个触发 clippy
      `too_many_arguments`，改把「被闸的这一次调用」归成 `GatedCall`（不挂 `#[allow]`——本仓没有
      先例）
- [x] 1.4 `approval.rs` + `session.rs`：`ApprovalRequest.reason`、`PendingApprovalSnapshot.reason`
      （`skip_serializing_if = "Option::is_none"`）+ `from_request` 镜像
      —— `approval.rs:38-90`、`session.rs:195-227`
- [x] 1.5 绑注重导出：`cargo test` 产出 `src/bindings/DecisionReason.ts`（internally tagged 联合，
      含 `import type { PermissionMode }`）并已 `git add`（gate 的 bindings-drift 绿）
- [x] 1.6 Rust 单测：`reason_mapping_covers_every_gated_layer`（四变体各由哪一层产出 + 载荷；
      deny 多条命中取第一条）、`reason_presence_matches_the_decision`（不变式）、
      `dangerous_kind_separates_wrappers_from_other_members`、
      `reason_serializes_with_snake_case_kind_tag`（wire 形状逐字钉死：`{"kind": …}`）；
      `events.rs` 的 `approval_request_argv_is_array_and_purpose_optional` 扩了 `reason` 在场 / 缺席两态
      —— lib 测试 **445 passed / 0 failed**（M459 前 441）
- [x] 1.7 集成测试（`src-tauri/tests/harness_runtime.rs`）：`approval_reason_reaches_event_and_snapshot_alike`
      （包装器层：事件与快照同值 + 点名 `zsh`）、`approval_reason_carries_mode_default_layer`
      （`vault_write` 档库外写命令 → `{"kind":"mode_default","mode":"vault_write"}`）、
      `deny_rule_text_reaches_the_tool_result_message`（无批准请求事件 + 工具结果含规则原文）
      —— 该测试二进制 **41 passed / 0 failed**（M459 前 38）

## 2. 文案

- [x] 2.1 `文案-Copy.md` + `src/copy-data.ts`：新增 `D458`（模式默认分层行）、`D459`（shell 包装器行）、
      `D460`（其余危险命令行）；`D426` 改形（编号沿用）追加 `· {desc}`。deck 尾部补 M459 批次注记
      —— `tests/unit/copy.test.ts` 的 deck↔表漂移与占位符对齐门禁全绿（`node tests/unit/run.mjs`
      → **867 passed / 0 failed**，M459 前 855）

## 3. 面板

- [x] 3.1 `src/harness-panel.ts`：导出纯函数 `approvalReasonText(reason)`（kind → 模板；`{mode}` /
      `{desc}` 取 D427–D432 读数；缺依据 / 不可上卡的 kind → `null`）；`PendingApproval.reason`；
      `appendApproval` 在问句行下方插 `.lumir-hp-approval-basis`（无依据不建元素）；
      `relabelApproval` 内重取（语言切换不残留旧串）
- [x] 3.2 `src/ipc.ts` 事件类型加 `reason?: DecisionReason`；事件入口与快照恢复入口经**同一份**
      `parseDecisionReason`（宽容解析：只认三个可上卡的 kind，否则 `undefined` ⇒ 不出该行）
- [x] 3.3 `applyPermChip`：`title` / `aria-label` 按 `D426` 改形到位（附 `{desc}` =
      `permissionDescription(permMode)`）
- [x] 3.4 样式：`src/harness-panel.css` 补 `.lumir-hp-approval-basis` 规则（信息副行：meta 字号 +
      `--text-3` 次级灰 + `--sp-2` 下边距，全部复用既有 token，不引入新值）——**scope 经 tower 放宽**
      收编该文件（原 scope 未含 CSS，先以组合类名复用临时落地，放宽后换成独立规则）。
      落地注记：复用 `-note` 的做法被实测否决（`relabelApproval` 按该类名重取 D435，两类名同挂会把
      依据行覆盖成「将移入系统废纸篓，可恢复」——本轮视觉场景实跑抓到），复用 `-sub` 会撞 m384 的
      严格 `toHaveText`；独立规则因此是唯一无副作用的做法
- [x] 3.5 前端单测：`approvalReasonText` 三变体 zh/en 取值、`mode_default` 随档位变化、缺依据返回 null；
      `parseDecisionReason` 正例 3 条 + 坏载荷 12 条；`D426` 改形后含档释义且与
      `permissionDescription` 同源

## 4. 验收场景

- [x] 4.1 新增 `scripts/acceptance/scenarios/151-harness-approval-reason.md` + fixture
      `harness-mock-approval-reason.json`（全合成）：① `zsh -lc` 包装器卡断言 D459；② `npm install`
      卡断言 D458（含「保险库写入」档与释义）；③ deny 规则命中 ⇒ 断言工具行含规则原文、
      **不出现批准卡**、JSONL 留存含规则原文；并加了两段互斥断言（A 段的档释义句不得出现在第一张卡上）
- [x] 4.2 `node scripts/acceptance/run.mjs --check` → **场景静态校验通过（154 个）**（M459 前 153）

## 5. 视觉与呈现

- [x] 5.1 `tests/visual/scenes/m384-harness-approval-decided.spec.ts`：新增三条结构断言
      （包装器层在场 + 卡内子元素顺序契约 + 决策后退场 / 模式分层层文案 / 缺 reason 不出行）。
      **偏离（测试脚手架）**：`page.goto` 从 `beforeEach` 移进打开助手——`addInitScript` 只对之后的
      导航生效，而按载荷分支的桩必须在测试体里注册（原结构下新断言拿不到自己的载荷）
      —— 该 spec **11 passed**
- [x] 5.2 `tests/visual/scenes/m347-harness-composer.spec.ts`：chip `title` / `aria-label` 断言按 `D426`
      改形改准（两处：默认档 + 切到完全访问档）
- [x] 5.3 候选截图呈 Alex 过目：三张图（包装器依据行 / 模式分层依据行 / deny 规则原文工具行）已复制到主仓
      `test-results/alex-review-2026-10-12/m459/`（git 外），完工报告附 `open` 命令。
      **本 change 无既有整页基线含批准卡**（m384 场景自陈不建像素基线、批准卡不在任何整页基线画面里），
      故**不触发任何 `--update`**；若 Alex 过目后要求把该行纳入像素基线，另开一条（基线更新是人肉裁决点）

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → **30 passed / 0 failed**
      （M459 前 29；gate 的 openspec-validate 绿）
- [x] 6.2 `bash scripts/gate.sh quick` → **`GATE RESULT: 10/10 PASS（SKIP 0）`**，exit 0；SKIP 0 单列
      （cargo-fmt / cargo-clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / tsc-unit /
      unit-tests / docs-check / openspec-validate 十条全跑）
- [x] 6.3 动过视觉面 → `bash scripts/gate.sh visual`（LUMIR_VISUAL_PORT=4273）→
      **`GATE RESULT: 12/12 PASS（SKIP 0）`**，exit 0
- [x] 6.4 信息卫生：改动面 + 三个新增文件各扫一遍（本机绝对路径 / 家目录 / 凭据形态）——零命中；
      fixture 与截图全部合成（`harness-note.md` / `HNL-ALPHA` / 纯合成命令），无真实 vault 内容
- [x] 6.5 归档前逐条对账：本文件 / spec 增量（MODIFIED ×3）/ 实现三者一致；判定结论、wire 请求体、
      JSONL 留存结构、权限浮层与批准卡问句副句分工逐字节未变（改动只在「多带一个层级字段」与
      两处文案面）
