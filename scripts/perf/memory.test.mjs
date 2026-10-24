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
//      成功结果与被丢弃轮、连续污染诊断件都不丢字段。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attribute,
  buildContaminatedPayload,
  buildMeta,
  evaluateRound,
  mergeProcessDetails,
  nextStep,
  parseProcTable,
  resolveRun,
  summarizeAttempt,
  CONTAMINATION_REASON,
  MAX_ATTEMPTS,
  MAX_HELPERS,
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
  const meta = buildMeta({ attempts: [round1, round2], acceptedAttempt: 2, panes: null, xdgConfigHome: undefined });

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
    panes: null,
    xdgConfigHome: undefined,
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
