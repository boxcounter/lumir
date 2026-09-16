# foundation-table-reading Specification

## ADDED Requirements

### Requirement: 表格分层与首帧状态

系统 SHALL 按单个 pipe table 的 UTF-8 源码大小和经裁决的极端形状分为普通（≤16 KiB）、中型（>16–64 KiB）与异常（>64 KiB 或极端形状）。普通和中型在首屏相交时 MUST 在真实 F0 呈现最终表格，MUST NOT 先闪现朴素源码。异常 MAY 在 F0 呈现完整、连续、可选择的原始 Markdown 源码并明确降级，异常表格增强失败 SHALL report-only；源码不完整、不可读或无限 loading 仍 MUST 失败。

#### Scenario: 普通或中型表格进入首屏

- **WHEN** 用户打开包含首屏相交的普通或中型表格的 Markdown 文件
- **THEN** 正确文档路径确认后，F0 的下一次 `requestAnimationFrame` paint 直接显示最终表格，包含稳定的行列、空槽和对齐，不出现朴素源码闪现

#### Scenario: 异常表格安全降级

- **WHEN** 单表超过 64 KiB 或命中已裁决的极端形状
- **THEN** 系统可在 F0 显示完整可读源码和明确降级状态；增强失败进入 report-only，源码范围、字符、换行和选择能力仍完整

### Requirement: Pipe 语法与矩形性

系统 SHALL 遵循当前 GFM parser 的 pipe table 边界，支持有或无首尾 pipe、默认/左/中/右对齐、空格或 `||` 空槽、escaped pipe，以及 parser 明确支持的引用或列表内表格。系统 MUST 在 parser 识别 `Table` 后从 delimiter 边界独立恢复空槽并验证矩形性。数据行 cell 数少于表头列数时 MUST 按 GFM spec §4.10 在尾部补空 cell 后按矩形呈现，MUST NOT 因此整块回退（M142 收窄，见 `narrow-table-short-row-gfm-padding`）；表头或 delimiter 列数不一致、数据行 cell 数多于表头、范围不完整或槽位无法安全映射时，MUST 整块回退完整源码，不得猜测丢弃多余列或丢列。

#### Scenario: 空槽和转义 pipe保持列位

- **WHEN** 表格包含 `||`、空格空槽或 `\|`，且有首尾 pipe 或省略首尾 pipe
- **THEN** 空槽占据原列，后续 cell 不左移，escaped pipe 保持在原 cell 内容中，复制仍能恢复原始 Markdown

#### Scenario: 引用或列表中的多列表格

- **WHEN** 引用或列表容器内的候选表格、或普通表格的数据行多于表头列数而无法形成矩形
- **THEN** 系统显示该候选范围的完整连续源码，不把部分行伪装成表格，不修改容器前缀、缩进或换行

#### Scenario: 短行尾部补空列

- **WHEN** 表头声明 6 列而数据行只有 5 格（M137 实测的 `outline.md` 形态）
- **THEN** 尾部补空 cell 后按 6 列矩形呈现，末格为空白 cell，不出现降级提示，源文件与磁盘文件不变

### Requirement: 最终呈现与宽表局部滚动

普通和中型最终表格 SHALL 保持表头、行、cell 边界、四种对齐和空槽位置稳定，并根据内容、字体、主题和可用阅读栏测量列宽。系统 MUST NOT 固定 240px 列宽、撑宽表外正文、永久裁切末列或让表格横滚移动表外正文；宽表 SHALL 使用独立可聚焦的局部横向滚动容器。

#### Scenario: 宽表到达末列

- **WHEN** 用户在窄 viewport 中使用键盘与物理触控板滚动宽表，并滚入中部后返回
- **THEN** 只有表格滚动区域横移，键盘和触控板均可到达最右列，列规则与表外正文位置保持稳定

### Requirement: 源码复制与只读及 M2 承接

表格阅读 SHALL 复用同一 `EditorState.doc` 和原始源码 range。鼠标拖选、键盘扩选、局部、整表、跨表/正文和全选复制 MUST 输出原始 Markdown，不输出 HTML、TSV 或视觉重排结果。M1 阅读交互（点击、选择、横滚、剪切、粘贴、Delete、任务标记）MUST NOT 修改内存文档或磁盘文件；M2 SHALL 承接源码编辑、selection、保存和冲突保护，不要求专用可视 cell 编辑。

#### Scenario: 复制保留源码

- **WHEN** 用户选择表格 cell、整表、跨表正文或全选并复制
- **THEN** 复制内容保留 pipe、对齐冒号、escaped pipe、空槽、容器前缀和原始换行，并与选择范围的 Markdown 源码一致

#### Scenario: 只读交互不写入

- **WHEN** 用户在 M1 通过键盘、鼠标或触控板浏览并执行剪切、粘贴、Delete 或任务标记操作
- **THEN** `EditorState.doc` 与自有匿名文件磁盘 hash 前后一致；M2 编辑仍以同一源码文档承接

### Requirement: AX 与焦点路径

宽表滚动容器 SHALL 具有可访问名称、可见焦点和自然 Tab 进出路径。AX MUST 表达 table、header、row、cell 关系及空槽的行列位置；键盘 MUST 到达最右列并能离开容器，系统 MUST NOT 制造焦点陷阱。合成 wheel 或非 WK 结果 MUST NOT 作为真实物理触控板验收的替代。

#### Scenario: 表格可访问且可离开

- **WHEN** 用户通过自然 Tab 进入命名表格滚动区，并使用键盘移动、End 和 Escape 离开
- **THEN** AX 可感知表格结构和 cell 关系，焦点可见且可到达末列，随后可返回编辑器，不形成焦点陷阱

### Requirement: 增量分层与 Worker 门槛

系统 SHALL 采用纯 table model、公开 CodeMirror adapter、theme/WK 三层边界；model MUST 不访问 DOM/主题/文件系统，adapter MUST 不直接修改 CodeMirror 管理 DOM。可见 decoration SHALL 只按 viewport 相交行增量构建。系统 MUST NOT 在打开时同步全量扫描构建所有 metadata、每次 viewport 遍历整表全部行、使用整表 widget 或依赖固定 `forceParsing` 预算假设。Parser worker 仅在匿名代表性单文档 ≤256 KiB 的真实 WK 出现归因明确的 >16ms parser/model 主线程任务或普通/中型 F0 持续失败后，才 MAY 另立实验。

#### Scenario: 滚入中部只物化可见行

- **WHEN** 用户把普通或中型长表滚入中部
- **THEN** 系统按缓存的文档版本与测量条件查询可见交集，完成最终列规则，不遍历或物化整表所有行

#### Scenario: Worker 触发前置失败证据

- **WHEN** 真实 WK 尚未出现归因明确的 >16ms 任务且普通/中型 F0 未持续失败
- **THEN** 系统不启用 parser worker；若触发实验，则记录取消、过期响应、malformed payload、有界 retry、fatal 恢复与重建成本，不自动生产化 M76 参数

### Requirement: 真实 WK 性能端点与失败证据

真实性能 SHALL 在隔离匿名 Tauri/WKWebView 上分别测量普通与中型冷/热样本，样本数 MUST 为每组 `N≥30`，并报告 Table F0、滚入可见 paint、主线程任务的 p50/p95/max。Table F0 SHALL 从用户点击到首屏相交最终表格 decoration 后下一次 `requestAnimationFrame` paint；滚入端点 SHALL 从滚动到目标可见行最终 decoration 后下一次 paint；所有 `>16ms` 主线程任务和失败样本 MUST 保存 fixture manifest、版本、WK/OS、主题、AX、逐帧/屏幕、console/native log 与实际/预期差异。推荐候选 `F0 p95≤100ms`、滚入 `p95≤50ms`、单次任务 `≤8ms` 且不超 16ms SHALL 标为待节点裁决，MUST NOT 被称为现有 perf 已通过。

#### Scenario: 性能报告不越界

- **WHEN** 团队运行真实 WK 表格性能矩阵并观察到 probe 或 IO 子指标读数
- **THEN** 报告分开列出真实端点、主线程任务和辅助读数，保留失败证据；M72 的同步 metadata/固定列宽/Chromium 结果不能替代生产通过，候选阈值等待独立节点裁决

### Requirement: 匿名 fixture 与出口检查

Foundation fixture SHALL 使用确定性匿名内容并记录文档/单表 bytes、行数、列数、最长行或 cell、容器、矩形性、F0 状态与 report-only 状态。矩阵 MUST 覆盖首尾 pipe、四对齐、空槽、escaped pipe、引用/列表、非矩形、宽表、异常形状、三套主题、窄窗、滚入、AX、copy 与只读保护。出口 MUST 包含 OpenSpec strict、标准 build、相对链接目标核对、diff 检查和独立 review；节点 2 前不得 archive。

#### Scenario: 匿名矩阵可审计

- **WHEN** 团队执行普通、中型和异常 fixture 矩阵
- **THEN** 每个 manifest 的大小与形状可复核，普通/中型 F0 源码闪现或源码复制/只读/末列/AX 失败为 blocking，异常增强失败仅 report-only，源码降级失败仍为 blocking
