# editor-live-preview Specification

## ADDED Requirements

### Requirement: GFM 短行表格尾部补空列与多列整块降级

md 模式 SHALL 按 [GFM spec §4.10](https://github.github.com/gfm/#tables-extension-) 处理数据行 cell 数与表头不同的 pipe table：数据行 cell 数**少于**表头列数时，系统 SHALL 在尾部补空 cell 并把整表按矩形呈现，MUST NOT 因这一行整块回退为源码。补出的空 cell SHALL 与源文件里的空格空槽、`||` 零宽空槽同形——不填占位符、不加「缺列」之类的标记，列边界 SHALL 与表头列对齐；装饰 MUST NOT 改写文档内容，`EditorState.doc` 与磁盘文件逐字节不变。数据行 cell 数**多于**表头列数时，系统 SHALL 维持整块源码降级（GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突）；表头与分隔行列数不一致、槽位不能安全映射、范围不完整同样 MUST 整块降级。降级文案 SHALL 继续指认首个与表头列数不符的数据行的文档行号与表头列数。

#### Scenario: 短行尾部补空列

- **WHEN** 用户打开一份表头声明 6 列、其中若干数据行只有 5 格的 Markdown 文件（M137 实测的 `outline.md` 形态）
- **THEN** 该表按 6 列矩形呈现，缺列行的末格是空白 cell，各列边界与表头列对齐；屏幕上不出现表格降级提示，文档与磁盘文件逐字节不变

#### Scenario: 多列表整块降级

- **WHEN** parser 识别的 Table 中有数据行 cell 数多于表头列数
- **THEN** 该表整块显示可读源码，并给出指认出错行文档行号与表头列数的降级文案；系统 MUST NOT 静默丢弃多余 cell，也 MUST NOT 只丢多出的列后照常渲染
