# Tasks: vault-patch-hidden-deny-oct24

> 节点 1 已由 Alex 点头立项（原话「安排」，2026-10-24）；提案与实现同一批次提交（小型变更）。
> 勾选状态与证据口径：每条完成的判定以本轮实际跑过的命令输出为准（不用「写完即算」）。

## 1. `hidden` 档判定落到既有条目

- [x] 1.1 `fs_io::IgnorePolicy::validate_not_hidden`：唯一一份路径级判定，复用 `hidden_hit`（同一匹配器 + 同一 `vault.ignore` 地图），命中返回 `fs_name_invalid`
- [x] 1.2 `fs_patch_file` 增加 `policy` 参数：resolve 之后、读内容之前拒绝 `hidden` 目标（含任一祖先段）
- [x] 1.3 `fs_move_entry` 的源与目标路径（含目标父段）拒绝 `hidden`；`rename_entry` 的源同款
- [x] 1.4 `trash_entry` 增加 `policy` 参数并拒绝 `hidden` 目标；同步调用点（`harness/tools.rs` 的 `vault_patch` / `vault_delete`、`commands.rs` 的 `fs_trash_entry`）
- [x] 1.5 同类面审计：逐个核对 agent 可触达的写入口，确认无第二个同类洞，结论与证据写进完成报告
  - `vault_create` → `vault_create_file` → `ensure_parent_dirs` 逐段判 `hidden`（+ 末段名过 `validate_new_name`）
  - `document_save` / `create_file_entry` / `create_dir_entry`：只由前端文件树驱动，而 `hidden` 条目在树里没有行（不可达）
- [x] 1.6 单测：`hidden` 既有文件 patch → `fs_name_invalid` 且逐字节不变、revision 不变；普通既有文件不受影响；move（源 / 目标父段）、rename 源、delete 同款；把名字配成可见后恢复可用（判定随策略，非硬编码名单）

## 2. 验证

- [x] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`Totals: 44 passed, 0 failed`）；`node scripts/openspec-archive-check.mjs` PASS（26 条 MODIFIED / 348 段无静默丢段）
- [x] 2.2 `cargo test` 全绿（811 + 41 + 22 + 17 + 7 + 6 + 2 pass，0 failed；共享 `CARGO_TARGET_DIR` 下已核对测试二进制 mtime 晚于本轮最后一次源码改动——按 `docs/backlog.md`「批次内 target 纪律」）
- [x] 2.3 `scripts/gate.sh quick` 全绿：`GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0；共享 `CARGO_TARGET_DIR` 下 cargo 门禁复用同一份增量）
