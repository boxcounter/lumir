# Proposal: 修复 wikilink 光标无法进入与源码无法逐字符编辑

- Change ID: `fix-wikilink-caret-reveal-nov24`
- 日期: 2026-11-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 有序链：第 1 环；后续为 [`add-wikilink-suggestion-nov24`](../add-wikilink-suggestion-nov24/proposal.md)。两环可同批完成节点 1 评审，但必须分别实现、验证与归档，本环先归档。

> 评审记录
> 节点 1：待 Alex 裁决。本环唯一行为取舍见「待裁决点」；推荐方案已完整写入 design 与 spec delta，未获批准前不进入实现。

## Why

用户报告「光标在视觉上挪不进 wikilink」。现行 `collectWikilinks` 对 resolved / ambiguous / unresolved 的普通 `[[…]]` 建整条 replace 装饰，却没有标准链接与公式已有的选区显露判据；渲染 DOM 只剩 widget，指针只能映射到链接前后边界，水平移动则穿过不可见源码位置。旧测试 `tests/visual/scenes/markdown-editing-stability.spec.ts` 的「渲染态链接尾部点击后输入」还把只能落在边界写成了期望。

这是交互缺陷，不是新增导航语义。按[渲染/交互缺陷合同先行规则](../../../docs/process/rendering-defect-contract-first.md)，必须先修订 `docs/specs/editor-caret.md` C6 与 live-preview 的旧不变量，再用输入分布属性测试证明，不得只修上述单个案例。

## What Changes

- 普通 `[[…]]` 复用 `touchesSource`：光标或选区触及源码 span 时撤下 replace、显露完整原文；移开后恢复三态渲染。进入后允许逐字素移动与编辑，不把整条链接作为一个原子步。
- 普通 wikilink widget 复用 `enterReplacedSource` 的指针入口：主键点击后编辑器持焦、源码显露、落点钳在 target / alias 源码区内；`EditorState.readOnly` 时不进入、不改选区。
- pending 原本就显示源码；pending → resolved / ambiguous / unresolved 的异步完成不得重新遮住正在编辑的 span。无 resolver 的降级显示与 Rust 解析、跳转、歧义和未创建语义不变。
- 修订 `editor-caret` C6：只有没有显露判据的隐藏 inline 区间才按方向钳到可见边界；有显露判据的区间必须允许内部落点与逐字素编辑。
- 整条替换 `editor-live-preview` 中「标准 Markdown 链接」和「指针选区外扩」两个 requirement 的旧边界表述，并修改 `wikilink-navigation` 的三态显示 requirement。wikilink 仍不属于指针选区语法外扩集合；改变的是源码显露，不是选区外扩。
- 回扫并改准旧测试与注释，新增覆盖状态、入口、方向、span 形态和上下文的属性矩阵；所有非编辑入口继续保证文档逐字节不变。

## Non-goals

- 不引入 `EditorView.atomicRanges`，不把 wikilink 做成一步跨过的原子对象。
- 不改变 wikilink 词法、Rust 解析、三态、Mod-Click 跳转、锚点、显式 ⌘⏎ 创建或 unresolved 样式。
- 不改变 `![[…]]`、附件、图片、unsupported 提示的渲染与指针行为。
- 不实现 `[[` 候选、创建候选行或任何自动打开行为；这些属于有序链下一环。
- 不改变标准链接、公式、列表 marker 的既有编辑语义，不改写源文件格式。

## Impact

- 影响的 specs：`editor-live-preview`、`wikilink-navigation`；实现时先修订质量合同 `docs/specs/editor-caret.md` C6。
- 影响的代码/系统：live preview 的 wikilink 装饰与指针入口、共享光标合同、前端 visual / unit 与真机验收场景。
- 关联约束：ADR 0003 §3 源文件不改写；ADR 0002 §6 键入性能预算；渲染/交互缺陷合同先行规则。

## 待裁决点

1. **进入语义**：推荐「触及即显露、逐字符编辑」，与标准链接和公式一致；不采用「整条链接一个原子步」。后者会与 C6 的分流目标及全仓既有编辑范式分叉。
