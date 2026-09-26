// 套件的窗口尺寸调整通道（M236）：经 Accessibility API 直接设目标窗口的 AXSize。
//
// 为什么需要它：窄窗退让（标题栏版本号 <640px 退 modeline）要在真机 WKWebView 下验，
// 而 KimiCU 的工具集没有 resize——鼠标拖窗口边缘倒是可以，但起拖点判定（边缘命中区）
// 与落点精度都不稳定，验收要的是确定值。AX 写尺寸是确定值通道（与双击/拖拽的
// CGEvent 通道互补：那边要「真实指针语义」，这边要「精确几何」）。
//
// 用法：swift ax-window.swift <pid> <width> <height>
// 成功打出一行 `size=<w>x<h>`（回读的生效值）；失败 stderr + 非零退出。
// 前提：调用进程有辅助功能权限（套件跑在已授权的终端里；没权限时 AX error 会如实报出）。
import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let pid = pid_t(args[1]), let w = Double(args[2]), let h = Double(args[3]) else {
    FileHandle.standardError.write("usage: ax-window <pid> <width> <height>\n".data(using: .utf8)!)
    exit(2)
}

let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
var err = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
guard err == .success, let windows = windowsRef as? [AXUIElement], let win = windows.first else {
    FileHandle.standardError.write("ax-window: 读 AXWindows 失败（\(err.rawValue)）\n".data(using: .utf8)!)
    exit(1)
}

var size = CGSize(width: w, height: h)
guard let sizeValue = AXValueCreate(.cgSize, &size) else {
    FileHandle.standardError.write("ax-window: AXValueCreate 失败\n".data(using: .utf8)!)
    exit(1)
}
err = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sizeValue)
guard err == .success else {
    FileHandle.standardError.write("ax-window: 设 AXSize 失败（\(err.rawValue)）\n".data(using: .utf8)!)
    exit(1)
}

// 回读生效值（窗口管理器可能钳到最小尺寸——断言要对着真实结果，不是请求值）
var backRef: CFTypeRef?
err = AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &backRef)
var back = CGSize.zero
if err == .success, let v = backRef, CFGetTypeID(v) == AXValueGetTypeID() {
    AXValueGetValue(v as! AXValue, .cgSize, &back)
}
print("size=\(Int(back.width))x\(Int(back.height))")
