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
// 产物：<CARGO_TARGET_DIR | src-tauri/target>/debug/bundle/macos/<productName>.app
// 之后按 README「实例 flavour」用 LUMIR_ACCEPTANCE_BUNDLE 指向它跑 170 / 171 / 213。
//
// **首次授权是人肉 checkpoint**：新 bundle id 在系统里的通知权限是空的，第一次启动请求授权时
// 需要有人（Alex）在系统设置 > 通知里给验收副本打开权限，否则含通知的场景必红。详见 README。
//
// 这是重 cargo 构建：按 tower 纪律先持 /tmp/lumir-cargo-build.lock（`mkdir` 判持有，退出码 0 =
// 持有），跑完释放；跨 worktree 共享主仓 target 见 REVIEW.md「并行 worktree 的 target 纪律」。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ACCEPTANCE_BUNDLE_ID, assertAcceptanceBundleIdentity } from "./lib/app.mjs";
import { log, repoRoot } from "./lib/util.mjs";

function run(cmd, args) {
  log(`$ ${cmd} ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
  execFileSync(cmd, args, { cwd: repoRoot(), stdio: "inherit" });
}

function fail(message) {
  log(`构建失败：${message}`);
  process.exit(1);
}

const root = repoRoot();
const confPath = path.join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const productName = conf.productName;
if (!productName) fail(`${confPath} 缺 productName，无法定位 .app 产物`);

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
    JSON.stringify({ identifier: ACCEPTANCE_BUNDLE_ID }),
  ]);
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
} catch (e) {
  fail(e.message);
}

let identity;
try {
  identity = assertAcceptanceBundleIdentity({ appPath });
} catch (e) {
  fail(e.message);
}

log("");
log(`产物：${appPath}`);
log(`bundle id：${identity.bundleId}（产品 id ${identity.productBundleId}——身份已隔离）`);
log("下一步（首次以新 id 发通知前需要系统授权，见 README「实例 flavour」）：");
log(`  LUMIR_ACCEPTANCE_BUNDLE="${binaryPath}" node scripts/acceptance/run.mjs 170 171 213`);
