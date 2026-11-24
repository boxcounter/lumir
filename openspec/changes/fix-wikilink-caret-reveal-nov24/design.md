# Design: wikilink 编辑态显露与逐字符光标合同

> 本文件是节点 1 的行为合同，不包含产品实现。调查结论来自当前基线 `bb4f5ffb` 的源码、living specs 与测试交叉核对；r2 修订绑定独立评审 r1 的指针反例。

## 1. 根因与方案边界

普通 wikilink 的 resolved / ambiguous / unresolved 三态当前由 `buildWikilink` 生成覆盖完整 `[[…]]` 的 `Decoration.replace`，`collectWikilinks` 没有调用共享 `touchesSource`。因此：

- widget 内没有 target / alias 的源码文本节点，指针坐标只能映射到 replace 的两端；
- 未注册 `atomicRanges` 时，CodeMirror 水平移动仍按源码位置逐字符走，但渲染坐标停留在 widget 边缘；
- 在不可见内部位置键入会改变源码而缺少可见反馈。

采用两条既有路径，不发明第三套机制：

1. 在 `collectWikilinks` 建装饰前复用 `touchesSource(view.state, from, to)`，与标准链接、公式同一显露判据和按压快照。
2. `WikilinkWidget.toDOM` 只在**无修饰主键**入口复用 `enterReplacedSource`；普通链接的钳制区间是 `from + 2 … to - 2`，只读会话直接返回。

不采用 `EditorView.atomicRanges` 或整 span 原子步。只有实测仍存在的隐藏死区才允许在共享水平移动层补钳制，且钳制只能作用于「同一次事务后仍隐藏」的区间，不能覆盖本 change 的显露路径。

## 2. 修饰键必须先于编辑入口分流

widget 的 `mousedown` 在调用 `enterReplacedSource` 之前按以下顺序分流：

| 事件 | widget 编辑入口 | 后续既有路径 |
|---|---|---|
| 非主键 | 直接返回 | 不变 |
| 主键 + Meta | 直接返回；MUST NOT `preventDefault`、dispatch 选区、显露或聚焦 | 冒泡到 `view.dom` 的既有链接跟随；命中后由原路径 `preventDefault` 并打开 / toast |
| 主键 + Ctrl | 直接返回；同样不得先执行编辑入口任何副作用 | 不交编辑入口，也不新增应用内激活；让回 macOS 系统次级点击与 CM 原生边界落点 |
| 无修饰主键 + 可编辑 | 调 `enterReplacedSource` | 显露并精确落点 |
| 无修饰主键 + `readOnly` | 直接返回 | 不进入、不改选区、不强行聚焦 |

Meta / Ctrl 都不能先经 `enterReplacedSource` 再「补救」。`src/link-follow.ts` 的现状是 Meta 才激活链接，Ctrl 不激活；本 change 不把 Ctrl 改成跳转，也不复制这份分流。

真实 visual 断言必须按 resolved / ambiguous / unresolved × Meta / Ctrl 建矩阵：

- Meta + resolved / ambiguous：打开所选目标（ambiguous 仍取既有 `chosen`）；原视图在导航前不得产生编辑入口的 `select.pointer`、源码显露或聚焦，原选区保持到既有打开链接管。
- Meta + unresolved：停留原文并出现既有 toast；手势前后 `EditorState.selection`、焦点和 replace widget 完全一致，文档不变。
- Ctrl + 三态：不跳转、无新 toast；没有编辑入口 dispatch / 显露。选区与焦点按未接入口时的原生路径逐值断言（包括既有的边界落点），不能只写「无操作」而放过静默改选区。
- 每格记录原始视图的选区、widget 数量和焦点；导航格在原视图销毁前取证，不能用目标文件的新视图状态冒充「未落地」。

## 3. 点击编辑与拖选是两次手势

`enterReplacedSource` 在首次 `mousedown` 消费事件，CM 不会从渲染 widget 启动原生拖选状态机。因此本方案明确选择**两次手势**，不声称首次 drag 可选中 alias：

1. 第一次无修饰 click 或 drag：只进入源码。以 `mousedown` 位置完成落点；即使发生移动，也在 mouseup 后保持空光标，MUST NOT 伪造非空选区或按 drop 位置改写选区。
2. 第二次在已显露源码上拖选：走 CM 原生文本选区。`touchesSource` 保持源码可见，选区精确等于用户拖出的 target / alias 字符；wikilink 不进入 syntax-envelope 外扩集合，`[[` / `]]` 只有被用户实际拖入时才属于选区。

真实 visual 必须用 `page.mouse` 完成两次手势，不得只调 `expand` 纯函数。矩阵覆盖：首次 drag 只进入、第二次部分 alias、完整 alias、target-only、正向与反向拖选；每格断言 `state.selection`、可见源码、定界符未隐式并入、文档不变。第一次 click 的左 / 中 / 右落点测试保留。

## 4. C6 合同替换文本

实现第一项任务必须把 `docs/specs/editor-caret.md` 的 C6 整条替换为以下合同，并同步输入分布、实现落点与属性测试表；不得在实现后补记。

### C6 — 水平移动在隐藏 inline 源码区间保持可见落点

对任意 md 文档、任意由 live preview 隐藏的 inline replace 源码区间，水平移动（`←` / `→`、`⌃F` / `⌃B` 及其扩选变体）SHALL 按该构造是否有选区显露判据分流：

- **有显露判据的构造**（强调、标准链接、公式、普通 wikilink）：落点进入源码区间时 SHALL 触发该构造既有显露判据，完整源码 MUST 上屏；随后移动 SHALL 按字素簇在源码内逐位进行，MUST NOT 钳到区间边界，MUST NOT 把整条构造作为一个原子步。反向移动对称，跨行不跳字。
- **无显露判据的构造**（列表 marker 及其尾随空白、续行行首缩进、裸 marker 行的编辑态标记；范围见 `docs/specs/lists.md` L5）：落点 SHALL NOT 停在区间内部；前进落到区间右端，后退落到区间左端。两个边界本身 MUST 保持可达，从可见行首一次前进恰好落到正文起点，再一次前进一个字素簇，反向对称。
- 区间是否隐藏、是否有显露判据 SHALL 以渲染层同一份判定为准，MUST NOT 在移动层另建一份构造分类或隐藏状态真源。
- 本条的移动、显露与钳制 MUST NOT 改写文档（C5 照旧）。

C6 的列表输入分布全部保留，并新增下表 wikilink 维度。这样不会把旧标题「所有隐藏 inline 都原子化」误扩到可显露构造。

## 5. 状态与入口不变量

| 解析 / 会话状态 | 选区在 span 外 | 选区触及 span | 无修饰主键点击 widget | 文档写入权限 |
|---|---|---|---|---|
| 无 resolver | 原文 + mark，保持现状 | 原文始终可见 | 无 replace widget，走原生文本落点 | 由既有只读状态决定 |
| pending | 原文 + pending mark，保持现状 | 原文始终可见 | 无 replace widget，走原生文本落点 | 可编辑会话可改 |
| resolved / ambiguous / unresolved | 三态 replace widget | 撤 replace，完整 `[[…]]` 原文可见 | 显露并把空光标送入 target / alias 区，编辑器持焦 | 可编辑会话可改 |
| pending → 任一三态，选区仍在 span 内 | 不适用 | 解析完成只重建状态，不得恢复 replace | 不适用 | 连续编辑不中断 |
| 任一三态 replace + `readOnly` | 三态 widget | 不新增编辑入口 | 不消费为编辑入口、不改选区、不强行聚焦 | 文档不变 |

「触及」严格复用 `touchesSource`：空光标在 `from` / `to` 边界不算进入，内部位置与严格重叠选区算进入。指针入口先将选区送到内部再精确定位，避免边界落点立即重新渲染。普通链接的 alias、heading 与 target 都随完整原文显露；钳制只防止第一次点击落在 `[[` / `]]` 之外，进入后仍可移动到定界符。

## 6. 属性测试矩阵

| 维度 | 取值 | 每格公共判据 |
|---|---|---|
| 解析状态 | 无 resolver · pending · resolved · ambiguous · unresolved · pending 延迟后转三态 | 状态迁移不夺回编辑态；无 resolver / pending 原文不消失 |
| 会话 | 可编辑 · `readOnly` | 只读点击不进入、不改选区、不写文档 |
| 键盘入口 | 从左 `→` / `⌃F` · 从右 `←` / `⌃B` · 对应 Shift 扩选 | 首次内部落点即显露；之后逐字素；反向对称 |
| 修饰键 | 三态 × Meta / Ctrl，另加无修饰与只读对照 | 按本文 §2 逐项断言选区、显露、焦点、跳转 / toast；编辑入口不得先副作用 |
| 指针手势 | 点击左 / 中 / 右 · 首次 drag · 第二次部分 / 完整 alias · target-only · 正反向 | 首次 drag 只进入；第二次真实拖选精确且不外扩；编辑器持焦 |
| span 形态 | `[[target]]` · `[[target|alias]]` · `[[target#heading]]` · CJK · 组合字符 · emoji ZWJ | 完整原文显露；字素步长不拆分组合序列 |
| 编辑操作 | 插入 · Backspace / Delete · 替换选区 · 一次 undo · ⌘S | 文档精确等于显式源码模型；undo 单步复原；落盘等于 `EditorState.doc` |
| 文档上下文 | 普通段落 · 表格单 cell · callout · inline code · fenced code · frontmatter | 合法上下文按合同显露；排除上下文不误装饰、不触发候选或编辑入口 |
| 离开方式 | 反向移出 · 点击他处 · 切换标签后返回 | 离开后才恢复三态；返回时按当前选区重新判定 |

所有「只移动 / 点击 / 拖选 / 解析完成」路径断言 `EditorState.doc` 与磁盘逐字节不变；只有明确编辑操作允许变化。测试必须先让旧实现至少在「键盘内部落点仍隐藏」「点击中部落在外部」「pending → resolved 遮回源码」三格判红，再让「Meta 先进入编辑」「首次 drag 假称可选 alias」两个错误实现分别判红。

## 7. 旧合同、场景与注释必须改准的位置

| 位置 | 必须改准的内容 |
|---|---|
| `docs/specs/editor-caret.md` C6 及输入分布、实现落点、属性测试表 | 按本文 §4 整条替换；列表旧矩阵保留，wikilink 新矩阵加入 |
| `openspec/specs/editor-live-preview/spec.md`「标准 Markdown 链接」末尾 wikilink 排除段 | URL 判据不命中 wikilink 的事实保留，编辑行为指向 wikilink-navigation |
| 同 spec「指针选区的语法包裹外扩」封闭集合与场景 | 删除「wikilink 没有显露判据」旧事实；场景明确第一次点击显露、第二次拖选，不外扩 |
| `wikilink-navigation`「链接 span 定位与三态显示」 | 增加编辑态、pending 迁移、修饰键分流、两次手势与只读合同；三态和跳转不变 |
| `tests/visual/scenes/markdown-editing-stability.spec.ts` 的 wikilink 尾部点击用例 | 旧期望 `x [[note]]QR y` / caret 12 是缺陷固化。点击渲染文本末端后应得到 `x [[noteQR]] y` / caret 10，并断言 widget 撤下；另补中部点击、undo 与保存 |
| `tests/visual/scenes/wikilink.spec.ts` 裸点击与 Mod-Click 段 | 裸点击改为无修饰进入编辑但不导航；补三态 × Meta / Ctrl 矩阵及 unresolved 不落地选区反向判据；断言不得只验 toast |
| 新增真实拖选 visual | 第一次 drag 只进入；第二次部分 / 完整 alias、target-only、正反向拖选，不能只用 syntax-envelope 纯函数替代 |
| `src/preview/syntax-envelope.ts` 与 `src/preview/hidden-tail-caret.ts` 文件头 | 清除 wikilink「无显露判据」旧注释；不把 hidden-tail 的强调 / 标准链接修正扩到 wikilink |

以下旧测试**保留原判据，不得误改**：

- `tests/unit/syntax-envelope.test.ts` 的 wikilink 不外扩用例仍断言选区范围不变；真实手势由 visual 场景另判。
- `tests/visual/scenes/editing-oracle.spec.ts` 的 Delete / Backspace / ⌘⌫ wikilink 三格继续守跨 replace 删除不污染源码。
- `wikilink-frontmatter-boundary.spec.ts` 的上下文排除与 parseCases 双喂不变。

## 8. 实现分层与验证

- 装饰层：`src/preview/livePreview.ts` 只接共享 `touchesSource` 与 `enterReplacedSource`，修饰键必须在 helper 前让开，不复制链接跟随或按压窗口逻辑。
- 词法层：若增加 `wikilinkSpanAt(pos)`，`src/link-follow.ts` 的现有 `wikilinkAt` 必须复用；没有消费者则不新增 helper。
- 移动层：默认不改 `src/editor.ts`。只有属性测试证明「事务后仍隐藏」的死区存在时才补共享钳制。
- 验证：前端 unit、相关 visual、`scripts/gate.sh visual` 与新增真机验收场景。精确 caret 与两次手势留在 visual，不用不可读值充当空值。
- 与 B 只按真实改动文件交集排程；A 的实现、验收和归档不以 B 为前置，B 也不以 A 的归档审计为前置。
