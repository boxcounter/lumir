// 原生菜单点击的唯一通道：按 **pid** 找到目标 app 的 AXMenuBar，按标题打开菜单并按下菜单项。
//
// 为什么需要它：KimiCU 的 AX 文本把整条菜单栏渲染成**一个** `AXMenuBar` 节点，子项以
// `[2] Apple; [4] Lumir; [6] File; …` 的内联形式附在行尾——`parseNodes` 不会为它们生成
// `AXMenuBarItem` 节点，因此按 role/name 轮询菜单项的写法在真实安装版上永远等不到（不是产品
// 菜单缺失：同一份 dump 的菜单栏里有 File）。本 helper 直接走 Accessibility API（菜单栏的真实
// AX 树里子项是独立元素），不依赖 KimiCU 的文本折叠。
//
// 两个消费者共用这一份实现（REVIEW.md「同一语义两处真源」条）：
//   - 场景动作 `clickMenuItem`（880 / 880b 真机 PASS）；
//   - 安装版暂停的保存屏障 `triggerSaveAllMenuItem`（File → Save All）。
//
// 用法：`swift ax-menu.swift <pid> <menu title> <item title>`。菜单 / 菜单项以**独立 argv**
// 传给 helper，不拼进脚本字符串——标题里出现引号 / 反斜杠也不会变成 AppleScript / Swift 源码。
// 成功 stdout 打印 `pressed <menu> → <item>`；失败 stderr + 非零退出，带回现有菜单 / 项标题，
// 失败归因不必回来加探针。前提：调用进程有辅助功能权限（与 ax-window.swift 同一前提）。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./util.mjs";

/** Swift helper 相对仓库根的路径（错误信息与单测共用这一份）。 */
export const MENU_HELPER_PATH = "scripts/acceptance/lib/ax-menu.swift";

/**
 * 原生菜单点击的调用构造（纯函数，可单测）：pid / menu / item 是三个独立 argv。
 * 失败信息里也用它，保证「跑的命令」与「报的命令」是同一份。
 */
export function menuClickInvocation(pid, menu, item) {
  return {
    command: "/usr/bin/swift",
    args: [path.join(repoRoot(), MENU_HELPER_PATH), String(pid), menu, item],
  };
}

/**
 * 执行一次原生菜单点击，返回 helper 的 stdout（已 trim）。
 *
 * `execFile` 只为单测注入；默认 `execFileSync`。失败时抛普通 `Error`，消息优先取 helper 的
 * stderr（里面有现有菜单 / 项标题，归因不必再探），并保留 `status` / `stderr` 供上层判据使用。
 * **不做重试**：helper 已经等过菜单项就绪（5 × 200ms）；重复打开同一菜单可能把已打开的菜单
 * 再切换一次，重试反而会把「没按到」变成「按错」。
 */
export function clickNativeMenuItem({
  pid,
  menu,
  item,
  execFile = execFileSync,
  timeoutMs = 30_000,
} = {}) {
  const invocation = menuClickInvocation(pid, menu, item);
  try {
    return String(execFile(invocation.command, invocation.args, { encoding: "utf8", timeout: timeoutMs }) ?? "").trim();
  } catch (e) {
    const stderr = e?.stderr ? String(e.stderr).trim() : "";
    const error = new Error(stderr || e?.message || String(e));
    if (e?.status !== undefined) error.status = e.status;
    error.stderr = e?.stderr;
    throw error;
  }
}
