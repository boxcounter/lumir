# Proposal: 把 editor-live-preview 规格对齐到实现现状（含 M138 渲染保真三件套的补记）

- Change ID: align-editor-live-preview-spec
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **补记（retro）change**——实现先于规格落地；本 change 不新增行为，只把 living spec 与实现对齐

## Why

`openspec/specs/editor-live-preview/spec.md` 的现行文本停留在 **M1 只读期**，与当前实现直接矛盾，两处硬伤：

1. **Purpose 与 requirement 仍自称「M1 只读口径」**：Purpose 写「M1 只读口径，不含编辑态行为」；`live preview 装饰层` requirement 写「只读口径下 MUST NOT 实现光标所在行 reveal 源码的编辑态逻辑（无编辑即无此概念，推迟到有编辑能力的波次）」。而实现里 md 模式早已可编辑（`src/editor.ts:1220` 的 `EditorView.editable.of(mode === "md")`、`EditorState.readOnly.of(mode !== "md")`），且选区驱动的源码显露是既有行为：callout 首行（M110/M119）、标准 Markdown 链接整条（M144/M145）、frontmatter 块、公式与 mermaid widget，判据都在 `src/preview/livePreview.ts` 的 `touchesSelection` / `revealInlineSource` 系列。**living spec 说「MUST NOT 实现」的东西正是每天都在跑的东西**——这使 spec 的否决权失效（照 spec 读，实现是违规的）。
2. **M138 渲染保真三件套无规格**：`---` / `***` / `___` 渲染为横线、围栏代码块按语言着色、引用内列表按常规列表渲染，三项都在 M138 落地（`src/preview/livePreview.ts` 的 `HorizontalRuleWidget`、`src/preview/code.ts`、`src/preview/lists.ts` 的引用内列表分支），但没有走 OpenSpec 流程，living spec 里查不到——装饰层 requirement 只提「标题/加粗斜体删除线/列表符号/引用块/行内代码与代码块背景」，横线与代码着色不在其中。

事实依据：`src/preview/livePreview.ts`（`HorizontalRuleWidget`、`QuoteMark` 隐藏、`Link` 显露）、`src/preview/code.ts`（21 种 legacy-modes 语言 + 别名表，未收录语言保持纯文本）、`src/preview/lists.ts:192-206`（引用内列表的 `>` 跳过与常规列表判定）、`src/editor.ts:1215-1222`（视图层只读合同的对象是**非 md** 文档）。

## What Changes

两份制品、四条 requirement 的调整，**零代码改动**：

1. **MODIFIED `editor-live-preview` / `live preview 装饰层`**：删掉「只读口径下 MUST NOT 实现光标所在行 reveal 源码」与「本 change 只读，天然满足」两处与现状矛盾的表述，改为现行编辑态口径（光标/选区触及的结构显露源码，由选区驱动的装饰重建实现，不改文档）。
2. **ADDED `editor-live-preview` / `Markdown 渲染保真（分隔线 / 围栏代码着色 / 引用内列表）`**：把 M138 三项行为写成 requirement（分隔线与 frontmatter 定界符的区分、收录语言的着色与未收录语言的纯文本、引用内列表与正文列表同口径），每条带可验证 scenario。
3. **Purpose 重写**（归档后直接编辑 living spec——`## Purpose` 的增量只在 capability 创建时被读取，CLI 自身给出该指引）：去掉「M1 只读口径」，写明 md 模式可编辑 + 编辑态显露口径。

## Non-goals

- 不新增任何产品行为：本 change 的 requirement 全部描述已发布实现，MUST NOT 被读作「新功能承诺」。
- 不重写 M1 期的历史记录：`add-editor-live-preview` 归档件与 `complete-markdown-reading`（已撤回）原文保留。
- 不补 `complete-markdown-reading` 撤回后遗留的列表对齐 / 基础表格阅读 requirement 缺口（另立 change，见 `docs/backlog.md`）。
- 不改动 wikilink / 链接 / 表格 / frontmatter 各自的既有 requirement。

## Impact

- 影响的 specs：`editor-live-preview`（1 条 MODIFIED + 1 条 ADDED + Purpose 重写）。
- 影响的代码/系统：无——实现已在 `src/preview/livePreview.ts` / `code.ts` / `lists.ts` / `theme.ts`。
- 关联约束：ADR 0003 §3（装饰不改写源文件）、ADR 0002 §6（装饰层视口增量纪律不变，打开 1MB <100ms 合同照旧）、ADR 0004 第 5 条（功能做什么归 OpenSpec——本 change 正是把失守的这条防线补回来）。
