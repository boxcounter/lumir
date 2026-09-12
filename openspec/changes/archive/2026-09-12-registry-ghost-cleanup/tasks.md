# Tasks: registry-ghost-cleanup

## 1. 注册表失效项惰性归档治理

- [x] 1.1 注册项持久化结构扩展 `missing_since` / `archived_at`（serde 默认值 + `Option` 缺省不落盘；ts-rs `skip` 保持 webview 契约与 `src/bindings/` 不变）
- [x] 1.2 `workspaces.rs` 实现 `sweep_registry`：路径有效清标记、失效首次记账、失效超宽限期归档（标记而非删除）；只在状态跃迁时写盘
- [x] 1.3 枚举/打开链路接入治理：`remap_candidates` 与 `reconcile_vault` 顺带治理（best-effort，失败不拦打开）
- [x] 1.4 `remap_candidates` 过滤归档项；`vault_register` / `vault_remap` 落盘即复位治理标记

## 2. ghost tmp 磁盘治理

- [x] 2.1 `fs_io.rs` 抽出 tmp 模式判定 `is_lumir_tmp`（忽略集与清除共用同一模式）
- [x] 2.2 枚举路径惰性清除超龄 ghost tmp（年龄阈值常量；只删普通文件、符号链接与合法点文件不动、失败静默）
- [x] 2.3 年龄判定可注入 `now`（测试不需要改 mtime 的工具/新依赖）

## 3. 回归用例

- [x] 3.1 失效未超宽限期：仍是 remap 候选且已记 `missing_since`
- [x] 3.2 存量形态注册项（只有 id / path）仍可解析：向后兼容与首次记账同时成立
- [x] 3.3 幽灵项超宽限期：被归档、不再出现在 `remap_candidates`、`remap_gate` 不再拦路、重复治理收敛（幂等）
- [x] 3.4 正常注册项不受治理影响（文件逐字节不变、无治理字段）
- [x] 3.5 归档项路径恢复：同一 id 复位（`reconcile_vault` 不新建注册项）
- [x] 3.6 fs_io：超龄 ghost tmp（根与嵌套）被清除、合法点文件留存
- [x] 3.7 fs_io：未超龄 tmp（在途保存）不被清除

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `cargo test --manifest-path src-tauri/Cargo.toml` 全绿（基线 69 → 76，新增 7）
- [x] 4.3 `cargo clippy --all-targets -- -D warnings` 干净
- [x] 4.4 改动文件 `rustfmt --check` 干净
