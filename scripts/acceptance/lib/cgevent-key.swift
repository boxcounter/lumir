// 套件的键盘注入通道（swift + CGEvent，真实 keyDown/keyUp）。两种形态：
//
//   1. `<text>`（M507）：逐 scalar 的 **Unicode 文本注入**——原生输入框（AXTextField / AXComboBox）
//      用，KimiCU 的 type_text 在这些目标上会触发失焦取消。
//   2. `--key <keycode> <flags> [--key <keycode> <flags> ...]`（M767）：**真键位事件**。
//      keycode = 虚拟键码，flags = `CGEventFlags` 原始值（十进制或 `0x` 十六进制）。down / up 带
//      同一组 flags、投 `.cghidEventTap`、间隔 8ms —— 与 M766 探针的行为矩阵 B1 同形（一次真
//      ⌃A 在 app 进程侧留下两条 `kc=… flags=0x…40000` 的记录，composer 执行 `editor.line-start`）。
//
// 为什么需要 --key：KimiCU 0.6.8 的 `press_key` 在文本控件上把 `ctrl+a` / `cmd+a` 特判成 AX
// 「全选」兼容路径（运行期返回 `used_backend: "ax_select_all_compat"` / `"ax_select_all"`），
// **完全不投递键盘事件**——应用键位层命中不到 `Ctrl-a`（`src/keys.ts`），场景里就成了「全选 +
// 覆写」。探针与证据矩阵见 `.local/reports/ctrl-a-channel-oct28/README.md`（M766）。
//
// 键名 → keycode、修饰键 → flags 的翻译在 `lib/drive.mjs` 的 `parseChordSpec`（**单一真源**）；
// 本脚本只吃数值，不再维护第二张键表（REVIEW.md「同一语义两处真源」条）。
//
// `--key` 的退出码（JS 侧一律翻成 `InfraError`，**不得静默降级**回 press_key）：
//   2 = 参数错（用法 / keycode / flags 不是数值）
//   3 = 没有「辅助功能」投递权限（`CGPreflightPostEventAccess` 为假）——环境项
//   4 = CGEventSource / CGEvent 构造失败
//   5 = 投递后修饰位没有复位（见下）
//
// **修饰位必须显式抬起（M767 真机实测的必修项）**：只给字母事件的 down/up 带 `flags` 时，事件源
// 的修饰位会**一直停在 flags 上**——投完一次 ⌃A 后 `CGEventSource.flagsState(.combinedSessionState)`
// 仍是 `0x…40000 [control]`，此后所有普通 keystroke 都被当成 ⌃ 组合（composer 里 `z` 变 ⌃z 撤销、
// 整段文本消失，140 的 ⌃B 步因此假红）。因此每个 chord 结束后对用到的修饰键各投一次 keyUp（flags=[]），
// 并回读修饰位自检：仍有 shift/control/option/command 残留就退出码 5（通道没把状态交还干净）。
import ApplicationServices
import CoreGraphics
import Foundation

let args = CommandLine.arguments

func usage() -> Never {
    FileHandle.standardError.write(
        ("usage: cgevent-key <text>\n" +
            "       cgevent-key --key <keycode> <flags> [--key <keycode> <flags> ...]\n").data(using: .utf8)!,
    )
    exit(2)
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
    exit(code)
}

/// 十进制或 `0x` 十六进制的无符号整数（Swift 的 `radix` 不认前缀，这里先剥）。
func parseUnsigned(_ text: String) -> UInt64? {
    if text.hasPrefix("0x") || text.hasPrefix("0X") {
        return UInt64(text.dropFirst(2), radix: 16)
    }
    return UInt64(text, radix: 10)
}

if args.count >= 2 && args[1] == "--key" {
    // 权限前置：没有它 CGEvent 投递**静默无声**（不报错、事件也不到），JS 侧就会把「通道没跑」
    // 当成「产品没响应」——正是 M766 归因的那类假红。这里先判、先红。
    guard CGPreflightPostEventAccess() else {
        fail(
            "没有「辅助功能」投递权限：CGPreflightPostEventAccess=false——真键盘事件通道不可用。" +
                "请在「系统设置 → 隐私与安全性 → 辅助功能」给运行验收套件的进程授权后重跑。",
            code: 3,
        )
    }
    var specs: [(CGKeyCode, CGEventFlags)] = []
    var i = 1
    while i < args.count {
        guard args[i] == "--key", i + 2 < args.count else { usage() }
        guard let code = parseUnsigned(args[i + 1]), code <= UInt64(UInt16.max) else {
            fail("keycode 不是数值或越界：\(args[i + 1])", code: 2)
        }
        guard let raw = parseUnsigned(args[i + 2]), raw <= UInt64(UInt32.max) else {
            fail("flags 不是数值或越界：\(args[i + 2])", code: 2)
        }
        specs.append((CGKeyCode(code), CGEventFlags(rawValue: raw)))
        i += 3
    }
    guard !specs.isEmpty else { usage() }
    guard let source = CGEventSource(stateID: .hidSystemState) else {
        fail("CGEventSource 创建失败：真键盘事件通道不可用", code: 4)
    }
    // 修饰位 → 修饰键 keycode（左键）。chord 结束后按这张表把用到的修饰键抬起——只带 flags 的
    // 字母事件会把事件源修饰位留在 flags 上（见文件头的「修饰位必须显式抬起」段）。
    let modifierKeys: [(CGEventFlags, CGKeyCode, String)] = [
        (.maskControl, 59, "control"), (.maskShift, 56, "shift"),
        (.maskAlternate, 58, "option"), (.maskCommand, 55, "command"),
    ]
    let modifierMask: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
    for (code, flags) in specs {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
        else {
            fail("CGEvent 构造失败：keycode=\(code)", code: 4)
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        usleep(8_000)
        up.post(tap: .cghidEventTap)
        usleep(8_000)
        for (flag, keycode, _) in modifierKeys where flags.contains(flag) {
            guard let release = CGEvent(keyboardEventSource: source, virtualKey: keycode, keyDown: false) else {
                fail("修饰键抬起事件构造失败：keycode=\(keycode)", code: 4)
            }
            release.flags = []
            release.post(tap: .cghidEventTap)
            usleep(8_000)
        }
    }
    // 自检：通道必须把修饰位交还干净，否则后续普通 keystroke 会被当成 chord（真机实测的假红成因）。
    usleep(50_000)
    let leftover = CGEventSource.flagsState(.combinedSessionState).intersection(modifierMask)
    if !leftover.isEmpty {
        let names = modifierKeys.filter { leftover.contains($0.0) }.map { $0.2 }.joined(separator: "+")
        fail(
            "chord 投递后修饰位没有复位（残留：\(names)）——后续按键会被当成 chord，拒绝按「已投递」返回；" +
                "若此刻确实有人按住修饰键，请松开后重跑本步",
            code: 5,
        )
    }
    // 回读行 = 通道自证：JS 侧要求它存在，否则「swift 退出 0 但什么也没投」会被当成成功。
    let desc = specs.map { "keycode=\($0.0) flags=0x\(String($0.1.rawValue, radix: 16))" }.joined(separator: ", ")
    print("key \(desc)")
    exit(0)
}

guard args.count == 2 else { usage() }

let text = args[1]
let source = CGEventSource(stateID: .hidSystemState)
for scalar in text.unicodeScalars {
    let value = String(scalar)
    let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    down?.flags = []
    up?.flags = []
    let chars = Array(value.utf16)
    chars.withUnsafeBufferPointer { buffer in
        down?.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: buffer.baseAddress)
        up?.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: buffer.baseAddress)
    }
    down?.post(tap: .cghidEventTap)
    usleep(8_000)
    up?.post(tap: .cghidEventTap)
    usleep(8_000)
}
print("injected \(text.unicodeScalars.count) Unicode scalars")
