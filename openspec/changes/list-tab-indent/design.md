# Design: list-tab-indent

## 1. 现状（全部 file:line 锚点，2026-09-25 核对）

### 1.1 键位统一层（M131/M132/M133）

- 唯一分发表在 `src/keys.ts:293`（`KEY_BINDINGS`）；token 归一化与运行期事件同源
  （`normalizeKey` / `keyToken`，`src/keys.ts` 注释「表即文档」）。重复绑定在构造期抛错，
  缺实现的绑定在 attach 期抛错（`src/keys.ts` Keymap 构造器与 attach）。
- **TAB 现状 = 未绑定**：表内无 `Tab` / `Shift-Tab` token。`Ctrl-Tab` / `Ctrl-Shift-Tab`
  已绑 `tab.next` / `tab.prev`（`src/keys.ts:389-390`），归一化后与裸 `Tab` 是不同 token，
  不冲突。CM 侧无 `indentWithTab`、无 defaultKeymap（全仓 grep 零命中）。应用无补全
  扩展（`autocompletion` 零命中，`src/` 内三处 `autocomplete = "off"` 是原生输入框属性）。
  因此 TAB 落到原生路径 = webview 焦点遍历：contentDOM 带 `tabindex="0"`
  （`src/editor.ts:1353`），TAB 把焦点移给下一个可聚焦元素。
- 命令装配：编辑器侧命令在 `src/editor.ts:1471` 的 `commands` 记录（`Record<
  EditorCommandId, CommandRunner>`，编译期合同）；全局命令在 `src/main.ts:483`；
  分发器 attach 在 `src/main.ts:535`，[keys] 覆盖到位后重挂（`src/main.ts:552`）。
  editor 作用域判定 = 事件目标落在 contentDOM 内（`src/main.ts:532`）。
- [keys] 覆盖：`applyKeyOverrides`（`src/keys.ts:522`）单键重绑 / 解绑；命令清单单一
  来源是 `COMMAND_IDS`。默认不绑键清单 `KEYLESS_COMMAND_IDS`（`src/keys.ts:217`）——
  本 change 的两条命令**带默认绑定**，不进该清单。
- describe-bindings 面板渲染的是生效表（applyKeyOverrides 的产物），新命令自动收录，
  零改动。

### 1.2 列表渲染 / 编辑现状（M73 起，M138 引用内列表，M218 标记体系）

- 列表装饰在 `src/preview/lists.ts`，装配于 `src/preview/livePreview.ts:416`。
- **标记常隐**：首行的列表标记（含任务标记与其后空格）被 `Decoration.replace` 换成
  widget（`src/preview/lists.ts:360`），续行的行首空白被隐藏（`src/preview/lists.ts:
  361-363`）。列表标记**不在**「光标触及即显露源码」的清单里（显露清单见
  `src/preview/livePreview.ts:4-6` 与 `openspec/specs/editor-live-preview/spec.md:25`：
  callout / 链接 / 强调 / frontmatter / 公式 / mermaid / 分隔线）——光标在列表项内时
  行首空白区不可达，这就是「手动缩进连落点都没有」的机制成因，也是 TAB 命令必须
  走语法树而非可见文本的原因。
- 显示缩进与源码无关：行装饰带 `--lp-list-body` / `--lp-list-marker`（`src/preview/
  lists.ts:345-348`），数值由组扫描按嵌套深度 + 实测标记宽度算出（每层 +2 单元，
  `src/preview/lists.ts:289`）。有序列表显示编号 = 复合多级编号，按组内序号算，
  不读源码字面数字（`src/preview/lists.ts:211-213`）——**源码编号重排对显示毫无
  必要**，这是 D2「不重排」的机制依据。
- 编辑后重算：docChanged 驱动陈旧组后台重扫（`src/preview/lists.ts:160-177`），
  缩进编辑落进同一通道，渲染自动跟随，本 change 不动渲染层。
- 任务标记：纯渲染（widget 里画一个 span，`src/preview/lists.ts:58-64`），全仓无点击
  切换交互。
- spec 侧既有约束：`openspec/specs/editor-live-preview/spec.md:25`「装饰 MUST NOT 改变
  文档源码（ADR 0003 §3 铁律）」；`:181` 引用内列表与正文列表同一套装饰。

### 1.3 撤销 / 保存 / 只读

- 撤销史 = CM `history()` 线性双栈，逐会话独立（`src/editor.ts:1383-1398` 注释段）；
  ⌘Z / ⇧⌘Z 经统一键位层绑定。命令 dispatch 带 `userEvent` 即被 history 归组——一次
  TAB = 一次 dispatch = 一步撤销。
- dirty 判定 = 文本与 cleanDoc 比较（`src/editor.ts:1418-1427` 的 updateListener）；
  保存链路有自动保存 debounce 2s（`src/save-controller.ts:38`）与 ⌘S。缩进编辑与
  打字走完全相同的 dirty → 保存链路，本 change 零新通道。
- 只读：非 md 文件 `EditorState.readOnly` + `changeFilter` 兜底（`src/editor.ts:1350-1357`
  与 :1416 附近），任何绕过 DOM 的程序化 dispatch 都会被拦；命令实现自身也按
  `state.readOnly` 提前返回（与 M132 编辑键同口径）。

## 2. 交互状态机（按选区 head 归属判定）

判据：取 `state.selection.main.head` 所在行，经 `syntaxTree` 的 `resolveInner` 向上找
最近的 `ListItem` 节点（光标在子项行时归属子项而非父项——resolveInner 天然给最内层）。
Lists.ts 的组扫描只覆盖可见范围，本判定用语法树直接解析，不依赖装饰插件。

| # | 状态 | TAB | SHIFT+TAB |
|---|---|---|---|
| S1 | head 归属某 ListItem（首行正文 / 续行 / 任务项均可），且**有上一同级项** | 该项整体平移一层（步长 = 该层标记内容列宽，§3） | 该项整体平移回祖先列表项所处层级，删除量不超过该层步长；行首空白不足的行移除其全部空白 |
| S1b | head 归属的 ListItem 是所在列表的**第一项**（无上一同级项） | **无操作**：没有可嵌套的父项，写入只会留下不可见空白（§3） | 同 S2 |
| S2 | head 归属的 ListItem 已在顶层（首行无任何行首空白） | 同 S1 | **无操作**：文档逐字节不变、不进撤销栈（D3） |
| S3 | head 在围栏 / 缩进代码块内（`FencedCode` / `CodeBlock`） | 无操作（D4） | 无操作 |
| S4 | head 不在任何 ListItem（段落 / 标题 / 表格 / 空行） | 无操作（D4） | 无操作 |
| S5 | 引用块内的列表（`> - item`，含嵌套 `> >`） | 同 S1，插入点在最内层 `>` 前缀之后（§3） | 同 S2 口径，减的是 `>` 之后的空白 |
| S6 | 只读模式（非 md 文件） | 无操作（readOnly 提前返回 + changeFilter 兜底） | 同左 |
| S7 | 非空选区 | 按 head 所在项处理（D5 裁决 a；批量平移是 Non-goal） | 同左 |

「无操作」= 命令返回且不 dispatch——键位层已吞掉默认行为（命中即消费），焦点不跳出、
文档不变、dirty 不变、撤销栈不变。

光标到不了被隐藏的标记区（§1.2），所以不存在「光标在标记上」这个状态；S1 的「首行」
指 head 落在标记之后的正文范围或续行空白处——归属判定统一交给语法树，不区分可见性。

## 3. 源文件写回规则（按 Alex 裁决 D2c 改写：缩进后按新归属重排有序列表源码编号）

- **平移单位 = 该层标记的内容列宽**（marker 宽度 + 其后空格数：`- ` → 2、`1. ` → 3、
  `10. ` → 4），**不是固定 2 空格**。依据是实测（本仓解析器，装配与
  `tests/unit/cell-geometry.test.ts` 同源：`markdown({ base: markdownLanguage, extensions: [GFM] })`）：

  | 源码 | 解析结果 |
  |---|---|
  | `- a` + `\n  - b`（2 空格） | 嵌套 ✓（`- ` 内容列 = 2） |
  | `1. a` + `\n  2. b`（2 空格） | **仍是同层兄弟项**（`1. ` 内容列 = 3） |
  | `1. a` + `\n   2. b`（3 空格） | 嵌套 ✓ |
  | `9. a` / `10. b` + `\n   1. c`（3 空格） | **平表**——要嵌到 `10. b` 下需 4 空格 |
  | `- a` + `\n  1. b`（2 空格） | 嵌套 ✓（父是 `- `） |

  固定 2 空格对有序列表（以及宽度 >2 的 marker）**不构成嵌套** ⇒ 渲染层的缩进与复合编号
  按结构重算，画面零变化 ⇒ 用户只得到一份不可见的空白 diff（Non-goals 里被否决的形态），
  且 D2c 的「按新归属重排」会失去对象（项仍在原组原位置，规范序号不变）。
  无序列表最常见路径仍是 +2，与仓内 fixture 惯例（`tests/visual/scenes/paragraph.spec.ts:7`、
  `markdown-parser.spec.ts:29`）和 lists.ts 的每层 +2 显示口径（`src/preview/lists.ts:289`）一致。
- **无可嵌套的父项时无操作**：head 归属的项是所在列表的**第一项**（没有上一同级项）时
  TAB 不产生任何编辑——没有父项可嵌，写入只会留下不可见空白。与 D3a（顶层项凸排 =
  无操作）对称，理由同 Non-goals 对被否决项「非列表 TAB 插空白」的判词。
- **平移范围**：归属 `ListItem` 节点覆盖的**全部行**——首行、续行、子列表行，按同一
  delta 整体平移（相对结构因此逐字节保持）。只缩进首行会让续行与子项脱离该项的解析
  归属（markdown 列表项的延续靠缩进判定）。行集合从语法树节点范围导出，不猜行首正则。
- **插入 / 删除点**：正文列表 = 行首空白之后；引用内列表 = **最内层 `>` 及其后空格之后**
  （逻辑参照 `src/preview/lists.ts:310-324` 的「跳过连续 `>` 与紧随空格」，两者取同一个
  落点 = 行内 marker 起始位）。缩进 = 在该点插入 `delta` 个空格，其中
  `delta = 父项内容列宽 − 本行当前结构性缩进`；凸排 = 从同一点反向删除空格，删除量以
  本行结构性缩进为上限、且**不得吃进 `>` 之后的强制分隔空白**（`> - a` 已是该层顶层，
  此时凸排即无操作）。tab 字符不出现在**写入侧**（只写空格）；读到行首 tab 时按
  「一个 tab = 一层」宽容读取（严格写入、宽容读取）。
- **有序列表源码编号按新归属重排（D2c，本 change 与原稿最大的口径差异）**：
  **受影响的分组** = 被平移项的**原分组**（它离开的兄弟序列）与它平移后**落入的分组**
  （缩进时新建的子分组；凸排时即祖先分组）。两组内的**全部**有序项重排为该组内 1 起
  递增的规范序号——因此除被平移项外，原分组中位置前移的兄弟项也会被改写
  （`1. a` / `2. b` / `3. c` / `4. d` 缩进 `3. c` 后：被平移项在新组内写为 `1.`，
  `4. d` 改写为 `3. d`）。不在这两处分组内的有序项（含被平移项子树内部的子分组）
  **不改写**——改写面因此有界。依据：源码与渲染一致是 D2c 的动机，而编号重排也是本次
  平移在有序列表上唯一的可观测结果。代价如实记录：分组内原本不规范的编号（如手写
  `3.` 起头）会一并被规范化。
- **不动的部分**：任务标记 `[ ]` / `[x]`；标记字符本身（`-` / `*` / `+` 不换写）；
  列表之外的任何行。一次平移的 changes 只含行首空白区间与有序项序号区间——这是
  ADR 0003 §3 铁律在编辑态的对应物：用户发起的编辑可以改文档，但改动面 MUST 限于
  用户动作所指的最小范围。
- **落点**：dispatch 后选区随 CM 的 change mapping 自动平移（插入发生在光标之前时
  光标随之右移），命令不显式重设选区；减缩进同理。 undo：单次 dispatch 带
  `userEvent: "input.indent"` / `"input.outdent"`，⌘Z 一次还原整次平移（含子树与编号重排）。

## 4. 与既有层的集成点（实现期落点索引）

- `src/keys.ts`：`EDITOR_CORE_COMMAND_IDS` 增 `editor.list-indent` / `editor.list-outdent`；
  `KEY_BINDINGS` 增 `Tab` / `Shift-Tab` 两条（scope editor，doc 写冲突核对结论）。
  构造期重复检查 + attach 期缺实现检查 + `tests/unit/keys.test.ts` 的孤儿命令 /
  KEYLESS 对账断言自动覆盖新条目，无需新断言。
- `src/editor.ts`：命令实现按「纯函数 + runner」拆分——纯函数
  `listIndentChange(state, dir): { changes, selection? } | null`（headless 可测，
  先例 = `src/cell-geometry.ts` / `src/code-structure.ts` 的纯函数形态），runner 在
  `commands` 记录里 dispatch。readOnly 提前返回。
- 渲染层零改动（§1.2 重扫机制接住）；保存 / dirty / 撤销零改动（§1.3）。
- describe-bindings 面板零改动（渲染生效表）。

## 5. 被否决方案

- **CM `indentWithTab` / stock 命令**：它把 TAB 全局绑成「插入缩进」，与 D4（非列表
  no-op）直接冲突，且 keymap-commands 已有「MUST NOT 换用 CM stock 命令」的既有口径
  （M132 delta：原生路径在 widget / 隐藏 replace 边界不可控）。
- **（原推荐项，已被 Alex 裁决 D2c 推翻）缩进后不重排有序列表源码编号**：原理由——显示编号
  本就由 lists.ts 按组序算（§1.2），重排只制造无谓 diff，违反最小写回。**裁决 D2c 取
  「缩进后重排有序列表源码编号」**：本稿据此改写 §3 与 spec delta（源码与渲染一致优先，
  且编号重排是平移在有序列表上唯一的可观测结果；Diff 面的增量有界——只覆盖受影响的两个分组）。
- **（原推荐项，实现期实测推翻）固定 2 空格为缩进步长**：对 `- ` 系成立，对有序列表与
  宽度 >2 的 marker 不构成嵌套（`1. a` + `\n  2. b` 实测仍是同层兄弟项）⇒ 缩进退化为
  不可见空白。改为按语法树取该层标记的内容列宽（§3）。
- **TAB 保留焦点遍历、列表缩进另选键位**：与 Alex 原话（点名 TAB）冲突；且 Emacs
  体系里 TAB 就是缩进键。
- **非列表 TAB 插入 2 空格 / tab 字符**：制造不可见空白 diff（渲染态看不到行首多了
  空格），违反最小写回精神；需要「在普通段落里加缩进」的场景在本产品没有对应语义。
- **SHIFT+TAB 到顶后提升为段落**：把「减少缩进」偷换成「删除标记」，改变文档结构，
  最少惊讶原则下否决（D3）。
- **只缩进首行、不动续行与子树**：markdown 解析下续行会脱离列表项，渲染立即破裂
  ——平移必须是节点级的（§3）。
