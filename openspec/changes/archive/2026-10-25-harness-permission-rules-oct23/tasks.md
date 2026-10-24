# Tasks: harness-permission-rules-oct23

> 提案阶段：以下全部未勾选，随实现逐项勾选。裁决点 Q1–Q7 见 `proposal.md` / `design.md §10`；
> 按倾向落地的项在实现前若 Alex 有不同裁决，先改 proposal 再动代码。

## 1. 分类器：`bash -lc` 受限解包（A2）

- [x] 1.1 `permissions.rs`：加解包形态判据（`sh` / `bash` / `zsh` / `dash` × `-c` / `-lc` / `-cl`，
      `argv.len() == 3`）与脚本词法（单 / 双引号字面量、`;` `&&` `||` `|` 分隔、`2>/dev/null` /
      `>/dev/null` / `1>/dev/null` / `2>&1` 整 token 丢弃），失败清单按 `design.md §2.2 / §2.3`
- [x] 1.2 分类接入：解包只在「全部子命令 `ReadOnly`」时把整条降到 `ReadOnly`；其余一律维持
      `Dangerous`（MUST NOT 降为 `Write`）；解包形态下 `SHELL_META` 保守规则不先行
- [x] 1.3 递归预算：`classify_cli` 内部带 `depth`，与 `classify_wrapped` 共用；嵌套 > 2 层、子命令
      > 16、脚本 > 4096 字节一律危险
- [x] 1.4 表驱动正反例（`design.md §2.6` 两张表逐行落测试），每条正例配一条只差一字符的反例
      （反向验证纪律：`REVIEW.md`「断言等价于子串」条）
- [x] 1.5 更新既有断言：`permissions.rs` 的 `sh -c "echo hi"` / `zsh -lc "pwd"` 类「包装器恒危险」
      用例改为不可解包样本（`bash script.sh`、`bash -x -c …`、`zsh -lc "rm -rf …"`）；
      判定依据用例（现用 `zsh -lc "pwd"`）换样本后仍断言 `DangerousWrapper { command: "zsh" }`
- [x] 1.6 判定级断言：解包失败样本在 `full_access` 档仍产 `Ask`；解包成功样本在 `vault_write` 档
      直接 `Allow` 且不产 `DecisionReason`

## 2. 规则匹配与持久化（A1）

- [x] 2.1 `permissions.rs`：`rule_matches` 补「空格 + `*`」形态的等值容差（Q2），单测覆盖
      `git push` 命中 `cli(git push *)`、`git pushx` 不命中
- [x] 2.2 `permissions.rs`：`permission_prefix(tool, argv, subject)` 生成器（cli 两词前缀 / 第二词是
      flag 时退化；vault 路径前缀 / 根级精确；`vault_delete` 与 `cron_task_*` 返回 `None`），单测逐档
- [x] 2.3 `config.rs`：规则追加（去重）/ 删除（幂等）的可测函数 + 进程级配置写锁，与
      `write_config_value_to` 共用；单测用临时路径
- [x] 2.4 `harness.rs`：`harness_approve` 增加 `persist_rule: Option<bool>`——从待决请求现算规则文本
      （不采信前端文本），写回成功后才 resolve；写失败返回错误、批准保持待决
- [x] 2.5 `harness.rs`：新增 `harness_permission_rule_remove(rule) -> bool` 命令并在 `lib.rs` 注册
- [x] 2.6 单测：追加去重、删除幂等、写失败语义（规则写失败时不执行调用 / 调用不丢）

## 3. 会话记忆与批准卡字段（A3 + 死按钮）

- [x] 3.1 `permission_cache.rs`：键改为自描述形态（尾随空格 = 前缀键，否则精确键）；
      `is_remembered` 用词边界前缀 / 全等两种判定；命名空间与生命周期不变；单测覆盖
      「同前缀不同实参命中」「vault 精确路径仍全等」「切会话清空不变」
- [x] 3.2 `approval.rs`：`ApprovalRequest.remember: bool` → `Option<String>`，新增
      `persist_rule: Option<String>`；`ApprovalDecision` 增加 `persist_rule: bool`
- [x] 3.3 `turn.rs`：`gated_execute` 一处派生两枚次级动作（危险层 → 两项都 `None`；模式层 →
      按 §3.1 生成器给 `Some`）；批准时 `remember` 写缓存、`persist_rule` 透传给命令层
- [x] 3.4 `session.rs`：快照镜像两个字段（`skip_serializing_if = "Option::is_none"`，与 `reason` 同款）
- [x] 3.5 前端**全部**消费点按字段渲染（`harness-panel.ts`，基线 `ba98587d` 实测行号）：
      ① 事件路径卡片渲染 `:7115-7124`；② 快照恢复路径卡片渲染 `:7690-7700`；
      ③ 事件载荷归一化 `:8162`；④ 父会话待决快照归一化 `:8655`；⑤ 子运行快照归一化
      `:8002`（`parseTaskApproval`）；⑥ 语言切换重上文案 `:6862-6863`（两枚按钮都要重上，
      插值取当前请求）；⑦ 事件路径 decide 链 `:7153-7166`；⑧ 快照恢复路径 decide 链
      `:7702-7713`；⑨ 子运行 decide 链 `:7726-7745`（`decideTaskApproval`）；⑩ 载荷类型声明
      `:3248` / `:6991`。两处卡片渲染共用同一构建函数，禁止各写一份
- [x] 3.6 **归一化缺键语义翻转**：把 `rg 'remember !== false'` 命中的三处（`:8162` / `:8655` /
      `:8002`）从「缺键按可见处理」（M413 契约）改为「缺键 / null = 不渲染」；`persist_rule` 同款
      解析。不翻转的后果是危险卡经快照恢复**复活死按钮**（D3 要杀的形态）。补前端单测：缺键 /
      null 不渲染、危险卡快照恢复后仍无两枚按钮
- [x] 3.7 单测：危险层两项皆 `None`；模式层两项皆 `Some`；事件与快照同源同形；前端字段缺省不渲染

## 4. 验收场景（改权限语义必做）

- [x] 4.1 **全量回扫既有验收场景的闸期望**：`scripts/acceptance/scenarios/` 的 72 / 73 / 74 / 75 /
      109 / 110 / 111 / 151 / 183 / 184 逐条核对并按新语义改准。已知必改：151 的包装器样本
      `zsh -lc "echo HNA-WRAP"` 在解包后变成只读、不再出卡——换成不可解包样本（如
      `zsh -lc "rm -rf /tmp/x"` 或 `bash script.sh`），判定依据仍是包装器句；110 的 remember
      按钮断言按新文案（带前缀）核对
- [x] 4.2 新增场景：① 纯读 CLI 持久放行（批准卡点「以后都允许」→ 同类命令第二个查询不再问 →
      浮层里删掉规则后重新问）；② `bash -lc` 只读命令免问（保险库写入档直接执行）；③ 危险包装
      仍问且卡上无两枚次级动作
- [x] 4.3 真机跑一遍套件（`node scripts/acceptance/run.mjs`），证据落 `.local/acceptance/`；
      报告里给逐场景 PASS / FAIL 与证据路径
      —— **2026-10-24 三条场景全部真机 PASS（0 FAIL）**：229 本 change 新增（31 断言）、
      110 回扫改准（19 断言）、151 回扫改准（16 断言）；证据
      `.local/acceptance/2026-10-24-m711/{229-harness-permission-rules,110-harness-approval-purpose-remember,151-harness-approval-reason}/`

## 5. 前端界面与文案

- [x] 5.1 批准卡：两枚次级动作并列、等宽、次级视觉；文案带 `{rule}` / `{prefix}` 插值
- [x] 5.2 权限浮层：三档下方加分隔线 + 「已记住的规则」段 + 条目（规则原文 mono + 删除钮）；
      空态整段不渲染；超过 6 条滚动；打开时 `configGet()` 现读、删除后重取；沿用 `clampPermPop` 收编
- [x] 5.3 `harness-panel.css`：条目 / 分隔线 / 段标题 / 删除钮样式，只消费既有 token；三主题核对
- [x] 5.4 `copy-data.ts`：新增四条文案（zh / en 原文见 `design.md §6.3`），D 编号接续当时最大号；
      保留 D434 作为无前缀时回退
- [x] 5.5 前端单测：列表空态不渲染、删除后刷新、按钮字段驱动、文案无 `{}` 残留

## 6. 提示词与文档

- [x] 6.1 `src-tauri/src/harness/prompts/identity.md`：工具纪律段补三句（`design.md §7` 原文）
- [x] 6.2 **归档提交时**：把 `openspec/specs/harness/spec.md` Purpose 的「三层权限规则（allow / ask /
      deny）」改为两层口径（Purpose 不是 requirement、不进 delta，只能归档时手改；同「归档后核对
      Purpose」通道）
      —— **2026-10-25 归档批（M729）已执行**：Purpose 首段的三层句改为「两层权限规则（allow /
      deny）之上的**三档权限模式**…」；同段 M725 的 pane 定位句与「8 件 vault 操作工具 … 另加
      1 件编排工具 `task`」计数句逐字保留。`openspec/specs/harness/spec.md` 全文件复核：「三层
      权限规则」零命中，「两层权限规则」命中 Purpose 与本 change delta 替换后的「权限机制」条。
- [x] 6.3 若实现期发现 proposal 的意图需要变更，停下改 proposal 并重走节点 1，不静默扩 scope
      —— **不适用（N/A）**：实现期与 r1 返修都未改 proposal 的 What Changes / 裁决点（r1 处置是
      实现层修正与 scope 外 finding 登记，见评审 r1 的逐项核对），没有重走节点 1 的触发条件

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 7.2 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 7.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行）
- [x] 7.4 `bash scripts/gate.sh visual` 全绿（动过 UI，本地必跑；CI 绿不代表像素层没回归）
- [x] 7.5 反向验证记录：每处放宽（解包、前缀匹配、等值容差）各给一条「改一个字符必须变红」的
      实测读数，写进完工报告
- [x] 7.6 涉及 `src/bindings/**` 的重导出先 `git add` 再跑 quick（`remember` 字段形态变化会重导出）
      实测**无**重导出：`ApprovalRequest` / `PendingApprovalSnapshot` 只派生 `Serialize`、不走 ts-rs，
      字段形态变化因此不产生 bindings 变更；`bindings-drift` 门禁 PASS 即证。
