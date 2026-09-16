// 共用小工具：仓库根、时间、目录、日志。与 scripts/perf/lib/stats.mjs 同风格（低依赖取向）。
import { mkdir, rm, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export function repoRoot() {
  // scripts/acceptance/lib/util.mjs -> repo root
  return path.resolve(new URL(".", import.meta.url).pathname, "../../..");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function mkdirp(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p) {
  return readFile(p, "utf8");
}

/** 验收 vault 路径：合成 vault，可被套件整根重置（见 README「证据与副作用」）。 */
export function vaultDir() {
  return process.env.LUMIR_ACCEPTANCE_VAULT ?? "/tmp/lumir-m102-acceptance";
}

/** 套件全部运行期产物（git 外）。日期目录便于 Alex 抽审时按批次定位。 */
export function resultsRoot() {
  const date = new Date().toISOString().slice(0, 10);
  return process.env.LUMIR_ACCEPTANCE_RESULTS ?? path.join(repoRoot(), "test-results/acceptance", date);
}

/** 隔离的 XDG_CONFIG_HOME：套件自带 config.json，绝不写用户的 ~/.config/lumir。 */
export function envHome() {
  return path.join(path.dirname(resultsRoot()), "env");
}

export function log(msg) {
  process.stdout.write(`${msg}\n`);
}

export function fmtMs(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 去掉 ANSI 转义（pnpm / tauri CLI 输出带色码，日志要可 grep）。 */
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

export async function listFiles(dir) {
  const names = await readdir(dir);
  const out = [];
  for (const n of names) {
    const p = path.join(dir, n);
    const st = await stat(p);
    out.push({ name: n, path: p, mtimeMs: st.mtimeMs, size: st.size, isDir: st.isDirectory() });
  }
  return out;
}

export async function rmrf(p) {
  await rm(p, { recursive: true, force: true });
}
