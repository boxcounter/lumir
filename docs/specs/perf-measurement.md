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
  - **绝对阈值**（打开 1MB 文件 <100ms、常驻内存 <200MB）：两项轻指标 CI 两次实测几乎一致（约 2.6ms、约 110MB），噪声未淹没信号，保持 CI 绝对阈值门禁，超阈即拒合。**唯一例外（2026-09-18 M174）**：常驻内存的 CI **门禁阈值**改为 **250MB**（`tests/perf/thresholds.json`）——该指标 2026-09-05 校准实测约 110MB，而 2026-09-16~18 抽样 9 次 master run 稳定落在 206.50–215.28MB（9/9 确定性超阈），200MB 已与实际稳态脱节；依据、余量与性质声明见 §4。
- **门禁已启用拒合**：`tests/perf/thresholds.json` 的 `enforce` 为 `true`；超阈（绝对模式）或回退超**该指标容忍线**（相对模式；默认 40%、`keypress-to-paint` 60%，并随基线窗口实测散布浮动，见「相对回归门禁」一节）即 CI 红。enforce 后任一指标的本次结果文件缺失或不可读同样拒合（exit 1，缺数据即红，不得静默跳过）。
- **性质声明（2026-09-18 M174）——与 2026-09-05 口径修正的范式对照，须分清两类**：
  - **同类**（沿用第 41 行的范式，仅改 CI 判据口径、不动 ADR 0002 合同数字，不占用 ADR 0002 的一次性校准额度）：相对回归的容忍线逐指标化与随窗口散布浮动、基线样本下限 `minRuns`、基线推进逐指标解耦。
  - **不同类**（M174 新增，如实标注）：常驻内存的 CI 门禁阈值 200→250MB **改动了 ADR 0002 §6 的数字之一**。它是按实测稳态做的阈值修订（不是重新校准：未做标准化环境测量、未改 ADR 文件），但 **ADR 0002 §6 的文本因此需要修订**。本 spec 与 `thresholds.json` 已标出该分叉，ADR 文本修订登记为 follow-up；在修订落地前，常驻内存一项上「ADR 0002 合同值（200MB）」≠「CI 门禁阈值（250MB）」，且 artifact 的 `contract` 字段仍记 200MB、门禁阈值记在 `perf-results/gate-status.json`。
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

- **基线来源**：仅 master 分支 push 触发的 perf workflow 写基线（PR 与 workflow_dispatch 只读不写）。写回条件是 `if: always() && push && master`（2026-09-18 M174 由 `success()` 改），**是否推进逐指标裁决**：`check-thresholds.mjs` 把逐指标判据落盘到 `perf-results/gate-status.json`（`pass`/`fail`/`skip` + 判据明细），`update-baseline.mjs` 只把「该指标判据非 `fail` 且本次读数可读」的条目追加进滚动基线文件 `perf-results/baseline/baseline.json`，再经 `actions/cache` 持久化（cache key `perf-baseline-<run_id>`，`restore-keys: perf-baseline-` 前缀匹配取最近一次）。判据文件缺失或该指标在判据里没有条目 → fail-closed：一条都不推进。
- **比较方法**（2026-09-05 统计口径修正 + 2026-09-18 M174 修正）：对相对模式指标，本次门禁值取当次运行的 **median**；基线值取基线文件该指标**最近 10 次**（滚动窗口）master 门禁值的 **median**——历史条目存的本身就是各次 master 运行的 median，基线值即 median of medians。回退幅度 = `(value - baseline) / baseline`，**超过该指标容忍线即拒合**。容忍线（M174）= `max(该指标 maxRegressionPct, 窗口高侧散布 × spreadHeadroom)`，「窗口高侧散布」= `(窗口 max − 窗口 median) / 窗口 median`：
  - `maxRegressionPct` 默认 40%（M37 依据见下条），`keypress-to-paint` 逐指标取 60%（M174 依据见其证据链）；`spreadHeadroom` 默认 1.2。
  - 浮动项在 M172 抽样值构成的窗口上是**惰性**的（窗口高侧散布最高 44.4%×1.2 = 53.3%，仍低于 60% 配置值），它是针对 runner 未来抖动量级的护栏：抖动变大时容忍线自动抬高、稳定后回落到配置值——静态常数在「噪 runner」与「稳 runner」两种状态下必错一边。
  - **基线样本下限 `minRuns`（默认 5）**：基线历史条数不足时，该指标本次判据**降级为 `::warning::`、不拒合**（判据记 `skip/baseline-thin`，读数照常进基线以走出重建期）。理由见 M174 证据链第 2 条：k 条窗口 median 自身就是散布里的抽样，k=1 时其可能范围等于整条散布。唯一例外：读数超基线 median `outlierMultiplier` 倍（默认 3）时仍拒合且不进基线——稀薄的是精度，不是量级判断力。
  - median + 滚动窗口是为抗 runner 整轮漂移与右尾噪声：3-4 倍噪声表现为整轮漂移和 p95 尾部爆量，median 对两者都稳健；窗口 median 跟随 runner 真实水平漂移，只拒合"显著差于近期常态"的运行。
- **口径修正证据链（M37 调查，17 次 CI run 回放）**：修正前口径为"当次 p95 vs 基线窗口 p95 的 median、容忍 20%"，是结构性误报源——①基线窗口内 4 次绿 run 的 cold-start p95 自身散布 152.4–218.0ms（43%），已超 20% 容忍线；②两次代码逐字节相同（ea9e9e9 与 eac37a0 空 diff）的背靠背 run，cold-start p95 284.4 vs 808.9ms（2.8x 纯 runner 方差）；③连续两次红 run（33955998214、33957248396）的 cold-start median（180.9/195.0ms）≤ 基线 median 199.4ms，仅 p95 尾部越线；④keypress-to-paint 在 9 次 run 中 8 次红，同病因（p95 尾部噪声 vs median 基线混用）；⑤17 次 run 的 runner 镜像完全相同（macos-15-arm64 20260828.587），排除镜像漂移。本机双点同口径测量（M3 Pro，各 30 样本）确认基线绿代码到 master 之间零代码回归（Δmedian +1.7ms）。median 口径 + 40% 容忍线覆盖观测到的 runner 噪声幅度，同时仍能捕获真实回退（构造的 +100% 劣化在回放中仍被拒合）。
- **M174 判据修正证据链（2026-09-18，抽样 9 次 master perf run + 子集穷举）**：① **主因是基线冻结，不是容忍线太紧**——9 次 keypress-to-paint 门禁值 22.35/26.75/33.70/33.90/39.80/42.10/43.55/46.65/53.20ms（median 39.80ms），而当时基线是**单样本** 28.15ms（比 9 次的 median 低 29%），40% 判红线（28.15×1.4 = 39.4ms）因此落在实测散布内部。② 对上述读数穷举「k 条子集的 median」（子集穷举给出的是连续窗口可能范围的**上界**）：k=1 时窗口 median 的可能范围就是整条散布（22.35–53.20ms，2.38 倍），k=3 为 26.75–46.65ms，k=5 起收窄到 33.70–43.55ms——即**单样本「基线」不是水平值，而是散布里的一次抽样**；k<5 时「低端窗口 median + 实测最高读数」可造出 +138%(k=1)/+117%(k=2)/+99%(k=3)/+76%(k=4) 的假回退，这是 `minRuns=5` 的依据。③ **60% 容忍线的算术**：`minRuns=5` 下窗口 median 的最差组合是 33.70ms，与实测最高读数 53.20ms 相距 **+57.9%**，取大于它的最小整十档 60%（静态 40% 在该角落必误报）。④ **灵敏性未被牺牲**：+100% 量级真实劣化（keypress 70ms vs 窗口 median 36.85ms）在 60% 容忍线下仍拒合。⑤ 同期 cold-start 9/9 通过（115–225ms vs 冻结基线 278.54ms）、open-1mb-file 9/9 通过（0.82–5.42ms），故本轮**不动**这两项的阈值与判据。
- **性质声明：本条是门禁实现的统计口径修正，不是 ADR 0002 的合同校准**——合同数字（冷启动 <300ms、keypress-to-paint <16ms）不动，2026-09-05 一次性校准额度已用尽的状态不变，合同值在标准化环境的裁决口径不变；变更的仅是 CI 相对回归门禁用哪个统计量与多大容忍线判断"回退"，以及基线推进的触发条件与逐指标粒度（M174）。常驻内存门禁阈值 200→250MB 属**另一类**（改动了 ADR 0002 §6 的数字之一），声明见总约定「性质声明（2026-09-18 M174）」。
- **基线更新规则**：只进不出地追加、按窗口裁剪到最近 10 次；**逐指标独立推进**（M174 起）：某指标判 `fail`（超阈、回退超容忍线、结果缺失、判据缺失）只冻结它自己的历史，不再连带冻结其它指标的基线。2026-09-18 前的口径是「整轮全绿才更新」，而 resident-memory 确定性超阈（M172 抽样 9/9）会让整轮永不 success ⇒ 全部相对基线永久冻结，keypress-to-paint 长期对着单样本基线比较（CI 日志「最近 1 次 master」即此）。`skip`（基线缺失、窗口未满 `minRuns`、统计口径迁移）的读数**照常进基线**——否则窗口永远攒不满、薄基线降级会把自己锁死；只有 `fail` 不进（`enforce: false` 的 warn-only 档不拒合任何读数，故该档下 `fail` 也照常进——进基线的准绳与拒合的准绳是同一条，不在两处各判一次）。cache 因 GitHub 7 天未访问清理而丢失时，由下一次 master run 重建。**统计口径迁移**：基线条目的 `gate` 字段记录历史值的统计口径；与当前门禁 gate 不一致时（如 2026-09-05 修正前遗留的 p95 口径 cache），`check-thresholds.mjs` 跳过相对比较（warning，不拒合），`update-baseline.mjs` 丢弃旧口径历史、以新口径重建——旧条目存的是另一种统计量，混用会让窗口 median 系统性偏离（p95 历史配 median 当前值必出假阴性，反之必出假阳性）。
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
| `scripts/perf/update-baseline.mjs` | 滚动基线追加与裁剪（仅 master push 调用，判据取 `gate-status.json`；逐指标推进） |
| `tests/perf/fixtures/markdown-1mb.md` | 1MB Markdown fixture（提交入库） |
| `tests/perf/fixtures/gen-fixture.mjs` | fixture 确定性再生成器 |
| `tests/perf/thresholds.json` | 阈值、门禁模式、相对回归参数与 enforce 开关 |
| `perf-results/`（CI artifact） | 四项指标 JSON + 原始样本 + `gate-status.json`（逐指标判据） |
| `perf-results/gate-status.json`（CI artifact） | `check-thresholds.mjs` 落盘的逐指标判据（`pass`/`fail`/`skip` + 门禁值、基线值、回退%、容忍线、基线条数、理由），供 `update-baseline.mjs` 逐指标裁决 |
| `perf-results/baseline/baseline.json`（CI cache） | 滚动基线（相对回归模式用，不入库） |

## 1. 冷启动 <300ms

### 端点定义

- **主口径（门禁用）**：harness wall time——从 harness `spawn` app 二进制之前打点时间戳，到 stdout 出现 `LUMIR_READY ` 前缀行的时间戳。
- **辅口径（归因用）**：app 自报的 `elapsed_ms`（`src-tauri/src/ready.rs`：从 `run()` 入口到 Tauri setup 完成，即 webview 创建后、事件循环接管前）。两者之差 ≈ exec/动态链接/harness 调度开销，校准期用于判断瓶颈在进程装载还是 Tauri 初始化。
- ready 信号契约见 `src-tauri/src/ready.rs` 文档注释：`LUMIR_READY {"event":"ready","elapsed_ms":<f64>,"pid":<u32>,"ts_unix_ms":<u64>}`，同时写 `$TMPDIR/lumir-ready-<pid>`。harness 匹配 stdout 行首 `LUMIR_READY ` 前缀。
- 明确排除：前端首屏挂载（webview 侧 `performance.now()` 打点，见 `src/main.ts`）暂不入端点——headless CI 无法可靠读 webview console。首屏挂载纳入端点是校准期的候选修订项。
- **ready 不含也不等待 `last_vault` 自动恢复**（M159 裁决，change startup-restore-off-main-thread）：该端点的语义是「事件循环可接管」，不是「用户首帧」——`LUMIR_READY` 在恢复任务启动**之前**打印（`src-tauri/src/lib.rs` 的 setup：`emit_ready` → `start_restore`），恢复耗时（真实 vault ~125ms、4× 规模 ~770ms）不经此端点，也 **MUST NOT** 用「把该标记移到恢复之后」的方式让门禁覆盖它——那是拿指标换真实体验：延迟一分不减，只把延迟记进数里。恢复耗时若需要可见性，走诊断事件（独立 change），不搭在合同端点上。

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
- **本项 CI 判据（2026-09-18 M174 修正）**：把「本次 median」与「最近 10 次 master 门禁值的 median」比较，容忍线 **60%**（总约定「相对回归门禁」的逐指标 `maxRegressionPct`；60% 的算术见该节 M174 证据链第 3 条），并受 `minRuns=5` 的薄基线降级保护（历史不足 5 条时 `::warning::` 不拒合）。**修正前的病根不在这条容忍线**：基线被冻结成单样本 28.15ms（9 次实测的 median 是 39.80ms），40% 判红线随之落在实测散布内部；容忍线 40%→60% 是为覆盖「窗口 median 落在低端（33.70ms）而本次读数落在高端（53.20ms）」这一角落，同时保留对 +100% 量级真实劣化的拒合能力。

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
- **口径缺陷声明**：RSS 含 shared pages，多进程合计会重复计数共享区，读数系统性偏高（虚高方向，即偏保守）；`vmmap -summary` 的 Physical footprint 是更准的口径，但单进程采样耗时数秒、不适合 CI 高频采样。校准期若发现 RSS 口径把阈值顶死，允许以 OpenSpec 循环将口径修订为 phys_footprint——这属于测量方法学修订，不属于 ADR 0002 的一次性数字校准。
- **CI 门禁阈值（2026-09-18 M174 提阈为 250MB）**：`tests/perf/thresholds.json` 的 `resident-memory.threshold` = **250MB**。依据：2026-09-16~18 抽样 9 次 master perf run，该项 **9/9 确定性超阈**、读数 206.50–215.28MB（非抖动；另见 backlog 第 7 条 2026-09-06 记 218–222MB），而 2026-09-05 校准实测约 110MB——稳态相对校准值翻了一倍。250MB 相对实测最高读数 215.28MB 留 ≥16% 余量（稳态再涨 16% 即报警）。
- **提阈的性质（如实标注，勿混同于本 spec 的其他口径修正）**：这是改到了 ADR 0002 §6 的**数字之一**（常驻内存 200MB），不是「只改 CI 判据、不动合同值」那一类（对照总约定「性质声明（2026-09-18 M174）」）。它按 Alex 2026-09-18 的裁决落地，**不占用** 2026-09-05 的一次性校准额度（未在标准化环境重新测量），但也**不解除**「稳态为何翻倍」这个产品问题——提阈只让 CI 重新可用；归因与治理（或按上条改用 phys_footprint 口径）是独立议题。artifact 的 `contract` 字段仍记 200MB（ADR 合同值），CI 实际使用的门禁阈值记在 `perf-results/gate-status.json` 的 `threshold` 字段；ADR 0002 §6 的文本修订登记为 follow-up。

### 工具链

- `scripts/perf/memory.mjs`：spawn release 二进制，等 ready（读 stdout 前缀行），idle 10s 后每 2s 采样一次。每次采样用 `ps -axo pid=,ppid=,rss=,comm=` 取全量进程表，按上条归因规则求 RSS 合计。采样结束后 kill app 主进程（已验证 WebKit XPC 进程随主进程退出）。

### 采样口径

- 采样窗口内取 5 个样本（ready+10s 起，每 2s 一次）。上报全部样本；门禁取 **max**（内存是峰值敏感指标，p95 会漏掉单调爬升）。本条是绝对模式"p95 判定口径"的唯一例外。

### Fixture

- 无。空壳 app 常驻态 = 打开固定窗口 + 内置示例文档。

## 5. CI 集成与门禁状态

- 工作流 `.github/workflows/perf.yml`：`macos-15` runner，先经 `actions/cache/restore` 取回滚动基线（`perf-results/baseline/`，`restore-keys: perf-baseline-`），release 构建后依次跑四项脚本，`perf-results/` 整目录上传为 artifact（保留 30 天），随后 `check-thresholds.mjs` 对照 `tests/perf/thresholds.json` 比较。
- **现阶段（2026-09-05 校准 + 2026-09-18 M174 修正后）**：`thresholds.json` 的 `enforce` 为 `true`，门禁拒合已启用。绝对模式指标超阈即 CI 红（resident-memory 的门禁阈值为 250MB，见 §4）；相对模式指标回退超**该指标容忍线**（默认 40%、`keypress-to-paint` 60%，并随基线窗口实测散布浮动；基线历史不足 `minRuns=5` 时降级为 `::warning::` 不拒合）即 CI 红；任一指标的本次结果文件缺失或不可读亦 CI 红（exit 1，缺数据即红）；基线缺失、薄基线、统计口径迁移只 warning 不拒合。`check-thresholds.mjs` 同时把逐指标判据落盘 `perf-results/gate-status.json`（随 artifact 上传，可复核每次 run 用的是哪条基线、哪个容忍线）。
- **基线写回**：`push` 到 master 时，`update-baseline.mjs` 以 `if: always()` 运行（**不再**要求整轮全绿，缘由见「基线更新规则」），按 `gate-status.json` **逐指标**把「判据非 `fail` 且读数可读」的门禁值追加进 `perf-results/baseline/baseline.json`（裁剪到最近 10 次），再由 `actions/cache/save` 以 `perf-baseline-<run_id>` 为 key 写回。某指标自身拒合、结果缺失或判据缺失时，只有该指标的历史不动（fail-closed：判据文件整体缺失则一条都不推进）。
- 触发路径：`src/**`、`src-tauri/**`、`scripts/perf/**`、`tests/perf/**`、workflow 自身的 PR 与 master push，外加 `workflow_dispatch`（手动跑数/验证门禁行为）。
