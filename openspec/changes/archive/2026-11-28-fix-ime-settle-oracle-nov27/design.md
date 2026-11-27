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

## 6. 358：state 树陈旧前提与后台 parse worker 的竞态（2026-11-28 追加）

### 6.1 现场

CI run `46024536448`（master `2de2f4ef`）在 `[chromium]` 首跑与 retry 双红于
`editing-oracle.spec.ts:386 expect(probe.stateNodes).not.toContain("BulletList")`。
Received string 是整篇 2000 个 `Paragraph` 加末尾
`BulletList(ListItem(ListMark,Paragraph))`——不是局部树，说明 state 字段树已经是当前新树。

### 6.2 机制

用例的 12KB 文档在 `openBody` / `setBodyCaret` / marker 等待窗口内就能被后台 parse
worker 解析到末尾。探针读数（`14-chromium-358-probe.log`）：

| 时刻 | viewport | treeLen | state 树 |
|---|---|---|---|
| open 后 0ms | 0–142（顶部） | 3000 | 仅初始化视口 |
| open 后 100ms | 0–142（顶部） | 12005（= docLen） | 已到末尾 |

此后 `view.dispatch` 触发 `LanguageState.apply`：

```
upto = this.context.treeLen == tr.startState.doc.length ? undefined : ...
if (!newCx.work(20, upto)) newCx.takeTree()
```

`treeLen == docLen` ⇒ `upto=undefined` ⇒ 20ms 内解析整篇新文档 ⇒ `takeTree()` 把 state
树同步成含 `BulletList` 的新树。测试在同一个同步块里读 `lang.tree`，因此必然读到新树。
CI 的整篇 received string 与这条路径逐项吻合。

父提交 `3f20855c` 的临时 worktree 用同一探针复跑，`PRE-100 treeLen=12005`、
`DISPATCH stateNodesHasList=true` 完全相同（`22-parent-3f20855c-358-probe.log`）；
合并 diff 中 `src/editor.ts` 的 md 模板逐字符未变（只有 code 模式 `gridTemplateColumns`
与 `main.ts` 的阅读手柄可见性变化）。**结论：pre-existing oracle 竞态，不是本次合并回归。**

### 6.3 为什么原断言是假绿

即使某次运行在 dispatch 后读到陈旧树，compositionend 的 effect transaction 也会触发
`LanguageState.apply`：context 已 done 时 `work` 走 `isDone → takeTree`，新 state 的
`tree` 直接等于 context 树。`settleStep` 在 timer 里读的是**这个新 state**，所以
「state 陈旧」从来不是 settle 首拍的真实输入；386 只检查了一个转瞬即逝的 setup 条件。
这与 test 393 的注释（“compositionend 的 effect dispatch / parse worker 在 Chromium 上
会顺带同步 state，无法稳定复现 WKWebView 的 stale 快照”）互相印证。

### 6.4 修法

在 compositionend 的 settle 首拍被调度时（`beginSettle` 已排 0ms `settleStep`、回调尚未
执行），把当前 `LanguageState.tree` 显式置回 dispatch 前的旧树，并记录：

1. `forced.done`：hook 确实命中；
2. `forced.hasList` / `installedLen`：置回的是不含 `BulletList` 的旧树；
3. 包装插件的 `build`，记录 settle 期间每次 build 时 `plugin.tree` 是否含 `BulletList`；
   断言**第一次** build 已含（即用的是 `ensureSyntaxTree` 的 context 树，不是 state 快照）。

这样既构造了产品要防的形态，又让「用哪棵树」成为可判据，而不是观察竞态。

### 6.5 反向必红

- **产品变异体**：`settleStep` available 分支把 `ensureSyntaxTree(view.state, to, 0)` 换成
  `syntaxTree(view.state)`，重建 dist → 3/3 红在「settle 首拍 build 必须用已到行末的
  context 树」（`17-chromium-358-product-mutant.log`）。证明新断言能区分错误实现。
- **oracle 变异体 A**：hook 条件恒假 → 红在 `__forcedStale.done` 轮询（`18`）。
- **oracle 变异体 B**：hook 命中但不置旧树 → 红在「settle 首拍前 state 树 MUST 陈旧」（`19`）。
- 恢复后双引擎各 20/20 绿（`20`/`21`），整份 spec chromium 66 passed、webkit 56 passed /
  10 skipped（`23`/`24`）。

### 6.6 被否决的方案

- **再等久一点**：只是把竞态窗口推远，CI 的 parse worker 完成时间没有上界。
- **加大文档**：仍受 parse worker 与 20ms apply 预算两个变量影响；且 context done 后
  effect transaction 会把 state 树同步成 context 树，stale 在 settle 时不可达。
- **删掉 386 断言**：丢掉「state 陈旧」这一覆盖前提，违反 REVIEW.md「假绿」条。
- **改产品**：产品路径（`ensureSyntaxTree` context 树）在 CI 失败样本中行为正确；无产品缺陷。
