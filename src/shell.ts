// app-shell 布局骨架 —— M1 接缝（架构复查 P2-7）。
// 只建容器：标题栏（traffic 灯区 + 标签）/ 侧栏 / 编辑器 / modeline 四区，
// 与文件树 / 编辑器的挂载点。文件树由 src/tree.ts 挂载（add-vault-workspace）；大纲的
// 当前位置指示段与浮层由 src/toc.ts 维护（M148，M211 从已删除的标题区迁到 modeline）；
// 标签栏（M149）条目与交互在装配层（src/main.ts），这里只给容器——容器空态 hidden，
// 此时标签段不占宽度。
//
// M211（change restyle-ui-tokens-v1）：旧标题区（vault 名 + 文件路径 + 大纲指示段的一行）
// 整块删除，信息分三处落位——
//   · vault 名 → 侧栏头（已有载体：.ft-header 的 .ft-vault 入口，M163 形态 A）
//   · 当前文件路径 / 大纲指示段 → modeline 左段
//   · 行数 / 语法 / 编码 → modeline 右段（新增展示位，只读派生）
// modeline 的右段内容由装配层写（它是唯一知道「前台文档是谁」的地方）。

export interface AppShell {
  root: HTMLElement;
  /** 标题栏容器：traffic 灯区（原生绘制，只占位）+ 标签段；整条带拖拽区。 */
  titlebar: HTMLElement;
  /** 标签栏容器（M149）：条目由 src/main.ts 渲染；无打开文件时 hidden。 */
  tabStrip: HTMLElement;
  /** 文件树 pane（createFileTree 挂载点）。 */
  fileTree: HTMLElement;
  treeMount: HTMLElement;
  /** 编辑器 pane（CM6 单内核挂载点）。 */
  editor: HTMLElement;
  /** modeline 容器：它同时是大纲浮层的定位块（见 src/toc.ts 的 mount）。 */
  modeline: HTMLElement;
  /** modeline 左段的当前文件路径（含 dirty 后缀），由装配层写入。 */
  modelinePath: HTMLElement;
  /** modeline 的当前位置指示段（M148 大纲入口，内容由 src/toc.ts 维护；无内容时隐藏）。 */
  modelineSection: HTMLButtonElement;
  /** modeline 右段（语法 · 行数 · 编码），由装配层写入。 */
  modelineMeta: HTMLElement;
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

  // 标题栏（Overlay 标题栏下的 42px 全宽行）。`data-tauri-drag-region="deep"` 让整条可拖拽
  // （Overlay 标题栏的必要条件，官方文档在 Overlay 条目下明写）；Tauri 的 drag.js 会自动让
  // clickable 元素（button / [role=tab] 等）阻断拖拽，标签因此不必逐个标注。
  // 左端 236px 是原生 traffic 灯区：只占位、不自绘——自绘三色点是假控件，且与原生灯重叠。
  const titlebar = document.createElement("header");
  titlebar.className = "titlebar";
  titlebar.setAttribute("data-tauri-drag-region", "deep");
  const traffic = document.createElement("div");
  traffic.className = "titlebar-traffic";
  // 标签段（M149）：与标题栏同一行；role=tablist + 逐标签 role=tab 由装配层写入，
  // 这里只给容器与读屏名。
  const tabStrip = document.createElement("nav");
  tabStrip.className = "tabstrip";
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "打开的文档");
  tabStrip.hidden = true;
  titlebar.append(traffic, tabStrip);

  const fileTree = pane("pane-filetree", "");
  const editor = pane("pane-editor", "");
  const treeMount = document.createElement("section");
  treeMount.className = "tree-pane";
  fileTree.append(treeMount);

  // modeline（M211 新增）：左「文件路径 › 大纲指示段」/ 右「语法 · 行数 · 编码」。
  const modeline = document.createElement("footer");
  modeline.className = "modeline";
  const modelinePath = document.createElement("span");
  modelinePath.className = "modeline-path";
  // 当前位置指示段（M148）：大纲入口与当前标题路径的落点，隐藏态由 src/toc.ts 维护。
  const modelineSection = document.createElement("button");
  modelineSection.type = "button";
  modelineSection.className = "modeline-section";
  modelineSection.hidden = true;
  const left = document.createElement("div");
  left.className = "modeline-left";
  left.append(modelinePath, modelineSection);
  const modelineMeta = document.createElement("span");
  modelineMeta.className = "modeline-meta";
  const right = document.createElement("div");
  right.className = "modeline-right";
  right.append(modelineMeta);
  modeline.append(left, right);

  root.append(titlebar, fileTree, editor, modeline);
  mount.replaceChildren(root);
  return {
    root,
    titlebar,
    tabStrip,
    fileTree,
    treeMount,
    editor,
    modeline,
    modelinePath,
    modelineSection,
    modelineMeta,
  };
}
