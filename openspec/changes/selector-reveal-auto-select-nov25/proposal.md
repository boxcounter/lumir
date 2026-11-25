# Proposal: 选择器揭示几何与 Skill 高亮/武装分离

- Change ID: `selector-reveal-auto-select-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（缺陷报告与方案裁决「选择器按推荐」），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 批准以下合同，不另扩大——① 真实 clip = `menuRect ∩ panelRect ∩ viewport`，Skill 允许
> 覆盖 transcript、不被 composer / 面板裁切，可见时不动、越界留一行上下文；② 揭示逻辑与测试
> Skill / wikilink 共用，wikilink 先恢复 `max-height` 再揭示；③ Skill 拆 `highlighted` 与 `armed`，
> 异步 catalog 只改前者，Enter / Tab 只在武装态接受，全名自动接受是已批准行为；④ 游标 / ARIA 一致、
> hover 不抹掉 active、保留两种已登记呈现；⑤ 新建 `docs/specs/selector-contract.md` 作统一合同居所。

> 节点 2（归档放行，2026-11-25）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md` 五要件）。
> 1. **方案已批准**：节点 1 Alex 2026-11-25 原话「选择器按推荐」；实现期新增项（F1–F9 / R1–R3 /
>    N1–N6 / T1–T2）全部落在已批准合同内，无静默扩 scope。
> 2. **独立 reviewer clean / merge**：tower 主模型 verdict **clean，ready for OpenSpec 节点 2 与归档**，
>    绑定 tip `b80b0d948a9f919cfe0ecbdf21a88684467cee61`，P1 / P2 / P3 无；
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/selector-scroll-auto-select-nov25/tower-verdict.md`；
>    机械复核同目录 `mechanical.md`。
> 3. **tasks 完成**：`tasks.md` 全部勾选（含 F1–F9 / R1–R3 / N1–N6 / T1–T2 收口，以及最终门禁 /
>    真机 / 归档三项由本批收口），无放弃项。
> 4. **门禁与真机证据**：完整 `GATE RESULT: 15/15 PASS（SKIP 0）`、exit 0
>    （`/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/selector-scroll-auto-select-nov25/gate-visual-final.log`）；
>    真机 867 / 868 **PASS 2 / FAIL 0**、40 / 55 断言
>    （`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-selector-scroll-auto-select-r2/`）。
>    辅助读数：unit 2009 / 0、Skill 68、wikilink 40、docs-check PASS、acceptance 254 / 0；视觉基线未更新。
> 5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式
>    `PASS（扫过 13 份 delta，18 条 MODIFIED，对比 435 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`；
>    `validate --all --strict` 39 passed / 0 failed；`bash scripts/docs-check.sh` PASS。本 change 的 delta =
>    `harness` 1 条 MODIFIED + `wikilink-suggestion` 1 条 MODIFIED。

## Why

同一根因在两条链路上各报了一次：

1. **Skill 候选「少滚一项」**：`placeSkillMenu()` 以 composer 区为垂直夹取宿主，把 200px 高的菜单钉在
   composer 区顶部；`.lumir-harness { overflow: hidden }` 把底部约两行裁掉，而揭示判据只看菜单自身的
   `clientHeight`。落在「盒内、屏外」带里的选项被判为已完整可见 → 不滚；再移一项才触到盒底 → 滚一格。
   真机 868 截图里选中行在屏幕上根本看不见，就是这个时间差。
2. **wikilink 揭示每次都被自己抹掉**：`render()` 先 `scrollIntoView`，紧接着 `schedulePlace()` 清掉
   `max-height`；列表从「可滚」变成「内容自适应高」，`scrollTop` 同步归零，长列表的滚动位置永远累积
   不起来。
3. **Skill 自动选中缺失**：`openSkillMenu()` 固定返回无高亮，`syncSkillMenu()` 每次文档变化都重建状态，
   于是收窄到目标后没有预选、用户已用方向键选中的项下一次键入也被抹掉，异步 catalog 回包同样抹高亮。

单独补任何一处都只会换一个形态再现：盒越界时滚不动、时序反了时滚了也白滚、状态只有「高亮」一个位时
视觉预选必然改变 Enter 的承诺。因此本 change 先立合同与共享纯函数，再接两条链路。

## What Changes

- 新增 `docs/specs/selector-contract.md`：游标 / 武装 / 真实 clip / 最小揭示 / IME / ARIA / 两种游标呈现
  的统一不变量；其它选择器由并行 change 引用，不重抄条款。
- 新增 `src/selector-reveal.ts`：`revealScrollTop`（纯函数）与 `revealElementWithin`（DOM 适配），
  Skill 与 wikilink 共用同一份揭示几何。
- Skill 候选：盒改以面板矩形 + 视口夹取，必要时收缩 `max-height`，允许向上覆盖 transcript；行高与高度
  用实测值，删掉硬编码 `32`；揭示改用真实 clip 与一行上下文。
- Skill 状态机：`SkillMenuState` 增 `armed`；query 变化自动视觉高亮（全名项 > 按名字保留 > 首项），
  武装只由方向键 / `⌃N`·`⌃P` / 真实指针移动 / 全名成立；异步 catalog 只保留高亮，不把未武装改成武装。
  候选根节点暴露 `data-armed` 供机器断言（非视觉差异）。
- wikilink：去掉 `scrollIntoView`；`schedulePlace` 先记 `scrollTop`，写回定高后再恢复并按真实可见带揭示。
- 测试：新增 `tests/unit/selector-reveal.test.ts`；重写 `tests/unit/skill-menu.test.ts` 为状态矩阵；
  `tests/visual/scenes/skill-hybrid.spec.ts` 的 oracle 改为真实 clip 并新增短视口 / 三主题 / 缩放 /
  全名 / 异步 / 可见最底项用例；`wikilink-suggestion.spec.ts` 新增 30 项长列表逐项导航。
- 验收场景 867 / 868 更新导航预期与截图步；真机执行留给主会话串行。

## Non-goals

- 不统一四个选择器的初态、空态、hover 策略或视觉呈现；Quick Open / TOC / Vault 的接入是并行 change。
- 不把游标改成左竖条一种呈现：单行 band 与两列 bar 两种已登记变体都保留。
- 不改 wikilink 的匹配、接受、空态与 IME 冻结语义；不改 Skill 的 grammar、过滤、chip、发送与权限链路。
- 不更新视觉基线；若像素层因盒位置上移而变化，只生成候选截图交 Alex 过目。

## Impact

- 影响的 specs：`harness`（Skill 混合调用、入口策略与候选交互）、`wikilink-suggestion`（候选浮层几何）。
- 影响的代码：`src/harness-panel.ts`、`src/skill-menu.ts`、`src/link-suggest.ts`、`src/composition-settle.ts`。
- 关联合同：`docs/specs/selector-contract.md`、`docs/specs/skill-menu.md` S1 / S2。
- 风险：候选盒上移后覆盖 transcript（已批准）；`placeSkillMenu` 每拍一次额外布局读取（与既有揭示同拍）。
