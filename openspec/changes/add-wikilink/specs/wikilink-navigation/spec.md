# wikilink-navigation 增量规格

## ADDED Requirements

### Requirement: 链接 span 定位与三态显示

md 模式装饰层 SHALL 在视口内定位 wikilink span（词法范围识别，视口增量构建，沿用 live preview 装饰层纪律），并按 `link_graph_resolve` 返回的解析结果分三态显示（spec §4.1）：`resolved` 正常链接样式（显示 alias 或 target）；`ambiguous` 链接样式加歧义标识，悬停提示候选列表；`unresolved` 未创建链接样式。前端 MUST NOT 在 span 定位之外复制解析语义（架构复查 P1-4）。

#### Scenario: 未创建链接区分显示

- **WHEN** 文档含 `[[不存在的笔记]]` 且解析结果为 `unresolved`
- **THEN** 该链接以未创建样式显示（与正常链接视觉可区分），不显示为错误

#### Scenario: 歧义链接标识

- **WHEN** 文档含 `[[Beta]]` 且解析结果为 `ambiguous`
- **THEN** 链接带歧义标识，悬停可见候选列表

### Requirement: 跳转与标题定位

用户激活链接（点击或键位）时，系统 SHALL 打开目标文件；带 heading path 且锚点找到时滚动定位到该标题行；锚点缺失时 SHALL 打开文件并提示"标题未找到"，MUST NOT 静默停在文件顶部。`ambiguous` 链接的跳转目标为 `chosen`。跳转键位 SHALL 走 keys.ts Keymap 注册，chorded 且非 modal（ADR 0001 §4），MUST NOT 引入 mode 状态机。

#### Scenario: 标题跳转

- **WHEN** 激活 `[[Gamma#设计]]` 且锚点命中
- **THEN** 打开 `folder/Gamma.md` 并定位到"设计"标题行

#### Scenario: 锚点缺失提示

- **WHEN** 激活 `[[Gamma#不存在的标题]]`
- **THEN** 打开目标文件并提示"标题未找到"

### Requirement: 未创建链接一键创建入口

`unresolved` 链接 SHALL 提供一键创建入口，触发 `wikilink_create`（位置与铁律约束见 wikilink-resolution「未创建目标一键创建」）；创建成功后该链接 SHALL 转为正常链接态。

#### Scenario: 一键创建

- **WHEN** 用户对未创建链接 `[[不存在的笔记]]` 触发一键创建
- **THEN** 目标文件创建成功，链接转为正常态，可立即跳转
