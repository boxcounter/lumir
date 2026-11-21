# Proposal: 修复列表行的 IME 组合输入与删除保真

- Change ID: `fix-ime-list-composition-nov20`
- 日期: 2026-11-20
- 角色: Alex Lee（原始缺陷报告、dev 复现与直接处理要求），AI agent（诊断 / 起草 / 实现）

> 评审记录
> 节点 1：Alex 报告生产版 Lumir 在中文输入法下于列表标记后输入 `s` 会多出横线，删除后相邻的
> 「词汇」行消失，并要求「请你直接处理」。本 change 只修复既有「列表内容起点输入的跨层一致性」
> 与源码保真合同，不新增产品行为。
> Preliminary review（2026-11-21）：hold，提出 P2-1（接管面超出 L6 列表内容起点）、P2-2
> （compositionend 同步解析整篇且忽略返回值）、P3-1（主矩阵缺渲染终态断言）、P3-2（恢复链
> 缺确定性覆盖）。本批已按建议收窄接管面、改为有界目标解析，并补几何 / 恢复测试；独立复评
> 与合并放行仍待进行。
> 第二轮 review（2026-11-21）：hold，P2-1 已闭环；新坐实 P1（compositionend 同步 dispatch
> 会清掉 CM pending MutationRecord、丢最终候选）、P2（4s 截止后取消恢复链）、P3-1（目标行
> 提交后未与组合前比较）、P3-2（性能只测事件入口）。本批已把 effect 延到 pending flush 之后、
> 4s 后转低频恢复、补目标行几何与真实 settle 切片 / 提交到绘制测量；仍需复评。
> 节点 1 批准推进：该批以「请你继续」批准；最终复核（`review-final-current.md`）判 `clean/merge`，
> 各轮 P 项全部闭环。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 报告生产版中文输入法下列表标记后输入 `s`
   多出横线、删除后相邻「词汇」行消失，并要求「请你直接处理」；该批以「请你继续」批准推进
   （见上方「评审记录」）。实现期没有静默扩 scope：接管面收窄到 L6 列表内容起点、恢复链改为
   有界分片、组合期冻结装饰重建——都是既有「列表内容起点输入的跨层一致性」合同的修复，未新增
   产品行为；三轮 review 的 P1/P2/P3 处置均在原意图内，未扩到非列表位置。
2. **独立 reviewer clean / merge**：独立 reviewer agent-34 判 `clean/merge`，无 P1 / P2；明记
   「旧 settledTree reconciliation P2 已闭环；组合期冻结、SourceShield、insertText 补偿、
   undo/redo 与 dirty 语义均已审查」，目标单测 17/17、验收驱动 4/4、目标结构视觉 29/29，
   诊断无残留。绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/ime-list-composition-nov21/review-final-current.md`。
   当前分支 tip 与该评审 tip 相同。
3. **tasks 完成**：`tasks.md` 17/17 全勾（`grep -c '^- \[x\]'` = 17，未勾项 0），无放弃项。
   4.2 的最终门禁与 4.3 的独立复核读数已就地补记；4.4 的 Alex 原生 IME 复验（中文候选提交后
   正式列表符恢复）记在同项。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（含 `editing-oracle.spec.ts` 的
   IME 组与目标结构视觉 29/29），按 `scripts/gate.sh visual` 档取读数——
   `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；未更新像素基线。真机场景
   `271-ime-list-composition-wkwebview` PASS（19 断言，0 FAIL；`status.txt` = `PASS`），证据
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/271-ime-list-composition-wkwebview/`
   （`steps.md` / `shots/` / `ax/`）。该场景为合成 IME 序列（≠ 原生 IME），原生终判仍归
   156 / 262；2026-11-21 Alex 原生中文 IME 复验确认正式列表符恢复，评审文件同记。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   12 份 delta，12 条 MODIFIED，对比 213 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 39
   passed, 0 failed (39 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是 `editor-live-preview` 的 1 条 MODIFIED（「列表内容起点输入的
   跨层一致性」整条复制后改，保留既有全部场景），是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决（Alex 已原生复验并确认行为符合预期）、
无审美手感项、无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## Why

Chromium 经 CDP `Input.imeSetComposition` 复现了删除后的相邻行消失：组合输入 `s` 后
`EditorState.doc` 为正确的 `词汇\n- s`；组合中 Backspace 后源码恢复为 `词汇\n- `，但第一行
`.cm-line` 的 DOM 文本被清空。首轮实现只处理 Chromium 的 `deleteContentBackward`，Alex 随后在
master 工作区的 dev 实例确认 WKWebView 现象完全不变。

dev 实例的 `editor_ime` 本地日志同时证明当前工作区代码已加载，并给出 WKWebView 的真实事件序：
首字符是 `insertCompositionText`；删空时是 `deleteCompositionText`，随后立即 compositionend。
现场没有 `insertOrderedList` / `insertUnorderedList`，首轮针对这两个命令的假设因此被反证。
额外横线是组合期间列表 marker widget 提前重建，与输入法仍持有的原始 `- ` 同时存在；删除未接管
则继续破坏相邻行 DOM。组合期冻结落地后，Alex 第二轮 dev 复验确认删除导致的相邻行消失已修复；
候选提交后 marker 未恢复——WKWebView 在 `insertFromComposition` 后立即结束组合，增量语法树尚未
覆盖新形成的列表。`compositionend` 因此只把**提交行末**交给有界恢复链（有界分片解析，
未完成按 16ms / 100ms 重试，4s 后转 250ms 低频恢复直到覆盖提交行），再唤醒冻结期跳过的
装饰重建；不把同步解析整篇文档当成刷新前提。最终候选可能已写进 DOM 而 CM 的 pending
MutationRecord 尚未 flush，handler MUST NOT 同步 dispatch，否则候选会被清掉。最终取证还确认
WKWebView 的 pending composition 删除不可取消，且候选可由 `insertText` 在无原生 compositionend
时提交；对应防线是原子 SourceShield 与提交后补 end。2026-11-21 Alex 最终原生复验：中文候选提交后
正式列表符恢复，行为符合预期。

## What Changes

- 组合中 Backspace 仅在即将删空 marked text 时改走显式 CodeMirror 事务，以 `compositionstart`
  的源码位置为下界；同时接受 Chromium 的 `deleteContentBackward` 与 WKWebView 的
  `deleteCompositionText`。接管面限定为 L6 列表内容起点（真列表项 / 裸 marker / 段落后
  `- ` 的 setext 候选，复用 `listLineRender` 与 `markerTextAt` 判定）；普通段落、表格、
  代码块等非列表位置的组合删除交回原生 IME。组合内尚有剩余文本时同样交回原生 IME。
- 组合期冻结列表装饰的 DOM 重建，保留组合前形态；`compositionend` 不直接 dispatch，而是等
  CM 的 pending MutationRecord flush 后重读 `selection.main.head`，再把提交行末交给有界恢复链
  （分片推进 + 16/100ms 重试，4s 后转 250ms 低频恢复直到覆盖提交行），解析覆盖后统一刷新，
  避免原始 marker 与新 widget 同时出现。文档源码、列表组映射与后台扫描仍随事务更新。
- setext 候选在编辑态用 `contenteditable=false` 的 SourceShield 隔离 `- ` 与组合文本，因为
  WKWebView 的 pending composition 删除不可取消，不能依赖 preventDefault；候选以 `insertText`
  且没有原生 compositionend 时补一次结束事件，复用 CM observer 与恢复链释放正式 marker。
- `history.joinToEvent` 不再把 `input.type.compose.start` 与紧邻的前一笔普通输入并组；一次 undo
  精确回到组合前，后续组合事务仍由 CodeMirror 并成一步。
- 扩充 `docs/specs/lists.md` L6 与 editor-live-preview requirement，把组合更新、两种删除类型、
  组合期装饰稳定、相邻行 DOM 保真、历史与保存纳入同一不变量。
- 用真实 Chromium 组合事件覆盖真 bullet / 有序 / 嵌套 / 裸 marker / 段落后 setext 切换；另以
  合成 beforeinput 覆盖 WKWebView 实测的 `deleteCompositionText`、非列表位置不接管、组合中
  timer 到期与取消组合恢复、pending DOM 候选 flush、4s 截止后的低频恢复、解析未完成后的最终
  恢复。主矩阵在提交与 undo/redo 后逐行断言 marker 数量、glyph / 序号、计算样式与正文 x，
  真列表目标行提交前 / 后逐项比较，setext 与同文档同字体顶层参考 bullet 逐项数值比较；
  Alex 的 dev 复现日志用于确认事件路径，不把 Chromium 结果冒充 WKWebView 行为证据。另加
  验收套件 `imeDrive`（仅验收实例 Vite 注入驱动）按真实 WKWebView 日志序列复刻
  compose / delete-empty / commit；它证明产品 JS 路径，不替代原生 IME 人工终判。

## Non-goals

- 不改变列表外观、裸 marker 语义、光标导航、Enter 续行或普通 Backspace 的字素合同。
- 不按横线、marker glyph、DOM/AX 文本或文件内容猜测编辑意图，不恢复旧 DOM 读回吞弃护栏。
- 原生候选窗 / marked text 的最终行为仍由 Alex 人工终判；合成事件与验收驱动不冒充原生 IME。
  dev 实例只用于合成 fixture 的现场复现、诊断与验收，真实 vault 只读。
- 不新增依赖，不修改视觉基线。

## Impact

- 影响的 specs：editor-live-preview；专项合同 `docs/specs/lists.md` L6。
- 影响的代码/系统：md 编辑器的 beforeinput 组合编辑闸门、列表装饰生命周期与浏览器回归测试。
- 关联约束：不改写源文件铁律、渲染 / 交互缺陷合同先行、真实 vault 只读与真机隔离要求。
