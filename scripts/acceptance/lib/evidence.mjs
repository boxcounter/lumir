// 证据落盘。
//
// 约定（与 docs/process/real-machine-acceptance.md 裁决点 1 一致）：全部产物落
// test-results/acceptance/<日期>/，**不入 git**（与 perf-results 同惯例）；Alex 抽审靠本地目录。
// 每场景一个目录：status.txt（PASS/FAIL）+ steps.md（逐步骤逐断言）+ shots/ + ax/。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdirp, rmrf } from "./util.mjs";

export class Evidence {
  constructor(root) {
    this.root = root;
    this.scenarioDir = null;
    this.scenarioId = null;
    this.records = [];
    this.shotSeq = 0;
    this.axSeq = 0;
    /** 显式终态（M379）：`INVALID` = 本次运行无效（基建错误，见 util.mjs 的 InfraError）。
     *  设了它就**压过**按失败项推出来的 PASS/FAIL——`status.txt` 是复盘时区分「产品判红」与
     *  「这次白跑」的唯一机器可读入口（backlog M281 条要求两者分开表达）。 */
    this.statusOverride = null;
  }

  /**
   * 场景证据目录**整目录重建**（M379，backlog M182 finding）：`ax/` 与 `shots/` 早先只
   * `mkdirp`——同一天重复跑同一场景（迭代调试的常态）时序号重新计，旧文件被覆盖一半、留下一半，
   * 复盘时会把上一轮的 dump 当本轮结论（REVIEW.md 第 2/7 条同族）。整目录清掉之后，一条不变式
   * 成立：**一个场景目录里的产物只属于一次 run**（README「证据布局」同条）。
   *
   * 用整目录而不是只清 `ax/` `shots/`：mid-run 崩掉的场景会留下**上一轮**的 `steps.md` /
   * `status.txt`，按目录名读证据的人同样会读到陈旧结论。
   */
  async startScenario(id, meta) {
    this.scenarioDir = path.join(this.root, id);
    this.scenarioId = id;
    this.records = [];
    this.shotSeq = 0;
    this.axSeq = 0;
    this.statusOverride = null;
    await rmrf(this.scenarioDir);
    await mkdirp(path.join(this.scenarioDir, "shots"));
    await mkdirp(path.join(this.scenarioDir, "ax"));
    await writeFile(path.join(this.scenarioDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    this.log = [];
    return this.scenarioDir;
  }

  logLine(line) {
    this.log?.push(line);
  }

  async saveShot(base64, name) {
    const file = path.join(this.scenarioDir, "shots", `${String(++this.shotSeq).padStart(2, "0")}-${safe(name)}.jpeg`);
    await writeFile(file, Buffer.from(base64, "base64"));
    return file;
  }

  async saveAx(text, name) {
    const file = path.join(this.scenarioDir, "ax", `${String(++this.axSeq).padStart(2, "0")}-${safe(name)}.txt`);
    await writeFile(file, text);
    return file;
  }

  record(rec) {
    this.records.push(rec);
    return rec;
  }

  get failures() {
    return this.records.filter((r) => r.kind === "assert" && !r.ok);
  }

  /** 写 steps.md + status.txt，返回 FAIL 列表。`statusOverride`（如 INVALID）优先于按失败项推出的终态。 */
  async finish() {
    const fails = this.failures;
    const status = this.statusOverride ?? (fails.length === 0 ? "PASS" : "FAIL");
    const lines = [`# ${status}`, ""];
    for (const r of this.records) {
      if (r.kind === "step") lines.push(`## ${r.name}`);
      else if (r.kind === "assert") lines.push(`- ${r.ok ? "PASS" : "FAIL"} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
      else if (r.kind === "note") lines.push(`  - (${r.text})`);
    }
    if (fails.length) {
      lines.push("", "## 失败项", ...fails.map((f) => `- ${f.label}${f.detail ? ` — ${f.detail}` : ""}`));
    }
    await writeFile(path.join(this.scenarioDir, "steps.md"), `${lines.join("\n")}\n`);
    await writeFile(path.join(this.scenarioDir, "status.txt"), `${status}\n`);
    return { status, fails };
  }
}

function safe(s) {
  return String(s).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_").slice(0, 60);
}

/**
 * 写索引（`summary.md` / `results.json`）：**按场景 id 增量合并**（M379，backlog M254/M256
 * 现场）——同一天里跑多次（单场景迭代、多 mission 共用同一日期目录）是常态，早先每次 run 整份
 * 重写，索引只反映最后一次 run，与磁盘上仍在的场景目录对不上（M256 的全量批把同一天早先三个
 * mission 的场景目录整个换掉，索引同样只剩本批）。
 *
 * 合并口径：同一 id 取**本次**的行（该场景的最新一次结果），其余 id 保留上一次的行，顺序按
 * 「先出现者在先」（Map 语义：改已存在的键不挪位置）。每行带 `at`（该场景最近一次跑的时间），
 * 让「这一行是哪次跑的」在索引里可读——这是把陈旧读数与本次读数分辨开的唯一线索。
 */
export async function writeSummary(root, results) {
  const prev = await readResults(root);
  const byId = new Map();
  for (const r of prev) byId.set(r.id, r);
  for (const r of results) byId.set(r.id, r);
  const merged = [...byId.values()];
  const at = new Date().toISOString();
  const rows = merged.map(
    (r) =>
      `| ${r.id} | ${r.title} | ${r.status} | ${r.asserts} | ${r.failed} | ${r.seconds.toFixed(1)}s | ${fmtAt(r.at)} |`,
  );
  const pass = merged.filter((r) => r.status === "PASS").length;
  const md = [
    `# 真机验收执行报告（索引更新于 ${at}）`,
    "",
    `本次 run ${results.length} 个场景（PASS ${results.filter((r) => r.status === "PASS").length}、` +
      `FAIL ${results.filter((r) => r.status !== "PASS").length}）；索引累计 ${merged.length} 个场景：` +
      `PASS ${pass}、FAIL ${merged.length - pass}。`,
    "",
    "同一场景多次跑只保留**最近一次**的行；`跑于` 是该场景最近一次跑的时间（同一天多次 run 共用本目录）。",
    "",
    "| 场景 | 标题 | 结果 | 断言数 | 失败 | 耗时 | 跑于 |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "失败详情见各场景目录的 steps.md；截图在 shots/，AX dump 在 ax/。",
    "",
  ].join("\n");
  await writeFile(path.join(root, "summary.md"), md);
  await writeFile(path.join(root, "results.json"), `${JSON.stringify(merged, null, 2)}\n`);
  return { pass: results.filter((r) => r.status === "PASS").length, total: results.length, summaryPath: path.join(root, "summary.md") };
}

/** 索引行里的时间只留 `HH:MM`（同一天目录里日期是常量，秒级精度没有信息量）。 */
function fmtAt(at) {
  if (!at) return "—";
  const m = /T(\d\d:\d\d)/.exec(at);
  return m ? m[1] : at;
}

/** 上一次的索引（缺文件 / 读不动都当空——首次跑或人工删过都不该让本次 run 失败）。 */
async function readResults(root) {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, "results.json"), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readStatus(dir) {
  try {
    return (await readFile(path.join(dir, "status.txt"), "utf8")).trim();
  } catch {
    return "MISSING";
  }
}

export async function appendRunLog(root, line) {
  await mkdir(root, { recursive: true });
  await appendFile(path.join(root, "run.log"), `${line}\n`);
}

export { mkdir };
