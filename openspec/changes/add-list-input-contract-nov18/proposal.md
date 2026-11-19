# Proposal: 固化列表内容起点输入合同并删除冗余空手柄

- Change ID: add-list-input-contract-nov18
- 日期: 2026-11-18
- 角色: Alex Lee（评审/裁决授权），tower（受委托节点 1 裁决），AI agent（起草）

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
