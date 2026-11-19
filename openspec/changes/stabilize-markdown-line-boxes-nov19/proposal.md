# Proposal: 稳定 Markdown 光标进出时的行盒

- Change ID: `stabilize-markdown-line-boxes-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始需求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对 M842 实测缺陷的裁决——光标进出导致行高变化是不稳定负面体验，须修掉链接尾标与裸 marker 两处；并明确选择去掉链接尾标的 `super` 抬升，不保留上浮后补偿行盒。本 change 不新增产品行为或裁决点。

## Why

M842 的双引擎几何矩阵实测到两处 2px 抖动：链接尾标的 `vertical-align: super` 使渲染态行盒比源码显露态高 2px；裸 marker 行在编辑态切入列表渲染后由 33.5px 变为 35.5px。修复期进一步定位到后者的 2px 来自编辑态新增 `cm-lp-list-first` 的 `padding-top: 2px`，并非 marker 的 `inline-flex` 盒。两处都会推动后续行上下移动，且随光标反复进出重复发生。

## What Changes

- 同一文档在同一主题下，光标或焦点切换 MUST NOT 改变链接行与裸 marker 行的行盒高度、文本基线或后续行 top。
- 链接尾标取消 `super` 抬升，保留既有符号、链接样式与激活路径；裸 marker 保留编辑态列表 widget 与 marker 视觉语义，只约束其行盒参与方式。
- 源码显露产生的横向变化与合法换行仍按既有合同处理；不全局统一 Markdown 行高，不引入运行时几何补偿或第二条渲染路径。
- 将 M842 两处允许纵向重排的断言改为稳定断言，并覆盖 light/eink、反复光标循环与失焦/聚焦；不新增或更新像素基线。

## Non-goals

- 不改变链接分类、点击激活、源码显露范围或裸 marker 的列表编辑语义。
- 不重排普通列表、表格、标题或其他 Markdown 构造。
- 不新增真机手感判据；如需真机复验，由 tower 另行安排窗口。

## Impact

- 影响的 spec：editor-live-preview。
- 影响的代码：`src/style.css`。
- 回归：`tests/visual/scenes/markdown-editing-stability.spec.ts`，Chromium 与真机同款 UA 的 Playwright WebKit。
