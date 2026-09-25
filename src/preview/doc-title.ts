// doc-title / doc-meta 块（M218 A1，M216 gap 表 §2.2 缺失项）：定稿 12 张内容屏全部
// 含此块。位置 = fm 区之后正文之前（原型 index.html:871-877 实例 + NOTES.md:45）。
// 格式化 helper（标题/路径段/日期段）在 ./doc-meta（纯模块，单测可达）；行数 =
// state.doc.lines（rope 缓存字段，O(1)）；修改时间 = 文件 mtime（经 ctx.fileMtime，
// 后端 fs_file_mtime）。
//
// 两种挂载机制（M222 劈叉修复 + 回归 2 修复，合同见 tests/unit/doc-title-placement.test.ts）。
// 共用约束：contentDOM 开头至多一个 ce=false 岛。
// - 有 fm：doc-title 折叠进 FrontmatterWidget 的 outer（fm box 之后），不单独出装饰。
//   独立的第二块级 widget（钉 fm.to, side 1）会让 contentDOM 开头出现两个相邻 ce=false
//   块，Chrome 原生 ← 塌缩（⌘A 后按 ←）在这种拓扑下算不出落点而整体 no-op
//   （M222 探针实证：selectionchange 零触发，CM/DOM 选区失同步）——M218 前只有 fm
//   widget 一个岛，所以当时绿。折叠后恢复单岛拓扑，几何由 theme.ts 的条件 padding 承载。
// - 无 fm：落点在文档 pos 0。CM6 语义下 point decoration 必被收进锚定同位的 block
//   wrapper（ContentBuilder.getBlockPos 的 `cur.from <= this.pos`），wrapper tile 复用又
//   要求 `wrap.from < this.pos`——首行即表格/围栏代码块时 widget 会被吞进 wrapper 并把
//   它劈成两段（M221 探针实证：.cm-lp-table-scroll / .cm-lp-codeblock-scroll 各变 2 个）。
//   pos 0 之前没有任何文档位置可用，故该落点不走 CM 装饰，改挂 `.cm-scroller` 顶部的
//   真实 DOM 节点（与 .cm-content 同级，endMarker 同款口径：应用 chrome，不进文档文本、
//   不进 DOMObserver 子树、不进 heightmap）。几何由 theme.ts 的 grid 行编排承载，
//   不用任何 heightmap 不可见的外距 hack（M110 缺陷 1 同族教训）。

import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { EditorState, StateEffectType } from "@codemirror/state";
import { detectFrontmatter } from "./frontmatter";
import type { FrontmatterBlock } from "./frontmatter";
import { docDirFromPath, docTitleFromPath, formatDocDate } from "./doc-meta";
import type { PreviewContext } from "./livePreview";

/** doc-title 的落点（判定唯一来源；合同 I1）。 */
export type DocTitlePlacement = "none" | "after-frontmatter" | "document-top";

export function docTitlePlacement(path: string | undefined, fm: FrontmatterBlock | null): DocTitlePlacement {
  // 无文件上下文（未命名会话）不渲染——没有标题与路径段可给。
  if (path === undefined) return "none";
  return fm ? "after-frontmatter" : "document-top";
}

/**
 * scroller 在场态 class（加在 `.cm-scroller` 上）：无 fm 的 doc-title 节点在场时
 * 由 docTitleTop 挂上，theme.ts 的 grid 行编排（title 行 1 / 正文行 2 / 末尾标记行 3）
 * 以它为开关。取值被 tests/unit/doc-title-placement.test.ts 钉死。
 */
export const DOC_TITLE_TOP_CLASS = "cm-lp-doc-title-top";

/** doc-title 块的渲染数据（widget 与 scroller 节点共用同一份）。 */
export interface DocTitleData {
  readonly title: string;
  readonly dir: string;
  readonly lines: number;
  readonly mtimeMs: number | null;
}

function docTitleData(state: EditorState, ctx: PreviewContext, path: string): DocTitleData {
  return {
    title: docTitleFromPath(path),
    dir: docDirFromPath(path),
    lines: state.doc.lines,
    mtimeMs: ctx.fileMtime(path) ?? null,
  };
}

/** 数据四元组逐位比较（含 null 口径）；docTitleTop 的 DOM 同步与 FrontmatterWidget.eq 共用。 */
export function sameDocTitleData(a: DocTitleData | null, b: DocTitleData | null): boolean {
  if (a === null || b === null) return a === b;
  return a.title === b.title && a.dir === b.dir && a.lines === b.lines && a.mtimeMs === b.mtimeMs;
}

/**
 * after-frontmatter 落点的数据供给（合同 I2）：有 fm 且 path 定义时返回渲染数据，
 * 由 FrontmatterWidget 携带渲染（折叠形态，见文件头）；path 未定义一律 null。
 * 调用方（livePreview 的 frontmatterSet）只在检出 fm 时调用，fm 参数是调用方
 * 已算好的检测结果，不重复扫描。
 */
export function docTitleForFrontmatter(
  state: EditorState,
  ctx: PreviewContext,
  fm: FrontmatterBlock,
): DocTitleData | null {
  const path = ctx.currentFilePath();
  if (path === undefined || docTitlePlacement(path, fm) !== "after-frontmatter") return null;
  return docTitleData(state, ctx, path);
}

/**
 * document-top 落点的数据供给（合同 I3）：无 fm 且 path 定义时返回渲染数据，
 * 其余落点一律 null（调用方据此决定 scroller 节点的在场与否）。
 */
export function docTitleTopData(state: EditorState, ctx: PreviewContext): DocTitleData | null {
  const path = ctx.currentFilePath();
  if (path === undefined || docTitlePlacement(path, detectFrontmatter(state.doc)) !== "document-top") return null;
  return docTitleData(state, ctx, path);
}

/**
 * doc-title 块的 DOM：两种挂载机制共用同一棵子树（类名/结构/文案唯一来源）。
 * 导出给 frontmatter.ts（折叠形态由 FrontmatterWidget.toDOM 复用）；与 frontmatter.ts
 * 之间存在良性环 import——双向都只引用函数声明（hoisted）与类型，使用点全在运行时，
 * 无模块顶层求值顺序问题。
 */
export function buildDocTitleDOM(data: DocTitleData): HTMLElement {
  const outer = document.createElement("div");
  outer.className = "cm-lp-doc-title-outer";
  const title = document.createElement("div");
  title.className = "cm-lp-doc-title";
  title.textContent = data.title;
  const meta = document.createElement("div");
  meta.className = "cm-lp-doc-meta";
  const segment = (text: string) => {
    const span = document.createElement("span");
    span.textContent = text;
    meta.append(span);
  };
  const sep = () => {
    const span = document.createElement("span");
    span.className = "cm-lp-doc-meta-sep";
    span.textContent = "·";
    meta.append(span);
  };
  const segments: string[] = [];
  if (data.dir !== "") segments.push(data.dir);
  segments.push(`${data.lines} 行`);
  if (data.mtimeMs !== null) segments.push(`修改于 ${formatDocDate(data.mtimeMs)}`);
  segments.forEach((text, i) => {
    if (i > 0) sep();
    segment(text);
  });
  outer.append(title, meta);
  return outer;
}

/**
 * document-top 落点的 scroller 级节点（M222）：无 fm 的 doc-title 是 `.cm-scroller` 的
 * 第一个子元素（grid 行编排见 theme.ts 的 DOC_TITLE_TOP_CLASS 段），随内容纵向滚动、
 * 不进 CM 的任何数据结构。同步是重算型：数据四元组（标题/路径段/行数/mtime）逐位比较，
 * 没变不碰 DOM；在场与否 = 节点在不在 DOM 里（endMarker 同口径）。
 *
 * 触发点：docChanged（行数段、fm 的有无会随键入翻转）/ previewRefresh（mtime 到达）/
 * setState（切标签——无事务且 docChanged 可能为假，单独覆盖）。同步只读 state 与缓存，
 * 零布局测量（ADR 0002 §6：不在打开/键入路径新增测量）。
 */
export function docTitleTop(ctx: PreviewContext, refresh: StateEffectType<null>) {
  return ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;
      private node: HTMLElement | null = null;
      private rendered: DocTitleData | null = null;

      constructor(view: EditorView) {
        this.view = view;
        // 上一个实例（换模式时 CM 重建 view plugin）不该留下在场态 class（endMarker 同款第二道）。
        view.scrollDOM.classList.remove(DOC_TITLE_TOP_CLASS);
        this.sync();
      }

      update(u: ViewUpdate): void {
        if (
          u.docChanged ||
          u.startState !== u.state ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
        ) {
          this.sync();
        }
      }

      destroy(): void {
        this.detach();
      }

      private detach(): void {
        if (this.node) this.node.remove();
        this.node = null;
        this.rendered = null;
        this.view.scrollDOM.classList.remove(DOC_TITLE_TOP_CLASS);
      }

      private sync(): void {
        const data = docTitleTopData(this.view.state, ctx);
        if (data === null) {
          this.detach();
          return;
        }
        if (this.node === null) {
          this.node = buildDocTitleDOM(data);
          this.view.scrollDOM.insertBefore(this.node, this.view.contentDOM);
          this.view.scrollDOM.classList.add(DOC_TITLE_TOP_CLASS);
          this.rendered = data;
          return;
        }
        if (!sameDocTitleData(this.rendered, data)) {
          const next = buildDocTitleDOM(data);
          this.node.replaceWith(next);
          this.node = next;
          this.rendered = data;
        }
      }
    },
  );
}
