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
 * 内置规则名字表的前端副本（内联编辑的提示性**预检**用，不是过滤）。
 *
 * **权威是 `src-tauri/src/fs_io.rs` 的 `BUILTIN_NAMES`**（16 个名字字面量）：命中的名字建成 /
 * 改成之后不进文件树、watch 事件也被挡下，用户在界面上既看不到也删不掉。这里抄一份只为
 * 「提交前就说清」，不承担判定职责（后端仍会拒，且它才是唯一判定实现）。两类的其余部分
 * ——保存临时文件模式两条（`.lumir-*` / `.*.lumir-*`）——**不在**本表里：它们不是名字，前端
 * 预检覆盖不到，由后端在提交时拒绝并给出人话原因。
 *
 * 逐项对账在 `tests/unit/tree-paths.test.ts` 的「内置名字表与 Rust 侧 BUILTIN_NAMES 逐项对账」
 * （它解析那份 Rust 源比对，漂移即红——与 `registry-drift.test.ts` 守
 * `SAVE_REJECTED_EXTENSIONS` 同一手法，REVIEW.md 第 8 条）。
 *
 * **用户规则**（vault 自己的 `.gitignore` / `.git/info/exclude`）命中的名字**不在这里**：
 * 那样名字本来就可见、可打开，只是不进索引，新建 / 改名 MUST NOT 被拒（design §3.2）。
 */
export const IGNORED_NAMES = [
  ".git",
  ".DS_Store",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".cache",
  ".pnpm-store",
  ".tox",
  ".gradle",
  "test-results",
  "perf-results",
  "target",
  "dist",
];

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
export const UNNAMED_TEXT = (): string => t("D139");
export const RENAME_INPUT_LABEL = (name: string): string => t("D140", { name });
export const NEW_FILE_INPUT_LABEL = (): string => t("D141");
export const NEW_DIR_INPUT_LABEL = (): string => t("D142");

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
  if (name.length === 0) return t("D143");
  if (name.includes("/")) return t("D144", { name });
  if (name === "." || name === "..") return t("D145", { name });
  if (IGNORED_NAMES.includes(name)) return t("D146", { name });
  if (siblings.has(name)) return t("D147", { target: name });
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
/**
 * 父目录相对路径 + 末段名 → 完整相对路径（根为 `""` 时就是末段名本身）。这是这条拼接的
 * **规范居所**（M258）：树用它把改名后的展开态搬到新路径，装配层用它登记改名回响抑制
 * （`src/main.ts` 的 submitInlineEdit 里有一份同形副本，两处必须同一条公式——
 * main.ts 不在本 mission 的 scope 内，未就地收口，已在 mission 报告里登记）。
 */
export function relativePathOf(parentRel: string, name: string): string {
  return parentRel === "" ? name : `${parentRel}/${name}`;
}

/**
 * 附件索引的增量补丁（change vault-open-ignore-set §4.6 的**前端一半**）：一条 `fs:entry_changed`
 * 增量怎么改「vault 内可作为附件的文件路径」这份索引。**纯判定 + 就地追加**，返回更新后的数组
 * （追加是就地 `push`：大批量事件下 MUST NOT 每条都拷一遍十万级的数组）。
 *
 * 三条口径：
 *  - **deleted ⇒ 无条件移除**（含子孙前缀，与 `applyChanges` 的级联删除同口径）；该方向
 *    **不消费 `lazy`**——幂等（本来不在索引里就是空操作），也绕开「被删路径 stat 不到、
 *    目录限定模式判不准类型」的歧义。
 *  - **created / modified 且 `lazy` ⇒ 不进索引**（两者同路：既有分支本来就是一个 else 支，
 *    这是 r3 评审 P2-1 点出的漏词）。反例：`HANDOFF.md` 被 `.gitignore` 声明时，外部改写它
 *    会让 `[[HANDOFF]]` 本会话内可解析、重开后不可解析——索引是磁盘 + 规则的纯函数，
 *    不是事件历史的函数。
 *  - 其余文件条目 ⇒ 补进索引（幂等：已在里面就不动）。
 *
 * **为什么住在这个模块**：它与文件树共用同一条事件流与同一份路径语义（级联删除口径必须一致），
 * 而 `src/main.ts`（真正的消费者）无法被单测层导入——它顶层 import 了 `./style.css` 并且一上手
 * 就要挂载 app。抽成纯函数放这里，是为了让这三条口径能被直接单测（REVIEW.md 第 1 条：判定落不到
 * 可复现的断言上就等于没有）。
 */
export function patchAttachmentPaths(paths: string[], change: FsChange): string[] {
  if (change.kind === "deleted") {
    return paths.filter((p) => p !== change.path && !p.startsWith(`${change.path}/`));
  }
  if (change.lazy) return paths;
  if ((change.entry_kind ?? "file") !== "file") return paths;
  if (paths.includes(change.path)) return paths;
  paths.push(change.path);
  return paths;
}

/** 路径 → 末段（basename）。**全前端唯一一份**（REVIEW.md 第 8 条）：文件树的行名与 *  vault 名（都落在这里的侧栏头，M211 起 vault 名没有第二个展示位）、标签可见文本
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
  /** 打开文件：按 openKind 分类交给装配层处理。**不带意图**（M254）：预览标签机制随
   *  change preview-tab-removal 退场后，单击 / 双击 / ⌘-点击树文件都是「开一个标签」，
   *  三者没有可区分的落点，树因此不再判定意图——落点归装配层一处（"new"）。 */
  onOpenFile(path: string, kind: OpenKind): void;
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
  /**
   * 惰性目录展开取数（后端 `fs_scan_dir`，change vault-open-ignore-set §4.3）：返回该目录的
   * **一层**条目（分类口径与全量枚举同源）。被 vault 自己的忽略声明挡住的目录，其子孙不在
   * 装载时的枚举结果里——展开它时才按需拉一层。
   *
   * 失败时**必须 reject**（装配层已负责提示）：树只在成功时把该目录标记成「已取回」，
   * 失败留给下次展开重试；MUST NOT 吞成空数组，那会把一次失败渲染成「空目录」。
   */
  onExpandLazyDir(path: string): Promise<FsEntry[]>;
}

/** 内联编辑的提交请求（树 → 装配层）。 */
import { onRelabel, t } from "./copy";

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
  /** 惰性目录（用户规则命中）：子孙**不在**装载时的枚举结果里，展开时经 `onExpandLazyDir`
   *  取回一层。它是「空目录」与「惰性目录」在模型里的唯一区分点（`src/tree.ts` 的
   *  `expandNode` 靠它决定要不要发命令）。文件恒为 false。 */
  lazy: boolean;
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
  return t("D96", { name: vaultName });
}

/** 目录 caret（定稿 direction-c/index.html:211-214、:798-820）：9×9 细线 SVG chevron，
 *  展开 = 同一 chevron 旋转 90°（`.ft-caret.is-open` 的 transform + 0.12s 过渡在 CSS 侧），
 *  不再是折叠/展开两个字形（▸/▾）的跳切。stroke 取 currentColor，颜色仍由 .ft-caret 的
 *  --text-3 与 eink 的选中态前景（--sel-text）承担。 */
const DIR_CARET_SVG =
  '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M3 1.8L6.2 4.5L3 7.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** vault 名后的 caret（定稿 index.html:787-789）：10×10 细线向下 chevron，紧随名称（不旋转）。 */
const VAULT_CARET_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** 一条行带的盒子（视口坐标），只取判定用得到的四个量。 */
export interface RowBand {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 行带命中的**唯一判定**（M251 的纯函数部分，DOM 接线在 createFileTree 里）：
 * 返回 `bands` 里命中的下标，未命中返回 `-1`。
 *
 * 判据（不变量「右键目标行 = 菜单作用行」的可证伪表述）：y 落在某行带的纵向区间之内
 * （含边界），且 x 不早于该行带的左缘——**右缘不设界**，因为行元素右缘到面板右缘之间那条带
 * （`.filetree` 的右内边距）在用户眼里仍属于这一行；`x` 不可能越过面板（事件只在树容器内触发）。
 * 行带在纵向上互不重叠（一行的行元素与它的子列表不重叠），因此至多一条命中。
 *
 * 拆成纯函数是为了让这条判据能在**零 DOM** 的单测层钉死（`tests/unit/tree-rows.test.ts`）：
 * 形状与边界（行带之间的缝、行左缘之外、空列表）都能扫，而那些正是只靠一条案例断言看不出的输入。
 */
export function rowBandHit(bands: readonly RowBand[], x: number, y: number): number {
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    if (y < band.top || y > band.bottom) continue;
    if (x < band.left) continue;
    return i;
  }
  return -1;
}

export function createFileTree(mount: HTMLElement, cb: FileTreeCallbacks): FileTree {
  // 全量模型：path → Node；根路径为 ""。展开状态独立保存，刷新不丢（spec 3.3）。
  const nodes = new Map<string, Node>();
  const expanded = new Set<string>();
  /** 子孙已按需取回的惰性目录（`onExpandLazyDir` 成功过）；换 vault 时清空。 */
  const lazyFetched = new Set<string>();
  /** 取数在途的惰性目录：同一目录只发一次命令（重复展开 / 与事件并发时靠它去重）。 */
  const lazyFetching = new Set<string>();
  let vaultName = "";
  /** 树头部的切换器入口（形态 A）：未装载 vault 时不存在（空态整块替换）。 */
  let entryEl: HTMLButtonElement | undefined;
  /** 空态当前显示的提示行（`undefined` = 不在空态）。语言切换后要能原样重建空态，
   *  否则「正在恢复上次打开的 vault……」这类长驻文本会停在切换前的语言上。 */
  let emptyNotice: string | null | undefined;

  const rootEl = document.createElement("div");
  rootEl.className = "filetree";

  /** 一行的链接带的判定（M251 的不变量：**右键目标行 = 菜单作用行**）。① 事件目标落在行元素
   *  内（caret / 名字 / 名字右侧被 `.ft-name` 的 `flex:1` 撑住的空白）→ 就是那一行；② 否则按几何
   *  找「纵向落在某行行带内、横向不早于该行左缘」的行——覆盖行元素右缘到面板边缘那一条带
   *  （`.filetree` 的右内边距 ~9px：`button.ft-row` 的盒子止于内边距之前，而行在用户眼里是
   *  「这一行」直到面板右缘）。几何那一半的判据是纯函数 `rowBandHit`（单测层钉死）。
   *
   *  编辑中的行（`.ft-row.is-editing`：重命名 / 新建）不参与——M244 §2.3 要求编辑期间该行的
   *  右键交互被抑制；编辑行是 div 版行元素，抑制在这里一次生效（不在调用点各写一遍）。
   *  缩进区（行左缘之外）同样不参与：那里不属于任何一行（与 M251 之前的命中面一致）。 */
  function rowLiAt(target: EventTarget | null, x: number, y: number): HTMLLIElement | null {
    if (target instanceof Element) {
      const inside = target.closest<HTMLElement>(".ft-row");
      if (inside !== null) {
        return inside.classList.contains("is-editing") ? null : inside.closest<HTMLLIElement>(".ft-item");
      }
    }
    const rows = [...rootEl.querySelectorAll<HTMLElement>(".ft-row:not(.is-editing)")];
    const bands = rows.map((row) => row.getBoundingClientRect());
    const hit = rowBandHit(bands, x, y);
    return hit < 0 ? null : rows[hit].closest<HTMLLIElement>(".ft-item");
  }

  // 右键监听挂在**容器**上（M251），不在每行的行元素上：行元素覆盖不到它右侧那条带。
  // 解析不到行时**不**拦系统菜单（面板空白 / 树头部 / 空态照旧，与 M251 之前的行为一致）。
  rootEl.addEventListener("contextmenu", (event) => {
    const li = rowLiAt(event.target, event.clientX, event.clientY);
    const node = li === null ? undefined : nodes.get(li.dataset.path ?? "");
    if (li === null || node === undefined) return;
    event.preventDefault();
    cb.onContextMenu(
      {
        path: node.entry.path,
        kind: node.entry.kind === "dir" ? "dir" : "file",
        name: baseName(node.entry.path),
        // 焦点归还的锚点仍是行元素本身（菜单关闭后 focus 它）。
        anchor: li.querySelector<HTMLElement>(".ft-row") ?? li,
      },
      { x: event.clientX, y: event.clientY },
    );
  });

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
    //
    // **监听挂在容器上（M251）**，不在行元素上：见 rootEl 那处 `contextmenu` 的注释——
    // 行元素只覆盖自己的盒子，而「这一行」在用户眼里还包括它右侧到面板边缘的那几像素。

    if (node.entry.kind === "dir") {
      row.addEventListener("click", () => toggle(node));
    } else {
      // 单击 / 双击 / ⌘-点击都是「打开这个文件」（M254）。**没有修饰键分支**了：原来的
      // 「⌘-点击 = 新固定标签」是相对「单击 = 复用预览标签」而言的，预览机制退场后两者
      // 落到同一个落点（新开一个标签），继续读 event.metaKey 只会留下一条永不生效的分支。
      //
      // dblclick 也一并删掉：浏览器在 dblclick 之前会先派发两次 click，两次都走打开——
      // 第一次建标签，第二次命中「同一个文件已经打开 → 切到既有标签」的短路。所以双击的
      // 可观察结果是「打开」这同一个，多一条监听只是重复。
      const open = () => cb.onOpenFile(node.entry.path, openKind(node.entry.path));
      row.addEventListener("click", open);
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
      if (expanded.has(node.entry.path)) renderChildren(node);
    }
    return li;
  }

  function syncCaret(node: Node) {
    node.li?.querySelector(".ft-caret")?.classList.toggle("is-open", expanded.has(node.entry.path));
  }

  /**
   * 渲染一个目录节点的子行。`expandNode`、惰性目录取数回来的重渲染、以及「节点挂载时已处于
   * 展开态」这三种情况共用这一份，MUST NOT 各写一套挂载逻辑。
   *
   * 行内编辑的**临时行**要放回首位：惰性目录的取数是异步的，回来时用户可能正在这个目录下
   * 新建（`beginCreate` 在子列表首位插了输入框）——直接 `replaceChildren` 会把输入框连同
   * 已敲的内容一起抹掉。临时行没有 `dataset.path`，所以先摘下来、挂完子行再 `prepend` 回去。
   */
  function renderChildren(node: Node) {
    const ul = node.childrenUl;
    if (ul === undefined) return;
    const keep =
      editing !== null && editing.tempLi !== undefined && editing.parentRel === node.entry.path
        ? editing.tempLi
        : undefined;
    ul.replaceChildren();
    for (const child of sortedChildren(node)) mountNode(child, ul);
    if (keep !== undefined) ul.prepend(keep);
  }

  /** 展开目录节点（渲染子节点、去掉 hidden）——toggle 的展开支与「新建时确保父目录可见」
   *  共用这一份。惰性目录在此发起按需取数（MUST NOT 阻塞界面，也不渲染成空目录）。 */
  function expandNode(node: Node) {
    if (node.childrenUl === undefined) return;
    expanded.add(node.entry.path);
    node.childrenUl.hidden = false;
    if (node.lazy && !lazyFetched.has(node.entry.path)) {
      void fetchLazyChildren(node);
      return; // 取数在途：这一拍子列表本来就空（子孙不在枚举结果里，不是「空目录」）
    }
    renderChildren(node);
  }

  /**
   * 惰性目录按需取数（后端 `fs_scan_dir`，只一层）：结果按路径合并进模型，然后重渲染子行。
   * 失败不标记已取回——下次展开重试；提示归装配层（`onExpandLazyDir` 的 reject）。
   *
   * 重复展开 / 展开与取数并发时靠 `lazyFetching` 去重（同一目录只发一次命令）；取数回来的
   * 合并是**按路径 upsert**，不覆盖用户在同一拍里做的别的操作（模型与 DOM 都只动这一层）。
   */
  async function fetchLazyChildren(node: Node): Promise<void> {
    const path = node.entry.path;
    if (lazyFetching.has(path)) return;
    lazyFetching.add(path);
    let entries: FsEntry[];
    try {
      entries = await cb.onExpandLazyDir(path);
    } catch {
      lazyFetching.delete(path);
      return;
    }
    lazyFetching.delete(path);
    lazyFetched.add(path);
    for (const entry of entries) mergeEntry(node, entry);
    if (expanded.has(path)) renderChildren(node);
    // 合并进来的子目录若自己也是惰性的，等它被展开时再走同一条通道（不在这里递归取数：
    // 「点开哪一层付哪一层」正是本能力的代价模型）。
  }

  /** 把一条条目合并进模型（惰性目录取数的落点）：路径已存在则更新条目、保留既有子节点。 */
  function mergeEntry(parent: Node, entry: FsEntry) {
    const existing = nodes.get(entry.path);
    if (existing !== undefined) {
      existing.entry = entry;
      existing.lazy = entry.lazy === true;
      if (entry.kind === "dir" && existing.children === null) existing.children = new Map();
      return;
    }
    const node: Node = {
      entry,
      children: entry.kind === "dir" ? new Map() : null,
      lazy: entry.lazy === true,
    };
    nodes.set(entry.path, node);
    parent.children?.set(baseName(entry.path), node);
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
      entry: { path: "", kind: "dir", size: 0, mtime_ms: null, lazy: false },
      children: new Map(),
      lazy: false,
    };
    nodes.set("", root);
    for (const entry of entries) {
      const node: Node = {
        entry,
        children: entry.kind === "dir" ? new Map() : null,
        lazy: entry.lazy === true,
      };
      nodes.set(entry.path, node);
      const parent = nodes.get(parentOf(entry.path));
      // 枚举结果是完整清单，父节点必已存在（按路径序父先于子）
      parent?.children?.set(baseName(entry.path), node);
    }

    rootEl.replaceChildren();
    emptyNotice = undefined;
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

  /** 路径被删时连同它的「已取回」登记一起清掉：同名新目录重建后必须重新按需取数
   *  （残留登记会让它展开时直接渲染成空目录——那正是「MUST NOT 渲染成空目录」要防的形态）。 */
  function pruneLazyFetched(path: string) {
    for (const p of [...lazyFetched]) {
      if (p === path || p.startsWith(path + "/")) lazyFetched.delete(p);
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

  /** 树自己发起的改名（M258）：提交那一刻登记 `from → to`（预测的新路径，与装配层 invoke 的
   *  请求同一个公式 `relativePathOf`），用来把「这一批事件是那次改名的回响」认出来——重命名
   *  后的目录的展开态随目录一起搬到新路径。改名失败（`endInlineEdit(false)`）即撤。
   *
   *  只登记**自己发起**的那一次、不做「同一批次里删了 X 又新建 Y」的通用配对：那样「删 A 建 B」
   *  在同一 debounce 窗口内到达时会被误判成改名，把 A 的展开态搬到 B 上（`expanded` 里可能
   *  正好有 A 的整棵前缀）。外部发起的改名没有登记，收敛路径与既不登记时一致（后端补出的
   *  子孙条目照常把子树建全，只是展开态不迁移——见 tests/unit/tree-rename.test.ts 的边界条）。 */
  let pendingRename: { from: string; to: string } | undefined;

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
    const { row, input, error } = editRow(kind, UNNAMED_TEXT());
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
    input.setAttribute("aria-label", kind === "dir" ? NEW_DIR_INPUT_LABEL() : NEW_FILE_INPUT_LABEL());
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
    // 改名提交即登记（M258）：回响批次到达时要认出「这是我自己发起的那次改名」，才能把展开态
    // 搬到新路径。登记在提交时而不是成功返回后——回响与 invoke 的返回走两条通道，事件可能先到
    // （失败路径由 endInlineEdit(false) 撤销登记）。
    if (state.mode === "rename") {
      pendingRename = { from: state.path, to: relativePathOf(state.parentRel, name) };
    }
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

  const tree: FileTree = {
    setCurrentPath(path) {
      currentPath = path;
      syncCurrent();
    },
    setVault(root, entries) {
      vaultName = baseName(root);
      expanded.clear();
      lazyFetched.clear();
      lazyFetching.clear();
      // 整棵树换掉：编辑中的行随 DOM 一起消失，编辑态必须一起作废（否则 editing 会
      // 指着已脱离文档的输入框，后续 beginRename 全被它挡住）。待认领的改名登记同理作废：
      // 换 vault 后的批次与它无关（M258）。
      editing = null;
      pendingRename = undefined;
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
      // 这次改名在磁盘上没有发生，撤销待认领的登记（M258）——否则下一条真事件的 deleted 可能
      // 撞上同一个旧路径，把展开态搬到一个不存在的新路径上。
      pendingRename = undefined;
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
      // 改名回响到达：把展开态从旧路径搬到新路径（M258）。必须在处理 deleted 之前做——
      // 级联删除的 pruneExpanded(old) 会清掉旧前缀，而迁到新前缀的条目不受它影响；反过来
      // （先删后迁）展开态就随旧子树一起没了，重命名后的目录在树里会掉一档成折叠态。
      //
      // 判据是「批次里有我登记过的那次改名的 deleted:from」：自己发起 → 磁盘上必定已经改完
      // （登记只在提交后、失败即撤），搬展开态是**解释回响**而不是自绘树补丁（新行走的还是
      // created:to 那条收敛通道）。expanded 是路径键集合，文件改名的迁移是空动作（文件不在
      // 里面），目录改名连子孙前缀一起搬（remapPathAfterRename 的唯一一份前缀逻辑）。
      if (
        pendingRename !== undefined &&
        sorted.some((c) => c.kind === "deleted" && c.path === pendingRename?.from)
      ) {
        const { from, to } = pendingRename;
        pendingRename = undefined;
        for (const path of [...expanded]) {
          const next = remapPathAfterRename(path, from, to);
          if (next === undefined) continue;
          expanded.delete(path);
          expanded.add(next);
        }
      }
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
            pruneLazyFetched(change.path);
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
        // `lazy` 由后端按同一份规则表算出（用户规则命中 ⇒ true），前端**只消费、不重算**
        //（design §4.6：下游重算会引出第二份规则实现）。它决定这一条展开时要不要走按需取数。
        if (existing) {
          existing.entry = {
            ...existing.entry,
            kind: change.entry_kind ?? existing.entry.kind,
            lazy: change.lazy === true,
          };
          existing.lazy = change.lazy === true;
          continue; // 树不展示 size/mtime，modified 无视觉变化
        }
        const node: Node = {
          entry: {
            path: change.path,
            kind: change.entry_kind ?? "file",
            size: 0,
            mtime_ms: null,
            lazy: change.lazy === true,
          },
          children: change.entry_kind === "dir" ? new Map() : null,
          lazy: change.lazy === true,
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
      emptyNotice = notice;
      editing = null;
      pendingRename = undefined;
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
      hint.textContent = t("D5");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ft-open-btn";
      btn.textContent = t("D6");
      btn.addEventListener("click", () => cb.onOpenVault());
      empty.append(hint, btn);
      mount.replaceChildren(empty);
    },
  };

  // 语言切换后重写长驻文本（design §5.2 的不变量）：树头部入口的 title / aria-label 是
  // 装载时写死的，空态（含「正在恢复上次打开的 vault……」）也是整块建出来的——两条都要能
  // 在运行期重跑。`setVault` / `showEmpty` 分别在装载与切空态时覆盖这两个写入点。
  onRelabel(() => {
    if (entryEl !== undefined) {
      entryEl.title = vaultEntryLabel(vaultName);
      entryEl.setAttribute("aria-label", vaultEntryLabel(vaultName));
    }
    if (emptyNotice !== undefined) tree.showEmpty(emptyNotice);
  });

  return tree;
}
