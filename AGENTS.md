# AGENTS.md — agent 入口

本文件是任何 AI agent 会话的仓库入口（人的入口是 [README.md](README.md)）。
原则：本文件只做**地图**和**无其他居所的规则**，不复制有 canonical 居所的内容——防漂移。
session 级进度在 `HANDOFF.md`（git 外）；新会话第一句：「读 HANDOFF.md，继续 Lumir 的工作。」

## 项目

Lumir：本地文本工作台，当前阶段定位为 Emacs keybinding PKM（[ADR 0006](docs/adr/0006-agent-positioning-deferred.md)）。Tauri（Rust core + 系统 webview）+ CodeMirror 6（ADR 0002）。开发模式 AI-only（[ADR 0004](docs/adr/0004-development-and-openness-strategy.md)）：agent 起草与实现一切制品，Alex 只做裁决，不看代码、不 review 代码。

## 文档地图

| 位置 | 内容 |
|---|---|
| [docs/adr/](docs/adr/) | 跨切面架构决策（为什么） |
| [openspec/](openspec/) | 功能规格：living specs + change proposals（做什么）；流程见 [openspec-workflow.md](docs/process/openspec-workflow.md) |
| [docs/specs/](docs/specs/) | 专项规格（性能测量方法学等） |
| [docs/process/](docs/process/) | 制品流程约定 |
| [docs/backlog.md](docs/backlog.md) | 已知 findings 与待裁决队列——**新 findings 落这里，不再积在 HANDOFF.md** |
| [REVIEW.md](REVIEW.md) | 反复踩过的坑与开工前检查清单（症状/根因/证据/防线）——**worker 动工前、reviewer 出 verdict 前必读** |
| [scripts/acceptance/](scripts/acceptance/) | 真机验收套件（用法与场景格式见其 [README](scripts/acceptance/README.md)） |
| [tests/visual/README.md](tests/visual/README.md) | 视觉门禁口径与基线更新纪律 |
| `HANDOFF.md`（git 外） | 当前 session 状态、桌面复验现场、配额 runbook 细节 |

关键约束（性能合同、不改写源文件铁律、非目标、配置即数据）以 [openspec/project.md](openspec/project.md) 为准，不在这里复制。

## 门禁（自验入口）

统一入口：[scripts/gate.sh](scripts/gate.sh)，输出机器可读（`GATE PASS|FAIL|SKIP` 逐行 + `GATE RESULT` 汇总），任一 FAIL 退出码 1。

```bash
scripts/gate.sh          # quick：fmt + clippy + cargo test + bindings 漂移 + tsc + openspec validate
scripts/gate.sh visual   # quick + 视觉回归（LUMIR_VISUAL_PORT 默认 4273 隔离）
scripts/gate.sh all      # visual + 性能合同（release 构建，首次分钟级）
```

与 CI 对应：`rust.yml` / `visual.yml` / `perf.yml` / `docs-check.yml`（PR 与 master push 强制）。本地全绿才允许提交合并请求；基线数字（测试数、场景数）以最近一次全绿输出为准，不背口头值。

视觉门禁**分层**（2026-09-18 Alex 裁决，依据 [tests/visual/README.md](tests/visual/README.md)）：
CI 的 `visual.yml` 只跑结构 / 计算属性断言（置 `LUMIR_VISUAL_STRUCTURAL=1`，22 处整页像素断言跳过），
整页 / 元素像素对比归本地 `scripts/gate.sh visual`。动过视觉相关代码（`src/style.css`、
`src/preview/**`、`tests/visual/scenes/**`）后必须本地跑一次，**CI 绿不代表像素层没回归**。

## 真机验收套件（agent 执行，不进 CI）

行为判定的下沉通道：`node scripts/acceptance/run.mjs`（用法、场景格式、证据布局、已知边界见
[scripts/acceptance/README.md](scripts/acceptance/README.md)）。与视觉门禁分工：`tests/visual`
守布局/配色/间距（chromium 近似；CI 只强制结构层，整页像素本地跑），本套件守
**真实 WKWebView 下的行为正确性**（本地 agent 执行）。

- **执行时机**：dogfood 批次每次合并后、Alex 验收前，由 agent 先跑一遍；Alex 只看 FAIL 项与手感项。
- **维护权**：新功能 mission 的 tasks 必须附带「新增/更新验收场景」一项（随实现同 PR），否则套件会腐烂。
- **手感/审美不下沉**：表头双击选中手感、表格宽度观感、WKWebView 翻屏节奏等仍归 Alex，套件只留截图证据。
- **证据不入 git**：`test-results/acceptance/`，与 perf-results 同惯例，Alex 抽审靠本地目录。
- **环境隔离**：套件自带 `XDG_CONFIG_HOME` 与合成验收 vault（`/tmp/lumir-m102-acceptance`），
  绝不读写用户的 `~/.config/lumir` 与真实 vault；dev 端口用 `LUMIR_ACCEPTANCE_PORT`（默认 1430）
  与 Alex 手头的 1420 隔离。

## 硬规则（无其他居所）

- **HANDOFF.md 永不入 git**（Alex 裁决 2026-09-10）。
- **tower 操作**：worker 必须在 mission 分支提交；TowerMerge 前清 `.review-worktree` 残留（`git worktree remove --force`）；TowerPlan 分支 slug 须与历史分支（含 abandoned）逐一核对；resume reviewer 时核对 assigned reviewer 是否正确；批次收尾顺带 `git push origin master` 保持两端同步。
- **视觉门禁卫生**（2026-09-16 起强制执行）：删除/移动 UI 元素后，核对该元素出现过的所有整页基线的时间戳是否随本次更新——容差收紧到 0.001 之前，「删左栏 UI」级变化曾静默假绿（批次二实证）。
- **基线更新是人肉裁决点**：视觉基线 `--update` 前截图须 Alex 过目，不要机械执行（[tests/visual/README.md](tests/visual/README.md)）。
- **真机复验**：`pnpm tauri dev` 起真实 app，用 KimiCU 操作（pid 用 `ps aux | grep target/debug/lumir` 找）；桌面验收 vault：`/tmp/lumir-m102-acceptance`；用户真实 vault `/Users/boxcounter/Downloads/Everything-copy` **只读**。**白屏陷阱**：`cargo test` 会把 `target/debug/lumir` 重编译为不带 `custom-protocol` 的 dev flavour，此后裸二进制起 app 会去加载 devUrl `http://127.0.0.1:1420` 而整窗白屏；起实例前须重新 `cargo build --features custom-protocol`（或直接用 `pnpm tauri dev`）。批次四 M134 实证，2026-09-16。
- **配额全瘫 runbook**：tower 主模型与 managed worker/reviewer 同一 Kimi 配额，耗尽即全瘫。恢复：改 `~/.kimi-code/config.toml` 顶层 `default_model = "deepseek/deepseek-flash"`（或 `kimi -m deepseek/deepseek-flash` 起新会话）→ resume 原会话 → tower 从 `.tower/comms/` + `HANDOFF.md` 恢复上下文。

## 工作流分工速查

- **开工前必读**：worker 动工前与 reviewer 给 verdict 前先过一遍 [REVIEW.md](REVIEW.md)，逐条对一眼自己的改动面；重复踩到表内某条时把新现场补进该条证据，不另起条目。
- 功能变更（新能力、行为修改）→ OpenSpec change（提案评审 → 实现 → 归档评审，两个 Alex 节点是硬门禁）。
- 跨切面架构决策 → ADR。
- 渲染/交互缺陷修复 → 合同先行（[rendering-defect-contract-first.md](docs/process/rendering-defect-contract-first.md)）：先定位不变量条款 + 属性测试，禁止只做案例级补丁。
- 拿不准归属：只影响一个 capability 走 OpenSpec；影响多个 capability 的结构关系或推翻技术选型走 ADR。
