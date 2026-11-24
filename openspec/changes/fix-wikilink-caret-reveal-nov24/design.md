# Design: wikilink 编辑态显露与逐字符光标合同

> 本文件是节点 1 的行为合同，不包含产品实现。调查结论来自当前基线 `bb4f5ffb` 的源码、living specs 与测试交叉核对。

## 1. 根因与方案边界

普通 wikilink 的 resolved / ambiguous / unresolved 三态当前由 `buildWikilink` 生成覆盖完整 `[[…]]` 的 `Decoration.replace`，`collectWikilinks` 没有调用共享 `touchesSource`。因此：

- widget 内没有 target / alias 的源码文本节点，指针坐标只能映射到 replace 的两端；
- 未注册 `atomicRanges` 时，CodeMirror 水平移动仍按源码位置逐字符走，但渲染坐标停留在 widget 边缘；
- 在不可见内部位置键入会改变源码而缺少可见反馈。

采用两条既有路径，不发明第三套机制：

1. 在 `collectWikilinks` 建装饰前复用 `touchesSource(view.state, from, to)`，与标准链接、公式同一显露判据和按压快照。
2. `WikilinkWidget.toDOM` 的主键 `mousedown` 复用 `enterReplacedSource`；普通链接的钳制区间是 `from + 2 … to - 2`，只读会话直接返回。

不采用 `EditorView.atomicRanges` 或整 span 原子步。那会让用户无法编辑定界符与 target，也会与标准链接、公式的逐字符范式分叉。只有实测仍存在的隐藏死区才允许在共享水平移动层补钳制，且钳制只能作用于「同一次事务后仍隐藏」的区间，不能覆盖本 change 的显露路径。

## 2. C6 合同替换文本

实现第一项任务必须把 `docs/specs/editor-caret.md` 的 C6 整条替换为以下合同，并同步输入分布、实现落点与属性测试表；不得在实现后补记。

### C6 — 水平移动在隐藏 inline 源码区间保持可见落点

对任意 md 文档、任意由 live preview 隐藏的 inline replace 源码区间，水平移动（`←` / `→`、`⌃F` / `⌃B` 及其扩选变体）SHALL 按该构造是否有选区显露判据分流：

- **有显露判据的构造**（强调、标准链接、公式、普通 wikilink）：落点进入源码区间时 SHALL 触发该构造既有显露判据，完整源码 MUST 上屏；随后移动 SHALL 按字素簇在源码内逐位进行，MUST NOT 钳到区间边界，MUST NOT 把整条构造作为一个原子步。反向移动对称，跨行不跳字。
- **无显露判据的构造**（列表 marker 及其尾随空白、续行行首缩进、裸 marker 行的编辑态标记；范围见 `docs/specs/lists.md` L5）：落点 SHALL NOT 停在区间内部；前进落到区间右端，后退落到区间左端。两个边界本身 MUST 保持可达，从可见行首一次前进恰好落到正文起点，再一次前进一个字素簇，反向对称。
- 区间是否隐藏、是否有显露判据 SHALL 以渲染层同一份判定为准，MUST NOT 在移动层另建一份构造分类或隐藏状态真源。
- 本条的移动、显露与钳制 MUST NOT 改写文档（C5 照旧）。

C6 的列表输入分布全部保留，并新增下表 wikilink 维度。这样不会把旧标题「所有隐藏 inline 都原子化」误扩到可显露构造。

## 3. 状态与入口不变量

| 解析 / 会话状态 | 选区在 span 外 | 选区触及 span | 主键点击 widget | 文档写入权限 |
|---|---|---|---|---|
| 无 resolver | 原文 + mark，保持现状 | 原文始终可见 | 无 replace widget，走原生文本落点 | 由既有只读状态决定 |
| pending | 原文 + pending mark，保持现状 | 原文始终可见 | 无 replace widget，走原生文本落点 | 可编辑会话可改 |
| resolved / ambiguous / unresolved | 三态 replace widget | 撤 replace，完整 `[[…]]` 原文可见 | 显露并把空光标送入 target / alias 区，编辑器持焦 | 可编辑会话可改 |
| pending → 任一三态，选区仍在 span 内 | 不适用 | 解析完成只重建状态，不得恢复 replace | 不适用 | 连续编辑不中断 |
| 任一三态 replace + `readOnly` | 三态 widget | 不新增编辑入口 | 不消费为编辑入口、不改选区、不强行聚焦 | 文档不变 |

「触及」严格复用 `touchesSource`：空光标在 `from` / `to` 边界不算进入，内部位置与严格重叠选区算进入。指针入口先将选区送到内部再精确定位，避免边界落点立即重新渲染。普通链接的 alias、heading 与 target 都随完整原文显露；钳制只防止第一次点击落在 `[[` / `]]` 之外，进入后仍可移动到定界符。

## 4. 属性测试矩阵

不得只保留用户报告的一个 fixture。visual 场景以生成矩阵驱动下列维度，每格断言选区、可见源码 / widget、焦点与文档；纯词法和落点辅助函数可在 unit 层扫更大网格。

| 维度 | 取值 | 每格公共判据 |
|---|---|---|
| 解析状态 | 无 resolver · pending · resolved · ambiguous · unresolved · pending 延迟后转三态 | 状态迁移不夺回编辑态；无 resolver / pending 原文不消失 |
| 会话 | 可编辑 · `readOnly` | 只读点击不进入、不改选区、不写文档 |
| 键盘入口 | 从左 `→` / `⌃F` · 从右 `←` / `⌃B` · 对应 Shift 扩选 | 首次内部落点即显露；之后逐字素；反向对称 |
| 指针入口 | widget 左 / 中 / 右三分之一 · 非主键对照 | 主键落点在内部对应源码位置并持焦；非主键不进入 |
| span 形态 | `[[target]]` · `[[target|alias]]` · `[[target#heading]]` · CJK · 组合字符 · emoji ZWJ | 完整原文显露；字素步长不拆分组合序列 |
| 编辑操作 | 插入 · Backspace / Delete · 替换选区 · 一次 undo · ⌘S | 文档精确等于显式源码模型；undo 单步复原；落盘等于 `EditorState.doc` |
| 文档上下文 | 普通段落 · 表格单 cell · callout · inline code · fenced code · frontmatter | 合法上下文按合同显露；排除上下文不误装饰、不触发候选或编辑入口 |
| 离开方式 | 反向移出 · 点击他处 · 切换标签后返回 | 离开后才恢复三态；返回时按当前选区重新判定 |

所有「只移动 / 点击 / 解析完成」路径断言 `EditorState.doc` 与磁盘逐字节不变；只有明确编辑操作允许变化。测试必须先让旧实现至少在「键盘内部落点仍隐藏」「点击中部落在外部」「pending → resolved 遮回源码」三格判红，证明区分度。

## 5. 旧合同、场景与注释必须改准的位置

| 位置 | 必须改准的内容 |
|---|---|
| `docs/specs/editor-caret.md` C6 及输入分布、实现落点、属性测试表 | 按本文 §2 整条替换；列表旧矩阵保留，wikilink 新矩阵加入 |
| `openspec/specs/editor-live-preview/spec.md`「标准 Markdown 链接」末尾 wikilink 排除段 | 不再把「本 requirement 不改变 wikilink 渲染路径」写成跨 change 禁令；URL 判据不命中 wikilink 的事实保留，编辑行为指向 wikilink-navigation |
| 同 spec「指针选区的语法包裹外扩」封闭集合与「封闭集合之外」场景 | 删除「wikilink 没有显露判据」旧事实；wikilink 仍不外扩，但拖选后完整源码必须上屏，定界符不进入选区 |
| `wikilink-navigation`「链接 span 定位与三态显示」 | 增加编辑态、pending 迁移、指针与只读合同；三态和跳转不变 |
| `tests/visual/scenes/markdown-editing-stability.spec.ts` 的 wikilink 尾部点击用例 | 旧期望 `x [[note]]QR y` / caret 12 是缺陷固化。点击渲染文本末端后应得到 `x [[noteQR]] y` / caret 10，并断言 widget 撤下；另补中部点击、undo 与保存 |
| `tests/visual/scenes/wikilink.spec.ts` 裸点击段 | 将「裸点击不拦截」旧注释与仅有原生选区断言改准为「裸点击进入编辑但不导航」；断言原文显露、无 toast，Mod-Click 跳转期望不变 |
| `src/preview/syntax-envelope.ts` 与 `src/preview/hidden-tail-caret.ts` 文件头 | 清除 wikilink「无显露判据」旧注释；不把 hidden-tail 的强调 / 标准链接修正扩到 wikilink |

以下旧测试**保留原判据，不得误改**：

- `tests/unit/syntax-envelope.test.ts` 的 wikilink 不外扩用例仍断言选区范围不变；源码显露由 visual 场景另判。
- `tests/visual/scenes/editing-oracle.spec.ts` 的 Delete / Backspace / ⌘⌫ wikilink 三格，caret 都在被吸收行之外，widget 前置锚点仍成立，继续守跨 replace 删除不污染源码。
- `wikilink-frontmatter-boundary.spec.ts` 的上下文排除与 parseCases 双喂不变。

## 6. 实现分层与验证

- 装饰层：`src/preview/livePreview.ts` 只接共享 `touchesSource` 与 `enterReplacedSource`，不复制按压窗口或选区逻辑。
- 词法层：若在 `src/preview/wikilinks.ts` 增加 `wikilinkSpanAt(pos)`，`src/link-follow.ts` 的现有 `wikilinkAt` 必须改为复用，不能留下第二份定位语义；没有消费者则不要新增 helper。
- 移动层：默认不改 `src/editor.ts`。只有属性测试证明「事务后仍隐藏」的死区存在时才补共享钳制，且必须有区分度反例证明不会拦截 wikilink 内部落点。
- 验证：前端 unit、相关 visual、`scripts/gate.sh visual`（本 change 修改 live preview 渲染语义）与新增真机验收场景。真机守 WKWebView 下点击、键入和文档不变；精确 caret 坐标留在 visual，不用不可读值充当空值。
