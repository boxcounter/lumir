// 冷启动测量（spec §1）：spawn release 二进制 → stdout 出现 LUMIR_READY 行的 harness wall time。
// 辅口径 app 自报 elapsed_ms 一并上报，供归因（进程装载 vs Tauri 初始化）。
import { spawn } from "node:child_process";
import path from "node:path";
import { repoRoot, writeResult } from "./lib/stats.mjs";

const RUNS = Number(process.env.PERF_COLD_START_RUNS ?? 20);
// warm-up：首轮含 dyld 绑定/TCC 授权等一次性开销，是系统性离群值（实测首轮可达后续轮 5 倍），
// 丢弃后正式样本才反映 spec §1 定义的"热缓存冷启动"。
const WARMUP_RUNS = Number(process.env.PERF_COLD_START_WARMUP ?? 1);
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

for (let i = 0; i < WARMUP_RUNS; i++) {
  const { wallMs } = await measureOnce();
  console.log(`[perf] cold-start warm-up ${i + 1}/${WARMUP_RUNS}: wall=${wallMs.toFixed(1)}ms（丢弃，吸收首轮离群值）`);
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
  meta: { runs: RUNS, warmupRuns: WARMUP_RUNS, appElapsedMsSamples: selfReported, note: "wall time spawn->LUMIR_READY; app_elapsed 为辅口径；warm-up 轮已丢弃" },
});
