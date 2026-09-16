// 场景执行器：把场景文件里的步骤与断言跑成 PASS/FAIL，并留下证据。
//
// 场景格式（design: docs/process/real-machine-acceptance.md「形态」）用 YAML front-matter +
// 人读正文；一个验收项一个文件。步骤是动作，`expect` 是断言列表，逐条独立记结果——
// 一条断言失败不阻断后续步骤，好让一次运行把该场景的问题一次暴露齐。
import { createHash } from "node:crypto";
import { readFile, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { findNode } from "./ax.mjs";
import { copyFixture, readConfig, writeConfig } from "./app.mjs";
import { clickNode, openFile, pressKey, readAx, typeInEditor, waitUntil } from "./drive.mjs";
import { envHome, readText, sleep, vaultDir } from "./util.mjs";

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
 * 坐标点击 + 重试：KimiCU 用「最近一次 get_app_state 的截图」校验坐标是否在图内，
 * 两次读之间窗口尺寸/位置变了就会被判越界（实测偶发）。重试时重新取一张图即可。
 */
async function clickWithRetry(cu, pid, x, y, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await cu.click(pid, { x, y });
    } catch (e) {
      lastErr = e;
      await cu.state(pid, { mode: "full" });
      await sleep(400);
    }
  }
  throw lastErr;
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
      const shot = await readAx(cu, ctx.pid, { mode: "full" });
      const f = shot.image ? await evidence.saveShot(shot.image, expect.shot === true ? label : expect.shot) : null;
      const ok = Boolean(shot.image);
      await evidence.saveAx(shot.text, expect.shot === true ? label : expect.shot);
      return ok ? pass(label, f && `证据：shots/${path.basename(f)}`) : fail(label, "截图未取到");
    }
    if (expect.ax) {
      const ax = state.ax ?? (await readAx(cu, ctx.pid));
      state.ax = ax;
      const spec = expect.ax;
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
      return fail(`${label}（ax 断言缺少 has/not/count）`, "", ax);
    }
    if (expect.editor) {
      const spec = expect.editor;
      const text = (state.ax ?? (await readAx(cu, ctx.pid))).editor ?? "";
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
      const file = resolveSpecPath(spec.path);
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
    return fail(`${label}（未知断言形态）`, JSON.stringify(expect).slice(0, 200));
  }

  let result = null;
  try {
    if (scenario.fixtures) for (const f of scenario.fixtures) await copyFixture(f);
    if (scenario.config) {
      await writeConfig({ mode: "md", keys: scenario.config.keys });
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
    // 注意：finally 里**不能 return**——那会吞掉 try 里抛出的异常，把异常场景误判成 PASS
    // （本套件实证过一次：openFile 超时被吞，证据目录只剩空 PASS）。
    const { status } = await evidence.finish();
    result = { status, records: evidence.records };
  }
  return result;
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
      return pressKey(cu, p, step.key);
    case "keys": {
      for (const k of step.keys) {
        await pressKey(cu, p, k);
        await sleep(step.gapMs ?? 250);
      }
      return;
    }
    case "type":
      return typeInEditor(cu, p, step.text, { clear: step.clear });
    case "click": {
      const t = step.target ?? {};
      if (t.x !== undefined) return cu.click(p, { x: t.x, y: t.y });
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
        lastVault: cur.last_vault ?? (await import("./util.mjs")).vaultDir(),
        mode: cur.editor?.mode ?? "md",
        keys: step.keys !== undefined ? step.keys : cur.keys,
      };
      await writeConfig(next);
      if (step.restart !== false) await ctx.restartApp();
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
      return clickWithRetry(cu, p, px, py);
    }
    case "record": {
      const file = path.isAbsolute(step.file) ? step.file : path.join(vaultDir(), step.file);
      vars[step.as ?? step.name] = await fileInfo(file);
      return vars[step.as ?? step.name];
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
      await ctx.restartApp();
      return;
    default:
      throw new Error(`未知动作 do=${step.do}`);
  }
}

function describeExpect(expect) {
  if (expect.ax) {
    const s = expect.ax;
    return `AX ${s.has !== undefined ? `含 ${matcher(s.has).show}` : s.not !== undefined ? `不含 ${matcher(s.not).show}` : JSON.stringify(s)}`;
  }
  if (expect.editor) return `编辑器 ${expect.editor.has !== undefined ? `含 ${matcher(expect.editor.has).show}` : `不含 ${matcher(expect.editor.not).show}`}`;
  if (expect.file) return `文件 ${expect.file.path} ${JSON.stringify(Object.keys(expect.file).filter((k) => k !== "path" && k !== "label"))}`;
  if (expect.shot) return `截图证据 ${expect.shot}`;
  return JSON.stringify(expect).slice(0, 80);
}

function tailAround(text, n = 20) {
  return text.split("\n").filter((l) => l.trim().startsWith("-")).slice(0, n).join("\n").slice(0, 1500);
}
