---
id: "39-titlebar-identity"
item: 39
title: 标题栏产品标识块：版本号与 tauri.conf.json 逐字节一致、窄窗 ≈520px 退让 modeline、标识块上拖拽窗口成立、三主题截图
fixtures: [identity.md]
open: identity.md
marker: "标识块场景"
steps:
  - name: 标识块在场：产品名与版本号（值从 tauri.conf.json 读入，不硬编码）
    do: settle
    expect:
      - label: 标识块整体上屏——产品名与版本号落在同一个 AX 文本节点内（真机实测 WKWebView 把三段
          合并成一个静态文本「Lumir 0.0.0」；分隔符 aria-hidden 不出现，故此处按「相邻」判而非按「·」判）
        ax: { has: "/$appName[^\\n]{0,4}$appVersion/" }
      - label: AX 树含版本号（$appVersion = tauri.conf.json 的 version，逐字节比对靠占位符代入保证）
        ax: { has: "$appVersion" }
      - label: 宽窗下 modeline 右段不带版本号（展示位互斥：版本号在标题栏）
        ax: { not: "/UTF-8 · $appVersion/" }
      - shot: 标识块-light-宽窗

  - name: 窄窗退让（D2 备选）：窗口调到 520 宽，版本号退 modeline 右段尾部
    do: resizeWindow
    width: 520
    expect:
      - label: 窗口宽度生效值 ≈520（AX 钳制后的真实值，±8pt）
        window: { width: 520 }
      - label: modeline 右段拼出版本号（「… UTF-8 · $appVersion」形态）
        ax: { has: "/UTF-8 · $appVersion/" }
      - label: 版本号与产品名已拆开——没有任何 AX 文本节点同时含两者（该断言在宽窗下必须 FAIL，
          实测过：宽窗 dump 的「Lumir 0.0.0」节点会让它命中）
        ax: { not: "/$appName[^\\n]{0,4}$appVersion/" }
      - shot: 标识块-窄窗520-退让

  - name: 拉宽恢复：回到 1200，版本号回标题栏、modeline 右段恢复原状
    do: resizeWindow
    width: 1200
    expect:
      - label: 窗口宽度恢复 ≈1200
        window: { width: 1200 }
      - label: modeline 右段不再带版本号
        ax: { not: "/UTF-8 · $appVersion/" }
      - label: 版本号回到标题栏——产品名与版本号重新合体在同一 AX 文本节点内
        ax: { has: "/$appName[^\\n]{0,4}$appVersion/" }
      - shot: 标识块-恢复宽窗

  - name: 标识块上按下拖拽窗口成立（drag region 不被标识块阻断）
    do: drag
    target: { x: 1160, y: 21 }
    dx: 120
    dy: 40
    allowOutOfBounds: true
    expect:
      - label: 窗口位置随拖拽移动（Δ ≥ 8pt，动作前后 window_bounds 对比）
        window: { moved: true }

  - name: 主题 dark 下标识块同构（吃 token，零组件级覆盖）
    do: configWrite
    theme: dark
    expect:
      - label: 重启后标识块仍在（dark 下版本号照常读出）
        ax: { has: "$appVersion" }
      - shot: 标识块-dark

  - name: 主题 eink 下标识块同构
    do: configWrite
    theme: eink
    expect:
      - label: 重启后标识块仍在（eink 下版本号照常读出）
        ax: { has: "$appVersion" }
      - shot: 标识块-eink

  - name: 恢复出厂主题 light（不把主题留给下一场景）
    do: configWrite
    theme: light
    expect:
      - label: light 下标识块在
        ax: { has: "$appVersion" }
      - shot: 标识块-light-恢复
---

## 判据说明

- **逐字节一致靠占位符**：`$appName` / `$appVersion` 在场景加载时从本 checkout 的
  `src-tauri/tauri.conf.json` 读真值代入（lib/execute.mjs 的 `appMetaTokens`），断言里的期望值
  因此**就是**真源内容——不是场景里抄一份副本。版本号 bump 后本场景跟着真源走，无需改。
- **拖拽落点 {x:1160, y:21}**：1200pt 窗口里标题栏右端标识块的命中区（右 padding 12pt 内缘）。
  标识块是 span 纯展示元素，WKWebView 不一定给它 AX bbox，故用窗口局部坐标直给（drag 的 {x,y}
  形态）。判据是窗口位置真的移动（window.moved），不是「拖拽事件发出过」。
- **主题截图三张**是 Alex 的过目证据（三主题同构的结构断言在 chromium 侧
  `tests/visual/scenes/titlebar-identity.spec.ts`，真机这里留观感证据）。

## 已知边界

- **AX 树里标识块的粒度（真机实测，2026-09-26）**：WKWebView 把标题栏的
  `ti-name / ti-sep / ti-version` 三段**合并成一个静态文本节点**（宽窗 dump：`AXStaticText = "Lumir 0.1.0"`；
  分隔符「·」标了 `aria-hidden` 不出现，三段之间只剩一个空格）。modeline 侧同理：路径、meta、
  版本号被并成一个节点（窄窗 dump：`AXStaticText = "identity.md Markdown · 8 行 · UTF-8 · 0.1.0"`）。
  因此「版本号在标题栏还是 modeline」只能靠两条互补判据定位：`has "/UTF-8 · $appVersion/"`
  （该串只可能由 modeline 右段产生）与 `has "/$appName[^\n]{0,4}$appVersion/"`
  （两者相邻 = 合体在标题栏）——两条在宽 / 窄窗下取值相反，互为反向输入。
- **`AX 树含产品名` 这类子串断言在这里没有区分度**（REVIEW.md 第 1 条）：窗口标题是「Lumir」，
  AX dump 里 `AXApplication "Lumir"` / `AXWindow "Lumir"` / `AXWebArea (Lumir)` / 菜单项都不来自标识块，
  所以「含 Lumir」在标识块整个隐藏时照样 PASS——ACL 漏配那一轮实测正是如此（版本号四条断言全红、
  产品名断言照绿）。本场景因此改成上面两条互补判据，MUST NOT 退回 `has: "$appName"` 形态。
- **configWrite 重启后不重开文档**：主题三步只断言标识块在场（它不属于任何文档），
  编辑器内容不是本场景的判据面。
- **resizeWindow 的生效值以窗口管理器为准**：若将来给窗口配 min-width 且 >520，本场景的
  `window.width` 断言会如实 FAIL——那是「退让区间不可达」的真信号，不要为它放宽断言。
