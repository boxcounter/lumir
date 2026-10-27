// scripts/acceptance/lib/batches.mjs —— 验收批次（tier）的唯一真源与筛选纯函数。
//
// 背景（M749）：真机全量 230 场景约 2 小时（M750 下沉 17 条后从 247 降到 230；`13-toc` 按
// M758 的协调裁决保留——M754 为它新增了长文中段跳转的真机独有回归），而「每批合并后跑一遍」
// 只需要一条**核心批**。
// 分层若靠第二份手维护的场景清单，它立刻会与 `scenarios/*.md` 漂移（REVIEW.md「同一语义两处真源」
// 条）。故批次的唯一真源是场景 front-matter 的 `tier:` 字段，本模块只做四件事：
// 校验这份声明（`checkTiers`）、按声明筛场景（`selectBatch`）、解析 CLI 参数（`parseBatchArgs`）、
// 按位置参数（筛选词）筛场景（`selectScenarios`）。runner 与覆盖表都调这几份，不各写一遍。
//
// 位置参数的三级匹配（M758，据 M754 finding）：`13` 曾按前缀连跑 130–139，而调用方读法是
// 「跑第 13 项」。故筛选词逐词按「**精确 id → item 项号精确相等 → id 前缀**」取**第一个有命中的
// 级**（不是并集）：`13` 只选 item 13 的 13-toc，`47` / `230` 仍选各自的拆分组（47a–47d 共享
// item 47；230a–c 的 item 是 655，无 item 命中而落到前缀级，同样选全组）。
//
// 语义（据 `.local/reports/acceptance-oracle-audit-oct27/`，2026-10-27 审计）：
//   core     判据本体只能在真机观测、且频次高 / 丢数据风险高（22 条）；另含 7 条「真栈接线 smoke」
//            ——它们的判据主体已下沉到 visual / Rust，留在核心批只为证明真栈仍把链路接起来
//   full     其余全部场景（含「待下沉」「待拆分」各档）。**`--batch full` 是语义上的全量**：
//            跑全部场景，与不带 `--batch` 逐条相同。分层 MUST NOT 把默认行为静默收窄
//   bundle   `requires: bundle` 的通知点击链路（dev flavour 下物理验不到）——两者必须一一对应
//   evidence 只产出截图 / 读数供人抽审的场景。「跑完归档、不卡门禁」是审计的目标态、**尚未实现**：
//            本模块只做筛选，判定与退出码一字未改（evidence 档失败照样让退出码变 1，见 README
//            「分档只决定跑哪些」）
//
// 闭集合而不是自由标签：拼错一个值（`core` 写成 `Core` / `cores`）会让该场景静默退出所属批次，
// 表现是「批次里悄悄少了一条」，故取值域由本模块单点定义并在 `--check` 里逐场景校验。

/** tier 的闭集合，顺序即 CLI 帮助里的展示顺序。 */
export const TIERS = Object.freeze(["core", "full", "bundle", "evidence"]);

/** 不带 `--batch` 时的批次：全量。改这里等于改 runner 的默认行为，须有裁决。 */
export const DEFAULT_BATCH = "full";

/** 合法的 tier 取值。 */
export function isTier(value) {
  return typeof value === "string" && TIERS.includes(value);
}

function labelOf(scenario) {
  const id = typeof scenario?.id === "string" ? scenario.id.trim() : "";
  if (id) return id;
  if (scenario?.file) return scenario.file.split("/").pop();
  return "（无 id 的场景）";
}

/**
 * 该场景是否属于 `batch`。
 *
 * `full` 对**所有场景**成立（见文件头：全量语义），其余批次按 `tier` 精确匹配。未声明 / 非法 tier
 * 的场景只属于 `full`——判定归 `checkTiers`，筛选在这里不替它兜底，免得「缺标」被筛成绿。
 */
export function batchIncludes(batch, scenario) {
  if (batch === "full") return true;
  return scenario?.tier === batch;
}

/**
 * 按批次筛场景；未知批次抛错（CLI 侧由 `parseBatchArgs` 先挡，这里兜住库调用方）。
 * 返回新数组，保持入参顺序（runner 的跑批顺序 = 场景文件名字典序，不因分批改变）。
 */
export function selectBatch(scenarios, batch) {
  if (!isTier(batch)) {
    throw new Error(`未知批次 ${JSON.stringify(batch)}（可选：${TIERS.join(" / ")}）`);
  }
  return scenarios.filter((scenario) => batchIncludes(batch, scenario));
}

/** 各档条数（只统计合法 tier；缺标 / 非法单独由 `checkTiers` 报）。 */
export function summarizeTiers(scenarios) {
  const counts = Object.fromEntries(TIERS.map((tier) => [tier, 0]));
  for (const scenario of scenarios) if (isTier(scenario?.tier)) counts[scenario.tier] += 1;
  return counts;
}

/**
 * 校验全量场景的 tier 声明，返回问题列表（空 = 通过）。判据：
 *   - `tier` 必填，取值必须在闭集合内；
 *   - `tier: bundle` 与 `requires: bundle` **一一对应**：bundle 批的场景就是那条「dev flavour
 *     下物理验不到」的通知点击链路，两边写法必须同进同退。漏标 tier 的 bundle 场景会被
 *     `--batch bundle` 静默漏掉；只标 tier 而漏写 requires 的场景则失去 dev flavour 下的
 *     INVALID 保护——runner 按 `requires` 判环境（`scenario.requires === "bundle"`），缺它就会
 *     照常跑，产出一串与产品缺陷无法区分的 FAIL。
 */
export function checkTiers(scenarios) {
  const problems = [];
  for (const scenario of scenarios) {
    const label = labelOf(scenario);
    const tier = scenario?.tier;
    if (tier === undefined || tier === null || tier === "") {
      problems.push(`${label}: 缺少 tier（front-matter 必填，取值 ${TIERS.join(" / ")}）`);
      continue;
    }
    if (!isTier(tier)) {
      problems.push(`${label}: tier ${JSON.stringify(tier)} 不在闭集合（${TIERS.join(" / ")}）`);
      continue;
    }
    const requiresBundle = scenario?.requires === "bundle";
    if (tier === "bundle" && !requiresBundle) {
      problems.push(`${label}: tier=bundle 但没写 requires: bundle（bundle 批只收通知点击链路，两者必须一致）`);
    }
    if (tier !== "bundle" && requiresBundle) {
      problems.push(`${label}: 声明了 requires: bundle 但 tier=${tier}（应标 tier: bundle，否则 --batch bundle 漏掉它）`);
    }
  }
  return problems;
}

/**
 * 解析 CLI 参数里的 `--batch`，同时把其余非开关参数（id 前缀 / item 项号）原样收进 `positional`。
 *
 * 为什么解析放在这里而不是 run.mjs 里：`--batch core` 的取值是个裸词，runner 原有的
 * 「非 `--` 开头的参数一律当筛选器」会把 `core` 误当 id 前缀——那是「批次过滤器静默变成 id 筛选」
 * 的假绿形态（批次实际只跑 0 条却报「没有匹配的场景」）。参数形态与筛选语义同住一个纯函数，
 * 才能在 node:test 里钉住。
 *
 * 返回 `{ batch, positional, problems }`：
 *   - `batch` 未指定时为 `DEFAULT_BATCH`（全量），`problems` 非空时调用方 MUST NOT 依赖它；
 *   - `problems` 收「取值不在闭集合」「`--batch` 后面没有取值」「同一命令行给了两个不同批次」。
 */
export function parseBatchArgs(args) {
  const positional = [];
  const problems = [];
  let batch = null;
  const set = (raw, how) => {
    const value = String(raw).trim();
    if (!isTier(value)) {
      problems.push(`${how} 的取值 ${JSON.stringify(value)} 不在闭集合（${TIERS.join(" / ")}）`);
      return;
    }
    if (batch !== null && batch !== value) {
      problems.push(`一次跑批只能给一个批次（已给 ${batch}，又给 ${value}）`);
      return;
    }
    batch = value;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) problems.push("--batch 后面缺少取值");
      else {
        set(value, "--batch");
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--batch=")) {
      set(arg.slice("--batch=".length), "--batch=");
      continue;
    }
    if (arg.startsWith("--")) continue; // 其余开关（--list / --check / --keep-app …）归调用方
    positional.push(arg);
  }
  return { batch: batch ?? DEFAULT_BATCH, positional, problems };
}

/** 筛选词命中场景的三级方式，顺序即优先级。 */
export const MATCH_KINDS = Object.freeze(["id", "item", "prefix"]);

/**
 * 单个筛选词命中该场景的方式（`"id"` / `"item"` / `"prefix"`），不命中回 `null`。
 *
 * 返回的是**这个场景自己的最高级**，跨场景的「哪一级先有命中」由 `selectScenarios` 判。
 * 空串一律算不命中：`id.startsWith("")` 恒真，若在这里放行，一个空参数会把全量场景拉进跑批
 * （与「短 id 意外扩大跑批」同一形态）。
 */
export function matchKind(scenario, filter) {
  const term = String(filter).trim();
  if (!term) return null;
  const id = typeof scenario?.id === "string" ? scenario.id : "";
  if (id === term) return "id";
  if (scenario?.item !== undefined && String(scenario.item) === term) return "item";
  return id.startsWith(term) ? "prefix" : null;
}

/**
 * 按位置参数筛场景：逐词解析，取**第一个有命中的级**的全部命中（三个级之间是优先级，不是并集
 * ——取并集时 `13` 依旧会连上 130–139，等于没修），词与词之间取并集（保持 `scenarios` 顺序，
 * 跑批顺序不因筛选改变）。
 *
 * 解析域是 `scenarios`（调用方传**全量**），结果再与 `pool`（批次池）取交集：筛选词的含义不得
 * 随 `--batch` 漂移。若在池内解析，`--batch core 13` 会因 13-toc 不在核心批而退回前缀级、静默
 * 拉进 130–139——正是本函数要终结的形态。命中但落在池外的场景收进 `outOfBatch`，供调用方在
 * 「筛选结果为空」时报出「命中的都不在批内」。
 *
 * 返回：
 *   - `selected`：与 `pool` 的交集（无筛选词时 = `pool`，与分层前的默认行为逐条相同）
 *   - `byFilter`：`[{ filter, kind, ids }]`，`kind` 为 `null` 表示该词三级全空
 *   - `unmatched`：三级全空的筛选词（原样，已 trim）
 *   - `outOfBatch`：命中但在 `pool` 外的场景 id
 */
export function selectScenarios(scenarios, filters, pool = scenarios) {
  const terms = Array.isArray(filters) ? filters : [];
  if (terms.length === 0) return { selected: [...pool], byFilter: [], unmatched: [], outOfBatch: [] };
  const poolSet = new Set(pool);
  const order = new Map(scenarios.map((s, i) => [s, i]));
  const byFilter = [];
  const unmatched = [];
  const outOfBatch = new Set();
  const picked = new Map();
  for (const raw of terms) {
    const filter = String(raw).trim();
    let kind = null;
    let hits = [];
    for (const candidate of MATCH_KINDS) {
      hits = scenarios.filter((s) => matchKind(s, filter) === candidate);
      if (hits.length) {
        kind = candidate;
        break;
      }
    }
    byFilter.push({ filter, kind, ids: hits.map((s) => s.id) });
    if (!kind) {
      unmatched.push(filter);
      continue;
    }
    for (const s of hits) {
      if (poolSet.has(s)) picked.set(s, order.get(s));
      else outOfBatch.add(s.id);
    }
  }
  const selected = [...picked.keys()].sort((a, b) => picked.get(a) - picked.get(b));
  return { selected, byFilter, unmatched, outOfBatch: [...outOfBatch] };
}
