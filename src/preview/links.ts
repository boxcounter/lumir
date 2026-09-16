// 标准 Markdown 链接的定位与「外链」判定（M144）。
//
// 装饰层与激活路径都要回答同一个问题——「这个位置上是不是标准链接、它指向哪」。
// 本模块是该问题在前端的唯一答案，且它**不自己写词法**：标准链接的语法判定一律
// 取自 lezer 语法树（`Link` 节点 + `URL` 子节点），与 wikilinks.ts 的纪律同源
//（那里必须手写词法是因为 Obsidian 方言没有语法树；标准 Markdown 有）。
//
// 「外链」的口径是 scheme 白名单：http / https / mailto——只有这三类能交给系统
// 默认应用接管。相对路径链接（`[x](note.md)`）与纯锚点链接不在本版能力范围
//（add-wikilink 的 proposal 已把它记为独立 change 候选），本模块对它们返回 null，
// 装饰层原样留着源码，激活路径不做任何事。
//
// 引用式链接（`[text][ref]`、`[ref]`）不在范围内：lezer 不把链接定义里的 URL 挂到
// 引用处，拿不到目标就不该猜，一律当普通文本。

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type DocText = EditorState["doc"];

/** 允许交给系统默认应用打开的 scheme（小写）。其余 scheme 一律不打开。 */
export const EXTERNAL_URL_SCHEMES = ["http", "https", "mailto"] as const;

/** 组件的 `[title](url)` 三段位置：整条范围、显示文本范围、URL 原文。 */
export interface StandardLinkParts {
  /** 整条链接 `[title](url)` 的 `[from, to)`。 */
  from: number;
  to: number;
  /** 显示文本 title 的 `[from, to)`（`[` 之后到 `]` 之前）。 */
  labelFrom: number;
  labelTo: number;
  /** URL 原文（未解码转义、未去尖括号）。 */
  target: string;
}

/** scheme 判定与解码后的目标（`target` 为合法外链时非 null）。 */
export interface ExternalLink {
  /** 交给系统打开的目标（已去尖括号与转义）。 */
  url: string;
  from: number;
  to: number;
}

const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// CommonMark 链接目标里的反斜杠转义（§2.4）：`\)` 表示字面 `)`，`\\` 表示 `\`。
const PUNCT_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/**
 * 分解一个 `Link` 节点：显示文本区间与 URL 原文。
 * 非标准形态（引用式链接、未闭合）返回 null——调用方据此保持原文。
 */
export function standardLinkParts(node: SyntaxNode, doc: DocText): StandardLinkParts | null {
  const url = node.getChild("URL");
  if (!url) return null;
  // 子节点顺序固定为 `[`、label、`]`、`(`、URL、`)`；取前两个 LinkMark 即定出
  // 显示文本区间（label 内部的强调标记不是 LinkMark，不会混进来）。
  const marks: { from: number; to: number }[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
  }
  if (marks.length < 2) return null;
  return {
    from: node.from,
    to: node.to,
    labelFrom: marks[0].to,
    labelTo: marks[1].from,
    target: doc.sliceString(url.from, url.to),
  };
}

/**
 * 外链目标判定：scheme 在白名单内时返回可交给系统打开的目标，否则 null。
 * 去尖括号（`[a](<https://x>)` 是 CommonMark 的包裹形式）并解码反斜杠转义；
 * 解码后仍含空白或控制字符的一律拒绝——那说明我们对这条目标的还原不可信，
 * 宁可不开也不要把坏 URL 递给系统。
 */
export function externalUrlOf(target: string): string | null {
  let text = target.trim();
  if (text.startsWith("<") && text.endsWith(">")) text = text.slice(1, -1).trim();
  const scheme = URL_SCHEME.exec(text);
  if (!scheme) return null;
  if (!(EXTERNAL_URL_SCHEMES as readonly string[]).includes(scheme[1].toLowerCase())) return null;
  const url = text.replace(PUNCT_ESCAPE, "$1");
  if (/[\s\u0000-\u001f]/.test(url)) return null;
  return url;
}

/**
 * 光标位置上的外链（没有则 null）。
 *
 * 语法树同步推进的理由与 livePreview 的表格发现同款（M110/M111 实证）：
 * `syntaxTree(state)` 是事务落地时的快照，大文档刚打开时可能还没覆盖到光标处，
 * 此时直接查会「什么都没找到」——⌘⏎ 静默无反应正是最坏的一类失败。已在覆盖
 * 范围内时 `ensureSyntaxTree` 零开销短路，未覆盖时才同步推进至多 25ms。
 * 这条路径只在显式激活链接时走（不是键入路径），不在性能合同的 keypress 口径内。
 *
 * 两个 side 都要试：光标停在链接**起点**上时（`[` 所在位置）`resolveInner(pos, 0)`
 * 给的是父节点（Paragraph / Document），取不到链接；只有 side 1 才从该位置开始取。
 * 起点算「在链接上」——渲染态下光标就停在显示文本之前，用户认的就是这个位置；
 * 打开一个首字符就是链接的文件时选区复位到 0，正好落在这个位置上（实测用例见
 * tests/visual/scenes/render-link.spec.ts 的「起点」场景）。
 */
export function externalLinkAt(state: EditorState, pos: number): ExternalLink | null {
  const tree = ensureSyntaxTree(state, pos, 25) ?? syntaxTree(state);
  for (const side of [0, 1] as const) {
    const link = externalLinkOfNode(tree.resolveInner(pos, side), state.doc);
    if (link !== null) return link;
  }
  return null;
}

/** 自节点向上找最近的标准链接：是外链则返回目标，否则 null（图片 / 非外链 / 不在链接上）。 */
function externalLinkOfNode(node: SyntaxNode, doc: DocText): ExternalLink | null {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name === "Image") return null;
    if (n.name !== "Link") continue;
    const parts = standardLinkParts(n, doc);
    if (!parts) return null;
    const url = externalUrlOf(parts.target);
    return url === null ? null : { url, from: parts.from, to: parts.to };
  }
  return null;
}
