// 套件的工作区尺寸读数通道（M437）：读主显示器的**可用区域**（`NSScreen.visibleFrame`——已
// 排除菜单栏与 Dock），单位是逻辑点（与 AX 的 `window_bounds` 同一空间）。
//
// 为什么需要它：窗口尺寸的验收判据是**相对**的（首启 = 工作区 90%、越界存档钳到工作区），而
// 套件此前只能读到 `window_bounds` 的绝对值。工作区随机器/分辨率/外接屏而变，把某台机器的
// 像素写进场景就是把一次读数当成产品口径（真源唯一，REVIEW.md 第 8 条）——所以工作区必须
// 现场读，而不是抄进场景。
//
// 用哪块屏：产品侧用 `window.current_monitor()`（取不到回落 `primary_monitor()`）；验收实例
// 的窗口被固定摆到主屏（`lib/app.mjs` 的 launchApp 覆写 x=8 / y=40），所以这里读**主屏**
// （`NSScreen.screens` 的第一块，即带菜单栏那块）与产品同源。多屏机器上把窗口拖到别的屏本
// 读数会与产品侧不一致——套件不做这件事（launchApp 的摆放是全局的）。
//
// 用法：swift ax-screen.swift
// 成功打一行 `visible=<w>x<h> scale=<s>`（逻辑点 + 背板缩放因子）；取不到显示器时 stderr
// + 非零退出。
import AppKit
import Foundation

guard let screen = NSScreen.screens.first ?? NSScreen.main else {
    FileHandle.standardError.write("ax-screen: 取不到任何显示器\n".data(using: .utf8)!)
    exit(1)
}
let vf = screen.visibleFrame
print("visible=\(Int(vf.width.rounded()))x\(Int(vf.height.rounded())) scale=\(screen.backingScaleFactor)")
