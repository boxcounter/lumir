# Design: 保留源码行的列表与表格阅读装饰

## Context

本文件是节点 1 待评审方案，不是已实现能力。调查基于当前锁定依赖与源码：

- `src/editor.ts:123` 使用 `markdown({ base: markdownLanguage, extensions: [GFM] })`；`194–196` 保留 `readOnly`、可选择的 content DOM 和 line wrapping。
- `src/preview/livePreview.ts:158–173` 只遍历 visibleRanges；`324–330` 只替换无序 ListMark。`src/preview/theme.ts:45` 仅给 bullet 配色。
- 锁定 `@lezer/markdown 1.7.2` 的 `dist/index.js:2054–2159` 提供 Table/TableHeader/TableRow/TableCell/TableDelimiter；`2161–2187` 提供 Task/TaskMarker。GFM 已含这些扩展，无须新增 parser 或库。
- 锁定 `@codemirror/view 6.43.11` 的 `dist/index.d.ts:358–395,1307–1330` 公开 `BlockWrapper.create/set` 与 `EditorView.blockWrappers`。同处明确：视图函数提供的 decorations 不得新增 block widget 或跨换行 replace。`requestMeasure` 是公开布局测量入口（同文件 `430–448`）。这些依据可在 `pnpm install --frozen-lockfile` 后核对。

已运行与 editor 相同配置的 parser 探针：带/不带首尾 pipe 的表格、冒号对齐行和转义 pipe 均产生 Table；表头与分隔行列数不同产生 Paragraph。数据行少列/多列仍产生 Table，不能把「parser 识别」等同于矩形。空单元格可能没有 TableCell 节点；应从行的 TableDelimiter 边界补空槽。未转义的 pipe 即使位于反引号内也会拆列，不另起一套不同的解析规则。

modern-web-guidance 已检索并读取 `html`、`css-layout`；采用逻辑尺寸、`min-inline-size: 0`、`overflow: auto`、可聚焦滚动区与自然焦点顺序，不引入新 CSS 特性或 polyfill。指南不是 CM 可行性证明，真实 WKWebView 仍是必要验收。

## Decisions

### 1. 列表仍使用源码行与 decoration

从语法树的 ListItem / BulletList / OrderedList / ListMark / TaskMarker 定位父列表、层级和正文起点。不得仅以行首正则判断，避免误伤代码块和普通段落。

同一列表同级共享标记区宽度；宽度覆盖该组最长原始编号及任务标记，普通项也留同等空间。有序编号显示源码数字而非自动连续编号。以行 decoration 和标记 widget/mark 区分标记区与正文区，正文使用逻辑方向 padding 与首行负缩进实现悬挂；不要给整个编辑器设置文本缩进。嵌套项目独立计算本级起点，并相对父正文缩进。源码物理续行和屏幕软换行都对齐到所属项正文，不把嵌套代码块套成正文。

组级元数据按文档/语法树版本缓存，不在每次选区变化时扫描整份文档。最终共享宽度依据该组实际最长标记及必要的标记与正文间距确定；短编号组不为不存在的最长编号预留容量，不采用所有短列表固定 `14.5ch` 的方案。若需测字宽，使用 `requestMeasure`，主题、字体与窗口变化后失效。只为可见行生成 decorations。

组元数据尚不完整时允许暂呈可读源码，不根据已解析前缀反复猜测组宽。通过公开 parser 的异步增量推进取得完整组元数据后，一次切换为最终紧凑对齐；不得在主线程同步强制完整组解析，也不得永久停留在源码回退。允许源码阶段到完成装饰阶段的一次布局变化。完整元数据就绪后，在同一文档与相同字体/主题/窗口条件下，滚动和选区变化不得重复触发布局切换或因新编号进入视口而改变正文起点；合法的字体/主题/窗口失效仍须重新测量并稳定。

**2026-09-06 列表修订裁决（M73）**：tower 依 Alex 已授予的本轮裁决权限，明确拒绝固定 `14.5ch` 占短列表窄栏约 30% 宽度的取舍，选择按实际标记紧凑布局。tower 允许元数据不完整时暂呈源码，异步完整后一次切最终对齐，明确将稳定约束限定到完成阶段，不要求从源码首帧到完成装饰绝对零位移。此为对原稳定约束的显式修订；**本路线须独立 review 通过后才实施**，不是本次文档更新即授权改代码。不改变表格前置实验、节点 2 或 M72 锁屏阻塞。

列表修订验收须覆盖：可控 partial→complete 解析阶段及最终宽度；最长原编号和任务项仅出现在组末端时标记完整且不与正文重叠；短编号窄栏的实际标记包围盒、必要间距与剩余正文宽度，拒绝固定容量冒充紧凑；完整后滚出/滚入、定位中部及选区变化的正文起点稳定（误差不超过 1 CSS px）。测试必须区分允许的一次完成切换与禁止的完成后反复跳动，并验证受支持组最终完成装饰而非永久源码回退。

### 2. 表格优先采用公开 BlockWrapper，而非整表 replace widget

先验证 `EditorView.blockWrappers` 包裹现有源码行的方案：外层 wrapper 是有可访问名称、可聚焦的横向滚动区，内层提供表格/行组结构；行 decoration 提供表头/数据行身份，cell mark 提供单元格边界。CM 行节点不能任意改成 `tr`，因此采用合法 DOM 与适当 table/row/columnheader/cell 可访问语义，不在 `table` 内直接插入非法 `div`。不直接改写 CM 管理的 DOM。

使用共享列尺寸的 CSS 布局；列数来自表头，宽表在 wrapper 内滚动，不传递到正文阅读栏。通过非跨行 replace 隐藏 pipe 与分隔标记，必要的空单元格用零宽位置的 inline widget 占槽。行内内容先按可读源码保留，表格区域不再被既有 emphasis/image/wikilink 装饰重复消费。冒号仅从表格分隔行提取为列对齐，不执行 HTML、不经 innerHTML 解析文档内容。

Table 节点范围与每行 cell 源码范围是唯一位置依据。缓存列数、对齐、矩形性等元数据；只为可见表格行构建 cell decorations，不能打开文件就全量物化所有表格 DOM。语法树尚未覆盖完整表格时保留源码，随 parser 更新完成装饰，不同步强制全文件解析。滚入表格中部必须能恢复所属表头与列规则。对大型单表验证元数据扫描和虚拟视口的耗时，不能把「一个表格」当作无限制扫描许可。

**前置可行性验证**：公开 API 的存在已核实，但 wrapper 在 CM 虚拟视口下的列宽稳定、空槽布局、行高测量、可访问语义与选择映射尚未实测。节点 1 后先做最小真实 WKWebView 验证，再扩展完整实现。失败则停止实现并提交修订设计与必要的 spec 裁决；不得偷偷切换成全量 StateField 表格 widget，也不得以永久源码回退代替受支持表格验收。若跨行 block replace 确实必要，须明确新的构建边界、选择/复制方案和性能证据，并重新评审既有视口增量约束。

### 3. 明确语法和失败边界

只格式化当前 parser 识别的矩形 pipe 表格（包括列表/引用内由 parser 识别的表格）；头部分隔列数相等，数据行保留空槽后与表头列数相等。少列、多列或无法安全确定边界的表格整块回退可读源码，不丢弃多余内容、不自动补写原文。未识别为 Table 的文本继续沿用既有普通 Markdown 行为，不猜测修复。

转义 pipe 按 parser 边界保留在原单元格；基础范围不保证隐藏所有单元格内 Markdown 标记。复杂表格与 HTML 仅展示源码。任务项只展示状态，不提供可写 checkbox。

### 4. 选择与复制沿用原始文档

保留 CM 文档文本和选区映射，不以 DOM 的展示文字重组剪贴板。全选/复制、整表选择、跨表选择、表格中局部选择均须验证，复制内容等于所选源码范围（沿用 CM 既有换行序列约定），包含 pipe、对齐冒号、转义与列表标记。若 widget/滚动容器让焦点离开 contentDOM，需在公开事件扩展内恢复正确的 CM 选择/复制语义；不得把整表 HTML 或 tab 分隔输出冒充源码复制。剪切、粘贴、Delete、输入及任务点击不能改动 `EditorState.doc` 或磁盘文件。

## Planned Files

- `src/preview/livePreview.ts`：接入列表/表格范围识别，避免表内重复装饰；保留 visibleRanges 策略。
- `src/preview/theme.ts`：仅新增局部列表/表格布局规则，沿用主题 token；不恢复或重裁正文首行缩进。
- 如复杂度需要，新增 `src/preview/lists.ts`、`src/preview/tables.ts` 分离纯范围模型与公开扩展。
- `tests/visual/`：沿用现有 Playwright 子项目增加 parser/行为/几何断言与 fixture。若需新增真实 WK 的验收辅助，只在节点 1 批准后确定最小范围；不改冻结原型。
- 本轮不改上述实现文件、依赖、living spec 或历史 archive。

## Validation

- Parser fixture：`- / + / *`、有序 `9./10./100.` 与 `)` 标记、混合任务项、两层以上嵌套、物理续行、代码排除；表格四种对齐（默认/左/中/右）、空槽、无首尾 pipe、转义 pipe、反引号内未转义 pipe、非矩形、引用/列表内表格。
- 几何断言：三套主题，宽/窄阅读栏；同组正文 x 坐标、软换行 x 坐标误差不超过 1 CSS px；多位序号不重叠；表格列边界跨行一致，最右列可滚入可见区，正文宽度不变。覆盖 resize、滚出/滚入、直接定位到表格中部。
- 真实 Tauri WKWebView：实际打开 Markdown 文件，键盘与触控板横滚、焦点进出、鼠标/键盘选择及 Cmd+A/C；粘贴至纯文本接收端与期望源码比对；交互前后比对内存文档及文件内容。截图/浏览器 DOM 检查不能替代真实选择复制。
- 执行 `pnpm build`、`pnpm --dir tests/visual test` 与既有 `.github/workflows/perf.yml` 的四项脚本和阈值检查；沿用现有基线/阈值，不借本提案放宽性能合同。额外覆盖 1MB 多列表/多表及单个大表滚动，不把现有占位 perf 结果称为真实表格达标证据。
- 本提案提交运行 OpenSpec strict 校验与文档链接/范围检查；上述实现验收待后续实施，不勾完成。
