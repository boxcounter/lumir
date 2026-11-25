# harness Specification Delta

## ADDED Requirements

### Requirement: Harness Markdown strong 的流式渲染一致性

凡项目既有 `@lezer/markdown` GFM 配置认定为 `StrongEmphasis` 的 strong，Harness SHALL 在普通段落、
有序/无序列表、嵌套列表、跨行项、CJK/英文、标点与同行后续文本中一致渲染为 `<strong>`，MUST NOT
把对应 delimiter 当作字面星号上屏。0 个 strong 的文本 MUST NOT 新增 strong；多个 strong SHALL
分别保留其范围。代码 span、围栏/缩进代码块与转义星号 SHALL 保持字面文本，MUST NOT 因本合同
被转为 strong。本 requirement MUST NOT 扩展既有 GFM 解析器未认定为 strong 的语法。

流式增量渲染与终态渲染 SHALL 对同一段完整源收敛到相同的 strong 语义。流式定稿 MUST NOT
在仍可能被后续缩进段落延续的列表内部切断块级上下文；尤其有序/无序列表空行后的合法缩进续段
MUST NOT 被切成顶层缩进代码块。确认列表已被后续顶层块关闭后，该列表 SHALL 可以定稿；普通段落
与已闭合代码围栏的既有定稿能力 MUST NOT 被移除。本合同只约束解析与 DOM 语义，MUST NOT 改变
既有排版、进度尾行、引用卡、工具卡或审批卡。

#### Scenario: strong 宿主与文本矩阵

- **WHEN** 同一真实渲染件处理普通段落、有序/无序/嵌套列表和跨行项中的 0/1/多个 strong，
  输入覆盖 CJK、英文、标点与闭合 delimiter 后的同行后续文本
- **THEN** 每个被既有 GFM 解析器认定的 strong 都生成对应 `<strong>`，可见文本不含其 delimiter，
  后续文本仍按原文呈现；无 strong 的宿主不产生 `<strong>`

#### Scenario: 代码链接与转义反例

- **WHEN** strong 内含链接或代码 span，链接内含 strong，或列表/段落含 `` `**代码**` ``、
  围栏代码与 `\*\*转义\*\*`
- **THEN** strong 与链接的嵌套范围保持解析语义；代码和转义中的星号逐字保留且不生成 `<strong>`，
  不得通过全局替换星号获得表面正确

#### Scenario: 空行后的列表缩进续段流式到达

- **WHEN** 有序列表项在空行后以四空格缩进继续一个含 `**粗体**后续` 的合法段落，流式 chunk
  先到达列表与该续段，稍后才到达后续顶层块
- **THEN** 中间态与终态都把续段保留在列表项内并渲染 `<strong>`，不得产生含该续段的顶层
  `<pre>` 或字面 `**`；后续顶层块到达后列表可定稿

#### Scenario: 已结束块仍可定稿

- **WHEN** 普通段落后出现空行，或列表/闭合代码围栏之后已经出现后续顶层块
- **THEN** 已结束块按既有增量路径定稿，进行中的尾块继续重渲；不得为了修复列表上下文而
  退化为每个 chunk 都冻结全部正文或取消全部增量定稿
