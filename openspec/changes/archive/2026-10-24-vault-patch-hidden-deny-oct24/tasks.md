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

## 3. r1 评审处置（2026-10-24，verdict `p1-1items` / fix-then-merge）

- [x] 3.1 **P1-1 大小写折叠**：`hidden` 档多编一份**大小写不敏感**匹配器（同一名字清单、同一个
  `compile_matcher`，只换匹配语义），写入口的 `validate_not_hidden` / `validate_new_name` /
  `ensure_parent_dirs` 全改用它；分类 / 枚举仍用大小写敏感那份（`vault.ignore` 的既有边界）。
  单测 `hidden_gate_is_case_insensitive_for_write_paths`：`.GIT/config` patch 拒绝且逐字节不变、
  `.GIT` trash 拒绝且 `.git` 仍在、`.GIT` 新建末段名 / 父段拒绝。
- [x] 3.2 **P2-1 canonical 真身**：`validate_not_hidden` 增加第二判据——把 `resolve_in_vault` 的
  canonical 折回 vault 相对路径再判一次（`vault_relative_of` + 共用的 `hidden_write_target`），
  patch / move 源与目标 / rename 源 / delete 全覆盖。单测 `hidden_gate_follows_in_vault_symlinks`：
  `doc-link.md` → `.git/config` 的 patch 拒绝、`repo-link` → `.git` 的 delete 拒绝且真 `.git` 仍在、
  穿 symlink 新建被既有 `is_dir()` 守卫拒（`fs_path_invalid`）且没写进 `.git/`。
- [x] 3.3 spec delta 与 proposal 同步写清「按文件系统身份判定」（大小写不敏感 + canonical 真身，
  并注明枚举分类口径不变），新增 4 个 Scenario。
