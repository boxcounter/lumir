# Design: document save recovery

## 边界与记录

本合同只覆盖单个 vault 内单个规范化相对 path 的 `document_save`。后端 MUST 将 path 映射到 vault 内安全目标，并以 `(vault_id, normalized_path)` 作为 per-path 锁/CAS key。不同 path 可并行；同一 path 的 compare、intent、replace、目录同步、结果记录不可交错。`operation_id` 在该 vault/path 命名空间内唯一，且请求参数（expected revision、document revision、内容指纹）必须与首次请求一致；参数不一致是协议错误，不得执行写入。

Intent durable record 至少包含 `operation_id`、vault/path 身份、`expected_file_revision`、`expected_document_revision`、`new_file_revision`、`content_fingerprint`、phase 和创建时间。`phase` MUST 是枚举 `prepared`、`replace_inflight`、`replaced`、`parent_synced`、`result_durable`、`expired` 之一，禁止自由文本。正常 phase 只能按 `prepared → replace_inflight → replaced → parent_synced → result_durable` 前进，禁止回退或跳过 durable transition；任一未决 phase 仅在 retention 到期后才能 durable 转为终态 `expired`。磁盘 intent 中的 phase 是恢复判定依据。`replace_inflight` 是不可重试哨兵：replace 调用前先 durable 写入该 phase，因此重启时无法证明 replace 是否开始也必须返回 unknown，禁止再次 replace。Intent/result 均 MUST 只写入受保护的应用数据目录，不写入 vault 文档目录；每次 record 更新使用临时文件写入、文件 fsync、rename、父目录 fsync。实现必须能区分“没有本 operation 的 intent”与“intent 损坏/无法读取”，后者为 unknown。

`new_file_revision` MUST 是目标文件内容的加密 fingerprint（例如 SHA-256），而不是依赖写入文件的隐藏元数据；后端从目标普通文件字节重新计算即可验证 revision。revision ledger 是 operation 的 durable 状态记录，entry 至少包含 operation_id、path、expected revision、new fingerprint、reservation 状态和 content fingerprint，并以文件 fsync、rename、父目录 fsync durable。reservation 在 intent durable 前若崩溃，启动恢复必须将其标为 `released`（不得产生新的 ledger entry）；同 operation 重试必须复用原 fingerprint/revision，并重新建立同一 reservation/intent，不得重新分配。parent fsync 成功后 ledger 才能按 `reserved → committed` durable 推进；确定 not-written 或过期后只能按 `reserved → released` durable 推进，fingerprint 永不复用为其他 operation 的 revision。

现有 vault 文件模型 MUST 保持不变：`path.md` 仍是普通 Markdown 文件，保存使用同目录临时普通文件写入后 fsync，再以单次 rename 替换原文件。不得把 operation、revision 或 fingerprint 写入 Markdown 正文，也不得引入 container、sidecar、迁移或改变读取/watch/备份路径。revision 与目标文件的可验证绑定由“目标文件完整字节 fingerprint == ledger/intent 的 new fingerprint”建立；仅在目标 parent directory fsync 已成功后，才可将此绑定用于恢复 success。

## 固定保存序列

同一 per-path 临界区内执行：

1. 查询已存在的 operation result；存在则原样返回，不触碰目标文件。
2. 查询该 operation 的 intent；存在则先按恢复矩阵收敛，禁止直接重放。
3. 读取当前 file revision 并校验 `expected_file_revision`。不匹配只在没有本 operation 写入痕迹时返回 `document_conflict`。
4. 预留 ledger entry（`reserved`），写出同目录临时普通文件并 fsync。
5. 写 intent phase=`prepared` 并完成 intent 文件 fsync、rename、intent 父目录 fsync。此点后 intent 为 durable。
6. 在调用 rename 前，推进 phase=`replace_inflight` 并完成该 phase 的 intent 文件 fsync、rename、intent 父目录 fsync。此哨兵 durable 后才允许调用 rename；因此崩溃恢复不得再次调用 rename。
7. 以单次 rename 将临时普通文件替换 `path.md`。rename 返回成功只表示内核调用完成，不表示目录项已 durable；成功后推进 phase=`replaced` 并再次 durable intent。
8. fsync `path.md` 的 parent directory；成功后推进 phase=`parent_synced` 并再次 durable intent。
9. 将 ledger entry 从 `reserved` 推进为 `committed`，完成 ledger 临时文件 fsync、rename、ledger 父目录 fsync；随后写 success result 并完成 result 文件 fsync、rename、result 父目录 fsync；再将 intent 推进 phase=`result_durable` 并 durable。
10. 删除 intent，并以同样的 durable record 删除序列 fsync 父目录。若 ledger commit durable 前崩溃，即使目标内容匹配也只能 `unknown`；同 id 只查询/补写 ledger commit，不得再次 rename。

所有 backend 错误 MUST 使用统一 `{ code, message, operation_id, reason }` 信封；`reason` 无值时序列化为 `null`。

任何 replace 前失败都不得报告 success。replace/parent fsync/result durable 的错误语义由下表约束。result durable 后返回 success；intent 清理失败不得把已 durable result 变成 unknown，但必须保留可回收 intent 标记并阻止其影响其他 operation。

## 崩溃阶段收敛矩阵

| 崩溃点 | 重启或同 id 查询的唯一结论 | 重试语义 |
|---|---|---|
| intent durable 前（含临时文件 fsync 前） | `not-written`，无 durable operation 结果 | 可用同一 id 继续一次保存；重新检查 CAS，失败则 `document_conflict` |
| intent durable 后、replace 前（phase=`prepared`） | `not-written`，目标仍为 old revision 才可重试 | 同一 id 可继续；若目标不是 old 且无匹配结果，`document_write_unknown` |
| replace 调用前已 durable（phase=`replace_inflight`） | `unknown`，调用结果不可知 | 只可同一 id 查询；不得再次 replace |
| replace 已返回成功、parent fsync 前（phase=`replaced`） | `unknown`，即使目标当前读到新内容也不得报告 success | 只可同一 id 查询；不得再次 replace |
| parent fsync 成功、result durable 前 | 目标内容已 durable；指纹与 new revision 匹配则收敛 `success`，无法确认匹配则 `unknown` | 同一 id 查询或补写 result；不得再次 replace |
| result durable 后（含 intent 清理前后） | `success`，原样返回 result | 任意重复请求只返回原 result，不写入；清理可异步重试 |

“replace 前”只包含 replace 尚未成功调用的状态。调用返回错误时，若无法证明目标仍是 old revision，按 unknown 处理。`rename` 完成但 parent fsync 尚未成功或是否成功无法确认，严格属于 unknown；不得报告 success。

## 恢复、查询与隔离

启动恢复 MUST 先扫描 durable intents/results。对每个 intent 使用 operation_id 精确匹配目标 path 与参数，并按矩阵完成一次收敛。可证明 not-written 的 intent 可标记终结后清理；unknown intent MUST 保留，供同 id 查询，直到显式过期策略触发。恢复不得自动创建新 operation_id，也不得让一个 path 的 unknown intent 阻塞其他 path 或后续 operation；同一路径的新 operation 必须先收到 `document_write_unknown`，由调用方决定查询原 id，不得覆盖或猜测。

过期是运维回收状态，不是写入结论。超过实现定义的 retention window 的未决 intent MUST 被标记 expired 并保留最小 tombstone（operation_id、path、fingerprint、状态、过期时间），再允许后续同 path operation 按新的 CAS 读取决定；过期 operation 的查询/重试统一返回 `document_write_unknown`（reason=expired），不得报告 not-written/success。清理失败只影响回收，不影响后续 operation。后续 operation 绝不能复用 operation_id 或读取旧 intent 当作自己的 intent。

## 实现边界

backend MUST 提供真实 fsync 能力和 fault-injection hooks，分别在 intent durable 前/后、replace 返回前/后、parent fsync 前/后、result durable 前/后暂停或崩溃。测试 MUST 覆盖同 path CAS 竞争、重复请求、unknown 查询/重试、损坏/过期 intent、不同 path 并行和旧 vault token。webview 只能消费统一错误信封 `{ code, message, operation_id, reason }`；`reason` 无值时也必须显式为 `null`，不得通过 message 推断状态。产品 UI、后台 watcher、vault 切换和 Markdown parser 均不在此合同内。
