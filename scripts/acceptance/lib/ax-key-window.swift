// 套件的 key window 读数（M678）：经 Accessibility API 读目标 app 的 **AXFocusedWindow**，
// 并核对它就是本套件操作的那扇主窗口（AXWindows[0]）。
//
// 为什么需要它：`focusWindow click: true` 的合同是「窗口成为 key window + webview/编辑器拿到
// 焦点」。编辑器焦点证明不了窗口是 key——但 **窗口自己的 `AXFocused` 属性在本 app 上恒 false**
// （M678 真机实测：编辑器有焦点、滚轮/键盘都可用时仍报 false），拿它当判据会把正常跑批判成
// INVALID。`AXFocusedWindow`（app 级的「当前聚焦窗口」）才是 AX 侧的 key window 读数：
// M678 探针在可用现场读到 `focusedWindowErr=0 ... isFirstWindow=true`。
//
// 用法：swift ax-key-window.swift <pid>
// 成功打出一行 `focusedWindow=true|false title=<窗口标题>`；读 AXWindows 失败时 stderr + 非零退出
// （调用方按「读不到」处理，不猜）。
// 前提：调用进程有辅助功能权限（与 doubleClick / resizeWindow 同）。
import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let pid = pid_t(args[1]) else {
    FileHandle.standardError.write("usage: ax-key-window <pid>\n".data(using: .utf8)!)
    exit(2)
}

let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
let err = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
guard err == .success, let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
    FileHandle.standardError.write("ax-key-window: 读 AXWindows 失败（\(err.rawValue)）\n".data(using: .utf8)!)
    exit(1)
}

var focusedRef: CFTypeRef?
let focusedErr = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focusedRef)
// 判据 = 「app 的聚焦窗口存在，且就是 AXWindows[0]（套件操作的主窗口）」。
// 读不到聚焦窗口（属性错误 / 空值）= 窗口没有拿到 key 状态——这正是 M667 的现场形态。
var focusedWindow = false
if focusedErr == .success, let fw = focusedRef, CFGetTypeID(fw) == AXUIElementGetTypeID() {
    focusedWindow = CFEqual(windows[0], fw as! AXUIElement)
}

var titleRef: CFTypeRef?
_ = AXUIElementCopyAttributeValue(windows[0], kAXTitleAttribute as CFString, &titleRef)
let title = (titleRef as? String) ?? "?"
print("focusedWindow=\(focusedWindow) title=\(title)")
