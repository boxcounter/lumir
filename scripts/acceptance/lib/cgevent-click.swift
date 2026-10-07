// 套件的双击注入通道（M209）：用 CGEvent 显式投递带 clickState 的点击。
//
// 为什么需要它：KimiCU 的注入通道造不出 WKWebView 的 DOM `dblclick`——坐标 `count: 2`、
// AX 索引 `count: 2`（AXPress ×2）、两次独立 `click`、`drag_paths` 两条单点路径都试过（M184）；
// 而 `swift` + `CGEvent` 显式设 `kCGMouseEventClickState = 1 / 2` 能造出来（M209 实测：树行
// 的双击固定效果与图片 lightbox 遮罩打开两条独立判据同时成立）。见 README「已知边界」。
//
// 用法：swift cgevent-click.swift <x> <y> <mode> [pid | x2 y2]
//   mode 0 = 只把光标移到 (x,y)（不动鼠标键；用于收尾复位光标）
//   mode 1 = 单击（clickState=1）
//   mode 2 = 双击（clickState=1 然后 2，间隔 60ms）——**套件动作 `doubleClick` 用这条**
//   mode 3 = 双击变体（间隔 150ms + 两次事件各带独立 timestamp）
//   mode 4 = 双击变体：直接投给目标进程（CGEventPostToPid，需 pid）——绕开 window server 对
//            HID tap 事件的 clickCount 重算，用于区分「clickState 被丢」与「WKWebView 不认合成双击」
//   mode 5 = 拖拽（需 x2 y2）：leftMouseDown at (x,y) → 24 步 leftMouseDragged 插值到 (x2,y2) →
//            leftMouseUp——**套件动作 `drag` 用这条**（M228：KimiCU 的 drag 工具在 WKWebView 里
//            连文本选择都造不出来，与 dblclick 同一类注入边界；CGEvent 显式拖拽序列可用）。
//   mode 6 = 修饰键点击（需 mods [count]）：鼠标 down/up 带**修饰键 flags** 投递——DOM 侧因此拿到
//            `metaKey` / `ctrlKey` / `shiftKey` / `altKey` 为真的点击（与 Playwright 的
//            `click({ modifiers })` 同形）。**套件动作 `click` 的 `target.modifiers` 用这条**：
//            KimiCU 的 click 没有修饰键参数（工具 schema 实测），⌘-Click 只能走这里。
//            mods 是 `,` 分隔的 cmd|shift|ctrl|opt（别名集与执行器一侧同源）。
// 坐标是 Quartz 全局坐标（原点 = 主屏左上角，单位 pt）；KimiCU 的 AX dump 不给这个空间
// （mode=ax 给窗口局部点、要加 window_bounds 原点；mode=full 给截图像素），换算在 execute.mjs 里。
//
// 副作用：会移动真实光标，并在前台窗口上产生真实点击。套件用它时先 `focusWindow` 拿前台。
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[1]), let y = Double(args[2]), let mode = Int(args[3]) else {
    FileHandle.standardError.write("usage: cgevent-click <x> <y> <mode 0|1|2|3|4|5|6> [pid | x2 y2 | mods [count]]\n".data(using: .utf8)!)
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

/// 修饰键别名 → CGEventFlags（M379，mode 6）。别名集与执行器一侧（execute.mjs 的
/// MODIFIER_ALIASES）同源：`meta`/`cmd` 都是 ⌘。
func modifierFlags(_ names: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for name in names {
        switch name.lowercased() {
        case "meta", "cmd", "command", "super": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "control", "ctrl": flags.insert(.maskControl)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        default: break
        }
    }
    return flags
}

/// 带修饰键 flag 的点击（M379，mode 6）：down/up 两次事件都带同一组 flags——WebKit 的
/// `MouseEvent.metaKey` 等取自该事件的 `NSEvent.modifierFlags`，因此无需真的按下修饰键。
@inline(__always) func clickWithFlags(_ p: CGPoint, clickCount: Int64, flags: CGEventFlags) {
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
    for e in [down, up] {
        e?.flags = flags
        e?.setIntegerValueField(.mouseEventClickState, value: clickCount)
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
case 5:
    guard args.count >= 6, let x2 = Double(args[4]), let y2 = Double(args[5]) else {
        FileHandle.standardError.write("mode 5 需要第 5/6 个参数：拖拽终点 x2 y2\n".data(using: .utf8)!)
        exit(2)
    }
    let to = CGPoint(x: x2, y: y2)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left))
    usleep(80_000)
    let dragSteps = 24
    for i in 1...dragSteps {
        let p = CGPoint(
            x: point.x + (to.x - point.x) * Double(i) / Double(dragSteps),
            y: point.y + (to.y - point.y) * Double(i) / Double(dragSteps),
        )
        post(CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
        usleep(12_000)
    }
    usleep(40_000)
    post(CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left))
case 6:
    guard args.count >= 5 else {
        FileHandle.standardError.write("mode 6 需要第 5 个参数：修饰键清单（`,` 分隔的 cmd|shift|ctrl|opt）\n".data(using: .utf8)!)
        exit(2)
    }
    let names = args[4].split(separator: ",").map(String.init).filter { !$0.isEmpty }
    let flags = modifierFlags(names)
    guard !flags.isEmpty else {
        FileHandle.standardError.write("mode 6 的修饰键清单里没有已知键（cmd|shift|ctrl|opt 及其别名），实际 \"\(args[4])\"\n".data(using: .utf8)!)
        exit(2)
    }
    let count = args.count >= 6 ? (Int64(args[5]) ?? 1) : 1
    clickWithFlags(point, clickCount: count, flags: flags)
default:
    FileHandle.standardError.write("unknown mode \(mode)\n".data(using: .utf8)!)
    exit(2)
}

usleep(120_000)
let after = CGEvent(source: nil)?.location ?? .zero
let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
print("mode=\(mode) target=\(Int(point.x)),\(Int(point.y)) cursor_before=\(Int(before.x)),\(Int(before.y)) cursor_after=\(Int(after.x)),\(Int(after.y)) frontmost=\(front)")
