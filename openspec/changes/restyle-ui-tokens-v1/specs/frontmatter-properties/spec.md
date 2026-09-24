## MODIFIED Requirements

### Requirement: frontmatter 解析为 properties 区块

md 文件首部的 YAML frontmatter（`---` 包围块）SHALL 解析为 YAML（ADR 0003 §1；解析实现按 ⚠ 裁决点 E，推荐 `js-yaml`）并渲染为 properties 区块——**属性区形态（`.fm`）：字段名等宽 11px 提示色、值 13px 正文色，`status` 等状态类取值 SHALL 渲染为语义 chip（色值取语义色 token，不渲染裸字符串），区块为浅底圆角、置于文档顶部标题之前**，替换 frontmatter 源码原文在文档顶部的显示；eink 主题下该区块 SHALL 翻转为白底黑框、chip 描边化（eink 降级规则 ⑤⑥）。无 frontmatter 的文档 SHALL 不显示该区块。嵌套值 SHALL 以 JSON 样式字符串展示，解析层 MUST NOT 自造 YAML 方言子集。properties 区块为跨行 replace 装饰，CM6 视口插件装饰不支持跨行 replace（硬限制），其实现 SHALL 经 StateField 构建、仅在文档变更时重算、frontmatter 探测自文档首部扫描且有行数上限；该路径 MUST NOT 退化为全量文档装饰构建（与 editor-live-preview「live preview 装饰层」的视口增量策略同一性能意图：打开 1MB <100ms，ADR 0002 §6）。

#### Scenario: properties 区块渲染

- **WHEN** md 文件以合法 frontmatter 开头（含字符串、数组、嵌套字段）
- **THEN** 文档顶部显示 properties 属性区（字段名等宽灰、值正文色、状态值为语义 chip），frontmatter 源码原文不显示

#### Scenario: 无 frontmatter

- **WHEN** md 文件无 frontmatter
- **THEN** 不显示 properties 区块，文档从正文开始渲染
