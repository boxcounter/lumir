// 全类型文件树（add-vault-workspace，file-tree capability）。
// 数据源是 fs-io 的枚举结果 + fs:entry_changed 增量事件，webview 不直接触文件系统
//（ADR 0002 §3）。模型与 DOM 分离：增量事件先打补丁到模型，再对受影响节点做
// 局部 DOM 增删，不全量重绘；展开/折叠状态独立保存在 expanded 集合里，刷新不丢。

import type { FsChange } from "./bindings/FsChange";
import type { FsEntry } from "./bindings/FsEntry";

/** 展示分类（spec：至少区分目录 / Markdown / 图片等可预览附件 / 其他）。 */
export type DisplayKind = "dir" | "md" | "image" | "other";

/** 点击打开的行为分类：md / code 进编辑器对应模式，text 只读原文，binary 给提示。 */
export type OpenKind = "md" | "code" | "text" | "binary";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "heic",
]);
const CODE_EXTS = new Set([
  "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "toml", "yaml", "yml",
  "css", "html", "py", "go", "java", "c", "h", "cpp", "hpp", "swift", "kt",
  "sh", "bash", "zsh", "rb", "php", "lua", "sql", "xml", "vue", "svelte",
]);
// 明确二进制的扩展名：直接"暂不支持预览"，不浪费一次读取。
const BINARY_EXTS = new Set([
  "pdf", "zip", "gz", "tar", "rar", "7z", "dmg", "exe", "dll", "so", "dylib",
  "app", "jar", "class", "wasm", "ttf", "otf", "woff", "woff2", "mp3", "mp4",
  "mov", "avi", "mkv", "wav", "flac", "sqlite", "db", "icns", "doc", "docx",
  "xls", "xlsx", "ppt", "pptx", "sketch", "fig",
]);

function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // 无扩展名或点开头（.gitignore 这类）按无扩展名处理
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function displayKind(entry: FsEntry): DisplayKind {
  if (entry.kind === "dir") return "dir";
  const ext = extOf(entry.path);
  if (ext === "md" || ext === "markdown") return "md";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "other";
}

/** 打开行为分类：binary 走"暂不支持预览"，其余尝试按文本读（含无扩展名）。 */
export function openKind(path: string): OpenKind {
  const ext = extOf(path);
  if (ext === "md" || ext === "markdown") return "md";
  if (IMAGE_EXTS.has(ext) || BINARY_EXTS.has(ext)) return "binary";
  if (CODE_EXTS.has(ext)) return "code";
  return "text";
}

export interface FileTreeCallbacks {
  /** 点击文件：按 openKind 分类交给装配层处理。 */
  onOpenFile(path: string, kind: OpenKind): void;
  /** 「打开 vault」入口：空态按钮与树头部的常驻切换入口共用。 */
  onOpenVault(): void;
  onCurrentPathChanged?: (path: string | undefined) => void;
  referenceCount?: (path: string) => number | undefined;
}

export interface FileTree {
  /** 打开 vault 成功：全量装载条目。 */
  setVault(root: string, entries: FsEntry[]): void;
  setCurrentPath(path: string | undefined): void;
  /** 消费 fs:entry_changed 增量：局部更新，保持展开状态。 */
  applyChanges(changes: FsChange[]): void;
  /** 未打开 vault 空态；notice 为 last_vault 恢复失败等的人话提示。 */
  showEmpty(notice: string | null): void;
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
  return nameOf(a.entry.path).localeCompare(nameOf(b.entry.path));
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function createFileTree(mount: HTMLElement, cb: FileTreeCallbacks): FileTree {
  // 全量模型：path → Node；根路径为 ""。展开状态独立保存，刷新不丢（spec 3.3）。
  const nodes = new Map<string, Node>();
  const expanded = new Set<string>();
  let vaultName = "";

  const rootEl = document.createElement("div");
  rootEl.className = "filetree";

  function sortedChildren(node: Node): Node[] {
    return [...(node.children?.values() ?? [])].sort(byTreeOrder);
  }

  function renderRow(node: Node): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "ft-item";
    li.dataset.path = node.entry.path;

    const row = document.createElement("button");
    row.type = "button";
    const kind = displayKind(node.entry);
    row.className = `ft-row ft-${kind}`;
    row.title = node.entry.path;
    row.dataset.depth = String(node.entry.path ? node.entry.path.split("/").length - 1 : 0);
    row.setAttribute("aria-label", node.entry.path);

    const caret = document.createElement("span");
    caret.className = "ft-caret";
    const name = document.createElement("span");
    name.className = "ft-name";
    name.textContent = nameOf(node.entry.path);
    row.append(caret, name);
    li.append(row);

    if (node.entry.kind === "dir") {
      const ul = document.createElement("ul");
      ul.className = "ft-children";
      ul.hidden = !expanded.has(node.entry.path);
      li.append(ul);
      node.childrenUl = ul;
      syncCaret(node);
      row.addEventListener("click", () => toggle(node));
      if (expanded.has(node.entry.path)) {
        for (const child of sortedChildren(node)) mountNode(child, ul);
      }
    } else {
      row.addEventListener("click", () =>
        cb.onOpenFile(node.entry.path, openKind(node.entry.path)),
      );
    }
    node.li = li;
    return li;
  }

  function syncCaret(node: Node) {
    const caret = node.li?.querySelector(".ft-caret");
    if (caret) caret.textContent = expanded.has(node.entry.path) ? "▾" : "▸";
  }

  function toggle(node: Node) {
    if (expanded.has(node.entry.path)) {
      expanded.delete(node.entry.path);
      if (node.childrenUl) node.childrenUl.hidden = true;
    } else {
      expanded.add(node.entry.path);
      if (node.childrenUl) {
        node.childrenUl.replaceChildren();
        for (const child of sortedChildren(node)) mountNode(child, node.childrenUl);
        node.childrenUl.hidden = false;
      }
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
      parent?.children?.set(nameOf(entry.path), node);
    }

    rootEl.replaceChildren();
    const header = document.createElement("div");
    header.className = "ft-header";
    const name = document.createElement("span");
    name.className = "ft-vault-name";
    name.textContent = vaultName;
    // 常驻切换入口：与空态「打开 vault」共用 onOpenVault（替换语义，见 commands.rs open_vault）
    const switchBtn = document.createElement("button");
    switchBtn.type = "button";
    switchBtn.className = "ft-switch-btn";
    switchBtn.textContent = "切换";
    switchBtn.title = "切换 vault";
    switchBtn.setAttribute("aria-label", "切换 vault");
    switchBtn.addEventListener("click", () => cb.onOpenVault());
    header.append(name, switchBtn);
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

  let currentPath: string | undefined;
  function syncCurrent() {
    rootEl.querySelectorAll<HTMLElement>(".ft-row").forEach((row) => {
      const active = row.closest<HTMLElement>(".ft-item")?.dataset.path === currentPath;
      row.classList.toggle("is-current", active);
      row.querySelector(".ft-current-mark")?.remove();
      if (active) {
        const mark = document.createElement("span");
        mark.className = "ft-current-mark";
        mark.textContent = "¶";
        row.prepend(mark);
      }
    });
  }

  return {
    setCurrentPath(path) {
      currentPath = path;
      syncCurrent();
    },
    setVault(root, entries) {
      vaultName = root.slice(root.lastIndexOf("/") + 1) || root;
      expanded.clear();
      renderAll(entries);
      mount.replaceChildren(rootEl);
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
        const name = nameOf(change.path);
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
