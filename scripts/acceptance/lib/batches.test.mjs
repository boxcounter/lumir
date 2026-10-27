// scripts/acceptance/lib/batches.test.mjs —— 批次 / 筛选词 / 参数解析 / tier 校验的自测（node:test，零新增依赖）。
//
// 为什么需要它（M749）：批次让「默认跑全量」变成「默认跑 core」只差一个默认值，而这个默认值写错
// 或批次取值拼错时的症状都是**静默**的——少跑一批却照样报 PASS（REVIEW.md「断言等价于子串」同族：
// 筛选器没有区分度）。故逐条构造必须红的输入：非法批次、`--batch` 缺值、两批次并存、tier 拼错、
// `tier: bundle` 与 `requires: bundle` 只写一边。
//
// 筛选词侧（M758）：旧实现是「id 前缀 ∪ item 项号」的**并集**，`13` 会把整个 13x 组带出来（M754
// 真机现场只能人工中止），症状同样是静默扩大跑批。用例按三级优先级逐条构造旧口径会判红的输入，
// 末条对真实 230 个场景对账。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/batches.test.mjs
//
// 纪律：不真机、不起 app；读磁盘的用例只读 `scenarios/*.md`（与真跑批同一份 loader）。
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkTiers,
  isTier,
  matchKind,
  MATCH_KINDS,
  parseBatchArgs,
  selectBatch,
  selectScenarios,
  summarizeTiers,
  DEFAULT_BATCH,
  TIERS,
} from "./batches.mjs";
import { loadScenario } from "./execute.mjs";
import { repoRoot } from "./util.mjs";
import { readdir, readFile } from "node:fs/promises";

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

test("真仓库对账：全部场景的 tier 声明合法，且 full / core / bundle / evidence 各档自洽", async () => {
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

// ---------------------------------------------------------------------------------------------
// 位置参数的三级匹配（M758，据 M754 finding：`13` 连跑了 130–139）
//
// 拦的形态是「短 id 静默扩大跑批」：旧实现 `id.startsWith(f) || item === f` 是**并集**，`13`
// 既命中 item 13 的 13-toc、也命中所有 13x 前缀场景，跑批面在用户读法之外扩大、多跑的场景还
// 一起进证据与退出码。下列用例逐条构造旧实现会判红（或该红时反而不红）的输入。
// ---------------------------------------------------------------------------------------------

/** 合成样本：id / item 的交叉关系取自真仓库（`47a–d` 共享 item 47；`230a–c` 的 item 是 655；
 *  13-toc 与 13x 组是 M754 的原案——合成样本不必与现役清单逐条同步）。 */
function sel(id, item, tier = "full") {
  return { id, item, title: id, tier };
}

const SELECT_SAMPLE = [
  sel("12-links", 12),
  sel("120-list-lazy-continuation-indent", 120),
  sel("13-toc", 13),
  sel("130-harness-session-empty-flash", 130, "core"),
  sel("139-harness-draft-no-vault", 139, "core"),
  sel("32-list-filter", 32),
  sel("47a-menu-basics", 47),
  sel("47b-rename-validation", 47),
  sel("47c-create-and-delete", 47),
  sel("47d-dirty-tab-linkage", 47),
  sel("230a-path-forms", 655),
  sel("230b-lazy-and-external-readonly", 655),
  sel("230c-restart-and-focus-scopes", 655),
  sel("231-harness-readonly-write-forms", 231),
  sel("231b-harness-hidden-write-refusal", 231),
  sel("231-quick-open-long-path-width", 702),
];

const idsOf = (scenarios) => scenarios.map((s) => s.id);

test("优先级顺序是「精确 id → item 项号 → id 前缀」（MATCH_KINDS 是唯一真源）", () => {
  assert.deepEqual([...MATCH_KINDS], ["id", "item", "prefix"]);
  assert.equal(matchKind(sel("13-toc", 13), "13-toc"), "id");
  assert.equal(matchKind(sel("13-toc", 13), "13"), "item", "13 命中 item 13，不是前缀");
  assert.equal(matchKind(sel("130-harness-session-empty-flash", 130), "13"), "prefix", "只有前缀级才咬 13x");
  assert.equal(matchKind(sel("13-toc", 13), "13x"), null);
  assert.equal(matchKind(sel("13-toc", 13), ""), null, "空串不得命中（startsWith('') 恒真会放大成全量）");
  assert.equal(matchKind(sel("13-toc", 13), " 13 "), "item", "筛选词按 trim 后比较");
});

test("13 只选 item 13 的 13-toc，不再连跑 130–139", () => {
  const { selected, byFilter, unmatched, outOfBatch } = selectScenarios(SELECT_SAMPLE, ["13"]);
  assert.deepEqual(idsOf(selected), ["13-toc"], "旧实现的并集语义在这里会连同 130 / 139 一起返回");
  assert.deepEqual(byFilter, [{ filter: "13", kind: "item", ids: ["13-toc"] }]);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(outOfBatch, []);
});

test("完整场景 id 精确命中优先于 item 与前缀", () => {
  assert.deepEqual(idsOf(selectScenarios(SELECT_SAMPLE, ["13-toc"]).selected), ["13-toc"]);
  assert.equal(selectScenarios(SELECT_SAMPLE, ["13-toc"]).byFilter[0].kind, "id");
  // `231-quick-open…` 的 item 是 702：精确 id 这一级必须把它选中，不能因 item 级有 231 而落空。
  const quickOpen = selectScenarios(SELECT_SAMPLE, ["231-quick-open-long-path-width"]);
  assert.deepEqual(idsOf(quickOpen.selected), ["231-quick-open-long-path-width"]);
  assert.equal(quickOpen.byFilter[0].kind, "id");
});

test("47 / 230 的拆分组便利行为不变（47 靠 item 级、230 靠前缀级各自选全组）", () => {
  const g47 = selectScenarios(SELECT_SAMPLE, ["47"]);
  assert.deepEqual(idsOf(g47.selected), [
    "47a-menu-basics",
    "47b-rename-validation",
    "47c-create-and-delete",
    "47d-dirty-tab-linkage",
  ]);
  assert.equal(g47.byFilter[0].kind, "item", "47a–d 共享 item 47，item 级就该选全组");

  const g230 = selectScenarios(SELECT_SAMPLE, ["230"]);
  assert.deepEqual(idsOf(g230.selected), [
    "230a-path-forms",
    "230b-lazy-and-external-readonly",
    "230c-restart-and-focus-scopes",
  ]);
  assert.equal(g230.byFilter[0].kind, "prefix", "230 无 item 命中（item 是 655），落到前缀级照样选全组");
});

test("id 前缀是最后一级：47a / 230b 这类带后缀的筛选词仍按前缀单选", () => {
  assert.deepEqual(idsOf(selectScenarios(SELECT_SAMPLE, ["47a"]).selected), ["47a-menu-basics"]);
  assert.equal(selectScenarios(SELECT_SAMPLE, ["47a"]).byFilter[0].kind, "prefix");
  assert.deepEqual(idsOf(selectScenarios(SELECT_SAMPLE, ["230b"]).selected), ["230b-lazy-and-external-readonly"]);
});

test("无命中：三级全空 → 选中为空且点名该筛选词（不静默跑 0 条、不退回前缀放大）", () => {
  for (const bad of ["999", "13x", "", "   "]) {
    const out = selectScenarios(SELECT_SAMPLE, [bad]);
    assert.deepEqual(out.selected, [], JSON.stringify(bad));
    assert.deepEqual(out.unmatched, [bad.trim()], JSON.stringify(bad));
    assert.equal(out.byFilter[0].kind, null);
  }
  assert.deepEqual(selectScenarios(SELECT_SAMPLE, ["13", "999"]).unmatched, ["999"], "命中与无命中并存时只点名无命中的那个");
});

test("混合参数：词与词取并集、按场景顺序去重（同一条被两个词命中只跑一次）", () => {
  assert.deepEqual(idsOf(selectScenarios(SELECT_SAMPLE, ["13", "32"]).selected), ["13-toc", "32-list-filter"]);
  assert.deepEqual(
    idsOf(selectScenarios(SELECT_SAMPLE, ["32", "13"]).selected),
    ["13-toc", "32-list-filter"],
    "选中顺序 = 场景顺序，不随参数顺序改变跑批顺序",
  );
  const dup = selectScenarios(SELECT_SAMPLE, ["13-toc", "13"]);
  assert.deepEqual(idsOf(dup.selected), ["13-toc"]);
  assert.deepEqual(
    dup.byFilter.map((e) => e.kind),
    ["id", "item"],
    "两个词各自按自己的级解析，去重发生在选中集上",
  );
});

test("批次是交集不是解析域：命中的都不在批内时报 outOfBatch，绝不退回前缀在批内凑数", () => {
  const corePool = selectBatch(SELECT_SAMPLE, "core");
  // 13-toc 属 full；旧口径「在批内按前缀筛」会选中批内的 130 / 139——正是要拦的静默换义。
  const out = selectScenarios(SELECT_SAMPLE, ["13"], corePool);
  assert.deepEqual(out.selected, []);
  assert.deepEqual(out.outOfBatch, ["13-toc"]);
  assert.equal(out.byFilter[0].kind, "item", "解析级与 --batch 无关：仍是 item 级");

  const inBatch = selectScenarios(SELECT_SAMPLE, ["130"], corePool);
  assert.deepEqual(idsOf(inBatch.selected), ["130-harness-session-empty-flash"]);
  assert.deepEqual(inBatch.outOfBatch, []);
});

test("无筛选词时选中集 = 批次池（返回副本，不改入参），与分层前默认行为逐条相同", () => {
  const out = selectScenarios(SELECT_SAMPLE, []);
  assert.deepEqual(idsOf(out.selected), idsOf(SELECT_SAMPLE));
  assert.notEqual(out.selected, SELECT_SAMPLE, "必须是副本：调用方改选中集不得改到批次池");
  const corePool = selectBatch(SELECT_SAMPLE, "core");
  assert.deepEqual(idsOf(selectScenarios(SELECT_SAMPLE, [], corePool).selected), idsOf(corePool));
});

test("真仓库对账：item 与 id 前缀交叉处按 item 选（13 → 13-toc），47 → 47a–d、230 → 230a–c", async () => {
  const dir = path.join(repoRoot(), "scripts/acceptance/scenarios");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  const all = await Promise.all(names.map((n) => loadScenario(path.join(dir, n))));

  // M754 的原案：13-toc 由 M750 r2 按协调裁决保留（M754 为它新增了长文中段跳转的真机独有回归），
  // 故这里按现存场景直接判。场景若被后续任务退役，宁可判红让人来改口径，也不要静默跳过——空转的
  // 断言等于没有。末尾另有一条不绑具体场景的动态对账钉住优先级本身。
  const thirteen = selectScenarios(all, ["13"]);
  assert.deepEqual(idsOf(thirteen.selected), ["13-toc"], "M754 现场：13 曾把 13x 组整组带出来");
  assert.equal(thirteen.byFilter[0].kind, "item");
  const thirteenGroup = all.filter((s) => s.id.startsWith("13") && s.id !== "13-toc").map((s) => s.id);
  assert.ok(thirteenGroup.length > 0, "13x 组必须在场（否则本用例没有区分度）");
  assert.ok(
    thirteenGroup.every((id) => !idsOf(thirteen.selected).includes(id)),
    "13x 组的任何一个都不得被 13 选中",
  );

  // 批次不改语义：13-toc 属 full，核心批里 `13` 命中的场景整条落在批外。
  const corePool = selectBatch(all, "core");
  assert.ok(!corePool.some((s) => s.id === "13-toc"), "前提：13-toc 不在核心批（否则本用例测不到批外交集）");
  const inCore = selectScenarios(all, ["13"], corePool);
  assert.deepEqual(inCore.selected, []);
  assert.deepEqual(inCore.outOfBatch, ["13-toc"]);

  const g47 = idsOf(selectScenarios(all, ["47"]).selected);
  assert.deepEqual(g47, ["47a-menu-basics", "47b-rename-validation", "47c-create-and-delete", "47d-dirty-tab-linkage"]);

  const g230 = idsOf(selectScenarios(all, ["230"]).selected);
  assert.deepEqual(g230, ["230a-path-forms", "230b-lazy-and-external-readonly", "230c-restart-and-focus-scopes"]);

  // 前缀级对真仓仍有区分度：47a / 230b 各只选一条。
  assert.deepEqual(idsOf(selectScenarios(all, ["47a"]).selected), ["47a-menu-basics"]);
  assert.deepEqual(idsOf(selectScenarios(all, ["230b"]).selected), ["230b-lazy-and-external-readonly"]);

  // 动态对账（不绑具体场景）：取一个「有 item 命中、同时又是别的场景 id 前缀」的筛选词，选中集必须
  // 恰等于 item 级那批，前缀组里的其余场景一条都不能混进来——场景增删不会让这条断言失去输入。
  const collided = [...new Set(all.map((s) => String(s.item)))]
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .find((item) => all.some((s) => s.id.startsWith(item) && String(s.item) !== item));
  assert.ok(collided, "真仓里必须至少有一个 item / id 前缀交叉的筛选词——否则优先级没有可验的输入");
  const resolved = selectScenarios(all, [collided]);
  assert.equal(resolved.byFilter[0].kind, "item", `筛选词 ${collided} 应命中 item 级`);
  assert.deepEqual(
    idsOf(resolved.selected),
    all.filter((s) => String(s.item) === collided).map((s) => s.id),
    `筛选词 ${collided} 必须按 item 级选中，不得带出同前缀的其他场景`,
  );
});

test("run.mjs 的筛选只有一个出口：--check / --list / 真跑批共用同一次 selectScenarios", async () => {
  const runSrc = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "run.mjs"), "utf8");
  const callSites = [...runSrc.matchAll(/\bselectScenarios\s*\(/g)].length;
  assert.equal(
    callSites,
    1,
    "selectScenarios 在 run.mjs 里必须只有一个调用点：三个入口各自解析就会出现「显示一套、执行一套」",
  );
  assert.ok(runSrc.includes("const selected = selection.selected;"), "选中集必须直接取自这一次解析的结果");
  assert.ok(
    !/filters\.some\(|s\.id\.startsWith\(f\)/.test(runSrc),
    "run.mjs 里不得再写一遍「前缀 ∪ item」筛选——那是 M758 修掉的旧口径（与 batches.mjs 两套语义）",
  );
});
