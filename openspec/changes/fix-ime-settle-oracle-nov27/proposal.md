# Proposal: IME settle oracle 的确定性时钟触发

- Change ID: `fix-ime-settle-oracle-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（要求安排处理 / 评审），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 已明确要求安排处理「Tab 修复被既有 IME 门禁阻塞」的问题。本 change 只修测试
> oracle，不改产品行为；根因与证据见 `design.md` 与 `.local/reviews/ime-oracle-stability-nov27/`。

## Why

`tests/visual/scenes/editing-oracle.spec.ts` 的「IME 组合结束越过 4s 截止后仍低频恢复 marker
且不重复」用例（第 1143 行起）在完整 visual 中反复失败：最近两次完整门禁均为 14/15，失败项
都是这一条，项目为 `[webkit-realua]`，报错都是「4s 后 MUST 转 250ms 低频恢复」且收到的延迟
序列里没有 250。隔离复跑多数通过，但单用例 `--repeat-each=20` 在 webkit-realua 下实测
4/20 失败，签名与完整门禁一致（证据 `01-webkit-repeat20.log`）。

失败类型是**测试 oracle 缺陷**，不是产品缺陷、也不是环境 INVALID：

- 用例在 `compositionend` 后固定等 20ms 壁钟再推进假时钟，假设 `beginSettle` 已执行并捕获
  `settleStarted`。实际 `scheduleCompositionSettle` 要等 pending MutationRecord 与
  `compositionStarted` 归位，最多重试 25×8ms；WebKit 下 `beginSettle` 可能晚于 20ms，
  此时 `settleStarted` 落在假时钟推进之后，`elapsed` 永远到不了 4000ms，250ms 低频分支
  本来就不该被调度。
- 即使 `beginSettle` 及时，1.2MB 文档的后台解析也可能在推进后的下一拍就覆盖提交行，
  settle 正常收束，同样不需要 250ms 重试。是否出现 250 取决于解析进度，不是确定性判据。

探针样本（`02-webkit-repeat20-instrumented.log`）：失败时 `endAt=539`、`advanceAt=559`、
`settleStarted=549`，settle 链只排过 0ms 与 16ms 两拍；链在第三拍收束，`settleTo=null`。

## What Changes

- 把假时钟推进从「固定 20ms 壁钟等待后推进」改为确定性触发：`beginSettle` 先记
  `settleStarted`、再排 0ms 首拍；在该首拍被调度时（回调执行前）推进 5000ms。
- 断言只统计 settle 链自己排的定时器（回调源码含 `settleStep`），仍要求出现 250ms；
  「4s 后转 250ms 低频恢复」的区分度不变。
- 保留原有的 marker 恢复、单 marker（不重复）、glyph 断言，不删除任何断言。

## Non-goals

- 不修改产品 settle 状态机，不改 `lowFreqAfterMs`（4s）/ `lowFreqRetryMs`（250ms）等常量。
- 不把 `editing-oracle.spec.ts` 第 1045 行的 `settleSliceMaxMs < 60` 本地预算并入本 change：
  既有 A/B（`.local/reviews/end-marker-all-docs-nov27/evidence/ab-settle-oracle.md`）已证明
  它在干净 master 上同样越界（37/40），是独立的负载敏感性能预算，与本次调度时序机制无关。
- 不放宽阈值、不更新视觉基线、不新增依赖、不改变 WebKit 与 Chromium 的 project 覆盖。

## Impact

- 影响的 specs：无（纯测试基础设施；`.openspec.yaml` 声明 `skip_specs: true`）。
- 影响的代码/系统：`tests/visual/scenes/editing-oracle.spec.ts` 单条用例的时钟 mock 与延迟断言。
- 关联约束：REVIEW.md「断言等价于子串，没有区分度」「重试」条；新断言反向必红实测。

## 节点 2：归档记录（实现完成后填写）

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | 本 worktree 分支提交（merge / push 按本批禁令留 tower） |
| released | 不适用 | 测试基础设施，不随版本发布 |
| machine PASS | 是 | `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；visual-regression 1404s / 1978 passed / 0 failed / 13 skipped；1143 在 chromium #88、webkit-realua #1780 均绿（`.local/reviews/ime-oracle-stability-nov27/11-gate-visual-full.log`、`12-gate-visual-regression-full.log`） |
| native PASS | 不适用 | 无真机判定面（visual oracle 单测） |
| archived | 否 | 待归档 |

反向必红与恢复绿读数（同一证据目录）：全局「4s 后 cancel」产品变异体 5/5 红
（`06-webkit-mutant-global-cancel-at-4s.log`，`Received array: [0]`）；回退并重建后
webkit 20/20、chromium 20/20 绿（`07`/`08`）；旧 20ms 窗口 oracle 4/20 红
（`01-webkit-repeat20.log`）。
