# Proposal: 建立 Foundation Table Reading 质量合同

- Change ID: foundation-table-reading
- 日期: 2026-09-08
- **状态: 撤回（2026-09-17，M150）** —— 见下方「撤回记录」
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **撤回记录（2026-09-17，M150）**
>
> 本 change 是「只立合同、不改实现」的提案（0/17 任务），节点 1 从未完成——其中 1.2 要求的
> M88 脱敏画像至今不存在于仓库，提案自己写明「不伪造频率、分布或覆盖率数字」。合同指向的表格
> 阅读能力已由后续 mission 实现（M119 表格宽度统一合同、M137 表格现状普查、M142 短行补空列
> 收窄与多列降级归因、M138 降级文案带行号），门禁面为 `tests/visual/scenes/table-foundation-v2.spec.ts`
> 与真机场景 `render-table-degrade`。
>
> 合同本体留档在 [docs/specs/table-reading.md](../../../../docs/specs/table-reading.md)，仍是仓内
> 被引用的权威合同（`src/preview/table.ts` 直接引用其 §2/§3/§9），且 M142 已按 Alex 裁决把
> §2/§9 的短行口径收窄为 GFM 语义。本 change 的 spec 增量是该文档的 requirement 级镜像，未归档、
> 不生成 living spec。**未按本合同形态产出的部分**：真实 WK 的 Table F0/滚入 paint/主线程任务
> 预算报告（`N≥30`）、parser worker 触发判据的独立评审——如实记录，不在本 mission 补。
> 完整提案文本与 spec 增量随本目录留档。

## Why

表格是 Markdown Foundation 的关键阅读能力。上位合同已要求表格保留空槽、对齐、转义 pipe、源码复制、非矩形安全降级和宽表可达，但尚未把首帧分层、极端形状、公开 CodeMirror 分层、真实 WKWebView（WebKit WebView）端点和 failure evidence 收敛为独立可执行合同。[Foundation Markdown 质量合同](../../../../docs/specs/foundation-markdown.md)

M72 的隔离 table probe 记录了公开 BlockWrapper 路线、源码选择映射、局部横滚、AX 语义与真实 WK 交互的可行性证据。它同时明确固定 240 CSS px、同步全量 metadata、probe 读数和颜色变体不是生产实现或性能通过证据。[M72 table probe](../2026-09-17-withdrawn-complete-markdown-reading/table-probe72.md)

M88 匿名画像是本 change 的外部输入。当前仓库未保存可复核的 M88 summary，因此本 change 不伪造频率、分布或覆盖率数字，要求在节点 1 单独裁决脱敏输入。

## What Changes

- 建立普通 ≤16 KiB、中型 >16–64 KiB、异常 >64 KiB 或极端形状的单表分层。
- 规定普通/中型首屏相交必须在 F0 显示最终表格；异常可在 F0 显示完整可读源码并明确降级，增强仅 report-only。
- 固定矩形性、四种对齐、空槽、escaped pipe、无首尾 pipe、引用/列表内表格、非矩形整块源码降级。
- 固定宽表局部横滚、键盘/触控板末列可达、AX table/row/cell 语义、原始 Markdown 复制、M1 只读与 M2 源码编辑承接。
- 规定纯 model → 公开 CodeMirror adapter → theme/WK 分层，拒绝固定 240px、同步全量扫描、每视口全行遍历和整表 widget。
- 将 parser worker 限定为代表性匿名 ≤256 KiB 真实 WK 出现 >16ms 主线程任务或 F0 持续失败后的窄实验。
- 定义真实 WK Table F0、滚入可见 paint、主线程任务、failure evidence 和待节点裁决的候选预算，不声称现有 perf 已通过。

## Non-goals

- 不实现生产代码、GUI、真实 vault fixture、解析器 worker 或表格 widget。
- 不定义可视单元格编辑、增删行列、拖拽列宽、公式、合并单元格或 spreadsheet 行为。
- 不恢复或复制 M74 paused 分支代码；M72/M76 仅作为只读证据。
- 不改变产品定位、ACP、MCP、Thread、Session、Agent 或 M1/M2 边界。
- 不把 M72 probe 的固定列宽、同步模型、Chromium 或单次读数升级成产品事实。

## Impact

- 影响的 spec：`foundation-table-reading`
- 影响的文档：`docs/specs/table-reading.md`
- 影响的后续实现：表格 model、公开 CodeMirror decoration adapter、theme/WK 验收和匿名 fixture/性能报告。
- 本 change 不修改代码、依赖、锁文件、真实 vault 或产品行为。
