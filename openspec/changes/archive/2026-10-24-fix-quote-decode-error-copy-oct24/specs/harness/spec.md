# harness 增量规格（M680）

> 起草注记（非规格正文）：一条 ADDED，基线是 living spec
> [openspec/specs/harness/spec.md](../../../../../specs/harness/spec.md)。本增量依附于活跃 change
> `quote-pipeline-consistency-oct24` 的「引用失败的留痕与引用语境反馈」——那条已经立下「失败人话
> 按调用点分码」的原则，但只覆盖了格式不支持；该 change 尚未归档，故本 change 不能 MODIFIED
> 它，只能 ADDED 一条并列的 requirement。缺口来源是 change `svg-image-quote-oct24` 的
> design §D6 / tasks 6.2。本增量与它的三条 requirement 不重叠（那三条分别是留痕与格式不支持的
> 措辞、卡片含图读数、会话名回落），只补「解码失败」这一条失败面。归档顺序 MUST 是 `add-image-quote-to-chat` →
> `quote-pipeline-consistency-oct24` → `svg-image-quote-oct24` → 本 change。

## ADDED Requirements

### Requirement: 引用路径解码失败的文案

引用路径（vault 图片 → harness 存储）的**解码失败** SHALL 上屏引用语境的人话：该文案 MUST NOT
出现「剪贴板」（英文列 MUST NOT 出现 "clipboard"），MUST NOT 与格式不支持的文案混用——解码失败
说的是「格式支持，但这份字节解不开（不是合法图片 / SVG 解析失败 / 画布尺寸非法）」，格式不支持
说的是「这种格式还不支持」。两条文案 SHALL 互不为子串，使人侧一眼能分辨「换一张图就好」与
「这个格式现在做不到」。

错误码 SHALL 保持单一一族：MUST NOT 为引用语境新增后端 code。语境差异 SHALL 由前端在**调用点**
渲染——同一个 `attachment_decode_failed` 在粘贴路径读粘贴语境条目、在引用路径读引用语境条目。
粘贴路径的上屏文案 MUST NOT 因本条款改变任何字。

引用语境的解码失败文案 SHALL 是文案表的一条独立条目（编号唯一；deck 与运行时表两列逐字一致，
由既有漂移门禁强制）。参数 `{reason}` SHALL 来自后端错误信封，前端 MUST NOT 重算或改写它；
信封缺该参数时上屏 SHALL 回落为后端提供的 message，MUST NOT 抛错，MUST NOT 出现未替换的占位符。

该失败 SHALL 沿用引用事务既有的失败契约：该张不产图片卡片、其余张照常插入、失败读数随结果返回
并在输入区持久留痕（见「引用失败的留痕与引用语境反馈」）。

#### Scenario: 引用一张字节损坏的位图

- **WHEN** 选中含 `![[broken.png]]` 的源码并摘录到对话（该文件的字节不是合法 png）
- **THEN** toast 是引用语境的说法（含「无法解码」/ "decode"，不含「剪贴板」/ "clipboard"，
  也不等于「暂不支持引用该格式」那一句）；输入区出现「1 张图片未能引用」的持久状态行，
  composer 里没有该图的卡片

#### Scenario: 畸形 SVG 的栅格化失败

- **WHEN** 引用一张 XML 不完整或画布尺寸非法的 svg
- **THEN** 上屏同一条引用语境解码失败文案；MUST NOT 出现粘贴语境文案，MUST NOT 出现格式不支持
  文案

#### Scenario: 真实粘贴路径逐字不变

- **WHEN** 粘贴一张字节损坏的 png（与引用共用同一个写原语、同一个 `attachment_decode_failed`）
- **THEN** 上屏仍是粘贴语境的「无法解码剪贴板图片：{reason}」，与本 change 之前逐字相同

#### Scenario: 缺参不抛

- **WHEN** 后端错误信封缺 `reason` 参数
- **THEN** 提示不变成异常：上屏回落为后端提供的 message，MUST NOT 出现未替换的 `{reason}`
