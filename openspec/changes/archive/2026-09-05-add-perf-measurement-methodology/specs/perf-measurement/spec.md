# perf-measurement 增量规格

各 requirement 的完整方法学定义（端点、工具链、采样口径、fixture 规格的逐条细节）以 [docs/specs/perf-measurement.md](../../../../../docs/specs/perf-measurement.md) 为权威文本；本增量在 requirement 级别引用对应小节，不复制全文。

## ADDED Requirements

### Requirement: 性能测量总约定

CI SHALL 为 ADR 0002 第 6 条性能合同的四个数字（冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB）各自测量并产出数值，测量环境固定为 `macos-15` runner（Apple Silicon）上的 release 构建；其他环境的读数 MUST NOT 直接对阈值。每项指标 SHALL 产出含全部原始样本的 JSON artifact（schema 见 docs/specs/perf-measurement.md「总约定 · 采样统计口径」），统计量由统一的统计库计算，各测量脚本 MUST NOT 自造统计口径。门禁比较值 SHALL 取 nearest-rank p95，常驻内存例外取 max（理由见「常驻内存测量」requirement）。

#### Scenario: CI 产出四项指标数值

- **WHEN** 触发 `perf.yml` 工作流（`src/**`、`src-tauri/**`、`scripts/perf/**`、`tests/perf/**` 变更或手动 dispatch）
- **THEN** 四项指标各自产出 `perf-results/<metric>.json`，含全部原始样本与 median/p95/max/min/mean，整目录作为 artifact 上传保留 30 天

#### Scenario: 本地读数不对阈值

- **WHEN** 在开发机本地运行任一测量脚本
- **THEN** 读数可用于观察与调试，但不得作为性能合同达标与否的判定依据

### Requirement: 冷启动测量

冷启动 SHALL 以 harness wall time 为主口径（门禁用）：从 spawn app 二进制之前到 stdout 出现 `LUMIR_READY ` 前缀行；app 自报的 setup 耗时为辅助口径（归因用），端点细节见 docs/specs/perf-measurement.md 第 1 节。采样 SHALL 为 1 次 warm-up（丢弃）+ N=20 次正式样本，每次均为全新进程；N MUST NOT 小于 20（nearest-rank p95 在 N=20 时截去最高 1 个样本，N=10 时退化为 max）。CI 门禁为相对回归模式（见「门禁模式与一次性校准」requirement）；绝对合同值 <300ms 保留，在标准化环境（裁决者本机）按 ADR 0002 第 6 条裁决。

#### Scenario: 正式样本排除首轮一次性开销

- **WHEN** 冷启动测量运行
- **THEN** 首轮（含 dyld 绑定、TCC 授权检查等一次性开销）仅作 warm-up 丢弃，门禁取后续 20 次全新进程样本的 p95

### Requirement: keypress-to-paint 测量

keypress-to-paint SHALL 定义为页面内 `keydown` 事件派发时刻到其后第二帧渲染完成时刻的差值，以 CDP `Input.dispatchKeyEvent` 驱动 headless Chrome 加载 release 前端产物近似测量，N=50、间隔 100ms，细节见 docs/specs/perf-measurement.md 第 2 节。该读数是结构下界：不含 OS 输入管道与合成器/vsync 开销、引擎为 Blink 而非产品的 WebKit、M0 空壳编辑器只读不触发文档更新路径。任何读数的引用（CI 输出、报告、校准讨论）MUST 附带下界声明，MUST NOT 将数值单独引用为真实按键延迟。CI 门禁为相对回归模式（见「门禁模式与一次性校准」requirement）；绝对合同值 <16ms 保留，在标准化环境（裁决者本机）按 ADR 0002 第 6 条裁决。

#### Scenario: 下界声明随读数输出

- **WHEN** keypress-to-paint 测量脚本输出结果
- **THEN** 输出附带下界声明（三条：无 OS 输入管道/合成器开销、Blink 与 WebKit 引擎差异、只读空壳无文档更新路径）

### Requirement: 打开 1MB Markdown 文件测量

打开 1MB 文件在 M0 SHALL 采用占位口径：从 `fs.readFile` 开始到文件内容完成 UTF-8 解码，纯磁盘 IO + 解码，不含解析与渲染；N=50、page cache 热，细节见 docs/specs/perf-measurement.md 第 3 节。fixture SHALL 为恰好 1,048,576 字节（1 MiB）的确定性 Markdown 文件并提交入库，内容 MUST 只能通过确定性再生成器变更，以保证历史读数可比较。M1 实现真实打开路径后，本端点 MUST 修订为「打开请求发出 → 文档在编辑器完成首帧渲染」，修订走 OpenSpec 正常循环。

#### Scenario: fixture 确定性

- **WHEN** 运行 fixture 再生成器
- **THEN** 输出与库内 `tests/perf/fixtures/markdown-1mb.md` 字节级一致，恰好 1,048,576 字节

#### Scenario: 占位口径的演进义务

- **WHEN** M1 的真实打开路径（Rust core 读文件 → webview 装载进 CodeMirror）落地
- **THEN** 本端点经 OpenSpec 循环修订为含解析与渲染的完整口径，占位口径废止

### Requirement: 常驻内存测量

常驻内存 SHALL 定义为 app 全进程树的 RSS 合计（含按基线差集规则归因的 `com.apple.WebKit.*` XPC 进程），「常驻」为 ready 信号后 idle 10 秒进入采样窗口，取 5 个样本，细节见 docs/specs/perf-measurement.md 第 4 节。门禁比较值 SHALL 取 max（内存是峰值敏感指标，p95 会漏掉单调爬升——这是 p95 总约定的唯一例外）。RSS 含 shared pages 重复计数、读数系统性偏高的缺陷 MUST 在 spec 中显式声明；若校准期发现该口径把 200MB 阈值顶死，允许经 OpenSpec 循环修订为 phys_footprint 口径，此修订 MUST NOT 占用 ADR 0002 的一次性数字校准额度。

#### Scenario: WebKit XPC 进程归因

- **WHEN** 采样常驻内存
- **THEN** RSS 合计 = app 的 ppid 子孙进程 ∪（当前 `com.apple.WebKit.*` 进程 − 启动前基线快照）

#### Scenario: 峰值敏感指标取 max

- **WHEN** 内存采样窗口内 5 个样本存在单调爬升
- **THEN** 门禁取 max 而非 p95，爬升不被分位数掩盖

### Requirement: 门禁模式与一次性校准

阈值门禁 SHALL 以 `tests/perf/thresholds.json` 的 `enforce: true` 启用拒合，CI 门禁 SHALL 分两种模式（2026-09-05 一次性校准结论，ADR 0002 第 6 条）：**绝对模式**（打开 1MB 文件、常驻内存）超阈即 CI 红、拒合；**相对回归模式**（冷启动、keypress-to-paint）以滚动基线比较——基线取该指标最近 10 次 master 门禁值的 median（经 `actions/cache` 持久化，仅 master push 且测量全绿时写回），本次门禁值相对基线回退 >20% 即 CI 红、拒合，口径细节见 docs/specs/perf-measurement.md「相对回归门禁」一节。基线缺失时 SHALL 输出 `::warning::` 并跳过该项相对比较、不拒合；enforce 下任一指标本次结果文件缺失或不可读 SHALL exit 1 拒合（缺数据即红）。一次性校准额度已于 2026-09-05 使用（依据：CI 两次全量实测重指标噪声 3-4 倍、轻指标几乎一致），此后 MUST NOT 再次使用；四个绝对合同数字未改动。M0 空壳阶段的绝对值 MUST NOT 作为达标判定，仅用于该次校准。

#### Scenario: 绝对模式超阈拒合

- **WHEN** `enforce: true` 下绝对模式指标（打开 1MB 文件、常驻内存）门禁值超阈
- **THEN** CI 红、拒合，与 ADR 0002 第 6 条「回归即拒合」一致

#### Scenario: 相对回归超 20% 拒合

- **WHEN** 相对回归模式指标（冷启动、keypress-to-paint）门禁值相对滚动基线 median 回退超过 20%
- **THEN** CI 红、拒合

#### Scenario: 基线缺失不拒合

- **WHEN** 基线文件不存在或该指标无历史（首次运行、cache 丢失重建期）
- **THEN** CI 输出 `::warning::` 并跳过该项相对比较，不阻塞合并，由下一次 master 成功 run 重建基线

#### Scenario: 结果缺失拒合

- **WHEN** `enforce: true` 下任一指标的本次结果文件缺失或不可读
- **THEN** `check-thresholds.mjs` exit 1，CI 红（缺数据即红，不得静默跳过）
