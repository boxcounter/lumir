// Math/LaTeX 渲染（foundation-markdown「Math（LaTeX）」用户裁决，M105 选型 KaTeX）。
// 词法检测仿 findWikilinkSpans：findMathSpans 只回答「哪些字符区间是数学公式」，
// 代码上下文排除（fenced/inline code）在装饰层按语法树判定。渲染用 KaTeX
// renderToString 同步产出 HTML，嵌入 WidgetType.toDOM；结果按源码缓存。
// 失败降级：解析失败回落为「提示 + 完整原文」，不伪装已支持；装饰只改视图，
// 文档文本不动，选择/复制输出原始 Markdown（与其他 replace 装饰同口径）。
// KaTeX 无 eval，CSS 经 style.css @import 本地打包（字体走 vite asset，'self' 符合
// 现有 CSP，无需改动）；CSS 不在本模块侧效应导入，保证 Node 端测试可直接 import。

import katex from "katex";
import { Decoration, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type { EditorState, Range } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { detectFrontmatter } from "./frontmatter";
import { findTables, tableAt } from "./table";
import type { TableModel } from "./table";

export interface MathSpan {
  /** 整条公式的范围 `[from, to)`，含定界 `$` / `$$`。 */
  from: number;
  to: number;
  /** 是否 `$$...$$` 块级形态（可跨行）。 */
  display: boolean;
}

/**
 * 词法扫描 `$...$`（行内，不跨行）与 `$$...$$`（块级，可跨行）span。
 * 规则（Pandoc 口径）：行内开启 `$` 右侧不得为空白，闭合 `$` 左侧不得为空白、
 * 右侧不得紧跟数字（排除 `$5 and $10` 这类货币写法）；`\$` 为转义不界定；
 * 反引号 inline code run 内的 `$` 不识别（fenced code 由装饰层按语法树排除）。
 */
export function findMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && text[i + 1] === "$") {
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = runLen(text, i, "`");
      const end = findClosingRun(text, i + run, run);
      i = end === null ? i + run : end;
      continue;
    }
    if (c !== "$") {
      i++;
      continue;
    }
    if (text[i + 1] === "$") {
      const end = scanBlockEnd(text, i + 2);
      if (end !== null) {
        spans.push({ from: i, to: end, display: true });
        i = end;
      } else {
        i += 2;
      }
      continue;
    }
    const end = scanInlineEnd(text, i + 1);
    if (end !== null) {
      spans.push({ from: i, to: end, display: false });
      i = end;
    } else {
      i++;
    }
  }
  return spans;
}

/** 从 from 起找块级闭合 `$$`（允许跨行），返回闭合串之后的偏移。 */
function scanBlockEnd(text: string, from: number): number | null {
  let j = from;
  while (j + 1 < text.length) {
    if (text[j] === "\\" && text[j + 1] === "$") {
      j += 2;
      continue;
    }
    if (text[j] === "$" && text[j + 1] === "$") return j + 2;
    j++;
  }
  return null;
}

/** 从 from 起找行内闭合 `$`（同行），返回闭合符之后的偏移。 */
function scanInlineEnd(text: string, from: number): number | null {
  const first = text[from];
  if (first === undefined || first === " " || first === "\t" || first === "\n" || first === "$") {
    return null;
  }
  let j = from;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n") return null;
    if (c === "\\" && text[j + 1] === "$") {
      j += 2;
      continue;
    }
    if (c === "$") {
      const prev = text[j - 1];
      const next = text[j + 1];
      if (prev !== " " && prev !== "\t" && !(next >= "0" && next <= "9")) return j + 1;
    }
    j++;
  }
  return null;
}

function runLen(text: string, from: number, c: string): number {
  let n = 0;
  while (text[from + n] === c) n++;
  return n;
}

/** 从 from 起找长度恰好为 n 的反引号闭合串（GFM inline code 规则）。 */
function findClosingRun(text: string, from: number, n: number): number | null {
  let k = from;
  while (k < text.length) {
    if (text[k] === "`") {
      const run = runLen(text, k, "`");
      if (run === n) return k + n;
      k += run;
    } else {
      k++;
    }
  }
  return null;
}

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

// ---------------------------------------------------------------------------
// 渲染：KaTeX renderToString 同步产出 HTML，按「模式 + 源码」缓存（含失败结果，
// 避免装饰重建时重复抛错）。缓存设上限，超限整批清空（重建成本是一次重新渲染）。
// ---------------------------------------------------------------------------

const RENDER_CACHE_LIMIT = 2000;

type RenderResult = { html: string } | { error: string };

const renderCache = new Map<string, RenderResult>();

/** 渲染一条公式；失败返回 error（消息取首行），不抛。 */
export function renderMath(source: string, displayMode: boolean): RenderResult {
  const key = `${displayMode ? "D" : "I"}\n${source}`;
  const hit = renderCache.get(key);
  if (hit) return hit;
  let result: RenderResult;
  try {
    result = { html: katex.renderToString(source, { displayMode, throwOnError: true }) };
  } catch (e) {
    result = { error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear();
  renderCache.set(key, result);
  return result;
}

/** 测试钩子：当前缓存条目数。 */
export function mathRenderCacheSize(): number {
  return renderCache.size;
}

// 点击进入编辑态（M111 真实桌面缺陷）：replace widget 整体隐藏源码，CM 对 widget
// 内事件默认 ignoreEvent、不放置光标，点击渲染态公式因此无处落点。与 callout/
// 表格同口径：点击即显露源码并把光标放到点击处。先把光标送入 span 内触发显露
//（选区重叠口径，装饰同步重建），源码上屏后再用同一点位 posAtCoords 精确定位，
// 钳制在 span 内部（落在边界会重新触发渲染态）。
// M112 起与 mermaid 共用：preventDefault 同时挡住浏览器原生 caret 进入 widget
// DOM——异步重建（如 mermaid settle）替换 widget 节点后，原生选区锚点若滞留在
// 游离节点上，selectionchange 读取时 posFromDOM 会把它映射为 0（点击落点跳到
// 文档起点）；preventDefault 后 CM 不再读取这条原生选区，该路径被掐断。
// innerFrom/innerTo 是相对块起点的光标钳制区间（公式为定界符内侧，mermaid 为
// 开围栏行之后到闭围栏行之前）。
export function enterReplacedSource(
  event: MouseEvent,
  view: EditorView,
  dom: HTMLElement,
  innerFrom: number,
  innerTo: number,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const from = view.posAtDOM(dom);
  view.dispatch({ selection: { anchor: from + innerFrom }, userEvent: "select.pointer" });
  const exact = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (exact !== null) {
    const clamped = Math.min(Math.max(exact, from + innerFrom), from + innerTo);
    if (clamped !== from + innerFrom) {
      view.dispatch({ selection: { anchor: clamped }, userEvent: "select.pointer" });
    }
  }
  view.focus();
}

function enterMathSource(event: MouseEvent, view: EditorView, dom: HTMLElement, delimiter: number, rawLength: number): void {
  enterReplacedSource(event, view, dom, delimiter, rawLength - delimiter);
}

/** 行内公式 widget：渲染成功显示公式；失败回落为完整原文 + 失败提示。 */
class InlineMathWidget extends WidgetType {
  constructor(readonly source: string, readonly raw: string) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-lp-math cm-lp-math-inline";
    const result = renderMath(this.source, false);
    if ("html" in result) {
      el.innerHTML = result.html;
      el.title = this.raw;
    } else {
      el.classList.add("cm-lp-math-fallback");
      el.textContent = this.raw;
      el.title = `公式解析失败：${result.error}`;
    }
    el.addEventListener("mousedown", (event) => enterMathSource(event, view, el, 1, this.raw.length));
    return el;
  }
}

/** 块级公式 widget（block:true replace，可跨行）。失败回落：提示 + 原文完整保留。 */
class BlockMathWidget extends WidgetType {
  constructor(readonly source: string, readonly raw: string) {
    super();
  }

  eq(other: BlockMathWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-lp-math cm-lp-math-block";
    const result = renderMath(this.source, true);
    if ("html" in result) {
      box.innerHTML = result.html;
      box.title = this.raw;
    } else {
      box.classList.add("cm-lp-math-fallback");
      const err = document.createElement("div");
      err.className = "cm-lp-math-error";
      err.textContent = `公式解析失败：${result.error}`;
      const raw = document.createElement("pre");
      raw.className = "cm-lp-math-raw";
      raw.textContent = this.raw;
      box.append(err, raw);
      // 降级块的纵向间距由 -outer padding 承载（widget margin 不计入 CM 测量）。
      const outer = document.createElement("div");
      outer.className = "cm-lp-math-fallback-outer";
      outer.append(box);
      outer.addEventListener("mousedown", (event) => enterMathSource(event, view, outer, 2, this.raw.length));
      return outer;
    }
    box.addEventListener("mousedown", (event) => enterMathSource(event, view, box, 2, this.raw.length));
    return box;
  }
}

/**
 * 视口内行内公式装饰（ViewPlugin 侧，单行 replace 允许跨插件装饰）。
 * 代码/frontmatter 上下文排除；表格 cell 内的行内公式照常渲染（M113：
 * 行内 replace 是 cell 文本内的内联 widget，不干扰 grid 布局；块级 $$
 * 仍由 mathBlockSet 在表格上下文排除——block replace 会拆散 grid 行）。
 */
export function collectInlineMath(
  view: EditorView,
  vrFrom: number,
  vrTo: number,
  fm: { from: number; to: number } | null,
  decos: Range<Decoration>[],
): void {
  const { doc } = view.state;
  const tree = syntaxTree(view.state);
  let line = doc.lineAt(vrFrom);
  while (line.from <= vrTo) {
    if (line.text.includes("$")) {
      for (const span of findMathSpans(line.text)) {
        if (span.display) continue; // 块级由 StateField 全文档处理
        const from = line.from + span.from;
        const to = line.from + span.to;
        if (fm !== null && from >= fm.from && to <= fm.to) continue;
        if (isInsideCodeContext(tree, from)) continue;
        // 选区进入公式范围时跳过装饰显示源码（与 mathBlockSet 同口径；
        // M110：Ctrl-F/B 跨入即显露；M111：点击 widget 亦直接进入编辑态）。
        if (view.state.selection.ranges.some((r) => r.from < to && r.to > from)) continue;
        const raw = doc.sliceString(from, to);
        decos.push(
          Decoration.replace({
            widget: new InlineMathWidget(raw.slice(1, -1), raw),
          }).range(from, to),
        );
      }
    }
    if (line.number >= doc.lines) break;
    line = doc.line(line.number + 1);
  }
}

/**
 * 全文档块级公式装饰（StateField 侧：跨行 block replace 不允许走插件装饰，
 * 与 frontmatter 同约束）。词法扫描是单趟字符循环，1MB 文档为毫秒级；
 * 渲染在 widget toDOM 惰性发生且有缓存，不阻塞 F0。选区进入公式范围时
 * 跳过装饰显示原文（编辑/选择可见源码，与 frontmatter 的 selected 口径一致）。
 * 表格单元格内的 $$ 不做 replace（block replace 会拆散表格 grid 行），保留原文；
 * cell 内的行内 $ 公式不受影响，由 collectInlineMath 正常渲染。
 */
export function mathBlockSet(state: EditorState): DecorationSet {
  // 廉价存在性检查先行（tr.selection 每次光标移动都触发本函数，全量
  // sliceString 的大字符串分配只在确有 "$$" 时发生）。任何块级公式
  // 都有一行包含开启 $$，逐行检查不会漏。
  const { doc } = state;
  let hasDisplay = false;
  for (let n = 1; n <= doc.lines; n++) {
    if (doc.line(n).text.includes("$$")) {
      hasDisplay = true;
      break;
    }
  }
  if (!hasDisplay) return Decoration.none;
  const text = doc.sliceString(0, doc.length);
  const fm = detectFrontmatter(doc);
  const tree = syntaxTree(state);
  let tables: TableModel[] | null = null;
  const decos: Range<Decoration>[] = [];
  for (const span of findMathSpans(text)) {
    if (!span.display) continue;
    if (fm !== null && span.from >= fm.from && span.to <= fm.to) continue;
    if (isInsideCodeContext(tree, span.from)) continue;
    if (state.selection.ranges.some((r) => r.from < span.to && r.to > span.from)) continue;
    // 首个 display span 才做一次表格扫描（findTables 走语法树 Table 节点）。
    tables ??= findTables((s, e) => doc.sliceString(s, e), doc.length, tree, 0, doc.length);
    if (tableAt(tables, span.from, span.to)) continue;
    const raw = text.slice(span.from, span.to);
    decos.push(
      Decoration.replace({
        widget: new BlockMathWidget(raw.slice(2, -2), raw),
        block: true,
      }).range(span.from, span.to),
    );
  }
  return Decoration.set(decos, true);
}
