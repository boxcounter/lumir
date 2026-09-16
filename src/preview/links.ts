// 标准 Markdown 链接的定位与形态分类（M144 起，M145 扩到全形态）。
//
// 装饰层与激活路径都要回答同一个问题——「这个位置上是不是标准链接、它指向哪、属于
// 哪一类」。本模块是该问题在前端的唯一答案，且它**不自己写词法**：标准链接的语法判定
// 一律取自 lezer 语法树（`Link` 节点 + `URL` 子节点），与 wikilinks.ts 的纪律同源
//（那里必须手写词法是因为 Obsidian 方言没有语法树；标准 Markdown 有）。
//
// 分类的判据只有两条，且都取自目标原文（不看文件是否存在——装饰与激活解耦，
// 「解析得到吗」是激活时才问的问题）：
// 1. **有 scheme**：白名单（http / https / mailto）内 = 外链；白名单外（`javascript:` /
//    `file:` / 应用自定义协议）一律 blocked——保持原文不装饰，也不给激活入口。
// 2. **无 scheme**：`#…` = 纯锚点；其余按路径段（`#fragment` 忽略）的末段看——`.md`
//    结尾或没有扩展名 = vault 内笔记（`→`，应用内跳转），目录（以 `/` 结尾）或其它
//    扩展名 = vault 内资产（`↗︎`，交系统默认应用）。
//
// 引用式链接（`[text][ref]`、`[ref]`）不在范围内：lezer 不把链接定义里的 URL 挂到
// 引用处，拿不到目标就不该猜，一律当普通文本。

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
type DocText = EditorState["doc"];

/** 允许交给系统默认应用打开的 scheme（小写）。其余 scheme 一律不打开。 */
export const EXTERNAL_URL_SCHEMES = ["http", "https", "mailto"] as const;

/** 链接类别：装饰标记与激活路径都由它决定（M145 的形态矩阵）。 */
export type LinkKind = "external" | "internal" | "asset" | "anchor" | "blocked";

/**
 * 一条标准链接的形态。
 * - `external`：http / https / mailto，交系统默认应用（标记 ↗︎）
 * - `internal`：vault 内 md（相对路径，或 `/` 开头的根相对）→ 应用内跳转（标记 →）
 * - `asset`：vault 内非 md 文件或目录 → 交系统默认应用（标记 ↗︎）
 * - `anchor`：纯锚点 `#section` → 应用内语义，但激活只给提示（标记 →）
 * - `blocked`：白名单外 scheme / 空目标 / 控制字符 —— 保持原文，不装饰也不激活
 */
export type LinkForm =
  | { kind: "external"; url: string }
  | { kind: "internal"; target: string }
  | { kind: "asset"; target: string }
  | { kind: "anchor" }
  | { kind: "blocked" };

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

/** 光标位置上的一条标准链接：三段位置 + 形态分类。 */
export interface StandardLink extends StandardLinkParts {
  form: LinkForm;
}

const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// CommonMark 链接目标里的反斜杠转义（§2.4）：`\)` 表示字面 `)`，`\\` 表示 `\`。
const PUNCT_ESCAPE = /\\([!-/:-@[-`{-~])/g;
// 控制字符：目标里混进它说明我们对这条目标的还原不可信（见 classifyLinkTarget）。
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

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
 * 链接目标原文 → 形态。这是前端唯一的分类实现，装饰与激活共用。
 *
 * 去尖括号（`[a](<https://x>)` 是 CommonMark 的包裹形式）并解码反斜杠转义；解码后
 * 含控制字符的一律 blocked——那说明我们对这条目标的还原不可信，宁可不开也不要把
 * 坏目标递给下游（外链的空白拒绝护栏同源，见 M144 的 scheme 校验注释）。
 *
 * 路径里允许空白：`[x](<my note.md>)` 是合法的本地路径写法，目标只交给 vault 内的
 * 路径解析（不经 shell、不经 URL 解析），空白不构成「还原不可信」。
 */
export function classifyLinkTarget(target: string): LinkForm {
  const text = target.trim().replace(/^<(.*)>$/, "$1").trim();
  const scheme = URL_SCHEME.exec(text);
  if (scheme) {
    const label = scheme[1].toLowerCase();
    if (!(EXTERNAL_URL_SCHEMES as readonly string[]).includes(label)) return { kind: "blocked" };
    const url = decodeEscapes(text);
    if (/[\s\u0000-\u001f]/.test(url)) return { kind: "blocked" };
    return { kind: "external", url };
  }
  if (text.startsWith("#")) return { kind: "anchor" };
  const path = decodeEscapes(text);
  if (path === "" || CONTROL_CHAR.test(path)) return { kind: "blocked" };
  // 形态只看路径段——`#fragment` 是锚点，M145 口径下忽略；交给下游的仍是**原样目标**，
  // 路径归一与锚点剥离的语义只有 Rust link_graph 一份（前端不复制一遍再漂移）。
  const pathPart = path.split("#")[0];
  if (pathPart.endsWith("/")) return { kind: "asset", target: path }; // 目录：明确指路，交系统
  const last = pathPart.split("/").pop() ?? "";
  // 有 `.md` 后缀或没有扩展名 → 指一篇笔记（`[配置](配置)` 与 `[[配置]]` 同一个意图）
  if (last.toLowerCase().endsWith(".md") || !last.includes(".")) {
    return { kind: "internal", target: path };
  }
  return { kind: "asset", target: path };
}

function decodeEscapes(text: string): string {
  return text.replace(PUNCT_ESCAPE, "$1");
}

/**
 * 光标位置上的标准链接（没有则 null）。
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
export function standardLinkAt(state: EditorState, pos: number): StandardLink | null {
  const tree = ensureSyntaxTree(state, pos, 25) ?? syntaxTree(state);
  for (const side of [0, 1] as const) {
    const link = linkOfNode(tree.resolveInner(pos, side), state.doc);
    if (link !== null) return link;
  }
  return null;
}

/** 自节点向上找最近的标准链接：命中则返回三段位置与形态，否则 null（图片 / 不在链接上）。 */
function linkOfNode(node: SyntaxNode, doc: DocText): StandardLink | null {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name === "Image") return null;
    if (n.name !== "Link") continue;
    const parts = standardLinkParts(n, doc);
    if (!parts) return null;
    return { ...parts, form: classifyLinkTarget(parts.target) };
  }
  return null;
}
