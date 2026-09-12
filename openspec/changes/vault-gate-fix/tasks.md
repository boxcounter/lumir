# Tasks: vault-gate-fix

## 1. 打开链路：已注册路径直接打开

- [x] 1.1 `workspaces.rs` 抽出只读注册查询（canonicalized 路径比对，无注册 side effect），供 remap 门判定与 `reconcile_vault` 共用
- [x] 1.2 `workspaces.rs` 新增 remap 门判定：目标已注册或无失效注册项时返回 None；仅目标未注册且存在失效注册项时返回候选
- [x] 1.3 `commands.rs` `open_vault` 改为先过 remap 门判定：门不拦（已注册或无候选）才继续 reconcile + watch + 枚举

## 2. last_vault 仅实际打开成功写入

- [x] 2.1 `commands.rs` `vault_open` / `vault_open_path` 改为 `remap_candidates` 为空（实际打开成功）才 `write_last_vault`
- [x] 2.2 核对 `lib.rs` `restore_last_vault` 的 remap 候选 notice 分支在新语义下仍正确（启动恢复走同一公共路径，自动受益）

## 3. 注册表写入健壮性

- [x] 3.1 `vault_register` 改为 tmp + rename 原子替换（与 `vault_remap` 写配置同纪律），修正模块头注释
- [x] 3.2 `vault_id` 删除未使用的 `_path` 参数（threads.rs 拆分遗留签名）

## 4. 回归用例

- [x] 4.1 注册表存在幽灵项时，打开已注册 vault 不被 remap 门拦（`remap_gate` 返回 None）
- [x] 4.2 注册表无幽灵项时未注册路径直接打开；有幽灵项时才出现候选

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `cargo test`（src-tauri）全绿
