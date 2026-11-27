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
- 除 Alex 单独批准的 `binding-highlight-chromium-darwin.png` 外，不更新其它正式视觉基线，不改容差。
- 不合并、不推送；完整视觉、真机与独立终审按主会话排期完成。

## Impact

- 影响的 specs：`content-width`。`editor-live-preview` 的折行三轴与块内滚动合同零 delta。
- 影响的代码/系统：`src/editor.ts` 的 code grid 模板；`src/main.ts` 的阅读手柄显隐同步；相关视觉/结构断言与真机验收场景。
- 关联约束：ADR 0002 的单内核双模式与性能合同、ADR 0003 的不改写源文件、ADR 0008 的 pane 通用宿主模型。

## 节点 2：归档记录

### 状态分列

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | 实现 `a18b3a7b9b5a26c956bb46436f0657d00f9c184f`；41 oracle 修正 `ae15f97c53dcf5e7ff38bfbfdb4b37dfe21e2d93`；单张授权基线与记录提交 `63b5ecbf3e28465ddc27e73c7e1ac3fe427cd750` |
| released | 否 | 本批不打包，无 release 产物 |
| machine PASS | 是 | quick `GATE RESULT: 13/13 PASS（SKIP 0）` exit 0；完整 visual 最终 `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0，1951 passed / 13 skipped；原始日志 `.local/reviews/code-pane-workspace-nov27/evidence/gate-visual-final.log` |
| native PASS | 是 | 38/41 最终 2/2 PASS、exit 0；证据 `.local/acceptance/2026-11-27-code-pane-workspace-after-oracle-fix/` |
| archived | 否：待执行归档 | 最终独立 K3 clean/merge 已绑定 `63b5ecbf`；归档包装器与 `--archived` 读数待实际执行后回填 |

### 五要件核对

1. **方案已批准**：内容模型由 Alex 原话「我选择这种模型」批准；单张基线另有 Alex 原话「批准代码满 pane 的这张基线」。授权仅限 `binding-highlight-chromium-darwin.png`，760×733→964×733，未改容差或其它基线。
2. **独立 reviewer**：`.local/reviews/code-pane-workspace-nov27/independent-review-final.md` 为最终 K3 clean/merge，P1/P2/P3 均为 0，绑定 `63b5ecbf3e28465ddc27e73c7e1ac3fe427cd750`；旧 `a18b3a7b` 报告不再作为最终 tip 的复核证据。
3. **tasks**：1.1–4.5 已完成；归档与 `--archived` 审计读数只在实际执行后回填。
4. **门禁与真机**：quick / 完整视觉 / native 读数如上。41 原失败为**测试时序/oracle 缺陷**：master 同败，AX 点击无 settle，强制覆盖两段 await 导致磁盘读取抢跑；只用 `waitForFile` 修场景，未改保存或布局生产代码。分类与三套证据见 `.local/reviews/code-pane-workspace-nov27/native-triage.md`。
5. **规格对账**：归档前 validate `Totals: 39 passed, 0 failed (39 items)`、exit 0；docs-check PASS、exit 0，backlog 80/80 行；archive-check PASS：`扫过 9 份 delta，9 条 MODIFIED，对比 132 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`、exit 0。五要件齐备，可以执行归档。

### 完整 visual 历史

| 次序 | 结果 | 证据与说明 |
|---|---|---|
| 首次 | `GATE RESULT: 14/15 PASS（SKIP 0）` exit 1；1950 passed / 1 failed / 13 skipped | `evidence/gate-visual-summary.log`、`gate-visual-regression.log`；唯一差异为授权基线 760×733→964×733 |
| 更新后最终 | **`GATE RESULT: 15/15 PASS（SKIP 0）` exit 0**；1951 passed / 13 skipped；visual-regression 1367s | `evidence/gate-visual-final.log`；原始套件日志路径也在其中，无额外差异 |

### 归档前后

最终 tip 的独立复核缺口已闭合，归档前三项检查通过后执行包装器。当前尚未产生归档提交或 `--archived` 读数；本 change 不 merge、不 push，released 保持否。
