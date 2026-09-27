---
id: "62-code-block-fullscreen"
item: 62
title: 代码块放大全屏：命令打开遮罩、整块源码在场（含文档视口之外的行）、三条关闭路径关闭后阅读位置不变量成立、缩进块可放大、code 模式无入口、不改写源文件
fixtures: [code-block-fullscreen.md, code-block-fullscreen.txt]
open: code-block-fullscreen.md
marker: "TOP-MARK"
config:
  keys: { "Cmd-j": "code-block.toggle-fullscreen" }
# caret 的落点策略（与场景 61 同一条，M277 现场实测）：只用**一次点击 + 4–20 步 chain**，且每个
# 目标块都有足够多的行让单次丢键（±1 步）仍落在块内。块内文本节点与图表 widget 在 AX 里都没有
# bbox ⇒ 可点的锚点只有「编辑器首行」（clickEditor）与 AXTable 一类元素。fixture 行号：
#   1 = 开头段落（负对照）｜3..8 = 缩进块（6 行）｜10..13 = 短围栏块｜19..109 = 长块（90 行）｜
#   116 = 尾部标记。
steps:
  - name: 终态：文档首两屏在渲染行里、尾部标记在视口之外、标签栏在场
    expect:
      - label: 缩进块的内容在编辑器文本里
        editor: { has: "indented body one" }
      - label: 长块的首行在渲染行里（位置判据的正观测支点）
        ax: { has: "line 0001" }
      - label: 文档尾部的标记此刻**不在** AX 里（视口在篇首 ⇒ 后面「翻屏后它在」那条有区分度）
        ax: { not: "TAIL-END-MARK" }
      - label: 标签栏在场（遮罩打开后它会从 AX 树里消失，这条是那个变化的对照）
        ax: { has: "关闭 code-block-fullscreen.md" }
      - shot: 终态

  - name: 基线：记录磁盘文件（供末尾逐字节比较）
    do: record
    file: code-block-fullscreen.md
    as: doc
    expect:
      - label: 磁盘基线可记
        file: { path: code-block-fullscreen.md, exists: true }

  # ---- 负对照①：正文段落里执行命令（点编辑器首行 = 开头段落） ----
  - name: 焦点进编辑器（caret 落在第 1 行 = 开头段落）
    do: clickEditor
    dx: 40
    dy: 6
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 抢前台（同机另有一个 Lumir 实例在跑时后台注入的 chord 会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: 负对照：在段落里执行 code-block.toggle-fullscreen（⌘J）
    do: key
    key: "cmd+j"
  - name: 负对照：等一拍再读
    do: settle
    expect:
      - label: 标签栏还在（没有模态接管 ⇒ 遮罩没打开）
        ax: { has: "关闭 code-block-fullscreen.md" }
      - label: 文档未落盘改写
        file: { path: code-block-fullscreen.md, unchangedSince: doc }
      - shot: 段落里执行命令后

  # ---- 正观测①：缩进代码块可放大（从第 1 行走 4 步；块跨 3..8 ⇒ ±2 步都落在块内） ----
  - name: caret 下移到缩进块（⌃N × 4 ⇒ 第 5 行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 执行 ⌘J（缩进块）
    do: key
    key: "cmd+j"
  - name: 等遮罩打开
    do: settle
    expect:
      - label: 遮罩打开（AX 树被模态接管：标签栏消失）
        ax: { not: "关闭 code-block-fullscreen.md" }
      - label: 遮罩里有该块的内容行（缩进块没有围栏行 ⇒ 内容就是这两行）
        ax: { has: "indented body six" }
      - shot: 缩进块全屏
  - name: 关闭（Esc）
    do: key
    key: "escape"
    expect:
      - label: 遮罩退场
        ax: { has: "关闭 code-block-fullscreen.md" }

  # ---- 正观测②：长块 —— 整块呈现（含文档视口之外的行）+ 关闭后阅读位置不变量 ----
  - name: caret 移进长块（⌃N × 25 ⇒ 第 30 行，块跨 19..109）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 位置前置：⌃V 翻屏把视口移到文档尾部，caret 留在长块里（已在视口之外）
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v"]
    expect:
      - label: 长块的首行已不在渲染行里（视口真的离开了长块；与浮层里那条同串对照）
        ax: { not: "line 0001" }
      - label: 正观测：文档尾部的标记此刻在渲染行里（上面那条负向断言不得在「读不到」上空转）
        ax: { has: "TAIL-END-MARK" }
      - shot: 翻屏到尾部
  - name: 执行 code-block.toggle-fullscreen（⌘J）
    do: key
    key: "cmd+j"
  - name: 等遮罩打开
    do: settle
    expect:
      - label: AX 树被模态接管（标签栏从树里消失 ⇒ 下面两条判的是浮层里那一份）
        ax: { not: "关闭 code-block-fullscreen.md" }
      - label: "**只在视口之外**的那段文本在场（整块呈现的判据；「只渲染视口内那几行」的方案在这里必红）"
        ax: { has: "line 0001" }
      - label: 浮层持有焦点（模态层的判据：`role=dialog` 的根在 AX 里是唯一的 focused 节点）
        ax: { focused: "AXGroup" }
      - label: 浮层读屏名 = 文档内容器的同一份标签（该块是第 3 块：缩进 / 短围栏 / 长块）
        ax: { has: "AXGroup (Markdown 代码块 3)" }
      - shot: 长块全屏

  - name: 关闭路径一：Esc（就地消费）关闭并交还焦点，且阅读位置不动
    do: key
    key: "escape"
    expect:
      - label: 浮层已退场
        ax: { has: "关闭 code-block-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - label: "**阅读位置不变量**：文档尾部的标记仍在渲染行里（与位置前置步同一条串）"
        ax: { has: "TAIL-END-MARK" }
      - label: 长块首行仍不在渲染行里（负向那一半，防上一条在「读不到」上空转）
        ax: { not: "line 0001" }
      - shot: Esc 关闭后

  - name: 关闭路径二：点遮罩（面板以外区域）
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩重新打开（下面那条关闭断言才有对象）
        ax: { not: "关闭 code-block-fullscreen.md" }
  - name: 点遮罩顶边（面板以外的区域）关闭
    do: click
    target: { x: 600, y: 4 }
    expect:
      - label: 浮层已退场
        ax: { has: "关闭 code-block-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - label: 阅读位置不变量：文档尾部仍在渲染行里
        ax: { has: "TAIL-END-MARK" }
      - label: 长块首行仍不在渲染行里
        ax: { not: "line 0001" }
      - shot: 点遮罩关闭后

  - name: 关闭路径三：再次执行同一命令（toggle）
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩重新打开
        ax: { not: "关闭 code-block-fullscreen.md" }
  - name: 再执行一次 ⌘J
    do: key
    key: "cmd+j"
    expect:
      - label: 浮层已退场
        ax: { has: "关闭 code-block-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - label: 阅读位置不变量：文档尾部仍在渲染行里
        ax: { has: "TAIL-END-MARK" }
      - label: 长块首行仍不在渲染行里
        ax: { not: "line 0001" }
      - shot: toggle 关闭后

  # ---- 负对照②：code 模式（非 md 文件）没有入口 ----
  - name: 打开非 md 文件（code 模式）
    do: open
    file: code-block-fullscreen.txt
    marker: "code 模式负对照靶子"
  - name: 焦点进编辑器（不给焦点则「无入口」会因为键没送到而假绿）
    do: clickEditor
    dx: 40
    dy: 6
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 在 code 模式里执行同一命令
    do: key
    key: "cmd+j"
  - name: 负对照：等一拍再读
    do: settle
    expect:
      - label: 没有遮罩（code 模式没有块对象、没有入口）
        ax: { has: "关闭 code-block-fullscreen.txt" }
      - shot: code-模式里执行命令后

teardown:
  - label: 收尾：md fixture 的磁盘 sha256 与基线相同（ADR 0003 §3）
    file: { path: code-block-fullscreen.md, unchangedSince: doc }
---
# 代码块放大全屏查看（M277，change `code-block-fullscreen`）

Alex 原话（2026-09-27）：「代码块也可以像表格那样，放大查看。」

## 这个场景验什么

真机 WKWebView 下的打开 / 关闭闭环与两条**只有真机层能判**的判据：

| 判据 | 为什么只有这一层能判 |
|---|---|
| 整块源码在场（**含文档视口之外的行**） | CM 只渲染视口附近的行；「只克隆渲染 DOM」的方案在这里必红（chromium 层同样可判，本层是真机的第二道） |
| 三条关闭路径后**阅读位置不变量**（渲染行判据） | M274 的消融实验证明「关闭交还焦点把视口拽回」在 chromium 上完全看不见（WebKit 才跳）。本层是**判别层**，chromium 的位置断言只是回归护栏 |

其余（内容逐字节、折行两口径的滚动几何、>64 KiB 退化、计算样式保真、触发钮 hover 与两钮共存、
「caret 在普通段落里不命中」）由 chromium 场景
`tests/visual/scenes/m277-code-block-fullscreen.spec.ts` 覆盖。

## 判据的分层与边界（如实登记）

- **caret 落点只走「一次点击 + 4–20 步 chain」**：块内文本节点与图表 widget 在 AX 里都没有 bbox
  （M277 现场实测），可点的锚点只有编辑器首行；长 chain 会丢键，因此 fixture 让每个目标块都有
  足够多的行（缩进块 2 行 + 短围栏块紧随、长块 90 行），单次丢键（±1 步）仍落在块内。
- **「不改写源文件」的机器判据走磁盘 sha256**：套件的 `editor` 断言读的是 AX **渲染**文本，而
  渲染态会随「caret 是否落在渲染块里」变化（M277 实测：点表格后 AX 文本多出一个换行，而文档与
  磁盘逐字节未变）。因此本场景用 `file.unchangedSince`（sha256）判「不改写」；**文档模型层**的
  逐字节判据在 chromium 场景里（`readDocument` 直接读 CM state）。
- **阅读位置判据用渲染行**（AX 只给可见区 ± ~1000px 的行建节点）：套件不暴露 `scrollTop`，也不
  提供 `scroll` 动作。这条判据只覆盖整屏级跳变，小幅漂移属手感、归 Alex 人肉（同场景 25 的口径）。
- **`blur` 兜底那条关闭路径未覆盖**：它的驱动方式是「把焦点交给别处」，在不换文档的前提下没有
  稳定的注入通道（change tasks 6.1 的登记）。MUST NOT 拿 Esc 路径的绿灯冒充它。
- **M280 补记（2026-09-27，本场景的判据一字未改）**：本场景在真机上**修前也 PASS**（M277 的
  落地批），而那两次 PASS **不等于**位置不变量成立——同一条几何在 chromium 与「真机同款 UA 的
  Playwright WebKit」下时红时绿（`test-results/m280/` 与 `test-results/m279/REPORT.md` §2）。
  因此本场景在真机层只能当**回归护栏**（修前修后都绿），MUST NOT 引用它宣称 CL-1 已验。
  M280 试图为条款补两条真机场景（表格 ESC / 代码块 ESC），实测**做不出可证伪的判据**：
  器材三约束（无 `scrollTop` 读数、AX 文本窗口宽达 ~2500–3600px、命令入口的块定位范围
  `tableDiscoveryRange` 把「caret 在视口上方」的可用带子压到 ~2048 字符以内）逐条实测见
  `docs/backlog.md` 的「验收套件表达不了 CL-1 的判据」条；那两条场景**未留在套件里**，
  真机判据目前只能靠人肉复现。
- **⌘J 只能发一次**：`code-block.toggle-fullscreen` 是 toggle，连发两次＝开了又关（与场景 61 的
  `block.copy` 不同——那条命令幂等，才可以用「发两次」抗丢键）。因此本场景的三条关闭路径各是一次
  单发；丢键时断言会如实判红，按 REVIEW.md 第 11 条先复跑一次再判缺陷。
