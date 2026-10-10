# Tasks: harness-sessions-per-vault

> 本 change 是**提案 PR**：第 1–6 组是实现期任务，提案评审（节点 1）通过前不实施、不勾选。
> 第 0 组是起草期自验，已完成。

## 0. 提案期自验（起草期已完成）

- [x] 0.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过——起草期实跑：`Totals: 23 passed, 0 failed (23 items)`（含 `change/harness-sessions-per-vault`），退出码 0；唯一一次红是 MODIFIED 必须保留基线场景名（「旧文件孤儿化」被重命名），改回原名后绿
- [x] 0.2 事实锚点核对：布局与消费侧的 file:line（`jsonl.rs` / `harness.rs` / `commands.rs` / `vault_registry.rs`）逐条只读核实，见 `design.md` §1；vault id 在打开路径已在手这一结论由 `commands.rs:385-399` 与 `:182-199` 两处坐实（`PreparedVaultOpen.vault_id` 在场、`commit` 丢弃）

## 1. 身份与布局落点

- [ ] 1.1 vault 稳定 id 进入 harness 作用域：`VaultInner::commit` 不再丢弃 `PreparedVaultOpen.vault_id`（`commands.rs:182-199`），`OpenVault` 存下并开一个读口，`VaultScope` 携带它——不新造 id 形态、不新增「路径 → id」查表
- [ ] 1.2 会话目录按 vault 分置：`jsonl.rs` 的目录函数收 vault id、建句柄路径为 `sessions/<vault 稳定 id>/<session_id>.jsonl`，目标目录按需创建（失败沿用既有 `harness_jsonl_failed` 口径）
- [ ] 1.3 三处路径拼接改到 id 目录：`resume_session`（`harness.rs:334`）/ `delete_session`（`:497`）/ `list_sessions`（`:537`，只扫本 vault 目录）；`session_belongs_to_scope`（`:521-526`）一字不改——归属判据仍是首行 `vault_root`
- [ ] 1.4 保留名纪律：解析 vault 目录名处校验 `valid_id` 通过且 ≠ `_orphaned`（不通过即记日志并按 `_orphaned` 口径处理，不 panic、不静默）
- [ ] 1.5 注释与文档漂移收口：`jsonl.rs` 模块头布局注释、`harness.rs` 相关注释、`session.rs` 的 ts-rs 文档注释（重导出 `src/bindings/SessionSummary.ts`）、`src/ipc.ts` 的路径描述

## 2. 一次性迁移

- [ ] 2.1 迁移内核（可测、零环境变量扰动）：入参注入 `sessions/` 根目录 + 「路径 → id」解析器；逐文件读首行 → 归位 / `_orphaned`；不覆盖目标已存在的同名文件；返回四态结果（无事 / 已迁移 / 有孤儿 / 失败）
- [ ] 2.2 暴露「路径 → id」只读查询口：复用 `vault_registry::find_by_path` 的比对语义与 `is_registered` 的规范化惯用法（`vault_registry.rs:289-294`）；不改注册表、不登记新 id
- [ ] 2.3 启动调用点：`lib.rs` 的 setup 内、第一个 harness 读者之前同步跑完（仿 `migrate_legacy_registry_dir_at_startup` 的调用点纪律，`vault_registry.rs:149-162`）
- [ ] 2.4 结果落诊断日志（四态）+ 单文件失败打 stderr 并留原地（下次启动重试）

## 3. 测试

- [ ] 3.1 迁移正确性属性测试（任意 `session_open` 首行 → 落到正确 vault 目录）：含不可归属 → `_orphaned`、同目录两种路径拼写并存、迁移后根下零 `*.jsonl`（无 IO 失败时）、注入 IO 失败时失败者留原地且下次运行收敛、文件字节不变、二次运行零搬运（幂等）
- [ ] 3.2 反向验证（REVIEW.md 第 1 条）：故意写错归属映射 / 去掉规范化一步，断言必红
- [ ] 3.3 `src-tauri/tests/session_recording.rs` 换代：路径断言到 `<vault 稳定 id>/`；新增「两个 vault 的会话互不可见（列举范围）」与「恢复 / 删除在 id 目录内命中」
- [ ] 3.4 门禁：`scripts/gate.sh quick` 全绿（报告照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

## 4. 真机验收

- [ ] 4.1 21 个场景共 70 处 `env:harness` 引用逐处核对（实测：64 处 `sessions/*.jsonl` file 断言 glob + 6 处 `sessions` 目录形态）；glob 改为 `<vault 稳定 id>/` 层级
- [ ] 4.2 新增场景：两个 vault 各落各目录 + 会话浮层只见其一（真实 WKWebView 判定，mock provider，fixture 全合成）
- [ ] 4.3 新增场景：平铺文件迁移归位 + 不可归属进 `_orphaned/`（预置平铺文件与一个畸形文件 → 启动 → 断言归位、根下零 `*.jsonl`、孤儿桶内容在场）
- [ ] 4.4 文档与实跑：`scripts/acceptance/README.md:193-195` 与 `scripts/acceptance/lib/app.mjs:144-148` 的路径文档改准；真机跑 105 / 106 / 108 与 4.2 / 4.3 的新场景，证据落 `test-results/`（git 外）

## 5. 排依赖核对

- [ ] 5.1 `harness-composer-image-paste` 若在 harness 侧落附件字节：核对其落点是否采用同一 vault 目录层级（proposal「排依赖」）；若那边先落地并在 `sessions/` 根下留了非会话文件，核对迁移不受影响（迁移只处理根下 `*.jsonl`）

## 6. 归档核对

- [ ] 6.1 `openspec/specs/harness/spec.md` 的 `Purpose` 段（`:13`）路径表述改准——delta 机制改不到 `Purpose`，属归档时手工项（见 `specs/harness/spec.md` 的起草注记）
- [ ] 6.2 spec 增量（MODIFIED 会话本地留存）与实现逐条对账：语义一致的才归档；有静默扩 scope 的停下重走节点 1
