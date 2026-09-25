# Proposal: Heading 层级辨识度——H1–H6 纯字号阶梯（21/18/16/15/14/13，字重统一 650，零装饰）

- Change ID: heading-hierarchy-ramp
- 日期: 2026-09-25
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话：「增加不同层级 heading（H1 H2 H3 ……）的辨识度，现在分不清哪些是 H2，哪些是 H3。」

痛点在现行定义里可逐项指出（信源）：

| 层级 | 现行值 | 出处 |
|---|---|---|
| H1 | 19px / 650 | [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §字号阶梯 |
| H2 | 16.5px / 650 | 同上；与 H3 只差 1.5px |
| H3 | 15px / 650（**与正文同字号**） | 同上；`src/preview/theme.ts:119` |
| H4 / H5 | 15px / 600（阶梯无定义，实现补档） | `src/preview/theme.ts:120-121` |
| H6 | 15px / 600 / italic / `--text-2`（阶梯无定义） | `src/preview/theme.ts:122` |

H2↔H3 是 1.5px 级差 + 同字重，H3–H5 与正文同字号只靠字重——扫读时层级不可预判。

流程：本提案走「先出稿再裁决」（Alex 流程裁决，M224）。三稿对比原型与截图包已过目：
[design/prototypes/heading-hierarchy/](../../../design/prototypes/heading-hierarchy/)
（base 现行对照 + 稿 A 纯字号阶梯 / 稿 B 双族制 / 稿 C 结构信号，× light/dark/eink）。

**裁决记录（2026-09-25，Alex，M224 notes）**：选定**稿 A 纯字号阶梯**——H1–H6 =
21/18/16/15/14/13，级差 3/2/1/1/1，字重统一 650，零装饰。代价 Alex 知情接受：
H4 起字号 ≤ 正文（与正文的区分由 650 vs 400 字重差承担）、字号阶梯新增 4 档 token。
稿 B 的「H1 20px 用 680 违反 ≥21px 规则」子裁决随不选 B 消解；稿 C 的结构线语汇
（H2 底线 / H3 竖杠）放弃。

## What Changes

1. **标题阶梯修订**：编辑器渲染态 H1–H6 的字号（相对 `--editor-font-size` 的 em 比值
   21/18/16/15/14/13）、字重（统一 650）、负字距（-0.009/-0.007/-0.005/-0.004/-0.002/0em）
   逐档重定；H6 的 italic 与 `--text-2` 色退场（零装饰裁决）。（delta：`editor-live-preview` /
   标题层级阶梯）

2. **token 层登记**：`--fs-h1` 19→21、`--fs-h2` 16.5→18，新增 `--fs-h3/h4/h5/h6` =
   16/15/14/13；字号阶梯移除失去唯一消费者的 19 与 16.5 两档（tokens 收敛规则 2：
   每档须有出处/消费者）。[design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md)
   的字号阶梯、字重语义（650 档由「h1/h2/h3」改「h1–h6」）、标题负字距档、统计数同步修订
   （映射表见 design.md §差距映射）。

3. **标题块距补档**：H1–H3 块距保持定稿出处不动（24/9、20/6、16/5）；H4–H6 现行块距为 0
   （`src/preview/livePreview.ts:894-898` 注释：定稿无出处），补为 14/5、12/4、10/4
   （间距阶梯内取值）。

4. **视觉基线整批重建**：标题出现在多个整页场景（typography / markdown-combo / toc-outline
   等），字号变更必然引发整页像素漂移——受影响基线逐个识别后整批重建，**Alex 逐张过目后才
   `--update`**（AGENTS.md 硬规则：基线更新是人肉裁决点；视觉门禁卫生：核对每张受影响基线
   的时间戳随本次更新）。`tests/visual/scenes/typography.spec.ts` 的 heading 计算属性断言
   更新为六档逐档口径。

5. **真机验收场景**：新增 `scripts/acceptance/scenarios/36-heading-hierarchy-ramp.md`
   （H1–H6 fixture + 计算属性断言 + 负向断言旧值不在场），随实现同 PR（AGENTS.md：
   验收场景维护权归新功能 mission）。

## Non-goals

- 不动 doc-title（24/680）与正文、UI 阶梯的其余档；不动 `--editor-font-size` 出厂基准 15px
  （阶梯按 em 比值随动，机制不变）。
- 不引入任何装饰手段承担层级（底线 / 竖杠 / 层级色 / 图标——稿 C 方向已裁决放弃）；
  不动字重阶梯其余档的语义位（550/600/680 等），680「只许 ≥21px」规则不动。
- 不动 toc 大纲浮层、文件树等 chrome 表面的字号（本 change 只改编辑器渲染态标题行）。
- serif 轴（`?body=serif`，不定稿）不动。
- 不做标题折叠、自动编号等结构功能。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED 一条 requirement）
- 影响的代码/系统：`src/style.css`（`--fs-h1/h2` 改值 + 新增 4 档）、`src/preview/theme.ts`
  （`cm-lp-h1..h6`）、`src/preview/livePreview.ts`（标题块距）、
  `docs/specs/design-tokens-v1.md`（阶梯表修订）、`tests/visual/`（断言 + 基线重建）、
  `scripts/acceptance/`（新场景）
- 关联约束：ADR 0002 §6 性能合同（纯样式变更，无新解析/新 IO）；ADR 0003 §3 不改写源文件
  （只改显示层）；ADR 0002 §5 配置即数据（不新增配置项）；视觉门禁分层纪律与基线过目规则
  （AGENTS.md 硬规则）
- 与活跃 change 的关系：`restyle-ui-tokens-v1`（38/40，未归档）登记的 tokens 文档正是本
  change 修订的对象——本 change 实现在其合并之后进行，归档对账时两份 delta 的阶梯口径须一致
  （design.md §差距映射即对账文本）。
