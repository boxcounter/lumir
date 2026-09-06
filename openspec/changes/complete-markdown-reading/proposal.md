# Proposal: 补齐 M1 列表与基础 Markdown 表格阅读

- Change ID: complete-markdown-reading
- 日期: 2026-09-06
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 状态: 待节点 1 提案评审；已批准里程碑方向不等于批准本 spec，也不授权实现。
- 本轮授权: 2026-09-06 Alex 追加授权 tower 代行本轮列表对齐与基础表格阅读的提案节点裁决，并在证据充分后代行对应归档裁决。授权不是节点已通过；tower 须分别记录具体决定。本提交仍仅起草，不实施、不 archive，不操作真实 vault、不推送远端 master、不扩展 M2。下文要求的 Alex 裁决在该限定范围内可由获授权的 tower 代行。

## Why

M1 的出口是只读浏览真实 vault，而不是开始编辑。现有规格只要求「列表符号美化」，没有表格阅读要求；实现只将无序标记换成圆点，未建立列表正文的对齐规则，也没有表格装饰分支。依据：[既有规格](../../specs/editor-live-preview/spec.md)、[ListMark 分支](../../../src/preview/livePreview.ts)、[M1/M2 出口](../../../docs/adr/0004-development-and-openness-strategy.md)。

列表换行后的正文起点与表格行列关系属于阅读完成度。因此补入 M1 收尾；源码编辑仍归 M2，不把专用表格操作变成 M2 出口。

## What Changes

1. **列表文字对齐**：同一列表同级项目正文起点一致；窗口变窄产生的软换行悬挂到该项正文起点；保留嵌套层级、原有多位编号与任务状态。普通项与任务项混排也保持正文对齐。
2. **基础 pipe 表格阅读**：表头与数据行形成可辨识行列；遵从分隔行的左/中/右对齐；空单元格不移列。范围以当前 parser 识别的标准矩形 pipe 表格为准，允许省略首尾 pipe 与转义 pipe。语法例外及行内内容口径见 [spec](specs/editor-live-preview/spec.md)。
3. **宽表可达**：宽表在表格自己的横向滚动区域内访问全部列；窄窗不裁掉末列、不撑宽普通正文；键盘和触控板均可操作。
4. **源码保护**：浏览、选择、复制不改写文档或文件。整表复制及跨表选区复制得到原始 Markdown，不输出 HTML 或制表符表格。代码模式不应用新装饰。
5. **延续公开扩展与增量策略**：基于当前 CodeMirror（CM）公开 API 和已有 parser 实现，不引新运行时依赖，不 fork 或修改 CM 管理的 DOM。验证计划与技术可行性门槛见 [design](design.md)。

## Non-goals

- M1 不新增输入、保存、自动格式化、编号重排、任务勾选写入或光标所在行源码显露。
- M2 承接列表及表格的 Markdown 源码编辑；专用单元格导航、增删行列、拖拽调宽、表格工具栏不是 M2 必须项。本 change 不定义 M2 编辑策略。
- 不支持合并单元格、跨行单元格、嵌套表格、HTML 表格或完整富文本表格编辑。不扩展 parser 方言。
- 不将表格单元格内的图片、嵌入、wikilink 跳转与全部行内富文本渲染作为本次基础表格阅读要求。此类单元格保留可读源码，不执行 HTML。
- 不改冻结设计原型、历史归档、其他阅读排版裁决；不变更 M2 双出口、锚点原型顺序、M1 → M2 架构 review 或 M3 两周 dogfood。

## Impact

- 影响的 specs：`editor-live-preview` 新增 requirements；保留既有视口增量义务。
- 后续实现预计涉及：`src/preview/livePreview.ts`、`src/preview/theme.ts`，必要时拆出列表/表格纯解析及 decoration 模块；`tests/visual/` 的行为与几何断言。当前提交仅包含计划与规格。
- 关联约束：ADR 0002 单 CM 内核、公开扩展与性能合同；ADR 0003 只读及源码保护；ADR 0004 里程碑。已有依赖与 parser 接线见 [package.json](../../../package.json)、[editor.ts](../../../src/editor.ts)。

## Review Decisions

请 Alex 在节点 1 裁决以下边界后再进入实现：

- 是否接受列表同级正文对齐及混合任务项的悬挂规则。
- 是否接受基础矩形 pipe 表格、单元格内容可读源码、非矩形/复杂语法整表回退源码的范围。
- 是否接受保留源码行的 CM 公开扩展方案，并以真实 WKWebView 的宽表、选择复制、视口稳定验证作为实现前置；若不可行，先修订提案而非扩大范围。

节点 2 仍须在实现与验收完成后另行通过；本提案不进行 archive。
