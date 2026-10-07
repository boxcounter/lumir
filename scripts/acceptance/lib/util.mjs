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

/**
 * 「本次运行无效」类错误的标记（M379）：专指**基建**问题——app 起不来 / 前端未就绪 /
 * 窗口形态自检不过 / KimiCU 掉线这一类。它与产品判红在读数上必须分开：
 * runner 见到它就把该场景标成 `INVALID`、整轮退出码升到 2（见 run.mjs 的退出码分档与
 * README「退出码」），否则「环境无效运行」会被当成产品缺陷（finding
 * `.tower/comms/findings/20260928-worker-impl-goto-line-c-improve-0-1-pass-1.md`：
 * M281 三次无效运行与真判红都报 0/1 PASS，只能靠人读步骤形态区分）。
 *
 * 只在「起实例 / 就绪门」这条链上用；场景里的断言与动作失败一律是普通 Error（= 产品面）。
 */
export class InfraError extends Error {}

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

/** **第二个**合成 vault（M164，多 vault 场景的切换目标）：与验收 vault 同级、同在 /tmp 下。
 *  它不参与「vault 重置为 fixtures 精确副本」——内容来自 `fixtures/second-vault/`，与
 *  验收 vault 的文件名刻意不重叠，切换前后的正文断言因此能互相区分。 */
export function secondVaultDir() {
  return process.env.LUMIR_ACCEPTANCE_VAULT2 ?? `${vaultDir()}-b`;
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
