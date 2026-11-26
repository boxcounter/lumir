# Proposal: 流式分片边界不越界——尾换行后一片首字符不再丢失

- Change ID: `fix-harness-stream-boundary-newline-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（缺陷裁决 / 排期），AI agent（诊断与实现）

> 评审记录
> 节点 1（提案评审）：**通过**。Alex 在盘点一批放行项后明确排期顺序——先修流式丢字符——
> 回复原话：「好。请你安排」（2026-11-26）。本 change 的批准边界即该裁决：只修这份数据正确性
> 缺陷，不做视觉改动、不顺手改渲染语义；范围与判据见下文。
> 节点 2（归档评审）：**机器 + 独立评审放行**（2026-11-27）。五要件读数：
>
> 1. **方案已批准**：节点 1 通过（Alex 2026-11-26「好。请你安排」）；实现期未扩 scope——改动面
>    = `src/harness-panel.ts` 的 `finalizedUpTo` 一处返回值 + 单测 / 验收场景 / change 制品，
>    与「What Changes」逐条对应，未动视觉、渲染策略或 Markdown 语义。
> 2. **独立评审 clean / merge**：K3 主会话终审通过（clean / merge，会话内裁决；本批无独立
>    verdict 文件落 `.local/reviews/`）。评审绑定实现 tip `e91c33b0`（分支
>    `fix/harness-stream-trailing-newline-nov26`）。该 tip 之后本 change 的测试 / 验收场景 /
>    fixture 零改动（`git log e91c33b0..HEAD -- tests/unit/harness-stream-boundary.test.ts
>    scripts/acceptance/scenarios/879-harness-stream-boundary-newline.md` 为空）；`src/harness-panel.ts`
>    在合并后另被几个不相关 change 改过（session-token / withdraw / 品牌文案等），但本批复跑
>    `finalizedUpTo` 的单测仍 2145 pass / 0 fail，归档批未改任何代码、测试或场景。
> 3. **tasks 完成**：全部勾选；原先未勾的两项（4.4 真机执行、6.3 backlog 条目 + 节点 2）由本批
>    以真机 PASS 与归档动作闭合，未放弃任何任务项。
> 4. **门禁与真机证据**：quick 合并后 `GATE RESULT: 13/13 PASS（SKIP 0）`（主会话读数）；
>    前端全量单测本 worktree 复跑 2145 tests / 0 fail；`bash scripts/docs-check.sh` PASS；
>    真机 879 PASS 16 条（13 条断言 + 3 张截图，含中间态「第二片首字符即上屏」判据），证据
>    `.local/acceptance/2026-11-27-ux-goal/879-harness-stream-boundary-newline/`
>    （`status.txt` = PASS，`steps.md` 逐条 PASS）；本 change 无视觉改动、未更新像素基线。
> 5. **规格对账**：`openspec-archive-check` 门禁模式随 docs-check PASS；
>    `validate --all --strict` PASS（45 passed / 0 failed）；归档跟踪队列有且仅有一条条目
>    （`docs/backlog.md`，本批落条目时删一条已归档历史记录以守 80 行硬上限）。
>
> **归档后**（2026-11-27）：归档提交 `08999fad`（`chore(openspec): archive fix-harness-stream-boundary-newline-nov26`）。
> 包装器 `node scripts/openspec-archive.mjs fix-harness-stream-boundary-newline-nov26` 输出：
> `Task status: ✓ Complete` / `Applying changes to openspec/specs/harness/spec.md: + 1 added` /
> `Totals: + 1, ~ 0, - 0, → 0` / `Change 'fix-harness-stream-boundary-newline-nov26' archived as
> '2026-11-27-fix-harness-stream-boundary-newline-nov26'`；归档后修链 **0 处**（扫过 3 篇 Markdown /
> 0 条相对链接），`openspec-links: PASS（校验 712 条相对链接，全部可达）`。
> 归档提交后审计 `node scripts/openspec-archive-check.mjs --archived fix-harness-stream-boundary-newline-nov26`
> → `PASS（openspec/changes/archive/2026-11-27-fix-harness-stream-boundary-newline-nov26：0 条 MODIFIED，
> 对比 0 段；人工恢复 0 段，声明认领 0 段）`。本 change 是纯 ADDED delta，对账脚本只审 MODIFIED 段，
> 故「0 条 MODIFIED / 0 段」是预期读数；新 requirement「流式分片定稿的边界与字符守恒」已随
> 归档并入 `openspec/specs/harness/spec.md`（validate 44 passed / 0 failed）。

## Why

### 现象

harness 流式输出期间，紧接着「前一片恰好以换行结尾」的下一片，其**首字符不上屏**：例如模型分片
为 `第一段。\n\n第二段。\n` + `后续正文`，面板在流式中间态显示成 `第一段。 第二段。 续正文`
（`后` 被吞），且该字符在轮次终态之前一直缺席。轮次收口时 `finalizeStreamingMessage` 按完整源
全量重渲，字符会补回来——所以缺陷只暴露在**流式中间态**，终态自查看不出来，也解释了它为何能
活到 dogfood 才被肉眼发现。

### 机制（已坐实到代码）

`src/harness-panel.ts` 的 `finalizedUpTo`（流式源 → 「已完成块 / 进行中尾块」切分）逐行走
`source.split("\n")` 并推进 `offset`。源以 `\n` 结尾时 split 会多产出一个空串行，该行按「空行」
推入 `offset + 0 + 1 = source.length + 1`；`finalizedBoundaryFromTop` 对非列表末块直接返回这个
候选值，`flushChunks` 把它写进文本段的 `renderedFinalized` 游标。下一片到达时
`seg.source.slice(renderedFinalized)` 从源长之外起切——**首字符被切掉**；后续边界推进时
`slice(cursor, boundary)` 也永远跨过那一格，直到终态全量重渲才恢复。

### 判据与证据（实现前）

- 纯函数探针：`finalizedUpTo("普通段落。\n") = 7`（源长 6）、`"第一段。\n\n第二段。\n" = 12`
  （源长 11）、`"" = 1`（源长 0）——**边界恒为源长 + 1**，是「源以换行结尾」的稳定形态，
  不是偶发。
- 真面板路径（新单测在未修代码上）：第一片 `普通段落。\n` 定稿后再送第二片 `续段首字保留。`，
  尾块文本是 `段首字保留。`——**首字符「续」丢失**，且终态之前的每一帧都如此。
- 红跑证据（未修代码，全红）与绿跑证据（修后，全绿）落主仓
  `.local/missions/fix-harness-stream-boundary-newline-nov26/`：`RED-unit-before-fix.log` /
  `probe-boundary-before-fix.log` / `GREEN-target-unit-after-fix.log` / `probe-boundary-after-fix.log`。

### 为什么现在修

Alex 已在盘点中把「先修流式丢字符」排在本批首位（原话「好。请你安排」）。这是数据正确性缺陷
（用户在流式期间看到的内容与模型实际输出不一致），不是观感问题；修复面只有一处返回值的上界约束，
不牵动渲染语义、视觉或性能合同。

## What Changes

1. **定稿边界恒在 `[0, source.length]` 内（`harness` 新增一条 requirement）**
   `finalizedUpTo` 在出口把边界夹到当前源长：切分点既是下一片尾块的 `slice` 起点，也是
   `renderedFinalized` 游标，指向源外就会吞掉下一片首字符。`split("\n")` 在源以换行结尾时多出
   的末尾空串行 MUST NOT 把边界推到源长之外。

2. **跨片字符守恒（同一条 requirement）**
   「已定稿块 + 尾块」与当前源逐字一致；分片点落在块边界（空行之后）时，两段渲染文本的拼接
   等于同源完整渲染的文本——后续分片到达 MUST NOT 丢失、重复或重排字符，含分片恰好断在尾换行
   之后的情形。

3. **既有语义不变（同一条 requirement 的边界声明）**
   只约束切分游标的边界与字符守恒，MUST NOT 改变 Markdown 解析语义、定稿时点或排版：尾换行、
   连续空行、CRLF、闭合代码围栏之后照旧可定稿；未闭合围栏与仍在生长的列表内部空行照旧不定稿
   （后者由既有 requirement「Harness Markdown strong 的流式渲染一致性」守，本 change 不复制）。

4. **判据**
   - 纯函数层：`tests/unit/harness-stream-boundary.test.ts` 对语料做**全部切点**的边界上界属性
     断言；两阶段分片的「冻结前缀 + 尾块 = 完整源」字符守恒属性；覆盖尾换行 / 连续空行 / CRLF /
     闭合围栏 / 未闭合围栏 / 列表 / 空源。
   - 真面板层：同一文件驱动真 `createHarnessPanel` 的 `text_chunk → flushChunks → 冻结块 / 尾块`
     路径（rAF 逐帧排干），断言下一片首字符在尾块里；**未修代码上该用例必红**。
   - 真机层：新增验收场景 `879-harness-stream-boundary-newline`（mock 显式分片，片间隔 6 秒），
     第二片到达后、第三片未到时断言完整串 `首字符检验。`——旧实现只会有 `字符检验。`。
     本轮按 mission 边界**不执行真机**，场景随本 change 落地，执行留后续批次。

## Non-goals

- **不改视觉 / 排版 / 字号 / 间距**：不更新像素基线、不动 `src/style.css`、`src/preview/**`。
- **不改流式渲染策略**：不取消增量定稿、不改 rAF 合帧、不改段 / 工具块的时序与结构。
- **不改 Markdown 解析语义与既有定稿时点**：列表内部空行、未闭合围栏的「不定稿」口径原样保留。
- **不修本次射程外的流式缺陷**（如视觉层的手感问题）：发现即登记 finding，不就地扩 scope。
- **不补偿历史数据**：缺陷只影响中间态渲染，终态与复制源都来自完整源，无需迁移。

## Impact

- 影响的 specs：`harness`（ADDED「流式分片定稿的边界与字符守恒」）。活跃期不改 living spec。
- 影响的代码：`src/harness-panel.ts` 的 `finalizedUpTo` 一处返回值（夹上界）+ 函数注释。
- 影响的测试 / 制品：新增 `tests/unit/harness-stream-boundary.test.ts`；新增验收场景
  `scripts/acceptance/scenarios/879-harness-stream-boundary-newline.md` 与 fixture
  `scripts/acceptance/fixtures/harness-mock-newline-chunks.json`；`scripts/acceptance/COVERAGE.md`
  随场景重新生成。
- 关联约束：性能合同（常数开销，不新增 DOM / 解析）；ADR 0003 第 3 条（不改写源文件）；
  ADR 0004（AI-only 交付）。
