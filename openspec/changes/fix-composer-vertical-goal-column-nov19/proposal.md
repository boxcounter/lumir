# Proposal: composer 竖直移动的列位改回行内字符列

- Change ID: `fix-composer-vertical-goal-column-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**由 Alex 在真机 dogfood 中直接指令**（2026-11-19）。原话（mission 转述的
> 真机读数）：「最终 master 8814bbf 真机 140 FAIL：前置文本 `yabzcdw\nmn`，caret 在 `mn` 后，
> ⌃P 再输入 p，期望 `yapbzcdw`（上一行同列 2），实际 `yabpzcdw\nmn`（列 3）；⌃N 后续 q 通过。
> 其余 9 条 composer 自动真机 PASS、0 INVALID。」并指令「新 findings 直接安排修复，合同先行且
> 不弱化真机断言」。节点 2（归档评审）：五要件记录见下节（2026-11-19，M840）。

## 节点 2 记录（归档前，2026-11-19，M840）

口径见 [openspec-workflow.md](../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 由 Alex 在真机 dogfood 中直接指令（2026-11-19，见本文开头记录的原话与读数：「⌃P 再输入 p，期望 `yapbzcdw`（上一行同列 2），实际 `yabpzcdw\nmn`（列 3）」），并指令「新 findings 直接安排修复，合同先行且不弱化真机断言」。实现期没有静默扩 scope：`git diff --name-only 73efbdbd...5f3f81f9` 恰为声明的 11 个文件，生产代码只动 `src/harness-composer.ts`，其余为单测 / 双引擎场景 / 140 场景 / 合同 / tasks / `playwright.config.ts` 并集；无 `src-tauri`、依赖或像素基线改动。
2. **独立 reviewer clean / merge**：r1 `reviewer-composer-vertical-column` 判 `status: p2-2items` / `fix-then-merge`（P2-1 软折行边界丢 `assoc`、P2-2 tasks 读数），以 `eb6ab215` 修完后：`reviewer-vertical-final` 在 tip `1c02d8576455452270068648bbe656493506a4c3` 判 `clean` / `merge`；rebase 到 M832 合并后的 master 后，`reviewer-vertical-rebase` 在最终 tip `5f3f81f9c5af8464be24cc059a64a9cdde601cf9` 判 `clean` / `merge`，并以 `git range-diff` 确认生产代码相对上一轮 clean tip 逐字节未变。评审文件 `/Users/boxcounter/Code/Boxcounter/lumir/.tower/comms/reviews/review-feat-fix-composer-vertical-goal-column-nov19-reviewer-vertical-final-r1.md` 与 `…-reviewer-vertical-rebase-r1.md`。合并提交 `79e8815d` 的第二父即 `5f3f81f9`，评审绑定内容与合入内容同一份。
3. **tasks 完成**：`tasks.md` 13/13 全勾，无放弃项；r1 P2-2 要求的 rebase 后 `GATE RESULT` 读数已记入 tasks（quick 13/13、visual 15/15、visual-regression 979 passed / 5 skipped / 0 failed、目标双引擎 34 passed / 4 skipped）。
4. **要求的门禁与真机证据**：最终 tip `5f3f81f9`：`quick` `GATE RESULT: 13/13 PASS（SKIP 0）` 退出码 0；`visual` `GATE RESULT: 15/15 PASS（SKIP 0）` 退出码 0（`LUMIR_VISUAL_PORT=4273`，未更新任何基线）。真机 140 PASS、13 断言、0 失败（`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-m834/summary.md`；`⌃P` 列 2 正向 `yapbzcdw` 与像素口径缺陷签名 `yabpzcdw` 不在场均 PASS）；合并后 master `ee742606` 上复跑 140 仍 PASS 13 断言（`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-editor-trust-final/`）。门禁读数本身记于 `tasks.md`（M834 的 gate 原始日志未落 `.local/`，reviewer-vertical-rebase 按 review-request 的计数逐项核对过同一组数字）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过 9 份 delta，6 条 MODIFIED，对比 79 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`（退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 36 passed, 0 failed (36 items)`（退出码 0）；`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。delta 为 1 条 ADDED（`composer 竖直移动的同列位口径`），是真实增量。与已先归档的「CM composer 的 Emacs 文本导航族」并读：本条把竖直移动的列位单位收敛为行内字符列（行选择仍可用引擎竖直原语），是更具体的补充条款，两者同禁 DOM caret 模型，不构成互斥；旧「同 x 位」措辞已随 composer 内核换代在上一项归档中退役，本条是唯一的竖直列位口径。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与 tip 均无异常、证据无缺口——机器 + 独立评审放行（本节要件）。

## Why

M831（change `move-composer-to-codemirror-nov18`）把 composer 换成 CM6 文本内核，⌃P / ⌃N 直接
映射到 `cursorLineUp` / `cursorLineDown`。CM 的竖直移动把 goal column 当**像素 x**
（`view.moveVertically` 用 `coordsAtPos` 测光标左缘、落点用 `posAtCoords` 取最近字符边界）。

composer 的字体是比例字体（`--font-sans`，13px SF Pro）。真机 140 的现场：

| 量 | 值 |
|---|---|
| 第二段 `mn` 行尾 caret 的字符边界 x | contentLeft + 18.75px |
| 第一段 `yabzcdw` 的字符边界 | 0 / 6.72 / 13.81 / 21.53 / … |
| 18.75 的最近边界 | 21.53（列 3）而不是 13.81（列 2） |

于是「同列 2」按 ⌃P 变成列 3：`yapbzcdw` → `yabpzcdw`。修复前双引擎探针（Chromium + 真机同款
UA 的 WebKit）读数一致：`moveVertically` 落点 head=3、`goalColumn=18.75`；键入 p 得 `yabpzcdw`。

同一现场在换内核前是绿的：140 在 `.local/acceptance/2026-10-28-m767-chord/` 全 PASS，旧实现
`caretRangeFromPoint` 在同一 x 上两个引擎都返回 pos 2（引擎取整向左），所以「列 2」不是偶然的
绿线，而是当时真机上实际交付的行为。M457 的「同 x 位」措辞因此与真机交付的字符列口径并存，
本 change 把口径收敛到**行内字符列**（Emacs `previous-line` / `next-line` 的 goal column 语义）。

## What Changes

1. `src/harness-composer.ts`：⌃P / ⌃N 与 ⇧⌃P / ⇧⌃N 改为「行选交给 CM、列位按行内字符列」——
   `moveVertically` 只用来选目标渲染行，落点按 `moveToLineBoundary(..., includeWrap)` 取到的行端
   与字符列重算；goal column 以字符数沿用 `SelectionRange.goalColumn`（调用 `moveVertically` 前
   剥掉，避免被当像素）。
2. 语义边界不变：非空选区先折叠、文档首 / 末行回落行首 / 行尾、扩选 anchor 不动、导航只写
   selection（不产生编辑 history）、软折行仍逐渲染行移动。
3. `docs/specs/harness-composer.md` HC1 增第 5 条（合同先行），140 场景补负向断言（像素口径的
   缺陷签名不在场），不弱化原正向断言。
4. 单测与浏览器回归：composer-nav 单测的假 view 改为像素 goal column 模型（否则列位断言修前也绿，
   是假绿），新增 9 条列位用例；m831 视觉场景新增 5 条浏览器回归（Chromium + WebKit 实跑）。

## Non-goals

- 不改编辑器正文（`src/editor.ts`）的竖直移动口径——它的 goal column 仍是 CM 像素语义，本 change
  只约束 composer。
- 不引入 DOM caret 模型、不读 DOM Range 几何、不重建 M457 的 `caretRangeFromPoint` 路径。
- 不改键位表、不改 AX 判据通道、不更新像素基线。
