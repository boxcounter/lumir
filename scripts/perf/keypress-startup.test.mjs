// scripts/perf/keypress-startup.test.mjs — keypress-to-paint 注入起点的机器测试（零新增依赖：node:test）。
//
// 运行：node --test scripts/perf/keypress-startup.test.mjs
//
// 守的是什么（M737）：注入起点从「document.readyState === complete」改为「产品自报 app-ready
// + 编辑器在 DOM + 两个渲染帧」。要证明的命题是**时序**命题：
//   1) readyState 已 complete、但产品还没挂载的那个窗口里，harness 不装采样 hook、不发第一个键；
//   2) app-ready 之后才装 hook、才计时（第一个键在 hook 之后）；
//   3) app-ready 等不到 / 到了但编辑器缺失时 fail-closed：报错、零采样、不写结果文件
//      （CI 因此报「结果缺失」而不是「超阈」）；
//   4) 页面侧启动探针本身不会把 readyState complete 当成产品已挂载（在 node:vm 里跑同一份源码）；
//   5) 指标身份与下界声明不变：metric/unit/contract、N=50、间隔 100ms、下界声明四项。
//
// 反向验证（REVIEW.md「假绿」条：断言必须有区分度）：test「旧门禁……」用同一套假页面复现
// readyState-only 的旧规则，证明它在产品挂载之前就开门了——若实现回退到旧规则，上面的
// 「第一个键在 app-ready 之后」断言就会红，而不是恒真。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  APP_READY_EVENT,
  DEFAULT_SAMPLES,
  EDITOR_CONTENT_SELECTOR,
  EDITOR_SELECTOR,
  INTERVAL_MS,
  LOWER_BOUND_NOTE,
  PROBE_STATE_EXPRESSION,
  READY_POLL_MS,
  RESULT_CONTRACT,
  SAMPLING_HOOK_EXPRESSION,
  SETTLE_EXPRESSION,
  SETTLE_FRAMES,
  STARTUP_PROBE_SOURCE,
  collectSamples,
  measure,
  openInstrumentedPage,
  validateSampleCount,
  waitForProductMount,
  waitFrames,
} from "./keypress-to-paint.mjs";

/**
 * 假页面：复现真实时序的三段——readyState loading → complete（旧门禁的起点）→ 产品挂载
 * （app-ready）。`evaluate` 每被轮询一次就把虚拟时钟推进 `pollAdvanceMs`，因此「轮询几次才开门」
 * 在测试里是确定的。
 */
function makeFakePage({
  readyStateCompleteAt = 120,
  appReadyAt = 340,
  editorAtAppReady = true,
  samples = [],
} = {}) {
  const log = [];
  let clock = 0;
  let polls = 0;
  const state = {
    installedAt: 0,
    readyStateAtInstall: "loading",
    readyStateCompleteAt: null,
    sawAppReadyEvent: false,
    appReadyAt: null,
    readyStateAtAppReady: null,
    editorAtAppReady: null,
    editorContentAtAppReady: null,
  };
  return {
    log,
    /** 轮询面板：每次轮询后的状态标记（complete / appReady），供断言取相位。 */
    probeLog: () => log.filter((e) => e.kind === "probe"),
    async evaluate(expression) {
      if (expression === PROBE_STATE_EXPRESSION) {
        polls += 1;
        if (state.readyStateCompleteAt === null && clock >= readyStateCompleteAt) {
          state.readyStateCompleteAt = readyStateCompleteAt;
        }
        if (!state.sawAppReadyEvent && clock >= appReadyAt) {
          state.sawAppReadyEvent = true;
          state.appReadyAt = appReadyAt;
          state.readyStateAtAppReady = "complete";
          state.editorAtAppReady = editorAtAppReady;
          state.editorContentAtAppReady = editorAtAppReady;
        }
        log.push({ kind: "probe", poll: polls, at: clock, complete: state.readyStateCompleteAt !== null, appReady: state.sawAppReadyEvent });
        return { ...state };
      }
      if (expression === SETTLE_EXPRESSION) {
        log.push({ kind: "settle", at: clock });
        clock += 30;
        return { settle: "frames", frames: 2, ms: 30 };
      }
      if (expression === SAMPLING_HOOK_EXPRESSION) {
        log.push({ kind: "hook", at: clock });
        return undefined;
      }
      throw new Error(`fake page 收到未预期的表达式：${String(expression).slice(0, 60)}`);
    },
    async sleep(ms) {
      log.push({ kind: "sleep", ms, at: clock });
      clock += ms;
    },
    async dispatchKey() {
      log.push({ kind: "dispatch", at: clock });
    },
    async readSamples() {
      log.push({ kind: "read", at: clock });
      return samples;
    },
  };
}

const sampleSet = (n = DEFAULT_SAMPLES) => Array.from({ length: n }, (_, i) => 8 + i * 0.25);
const firstOf = (page, kind) => page.log.find((e) => e.kind === kind);

test("readyState complete 时产品未挂载：不装 hook、不发键；app-ready 之后才计时", async () => {
  const page = makeFakePage({ samples: sampleSet() });
  const result = await measure({ page });

  assert.equal(result.samples.length, DEFAULT_SAMPLES, "样本数保持 N=50");

  const probes = page.probeLog();
  const firstComplete = probes.find((e) => e.complete);
  const firstAppReady = probes.find((e) => e.appReady);
  assert.ok(firstComplete, "readyState 必须在某次轮询里到达 complete（旧门禁的起点确实出现过）");
  assert.equal(firstComplete.appReady, false, "readyState complete 的那一刻产品必须还没挂载——这就是被修的污染窗口");
  assert.ok(firstAppReady.poll > firstComplete.poll, "app-ready 必须晚于 readyState complete");

  // 关键断言：整个污染窗口里没有 hook、没有按键；第一个键排在 hook 与 app-ready 之后。
  const hookAt = page.log.indexOf(firstOf(page, "hook"));
  const firstDispatchAt = page.log.indexOf(firstOf(page, "dispatch"));
  const appReadyAtLog = page.log.indexOf(firstAppReady);
  assert.ok(hookAt > appReadyAtLog, "采样 hook 必须在 app-ready 之后才装");
  assert.ok(firstDispatchAt > hookAt, "第一个键必须在 hook 之后才发");
  assert.equal(
    page.log.filter((e) => e.kind === "hook").length,
    1,
    "hook 只装一次（重复装会让同一按键记两个样本）"
  );
  assert.equal(page.log.filter((e) => e.kind === "dispatch").length, DEFAULT_SAMPLES, "每个样本一次按键");

  // 诊断口径：readyState complete → app-ready 的时长被如实记下来（CI artifact 里能复核）。
  assert.equal(result.startup.readyStateToAppReadyMs, 340 - 120);
  assert.equal(result.startup.editorAtAppReady, true);
  assert.equal(result.startup.settle.settle, "frames");

  // 第一个键的虚拟时刻必须落在 app-ready 之后（「挂载后才计时」）。
  assert.ok(firstOf(page, "dispatch").at >= 340);
});

test("反向验证：旧门禁（readyState-only）会在产品挂载之前开门——本测试的断言有区分度", async () => {
  // 复现修复前的规则：readyState complete 就开测。
  const legacyGate = async (page) => {
    for (;;) {
      const state = await page.evaluate(PROBE_STATE_EXPRESSION);
      if (state.readyStateCompleteAt !== null) return state;
      await page.sleep(READY_POLL_MS);
    }
  };
  const page = makeFakePage();
  const opened = await legacyGate(page);
  assert.equal(opened.readyStateCompleteAt, 120, "旧门禁在 120ms 就开门");
  assert.equal(opened.sawAppReadyEvent, false, "彼时产品还没挂载（app-ready 未到）");
  assert.equal(opened.appReadyAt, null);
  // 即：旧规则下「第一个键在 app-ready 之后」必然不成立——上面的断言因此不是恒真。
});

test("fail-closed：app-ready 等不到时报错、零采样、不写结果文件", async () => {
  const page = makeFakePage({ appReadyAt: Number.POSITIVE_INFINITY });
  await assert.rejects(measure({ page }), /没有等到 lumir:app-ready/);
  assert.equal(page.log.filter((e) => e.kind === "hook").length, 0, "没挂载就绝不装 hook");
  assert.equal(page.log.filter((e) => e.kind === "dispatch").length, 0, "没挂载就绝不发键");
  assert.equal(page.log.filter((e) => e.kind === "read").length, 0);
});

test("fail-closed：app-ready 到了但编辑器不在 DOM——报错且零采样（页面形态与 spec 声明不符）", async () => {
  const page = makeFakePage({ editorAtAppReady: false });
  await assert.rejects(measure({ page }), /\.cm-editor 不在 DOM/);
  assert.equal(page.log.filter((e) => e.kind === "hook").length, 0);
  assert.equal(page.log.filter((e) => e.kind === "dispatch").length, 0);
});

test("探针未装上（导航未提交）时不断言成空值：等到超时报「未装上」", async () => {
  const page = makeFakePage();
  page.evaluate = async (expression) => {
    // 页面还没换成新文档：探针不存在，返回 null。
    if (expression === PROBE_STATE_EXPRESSION) return null;
    throw new Error("不应走到这里");
  };
  await assert.rejects(
    waitForProductMount({ page, timeoutMs: 50, pollMs: 10 }),
    /探针未装上/
  );
});

test("导航竞态：旧文档执行上下文被销毁（evaluate 抛错）按「未就绪」重试，不判失败", async () => {
  const page = makeFakePage({ samples: sampleSet() });
  const rawEvaluate = page.evaluate.bind(page);
  let thrown = 0;
  page.evaluate = async (expression, params) => {
    if (expression === PROBE_STATE_EXPRESSION && thrown < 3) {
      thrown += 1;
      throw new Error("Execution context was destroyed.");
    }
    return rawEvaluate(expression, params);
  };
  const result = await measure({ page });
  assert.equal(thrown, 3, "前 3 次轮询确实抛过错（夹具生效）");
  assert.equal(result.samples.length, DEFAULT_SAMPLES);
  assert.ok(result.startup.polls > 3, "抛错的轮询不占开门条件，门禁照常等到 app-ready");
});

test("采样口径未变：N 次按键、100ms 间隔、末尾多留两个间隔", async () => {
  const samples = [1, 2, 3];
  const page = makeFakePage({ samples });
  const got = await collectSamples({ page, n: 3, intervalMs: INTERVAL_MS });
  assert.deepEqual(got, samples);
  assert.equal(page.log.filter((e) => e.kind === "dispatch").length, 3);
  assert.deepEqual(
    page.log.filter((e) => e.kind === "sleep").map((e) => e.ms),
    [100, 100, 100, 200]
  );
});

test("样本数下限 90% 保留：44/50 判测量失败、45/50 通过", () => {
  assert.equal(validateSampleCount(Array.from({ length: 45 }, () => 1), 50).length, 45);
  assert.throws(() => validateSampleCount(Array.from({ length: 44 }, () => 1), 50), /only 44\/50 samples collected/);
});

test("指标身份与下界声明不变：metric/unit/contract、N=50、100ms 间隔", () => {
  assert.deepEqual(RESULT_CONTRACT, { metric: "keypress-to-paint", unit: "ms", contract: 16 });
  assert.equal(DEFAULT_SAMPLES, 50);
  assert.equal(INTERVAL_MS, 100);
  assert.match(LOWER_BOUND_NOTE, /LOWER BOUND/);
  assert.match(LOWER_BOUND_NOTE, /OS 输入管道/);
  assert.match(LOWER_BOUND_NOTE, /Blink≠WKWebView/);
  assert.match(LOWER_BOUND_NOTE, /编辑器文本写入路径/);
});

// --- 页面侧启动探针：在 node:vm 里跑与页面里同一份源码 ---

function makeProbeWorld({ selectors = [], readyStateAtInstall = "loading" } = {}) {
  let clock = 0;
  const winListeners = new Map();
  const docListeners = new Map();
  const add = (map, type, fn) => {
    const arr = map.get(type) ?? [];
    arr.push(fn);
    map.set(type, arr);
  };
  const fire = (map, type) => {
    for (const fn of map.get(type) ?? []) fn({ type });
  };
  const win = { addEventListener: (type, fn) => add(winListeners, type, fn) };
  const doc = {
    readyState: readyStateAtInstall,
    addEventListener: (type, fn) => add(docListeners, type, fn),
    querySelector: (sel) => (selectors.includes(sel) ? {} : null),
  };
  const performance = { now: () => clock };
  vm.runInNewContext(STARTUP_PROBE_SOURCE, { window: win, document: doc, performance });
  return {
    state: () => win.__ktpStartup,
    at(ms) {
      clock = ms;
    },
    setReadyState(next) {
      doc.readyState = next;
      fire(docListeners, "readystatechange");
    },
    fireAppReady() {
      fire(winListeners, APP_READY_EVENT);
    },
  };
}

test("探针：readyState complete ≠ 产品已挂载；app-ready 才置挂载时刻", () => {
  const world = makeProbeWorld();
  const state = world.state();
  assert.equal(state.readyStateAtInstall, "loading");
  assert.equal(state.readyStateCompleteAt, null);
  assert.equal(state.sawAppReadyEvent, false);

  world.at(120);
  world.setReadyState("complete");
  assert.equal(state.readyStateCompleteAt, 120, "complete 时刻被如实记录（诊断基线）");
  assert.equal(state.sawAppReadyEvent, false, "加载完成不等于产品挂载——探针不在这里置位");
  assert.equal(state.appReadyAt, null);

  world.at(340);
  world.fireAppReady();
  assert.equal(state.appReadyAt, 340);
  assert.equal(state.sawAppReadyEvent, true);
  assert.equal(state.readyStateAtAppReady, "complete");
  assert.equal(state.editorAtAppReady, false, "该 world 的 querySelector 恒空：编辑器缺失被如实记为 false");

  // 重复事件不覆盖首次时刻。
  world.at(900);
  world.fireAppReady();
  assert.equal(state.appReadyAt, 340);
});

test("探针：app-ready 时编辑器在 DOM 则记为 true（两个选择器各记一次）", () => {
  const world = makeProbeWorld({ selectors: [EDITOR_SELECTOR, EDITOR_CONTENT_SELECTOR] });
  world.at(10);
  world.setReadyState("complete");
  world.at(240);
  world.fireAppReady();
  assert.equal(world.state().editorAtAppReady, true);
  assert.equal(world.state().editorContentAtAppReady, true);
});

test("探针：document 创建时已 complete 的防御分支不多算、也不被后续事件改写", () => {
  const world = makeProbeWorld({ readyStateAtInstall: "complete" });
  assert.equal(world.state().readyStateCompleteAt, 0, "装着即 complete：以安装时刻为准");
  world.at(120);
  world.setReadyState("complete");
  assert.equal(world.state().readyStateCompleteAt, 0);
});

test("探针装上顺序：先建空白页装探针、再导航（直接导航会漏掉 app-ready）", async () => {
  const calls = [];
  const cdp = async (method, params = {}, sessionId) => {
    calls.push({ method, params, sessionId });
    if (method === "Target.createTarget") return { targetId: "T1" };
    if (method === "Target.attachToTarget") return { sessionId: "S1" };
    return {};
  };
  const sessionId = await openInstrumentedPage({ cdp, url: "http://127.0.0.1:1234/" });
  assert.equal(sessionId, "S1");
  assert.equal(calls[0].method, "Target.createTarget");
  assert.equal(calls[0].params.url, "about:blank", "target 必须建在空白页上，不能直接用被测 URL");
  const injectAt = calls.findIndex((c) => c.method === "Page.addScriptToEvaluateOnNewDocument");
  const navigateAt = calls.findIndex((c) => c.method === "Page.navigate");
  assert.ok(injectAt > 0, "必须注入启动探针");
  assert.ok(navigateAt > injectAt, "注入必须早于导航");
  assert.equal(calls[injectAt].params.source, STARTUP_PROBE_SOURCE, "注入的就是上面 vm 测过的那份源码");
  assert.equal(calls[navigateAt].params.url, "http://127.0.0.1:1234/");
});

// --- 稳定期：数的是渲染帧，不是定时器 ---

function makeFakeFrameHost() {
  const rafs = [];
  let timer = null;
  return {
    requestAnimationFrame(cb) {
      rafs.push(cb);
    },
    setTimeout(cb) {
      timer = cb;
    },
    frame() {
      const next = rafs.shift();
      if (next) next();
    },
    fireTimeout() {
      if (timer) timer();
    },
    pendingFrames: () => rafs.length,
  };
}

test("稳定期等 SETTLE_FRAMES 个渲染帧；少一帧不算过（不是固定 sleep）", async () => {
  let clock = 0;
  const host = makeFakeFrameHost();
  const settled = waitFrames(host, () => clock, 2000, SETTLE_FRAMES);

  let done = false;
  settled.then(() => {
    done = true;
  });
  host.frame();
  clock = 10;
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, "一帧就返回等于没等稳定期");
  assert.equal(host.pendingFrames(), 1, "第一帧之后还要再要帧");

  clock = 20;
  host.frame();
  assert.deepEqual(await settled, { settle: "frames", frames: SETTLE_FRAMES, ms: 20 });
});

test("稳定期帧数由 SETTLE_FRAMES 真的驱动（3 帧就要跑 3 次回调，不是只改日志文案）", async () => {
  const host = makeFakeFrameHost();
  const settled = waitFrames(host, () => 0, 2000, 3);
  host.frame();
  host.frame();
  await new Promise((r) => setImmediate(r));
  assert.equal(host.pendingFrames(), 1, "3 帧的等待在第 2 帧后仍要再要一帧");
  host.frame();
  assert.deepEqual(await settled, { settle: "frames", frames: 3, ms: 0 });
});

test("稳定期上界：帧源不派发时按 timeout 返回（不挂死，交给样本数校验报缺样本）", async () => {
  const host = makeFakeFrameHost();
  const settled = waitFrames(host, () => 0, 2000, SETTLE_FRAMES);
  host.fireTimeout();
  assert.deepEqual(await settled, { settle: "timeout", frames: 0, ms: 0 });
});
