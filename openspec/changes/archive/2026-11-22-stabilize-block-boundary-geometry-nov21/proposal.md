# Proposal: 块边界纵向几何由源码同步决定

- Change ID: `stabilize-block-boundary-geometry-nov21`
- 日期: 2026-11-22
- 角色: Alex Lee（评审 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-22）。Alex 已明确采纳：纵向几何由源文本块边界同步决定、
> 首帧即为最终纵向几何、异步扫描不得改变行高或光标；接受少量静态几何变化，但新增截图须后续过目。
> 软换行 R4 单列，不宣称本轮覆盖。实施期计划内部矛盾修正：`para\n---` 按源码算法归为
> setext 下划线而非 list marker，第二行 `padding-top=0`、新几何 33.5+25.5；不新增特判。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-22）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-22 通过——Alex 采纳结构方案（纵向几何由源文本块边界同步决定、
   首帧即最终纵向几何、异步扫描不得改变行高或光标）并批准 4 张新增静态几何基线（见上方「评审记录」）。
   实现期没有静默扩 scope：产品增量对应「What Changes」四条（`src/preview/block-geometry.ts` 新入口
   为纵向 padding 唯一写入者、列表新组首帧横向估算与扫描同式、真 lezer 属性测试与逐帧场景、4 个块
   边界视觉场景）；实施期唯一的计划内部矛盾修正（`para\n---` 归 setext 下划线）已在节点 1 记录中裁明，
   不新增特判；R4 软换行、引用间距与 setext 标题渲染按 Non-goals 明确不扩。
2. **独立 reviewer clean / merge**：独立 reviewer agent-50 判 `clean/merge`，无 P1 / P2 findings，
   绑定 tip `7a0a9b77d7439a4bfa0e7d052dd994bbb2fe4a7b`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/block-geometry-nov21/review-final.md`。
   评审期 P1（长连续正文首行查询递归 ⇒ `RangeError`）已由 `ea76dadc` 闭环并复验；本回填批自该 tip
   之后只改 proposal / tasks / backlog 三份文档，无产品代码增量。
3. **tasks 完成**：`tasks.md` 18/18 全勾（`grep -c '^- \[x\]'` = 18，未勾项 0），无放弃项；
   R4 等边界未扩入本轮，与 5.4 及 proposal Non-goals 一致。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（新增 `block-boundary-geometry.spec.ts`
   与 4 张基线，均经 Alex 过目批准），按 `scripts/gate.sh all` 取读数——`GATE RESULT: 22/22
   PASS（SKIP 0）`，退出码 0（含整页 / 元素像素层、release 与性能合同；cold-start median 115.26ms /
   p95 119.52ms，合同 <300ms）。前端单测 1736/1736，目标结构视觉 161/161，根 / 单测 / 视觉三份 tsc
   全绿。真机场景 `272-block-boundary-geometry-nov21` PASS（15 断言，0 FAIL；`status.txt` = `PASS`），
   覆盖 `Enter → - → 空格 → 中文`、正式 marker 与最终源码逐字，证据
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-block-geometry/272-block-boundary-geometry-nov21/`
   （`steps.md` / `shots/` / `ax/`）。场景不冒充原生 IME，AX 不声称读取行高 / scroll / 像素。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   8 份 delta，6 条 MODIFIED，对比 82 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 36
   passed, 0 failed (36 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是既有 capability `editor-live-preview` 的 1 条 ADDED，不是纯目录
   移动；living spec 已有 Purpose，无需新建占位。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项（4 张基线已过目批准）、
无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## Why

段落后输入 `-`、列表 marker 首次成立以及裸 marker 进入编辑态时，行高与光标会随语法解析、列表组扫描
和光标相接状态发生二次跳动。现行纵向间距分别由段落末行、标题行内联样式、列表首行样式与裸行补偿
写入；这些写入点依赖不同的异步或编辑态条件，导致同一源码中间态得到不同纵向几何。

## What Changes

1. 新增同步的块边界几何入口，以源码行形态和既有语法树上下文推导可见行的纵向 padding；段落 8px、
   标题阶梯与列表首行 2px 的数值逐项不变。该入口是普通正文、标题和列表纵向 padding 的唯一写入者，
   不读取光标、DOM 测量或列表组扫描结果。
2. 列表新组在首个可用帧按与后台扫描相同的显示标记公式估算横向几何；扫描只复核或修正横向宽度与编号。
   组合期沿用列表现有的冻结与 `compositionSettled` 恢复合同，不回退 IME 修复。
3. 以真 lezer 属性测试覆盖前序行类型、marker 输入前缀、文档位置、嵌套与对照组；以 Chromium 和
   WebKit 的逐帧场景覆盖 Alex 的 `Enter → - → 空格 → 中文` 序列、首帧横向几何和组合期稳定性。
4. 新增四种块边界形态的视觉场景。未经 Alex 过目，不写入或更新截图基线，只保留 actual 供裁决。

## Non-goals

- 不覆盖普通段落软换行处末行 8px 迁移的 R4；本 change 不宣称修复这一类问题。
- 不增加 setext 标题渲染，不改变引用块间距，不重排标题阶梯，不改 marker 外观或列表扫描架构。
- `-x` / `===x` 这类从边界形态翻回普通文本的病态输入允许一次几何变化，本轮不优化。

## Impact

- 规格：`editor-live-preview` 新增块边界纵向几何 requirement；`docs/specs/lists.md` 新增列表纵向几何
  与组扫描解耦的合同。
- 实现：`src/preview/block-geometry.ts`、`livePreview.ts`、`lists.ts`、`theme.ts` 与 `style.css`。
- 测试：块几何与列表估算单测、编辑稳定性的逐帧回归、新块边界视觉场景。
- 已知静态变化：无空行分隔的 `para` 后接 bullet / setext 下划线时间距归属改变，具体像素由 actual
  截图送 Alex 过目；既有基线不在本批更新。
