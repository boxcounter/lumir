# Design: rework-list-tab-line-model-nov27

## 1. 现状与差距（实现期核对，2026-11-27，base `a959986e`）

### 1.1 现行实现是项 / 子树模型

> 规格侧：living spec 的 requirement 名「列表项缩进键（TAB / SHIFT+TAB）」随模型替换改名为
> 「列表行缩进键（TAB / SHIFT+TAB）」。OpenSpec 的 MODIFIED 块不允许改 scenario 名，故走
> 「整条 REMOVED + 新增承接条 ADDED」的改名通道（先例：change `vault-and-session-removal`），
> 并用一条 MODIFIED 更新「轨道 D」requirement 里对该条名的交叉引用。

- `src/list-indent.ts:181` `listIndentChange(state, dir)` 的第一个动作是
  `listItemAt(state, state.selection.main.head)`——**选区只被用来取 head**，其余 range 与其余行
  不参与判定。
- 命中项后 `listItemLines`（`:98`）取该 `ListItem` 节点覆盖的首行到末行，indent 分支（`:188`）
  把这些行**整体**插入同一 delta；outdent 分支（`:209`）同样整块删除。
- `renumberOrderedItems`（`:160`）按 D2c 重排原分组 / 目标分组的有序项编号，会改写**未选中行**。
- 归属判定（`listItemAt`，`:77`）先跳到行首结构前缀之后，再 `resolveInner` 向上找最近的
  `ListItem`；代码块 / 表格 / HTML 块先行命中则返回 null。这一段的行首前缀与禁区口径可以原样
  复用，问题只在「以 head 定项」与「整项平移」。

### 1.2 用户实测的机制链

0.20 多行选区 Shift+Tab：`selection.main.head` 落在末行 → 只算末行所属项的 outdent delta →
只把该项覆盖的行（末行及其续行 / 子项）平移 → 其余选中行逐字节不动。与用户截图现象逐点吻合。

## 2. 行集口径（操作对象）

命令 SHALL 先把选区展开成**行集**，再做判定。口径与 CM `@codemirror/commands` 的
`changeBySelectedLine`（`node_modules/@codemirror/commands/dist/index.js:1567`）一致——它也是
CM 的 `indentMore` / `indentLess` 选择哪些行的口径，本 change 直接沿用这一约定而不是另造一套：

| 选区形态 | 行集 |
|---|---|
| 空选区（caret） | `doc.lineAt(head)` 一行 |
| 非空选区 `[from, to)` | 起始行（`lineAt(from)`）**总是**计入；其后每行 `L` 当且仅当 `to > L.from` 计入 |
| 多 range | 各 range 行集取并集，按 `line.from` 去重、文档序排序 |

**选区尾落在行首**：`to === L.from` 时 `to > L.from` 为假 ⇒ 该行不触及。
例：从第 2 行行首拖到第 5 行行首，行集 = {2, 3, 4}，第 5 行不动。反向选区（anchor 在下、head
在上）经同一 `from/to` 归一，结果相同。

**从行尾起选**：`from === 起始行.to`（行尾）仍计入起始行（`lineAt(from)` 归该行），与 CM 同口径。

**单行内的部分选区**：行集只有那一行。

## 3. 逐行规则

### 3.1 归属与禁区（逐行独立）

对行集内每一行 `L`：

1. `L.text` 为纯空白（`/^\s*$/`）⇒ 跳过，不写（避免留下行尾空白）。
2. 取 `anchor = min(L.from + linePrefixEnd(L.text), L.to)`（复用 `linePrefixEnd`：连续的 `>` /
   空格 / tab 之后），从 `anchor` 向上 `resolveInner`；若先命中 `FencedCode` / `CodeBlock` /
   `Table` / `HTMLBlock` ⇒ 跳过（既有禁区，不扩权）。
3. 未命中 `ListItem` ⇒ 跳过（普通段落 / 标题 / 引用正文，保持 M239 的 D4a 口径）。
4. 命中 `ListItem` 即该行的 **owner item**；`owner` 的首行判定 =
   `doc.lineAt(owner.getChild("ListMark").from).from === L.from`。

每一行独立判定：同一项的首行与续行可以分属不同行集结果（只写被选中的那些行）。

### 3.2 步长：首行用结构目标，续行用内容列宽

列的取值沿用现行口径（`src/list-indent.ts` 的 `itemMarkerColumn` / `itemContentColumn`）：
marker 列 = `ListMark.from - 行首`；内容列 = marker 宽 + 其后空格。

**TAB（indent）**

| 行 | Δ | 无操作条件 |
|---|---|---|
| owner 的首行 | `上一同级项的内容列 − 本行 marker 列` | 无上一同级项，或 Δ ≤ 0 |
| owner 的续行 | `owner 的内容列宽 = 内容列 − marker 列` | owner 解析异常（取不到 marker） |

首行用结构目标而不是自身内容列宽，是因为「上一同级项的 marker 宽度可能与本行不同」：
`9. a` / `10. b` 之下 `2. c` 要嵌进 `10. b` 需 4 空格（上一同级项内容列），本行自身内容列宽只有 3。
固定 2 或「自身内容列宽」都会退化成不可见的空白 diff（M239 已用真 lezer 实测钉死）。

**SHIFT+TAB（outdent）**

| 行 | Δ | 无操作条件 |
|---|---|---|
| owner 的首行 | `本行 marker 列 − 最近祖先项的 marker 列`；无祖先项时目标为 0，Δ = 本行 marker 列 | Δ ≤ 0，或本行没有可删空白 |
| owner 的续行 | `owner 的内容列宽` | owner 解析异常，或本行没有可删空白 |

删除量再按本行「可删空白」收一次：`min(Δ, 可删空白数)`；不足时删全部可删空白（与 M239 的宽容
读取一致）。**可删空白** = 行首结构前缀里、最后一个 `>` 及其后一个强制分隔空白之后的那段空白
（`lineEditablePrefix`）；删除 MUST NOT 越过该下界、MUST NOT 触及 marker / 正文的第一个非空白字符。
行首 tab 记作一个删除单位（宽容读取），写入侧只产空格。

### 3.3 六个显式裁决点

**① 首项（没有上一同级项）**

- TAB：首行无操作（无嵌套目标；写入只留不可见空白）。若选区内还有其它行，其它行照常处理——
  选整段列表按 TAB 的自然结果就是「首行不动、其余行并入首行之下」。
- 续行：TAB / SHIFT+TAB 都用 owner 的内容列宽（首项也能缩 / 凸自己的续行）。
- SHIFT+TAB：首项首行无前导空白 ⇒ 无操作；若解析上是嵌套层的首项（有祖先项），照常按祖先
  marker 列凸排——「首项」只影响 TAB，不影响 outdent。

**② 混合列表 / 非列表选区**

非列表行逐行跳过（D4a 原样保留，不扩权）；列表行照常处理。 **head 在非列表行不再整体否决**：
只要选区触及列表行，命令就作用于这些行（这是「选区是对象、head 不是对象」的直接推论）。
若行集里没有任何可编辑的列表行 ⇒ 不 dispatch（与单光标落在段落上同为无操作）。

**③ 有序编号**

一律不改写。切断 D2c 的两种理由同时成立：重排原分组会改**未选中**的兄弟项（违反「未触及行
逐字节不动」）；只重排选中行会制造重复 / 跳号且仍要改写 marker（超出「只写空白」的最小写回面）。
显示编号由 `src/preview/lists.ts:260` 的 `orderedItemLabel` 按组序计算，不读源码数字，因此渲染
不会因源码编号不连续而错位；源码与显示在缩进后可能不一致，是行模型的既定代价（proposal 已登记）。

**④ 引用前缀**

插入 / 删除点仍取「最内层 `>` 及其后强制分隔空白之后」，由 `linePrefixEnd` /
`lineEditablePrefix` 保证：`> - a` TAB 得 `>   - a`，SHIFT+TAB 回到 `> - a`；`> > - a` 同理。
引用前缀本身（`>` 与它后面的一个分隔空格）MUST NOT 被删除。

**⑤ 纯空白行**

`/^\s*$/` 的行跳过：TAB 不写（否则行尾多出空白），SHIFT+TAB 不删（不制造「空白行被清空」的
噪声 diff）。列表之间的空行即使解析上落在 `BulletList` 里也不写。

**⑥ 选区尾落在行首**

按 §2 不计入该行。这是唯一会被「选区终点」影响的行；其余行只看是否与选区相交。

### 3.4 为什么首项 TAB 仍无操作（保留 S1b）

行模型不改变「缩进必须有落点」这一物理事实：首项没有上一同级项，插入的空格在解析上仍是同一层，
渲染层又把列表首行的行首空白整体隐藏（`src/preview/lists.ts` 的 `hidden: {from: line.from, …}`），
用户会得到「按了没反应但文档变 dirty」的隐形 diff——M239 的 D4c 拒绝理由在行模型下逐字成立。
保留它还带来一个自然结果：选中整段列表按 TAB = 其余行并入首行之下（块缩进的直觉行为）。

## 4. 选区、撤销与 dispatch

- 纯函数只产 `changes`（`{from,to,insert}[]`），不产 selection：runner（`src/editor.ts:1123`
  `applyListIndent`）一次 `view.dispatch({changes, userEvent})`，选区 / caret 由 CM 的 change
  mapping 平移。**MUST NOT 显式重设选区**（否则多 range 的 anchor / head 关联会丢）。
- 一次按键 = 一个 changeset = 一步撤销；`userEvent` 沿用 `input.indent` / `input.outdent`。
- `changes` 为空 ⇒ 返回 null ⇒ runner 不 dispatch：文档逐字节不变、不进撤销栈、dirty 不变、
  焦点留在编辑器（命中即消费的既有纪律不变）。
- 只读：runner 的 `state.readOnly` 提前返回不变；纯函数不管 readOnly（与现行分层一致）。
- IME / 键位层：零改动。命令仍由统一键位表分发，`Tab` / `Shift-Tab` 的既有绑定与
  `Ctrl-Tab` / `Ctrl-Shift-Tab` 的隔离不变。

## 5. 复用与不采用的方案

**复用**：

- 行首前缀扫描：`linePrefixEnd` / `lineEditablePrefix` 原样保留（引用前缀口径的唯一实现）。
- 归属：`listItemAt` 的主体（`resolveInner` + 禁区集合 + `ensureSyntaxTree` 前沿推）保留，
  改为「给定行」而不是「给定 head」。
- 结构列：`itemMarkerColumn` / `itemContentColumn` / `previousSiblingItem` / `ancestorListItem`
  原样保留。
- 行集口径：沿用 CM `changeBySelectedLine` 的语义（尾落行首不计），不引入新依赖、不复制其实现。

**不采用**：

- **CM stock `indentMore` / `indentLess`**：`indentMore` 在 `line.from` 原样插 `indentUnit`，不认
  引用前缀、不按 marker 宽度取步长；`indentLess` 用 `getIndentation` 求上一缩进层，会把 `> `
  前缀与列表 marker 一起算进「缩进」，与本仓的「结构空白」口径不同。二者都会把命令行为改成另一
  套语义，且 `indentMore` 对首项也照写（隐形 diff），与本 change 的裁决点冲突。它们的**行集口径**
  被采纳（§2），实现仍留本模块。
- **统一块缩进（整段一个公共 delta）**：需要跨行求最小公共缩进，混合 marker 宽度时会把有序项
  嵌错层；且用户要的是「各行一致处理」，不是「整块对齐」。
- **只按行自身内容列宽取步长**：`9. a` / `10. b` 之下的项需要上一同级项的内容列（实测 4 空格），
  自身宽度 3 会嵌不进去（M239 design §3 的实测表）。
- **D2c 双模式（保留重排 / 新增不重排开关）**：用户已裁决切断，且双模式会让「未选行是否会被改」
  变成不可预测的状态，违反行模型的前提。

## 6. 测试与证据口径

- 纯判定：`tests/unit/list-indent.test.ts` 用真 `EditorState` + 真 GFM 解析器，先红后绿覆盖
  §2 / §3 的每个裁决点（含正向 / 反向选区、尾落行首、混合选区、空行、引用、首项、编号不动、
  单次 undo 与选区映射）。
- 键位链路：`tests/visual/scenes/m239-list-tab-indent.spec.ts`（真 CM + 真键位层）更新有序列表
  期望（不再重排），新增多行选区 Tab / Shift+Tab 用例与「首项 / 子项不受牵连」断言。
- 真机：场景 43 更新有序列表期望；新增场景 888（fixture 覆盖用户截图的 6–8 行选择、正向 / 反向
  与未选行不动）。真机执行不在本 mission 的授权内（不启 app），场景只做静态契约校验与交付。
- 不更新视觉基线：本 change 无视觉结构新设计，`tests/visual` 的像素层不在本批范围（用户明确
  要求不更新基线）。
