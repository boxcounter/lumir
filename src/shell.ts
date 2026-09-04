// app-shell 布局骨架 —— M1 接缝（架构复查 P2-7）。
// 只建容器：文件树 / 编辑器 / 面板三个 pane 的挂载点与网格布局。
// 文件树由 src/tree.ts 挂载（add-vault-workspace）；面板内容是后续波次的功能。

export interface AppShell {
  root: HTMLElement;
  /** 文件树 pane（createFileTree 挂载点）。 */
  fileTree: HTMLElement;
  /** 编辑器 pane（CM6 单内核挂载点）。 */
  editor: HTMLElement;
  /** 面板 pane（agent 协作/属性等，后续波次填充）。 */
  panel: HTMLElement;
}

function pane(className: string, label: string): HTMLElement {
  const el = document.createElement("section");
  el.className = `pane ${className}`;
  el.dataset.emptyLabel = label;
  return el;
}

/** 在挂载点内建立 shell 布局，返回各 pane 容器。 */
export function createShell(mount: HTMLElement): AppShell {
  const root = document.createElement("div");
  root.className = "app-shell";

  const fileTree = pane("pane-filetree", "");
  const editor = pane("pane-editor", "");
  const panel = pane("pane-panel", "面板（后续波次）");

  root.append(fileTree, editor, panel);
  mount.replaceChildren(root);
  return { root, fileTree, editor, panel };
}
