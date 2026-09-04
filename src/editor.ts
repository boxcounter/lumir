import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import type { EditorMode } from "./bindings/EditorMode";

// 编辑器单内核双模式（ADR 0002 §2）的模式缝 —— M1 只建缝不建功能。
//
// 一个 CM6 内核、两种模式：md = 高亮 + live preview 装饰层；code = 仅高亮。
// 模式差异收敛进一个 Compartment，setMode 用 reconfigure 热切换，
// 不重建 EditorView、不丢文档状态。live preview 装饰层本身是后续波次的功能，
// 这里只留挂载位置（mdLivePreviewDecorations 占位）。

const SAMPLE = `\
# Lumir skeleton

This is a **read-only** Markdown placeholder rendered by CodeMirror 6
inside a Tauri 2 system webview.

- md 模式 = 高亮 + live preview 装饰层（ADR 0002 §2，后续波次实现装饰层）
- code 模式 = 仅高亮

\`\`\`rust
fn main() { println!("lumir"); }
\`\`\`
`;

export interface EditorHandle {
  view: EditorView;
  /** 切换单内核双模式（Compartment 热切换，不重建 view）。 */
  setMode(mode: EditorMode): void;
  mode(): EditorMode;
}

/** live preview 装饰层占位：后续波次用 CM6 decoration 在此扩展位实现。 */
const mdLivePreviewDecorations: Extension = [];

function modeExtensions(mode: EditorMode) {
  const highlight = [
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
  // md 模式 = 高亮 + 装饰层；code 模式 = 仅高亮。
  return mode === "md" ? [...highlight, mdLivePreviewDecorations] : highlight;
}

export function createEditor(parent: HTMLElement, initialMode: EditorMode = "md"): EditorHandle {
  const modeCompartment = new Compartment();
  let currentMode = initialMode;

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
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) });
    },
    mode: () => currentMode,
  };
}
