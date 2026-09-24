// 套件的双击注入通道（M209）：用 CGEvent 显式投递带 clickState 的点击。
//
// 为什么需要它：KimiCU 的注入通道造不出 WKWebView 的 DOM `dblclick`——坐标 `count: 2`、
// AX 索引 `count: 2`（AXPress ×2）、两次独立 `click`、`drag_paths` 两条单点路径都试过（M184）；
// 而 `swift` + `CGEvent` 显式设 `kCGMouseEventClickState = 1 / 2` 能造出来（M209 实测：树行
// 的双击固定效果与图片 lightbox 遮罩打开两条独立判据同时成立）。见 README「已知边界」。
//
// 用法：swift cgevent-click.swift <x> <y> <mode> [pid]
//   mode 0 = 只把光标移到 (x,y)（不动鼠标键；用于收尾复位光标）
//   mode 1 = 单击（clickState=1）
//   mode 2 = 双击（clickState=1 然后 2，间隔 60ms）——**套件动作 `doubleClick` 用这条**
//   mode 3 = 双击变体（间隔 150ms + 两次事件各带独立 timestamp）
//   mode 4 = 双击变体：直接投给目标进程（CGEventPostToPid，需 pid）——绕开 window server 对
//            HID tap 事件的 clickCount 重算，用于区分「clickState 被丢」与「WKWebView 不认合成双击」
// 坐标是 Quartz 全局坐标（原点 = 主屏左上角，单位 pt）；KimiCU 的 AX dump 不给这个空间
// （mode=ax 给窗口局部点、要加 window_bounds 原点；mode=full 给截图像素），换算在 execute.mjs 里。
//
// 副作用：会移动真实光标，并在前台窗口上产生真实点击。套件用它时先 `focusWindow` 拿前台。
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[1]), let y = Double(args[2]), let mode = Int(args[3]) else {
    FileHandle.standardError.write("usage: cgevent-click <x> <y> <mode 0|1|2|3>\n".data(using: .utf8)!)
    exit(2)
}
let point = CGPoint(x: x, y: y)
let source = CGEventSource(stateID: .hidSystemState)

@inline(__always) func post(_ event: CGEvent?) {
    event?.post(tap: .cghidEventTap)
}

/// 同一序列但**直接投给目标进程**（绕开 window server 的 HID tap 路径）。
@inline(__always) func clickToPid(_ p: CGPoint, clickCount: Int64, pid: pid_t) {
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
    for e in [down, up] { e?.setIntegerValueField(.mouseEventClickState, value: clickCount) }
    down?.postToPid(pid)
    usleep(25_000)
    up?.postToPid(pid)
}

@inline(__always) func moveCursor(_ p: CGPoint) {
    post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
}

/// 一次完整的按下/抬起，两次事件都带同一个显式 clickCount。
@inline(__always) func click(_ p: CGPoint, clickCount: Int64, useTimestamp: Bool = false) {
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
    for e in [down, up] {
        e?.setIntegerValueField(.mouseEventClickState, value: clickCount)
        if useTimestamp { e?.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
    }
    post(down)
    usleep(25_000)
    post(up)
}

let before = CGEvent(source: nil)?.location ?? .zero
moveCursor(point)
usleep(150_000)

switch mode {
case 0:
    break
case 1:
    click(point, clickCount: 1)
case 2:
    click(point, clickCount: 1)
    usleep(60_000)
    click(point, clickCount: 2)
case 3:
    click(point, clickCount: 1, useTimestamp: true)
    usleep(150_000)
    click(point, clickCount: 2, useTimestamp: true)
case 4:
    guard args.count >= 5, let target = pid_t(args[4]) else {
        FileHandle.standardError.write("mode 4 需要第 5 个参数：目标 pid\n".data(using: .utf8)!)
        exit(2)
    }
    clickToPid(point, clickCount: 1, pid: target)
    usleep(60_000)
    clickToPid(point, clickCount: 2, pid: target)
default:
    FileHandle.standardError.write("unknown mode \(mode)\n".data(using: .utf8)!)
    exit(2)
}

usleep(120_000)
let after = CGEvent(source: nil)?.location ?? .zero
let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
print("mode=\(mode) target=\(Int(point.x)),\(Int(point.y)) cursor_before=\(Int(before.x)),\(Int(before.y)) cursor_after=\(Int(after.x)),\(Int(after.y)) frontmost=\(front)")
