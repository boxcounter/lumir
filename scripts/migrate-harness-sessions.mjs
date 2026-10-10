#!/usr/bin/env node
// 一次性归位脚本（change `harness-sessions-per-vault`，Alex 裁决 2026-10-10）：
// 「迁移不用写进产品里，写一个脚本执行。一次性的工作就不进入产品了。」
//
// 做什么：把 `<config_dir>/harness/sessions/` **根下**平铺的 `<session_id>.jsonl`（旧布局，
// 平铺）按各文件首行 `session_open.vault_root` 归位到 `sessions/<vault 稳定 id>/`；搬不动的
// （首行不可读 / 非 session_open / vault_root 相对或缺失 / 注册表里没有该路径 / 目标已有同名文件）
// 移入保留目录 `sessions/_orphaned/`。只 `rename`——**不改写、不删除任何文件**（留存是审计事实）。
//
// 纪律：
// - **产品运行时零迁移代码**：本脚本不进 `src-tauri/`、不挂 app 启动，手动执行一次即弃；
//   之后产品只读新布局（`sessions/<id>/`），根下残留不参与列举 / 恢复 / 删除。
// - **幂等**：重复执行零搬运（根下没有 `*.jsonl` 时什么都不做）；单文件失败只留原地并自报，
//   重跑脚本收敛到「根下零 `*.jsonl`」。
// - **零环境变量扰动**：配置目录按参数注入（缺省按 XDG 规则推导），测试与验收全程对合成目录跑，
//   不碰真实的 `~/.config/lumir`（REVIEW.md 第 13 条）。
//
// 用法（在 app 未运行时执行一次）：
//   node scripts/migrate-harness-sessions.mjs [config_dir]
// 退出码：0 = 无失败；1 = 有文件搬运失败（留原地，重跑；其余文件已尽力归位）。
//
// 身份与判据：目录名取 vault 注册表 id（`vault-registry/<id>.json` 的 `id` 字段，
// 与 `vault-sessions/<id>.json` / `reading-positions/<id>.json` 同一份身份）；路径匹配按
// **规范化后的字符串**（与产品 `Path::canonicalize().unwrap_or(原样)` 同语义——macOS 的
// `/tmp` 是 `/private/tmp` 的软链接，不对齐这一步就匹配不上注册表）。本脚本**不复用产品代码**、
// 不改注册表、不登记新 id。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 保留目录名（与产品侧 `harness::jsonl::ORPHANED_DIR_NAME` 同名——目录形态的单一真源是
 *  「这个保留名」本身，两处都只是它的字面量；改名字面量时两边一起改）。 */
export const ORPHANED_DIR_NAME = "_orphaned";

const SESSIONS_REL = path.join("harness", "sessions");
const REGISTRY_REL = "vault-registry";

/** 注册表 id 的形态校验（与产品 `vault_registry::valid_id` 同口径：id 同时是目录名 /
 *  文件名，因此这是路径逃逸防护——`..`、路径分隔符一律拒）。 */
export function validId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    Buffer.byteLength(id, "utf8") <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(id)
  );
}

/** 路径规范化（与产品 `Path::canonicalize().unwrap_or_else(|_| 原样)` 同语义）：realpath 失败
 *  （卷未挂载 / 路径不存在）即原样返回——「规范化不了」不等于「没有这个 vault」。 */
export function defaultNormalize(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 读注册表：`<config_dir>/vault-registry/*.json` → `Map<规范化路径, id>`。
 *
 * 容错口径与产品读注册表同一条：读不出 / JSON 非法的项跳过（产品 `read_entry_file` 的
 * `unwrap_or_default` + `ok()`）；id 形态非法的项也跳过（它不可能是产品产出的目录名）。
 * 同一路径多条注册项时取字典序第一条（确定性；产品侧 `find_by_path` 遇到重复项同样先到先得）。
 */
export function loadRegistry(configDir, { normalize = defaultNormalize } = {}) {
  const byPath = new Map();
  const dir = path.join(configDir, REGISTRY_REL);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return byPath; // 无注册表目录：所有文件都判不可归属（进 _orphaned）
  }
  for (const name of names.slice().sort()) {
    if (!name.endsWith(".json")) continue;
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!entry || typeof entry.id !== "string" || typeof entry.path !== "string") continue;
    if (!validId(entry.id) || entry.id === ORPHANED_DIR_NAME) continue;
    const key = normalize(entry.path);
    if (!byPath.has(key)) byPath.set(key, entry.id);
  }
  return byPath;
}

/**
 * 单文件的归属判定（纯函数；`registry` 是 `Map<规范化路径, id>`）：
 * `{ kind: "vault", id }` 或 `{ kind: "orphaned", reason }`。
 *
 * `normalize` 可注入——**反向验证**用（去掉规范化一步必须让需规范化的输入落入 `_orphaned`，
 * 证明这一步是承重的，REVIEW.md 第 1 条）。
 */
export function planMove(firstLine, registry, { normalize = defaultNormalize } = {}) {
  const line = String(firstLine ?? "")
    .split("\n")[0]
    .trim();
  if (!line) return { kind: "orphaned", reason: "首行为空" };
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    return { kind: "orphaned", reason: "首行不是合法 JSON" };
  }
  const payload = envelope?.payload;
  if (payload?.kind !== "session_open") {
    return { kind: "orphaned", reason: `首行不是 session_open（${payload?.kind ?? "无 payload"}）` };
  }
  const vaultRoot = payload.vault_root;
  if (typeof vaultRoot !== "string" || vaultRoot.length === 0) {
    return { kind: "orphaned", reason: "vault_root 缺失或非字符串" };
  }
  // 相对路径直接判不可归属：它依赖脚本进程的 cwd，规范化会把「当前目录」卷进来（design §6）。
  if (!path.isAbsolute(vaultRoot)) {
    return { kind: "orphaned", reason: `vault_root 是相对路径（${vaultRoot}）` };
  }
  const normalized = normalize(vaultRoot);
  const id = registry.get(normalized);
  if (!id) return { kind: "orphaned", reason: `注册表无该路径（${normalized}）` };
  if (!validId(id) || id === ORPHANED_DIR_NAME) {
    return { kind: "orphaned", reason: `注册表 id 不可作目录名（${id}）` };
  }
  return { kind: "vault", id };
}

/**
 * 扫 `<config_dir>/harness/sessions/` 根下的 `*.jsonl` 并归位（目录条目一律不动——它们已是
 * 新布局）。返回计数报告；逐文件失败只留原地、计入 `failed` 并自报（调用方据此定退出码）。
 */
export function migrate(configDir, { normalize = defaultNormalize, log = () => {} } = {}) {
  const sessionsRoot = path.join(configDir, SESSIONS_REL);
  const registry = loadRegistry(configDir, { normalize });
  const report = { moved: 0, orphaned: 0, failed: 0, dirsSkipped: 0, filesSkipped: 0, movedTo: {} };
  let entries;
  try {
    entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    log(`无 ${sessionsRoot}：没有可归位的平铺文件`);
    return report;
  }
  for (const entry of entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      report.dirsSkipped += 1;
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) {
      report.filesSkipped += 1;
      continue;
    }
    const src = path.join(sessionsRoot, entry.name);
    let plan;
    try {
      plan = planMove(fs.readFileSync(src, "utf8"), registry, { normalize });
    } catch (e) {
      plan = { kind: "orphaned", reason: `不可读（${e.message}）` };
    }
    // 目标冲突：vault 目录里已有同名文件 → 不覆盖（留存是审计事实，归属歧义下宁可不动），
    // 改判孤儿桶。孤儿桶里也有同名时才真的搬不动（留原地自报）。
    if (plan.kind === "vault" && fs.existsSync(path.join(sessionsRoot, plan.id, entry.name))) {
      plan = { kind: "orphaned", reason: `目标已有同名文件（${plan.id}/${entry.name}）` };
    }
    const dirName = plan.kind === "vault" ? plan.id : ORPHANED_DIR_NAME;
    const targetDir = path.join(sessionsRoot, dirName);
    const dst = path.join(targetDir, entry.name);
    if (fs.existsSync(dst)) {
      report.failed += 1;
      log(`✗ ${entry.name}：${dirName}/ 已有同名文件，留原地待人工处置`);
      continue;
    }
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.renameSync(src, dst);
    } catch (e) {
      report.failed += 1;
      log(`✗ ${entry.name}：搬运失败（${e.message}），留原地（重跑脚本收敛）`);
      continue;
    }
    if (plan.kind === "vault") {
      report.moved += 1;
      report.movedTo[plan.id] = (report.movedTo[plan.id] ?? 0) + 1;
      log(`→ ${entry.name} 归位到 ${plan.id}/`);
    } else {
      report.orphaned += 1;
      log(`→ ${entry.name} 进 ${ORPHANED_DIR_NAME}/（${plan.reason}）`);
    }
  }
  return report;
}

/** 配置目录的缺省推导（与 app 同口径：`$XDG_CONFIG_HOME/lumir`，无则 `~/.config/lumir`）。 */
export function defaultConfigDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "lumir");
}

function main(argv) {
  const configDir = argv[0] ? path.resolve(argv[0]) : defaultConfigDir();
  console.log(`一次性归位脚本（harness-sessions-per-vault）：配置目录 ${configDir}`);
  const report = migrate(configDir, { log: (line) => console.log(line) });
  console.log(
    `完成：归位 ${report.moved}，孤儿桶 ${report.orphaned}，失败留原地 ${report.failed}` +
      `（跳过目录 ${report.dirsSkipped}，非 jsonl 文件 ${report.filesSkipped}）`,
  );
  if (report.failed) {
    console.error(`✗ 有 ${report.failed} 个文件搬运失败：已留原地，重跑本脚本收敛。`);
  }
  return report.failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
