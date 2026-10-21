// scripts/acceptance/lib/app.test.mjs —— app.mjs 的纯函数自测（M619：bundle 启动方式与
// 实例扫描）。不起真机、不需要 app、不碰验收 vault / 用户的 ~/.config/lumir。
//
// 跑法（与 execute.test.mjs 同例：套件自测不进常驻门禁，改过相关实现后手跑）：
//   node --test scripts/acceptance/lib/app.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { bundleAppPath, listLumirInstances, parseElapsedSeconds, straysInClickWindow } from "./app.mjs";

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
