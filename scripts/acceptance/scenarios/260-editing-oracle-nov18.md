---
id: "260-editing-oracle-nov18"
item: 260
tier: full
title: 编辑参照模型的固定真机 witness——marker 导航原子步、连续空列表 Enter、保存后 file.exact 全文（M832）
fixtures: [list-indent-ordered.md]
open: list-indent-ordered.md
marker: "uno"
steps:
  # witness A：seed 1 固化的 marker 导航（与模型 bodyHorizontalStep 同一落点）。
  # 判据沿用场景 255 的「键入字符落点」读出法：AX 不暴露 caret 几何。
  - name: 起点：有序列表已打开，编辑器可读
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 正向锚点——本轮 AX 读取是活的
        editor: { has: "uno" }
      - label: 第二项也在场
        editor: { has: "dos" }
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线（导航与撤销都不得落盘）
    do: record
    file: list-indent-ordered.md
    as: 文档基线

  - name: ⌃A 到首行行首（真键盘事件通道）
    do: key
    key: "ctrl+a"
    channel: cgevent
    gapMs: 150

  - name: → 一次跨过隐藏 marker 区间（模型落点 = 内容起点）
    do: key
    key: "right"
    gapMs: 150
    expect:
      - label: 光标仍在编辑器里
        ax: { focused: "AXTextArea" }

  - name: 键入 z 读落点
    do: keys
    keys: ["z"]
    gapMs: 150
    expect:
      - label: z 落在正文起点（`1. zuno`；停在隐藏源码内部会得到 `1z. uno`）
        editor: { has: "zuno" }
      - label: 区分度反向对照：MUST NOT 停在 marker 源码内部
        editor: { not: "1z." }

  - name: 撤销回干净态
    do: keys
    keys: ["cmd+z", "cmd+z"]
    gapMs: 150
    expect:
      - label: z 已撤回
        editor: { not: "zuno" }
      - label: 零写盘（sha256 + mtime 双比）
        file: { path: list-indent-ordered.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  # witness B：seed 7 固化的连续空列表 + 保存全文。每一拍都是真 CGEvent 键盘；
  # 期望文档由 tests/unit/editing-oracle-model.ts 的同一组操作给出。
  - name: ⌘A 全选后重写为单行列表项（选中态替换）
    do: key
    key: "cmd+a"
    gapMs: 150

  - name: 写入 `- first`
    do: type
    text: "- first"

  - name: Enter 续一个空项
    do: key
    key: "return"
    gapMs: 200
    expect:
      - label: 空项已续出（行数 +1，marker 保留）
        editor: { has: "first" }

  - name: 空项上 Enter = 退出列表（删 marker、不新增行）
    do: key
    key: "return"
    gapMs: 200

  - name: 普通空行上再 Enter（只插一个换行，不恢复 marker）
    do: key
    key: "return"
    gapMs: 200

  - name: 键入第二段正文
    do: keys
    keys: ["s", "e", "c", "o", "n", "d"]
    gapMs: 120
    expect:
      - label: 第二段正文已落地（列表项、空行、续文三行）
        editor: { has: "second" }
      - shot: 列表项-空行-续文终态

  - name: ⌘S 保存（唯一写盘键）
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      # 整篇逐字比较：保存链不做文本规范化（前端原样传 doc、Rust 原子写），
      # 因此 `file.exact` 是这条链唯一有区分度的全文判据（M832 新增的 `file.exact`）。
      - label: 盘上全文 = 模型终态（`- first`、空行、`second`）
        file: { path: list-indent-ordered.md, exact: "- first\n\nsecond", changedSince: 文档基线 }
      - label: dirty 已收窄
        ax: { not: "（未保存）" }
---

# 260 — 编辑参照模型的固定真机 witness（M832）

本场景只放两条**从随机序列里固化的最短 witness**，不跑随机键序列：

1. **marker 导航原子步**（seed 1）：`⌃A` → 一次 `→` → 键入 `z`，落点必须是内容起点
   （`1. zuno`），不得停在隐藏源码内部（`1z. uno`）。期望落点由
   `tests/unit/editing-oracle-model.ts` 的 `bodyHorizontalStep` 给出，不从生产
   `listHiddenRangeAt` 反推。
2. **连续空列表 Enter + 保存全文**（seed 7）：`- first` → Enter（续空项）→ Enter（空项退出，
   删 marker 不新增行）→ Enter（此时 caret 在普通空行，只插一个换行、不恢复 marker）→
   键入 `second` → ⌘S。三次 Enter 覆盖三种真实语义：**续空项 → 空项退出 → 普通空行换行**；
   期望文档 `- first\n\nsecond` 与独立模型逐字节一致。落盘用 M832 新增的 `file.exact`
   做整篇比较——`has` 是子串，对多余空行 / 数量错误没有区分度。

## 判据边界（如实声明）

- **AX 不是 raw doc oracle**：AX 里的编辑器文本是渲染后的文本（marker widget 显示为
  `1.` / `–`），因此本场景的逐字节终态判据落在保存后的**文件**上（`file.exact`）；
  `editor.has/not` 只做行为锚点与反向对照。
- **native IME 不在此场景**：真机 WKWebView 的原始拼音候选窗 / marked-text 生命周期
  不能由 CGEvent 进入（M461/M529 的通道探针已逐条证明），本场景不拿合成事件冒充。
  该边界在任务报告里单列 `NATIVE_IME_UNREACHED`，不并入 PASS。
- **裸 marker Backspace** 的真机回归仍在既有场景（M461/100/255 一族）；本场景不重复，
  其模型对拍在 `tests/unit/editing-oracle.test.ts` 与浏览器场景
  `tests/visual/scenes/editing-oracle.spec.ts`。
- **本次发现的产品缺陷**：换行后紧跟 `- ` 列表行时按 forward Delete 会把 marker 字形
  写进文档（`alpha\n- item` → `alpha\n–\nitem`）。已单独 TowerFinding，不在本 mission
  修生产代码；本场景不覆盖该键位，避免把已知缺陷混进 witness 判据。
