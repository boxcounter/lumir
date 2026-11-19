## ADDED Requirements

### Requirement: 列表内容起点输入的跨层一致性

在未被用户单字符键位覆盖的默认文本输入路径，任意列表项内容起点（真列表/嵌套项的 `listLineRender.hidden.to`，或裸 marker 行编辑态的内容起点）SHALL 接受普通 `insertText` 与 IME 组合提交。提交文本 MUST 只插入当前空光标或替换当前选区；marker 源码、尾随空白及其他列表项 MUST 逐字节不变，空光标场景的 `selection.main.head` MUST 落在提交文本末尾。

渲染稳定后，每个可见列表项 MUST 恰有一个 marker widget；其显示 glyph/复合序号、计算样式与正文起点 x MUST 保持输入前同合同，输入 MUST NOT 造成 marker 丢失、重复或正文悬挂位置漂移。marker widget 与正文在 DOM/AX 中可序列化为无空格的拼接文本（例如源码 `7. a` 呈现为 `7.a`）；该形状是渲染结果，MUST NOT 被用作改写文档、拒收输入或恢复旧吞弃护栏的依据。专项不变量与证伪口径见 `docs/specs/lists.md` L6。

单次普通输入或组合提交 SHALL 是一个可撤销编辑：一次 undo 恢复精确输入前文档与选区，一次 redo 恢复精确输入后文档与选区。dirty MUST 继续按当前文档与 `cleanDoc` 逐字比较；显式保存的内容 MUST 逐字等于当前 `EditorState.doc`，保存后该文档成为 dirty 比较基线。本 requirement MUST NOT 改变裸 marker Enter/Backspace、L5 原子导航或 C1 光标几何。

#### Scenario: 连续空有序项点击后在内容起点输入

- **GIVEN** 文档含连续 7 个空有序项，每项恰一个 marker，且已记录各项计算样式与正文起点 x
- **WHEN** 点击第 7 项内容起点并输入 `a`
- **THEN** 文档仅由该空项的 `7. ` 变为 `7. a`，其他项与所有尾随空白逐字不变，选区头从该项内容起点移到 `a` 后
- **AND** DOM/AX 可显示 `7.a`，但保存载荷仍是含 marker 尾随空格的 `7. a`
- **AND** 每项仍恰一个 marker，显示序号、计算样式与正文起点 x 不变；一次 undo/redo 分别恢复精确输入前后文档与选区

#### Scenario: 模型选区与组合提交走同一默认输入合同

- **GIVEN** 光标由 CodeMirror 模型选区置于空有序项、bullet、嵌套项或裸 marker 行的内容起点
- **WHEN** 通过无 `keydown` 的 `insertText` 通道提交普通字符或 IME 组合文本
- **THEN** 仅目标选区被提交文本替换，其他源码逐字不变，选区头落在提交文本末尾
- **AND** marker 数量、显示样式与正文 x 保持稳定，undo/redo、dirty 和显式保存遵循同一跨层合同

#### Scenario: 保存后的历史与 dirty 基线一致

- **GIVEN** 列表内容起点输入已显式保存，保存载荷等于输入后文档且 dirty 已清除
- **WHEN** 依次执行一次 undo 与一次 redo
- **THEN** undo 恢复输入前文档和选区并因不同于保存基线而标 dirty，redo 恢复输入后文档和选区并重新清除 dirty
- **AND** 整个过程中 marker 数量、计算样式与正文起点 x 不漂移
