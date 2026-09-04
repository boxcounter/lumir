import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

// M0 空壳：一个只读 md 示例视图，仅用于证明 webview -> Vite -> CodeMirror 6 渲染链路通。
// 编辑器单内核双模式（md 高亮+live preview 装饰层 / code 仅高亮）见 ADR 0002 第 2 条，M1 起实现。

const SAMPLE = `\
# Lumir skeleton

This is a **read-only** Markdown placeholder rendered by CodeMirror 6
inside a Tauri 2 system webview.

- md 模式 = 高亮 + live preview 装饰层（ADR 0002 §2，M1 实现）
- code 模式 = 仅高亮

\`\`\`rust
fn main() { println!("lumir"); }
\`\`\`
`;

export function createEditor(parent: HTMLElement): EditorView {
  const state = EditorState.create({
    doc: SAMPLE,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
  });
  return new EditorView({ state, parent });
}
