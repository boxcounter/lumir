import { Annotation, Compartment, EditorSelection, EditorState, findClusterBreak } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import type { EditorMode } from "./bindings/EditorMode";
import { livePreview, previewRefresh } from "./preview/livePreview";
import type { PreviewContext, WikilinkResolver } from "./preview/livePreview";
import { detectFrontmatter } from "./preview/frontmatter";
import { findMathSpans } from "./preview/math";
import type { MathSpan } from "./preview/math";
import { findTables, tableAt } from "./preview/table";
import { createInvokeAttachmentProvider } from "./preview/attachments";
import type { AttachmentProvider } from "./preview/attachments";

// 编辑器单内核双模式（ADR 0002 §2）：一个 CM6 内核、两种模式。
// md = 高亮 + live preview 装饰层（src/preview/）；code = 仅高亮。
// 模式差异收敛进一个 Compartment，setMode/openDocument 用 reconfigure 热切换，
// 不重建 EditorView、不丢文档状态。M1 只读（ADR 0003 §3 铁律），装饰层不含编辑态逻辑。

const SAMPLE = `\
---
title: Lumir live preview 演示
tags: [demo, m1]
nested:
  key: value
---

# 标题一

## 标题二

**加粗** *斜体* ~~删除线~~ \`inline code\`

- 列表项一
- 列表项二

1. 有序一
2. 有序二

> 引用块

\`\`\`rust
fn main() { println!("lumir"); }
\`\`\`

![[demo.png]]

![示例](./assets/shot.png)
`;

// 垂直光标移动交给 CM6 处理（M103）：编辑器未装 commands keymap，ArrowUp/Down 与
// macOS Emacs 风格 Ctrl-P/N 原本全走原生 contenteditable 路径——光标越出视口时
// 浏览器延迟揭示并与 CM6 视口重建叠加，实测 scrollTop 单次跳 ~388px（整屏突变）。
// CM6 moveVertically 逐视觉行移动（支持软换行与 goal column），每次 dispatch 按
// y:"nearest" 最小滚动，光标贴边时逐行顺滑跟随。

// 块级 replace widget（frontmatter / $$ 公式 / mermaid 围栏）的边界收集。
// moveVertically 跨这类原子块时会把光标一步扔到块另一侧（M110 真实桌面缺陷：
// 公式附近 Ctrl-N 落点错误），需钳制到行进方向的近端边界。数学 span 用词法
// 口径（findMathSpans，与装饰层一致）；mermaid 围栏按语法树 FencedCode+CodeInfo。
function blockWidgetBoundaries(state: EditorState, from: number, to: number): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  const fm = detectFrontmatter(state.doc);
  if (fm && fm.to > from && fm.from < to) {
    starts.push(fm.from);
    ends.push(fm.to);
  }
  const sliceFrom = Math.max(0, from - 4096);
  const sliceTo = Math.min(state.doc.length, to + 8192);
  for (const span of findMathSpans(state.doc.sliceString(sliceFrom, sliceTo))) {
    if (!span.display) continue;
    starts.push(sliceFrom + span.from);
    ends.push(sliceFrom + span.to);
  }
  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== "FencedCode") return;
      const info = ref.node.getChild("CodeInfo");
      if (info && state.doc.sliceString(info.from, info.to).trim() === "mermaid") {
        starts.push(ref.from);
        ends.push(ref.to);
      }
    },
  });
  return { starts, ends };
}

/** 垂直移动跨越块级原子 widget 时，把落点钳制到近端边界；未跨越返回原落点。 */
function clampAcrossBlockWidgets(state: EditorState, from: number, to: number, forward: boolean): number {
  if (from === to) return to;
  const { starts, ends } = blockWidgetBoundaries(state, Math.min(from, to), Math.max(from, to));
  if (forward) {
    let best = Infinity;
    for (const s of starts) if (s > from && s < to && s < best) best = s;
    return best === Infinity ? to : best;
  }
  let best = -1;
  for (const e of ends) if (e < from && e > to && e > best) best = e;
  return best === -1 ? to : best;
}

// 渲染为 grid 的表格（rectangular 且未降级）对垂直移动是原子块：两方向对称、
// 一次按键跳过整张表（M113 用户裁决；修复前 Ctrl-N 恰好跳过而 Ctrl-P 逐行穿过，
// 方向不对称）。落点仍在表内时，改从表在行进方向的远端边界重做一次
// moveVertically——CM 自身的扫描会继续跳过 0 高空行（cm-lp-block-separator），
// 落点与前进方向自然跨表时同口径；goal column 用原光标 x 传入，列位不丢。
// 降级/非矩形表格保留逐行穿过（它们按原始 Markdown 逐行渲染）。
function skipGridTable(
  view: EditorView,
  from: number,
  target: ReturnType<EditorView["moveVertically"]>,
  forward: boolean,
): ReturnType<EditorView["moveVertically"]> {
  const { doc } = view.state;
  const lo = Math.min(from, target.head);
  const hi = Math.max(from, target.head);
  const tree = ensureSyntaxTree(view.state, hi, 25) ?? syntaxTree(view.state);
  const tables = findTables((s, e) => doc.sliceString(s, e), doc.length, tree, lo, hi);
  const table = tableAt(tables, target.head);
  if (!table || table.degraded || !table.rectangular) return target;
  const startX = view.coordsAtPos(from)?.left;
  const goal = startX === undefined ? undefined : startX - view.contentDOM.getBoundingClientRect().left;
  const boundary = forward ? table.to : table.from;
  const moved = view.moveVertically(EditorSelection.cursor(boundary, undefined, undefined, goal), forward);
  // 表已贴文档边界（行进方向无表外行）时 moveVertically 原地不动，保持原落点。
  return moved.head === boundary ? target : moved;
}

function moveCaretVertically(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端；scrollIntoView 揭示光标
    //（r1 review P2-1：否则 Cmd+A → ArrowDown 光标到文档末尾但不可见）。
    view.dispatch({ selection: { anchor: forward ? main.to : main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const moved = view.moveVertically(main, forward);
  // 文档边界兜底（r1 review P2-2，与官方 cursorByLine 同款）：moveVertically 在
  // 末/首行原地不动时，改移行尾/行首——末行中段 ArrowDown 到行尾、首行到行首。
  let target = moved.head !== main.head ? moved : view.moveToLineBoundary(main, forward);
  if (target.head === main.head) return true; // 行首 ArrowUp / 行尾 ArrowDown：已无可移，仍视为已处理
  const clamped = clampAcrossBlockWidgets(view.state, main.head, target.head, forward);
  if (clamped !== target.head) target = EditorSelection.cursor(clamped);
  target = skipGridTable(view, main.head, target, forward);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target.head, { y: "nearest" }),
    userEvent: forward ? "move.line.down" : "move.line.up",
  });
  return true;
}

// Ctrl-P/N 是 macOS 文本系统惯例，只绑 mac；ArrowUp/Down 全平台接管。
const verticalMotionKeymap = keymap.of([
  { key: "ArrowDown", run: (view) => moveCaretVertically(view, true) },
  { key: "ArrowUp", run: (view) => moveCaretVertically(view, false) },
  { mac: "Ctrl-n", run: (view) => moveCaretVertically(view, true) },
  { mac: "Ctrl-p", run: (view) => moveCaretVertically(view, false) },
]);

// 水平光标移动（M110/M111 真实桌面缺陷修复）：macOS Emacs 风格 Ctrl-F/B 原本走原生
// contenteditable 路径——原生 caret 无法进入 CM 的 replace 原子范围（公式
// widget），在边界卡住后经 posAtDOM 回弹跳过，永远无法进入公式。改由 CM 派发：
// 默认沿用 CM 语义（原子/隐藏装饰整体跳过）；唯一例外是数学公式——moveByChar
// 把隐藏 span 当原子一步跳过（落点在 span 另一侧边界）时，钳制为跨入 span 一个
// 字符。选区落入 span 即触发装饰显露（math.ts 选区重叠口径），源码可见、可继续
// 逐字符编辑；不会在隐藏源码长度上逐位空走。未装饰上下文（表格单元格/代码内的
// $）不产生原子跳步，钳制条件（落点越过 span 边界）不成立，逐字符通行不受影响。
function mathSpanCrossed(state: EditorState, from: number, to: number, forward: boolean): MathSpan | null {
  const winFrom = Math.max(0, Math.min(from, to) - 4096);
  const winTo = Math.min(state.doc.length, Math.max(from, to) + 4096);
  let best: MathSpan | null = null;
  for (const span of findMathSpans(state.doc.sliceString(winFrom, winTo))) {
    const s: MathSpan = { from: winFrom + span.from, to: winFrom + span.to, display: span.display };
    if (forward) {
      // from 在 span 起点或其左（span 内部意味着已显露、正常逐字符），且落点越过起点
      if (s.from < from || s.from >= to) continue;
      if (best === null || s.from < best.from) best = s;
    } else {
      if (s.to > from || s.to < to) continue;
      if (s.to === to) {
        // 跨行落点钉在 span 右边界是「边界空走」（M113 真实桌面缺陷）：块级公式
        // 下方段落 / 行尾公式下一行行首按 Ctrl-B，光标停在不可见的边界位不进入，
        // 需再按一次（实测共 3 次）。跨行到达时直接钳入 span；同一行内的边界
        // 停靠保留（那是可见的可编辑位置，M111 既有行为）。
        if (state.doc.lineAt(from).number === state.doc.lineAt(to).number) continue;
      }
      if (best === null || s.to > best.to) best = s;
    }
  }
  return best;
}

function moveCaretHorizontally(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端。
    view.dispatch({ selection: { anchor: forward ? main.to : main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  let head = view.moveByChar(main, forward).head;
  const span = mathSpanCrossed(view.state, main.head, head, forward);
  if (span !== null) {
    // findClusterBreak 接收 string；取 ±64 字符窗口避免大文档整篇 sliceString。
    const edge = forward ? span.from : span.to;
    const winFrom = Math.max(0, edge - 64);
    const win = view.state.doc.sliceString(winFrom, Math.min(view.state.doc.length, edge + 64));
    head = winFrom + findClusterBreak(win, edge - winFrom, forward);
  }
  if (head === main.head) return true;
  view.dispatch({
    selection: { anchor: head },
    effects: EditorView.scrollIntoView(head, { y: "nearest" }),
    userEvent: forward ? "move.char.forward" : "move.char.backward",
  });
  return true;
}

const horizontalMotionKeymap = keymap.of([
  { mac: "Ctrl-f", run: (view) => moveCaretHorizontally(view, true) },
  { mac: "Ctrl-b", run: (view) => moveCaretHorizontally(view, false) },
]);

export type EditorReadyPhase =
  | "source-ready"
  | "decoration-ready"
  | "frontmatter-ready"
  | "paint";

export interface EditorReadyEvent {
  phase: EditorReadyPhase;
  path: string | undefined;
  requestId?: number;
  frontmatter: "present" | "absent";
  time: number;
}

export type EditorReadyListener = (event: EditorReadyEvent) => void;

export interface EditorHandle {
  view: EditorView;
  /**
   * 显式切换模式（配置加载 / 用户切换）：除热切换当前模式外，同时把该模式记为
   * 配置默认基线，openDocument 对无类型线索文件的回落以此为锚。
   * Compartment 热切换，不重建 view。
   */
  setMode(mode: EditorMode): void;
  mode(): EditorMode;
  /**
   * 打开文档：替换内容并按文件类型选模式（spec「模式配置来源」）——
   * .md/.markdown → md；已知代码扩展 → code；无类型线索（path 缺失或未知扩展）
   * → 回落配置默认基线（setMode 锚定，不随上一个打开文件的模式漂移）。
   */
  openDocument(doc: string, path?: string, requestId?: number): void;
  /** 监听文档装载、装饰和首个 paint 的可观测阶段。 */
  onReady(listener: EditorReadyListener): () => void;
  /**
   * 清空文档并复位上下文（vault 切换 / 关闭时调用）：doc 清空、内部
   * currentFilePath 置空、模式回到配置默认基线（defaultMode，与 openDocument
   * 的无类型线索回落锚一致——不继承上一个文件漂移出的模式）。
   */
  reset(): void;
  /**
   * 注入附件能力（add-vault-workspace 的 fs-io「二进制附件读取」，vault 波在装配处调用）。
   * 未注入时附件引用显示占位；默认 provider 已按裁决 A 契约编码但无 vault 索引。
   */
  setAttachmentProvider(provider: AttachmentProvider): void;
  /**
   * 注入 wikilink 解析器（add-wikilink；vault 打开后由装配处注入，关闭时置 null）。
   * 装饰层据此做三态渲染；null 时走降级渲染（不做语义判断）。
   */
  setWikilinkResolver(resolver: WikilinkResolver | null): void;
  /** 强制重建装饰（解析缓存更新 / watch 增量后调用）。 */
  refreshPreview(): void;
  /** 滚动定位到 1-based 行号并把光标移到行首（wikilink 锚点跳转用）。 */
  revealLine(line: number): void;
  isDirty(): boolean;
  markClean(): void;
  onDirty(listener: (dirty: boolean) => void): () => void;
}

// 已知代码文件扩展 → code 模式。未列出的扩展按「无类型线索」回落配置默认。
const CODE_EXTENSIONS = new Set([
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "c", "h", "cpp", "cc",
  "java", "rb", "sh", "json", "toml", "yaml", "yml", "css", "html", "xml",
  "swift", "kt", "lua", "sql", "vue", "scss",
]);

function modeForPath(path: string | undefined, fallback: EditorMode): EditorMode {
  if (!path) return fallback;
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return fallback;
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "md";
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return fallback;
}

export function createEditor(parent: HTMLElement, initialMode: EditorMode = "md", markdownConfig: Parameters<typeof markdown>[0] = { base: markdownLanguage, extensions: [GFM] }): EditorHandle {
  const modeCompartment = new Compartment();
  let currentMode = initialMode;
  // 配置默认基线：openDocument 的无类型线索回落锚在这里；只有 setMode
  //（配置加载 / 用户显式切换）会移动它，openDocument 自身不改。
  let defaultMode = initialMode;
  let currentPath: string | undefined;
  let provider: AttachmentProvider = createInvokeAttachmentProvider();
  let wikilinkResolver: WikilinkResolver | null = null;
  const readyListeners = new Set<EditorReadyListener>();
  let readyPath: string | undefined;
  let readyRequestId: number | undefined;
  let readySerial = 0;
  let cleanDoc = SAMPLE;
  const dirtyListeners = new Set<(dirty: boolean) => void>();
  let dirty = false;
  const trustedLoad = Annotation.define<boolean>();

  function dispatchTrusted(spec: Parameters<EditorView["dispatch"]>[0]): void {
    view.dispatch({ ...spec, annotations: [trustedLoad.of(true)] });
  }

  function updateDirty(next: boolean): void {
    if (dirty === next) return;
    dirty = next;
    dirtyListeners.forEach((listener) => listener(dirty));
  }

  function emitReady(phase: EditorReadyPhase): void {
    const event: EditorReadyEvent = {
      phase,
      path: readyPath,
      requestId: readyRequestId,
      frontmatter: detectFrontmatter(view.state.doc) ? "present" : "absent",
      time: performance.now(),
    };
    readyListeners.forEach((listener) => listener(event));
  }

  function schedulePaint(serial: number): void {
    requestAnimationFrame(() => {
      if (serial !== readySerial || readyPath !== currentPath) return;
      emitReady("paint");
    });
  }

  const previewContext: PreviewContext = {
    currentFilePath: () => currentPath,
    attachmentProvider: () => provider,
    wikilinkResolver: () => wikilinkResolver,
  };

  // 编辑器失焦时 CM 不回写 DOM 选区（M110 真实桌面缺陷）：打开新文档替换整篇
  // 内容后，旧文档的原生选区被浏览器节点钳制映射进新 DOM，用户看到"意外选中
  // 一段内容"而 CM 态光标在 0。装载/清空后焦点不在编辑器时显式清空原生选区；
  // 编辑器聚焦时 CM 自行同步，不干预。
  function collapseDomSelectionIfBlurred(): void {
    if (view.hasFocus) return;
    view.dom.ownerDocument.getSelection()?.removeAllRanges();
  }

  function modeExtensions(mode: EditorMode): Extension[] {
    const highlight: Extension[] = [
      markdown(markdownConfig),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.comment, color: "var(--dim)" },
          { tag: [tags.keyword, tags.operator, tags.punctuation], color: "var(--text)" },
          { tag: [tags.string, tags.regexp, tags.number], color: "var(--accent)" },
          { tag: [tags.link, tags.url], color: "var(--accent)", textDecoration: "underline" },
          { tag: tags.heading, color: mode === "md" ? "inherit" : "var(--text)", fontWeight: mode === "md" ? "inherit" : "700" },
          { tag: tags.strong, fontWeight: "700" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strikethrough, textDecoration: "line-through" },
        ]),
        { fallback: true },
      ),
    ];
    // CM6 的基础层必须跟随 shell 的三套主题；live preview 只增加 Markdown
    // 语义装饰，避免 code 模式落回默认白底、灰 gutter 或默认选区颜色。
    const baseTheme = EditorView.theme({
      "&": {
        color: "var(--text)",
        backgroundColor: "var(--bg)",
        fontFamily: mode === "md" ? "var(--font-body)" : "var(--font-mono)",
      },
      ".cm-scroller": {
        fontFamily: "inherit", lineHeight: "var(--line-height, 1.75)",
        display: "grid !important", gridTemplateColumns: mode === "md"
          ? "minmax(24px, 1fr) minmax(0, var(--measure, 480px)) minmax(24px, 1fr)"
          : "minmax(max-content, 1fr) minmax(0, var(--measure, 480px)) minmax(0, 1fr)",
        alignItems: "start",
      },
      ".cm-content": {
        fontFamily: "inherit", fontSize: "16px",
        gridColumn: "2", gridRow: "1", minWidth: "0", width: "100%",
        marginInline: "0", paddingBlock: "44px",
        textAlign: "start", textIndent: "0", hangingPunctuation: "none", textAutospace: "no-autospace",
      },
      ".cm-line": { padding: "0" },
      ".cm-gutters": {
        gridColumn: "1", gridRow: "1", justifySelf: "start", alignSelf: "stretch",
        color: "var(--dim)",
        backgroundColor: "var(--bg-nav)",
        borderRight: "1px solid var(--bd-1)",
      },
      ".cm-activeLine": { backgroundColor: "var(--bg-2)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--bg-2)", color: "var(--text)" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--sel)",
        color: "var(--selection-ink, var(--text))",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--sel)" },
    });
    // 可编辑性随模式收敛进 Compartment（M101 验收修复）：非 md 模式必须是
    // 视图层只读——editable(false) 摘掉 contenteditable，readOnly(true) 让 CM6
    // 在 DOM 输入入口（beforeinput / EditContext / drop / paste / 输入法组合）
    // 直接拒收，不依赖 changeFilter 事后回滚 DOM（真实 WKWebView 的 AX 文本注入
    // 与 IME 组合路径下回滚不可靠，文本会滞留内存并误标 dirty）。
    const editability: Extension[] = [
      EditorView.editable.of(mode === "md"),
      EditorState.readOnly.of(mode !== "md"),
      EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": String(mode !== "md") }),
    ];
    return mode === "md"
      ? [...editability, ...highlight, baseTheme, livePreview(previewContext)]
      : [...editability, ...highlight, baseTheme, lineNumbers(), highlightActiveLine()];
  }

  const state = EditorState.create({
    doc: SAMPLE,
    extensions: [
      verticalMotionKeymap,
      horizontalMotionKeymap,
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (event.target !== view.contentDOM || event.altKey || event.shiftKey ||
            event.key.toLowerCase() !== "a" || !(event.metaKey || event.ctrlKey)) return false;
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: "select" });
          return true;
        },
      }),
      EditorView.theme({ ".cm-gutters-before": { border: "none" } }),
      modeCompartment.of(modeExtensions(initialMode)),
      // 兜底防线：editability 已随模式在视图层拒收输入，changeFilter 再挡住任何
      // 绕过 DOM 输入路径的程序化 dispatch（trustedLoad 标记的装载事务除外）。
      EditorState.changeFilter.of((tr) => tr.docChanged && currentMode !== "md" && !tr.annotation(trustedLoad) ? [] : true),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) updateDirty(update.state.doc.toString() !== cleanDoc);
      }),
      EditorView.lineWrapping,
    ],
  });
  const view = new EditorView({ state, parent });

  return {
    view,
    setMode(mode: EditorMode) {
      // 显式切换即新的配置默认基线；即便与当前模式相同也要锚定（当前模式
      // 可能是上一个文件经 openDocument 漂移来的）。
      defaultMode = mode;
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) });
    },
    mode: () => currentMode,
    onReady(listener: EditorReadyListener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    openDocument(doc: string, path?: string, requestId?: number) {
      currentPath = path;
      readyPath = path;
      readyRequestId = requestId;
      const serial = ++readySerial;
      const next = modeForPath(path, defaultMode);
      currentMode = next;
      cleanDoc = doc;
      dispatchTrusted({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        // 显式复位选区与滚动（M110 真实桌面缺陷排查）：替换整篇文档后 CM 会把
        // 旧选区映射进新文档、滚动位置也继承上一篇——新文件应从文档起点开始。
        // 滚动复位用直接赋值而非 scrollIntoView 效果：后者带 scrollMargin，文档
        // 溢出视口时会把 pos 0 对齐到视口顶而主动下滚，页首 padding 被顶出画。
        selection: { anchor: 0 },
        effects: modeCompartment.reconfigure(modeExtensions(next)),
      });
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;
      updateDirty(false);
      collapseDomSelectionIfBlurred();
      emitReady("source-ready");
      emitReady("decoration-ready");
      emitReady("frontmatter-ready");
      schedulePaint(serial);
    },
    reset() {
      ++readySerial;
      currentPath = undefined;
      readyPath = undefined;
      readyRequestId = undefined;
      currentMode = defaultMode;
      cleanDoc = "";
      dispatchTrusted({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
        effects: modeCompartment.reconfigure(modeExtensions(defaultMode)),
      });
      updateDirty(false);
      collapseDomSelectionIfBlurred();
    },
    isDirty: () => dirty,
    markClean() { cleanDoc = view.state.doc.toString(); updateDirty(false); },
    onDirty(listener) { dirtyListeners.add(listener); return () => dirtyListeners.delete(listener); },
    setAttachmentProvider(next: AttachmentProvider) {
      provider = next;
      // doc/viewport 均未变化，派发专用 effect 强制装饰层重建。
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    setWikilinkResolver(next: WikilinkResolver | null) {
      wikilinkResolver = next;
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    refreshPreview() {
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    revealLine(line: number) {
      const n = Math.max(1, Math.min(line, view.state.doc.lines));
      const pos = view.state.doc.line(n).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
    },
  };
}
