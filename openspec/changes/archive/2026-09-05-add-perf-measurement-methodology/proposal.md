# Proposal: 为性能合同四个数字落盘测量方法学 spec

- Change ID: add-perf-measurement-methodology
- 日期: 2026-09-05
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

ADR 0002 第 6 条锁死了性能合同的四个数字（冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB），但只锁定数字与阈值，明确把测量方法学——端点、工具链、采样口径、fixture 规格——委托给 M0 产出的本 spec 定义（[ADR 0002 §6](../../../docs/adr/0002-technical-route.md)）。

不定义方法学的后果已由评审 finding 证实：四个数字没有任何一项有测量端点定义，CI 门禁实现时会各自发明口径，"回归即拒合"的判定不可复现（finding `20260904-reviewer-executability-bug-ci`，high 级，列了逐项缺口清单：冷启动缺起止端点与 ready 信号、keypress-to-paint 在 headless 无真实 vsync、1MB fixture 构成未定、内存未定义进程口径与 settle 条件）。

同时，ADR 0004 第 4 条指定本 spec 为 OpenSpec 首个全循环验证对象：它是 M0 自身产物、验收口径明确、第 2 周必然存在。本 change 因此有双重身份——既是性能门禁的方法学底座，也是"Alex 不看代码能否凭制品裁决"这一流程假设（ADR 0004 第 4 条评估条款）的第一个测试样本。方法学的完整权威文本在 [docs/specs/perf-measurement.md](../../../docs/specs/perf-measurement.md)（M8 已合并的 accepted 版本），本 proposal 只陈述裁决所需的方法学要点与风险点。

## What Changes

新增 capability `perf-measurement`，为四个性能数字各定义一节测量方法学。每条对应 spec 增量中的一个 requirement：

1. **总约定与运行环境**：四个数字仅在 CI `macos-15`（Apple Silicon）release 构建口径下定义；门禁比较值取 p95（内存取 max，唯一例外）；每项指标产出含全部原始样本的 JSON artifact。
2. **冷启动 <300ms**：主口径为 harness wall time——spawn app 二进制到 stdout 出现 `LUMIR_READY ` 前缀行；辅口径为 app 自报的 setup 耗时，用于归因。采样 = 1 次 warm-up（丢弃，首轮含 dyld/TCC 一次性开销）+ N=20 次正式样本，N<20 时 nearest-rank p95 退化为 max，是硬约束。无 fixture。
3. **keypress-to-paint <16ms**：页面内 `keydown` 派发到其后第二帧渲染完成；用 CDP `Input.dispatchKeyEvent` 驱动 headless Chrome 加载 release 前端产物，N=50。**⚠ 裁决点——下界属性**：该读数不含 OS 输入管道与合成器/vsync 开销、CI 用 Chrome/Blink 而产品是 WKWebView、M0 空壳编辑器为只读不触发文档更新路径。它测的是"事件 → 帧调度"的结构下界，不是真实按键延迟。本 change 要求该下界声明必须随读数一起引用，绝不单独引用数值。
4. **打开 1MB Markdown <100ms**：**⚠ 裁决点——占位口径**：M0 空壳没有"打开文件"功能路径，端点为 `fs.readFile` 开始到 UTF-8 解码完成，纯磁盘 IO + 解码，**不含解析、不含渲染**。fixture 为恰好 1,048,576 字节（"1MB" 钉死为 1 MiB）的确定性 Markdown，提交入库、只能由再生成器变更。M1 实现真实打开路径后本端点必须修订为"打开请求 → 首帧渲染完成"，修订走 OpenSpec 正常循环。N=50，page cache 热。
5. **常驻内存 <200MB**：全进程树 RSS 合计（含按差集规则归因的 WebKit XPC 进程）；ready 后 idle 10 秒进入采样窗口，取 5 样本，门禁取 max。**口径缺陷显式声明**：RSS 含 shared pages 重复计数，读数系统性偏高（偏保守方向）；若校准期发现该口径把 200MB 顶死，允许走 OpenSpec 循环改 phys_footprint 口径——这是方法学修订，不占用 ADR 0002 的一次性数字校准额度。

**校准路径（两阶段门禁）**：现阶段 CI 只测量、上报 artifact、超阈发 `::warning::`，workflow 恒绿（`thresholds.json` 的 `enforce: false`）→ M0 末四项指标首次全量实测后，按 ADR 0002 revisit 条款做**一次性**校准（可修订 ADR 0002 的数字，仅此一次）→ 校准后 `enforce: true`，超阈即 CI 红、拒合。

## Non-goals

- 不改动 ADR 0002 的四个数字与阈值本身——校准是 M0 末的独立动作（ADR revisit），不在本 change 内。
- 不定义前端首屏挂载的测量口径：headless CI 无法可靠读 webview console，列入校准期候选修订项，不阻塞本 spec。
- 不做磁盘冷读口径（CI runner 无法可复现地制造冷缓存）；不在本地/非 macos-15 环境定义阈值可比性。
- 不覆盖视觉回归门禁（ADR 0004 第 1 条的另一个 M0 deliverable，独立 capability）。
- 不要求 M1 的真实"打开文件"端点在本 change 内实现——演进条款只锁定"届时必须修订"的义务。

## Impact

- 影响的 specs：新增 capability `perf-measurement`（living spec 将落在 `openspec/specs/perf-measurement/spec.md`）。
- 影响的代码/系统：`scripts/perf/**`（四个测量脚本 + 阈值比较）、`tests/perf/**`（fixture、thresholds.json）、`.github/workflows/perf.yml`、`src-tauri/src/ready.rs`（ready 信号契约）。**首个循环的特殊性：这些实现已随 M8 合并入库**（见 tasks.md 如实标注）——本 change 补走提案与归档环节，以验证流程本身。
- 关联约束：ADR 0002 第 6 条（性能合同）与其 revisit 条款（一次性校准）；ADR 0004 第 1 条（M0 出口：四项指标全部在 CI 被测量并产出数值）与第 4 条（本 spec 为 OpenSpec 首个全循环验证对象）。
