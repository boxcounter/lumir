# Proposal: Skill 候选选中项完整落在真实可见带内（缺陷修复，合同先行）

- Change ID: `fix-skill-visible-selection-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（缺陷报告 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1（提案评审）：缺陷修复，行为依据是已有裁决（`docs/specs/selector-contract.md` C2 / C3 与
> `docs/specs/skill-menu.md` S2，来源为 Alex 2026-11-25「选择器按推荐」），本 change 不引入新的
> 行为裁决，只补判据。实现批与提案同批提交。
> 节点 2（归档评审）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md`「节点 2 五要件」）。
>
> 1. **节点 1**：缺陷修复，行为依据为既有裁决（`docs/specs/selector-contract.md` C2 / C3、
>    `docs/specs/skill-menu.md` S2 / S4；来源 Alex 2026-11-25「选择器按推荐」），本 change 不引入新的行为裁决。
> 2. **独立评审**：K3 **clean / merge**，绑定最终 tip `b2836ffe`；产品 `src/**` 零改动 —— 本 change 只动验收
>    场景、视觉判据与规格文本。两轮 P2 已在 `b2836ffe` 收口：① DPR 口径改为「`webkit-realua` 只覆写
>    `browserName` / `userAgent`，实际 DPR 1」；② 868 的 AX 判据降级为「必要不充分」（曝光窗口比像素可见区
>    多一行：r4 的 `04` 快照暴露 `acc-skill-05`–`09`，像素只显示 `06`–`09`），完整几何归浏览器矩阵。
> 3. **tasks**：3.1 / 3.2 / 3.3 全部完成（3.3 真机 PASS 见下一条）。
> 4. **门禁与真机证据**：完整 `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0，visual-regression 1270s —— **该次
>    门禁绑定 `a79a5f0f`**（产品行为与视觉判据的提交；其后 `5cce6f57` / `b2836ffe` 只改场景文本与措辞，未重跑
>    视觉）。真机 868 最终 **1/1 PASS、97.9s**（场景段 79.6s），日志
>    `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/skill-visible-selection-nov25/native-868.log`，
>    证据 `.local/worktrees/nov25/skill-visible-selection/.local/acceptance/2026-11-25/868-harness-skill-menu-ux-nov25/`
>    （另存 `.local/missions/skill-visible-selection-nov25/acceptance-868/`）；末段三条 AX 暴露断言全 PASS
>    （`acc-skill-11` / `acc-skill-10` 在场、`acc-skill-00` 不在场）。
> 5. **规格对账**：`openspec validate --all --strict` 39/39 PASS；`scripts/openspec-archive-check.mjs` 门禁模式
>    PASS：`openspec-archive-check: PASS（扫过 13 份 delta，12 条 MODIFIED，对比 166 段，无静默丢段；归档队列
>    1 项已完成 change 均有唯一条目）`；delta = `harness` 1 条 ADDED。
>    归档队列条目按「核销即删除、不留索引」处理（backlog 80/80 行硬上限，未新增常驻行）。
>
> 归档后：归档提交与包装器输出、修链读数、`--archived` PASS 读数见下方「归档记录」段。

## Why

### 现象

长真实 Skill 目录里，`⌃N` / `⌃P` 能把候选列表滚动起来，但游标走到「最下面可见项的下一项」时，
选中状态完全看不到：列表仍在滚，选中行落在可见区之外。用户截图现场即此形态（候选盒只露出
`…-06` 到 `…-09` 四行，没有任何一行带选中标记，而 Enter 会接受第 10 项）。

合同已明确禁止这一状态：C3 要求游标 option 完整落在**真实可见带**内并留一行上下文，C2 要求
候选盒本身完整落在裁切祖先与视口内。因此这是缺陷，不是需要重新设计的行为。

### 根因（已机器复现）

把 `src/harness-panel.ts` 的放置与揭示换回 `d0b6927`（用户截图那个 0.16.0 dev 构建：已有 ⌃N/P
导航，但还没有 clip / `max-height` 钳制）后，新增的视觉矩阵 7/7 判红，报错就是缺陷形态：

```
选中项下缘越出真实可见带（Control+n #4 selected=4 scrollTop=0
  menu=643.0..843.0 panel=42.0..775.0 band=646.0..775.0 row={top:774,bottom:806})
```

旧实现有两处与 C2/C3 冲突：

1. **放置**以 composer 区（`caret.top - 6×32 - 4`，下限 `host.top + 8`）为界，不是面板；放不下时
   候选盒高 200px 却从 composer 区顶部起排，盒底伸出面板被 `overflow: hidden` 裁掉。
2. **揭示**把候选自身的 `clientHeight` 当真视口——被祖先裁掉的那一截里的行仍被判「可见」，
   `scrollTop` 停在原地，游标就在屏外。

master（`46d7669`）已由 `selector-scroll-auto-select` 系列修掉这两处（`skillMenuClip` 取
`menuRect ∩ panelRect ∩ viewport`；可用空间不足时收缩 `max-height`；揭示按真实带判）。本 change
**不再改产品行为**——复现只在修前实现上成立。

### 为什么仍要立 change（漏网路径）

缺陷能上线、且真机验收 868 当时判 PASS，有两处判据漏洞：

- **视觉 oracle 与实现同源**：既有 `expectHighlightedVisible` 用 `menuRect ∩ panelRect ∩ viewport`
  求带（与实现同一公式）、不扣滚动口自身的边框 / padding、也不扫其他裁切祖先，且只查
  `aria-selected`、不查 `.is-selected` 是否在同项上。它证明的是「实现和自己一致」。
- **真机场景只留截图**：868 走到末项那一步的断言只有 `shot:`，没有几何或 AX 判据。该轮 r4 的
  「PASS」截图里恰好只有 `…-06`–`…-09` 四行且无选中标记——缺陷在截图里，判据却没看它。

## What Changes

1. **新增视觉矩阵**（`tests/visual/scenes/skill-visible-selection-nov25.spec.ts`，7 条）：30 项真实
   规模合成目录 + 真实量级长描述；`⌃N/⌃P` 与上下两个方向逐拍走完整个列表；每拍断言选中项完整
   落在**独立计算**的真实可见带内、`.is-selected` 与 `aria-selected` 同项、标记线宽 / 颜色 / 底色差
   可辨、候选未横向滚动；另覆盖短视口（500 / 360 + scale 1.5）、异步目录晚到、静止指针停在候选
   上、窄 harness pane（真机 20% 形态）、窗口收缩补揭示。
2. **加固既有 oracle**（`tests/visual/scenes/skill-hybrid.spec.ts` 的 `expectHighlightedVisible`）：
   真实可见带改为「菜单 ∩ 全部裁切祖先 ∩ 视口 − 滚动口边框 / padding」，并断言 `.is-selected`
   与 `aria-selected` 同项。既有 68 条按新判据全绿。
3. **真机分支同行**：把新矩阵挂进 `webkit-realua` project——揭示只写 `scrollTop`，两引擎的滚动
   钳制与子像素取整不同，chromium 绿不替代真实 UA 的 WebKit 分支（该 project 不覆写
   `deviceScaleFactor`，实际 DPR 1）。
4. **合同补判据**（`docs/specs/selector-contract.md` §证伪方式 + `harness` living spec 新增一条
   判据 requirement）：oracle 必须独立于实现；逐拍同时判「完整可见」与「标记同项」；真机场景
   必须给出 AX 暴露判据——它是**必要不充分**判据（不出现 ⇒ 必然不可见；在场 ≠ 整行完整可见），
   不得只留截图，也不得用 AX 暴露冒充完整几何。
5. **真机判据补齐**（只改场景文本，不在本批跑真机）：868 的末项 / 末段步骤从「只留截图」改为
   **AX 暴露**判据——AX 快照按离屏过滤只暴露曝光窗口内的行，而该窗口比像素可见区**多一行**，所以
   它只判「不出现＝必然不可见」这一向（与 867 同一手法）。判据按正反两向成对写并在同一次运行里
   翻面（首段 `acc-skill-00` 在场 / `acc-skill-11` 不在场；末段 `acc-skill-11` 与 `acc-skill-10`
   在场 / `acc-skill-00` 不在场；回退段 `acc-skill-10` 在场 / `acc-skill-00` 不在场）。完整几何仍
   归浏览器矩阵。含本修复的构建上的真机复跑由主会话串行执行（tasks 3.3）。

## Non-goals

- **不改产品行为**：放置侧、揭示算法、`max-height` 钳制、`scrollTop` 语义全部不动——master 已
  满足 C2/C3。若复现中发现 master 仍有反例，停下更新本 proposal 再实现，不静默扩 scope。
- **不改成「每键居中」**：C3 的「带内不动 + 越界留一行上下文」不变。
- **不滚祖先**：揭示只写候选自身 `scrollTop`。
- **不动正式视觉基线**：新增用例不引入整页 / 元素像素基线；既有基线不重截。
- **不改验收场景本体**：868 的 AX 断言需要真机验证，列在 tasks 的真机待办里，不在本批盲改。

## Impact

- 影响的 specs：`harness`（ADDED「Skill 候选可见性的机器判据」）；`docs/specs/selector-contract.md`
  的 §证伪方式（canonical 居所，同步补两条判据）。
- 影响的代码：无产品代码改动。
- 影响的测试：新增 `skill-visible-selection-nov25.spec.ts`；`skill-hybrid.spec.ts` 的 oracle 加固；
  `tests/visual/playwright.config.ts` 的 `webkit-realua` testMatch 扩一项。
- 关联约束：性能合同不涉及（无产品改动）；仓库信息卫生——目录 fixture 全为合成名字 / 描述。
