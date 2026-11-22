// 默认 perf 启动链的黑盒隔离测试：假 app 会实际读取配置、改写它，并读取 last_vault 文档。
// 宿主 HOME/XDG 全是测试临时目录；若脚本继承宿主环境，canary 会被真实读写，测试即红。
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const perfDir = path.dirname(fileURLToPath(import.meta.url));

async function makeHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumir-perf-isolation-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(perfDir, path.join(root, "scripts/perf"), { recursive: true });

  const hostHome = path.join(root, "host-home");
  const hostXdg = path.join(root, "host-xdg");
  const hostConfigDir = path.join(hostXdg, "lumir");
  const hostVault = path.join(root, "host-vault");
  await mkdir(hostHome, { recursive: true });
  await mkdir(hostConfigDir, { recursive: true });
  await mkdir(hostVault, { recursive: true });
  const hostConfig = path.join(hostConfigDir, "config.json");
  const originalConfig = `${JSON.stringify({ version: 1, last_vault: hostVault, editor: { mode: "md" } }, null, 2)}\n`;
  await writeFile(hostConfig, originalConfig);
  await writeFile(path.join(hostVault, "private.md"), "synthetic private canary\n");

  const bin = path.join(root, "src-tauri/target/release/lumir");
  await mkdir(path.dirname(bin), { recursive: true });
  const fakeApp = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const xdg = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME, ".config");
const configPath = path.join(xdg, "lumir", "config.json");
let config = null;
let configError = null;
try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (error) { configError = String(error); }
fs.appendFileSync(process.env.PERF_TEST_LAUNCH_LOG, JSON.stringify({
  pid: process.pid,
  home: process.env.HOME,
  xdg,
  configPath,
  configError,
  lastVault: config?.last_vault ?? null,
}) + "\\n");
if (config) {
  config.perf_probe_write = (config.perf_probe_write ?? 0) + 1;
  fs.writeFileSync(configPath, JSON.stringify(config));
  if (config.last_vault) {
    const privateName = fs.existsSync(path.join(config.last_vault, "private.md")) ? "private.md" : "alpha.md";
    const privateText = fs.readFileSync(path.join(config.last_vault, privateName), "utf8");
    fs.appendFileSync(path.join(config.last_vault, "app-access.log"), "read:" + privateText);
    fs.writeFileSync(path.join(config.last_vault, "beta.md"), "synthetic vault write\\n");
  }
}
process.stdout.write('LUMIR_READY {"event":"ready","elapsed_ms":1,"pid":' + process.pid + '}\\n');
if (process.env.PERF_TEST_EXIT_AFTER_READY === "1") process.exit(0);
setInterval(() => {}, 1000);
`;
  await writeFile(bin, fakeApp);
  await chmod(bin, 0o755);

  return {
    root,
    bin,
    hostHome,
    hostXdg,
    hostConfig,
    hostVault,
    originalConfig,
    launchLog: path.join(root, "launches.jsonl"),
    results: path.join(root, "results"),
  };
}

async function runPerf(harness, script, { panes } = {}) {
  const env = {
    ...process.env,
    HOME: harness.hostHome,
    XDG_CONFIG_HOME: harness.hostXdg,
    PERF_RESULTS_DIR: harness.results,
    PERF_TEST_LAUNCH_LOG: harness.launchLog,
    PERF_MEM_SAMPLES: "1",
    PERF_MEM_SETTLE_MS: "0",
    PERF_COLD_START_RUNS: "1",
    PERF_COLD_START_WARMUP: "0",
  };
  if (panes === undefined) delete env.PERF_MEM_PANES;
  else env.PERF_MEM_PANES = String(panes);
  return await execFileP(process.execPath, [path.join(harness.root, "scripts/perf", script)], {
    env,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function readLaunches(harness) {
  const text = await readFile(harness.launchLog, "utf8");
  return text.trim().split("\n").map(JSON.parse);
}

async function assertHostUntouched(harness) {
  assert.equal(await readFile(harness.hostConfig, "utf8"), harness.originalConfig, "宿主配置不得被改写");
  assert.equal(existsSync(path.join(harness.hostVault, "app-access.log")), false, "宿主 vault 不得被读取");
  assert.equal(existsSync(path.join(harness.hostVault, "beta.md")), false, "宿主 vault 不得被写入");
}

test("探测器有区分度：直接继承宿主配置时会读 vault、改写配置和 vault", async (t) => {
  const harness = await makeHarness(t);
  await execFileP(harness.bin, [], {
    env: {
      ...process.env,
      HOME: harness.hostHome,
      XDG_CONFIG_HOME: harness.hostXdg,
      PERF_TEST_LAUNCH_LOG: harness.launchLog,
      PERF_TEST_EXIT_AFTER_READY: "1",
    },
  });
  const config = JSON.parse(await readFile(harness.hostConfig, "utf8"));
  assert.equal(config.perf_probe_write, 1);
  assert.equal(await readFile(path.join(harness.hostVault, "app-access.log"), "utf8"), "read:synthetic private canary\n");
  assert.equal(await readFile(path.join(harness.hostVault, "beta.md"), "utf8"), "synthetic vault write\n");
});

for (const [script, metric] of [["memory.mjs", "resident-memory"], ["cold-start.mjs", "cold-start"]]) {
  test(`${script} 缺省启动使用独立合成 HOME/XDG，宿主配置与 vault 零读写`, async (t) => {
    const harness = await makeHarness(t);
    await runPerf(harness, script);
    await assertHostUntouched(harness);

    const launches = await readLaunches(harness);
    assert.equal(launches.length, 1);
    const launch = launches[0];
    assert.equal(launch.configError, null, "假 app 必须实际读到合成配置，不能靠缺失配置通过");
    assert.equal(launch.lastVault, null, "默认 fixture 不得含 last_vault");
    assert.notEqual(launch.xdg, harness.hostXdg);
    assert.notEqual(launch.home, harness.hostHome);
    assert.equal(existsSync(launch.xdg), false, "测量结束后应清理一次性 XDG");
    assert.equal(existsSync(launch.home), false, "测量结束后应清理一次性 HOME");

    const result = JSON.parse(await readFile(path.join(harness.results, `${metric}.json`), "utf8"));
    assert.equal(result.meta.panes, 0);
    assert.equal(result.meta.xdgConfigHome, launch.xdg);
    assert.equal(result.meta.home, launch.home);
  });
}

test("memory PERF_MEM_PANES=1 变体保留：合成 vault 可读写，宿主仍零读写", async (t) => {
  const harness = await makeHarness(t);
  await runPerf(harness, "memory.mjs", { panes: 1 });
  await assertHostUntouched(harness);
  const [launch] = await readLaunches(harness);
  assert.ok(launch.lastVault, "pane1 必须保留合成 vault 启动恢复 fixture");
  assert.notEqual(launch.lastVault, harness.hostVault);
  assert.equal(launch.configError, null);
  assert.equal(existsSync(launch.lastVault), false, "变体结束后也清理合成 vault");
  const result = JSON.parse(await readFile(path.join(harness.results, "resident-memory-pane1.json"), "utf8"));
  assert.equal(result.meta.panes, 1);
});
