// wikilink span 定位（词法范围识别）—— 前端在装饰定位上唯一允许持有的逻辑
// （架构复查 P1-4：语义解析只有 Rust link_graph 一份实现，本模块只回答
// 「哪些字符区间是链接」，不分解语义字段、不做任何解析判断）。
// 词法规则与 Rust parse_links 逐条对应（spec §2：code/frontmatter 内不识别、
// 空 target 与嵌套方括号剔除），同一 cases.json 双喂：Rust 断言解析字段，
// 前端断言本模块的 span/embed（tests/visual/scenes/wikilink.spec.ts）。
//
// 偏移口径：findWikilinkSpans 返回 UTF-16 码元偏移（JS 字符串原生，CM 直接可用）；
// locateWikilinkSpans 返回 Unicode code point 偏移（fixture spanUnit 口径，测试用）。

import { scanFrontmatter, textLineView } from "./frontmatter";
import { findClosingRun, runLen } from "./lexical";

export interface WikilinkSpan {
  /** 整条链接的范围 `[from, to)`，含 `!` 前缀。 */
  from: number;
  to: number;
  /** 是否 `![[...]]` embed 形态。 */
  embed: boolean;
}

interface CharRange {
  from: number;
  to: number;
}

/** UTF-16 偏移版 span 定位（装饰层与点击定位用）。 */
export function findWikilinkSpans(text: string): WikilinkSpan[] {
  const excluded = excludedRanges(text);
  const spans: WikilinkSpan[] = [];
  let i = 0;
  let xi = 0;
  while (i < text.length) {
    while (xi < excluded.length && i >= excluded[xi].to) xi++;
    if (xi < excluded.length && i >= excluded[xi].from) {
      i = excluded[xi].to;
      continue;
    }
    const c = text[i];
    // inline code：N 个反引号开启，恰好 N 个反引号闭合（GFM）；找不到闭合则按原文。
    if (c === "`") {
      const run = runLen(text, i, "`");
      const end = findClosingRun(text, i + run, run);
      i = end === null ? i + run : end;
      continue;
    }
    const embed = c === "!" && text.startsWith("[[", i + 1);
    const plain = c === "[" && text[i + 1] === "[" && text[i - 1] !== "!";
    if (embed || plain) {
      const end = scanLinkEnd(text, i, embed);
      if (end !== null) {
        spans.push({ from: i, to: end, embed });
        i = end;
      } else {
        i += embed ? 3 : 2;
      }
      continue;
    }
    i++;
  }
  return spans;
}

/** code point 偏移版 span 定位（fixture 断言用，spanUnit: unicode-code-point）。 */
export function locateWikilinkSpans(text: string): WikilinkSpan[] {
  return findWikilinkSpans(text).map((s) => ({
    from: [...text.slice(0, s.from)].length,
    to: [...text.slice(0, s.to)].length,
    embed: s.embed,
  }));
}

/**
 * 从 start 处（`!` 或首个 `[`）尝试识别一条链接，合法返回闭合 `]]` 之后的偏移。
 * 合法性只做词法判定（§2.4）：target 去空白后非空、不嵌套方括号、分解后有目标。
 */
function scanLinkEnd(text: string, start: number, embed: boolean): number | null {
  const openLen = embed ? 3 : 2;
  let j = start + openLen;
  while (j + 1 < text.length) {
    const c = text[j];
    if (c === "[" || c === "\n") return null;
    if (c === "]") {
      if (text[j + 1] === "]") break;
      return null; // target 内含 ]（不嵌套）
    }
    j++;
  }
  if (j + 1 >= text.length) return null;
  const inner = text.slice(start + openLen, j);
  const pipe = inner.indexOf("|");
  const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  if (target === "") return null; // 空 target
  const segs = target.split("#");
  const path = segs[0].trim();
  const hasHeading = segs.slice(1).some((s) => s.trim() !== ""); // 空 heading 段忽略
  if (path === "" && !hasHeading) return null; // 如 `[[#]]`：无任何目标
  return j + 2;
}

/** 不解析为链接的区块（§2.3）：frontmatter 与 fenced code block。 */
function excludedRanges(text: string): CharRange[] {
  const lines = textLineView(text);
  const ranges: CharRange[] = [];
  // frontmatter：判定与上限同源（frontmatter.ts 的 scanFrontmatter，MAX_FRONTMATTER_LINES
  // 单一常量）——装饰层的 properties 区块与这里排除的必须是同一段文字。
  const fm = scanFrontmatter(lines);
  let n = 1;
  if (fm !== null) {
    ranges.push({ from: fm.from, to: fm.to });
    n = fm.closeLine + 1;
  }
  // fenced code block：行首 3+ 个相同 ` 或 ~ 开启，同样字符、长度 >= 开启串的纯围栏行闭合。
  let fence: { ch: string; len: number } | null = null;
  for (; n <= lines.lines; n++) {
    const line = lines.line(n);
    if (fence === null) {
      const trimmed = line.text.trimStart();
      const fc = trimmed[0];
      if (fc === "`" || fc === "~") {
        const run = runLen(trimmed, 0, fc);
        if (run >= 3) {
          fence = { ch: fc, len: run };
          ranges.push({ from: line.from, to: line.to });
        }
      }
    } else {
      ranges.push({ from: line.from, to: line.to });
      const open = fence;
      const t = line.text.trim();
      if (t.length > 0 && t.length >= open.len && [...t].every((c) => c === open.ch)) {
        fence = null;
      }
    }
  }
  return ranges;
}
