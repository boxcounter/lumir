---
# change stabilize-block-boundary-geometry-nov21：Alex 实测序列的真实按键现场。
# 目标不是 269 的 Enter 缩进，也不是 271 的合成 IME 事件链；本场景验证块边界输入时
# 文档精确终态、正式 marker 恢复与供 Alex 过目行高 / marker 的三段截图。
# 逐帧行高 / padding / 正文左缘的机器判据已在 Chromium；AX 不暴露这些几何读数，
# 本场景绝不把 AX 快照或 shot 包装成 scroll / 像素断言。
id: "272-block-boundary-geometry-nov21"
item: 272
tier: full
title: 块边界真实按键现场：Enter → bullet → 中文、精确源码与正式 marker（三段几何证据截图）
steps:
  # 根目录合成文件：notes 目录默认未展开，等嵌套路径会让 AX 等待永远不可达（首跑 30s 超时）。
  - name: 造独立块边界笔记（词汇后仍保留一行后续文本）
    do: vaultWrite
    file: block-boundary-geometry.md
    content: "词汇\n后续"
    expect:
      - label: 起点源码逐字固定
        file: { path: block-boundary-geometry.md, exact: "词汇\n后续" }

  - name: 等 watch 把新笔记刷进树
    do: waitFor
    waitFor:
      has: ["/block-boundary-geometry\\.md/"]
    timeoutMs: 30000

  - name: 打开块边界笔记
    do: open
    file: block-boundary-geometry.md
    marker: "词汇"
    expect:
      - label: 起点两行行文本都在
        editor: { has: "词汇" }
      - label: 后续行文本也在
        editor: { has: "后续" }

  - name: 记录未编辑基线并建立正文焦点
    do: record
    file: block-boundary-geometry.md
    as: 块边界基线

  - name: 窗口前台 + 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 光标到「词汇」行尾
    do: key
    key: "ctrl+e"
    channel: cgevent
    gapMs: 150

  - name: 第一段现场：Enter 建立块边界新行
    do: key
    key: "return"
    gapMs: 200
    expect:
      - label: 原文与后续文本未丢
        editor: { has: "词汇" }
      - label: 后续行仍在
        editor: { has: "后续" }
      - label: 截图 01 供 Alex 看 Enter 后前行与光标，不作为 AX 几何数值断言
        shot: 01-Enter后

  # `-` 单独落在行首已可触发 widget，不能用要求字面 `-` 回读的 keys 重试通道。
  - name: 第二段现场：盲键 `-`
    do: key
    key: "-"
    gapMs: 200

  - name: 第二段现场：盲键空格，保留 marker 边界形态
    do: key
    key: " "
    gapMs: 200
    expect:
      - label: 截图 02 供 Alex 看 `- ` 时的前行间距与 marker 行，不冒充像素测量
        shot: 02-marker空格后

  # press_key 不接受 CJK；type 的带 index 注入会点击中心并移动 caret。
  # 用既有 Unicode 剪贴板 + 真键盘 ⌘V 在当前 caret 注入，不点击、不冒充原生 IME。
  - name: 第三段现场：准备普通 Unicode 中文文本（不是原生 IME）
    do: clipboardText
    text: "中文"

  - name: 第三段现场：在当前 caret 粘贴中文
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 200
    expect:
      - label: 正式 bullet marker 已恢复（glyph 为 en dash）
        editor: { has: "–" }
      - label: 中文正文完整落在正式 marker 后
        editor: { has: "中文" }
      - label: 后续行未被输入或渲染吞掉
        editor: { has: "后续" }
      - label: 截图 03 供 Alex 看正式 marker 与最终行高，AX 不断言行高数值
        shot: 03-中文与正式marker

  - name: ⌘S 保存并核对最终文档逐字节
    do: key
    key: "cmd+s"
    gapMs: 400
    expect:
      - label: 保存确实改写了本轮文件
        file: { path: block-boundary-geometry.md, changedSince: 块边界基线 }
      - label: 最终源码逐字等于「词汇 + bullet 中文 + 后续」
        file: { path: block-boundary-geometry.md, exact: "词汇\n- 中文\n后续" }
      - label: dirty 已清除
        ax: { not: "（未保存）" }

  - name: 清理合成笔记
    do: vaultRm
    file: block-boundary-geometry.md
---

# 272 — 块边界真实按键现场（change `stabilize-block-boundary-geometry-nov21`）

## 与既有场景的分工

- **269-list-enter-indent** 验证 Enter 后是否留下无意义行首空白；本场景从普通段落的
  `词汇` 行尾开始，覆盖 `Enter → - → 空格 → 中文` 的块边界建立过程。
- **271-ime-list-composition-wkwebview** 用 `isTrusted:false` 的合成事件复刻 IME 路径；
  本场景的 `-` 与空格是普通按键，中文经普通 Unicode 剪贴板在当前 caret 粘贴，
  **不声称经过原生 IME / TSM / marked text**，也不通过点击重新定位插入点。
- 首帧行高、padding、正文左缘与二次跳动的机器判据在
  `tests/visual/scenes/markdown-editing-stability.spec.ts`。本场景负责真实 WKWebView 的
  按键现场、最终文档和正式 marker，不把 AX 当作行高或滚动位置的测量仪。

## 证据口径

三次 `shot` 分别保留 Enter 后、`- ` 后、中文与正式 marker 出现后的窗口现场，供 Alex 看
前行间距、marker 行与最终文本。它们只是截图证据，不含 `pixel` / `geom` 断言，也不声称
AX 能读行高、scrollTop 或光标像素坐标。

`editor.has("–")` / `editor.has("中文")` 只证明正式 marker 与最终文本已上屏；文档真源是
⌘S 后的 `file.exact`，终态必须逐字等于 `词汇\n- 中文\n后续`。
