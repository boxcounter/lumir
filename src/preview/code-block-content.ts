// 代码块全屏浮层的内容计划（change code-block-fullscreen，design §2.2 / §6）。
//
// 浮层内容 = **该块的整块源码**，MUST NOT 随编辑器视口截断（CM 只渲染视口附近的行，克隆路径
// 会让长块在全屏里读到一半而无路可走）。呈现复用文档内代码块的同一份口径：
//   - 行与头部条取既有 class（`cm-lp-codeblock-line` / `cm-lp-codeblock-head`）；
//   - 着色取同一个纯函数出口 `highlightCode`（同一份语言表与缓存）与既有 token class
//     （`cm-lp-tok-*`）；
//   - 块的**首行**在该块带 `CodeMark`（围栏块的起始围栏）时以头部条形态呈现（既有口径：
//     围栏行即头部条，尾围栏是普通代码行；缩进代码块没有围栏行，因此没有头部条）。
//
// 内容规模 SHALL 以既有的单块着色上限（`MAX_CODE_HIGHLIGHT_CHARS`，64 KiB）为界，MUST NOT 为
// 全屏另立新阈值：不超过上限的块按「行 + token」呈现；超过上限的块以**单块纯文本**呈现整块
// 源码（同一份源码、逐字节一致；不逐行建 DOM、不着色，行样式由浮层容器承担）。
//
// 纯函数、无 DOM：`tests/unit/code-block-fullscreen.test.ts` 直接断言切分口径。
//
// M634（change add-harness-block-fullscreen）：文档里的代码块节点 → 呈现计划的**映射**也落在
// 本文件（`planCodeBlockOfDocument`）。编辑器侧（src/preview/livePreview.ts 的 codeBlockRender）
// 与 harness 面板侧（src/harness-panel.ts 的块渲染）各有一份调用方，映射规则只有这一份
// （REVIEW.md「同一语义两处真源」条：两侧的头部条 / info 语言 / 64 KiB 上限因此不可能漂移）。

import type { syntaxTree } from "@codemirror/language";
import { highlightCode, MAX_CODE_HIGHLIGHT_CHARS } from "./code";
import type { CodeToken } from "./code";

export interface CodeBlockLine {
  /** 行文本（不含换行）。 */
  text: string;
  /** 头部条行（围栏块的起始围栏行）；缩进块恒为 false。 */
  head: boolean;
  /** 相对**本行起点**的着色区间（`highlightCode` 的输出按行裁切后的结果）。 */
  tokens: readonly CodeToken[];
}

export type CodeBlockRender =
  | { kind: "lines"; lines: CodeBlockLine[] }
  | { kind: "plain"; text: string };

/**
 * 按行 + token 切分。
 *
 * `source` 是块的整块源码（含围栏行）；`codeFrom` 是内容起点相对块起点的偏移（围栏块的
 * `CodeText.from - block.from`）；`codeSource` 是该块的内容文本（`CodeText` 子节点拼接，
 * 与 `src/preview/block-copy.ts` 的 `codeBlockContent` 同源）；`headFirstLine` 表示首行是围栏行。
 *
 * 缩进块的 `codeSource` 与 `source` 的偏移不线性对应（节点间隙是语法缩进），但缩进块没有 info
 * string ⇒ `highlightCode` 恒定返回空表，token 切分对它是空操作——这里如实说明，不假装两轴对齐。
 */
export function planCodeBlock(
  source: string,
  codeFrom: number,
  codeSource: string,
  headFirstLine: boolean,
  info: string,
): CodeBlockRender {
  if (codeSource.length > MAX_CODE_HIGHLIGHT_CHARS) return { kind: "plain", text: source };
  const tokens = highlightCode(codeSource, info);
  const lines: CodeBlockLine[] = [];
  const raw = source.split("\n");
  let lineStart = 0;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i];
    const lineFrom = lineStart;
    const lineTo = lineStart + text.length;
    lineStart = lineTo + 1;
    const local: CodeToken[] = [];
    for (const token of tokens) {
      const from = codeFrom + token.from;
      const to = codeFrom + token.to;
      if (to <= lineFrom || from >= lineTo) continue;
      const clipped = { from: Math.max(from, lineFrom) - lineFrom, to: Math.min(to, lineTo) - lineFrom, cls: token.cls };
      if (clipped.to > clipped.from) local.push(clipped);
    }
    lines.push({ text, head: headFirstLine && i === 0, tokens: local });
  }
  return { kind: "lines", lines };
}

// ---------------------------------------------------------------------------
// 文档里的代码块节点 → 呈现计划（M634：编辑器与 harness 面板共用的唯一映射）
// ---------------------------------------------------------------------------

/** 语法节点：从 `syntaxTree` 推导（@lezer/common 不是直接依赖，本仓同口径——见 block-copy.ts）。 */
type CodeBlockNode = ReturnType<typeof syntaxTree>["topNode"];

/** 文档切片的两种来源：CM 的 `Text`（`sliceString` / `lineAt`）与 harness 面板手里的纯字符串。
 *  两者都满足这个结构形状，共享映射因此不需要任何一侧先 `toString()` 一份全文。 */
export interface CodeBlockDocumentSource {
  sliceString(from: number, to: number): string;
  lineAt(pos: number): { readonly from: number };
}

function docSlice(doc: string | CodeBlockDocumentSource, from: number, to: number): string {
  return typeof doc === "string" ? doc.slice(from, to) : doc.sliceString(from, to);
}

/** 位置所在**行首**的偏移。
 *
 *  缩进代码块的语法节点从缩进之后起算（`    x` 的 `CodeBlock` 从第 5 个字符开始），只按
 *  `node.from` 切片会让首行丢掉语法缩进、后续行却带着——块内对不齐。编辑器侧的块范围一直
 *  按行首对齐（`livePreview.codeBlocksIn` 的 `doc.lineAt(...).from`），共享映射因此也按行首取：
 *  围栏块不受影响（节点本来就在行首），缩进块的首行缩进得以保留。 */
function lineStartOf(doc: string | CodeBlockDocumentSource, pos: number): number {
  return typeof doc === "string" ? doc.lastIndexOf("\n", pos - 1) + 1 : doc.lineAt(pos).from;
}

/** 块的纯内容：块内全部 `CodeText` 子节点文本按序拼接（复制口径与全屏口径同一份）。
 *
 *  `toTree()` 返回的子树位置是**相对该节点**的（见 block-copy.ts 的「位置基准的坑」），因此
 *  一律加 `block.from` 还原成绝对位置再切片。 */
export function codeTextOf(doc: string | CodeBlockDocumentSource, block: CodeBlockNode): string {
  const base = block.from;
  let out = "";
  block.toTree().iterate({
    enter(ref) {
      if (ref.name === "CodeText") out += docSlice(doc, base + ref.from, base + ref.to);
    },
  });
  return out;
}

/**
 * 代码块语法节点 → 全屏呈现计划（编辑器侧 `livePreview.codeBlockRender` 与 harness 面板的块
 * 渲染共用这一条映射）。
 *
 * 四个参数的来历（各只有一处判据）：
 *   - `source`：块范围的源码切片（围栏块的围栏行因此进得了头部条）；
 *   - `codeFrom`：内容起点相对块起点的偏移（围栏块的 `CodeText.from - block.from`）；
 *   - `codeSource`：`codeTextOf` 的拼接结果（64 KiB 上界的判据与复制口径同源）；
 *   - `headFirstLine`：块带 `CodeMark`（围栏）时首行是围栏行（缩进块恒 false）。
 *  `info` 原样取自 `CodeInfo`（`highlightCode` 自己按空白切语言，两侧因此逐字同口径）。
 */
export function planCodeBlockOfDocument(
  doc: string | CodeBlockDocumentSource,
  node: CodeBlockNode,
): CodeBlockRender {
  const textNode = node.getChild("CodeText");
  const infoNode = node.getChild("CodeInfo");
  const from = lineStartOf(doc, node.from);
  return planCodeBlock(
    docSlice(doc, from, node.to),
    textNode === null ? 0 : textNode.from - from,
    codeTextOf(doc, node),
    node.getChild("CodeMark") !== null,
    infoNode === null ? "" : docSlice(doc, infoNode.from, infoNode.to),
  );
}
