## ADDED Requirements

### Requirement: 光标可见位置与替换块指针入口

本条把既有「光标或选区触及的结构 SHALL 显露源码」口径落到 frontmatter，并补齐一直缺失的
**光标几何**不变量——它是 `docs/specs/editor-caret.md` 的 C1–C5 在 md 模式下的可验证表述。

md 模式下，编辑器自绘的光标矩形（`drawSelection()` 的 `.cm-cursor`）SHALL 落在一条**可见
文本行**的几何范围内，其高度 MUST 等于该行行盒的高度（同一字形度量下，容差 ±1px）。光标
矩形 MUST NOT 取任何被块级 replace 装饰覆盖的源范围的总高度——该范围可跨多行，其替换面
（frontmatter properties、块级公式、mermaid 图表）的高度与行高没有对应关系。若光标位置没有
任何可见文本行承载（位置落在渲染态替换块的内部或边界），系统 SHALL 在绘制前二选一：显露该
块的源码、使光标所在源行可见，或把光标移到相邻的可见文本位置；MUST NOT 在替换块的渲染面上
绘制光标。

渲染态的块级 replace 面 MUST 消费指针按下事件（MUST NOT 让原生选区滞留在
`contenteditable=false` 岛边缘），并按点击面是否有对应源码分流：有对应源码的渲染面
（frontmatter 的 properties 盒）SHALL 显露该块源码，并把空光标放在点击位置对应的源行内；
没有对应源码的合成面（折叠进 frontmatter 的 doc-title、纯装饰 padding）SHALL 只把焦点交给
编辑器，并按本条的初始光标规则把光标规范化到可见位置。任何入口 MUST NOT 改写文档
（ADR 0003 §3）。

frontmatter 块的显露判据 SHALL 与 callout 行 / 标准链接同族：选区与块源码范围**严格重叠**
即显露（`touchesSource` 口径），判据选区 MUST 取 M259 的按压快照（按压期间用按下瞬间的选区，
MUST NOT 取按压中的活选区）。空光标停在块边界、与块范围相接但无重叠时，系统 SHALL 先按本条
的初始光标规则把它规范化到可见文本位置（有正文行 → 正文首行；无 → 块内），规范化后落在
块内时按严格重叠显露；边界本身 MUST NOT 成为停留在渲染态替换块上的光标。随该口径落地，
frontmatter「选中整块时只换底色」的 selected 态 SHALL 退场（严格重叠一旦成立 widget 就
撤下，该态不可达）。

以 frontmatter 开头的 md 文档装载后，初始空光标 SHALL 位于该块之后的第一条可见文本行行首
（存在时）；不存在正文行时，编辑器获得焦点后 SHALL 显露 frontmatter 源码并把光标放到块内
可见源行。编辑器获得焦点、或已聚焦时装载新文档之后，若当前空光标位于已渲染 frontmatter 块的
边界上，系统 SHALL 按本条的规则把光标规范化到可见文本位置（有正文行 → 正文首行；无 → 块内
显露）；MUST NOT 在聚焦后留下覆盖替换块高度的光标矩形。

除上述入口外，任何事务（含 `editor.goto-line` 的行首落点、程序化选区）把空光标放到已渲染
frontmatter 块的边界上时，系统 SHALL 同样按本条的规则规范化（有正文行 → 正文首行；无 →
块内显露；垂直移动事务按下一步处理）；装载事务除外——它由装载路径显式处理。MUST NOT 让
边界光标停留在渲染态替换块上。

垂直移动（↑↓ / ⌃P⌃N，含扩选）跨越块级 replace 时，落点 SHALL 是行进方向上的**最近可见
源码行**（钳制进块内并显露出该块），MUST NOT 停在渲染态替换块的边界上；同时 MUST NOT 一次
跨过整块（M110 的既有意图保留：块不被一步跳过）。

#### Scenario: 点击 properties 盒显露源码且光标为正常行高

- **WHEN** md 文档以含多个字段的 frontmatter 开头、正文另有内容，光标先在正文中（渲染态），
  指针点击 properties 盒的上 / 中 / 下任意位置
- **THEN** properties 盒与折叠的 doc-title 一起让位、frontmatter 原文上屏，空光标落在点击
  位置对应的 YAML 源行内；`.cm-cursor` 的高度等于该源行行盒的高度（±1px），不等于点击前
  properties 盒 + doc-title 的总高度；`EditorState.doc` 与磁盘文件逐字节不变

#### Scenario: 点击 doc-title / padding 只聚焦

- **WHEN** 同上文档带 doc-title（有文件路径）、且空光标停在 frontmatter 块的边界上（`fm.from` /
  `fm.to`——装载复位或程序化落点的结果），指针点击 doc-title 的标题行、meta 行或
  frontmatter 块 outer 的纯装饰 padding
- **THEN** properties 盒与 doc-title 保持渲染，空光标规范化到 frontmatter 之后第一条可见
  正文行行首（没有正文行时显露 frontmatter 源码并把光标放到块内）；`.cm-cursor` 高度等于
  所在可见行的行盒高度（±1px）；MUST NOT 出现覆盖替换块高度的光标矩形；文档逐字节不变。
  光标本来就在别的可见行上时，合成面点击 MUST NOT 挪动它（规范化只针对边界光标）

#### Scenario: 装载与聚焦不留下替换块光标

- **WHEN** 打开一份以 frontmatter 开头的 md 文件（含只有 frontmatter、没有正文的文档），
  随后使编辑器获得焦点（点击正文 / Tab / 浮层关闭交还焦点），编辑器已聚焦时装载新文档，
  或已聚焦时切标签到一份只有 frontmatter 的文档
- **THEN** 有正文行时空光标在最前的可见正文行行首，无正文行时 frontmatter 显露为源码、
  光标落在块内可见源行；两种形态下 `.cm-cursor` 的高度都只等于所在可见源行的行盒高度，
  MUST NOT 等于 properties 盒 / doc-title 的总高度；文档逐字节不变

#### Scenario: 选区触及 frontmatter 即显露

- **WHEN** 选区经拖拽、键盘扩选或程序化设置覆盖 frontmatter 块的一部分或全部（含只有部分
  重叠）
- **THEN** 该块显露为源码（properties 盒与折叠的 doc-title 一起让位），选区底色按既有选区
  口径覆盖；选区折叠回正文、不再与块范围重叠后恢复 properties 渲染；两种状态下
  `EditorState.doc` 与磁盘文件逐字节不变

#### Scenario: 键盘垂直移动进入替换块落在可见源码行

- **WHEN** 光标位于 frontmatter 之后的第一条正文行（或块级公式 / mermaid 图表之后的正文行），
  按 ↑ / ⌃P（以及光标在块上方时按 ↓ / ⌃N 进入该块）
- **THEN** 光标不落在渲染态替换块的边界上：该块显露为源码，光标落在行进方向上最近的可见
  源码行；`.cm-cursor` 高度等于该行行盒的高度（±1px）；MUST NOT 一次跨过整块；文档逐字节
  不变
