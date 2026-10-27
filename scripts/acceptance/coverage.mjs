#!/usr/bin/env node
// scripts/acceptance/coverage.mjs —— 验收场景覆盖表的唯一生成器与检查器。
//
// 背景（M690）：`docs/backlog.md` 的「待真机验收」曾用一份手维护的注册表（item 1–96，30 条）记录
// 「哪个验收项由哪些场景覆盖、哪些已机验」。场景已到 231 个、213 个不同 item，注册表既不是完整索引，
// 又是会漂移的第二真源（REVIEW.md「同一语义两处真源」条）。本脚本从场景 front-matter 的
// `id` / `item` / `title` 生成 `scripts/acceptance/COVERAGE.md`——**唯一真源是场景文件本身**，
// 覆盖表只是它的投影，不手改、不另抄一份注册表。
//
// 用法：
//   node scripts/acceptance/coverage.mjs           # 重新生成 COVERAGE.md（结构不合法时拒绝写盘）
//   node scripts/acceptance/coverage.mjs --check   # 只校验、不写盘（docs-check 与 run.mjs --check 调它）
//
// 判据（任一命中即 FAIL）：
//   - 场景 front-matter 缺 `id` / `item` / `title` / `tier`；
//   - `id` 不是合法标识符，或在场景之间重复（`id` 是场景的唯一键，也是 `run.mjs <id 前缀>` 的筛选键）；
//   - `item` 形态非法（只接受正整数，或 `8.12` 这类「项号.子项号」）；
//   - `tier` 不在闭集合 core / full / bundle / evidence（M749），或与 `requires: bundle` 不一致；
//   - COVERAGE.md 里同一 `item` 出现两行（`item` 是覆盖表的行键）；
//   - 覆盖表漏场景 / 多出场景目录里不存在的 id / 同一场景 id 出现两次；
//   - COVERAGE.md 与生成结果不一致（新增、改名、删场景或手改文件后没重新生成）。
//
// **`item` 是分组键，不是场景级唯一键**（tower 2026-10-24 裁决）：同一验收项拆成多个场景文件是既有
// 设计——item 7 = `07-recovery-paths` / `07b-recovery-saveas` / `07c-external-reload` 三条恢复路径，
// item「8.x」同理；`run.mjs 7` 靠 item 选中该项下全部场景。故「重复 item」判在**表**上：一项一行、
// 行内列出该项全部场景；场景之间共用 item 合法。历史编号（含 item 100 / 104 这类无关特性共用同一号
// 的既有碰撞）保持原样，由表本身如实暴露，不在生成器里重编或拆散。
//
// 依赖：node 内置模块 + js-yaml（场景 loader 已依赖），不引新包；场景解析走 lib/execute.mjs 的
// `loadScenario`（与真跑批同一份 YAML / token 口径，不在这里另写一个解析器）。
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario } from "./lib/execute.mjs";
import { checkTiers, isTier, summarizeTiers, TIERS } from "./lib/batches.mjs";
import { envHome, repoRoot, vaultDir } from "./lib/util.mjs";

export const SCENARIOS_DIR = path.join(repoRoot(), "scripts/acceptance/scenarios");
export const COVERAGE_PATH = path.join(repoRoot(), "scripts/acceptance/COVERAGE.md");

/** 场景 id 的字符面：来自文件名（`<项号>-<短名>.md`），要能写进 Markdown 表格的代码跨度里。 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** item 的合法形态：正整数，或「项号.子项号」（`8.1` … `8.23`）。 */
const ITEM_PATTERN = /^\d+(\.\d+)?$/;
/** 缺场景 / 多 id 的报错只列前几个，避免整表为空时刷屏。 */
const LIST_LIMIT = 8;

function labelOf(scenario) {
  const id = typeof scenario?.id === "string" ? scenario.id.trim() : "";
  if (id) return id;
  if (scenario?.file) return path.basename(scenario.file);
  return "（无 id 的场景）";
}

function briefList(values) {
  const sorted = [...values].sort((a, b) => String(a).localeCompare(String(b)));
  if (sorted.length <= LIST_LIMIT) return sorted.join("、");
  return `${sorted.slice(0, LIST_LIMIT).join("、")} 等 ${sorted.length} 个`;
}

/**
 * item → 规范化字符串（`8` / `"8"` / `"08"` 同键；`8.1` / `"8.01"` 同键），非法形态返回 null。
 * 规范化是「表内一项一行」的前提：同一项写成 `8` 与 `"08"` 时若不去重，会生成两行。
 */
export function normalizeItem(item) {
  if (typeof item === "number") {
    return Number.isInteger(item) && item > 0 ? String(item) : null;
  }
  if (typeof item !== "string") return null;
  const s = item.trim();
  if (!ITEM_PATTERN.test(s)) return null;
  const [main, sub] = s.split(".");
  if (Number(main) < 1) return null;
  return sub === undefined ? String(Number(main)) : `${Number(main)}.${Number(sub)}`;
}

/** item 排序：先主项号、再子项号；数字项（8）排在它的子项（8.1）之前。 */
function compareItems(a, b) {
  const [aMain, aSub = "0"] = a.split(".");
  const [bMain, bSub = "0"] = b.split(".");
  return Number(aMain) - Number(bMain) || Number(aSub) - Number(bSub);
}

/**
 * 覆盖表是入 git 的制品、检查是逐字节比对：标题里若带 `$vault` / `$fixtures` / `$env` 这类
 * 运行期 token（`loadScenario` 已替换成绝对路径），生成结果就会随机器变化、CI 上必然假红。
 * 这里按替换后的值反查，命中即判红（标题不该承载运行期路径）。
 *
 * `$env` 必须查 `envHome()` 本身而不能只靠 `repoRoot()` 兜：默认 results root 在仓库内时它确实
 * 被 repoRoot 覆盖，但 `LUMIR_ACCEPTANCE_RESULTS` 指到仓库外时 `$env` 会落到那个外部目录
 * （不同 root 生成不同表，见 coverage.test.mjs 的两 root 反向测试）。
 */
function volatilePathIn(text) {
  return [repoRoot(), vaultDir(), envHome()].find((p) => p && text.includes(p)) ?? null;
}

/** 表格单元格：竖线转义（Markdown 表格的分隔符）、换行折成 `<br>`。 */
function cell(value) {
  return String(value)
    .trim()
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

/**
 * 从已加载的场景生成覆盖表。
 * 返回 `{ markdown, problems, items }`：`problems` 非空时调用方 MUST NOT 写盘（表会缺行）。
 */
export function buildCoverage(scenarios) {
  // tier 的闭集合 / 缺标 / 与 `requires: bundle` 的一致性（M749）由 batches.mjs 单点判——批次筛选
  // 与覆盖表用的是同一套声明校验，两处各判一遍必然漂移（REVIEW.md「同一语义两处真源」条）。
  // 放在这里是因为「表里多一列 tier」与「声明必须合法」是同一件事：缺标就没有可渲染的单元格。
  const problems = checkTiers(scenarios);
  const idOwners = new Map();
  const items = new Map();

  for (const scenario of scenarios) {
    const label = labelOf(scenario);
    const id = typeof scenario.id === "string" ? scenario.id.trim() : "";
    const title = typeof scenario.title === "string" ? scenario.title.trim() : "";
    const item = normalizeItem(scenario.item);
    const tier = isTier(scenario.tier) ? scenario.tier : String(scenario.tier ?? "?");

    if (scenario.idDeclared === false || id === "") problems.push(`${label}: 缺少 id（front-matter 必填）`);
    else if (!ID_PATTERN.test(id)) problems.push(`${label}: id '${id}' 形态非法（只允许字母 / 数字 / . _ -）`);

    if (scenario.item === undefined || scenario.item === null) problems.push(`${label}: 缺少 item`);
    else if (item === null) {
      problems.push(`${label}: item ${JSON.stringify(scenario.item)} 形态非法（只接受正整数或 8.12 形态）`);
    }

    if (title === "") problems.push(`${label}: 缺少 title`);
    else if (volatilePathIn(title)) {
      problems.push(`${label}: title 含运行期绝对路径（$vault / $fixtures / $env 之类的 token）——覆盖表入 git，标题必须机器无关`);
    }

    if (id !== "") {
      const owners = idOwners.get(id) ?? [];
      owners.push(scenario.file ? path.basename(scenario.file) : label);
      idOwners.set(id, owners);
    }

    // 三个字段齐全才进表：缺一个就无法定位 / 无法阅读，宁可整份生成失败也不产出缺行索引。
    if (!id || !ID_PATTERN.test(id) || item === null || !title) continue;
    const row = items.get(item) ?? { item, entries: [] };
    row.entries.push({ id, title, tier });
    items.set(item, row);
  }

  for (const [id, owners] of idOwners) {
    if (owners.length > 1) problems.push(`id '${id}' 重复：${owners.join("、")}（id 是场景唯一键）`);
  }

  const rows = [...items.values()]
    .sort((a, b) => compareItems(a.item, b.item))
    .map((row) => ({ item: row.item, entries: [...row.entries].sort((a, b) => a.id.localeCompare(b.id)) }));

  const markdown = renderCoverage(rows, scenarios.length);
  return { markdown, problems, items: rows };
}

function renderCoverage(rows, scenarioCount) {
  const lines = [
    "# 验收场景覆盖表（自动生成，勿手改）",
    "",
    "<!-- 生成：node scripts/acceptance/coverage.mjs　　校验：同一命令加 --check",
    "     （挂在 scripts/docs-check.sh 与 node scripts/acceptance/run.mjs --check 上）",
    "     唯一真源 = scripts/acceptance/scenarios/*.md 的 front-matter（id / item / title / tier）。 -->",
    "",
    `- 场景：${scenarioCount}`,
    `- 验收项（不同 item 编号）：${rows.length}`,
    ...tierSummaryLines(rows),
    "",
    "`item` 是验收项号，也是 `node scripts/acceptance/run.mjs <item>` 的筛选键。一个验收项拆成多个场景",
    "文件是既有设计（如 item 7 = `07` / `07b` / `07c` 三条恢复路径），故表里一项一行、行内列出全部场景；",
    "同一 item 出现在两行才会判红。`tier` 是场景所属批次（闭集合 core / full / bundle / evidence），",
    "`node scripts/acceptance/run.mjs --batch <档>` 按它筛；`full` 是语义上的**全量**（含其余各档），",
    "故 `--batch full` 与不带 `--batch` 跑的是同一批场景。本表是**场景清单**，不是验收结论——每个场景的真实 PASS",
    "证据在 `.local/acceptance/<批次>/`（git 外），未收口的行为限制与待 dogfood 项在 `docs/backlog.md`",
    "「待真机验收」节。",
    "",
    "| item | 场景 | 标题 | tier |",
    "| ---: | --- | --- | --- |",
  ];
  for (const { item, entries } of rows) {
    const ids = entries.map((e) => `\`${e.id}\``).join("<br>");
    const titles = entries.map((e) => cell(e.title)).join("<br>");
    const tiers = entries.map((e) => e.tier).join("<br>");
    lines.push(`| ${item} | ${ids} | ${titles} | ${tiers} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** 表头的分档条数（与 `run.mjs --check` 打印的那一行同源：都走 batches.mjs 的 summarizeTiers）。 */
function tierSummaryLines(rows) {
  const counts = summarizeTiers(rows.flatMap((row) => row.entries));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return [
    `- 分档：${TIERS.map((tier) => `${tier} ${counts[tier]}`).join(" / ")}` +
      `（full 批 = 全部 ${total} 个，含其余各档）`,
  ];
}

/** 表格数据行按单元格拆（跳过表头与分隔行；`\|` 是转义过的竖线，不作分隔）。 */
function splitRow(line) {
  const cells = line.split(/(?<!\\)\|/);
  if (cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells;
}

/**
 * 从 COVERAGE.md 文本里解析覆盖表（制品层，不信任生成器内存里的 rows）。
 * 返回 `{ rows: [{ item, ids, tiers }], problems }`。
 *
 * 列序固定为 `| item | 场景 | 标题 | tier |`（M749 在末尾追加 tier 列，前三列不变），故 item / ids
 * 的取法与旧表逐字相同；tier 列按闭集合逐格校验——手改成不存在的档名时点名单行，而不是只留下
 * 一句「与 front-matter 不一致」让人自己找。
 */
export function parseCoverageTable(text) {
  const rows = [];
  const problems = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("|")) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      // 表格以表头之后的分隔行为起点：`| ---: | --- | --- | --- |`。
      if (/^\|\s*:?-{3,}/.test(line.trimStart())) inTable = true;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length < 2) {
      problems.push(`无法解析的表格行：${line.trim()}`);
      continue;
    }
    const item = cells[0].trim();
    const ids = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (item === "" || ids.length === 0) {
      problems.push(`表格行列缺失（item='${item}'，场景 id 读不到）：${line.trim()}`);
      continue;
    }
    const tiers = (cells[3] ?? "")
      .split("<br>")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tiers.length === 0) {
      problems.push(`表格行缺 tier 列（item=${item}）：${line.trim()}——表头是 | item | 场景 | 标题 | tier |`);
    } else if (tiers.length !== ids.length) {
      problems.push(`表格行 tier 与场景数不符（item=${item}：${ids.length} 个场景 / ${tiers.length} 个 tier）`);
    } else {
      const bad = tiers.filter((t) => !isTier(t));
      if (bad.length) {
        problems.push(`表格行 tier 取值非法（item=${item}）：${bad.join("、")}——闭集合 ${TIERS.join(" / ")}`);
      }
    }
    rows.push({ item, ids, tiers });
  }
  if (rows.length === 0) problems.push("没有找到覆盖表数据行（表头或表格缺失）");
  return { rows, problems };
}

/**
 * 校验一份 COVERAGE.md 文本（纯函数，测试与 CLI 共用）。
 * `text === null` 表示文件不存在。
 */
export function checkCoverageText(scenarios, text, label = "COVERAGE.md") {
  const { markdown, problems, items } = buildCoverage(scenarios);
  const out = [...problems];

  if (text === null) {
    out.push(`${label} 不存在：运行 node scripts/acceptance/coverage.mjs 生成`);
    return out;
  }

  // 先判制品自身的结构：生成器回归或手改都能被点名（字节比对只说「不一致」，说不出哪里重复）。
  const parsed = parseCoverageTable(text);
  out.push(...parsed.problems.map((p) => `${label}: ${p}`));

  const itemRows = new Map();
  for (const row of parsed.rows) itemRows.set(row.item, (itemRows.get(row.item) ?? 0) + 1);
  for (const [item, count] of itemRows) {
    if (count > 1) out.push(`${label}: item ${item} 出现了 ${count} 行——一项一行，同一项的多场景写在同一条记录里`);
  }

  const idCounts = new Map();
  for (const row of parsed.rows) for (const id of row.ids) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) out.push(`${label}: 场景 id '${id}' 出现了 ${count} 次——一个场景只能被覆盖一次`);
  }

  const expectedIds = new Set();
  for (const { entries } of items) for (const e of entries) expectedIds.add(e.id);
  const listedIds = new Set(idCounts.keys());
  const missing = [...expectedIds].filter((id) => !listedIds.has(id));
  const extra = [...listedIds].filter((id) => !expectedIds.has(id));
  if (missing.length) out.push(`${label}: 漏掉 ${missing.length} 个场景：${briefList(missing)}`);
  if (extra.length) out.push(`${label}: 含场景目录里不存在的 id：${briefList(extra)}`);

  if (text !== markdown) {
    out.push(`${label}: 与场景 front-matter 不一致（新增 / 改名 / 删除场景后未重新生成，或文件被手改）：运行 node scripts/acceptance/coverage.mjs`);
  }
  return out;
}

/** 加载目录下的全部场景（与真跑批同一份 loader）。 */
export async function loadScenarios(dir = SCENARIOS_DIR) {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  return Promise.all(names.map((n) => loadScenario(path.join(dir, n))));
}

/** 校验磁盘上的 COVERAGE.md；返回问题清单（空数组 = 通过）。 */
export async function checkCoverage({ scenarios, coveragePath = COVERAGE_PATH } = {}) {
  const list = scenarios ?? (await loadScenarios());
  let text = null;
  try {
    text = await readFile(coveragePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const label = path.relative(repoRoot(), coveragePath) || coveragePath;
  return checkCoverageText(list, text, label);
}

async function main() {
  const check = process.argv.includes("--check");
  const scenarios = await loadScenarios();
  // 分档条数（M749）：PASS 行里带上它，`--batch` 各档「该跑多少条」在同一条命令上可对账。
  const tierLine = (() => {
    const counts = summarizeTiers(scenarios);
    return `${TIERS.map((tier) => `${tier} ${counts[tier]}`).join(" / ")}（full = 全部 ${scenarios.length} 个）`;
  })();

  if (check) {
    const problems = await checkCoverage({ scenarios });
    if (problems.length) {
      console.error("COVERAGE FAIL");
      for (const p of problems) console.error(`  ✗ ${p}`);
      process.exit(1);
    }
    const { items } = buildCoverage(scenarios);
    console.log(`COVERAGE PASS（${scenarios.length} 个场景 / ${items.length} 个 item，与 COVERAGE.md 一致）`);
    console.log(`分档：${tierLine}`);
    return;
  }

  const { markdown, problems, items } = buildCoverage(scenarios);
  if (problems.length) {
    console.error("COVERAGE FAIL：场景 front-matter 不合法，未写盘");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  await writeFile(COVERAGE_PATH, markdown);
  console.log(`COVERAGE WRITE（${scenarios.length} 个场景 / ${items.length} 个 item）→ ${path.relative(repoRoot(), COVERAGE_PATH)}`);
  console.log(`分档：${tierLine}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
