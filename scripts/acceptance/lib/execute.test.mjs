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

import { checkScenario, loadScenario, runScenario } from "./execute.mjs";
import { repoRoot } from "./util.mjs";

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
function stubCtx(root) {
  const records = [];
  return {
    cu: {},
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

async function drive(root, scenario) {
  const ctx = stubCtx(root);
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
  assert.ok(
    errs([{ name: "一步", expect: [{ shot: "x" }] }], { requires: "dev" }).some((p) =>
      p.includes('requires 只支持 "bundle"'),
    ),
    "requires 写错值应报 problem（否则 runner 静默忽略、场景在 dev 下跑出假 FAIL）",
  );
  assert.deepEqual(errs([{ name: "一步", expect: [{ shot: "x" }] }], { requires: "bundle" }), []);
});

test("全库场景静态校验通过（--check 的真实通道）", () => {
  const out = execFileSync(process.execPath, [path.join(repoRoot(), "scripts/acceptance/run.mjs"), "--check"], {
    encoding: "utf8",
  });
  assert.match(out, /场景静态校验通过（\d+ 个）/, `--check 应全过，实际末尾：${out.slice(-300)}`);
});
