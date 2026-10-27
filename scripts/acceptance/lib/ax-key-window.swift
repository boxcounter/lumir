// 套件的 key window 读数（M678；M762 改按标准窗选主窗）：经 Accessibility API 读目标 app 的
// **AXFocusedWindow**，并核对它就是本套件操作的那扇主窗口。
//
// 为什么需要它：`focusWindow click: true` 的合同是「窗口成为 key window + webview/编辑器拿到
// 焦点」。编辑器焦点证明不了窗口是 key——但 **窗口自己的 `AXFocused` 属性在本 app 上恒 false**
// （M678 真机实测：编辑器有焦点、滚轮/键盘都可用时仍报 false），拿它当判据会把正常跑批判成
// INVALID。`AXFocusedWindow`（app 级的「当前聚焦窗口」）才是 AX 侧的 key window 读数：
// M678 探针在可用现场读到 `focusedWindowErr=0 ... isFirstWindow=true`。
//
// **主窗怎么认（M762）**：旧判据拿 `AXWindows[0]` 当主窗（`isFirstWindow` 时代的索引假设）。
// 屏幕上多出任何第二扇窗（112 那族辅助 `AXDialog "Window"`，窗口共享会话控件）之后这个假设会
// 反过来——焦点本来就在主窗也读成 false，整场 INVALID（2026-10-28 的 224 两轮都卡在这里，而
// 编辑器焦点与点击落点全部正常）。现在按 `AXSubrole == AXStandardWindow` 选主窗（与 `lib/ax.mjs`
// 的 `mainWindowPlan` 同一口径：主窗就是标准窗，辅助窗是 AXDialog）。
//
// 用法：swift ax-key-window.swift <pid>
//       swift ax-key-window.swift --self-test    # 纯函数自测（多窗口反例），不起 app、不需权限
// 成功打出一行 `focusedWindow=true|false|unknown …`，其后是窗口事实（主窗 / 聚焦窗 / 窗口清单）：
//   聚焦窗 == 主窗           → true
//   聚焦窗是别的窗           → false（确定：带了是哪扇窗）
//   选不出主窗 / 属性读不到   → unknown（环境项；带了原因与窗口清单，**不得**当成 false）
// 读 AXWindows 失败时 stderr + 非零退出（调用方按「读不到」处理，不猜）。
// 前提：调用进程有辅助功能权限（与 doubleClick / resizeWindow 同）。
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

/// key window 的三态判定（纯函数：探针与自测共用一份）。
/// `focusedIndex` 是聚焦窗在 `windows` 里的下标；nil = 读不到（属性失败 / 值不是 AXUIElement /
/// 不在 AXWindows 里）。
/// 返回 `(state, note)`：state ∈ true / false / unknown；note 是给证据与错误文案的窗口事实。
func axKeyWindowState(windows: [AxWindowFacts], focusedIndex: Int?) -> (String, String) {
    let listing = windows.isEmpty ? "（没有窗口）" : windows.map { $0.summary }.joined(separator: " / ")
    let pick = axPickMain(windows)
    guard let mainIndex = pick.index else { return ("unknown", "reason=\(pick.note)") }
    guard let focused = focusedIndex else {
        return ("unknown", "reason=AXFocusedWindow 读不到或不在 AXWindows 里")
    }
    let main = "main=\(windows[mainIndex].summary)"
    if focused == mainIndex { return ("true", main) }
    return ("false", "\(main) focused=\(windows[focused].summary)")
}

/// `--self-test`：多窗口反例（这是本文件的判据本体，`execute.test.mjs` 调起它）。
/// 任一用例不符即非零退出；顺带用**旧判据**（`AXWindows[0]`）对同一张表算一遍，证明这些用例
/// 真的能把「索引假设」与「按 subrole 选窗」区分开——没有区分度的用例不算覆盖。
func axSelfTest() -> Int32 {
    func win(_ subrole: String, _ title: String, main: Bool = false) -> AxWindowFacts {
        AxWindowFacts(role: "AXWindow", subrole: subrole, title: title, frame: "@0,0 100×100", isMain: main)
    }
    func legacyState(windows: [AxWindowFacts], focusedIndex: Int?) -> String {
        guard let focused = focusedIndex, !windows.isEmpty else { return "unknown" }
        return focused == 0 ? "true" : "false"
    }
    // (用例名, 窗口表（顺序即 AX 报的顺序）, 聚焦窗下标（nil = 读不到）, 期望 state, 旧判据下是否同值)
    let cases: [(String, [AxWindowFacts], Int?, String, Bool)] = [
        ("single-standard-focused", [win("AXStandardWindow", "Lumir", main: true)], 0, "true", true),
        // M761 的真实现场：辅助 AXDialog 排在 AXWindows[0]，焦点其实在主窗上。
        ("aux-dialog-first-main-focused", [win("AXDialog", "Window"), win("AXStandardWindow", "Lumir", main: true)], 1, "true", false),
        ("aux-dialog-focused", [win("AXDialog", "Window"), win("AXStandardWindow", "Lumir", main: true)], 0, "false", false),
        ("standard-first-dialog-second", [win("AXStandardWindow", "Lumir", main: true), win("AXDialog", "Window")], 0, "true", true),
        ("no-standard-window", [win("AXDialog", "Window")], 0, "unknown", false),
        ("two-standards-main-marked", [win("AXStandardWindow", "Lumir"), win("AXStandardWindow", "Other", main: true)], 1, "true", false),
        ("two-standards-no-main", [win("AXStandardWindow", "Lumir"), win("AXStandardWindow", "Other")], 1, "unknown", false),
        ("focused-unreadable", [win("AXStandardWindow", "Lumir", main: true)], nil, "unknown", true),
    ]
    var failures = 0
    for (name, windows, focused, want, legacyAgrees) in cases {
        let (state, note) = axKeyWindowState(windows: windows, focusedIndex: focused)
        let legacy = legacyState(windows: windows, focusedIndex: focused)
        var problems: [String] = []
        if state != want { problems.append("期望 \(want) 实际 \(state)") }
        // 反向对照：标了 `legacyAgrees=false` 的用例里旧判据必须给出**不同**答案，否则这条用例
        // 对「索引假设」没有区分度（写回来也照样绿）。
        if !legacyAgrees && legacy == state { problems.append("旧判据（AXWindows[0]）给出同值 \(legacy)，该用例没有区分度") }
        if problems.isEmpty {
            print("SELFTEST PASS \(name)：\(state)\(note.isEmpty ? "" : "（\(note)）")")
        } else {
            failures += 1
            print("SELFTEST FAIL \(name)：\(problems.joined(separator: "；"))")
        }
    }
    return failures == 0 ? 0 : 1
}

let args = CommandLine.arguments

// `--self-test`：不起 app、不要辅助功能权限，纯函数层（调用方是 execute.test.mjs）。
if args.count >= 2 && args[1] == "--self-test" {
    exit(axSelfTest())
}

guard args.count >= 2, let pid = pid_t(args[1]) else {
    FileHandle.standardError.write("usage: ax-key-window <pid> | ax-key-window --self-test\n".data(using: .utf8)!)
    exit(2)
}

let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
let err = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
guard err == .success, let elements = windowsRef as? [AXUIElement], !elements.isEmpty else {
    FileHandle.standardError.write("ax-key-window: 读 AXWindows 失败（\(err.rawValue)）\n".data(using: .utf8)!)
    exit(1)
}

// 窗口事实一次读齐：判定（`axKeyWindowState`）与证据行（窗口清单）用的是同一批读数。
let windows = elements.map(axWindowFacts)
let listing = windows.map { $0.summary }.joined(separator: " / ")

// 聚焦窗：先按元素身份在 AXWindows 里定位（CFEqual —— AXUIElement 没有值相等语义）。
// 读不到 / 值不是窗口 / 不在 AXWindows 里都落到 nil，由判定函数报 unknown（不猜）。
var focusedRef: CFTypeRef?
let focusedErr = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focusedRef)
var focusedIndex: Int? = nil
var focusedNote = ""
if focusedErr == .success, let fw = focusedRef, CFGetTypeID(fw) == AXUIElementGetTypeID() {
    let focusedElement = fw as! AXUIElement
    focusedIndex = elements.firstIndex { CFEqual($0, focusedElement) }
    if focusedIndex == nil {
        // AX 口径不一致（聚焦窗不在 AXWindows 里）：把它的身份带进证据，判定仍是 unknown。
        focusedNote = " focused=\(axWindowFacts(focusedElement).summary)（不在 AXWindows 里）"
    }
} else if focusedErr != .success {
    focusedNote = " err=\(focusedErr.rawValue)"
} else {
    focusedNote = " err=no-window-value"
}

let (state, note) = axKeyWindowState(windows: windows, focusedIndex: focusedIndex)
let pick = axPickMain(windows)
let title = pick.index.map { windows[$0].title } ?? "?"
print("focusedWindow=\(state) title=\(title)\(focusedNote) \(note) windows=\(windows.count) [\(listing)]")
