# ADR 生命周期流程

状态生命周期、模板骨架与索引维护约定的本体在 [docs/adr/README.md](../adr/README.md)，本文不重复。这里只补充评审操作与 CI 校验口径。

## Alex 的评审节点

ADR 只有一个评审节点：**`proposed` → `accepted`**。

评审时看：

1. Context 中的事实性断言是否成立（agent 起草时已附信源）。
2. Decision 条目是否与既有 ADR 冲突；冲突时是否以 supersede 方式处理，而不是静默违背。
3. Revisit 条件是否具体、可触发（"形势变了再说"不算 revisit 条件）。

通过动作：将状态字段改为 `accepted`，并同步更新 `docs/adr/README.md` 索引表中的状态列。不通过：批注退回，ADR 保持 `proposed`。

## AI agent 的操作指令

- 起草新 ADR：复制 `docs/adr/README.md` 的模板骨架，编号取当前最大编号 +1，文件名 `NNNN-kebab-case-title.md`，初始状态 `proposed`。
- 同 PR 内必须更新 `docs/adr/README.md` 索引表（新增行或更新状态列），CI 会校验索引与文件的一致性。
- 变更既有决策：不修改已 accepted 的 ADR 正文，新增一份 supersede 它的 ADR，并把旧 ADR 状态改为 `superseded by ADR-NNNN`。
- 状态字段合法值：`proposed` / `accepted` / `deprecated` / `superseded by ADR-NNNN`（CI 硬校验）。

## CI 校验口径

`.github/workflows/docs-check.yml` 对每份 ADR 校验：标题格式（`# ADR NNNN: 标题`）、必需头字段（状态/日期/角色）、状态值合法、日期为 `YYYY-MM-DD`、必备章节（Context / Decision / Consequences / Revisit 条件）齐全，以及 README 索引与实际文件一一对应。
