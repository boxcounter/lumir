---
id: "51-tab-overflow"
item: 51
title: TAB 溢出态——13 个长名标签下键盘直达 / 循环切换（活跃标签程序化对齐可见）＋ 右键菜单英文上屏（Close / Close Other Tabs / Close Tabs to the Right）
seed:
  registry:
    - { id: acc-taboverflow, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    # 13 个长名标签（标签宽 ~180–230px，可用宽 ~860px）保证标签栏确实溢出；
    # 全部复用既有 fixture（resetVault 本来就把全部 fixture .md 放进 vault），不新增 fixture。
    acc-taboverflow:
      tabs:
        - image-width-probe-other.md
        - links-missing-relative.md
        - list-indent-paragraph.md
        - render-table-degrade.md
        - list-indent-ordered.md
        - list-indent-nested.md
        - image-width-probe.md
        - list-indent-bullet.md
        - image-fallback.md
        - headings-ramp.md
        - end-marker-long.md
        - toc-frontmatter.md
        - tabs-long.md
      active: image-width-probe-other.md
steps:
  - name: 就绪起点——会话恢复出 13 个长名标签，标签栏进入溢出态
    do: settle
    expect:
      # 两张截图是 Alex 过目两个缺陷位的证据（真机的悬浮滚动条与间距只有截图能看见）：
      # 红箭头位 = 标签下缘不再有横向滚动条压着；蓝箭头位 = 最右可见标签与「Lumir 0.2.0」之间有间距。
      - shot: 溢出态标签栏-起点
      - label: 13 个标签都在（每个标签一个关闭钮；标签栏的 AX 树不受滚动裁剪，2026-09-27 实测命中 13 次）
        ax: { count: { pattern: "关闭 ", exact: 13 } }
      - label: 前台是 seed 里存的激活项（第一个标签）
        ax: { has: "/AXRadioButton \\(image-width-probe-other\\.md\\) Value: true/" }
      - label: 第一个标签的正文上屏（回读通道：AXTextArea.value 就是前台文档）
        editor: { has: "另一篇" }
      - label: 产品标识块仍在——溢出态也没把它挤出标题栏（蓝箭头缺陷位的读屏面）
        # 版本号走 $appName / $appVersion 占位符（从 tauri.conf.json 读真值），不硬编码副本
        # （M236 口径，REVIEW.md 第 8 条）——原来这里写死 "Lumir 0.1.0"，版本一 bump 就假红。
        ax: { has: "$appName $appVersion" }

  - name: 注入前把窗口带到前台（键盘注入的前台纪律，README「起实例前的环境纪律」）
    do: focusWindow
    expect:
      - label: 编辑器仍可读（正向锚点：这次 AX 读取是活的，后面的断言才不是空转）
        editor: { has: "另一篇" }
      - label: 起点仍在第一个标签
        ax: { has: "/AXRadioButton \\(image-width-probe-other\\.md\\) Value: true/" }

  # 溢出态下的键盘切换：每一次切换后 ensureActiveVisible（src/tabs.ts）都把活跃标签
  # 程序化对齐回视口——「切了但看不出切到哪」是 M238 的原始缺陷。真机侧能读的判据是
  # 「激活项确实换了」（AXRadioButton Value + 正文回读）；「活跃标签完整可见」的几何判据
  # 在 chromium 层（tests/visual/scenes/m149-tabs.spec.ts 的溢出用例）。
  - name: ⌘9 直达第 9 个标签（image-fallback.md，起点时在视口之外）
    do: key
    key: "cmd+9"
    expect:
      - label: 激活标签切到第 9 个
        ax: { has: "/AXRadioButton \\(image-fallback\\.md\\) Value: true/" }
      - label: 反向：第 1 个不再是激活项（不是「两个都 true」）
        ax: { not: "/AXRadioButton \\(image-width-probe-other\\.md\\) Value: true/" }
      - label: 第 9 个标签的正文上屏（切标签必须真的换文档，不只是换高亮）
        editor: { has: "图片引用场景" }
      - shot: 溢出态-⌘9直达

  - name: ⌃⇥ 循环到第 10 个（headings-ramp.md）
    do: key
    key: "ctrl+tab"
    expect:
      - label: 激活标签切到第 10 个
        ax: { has: "/AXRadioButton \\(headings-ramp\\.md\\) Value: true/" }
      - label: 正文换成它的
        editor: { has: "一级标题 Ramp" }

  - name: ⌃⇥ 再到第 11 个（end-marker-long.md），随后 ⌘1 回到最左
    do: keys
    keys: ["ctrl+tab", "cmd+1"]
    expect:
      - label: 回到第 1 个标签
        ax: { has: "/AXRadioButton \\(image-width-probe-other\\.md\\) Value: true/" }
      - label: 正文跟着回来
        editor: { has: "另一篇" }
      - label: 反向：不是停在第 11 个
        ax: { not: "/AXRadioButton \\(end-marker-long\\.md\\) Value: true/" }

  # M257 菜单英文上屏（Alex 2026-09-27 裁决「上屏」）。右键即开菜单，不执行任何动作；
  # 三条路径的行为本身由场景 50 与 chromium 层 tab-menu.spec.ts 承担，这里只钉上屏语言。
  - name: 右键第一个标签——菜单三项英文上屏（Close / Close Other Tabs / Close Tabs to the Right）
    do: click
    target: { role: AXRadioButton, name: "^image-width-probe-other\\.md$", button: right }
    expect:
      - shot: 溢出态-英文菜单
      - label: 菜单里有「Close」（判据锚在带括号的项名上——`Close Other Tabs` / `Close Tabs to the Right`
          里都不含 `(Close)` 这个子串，因此既不必加锚点也不会三项全中）
        ax: { has: "/AXMenuItem \\(Close\\)/" }
      - label: 菜单里有「Close Other Tabs」
        ax: { has: "Close Other Tabs" }
      - label: 菜单里有「Close Tabs to the Right」
        ax: { has: "Close Tabs to the Right" }
      - label: 反向：中文措辞不再上屏（正向锚点是上面三条英文，不是空转）
        ax: { not: "关闭其他标签" }
      - label: 右键不改上下文：前台仍是第一个标签
        ax: { has: "/AXRadioButton \\(image-width-probe-other\\.md\\) Value: true/" }
      - label: 标签总数不变
        ax: { count: { pattern: "关闭 ", exact: 13 } }

  - name: Esc 收起菜单（键盘关闭路径，不执行任何动作）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起（「Close Other Tabs」不在 AX 里）
        ax: { not: "Close Other Tabs" }
      - label: 13 个标签一个都没少
        ax: { count: { pattern: "关闭 ", exact: 13 } }
---

## 这个场景验什么

M257（tab-overflow-english-menu）的两件事在**真实 WKWebView** 下的表现：

1. **TAB 溢出态**：13 个长名标签让标签栏溢出，⌘9 / ⌃⇥ / ⌘1 切换后活跃标签被
   `ensureActiveVisible` 程序化对齐回视口（M238 不变量在溢出规模下的真机面）。两个 dogfood
   缺陷位的**视觉**证据（无横向滚动条遮挡标签、最右标签与产品名之间有间距）靠 `shot` 留给
   Alex 过目——几何判据（滚动条不占布局高度、右缘间距 = --sp-3）在 chromium 层
   `tests/visual/scenes/m149-tabs.spec.ts` 的溢出用例里，元素级基线 `titlebar-overflow.png`
   钉住整条标题栏的溢出形态。
2. **菜单英文上屏**（M254 的 follow-up 裁决）：右键菜单三项的上屏语言是 Close /
   Close Other Tabs / Close Tabs to the Right，中文措辞不再出现。单测
   （`tests/unit/tab-menu.test.ts`）按 deck D149–D151 逐字断言同一份常量，chromium 层
   `tab-menu.spec.ts` 断言渲染出的那一份，本场景钉真机 AX 面。

## 通道与已知边界（撞上就如实登记，不判产品缺陷）

- **右键取图通道（M257 登记的通道边界，M266 已修）**：`button: right` 要求快照带截图，而 M257 时的
  实现读的是 `mode=ax` 的快照（按设计不带图），这条路径因此必然报「取不到窗口截图，无法用 right 键
  在坐标上点击」——当时登记为通道边界、不判产品缺陷。M266 改读 `mode=full`（同一份快照既带图、
  bbox 又是截图像素口径），场景 50 在同一次实跑里验通，本场景 M269 复跑亦 PASS（证据
  `test-results/m269/`，git 外）。M257 绕过套件通道的旁证（用 KimiCU MCP 直接对 `--keep-app`
  保留的实例右键：三项逐字 Close / Close Other Tabs / Close Tabs to the Right、游标在首项、
  右键不改上下文）仍留档在 `test-results/m257/menu-english-probe.md`（git 外）。菜单英文上屏的
  权威判定在 chromium 层（`tests/visual/scenes/tab-menu.spec.ts`）。
- **AX 暴露滚出视口的标签（本场景实测）**：13 个标签的精确计数在溢出态下 PASS——标签栏的
  AX 树不受滚动裁剪（与 M251 文件树「只暴露可视行」的现场不同形）。
- **注入通道丢键**：`press_key` 对 WKWebView 间歇整批丢键（REVIEW.md 第 11 条）。激活标签
  读数没变先按丢键复跑一次，再判产品缺陷。
- **不做手感判定**：溢出态的观感（滚动条消失后的标签条形态、右缘间距）归 Alex，本场景只留截图。
- **不新增像素基线**：`shot` 是给人看的证据，不做逐像素比较。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance`，隔离 `XDG_CONFIG_HOME`；用户真实 vault 只读。
- 本场景只切标签、开/收菜单，不写盘（13 个标签都是 seed 恢复的干净标签）。
