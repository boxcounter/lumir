# Tasks: rg-zip-flags-dangerous-oct24

> 节点 1 已由 Alex 批准立项（2026-10-24 原话「好，可以。」）；实现与提案同批提交（小型变更）。
> 勾选口径：每条以本轮实际跑过的命令输出为准（不用「写完即算」）。

## 1. 判据落地

- [x] 1.1 `RG_EXEC_FLAGS` 增补 `--search-zip`；`-z` 的短旗标簇扫描（遇到 rg 的取值短旗标即停）接入 `rg_exec_form`
- [x] 1.2 单测 `exec_forms_are_dangerous` 增补 `rg -z` / `rg --search-zip` / 簇形态 `-zH`·`-nz`
- [x] 1.3 单测 `wrapper_recursion_inherits_new_forms`：`bash -lc "rg -z …"` 与 `xargs rg --search-zip …` 继承为危险；`bash -lc "rg --no-search-zip …"` 仍只读
- [x] 1.4 决策层矩阵 `new_write_and_exec_forms_across_permission_modes`：`-z` / `--search-zip` 在三档模式 + allow 规则 + 会话缓存下全判 Ask
- [x] 1.5 反向单测：裸 `rg needle .` / `rg --pretty` / `rg --no-search-zip` / `rg -ez` 仍只读
- [x] 1.6 区分度验证：临时禁用短形态扫描 → `["rg","-z",…]` 判红（`left: ReadOnly` / `right: Dangerous`）；临时摘掉 `--search-zip` → `["rg","--search-zip",…]` 判红；两次均已恢复并复跑绿

## 2. 规格

- [x] 2.1 spec delta 的「只读分类的能力断言」枚举段与「白名单成员的可执行形态归危险」Scenario 加入 `-z` / `--search-zip`（与 `--pre` 同档）

## 3. 验证

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（gate 的 `openspec-validate` PASS）
- [x] 3.2 `node scripts/openspec-archive-check.mjs --change rg-zip-flags-dangerous-oct24` PASS（1 条 MODIFIED / 对比 17 段，无静默丢段）
- [x] 3.3 `scripts/gate.sh quick` 全绿：`GATE RESULT: 10/10 PASS（SKIP 1）`（退出码 0；SKIP 为 `tsc-visual`——`tests/visual` 依赖未装）
- [x] 3.4 `cargo test` 逐 target：839 + 7 + 41 + 2 + 17 + 6 + 22 pass，0 failed（共享 `CARGO_TARGET_DIR` 下 lib 测试二进制 mtime `10:15:01` 晚于最后一次源码改动 `10:14:55`）
