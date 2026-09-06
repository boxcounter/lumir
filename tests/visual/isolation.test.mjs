import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, symlink, unlink, readdir } from "node:fs/promises";
import path from "node:path";
const prepare = () => execFileSync(process.execPath, ["scripts/visual/prepare-isolated.mjs"], { encoding: "utf8" }).trim();
const snapshot = (run, stage) => JSON.parse(execFileSync(process.execPath, ["scripts/visual/snapshot-isolated.mjs", run, stage], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
test("unique runs do not inherit Thread/current/workspace; evidence redacts and fails closed", async () => {
  const old = prepare();
  await mkdir(path.join(old, "config/lumir/threads"));
  await writeFile(path.join(old, "config/lumir/threads/current-old.txt"), "old");
  const run = prepare();
  assert.notEqual(old, run);
  assert.deepEqual(snapshot(run, "before-create").current, []);
  await mkdir(path.join(run, "config/lumir/threads"));
  await mkdir(path.join(run, "config/lumir/workspaces"));
  await writeFile(path.join(run, "config/lumir/threads/test.json"), JSON.stringify({ id: "test", vault_id: "test-vault", title: "private title", status: "active", files: [] }));
  await writeFile(path.join(run, "config/lumir/workspaces/test.json"), JSON.stringify({ id: "test-vault", path: path.join(run, "vault") }));
  const after = snapshot(run, "after-create");
  assert.equal(after.threads[0].title, "<redacted>");
  assert.equal(after.workspaces[0].path, "<run>/vault");
  const restart = snapshot(run, "after-restart");
  assert.deepEqual(restart.threads, after.threads);
  assert.deepEqual(restart.current, []);
  assert.throws(() => snapshot(run, "after-restart"));
  assert.throws(() => snapshot(path.dirname(run), "before-create"));
  const bad = prepare();
  await mkdir(path.join(bad, "config/lumir/threads"));
  await writeFile(path.join(bad, "config/lumir/threads/bad.json"), "{");
  assert.throws(() => snapshot(bad, "before-create"));
  assert.equal(await readFile(path.join(old, "config/lumir/threads/current-old.txt"), "utf8"), "old");
});
test("manifest and evidence symlinks fail without copying private fields or writing outside run", async () => {
  const target = prepare();
  await mkdir(path.join(target, "synthetic-output"));
  const marker = "PRIVATE_SYNTHETIC_MARKER";
  const manifest = JSON.parse(await readFile(path.join(target, "run.json"), "utf8"));
  await writeFile(path.join(target, "synthetic.json"), JSON.stringify({ ...manifest, privateMarker: marker }));
  const rejects = run => assert.throws(() => snapshot(run, "before-create"), error => {
    assert.notEqual(error.status, 0);
    assert.equal(String(error.stdout), "");
    assert.ok(!String(error.stderr).includes(marker));
    return true;
  });
  const linkedManifest = prepare();
  await unlink(path.join(linkedManifest, "run.json"));
  await symlink(path.join(target, "synthetic.json"), path.join(linkedManifest, "run.json"));
  rejects(linkedManifest);
  const linkedEvidence = prepare();
  await symlink(path.join(target, "synthetic-output"), path.join(linkedEvidence, "evidence"));
  rejects(linkedEvidence);
  assert.deepEqual(await readdir(path.join(target, "synthetic-output")), []);
  for (const patch of [{ privateMarker: marker }, { schema: 2 }, { incognito: false }, { createdAt: marker }, { identifier: marker }, { fixture: marker }]) {
    const run = prepare();
    await writeFile(path.join(run, "run.json"), JSON.stringify({ ...manifest, ...patch }));
    rejects(run);
    assert.ok(!(await readdir(run)).includes("evidence"));
  }
});
