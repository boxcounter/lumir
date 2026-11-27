# Proposal: <一句话说明这个 change 做什么>

- Change ID: <kebab-case-id>
- 日期: YYYY-MM-DD
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

<为什么需要这个变更：动机、背景、关联的 ADR 条目。事实性断言附信源。>

## What Changes

<改什么：新增/修改/移除哪些 capability 行为。逐条列出，每条对应 specs/ 增量中的一个 requirement。>

## Non-goals

<明确不做什么：防止实现期静默扩 scope，也给 Alex 一个拒绝面。>

## Impact

- 影响的 specs：<capability 列表>
- 影响的代码/系统：<概述，不写实现细节>
- 关联约束：<触及的 ADR 条目，如性能合同、铁律>

## 节点 2：归档记录（实现完成后填写）

口径见 `docs/process/openspec-workflow.md`「状态分列」与「失败与 finding 归类」；
五要件与归档后强制完成步骤照 workflow 正文逐条填写。

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 / 否 | 〔commit hash；已合并写 merge hash〕 |
| released | 是 / 否 / 不适用 | 〔版本号 + release index；本批不打包写原因〕 |
| machine PASS | 是 / 否 / 不适用 | 〔GATE RESULT 原文行 + 退出码；或命令 + 计数 + 日志〕 |
| native PASS | 是 / 否 / 不适用 | 〔场景 id + .local/acceptance/... 的 status.txt；无真机项写原因〕 |
| archived | 是 / 否 | 〔归档提交 hash + --archived PASS 读数；归档前写「否：待归档」〕 |

未发生项写「否」/「不适用」+ 原因，不留空；失败项按四类归因，不混算。

本表只覆盖五态；workflow「归档记录要求」的两段仍须写进本节：归档前列五要件事实与指针，
归档后列归档提交 hash、包装器输出、修链读数与 `--archived` 读数。只填表不等于完成归档记录。
