// live preview 装饰层（editor-live-preview capability 的核心）。
// 裁决点 D 推荐项落地：视口增量 ViewPlugin —— 只为可见区域构建 decoration，
// 滚动/文档变化/语法树增量解析时重建；MUST NOT 全量构建（1MB <100ms 性能合同）。
// 只读口径：不做光标行 reveal 源码的编辑态逻辑。

import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { livePreviewTheme } from "./theme";
import { listDecorations } from "./lists";
import { detectFrontmatter, FrontmatterWidget } from "./frontmatter";
import type { FrontmatterBlock } from "./frontmatter";
import {
  AttachmentNoticeWidget,
  ImageWidget,
  isImageName,
  resolveImagePath,
} from "./attachments";
import type { AttachmentProvider } from "./attachments";
import { findWikilinkSpans } from "./wikilinks";
import type { LinkResolveResult } from "../bindings/LinkResolveResult";
import { BlockWrapper } from "@codemirror/view";
import { findTables, tableAt, tableRowsInRange, type TableModel } from "./table";

/** 附件 provider 注入/变更时派发，强制重建装饰。 */
export const previewRefresh = StateEffect.define<null>();

/**
 * wikilink 语义解析的查询口（唯一实现是 Rust link_graph，经 invoke 到达）。
 * 命中缓存返回结果；未命中返回 undefined（pending），实现方负责后台解析
 * 并在完成后派发 previewRefresh 触发装饰重建。
 */
export interface WikilinkResolver {
  resolve(raw: string): LinkResolveResult | undefined;
}

/** 装饰层运行期上下文：可变引用，由编辑器装配处持有。 */
export interface PreviewContext {
  /** 当前打开文件的 vault 相对路径（标准 md 图片相对解析的基准）。 */
  currentFilePath(): string | undefined;
  /** 附件能力提供者；未接线时所有附件引用走占位。 */
  attachmentProvider(): AttachmentProvider | null;
  /** wikilink 解析器；未接线（无 vault / 后端无 link graph）时装饰层走降级渲染。 */
  wikilinkResolver(): WikilinkResolver | null;
}

const CODE_NODE_NAMES = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"]);

/** wikilink 三态（spec §4.1）显示 widget：replace 整条链接，显示 alias 或 target。 */
class WikilinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly status: "resolved" | "ambiguous" | "unresolved",
    readonly candidates: string[],
    readonly raw: string,
  ) {
    super();
  }

  eq(other: WikilinkWidget): boolean {
    return (
      other.label === this.label &&
      other.status === this.status &&
      other.candidates.join("\n") === this.candidates.join("\n")
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `cm-lp-wikilink cm-lp-wikilink-${this.status}`;
    el.dataset.status = this.status;
    el.textContent = this.label;
    if (this.status === "ambiguous") {
      // 歧义标识 + 悬停候选列表（spec §4.1：跳转前即可见）
      el.title = `同名候选：\n${this.candidates.join("\n")}`;
      const badge = document.createElement("sup");
      badge.className = "cm-lp-wikilink-badge";
      badge.textContent = "歧义";
      el.append(badge);
    } else if (this.status === "unresolved") {
      el.title = `${this.raw}（未创建，点击创建）`;
    } else {
      el.title = this.raw;
    }
    return el;
  }
}

class EmptyTableCellWidget extends WidgetType {
  constructor(readonly column: number, readonly header: boolean, readonly align: string) {
    super();
  }

  eq(other: EmptyTableCellWidget): boolean {
    return other.column === this.column && other.header === this.header && other.align === this.align;
  }

  toDOM(): HTMLElement {
    const cell = document.createElement("span");
    cell.className = "cm-lp-table-cell cm-lp-table-cell-empty";
    cell.setAttribute("role", this.header ? "columnheader" : "cell");
    cell.setAttribute("aria-colindex", String(this.column));
    cell.setAttribute("aria-label", "空单元格");
    cell.style.cssText = `grid-column:${this.column};text-align:${this.align}`;
    return cell;
  }
}

const tableMetadataCache = new WeakMap<EditorState, Map<string, TableModel[]>>();

function tableModels(state: EditorState, from: number, to: number): TableModel[] {
  let ranges = tableMetadataCache.get(state);
  if (!ranges) {
    ranges = new Map();
    tableMetadataCache.set(state, ranges);
  }
  const key = `${from}:${to}`;
  const cached = ranges.get(key);
  if (cached) return cached;
  const doc = state.doc;
  const tables = findTables((start, end) => doc.sliceString(start, end), doc.length, syntaxTree(state), from, to);
  ranges.set(key, tables);
  return tables;
}

function tableDiscoveryRange(view: EditorView): { from: number; to: number } {
  const margin = Math.max(view.state.doc.lineAt(view.viewport.from).length * 2, 2048);
  return {
    from: Math.max(0, view.viewport.from - margin),
    to: Math.min(view.state.doc.length, view.viewport.to + margin),
  };
}

function tableWrappers(view: EditorView) {
  const { from, to } = tableDiscoveryRange(view);
  const wrappers = tableModels(view.state, from, to)
    .filter((table) => table.rectangular && !table.degraded)
    .flatMap((table, index) => {
      const start = view.state.doc.lineAt(table.from).from;
      const label = `Markdown 表格 ${index + 1}`;
      return [
        BlockWrapper.create({
          tagName: "div",
          rank: 10,
          attributes: { class: "cm-lp-table-scroll", role: "region", "aria-label": label, tabindex: "0" },
        }).range(start, table.to),
        BlockWrapper.create({
          tagName: "div",
          rank: 0,
          attributes: {
            class: "cm-lp-table",
            role: "table",
            "aria-label": label,
            "aria-colcount": String(table.columns),
            "aria-rowcount": String(table.rows.length),
            style: `--cm-lp-table-columns:${table.columns}`,
          },
        }).range(start, table.to),
      ];
    });
  return BlockWrapper.set(wrappers, true);
}

export function livePreview(ctx: PreviewContext) {
  return [
    livePreviewTheme,
    frontmatterDecorations,
    listDecorations,
    EditorView.blockWrappers.of(tableWrappers),
    EditorView.domEventHandlers({
      focusin(event, view) {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches(".cm-lp-table-scroll")) return false;
        const selection = view.dom.ownerDocument.getSelection();
        if (!selection?.anchorNode || !view.contentDOM.contains(selection.anchorNode)) {
          view.focus();
          const anchor = view.domAtPos(view.state.selection.main.anchor);
          const head = view.domAtPos(view.state.selection.main.head);
          selection?.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
          target.focus({ preventScroll: true });
        }
        return false;
      },
      wheel(event) {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-lp-table-scroll") : null;
        if (!target || !event.deltaX) return false;
        target.scrollLeft += event.deltaX;
        event.preventDefault();
        return true;
      },
      keydown(event, view) {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches(".cm-lp-table-scroll")) return false;
        if (event.key === "Escape") {
          view.focus();
          event.preventDefault();
          return true;
        }
        const movement = event.key === "ArrowRight" ? 120 : event.key === "ArrowLeft" ? -120 : null;
        if (movement !== null || event.key === "Home" || event.key === "End") {
          target.scrollLeft = event.key === "Home" ? 0 : event.key === "End" ? target.scrollWidth : target.scrollLeft + (movement ?? 0);
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, ctx);
        }

        update(u: ViewUpdate) {
          const forced = u.transactions.some((tr) =>
            tr.effects.some((e) => e.is(previewRefresh)),
          );
          if (
            forced ||
            u.docChanged ||
            u.selectionSet ||
            u.viewportChanged ||
            syntaxTree(u.state) !== syntaxTree(u.startState)
          ) {
            this.decorations = buildDecorations(u.view, ctx);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ];
}

// frontmatter 的 replace 跨行，而插件装饰不允许替换换行符（CM6 硬限制），
// 故走 StateField：文档或选区变化时重算，且 detectFrontmatter 从文档首部扫描、
// 有行数上限（见 frontmatter.ts），与视口增量策略不冲突（不是全量装饰构建）。
const frontmatterDecorations = StateField.define<DecorationSet>({
  create(state) {
    return frontmatterSet(state);
  },
  update(value, tr) {
    return tr.docChanged || tr.selection ? frontmatterSet(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function frontmatterSet(state: EditorState): DecorationSet {
  const fm = detectFrontmatter(state.doc);
  if (!fm) return Decoration.none;
  return Decoration.set([
    Decoration.replace({ widget: new FrontmatterWidget(fm.inner,
      state.selection.ranges.some(range => range.from <= fm.from && range.to >= fm.to)), block: true }).range(
      fm.from,
      fm.to,
    ),
  ]);
}

function collectTableDecorations(view: EditorView, tables: readonly TableModel[], from: number, to: number, decos: Range<Decoration>[]): void {
  for (const table of tables) {
    if (table.degraded || table.to < from || table.from > to) continue;
    for (const row of tableRowsInRange(table, from, to)) {
      const line = view.state.doc.lineAt(row.from);
      decos.push(Decoration.line({ class: "cm-lp-table-row", attributes: { role: "row" } }).range(line.from));
      let cursor = line.from;
      row.slots.forEach((slot, column) => {
        if (cursor < slot.from) decos.push(Decoration.replace({}).range(cursor, slot.from));
        const attrs = {
          role: row.header ? "columnheader" : "cell",
          "aria-colindex": String(column + 1),
          style: `grid-column:${column + 1};text-align:${table.align[column] ?? "left"}`,
        };
        const empty = view.state.doc.sliceString(slot.from, slot.to).trim() === "";
        if (empty) {
          decos.push(Decoration.replace({ widget: new EmptyTableCellWidget(column + 1, row.header, table.align[column] ?? "left") }).range(slot.from, slot.to));
        } else {
          decos.push(Decoration.mark({ class: "cm-lp-table-cell", attributes: attrs }).range(slot.from, slot.to));
        }
        cursor = slot.to;
      });
      if (cursor < row.to) decos.push(Decoration.replace({}).range(cursor, row.to));
    }
    const separator = view.state.doc.lineAt(table.separator.from);
    if (separator.to >= from && separator.from <= to) {
      decos.push(Decoration.line({ class: "cm-lp-table-separator", attributes: { "aria-hidden": "true" } }).range(separator.from));
      decos.push(Decoration.replace({}).range(separator.from, separator.to));
    }
  }
}

function buildDecorations(view: EditorView, ctx: PreviewContext): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const fm = detectFrontmatter(view.state.doc);
  const { from, to } = tableDiscoveryRange(view);
  const tables = tableModels(view.state, from, to);

  for (const vr of view.visibleRanges) {
    for (const table of tables) {
      if (!table.degraded || table.to < vr.from || table.from > vr.to) continue;
      const line = view.state.doc.lineAt(table.from);
      decos.push(Decoration.line({ class: "cm-lp-table-degraded", attributes: { "aria-label": "表格阅读降级：保留原始 Markdown" } }).range(line.from));
    }
    collectTableDecorations(view, tables, vr.from, vr.to, decos);
    collectSyntaxDecorations(view, vr.from, vr.to, fm, ctx, decos, tables);
    collectWikilinks(view, vr.from, vr.to, fm, ctx, decos);
    for (const { from } of lineRanges(view, vr.from, vr.to)) {
      const line = view.state.doc.lineAt(from);
      if (line.text.trim() || inFrontmatter(fm, from, line.to)) continue;
      const node = syntaxTree(view.state).resolveInner(from, 0);
      if (node.name !== "Document") continue;
      decos.push(Decoration.line({ class: "cm-lp-block-separator" }).range(from));
    }
  }
  return Decoration.set(decos, true);
}

// 节点完全落在 frontmatter 内才跳过（防止相交判断误剪根节点导致整棵树不遍历）。
const inFrontmatter = (fm: FrontmatterBlock | null, from: number, to: number): boolean =>
  fm !== null && from >= fm.from && to <= fm.to;

function lineRanges(
  view: EditorView,
  from: number,
  to: number,
): { from: number }[] {
  const lines: { from: number }[] = [];
  const { doc } = view.state;
  let line = doc.lineAt(from);
  while (true) {
    lines.push({ from: line.from });
    if (line.to >= to || line.number >= doc.lines) break;
    line = doc.line(line.number + 1);
  }
  return lines;
}

/** 隐藏标记符（replace 为空）；extendAfter/Before 吃掉相邻一个空格。 */
function hideMark(
  view: EditorView,
  from: number,
  to: number,
  decos: Range<Decoration>[],
  eatSpaceAfter: boolean,
  eatSpaceBefore: boolean,
): void {
  const { doc } = view.state;
  let f = from;
  let t = to;
  if (eatSpaceAfter && doc.sliceString(t, t + 1) === " ") t += 1;
  if (eatSpaceBefore && doc.sliceString(f - 1, f) === " ") f -= 1;
  decos.push(Decoration.replace({}).range(f, t));
}

function collectSyntaxDecorations(
  view: EditorView,
  vrFrom: number,
  vrTo: number,
  fm: FrontmatterBlock | null,
  ctx: PreviewContext,
  decos: Range<Decoration>[],
  tables: readonly TableModel[] = [],
): void {
  const { doc } = view.state;
  syntaxTree(view.state).iterate({
    from: vrFrom,
    to: vrTo,
    enter(ref) {
      if (inFrontmatter(fm, ref.from, ref.to)) return false;
      if (tableAt(tables, ref.from, ref.to)) return false;
      const name = ref.name;

      if (name === "Paragraph" && ref.node.parent?.name === "Document") {
        const first = doc.lineAt(ref.from);
        let previous = ref.node.prevSibling;
        let isOpening = true;
        while (previous) {
          if (previous.name === "Paragraph" && !inFrontmatter(fm, previous.from, previous.to)) {
            isOpening = false;
            break;
          }
          previous = previous.prevSibling;
        }
        const dropcap = isOpening && /^[\p{L}\p{N}]/u.test(doc.sliceString(ref.from, ref.from + 2));
        for (const line of lineRanges(view, Math.max(ref.from, vrFrom), Math.min(ref.to, vrTo))) {
          const classes = ["cm-lp-paragraph"];
          if (line.from === first.from) {
            classes.push(dropcap ? "cm-lp-opening" : "cm-lp-paragraph-start");
            if (dropcap && view.state.selection.ranges.some(range => range.from <= ref.from && range.to > ref.from)) {
              classes.push("cm-lp-dropcap-selected");
            }
          }
          if (dropcap && line.from === doc.lineAt(ref.to).from) classes.push("cm-lp-opening-end");
          decos.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
        }
      }

      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = name.slice(-1);
        const headingLine = doc.lineAt(ref.from);
        const top = level === "2" ? 17.92 * 2.9 : 0;
        const bottom = level === "1" ? 28.48 * .55 : level === "2" ? 17.92 * 1.1 : 0;
        decos.push(
          Decoration.line({ class: `cm-lp-h${level}`, attributes: { style: `padding-top:${top}px;padding-bottom:${bottom}px` } }).range(headingLine.from),
        );
        // 隐藏开头与结尾的 # 标记串（连同相邻一个空格）。
        const cursor = ref.node.cursor();
        if (cursor.firstChild()) {
          const marks: { from: number; to: number }[] = [];
          do {
            if (cursor.name === "HeaderMark") marks.push({ from: cursor.from, to: cursor.to });
          } while (cursor.nextSibling());
          marks.forEach((m, i) => {
            // 首个标记吃掉后面的空格，其余（结尾标记）吃掉前面的空格。
            hideMark(view, m.from, m.to, decos, i === 0, i !== 0);
          });
        }
        return;
      }

      if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
        const cls =
          name === "StrongEmphasis"
            ? "cm-lp-strong"
            : name === "Emphasis"
              ? "cm-lp-em"
              : "cm-lp-strike";
        decos.push(Decoration.mark({ class: cls }).range(ref.from, ref.to));
        // 隐藏定界标记（EmphasisMark / StrikethroughMark，防御性按 *Mark 后缀匹配）。
        const cursor = ref.node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.name.endsWith("Mark")) {
              decos.push(Decoration.replace({}).range(cursor.from, cursor.to));
            }
          } while (cursor.nextSibling());
        }
        return false;
      }

      if (name === "Blockquote") {
        for (const l of lineRanges(view, Math.max(ref.from, vrFrom), Math.min(ref.to, vrTo))) {
          decos.push(Decoration.line({ class: "cm-lp-quote-line" }).range(l.from));
        }
        const cursor = ref.node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.name === "QuoteMark") {
              hideMark(view, cursor.from, cursor.to, decos, true, false);
            }
          } while (cursor.nextSibling());
        }
        return;
      }

      if (name === "FencedCode" || name === "CodeBlock") {
        for (const l of lineRanges(view, Math.max(ref.from, vrFrom), Math.min(ref.to, vrTo))) {
          decos.push(Decoration.line({ class: "cm-lp-codeblock-line" }).range(l.from));
        }
        return false;
      }

      if (name === "InlineCode") {
        decos.push(Decoration.mark({ class: "cm-lp-inline-code" }).range(ref.from, ref.to));
        return false;
      }

      if (name === "Image") {
        const url = ref.node.getChild("URL");
        if (url) {
          const refText = doc.sliceString(ref.from, ref.to);
          const target = doc.sliceString(url.from, url.to);
          decos.push(buildStandardImage(target, refText, ctx).range(ref.from, ref.to));
        }
        return false;
      }
      return;
    },
  });
}

function isInsideCode(view: EditorView, pos: number): boolean {
  let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
    view.state,
  ).resolveInner(pos, 0);
  while (node) {
    if (CODE_NODE_NAMES.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/** 标准 ![alt](path)：外部 URL 直接渲染，否则相对当前文件解析并经 provider 读取。 */
function buildStandardImage(
  target: string,
  rawRef: string,
  ctx: PreviewContext,
): Decoration {
  if (/^https?:\/\//.test(target)) {
    return Decoration.replace({
      widget: new ImageWidget(target, () => Promise.resolve(target), rawRef),
    });
  }
  const provider = ctx.attachmentProvider();
  if (!provider) {
    return Decoration.replace({
      widget: new AttachmentNoticeWidget("附件读取未接线", rawRef),
    });
  }
  const path = resolveImagePath(target, ctx.currentFilePath());
  return Decoration.replace({
    widget: new ImageWidget(path, () => provider.readDataUrl(path), rawRef),
  });
}

/**
 * wikilink span 定位 + 三态装饰：词法范围由 findWikilinkSpans 给出（span 定位
 * 是前端唯一持有的逻辑，架构复查 P1-4），语义一律经 WikilinkResolver 取 Rust
 * link_graph 结果。未命中缓存的链接按 pending 渲染，解析完成后经
 * previewRefresh 重建；code/frontmatter 上下文排除沿用语法树与 frontmatter 检测。
 */
function collectWikilinks(
  view: EditorView,
  vrFrom: number,
  vrTo: number,
  fm: FrontmatterBlock | null,
  ctx: PreviewContext,
  decos: Range<Decoration>[],
): void {
  const { doc } = view.state;
  const resolver = ctx.wikilinkResolver();
  let line = doc.lineAt(vrFrom);
  while (line.from <= vrTo) {
    for (const span of findWikilinkSpans(line.text)) {
      const from = line.from + span.from;
      const to = line.from + span.to;
      if (inFrontmatter(fm, from, to) || isInsideCode(view, from)) continue;
      const raw = doc.sliceString(from, to);
      decos.push(buildWikilink(raw, span.embed, ctx, resolver).range(from, to));
    }
    if (line.number >= doc.lines) break;
    line = doc.line(line.number + 1);
  }
}

/** 显示文本：alias 或 target（spec §2.1：alias 为空串时回落为按 target 显示）。 */
function wikilinkLabel(raw: string, embed: boolean): string {
  const inner = raw.slice(embed ? 3 : 2, -2);
  const pipe = inner.indexOf("|");
  const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe < 0 ? null : inner.slice(pipe + 1);
  return alias !== null && alias !== "" ? alias : target;
}

function buildWikilink(
  raw: string,
  embed: boolean,
  ctx: PreviewContext,
  resolver: WikilinkResolver | null,
): Decoration {
  // 降级路径：无解析器（未打开 vault / 后端无 link graph）。不做任何语义判断：
  // embed 沿用既有附件占位路径，普通链接只加链接样式、保持原文。
  if (!resolver) {
    if (embed) {
      return Decoration.replace({ widget: buildWikiEmbedWidget(raw, raw.slice(3, -2), ctx) });
    }
    return Decoration.mark({ class: "cm-lp-wikilink" });
  }

  const result = resolver.resolve(raw);
  if (!result) {
    return Decoration.mark({ class: "cm-lp-wikilink cm-lp-wikilink-pending" });
  }
  // spec §6：块引用不支持，显示原文与提示。
  if (result.status === "unsupported") {
    return Decoration.replace({ widget: new AttachmentNoticeWidget("块引用不支持", raw) });
  }
  if (embed) {
    // spec §5 双语义判别：附件引用渲染 / 笔记嵌入提示 / 缺失占位。
    if (result.status === "unresolved") {
      return Decoration.replace({ widget: new AttachmentNoticeWidget("附件未找到", raw) });
    }
    if (result.embed_target === "note") {
      return Decoration.replace({ widget: new AttachmentNoticeWidget("内容嵌入不支持", raw) });
    }
    const provider = ctx.attachmentProvider();
    const path = result.path;
    if (!provider || path === null) {
      return Decoration.replace({ widget: new AttachmentNoticeWidget("附件读取未接线", raw) });
    }
    return Decoration.replace({
      widget: new ImageWidget(path, () => provider.readDataUrl(path), raw),
    });
  }
  return Decoration.replace({
    widget: new WikilinkWidget(wikilinkLabel(raw, false), result.status, result.candidates, raw),
  });
}

/**
 * Obsidian 方言 ![[...]] 的降级渲染（无 wikilink 解析器时沿用 add-editor-live-preview
 * 的临时口径：裁决点 F 文件名唯一匹配），不做三态。
 */
function buildWikiEmbedWidget(rawRef: string, inner: string, ctx: PreviewContext): WidgetType {
  // ![[target|alias/size]]：竖线后为显示参数，不消费，只取目标。
  const target = inner.split("|")[0].trim();

  // ![[note]] 等笔记内容嵌入不做（ADR 0003 §2）：原文 + 人话提示。
  if (!isImageName(target)) {
    return new AttachmentNoticeWidget("内容嵌入不支持", rawRef);
  }

  const provider = ctx.attachmentProvider();
  if (!provider) {
    return new AttachmentNoticeWidget("附件读取未接线", rawRef);
  }

  // 带目录前缀按 vault 相对路径直接用；裸文件名按裁决点 F「文件名唯一匹配」解析。
  const path = target.includes("/") ? target.replace(/^\.?\//, "") : provider.resolveByName(target);
  if (path === null) {
    return new AttachmentNoticeWidget("附件未找到", rawRef);
  }
  return new ImageWidget(path, () => provider.readDataUrl(path), rawRef);
}
