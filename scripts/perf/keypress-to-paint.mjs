// keypress-to-paint 测量（spec §2）：headless Chrome + CDP Input.dispatchKeyEvent 注入近似。
// 读数是下界：不含 OS 输入管道/合成器，引擎为 Blink 而非产品运行时的 WKWebView，
// 且 M0 空壳编辑器只读、按键不触发文档更新路径。引用读数时必须带此声明。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot, sleep, writeResult } from "./lib/stats.mjs";

const N = Number(process.env.PERF_KTP_SAMPLES ?? 50);
const INTERVAL_MS = 100;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error(`Chrome not found (tried: ${CHROME_CANDIDATES.join(", ")}); set CHROME_PATH`);

// --- 静态服务器：release 前端产物 dist/ ---
const distDir = path.join(repoRoot(), "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" };
const server = createServer(async (req, res) => {
  const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/").split("?")[0];
  const file = path.join(distDir, path.normalize(urlPath));
  if (!file.startsWith(distDir) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

// --- 启动 headless Chrome，经 DevToolsActivePort 发现 CDP 端口 ---
const profile = await mkdtemp(path.join(os.tmpdir(), "lumir-ktp-chrome-"));
const chromeProc = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-extensions",
  "about:blank",
], { stdio: ["ignore", "ignore", "inherit"] });

let wsUrl = null;
for (let i = 0; i < 100; i++) {
  const portFile = path.join(profile, "DevToolsActivePort");
  if (existsSync(portFile)) {
    const [port, wsPath] = (await readFile(portFile, "utf8")).split("\n");
    if (port && wsPath) {
      wsUrl = `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
      break;
    }
  }
  await sleep(100);
}
if (!wsUrl) throw new Error("DevToolsActivePort not found; Chrome failed to start");

// --- 极简 CDP client（Node 内置 WebSocket，flatten session 模式） ---
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error(`CDP websocket error: ${e.message ?? e}`));
});
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
  }
};
function cdp(method, params = {}, sessionId = undefined) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

try {
  const { targetId } = await cdp("Target.createTarget", { url: pageUrl });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);

  // 等页面加载完成
  for (let i = 0; i < 100; i++) {
    const { result } = await cdp(
      "Runtime.evaluate",
      { expression: "document.readyState", returnByValue: true },
      sessionId
    );
    if (result.value === "complete") break;
    await sleep(100);
  }

  // 采样 hook：keydown(capture) 打点 t0，双重 rAF 后打点 t1，差值入 __ktp
  await cdp(
    "Runtime.evaluate",
    {
      expression: `
        window.__ktp = [];
        window.addEventListener('keydown', () => {
          const t0 = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__ktp.push(performance.now() - t0);
          }));
        }, true);
      `,
    },
    sessionId
  );

  for (let i = 0; i < N; i++) {
    await cdp(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
      sessionId
    );
    await sleep(INTERVAL_MS);
  }
  await sleep(INTERVAL_MS * 2); // 收尾最后两次 rAF

  const { result } = await cdp(
    "Runtime.evaluate",
    { expression: "window.__ktp", returnByValue: true },
    sessionId
  );
  const samples = result.value ?? [];
  if (samples.length < N * 0.9) {
    throw new Error(`only ${samples.length}/${N} samples collected; rAF may not fire in this headless mode`);
  }
  await writeResult({
    metric: "keypress-to-paint",
    unit: "ms",
    contract: 16,
    samples,
    meta: {
      samplesRequested: N,
      chrome: await cdp("Browser.getVersion").then((v) => v.product).catch(() => "unknown"),
      note: "LOWER BOUND: CDP 注入近似，不含 OS 输入管道/合成器，Blink≠WKWebView，M0 只读编辑器无文档更新路径",
    },
  });
} finally {
  ws.close();
  chromeProc.kill("SIGKILL");
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
