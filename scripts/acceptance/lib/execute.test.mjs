// scripts/acceptance/lib/execute.test.mjs —— 验收套件 loader / 静态校验 / 断言判定的自测
//（node:test，零新增依赖；不起真机、不需要 app）。
//
// 为什么需要它（M543）：这一层修的两条都是**静默**缺陷——「步骤表写到 front-matter 的闭合 `---`
// 之外 ⇒ 整表被丢弃、场景零断言判绿」与「一条 file 断言只判优先级最高的那个键 ⇒ 多写的键静默
// 失效」（两份 finding：`.tower/comms/findings/20261016-worker-scenfix-bug-pass-loader-check-0.md`
// 与 `20261016-worker-scenfix-bug-file-readme-sha256-mtime.md`）。两者的症状都是「没有红」，所以
// 只能靠**构造必须红的输入**来证明判据真的成立（REVIEW.md 「断言等价于子串」条）：「同内容重写、mtime 推进」
// 那个现场必须判红，且它落在哪一条记录上一眼可辨。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI；改过 loader / 断言实现后也可单跑）：
//   node --test scripts/acceptance/lib/execute.test.mjs
//
// 纪律（REVIEW.md 「测试污染真实环境」条）：全程对临时目录（`os.tmpdir()`）跑——不碰验收 vault、不碰用户的
// `~/.config/lumir`、不写 `.local/`。file 类断言与零断言兜底都不读 app / KimiCU，故 ctx 可桩化。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { channelSpecProblem, checkScenario, contentClickGeometry, establishEditorFocus, focusedRoleReading, isStaleIndexError, KEY_CHANNELS, keyChannel, loadScenario, notificationBaseline, notificationMatches, pickFreshNotification, planWheelFallback, pointToShotPx, readAxForScreenPoint, runScenario, runTag, sampleWindowPx, screenshotSize, settleEditorless } from "./execute.mjs";
import { coordsSpace, findNode, mainWindowPlan, nodeName, parseNodes, windowBounds, windowDirectory } from "./ax.mjs";
import { injectChordCGEvent, parseChordSpec, parseKeyWindowState, readAx, StepError } from "./drive.mjs";
import { InfraError, repoRoot } from "./util.mjs";

/** 临时根（每个用例一份，跑完不清也无妨——全在 `os.tmpdir()` 下）。 */
function tmpRoot(name) {
  const dir = path.join(os.tmpdir(), `lumir-acc-selfcheck-${name}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 把验收 vault 与证据目录指到临时目录：`util.mjs` 在**调用时**读 env，故 import 之后设置有效。 */
function useTmpEnv(root) {
  process.env.LUMIR_ACCEPTANCE_VAULT = path.join(root, "vault");
  process.env.LUMIR_ACCEPTANCE_RESULTS = path.join(root, "results");
  fs.mkdirSync(process.env.LUMIR_ACCEPTANCE_VAULT, { recursive: true });
}

/** runScenario 的最小 ctx：证据面只留「落记录 / 出终态」两件事，AX 与截图写成桩路径。 */
function stubCtx(root, opts = {}) {
  const records = [];
  return {
    cu: opts.cu ?? {},
    pid: 0,
    repoRoot: repoRoot(),
    foregroundNote: undefined,
    evidence: {
      records,
      startScenario: async () => root,
      record: (r) => {
        const rec = { ...r };
        records.push(rec);
        return rec;
      },
      saveAx: async () => path.join(root, "stub.ax"),
      saveShot: async () => path.join(root, "stub.jpeg"),
      logLine: () => {},
      finish: async () => ({ status: records.some((r) => r.kind === "assert" && !r.ok) ? "FAIL" : "PASS" }),
    },
  };
}

async function drive(root, scenario, opts = {}) {
  const ctx = stubCtx(root, opts);
  const { status } = await runScenario(ctx, {
    id: "selfcheck",
    item: 0,
    title: "套件自测",
    file: path.join(root, "selfcheck.md"),
    ...scenario,
  });
  return { status, records: ctx.evidence.records.filter((r) => r.kind === "assert") };
}

/** 158 事故的形态：front-matter 只有 id/item/title，`steps:` 整表写在闭合 `---` 之后。 */
const ZERO_STEPS_SCENARIO = [
  '---\nid: "158-zz-zero-steps"\nitem: 158\ntitle: 零步骤现场\n---\n',
  "steps:",
  "  - name: 整表落在 front-matter 之外",
  "    expect:",
  "      - shot: 证据",
].join("\n");

test("零步骤场景：checkScenario 挡空步骤表，并点出「整表写在闭合 --- 之外」", async () => {
  const root = tmpRoot("zero-steps");
  const file = path.join(root, "158-zz-zero-steps.md");
  fs.writeFileSync(file, ZERO_STEPS_SCENARIO);
  const scenario = await loadScenario(file);
  assert.equal(scenario.steps, undefined, "整表落在 front-matter 之外：loadScenario 拿不到 steps");
  assert.deepEqual(scenario.bodyStepKeys, ["steps"], "loadScenario 应把命中的顶层键名报给静态校验");
  const problems = checkScenario(scenario);
  assert.ok(
    problems.some((p) => p.includes("缺少 steps（步骤表必须写在 front-matter 内）")),
    `应报「缺少 steps」，实际：${JSON.stringify(problems)}`,
  );
  assert.ok(
    problems.some((p) => p.includes("整表写在 front-matter 的闭合 `---` 之外")),
    `应给出「写到 front-matter 外」的定位提示，实际：${JSON.stringify(problems)}`,
  );
});

test("步骤表写在 front-matter 内：零问题（正文里的 YAML 示例不误伤，仍被记录但不报）", async () => {
  const root = tmpRoot("steps-inside");
  const file = path.join(root, "ok-steps.md");
  fs.writeFileSync(
    file,
    [
      '---\nid: "ok-steps"\nitem: 0\ntitle: 正常场景\nsteps:',
      "  - name: 一步",
      "    expect:",
      "      - label: 截图证据",
      "        shot: 证据",
      "---",
      "",
      "## 说明",
      "",
      "```markdown",
      "steps:",
      "  - name: 这是正文里的示例",
      "```",
    ].join("\n"),
  );
  const scenario = await loadScenario(file);
  assert.equal(scenario.steps.length, 1, "front-matter 内的步骤表应被解析");
  assert.deepEqual(scenario.bodyStepKeys, ["steps"], "正文里的那一行仍被记录（供定位用）");
  assert.deepEqual(checkScenario(scenario), [], "步骤表非空时不该报任何问题");
});

test("多键 file 断言逐键判：exists + has + not 各落一条记录", async () => {
  const root = tmpRoot("multi-keys-green");
  useTmpEnv(root);
  const { status, records } = await drive(root, {
    steps: [
      { name: "落盘探针", do: "vaultWrite", file: "probe.md", content: "甲项\n" },
      { name: "三键同写", expect: [{ label: "探针在场", file: { path: "probe.md", exists: true, has: "甲项", not: "乙项" } }] },
    ],
  });
  assert.equal(status, "PASS");
  assert.deepEqual(
    records.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.label}`),
    ["PASS 探针在场［exists］", "PASS 探针在场［has］", "PASS 探针在场［not］"],
    "三个判据键应各判一次、各落一条记录（旧实现只判优先级最高的 exists，后两条静默失效）",
  );
});

test("多键 file 断言逐键判：同内容重写 ⇒ sha256 那条绿、mtime 那条必红", async () => {
  const root = tmpRoot("multi-keys-red");
  useTmpEnv(root);
  const { status, records } = await drive(root, {
    steps: [
      { name: "落盘探针", do: "vaultWrite", file: "probe.md", content: "甲项\n" },
      { name: "记基线", do: "record", as: "基线", file: "probe.md" },
      { name: "歇一拍（保证两次写入的 mtime 可分辨）", do: "sleep", ms: 60 },
      // README 要求「不落盘」判据把两个键成对用；同一份内容重写正是 sha256 相同而 mtime 推进的
      // 现场——旧实现按优先级只判 unchangedSince，整条断言判绿（假绿），mtime 那半从未执行。
      { name: "同内容重写", do: "vaultWrite", file: "probe.md", content: "甲项\n" },
      {
        name: "双键同写",
        expect: [{ label: "没落盘", file: { path: "probe.md", unchangedSince: "基线", mtimeUnchangedSince: "基线" } }],
      },
    ],
  });
  assert.equal(records.length, 2, `双键应落两条记录，实际：${JSON.stringify(records.map((r) => r.label))}`);
  assert.ok(records.some((r) => r.ok && r.label === "没落盘［unchangedSince］"), "sha256 未变那条应 PASS");
  const mtime = records.find((r) => r.label.includes("mtimeUnchangedSince"));
  assert.ok(mtime && !mtime.ok, `mtime 已推进那条应 FAIL，实际：${JSON.stringify(records)}`);
  assert.match(mtime.label, /mtime 已推进/, "FAIL 的理由应点明 mtime 推进");
  assert.equal(status, "FAIL", "一条判据红 ⇒ 场景判红（不再被静默吞掉）");
});

test("file.jsonl：按字段判、与键序无关（serde_json 的字母序现场，M612 场景 170/171 红因）", async () => {
  const root = tmpRoot("jsonl-order-insensitive");
  useTmpEnv(root);
  // 实际落盘形状：serde_json 的 Map 是 BTreeMap ⇒ cron_click 的字段按 action→event→ok→task
  // 排列，而旧断言按 event→task→ok→action 写死顺序，永不命中（场景 171 的「已验证」红因）。
  const line = JSON.stringify({ action: "run", event: "cron_click", ok: "true", task: "acc-cron-click" });
  const { status, records } = await drive(root, {
    steps: [
      { name: "写一行日志", do: "vaultWrite", file: "log.jsonl", content: `${line}\n` },
      {
        name: "字段序无关",
        expect: [
          {
            label: "点击被处理",
            file: {
              path: "log.jsonl",
              jsonl: { event: "cron_click", task: "acc-cron-click", ok: "true", action: "run" },
            },
          },
        ],
      },
    ],
  });
  assert.equal(status, "PASS", `字母序落盘的那一行应命中，实际：${JSON.stringify(records)}`);
});

test("file.jsonl：字段值不符 / 字段缺席一律 FAIL（不是「有 event 就算过」）", async () => {
  const root = tmpRoot("jsonl-miss");
  useTmpEnv(root);
  const line = JSON.stringify({ action: "run", event: "cron_click", ok: "false", task: "acc-cron-click" });
  const { status, records } = await drive(root, {
    steps: [
      { name: "写一行日志", do: "vaultWrite", file: "log.jsonl", content: `${line}\n` },
      {
        name: "值不符与字段缺席",
        expect: [
          { label: "ok 不符", file: { path: "log.jsonl", jsonl: { event: "cron_click", ok: "true" } } },
          { label: "字段缺席", file: { path: "log.jsonl", jsonl: { event: "cron_click", action: "open-session" } } },
        ],
      },
    ],
  });
  assert.equal(status, "FAIL", "两条判据都应红");
  assert.deepEqual(
    records.map((r) => r.ok),
    [false, false],
    `期望两条判据都 FAIL，实际：${JSON.stringify(records)}`,
  );
});

test("file.jsonl：布尔 / 数值期望按日志的字符串化口径比较（ok: true 命中 \"true\"）", async () => {
  const root = tmpRoot("jsonl-scalar-coercion");
  useTmpEnv(root);
  const line = JSON.stringify({ event: "cron_notified", kind: "trigger", ok: "true", count: "3", task: "t" });
  const { status } = await drive(root, {
    steps: [
      { name: "写一行日志", do: "vaultWrite", file: "log.jsonl", content: `${line}\n` },
      {
        name: "标量比较",
        expect: [{ label: "字符串日志字段", file: { path: "log.jsonl", jsonl: { ok: true, count: 3, kind: "trigger" } } }],
      },
    ],
  });
  assert.equal(status, "PASS", "日志字段恒为字符串（logging.rs 的 field_text），数值 / 布尔期望应等价比较");
});

test("file.jsonl 静态校验：空表 / 非标量值 / 非 JSONL 解析输入写错即报 problem", () => {
  const errs = (spec) => checkScenario({ id: "jsonl-check", item: 0, steps: [{ name: "校验", expect: [{ file: { path: "log.jsonl", ...spec } }] }] });
  assert.ok(errs({ jsonl: {} }).some((p) => p.includes("jsonl") && p.includes("至少一个字段")), "空 jsonl 应报 problem");
  assert.ok(
    errs({ jsonl: { event: { nested: true } } }).some((p) => p.includes("jsonl.event")),
    "嵌套值应报 problem（日志字段只有标量）",
  );
});

test("ax / file 的 has·not 写数组即报 problem（数组只有 waitFor.has 支持）", () => {
  const errs = (expect) => checkScenario({ id: "array-has", item: 0, steps: [{ name: "校验", expect: [expect] }] });
  assert.ok(
    errs({ ax: { has: ["设置", "模型接入"] } }).some((p) => p.includes("ax.has/not 只收单个字符串")),
    "ax.has 数组应报 problem（matcher() 会拼成「设置,模型接入」恒不命中）",
  );
  assert.ok(
    errs({ file: { path: "config.json", not: ["a", "b"] } }).some((p) => p.includes("file.has/not 只收单个字符串")),
    "file.not 数组同样要挡",
  );
  assert.deepEqual(errs({ ax: { has: "设置" } }), [], "单个字符串形态不该报 problem");
  // waitFor.has 的数组是合法形态（逐项判），不能被这条规则误伤。
  assert.deepEqual(
    checkScenario({ id: "waitfor-array", item: 0, steps: [{ name: "校验", do: "waitFor", waitFor: { has: ["a", "b"] } }] }),
    [],
  );
});

test("do: waitForFile：已落盘的事件立即成立，等不到的事件如实判 FAIL（M616）", async () => {
  const root = tmpRoot("wait-for-file");
  useTmpEnv(root);
  // 现场来历（M616 首跑）：等通知横幅会被**更早一次 run 的同标题通知**满足（条目在 AX 树里
  // 存活数分钟），随后的日志断言在事件落盘之前执行 ⇒ 假红。等待必须与判定同源 = 等这份日志。
  const line = JSON.stringify({ event: "cron_notified", kind: "trigger", task: "acc-cron-register" });
  const hit = await drive(root, {
    steps: [
      { name: "写日志", do: "vaultWrite", file: "log.jsonl", content: `${line}\n` },
      {
        name: "等事件",
        do: "waitForFile",
        waitForFile: { path: "log.jsonl", jsonl: { event: "cron_notified", task: "acc-cron-register" } },
        timeoutMs: 2000,
      },
    ],
  });
  assert.equal(hit.status, "PASS", `已落盘的事件应立即成立，实际：${JSON.stringify(hit.records)}`);

  const miss = await drive(root, {
    steps: [
      { name: "写别的日志", do: "vaultWrite", file: "other.jsonl", content: '{"event":"other"}\n' },
      {
        name: "等不会来的事件",
        do: "waitForFile",
        waitForFile: { path: "other.jsonl", jsonl: { event: "cron_notified" } },
        timeoutMs: 300,
      },
    ],
  });
  assert.equal(miss.status, "FAIL", "超时必须判红（不静默放过——判据没成立与判据为真不是一回事）");
  const actionFail = miss.records.find((r) => !r.ok && r.label.includes("等不会来的事件"));
  assert.ok(actionFail, `应落一条动作 FAIL，实际：${JSON.stringify(miss.records)}`);
  assert.match(actionFail.detail ?? "", /超时/, "失败理由应点明超时");
});

test("do: waitForFile 静态校验：缺 path / 无判据 / 非标量 jsonl / 未知键都报 problem", () => {
  const errs = (waitForFile) => checkScenario({ id: "wff", item: 0, steps: [{ name: "校验", do: "waitForFile", waitForFile }] });
  assert.ok(
    errs({ jsonl: { event: "x" } }).some((p) => p.includes("path")),
    "缺 path 应报 problem（写错路径口径 = 永远等不到）",
  );
  assert.ok(
    errs({ path: "x.jsonl" }).some((p) => p.includes("至少一项")),
    "没有任何判据应报 problem（否则等价于「等文件出现」，判据不明确）",
  );
  assert.ok(
    errs({ path: "x.jsonl", jsonl: { event: { nested: true } } }).some((p) => p.includes("jsonl.event")),
    "嵌套 jsonl 值应报 problem（日志字段只有标量）",
  );
  assert.ok(
    errs({ path: "x.jsonl", has: "x", bogus: 1 }).some((p) => p.includes("bogus")),
    "未知键应报 problem（拼错即静默不判）",
  );
});

test("缺文件时内容类判据仍判 FAIL（不把「读不到」当「为空」）", async () => {
  const root = tmpRoot("missing-file");
  useTmpEnv(root);
  const { records } = await drive(root, {
    steps: [{ name: "文件不在场", expect: [{ label: "不该在", file: { path: "nope.md", exists: false, not: "任意串" } }] }],
  });
  assert.deepEqual(
    records.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.label}`),
    ["PASS 不该在［exists］", "FAIL 不该在［not］（文件不存在：nope.md）"],
    "exists:false 成立，而 not 判据在缺文件时必须红（读不到不当空，REVIEW.md 「读不到当成空」条）",
  );
});

/** 224 的现场（M669）：浮钮的可访问名同时出现在 transcript 正文里（AXStaticText 的 value）。
 *  header 取 mode=ax 的当前形态（窗口矩形键名 `window_bounds` + 独立 `coords:` 行）。 */
const AX_BODY_TEXT_ONLY = [
  "# Lumir App State",
  "",
  "- app: Lumir",
  "- pid: 123",
  "- window_bounds: x=8 y=40 w=1200 h=800 (screen points)",
  "- screenshot: none — no image attached",
  "- coords: bbox `@x,y w×h` are WINDOW-LOCAL POINTS (origin = window top-left, 1:1 points — NOT screenshot pixels)",
  "",
  "```text",
  '- [0] AXApplication "Lumir"',
  '  - [1] AXWindow "Lumir" @0,0 1200×800',
  "    - [5] AXWebArea (Lumir)",
  '      - [9] AXStaticText = "SLK-04 第四片：正文继续。 浮钮此时已经浮现。 它不随内容滚动。"',
  "```",
].join("\n");

const AX_WITH_BUTTON = AX_BODY_TEXT_ONLY.replace(
  '      - [9] AXStaticText',
  '      - [20] AXButton (回到底部) @1044,600 84×28 actions=[AXPress]\n      - [9] AXStaticText',
);

test("node 断言走解析结果：正文里有判据串 ≠ 节点在场（M669 的 224 现场）", async () => {
  const root = tmpRoot("node-presence");
  useTmpEnv(root);
  const scenario = {
    steps: [
      {
        name: "正文里写着判据串、但没有浮钮节点",
        expect: [
          { label: "没钮（应绿）", node: { role: "AXButton", name: "回到底部", present: false } },
          { label: "有钮（应红——正文串不构成节点）", node: { role: "AXButton", name: "回到底部", present: true } },
        ],
      },
    ],
  };
  const bodyOnly = await drive(root, scenario, { cu: { state: async () => ({ text: AX_BODY_TEXT_ONLY, image: null }) } });
  assert.deepEqual(
    bodyOnly.records.map((r) => r.ok),
    [true, false],
    `正文里有「回到底部」而节点不在场时，present:true 必须红、present:false 必须绿；实际 ${JSON.stringify(bodyOnly.records)}`,
  );
  // 反向：钮真的在场时两条判据同时翻面——证明判据对「节点在不在」有区分度，而不是恒绿/恒红。
  const withButton = await drive(root, scenario, { cu: { state: async () => ({ text: AX_WITH_BUTTON, image: null }) } });
  assert.deepEqual(
    withButton.records.map((r) => r.ok),
    [false, true],
    `钮在场时 present:false 必须红、present:true 必须绿；实际 ${JSON.stringify(withButton.records)}`,
  );
  // 退化快照（M667 的 229 现场：element_count=1、空树）上负向判据不许恒真——「读不到当成空」
  // （REVIEW.md）在节点在场性上同样是假绿入口。
  const degraded = await drive(root, {
    steps: [{ name: "退化快照", expect: [{ label: "不在场（应红）", node: { role: "AXButton", name: "回到底部", present: false } }] }],
  }, { cu: { state: async () => ({ text: "# App App State\n\n- pid: 1\n- element_count: 1\n", image: null }) } });
  assert.deepEqual(
    degraded.records.map((r) => r.ok),
    [false],
    `退化快照上 present:false 必须红（不在不可观测的窗口里下结论）；实际 ${JSON.stringify(degraded.records)}`,
  );
});

test("node 断言静态校验：present 必填、角色名 / 未知键 / 坏正则都报 problem", () => {
  const errs = (expect) => checkScenario({ id: "node-check", item: 0, steps: [{ name: "n", expect: [expect] }] });
  assert.ok(
    errs({ node: { name: "回到底部" } }).some((p) => p.includes("node.present 必填布尔")),
    "缺 present 应报 problem（在场 / 不在场方向相反，缺省会静默变味）",
  );
  assert.ok(
    errs({ node: { name: "x", present: true, role: "Button" } }).some((p) => p.includes("node.role 需要 AX 角色名")),
    "role 不是 AX 形态应报 problem",
  );
  assert.ok(
    errs({ node: { name: "x", present: true, bogus: 1 } }).some((p) => p.includes("未知键 bogus")),
    "未知键应报 problem（拼错即静默不判）",
  );
  assert.ok(
    errs({ node: { name: "(", present: true } }).some((p) => p.includes("node.name 不是合法正则")),
    "name 编译不过应报 problem（findNode 会抛，真机上是整场报错）",
  );
  assert.deepEqual(errs({ node: { role: "AXButton", name: "回到底部", present: false } }), []);
  // `node.name` 是裸正则源（与 target.name 同口径）：`\.` 在它里面是对的，不走「写成 /…/」那条检查。
  assert.deepEqual(errs({ node: { role: "AXButton", name: "^回到底部\\.md$", present: true } }), []);
});

test("运行期兜底：零断言场景判 FAIL，不记绿", async () => {
  const root = tmpRoot("runtime-guard");
  useTmpEnv(root);
  const { status, records } = await drive(root, { steps: [] });
  assert.ok(
    records.some((r) => !r.ok && r.label.includes("场景零断言")),
    `应落一条「场景零断言」FAIL，实际：${JSON.stringify(records)}`,
  );
  assert.equal(status, "FAIL", "零断言场景的终态必须是 FAIL");
});

test("裸串含正则转义 ⇒ 静态校验判 problem（M556：M553 的假 FAIL 形态）", () => {
  const scenario = (steps) => ({ id: "bare-escape", item: 0, steps });
  // 每个字段都走 matcher()：裸串按子串匹配，`\(` / `\.` / `\d` 永远命中 0 次。M553 的场景
  // 161/162 正是在 `ax.count.pattern` 上踩到（元素都在、断言假红），故逐处覆盖。
  const cases = [
    ["ax.count.pattern", { expect: [{ ax: { count: { pattern: "AXButton \\(path-link-target\\.md\\)", exact: 1 } } }] }],
    ["ax.has", { expect: [{ ax: { has: "AXStaticText \\(LIMIT\\)" } }] }],
    ["ax.not", { expect: [{ ax: { not: "AXButton \\(停止\\)" } }] }],
    ["ax.focused", { expect: [{ ax: { focused: "AXTextArea\\d" } }] }],
    ["editor.has", { expect: [{ editor: { has: "keys\\.md" } }] }],
    ["file.not", { expect: [{ file: { path: "probe.md", not: "\\[\\[wiki" } }] }],
    ["clipboard.has", { expect: [{ clipboard: { has: "loose\\?ly" } }] }],
    ["waitFor.has[0]", { do: "waitFor", waitFor: { has: ["AXButton \\(发送\\)"] } }],
    ["verify.pattern", { do: "key", key: "cmd+v", verify: { pattern: "hello\\.md" } }],
    ["verify.target.any", { do: "key", key: "cmd+v", verify: { pattern: "ok", target: { any: "AXTextArea \\(composer\\)" } } }],
    ["do=drag 的 selection", { do: "drag", target: { x: 10, y: 10 }, dx: 5, dy: 0, selection: "AXButton \\(摘录\\)" }],
    ["geom.target.any", { expect: [{ geom: { target: { any: "AXStaticText \\(ctx\\)" } } }] }],
    ["target.any", { do: "click", target: { role: "AXButton", any: "AXButton \\(notes\\)" } }],
    ["target.help", { do: "click", target: { role: "AXGroup", help: "```mermaid\\.x" } }],
    ["target.anchor.any", { do: "hover", target: { anchor: { any: "AXStaticText \\(ctx\\)" }, offsetX: 10, offsetY: 0 } }],
  ];
  for (const [field, step] of cases) {
    const problems = checkScenario(scenario([{ name: `覆盖 ${field}`, ...step }]));
    assert.ok(
      problems.some((p) => p.includes(field) && p.includes("正则转义") && p.includes("写成 /…/ 形态")),
      `${field} 的裸串转义应判 problem 并提示改 /…/ 形态，实际：${JSON.stringify(problems)}`,
    );
  }
});

test("不误伤：/…/ 形态、裸正则源字段、字面反斜杠都不判（M556 的反向验证）", () => {
  const scenario = (steps, extra = {}) => ({ id: "no-escape-hit", item: 0, steps, ...extra });
  const steps = [
    // `/…/` 形态：转义正是要写的（M553 修好后的形态）。
    { name: "正则形态", expect: [{ ax: { count: { pattern: "/AXButton \\(path-link-target\\.md\\)/", exact: 1 } } }] },
    // `target.name` / `marker` / `glob.pattern` 是裸正则源，不经 matcher —— `\.` 在那里是对的。
    { name: "裸正则源定位", do: "click", target: { role: "AXButton", name: "^path-link-target\\.md$" } },
    { name: "路径 glob", expect: [{ glob: { dir: ".", pattern: "\\.json$" } }] },
    // 字面反斜杠：LaTeX 的 `\int`（场景 02）与 JSONL 里的 `\n` 都不是正则转义。
    { name: "LaTeX 字面量", expect: [{ editor: { not: "\\int_0^1 x^2" } }] },
    { name: "JSONL 转义字面量", expect: [{ file: { path: "probe.md", has: "\\n\\n" } }] },
    // 纯子串：没有转义，照旧。
    { name: "普通子串", expect: [{ ax: { has: "AXButton (发送)" } }] },
  ];
  assert.deepEqual(checkScenario(scenario(steps, { marker: "第 15 章 概览\\s*正文" })), []);
});

test("通知动作与 requires: bundle：写错键在静态校验期就报（M605）", () => {
  const errs = (steps, extra = {}) => checkScenario({ id: "notif", item: 0, steps, ...extra });
  assert.ok(
    errs([{ name: "缺 title", do: "waitForNotification" }]).some((p) => p.includes("非空字符串 title")),
    "waitForNotification 缺 title 应报 problem",
  );
  assert.ok(
    errs([{ name: "坏 body", do: "clickNotification", title: "t", body: 5 }]).some((p) => p.includes("body 需要字符串")),
    "body 类型错应报 problem",
  );
  assert.ok(
    errs([{ name: "多写键", do: "clickNotification", title: "t", target: { x: 1 } }]).some((p) =>
      p.includes("未知键 target"),
    ),
    "通知动作不吃 target（不是节点点击），多写应报 problem 而不是静默忽略",
  );
  assert.deepEqual(errs([{ name: "ok", do: "clickNotification", title: "t", body: "到点", timeoutMs: 1000 }]), []);
  // M620：`fresh` 只属于 waitForNotification，且必须是布尔（写错值会静默退回默认新鲜度）。
  assert.deepEqual(errs([{ name: "ok", do: "waitForNotification", title: "t", fresh: false }]), []);
  assert.ok(
    errs([{ name: "fresh 只给 wait", do: "clickNotification", title: "t", fresh: false }]).some((p) =>
      p.includes("clickNotification 不接受 fresh"),
    ),
    "clickNotification 写 fresh 应报 problem",
  );
  assert.ok(
    errs([{ name: "fresh 类型", do: "waitForNotification", title: "t", fresh: "no" }]).some((p) =>
      p.includes("fresh 需要布尔值"),
    ),
    "fresh 非布尔应报 problem（字符串 'no' 这种真值输入会让判据静默变味）",
  );
  assert.ok(
    errs([{ name: "一步", expect: [{ shot: "x" }] }], { requires: "dev" }).some((p) =>
      p.includes('requires 只支持 "bundle"'),
    ),
    "requires 写错值应报 problem（否则 runner 静默忽略、场景在 dev 下跑出假 FAIL）",
  );
  assert.deepEqual(errs([{ name: "一步", expect: [{ shot: "x" }] }], { requires: "bundle" }), []);
});

test("通知新鲜度基线（M617）：基线里的旧条目不算新投递，新出现的条目才算", () => {
  // 现场（finding 20261020-worker-m616-bug-waitfornotification-run-ax）：更早一次 run 的同标题
  // 通知在通知列表里存活数分钟，而新旧条目在 AX 里逐字相同——只能按「同签名条目比基线多出来的
  // 那条」判新投递。这里用纯函数把三种形态钉住（真机层由 170/171 复跑兜底）。
  const group = (app, task, body) => ({
    role: "AXGroup",
    raw: `- [10] AXGroup (${app}, ${task}, ${body}) actions=[AXPress, Show Details, Close]`,
  });
  const spec = { title: "acc-cron-click", body: "到点" };
  const stale = group("Lumir", "acc-cron-click", "到点");

  // ① 基线 1 条旧条目，当前树里仍只有它 ⇒ 不满足等待（旧条目不是新投递）。
  const baseline = notificationBaseline([stale], spec);
  assert.equal(baseline.size, 1, "基线应记下 1 个签名");
  assert.equal(pickFreshNotification([stale], spec, baseline), null, "只有旧条目时不得命中（这正是 M616 的 56s 提前现场）");

  // ② 同签名的新条目落进列表（旧条目还在）⇒ 第 2 条同签名条目才是新的。
  const fresh = group("Lumir", "acc-cron-click", "到点");
  const current = [fresh, stale];
  const picked = pickFreshNotification(current, spec, baseline);
  assert.ok(picked, "出现第 2 条同签名条目后应命中");
  assert.equal(picked.raw, fresh.raw, "命中的必须是新投递那条（同文，按列表顶部取）");
  assert.notEqual(pickFreshNotification([stale], spec, baseline), picked, "旧条目自身不得被当成新投递");

  // ③ 新条目的原文与基线不同（如系统在旧条目上补了时间 / stacked 标记）⇒ 直接认新签名。
  const stamped = group("Lumir", "acc-cron-click", "到点, 12:46");
  assert.equal(
    pickFreshNotification([stamped, stale], spec, baseline)?.raw,
    stamped.raw,
    "基线里没有的签名（旧列表条目被系统补了时间）应直接判为新投递",
  );

  // ④ 基线为空（动作开始时列表里没有匹配条目）⇒ 任何匹配条目都算新投递。
  assert.equal(pickFreshNotification([stale], spec, new Map())?.raw, stale.raw, "基线为空时首条匹配即新投递");
  assert.equal(pickFreshNotification([], spec, new Map()), null, "没有匹配条目时不得命中（不把「读不到」当「已投递」）");
});

test("do: waitForNotification（动作级）：旧条目在场不提前返回，新条目出现才返回；只有旧条目时超时判 FAIL", async (t) => {
  // 动作级验证 M617 的接线：基线快照取自**动作开始时**的树，只有它之后多出来的条目才算投递。
  // 树用桩喂（`cu.state`），不读真实通知中心——套件自测不碰用户环境；NotificationCenter 进程
  // 只是 pid 来源，不在场就跳过（CI / 无桌面环境不红）。
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "NotificationCenter"], { encoding: "utf8" });
  } catch {
    t.skip("NotificationCenter 不在场（无桌面环境）：本用例只验动作接线，跳过");
    return;
  }
  const root = tmpRoot("notify-fresh-action");
  useTmpEnv(root);
  const entry = "- [10] AXGroup (Lumir, acc-cron-click, 到点) actions=[AXPress, Show Details, Close]";
  const tree = (entries) =>
    ["# Notification Center App State", "```text", '- [0] AXApplication "Notification Center"', ...entries, "```"].join("\n");

  // ① 前两次读只有更早一次 run 的旧条目；第 3 次读起列表里多出一条同文的新条目。
  let reads = 0;
  const ctx = stubCtx(root);
  ctx.cu = {
    state: async () => {
      reads += 1;
      return { text: tree(reads <= 2 ? [entry] : [entry, entry]), image: null };
    },
  };
  const ok = await runScenario(ctx, {
    id: "notify-fresh",
    item: 0,
    title: "通知新鲜度",
    file: path.join(root, "notify-fresh.md"),
    steps: [{ name: "等新通知", do: "waitForNotification", title: "acc-cron-click", body: "到点", timeoutMs: 5000 }],
  });
  assert.equal(ok.status, "PASS", `新条目出现后应 PASS，实际：${JSON.stringify(ctx.evidence.records)}`);
  assert.ok(reads >= 3, `旧条目在场的前两次读不得命中（基线里已有它），实际只读了 ${reads} 次`);
  const notes = ctx.evidence.records.filter((r) => r.kind === "note").map((r) => r.text).join("\n");
  assert.match(notes, /基线快照.*1 条/, `证据里应记下基线（1 条旧条目），实际：${notes}`);

  // ② 整个等待期间只有那条旧条目 ⇒ 超时判 FAIL，错误里点明「基线之后新出现的」与基线读数。
  const stuck = stubCtx(root);
  stuck.cu = { state: async () => ({ text: tree([entry]), image: null }) };
  const bad = await runScenario(stuck, {
    id: "notify-stale",
    item: 0,
    title: "通知新鲜度（旧条目）",
    file: path.join(root, "notify-stale.md"),
    steps: [{ name: "等不到新通知", do: "waitForNotification", title: "acc-cron-click", body: "到点", timeoutMs: 300 }],
  });
  assert.equal(bad.status, "FAIL", "只有旧条目时必须判 FAIL（不得把上一批的通知当成这次投递）");
  const fail = stuck.evidence.records.find((r) => r.kind === "assert" && !r.ok && r.label.includes("等不到新通知"));
  assert.ok(fail, `应落一条动作 FAIL，实际：${JSON.stringify(stuck.evidence.records)}`);
  assert.match(fail.detail ?? "", /超时/, "失败理由应点明超时");
  assert.match(fail.detail ?? "", /基线之后新出现的|基线 1 个签名/, "失败理由应给出基线口径（旧条目在场、但不在基线之外）");
});

test("do: waitForNotification（动作级，M620）：fresh=false 接受动作开始前已送达的条目，默认判据仍把它当旧条目", async (t) => {
  // 冷启动通知比步骤先到：条目在动作开始时就在场，默认新鲜度判据会（正确地）把它当旧条目挡掉，
  // 冷启动场景因此用 `fresh: false` 显式接受它。这里构造同一棵树分别跑两档，证明两档判据真的不同。
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "NotificationCenter"], { encoding: "utf8" });
  } catch {
    t.skip("NotificationCenter 不在场（无桌面环境）：本用例只验动作接线，跳过");
    return;
  }
  const root = tmpRoot("notify-fresh-off");
  useTmpEnv(root);
  const entry = "- [10] AXGroup (Lumir, acc-cron-startup, 到点) actions=[AXPress, Show Details, Close]";
  const tree = ["# Notification Center App State", "```text", '- [0] AXApplication "Notification Center"', entry, "```"].join(
    "\n",
  );

  // ① 默认档（fresh 缺省 = true）：唯一那条是动作开始前就在场的 ⇒ 超时判 FAIL。
  const strict = stubCtx(root);
  let strictReads = 0;
  strict.cu = {
    state: async () => {
      strictReads += 1;
      return { text: tree, image: null };
    },
  };
  const bad = await runScenario(strict, {
    id: "notify-fresh-on",
    item: 0,
    title: "冷启动通知（默认新鲜度）",
    file: path.join(root, "notify-fresh-on.md"),
    steps: [{ name: "等新通知", do: "waitForNotification", title: "acc-cron-startup", body: "到点", timeoutMs: 300 }],
  });
  assert.equal(bad.status, "FAIL", "默认档不得把动作开始前已在场的条目当新投递");
  assert.ok(strictReads >= 2, `默认档应持续轮询到超时，实际只读了 ${strictReads} 次`);

  // ② fresh=false：同一条目立即满足等待（冷启动投递早于步骤），证据里记明这一档的口径。
  const loose = stubCtx(root);
  let looseReads = 0;
  loose.cu = {
    state: async () => {
      looseReads += 1;
      return { text: tree, image: null };
    },
  };
  const ok = await runScenario(loose, {
    id: "notify-fresh-off",
    item: 0,
    title: "冷启动通知（fresh=false）",
    file: path.join(root, "notify-fresh-off.md"),
    steps: [
      { name: "冷启动通知在场", do: "waitForNotification", title: "acc-cron-startup", body: "到点", fresh: false, timeoutMs: 300 },
    ],
  });
  assert.equal(ok.status, "PASS", `fresh=false 应立即命中已在场的条目，实际：${JSON.stringify(loose.evidence.records)}`);
  assert.equal(looseReads, 1, "fresh=false 不该先空等一轮（首读即容忍已在场的条目）");
  const notes = loose.evidence.records.filter((r) => r.kind === "note").map((r) => r.text).join("\n");
  assert.match(notes, /fresh=false：接受动作开始前已在场的匹配条目/, `证据应记明这一档的口径，实际：${notes}`);
});

test("do: clickNotification（动作级）：沿用等待基线，点新条目而不是更早一次 run 的同任务旧条目（M617）", async (t) => {
  // 两个同名条目的**原文不同**时（系统给旧条目补了时间后缀），基线能让点击绕开旧条目；
  // 不沿用基线的话 clickNotification 会命中列表里的第一条（这里是旧条目），点到已退出的实例。
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "NotificationCenter"], { encoding: "utf8" });
  } catch {
    t.skip("NotificationCenter 不在场（无桌面环境）：本用例只验动作接线，跳过");
    return;
  }
  const root = tmpRoot("notify-click-baseline");
  useTmpEnv(root);
  const stale = "- [10] AXGroup (Lumir, acc-cron-click, 到点, 21:12) actions=[AXPress, Show Details, Close]";
  const fresh = "- [12] AXGroup (Lumir, acc-cron-click, 到点) actions=[AXPress, Show Details, Close]";
  const tree = (entries) =>
    ["# Notification Center App State", "```text", '- [0] AXApplication "Notification Center"', ...entries, "```"].join("\n");
  let reads = 0;
  const clicks = [];
  const ctx = stubCtx(root);
  ctx.cu = {
    state: async () => {
      reads += 1;
      return { text: tree(reads <= 2 ? [stale] : [stale, fresh]), image: null };
    },
    click: async (pid, args) => {
      clicks.push({ pid, ...args });
      return { json: { ok: true } };
    },
  };
  const { status } = await runScenario(ctx, {
    id: "notify-click",
    item: 0,
    title: "通知点击沿用基线",
    file: path.join(root, "notify-click.md"),
    steps: [
      { name: "等新通知", do: "waitForNotification", title: "acc-cron-click", body: "到点", timeoutMs: 5000 },
      { name: "点新通知", do: "clickNotification", title: "acc-cron-click", body: "到点", timeoutMs: 5000 },
    ],
  });
  assert.equal(status, "PASS", `等待 + 点击应 PASS，实际：${JSON.stringify(ctx.evidence.records)}`);
  assert.equal(clicks.length, 1, `应只点一次，实际：${JSON.stringify(clicks)}`);
  assert.equal(clicks[0].index, 12, "点击目标应是新条目（index 12），不是旧条目（index 10）——基线没沿用就会点到旧条目");
  const notes = ctx.evidence.records.filter((r) => r.kind === "note").map((r) => r.text).join("\n");
  assert.match(notes, /沿用前置 waitForNotification 的基线/, `证据里应记明沿用了等待基线，实际：${notes}`);
});

test("通知定位判据：title 与 body 必须同时命中，且只认 AXGroup（M617 抽出的单一实现）", () => {
  const group = (text) => ({ role: "AXGroup", raw: `- [10] AXGroup ${text}` });
  const nodes = [
    group("(Lumir, acc-cron-click, 到点) actions=[AXPress]"),
    group("(Lumir, acc-cron-run, 已完成) actions=[AXPress]"),
    { role: "AXStaticText", raw: '- [11] AXStaticText = "acc-cron-click 到点"' },
  ];
  assert.equal(notificationMatches(nodes, { title: "acc-cron-click", body: "到点" }).length, 1, "同文静态文本不算通知条目");
  assert.equal(notificationMatches(nodes, { title: "acc-cron-click", body: "已完成" }).length, 0, "body 不符不得命中");
  assert.equal(
    notificationMatches(nodes, { title: "acc-cron-run" }).length,
    1,
    "不写 body 时按标题匹配（trigger / result 两档同标题）",
  );
  // 多重集合：两条逐字相同的条目应记成「同签名 ×2」。
  const dup = [group("(Lumir, acc-cron-click, 到点)"), group("(Lumir, acc-cron-click, 到点)")];
  assert.equal(
    [...notificationBaseline(dup, { title: "acc-cron-click", body: "到点" }).values()].join(","),
    "2",
    "同文条目按出现次数计入基线（集合语义会把两条压成一条）",
  );
});

/** 合成一份含两个 `AXTextArea` 的 AX dump（M678）：编辑器在前、composer 在后——224 的现场形态
 *  （`[166]` 是编辑器正文、`[250]` 是 composer）。`marks` 里的角色带 `(focused)` 标记。
 *  header 取 mode=full 的当前形态（`captured_bounds` + `coords: …screenshot pixels`，长边 2048）。 */
function focusDump(...marks) {
  const mark = (k) => (marks.includes(k) ? " (focused)" : "");
  return [
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 1",
    "- element_count: 5",
    "- captured_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "- screenshot: 2048×1365 px",
    "- coords: bbox `@x,y w×h` and click/scroll/drag x,y are screenshot pixels (origin = top-left of the screenshot)",
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 2048×1365',
    `    - [5] AXWebArea (Lumir)${mark("webview")}`,
    `    - [166] AXTextArea = "# 文档正文" @0,100 600×500${mark("editor")}`,
    `    - [250] AXTextArea (问点什么…) @700,600 400×40${mark("composer")}`,
    "```",
  ].join("\n");
}

/** 从一份 dump 取焦点读数：编辑器按「第一个 AXTextArea」定位（与 clickEditor / keys 同一口径）。 */
function readDump(marked) {
  const nodes = parseNodes(focusDump(...marked));
  return focusedRoleReading(nodes, { editor: nodes.find((n) => n.role === "AXTextArea") });
}

test("焦点读数（M678）：必须先区分「哪个 AXTextArea 有焦点」——composer 有焦点 ≠ 焦点已建立", () => {
  // 正观测：编辑器拿到焦点。
  const onEditor = readDump(["editor"]);
  assert.deepEqual(
    { count: onEditor.count, role: onEditor.role, isEditor: onEditor.isEditor },
    { count: 1, role: "AXTextArea", isEditor: true },
  );

  // 反向验证 ①：**单击没落地、焦点还留在 composer**。composer 也是 AXTextArea，只看 role 会判通过
  //（224 的现场：焦点原本就在 composer）——必须判「未建立」。
  const onComposer = readDump(["composer"]);
  assert.equal(onComposer.count, 1, "composer 是 AXTextArea，role 面与编辑器不可分辨");
  assert.equal(onComposer.role, "AXTextArea");
  assert.equal(onComposer.isEditor, false, "焦点在 composer 上 = 单击没把焦点搬进编辑器，不得判通过");

  // 反向验证 ②：M670 的坏态——标题栏单击之后 webview 失去焦点，AX 里只剩 AXWebArea（或没有）。
  const onWebview = readDump(["webview"]);
  assert.equal(onWebview.role, "AXWebArea");
  assert.equal(onWebview.isEditor, false, "webview 级焦点不是编辑器焦点（键盘没有落点）");
  assert.equal(readDump([]).count, 0, "无 focused 标记 = 0 个");
  assert.equal(readDump(["editor", "composer"]).count, 2, "两个 focused 节点不是「唯一焦点」");
  assert.equal(readDump(["editor", "composer"]).isEditor, false, "多个 focused 节点一律判「未建立」");
});

test("正文单击落点（M678 / M762）：dx/dy 是窗口局部点，换算到屏幕点与证据用的截图像素，以及两条不可算的边界", () => {
  const textarea = { bbox: { x: 100, y: 200, w: 600, h: 500 } };
  const bounds = { x: 8, y: 40, w: 1200, h: 800 };
  const shot = { w: 1152, h: 768 };

  const g = contentClickGeometry({ textarea, bounds, shot });
  // 落点 = 编辑器左缘（点）+ 缺省 (40,6)**点**：100px ÷ 0.96 = 104.1667pt，再加 40。
  assert.ok(Math.abs(g.point.x - (8 + 100 * (1200 / 1152) + 40)) < 1e-9, `x 换算错：${g.point.x}`);
  assert.ok(Math.abs(g.point.y - (40 + 200 * (800 / 768) + 6)) < 1e-9, `y 换算错：${g.point.y}`);
  // 证据行仍按**截图像素**打印（与截图上的落点同一空间）：bbox.x + 40pt×0.96。
  assert.ok(Math.abs(g.shotPoint.x - (100 + 40 * (1152 / 1200))) < 1e-9, `shotPoint.x 换算错：${g.shotPoint.x}`);
  assert.ok(Math.abs(g.shotPoint.y - (200 + 6 * (768 / 800))) < 1e-9, `shotPoint.y 换算错：${g.shotPoint.y}`);

  const custom = contentClickGeometry({ textarea, bounds, shot, dx: 120, dy: 60 });
  assert.ok(Math.abs(custom.point.x - (8 + 100 * (1200 / 1152) + 120)) < 1e-9, "clickEditor 的 dx/dy 按点生效");

  // 没有编辑器 bbox（文档没开 / modal / 快照退化）：普通 Error，且点明「本动作点的是正文」——
  // 不得退化成点标题栏或点 (0,0)，那是 M670 的旧形态。
  assert.throws(
    () => contentClickGeometry({ textarea: null, bounds, shot }),
    (e) => e instanceof Error && !(e instanceof InfraError) && /标题栏/.test(e.message),
  );
  // 快照退化（缺 window_bounds / 截图尺寸）：InfraError（本场读数不算数）。
  assert.throws(() => contentClickGeometry({ textarea, bounds: null, shot }), (e) => e instanceof InfraError);
  assert.throws(() => contentClickGeometry({ textarea, bounds, shot: null }), (e) => e instanceof InfraError);
});

test("正文单击落点的密度无关性（M762）：同一份标定 + 同一份物理几何，只换截图密度 ⇒ 屏幕落点逐值相同", () => {
  // M761 现场：KimiCU 0.6.8 把截图长边从 1152 提到 2048（0.96 → 1.707 像素/点），同一组
  // 「截图像素」偏移的物理位移随之缩小 1.78×——53 的 dx=110/dy=60 从 (114.6, 62.5)pt 缩到
  // (64.4, 35.2)pt，落点左移 50.2pt 落到粗体行上方的空行。标定单位必须是**点**才不随上游改
  // 截图密度而漂：本用例把两代密度的同一份标定并排算一遍，屏幕落点必须逐值相同。
  const bounds = { x: 8, y: 40, w: 1200, h: 800 };
  const kx = 2048 / 1152;
  const ky = 1365 / 768;
  const box1152 = { x: 340, y: 160, w: 730, h: 600 };
  const box2048 = { x: 340 * kx, y: 160 * ky, w: 730 * kx, h: 600 * ky };
  const a = contentClickGeometry({ textarea: { bbox: box1152 }, bounds, shot: { w: 1152, h: 768 }, dx: 115, dy: 62 });
  const b = contentClickGeometry({ textarea: { bbox: box2048 }, bounds, shot: { w: 2048, h: 1365 }, dx: 115, dy: 62 });
  assert.ok(Math.abs(a.point.x - b.point.x) < 1e-6, `同一落点在两代密度下必须同值，实际 ${a.point.x} vs ${b.point.x}`);
  assert.ok(Math.abs(a.point.y - b.point.y) < 1e-6, `同一落点在两代密度下必须同值，实际 ${a.point.y} vs ${b.point.y}`);
  // 顺带钉住量级：落点 = 编辑器左缘（点）+ 115pt。旧口径在 2048 密度上只走 115÷1.707 = 67.4pt。
  assert.ok(Math.abs(a.point.x - (8 + 340 * (1200 / 1152) + 115)) < 1e-9, `x 落点错：${a.point.x}`);
  // 证据行是截图像素：同一物理落点在两代密度下给出不同的像素坐标（换算没被跳过）。
  assert.ok(Math.abs(a.shotPoint.x - (340 + 115 * (1152 / 1200))) < 1e-9, `1152 证据行错：${a.shotPoint.x}`);
  assert.ok(Math.abs(b.shotPoint.x - ((2048 / 1152) * 340 + 115 * (2048 / 1200))) < 1e-9, `2048 证据行错：${b.shotPoint.x}`);
  assert.ok(b.shotPoint.x - a.shotPoint.x > 150, "两代密度的像素坐标必须明显不同（证明换算真的按密度算）");
});

test("scroll 落点（M762）：`target {x,y}` 是窗口点——同一份标定在两代截图密度下折成同一个物理点", () => {
  // 224 的现场：`{x:900, y:350}` 在 1152 密度（0.96）落到窗口 (938,365)、正好在 harness pane 里；
  // 截图像素口径在 2048 密度（1.707）只剩窗口 (527,205)——那是左侧编辑器，滚的是编辑器。
  const bounds = { x: 8, y: 40, w: 1200, h: 800 };
  const a = pointToShotPx({ pt: { x: 900, y: 350 }, bounds, shot: { w: 1152, h: 768 } });
  const b = pointToShotPx({ pt: { x: 900, y: 350 }, bounds, shot: { w: 2048, h: 1365 } });
  assert.deepEqual(a, { x: 864, y: 336 }, `1152 密度：900×0.96 / 350×0.96，实际 ${JSON.stringify(a)}`);
  assert.deepEqual(b, { x: 1536, y: 597 }, `2048 密度：900×1.70667 / 350×1.70625，实际 ${JSON.stringify(b)}`);
  // 关键判据：折回窗口点后两代密度必须同值（取整误差 ≤ 半个像素）。旧口径直接透传 900/350，
  // 2048 密度下等于窗口 (527,205) —— 差 373pt，整条场景从此换个面滚。
  assert.ok(Math.abs(a.x / (1152 / 1200) - b.x / (2048 / 1200)) <= 0.5, `x 物理点漂了：${a.x} vs ${b.x}`);
  assert.ok(Math.abs(a.y / (768 / 800) - b.y / (1365 / 800)) <= 0.5, `y 物理点漂了：${a.y} vs ${b.y}`);
});

test("clickEditor 的非 real 通道（M762，r1 评审 P2-1）：同一份窗口点标定在两代截图密度下落到同一物理点", async () => {
  // 53 的原始故障就发生在**这条通道**（KimiCU 坐标点击），而它此前自己算一份 `bbox + dx*scale`：
  // 把那份公式退回旧式 `bbox + dx` 时，只测 `contentClickGeometry` 的用例照样全绿——防线没落在
  // 出过事的那条路径上。这里跑**动作本身**（runScenario → case "clickEditor"）：桩 cu 记录真实
  // 下发的 click 坐标，两代密度各点一次，再断两点都等于「bbox + 窗口点×缩放比」且折回窗口点同值。
  const clickOnceAt = async (shot) => {
    const clicks = [];
    const { text, bbox } = clickEditorDump({ shot });
    const cu = {
      state: async () => ({ text, image: null }),
      click: async (_pid, opts) => {
        clicks.push(opts);
        return "ok";
      },
    };
    const { status } = await drive(
      tmpRoot(`clickeditor-${shot.w}`),
      { steps: [{ name: "点编辑器", do: "clickEditor", dx: 115, dy: 62 }] },
      { cu },
    );
    assert.equal(status, "PASS", `clickEditor 步骤应成功，实际 ${status}`);
    assert.equal(clicks.length, 1, `应恰好点一次，实际 ${clicks.length} 次`);
    return { click: clicks[0], bbox };
  };
  const a = await clickOnceAt({ w: 1152, h: 768 });
  const b = await clickOnceAt({ w: 2048, h: 1365 });
  const ax = 1152 / 1200;
  const ay = 768 / 800;
  const bx = 2048 / 1200;
  const by = 1365 / 800;
  // 落点 = 文本框 bbox（该密度的截图像素）+ 窗口点 × 缩放比
  assert.ok(Math.abs(a.click.x - (a.bbox.x + 115 * ax)) < 1e-6, `1152 密度落点 x 错：${a.click.x}`);
  assert.ok(Math.abs(a.click.y - (a.bbox.y + 62 * ay)) < 1e-6, `1152 密度落点 y 错：${a.click.y}`);
  assert.ok(
    Math.abs(b.click.x - (b.bbox.x + 115 * bx)) < 1e-6,
    `2048 密度落点 x 错：${b.click.x}（退回 bbox+dx 会给 ${b.bbox.x + 115}）`,
  );
  assert.ok(
    Math.abs(b.click.y - (b.bbox.y + 62 * by)) < 1e-6,
    `2048 密度落点 y 错：${b.click.y}（退回 bbox+dy 会给 ${b.bbox.y + 62}）`,
  );
  // 折回窗口点：两代密度必须同值 = 同一物理落点（KimiCU 的 click 只吃截图像素，这份换算是唯一出口）。
  // 容差 1pt：两代 dump 的 bbox 各自取整，亚像素差不是判据。
  assert.ok(Math.abs(a.click.x / ax - b.click.x / bx) < 1, `同一落点在两代密度下漂了：${a.click.x} vs ${b.click.x}`);
  assert.ok(Math.abs(a.click.y / ay - b.click.y / by) < 1, `同一落点在两代密度下漂了：${a.click.y} vs ${b.click.y}`);
});

test("像素采样方块（M762）：patch 是窗口点，同一邻域在两代截图密度下覆盖同一物理边长", () => {
  // 与正文单击同一条纪律（M761 的 64 现场）：patch 原先是**截图像素**，7px 的物理边长从
  // 7.3pt（1152 密度）缩到 4.1pt（2048 密度），eink 的字形采样因此落进行间、亮度跨度塌到 10。
  // 采样点与方块边长都属于「物理量」，单位取点；截图像素只在取图那一层出现。
  const bounds = { x: 8, y: 40, w: 1200, h: 800 };
  const a = sampleWindowPx({ pt: { x: 500, y: 222 }, patch: 7, bounds, shot: { w: 1152, h: 768 } });
  const b = sampleWindowPx({ pt: { x: 500, y: 222 }, patch: 7, bounds, shot: { w: 2048, h: 1365 } });
  assert.deepEqual({ px: a.px, py: a.py }, { px: 480, py: 213 }, `1152 密度的采样像素错：${JSON.stringify(a)}`);
  assert.deepEqual({ px: b.px, py: b.py }, { px: 853, py: 379 }, `2048 密度的采样像素错：${JSON.stringify(b)}`);
  assert.equal(a.patchPx, 7, "7pt @0.96 = 6.72px → 7");
  assert.equal(b.patchPx, 12, "7pt @1.707 = 11.95px → 12");
  assert.ok(
    Math.abs(a.patchPx / (1152 / 1200) - b.patchPx / (2048 / 1200)) <= 0.5,
    `两代密度的物理边长必须相同（取整误差 ≤ 半个像素），实际 ${a.patchPx}px@0.96 vs ${b.patchPx}px@1.707`,
  );
});

test("focusWindow click 的重试与判败（M678）：双判据严格为真才通过，坏态与不可读一律判失败", async () => {
  let clicks = 0;
  let current = ["webview"];
  const keyOk = async () => ({ focused: true, raw: "focusedWindow=true title=Lumir" });
  const clickOnce = async () => {
    clicks += 1;
    return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
  };
  const readFocus = async () => readDump(current);

  // ① 第一次单击被激活吃掉（仍是 M670 的 webview 级焦点），第二次落地 ⇒ 恰好点两次后成功。
  //    成功路径必须显式注入 `focused: true`（r1 评审 P1-1：缺省 reader / null 不得通过）。
  const ok = await establishEditorFocus({
    clickOnce: async (i) => {
      current = i === 1 ? ["webview"] : ["editor"];
      return clickOnce(i);
    },
    readFocus,
    readKeyWindow: keyOk,
    attempts: 3,
    sleepFn: async () => {},
  });
  assert.equal(ok.attempt, 2, `应在第 2 次单击后建立焦点，实际 ${ok.attempt}`);
  assert.equal(clicks, 2, `应恰好点两次，实际 ${clicks}`);
  assert.equal(ok.reading.isEditor, true);
  assert.equal(ok.key.focused, true, "成功路径必须带上 key 读数（true）");

  // ② 单击一直不落地、焦点留在 composer（最像假绿的状态）⇒ 耗尽 attempts 后判失败，不静默放行。
  let stuckClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        stuckClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["composer"]),
      readKeyWindow: keyOk,
      attempts: 3,
      sleepFn: async () => {},
    }),
    (e) => e instanceof InfraError && /仍未建立「key window \+ 编辑器焦点」/.test(e.message),
    "composer 有焦点时必须判「未建立」，且耗尽重试后抛 InfraError",
  );
  assert.equal(stuckClicks, 3, `重试上限应恰好用满 3 次，实际 ${stuckClicks}`);

  // ③ 编辑器有焦点、但 AX 明确读到聚焦窗口是**另一个**窗口（false）⇒ 判失败。
  let notKeyClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        notKeyClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["editor"]),
      readKeyWindow: async () => ({ focused: false, raw: "focusedWindow=false title=Agent" }),
      attempts: 2,
      sleepFn: async () => {},
    }),
    // 原始读数（含 `title=`）必须活到错误文案里（M761 真机实证的归因缺口）：只写 false 时分不清
    // 「焦点真在别处」与「多了一扇窗把 AXWindows[0] 挤走、套件的选窗假设坏了」。
    (e) => e instanceof InfraError && /AXfocusedWindow=false/.test(e.message) && /title=Agent/.test(e.message),
    "编辑器有焦点但 AXFocusedWindow=false 时必须判「未建立」，且把 key 读数的原始行（含聚焦窗口标题）带进错误",
  );
  assert.equal(notKeyClicks, 2, `窗口不是 key 时应把重试用满，实际 ${notKeyClicks}`);

  // ④ 第一次就成立（编辑器焦点 + 窗口是 key=true）⇒ 只点一次（不多点、不多等）。
  let firstClicks = 0;
  const first = await establishEditorFocus({
    clickOnce: async () => {
      firstClicks += 1;
      return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
    },
    readFocus: async () => readDump(["editor"]),
    readKeyWindow: keyOk,
    attempts: 3,
    sleepFn: async () => {},
  });
  assert.equal(first.attempt, 1);
  assert.equal(firstClicks, 1);
  assert.equal(first.key.focused, true);

  // ⑤ 窗口读数 **unknown**（AX 读取失败）⇒ 必须判失败（r1 评审 P1-1 的核心反向用例）：
  //    旧写法 `!== false` 会在这里静默通过，key-window 通道失效时退化成单判据。
  let unknownClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        unknownClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["editor"]),
      readKeyWindow: async () => ({ focused: null, raw: "focusedWindow=unknown err=-10005 title=Lumir" }),
      attempts: 2,
      sleepFn: async () => {},
    }),
    (e) => e instanceof InfraError && /AXfocusedWindow=unknown/.test(e.message),
    "key 读数 unknown 时必须判「未建立」并在错误里点明读数不可用",
  );
  assert.equal(unknownClicks, 2, `unknown 应把重试用满（不得提前放行），实际 ${unknownClicks}`);

  // ⑥ **根本没给 reader** ⇒ 同样必须判失败：两条判据不能因为通道缺席而退化成单判据。
  let missingClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        missingClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["editor"]),
      attempts: 2,
      sleepFn: async () => {},
    }),
    (e) => e instanceof InfraError && /AXfocusedWindow=未读/.test(e.message),
    "没有 key 读数通道时必须判「未建立」，不得当成通过",
  );
  assert.equal(missingClicks, 2, `缺 reader 应把重试用满，实际 ${missingClicks}`);
});

test("key window 读数解析（M678 r1 / M762）：true / false / unknown 三态分开，unknown 不归一成 false", () => {
  assert.equal(parseKeyWindowState("focusedWindow=true title=Lumir"), true);
  assert.equal(parseKeyWindowState("focusedWindow=false title=Agent"), false, "读到另一个窗口 = 确定不是主窗口");
  assert.equal(
    parseKeyWindowState("focusedWindow=unknown err=-10005 title=Lumir"),
    null,
    "属性读取失败 = unknown，必须与确定状态分开",
  );
  assert.equal(parseKeyWindowState("focusedWindow=unknown err=no-window-value title=Lumir"), null);
  assert.equal(parseKeyWindowState("garbage output"), null, "输出无法解析同样是 unknown");
  // M762 起原始行带窗口事实（主窗 summary / 聚焦窗 summary / 窗口数）：解析口径不变，
  // 事实原样留在 raw 里供错误文案与证据复盘（224 的 r1 就是「只有 false、看不出是谁」）。
  assert.equal(
    parseKeyWindowState(
      'focusedWindow=true title=Lumir main=AXStandardWindow "Lumir" @8,40 1200×800 windows=2',
    ),
    true,
    "带窗口事实的成功行照样解析成 true",
  );
  assert.equal(
    parseKeyWindowState(
      'focusedWindow=false title=Lumir main=AXStandardWindow "Lumir" @8,40 1200×800 focused=AXDialog "Window" @14,46 66×20 windows=2',
    ),
    false,
    "聚焦窗是辅助 AXDialog = 确定不是主窗（多窗口反例），仍是 false 而不是 unknown",
  );
  assert.equal(
    parseKeyWindowState('focusedWindow=unknown reason=没有 AXStandardWindow 主窗 windows=1'),
    null,
    "选不出主窗 = unknown（环境项），不得归一成 false 冒充「确定不是主窗」",
  );
});

// ---- AX 探针的主窗选择（M762）-------------------------------------------------------------------
//
// M761 的 224 两轮 INVALID 都由同一条假设引起：`ax-key-window.swift` 把 `AXWindows[0]` 当主窗。
// 屏幕上多出 112 那族辅助 `AXDialog "Window"` 之后这个索引假设会反过来——焦点本来就在主窗也
// 读成 false（整场 INVALID），而 `ax-window.swift` 的写尺寸通道同族（triage §3.4 的 -25200 族）。
// 判据改按 `AXSubrole == AXStandardWindow` 选主窗；两扇 swift 通道共用**同一段**选窗代码。

const AX_SWIFT_FILES = ["ax-key-window.swift", "ax-window.swift"];

test("主窗选择（M762）：两支 AX 探针共用同一段选窗代码——块逐字相同，防「改一处」漂移", () => {
  const block = (file) => {
    const src = fs.readFileSync(path.join(repoRoot(), "scripts/acceptance/lib", file), "utf8");
    const m = /\/\/ >>> 主窗选择[\s\S]*?\/\/ <<< 主窗选择/.exec(src);
    assert.ok(m, `${file} 里没有主窗选择块（标记 '// >>> 主窗选择' … '// <<< 主窗选择'）`);
    return m[0];
  };
  const [a, b] = AX_SWIFT_FILES.map(block);
  assert.equal(a, b, `${AX_SWIFT_FILES.join(" / ")} 的选窗块必须逐字相同（REVIEW.md「同一语义两处真源」条）`);
  // 反向对照：块里必须真的按 subrole 选窗，而不是又退回索引假设——删掉判据就让这里红。
  assert.match(a, /AXStandardWindow/, "选窗块必须按 AXSubrole == AXStandardWindow 判主窗");
  assert.doesNotMatch(a, /windows\[0\]/, "选窗块里不得再出现 AXWindows[0] 的索引假设");
});

test("主窗选择（M762）：swift 自测覆盖多窗口反例——辅助 AXDialog 排在前 / 抢焦点 / 无标准窗", (t) => {
  const swift = "/usr/bin/swift";
  if (!fs.existsSync(swift)) {
    t.skip("没有 /usr/bin/swift（非 macOS 环境）——真机通道不进 CI，本用例只在开发机跑");
    return;
  }
  // 逐例输出 `SELFTEST PASS|FAIL <名字>：<读数>`；有 FAIL 即非零退出（同时断言退出码与逐例行）。
  const out = execFileSync(swift, [path.join(repoRoot(), "scripts/acceptance/lib/ax-key-window.swift"), "--self-test"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const lines = out.split("\n").filter((l) => l.startsWith("SELFTEST "));
  const fails = lines.filter((l) => l.startsWith("SELFTEST FAIL"));
  assert.deepEqual(fails, [], `选窗自测有失败用例：\n${out}`);
  // 四个必须出现的反例（名字即判据，缺一就是覆盖被删了）：
  for (const name of ["aux-dialog-first-main-focused", "aux-dialog-focused", "no-standard-window", "two-standards-no-main"]) {
    assert.ok(
      lines.some((l) => l.startsWith(`SELFTEST PASS ${name}`)),
      `缺少反例 ${name}（多窗口选窗的区分度就靠它）：\n${out}`,
    );
  }
});

test("动作失败即停止后续步骤，teardown 仍执行", async () => {
  const root = tmpRoot("action-fail-fast");
  useTmpEnv(root);
  const { status, records } = await drive(root, {
    steps: [
      { name: "坏动作", do: "waitFor", waitFor: { has: [], not: [] } },
      { name: "不应执行", do: "vaultWrite", file: "should-not-exist.md", content: "不可落盘\n" },
    ],
    teardown: [{ label: "收尾仍执行", file: { path: "missing-teardown.md", exists: false } }],
  });
  assert.equal(status, "FAIL");
  assert.equal(fs.existsSync(path.join(process.env.LUMIR_ACCEPTANCE_VAULT, "should-not-exist.md")), false);
  const labels = records.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.label}`);
  assert.ok(labels.some((label) => label === "FAIL [动作] 坏动作"), JSON.stringify(labels));
  assert.ok(labels.includes("PASS 收尾仍执行"), JSON.stringify(labels));
});

test("全库场景静态校验通过（--check 的真实通道）", () => {
  const out = execFileSync(process.execPath, [path.join(repoRoot(), "scripts/acceptance/run.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.match(out, /场景静态校验通过（\d+ 个）/, `--check 应全过，实际末尾：${out.slice(-300)}`);
});

// ---- `do: settle` 的无编辑器门版本（settleEditorless，M759）--------------------------------------
//
// `settle()` 的同类正反用例在 drive.test.mjs；这里守的是**另一条实现路径**：没有 AXTextArea 的
// 两类合法终态（未打开空态 / 空 vault 引导层）走 settleEditorless，它原先同样比整份 AX 原文，
// 会被每次读取都变的 `AX snapshot_id` 拖满 15s。修法是共用 drive.mjs 的 `snapshotBody`（单一
// 真源），用例必须证明两条路径都改了——只改 settle() 时这里必红。

/** 无编辑器节点的快照（两类合法终态的形态：窗口 + 树 / 空态文案，没有 AXTextArea）。 */
function editorlessAx({ snapshotId, nodeLine = '- [5] AXStaticText = "打开一个目录作为 vault"' }) {
  return [
    `AX snapshot_id=${snapshotId}. Pass this ID with index-based actions; it is separate from the screenshot_id and diff revision.`,
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- element_count: 2",
    "- truncated: false",
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 1200×800',
    "    - [2] AXScrollArea @0,0 1200×800",
    nodeLine,
    "```",
  ].join("\n");
}

/** 循环返回文本的假 cu（读到底再从头开始——保证 id 每次读都换，旧口径的整份比较永远不成立）。 */
function fakeStateCu(texts) {
  let i = 0;
  const reads = [];
  return {
    reads,
    state: async () => {
      reads.push(i);
      const text = texts[i % texts.length];
      i += 1;
      return { text, image: null };
    },
  };
}

test("settleEditorless：正文相同、快照 id 每次变 ⇒ 稳定返回且不落 note（M759 正例）", async () => {
  const cu = fakeStateCu([editorlessAx({ snapshotId: "AAAA" }), editorlessAx({ snapshotId: "BBBB" })]);
  const notes = [];
  const ax = await settleEditorless(cu, 0, { record: (r) => notes.push(r) });
  assert.equal(cu.reads.length, 2, `正文相同时应在第二次读取就返回，实际读了 ${cu.reads.length} 次`);
  assert.equal(notes.length, 0, `稳定收敛不得落 note，实际：${JSON.stringify(notes)}`);
  assert.match(ax.text, /AX snapshot_id=BBBB/, "返回的仍是原始快照（证据 dump 看原文）");
  assert.equal(ax.textarea, null, "本用例构造的是无编辑器终态：判据确实走的是 settleEditorless");
});

test("settleEditorless：正文抖动 ⇒ 超时落 note 并返回末次读取（反例，不静默判稳）", async () => {
  const cu = fakeStateCu([
    editorlessAx({ snapshotId: "AAAA", nodeLine: '- [5] AXStaticText = "打开一个目录作为 vault"' }),
    editorlessAx({ snapshotId: "BBBB", nodeLine: '- [5] AXStaticText = "这个 vault 还没有打开的文件"' }),
  ]);
  const notes = [];
  const ax = await settleEditorless(cu, 0, { record: (r) => notes.push(r) }, { timeoutMs: 600 });
  assert.equal(notes.length, 1, `超时只落一条 note，实际：${JSON.stringify(notes)}`);
  assert.match(notes[0].text, /do: settle：界面（本步无编辑器节点）/, "note 应按 settle 动作的既有前缀落证据");
  assert.match(notes[0].text, /没有连续两次一致的 AX 快照正文/, "note 应说清比较的是快照正文");
  assert.match(notes[0].text, /600ms/, "note 的时长应取本次超时（自测放开的 timeoutMs），不写死 15s");
  assert.match(ax.text, /AX snapshot_id=BBBB/, "超时兜底返回的是末次读取");
  assert.ok(cu.reads.length >= 2, `要读到两次才可能发现不一致，实际读了 ${cu.reads.length} 次`);
});

test("do: settle（动作级）：无编辑器终态 + 快照 id 每次变 ⇒ PASS 且证据里没有 settle 超时 note", async () => {
  // 接线验证：settleAction 先探一次 AX，没有 AXTextArea 就交 settleEditorless。场景侧看不出用的是
  // 哪条实现，因此用「证据里没有 `do: settle：` 开头的那条 note」+ PASS 判它真的复用了新口径。
  const root = tmpRoot("settle-editorless-action");
  useTmpEnv(root);
  const cu = fakeStateCu([editorlessAx({ snapshotId: "AAAA" }), editorlessAx({ snapshotId: "BBBB" })]);
  const ctx = stubCtx(root, { cu });
  const { status } = await runScenario(ctx, {
    id: "settle-editorless",
    item: 0,
    title: "无编辑器终态的 settle",
    file: path.join(root, "settle-editorless.md"),
    steps: [{ name: "等界面稳定", do: "settle" }],
  });
  assert.equal(status, "PASS", `settle 不应把稳定等待升级成 FAIL，实际：${JSON.stringify(ctx.evidence.records)}`);
  const notes = ctx.evidence.records.filter((r) => r.kind === "note").map((r) => r.text);
  assert.equal(
    notes.filter((t) => t.startsWith("do: settle：")).length,
    0,
    `稳定收敛时不得落 settle 超时 note：${JSON.stringify(notes)}`,
  );
  assert.ok(cu.reads.length >= 3, `probe 一次 + 比较两次，实际读了 ${cu.reads.length} 次`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 快照 header 的解析 / 坐标口径 / 多窗口钉主窗（M761；2026-10-27 core 批 53/64/159/224/233 与 112）
//
// 上游 KimiCU 0.6.8（2026-10-27 08:54 装、16:44 服务重启）改了两处 header：
//   ① mode=full 的窗口矩形从 `window_bounds:` 改名为 `captured_bounds:`（含义不变，仍是屏幕点）；
//   ② mode=ax 的窗口局部说明从 `screenshot:` 行尾（小写）搬到独立的 `coords:` 行，且全大写
//      `… are WINDOW-LOCAL POINTS …`。
// 套件两处解析停在老形态，于是把**正确的快照**判成「退化 / 口径不对」——5 个场景红而套件自身全绿
// （当时本文件的 fixture 也还是老 header，所以一条都没拦住）。112 是另一种形态：KimiCU 把树作用在
// 一扇 66×20 的辅助 `AXDialog` 上，主窗整棵被截掉。
//
// 这一节钉住四类不变量：
//   ① 窗口矩形两种键名都认，且只认 header 段（正文里的同形行不算）；
//   ② 口径按 `coords:` 行的语义判（大小写不敏感、两种口径互斥、缺该行即不可判定）；
//   ③ 几何换算与滚轮兜底的「读不到」必须是**响的**（不许静默返回 null 后跳过）；
//   ④ 多窗口时钉 `AXStandardWindow` 主窗并转发 `window_id`；主窗不可判定 = 环境错误。
// 下面两份 header 逐字取自当天的真机 dump（`2026-10-27/m747-split/...` 与 `2026-10-27-core-tier/...`），
// 只换掉了 pid / snapshot id，窗口尺寸与措辞未动。

const snapshotIdLine = (id) =>
  `AX snapshot_id=${id}. Pass this ID with index-based actions; it is separate from the screenshot_id and diff revision.`;

/** mode=ax 的窗口局部口径说明（当天 dump 的原文，一整行）。 */
const COORDS_WINDOW_LOCAL =
  "- coords: bbox `@x,y w×h` are WINDOW-LOCAL POINTS (origin = window top-left, 1:1 points — NOT screenshot pixels; they run LARGER than screenshot pixels by ~window_w/screenshot_w). Do NOT feed these to click/scroll/drag x,y — those still resolve as screenshot pixels against the most recent image observation's anchor (error if none). Use index-based actions, or re-observe with a screenshot (mode:\"full\"/\"image\") to get pixel coordinates";

/** `- windows: N` 目录 + 两条条目（112 的逐字形态）。 */
const WINDOW_DIR_DIALOG_PRIMARY = [
  "- windows: 2 (tree scoped to primary; others via window_id)",
  '  - [primary] window_id=11687 AXDialog "Window" @14,46 66×20',
  '  - [main] window_id=11677 AXStandardWindow "Lumir" @8,40 1200×800',
];

/** mode=full 的 header（0.6.8 起）：`captured_bounds:` + `screenshot: 2048×1365 px` + 截图像素口径。 */
function headerFull({ windowTitle = "Lumir" } = {}) {
  return [
    snapshotIdLine("00000000-0000-0000-0000-000000000000"),
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 2806",
    `- window_title: ${windowTitle}`,
    "- element_count: 197",
    "- is_electron: false",
    "- truncated: true [closed_menu]",
    "- captured_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "- screenshot: 2048×1365 px",
    "- coords: bbox `@x,y w×h` and click/scroll/drag x,y are screenshot pixels (origin = top-left of the screenshot)",
  ].join("\n");
}

/** mode=ax 的 header（0.6.8 起）：窗口矩形键名仍是 `window_bounds:`，口径在独立的 `coords:` 行。 */
function headerAx({ windowTitle = "Lumir", elementCount = 205 } = {}) {
  return [
    snapshotIdLine("11111111-1111-1111-1111-111111111111"),
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 68391",
    `- window_title: ${windowTitle}`,
    `- element_count: ${elementCount}`,
    "- is_electron: false",
    "- truncated: true [closed_menu]",
    "- window_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "- screenshot: none — no image attached",
    COORDS_WINDOW_LOCAL,
  ].join("\n");
}

/** 主窗的树（mode=ax：bbox 是窗口局部点）。 */
const TREE_AX_MAIN = [
  "```text",
  '- [0] AXApplication "Lumir"',
  '  - [1] AXWindow "Lumir" @0,0 1200×800 actions=[AXRaise]',
  "    - [4] AXScrollArea @0,0 1200×800",
  '      - [5] AXWebArea (Lumir) URL: http://127.0.0.1:1430/',
  '        - [9] AXButton (notes) @300,600 120×24 actions=[AXPress]',
  '      - [166] AXTextArea = "# 文档正文" @220,300 900×600 actions=[AXPress]',
  "```",
].join("\n");

/** 112 那扇 66×20 的辅助窗口（只有一个窗口共享会话按钮）。 */
const TREE_AX_DIALOG = [
  "```text",
  '- [0] AXApplication "Lumir"',
  '  - [1] AXWindow "Window" @0,0 66×20 actions=[AXRaise]',
  "    - [2] AXButton (WindowSharingSessionButton) @-1,-1 68×22 actions=[AXPress]",
  "```",
].join("\n");

const AX_MAIN_DUMP = `${headerAx()}\n\n${TREE_AX_MAIN}`;
const FULL_DUMP = `${headerFull()}\n\n${TREE_AX_MAIN}`;
const AX_DIALOG_DUMP = `${[headerAx({ windowTitle: "Window", elementCount: 18 }), ...WINDOW_DIR_DIALOG_PRIMARY].join("\n")}\n\n${TREE_AX_DIALOG}`;

/** 同一份**物理现场**、只换截图密度的 mode=full dump（M762）：文本框（基准 `@220,300 900×600`）
 *  与窗口矩形（1200×800pt）不动，截图像素按比例缩放（bbox 取整——真实 dump 就是整数，而解析器
 *  也只认整数几何）。返回 `{ text, bbox }`：`bbox` 是该密度下文本框的截图像素框，供用例算期望落点。
 *  用途见 `clickEditor 的非 real 通道` 那条用例：它跑的是动作路径，不吃 `contentClickGeometry`
 *  的单元输入，因此要一份完整的 dump。 */
function clickEditorDump({ shot }) {
  const kx = shot.w / 2048;
  const ky = shot.h / 1365;
  const bbox = { x: Math.round(220 * kx), y: Math.round(300 * ky), w: Math.round(900 * kx), h: Math.round(600 * ky) };
  return {
    text: FULL_DUMP.replace("- screenshot: 2048×1365 px", `- screenshot: ${shot.w}×${shot.h} px`).replace(
      "@220,300 900×600",
      `@${bbox.x},${bbox.y} ${bbox.w}×${bbox.h}`,
    ),
    bbox,
  };
}

test("窗口矩形（M761）：captured_bounds（mode=full）与 window_bounds（mode=ax）都认，正文里的同形行不算", () => {
  const want = { x: 8, y: 40, w: 1200, h: 800 };
  assert.deepEqual(
    windowBounds(FULL_DUMP),
    want,
    "mode=full 的 captured_bounds 解析不出来——0.6.8 起就是这个名字（64/224/233 的根因）",
  );
  assert.deepEqual(windowBounds(AX_MAIN_DUMP), want, "mode=ax 的 window_bounds 仍要认（drag / doubleClick / hover 都靠它）");
  // 反例：删掉 header 那行、在正文（``` 围栏之内）放一行逐字同形的文本——它不得被当成窗口矩形，
  // 否则换算比例会跟着文档内容漂（这正是「只认 header 段」的那条判据）。
  const moveIntoBody = (dump, key) =>
    dump
      .replace(new RegExp(`^- ${key}:.*$`, "m"), "")
      .replace("```text\n", "```text\n- " + key + ": x=1 y=2 w=30 h=40 (screen points)\n");
  assert.equal(windowBounds(moveIntoBody(AX_MAIN_DUMP, "window_bounds")), null, "正文里的 `- window_bounds:` 不是 header");
  assert.equal(windowBounds(moveIntoBody(FULL_DUMP, "captured_bounds")), null, "正文里的 `- captured_bounds:` 不是 header");
});

test("坐标口径（M761）：按 coords: 行的语义判，大小写不敏感、两种口径互斥、缺行即不可判定", () => {
  assert.equal(
    coordsSpace(AX_MAIN_DUMP),
    "window-local",
    "mode=ax 的 coords: 行写的是全大写 WINDOW-LOCAL POINTS——判不出来就是把合格的 ax 快照拒成「口径不是它」（53/159 的现场）",
  );
  assert.equal(coordsSpace(FULL_DUMP), "screenshot-pixels", "mode=full 的 coords: 行自述截图像素");
  assert.equal(
    coordsSpace(AX_MAIN_DUMP),
    "window-local",
    "ax 那行里同时出现 `NOT screenshot pixels` 与 `those still resolve as screenshot pixels`，仍必须判成 window-local",
  );
  assert.equal(
    coordsSpace(AX_MAIN_DUMP.replace("WINDOW-LOCAL POINTS", "window-local points")),
    "window-local",
    "大小写不敏感：上游改成小写时判据不该翻面",
  );
  // 反向：只有「提到 window-local」而不是「are <口径>」的句子判不出来——判据不是子串匹配。
  assert.equal(
    coordsSpace(AX_MAIN_DUMP.replace(/are WINDOW-LOCAL POINTS/, "are 1:1 pixels; see window-local docs")),
    null,
    "不是 `are <口径>` 的措辞一律判不可判定（别把子串命中当口径）",
  );
  assert.equal(
    coordsSpace(AX_MAIN_DUMP.replace(/^- coords:.*$/m, "")),
    null,
    "没有 coords: 行 = 口径不可判定：返回 null 让调用方如实报错，不默认成任一种口径",
  );
});

test("窗口局部口径的读数（M761）：新 header 直接放行；截图像素口径与退化快照都如实报错", async () => {
  const cuReturning = (text) => ({ state: async () => ({ text, image: null }) });
  const ok = await readAxForScreenPoint(cuReturning(AX_MAIN_DUMP), 1, { retries: 1, label: "drag" });
  assert.equal(ok.text, AX_MAIN_DUMP, "新 header 的 ax 快照必须直接放行（53/159 的现场是把它拒成「口径不是它」）");

  await assert.rejects(
    readAxForScreenPoint(cuReturning(FULL_DUMP), 1, { retries: 1, label: "drag" }),
    (e) => /坐标口径/.test(e.message) && /screenshot-pixels/.test(e.message),
    "截图像素口径必须拒——两个坐标空间混用会让注入落到别处",
  );

  const degraded = "# Lumir App State\n\n- app: Lumir\n- pid: 1\n- element_count: 1\n";
  await assert.rejects(
    readAxForScreenPoint(cuReturning(degraded), 1, { retries: 1, label: "drag" }),
    (e) => /退化/.test(e.message),
    "退化快照（只剩菜单栏、没有窗口矩形）按退化报错，不拿菜单栏坐标去点",
  );
});

test("正文单击落点（M761 新 header / M762 点口径）：captured_bounds + 2048×1365 的换算用手算值钉住", () => {
  const bounds = windowBounds(FULL_DUMP);
  const shot = screenshotSize(FULL_DUMP);
  assert.deepEqual(shot, { w: 2048, h: 1365 }, "0.6.8 起截图长边是 2048（写死 1152 会让换算比例算错）");
  const g = contentClickGeometry({ textarea: { bbox: { x: 220, y: 300, w: 1500, h: 900 } }, bounds, shot });
  // 缺省落点 = 编辑器左缘（点）+ (40,6)pt。手算：220 ÷ 1.70667 = 128.906 → +8+40 = 176.906；
  // 300 ÷ 1.70625 = 175.824 → +40+6 = 221.824。
  assert.equal(g.point.x, 8 + 220 * (1200 / 2048) + 40, `x 换算错：${g.point.x}`);
  assert.equal(g.point.y, 40 + 300 * (800 / 1365) + 6, `y 换算错：${g.point.y}`);
  // 证据行的截图像素：bbox + 40pt×1.70667（往返换算带浮点零头，按 1e-9 比）。
  assert.ok(Math.abs(g.shotPoint.x - (220 + 40 * (2048 / 1200))) < 1e-9, `证据行 x 错：${g.shotPoint.x}`);
  assert.ok(Math.abs(g.shotPoint.y - (300 + 6 * (1365 / 800))) < 1e-9, `证据行 y 错：${g.shotPoint.y}`);
});

test("滚轮兜底（M761）：新 header 算得出落点；读不到几何 / 落点时给原因而不是 null（不静默跳过兜底）", () => {
  const node = { bbox: { x: 400, y: 500, w: 200, h: 100 } };
  const plan = planWheelFallback({ text: FULL_DUMP, node, dy: -5 });
  assert.equal(plan.dy, -5);
  assert.equal(plan.dx, 0);
  // 手算：节点中心 (500,550) 截图像素 → 500 × 1200/2048 + 8 = 300.96875；550 × 800/1365 + 40 ≈ 362.3443。
  assert.equal(plan.point.x, 300.96875, `x 换算错：${plan.point.x}`);
  assert.equal(plan.point.y, 362.34432234432234, `y 换算错：${plan.point.y}`);

  const byTarget = planWheelFallback({ text: FULL_DUMP, target: { x: 10, y: 20 }, dy: 3 });
  assert.equal(byTarget.point.x, 13.859375, "target 的 {x,y} 是截图像素（与 KimiCU 的 scroll 同空间）");
  assert.equal(byTarget.point.y, 51.72161172161172, `y 换算错：${byTarget.point.y}`);

  const noGeom = planWheelFallback({ text: FULL_DUMP.replace(/^- captured_bounds:.*$/m, ""), node, dy: -5 });
  assert.equal(noGeom.point, undefined, "几何读不到时不得给出落点");
  assert.match(
    noGeom.reason,
    /读不到窗口几何/,
    "必须说明「读不到几何」——静默返回 null 会让兜底消失，而证据里看不出它压根没跑",
  );

  assert.match(planWheelFallback({ text: FULL_DUMP, node, page: 1 }).reason, /page/, "page 形态不换算行数");
  assert.match(planWheelFallback({ text: FULL_DUMP, node }).reason, /dy \/ dx/, "没给位移量要说清");
  assert.match(
    planWheelFallback({ text: FULL_DUMP, target: {}, node: null, dy: 1 }).reason,
    /落点不可定位/,
    "既没有 {x,y} 也没有 bbox 时要说清落点不可定位",
  );
});

test("多窗口（M761，112 的现场）：readAx 钉 AXStandardWindow 主窗并转发 window_id，辅助 AXDialog 不得截断主树", async () => {
  assert.deepEqual(mainWindowPlan(AX_MAIN_DUMP), { pin: null }, "没有 windows 目录 = 单窗，不需要钉");
  assert.equal(
    mainWindowPlan(AX_DIALOG_DUMP).pin?.windowId,
    11677,
    "多窗口时选的是 [main] 的 AXStandardWindow（11677），不是 primary 的 AXDialog（11687）",
  );

  const calls = [];
  const cu = {
    state: async (pid, { mode, windowId } = {}) => {
      calls.push({ pid, mode, windowId });
      return { text: windowId === undefined ? AX_DIALOG_DUMP : AX_MAIN_DUMP, image: null };
    },
  };
  const ax = await readAx(cu, 7, { mode: "ax" });
  assert.deepEqual(
    calls,
    [
      { pid: 7, mode: "ax", windowId: undefined },
      { pid: 7, mode: "ax", windowId: 11677 },
    ],
    "第二次读取必须带 [main] 的 window_id（11677），且 mode 一并保留",
  );
  assert.equal(ax.text, AX_MAIN_DUMP, "返回的必须是主窗的树，不是辅助窗口那份");
  assert.ok(
    ax.nodes.some((n) => n.role === "AXButton" && n.label === "notes"),
    "主窗的按钮行必须读得到（112 判红的就是它不在树里）",
  );
  assert.ok(ax.textarea, "主窗的编辑器节点也要在（辅助窗口的树里没有 AXTextArea）");
});

test("多窗口反例（M761）：主窗不可判定 / window_id 没生效 / 标题对不上，一律报环境错误而不是返回辅助窗的树", async () => {
  const infra = (pattern) => (e) => e instanceof InfraError && pattern.test(e.message);

  // ① 多窗口目录里没有 AXStandardWindow（主窗整棵不在 KimiCU 的窗口表里）⇒ 环境错误，不退回 primary。
  const noStandard = [
    headerAx({ windowTitle: "Window", elementCount: 18 }),
    "- windows: 2 (tree scoped to primary; others via window_id)",
    '  - [primary] window_id=11687 AXDialog "Window" @14,46 66×20',
    '  - [main] window_id=11690 AXDialog "HUD" @100,100 200×80',
    "",
    TREE_AX_DIALOG,
  ].join("\n");
  assert.match(mainWindowPlan(noStandard).error, /没有 AXStandardWindow/, "纯辅助窗的窗口表判「主窗不可判定」");
  let reads = 0;
  await assert.rejects(
    readAx(
      {
        state: async () => {
          reads += 1;
          return { text: noStandard, image: null };
        },
      },
      7,
      { mode: "ax" },
    ),
    infra(/无法判定主窗口/),
    "多窗口但没有 AXStandardWindow ⇒ InfraError（不把辅助窗的 18 个节点当成界面）",
  );
  assert.equal(reads, 1, "不可判定时不得再发一次读数（也没有可用的 window_id）");

  // ② KimiCU 忽略了 window_id：重读后 `[primary]` 仍是那扇辅助窗（把标题改成 Lumir，隔离出这一条判据）。
  const ignored = AX_DIALOG_DUMP.replace("- window_title: Window", "- window_title: Lumir");
  await assert.rejects(
    readAx(
      {
        state: async (pid, { windowId } = {}) => ({ text: windowId === undefined ? AX_DIALOG_DUMP : ignored, image: null }),
      },
      7,
      { mode: "ax" },
    ),
    infra(/仍作用在窗口 11687/),
    "重读后树仍作用在别的窗口 ⇒ InfraError（读到的主窗树不可信）",
  );

  // ③ 钉窗生效但读到的不是那扇窗（window_title 与 windows 目录里的标题不符）。
  await assert.rejects(
    readAx(
      {
        state: async (pid, { windowId } = {}) => ({
          text: windowId === undefined ? AX_DIALOG_DUMP : AX_MAIN_DUMP.replace("- window_title: Lumir", "- window_title: Agent"),
          image: null,
        }),
      },
      7,
      { mode: "ax" },
    ),
    infra(/window_title/),
    "钉窗后标题对不上 ⇒ InfraError（钉窗未生效 / 两次读取之间换了窗）",
  );

  // ④ 树已经作用在主窗上（primary 就是那扇标准窗）⇒ 不多读一次。
  const alreadyMain = [
    headerAx({ windowTitle: "Lumir", elementCount: 205 }),
    "- windows: 2 (tree scoped to primary; others via window_id)",
    '  - [primary] window_id=11677 AXStandardWindow "Lumir" @8,40 1200×800',
    '  - [main] window_id=11687 AXDialog "Window" @14,46 66×20',
    "",
    TREE_AX_MAIN,
  ].join("\n");
  let alreadyReads = 0;
  const already = await readAx(
    {
      state: async () => {
        alreadyReads += 1;
        return { text: alreadyMain, image: null };
      },
    },
    7,
    { mode: "ax" },
  );
  assert.equal(alreadyReads, 1, "树已作用在主窗上时不得多读一次（多一次往返就是多一份 flake 面）");
  assert.equal(already.text, alreadyMain);

  // ⑤ 单窗（没有 windows 目录）⇒ 一次读取，不转发 window_id。
  const singleCalls = [];
  await readAx(
    {
      state: async (pid, args = {}) => {
        singleCalls.push(args);
        return { text: AX_MAIN_DUMP, image: null };
      },
    },
    7,
    { mode: "full" },
  );
  assert.deepEqual(singleCalls, [{ mode: "full" }], "单窗不该转发 window_id");
});

// ─────────────────────────────────────────────────────────────────────────────
// AX 多行 UI 文本的转义还原（M763）
//
// 上游 KimiCU 0.6.8 起换了 dump 的渲染口径：**一份 dump 仍是「一行一个元素」**，UI 文本里的
// 换行被写成两个字符 `\` + `n`。规则出自工具自身的说明（`get_app_state` 的 description，
// 逐字：`AX text is one element per line; a line break inside UI text is shown as the two
// characters \n.`），不是我们从样本上猜的。
//
// 现场（M762 的 117，证据 `.local/acceptance/2026-10-28-m762-calibration/`）：composer 的 value
// 从「真实换行、续行展开」变成 `"hnl-brk-aa\nhnl-brk-cd"`——同一份像素证据全绿、产品正常，
// 只有跨行 AX 判据判红（`ax: { has: '/…[\r\n]+…/' }` 在字面 `\n` 上命中 0 次）。
//
// **只解 `\n` 这一条**，理由是三份一手读数：
//   ① tab 没被转义（0.6.8 的 `title\t纯文本基线` 里 `\t` 是真 tab，与 0.6.8 之前的 dump 一致）；
//   ② 反斜杠与引号没被转义（0.6.8 之前的同类文本里它们原样出现，渲染层也没有反斜杠转义层的痕迹）；
//   ③ 上游说明只提换行。
// 于是这里绝不能顺手把 `\t` / `\"` / `\\` 也解掉：`\textbf{}`、`\times`、`\int_0^1` 这些 LaTeX
// 正文会因此被吃掉反斜杠（下面有必红反例）。编码本身**有损**——正文真的写着两个字符 `\n` 时
// 与换行不可区分，这是上游的损失，套件不猜（用测试把当前行为钉住，避免下一个人拿启发式「修」）。

/** 一份 0.6.8 形态的 dump：真实 header（`captured_bounds` + `coords: …screenshot pixels`）+ 节点行。 */
function m763Dump(nodeLines) {
  return [
    headerFull(),
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 2048×1365',
    ...nodeLines,
    "```",
  ].join("\n");
}

/** 逐字取自 `2026-10-28-m762-calibration/117-harness-composer-soft-break/ax/02-*.txt:115`。 */
const M763_COMPOSER_LINE =
  '            - [189] AXTextArea = "hnl-brk-aa\\nhnl-brk-cd" @1242,1170 790×82 actions=[AXPress] (focused)';

/** 逐字取自 `2026-10-28-m761-header-geometry/233-semantic-selection-release-snap/ax/02-*.txt:105`。 */
const M763_EDITOR_LINE =
  '- [170] AXTextArea = "语义选中验收\\n\\n**粗体词** 是本行的加粗短语，供双击摘录用。\\n\\n末尾段落：真机判据只走双击通道。" @577,258 1297×1065 actions=[AXPress] (focused)';

/** 逐字取自 `2026-10-27-m755/230c-restart-and-focus-scopes/ax/04-*.txt:111`（mermaid 源码作 help）。 */
const M763_HELP_LINE = '- [176] AXGroup actions=[AXPress] help="```mermaid\\ngraph TD;\\n  Start-->Stop;\\n```"';

test("AX 转义还原（M763）：0.6.8 的单行 + 字面 \\n 还原成真换行，结构字段一字不动", () => {
  const nodes = parseNodes(m763Dump([M763_COMPOSER_LINE]));
  const composer = nodes.find((n) => n.role === "AXTextArea");
  assert.ok(composer, "composer 节点应在树里");
  assert.equal(
    composer.value,
    "hnl-brk-aa\nhnl-brk-cd",
    "composer 的 value 必须是**真换行**——不还原时这里是字面 `\\n`，117 的跨行判据在它上面命中 0 次",
  );
  assert.equal(composer.title, composer.value, "title 与 value 同源（`= \"…\"` 形态），一并还原");
  // 结构字段必须仍从**未还原**的原文里取：还原若发生在抽取之前，bbox / actions 会被换行拆走。
  assert.deepEqual(composer.bbox, { x: 1242, y: 1170, w: 790, h: 82 });
  assert.deepEqual(composer.actions, ["AXPress"]);
  assert.equal(composer.focused, true, "`(focused)` 标记在行尾，不受还原影响");
  assert.match(composer.raw, /hnl-brk-aa\\nhnl-brk-cd/, "raw 保留原文（证据 dump 看的是原文，不做二次改写）");
  // 真实 header 照旧可读（还原不能漏到 header 段去）。
  assert.deepEqual(windowBounds(m763Dump([M763_COMPOSER_LINE])), { x: 8, y: 40, w: 1200, h: 800 });

  // 区分度（REVIEW.md「断言等价于子串」条）：按名字找节点时，跨行形态命中、同行拼接形态不命中。
  assert.ok(
    findNode(nodes, { role: "AXTextArea", name: "hnl-brk-aa\nhnl-brk-cd" }),
    "还原之后 `findNode` 的跨行正则应命中（117 同步后的判据形态就是它）",
  );
  assert.equal(
    findNode(nodes, { role: "AXTextArea", name: "hnl-brk-aahnl-brk-cd" }),
    null,
    "同一份树里「无换行的拼接形态」不得命中——否则跨行判据等价于子串匹配",
  );
});

test("AX 转义还原（M763）：编辑器 value 的空行（\\n\\n）还原成两行，`nodeName` 读到的是真文本", () => {
  const nodes = parseNodes(m763Dump([M763_EDITOR_LINE]));
  const editor = nodes.find((n) => n.role === "AXTextArea");
  const want = "语义选中验收\n\n**粗体词** 是本行的加粗短语，供双击摘录用。\n\n末尾段落：真机判据只走双击通道。";
  assert.equal(editor.value, want, "空行（连续两个 `\\n`）必须还原成两个真换行——`editor.has` 的跨段判据靠它");
  assert.equal(nodeName(editor), want, "nodeName 走 title/value，同样应是还原后的文本");
  // 反向：拿缺陷形态（同行拼接、没有换行痕迹）去匹配必须落空——判据对「有没有换行」有区分度。
  assert.equal(
    findNode(nodes, { role: "AXTextArea", name: "语义选中验收\\*\\*粗体词" }),
    null,
    "同行拼接的形态不得命中（否则跨行断言就是恒真）",
  );
});

test("AX 转义还原（M763）：help / label 里的多行 UI 文本同样还原（mermaid 与快捷键面板的真实 dump）", () => {
  // help：0.6.8 把整段 mermaid 源码压成一行（真实 dump，见 M763_HELP_LINE 的出处）。
  const [helpNode] = parseNodes(m763Dump([M763_HELP_LINE])).filter((n) => n.role === "AXGroup");
  assert.equal(
    helpNode.help,
    "```mermaid\ngraph TD;\n  Start-->Stop;\n```",
    "help 是 UI 文本、走同一套编码；不还原时 `target.help` 里带换行的定位串永远匹配不上",
  );
  // label：形态取自 0.6.6 的快捷键面板（`2026-10-26-runner-efficiency/236-keybindings-capture/ax/02-捕获等待态.txt:30`
  // 里它是真实续行），0.6.8 起同样压成一行 + 字面 `\n`。
  const [labelNode] = parseNodes(m763Dump(['- [31] AXStaticText (块滚动到开头 Home\\n上移一行 ↑ ⌃P)'])).filter(
    (n) => n.role === "AXStaticText",
  );
  assert.equal(labelNode.label, "块滚动到开头 Home\n上移一行 ↑ ⌃P", "label 也要还原（括号内的可访问名同样是 UI 文本）");
});

test("AX 转义还原（M763）反例：只有 `\\n` 是转义——`\\t` / LaTeX / 引号 / 行尾反斜杠一律原样保留", () => {
  const text = (value) => parseNodes(m763Dump([`- [7] AXStaticText = "${value}"`])).find((n) => n.index === 7).value;

  // ① tab 没被上游转义（0.6.8 的 `title\t纯文本基线` 里 `\t` 是真 tab）。把 `\t` 也解掉会吃掉
  //    LaTeX 命令名：`\textbf`、`\times`、`\tan` 全变成「制表符 + 残词」。
  const latex = "公式 \\int_0^1 x^2 与 \\textbf{粗} 与 \\times 与 \\alpha";
  assert.equal(text(latex), latex, "LaTeX 正文里的每一个反斜杠都必须原样留着（`\\t` 不是制表符）");
  assert.ok(!text(latex).includes("\t"), "反例：`\\textbf` 绝不能被解成制表符 + `extbf`");

  // ② 引号没被转义（反斜杠没有转义层，`\"` 就是「反斜杠 + 引号」这两个字符本身）。
  const quoted = '他说 \\"你好\\" 然后离开';
  assert.equal(text(quoted), quoted, "`\\\"` 必须原样保留（上游没有引号转义层）");

  // ③ 行尾 / 词间的孤立反斜杠（真实文本：git diff 的 `\\ No newline at end of file`）。
  const diff = "--- a/harness-note.md +++ b/harness-note.md +HNC-SHOULD-NOT-LAND 不应落盘 \\ No newline at end of file";
  assert.equal(text(diff), diff, "孤立反斜杠（后面是空格）不得被吞");

  // ④ 负向对照：真正的 `\n` 仍然要还原——上面三条反例不得把判据整体关掉。
  assert.equal(text("甲\\n乙"), "甲\n乙", "`\\n` 是唯一的转义：这条绿说明反例没有把功能一起关掉");

  // ⑤ 已知损失（上游编码有损，钉住行为，别拿启发式「修」）：正文真的写着两个字符 `\n` 时
  //    与换行不可区分，套件按上游语义还原（不猜、也不额外吞反斜杠）。
  assert.equal(
    text("文档里写着 换行符\\n就是这么写的"),
    "文档里写着 换行符\n就是这么写的",
    "字面 `\\n` 与换行不可区分：按上游语义还原（这是上游编码的损失，不是套件能补的）",
  );
});

test("AX 转义还原（M763）：0.6.8 之前的多行续行格式仍按原口径解析（真实换行 + 真实 tab）", () => {
  // 逐字取自 `2026-10-26-runner-efficiency/60-vault-switch-restore/ax/05-05-切回A.txt:204-215`：
  // 换行是真的换行、续行展开；同一个 tab 在同一位置仍是真 tab。两类格式必须同时活。
  const old = [
    '          - [291] AXTextArea = "title\t纯文本基线',
    "plain",
    "12 lines",
    "·",
    "Edited October 26",
    "",
    "纯文本基线",
    "",
    "第一行内容。",
    "",
    "第二行内容。",
    "M283 写盘段",
    '第三行内容。" @324,40 730×704 actions=[AXPress]',
  ].join("\n");
  const [node] = parseNodes(m763Dump([old])).filter((n) => n.role === "AXTextArea");
  assert.equal(
    node.value,
    "title\t纯文本基线\nplain\n12 lines\n·\nEdited October 26\n\n纯文本基线\n\n第一行内容。\n\n第二行内容。\nM283 写盘段\n第三行内容。",
    "旧格式（真实换行续行）必须原样解析：还原逻辑不能把续行合并出来的真换行再动一次",
  );
  assert.deepEqual(node.bbox, { x: 324, y: 40, w: 730, h: 704 }, "续行合并后 bbox 仍从末行取到");
});

test("AX 转义还原（M763）：117 的新判据形态（node 走解析值）在两种 dump 形态上各自翻面", async () => {
  // 117 的两条正向断言从 `ax.has`（匹配**原文**，因此绑死上游的换行表示法）改成 `node`
  // （匹配 `parseNodes` 的 value）。这条用例证明改判据之后仍然**有区分度**：
  //   0.6.8 的单行 + 字面 `\n`  ⇒ 还原成真换行 ⇒ present:true 绿、present:false 红；
  //   缺陷形态（同行拼接、根本没有换行）⇒ 两条翻面。
  const schemaAssert = (present) => ({
    steps: [
      {
        name: "composer 两段之间是否有换行",
        expect: [{ label: `跨行断言（present=${present}）`, node: { role: "AXTextArea", name: "hnl-brk-aa\nhnl-brk-cd", present } }],
      },
    ],
  });
  const cuFor = (line) => ({ state: async () => ({ text: m763Dump([line]), image: null }) });

  const root = tmpRoot("m763-node-assert");
  useTmpEnv(root);
  const twoLines = await drive(root, schemaAssert(true), { cu: cuFor(M763_COMPOSER_LINE) });
  assert.deepEqual(twoLines.records.map((r) => r.ok), [true], `转义形态应命中断言，实际 ${JSON.stringify(twoLines.records)}`);

  const twoLinesNegative = await drive(root, schemaAssert(false), { cu: cuFor(M763_COMPOSER_LINE) });
  assert.deepEqual(
    twoLinesNegative.records.map((r) => r.ok),
    [false],
    "同一份树里 present:false 必须红——否则这条判据对「有换行」没有区分度",
  );

  // 缺陷形态：⇧Enter 没落地，两串同行拼接（真机见过的 `hnl-brk-aahnl-brk-cd`）。
  // 搜索串在源码里写 `\\n` = 运行时「反斜杠 + n」两个字符（与 fixture 里的字面转义逐字相同）。
  const joined = M763_COMPOSER_LINE.replace("hnl-brk-aa\\nhnl-brk-cd", "hnl-brk-aahnl-brk-cd");
  assert.ok(joined.includes("hnl-brk-aahnl-brk-cd"), "fixture 自检：拼接形态确实替换成功");
  const defect = await drive(root, schemaAssert(true), { cu: cuFor(joined) });
  assert.deepEqual(
    defect.records.map((r) => r.ok),
    [false],
    "同行拼接的缺陷形态必须判红（这正是 117 要拦的那次 ⇧Enter 没落地）",
  );
  const defectNegative = await drive(root, schemaAssert(false), { cu: cuFor(joined) });
  assert.deepEqual(defectNegative.records.map((r) => r.ok), [true], "缺陷形态下 present:false 应绿");
});

// ─────────────────────────────────────────────────────────────────────────────
// cgevent chord 通道（M767）：⌃A / ⌘A / ⌃B 这类「必须由应用自己处理」的键走真键盘事件
//
// 背景（M766 探针，`.local/reports/ctrl-a-channel-oct28/README.md`）：KimiCU 0.6.8 的 press_key
// 在文本控件上把 ctrl+a / cmd+a 特判成 AX「全选」兼容路径（`used_backend: ax_select_all*`），
// **零键盘事件**——应用键位层命中不到 Ctrl-a，140 的 ⌃A 步因此变成「全选 + 覆写」。修法是换
// 注入通道，不是放宽断言。这一节钉住三件事：
//   ① 事件形态：键名 → keycode、修饰键 → CGEventFlags 的翻译（与 M766 的 tap 读数同口径）；
//   ② 错误路径：无权限 / 无回读行 / 键名不认识一律判红（InfraError），**不静默降级**回 press_key；
//   ③ 回归面：不写 channel 的 step 一个键都不走新通道（既有场景零变化）。
// 全节不 spawn swift、不投任何真实键盘事件（测试机前台可能是用户的窗口）。

test("cgevent chord 事件形态：⌃A / ⌘A / ⌃B 的 keycode+flags 与别名、多修饰键（M766 的 B1/D2 口径）", () => {
  // 真 ⌃A 在 M766 的事件流里是 `kc=0 flags=0x…40000`（0x40000 = maskControl）；keycode 0 = A 键。
  assert.deepEqual(parseChordSpec("ctrl+a"), { keycode: 0, flags: 0x00040000 }, "⌃A = keycode 0 + maskControl");
  assert.deepEqual(parseChordSpec("cmd+a"), { keycode: 0, flags: 0x00100000 }, "⌘A = keycode 0 + maskCommand");
  assert.deepEqual(parseChordSpec("ctrl+b"), { keycode: 11, flags: 0x00040000 }, "⌃B = keycode 11 + maskControl");
  // 别名与多修饰键：control/meta/option 与 ctrl/cmd/alt 等价；大小写不敏感。
  assert.deepEqual(parseChordSpec("control+a"), parseChordSpec("ctrl+a"));
  assert.deepEqual(parseChordSpec("meta+a"), parseChordSpec("cmd+a"));
  assert.deepEqual(parseChordSpec("CTRL+SHIFT+A"), { keycode: 0, flags: 0x00040000 | 0x00020000 });
  // 无修饰键也是合法规格（flags 0）——真键位事件，只是不带 modifier。
  assert.deepEqual(parseChordSpec("escape"), { keycode: 53, flags: 0 });
});

test("cgevent chord 错误路径：未知主键 / 未知修饰键 / 空段都抛 StepError，且在 spawn 之前判掉", () => {
  const bad = [
    ["ctrl+f13", /主键「f13」不在真键盘通道的键表里/],
    ["hyper+a", /未知修饰键「hyper」/],
    ["ctrl+", /缺少主键/],
    ["+a", /空的修饰键段/],
    ["", /非空字符串/],
  ];
  for (const [spec, re] of bad) {
    assert.throws(() => parseChordSpec(spec), (e) => e instanceof StepError && re.test(e.message), `「${spec}」应判 StepError`);
  }
  // 键名不合法时**一次 swift 都不该起**：否则真机上会把「按原样盲发」当成通道失败。
  let spawned = 0;
  const run = () => {
    spawned++;
    return { ok: true, stdout: "key keycode=0 flags=0x40000", error: null, status: 0 };
  };
  assert.throws(() => injectChordCGEvent("ctrl+f13", { run }), StepError);
  assert.equal(spawned, 0, "规格不合法必须在 spawn 之前判红，不能先投再报");
});

test("cgevent chord 错误路径：无权限 / 无回读行 ⇒ InfraError（环境项），不静默降级回 press_key", () => {
  // 正常形态：参数是 keycode 与 flags 两个数值，脚本是同一份 cgevent-key.swift。
  const calls = [];
  const okRun = (args) => {
    calls.push(args);
    return { ok: true, stdout: "key keycode=0 flags=0x40000", error: null, status: 0 };
  };
  assert.equal(injectChordCGEvent("ctrl+a", { run: okRun }), "key keycode=0 flags=0x40000", "回读行原样返回（证据用）");
  assert.match(calls[0][0], /\/swift$/, "通道是 /usr/bin/swift");
  assert.match(calls[0][1], /cgevent-key\.swift$/, "翻译后的数值交给 cgevent-key.swift");
  assert.deepEqual(calls[0].slice(2), ["--key", "0", "262144"], "⌃A 的 argv 形态：--key 0 262144（0x40000）");
  injectChordCGEvent("cmd+a", { run: okRun });
  assert.deepEqual(calls[1].slice(2), ["--key", "0", "1048576"], "⌘A 的 argv 形态：maskCommand = 0x100000");
  injectChordCGEvent("ctrl+b", { run: okRun });
  assert.deepEqual(calls[2].slice(2), ["--key", "11", "262144"], "⌃B 的 argv 形态：keycode 11");

  // swift 退出 3 = 没有「辅助功能」投递权限（cgevent-key.swift 的判据）。整条通道不可用是环境项。
  assert.throws(
    () =>
      injectChordCGEvent("ctrl+a", {
        run: () => ({ ok: false, stdout: "", error: "没有「辅助功能」投递权限：CGPreflightPostEventAccess=false", status: 3 }),
      }),
    (e) =>
      e instanceof InfraError &&
      /swift 退出 3/.test(e.message) &&
      /辅助功能/.test(e.message) &&
      /不会回落到 KimiCU press_key/.test(e.message),
    "无权限必须抛 InfraError 并写明「不回落」——回落会把「通道没投递」洗成产品假红 / 断言假绿",
  );
  // swift 退出 5 = chord 投递后修饰位没有复位（M767 真机：只带 flags 的合成 chord 会把事件源
  // 修饰位留在 flags 上，后续普通按键被当成 ⌃ 组合）。这也是环境 / 通道项，逐条红。
  assert.throws(
    () =>
      injectChordCGEvent("ctrl+a", {
        run: () => ({ ok: false, stdout: "", error: "chord 投递后修饰位没有复位（残留：control）", status: 5 }),
      }),
    (e) => e instanceof InfraError && /swift 退出 5/.test(e.message) && /修饰位没有复位/.test(e.message),
    "修饰位残留必须抛 InfraError，不能当成「已投递」继续跑",
  );
  // 退出 0 但没有回读行 = 通道没真的跑完（脚本换了 / 静默 no-op），不能当成「已投递」。
  assert.throws(
    () => injectChordCGEvent("ctrl+a", { run: () => ({ ok: true, stdout: "", error: null, status: 0 }) }),
    (e) => e instanceof InfraError && /没有回读行/.test(e.message),
    "无回读行必须判红（REVIEW.md「读不到当成空」条的同族形态）",
  );
});

test("cgevent chord 回归面：不写 channel 的 step 全走 KimiCU；写了 channel 只路由 chord 键", () => {
  // 既有场景的形态（140/145/154 等）——一个键都不该被新通道接走。
  const legacy = { do: "keys", keys: ["ctrl+a", "y", "ctrl+b", "cmd+a", "shift+return"] };
  for (const k of legacy.keys) assert.equal(keyChannel(legacy, k), "kimicu", `未写 channel 时「${k}」必须走 KimiCU`);
  // 140 的 ⌃A 步：⌃A 走真键盘事件，同一行紧随的普通字符仍走 KimiCU（探针 A1：普通字符没有全选兼容路径）。
  const chorded = { do: "keys", channel: "cgevent", keys: ["ctrl+a", "y"] };
  assert.equal(keyChannel(chorded, "ctrl+a"), "cgevent");
  assert.equal(keyChannel(chorded, "y"), "kimicu", "channel 只作用于 chord 键，普通字符不引入 keycode 的布局依赖");
  assert.equal(keyChannel(chorded, "escape"), "kimicu", "无 + 的键名不算 chord");
  // 未知 channel 值在运行期也抛：真机跑批不重跑 checkScenario，静默退回 KimiCU 就是 M766 的假红/假绿形态。
  assert.throws(
    () => keyChannel({ do: "keys", channel: "kimicu", keys: ["ctrl+a"] }, "ctrl+a"),
    /不静默退回 KimiCU press_key/,
    "拼错的 channel 值必须在运行期判红",
  );
  assert.equal(KEY_CHANNELS.has("cgevent"), true);
});

test("channel: cgevent 的静态校验（M767）：合法形态零问题，四类静默失效形态判红", () => {
  const errs = (steps) => checkScenario({ id: "chord-check", item: 0, steps });
  // 140 的真实形态（含同行普通字符与 gapMs）必须零问题。
  assert.deepEqual(errs([{ name: "140 的 ⌃A 步", do: "keys", channel: "cgevent", keys: ["ctrl+a", "y"], gapMs: 150 }]), []);
  // 不写 channel 的既有形态同样零问题（零变化不是靠「顺手也校验一下」实现的）。
  assert.deepEqual(errs([{ name: "旧形态", do: "keys", keys: ["ctrl+a", "y"], gapMs: 150 }]), []);
  assert.ok(
    errs([{ name: "挂错动作", do: "type", text: "x", channel: "cgevent" }]).some((p) =>
      p.includes("channel 参数只属于 do=keys / do=key"),
    ),
    "channel 挂到别的动作上必须判红（没人读它 = 静默失效）",
  );
  assert.ok(
    errs([{ name: "值拼错", do: "keys", channel: "cgevent!", keys: ["ctrl+a"] }]).some((p) => p.includes('只支持 "cgevent"')),
    "channel 值拼错必须判红",
  );
  assert.ok(
    errs([{ name: "没有 chord", do: "keys", channel: "cgevent", keys: ["y", "z"] }]).some((p) => p.includes("没有 chord")),
    "写了 channel 却没有 chord 键必须判红（通道无事可做）",
  );
  assert.ok(
    errs([{ name: "主键不认识", do: "keys", channel: "cgevent", keys: ["ctrl+f13"] }]).some((p) =>
      p.includes("主键「f13」"),
    ),
    "主键不在键表里必须在 --check 判红（与运行期 parseChordSpec 同一份翻译）",
  );
  assert.ok(
    errs([{ name: "修饰键不认识", do: "keys", channel: "cgevent", keys: ["hyper+a"] }]).some((p) =>
      p.includes("未知修饰键「hyper」"),
    ),
    "修饰键不认识必须在 --check 判红",
  );
});

test("channel: cgevent 的 `do: key` 单数形态（M768）：117 / 150 的 ⌃A 步合法，四类写错判红", () => {
  const errs = (steps) => checkScenario({ id: "single-key-channel", item: 0, steps });
  // 117 / 150 的真实形态：单数 key + channel + 可选的 verify（150 的 ⌘V 步带 verify，本步不带）。
  assert.deepEqual(errs([{ name: "117 的 ⌃A 步", do: "key", key: "ctrl+a", channel: "cgevent" }]), []);
  assert.deepEqual(errs([{ name: "150 的 ⌃A 步", do: "key", key: "ctrl+a", channel: "cgevent" }]), []);
  // 不写 channel 的既有单数步零变化。
  assert.deepEqual(errs([{ name: "旧单数形态", do: "key", key: "ctrl+a" }]), []);
  assert.deepEqual(errs([{ name: "旧单数普通键", do: "key", key: "return" }]), []);
  // ① 值拼错 ② 单数步的键不是 chord（通道无事可做，运行期会静默退回 KimiCU）③ 主键不认识。
  assert.ok(
    errs([{ name: "值拼错", do: "key", key: "ctrl+a", channel: "cgevent!" }]).some((p) => p.includes('只支持 "cgevent"')),
    "单数步的 channel 值拼错必须判红",
  );
  assert.ok(
    errs([{ name: "非 chord", do: "key", key: "return", channel: "cgevent" }]).some((p) =>
      p.includes("key「return」不是 chord"),
    ),
    "单数步写了 channel 但键不是 chord 必须判红（与 keys 的「没有 chord」同一口径）",
  );
  assert.ok(
    errs([{ name: "主键不认识", do: "key", key: "ctrl+f13", channel: "cgevent" }]).some((p) =>
      p.includes("主键「f13」"),
    ),
    "单数步的主键不在键表里必须在 --check 判红",
  );
  // 单一真源：静态校验与运行期共用 `channelSpecProblem`——同一形态两处给出同一句话。
  assert.equal(channelSpecProblem({ do: "key", key: "ctrl+a", channel: "cgevent" }), null);
  assert.match(channelSpecProblem({ do: "key", key: "return", channel: "cgevent" }), /不是 chord/);
  assert.match(channelSpecProblem({ do: "key", key: "ctrl+a", channel: "kimicu" }), /只支持 "cgevent"/);
  assert.match(channelSpecProblem({ do: "keys", channel: "cgevent", keys: ["y"] }), /没有 chord/);
});

test("`do: key` + channel 的运行期守卫（M768）：写错的形态在真机跑批里也判红，不静默退回 KimiCU", async () => {
  // 真机跑批不重跑 checkScenario：静态层挡过的形态必须在动作入口同样判红，且**先于任何注入 /
  // 抢前台**（stub ctx 里 cu 是空对象——若守卫晚一步，这里会先炸在 readAx / osascript 上，
  // 断言就测不到本该报的那句话）。
  const root = tmpRoot("single-key-channel-runtime");
  useTmpEnv(root);
  const bad = await drive(root, {
    steps: [
      { name: "单数步写了 channel 但键不是 chord", do: "key", key: "return", channel: "cgevent" },
    ],
  });
  assert.equal(bad.status, "FAIL", "非 chord 的单数步必须判 FAIL（不静默退回 KimiCU）");
  assert.match(bad.records[0].label, /单数步写了 channel 但键不是 chord/);
  assert.match(bad.records[0].detail ?? "", /不是 chord/);

  const typo = await drive(root, {
    steps: [{ name: "channel 值拼错", do: "key", key: "ctrl+a", channel: "kimicu" }],
  });
  assert.equal(typo.status, "FAIL");
  assert.match(typo.records[0].detail ?? "", /只支持 "cgevent"/);
});

// ── `$runTag`（M752）：跨运行唯一的占位符 ────────────────────────────────────
//
// 现场：场景 170 的 cron 任务 `id` **就是系统通知标题**。id 固定时，**上一次运行**留在通知
// 中心里的同标题通知会满足 `waitForNotification` 的新鲜度基线，被当成这次投递的横幅（随后
// 「等 `cron_notified` 落盘」必然超时）。三条判据：同次恒定、跨次不重复、占位符在 `config:`
// 与 `steps:` 上替换成同一个值。

test("runTag：同一次运行内恒定，且符合 cron 任务 id 的口径（非空、无空白）", () => {
  const first = runTag();
  assert.equal(runTag(), first, "同一进程内必须恒定：config: 与 steps: 靠它拿到同一个值");
  assert.equal(first.trim(), first, "不得带首尾空白");
  assert.match(first, /^[a-z0-9]+$/i, "只含字母数字（无空白 / 无 `/`）：可直接做 cron 任务的 id");
});

test("runTag：跨运行不重复（新进程拿到不同的记号）", () => {
  const moduleUrl = new URL("./execute.mjs", import.meta.url).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then((m) => process.stdout.write(m.runTag()));`;
  const other = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.match(other, /^[a-z0-9]+$/i, `新进程的记号口径应与本次一致，实际：${JSON.stringify(other)}`);
  assert.notEqual(other, runTag(), "跨运行必须不同：否则上一次运行的通知会满足新鲜度基线");
});

test("$runTag 占位符：config 的 cron 任务 id 与 steps 的字段拿到同一个值，且不残留字面量", async () => {
  const root = tmpRoot("runtag-substitute");
  const file = path.join(root, "runtag.md");
  fs.writeFileSync(
    file,
    [
      '---\nid: "runtag"',
      "item: 0",
      "title: 占位符替换",
      "config:",
      "  cron:",
      "    tasks:",
      '      - id: "acc-$runTag"',
      '        vault: "$vault"',
      '        at: "$nextMinute"',
      '        prompt: "占位符替换自测"',
      "steps:",
      "  - name: 一步",
      "    do: waitFor",
      "    waitFor:",
      '      has: ["acc-$runTag"]',
      "    title: acc-$runTag",
      "---",
      "",
    ].join("\n"),
  );
  const scenario = await loadScenario(file);
  const expected = runTag();
  assert.equal(scenario.config.cron.tasks[0].id, `acc-${expected}`, "config: 块必须替换");
  assert.equal(scenario.steps[0].title, `acc-${expected}`, "steps 的字段必须替换成同一个值");
  assert.deepEqual(scenario.steps[0].waitFor.has, [`acc-${expected}`], "嵌套数组里的占位符同样要替换");
  assert.equal(
    JSON.stringify(scenario).includes("$runTag"),
    false,
    "整个 front-matter 不得残留占位符字面量",
  );
});

// ── `clickNotification` 的失效索引重试（M752） ───────────────────────────────
//
// 现场：横幅读到的 AX index 在按下时已失效（堆叠组重排），KimiCU **拒发**并说明「动作未发送」。
// 这类失败重读再点即可；判据必须只认「未发送动作」那一族——**只报索引不匹配**的错误可能已经
// 生效，重试会变成两次点击。

const STALE_INDEX_ERROR =
  "click 失败：error: AX target index 6 no longer matches its observed AX path — " +
  "call get_app_state with AX text again before using this index; no action was sent";

test("isStaleIndexError：只认「索引失效 + 动作未发送」，其余一律不重试", () => {
  assert.equal(isStaleIndexError(new Error(STALE_INDEX_ERROR)), true, "现场原文必须判真（可重试）");
  assert.equal(
    isStaleIndexError(new Error("click 失败：error: AX target index 6 no longer matches its observed AX path")),
    false,
    "缺「动作未发送」证据时不得重试：它可能已经生效，重试就是两次点击",
  );
  assert.equal(
    isStaleIndexError(new Error("click 失败：error: position out of bounds")),
    false,
    "坐标类错误与快照无关，重试无意义",
  );
});

test("do: clickNotification（动作级）：索引失效被拒发后重读再点一次，证据留痕", async (t) => {
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "NotificationCenter"], { encoding: "utf8" });
  } catch {
    t.skip("NotificationCenter 不在场（无桌面环境）：本用例只验动作接线，跳过");
    return;
  }
  const root = tmpRoot("notify-click-retry");
  useTmpEnv(root);
  const entry = "- [6] AXGroup (Lumir, acc-cron-click-tag, 到点, stacked) actions=[AXPress, Show Details, Clear All]";
  const tree = ["# Notification Center App State", "```text", '- [0] AXApplication "Notification Center"', entry, "```"].join("\n");
  let clicks = 0;
  const ctx = stubCtx(root);
  ctx.cu = {
    state: async () => ({ text: tree, image: null }),
    click: async () => {
      clicks += 1;
      if (clicks === 1) throw new Error(STALE_INDEX_ERROR);
      return { json: { ok: true }, text: "ok" };
    },
  };
  const ok = await runScenario(ctx, {
    id: "notify-click-retry",
    item: 0,
    title: "点击重试",
    file: path.join(root, "notify-click-retry.md"),
    steps: [{ name: "点通知", do: "clickNotification", title: "acc-cron-click-tag", body: "到点" }],
  });
  assert.equal(ok.status, "PASS", `拒发后重读再点应 PASS，实际：${JSON.stringify(ctx.evidence.records)}`);
  assert.equal(clicks, 2, "第一次拒发（未发送动作）后必须重读再点一次");
  const notes = ctx.evidence.records.filter((r) => r.kind === "note").map((r) => r.text).join("\n");
  assert.match(notes, /索引已失效.*重读通知中心后重试/, `证据里要留痕重试原因，实际：${notes}`);
});

test("do: clickNotification（动作级）：非「未发送动作」的错误不重试，直接判 FAIL", async (t) => {
  try {
    execFileSync("/usr/bin/pgrep", ["-x", "NotificationCenter"], { encoding: "utf8" });
  } catch {
    t.skip("NotificationCenter 不在场（无桌面环境）：本用例只验动作接线，跳过");
    return;
  }
  const root = tmpRoot("notify-click-hardfail");
  useTmpEnv(root);
  const entry = "- [6] AXGroup (Lumir, acc-cron-click-tag, 到点, stacked) actions=[AXPress, Show Details, Clear All]";
  const tree = ["# Notification Center App State", "```text", '- [0] AXApplication "Notification Center"', entry, "```"].join("\n");
  let clicks = 0;
  const ctx = stubCtx(root);
  ctx.cu = {
    state: async () => ({ text: tree, image: null }),
    click: async () => {
      clicks += 1;
      throw new Error("click 失败：error: AX target index 6 no longer matches its observed AX path");
    },
  };
  const bad = await runScenario(ctx, {
    id: "notify-click-hardfail",
    item: 0,
    title: "点击不重试",
    file: path.join(root, "notify-click-hardfail.md"),
    steps: [{ name: "点通知", do: "clickNotification", title: "acc-cron-click-tag", body: "到点" }],
  });
  assert.equal(bad.status, "FAIL", "无法证明「动作未发送」时必须判 FAIL，不得重试掩盖");
  assert.equal(clicks, 1, "这类错误只允许点一次（可能已生效）");
});
