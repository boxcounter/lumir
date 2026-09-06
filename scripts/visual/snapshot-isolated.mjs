import { readFile, readdir, realpath, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [input, stage] = process.argv.slice(2);
if (!input || !["before-create", "after-create", "after-restart"].includes(stage)) throw new Error("Usage: snapshot-isolated.mjs RUN_DIR before-create|after-create|after-restart");
const root = await realpath(fileURLToPath(new URL("../../tests/visual/runtime/runs/", import.meta.url)));
const run = await realpath(input);
if (path.dirname(run) !== root || !path.basename(run).startsWith("run-")) throw new Error("Run must be a direct child of this worktree's isolated runs directory");
const checkedPath = async relative => {
  let current = run;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Refusing symlink in isolated evidence path");
    if (!(await realpath(current)).startsWith(`${run}${path.sep}`)) throw new Error("Evidence path escapes run");
  }
  return current;
};
const rawManifest = JSON.parse(await readFile(await checkedPath("run.json"), "utf8"));
const keys = ["schema", "createdAt", "identifier", "incognito", "fixture"];
if (!rawManifest || Array.isArray(rawManifest) || Object.keys(rawManifest).length !== keys.length || Object.keys(rawManifest).some(key => !keys.includes(key)) || rawManifest.schema !== 1 || typeof rawManifest.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rawManifest.createdAt) || !Number.isFinite(Date.parse(rawManifest.createdAt)) || rawManifest.identifier !== "com.lumir.parity62" || rawManifest.incognito !== true || rawManifest.fixture !== "200-paragraph-vault") throw new Error("Invalid isolated manifest schema");
const manifest = Object.fromEntries(keys.map(key => [key, rawManifest[key]]));
const configDir = path.join(run, "config/lumir");
const readDirectory = async name => {
  const directory = path.join(configDir, name);
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return Promise.all(files.sort().map(async file => {
    const resolved = await realpath(path.join(directory, file));
    if (!resolved.startsWith(`${run}${path.sep}`)) throw new Error("Refusing evidence symlink outside run");
    return { file, content: await readFile(resolved, "utf8") };
  }));
};
const threads = await readDirectory("threads");
const workspaces = await readDirectory("workspaces");
const snapshot = {
  stage, capturedAt: new Date().toISOString(), manifest,
  threads: threads.filter(item => item.file.endsWith(".json")).map(item => {
    const t = JSON.parse(item.content);
    return { id: t.id, vault_id: t.vault_id, title: "<redacted>", status: t.status, fileCount: t.files.length };
  }),
  current: threads.filter(item => item.file.startsWith("current-")).map(item => ({ file: item.file, id: item.content })),
  workspaces: workspaces.map(item => { const w = JSON.parse(item.content); return { id: w.id, path: w.path === path.join(run, "vault") ? "<run>/vault" : "<redacted>" }; }),
};
try { await mkdir(path.join(run, "evidence")); } catch (error) { if (error.code !== "EEXIST") throw error; }
const evidence = await checkedPath("evidence");
if (!(await lstat(evidence)).isDirectory()) throw new Error("Evidence path must be a directory");
await writeFile(path.join(evidence, `${stage}.json`), JSON.stringify(snapshot, null, 2), { flag: "wx" });
console.log(JSON.stringify(snapshot));
