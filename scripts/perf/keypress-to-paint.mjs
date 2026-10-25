// keypress-to-paint 测量（spec §2）：headless Chrome + CDP Input.dispatchKeyEvent 注入近似。
//
// 读数是下界：不含 OS 输入管道/合成器，引擎为 Blink 而非产品运行时的 WKWebView，且被测页面是
// release 前端产物在**无 Tauri** 的纯 Chrome 里的降级态（IPC 全失败、编辑器存在但不持焦），
// 按键只走「事件 → 帧调度」，不进编辑器文本写入路径。引用读数时必须带此声明。
//
// **注入起点（M737）**：`document.readyState === "complete"` 时产品尚未挂载——boot 层（src/boot.ts）
// 到那时才去读配置、画启动面、`await import("./main")`（1.7MB 主 chunk），window 上 0 个监听器。
// 在那个窗口里注入，量到的是主 chunk 的装载与执行，不是按键 → 帧：stock harness 的首样本可达
// 1005ms、前 10 条里 9 条落进慢模态（证据 .local/reports/escape-keypress-perf-oct25/README.md §1.3）。
// 因此注入起点改为等产品自报的 `lumir:app-ready`（src/main.ts:4201，主模块顶层执行完——键位表
// 与窗口级 Escape 兜底都在它之前装好）**且**编辑器已在 DOM，再加两个渲染帧的短暂稳定期；
// app-ready 15s 内不出现就报错退出、不写结果文件（CI 因此报「结果缺失」而不是「超阈」）。
// 本次只改注入起点：指标定义、样本数 N=50、median 统计量、阈值与下界声明一律不动。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { repoRoot, sleep, writeResult } from "./lib/stats.mjs";

/** 样本数。spec §2 的 N=50 与 median 门禁口径都不随注入起点改动（M737）。 */
export const DEFAULT_SAMPLES = 50;
const N = Number(process.env.PERF_KTP_SAMPLES ?? DEFAULT_SAMPLES);
/** 按键间隔（spec §2：避免事件合并与帧堆积）。 */
export const INTERVAL_MS = 100;

/** 产品自报的「主模块已挂载」事件（src/main.ts:4201 的 `emitReadiness("app-ready")`）。 */
export const APP_READY_EVENT = "lumir:app-ready";
/** 编辑器根元素与可编辑内容元素（CodeMirror 6 的稳定类名，视觉套件同口径）。 */
export const EDITOR_SELECTOR = ".cm-editor";
export const EDITOR_CONTENT_SELECTOR = ".cm-content";
/** 等 app-ready 的上界：本机实测 readyState complete → app-ready 0.11–0.13s，CI runner 更慢，留两个数量级余量。 */
export const READY_TIMEOUT_MS = 15_000;
export const READY_POLL_MS = 25;
/** 短暂稳定期：app-ready 之后再等两个渲染帧（与指标自身的双 rAF 同一原语，不是定时器掩盖）。 */
export const SETTLE_FRAMES = 2;
/** 等帧的上界：rAF 完全不派发时（后台标签 / 帧源被掐）不挂死，交给样本数校验报缺样本。 */
export const SETTLE_TIMEOUT_MS = 2_000;

/** 结果 schema 的三项身份字段（spec 总约定「采样统计口径」）。 */
export const RESULT_CONTRACT = { metric: "keypress-to-paint", unit: "ms", contract: 16 };

/** 下界声明（spec §2「下界声明」的脚本侧副本；引用读数必须带它）。 */
export const LOWER_BOUND_NOTE =
  "LOWER BOUND: CDP 注入近似，不含 OS 输入管道/合成器，Blink≠WKWebView，" +
  "被测页面是 release 产物在无 Tauri 的纯 Chrome 里的降级态（IPC 全失败、编辑器存在但不持焦），" +
  "按键只走「事件 → 帧调度」，不进编辑器文本写入路径";

/**
 * 页面侧启动探针：在 document 创建时注入（`Page.addScriptToEvaluateOnNewDocument`），先于页面
 * 任何脚本注册，因此不会漏掉 app-ready。它只读状态、不改页面行为（不包 addEventListener、不做
 * DOM 写入），唯一副作用是把状态挂到 `window.__ktpStartup`。
 *
 * **写成参数化的纯函数**是为了让机器测试用假 window/document 调用同一份实现
 * （scripts/perf/keypress-startup.test.mjs）——实现与页面里跑的是同一段源码（经 toString 序列化）。
 */
export function installStartupProbe(win, doc, now, eventName, editorSelector, editorContentSelector) {
  const state = {
    installedAt: now(),
    readyStateAtInstall: doc.readyState,
    readyStateCompleteAt: doc.readyState === "complete" ? now() : null,
    sawAppReadyEvent: false,
    appReadyAt: null,
    readyStateAtAppReady: null,
    editorAtAppReady: null,
    editorContentAtAppReady: null,
  };
  if (state.readyStateCompleteAt === null) {
    doc.addEventListener("readystatechange", () => {
      if (doc.readyState === "complete" && state.readyStateCompleteAt === null) {
        state.readyStateCompleteAt = now();
      }
    });
  }
  win.addEventListener(eventName, () => {
    // 只认第一次：app-ready 只发一次，重复事件不该覆盖首次时刻。
    if (state.sawAppReadyEvent) return;
    state.sawAppReadyEvent = true;
    state.appReadyAt = now();
    state.readyStateAtAppReady = doc.readyState;
    state.editorAtAppReady = doc.querySelector(editorSelector) !== null;
    state.editorContentAtAppReady = doc.querySelector(editorContentSelector) !== null;
  });
  win.__ktpStartup = state;
  return state;
}

export const STARTUP_PROBE_SOURCE =
  `(${installStartupProbe.toString()})(window, document, () => performance.now(), ` +
  `${JSON.stringify(APP_READY_EVENT)}, ${JSON.stringify(EDITOR_SELECTOR)}, ${JSON.stringify(EDITOR_CONTENT_SELECTOR)});`;

/** 读探针状态；探针还没装上（导航未提交）时返回 null。 */
export const PROBE_STATE_EXPRESSION = "window.__ktpStartup ?? null";

/**
 * 页面侧「等 N 个渲染帧」：与指标同一原语（rAF），上界交给外部超时。同样是参数化纯函数，
 * 测试可直接喂假 win 验证它数的是帧不是定时器。`frames` 由 `SETTLE_FRAMES` 传入——
 * 那个常量因此有真实消费者，改它会真的改等待长度（不是只改日志文案）。
 */
export function waitFrames(win, now, timeoutMs, frames) {
  return new Promise((resolve) => {
    const startedAt = now();
    let settled = false;
    let seen = 0;
    const finish = (settle, landed) => {
      if (settled) return;
      settled = true;
      resolve({ settle, frames: landed, ms: now() - startedAt });
    };
    win.setTimeout(() => finish("timeout", seen), timeoutMs);
    const step = () => {
      seen += 1;
      if (seen >= frames) finish("frames", seen);
      else win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  });
}

export const SETTLE_EXPRESSION =
  `(${waitFrames.toString()})(window, () => performance.now(), ${SETTLE_TIMEOUT_MS}, ${SETTLE_FRAMES})`;

/** 采样 hook：keydown(capture) 打点 t0，双重 rAF 后打点 t1，差值入 `window.__ktp`。 */
export const SAMPLING_HOOK_EXPRESSION = `
  window.__ktp = [];
  window.addEventListener('keydown', () => {
    const t0 = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__ktp.push(performance.now() - t0);
    }));
  }, true);
`;

/**
 * 等「产品真实挂载完成 + 短暂稳定期」。`page` 是 CDP 的最小适配面（`evaluate(expression, params?)`
 * / `sleep(ms)`），测试用假 page 复现「readyState 已 complete 但产品还没挂载」的时序。
 *
 * 门禁按顺序卡三件事，任一不满足都不返回、不注入：
 *   1) readyState 到 complete（旧门禁的起点，这里只作诊断基线）；
 *   2) 收到 `lumir:app-ready`（产品自报主模块顶层执行完，键位表与 Escape 兜底已挂上）；
 *   3) 编辑器在 DOM（`.cm-editor`）——app-ready 到了但编辑器缺失说明被测页面形态已变，
 *      直接报错而不是继续量一个 spec 不再描述的东西。
 * 之后等两个渲染帧再返回（`settle`），把挂载那一帧的绘制让出去。
 */
export async function waitForProductMount({ page, timeoutMs = READY_TIMEOUT_MS, pollMs = READY_POLL_MS }) {
  const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollMs));
  let lastState = null;
  let lastError = null;
  let polls = 0;
  while (polls < maxPolls) {
    polls += 1;
    let state = null;
    try {
      state = await page.evaluate(PROBE_STATE_EXPRESSION);
    } catch (e) {
      // 导航刚提交时旧文档的执行上下文可能已被销毁（"Execution context was destroyed"），
      // 这不是产品问题，按「还没就绪」重试；真错误最终会以超时消息里的 lastError 出现。
      lastError = String(e);
    }
    if (state !== null) lastState = state;
    if (state !== null && state.readyStateCompleteAt !== null) {
      if (state.sawAppReadyEvent && state.editorAtAppReady !== true) {
        throw new Error(
          `product mount gate: ${APP_READY_EVENT} 已出现但 ${EDITOR_SELECTOR} 不在 DOM——` +
            `被测页面形态与 spec §2 声明不符，读数无意义；不写结果文件`
        );
      }
      if (state.sawAppReadyEvent) {
        const settle = await page.evaluate(SETTLE_EXPRESSION, { awaitPromise: true });
        if (settle.settle !== "frames") {
          // 不掩盖：记下来并继续（后面样本数校验会因帧不派发而报缺样本）。
          console.warn(
            `::warning::[perf] keypress-to-paint: 稳定期未等到 ${SETTLE_FRAMES} 个渲染帧` +
              `（${SETTLE_TIMEOUT_MS}ms 上界内 0 帧），继续采样`
          );
        }
        return {
          polls,
          readyStateAtInstall: state.readyStateAtInstall,
          readyStateCompleteAt: state.readyStateCompleteAt,
          appReadyAt: state.appReadyAt,
          readyStateAtAppReady: state.readyStateAtAppReady,
          editorAtAppReady: state.editorAtAppReady,
          editorContentAtAppReady: state.editorContentAtAppReady,
          readyStateToAppReadyMs: state.appReadyAt - state.readyStateCompleteAt,
          settle,
        };
      }
    }
    await page.sleep(pollMs);
  }
  throw new Error(
    `product mount gate: ${timeoutMs}ms 内没有等到 ${APP_READY_EVENT}——` +
      `探针${lastState === null ? "未装上（addScriptToEvaluateOnNewDocument 未生效）" : "已装上"}，` +
      `末次状态 ${JSON.stringify(lastState)}，末次求值错误 ${lastError ?? "无"}；` +
      `不写结果文件（CI 将报「结果缺失」而不是「超阈」）`
  );
}

/** 逐键注入：N 次按键、固定间隔，末尾多留两个间隔收最后两次 rAF。 */
export async function collectSamples({ page, n = N, intervalMs = INTERVAL_MS }) {
  for (let i = 0; i < n; i += 1) {
    await page.dispatchKey();
    await page.sleep(intervalMs);
  }
  await page.sleep(intervalMs * 2);
  return await page.readSamples();
}

/** 样本数下限校验（原口径：少于 90% 视为本次测量失败，不写结果文件）。 */
export function validateSampleCount(samples, n = N) {
  if (samples.length < n * 0.9) {
    throw new Error(
      `only ${samples.length}/${n} samples collected; rAF may not fire in this headless mode`
    );
  }
  return samples;
}

/**
 * 开一个装着启动探针的页面：**先建空白页、装探针、再导航**。顺序是硬约束——探针经
 * `Page.addScriptToEvaluateOnNewDocument` 注册在 document 创建时、页面脚本之前，app-ready 才
 * 不会漏；反过来先导航再补探针会丢掉这次导航里的 app-ready。抽成函数是为了让机器测试直接
 * 断言这段调用顺序（不是读源码文本）。
 */
export async function openInstrumentedPage({ cdp, url }) {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Runtime.enable", {}, sessionId);
  await cdp("Page.enable", {}, sessionId);
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: STARTUP_PROBE_SOURCE }, sessionId);
  await cdp("Page.navigate", { url }, sessionId);
  return sessionId;
}

/**
 * 一次完整测量：**先过挂载门禁，再装采样 hook，才发第一个键**。顺序就是这次修的东西
 * （旧实现等 readyState complete 就装 hook 发键），因此抽成一个可注入 page 的函数让机器测试守它。
 */
export async function measure({ page, n = N, intervalMs = INTERVAL_MS, readyOptions = {} }) {
  const startup = await waitForProductMount({ page, ...readyOptions });
  await page.evaluate(SAMPLING_HOOK_EXPRESSION);
  const samples = validateSampleCount(await collectSamples({ page, n, intervalMs }), n);
  return { startup, samples };
}

function isDirectRun() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
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

  // --- 启动 headless Chrome（一次性 profile + 两项 Chromium 隔离开关），经 DevToolsActivePort 发现 CDP 端口 ---
  const profile = await mkdtemp(path.join(os.tmpdir(), "lumir-ktp-chrome-"));
  const chromeProc = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--use-mock-keychain",
    "--password-store=basic",
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
    const sessionId = await openInstrumentedPage({ cdp, url: pageUrl });

    const page = {
      async evaluate(expression, params = {}) {
        const { result, exceptionDetails } = await cdp(
          "Runtime.evaluate",
          { expression, returnByValue: true, ...params },
          sessionId
        );
        if (exceptionDetails) {
          const detail = exceptionDetails.exception?.description ?? exceptionDetails.text;
          throw new Error(`page evaluate failed: ${detail}`);
        }
        return result.value;
      },
      dispatchKey: () =>
        cdp(
          "Input.dispatchKeyEvent",
          { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 },
          sessionId
        ),
      sleep,
      readSamples: async () => {
        const { result } = await cdp(
          "Runtime.evaluate",
          { expression: "window.__ktp", returnByValue: true },
          sessionId
        );
        return result.value ?? [];
      },
    };

    const { startup, samples } = await measure({ page, n: N });
    console.log(
      `[perf] keypress-to-paint startup gate: ${APP_READY_EVENT} ` +
        `(polls=${startup.polls}, readyState complete→app-ready ${startup.readyStateToAppReadyMs.toFixed(1)}ms, ` +
        `editor=${startup.editorAtAppReady}, settle=${startup.settle.settle} ${startup.settle.ms.toFixed(1)}ms)`
    );
    await writeResult({
      ...RESULT_CONTRACT,
      samples,
      meta: {
        samplesRequested: N,
        chrome: await cdp("Browser.getVersion").then((v) => v.product).catch(() => "unknown"),
        note: LOWER_BOUND_NOTE,
        startupGate: {
          event: APP_READY_EVENT,
          editorSelector: EDITOR_SELECTOR,
          polls: startup.polls,
          readyStateAtInstall: startup.readyStateAtInstall,
          readyStateCompleteAtMs: Number(startup.readyStateCompleteAt.toFixed(3)),
          appReadyAtMs: Number(startup.appReadyAt.toFixed(3)),
          readyStateAtAppReady: startup.readyStateAtAppReady,
          readyStateCompleteToAppReadyMs: Number(startup.readyStateToAppReadyMs.toFixed(3)),
          editorAtAppReady: startup.editorAtAppReady,
          editorContentAtAppReady: startup.editorContentAtAppReady,
          settle: startup.settle,
        },
      },
    });
  } finally {
    ws.close();
    chromeProc.kill("SIGKILL");
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// 只有直接执行才跑测量；被机器测试 import 时只暴露纯函数（无副作用）。
if (isDirectRun()) await main();
