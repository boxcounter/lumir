# Proposal: 表格 cell 端点编辑保真——键入与单字符删除只改被点中的源字节

- Change ID: `fix-webkit-table-cell-editing-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始需求与裁决），AI agent（探针 / 起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 对 M842 缺陷的原始要求原文——「M842发现WebKit表格数据cell端点
> 输入/Backspace/Delete走DOM回写并吃空白/管道/毁表，Chromium与表头对照正常。需修caret映射，不用
> 文本护栏。Playwright WebKit只是近似，需真机标定。」tower 在 M855 的 mission 指令中据此立项，并
> 指定「先探针确诊 WebKit cell 端点 caret/回写根因，再最小修复并转正 test.fail」。本 change 不引入
> 新的产品行为或裁决点：修复面与合同由该要求直接决定。

## Why

### 现场

M842 的双引擎编辑矩阵（`tests/visual/scenes/markdown-editing-stability.spec.ts`）在 WebKit 上
发现：grid 表格数据 cell 的内容端点，键入 / Backspace / Delete 会把文档按渲染态 DOM 回写——
键入顶掉 cell 后的源空白、Backspace 摧毁表格结构、Delete 删掉隐藏管道；chromium 同操作逐字节
正确，表头 cell 对照也正确。用户点击 cell 端点即可命中。

### 机制（M855 探针坐实，证据 `.local/probes/2026-11-19-m855-table-cell/`）

cell 间与行首尾的管道符、整条分隔行由 `Decoration.replace({})` 覆盖（零宽，DOM 里没有内容）；
cell slot（含首尾对齐空白）由 `Decoration.mark` 渲染成 CSS grid 的一个 grid item。WebKit 把
slot 首尾的对齐空白当作**块级 padding**，caret 落在 padding 内时原生编辑的 target range 不是
「光标两侧的源字节」，而是跨过零宽 replace 覆盖的隐藏源码：

- **键入**：`beforeinput.getTargetRanges()` 位置本身正确（`text " c " @2 → @2`），但插入后
  DOM 文本从 `" c "` 变成 `" cQ"`——尾部对齐空白被吃掉；CM 的 DOMReader 回读得 `| cQ| d |`。
- **Backspace**（内容首缘）：target range 从**上一行** cell 文本尾一路跨过隐藏管道、换行与
  整条分隔行；DOMReader 回读后表格被摧毁（`| a | b c\n| d |`）。
- **Delete**（内容尾缘）：target range 跨进**下一 cell**（跨过隐藏管道）；结果删掉管道 +
  下一 cell 首缘空白（`| c d |`）。
- chromium 原生路径在全部位置逐字节正确；表头 cell 在 WebKit 上也正确——但闸门命中后表头
  结果必须与数据 cell 同合同。

位置矩阵（9 个位置 × 3 种输入）显示：WebKit 上**所有用户可达的 cell 内位置**都坏，不是某一格
的偶发现场；失败点在「原生编辑的单位是可见 DOM 相邻文本，而不是源字节」。

### 为什么是 state-only 闸门

修 caret 映射有两条路：改装饰层 DOM 结构（让 padding / 隐藏管道有可停靠的 DOM 表示）会动
渲染形态与像素基线，且新增 widget 会再次漏；逐类给表格补文本护栏（检测被吃掉的字符）又违反
「不按 DOM / 文本形状猜意图」。把命中的原生编辑换成**显式 CM 事务**，事务只读 `EditorState`
并按源位置改字节，类别自然闭合——与 M836 的跨行删除闸门同一范式，且复用同一份 cell 几何
（`src/cell-geometry.ts` 的 `cellClamp` / `cellContentRange` 与 ⌃E / 删除命令共用），不引入
第二套 caret 模型。

## What Changes

- 新增 requirement「表格 cell 内的原生键入与单字符删除」：折叠光标落在 grid 表格 cell slot 内
  时，键入 SHALL 只在光标处插入、MUST NOT 改到相邻源字节（含 cell 首尾对齐空白与管道符）；
  Backspace / Delete SHALL 只删光标前 / 后的一个源字节（字素簇口径与 ⌃H / ⌃D 同源），
  MUST NOT 跨过隐藏管道符、换行或分隔行。
- 判据 SHALL 只读 `EditorState`（单折叠光标 + `cellClamp` 的 cell 归属），MUST NOT 读 DOM /
  AX 文本形状、MUST NOT 按字符类型分支。
- 实现：`src/editor.ts` 的统一 beforeinput 闸门 `absorbNativeEdit`（M854 的非空选区
  insert/delete 事务）中新增**折叠 cell 分支**（M855）——非空选区分支先早退，折叠光标落在
  grid 表格 cell slot 内时：`insertText` 用 `event.data` 在 state 光标处显式插入；
  `deleteContentBackward` / `deleteContentForward` 调应用自身的 `deleteCharBackward` /
  `deleteCharForward`；命中即 `preventDefault()`。两段命中面互斥，IME 组合期统一用
  `view.compositionStarted` 放行；只在 md 模式装配（code 模式没有表格渲染与 replace 装饰）。
- 回归：`tests/visual/scenes/markdown-editing-stability.spec.ts` 的表格编辑对抗组把 M842 标
  `knownDefect: webkit` 的四条转正，并补齐数据 cell 首 / 尾缘的键入与双向删除、表头对照组、
  一次 undo 与 `⌘S` 精确落盘。M854 合并后本 spec 的选区删除 / 键入替换用例也全部转正，
  合并结果**不含任何 expected-failure 标记**（`knownDefect` 机制随之删除）；双引擎
  （chromium / webkit-realua）各跑一遍。
- 真机：新增 `scripts/acceptance/scenarios/265-table-cell-webkit-editing.md`（数据 cell 尾缘
  键入 / 首缘 Backspace / 尾缘 Delete / 表头对照，四格均以 `file.exact` 全文 + 撤销不写盘判），
  COVERAGE 随生成脚本更新。

## Non-goals

- 不修非空选区删除（归 M854 / finding `20261119-worker-markdown-stability-bug-dom`）与
  「非空选区 + 键入」跨 cell 的同类回写（M855 探针发现，另行 file finding 由 tower 路由）。
- 不改装饰层 DOM 结构（隐藏管道的 `Decoration.replace`、cell 的 grid item 形态）与像素表现。
- 不接管 Enter / 粘贴 / 拖放 / IME 组合期输入；不按 DOM / AX 形状猜编辑意图。
- 不为多区间选区设计分派：闸门在多区间时放行原生路径。
- 不更新视觉像素基线。

## Impact

- 影响的 specs：editor-live-preview（新增 requirement）。
- 影响的代码：`src/editor.ts`（beforeinput 闸门与装配）、
  `tests/visual/scenes/markdown-editing-stability.spec.ts`、验收场景 265 + COVERAGE。
- 关联约束：ADR 0003 §3 不改写源文件铁律；`openspec/specs/keymap-commands/spec.md` 的
  「删除命令不跨隐藏管道符」继续成立（本 change 把同一纪律扩展到浏览器原生输入入口）。
- 真机边界：M855 期间真机窗口由 tower 串行分配，265 未执行前不得记 PASS。
