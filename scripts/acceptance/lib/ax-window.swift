// 套件的窗口尺寸调整通道（M236；M762 改按标准窗选主窗）：经 Accessibility API 直接设目标窗口的
// AXSize。
//
// 为什么需要它：窄窗退让（标题栏版本号 <640px 退 modeline）要在真机 WKWebView 下验，
// 而 KimiCU 的工具集没有 resize——鼠标拖窗口边缘倒是可以，但起拖点判定（边缘命中区）
// 与落点精度都不稳定，验收要的是确定值。AX 写尺寸是确定值通道（与双击/拖拽的
// CGEvent 通道互补：那边要「真实指针语义」，这边要「精确几何」）。
//
// **写到哪扇窗（M762）**：旧实现写 `AXWindows[0]`。多出一扇辅助窗（112 族 `AXDialog "Window"`）
// 之后这个索引假设会落到辅助窗上——写尺寸失败（triage §3.4 的 `-25200` 族，117 / 126 / 39），
// 或者写成功但主窗没动。现在与 `ax-key-window.swift` 共用同一段选窗代码（`AXSubrole ==
// AXStandardWindow`，多扇时按 `AXMain` 消歧）；选不出来就**报错并带上窗口清单**，不猜一扇去写。
//
// 用法：swift ax-window.swift <pid> <width> <height>
// 成功打出一行 `size=<w>x<h> window=<被写窗口的身份>`（回读的生效值）；失败 stderr + 非零退出，
// stderr 里带上被选 / 场上窗口的 role、subrole、标题与 frame——失败归因不必再回来加探针。
// 前提：调用进程有辅助功能权限（套件跑在已授权的终端里；没权限时 AX error 会如实报出）。
import ApplicationServices
import Foundation

// >>> 主窗选择（M762）：以下这段代码在 ax-key-window.swift 与 ax-window.swift 里**逐字相同**
//（漂移由 execute.test.mjs 的块比对挡住）。AX 的 AXWindows 顺序不可依赖——辅助窗（112 族
// `AXDialog "Window"`）可能排在主窗之前，也可能抢走聚焦；主窗一律按 `AXSubrole ==
// AXStandardWindow` 选，多扇标准窗时用 `AXMain` 消歧，判不出来就报不可判定（不按索引猜、
// 不按面积猜）。

struct AxWindowFacts {
    let role: String
    let subrole: String
    let title: String
    let frame: String
    let isMain: Bool
    var summary: String {
        let name = title.isEmpty ? "?" : "\"\(title)\""
        return "\(subrole.isEmpty ? role : subrole) \(name) \(frame)"
    }
}

func axAttrString(_ el: AXUIElement, _ attr: String) -> String {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success, let v = ref else { return "" }
    return (v as? String) ?? ""
}

func axAttrBool(_ el: AXUIElement, _ attr: String) -> Bool {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success, let v = ref else { return false }
    return (v as? Bool) ?? false
}

func axFrameText(_ el: AXUIElement) -> String {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
          let pv = posRef, CFGetTypeID(pv) == AXValueGetTypeID(),
          AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let sv = sizeRef, CFGetTypeID(sv) == AXValueGetTypeID()
    else { return "@?" }
    AXValueGetValue(pv as! AXValue, .cgPoint, &pos)
    AXValueGetValue(sv as! AXValue, .cgSize, &size)
    return "@\(Int(pos.x)),\(Int(pos.y)) \(Int(size.width))×\(Int(size.height))"
}

/// 一扇窗的身份读数（含它是不是 app 的 main window，`AXMain` 只用于多扇标准窗的消歧）。
func axWindowFacts(_ el: AXUIElement) -> AxWindowFacts {
    AxWindowFacts(
        role: axAttrString(el, kAXRoleAttribute as String),
        subrole: axAttrString(el, kAXSubroleAttribute as String),
        title: axAttrString(el, kAXTitleAttribute as String),
        frame: axFrameText(el),
        isMain: axAttrBool(el, kAXMainAttribute as String)
    )
}

/// 选主窗：返回下标；选不出来时返回 nil **与原因**。调用方 MUST 把 nil 报成「不可判定」
/// （环境项），不得退化成「不是主窗」——两者归因不同，混在一起会把套件自己的选窗失败报成
/// 产品状态（REVIEW.md「读不到当成空」条）。
func axPickMain(_ windows: [AxWindowFacts]) -> (index: Int?, note: String) {
    let listing = windows.isEmpty ? "（没有窗口）" : windows.map { $0.summary }.joined(separator: " / ")
    let standards = windows.enumerated().filter { $0.element.subrole == "AXStandardWindow" }.map(\.offset)
    if standards.isEmpty {
        return (nil, "没有 AXStandardWindow 主窗——场上 \(windows.count) 扇：\(listing)")
    }
    if standards.count == 1 { return (standards[0], "") }
    let marked = standards.filter { windows[$0].isMain }
    if marked.count == 1 { return (marked[0], "") }
    return (
        nil,
        "\(standards.count) 扇 AXStandardWindow 而 AXMain 标记不唯一（\(marked.count) 条），主窗不可判定" +
            "——场上 \(windows.count) 扇：\(listing)"
    )
}
// <<< 主窗选择

let args = CommandLine.arguments
guard args.count >= 4, let pid = pid_t(args[1]), let w = Double(args[2]), let h = Double(args[3]) else {
    FileHandle.standardError.write("usage: ax-window <pid> <width> <height>\n".data(using: .utf8)!)
    exit(2)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("ax-window: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
let err = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
guard err == .success, let elements = windowsRef as? [AXUIElement], !elements.isEmpty else {
    fail("读 AXWindows 失败（\(err.rawValue)）")
}

let windows = elements.map(axWindowFacts)
let listing = windows.map { $0.summary }.joined(separator: " / ")
let pick = axPickMain(windows)
guard let mainIndex = pick.index else {
    // 选不出主窗 = 环境项（不可判定），不是「写失败」：把窗口清单带出来，别再回来加探针。
    fail("选不出主窗：\(pick.note)")
}
let win = elements[mainIndex]
let target = windows[mainIndex].summary

var size = CGSize(width: w, height: h)
guard let sizeValue = AXValueCreate(.cgSize, &size) else {
    fail("AXValueCreate 失败（被写窗口 \(target)；场上 \(windows.count) 扇：\(listing)）")
}
let setErr = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, sizeValue)
guard setErr == .success else {
    fail("设 AXSize 失败（AXError \(setErr.rawValue)）：被写窗口 \(target)；场上 \(windows.count) 扇：\(listing)")
}

// 回读生效值（窗口管理器可能钳到最小尺寸——断言要对着真实结果，不是请求值）
var backRef: CFTypeRef?
let backErr = AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &backRef)
var back = CGSize.zero
if backErr == .success, let v = backRef, CFGetTypeID(v) == AXValueGetTypeID() {
    AXValueGetValue(v as! AXValue, .cgSize, &back)
}
print("size=\(Int(back.width))x\(Int(back.height)) window=\(target) windows=\(windows.count)")
