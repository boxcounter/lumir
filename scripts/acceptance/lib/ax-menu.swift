// 原生菜单点击通道（change add-acceptance-installed-app-pause 的 880/880b 修复）：
// 按 **pid** 找到目标 app 的 AXMenuBar，按标题打开菜单并按下菜单项。
// 两个消费者共用本 helper：场景动作 `clickMenuItem`（880/880b）与安装版暂停的保存屏障
// `triggerSaveAllMenuItem`（File → Save All）；JS 侧入口是 lib/native-menu.mjs。
//
// 为什么需要它：KimiCU 的 AX 文本把整条菜单栏渲染成**一个** `AXMenuBar` 节点，子项以
// `[2] Apple; [4] Lumir; [6] File; …` 的内联形式附在行尾——`parseNodes` 不会为它们生成
// `AXMenuBarItem` 节点，因此场景里的 `click { role: AXMenuBarItem, name: "^File$" }` 永远
// 找不到可点节点（不是产品菜单缺失：同一份 dump 的菜单栏里有 File）。本 helper 直接走
// Accessibility API（菜单栏的真实 AX 树里子项是独立元素），不依赖 KimiCU 的文本折叠。
//
// 用法：swift ax-menu.swift <pid> <menu title> <item title>
// 成功 stdout 打印 `pressed <menu> → <item>`；失败 stderr + 非零退出，带回现有菜单 / 项标题，
// 失败归因不必回来加探针。前提：调用进程有辅助功能权限（与 ax-window.swift 同一前提）。
import ApplicationServices
import Foundation

func axAttr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &ref) == .success else { return nil }
    return ref
}

/// 菜单 / 菜单项的读屏名：优先 AXTitle；个别系统版本 / 自绘项把标题放在 description 或
/// value 上，逐级回退（空串一律跳过）。
func axTitle(_ element: AXUIElement) -> String {
    for attribute in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        if let text = axAttr(element, attribute as String) as? String, !text.isEmpty {
            return text
        }
    }
    return ""
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    (axAttr(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func axPress(_ element: AXUIElement) -> AXError {
    AXUIElementPerformAction(element, kAXPressAction as CFString)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("ax-menu: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count == 4, let pid = pid_t(args[1]) else {
    FileHandle.standardError.write("usage: ax-menu <pid> <menu> <item>\n".data(using: .utf8)!)
    exit(2)
}
let menuTitle = args[2]
let itemTitle = args[3]

let app = AXUIElementCreateApplication(pid)
guard let menuBarRef = axAttr(app, kAXMenuBarAttribute as String) else {
    fail("读不到 AXMenuBar（pid \(pid)；辅助功能权限或进程已退出？）")
}
let menuBar = menuBarRef as! AXUIElement
let menuBarItems = axChildren(menuBar)
guard let menuBarItem = menuBarItems.first(where: { axTitle($0) == menuTitle }) else {
    let listing = menuBarItems.map { axTitle($0) }.filter { !$0.isEmpty }.joined(separator: " / ")
    fail("菜单栏没有「\(menuTitle)」（现有：\(listing.isEmpty ? "（无标题项）" : listing)）")
}

/// 在菜单栏项的子层级里找同名菜单项：`AXMenuBarItem → AXMenu → AXMenuItem`（有的系统版本
/// 还会多包一层 group）。只向下看两层，避免误点深层子菜单；找不到回 nil。
func findItem(_ root: AXUIElement) -> AXUIElement? {
    for child in axChildren(root) {
        if axTitle(child) == itemTitle { return child }
        for grandchild in axChildren(child) where axTitle(grandchild) == itemTitle {
            return grandchild
        }
    }
    return nil
}

// 先打开菜单，再按下菜单项：关闭态下直接 AXPress 菜单项在部分 macOS 版本上是 no-op。
// 打开菜单后读回子层级；菜单项标题按菜单里的读屏名比较（本 product 的 "Save All"）。
let opened = axPress(menuBarItem)
guard opened == .success else {
    fail("打开「\(menuTitle)」菜单失败（AXError \(opened.rawValue)）")
}
// 菜单刚打开时子层级可能还没就绪：最多等 5 × 200ms，找到即停（不固定睡死）。
var item: AXUIElement? = nil
for _ in 0..<5 {
    if let found = findItem(menuBarItem) {
        item = found
        break
    }
    usleep(200_000)
}
guard let item else {
    let listing = axChildren(menuBarItem)
        .flatMap { [$0] + axChildren($0) }
        .map { axTitle($0) }
        .filter { !$0.isEmpty }
        .joined(separator: " / ")
    fail("「\(menuTitle)」菜单里没有「\(itemTitle)」（现有：\(listing.isEmpty ? "（无标题项）" : listing)）")
}
let pressed = axPress(item)
guard pressed == .success else {
    fail("按下「\(menuTitle) → \(itemTitle)」失败（AXError \(pressed.rawValue)）")
}
print("pressed \(menuTitle) → \(itemTitle)")
