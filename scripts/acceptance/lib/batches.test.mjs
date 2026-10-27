// scripts/acceptance/lib/batches.test.mjs —— 批次筛选 / 参数解析 / tier 校验的自测（node:test，零新增依赖）。
//
// 为什么需要它（M749）：批次让「默认跑全量」变成「默认跑 core」只差一个默认值，而这个默认值写错
// 或批次取值拼错时的症状都是**静默**的——少跑一批却照样报 PASS（REVIEW.md「断言等价于子串」同族：
// 筛选器没有区分度）。故逐条构造必须红的输入：非法批次、`--batch` 缺值、两批次并存、tier 拼错、
// `tier: bundle` 与 `requires: bundle` 只写一边。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/batches.test.mjs
//
// 纪律：不真机、不起 app；唯一读磁盘的用例只读 `scenarios/*.md`（与真跑批同一份 loader）。
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { checkTiers, isTier, parseBatchArgs, selectBatch, summarizeTiers, DEFAULT_BATCH, TIERS } from "./batches.mjs";
import { loadScenario } from "./execute.mjs";
import { repoRoot } from "./util.mjs";
import { readdir } from "node:fs/promises";

function scenario(id, tier, extra = {}) {
  return { id, item: 1, title: id, tier, ...extra };
}

const SAMPLE = [
  scenario("a-core", "core"),
  scenario("b-full", "full"),
  scenario("c-full", "full"),
  scenario("d-bundle", "bundle", { requires: "bundle" }),
  scenario("e-evidence", "evidence"),
];

test("批次筛选：core / bundle / evidence 只取同名档，full 取全部（默认行为不被收窄）", () => {
  assert.deepEqual(
    selectBatch(SAMPLE, "core").map((s) => s.id),
    ["a-core"],
  );
  assert.deepEqual(
    selectBatch(SAMPLE, "bundle").map((s) => s.id),
    ["d-bundle"],
  );
  assert.deepEqual(
    selectBatch(SAMPLE, "evidence").map((s) => s.id),
    ["e-evidence"],
  );
  assert.deepEqual(
    selectBatch(SAMPLE, "full").map((s) => s.id),
    SAMPLE.map((s) => s.id),
    "full 是语义上的全量：各档场景一条不少",
  );
});

test("默认批次是 full，且不带 --batch 时的筛选结果与全量逐条相同", () => {
  const { batch, positional, problems } = parseBatchArgs(["07", "8.1"]);
  assert.equal(batch, DEFAULT_BATCH);
  assert.equal(DEFAULT_BATCH, "full");
  assert.deepEqual(positional, ["07", "8.1"], "id 前缀 / item 项号照旧原样收进来");
  assert.deepEqual(problems, []);
  assert.deepEqual(
    selectBatch(SAMPLE, batch).map((s) => s.id),
    selectBatch(SAMPLE, "full").map((s) => s.id),
  );
});

test("非法批次：库调用抛错，CLI 参数报 problem 并点名闭集合", () => {
  for (const bad of ["Core", "cores", "", "all", "  "]) {
    assert.throws(() => selectBatch(SAMPLE, bad), /未知批次/, `selectBatch(${JSON.stringify(bad)}) 必须抛错`);
  }
  assert.equal(isTier("core"), true);
  assert.equal(isTier("Core"), false, "取值区分大小写：Core 不是 core");
  for (const args of [["--batch", "cores"], ["--batch=all"], ["--batch="]]) {
    const { problems } = parseBatchArgs(args);
    assert.equal(problems.length, 1, `${args.join(" ")} 必须判红`);
    assert.match(problems[0], /不在闭集合/);
    assert.ok(problems[0].includes(TIERS.join(" / ")), "报错要写出闭集合，写错的人照抄即对");
  }
});

test("--batch 的取值不会被当成 id 筛选器（批次静默变成 id 筛选是本条要拦的形态）", () => {
  const { batch, positional, problems } = parseBatchArgs(["--batch", "core", "47a"]);
  assert.equal(batch, "core");
  assert.deepEqual(positional, ["47a"], "core 是批次取值，不是 id 前缀");
  assert.deepEqual(problems, []);

  assert.equal(parseBatchArgs(["--batch=evidence"]).batch, "evidence", "--batch=core 形态同样收");
  assert.deepEqual(parseBatchArgs(["--keep-app", "--list"]).positional, [], "其余开关不进 filters");
});

test("--batch 缺值 / 两个不同批次都判红；同一批次重复给一次不算冲突", () => {
  assert.match(parseBatchArgs(["--batch"]).problems[0] ?? "", /缺少取值/);
  assert.match(parseBatchArgs(["--batch", "--list"]).problems[0] ?? "", /缺少取值/, "--list 不该被吞成批次取值");

  const conflict = parseBatchArgs(["--batch", "core", "--batch", "evidence"]);
  assert.equal(conflict.problems.length, 1);
  assert.match(conflict.problems[0], /只能给一个批次/);

  const repeated = parseBatchArgs(["--batch", "core", "--batch=core"]);
  assert.deepEqual(repeated.problems, []);
  assert.equal(repeated.batch, "core");
});

test("tier 缺标 / 非法值依次判红（闭集合之外没有默认档）", () => {
  const problems = checkTiers([scenario("no-tier", undefined), scenario("bad-tier", "Core"), scenario("ok", "full")]);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /no-tier: 缺少 tier/);
  assert.match(problems[1], /bad-tier: tier "Core" 不在闭集合/);
  assert.ok(!problems.some((p) => p.startsWith("ok:")), "合法声明不得出现在问题里");
});

test("tier: bundle 与 requires: bundle 必须一一对应（两个方向都判红）", () => {
  const tierOnly = checkTiers([scenario("tier-only", "bundle")]);
  assert.equal(tierOnly.length, 1);
  assert.match(tierOnly[0], /tier=bundle 但没写 requires: bundle/);

  const requiresOnly = checkTiers([scenario("requires-only", "full", { requires: "bundle" })]);
  assert.equal(requiresOnly.length, 1);
  assert.match(requiresOnly[0], /声明了 requires: bundle 但 tier=full/);

  assert.deepEqual(checkTiers([scenario("paired", "bundle", { requires: "bundle" })]), []);
  assert.deepEqual(checkTiers(SAMPLE), [], "自测样本本身必须合法（否则下面的断言没有输入）");
});

test("summarizeTiers 逐档计数；缺标场景不计入任何档（但会被 checkTiers 点名）", () => {
  const counts = summarizeTiers([...SAMPLE, scenario("no-tier", undefined)]);
  assert.deepEqual(counts, { core: 1, full: 2, bundle: 1, evidence: 1 });
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    SAMPLE.length,
    "计入各档的条数不含缺标场景",
  );
  assert.equal(checkTiers([scenario("no-tier", undefined)]).length, 1);
});

test("selectBatch 保持入参顺序（跑批顺序不因分批改变）", () => {
  const shuffled = [SAMPLE[3], SAMPLE[0], SAMPLE[4], SAMPLE[2], SAMPLE[1]];
  assert.deepEqual(
    selectBatch(shuffled, "full").map((s) => s.id),
    shuffled.map((s) => s.id),
  );
});

test("真仓库对账：247 个场景的 tier 声明合法，且 full / core / bundle / evidence 各档自洽", async () => {
  const dir = path.join(repoRoot(), "scripts/acceptance/scenarios");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  const all = await Promise.all(names.map((n) => loadScenario(path.join(dir, n))));

  assert.ok(all.length > 100, `场景数与预期量级不符（读到 ${all.length} 个）——加载面可能错了`);
  assert.deepEqual(checkTiers(all), [], "全部场景必须显式声明合法 tier");

  const counts = summarizeTiers(all);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, all.length, "每个场景恰好落在一个档里");
  for (const tier of TIERS) assert.ok(counts[tier] > 0, `${tier} 档不得为空（空档说明声明写错或筛选失效）`);

  assert.deepEqual(
    selectBatch(all, "full").map((s) => s.id),
    all.map((s) => s.id),
    "full 批次必须覆盖全部场景——分层不得把默认行为静默收窄",
  );
  assert.deepEqual(
    selectBatch(all, "bundle").map((s) => s.id),
    all.filter((s) => s.requires === "bundle").map((s) => s.id),
    "bundle 批与 requires: bundle 逐条相同",
  );
  const tiers = new Set(all.map((s) => s.tier));
  assert.deepEqual([...tiers].sort(), [...TIERS].sort(), "四档都有实际使用者");
});
