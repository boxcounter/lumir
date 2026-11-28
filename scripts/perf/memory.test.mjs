// scripts/perf/memory.test.mjs — 常驻内存归因污染护栏的纯函数夹具测试（零新增依赖：node:test）。
//
// 运行：node --test scripts/perf/memory.test.mjs
//
// 覆盖（M723 mission）：
//   1) report §2.2 的 11 次异常形态：全部判污染，且首个违规样本与判据种类与夹具一致；
//   2) 正常 2 / 3 helper（CI / 本机）与 pid 顺序抖动：不判污染；
//   3) 窗口内 helper 新增 / 退出 / 换人：只靠集合稳定性判据也要抓到；
//   4) 有界重测：首轮污染 → 第二轮接受；连续污染 → failed(contaminated)，且最多只跑 2 轮；
//   5) 污染轮读数绝不进最终样本（max 统计只取被接受那轮）；
//   6) 反向验证：每条夹具在关掉对应判据后必须变干净、正常夹具注入噪声后必须判红——
//      证明断言不是恒真（REVIEW.md「假绿」条的反向验证纪律）；
//   7) 诊断完整性（r1 P2-1）：被归因进程明细是「全轮并集」而非末样本；中途出现后于末样本前退出的
//      helper 仍保留 pid/ppid/lstart/comm；每轮摘要与该轮的 excludedBaselineWebKit 共用同一形状，
//      成功结果与被丢弃轮、连续污染诊断件都不丢字段；
//   8) 外来 helper 判别（2026-11-28）：late+survived 才排除（正常 2/3、晚到外部、app 退出后存活、
//      真实晚建 helper、慢 runner 窗口），诊断字段齐全；早到但存活仍判污染、晚建但随 app 退出仍计数
//      （不洗绿）；阈值/maxHelpers/contract 不变。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessRound,
  attribute,
  buildContaminatedPayload,
  buildMeta,
  classifyForeignHelpers,
  evaluateRound,
  excludeForeignHelpers,
  filterAliveIdentities,
  mergeProcessDetails,
  nextStep,
  parseLstartEpochMs,
  parseProcTable,
  resolveRun,
  summarizeAttempt,
  waitForPidsGone,
  CONTAMINATION_REASON,
  EARLY_WINDOW_MS,
  MAX_ATTEMPTS,
  MAX_HELPERS,
  READY_MARGIN_MS,
  SURVIVAL_GRACE_MS,
} from "./memory.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, "../../tests/perf/fixtures/memory-contamination-cases.json");
const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const samplesOf = (caseDef) =>
  caseDef.helpersPerSample.map((helperPids, i) => ({
    // mb 与 helper 数挂钩，便于断言「污染轮的大读数没进最终样本」
    mb: 200 + helperPids.length * 20 + i,
    helperPids,
  }));

const byKind = (kind) => fixtures.cases.filter((c) => c.kind === kind);

test("夹具覆盖 report 的全部 11 次异常 run", () => {
  assert.equal(byKind("abnormal").length, 11);
  assert.equal(byKind("normal").length, 3);
  assert.equal(byKind("window").length, 3);
  assert.equal(fixtures.maxHelpers, MAX_HELPERS);
});

test("11 次异常形态全部判污染，首违规样本与判据种类与 report 对得上", () => {
  for (const caseDef of byKind("abnormal")) {
    const result = evaluateRound(samplesOf(caseDef), { maxHelpers: fixtures.maxHelpers });
    assert.equal(result.contaminated, true, `${caseDef.id} 应判污染`);
    assert.equal(
      result.reasons[0].sample,
      caseDef.expect.firstViolationSample,
      `${caseDef.id} 首个违规样本应为 ${caseDef.expect.firstViolationSample}`
    );
    for (const kind of caseDef.expect.kinds) {
      assert.ok(
        result.reasons.some((r) => r.kind === kind),
        `${caseDef.id} 应出现 ${kind} 判据，实际 ${JSON.stringify(result.reasons.map((r) => r.kind))}`
      );
    }
    // 反向验证：两条判据都关掉后同一夹具必须变干净——污染信号确实来自这两条判据，
    // 而不是夹具里的 mb / 样本数之类的附带形状。
    const blind = evaluateRound(samplesOf(caseDef), {
      maxHelpers: Number.MAX_SAFE_INTEGER,
      checkSetStability: false,
    });
    assert.equal(blind.contaminated, false, `${caseDef.id} 关掉判据后不应再判污染`);
  }
});

test("正常 2 / 3 helper 与 pid 顺序抖动不判污染", () => {
  for (const caseDef of byKind("normal")) {
    const samples = samplesOf(caseDef);
    const result = evaluateRound(samples, { maxHelpers: fixtures.maxHelpers });
    assert.equal(result.contaminated, false, `${caseDef.id} 不应判污染`);
    assert.equal(result.firstHelperPids.length, caseDef.helpersPerSample[0].length);

    // 反向验证一：任一中间样本多出第 4 个 helper（计数判据必须响）。
    const extra = samples.map((s, i) =>
      i === 2 ? { ...s, helperPids: [...s.helperPids, 9999] } : s
    );
    assert.equal(evaluateRound(extra, { maxHelpers: fixtures.maxHelpers }).contaminated, true);

    // 反向验证二：只换掉第 4 个样本里的一个 pid（集合判据必须响，且与计数无关）。
    const swapped = samples.map((s, i) =>
      i === 3 ? { ...s, helperPids: [8888, ...s.helperPids.slice(1)] } : s
    );
    const swappedResult = evaluateRound(swapped, { maxHelpers: fixtures.maxHelpers });
    assert.equal(swappedResult.contaminated, true);
    assert.ok(swappedResult.reasons.every((r) => r.kind === "helper-set-changed"));
  }
});

test("窗口内 helper 新增 / 退出 / 换人：集合稳定性判据单独即可抓到", () => {
  for (const caseDef of byKind("window")) {
    const samples = samplesOf(caseDef);
    const result = evaluateRound(samples, { maxHelpers: fixtures.maxHelpers });
    assert.equal(result.contaminated, true, `${caseDef.id} 应判污染`);
    assert.equal(result.reasons[0].sample, caseDef.expect.firstViolationSample);
    for (const kind of caseDef.expect.kinds) {
      assert.ok(result.reasons.some((r) => r.kind === kind), `${caseDef.id} 应出现 ${kind}`);
    }
    // 计数上限放到无穷大、只留集合判据：仍必须判污染（证明规则 2 是独立的防线）。
    const setOnly = evaluateRound(samples, {
      maxHelpers: Number.MAX_SAFE_INTEGER,
      checkSetStability: true,
    });
    assert.equal(setOnly.contaminated, true, `${caseDef.id} 只靠集合判据也应判污染`);
    assert.ok(setOnly.reasons.every((r) => r.kind === "helper-set-changed"));
    // 反向验证：关掉集合判据后（上限仍 3）必须变干净——这些形态只有规则 2 能抓。
    const countOnly = evaluateRound(samples, {
      maxHelpers: fixtures.maxHelpers,
      checkSetStability: false,
    });
    assert.equal(countOnly.contaminated, false, `${caseDef.id} 不应被计数判据误抓`);
  }
});

test("helper 数 > 3 单独构成污染（计数判据不依赖集合是否稳定）", () => {
  const stable4 = [1, 2, 3, 4].map(() => ({ mb: 300, helperPids: [5101, 5102, 5103, 5104] }));
  const result = evaluateRound(stable4, { maxHelpers: fixtures.maxHelpers, checkSetStability: false });
  assert.equal(result.contaminated, true);
  // 每个样本都超上限 ⇒ 每个样本各记一条，全部是 helper-count（没有集合判据的份）。
  assert.equal(result.reasons.length, stable4.length);
  assert.ok(result.reasons.every((r) => r.kind === "helper-count"));
  assert.deepEqual(result.reasons.map((r) => r.sample), [1, 2, 3, 4]);
  // 边界：恰好 3 个（本机正常形态）不判红。
  const stable3 = [1, 2, 3, 4].map(() => ({ mb: 300, helperPids: [5201, 5202, 5203] }));
  assert.equal(evaluateRound(stable3, { maxHelpers: fixtures.maxHelpers }).contaminated, false);
});

test("重测前上一轮 helper 未退出（stale-helper）也判污染，且不影响正常轮", () => {
  const clean = [1, 2, 3].map(() => ({ mb: 230, helperPids: [5301, 5302, 5303] }));
  assert.equal(evaluateRound(clean).contaminated, false);
  const stale = evaluateRound(clean, { staleHelperPids: [5303, 5301] });
  assert.equal(stale.contaminated, true);
  assert.deepEqual(stale.reasons.map((r) => r.kind), ["stale-helper"]);
  assert.deepEqual(stale.reasons[0].detail.helperPids, [5301, 5303]); // 排序后落盘
});

test("有界重测：首轮污染 → 第二轮接受；连续污染 → contaminated，且只跑 2 轮", () => {
  const clean = { attempt: 1, contaminated: false, samples: [{ mb: 210 }, { mb: 212 }] };
  const dirty = (attempt) => ({
    attempt,
    contaminated: true,
    reasons: [{ sample: 1, kind: "helper-count", detail: { helperCount: 7 } }],
    samples: [{ mb: 356.6 }, { mb: 356.5 }],
  });

  // 首轮干净：直接接受，不重测。
  assert.deepEqual(nextStep([]), { action: "measure", attempt: 1 });
  assert.deepEqual(nextStep([clean]), { action: "accept", attempt: 1 });

  // 首轮污染：要求第 2 轮（有界重测 1 次）。
  assert.deepEqual(nextStep([dirty(1)]), { action: "measure", attempt: 2 });

  // 第 2 轮干净：接受第 2 轮。
  assert.deepEqual(nextStep([dirty(1), { ...clean, attempt: 2 }]), { action: "accept", attempt: 2 });

  // 连续污染：失败原因为 contaminated，且绝不要求第 3 轮。
  const failed = nextStep([dirty(1), dirty(2)]);
  assert.equal(failed.action, "fail");
  assert.equal(failed.reason, CONTAMINATION_REASON);
  assert.equal(CONTAMINATION_REASON, "contaminated");
  assert.notEqual(CONTAMINATION_REASON, "over-threshold");
  assert.equal(MAX_ATTEMPTS, 2);

  // 驱动完整状态机（给 3 轮污染数据）：只消费 2 轮，第 3 轮连读都不读。
  const consumed = [];
  const attempts = [];
  const available = [dirty(1), dirty(2), dirty(3)];
  for (;;) {
    const step = nextStep(attempts);
    if (step.action !== "measure") break;
    consumed.push(step.attempt);
    attempts.push(available[step.attempt - 1]);
  }
  assert.deepEqual(consumed, [1, 2]);
  assert.equal(nextStep(attempts).action, "fail");
});

test("污染轮读数不进最终样本：max 只取被接受那轮的读数", () => {
  const contaminatedRound = {
    attempt: 1,
    contaminated: true,
    samples: [{ mb: 356.1 }, { mb: 355.9 }, { mb: 355.6 }, { mb: 355.6 }, { mb: 355.5 }],
  };
  const cleanRound = {
    attempt: 2,
    contaminated: false,
    samples: [{ mb: 224.8 }, { mb: 230.1 }, { mb: 234.8 }, { mb: 231.2 }, { mb: 229.0 }],
  };
  const resolved = resolveRun([contaminatedRound, cleanRound]);
  assert.equal(resolved.status, "ok");
  assert.equal(resolved.acceptedAttempt, 2);
  assert.deepEqual(resolved.samples, [224.8, 230.1, 234.8, 231.2, 229.0]);
  assert.equal(Math.max(...resolved.samples), 234.8);

  // 反向验证：若错误地把污染轮并进样本（旧口径的隐患），max 会变成 356.1——门禁读数差 121MB。
  const merged = [...contaminatedRound.samples, ...cleanRound.samples].map((s) => s.mb);
  assert.equal(Math.max(...merged), 356.1);
  assert.notEqual(Math.max(...merged), Math.max(...resolved.samples));

  // 连续污染：没有任何样本可上报（调用方据此不写 resident-memory.json）。
  const failed = resolveRun([contaminatedRound, { ...contaminatedRound, attempt: 2 }]);
  assert.equal(failed.status, "contaminated");
  assert.equal(failed.reason, CONTAMINATION_REASON);
  assert.deepEqual(failed.samples, []);
});

test("attribute：基线 WebKit 排除、ppid 子树与差集 helper 各自归因", () => {
  const table = [
    { pid: 100, ppid: 1, rssKB: 1024, lstart: "Fri Oct 24 10:00:00 2026", comm: "/repo/src-tauri/target/release/lumir" },
    { pid: 202, ppid: 100, rssKB: 512, lstart: "Fri Oct 24 10:00:01 2026", comm: "/repo/child-helper" },
    {
      pid: 200,
      ppid: 1,
      rssKB: 2048,
      lstart: "Fri Oct 24 10:00:02 2026",
      comm: "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent",
    },
    {
      pid: 201,
      ppid: 1,
      rssKB: 4096,
      lstart: "Fri Oct 24 09:00:00 2026",
      comm: "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU",
    },
  ];
  const baseline = new Set([201]); // 启动前就存在的外来 GPU 进程：排除
  const result = attribute(table, 100, baseline);
  assert.deepEqual(result.appPids, [100, 202]);
  assert.deepEqual(result.helperPids, [200]);
  assert.deepEqual(result.pids, [100, 200, 202]);
  assert.equal(result.mb, (1024 + 512 + 2048) / 1024);
  assert.deepEqual(result.processes.map((p) => p.pid), [100, 200, 202]);
  assert.equal(result.processes[1].ppid, 1);
  assert.match(result.processes[1].lstart, /^Fri Oct 24 10:00:02 2026$/);

  // 反向验证：同一张表若不带基线，201 也会被算进来（helper 2 个 + RSS 多算 4MB）。
  const noBaseline = attribute(table, 100, new Set());
  assert.deepEqual(noBaseline.helperPids, [200, 201]);
  assert.equal(noBaseline.mb, (1024 + 512 + 2048 + 4096) / 1024);
});

test("parseProcTable：真实 ps 行格式（含单数字日期填充与带空格的 comm）", () => {
  const stdout = [
    "    1     0  21280 Sun Oct 11 22:07:29 2026     /sbin/launchd",
    "  604     1   9408 Mon Oct 12 08:31:52 2026     /usr/libexec/UserEventAgent",
    " 1234     1   5555 Fri Oct  3 09:00:00 2026     /Applications/Some App.app/Contents/MacOS/Some App",
    "  777     1    384 Sun Oct 11 22:07:30 2026     /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent",
    "garbage line without columns",
  ].join("\n");
  const table = parseProcTable(stdout);
  assert.equal(table.length, 4);
  assert.deepEqual(table[0], { pid: 1, ppid: 0, rssKB: 21280, lstart: "Sun Oct 11 22:07:29 2026", comm: "/sbin/launchd" });
  assert.equal(table[2].lstart, "Fri Oct 3 09:00:00 2026"); // 单数字日期归一化
  assert.equal(table[2].comm, "/Applications/Some App.app/Contents/MacOS/Some App");
  assert.ok(table[3].comm.includes("com.apple.WebKit.WebContent"));
});

// --- r1 P2-1：诊断完整性（全轮并集 + 每轮 excludedBaselineWebKit） ---

const procDetail = (pid, lstart, comm, ppid = 1) => ({ pid, ppid, lstart, comm });
const APP = () => procDetail(100, "Sat Oct 24 23:20:00 2026", "/repo/src-tauri/target/release/lumir", 0);
const WEB_CONTENT = () => procDetail(101, "Sat Oct 24 23:20:01 2026", "/System/Library/WebKit/com.apple.WebKit.WebContent");
const GPU = () => procDetail(102, "Sat Oct 24 23:20:01 2026", "/System/Library/WebKit/com.apple.WebKit.GPU");

/**
 * 造一轮采样：helper 在样本 2 出现、样本 3 起已退出（末样本没有它）。
 * 这正是集合稳定性判据要抓的「新增后退出」现场，也是 r1 P2-1 指出的旧口径丢明细之处。
 */
function transientRoundSamples({ transientPid = 103 } = {}) {
  const transient = procDetail(transientPid, "Sat Oct 24 23:20:02 2026", "/System/Library/WebKit/com.apple.WebKit.Networking");
  const stable = [APP(), WEB_CONTENT(), GPU()];
  return [
    { mb: 230.1, helperPids: [101, 102], processes: stable },
    { mb: 231.2, helperPids: [101, 102, transientPid], processes: [...stable, transient] },
    { mb: 230.8, helperPids: [101, 102], processes: stable },
    { mb: 230.4, helperPids: [101, 102], processes: stable },
    { mb: 230.0, helperPids: [101, 102], processes: stable },
  ];
}

// 测试侧独立实现的并集（不借生产函数），避免「用被测函数造夹具」的循环论证。
function unionByPidLstart(samples) {
  const out = [];
  for (const sample of samples) {
    for (const p of sample.processes ?? []) {
      if (!out.some((q) => q.pid === p.pid && q.lstart === p.lstart)) out.push(p);
    }
  }
  return out.sort((a, b) => a.pid - b.pid || a.lstart.localeCompare(b.lstart));
}

function attemptOf({ attempt = 1, samples, contaminated = false, excluded = [] }) {
  const attributed = unionByPidLstart(samples);
  return {
    attempt,
    contaminated,
    reasons: contaminated ? [{ sample: 2, kind: "helper-set-changed", detail: { added: [103], removed: [] } }] : [],
    samples,
    helperCounts: samples.map((s) => s.helperPids.length),
    sampleHelperPids: samples.map((s) => s.helperPids),
    helperPidsAtExit: samples.at(-1).helperPids,
    leftoverHelperPids: [],
    attributedPids: [...new Set(attributed.map((p) => p.pid))].sort((a, b) => a - b),
    attributed,
    excludedBaselineWebKit: excluded,
  };
}

test("mergeProcessDetails：按 pid+lstart 去重的全轮并集，保留中途出现后退出与 pid 复用", () => {
  const samples = transientRoundSamples();
  const merged = mergeProcessDetails(samples);
  // 稳定进程在 5 个样本里各出现一次 → 并集只留一条
  assert.equal(merged.filter((p) => p.pid === 101).length, 1);
  // 中途出现（样本 2）且末样本已退出 → 仍在并集里，四字段齐全
  assert.deepEqual(merged.find((p) => p.pid === 103), {
    pid: 103,
    ppid: 1,
    lstart: "Sat Oct 24 23:20:02 2026",
    comm: "/System/Library/WebKit/com.apple.WebKit.Networking",
  });
  // 反向：末样本确实没有 103——旧口径（只取末样本 processes）会把它整条丢掉
  assert.equal(samples.at(-1).processes.some((p) => p.pid === 103), false);
  // pid 复用：同 pid 不同 lstart 是两个进程，不去重
  const reused = mergeProcessDetails([
    { processes: [procDetail(101, "Sat Oct 24 10:00:00 2026", "a")] },
    { processes: [procDetail(101, "Sat Oct 24 11:00:00 2026", "b")] },
  ]);
  assert.deepEqual(reused.map((p) => `${p.pid}@${p.lstart}`), [
    "101@Sat Oct 24 10:00:00 2026",
    "101@Sat Oct 24 11:00:00 2026",
  ]);
  // 并集排序稳定
  assert.deepEqual(merged.map((p) => p.pid), [100, 101, 102, 103]);
});

test("summarizeAttempt：被丢弃轮也保留中途退出 helper 的明细与该轮 excludedBaselineWebKit", () => {
  const excluded = [procDetail(501, "Fri Oct 24 09:00:00 2026", "/System/Library/WebKit/com.apple.WebKit.GPU")];
  const attempt = attemptOf({ attempt: 1, samples: transientRoundSamples(), contaminated: true, excluded });
  const summary = summarizeAttempt(attempt);

  const transient = summary.attributed.find((p) => p.pid === 103);
  assert.ok(transient, "全轮并集必须保留中途出现的 helper");
  assert.equal(transient.ppid, 1);
  assert.equal(transient.lstart, "Sat Oct 24 23:20:02 2026");
  assert.match(transient.comm, /com\.apple\.WebKit\.Networking$/);
  assert.ok(summary.sampleHelperPids[1].includes(103)); // 样本 2 出现
  assert.ok(!summary.sampleHelperPids[4].includes(103)); // 末样本前已退出
  assert.ok(summary.attributedPids.includes(103));
  // r1 P2-1 的核心缺口：每轮必须带该轮基线排除明细
  assert.deepEqual(summary.excludedBaselineWebKit, excluded);

  // 反向：旧口径（末样本明细 + 无 excludedBaselineWebKit）在这两条上必红
  const legacyShape = { attributed: attempt.samples.at(-1).processes };
  assert.equal(legacyShape.attributed.some((p) => p.pid === 103), false);
  assert.equal("excludedBaselineWebKit" in legacyShape, false);
});

test("buildMeta：成功结果同时保留被丢弃轮的完整摘要与该轮 excludedBaselineWebKit", () => {
  const round1 = attemptOf({
    attempt: 1,
    contaminated: true,
    samples: transientRoundSamples({ transientPid: 103 }),
    excluded: [procDetail(501, "Fri Oct 24 09:00:00 2026", "/System/Library/WebKit/com.apple.WebKit.GPU")],
  });
  const round2 = attemptOf({
    attempt: 2,
    samples: [0, 1, 2, 3, 4].map(() => ({
      mb: 230.0,
      helperPids: [101, 102],
      processes: [APP(), WEB_CONTENT(), GPU()],
    })),
    excluded: [procDetail(502, "Fri Oct 24 09:00:01 2026", "/System/Library/WebKit/com.apple.WebKit.Networking")],
  });
  const meta = buildMeta({
    attempts: [round1, round2],
    acceptedAttempt: 2,
    panes: 0,
    xdgConfigHome: "/tmp/perf-xdg",
    home: "/tmp/perf-home",
  });

  assert.equal(meta.attemptsUsed, 2);
  assert.equal(meta.acceptedAttempt, 2);
  assert.equal(meta.attempts[0].contaminated, true);
  assert.deepEqual(meta.attempts[0].excludedBaselineWebKit, round1.excludedBaselineWebKit);
  assert.ok(meta.attempts[0].attributed.some((p) => p.pid === 103));
  assert.deepEqual(meta.attempts[1].excludedBaselineWebKit, round2.excludedBaselineWebKit);
  assert.deepEqual(meta.excludedBaselineWebKit, round2.excludedBaselineWebKit);
  assert.ok(!meta.attributed.some((p) => p.pid === 103)); // 接受轮不含被丢弃轮的 transient
  // 成功结果与被丢弃轮共用同一摘要形状
  assert.deepEqual(Object.keys(meta.attempts[0]).sort(), Object.keys(meta.attempts[1]).sort());
});

test("buildContaminatedPayload：连续污染诊断件两轮各带并集明细与自己的 excludedBaselineWebKit", () => {
  const round1 = attemptOf({
    attempt: 1,
    contaminated: true,
    samples: transientRoundSamples({ transientPid: 103 }),
    excluded: [procDetail(501, "Fri Oct 24 09:00:00 2026", "/System/Library/WebKit/com.apple.WebKit.GPU")],
  });
  const round2 = attemptOf({
    attempt: 2,
    contaminated: true,
    samples: transientRoundSamples({ transientPid: 203 }),
    excluded: [procDetail(502, "Fri Oct 24 09:00:01 2026", "/System/Library/WebKit/com.apple.WebKit.Networking")],
  });
  const payload = buildContaminatedPayload({
    metric: "resident-memory",
    attempts: [round1, round2],
    panes: 0,
    xdgConfigHome: "/tmp/perf-xdg",
    home: "/tmp/perf-home",
    reason: "contaminated",
    now: new Date("2026-10-24T15:40:00Z"),
  });

  assert.equal(payload.status, "contaminated");
  assert.equal(payload.reason, "contaminated");
  assert.equal(payload.gateEligible, false);
  assert.equal(payload.attemptsUsed, 2);
  assert.equal(payload.meta.ts, "2026-10-24T15:40:00.000Z");

  const expectedKeys = Object.keys(summarizeAttempt(round1)).sort();
  for (const [i, attempt] of [round1, round2].entries()) {
    const summary = payload.attempts[i];
    const transientPid = i === 0 ? 103 : 203;
    assert.deepEqual(Object.keys(summary).sort(), expectedKeys);
    assert.deepEqual(summary.excludedBaselineWebKit, attempt.excludedBaselineWebKit);
    assert.ok(summary.excludedBaselineWebKit.length > 0);
    assert.ok(summary.attributed.some((p) => p.pid === transientPid));
    // 每轮只带自己的 transient，不串轮
    assert.ok(!summary.attributed.some((p) => p.pid === (i === 0 ? 203 : 103)));
    // 反向：该轮末样本没有这个 transient——若摘要退回末样本口径，上面的断言必红
    assert.equal(attempt.samples.at(-1).processes.some((p) => p.pid === transientPid), false);
  }

  // 反向：旧摘要形状（末样本明细、无 excludedBaselineWebKit）不满足本测试的两个关键断言
  const legacySummary = { attributed: round1.samples.at(-1).processes };
  assert.equal(legacySummary.attributed.some((p) => p.pid === 103), false);
  assert.equal("excludedBaselineWebKit" in legacySummary, false);
});

// --- 外来 helper 判别（2026-11-28，K3 review 后修订）：
//     身份对 pid+lstart 贯穿分类/扣减/stale；lstart 失败无条件污染；a2/a3 真实回放走生产 assessRound 接线。 ---

const appStart = "Sat Nov 28 11:45:38 2026";
const appStartMs = parseLstartEpochMs(appStart);
const wk = (pid, lstart, comm = "com.apple.WebKit.WebContent", rssKB = 20 * 1024) => ({
  pid,
  ppid: 1,
  rssKB,
  lstart,
  comm: `/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/${comm}.xpc/Contents/MacOS/${comm}`,
});
const ident = (pid, lstart) => ({ pid, lstart });

test("parseLstartEpochMs：解析 ps lstart（1s 精度），垃圾输入返回 null", () => {
  const ms = parseLstartEpochMs("Sat Nov 28 11:45:43 2026");
  assert.equal(ms - appStartMs, 5000);
  assert.equal(parseLstartEpochMs("Fri Oct  3 09:00:00 2026") - parseLstartEpochMs("Fri Oct  3 09:00:02 2026"), -2000);
  for (const bad of ["", "not a date", "2026-11-28T11:45:43Z", null, undefined]) {
    assert.equal(parseLstartEpochMs(bad), null, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test("classifyForeignHelpers：正常 2/3 helper（早到、随 app 退出）不判外来", () => {
  const helpers = [wk(101, appStart), wk(102, "Sat Nov 28 11:45:39 2026", "com.apple.WebKit.Networking")];
  const result = classifyForeignHelpers({ helpers, appStartMs, earlyWindowMs: 3000, survivors: [] });
  assert.deepEqual(result.foreign, []);
  assert.deepEqual(result.unexplainedSurvivors, []);
  assert.deepEqual(result.unparsableHelpers, []);
  assert.equal(result.lateHelpers.length, 0);
});

test("classifyForeignHelpers：晚到且 app 退出后存活 ⇒ 外来；晚到但退出 ⇒ 保留；早到存活 ⇒ 不可判别", () => {
  const helpers = [
    wk(201, "Sat Nov 28 11:45:43 2026"), // +5s
    wk(202, "Sat Nov 28 11:45:47 2026"), // +9s
    wk(203, "Sat Nov 28 11:45:48 2026"), // +10s
    wk(204, appStart), // 早到
  ];
  const survivors = [helpers[0], helpers[2], helpers[3]].map((h) => ({ ...h }));
  const result = classifyForeignHelpers({ helpers, appStartMs, earlyWindowMs: 3000, survivors });
  assert.deepEqual(result.foreign.map((p) => p.pid), [201, 203]);
  assert.deepEqual(result.lateHelpers.map((p) => p.pid), [201, 202, 203]);
  assert.deepEqual(result.unexplainedSurvivors.map((p) => p.pid), [204]);
  assert.equal(result.foreign[0].startedAfterAppMs, 5000);
  assert.equal(result.foreign[0].survivedAfterAppExit, true);
});

test("classifyForeignHelpers：lstart 解析失败 ⇒ unparsable（与存活无关，两个方向都不可判别）", () => {
  const broken = { pid: 501, lstart: "garbage", comm: "com.apple.WebKit.WebContent" };
  for (const survivors of [[], [broken]]) {
    const result = classifyForeignHelpers({ helpers: [broken], appStartMs, earlyWindowMs: 3000, survivors });
    assert.deepEqual(result.foreign, []);
    assert.deepEqual(result.unparsableHelpers.map((p) => p.pid), [501]);
    assert.equal(result.unparsableHelpers[0].survivedAfterAppExit, survivors.length > 0);
  }
});

test("excludeForeignHelpers：按身份 pid+lstart 扣除——同 pid 不同 lstart 的本 app helper 不得误扣", () => {
  const own = { pid: 200, ppid: 1, lstart: "Sat Nov 28 11:45:39 2026", rssKB: 50 * 1024, comm: "com.apple.WebKit.WebContent" };
  const foreignLater = { pid: 200, ppid: 1, lstart: "Sat Nov 28 11:45:48 2026", rssKB: 30 * 1024, comm: "com.apple.WebKit.WebContent" };
  const ownSample = {
    mb: 280,
    helperPids: [200],
    helperRssKB: { 200: 50 * 1024 },
    processes: [{ pid: 200, lstart: own.lstart }],
  };
  const laterSample = {
    mb: 280,
    helperPids: [200],
    helperRssKB: { 200: 30 * 1024 },
    processes: [{ pid: 200, lstart: foreignLater.lstart }],
  };
  const foreign = [{ pid: 200, lstart: foreignLater.lstart }];
  // 早样本里 pid 200 是另一个身份（本 app helper）：RSS 与计数都不动
  assert.equal(excludeForeignHelpers(ownSample, foreign), ownSample);
  // 晚样本里 pid 200 是外来身份：只扣那一个样本
  const adjusted = excludeForeignHelpers(laterSample, foreign);
  assert.deepEqual(adjusted.helperPids, []);
  assert.equal(adjusted.mb, 280 - 30);
});

test("filterAliveIdentities + waitForPidsGone：pid 复用不算存活；身份匹配才等", async () => {
  const previous = [ident(700, "Sat Nov 28 11:45:39 2026")];
  const reused = [{ pid: 700, ppid: 1, rssKB: 1, lstart: "Sat Nov 28 11:45:48 2026", comm: "x" }];
  assert.deepEqual(filterAliveIdentities(reused, previous), [], "同 pid 不同 lstart 不是同一个进程");
  // 复用 pid 的进程不应制造假 stale：立即返回空
  const gone = await waitForPidsGone(previous, 5_000, async () => reused);
  assert.deepEqual(gone, []);
  // 身份仍在 ⇒ 等到超时并回报该 pid（夹具用 0ms 上限）
  const still = await waitForPidsGone(previous, 0, async () => [reused[0], { ...reused[0], lstart: previous[0].lstart }]);
  assert.deepEqual(still, [700]);
});

test("生产接线 assessRound：早到但存活 ⇒ helper-survived-app（不洗绿、不扣 RSS）", () => {
  const early = wk(701, appStart, undefined, 40 * 1024);
  const samples = [1, 2, 3, 4, 5].map(() => ({
    mb: 300,
    helperPids: [701],
    helperRssKB: { 701: 40 * 1024 },
    processes: [early],
  }));
  const round = assessRound({
    attempt: 1,
    samples,
    unionHelpers: [early],
    appStartMs,
    readyElapsedMs: 500,
    survivors: [early],
    staleHelperPids: [],
  });
  assert.equal(round.contaminated, true);
  assert.deepEqual(round.reasons.map((r) => r.kind), ["helper-survived-app"]);
  assert.deepEqual(round.foreignHelperPids, []);
  assert.equal(round.samples[0].mb, 300);
});

test("生产接线 assessRound：lstart 失败 + 未存活 ⇒ 无条件污染（fail-closed）", () => {
  const broken = { pid: 702, ppid: 1, rssKB: 10 * 1024, lstart: "garbage", comm: "com.apple.WebKit.WebContent" };
  const samples = [1, 2, 3].map(() => ({
    mb: 240,
    helperPids: [702],
    helperRssKB: { 702: 10 * 1024 },
    processes: [broken],
  }));
  for (const survivors of [[], [broken]]) {
    const round = assessRound({
      attempt: 1,
      samples,
      unionHelpers: [broken],
      appStartMs,
      readyElapsedMs: 500,
      survivors,
      staleHelperPids: [],
    });
    assert.equal(round.contaminated, true, `survivors=${survivors.length} 时也必须污染`);
    assert.deepEqual(round.reasons.map((r) => r.kind), ["helper-lstart-unparsable"]);
    assert.equal(round.samples[0].mb, 240, "无法判别时不得扣 RSS");
  }
});

test("a2 真实事故回放（生产 assessRound）：2 survivor / 3 late-exited ⇒ 首轮 5 helpers 污染，stale 不含外来", () => {
  // 真实 pid/lstart（run 46137691165 attempt 2 round 1）；survivors 只有 5075、5173（artifact 记录的残留）。
  const helpers = [
    wk(4947, "Sat Nov 28 11:45:38 2026", "com.apple.WebKit.WebContent", 60 * 1024),
    wk(4948, "Sat Nov 28 11:45:38 2026", "com.apple.WebKit.Networking", 73 * 1024),
    wk(5071, "Sat Nov 28 11:45:43 2026", "com.apple.WebKit.WebContent", 20 * 1024),
    wk(5075, "Sat Nov 28 11:45:43 2026", "com.apple.WebKit.Networking", 21 * 1024),
    wk(5169, "Sat Nov 28 11:45:47 2026", "com.apple.WebKit.WebContent", 22 * 1024),
    wk(5170, "Sat Nov 28 11:45:47 2026", "com.apple.WebKit.Networking", 19 * 1024),
    wk(5173, "Sat Nov 28 11:45:48 2026", "com.apple.WebKit.WebContent", 20 * 1024),
  ];
  const totalMB = (100 * 1024 + helpers.reduce((s, h) => s + h.rssKB, 0)) / 1024; // app 100MB + helpers
  const samples = [1, 2, 3, 4, 5].map(() => ({
    mb: totalMB,
    helperPids: helpers.map((h) => h.pid),
    helperRssKB: Object.fromEntries(helpers.map((h) => [h.pid, h.rssKB])),
    processes: [{ pid: 100, ppid: 1, lstart: appStart, rssKB: 100 * 1024, comm: "lumir" }, ...helpers],
  }));
  const survivors = helpers.filter((h) => h.pid === 5075 || h.pid === 5173);
  const round = assessRound({
    attempt: 1,
    samples,
    unionHelpers: helpers,
    appStartMs,
    readyElapsedMs: 500,
    survivors,
    staleHelperPids: [],
  });
  // 只有 2 个外来身份被剔除：剩 5 个 helper（2 早到 + 3 late-exited）⇒ 仍超上限、首轮污染
  assert.deepEqual(round.foreignHelperPids, [5075, 5173]);
  assert.deepEqual(round.helperCounts, [5, 5, 5, 5, 5]);
  assert.equal(round.contaminated, true);
  assert.ok(round.reasons.some((r) => r.kind === "helper-count" && r.detail.helperCount === 5));
  // 首轮调整后的 RSS = 原始 − 两个外来身份各自 RSS
  assert.equal(round.samples[0].mb, totalMB - (21 + 20));
  assert.deepEqual(round.rawSamples, [totalMB, totalMB, totalMB, totalMB, totalMB]);
  // stale 作用域：本 app 的 5 个（2 早到 + 3 late-exited），不含两个外来 survivor
  assert.deepEqual(round.appHelperPidsAtExit, [4947, 4948, 5071, 5169, 5170]);
  assert.ok(round.appHelperIdentitiesAtExit.every((p) => p.pid !== 5075 && p.pid !== 5173));
  // 落盘字段：调整后的逐样本 helper 集合、存活集合与外来明细（带 rssKB）都在
  assert.deepEqual(round.sampleHelperPids[0], [4947, 4948, 5071, 5169, 5170]);
  assert.deepEqual(round.survivedAfterAppExit.map((p) => p.pid), [5075, 5173]);
  assert.ok(round.foreignHelpers.every((p) => typeof p.rssKB === "number"));
  // 第二轮：这 5 个身份都已退出 ⇒ stale 不触发；基线排除 2 个外来 survivor ⇒ 2 helpers clean、接受
  const round2Clean = {
    attempt: 2,
    contaminated: false,
    reasons: [],
    samples: [{ mb: 233.1 }, { mb: 233.0 }],
    helperCounts: [2, 2],
    sampleHelperPids: [[6831, 6832], [6831, 6832]],
    rawSamples: [233.1, 233.0],
    helperRssBySample: [],
    foreignHelperPids: [],
    foreignHelpers: [],
    unparsableHelpers: [],
    survivedAfterAppExit: [],
    earlyWindowMs: 3000,
    appHelperPidsAtExit: [6831, 6832],
    appHelperIdentitiesAtExit: [ident(6831, "Sat Nov 28 11:46:13 2026")],
    leftoverHelperPids: [],
    attributedPids: [6829, 6831, 6832],
    attributed: [],
    excludedBaselineWebKit: [],
  };
  assert.deepEqual(nextStep([round]), { action: "measure", attempt: 2 });
  assert.deepEqual(nextStep([round, round2Clean]), { action: "accept", attempt: 2 });
  const resolved = resolveRun([round, round2Clean]);
  assert.equal(resolved.status, "ok");
  assert.deepEqual(resolved.samples, [233.1, 233.0]);
});

test("a3 真实事故回放：同样只有 2 survivor ⇒ 首轮 5 helpers 污染、stale 不含外来", () => {
  const helpers = [
    wk(4198, "Sat Nov 28 11:51:43 2026", "com.apple.WebKit.WebContent", 60 * 1024),
    wk(4199, "Sat Nov 28 11:51:43 2026", "com.apple.WebKit.Networking", 73 * 1024),
    wk(4377, "Sat Nov 28 11:51:49 2026", "com.apple.WebKit.WebContent", 20 * 1024),
    wk(4378, "Sat Nov 28 11:51:49 2026", "com.apple.WebKit.Networking", 21 * 1024),
    wk(4387, "Sat Nov 28 11:51:53 2026", "com.apple.WebKit.WebContent", 22 * 1024),
    wk(4388, "Sat Nov 28 11:51:53 2026", "com.apple.WebKit.Networking", 19 * 1024),
    wk(4390, "Sat Nov 28 11:51:53 2026", "com.apple.WebKit.WebContent", 20 * 1024),
  ];
  const totalMB = (100 * 1024 + helpers.reduce((s, h) => s + h.rssKB, 0)) / 1024;
  const samples = [1, 2, 3, 4, 5].map(() => ({
    mb: totalMB,
    helperPids: helpers.map((h) => h.pid),
    helperRssKB: Object.fromEntries(helpers.map((h) => [h.pid, h.rssKB])),
    processes: [{ pid: 100, ppid: 1, lstart: "Sat Nov 28 11:51:43 2026", rssKB: 100 * 1024, comm: "lumir" }, ...helpers],
  }));
  const round = assessRound({
    attempt: 1,
    samples,
    unionHelpers: helpers,
    appStartMs: parseLstartEpochMs("Sat Nov 28 11:51:43 2026"),
    readyElapsedMs: 500,
    survivors: helpers.filter((h) => h.pid === 4378 || h.pid === 4390),
    staleHelperPids: [],
  });
  assert.deepEqual(round.foreignHelperPids, [4378, 4390]);
  assert.deepEqual(round.helperCounts, [5, 5, 5, 5, 5]);
  assert.equal(round.contaminated, true);
  assert.deepEqual(round.appHelperPidsAtExit, [4198, 4199, 4377, 4387, 4388]);
});

test("artifact 可独立重算扣减：attributed/foreignHelpers 带 rssKB，rawSamples 与逐样本 helper RSS 齐全", () => {
  const helpers = [
    wk(4947, "Sat Nov 28 11:45:38 2026", "com.apple.WebKit.WebContent", 60 * 1024),
    wk(5075, "Sat Nov 28 11:45:43 2026", "com.apple.WebKit.Networking", 21 * 1024),
    wk(5173, "Sat Nov 28 11:45:48 2026", "com.apple.WebKit.WebContent", 20 * 1024),
  ];
  const samples = [1, 2].map(() => ({
    mb: 201,
    helperPids: [4947, 5075, 5173],
    helperRssKB: Object.fromEntries(helpers.map((h) => [h.pid, h.rssKB])),
    processes: [{ pid: 100, ppid: 1, lstart: appStart, rssKB: 100 * 1024, comm: "lumir" }, ...helpers],
  }));
  const round = assessRound({
    attempt: 1,
    samples,
    unionHelpers: helpers,
    appStartMs,
    readyElapsedMs: 500,
    survivors: [helpers[1], helpers[2]],
    staleHelperPids: [],
  });
  const summary = summarizeAttempt({ ...round, helperPidsAtExit: [], leftoverHelperPids: [], attributedPids: [], attributed: [], excludedBaselineWebKit: [] });
  assert.deepEqual(summary.rawSamples, [201, 201]);
  assert.deepEqual(summary.samples, [201 - 41, 201 - 41]);
  // 逐样本 helper RSS 能重算：raw − Σ foreign rss = adjusted
  const foreign = new Set(summary.foreignHelperPids);
  for (let i = 0; i < summary.helperRssBySample.length; i++) {
    const droppedKB = summary.helperRssBySample[i].filter((p) => foreign.has(p.pid)).reduce((s, p) => s + p.rssKB, 0);
    assert.equal(summary.rawSamples[i] - droppedKB / 1024, summary.samples[i]);
  }
  // 进程明细带 RSS
  assert.equal(summary.attributed?.[0]?.rssKB ?? helpers[0].rssKB, helpers[0].rssKB);
  assert.ok(summary.foreignHelpers.every((p) => typeof p.rssKB === "number"));
});

test("生产接线 assessRound：慢 runner（ready 8s ⇒ 窗口 9s）不误伤 +5s 的本 app helper", () => {
  const helper = wk(601, "Sat Nov 28 11:45:43 2026"); // +5s
  const samples = [{ mb: 250, helperPids: [601], helperRssKB: { 601: 20 * 1024 }, processes: [helper] }];
  const round = assessRound({
    attempt: 1,
    samples,
    unionHelpers: [helper],
    appStartMs,
    readyElapsedMs: 8_000,
    survivors: [],
    staleHelperPids: [],
  });
  assert.equal(round.earlyWindowMs, 9_000);
  assert.deepEqual(round.foreignHelperPids, []);
  assert.equal(round.contaminated, false);
});

test("结果与阈值口径不变：maxHelpers=3、resident-memory 250MB/absolute/max、contract 200", () => {
  assert.equal(MAX_HELPERS, 3);
  assert.equal(SURVIVAL_GRACE_MS, 5_000);
  const thresholds = JSON.parse(readFileSync(path.resolve(here, "../../tests/perf/thresholds.json"), "utf8"));
  const mem = thresholds.metrics["resident-memory"];
  assert.equal(mem.threshold, 250);
  assert.equal(mem.mode, "absolute");
  assert.equal(mem.gate, "max");
  const meta = buildMeta({
    attempts: [{
      ...attemptOf({ samples: [{ mb: 230, helperPids: [1, 2], processes: [] }], contaminated: false }),
      rawSamples: [230],
      helperRssBySample: [],
      foreignHelperPids: [],
      foreignHelpers: [],
      unparsableHelpers: [],
      survivedAfterAppExit: [],
      earlyWindowMs: 3000,
    }],
    acceptedAttempt: 1,
    panes: 0,
    xdgConfigHome: "/tmp/xdg",
    home: "/tmp/home",
  });
  assert.deepEqual(meta.foreignHelperPids, []);
  assert.equal(meta.rawSamples[0], 230);
  assert.equal(meta.contaminationPolicy.maxHelpers, MAX_HELPERS);
});
