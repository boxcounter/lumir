# ADR 0002: 技术路线

- 状态: proposed
- 日期: 2026-09-04
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Context

"极致快"与"AI-only 开发"存在路线冲突：

- GPUI（Zed 的 Rust UI 框架）性能天花板最高，但生态年轻、crates.io 发布滞后于 Zed 主仓、AI 训练语料少——在仅 AI 开发模式下，agent 写 GPUI 的质量会持续低于写 web 技术栈。
- Tauri（Rust core + 系统 webview）对 AI 开发最友好（TS/web 语料与测试基建最成熟），包体小（约 2.5MB vs Electron 约 85MB），但渲染层是浏览器引擎，存在结构性延迟上限，达不到 Zed 级渲染极限。
- Electron 与"极致快"冲突，直接排除。

裁决者决定（2026-09-04）：**"冷启动 <300ms + 输入无感延迟"即满足极致快**，不要求 Zed 级渲染极限。第一阶段最大的不确定性是"产品概念是否让作者每天想用"，而非性能极限。

## Decision

1. **Tauri**：Rust core + 系统 webview UI。
2. **编辑器单内核**：CodeMirror 6。md 模式 = 高亮 + live preview 装饰层；code 模式 = 仅高亮。一个组件、两种模式，不做两个编辑器。
3. **职责分层**：Rust core 承担文件 IO/监听、索引/搜索、link graph、ACP client、MCP server、CLI（同仓同二进制家族）；webview 层只做渲染与交互，保持薄。
4. **Agent 集成三件套，全部使用现成开放协议，一个都不自造**：
   - ACP client：编辑器作为宿主接入任意 ACP agent；
   - MCP server：反向暴露 app 状态（打开的文件、选区等）给外部 agent；
   - CLI：terminal 中的 agent 不启动 GUI 即可操作同一 workspace。
5. **配置即数据**：`~/.config/lumir`，带 schema 校验；非法值落回默认值并给出人话错误。明确拒绝"配置即代码"（Emacs 教训：配置是可执行代码就会腐烂）。
6. **性能合同**（写入 CI 门禁，回归即拒合）：
   - 冷启动 <300ms
   - keypress-to-paint <16ms（一帧）
   - 打开 1MB Markdown 文件 <100ms
   - 常驻内存 <200MB
7. **架构约束**：核心数据结构不深度耦合 UI 层，不堵死未来进程外 extension 隔离的可能性。

## Consequences

### 正面

- AI-only 开发的迭代速度最大化，最快到达 dogfood 状态。
- 协议零自造，agent 接入面随 ACP/MCP 生态免费扩大。
- 性能从形容词变为合同，"人不 review 代码"模式下由 CI 守住。

### 代价与风险

- webview 渲染天花板：做不到 Zed 级渲染极限。若未来确需，UI 层须重写——成本不可低估，不预设"可平滑迁移"。
- 性能合同的四个数字是首批未经实测的目标值，M0 需验证其可达性并允许一次性校准（校准需修订本 ADR）。

## Revisit 条件

- 性能门禁反复失败且瓶颈确证为 webview 渲染层 → 重评 GPUI 路线。
- 裁决者对"极致快"的定义升级（价值判断变化）→ 全线重估。
- M0 实测表明四个性能数字系统性不可达 → 一次性校准并修订本 ADR（仅允许这一次）。
