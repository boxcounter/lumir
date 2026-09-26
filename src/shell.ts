// app-shell 布局骨架 —— M1 接缝（架构复查 P2-7）。
import { WIDTH_HANDLE_LABEL } from "./content-width";
// 只建容器：标题栏（traffic 灯区 + 标签 + 产品标识块）/ 侧栏 / 编辑器 / modeline 四区，
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
//
// M236（change product-version-display）：标题栏第三段 = 右端产品标识块
//（span.titlebar-identity：ti-name / ti-sep / ti-version 三段）。内容填充、读屏名与
// 窄窗退让（<640px 时版本号退 modeline 右段的 modelineVersion 段）全在 src/modeline.ts，
// 这里只建 DOM——容器初始 hidden，元信息读不到就永远不显示（不渲染假版本号）。

export interface AppShell {
  root: HTMLElement;
  /** 标题栏容器：traffic 灯区（原生绘制，只占位）+ 标签段 + 右端产品标识块；整条带拖拽区。 */
  titlebar: HTMLElement;
  /** 标签栏容器（M149）：条目由 src/main.ts 渲染；无打开文件时 hidden。 */
  tabStrip: HTMLElement;
  /** 标题栏右端产品标识块（M236）：三段（名 / 分隔符 / 版本号）的容器与各段。
   *  初始 hidden——元信息读不到就永远不显示；填充与退让逻辑在 src/modeline.ts。 */
  titlebarIdentity: { block: HTMLElement; name: HTMLElement; sep: HTMLElement; version: HTMLElement };
  /** 文件树 pane（createFileTree 挂载点）。 */
  fileTree: HTMLElement;
  treeMount: HTMLElement;
  /** 编辑器 pane（CM6 单内核挂载点）。 */
  editor: HTMLElement;
  /** 栏宽拖拽手柄（M228，change content-width-drag）：覆盖层容器 + 左右缘手柄条。
   *  定位 / 拖拽 / 空态显隐由 src/content-width.ts 的控制器承担，这里只建 DOM。 */
  widthHandles: { overlay: HTMLElement; left: HTMLElement; right: HTMLElement };
  /** modeline 容器：它同时是大纲浮层的定位块（见 src/toc.ts 的 mount）。 */
  modeline: HTMLElement;
  /** modeline 左段的当前文件路径（含 dirty 后缀），由装配层写入。 */
  modelinePath: HTMLElement;
  /** modeline 的当前位置指示段（M148 大纲入口，内容由 src/toc.ts 维护；无内容时隐藏）。 */
  modelineSection: HTMLButtonElement;
  /** modeline 右段（语法 · 行数 · 编码），由装配层写入。 */
  modelineMeta: HTMLElement;
  /** modeline 右段的版本号段（M236，D2 备选）：窄窗（<640px）时标题栏退下来的版本号落这里；
   *  常态 hidden。与 modelineMeta 是两个独立元素、各有写入者，MUST NOT 合写。 */
  modelineVersion: HTMLElement;
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
  // 右端产品标识块（M236，D1 裁决：右端）：纯展示文本（span 不是 clickable 元素，
  // drag.js 不为它阻断拖拽——标识块上按下拖拽窗口仍成立，场景 39 覆盖）。三段分离是
  // 为了窄窗退让能只藏「分隔符 + 版本号」（src/modeline.ts）。读屏口径：可见文本本身
  // 就是可访问内容（静态文本 SR 直接读），不给容器贴 aria-label——generic span 的
  // aria-label 在 WebKit/Chromium 都不会被报读，贴了是假读屏名；分隔符「·」是纯排版
  // （与标题链「›」同先例，不进文案 deck 编号），标 aria-hidden 防它被读成 "dot"。
  // 初始 hidden：元信息没读到就永远不显示。
  const identityBlock = document.createElement("span");
  identityBlock.className = "titlebar-identity";
  identityBlock.hidden = true;
  const identityName = document.createElement("span");
  identityName.className = "ti-name";
  const identitySep = document.createElement("span");
  identitySep.className = "ti-sep";
  identitySep.setAttribute("aria-hidden", "true");
  const identityVersion = document.createElement("span");
  identityVersion.className = "ti-version";
  identityBlock.append(identityName, identitySep, identityVersion);
  titlebar.append(traffic, tabStrip, identityBlock);

  const fileTree = pane("pane-filetree", "");
  const editor = pane("pane-editor", "");

  // 栏宽拖拽手柄（M228，change content-width-drag，D5：md 与 code 模式都有）：shell 层覆盖
  // 元素，与 CM 挂载点并列、MUST NOT 进 `.cm-scroller` / `.cm-content`（CM 按 border-box 量
  // 行高，文档流内的异物会污染测量——M110 同族纪律）。常态不可见（视觉线 opacity 0 + 容器
  // hidden，显隐由控制器按空态分叉管），hover / 拖拽中显现；读屏身份是 separator。
  // 读屏名取 src/content-width.ts 的 WIDTH_HANDLE_LABEL（文案 D120 的单一来源）。
  const widthOverlay = document.createElement("div");
  widthOverlay.className = "content-width-handles";
  widthOverlay.hidden = true;
  const makeHandle = (side: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = `content-width-handle content-width-handle-${side}`;
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", "vertical");
    el.setAttribute("aria-label", WIDTH_HANDLE_LABEL);
    el.tabIndex = 0;
    return el;
  };
  const widthLeft = makeHandle("left");
  const widthRight = makeHandle("right");
  widthOverlay.append(widthLeft, widthRight);
  editor.append(widthOverlay);
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
  // 版本号段（M236，D2 备选）：窄窗退让时标题栏版本号的落点，内容与显隐由
  // src/modeline.ts 写；常态 hidden。
  const modelineVersion = document.createElement("span");
  modelineVersion.className = "modeline-version";
  modelineVersion.hidden = true;
  const right = document.createElement("div");
  right.className = "modeline-right";
  right.append(modelineMeta, modelineVersion);
  modeline.append(left, right);

  root.append(titlebar, fileTree, editor, modeline);
  mount.replaceChildren(root);
  return {
    root,
    titlebar,
    tabStrip,
    titlebarIdentity: { block: identityBlock, name: identityName, sep: identitySep, version: identityVersion },
    fileTree,
    treeMount,
    editor,
    widthHandles: { overlay: widthOverlay, left: widthLeft, right: widthRight },
    modeline,
    modelinePath,
    modelineSection,
    modelineMeta,
    modelineVersion,
  };
}
