# Proposal: Markdown 不折行时把可见正文窗口收进阅读栏 X

- Change ID: clip-markdown-content-to-reading-width-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（方向批准），AI agent（合同与实现）

## Why

当前 Markdown `line_wrap=false` 把自然长行溢出交给外层 `.cm-scroller`。横滚因此移动整条居中阅读列，文字可绘制到 X 之外，doc-title/END 也随列移走。原始生产探针在 1200 窗口、X=760 时读到外层 `scrollWidth/clientWidth=5077/964`，`scrollLeft=500` 后 content/title/END 的左缘同时从 338 移到 −162；滚到最右时 content 右缘为 −3015。证据：主仓 `.local/reviews/markdown-visible-width-nov27/exploratory-probe.log`。

Alex 已明确批准根方向：**宽度 X 在折行时决定折行；不折行时也只在 X 内显示，超出部分通过左右滑动在 X 内到达。自然行宽可以大于 X，但任何滚动位置都不应在 X 的可视窗口之外绘制。** 本 change 不再用自然宽度回答可见性。

CSS Overflow 的 scrollport 定义、CodeMirror 的 scrollDOM/contentDOM 结构与成熟写作器的块级横滚材料已读原文，见主仓 `.local/reports/markdown-editor-width-practices-nov27/`。

## What Changes

1. Markdown nowrap 的 `.cm-content` 成为横向 scrollport：grid 中列仍是 X，行盒保持自然宽，超出部分只在 contentDOM 内横滚；外层 `.cm-scroller` 不再承担这条正文横滚。
2. 通过 CM 公开 `EditorView.scrollHandler` 把 caret/选区/search 的横向揭示路由到 contentDOM；纵向仍由外层 scrollDOM 与 CM 默认路径承担。
3. 阅读位置与会话内存快照记录真实横向 scrollport 的 x；content scroll 事件进入既有捕获/防抖链。装载新文档仍复位到篇首与横滚起点。
4. wrap 模式不启用 inner scrollport。code 满 pane 继续由外层 scroller 横滚；Markdown 代码块/宽表仍由各自块级容器横滚。
5. 手柄继续读取 contentDOM 的 grid 框位置。由于外层不再横滚，手柄不需要在本 change 选择 A/B 代理形态。

## Non-goals

- 不改 code 满 pane 模型，不强制正文或代码块折行，不新增设置、配置键或宽度真源。
- 不实施容量到顶反馈、latent 策略或 A/B 横滚手柄形态。
- 不在 contentDOM 内加应用 wrapper，不改 CM 对文档子树的 DOM 所有权。
- 不提前改 living spec，不更新正式视觉基线，不 merge/push/archive。
- 本任务不自行跑完整 visual 或 native；两者由主会话串行/统一执行。

## Impact

- specs：`content-width` 新增可见窗口 requirement。
- 代码：Markdown wrap 装配、CM scrollHandler、阅读位置/会话滚动快照、目标视觉与真机场景。
- 依赖：最初基线 ae15f97c；已 rebase 到 master d356a0f7，code 满 pane 由 2de2f4ef 合并。
- 证据：主仓 `.local/reviews/markdown-visible-width-nov27/`，只含合成 fixture。

## 节点 2：归档记录

### 五态

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 已实现并提交 `094b8c4a1ab5a41b005f5a85d84d9fbd0b9d6bfd` | 分支 `fix/markdown-visible-width-nov27` |
| released | 否：本批不打包 | 不适用 |
| machine PASS | quick `GATE RESULT: 13/13 PASS（SKIP 0）`、完整 visual `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码均 0 | `.local/reviews/markdown-visible-width-nov27/inset-p1-gate-quick-final.log`、`gate-visual-inset-final.log` |
| native PASS | 889 PASS，32 断言、20.6s；主会话已审横滚与行尾图，双侧留白和 NATIVE-WIDTH-END 有效 | `.local/acceptance/2026-11-28-markdown-visible-width-inset/evidence/889-markdown-visible-width/status.txt`、`evidence/summary.md` |
| archived | 已归档，提交 `909cbee10cab92917e728bf460e449fcfec9358e`；`--archived` PASS | `archive-wrapper.log`、`archive-audit.log` |

### 五要件

1. **方案已批准**：根方向已由 Alex 批准；双侧 44px 留白候选另获 Alex 明确「我没有异议」。没有未决价值、审美或影响面问题。
2. **独立 reviewer clean/merge**：K3 在 exact tip `094b8c4a1ab5a41b005f5a85d84d9fbd0b9d6bfd` 上结论 clean/merge，P1/P2=0，空行 P1 已关闭，见 `.local/reviews/markdown-visible-width-nov27/independent-review-inset-p1.md`。
3. **tasks**：§1–§4.3 与 §5 全部完成；§4.4 为归档后审计，包装器提交后再勾选，未提前完成。
4. **门禁与真机**：quick 13/13、完整 visual 15/15、OpenSpec 39/39、native 889 PASS 均已落 `.local/`。候选 21 张与 render-codeblock 21/21、Markdown 10/10、IME/layer 2/2、相关单测 16/16 通过。
5. **规格对账**：delta 为 `content-width` 的 1 条 ADDED，含 X/T、caret/selection、阅读位置及纵向布局条款；活跃 delta 未提前写入 living spec。归档前 archive-check 门禁、`validate --all --strict` 与唯一跟踪队列条目待本轮命令复核。

放行方式：五要件与独立评审放行；Alex 的双侧留白视觉批准已明确，不属于未裁例外。

### 归档后记录

- 包装器于 2026-11-28 执行成功：`content-width: update`，`+ 1 added`；归档目录为 `openspec/changes/archive/2026-11-28-clip-markdown-content-to-reading-width-nov27/`。修链 0 处（4 篇 Markdown / 0 条相对链接），`openspec-links` 716 条全部可达。
- 归档结果提交：`909cbee10cab92917e728bf460e449fcfec9358e`。
- 提交后执行 `node scripts/openspec-archive-check.mjs --archived clip-markdown-content-to-reading-width-nov27`：`openspec-archive-check: PASS（openspec/changes/archive/2026-11-28-clip-markdown-content-to-reading-width-nov27：0 条 MODIFIED，对比 0 段；人工恢复 0 段，声明认领 0 段）`，退出码 0。
- 证据日志位于主仓 `.local/reviews/markdown-visible-width-nov27/archive-wrapper.log` 与 `archive-audit.log`。
