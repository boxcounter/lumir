# Tasks: harness-sessions-per-vault

> 本 change 是**提案 PR**：第 1–6 组是实现期任务，提案评审（节点 1）通过前不实施、不勾选。
> 第 0 组是起草期自验，已完成。

## 0. 提案期自验（起草期已完成）

- [x] 0.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过——起草期实跑：`Totals: 23 passed, 0 failed (23 items)`（含 `change/harness-sessions-per-vault`），退出码 0；唯一一次红是 MODIFIED 必须保留基线场景名（「旧文件孤儿化」被重命名），改回原名后绿
- [x] 0.2 事实锚点核对：布局与消费侧的 file:line（`jsonl.rs` / `harness.rs` / `commands.rs` / `vault_registry.rs`）逐条只读核实，见 `design.md` §1；vault id 在打开路径已在手这一结论由 `commands.rs:385-399` 与 `:182-199` 两处坐实（`PreparedVaultOpen.vault_id` 在场、`commit` 丢弃）
- [x] 0.3 修订（M428，2026-10-10）：按 Alex 裁决「迁移不用写进产品里，写一个脚本执行。一次性的工作就不进入产品了」把一次性迁移从产品启动路径改为**仓内一次性脚本**——proposal 裁决点 2/3、design §4/§5、spec delta、tasks 第 2 节四处同步；复跑 `npx --yes @fission-ai/openspec@1.12.0 validate harness-sessions-per-vault --strict` 通过

## 1. 身份与布局落点

- [ ] 1.1 vault 稳定 id 进入 harness 作用域：`VaultInner::commit` 不再丢弃 `PreparedVaultOpen.vault_id`（`commands.rs:182-199`），`OpenVault` 存下并开一个读口，`VaultScope` 携带它——不新造 id 形态、不新增「路径 → id」查表
- [ ] 1.2 会话目录按 vault 分置：`jsonl.rs` 的目录函数收 vault id、建句柄路径为 `sessions/<vault 稳定 id>/<session_id>.jsonl`，目标目录按需创建（失败沿用既有 `harness_jsonl_failed` 口径）
- [ ] 1.3 三处路径拼接改到 id 目录：`resume_session`（`harness.rs:334`）/ `delete_session`（`:497`）/ `list_sessions`（`:537`，只扫本 vault 目录）；`session_belongs_to_scope`（`:521-526`）一字不改——归属判据仍是首行 `vault_root`
- [ ] 1.4 保留名纪律：解析 vault 目录名处校验 `valid_id` 通过且 ≠ `_orphaned`（不通过即记日志并按 `_orphaned` 口径处理，不 panic、不静默）
- [ ] 1.5 注释与文档漂移收口：`jsonl.rs` 模块头布局注释、`harness.rs` 相关注释、`session.rs` 的 ts-rs 文档注释（重导出 `src/bindings/SessionSummary.ts`）、`src/ipc.ts` 的路径描述

## 2. 一次性归位脚本（仓内脚本，不进产品运行时）

> 脚本本体与其测试属**实现期**（本 change 的实现 mission），产品侧 MUST NOT 出现任何迁移代码
> （裁决点 2、design §4）——本组任务不含 `src-tauri/` 改动，脚本落 `scripts/` 下、手动执行一次即弃。

- [ ] 2.1 脚本落 `scripts/`（入参为配置目录）：扫 `<config_dir>/harness/sessions/` 根下的 `*.jsonl`，读首行 `session_open.vault_root` → 规范化后与 `<config_dir>/vault-registry/*.json` 的 `path` 匹配 → `rename` 到 `sessions/<vault 稳定 id>/`（目标目录按需创建）
- [ ] 2.2 兜底归 `_orphaned/`：`vault_root` 不可解析 / 注册表无该项 / 目标已有同名文件 / 首行不可读或非 `session_open` → 移入 `sessions/_orphaned/`；只 rename，MUST NOT 删除或改写任何文件
- [ ] 2.3 幂等与自报：重复执行零搬运；单文件失败留原地并在脚本输出里自报，重跑收敛；跑完 `sessions/` 根下零 `*.jsonl`（失败留原地者除外）
- [ ] 2.4 脚本测试：归位正确性（任意 `session_open` 首行 → 预期位置，含需规范化拼写 / 注册表缺失 / 相对路径 / 畸形首行）、文件字节不变、二次运行零搬运（幂等）
- [ ] 2.5 反向验证（REVIEW.md 第 1 条）：故意写错归属映射 / 去掉规范化一步，断言必红

## 3. 产品侧测试

> 归位脚本本身的测试在第 2 组；本组只覆盖产品运行时的布局与范围（不含任何迁移路径）。

- [ ] 3.1 `src-tauri/tests/session_recording.rs` 换代：路径断言到 `<vault 稳定 id>/`；新增「两个 vault 的会话互不可见（列举范围）」与「恢复 / 删除在 id 目录内命中」；断言产品路径不含旧布局读取（`sessions/` 根下的 `*.jsonl` 不参与列举 / 恢复 / 删除）
- [ ] 3.2 门禁：`scripts/gate.sh quick` 全绿（报告照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

## 4. 真机验收

- [ ] 4.1 21 个场景共 70 处 `env:harness` 引用逐处核对（实测：64 处 `sessions/*.jsonl` file 断言 glob + 6 处 `sessions` 目录形态）；glob 改为 `<vault 稳定 id>/` 层级
- [ ] 4.2 新增场景：两个 vault 各落各目录 + 会话浮层只见其一（真实 WKWebView 判定，mock provider，fixture 全合成）
- [ ] 4.3 新增场景：**跑一次性脚本后**归位 + 不可归属进 `_orphaned/`（预置平铺文件与一个畸形文件 → 手动执行脚本 → 断言归位、根下零 `*.jsonl`、孤儿桶内容在场；触发是脚本执行，不再是启动）
- [ ] 4.4 文档与实跑：`scripts/acceptance/README.md:193-195` 与 `scripts/acceptance/lib/app.mjs:144-148` 的路径文档改准；真机跑 105 / 106 / 108 与 4.2 / 4.3 的新场景，证据落 `test-results/`（git 外）

## 5. 排依赖核对

- [ ] 5.1 `harness-composer-image-paste` 若在 harness 侧落附件字节：核对其落点是否采用同一 vault 目录层级（proposal「排依赖」）；若那边先落地并在 `sessions/` 根下留了非会话文件，核对一次性脚本不受影响（脚本只处理根下 `*.jsonl`）

## 6. 归档核对

- [ ] 6.1 `openspec/specs/harness/spec.md` 的 `Purpose` 段（`:13`）路径表述改准——delta 机制改不到 `Purpose`，属归档时手工项（见 `specs/harness/spec.md` 的起草注记）
- [ ] 6.2 spec 增量（MODIFIED 会话本地留存）与实现逐条对账：语义一致的才归档；有静默扩 scope 的停下重走节点 1
