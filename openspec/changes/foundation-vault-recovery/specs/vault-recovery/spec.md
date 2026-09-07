# Vault recovery Specification

## ADDED Requirements

### Requirement: document save MUST use per-path durable CAS

`document_save` SHALL 以 `(vault_id, normalized_path)` 为独立 CAS 命名空间。读取 expected revision、intent/result 查询、replace 与 file revision 分配 MUST 在同一 per-path 互斥临界区内完成；不同 path 不得被无关 intent 阻塞。`new_file_revision` MUST 来自 durable revision ledger reservation；intent 前崩溃时 reservation 标为 released，同 operation 重试复用原 revision，不得产生第二 ledger entry。正文和 operation/revision/fingerprint 元数据 MUST 位于同一 atomic document container，不得把元数据写入 Markdown 正文，也不得使用独立 sidecar。container 内文件分别 fsync 后才能执行单次 container replace，再 fsync 目标 parent directory；ledger、intent、container metadata 不一致不得判定 success。保存序列 MUST 依次完成 ledger durable、container 内容与 metadata fsync、intent phase durable、atomic container replace、目标父目录 fsync、result durable。任何 durable record 更新不得只依赖内存或 flush。

#### Scenario: 同 path CAS 只允许一个写者

- **WHEN** O1 与 O2 对同一 `(vault_id, path)` 携带同一 `expected_file_revision` 并发保存
- **THEN** 只有一个 operation 完成 replace 并记录 success，另一个返回 `document_conflict`，且不得覆盖先者

#### Scenario: 不同 path 不互相阻塞

- **WHEN** path A 有未决 unknown intent，path B 提交合法 save
- **THEN** B 按自身 CAS 独立处理，不等待、读取或清理 A 的 intent

#### Scenario: container 原子绑定正文与元数据

- **WHEN** O1 准备保存 Markdown 正文及其 operation_id、new revision、fingerprint 元数据
- **THEN** 正文保持原始 Markdown 字节并与元数据写入同一临时 container，分别 fsync 后只执行一次 container replace；不得修改正文或先后替换独立 sidecar

#### Scenario: container 元数据不一致

- **WHEN** parent fsync 已成功但恢复读取到的 container metadata 与 ledger 或 intent 不一致
- **THEN** 返回 `document_write_unknown`，不补写 result，不再次 replace，且保留 intent 供同 operation_id 查询

### Requirement: 每个崩溃阶段 MUST 收敛到唯一结果

系统 SHALL 只使用 `not-written`、`success`、`unknown` 三种恢复结论。intent phase MUST 枚举为 `prepared`、`replace_inflight`、`replaced`、`parent_synced`、`result_durable`、`expired`；正常 phase 只能按 `prepared → replace_inflight → replaced → parent_synced → result_durable` 推进，`expired` 只能由 retention 到期的未决 phase 进入，并且每次推进均 MUST 通过临时记录 fsync、rename、父目录 fsync 后才生效。intent durable 前崩溃 SHALL 收敛为 `not-written`；phase=`prepared` 且 replace 尚未开始 SHALL 在目标仍为 old revision 时收敛为 `not-written`，否则为 `document_write_unknown`；phase=`replace_inflight` 表示 replace 调用前已 durable 记录但调用结果不可知，重启/同 id retry SHALL 始终为 `unknown` 且不得再次 replace；phase=`replaced` 代表 replace 已完成但 parent directory fsync 尚未成功，重启/同 id retry SHALL 始终为 `unknown` 且不得再次 replace；phase=`parent_synced` 且 result 尚未 durable 时，只有 revision ledger、intent 与目标文件绑定元数据一致才可补写 result 并收敛 success；phase=`result_durable` SHALL 永久收敛 success。

#### Scenario: intent durable 前崩溃

- **WHEN** O1 在 intent 文件 durable 之前崩溃，且 ledger reservation 已 durable
- **THEN** 恢复返回 `not-written`，将该 reservation 标为 `released`；同 id 重试复用原 `new_file_revision`，不得新增 ledger entry，不返回 success 或 `document_write_unknown`

#### Scenario: intent durable 后 replace 前崩溃

- **WHEN** O1 的 intent 已 durable，但 replace 尚未成功
- **THEN** 目标仍为 old revision 时返回 `not-written` 并允许同 id 重试；目标状态无法证明为 old 时返回 `document_write_unknown`，不得使用新 id

#### Scenario: replace 调用前哨兵阻止重复 replace

- **WHEN** O1 已将 phase=`replace_inflight` durable，但 replace 调用前或调用返回前崩溃
- **THEN** 恢复与同 id retry 均返回 `document_write_unknown`，且 replace 次数保持不变，不得再次调用 replace

#### Scenario: replace 后 parent fsync 前崩溃

- **WHEN** replace/rename 已返回成功，但目标 parent directory fsync 尚未成功或其结果未知
- **THEN** 唯一结论为 `document_write_unknown`，即使当前读取到 new 内容也不得报告 success

#### Scenario: parent fsync 后 result durable 前崩溃

- **WHEN** 目标 parent directory fsync 已成功，但 result record 尚未 durable
- **THEN** 指纹和 new file revision 匹配时补写 result 并返回 success；不能确认匹配时返回 `document_write_unknown`，不得再次 replace

#### Scenario: result durable 后重复请求

- **WHEN** O1 result 已 durable，客户端再次查询或提交相同 operation_id
- **THEN** 原样返回 success，不执行第二次 replace；intent 清理失败也不得改变 success

### Requirement: unknown MUST use one error code and isolate lifecycle

所有无法证明 `not-written` 或 `success` 的 save 结果 SHALL 返回统一错误信封 `{ code: "document_write_unknown", message, operation_id, reason }`，其中 `reason` 无值时也必须为 `null`。客户端 MUST 使用原 operation_id 查询或重试，MUST NOT 创建新 operation_id 重放。intent 过期 SHALL 返回同一 `document_write_unknown`，并携带可区分的机器可读 reason；过期/清理失败不得阻塞其他 path 或后续 operation。过期记录至少保留 tombstone，避免 operation_id 被复用。

#### Scenario: unknown 只能原 id 收敛

- **WHEN** O1 返回 `document_write_unknown`，客户端以新 operation_id O2 提交相同内容
- **THEN** O2 被拒绝，不执行写入；客户端必须查询/重试 O1

#### Scenario: 过期 intent 不伪造结论

- **WHEN** O1 intent 超过 retention window 且尚未能证明写入结果
- **THEN** O1 查询或重试返回 `document_write_unknown`（reason=expired），保留 tombstone，并允许不相关后续 operation 继续按 CAS 处理

#### Scenario: 损坏 intent 不被误当冲突

- **WHEN** durable intent 存在但无法解析，或其 path/参数与请求不匹配
- **THEN** 返回 `document_write_unknown`，不返回 `document_conflict`，不清理该 intent，不执行 replace

### Requirement: recovery implementation boundary MUST be testable

backend SHALL 暴露或内部支持 fault injection，覆盖 intent durable 前后、replace 前后、parent directory fsync 前后、result durable 前后的崩溃点。启动恢复与同 operation_id 查询 MUST 使用相同收敛逻辑；webview MUST 仅按结构化 code/reason 分支。该 capability 不包含 vault 切换、generation、watcher、Markdown parser 或 UI。

#### Scenario: 启动恢复与同 id 查询一致

- **WHEN** 同一个 durable intent 分别通过进程启动恢复或同 operation_id 查询
- **THEN** 两条路径给出相同唯一结论，并且不会增加 replace 次数
