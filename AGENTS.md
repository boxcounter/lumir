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

统一入口：[scripts/gate.sh](scripts/gate.sh)，输出机器可读（`GATE PASS|FAIL|SKIP` 逐行 + `GATE RESULT` 汇总），任一 FAIL 退出码 1。三档（`quick` / `visual` / `all`）的逐项内容与端口隔离参数以 `scripts/gate.sh` 头部注释为准（canonical 居所），此处不复刻。

与 CI 对应：`rust.yml` / `visual.yml` / `perf.yml` / `docs-check.yml`（PR 与 master push 强制）。本地全绿才允许提交合并请求；基线数字（测试数、场景数）以最近一次全绿输出为准，不背口头值。

`bindings-drift` 与提交纪律（M249）：改过 ts-rs 导出面的 change 会重导出 `src/bindings/**`，「先 `git add` / commit 这些重导出产物、再跑 `quick`」是**预期行为**——未进索引的漂移照旧报红并提示先 `git add`，已 `git add` 未 commit 只打一条 INFO，不再是一条假 FAIL（判据与来历见 `scripts/gate.sh` 头部注释）。

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
- **影响面升级线**（Alex 裁决 2026-09-28）：Alex 提的需求若对既有产品设定 / 逻辑 / 实现有重大影响乃至推倒重做，**先告知 Alex 并讨论，不得蛮干**。判定与举证责任在 tower / agent：规划期发现即升级；worker 实施期发现走 TowerSend 升级给 tower，由 tower 报 Alex。
- **tower 操作**：worker 必须在 mission 分支提交；TowerMerge 前清 `.review-worktree` 残留（`git worktree remove --force`）；TowerPlan 分支 slug 须与历史分支（含 abandoned）逐一核对；resume reviewer 时核对 assigned reviewer 是否正确；批次收尾顺带 `git push origin master` 保持两端同步。
- **已裁决事项不等开工口令**（Alex 裁决 2026-10-10）：提案 / 需求一经 Alex 裁决（含「按倾向」「通过」「好」式批准），实现与后续批次由 tower 直接立项开工，**不停下来等「开始」**。只有真正缺裁决时才停：未裁的裁决点、影响面升级线（见上条）命中的事项、基线过目等人肉裁决点。
- **worktree 即合即清**（Alex 裁决 2026-10-10，磁盘耗尽多次实证）：mission 合并后立即清掉对应 worktree（`git worktree remove`，残留仅 gitignore 产物如 node_modules/target 时加 `--force`），不攒到批次 teardown；TowerTeardown 只是批次收尾的兜底通道。磁盘占用自查：`du -sh .tower/worktrees/*`。
- **视觉门禁卫生**（2026-09-16 起强制执行）：删除/移动 UI 元素后，核对该元素出现过的所有整页基线的时间戳是否随本次更新——容差收紧到 0.001 之前，「删左栏 UI」级变化曾静默假绿（批次二实证）。
- **基线更新是人肉裁决点**：视觉基线 `--update` 前截图须 Alex 过目，不要机械执行（[tests/visual/README.md](tests/visual/README.md)）。
- **真机复验**：`pnpm tauri dev` 起真实 app，用 KimiCU 操作（pid 用 `ps aux | grep target/debug/lumir` 找）；桌面验收 vault：`/tmp/lumir-m102-acceptance`；用户真实 vault **只读**（真实路径按信息卫生纪律不落库，需要时由 tower 在会话内提供）。**白屏陷阱**：`cargo test` 会把 `target/debug/lumir` 重编译为不带 `custom-protocol` 的 dev flavour，此后裸二进制起 app 会去加载 devUrl `http://127.0.0.1:1420` 而整窗白屏；起实例前须重新 `cargo build --features custom-protocol`（或直接用 `pnpm tauri dev`）。批次四 M134 实证，2026-09-16。
- **配额全瘫 runbook**：tower 主模型与 managed worker/reviewer 同一 Kimi 配额，耗尽即全瘫。恢复：改 `~/.kimi-code/config.toml` 顶层 `default_model = "deepseek/deepseek-flash"`（或 `kimi -m deepseek/deepseek-flash` 起新会话）→ resume 原会话 → tower 从 `.tower/comms/` + `HANDOFF.md` 恢复上下文。
- **仓库信息卫生**（Alex 裁决 2026-10-05）：任何入库制品——原型 HTML、测试/视觉 fixture、视觉基线与原型截图、文档——MUST NOT 包含真实 vault 内容（真实人名、真实项目/目录/文件名、真实文档正文），一律用合成 fixture；含截图类二进制（内容以像素形式存在，只能靠重截清除）。纪律文本本身也不得引用真实字符串——检索针只活在当次会话，不落 git。提交前对改动面做一次 text 级 grep 清扫。
- **原型控制面板**（Alex 裁决 2026-10-05）：交互原型 MUST 在页面内置可点击的控制面板（切屏 / 切主题等全部选项点击可达），不得要求人手改 URL query；query 参数（如 `?screen=` / `?theme=`）保留作深链，截图脚本用显式参数（如 `&panel=0`）关面板。
- **给 Alex 的路径必须当下可开**（2026-10-09 实证）：凡让 Alex 审阅/查看的文件，给出的路径必须在主仓 checkout 里**当下真实存在**——未合并分支 / worktree 里的文件，先复制到 `test-results/` 下（git 外），再给绝对路径 + 一条可整段运行的 `open` 命令；禁止直接给 `docs/...` 这类「分支合并后才存在」的仓内相对路径。与用户级 AGENTS.md「给我的材料零前置知识」同源，仓内钉给 tower 与所有 worker。

## 子代理模型调度（Alex 裁决 2026-10-02）

动机：Kimi coding plan 配额紧，执行层尽量压到不占配额的模型；安全网是机器验收（gate/测试/验收套件）+ 强 review。分流标准**不是任务难度，而是「失败能否被机器立刻抓住」**。

| 任务类型 | 模型 alias |
|---|---|
| 有机器验收的开发（做完须过 gate/测试/验收场景判定） | `deepseek/deepseek-flash` |
| 文案/文档/数值类、机械批量活 | `deepseek/deepseek-flash` |
| 代码库探索、定位类查询（explore） | `deepseek/deepseek-flash` |
| 无机器验收的判断类开发（交互手感、新功能设计、结构调整） | `Kimi For Coding/kimi-for-coding` |
| 复杂任务、review、视觉像素表现本身的改动（`src/style.css`、`src/preview/**` 渲染逻辑——成败只能靠基线/人眼判定） | `Kimi For Coding/k3-256k` |
| k3 1M | **禁用** |

执行规则：

- **显式指定 alias，不依赖默认值**——默认值变了行为会静默漂移。
- **prompt 写窄**：已知文件路径/行号/测试命令直接写进派发 prompt，砍掉子代理的探索消耗（三个模型都受益）。
- **优先 resume，少开新实例**；失败升级时 resume 原 agent 换更强模型继续，不同模型重开（重读代码浪费配额），也不同模型原地重试（重复同样失败）。
- **review 恒为 k3-256k**，但输入收窄：只看 diff + REVIEW.md 相关条目，不做全量代码理解。
- 拿不准「有无机器验收」时**按没有处理**（升档到 kimi-for-coding），不要为省配额降档。
- **视觉场景（tests/visual/scenes/**）的断言值/文案改准属有机器验收**（结构断言 + gate 兜底），归 deepseek——「视觉相关升 k3」只指像素表现本身的改动（2026-10-10 Alex 指正 M434 误派后沉淀）。

**2026-10-10 补充裁决（配额紧张期的三条细化）**：

- **「UI 批次」不再自动升档**：设计已被 Alex 裁决（spec/design 有原文口径）、实现属照章落地、且有验收场景 + 视觉门禁兜底的 UI mission（如权限前端批）归 `deepseek/deepseek-flash`；升档触发条件仍是「无机器验收的判断类」。
- **在途 worker 不中途换模型**：换模型须重开实例、重读代码，总消耗反而更高；下次派发再按新口径。
- **探针/探错类步骤单独升档**：结果未知、不符假设时需设计退路的任务（如真机通道探针），该步骤升 kimi-for-coding；探针通过后的照章实现段仍归 deepseek。

**2026-10-10 补充裁决二（视觉三分 + 评审分层 + 对账下放，Alex「认可」）**：

- **视觉任务按验收预言机三分**（取代「视觉相关」整行升档的旧口径）：① 样式值机械改动（间距/字号/色 token 替换，期望值可写成计算属性或像素断言）、视觉场景断言/文案/fixture 调整、基线重截的执行动作 → deepseek；② 原型 HTML（`design/prototypes/**`）→ deepseek（playwright 冒烟断言 + Alex 过目截图兜底）；③ 像素表现本身的改动（`src/style.css` 全局面、`src/preview/**` 渲染语义）与一切「看着对不对」是唯一判据的活 → k3-256k。**断言先行**：凡派给 deepseek 的视觉改动，派发时要求先把期望效果写成机器断言再动手——rendering-defect-contract-first 从缺陷修复延伸到视觉改动；基线 `--update` 前 Alex 过目、视觉 review 恒 k3 两条不变。
- **评审分层**：deepseek 先做机械核验层（diff 对账 tasks、门禁输出比对、scope 越界检查、复跑机器判定命令），产出结构化核验报告；k3 只做判断层——机械层报出差异、或 mission 本身是判断类时才介入。验收 oracle 本来就是全机器判定的 mission（如纯文档修订配 `openspec validate --strict`）可试行「deepseek 审 + k3 抽审」；**代码类 mission 的评审不降档**——评审是 deepseek worker 的安全网，降级评审等于同时拆两道网。
- **对账与证据复跑下放**：worker 完工后「逐项对账 mission tasks」这步机械比对派 deepseek 实例做，只把对账结果与差异项送回 tower 裁决；gate/验收套件复跑、基线重截、截图归档等「跑命令 + 如实抄输出」的活同样归 deepseek（失败判据=退出码）。tower 自身模型不降：路由错误代价高于配额节省。

## 工作流分工速查

- **开工前必读**：worker 动工前与 reviewer 给 verdict 前先过一遍 [REVIEW.md](REVIEW.md)，逐条对一眼自己的改动面；重复踩到表内某条时把新现场补进该条证据，不另起条目。
- 功能变更（新能力、行为修改）→ OpenSpec change（提案评审 → 实现 → 归档评审，两个 Alex 节点是硬门禁）。
- 跨切面架构决策 → ADR。
- 渲染/交互缺陷修复 → 合同先行（[rendering-defect-contract-first.md](docs/process/rendering-defect-contract-first.md)）：先定位不变量条款 + 属性测试，禁止只做案例级补丁。
- 拿不准归属：只影响一个 capability 走 OpenSpec；影响多个 capability 的结构关系或推翻技术选型走 ADR。
