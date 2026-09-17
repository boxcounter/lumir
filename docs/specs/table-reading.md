# Foundation Table Reading 质量合同

- 状态：生效中的质量合同（M142 已按 Alex 裁决收窄短行口径至 GFM §4.10，见 §2/§9）；其 OpenSpec 提案 `foundation-table-reading` 已于 2026-09-17 **撤回**（未过节点 1，见该 change 的撤回记录），本合同全文继续作为仓内权威合同与实现依据
- 产品定位：Markdown 表格是 Lumir Foundation 的关键阅读能力；产品定位、ACP、MCP、Thread、Session、Agent 继续冻结
- 授权：用户已授权 tower 在本合同范围内代为裁决实现边界与候选预算；绝对性能阈值仍须单独节点确认
- 范围：本地 Markdown pipe table 的首次呈现、阅读、滚动、选择复制、只读保护、可访问性、增量构建与失败证据；不实现产品代码或专用表格编辑器
- 上位合同：[Foundation Markdown 质量合同](foundation-markdown.md)、[性能测量方法学](perf-measurement.md)、[ADR 0004](../adr/0004-development-and-openness-strategy.md)
- 可行性证据：[M72 table probe](../../openspec/changes/archive/2026-09-17-withdrawn-complete-markdown-reading/table-probe72.md)；M72 证明公开 CodeMirror 扩展路线可行，不证明生产实现、列宽或性能预算已通过

## 1. 证据边界与对象分层

验收单位是单个 pipe table 的 UTF-8 源码字节数（从表头首字符到末行末字符，包含 delimiter、pipe、转义和换行）。文档总大小、单表大小、行数、列数和最长单元格必须分别记录，不能以文档大小代替表格形状。

| 层级 | 单表源码大小或形状 | F0 合同 | 后续增强 |
|---|---:|---|---|
| 普通 | ≤16 KiB，且不属于极端形状 | 首屏相交部分直接显示最终表格；不得先显示朴素源码再切换 | 完整 correctness、滚动、复制、AX 与只读验收均为 blocking |
| 中型 | >16–64 KiB，且不属于极端形状 | 与普通表相同：首屏相交部分必须是最终表格；不得以尺寸为由源码闪现 | 非首屏行可增量物化，但滚入可见时必须完成最终呈现 |
| 异常 | >64 KiB，或属于极端形状 | F0 可以显示完整、连续、可选择的原始 Markdown 源码，并明确标示表格阅读降级；不得白屏、截断、丢字符或无限 loading | 表格增强为 report-only；失败不阻断 Foundation 出口，但必须保留 evidence 并进入后续裁决 |

“极端形状”指大小不足以表达其风险的表格，例如异常多列、异常多行、单行或单元格极长、delimiter/数据行极端不均衡。具体列数、行数和单元格阈值必须依据 M88 脱敏画像与代表 fixture manifest 在节点 1 裁决；在此之前，测试必须报告这些维度，不得私设百分比并声称代表真实 vault。M72 的 4 列、14,001 行和固定 240 CSS px 是压力实验条件，不是画像统计。

M88 匿名调查摘要是本合同的输入。仓库当前未保存可复核的 M88 summary，因此本版不声明表格频率、列数、行数或覆盖率数字；收到脱敏 summary 后，只把不可逆的分布结论转化为 fixture 优先级，不提交真实 vault 原文、标题、路径、实体、标签或 URL。

## 2. 语法、矩形性与完整源码降级

支持边界服从项目锁定的 GitHub Flavored Markdown（GFM）parser，不另造第二套表格语法：

- 支持有或无首尾 pipe 的 pipe table；
- 支持默认、左、中、右四种列对齐；`:---`、`:---:`、`---:` 分别表达左、中、右，无冒号为默认对齐；
- 空格空槽与 `||` 零宽空槽都必须占据原列，不得使后续单元格左移；
- escaped pipe `\|` 按 parser 边界保留为单元格内容；反引号内未转义 pipe 若被当前 parser 拆列，不得由 renderer 悄悄改写语法；
- 引用或列表中的表格只在 parser 明确产生完整 `Table` 范围时增强；容器前缀、缩进和原始换行必须保持可选择、可复制；
- parser 产生 `Table` 后仍须独立验证矩形性。表头、delimiter 和每个数据行按源码槽位恢复；空槽不能只依赖 `TableCell` 节点，因为 parser 可能不为其创建节点；
- **短行尾部补空列**：数据行的 cell 数少于表头列数时，按 GFM spec §4.10「If there are a number of cells fewer than the number of cells in the header row, empty cells are inserted」在尾部补空 cell，整表按矩形呈现。补出的空 cell 就是空 cell——不填占位符、不加「此处缺列」之类的标记，与 GitHub、Obsidian 打开同一份文件的表现一致；源文件一字不改（§5 只读合同不变）；
- 数据行 cell 数**多于**表头列数仍视为非矩形，整块显示完整源码：GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突。表头/delimiter 列数不一致、范围不完整、槽位不能安全映射同样整块降级。系统不得丢列、截断或猜测修复——按本节补空列是 GFM 规范行为，不属于「猜测修复」。

本节「短行补空列 / 多列整块降级」的口径由 Alex 于 2026-09-16 裁决采纳（原始二选一裁决见 backlog「已核销」的 GFM 短行条目）：它收窄了本文件原「数据行少列或多列一律整块降级、不得补列」的写法，只放开少列一侧；「不得丢列」与整块降级的其余条件不变。

源码降级必须覆盖整个候选表格范围，并保持与前后正文的连续选择。它是明确的安全状态，不是把部分 cell widget 与部分源码混排成看似完成的表格（与 §2 的短行补空列不同：补空列是整表按矩形呈现，不存在半 widget 半源码的混排）。

## 3. 最终呈现与列规则

普通和中型表格只要与打开时首屏相交，F0 就必须呈现最终表格。最终表格至少满足：

- 表头、数据行和单元格边界可辨识；同一列共享对齐和布局规则；
- 四种对齐在表头与数据 cell 上一致，空槽有稳定占位；
- 字符、escaped pipe、源码换行语义和未增强 inline 内容不丢失；未支持的 inline Markdown 可显示可读源码，但不得执行 cell 内 HTML；
- 同一文档版本、字体、主题和 viewport 条件下，首屏、滚入中部、滚回顶部及 resize 后列规则稳定；
- 三套真实产品主题、字体缩放和窄窗均使用 theme token 与实际测量，不把 M72 的 light/dark/eink probe 颜色变体冒充产品主题验收。

生产列宽必须根据内容、字体、主题和可用阅读栏建立有界共享策略。禁止固定每列 240px；禁止用单元格内容撑宽整页；禁止永久裁切或省略末列。

M119 起列宽与表框宽度收敛为统一合同（替代 M98–M110 的逐点补丁口径；不改变本文件其余语法、降级与滚动合同）：

- 表框宽度 = 内容自然宽：每列轨道恒取 max-content（`minmax(min-content, max-content)` 轨道在 max-content 表框内不收缩），单元格无固定像素上限、不折行；空槽与短内容槽保留最小占位宽度。
- 可见宽度 = min(内容自然宽, 阅读栏宽)：自然宽不超过栏宽时整表直接可见。不得为贴合栏宽而拉宽短内容表；也不得在栏宽仍有富余时对单元格强行折行——「单元格已折行而整表窄于栏宽」是缺陷状态。
- 自然宽超过栏宽的表格不收缩、不裁切：超出的列由 §4 的局部横向滚动容器完整可达，末列不得隐藏。
- 禁止给单列设与栏宽无关的固定像素上限（如历史上的 352px 封顶）：它会在栏宽未用尽时制造折行，并使表格宽度与栏宽脱钩（M119 欠宽缺陷根因）。

## 4. 宽表横滚、键盘、触控板与 AX

超出正文阅读栏的表格使用表格局部横向滚动容器。表外正文宽度和横向位置不得随表格滚动改变。

- 容器可通过自然 Tab 顺序进入和离开，具有可见焦点和可访问名称；不得用正 `tabindex` 制造焦点陷阱；
- 键盘必须能到达最右列并返回最左列；离开容器后，编辑器 selection 和正文键盘行为仍可用；
- 物理触控板横滚只移动当前表格，不横移表外正文；合成 wheel 或 Chromium 结果不能替代真实 WKWebView 触控板验收；
- resize、窄窗、滚入中部和跨多个表格时，每个表格保持独立滚动位置与可达末列；
- Accessibility（AX）树必须表达命名滚动区域及 table、header、row、cell 关系。空槽仍须有正确的行列位置；视觉隐藏 pipe 时，读屏不得失去表格结构或可理解文本。

## 5. 原始 Markdown 选择、复制与只读保护

表格阅读层建立在同一个 `EditorState.doc` 上。装饰不得复制或重写文档内容。

- 鼠标拖选、键盘扩选、局部 cell、整表、跨表与正文、全选复制均输出选择范围对应的原始 Markdown；
- 复制必须保留首尾 pipe、alignment colon、escaped pipe、空槽、容器前缀和源码换行，不输出 HTML、TSV 或视觉重排文本；
- 点击、选择、横滚、`Cmd+X`、`Cmd+V`、Delete 和任务标记交互不得在 M1 阅读态修改内存文档或磁盘文件；
- 验收必须比对 `EditorState.doc` 前后内容与自有匿名 fixture 的磁盘 hash。自有 probe 文件不变只能证明 probe，不等于生产 vault 路径已通过；
- M2 编辑继续编辑原始 Markdown 源码，并复用源码 range、selection 和保存/冲突保护合同。专用可视 cell 编辑、增删行列、拖拽列宽、公式、合并单元格和 spreadsheet 行为不在本 change。

## 6. 最小实现分层与禁止方案

实现必须保持三个边界清晰：

1. **纯 model**：只接收文档与 parser tree，产出表格范围、行列、源码槽位、对齐、矩形性、降级原因和可见行索引；不访问 DOM、主题或文件系统。
2. **公开 CodeMirror adapter**：只用 CodeMirror 公开 API，例如 `BlockWrapper`、line/mark decoration、非跨行 replace、inline widget、`visibleRanges`、`requestMeasure` 和公开事件处理；保留源码行与 selection 映射，不直接修改 CodeMirror 管理的 DOM。
3. **theme/WK 层**：负责 theme token、字体/列宽测量、局部滚动、焦点、AX 与真实 WKWebView 验收；不得反向污染 parser model。

明确拒绝：

- 固定 240px 列宽；
- 打开时同步扫描或解析全文来构建所有表格 metadata；
- 每次 viewport 更新遍历整表全部行；
- 把整张表替换为一个跨行 widget 或自管 DOM table；
- 依赖 `forceParsing` 在任意固定预算内完成，并把“通常完成”当 correctness gate；
- 从 M72 probe 导入同步全量模型、颜色变体、fixture runner 或测试专用生命周期代码。

model metadata 必须按文档版本缓存，并按字体、主题和测量条件失效。可见 decoration 只查询与 viewport 相交的行；非首屏表格在接近或进入可见区时增量准备。若 model 尚不完整，异常层可保持完整源码；普通/中型首屏不得依赖异步完成后再从源码切换。

## 7. Parser Worker 的触发条件

M76 只证明 Worker parser wrap、过期结果隔离与有界失败恢复可以实验，不是既定生产架构。Foundation 默认先使用现有增量 parser tree、缓存、行索引和可见区 adapter。

仅当匿名、代表性且单文档不超过 256 KiB 的真实 WKWebView fixture 出现下列任一可复现失败，才允许另立窄实验验证 parser worker：

- 主线程出现归因于表格 parser/model 的单次任务 `>16ms`；或
- 普通/中型首屏在正确路径与可见范围已知后持续不能满足 F0 最终表格合同。

实验必须记录输入版本、取消、obsolete response 丢弃、timeout、malformed payload、有界 retry、fatal 后新文档恢复和主线程重建成本。只有独立裁决证明收益大于序列化、复制、重建和失败复杂度后，才可提出生产化；否则删除实验接线。M76 的 full-document worker、1500ms timeout、两次 retry 和 packed tree 只是参考，不自动成为生产参数。

## 8. 真实 WK 性能端点与候选预算

性能验收必须在隔离、匿名、代表性的 Tauri/WKWebView 路径运行，普通与中型分别报告冷/热样本的 p50、p95、max；每组有效样本数 `N≥30`。计时与证据至少包含：

- **Table F0**：用户点击文件树条目 → 正确路径与文档身份确认 → 首屏相交的普通/中型表格最终 model 与 decoration ready → 下一次 `requestAnimationFrame` paint。朴素源码闪现、旧文档冒充或仅 parser/IO 完成均为失败；
- **滚入可见 paint**：滚动开始 → 目标普通/中型表格行进入预取/可见边界 → 该可见行按稳定列规则完成最终 decoration → 下一次 `requestAnimationFrame` paint；
- **主线程任务**：用 Long Tasks 或等价 WK instrumentation 记录打开、滚动、model、decoration、measure 与 paint 前的任务归因。必须保存所有 `>16ms` 任务；
- **failure evidence**：保存 fixture manifest、app/commit、WK/OS、窗口与主题、冷/热条件、端点事件、屏幕录制或逐帧证据、AX snapshot、long-task trace、console/native log、实际/预期差异和非零测试退出。失败样本不得被重跑覆盖。

待节点裁决的推荐候选值是：普通/中型 Table F0 `p95 ≤100ms`；滚入可见 paint `p95 ≤50ms`；表格 model/adapter 单次主线程任务目标 `≤8ms`，且不得出现 `>16ms` 任务。它们是 M88 建议的待验证候选，不是已批准预算，也没有现有 perf 通过证据。节点必须以真实 WK 数据单独批准、修订或拒绝，合同不得先写成“已达标”。

M72 的约 84.5–93ms 同步 metadata、27/14,001 DOM 行、Chromium 12/12 和真实 WK 局部交互证明只属于可行性 evidence；它们不能证明上述候选值、生产主题、生产缓存或真实 vault 路径通过。ADR 的 1 MiB IO 指标也不能代替 Table F0。

## 9. Fixture 与出口矩阵

匿名 fixture 至少覆盖：

- 有/无首尾 pipe、四种对齐、空格空槽、`||` 零宽槽、escaped pipe；
- 反引号内未转义 pipe、表头/delimiter 不同列数、数据行少列（尾部补空列）与多列（整块降级）、解析中断；
- quote 内、list 内、嵌套列表邻接、表格前后正文与连续多表；
- 宽表、超长 cell、普通/中型首屏相交、非首屏滚入、异常 >64 KiB、超高/超宽 manifest；
- 三套真实产品主题、窄/宽 viewport、字体缩放、resize、首帧和滚回稳定性；
- 鼠标、键盘、触控板、partial/table/cross/all copy、只读反例、AX 与 fault injection。

每个 fixture manifest 记录 UTF-8 bytes、单表 bytes、行数、列数、最长行/cell、容器上下文、预期矩形性、预期 F0 状态和是否 report-only。普通/中型任一 F0 源码闪现、列错位、丢字符、末列不可达、copy 不等于源码或文档被修改均为 blocking failure。异常增强失败仅 report-only，但源码降级不完整、不连续、不可选择或未明确标示仍为 blocking failure。

出口顺序：

1. OpenSpec 节点 1 独立评审并裁决 M88 脱敏画像输入、极端形状边界和性能候选值；
2. 实现与匿名 fixture 验收；真实 WK Table F0、滚入 paint、主线程任务、键盘/触控板、AX、复制与磁盘只读证据完整；
3. `pnpm build` 与 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过；
4. 新增相对链接目标逐一存在，`git diff --check`、scope diff 与失败产物检查通过；
5. 独立 review 与节点 2 通过后方可 archive。

本合同是 living contract。实现证据若推翻分层、语法或性能假设，必须回到 proposal 修订并重新评审，不得通过放宽测试、永久源码回退或把异常标记扩大到普通/中型来规避失败。
