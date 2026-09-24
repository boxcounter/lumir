// 场景执行器：把场景文件里的步骤与断言跑成 PASS/FAIL，并留下证据。
//
// 场景格式（design: docs/process/real-machine-acceptance.md「形态」）用 YAML front-matter +
// 人读正文；一个验收项一个文件。步骤是动作，`expect` 是断言列表，逐条独立记结果——
// 一条断言失败不阻断后续步骤，好让一次运行把该场景的问题一次暴露齐。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { findNode, windowBounds } from "./ax.mjs";
import { copyFixture, readConfig, writeConfig } from "./app.mjs";
import {
  clickNode,
  frontmostPid,
  injectClickWithClickState,
  openFile,
  pressKey,
  readAx,
  tryForeground,
  typeInEditor,
  waitUntil,
} from "./drive.mjs";
import { envHome, readText, sleep, vaultDir } from "./util.mjs";

/** 动作与断言的白名单：`--check` 用它做静态校验，避免写错 key 要等一整轮真机才发现。 */
export const ACTIONS = new Set([
  "settle", "sleep", "key", "keys", "type", "click", "clickNodeText", "clickInNode", "clickEditor",
  "doubleClick", "focusWindow", "open", "configWrite", "restart", "record", "recordEditor", "vaultWrite",
  "vaultAppend", "vaultRm",
]);
export const EXPECT_KINDS = new Set(["ax", "editor", "file", "glob", "shot"]);

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
  for (const [i, step] of (scenario.steps ?? []).entries()) {
    const at = `steps[${i}]${step.name ? `(${step.name})` : ""}`;
    if (!step.name) push(`${at} 缺少 name`);
    if (step.do !== undefined && !ACTIONS.has(step.do)) push(`${at} 未知动作 do=${step.do}`);
    if (step.do === "keys" && !Array.isArray(step.keys)) push(`${at} do=keys 需要 keys 数组`);
    if (step.do === "key" && !step.key) push(`${at} do=key 需要 key`);
    if (step.do === "doubleClick" && !step.target) push(`${at} do=doubleClick 需要 target（节点或 {x,y} 窗口局部坐标）`);
    for (const [j, exp] of (step.expect ?? []).entries()) {
      const kinds = Object.keys(exp).filter((k) => k !== "label");
      if (kinds.length !== 1) push(`${at} expect[${j}] 应恰好一个断言形态，实际 ${JSON.stringify(kinds)}`);
      else if (!EXPECT_KINDS.has(kinds[0])) push(`${at} expect[${j}] 未知断言 ${kinds[0]}`);
      else if (kinds[0] === "file" && !exp.file.path) push(`${at} expect[${j}] file 断言缺 path`);
      else if (kinds[0] === "glob" && (!exp.glob.dir || !exp.glob.pattern)) push(`${at} expect[${j}] glob 断言缺 dir/pattern`);
      else if (kinds[0] === "ax" && !["has", "not", "count", "focused"].some((k) => exp.ax[k] !== undefined))
        push(`${at} expect[${j}] ax 断言缺 has/not/count/focused（写错字段名会静默变成恒真断言）`);
    }
  }
  return problems;
}

export async function loadScenario(file) {
  const raw = await readText(file);
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`场景文件缺少 YAML front-matter：${file}`);
  const meta = yaml.load(m[1]);
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
async function clickWithRetry(cu, pid, x, y, { retries = 3, count } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await cu.click(pid, { x, y, count });
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

async function fileInfo(file) {
  try {
    const st = await stat(file);
    return { sha256: await sha256(file), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

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
          ? pass(label2, info ? `${spec.path} 存在` : `${spec.path} 不存在`)
          : fail(`${label2}（期望 exists=${spec.exists}，实际 ${Boolean(info)}）`);
      }
      if (!info && (spec.has !== undefined || spec.not !== undefined || spec.changedSince !== undefined || spec.unchangedSince !== undefined)) {
        return fail(`${label2}（文件不存在：${spec.path}）`);
      }
      if (spec.changedSince !== undefined) {
        const before = vars[spec.changedSince];
        if (!before) return fail(`${label2}（未记录基线 ${spec.changedSince}）`);
        const ok = !info ? false : before.sha256 !== info.sha256;
        return ok ? pass(label2, `${before.sha256} -> ${info.sha256}`) : fail(`${label2}（sha256 未变：${before.sha256}）`, `mtime=${info?.mtimeMs}`);
      }
      if (spec.unchangedSince !== undefined) {
        const before = vars[spec.unchangedSince];
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
        const text = await readText(file);
        return m.test(text) ? pass(label2) : fail(`${label2}（期望含 ${m.show}）`, JSON.stringify(text.slice(0, 300)));
      }
      if (spec.not !== undefined) {
        const m = matcher(spec.not);
        if (!info) return fail(`${label2}（文件不存在：${spec.path}）`);
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
    return fail(`${label}（未知断言形态）`, JSON.stringify(expect).slice(0, 200));
  }

  let result = null;
  try {
    if (scenario.fixtures) for (const f of scenario.fixtures) await copyFixture(f);
    if (scenario.config) {
      // 排版三项（M195）与 [keys] 同形：传了才写，缺省即出厂口径
      await writeConfig({
        mode: "md",
        keys: scenario.config.keys,
        fontFamily: scenario.config.fontFamily,
        monoFontFamily: scenario.config.monoFontFamily,
        fontSize: scenario.config.fontSize,
      });
      await ctx.restartApp();
    }
    if (scenario.open) {
      await openFile(cu, ctx.pid, scenario.open, { marker: scenario.marker });
      evidence.record({ kind: "note", text: `已打开 ${scenario.open}` });
    }

    for (const step of scenario.steps ?? []) {
      evidence.record({ kind: "step", name: step.name });
      const state = {};
      try {
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

async function doAction(step, { ctx, cu, scenario, vars, pid, evidence }) {
  const p = pid();
  switch (step.do) {
    case undefined:
    case "none":
      return;
    case "settle":
      return readAx(cu, p);
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
      if (t.x !== undefined) return cu.click(p, { x: t.x, y: t.y, ...(t.count ? { count: t.count } : {}) });
      const ax = await readAx(cu, p);
      const node =
        t.help !== undefined
          ? findByHelp(ax.nodes, { role: t.role, help: t.help, nth: t.nth ?? 0 })
          : t.any !== undefined
            ? findByAny(ax.nodes, { role: t.role, any: t.any, nth: t.nth ?? 0 })
            : findNode(ax.nodes, { role: t.role, name: t.name, nth: t.nth ?? 0 });
      if (!node) throw new Error(`找不到可点节点 ${JSON.stringify(t)}`);
      return cu.click(p, { index: node.index, ...(t.count ? { count: t.count } : {}) });
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
        fontFamily: step.fontFamily !== undefined ? step.fontFamily : cur.editor?.font_family,
        monoFontFamily: step.monoFontFamily !== undefined ? step.monoFontFamily : cur.editor?.mono_font_family,
        fontSize: step.fontSize !== undefined ? step.fontSize : cur.editor?.font_size,
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
    case "record": {
      // 路径口径与 file 断言同源（M180）：`env:` 前缀此前不被识别，记出来的是一个不存在的
      // 路径、基线成 null——`unchangedSince` 于是报「内容已变：undefined -> …」（方向是安全的
      // 假红），但同一个 null 基线在 `mtimeNewerThan` 那边会退化成「0 基线」的假绿。统一走
      // resolveSpecPath：`env:` 前缀、绝对路径与 vault 相对路径三种写法都按 file 断言的口径解析。
      const file = resolveSpecPath(step.file);
      vars[step.as ?? step.name] = await fileInfo(file);
      return vars[step.as ?? step.name];
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
      await writeFile(file, step.content ?? "");
      return file;
    }
    case "vaultAppend": {
      const file = path.join(vaultDir(), step.file);
      await appendFile(file, step.content ?? "");
      return file;
    }
    case "restart":
      await ctx.restartApp({ requireVault: step.requireVault !== false });
      if (ctx.foregroundNote) evidence.record({ kind: "note", text: ctx.foregroundNote });
      return;
    default:
      throw new Error(`未知动作 do=${step.do}`);
  }
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
  if (expect.shot) return `截图证据 ${expect.shot}`;
  return JSON.stringify(expect).slice(0, 80);
}

function tailAround(text, n = 20) {
  return text.split("\n").filter((l) => l.trim().startsWith("-")).slice(0, n).join("\n").slice(0, 1500);
}
