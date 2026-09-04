// 冷启动测量（spec §1）：spawn release 二进制 → stdout 出现 LUMIR_READY 行的 harness wall time。
// 辅口径 app 自报 elapsed_ms 一并上报，供归因（进程装载 vs Tauri 初始化）。
import { spawn } from "node:child_process";
import path from "node:path";
import { repoRoot, writeResult } from "./lib/stats.mjs";

const RUNS = Number(process.env.PERF_COLD_START_RUNS ?? 10);
const TIMEOUT_MS = 15_000;
const BIN = path.join(repoRoot(), "src-tauri/target/release/lumir");
const READY_PREFIX = "LUMIR_READY ";

function measureOnce() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(BIN, [], { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    let done = false;

    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      fn(val);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`no LUMIR_READY within ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS
    );

    child.on("error", (err) => finish(reject, err));
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.startsWith(READY_PREFIX)) {
          const wallMs = performance.now() - t0;
          let elapsedMs = null;
          try {
            elapsedMs = JSON.parse(line.slice(READY_PREFIX.length)).elapsed_ms;
          } catch {
            /* ready 行 JSON 损坏时仅丢失辅口径 */
          }
          finish(resolve, { wallMs, elapsedMs });
        }
      }
    });
  });
}

const samples = [];
const selfReported = [];
for (let i = 0; i < RUNS; i++) {
  const { wallMs, elapsedMs } = await measureOnce();
  samples.push(wallMs);
  if (typeof elapsedMs === "number") selfReported.push(elapsedMs);
  console.log(`[perf] cold-start run ${i + 1}/${RUNS}: wall=${wallMs.toFixed(1)}ms app_elapsed=${elapsedMs?.toFixed(1) ?? "n/a"}ms`);
}
await writeResult({
  metric: "cold-start",
  unit: "ms",
  contract: 300,
  samples,
  meta: { runs: RUNS, appElapsedMsSamples: selfReported, note: "wall time spawn->LUMIR_READY; app_elapsed 为辅口径" },
});
