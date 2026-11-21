# Proposal: 标签右键菜单的「关闭全部标签」

- Change ID: `close-all-tabs-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（需求 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：Alex 的需求原话由本 mission（`close-all-tabs-nov21`）转述：
> 「TAB 右键 Close all tabs（复用逐个 dirty 确认）」。需求直接给出了动作、范围语义的落点
> （「右键所在 pane / 当前标签组」）与确认流的复用要求，本 proposal 按这条原话的最小读法
> 落地；D1–D3 是实现期确定的三个**行为细节**，列在文末供节点 1 复核。
> 返修 r1（2026-11-21，独立 review P2-1 / P3-1）：P2-1 坐实「批量停手后焦点落到 `body`」——
> 确认浮条的动作钮在答复时随浮条从 DOM 移除，原 D2 与 delta 声称的「停在浮条上」不成立；
> 已改为「收尾（全关完或停手）统一归还焦点：文档会话→编辑器正文，图片会话→标签按钮」，
> 并在浏览器层补取消 / dismiss / 保存冲突 / 写失败四条真实 `document.activeElement` 回归。
> P3-1 修正 delta 里「四条关闭项都锚定右键标签」的表述，Close All 的范围单列。
> 节点 1 批准推进：Alex 需求原话（见上）+「请你继续」；两条菜单元素级基线的更新另经 Alex
> 「允许」（`985ab07f`）。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 需求原话「TAB 右键 Close all tabs（复用逐个
   dirty 确认）」+「请你继续」批准推进（见上方「评审记录」）；D1–D3 三个行为细节按 proposal 文末
   的倾向落地。实现期没有静默扩 scope：产品改动只有 `src/tabs.ts` 的第五项 / `closeAllTargets` /
   批量收尾焦点、`src/copy-data.ts` D946 与 `文案-Copy.md`，对应「What Changes」；r1 评审
   P2-1/P3-1 的返修（停手归还焦点、范围表述）在既有意图内，未新增产品行为。
2. **独立 reviewer clean / merge**：独立 reviewer agent-35 判 `clean/merge`，无 P1 / P2 findings，
   绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/navigation-batch-nov21/review-final.md`
   （明记「两张菜单基线已获 Alex 批准并更新」）。当前分支 tip 与该评审 tip 相同。
3. **tasks 完成**：`tasks.md` 31/32 勾选——唯一未勾项 8.1 就是**归档命令本身**
   （`openspec archive close-all-tabs-nov21`），在本批归档成功后补勾；不属放弃项。其余 31 项
   （含 5.4 真机、6.4 基线、6.6 证据对账）均已勾并就地补证据指针。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/tab-menu.spec.ts` 与两张元素级基线，按
   `scripts/gate.sh visual` 档取读数——`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（含像素层；
   基线 `985ab07f` 经 Alex 过目「允许」）。真机场景 `50-tab-context-menu` PASS（79 断言，0 FAIL；
   `status.txt` = `PASS`），覆盖 Close / Close Other / Close Right / Close All 四条路径与脏标签
   取消即停手，证据
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/50-tab-context-menu/`
   （`steps.md` / `shots/` / `ax/`）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   11 份 delta，11 条 MODIFIED，对比 204 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目`
   （退出码 0；本 change 因 8.1 未勾不进入「已完成」面，归档与勾选同一提交，无台账窗口）；
   `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 38 passed, 0 failed
   (38 items)`（退出码 0）。delta 是 `multi-tabs` 的 1 条 MODIFIED（「标签的关闭操作」整条复制后
   改，保留既有全部场景），是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：视觉基线更新已单独获 Alex「允许」，无未决的价值 / 行为裁决、
无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## 节点 2 记录（归档后，2026-11-21）

- **归档提交**：`689598c5579c629f38020099d4f150b1a807e345`（归档目录 + 并入后的
  `openspec/specs/multi-tabs/spec.md`；8.1 的勾选在本归档命令成功后写入，随同一提交；本段记录
  本身是其后一笔文档提交，审计仍定位该归档提交）。
- **`openspec archive` 实际输出**（`node scripts/openspec-archive.mjs close-all-tabs-nov21`，
  退出码 0）：`Task status: 31/32 tasks` / `Warning: 1 incomplete task(s) found. Continuing due to
  --yes flag.` / `Specs to update:` / `multi-tabs: update` / `~ 1 modified` /
  `Totals: + 0, ~ 1, - 0, → 0` / `Specs updated successfully.` /
  `Change 'close-all-tabs-nov21' archived as '2026-11-21-close-all-tabs-nov21'.`。唯一未勾项即
  8.1（归档命令本身），归档成功后补勾；归档后 `tasks.md` 32/32。
- **归档后修链**：`归档后修链 2 处（扫过 3 篇 Markdown / 2 条相对链接）`——
  `proposal.md:19` 与 `proposal.md:24` 的 `../../../docs/process/openspec-workflow.md` →
  `../../../../docs/process/openspec-workflow.md`。包装器末置门禁
  `openspec-links: PASS（校验 650 条相对链接，全部可达）`。
- **归档后审计**（`node scripts/openspec-archive-check.mjs --archived close-all-tabs-nov21`，
  2026-11-21T14:34Z，退出码 0）：
  `PASS（openspec/changes/archive/2026-11-21-close-all-tabs-nov21：1 条 MODIFIED，对比 24 段；
  人工恢复 0 段，声明认领 0 段）`——MODIFIED 的段落全部落进归档后的 living spec，无静默丢段。
- **归档后复跑读数**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` →
  `Totals: 37 passed, 0 failed (37 items)`（退出码 0）；`node scripts/openspec-archive-check.mjs`
  门禁模式 → PASS（`扫过 10 份 delta，10 条 MODIFIED，对比 180 段，无静默丢段；归档队列 0 项已完成
  change 均有唯一条目`）；`bash scripts/docs-check.sh` → `docs-check: PASS`（退出码 0）。

## Why

标签右键菜单已有四条项：Reveal in File Tree / Close / Close Other Tabs / Close Tabs to the
Right。日常「收工」要关掉一整组标签时，菜单里没有一次到位的入口：用户只能在
Close Other Tabs 与 Close Tabs to the Right 之间组合，或者逐条按 ×（每条脏标签各弹一次确认）。
带脏标签时这个组合路径尤其别扭——用户想表达的是「这一组我不要了」，却要先想清楚用哪一条
批量项才能覆盖全部标签。

真实风险不是少一个便利项，而是**用户为了关完而绕过确认**：逐条点 × 的路径里，每一条脏标签
都要答一次浮条；没有「一次关完、逐条确认」的入口时，用户更可能先手动放弃修改再关，丢掉
本可以保存的内容。新增项把「范围」与「逐条确认」拆开：范围一次到位，确认仍然逐条。

## What Changes

- 标签右键菜单在关闭块末尾追加第五项 **Close All Tabs**（D946，上屏列锁定 en，与 D149–D151
  同一条口径）。
- 关闭范围 = **右键所在 pane 的标签条上的全部标签**（含右键那一条）。双 pane 时另一个 pane 的
  标签不受影响——每个 pane 一个 `createTabs` 实例，`editor.sessions()` 就是该 pane 的会话表，
  范围是实例边界而不是新参数。
- 确认流**原样复用** `closeTab` 的逐脏确认（sticky 浮条 D92 + 三出口 D93.1–D93.3），不新造
  保存 / 放弃 / 取消 UI；批量关闭经既有的 `closeEach` 顺序提交，同一时刻只有一条确认。
- 取消 / 点掉浮条即停手：当前与尚未处理的标签保留，**已经成功关闭的不回滚**；保存未闭环
  （冲突 / 写失败）时该标签不关、批量停手。
- 批量收尾**统一归还一次焦点**（全部关完与中途停手都一样）：确认浮条的动作钮随答复从 DOM
  移除，浏览器会把焦点送回 `body`；收尾时前台是文档会话（含全关完后的未命名空文档）就交给
  编辑器正文，前台是图片会话就交给那一条标签的按钮。保存冲突 / 写失败的提示是非模态浮条
  （既有合同是不夺焦），停手时保持可见。焦点 MUST NOT 跨到另一个 pane。
- vault 外只读会话、图片会话沿用 `closeTab` 的既有语义（恒无未保存内容，直接关闭、不弹确认）。

对应 spec delta：`openspec/changes/close-all-tabs-nov21/specs/multi-tabs/spec.md`，整块替换
living 的「标签的关闭操作」一条（新增第五项、范围与收尾语义、五条 scenario）。

## 不做什么

- **不新增确认 UI / 不改确认文案**：批量关闭的每个脏标签都走 M149 的 sticky 浮条；本 change
  不引入「一次性总确认」（例如「3 个标签有未保存修改，全部关闭？」）——那会把「逐条决定
  保存 / 放弃」压成一次总答复，与本需求「复用逐个 dirty 确认」相反。
- **不引入批量保存**：保存仍按标签逐个走既有落点（`saveThenClose` 先激活该标签再存）。
- **不做键盘快捷键 / 命令面板入口**：本 change 只加菜单项，命令族与键位表不动。
- **不改 Close / Close Other Tabs / Close Tabs to the Right 的语义与相对顺序**（新项只追加在
  关闭块末尾，既有四条项的位置一个都没动）。
- **不改跨 pane 的标签移动 / 归属**（`pane-layout` 不受影响）。

## 裁决点（供节点 1 复核）

- **D1：菜单项的位置**——追加在关闭块末尾（Reveal / Close / Close Other / Close Right /
  Close All）。理由：范围最大的项放最后，既有四项的相对顺序与肌肉记忆零变化；菜单没有分隔线，
  关闭块保持连续。
- **D2：批量收尾的焦点落点**（返修 r1 修订）——全关完与中途停手都归还一次焦点：文档会话
  →该 pane 的编辑器正文（`focusPreservingReadingPosition`，不改变阅读位置）；图片会话→那一条
  标签的按钮。理由：菜单与确认浮条关闭后键盘必须还能继续用；确认按钮在答复那一刻已从 DOM
  移除，r1 实测焦点落到 `body`，原「留在浮条上」的说法不成立。保存冲突 / 写失败提示保持既有
  非模态合同（不夺焦），焦点仍回编辑器。
- **D3：范围口径**——「本 pane 的全部可见标签（含右键那一条）」。不做「保留右键那一条」的变体：
  那是 Close Other Tabs 已经表达的语义；本项要表达的是「这一组全部关掉」。

## 影响面

- 代码：`src/tabs.ts`（项集、动作、目标集合、批量收尾）、`src/main.ts`（注入 `focusEditor`）。
- 文案：`src/copy-data.ts` D946 + `文案-Copy.md`（行、末位、分配记录、映射表）。
- 测试：`tests/unit/{tab-menu,tabs,copy}.test.ts`、`tests/visual/scenes/tab-menu.spec.ts`、
  真机场景 `scripts/acceptance/scenarios/50-tab-context-menu.md`。
- 视觉基线：菜单元素级基线（`tab-menu.png` / `tab-menu-close-right-active.png`）因多一行而变化，
  按「基线更新是人肉裁决点」留给 Alex 过目后更新；整页基线不受影响（菜单只在打开时出现）。
