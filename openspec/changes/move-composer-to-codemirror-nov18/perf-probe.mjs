import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../tests/visual/node_modules/@playwright/test/index.mjs";
import { summarize } from "../../../scripts/perf/lib/stats.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = process.env.M831_PERF_DIR ?? path.join(root, ".local/perf");
const execFileP = promisify(execFile);
const pnpmDir = path.join(root, "node_modules/.pnpm");

async function pnpmPackage(encoded) {
  const entry = (await readdir(pnpmDir)).find((name) => name.startsWith(`${encoded}@`));
  if (!entry) throw new Error(`missing pnpm package ${encoded}`);
  return `/node_modules/.pnpm/${entry}/node_modules`;
}

const imports = {
  "@codemirror/state": "/node_modules/@codemirror/state/dist/index.js",
  "@codemirror/view": "/node_modules/@codemirror/view/dist/index.js",
  "@codemirror/commands": "/node_modules/@codemirror/commands/dist/index.js",
  "@codemirror/language": "/node_modules/@codemirror/language/dist/index.js",
  "@lezer/common": `${await pnpmPackage("@lezer+common")}/@lezer/common/dist/index.js`,
  "@lezer/highlight": `${await pnpmPackage("@lezer+highlight")}/@lezer/highlight/dist/index.js`,
  "@lezer/lr": `${await pnpmPackage("@lezer+lr")}/@lezer/lr/dist/index.js`,
  "@marijn/find-cluster-break": `${await pnpmPackage("@marijn+find-cluster-break")}/@marijn/find-cluster-break/src/index.js`,
  crelt: `${await pnpmPackage("crelt")}/crelt/index.js`,
  "style-mod": `${await pnpmPackage("style-mod")}/style-mod/src/style-mod.js`,
  "w3c-keyname": `${await pnpmPackage("w3c-keyname")}/w3c-keyname/index.js`,
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; background: white; color: #222; font: 14px/1.5 -apple-system, sans-serif; }
#editor { width: 360px; min-height: 44px; padding: 6px 8px; border: 1px solid #ccc; }
.cm-editor { height: auto; } .cm-content { padding: 0; } .cm-line { padding: 0; }
</style><script type="importmap">${JSON.stringify({ imports })}</script></head><body>
<div id="editor"></div><script type="module">
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
window.view = new EditorView({
  parent: document.querySelector("#editor"),
  state: EditorState.create({ doc: "", extensions: [history(), EditorView.lineWrapping] }),
});
window.samples = [];
window.addEventListener("keydown", (event) => {
  if (event.key !== "a") return;
  const started = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.samples.push(performance.now() - started);
  }));
}, true);
window.measurementReady = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];
  if (urlPath === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    return;
  }
  if (!urlPath.startsWith("/node_modules/")) {
    res.writeHead(404).end("not found");
    return;
  }
  const file = path.resolve(root, `.${urlPath}`);
  if (!file.startsWith(path.join(root, "node_modules") + path.sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

function stats(samples) {
  return { samples, ...summarize(samples) };
}

async function rss(session) {
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  const pids = processInfo.map((entry) => entry.id).filter(Boolean);
  if (pids.length === 0) throw new Error("CDP returned no browser processes");
  const { stdout } = await execFileP("ps", ["-p", pids.join(","), "-o", "pid=,rss=,comm="]);
  const processes = stdout.trim().split("\n").filter(Boolean).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), rssMB: Number(match[2]) / 1024, command: match[3] } : null;
  }).filter(Boolean);
  return { totalMB: processes.reduce((sum, entry) => sum + entry.rssMB, 0), processes };
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("perf pageerror", error));
  page.on("console", (message) => { if (message.type() === "error") console.error("perf console", message.text()); });
  page.on("requestfailed", (request) => console.error("perf requestfailed", request.url(), request.failure()));
  const session = await browser.newBrowserCDPSession();
  const baseline = await rss(session);
  await page.goto(url);
  await page.waitForFunction(() => window.measurementReady === true);
  await page.locator(".cm-content").click();
  await page.keyboard.type("a".repeat(50), { delay: 100 });
  await page.waitForFunction(() => window.samples.length >= 50);
  const samples = await page.evaluate(() => window.samples);
  if (samples.length !== 50 || (await page.evaluate(() => window.view.state.doc.toString())) !== "a".repeat(50)) {
    throw new Error("measurement did not land all 50 real text inputs");
  }
  const memorySamples = [];
  for (let index = 0; index < 5; index += 1) {
    memorySamples.push(await rss(session));
    if (index < 4) await page.waitForTimeout(2000);
  }
  await mkdir(outDir, { recursive: true });
  const meta = {
    measuredAt: new Date().toISOString(),
    chrome: browser.version(),
    fixture: "minimal CM6 state/view/commands: doc, selection, history, lineWrapping; no Markdown parser or app shell",
    note: "Chromium double-rAF keydown-to-paint approximation; browser-process RSS is not the Tauri/WKWebView resident-memory metric",
  };
  const keypress = { metric: "minimal-cm-keypress-to-paint", unit: "ms", contract: 16, ...stats(samples), meta };
  const memory = {
    metric: "minimal-cm-resident-memory",
    unit: "MB",
    contract: 200,
    baselineMB: baseline.totalMB,
    samples: memorySamples.map((sample) => sample.totalMB),
    max: Math.max(...memorySamples.map((sample) => sample.totalMB)),
    cmIncrementMaxMB: Math.max(...memorySamples.map((sample) => sample.totalMB)) - baseline.totalMB,
    baselineProcesses: baseline.processes,
    sampleProcesses: memorySamples,
    meta,
  };
  await writeFile(path.join(outDir, "minimal-cm-keypress-to-paint.json"), `${JSON.stringify(keypress, null, 2)}\n`);
  await writeFile(path.join(outDir, "minimal-cm-resident-memory.json"), `${JSON.stringify(memory, null, 2)}\n`);
  console.log(JSON.stringify({ keypress, memory: { ...memory, sampleProcesses: undefined, baselineProcesses: undefined } }, null, 2));
  console.log(`evidence: ${outDir}`);
} finally {
  if (browser) await browser.close();
  server.close();
}
