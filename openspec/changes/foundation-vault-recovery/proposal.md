# Proposal: 建立 document save 崩溃恢复与结果收敛合同

- Change ID: foundation-vault-recovery
- 日期: 2026-09-07
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

现有 Foundation vault consistency 约束已要求 per-path compare-and-swap（CAS）与 `operation_id` 幂等，但没有把 atomic replace、父目录同步和结果记录之间的断电窗口分别定义为唯一可恢复状态。尤其 rename 已完成而 parent directory 尚未 fsync 时，文件是否在重启后可见无法由应用安全推断，若报告 success 会造成静默丢失或重复覆盖。M83 的文件切换事务设计不解决 document save 的这一独立问题；M83 未合入，本 change 不依赖其文件。

本 change 为保存建立最小、可实现的 durable intent、fsync 顺序、崩溃阶段矩阵、查询/重试收敛和清理隔离合同。其错误码与 M79 的稳定 CommandError 原则一致，并明确承接 M83 未合入设计的边界：不复用 vault 切换 journal，也不改变 vault generation。

## What Changes

- 新增 `vault-recovery` capability，定义每个 path 的 CAS 保存临界区和固定 fsync 序列。
- 定义 intent durable 前后、replace 前后、parent fsync 前后、result durable 前后的唯一恢复结果：`not-written`、`success` 或 `unknown`。
- 规定 rename/replace 完成但 parent directory fsync 未完成时只能为 `unknown`，不得报告 success 或转换为普通 conflict。
- 规定启动恢复、同 `operation_id` 查询与重试的收敛规则，禁止未知结果使用新 operation id 重放。
- 统一 `document_write_unknown` 错误码，并规定 intent 的过期、清理和后续 operation 隔离。
- 在 `docs/specs/vault-recovery.md` 提供实现边界和与 M79、M83（未合入）文档的链接关系。

## Non-goals

- 不实现 Rust、TypeScript、UI、watcher 或真实 vault 行为。
- 不定义 vault 切换事务、vault generation、文件树或 Markdown 解析。
- 不保证 rename 后、parent fsync 前的跨平台可见性；该窗口只能暴露 unknown。
- 不允许通过新 `operation_id` 绕过 unknown、CAS 冲突、权限错误或 intent 过期。
- 不改变 M79 已归档的 Markdown 质量合同，也不复制或修改 M83 change 文件。

## Impact

- 影响的 specs：新增 `vault-recovery`。
- 影响的代码/系统：未来 document save backend 的 durable intent、atomic replace、result record 与恢复入口；本 change 本身不改产品代码。
- 关联约束：M79 Foundation Markdown 的本地文件质量边界；M83 文件切换事务设计（未合入，仅作边界引用）；现有 `vault-consistency` 中 document session 的 CAS/revision 语义。
