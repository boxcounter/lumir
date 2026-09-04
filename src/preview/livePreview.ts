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
import { detectFrontmatter, FrontmatterWidget } from "./frontmatter";
import type { FrontmatterBlock } from "./frontmatter";
import {
  AttachmentNoticeWidget,
  ImageWidget,
  isImageName,
  resolveImagePath,
} from "./attachments";
import type { AttachmentProvider } from "./attachments";

/** 附件 provider 注入/变更时派发，强制重建装饰。 */
export const previewRefresh = StateEffect.define<null>();

/** 装饰层运行期上下文：可变引用，由编辑器装配处持有。 */
export interface PreviewContext {
  /** 当前打开文件的 vault 相对路径（标准 md 图片相对解析的基准）。 */
  currentFilePath(): string | undefined;
  /** 附件能力提供者；未接线时所有附件引用走占位。 */
  attachmentProvider(): AttachmentProvider | null;
}

const CODE_NODE_NAMES = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"]);

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-lp-bullet";
    el.textContent = "•";
    return el;
  }
}
const BULLET = new BulletWidget();

const WIKI_EMBED = /!\[\[([^\][\n]+)\]\]/g;

export function livePreview(ctx: PreviewContext) {
  return [
    livePreviewTheme,
    frontmatterDecorations,
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
// 故走 StateField：只在 docChanged 时重算，且 detectFrontmatter 从文档首部扫描、
// 有行数上限（见 frontmatter.ts），与视口增量策略不冲突（不是全量装饰构建）。
const frontmatterDecorations = StateField.define<DecorationSet>({
  create(state) {
    return frontmatterSet(state);
  },
  update(value, tr) {
    return tr.docChanged ? frontmatterSet(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function frontmatterSet(state: EditorState): DecorationSet {
  const fm = detectFrontmatter(state.doc);
  if (!fm) return Decoration.none;
  return Decoration.set([
    Decoration.replace({ widget: new FrontmatterWidget(fm.inner), block: true }).range(
      fm.from,
      fm.to,
    ),
  ]);
}

function buildDecorations(view: EditorView, ctx: PreviewContext): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const fm = detectFrontmatter(view.state.doc);

  for (const vr of view.visibleRanges) {
    collectSyntaxDecorations(view, vr.from, vr.to, fm, ctx, decos);
    collectWikiEmbeds(view, vr.from, vr.to, fm, ctx, decos);
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
): void {
  const { doc } = view.state;
  syntaxTree(view.state).iterate({
    from: vrFrom,
    to: vrTo,
    enter(ref) {
      if (inFrontmatter(fm, ref.from, ref.to)) return false;
      const name = ref.name;

      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = name.slice(-1);
        decos.push(
          Decoration.line({ class: `cm-lp-h${level}` }).range(doc.lineAt(ref.from).from),
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

      if (name === "ListMark") {
        const text = doc.sliceString(ref.from, ref.to);
        // 有序列表保留编号；无序列表符号美化为 •。
        if (!/^\d/.test(text)) {
          decos.push(Decoration.replace({ widget: BULLET }).range(ref.from, ref.to));
        }
        return;
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

/** Obsidian 方言 ![[...]]：文本级扫描（markdown parser 不解析该语法），跳过代码与 frontmatter。 */
function collectWikiEmbeds(
  view: EditorView,
  vrFrom: number,
  vrTo: number,
  fm: FrontmatterBlock | null,
  ctx: PreviewContext,
  decos: Range<Decoration>[],
): void {
  const { doc } = view.state;
  let line = doc.lineAt(vrFrom);
  while (line.from <= vrTo) {
    WIKI_EMBED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_EMBED.exec(line.text)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (inFrontmatter(fm, from, to) || isInsideCode(view, from)) continue;
      decos.push(buildWikiEmbed(m[0], m[1], ctx).range(from, to));
    }
    if (line.number >= doc.lines) break;
    line = doc.line(line.number + 1);
  }
}

function buildWikiEmbed(rawRef: string, inner: string, ctx: PreviewContext): Decoration {
  // ![[target|alias/size]]：竖线后为显示参数，本波不消费，只取目标。
  const target = inner.split("|")[0].trim();

  // ![[note]] 等笔记内容嵌入不做（ADR 0003 §2）：原文 + 人话提示。
  if (!isImageName(target)) {
    return Decoration.replace({
      widget: new AttachmentNoticeWidget("内容嵌入不支持", rawRef),
    });
  }

  const provider = ctx.attachmentProvider();
  if (!provider) {
    return Decoration.replace({
      widget: new AttachmentNoticeWidget("附件读取未接线", rawRef),
    });
  }

  // 带目录前缀按 vault 相对路径直接用；裸文件名按裁决点 F「文件名唯一匹配」解析。
  const path = target.includes("/") ? target.replace(/^\.?\//, "") : provider.resolveByName(target);
  if (path === null) {
    return Decoration.replace({
      widget: new AttachmentNoticeWidget("附件未找到", rawRef),
    });
  }
  return Decoration.replace({
    widget: new ImageWidget(path, () => provider.readDataUrl(path), rawRef),
  });
}
