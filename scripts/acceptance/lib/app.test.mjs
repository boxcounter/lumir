// scripts/acceptance/lib/app.test.mjs —— app.mjs 的纯函数自测（M619：bundle 启动方式与
// 实例扫描）。不起真机、不需要 app、不碰验收 vault / 用户的 ~/.config/lumir。
//
// 跑法（与 execute.test.mjs 同例，经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/app.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAcceptanceBundleIdentity,
  assertBundleIsolation,
  BUNDLE_EXEC_NAMES,
  bundleAppPath,
  bundleEntryPath,
  findBundleAppPid,
  listLumirInstances,
  parseElapsedSeconds,
  readBundleId,
  stopApp,
  straysInClickWindow,
  waitForProcessExit,
} from "./app.mjs";

test("parseElapsedSeconds：[[dd-]hh:]mm:ss → 秒；解析不出给 null", () => {
  assert.equal(parseElapsedSeconds("09:42"), 9 * 60 + 42);
  assert.equal(parseElapsedSeconds("01:02:03"), 3_723);
  assert.equal(parseElapsedSeconds("2-03:04:05"), 2 * 86_400 + 3 * 3_600 + 4 * 60 + 5);
  assert.equal(parseElapsedSeconds("00:00"), 0);
  assert.equal(parseElapsedSeconds(""), null);
  assert.equal(parseElapsedSeconds("abc"), null);
  assert.equal(parseElapsedSeconds("1:2:3:4"), null);
});

test("bundleAppPath：接受 .app 或 .app 内二进制，解析不出 .app 即报错", () => {
  const saved = process.env.LUMIR_ACCEPTANCE_BUNDLE;
  try {
    delete process.env.LUMIR_ACCEPTANCE_BUNDLE;
    assert.equal(bundleAppPath(), null, "未设 LUMIR_ACCEPTANCE_BUNDLE 时应返回 null（dev flavour）");

    process.env.LUMIR_ACCEPTANCE_BUNDLE = "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app";
    assert.equal(bundleAppPath(), "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app");

    process.env.LUMIR_ACCEPTANCE_BUNDLE =
      "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app/Contents/MacOS/lumir";
    assert.equal(
      bundleAppPath(),
      "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app",
      "README 的既有用法（指向 .app 内二进制）必须继续可用",
    );

    process.env.LUMIR_ACCEPTANCE_BUNDLE = "/tmp/wt/src-tauri/target/debug/lumir";
    assert.throws(
      () => bundleAppPath(),
      /必须是 …\/Lumir\.app/,
      "裸二进制不在 .app 内：拒绝回落「直接 exec」的旧通道（那是拉起安装版的成因）",
    );
  } finally {
    if (saved === undefined) delete process.env.LUMIR_ACCEPTANCE_BUNDLE;
    else process.env.LUMIR_ACCEPTANCE_BUNDLE = saved;
  }
});

test("listLumirInstances：只认 .app/Contents/MacOS/lumir 与 target/debug/lumir，跳过命令行里「提到」路径的进程", () => {
  const psRows = [
    "  123 00:05:00 /Applications/Lumir.app/Contents/MacOS/lumir",
    "  124 00:00:10 /tmp/wt/src-tauri/target/debug/lumir",
    "  125 00:00:02 sh -c tail -f /Applications/Lumir.app/Contents/MacOS/lumir",
    "  126 1-02:03:04 /tmp/wt/Lumir.app/Contents/MacOS/lumir",
    "  127 00:00:01 /usr/bin/sleep 100",
  ].join("\n");
  const comm = {
    123: "/Applications/Lumir.app/Contents/MacOS/lumir",
    124: "/tmp/wt/src-tauri/target/debug/lumir",
    125: "/bin/sh",
    126: "/tmp/wt/Lumir.app/Contents/MacOS/lumir",
    127: "/usr/bin/sleep",
  };
  const exec = (_cmd, args) => {
    if (args[0] === "-axo") return psRows;
    if (args[0] === "-o" && args[1] === "comm=") return comm[Number(args.at(-1))] ?? "";
    throw new Error(`unexpected ps args: ${JSON.stringify(args)}`);
  };
  const before = Date.now();
  const list = listLumirInstances(exec);
  assert.deepEqual(
    list.map((i) => [i.pid, i.kind]),
    [
      [123, "bundle"],
      [124, "dev"],
      [126, "bundle"],
    ],
    "125（命令行提到路径的 shell）不是实例；127 与本套件无关",
  );
  // startedAt 由 etime 反推：5 分钟前的进程应落在 [before-301s, before-299s] 窗口内。
  assert.ok(
    list[0].startedAt >= before - 301_000 && list[0].startedAt <= before - 299_000,
    `123 的 startedAt 应约等于 5 分钟前，实际 ${list[0].startedAt}（now=${before}）`,
  );
  const dayElapsed = (86_400 + 2 * 3_600 + 3 * 60 + 4) * 1000;
  assert.ok(
    list[2].startedAt >= before - dayElapsed - 1_000 && list[2].startedAt <= before - dayElapsed + 1_000,
    "带天数前缀的 etime 也必须解析（1-02:03:04 = 1 天 2 小时 3 分 4 秒）",
  );
});

test("listLumirInstances：隔离包装 exec 之后的 `lumir-bin` 现场也算本副本的 bundle 实例（P1-1）", () => {
  // change add-cron-notification-relaunch §8.2：`CFBundleExecutable` 是包装脚本 `lumir`，它
  // exec 的是 `lumir-bin`。进程活着的绝大多时间里 `ps` 的 command 与 comm 都是 `lumir-bin`——
  // 只认 `lumir` 的扫描会让套件在「首次 launch 等 pid」一步空转到超时（170/171/213/252 全红）。
  const psRows = [
    "  201 00:00:03 /tmp/wt/Lumir.app/Contents/MacOS/lumir-bin",
    "  202 00:00:02 /tmp/wt/Lumir.app/Contents/MacOS/lumir",
    "  203 00:00:01 sh -c tail -f /tmp/wt/Lumir.app/Contents/MacOS/lumir-bin",
    "  204 00:00:01 /tmp/wt/Lumir.app/Contents/MacOS/lumir-bin-helper",
  ].join("\n");
  const comm = {
    201: "/tmp/wt/Lumir.app/Contents/MacOS/lumir-bin",
    202: "/tmp/wt/Lumir.app/Contents/MacOS/lumir",
    203: "/bin/sh",
    204: "/tmp/wt/Lumir.app/Contents/MacOS/lumir-bin-helper",
  };
  const exec = (_cmd, args) => {
    if (args[0] === "-axo") return psRows;
    if (args[0] === "-o" && args[1] === "comm=") return comm[Number(args.at(-1))] ?? "";
    throw new Error(`unexpected ps args: ${JSON.stringify(args)}`);
  };
  assert.deepEqual(
    listLumirInstances(exec).map((i) => [i.pid, i.kind]),
    [
      [201, "bundle"],
      [202, "bundle"],
    ],
    "包装 exec 后的 lumir-bin 与包装瞬间的 lumir 都是本副本；命令行提到路径的 shell 与名字相近的进程都不算",
  );
  // 常量是单一来源：扫描判据里出现的就是这两个名字。
  assert.deepEqual(BUNDLE_EXEC_NAMES, ["lumir", "lumir-bin"]);
});

test("findBundleAppPid：按入口路径找得到 exec 之后的真二进制进程（同一份名字常量）", () => {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-pid-"));
  const appPath = path.join(root, "Lumir.app");
  const macos = path.join(appPath, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  const entry = path.join(macos, "lumir");
  writeFileSync(entry, "#!/bin/sh\nexec ...\n");
  writeFileSync(path.join(macos, "lumir-bin"), "binary");

  const psRows = [
    `  301 00:00:05 ${path.join(macos, "lumir-bin")}`,
    "  302 00:00:05 /Applications/Lumir.app/Contents/MacOS/lumir-bin",
  ].join("\n");
  const comm = {
    301: path.join(macos, "lumir-bin"),
    302: "/Applications/Lumir.app/Contents/MacOS/lumir-bin",
  };
  const exec = (_cmd, args) => {
    if (args[0] === "-axo") return psRows;
    if (args[0] === "-o" && args[1] === "comm=") return comm[Number(args.at(-1))] ?? "";
    throw new Error(`unexpected ps args: ${JSON.stringify(args)}`);
  };
  assert.equal(
    findBundleAppPid(entry, exec),
    301,
    "`bundleBinary()` 给的是入口路径，实际进程是 lumir-bin——精确匹配必须跨这两个名字",
  );
  // 安装版（另一个 .app）不能被认成本副本。
  assert.equal(findBundleAppPid(entry, exec), 301);
});

test("straysInClickWindow：只挑点击窗口内新起、且不是本次跑批自己的 bundle 实例", () => {
  const own = "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app/Contents/MacOS/lumir";
  const clickAt = 1_800_000_000_000;
  const instances = [
    // 本次跑批自己的实例：即使在窗口内也必须排除
    { pid: 10, cmd: own, kind: "bundle", startedAt: clickAt + 100 },
    // 点击窗口内新起的安装版：命中
    { pid: 11, cmd: "/Applications/Lumir.app/Contents/MacOS/lumir", kind: "bundle", startedAt: clickAt + 50 },
    // 点击前就在场的安装版：不命中（可能用户自己打开的）
    { pid: 12, cmd: "/Applications/Lumir.app/Contents/MacOS/lumir", kind: "bundle", startedAt: clickAt - 60_000 },
    // 开发实例：不归这条判据
    { pid: 13, cmd: "/tmp/wt/src-tauri/target/debug/lumir", kind: "dev", startedAt: clickAt + 10 },
    // 启动时刻读不出：不能归因
    { pid: 14, cmd: "/other/Lumir.app/Contents/MacOS/lumir", kind: "bundle", startedAt: null },
  ];
  assert.deepEqual(
    straysInClickWindow(instances, { sinceMs: clickAt, ownBinary: own }).map((i) => i.pid),
    [11],
    "只应清退点击窗口内新起的非本次实例；自身 / 旧实例 / dev / 时刻未知一律不动",
  );
  assert.deepEqual(
    straysInClickWindow(instances, { sinceMs: undefined, ownBinary: own }).map((i) => i.pid),
    [11, 12],
    "不传窗口时不按时刻过滤（仍排除自身与 dev）——调用方传 undefined 即显式放弃归因约束，正常路径都要传",
  );
});

test("straysInClickWindow：自己的实例按 pid 认——同路径的第二份副本必须能清退（M622）", () => {
  const own = "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app/Contents/MacOS/lumir";
  const clickAt = 1_800_000_000_000;
  const instances = [
    // 本次跑批的实例（被测 app）
    { pid: 10, cmd: own, kind: "bundle", startedAt: clickAt - 120_000 },
    // 点击拉起同一个 .app 的第二份副本：路径与本次相同，只能靠 pid 区分
    { pid: 15, cmd: own, kind: "bundle", startedAt: clickAt + 80 },
    { pid: 11, cmd: "/Applications/Lumir.app/Contents/MacOS/lumir", kind: "bundle", startedAt: clickAt + 50 },
  ];
  assert.deepEqual(
    straysInClickWindow(instances, { sinceMs: clickAt, ownBinary: own, ownPid: 10 }).map((i) => i.pid),
    [15, 11],
    "ownPid 在场时排除的是本次实例本身；同路径的第二份副本（pid 15）是游离实例",
  );
  assert.deepEqual(
    straysInClickWindow(instances, { sinceMs: clickAt, ownBinary: own, ownPid: null }).map((i) => i.pid),
    [11],
    "pid 未知时退回按本副本路径排除——宁可漏报也不误杀",
  );
});

test("readBundleId：从 .app 的 Info.plist 读 CFBundleIdentifier，读不到 / 读到空值即报错", () => {
  const plist = "/tmp/wt/Lumir.app/Contents/Info.plist";
  const ok = (_cmd, args) => {
    assert.equal(args[0], "-extract");
    assert.equal(args[1], "CFBundleIdentifier");
    assert.equal(args.at(-1), plist, "读的必须是本 .app 的 Info.plist");
    return "com.lumir.app.acceptance\n";
  };
  assert.equal(readBundleId("/tmp/wt/Lumir.app", ok), "com.lumir.app.acceptance");

  assert.throws(
    () =>
      readBundleId("/tmp/wt/Lumir.app", () => {
        const e = new Error("plutil failed");
        e.stderr = "Could not extract value, error: No value at that key path";
        throw e;
      }),
    /读不到打包实例的 CFBundleIdentifier/,
    "Info.plist 缺键 / 不可读必须报错，不回落字面量",
  );
  assert.throws(() => readBundleId("/tmp/wt/Lumir.app", () => "  \n"), /CFBundleIdentifier 为空/);
});

test("assertAcceptanceBundleIdentity：只有构建产物带验收 id 才放行", () => {
  const appPath = "/tmp/wt/Lumir.app";
  const productId = "com.lumir.app";

  assert.deepEqual(
    assertAcceptanceBundleIdentity({ appPath, bundleId: "com.lumir.app.acceptance", productId }),
    { appPath, bundleId: "com.lumir.app.acceptance", productBundleId: productId },
    "验收 id：放行并交出产物身份",
  );
  assert.equal(assertAcceptanceBundleIdentity({ appPath: null, productId }), null, "dev flavour 没有 .app 身份可核");

  assert.throws(
    () => assertAcceptanceBundleIdentity({ appPath, bundleId: productId, productId }),
    /仍是产品 id.*build-bundle\.mjs/s,
    "漏了 --config 的构建（产物 = 产品 id）必须判红并给重建命令",
  );
  assert.throws(
    () => assertAcceptanceBundleIdentity({ appPath, bundleId: "com.lumir.app.acceptance2", productId }),
    /与验收 id com\.lumir\.app\.acceptance 不一致/,
    "换了别的 id 同样判红：通知授权按 bundle id 记账，id 漂了就不可复现",
  );
});

test("waitForProcessExit：立即退出零等待、延迟退出提前返回、耗尽上界如实报失败", async () => {
  let clock = 0;
  const options = {
    everyMs: 50,
    now: () => clock,
    sleepFn: async (ms) => {
      clock += ms;
    },
  };
  assert.equal(await waitForProcessExit(async () => false, { ...options, timeoutMs: 2000 }), true);
  assert.equal(clock, 0);

  assert.equal(await waitForProcessExit(async () => clock < 120, { ...options, timeoutMs: 2000 }), true);
  assert.equal(clock, 150, "50ms 轮询在 150ms 首次看到 120ms 后的退出态");

  clock = 0;
  assert.equal(await waitForProcessExit(async () => true, { ...options, timeoutMs: 200 }), false);
  assert.equal(clock, 200, "仍在运行时最多等到原上界");
});

test("stopApp：dev 已退出时只发 SIGTERM，不付兜底等待", async () => {
  const kills = [];
  await stopApp(
    { flavour: "dev", child: { pid: 42 } },
    { kill: (target, signal) => kills.push([target, signal]), findDevPid: () => null },
  );
  assert.deepEqual(kills, [[-42, "SIGTERM"]]);
});

test("stopApp：dev 超过退出上界仍保留 SIGKILL 兜底", async () => {
  const kills = [];
  await stopApp(
    { flavour: "dev", child: { pid: 42 } },
    {
      kill: (target, signal) => kills.push([target, signal]),
      findDevPid: () => 123,
      wait: async () => false,
    },
  );
  assert.deepEqual(kills, [
    [-42, "SIGTERM"],
    [123, "SIGKILL"],
  ]);
});

test("stopApp：退出探测异常不继续 SIGKILL", async () => {
  const kills = [];
  await assert.rejects(
    stopApp(
      { flavour: "dev", child: { pid: 42 } },
      {
        kill: (target, signal) => kills.push([target, signal]),
        findDevPid: () => 123,
        wait: async () => {
          throw new Error("ps failed");
        },
      },
    ),
    /ps failed/,
  );
  assert.deepEqual(kills, [[-42, "SIGTERM"]]);
});

test("stopApp：bundle 已退出仍撤销本副本 LaunchServices 记录", async () => {
  const kills = [];
  const unregistered = [];
  await stopApp(
    { flavour: "bundle", child: { pid: 43 }, binary: "/tmp/Lumir.app/Contents/MacOS/lumir", appPath: "/tmp/Lumir.app" },
    {
      kill: (target, signal) => kills.push([target, signal]),
      findBundlePid: () => null,
      unregister: (cmd, args) => unregistered.push([cmd, args]),
    },
  );
  assert.deepEqual(kills, [[-43, "SIGTERM"]]);
  assert.equal(unregistered.length, 1);
  assert.deepEqual(unregistered[0][1], ["-u", "/tmp/Lumir.app"]);
});

// ── 隔离包装的静态前置门（change add-cron-notification-relaunch task 5.2）─────────────
//
// 判据是「拉起**之前**能不能证明隔离成立」：包装脚本在 exec 真二进制之前导出 XDG_CONFIG_HOME
// 与 HOME，隔离根来自 token 文件，token 必须等于本次 run 的 env。三条各有一个必须判红的反例
// （脚本缺 HOME / token 指别处 / 入口还是真二进制），否则这道门只是形式。

/** 造一份「已正确包装」的最小 .app：Info.plist + 包装脚本 + 真二进制占位。 */
function wrappedBundle({ script, execName = "lumir", tokenFile } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-isolation-"));
  const appPath = path.join(root, "Lumir.app");
  const macos = path.join(appPath, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  writeFileSync(
    path.join(appPath, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.lumir.app.acceptance</string>
<key>CFBundleExecutable</key><string>${execName}</string>
</dict></plist>`,
  );
  writeFileSync(
    path.join(macos, execName),
    script ??
      `#!/bin/sh
set -eu
iso="$(cat ${tokenFile} 2>/dev/null || true)"
XDG_CONFIG_HOME="\${iso}"
HOME="\${iso}/home"
export XDG_CONFIG_HOME
export HOME
exec "$(dirname "$0")/lumir-bin" "$@"
`,
  );
  return { root, appPath };
}

test("assertBundleIsolation：包装齐备 + token 指向本次 run 的 env ⇒ 通过", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-isolation-env-"));
  const tokenFile = path.join(root, "isolate");
  const env = path.join(root, "acceptance", "2026-10-28", "env");
  const { appPath } = wrappedBundle({ root, tokenFile });
  writeFileSync(tokenFile, `${env}\n`);
  const out = await assertBundleIsolation({ appPath, env, tokenFile });
  assert.equal(out.execName, "lumir");
});

test("assertBundleIsolation：入口还是真二进制 ⇒ 拒跑（隔离根本没建立）", async () => {
  const { root, appPath } = wrappedBundle({ script: "\u0007ELF-binary-placeholder" });
  const tokenFile = path.join(root, "isolate");
  writeFileSync(tokenFile, path.join(root, "env"));
  await assert.rejects(
    () => assertBundleIsolation({ appPath, env: path.join(root, "env"), tokenFile }),
    /不是隔离包装脚本/,
  );
});

test("assertBundleIsolation：脚本缺 HOME ⇒ 拒跑（缺 XDG 时会回落 $HOME/.config）", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-isolation-nohome-"));
  const tokenFile = path.join(root, "isolate");
  const { appPath } = wrappedBundle({
    tokenFile,
    script: `#!/bin/sh
XDG_CONFIG_HOME="$ISO"
exec "$(dirname "$0")/lumir-bin" "$@"
`,
  });
  writeFileSync(tokenFile, path.join(root, "env"));
  await assert.rejects(
    () => assertBundleIsolation({ appPath, env: path.join(root, "env"), tokenFile }),
    /没有导出 HOME/,
  );
});

test("assertBundleIsolation：token 指向别的目录 ⇒ 拒跑（跨进程点击会读错目录）", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-isolation-other-"));
  const tokenFile = path.join(root, "isolate");
  const { appPath } = wrappedBundle({ tokenFile });
  writeFileSync(tokenFile, path.join(root, "some-other-env"));
  await assert.rejects(
    () => assertBundleIsolation({ appPath, env: path.join(root, "env"), tokenFile }),
    /与本次 run 的配置目录/,
  );
});

test("assertBundleIsolation：token 缺失 ⇒ 拒跑（不回落真实配置）", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lumir-acceptance-isolation-missing-"));
  const missingToken = path.join(root, "missing-token");
  const { appPath } = wrappedBundle({ tokenFile: missingToken });
  await assert.rejects(
    () => assertBundleIsolation({ appPath, env: path.join(root, "env"), tokenFile: missingToken }),
    /隔离 token.*缺失/,
  );
});

// ── `.app` 根输入的归一（r1-2 P2-1）────────────────────────────────────────────────────
//
// `LUMIR_ACCEPTANCE_BUNDLE` 有两种合法写法（`.app` 根 / `.app` 内二进制，`bundleAppPath` 与
// 上面的单测都声明了这一点）。按进程找 pid 只能按可执行路径匹配，因此两种写法必须在**唯一
// 归一点**折算成 `Contents/MacOS/lumir`——漏了它，传 `.app` 根会组出 `.<app>/lumir-bin` 这种
// 不存在的字面：初次 launch 等 pid 超时、收尾也收不到。

/** 造一棵真实存在的 `.app` 骨架：入口脚本 + exec 的真二进制。 */
function fakeBundleApp(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const appPath = path.join(root, "Lumir.app");
  const macos = path.join(appPath, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  writeFileSync(path.join(macos, "lumir"), "#!/bin/sh\nexec lumir-bin\n");
  writeFileSync(path.join(macos, "lumir-bin"), "binary");
  return { root, appPath, entry: path.join(macos, "lumir"), real: path.join(macos, "lumir-bin") };
}

/** `ps` 现场只含一条本副本的实例：command 与 comm 都是 exec 之后的 `lumir-bin`。 */
function psWithRealBinary(realPath, pid = 301) {
  const psRows = [`  ${pid} 00:00:07 ${realPath}`].join("\n");
  return (_cmd, args) => {
    if (args[0] === "-axo") return psRows;
    if (args[0] === "-o" && args[1] === "comm=") return realPath;
    throw new Error(`unexpected ps args: ${JSON.stringify(args)}`);
  };
}

test("bundleEntryPath：`.app` 根与 `.app` 内二进制折算成同一个入口路径", () => {
  const { appPath, entry } = fakeBundleApp("lumir-bundle-entry-");
  assert.equal(bundleEntryPath(appPath), entry, ".app 根 → Contents/MacOS/lumir");
  assert.equal(bundleEntryPath(entry), entry, "已经是入口路径时原样返回（幂等）");
  assert.equal(bundleEntryPath(null), null);
});

test("findBundleAppPid：`.app` 根输入也能发现 exec 之后的 lumir-bin 进程（初次 launch 用的就是这个入口）", () => {
  const { appPath, real } = fakeBundleApp("lumir-bundle-root-pid-");
  const exec = psWithRealBinary(real);
  // 初次 launch（`waitForBundlePid`）→ `findBundleAppPid`：传的是 `bundleBinary()` 的原值，
  // 也就是 `.app` 根这种受支持写法。r1-2 的现场就是这里返回 null。
  assert.equal(findBundleAppPid(appPath, exec), 301, "`.app` 根必须归一后匹配到 lumir-bin");
  assert.equal(findBundleAppPid(bundleEntryPath(appPath), exec), 301, "入口路径同样匹配");
});

test("stopApp：handle.binary 是 `.app` 根时按同一归一点收到 exec 之后的进程（收尾不漏判）", async () => {
  const { appPath, real } = fakeBundleApp("lumir-bundle-root-stop-");
  const exec = psWithRealBinary(real);
  const killed = [];
  const handle = {
    flavour: "bundle",
    appPath,
    // 旧形态：调用方直接把 `.app` 根放进 handle.binary（launchApp 现在存归一后的入口，
    // 但收尾仍必须容忍两种写法——同一归一点在 `binaryPaths` 里）。
    binary: appPath,
    child: { pid: 424_242 },
  };
  await stopApp(handle, {
    findBundlePid: (binPath) => findBundleAppPid(binPath, exec),
    kill: (pid, signal) => {
      killed.push([pid, signal]);
      return true;
    },
    wait: async () => true,
    unregister: () => {},
  });
  assert.deepEqual(killed[0], [301, "SIGTERM"], "收尸的目标必须是 ps 里那条 lumir-bin 进程");
});
