// 证据落盘。
//
// 约定（与 docs/process/real-machine-acceptance.md 裁决点 1 一致）：全部产物落
// test-results/acceptance/<日期>/，**不入 git**（与 perf-results 同惯例）；Alex 抽审靠本地目录。
// 每场景一个目录：status.txt（PASS/FAIL）+ steps.md（逐步骤逐断言）+ shots/ + ax/。
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdirp } from "./util.mjs";

export class Evidence {
  constructor(root) {
    this.root = root;
    this.scenarioDir = null;
    this.records = [];
    this.shotSeq = 0;
    this.axSeq = 0;
  }

  async startScenario(id, meta) {
    this.scenarioDir = path.join(this.root, id);
    this.records = [];
    this.shotSeq = 0;
    this.axSeq = 0;
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

  /** 写 steps.md + status.txt，返回 FAIL 列表。 */
  async finish() {
    const fails = this.failures;
    const status = fails.length === 0 ? "PASS" : "FAIL";
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

export async function writeSummary(root, results) {
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.title} | ${r.status} | ${r.asserts} | ${r.failed} | ${r.seconds.toFixed(1)}s |`,
  );
  const pass = results.filter((r) => r.status === "PASS").length;
  const md = [
    `# 真机验收执行报告（${new Date().toISOString()}）`,
    "",
    `场景 ${results.length} 个：PASS ${pass}、FAIL ${results.length - pass}。`,
    "",
    "| 场景 | 标题 | 结果 | 断言数 | 失败 | 耗时 |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    "失败详情见各场景目录的 steps.md；截图在 shots/，AX dump 在 ax/。",
    "",
  ].join("\n");
  await writeFile(path.join(root, "summary.md"), md);
  await writeFile(path.join(root, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  return { pass, total: results.length, summaryPath: path.join(root, "summary.md") };
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
