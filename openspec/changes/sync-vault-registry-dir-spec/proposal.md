# Proposal: living spec 跟配置目录更名——vault 注册表路径 `workspaces/` → `vault-registry/`

- Change ID: sync-vault-registry-dir-spec
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

**一、合同文本落后于已合并的实现（事实性不一致，不是措辞偏好）。** M248 把 vault 注册表目录从
`workspaces/` 改名为 `vault-registry/`，并带启动时一次性迁移（commit `349b1cf`，merge `d989197`）。
真源在 `src-tauri/src/vault_registry.rs:83` 的 `REGISTRY_DIR_NAME = "vault-registry"`，迁移入口是
启动路径上的 `migrate_legacy_registry_dir_at_startup()`（`src-tauri/src/lib.rs:118` 调用，四态语义见
`vault_registry.rs:117-147`）。但 living spec 的合同路径仍写着旧名：

- `openspec/specs/vault-workspace/spec.md:49`：「`~/.config/lumir/workspaces/` 注册表承载 id 到当前
  vault 路径的映射」。

这是 ADR 0004 §2 / `docs/process/openspec-workflow.md` 记过的失效模式原形——**living spec 与实现
直接矛盾**，而且矛盾点落在用户可见文件位置上（排查「我的 vault 列表去哪了」时按 spec 找会找到错误的目录）。

**二、本项由 M248 的裁决覆盖，不是新决策。** `docs/backlog.md:471-489` 的 #37 记录了 Alex 的裁决
（2026-09-26：「**改**」——他不采纳 tower「不建议动」的意见）与落地口径四条（改目录名 / 启动时原子
`fs::rename` 迁移 / Rust 模块连带改名 / 验收套件补迁移场景），M248（2026-09-27）已按四条全部落地。
本 change 只做**合同文本追平**：不许新行为、不改代码、不改历史 change 文档。tower 在 M248 的
scope-clarify D 组已把这条登记为卫生批工作项（见本 mission 的 Context）。

**三、迁移这一步在 living spec 里目前零记录。** 更名本身是路径字面，但迁移是**可观测行为**——旧安装首次
启动后 `<config>/lumir/workspaces/` 消失、`vault-registry/` 出现，且注册项不能丢。它已由真机场景
`scripts/acceptance/scenarios/48-vault-registry-migration.md` 与 Rust 侧四态单测钉住
（`src-tauri/src/vault_registry.rs` 的 `mod tests`），但只活在代码与验收里、没进合同。本 change 顺手
把它写进 requirement 与一条 scenario。

## What Changes

对 `vault-workspace` capability 的 **1 条 MODIFIED requirement**（「vault 注册表与显式重映射」）：

1. **路径字面更正**：`~/.config/lumir/workspaces/` → `~/.config/lumir/vault-registry/`。
2. **补写迁移口径**（M248 已实现的行为）：注册表目录的旧名是 `workspaces/`；旧安装由启动路径做一次性
   迁移——同目录同文件系统的**原子 `fs::rename`**，搬的是整个目录（注册项与落盘窗口里残留的
   `.json.tmp` 一并搬走），因此 MUST NOT 丢注册项。四态：旧目录不存在（稳态 / 全新安装）→ 无动作、不记
   日志；旧目录在而新目录不在 → 迁移并记一条诊断事件；新目录已存在 → 不动作；rename 失败 → 旧目录原地
   保留、本次按「注册表为空」运行（best-effort，MUST NOT 拦停启动，下次启动重试）。
3. **新增一条 scenario**「旧注册表目录在启动时迁移」，把上面这条可观测行为钉成判据。

requirement 的其余条款（稳定 id、remap 门、候选排序、原子写、幽灵项治理与宽限期）**逐字不动**——
这是 MODIFIED 全量替换语义下的原样携带，不是重写。

## Non-goals

- **不改代码、不改配置**：本 change 制品只含文档（`proposal.md` / `design.md` / `tasks.md` /
  `specs/vault-workspace/spec.md`）+ living spec 的同步落盘。实现已在 master（`d989197`），MUST NOT
  再动 `src/**` 与 `src-tauri/**`。
- **不改写历史 change 文档**：`multi-vault-workspaces` 等归档 change 里的 `workspaces/` 是当时的现场，
  按 backlog #37 的落定口径「历史文档不改写」保留；`docs/specs/config-reference.md` 已在 M248 改为
  现状描述、不在本 change 面内。
- **不重命名类型与错误码**：`VaultWorkspace` 类型与 `workspace_read|write|path` 错误码经 ts-rs 进
  `src/bindings/`、被前端 import，改名会波及 webview 契约面，backlog #37 已明确「属另一件事」。
- **不动其它 capability**：只有 `vault-workspace` 一条 requirement 涉及该路径字面（全仓 grep
  `workspaces/` 的 living spec 命中仅此一处）。
- **不引入迁移的第二次触发**：迁移只在启动路径发生一次；本 change MUST NOT 增加运行期迁移入口，
  也不为「已迁移」状态新增配置字段。

## Impact

- 影响的 specs：`vault-workspace`（MODIFIED ×1：「vault 注册表与显式重映射」）。
- 影响的代码/系统：**无**。本 change 不产生代码 diff。
- 影响的测试/验收：无新增。既有判据已覆盖本 requirement 的迁移条款——Rust 四态单测
  （`src-tauri/src/vault_registry.rs` 的 `mod tests`）、真机场景
  `scripts/acceptance/scenarios/48-vault-registry-migration.md`、诊断事件 `vault_registry_migrated`
  （`src-tauri/src/logging.rs:99`、`src/bindings/LogEventName.ts`）。
- 归档动作：living spec 与 delta **同批落盘**（见 design §2），因此本 change 的归档节点是一次对账而非
  一次变更——归档后 living spec 逐字节不变（幂等），对账口径见 `tasks.md` §3。
- 关联约束：ADR 0004（AI-only 开发 + 两个 Alex 硬门禁）、ADR 0004 §2（living spec 与实现不得矛盾）、
  `docs/process/openspec-workflow.md`（批次收尾 checklist 对账口径）。

## 裁决记录

**本 change 的节点 1（提案评审）由 M248 的 #37 裁决覆盖。** 改名 + 启动迁移是 Alex 2026-09-26 已裁的
行为（裁决原文与四条落地口径见 `docs/backlog.md:471-489`），实现已合并（`d989197`）；本 change 的
What Changes 与该裁决逐条对应（改目录名 → 路径字面更正；启动时原子 rename 迁移 → 迁移口径条款），
**MUST NOT 被读成一次新的行为决策**。按 tower 在 M250 的裁决口径，本 change 的合并报告随本 mission
向 Alex 报备。

**节点 2（归档评审）不在本 mission 面内**：按 `docs/process/openspec-workflow.md` 的流程，归档评审是
Alex 的第二个硬门禁；本 mission 只落 change 制品 + living spec 同步，归档动作与节点 2 待后续
（合并报告与 review-request 均注明「待 Alex 归档节点」）。
