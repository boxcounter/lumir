## ADDED Requirements

### Requirement: Editorial 视觉系统

系统 SHALL 提供 light、dark、eink 三主题 token。eink MUST 仅使用纯黑与纯白，并禁用灰阶、透明、阴影、动画与过渡。正文 MUST 使用黑体 16px、行高 1.75；标题 MUST 使用宋黑对比。默认行宽 MUST 为 480px，且可调值 MUST 写入 config。

#### Scenario: 切换主题
- **WHEN** 用户切换 light、dark 或 eink
- **THEN** 页面应用对应 token；eink 不产生彩色、透明或动画

### Requirement: Editorial 壳层

界面 SHALL 呈现 masthead 与低 chrome 排印布局。toast 样式 MUST 归属于 CSS。config 探针 MUST 不再显示。右侧 Context Surface MUST 默认隐藏，且编辑点出现或消失不得推动正文版位。

#### Scenario: 干净文档
- **WHEN** 当前没有编辑点
- **THEN** 右栏不存在，不显示占位，不显示 config 探针

### Requirement: 双空间导航

左栏 SHALL 默认显示 workspace 目录树，并在下方显示 Threads 分区。目录树 MUST 通过缩进、字重、明度、¶ 选中态、截断和深层嵌套表达层级。文件属于 workspace；角色只属于 Thread。被多个 Thread 引用的文件 MUST 显示 `×n` 计数。

#### Scenario: 共享文件
- **WHEN** 两个 Thread 引用同一文件
- **THEN** 文件在真实目录位置显示一次并带 `×2`，各 Thread 在自身角色列表显示该引用

### Requirement: Threads 最小模型

系统 SHALL 支持 Thread 的标题、状态、角色化文件关联与最近活动。状态 MUST 仅为进行中、暂停、完成、归档。Thread MUST 持久化于 `~/.config/lumir/threads/`，并支持创建、切换与列表。Thread 不拥有文件，关联仅表达角色。

#### Scenario: 创建与切换 Thread
- **WHEN** 用户创建 Thread、为其关联文件角色并切换当前 Thread
- **THEN** 新 Thread 写入持久化目录，列表显示标题与状态，切换后显示其角色关联

### Requirement: Vault 引用稳定持久化
Thread 与 workspace 的文件引用 MUST 同时存储稳定 id 与 vault 相对路径；`~/.config/lumir/workspaces/` 注册表 MUST 承载稳定 id 到当前 vault 路径的映射，Thread 注册表 MUST 保持在全局 `~/.config/lumir/threads/`。vault 路径变动 MUST 通过显式重映射流程更新引用，MUST NOT 静默断联或把路径变动当作新文件。

#### Scenario: Vault 路径变动
- **WHEN** vault 被移动或其路径发生变化
- **THEN** 系统要求或执行重映射，更新 workspace 注册表及相关引用；在重映射完成前保留稳定 id 与原相对路径，并报告无法解析的引用

### Requirement: Thread brief 文件来源
Thread brief MUST 是 vault 内的真实文件，可由外部 Agent 写入、由人修改并由 git 跟踪；Thread 注册表 MUST 仅存 brief 的 vault 相对路径引用，不得复制或拥有 brief 内容。该引用约定 MUST 为 genesis 入站（外部 Agent 会话产物进入 Lumir 上下文）预留接口。

#### Scenario: 外部 Agent 生成 brief
- **WHEN** 外部 Agent 在 vault 中创建或更新 Thread brief
- **THEN** Lumir 通过 Thread 注册表中的 vault 相对路径读取该真实文件，保留外部修改与 git 版本历史，并可将其作为 genesis 入站上下文

### Requirement: Threads 区不伪造编辑点计数

Threads 区 MUST 预留状态与计数的结构位置，但本 change 不实现编辑点，因此 MUST 不渲染开放、处理中或待回看计数，也不得使用假数据。

#### Scenario: 尚未接入编辑点
- **WHEN** 用户查看任一 Thread
- **THEN** 只显示标题、四态状态、最近活动与文件角色，不显示编辑点计数

### Requirement: 性能与事实来源

实现 MUST 保持 ADR 0002 §6 性能合同，不得以主题或装饰层放宽既有预算。workspace 磁盘目录 MUST 继续作为真实文件 source of truth。

#### Scenario: 视觉回归
- **WHEN** 运行三主题视觉回归与性能合同
- **THEN** 既有性能断言继续通过，回归覆盖三主题且不掩盖布局溢出
