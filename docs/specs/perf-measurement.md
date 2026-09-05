# Spec: 性能测量方法学（perf-measurement）

- 状态: accepted（随 OpenSpec 首个全循环归档生效；change-id `add-perf-measurement-methodology`，capability `perf-measurement`）
- 日期: 2026-09-05
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 上游依据: ADR 0002 第 6 条（性能合同四个数字，测量方法学委托 M0 定义）、ADR 0004 第 1 条（M0 出口：四项指标全部在 CI 被测量并产出数值）与第 4 条（本 spec 为 OpenSpec 首个全循环验证对象）、评审 finding `.tower/comms/findings/20260904-reviewer-executability-bug-ci.md`（四数字测量缺口清单）

## 总约定

### 门禁口径与校准条款

- ADR 0002 第 6 条只锁定数字与阈值：冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB。本 spec 定义这四个数字的**测量端点、工具链、采样口径、fixture 规格**。
- **空壳 app 阶段（M0）的绝对值不代表达标**：keypress-to-paint 以 headless 注入近似测量，是下界；打开 1MB 文件以占位 fixture 计时。M0 末的一次性校准已于 2026-09-05 使用（修订 ADR 0002，仅此一次，额度已用尽），校准结论见下条。
- **CI 门禁分两种模式**（校准结论，ADR 0002 第 6 条）：
  - **相对回归**（冷启动、keypress-to-paint）：CI runner 对这两项重指标的实测噪声达 3-4 倍（两次全量实测冷启动 p95 284ms vs 809ms、keypress-to-paint p95 70ms vs 255ms），绝对阈值在 CI 上不可执行。CI 门禁用滚动基线相对回归（口径见「相对回归门禁」一节）；绝对合同值（<300ms、<16ms）保留，在标准化环境（裁决者本机）按 ADR 0002 第 6 条既有口径裁决。
  - **绝对阈值**（打开 1MB 文件 <100ms、常驻内存 <200MB）：两项轻指标 CI 两次实测几乎一致（约 2.6ms、约 110MB），噪声未淹没信号，保持 CI 绝对阈值门禁，超阈即拒合。
- **门禁已启用拒合**：`tests/perf/thresholds.json` 的 `enforce` 为 `true`；超阈（绝对模式）或回退超 40%（相对模式，2026-09-05 口径修正前为 20%，见「相对回归门禁」一节）即 CI 红。enforce 后任一指标的本次结果文件缺失或不可读同样拒合（exit 1，缺数据即红，不得静默跳过）。
- 判定口径（门禁比较值的统计量，按模式区分）：
  - **绝对模式**（打开 1MB 文件）：该次运行的 **p95**；常驻内存取 max（见 §4）。
  - **相对回归模式**（冷启动、keypress-to-paint）：该次运行的 **median**（2026-09-05 口径修正，修正前为 p95；证据与声明见「相对回归门禁」一节）。
  - 其余统计量随 artifact 全量上报，用于观察分布。ADR 0002 合同值在标准化环境（裁决者本机）的裁决口径不受此修正影响。

### 运行环境

- CI runner：`macos-15`（Apple Silicon，arm64）。四个数字仅在此环境定义；本地或其他机型的读数不可直接对阈值。
- 前端构建：release 口径（`pnpm build` 产物 + `cargo build --release`）。
- Node：>= 22.4（脚本使用内置全局 `WebSocket`，无新增 npm 依赖）。

### 采样统计口径

- 每项指标产出 `perf-results/<metric>.json`，schema：
  `{"metric": string, "unit": "ms"|"MB", "contract": number, "samples": number[], "median": number, "p95": number, "max": number, "min": number, "mean": number, "meta": object}`。
  `samples` 保留全部原始样本，供校准期复核分布形状；统计量由 `scripts/perf/lib/stats.mjs` 统一计算，各脚本不得自造。
- p95 采用 nearest-rank 法：`sort(samples)[ceil(0.95 * N) - 1]`。

### 相对回归门禁（冷启动、keypress-to-paint）

- **基线来源**：仅 master 分支 push 触发的 perf workflow 在全部测量成功后，把当次相对模式指标的门禁值追加进滚动基线文件 `perf-results/baseline/baseline.json`，经 `actions/cache` 持久化（cache key `perf-baseline-<run_id>`，`restore-keys: perf-baseline-` 前缀匹配取最近一次）。PR 与 workflow_dispatch 只读基线、不写。
- **比较方法**（2026-09-05 统计口径修正）：对相对模式指标，本次门禁值取当次运行的 **median**；基线值取基线文件该指标**最近 10 次**（滚动窗口）master 门禁值的 **median**——历史条目存的本身就是各次 master 运行的 median，基线值即 median of medians。回退幅度 = `(value - baseline) / baseline`，**> 40% 即拒合**。median + 滚动窗口是为抗 runner 整轮漂移与右尾噪声：3-4 倍噪声表现为整轮漂移和 p95 尾部爆量，median 对两者都稳健；窗口 median 跟随 runner 真实水平漂移，只拒合"显著差于近期常态"的运行。
- **口径修正证据链（M37 调查，17 次 CI run 回放）**：修正前口径为"当次 p95 vs 基线窗口 p95 的 median、容忍 20%"，是结构性误报源——①基线窗口内 4 次绿 run 的 cold-start p95 自身散布 152.4–218.0ms（43%），已超 20% 容忍线；②两次代码逐字节相同（ea9e9e9 与 eac37a0 空 diff）的背靠背 run，cold-start p95 284.4 vs 808.9ms（2.8x 纯 runner 方差）；③连续两次红 run（33955998214、33957248396）的 cold-start median（180.9/195.0ms）≤ 基线 median 199.4ms，仅 p95 尾部越线；④keypress-to-paint 在 9 次 run 中 8 次红，同病因（p95 尾部噪声 vs median 基线混用）；⑤17 次 run 的 runner 镜像完全相同（macos-15-arm64 20260828.587），排除镜像漂移。本机双点同口径测量（M3 Pro，各 30 样本）确认基线绿代码到 master 之间零代码回归（Δmedian +1.7ms）。median 口径 + 40% 容忍线覆盖观测到的 runner 噪声幅度，同时仍能捕获真实回退（构造的 +100% 劣化在回放中仍被拒合）。
- **性质声明：本条是门禁实现的统计口径修正，不是 ADR 0002 的合同校准**——合同数字（冷启动 <300ms、keypress-to-paint <16ms）不动，2026-09-05 一次性校准额度已用尽的状态不变，合同值在标准化环境的裁决口径不变；变更的仅是 CI 相对回归门禁用哪个统计量与多大容忍线判断"回退"。
- **基线更新规则**：只进不出地追加、按窗口裁剪到最近 10 次；仅 master push 且测量全绿时更新——红了的 run 不污染基线。cache 因 GitHub 7 天未访问清理而丢失时，由下一次 master 成功 run 重建。**统计口径迁移**：基线条目的 `gate` 字段记录历史值的统计口径；与当前门禁 gate 不一致时（如 2026-09-05 修正前遗留的 p95 口径 cache），`check-thresholds.mjs` 跳过相对比较（warning，不拒合），`update-baseline.mjs` 在下一次 master 成功 run 丢弃旧口径历史、以新口径重建——旧条目存的是另一种统计量，混用会让窗口 median 系统性偏离（p95 历史配 median 当前值必出假阴性，反之必出假阳性）。
- **基线缺失处理**：基线文件不存在或该指标无历史（首次运行、cache 丢失重建期）→ `::warning::` 并跳过该项的相对比较，**不拒合**（否则永远无法建立/重建基线）。注意区分：本次**测量结果**缺失（`perf-results/<metric>.json` 不存在或不可读）在 enforce 下是 exit 1 拒合；基线缺失只是无法比较。
- **基线文件 schema**：`{"metrics": {"<metric>": {"unit": string, "gate": "p95"|"median"|"max", "history": [{"run_id": number, "ts": string, "value": number}, ...]}}}`，`history` 按时间升序、长度 ≤ 窗口；`gate` 必须与 thresholds.json 该指标当前 gate 一致（不一致的处理见「基线更新规则」的口径迁移），`value` 为该次运行的 gate 统计量（相对回归模式即 median）。
- **存储选型 trade-off**：候选二选其一是仓库内 baseline 文件（随 master 提交）。放弃理由：需要 bot identity 提交回 master，引入写权限与并发冲突复杂度，且每次 perf run 污染 git 历史；`actions/cache` 天然跨 run 共享、branch 可读默认分支 cache、无需写权限，代价是 7 天未访问会被清理（可接受，重建成本为一次 master run）与不做强一致并发控制（master 串行 push 下无实际问题）。

### 目录与制品

| 路径 | 内容 |
|---|---|
| `scripts/perf/cold-start.mjs` | 冷启动测量 |
| `scripts/perf/keypress-to-paint.mjs` | keypress-to-paint 测量（headless 注入近似） |
| `scripts/perf/open-file.mjs` | 打开 1MB 文件测量（占位口径） |
| `scripts/perf/memory.mjs` | 常驻内存测量 |
| `scripts/perf/check-thresholds.mjs` | 阈值比较（绝对模式 + 相对回归模式） |
| `scripts/perf/lib/stats.mjs` | 统计与结果落盘 |
| `scripts/perf/update-baseline.mjs` | 滚动基线追加与裁剪（仅 master push 调用） |
| `tests/perf/fixtures/markdown-1mb.md` | 1MB Markdown fixture（提交入库） |
| `tests/perf/fixtures/gen-fixture.mjs` | fixture 确定性再生成器 |
| `tests/perf/thresholds.json` | 阈值、门禁模式与 enforce 开关 |
| `perf-results/`（CI artifact） | 四项指标 JSON + 原始样本 |
| `perf-results/baseline/baseline.json`（CI cache） | 滚动基线（相对回归模式用，不入库） |

## 1. 冷启动 <300ms

### 端点定义

- **主口径（门禁用）**：harness wall time——从 harness `spawn` app 二进制之前打点时间戳，到 stdout 出现 `LUMIR_READY ` 前缀行的时间戳。
- **辅口径（归因用）**：app 自报的 `elapsed_ms`（`src-tauri/src/ready.rs`：从 `run()` 入口到 Tauri setup 完成，即 webview 创建后、事件循环接管前）。两者之差 ≈ exec/动态链接/harness 调度开销，校准期用于判断瓶颈在进程装载还是 Tauri 初始化。
- ready 信号契约见 `src-tauri/src/ready.rs` 文档注释：`LUMIR_READY {"event":"ready","elapsed_ms":<f64>,"pid":<u32>,"ts_unix_ms":<u64>}`，同时写 `$TMPDIR/lumir-ready-<pid>`。harness 匹配 stdout 行首 `LUMIR_READY ` 前缀。
- 明确排除：前端首屏挂载（webview 侧 `performance.now()` 打点，见 `src/main.ts`）暂不入端点——headless CI 无法可靠读 webview console。首屏挂载纳入端点是校准期的候选修订项。

### 工具链

- `scripts/perf/cold-start.mjs`：spawn `src-tauri/target/release/lumir`，逐行读 stdout，命中 ready 行后记录两端时间戳并 kill 进程。单次运行 15s 未出现 ready 行记为失败样本并中止该轮。

### 采样口径

- **1 次 warm-up 轮（丢弃）+ N=20 次正式样本**，每次均为全新进程，连续执行。warm-up 的理由：首轮启动含 dyld 绑定、TCC 授权弹窗检查等一次性开销，是系统性离群值（实测首轮可达后续轮的 5 倍）；丢弃后正式样本反映"热缓存冷启动"——不清 OS page cache，与真实用户首次启动仍有系统性正偏差，校准时按分布解读。
- N=20 与总约定 nearest-rank p95 的配合：`ceil(0.95×20)-1 = 19`，即 p95 截去最高的 1 个样本——抗单次抖动但不掩盖分布右尾。N 若降至 10，p95 退化为 max（`ceil(9.5)-1 = 9`），任何一轮离群值都会成为 p95 读数；p95 仍是合同裁决与分布观察口径，故 N 不得小于 20 的硬约束不变（CI 门禁比较值已改为 median，不受影响）。
- 上报全部 20 个正式样本；CI 相对回归门禁取 **median**（口径见总约定「相对回归门禁」；2026-09-05 修正前为 p95，p95 只截 1 个最高样本、在 runner 右尾噪声下必然抖动）。绝对合同值 <300ms 在标准化环境（裁决者本机）按 ADR 0002 第 6 条裁决。

### Fixture

- 无。空壳 app 打开固定窗口与内置示例文档。

## 2. keypress-to-paint <16ms（headless 注入近似，下界）

### 端点定义

- **定义**：从页面内 `keydown` 事件派发时刻（`performance.now()`，capture 阶段记录），到其后**第二帧**渲染完成的时刻（双重 `requestAnimationFrame` 回调内再打点）。取差值为一次样本。
- **注入方式**：CDP `Input.dispatchKeyEvent`（`rawKeyDown`，key=`a`）驱动 headless Chrome 加载 release 前端产物（`dist/`，由 harness 内嵌静态服务器提供）。
- **下界声明（必须随读数一起引用）**：
  1. 不含 OS 输入管道（IOHID → WindowServer → app 事件队列）与合成器/vsync 开销——真实按键路径在 macOS 上另有数毫秒到一帧的延迟；
  2. CI 用 Chrome/Blink 测量，产品运行时是 WKWebView/WebKit，引擎差异不归零；
  3. M0 空壳编辑器为只读，按键不触发文档更新路径，测得的是"事件 → 帧调度"的结构下界；M1 编辑器可写后本端点不变，读数自然覆盖文档更新开销。
- 以上即评审 finding 第 2 条要求的"CDP 注入近似并注明是下界"。

### 工具链

- `scripts/perf/keypress-to-paint.mjs`：启动 Chrome（`--headless=new --remote-debugging-port=0`，二进制路径取 `$CHROME_PATH`，默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`），经 DevToolsActivePort 文件发现 CDP 端口，用 Node 内置 `WebSocket` 直连 CDP；`Runtime.evaluate` 注入采样 hook，`Input.dispatchKeyEvent` 派发按键，取回 `window.__ktp` 样本数组。

### 采样口径

- N=50 次按键，间隔 100ms（避免事件合并与帧堆积）。上报全部样本；CI 相对回归门禁取 **median**（口径见总约定「相对回归门禁」；2026-09-05 修正前为 p95——p95 在绿 run 间即有 3 倍以上散布，是 9 次 run 8 次红的结构性误报源）。绝对合同值 <16ms 在标准化环境（裁决者本机）按 ADR 0002 第 6 条裁决。

### Fixture

- 无独立 fixture；负载即 release 前端产物的内置示例文档。

## 3. 打开 1MB Markdown 文件 <100ms（占位口径）

### 端点定义

- **占位口径（M0）**：从 `fs.readFile` 开始，到文件内容完成 UTF-8 解码并可作为字符串使用。即纯磁盘 IO + 解码，**不含解析、不含渲染**。
- 占位理由：M0 空壳尚无"打开文件"功能路径；ADR 0004 第 1 条明确此阶段"打开 1MB 文件以占位 fixture 计时"，绝对值仅用于校准。
- 演进条款：M1 实现真实打开路径（Rust core `fs_io` 读文件 → webview 装载进 CodeMirror）后，本节端点修订为"打开请求发出 → 文档在编辑器完成首帧渲染"，修订走 OpenSpec 正常循环。

### 工具链

- `scripts/perf/open-file.mjs`：Node `fs/promises.readFile` + `TextDecoder`，先完整读一遍预热 page cache，再正式采样。

### 采样口径

- N=50 次，page cache 热。磁盘 IO 的真实冷读不在此口径内（CI runner 无办法可复现地制造冷缓存）；门禁取 p95。

### Fixture 规格

- `tests/perf/fixtures/markdown-1mb.md`：**恰好 1,048,576 字节**（ADR 0002 的"1MB"在此钉死为 1 MiB，避免 SI/IEC 歧义），UTF-8 纯 ASCII，确定性内容：循环节包含标题、列表、代码围栏、wikilink、frontmatter 片段，覆盖真实 Markdown 的混合结构；末段以注释行填充至精确字节数。
- fixture 提交入库；内容变更只能通过 `tests/perf/fixtures/gen-fixture.mjs` 再生成（输出字节级确定），保证历史读数可比较。

## 4. 常驻内存 <200MB

### 端点定义

- **"内存"**：app 全进程树的 **RSS 合计**（主进程 + WebContent/GPU/Networking 等所有归属进程），单位 MB（1 MB = 1,048,576 bytes）。
- **进程归属**：WKWebView 的 `com.apple.WebKit.*` XPC 进程由 launchd 托管（ppid=1），不出现在 app 的 ppid 子树里。归因规则 = app 的 ppid 子孙进程 ∪ （当前 `com.apple.WebKit.*` 进程 − 启动前的基线快照）。CI runner 为独占 VM，测量窗口内无其他 WebKit 消费者，差集归因无串扰；本地运行窗口内若恰好有其他 app 打开 webview 会有少量虚计（虚高方向，偏保守，可接受）。
- **"常驻"（settle 条件）**：ready 信号出现后 idle 10 秒（无输入、无窗口操作），随后进入采样窗口。
- **口径缺陷声明**：RSS 含 shared pages，多进程合计会重复计数共享区，读数系统性偏高（虚高方向，即偏保守）；`vmmap -summary` 的 Physical footprint 是更准的口径，但单进程采样耗时数秒、不适合 CI 高频采样。校准期若发现 RSS 口径把 200MB 阈值顶死，允许以 OpenSpec 循环将口径修订为 phys_footprint——这属于测量方法学修订，不属于 ADR 0002 的一次性数字校准。

### 工具链

- `scripts/perf/memory.mjs`：spawn release 二进制，等 ready（读 stdout 前缀行），idle 10s 后每 2s 采样一次。每次采样用 `ps -axo pid=,ppid=,rss=,comm=` 取全量进程表，按上条归因规则求 RSS 合计。采样结束后 kill app 主进程（已验证 WebKit XPC 进程随主进程退出）。

### 采样口径

- 采样窗口内取 5 个样本（ready+10s 起，每 2s 一次）。上报全部样本；门禁取 **max**（内存是峰值敏感指标，p95 会漏掉单调爬升）。本条是绝对模式"p95 判定口径"的唯一例外。

### Fixture

- 无。空壳 app 常驻态 = 打开固定窗口 + 内置示例文档。

## 5. CI 集成与门禁状态

- 工作流 `.github/workflows/perf.yml`：`macos-15` runner，先经 `actions/cache/restore` 取回滚动基线（`perf-results/baseline/`，`restore-keys: perf-baseline-`），release 构建后依次跑四项脚本，`perf-results/` 整目录上传为 artifact（保留 30 天），随后 `check-thresholds.mjs` 对照 `tests/perf/thresholds.json` 比较。
- **现阶段（2026-09-05 校准后）**：`thresholds.json` 的 `enforce` 为 `true`，门禁拒合已启用。绝对模式指标超阈即 CI 红；相对模式指标回退 >40%（口径修正前为 20%）即 CI 红；任一指标的本次结果文件缺失或不可读亦 CI 红（exit 1，缺数据即红）；基线缺失只 warning 不拒合。
- **基线写回**：仅 `push` 到 master 且全部测量与阈值比较成功后，`update-baseline.mjs` 把当次相对模式指标门禁值追加进 `perf-results/baseline/baseline.json`（裁剪到最近 10 次），再由 `actions/cache/save` 以 `perf-baseline-<run_id>` 为 key 写回。
- 触发路径：`src/**`、`src-tauri/**`、`scripts/perf/**`、`tests/perf/**`、workflow 自身的 PR 与 master push，外加 `workflow_dispatch`（手动跑数/验证门禁行为）。
