// 打开 1MB 文件测量（spec §3，占位口径）：fs.readFile + UTF-8 解码完成，不含解析与渲染。
// M1 真实打开路径落地后端点将修订为"打开请求 → 编辑器首帧渲染"。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, writeResult } from "./lib/stats.mjs";

const N = Number(process.env.PERF_OPEN_FILE_SAMPLES ?? 50);
const FIXTURE = path.join(repoRoot(), "tests/perf/fixtures/markdown-1mb.md");
const EXPECTED_BYTES = 1_048_576; // 1 MiB，spec §3 钉死

const decoder = new TextDecoder();

// 预热 page cache + 校验 fixture 规格
const warmup = await readFile(FIXTURE);
if (warmup.byteLength !== EXPECTED_BYTES) {
  throw new Error(`fixture size mismatch: got ${warmup.byteLength} bytes, expected ${EXPECTED_BYTES}（用 tests/perf/fixtures/gen-fixture.mjs 再生成）`);
}

const samples = [];
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const buf = await readFile(FIXTURE);
  const text = decoder.decode(buf);
  if (text.length === 0) throw new Error("decode produced empty string");
  samples.push(performance.now() - t0);
}

await writeResult({
  metric: "open-1mb-file",
  unit: "ms",
  contract: 100,
  samples,
  meta: {
    fixture: path.relative(repoRoot(), FIXTURE),
    fixtureBytes: EXPECTED_BYTES,
    pageCache: "warm",
    note: "占位口径：纯磁盘 IO + UTF-8 解码，不含解析/渲染",
  },
});
