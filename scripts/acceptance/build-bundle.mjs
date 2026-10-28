#!/usr/bin/env node
// scripts/acceptance/build-bundle.mjs —— 构建验收专用打包实例（M622）。
//
// 为什么需要专用构建：通知点击由 usernoted / LaunchServices 按 **bundle id** 解析落点。验收副本
// 若与产品同 id（com.lumir.app），点击会被解析到安装版 /Applications/Lumir.app，本进程的
// on_action 收不到（M619 真机实证，README「实例 flavour」）。因此构建期用 `tauri build --config`
// 把 identifier 覆盖成 ACCEPTANCE_BUNDLE_ID——`src-tauri/tauri.conf.json` 本体一字不动。
//
// 三步：
//   1. `pnpm tauri build --debug --bundles app --config '{"identifier":"com.lumir.app.acceptance"}'`
//      （beforeBuildCommand 会先跑 `pnpm build`，不必手动构建前端）；
//   2. ad-hoc 签名（M608 / M612：只有 linker-signed 的 debug bundle 会被 UN 通知授权直接拒，
//      启动日志 `通知权限被拒绝`、横幅根本不出现）；
//   3. 回读产物 Info.plist 校验 bundle id（漏了 --config 的构建在这里就红，不留给套件预检）。
//
// 用法：
//   node scripts/acceptance/build-bundle.mjs
//
// **通知身份隔离（M752，opt-in）**：设 `LUMIR_ACCEPTANCE_BUNDLE_ID=<独立 id>` 时用该 id 构建。
// 用途是「手工验证/人肉点击」这类「同机可能同时存在多份同 id 副本」的场合——同 bundle id 的两份
// 副本会让点击被另一份接走（M619/M622 的路由问题）。**默认不设该变量，产物 id 仍是
// com.lumir.app.acceptance，套件行为一字不变。** 该 id 必须是**固定值**：换 id 等于换一个通知
// 授权身份，系统要重新授权一次（由 Alex 人工允许），因此不要每次运行都改。
// 注意 `.app` 产物路径不随 id 变化（同一份 Lumir.app 被覆盖）——用隔离 id 跑完手工验证后，
// 要跑套件（170/171/213）请用默认 id 重建。
//
// 产物：<CARGO_TARGET_DIR | src-tauri/target>/debug/bundle/macos/<productName>.app
// 之后按 README「实例 flavour」用 LUMIR_ACCEPTANCE_BUNDLE 指向它跑 170 / 171 / 213。
//
// **隔离包装（change add-cron-notification-relaunch §8.2，fail-closed）**：构建完把真二进制改名为
// `lumir-bin`、在 `CFBundleExecutable`（`Contents/MacOS/lumir`）上放一份 shell 包装脚本。脚本在
// `exec` 真二进制**之前**导出隔离的 `XDG_CONFIG_HOME` 与 `HOME`——两者都要，缺 `XDG` 时
// `config.rs` 会回落 `$HOME/.config`。
//
// 为什么必须是包装而不是环境变量：**被 LaunchServices 重新拉起的进程不继承套件的环境变量**
// （用户点通知时系统拉起的新进程只看得到 launchd 的默认环境）。隔离根因此从固定路径的 token
// 文件（`/tmp/lumir-acceptance-isolate`，套件每次拉起前写入本次 run 的 `env/`）读取；token 缺失
// 或路径不在 `*/acceptance/*/env` 形状上时脚本**拒绝启动**（退出码 78），绝不回落真实配置。
// 判据与静态前置门在 `lib/app.mjs` 的 `writeBundleIsolation` / `assertBundleIsolation`。
//
// **首次授权是人肉 checkpoint**：新 bundle id 在系统里的通知权限是空的，第一次启动请求授权时
// 需要有人（Alex）在系统设置 > 通知里给验收副本打开权限，否则含通知的场景必红。详见 README。
//
// 这是重 cargo 构建：按 tower 纪律先持 /tmp/lumir-cargo-build.lock（`mkdir` 判持有，退出码 0 =
// 持有），跑完释放；跨 worktree 共享主仓 target 见 REVIEW.md「并行 worktree 的 target 纪律」。
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE_BUNDLE_ID,
  assertAcceptanceBundleIdentity,
  BUNDLE_ISOLATION_TOKEN,
  productBundleId,
  readBundleId,
} from "./lib/app.mjs";
import { log, repoRoot } from "./lib/util.mjs";

function run(cmd, args) {
  log(`$ ${cmd} ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
  execFileSync(cmd, args, { cwd: repoRoot(), stdio: "inherit" });
}

function fail(message) {
  log(`构建失败：${message}`);
  process.exit(1);
}

/**
 * 把真二进制改成 `lumir-bin`，并在 `CFBundleExecutable` 的位置装隔离包装脚本。
 *
 * 幂等：重复构建时 `Contents/MacOS/lumir` 已经是包装（tauri 未重建 bundle）就先拆掉再装。
 * 脚本内容与静态前置门的判据一一对应（`lib/app.mjs` 的 `assertBundleIsolation`）。
 */
function installIsolationWrapper(executablePath) {
  const dir = path.dirname(executablePath);
  const realBinary = path.join(dir, "lumir-bin");
  const current = readFileSync(executablePath, "utf8");
  if (current.startsWith("#!/bin/sh")) {
    // 已经是包装：真二进制留在 lumir-bin 里，内容会被本次构建覆盖，直接复用结构。
    log("检测到已有隔离包装：保留结构，重写脚本");
  } else {
    rmSync(realBinary, { force: true });
    renameSync(executablePath, realBinary);
    chmodSync(realBinary, 0o755);
  }
  const script = `#!/bin/sh
# Lumir 验收实例的 fail-closed 隔离包装（change add-cron-notification-relaunch §8.2）。
# 被 LaunchServices 拉起的进程不继承套件的环境变量：隔离只能在这里、在任何 Lumir 代码
# 运行之前建立。隔离根来自固定路径的 token 文件（套件每次拉起前写入本次 run 的 env）；
# token 缺失 / 不合法即拒绝启动，绝不回落真实 ~/.config。
set -eu
ISO_TOKEN="${BUNDLE_ISOLATION_TOKEN}"
iso="$(cat "$ISO_TOKEN" 2>/dev/null || true)"
case "\${iso}" in
  */acceptance/*/env) ;;
  *)
    echo "lumir-acceptance: 隔离根缺失或非法（$ISO_TOKEN）：拒绝启动" >&2
    exit 78
    ;;
esac
XDG_CONFIG_HOME="\${iso}"
HOME="\${iso}/home"
export XDG_CONFIG_HOME
export HOME
mkdir -p "\${HOME}"
exec "$(dirname "$0")/lumir-bin" "$@"
`;
  writeFileSync(executablePath, script, "utf8");
  chmodSync(executablePath, 0o755);
}

const root = repoRoot();
// 通知身份隔离（M752，opt-in）：默认用验收 id；设了 LUMIR_ACCEPTANCE_BUNDLE_ID 就用它。
const overrideBundleId = (process.env.LUMIR_ACCEPTANCE_BUNDLE_ID ?? "").trim();
const bundleId = overrideBundleId === "" ? ACCEPTANCE_BUNDLE_ID : overrideBundleId;
const confPath = path.join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const productName = conf.productName;
if (!productName) fail(`${confPath} 缺 productName，无法定位 .app 产物`);
if (overrideBundleId !== "") {
  if (overrideBundleId === conf.identifier) {
    fail(
      `LUMIR_ACCEPTANCE_BUNDLE_ID 不得等于产品 id（${conf.identifier}）：` +
        "点击会按该 id 被 LaunchServices 解析到安装版（M619 的根因）",
    );
  }
  if (/\s/.test(overrideBundleId) || !/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+$/.test(overrideBundleId)) {
    fail(`LUMIR_ACCEPTANCE_BUNDLE_ID 形状非法：${JSON.stringify(overrideBundleId)}（要 reverse-DNS 形态、不含空白）`);
  }
}

if (!existsSync(path.join(root, "node_modules", ".bin", "tauri"))) {
  fail(`worktree 缺 node_modules（${path.join(root, "node_modules")}）：先 pnpm install --frozen-lockfile`);
}

// 产物路径与 tauri CLI 同一口径：CARGO_TARGET_DIR 在场时落在它下面（worktree 常把它指向主仓
// 的 warm target 以省掉一次全量构建），否则是 `src-tauri/target`。
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(root, "src-tauri", "target");
const appPath = path.join(targetDir, "debug", "bundle", "macos", `${productName}.app`);
// .app 内的可执行文件名是 Cargo 包名（src-tauri/Cargo.toml 的 `name = "lumir"`），不是
// productName 的小写——LUMIR_ACCEPTANCE_BUNDLE 的既有用法（README / 历史场景）都按它写。
const binaryPath = path.join(appPath, "Contents", "MacOS", "lumir");

try {
  run("pnpm", [
    "tauri",
    "build",
    "--debug",
    "--bundles",
    "app",
    "--config",
    JSON.stringify({ identifier: bundleId }),
  ]);
  installIsolationWrapper(binaryPath);
  // 签名在改动之后：换过 bundle 内容再签，否则 UN 授权会把这份副本当成未签名身份（M636）。
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
} catch (e) {
  fail(e.message);
}

let identity;
try {
  if (overrideBundleId === "") {
    // 默认路径：与套件预检同一份断言（单一实现）。
    identity = assertAcceptanceBundleIdentity({ appPath });
  } else {
    // 隔离 id：`assertAcceptanceBundleIdentity` 只认标准验收 id，这里就地核两件事——
    // 产物 id 等于本次期望、且不等于产品 id。其余口径（授权按 id 记账）由 README 说明。
    const actual = readBundleId(appPath);
    const productId = productBundleId();
    if (actual === productId) fail(`产物 id 仍是产品 id（${productId}）：--config 覆盖没生效`);
    if (actual !== bundleId) fail(`产物 id 是 ${actual}，与本次构建期望的 ${bundleId} 不一致`);
    identity = { appPath, bundleId: actual, productBundleId: productId };
  }
} catch (e) {
  fail(e.message);
}

// 包装装好了才算可用的验收产物：`CFBundleExecutable` 指向脚本、脚本两个变量都在、exec 真二进制。
const installedScript = readFileSync(binaryPath, "utf8");
if (!installedScript.startsWith("#!/bin/sh")) fail(`隔离包装的开头不是 #!/bin/sh（${binaryPath}）`);
for (const needle of [BUNDLE_ISOLATION_TOKEN, "exec "]) {
  if (!installedScript.includes(needle)) fail(`隔离包装缺「${needle}」（${binaryPath}）`);
}
// 逐变量精确匹配赋值：`XDG_CONFIG_HOME=` 里含有子串 `HOME=`，用 `includes("HOME=")` 会让
// 「缺 HOME」的脚本混过这里（那条路径会悄悄回落到真实 `$HOME/.config`）。判断与拉起前的静态
// 前置门（lib/app.mjs 的 assertBundleIsolation）同口径。
for (const name of ["XDG_CONFIG_HOME", "HOME"]) {
  if (!new RegExp(`(^|[\\s;])(export\\s+)?${name}=`, "m").test(installedScript)) {
    fail(`隔离包装没有为 ${name} 赋值（${binaryPath}）`);
  }
}

log("");
log(`产物：${appPath}`);
log(`bundle id：${identity.bundleId}（产品 id ${identity.productBundleId}——身份已隔离）`);
if (overrideBundleId !== "") {
  log("");
  log(`注意：本次用的是**隔离 id**（LUMIR_ACCEPTANCE_BUNDLE_ID=${overrideBundleId}）。`);
  log("· 该 id 的通知授权是空的：首次启动时会弹系统授权，需要 Alex 人工允许（见 README「实例 flavour」）；");
  log("· 同一份 .app 产物被覆盖了：要跑套件（170/171/213）请用默认 id 重建（不设该变量）。");
}
log("下一步（首次以新 id 发通知前需要系统授权，见 README「实例 flavour」）：");
log(`  LUMIR_ACCEPTANCE_BUNDLE="${binaryPath}" node scripts/acceptance/run.mjs 170 171 213`);
