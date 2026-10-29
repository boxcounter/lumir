---
id: "255-list-caret-navigation-oct29"
item: 255
tier: full
title: 列表行首的水平导航——→ 与 ⌃F 都一次到正文起点、反向对称，落点以「键入字符的落位」为判据（M795；光标高度归手感项）
fixtures: [list-indent-ordered.md]
open: list-indent-ordered.md
marker: "uno"
steps:
  - name: 起点：有序列表已打开，光标在首行行首（⌃A）
    do: clickEditor
    expect:
      - label: 打开成功（渲染态可读——正向锚点，本次 AX 读取是活的）
        editor: { has: "uno" }
      - label: 第二项也在场（fixture 是两行列表）
        editor: { has: "dos" }
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }

  - name: 让窗口成为 key window（真实正文单击；首个 mousedown 会被激活吃掉）
    do: focusWindow
    retries: 4
    click: true

  - name: 记录文档基线（本场景的手势一个都不许落盘）
    do: record
    file: list-indent-ordered.md
    as: 文档基线

  - name: ⌃A 到首行行首（真键盘事件通道：KimiCU 的 ctrl+a 在文本控件上会走 AX 全选兼容路径）
    do: key
    key: "ctrl+a"
    channel: cgevent
    expect:
      - label: 行首状态没有未保存标记
        ax: { not: "（未保存）" }

  # 落点判据：光标位置用「紧接着键入的字符落在哪」读出（AX 不暴露 caret 几何，见套件 README 的
  # 「已知行为边界」）。修前 →：原生 caret 先停在 CM 给不可编辑 marker widget 插的
  # `cm-widgetBuffer` 上（文档位置不动），Z 会落在行首（源码 `Z1. uno`，整行退化成字面文本）；
  # 修后一次到正文起点（源码 `1. Zuno`，渲染可见 `1.Zuno`）。
  - name: → 一次到正文起点，键入 Z 读落点
    do: keys
    keys: ["right"]
    gapMs: 150
    expect:
      - label: 按 → 后光标仍在编辑器里（没有跑焦点）
        ax: { focused: "AXTextArea" }

  - name: 键入 Z（可打印单字符走回读重试通道）
    do: keys
    keys: ["Z"]
    gapMs: 150
    expect:
      - label: Z 落在正文起点（`1. Zuno` → 渲染可见 `1.Zuno`；修前 → 停在 buffer 上会得到 `Z1. uno`）
        editor: { has: "Zuno" }
      - label: 区分度反向对照：MUST NOT 出现「Z 落在行首」的形态
        editor: { not: "Z1." }
      - label: 第二项逐字节未被牵连
        editor: { has: "dos" }
      - shot: 右箭头-正文起点

  - name: 撤销回到干净态（不落盘）
    do: keys
    keys: ["cmd+z", "cmd+z"]
    gapMs: 150
    expect:
      - label: Z 已撤回（编辑器文本不再含 Zuno）
        editor: { not: "Zuno" }
      - label: 零写盘（sha256 + mtime 双比：导航与撤销都不改文档）
        file: { path: list-indent-ordered.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - label: 没有变 dirty
        ax: { not: "（未保存）" }

  # ⌃F 与 → 必须**同一落点**：修前 ⌃F 按文档位置逐字符走隐藏源码（`1`、`.`、空格各一步），
  # 一次只到隐藏区间内部，键入 Z 会得到 `1Z. uno`（字面文本）。
  - name: ⌃A 回行首后按一次 ⌃F
    do: keys
    keys: ["ctrl+a"]
    channel: cgevent
    gapMs: 150

  - name: 按一次 ⌃F
    do: key
    key: "ctrl+f"
    gapMs: 150

  - name: 键入 Z 读 ⌃F 的落点
    do: keys
    keys: ["Z"]
    gapMs: 150
    expect:
      - label: ⌃F 一次同样落在正文起点（与 → 同落点：`1. Zuno`）
        editor: { has: "Zuno" }
      - label: 区分度反向对照：MUST NOT 停在隐藏源码内部（那会得到 `1Z. uno`）
        editor: { not: "1Z." }

  - name: 撤销回到干净态
    do: keys
    keys: ["cmd+z", "cmd+z"]
    gapMs: 150
    expect:
      - label: 零写盘（sha256 + mtime 双比）
        file: { path: list-indent-ordered.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  # 反向路径对称：从正文起点（⌃A + → 各一次）按一次 ← 必须回到**可见行首**——键入 Z 落在行首
  # （`Z1. uno`）。修前 ← 先停在 buffer 上（文档位置仍是正文起点），Z 会得到 `1. Zuno`。
  - name: ⌃A + → 到正文起点
    do: keys
    keys: ["ctrl+a"]
    channel: cgevent
    gapMs: 150

  - name: → 一次到正文起点
    do: key
    key: "right"
    gapMs: 150

  - name: ← 一次（应回到可见行首）
    do: key
    key: "left"
    gapMs: 150

  - name: 键入 Z 读反向落点
    do: keys
    keys: ["Z"]
    gapMs: 150
    expect:
      - label: 反向一次到可见行首（`Z1. uno` → 该行退化成字面文本，MUST NOT 停在正文起点）
        editor: { has: "Z1." }
      - label: 区分度反向对照：MUST NOT 停在正文起点（那会得到 `Zuno`）
        editor: { not: "Zuno" }
      - shot: 左箭头-可见行首

  - name: 撤销并核对终态
    do: keys
    keys: ["cmd+z", "cmd+z"]
    gapMs: 150
    expect:
      - label: 文档逐字节未动（sha256 + mtime 双比）
        file: { path: list-indent-ordered.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - label: 终态不 dirty
        ax: { not: "（未保存）" }
      - shot: 终态-干净列表
---

# 255 — 列表行首的水平导航（M795）

用户原话（2026-10-29）：同一个有序列表行 `1. aaaaa` 上，光标在序号之前时按右键不动；按 ⌃F 会先到
序号之后，再按两三下才进正文第一个与第二个字符之间。

根因：列表 marker 是 `Decoration.replace` 的 inline widget，源码区间（`1. `）不可见。
- `→` / `←` 原本走原生 contenteditable：CM 在不可编辑 inline widget 两侧各插一个
  `cm-widgetBuffer`，每个 buffer 都是原生 caret 的一个停止位，从行首到正文要按两次；
- `⌃F` / `⌃B` 走 `moveByChar`，按文档位置逐字符走隐藏源码，`1`、`.`、空格各一步。

修法（合同 `docs/specs/editor-caret.md` 的 C6、`docs/specs/lists.md` 的 L5）：隐藏源码区间是
**一个原子步**，落点落在区间内部时钳到可见一侧边界；`←` / `→` 改绑同一条硬化命令（与 ⌃B / ⌃F
同一实现），块级横滚容器持焦时仍滚容器（命令实现的焦点分支）。

## 判据说明

- **落点读出方式**：AX 不暴露 caret 几何（见 `scripts/acceptance/README.md` 的「已知行为边界」），
  因此落点用「紧接着键入的字符落在哪」读：正文起点插入 → 源码 `1. Zuno`（渲染可见 `1.Zuno`）；
  行首插入 → 源码 `Z1. uno`（整行退化成字面文本）。两种形态互斥，断言取正反两向。
- **每次键入后都撤销**，并以 sha256 + mtime 双比核对文件零写盘。
- **光标高度**（序号之前 vs 正文处一致）归 Alex 手感项：AX 读不到 caret 矩形，截图只作对照证据
  （chromium 层的结构断言在 `tests/visual/scenes/m647-caret-geometry.spec.ts` 的 M795 块）。
