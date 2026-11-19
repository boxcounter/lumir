# ui-language 增量规格

> 起草注记（非规格正文）：本 change 把「Rust 侧错误按 code 渲染」的口径扩到**配置诊断信封**
> （`ConfigDiagnostic{code, path, message}`），并把「诊断没有参数通道 → 模板不带占位、读数由
> 键路径承担」写成合同。日志 / 告警不进语言面的口径不变。根因与门禁落点见
> [design.md](../../design.md)。MODIFIED 条基于当前 living spec
> （`openspec/specs/ui-language/spec.md`）的原文整块复制后改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: Rust 侧错误的文案归属

后端经错误信封送达前端的可见文案 SHALL 由前端按 `code` 渲染，MUST NOT 直接把后端格式化的人话 message 当作上屏文本（那是固定语言）。

错误信封 SHALL 同时携带 `code`（稳定标识）与该条文案所需的参数（键值对，按需携带）；Rust 侧的 message SHALL 保留但改变职责：它是**诊断日志的内容**与**未知 code 的兜底**，MUST NOT 在 code 已知时上屏。日志文本本身不随界面语言变化（终裁：诊断面向开发者、语言固定，见「不随语言变化的面」）。

配置诊断信封（`ConfigDiagnostic{code, path, message}`，设置面板的装载期诊断）SHALL 同属本口径：其 `message` 是诊断日志内容与未知 `code` 的兜底，可见文案由前端按 `code` 渲染。该信封**没有参数通道**（不携带 params），因此其文案模板 MUST NOT 带占位，读数 SHALL 由同一条诊断的键路径（`path`）与所在行承担；模板 MUST NOT 内插用户配置值、API Key 或内部错误串。模型行等派生视图若只拿到 message，SHALL 按同一条键路径从同一份快照取回 `code` 后渲染，取不齐时回落 message。同一 `code` 在两条信封上语义相反时（装载期「已忽略」vs 保存被拒「改哪里才能保存」），SHALL 按信封分别持有文案（字段错误面走既有改道表），MUST NOT 用一句话同时承担两种事实。

完整性 SHALL 由门禁保证：后端可能产出的 code 集合与前端的文案条目 SHALL 逐一对账（缺一即判 FAIL）。因此「未知 code 兜底」在实现上是不可达路径（保留它只为向前兼容）。一个 code 对应多种 message 模板时（现状 46 个 code 里有 23 个如此），前端 SHALL 写一条覆盖该 code 各情形的句子并以参数承担差异，MUST NOT 为每个模板新建一个 code（code 是语义分类，不是消息 id）。只经 console / 诊断日志出口、键路径永远不在上屏范围内的配置告警（编辑器、主题、键位、日志、vault、cron、装载失败等）SHALL 以**显式豁免表**登记：豁免项 MUST 真实存在构造点，且 MUST NOT 同时持有上屏文案条目（没有消费者的条目 = 无声的假豁免）。

不随语言变化的诊断面 SHALL 保持：日志事件名、等级、字段名与 message 内容都不受语言设置影响（日志面向开发者，语言固定）。

由操作系统渲染的界面文本（当前的用例是原生目录选择器的标题）无法运行期切换：后端 SHALL 在弹出时读一次当前语言并据此取值；已弹出的系统对话框 MUST NOT 被期望跟随切换。

#### Scenario: 全部 code 有对应文案

- **WHEN** 逐一对账后端可能产出的 code 与前端文案条目
- **THEN** 每个 code 都有条目，缺一判 FAIL；`en` 模式下触发任一后端错误时上屏文本为英文列（MUST NOT 出现中文 message）

#### Scenario: 配置诊断按 code 上屏

- **WHEN** 在 `en` 界面下打开设置面板，快照带有 provider 级诊断与模型行装载期 notes
- **THEN** 诊断行与模型行 notes 都取对应 `code` 的 English 列，MUST NOT 出现后端中文 message；
  模板不内插配置值与内部错误串（读数由键路径与所在行承担）

#### Scenario: 诊断的未知 code 兜底

- **WHEN** 诊断带有本版本文案表未登记的 `code`
- **THEN** 该行回落显示后端 message（MUST NOT 显示空白或裸 code），并记一条诊断；
  同屏其它诊断照常按各自的 `code` 渲染

#### Scenario: 未知 code 的兜底

- **WHEN** 收到一个不在对账集合内的 code（向前兼容路径）
- **THEN** 回落显示后端提供的 message（MUST NOT 显示空白或裸 code），并记一条诊断；该路径 MUST NOT 因缺文案而静默吞掉提示

#### Scenario: 参数由后端提供

- **WHEN** 触发一条含路径 / 文件名 / 数值参数的后端错误（如读取失败、另存为新文件、文件超限）
- **THEN** 上屏文本由前端文案模板与后端携带的参数组装，未出现「参数缺失留下的空位」或未替换的占位符

#### Scenario: 日志不随语言变化

- **WHEN** 在 `zh` 与 `en` 下分别触发同一后端错误并检查诊断日志
- **THEN** 事件名、等级与 message 内容逐字相同（日志面不受语言设置影响）

#### Scenario: 系统对话框标题按弹出时的语言取值

- **WHEN** 在 `en` 下触发原生目录选择器
- **THEN** 其标题取英文列；弹出后切换语言时该对话框 MUST NOT 被期望跟随（如实登记为边界）
