# Design: IME settle oracle 的确定性时钟触发

## 1. 被测状态机（`src/preview/lists.ts`）

组合结束到 marker 恢复由两段异步链组成：

1. **入口链**：`compositionend` → `scheduleCompositionSettle`（`src/composition-settle.ts`）。
   首拍 0ms，之后每 8ms 重试，直到 `observer.pendingRecords().length === 0` 且
   `view.compositionStarted === false`；最多 200 / 25 次。满足后 dispatch
   `compositionSettled` effect。
2. **恢复链**：`ListLayout.update` 收到 effect → `beginSettle` 记录
   `settleStarted = performance.now()` 与目标行末，排 0ms `settleStep`。之后每拍：
   - `syntaxTreeAvailable` 为假：每拍推进 8KB（越过 4s 后 64KB），重试间隔
     16ms → 1s 后 100ms → 4s 后 250ms；
   - 覆盖目标后按树判定收束（`publishSettled`）或继续重试；
   - 4s 后**不取消目标**，只是降频到 250ms。

产品行为在失败样本中是正确的：marker 仍恢复、无重复、入口有界。失败只发生在测试对
「哪一拍开始计时」的假设上。

## 2. 两种候选根因与区分方法

| 假设 | 预测 | 探针读数 | 结论 |
|---|---|---|---|
| 产品 4s 后取消（真回归） | marker 不恢复或恢复不经过 settle 链；250 永不出现 | marker 恢复；`settleStarted` 已设置；链以 0/16ms 收束 | 否 |
| oracle 时钟窗口错位 | `settleStarted` 晚于假时钟推进；`elapsed` 恒小于 4s | 失败样本 `advanceAt=559`、`settleStarted=549`（及时）但链在推进后 1 拍内收束 | 是（两个子形态） |

进一步拆成两个独立机制：

- **M1 起点错位**：`beginSettle` 晚于 20ms 壁钟。此时 `settleStarted` 已含 +5000ms，
  `elapsed ≈ 0`，链只会排 16ms 重试直到解析完成。
- **M2 解析提前完成**：起点及时，但推进后的下一拍 `syntaxTreeAvailable` 已为真、
  目标行判定为 list，链直接 `publishSettled`，不进入任何重试分支。

两者都说明「20ms 后一定还在 deadline 分支」不是不变量，测试不能据此要求 250。

## 3. 修法：在首拍调度时推进假时钟

`beginSettle` 的顺序是固定的：先 `settleStarted = performance.now()`，再
`setTimeout(() => this.settleStep(view), 0)`。测试在 `setTimeout` 包装器里识别
「delay === 0 且回调源码含 `settleStep`」的定时器，在返回真实 timer 之前把 offset
加 5000ms。这样：

- `settleStarted` 一定用旧时钟捕获；
- 首拍 `settleStep` 执行时 `elapsed > 4000`，进入低频判定；
- 1.2MB 文档在首拍不可能覆盖目标（首拍只推进 64KB），因此必然排 250ms 重试；
- 不再依赖任何壁钟等待，也不依赖 `beginSettle` 在 20ms 内完成。

只统计 settle 链自己的定时器（同一源码判据）作为断言输入，避免别处出现的 250ms 定时器
把断言带绿；当前 `src` 只有 `lowFreqRetryMs` 一处 250ms，但判据不依赖这一点。

## 4. 反向必红

- **产品变异体**：在 `settleStep` 顶部加「elapsed ≥ 4s 即 `cancelSettle()` 并返回」，
  重建 dist 后跑 5 次：5/5 红，`Received array: [0]`（只有首拍，无任何重试）。
  回退变异体并重建后 20/20 绿。证明 250 断言确实观察产品行为，不是空转。
- **旧 oracle**：保留旧的 20ms 等待版本，`--repeat-each=20` 在 webkit-realua 下
  4/20 红、加探针后 17/20 红（探针本身改变时序）。证明修法针对的是真实失败模式。

## 5. 被否决的方案

- **把 250 改成别的值 / 删除断言**：掩盖状态迁移，REVIEW.md 禁止。
- **固定等更久（如 200ms）再推进**：只是把竞态窗口推远；`scheduleCompositionSettle`
  的上界本就是 25×8ms，且慢机器没有上界保证。
- **让产品在 beginSettle 时记录一个测试可读的「已开始」标志，再由测试推进**：需要为测试
  改产品接口；包装 `setTimeout` 已能在不改产品的前提下拿到同一顺序保证。
- **放宽到「只要 marker 恢复」**：失去「4s 后不取消、转 250ms」的唯一判据。
- **同时改 1045 的 60ms 预算**：独立机制（settle 回调墙钟切片），既有 A/B 证明干净
  master 也越界；本 change 不扩面。
