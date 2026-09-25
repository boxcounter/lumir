# editor-live-preview 增量规格

## ADDED Requirements

### Requirement: 表格放大全屏查看

md 模式下经 live preview 渲染为 grid 的 pipe table SHALL 支持经命令 `table.toggle-fullscreen`
打开应用内全屏遮罩查看。命令的命中条件 SHALL 为下列之一：① 遮罩已打开（此时命令 = 关闭，
toggle）；② 编辑器 caret 落在一张**当前渲染为 grid** 的表内；③ 该表的滚动容器持有焦点。
命中条件不满足时命令 MUST NOT 消费事件（事件原样留给原生路径）。**降级表与非矩形表没有任何
打开路径**——它们没有 grid DOM（>64 KiB 源码或非矩形整块回退为源码的既有口径），「无入口」
SHALL 是「该表当前渲染为 grid」这一事实的结构性结果，MUST NOT 用降级提示或「强制放大」旁路模拟。

全屏内容 SHALL 是该表打开那一刻渲染态 grid 的**只读快照副本**（含 cell 内已渲染的链接 / 行内代码 /
图片等 inline 形态），SHALL 由深克隆既有渲染 DOM 得到，MUST NOT 搬动 CM 管理的原 DOM 节点，
MUST NOT 从源码切片重建第二套呈现口径（那会丢掉全部 inline 渲染）。快照只读 SHALL 是结构性的
（克隆不带事件监听、不在编辑器 contenteditable 子树内），MUST NOT 以开关模拟。快照内表格 SHALL 按
自然尺寸呈现、不缩放不压缩，超出遮罩可视区的部分由遮罩内容器双向滚动承载。

遮罩 SHALL 覆盖窗口内容区并定位在文档流之外（打开与关闭 MUST NOT 引起文档区几何变化），SHALL 是
模态层：`role="dialog"` + `aria-modal="true"`，打开即持有焦点，持焦期间 `editor` 作用域的键
MUST NOT 穿透到文档，`Tab` SHALL 留在遮罩内；读屏名 SHALL 复用表格容器既有标签的同一来源
（`Markdown 表格 N`），MUST NOT 另写一份字面量。关闭路径 SHALL 有四条：`Esc`（遮罩上就地消费，
复用键位层 token 归一化，MUST NOT 为同一物理组合在统一键位表注册第二条绑定）、点击遮罩
（表格以外的区域）、再次执行 `table.toggle-fullscreen`（toggle）、焦点离开遮罩（`blur` 兜底，
MUST NOT 抢焦点）；四条 SHALL 回到同一个关闭实现，前三条关闭后焦点 SHALL 交还编辑器。
打开与关闭 SHALL NOT 改写文档（`EditorState.doc` 与磁盘文件逐字节不变，ADR 0003 §3）、
SHALL NOT 改变选区或光标落点；表格的选区显露口径本 change 不加不减。文档代际变化（外部修改
重载）时遮罩 SHALL 关闭且 MUST NOT 抢焦点（视同 `blur` 兜底）——MUST NOT 留下「遮罩里是旧表、
文档里已是新表」的状态。

遮罩与快照的样式 MUST 只取既有 design token（`--scrim` / `--preview-bg` / `--border` /
`--shadow-raise` / `--r10` 等），MUST NOT 新增 token 与组件级色值；三主题（light / dark / eink）
SHALL 由 token 体系自然成立，eink 按既有浮层规则（无阴影、实心黑框升级线宽）。

#### Scenario: 打开、快照与四条关闭路径

- **WHEN** caret 在一张已渲染 grid 的表内，执行 `table.toggle-fullscreen`；随后依次按四组动作验证：
  按 `Esc`、再次打开后点击表格以外的遮罩区域、再次打开后再执行一次同一命令、再次打开后把焦点移到
  遮罩之外
- **THEN** 每次打开时遮罩可见且其中的表格快照渲染盒宽高非零、内容与文档内表格可见文本逐字节一致；
  四条路径都让遮罩从可见变为不可见；前三条关闭后焦点回到编辑器（随后的 `⌃D` 真的删掉一个字符）；
  `blur` 路径关闭且不抢焦点；全程文档内容与选区逐字节 / 逐值不变

#### Scenario: 降级表与非矩形表没有打开路径

- **WHEN** 在同一份文档里，caret 先后落在一张降级表（>64 KiB 源码）与一张非矩形表内，分别执行
  `table.toggle-fullscreen`；随后 caret 移进同文档里一张正常渲染的表再执行一次
- **THEN** 前两次都不出现遮罩、事件不被消费（原样留给原生路径）、不出现任何提示；最后一次正常
  打开遮罩——正观测保证「不出现」不是恒真

#### Scenario: 遮罩持焦期间编辑键不穿透

- **WHEN** 打开遮罩后依次按 `⌃D`、`⌃K`、`⌃A`、`Tab` 与若干字符键
- **THEN** 文档内容与光标位置逐字节不变（编辑键不穿透，`Tab` 不把焦点送出遮罩），遮罩仍持有焦点

#### Scenario: 快照保真——inline 形态与自然尺寸

- **WHEN** 打开一张 cell 内含行内代码、链接与图片引用的表的全屏遮罩；再对一张自然宽超过遮罩可用
  宽度的宽表打开遮罩
- **THEN** 前者的快照里行内代码 / 链接标记 / 图片保持渲染形态（不退回源码）；后者的快照按自然尺寸
  呈现且遮罩内容器横向可滚（不缩放、不压缩）

#### Scenario: 文档代际变化时遮罩退场

- **WHEN** 遮罩打开期间文档因外部修改重载（文档代际推进）
- **THEN** 遮罩关闭且不抢焦点（焦点去向由重载链路自身决定），不留「遮罩里是旧表」的状态

### Requirement: 全屏查看的快照与性能边界

全屏遮罩的 DOM SHALL 惰性建立（首次打开时建，MUST NOT 在文档打开路径上预建）；打开与关闭
MUST NOT 在键入路径与文档打开路径上新增解析或测量工作（ADR 0002 §6 的性能合同不因本能力放宽）。
打开动作 MUST NOT 触发全文档扫描——表格发现保持视口有界（既有 `tableDiscoveryRange` 纪律），
命令的表格定位 SHALL 复用缓存的表格模型。快照 MUST NOT 新增任何字节读取路径（不调附件读取、
不动 Rust 侧）；快照成本由「可渲染表源码 ≤64 KiB」的既有降级阈值天然有界，本 change 不设新上限。

已知边界（如实记录，本版不做）：打开路径只有命令（默认不绑键，用户经 `[keys]` 绑定后生效；
鼠标路径与默认绑键的取舍见 change 的 proposal 裁决点 3）；快照内的图片不响应双击再放大
（快照只读语义的应有之义）；无文档内多表导航；遮罩内表格双向滚动的手感归 dogfood 验收。

#### Scenario: 文档打开路径零新增

- **WHEN** 打开一份含多张表格的文档但一次都不执行 `table.toggle-fullscreen`，读 DOM
- **THEN** 文档的 DOM 里不存在全屏遮罩节点（惰性建立）；打开路径的解析与测量工作与本能力引入前
  一致

#### Scenario: 定位不触发全文档扫描

- **WHEN** 在一份大文档中部的一张表内执行 `table.toggle-fullscreen`
- **THEN** 表格定位经既有视口有界的缓存模型完成（无全文档表格扫描），遮罩正常打开
