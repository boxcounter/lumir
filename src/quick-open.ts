// 按路径快速打开文件（change quick-open-file-oct23；Emacs `C-x C-f` 形态）。
//
// 分层与本仓既有同族模块一致（`src/goto-line.ts` / `src/toc.ts`）：
//   - **纯函数层**（零 DOM / 零 IPC）：输入解析 [`quickOpenAttempts`]、行号后缀
//     [`splitLineSuffix`]、vault 内存在性裁决 [`classifyVaultPath`] / [`lookupVaultPath`]，
//     以及**结果区与 Enter 共用的**判决 [`resolveQuickOpenSync`] / [`resolveQuickOpen`]
//     ——`tests/unit/quick-open.test.ts` 直接驱动 design §2.4 的解析表；
//   - **DOM 适配层**：[`createQuickOpen`] 的浮层、就地键与异步打开编排；打开动作、存在探测与
//     提示出口全部由装配层经 deps 注入（本模块不持第二份打开链路）。
//
// **判决同源（M700）**：结果区画什么（直接打开行 / 候选 / 空态）与 Enter 打开哪个目标，
// 都消费 [`resolveQuickOpen`] 的同一份判决。结果区 MUST NOT 另写一套「有没有这个文件」的判据
// （REVIEW.md「同一语义两处真源」条）：此前 render 只用「索引 + 子串」判空，confirm 却用
// 「索引 → 折叠 → 目录 → 探测」，于是 vault 外绝对路径与索引外的惰性文件同时出现
// 「没有匹配的条目」与 Enter 能打开。
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
import { handleEscapeKey, registerEscapeLayer, unregisterEscapeLayer } from "./escape-router";
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

/** 一条路径在 vault 内的**同步**裁决结果（`unknown` = 索引与目录都说不了，只能异步探测）。 */
export type VaultPathSync =
  | { kind: "hit"; path: string }
  | { kind: "ambiguous"; paths: readonly string[] }
  | { kind: "dir" }
  | { kind: "unknown" };

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
 * 路径存在性裁决的**同步段**（design §2.3 的第 6 条）：
 *   逐字精确命中 → 命中它；无精确命中时按**大小写折叠等值**回退（唯一命中才命中，多命中
 *   **不猜**、转候选）；仍不中且是目录 → 目录；其余交给异步探测（`unknown`）。
 *
 * 目录判定排在探测**之前**：`fs_paths_exist` 对目录同样报「存在」（它只 canonicalize），
 * 排在后面会让目录被当成文件去打开。
 *
 * `lookupVaultPath` 与 result-area resolver 共用这一份——MUST NOT 在别处再判一次
 * 「这个路径在不在 vault 里」。
 */
export function classifyVaultPath(
  path: string,
  env: Pick<VaultLookupEnv, "files" | "isDir">,
): VaultPathSync {
  const files = env.files();
  if (files.includes(path)) return { kind: "hit", path };
  const folded = foldCase(path);
  const equals = files.filter((file) => foldCase(file) === folded);
  if (equals.length === 1) return { kind: "hit", path: equals[0] as string };
  if (equals.length > 1) return { kind: "ambiguous", paths: equals };
  if (env.isDir(path)) return { kind: "dir" };
  return { kind: "unknown" };
}

/** 完整裁决（同步段 + 批量存在探测兜底）：惰性目录里的文件因此可按精确路径打开。 */
export async function lookupVaultPath(
  path: string,
  env: VaultLookupEnv,
): Promise<VaultPathLookup> {
  const sync = classifyVaultPath(path, env);
  if (sync.kind !== "unknown") return sync;
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
// 纯函数：输入 → 判决（结果区与 Enter 的**同一份**解析）
// ---------------------------------------------------------------------------

/** 结果区与 Enter 共用的判决。 */
export type QuickOpenVerdict =
  | { kind: "empty" }
  /** 输入非法（反斜杠 / `..` / vault 根本身）：没有任何候选级。 */
  | { kind: "invalid" }
  /** 可直接打开：vault 内解析到的文件，或 vault 外路径的**尝试入口**（读取前判不了存在性）。 */
  | { kind: "open"; path: string; line?: number; external: boolean }
  /** 折叠等值多命中：不猜，转候选（两段式的第一段）。 */
  | { kind: "ambiguous"; path: string; paths: readonly string[] }
  /** 解析到目录：不打开目录本身（两段式的第一段）。 */
  | { kind: "dir"; path: string }
  /** 没有任何一级成立。 */
  | { kind: "missing" }
  /**
   * 同步层判不了（索引不含、不是目录）：需要异步存在探测。
   * `attempt` 是**当前这一级**（探测不成立才轮到后一级）。
   */
  | { kind: "undecided"; attempt: QuickOpenAttempt };

export interface QuickOpenResolution {
  plan: QuickOpenPlan;
  verdict: QuickOpenVerdict;
}

const NO_MISSING: ReadonlySet<string> = new Set();

/** 构造 `open` 判决（`line` 缺省时不带这个键——判决对象是逐项比对的测试面）。 */
function openVerdict(path: string, line: number | undefined, external: boolean): QuickOpenVerdict {
  return line === undefined
    ? { kind: "open", path, external }
    : { kind: "open", path, line, external };
}

/**
 * 判决的**同步段**：按 [`quickOpenAttempts`] 的阶梯逐级判，遇到同步判不了的一级就停下
 * 返回 `undecided`（MUST NOT 越过它去用后一级——「整串优先」是 spec 的合同）。
 *
 * `knownMissing` 是 `resolveQuickOpen` 探测之后回填的「已证实不存在」集合，让同一份阶梯
 * 在探测之后能**从下一级继续**，不必复制一份次序。
 *
 * vault 外路径没有同步判据（唯一能读绝对路径的后端命令是读取命令）：整条阶梯都是**尝试
 * 入口**，判决取阶梯末级——带合法行号后缀时那就是「剥后缀 + 落点行」的一级（整串只是同一
 * 个文件名的字面形态）。
 */
export function resolveQuickOpenSync(
  raw: string,
  root: string | undefined,
  env: Pick<VaultLookupEnv, "files" | "isDir">,
  knownMissing: ReadonlySet<string> = NO_MISSING,
): QuickOpenResolution {
  const plan = quickOpenAttempts(raw, root);
  if (plan.kind === "empty") return { plan, verdict: { kind: "empty" } };
  if (plan.attempts.length === 0) return { plan, verdict: { kind: "invalid" } };
  if (plan.attempts[0]!.external) {
    const target = plan.attempts[plan.attempts.length - 1]!;
    return { plan, verdict: openVerdict(target.path, target.line, true) };
  }
  for (const attempt of plan.attempts) {
    const sync = classifyVaultPath(attempt.path, env);
    if (sync.kind === "hit") {
      return { plan, verdict: openVerdict(sync.path, attempt.line, false) };
    }
    if (sync.kind === "ambiguous") {
      return { plan, verdict: { kind: "ambiguous", path: attempt.path, paths: sync.paths } };
    }
    if (sync.kind === "dir") return { plan, verdict: { kind: "dir", path: attempt.path } };
    if (!knownMissing.has(attempt.path)) {
      return { plan, verdict: { kind: "undecided", attempt } };
    }
  }
  return { plan, verdict: { kind: "missing" } };
}

/**
 * 完整判决（允许异步存在探测）：按 [`resolveQuickOpenSync`] 的**同一次序**走，遇到同步判不了
 * 的一级就探测，探测不成立才进入下一级。`confirm()` 与结果区的探查补帧都用这一份。
 */
export async function resolveQuickOpen(
  raw: string,
  root: string | undefined,
  env: VaultLookupEnv,
): Promise<QuickOpenResolution> {
  const knownMissing = new Set<string>();
  for (;;) {
    const resolution = resolveQuickOpenSync(raw, root, env, knownMissing);
    if (resolution.verdict.kind !== "undecided") return resolution;
    const attempt = resolution.verdict.attempt;
    let existing: readonly string[] = [];
    try {
      existing = await env.probe([attempt.path]);
    } catch {
      existing = [];
    }
    if (existing.includes(attempt.path)) {
      return {
        plan: resolution.plan,
        verdict: openVerdict(attempt.path, attempt.line, false),
      };
    }
    knownMissing.add(attempt.path);
  }
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
/** 结果区的「直接打开」行（vault 内解析到的文件）。 */
export const quickOpenDirectText = (path: string): string => t("D589", { path });
/** 结果区的「直接打开」行（vault 外：读取前判不了存在性，这一行是**尝试入口**）。 */
export const quickOpenDirectExternalText = (path: string): string => t("D590", { path });
/** 直接打开行的落点行标记（带合法行号后缀时附在路径之后）。 */
export const quickOpenDirectLineText = (line: number): string => t("D591", { line });
/** 折叠等值多命中的两段式第一段：只揭示、不猜（第二次 Enter 才打开游标行）。 */
export const QUICK_OPEN_AMBIGUOUS = (): string => t("D592");

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
/**
 * 结果区补帧的探测去抖：输入停稳 120ms 后才发一次存在探测。探测只在「候选为空」或
 * 「输入带合法行号后缀」时发起（见 `shouldProbe`），所以普通打字不会把每个字符变成一次 IPC。
 */
const PROBE_DEBOUNCE_MS = 120;

/** 结果区的一行：直接打开行（至多一条，恒在最前）或候选。 */
type QuickOpenRow =
  | { kind: "direct"; path: string; line?: number; external: boolean }
  | { kind: "candidate"; path: string };

/** 行身份（异步补帧后按它把游标留在同一行上）。 */
function rowKey(row: QuickOpenRow | undefined): string | undefined {
  if (row === undefined) return undefined;
  return row.kind === "direct" ? `direct:${row.path}:${row.line ?? ""}` : `candidate:${row.path}`;
}

/** 一行路径文本的展示拆分（M702，change overlay-width-contract-oct24 的 W5 / design §4）。 */
export interface PathRowText {
  /** 路径之前的固定文本（直接打开行的动作前缀；候选行为空）。 */
  prefix: string;
  /** 目录前缀（含末尾 `/`；根目录文件为空串）。 */
  dirs: string;
  /** 文件名（路径的身份主体）。空串 = 文本里找不到路径，按整段 prefix 渲染。 */
  name: string;
  /** 路径之后的固定文本（当前模板都没有尾串；留字段是为了不假设模板形状）。 */
  suffix: string;
}

/**
 * 把「一行文本 + 其中的路径」拆成可独立收缩的四段：**目录前缀先让宽、文件名不先裁**
 * ——单行尾省略会先吃掉文件名（M698 实测：77 字符深层路径裁 42.5%，文件名整段不可见）。
 *
 * 口径与 `collapseMiddleDirs`（M606，`src/harness-context.ts`）同源：**文件名是路径的身份
 * 主体，目录只是消歧辅助**。本模块**不调用**它，是因为 quick-open 的列表必须保留目录前缀
 * 供同名文件消歧（无条件折成 `…/文件名` 会让 `a/plan.md` 与 `b/plan.md` 的两条行文本相同）：
 * 这里只做「目录 / 文件名」的切分，中间的折叠由 CSS 的省略号在**放不下时**才发生，
 * 文件名因此不会被先裁。目录部分没有第二份折叠算法——MUST NOT 在本模块再写一份。
 *
 * 用 `lastIndexOf` 定位路径而不是按模板切：直接打开行的文案由 deck 模板（D589/D590）拼出，
 * 前缀随语言变化；路径逐字出现在模板里（`quickOpenDirectText` 的插值就是原文），找不到时
 * 退回「整段 prefix」而不是抛错或猜位置。纯函数、零 DOM，单测直接钉边界。
 */
export function splitPathRowText(text: string, path: string): PathRowText {
  const at = path === "" ? -1 : text.lastIndexOf(path);
  if (at < 0) return { prefix: text, dirs: "", name: "", suffix: "" };
  const slash = path.lastIndexOf("/");
  return {
    prefix: text.slice(0, at),
    dirs: path.slice(0, slash + 1),
    name: path.slice(slash + 1),
    suffix: text.slice(at + path.length),
  };
}

/**
 * 把一行文本按 [`splitPathRowText`] 落成两段 DOM：目录前缀（`.lumir-qo-dirs`，可中段省略）
 * 与文件名（`.lumir-qo-name`，最后才截）。两段拼接后的 `textContent` 仍是完整原文——
 * 匹配语义、ARIA 与既有逐条文本断言都不变；全路径另落 `title`（W5 的全文通道）。
 */
function fillPathText(element: HTMLElement, text: string, path: string): void {
  const parts = splitPathRowText(text, path);
  const segments: Array<[string, string]> = [
    ["lumir-qo-prefix", parts.prefix],
    ["lumir-qo-dirs", parts.dirs],
    ["lumir-qo-name", parts.name],
    ["lumir-qo-suffix", parts.suffix],
  ];
  for (const [className, value] of segments) {
    if (value === "") continue;
    const span = document.createElement("span");
    span.className = className;
    span.textContent = value;
    element.append(span);
  }
}

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
  /** 结果区的行：第 0 行可能是「直接打开」行，其后是候选（共用一个键盘 / ARIA / 点击游标）。 */
  let rows: QuickOpenRow[] = [];
  /** 行 DOM（下标空间 = `rows`）。 */
  let items: HTMLElement[] = [];
  /** 键盘游标（`items` 的下标；-1 = 没有游标）。 */
  let activeIndex = -1;
  /** 用户动过游标：没动过时 Enter 走**默认行**（有直接行即直接行，否则首条候选）。 */
  let userMoved = false;
  /** 两段式的「已揭示」输入值：折叠多命中 / 目录的第一次 Enter 只揭示、第二次才打开游标行。 */
  let revealedFor: string | null = null;
  /** 输入法组合进行中：组合期不刷新（拼音串必然零命中，刷新只会闪一下）。 */
  let composing = false;
  /**
   * 打开请求序号：Enter 连按 / 打开在途时改输入，都靠它丢弃过期结果
   *（失败与过期都 MUST NOT 留空标签、MUST NOT 用迟到结果覆盖新输入）。
   */
  let request = 0;
  /**
   * 结果区刷新序号：异步存在探测的迟到结果靠它丢弃（I4：迟到结果 MUST NOT 覆盖新输入）。
   * 与 `request` 分开——一个是「打开」，一个是「画结果区」，两者的在途窗口互不相关。
   */
  let renderSeq = 0;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  /** 存在探测在途：空态先不落（I4：异步不抢先落终态）。 */
  let probing = false;
  /**
   * 当前输入已经**走完探测**的完整判决（`confirm` 或补帧产出）。同一输入的后续重画直接复用它：
   * 既不重复 probe，也不会让补帧把 Enter 已经给出的提示（「找不到」）覆盖回用法行。
   */
  let settled: { raw: string; resolution: QuickOpenResolution } | null = null;

  /** 解析所需的三个只读口（与 confirm 共用同一份 env 形状）。 */
  const lookupEnv = (): VaultLookupEnv => ({
    files: () => options.files(),
    isDir: (path) => options.isDir(path),
    probe: (paths) => options.probe(paths),
  });

  function setHint(text: string): void {
    hint.textContent = text;
  }

  /** 取消在途的存在探测（改输入 / 收起 / 重开都走这一条）。 */
  function clearProbe(): void {
    if (probeTimer !== undefined) {
      clearTimeout(probeTimer);
      probeTimer = undefined;
    }
    probing = false;
  }

  /** 收起 DOM 与状态，**不碰焦点**（焦点去哪由调用方决定）。
   *
   *  层栈注销与这条跃迁同源（change fix-escape-overlay-close-oct24）：Enter 打开、⌃G、失焦、
   *  浮层外点击、窗口级兜底五条关闭路径都经过它。 */
  function dismiss(): void {
    opened = false;
    unregisterEscapeLayer("quick-open");
    popover.hidden = true;
    input.value = "";
    input.removeAttribute("aria-activedescendant");
    // 作废在途探测（关闭之后到达的结果不得再画到任何输入上）。
    clearProbe();
    ++renderSeq;
    settled = null;
    list.replaceChildren();
    rows = [];
    items = [];
    activeIndex = -1;
    userMoved = false;
    revealedFor = null;
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

  /**
   * 按当前输入重建结果区：同步判决 → 直接打开行 + 候选（空态只在两者都没有、且没有在途探测
   * 时出现）。异步探测只做**补帧**：先画一版同步能判的，去抖后再补一版完整的。
   */
  function render(): void {
    const seq = ++renderSeq;
    clearProbe();
    const raw = input.value.trim();
    if (raw !== revealedFor) revealedFor = null;
    if (raw === "") {
      rows = [];
      items = [];
      activeIndex = -1;
      userMoved = false;
      list.replaceChildren();
      list.hidden = true;
      empty.hidden = true;
      setHint(QUICK_OPEN_USAGE());
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const res =
      settled !== null && settled.raw === raw
        ? settled.resolution
        : resolveQuickOpenSync(raw, options.root(), lookupEnv());
    const files = options.files();
    const hits = res.plan.kind === "ok" ? filterIndices(files, res.plan.query) : [];
    const probe = (settled === null || settled.raw !== raw) && shouldProbe(res, hits);
    probing = probe;
    apply(res, files, hits, { preserveCursor: false });
    if (probe) scheduleProbe(raw, seq);
  }

  /** 是否要为这一版结果补一次存在探测（见 `PROBE_DEBOUNCE_MS` 的理由）。 */
  function shouldProbe(res: QuickOpenResolution, hits: readonly number[]): boolean {
    if (res.verdict.kind !== "undecided") return false;
    // 候选为空：空态的判据只能等探测落地（I4：异步不抢先落终态）。
    if (hits.length === 0) return true;
    // 带合法行号后缀：`path:行` 是完整的粘贴形态，直接行要标明落点行。普通路径前缀不探，
    // 否则每敲一个字符就是一次 IPC。
    return res.plan.kind === "ok" && res.plan.attempts.length > 1;
  }

  /** 把一份判决画成结果区（直接行恒在最前；候选按索引序、至多 `CANDIDATE_LIMIT` 条）。 */
  function apply(
    res: QuickOpenResolution,
    files: readonly string[],
    hits: readonly number[],
    opts: { preserveCursor: boolean },
  ): void {
    // 异步补帧：用户**主动移动过**游标时按行身份保留位置（直接行插到最前时下标会平移）；
    // 没动过时直接行一出现就要成为默认位（spec「游标默认停在直接打开行」）。
    const activeKey = opts.preserveCursor && userMoved ? rowKey(rows[activeIndex]) : undefined;
    rows = [];
    if (res.verdict.kind === "open") {
      rows.push({
        kind: "direct",
        path: res.verdict.path,
        line: res.verdict.line,
        external: res.verdict.external,
      });
    }
    for (const source of hits.slice(0, CANDIDATE_LIMIT)) {
      rows.push({ kind: "candidate", path: files[source] as string });
    }
    fillRows();
    list.hidden = rows.length === 0;
    // 「没有匹配的条目」只表示**候选列表为空**，且只在没有直接行、也没有在途探测时出现——
    // 它 MUST NOT 用来否认一条可打开的直接行（D117 的原话是「没有匹配」，不是「打不开」）。
    empty.textContent = NO_MATCH_TEXT();
    empty.hidden = rows.length !== 0 || probing;
    if (hits.length === 0) {
      setHint(QUICK_OPEN_USAGE());
    } else {
      setHint(
        hits.length > CANDIDATE_LIMIT
          ? quickOpenTruncatedText(hits.length)
          : quickOpenCountText(hits.length),
      );
    }
    if (rows.length === 0) {
      setActive(-1);
      return;
    }
    if (activeKey !== undefined) {
      // 异步补帧：把游标留在原来那一行上（直接行插到最前时下标会平移）。
      const at = rows.findIndex((row) => rowKey(row) === activeKey);
      setActive(at >= 0 ? at : 0);
      return;
    }
    // 游标默认停在直接行（没有直接行时就是首条候选）。
    setActive(0);
    userMoved = false;
  }

  /** 行 DOM：直接行与候选共用一套 role / id / mousedown / click（同一个游标空间）。 */
  function fillRows(): void {
    list.replaceChildren();
    items = [];
    rows.forEach((row, index) => {
      const element = document.createElement("div");
      element.id = `${ITEM_ID_PREFIX}${row.kind === "direct" ? "direct" : index}`;
      element.setAttribute("role", "option");
      element.setAttribute("aria-selected", "false");
      // 全路径落 title（W5 的全文通道）：行放不下时目录前缀出省略号，文件名只在极端窄的
      // 宿主里才截——两种情形的全文都在这里可达。
      element.title = row.path;
      if (row.kind === "direct") {
        // 直接行用独立 class：既有视觉断言钉的是 `.lumir-qo-item` 的逐条文本，直接行复用
        // 会把「候选集合」的判据混进一条动作提示（M700）。
        element.className = "lumir-qo-direct";
        const primary = document.createElement("span");
        primary.className = "lumir-qo-direct-path";
        fillPathText(
          primary,
          row.external ? quickOpenDirectExternalText(row.path) : quickOpenDirectText(row.path),
          row.path,
        );
        element.append(primary);
        if (row.line !== undefined) {
          const line = document.createElement("span");
          line.className = "lumir-qo-direct-line";
          line.textContent = quickOpenDirectLineText(row.line);
          element.append(line);
        }
      } else {
        element.className = "lumir-qo-item";
        // 匹配对象是完整相对路径（spec「候选列表与匹配语义」），展示也逐字用它——
        // 「只显示文件名」会让同名文件在同一条列表里不可分辨。两段结构只改**收缩次序**
        // （目录先让宽、文件名后让），拼接后的文本仍是完整路径。
        fillPathText(element, row.path, row.path);
      }
      // 点击路径与键盘路径落同一个动作上；mousedown 不夺焦（照 TOC：否则先 blur 关闭、
      // 再重开，点击落空）。
      element.addEventListener("mousedown", (event) => event.preventDefault());
      element.addEventListener("click", () => {
        userMoved = true;
        setActive(index);
        void openRow(index);
      });
      list.append(element);
      items.push(element);
    });
  }

  /** 去抖后的补帧：用完整判决重画一次结果区（迟到结果按 `renderSeq` 丢弃）。 */
  function scheduleProbe(raw: string, seq: number): void {
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      void (async () => {
        let res: QuickOpenResolution;
        try {
          res = await resolveQuickOpen(raw, options.root(), lookupEnv());
        } catch {
          probing = false;
          return;
        }
        // 迟到结果：输入已改 / 结果区已重画 ⇒ 整份丢弃（MUST NOT 覆盖新输入）。
        if (seq !== renderSeq || input.value.trim() !== raw) return;
        probing = false;
        settled = { raw, resolution: res };
        const files = options.files();
        const hits = res.plan.kind === "ok" ? filterIndices(files, res.plan.query) : [];
        apply(res, files, hits, { preserveCursor: true });
      })();
    }, PROBE_DEBOUNCE_MS);
  }

  /** 打开结果区的第 `index` 行（键盘 Enter 与鼠标点击共用）。 */
  async function openRow(index: number): Promise<void> {
    const row = rows[index];
    if (row === undefined) return;
    if (row.kind === "candidate") {
      await openCandidate(row.path);
      return;
    }
    await openDirect(row);
  }

  /** 选中一条候选打开：**不过路径解析**（候选的路径已由索引校验）。 */
  async function openCandidate(path: string): Promise<void> {
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

  /**
   * 打开一条「直接打开」行：vault 内走唯一打开链路；vault 外走只读通道。
   *
   * vault 外读取之前判不了存在性：`missing` 时才回退到同一阶梯里的另一形态（`path:行` 的
   * 字面整串 / 剥后缀那一级），这一步保住「文件名本身以 `:行` 结尾」这个角落在改动前也能
   * 打开（顺序理由见 design §2.1 的已知边界）。
   */
  async function openDirect(target: {
    path: string;
    line?: number;
    external: boolean;
  }): Promise<void> {
    const seq = ++request;
    const plan = quickOpenAttempts(input.value, options.root());
    const missingText = (): string =>
      quickOpenMissingText(plan.kind === "ok" ? plan.query : input.value.trim());
    try {
      if (!target.external) {
        const success = await options.openVaultPath(target.path, target.line);
        if (seq !== request) return;
        if (success) {
          close();
          return;
        }
        setHint(QUICK_OPEN_FAILED());
        return;
      }
      const outcome = await options.openExternalPath(target.path, target.line);
      if (seq !== request) return;
      if (outcome.kind === "opened") {
        close();
        return;
      }
      if (outcome.kind === "missing") {
        const alternate =
          plan.kind === "ok"
            ? plan.attempts.find(
                (attempt) =>
                  attempt.external &&
                  (attempt.path !== target.path || attempt.line !== target.line),
              )
            : undefined;
        if (alternate === undefined) {
          setHint(missingText());
          return;
        }
        const fallback = await options.openExternalPath(alternate.path, alternate.line);
        if (seq !== request) return;
        if (fallback.kind === "opened") {
          close();
          return;
        }
        if (fallback.kind === "missing") {
          setHint(missingText());
          return;
        }
        setHint(fallback.kind === "dir" ? quickOpenDirText(alternate.path) : fallback.message);
        return;
      }
      setHint(outcome.kind === "dir" ? quickOpenDirText(target.path) : outcome.message);
    } catch {
      if (seq === request) setHint(QUICK_OPEN_FAILED());
    }
  }

  /** 两段式的第一段：揭示原因 / 候选，**不猜**任何目标（第二次 Enter 才打开游标行）。 */
  function reveal(
    verdict: { kind: "ambiguous"; path: string } | { kind: "dir"; path: string },
  ): void {
    revealedFor = input.value.trim();
    // 先按同一输入重画一遍（候选 / 游标 / 计数），再把提示行换成原因——两段式的第二段因此
    // 一定有一个真实的游标行可打开。
    render();
    setHint(verdict.kind === "ambiguous" ? QUICK_OPEN_AMBIGUOUS() : quickOpenDirText(verdict.path));
    if (rows.length > 0) setActive(0);
    userMoved = false;
  }

  /**
   * Enter：消费与结果区**同一份**判决（`resolveQuickOpen`）。
   *
   *   1. `open`：打开直接行；用户已用 ↑↓ / 点击把游标移到候选上时打开**游标行**
   *      （spec「选中候选即打开」——直接行与候选共用一个游标空间）。
   *   2. `ambiguous` / `dir`：两段式——第一次只揭示原因 / 候选，第二次才打开游标行；
   *      MUST NOT 在同一次按键里猜一个目标。
   *   3. `missing`：游标行是候选就打开它，否则给「找不到」。
   *
   * 整段包在 try/catch 里：打开 / 存在探测的意外失败**不得**把浮层卡在打开态（未捕获的
   * rejection 会让 Enter 看起来毫无反应）。失败按 D581 给一行指路——真正的原因由打开链路
   * 自己在正文区上屏。
   */
  async function confirm(): Promise<void> {
    const raw = input.value.trim();
    if (raw === "") return;
    const seq = ++request;
    let res: QuickOpenResolution;
    try {
      res = await resolveQuickOpen(raw, options.root(), lookupEnv());
    } catch {
      if (seq === request) setHint(QUICK_OPEN_FAILED());
      return;
    }
    if (seq !== request) return; // 过期结果：用户已经改了输入
    // 这次判决已经走完探测，同一输入的后续重画复用它（不再 probe、不再覆盖提示）。
    settled = { raw, resolution: res };
    const verdict = res.verdict;
    const activeRow = rows[activeIndex];
    switch (verdict.kind) {
      case "empty":
        return;
      case "open":
        // 游标在候选上且用户**主动**移过去 ⇒ 打开候选；否则按结果区的默认位打开直接行
        //（异步补帧尚未画上直接行时，游标只是默认停在首条候选，不算「移过去」）。
        if (activeRow?.kind === "candidate" && userMoved) {
          await openCandidate(activeRow.path);
          return;
        }
        await openDirect(verdict);
        return;
      case "ambiguous":
      case "dir":
        if (revealedFor !== raw) {
          reveal(verdict);
          return;
        }
        if (activeRow !== undefined) {
          await openRow(activeIndex);
          return;
        }
        reveal(verdict);
        return;
      case "missing":
      case "invalid":
        // 输入非法（反斜杠 / `..` / 尾斜杠）与「找不到」在这里同权：候选列表照常按原文筛过，
        // 游标行是候选就打开它（spec「选中候选即打开」），否则给「找不到」。
        if (activeRow?.kind === "candidate") {
          await openCandidate(activeRow.path);
          return;
        }
        render();
        setHint(quickOpenMissingText(res.plan.kind === "ok" ? res.plan.query : raw));
        return;
      case "undecided":
        // `resolveQuickOpen` 会把每一级探测走完；防御性分支：保持结果区原状。
        return;
    }
  }

  function move(delta: number): void {
    if (items.length === 0) return;
    const next = Math.min(items.length - 1, Math.max(0, activeIndex + delta));
    if (next === activeIndex) return;
    userMoved = true;
    setActive(next);
  }

  // 就地键（浮层容器上）：输入框持焦时事件目标在浮层里，`editor` / `text` 作用域的绑定不命中，
  // 这些键由浮层自己消费——`preventDefault` 同时是分发表那边的让路信号。`Tab` 不接管
  //（留给原生焦点遍历，spec 明写）。
  popover.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    // Escape 归共享准入（change fix-escape-overlay-close-oct24）：无修饰才关层，带修饰键只消费
    // 默认行为，组合期归输入法——那套判断不在本文件重写。
    if (handleEscapeKey(event, () => close())) return;
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      case "Enter":
        event.preventDefault();
        void confirm();
        return;
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
      registerEscapeLayer("quick-open", () => close());
      render();
      input.focus();
    },
    close() {
      close();
    },
    isOpen: () => opened,
  };
}
