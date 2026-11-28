## ADDED Requirements

### Requirement: Markdown 不折行时的阅读栏可见窗口

当 Markdown 的 `editor.line_wrap=false` 且正文自然宽度超过当前阅读栏 X 时，应用 SHALL 把 `.cm-content` 作为正文横向 scrollport。X SHALL 仍由既有 grid 中列与 `ui.content_width` 决定，是包含左右各 44px padding 的外框；文字可见窗口 T SHALL 为 X 左右各内缩 44px。自然行宽 MAY 大于 X，但任意横向滚动位置下，文字 glyph、caret 与 selection 的可见部分 MUST NOT 绘制到 T 之外，双侧 44px 留白 MUST 始终保留。超出部分 SHALL 能通过 contentDOM 的横向滚动到达，行尾在最右位置 SHALL 进入 T；裁切不得减少到达行尾所需的可滚范围。外层 `.cm-scroller` SHALL 继续承担纵向滚动，MUST NOT 再因正文自然长行承担整条阅读列的横向滚动。

折行开启时 MUST NOT 启用这条正文 inner 横滚。code 文件 SHALL 保持既有满 pane 与外层横滚模型；Markdown 代码块、宽表 SHALL 保持各自块级横滚容器。实现 MUST NOT 用不可滚的裁切代替滚动，也 MUST NOT 通过改写文档、插入硬换行或强制折行满足可见窗口。

caret、选区、搜索结果与粘贴/编辑后的插入点 SHALL 通过同一公开 CM 扩展路径在 T 内得到最小必要横向揭示；scrollHandler 的 viewport SHALL 与文字裁切窗口同源，不得仍按外框 X 计算。doc-title、END 与行号 gutter MUST NOT 因正文 inner 横滚而被移出既有位置；它们不得因此进入文档字节或全选复制结果。栏宽手柄 SHALL 继续读取 contentDOM 的 grid 框，不被 inner 裁切错误移除。

阅读位置 SHALL 同时保留纵向锚与真实横向 scrollport 的 x。contentDOM 横滚 SHALL 进入既有阅读位置捕获/防抖链；切标签与恢复不得把 inner x 误写到外层。新文档装载 SHALL 从既有篇首位置与横滚起点开始。

#### Scenario: 起点、中段与最右的可见窗口

- **WHEN** 一份含自然超长行的 Markdown 关闭折行，依次把正文横滚置于起点、中段和最右
- **THEN** 三个位置的 glyph 可见交集都位于 T 内，左右各 44px 留白始终存在，外层阅读列不横滚；最右能读到行尾，自然行宽不被改小

#### Scenario: caret、搜索与选区使用同一揭示路径

- **WHEN** 把 caret 从长行起点移到行尾、搜索并选择行尾文本，再粘贴或键入一个合成标记
- **THEN** caret/匹配/选区在 T 内得到最小必要横向揭示；文档只发生预期编辑，undo 一次恢复编辑前字节，scrollTop 不被无关横滚改写

#### Scenario: doc chrome、行号与手柄不随 inner 横滚丢失

- **WHEN** 行号 off/on 且打开含 doc-title 与 END 的 Markdown，在正文横滚起点、中段、最右读取它们
- **THEN** doc-title、END、gutter 和栏宽手柄保持既有几何归属，不被 inner 裁切或带入文档/全选复制

#### Scenario: wrap、code 与块级横滚边界不变

- **WHEN** 同一 fixture 分别开启正文折行、打开 code 文件、滚动 Markdown 的不折行代码块与宽表
- **THEN** wrap 不产生正文 inner 横滚；code 仍满 pane 并由外层横滚；代码块/宽表只在自己的容器内横滚

#### Scenario: 阅读位置与会话切换保留 inner x

- **WHEN** Markdown 正文横滚到非零位置，捕获并恢复阅读位置，再切到另一文档后切回
- **THEN** 恢复后的纵向锚和 contentDOM x 与捕获值一致；外层 x 不错误承接 inner 值，content scroll 已触发既有捕获链

#### Scenario: 超宽选区按 active head 方向做最小揭示

- **WHEN** 对一条宽于 X 的非空选区发放显式 reveal，分别覆盖正向与反向 active head，并在字号调整后再次 reveal
- **THEN** 横向算法使用选择方向执行与 CM 相同的宽矩形二次修正；active head 不越出 T，且保留 reveal 自带的 xMargin；物理横滚边界不得为制造 margin 而越过 0/max

#### Scenario: 文档原点的横向位置独立恢复

- **WHEN** 真实捕获 `{pos:0,y,x>0}` 后重新装载，或带着同一位置交还编辑器焦点
- **THEN** 纵向篇首无需 dispatch 时不发多余纵向效果，但 inner x 仍恢复；target≤0 与焦点往返均不吞掉 x
