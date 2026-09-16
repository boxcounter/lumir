#!/usr/bin/env node
// Lumir 真机验收套件 —— runner。
//
// 用法：
//   node scripts/acceptance/run.mjs                 # 跑全部场景
//   node scripts/acceptance/run.mjs 01 08           # 只跑 id 前缀匹配的场景
//   node scripts/acceptance/run.mjs --list          # 列出场景
//   node scripts/acceptance/run.mjs --keep-app      # 跑完保留 app（人工接手看现场）
//
// 设计（docs/process/real-machine-acceptance.md）：起真实 app（`pnpm tauri dev`，WKWebView 非
// chromium 近似）→ KimiCU 驱动 → AX/内容断言 + 截图证据 → test-results/acceptance/<日期>/（git 外）。
// 每个场景前重置验收 vault、重置隔离配置、重启 app——场景之间零串扰，代价是每次重启几秒。
import { readdir } from "node:fs/promises";
import path from "node:path";
import { CuClient } from "./lib/cu.mjs";
import {
  acceptPort,
  assertSafeTargets,
  launchApp,
  reclaimPort,
  resetVault,
  stopApp,
  writeConfig,
} from "./lib/app.mjs";
import { waitAppReady } from "./lib/drive.mjs";
import { Evidence, appendRunLog, writeSummary } from "./lib/evidence.mjs";
import { loadScenario, runScenario } from "./lib/execute.mjs";
import { envHome, log, mkdirp, repoRoot, resultsRoot, sleep, vaultDir } from "./lib/util.mjs";

const args = process.argv.slice(2);
const keepApp = args.includes("--keep-app");
const filters = args.filter((a) => !a.startsWith("--"));
const scenariosDir = path.join(repoRoot(), "scripts/acceptance/scenarios");

async function listScenarios() {
  const names = (await readdir(scenariosDir)).filter((n) => n.endsWith(".md")).sort();
  const out = [];
  for (const n of names) out.push(await loadScenario(path.join(scenariosDir, n)));
  return out;
}

const all = await listScenarios();
if (args.includes("--list")) {
  for (const s of all) log(`${s.id}\t（backlog 项 ${s.item}）\t${s.title}`);
  process.exit(0);
}
const selected = filters.length ? all.filter((s) => filters.some((f) => s.id.startsWith(f) || String(s.item) === f)) : all;
if (selected.length === 0) {
  log(`没有匹配的场景（可用：${all.map((s) => s.id).join(", ")}）`);
  process.exit(2);
}

const root = resultsRoot();
const evidence = new Evidence(root);
let handle = null;
let cu = null;

async function main() {
  const targets = assertSafeTargets();
  log(`验收 vault：${targets.vault}`);
  log(`隔离配置：${targets.envHome}（用户的 ~/.config/lumir 全程不读写）`);
  log(`证据目录：${root}（git 外）`);
  const reclaimed = await reclaimPort(acceptPort());
  if (reclaimed.length) log(`回收上次残留进程：${reclaimed.join(", ")}`);
  await mkdirp(root);

  cu = await CuClient.start();
  log("KimiCU MCP 已连接\n");

  const results = [];
  for (const scenario of selected) {
    const t0 = Date.now();
    log(`▶ ${scenario.id}（backlog 项 ${scenario.item}）${scenario.title}`);
    let out;
    try {
      await resetVault();
      await writeConfig({ mode: "md" });
      if (handle) await stopApp(handle);
      handle = await launchApp({ logFile: path.join(root, "app.log") });
      await sleep(1200);
      await waitAppReady(cu, handle.pid); // 前端就绪门：左栏文件树 + 编辑器节点就位再开跑
      const ctx = {
        cu,
        pid: handle.pid,
        evidence,
        repoRoot: repoRoot(),
        restartApp: async () => {
          await stopApp(handle);
          handle = await launchApp({ logFile: path.join(root, "app.log") });
          await sleep(1200);
          await waitAppReady(cu, handle.pid);
          ctx.pid = handle.pid;
        },
      };
      out = await runScenario(ctx, scenario);
    } catch (e) {
      // app 起不来 / 前端未就绪（如 KimiCU AX 服务退化）：如实记一条 FAIL，继续跑下一个场景，
      // 不要因为环境问题丢掉整轮结果。
      log(`  ✗ 环境异常：${e.message}`);
      out = { status: "FAIL", records: [{ kind: "assert", ok: false, label: "[环境异常]", detail: e.message }] };
    }
    const seconds = (Date.now() - t0) / 1000;
    results.push({
      id: scenario.id,
      item: scenario.item,
      title: scenario.title,
      status: out.status,
      asserts: out.records.filter((r) => r.kind === "assert").length,
      failed: out.records.filter((r) => r.kind === "assert" && !r.ok).length,
      seconds,
    });
    log(`  ${out.status}  ${seconds.toFixed(1)}s  ${path.join(root, scenario.id)}`);
    for (const f of out.records.filter((r) => r.kind === "assert" && !r.ok)) log(`    ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
    results[results.length - 1].records = undefined;
    await appendRunLog(root, `${new Date().toISOString()} ${scenario.id} ${out.status}`);
  }

  const summary = await writeSummary(root, results);
  log(`\n结论：${summary.pass}/${summary.total} PASS。报告：${summary.summaryPath}`);
  return summary;
}

let exitCode = 0;
try {
  const summary = await main();
  exitCode = summary.pass === summary.total ? 0 : 1;
} catch (e) {
  log(`运行失败：${e.message}`);
  exitCode = 2;
} finally {
  if (!keepApp && handle) await stopApp(handle);
  if (keepApp && handle) log(`app 保留运行中：pid ${handle.pid}（vault ${vaultDir()}，配置 ${envHome()}）`);
  await cu?.stop();
}
process.exit(exitCode);
