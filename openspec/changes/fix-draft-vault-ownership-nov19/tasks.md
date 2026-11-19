# Tasks: fix-draft-vault-ownership-nov19

## 1. 后端（落点只按显式 id 解析）

- [x] 1.1 `harness_draft_get(vault_id)` / `harness_draft_put(vault_id, draft_json)` 收显式归属；落点只按传入 id 解析，删除 `current_vault_id`（不再读 `VaultState`）
- [x] 1.2 `lib.rs` 注册注释同步（归属由调用方绑定，不读当前 scope）
- [x] 1.3 模块头写清归属合同与「不按 id ≠ 当前 vault 拒绝」的理由（拒绝会丢用户没发出去的字）
- [x] 1.4 新增 `src-tauri/tests/harness_draft_vault.rs`：迟到写 / 迟到读 / 同 vault 往返 / 清除范围 / 无 vault / 非法 id 不越界

## 2. 前端（出发时绑定）

- [x] 2.1 `src/ipc.ts`：`harnessDraftGet(vault_id)` / `harnessDraftPut(vault_id, draft_json)`
- [x] 2.2 `src/harness-draft.ts`：store 在 `load(vaultId)` 绑定归属；`flush` / `clear` / v1 迁移写在出发点捕获 id，失败重试仍打同一 id
- [x] 2.3 `src/harness-panel.ts`：持有 `currentVaultId`，`vaultChanged(root, vaultId)` 同源切换，`restoreDraft` 走 `draft.load(currentVaultId)`
- [x] 2.4 `src/main.ts`：`applyVault` 记录 `loadedVaultId` 并传 `vaultChanged(root, vaultId)`；cron 重载路径补 `vaultChanged("", null)` / `vaultChanged(payload.vault, loadedVaultId)`

## 3. 确定性回归

- [x] 3.1 `tests/unit/draft-vault-ownership.test.ts`：旧写晚于切 vault、旧读晚到、失败重试、旧失败不污染新 pending/written、切装载丢弃旧待写、清除按归属、v1 迁移写带 id、无 vault
- [x] 3.2 mutant 反向验证：去掉写的归属参数 → 6 例红；去掉读的归属参数 → 5 例红（断言有区分度）

## 4. 规格

- [x] 4.1 `specs/harness/spec.md` MODIFIED「composer 草稿 v2 与一次性 v1 转换」：整条复制 + 归属段 + 三条交错场景

## 5. 验证

- [x] 5.1 目标 Node 单测：`tests/unit/draft-vault-ownership.test.ts` + `tests/unit/harness-draft.test.ts` 全绿
- [x] 5.2 `tsc --noEmit` 通过
- [x] 5.3 全量前端单测（`node tests/unit/run.mjs`，1527 例全绿）
- [ ] 5.4 `cargo test`（目标用例；独立 `CARGO_TARGET_DIR`，cargo 锁由 tower 排期）
- [ ] 5.5 最终 `gate.sh quick`（tower 排期）
- [ ] 5.6 `openspec validate --all --strict` 通过
