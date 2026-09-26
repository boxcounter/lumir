// 全类型文件树（add-vault-workspace，file-tree capability）。
// 数据源是 fs-io 的枚举结果 + fs:entry_changed 增量事件，webview 不直接触文件系统
//（ADR 0002 §3）。模型与 DOM 分离：增量事件先打补丁到模型，再对受影响节点做
// 局部 DOM 增删，不全量重绘；展开/折叠状态独立保存在 expanded 集合里，刷新不丢。
//
// 条目级操作（M244，change file-tree-context-menu）：右键菜单由装配层持有
//（src/tree-menu.ts），本模块只负责「哪一行被右键」与**内联编辑**（重命名 / 新建共用
// 同一形态：行名就地换成输入框，Enter 提交、Esc / 失焦取消、非法行内标红）。菜单与
// 对话框是浮层，不进这棵树的 DOM；编辑是**行局部**的，不是模态——树的其余交互照常。

import type { FsChange } from "./bindings/FsChange";
import type { FsEntry } from "./bindings/FsEntry";
import { keyToken } from "./keys";
import { fileClassOfPath } from "./preview/attachments";
import type { TreeMenuTarget } from "./tree-menu";

/** 显示分类（spec：至少区分目录 / Markdown / 图片等可预览附件 / 其他）。 */
export type DisplayKind = "dir" | "md" | "image" | "other";

/**
 * 枚举忽略集的前端副本（内联编辑的提示性预检用）。
 *
 * **权威是 `src-tauri/src/fs_io.rs` 的 `IGNORED_NAMES`**：命中的名字建成/改成之后不进
 * 文件树、watch 事件也被吞掉，用户在界面上既看不到也删不掉。这里抄一份只为「提交前就
 * 说清」，不承担判定职责（后端仍会拒）；两份的逐项对账在
 * `tests/unit/tree-paths.test.ts` 的「忽略集与 Rust 侧 IGNORED_NAMES 逐项对账」（它解析
 * 那份 Rust 源比对，漂移即红——
 * 与 `registry-drift.test.ts` 守 `SAVE_REJECTED_EXTENSIONS` 同一手法，REVIEW.md 第 8 条）。
 */
export const IGNORED_NAMES = [".git", ".DS_Store", "node_modules"];

/**
 * vault 根的绝对路径 + 树内相对路径（M244「复制完整路径」的**唯一一份**拼接，
 * design §3.3 点名：一处实现，MUST NOT 每个调用点各自拼）。裁决点 4：写进剪贴板的是
 * 绝对路径——相对路径离开 vault 上下文即失效，那不是「完整路径」的直觉语义。
 */
export function vaultAbsolutePath(root: string, rel: string): string {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  return rel === "" ? base : `${base}/${rel}`;
}

/** 内联编辑的文案（编号见 文案-Copy.md 的 D125 起）：新建时的输入框占位与三条读屏名。
 *  编辑框中「非法原因」的措辞与 `src-tauri/src/fs_io.rs` 的同名分支一致（见 validateEntryName）。 */
export const UNNAMED_TEXT = "未命名";
export const RENAME_INPUT_LABEL = (name: string): string => `重命名 ${name}`;
export const NEW_FILE_INPUT_LABEL = "新建文件的名称";
export const NEW_DIR_INPUT_LABEL = "新建子目录的名称";

/**
 * 内联编辑的末段名校验（导出是为了让校验矩阵直接单测，不必先造一棵树）：
 * 与 `src-tauri/src/fs_io.rs` 的 `validate_new_name` 逐条同源——非空、不含 `/`、
 * 不是 `.` / `..`、不命中忽略集，另加一条**前端特有**的撞名预检（同缀既有条目）。
 * 返回 undefined = 可提交；否则是行内要显示的原因句。
 *
 * 提交前会 trim（「   」这类只剩空白的名字按空处理），这是前端比后端更严的一处，
 * 方向正确：后端拒绝的东西前端不改，前端多挡的只是明显手误。
 */
export function validateEntryName(raw: string, siblings: ReadonlySet<string>): string | undefined {
  const name = raw.trim();
  if (name.length === 0) return "名称不能为空";
  if (name.includes("/")) return `名称不能包含斜杠：${name}`;
  if (name === "." || name === "..") return `${name} 不是有效的名称`;
  if (IGNORED_NAMES.includes(name)) return `${name} 在忽略集内，建成后不会出现在文件树里`;
  if (siblings.has(name)) return `已存在同名条目：${name}`;
  return undefined;
}

/**
 * 改名后的路径 remap（纯函数，M244 的裁决点 5）：路径正好是 `from` 时换成 `to`；落在
 * `from/` 子树下时换成 `to` 下对应位置；其余返回 undefined（不受影响）。
 *
 * 文件改名 = 单路径替换，目录改名 = 子树前缀替换，两条形态共用这一份判定——MUST NOT 在
 * 调用点各写一套前缀逻辑（REVIEW.md 第 8 条）。**放在这里而不是 editor.ts**：editor.ts
 * 顶部会拉起 CodeMirror 与预览层，单测层导入不了它（类型剥离跑不动预览层的构造器参数
 * 属性），而这条判定必须能被直接单测（tests/unit/tree-paths.test.ts）。
 */
export function remapPathAfterRename(
  path: string,
  from: string,
  to: string,
): string | undefined {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return undefined;
}
/** 路径 → 末段（basename）。**全前端唯一一份**（REVIEW.md 第 8 条）：文件树的行名与
 *  vault 名（都落在这里的侧栏头，M211 起 vault 名没有第二个展示位）、标签可见文本
 *  （tabs.ts）、切换器列表行与守卫提示（vault-switcher.ts / main.ts）全部消费它。空末段
 *  （路径以 `/` 收尾）回落到整串，与「根目录 / 空串」这类退化输入下的既有口径一致。
 *
 *  注意：注册表里的 vault 显示名不走这里——vault_list 的 `name` 字段由 Rust 侧派生
 *  （契约规定显示名 = 目录名），前端只消费，不重复派生。 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** 点击打开的行为分类：md / code 进编辑器对应模式，text 只读原文，binary 给提示。 */
export type OpenKind = "md" | "code" | "text" | "binary";

// 分类注册表（图片 / 二进制 / 代码 / Markdown，含 dotfile 的名字约定）的唯一事实源在
// preview/attachments.ts（M130 收敛、dotfile-jsonc-highlight 起含文件名表）；本文件只按分类
// 消费（`fileClassOfPath`），不再各自维护一套集合。

export function displayKind(entry: FsEntry): DisplayKind {
  if (entry.kind === "dir") return "dir";
  const cls = fileClassOfPath(entry.path);
  if (cls === "md") return "md";
  if (cls === "image") return "image";
  return "other";
}

/** 打开行为分类：image/binary 走"暂不支持预览"，其余尝试按文本读（含无扩展名）。 */
export function openKind(path: string): OpenKind {
  const cls = fileClassOfPath(path);
  if (cls === "md" || cls === "code" || cls === "text") return cls;
  return "binary";
}

export interface FileTreeCallbacks {
  /** 打开文件：按 openKind 分类交给装配层处理。`intent` 是打开意图（M149 多标签）——
   *  `"pinned"` = 新开固定标签，`"preview"` = 复用预览标签。判定形态由树决定（它是唯一
   *  看得到点击事件的地方）：**⌘-点击 = "pinned"**，其余单击 = "preview"，双击由 dblclick
   *  事件单独给出 "pinned"。 */
  onOpenFile(path: string, kind: OpenKind, intent: "preview" | "pinned"): void;
  /** 未打开 vault 空态里的「打开 vault」按钮（文案 D6）：走目录选择器链路。 */
  onOpenVault(): void;
  /** 树头部 vault 切换器入口（形态 A，M163）的点击：打开列表浮层。
   *  入口只在**已装载 vault**时存在——空态（含启动恢复进行中）没有列表入口。 */
  onOpenVaultSwitcher(): void;
  /** 条目右键（M244）：树只报「哪一行、什么条目、锚点是谁、指针在哪」——菜单本体与
   *  动作归装配层（树不 import 菜单模块的 DOM 层，保持「谁建 DOM 谁收事件」的分工，
   *  与浮层入口 / 浮层本体的分工同形）。右键 MUST NOT 触发打开或改上下文，因此这里
   *  没有 intent 一类的参数。 */
  onContextMenu(target: TreeMenuTarget, at: { x: number; y: number }): void;
  /** 内联编辑提交（重命名 / 新建共用同一形态）：装配层去调后端命令，结果经
   *  `endInlineEdit` 回到树上——只有装配层知道后端与 tab 联动。 */
  onInlineEditSubmit(request: InlineEditRequest): void;
}

/** 内联编辑的提交请求（树 → 装配层）。 */
export interface InlineEditRequest {
  /** rename = 改既有条目；create-file / create-dir = 在目录下新建。 */
  mode: "rename" | "create-file" | "create-dir";
  /** rename 时 = 被改条目的 vault 相对路径；create 时 = 父目录路径（根为 `""`）。 */
  path: string;
  /** 父目录的 vault 相对路径（根为 `""`）；后端按它 + `name` 定位目标。 */
  parentRel: string;
  /** 已 trim 的末段名。 */
  name: string;
}

export interface FileTree {
  /** 打开 vault 成功：全量装载条目。 */
  setVault(root: string, entries: FsEntry[]): void;
  setCurrentPath(path: string | undefined): void;
  /** 消费 fs:entry_changed 增量：局部更新，保持展开状态。 */
  applyChanges(changes: FsChange[]): void;
  /** 未打开 vault 空态；notice 为 last_vault 恢复失败等的人话提示。 */
  showEmpty(notice: string | null): void;
  /** 树头部的切换器入口元素（浮层的定位锚点）；未装载 vault 时为 undefined。 */
  vaultEntry(): HTMLElement | undefined;
  /** 切换器展开态同步（`aria-expanded`）——入口 DOM 由本模块建，展开态由浮层持有。 */
  setVaultEntryExpanded(expanded: boolean): void;
  /** 进入内联编辑：重命名该条目（§3.2）。条目不存在或已有编辑进行中时是空动作。 */
  beginRename(path: string): void;
  /** 进入内联编辑：在目录下新建（§3.5 / §3.6）。父不是目录或已有编辑进行中时空动作。 */
  beginCreate(parentRel: string, kind: "file" | "dir"): void;
  /** 编辑提交的结果回报：成功 = 退出编辑态；失败 = 留在编辑态并给原因（后端是权威）。 */
  endInlineEdit(ok: boolean, reason?: string): void;
  /** 正在编辑的条目路径 / 新建时的父目录；无编辑进行中为 undefined（断言口）。 */
  editingPath(): string | undefined;
}

interface Node {
  entry: FsEntry;
  /** 子节点按名称索引；文件为 null。 */
  children: Map<string, Node> | null;
  li?: HTMLLIElement;
  childrenUl?: HTMLUListElement;
}

/** 排序：目录在前、同缀按名称（spec 默认排序）。 */
function byTreeOrder(a: Node, b: Node): number {
  const aDir = a.entry.kind === "dir" ? 0 : 1;
  const bDir = b.entry.kind === "dir" ? 0 : 1;
  if (aDir !== bDir) return aDir - bDir;
  return baseName(a.entry.path).localeCompare(baseName(b.entry.path));
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** 切换器入口的悬停提示与读屏名（文案 D96）：入口是 vault 名称本身，纯文本看不出它可点，
 *  提示必须给出动作与收益（「点击查看全部 vault」）——同一句话两处复用，不写两份。 */
function vaultEntryLabel(vaultName: string): string {
  return `vault：${vaultName}（点击查看全部 vault）`;
}

/** 目录 caret（定稿 direction-c/index.html:211-214、:798-820）：9×9 细线 SVG chevron，
 *  展开 = 同一 chevron 旋转 90°（`.ft-caret.is-open` 的 transform + 0.12s 过渡在 CSS 侧），
 *  不再是折叠/展开两个字形（▸/▾）的跳切。stroke 取 currentColor，颜色仍由 .ft-caret 的
 *  --text-3 与 eink 反白规则承担。 */
const DIR_CARET_SVG =
  '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M3 1.8L6.2 4.5L3 7.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** vault 名后的 caret（定稿 index.html:787-789）：10×10 细线向下 chevron，紧随名称（不旋转）。 */
const VAULT_CARET_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function createFileTree(mount: HTMLElement, cb: FileTreeCallbacks): FileTree {
  // 全量模型：path → Node；根路径为 ""。展开状态独立保存，刷新不丢（spec 3.3）。
  const nodes = new Map<string, Node>();
  const expanded = new Set<string>();
  let vaultName = "";
  /** 树头部的切换器入口（形态 A）：未装载 vault 时不存在（空态整块替换）。 */
  let entryEl: HTMLButtonElement | undefined;

  const rootEl = document.createElement("div");
  rootEl.className = "filetree";

  function sortedChildren(node: Node): Node[] {
    return [...(node.children?.values() ?? [])].sort(byTreeOrder);
  }

  /** 行元素（button）：重命名起就整行换成 div 版（见 beginRename），取消时用它还原。 */
  function createRow(node: Node): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    const kind = displayKind(node.entry);
    row.className = `ft-row ft-${kind}`;
    row.title = node.entry.path;
    row.dataset.depth = String(node.entry.path ? node.entry.path.split("/").length - 1 : 0);
    row.setAttribute("aria-label", node.entry.path);
    row.setAttribute("aria-current", currentPath === node.entry.path ? "true" : "false");

    const caret = document.createElement("span");
    caret.className = "ft-caret";
    if (node.entry.kind === "dir") caret.innerHTML = DIR_CARET_SVG;
    const name = document.createElement("span");
    name.className = "ft-name";
    name.textContent = baseName(node.entry.path);
    row.append(caret, name);
    row.classList.toggle("is-current", currentPath === node.entry.path);

    // 右键（M244）：拦下系统菜单并把「哪一行」交给装配层。**不改上下文**——这里不调
    // onOpenFile，也不动 currentPath / 标签（右键即改选中是 Finder 的语义，而本树的
    // 「选中」等于「打开」，代价不对称，保持保守）。
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      cb.onContextMenu(
        {
          path: node.entry.path,
          kind: node.entry.kind === "dir" ? "dir" : "file",
          name: baseName(node.entry.path),
          anchor: row,
        },
        { x: event.clientX, y: event.clientY },
      );
    });

    if (node.entry.kind === "dir") {
      row.addEventListener("click", () => toggle(node));
    } else {
      const open = (intent: "preview" | "pinned") =>
        cb.onOpenFile(node.entry.path, openKind(node.entry.path), intent);
      // 单击 = 复用预览标签；⌘-点击 = 新固定标签（M149 语义，Alex 已裁决）。
      // 双击另发一次 "pinned"：浏览器在 dblclick 之前会先派发两次 click，那两次落在
      // 「同一文件已打开 → 切过去」的路径上，随后这次 pinned 把它固定住——这正是
      // 「双击 = 固定」的落点，不需要在树里做时间窗去抖。
      row.addEventListener("click", (event) => open(event.metaKey ? "pinned" : "preview"));
      row.addEventListener("dblclick", () => open("pinned"));
    }
    return row;
  }

  function renderRow(node: Node): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "ft-item";
    li.dataset.path = node.entry.path;

    const row = createRow(node);
    li.append(row);
    node.li = li;

    if (node.entry.kind === "dir") {
      const ul = document.createElement("ul");
      ul.className = "ft-children";
      ul.hidden = !expanded.has(node.entry.path);
      li.append(ul);
      node.childrenUl = ul;
      syncCaret(node);
      if (expanded.has(node.entry.path)) {
        for (const child of sortedChildren(node)) mountNode(child, ul);
      }
    }
    return li;
  }

  function syncCaret(node: Node) {
    node.li?.querySelector(".ft-caret")?.classList.toggle("is-open", expanded.has(node.entry.path));
  }

  /** 展开目录节点（渲染子节点、去掉 hidden）——toggle 的展开支与「新建时确保父目录可见」
   *  共用这一份，MUST NOT 在两处各写一套挂载逻辑。 */
  function expandNode(node: Node) {
    if (node.childrenUl === undefined) return;
    expanded.add(node.entry.path);
    node.childrenUl.replaceChildren();
    for (const child of sortedChildren(node)) mountNode(child, node.childrenUl);
    node.childrenUl.hidden = false;
  }

  function toggle(node: Node) {
    if (expanded.has(node.entry.path)) {
      expanded.delete(node.entry.path);
      if (node.childrenUl) node.childrenUl.hidden = true;
    } else {
      expandNode(node);
    }
    syncCaret(node);
  }

  /** 按排序位把节点挂进父 ul（局部插入，不重绘兄弟节点）。 */
  function mountNode(node: Node, parentUl: HTMLUListElement) {
    const li = renderRow(node);
    const siblings = [...parentUl.children] as HTMLLIElement[];
    const next = siblings.find((s) => {
      const sib = nodes.get(s.dataset.path ?? "");
      return sib !== undefined && byTreeOrder(node, sib) < 0;
    });
    parentUl.insertBefore(li, next ?? null);
  }

  function renderAll(entries: FsEntry[]) {
    nodes.clear();
    const root: Node = {
      entry: { path: "", kind: "dir", size: 0, mtime_ms: null },
      children: new Map(),
    };
    nodes.set("", root);
    for (const entry of entries) {
      const node: Node = {
        entry,
        children: entry.kind === "dir" ? new Map() : null,
      };
      nodes.set(entry.path, node);
      const parent = nodes.get(parentOf(entry.path));
      // 枚举结果是完整清单，父节点必已存在（按路径序父先于子）
      parent?.children?.set(baseName(entry.path), node);
    }

    rootEl.replaceChildren();
    const header = document.createElement("div");
    header.className = "ft-header";
    // 常驻切换入口（形态 A，M163）：**vault 名称本身即入口** + caret 作可点提示，现状的
    // 「切换」文字按钮退场（D4 因此停用，不复用）。单 vault 时常驻出现——隐藏它会让「再加
    // 一个 vault」在界面上无处可去。列表语义（aria-haspopup / aria-expanded）在这里给出，
    // 展开态由浮层同步（setVaultEntryExpanded）。
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "ft-vault";
    entry.setAttribute("aria-haspopup", "listbox");
    entry.setAttribute("aria-expanded", "false");
    entry.title = vaultEntryLabel(vaultName);
    entry.setAttribute("aria-label", vaultEntryLabel(vaultName));
    const name = document.createElement("span");
    name.className = "ft-vault-name";
    name.textContent = vaultName;
    const caret = document.createElement("span");
    caret.className = "ft-vault-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.innerHTML = VAULT_CARET_SVG;
    entry.append(name, caret);
    entry.addEventListener("click", () => cb.onOpenVaultSwitcher());
    // mousedown 不夺焦点（与 .lumir-toc 的指示段同手法）：浮层开着时点入口是一次「关」，
    // 若这里夺走焦点，浮层会先经 blur 收起、随后的 click 又把它开回来（闪一下 + 假翻一次
    // aria-expanded）；不夺焦则 click 落在「已开 → toggle 收起」这条路上。
    entry.addEventListener("mousedown", (event) => event.preventDefault());
    entryEl = entry;
    header.append(entry);
    const ul = document.createElement("ul");
    ul.className = "ft-children ft-root-list";
    for (const child of sortedChildren(root)) mountNode(child, ul);
    rootEl.append(header, ul);
  }

  /** 展开状态随节点删除清理（含子孙）。 */
  function pruneExpanded(path: string) {
    for (const p of [...expanded]) {
      if (p === path || p.startsWith(path + "/")) expanded.delete(p);
    }
  }

  // ---------------------------------------------------------------------------
  // 内联编辑（重命名 / 新建共用同一形态；M244 §2.3）
  //
  // 形态：编辑中的那一行整行换成 `<div class="ft-row is-editing">`（原先是 `<button>`），
  // 里面是 caret + `<input class="ft-edit">` + 一行错误文本。**换元素而不是在 button
  // 里塞 input**：交互内容不能嵌在 button 里（语义非法、且 button 的激活语义会跟输入抢
  // 回车），换成 div 后「编辑期间该行的打开 / 折叠 / 右键交互被抑制」是**结构性成立**的
  // ——新元素根本没有那些监听，也不需要一堆 if 开关。树的其余行不受影响（编辑是行局部
  // 的，不是模态）。
  //
  // 校验是**提示性预检**（后端权威）：非法即时标红 + 说明，MUST NOT 弹 toast 轰炸（§2.3）。
  // ---------------------------------------------------------------------------

  interface InlineEdit {
    mode: InlineEditRequest["mode"];
    path: string;
    parentRel: string;
    input: HTMLInputElement;
    error: HTMLElement;
    /** create 专用：临时行元素（提交成功后撤掉，真实节点由 watcher 回响收敛进来）。 */
    tempLi?: HTMLLIElement;
    /** rename 专用：还原原行（取消 / 成功后把 button 版换回去）。 */
    restore?: () => void;
    /** 提交中：提交与 blur 会互相触发，用它隔开（提交路径不接受 blur 的取消）。 */
    submitting: boolean;
    /** 即时校验（提交前再跑一次，避免只依赖最后一次 input 事件）。 */
    check: () => string | undefined;
    /** rename 的原名（同名提交视为取消，不必往返一次后端）。 */
    original: string;
  }

  let editing: InlineEdit | null = null;

  /** 同缀既有条目名（撞名预检的数据源）；rename 时排除条目自己。 */
  function siblingNames(parentRel: string, exclude?: string): Set<string> {
    const names = new Set<string>();
    for (const name of nodes.get(parentRel)?.children?.keys() ?? []) {
      if (name !== exclude) names.add(name);
    }
    return names;
  }

  /**
   * 末段名校验（与 `src-tauri/src/fs_io.rs` 的 `validate_new_name` 逐条同源：非空 /
   * 不含 `/` / 不是 `.`/`..` / 不命中忽略集 / 不撞名）。措辞与后端同名分支一致，让
   * 「前端先说清」与「后端拒绝」两处说同一句话。
   */
  function validateName(raw: string, siblings: Set<string>): string | undefined {
    return validateEntryName(raw, siblings);
  }

  function editRow(kind: "file" | "dir", placeholder: string): {
    row: HTMLElement;
    input: HTMLInputElement;
    error: HTMLElement;
  } {
    const row = document.createElement("div");
    row.className = `ft-row ${kind === "dir" ? "ft-dir" : "ft-other"} is-editing`;
    const caret = document.createElement("span");
    caret.className = "ft-caret";
    if (kind === "dir") caret.innerHTML = DIR_CARET_SVG;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ft-edit";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    const error = document.createElement("span");
    error.className = "ft-edit-error";
    row.append(caret, input, error);
    return { row, input, error };
  }

  function wireEdit(state: InlineEdit, siblings: Set<string>): void {
    const { input, error } = state;
    const refresh = (): string | undefined => {
      const reason = validateName(input.value, siblings);
      const invalid = reason !== undefined;
      input.classList.toggle("is-invalid", invalid);
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
      error.textContent = reason ?? "";
      return reason;
    };
    state.check = refresh;
    input.addEventListener("input", () => {
      refresh();
    });
    // Enter 提交、Esc 取消。两个键在输入框内就地消费（preventDefault）：编辑器键位层
    // 的作用域按「事件目标是否在 contentDOM 内」判定，这里本来就不命中；显式消费是给
    // 「以后谁在 window 上加监听」留一道不依赖作用域的保险。
    input.addEventListener("keydown", (event) => {
      const token = keyToken(event);
      if (token === "Enter") {
        event.preventDefault();
        submitEdit();
        return;
      }
      if (token === "Escape") {
        event.preventDefault();
        cancelEdit();
      }
    });
    // 失焦即取消（与 Finder 一致）。提交路径把它挡掉——那一路是我们自己收走的。
    input.addEventListener("blur", () => {
      if (state.submitting) return;
      cancelEdit();
    });
    // 输入框自己的右键不弹树菜单（编辑期不换上下文）。
    input.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function beginRename(path: string): void {
    if (editing !== null) return;
    const node = nodes.get(path);
    const li = node?.li;
    if (node === undefined || li === undefined) return;
    const row = li.querySelector<HTMLElement>(".ft-row");
    if (row === null) return;
    const parentRel = parentOf(path);
    const original = baseName(path);
    const { row: edit, input, error } = editRow(
      node.entry.kind === "dir" ? "dir" : "file",
      original,
    );
    input.value = original;
    input.setAttribute("aria-label", RENAME_INPUT_LABEL(original));
    const state: InlineEdit = {
      mode: "rename",
      path,
      parentRel,
      input,
      error,
      submitting: false,
      check: () => undefined,
      original,
      restore: () => {
        if (edit.parentElement === li) li.replaceChild(row, edit);
      },
    };
    li.replaceChild(edit, row);
    editing = state;
    wireEdit(state, siblingNames(parentRel, original));
    input.focus();
  }

  function beginCreate(parentRel: string, kind: "file" | "dir"): void {
    if (editing !== null) return;
    const parent = nodes.get(parentRel);
    if (parent === undefined || parent.entry.kind !== "dir") return;
    // 目录折叠时先展开：输入框要落在可见位置上；这是「新建的落点可见」的必要条件，
    // 与「新建子目录不自动展开父目录」（§3.6）不是同一条——那条说的是**新建出来的
    // 目录**不展开自己，不是不展开父。
    expandNode(parent);
    const ul =
      parentRel === ""
        ? rootEl.querySelector<HTMLUListElement>(".ft-root-list")
        : parent.childrenUl;
    if (ul === undefined || ul === null) return;
    const { row, input, error } = editRow(kind, UNNAMED_TEXT);
    const li = document.createElement("li");
    li.className = "ft-item is-new";
    li.append(row);
    // 首位子节点：新建项是临时的，插在最前不打扰既有排序（排序由挂载时的比较决定，
    // 而它不参与那套比较）。
    ul.insertBefore(li, ul.firstChild);
    ul.hidden = false;
    const state: InlineEdit = {
      mode: kind === "dir" ? "create-dir" : "create-file",
      path: parentRel,
      parentRel,
      input,
      error,
      tempLi: li,
      submitting: false,
      check: () => undefined,
      original: "",
    };
    editing = state;
    const siblings = siblingNames(parentRel);
    wireEdit(state, siblings);
    input.setAttribute("aria-label", kind === "dir" ? NEW_DIR_INPUT_LABEL : NEW_FILE_INPUT_LABEL);
    input.focus();
  }

  function cancelEdit(): void {
    const state = editing;
    if (state === null) return;
    editing = null;
    state.tempLi?.remove();
    state.restore?.();
  }

  function submitEdit(): void {
    const state = editing;
    if (state === null || state.submitting) return;
    const reason = state.check();
    if (reason !== undefined) return; // 非法：留在编辑态，行内已经标红
    const name = state.input.value.trim();
    // 同名提交 = 取消（后端会把它判成「目标已存在」，但那是我们自己的文件，不该报错）
    if (state.mode === "rename" && name === state.original) {
      cancelEdit();
      return;
    }
    state.submitting = true;
    cb.onInlineEditSubmit({
      mode: state.mode,
      path: state.path,
      parentRel: state.parentRel,
      name,
    });
  }

  let currentPath: string | undefined;
  function syncCurrent() {
    rootEl.querySelectorAll<HTMLElement>(".ft-row").forEach((row) => {
      const active = row.closest<HTMLElement>(".ft-item")?.dataset.path === currentPath;
      row.classList.toggle("is-current", active);
      row.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  return {
    setCurrentPath(path) {
      currentPath = path;
      syncCurrent();
    },
    setVault(root, entries) {
      vaultName = baseName(root);
      expanded.clear();
      // 整棵树换掉：编辑中的行随 DOM 一起消失，编辑态必须一起作废（否则 editing 会
      // 指着已脱离文档的输入框，后续 beginRename 全被它挡住）。
      editing = null;
      renderAll(entries);
      mount.replaceChildren(rootEl);
    },

    vaultEntry() {
      return entryEl;
    },

    setVaultEntryExpanded(expanded) {
      entryEl?.setAttribute("aria-expanded", expanded ? "true" : "false");
    },

    beginRename(path) {
      beginRename(path);
    },

    beginCreate(parentRel, kind) {
      beginCreate(parentRel, kind);
    },

    editingPath() {
      return editing?.path;
    },

    endInlineEdit(ok, reason) {
      const state = editing;
      if (state === null) return;
      if (ok) {
        // 成功即退出编辑态：重命名的**新名由 watcher 回响收敛**（§3.5/§3.2：唯一收敛
        // 通道仍是事件流，不自绘树补丁）；新建的临时行直接撤掉，真实节点同样等回响。
        editing = null;
        state.tempLi?.remove();
        state.restore?.();
        return;
      }
      // 失败：留在编辑态并把原因写在行内（后端是权威——前端预检没拦住的那几类都经这里）。
      state.submitting = false;
      if (reason !== undefined && reason !== "") {
        state.error.textContent = reason;
        state.input.classList.add("is-invalid");
        state.input.setAttribute("aria-invalid", "true");
      }
      state.input.focus();
    },

    applyChanges(changes) {
      // FSEvents 不保证同批内父先于子：按路径深度排序后再应用，
      // 避免子事件先于父事件到达时被"父缺失"丢弃（条目要等全量重扫才回来）。
      const sorted = [...changes].sort(
        (a, b) => a.path.split("/").length - b.path.split("/").length,
      );
      for (const change of sorted) {
        const parentPath = parentOf(change.path);
        const parent = nodes.get(parentPath);
        if (!parent) continue; // 父目录已不在模型里（如整棵被删），跳过
        const name = baseName(change.path);
        const existing = nodes.get(change.path);

        if (change.kind === "deleted") {
          if (existing) {
            parent.children?.delete(name);
            existing.li?.remove();
            // 连同子孙一起从模型删除（子孙 DOM 随 li 一并移除）：否则子孙残留
            // 为孤儿，同路径重建时命中 existing 走 upsert 分支，永远不会被挂进
            // 新建目录的 children——条目在树里消失，直到重启全量重扫。
            for (const key of [...nodes.keys()]) {
              if (key === change.path || key.startsWith(change.path + "/")) {
                nodes.delete(key);
              }
            }
            pruneExpanded(change.path);
          }
          // 正在编辑的那一条被外部删掉了：编辑态作废（那一行的输入框已随 DOM 消失，
          // 留着 editing 会把后续的 beginRename / beginCreate 全部挡掉）。
          if (
            editing !== null &&
            (editing.path === change.path || editing.path.startsWith(change.path + "/"))
          ) {
            editing = null;
          }
          continue;
        }

        // created / modified 统一按 upsert 处理：FSEvents 对两者区分是 best-effort
        //（见 fs_io.rs 的 kind 修正注释），前端对"已存在节点的 created"必须健壮。
        if (existing) {
          if (change.entry_kind) existing.entry = { ...existing.entry, kind: change.entry_kind };
          continue; // 树不展示 size/mtime，modified 无视觉变化
        }
        const node: Node = {
          entry: {
            path: change.path,
            kind: change.entry_kind ?? "file",
            size: 0,
            mtime_ms: null,
          },
          children: change.entry_kind === "dir" ? new Map() : null,
        };
        nodes.set(change.path, node);
        parent.children?.set(name, node);
        // 父目录已展开才插 DOM；折叠的等用户展开时从模型渲染
        if (parentPath === "" || expanded.has(parentPath)) {
          const ul =
            parentPath === ""
              ? rootEl.querySelector<HTMLUListElement>(".ft-root-list")
              : parent.childrenUl;
          if (ul && !ul.hidden) mountNode(node, ul);
        }
      }
    },

    showEmpty(notice) {
      // 空态整块替换掉整棵树，入口随之从 DOM 消失——「未装载 vault（含启动恢复进行中）
      // 时无列表入口」这条口径就落在这一句上（entryEl 一并置空，命令据此无操作）。
      entryEl = undefined;
      editing = null;
      const empty = document.createElement("div");
      empty.className = "ft-empty";
      if (notice) {
        const p = document.createElement("p");
        p.className = "ft-notice";
        p.textContent = notice;
        empty.append(p);
      }
      const hint = document.createElement("p");
      hint.className = "ft-hint";
      hint.textContent = "打开一个目录作为 vault，开始浏览全部文件。";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ft-open-btn";
      btn.textContent = "打开 vault";
      btn.addEventListener("click", () => cb.onOpenVault());
      empty.append(hint, btn);
      mount.replaceChildren(empty);
    },
  };
}
