## ADDED Requirements

### Requirement: 块边界纵向几何的源码同步稳定性

md 模式 live preview 下，普通正文、标题与列表项的纵向 padding SHALL 由同步的块边界几何入口统一写入。
该入口 SHALL 只依赖当前源码行形态、既有语法树的块上下文与 frontmatter 范围，MUST NOT 依赖光标 / 选区、
DOM 测量或列表组异步扫描结果。普通段落的 8px、列表项首行的 2px 与标题各级间距 SHALL 保持既有数值；
空行、引用、代码、表格与横线 MUST NOT 因该入口获得新的纵向间距。

对于紧邻正文的 bullet / 有序 marker 或 setext 下划线输入前缀，前一正文行的块末判定 SHALL 由源码行形态
同步成立；从 marker 首字符到空白再到正文内容的中间状态，未编辑行的纵向几何 MUST 保持不变。列表组的
异步扫描 MAY 修正横向标记宽度或编号，但 MUST NOT 改变任何行的 padding、行高或光标纵向坐标。几何装饰
MUST NOT 仅因 selection 变化而重建；IME 组合期 SHALL 沿用列表装饰的冻结与恢复窗口。

#### Scenario: 段落后逐键建立 bullet

- **WHEN** 光标在非空正文行末，依次输入 Enter、`-`、空格与中文字符
- **THEN** Enter 后的每个绘制帧中，前一正文行都保留 8px 段落下距；marker 行从首个可用帧起具有 2px
  上距，后续语法树或列表组扫描不得再改变两行高度或其纵向位置

#### Scenario: 空行分隔与嵌套对照

- **WHEN** 同一 marker 输入序列出现在空行之后，或在嵌套有序列表中建立含复合编号的新组
- **THEN** 空行及前序块保持既有几何；新组首帧的显示编号与正文左缘等于扫描同式结果，后续横向复核
  不改变任何纵向几何

#### Scenario: 光标移动与异步扫描不是纵向几何输入

- **WHEN** 同一文档仅发生 selection 变化，或列表后台扫描发布宽度 / 编号结果
- **THEN** 块边界几何入口不依赖这些事件改变判定，所有受影响行的 padding-top / padding-bottom 保持原值
