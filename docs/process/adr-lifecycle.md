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
- 状态字段合法值：`proposed` / `accepted` / `deprecated` / `deferred` / `superseded by ADR-NNNN`（CI 硬校验；`deferred` 的语义与注解格式见下节）。

## `deferred`（搁置）的语义与注解格式

`deferred` 的语义是**搁置，非放弃**：决策本身未被推翻，只是其实现前提当前不生效（ADR 0006 对 ADR 0001 §1/§2 与 ADR 0005 的处置即此状态）。它与 `deprecated`（废弃）不同层次——`docs/adr/README.md` 的「状态生命周期」把两者并列，MUST NOT 互换（把搁置写成废弃会误导重启时的判断）。

状态行写法（2026-09-17 与 M153 协调定稿，CI 强制）：

- 形如 `- 状态: deferred（注解）`——**注解紧随状态 token、用全角括号包裹**，内容自由；惯例是「自何时起 + 缘由 + 由哪份 ADR 触发」（见 ADR 0005：`deferred（2026-09-12 起，见 ADR 0006；实现前提延后，本文档保留为重启输入）`）。
- `deferred` **必须带注解**：裸 `deferred` 答不出「搁置到什么时候、因为什么」，与这个状态本身要求可重启判据的性质自相矛盾；CI 对「token 合法」与「deferred 必带注解」两条分别校验。
- 状态为 `deferred` 的 ADR MUST 保留 `## Revisit 条件` 一节——该节是所有 ADR 的必备章节，对 deferred 尤为关键：它是重启这件事的准入判据。

## CI 校验口径

`.github/workflows/docs-check.yml`（M153 起把正则收敛到 `scripts/docs-check.sh`，判据只有一份）对每份 ADR 校验：标题格式（`# ADR NNNN: 标题`）、必需头字段（状态/日期/角色）、状态值合法（合法值集合为 `proposed` / `accepted` / `deprecated` / `deferred` / `superseded by ADR-NNNN`，其中 `deferred` 须带全角括号注解）、日期为 `YYYY-MM-DD`、必备章节（Context / Decision / Consequences / Revisit 条件）齐全，以及 README 索引与实际文件一一对应。
