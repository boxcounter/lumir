// 按路径快速打开文件（change quick-open-file-oct23；Emacs `C-x C-f` 形态）。
//
// 分层与本仓既有同族模块一致（`src/goto-line.ts` / `src/toc.ts`）：
//   - **纯函数层**（零 DOM / 零 IPC）：输入解析 [`quickOpenAttempts`]、行号后缀
//     [`splitLineSuffix`]、vault 内存在性裁决 [`lookupVaultPath`]——`tests/unit/quick-open.test.ts`
//     直接驱动 design §2.4 的解析表；
//   - **DOM 适配层**：[`createQuickOpen`] 的浮层、就地键与异步打开编排；打开动作、存在探测与
//     提示出口全部由装配层经 deps 注入（本模块不持第二份打开链路）。
//
// 形态复用 `.lumir-toc` 的**几何**（design §8：挂 `shell.modeline`、`bottom: 100%` 向上展开、
// 列表是唯一滚动容器、下划线输入框；MUST NOT 新增色值 / 字号 / 圆角 token）——`src/style.css`
// 的浮层规则写成**选择器列表**（`.lumir-toc, .lumir-qo { … }`，同一份几何两个名字），本模块
// 只用 `.lumir-qo*` 这一组 class。为什么不是「直接借 `.lumir-toc` 的 class」：那会让既有场景
// 与消费者的 `.lumir-toc` 选择器同时命中两个浮层（strict-mode 撞车），也会让两块浮层的语义
// 混成一个。**也不复制一份 CSS**：复制几何就是 REVIEW.md「同一语义两处真源」条的下一次现场。
//
// 三条硬口径（spec `quick-open`）：
//   1. **整串优先**：输入串先整体当路径试，不成立才剥尾部行号后缀（D5）。文件名里可以有冒号
//      （`v1:2.md`）——正则优先会把这类文件永久锁死，失败形态是「看起来正常、个别文件找不到」；
//   2. **后缀语义复用**：`:行` / `:行:列` / `:起-止` 的解析经 `harness-path-link.ts` 导出的
//      `lineSuffixAt`（MUST NOT 复制 `LINE_SUFFIX`，与 M632 的落点口径逐字一致）；
//   3. **vault 外绝对路径走同一次序**（归一化阶段 MUST NOT 提前分流）：命中后按只读会话打开，
//      解析次序与 vault 内完全同构。
import { NO_MATCH_TEXT, filterIndices, foldCase } from "./list-filter";
import { keyToken } from "./keys";
import { t, tPlural } from "./copy";
import { lineSuffixAt } from "./harness-path-link";

/** 候选渲染上限（design §3）：DOM 成本闸，不影响匹配结果本身。 */
export const CANDIDATE_LIMIT = 100;

// ---------------------------------------------------------------------------
// 纯函数：输入解析
// ---------------------------------------------------------------------------

/** 一次解析的「存在性候选」：路径 + 该级要落到的行（仅剥后缀那一级有）+ 是否 vault 外。 */
export interface QuickOpenAttempt {
  /** vault 相对路径（vault 内）或绝对路径（vault 外）。 */
  path: string;
  /** 1-based 起始行；`{path}:{行}` 剥出来的落点（`:起-止` 取 `起`）。 */
  line?: number;
  /** false = 走 vault 内打开链路；true = 走 vault 外只读通道。 */
  external: boolean;
}

/** 输入解析的结果：无输入 / 候选阶梯 + 候选列表的查询串。 */
export type QuickOpenPlan =
  | { kind: "empty" }
  | { kind: "ok"; attempts: QuickOpenAttempt[]; query: string };

/**
 * 归一化一条输入串（design §2.3；MUST NOT 在这里把 vault 外路径分流掉——那会让
 * `/tmp/x/notes.md:12` 的行号没人处理）。
 *
 * 次序：`trim` → 反斜杠拒绝 → 绝对路径按 vault 根前缀收敛（原样比、再折叠比）→ 其余作外部
 * 绝对路径 → 相对路径剥 `./` → `..` / 空段拒绝。
 *
 * 前缀比对**容忍大小写差异**（macOS 默认大小写不敏感，从 Finder 复制的根路径大小写未必与注册
 * 项一致）：否则一个大小写不同的根前缀会把 vault 内文件误判成 vault 外、从而只读打开。
 */
export function normalizeQuickOpenInput(
  raw: string,
  root: string | undefined,
): { kind: "empty" } | { kind: "invalid" } | { kind: "path"; path: string; external: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  // 反斜杠不是本仓路径分隔符（与 `isWellFormedVaultPath` 的口径一致）。
  if (trimmed.includes("\\")) return { kind: "invalid" };

  const stripPrefix = (input: string, prefix: string): string | undefined => {
    if (input === prefix) return "";
    return input.startsWith(`${prefix}/`) ? input.slice(prefix.length + 1) : undefined;
  };

  let path = trimmed;
  let external = false;
  if (path.startsWith("/")) {
    const base = root !== undefined && root.endsWith("/") ? root.slice(0, -1) : root;
    // 先原样比、再折叠比（前缀边界必须是 `/`）。
    const exact = base === undefined ? undefined : stripPrefix(path, base);
    const folded =
      exact === undefined && base !== undefined
        ? stripPrefix(foldCase(path), foldCase(base))
        : undefined;
    if (exact !== undefined) path = exact;
    else if (folded !== undefined) path = path.slice(path.length - folded.length);
    else external = true;
    // 剥完为空 = 输入就是 vault 根本身：那是目录，按无效处置（提示而不是打开）。
    if (!external && path === "") return { kind: "invalid" };
  } else {
    // 相对路径按「相对 vault 根」解释；只剥一层 `./` 前缀（`././x` 的第二次会在段校验里被拒）。
    while (path.startsWith("./")) path = path.slice(2);
    if (path === "") return { kind: "invalid" };
  }

  // 段校验：绝对路径的首段是空串（前导 `/`），不算非法段。
  const segments = path.split("/");
  if (external) segments.shift();
  if (
    path.endsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return { kind: "invalid" };
  }
  return { kind: "path", path, external };
}

/**
 * 把输入串尾部的行号后缀剥掉（D5：**只有整串不成立时**才用这一级，调用方按
 * `quickOpenAttempts` 的次序试）。
 *
 * 复用 `harness-path-link.ts` 的 `lineSuffixAt`：从**最左**的冒号开始试，取第一个「消耗到串尾」
 * 的后缀——这一条同时给出三种形态的正确切分：
 *   - `a.md:12` → 路径 `a.md`、行 12；
 *   - `a.md:12:3` → 路径 `a.md`、行 12（`:12:3` 是一个后缀；从后一个冒号切会错判成路径
 *     `a.md:12` + 行 3）；
 *   - `v1:2.md` → 不成立（`:2` 之后紧跟 `.` 是路径延续）⇒ 整串按路径处理。
 * 畸形形态（`:0` / `:12-` / `:40-12` / `:9-12-15` / `:12x`）一律整段不成立，返回原串。
 */
export function splitLineSuffix(input: string): { path: string; line?: number } {
  for (let at = input.indexOf(":"); at > 0; at = input.indexOf(":", at + 1)) {
    const suffix = lineSuffixAt(input, at);
    if (suffix.line !== undefined && suffix.end === input.length) {
      return { path: input.slice(0, at), line: suffix.line };
    }
  }
  return { path: input };
}

/**
 * 输入串 → **存在性候选阶梯**（design §2.1 的次序，MUST NOT 重排）。
 *
 * 阶梯第一级永远是整串（不带行号）；尾部是**合法**行号后缀时追加第二级（剥后缀 + 落点行）。
 * 两级的 `external` 与归一化结果同源——外部路径因此和 vault 内路径走同一种输入。
 *
 * `query` 是候选列表的过滤串：优先用**剥掉合法后缀**后的路径（`notes/plan.md:12` 的候选按
 * `notes/plan.md` 筛），归一化失败时退回原文。
 */
export function quickOpenAttempts(raw: string, root: string | undefined): QuickOpenPlan {
  const normalized = normalizeQuickOpenInput(raw, root);
  if (normalized.kind === "empty") return { kind: "empty" };
  if (normalized.kind === "invalid") return { kind: "ok", attempts: [], query: raw.trim() };
  const split = splitLineSuffix(normalized.path);
  const attempts: QuickOpenAttempt[] = [
    { path: normalized.path, external: normalized.external },
  ];
  if (split.line !== undefined) {
    attempts.push({ path: split.path, line: split.line, external: normalized.external });
  }
  return {
    kind: "ok",
    attempts,
    query: split.line !== undefined ? split.path : normalized.path,
  };
}

// ---------------------------------------------------------------------------
// 纯函数：vault 内存在性裁决（索引 → 折叠等值 → 批量存在探测）
// ---------------------------------------------------------------------------

/** 一条路径在 vault 内的裁决结果。 */
export type VaultPathLookup =
  | { kind: "hit"; path: string }
  | { kind: "ambiguous"; paths: readonly string[] }
  | { kind: "dir" }
  | { kind: "missing" };

/** 裁决所需的三个只读口（装配层注入；本模块不持索引、不发 IPC）。 */
export interface VaultLookupEnv {
  /** vault 文件索引（`vaultFilePaths`：全部非惰性文件条目）。 */
  files(): readonly string[];
  /** 目录判定（文件树既有的只读查询 `FileTree.hasDir`，MUST NOT 另建目录索引）。 */
  isDir(path: string): boolean;
  /** 索引外的存在探测（`fs_paths_exist`：被忽略规则挡在枚举结果之外、但仍在 vault 内的文件）。 */
  probe(paths: readonly string[]): Promise<readonly string[]>;
}

/**
 * 路径存在性裁决（design §2.3 的第 6 条）：
 *   逐字精确命中 → 打开它；无精确命中时按**大小写折叠等值**回退（唯一命中才打开，多命中
 *   **不猜**、转列候选）；仍不中且是目录 → 目录提示；最后经批量存在探测兜底（惰性目录里的
 *   文件因此可按精确路径打开）。
 *
 * 目录判定排在探测**之前**：`fs_paths_exist` 对目录同样报「存在」（它只 canonicalize），
 * 排在后面会让目录被当成文件去打开。
 */
export async function lookupVaultPath(
  path: string,
  env: VaultLookupEnv,
): Promise<VaultPathLookup> {
  const files = env.files();
  if (files.includes(path)) return { kind: "hit", path };
  const folded = foldCase(path);
  const equals = files.filter((file) => foldCase(file) === folded);
  if (equals.length === 1) return { kind: "hit", path: equals[0] as string };
  if (equals.length > 1) return { kind: "ambiguous", paths: equals };
  if (env.isDir(path)) return { kind: "dir" };
  // 探测失败（后端不可用 / 未注册该命令 / IPC 级错误）按「不存在」处置：存在性兜底本来就是
  // 一条**尽力而为**的补集（索引才是主判据），让它把整个解析掀翻会让浮层卡在打开态。
  let existing: readonly string[] = [];
  try {
    existing = await env.probe([path]);
  } catch {
    existing = [];
  }
  return existing.includes(path) ? { kind: "hit", path } : { kind: "missing" };
}

// ---------------------------------------------------------------------------
// 文案（deck 取号见 src/copy-data.ts；函数形态的理由同 list-filter：打开时取值）
// ---------------------------------------------------------------------------

/** 输入框读屏名。 */
export const QUICK_OPEN_LABEL = (): string => t("D570");
/** 输入框占位（可发现性的主要出口）。 */
export const QUICK_OPEN_PLACEHOLDER = (): string => t("D571");
/** 空查询的一行用法（MUST NOT 列全量候选）。 */
export const QUICK_OPEN_USAGE = (): string => t("D572");
/** 找不到（Enter 之后的判决；输入内容保留，浮层不收起）。 */
export const quickOpenMissingText = (query: string): string => t("D573", { query });
/** 解析到目录（不做目录浏览）。 */
export const quickOpenDirText = (path: string): string => t("D574", { path });
/** 命中总数（未超上限）。 */
export const quickOpenCountText = (count: number): string =>
  tPlural("D575", count, { count });
/** 命中总数超过渲染上限。 */
export const quickOpenTruncatedText = (count: number): string =>
  tPlural("D576", count, { count, limit: CANDIDATE_LIMIT });
/** 打开失败而打开链路自己已上屏原因时的一行指路。 */
export const QUICK_OPEN_FAILED = (): string => t("D581");

// ---------------------------------------------------------------------------
// DOM 适配层：浮层 + 就地键 + 异步打开编排
// ---------------------------------------------------------------------------

/** vault 外只读打开的结果（判断「这一级候选是否成立」与「该给什么提示」）。 */
export type ExternalOpenOutcome =
  | { kind: "opened" }
  /** 不存在：这一级候选不成立，调用方继续试下一级（`/tmp/x:12` 的第二级是 `/tmp/x`）。 */
  | { kind: "missing" }
  /** 是目录：终态，提示「这是目录」。 */
  | { kind: "dir" }
  /** 其它失败（超限 / 非法编码 / 读取失败 / 图片二进制）：终态，`message` 已是人话。 */
  | { kind: "failed"; message: string };

export interface QuickOpenOptions {
  /** 浮层挂点：`shell.modeline`（与 `.lumir-toc` / `.lumir-goto` 同一挂点）。 */
  mount: HTMLElement;
  /** 当前 vault 根（未装载 vault 时 undefined）。 */
  root(): string | undefined;
  /** vault 文件索引（候选来源 + 精确命中的第一判据）。 */
  files(): readonly string[];
  /** 目录判定（文件树只读查询）。 */
  isDir(path: string): boolean;
  /** 索引外的存在探测（`fs_paths_exist`）。 */
  probe(paths: readonly string[]): Promise<readonly string[]>;
  /** vault 内打开（唯一打开链路 + 行跳转编排）；返回这次打开是否成功。 */
  openVaultPath(path: string, line?: number): Promise<boolean>;
  /** vault 外只读打开（含行跳转）；`missing` 表示这一级候选不成立。 */
  openExternalPath(path: string, line?: number): Promise<ExternalOpenOutcome>;
  /** 未装载 vault 时的一行提示出口。 */
  notice(text: string): void;
  /** 收起时把焦点交还编辑器（`focusPreservingReadingPosition`，CL-1）。 */
  restoreFocus(): void;
}

export interface QuickOpenHandle {
  /** 命令入口：已打开则收起，否则打开（未装载 vault 只给提示、不打开空浮层）。 */
  toggle(): void;
  /** 收起（前台会话切换等被动路径调用；已收起时是空操作）。 */
  close(): void;
  isOpen(): boolean;
}

/** 列表 id（输入框的 `aria-controls` 指认它）。 */
const LIST_ID = "lumir-qo-list";
/** 条目 id 前缀（`aria-activedescendant` 用）。 */
const ITEM_ID_PREFIX = "lumir-qo-opt-";

export function createQuickOpen(options: QuickOpenOptions): QuickOpenHandle {
  const popover = document.createElement("div");
  // 几何/配色/滚动全部来自 `src/style.css` 里与 `.lumir-toc` 共用的那一组选择器（见文件头）；
  // 本模块只用 `.lumir-qo*` 的 class——两块浮层各查各的，互不命中对方的断言。
  popover.className = "lumir-qo";
  popover.hidden = true;
  // 真输入框是输入法的 composition 目标（中文查询串唯一能打进来的宿主）；ARIA 组合框语义：
  // 持焦点的是它，列表是它控制的 listbox，游标经 aria-activedescendant 报出（MUST NOT 留在
  // 列表上——ARIA 要求该属性落在持焦元素上，与 `.lumir-toc` 同款）。
  const input = document.createElement("input");
  input.type = "text";
  input.className = "lumir-qo-input";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-controls", LIST_ID);
  input.setAttribute("aria-label", QUICK_OPEN_LABEL());
  input.placeholder = QUICK_OPEN_PLACEHOLDER();
  input.autocomplete = "off";
  input.spellcheck = false;
  const list = document.createElement("div");
  list.className = "lumir-qo-list";
  list.id = LIST_ID;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", QUICK_OPEN_LABEL());
  list.tabIndex = -1;
  const empty = document.createElement("p");
  empty.className = "lumir-qo-empty";
  empty.hidden = true;
  const hint = document.createElement("p");
  hint.className = "lumir-qo-hint";
  hint.textContent = QUICK_OPEN_USAGE();
  popover.append(input, list, empty, hint);
  options.mount.append(popover);

  let opened = false;
  /** 当前候选的源下标（升序，最多 `CANDIDATE_LIMIT` 条）。 */
  let visible: readonly number[] = [];
  /** 候选 DOM（下标空间 = `visible` 的下标）。 */
  let items: HTMLElement[] = [];
  /** 候选对应的完整相对路径（与 `items` 逐项对应；点击 / Enter 直接用这一份，不重读索引）。 */
  let entryPaths: string[] = [];
  /** 键盘游标（`items` 的下标；-1 = 没有游标）。 */
  let activeIndex = -1;
  /** 输入法组合进行中：组合期不刷新（拼音串必然零命中，刷新只会闪一下）。 */
  let composing = false;
  /**
   * 请求序号：Enter 连按 / 存在性探测在途时改输入，都靠它丢弃过期结果
   *（失败与过期都 MUST NOT 留空标签、MUST NOT 用迟到结果覆盖新输入）。
   */
  let request = 0;

  function setHint(text: string): void {
    hint.textContent = text;
  }

  /** 收起 DOM 与状态，**不碰焦点**（焦点去哪由调用方决定）。 */
  function dismiss(): void {
    opened = false;
    popover.hidden = true;
    input.value = "";
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren();
    items = [];
    entryPaths = [];
    visible = [];
    activeIndex = -1;
    setHint(QUICK_OPEN_USAGE());
    empty.hidden = true;
    list.hidden = false;
  }

  function close(restoreFocus = true): void {
    if (!opened) return;
    dismiss();
    if (restoreFocus) options.restoreFocus();
  }

  function setActive(index: number): void {
    const previous = items[activeIndex];
    if (previous !== undefined) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    activeIndex = index;
    const item = items[index];
    if (item === undefined) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    item.classList.add("is-active");
    item.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  /** 按当前输入重建候选（空查询不列全量，只给用法提示；超上限截断并显示总数）。 */
  function render(): void {
    list.replaceChildren();
    items = [];
    entryPaths = [];
    activeIndex = -1;
    const raw = input.value.trim();
    if (raw === "") {
      visible = [];
      list.hidden = true;
      empty.hidden = true;
      setHint(QUICK_OPEN_USAGE());
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const plan = quickOpenAttempts(raw, options.root());
    const query = plan.kind === "ok" ? plan.query : raw;
    const files = options.files();
    const hits = plan.kind === "ok" ? filterIndices(files, query) : [];
    visible = hits.slice(0, CANDIDATE_LIMIT);
    list.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
    // 列表区那一行只说「没有匹配」——与两处既有浮层共用同一句（D117，`list-filter` 的唯一来源）。
    // 「找不到：{输入}」是**Enter 之后**的判决，不在这里出现：边打字边报「找不到」会报假话
    //（用户可能正打到一半）。
    empty.textContent = NO_MATCH_TEXT();
    if (hits.length === 0) {
      // 零命中：列表区给 D117，提示行退回用法（「命中 0 条」与「无匹配」是同一句话，不重复）。
      setHint(QUICK_OPEN_USAGE());
      input.removeAttribute("aria-activedescendant");
      return;
    }
    setHint(
      hits.length > CANDIDATE_LIMIT
        ? quickOpenTruncatedText(hits.length)
        : quickOpenCountText(hits.length),
    );
    items = visible.map((source, index) => {
      const path = files[source] as string;
      entryPaths.push(path);
      const element = document.createElement("div");
      element.className = "lumir-qo-item";
      element.id = `${ITEM_ID_PREFIX}${source}`;
      element.setAttribute("role", "option");
      element.setAttribute("aria-selected", "false");
      // 匹配对象是完整相对路径（spec「候选列表与匹配语义」），展示也逐字用它——
      // 「只显示文件名」会让同名文件在同一条列表里不可分辨。
      element.textContent = path;
      // 点击路径与键盘路径落同一个动作上；mousedown 不夺焦（照 TOC：否则先 blur 关闭、
      // 再重开，点击落空）。
      element.addEventListener("mousedown", (event) => event.preventDefault());
      element.addEventListener("click", () => {
        void openCandidate(index);
      });
      list.append(element);
      return element;
    });
    // 游标落在首条命中（与 `list-filter` 的 `cursorStart` 口径一致：查询非空即首条）。
    setActive(0);
  }

  /** 选中一条候选打开：**不过路径解析**（候选的路径已由索引校验）。 */
  async function openCandidate(index: number): Promise<void> {
    const path = entryPaths[index];
    if (path === undefined) return;
    const seq = ++request;
    let success = false;
    try {
      success = await options.openVaultPath(path);
    } catch {
      success = false;
    }
    if (seq !== request) return;
    if (success) {
      // 成功打开时前台会话通常已经换过（`syncActiveDocument` 会经 close() 收起本浮层）；
      // 这里兜一次「打开成功但会话没换」的形态（例如目标已是前台），行为一致。
      close();
      return;
    }
    setHint(QUICK_OPEN_FAILED());
  }

  /** Enter：**路径优先**（spec「输入解析」的次序是合同的一部分），不成立时才落到游标候选。
   *
   *  整段包在 try/catch 里：打开 / 存在探测的意外失败**不得**把浮层卡在打开态（未捕获的
   *  rejection 会让 Enter 看起来毫无反应）。失败按 D581 给一行指路——真正的原因由打开链路
   *  自己在正文区上屏。 */
  async function confirm(): Promise<void> {
    const plan = quickOpenAttempts(input.value, options.root());
    if (plan.kind === "empty") return;
    const seq = ++request;
    try {
      if (plan.kind === "ok") {
        for (const attempt of plan.attempts) {
          if (attempt.external) {
            const outcome = await options.openExternalPath(attempt.path, attempt.line);
            if (seq !== request) return; // 过期结果：用户已经改了输入
            if (outcome.kind === "opened") {
              close();
              return;
            }
            if (outcome.kind === "missing") continue; // 这一级不成立，试下一级
            setHint(outcome.kind === "dir" ? quickOpenDirText(attempt.path) : outcome.message);
            return;
          }
          const lookup = await lookupVaultPath(attempt.path, {
            files: () => options.files(),
            isDir: (path) => options.isDir(path),
            probe: (paths) => options.probe(paths),
          });
          if (seq !== request) return;
          if (lookup.kind === "dir") {
            setHint(quickOpenDirText(attempt.path));
            return;
          }
          if (lookup.kind === "ambiguous") {
            // 折叠多命中：不猜，转候选（查询换成这条路径，列表里就是那几个折叠等值项）。
            input.value = attempt.path;
            render();
            return;
          }
          if (lookup.kind === "missing") continue;
          const success = await options.openVaultPath(lookup.path, attempt.line);
          if (seq !== request) return;
          if (success) {
            close();
            return;
          }
          setHint(QUICK_OPEN_FAILED());
          return;
        }
      }
      // 全部候选级都不成立：候选列表里若有游标，Enter 落到它（spec「选中候选即打开」）；
      // 否则刷新候选并给「找不到」（输入内容保留，浮层不收起）。
      const cursor = visible[activeIndex];
      if (cursor !== undefined) {
        await openCandidate(activeIndex);
        return;
      }
      render();
      setHint(quickOpenMissingText(plan.query));
    } catch {
      if (seq !== request) return;
      setHint(QUICK_OPEN_FAILED());
    }
  }

  function move(delta: number): void {
    if (items.length === 0) return;
    const next = Math.min(items.length - 1, Math.max(0, activeIndex + delta));
    if (next !== activeIndex) setActive(next);
  }

  // 就地键（浮层容器上）：输入框持焦时事件目标在浮层里，`editor` / `text` 作用域的绑定不命中，
  // 这些键由浮层自己消费——`preventDefault` 同时是分发表那边的让路信号。`Tab` 不接管
  //（留给原生焦点遍历，spec 明写）。
  popover.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      case "Enter":
        event.preventDefault();
        void confirm();
        return;
      case "Escape":
      case "Ctrl-G":
        event.preventDefault();
        close();
        return;
      case "ArrowDown":
      case "Ctrl-N":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
      case "Ctrl-P":
        event.preventDefault();
        move(-1);
        return;
      default:
        return;
    }
  });

  // 组合期不刷新（中间串必然零命中），组合结束后补一次。
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    render();
  });
  input.addEventListener("input", (event) => {
    if (composing || (event as InputEvent).isComposing) return;
    // 输入一变就作废在途的打开请求（迟到结果不得落到新输入上）。
    ++request;
    render();
  });

  // 焦点离开**浮层**才收起（Tab 出去、点到别处、窗口失活都走这条）——挂点必须外移到容器。
  // 这条路径不抢焦点（焦点去哪是用户刚做的选择）。
  popover.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && popover.contains(next)) return;
    close(false);
  });
  // 点击浮层之外收起（编辑器 / 文件树 / toast …）。
  document.addEventListener("mousedown", (event) => {
    if (!opened) return;
    const target = event.target;
    if (target instanceof Node && popover.contains(target)) return;
    close();
  });

  return {
    toggle() {
      if (opened) {
        close();
        return;
      }
      if (options.root() === undefined) {
        // 没有候选可言：空浮层只会误导（spec「未装载 vault 时不打开空浮层」）。
        options.notice(t("D582"));
        return;
      }
      input.setAttribute("aria-label", QUICK_OPEN_LABEL());
      input.placeholder = QUICK_OPEN_PLACEHOLDER();
      dismiss();
      opened = true;
      popover.hidden = false;
      render();
      input.focus();
    },
    close() {
      close();
    },
    isOpen: () => opened,
  };
}
