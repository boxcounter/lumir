# Tasks: trim-ignore-default-names

## 1. 默认地图

- [x] 1.1 `src-tauri/src/config.rs` 的 `DEFAULT_IGNORE` 删除 `test-results` 与 `perf-results` 两个 Lazy 条目，数组长度 16 → 14；文档注释同步为 14 名 / 12 lazy，并写明两名移出的依据（Alex 2026-10-18）
- [x] 1.2 `config.rs` 的默认地图不变量测试（原 `default_ignore_map_partitions_the_legacy_sixteen_names`）改为 14 名逐项对账、`map.len()` / `DEFAULT_IGNORE.len()` 为 14、lazy 计数为 12，并把两名加进「不在内置默认里」的断言组
- [x] 1.3 `src-tauri/src/fs_io.rs` 的 `default_ignore_tiers_match_names_at_any_depth_and_keep_tmp_patterns_hidden`：两名从「在 lazy 档」名单移入「MUST NOT 命中」名单；两处「14 名」注释改 12 名

## 2. living spec 与文档面同步

- [x] 2.1 `openspec/specs/fs-io/spec.md`「全类型递归枚举」：默认地图清单删两名；「已知边界」补一句本仓产物名不再列入；`忽略集生效` / `默认配置等效于今日行为` 两条 scenario 按 14 名 / 12 lazy 改准
- [x] 2.2 `openspec/specs/file-tree/spec.md`「全类型文件树展示」：默认 lazy 名数 14 → 12，并写明名单 MUST NOT 在树侧硬编码
- [x] 2.3 `docs/specs/config-reference.md` §1.4 的默认地图表与「16 名」改准
- [x] 2.4 `openspec/specs/fs-io/spec.md`「watch 增量事件流」的 `惰性条目的事件不改索引` scenario：示例名 `test-results/` 换成一个仍在默认表里的名字（该 scenario 只是举例，语义未变；本项只动举例名，不构成 requirement 的语义变更，故不进本 change 的 spec 增量）

## 3. 验收面回扫

- [x] 3.1 `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`：第三个惰性档探针从 `test-results` 换成 `.cache`（fixture 的 `ignoredDirs`、AX 断言、场景说明三处同步），并在注释里写明换名缘由
- [x] 3.2 `scripts/acceptance/lib/app.mjs` 的 `ignoredDirs` 注释同步换名
- [x] 3.3 `node scripts/acceptance/run.mjs --check` 通过（静态校验：场景格式与引用）

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `scripts/gate.sh quick` 全绿（含 `cargo test` 里 `config.rs` / `fs_io.rs` 的默认地图测试）
- [x] 4.3 全仓回扫 `test-results` / `perf-results`：活引用（code / scripts / docs / living spec / 活跃 change）清零；历史证据文档里的旧指针按 `.local/README.md` 的对照表保留不改
