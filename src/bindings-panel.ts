// 键位速查面板（change improve-keybindings-lookup-oct24；前身是 M133 的自用查看器）。
//
// 一份数据，四种读法：知道命令找键（文本查询）、知道键找命令（按键捕获）、浏览学习
// （功能族分组 / 折叠 / 作用域筛选）、排查配置（行详情里的原始 token / 命令 id / 来由）。
//
// 数据源是分发器真正在用的那份表（装配层 applyKeyConfig 里 applyKeyOverrides 的产物），
// 不是 keys.ts 的默认表——配置过 [keys] 之后两者不同（重绑 / 解绑），面板要显示前者。
// 有实现但当前没有键位指向的命令（被解绑的）同样列出一行并标注「未绑定」，并说清成因
// （默认不占键位 / 已被配置解绑）与下一步，否则解绑之后该命令就从视野里消失了。
//
// 单一来源（REVIEW.md「同一语义两处真源」条）：
//   - 行单位是**命令**：一条命令一行，多键合并到该行的键位区（不是一条绑定一行）；
//   - 人类标签 / 别名 → `src/command-meta.ts`；标签文本 → 文案表（`t()`）；
//   - 作用域由 `scopeOfCommand` 派生，面板不读 `binding.scope`（覆盖产出的绑定也是派生的）；
//   - 条件短徽标取 `whenShortKey`、详情全文取 `whenKey`，面板不截断、不另写条件文本；
//   - token → 字形只有 `src/key-glyphs.ts` 一处；
//   - 搜索语料 = 中英标签 + 别名 + 命令 id；维护者来由（`doc` / `docKey`）**只进详情**，
//     不进语料（survey 读数：来由里的「M447」命中 24 条、「删除」误命中 `toc.toggle`）。
//
// 模态边界：面板只挡 editor 作用域的键；global 键照常分发（既有 spec 边界）。捕获等待态是
// 唯一「消费所有键」的状态——被捕获的键 MUST NOT 执行任何命令，Esc 是唯一退出键；`⌃G` 在该
// 状态下被当作待查询的键捕获（否则无法反查 `⌃G`），已捕获态与其余状态 `⌃G` 照常关闭。
//
// 关闭键（Escape / ⌃G）由面板就地消费，不进 KEY_BINDINGS：统一表是「一个 token 一条绑定」，
// 这两个 token 已被 editor 作用域占用（`editor.widget-escape` / `editor.keyboard-quit`），
// 面板打开时它们因作用域与 when 条件都不命中。匹配复用 `keyToken`，不另写一套口径。

import {
  COMMAND_IDS,
  KEYLESS_COMMAND_IDS,
  keyToken,
  normalizeKey,
  scopeOfCommand,
  NON_TAB_GLOBAL_COMMAND_IDS,
  TAB_COMMAND_IDS,
  WIDGET_COMMAND_IDS,
} from "./keys";
import type { CommandId, KeyBinding, KeyScope } from "./keys";
import { t, onRelabel, interpolate } from "./copy";
import type { CopyKey } from "./copy-data";
import { COPY } from "./copy-data";
import { COMMAND_META, SCOPE_DESCRIPTION_KEYS, SCOPE_LABEL_KEYS } from "./command-meta";
import { glyphOfToken } from "./key-glyphs";
import { filterIndices } from "./list-filter";

/** 面板的功能分组：只列命令 id，键位与作用域一律从生效表读。
 *  11 个分组覆盖全部命令（不做文本改写的选择类命令——⌘A 全选、⌃G 撤下选择——归
 *  「移动与选择」，与光标族同属「不动文档的定位/选区命令」）；未列入任何分组的命令自动落到
 *  末尾「其他」——将来新增命令忘记归组时不会从面板里消失。
 *
 *  **导出给单测**：`tests/unit/bindings-panel.test.ts` 用它做三条对账（每条 `COMMAND_IDS`
 *  都有组 ⇒ 零兜底组 / 组里无幻影 id / 分组互斥）。兜底组的存在意味着「漏归组」本身不会
 *  报错，只有别人场景里的分组标题断言会红（M239 实证）；对账放进 unit 层，漏归组在引入它的
 *  那次改动里就红。 */
export const BINDING_GROUPS: ReadonlyArray<{ titleKey: CopyKey; commands: readonly CommandId[] }> = [
  { titleKey: "D64.1", commands: ["editor.cursor-up", "editor.cursor-down", "editor.cursor-forward", "editor.cursor-backward", "editor.line-start", "editor.line-end", "editor.select-all", "editor.keyboard-quit"] },
  { titleKey: "D64.2", commands: ["editor.extend-char-forward", "editor.extend-char-backward", "editor.extend-line-down", "editor.extend-line-up", "editor.extend-line-start", "editor.extend-line-end", "editor.extend-word-forward", "editor.extend-word-backward"] },
  { titleKey: "D64.3", commands: ["editor.delete-char-forward", "editor.delete-char-backward", "editor.transpose-chars", "editor.delete-word-forward", "editor.delete-word-backward"] },
  { titleKey: "D64.4", commands: ["editor.kill-line", "editor.yank"] },
  // M281：跳转到行（change goto-line-command）与 ⌃L 的 recenter 同属「重定位」——它改的是
  // 光标位置与滚动（落点复用 revealLine），与「移动与选择」的逐字符/逐行移动不是一族。
  { titleKey: "D64.5", commands: ["editor.scroll-page-down", "editor.scroll-page-up", "editor.recenter", "editor.goto-line"] },
  { titleKey: "D64.6", commands: ["editor.undo", "editor.redo"] },
  // M239 的两条列表结构命令（Tab / ⇧Tab）单列一组：它们改写的是**列表项的嵌套层级**
  // （连同续行与子树整体平移），与「移动与选择」（只动光标 / 选区）和「删除」都不是一族。
  // 归组去重是面板的硬约束：漏登记的命令会落进末尾的兜底「其他」组，那条兜底是 M133 的
  // 有意设计（新命令不从面板消失），但代价是漏归组只表现为「别处场景红」——M239 就这么
  // 漏过一次（master 视觉门禁红，M240 顺手收）。现在由 tests/unit/bindings-panel.test.ts
  // 的「零兜底组」对账守住。
  { titleKey: "D64.7", commands: ["editor.list-indent", "editor.list-outdent"] },
  // M277：块级复制（change block-copy-affordance）单列一组——它作用的对象是**文档里的一个块**
  // （表格 / 代码块），与光标族、列表族都不是一族。同批的代码块全屏命令（作用域 global）留在
  // 「全局」组：那一组的成员定义就是 NON_TAB_GLOBAL_COMMAND_IDS，挪出来会与它重复渲染
  // （分组互斥是硬约束，见文件头）。
  // M474 把 `editor.focus-block-scroll`（⌃⌥S，焦点送进 caret 所在块的横滚容器）并进同一组：
  // 作用对象同样是「文档里的一个块」，且它与 `block.copy` 是一对——一个把焦点送进块内的
  // 横滚容器、一个复制整块，同属「对块本身的操作」。组标题是「块」（D64.8），加成员不改标题。
  { titleKey: "D64.8", commands: ["block.copy", "editor.focus-block-scroll"] },
  { titleKey: "D64.9", commands: WIDGET_COMMAND_IDS },
  // M149：标签单列一组（而不是并进「全局」）——⌘W 的语义变化与 ⌘1–9 的九条直达是
  // dogfood 期最需要一眼核对的两件事，混在全局组里不容易看全。两组必须**互斥**：
  // 「全局」组用 keys.ts 的 NON_TAB_GLOBAL_COMMAND_IDS，否则同一命令会被两个分组
  // 各渲染一行（面板行数翻倍，「每条命令一行」的口径被破坏）。
  { titleKey: "D64.10", commands: TAB_COMMAND_IDS },
  { titleKey: "D64.11", commands: NON_TAB_GLOBAL_COMMAND_IDS },
];

interface GroupModel {
  titleKey: CopyKey;
  commands: readonly CommandId[];
}

/** 组与组序（BINDING_GROUPS + 兜底「其他」）。组索引是行的分组归属，纯数据、可单测。 */
export function bindingGroups(): readonly GroupModel[] {
  const assigned = new Set<string>();
  for (const group of BINDING_GROUPS) for (const command of group.commands) assigned.add(command);
  const rest = COMMAND_IDS.filter((command) => !assigned.has(command));
  return rest.length === 0 ? BINDING_GROUPS : [...BINDING_GROUPS, { titleKey: "D64.12", commands: rest }];
}

/** 一条命令在面板里的行模型。 */
export interface CommandRowModel {
  command: CommandId;
  groupIndex: number;
  bindings: KeyBinding[];
  scope: KeyScope;
}

/** 生效表按命令归桶（键序 = 生效表里首次出现的顺序；同一命令的多条 token 保持表内顺序）。 */
export function groupBindingsByCommand(bindings: readonly KeyBinding[]): Map<CommandId, KeyBinding[]> {
  const byCommand = new Map<CommandId, KeyBinding[]>();
  for (const binding of bindings) {
    const list = byCommand.get(binding.command);
    if (list === undefined) byCommand.set(binding.command, [binding]);
    else list.push(binding);
  }
  return byCommand;
}

/** 行集：按功能族分组，每条命令恰一行（未绑定命令也在，`bindings` 为空数组）。 */
export function buildCommandRows(bindings: readonly KeyBinding[]): CommandRowModel[] {
  const byCommand = groupBindingsByCommand(bindings);
  const rows: CommandRowModel[] = [];
  bindingGroups().forEach((group, groupIndex) => {
    for (const command of group.commands) {
      rows.push({
        command,
        groupIndex,
        bindings: byCommand.get(command) ?? [],
        scope: scopeOfCommand(command),
      });
    }
  });
  return rows;
}

/** 一条命令的搜索语料：中英两列标签 + 别名 + 命令 id（大小写折叠由 `filterIndices` 做）。
 *  来由 MUST NOT 进这里；面板与文案门禁都守这条。 */
export function commandSearchCorpus(command: CommandId): string {
  const meta = COMMAND_META[command];
  const entry = COPY[meta.labelKey];
  const labels =
    meta.labelParams === undefined
      ? [entry.zh, entry.en]
      : [interpolate(entry.zh, meta.labelKey, meta.labelParams), interpolate(entry.en, meta.labelKey, meta.labelParams)];
  return [...labels, ...(meta.aliases ?? []), command].join(" ").toLowerCase();
}

/** 当前作用域筛选下的命令数（计数分母）。 */
export function scopedRows(rows: readonly CommandRowModel[], scope: "all" | KeyScope): CommandRowModel[] {
  return scope === "all" ? [...rows] : rows.filter((row) => row.scope === scope);
}

export interface FilteredRows {
  rows: CommandRowModel[];
  /** 命中数（查询态）或可见命令数（空查询）。 */
  matched: number;
  /** 当前作用域筛选后的命令数——计数分母 MUST NOT 固定为全量。 */
  total: number;
  /** 有可见行的组数。 */
  groups: number;
}

/** 作用域筛选先于文本查询；匹配复用 `list-filter` 的大小写折叠子串语义（不重排 / 不打分）。 */
export function filterCommandRows(
  rows: readonly CommandRowModel[],
  query: string,
  scope: "all" | KeyScope,
): FilteredRows {
  const scoped = scopedRows(rows, scope);
  const trimmed = query.trim();
  const visible =
    trimmed === ""
      ? scoped
      : filterIndices(
          scoped.map((row) => commandSearchCorpus(row.command)),
          trimmed,
        ).map((index) => scoped[index] as CommandRowModel);
  return {
    rows: visible,
    matched: visible.length,
    total: scoped.length,
    groups: new Set(visible.map((row) => row.groupIndex)).size,
  };
}

/** 捕获结果：归一化后相等的 token → 使用它的命令（一条 token 一条绑定，故至多一条）。 */
export function captureCommandRows(rows: readonly CommandRowModel[], token: string): CommandRowModel[] {
  const normalized = normalizeKey(token);
  return rows.filter((row) => row.bindings.some((binding) => normalizeKey(binding.key) === normalized));
}

export interface BindingsPanelOptions {
  mount: HTMLElement;
  /** 分发器当前在用的那张表（装配层持有；配置重挂后打开面板要读到新表）。 */
  bindings(): readonly KeyBinding[];
  /** 关闭后把焦点交还编辑器（`editor.focusPreservingReadingPosition`，不裸 focus）。 */
  restoreFocus(): void;
}

export interface BindingsPanel {
  /** 打开态再调用即关闭（命令与关闭键共用同一入口）。 */
  toggle(): void;
}

type ScopeFilter = "all" | KeyScope;
type CaptureState = { kind: "idle" } | { kind: "waiting" } | { kind: "captured"; token: string };

const PANEL_INPUT_ID = "lumir-bindings-input";
const PANEL_LIST_ID = "lumir-bindings-list";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function commandSlug(command: CommandId): string {
  return command.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function rowDomId(command: CommandId): string {
  return `lumir-bindings-row-${commandSlug(command)}`;
}

function detailDomId(command: CommandId): string {
  return `lumir-bindings-detail-${commandSlug(command)}`;
}

export function createBindingsPanel(options: BindingsPanelOptions): BindingsPanel {
  const overlay = element("div", "lumir-bindings-overlay");
  overlay.hidden = true;

  const panel = element("div", "lumir-bindings-panel");
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const header = element("div", "lumir-bindings-header");
  const title = element("h2", "lumir-bindings-title");
  const status = element("span", "lumir-bindings-status");
  const count = element("span", "lumir-bindings-count");
  count.setAttribute("aria-live", "polite");
  header.append(title, status, count);

  const search = element("div", "lumir-bindings-search");
  const label = element("label", "lumir-bindings-visually-hidden");
  label.htmlFor = PANEL_INPUT_ID;
  const input = element("input", "lumir-bindings-input");
  input.type = "text";
  input.id = PANEL_INPUT_ID;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", PANEL_LIST_ID);
  input.setAttribute("aria-autocomplete", "list");
  const captureButton = element("button", "lumir-bindings-capture");
  captureButton.type = "button";
  search.append(label, input, captureButton);

  const captureState = element("p", "lumir-bindings-capture-state");
  captureState.hidden = true;
  captureState.setAttribute("aria-live", "polite");

  const scopeGroup = element("div", "lumir-bindings-scope");
  scopeGroup.setAttribute("role", "radiogroup");

  const body = element("div", "lumir-bindings-body");
  body.id = PANEL_LIST_ID;
  body.tabIndex = 0;
  body.setAttribute("role", "listbox");

  const empty = element("div", "lumir-bindings-empty");
  empty.hidden = true;

  const hint = element("p", "lumir-bindings-hint");

  panel.append(header, search, captureState, scopeGroup, body, empty, hint);
  overlay.append(panel);
  options.mount.append(overlay);

  /** 静态文案（长驻 DOM，语言切换后必须重写；`relabel()` 由装配层的 `applyLanguage` 调用）。 */
  function relabel(): void {
    const heading = t("D63");
    panel.setAttribute("aria-label", heading);
    title.textContent = heading;
    status.textContent = t("D693");
    label.textContent = t("D657");
    input.setAttribute("aria-label", t("D657"));
    input.placeholder = capture.kind === "waiting" ? t("D661") : t("D658");
    captureButton.textContent = capture.kind === "waiting" ? t("D660") : t("D659");
    scopeGroup.setAttribute("aria-label", t("D667"));
    body.setAttribute("aria-label", t("D694"));
    hint.textContent = t("D692");
    unboundLabel = t("D65");
    unboundNotices = [t("D66.1"), t("D66.2")];
    relabelStatic();
    for (const button of scopeButtons) {
      button.textContent = button.dataset.scopeLabel === "all" ? t("D668") : scopeLabel(button.dataset.scope as KeyScope);
    }
    if (!overlay.hidden) render();
  }

  let unboundLabel = "";
  let unboundNotices: [string, string] = ["", ""];

  /** 未绑定行的说明（M180，文案 D66）：两种成因**分开**说，并各自指出下一步。 */
  function unboundNotice(command: CommandId): string {
    return KEYLESS_COMMAND_IDS.includes(command) ? unboundNotices[0] : unboundNotices[1];
  }

  function scopeLabel(scope: KeyScope): string {
    return t(SCOPE_LABEL_KEYS[scope]);
  }

  function labelText(command: CommandId): string {
    const meta = COMMAND_META[command];
    return t(meta.labelKey, meta.labelParams);
  }

  // ── 作用域筛选（单选，不是页签；roving tabindex）────────────────────────
  const scopeButtons: HTMLButtonElement[] = [];
  for (const scope of ["all", "global", "editor", "text"] as const) {
    const button = element("button", "lumir-bindings-scope-button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.scope = scope;
    button.dataset.scopeLabel = scope;
    button.addEventListener("click", () => setScope(scope));
    scopeGroup.append(button);
    scopeButtons.push(button);
  }

  // ── 状态（每次打开重置；不持久化，设计 §3.8 / §I5–I7）──────────────────
  let capture: CaptureState = { kind: "idle" };
  let scopeFilter: ScopeFilter = "all";
  let query = "";
  /** 空查询下用户手动折叠的组（设计 §3.4：清查询后恢复这组状态）。 */
  let collapsedByUser = new Set<number>();
  /** 查询 / 捕获态下手动折叠的组：临时状态，下一次查询变化即清空。 */
  let collapsedInFilter = new Set<number>();
  let expanded: CommandId | null = null;
  let activeIndex = -1;
  let composing = false;
  let visibleRows: CommandRowModel[] = [];
  /** 键盘导航空间：折叠组里的行不在其中（活动行 MUST NOT 停在看不见的行上）。 */
  let navRows: CommandRowModel[] = [];
  let rowElements: HTMLElement[] = [];
  /** 组头按钮（按组索引）：折叠后焦点落在组头上，→ 才能把它重新展开。 */
  const groupHeaders = new Map<number, HTMLButtonElement>();

  /** 当前是否处在「过滤结果」态：查询非空或已捕获（两者的折叠是临时的）。 */
  function filterActive(): boolean {
    return query.trim() !== "" || capture.kind === "captured";
  }

  /** 当前生效的折叠集合：过滤态的临时折叠 vs 空查询下的用户折叠。 */
  function currentCollapsed(): Set<number> {
    return filterActive() ? collapsedInFilter : collapsedByUser;
  }

  function isGroupCollapsed(index: number): boolean {
    return currentCollapsed().has(index);
  }

  function setScope(scope: ScopeFilter): void {
    if (capture.kind === "waiting") return; // 等待态只接受「被查询的键」，筛选不参与
    scopeFilter = scope;
    collapsedInFilter = new Set();
    expanded = null;
    render({ resetScroll: true });
  }

  function clearQuery(): void {
    query = "";
    input.value = "";
    // 只清临时折叠；空查询下的用户折叠状态恢复（设计 §3.4）。
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    render({ resetScroll: true });
    input.focus();
  }

  function clearCaptured(): void {
    capture = { kind: "idle" };
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    input.readOnly = false;
    captureButton.setAttribute("aria-pressed", "false");
    relabelStatic();
    render({ resetScroll: true });
    input.focus();
  }

  function enterCapture(): void {
    capture = { kind: "waiting" };
    query = "";
    input.value = "";
    input.readOnly = true;
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    // D6-I7：捕获问的是「这个键归谁」，不应被当前作用域筛选藏掉答案。
    scopeFilter = "all";
    captureButton.setAttribute("aria-pressed", "true");
    relabelStatic();
    captureButton.focus();
    render({ resetScroll: true });
  }

  function cancelCapture(): void {
    capture = { kind: "idle" };
    input.readOnly = false;
    captureButton.setAttribute("aria-pressed", "false");
    relabelStatic();
    render({ resetScroll: true });
    input.focus();
  }

  /** 只重写随捕获态变化的静态文案（标题 / 计数等在 `render()` 里重建）。 */
  function relabelStatic(): void {
    input.placeholder = capture.kind === "waiting" ? t("D661") : t("D658");
    captureButton.textContent = capture.kind === "waiting" ? t("D660") : t("D659");
    captureState.hidden = capture.kind === "idle";
    captureState.replaceChildren();
    if (capture.kind === "waiting") {
      captureState.textContent = t("D661");
      captureState.classList.add("is-waiting");
      captureState.classList.remove("is-captured");
      return;
    }
    captureState.classList.remove("is-waiting");
    if (capture.kind === "captured") {
      captureState.classList.add("is-captured");
      captureState.append(
        element("span", "lumir-bindings-captured-label", t("D662")),
        element("span", "lumir-bindings-captured-glyph", glyphOfToken(capture.token)),
      );
      const clear = element("button", "lumir-bindings-clear", t("D663"));
      clear.type = "button";
      clear.tabIndex = -1;
      clear.addEventListener("click", clearCaptured);
      captureState.append(clear);
    }
  }

  // ── 过滤与渲染 ─────────────────────────────────────────────────────────
  function currentFilter(): FilteredRows {
    const rows = buildCommandRows(options.bindings());
    if (capture.kind === "captured") {
      const captured = captureCommandRows(rows, capture.token);
      return { rows: captured, matched: captured.length, total: captured.length, groups: new Set(captured.map((row) => row.groupIndex)).size };
    }
    return filterCommandRows(rows, query, scopeFilter);
  }

  function updateCount(filtered: FilteredRows): void {
    if (capture.kind === "captured") {
      count.textContent = t("D666", { glyph: glyphOfToken(capture.token), count: filtered.matched });
      return;
    }
    if (query.trim() !== "") {
      count.textContent = t("D665", { count: filtered.matched, total: filtered.total });
      return;
    }
    count.textContent = t("D664", { count: filtered.matched, groups: filtered.groups });
  }

  function appendScopeBadge(container: HTMLElement, scope: KeyScope): void {
    container.append(element("span", "lumir-bindings-scope-badge", scopeLabel(scope)));
  }

  function appendKeyChips(container: HTMLElement, bindings: readonly KeyBinding[]): void {
    if (bindings.length === 0) {
      container.append(element("span", "lumir-bindings-key is-unbound", unboundLabel));
      return;
    }
    for (const binding of bindings) {
      container.append(element("span", "lumir-bindings-key", glyphOfToken(binding.key)));
    }
  }

  function whenShort(bindings: readonly KeyBinding[]): string | null {
    for (const binding of bindings) if (binding.whenShortKey !== undefined) return t(binding.whenShortKey);
    return null;
  }

  function makeRow(row: CommandRowModel): HTMLElement {
    const node = element("div", row.bindings.length === 0 ? "lumir-bindings-row is-unbound" : "lumir-bindings-row");
    node.id = rowDomId(row.command);
    node.dataset.command = row.command;
    node.setAttribute("role", "option");
    node.setAttribute("aria-selected", "false");
    node.setAttribute("aria-controls", detailDomId(row.command));

    node.append(element("span", "lumir-bindings-label", labelText(row.command)));
    const keys = element("span", "lumir-bindings-keys");
    appendKeyChips(keys, row.bindings);
    node.append(keys);

    const meta = element("span", "lumir-bindings-meta");
    appendScopeBadge(meta, row.scope);
    const condition = whenShort(row.bindings);
    if (condition !== null) meta.append(element("span", "lumir-bindings-when", condition));
    node.append(meta);

    node.addEventListener("click", () => toggleDetail(row.command));
    return node;
  }

  function appendDetailRow(container: HTMLElement, row: CommandRowModel): void {
    const meta = COMMAND_META[row.command];
    const entry = COPY[meta.labelKey];
    const detail = element("div", "lumir-bindings-detail");
    detail.id = detailDomId(row.command);
    detail.setAttribute("role", "group");
    detail.setAttribute("aria-label", labelText(row.command));

    detail.append(element("p", "lumir-bindings-detail-labels", `${entry.zh} · ${entry.en}`));

    const list = element("dl", "lumir-bindings-detail-facts");
    const fact = (name: string, value: string): void => {
      list.append(element("dt", undefined, name), element("dd", undefined, value));
    };
    fact(t("D684"), row.command);
    fact(t("D686"), `${scopeLabel(row.scope)} — ${t(SCOPE_DESCRIPTION_KEYS[row.scope])}`);
    const condition = row.bindings.find((binding) => binding.whenKey !== undefined);
    fact(t("D687"), condition === undefined ? t("D690") : t(condition.whenKey as CopyKey));
    fact(t("D685"), row.bindings.length === 0 ? unboundLabel : row.bindings.map((binding) => binding.key).join("  "));
    detail.append(list);

    const rationale = element("div", "lumir-bindings-detail-section");
    rationale.append(element("h4", "lumir-bindings-detail-heading", t("D688")));
    if (row.bindings.length === 0) {
      rationale.append(element("p", "lumir-bindings-detail-text", unboundNotice(row.command)));
    } else {
      for (const binding of row.bindings) {
        const line = element("p", "lumir-bindings-detail-text");
        line.append(
          element("code", "lumir-bindings-detail-token", glyphOfToken(binding.key)),
          document.createTextNode(` ${t(binding.docKey, binding.docParams)}`),
        );
        rationale.append(line);
      }
    }
    detail.append(rationale);

    if (row.bindings.length === 0) {
      const method = element("div", "lumir-bindings-detail-section");
      method.append(element("h4", "lumir-bindings-detail-heading", t("D689")));
      method.append(
        element(
          "p",
          "lumir-bindings-detail-text",
          t("D691", { key: "Cmd-Shift-X", command: row.command }),
        ),
      );
      detail.append(method);
    }

    container.append(detail);
  }

  function makeGroupHeader(titleKey: CopyKey, index: number, rowCount: number): HTMLElement {
    const heading = element("h3", "lumir-bindings-group-heading");
    const button = element("button", "lumir-bindings-group-title");
    button.type = "button";
    button.tabIndex = -1;
    button.dataset.group = String(index);
    const isCollapsed = isGroupCollapsed(index);
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.append(
      element("span", "lumir-bindings-group-name", t(titleKey)),
      element("span", "lumir-bindings-group-count", String(rowCount)),
    );
    button.addEventListener("click", () => {
      const set = currentCollapsed();
      if (set.has(index)) set.delete(index);
      else set.add(index);
      render();
      groupHeaders.get(index)?.focus();
    });
    heading.append(button);
    groupHeaders.set(index, button);
    return heading;
  }

  function renderEmpty(filtered: FilteredRows): void {
    empty.replaceChildren();
    empty.hidden = true;
    if (filtered.rows.length > 0) return;
    empty.hidden = false;
    body.hidden = true;
    const heading = element("p", "lumir-bindings-empty-title");
    const note = element("p", "lumir-bindings-empty-note");
    const actions = element("div", "lumir-bindings-empty-actions");
    if (capture.kind === "captured") {
      heading.textContent = t("D680");
      note.textContent = t("D681");
      const clear = element("button", "lumir-bindings-empty-action", t("D663"));
      clear.type = "button";
      clear.addEventListener("click", clearCaptured);
      actions.append(clear);
    } else if (query.trim() !== "") {
      heading.textContent = t("D677");
      note.textContent = t("D678");
      note.append(element("span", "lumir-bindings-empty-query", query));
      const clear = element("button", "lumir-bindings-empty-action", t("D679"));
      clear.type = "button";
      clear.addEventListener("click", clearQuery);
      const recapture = element("button", "lumir-bindings-empty-action", t("D659"));
      recapture.type = "button";
      recapture.addEventListener("click", enterCapture);
      actions.append(clear, recapture);
    } else {
      heading.textContent = t("D682");
      note.textContent = t("D683");
      const all = element("button", "lumir-bindings-empty-action", t("D668"));
      all.type = "button";
      all.addEventListener("click", () => setScope("all"));
      actions.append(all);
    }
    empty.append(heading, note, actions);
  }

  function render(options: { resetScroll?: boolean } = {}): void {
    const filtered = currentFilter();
    visibleRows = filtered.rows;
    const previousTop = body.scrollTop;
    if (!visibleRows.some((row) => row.command === expanded)) expanded = null;

    body.replaceChildren();
    body.hidden = false;
    groupHeaders.clear();
    navRows = [];
    rowElements = [];
    const groups = bindingGroups();
    const byGroup = new Map<number, CommandRowModel[]>();
    for (const row of visibleRows) {
      const list = byGroup.get(row.groupIndex);
      if (list === undefined) byGroup.set(row.groupIndex, [row]);
      else list.push(row);
    }
    for (const [groupIndex, groupRows] of byGroup) {
      const section = element("section", "lumir-bindings-group");
      const titleKey = (groups[groupIndex] as GroupModel).titleKey;
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", t(titleKey));
      section.append(makeGroupHeader(titleKey, groupIndex, groupRows.length));
      const collapsedNow = isGroupCollapsed(groupIndex);
      for (const row of groupRows) {
        const node = makeRow(row);
        section.append(node);
        if (collapsedNow) {
          node.hidden = true;
        } else {
          navRows.push(row);
          rowElements.push(node);
        }
        if (expanded === row.command && !collapsedNow) appendDetailRow(section, row);
      }
      body.append(section);
    }
    if (activeIndex >= navRows.length) activeIndex = navRows.length === 0 ? -1 : navRows.length - 1;
    if (activeIndex < 0 && navRows.length > 0 && query.trim() === "" && capture.kind === "idle") activeIndex = 0;

    updateCount(filtered);
    renderEmpty(filtered);
    updateScopeButtons();
    updateActive();
    body.scrollTop = options.resetScroll === true ? 0 : previousTop;
  }

  function updateScopeButtons(): void {
    for (const button of scopeButtons) {
      const selected = (button.dataset.scope as ScopeFilter) === scopeFilter;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle("is-selected", selected);
    }
  }

  function updateActive(): void {
    for (let index = 0; index < rowElements.length; index += 1) {
      const node = rowElements[index] as HTMLElement;
      const active = index === activeIndex;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
    }
    const active = rowElements[activeIndex];
    if (active === undefined) {
      input.removeAttribute("aria-activedescendant");
      body.removeAttribute("aria-activedescendant");
      return;
    }
    input.setAttribute("aria-activedescendant", active.id);
    body.setAttribute("aria-activedescendant", active.id);
    if (document.activeElement === body) active.scrollIntoView({ block: "nearest" });
  }

  function moveActive(delta: number): void {
    if (navRows.length === 0) return;
    if (activeIndex < 0) activeIndex = delta > 0 ? 0 : navRows.length - 1;
    else activeIndex = Math.max(0, Math.min(navRows.length - 1, activeIndex + delta));
    updateActive();
    if (document.activeElement === input || document.activeElement === body) {
      rowElements[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }

  function toggleDetail(command: CommandId): void {
    expanded = expanded === command ? null : command;
    render();
  }

  function scrollPage(direction: 1 | -1): void {
    body.scrollTop += direction * body.clientHeight * 0.88;
  }

  // ── 焦点循环（Tab 四停；空态动作钮可见时追加在末尾）─────────────────────
  function focusStops(): HTMLElement[] {
    const stops: HTMLElement[] = [input, captureButton];
    const selectedScope = scopeButtons.find((button) => button.tabIndex === 0);
    if (selectedScope !== undefined) stops.push(selectedScope);
    // 空态时列表被隐藏（body.hidden），它不再是可聚焦停靠点——否则 Tab 会停在隐藏节点上，
    // 焦点看起来「卡住」。
    if (!body.hidden && navRows.length > 0) stops.push(body);
    if (!empty.hidden) {
      for (const button of empty.querySelectorAll<HTMLElement>(".lumir-bindings-empty-action")) stops.push(button);
    }
    return stops;
  }

  function moveFocus(backward: boolean): void {
    const stops = focusStops();
    if (stops.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    const index = current === null ? -1 : stops.indexOf(current);
    const next = index < 0 ? 0 : (index + (backward ? -1 : 1) + stops.length) % stops.length;
    stops[next]?.focus();
  }

  function isScopeFocus(): boolean {
    const current = document.activeElement;
    return current instanceof HTMLElement && scopeGroup.contains(current);
  }

  function moveScope(delta: number): void {
    const order: ScopeFilter[] = ["all", "global", "editor", "text"];
    const current = order.indexOf(scopeFilter);
    const next = Math.max(0, Math.min(order.length - 1, current + delta));
    setScope(order[next] as ScopeFilter);
    scopeButtons[next]?.focus();
  }

  // ── 键盘模型（design §3.7）─────────────────────────────────────────────
  function handleCaptureKey(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return; // 纯修饰键不构成一次捕获
    event.preventDefault();
    event.stopPropagation();
    if (token === "Escape") {
      cancelCapture();
      return;
    }
    // 等待态是唯一「消费所有键」的状态：⌃G / ⌘/ / Tab 都被当作待查询的键捕获，
    // 不执行任何命令（否则 ⌃G 永远无法反查）。
    capture = { kind: "captured", token };
    query = "";
    input.value = "";
    input.readOnly = false;
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = 0;
    captureButton.setAttribute("aria-pressed", "false");
    relabelStatic();
    render({ resetScroll: true });
    input.focus();
  }

  overlay.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (capture.kind === "waiting") {
      handleCaptureKey(event);
      return;
    }
    const token = keyToken(event);
    if (token === null) return;

    if (token === "Escape") {
      event.preventDefault();
      if (capture.kind === "captured") clearCaptured();
      else if (query !== "") clearQuery();
      else toggle();
      return;
    }
    if (token === "Ctrl-G") {
      event.preventDefault();
      toggle();
      return;
    }
    if (token === "Tab" || token === "Shift-Tab") {
      event.preventDefault();
      moveFocus(token === "Shift-Tab");
      return;
    }

    const inInput = event.target === input;
    const inBody = event.target === body;
    const headerButton = event.target instanceof HTMLElement && event.target.classList.contains("lumir-bindings-group-title")
      ? event.target
      : null;
    if (headerButton !== null) {
      // 折叠后焦点落在组头上：→ / Enter / Space 重新展开，← 收起，↑↓ 回到列表。
      const index = Number(headerButton.dataset.group);
      if (token === "ArrowRight" || token === "Enter" || token === "Space") {
        event.preventDefault();
        currentCollapsed().delete(index);
        render();
        groupHeaders.get(index)?.focus();
        return;
      }
      if (token === "ArrowLeft") {
        event.preventDefault();
        currentCollapsed().add(index);
        render();
        groupHeaders.get(index)?.focus();
        return;
      }
      if (token === "ArrowDown" || token === "ArrowUp") {
        event.preventDefault();
        body.focus();
        activeIndex = token === "ArrowDown" ? 0 : navRows.length - 1;
        updateActive();
        return;
      }
    }
    if (isScopeFocus()) {
      if (token === "ArrowLeft" || token === "ArrowUp" || token === "Ctrl-P") {
        event.preventDefault();
        moveScope(-1);
        return;
      }
      if (token === "ArrowRight" || token === "ArrowDown" || token === "Ctrl-N") {
        event.preventDefault();
        moveScope(1);
        return;
      }
      if (token === "Home") {
        event.preventDefault();
        setScope("all");
        scopeButtons[0]?.focus();
        return;
      }
      if (token === "End") {
        event.preventDefault();
        setScope("text");
        scopeButtons[3]?.focus();
        return;
      }
    }

    if (token === "ArrowDown" || token === "Ctrl-N") {
      if (inInput || inBody || isScopeFocus()) {
        event.preventDefault();
        moveActive(1);
      }
      return;
    }
    if (token === "ArrowUp" || token === "Ctrl-P") {
      if (inInput || inBody || isScopeFocus()) {
        event.preventDefault();
        moveActive(-1);
      }
      return;
    }
    if (token === "Enter") {
      if (inInput || inBody) {
        event.preventDefault();
        if (activeIndex < 0 && navRows.length > 0) activeIndex = 0;
        const row = navRows[activeIndex];
        if (row !== undefined) toggleDetail(row.command);
      }
      return;
    }
    if (token === "Space") {
      if (inBody) {
        event.preventDefault();
        const row = navRows[activeIndex];
        if (row !== undefined) toggleDetail(row.command);
      }
      return;
    }
    if (token === "PageDown" || token === "PageUp") {
      if (inInput || inBody) {
        event.preventDefault();
        scrollPage(token === "PageDown" ? 1 : -1);
      }
      return;
    }
    if (inBody && token === "Home") {
      event.preventDefault();
      activeIndex = navRows.length === 0 ? -1 : 0;
      updateActive();
      return;
    }
    if (inBody && token === "End") {
      event.preventDefault();
      activeIndex = navRows.length === 0 ? -1 : navRows.length - 1;
      updateActive();
      return;
    }
    if (inBody && token === "ArrowLeft") {
      event.preventDefault();
      const row = navRows[activeIndex];
      if (row !== undefined) {
        currentCollapsed().add(row.groupIndex);
        activeIndex = -1;
        render();
        groupHeaders.get(row.groupIndex)?.focus();
      }
      return;
    }
    if (inBody && token === "ArrowRight") {
      event.preventDefault();
      const row = navRows[activeIndex];
      if (row !== undefined) {
        currentCollapsed().delete(row.groupIndex);
        render();
      }
    }
  });

  input.addEventListener("input", () => {
    if (composing || capture.kind === "waiting") return;
    query = input.value;
    if (capture.kind === "captured") {
      capture = { kind: "idle" };
      captureButton.setAttribute("aria-pressed", "false");
      relabelStatic();
    }
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    render({ resetScroll: true });
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    query = input.value;
    if (capture.kind === "captured") capture = { kind: "idle" };
    relabelStatic();
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    render({ resetScroll: true });
  });

  captureButton.addEventListener("click", () => {
    if (capture.kind === "waiting") cancelCapture();
    else enterCapture();
  });

  // 点击遮罩关闭；点在面板本身上不关（面板内要能选中文本）。
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) toggle();
  });

  function resetState(): void {
    capture = { kind: "idle" };
    scopeFilter = "all";
    query = "";
    input.value = "";
    input.readOnly = false;
    captureButton.setAttribute("aria-pressed", "false");
    collapsedByUser = new Set();
    collapsedInFilter = new Set();
    expanded = null;
    activeIndex = -1;
    composing = false;
  }

  function close(): void {
    overlay.hidden = true;
    resetState();
    relabelStatic();
    options.restoreFocus();
  }

  function toggle(): void {
    if (!overlay.hidden) {
      close();
      return;
    }
    resetState();
    relabel(); // 每次打开重读生效表（配置重挂后不留旧表）
    overlay.hidden = false;
    render({ resetScroll: true });
    input.focus();
  }

  relabel();
  onRelabel(relabel);

  return { toggle };
}
