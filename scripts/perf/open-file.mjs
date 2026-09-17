// 打开 1MB 文件测量（spec §3，**占位口径**）：fs.readFile + UTF-8 解码完成，不含解析与渲染。
//
// 现状如实标注（M153）：这条端点量的是「把一个 1MB 文件读进内存」，**不是**「打开请求 →
// 编辑器首帧渲染」；而 perf.yml 与 check-thresholds.mjs 对它就 enforce（contract 100ms，
// 绝对模式）。阈值本身有效、数字稳定，但它**不代表**用户可感知的打开耗时——读的人别把
// 这条数字当成「打开文档的体验没退化」。
// 修订义务：M1 真实打开路径落地后，端点须改为「打开请求 → 编辑器首帧渲染」，阈值与滚动
// 基线一并重标定（属性能合同口径决策，见 docs/specs/perf-measurement.md；立项建议已由
// M153 用 TowerFinding 上报，不在 M153 内实施）。
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
    // 与文件头同一口径：这条 note 会随结果落进 perf-results/ 的 JSON，读 artifact 的人
    // 看到的就是「占位端点 + 已 enforce + 修订义务」这三件事（M153）。
    note: "占位口径且已 enforce：纯磁盘 IO + UTF-8 解码，不含解析/渲染，不代表真实打开耗时；真实打开端点落地后须重标定阈值与基线",
  },
});
