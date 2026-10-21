// scripts/acceptance/lib/app.test.mjs —— app.mjs 的纯函数自测（M619：bundle 启动方式与
// 实例扫描）。不起真机、不需要 app、不碰验收 vault / 用户的 ~/.config/lumir。
//
// 跑法（与 execute.test.mjs 同例：套件自测不进常驻门禁，改过相关实现后手跑）：
//   node --test scripts/acceptance/lib/app.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAcceptanceBundleIdentity,
  bundleAppPath,
  listLumirInstances,
  parseElapsedSeconds,
  readBundleId,
  straysInClickWindow,
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
