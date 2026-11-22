# Proposal: 分离 IME 组合范围与作者选区呈现

- Change ID: `fix-ime-composition-selection-nov22`
- 日期: 2026-11-22
- 角色: Alex Lee（原始缺陷报告、方案裁决），AI agent（诊断与实现）

> 评审记录
> 节点 1：Alex 指出普通正文只显示 IME marked text，而列表把同一内部组合范围画成灰色选区；
> 明确认可“保留摘录手势组合期闸门，并在共享编辑器层分离组合范围与作者选区”的方案，
> 要求先同步到 0.14.0 最终实现再处理。

## Why

IME 组合期间 CodeMirror 可用非空 `selection.main` 跟踪 marked text。真实 WKWebView 日志证明
普通正文与列表都有这份内部范围；列表的灰色呈现不是用户主动选择。此前只给 Quote to chat
增加 `compositionStarted` 闸门，阻止了误触发，但没有统一组合范围的视觉语义。

## What Changes

- 在共享编辑器组合事件层标记组合状态；组合期间 selection layer MUST NOT 把内部组合范围
  绘制为作者选区，正文、无序 / 有序 / 嵌套列表同一判据。
- 保留原生 marked text 与 CodeMirror 内部选区状态，不为视觉目的强制折叠选区，不改变列表
  marker、SourceShield、组合删除或提交恢复链。
- 保留 Quote to chat 的组合期闸门作为消费者侧防线。
- 扩充既有 CDP 真引擎回归：先证明组合范围确实进入 selection layer，再断言该层在组合期不可见；
  取消与提交后仍不触发摘录，正常作者选区合同不变。

## Non-goals

- 不新增列表专用 CSS 覆盖，不关闭 `drawSelection()`，不修改正常鼠标 / 键盘选区呈现。
- 不把 Chromium CDP 结果冒充原生 WKWebView 候选窗证据；原生手感仍由 Alex 在隔离环境复验。
- 不修改视觉基线，不新增依赖。

## Impact

- 影响的 specs：editor-live-preview。
- 影响的代码：共享编辑器选区呈现、Quote to chat 浏览器回归。
- 关联合同：选区可见范围、列表 L6 组合输入一致性、真实 vault 只读。
