# Proposal: IME oracle 的确定性构造（settle 时钟 + state 树陈旧前提）

- Change ID: `fix-ime-settle-oracle-nov27`
- 日期: 2026-11-27（2026-11-28 追加 358 用例）
- 角色: Alex Lee（要求安排处理 / 评审），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 已明确要求安排处理「Tab 修复被既有 IME 门禁阻塞」的问题；2026-11-27 又要求
> 处理 code 满 pane 合并后 `editing-oracle.spec.ts:358` 的 visual 红。本 change 只修测试
> oracle，不改产品行为；根因与证据见 `design.md` 与 `.local/reviews/ime-oracle-stability-nov27/`。

## Why

两处失败同属 `tests/visual/scenes/editing-oracle.spec.ts` 的**时序型 oracle**，但判据不同，
必须分开修，不能互相套用前科。

### A. 1143：4s 低频恢复的 20ms 壁钟窗口

「IME 组合结束越过 4s 截止后仍低频恢复 marker 且不重复」在完整 visual 中反复失败
（最近两次 14/15，`[webkit-realua]`），报错都是「4s 后 MUST 转 250ms 低频恢复」。单用例
`--repeat-each=20` 在 webkit-realua 下 4/20 失败（`01-webkit-repeat20.log`）。

根因是 oracle 的前提不成立：用例在 `compositionend` 后固定等 20ms 再推进假时钟，假设
`beginSettle` 已捕获 `settleStarted`。实际 `scheduleCompositionSettle` 要等 pending
MutationRecord 与 `compositionStarted` 归位，最长 25×8ms；WebKit 下 `beginSettle` 可能
晚于 20ms，`settleStarted` 落在假时钟之后，`elapsed` 永远到不了 4000ms。另一形态是
1.2MB 文档在推进后的下一拍已被后台解析覆盖，settle 正常收束，同样不需要 250ms 重试。

探针样本（`02-webkit-repeat20-instrumented.log`）：失败时 `endAt=539`、`advanceAt=559`、
`settleStarted=549`，settle 链只排过 0ms 与 16ms 两拍；链在第三拍收束，`settleTo=null`。

### B. 358：state 树陈旧前提与后台 parse worker 竞态

「正文 IME：available 但 state 树陈旧时先同步再 build」在 master `2de2f4ef` 的 CI visual
run `46024536448` 首跑与 retry 双红，断言是
`editing-oracle.spec.ts:386 expect(probe.stateNodes).not.toContain("BulletList")`。
CI 的 received string 是**整篇 2000 段 + 末尾 BulletList**，说明 state 树已经是当前新树。

根因同样是 oracle 前提不成立，不是产品回归：

- 用例用 12KB 文档（`"para\n\n".repeat(2000) + "词汇\n- "`），在 dispatch 候选前有
  `openBody` / `setBodyCaret` / marker 等待。后台 parse worker 在这个窗口内即可把整篇
  解析到末尾（探针：open 后 0ms `treeLen=3000`，100ms 后 `treeLen=12005`）。
- 此时 `view.dispatch` 的 `LanguageState.apply` 走 `context.treeLen == startState.doc.length`
  分支（`upto=undefined`），在 20ms 预算内同步解析整篇新文档，state 树当场变成当前树，
  `stateNodes` 自然含 `BulletList`。
- 父提交 `3f20855c` 的临时 worktree 用同一探针复跑，读数逐项相同（`PRE-100 treeLen=12005`、
  `DISPATCH stateNodesHasList=true`，`22-parent-3f20855c-358-probe.log`）；合并 diff 的 md
  分支（`src/editor.ts` 的 `mode === "md"` 模板）逐字符未变。故本次 code 满 pane 合并不是
  成因，CI 只是撞上了 pre-existing 竞态窗口。
- 更关键的是：即使某次运行在 dispatch 后观察到 state 陈旧，compositionend 的 effect
  transaction 也会在 `LanguageState.apply` 里把 state 树同步成 context 树（context 已 done
  时 `work` 走 `isDone → takeTree`）。也就是说，原用例在「通过」时也**没有真正验证
  settle 首拍用的是哪棵树**——386 只检查了一个转瞬即逝的 setup 条件，属 REVIEW.md
  「假绿」形态。

`render-link.spec.ts:66:3` 在同轮 CI 只是首跑 `session closed`、retry 通过，属通道/浏览器
断连抖动，不构成阻塞，也不在本 change 的修复面内。

## What Changes

- **1143**：把假时钟推进从「固定 20ms 壁钟等待后推进」改为确定性触发：`beginSettle` 先记
  `settleStarted`、再排 0ms 首拍；在该首拍被调度时（回调执行前）推进 5000ms。断言只统计
  settle 链自己排的定时器（回调源码含 `settleStep`），仍要求出现 250ms。
- **358**：不再观察「dispatch 后 state 仍陈旧」这个竞态条件。改为在 compositionend 的
  settle 首拍被调度时、回调执行前，把当前 `LanguageState.tree` 显式置回 dispatch 前的旧树，
  构造产品要防的「context 已到行末、state 快照陈旧」形态；并记录 settle 首拍 `build` 所用
  的树，断言第一次 build 已含 `BulletList`（即用的是 context 树，不是 state 快照）。
- 保留两条用例原有的 marker 恢复、单 marker（不重复）、glyph、行文本断言；不删除判据
  来换绿。

## Non-goals

- 不修改产品 settle 状态机、`ListLayout`、`LanguageState` 或语法解析路径；不改
  `lowFreqAfterMs`（4s）/ `lowFreqRetryMs`（250ms）等常量。
- 不把 `editing-oracle.spec.ts` 第 1045 行的 `settleSliceMaxMs < 60` 本地预算并入本 change：
  既有 A/B（`.local/reviews/end-marker-all-docs-nov27/evidence/ab-settle-oracle.md`）已证明
  它在干净 master 上同样越界（37/40），是独立的负载敏感性能预算。
- 不处理 `render-link` 的会话断连抖动（环境/通道，retry 已过）。
- 不放宽阈值、不更新视觉基线、不新增依赖、不改变 WebKit 与 Chromium 的 project 覆盖。

## Impact

- 影响的 specs：无（纯测试基础设施；`.openspec.yaml` 声明 `skip_specs: true`）。
- 影响的代码/系统：`tests/visual/scenes/editing-oracle.spec.ts` 的两条 oracle 用例。
- 关联约束：REVIEW.md「断言等价于子串，没有区分度」「假绿」「重试」条；新断言反向必红实测。

## 节点 2：归档记录

**放行方式**：机器 + 独立评审放行（`docs/process/openspec-workflow.md`「节点 2」五要件）。

### 五要件（归档前）

1. **方案已批准**：Alex 2026-11-27 要求处理「Tab 修复被既有 IME 门禁阻塞」；2026-11-28 要求处理
   code 满 pane 合并后的 358 visual 红。实现期无 scope 扩张：只改
   `tests/visual/scenes/editing-oracle.spec.ts`，`src/**` 相对基线零 diff。
2. **独立 reviewer clean / merge**：K3 终审 **clean/merge**，绑定
   `aa36bc272b1825943741c21530ab7be1bfb66aba`，P1 / P2 / P3 均为 0；评审文件
   `.local/reviews/ime-oracle-stability-nov27/independent-review.md`。评审独立复验了双引擎
   目标用例各 5 次、Chromium 与 WebKit 产品变异体、`tests/visual` tsc 与 change validate。
3. **tasks 完成 / 放弃理由**：20/21 勾选；唯一未勾的 4.1「merge / push」按本批禁令留主会话
   串行执行，tasks 已就地注明（这是执行分工，不是实现缺口）。实现、双引擎复跑、反向必红、
   完整 visual、quick、validate 各项均已完成。
4. **要求的门禁与真机证据**：
   - **machine PASS**：exact tip `aa36bc27` 的最终完整 `scripts/gate.sh visual` 原文
     **`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0**；visual-regression 1382s /
     1984 passed / 0 failed / 13 skipped；358 在 chromium #73、webkit-realua #1765，
     1143（358 改写后行号移至 1197）在 chromium #94、webkit-realua #1786 均绿
     （`.local/reviews/ime-oracle-stability-nov27/37-gate-visual-final.log`、
     `38-gate-visual-regression-final.log`）。
   - rebase 后整份 `editing-oracle.spec.ts`：chromium 66 passed、webkit-realua 56 passed /
     10 skipped（`27`/`28`）；`scripts/gate.sh quick` `GATE RESULT: 13/13 PASS（SKIP 0）`、
     退出码 0（`29`）。
   - **native PASS**：不适用——本 change 只改 Playwright 测试 oracle，无新增真机判定面。
5. **规格对账无丢段**：`.openspec.yaml` 为 `skip_specs: true`，无 specs delta；归档前
   `node scripts/openspec-archive-check.mjs` 门禁模式 PASS，`validate --all --strict`
   39 passed / 0 failed；归档跟踪队列有且仅有一条条目（`docs/backlog.md`）。

### 五态

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | `aa36bc27`（实现两个提交：`2734ad01` 1143、`aa36bc27` 358；基于 `d356a0f78`） |
| released | 不适用 | 测试基础设施，不随版本发布 |
| machine PASS | 是 | `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；visual-regression 1382s / 1984 passed / 0 failed / 13 skipped（`37`/`38`）；quick 13/13 exit 0（`29`） |
| native PASS | 不适用 | 无真机判定面（纯测试 oracle） |
| archived | 是 | 归档提交 `d8e56cc9`；`--archived` PASS（无 specs 增量，无需对账；`42-archived-audit.log`、`46-postarchive-audit.log`） |

反向必红与恢复绿读数（同一证据目录）：1143 的全局「4s 后 cancel」产品变异体 5/5 红
（`06-webkit-mutant-global-cancel-at-4s.log`，`Received array: [0]`）；回退并重建后
webkit 20/20、chromium 20/20 绿（`07`/`08`）；旧 20ms 窗口 oracle 4/20 红
（`01-webkit-repeat20.log`）。358 的产品变异体（available 分支用 `syntaxTree(view.state)`
替代 `ensureSyntaxTree`）3/3 红在「settle 首拍 build 必须用已到行末的 context 树」
（`17-chromium-358-product-mutant.log`）；oracle 变异体 A（不安装 hook）红在
`__forcedStale.done`（`18`），B（不置旧树）红在「settle 首拍前 state 树 MUST 陈旧」（`19`）；
候选双引擎各 20/20 绿（`20`/`21`）。

### 归档后追加

- 归档目录：`openspec/changes/archive/2026-11-28-fix-ime-settle-oracle-nov27/`
- 归档提交：`d8e56cc9`
- 包装器输出：`Change 'fix-ime-settle-oracle-nov27' archived as '2026-11-28-fix-ime-settle-oracle-nov27'.`；
  归档后修链 0 处（扫过 3 篇 Markdown / 0 条相对链接）；`openspec-links: PASS`（716 条相对链接全部可达）。
  归档时 tasks 18/19（4.1 merge / push 留主会话），CLI 以 `--yes` 继续。
- `--archived` 审计读数：**PASS**（`openspec-archive-check: PASS（openspec/changes/archive/2026-11-28-fix-ime-settle-oracle-nov27 没有 specs/ 增量，无需对账）`，退出码 0；`42-archived-audit.log`）
