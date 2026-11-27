# Proposal: 按内容模式分派 pane 宽度——code 文件成为满 pane 工作区

- Change ID: model-code-pane-workspace-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 已明确选择内容呈现模型：**「我选择这种模型」**。其语义是：content pane 是通用宿主；Markdown 是排版型文档，code 是工作区型内容，两者采用不同布局策略。

阶段一原始实测与阶段二原型表明，共享阅读栏 token 在 code 不折行时只改变列框起点和横滚范围，不改变长行自然宽；code 满 pane 后阅读栏手柄没有作用对象。现有满 pane code 手柄还会与侧栏/窗口控制重叠。该证据用于解释模型的交互后果，不把本次选择包装成缺陷修复。

证据：

- `.local/reports/content-width-models-nov27/README.md` 与 `raw/`、`wk/` 原始读数。
- `.local/reviews/content-width-models-nov27/README.md` 与交互原型、双模型任务读数。

## What Changes

1. **code 文件默认占满所在 pane 的可用宽度**。无行号时 `.cm-content` 等于 scroller 可用宽；有行号时 gutter 取自然宽，正文从 gutter 右缘起占满剩余宽度。code grid 不消费 `ui.content_width` / `--layout-doc-measure`。
2. **code 模式不再出现阅读栏宽手柄**。显隐由活跃会话模式与既有 notice / 首启覆盖层共同决定；切标签、模式切换和 pane 激活后同步。侧栏与 pane 分栏仍只由各自既有控制调整。
3. **Markdown 保持阅读栏模型**。`ui.content_width`、双侧手柄、容量上限、折行与持久化语义均不变。
4. **Markdown 内的代码块和宽表仍是文档组件**。它们留在 Markdown 栏内，保留既有块内横滚，不随文件级 code 策略满 pane。
5. **折行与内容可达性不变**。code 默认仍不折行；显式折行仍由 `code_mode_line_wrap` 决定。长行由主 scroller 横向到达，不使用裁切或强制折行。
6. 单/双 pane、行号开关、只读/可编辑、标签切换、字号缩放、选区与光标位置不得因这次布局分派受到非合同内破坏。

## Non-goals

- 不改写 md/code 模式系统，不重构 CodeMirror，不引入第二个编辑器组件。
- 不新增设置，不强制折行，不改容量死区 / latent token 策略，不调整阅读栏上下限。
- 不把此变更描述成修 bug；既有研究的其它 findings 不随本 change 扩容。
- 不改 Markdown 手柄的频率、视觉样式或低频去留。
- 不在本 change 更新正式视觉基线；候选图先供 Alex 过目。
- 不合并、不推送、不归档；完整视觉、真机与独立终审按主会话排期完成。

## Impact

- 影响的 specs：`content-width`。`editor-live-preview` 的折行三轴与块内滚动合同零 delta。
- 影响的代码/系统：`src/editor.ts` 的 code grid 模板；`src/main.ts` 的阅读手柄显隐同步；相关视觉/结构断言与真机验收场景。
- 关联约束：ADR 0002 的单内核双模式与性能合同、ADR 0003 的不改写源文件、ADR 0008 的 pane 通用宿主模型。

## 节点 2：归档记录（实现完成后填写）

本 change 当前不归档。最终按 workflow 分列 implemented / released / machine PASS / native PASS / archived；完整视觉、真机、独立 reviewer 与归档均未提前视为完成。
