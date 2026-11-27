---
id: "888-list-line-indent"
item: 888
tier: full
title: 列表行缩进的行模型——6 行多选 Shift+Tab 逐行凸排（正向 / 反向同一结果）、未选中的首行与子项逐字节不动、一次撤销还原
fixtures: [list-line-indent-block.md, list-line-indent-block-reverse.md]
open: list-line-indent-block.md
marker: "alpha"
config:
  keys: { "Cmd-j": "editor.list-indent", "Cmd-Shift-j": "editor.list-outdent" }
steps:
  - name: 起点：源文件与渲染态都可读，[keys] 覆盖已生效
    do: record
    as: 原始基线
    file: list-line-indent-block.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL）
        file: { path: list-line-indent-block.md, exists: true }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀）
        ax: { not: "（未保存）" }
      - label: "[keys] 覆盖已生效（没写进去则后面的按键全是空转）"
        file: { path: env:config.json, has: "\"Cmd-Shift-j\": \"editor.list-outdent\"" }
      - label: 渲染态可读（正向锚点）
        editor: { has: "alpha" }
      - shot: 起点

  - name: 建立编辑器焦点（点编辑器顶边；新会话光标在文档首行）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 光标下移到第 3 行（`    - charlie`，起始列 0）
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
    expect:
      - label: 纯光标移动不碰文档（正向锚点：编辑器此刻可读）
        editor: { has: "charlie" }

  - name: 向下扩选 5 行到第 8 行，再把选区头送到第 8 行行尾（共 6 行）
    # 扩选后 head 停在行首（列 0），按新合同「尾落行首不计入」第 8 行会被排除；
    # ⌃⇧E 把 head 送到该行行尾，才构成用户截图里的「选中整行内容」形态。
    do: keys
    keys:
      [
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+n",
        "ctrl+shift+e",
      ]
    expect:
      - label: 扩选手势不改文档（sha256 + mtime 双比）
        file: { path: list-line-indent-block.md, unchangedSince: 原始基线, mtimeUnchangedSince: 原始基线 }
      - label: 渲染态仍可读
        editor: { has: "hotel" }

  - name: ⌘⇧J（凸排）——选区触及的 6 行逐行处理
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 焦点仍在编辑器里（命令命中即消费）
        ax: { focused: "AXTextArea" }

  - name: 按 ⌘S 落盘（发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对逐行凸排与未选行不动
    do: sleep
    ms: 1200
    expect:
      - label: charlie 凸一层（4 → 2 空格）
        file: { path: list-line-indent-block.md, has: "/^  - charlie$/" }
      - label: 反向：charlie 原 4 空格形态不再存在
        file: { path: list-line-indent-block.md, not: "/^    - charlie$/" }
      - label: delta 凸一层（4 → 2 空格）
        file: { path: list-line-indent-block.md, has: "/^  - delta$/" }
      - label: echo 凸一层（2 → 0 空格）
        file: { path: list-line-indent-block.md, has: "/^- echo$/" }
      - label: foxtrot 凸一层（2 → 0 空格）
        file: { path: list-line-indent-block.md, has: "/^- foxtrot$/" }
      - label: golf 凸一层（4 → 2 空格）
        file: { path: list-line-indent-block.md, has: "/^  - golf$/" }
      - label: hotel 凸一层（2 → 0 空格）
        file: { path: list-line-indent-block.md, has: "/^- hotel$/" }
      - label: 未选中的首行 alpha 逐字节不动
        file: { path: list-line-indent-block.md, has: "/^- alpha$/" }
      - label: 未选中的 bravo 逐字节不动（首行下的子项不受牵连）
        file: { path: list-line-indent-block.md, has: "/^  - bravo$/" }
      - label: 未选中的末行 india 逐字节不动
        file: { path: list-line-indent-block.md, has: "/^- india$/" }
      - label: 没有引出「检测到外部修改」提示（自身写盘的回声护栏）
        ax: { not: "检测到外部修改" }
      - shot: 6 行凸排写回

  - name: 记下凸排后的磁盘基线（下一条撤销必须与它比较）
    do: record
    as: 凸排后基线
    file: list-line-indent-block.md

  - name: 一次 ⌘Z：单次 dispatch 应被撤销史归成一步
    do: key
    key: "cmd+z"
  - name: 按 ⌘S 落盘撤销（发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对撤销还原
    do: sleep
    ms: 1200
    expect:
      - label: 一次撤销把 6 行全部还原（charlie 回到 4 空格）
        file: { path: list-line-indent-block.md, has: "/^    - charlie$/" }
      - label: 反向：凸排后的 `  - charlie` 不再存在
        file: { path: list-line-indent-block.md, not: "/^  - charlie$/" }
      - label: echo 回到 2 空格
        file: { path: list-line-indent-block.md, has: "/^  - echo$/" }
      - label: hotel 回到 2 空格
        file: { path: list-line-indent-block.md, has: "/^  - hotel$/" }
      - label: 撤销后与原始基线逐字节相同（本文件无见证字符，undo 应完全回到起点）
        file: { path: list-line-indent-block.md, unchangedSince: 原始基线 }
      - label: 撤销真的写了一次盘（与凸排后基线不同——凸排从未落盘时这条会红）
        file: { path: list-line-indent-block.md, changedSince: 凸排后基线 }
      - shot: 一次撤销后

  - name: 换一份同内容的 fixture 做反向选区（新会话光标回到首行，避免复用上一会话的光标 / 选区状态）
    do: open
    file: list-line-indent-block-reverse.md
    marker: "alpha"
    expect:
      - label: 反向选区用的 fixture 已装载
        editor: { has: "alpha" }

  - name: 建立编辑器焦点，光标移到第 8 行行尾
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 记下反向 fixture 的原始基线（收尾必须与它逐字节比较）
    do: record
    as: 反向基线
    file: list-line-indent-block-reverse.md

  - name: 光标下移到第 8 行并到行尾（⌃N ×7 + ⌃E）
    do: keys
    keys:
      [
        "ctrl+n",
        "ctrl+n",
        "ctrl+n",
        "ctrl+n",
        "ctrl+n",
        "ctrl+n",
        "ctrl+n",
        "ctrl+e",
      ]
    expect:
      - label: 落点已钉住（编辑器可读 hotel）
        editor: { has: "hotel" }

  - name: 向上扩选 5 行（第 8 → 3 行，反向选区），再把选区头送到第 3 行行首
    do: keys
    keys:
      [
        "ctrl+shift+p",
        "ctrl+shift+p",
        "ctrl+shift+p",
        "ctrl+shift+p",
        "ctrl+shift+p",
        "ctrl+shift+a",
      ]
    expect:
      - label: 扩选手势不改文档
        file: { path: list-line-indent-block-reverse.md, has: "/^    - charlie$/" }

  - name: ⌘⇧J（凸排）——反向选区必须得到与正向相同的逐行结果
    do: key
    key: "cmd+shift+j"
    expect:
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }

  - name: 按 ⌘S 落盘（发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对反向选区结果
    do: sleep
    ms: 1200
    expect:
      - label: charlie 凸一层（与正向相同）
        file: { path: list-line-indent-block-reverse.md, has: "/^  - charlie$/" }
      - label: delta 凸一层
        file: { path: list-line-indent-block-reverse.md, has: "/^  - delta$/" }
      - label: echo 凸一层
        file: { path: list-line-indent-block-reverse.md, has: "/^- echo$/" }
      - label: foxtrot 凸一层
        file: { path: list-line-indent-block-reverse.md, has: "/^- foxtrot$/" }
      - label: golf 凸一层
        file: { path: list-line-indent-block-reverse.md, has: "/^  - golf$/" }
      - label: hotel 凸一层
        file: { path: list-line-indent-block-reverse.md, has: "/^- hotel$/" }
      - label: 未选中的首行 alpha 逐字节不动
        file: { path: list-line-indent-block-reverse.md, has: "/^- alpha$/" }
      - label: 未选中的 bravo 逐字节不动（首行下的子项不受牵连）
        file: { path: list-line-indent-block-reverse.md, has: "/^  - bravo$/" }
      - label: 未选中的末行 india 逐字节不动
        file: { path: list-line-indent-block-reverse.md, has: "/^- india$/" }
      - shot: 反向选区-逐行凸排

  - name: 一次 ⌘Z + ⌘S 把反向凸排还原，收尾文件回到原始形态
    do: keys
    keys: ["cmd+z", "cmd+s", "cmd+s"]
  - name: 核对收尾
    do: sleep
    ms: 1200
    expect:
      - label: charlie 回到 4 空格
        file: { path: list-line-indent-block-reverse.md, has: "/^    - charlie$/" }
      - label: golf 回到 4 空格
        file: { path: list-line-indent-block-reverse.md, has: "/^    - golf$/" }
      - label: hotel 回到 2 空格
        file: { path: list-line-indent-block-reverse.md, has: "/^  - hotel$/" }
      - label: 撤销后反向 fixture 与反向基线逐字节相同
        file: { path: list-line-indent-block-reverse.md, unchangedSince: 反向基线 }
teardown:
  - label: 收尾：正向 fixture 与原始基线逐字节相同
    file: { path: list-line-indent-block.md, unchangedSince: 原始基线 }
  - label: 收尾：反向 fixture 与反向基线逐字节相同
    file: { path: list-line-indent-block-reverse.md, unchangedSince: 反向基线 }
---

# 列表行缩进的行模型：多行选区（change rework-list-tab-line-model-nov27）

## 这个场景验什么、不验什么（先读这段）

`Tab` / `Shift-Tab` 的**按键链路**在真机上不可注入（KimiCU 的 `press_key("tab")` 产不出
WKWebView 的 Tab keydown，M240 三路归因），所以本场景与场景 43 同一口径：经 `[keys]` 把
`editor.list-indent` / `editor.list-outdent` 绑到通道可达的 `⌘J` / `⌘⇧J`，验**同一条命令**
在真机 WKWebView 上的「选区 → 行集 → 逐行写回 → 落盘」。`Tab` 键本身的链路归 chromium 场景
`tests/visual/scenes/m239-list-tab-indent.spec.ts`。

本场景守的是行模型的**多行选区**半边（单行 / 引用 / 有序 / 非列表在场景 43）：

1. **6 行选区逐行凸排**（用户截图形态）：第 3–8 行各按归属项的结构步长删前导空白；
   charlie / delta / golf 从 4 空格回到 2，echo / foxtrot / hotel 从 2 空格回到 0。
2. **未选中的行逐字节不动**：首行 `- alpha`、首行下的 `  - bravo`、末行 `- india` 的 `has` 是行模型
   的边界断言。如实登记：本场景的 head 在末行 hotel（无子项），旧 head 模型也只改 hotel 一项，所以
   这三条**不足以单独区分旧模型**；「不带子树」的区分度由 `tests/unit/list-indent.test.ts` 与
   chromium 的 bravo + child 用例提供，不要把本场景读成那条回归的唯一防线。
3. **正向 / 反向选区同一结果**：第二次从第 8 行向第 3 行反向扩选，凸排后的磁盘形态与正向逐字节
   相同。两份 fixture 内容逐字节相同——反向用例的增量是**选区方向 + 新会话的干净光标状态**，
   不是新的文档形态。
4. **一次撤销还原**：多行编辑是单次 dispatch，⌘Z 一次回到按键前；撤销后与「原始基线 / 反向基线」
   逐字节比较（`unchangedSince`），并用「凸排后基线」的 `changedSince` 堵死「撤销只在内存里、
   没写盘」的空过。

**不验**：逐像素观感（行首空白的渲染跟随归视觉门禁与 Alex 手感）；`Tab` / `Shift-Tab` 的默认
绑定链路（chromium 覆盖）；「选区尾落在行首不计入」的精确边界（AX 读不到选区，归
`tests/unit/list-indent.test.ts` 的专项用例）。

## 判据走哪几条通道

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 逐行写回（每行缩进量） | **落盘后的 vault 文件**（行锚点正则） | 编辑器 AX 读数是**渲染后**文本：列表 marker 被 widget 替换、行首空白不进 AX——源码级判据只能从磁盘取 |
| 命令真的被注入落实 | 每个操作步后的**配对的磁盘正向断言**（`^  - charlie$` 等） | 文件变了且变成期望形态，说明扩选与 ⌘⇧J 都落了地；⌘S 丢键会让正向断言直接红 |
| [keys] 覆盖本身生效 | 隔离 `config.json` 的内容 | 覆盖没写进去时所有按键空转，文件断言会「恰好保持原样」伪装成 PASS——先读回配置再开跑 |
| 未选行不动 | 行锚点 `has`（alpha / bravo / india）+ 撤销后的 `unchangedSince` 基线 | 只看被改行会漏掉「顺手带走未选行」的回归；这三行的 `has` 是边界判据——「不带子树」的旧模型区分度由单测 / chromium 的 bravo + child 用例承担，本场景不独自承担 |
| 一次撤销 | `changedSince: 凸排后基线` + 还原形态 | 只判形态会在「从未落盘」时空过（M256 现场）；先记凸排后基线再比 |
| 焦点是否仍在编辑器 | `ax: { focused: "AXTextArea" }` | 命令命中即消费的直接后果；焦点跑了说明按键落到别处 |

**落点纪律**（与场景 43 同）：`open` 之后必须 `clickEditor`；不用 `ctrl+a` 定位行首——KimiCU 对
`ctrl+a` 走 AX 全选兼容路径（零键盘事件，场景 68 的现场），会把选区变成全文。本场景的行首用
`ctrl+shift+a`（扩选到行首）把 head 钉在行首。

## 已知边界

- **扩选键会整批丢键**：`ctrl+shift+n` / `ctrl+shift+p` 与 `⌘⇧J` / `⌘S` 都是 chord，套件保持
  盲发不重试（⌘S 发两次换一次容错）。红了先复跑一次再判产品缺陷（REVIEW.md「键盘注入丢键」条）；
  两种红可区分：① 某个 `has` 正向断言红但文件完全没变 ⇒ 多为 ⌘⇧J / ⌘S 丢了；② 变了但不在
  期望行 ⇒ 先查扩选落点；③ `focused` 红 ⇒ 焦点没在编辑器里，先看 `clickEditor`。
- **选区本身不可见**：AX 读不到选区，6 行是否真的被选中由「6 行都按期望形态改写」反推；
  扩选丢一拍时通常表现为只改了一部分行，断言会如实判红，不会假绿。
- **不做手感判定**：行首空白被渲染层隐藏后的观感归 Alex，本场景只留截图证据。
- **`state.readOnly` 守卫在真机上仍无入口**（editable-non-md-files 之后凡能进编辑器的文件类都可
  编辑），不在本场景的覆盖声明里（同场景 43 的口径）。
