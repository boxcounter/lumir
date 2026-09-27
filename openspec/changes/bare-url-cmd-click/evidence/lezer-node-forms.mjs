// 裸 URL / 链接定义行在 lezer 语法树里的节点形态——本 change 设计口径的实测底稿。
//
// 用法（必须在仓根 = 有 node_modules 的那一层跑；脚本自身按 cwd 解析 @lezer/markdown）：
//   cd <仓根>
//   node openspec/changes/bare-url-cmd-click/evidence/lezer-node-forms.mjs
//
// 读出的节点形态（父节点是谁、有没有 URL 子节点、代码上下文里有没有 URL 节点）决定
// 「判据怎么写」与「哪些上下文天然排除」，全部结论以本脚本的输出为准。
// 记录输出见同目录 lezer-node-forms.txt。

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// createRequire 的入参按「文件路径」解释：传目录会把 node_modules 查找起点上移一层，
// 必须补一个文件名，才能命中 cwd 下的 node_modules。
const require = createRequire(join(process.cwd(), "package.json"));
const { parser, GFM } = require("@lezer/markdown");
// @lezer/markdown 的 exports 不暴露 ./package.json，从入口文件反推包根再读版本号。
const pkgRoot = join(dirname(require.resolve("@lezer/markdown")), "..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
console.log(`@lezer/markdown ${pkg.version} · GFM 扩展 ${JSON.stringify(["Table", "TaskList", "Strikethrough", "Autolink"])}`);
console.log("配置同 src/editor.ts 的默认 markdownConfig：{ base: markdownLanguage, extensions: [GFM] }\n");

// 每个片段给一个「是不是裸 URL / 定义行」的现场；段间空行保证块级切分。
const doc = [
  "# 形态底稿",
  "",
  "段落里的裸 URL https://bare.example.com/a?b=1#f 与后文。",
  "",
  "https://line-start.example.com 行首裸 URL（打开文件时 caret 复位到 0 的现场）。",
  "",
  "句末裸 URL https://trailing.example.com. 后面是句号。",
  "",
  "尖括号自动链接 <https://angle.example.com> 与包裹形式 [包裹](<https://wrapped.example.com>)。",
  "",
  "[homepage]: https://definition.example.com",
  "",
  "参考式使用点 [正文][ref] 与 [ref]，另有一处用 www.www-literal.example.com 与裸邮箱 a@b.example.com。",
  "",
  "mailto:someone@example.com 与 xmpp:a@b.example.com 是 GFM 的另外两种字面形态。",
  "",
  "[see https://inside-link-label.example.com](https://link-dest.example.com) 的 label 里也有一个 URL。",
  "",
  "![alt https://inside-image-alt.example.com](https://image-dest.example.com)",
  "",
  "```",
  "https://inside-fence.example.com",
  "```",
  "",
  "    https://inside-indented-code.example.com",
  "",
  "行内代码 `https://inside-inline-code.example.com` 不算。",
  "",
  "<!-- https://inside-html-comment.example.com -->",
  "",
  "<div>",
  "https://inside-html-block.example.com",
  "</div>",
  "",
  "| 列 | 说明 |",
  "| --- | --- |",
  "| https://inside-table-cell.example.com | cell 里的裸 URL |",
  "",
  "> [quoted]: https://inside-blockquote.example.com",
  "",
  "- [listed]: https://inside-list.example.com",
  "",
  "[[wikilink]] 与 https://after-wikilink.example.com",
  "",
  "---",
  "frontmatterish: https://inside-setext.example.com",
  "---",
].join("\n");

const tree = parser.configure([GFM]).parse(doc);

function walk(node, depth) {
  const text = doc.slice(node.from, node.to);
  const short = text.length > 46 ? `${text.slice(0, 46)}…` : text;
  console.log(`${"  ".repeat(depth)}${node.name} [${node.from},${node.to}) ${JSON.stringify(short)}`);
  for (let c = node.firstChild; c; c = c.nextSibling) walk(c, depth + 1);
}
walk(tree.topNode, 0);
