# Design: Foundation Table Reading 质量合同

## 分层与状态机

分层单位是单个 pipe table 的 UTF-8 源码范围，并另记行数、列数和最长 cell。普通（≤16 KiB）与中型（>16–64 KiB）在首屏相交时只能进入 `final-table` 或 blocking failure；不能先进入源码再异步切换。异常（>64 KiB 或经节点裁决的极端形状）可进入 `explicit-source-fallback`，增强失败 report-only，但源码完整性仍为 blocking。

## 语法与矩形模型

当前 GFM parser 决定候选范围。纯 model 从源码 delimiter 恢复空槽，并在 parser `Table` 之后独立验证表头、delimiter 与数据行列数。无法安全建立源码槽位或范围不完整时，返回整块降级原因，不猜测补列。引用与列表内表格只有在 parser 提供完整范围时增强。

## 三层架构

1. model 仅产出范围、行列、对齐、矩形性、降级原因和可见行索引；按文档版本缓存。
2. adapter 只用 CodeMirror 公开 `BlockWrapper`、decoration、widget、`visibleRanges`、`requestMeasure` 与事件 API；不直接修改管理 DOM，不以整表 widget 取代源码。
3. theme/WK 负责 token、字体和列宽测量、局部横滚、焦点、Accessibility（AX）语义与真实 WKWebView 验收。

列宽由内容、字体、主题和阅读栏共同决定。M72 的固定 240px 仅为压力实验。打开时同步全量扫描、每次 viewport 遍历所有行、整表跨行 widget 与 `forceParsing` 固定预算假设均被拒绝。

## 增量与 Worker 门槛

非首屏表格在接近可见区时增量准备，adapter 只查询可见交集。默认复用现有增量 parser tree、缓存和行索引。仅当匿名代表 fixture ≤256 KiB 在真实 WK 出现归因明确的 >16ms parser/model 主线程任务，或普通/中型 F0 持续失败，才允许另立 parser worker 实验。M76 的 full-document worker、1500ms timeout、两次 retry 与 packed tree 只提供取消、obsolete response、有界失败的参考，不是生产参数。

## 真实 WK 证据与预算裁决

Table F0 从文件树点击开始，到正确文档、首屏相交表格最终 decoration ready 后下一次 `requestAnimationFrame` paint。滚入可见 paint 从滚动开始，到目标可见行按稳定列规则完成 decoration 后下一次 paint。报告冷/热、普通/中型各 `N≥30` 的 p50/p95/max，并保存所有 >16ms 主线程任务及 fixture/app/WK/主题/窗口/日志/AX/逐帧 failure evidence。

推荐候选值为 Table F0 p95 ≤100ms、滚入 paint p95 ≤50ms、表格 model/adapter 单次任务目标 ≤8ms 且不出现 >16ms。它们必须由节点单独批准、修订或拒绝；本 change 不宣称已有 perf 通过。

## Review 边界

M88 脱敏 summary、极端形状阈值和性能候选值是节点 1 明示裁决项。实现后真实 WK、源码复制、磁盘只读、AX、键盘/触控板、strict、build、link/diff 与独立 review 是节点 2 出口。不得通过扩大异常层或永久源码 fallback 绕过普通/中型 failure。
