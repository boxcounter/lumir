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
// 跑法（gate 不含本文件——套件自测不进常驻门禁，与 `scripts/migrate-harness-sessions.test.mjs`
// 同例；改过 loader / 断言实现后手跑一次）：
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

import { checkScenario, contentClickGeometry, establishEditorFocus, focusedRoleReading, loadScenario, notificationBaseline, notificationMatches, pickFreshNotification, runScenario } from "./execute.mjs";
import { parseNodes } from "./ax.mjs";
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

/** 224 的现场（M669）：浮钮的可访问名同时出现在 transcript 正文里（AXStaticText 的 value）。 */
const AX_BODY_TEXT_ONLY = [
  "# Lumir App State",
  "",
  "- app: Lumir",
  "- pid: 123",
  "- window_bounds: x=8 y=40 w=1200 h=800 (screen points)",
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
 *  （`[166]` 是编辑器正文、`[250]` 是 composer）。`marks` 里的角色带 `(focused)` 标记。 */
function focusDump(...marks) {
  const mark = (k) => (marks.includes(k) ? " (focused)" : "");
  return [
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 1",
    "- element_count: 5",
    "- window_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "- screenshot: 1152×768 px",
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 1152×768',
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

test("正文单击落点（M678）：截图像素 → 窗口局部 → Quartz 的换算，以及两条不可算的边界", () => {
  const textarea = { bbox: { x: 100, y: 200, w: 600, h: 500 } };
  const bounds = { x: 8, y: 40, w: 1200, h: 800 };
  const shot = { w: 1152, h: 768 };

  const g = contentClickGeometry({ textarea, bounds, shot });
  assert.deepEqual(g.shotPoint, { x: 140, y: 206 }, "缺省落点 = bbox 原点 + (40,6)（截图像素）");
  assert.ok(Math.abs(g.point.x - (8 + (140 * 1200) / 1152)) < 1e-9, `x 换算错：${g.point.x}`);
  assert.ok(Math.abs(g.point.y - (40 + (206 * 800) / 768)) < 1e-9, `y 换算错：${g.point.y}`);

  const custom = contentClickGeometry({ textarea, bounds, shot, dx: 120, dy: 60 });
  assert.deepEqual(custom.shotPoint, { x: 220, y: 260 }, "clickEditor 的 dx/dy 原样生效");

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

test("focusWindow click 的重试与判败（M678）：坏态不得判通过，修好的第二次单击才结束重试", async () => {
  let clicks = 0;
  let current = ["webview"];
  const clickOnce = async () => {
    clicks += 1;
    return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
  };
  const readFocus = async () => readDump(current);

  // ① 第一次单击被激活吃掉（仍是 M670 的 webview 级焦点），第二次落地 ⇒ 恰好点两次后成功。
  const ok = await establishEditorFocus({
    clickOnce: async (i) => {
      current = i === 1 ? ["webview"] : ["editor"];
      return clickOnce(i);
    },
    readFocus,
    attempts: 3,
    sleepFn: async () => {},
  });
  assert.equal(ok.attempt, 2, `应在第 2 次单击后建立焦点，实际 ${ok.attempt}`);
  assert.equal(clicks, 2, `应恰好点两次，实际 ${clicks}`);
  assert.equal(ok.reading.isEditor, true);

  // ② 单击一直不落地、焦点留在 composer（最像假绿的状态）⇒ 耗尽 attempts 后判失败，不静默放行。
  let stuckClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        stuckClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["composer"]),
      attempts: 3,
      sleepFn: async () => {},
    }),
    (e) => e instanceof InfraError && /仍未建立「key window \+ 编辑器焦点」/.test(e.message),
    "composer 有焦点时必须判「未建立」，且耗尽重试后抛 InfraError",
  );
  assert.equal(stuckClicks, 3, `重试上限应恰好用满 3 次，实际 ${stuckClicks}`);

  // ③ 编辑器有焦点、但没有 key window（AXFocusedWindow 不在场）⇒ 同样判失败：
  //    只看 focused 标记会把「窗口未被激活、这次单击又被吃掉」放行（M667 的现场）。
  let notKeyClicks = 0;
  await assert.rejects(
    establishEditorFocus({
      clickOnce: async () => {
        notKeyClicks += 1;
        return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
      },
      readFocus: async () => readDump(["editor"]),
      readKeyWindow: async () => ({ focused: false, raw: "focusedWindow=false title=Lumir" }),
      attempts: 2,
      sleepFn: async () => {},
    }),
    (e) => e instanceof InfraError && /AXfocusedWindow=false/.test(e.message),
    "编辑器有焦点但 AXFocusedWindow=false 时必须判「未建立」，且在错误里给出窗口读数",
  );
  assert.equal(notKeyClicks, 2, `窗口不是 key 时应把重试用满，实际 ${notKeyClicks}`);

  // ④ 第一次就成立（编辑器焦点 + 窗口是 key）⇒ 只点一次（不多点、不多等）。
  let firstClicks = 0;
  const first = await establishEditorFocus({
    clickOnce: async () => {
      firstClicks += 1;
      return { shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } };
    },
    readFocus: async () => readDump(["editor"]),
    readKeyWindow: async () => ({ focused: true, raw: "focusedWindow=true title=Lumir" }),
    attempts: 3,
    sleepFn: async () => {},
  });
  assert.equal(first.attempt, 1);
  assert.equal(firstClicks, 1);
  assert.equal(first.key.focused, true);

  // ⑤ 窗口读数不可得（null）⇒ 只记录、不据此判败，编辑器焦点仍成立即通过。
  const unknown = await establishEditorFocus({
    clickOnce: async () => ({ shotPoint: { x: 40, y: 6 }, point: { x: 48, y: 46 } }),
    readFocus: async () => readDump(["editor"]),
    readKeyWindow: async () => ({ focused: null, raw: "读取失败：boom" }),
    attempts: 1,
    sleepFn: async () => {},
  });
  assert.equal(unknown.attempt, 1, "窗口读数读不到时不得把 unknown 当成 false 而判败");
});

test("全库场景静态校验通过（--check 的真实通道）", () => {
  const out = execFileSync(process.execPath, [path.join(repoRoot(), "scripts/acceptance/run.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.match(out, /场景静态校验通过（\d+ 个）/, `--check 应全过，实际末尾：${out.slice(-300)}`);
});
