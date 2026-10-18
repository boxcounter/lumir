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
| [docs/backlog.md](docs/backlog.md) | 暂不修 / 待裁决的 findings 队列——新 findings 首选提议安排处理（见硬规则），这里只收暂不修的；不再积在 HANDOFF.md |
| [REVIEW.md](REVIEW.md) | 反复踩过的坑与开工前检查清单（症状/根因/证据/防线）——**worker 动工前、reviewer 出 verdict 前必读** |
| `.local/`（git 外） | 本地证据与材料根：按使用场景分层（`acceptance` / `missions` / `probes` / `reviews` / `releases` / `design` / `reports`）；新证据落哪个桶的判据与 `test-results/` 旧路径对照见 `.local/README.md` |
| [scripts/acceptance/](scripts/acceptance/) | 真机验收套件（用法与场景格式见其 [README](scripts/acceptance/README.md)） |
| [tests/visual/README.md](tests/visual/README.md) | 视觉门禁口径与基线更新纪律 |
| `HANDOFF.md`（git 外） | 当前 session 状态、桌面复验现场、配额 runbook 细节 |

关键约束（性能合同、不改写源文件铁律、非目标、配置即数据）以 [openspec/project.md](openspec/project.md) 为准，不在这里复制。

## 门禁（自验入口）

统一入口：[scripts/gate.sh](scripts/gate.sh)，输出机器可读（`GATE PASS|FAIL|SKIP` 逐行 + `GATE RESULT` 汇总），任一 FAIL 退出码 1。三档（`quick` / `visual` / `all`）的逐项内容与端口隔离参数以 `scripts/gate.sh` 头部注释为准（canonical 居所），此处不复刻。

与 CI 对应：`rust.yml` / `visual.yml` / `perf.yml` / `docs-check.yml`（PR 与 master push 强制）。本地全绿才允许提交合并请求；基线数字（测试数、场景数）以最近一次全绿输出为准，不背口头值。

**门禁结果的报告口径**：照抄 `GATE RESULT` 原文行并附退出码，不用「X/Y PASS」式复述——分母含不含 SKIP 只在 `scripts/gate.sh` 里定义，复述会丢掉这个口径（SKIP 必须单列，不得并进 PASS 数）。

`bindings-drift` 与提交纪律：改过 ts-rs 导出面的 change 会重导出 `src/bindings/**`，「先 `git add` / commit 这些重导出产物、再跑 `quick`」是**预期行为**——未进索引的漂移照旧报红并提示先 `git add`，已 `git add` 未 commit 只打一条 INFO，不再是一条假 FAIL（判据与来历见 `scripts/gate.sh` 头部注释）。

视觉门禁**分层**（依据 [tests/visual/README.md](tests/visual/README.md)）：
CI 的 `visual.yml` 跑结构 / 计算属性断言（置 `LUMIR_VISUAL_STRUCTURAL=1`，整页 / 元素像素断言跳过）
外加前端单测（`pnpm test`）与套件隔离断言、`tests/visual` 的 tsc，
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
- **证据不入 git**：`.local/acceptance/`，与 perf 读数 `.local/perf/` 同惯例，Alex 抽审靠本地目录。
- **环境隔离**：套件自带 `XDG_CONFIG_HOME` 与合成验收 vault（`/tmp/lumir-m102-acceptance`），
  绝不读写用户的 `~/.config/lumir` 与真实 vault；dev 端口用 `LUMIR_ACCEPTANCE_PORT`（默认 1430）
  与 Alex 手头的 1420 隔离。

## 硬规则（无其他居所）

本节条目均经 Alex 裁决或在 Alex 监督下沉淀：修订、删除、降级均须 Alex 过目；诞生时间与出处靠 git 历史与 REVIEW.md 追溯，不在正文标注。**出口判据**：某条的防线被门禁脚本 / 工具完全机器化（不靠人读也能拦住）后，该条降级为指针并入相关流程文档，不再单列——降级同样须 Alex 过目。

### 纪律（长期有效的裁决级约束）

- **HANDOFF.md 永不入 git**。
- **findings 首选提议安排处理，不落 backlog**：发现新 finding 时，首选应对是向 Alex 提议安排处理（立项修掉），而不是默认落 backlog 排队——避免积累不必要的技术债务，有债务尽早偿还。backlog 只收「Alex 裁决暂不修 / 需等人肉节点 / 确实无法立即安排」的项。
- **影响面升级线**：Alex 提的需求若对既有产品设定 / 逻辑 / 实现有重大影响乃至推倒重做，**先告知 Alex 并讨论，不得蛮干**。判定与举证责任在 tower / agent：规划期发现即升级；worker 实施期发现走 TowerSend 升级给 tower，由 tower 报 Alex。
- **已裁决事项不等开工口令**：提案 / 需求一经 Alex 裁决（含「按倾向」「通过」「好」式批准），实现与后续批次由 tower 直接立项开工，**不停下来等「开始」**。只有真正缺裁决时才停：未裁的裁决点、影响面升级线（见上条）命中的事项、基线过目等人肉裁决点。
- **基线更新是人肉裁决点**：视觉基线 `--update` 前截图须 Alex 过目，不要机械执行（[tests/visual/README.md](tests/visual/README.md)）。
- **仓库信息卫生**：任何入库制品——原型 HTML、测试/视觉 fixture、视觉基线与原型截图、文档——MUST NOT 包含真实 vault 内容（真实人名、真实项目/目录/文件名、真实文档正文），一律用合成 fixture；含截图类二进制（内容以像素形式存在，只能靠重截清除）。纪律文本本身也不得引用真实字符串——检索针只活在当次会话，不落 git。提交前对改动面做一次 text 级 grep 清扫。动过原型 HTML 必须同步重截对应截图——HTML 清了而截图没重截等于没清。
- **原型控制面板**：交互原型 MUST 在页面内置可点击的控制面板（切屏 / 切主题等全部选项点击可达），不得要求人手改 URL query；query 参数（如 `?screen=` / `?theme=`）保留作深链，截图脚本用显式参数（如 `&panel=0`）关面板。
- **给 Alex 的路径必须当下可开**：凡让 Alex 审阅/查看的文件，给出的路径必须在主仓 checkout 里**当下真实存在**——未合并分支 / worktree 里的文件，先复制到 `.local/reviews/` 下（git 外），再给绝对路径 + 一条可整段运行的 `open` 命令；禁止直接给 `docs/...` 这类「分支合并后才存在」的仓内相对路径。与用户级 AGENTS.md「给我的材料零前置知识」同源，仓内钉给 tower 与所有 worker。
- **变更默认直接切断**：见到「兼容」「迁移」「过渡」「双写」「保留旧路径」这类方案字样，先回答「消费者是谁」——零读者 / 单用户场景一律直接切断（不双写、不留过渡期；存量制品按孤儿先例「不再续写、不做迁移」处理，并在代码注释就地写明），需要迁移就一次迁干净。只有能指名具体消费者（外部用户、已发布契约、不可逆数据）才允许兼容层，且必须在提案里写出该消费者作为举证——写不出来就等于没有。

### 操作流程（机器 / 工具 / 协作通道的使用）

- **tower 操作**：worker 必须在 mission 分支提交；TowerMerge 前清 `.review-worktree` 残留（`git worktree remove --force`）；TowerPlan 分支 slug 须与历史分支（含 abandoned）逐一核对；resume reviewer 时核对 assigned reviewer 是否正确；批次收尾顺带 `git push origin master` 保持两端同步。
- **worktree 即合即清**：mission 合并后立即清掉对应 worktree（`git worktree remove`，残留仅 gitignore 产物如 node_modules/target 时加 `--force`），不攒到批次 teardown；TowerTeardown 只是批次收尾的兜底通道。磁盘占用自查：`du -sh .tower/worktrees/*`。
- **视觉门禁卫生**：删除/移动 UI 元素后，核对该元素出现过的所有整页基线的时间戳是否随本次更新——容差收紧到 0.001 之前，「删左栏 UI」级变化曾静默假绿。
- **真机复验**：`pnpm tauri dev` 起真实 app，用 KimiCU 操作（pid 用 `ps aux | grep target/debug/lumir` 找）；桌面验收 vault：`/tmp/lumir-m102-acceptance`；用户真实 vault **只读**（真实路径按信息卫生纪律不落库，需要时由 tower 在会话内提供）。**白屏陷阱**：`cargo test` 会把 `target/debug/lumir` 重编译为不带 `custom-protocol` 的 dev flavour，此后裸二进制起 app 会去加载 devUrl `http://127.0.0.1:1420` 而整窗白屏；起实例前须重新 `cargo build --features custom-protocol`（或直接用 `pnpm tauri dev`）。
- **机器窗口申报口径**：向 Alex 申请/报告真机时段时，报的是**整个任务队列的总窗口**（含已知后续任务的构建与验证耗时），不是单项任务的耗时；执行中长出新真机任务**不停工、继续用**，但要重新向 Alex 申报新的总时长（申报是义务，停工不是——超窗继续使用是对的，只要知会）。
- **配额全瘫 runbook**：tower 主模型与 managed worker/reviewer 同一 Kimi 配额，耗尽即全瘫。恢复：改 `~/.kimi-code/config.toml` 顶层 `default_model = "deepseek/deepseek-flash"`（或 `kimi -m deepseek/deepseek-flash` 起新会话）→ resume 原会话 → tower 从 `.tower/comms/` + `HANDOFF.md` 恢复上下文。
- **worker 等待纪律**：等自己的后台任务一律用 `WaitFor`（挂起零 LLM 请求、完成即唤醒）或结束 turn（回复经 resume 送达）；禁止前台分钟级 `sleep` 盲等轮询。只有无事件源的外部状态（锁文件、磁盘水位）允许 ≤60s 短采样，且采样须带诊断负载。tower 每次 spawn/resume worker 时在 instructions 里显式写入本条，不靠 worker 自觉。

## 子代理模型调度

动机：Kimi 配额紧，执行层尽量压到不占配额的模型；安全网是机器验收（gate / 测试 / 验收套件）+ 强 review。分流标准**不是任务难度，而是「失败能否被机器立刻抓住」**；拿不准「有无机器验收」时按没有处理（升档）。

| 任务类型 | 模型 alias |
|---|---|
| 有机器验收的开发（做完须过 gate / 测试 / 验收场景判定）；文案 / 文档 / 数值类、机械批量活；代码库探索定位（explore） | `deepseek/deepseek-flash` |
| 视觉机械改动：样式值替换、视觉场景断言 / 文案 / fixture 调整、基线重截执行、原型 HTML——派发前先要求把期望效果写成机器断言（断言先行） | `deepseek/deepseek-flash` |
| 机械核验与证据复跑：mission tasks 对账、门禁输出比对、scope 越界检查、gate / 验收套件复跑、截图归档 | `deepseek/deepseek-flash` |
| 无机器验收的判断类开发（交互手感、新功能设计、结构调整）；探针 / 探错类步骤（结果未知、需设计退路，探针通过后的照章实现段仍归 deepseek） | `deepseek/deepseek-flash` |
| 复杂任务、review 判断层、像素表现本身的改动（`src/style.css` 全局面、`src/preview/**` 渲染语义）——「看着对不对」是唯一判据的活 | `Kimi For Coding/k3-256k` |
| k3 1M | **禁用** |

执行规则：

- **显式指定 alias**，不依赖默认值；**prompt 写窄**：已知路径 / 行号 / 测试命令直接写进派发 prompt，砍掉子代理的探索消耗。
- **优先 resume**，少开新实例；失败升级时 resume 原 agent 换更强模型继续，不重开实例、不同模型原地重试；在途 worker 不中途换模型（重开要重读代码，总消耗更高）。
- **「UI 批次」不自动升档**：设计已裁决、照章落地、有验收场景 + 视觉门禁兜底的 UI mission 归 deepseek；升档触发条件仍是「无机器验收的判断类」。
- **评审分层**：deepseek 先做机械核验层并产出结构化核验报告，k3 只做判断层；代码类 mission 的评审判断层不降档——评审是 deepseek worker 的安全网；验收 oracle 全机器判定的 mission（如纯文档修订）可试行「deepseek 审 + k3 抽审」。
- tower 自身模型不降：路由错误代价高于配额节省。

## 工作流分工速查

- **开工前必读**：worker 动工前与 reviewer 给 verdict 前先过一遍 [REVIEW.md](REVIEW.md)，逐条对一眼自己的改动面；重复踩到表内某条时把新现场补进该条证据，不另起条目。
- 功能变更（新能力、行为修改）→ OpenSpec change（提案评审 → 实现 → 归档评审）。节点 1（提案评审）是 Alex 硬门禁；节点 2（归档评审）在 delta 相对 living spec 无新增内容的纯目录移动情形下由机器判据替代人肉评审，判据口径以 [openspec-workflow.md](docs/process/openspec-workflow.md) 为 canonical，此处不复刻。
- 跨切面架构决策 → ADR。
- 渲染/交互缺陷修复 → 合同先行（[rendering-defect-contract-first.md](docs/process/rendering-defect-contract-first.md)）：先定位不变量条款 + 属性测试，禁止只做案例级补丁。
- 拿不准归属：只影响一个 capability 走 OpenSpec；影响多个 capability 的结构关系或推翻技术选型走 ADR。
