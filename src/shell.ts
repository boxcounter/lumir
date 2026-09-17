// app-shell 布局骨架 —— M1 接缝（架构复查 P2-7）。
// 只建容器：masthead 栏 + 文件树 / 编辑器两个 pane 的挂载点与网格布局。
// 文件树由 src/tree.ts 挂载（add-vault-workspace）；masthead 的当前位置指示段与大纲浮层
// 由 src/toc.ts 维护（M148），此处只建出手柄。

export interface AppShell {
  root: HTMLElement;
  /** masthead 容器（M148：大纲浮层的挂点与定位块）。 */
  masthead: HTMLElement;
  /** masthead 的当前位置指示段（M148 大纲入口，内容由 src/toc.ts 维护；无内容时隐藏）。 */
  mastheadSection: HTMLButtonElement;
  /** 文件树 pane（createFileTree 挂载点）。 */
  fileTree: HTMLElement;
  treeMount: HTMLElement;
  /** 编辑器 pane（CM6 单内核挂载点）。 */
  editor: HTMLElement;
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

  const masthead = document.createElement("header");
  masthead.className = "masthead";
  masthead.innerHTML =
    '<span class="masthead-vault">未打开 vault</span><span class="masthead-file">无当前文件</span>' +
    // 当前位置指示段（M148）：大纲入口与当前标题路径的落点，隐藏态由 src/toc.ts 维护。
    '<button type="button" class="masthead-section" hidden></button>';
  root.append(masthead);
  const mastheadSection = masthead.querySelector<HTMLButtonElement>(".masthead-section")!;

  const fileTree = pane("pane-filetree", "");
  const editor = pane("pane-editor", "");
  const treeMount = document.createElement("section");
  treeMount.className = "tree-pane";
  fileTree.append(treeMount);

  root.append(fileTree, editor);
  mount.replaceChildren(root);
  return { root, masthead, mastheadSection, fileTree, treeMount, editor };
}
