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
  prepareSeed,
  reclaimPort,
  resetPositions,
  resetRecovery,
  resetRegistry,
  resetSecondVault,
  resetSessions,
  resetVault,
  stopApp,
  writeConfig,
} from "./lib/app.mjs";
import { tryForeground, waitAppReady } from "./lib/drive.mjs";
import { Evidence, appendRunLog, writeSummary } from "./lib/evidence.mjs";
import { checkScenario, loadScenario, runScenario } from "./lib/execute.mjs";
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
if (args.includes("--check")) {
  // 静态校验：不真机、秒级，写场景时先用它挡掉 key 拼错、断言形态写错这类低级错。
  const problems = all.flatMap(checkScenario);
  for (const s of all) log(`CHECK ${problems.some((p) => p.startsWith(`${s.id}:`)) ? "FAIL" : "PASS"} ${s.id}`);
  if (problems.length) {
    log("");
    for (const p of problems) log(`  ✗ ${p}`);
    process.exit(1);
  }
  log(`\n场景静态校验通过（${all.length} 个）`);
  process.exit(0);
}
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

/**
 * 起实例前的环境预检（tower 纪律，2026-09-16）：
 * - KimiCU 不存在 → 直接说清安装命令，不要跑到一半才发现；
 * - 磁盘水位 < 2G 不起真机实例（cargo/vite 会 ENOSPC 硬失败，批次四实证）；
 * - 报告 1420 端口占用情况（套件自身走 1430，但仍先看一眼：1420 被占说明同机有别的
 *   `pnpm tauri dev` 在跑，机器负载与 AX 稳定性都会受影响）。
 */
async function preflight() {
  const { existsSync } = await import("node:fs");
  const bin = process.env.KIMICU_BIN ?? "/Applications/KimiCU.app/Contents/MacOS/kimi-cu";
  if (!existsSync(bin)) {
    throw new Error(
      `KimiCU 未安装（${bin}）。安装：curl -fsSL https://cdn.kimi.com/kimi-computer-use/latest/setup_macos.sh | bash`,
    );
  }
  const { statfsSync } = await import("node:fs");
  const fs = statfsSync(repoRoot());
  const freeGb = (fs.bavail * fs.bsize) / 1e9;
  if (freeGb < 2) {
    // 阈值来自 tower 纪律（<2G 不起真机实例）。唯一可绕过的方式是显式授权：目标 target 是热的、
    // 本次不会触发 Rust 重编时，实际磁盘需求只有几 MB。绕过会留痕（run.log + 报告），不静默。
    if (process.env.LUMIR_ACCEPTANCE_ALLOW_LOW_DISK !== "1") {
      throw new Error(
        `磁盘可用 ${freeGb.toFixed(2)}G < 2G：真机实例会 ENOSPC 硬失败，请先清理或上报（tower 纪律）。` +
          `若 target 已热、本次不重编，可显式设 LUMIR_ACCEPTANCE_ALLOW_LOW_DISK=1 绕过（会留痕）。`,
      );
    }
    log(`⚠ 磁盘可用仅 ${freeGb.toFixed(2)}G，已按显式授权（LUMIR_ACCEPTANCE_ALLOW_LOW_DISK=1）越过 2G 阈值`);
    await appendRunLog(root, `${new Date().toISOString()} OVERRIDE low-disk free=${freeGb.toFixed(2)}G`);
  } else {
    log(`磁盘可用 ${freeGb.toFixed(1)}G`);
  }
  const { execFileSync } = await import("node:child_process");
  let on1420 = "";
  try {
    on1420 = execFileSync("/usr/sbin/lsof", ["-nP", "-iTCP:1420", "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
  } catch {
    /* 未被占用 */
  }
  log(
    on1420
      ? `注意：1420 端口被占用（同机有别的 tauri dev 在跑）；套件自身走 ${acceptPort()} 不受影响\n`
      : `1420 端口空闲；套件自身走 ${acceptPort()}\n`,
  );
}

async function main() {
  const targets = assertSafeTargets();
  await preflight();
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
    let fgNote = "";
    let out;
    try {
      await resetVault();
      await resetSecondVault(); // 第二个合成 vault：多 vault 场景的切换目标
      await resetRecovery(); // 备份目录在隔离配置下，不清会让上一场景的备份串场
      // 注册表与会话也在隔离配置下：前者决定列表浮层有几行、后被哪些 id 命中，后者决定装载后
      // 恢复哪些标签——两者残留都会让本场景看到上一场景的状态（与 recovery 同因）。
      await resetRegistry();
      await resetSessions();
      await resetPositions(); // 阅读位置（M194）：同上，残留会让下一场景一打开文件就换位置
      // 场景自己的注册表 / 会话预置：**必须在 launchApp 之前**（见 prepareSeed 的说明）。
      await prepareSeed(scenario.seed);
      await writeConfig({ mode: "md" });
      if (handle) await stopApp(handle);
      handle = await launchApp({ logFile: path.join(root, "app.log") });
      await sleep(1200);
      await waitAppReady(cu, handle.pid); // 前端就绪门：左栏文件树 + 编辑器节点就位再开跑
      // tower 纪律：键盘场景先尽力拿前台并如实记录（拿不到不中止——行为断言才是注入是否落地的证据）。
      const fg = await tryForeground(cu, handle.pid);
      fgNote = fg.frontmost
        ? "前台焦点：已取得"
        : `前台焦点：未取得（前台 pid=${fg.frontPid ?? "未知"}）——键盘走 KimiCU 后台注入路径`;
      log(`  ${fgNote}`);
      const ctx = {
        cu,
        foregroundNote: fgNote,
        pid: handle.pid,
        evidence,
        repoRoot: repoRoot(),
        restartApp: async ({ requireVault = true } = {}) => {
          await stopApp(handle);
          handle = await launchApp({ logFile: path.join(root, "app.log") });
          await sleep(1200);
          // requireVault: false = 本步期待「未打开空态」（如 last_vault 失效），就绪门放宽为
          // 「树 pane 任一形态 + 编辑器在位」。默认仍是严格门（树里有 .md 行）。
          await waitAppReady(cu, handle.pid, { requireVault });
          const fg2 = await tryForeground(cu, handle.pid);
          ctx.foregroundNote = `重启前台焦点：${fg2.frontmost ? "已取得" : `未取得（pid=${fg2.frontPid ?? "?"}）`}`;
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
