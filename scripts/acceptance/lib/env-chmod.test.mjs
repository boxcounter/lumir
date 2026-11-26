import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { applyEnvChmod, restoreEnvChmods, validateEnvChmod } from "./env-chmod.mjs";
import { runScenario } from "./execute.mjs";
import { repoRoot } from "./util.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lumir-env-chmod-test-"));
process.env.LUMIR_ACCEPTANCE_RESULTS = path.join(root, "results", "run");
const target = path.join(root, "results", "env", "lumir", "harness", "sessions", "vault-test");
fs.mkdirSync(target, { recursive: true });
fs.chmodSync(target, 0o700);

test("envChmod 拒绝绝对路径、.. 与非法 mode", () => {
  for (const file of ["/tmp/outside", "../outside", "harness/../../outside"]) {
    assert.throws(() => validateEnvChmod({ file, mode: 0o500 }), /相对|拒绝/);
  }
  for (const mode of [-1, 0o1000, "755", "0o888", null]) {
    assert.throws(() => validateEnvChmod({ file: "harness/sessions/vault-test", mode }), /mode/);
  }
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
});

test("envChmod 成功与重复修改后恢复首次 mode", () => {
  applyEnvChmod({ file: "harness/sessions/vault-test", mode: 0o500 });
  assert.equal(fs.statSync(target).mode & 0o777, 0o500);
  applyEnvChmod({ file: "harness/sessions/vault-test", mode: 0o400 });
  assert.equal(fs.statSync(target).mode & 0o777, 0o400);
  assert.deepEqual(restoreEnvChmods(), []);
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
});

test("后续动作失败时 runScenario finally 也恢复原 mode", async () => {
  const records = [];
  const ctx = {
    cu: {},
    pid: 0,
    repoRoot: repoRoot(),
    evidence: {
      records,
      startScenario: async () => root,
      record: (record) => records.push(record),
      saveAx: async () => path.join(root, "stub.ax"),
      saveShot: async () => path.join(root, "stub.jpeg"),
      logLine: () => {},
      finish: async () => ({ status: "FAIL" }),
    },
  };
  await runScenario(ctx, {
    id: "env-chmod-failure",
    item: 0,
    title: "失败复位",
    file: path.join(root, "scenario.md"),
    steps: [
      { name: "只读", do: "envChmod", file: "harness/sessions/vault-test", mode: 0o400 },
      { name: "故意越界失败", do: "envWrite", file: "../outside", content: "x" },
    ],
  });
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
});

test("SIGINT 中断退出也恢复原 mode", () => {
  const moduleUrl = pathToFileURL(path.resolve("scripts/acceptance/lib/env-chmod.mjs")).href;
  const script = `
    import { applyEnvChmod } from ${JSON.stringify(moduleUrl)};
    process.env.LUMIR_ACCEPTANCE_RESULTS = ${JSON.stringify(process.env.LUMIR_ACCEPTANCE_RESULTS)};
    process.on("SIGINT", () => process.exit(130));
    applyEnvChmod({ file: "harness/sessions/vault-test", mode: 0o400 });
    process.kill(process.pid, "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(child.status, 130, child.stderr);
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
});
