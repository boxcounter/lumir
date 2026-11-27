## MODIFIED Requirements

### Requirement: 块边界纵向几何的源码同步稳定性

md 模式 live preview 下，普通正文、标题与列表项的纵向 padding SHALL 由同步的块边界几何入口统一写入。
该入口 SHALL 只依赖当前源码行形态、既有语法树的块上下文与 frontmatter 范围，MUST NOT 依赖光标 / 选区、
DOM 测量或列表组异步扫描结果。**普通正文行与空行的纵向 padding SHALL 恒为 0**；列表项首行的 2px 与标题
各级间距 SHALL 保持既有数值；引用、代码、表格与横线 MUST NOT 因该入口获得新的纵向间距。段落之间的纵向
间隔 SHALL 只由空行行高与各块自身的间距承担，MUST NOT 由前一正文行的下距承担。

对于紧邻正文的 bullet / 有序 marker 或 setext 下划线输入前缀，前一正文行的纵向 padding SHALL 恒为 0、
MUST NOT 随 marker 前缀变化；从 marker 首字符到空白再到正文内容的中间状态，未编辑行的纵向几何 MUST
保持不变。列表组的异步扫描 MAY 修正横向标记宽度或编号，但 MUST NOT 改变任何行的 padding、行高或光标纵向
坐标。几何装饰 MUST NOT 仅因 selection 变化而重建；IME 组合期 SHALL 沿用列表装饰的冻结与恢复窗口。

**非语义迁移稳定**：空行 ↔ 有字、普通正文内容编辑、光标 / 选区 / 焦点变化等不改变语法块类型的迁移，所有
行的纵向 padding 与行盒高度 SHALL 保持不变；正文末尾标记（END）的位置、CM heightmap 与 gutter 高度 SHALL
同步稳定。滚动出视口再滚回 MUST 得到同一几何。该条款 SHALL 同时有纯函数层与 DOM 层判据——只判 DOM 会
漏掉陈旧 heightmap。

**语义 reflow 有界**：标题、列表、Setext 等块类型成立或消失时，只有受影响语法块内的行 MAY 改变高度；
块外行的高度 MUST 保持不变，其纵向位移 SHALL 等于前面已获批的高度变化之和。MUST NOT 把该条款收窄成
「只许被编辑的那一行变化」——块类型变化本来就会改变块内行的高度。

#### Scenario: 段落后逐键建立 bullet

- **WHEN** 光标在非空正文行末，依次输入 Enter、`-`、空格与中文字符
- **THEN** Enter 后的每个绘制帧中，前一正文行的 padding-bottom 都是 0、行盒等于正常行高；marker 行
  从首个可用帧起具有 2px 上距，后续语法树或列表组扫描不得再改变两行高度或其纵向位置

#### Scenario: 空行分隔与嵌套对照

- **WHEN** 同一 marker 输入序列出现在空行之后，或在嵌套有序列表中建立含复合编号的新组
- **THEN** 空行及前序块保持既有几何（空行与普通正文行均为 0 纵向 padding、正常行高）；新组首帧的显示编号
  与正文左缘等于扫描同式结果，后续横向复核不改变任何纵向几何

#### Scenario: 光标移动与异步扫描不是纵向几何输入

- **WHEN** 同一文档仅发生 selection 变化，或列表后台扫描发布宽度 / 编号结果
- **THEN** 块边界几何入口不依赖这些事件改变判定，所有受影响行的 padding-top / padding-bottom 保持原值

#### Scenario: 文档末尾空行输入首字

- **WHEN** 光标停在文档末尾的空行上，输入第一个字符
- **THEN** 该行的行盒、active gutter 高度、正文末尾标记的位置与文档总高都不变（±1px）；其后无空行可落
  的 8px 下距 MUST NOT 出现在该行

#### Scenario: 非语义迁移不改变未编辑行

- **WHEN** 在段落之间的空行落字（或在 EOF、连续空行、57 行同族的同类形态上落字）后删除该字符
- **THEN** 全篇每一行的纵向 padding 与行盒高度保持不变；文档总高只随自然行数变化

#### Scenario: 语义 reflow 的边界

- **WHEN** 标题的 `## ` 前缀被删除（heading→text），或普通正文行被加上 `## `（text→heading）
- **THEN** 未编辑的前一行行盒 MUST 保持不变；标题行自身按标题台阶改变高度；其后的行只整体位移，位移量
  等于标题行的高度变化（±1px）
