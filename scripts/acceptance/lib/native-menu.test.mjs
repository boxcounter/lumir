// 原生菜单通道的自测：场景 `clickMenuItem` 与安装版暂停的 `triggerSaveAllMenuItem` 共用这一份
// 实现，标题必须以独立 argv 传给 Swift helper，失败必须如实抛错（不静默、不降级）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { MENU_HELPER_PATH, clickNativeMenuItem, menuClickInvocation } from "./native-menu.mjs";

test("invocation：pid / menu / item 是独立 argv，不拼进脚本源码", () => {
  const invocation = menuClickInvocation(4242, "File", "Save All");
  assert.equal(invocation.command, "/usr/bin/swift");
  assert.equal(invocation.args.length, 4);
  assert.ok(invocation.args[0].endsWith(MENU_HELPER_PATH));
  assert.deepEqual(invocation.args.slice(1), ["4242", "File", "Save All"]);

  // 标题里的引号 / 反斜杠原样作为 argv，不会变成 AppleScript / Swift 源码
  const tricky = menuClickInvocation(1, 'Weird "Menu"', "Item \\ Name");
  assert.equal(tricky.args[2], 'Weird "Menu"');
  assert.equal(tricky.args[3], "Item \\ Name");
});

test("clickNativeMenuItem：执行 helper 并返回 trim 后的 stdout", () => {
  const calls = [];
  const out = clickNativeMenuItem({
    pid: 4242,
    menu: "File",
    item: "Save All",
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      return "pressed File → Save All\n";
    },
  });
  assert.equal(out, "pressed File → Save All");
  assert.deepEqual(calls[0].args.slice(1), ["4242", "File", "Save All"]);
  assert.deepEqual(calls[0].options, { encoding: "utf8", timeout: 30_000 });
});

test("clickNativeMenuItem：非零退出 → 抛错，消息带 helper 的 stderr 与 status", () => {
  assert.throws(
    () =>
      clickNativeMenuItem({
        pid: 4242,
        menu: "File",
        item: "Save All",
        execFile: () => {
          throw Object.assign(new Error("boom"), {
            stderr: "ax-menu: 菜单栏没有「File」\n",
            status: 1,
          });
        },
      }),
    (error) =>
      /菜单栏没有「File」/.test(error.message) &&
      error.status === 1 &&
      /菜单栏没有「File」/.test(String(error.stderr)),
  );
});

test("clickNativeMenuItem：空 stdout 也算成功（菜单项在场由 helper 退出码证明）", () => {
  assert.equal(
    clickNativeMenuItem({ pid: 4242, menu: "File", item: "Save All", execFile: () => "" }),
    "",
  );
});
