# Proposal: 修复 Harness 流式列表续段的 strong 渲染

- Change ID: `fix-harness-markdown-bold-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（缺陷报告与节点 1 授权），AI agent（起草与实现）

> 节点 1：Alex 2026-11-25 实测报告 Harness 同一条消息中普通段落的 `**粗体**` 正常，
> 部分有序列表项仍显示字面 `**`，并明确授权「增加一个工作」恢复既有 Markdown 渲染合同。
> 本 change 据此直接实施；不读取或入库真实截图正文、会话或 vault 内容，全部 fixture 均为合成文本。

## Why

living spec「对话面板」已要求模型输出按 Markdown（GFM 基本面）渲染。真实链路是
`@lezer/markdown(GFM)` 解析后由 `renderMarkdownInto` 生成 DOM，`StrongEmphasis` 对应 `<strong>`。
最近归档的 `refine-harness-typography-nov23` 只调整 CSS 排版，不解释字面星号。

合成复现显示：完整源码里，有序列表空行后的四空格续段是
`ListItem → Paragraph → StrongEmphasis`；流式 `finalizedUpTo` 却在该空行切断上下文，
使续段在新片段开头被解析为 `CodeBlock`，星号因此按代码原文上屏。这是块级流式切分缺陷，
不是 inline strong 解析或 `font-weight` 缺陷。

## What Changes

- 增补「Harness Markdown strong 的流式渲染一致性」合同：凡既有 GFM 解析器认定为
  `StrongEmphasis` 的输入，在普通段落、有序/无序/嵌套列表、跨行项、CJK/英文、标点及同行后续
  文本中均上屏为 `<strong>`；代码 span、代码块与转义星号继续保留字面文本。
- 流式定稿 SHALL 保留仍可能被缩进续段延续的列表上下文；不得把列表续段切成顶层缩进代码块。
  已确认结束的列表与普通块仍可定稿，终态全量重渲路径不变。
- 增加真实渲染件单元矩阵与 Chromium 流式场景，覆盖 0/1/多个 strong、列表缩进/多行、
  CJK/英文、链接/代码/转义反例，并先记录旧实现失败证据。
- 新增真机场景 875（编号已扫描，867–874 与本仓现有编号不冲突），观察流式中间态与终态；
  按 Alex 指定窗口由后续主会话执行，本工作分支不启动真机。

## Non-goals

- 不扩展 CommonMark/GFM 语法，不把空格包住 delimiter 等非法 strong 写成新语法，不做正则替换星号。
- 不改 `StrongEmphasis` inline 分支、不改字体/字重、间距、720px 阅读宽、进度尾行、引用/工具/审批卡。
- 不改会话协议、Rust 后端、配置、源文档或持久化格式。
- 不更新视觉基线；如出现候选差异，只放 `.local/reviews/harness-markdown-bold-nov25/` 供 Alex 裁决。
- 不在本分支 push、merge、archive，不访问真实配置或 vault。

## Impact

- 影响的 specs：`harness`（ADDED ×1）。
- 影响的代码/系统：`src/harness-panel.ts` 的流式定稿边界；真实渲染件单测、目标 Chromium 场景与真机验收 fixture。
- 关联约束：living spec「对话面板」、`refine-harness-typography-nov23` 的既有排版、
  `docs/process/rendering-defect-contract-first.md`、视觉基线人肉裁决纪律。
