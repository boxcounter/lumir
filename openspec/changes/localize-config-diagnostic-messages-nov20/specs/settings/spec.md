# settings 增量规格

> 起草注记（非规格正文）：本 change 只改「设置面诊断的上屏来源」——`ConfigDiagnostic` 与
> 模型行中的这一句从直出后端 message 改为按 `code` 取文案表。校验规则、保存通道、path 路由与
> 阻断级判定一律不动；根因、分类与门禁落点见 [design.md](../../design.md)。MODIFIED 条基于
> 当前 living spec（`openspec/specs/settings/spec.md`）的原文整块复制后改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: 设置面的校验与警告呈现

字段级错误 SHALL 回填到具体控件：控件 SHALL 标 `aria-invalid="true"`，并通过
`aria-errormessage`（或等价的 `aria-describedby`）关联错误文本；保存失败后焦点 SHALL 落到
第一个错误控件。错误文本 SHALL 来自后端诊断，MUST NOT 由前端按控件自行编造；其上屏文本 SHALL
由前端按后端 `code` 从文案表渲染（`ERROR_COPY`，字段错误面经 `FIELD_ERROR_COPY` 改道），
MUST NOT 直出后端格式化的人话 message。

面板 SHALL 展示**设置面范围内**的配置诊断（provider 条目非法、模型清单为空、当前模型不在
清单、命名目标失效、Wire 档回落等），每条 SHALL 以可读形式同时展示**键路径**（如
`harness.providers.kimi-work.model`）与消息；范围外的 warning（主题、编辑器、vault 等）
MUST NOT 倒进本面板。命名目标失效的两类后果 MUST NOT 混写：会话命名回落该 provider 的生效
模型并给 warning；图片命名跳过、保留暂存名、不换模型。整文件回落或文件不可解析时，面板顶部
SHALL 显示横幅并给出文件路径与解析错误位置；该横幅优先级高于字段级提示。

诊断的**上屏文本** SHALL 与字段错误同口径：由前端按 `ConfigDiagnostic.code` 从文案表渲染，
MUST NOT 直出后端 message；键路径 SHALL 与文案分列呈现（诊断行上路径独立，文案不内插路径、
配置值与内部错误串）。模型行的装载期 notes SHALL 以同一键路径
（`harness.providers.<id>.models[<i>]` 及其后代）从设置快照的诊断里取回 `code` 后渲染；
取不齐（条数对不上）或未知 `code` 时 SHALL 回落后端 message（MUST NOT 显示空白、裸 code 或
把别的行的诊断串进来）。诊断信封不携带参数通道，其模板 MUST NOT 带占位。

保存状态（没有未保存的修改 / 有未保存的修改 / 保存中 / 已保存 / 需要修正 / 外部冲突）
SHALL 以可见文本呈现，并进入 `role="status"` 的 polite live region 供辅助技术宣告；
MUST NOT 只用颜色或图标表达。

#### Scenario: 重复模型 id 回填到行

- **WHEN** 某个 provider 的模型清单里两行使用同一个 `id` 并保存
- **THEN** **两行**的 id 控件都标 `aria-invalid="true"` 并各带重复原因，焦点落到第一行；
  状态行显示「需要修正」，文件不变

#### Scenario: provider 条目诊断挂在条目上

- **WHEN** 文件里某 provider 的 `preset` 非法而被装载期忽略
- **THEN** 列表中该行显示「装载期已忽略」与键路径 + 原因（原因为文案表里该 `code` 的措辞，
  不是后端中文 message）；其他 provider 的诊断不串到这一行；面板不显示主题 / 编辑器等范围外
  warning

#### Scenario: 诊断与模型行 notes 按 code 上屏

- **WHEN** 在 `en` 界面下打开设置面板，快照里带有 provider 级诊断与模型行的装载期 notes
- **THEN** 诊断行与模型行 notes 都是英文（取对应 `code` 的 English 列），MUST NOT 出现后端
  中文 message；`zh` 界面下同一现场取中文列，两档是两份文案

#### Scenario: 未知诊断 code 安全回落

- **WHEN** 快照里的诊断带有本版本文案表未登记的 `code`
- **THEN** 该行回落显示后端 message（MUST NOT 显示空白、裸 code 或别的 code 的文案），
  同屏其它诊断照常本地化

#### Scenario: 保存状态可被辅助技术读到

- **WHEN** 保存成功
- **THEN** 状态行文本变为「已保存」，且该文本位于 `role="status"` 的 polite live region 内
