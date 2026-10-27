// scripts/acceptance/coverage.test.mjs —— 验收覆盖表生成器 / 检查器的自测（node:test，零新增依赖）。
//
// 为什么需要它（M690）：覆盖表取代了 backlog 里手维护的「已机验」注册表，一旦生成器或检查器失效，
// 覆盖表会**静默**少行 / 多行 / 停在旧版本——没有红，只有一份看着完整的假索引（REVIEW.md「断言等价
// 于子串」「同一语义两处真源」条）。故按本仓惯例构造**必须让它 FAIL 的输入**逐条实测：缺字段、重复 id、
// 非法 item、表内同一 item 两行、漏场景 / 多 id、手改后与场景不一致；M749 起再加 tier 一列的四条——
// 缺标 / 取值越出闭集合 / 与场景数不齐 / `tier: bundle` 与 `requires: bundle` 只写一边。
//
// 跑法（与 execute.test.mjs 同例，经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/coverage.test.mjs
//
// 纪律：全程对临时目录（`os.tmpdir()`）跑——不碰验收 vault、不写仓库里的 COVERAGE.md。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCoverage, checkCoverage, checkCoverageText, loadScenarios, normalizeItem } from "./coverage.mjs";
import { repoRoot } from "./lib/util.mjs";

/** 最小场景对象：只带覆盖表要的字段 + 文件标签（与 loadScenario 的返回形状同源）。 */
function scenario(id, item, title, extra = {}) {
  return { id, item, title, tier: "full", file: path.join(os.tmpdir(), `${id || "no-id"}.md`), ...extra };
}

function tmpRoot(name) {
  const dir = path.join(os.tmpdir(), `lumir-coverage-selfcheck-${name}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScenario(dir, { id, item, title, tier = "full" }) {
  const lines = ["---"];
  if (id !== undefined) lines.push(`id: "${id}"`);
  if (item !== undefined) lines.push(`item: ${JSON.stringify(item)}`);
  if (title !== undefined) lines.push(`title: ${JSON.stringify(title)}`);
  lines.push(`tier: ${tier}`);
  lines.push("steps:", "  - name: 占位", "    expect:", "      - shot: 占位", "---", "", "正文占位。");
  fs.writeFileSync(path.join(dir, `${id}.md`), `${lines.join("\n")}\n`);
}

function problemsMatching(problems, pattern) {
  return problems.filter((p) => pattern.test(p));
}

test("同一 item 的多个场景并成一行；item 数按不同编号计（item 是分组键，不是场景级唯一键）", () => {
  const scenarios = [
    scenario("07-recovery-paths", 7, "M124 三条恢复路径"),
    scenario("07b-recovery-saveas", 7, "M124 恢复路径之二"),
    scenario("08c-crash-recovery", 8, "崩溃恢复"),
  ];
  const { markdown, problems, items } = buildCoverage(scenarios);

  assert.deepEqual(problems, []);
  assert.equal(items.length, 2, "两个不同 item ⇒ 两行");
  assert.match(markdown, /\| 7 \| `07-recovery-paths`<br>`07b-recovery-saveas` \| /);
  assert.match(markdown, /\| 8 \| `08c-crash-recovery` \| /);
  // 「一项一行」不是「一场景一行」：item 7 的两个 id 必须都在同一行里。
  const row7 = markdown.split("\n").find((line) => line.startsWith("| 7 |"));
  assert.ok(row7.includes("07-recovery-paths") && row7.includes("07b-recovery-saveas"));
});

test("缺 id / item / title 各自判红（缺 id 认 front-matter 声明，不认 loader 的文件名回落）", () => {
  const missingId = buildCoverage([scenario("", 1, "标题", { idDeclared: false })]);
  assert.ok(problemsMatching(missingId.problems, /缺少 id/).length > 0);

  const fallbackOnly = buildCoverage([scenario("from-filename", 1, "标题", { idDeclared: false })]);
  assert.ok(problemsMatching(fallbackOnly.problems, /缺少 id/).length > 0, "文件名的回落值不算声明");

  const missingItem = buildCoverage([scenario("a", undefined, "标题")]);
  assert.ok(problemsMatching(missingItem.problems, /缺少 item/).length > 0);

  const missingTitle = buildCoverage([scenario("a", 1, "")]);
  assert.ok(problemsMatching(missingTitle.problems, /缺少 title/).length > 0);
});

test("title 含运行期绝对路径判红（覆盖表入 git，必须机器无关）", () => {
  const title = `打开 ${path.join(repoRoot(), "scripts/acceptance/fixtures/note.md")}`;
  const { problems } = buildCoverage([scenario("a", 1, title)]);
  assert.ok(problemsMatching(problems, /title 含运行期绝对路径/).length > 0);
});

test("$env 在自定义 results root 下仍判红（两个不同 root 均必红，覆盖表不得随环境变化）", async () => {
  const dir = tmpRoot("env-token");
  writeScenario(dir, { id: "env-token", item: 1, title: "$env/note.md" });
  const roots = [path.join(tmpRoot("res-a"), "results"), path.join(tmpRoot("res-b"), "results")];
  const seen = [];
  try {
    for (const root of roots) {
      process.env.LUMIR_ACCEPTANCE_RESULTS = root;
      const scenarios = await loadScenarios(dir);
      seen.push({ root, envPath: path.join(path.dirname(root), "env"), ...buildCoverage(scenarios) });
    }
  } finally {
    delete process.env.LUMIR_ACCEPTANCE_RESULTS;
  }
  assert.notEqual(seen[0].envPath, seen[1].envPath, "两个 root 必须解析出不同的 $env 路径");
  for (const { root, envPath, markdown, problems } of seen) {
    assert.ok(markdown.includes(envPath), `results root=${root} 时 $env 应替换成 ${envPath}（前置条件）`);
    assert.ok(
      problemsMatching(problems, /title 含运行期绝对路径/).length > 0,
      `results root=${root} 时 $env 标题必须判红（否则覆盖表随环境变化）`,
    );
  }
});

test("id 重复判红并点名两个所有者文件", () => {
  const scenarios = [
    scenario("dup", 1, "甲", { file: "/tmp/first.md" }),
    scenario("dup", 2, "乙", { file: "/tmp/second.md" }),
  ];
  const { problems } = buildCoverage(scenarios);
  const hits = problemsMatching(problems, /id 'dup' 重复/);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /first\.md/);
  assert.match(hits[0], /second\.md/);
});

test("item 形态非法判红：布尔 / 零 / 浮点 / 非数字串 / 空串", () => {
  for (const item of [true, 0, 8.5, "abc", "", "8.", "-1"]) {
    const { problems } = buildCoverage([scenario("a", item, "标题")]);
    assert.ok(
      problemsMatching(problems, /item .*形态非法/).length > 0,
      `item=${JSON.stringify(item)} 必须判红`,
    );
  }
  assert.ok(problemsMatching(buildCoverage([scenario("a", null, "标题")]).problems, /缺少 item/).length > 0);
});

test("normalizeItem：数字 / 数字串 / 前导零同键，非法形态返回 null", () => {
  assert.equal(normalizeItem(8), "8");
  assert.equal(normalizeItem("8"), "8");
  assert.equal(normalizeItem("08"), "8");
  assert.equal(normalizeItem("8.01"), "8.1");
  assert.equal(normalizeItem("8.12"), "8.12");
  for (const bad of [0, -1, 8.5, "8.", ".5", "8.a", true, null, undefined])
    assert.equal(normalizeItem(bad), null, `normalizeItem(${JSON.stringify(bad)}) 应为 null`);
});

test("表按 item 数值排序：8 → 8.2 → 8.12 → 9（子项按数值、不按字典序）", () => {
  const { markdown } = buildCoverage([
    scenario("nine", 9, "九"),
    scenario("eight-twelve", "8.12", "八之十二"),
    scenario("eight-two", "8.2", "八之二"),
    scenario("eight", 8, "八"),
  ]);
  const items = markdown
    .split("\n")
    .filter((line) => /^\| \d/.test(line))
    .map((line) => line.split("|")[1].trim());
  assert.deepEqual(items, ["8", "8.2", "8.12", "9"]);
});

test("表与场景一致时通过；漏行 / 多 id / 同一 item 两行 / 同一 id 两次 / 标题改动都判红", () => {
  const scenarios = [scenario("a-note", 1, "甲"), scenario("b-note", 2, "乙")];
  const { markdown } = buildCoverage(scenarios);
  assert.deepEqual(checkCoverageText(scenarios, markdown), [], "生成物应当自证一致");

  // ① 同一 item 出现两行：复制 item 1 那行。
  const row1 = markdown.split("\n").find((line) => line.startsWith("| 1 |"));
  const duplicated = markdown.replace(row1, `${row1}\n${row1}`);
  assert.ok(
    problemsMatching(checkCoverageText(scenarios, duplicated), /item 1 出现了 2 行/).length > 0,
    "同一 item 两行必须判红",
  );

  // ② 漏场景：删掉 item 2 那行。
  const row2 = markdown.split("\n").find((line) => line.startsWith("| 2 |"));
  const missingRow = markdown.replace(`${row2}\n`, "");
  assert.ok(
    problemsMatching(checkCoverageText(scenarios, missingRow), /漏掉 1 个场景.*b-note/).length > 0,
    "漏掉的场景必须点名",
  );

  // ③ 多出场景目录里不存在的 id。
  const extraRow = `${markdown}| 999 | \`ghost-note\` | 鬼 | full |\n`;
  assert.ok(problemsMatching(checkCoverageText(scenarios, extraRow), /不存在的 id：.*ghost-note/).length > 0);

  // ④ 同一场景 id 在同一行出现两次。
  const twiceInRow = markdown.replace("| `a-note` |", "| `a-note`<br>`a-note` |");
  assert.ok(problemsMatching(checkCoverageText(scenarios, twiceInRow), /场景 id 'a-note' 出现了 2 次/).length > 0);

  // ⑤ 场景标题改了、表没重生成：字节比对必须红。
  const retitled = [scenario("a-note", 1, "甲（改）"), scenario("b-note", 2, "乙")];
  assert.ok(
    problemsMatching(checkCoverageText(retitled, markdown), /与场景 front-matter 不一致/).length > 0,
    "场景改标题后旧表必须判红",
  );
});

test("COVERAGE.md 不存在时判红（不是静默通过）", () => {
  const problems = checkCoverageText([scenario("a", 1, "标题")], null);
  assert.ok(problemsMatching(problems, /不存在：运行 node scripts\/acceptance\/coverage\.mjs 生成/).length > 0);
});

test("端到端：从磁盘场景生成、写到临时文件、再校验（新增场景未重生成 ⇒ 必红）", async () => {
  const dir = tmpRoot("e2e");
  writeScenario(dir, { id: "a-note", item: 1, title: "甲" });
  writeScenario(dir, { id: "b-note", item: 2, title: "乙" });

  const coveragePath = path.join(tmpRoot("e2e-out"), "COVERAGE.md");
  const scenarios = await loadScenarios(dir);
  const { markdown, problems } = buildCoverage(scenarios);
  assert.deepEqual(problems, []);
  fs.writeFileSync(coveragePath, markdown);
  assert.deepEqual(await checkCoverage({ scenarios, coveragePath }), []);

  // 新增场景但不重新生成：既报「漏场景」也报「文件不一致」。
  writeScenario(dir, { id: "c-note", item: 3, title: "丙" });
  const grown = await loadScenarios(dir);
  const stale = await checkCoverage({ scenarios: grown, coveragePath });
  assert.ok(problemsMatching(stale, /漏掉 1 个场景.*c-note/).length > 0);
  assert.ok(problemsMatching(stale, /与场景 front-matter 不一致/).length > 0);

  // 重新生成后恢复绿。
  fs.writeFileSync(coveragePath, buildCoverage(grown).markdown);
  assert.deepEqual(await checkCoverage({ scenarios: grown, coveragePath }), []);
});

test("表格 tier 列与场景逐个对齐；缺列 / 取值非法 / 与场景数不符都逐行点名", () => {
  const scenarios = [scenario("a-note", 1, "甲", { tier: "core" }), scenario("b-note", 1, "乙", { tier: "full" })];
  const { markdown, problems } = buildCoverage(scenarios);
  assert.deepEqual(problems, []);
  const row = markdown.split("\n").find((line) => line.startsWith("| 1 |"));
  assert.match(row, /\| `a-note`<br>`b-note` \| 甲<br>乙 \| core<br>full \|$/, "tier 顺序与 id 列逐个对齐");
  assert.match(markdown, /- 分档：core 1 \/ full 1 \/ bundle 0 \/ evidence 0/);

  const noTierCol = markdown.replace(row, "| 1 | `a-note`<br>`b-note` | 甲<br>乙 |");
  assert.ok(problemsMatching(checkCoverageText(scenarios, noTierCol), /表格行缺 tier 列/).length > 0);

  const badTier = markdown.replace(row, "| 1 | `a-note`<br>`b-note` | 甲<br>乙 | Core<br>full |");
  assert.ok(problemsMatching(checkCoverageText(scenarios, badTier), /tier 取值非法.*Core/).length > 0);

  const shortTiers = markdown.replace(row, "| 1 | `a-note`<br>`b-note` | 甲<br>乙 | core |");
  assert.ok(problemsMatching(checkCoverageText(scenarios, shortTiers), /tier 与场景数不符/).length > 0);
});

test("tier 必填且在闭集合内；tier: bundle 与 requires: bundle 必须一一对应", () => {
  assert.ok(
    problemsMatching(buildCoverage([scenario("no-tier", 1, "甲", { tier: undefined })]).problems, /no-tier: 缺少 tier/)
      .length > 0,
  );
  assert.ok(
    problemsMatching(buildCoverage([scenario("bad-tier", 1, "甲", { tier: "Core" })]).problems, /tier "Core" 不在闭集合/)
      .length > 0,
  );
  assert.ok(
    problemsMatching(buildCoverage([scenario("t1", 1, "甲", { tier: "bundle" })]).problems, /tier=bundle 但没写 requires: bundle/)
      .length > 0,
  );
  assert.ok(
    problemsMatching(
      buildCoverage([scenario("t2", 1, "甲", { tier: "full", requires: "bundle" })]).problems,
      /声明了 requires: bundle 但 tier=full/,
    ).length > 0,
  );
  assert.deepEqual(buildCoverage([scenario("t3", 1, "甲", { tier: "bundle", requires: "bundle" })]).problems, []);
});
