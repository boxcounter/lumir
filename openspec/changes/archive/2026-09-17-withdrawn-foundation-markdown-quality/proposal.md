# Proposal: 建立 Foundation Markdown 核心质量合同

- Change ID: foundation-markdown-quality
- 日期: 2026-09-07
- **状态: 撤回（2026-09-17，M150）** —— 见下方「撤回记录」
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **撤回记录（2026-09-17，M150）**
>
> 本 change 是「只立合同、不改实现」的提案（0/14 任务），其 Proposal 阶段任务（节点 1 评审、
> M77/M78 证据转化）从未完成，实现阶段与出口验证阶段全部未开工——也无需开工：合同指向的能力
> 已由后续 mission 分批实现并各有门禁承载（Math/Mermaid 选型 M105、callout M109、表格
> M137/M142、渲染保真三件套与代码着色 M138、文件内搜索 M139、链接全形态 M144/M145、
> JSON 键色 M147），验收面是 `tests/visual/` 视觉门禁 + `scripts/acceptance/` 真机套件 + perf.yml。
>
> 合同本体（F0/F1 端点、源码不变铁律、失败降级、可访问性口径）留档在
> [docs/specs/foundation-markdown.md](../../../../docs/specs/foundation-markdown.md)，
> 它仍是仓内被引用的权威合同文本（`src/preview/table.ts`、`src/preview/callout.ts` 等实现注释
> 直接引用其章节）；本 change 的 spec 增量只是该文档的 requirement 级镜像，未归档、不生成 living spec。
>
> **未按本合同形态产出的部分**（如实记录，不在本 mission 补）：tiny/small/medium/large fixture
> 验收矩阵、M88 脱敏画像、真实 WK 下的 F0/F1 专项测量报告（现由 perf.yml 的四项指标与真机验收
> 场景分别覆盖，口径不同）。完整提案文本与 spec 增量随本目录留档。

## Why

M77 的匿名画像和 M78 的首帧/覆盖审计显示，Markdown 基础质量需要从实现零散约定收敛为可验收合同。现有性能方法学仍将打开指标定义为 `fs.readFile → UTF-8 decode`，不覆盖真实解析、装饰与 paint，因此不能把该子指标当作用户打开体验。[docs/specs/perf-measurement.md](../../../docs/specs/perf-measurement.md)

本 change 只建立 Markdown 阅读、编辑保存和基础质量的质量口径。它遵守 ADR 0004 的 M1/M2 边界：Markdown 是核心底座，ACP、MCP、Thread、Session、Agent 业务概念和产品定位冻结，不由本 change 定义。[ADR 0004](../../../docs/adr/0004-development-and-openness-strategy.md)

## What Changes

- 新增 Foundation Markdown 的 F0 首帧与 F1 资源稳定帧端点，禁止朴素源码闪现、旧文档冒充和无限 pending。
- 固定 P0/P1/P1.5/P2 的常见 Markdown 组合覆盖顺序，包含列表内行内语法、表格、frontmatter、wikilink、图片和失败降级。
- 按用户裁决将 Math（LaTeX）与 Mermaid 从 P2 延后项提升为 Foundation 确定需求：必须渲染为可读结果、失败时可读降级且不伪装已支持、源码复制保持不变、渲染不阻塞 F0；dataview/canvas 保持延后，需单独产品裁决。callout 保持为 P1 较早支持的 Markdown extension。
- 固定源码不变、选择复制、编辑保存、失败保护、冲突保护和不静默丢数据的质量要求。
- 定义可访问性、可见区域增量装饰和性能证据边界，区分真实 F0/F1、IO 子指标与 keypress 近似。
- 定义匿名合成 tiny/small/medium/large fixture、脱敏规则、验收矩阵与必须项/延后项/测量边界。

## Non-goals

- 不定义产品定位、Thread、Session、Agent、ACP、MCP 或编辑点。
- 不实现代码、解析器、表格编辑器、IDE 能力、插件平台或协作写入。
- 不把 P1/P1.5 永久排除；它们只是 Foundation 内部顺序。
- 不擅自改 ADR 0002 的性能数字，不凭旧 IO 占位或单次近似读数宣布产品达标。
- 不写入真实 vault 原文、标题、路径、实体、标签或 URL。

## Impact

- 影响的 specs：`foundation-markdown-quality`
- 影响的代码/系统：后续打开、渲染、编辑保存、fixture 与验收工具的质量合同；本 change 不改实现。
- 关联约束：ADR 0004 的 M1/M2 边界与 OpenSpec 节点门禁；`docs/specs/perf-measurement.md` 的四项性能合同和证据限制；ADR 0003 的源文件不改写铁律。
