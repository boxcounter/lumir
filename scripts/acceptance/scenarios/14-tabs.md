---
id: "14-tabs"
item: 14
title: 多标签——预览替换 / 首次输入固定 / 序号直达 / 循环切换 / 关闭确认 / 外部变更点名后台标签
fixtures: [tabs-a.md, tabs-b.md, tabs-long.md]
open: tabs-a.md
marker: "标签场景 A"
steps:
  - name: 首个标签就位（单击树文件 = 预览标签）
    do: settle
    expect:
      - shot: 单标签预览态
      - label: 编辑器装载 tabs-a
        editor: { has: "标签场景 A" }
      - label: 标签栏只有一个标签（每个标签恰好一个关闭钮，读屏名「关闭 <文件名>」）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 预览标签的读屏名不带未保存后缀
        ax: { count: { pattern: "（未保存）", exact: 0 } }

  - name: 键入内容——首次输入即固定（标签转 dirty）
    do: type
    text: "QQQ"
    expect:
      - shot: 首次输入
      - label: 输入真的落进文档
        editor: { has: "QQQ" }

  - name: 单击第二个文件——预览标签已被固定，因此另开一个新标签
    do: open
    file: tabs-b.md
    marker: "标签场景 B"
    expect:
      - shot: 两个标签
      - label: 第二个文件上屏
        editor: { has: "标签场景 B" }
      - label: 现在有两个标签（不是替换：若是替换，上一步的输入会连内容一起消失）
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: ⌘1 直达第一个标签
    do: key
    key: "cmd+1"
    expect:
      - shot: 直达第一个标签
      - label: 第一个标签的正文回到编辑器（含刚才键入的内容）
        editor: { has: "QQQ" }
      - label: 第二个标签的正文不在编辑器里
        editor: { not: "标签场景 B" }

  - name: ⌃⇥ 循环切到下一个标签
    do: key
    key: "ctrl+tab"
    expect:
      - shot: 循环到下一个标签
      - label: 第二个标签的正文上屏
        editor: { has: "标签场景 B" }

  - name: ⌘2 直达第二个标签（直达与循环落到同一个标签）
    do: key
    key: "cmd+2"
    expect:
      - shot: 直达第二个标签
      - label: 仍在第二个标签
        editor: { has: "标签场景 B" }

  - name: ⌘W 关掉干净的当前标签（标签吃掉 ⌘W，不关窗）
    do: key
    key: "cmd+w"
    expect:
      - shot: 关掉一个标签
      - label: 只剩一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 当前是剩下的那个标签——⌘W 没有关窗，编辑器仍在渲染
        editor: { has: "标签场景 A" }
      - label: 第二个标签的正文已经不在了
        editor: { not: "标签场景 B" }

  - name: 再开一个标签，把 tabs-a 留在后台
    do: open
    file: tabs-long.md
    marker: "TOP-MARK"
    expect:
      - shot: 后台标签 + 前台长文
      - label: 长文上屏
        editor: { has: "TOP-MARK" }
      - label: 两个标签并存
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: 后台标签的文件被外部删除（浮条必须点名它，且只影响它）
    do: vaultRm
    file: tabs-a.md
    expect:
      - shot: 外部删除浮条
      - label: 浮条点名被删的那一份文档（删的是**后台**标签）
        ax: { has: "「tabs-a.md」" }
      - label: 前台标签的正文没有被顶掉
        editor: { has: "TOP-MARK" }
      - label: 标签数量不变（外部事件不关标签）
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  # ⌘W 对 dirty 标签的确认：自动保存的 debounce 只有 2s，靠「刚打完字」去撞这个窗口
  # 必然不稳（实测：断言那一刻还带未保存标记，下一步按 ⌘W 时它已被自动保存清掉，
  # 于是标签被直接关掉）。上一步的外部删除把自动保存停在了 not-found 暂停态
  #（save-controller 的 pauseAutosave），dirty 因此是**持久**的，确认浮条才可稳定观测。
  - name: 切回被删的那个标签并键入内容（自动保存已因外部删除暂停，dirty 会留住）
    do: key
    key: "cmd+1"
    expect:
      - shot: 切回 tabs-a
      - label: tabs-a 的正文回到编辑器
        editor: { has: "标签场景 A" }

  - name: 键入内容（这一步之后 dirty 不会被自动保存吃掉）
    do: type
    text: "ZWQ"
    expect:
      - label: 输入落进文档
        editor: { has: "ZWQ" }

  - name: ⌘W 关有未保存修改的标签——先给三个出口
    do: key
    key: "cmd+w"
    expect:
      - shot: 关闭确认
      - label: 出现点名该文件的确认提示（文案 D92）
        ax: { has: "有未保存修改，关闭后修改将丢失" }
      - label: 三个动作都在（文案 D93）
        ax: { has: "放弃修改并关闭" }
      - label: 还没选，标签仍在
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: 选「放弃修改并关闭」
    do: click
    target: { role: AXButton, name: "^放弃修改并关闭$" }
    expect:
      - shot: 关闭后
      - label: 被关掉的那个标签不在了，另一个还在
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 前台回到剩下的长文（关掉当前标签后交给邻座）
        editor: { has: "TOP-MARK" }

  - name: 关掉最后一个标签回空态
    do: key
    key: "cmd+w"
    expect:
      - shot: 空态
      - label: 标签全部关闭
        ax: { count: { pattern: "关闭 ", exact: 0 } }
      - label: modeline 回到无当前文件
        ax: { has: "无当前文件" }

  - name: 空态之后还能继续开（未命名空文档被复用成新的预览标签）
    do: open
    file: tabs-b.md
    marker: "标签场景 B"
    expect:
      - shot: 空态之后重新打开
      - label: 编辑器装载 tabs-b
        editor: { has: "标签场景 B" }
      - label: 标签栏重新出现（空态是隐藏，不是「关掉就没了」）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
---
# 14-tabs —— 多标签（M149）

## 本场景在验什么

标签的**能力面**（会话与切换）在 `src/editor.ts`，**装配面**（标签栏、打开意图、命令）在
`src/main.ts`。本场景走真机通道，验只有在真实 WKWebView + 真实键盘下才成立的事：

1. **打开 / 固定语义**：单击树文件建预览标签、首次输入即固定（固定后单击别的文件另开标签）、
   关掉全部标签后仍能继续开。
2. **键位**：`⌘1` / `⌘2` 直达、`⌃⇥` 循环、`⌘W` 关当前标签（干净直接关、dirty 先确认、
   关掉当前标签后前台交给邻座）。
3. **外部变更按标签路由**：**后台**标签的文件被外部删除时，浮条点名那一份文档、只影响它
   （前台正文与标签数量都不变）。

## 断言口径

- **标签数量**用「关闭钮的读屏名」计数：每个标签恰好一个关闭钮，读屏名是
  `关闭 <文件名>`（文案 D89）。`pattern: "关闭 "`（带空格）因此等价于「标签总数」，且不会被
  toast / 面板文案误命中——确认提示写的是「关闭后修改将丢失」「放弃修改并关闭」，搜索 panel 与
  大纲浮层里的关闭钮读屏名是「关闭」（无空格）。
- **「哪一份文档在屏幕上」**一律用 `editor.has / editor.not` 判正文串——`AXTextArea.value`
  是编辑器当前文档的文本，标签切换是否真的换了文档，只有它能证。
- **这条场景不断言 dirty 标记**（`（未保存）` 的计数）：自动保存的 debounce 只有 2s，
  `do: type` 本身要几百毫秒到一秒（点击 + 注入 + 回读校验），断言与按键都很容易跨过那一拍，
  于是同一个断言会随机器快慢时而红时而绿——实测过一次（断言那一刻还带未保存标记，下一步按
  ⌘W 时它已被自动保存清掉，标签被直接关掉）。**dirty 的逐标签隔离与「关闭前确认」改由
  「外部删除把自动保存停在暂停态」把 dirty 变成持久态之后再来验**（见下）。
- **`⌘W` 对 dirty 标签的确认**依赖上一步先把自动保存停住：`vaultRm` 命中**已打开文档**时，
  save-controller 走「文件已被外部删除」分支并 `pauseAutosave(not-found)`；此后该文档的
  dirty 不会被自动保存清掉，确认浮条才是稳定可观测量（而不是靠撞 2s 窗口）。

## 本场景**不**覆盖「切换后滚动 / 光标恢复」——理由与替代通道

滚动位置的恢复是 M149 的核心行为之一，但**本套件没有能判它的可观测**：

- `AXTextArea.value` 不是视口代理。本应用的 scroller 是 `display: grid` 布局，CM 的视口范围
  远比可见区大（实测：可见区只显示约 24 行时，`.cm-content` 里能查到从滚动位置上方约 1000px
  一路到文末的 70+ 行）。所以「正文里有没有某个串」与「视口在哪」无关，
  `editor: { not: "..." }` 这类断言**不可能**成立为滚动判据。
- 套件也读不到 `scrollTop` 与光标位置（`AXSelectedTextRange` 不在 KimiCU 输出里）。

这条覆盖因此放在 **chromium 视觉通道**：`tests/visual/scenes/m149-tabs.spec.ts` 的
「切标签保留滚动位置与撤销史」用例用 `view.posAtCoords` 读出**视口顶行**，断言切换前后是同一行；
并做过**反向验证**——把 `src/editor.ts` 的 `activateSession → activate()` 里那句滚动恢复注释掉
重跑，该用例如实变红（Expected `填充 44 行。` / Received `# 顶部 TOP-MARK`）。撤销史的逐标签
保留同样在那条用例里（⌘Z 撤回的是切走之前那次输入）。

先例：M148 也把「指示段在真机上确实渲染」这件事放在视觉通道（`toc-outline.spec.ts`）。
**能在哪条通道上判得动就放在哪条**，不为了凑覆盖写一条恒真的断言。

## 没进本场景的其他通道（分工说明，不是漏项）

- **⌘-点击树文件新开固定标签 / 双击固定**：验收套件的 `do: click` 没有修饰键，`target.count`
  被 `cu.mjs` 丢掉（双击不可表达）。这两条在视觉场景里用
  `click({ modifiers: ["Meta"] })` / `dblclick()` 覆盖。
- **原生菜单「关闭」项 → `tab.close`**：`do:` 动作点不到 macOS 菜单栏。菜单手术的结构假设与
  事件载荷由 `src-tauri/src/lib.rs` 的内联测试覆盖（`menu_command_only_covers_our_menu_items`
  对 File / Window 两处 id 各断言一次，与 M131 当年的深度相同）；「菜单事件 → 关标签」这条
  前端链路由视觉场景用 `fireMenuCommand(page, "close")` 覆盖。真机上「菜单的关闭项不再带 ⌘W」
  是目视项，见 mission 报告。
- **标签栏自身的视觉**（激活高亮 / 预览斜体 / dirty 点 / 溢出横滚）：整页容差
  `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）会吞掉整条标签栏，所以视觉回归放在元素级
  基线上（`tab-bar-*.png`）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance`，隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 本场景会**改**合成 vault：`vaultRm` 删掉 `tabs-a.md`、`do: type` 写脏内容（自动保存在
  暂停态，因此会留下一个崩溃备份）。这些都是合成 vault 里的文件，不触碰任何真实文件。
- **不唤起任何系统应用**（不开外链、不调默认应用）。
- 会 `AXRaise` 抢前台焦点（键盘步骤需要），跑完由套件交还。
