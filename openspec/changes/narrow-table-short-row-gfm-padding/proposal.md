# Proposal: 表格合同收窄——短行尾部补空列对齐 GFM

- Change ID: narrow-table-short-row-gfm-padding
- 日期: 2026-09-16
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Lumir 的表格合同（[docs/specs/table-reading.md](../../../docs/specs/table-reading.md) §2）原口径是「数据行少列或多列一律整块回退源码，系统不得补列」。这与 GFM 规范不一致：GFM 明确允许数据行的 cell 数与表头不同——少则尾部补空 cell，多则忽略多余 cell（[GFM spec §4.10](https://github.github.com/gfm/#tables-extension-)：「The remainder of the table's rows may vary in the number of cells. If there are a number of cells fewer than the number of cells in the header row, empty cells are inserted. If there are greater, the excess is ignored.」）。GitHub 与 Obsidian 打开同一份文件都能正常显示。

M137 诊断给出了真实代价：`~/Downloads/Everything-copy/outline.md:106-109` 的六列表有四行各缺最后一列（agent 产出的 markdown，ragged row 属高频形态），Lumir 把整张表（含正常的表头与分隔行）回退成源码，用户看到的是「Lumir 打不开我的表」，而不是「我的文件少了一个 `|`」。证据：finding `.tower/comms/findings/20260916-worker-table-survey-idea-gfm.md`（M137 报告，含复现与控制变量：补齐末列后同一份解析器配置下不再降级），另有 [M72 table probe](../complete-markdown-reading/table-probe72.md) 的同族观察。

Alex 2026-09-16 裁决采纳（原话「好，采纳。」），执行口径由 tower 明确并经 Alex 过目：**仅收窄短行**（少列 → 尾部补空 cell），**多列仍整块降级**——GFM 对多列是 excess ignored，静默丢列与合同「不猜测修复」的精神冲突。本合同收窄**不动**只读铁律：装饰不改写文档，源文件与磁盘逐字节不变。

## What Changes

1. **短行尾部补空列**：数据行 cell 数少于表头列数时，模型在尾部补出零宽空 slot，整表按矩形呈现；补出的空 cell 与源文件里的空格空槽、`||` 零宽空槽同形——不填占位符、不加「缺列」标记，列边界与表头对齐。少列不再触发整块回退。
2. **多列维持整块降级**：数据行 cell 数多于表头列数、表头与分隔行列数不一致、槽位不能安全映射、范围不完整，仍然整块显示完整源码，且降级文案继续指认首个与表头列数不符的数据行的**文档行号**（文案措辞不变）。
3. **合同文本收窄**：`docs/specs/table-reading.md` §2 的「不得补列」改写为收窄后的准确口径，并引 GFM §4.10 原文；§9 的 fixture 矩阵同步区分「少列（补空列）」与「多列（整块降级）」。
4. **未归档制品的口径对账**：`complete-markdown-reading`（editor-live-preview delta）与 `foundation-table-reading`（Pipe 语法与矩形性）两份未归档 change 里含同一主题的旧口径，同步收窄，避免归档时把旧规则重新写进 living spec。
5. **回归证据**：视觉场景翻转 `table-foundation-v2` 的短行 fixture 为「正常渲染」断言，新增 outline.md 同款形态（6 列表头 + 5 cell 行）的专门断言，多列降级改由多列表 fixture 覆盖；真机场景 `render-table-degrade` 的降级表改多列形态并保留降级文案断言，另加短行表渲染断言。

## Non-goals

- 不放开多列：多余 cell 不渲染、不丢列、不提示哪些列被丢——整块降级不变。
- 不删改任何源文件内容：补空列只发生在装饰层，`EditorState.doc` 与磁盘文件不变（ADR 0003 §3 铁律）。
- 不改降级文案措辞（`文案-Copy.md` D73–D75 不动）：收窄后「第 N 行单元格数与表头不符（应为 M 列）」只对多列触发，措辞仍然准确。
- 不改 `reason` 取值集合与 oversize / 兜底分支；不引入单元格编辑、增删行列或「自动修复原文」能力。
- 不改 `docs/specs/table-reading.md` 的其余章节（分层、列宽、横滚、AX、复制、性能端点均不动）。

## Impact

- 影响的 specs：`editor-live-preview`（ADDED 短行补空列与多列整块降级；对账 `complete-markdown-reading` 与 `foundation-table-reading` 两份未归档 delta 的同主题条款）。
- 影响的代码/系统：`src/preview/table.ts`（补空列）、`src/preview/livePreview.ts`（零宽空 cell 的装饰必须走 point widget——CM6 对零宽 replace 装饰抛 `RangeError`，两侧默认非 inclusive）。
- 影响的文档：`docs/specs/table-reading.md`（§2 / §9）、`docs/backlog.md`（裁决与落地记录）。
- 影响的测试/验收：`tests/visual/scenes/table-foundation-v2.spec.ts`、`tests/visual/fixtures/table-foundation-v2/representative.md`、`scripts/acceptance/scenarios/render-table-degrade.md`、`scripts/acceptance/fixtures/render-table-degrade.md`。
- 关联约束：ADR 0003 §3（装饰不改写文档）、ADR 0002 §2（单内核双模式）、ADR 0004 第 5 条（功能变更走 OpenSpec）。
- 视觉基线：本 change 不触达任何已入库截图场景的 fixture（含表的 fixture 均无 `toHaveScreenshot` 断言），预期基线零变化；若实际出现差异，按 [tests/visual/README.md](../../../tests/visual/README.md) 的更新纪律逐场景核对后再更新。
