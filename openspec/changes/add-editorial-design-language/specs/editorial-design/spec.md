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

## MODIFIED Requirements

### Requirement: 性能与事实来源

实现 MUST 保持 ADR 0002 §6 性能合同，不得以主题或装饰层放宽既有预算。workspace 磁盘目录 MUST 继续作为真实文件 source of truth。

#### Scenario: 视觉回归
- **WHEN** 运行三主题视觉回归与性能合同
- **THEN** 既有性能断言继续通过，回归覆盖三主题且不掩盖布局溢出
