# Foundation Markdown 质量合同

- 状态：生效中的质量合同，M1 之后由多个 mission 的实现与门禁承载；其 OpenSpec 提案 `foundation-markdown-quality` 已于 2026-09-17 **撤回**（未过节点 1，见该 change 的撤回记录），本合同全文继续作为仓内权威合同与实现依据
- 角色：Alex Lee（评审/裁决），AI agent（起草）
- 范围：Markdown 本地打开、阅读渲染、编辑保存的基础质量；不定义产品定位或协作对象
- 依据：[ADR 0004](../adr/0004-development-and-openness-strategy.md)、[性能测量方法学](perf-measurement.md)；本合同按 M77 匿名调查摘要输入制定，完整统计不作为仓库制品。M78 首帧/覆盖审计结论已转化为本合同端点与验收要求，审计原文不作为仓库附件。

## 1. 质量边界

Foundation 的验收对象是用户从本地文件打开到阅读、编辑、保存的可复现路径。它不把 Thread、Session、Agent、ACP、MCP、编辑点或产品定位纳入合同。基础阅读保持源码不变，渲染层不得把装饰写回文件。

“打开完成”分为两个端点：

- **基础首帧（F0）**：点击文件树条目后，已确认正确路径和文档；可见区域已完成 Markdown 基础 decoration，frontmatter（若存在）已就绪；完成一次 `requestAnimationFrame` paint。F0 不等待图片或 wikilink 的远程/跨文件资源 settle。
- **资源稳定帧（F1）**：F0 后，图片、wikilink、math（LaTeX）、mermaid 等异步资源在有限时间内成功、失败或明确降级，不得无限 pending。F1 可触发局部布局变化，但不得使基础正文永久处于 loading 或源码冒充状态。

禁止把新文件的朴素源码闪现、错误路径的旧文档、或仅完成 IO/解码的结果当作 F0。旧文档不得在新路径确认前冒充当前文档。

## 2. 首帧与渲染合同

一次打开验收必须记录：点击时间、请求路径、实际文档路径、首个可见文档身份、frontmatter 状态、可见 decoration 状态、F0 `rAF` 时间、F1 settle 结果。路径切换和快速连续点击必须以最后一次有效请求为准，过期响应不得覆盖当前文档。

F0 的 correctness gate 依次检查：

1. 目标路径存在且与点击条目一致；
2. 文档身份已绑定到该路径；
3. 可见区域的 heading、列表、quote、code、table、link 基础 decoration 已生成；
4. frontmatter 若存在则显示最终约定的 properties/frontmatter 形态，若不存在则不能等待不存在的元数据；
5. 页面完成一次 `requestAnimationFrame` paint。

F1 必须为图片、wikilink、math、mermaid 等失败资源提供成功、失败占位或清晰源码/链接降级状态。任何异步资源均须有超时或取消路径。异步 settle 不得阻塞 F0。

## 3. 常见 Markdown 覆盖

真实代表 fixture 必须覆盖下列组合，而非只测单独语法：

- P0：heading、段落、无序/有序/任务列表、嵌套列表、quote、fenced code、table、link；列表项目内的 strong、em、strike、inline code、link；
- P1：wikilink、frontmatter、tags、callout；
- P1.5：embed、image（含失败资源）；
- P2：dataview、canvas。

P0 是 Foundation 的基础阅读必验。P1/P1.5 是 Foundation 内的实现顺序，不是永久不支持；其行为必须有稳定渲染或明确降级。P2 保持延后实现/兼容性裁决，需单独产品裁决，不得以未实现的占位冒充已支持。

Math（LaTeX）与 Mermaid 按用户裁决为 Foundation 确定需求，不再属于 P2 延后项；其要求边界为：

- **渲染义务**：行内与块级 LaTeX 数学、mermaid 代码块必须渲染为可读图形结果；
- **失败降级**：解析或渲染失败时必须回退为可读源码或明确失败状态，不得伪装已支持、空白展示或无限 loading；
- **源码保护**：阅读、选择、复制输出的原始 Markdown 源码保持不变；
- **首帧边界**：math/mermaid 渲染不得阻塞基础首帧 F0，其成功、失败或降级 settle 纳入 F1 计时与降级合同。

基础阅读必须保留原始编号、任务状态、嵌套层级、空表格槽位、表格列对齐、转义 pipe、链接目标和源码换行。非矩形或无法安全识别的表格整块回退为可读源码，不得猜测修复。

## 4. 源码、编辑与失败保护

- 阅读、选择、复制不得修改内存文档或磁盘文件；全选、跨结构和局部选择复制均输出原始 Markdown，不输出 HTML 或重组后的 TSV。
- 编辑态仍使用同一编辑器文档，源码与预览切换不得丢失文本或 selection；保存后重开必须得到保存内容。
- 保存失败必须保留 dirty 内容、显示可理解的失败状态并允许重试或另存；不得静默清 dirty 或覆盖旧文件。
- 文件在编辑期间被外部修改时，保存必须检测版本/冲突；不安全时暂停并保留本地内容与外部内容，提供重新处理、差异查看或手动协调，不静默覆盖任一方。
- 退出或切换文件不得静默丢弃 dirty 内容；未保存保护属于出口。
- 本合同不要求可视表格单元格编辑、IDE 能力、插件平台或协作 Agent 写入。

## 5. 可访问性

键盘可到达文件树、编辑器、链接、表格横向滚动区和失败资源状态。宽表在局部可聚焦横向滚动容器内展示，不撑宽普通正文；键盘与触控板均可访问最右列。滚动区有可访问名称、焦点进入/离开路径以及表头—行—单元格关系。装饰隐藏标记时仍保留可理解的读屏文本或等价语义。焦点、selection、缩放和高对比度不得使信息不可达。

## 6. 性能端点与证据边界

Foundation 性能测量必须区分：

- **真实 F0**：用户点击 → 正确文档路径确认 → 可见 decoration/frontmatter ready → 一次 `rAF` paint。该端点应在真实 Tauri/WKWebView 代表 fixture 上测量，并按冷/热打开、fixture 层级和 p95 报告。
- **真实 F1**：F0 → 图片/wikilink 等资源成功、失败或明确降级并 settle；报告 settle p95、pending 超时与布局变化。
- **现有 IO 子指标**：`open-file.mjs` 的 `fs.readFile → UTF-8 decode` 仅证明 IO+解码，不能宣布真实打开达标。
- **keypress 近似**：现有 headless CDP `keypress-to-paint` 是下界，不等价于 WKWebView 真实按键；不得凭单次 40ms 读数诊断或宣布产品达标。

ADR 0002 的冷启动 `<300ms`、keypress-to-paint `<16ms`、1MB 打开 `<100ms`、常驻内存 `<200MB` 继续有效。Foundation 不擅自发明新的绝对阈值。F0/F1 的 fixture 分层、样本数、p95 目标和预算须在真实路径可测后由独立裁决节点确定；在此之前只报告分布、端点完整性和回归，不把旧占位值当产品合同。

性能实现必须保持可见区域增量 decoration；不得因大文件或大表在打开时全量物化。超过预算时先区分路径、解析、装饰、paint 和资源 settle 的归因，禁止仅凭总耗时猜测。

## 7. 匿名 fixture 与验收矩阵

fixture 只使用匿名合成内容。不得写入真实 vault 原文、标题、路径、实体名称、真实 URL、个人标签或可逆识别片段。每个 fixture 应带 manifest：字节数、行数、语法覆盖、预期 F0/F1 状态、是否含失败资源；内容由确定性生成器产生，提交后字节稳定。

| 层级 | 大小（UTF-8 bytes） | 代表性负载 | 必验内容 | 性能用途 |
|---|---:|---|---|---|
| tiny | ≤4 KiB | 单屏混合 Markdown | P0 核心组合、源码复制、首帧、空/错资源 | correctness 与冷路径校验 |
| small | >4–16 KiB | 多段、多列表、多表、P1/P1.5、math/mermaid | P0 全组合、frontmatter、wikilink、图片失败、math/mermaid 渲染与失败降级、F0/F1 | 日常阅读；small 优先级是当前计划假设，需后续匿名 fixture 验证 |
| medium | >16–64 KiB | 长文、多级嵌套、宽/非矩形表 | 滚动增量、可访问性、selection、编辑保存/冲突 | 稳态与局部 settle |
| large | >64–256 KiB | 多结构压力文档与大表 | 正确性不降级、无全量装饰、内存/滚动/settle | 压力边界；不等同 ADR 1 MiB 合同 |

验收矩阵：

| 维度 | 必须项（Foundation 出口） | 延后项（明确不冒充完成） | 测量边界 |
|---|---|---|---|
| 打开 | F0 正确路径、无源码闪现、P0 decoration、F1 有限 settle；math/mermaid 渲染不阻塞 F0 | P2 原生 dataview/canvas（需单独产品裁决） | F0/F1 真实 Tauri/WKWebView；IO 子指标另报 |
| 阅读 | P0 组合、列表/表格/链接源码语义、滚动增量、math/mermaid 可读渲染与失败降级、源码复制不变 | dataview/canvas 高级渲染的完整交互 | 视觉 diff 不能替代源码/交互验收 |
| 编辑保存 | 输入、中文 IME、undo/redo、dirty、成功重开 | 可视表格编辑、IDE、插件 | 真实文件前后字节/版本比对 |
| 失败安全 | 资源失败提示、保存失败保留内容、冲突不覆盖 | 自动合并策略 | 注入可控失败并检查磁盘与内存文档 |
| 可访问性 | 键盘、焦点、宽表横滚、名称和语义 | 高级语法专属语义 | AX 树 + 键盘/触控板真实验收 |
| 性能 | 端点完整、样本可复现、预算经裁决 | 未裁决绝对 F0/F1 阈值 | 报 p50/p95/max；旧占位指标不得替代 |

## 8. 出口与检查

实现前必须通过 OpenSpec 节点 1。实现后必须完成真实 fixture 验收、`pnpm build`、`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、文档 link/diff 检查和独立 review。节点 2 通过前不得 archive。任何新行为若超出本合同或冻结边界，必须回到 proposal 评审，不得静默扩 scope。
