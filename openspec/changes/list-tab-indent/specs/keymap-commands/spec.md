# keymap-commands 增量规格

## ADDED Requirements

### Requirement: 列表项缩进键（TAB / SHIFT+TAB）

编辑器 SHALL 提供列表项缩进命令 `editor.list-indent` 与 `editor.list-outdent`，默认绑定
`Tab` 与 `Shift-Tab`，scope `editor`，经统一键位表分发（命令 id 入 `COMMAND_IDS`，
绑定入 `KEY_BINDINGS` 并附来由；[keys] 配置可重绑 / 解绑，describe-bindings 面板渲染
生效表时自动收录）。编辑器内 TAB 的原生焦点遍历 SHALL 被接管（D1 裁决的知情代价）；
`Ctrl-Tab` / `Ctrl-Shift-Tab` 的标签切换绑定归一化后是与 `Tab` / `Shift-Tab` 不同的
token，两者 MUST 互不干扰。

光标（选区 head）归属的判定 SHALL 走语法树：取 head 所在行经 `resolveInner` 向上归最近的
`ListItem`（光标在子项行时归属子项）。命中列表项时，TAB SHALL 把该 `ListItem` 节点覆盖的
全部行（首行、续行、子列表行）整体平移一层：每层 SHALL 是 2 个空格，写入侧 MUST NOT
出现 tab 字符；引用块内的列表，插入 / 删除点 SHALL 在最内层 `>` 前缀之后。SHIFT+TAB
对称地减一层：每行 SHALL 移除至多 2 个前导空格（不足 2 个时移除全部；行首 tab 按一层
读取宽容处理）。

写回 SHALL 遵守最小写回（ADR 0003 §3 铁律的编辑态推论）：一次平移的 changes MUST 只含
行首空白区间——有序列表的源码字面编号 MUST NOT 重排（显示编号由渲染层按组序重算，
`src/preview/lists.ts` 既有机制），任务标记与标记字符 MUST NOT 改写，列表之外的任何行
MUST NOT 触及。一次 TAB / SHIFT+TAB SHALL 是单次 dispatch（带 `userEvent`），⌘Z 一次
撤销 SHALL 还原整次平移。

收口行为：列表项已在顶层（行首无空白可减）时 SHIFT+TAB SHALL 无操作；head 不在任何
`ListItem` 内（普通段落、标题、表格、空行、围栏 / 缩进代码块内）时 TAB 与 SHIFT+TAB
SHALL 无操作；非空选区 SHALL 按 head 所在项处理（批量缩进不在本版）。「无操作」=
命令不 dispatch：文档逐字节不变、不进撤销栈、dirty 不变、焦点不跳出编辑器——「命中即
消费」沿用「统一键位分发表」的既有纪律，MUST NOT 把按键放回原生路径。只读模式（非 md
文件）下两条命令 SHALL 一律不动文档。

#### Scenario: 列表项内 TAB 增加缩进

- **WHEN** 光标在 `- a`（顶层无序项，含续行或子项）的正文内按下 TAB
- **THEN** 该项节点覆盖的每一行行首各增加 2 个空格（`  - a`，续行与子项同步平移），
  光标随编辑映射保持在同一项内，文档其余部分逐字节不变

#### Scenario: SHIFT+TAB 减少缩进并在顶层无操作

- **WHEN** 光标在 `  - a`（一层嵌套项）内按下 SHIFT+TAB，随后再按一次 SHIFT+TAB
- **THEN** 第一次后该项回到顶层（`- a`）；第二次该项已无任何行首空白，文档逐字节不变、
  撤销栈不增长、焦点留在编辑器内

#### Scenario: 有序列表缩进不重排源码编号

- **WHEN** 光标在 `1. x\n2. y` 的 `2. y` 项内按下 TAB
- **THEN** 源码变为 `1. x\n  2. y`——字面编号 `2.` 不改写（显示编号由渲染层按新结构
  重算为 `1.1`），任务列表的 `[ ]` / `[x]` 标记同样逐字节不动

#### Scenario: 引用内列表的缩进落在引用标记之后

- **WHEN** 光标在 `> - a` 的列表项内按下 TAB
- **THEN** 源码变为 `>   - a`（2 个空格加在最内层 `>` 前缀之后），引用结构不变

#### Scenario: 非列表上下文无操作

- **WHEN** 光标在普通段落 / 标题 / 表格行 / 围栏代码块内按下 TAB 或 SHIFT+TAB
- **THEN** 文档逐字节不变、不进撤销栈、dirty 不变、焦点不跳出编辑器（不插入空白、
  不走原生焦点遍历）

#### Scenario: 撤销一次还原整次平移

- **WHEN** 对含续行与子项的列表项按下 TAB，随后按下 ⌘Z
- **THEN** 一次撤销即还原整次平移（所有行回到平移前），文档与平移前逐字节相同

#### Scenario: 只读模式下缩进键不动文档

- **WHEN** 以只读 code 模式打开含列表形态文本的非 md 文件，按下 TAB / SHIFT+TAB
- **THEN** 文档内容与之前逐字节相同（只读保证不因新增命令而放宽）
