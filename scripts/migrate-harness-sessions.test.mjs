// scripts/migrate-harness-sessions.test.mjs —— 一次性归位脚本的测试（node:test，零新增依赖）。
//
// 为什么与脚本同址（而不是 tests/unit/）：脚本本身是一次性制品（change
// `harness-sessions-per-vault` 裁决点 2：执行一次即弃、不进产品运行时），它的测试同生共死。
// 跑法（gate 不含本文件——一次性脚本不进常驻门禁）：
//   node --test scripts/migrate-harness-sessions.test.mjs
//
// 纪律（REVIEW.md 第 13 条）：全程对合成配置目录跑，**不碰** `~/.config/lumir`；不依赖真实
// 路径拼写，vault 用测试自己建的临时目录（含一条 symlink，给「需规范化」的输入一个确定的现场）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  ORPHANED_DIR_NAME,
  defaultNormalize,
  loadRegistry,
  migrate,
  planMove,
  validId,
} from "./migrate-harness-sessions.mjs";

const SCRIPT = fileURLToPath(new URL("./migrate-harness-sessions.mjs", import.meta.url));

function tmpRoot(name) {
  const dir = path.join(os.tmpdir(), `lumir-migrate-${name}-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const configDir = (root) => path.join(root, "lumir");
const sessionsRoot = (root) => path.join(configDir(root), "harness", "sessions");
const registryDir = (root) => path.join(configDir(root), "vault-registry");

function writeRegistry(root, entries) {
  fs.mkdirSync(registryDir(root), { recursive: true });
  for (const e of entries) {
    fs.writeFileSync(
      path.join(registryDir(root), `${e.id}.json`),
      `${JSON.stringify({ id: e.id, path: e.path, missing_since: null }, null, 2)}\n`,
    );
  }
}

/** 合成一份平铺的会话留存（首行 session_open）；`raw` 给了就原样落盘（畸形现场用）。 */
function writeFlat(root, name, { vaultRoot, raw = null } = {}) {
  fs.mkdirSync(sessionsRoot(root), { recursive: true });
  const content =
    raw ??
    `${JSON.stringify({
      ts: 1759912000,
      payload: {
        kind: "session_open",
        session_id: name.replace(/\.jsonl$/, ""),
        vault_root: vaultRoot,
        opened_from: "new",
        provider: "mock",
        model: "mock-model",
        thinking: "high",
        system: "S",
        assembly: [],
      },
    })}\n`;
  fs.writeFileSync(path.join(sessionsRoot(root), name), content);
  return content;
}

const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rootJsonl = (root) =>
  fs.existsSync(sessionsRoot(root))
    ? fs.readdirSync(sessionsRoot(root)).filter((n) => n.endsWith(".jsonl")).sort()
    : [];
const dirEntries = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);

test("validId 与产品 vault_registry::valid_id 同口径（id 同时是目录名）", () => {
  for (const ok of ["vault-1000-1", "acc-a", "_x", "A1_b-c"]) assert.ok(validId(ok), ok);
  for (const bad of ["", "..", "a/b", "a.b", "a b", "-".repeat(129), null, 42]) {
    assert.ok(!validId(bad), JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// 归位正确性（任意 session_open 首行 → 预期位置）
// ---------------------------------------------------------------------------

test("归位正确性：需规范化的拼写（symlink）命中的仍是同一个 vault 目录", (t) => {
  const root = tmpRoot("plan-normalize");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const link = path.join(root, "link-vault");
  fs.symlinkSync(vault, link);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);

  const registry = loadRegistry(configDir(root));
  assert.equal(registry.get(defaultNormalize(vault)), "vault-1000-1");
  // 现场自证：两种拼写的字符串**不相等**，命中只可能来自规范化这一步（REVIEW.md 第 1 条：
  // 判据必须有区分度）。
  assert.notEqual(link, vault);
  assert.deepEqual(planMove(`{"payload":{"kind":"session_open","vault_root":${JSON.stringify(link)}}}`, registry), {
    kind: "vault",
    id: "vault-1000-1",
  });
});

test("归位正确性：畸形 / 不可归属的输入逐条判孤儿（含原因）", (t) => {
  const root = tmpRoot("plan-orphan");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  const registry = loadRegistry(configDir(root));

  const cases = [
    ["空首行", "", /首行为空/],
    ["非 JSON", "{ 不是 JSON", /不是合法 JSON/],
    ["无 payload", '{"ts":1}', /不是 session_open/],
    ["非 session_open", '{"payload":{"kind":"llm_request"}}', /不是 session_open/],
    ["vault_root 缺失", '{"payload":{"kind":"session_open"}}', /vault_root 缺失/],
    ["vault_root 非字符串", '{"payload":{"kind":"session_open","vault_root":42}}', /vault_root 缺失/],
    ["vault_root 空串", '{"payload":{"kind":"session_open","vault_root":""}}', /vault_root 缺失/],
    [
      "vault_root 相对路径",
      '{"payload":{"kind":"session_open","vault_root":"some/vault"}}',
      /相对路径/,
    ],
    [
      "注册表无该路径",
      `{"payload":{"kind":"session_open","vault_root":${JSON.stringify(path.join(root, "other-vault"))}}}`,
      /注册表无该路径/,
    ],
  ];
  for (const [what, line, reason] of cases) {
    const plan = planMove(line, registry);
    assert.equal(plan.kind, "orphaned", `${what} 应判孤儿`);
    assert.match(plan.reason, reason, `${what} 的原因`);
  }
});

test("归位正确性：注册表 id 不可作目录名（_orphaned）时判孤儿", () => {
  const registry = new Map([["/x/vault", ORPHANED_DIR_NAME]]);
  const plan = planMove('{"payload":{"kind":"session_open","vault_root":"/x/vault"}}', registry);
  assert.equal(plan.kind, "orphaned");
  assert.match(plan.reason, /不可作目录名/);
});

// ---------------------------------------------------------------------------
// 整目录归位：终态、字节不变、幂等、孤儿桶
// ---------------------------------------------------------------------------

test("整目录归位：终态根下零 *.jsonl、字节不变、不可归属进孤儿桶、目录与非 jsonl 不动", (t) => {
  const root = tmpRoot("migrate-tree");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vaultA = path.join(root, "vault-a");
  const vaultB = path.join(root, "vault-b");
  fs.mkdirSync(vaultA);
  fs.mkdirSync(vaultB);
  writeRegistry(root, [
    { id: "vault-1000-1", path: vaultA },
    { id: "vault-1000-2", path: vaultB },
  ]);
  // 两条可归属（A 的用 symlink 拼写，需规范化）+ 三条不可归属 + 一条非 jsonl + 一个已是新布局的目录。
  const linkA = path.join(root, "link-a");
  fs.symlinkSync(vaultA, linkA);
  const contents = new Map();
  contents.set("s1759912000-aaaaaa.jsonl", writeFlat(root, "s1759912000-aaaaaa.jsonl", { vaultRoot: linkA }));
  contents.set("s1759912005-bbbbbb.jsonl", writeFlat(root, "s1759912005-bbbbbb.jsonl", { vaultRoot: vaultB }));
  contents.set("s1759912010-cccccc.jsonl", writeFlat(root, "s1759912010-cccccc.jsonl", { vaultRoot: "/nowhere" }));
  contents.set("s1759912015-dddddd.jsonl", writeFlat(root, "s1759912015-dddddd.jsonl", { raw: "{ 不是 JSON\n" }));
  contents.set(
    "s1759912020-eeeeee.jsonl",
    writeFlat(root, "s1759912020-eeeeee.jsonl", { vaultRoot: "relative/vault" }),
  );
  fs.writeFileSync(path.join(sessionsRoot(root), "notes.txt"), "非 jsonl\n");
  fs.mkdirSync(path.join(sessionsRoot(root), "vault-9999-1"), { recursive: true });
  fs.writeFileSync(path.join(sessionsRoot(root), "vault-9999-1", "s1759912099-ffffff.jsonl"), "已在新布局\n");

  const report = migrate(configDir(root));
  assert.equal(report.moved, 2, JSON.stringify(report));
  assert.equal(report.orphaned, 3);
  assert.equal(report.failed, 0);
  assert.deepEqual(report.movedTo, { "vault-1000-1": 1, "vault-1000-2": 1 });
  // 终态：根下零 *.jsonl（唯一例外是 rename 失败留原地者，本例无）；目录与非 jsonl 文件不动。
  assert.deepEqual(rootJsonl(root), [], "根下必须零 *.jsonl");
  assert.deepEqual(dirEntries(sessionsRoot(root)), [
    ORPHANED_DIR_NAME,
    "notes.txt",
    "vault-1000-1",
    "vault-1000-2",
    "vault-9999-1",
  ]);
  // 字节不变（rename 只换位置）。
  assert.equal(sha(path.join(sessionsRoot(root), "vault-1000-1", "s1759912000-aaaaaa.jsonl")),
    createHash("sha256").update(contents.get("s1759912000-aaaaaa.jsonl")).digest("hex"));
  assert.equal(sha(path.join(sessionsRoot(root), "vault-1000-2", "s1759912005-bbbbbb.jsonl")),
    createHash("sha256").update(contents.get("s1759912005-bbbbbb.jsonl")).digest("hex"));
  // 孤儿桶内容：三条不可归属，且不可归属者不进任何 vault 目录。
  assert.deepEqual(dirEntries(path.join(sessionsRoot(root), ORPHANED_DIR_NAME)), [
    "s1759912010-cccccc.jsonl",
    "s1759912015-dddddd.jsonl",
    "s1759912020-eeeeee.jsonl",
  ]);
  assert.equal(sha(path.join(sessionsRoot(root), ORPHANED_DIR_NAME, "s1759912015-dddddd.jsonl")),
    createHash("sha256").update(contents.get("s1759912015-dddddd.jsonl")).digest("hex"));
  // 已在新布局的文件不动。
  assert.equal(
    fs.readFileSync(path.join(sessionsRoot(root), "vault-9999-1", "s1759912099-ffffff.jsonl"), "utf8"),
    "已在新布局\n",
  );

  // 幂等：二次运行零搬运、零孤儿、零失败；目录树逐项不变。
  const before = JSON.stringify(dirEntries(sessionsRoot(root)));
  const second = migrate(configDir(root));
  assert.deepEqual(
    { moved: second.moved, orphaned: second.orphaned, failed: second.failed },
    { moved: 0, orphaned: 0, failed: 0 },
  );
  assert.equal(JSON.stringify(dirEntries(sessionsRoot(root))), before);
  assert.deepEqual(dirEntries(path.join(sessionsRoot(root), "vault-1000-1")), ["s1759912000-aaaaaa.jsonl"]);
});

test("整目录归位：目标已有同名文件时不覆盖，改判孤儿桶（留存的成对不变量优先）", (t) => {
  const root = tmpRoot("migrate-collision");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  const name = "s1759912000-aaaaaa.jsonl";
  const flat = writeFlat(root, name, { vaultRoot: vault });
  // 新布局里已有一份同名文件（模拟「脚本跑过一半 / 手工拷贝」）。
  fs.mkdirSync(path.join(sessionsRoot(root), "vault-1000-1"), { recursive: true });
  fs.writeFileSync(path.join(sessionsRoot(root), "vault-1000-1", name), "已存在的目标\n");

  const report = migrate(configDir(root));
  assert.equal(report.moved, 0);
  assert.equal(report.orphaned, 1);
  assert.equal(report.failed, 0);
  assert.deepEqual(rootJsonl(root), []);
  // 目标未被覆盖，平铺那份进孤儿桶、字节不变。
  assert.equal(fs.readFileSync(path.join(sessionsRoot(root), "vault-1000-1", name), "utf8"), "已存在的目标\n");
  assert.equal(fs.readFileSync(path.join(sessionsRoot(root), ORPHANED_DIR_NAME, name), "utf8"), flat);
});

test("整目录归位：搬运失败留原地并自报，重跑收敛（退出码据此为 1）", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("以 root 运行时目录权限拦不住 rename，本用例无现场");
    return;
  }
  const root = tmpRoot("migrate-fail");
  t.after(() => {
    const dir = path.join(sessionsRoot(root), "vault-1000-1");
    if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  writeFlat(root, "s1759912000-aaaaaa.jsonl", { vaultRoot: vault });
  const target = path.join(sessionsRoot(root), "vault-1000-1");
  fs.mkdirSync(target, { recursive: true });
  fs.chmodSync(target, 0o500); // 只读：rename 进不去

  const lines = [];
  const report = migrate(configDir(root), { log: (l) => lines.push(l) });
  assert.equal(report.failed, 1);
  assert.equal(report.moved, 0);
  assert.deepEqual(rootJsonl(root), ["s1759912000-aaaaaa.jsonl"], "失败者留原地");
  assert.ok(lines.some((l) => l.includes("搬运失败")), `自报缺失败行：${lines.join("\n")}`);

  // 重跑（权限恢复后）收敛到根下零 *.jsonl。
  fs.chmodSync(target, 0o755);
  const again = migrate(configDir(root));
  assert.equal(again.moved, 1);
  assert.equal(again.failed, 0);
  assert.deepEqual(rootJsonl(root), []);
  assert.deepEqual(dirEntries(target), ["s1759912000-aaaaaa.jsonl"]);
});

// ---------------------------------------------------------------------------
// 反向验证（REVIEW.md 第 1 条：先造一个必须让它 FAIL 的输入）
// ---------------------------------------------------------------------------

test("反向验证：去掉规范化一步，需规范化的输入必进孤儿桶（规范化是承重的）", (t) => {
  const root = tmpRoot("rev-normalize");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  const link = path.join(root, "link-vault");
  fs.symlinkSync(vault, link);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  const registry = loadRegistry(configDir(root));
  const line = `{"payload":{"kind":"session_open","vault_root":${JSON.stringify(link)}}}`;

  // 正向（真实现）：命中。
  assert.deepEqual(planMove(line, registry), { kind: "vault", id: "vault-1000-1" });
  // 反向（把规范化换成恒等映射 = 「去掉这一步」）：同一输入变孤儿 ⇒ 正向用例的断言必红。
  const identity = planMove(line, registry, { normalize: (p) => p });
  assert.equal(identity.kind, "orphaned", "去掉规范化后仍命中 ⇒ 正向用例没有区分度");
  assert.match(identity.reason, /注册表无该路径/);
});

test("反向验证：归属映射写错（错 id / 错路径）时，正向断言必红", (t) => {
  const root = tmpRoot("rev-mapping");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  const other = path.join(root, "vault-other");
  fs.mkdirSync(vault);
  fs.mkdirSync(other);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  const line = `{"payload":{"kind":"session_open","vault_root":${JSON.stringify(vault)}}}`;
  // ① 映射到错 id：正向断言「落在 vault-1000-1」必须不成立。
  const wrongId = planMove(line, new Map([[defaultNormalize(vault), "vault-9999-9"]]));
  assert.equal(wrongId.kind, "vault");
  assert.notEqual(wrongId.id, "vault-1000-1");
  // ② 映射到错路径：同一份首行判孤儿 ⇒ 「归位到该 vault」的断言必红。
  const wrongPath = planMove(line, new Map([[defaultNormalize(other), "vault-1000-1"]]));
  assert.equal(wrongPath.kind, "orphaned");
});

// ---------------------------------------------------------------------------
// 命令行入口（真跑一次：脚本被当制品用的时候走的是这条路径）
// ---------------------------------------------------------------------------

test("命令行入口：node scripts/migrate-harness-sessions.mjs <config_dir> 归位并报计数", (t) => {
  const root = tmpRoot("cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault);
  writeRegistry(root, [{ id: "vault-1000-1", path: vault }]);
  writeFlat(root, "s1759912000-aaaaaa.jsonl", { vaultRoot: vault });
  writeFlat(root, "s1759912010-cccccc.jsonl", { vaultRoot: path.join(root, "nowhere") });

  const out = execFileSync(process.execPath, [SCRIPT, configDir(root)], { encoding: "utf8" });
  assert.match(out, /归位 1/);
  assert.match(out, /孤儿桶 1/);
  assert.match(out, /失败留原地 0/);
  assert.deepEqual(rootJsonl(root), []);
  assert.deepEqual(dirEntries(path.join(sessionsRoot(root), "vault-1000-1")), ["s1759912000-aaaaaa.jsonl"]);
  assert.deepEqual(dirEntries(path.join(sessionsRoot(root), ORPHANED_DIR_NAME)), ["s1759912010-cccccc.jsonl"]);

  // 二次执行（幂等）：退出码 0、零搬运。
  const second = execFileSync(process.execPath, [SCRIPT, configDir(root)], { encoding: "utf8" });
  assert.match(second, /归位 0，孤儿桶 0，失败留原地 0/);
});

test("命令行入口：无 sessions 目录时零动作、退出码 0（不是错误）", (t) => {
  const root = tmpRoot("cli-empty");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(configDir(root), { recursive: true });
  const out = execFileSync(process.execPath, [SCRIPT, configDir(root)], { encoding: "utf8" });
  assert.match(out, /归位 0，孤儿桶 0，失败留原地 0/);
});
