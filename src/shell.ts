// app-shell 布局骨架 —— M1 接缝（架构复查 P2-7）。
// 只建容器：masthead 栏 + 标签栏 + 文件树 / 编辑器两个 pane 的挂载点与网格布局。
// 文件树由 src/tree.ts 挂载（add-vault-workspace）；masthead 的当前位置指示段与大纲浮层
// 由 src/toc.ts 维护（M148），此处只建出手柄。标签栏（M149）同理：这里只给容器，
// 条目与交互在装配层（src/main.ts）。标签栏空态隐藏（hidden），此时它在网格里不占行高。

export interface AppShell {
  root: HTMLElement;
  /** masthead 容器（M148：大纲浮层的挂点与定位块）。 */
  masthead: HTMLElement;
  /** masthead 的当前位置指示段（M148 大纲入口，内容由 src/toc.ts 维护；无内容时隐藏）。 */
  mastheadSection: HTMLButtonElement;
  /** 标签栏容器（M149）：条目由 src/main.ts 渲染；无打开文件时 hidden。 */
  tabStrip: HTMLElement;
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
  const mastheadSection = masthead.querySelector<HTMLButtonElement>(".masthead-section")!;

  // 标签栏（M149）：占编辑器列的独立一行，不侵占正文列宽（正文宽度合同见 docs/specs）。
  // role=tablist + 逐标签 role=tab 由装配层写入，这里只给容器与读屏名。
  const tabStrip = document.createElement("div");
  tabStrip.className = "tabstrip";
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "打开的文档");
  tabStrip.hidden = true;

  const fileTree = pane("pane-filetree", "");
  const editor = pane("pane-editor", "");
  const treeMount = document.createElement("section");
  treeMount.className = "tree-pane";
  fileTree.append(treeMount);

  root.append(masthead, tabStrip, fileTree, editor);
  mount.replaceChildren(root);
  return { root, masthead, mastheadSection, tabStrip, fileTree, treeMount, editor };
}
