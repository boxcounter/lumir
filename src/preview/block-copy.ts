// 块级复制的内容口径（change block-copy-affordance，capability editor-live-preview）。
//
// 所有切片都取自**文档模型**（EditorState 的文本），MUST NOT 从渲染态 DOM 取文本：
// 渲染态里表头分隔行不存在（livePreview 的 Decoration.replace）、cell 内是渲染后的 inline
// 形态、被 widget 整块替换的块（mermaid）里连源码行都没有。用户要的是「文档里的写法」。
//
// 三条口径（delta《块级复制的内容与反馈》的正文）：
//   - 表格 = `Table` 语法节点范围的源码切片：含表头分隔行、含用户自己写的对齐填充与短行
//     写法；前后不补空行、不追加尾换行。
//   - 围栏块 = `CodeText` 子节点切片（探针读数：它正好是围栏之间的内容，天然不含围栏行与
//     语言标记，天然无尾换行）。
//   - 缩进块 = 块内**相邻 `CodeText` 子节点**文本按序拼接（节点之间的间隙正是「它是代码块」
//     的那层语法缩进，MUST NOT 计入），内容自身的相对缩进因此保留。
//
// 换行归一：切片结果是 `EditorState` 的模型文本（LF），即使源文件是 CRLF——这是「从模型
// 复制」的既有语义，不是本能力新引入的行为（change design §3.1 的读数，写进已知边界）。
//
// 纯函数、无 DOM：`tests/unit/block-copy.test.ts` 直接在 Node 层断言。

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";

// @lezer/common 不是直接依赖（callout.ts / livePreview.ts 同口径），SyntaxNode 类型从
// syntaxTree 推导。
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** 可复制块的两种类型。判据（哪些块有入口）在装饰层与装配层，这一层只吃范围。 */
export type BlockCopyKind = "table" | "codeblock";

/** 「复制哪一块」的坐标：文档里的半开区间 `[from, to)`。 */
export interface BlockCopyRange {
  kind: BlockCopyKind;
  from: number;
  to: number;
}

/** 语法树里 caret 所在的代码块节点（围栏或缩进）；不在块内时 null。
 *
 *  判定沿用 `codeblockOnLine` 的形态（从行首首个非空白字符 `resolveInner` 后逐级上溯父
 *  节点）——同一份判据只写一处（REVIEW.md 第 8 条）。空行也在块内时同样命中：起点退回行首，
 *  解析树把空行归给块的内容节点。 */
export function codeBlockNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  const doc = state.doc;
  const line = doc.lineAt(Math.min(Math.max(pos, 0), doc.length));
  const offset = line.text.search(/\S/);
  const at = offset < 0 ? line.from : line.from + offset;
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(at, 1);
  while (node !== null) {
    if (node.name === "FencedCode" || node.name === "CodeBlock") return node;
    node = node.parent;
  }
  return null;
}

/** 代码块的纯内容：块内全部 `CodeText` 子节点文本按序拼接。
 *
 *  围栏块只有一个 `CodeText`（围栏之间的内容），缩进块每行一个——拼接即「剥掉语法缩进、
 *  保留相对缩进」（节点间隙是那层缩进，不参与拼接）。空块没有 `CodeText`，结果为空串。
 *
 *  **位置基准的坑（实现期实测）**：`SyntaxNode.toTree()` 返回的子树位置是**相对该节点**的，
 *  不是文档绝对位置——直接拿去 `doc.sliceString` 会切出偏移的片段（M277 单测实测：缩进块
 *  `toTree()` 读出 `CodeText 0..7` / `11..17`，而它们的绝对范围是 `4..11` / `15..21`）。
 *  因此一律加上 `block.from` 还原成绝对位置。 */
export function codeBlockContent(doc: Text, block: SyntaxNode): string {
  const base = block.from;
  let out = "";
  block.toTree().iterate({
    enter(ref) {
      if (ref.name === "CodeText") out += doc.sliceString(base + ref.from, base + ref.to);
    },
  });
  return out;
}

/** caret 所在代码块的内容；不在块内时 null。 */
export function codeBlockContentAt(state: EditorState, pos: number): string | null {
  const node = codeBlockNodeAt(state, pos);
  return node === null ? null : codeBlockContent(state.doc, node);
}

/** 按范围取复制文本（触发钮与命令入口共用这一份口径）。
 *
 *  表格直接切 `Table` 节点范围；代码块按 `from` 现取语法树节点，取不到时退化为该范围的
 *  源码切片（结构变了也不静默给出空串）。 */
export function blockCopyText(state: EditorState, range: BlockCopyRange): string {
  if (range.kind === "table") return state.doc.sliceString(range.from, range.to);
  const node = codeBlockNodeAt(state, range.from);
  return node === null ? state.doc.sliceString(range.from, range.to) : codeBlockContent(state.doc, node);
}
