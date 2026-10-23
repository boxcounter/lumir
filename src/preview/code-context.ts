// 「某个位置是否落在代码上下文里」的单一判据（change add-image-quote-to-chat 的模块图拆分）。
//
// 为什么单独一个模块：`src/preview/math.ts` 里原本导出它，但 math.ts 有**参数属性**构造器——
// `tests/unit` 的 Node strip-only 类型剥离会直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（同
// `src/session-kind.ts` / `src/paste-image.ts` 的拆法）。选区图片枚举（`attachments.ts` 的
// `collectImageRefs`）需要在零 DOM 单测里直接跑，而它必须与装饰层用**同一份**代码上下文判据
//（REVIEW.md 「同一语义两处真源」条：MUST NOT 在枚举层另写一份节点名集合）。
//
// 语义：pos 落在 fenced / indented / inline code 或 HTML block 内即真。只读语法树，零 DOM。

import { syntaxTree } from "@codemirror/language";

const CODE_NODE_NAMES = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"]);

/** pos 是否落在代码上下文（fenced/indented/inline code、HTML block）内。 */
export function isInsideCodeContext(tree: ReturnType<typeof syntaxTree>, pos: number): boolean {
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = tree.resolveInner(pos, 0);
  while (node) {
    if (CODE_NODE_NAMES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}
