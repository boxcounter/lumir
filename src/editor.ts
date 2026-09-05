import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import type { EditorMode } from "./bindings/EditorMode";
import { livePreview, previewRefresh } from "./preview/livePreview";
import type { PreviewContext, WikilinkResolver } from "./preview/livePreview";
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
  openDocument(doc: string, path?: string): void;
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
  /** 滚动定位到 1-based 行号并把光标移到行首（wikilink 锚点 / 反链跳转用）。 */
  revealLine(line: number): void;
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

export function createEditor(parent: HTMLElement, initialMode: EditorMode = "md"): EditorHandle {
  const modeCompartment = new Compartment();
  let currentMode = initialMode;
  // 配置默认基线：openDocument 的无类型线索回落锚在这里；只有 setMode
  //（配置加载 / 用户显式切换）会移动它，openDocument 自身不改。
  let defaultMode = initialMode;
  let currentPath: string | undefined;
  let provider: AttachmentProvider = createInvokeAttachmentProvider();
  let wikilinkResolver: WikilinkResolver | null = null;

  const previewContext: PreviewContext = {
    currentFilePath: () => currentPath,
    attachmentProvider: () => provider,
    wikilinkResolver: () => wikilinkResolver,
  };

  function modeExtensions(mode: EditorMode): Extension[] {
    const highlight: Extension[] = [
      markdown({ base: markdownLanguage, extensions: [GFM] }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ];
    // md 模式 = 高亮 + 装饰层；code 模式 = 仅高亮。
    return mode === "md" ? [...highlight, livePreview(previewContext)] : highlight;
  }

  const state = EditorState.create({
    doc: SAMPLE,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      modeCompartment.of(modeExtensions(initialMode)),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
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
    openDocument(doc: string, path?: string) {
      currentPath = path;
      const next = modeForPath(path, defaultMode);
      currentMode = next;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        effects: modeCompartment.reconfigure(modeExtensions(next)),
      });
    },
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
