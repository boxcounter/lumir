# frontmatter-properties 增量规格

## ADDED Requirements

### Requirement: frontmatter 解析为 properties 区块

md 文件首部的 YAML frontmatter（`---` 包围块）SHALL 解析为 YAML（ADR 0003 §1；解析实现按 ⚠ 裁决点 E，推荐 `js-yaml`）并渲染为 properties 区块——键值表格形态，替换 frontmatter 源码原文在文档顶部的显示。无 frontmatter 的文档 SHALL 不显示该区块。嵌套值 SHALL 以 JSON 样式字符串展示，解析层 MUST NOT 自造 YAML 方言子集。properties 区块为跨行 replace 装饰，CM6 视口插件装饰不支持跨行 replace（硬限制），其实现 SHALL 经 StateField 构建、仅在文档变更时重算、frontmatter 探测自文档首部扫描且有行数上限；该路径 MUST NOT 退化为全量文档装饰构建（与 editor-live-preview「live preview 装饰层」的视口增量策略同一性能意图：打开 1MB <100ms，ADR 0002 §6）。

#### Scenario: properties 区块渲染

- **WHEN** md 文件以合法 frontmatter 开头（含字符串、数组、嵌套字段）
- **THEN** 文档顶部显示 properties 键值区块，frontmatter 源码原文不显示

#### Scenario: 无 frontmatter

- **WHEN** md 文件无 frontmatter
- **THEN** 不显示 properties 区块，文档从正文开始渲染

### Requirement: tags 标签形态

frontmatter 中的 `tags` 字段（数组或单个字符串）SHALL 以标签形态展示于 properties 区块内，与其他键值视觉区分（ADR 0003 §1：tags 可用于过滤——过滤交互本身不在本 change）。

#### Scenario: tags 渲染

- **WHEN** frontmatter 含 `tags: [a, b]`
- **THEN** properties 区块内 a、b 以标签形态展示

### Requirement: 解析失败回退

frontmatter 不是合法 YAML 时，系统 SHALL 回退为按原文显示该区块并给出可见提示，MUST NOT 丢弃、改动或截断内容，MUST NOT 阻断文档其余部分的渲染。

#### Scenario: 非法 YAML 回退

- **WHEN** frontmatter 块内 YAML 语法错误
- **THEN** 该区块按原文显示并附"frontmatter 解析失败"提示，正文正常渲染
