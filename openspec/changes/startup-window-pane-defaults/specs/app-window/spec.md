# app-window Specification Delta

> 起草注记（非规格正文）：本 capability 为**新建**——把主窗口的启动几何（首启 90% 工作区居中、
> 其后记住尺寸与位置）从「构建配置里的固定数字」升为一条可裁决的行为。技术方案、存档形状与
> 多显示器校验见 [design.md](../../design.md) §3。

## ADDED Requirements

### Requirement: 首启窗口几何

**首次启动**（无窗口几何存档）时，主窗口的尺寸 SHALL 为**工作区**（窗口所在显示器的可用区域——macOS 上即 `NSScreen.visibleFrame`，排除菜单栏与 Dock）的 90%，并在工作区内水平与垂直居中；窗口 MUST NOT 越出工作区。尺寸 SHALL 按工作区的物理像素计算后四舍五入取整。工作区不可得（查询失败 / 无可用显示器）时，窗口 SHALL 回落构建配置声明的占位尺寸，MUST NOT 报错、MUST NOT 阻断启动。

#### Scenario: 首次启动 90% 居中

- **WHEN** 清空窗口几何存档后启动 app，工作区为 W×H
- **THEN** 主窗口尺寸约为 0.9W × 0.9H，在可用区域内水平与垂直居中，窗口完整落在工作区内（不被菜单栏或 Dock 遮挡）

#### Scenario: 工作区不可得时回落

- **WHEN** 启动时取不到任何显示器的可用区域
- **THEN** 窗口按构建配置的占位尺寸出现，启动不被阻断、无错误提示，后续启动照常尝试 90% 规则

### Requirement: 窗口几何的持久化与恢复

系统 SHALL 把主窗口的**尺寸与位置**持久化到配置目录下的**独立小文件**（`<config>/lumir/window-state.json`，与 vault-sessions / reading-positions 同惯例——易变界面状态不混进 `config.json`，MUST NOT 为此新增 `config.json` 配置键）。非首启（有可用存档）时，窗口 SHALL 以存档的尺寸与位置出现，MUST NOT 先以占位尺寸出现再跳变到存档几何。

写入 SHALL 用临时文件 + rename 原子替换；写失败 SHALL 降级为 warning（不拦停退出）。读取侧，下列情形对调用方的语义完全相同——「没有存档，按首启规则」：文件缺失、不可读、非合法 JSON、`version` 与实现不符、几何字段缺失或类型非法；一律 MUST NOT 抛错、MUST NOT 阻断启动（后三类记 warning，缺失是首启常态、不报警）。

存档的几何 SHALL 在**窗口所在显示器**的坐标系下解读，并以逻辑像素（点）落盘——跨 Retina / 非 Retina 显示器迁移时逻辑尺寸稳定而物理像素不稳定。显示器布局变化（存档所在屏已拔除 / 分辨率变化）导致存档矩形与**任一**显示器的工作区均无交集时，窗口 SHALL 回落**首启规则在主显示器上的结果**，MUST NOT 把窗口放到屏幕外或整窗落在屏外；存档矩形与某工作区有非空交集时 SHALL 按存档施加（部分越出是合法状态，MUST NOT 主动收回）。

写入时机 SHALL 覆盖「窗口尺寸或位置变化后（可防抖）」与「退出前 flush」（macOS 上 Cmd+Q 经 `applicationWillTerminate` 亦到达该刷新点），MUST NOT 只依赖退出钩子。窗口几何 SHALL 是应用级单份状态（MUST NOT 按 vault 分区）。

#### Scenario: 二次启动恢复尺寸与位置

- **WHEN** 调整窗口尺寸与位置后正常退出，再启动
- **THEN** 窗口以存档的尺寸与位置出现（首帧即为该几何，无先占位后跳变）

#### Scenario: 存档损坏回落首启规则

- **WHEN** 存档文件被截断、含非法字段，或 `version` 与实现不符
- **THEN** 窗口按首启规则（工作区 90% 居中）出现，无错误提示，记一条 warning

#### Scenario: 显示器变化后不放到屏外

- **WHEN** 存档记录的窗口位于一台已拔除的显示器上（或该屏分辨率/布局已变），存档矩形与任一现存显示器的工作区均无交集
- **THEN** 启动时窗口回落到主显示器的 90% 居中位置，完整落在可用区域内

#### Scenario: 存档仅部分越出时不收回

- **WHEN** 存档窗口比主显示器工作区更大（用户此前故意摆出的尺寸），存档矩形与工作区有非空交集
- **THEN** 窗口按存档几何施加，MUST NOT 被自动收缩或重新居中

#### Scenario: 不新增 config.json 键

- **WHEN** 检查配置目录与 `config.json`
- **THEN** 窗口几何只存在于 `window-state.json`，`config.json` 不出现任何窗口几何键
