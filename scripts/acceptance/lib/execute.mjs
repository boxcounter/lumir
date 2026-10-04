// 场景执行器：把场景文件里的步骤与断言跑成 PASS/FAIL，并留下证据。
//
// 场景格式（design: docs/process/real-machine-acceptance.md「形态」）用 YAML front-matter +
// 人读正文；一个验收项一个文件。步骤是动作，`expect` 是断言列表，逐条独立记结果——
// 一条断言失败不阻断后续步骤，好让一次运行把该场景的问题一次暴露齐。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { findNode, windowBounds } from "./ax.mjs";
import { copyFixture, fixturesDir, SCENARIO_CONFIG_KEYS } from "./app.mjs";
import { DEFAULT_MIN_DIFF, DEFAULT_PATCH, DEFAULT_TOL, colorDiff, decodeScreenshot, dominantColor, formatColor, lumaSpread } from "./pixel.mjs";
import {
  clickNode,
  frontmostPid,
  injectClickWithClickState,
  injectDrag,
  openFile,
  pressKey,
  readAx,
  resizeWindowAX,
  settle,
  StepError,
  tryForeground,
  typeInEditor,
  waitUntil,
} from "./drive.mjs";
import { envHome, mkdirp, readText, repoRoot, secondVaultDir, sleep, vaultDir } from "./util.mjs";

/** 动作与断言的白名单：`--check` 用它做静态校验，避免写错 key 要等一整轮真机才发现。 */
export const ACTIONS = new Set([
  "settle", "waitFor", "sleep", "key", "keys", "type", "click", "clickNodeText", "clickInNode", "clickEditor",
  "doubleClick", "drag", "focusWindow", "open", "configWrite", "restart", "record", "recordEditor", "vaultWrite",
  "vaultAppend", "vaultRm", "vaultSparse", "resizeWindow", "clipboardRead",
]);
export const EXPECT_KINDS = new Set(["ax", "editor", "file", "glob", "shot", "window", "clipboard", "pixel"]);

/** 静态校验一个场景，返回问题列表（空 = 通过）。 */
export function checkScenario(scenario) {
  const problems = [];
  const push = (m) => problems.push(`${scenario.id}: ${m}`);
  if (!scenario.id) push("缺少 id");
  if (scenario.item === undefined) push("缺少 item");
  if (scenario.open && !scenario.marker) push(`open=${scenario.open} 但没写 marker（无法判断是否打开成功）`);
  for (const [i, e] of (scenario.seed?.registry ?? []).entries()) {
    if (!e?.id || !e?.path) push(`seed.registry[${i}] 需要 id 与 path`);
  }
  // 旧名注册表（M248）：迁移场景 48 用它构造「升级前现场」，校验口径与现名同一条。
  for (const [i, e] of (scenario.seed?.legacyRegistry ?? []).entries()) {
    if (!e?.id || !e?.path) push(`seed.legacyRegistry[${i}] 需要 id 与 path`);
  }
  // 会话种子（M321）：`panes` 是**分栏现场**的形状，写错会静默退化成 v1 空会话——预置的标签
  // 根本没进盘，断言恒红且归因指向别处（写错的键 = 不生效，与其余种子同一条假绿/假红口径）。
  for (const [id, s] of Object.entries(scenario.seed?.sessions ?? {})) {
    if (s?.panes === undefined) continue;
    if (!Array.isArray(s.panes) || s.panes.length === 0) push(`seed.sessions.${id}.panes 需要非空数组`);
    else
      for (const [i, p] of s.panes.entries()) {
        if (!Array.isArray(p?.tabs)) push(`seed.sessions.${id}.panes[${i}].tabs 需要数组`);
        if (p?.active !== null && p?.active !== undefined && typeof p.active !== "string")
          push(`seed.sessions.${id}.panes[${i}].active 需要字符串或 null`);
      }
  }
  // 批量真实形状 vault（M283）：形状参数写错会静默退化成缺省值（生成出来不是那个规模），
  // 与「断言字段名写错 = 恒真」同类，因此在静态检查里挡住。
  const bulk = scenario.seed?.bulkVault;
  if (bulk !== undefined && bulk !== true) {
    if (typeof bulk !== "object" || bulk === null) push("seed.bulkVault 只能是 true 或形状参数对象");
    else {
      const NUM_KEYS = ["markdown", "files", "dirs", "mdBytes", "maxMdBytes", "ignoredMd"];
      // 两类忽略探针（M296）：`ignoredDirs` 是「名字 → md 条数」、`lazyDirs` 是三份目录名清单。
      // 与其余参数同一条口径校验：键名写错 = 静默不生成 = 场景的负向断言在空输入上假绿。
      const LAZY_KEYS = ["gitignore", "gitignoreNegations", "exclude"];
      for (const [k, v] of Object.entries(bulk)) {
        if (NUM_KEYS.includes(k)) {
          if (!Number.isInteger(v) || v <= 0) push(`seed.bulkVault.${k} 需要正整数，实际 ${JSON.stringify(v)}`);
        } else if (k === "ignoredDirs") {
          if (typeof v !== "object" || v === null || Array.isArray(v)) push("seed.bulkVault.ignoredDirs 需要「目录名 → md 条数」对象");
          else {
            for (const [name, n] of Object.entries(v)) {
              if (!Number.isInteger(n) || n <= 0) push(`seed.bulkVault.ignoredDirs.${name} 需要正整数，实际 ${JSON.stringify(n)}`);
            }
          }
        } else if (k === "lazyDirs") {
          if (typeof v !== "object" || v === null || Array.isArray(v)) push("seed.bulkVault.lazyDirs 需要对象（gitignore / gitignoreNegations / exclude）");
          else {
            for (const lk of Object.keys(v)) {
              if (!LAZY_KEYS.includes(lk)) push(`seed.bulkVault.lazyDirs 未知键 ${lk}（拼错即静默不生成规则文件）`);
              else if (!Array.isArray(v[lk]) || v[lk].some((s) => typeof s !== "string" || !s))
                push(`seed.bulkVault.lazyDirs.${lk} 需要非空字符串数组，实际 ${JSON.stringify(v[lk])}`);
            }
          }
        } else {
          push(`seed.bulkVault 未知参数 ${k}（写错即静默用缺省值）`);
        }
      }
    }
  }
  // **语言面**（M284）：断言里的 chrome 文案是**某一档语言**的取值（`src/copy-data.ts` 的 zh / en
  // 两列各一份）。套件自己钉住默认面（run.mjs 的 `SUITE_LANGUAGE`，见 README「语言面」），场景
  // 只在需要别的面时用 `config.language` 覆盖——因此这里校验的是「声明了就必须是合法档」，而不是
  // 「必须声明」：跟随**套件**默认是设计，跟随**产品**默认才是 M282 那个假红的成因。
  // 沿革：M282 把产品出厂默认从 zh 裁成 en，50 余个断言中文文案的场景随之在默认面下系统性假红
  // （finding `.tower/comms/findings/20260928-worker-impl-vault-perf-bug-m282-en-27-chrome.md`）。
  const lang = scenario.config?.language;
  if (lang !== undefined && lang !== "zh" && lang !== "en") {
    push(`config.language 只能是 zh/en（实际 ${JSON.stringify(lang)}）——写错会静默落回产品出厂口径`);
  }
  for (const k of Object.keys(scenario.config ?? {})) {
    if (!SCENARIO_CONFIG_KEYS.includes(k)) push(`config 未知键 ${k}（拼错即静默不生效，允许：${SCENARIO_CONFIG_KEYS.join(" / ")}）`);
  }
  for (const [i, step] of (scenario.steps ?? []).entries()) {
    const at = `steps[${i}]${step.name ? `(${step.name})` : ""}`;
    if (!step.name) push(`${at} 缺少 name`);
    if (step.do !== undefined && !ACTIONS.has(step.do)) push(`${at} 未知动作 do=${step.do}`);
    if (step.do === "keys" && !Array.isArray(step.keys)) push(`${at} do=keys 需要 keys 数组`);
    if (step.do === "key" && !step.key) push(`${at} do=key 需要 key`);
    if (step.do === "waitFor") {
      // 轮询判据（M296）：`has` / `not` 两份字符串清单，至少一项非空；写错键名会静默变成
      // 「立刻成立」的空条件（本套件最该挡的假绿形态），因此在这里死板校验。
      const wf = step.waitFor ?? {};
      const lists = [wf.has, wf.not].filter((v) => v !== undefined);
      if (!lists.length) push(`${at} do=waitFor 需要 waitFor.has / waitFor.not 至少一项`);
      for (const [k, v] of [["has", wf.has], ["not", wf.not]]) {
        if (v === undefined) continue;
        if (!Array.isArray(v) || v.length === 0 || v.some((s) => typeof s !== "string" || !s))
          push(`${at} do=waitFor 的 waitFor.${k} 需要非空字符串数组，实际 ${JSON.stringify(v)}`);
      }
      for (const k of Object.keys(wf)) {
        if (!["has", "not"].includes(k)) push(`${at} do=waitFor 未知键 waitFor.${k}（拼错即静默不判）`);
      }
      if (step.timeoutMs !== undefined && (!Number.isInteger(step.timeoutMs) || step.timeoutMs <= 0))
        push(`${at} do=waitFor 的 timeoutMs 需要正整数，实际 ${JSON.stringify(step.timeoutMs)}`);
    }
    if (step.do === "doubleClick" && !step.target) push(`${at} do=doubleClick 需要 target（节点或 {x,y} 窗口局部坐标）`);
    if (step.do === "click" && step.target?.button !== undefined && !["left", "right", "middle"].includes(step.target.button))
      push(`${at} do=click 的 target.button 只能是 left/right/middle，实际 ${JSON.stringify(step.target.button)}`);
    if (step.do === "drag" && (!step.target || (step.dx === undefined && step.dy === undefined)))
      push(`${at} do=drag 需要 target（带 bbox 的节点、{x,y} 窗口局部坐标或 textareaEdge）与 dx/dy 位移（窗口局部点）`);
    if (step.do === "resizeWindow" && typeof step.width !== "number")
      push(`${at} do=resizeWindow 需要数值 width（height 缺省保持当前）`);
    if (step.do === "vaultSparse" && (!Number.isInteger(step.size) || step.size <= 0))
      push(`${at} do=vaultSparse 需要正整数 size（字节）`);
    if (step.do === "vaultSparse" && !step.file) push(`${at} do=vaultSparse 需要 file`);
    if (step.do === "vaultSparse" && step.vault !== undefined && step.vault !== "second")
      push(`${at} do=vaultSparse 的 vault 只能是 "second"（缺省 = 验收 vault）`);
    for (const [j, exp] of (step.expect ?? []).entries()) {
      const kinds = Object.keys(exp).filter((k) => k !== "label");
      if (kinds.length !== 1) push(`${at} expect[${j}] 应恰好一个断言形态，实际 ${JSON.stringify(kinds)}`);
      else if (!EXPECT_KINDS.has(kinds[0])) push(`${at} expect[${j}] 未知断言 ${kinds[0]}`);
      else if (kinds[0] === "file" && !exp.file.path) push(`${at} expect[${j}] file 断言缺 path`);
      else if (kinds[0] === "glob" && (!exp.glob.dir || !exp.glob.pattern)) push(`${at} expect[${j}] glob 断言缺 dir/pattern`);
      else if (kinds[0] === "ax" && !["has", "not", "count", "focused"].some((k) => exp.ax[k] !== undefined))
        push(`${at} expect[${j}] ax 断言缺 has/not/count/focused（写错字段名会静默变成恒真断言）`);
      else if (kinds[0] === "window" && !["moved", "width"].some((k) => exp.window[k] !== undefined))
        push(`${at} expect[${j}] window 断言缺 moved/width`);
      else if (kinds[0] === "clipboard" && !["has", "not", "exact"].some((k) => exp.clipboard[k] !== undefined))
        push(`${at} expect[${j}] clipboard 断言缺 has/not/exact（写错字段名会静默变成恒真断言）`);
      else if (kinds[0] === "pixel") {
        // 像素断言（M285）：`same` / `differ` 各是一组采样点对，每组至少两个点；点必须有数值
        // x/y。字段名写错 = 断言恒真（本套件最该挡的假绿形态，见 README 的「断言」表）。
        const spec = exp.pixel;
        const groups = [["same", spec.same], ["differ", spec.differ]];
        if (!groups.some(([, g]) => Array.isArray(g) && g.length > 0) && !(spec.contrast ?? []).length)
          push(`${at} expect[${j}] pixel 断言缺 same/differ/contrast（写错字段名会静默变成恒真断言）`);
        for (const [key, group] of groups) {
          if (group === undefined) continue;
          if (!Array.isArray(group) || group.length === 0) push(`${at} expect[${j}] pixel.${key} 必须是非空数组`);
          for (const [g, points] of (group ?? []).entries()) {
            if (!Array.isArray(points) || points.length < 2)
              push(`${at} expect[${j}] pixel.${key}[${g}] 至少两个采样点（一个点的「同色」恒真）`);
            for (const [p, pt] of (points ?? []).entries()) {
              if (typeof pt?.x !== "number" || typeof pt?.y !== "number")
                push(`${at} expect[${j}] pixel.${key}[${g}][${p}] 缺数值 x/y（窗口局部点，与 click/drag 同一空间）`);
            }
          }
        }
        for (const [p, pt] of (spec.contrast ?? []).entries()) {
          if (typeof pt?.x !== "number" || typeof pt?.y !== "number")
            push(`${at} expect[${j}] pixel.contrast[${p}] 缺数值 x/y`);
          // 阈值必须显式给：contrast 是**绝对阈值**断言，缺省值会让「写错的键」静默变成另一条断言。
          if (typeof pt?.min !== "number") push(`${at} expect[${j}] pixel.contrast[${p}] 缺 min（亮度跨度的下限）`);
        }
      }
    }
  }
  return problems;
}

/**
 * `$appName` / `$appVersion` 占位替换（M236）：期望值里要引用「当前构建的产品名 / 版本号」时
 * 写占位符，加载时从本仓 src-tauri/tauri.conf.json 读真值代入——场景 MUST NOT 硬编码一份
 * 版本号副本（真源唯一，REVIEW.md 第 8 条），版本 bump 后场景跟着真源走。
 * repoRoot() 是本 checkout 的根（worktree 跑就取 worktree 的 conf），与被测构建同源。
 */
async function appMetaTokens() {
  const conf = JSON.parse(await readText(path.join(repoRoot(), "src-tauri/tauri.conf.json")));
  return {
    $appName: String(conf.productName),
    $appVersion: String(conf.version),
    // 合成验收 vault 的绝对路径（M244）：剪贴板类断言要比对**绝对路径**，而它随
    // LUMIR_ACCEPTANCE_VAULT 覆写而变——场景 MUST NOT 硬编码 /tmp 那一份。
    $vault: vaultDir(),
    // 套件 fixtures 目录的绝对路径（M304）：只读引用 fixture 原文（如 harness mock 脚本）
    // 走这个 token——不拷进 vault，避免在 vault 根留下非 .md 残留（resetVault 的 M296 缺口
    // 不清这类文件，场景 28/65 的「vault 里无 json/tmp 产物」断言会被串红）。
    $fixtures: fixturesDir(),
  };
}

/** 深度遍历 YAML 产物，字符串里的占位符全部替换。
 *
 *  **词边界替换**（M252 finding）：`$vault`（本表）与种子里的第二 vault 惯用记号 `$vault2`
 *  共享前缀——用 `replaceAll` 会把 `$vault2` 吃成 `<vault 路径>2`（一个不存在的目录），
 *  凡在 `seed` 里写 `$vault2` 的场景（17 / 19 / 32）第二 vault 都会变成「路径不可用」行。
 *  因此 token 后面**紧跟标识符字符（字母 / 数字 / 下划线）时不替换**：
 *   - `$vault2` 原样留给 `app.mjs` 的 `resolveSeedPath`（它按 `secondVaultDir()` 解析）；
 *   - `$vault-b` 照常替换（`-` 不是标识符字符）——它与 `secondVaultDir()` 的兜底口径
 *     `${vaultDir()}-b` 逐字一致，两种写法都落到同一个目录。
 *  `$appName` / `$appVersion` 同样受这条边界保护（`$appNameX` 之类不会被误吃）。 */
function substituteTokens(value, tokens) {
  if (typeof value === "string") {
    let out = value;
    for (const [token, text] of Object.entries(tokens)) {
      out = out.replace(new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g"), text);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => substituteTokens(v, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteTokens(v, tokens)]));
  }
  return value;
}

export async function loadScenario(file) {
  const raw = await readText(file);
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`场景文件缺少 YAML front-matter：${file}`);
  const meta = substituteTokens(yaml.load(m[1]), await appMetaTokens());
  const body = m[2];
  const id = meta.id ?? path.basename(file, ".md");
  return { ...meta, id, body, file };
}

/** 断言里的匹配：字符串按子串；/.../ 包起来按正则。 */
export function matcher(pattern) {
  if (pattern instanceof RegExp) return { test: (s) => pattern.test(s), show: String(pattern) };
  const s = String(pattern);
  if (s.length > 1 && s.startsWith("/") && s.endsWith("/")) {
    const re = new RegExp(s.slice(1, -1), "m");
    return { test: (v) => re.test(v), show: s };
  }
  return { test: (v) => String(v).includes(s), show: JSON.stringify(s) };
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 12);
}

/** 文件断言路径：`env:` 前缀指隔离配置目录，绝对路径原样，其余相对验收 vault。 */
function resolveSpecPath(p) {
  if (p.startsWith("env:")) return path.join(envHome(), "lumir", p.slice(4));
  return path.isAbsolute(p) ? p : path.join(vaultDir(), p);
}

/**
 * file 断言的路径解析：字面路径直接用；含 `*` 时按 glob 在父目录里取**匹配文件里 mtime
 * 最新的那一份**。
 *
 * 为什么需要它：诊断日志按 UTC 日期命名（`<config>/logs/YYYY-MM-DD.jsonl`），而验收环境
 * 的 `env/` 目录跨天复用（`envHome()` 不带日期）——写死日期的断言会在之后每一天读到**上次
 * run 留下的旧文件**，其余内容照样命中，于是断言永久空过（假绿）；换台机器又因文件不存在
 * 直接 FAIL。glob 取最新一份让断言始终对着「这次 run 刚落的那份」。
 */
async function resolveSpecFile(p) {
  if (!p.includes("*")) return resolveSpecPath(p);
  const full = resolveSpecPath(p);
  const dir = path.dirname(full);
  const pattern = new RegExp(
    `^${path.basename(full).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  let hits;
  try {
    hits = (await readdir(dir)).filter((name) => pattern.test(name)).map((name) => path.join(dir, name));
  } catch {
    return full; // 目录不在：让 fileInfo 走「不存在」分支，报错信息仍是原路径
  }
  const found = await Promise.all(hits.map(async (file) => ({ file, info: await fileInfo(file) })));
  found.sort((a, b) => (b.info?.mtimeMs ?? 0) - (a.info?.mtimeMs ?? 0));
  return found[0]?.file ?? full;
}

/**
 * 坐标点击 + 重试：KimiCU 用「最近一次 get_app_state 的截图」校验坐标是否在图内，
 * 两次读之间窗口尺寸/位置变了就会被判越界（实测偶发）。重试时重新取一张图即可。
 * `count` 原样透传给 KimiCU（实测：即使 count=2，WKWebView 里也不产生 DOM 的 `dblclick`，
 * 见 cu.click 与 README「已知边界」）。
 */
/**
 * 读系统剪贴板（M244）：**只有这一条固定命令**——套件刻意不引入通用 shell 通道
 *（38-content-width-drag 记过这条口径），这里要的只是一个可断言的读数出口。
 * 返回值区分「读到空串」与「读失败」：后者由调用方一律判 FAIL，不许当成空。
 *
 * **行尾归一（M277 补，实测踩到）**：AppleScript 把粘贴板的文本强制按**经典 Mac 行尾**（CR）
 * 返回——`osascript -e 'the clipboard'` 读一份用 `\n` 写进去的多行文本，拿回来的是 `\r` 分隔的。
 * 不归一的话，多行内容的 `clipboard: { exact }` 断言**必然**假红（app 侧写的是 LF）。因此这里把
 * CRLF / CR 统一成 LF，再去掉 AppleScript 附加的那一个尾换行。单行内容（如场景 47 的完整路径）
 * 不受影响；归一不改变「读到空串 vs 读失败」的区分，也不吞内容差异。
 */
function readClipboard() {
  try {
    const out = execFileSync("/usr/bin/osascript", ["-e", "the clipboard"], { encoding: "utf8" });
    const normalized = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return { ok: true, text: normalized.replace(/\n$/, "") };
  } catch (e) {
    return { ok: false, text: "", error: e instanceof Error ? e.message : String(e) };
  }
}

async function clickWithRetry(cu, pid, x, y, { retries = 3, count, button } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await cu.click(pid, { x, y, count, ...(button ? { button } : {}) });
    } catch (e) {
      lastErr = e;
      await cu.state(pid, { mode: "full" });
      await sleep(400);
    }
  }
  throw lastErr;
}

/** 可读的原生输入框角色（WKWebView 的 `<input>` 在 AX 里落成这几类）。
 *  `AXComboBox` 是 ARIA 组合框（`<input role="combobox">`，change list-filter 的筛选输入框）——
 *  它是真正的可编辑文本宿主，键盘落进去的字在 AXValue 里。M199 实测：漏了它时 `keys` 的回读盯在
 *  节点的 label（"筛选"）上、永远判「未落地」，而注入其实部分落地并逐次拼接（实测值 "banbab" =
 *  三次注入的残段累积）——正是 README「历史教训（别再回到旧口径）」那类假绿/脏文本形态。 */
const TEXT_FIELD_ROLES = new Set(["AXTextField", "AXSearchField", "AXSecureTextField", "AXComboBox"]);

/** 单个可打印字符（非空白 ASCII）：keys 动作里只有这种键名有唯一的文本语义。 */
const PRINTABLE_KEY_RE = /^[\x21-\x7e]$/;

/** `do: settle` 的等待上限（M249）。15s 是「两次一致」的宽裕上界（每拍 700ms），同时给
 *  「界面一直不收敛」这种异常收一个可预期的代价——到点走兜底，不无限等。 */
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * keys 动作的回读目标——「键盘往哪儿落」必须可证，否则回读会盯错节点：
 *   1. AX 快照里标了 `(focused)` 的节点（键盘注入就落在它身上）；
 *   2. 没有 focused 标记时退到「可读的文本目标」：编辑器（AXTextArea.value）优先，
 *      其次第一个有可读 value 的原生输入框（WKWebView 的 `<input>`）。
 * 三者都不存在 → 返回 null（该步无可回读目标，保持盲发口径）。
 */
function keysTarget(ax) {
  const node =
    ax.nodes.find((n) => n.focused) ??
    ax.textarea ??
    ax.nodes.find((n) => TEXT_FIELD_ROLES.has(n.role) && typeof n.value === "string");
  if (!node) return null;
  if (node.role === "AXTextArea") return { kind: "editor", value: node.value ?? "" };
  if (TEXT_FIELD_ROLES.has(node.role)) return { kind: "input", value: node.value ?? "" };
  // 焦点在非文本节点上（按钮 / toast 动作条 / 面板）：键盘落在它身上，注入进不了任何文档文本。
  // 把它自己也当回读目标，才能把这种情况如实判成「按键未落地」而不是盯错编辑器。
  return { kind: node.role, value: node.title ?? node.label ?? node.value ?? "" };
}

/** 编辑器内 widget 没有 title/label，只有 help（如 mermaid 的 AXGroup.help = 围栏原文）。 */
function findByHelp(nodes, { role, help, nth = 0 }) {
  const m = matcher(help);
  const hits = nodes.filter((n) => (!role || n.role === role) && n.help && m.test(n.help));
  return hits[nth] ?? null;
}

/** 四个可读字段里任一命中即可（title 属性在 AX 里可能落 AXDescription/AXHelp，角色不定）。 */
function findByAny(nodes, { role, any, nth = 0 }) {
  const m = matcher(any);
  const hits = nodes.filter((n) => {
    if (role && n.role !== role) return false;
    return [n.title, n.label, n.value, n.help].some((v) => v && m.test(v));
  });
  return hits[nth] ?? null;
}

/**
 * 路径读数：**文件路径的语义逐字不变**（`stat` + sha256），目录单独走一条旁路（M324）。
 *
 * 为什么必须有这条旁路：目录上 `readFile` 抛 EISDIR、被下面的 catch 吞成 `null`，于是
 * `file: { path: <目录>, exists: true }` **恒红**、`exists: false` **恒绿**——正是 REVIEW.md
 * 第 2 条那类「读不到被当成不存在」。目录只回 `{ mtimeMs, size, isDir: true }`（不读 sha256，
 * 目录没有内容这一说），`exists` 因此拿到真值；要判「没变过」用 `mtimeUnchangedSince`，
 * sha256 类判据（`changedSince` / `unchangedSince`）在目录上**一律判 FAIL**（见文件断言分支）。
 */
async function fileInfo(file) {
  try {
    const st = await stat(file);
    if (st.isDirectory()) return { mtimeMs: st.mtimeMs, size: st.size, isDir: true };
    return { sha256: await sha256(file), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/** 目录上的 sha256 类判据没有可观测量（两边都缺 sha256 会让 `undefined === undefined` 恒真）。 */
const DIR_SHA256_HINT =
  "是目录：sha256 类判据对目录没有可观测量，请改用 mtimeUnchangedSince / exists";

/**
 * 跑一个场景。ctx: { cu, app, evidence, resultsRoot, restartApp() }
 * 返回 { status, fails, records }
 */
export async function runScenario(ctx, scenario) {
  const { cu, evidence } = ctx;
  const vars = {};
  const scenarioDir = await evidence.startScenario(scenario.id, {
    id: scenario.id,
    item: scenario.item,
    title: scenario.title,
    file: path.relative(ctx.repoRoot, scenario.file),
    startedAt: new Date().toISOString(),
  });

  if (ctx.foregroundNote) evidence.record({ kind: "note", text: ctx.foregroundNote });

  const fail = async (label, detail, axSnapshot) => {
    const rec = evidence.record({ kind: "assert", label, ok: false, detail });
    if (axSnapshot) {
      const axFile = await evidence.saveAx(axSnapshot.text, label);
      evidence.logLine(`    AX dump: ${path.relative(scenarioDir, axFile)}`);
      if (axSnapshot.image) await evidence.saveShot(axSnapshot.image, label);
    }
    return rec;
  };
  const pass = (label, detail) => evidence.record({ kind: "assert", label, ok: true, detail });

  async function check(expect, state) {
    const label = expect.label ?? describeExpect(expect);
    if (typeof expect.shot === "string" || expect.shot === true) {
      // 截图是「动作之后」的证据：瞬时 UI（toast）要几百毫秒才渲染出来，立刻读会拍到空档。
      // 同一步骤里后面的断言共享这份快照，所以这个等待同时决定 toast 类断言能不能看见提示。
      await sleep(600);
      const shot = await readAx(cu, ctx.pid, { mode: "full" });
      // 同一步骤内共享快照：toast 是瞬时的，shot 之后再读一次 AX 常常已经看不到它
      // （实证：07c 的「检测到外部修改，已自动重载」只在 shot 那次读里存在）。
      state.ax = shot;
      const f = shot.image ? await evidence.saveShot(shot.image, expect.shot === true ? label : expect.shot) : null;
      const ok = Boolean(shot.image);
      await evidence.saveAx(shot.text, expect.shot === true ? label : expect.shot);
      return ok ? pass(label, f && `证据：shots/${path.basename(f)}`) : fail(label, "截图未取到");
    }
    if (expect.ax) {
      const ax = state.ax ?? (await readAx(cu, ctx.pid));
      state.ax = ax;
      const spec = expect.ax;
      if (spec.focused !== undefined) {
        // 焦点断言走**解析结果**而不是 AX 原始文本：原始文本上的正则没有节点边界意识，
        // `AXTextArea[\s\S]*?\(focused\)` 这类写法在 `(focused)` 落在后面的节点上时照样匹配
        // （r1 评审实证：冲突 toast 的 AXButton 就在 AXTextArea 之后）。
        // 判定：AX 里**恰有一个** focused 节点，且它的 role 命中 spec.focused（子串或 /…/ 正则）。
        const m = matcher(spec.focused);
        const focused = ax.nodes.filter((n) => n.focused);
        const roles = focused.map((n) => n.role).join(",") || "无";
        if (focused.length === 1 && m.test(focused[0].role)) return pass(label, `focused=${roles}`);
        return fail(`${label}（期望唯一 focused 节点为 ${m.show}，实际 focused=${roles}，共 ${focused.length} 个）`, "", ax);
      }
      if (spec.has !== undefined) {
        const m = matcher(spec.has);
        if (m.test(ax.text)) return pass(label);
        return fail(`${label}（期望 AX 含 ${m.show}）`, tailAround(ax.text), ax);
      }
      if (spec.not !== undefined) {
        const m = matcher(spec.not);
        if (!m.test(ax.text)) return pass(label);
        return fail(`${label}（期望 AX 不含 ${m.show}）`, m.test(ax.text) ? "匹配到了" : "", ax);
      }
      if (spec.count !== undefined) {
        const { pattern, exact, min, max } = spec.count;
        const m = matcher(pattern);
        const n = ax.text.split("\n").filter((l) => m.test(l)).length;
        const ok = (exact === undefined || n === exact) && (min === undefined || n >= min) && (max === undefined || n <= max);
        return ok ? pass(label, `命中 ${n} 次`) : fail(`${label}（期望命中 ${exact ?? `${min ?? ""}..${max ?? ""}`}，实际 ${n}）`, "", ax);
      }
      return fail(`${label}（ax 断言缺少 has/not/count/focused）`, "", ax);
    }
    if (expect.clipboard !== undefined) {
      // 剪贴板的断言形态（M244）：与 clipboardRead 动作共用同一个固定命令。
      // **读不到一律 FAIL**，不许在不可观测的窗口里下结论（REVIEW.md 第 2 条：
      // 「读不到」被当成「为空」时，not 类断言会退化成恒真）。
      const spec = expect.clipboard;
      const clip = readClipboard();
      if (!clip.ok) {
        return fail(`${label}（剪贴板不可读：${clip.error}）`, "读不到一律判 FAIL，不在不可观测的窗口下结论");
      }
      if (spec.exact !== undefined) {
        if (clip.text === String(spec.exact)) return pass(label, `剪贴板 = ${clip.text}`);
        return fail(`${label}（期望剪贴板逐字等于 ${JSON.stringify(spec.exact)}，实际 ${JSON.stringify(clip.text)}）`);
      }
      if (spec.has !== undefined) {
        const m = matcher(spec.has);
        return m.test(clip.text)
          ? pass(label, `剪贴板 = ${clip.text}`)
          : fail(`${label}（期望剪贴板含 ${m.show}，实际 ${JSON.stringify(clip.text)}）`);
      }
      const m = matcher(spec.not);
      return m.test(clip.text)
        ? fail(`${label}（期望剪贴板不含 ${m.show}，实际 ${JSON.stringify(clip.text)}）`)
        : pass(label, `剪贴板 = ${clip.text}`);
    }
    if (expect.pixel !== undefined) {
      // 像素断言（M285）：在**窗口截图**上按窗口局部点取底色。通道与边界见 lib/pixel.mjs。
      // 取不到图 / 取不到坐标口径一律 FAIL——不许在不可观测的窗口里下结论（REVIEW.md 第 2 条：
      // 「读不到」被当成「空」时负向断言会退化成恒真）。
      const spec = expect.pixel;
      const ax = state.ax ?? (await readAxWithScreenshot(cu, ctx.pid));
      state.ax = ax;
      if (!ax.image) return fail(`${label}（取不到窗口截图，像素断言无法判定）`, "按 README「已知边界」的 KimiCU 截图通道条处理", ax);
      const bounds = windowBounds(ax.text);
      const shot = screenshotSize(ax.text);
      if (!bounds || !shot) {
        return fail(
          `${label}（AX 快照缺 window_bounds 或截图尺寸，算不出两点之间的换算）`,
          `window_bounds=${JSON.stringify(bounds)} / screenshot=${JSON.stringify(shot)}`,
          ax,
        );
      }
      const patch = spec.patch ?? DEFAULT_PATCH;
      const tol = spec.tol ?? DEFAULT_TOL;
      const minDiff = spec.min ?? DEFAULT_MIN_DIFF;
      const img = decodeScreenshot(ax.image);
      try {
        // 采样点写窗口局部点，这里换算到截图像素（两个读数都来自同一份 AX 快照的 header）。
        const sample = (pt) => {
          const px = Math.round((pt.x * shot.w) / bounds.w);
          const py = Math.round((pt.y * shot.h) / bounds.h);
          const color = dominantColor(img, px, py, patch);
          if (color === null) throw new Error(`采样点 ${pt.x},${pt.y}（截图像素 ${px},${py}）落在图外`);
          return { pt, px, py, color, as: pt.as ?? `${pt.x},${pt.y}` };
        };
        const groups = [
          ...(spec.same ?? []).map((points) => ({ key: "same", points })),
          ...(spec.differ ?? []).map((points) => ({ key: "differ", points })),
        ];
        const readings = [];
        const problems = [];
        for (const { key, points } of groups) {
          const samples = points.map(sample);
          for (const s of samples) readings.push(`${key}: ${s.as} @窗口(${s.pt.x},${s.pt.y}) → ${formatColor(s.color)}`);
          const head = samples[0];
          for (const other of samples.slice(1)) {
            const diff = colorDiff(head.color, other.color);
            const pair = `${head.as} vs ${other.as}（${formatColor(head.color)} / ${formatColor(other.color)}，最大通道差 ${diff}）`;
            if (key === "same" && diff > tol) problems.push(`应同色却不同：${pair}（容差 ${tol}）`);
            if (key === "differ" && diff < minDiff) problems.push(`应异色却相近：${pair}（下限 ${minDiff}）`);
          }
        }
        // 亮度跨度（`contrast`）：判「这一块里真有字形」（选中区里字色若与底色撞上，就是这一条红）。
        for (const point of spec.contrast ?? []) {
          const s = sample(point);
          const spread = lumaSpread(img, s.px, s.py, patch);
          if (spread === null) {
            problems.push(`${s.as} @窗口(${point.x},${point.y})：采样点落在图外`);
            continue;
          }
          readings.push(`contrast: ${s.as} @窗口(${point.x},${point.y}) → 亮度 ${spread.min}..${spread.max}（跨度 ${spread.spread}）`);
          if (spread.spread < point.min) {
            problems.push(`对比不足：${s.as} 的亮度跨度 ${spread.spread} < ${point.min}（这一块里没有可辨的字形）`);
          }
        }
        const detail = `换算 ${bounds.w}pt→${shot.w}px / 方块 ${patch}px；${readings.join("；")}`;
        if (problems.length > 0) return fail(`${label}（${problems.join("；")}）`, detail, ax);
        return pass(label, detail);
      } finally {
        img.close();
      }
    }
    if (expect.editor) {
      const spec = expect.editor;
      const ax = state.ax ?? (await readAx(cu, ctx.pid));
      state.ax = ax;
      // 「编辑器节点不在 AX 快照里」≠「文档为空」。modal（键位面板/对话框）打开时 AX 里没有
      // AXTextArea，若把它当空串，负向断言与逐字节比较会全部空转（实证：09 面板不穿透 "" === ""）。
      // 因此只要拿不到编辑器节点，editor.* 一律记 FAIL——不许在不可观测的窗口里下结论。
      if (!ax.textarea) {
        return fail(
          `${label}（编辑器节点不可读：AX 快照里没有 AXTextArea——modal 打开期间常见）`,
          "该断言形态需要读文档内容才能成立；请在编辑器可读时记录基线/断言，或避开 modal 窗口",
          ax,
        );
      }
      const text = ax.editor ?? "";
      if (spec.unchangedSince !== undefined) {
        // 逐字节比较：比 not/match 强——负向匹配在「基线里本来就没有该串」时会假 PASS。
        const before = vars[spec.unchangedSince];
        if (before === undefined) return fail(`${label}（未记录编辑器基线 ${spec.unchangedSince}）`);
        return before === text
          ? pass(label, `${text.length} 字节逐字节一致`)
          : fail(`${label}（编辑器文本已变）`, `before=${JSON.stringify(before.slice(0, 120))} / now=${JSON.stringify(text.slice(0, 120))}`, state.ax);
      }
      if (spec.changedSince !== undefined) {
        const before = vars[spec.changedSince];
        if (before === undefined) return fail(`${label}（未记录编辑器基线 ${spec.changedSince}）`);
        return before !== text ? pass(label, `${before.length} → ${text.length} 字节`) : fail(`${label}（编辑器文本未变：${before.length} 字节）`, "", state.ax);
      }
      if (spec.has !== undefined) {
        const m = matcher(spec.has);
        return m.test(text) ? pass(label) : fail(`${label}（期望编辑器含 ${m.show}）`, JSON.stringify(text.slice(0, 400)), state.ax);
      }
      if (spec.not !== undefined) {
        const m = matcher(spec.not);
        return !m.test(text) ? pass(label) : fail(`${label}（期望编辑器不含 ${m.show}）`, JSON.stringify(text.slice(0, 400)), state.ax);
      }
      return fail(`${label}（editor 断言缺少 has/not）`, "", state.ax);
    }
    if (expect.file) {
      const spec = expect.file;
      const file = await resolveSpecFile(spec.path);
      const info = await fileInfo(file);
      const label2 = spec.label ?? label;
      if (spec.exists !== undefined) {
        return spec.exists === Boolean(info)
          ? pass(label2, info ? `${spec.path} ${info.isDir ? "（目录）" : ""}存在` : `${spec.path} 不存在`)
          : fail(`${label2}（期望 exists=${spec.exists}，实际 ${Boolean(info)}）`);
      }
      if (!info && (spec.has !== undefined || spec.not !== undefined || spec.changedSince !== undefined || spec.unchangedSince !== undefined)) {
        return fail(`${label2}（文件不存在：${spec.path}）`);
      }
      if (spec.changedSince !== undefined) {
        const before = vars[spec.changedSince];
        if (!before) return fail(`${label2}（未记录基线 ${spec.changedSince}）`);
        if (info?.isDir || before.isDir) return fail(`${label2}（${spec.path} ${DIR_SHA256_HINT}）`);
        const ok = !info ? false : before.sha256 !== info.sha256;
        return ok ? pass(label2, `${before.sha256} -> ${info.sha256}`) : fail(`${label2}（sha256 未变：${before.sha256}）`, `mtime=${info?.mtimeMs}`);
      }
      if (spec.unchangedSince !== undefined) {
        const before = vars[spec.unchangedSince];
        if (info?.isDir || before?.isDir) return fail(`${label2}（${spec.path} ${DIR_SHA256_HINT}）`);
        const ok = Boolean(info) && before && before.sha256 === info.sha256;
        return ok ? pass(label2, `仍为 ${info.sha256}`) : fail(`${label2}（内容已变：${before?.sha256} -> ${info?.sha256}）`);
      }
      if (spec.mtimeUnchangedSince !== undefined) {
        // mtime 逐字节口径的「没写过」判据（M195）：sha256 相同只说明内容没变，还可能存在
        // 「写了同一份内容」（内容不变而 mtime 推进）。D5 的「不落盘」要同时排掉这两种，
        // 因此保留一个与 unchangedSince 成对的 mtime 判据；精确相等（不是 +1 容差）——
        // 两次 stat 之间没有写入时 mtimeMs 完全相同。
        const before = vars[spec.mtimeUnchangedSince];
        if (!before) return fail(`${label2}（未记录基线 ${spec.mtimeUnchangedSince}）`);
        const ok = Boolean(info) && before.mtimeMs === info.mtimeMs;
        return ok
          ? pass(label2, `mtime 仍为 ${info.mtimeMs}`)
          : fail(`${label2}（mtime 已推进：${before.mtimeMs} -> ${info?.mtimeMs}）`);
      }
      if (spec.mtimeNewerThan !== undefined) {
        const base = vars[spec.mtimeNewerThan]?.mtimeMs ?? 0;
        const ok = Boolean(info) && info.mtimeMs > base + 1;
        return ok ? pass(label2, `mtime ${info?.mtimeMs} > ${base}`) : fail(`${label2}（mtime 未推进：${info?.mtimeMs} vs ${base}）`);
      }
      if (spec.has !== undefined) {
        const m = matcher(spec.has);
        if (!info) return fail(`${label2}（文件不存在：${spec.path}）`);
        // 目录没有内容这一说：读了会抛 EISDIR（M324 起路径读数认得目录，这里必须自己挡）。
        if (info.isDir) return fail(`${label2}（${spec.path} 是目录：内容类判据 has/not 只对文件成立）`);
        const text = await readText(file);
        return m.test(text) ? pass(label2) : fail(`${label2}（期望含 ${m.show}）`, JSON.stringify(text.slice(0, 300)));
      }
      if (spec.not !== undefined) {
        const m = matcher(spec.not);
        if (!info) return fail(`${label2}（文件不存在：${spec.path}）`);
        if (info.isDir) return fail(`${label2}（${spec.path} 是目录：内容类判据 has/not 只对文件成立）`);
        const text = await readText(file);
        return !m.test(text) ? pass(label2) : fail(`${label2}（期望不含 ${m.show}）`);
      }
      return fail(`${label2}（file 断言无法识别）`);
    }
    if (expect.glob) {
      // 崩溃备份、另存副本这类「文件名由 app 决定」的产物只能用 glob 断言。
      const spec = expect.glob;
      const dir = resolveSpecPath(spec.dir);
      const re = spec.pattern instanceof RegExp ? spec.pattern : new RegExp(spec.pattern);
      let hits = [];
      try {
        hits = (await readdir(dir, { recursive: true, withFileTypes: true }))
          .filter((e) => e.isFile())
          .map((e) => path.join(e.parentPath ?? e.path, e.name))
          .filter((f) => re.test(f));
      } catch {
        hits = [];
      }
      const ok = (spec.min === undefined || hits.length >= spec.min) && (spec.exact === undefined || hits.length === spec.exact);
      return ok
        ? pass(spec.label ?? label, `${hits.length} 个：${hits.slice(0, 3).map((f) => path.basename(f)).join(", ")}`)
        : fail(`${spec.label ?? label}（期望 ${spec.exact ?? `≥${spec.min}`} 个，实际 ${hits.length}）`, `${dir} 下无匹配 ${spec.pattern}`);
    }
    if (expect.window) {
      // 窗口几何断言（M236）：标题栏拖拽移动窗口、resizeWindow 调尺寸两类的判据。
      // moved 对比的是动作前的基线（boundsBefore，步骤执行 do 之前由 runScenario 记录）；
      // width 容差 ±8pt（窗口管理器可能钳制 / 取整，断言对生效值不对请求值）。
      const spec = expect.window;
      const ax = await readAx(cu, ctx.pid);
      const bounds = windowBounds(ax.text);
      if (!bounds) return fail(`${label}（读不到 window_bounds：AX 快照退化）`, "", ax);
      if (spec.moved !== undefined) {
        const before = state.boundsBefore;
        if (!before) return fail(`${label}（缺少动作前窗口位置基线——window.moved 断言的步骤必须有 do 动作）`, "", ax);
        const dx = bounds.x - before.x;
        const dy = bounds.y - before.y;
        const moved = Math.abs(dx) >= 8 || Math.abs(dy) >= 8;
        const detail = `(${before.x},${before.y}) → (${bounds.x},${bounds.y})，Δ=(${dx},${dy})`;
        return moved === Boolean(spec.moved)
          ? pass(label, detail)
          : fail(`${label}（期望 moved=${spec.moved}，实际 ${detail}）`, "", ax);
      }
      if (spec.width !== undefined) {
        const ok = Math.abs(bounds.w - spec.width) <= 8;
        return ok
          ? pass(label, `窗口宽 ${bounds.w} ≈ ${spec.width}`)
          : fail(`${label}（期望宽 ≈${spec.width}，实际 ${bounds.w}）`, "", ax);
      }
      return fail(`${label}（window 断言缺 moved/width）`, "", ax);
    }
    return fail(`${label}（未知断言形态）`, JSON.stringify(expect).slice(0, 200));
  }

  let result = null;
  try {
    if (scenario.fixtures) for (const f of scenario.fixtures) await copyFixture(f);
    // 场景 front-matter 的 `config:` **不在这里生效**：它由 run.mjs 在 `launchApp()` 之前
    // 折进隔离 config.json（M284）——早先在这里是「起一次 app → 写配置 → 重启」，每个声明
    // config 的场景都多付一次重启。折叠之后 app 的**首帧**就是场景声明的起点，语义更强
    // （与 backlog:366 的「窗口配置只有一份真源」同一取向）。
    if (scenario.open) {
      await openFile(cu, ctx.pid, scenario.open, { marker: scenario.marker });
      evidence.record({ kind: "note", text: `已打开 ${scenario.open}` });
    }

    for (const step of scenario.steps ?? []) {
      evidence.record({ kind: "step", name: step.name });
      const state = {};
      try {
        // window.moved 断言需要动作前的窗口位置基线（M236：标题栏拖拽移动窗口的判据）。
        if ((step.expect ?? []).some((e) => e.window?.moved !== undefined)) {
          state.boundsBefore = windowBounds((await readAx(cu, ctx.pid)).text);
        }
        await doAction(step, { ctx, scenario, vars, pid: () => ctx.pid, evidence, cu });
      } catch (e) {
        await fail(`[动作] ${step.name}`, e.message, await readAx(cu, ctx.pid).catch(() => null));
        continue;
      }
      for (const expect of step.expect ?? []) {
        await check(expect, state);
      }
    }
    if (scenario.teardown?.length) {
      for (const expect of scenario.teardown) await check(expect, {});
    }
  } catch (e) {
    // 场景级异常（打不开文件、app 未就绪等）不能吞：记成一条 FAIL 断言，保留已收集的证据。
    const ax = await readAx(cu, ctx.pid).catch(() => null);
    await fail(`[场景异常] ${e.message}`, String(e.stack ?? "").split("\n").slice(1, 3).join(" | "), ax);
  } finally {
    const fails = evidence.records.filter((r) => r.kind === "assert" && !r.ok);
    if (fails.length && /未取得|中途丢失/.test(ctx.foregroundNote ?? "")) {
      evidence.record({
        kind: "note",
        text:
          "⚠ 本次运行前台焦点未取得（或被中途抢走）：上述 FAIL 需先按 tower 纪律排除 " +
          "「frontmost-required 且未通过」这一可能，再判定为 app 缺陷。",
      });
    }
    // 注意：finally 里**不能 return**——那会吞掉 try 里抛出的异常，把异常场景误判成 PASS
    // （本套件实证过一次：openFile 超时被吞，证据目录只剩空 PASS）。
    const { status } = await evidence.finish();
    result = { status, records: evidence.records };
  }
  return result;
}

/** 键盘动作前复查前台；中途丢失（可能被别的窗口抢走）就尽力抢回并留痕。 */
async function noteIfFocusLost(ctx, pid) {
  if (frontmostPid() === pid) return;
  await tryForeground(ctx.cu, pid, { retries: 2 });
  ctx.foregroundNote =
    `键盘注入前复检：前台焦点中途丢失（已尽力抢回，前台 pid=${frontmostPid() ?? "未知"}）——` +
    "若后续键盘断言 FAIL，先按 tower 纪律排除 frontmost-required 因素再判 app 缺陷";
}

/** `do: settle` 的真实语义（M249）：**连续两次 AX 快照逐字节一致**才算界面已落定。
 *
 * 为什么改（finding 20260927-worker-watch-mkdir-improve-vaultwrite-ax-do-settle-60）：旧实现
 * 是单次 `readAx`，与动作名不符——写场景的人按名字理解成「等界面稳定」，于是
 * `vaultWrite` → 立刻 `settle` → AX 断言会与那次 DOM 刷新抢（实测：外部写入后紧跟的第一次读
 * 会漏掉新增的树行，先留一拍再读必过），并级联成「几十秒不刷新」的假缺陷（M245 已翻转）。
 *
 * 编辑器在位时直接复用 `drive.mjs` 的 `settle()`（同一口径的 canonical 实现）；不在位时走
 * `settleEditorless`——那两种合法终态里 `AXTextArea` 本就不存在，带编辑器门会白等满超时。
 * 超时一律**兜底**：退回最后一次读取 + 落一条 note，不把这步升级成动作 FAIL——settle 只是
 * 断言前的稳定等待，界面是否真的收敛由场景自己的断言证明（AX 里有持续微抖元素时把 settle
 * 判红会让本来正常的场景无故变红）。 */
async function settleAction(cu, pid, evidence) {
  const probe = await readAx(cu, pid);
  if (probe.textarea) {
    try {
      return await settle(cu, pid, { timeoutMs: SETTLE_TIMEOUT_MS });
    } catch (e) {
      if (!(e instanceof StepError)) throw e;
      evidence?.record({
        kind: "note",
        text:
          `do: settle：界面在 ${SETTLE_TIMEOUT_MS}ms 内没有连续两次一致的 AX 快照（${e.message}）——` +
          "已退回单次读取继续，本步不因此判 FAIL",
      });
      return readAx(cu, pid);
    }
  }
  return settleEditorless(cu, pid, evidence);
}

/** `do: settle` 在**没有编辑器节点**的合法终态下的等待（M249）。
 *
 * 两种终态（都是正观测，见 waitAppReady）：已装载 vault 但一个标签都没有（D107 引导层盖住
 * 正文，M163 起的启动常态）、未打开 vault 的空态。两者里 `AXTextArea` 都不存在，`drive.mjs`
 * 的 `settle()` 的编辑器门因此永远不成立。等待口径与它一致（连续两次 AX 快照逐字节相同），
 * 只是不带编辑器门；超时同样只落 note、不抛错。 */
async function settleEditorless(cu, pid, evidence) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let prev = await readAx(cu, pid);
  while (Date.now() < deadline) {
    await sleep(700);
    const ax = await readAx(cu, pid);
    if (prev.text === ax.text) return ax;
    prev = ax;
  }
  evidence?.record({
    kind: "note",
    text:
      `do: settle：界面（本步无编辑器节点）在 ${SETTLE_TIMEOUT_MS}ms 内没有连续两次一致的 AX 快照——` +
      "已退回最后一次读取继续，本步不因此判 FAIL",
  });
  return prev;
}

async function doAction(step, { ctx, cu, scenario, vars, pid, evidence }) {
  const p = pid();
  switch (step.do) {
    case undefined:
    case "none":
      return;
    case "settle":
      return settleAction(cu, p, evidence);
    case "waitFor": {
      // 轮询「某个状态成立」直到超时（M296）——**状态驱动**的等待，与 `settle` 分工不同：
      // `settle` 判的是「界面此刻静止」（连续两次 AX 快照逐字节一致），**不能**当「等一件异步
      // 活儿干完」用：change vault-open-ignore-set 把打开段移出 IPC 主线程之后，装载期间界面
      // 保持响应、快照逐字节不变 ⇒ `settle` 会在装载**途中**就返回（M296 首跑实测：它返回时
      // AX 里还是旧 vault 的标签栏 + 装载指示在场）。场景要「等装载完成 / 等某个按键生效」就得
      // 用本动作轮询一个**可观测的终态**。
      //
      // 判据形态与 `ax` 断言同源（`matcher()`：字符串按子串、`/…/` 按正则，正则带 `m` 标志）。
      // 命中不到就每 700ms 再读一次（一次 `readAx` 本身是秒级往返，实际采样间隔因此是秒级）；
      // 超时抛错 —— 如实判 FAIL，不静默放过。成立时把「第几次读取成立 / 耗时」记进证据。
      const spec = step.waitFor ?? {};
      const has = spec.has ?? [];
      const not = spec.not ?? [];
      // **运行期兜底**（M296 r2 评审 P2-3）：`--check` 会挡空清单，但 `run.mjs` 的正常执行路径
      // **不**复跑 `checkScenario`——只走 `--check` 的话，一份空清单能落到真机批里并**静默全过**
      // （第一轮读取即判成立）。这正是本套件最该挡的假绿形态，因此运行期与静态校验同口径 fail-loud
      // （与 `vaultSparse` 的运行时 size 复核同一惯例）。
      if (!has.length && !not.length) {
        throw new Error("do=waitFor 需要 waitFor.has / waitFor.not 至少一项非空（双空即恒真，不判任何东西）");
      }
      const timeoutMs = step.timeoutMs ?? 60_000;
      const deadline = Date.now() + timeoutMs;
      const startedAt = Date.now();
      for (let attempt = 1; ; attempt += 1) {
        const ax = await readAx(cu, p);
        const missing = has.filter((s) => !matcher(s).test(ax.text));
        const present = not.filter((s) => matcher(s).test(ax.text));
        if (missing.length === 0 && present.length === 0) {
          evidence.record({
            kind: "note",
            text: `do=waitFor 第 ${attempt} 次读取成立（用时 ${Date.now() - startedAt}ms）`,
          });
          return;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `do=waitFor 超时（${timeoutMs}ms / ${attempt} 次读取）：` +
              `${missing.length ? `仍缺 ${JSON.stringify(missing)}；` : ""}` +
              `${present.length ? `仍出现（要求不出现）${JSON.stringify(present)}；` : ""}` +
              "——若是装载类等待，先核错因是不是「等的是 settle 而不是状态」（本动作的注释）。",
          );
        }
        await sleep(700);
      }
    }
    case "sleep":
      return sleep(step.ms ?? 1000);
    case "key":
      await noteIfFocusLost(ctx, p);
      return pressKey(cu, p, step.key);
    case "keys": {
      // 回读/重试的判定边界（两条都满足才做，缺一不可）：
      //   1) 整串都是单个可打印字符——此时「注入的文本」有唯一语义（拼接起来的串），
      //      才有可判定的期望值；chord（⌘S/⌃N/escape）没有文本语义，且重试会重复触发
      //      副作用（⌘S 再存一次盘、⌃N 再挪一次光标），一律保持原路径；
      //   2) AX 里有可回读目标——编辑器取 AXTextArea.value，原生 input 取 AX value
      //      （目标怎么选见 keysTarget）。
      // 不满足就盲发 + 不重试（与加固前逐字一致）。
      await noteIfFocusLost(ctx, p);
      /** 注入通道自报的结果（失败诊断用：KimiCU 的 press_key 会报 occluded/ok 等字段）。 */
      const results = [];
      const inject = async () => {
        for (const k of step.keys) {
          results.push(await pressKey(cu, p, k));
          await sleep(step.gapMs ?? 250);
        }
      };
      const printable = step.keys.every((k) => PRINTABLE_KEY_RE.test(k));
      const target = printable ? keysTarget(await readAx(cu, p)) : null;
      if (!target) {
        if (printable) {
          evidence.record({
            kind: "note",
            text:
              `keys「${step.keys.join("")}」是可打印字符序列，但 AX 里没有可回读目标` +
              "（无 focused 节点、无 AXTextArea、无可读输入框）——本步只盲发、不重试",
          });
        }
        await inject();
        return;
      }

      // 判据沿用 M135 r3 的**出现次数**口径：注入前记 N，注入后要求恰为 N+1。
      // 只断言「目标串是子串」会让 partial landing 后重试拼接出的脏文本假绿。
      const want = step.keys.join("");
      const countOf = (t) => t.split(want).length - 1;
      const baselineValue = target.value;
      const baseline = countOf(baselineValue);
      const max = Math.min(step.retries ?? 3, 3);
      const reread = async () => {
        const t = keysTarget(await readAx(cu, p));
        if (!t || t.kind !== target.kind) {
          throw new Error(
            `keys 回读目标在注入过程中变了（期望 ${target.kind}，实际 ${t?.kind ?? "无可读目标"}）——` +
              "重试会打到别处，不重试，也不在不可观测的窗口里下结论",
          );
        }
        return t.value;
      };
      const classify = (v) => {
        const c = countOf(v);
        if (c === baseline + 1) return "landed";
        if (c > baseline + 1) return "duplicated";
        return v === baselineValue ? "unchanged" : "partial";
      };

      let attempt = 0;
      let lastValue = baselineValue;
      let verdict = "unchanged";
      for (attempt = 1; attempt <= max; attempt++) {
        await inject();
        await sleep(600);
        lastValue = await reread();
        verdict = classify(lastValue);
        if (verdict === "landed") break;
        // 再等一拍复读：DOM 落地与 AX 快照之间有时序，不能拿一次过早的读当结论。
        await sleep(700);
        lastValue = await reread();
        verdict = classify(lastValue);
        // 只有「目标字节完全没变」才允许再注入一次——整批丢键正是本重试要修的场景。
        // 值变了却没凑齐目标串（partial landing）绝不能重试：再注入整串会原地拼接
        // （如 "ndl" + "needle" → "ndlneedle"），而子串断言反而可能假绿。
        if (verdict !== "unchanged") break;
      }
      if (verdict === "duplicated") {
        throw new Error(
          `按键重复落地：目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}）——` +
            "疑似 partial landing 后重试拼接，目标文本已被破坏，不按 PASS 处理",
        );
      }
      if (verdict === "partial") {
        throw new Error(
          `按键部分落地：目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}），但目标内容已变——` +
            `不重试：再注入整串会拼出脏文本。${target.kind} 基线=${JSON.stringify(baselineValue.slice(0, 200))} ` +
            `现值=${JSON.stringify(lastValue.slice(0, 200))}`,
        );
      }
      if (verdict !== "landed") {
        const where =
          target.kind === "editor" || target.kind === "input"
            ? `${target.kind} 的内容每次注入前后逐字节一致（丢在注入链路，见 README 已知边界）`
            : `焦点不在文本目标上（focused=${target.kind}）：按键没有落进任何文档文本`;
        throw new Error(
          `按键未落地：${max} 次注入后目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}）；${where}；` +
            `工具返回 ${JSON.stringify(results.slice(-step.keys.length)).slice(0, 300)}`,
        );
      }
      if (attempt > 1) {
        evidence.record({
          kind: "note",
          text:
            `keys「${want}」第 ${attempt} 次注入才落地（前 ${attempt - 1} 次 ${target.kind} 内容逐字节未变；` +
            "已按出现次数校验确认无重复）",
        });
      }
      return;
    }
    case "type": {
      // KimiCU 的文本注入对 WKWebView 偶发不落地（返回 ok 但编辑器没变，M134 实证）。
      // 重试口径与 `keys` 一致（M143 对齐）——**只在目标字节完全未变时**再注入一次（≤3 次）；
      // 值变了却没凑齐目标串（partial landing）直接报错，不再注入：整串重试会原地拼到已落地的
      // 残段后面，而出现次数校验反而可能放行。
      //   判据：注入前记目标串出现 N 次，落地要求恰为 N+1；
      //   N+2 → 重复落地；次数不够 + 字节未变 → 未落地（可重试）；次数不够 + 字节已变 → partial（报错）。
      // 历史教训（M135 旧注释已删）：旧实现「次数 ≠ N+1 就重试」是假绿路径——真机例（M140 r1 复验）：
      // 搜索框先有 "n"，注入 "eedle" 只落地 "dl" 得 "ndl"，重试拼成 "ndleedle"，`eedle` 恰现 1 次
      // = N+1 即放行，而输入框已坏。旧注释举的 `MEM-` + `MEM-EDIT-2` → `MEM-MEM-EDIT-2` 记 2 次
      // 也是算错的：后者在该串里只出现 1 次（split 计数），那个例子本身就走在假绿路径上。
      const want = step.text;
      const countOf = (t) => (want ? t.split(want).length - 1 : 0);
      const first = await readAx(cu, p);
      if (!first.textarea) throw new Error("type 前无法确认编辑器可读：AX 快照里没有 AXTextArea");
      const baselineValue = first.editor ?? "";
      // clear=true 时注入会先清空编辑器，注入前的旧内容不参与计数，基线按 0 算。
      const baseline = step.clear ? 0 : countOf(baselineValue);
      const max = Math.min(step.retries ?? 3, 3);
      const reread = async () => {
        const ax = await readAx(cu, p);
        if (!ax.textarea) {
          throw new Error(
            "type 回读目标在注入过程中不可读了（AX 快照里没有 AXTextArea，modal 打开期间常见）——" +
              "不在不可观测的窗口里下结论",
          );
        }
        return ax.editor ?? "";
      };
      const classify = (v) => {
        const c = countOf(v);
        if (c === baseline + 1) return "landed";
        if (c > baseline + 1) return "duplicated";
        return v === baselineValue ? "unchanged" : "partial";
      };

      let attempt = 0;
      let res = null;
      let lastValue = baselineValue;
      let verdict = "unchanged";
      for (attempt = 1; attempt <= max; attempt++) {
        res = await typeInEditor(cu, p, want, { clear: step.clear });
        await sleep(800);
        lastValue = await reread();
        verdict = classify(lastValue);
        if (verdict === "landed") break;
        // 再等一拍复读：DOM 落地与 AX 快照之间有时序，不能拿一次过早的读当结论。
        await sleep(700);
        lastValue = await reread();
        verdict = classify(lastValue);
        if (verdict !== "unchanged") break;
      }
      if (verdict === "duplicated") {
        throw new Error(
          `注入重复落地：目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}）——` +
            "疑似 partial landing 后重试拼接，文档已被破坏，不按 PASS 处理",
        );
      }
      if (verdict === "partial") {
        throw new Error(
          `文本注入部分落地：目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}），但编辑器内容已变——` +
            `不重试：再注入整串会在残段后拼出脏文本。基线=${JSON.stringify(baselineValue.slice(0, 200))} ` +
            `现值=${JSON.stringify(lastValue.slice(0, 200))}`,
        );
      }
      if (verdict !== "landed") {
        throw new Error(
          `文本注入未落地：${max} 次注入后目标串「${want}」出现 ${countOf(lastValue)} 次（期望 ${baseline + 1}）；` +
            "编辑器内容每次注入前后逐字节一致（丢在注入链路，见 README 已知边界）；" +
            `工具返回 ${JSON.stringify(res ?? {}).slice(0, 200)}`,
        );
      }
      if (attempt > 1) {
        evidence.record({
          kind: "note",
          text:
            `type 注入第 ${attempt} 次才落地（前 ${attempt - 1} 次编辑器内容逐字节未变；` +
            "已按出现次数校验确认无重复）",
        });
      }
      return;
    }
    case "click": {
      const t = step.target ?? {};
      // `count` 两条路径都如实透传（M184 实测：坐标路径与 AX 索引路径在 WKWebView 里**都不
      // 产生** DOM 的 `dblclick`，见 README「已知边界」——要验双击类交互时别指望它）。
      // `button` 两条路径都透传（M244）：右键是上下文菜单唯一的真实入口，而 KimiCU 的
      // click 本来就支持 `button: right|middle`（lib/cu.mjs 的 click 早已带这个参数，
      // 之前只是场景层没把它接出来）。左键仍是默认值，未写 button 的行为一字不变。
      const button = t.button ? { button: t.button } : {};
      if (t.x !== undefined) {
        return cu.click(p, { x: t.x, y: t.y, ...button, ...(t.count ? { count: t.count } : {}) });
      }
      // 非左键且目标是**节点**时改走坐标路径（M244）：AX 索引路径发的是 AXPress——
      // 「按下这个元素」，产不出鼠标右键（DOM 的 `contextmenu` 靠真实指针事件）。
      // 因此需要一个带 bbox 的快照（full 才有截图坐标），在节点中心注入真实鼠标事件
      //（cursor-safe，不移动用户指针）。左键 / 未写 button 的行为一字不变。
      const pointerButton = t.button !== undefined && t.button !== "left";
      const ax = pointerButton ? await readAxWithScreenshot(cu, p) : await readAx(cu, p);
      const node =
        t.help !== undefined
          ? findByHelp(ax.nodes, { role: t.role, help: t.help, nth: t.nth ?? 0 })
          : t.any !== undefined
            ? findByAny(ax.nodes, { role: t.role, any: t.any, nth: t.nth ?? 0 })
            : findNode(ax.nodes, { role: t.role, name: t.name, nth: t.nth ?? 0 });
      if (!node) throw new Error(`找不到可点节点 ${JSON.stringify(t)}`);
      if (pointerButton) {
        if (!node.bbox) throw new Error(`节点没有 bbox，无法用 ${t.button} 键点击：${JSON.stringify(t)}`);
        const { x, y, w, h } = node.bbox;
        const px = x + w * (t.dx ?? 0.5);
        const py = y + h * (t.dy ?? 0.5);
        // 坐标必须落在窗口可视区内：树里的条目可能远在视口之外（AX 报的是内容坐标，
        // 例如 40 个 fixture 时靠后的行 y≈1300 而窗口高 800），此时注入坐标只会得到
        // KimiCU 的 `screenshot coordinate is outside the last get_app_state image`
        // ——那句错误看不出真实成因。这里提前给一句能指出下一步的话（M244 实测）。
        // 可视区上界取**截图像素**（与 px/py 同空间）：带图的 dump 里 `screenshot: 1152×768 px`
        // 才是坐标通道的边界，而 `window_bounds` 是屏幕点（1200×800）——两者混用会把
        // 1152–1200 那一条带算成「在视口内」，KimiCU 仍会拒绝该坐标。
        const shot = screenshotSize(ax.text);
        const bounds = windowBounds(ax.text);
        const vw = shot?.w ?? bounds?.w;
        const vh = shot?.h ?? bounds?.h;
        if (vw && vh && (px > vw || py > vh || px < 0 || py < 0)) {
          throw new Error(
            `${t.button} 键目标不在可视区内（节点 @${Math.round(px)},${Math.round(py)}，可视区 ${vw}×${vh}）：` +
              `请先用 open / 滚动把该行带进视口再右键（右键走真实指针事件，坐标必须在窗口内）`,
          );
        }
        return clickWithRetry(cu, p, px, py, { button: t.button });
      }
      return cu.click(p, { index: node.index, ...button, ...(t.count ? { count: t.count } : {}) });
    }
    case "clipboardRead": {
      const clip = readClipboard();
      if (!clip.ok) throw new Error(`读剪贴板失败：${clip.error}`);
      return clip.text;
    }
    case "clickNodeText": {
      const ax = await readAx(cu, p);
      const node = ax.nodes.find((n) => n.value === step.text || n.title === step.text);
      if (!node) throw new Error(`找不到节点文本 ${step.text}`);
      return cu.click(p, { index: node.index });
    }
    case "clickEditor": {
      // 编辑器内没有可点节点（AX 里正文节点无 bbox），只能按坐标点：
      // 取 AXTextArea 的 bbox（full 模式下的坐标即截图像素，与 click x/y 同空间），
      // 从顶边往下 dy 像素落点，再用 ⌃N 逐行下行定位——比猜行高可靠。
      const ax = await readAx(cu, p, { mode: "full" });
      const ta = ax.textarea;
      if (!ta?.bbox) throw new Error("编辑器节点没有 bbox，无法定位点击");
      const x = ta.bbox.x + (step.dx ?? 40);
      const y = ta.bbox.y + (step.dy ?? 6);
      return clickWithRetry(cu, p, x, y);
    }
    case "open":
      return openFile(cu, p, step.file, { marker: step.marker });
    case "configWrite": {
      const { readConfig, writeConfig } = await import("./app.mjs");
      const cur = await readConfig().catch(() => ({}));
      const next = {
        // lastVault 缺省沿用当前值（缺省行为与加固前逐字一致）；显式给 step.lastVault 才覆盖
        // ——启动恢复的失效路径要把它指向一个不存在的目录（M159 的 16-startup-restore）。
        lastVault: step.lastVault ?? cur.last_vault ?? (await import("./util.mjs")).vaultDir(),
        mode: cur.editor?.mode ?? "md",
        keys: step.keys !== undefined ? step.keys : cur.keys,
        // 排版三项（M195）：缺省**沿用当前值**，与 keys 同形——否则一次 configWrite 会把上一个
        // 场景／本场景前面设过的 font_size 悄悄抹掉（那正是「改了配置却没生效」最难查的形态）。
        // Enter 自动缩进（M272）：口径与 keys / 排版三项**完全同形**——缺省沿用当前值，
        // 否则一次 configWrite 会把前面设过的 auto_indent 悄悄抹回出厂 true
        //（「改了配置却没生效」里最难查的那一类：改的是 false，看起来是 true）。
        autoIndent: step.autoIndent !== undefined ? step.autoIndent : cur.editor?.auto_indent,
        fontFamily: step.fontFamily !== undefined ? step.fontFamily : cur.editor?.font_family,
        monoFontFamily: step.monoFontFamily !== undefined ? step.monoFontFamily : cur.editor?.mono_font_family,
        fontSize: step.fontSize !== undefined ? step.fontSize : cur.editor?.font_size,
        // 主题（M210）同理缺省**沿用当前值**：否则一次 configWrite 会把前面设过的 ui.theme
        // 连表一起抹掉（`ui` 不写 = 回落 light），归因成本最高的那种「改了配置却没生效」形态。
        theme: step.theme !== undefined ? step.theme : cur.ui?.theme,
        // 栏宽（M228）同形沿用：一次 configWrite MUST NOT 抹掉 `ui.content_width`。
        contentWidth: step.contentWidth !== undefined ? step.contentWidth : cur.ui?.content_width,
        // 界面语言（M282）同形沿用：一次 configWrite MUST NOT 抹掉 `ui.language`
        //（本场景的第一步就要把语言设成 zh，后续步骤若抹掉它，语言切换的起点就没了）。
        language: step.language !== undefined ? step.language : cur.ui?.language,
      };
      await writeConfig(next);
      // requireVault: false 只对本步的重启生效（该步期待「未打开空态」，就绪门里「树里有
      // .md 行」这一条必然不成立）；非重启场景照旧走严格门。
      if (step.restart !== false) await ctx.restartApp({ requireVault: step.requireVault !== false });
      return next;
    }
    case "clickInNode": {
      // 点「某个有 bbox 的节点内部」的相对位置：表格这类容器在 AX 里是有坐标的
      // （AXTable @x,y w×h），用它把光标送进指定 cell——比按行数数 ⌃N 稳。
      const ax = await readAx(cu, p, { mode: "full" }); // full 才有截图坐标，与 click x/y 同空间
      const target =
        step.target?.any !== undefined
          ? findByAny(ax.nodes, { role: step.target.role, any: step.target.any, nth: step.target.nth ?? 0 })
          : findNode(ax.nodes, { role: step.target?.role, name: step.target?.name, nth: step.target?.nth ?? 0 });
      if (!target?.bbox) throw new Error(`找不到带 bbox 的节点 ${JSON.stringify(step.target)}`);
      const { x, y, w, h } = target.bbox;
      const px = x + w * (step.dx ?? 0.5);
      const py = y + h * (step.dy ?? 0.5);
      // `count` 原样透传（实测在 WKWebView 里产生不出 DOM 的 `dblclick`，见 README「已知边界」）。
      return clickWithRetry(cu, p, px, py, step.count ? { count: step.count } : {});
    }
    case "doubleClick": {
      // 双击（M209）：KimiCU 的注入通道造不出 WKWebView 的 DOM `dblclick`（坐标 count:2 /
      // AXPress ×2 / 两次独立 click / drag_paths 都试过），唯一能造出来的是 swift + CGEvent
      // 显式设 `kCGMouseEventClickState`（判据与现场见 README「已知边界」的 dblclick 条）。
      //
      // 坐标换算要说清：swift 要的是 **Quartz 全局屏幕坐标**，而 KimiCU 的两种空间都不是它——
      // mode=full（clickInNode / shot 用的那个）给的是**截图像素**（实测 1152×768，是 1200 点的
      // 0.96 倍缩放），mode=ax 给的是**窗口局部点**。本动作走 `readAx`（mode=ax）+ `windowBounds`
      // 的原点相加；混用会让点击落到别处（本 mission 第一轮就踩过：把窗口局部坐标当屏幕坐标，
      // 整轮探针跑成了假现场）。因此这里**核 header**：拿不到窗口局部口径就直接报错，不猜。
      //
      // 还必须先拿前台：真鼠标点击落在**该点最上层的那扇窗**上，目标窗口被别的应用盖住时点击
      // 会打到别人身上（表现为「遮罩不出现」这类与产品无关的假红）。KimiCU 的键盘注入可以后台
      // 走，这条通道不行。
      const fg = await tryForeground(cu, p, { retries: step.retries ?? 4 });
      if (!fg.frontmost) {
        throw new Error(
          `doubleClick 需要目标窗口在前台（当前前台 pid=${fg.frontPid ?? "未知"}）：真鼠标点击会落到最上层那扇窗上，` +
            `此时点击不会到达 Lumir。跑双击类场景时目标窗口需可见且未被别的应用盖住。`,
        );
      }
      const ax = await readAxForScreenPoint(cu, p);
      const bounds = windowBounds(ax.text);
      let local;
      if (step.target?.x !== undefined) {
        local = { x: step.target.x, y: step.target.y };
      } else {
        const node =
          step.target?.any !== undefined
            ? findByAny(ax.nodes, { role: step.target.role, any: step.target.any, nth: step.target.nth ?? 0 })
            : findNode(ax.nodes, { role: step.target?.role, name: step.target?.name ?? step.target?.text, nth: step.target?.nth ?? 0 });
        if (!node?.bbox) throw new Error(`doubleClick：找不到带 bbox 的节点 ${JSON.stringify(step.target)}`);
        local = { x: node.bbox.x + node.bbox.w * (step.dx ?? 0.5), y: node.bbox.y + node.bbox.h * (step.dy ?? 0.5) };
      }
      const point = { x: bounds.x + local.x, y: bounds.y + local.y };
      if (point.x < bounds.x || point.x > bounds.x + bounds.w || point.y < bounds.y || point.y > bounds.y + bounds.h) {
        throw new Error(`doubleClick：算出的屏幕点 ${JSON.stringify(point)} 落在窗口 (${bounds.x},${bounds.y} ${bounds.w}×${bounds.h}) 之外`);
      }
      const out = await injectClickWithClickState(p, point, { mode: step.mode ?? 2 });
      await sleep(step.settleMs ?? 900); // 双击到前端处理完（遮罩建 DOM、标签栏重绘）之间有一拍
      return `窗口局部 ${Math.round(local.x)},${Math.round(local.y)} → 屏幕 ${Math.round(point.x)},${Math.round(point.y)}｜${out}`;
    }
    case "drag": {
      // 拖拽（M228，content-width-drag）：栏宽手柄这类「只能拖」的控件没有点击语义。KimiCU 的
      // drag 工具在 WKWebView 里**不产生 DOM 拖拽**（实测：对手柄与对正文文本各试一次，连文本
      // 选择都造不出来——与 dblclick 同一类注入边界），因此走 doubleClick 同一条
      // swift + CGEvent 通道（mode 5：down → 插值 dragged → up），坐标换算也完全同口径：
      // 先拿前台（真鼠标拖拽落在最上层那扇窗），再把窗口局部点换算成 Quartz 屏幕坐标。
      //
      // target 两种形态（窗口局部点空间，mode=ax 的 bbox）：
      //   1. `{role,name|any,nth}`：节点 bbox 中心（target.dx0/dy0 给 0..1 偏移）；
      //   2. `{textareaEdge: "left"|"right"}`：编辑器列缘——WKWebView 把 role=separator 暴露成
      //      **无 bbox 的 AXSplitter**（M228 实测：节点在树里、名字对，frame 为空），手柄节点
      //      定位不可用；AXTextArea 的 bbox 即 `.cm-content` 的 border box（手柄命中区贴其左右缘
      //      ±5px），从列缘内侧 2px、中高处起拖等价于抓住手柄。
      const fg = await tryForeground(cu, p, { retries: step.retries ?? 4 });
      if (!fg.frontmost) {
        throw new Error(
          `drag 需要目标窗口在前台（当前前台 pid=${fg.frontPid ?? "未知"}）：真鼠标拖拽会落到最上层那扇窗上，` +
            `此时拖拽不会到达 Lumir。跑拖拽类场景时目标窗口需可见且未被别的应用盖住。`,
        );
      }
      const ax = await readAxForScreenPoint(cu, p);
      const bounds = windowBounds(ax.text);
      const t = step.target ?? {};
      let local;
      if (t.x !== undefined) {
        // 窗口局部坐标直给（M236：标题栏标识块这类不一定有 AX bbox 的展示元素）
        local = { x: t.x, y: t.y };
      } else if (t.textareaEdge !== undefined) {
        const ta = ax.textarea;
        if (!ta?.bbox) throw new Error("drag(textareaEdge)：编辑器节点没有 bbox，无法定位列缘");
        local = {
          x: t.textareaEdge === "left" ? ta.bbox.x + 2 : ta.bbox.x + ta.bbox.w - 2,
          y: ta.bbox.y + ta.bbox.h / 2,
        };
      } else {
        const node =
          t.any !== undefined
            ? findByAny(ax.nodes, { role: t.role, any: t.any, nth: t.nth ?? 0 })
            : findNode(ax.nodes, { role: t.role, name: t.name, nth: t.nth ?? 0 });
        if (!node?.bbox) throw new Error(`drag：找不到带 bbox 的节点 ${JSON.stringify(t)}`);
        local = { x: node.bbox.x + node.bbox.w * (t.dx0 ?? 0.5), y: node.bbox.y + node.bbox.h * (t.dy0 ?? 0.5) };
      }
      const from = { x: bounds.x + local.x, y: bounds.y + local.y };
      const to = { x: from.x + (step.dx ?? 0), y: from.y + (step.dy ?? 0) };
      // 越界检查默认开着（防坐标空间错乱假现场）；拖标题栏移动窗口时终点**故意**出窗
      // （窗口跟着光标走），这种步骤显式写 allowOutOfBounds: true 跳过终点检查。
      const checkPoints = step.allowOutOfBounds === true ? [from] : [from, to];
      for (const pt of checkPoints) {
        if (pt.x < bounds.x || pt.x > bounds.x + bounds.w || pt.y < bounds.y || pt.y > bounds.y + bounds.h) {
          throw new Error(`drag：算出的屏幕点 ${JSON.stringify(pt)} 落在窗口 (${bounds.x},${bounds.y} ${bounds.w}×${bounds.h}) 之外`);
        }
      }
      const out = await injectDrag(from, to);
      await sleep(step.settleMs ?? 500); // 松手后的提交（rAF 末帧 + 写盘）之间有一拍
      return `窗口局部 ${Math.round(local.x)},${Math.round(local.y)} → +${step.dx ?? 0},${step.dy ?? 0}｜${out}`;
    }
    case "resizeWindow": {
      // AX 直写窗口尺寸（M236，窄窗退让的真机验证）：确定值通道。高度缺省保持当前。
      const ax = await readAx(cu, p);
      const bounds = windowBounds(ax.text);
      if (!bounds) throw new Error("resizeWindow：读不到 window_bounds（AX 快照退化）");
      const out = await resizeWindowAX(p, step.width, step.height ?? bounds.h);
      await sleep(step.settleMs ?? 500); // matchMedia change → DOM 显隐切换有一拍
      return out;
    }
    case "record": {
      // 路径口径与 file 断言同源（M180）：`env:` 前缀此前不被识别，记出来的是一个不存在的
      // 路径、基线成 null——`unchangedSince` 于是报「内容已变：undefined -> …」（方向是安全的
      // 假红），但同一个 null 基线在 `mtimeNewerThan` 那边会退化成「0 基线」的假绿。统一走
      // resolveSpecPath：`env:` 前缀、绝对路径与 vault 相对路径三种写法都按 file 断言的口径解析。
      // 路径解析与 file 断言**同源**（走 resolveSpecFile，含 glob）：M272 实测到的一条静默坑——
      // `resolveSpecPath` 不展开 glob，诊断日志这类「文件名由 app 决定」的产物会记成 null 基线，
      // 而 `mtimeNewerThan` 的 null 基线会退化成「0 基线」（README 已记过这条假绿形态），
      // 其余 `*Since` 则报「未记录基线」。这里两条一起堵：支持 glob 取 mtime 最新一份，
      // 且目标不存在即报错（不把「读不到」记成 null）。
      const file = await resolveSpecFile(step.file);
      const info = await fileInfo(file);
      if (!info) {
        throw new Error(`记录基线失败：${step.file} 不存在（基线记成 null 会让配对断言退化）`);
      }
      vars[step.as ?? step.name] = info;
      return info;
    }
    case "recordEditor": {
      // 记录编辑器文本，供 editor.unchangedSince 做逐字节比较（负向匹配不够强）。
      // 编辑器节点不在 AX 快照里时**报错**，不许存成空串基线——否则后面对比 "" === "" 会假绿
      // （实证：⌘/ 面板打开期间 AX 里没有 AXTextArea）。
      const ax = await readAx(cu, p);
      if (!ax.textarea) {
        throw new Error("记录编辑器基线失败：AX 快照里没有 AXTextArea（modal 打开期间常见），基线不能记成空串");
      }
      vars[step.as] = ax.editor ?? "";
      return `${(ax.editor ?? "").length} 字节`;
    }
    case "vaultRm": {
      const files = step.files ?? [step.file];
      const removed = [];
      for (const f of files) {
        const target = path.isAbsolute(f) ? f : path.join(vaultDir(), f);
        await rm(target, { force: false }); // 真删除；不存在则报错，避免「删了个寂寞」还当成功
        removed.push(path.basename(target));
      }
      return removed.join(", ");
    }
    case "focusWindow": {
      const fg = await tryForeground(cu, p, { retries: step.retries ?? 2 });
      vars.__foreground = fg;
      return fg.frontmost ? "前台已取得" : `前台未取得（前台 pid=${fg.frontPid ?? "未知"}），走 KimiCU 后台注入路径`;
    }
    case "vaultWrite": {
      const file = path.join(vaultDir(), step.file);
      await mkdirp(path.dirname(file)); // 嵌套路径（M221 场景 36 起）：目录行的 chevron 对齐需要真目录
      await writeFile(file, step.content ?? "");
      return file;
    }
    case "vaultAppend": {
      const file = path.join(vaultDir(), step.file);
      await appendFile(file, step.content ?? "");
      return file;
    }
    case "vaultSparse": {
      // 稀疏文件（M241，editable-non-md-files 场景 42）：`ftruncate` 出一个「大小 = size
      // 字节、内容为零、几乎不占磁盘」的文件。用途只有一个——把 app 的**按大小拒绝**
      // 分支（`ATTACHMENT_MAX_BYTES` 50MB）在真机上变成可达：提交一份 50MB+ 的实体
      // fixture 不可接受，`vaultWrite` 的 content 是字符串也造不出来。
      // `step.size` 是**大小**（字节，必须 > 0）；文件若已存在会被截断到该大小（幂等）。
      // `step.vault: "second"` 指定第二个合成 vault（M283 场景 60 需要给**切换目标**撑窗口
      // ——指示那条断言追的是「切到目标 vault 的装载窗口」，放大器必须落在目标一侧）；
      // 缺省仍是验收 vault（既有场景逐字不变）。
      const file = path.join(step.vault === "second" ? secondVaultDir() : vaultDir(), step.file);
      if (!Number.isInteger(step.size) || step.size <= 0) {
        throw new Error(`do=vaultSparse 需要正整数 size（字节），收到 ${JSON.stringify(step.size)}`);
      }
      await mkdirp(path.dirname(file));
      const handle = await open(file, "w");
      try {
        await handle.truncate(step.size);
      } finally {
        await handle.close();
      }
      return `${file}（${step.size} 字节，稀疏）`;
    }
    case "restart":
      await ctx.restartApp({ requireVault: step.requireVault !== false });
      if (ctx.foregroundNote) evidence.record({ kind: "note", text: ctx.foregroundNote });
      return;
    default:
      throw new Error(`未知动作 do=${step.do}`);
  }
}

/** 坐标注入（`click` 的非左键路径）要的那份快照：**带截图的 mode=full**。
 *
 *  为什么不复用 `readAxForScreenPoint`（mode=ax）：KimiCU 的 `click` x,y 是**截图像素**，且它要求
 *  「最后一次 `get_app_state` 带图」——而 mode=ax 的快照按设计不带图（header 自述
 *  `screenshot: none — no image attached`）。旧实现用 mode=ax 找 bbox、又要求 `ax.image` 在场，
 *  于是 `button: right` 的节点路径**必然**走到 `取不到窗口截图` 那条错因（M244 / M249 / M251 /
 *  M252 / M254 同族；M256 的 47 / 50 整段 FAIL 即此）。mode=full 的 bbox 本来就是截图像素口径
 *  （header 自述 `bbox @x,y w×h and click/scroll/drag x,y are screenshot pixels`），一份快照同时
 *  满足「有图」与「坐标同空间」两件事。
 *
 *  截图偶发缺席（KimiCU 服务退化，README「已知边界」）时重试几拍再判死；判死时如实报通道取不到图，
 *  不静默换一个坐标空间去点。 */
async function readAxWithScreenshot(cu, pid, { retries = 3 } = {}) {
  let last = null;
  for (let i = 0; i < retries; i++) {
    const ax = await readAx(cu, pid, { mode: "full" });
    last = ax;
    if (ax.image && screenshotSize(ax.text)) return ax;
    await sleep(700);
  }
  throw new Error(
    `取不到窗口截图，无法用坐标注入点击（连试 ${retries} 次 mode=full 都无图，末次 element_count=` +
      `${last?.nodes.length ?? 0}）——KimiCU 的截图通道退化，见 README「已知边界」的「AX 快照可能退化」条` +
      `（处理办法是重启 KimiCU 服务，不是改场景）`,
  );
}

/** 截图尺寸（header 的 `screenshot: 1152×768 px`）：坐标注入通道的可视区上界，与 bbox 同一空间。
 *  无图时 header 写的是 `screenshot: none — …`，解析不到即 null（调用方退到 window_bounds）。 */
function screenshotSize(axText) {
  const m = /screenshot:\s*(\d+)×(\d+)\s*px/.exec(axText);
  return m ? { w: +m[1], h: +m[2] } : null;
}

/** `doubleClick` 用的 AX 读数：必须是**窗口局部坐标口径**（mode=ax，带 window_bounds）。
 *
 *  两种拒绝情形分开报，别混成一句「找不到口径」：
 *  - KimiCU 的 AX 服务退化——实测会返回只剩菜单栏的树（`element_count` 十几个、没有
 *    `window_bounds`）。README「已知边界」记了这条，处理办法是重启 KimiCU 服务，不是改场景；
 *  - 口径变了——`mode=full`（截图像素）与 `mode=ax`（窗口局部点）混用会让点击落到别处，
 *    宁可报错也不猜。
 *  退化是偶发的，所以先重试几拍再判死。 */
async function readAxForScreenPoint(cu, pid, { retries = 3 } = {}) {
  let last = null;
  for (let i = 0; i < retries; i++) {
    const ax = await readAx(cu, pid);
    last = ax;
    if (/window-local/.test(ax.text) && windowBounds(ax.text)) return ax;
    await sleep(700);
  }
  const bounds = last ? windowBounds(last.text) : null;
  if (!bounds) {
    throw new Error(
      "doubleClick 拿不到窗口坐标：AX 快照退化（只剩菜单栏/无 window_bounds）——KimiCU 的 AX 服务需要重启" +
        "（README「已知边界」的「AX 快照可能退化」条），不是产品问题",
    );
  }
  throw new Error("doubleClick 需要 mode=ax 的窗口局部坐标口径（AX dump 的 header 里应有 window-local 说明），本次口径不是它");
}

function describeExpect(expect) {
  if (expect.ax) {
    const s = expect.ax;
    return `AX ${
      s.has !== undefined
        ? `含 ${matcher(s.has).show}`
        : s.not !== undefined
          ? `不含 ${matcher(s.not).show}`
          : s.focused !== undefined
            ? `焦点在 ${matcher(s.focused).show}`
            : JSON.stringify(s)
    }`;
  }
  if (expect.editor) return `编辑器 ${expect.editor.has !== undefined ? `含 ${matcher(expect.editor.has).show}` : `不含 ${matcher(expect.editor.not).show}`}`;
  if (expect.file) return `文件 ${expect.file.path} ${JSON.stringify(Object.keys(expect.file).filter((k) => k !== "path" && k !== "label"))}`;
  if (expect.window) return `窗口 ${JSON.stringify(expect.window)}`;
  if (expect.pixel) {
    const n = (expect.pixel.same?.length ?? 0) + (expect.pixel.differ?.length ?? 0) + (expect.pixel.contrast?.length ?? 0);
    return `像素底色（${n} 组采样点）`;
  }
  if (expect.shot) return `截图证据 ${expect.shot}`;
  return JSON.stringify(expect).slice(0, 80);
}

function tailAround(text, n = 20) {
  return text.split("\n").filter((l) => l.trim().startsWith("-")).slice(0, n).join("\n").slice(0, 1500);
}
