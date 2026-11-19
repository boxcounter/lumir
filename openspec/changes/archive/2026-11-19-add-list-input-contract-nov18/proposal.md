# Proposal: 固化列表内容起点输入合同并删除冗余空手柄

- Change ID: add-list-input-contract-nov18
- 日期: 2026-11-18
- 角色: Alex Lee（评审/裁决授权），tower（受委托节点 1 裁决），AI agent（起草）

## 节点 2 记录（归档前，2026-11-19，M837）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-18 通过——Alex 采纳「立即修这两个已明确的问题，但修复合同覆盖整个行为类别」「审计正文的输入拦截与列表 widget，默认删除非必要自定义，而不是默认保留」，并授权 tower 直接裁决；tower 按全权委托批准（见本 proposal「Why」段末）。实现期没有静默扩 scope：`ddb784c4` 相对基线 `65898b6c` 只动 7 个文件（`docs/specs/lists.md`、本 change 的 proposal / delta / tasks、`scripts/acceptance/scenarios/153-ordered-list-auto-mode.md`、`src/editor.ts`、`tests/visual/scenes/lists.spec.ts`），与「What Changes」逐条对应；`src/editor.ts` 只有 7 行空 `keydown` 手柄与旧注释的删除，无新增生产分支。
2. **独立 reviewer clean / merge**：assigned reviewer `reviewer-list-contract` 判 `status: clean` / `merge: merge`，评审 tip `ddb784c4f08e2b10479071736199a243800e07d8`（`reviewed_commit` 同值）；评审文件 `/Users/boxcounter/Code/Boxcounter/lumir/.tower/comms/reviews/review-feat-add-list-input-contract-nov18-reviewer-list-contract-r1.md`。合并提交 `edc5ed6c` 的第二父提交即 `ddb784c4`，评审绑定的内容与合入内容同一份；delta 自 `ddb784c4` 之后未再改动（`git log -- openspec/changes/add-list-input-contract-nov18/specs/editor-live-preview/spec.md` 只有 `ddb784c4`）。
3. **tasks 完成**：`tasks.md` 11/11 全勾（`grep -c '^- \[x\]'` = 11，未勾项 0），无放弃项。3.3 / 3.4 的最终读数已按合并后证据改准。
4. **要求的门禁与真机证据**：实现动过 `src/**` 与 `tests/visual/scenes/**`，按 visual 档取读数——最终 tip `ddb784c4` 串行复跑 `quick` `GATE RESULT: 13/13 PASS（SKIP 0）` 退出码 0（`.local/missions/add-list-input-contract-nov18/gate-quick-rebased.log`）、`visual` `GATE RESULT: 15/15 PASS（SKIP 0）` 退出码 0、visual-regression 627s（`gate-visual-rebased.log`）；未更新像素基线。真机场景 153 `PASS`，21 条 PASS（含 8 条截图证据），证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-19-editor-trust/153-ordered-list-auto-mode/`（`status.txt` = `PASS`；起跑 `2026-11-19T03:35:30.625Z` 晚于合并 `edc5ed6c` 的 2026-11-19 09:17 +0800）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过 11 份 delta，11 条 MODIFIED，对比 127 段，无静默丢段；归档队列 2 项已完成 change 均有唯一条目`（退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 38 passed, 0 failed (38 items)`（退出码 0）；`docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。delta 只有 1 条 ADDED（living spec 此刻没有「列表内容起点输入的跨层一致性」requirement，`grep` 零命中），是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## Why

M827 对连续空有序项的分层复现证明：在第 7 项内容起点输入 `a` 后，CodeMirror 文档与保存载荷均为 `7. a`，选区从 27 移到 28，一次撤销可恢复；DOM/AX 中的 `7.a` 是 marker widget 与正文的正常序列化拼接，不是文档缺陷。现有输入路径因此不需要新增护栏，需要的是把这一整类跨层不变量写成可证伪合同，并用回归防止未来再按 DOM/AX 形状吞输入。

同次审计确认 `src/editor.ts` 的 `EditorView.domEventHandlers({ keydown: () => false })` 没有消费者：统一键位表已保证所需的 `forceFlush` 行为，删除前后文档、选区和默认行为一致。该空手柄及其过时注释应直接删除。

节点 1：Alex 采纳「立即修这两个已明确的问题，但修复合同覆盖整个行为类别」「审计正文的输入拦截与列表 widget，默认删除非必要自定义，而不是默认保留」，并明确授权 tower 直接裁决、不等 Alex。tower 于 2026-11-18 按该全权委托批准本提案；本 change 不引入新的产品行为或裁决点。

## What Changes

- 新增「列表内容起点输入的跨层一致性」requirement，并在 `docs/specs/lists.md` 增加 L6：普通 `insertText` 与 IME 提交只改变目标选区，其他源码逐字节不变，选区落在提交文本末尾。
- 输入前后每个列表项恰有一个 marker；显示 glyph/序号、计算样式和正文起点 x 保持同合同。DOM/AX 的 `7.a` 等拼接形状不得成为改写文档或吞输入的依据。
- 单次直接输入/组合提交可一次 undo 恢复精确原文与选区，redo 恢复输入后状态；dirty 继续按 `cleanDoc` 比较，显式保存载荷逐字等于当前 `EditorState.doc`。
- 在现有 Chromium 列表场景增加点击与模型选区两路回归，代表覆盖连续空有序项、bullet、嵌套、裸 marker 和组合提交文本；扩展真机场景 153 的连续空项输入、精确落盘与撤销。
- 删除已证实冗余的空 `keydown` 手柄及过时注释，不新增专用生产分支。

## Non-goals

- 不恢复旧 `beforeinput` / DOM `inputHandler` 吞弃护栏，不重写列表 widget、`ListLayout` 或 marker 几何。
- 不改变有既有消费者的裸 marker Enter/Backspace、L5 原子导航或 C1 光标几何。
- 不做列表类型、嵌套深度、输入通道的全笛卡尔积测试，不针对第 7 项或特定字符写特判。
- 不修改 harness composer，不更新视觉像素基线。

## Impact

- 影响的 specs：editor-live-preview。
- 影响的代码/系统：编辑器基础扩展装配、列表跨层质量合同、Chromium 列表场景与真机场景 153。
- 关联约束：ADR 0003 §3 不改写源文件铁律；`docs/specs/lists.md` L1–L5 与 `docs/specs/editor-caret.md` C1 继续成立。
