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
5. **可复用治理**：新增 [次级图标动作的指针命中区合同](../../../docs/specs/pointer-targets.md)，约束今后新增或修改的
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
  本 change 不自行更新正式基线，不在 worker 侧 merge、push 或 archive。

## 实施依赖

`clarify-harness-withdraw-scope-nov27` 已合并并推送，主仓 master 为 `b6fe012b`；本分支已完成 `git rebase master`
并撤回最终 living / 实现。最终撤回入口是 12px 撤销 SVG、20×20 可见盒，读屏名「撤回这一轮」；预览保留
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

## 节点 2：归档记录（实现完成后填写）

口径见 [OpenSpec 流程](../../../docs/process/openspec-workflow.md)「状态分列」与「失败与 finding 归类」；
视觉候选按本 change 的 canonical 视觉轨单列，不替代五态。

| 状态 | 值 | 证据指针 |
|---|---|---|
| 视觉候选 | 候选已产出并由 worker 实际查看；**待 Alex / 独立视觉终审，未更新基线** | `.local/reviews/harness-action-targets-nov27/`（before / after 各 24 张 + 三主题并排图） |
| implemented | 是：worker 分支实施提交 `4f75e6fedf1ad01205a84ee04b649330763f6a6a`；未合并 | 实现与目标证据见 `.local/reviews/harness-action-targets-nov27/` |
| released | 否：本批不打包 | 不适用：无发布产物 |
| machine PASS | **部分通过，完整项未齐**：目标 14/14、相关既有 49/49、quick PASS；完整 visual 待主会话 | `GATE RESULT: 13/13 PASS（SKIP 0）`，quick 退出码 0；`.local/reviews/harness-action-targets-nov27/logs/` |
| native PASS | 是：81 / 148 / 882 串行 3/3 PASS；882 success 截图另复跑 PASS | `.local/acceptance/2026-11-27-harness-action-targets-final/`（19 / 33 / 22 断言；各 status.txt=PASS）与 `.local/acceptance/2026-11-27-harness-action-targets-882-shot-final-r2/` |
| archived | 否：待归档 | 未 archive；无 `--archived` 读数 |

未发生项已写明原因，不留空；后续失败项按产品缺陷 / 测试 oracle 缺陷 / 环境 INVALID / 需求或视觉迭代四类归因。

- **归档前五要件**：待实施完成后逐项填写节点 1 依据、独立 reviewer verdict 与绑定 tip、tasks 对账、门禁 / 真机证据、
  规格对账三项读数；当前不预写通过。
- **归档后**：待归档提交后补包装器实际输出、修链读数、归档提交 hash 与 `--archived` PASS；当前不预写通过。
