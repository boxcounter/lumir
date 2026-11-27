# Tasks: fix-ime-settle-oracle-nov27

## 1. 诊断与修复

- [x] 1.1 复现：webkit-realua 单用例 `--repeat-each=20` → 4/20 失败，签名与完整 visual 一致
      （缺少 250ms；`01-webkit-repeat20.log`）。
- [x] 1.2 探针：记录 `compositionend` / 假时钟推进 / `beginSettle` 的 `settleStarted` /
      settle 定时器延迟与调用时刻（`02-webkit-repeat20-instrumented.log`）。
- [x] 1.3 归类：测试 oracle 缺陷（两个子形态：起点错位、解析提前完成）；产品状态机与 marker
      恢复正确。1045 的 60ms 为独立负载敏感预算，不并入本 change。
- [x] 1.4 修复：在 `beginSettle` 排 0ms 首拍时、回调执行前推进假时钟；断言只统计 settle 链
      自己排的定时器，仍要求出现 250ms。

## 2. 验证

- [x] 2.1 反向必红：恢复「4s 后 cancel」产品变异体并重建 dist → 5/5 红
      （`Received array: [0]`）；回退并重建后 20/20 绿（`05`/`06`/`07` 日志）。
- [x] 2.2 候选 oracle 双引擎各 `--repeat-each=20`：webkit-realua 20/20、chromium 20/20
      （`07`/`08` 日志）。
- [x] 2.3 webkit-realua 整份 `editing-oracle.spec.ts`：56 passed / 10 skipped
      （`09-webkit-editing-oracle-full.log`）。
- [x] 2.4 `tests/visual` 的 `tsc --noEmit` PASS。
- [x] 2.5 完整 `scripts/gate.sh visual` 一次（不与其它完整 visual 并行）：`GATE RESULT: 15/15 PASS
      （SKIP 0）`，退出码 0，visual-regression 1404s / 1978 passed / 0 failed / 13 skipped
      （`11-gate-visual-full.log`、`12-gate-visual-regression-full.log`）；1143 在 chromium（#88）
      与 webkit-realua（#1780）均绿。
- [x] 2.6 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：39 passed / 0 failed。
- [x] 2.7 节点 2 记录按 `proposal.md` 五态表填写（implemented / released / machine PASS /
      native PASS / archived），失败项按四类归因。
## 3. 追加：358 state 树陈旧 oracle（2026-11-28）

- [x] 3.1 复现：CI visual run `46024536448` 首跑与 retry 双红于
      `editing-oracle.spec.ts:386`，received string 是整篇 2000 段 + BulletList。
- [x] 3.2 探针：open 后 0ms `treeLen=3000`，100ms `treeLen=12005`；此后 dispatch 走
      `LanguageState.apply` 的 `upto=undefined` 分支，把 state 树同步成整篇新树
      （`14-chromium-358-probe.log`）。
- [x] 3.3 归类：pre-existing 测试 oracle 缺陷（386 是转瞬即逝的 setup 条件；effect
      transaction 会同步 state 树，settle 首拍从未真正看到陈旧树）。父提交 `3f20855c` 同一
      探针读数完全一致（`22-parent-3f20855c-358-probe.log`）；合并 diff 的 md 模板未变。
      `render-link` 首跑断连属环境抖动，不处理。
- [x] 3.4 修复：settle 首拍调度时把 state 树置回旧树（构造 stale 快照）；包装插件 build，
      断言第一次 build 已用 context 树。
- [x] 3.5 反向必红：产品变异体（available 分支用 `syntaxTree(view.state)`）3/3 红
      （`17`）；oracle 变异体 A（无 hook）红（`18`）、B（不置旧树）红（`19`）。
- [x] 3.6 恢复后双引擎各 20/20 绿（`20`/`21`）；整份 spec chromium 66 passed、webkit
      56 passed / 10 skipped（`23`/`24`）；`tests/visual` tsc PASS。
- [x] 3.7 358 修复后的最终完整 `scripts/gate.sh visual`（不与其它完整 visual 并行）：
      `GATE RESULT: 14/15 PASS（SKIP 0）`、退出码 1；visual-regression `GATE PASS` 1429s /
      1984 passed / 0 failed / 13 skipped（358：chromium #73、webkit #1765；1143：chromium #94、
      webkit #1786）。唯一 FAIL 是 master `2de2f4ef` 既有的 `docs-check`（backlog 81 行超限），
      与本 change 无关，未在本分支修（`25`/`26` 日志）。

## 4. 收尾

- [ ] 4.1 merge / push：按本批禁令留 tower（不在本 change 内执行）。
