// 套件的显示器与系统焦点窗口读数通道（LUMIR_ACCEPTANCE_DISPLAY=secondary 的输入）。
//
// 为什么需要它：副屏放置要回答两件事——「现在有几块屏、各自的可见区在哪」以及「用户此刻在
// 哪块屏上」（焦点窗口所在屏）。前者只能从 `NSScreen` 读，后者只能从系统级 AX 读
// （`AXUIElementCreateSystemWide` → `kAXFocusedApplicationAttribute` → `kAXFocusedWindowAttribute`）。
// 两者都是**只读**：本脚本不移动、不 resize 任何窗口——移动只由 `ax-window.swift` 对本跑批
// 自己的 pid 执行（归属判据见 `lib/display.mjs` 与 README「副屏放置」）。
//
// 坐标系：`NSScreen.frame` / `visibleFrame` 是 Cocoa 坐标（原点在主屏左下、y 向上），而 AX 的
// 窗口位置是 Quartz 坐标（原点在主屏左上、y 向下）。这里统一折算成 Quartz（与 `window_bounds`
// 同一空间），JS 侧因此不需要再做一次坐标系换算。主屏高度取 `NSScreen.screens.first` 的 frame
// 高度（带菜单栏那块）。
//
// 输出：一行 JSON（`.sortedKeys`，键序稳定，便于证据里逐字比对）：
//   { "screens": [ { index, id, name, main, scale, frame:{x,y,w,h}, visible:{x,y,w,h} } ],
//     "focus": { app, pid, bounds:{x,y,w,h} } | null,
//     "focusError": "…" }
// focus 读不到时不是失败：JS 侧按「焦点屏不可判定」回落到验收窗口所在屏 / 主屏，并把
// focusError 写进证据（不静默当成「没有焦点窗口」——REVIEW.md「读不到当成空」条）。
// 取不到任何显示器才以非零退出。
import AppKit
import ApplicationServices
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("ax-display: \(message)\n".data(using: .utf8)!)
    exit(1)
}

guard let primary = NSScreen.screens.first else {
    fail("取不到任何显示器")
}

/// Cocoa 矩形 → Quartz 矩形（以主屏左上为原点、y 向下）。主屏自身的 frame 是 (0,0,w,h)。
func quartzRect(_ rect: NSRect) -> [String: Int] {
    let top = primary.frame.height - (rect.origin.y + rect.height)
    return [
        "x": Int(rect.origin.x.rounded()),
        "y": Int(top.rounded()),
        "w": Int(rect.width.rounded()),
        "h": Int(rect.height.rounded()),
    ]
}

var screens: [[String: Any]] = []
for (index, screen) in NSScreen.screens.enumerated() {
    let number = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    screens.append([
        "index": index,
        "id": Int(number),
        "name": screen.localizedName,
        "main": screen == primary,
        "scale": screen.backingScaleFactor,
        "frame": quartzRect(screen.frame),
        "visible": quartzRect(screen.visibleFrame),
    ])
}

/// 窗口的 AX position / size；任一读不到回 nil（调用方把「读不到」与「零尺寸」分开处理）。
func axBounds(_ element: AXUIElement) -> [String: Int]? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          let posValue = posRef, CFGetTypeID(posValue) == AXValueGetTypeID(),
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let sizeValue = sizeRef, CFGetTypeID(sizeValue) == AXValueGetTypeID()
    else { return nil }
    AXValueGetValue(posValue as! AXValue, .cgPoint, &pos)
    AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
    return [
        "x": Int(pos.x.rounded()),
        "y": Int(pos.y.rounded()),
        "w": Int(size.width.rounded()),
        "h": Int(size.height.rounded()),
    ]
}

var focus: [String: Any]?
var focusError: String?
let systemWide = AXUIElementCreateSystemWide()
var focusedAppRef: CFTypeRef?
let appErr = AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &focusedAppRef)
if appErr != .success || focusedAppRef == nil {
    focusError = "读不到系统焦点应用（AXError \(appErr.rawValue)）"
} else {
    let app = focusedAppRef as! AXUIElement
    var pid: pid_t = 0
    let pidErr = AXUIElementGetPid(app, &pid)
    let appName = pid > 0 ? (NSRunningApplication(processIdentifier: pid)?.localizedName ?? "?") : "?"
    var focusedWindowRef: CFTypeRef?
    let winErr = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focusedWindowRef)
    if winErr != .success || focusedWindowRef == nil {
        focusError = "系统焦点应用 \(appName)（pid \(pid)）没有 AXFocusedWindow（AXError \(winErr.rawValue)）"
    } else if let bounds = axBounds(focusedWindowRef as! AXUIElement) {
        focus = ["app": appName, "pid": Int(pid), "bounds": bounds]
        if pidErr != .success { focusError = "AXUIElementGetPid 失败（AXError \(pidErr.rawValue)）" }
    } else {
        focusError = "系统焦点窗口读不到 AXPosition / AXSize（应用 \(appName)，pid \(pid)）"
    }
}

var root: [String: Any] = ["screens": screens]
if let focus { root["focus"] = focus }
if let focusError { root["focusError"] = focusError }
guard let data = try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys]),
      let text = String(data: data, encoding: .utf8)
else {
    fail("JSON 序列化失败")
}
print(text)
