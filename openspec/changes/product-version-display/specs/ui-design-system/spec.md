# Delta: ui-design-system（product-version-display）

## ADDED Requirements

### Requirement: 产品名与版本号常显

标题栏 SHALL 在右端常显产品标识块「产品名 · 版本号」（当前为「Lumir · 0.0.0」），
产品名与版本号 SHALL 取自应用元信息真源（tauri.conf.json 的 `productName` / `version`，
前端经 Tauri 内置 app 通道 `getName()` / `getVersion()` 读取），前端 MUST NOT 硬编码第二份
产品名 / 版本号副本。标识块 SHALL 在启动装配时读取一次并写入，运行期不刷新；读取失败
SHALL 使标识块整体隐藏并记一条诊断日志，MUST NOT 显示占位串或半截版本号。

标识块是纯展示信息位，MUST NOT 带点击语义或伪装成按钮。窗口变窄时挤压 SHALL 由标签区的
横向滚动全部吸收：标识块不参与收缩、不截断，常显优先级高于标签可视宽。标识块样式
SHALL 只取 token 层现行值（字号 / 字色 / 间距），MUST NOT 引入新色值或组件级主题覆盖；
三主题（light / dark / eink）下 SHALL 同构成立。

#### Scenario: 常显与真源一致

- **WHEN** 应用启动完成（有或无打开的文件）
- **THEN** 标题栏右端显示「产品名 · 版本号」，且版本号与 src-tauri/tauri.conf.json 的
  `version` 字段逐字节一致；空态（无标签）下标识块仍在右端

#### Scenario: 窄窗退让

- **WHEN** 窗口宽度收窄到标签区放不下全部标签（如约 520–600px）
- **THEN** 标签区横向滚动浏览全部标签，标识块完整可见、不收缩、不截断

#### Scenario: 读取失败降级

- **WHEN** 产品名 / 版本号的读取在启动时失败（ACL 未授权或非 Tauri 环境）
- **THEN** 标识块整体隐藏、记一条诊断日志；界面不出现任何占位版本号

#### Scenario: 拖拽区共存

- **WHEN** 在标识块上按下并拖拽
- **THEN** 窗口照常拖动（标题栏 drag region 行为不被标识块阻断）

## MODIFIED Requirements

### Requirement: 应用骨架布局

应用骨架 SHALL 为：标题栏 42px（全宽，左缘 traffic 灯区宽 236 与侧栏对齐，标签位于标题栏内，
**右端为产品标识块**——见「产品名与版本号常显」）/
主行（侧栏 236px + 正文栏 + **右栏 dock 预留位**）/ modeline 25px（全宽）。标题栏**右侧动作钮区**
本版为**预留槽位**：零可见内容（不渲染按钮），与 dock 预留列同一处置——动作钮特性的像素不在本版，
接入时只填这一槽（**排在产品标识块左侧**；已知偏差：tasks §4.3 的验收口径原文含「动作钮」，实现期
由 tower 裁决按本版不加，收官对账记这条）。dock 预留位 SHALL 只是结构上的列位（本版零像素、无内容、
无边框、不可交互）——agent 栏及其任何像素不在本版。正文阅读宽 SHALL 为 664px 居中。

旧 masthead SHALL 移除，其信息迁移：vault 名 → 侧栏头（切换器入口形态不变）；当前文件路径 →
modeline 左侧；当前位置指示 → modeline（toc 语义不变，只迁承载面）；行数 / 语法 / 编码 →
modeline 右侧（只读派生自既有编辑器状态，MUST NOT 为此引入全文档遍历或新状态源，ADR 0002 §6）。
macOS 标题栏 SHALL 为 overlay 形态（traffic 灯保持原生绘制，标题文字隐藏，栏区可拖拽）。

#### Scenario: 骨架几何与信息落位

- **WHEN** 打开任意 md 文件
- **THEN** 侧栏宽 236、标题栏高 42、modeline 高 25、正文列 664 居中、dock 列零像素；
  modeline 左侧显示当前文件的 vault 相对路径，右侧显示语法 / 行数 / 编码；masthead 不存在

#### Scenario: 空态的标题栏

- **WHEN** 没有打开任何文件
- **THEN** 标题栏为 traffic 灯区 + 右端产品标识块（标签区隐藏，本版无右侧动作钮——见
  「应用骨架布局」的预留槽位条款），modeline 与侧栏骨架不变
