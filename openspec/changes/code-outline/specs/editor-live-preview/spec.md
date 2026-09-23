## ADDED Requirements

### Requirement: 代码文件的结构解析（语言分层注册表）

只读 code 模式（见「单内核双模式落地」）下的**结构信息** SHALL 由一张单一来源的**分层注册表**裁决：
「语言 → 是否有可用的结构解析器」。该表 SHALL 与既有的语言表（`src/preview/code.ts` 的 `LANGUAGES`，
键类型为 `preview/attachments.ts` 推导出的 `CodeLanguage`）同源、逐语言一一对应，MUST NOT 在消费者侧
（大纲、标识符高亮等）另写一份语言或能力清单。表的内容 SHALL 按下面两条判据裁决，两条都可逐门复核：

1. **有官方 `@lezer` 语法**（与既有依赖体系同源、随 CodeMirror 生态维护）。社区单维护者包 MUST NOT
   进入本表。
2. **该语法在普通代码上无阻断性缺陷**。`@lezer/yaml` SHALL NOT 进入本表：它在「文件以空行 + 注释行
   开头、其后是区块映射」时产出越界区间（`Document [65536, 11)`），使按位置取节点的消费者失效——这是
   实测复现的缺陷，不是推测。凡进入本表的语法都 SHALL 有实测证据支撑（探针读数与命令留档在 change
   的 evidence 目录）。

裁决结论 SHALL 至少区分三档并写进本条：**符号大纲 + 变量高亮**（javascript / typescript / python /
rust / go / c / cpp / java）、**只做大纲**（css / scss）、**不支持**（ruby / shell / toml / yaml / swift /
kotlin / lua / sql / json / html / xml）。不支持的档 SHALL 得到的处置是「没有结构可用」，MUST NOT
降级为文本级近似（正则、缩进、关键字扫描一律禁止）。

解析时机与缓存 SHALL 满足：① 结构解析 SHALL 只在**首次需要结构时**发生（每个消费者
各自定义「什么时候需要」——本 change 的消费者是「首次展开大纲」；同一份文档的解析结果在各消费者之间共用，
不重复解析），MUST NOT 在打开文件的路径上无条件解析，MUST NOT 在光标 / 滚动路径上解析；② 解析结果 SHALL
按「当前文档」缓存复用，MUST NOT 在同一文档上重复解析；③ 换文件、外部重载、切换标签 SHALL 使缓存失效。
本条的前提是 **code 模式只读**（`editor-live-preview` 的只读合同）：文档在打开期间不变，缓存因此无须
失效策略以外的维护；若将来 code 模式可编辑，本条 SHALL 先修订再实现。

**着色管线 MUST NOT 因本能力改变**：code 模式的着色来源 SHALL 仍是既有语言表上的 `StreamLanguage`
（`@codemirror/legacy-modes`），「Markdown 渲染保真」第 2 款的「同一段代码在围栏与整文件打开时得到同一
套 tag 与配色」SHALL 继续逐字成立。因此结构解析 MUST NOT 以占用 CM 语言位（`Language` facet）的方式
引入——同一 `EditorState` 里只有第一个 `Language` 生效；也不 MUST NOT 借语法包自带的 `styleTags` 去
改动着色。语法包在本条里**只贡献语法树本身**。

新增依赖 SHALL 限于结构解析所需的官方语法包，其清单、版本与体积 SHALL 记录在 change 的 design 与
实现 PR 里（逐包给 min / gzip 读数与许可核对结果）。性能与内存 SHALL 在实现期于**真机 / 产品端点**上
复测（大口径见 `perf-measurement`）：不在打开路径上新增全文解析是硬要求，而首次结构解析的耗时与解析
结果的常驻占用 SHALL 如实记录——不达标就写不达标，MUST NOT 用 headless 探针读数充当达标证据。

#### Scenario: 分档裁决逐语言可复核

- **WHEN** 在一份 `.py` 文件（受支持档）与一份 `.yaml` / `.lua` / `.sql` 文件（不支持档）里按 `⌘⇧O`
- **THEN** 前者列出符号条目；后者给「暂不支持大纲」的提示且不展开浮层；两侧都 MUST NOT 出现任何由文本
  匹配猜出来的条目

#### Scenario: 着色与围栏的一致性不受影响

- **WHEN** 同一段 javascript 分别在只读 `.js` 文件（code 模式）与 md 围栏 ```js 代码块里渲染
- **THEN** 两侧仍得到同一套 tag 与同一组色值（口径同「Markdown 渲染保真」第 2 款）；code 模式的着色来源
  仍是既有语言表上的 `StreamLanguage`，结构解析的引入 MUST NOT 改变任何 token 的取色

#### Scenario: 打开大文件不在打开路径上解析

- **WHEN** 打开一份 1MB 的代码文件（受支持语言）后不做任何操作
- **THEN** 没有发生全文结构解析（打开路径上没有该工作）；首次按 `⌘⇧O` 时才解析，且解析结果被缓存

#### Scenario: 解析结果缓存复用

- **WHEN** 在同一份文件上先按 `⌘⇧O`、关闭浮层、再按一次 `⌘⇧O`
- **THEN** 第二次不重新解析（复用缓存），条目与第一次逐条相同；切换文件后再切回，缓存按「换文件即失效」
  的规则重建

#### Scenario: yaml 不因「有官方语法」而进入结构表

- **WHEN** 核对分层注册表里 yaml 的档位，并用最小复现（文件以空行 + 注释行开头，其后一行 `key: 1`）
  跑一次该语法的解析
- **THEN** yaml 在不支持档；复现证实该语法产出越界区间（`Document [65536, 11)`）从而使按位置取节点的
  消费者失效；MUST NOT 用「它是官方语法」为理由把它放进支持档

#### Scenario: 分层表只有一份

- **WHEN** 查阅代码模式的结构能力来源
- **THEN** 存在且只存在一份「语言 → 结构解析器 / 支持档」的表，内容与既有语言表的键一一对应；消费者
  （大纲、标识符高亮）只读它，MUST NOT 各自维护一份语言或能力清单（新增 / 删除语言时两侧同时生效）
