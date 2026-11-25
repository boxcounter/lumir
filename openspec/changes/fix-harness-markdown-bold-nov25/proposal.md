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
- **不修 K3 标注的 F1 trailing newline 边界缺陷**：它是基线既有独立缺陷，本 change 未改该路径，新增 fixture 也不覆盖该形态；F1 按 K3 结论另立 change 处理，不并入本 change。
- 不在本分支 push、merge、archive，不访问真实配置或 vault。

## Impact

- 影响的 specs：`harness`（ADDED ×1）。
- 影响的代码/系统：`src/harness-panel.ts` 的流式定稿边界；真实渲染件单测、目标 Chromium 场景与真机验收 fixture。
- 关联约束：living spec「对话面板」、`refine-harness-typography-nov23` 的既有排版、
  `docs/process/rendering-defect-contract-first.md`、视觉基线人肉裁决纪律。

## 归档记录

### 归档前（节点 2 五要件）

1. **节点 1 批准依据**：Alex 2026-11-25 实测报告「同一条消息中普通段落 `**粗体**` 正常，部分有序列表项仍显示字面 `**`」并明确授权「增加一个工作」；见文首节点 1。实现期未新增行为裁决。
2. **独立评审**：K3 最终 **clean**（无 P1 / P2 / P3；oracle 未削弱），绑定 tip `12e5eeaef16111bf332041c0d5c045348dc4f68c`，报告 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/harness-markdown-bold-nov25/k3-final.md`；承接 clean recheck `15b0d673`。K3 列出的完整 gate 前置已由同一 tip 的 gate 证据补齐；真机 875 前置由 r3 证据闭合。
3. **tasks 完成**：`tasks.md` 9/9 全勾；3.3 完整 gate、3.4 真机 875 的证据路径见下。
4. **门禁与真机证据**：
   - 完整 `bash scripts/gate.sh visual`（含 quick 层）在 `12e5eeae`：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/harness-markdown-bold-nov25/gate-visual-final-tip.log`；`visual-regression` 931s；基线未更新。
   - 真机 875：`875-harness-markdown-bold` **1/1 PASS**、19 断言、0 failed、22.272s；证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-harness-markdown-bold-r3/`（`results.json`、`summary.md`、`steps.md`、三张截图与 AX）。
   - 最后两个提交只改验收制品（场景 marker 与 mock fixture JSON），产品实现为前序 clean recheck 所审版本；`tests/visual/baselines/` 零改动。
   - **F1 trailing newline**：K3 标注的**基线既有独立缺陷**（P2），本 change 未修、未宣称修复，fixture 也不覆盖该形态；按 K3 结论另立 change 处理，不并入本 change。
5. **规格对账（归档前读数）**：
   - `node scripts/openspec-archive-check.mjs --change fix-harness-markdown-bold-nov25` → `PASS（扫过 1 份 delta，0 条 MODIFIED，对比 0 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目（--change fix-harness-markdown-bold-nov25））`。
   - 默认门禁模式 → `PASS（扫过 12 份 delta，16 条 MODIFIED，对比 351 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）`。
   - `pnpm exec openspec validate --all --strict` → `39 passed, 0 failed (39 items)`。
   - `bash scripts/docs-check.sh` → `PASS`（含归档对账、队列齐备、backlog 出口与 80 行上限）。
   - `docs/backlog.md` 队列有且仅有一条本 change 条目；因 80 行硬上限，按既有先例移除已归档的 `add-harness-skill-slash-invocation-nov23` 旧条目，记录保留在其归档 proposal 与 git 历史。
