# Tasks: save-hardening

## 1. 崩溃备份（后端 recovery.rs + 前端恢复入口）

- [x] 1.1 新增 `src-tauri/src/recovery.rs`：备份写 / 读 / 删 / 枚举，定位 `<config_dir>/recovery/<vault-key>/<path-key>`（vault 根 sha256 前 16 位 + 相对路径百分号编码为单层文件名），含路径合法性校验与单元测试
- [x] 1.2 `commands.rs` 注册 `recovery_backup` / `recovery_load` / `recovery_discard` / `recovery_list`，`lib.rs` 加入 invoke handler
- [x] 1.3 前端 dirty 内容在 debounce 到期仍未落盘时写备份；保存成功（手动 / 自动 / 强制覆盖 / 另存）清除备份
- [x] 1.4 vault 装载后枚举残留备份并逐个给出 sticky 提示（「恢复内容」/「丢弃备份」）；恢复内容进编辑器缓冲并保持未保存，走保存链路落盘

## 2. 自动保存

- [x] 2.1 停止输入 2s debounce 后自动保存当前 dirty 文档；每次内容变化重置窗口
- [x] 2.2 自动保存成功后 dirty 清除语义与手动保存一致（masthead、守卫提示、后端 dirty 镜像一并复位）
- [x] 2.3 未解决冲突 / 外部修改待决 / 保存目标已丢失时暂停自动保存，不得重试 CAS；暂停态由成功保存或重新载入清除

## 3. 恢复动作补齐（M121 / M124 reviewer 观察）

- [x] 3.1 强制覆盖保存再冲突时提示升级为带两个动作的 sticky 提示（不再退化为自动消隐的纯文案）
- [x] 3.2 `last_vault` 写失败降级为 warning：打开成功不再被记忆写失败抹成整体错误（含单元测试）
- [x] 3.3 另存为新文件的 `-2..-5` 撞名重试循环补 stub 级覆盖（成功路径 + 全部撞名后的人工出口）

## 4. main.ts 拆分

- [x] 4.1 新增 `src/save-controller.ts`：保存 / 冲突恢复 / 外部修改处置 / 自动保存 / 崩溃备份的状态与决策集中于此
- [x] 4.2 新增 `src/save-ipc.ts`：`recovery_*` 的 invoke 薄封装（临时；折叠回 ipc.ts 的后续项已报 tower）
- [x] 4.3 `src/main.ts` 收敛为装配层，行为零变化

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `pnpm build` 通过（含 `tsc --noEmit`）
- [x] 5.3 `cargo test`（src-tauri）通过，含 recovery 模块用例与 `last_vault` 降级用例；`cargo clippy -D warnings` 与 `cargo fmt --check` 通过
- [x] 5.4 `LUMIR_VISUAL_PORT=<空闲端口> scripts/visual/run.sh` 视觉全绿：153 passed = 既有 142 + 新增 save-hardening 11（自动保存落盘与 debounce 重置、冲突/外部修改暂停、备份生命周期、启动恢复/丢弃/多份提示、另存重试成功与用尽、强制覆盖再冲突带动作）。mission 指定的 4273 被并行 worktree 占用，改用空闲端口 4287，口径不变
