# Vault recovery 实现合同

本文件是 `foundation-vault-recovery` change 的实现边界摘要。它只描述单文件保存崩溃后的结果收敛，不是产品代码或真实 vault 操作说明。

## 依赖与边界

- M79 Foundation Markdown 已归档的质量合同见 [`docs/specs/foundation-markdown.md`](foundation-markdown.md)；本合同不改变 Markdown 解析、渲染或编辑行为。
- M83 `VaultBoundary83` 的 change 未合入。其文件切换事务与 vault generation 设计不作为本合同的实现依赖；本合同不复用 M83 的 vault journal，也不改变 vault 切换状态。
- 既有 vault consistency 设计中的 `document_save` CAS、`file_revision`、`document_revision` 与 `operation_id` 是相邻约束；本文件只补足 durable save 的崩溃窗口。

## 唯一保存序列

后端以 `(vault_id, normalized_path)` 建立 per-path 临界区。临界区内先查询 result/intent，再校验 expected file revision。`new_file_revision` 先在 durable revision ledger 中预留；ledger reservation 在 intent durable 前崩溃时标为 `released`，同 operation 重试复用原 revision，不生成第二 entry。正文和 operation/revision/fingerprint 元数据位于同一 atomic document container，原始 Markdown 保持为 container 内不透明 `content.md`，元数据位于独立 `metadata` 文件，不写入正文，也不采用独立 sidecar。合法请求按以下顺序执行：分别写入并 fsync container 内 content.md 与 metadata；fsync container 目录；将 intent 设为 phase=`prepared`，完成 intent 临时文件 fsync、rename、intent 父目录 fsync；在调用 container atomic replace 前将 phase durable 推进为 `replace_inflight`，再执行单次 container replace；replace 返回成功后将 phase durable 推进为 `replaced`；目标 parent directory fsync 成功后将 phase durable 推进为 `parent_synced`；result 临时文件 fsync、rename、result 父目录 fsync 后推进为 `result_durable`；最后 durable 清理 intent。phase 只能按 `prepared → replace_inflight → replaced → parent_synced → result_durable` 前进。不同 path 可并行。intent、result 和 revision ledger 写在应用数据目录，container 不把元数据暴露为 Markdown 正文。

`operation_id` 绑定 path、expected revisions 和 content fingerprint。重复 id 原样返回既有结果。参数不一致不得被视为新保存。

## 崩溃结果矩阵

| 阶段 | 唯一恢复结果 | 同 id 行为 |
|---|---|---|
| intent durable 前 | `not-written`；ledger reservation 标为 `released` | 同 id 重试复用原 revision；CAS 失败返回 `document_conflict` |
| intent durable 后、replace 前（phase=`prepared`） | old revision 仍可证明时 `not-written`，否则 `unknown` | 仅原 id 继续；不得新 id 重放 |
| replace 调用前已 durable（phase=`replace_inflight`） | `unknown` | 只能查询原 id；不得再次 replace |
| replace 已返回成功、parent fsync 前（phase=`replaced`） | `unknown` | 只能查询原 id；不得报告 success 或再次 replace |
| parent fsync 后、result durable 前（phase=`parent_synced`） | ledger、intent 与目标元数据一致则 `success`，否则 `unknown` | 补写 result，不得再次 replace |
| result durable 后 | `success` | 永久返回原 result；intent 清理失败不改变结论 |

其中 `unknown` 对外唯一错误码为 `document_write_unknown`。rename 已返回成功但 parent directory fsync 尚未成功或结果不确定时，必须保持 unknown，即使一次读取恰好观察到新内容。

## Intent 生命周期与隔离

启动恢复和同 id 查询必须走同一收敛判定。可证明未写入的 intent 可终结并 durable 清理。无法证明的 intent 只能以原 id 查询/重试，直到 retention window 到期。过期不是写入结论；系统须保留包含 id、path、fingerprint、状态和过期时间的 tombstone，并对该 id 继续返回 `document_write_unknown`（reason `expired`）。损坏、参数不匹配或清理失败的 intent 不得被当作普通 `document_conflict`。

清理和过期回收是后台维护动作。一个 path 的未决 intent 不得阻塞其他 path。新 operation 不得复用旧 id，不得读取旧 intent 冒充自己的 intent；同一路径在 unknown 未解决时不得覆盖，必须先由原 id 收敛。

## 实现与验证边界

未来 backend 实现必须支持故障注入点：intent durable 前/后、replace 调用前/后、parent directory fsync 前/后、result durable 前/后。验证至少覆盖同 path CAS 竞争、不同 path 隔离、重复/错误参数 id、损坏与过期 intent、启动恢复与同 id 查询一致性。webview 只消费结构化 `{ code, message, operation_id, reason }`，不得解析 message。此 change 不要求也不包含 Rust、TypeScript、UI、watcher、vault 切换或 parser 代码。
