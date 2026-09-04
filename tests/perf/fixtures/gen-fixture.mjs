// fixture 确定性再生成器（spec §3）：输出恰好 1,048,576 字节的 UTF-8 纯 ASCII Markdown。
// 字节级确定——无时间戳、无随机数；fixture 内容变更只能改本脚本并重新生成。
// 用法：node tests/perf/fixtures/gen-fixture.mjs
import { writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET_BYTES = 1_048_576; // 1 MiB
const OUT = path.join(new URL(".", import.meta.url).pathname, "markdown-1mb.md");

// 循环节：标题、列表、代码围栏、wikilink、frontmatter 片段，模拟真实 vault 的混合结构。
function section(i) {
  return `## Section ${i}: notes on topic-${i % 37}

---
title: Note ${i}
tags: [perf, fixture, batch-${i % 11}]
---

- bullet item ${i}.1 with a [[wikilink-${i % 101}]] reference
- bullet item ${i}.2 with **bold** and *italic* spans
- bullet item ${i}.3 with \`inline code\` and a longer line of prose that pushes the line beyond eighty columns to exercise wrapping paths

\`\`\`rust
fn section_${i}() -> u32 { ${i} }
\`\`\`

A paragraph of plain prose for section ${i}. It exists to make the fixture
look like real Markdown instead of a single repeated token, so parser and
highlighter paths see a plausible mix of constructs.

`;
}

let content = "";
let i = 0;
// 预留余量：末段用填充行补足到精确字节数
while (Buffer.byteLength(content, "utf8") < TARGET_BYTES - 4096) {
  content += section(i++);
}
// 填充至恰好 TARGET_BYTES：单行 HTML 注释 + 换行
const padLine = "<!-- pad: exact-size fixture, do not hand-edit; regenerate via gen-fixture.mjs -->\n";
while (Buffer.byteLength(content + padLine, "utf8") <= TARGET_BYTES) {
  content += padLine;
}
const remaining = TARGET_BYTES - Buffer.byteLength(content, "utf8");
if (remaining > 0) {
  // 最后一行不带换行，用短注释精确补齐（<!-- --> 为 8 字节骨架 + 填充字符）
  const min = "<!---->".length;
  if (remaining < min) throw new Error(`cannot pad ${remaining} bytes exactly`);
  content += "<!--" + "x".repeat(remaining - min) + "-->";
}

const bytes = Buffer.byteLength(content, "utf8");
if (bytes !== TARGET_BYTES) throw new Error(`size bug: ${bytes} != ${TARGET_BYTES}`);
if (!/^[\x00-\x7F]*$/.test(content)) throw new Error("fixture must be pure ASCII");

await writeFile(OUT, content);
console.log(`wrote ${OUT}: ${bytes} bytes, ${content.split("\n").length - 1} lines, ${i} sections`);
