## MODIFIED Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的侧栏（宽 236px，见 ui-design-system「应用骨架布局」）挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的行形态 SHALL 取 design tokens：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色 `--sel`、hover 底色 `--hover`；eink 主题下选中态 SHALL 为黑底反白，行内次级元素（徽标 / ghost 项）SHALL 同步反白（eink 降级规则 ④）。树的数据来源 SHALL 为 fs-io 的枚举结果与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

#### Scenario: 全类型混合展示

- **WHEN** vault 含 md、代码、图片、嵌套目录
- **THEN** 文件树全部展示并正确区分类型，不只展示 Markdown

#### Scenario: 行形态与层级缩进

- **WHEN** 展开三层嵌套目录并选中其中一个文件
- **THEN** 各行高 25px，缩进按 `8px + 14px × 层深` 逐级递增；选中行取选中态底色（eink 下黑底反白）
