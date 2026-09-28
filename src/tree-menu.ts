// 文件树条目的右键菜单（M244，change file-tree-context-menu；裁决点 1 = web 自绘浮层）。
//
// 形态与口径：复用 vault-switcher 浮层那一套——`role=menu` / 项级 `role=menuitem`、
// ↑↓ 与 ⌃N⌃P 等价导航、Enter 触发、Esc 或外部点击关闭、打开即持焦点、关闭把焦点归还
// 触发它的那一行（锚点由树给定）。就地消费按键、**不进** keys.ts 的统一表：那张表的
// 不变量是「一个 token 一条绑定」，而 ↑↓ / ⌃N⌃P / Enter / Esc 已分别归 editor.cursor-*
// 与 editor.widget-escape；浮层持焦点时 editor 作用域因「事件目标不在 contentDOM 内」
// 不命中，就地消费 + preventDefault 让 window 上的分发器让路（与大纲浮层 / vault 浮层 /
// 键位面板同一套口径）。
//
// 模块边界（谁在哪）：
//   - 菜单与**菜单触发的确认对话框**在这里（两者都是菜单动作的界面形态：删除必须两步，
//     design §3.1）；菜单项的**动作**由装配层决定——本模块只发
//     `onSelect(action, target)` 请求，不 import ipc.ts（纯逻辑单测因此不必把 Tauri 运行时
//     拖进来，与 vault-switcher 同纪律）。
//   - 「右键不改上下文」（design §2.1）也落在这一层：本模块不碰 currentPath / tab，
//     打开与关闭都不触发任何打开动作。
//
// 本模块另外持有**改名回响抑制**（design §3.2）：菜单发起的重命名要吞掉 watcher 回来的
// 归因误报，判定做成无 DOM 的纯逻辑，便于单测。

import { keyToken } from "./keys";

// ---------------------------------------------------------------------------
// 文案（编号见 文案-Copy.md 的 D125 起；本模块是它们唯一一份字面量）
// ---------------------------------------------------------------------------

/** 「这一行是当前菜单的作用行」的在场标记（M251）：由本模块在 `open` / `close` 装卸——菜单开着
 *  的唯一真源就在这里，别处（装配层 / 树）MUST NOT 各判一次（REVIEW.md 第 8 条）。
 *
 *  语义与样式落在两处，逐条记明：`src/style.css` 的 `.ft-row.is-menu-target`（取选中档 `--sel`、
 *  不加 550 字重，强度低于 `.is-current`，并压过 `:hover`）；断言在
 *  `tests/visual/scenes/tree-menu.spec.ts`。**不复用 `is-current`**：后者的语义是「当前打开的
 *  文档」，由装配层随标签切换写（`src/main.ts` 的 `syncActiveDocument`），而右键不改上下文
 *  （design §2.1）——两个语义混用一个类会让「哪一行是打开的」失去信号。
 *  也不用 `--hover`：菜单在指针位置弹出，指针下的那一行本来就是 hover 态，用 hover 色等于没有反馈。 */
import { t } from "./copy";

export const MENU_TARGET_CLASS = "is-menu-target";

/** 浮层的读屏名（`role=menu` 的 aria-label）。**函数**：菜单在打开时构建，语言切换后
 *  新开的菜单自然是新语言（M282 起文案一律经 `t()` 取值，常量因此改成函数）。 */
export const MENU_LABEL = (): string => t("D125");
/** 文件 / 目录行的菜单项（§2.2 的项集定义）：破坏性项固定尾部、以分隔线隔开。 */
export const RENAME_LABEL = (): string => t("D126");
export const COPY_PATH_LABEL = (): string => t("D127");
export const REVEAL_LABEL = (): string => t("D128");
export const NEW_FILE_LABEL = (): string => t("D129");
export const NEW_DIR_LABEL = (): string => t("D130");
export const TRASH_LABEL = (): string => t("D131");
/** 删除确认对话框：目录那一档必须明示「连同其中全部内容」（裁决点 2 的护栏）。 */
export const TRASH_CONFIRM_TITLE = (): string => t("D132");
export const TRASH_CONFIRM_FILE_BODY = (name: string): string => t("D133", { name });
export const TRASH_CONFIRM_DIR_BODY = (name: string): string => t("D134", { name });
export const TRASH_CONFIRM_OK = (): string => t("D135");
export const DIALOG_CANCEL = (): string => t("D136");
/** 「复制完整路径」的两条反馈（成功 / 失败）。 */
export const COPIED_PATH_TOAST = (): string => t("D137");
export const COPY_PATH_FAILED_TOAST = (reason: string): string => t("D138", { reason });

export type TreeMenuAction =
  | "rename"
  | "copy-path"
  | "reveal"
  | "new-file"
  | "new-dir"
  | "trash";

export interface TreeMenuItem {
  action: TreeMenuAction;
  label: string;
}

/** 触发菜单的条目：`anchor` 是那一行的行元素（关闭后焦点归还它）。 */
export interface TreeMenuTarget {
  path: string;
  kind: "file" | "dir";
  name: string;
  anchor: HTMLElement;
}

interface Row {
  kind: "item";
  item: TreeMenuItem;
}

/** 分隔线不是可导航项（键盘游标只在项上走，与 vault 浮层的「新增 vault…」分段同形）。 */
const SEPARATOR = "separator";

/**
 * 项集按条目类型分流（spec：文件行不含新建项；目录行在文件项集基础上多出两条）。
 * 顺序固定：目录专属项 → 分隔 → 通用项 → 分隔 → 破坏性项（design §2.2 的「破坏性项
 * 固定尾部 + 分隔线」）。这是**唯一一份**项集定义（菜单渲染、单测、验收断言三处同源）。
 */
export function menuItemsFor(kind: "file" | "dir"): (Row | typeof SEPARATOR)[] {
  const common: Row[] = [
    { kind: "item", item: { action: "rename", label: RENAME_LABEL() } },
    { kind: "item", item: { action: "copy-path", label: COPY_PATH_LABEL() } },
    { kind: "item", item: { action: "reveal", label: REVEAL_LABEL() } },
  ];
  const rows: (Row | typeof SEPARATOR)[] =
    kind === "dir"
      ? [
          { kind: "item", item: { action: "new-file", label: NEW_FILE_LABEL() } },
          { kind: "item", item: { action: "new-dir", label: NEW_DIR_LABEL() } },
          SEPARATOR,
          ...common,
        ]
      : common;
  return [...rows, SEPARATOR, { kind: "item", item: { action: "trash", label: TRASH_LABEL() } }];
}

/** 项集里的动作清单（去掉分隔线）；断言与调用方按这个顺序对账。 */
export function menuActionsFor(kind: "file" | "dir"): TreeMenuAction[] {
  const actions: TreeMenuAction[] = [];
  for (const row of menuItemsFor(kind)) {
    if (row !== SEPARATOR) actions.push(row.item.action);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// 右键菜单浮层
// ---------------------------------------------------------------------------

export interface TreeContextMenuDeps {
  /** 浮层挂点：取 app-shell 根——左栏容器都 overflow:auto，挂进去会被裁掉
   *（与 vault 浮层同一条理由）。 */
  mount: HTMLElement;
  onSelect(action: TreeMenuAction, target: TreeMenuTarget): void;
}

export interface TreeContextMenuHandle {
  open(target: TreeMenuTarget, at: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  /** 菜单元素（断言口；内容随每次打开重建）。 */
  element(): HTMLElement;
}

const ITEM_ID_PREFIX = "ft-menu-item-";

class TreeContextMenu implements TreeContextMenuHandle {
  private readonly deps: TreeContextMenuDeps;
  private readonly menu: HTMLDivElement;
  private items: HTMLButtonElement[] = [];
  private actions: TreeMenuAction[] = [];
  private activeIndex = -1;
  private target: TreeMenuTarget | undefined;
  private open_ = false;

  constructor(deps: TreeContextMenuDeps) {
    this.deps = deps;
    const menu = document.createElement("div");
    menu.className = "ft-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", MENU_LABEL());
    menu.tabIndex = -1;
    menu.addEventListener("keydown", (event) => this.onKeydown(event));
    // 菜单内的项不夺焦点（与 vault 浮层的行同一手法）：mousedown 一旦夺焦，随后的 click
    // 落在已 hidden 的菜单上，那一项就永远不会执行——点击路径必须活到 click。
    menu.addEventListener("mousedown", (event) => event.preventDefault());
    document.addEventListener("mousedown", (event) => {
      if (!this.open_) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menu.contains(target)) return;
      this.close(false);
    });
    deps.mount.append(menu);
    this.menu = menu;
  }

  open(target: TreeMenuTarget, at: { x: number; y: number }): void {
    // 上一个作用行的标记先撤：菜单从 A 行换到 B 行时，A 行 MUST NOT 留着高亮（它已经不再是
    // 作用行了）。同一行重复打开时这句是空动作。
    this.target?.anchor.classList.remove(MENU_TARGET_CLASS);
    this.target = target;
    target.anchor.classList.add(MENU_TARGET_CLASS);
    this.render(target.kind);
    this.open_ = true;
    this.menu.hidden = false;
    // 先落到原点再量尺寸：菜单在别处量到的 offsetWidth 取决于上一次打开的内容。
    this.menu.style.left = "0px";
    this.menu.style.top = "0px";
    this.place(at.x, at.y);
    this.setActive(0);
    // 焦点落到容器（不是项）：键盘游标经 aria-activedescendant 表达，与浮层同形。
    this.menu.focus();
  }

  close(restoreFocus = true): void {
    if (!this.open_) return;
    this.open_ = false;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    this.items = [];
    this.actions = [];
    this.activeIndex = -1;
    const anchor = this.target?.anchor;
    // 作用行高亮随菜单一起离场（M251）：两条关闭路径（Esc / 选外部点击）都在这里收口，
    // 因此标记的在场期严格等于「菜单开着」。锚点行已被 watcher 收敛掉时这是空动作。
    anchor?.classList.remove(MENU_TARGET_CLASS);
    this.target = undefined;
    if (!restoreFocus) return;
    // 焦点归还触发它的那一行（spec：关闭后焦点归还文件树）。行已被 watcher 收敛掉时
    // focus() 是空动作，不硬塞（也不抛错）。
    anchor?.focus();
  }

  isOpen(): boolean {
    return this.open_;
  }

  element(): HTMLElement {
    return this.menu;
  }

  private render(kind: "file" | "dir"): void {
    this.items = [];
    this.actions = [];
    const children: HTMLElement[] = [];
    for (const row of menuItemsFor(kind)) {
      if (row === SEPARATOR) {
        const separator = document.createElement("div");
        separator.className = "ft-menu-sep";
        separator.setAttribute("role", "separator");
        children.push(separator);
        continue;
      }
      const index = this.items.length;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "ft-menu-item";
      item.setAttribute("role", "menuitem");
      item.id = `${ITEM_ID_PREFIX}${index}`;
      item.tabIndex = -1;
      item.textContent = row.item.label;
      if (row.item.action === "trash") item.classList.add("is-danger");
      item.addEventListener("click", () => this.activate(index));
      this.items.push(item);
      this.actions.push(row.item.action);
      children.push(item);
    }
    this.menu.replaceChildren(...children);
  }

  /**
   * 把菜单放到指针位置（`clientX/clientY`，视口坐标），并按挂点边界翻转：
   * 右端不越出挂点，下方空间不够就整块翻到指针上方（与浮层的 place 同一手法，
   * 差别只在这里的锚点是指针而不是元素）。
   */
  private place(x: number, y: number): void {
    const host = this.deps.mount.getBoundingClientRect();
    const width = this.menu.offsetWidth;
    const height = this.menu.offsetHeight;
    const localX = x - host.left;
    const localY = y - host.top;
    const maxLeft = Math.max(0, host.width - width - 8);
    const left = Math.min(Math.max(localX, 0), maxLeft);
    const top = localY + height <= host.height ? Math.max(localY, 0) : Math.max(0, localY - height);
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${top}px`;
  }

  private setActive(index: number): void {
    const previous = this.items[this.activeIndex];
    if (previous) previous.classList.remove("is-active");
    this.activeIndex = index;
    const item = this.items[index];
    if (!item) {
      this.menu.removeAttribute("aria-activedescendant");
      return;
    }
    item.classList.add("is-active");
    this.menu.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    const next = Math.min(this.items.length - 1, Math.max(0, this.activeIndex + delta));
    if (next !== this.activeIndex) this.setActive(next);
  }

  private activate(index: number): void {
    const action = this.actions[index];
    const target = this.target;
    if (action === undefined || target === undefined) return;
    // 先收起再发请求：动作会开内联编辑 / 确认框，菜单必须已经不在场（同一行上两个
    // 浮层会让点击路径互相遮蔽）。close 会把 target 清掉，所以先把请求值取出来。
    this.close(true);
    this.deps.onSelect(action, target);
  }

  private onKeydown(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      // ⌃N / ⌃P 与 ↑↓ 完全等价（同一落点、同一钳制），共用 move()——菜单里 MUST NOT
      // 有第二套下标逻辑（与 vault 浮层、大纲浮层同口径）。
      case "ArrowDown":
      case "Ctrl-N":
        this.move(1);
        break;
      case "ArrowUp":
      case "Ctrl-P":
        this.move(-1);
        break;
      case "Enter":
        this.activate(this.activeIndex);
        break;
      case "Escape":
        this.close();
        break;
      default:
        return; // 其余键不消费：菜单不是模态，Tab 等照常走原生焦点路径
    }
    event.preventDefault();
  }
}

export function createTreeContextMenu(deps: TreeContextMenuDeps): TreeContextMenuHandle {
  return new TreeContextMenu(deps);
}

// ---------------------------------------------------------------------------
// 删除确认对话框（design §3.1：删除必须两步 + 可恢复）
// ---------------------------------------------------------------------------

export interface ConfirmDialogRequest {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface ConfirmDialogDeps {
  mount: HTMLElement;
  onConfirm(): void;
  /** 关闭（确认或取消）后焦点归还：由装配层交回树里的那一行 / 编辑器。 */
  restoreFocus(): void;
}

export interface ConfirmDialogHandle {
  open(request: ConfirmDialogRequest): void;
  close(): void;
  isOpen(): boolean;
  element(): HTMLElement;
}

class ConfirmDialog implements ConfirmDialogHandle {
  private readonly deps: ConfirmDialogDeps;
  private readonly overlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly bodyEl: HTMLParagraphElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  constructor(deps: ConfirmDialogDeps) {
    this.deps = deps;
    const overlay = document.createElement("div");
    overlay.className = "ft-confirm-overlay";
    overlay.hidden = true;
    const panel = document.createElement("div");
    panel.className = "ft-confirm";
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const title = document.createElement("h2");
    title.className = "ft-confirm-title";
    const body = document.createElement("p");
    body.className = "ft-confirm-body";
    const actions = document.createElement("div");
    actions.className = "ft-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ft-confirm-cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "ft-confirm-ok is-danger";
    actions.append(cancel, confirm);
    panel.append(title, body, actions);
    overlay.append(panel);
    deps.mount.append(overlay);

    // 点遮罩取消；点在面板本身上不关（面板内要能选中文本）。
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) this.dismiss();
    });
    cancel.addEventListener("click", () => this.dismiss());
    confirm.addEventListener("click", () => {
      // 确认路径也先把焦点还回去再发请求：对话框必须已经不在场（后端调用失败时
      // 提示落在 toast / 树上，不该被一个已经关闭的模态挡住）。
      this.close();
      deps.onConfirm();
    });
    overlay.addEventListener("keydown", (event) => {
      const token = keyToken(event);
      if (token === null) return;
      if (token === "Tab" || token === "Shift-Tab") {
        // 焦点陷阱（同键位面板）：模态里 Tab 不得跑到背后的界面上。
        event.preventDefault();
        return;
      }
      if (token !== "Escape") return;
      event.preventDefault();
      this.dismiss();
    });

    this.overlay = overlay;
    this.panel = panel;
    this.titleEl = title;
    this.bodyEl = body;
    this.confirmBtn = confirm;
    this.cancelBtn = cancel;
  }

  open(request: ConfirmDialogRequest): void {
    this.titleEl.textContent = request.title;
    this.bodyEl.textContent = request.body;
    this.confirmBtn.textContent = request.confirmLabel;
    this.cancelBtn.textContent = request.cancelLabel;
    this.overlay.hidden = false;
    // 初始焦点给「取消」：破坏性动作的默认落点必须是安全的那一个（回车不会误删）。
    this.cancelBtn.focus();
  }

  close(): void {
    if (this.overlay.hidden) return;
    this.overlay.hidden = true;
    this.deps.restoreFocus();
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  element(): HTMLElement {
    return this.panel;
  }

  private dismiss(): void {
    this.close();
  }
}

export function createConfirmDialog(deps: ConfirmDialogDeps): ConfirmDialogHandle {
  return new ConfirmDialog(deps);
}

// ---------------------------------------------------------------------------
// 改名回响抑制（design §3.2 的一次性归因抑制）
// ---------------------------------------------------------------------------

export interface RenameEchoGuard {
  /**
   * 在 **invoke 发起时**登记 `from → to`（不是成功返回后——in-flight 窗口内到达的真实
   * 外部事件必须照常归因，回滚消除乱序窗口）。返回值是撤销函数：invoke 失败即调用它，
   * 「这行改动从未发生」。
   */
  register(from: string, to: string): () => void;
  /**
   * 消费一整批 watcher 事件：返回**属于已登记改名回响的路径集合**（调用方据此在会话链路
   * 上跳过处置；树 / 附件索引 / 链接索引照常收敛）。喂进来的是整批路径而不是「命中会话的
   * 那一条」——watcher 把一次改名拆成 `deleted:from` + `created:to`，remap 之后
   * `from` 匹配不到任何会话，只有整批喂才能把「两个方向都出现过」这个消费判据凑齐。
   */
  consume(paths: readonly string[]): Set<string>;
  /** 每批处理完后调用：清掉两个方向都出现过的、以及超时的条目（MUST NOT 常驻）。 */
  settle(): void;
  /** 仍生效的登记条目数（断言口）。 */
  pending(): number;
}

interface PendingEcho {
  from: string;
  to: string;
  deadline: number;
  sawFrom: boolean;
  sawTo: boolean;
}

/** 抑制窗口（ms）：一个 watcher debounce 窗口（100ms）+ FSEvents 注册延迟的余量。 */
export const RENAME_ECHO_TIMEOUT_MS = 1000;

function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function createRenameEchoGuard(
  options: { timeoutMs?: number; now?: () => number } = {},
): RenameEchoGuard {
  const timeoutMs = options.timeoutMs ?? RENAME_ECHO_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let pairs: PendingEcho[] = [];

  const prune = (): void => {
    const at = now();
    pairs = pairs.filter((pair) => pair.deadline > at);
  };

  return {
    register(from, to) {
      const pair: PendingEcho = {
        from,
        to,
        deadline: now() + timeoutMs,
        sawFrom: false,
        sawTo: false,
      };
      pairs.push(pair);
      return () => {
        pairs = pairs.filter((candidate) => candidate !== pair);
      };
    },
    consume(paths) {
      prune();
      const skipped = new Set<string>();
      for (const path of paths) {
        for (const pair of pairs) {
          // 两侧都要吞：remap 之后 session.path 已经是 `to`，`deleted:from` 匹配不到任何
          // session（防了不可能发生的事件），真正会误报的是命中 dirty session 的
          // `created:to`（走「检测到外部修改」分支）。子树前缀一并覆盖（目录改名）。
          if (within(path, pair.from)) {
            pair.sawFrom = true;
            skipped.add(path);
            break;
          }
          if (within(path, pair.to)) {
            pair.sawTo = true;
            skipped.add(path);
            break;
          }
        }
      }
      return skipped;
    },
    settle() {
      pairs = pairs.filter((pair) => !(pair.sawFrom && pair.sawTo));
      prune();
    },
    pending() {
      prune();
      return pairs.length;
    },
  };
}
