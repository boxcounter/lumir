# Design: fix-draft-vault-ownership-nov19

## 1. 现场与机制

复现（M844，`tests/unit/persistence-adversarial.test.ts` 的 `knownDefect` 用例；作用域模型与真实
后端一致：put 的落点在放行时才解析）：

1. vault-a 编辑触发防抖写，`harness_draft_put` 已入链但执行被挂住；
2. 后端切到 vault-b，`vault_open_path` 完成，面板 `load()` 丢弃旧待写并读 B 的草稿；
3. 放行旧写 → 按**执行时**的当前 scope 落到 vault-b。

代码锚点（改动前）：`src-tauri/src/harness/draft.rs` 的 `current_vault_id(&VaultState)` 在命令体
内取当前 scope；`src/ipc.ts` 的两个封装不带参数；`src/harness-draft.ts` 的 deps 只有
`getDraft()` / `putDraft(json)`。

## 2. 合同：归属在出发时绑定

- **归属** = vault 稳定 id（`VaultInfo.vault_id` / `OpenVault.vault_id`，与会话留存、阅读位置同一
  份身份）。
- **出发点**：内容产生 / 装载的那一刻。前端 store 在 `load(vaultId)` 时绑定；写 / 清除在把载荷
  交给后端之前捕获当时的绑定值。
- **落点解析**：后端只按载荷里的 id 解析，不读当前 scope。这样迟到写无论何时执行都只落旧
  vault。

### D1 选择「按 id 解析」而不是「id ≠ 当前 vault 即拒绝」

拒绝会让旧 vault 的草稿**丢失**（用户没发出去的字），而按 id 写回旧 vault 是**正确归属**：
用户下次打开 vault-a 时草稿还在。拒绝只适合「归属未知」的情形，而这里的归属是明确的。
代价是允许对**已关闭**的 vault 写草稿文件——这正是迟到写的形态，故后端只做 id **形状**校验
（`jsonl::vault_dir_name`），不查注册表；「注册表里没有」与「vault 已关闭」在草稿落点上不可区分。

### D2 选择「面板持有 id」，不在 IPC 层做缓存

备选方案是在 `src/ipc.ts` 维护「当前 vault id」缓存，draft 命令在调用时打标。否决理由：

- `vault_open_path` / `vault_current` 解析完成到面板 `vaultChanged` 之间仍有窗口，期间产生的
  旧内容会被打上新 id（同一类错误的缩小版）；
- 任何新增的 vault 切换路径忘了更新缓存就静默串台，且没有任何门禁能发现——这是 REVIEW.md
  「同一语义两处真源」条的形态。

面板的 id 与根路径同源（`applyVault(root, entries, vault_id)` → `vaultChanged(root, vaultId)`），
只此一份。

### D3 绑定在 `load`，捕获在写 / 清除的出发点

- `load(vaultId)` 同时完成「丢弃旧待写」与「绑定归属」，两者是同一个语义事件（装载新 vault）；
- `flush()` 在把待写交给串行链**之前**捕获 `boundVaultId`，入链后在途期间切换 vault 不改这次写
  的目的地；
- `clear()` 在调用时捕获（发送成功后清的是这份内容所属的 vault）；
- v1 迁移写回同样带装载时的 id（它也是一条写路径）；
- 写失败回填 `pending` 仍受 `epoch` / `editGeneration` 守卫——切换装载会让在途旧失败不回填新
  vault 的待写、不改新 vault 的 `written` 基准。

## 3. 不变量（回归判据）

- **I1** 迟到旧写只落旧 vault 的文件，新 vault 的草稿逐字节不变；
- **I2** 迟到旧读结果作废（`loadGen`），不覆盖新 vault 的输入区与 `written` 基准；
- **I3** 写失败重试仍打出发时的归属 id，成功后才更新该 vault；
- **I4** 切换装载丢弃旧 pending（既有纪律：由切换前 flush 写走），旧写在途失败不得回填新
  pending、不得污染新 `written` 基准；
- **I5** 清除只删自己那份；
- **I6** `null` 归属（无 vault）读写静默 no-op，不落任何 vault 的文件。

## 4. 验证

- 前端确定性回归 `tests/unit/draft-vault-ownership.test.ts`（9 例，覆盖 I1–I6）；
- 反向验证（mutant）：把 `putDraft` 的归属参数去掉 → 6 例红；把读的归属参数去掉 → 5 例红；
- Rust 集成测试 `src-tauri/tests/harness_draft_vault.rs`（迟到写 / 迟到读 / 同 vault 往返 /
  清除范围 / 无 vault / 非法 id 不得越界）；
- `tsc --noEmit`、目标 Node 单测、目标 `cargo test`；完整门禁与真机由 tower 排期。

## 5. 边界（明确不改）

- 发送回执与切 vault 交叠时，`clear()` 按**调用时**的绑定删除（既有窗口，见 proposal Non-goals）；
- 后端不保证「id 属于已注册 vault」，只保证形状合法与不越出草稿目录；
- 草稿路径布局与会话留存同族，不随本 change 变化。
