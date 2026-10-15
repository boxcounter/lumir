# app-window Specification

## Purpose
主窗口尺寸的启动规则与持久化：首启按工作区 90% 出现，之后的尺寸跨启动恢复（位置永远交给 OS）。

## Requirements

### Requirement: 首启窗口尺寸

**首次启动**（无窗口尺寸存档）时，主窗口的尺寸 SHALL 为**工作区**（窗口所在显示器的可用区域——macOS 上即 `NSScreen.visibleFrame`，排除菜单栏与 Dock）的 90%；尺寸 SHALL 按工作区的物理像素计算后四舍五入取整，MUST NOT 超过工作区尺寸。窗口位置 MUST NOT 由本 capability 决定——不施加、不持久化、不作判据（交给 OS 默认放置）。工作区不可得（查询失败 / 无可用显示器）时，窗口 SHALL 回落构建配置声明的占位尺寸，MUST NOT 报错、MUST NOT 阻断启动。

#### Scenario: 首次启动尺寸为工作区 90%

- **WHEN** 清空窗口尺寸存档后启动 app，工作区为 W×H
- **THEN** 主窗口尺寸约为 0.9W × 0.9H（物理像素四舍五入），且不超过工作区尺寸；窗口落在哪个位置不作断言

#### Scenario: 工作区不可得时回落

- **WHEN** 启动时取不到任何显示器的可用区域
- **THEN** 窗口按构建配置的占位尺寸出现，启动不被阻断、无错误提示，后续启动照常尝试 90% 规则

### Requirement: 窗口尺寸的持久化与恢复

系统 SHALL 把主窗口的**尺寸**持久化到配置目录下的**独立小文件**（`<config>/lumir/window-state.json`，与 vault-sessions / reading-positions 同惯例——易变界面状态不混进 `config.json`，MUST NOT 为此新增 `config.json` 配置键）。存档 SHALL 只含尺寸（`width` / `height`，逻辑像素）——窗口**位置** MUST NOT 落盘。非首启（有可用存档）时，窗口 SHALL 以存档尺寸出现，MUST NOT 先以占位尺寸出现再跳变；窗口位置 SHALL 由 OS 的默认放置决定，MUST NOT 由本 capability 施加。

写入 SHALL 用临时文件 + rename 原子替换；写失败 SHALL 降级为 warning（不拦停退出）。读取侧，下列情形对调用方的语义完全相同——「没有存档，按首启规则」：文件缺失、不可读、非合法 JSON、`version` 与实现不符、尺寸字段缺失或类型非法；一律 MUST NOT 抛错、MUST NOT 阻断启动（后三类记 warning，缺失是首启常态、不报警）。存档中的未知字段 SHALL 被忽略——本 change 尚未发布、无存量存档，MUST NOT 引入兼容层。

存档尺寸 SHALL 以逻辑像素（点）落盘——跨 Retina / 非 Retina 显示器迁移时逻辑尺寸稳定而物理像素不稳定。恢复时 SHALL 把存档尺寸**逐维钳进窗口所在显示器的工作区**（`min(存档宽, 工作区宽)` / `min(存档高, 工作区高)`），MUST NOT 超过工作区尺寸；不超过工作区的存档尺寸 SHALL 原样施加、MUST NOT 被无谓收缩；工作区不可得（查询失败 / 无可用显示器）时 SHALL 不钳、按存档尺寸施加并记一条 warning。

写入时机 SHALL 是「窗口**尺寸**变化后（可防抖）」与「退出前 flush」（macOS 上 Cmd+Q 经 `applicationWillTerminate` 亦到达该刷新点），MUST NOT 只依赖退出钩子。窗口尺寸 SHALL 是应用级单份状态（MUST NOT 按 vault 分区）。

#### Scenario: 二次启动恢复尺寸

- **WHEN** 调整窗口尺寸后正常退出，再启动
- **THEN** 窗口以存档尺寸出现（首帧即为该尺寸，无先占位后跳变）；窗口位置不作断言

#### Scenario: 窗口位置不入存档

- **WHEN** 拖动窗口到别处（含挪到另一台显示器）后正常退出，检查 `window-state.json`
- **THEN** 存档只含 `version` / `width` / `height`，不含任何位置字段（`x` / `y` 或等价键）

#### Scenario: 存档损坏回落首启规则

- **WHEN** 存档文件被截断、含非法字段，或 `version` 与实现不符
- **THEN** 窗口按首启规则（工作区 90%）出现，无错误提示，记一条 warning

#### Scenario: 存档尺寸超过当前工作区时被钳制

- **WHEN** 存档尺寸大于当前窗口所在显示器的工作区（换到更小的屏或分辨率降低后启动）
- **THEN** 窗口尺寸被逐维取小钳到工作区尺寸以内，无错误提示；窗口位置不作断言

#### Scenario: 不新增 config.json 键

- **WHEN** 检查配置目录与 `config.json`
- **THEN** 窗口尺寸只存在于 `window-state.json`，`config.json` 不出现任何窗口尺寸或位置键

### Requirement: 窗口底色跟随主题

原生窗口底色（macOS 上即 `NSWindow` background color）是 WKWebView **未绘制区域**的呈现色：冷启动首帧、后台化/遮挡后的揭示重绘间隙，webview 尚未（重新）合成内容时用户看到的就是它。它 SHALL 等于当前主题的 `--content-bg` 解析值——「窗口任何重绘间隙的呈现色 = 当前主题底色」是不变量：light `#fdfdfc` / dark `#222326` / eink `#ffffff`。网页侧 `body` 的 `background` SHALL 同样取 `var(--content-bg)`（双层兜底：窗口层遮原生白，页面层遮 webview 内未绘制区）。

主题切换 SHALL 经唯一施加点 `applyTheme`（`src/main.ts`）同步：施加 `data-theme` 后读 `getComputedStyle(body)` 解析值 invoke 后端命令更新窗口底色，**色值真源只有 CSS token 一处**（`src/style.css` 的三主题块），Rust 侧 MUST NOT 另存一份运行期色值表。启动路径的例外：webview JS 运行前窗口就要有色，`[ui] theme` → RGB 的映射允许以启动常量存在，但该常量 MUST 有机器断言钉死与 CSS token 逐值一致（cargo test 解析 `src/style.css` 比对）。同步失败 SHALL 只降级（console 线索），MUST NOT 阻断主题切换、MUST NOT 上屏报错。

#### Scenario: 三主题启动态窗口底色

- **WHEN** 分别以 `[ui] theme` = light / dark / eink 启动
- **THEN** `getComputedStyle(body).backgroundColor` 等于该主题 `--content-bg` 的解析值，且 Rust 侧收到同值的窗口底色设置

#### Scenario: 运行期切换主题后窗口底色跟随

- **WHEN** 启动后经 `view.theme-cycle`（⌘⇧T）或 modeline 主题钮切到另一档
- **THEN** `body` 计算底色与新主题 `--content-bg` 解析值逐值相等，且 Rust 侧收到新值的窗口底色设置
