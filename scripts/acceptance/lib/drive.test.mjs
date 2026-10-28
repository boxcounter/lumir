// scripts/acceptance/lib/drive.test.mjs —— `settle()` / `snapshotBody()`（M759）与 AXSize 写通道
// 有界重试（M764）的自测。
//
// 为什么需要它：M751 让每次 `get_app_state` 都带 `disable_diff: true`（防空 diff 假绿），副作用是
// KimiCU **每次调用都新建快照**——首行 `AX snapshot_id=<UUID>`（mode=full 另有末行
// `Screenshot: … screenshot_id=…`）每次读都换。`settle()` 原先比整份原文，于是「连续两次一致」
// 永远不成立：post-M751 观察到的 25 次 settle 执行全部 15s 超时（2026-10-27 调查
// `.local/reports/settle-stability-oct27/README.md`）。修法是只剥产物 id 行、正文仍逐字节比较。
//
// 这一层修的缺陷形态是「**永不成立**」与「**放宽成恒真**」两侧都无声——所以用例必须成对：
//   - 正例：正文相同 + id 每次变 ⇒ 快速稳定（改前必红：15s/超时）；
//   - 反例 A：任一节点行变化 ⇒ 仍判未稳定（证明剥的不是整个正文）；
//   - 反例 B：`element_count` / `truncated` 变化 ⇒ 仍判未稳定（证明 header 事实仍参与比较）；
//   - 反例 C：无 `AXTextArea` ⇒ 编辑器门不放宽（正文恒定也要超时）；
//   - 返回值仍是**原始**快照（证据 dump 与 `ax.has` 断言看原文）。
// 只改一处会让另一处悄悄退回旧口径：`settleEditorless` 的同类用例在 execute.test.mjs。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI；改过 drive 的等待 / resize 逻辑
// 后也可单跑）：
//   node --test scripts/acceptance/lib/drive.test.mjs
//
// 纪律：全部用假 `cu.state` 与假 swift（`run` 注入），不起真机、不碰 KimiCU / 验收 vault。
// settle 的用例还注入**假时钟**（`now` / `sleepFn`，见 `fakeClock`）：虚拟时间只在 settle 自己的
// 采样间隔上前进、读取零耗时，于是「预算内读到第几轮」只由采样节奏决定。旧形态吃真实墙钟
// （`timeoutMs: 800`）时，第二次读取要成立得首读耗时 <100ms——M779 并行真机 + 全量视觉满载跑
// gate，首读被拖过这 100ms、只读 1 次就判「未稳定」，`acceptance-suite` 假红而空载同命令全绿
// （finding `20261028-worker-fix-harness-activity-re-bug-acceptance-settle.md`）。
import assert from "node:assert/strict";
import test from "node:test";

import { settle, snapshotBody, StepError, resizeWindowAX, pinWindowSize } from "./drive.mjs";
import { InfraError } from "./util.mjs";

/** KimiCU 快照首行（逐字取自 2026-10-27 的真机 dump）。 */
const snapshotIdLine = (id) =>
  `AX snapshot_id=${id}. Pass this ID with index-based actions; it is separate from the screenshot_id and diff revision.`;

/** mode=full 的末行（同一份 dump 的形态）。 */
const screenshotLine = (id) =>
  `Screenshot: window_id=11500, screenshot_id=${id}; 2048×1365 pixels. Use these IDs with coordinates in this image's pixels, origin (0,0) at its top-left.`;

/** 合成的 AX 快照文本：只有该变的字段可调，其余逐字固定——比较的是「同一份界面」。 */
function axText({
  snapshotId = "AAAAAAAA-0000-0000-0000-000000000000",
  screenshotId = null,
  elementCount = 4,
  truncated = "false",
  nodeLine = '- [8] AXStaticText = "Lumir 0.10.0" @10,10 100×20',
  editor = true,
} = {}) {
  const lines = [
    snapshotIdLine(snapshotId),
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 42350",
    `- element_count: ${elementCount}`,
    `- truncated: ${truncated}`,
    "- captured_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 1200×800 actions=[AXRaise]',
    "    - [2] AXScrollArea @0,0 1200×800",
    '      - [3] AXWebArea (Lumir) URL: http://127.0.0.1:1430/',
    nodeLine,
  ];
  if (editor) lines.push('      - [9] AXTextArea = "# doc\\nbody" @0,0 1100×700 actions=[AXPress]');
  lines.push("```");
  if (screenshotId) lines.push(screenshotLine(screenshotId));
  return lines.join("\n");
}

/** 假 `CuClient`：按顺序返回给定文本，用完之后重复最后一份；`texts` 也可以给 `(第几次读取) => 文本`
 *  的工厂（构造「每次读都变」的现场用）。`maxReads` 是防挂死的上限：settle 若不再按注入的时钟收口
 *  （超时语义失效 / 用回墙钟），用例会拿到一条明确的失败，而不是把 gate 卡死在一条用例上。 */
function fakeCu(texts, { maxReads = 20 } = {}) {
  let i = 0;
  const reads = [];
  return {
    reads,
    state: async (pid, { mode } = {}) => {
      reads.push({ pid, mode });
      if (reads.length > maxReads) {
        throw new Error(`假 CU 已被读 ${reads.length} 次（上限 ${maxReads}）：settle 没有按注入的时钟收口`);
      }
      const text = typeof texts === "function" ? texts(i) : texts[Math.min(i, texts.length - 1)];
      i += 1;
      return { text, image: null };
    },
  };
}

/** 假时钟（M779 的假红修法，finding
 *  `20261028-worker-fix-harness-activity-re-bug-acceptance-settle.md`）：`now()` 只在 `sleepFn` 被
 *  调用时前进，读取一律零耗时。
 *
 *  为什么必须这样：settle 的循环是「读 → 比较 → sleep(采样间隔) → 再查预算」，吃真实墙钟时
 *  「800ms 内读到两次」隐含「首读耗时 <100ms」——那是机器速度，不是被测事实。满载时首读被拖过
 *  这 100ms 就只读 1 次（M779 现场：该用例自身耗时 824ms、断言 `实际只读了 1 次`，空载同命令全绿）。
 *  虚拟时间只随 settle 自己的采样节奏前进后，「预算内读到第几轮」= ceil(预算 / 采样间隔)，与负载
 *  无关。`sleeps` 记录每次采样间隔：既证明 settle 用的是注入的 `sleepFn`（不是墙钟旁路），也让用例
 *  能断言「提前返回」与「超时收口」的耗时口径。 */
function fakeClock() {
  let nowMs = 0;
  const sleeps = [];
  return {
    sleeps,
    now: () => nowMs,
    sleepFn: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
  };
}

test("snapshotBody：只剥行首的产物 id 两行，其余正文逐字节保留（含 pre-M751 无 id 行时原样返回）", () => {
  const text = axText({ snapshotId: "AAAA", screenshotId: "bbbb" });
  const expected = text
    .split("\n")
    .filter((line) => !line.startsWith("AX snapshot_id=") && !line.startsWith("Screenshot: "))
    .join("\n");
  assert.equal(snapshotBody(text), expected, "正文应与「原文去掉两行元数据」逐字节相同");
  assert.ok(!snapshotBody(text).includes("snapshot_id="), "产物 id 不得留在正文里");
  assert.ok(snapshotBody(text).includes("- element_count: 4"), "header 事实必须留在正文里");
  assert.ok(snapshotBody(text).includes('AXStaticText = "Lumir 0.10.0"'), "节点行必须留在正文里");

  // pre-M751 的 dump 没有 id 行：原样返回（不多不少一个字节），证明这只剥元数据、不重排正文。
  const preM751 = axText().split("\n").slice(1).filter((l) => !l.startsWith("Screenshot: ")).join("\n");
  assert.equal(snapshotBody(preM751), preM751, "没有产物 id 行时 snapshotBody 必须是恒等变换");

  // 只剥**行首**：正文 / 节点 value 里恰好写了这串字样的行不受影响（不能吃掉界面内容）。
  const inBody = text.replace(
    '- [8] AXStaticText = "Lumir 0.10.0" @10,10 100×20',
    '- [8] AXStaticText = "AX snapshot_id=keep-me" @10,10 100×20',
  );
  assert.ok(snapshotBody(inBody).includes('"AX snapshot_id=keep-me"'), "行内出现的同名字样不得被剥掉");
});

test("settle：正文相同、snapshot_id / screenshot_id 每次读都变 ⇒ 第二次读取即稳定，返回的仍是原始快照", async () => {
  // id 每次都换（工厂而非两条预置文本）：旧口径比整份原文时永远等不到「连续两次一致」而超时，
  // 本用例因此是 M759 修法的必红现场。
  const clock = fakeClock();
  const cu = fakeCu((i) => axText({ snapshotId: `SNAPSHOT-${i}`, screenshotId: `screenshot-${i}` }));
  const ax = await settle(cu, 0, { timeoutMs: 5000, now: clock.now, sleepFn: clock.sleepFn });
  assert.equal(cu.reads.length, 2, "首读只做基线、不参与比较：第二次读取就该稳定返回（旧实现单读即返回时本断言必红）");
  assert.equal(clock.sleeps.length, 1, "提前返回：只付一次采样间隔，不等满预算");
  assert.ok(cu.reads.every((r) => r.mode === "ax"), "settle 走 mode=ax：mock 读到的模式应与生产一致");
  assert.match(ax.text, /AX snapshot_id=SNAPSHOT-1/, "返回值是原始快照（第二次读取那份）：证据 dump / ax.has 断言继续看原文");
  assert.ok(ax.textarea, "编辑器节点仍由原文解析出来");
});

test("settle：节点行每次读都变 ⇒ 进入比较轮后仍判未稳定（剥的是产物 id，不是界面状态）", async () => {
  const clock = fakeClock();
  const cu = fakeCu((i) => axText({ snapshotId: `S-${i}`, nodeLine: `- [8] AXStaticText = "Lumir 0.10.${i}" @10,10 100×20` }));
  await assert.rejects(
    settle(cu, 0, { timeoutMs: 2000, now: clock.now, sleepFn: clock.sleepFn }),
    (e) => e instanceof StepError && /未稳定/.test(e.message) && /2000ms/.test(e.message),
    "节点行变化必须判未稳定（否则断言被放宽成恒真）；超时消息要带本次预算",
  );
  assert.ok(cu.reads.length >= 2, `首读之后必须再比一次，实际只读了 ${cu.reads.length} 次`);
  const elapsed = clock.sleeps.reduce((a, b) => a + b, 0);
  assert.ok(elapsed >= 2000, `超时要等满预算再收口（虚拟耗时 ${elapsed}ms）`);
  assert.ok(elapsed <= 2000 + clock.sleeps[0], `超时不得超出预算一个采样间隔（虚拟耗时 ${elapsed}ms）`);
});

test("settle：element_count / truncated 变化 ⇒ 仍判未稳定（header 事实仍参与逐字节比较）", async () => {
  const countClock = fakeClock();
  const countCu = fakeCu((i) => axText({ snapshotId: `C-${i}`, elementCount: 4 + i }));
  await assert.rejects(
    settle(countCu, 0, { timeoutMs: 2000, now: countClock.now, sleepFn: countClock.sleepFn }),
    (e) => e instanceof StepError && /未稳定/.test(e.message),
    "element_count 变化必须判未稳定",
  );

  const truncatedClock = fakeClock();
  const truncatedCu = fakeCu((i) =>
    axText({ snapshotId: `T-${i}`, truncated: i % 2 ? "true [closed_menu]" : "false" }),
  );
  await assert.rejects(
    settle(truncatedCu, 0, { timeoutMs: 2000, now: truncatedClock.now, sleepFn: truncatedClock.sleepFn }),
    (e) => e instanceof StepError && /未稳定/.test(e.message),
    "truncated 变化必须判未稳定",
  );
});

test("settle：正文恒定但 AX 里没有 AXTextArea ⇒ 编辑器门不放宽，按超时合同收口", async () => {
  const clock = fakeClock();
  const cu = fakeCu([axText({ snapshotId: "AAAA", editor: false })]);
  await assert.rejects(
    settle(cu, 0, { timeoutMs: 2000, now: clock.now, sleepFn: clock.sleepFn }),
    (e) => e instanceof StepError && /未稳定/.test(e.message) && /2000ms/.test(e.message),
    "无编辑器节点时 settle 不得因正文一致就返回（编辑器门是既有合同）",
  );
  assert.ok(cu.reads.length >= 2, `编辑器门不成立时要继续轮询，实际只读了 ${cu.reads.length} 次`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// M764：AXSize 写通道的有界重试（-25200 族）
//
// 现场（2026-10-28）：117 连跑 4 次全部倒在第 1 步 `resizeWindow`（swift 写 AXSize 报 -25200），
// 同一 run 的预检 `pinWindowSize` 用同一脚本、同一 pid 却成功，run 结束后在同一实例上手工调用
// 8/8 成功——失败状态只存在于调用时刻，不是产品缺陷（finding
// `.tower/comms/findings/20261028-worker-rmachine-multiline-ax-v-bug-resizewindow-axsize-25200-117-39-126-m763.md`；
// 2026-10-27 的 117 / 39 / 126 同族）。修法是有界重试（≤3 次、间隔 ≥300ms），成功判据只有一条：
// **回读等于请求值**。三个必红形态（旧实现：一次调用即返回 / 即抛，全都在这里判红）：
//   - 首次失败、后续成功 ⇒ 必须重试并成功；
//   - 持续失败 ⇒ 3 次后 `InfraError`（通道/环境项 → runner 判 INVALID），不是场景断言 FAIL；
//   - 回读始终是错误尺寸 ⇒ 不得当成功，⚠ 与请求值 / 生效值必须进证据。
// 纪律：假 swift（注入 `run`）+ 假窗口状态（假 `cu.state`）+ 假 `sleepFn`，不真的 sleep、不起真机。

/** `ax-window.swift` 成功时的回读行（形态取自 swift 的 print）。 */
const sizeLine = (w, h) => `size=${w}x${h} window=AXStandardWindow "Lumir" @8,40 ${w}×${h} windows=1`;

/** 真机 stderr 形态的通道错误（execFileSync 把它并进 message）。 */
const axSizeFailure =
  "Command failed: /usr/bin/swift ax-window.swift 7 1200 800\n" +
  'ax-window: 设 AXSize 失败（AXError -25200）：被写窗口 AXStandardWindow "Lumir" @8,40 1200×800；场上 1 扇：…';

/** 假 swift：按顺序返回给定结果，用完之后重复最后一份；同时记录调用与 sleep 间隔。 */
function fakeSwift(results) {
  const calls = [];
  const sleeps = [];
  return {
    calls,
    sleeps,
    run: (pid, w, h) => {
      calls.push({ pid, w, h });
      const r = results[Math.min(calls.length - 1, results.length - 1)];
      return { ok: r.ok, stdout: r.stdout ?? "", error: r.error ?? null };
    },
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
  };
}

test("resizeWindowAX（M764）：首次 -25200、第二次回读等于请求值 ⇒ 重试成功，逐次 err / 回读进证据", async () => {
  const swift = fakeSwift([{ ok: false, error: axSizeFailure }, { ok: true, stdout: sizeLine(1200, 800) }]);
  const out = await resizeWindowAX(7, 1200, 800, { run: swift.run, sleepFn: swift.sleepFn });
  assert.equal(swift.calls.length, 2, "第一次失败后必须重试（旧实现一次即抛，本用例必红）");
  assert.match(out, /^size=1200x800 /, "成功路径返回 swift 的回读行原文");
  assert.match(out, /-25200/, "首次失败的 err 必须留在证据里（归因不必回真机加探针）");
  assert.match(out, /写了 2 次/, "重试次数要进证据");
  assert.match(out, /#2 已写入（回读 1200×800）/, "逐次回读尺寸要进证据");
  assert.equal(swift.sleeps.length, 1, "两次尝试之间等一次；成功后不再多等");
  assert.ok(swift.sleeps[0] >= 300, `尝试间隔必须 ≥300ms（合同下限），实际 ${swift.sleeps[0]}ms`);
});

test("resizeWindowAX（M764）：持续 -25200 ⇒ 3 次后抛 InfraError（通道项），带每次 err 与回读", async () => {
  const swift = fakeSwift([{ ok: false, error: axSizeFailure }]);
  await assert.rejects(
    () => resizeWindowAX(7, 1200, 800, { run: swift.run, sleepFn: swift.sleepFn }),
    (e) =>
      e instanceof InfraError &&
      /请求 1200×800/.test(e.message) &&
      /-25200/.test(e.message) &&
      /#3 失败/.test(e.message) &&
      /通道/.test(e.message),
    "通道耗尽必须是 InfraError（环境项 → 整场 INVALID），不是场景断言 FAIL；每次 err 与回读都要带上",
  );
  assert.equal(swift.calls.length, 3, "有界重试：至多 3 次，不得无限重试");
  assert.equal(swift.sleeps.length, 2, "3 次尝试之间只等 2 次（耗尽后不再等）");
  assert.ok(
    swift.sleeps.every((ms) => ms >= 300),
    `每次间隔必须 ≥300ms，实际 ${swift.sleeps}`,
  );
});

test("resizeWindowAX（M764）：回读始终是错误尺寸 ⇒ 不得当成功（重试到上限，⚠ 与请求值 / 生效值进证据）", async () => {
  const swift = fakeSwift([{ ok: true, stdout: sizeLine(1152, 800) }]);
  const out = await resizeWindowAX(7, 1200, 800, { run: swift.run, sleepFn: swift.sleepFn });
  assert.equal(swift.calls.length, 3, "回读 ≠ 请求值时旧实现一次即返回 1152×800（无任何标记），这里必须重试到上限");
  assert.doesNotMatch(out, /才回读到请求值/, "回读不等于请求值时不得走成功措辞");
  assert.match(out, /⚠/, "错误尺寸必须显式标 ⚠（钳制 / 未生效）");
  assert.match(out, /请求 1200×800/, "请求值要进证据");
  assert.match(out, /1152×800/, "生效值要进证据");
});

test("resizeWindowAX（M764）：swift 退出 0 但没有 size= 回读行 ⇒ 同通道失败重试，耗尽抛 InfraError", async () => {
  const swift = fakeSwift([{ ok: true, stdout: "unexpected output" }]);
  await assert.rejects(
    () => resizeWindowAX(7, 1200, 800, { run: swift.run, sleepFn: swift.sleepFn }),
    (e) => e instanceof InfraError && /回读行无法解析/.test(e.message),
    "退出 0 但读不到生效值 = 没有可判的成功，按通道失败归类（旧实现把它当成功返回）",
  );
  assert.equal(swift.calls.length, 3);
});

test("resizeWindowAX（M764）：首次即成功 ⇒ 原样返回 swift 行（证据不膨胀）", async () => {
  const swift = fakeSwift([{ ok: true, stdout: sizeLine(520, 800) }]);
  assert.equal(
    await resizeWindowAX(7, 520, 800, { run: swift.run, sleepFn: swift.sleepFn }),
    sizeLine(520, 800),
    "正常路径的步骤证据必须与旧格式一字不差",
  );
  assert.equal(swift.calls.length, 1);
  assert.deepEqual(swift.sleeps, [], "首次成功不付任何等待");
});

test("pinWindowSize（M764）：钳制（回读 ≠ 请求值）保持既有 ⚠ 口径、不抛错，重试次数进证据行", async () => {
  const swift = fakeSwift([{ ok: true, stdout: sizeLine(1152, 800) }]);
  const cu = fakeCu([axText()]);
  const line = await pinWindowSize(cu, 7, { width: 1200, height: 800 }, { run: swift.run, sleepFn: swift.sleepFn });
  assert.match(line, /^窗口钉尺寸：请求 1200×800，回读生效 1152×800（AXSize 直写；AXSize 共写 3 次/);
  assert.match(line, /⚠ 生效值 ≠ 请求值——窗口管理器钳制/, "钳制是已登记的环境边界，不升级成错误");
  assert.match(line, /#1 已写入（回读 1152×800）/, "逐次回读要进证据行");
  assert.equal(swift.calls.length, 3);
});

test("pinWindowSize（M764）：通道耗尽 ⇒ InfraError 原样上抛（启动段据此判 INVALID，不吞成 ⚠）", async () => {
  const swift = fakeSwift([{ ok: false, error: axSizeFailure }]);
  await assert.rejects(
    () => pinWindowSize(fakeCu([axText()]), 7, { width: 1200, height: 800 }, { run: swift.run, sleepFn: swift.sleepFn }),
    (e) => e instanceof InfraError && /-25200/.test(e.message),
    "钉不上就是基建 INVALID（退出码 2），不能降级成一条 ⚠ 证据",
  );
  assert.equal(swift.calls.length, 3);
});

test("pinWindowSize（M764）：首次即成功 ⇒ 证据行与旧格式一字不差（不带重试说明）", async () => {
  const swift = fakeSwift([{ ok: true, stdout: sizeLine(1200, 800) }]);
  const line = await pinWindowSize(fakeCu([axText()]), 7, { width: 1200, height: 800 }, { run: swift.run, sleepFn: swift.sleepFn });
  assert.match(line, /^窗口钉尺寸：请求 1200×800，回读生效 1200×800（AXSize 直写；webview 重排 settle \d+ms）$/);
});
