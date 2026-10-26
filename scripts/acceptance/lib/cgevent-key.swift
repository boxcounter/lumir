// 原生输入框的 Unicode 键盘注入：真实 keyDown/keyUp，经 HID tap 投递。
// 用于 KimiCU type_text 在 AXTextField / AXComboBox 上触发失焦取消时的对照通道。
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: cgevent-key <text>\n".data(using: .utf8)!)
    exit(2)
}

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
