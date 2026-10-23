// harness 输出里的 vault 路径识别与跳转编排（change harness-path-link）。
//
// 分层纪律：本模块是**纯函数层**（无 DOM、无 IPC、无编辑器内核），面板只做接线，单测直接驱动。
// 三条职责：
//   1. 正文候选：从一段文本里找出「命中 vault 文件索引或目录模型」的可点路径（允许中文、支持
//      `:行号` / `:行号:列号` / `:起-止` 后缀；change harness-dir-link 起目录也在列，后缀只归文件）。候选宽、
//      校验严——字符规则只负责切出 run，**是否可点由调用方给的索引判定**决定（扫描实证：中文
//      行文里的对照式斜杠与 vault 外仓库路径都靠这一层滤掉）。
//   2. 工具卡片：从结构化工具参数里取路径目标（Read 的 offset 作落点行；Move 两段；diff 头由
//      面板侧的 diffPathOf 提供）——MUST NOT 对卡片上的任意文本做路径正则。
//   3. 跳转编排：打开 → 转场窗口内落点 → 下一帧复核补发。窗口包裹在这里成为可断言的不变量
//      （阅读位置合同 CL-2：应用推动视口的中间态不得被捕获）。

/** 路径字符：字母（含中文等非 ASCII 字母）、数字、`_`、`.`、`-`、`/`。 */
const PATH_CHAR = /[\p{L}\p{N}_.\-/]/uy;
/** 只用于「两端收缩」的中文类字符（路径本身允许它们，因此先试整串再剥）。 */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/uy;
/** `:行号` / `:行号:列号` / `:起-止`（1-based；列号只解析、不参与落点；行范围的 `止` 只参与
 *  「后缀是否成立」，落点取 `起`）。两种第二段互斥，`起-止:列` 不叠加（design §2.1）。 */
const LINE_SUFFIX = /:(\d{1,7})(?:-(\d{1,7})|:(\d{1,7}))?/y;

/** run 长度上限：超过即按「极长无断句中文串」处理，不识别（design §2.2 的已知边界）。 */
export const MAX_CANDIDATE_RUN = 120;

/** 可点目标的类型（change harness-dir-link）：文件打开、目录在左栏定位。 */
export type PathTargetKind = "file" | "dir";

/**
 * 目标存在性索引（判据由调用方提供，本模块不碰文件系统 / 树模型）：
 *  - `isFile`：vault 内可打开的**文件**集（装配层按既有口径过滤图片 / 二进制 / 惰性条目）；
 *  - `isDir`：vault 内**目录模型**（装配层注入文件树的只读查询——目录可点性与定位能力因此
 *    使用同一份数据，不另维护一份目录索引）。
 */
export interface PathTargetIndex {
  isFile(path: string): boolean;
  isDir(path: string): boolean;
}

export interface PathCandidate {
  /** vault 相对路径（不含行号后缀；目录已去掉尾斜杠）。 */
  path: string;
  /** 目标类型：文件走打开链路，目录走左栏定位。 */
  kind: PathTargetKind;
  /** 1-based 行号；无后缀时缺省（目录从不带行号）。`:起-止` 的落点即 `起`。 */
  line?: number;
  /** 列号（`:行号:列号` 的第二段）；v1 只解析、不参与落点。 */
  column?: number;
  /** 可点范围（相对传入文本，含行号后缀）。 */
  from: number;
  to: number;
  /** 可点范围的原文（展示文本逐字不变，含目录引用的尾斜杠）。 */
  text: string;
}

function charAt(text: string, index: number, re: RegExp): boolean {
  if (index < 0 || index >= text.length) return false;
  re.lastIndex = index;
  return re.test(text);
}

const isPathCharAt = (text: string, index: number): boolean => charAt(text, index, PATH_CHAR);
const isCjkAt = (text: string, index: number): boolean => charAt(text, index, CJK_CHAR);

/** 候选必须至少有「/」或「.」，且至少一个字母/数字（纯标点串不成候选）。 */
function hasPathShape(path: string): boolean {
  return (
    (path.includes("/") || path.includes(".")) &&
    /[\p{L}\p{N}]/u.test(path)
  );
}

/** vault 相对路径的形状校验（候选来自模型输出，按不可信输入处理）。 */
export function isWellFormedVaultPath(path: string): boolean {
  if (path === "" || path.length > 1024) return false;
  if (path.startsWith("/") || path.startsWith("~/")) return false;
  if (path.endsWith("/")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === ".." || segment === ".")) {
    return false;
  }
  // 反斜杠不是本仓路径分隔符；`~` 开头以外的家目录写法一律不认。
  if (path.includes("\\") || path.startsWith("~")) return false;
  return true;
}

/** 在 `at` 处解析行号后缀；不合形状时不消费（返回 end = at）。 */
function lineSuffixAt(text: string, at: number): { line?: number; column?: number; end: number } {
  LINE_SUFFIX.lastIndex = at;
  const match = LINE_SUFFIX.exec(text);
  if (match === null) return { end: at };
  // 后缀之后必须不是 ASCII 路径延续（`a.md:12x` / `a.md:12/5` 不是行号引用）。中文紧跟
  // 行号则是行文（「见 a.md:12 的内容」常写成「见a.md:12的内容」）——中文是候选字符，
  // 不能拿它当「路径还在继续」的判据。`-` 留在拒绝类里，`9-12-15` 因此整段不成立。
  if (/[A-Za-z0-9_.\-/]/.test(text[at + match[0].length] ?? "")) return { end: at };
  const line = Number(match[1]);
  if (!Number.isInteger(line) || line < 1) return { end: at };
  // `:起-止`：`止 < 起` 使**整个**后缀不成立（MUST NOT 回退成只有 `:起`——半吞会让可点范围
  // 与文字承诺错位）。`止` 越界不在这里判，落点由 revealLine 的既有钳制处理（design §2.2）。
  if (match[2] !== undefined) {
    const rangeEnd = Number(match[2]);
    if (rangeEnd < line) return { end: at };
    return { line, end: at + match[0].length };
  }
  const column = match[3] === undefined ? undefined : Number(match[3]);
  return {
    line,
    column: column !== undefined && Number.isInteger(column) && column >= 1 ? column : undefined,
    end: at + match[0].length,
  };
}

/** 单个候选切片的判定：先文件、后目录（目录允许单个尾斜杠，判定按去尾斜杠后的路径）。 */
function resolveTarget(
  raw: string,
  index: PathTargetIndex,
): { path: string; kind: PathTargetKind } | null {
  if (!hasPathShape(raw)) return null;
  const stripped = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (!isWellFormedVaultPath(stripped)) return null;
  // 尾斜杠是**目录意图**：文件判定只认原文（`a.md/` 不是文件引用）。
  if (stripped === raw && index.isFile(stripped)) return { path: stripped, kind: "file" };
  if (index.isDir(stripped)) return { path: stripped, kind: "dir" };
  return null;
}

/**
 * 在一个路径字符 run 里找命中目标的候选。
 *
 * 先试整串；未命中时只从**两端**剥中文与句末点号（中文行文不空格，路径常与前后文粘连，
 * 如「见路径」「路径的」）。只从两端收缩、不在中间开刀：文件本身可以含中文，整串先命中时
 * 不会被剥坏；同一 run 里被中文连接的两条路径不拆开（已登记为已知边界）。
 */
function resolveRun(
  text: string,
  start: number,
  end: number,
  index: PathTargetIndex,
): { path: string; kind: PathTargetKind; from: number; to: number } | null {
  let maxLeft = 0;
  while (start + maxLeft < end && isCjkAt(text, start + maxLeft)) maxLeft += 1;
  let maxRight = 0;
  while (end - maxRight > start) {
    const char = text[end - maxRight - 1];
    if (char === "." || isCjkAt(text, end - maxRight - 1)) maxRight += 1;
    else break;
  }
  for (let total = 0; total <= maxLeft + maxRight; total += 1) {
    for (let left = 0; left <= maxLeft; left += 1) {
      const right = total - left;
      if (right < 0 || right > maxRight) continue;
      const from = start + left;
      const to = end - right;
      const hit = resolveTarget(text.slice(from, to), index);
      if (hit !== null) return { ...hit, from, to };
    }
  }
  return null;
}

/**
 * 一段文本 → 可点路径候选（按出现序）。`index` 是存在性与可点性的唯一判据：文件必须命中
 * 调用方的文件索引，目录必须命中调用方的目录模型；都不命中的候选不产出（vault 外路径、
 * 内置忽略名目录、图片/二进制都在调用方那一侧滤掉）。
 *
 * 目录候选的可点范围**不含行号后缀**（目录没有行上下文）：`目录:12` 只链接目录本身；
 * 文件候选的 `:行号` / `:行号:列号` / `:起-止` 三种后缀都归可点范围，落点取后缀里的起始行
 * （`起-止` 的 `止` 不参与落点，见 `lineSuffixAt`）。
 */
export function findPathCandidates(text: string, index: PathTargetIndex): PathCandidate[] {
  const out: PathCandidate[] = [];
  let at = 0;
  while (at < text.length) {
    if (!isPathCharAt(text, at)) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && isPathCharAt(text, end)) end += 1;
    if (end - at > MAX_CANDIDATE_RUN) {
      at = end; // 极长无断句 run：不识别（性能与可预测性）
      continue;
    }
    const hit = resolveRun(text, at, end, index);
    if (hit === null) {
      at = end;
      continue;
    }
    const suffix: { line?: number; column?: number; end: number } =
      hit.kind === "file" ? lineSuffixAt(text, hit.to) : { end: hit.to };
    out.push({
      path: hit.path,
      kind: hit.kind,
      line: suffix.line,
      column: suffix.column,
      from: hit.from,
      to: suffix.end,
      text: text.slice(hit.from, suffix.end),
    });
    at = suffix.end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 工具卡片的路径目标（结构化参数，零正则）
// ---------------------------------------------------------------------------

export interface ToolPathTarget {
  path: string;
  /** 1-based 落点行（Read 的 offset）。 */
  line?: number;
}

/** summary → 结构化工具参数；不是完整 JSON 对象（含 80 字截断的摘要）→ null。 */
export function parseToolArgs(summary: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function stringField(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * 工具名 + 参数 → 可点的路径目标（按展示顺序）。
 *
 * 只认**结构化参数**；解析失败 / 形状不合 / `vault_list` / 其它工具一律空（卡片保持原样）。
 * 是否可点仍由调用方的文件索引校验决定——本函数只回答「这条调用的参数里声明了哪个路径」。
 */
export function toolPathTargets(
  name: string,
  args: Record<string, unknown> | null,
): ToolPathTarget[] {
  if (args === null) return [];
  switch (name) {
    case "vault_read": {
      const path = stringField(args, "path");
      if (path === null || !isWellFormedVaultPath(path)) return [];
      const raw = args.offset;
      const line =
        typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : undefined;
      return [{ path, line }];
    }
    case "vault_create":
    case "vault_patch":
    case "vault_delete": {
      const path = stringField(args, "path");
      return path !== null && isWellFormedVaultPath(path) ? [{ path }] : [];
    }
    case "vault_move": {
      const from = stringField(args, "path");
      const to = stringField(args, "new_path");
      const targets: ToolPathTarget[] = [];
      if (from !== null && isWellFormedVaultPath(from)) targets.push({ path: from });
      if (to !== null && isWellFormedVaultPath(to)) targets.push({ path: to });
      return targets;
    }
    default:
      return [];
  }
}

export interface ToolTextSegment {
  text: string;
  /** 命中某个路径目标的展示段；缺省 = 普通文本（命令、箭头、截断摘要等）。 */
  target?: ToolPathTarget;
}

/**
 * 把工具行的展示文本按路径目标切成段（change harness-path-link）：只切**结构化参数里
 * 声明过**的路径，其余文本逐字保留。目标在展示文本里找不到时（理论上不会）按普通文本留下；
 * 同一路径出现两次（Move 的源与目标相同）时按目标序各切一次。
 */
export function splitToolText(
  text: string,
  targets: readonly ToolPathTarget[],
): ToolTextSegment[] {
  const segments: ToolTextSegment[] = [];
  let pos = 0;
  for (const target of targets) {
    const at = text.indexOf(target.path, pos);
    if (at < 0) continue;
    if (at > pos) segments.push({ text: text.slice(pos, at) });
    segments.push({ text: target.path, target });
    pos = at + target.path.length;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos) });
  return segments;
}

// ---------------------------------------------------------------------------
// 跳转编排（可注入依赖，单测直接断言窗口语义）
// ---------------------------------------------------------------------------

export interface PathJumpPlan {
  /** 打开目标文件（既有唯一打开链路；返回是否成功）。 */
  open(path: string): Promise<boolean>;
  /** 行落点（既有 revealLine 原语；1-based）。 */
  reveal(line: number): void;
  /** 应用推动视口的让位窗口（既有 duringViewportTransition）。 */
  duringTransition(run: () => void): void;
  /** 下一帧（真实实现 = requestAnimationFrame）。 */
  nextFrame(run: () => void): void;
  /** 目标行是否仍不在视口内、且编辑器选区仍停在目标处（用户没动）。 */
  needsRescroll(): boolean;
}

/**
 * 点击一条路径：打开 → 窗口内落点 → 下一帧复核补发一次。
 *
 * 两次 reveal 各自单独开窗（首轮的窗在下一帧已经关了）；补发只在**用户没动**时发生，
 * 不跟用户抢选区。无行号时不碰视口。
 */
export async function openPathAtLine(
  plan: PathJumpPlan,
  path: string,
  line?: number,
): Promise<void> {
  const opened = await plan.open(path);
  if (!opened || line === undefined) return;
  plan.duringTransition(() => plan.reveal(line));
  plan.nextFrame(() => {
    if (!plan.needsRescroll()) return;
    plan.duringTransition(() => plan.reveal(line));
  });
}
