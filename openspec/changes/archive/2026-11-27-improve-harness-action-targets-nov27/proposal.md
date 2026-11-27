# Proposal: 放大 Harness 次级动作命中区而不放大轻量视觉

- Change ID: `improve-harness-action-targets-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **评审记录**：节点 1（提案评审）**已通过**（2026-11-27）。主会话确认 Alex 对既定设计方向回复原文
> 「好，采纳」及治理回复「好，采纳。另外，这些是否需要沉淀成原则/规则/约定？」构成本次既定范围批准。
> 七条方向是：不做 44px 触屏式桌面按钮；分离图标、可见底板与实际命中区；命中区最低 24、Lumir 默认 28；
> 图标保持小巧且复制可用无依赖内联 SVG；透明扩展不改消息行高 / 文档内容且相邻命中区不重叠；
> 保留状态、读屏名、复制反馈与 composer 键盘模型；重点验证 × 及其边缘不触发父卡跳转；现状 / 候选先同屏对比，
> 正式视觉基线另等 Alex 过目。本提案把这些方向转成合同，不新增产品语义。

## Why

次级动作的可点击面积当前明显小于或贴近其紧凑视觉：

- `.lumir-hp-copy`（`src/harness-panel.css:1948`）为 `min-width:24px; height:20px`，图标是 11.5px 档字符 `⧉`
  （`src/harness-panel.ts:7015` 起）。rebase 后的 `.lumir-hp-withdraw`（CSS:1982）是 12px 撤销 SVG +
  20×20px 可见盒（`src/harness-panel.ts:7094` 起）；本 change 只扩它的真实命中层，不恢复旧文字钮。
- composer 的 `.lumir-hp-qc-x`（CSS:2247）真实盒为 16×16px；图片卡的 `@` 也是 16×16px，两者在
  `.lumir-hp-qc-actions` 内恒显（CSS:2273 起）。
- composer 引用卡的父表面有点击跳回原文处理器（`src/harness-panel.ts:5528` 起）。× 虽已有事件隔离，
  但扩大后若透明边缘落到父表面、被裁切或遮住正文，误触代价会直接变成意外跳转或错误移除。

[W3C WCAG 2.2 Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
以 24×24 CSS px 或 spacing 等例外作为最低目标，并明确鼠标 / 触控板同样受益；44×44 属于 Enhanced，
不是本次桌面改造的强制目标。Lumir 选择更严格且明确的桌面默认值 28×28，同时保留小图标与轻量底板。

本提案阶段只完成上述源码 / 规格的只读核对与文档起草；未运行浏览器几何、视觉或真机验证，不预写技术 PASS。

## What Changes

对应 spec delta：新增 harness requirement「Harness 次级动作的视觉与指针命中区」。

1. **三层尺寸合同**：图标视觉、可见按钮底板与实际指针命中区分离。首批消费者是复制、撤回、composer 移除 ×、
   图片 @；命中区默认 28×28 CSS px，任何受限候选均不得低于 24×24。
2. **轻量视觉不变**：复制改为约 14×14px 的无依赖内联 SVG，× 采用约 14px 的紧凑 glyph；现有底板保持轻量。
   复制 / 撤回仍只在 hover / focus-visible 等既有路径显现，Withdraw 不变为常驻大按钮；图片 @ / × 继续恒显。
3. **几何与事件不变量**：命中区不得互相重叠、被祖先裁切、越过容器形成不可达区域或截获正文；
   不改变消息行高、文档内容、卡片块序或 composer 键盘模型。× 的中心和透明边缘都必须只执行移除，不触发父卡跳转。
4. **既有语义不变**：保留现有 accessible name、复制 Markdown 源文本与约 1.5s 成功反馈、撤回 12px 图标 /
   可用性 / disabled 语义、双激活源预览、tail notice 不预览、图片 @ 插入行为及 composer 的 Tab / 选区 / history
   模型。复制成功文案变宽时仍须与撤回命中区不重叠；撤回不恢复文字、不常驻。
5. **可复用治理**：新增 [次级图标动作的指针命中区合同](../../../../docs/specs/pointer-targets.md)，约束今后新增或修改的
   次级图标动作；不要求借本 change 回改全仓。
6. **验收下沉**：真实几何与 `elementFromPoint` / 等效命中测试、真实指针事件、逐条反向必红、现状 / 候选视觉对比、
   真机场景、quick + 完整 visual、独立 K3 代码与视觉终审均列入 tasks；CSS 声明本身不构成命中 PASS。

## Non-goals

- 不把全部按钮视觉放大，不采用触屏式 44×44 桌面按钮；不在本 change 做 coarse pointer / 触屏密度改造。
- 不让复制或撤回常驻，不重新设计 Withdraw 的可见性、确认流程、适用范围或后端语义。
- 不重设计 composer 键盘模型、Tab 序、读屏文案、复制源、撤回逻辑、@ 编号或投递协议。
- 不回改全仓所有小按钮；其他表面仅在以后新增 / 修改对应次级动作时接入 canonical 合同。
- 不把视觉机器 PASS 当作审美批准；未经 Alex 过目，不执行正式基线 `--update`。

## Impact

- 影响的 specs：`harness`（仅新增 delta；活跃期不改 living spec）。
- 新增 canonical 文档：`docs/specs/pointer-targets.md`。
- 实施期预计影响：`src/harness-panel.css`、`src/harness-panel.ts`，对应视觉结构 / 几何 / 命中场景与
  `scripts/acceptance/` 场景；不引入运行时依赖。
- 关联约束：composer 的零长度 widget、scoped AX、单一 history 与键盘合同；视觉基线人肉裁决；
  新断言逐条反向必红；节点 2 的 implemented / released / machine PASS / native PASS / archived 状态分列。
- **实施边界**：提案阶段只交付文档；生产实施在依赖合并并 rebase 后进行。完整视觉与真机由主会话另行安排，
  本 change 不更新正式基线；归档由收口任务执行，本任务不 merge、push。

## 实施依赖

`clarify-harness-withdraw-scope-nov27` 已合并并推送。本分支已 rebase 到 master
`f458ace707d5ef2f0574b3f7289c095117cfc75b`，rebase 后 tip 为 `83f545f26935c6a69556cb95113d761c2c287bc8`；
range-diff 的五个提交全部为 `=`，未改变生产代码、测试或文档 patch（
`.local/reviews/harness-action-targets-nov27/logs/range-diff-rebase-master.log`）。
最终撤回入口是 12px 撤销 SVG、20×20 可见盒，读屏名「撤回这一轮」；预览保留
pointer / focus 双激活源，tail notice 在场时整段不预览。本 change 只扩命中层至 28×28，不回退上述任何行为。
原提案所列冲突面已按最终实现重读；此更新只修正现状，不新增产品语义。

## 真机首轮归因与修复（0/3 → 3/3）

首轮 0/3 经逐条读取 steps / AX / 截图后全部归为**测试 oracle / 前置缺陷**，未发现产品缺陷或环境 INVALID，
生产代码未因这些红发生二次修改：

- **81**：卡片摘录已是 composer 内的 AXStaticText，旧断言却找 `AXTextArea = "Q…"`。改为 composer AXGroup 的
  scoped 判序；另用 `clipboardText(q81) + cgevent ⌘V` 产生可读 value，保留 `notInValue`，编辑器原文不参与。
  中心 / 边缘 × 在首轮即均 PASS。
- **148**：@ 的 CGEvent 落点计算正确，但目标卡被 composer 嵌套滚动区裁在可视区上方；AX 仍给完整 bbox，
  窗口级定位不会处理该层裁切。点击前改为锚定 composer AXTextArea 滚入对应卡，首轮等待 `tag-Image 1` 超时因此消失。
  后半段空 composer 改用 `name:".*", nth:1`，不依赖已不存在的历史文本。
- **882**：立即 mock 在读取前已完成，busy help 不可能成立；新增首个响应 3s 延迟并先等停止 / 撤回节点。
  success 的内部文本受既有 `aria-label=复制消息` 覆盖，没有独立 AX 节点，改判实测扩宽几何 + 截图；disabled
  节点可能无 AX bbox，只保留 busy help + 截图，不伪造几何读数。复制源、success、撤回及重发行为均 PASS。

每个新增 / 修改真机断言均做了反向必红与恢复绿；8 份红日志在
`.local/reviews/harness-action-targets-nov27/logs/native-reverse-*.log`。最终跑批与 success 复核路径见下方状态表。

## 独立评审处理（r2 clean/merge）

原独立 K3 verdict 为 `findings`（绑定 `1687220d`，`.local/reviews/harness-action-targets-nov27/independent-review.md`），
两项均为测试 / 证据缺口，不是已复现的产品回归：

- **P2-1 已补持久覆盖**：目标 spec 以共享七点矩阵覆盖引用 ×、图片 @ / × 的中心、四边与近角真实点击；
  每个点位独立判定移除 / 插入副作用。zh / en success 共用同一测试，英文 `✓ Copied` 的动态宽度、撤回让位、
  布局稳定与超时恢复均入仓。目标由 14 条增至 33 条，不依赖 reviewer 的 git 外探针。
- **P2-2 已修正反例**：相邻间距拆出不依赖 `readHits` 的真实矩形用例；disabled 零副作用独立成用例，
  反例红分别在 `horizontalGap >= 2` 与实际 `withdrawCalls`，不再被 misses / focus opacity 提前截断。
  英文宽度、让位、超时恢复与布局分别新增反例。其余既有红日志逐项核对了失败点，未发现另一例同类提前失败。

独立 K3 r2 对 `89a521b83b28972212ac1f6f16c144b9412a5f07` 给出 **clean/merge**：P1 / P2 均为 0，
仅一项非阻塞 P3，即本节点 machine PASS 仍写旧目标 14/14；现已在收口时修正为 33/33。
r2 另独立复跑目标 33/33，并审核代码、反向证据与视觉材料；报告见
`.local/reviews/harness-action-targets-nov27/independent-review-r2.md`。rebase 后 tip `83f545f2`
与评审 tip 的五个提交逐一同 patch，生产行为未改变，既有门禁与 3/3 native 证据继续适用。

## 节点 2：归档记录（实现完成后填写）

口径见 [OpenSpec 流程](../../../../docs/process/openspec-workflow.md)「状态分列」与「失败与 finding 归类」；
视觉候选按本 change 的 canonical 视觉轨单列，不替代五态。

| 状态 | 值 | 证据指针 |
|---|---|---|
| 视觉候选 | 候选已产出并由 worker / K3 r2 实际查看；现有基线在完整 visual 下通过，无需 `--update`，未更新基线；机器 PASS 不替代审美批准 | `.local/reviews/harness-action-targets-nov27/`（before / after 各 24 张 + 三主题并排图）与 `independent-review-r2.md` |
| implemented | 是：rebase 后实施提交 `170cfce4e25069e83e809f3b5af85b1245a2be28`；未合并 | 实现与目标证据见 `.local/reviews/harness-action-targets-nov27/` |
| released | 否：本批不打包 | 不适用：无发布产物 |
| machine PASS | 是：目标 33/33（27.4s）、相关既有 49/49（28.3s）；quick `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0；完整 visual `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0 | `logs/target-review-final-green.log`、`logs/related-review-final.log`、`logs/quick-review-final.log`、`logs/gate-visual-final.log`；原始 visual-regression 为 1975 passed / 13 skipped（`logs/gate-visual-regression-final.log`），均位于 `.local/reviews/harness-action-targets-nov27/` |
| native PASS | 是：81 / 148 / 882 串行 3/3 PASS；882 success 截图另复跑 PASS | `.local/acceptance/2026-11-27-harness-action-targets-final/`（19 / 33 / 22 断言；各 status.txt=PASS）与 `.local/acceptance/2026-11-27-harness-action-targets-882-shot-final-r2/` |
| archived | 是：归档提交 `0c5dc639a2b36af57bfae3b5b1fe785cb60a47c8`，修正后首次 `--archived` PASS | `logs/archive-check-archived-pass-r1.log`：0 条 MODIFIED / 对比 0 段 / 人工恢复 0 / 声明认领 0；日志位于 `.local/reviews/harness-action-targets-nov27/` |

未发生项已写明原因，不留空；后续失败项按产品缺陷 / 测试 oracle 缺陷 / 环境 INVALID / 需求或视觉迭代四类归因。

- **归档前五要件**：机器 + 独立评审放行。
  1. 节点 1 已由 Alex「好，采纳」批准，实现期未扩 scope。
  2. 独立 K3 r2 clean/merge，P1 / P2 为 0，评审 tip `89a521b8`；rebase 后 `83f545f2` 与其逐提交同 patch，P3 文档计数已修。
  3. tasks 已逐项完成；7.2 / 7.3 已在归档执行及审计后回填，7.4 因本任务不 merge / push 而明确标为不适用。
  4. quick 与完整 visual 的 `GATE RESULT` 原文、退出码及 native 3/3 证据见状态表，完整视觉日志已落 `.local/reviews/harness-action-targets-nov27/logs/`。
  5. 归档前 archive-check 门禁模式 PASS：扫过 9 份 delta、7 条 MODIFIED、对比 109 段、无静默丢段；
     strict validate 为 `Totals: 39 passed, 0 failed (39 items)`；docs-check PASS，backlog 为 80 行且本 change
     在归档跟踪队列恰好一条。原始日志为 `logs/archive-check-pre-final.log`、`logs/validate-archive-final.log`、
     `logs/docs-check-archive-final.log`。
- **归档后**：归档提交为 `0c5dc639a2b36af57bfae3b5b1fe785cb60a47c8`。包装器实际输出
  `harness: update`、`+ 1 added`、`Totals: + 1, ~ 0, - 0, → 0`，归档目录为
  `openspec/changes/archive/2026-11-27-improve-harness-action-targets-nov27/`；自动修链 4 处
  （扫过 4 篇 Markdown / 4 条相对链接）。包装器随后发现 living spec 的一条 delta 深度链接不可达并 exit 1；
  初次 `--archived` 又判出归档 delta 与 living 的相对链接深度不同会造成段落原文不一致。为同时满足 links 与归档审计，
  两侧同一 requirement 的合同引用已统一为仓内路径文本 `docs/specs/pointer-targets.md`，规格语义不变；
  复跑 `openspec-links: PASS（校验 716 条相对链接，全部可达）`。修正后首次 `--archived` 于 2026-11-27 PASS：
  0 条 MODIFIED / 对比 0 段 / 人工恢复 0 / 声明认领 0。原始输出见
  `.local/reviews/harness-action-targets-nov27/logs/archive-wrapper-final.log`、`archive-check-archived-first.log`、
  `archive-check-archived-pass-r1.log` 与 `openspec-links-archive-final.log`；本次记录回填后再跑最终审计。
