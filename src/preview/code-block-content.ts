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
