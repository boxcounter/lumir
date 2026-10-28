// scripts/acceptance/build-bundle.test.mjs —— 隔离包装（`CFBundleExecutable` 上的 shell 包装）的
// 自测（node:test，零新增依赖）。
//
// 为什么需要它（M781）：M777 的 bundle 预检发现包装两处真实缺陷，四条 `tier: bundle` 场景整批
// INVALID——
//   1. `case` 模式写成 `*/acceptance/*/env`，而套件真实的隔离根是 `<repo>/.local/acceptance/env`
//      （`envHome()` = `dirname(resultsRoot())/env`，acceptance 与 env 之间没有目录），任何一次
//      拉起都被判非法；
//   2. 拒绝分支的 echo 把 `$ISO_TOKEN` 紧贴全角括号写，bash 3.2 在该 locale 下把多字节字节并进
//      变量名，`set -u` 直接 unbound 崩溃（退出码非 78），拒绝原因被崩溃本身掩盖。这条**依
//      locale 而变**（实测 UTF-8 locale 下崩、C locale 下不崩），回归因此两种 locale 都跑。
// 原自测（`lib/app.test.mjs` 的 `assertBundleIsolation` 用例）用的是**自造 fixture 脚本**，只核
// token 内容与变量导出，从不执行真实生成的包装、也不跑它的 case 分支，两条都没拦住
//（REVIEW.md「假绿：断言看着有覆盖」「同一语义两处真源」条）。
//
// 所以这里一律**执行真实生成物**：`installIsolationWrapper` 就是构建期装包装的同一个函数，
// 生成的文件按 shebang 直接拉起；`exec` 的目标换成记录用桩，自测绝不启动 Lumir。每条拒绝用例
// 都钉死三件事——退出码 78、stderr 给出原因、不是 shell 崩溃，故两条旧错误分别必红。
//
// **时序纪律（M790）**：`writeBundleIsolation` 是 async 的，必须 await 完再拉起包装——`spawnSync`
// 会阻塞整个事件循环，漏 await 就等于让线程池的落盘与 spawn 赛跑。macOS 上写这个小文件常抢在
// spawn 之前完成（本机因此假绿），Linux（docs CI）上 iso 为空、放行用例整条判红。三处调用统一走
// `prepareIsolation`（await + 同步回读），另有确定性竞态回归与源码守卫钉住这条纪律（本文件末尾）。
//
// 跑法（与 execute.test.mjs 同例，经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/build-bundle.test.mjs
//
// 纪律：全程对临时目录（`os.tmpdir()`）跑——不碰生产 token `/tmp/lumir-acceptance-isolate`、
// 不碰验收 vault、不启动 app（同机并发的真实验收批次因此互不干扰）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assertInstalledWrapper, installIsolationWrapper, isolationWrapperScript } from "./build-bundle.mjs";
import { assertBundleIsolation, BUNDLE_ISOLATION_TOKEN, writeBundleIsolation } from "./lib/app.mjs";

/** 记录用桩：替代真 Lumir 二进制。被测的是包装，真二进制只负责把包装导出的环境原样写盘。 */
const RECORDER = `#!/bin/sh
out="$(dirname "$0")/recorder.txt"
{
  printf 'XDG_CONFIG_HOME=%s\\n' "\${XDG_CONFIG_HOME-}"
  printf 'HOME=%s\\n' "\${HOME-}"
  printf 'ARGC=%s\\n' "$#"
  printf 'ARGS=%s\\n' "$*"
} > "$out"
`;

/** 正则里的字面量（路径本身要按字面比，不能把 `.` 当通配）。 */
function re(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** 一份「装包装前」的最小 bundle 骨架：只需要真二进制占位与一个临时 token 路径。 */
function makeBundle(tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `lumir-bundle-wrapper-${tag}-`));
  const appPath = path.join(dir, "Lumir.app");
  const macosDir = path.join(appPath, "Contents", "MacOS");
  mkdirSync(macosDir, { recursive: true });
  const executable = path.join(macosDir, "lumir");
  // 构建产物（真二进制）占位：不以 #!/bin/sh 开头，装包装时会按「真二进制」被改名成 lumir-bin。
  writeFileSync(executable, "PLACEHOLDER-REAL-BINARY\n", { mode: 0o755 });
  return {
    dir,
    appPath,
    executable,
    realBinary: path.join(macosDir, "lumir-bin"),
    tokenFile: path.join(dir, "isolate-token"),
    recorderFile: path.join(macosDir, "recorder.txt"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 装包装（真实函数），再把 lumir-bin 换成记录用桩。 */
function install(bundle) {
  installIsolationWrapper(bundle.executable, { tokenFile: bundle.tokenFile });
  writeFileSync(bundle.realBinary, RECORDER, { mode: 0o755 });
}

/** 拉起真实生成的包装时用的环境：两种 locale 都要跑一遍。
 *
 * 为什么不是「随便给个最小环境」：M781 的崩溃只在 `$VAR` 后紧跟多字节字符**且** locale 认多字节
 * 时发生——`env -i` 的最小环境反而不崩（实测退出码 78）。真机上的拉起进程带着用户的 locale
 *（app.log 里那条 `ISO_TOKEN?：unbound variable` 就出在这种环境），只跑最小环境等于把这条缺陷
 * 放回去。两档都跑，locale 相关的行为差异才没有藏身处。 */
const ENVS = [
  { label: "UTF-8 locale", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "en_US.UTF-8" } },
  { label: "无 locale", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
];

/** 按 shebang 直接拉起真实生成的包装。环境里没有 XDG_CONFIG_HOME / HOME：隔离根是包装自己建的。 */
function runWrapper(bundle, args, env) {
  const r = spawnSync(bundle.executable, args, { encoding: "utf8", env });
  assert.equal(r.error, undefined, `包装没能被拉起：${r.error?.message}`);
  assert.notEqual(r.status, null, "包装被信号打断（正常应是 0 或 78）");
  return r;
}

function writeToken(bundle, content) {
  writeFileSync(bundle.tokenFile, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

/**
 * 拉起包装的**唯一**隔离前置：`writeBundleIsolation` 必须 await 完，token 必须已经落盘（M790）。
 *
 * 为什么漏一个 await 就是缺陷：`runWrapper` 用的 `spawnSync` 会阻塞整个事件循环，libuv 的写入
 * 回调在它返回之前排不进来——不 await 等于把「token 落盘」交给线程池与 spawn 的赛跑。macOS 上
 * 写这个小文件常抢在 spawn 之前完成（本机因此假绿），Linux（docs CI）上则 token 还没写完包装就
 * 起了，iso 为空、整条放行用例判红。
 *
 * 这里的同步回读不是重复劳动：它把「await 之后、拉起之前」这个时点钉死，读到的内容就是包装
 * 将要读到的（两步之间没有任何事件循环机会）。缺了 await 时它要么 ENOENT、要么读到空串。
 */
async function prepareIsolation(bundle, envHome) {
  await writeBundleIsolation({ env: envHome, tokenFile: bundle.tokenFile });
  assert.ok(existsSync(bundle.tokenFile), "拉起包装之前 token 不存在：writeBundleIsolation 少了 await");
  assert.equal(
    readFileSync(bundle.tokenFile, "utf8").trim(),
    envHome,
    "拉起包装之前 token 内容不是本次隔离根：writeBundleIsolation 没 await 完就开始拉起（spawnSync 会阻塞事件循环抢跑）",
  );
}

/** 删掉 `writeBundleIsolation` 预建的隔离 HOME：留着的话「包装自己建出 HOME」的断言就没有判别力
 * （REVIEW.md「假绿：断言看着有覆盖」条）。必须在 `prepareIsolation` 之后调用——它自己也是 async 的，
 * 提前删会被它的 mkdirp 补回来。 */
function dropIsolationHome(envHome) {
  rmSync(path.join(envHome, "home"), { recursive: true, force: true });
  assert.equal(existsSync(path.join(envHome, "home")), false, "隔离 HOME 必须缺席，包装建出它才是包装的功劳");
}

/** 放行布局：两种 locale 下都要把隔离根交给真二进制，且参数原样传过去。 */
function assertPasses(bundle, envHome, label) {
  for (const { label: envLabel, env } of ENVS) {
    const at = `${label}（${envLabel}）`;
    const r = runWrapper(bundle, ["--probe", "arg two"], env);
    assert.equal(r.status, 0, `${at}：应放行，实际退出 ${r.status}（stderr：${r.stderr.trim()}）`);
    assert.equal(
      readFileSync(bundle.recorderFile, "utf8"),
      `XDG_CONFIG_HOME=${envHome}\nHOME=${envHome}/home\nARGC=2\nARGS=--probe arg two\n`,
      `${at}：包装没有把隔离根交给真二进制`,
    );
    rmSync(bundle.recorderFile, { force: true });
  }
}

/** 拒绝布局：两种 locale 下都要 78 + 可诊断原因 + 不是 shell 崩溃 + 没 exec 真二进制。 */
function assertRejected(bundle, { needle, label }) {
  for (const { label: envLabel, env } of ENVS) {
    const at = `${label}（${envLabel}）`;
    const r = runWrapper(bundle, [], env);
    assert.equal(
      r.status,
      78,
      `${at}：拒绝分支应显式 exit 78，实际 ${r.status}（stderr：${r.stderr.trim()}）——` +
        "别的退出码意味着 set -u 下先崩了，拒绝原因出不来",
    );
    assert.doesNotMatch(r.stderr, /unbound variable/, `${at}：拒绝原因不能被 set -u 的崩溃掩盖`);
    assert.match(r.stderr, /拒绝启动/, `${at}：stderr 要说清是主动拒绝，不能静默退出`);
    assert.match(r.stderr, needle, `${at}：stderr 要带上可诊断的现场（${needle}）`);
    assert.equal(existsSync(bundle.recorderFile), false, `${at}：拒绝时不得 exec 真二进制`);
  }
}

test("标准布局 `<repo>/.local/acceptance/env` 放行（M781 缺陷 1 的回归）", async () => {
  const bundle = makeBundle("standard");
  try {
    install(bundle);
    // envHome() 的真实形状：resultsRoot 是 `…/acceptance/<日期>`，env 与 acceptance 只隔一层。
    const envHome = path.join(bundle.dir, ".local", "acceptance", "env");
    await prepareIsolation(bundle, envHome);
    dropIsolationHome(envHome);

    assertPasses(bundle, envHome, "标准布局");
    assert.ok(existsSync(path.join(envHome, "home")), "包装要自己建出隔离 HOME");
  } finally {
    bundle.cleanup();
  }
});

test("带 run 一级布局 `<repo>/.local/acceptance/<run>/env` 也放行（LUMIR_ACCEPTANCE_RESULTS 多指一层）", async () => {
  const bundle = makeBundle("run-level");
  try {
    install(bundle);
    const envHome = path.join(bundle.dir, ".local", "acceptance", "2026-10-28-m777-bundle", "env");
    await prepareIsolation(bundle, envHome);
    dropIsolationHome(envHome);

    assertPasses(bundle, envHome, "带 run 布局");
    assert.ok(existsSync(path.join(envHome, "home")), "包装要自己建出隔离 HOME");
  } finally {
    bundle.cleanup();
  }
});

test("token 缺失 ⇒ 退出 78 + 指明缺失的 token 路径（不是 set -u 崩溃）", () => {
  const bundle = makeBundle("no-token");
  try {
    install(bundle);
    assertRejected(bundle, { needle: re(bundle.tokenFile), label: "token 缺失" });
  } finally {
    bundle.cleanup();
  }
});

test("token 指向非验收目录 ⇒ 退出 78 + 回显越界值（M781 缺陷 2 的回归）", () => {
  const bundle = makeBundle("out-of-bounds");
  try {
    install(bundle);
    for (const iso of [
      // 最要防的形态：真实配置目录（回落即污染用户配置）。
      "/Users/someone/.config",
      // 相对路径不是套件布局（`envHome()` 一律绝对），同样 fail-closed。
      "acceptance/env",
    ]) {
      writeToken(bundle, iso);
      assertRejected(bundle, { needle: re(iso), label: `越界 ${iso}` });
    }
  } finally {
    bundle.cleanup();
  }
});

test("包装文本里不得出现 `$VAR` 紧跟非 ASCII 字节（bash 3.2 按 locale 把它并进变量名）", () => {
  for (const script of [isolationWrapperScript(), isolationWrapperScript({ tokenFile: "/tmp/other-token" })]) {
    const hazard = script.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/);
    assert.equal(
      hazard,
      null,
      hazard === null ? "" : `「${hazard[0]}」：变量名后紧跟多字节字符，set -u 下会 unbound——用 \${NAME} 定界`,
    );
  }
});

test("被测文本就是生产文本：注入 token 路径的版本与生产版只差该字面量", () => {
  const production = isolationWrapperScript();
  const injected = isolationWrapperScript({ tokenFile: "/tmp/other-token" });
  assert.equal(injected, production.split(BUNDLE_ISOLATION_TOKEN).join("/tmp/other-token"));
  assert.ok(production.includes(`ISO_TOKEN="${BUNDLE_ISOLATION_TOKEN}"`), "生产版必须读固定路径的 token");
});

test("装后自检对真实生成物通过；缺 token / 缺 HOME 赋值 / 缺 exec 三种坏脚本各自必红", () => {
  const bundle = makeBundle("self-check");
  try {
    install(bundle);
    assertInstalledWrapper(bundle.executable, { tokenFile: bundle.tokenFile });

    const good = readFileSync(bundle.executable, "utf8");
    const broken = [
      ["缺 token 路径", good.replace(bundle.tokenFile, "/tmp/somewhere-else"), /不读 token/],
      ["缺 HOME 赋值", good.replace(/^HOME=.*$/m, "# HOME 被删掉").replace(/^export HOME$/m, ""), /没有为 HOME 赋值/],
      ["缺 exec", good.replace(/^exec .*$/m, ""), /没有 exec/],
    ];
    for (const [label, text, pattern] of broken) {
      const file = path.join(bundle.dir, `broken-${label}.sh`);
      writeFileSync(file, text, "utf8");
      assert.throws(() => assertInstalledWrapper(file, { tokenFile: bundle.tokenFile }), pattern, `${label} 必须判红`);
    }
  } finally {
    bundle.cleanup();
  }
});

test("重复装包装幂等：lumir-bin 里的真二进制原样保留", () => {
  const bundle = makeBundle("idempotent");
  try {
    install(bundle);
    const wrapper = readFileSync(bundle.executable, "utf8");
    installIsolationWrapper(bundle.executable, { tokenFile: bundle.tokenFile });
    assert.equal(readFileSync(bundle.executable, "utf8"), wrapper, "重装应重写出同一份包装文本");
    assert.equal(readFileSync(bundle.realBinary, "utf8"), RECORDER, "重装不得把 lumir-bin 覆盖掉");
    assert.equal(bundle.realBinary, path.join(path.dirname(bundle.executable), "lumir-bin"));
  } finally {
    bundle.cleanup();
  }
});

test("拉起前的静态前置门接受真实生成的包装（build 产物 ↔ 套件预检 同一条链）", async () => {
  const bundle = makeBundle("precheck");
  try {
    install(bundle);
    const envHome = path.join(bundle.dir, ".local", "acceptance", "env");
    await prepareIsolation(bundle, envHome);
    const info = await assertBundleIsolation({
      appPath: bundle.appPath,
      env: envHome,
      tokenFile: bundle.tokenFile,
      // 只绕开「读 Info.plist」这一步（PlistBuddy 是 macOS 专有，docs CI 跑在 ubuntu）；脚本判据
      // 与 token 判据仍读真实产物，不注入。
      exec: () => "lumir\n",
    });
    assert.equal(info.scriptPath, bundle.executable);
    assert.equal(info.tokenFile, bundle.tokenFile);
  } finally {
    bundle.cleanup();
  }
});

test("竞态回归：没 await 的写入赶不上 spawnSync，await 之后同一 token 必然放行（M790）", async () => {
  const bundle = makeBundle("race");
  try {
    install(bundle);
    const envHome = path.join(bundle.dir, ".local", "acceptance", "env");
    const { env } = ENVS[0];

    // 旧形态的**确定性**复现：这次写入只在事件循环上完成（定时器回调里才落盘）。`spawnSync` 会
    // 阻塞整个事件循环，回调在它返回之前不可能执行——所以这条判据与平台快慢无关。真实的
    // `fs.writeFile` 走 libuv 线程池，落盘（C 侧）可能与 spawn 并行，macOS 上常侥幸抢在前面把
    // 缺陷藏成假绿；这里把「回调必须排到」这一点放大成必然，旧形态在任何机器上都拿不到 token。
    const pending = new Promise((resolve) => {
      setTimeout(() => {
        writeFileSync(bundle.tokenFile, `${envHome}\n`, "utf8");
        resolve();
      }, 0);
    });
    const before = runWrapper(bundle, [], env);
    assert.equal(
      before.status,
      78,
      `写入未落盘时包装必须拒绝启动，实际 ${before.status}（stderr：${before.stderr.trim()}）——` +
        "放行说明这条复现没有制造出竞态，判据没有输入",
    );
    assert.match(before.stderr, /隔离 token 缺失或不可读/, "拒绝原因要是 token 缺失，不能是别的失败");
    assert.equal(existsSync(bundle.recorderFile), false, "写入未落盘时不得 exec 真二进制");

    // 正控：等写入真的完成（await）后，同一份产物、同一 token 路径必须放行——上一条的 78 因此
    // 只能归因于时序，而不是 token 路径 / 布局判据不对。
    await pending;
    const after = runWrapper(bundle, [], env);
    assert.equal(after.status, 0, `await 之后应放行，实际 ${after.status}（stderr：${after.stderr.trim()}）`);
    assert.match(readFileSync(bundle.recorderFile, "utf8"), /ARGC=0/, "放行时真二进制应被 exec（本条无参数调用）");
  } finally {
    bundle.cleanup();
  }
});

test("守卫：本文件每处 writeBundleIsolation 调用都带 await（漏掉即 M790 竞态）", () => {
  // 静态守卫而不是又一条运行时用例：竞态在 macOS 上不可见（见上一条注释），新加调用点漏 await
  // 在本地仍会绿，只有 docs CI 的 Linux 会红。扫自己这份源码，把「必须 await」钉成机器判据
  // （同族做法：lib/batches.test.mjs 对 run.mjs 的调用点数做源码断言）。
  const src = readFileSync(new URL("./build-bundle.test.mjs", import.meta.url), "utf8");
  const callSites = src
    .split("\n")
    .map((line, n) => ({ line, n: n + 1 }))
    .filter(({ line }) => !line.trimStart().startsWith("//") && /\bwriteBundleIsolation\s*\(/.test(line));
  assert.ok(callSites.length > 0, "一处调用都扫不到：守卫失去输入（正则或文件名漂了也照样绿）");
  for (const { line, n } of callSites) {
    assert.match(
      line,
      /\bawait\s+writeBundleIsolation\s*\(/,
      `第 ${n} 行没有 await：spawnSync 会阻塞事件循环，token 可能还没落盘包装就起了（M790）：${line.trim()}`,
    );
  }
});
