# Proposal: 原生跨行删除保真——跨 replace 装饰时只改预期源 range

- Change ID: `fix-native-widget-deletion-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始需求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对 M832 缺陷的原始要求**「修复合同覆盖整个行为类别」**，
> 以及 M835 只读诊断的双引擎实测结论。tower 在 M836 的 mission 指令中据此立项并指定
> 「通用 state-only 修复，不按 DOM / en dash 文本形状猜意图」。本 change 不引入新的产品
> 行为或裁决点：修复面与合同范围由该要求直接决定，实施按 tower 的 mission 指令执行。

## 节点 2 记录（归档前，2026-11-19，M840）

口径见 [openspec-workflow.md](../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 来源是 Alex 对 M832 缺陷的原始要求「修复合同覆盖整个行为类别」与 M835 只读诊断的双引擎实测结论（见本文开头记录）；tower 在 M836 mission 中据此立项并指定「通用 state-only 修复，不按 DOM / en dash 文本形状猜意图」。本 change 不引入新的产品行为或裁决点，实现期没有静默扩 scope：`git diff --name-only 79e8815d...0facd254` 恰为声明的 9 个文件（`src/editor.ts`、`tests/unit/editing-oracle-model.ts`、`tests/visual/scenes/editing-oracle.spec.ts`、`docs/specs/lists.md`、261 场景 + COVERAGE、本 change 三件），无 `src-tauri`、依赖或像素基线改动。
2. **独立 reviewer clean / merge**：assigned reviewer `reviewer-native-widget-deletion` 判 `status: clean` / `merge: merge`，评审 tip `0facd2543b742420b65505182f947316eacc6fd9`（`reviewed_commit` 同值），评审文件 `/Users/boxcounter/Code/Boxcounter/lumir/.tower/comms/reviews/review-feat-fix-native-widget-deletion-nov19-reviewer-native-widget-deletio-r1.md`。合并提交 `40b34a2d` 的第二父即 `0facd254`，评审绑定内容与合入内容同一份。
3. **tasks 完成**：`tasks.md` 16/16 全勾，无放弃项。2.6（真机 261）在 M836 期间因用户真机窗口结束而如实未勾；M839 先修 261 场景的两条 oracle 缺陷（`a84a66ae`，只改场景 md、产品代码零改动），真机重跑 PASS 后按证据勾选（33 断言 / 0 失败 / exit 0）。
4. **要求的门禁与真机证据**：实现 tip `5a8e5f7b`：`scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）` 退出码 0；`LUMIR_VISUAL_PORT=4386 scripts/gate.sh visual` → `GATE RESULT: 15/15 PASS（SKIP 0）` 退出码 0、visual-regression 780s（含全量像素，未更新基线）；读数记于 `tasks.md` 3.5（原始 gate 日志未落 `.local/`）。reviewer 在最终 tip `0facd254` 独立复跑：`pnpm test` 1518 pass / 0 fail；`tests/visual/scenes/editing-oracle.spec.ts` 75 passed / 1 skipped（Chromium 38 + webkit-realua 37，含 seed 2 / 13 / 29）；`node scripts/acceptance/run.mjs --check` 238 场景 PASS。真机 261 `PASS`、33 断言、0 失败、48.5s（`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-widget-oracle-fix/`；列表 / wikilink / 公式三格 + 精确落盘 + 一次撤销，witness C `file.exact alpha$x$` 逐字节命中）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS（`扫过 8 份 delta，6 条 MODIFIED，对比 79 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`，退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 35 passed, 0 failed (35 items)`（退出码 0）；`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。delta 为 `editor-live-preview` 1 条 ADDED，是真实增量（`grep` living 无同名 requirement）。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与 tip 均无异常、证据无缺口——机器 + 独立评审放行（本节要件）。

## Why

### 现场

M832 的编辑参照模型在真 EditorView 上发现：正文里光标停在普通行行尾、下一行是 `- item`
时按一次 forward Delete，源码被改成 `alpha\n–\nitem\n`——渲染层 marker 的显示字形 `–`
（U+2013）被当作正文写回，且原本一行被拆成两行。保存后磁盘内容就是坏的。

M835 的只读诊断（Chromium + Playwright WebKit，真 EditorView / 真 stubTauri）把根因与类别
坐实：

- **机制**：裸 Delete / Backspace / `⌘⌫` 走浏览器原生 contenteditable 编辑。原生**跨行合并**
  时会重建「被吸收行」的 DOM：`contenteditable=false` 的 replace widget 被摊平成它的
  DOM 文本，隐藏的源码标记直接消失；CM 的 tile 映射随 widget 节点一起失效，
  `DOMReader.readNode` 只能按文本读回。事务栈来自 `DOMObserver.flush`（userEvent
  `input.type`），不是键位命令。
- **不是列表特有**：wikilink（`alphab x c`，`[[ ]]` 静默丢失）、行内公式（`alpha\nx\nx\n`，
  KaTeX 的 mathml + html 文本一起进源码）、任务项、嵌套 `◦`、有序 marker 同样坏；
  `**bold**` 这类只有隐藏标记的行走同一后门（`**` 被吞成 `alphabold`）。
- **只有被吸收行坏**：forward Delete 吸收下一行，Backspace / `⌘⌫` 吸收本行；widget 在
  存活行时两引擎都正确。非空选区删除与行内删除实测安全（选区删除读的是真实源 range）。
- **两引擎行首词删除语义不同**（Chromium 只删换行，WebKit 删前一个词 + 换行），所以按
  引擎原生 range 猜意图不可行；判据必须来自 `EditorState`。

M832 当时只能把这一格从随机序列里绕开，并留下 `test.fixme` 与
`deletesDashBulletNewline` 生成器护栏——缺陷被记录，但覆盖面按「列表 + Delete」的窄口径
留着，同类会在 wikilink / 公式 / `⌘⌫` 上复发。

### 为什么是「单一闸门」而不是逐类修 widget

逐类修（给 ListMarker / WikilinkWidget / InlineMathWidget 各自加 DOM 侧防护）会把
「浏览器原生跨行删除会重建行 DOM」这条结构性事实拆成 N 份环境适配，且新增 widget 会
再次漏。反过来，把命中的原生删除换成**显式 CM 事务**，事务只改源码、不经过 DOM 回读，
类别自然闭合。

## What Changes

- 新增 requirement「跨 replace 装饰的跨行删除」：任意落到原生路径的跨行合并 SHALL 只删除
  两端之间那一个换行；被吸收行的 widget 源片段与隐藏标记 MUST 逐字节保留；MUST NOT 把
  显示文本写进文档。
- 判据 SHALL 只读 `EditorState`（空光标 + 行边界），MUST NOT 检测 widget 类型 / replace
  装饰数量 / DOM/AX 文本形状。因此对 plain 行的事务结果与原生逐字节相同，不需要按渲染
  形状分支。
- 实现：`src/editor.ts` 的 beforeinput 闸门（`absorbLineMergeDelete`）——`deleteContentForward`
  在行尾、`deleteContentBackward` / `deleteWordBackward` / `deleteSoftLineBackward` /
  `deleteHardLineBackward` 在行首命中时 `preventDefault()` 并 dispatch 单换行事务；词删除
  变体改调应用自身的 `deleteWordForward` / `deleteWordBackward`（两引擎原生词删除的行首
  语义不同，应用命令保证一致）。只在 md 模式装配（code 模式没有 replace 装饰）。
- 合同落进 `docs/specs/lists.md` L7（列表 marker 是这类装饰最常见的一格；判据不限于列表），
  并配可证伪的有向矩阵。
- 回归：`tests/visual/scenes/editing-oracle.spec.ts` 把 forward Delete 的 `test.fixme` 转正，
  移除 `deletesDashBulletNewline` 绕路与随机生成器的 marker 邻接护栏（forward 方向），
  新增 `-` / `+` / `*` / 有序 / 任务 / 嵌套 × wikilink / 行内公式 / 隐藏标记 × 双向 / `⌘⌫`
  的有向矩阵（每格先断言 widget 真实渲染），以及 undo / `⌘S` 精确落盘。
- 模型：`tests/unit/editing-oracle-model.ts` 增加 `deleteLineBackward`（`⌘⌫`：行中删到行首、
  行首删前一个换行，两引擎实测同口径）。
- 真机：新增 `scripts/acceptance/scenarios/261-native-widget-deletion.md`（列表 / wikilink /
  公式三格 + 精确落盘 + 一次撤销），COVERAGE 随生成脚本更新。

## Non-goals

- 不修行内删除（不跨行）、非空选区删除、IME 组合期删除——实测它们不改写被吸收行 DOM。
- 不接管 `deleteWordForward` 之外的 forward 词 / 行删除变体（`deleteSoftLineForward` /
  `deleteHardLineForward` 在行尾两引擎实测 no-op 且默认键位不可达）。
- 不恢复历史上的列表专用吞输入护栏，不按 DOM / AX 形状猜编辑意图，不改 widget 渲染形态。
- 不改变行内删除、选区删除、裸 marker Enter/Backspace、L5 原子导航、L6 输入合同与光标几何。
- 不为多区间选区（应用不提供多光标）设计分派：闸门在多区间时放行原生路径。
- 不更新视觉像素基线。

## Impact

- 影响的 specs：editor-live-preview（新增 requirement）。
- 影响的代码：`src/editor.ts`（beforeinput 闸门与装配）、`tests/unit/editing-oracle-model.ts`、
  `tests/visual/scenes/editing-oracle.spec.ts`、`docs/specs/lists.md`、验收场景 261 + COVERAGE。
- 关联约束：ADR 0003 §3 不改写源文件铁律；`docs/specs/lists.md` L1–L6 与
  `docs/specs/editor-caret.md` C1 继续成立。
- 真机边界：M836 期间用户真机窗口已结束，261 未执行，未跑不得记 PASS。
