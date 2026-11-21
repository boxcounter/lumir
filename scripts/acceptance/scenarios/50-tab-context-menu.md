---
id: "50-tab-context-menu"
item: 50
tier: full
title: 标签右键菜单——Close / Close Other Tabs / Close Tabs to the Right / Close All Tabs 四条关闭路径，脏标签走既有确认流（取消即停手）
fixtures: [tabs-a.md, tabs-b.md, tabs-long.md]
seed:
  registry:
    - { id: acc-tabmenu, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-tabmenu: { tabs: [tabs-a.md, tabs-b.md, tabs-long.md], active: tabs-long.md }
steps:
  - name: 就绪起点——会话恢复出三个标签，前台是 tabs-long
    do: settle
    expect:
      - shot: 起点三个标签
      - label: 三个标签都在（每个标签一个关闭钮，读屏名「关闭 <文件名>」）
        ax: { count: { pattern: "关闭 ", exact: 3 } }
      - label: 前台是会话里存的激活项（标签栏的 aria-selected → AXRadioButton 的 Value）
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 第三个标签的正文上屏（回读通道：AXTextArea.value 就是前台文档）
        editor: { has: "长文顶部 TOP-MARK" }

  - name: 右键第一个标签——菜单出现且含三项（Close / Close Other Tabs / Close Tabs to the Right）
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$", button: right }
    expect:
      - label: 菜单里有「Close」（判据锚在**带括号的项名**上：`Close Other Tabs` / `Close Tabs to the Right`
          里都不含 `(Close)` 这个子串，因此这条既不必加锚点也不会三项全中）
        ax: { has: "/AXMenuItem \\(Close\\)/" }
      - label: 菜单里有「Close Other Tabs」
        ax: { has: "Close Other Tabs" }
      - label: 菜单里有「Close Tabs to the Right」
        ax: { has: "Close Tabs to the Right" }
      - label: 菜单里有「Close All Tabs」（change close-all-tabs-nov21，关闭块末尾）
        ax: { has: "Close All Tabs" }
      - label: 右键不改上下文：前台仍是 tabs-long（右键只决定菜单作用于哪一条）
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 标签总数不变
        ax: { count: { pattern: "关闭 ", exact: 3 } }
      - shot: 标签右键菜单

  - name: Esc 收起菜单（键盘关闭路径）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起（「Close Other Tabs」不在 AX 里）
        ax: { not: "Close Other Tabs" }
      - label: 收起动作不关任何标签
        ax: { count: { pattern: "关闭 ", exact: 3 } }

  - name: 右键第二个标签 → 「Close Tabs to the Right」——只关右侧那一个
    do: click
    target: { role: AXRadioButton, name: "^tabs-b\\.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "Close Tabs to the Right" }
  - name: 点「Close Tabs to the Right」
    do: click
    target: { any: "Close Tabs to the Right" }
    expect:
      - shot: 关闭右侧之后
      - label: 只剩两个标签（tabs-b 与其右侧的 tabs-long 里的后者被关掉）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 锚点 tabs-b 仍在（「右侧」不含自己）
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: 被关掉的 tabs-long 不再有标签
        ax: { not: "/AXRadioButton \\(tabs-long\\.md\\)/" }

  - name: 右键第一个标签 → 「Close Other Tabs」——只剩它自己
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "Close Other Tabs" }
  - name: 点「Close Other Tabs」
    do: click
    target: { any: "Close Other Tabs" }
    expect:
      - shot: 关闭其他之后
      - label: 标签栏只剩右键的那一条
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 它成为前台（批量关完之后落点必须是可见的那一条）
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: 正文换成它的（不只是换高亮）
        editor: { has: "标签场景 A" }

  - name: 再开一个标签并弄脏（M278 起 dirty 由构造就持久：写盘只由显式动作触发）
    do: click
    target: { role: AXButton, name: "^tabs-b\\.md$" }
    expect:
      - label: 单击开出一个新标签（M254：单击即正式标签，不再有预览态）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 新标签成为前台
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
  - name: 在 tabs-b 里键入
    do: type
    text: "MENU-DIRTY"
    expect:
      - label: 输入落进文档
        editor: { has: "MENU-DIRTY" }
      - label: 未保存标记上屏
        ax: { has: "（未保存）" }
  - name: 外部改写同一个文件——制造「保存未闭环」的冲突现场（末步的「放弃 ≠ 写盘」判据比的就是这一版）
    do: vaultWrite
    file: tabs-b.md
    content: "---\ntitle: 标签场景 B\n---\n\n# 标签场景 B\n\nDISK-VERSION\n"
    expect:
      - shot: 冲突待决
      - label: 检测到外部修改
        ax: { has: "检测到外部修改" }
      - label: 内存里的修改没丢
        editor: { has: "MENU-DIRTY" }

  - name: 右键第一个标签 → 「Close Other Tabs」被脏标签拦下（复用 M149 的三出口确认）
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "Close Other Tabs" }
  - name: 点「Close Other Tabs」
    do: click
    target: { any: "Close Other Tabs" }
    expect:
      - shot: 脏标签拦截浮条
      - label: 提示点名那一份文档（D92）
        ax: { has: "「tabs-b.md」有未保存修改，关闭后修改将丢失" }
      - label: 出口一「保存并关闭」在
        ax: { has: "保存并关闭" }
      - label: 出口二「放弃修改并关闭」在
        ax: { has: "放弃修改并关闭" }
      - label: 出口三「取消」在
        ax: { has: "取消" }
      - label: 用户还没答复：一个标签都没关
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: 出口三「取消」——批量动作停手，两个标签都不关
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - shot: 取消之后
      - label: 标签数不变
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 未保存的修改仍在内存里
        editor: { has: "MENU-DIRTY" }
      - label: 确认浮条已撤下
        ax: { not: "关闭后修改将丢失" }

  - name: 再来一次，这次选「放弃修改并关闭」
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "Close Other Tabs" }
  - name: 点「Close Other Tabs」
    do: click
    target: { any: "Close Other Tabs" }
    expect:
      - label: 又一次拦下（守卫不因用户刚取消过而放行）
        ax: { has: "「tabs-b.md」有未保存修改，关闭后修改将丢失" }
  - name: 点「放弃修改并关闭」
    do: click
    target: { any: "放弃修改并关闭" }
    expect:
      - shot: 放弃之后
      - label: 批量继续到完成：只剩右键的那一条
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 留下的是 tabs-a 且它是前台
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: 放弃的是内存里的修改——磁盘上仍是冲突时写下的那一版
        file: { path: tabs-b.md, has: "DISK-VERSION" }

  # -------------------------------------------------------------------------
  # change close-all-tabs-nov21：「关闭全部标签」
  #
  # 起点：上一步之后只剩 tabs-a 一条；tabs-b.md 在磁盘上仍是 DISK-VERSION。
  # 本节验三件事：① 全 clean / 脏混合的逐个确认与「取消停手、已关闭不回滚」；
  # ② 放弃 ≠ 写盘、保存才落盘；③ 全关完之后的空态与焦点落点（真机层的唯一判据）。
  # -------------------------------------------------------------------------

  - name: 「关闭全部标签」起点——重开 tabs-b（磁盘版是 DISK-VERSION）
    do: click
    target: { role: AXButton, name: "^tabs-b\\.md$" }
    expect:
      - label: 第二个标签出现
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 新标签成为前台
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
  - name: 再开 tabs-long——三个标签，前台是 tabs-long
    do: click
    target: { role: AXButton, name: "^tabs-long\\.md$" }
    expect:
      - label: 三个标签都在
        ax: { count: { pattern: "关闭 ", exact: 3 } }
      - label: tabs-long 成为前台
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }

  - name: 把 tabs-b 弄脏
    do: click
    target: { role: AXRadioButton, name: "^tabs-b\\.md$" }
    expect:
      - label: tabs-b 成为前台
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
  - name: 在 tabs-b 里键入
    do: type
    text: "ALL-BBB"
    expect:
      - label: 输入落进文档
        editor: { has: "ALL-BBB" }
      - label: 未保存标记上屏
        ax: { has: "（未保存）" }

  - name: 把 tabs-long 也弄脏（两个 dirty，运行期唯一可造的多脏形态）
    do: click
    target: { role: AXRadioButton, name: "^tabs-long\\.md$" }
    expect:
      - label: tabs-long 成为前台
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
  - name: 在 tabs-long 里键入
    do: type
    text: "ALL-GGG"
    expect:
      - label: 输入落进文档
        editor: { has: "ALL-GGG" }

  - name: 右键 tabs-a → 「Close All Tabs」——干净的第一条先关掉，停在 tabs-b 的既有确认上
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$", button: right }
    expect:
      - label: 菜单里有「Close All Tabs」
        ax: { has: "Close All Tabs" }
      - shot: 关闭全部标签的菜单
  - name: 点「Close All Tabs」
    do: click
    target: { any: "Close All Tabs" }
    expect:
      - shot: 关闭全部标签的脏标签拦截
      - label: 提示点名 tabs-b（按打开顺序第一个脏目标，复用 D92）
        ax: { has: "「tabs-b.md」有未保存修改，关闭后修改将丢失" }
      - label: 已成功关闭的 tabs-a 不回滚——标签数 2
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 尚未处理的 tabs-long 还在（D90：脏标签的读屏名带「（未保存）」后缀，按节点身份判）
        node: { role: AXRadioButton, name: "^tabs-long\\.md（未保存）$", present: true }
      - label: 同帧的另一个脏目标 tabs-b 也在（剩下的确实是这两条待处理项，不是只数了个数）
        node: { role: AXRadioButton, name: "^tabs-b\\.md（未保存）$", present: true }

  - name: 出口三「取消」——批量停手，两个标签都留下
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - shot: 关闭全部标签取消之后
      - label: 标签数仍为 2（已关闭的 tabs-a 不回滚，剩下的一个都没动）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 未保存的修改仍在内存里（前台 tabs-long）
        editor: { has: "ALL-GGG" }
      - label: 确认浮条已撤下
        ax: { not: "关闭后修改将丢失" }
      - label: 停手后焦点回到前台编辑器（review r1 P2-1：确认按钮随浮条移除，MUST NOT 留在 body）
        ax: { focused: "AXTextArea" }

  - name: 再来一次：右键 tabs-b → 「Close All Tabs」
    do: click
    # tabs-b 此刻是脏的：读屏名走 D90（`tabs-b.md（未保存）`），按干净名定位会找不到节点。
    target: { role: AXRadioButton, name: "^tabs-b\\.md（未保存）$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "Close All Tabs" }
  - name: 点「Close All Tabs」
    do: click
    target: { any: "Close All Tabs" }
    expect:
      - label: 先问 tabs-b（顺序处理，不并排两条确认）
        ax: { has: "「tabs-b.md」有未保存修改，关闭后修改将丢失" }
  - name: 选「放弃修改并关闭」——批量继续到 tabs-long
    do: click
    target: { any: "放弃修改并关闭" }
    expect:
      - label: 紧接着问 tabs-long（同一时刻只有一条确认浮条）
        ax: { has: "「tabs-long.md」有未保存修改，关闭后修改将丢失" }
      - label: 只有一条确认
        ax: { count: { pattern: "有未保存修改", exact: 1 } }
  - name: 选「保存并关闭」——落盘后关掉最后一个标签
    do: click
    target: { any: "保存并关闭" }
    expect:
      - shot: 关闭全部标签之后
      - label: 标签栏清空
        ax: { count: { pattern: "关闭 ", exact: 0 } }
      - label: Close All 之后 tabs-long 的标签节点已不在（不留同名残留；名字不锚 D90 后缀，干净残留也判红）
        node: { role: AXRadioButton, name: "tabs-long\\.md", present: false }
      - label: 回到空态：modeline 无当前文件
        ax: { has: "无当前文件" }
      - label: 焦点交还编辑器（空文档正文，不掉回 body）
        ax: { focused: "AXTextArea" }
      - label: 放弃 ≠ 写盘：tabs-b 仍是冲突时写下的那一版
        file: { path: tabs-b.md, has: "DISK-VERSION" }
      - label: 保存的那一份落盘了
        file: { path: tabs-long.md, has: "ALL-GGG" }
---

## 这个场景验什么

M254（change `tab-strip-context-menu`）新增的标签右键菜单在**真实 WKWebView + 真实指针事件**下的
三条关闭路径与脏标签拦截。chromium 层（`tests/visual/scenes/tab-menu.spec.ts`）已经端到端覆盖了
同一批行为，包括「保存并关闭不被 onDismiss 抢先作废」这条时序；本场景补的是它给不出的两件事：

1. **真实右键通道**：DOM 的 `contextmenu` 靠真实指针事件产生，AX 的「按下这个元素」路径
   （AXPress）产不出鼠标右键——套件为此给了 `button: right` 的坐标注入形态（M244 起）。
2. **真实文件系统上的「放弃 / 取消」代价**：脏标签的放弃要落到真实磁盘（最后一步断言
   `tabs-b.md` 里是冲突时写下的那一版），chromium 桩只能给出内存读数。

选三条路径的顺序时注意**锚点**：`Close Tabs to the Right` 的锚点是右键落在的那一条，
`Close Other Tabs` 会把它以外的一切关掉——所以先跑「右侧」（保留两条好继续），再跑「其他」。

## 通道与已知边界（撞上就如实登记，不判产品缺陷）

- **右键走真实指针坐标 —— 通道边界已由 M266 修好（2026-09-27）**：`button: right` 要求快照带截图，
  而旧实现用 `mode=ax` 去找 bbox——**那种快照按设计不带图**（header 自述
  `screenshot: none — no image attached`），于是这条路径**必然**报
  `取不到窗口截图，无法用 right 键在坐标上点击`（M244 / M249 / M251 / M252 / M254 同族，M254 另立
  finding）。M266 改读 `mode=full`（`scripts/acceptance/lib/execute.mjs` 的
  `readAxWithScreenshot`：同一份快照既带图、bbox 又是截图像素口径，与 `click` 的 x,y 同空间），
  并在**同一次实跑**里验通：本场景 46 条断言只余 1 条红（且与右键无关），三条路径 + 脏标签拦截
  全部走通。**这条不是产品缺陷**——产品判定另有 chromium 层（`tests/visual/scenes/tab-menu.spec.ts`）
  的同批覆盖。
- **脏标签的窗口期**（M278 之前的约束）：自动保存的防抖曾是停止输入后 2s，靠「刚键入」抢窗口
  在实测里抢不到（M164 的结论，见套件 README 的「dirty 拦截门的可测窗口很窄」）。自动保存已整条
  移除，dirty 现在由构造就持久（写盘只由用户的显式动作触发），这层窗口顾虑不复存在；本场景仍保留
  那一步**外部改写**，但它现在的作用只有一个——把磁盘钉在一个已知的版本上，供末步断言「放弃修改
  不等于写盘」（`tabs-b.md` 仍是冲突时写下的那一版）。
- **菜单项按读屏名点击（M257 起三项英文上屏）**：`Close` 是另两项的前缀，用 `any: "Close"` 会命中
  错的那一项；单点它取**带括号的项名** `/AXMenuItem \(Close\)/`（另两项的项名里都不含 `(Close)`
  这个子串，因此这条既不必加锚点也不会三项全中）。**不要照抄场景 51 的
  `/^AXMenuItem \(Close\)$/m`**：AX dump 的节点行形如 `- [366] AXMenuItem (Close) @290,25 …`，
  行首是缩进与索引，`^` 在 `m` 下只认**行首**，锚定形态在真机上恒不匹配（M266 实测：同一次
  dump 里 `Close Other Tabs` / `Close Tabs to the Right` 两条子串断言 PASS，只有锚定那条 FAIL）。
  场景 51 的那条待其 owner 修（本 mission 不在其 scope）。**标签自身的关闭钮读屏名仍带中文**
  （`关闭 <文件名>`，D90 未随 M257 改语言）——所以本场景的标签数断言仍写
  `count: { pattern: "关闭 " }`，与菜单项不冲突。
- **`Close` 单点路径不在本场景**：它的落点与 `Close Other Tabs` 逐条相同（都是 `closeTab` →
  同一确认流），真机上再走一遍只增加通道风险；覆盖面由 chromium 场景的
  「关闭：只关右键落在的那一条」承担。

## 「关闭全部标签」这一段（change close-all-tabs-nov21）

关闭范围是**右键所在 pane 的标签条**；每次只问一个脏标签，用户取消（或点掉浮条）即停手，
已经成功关闭的不回滚。整段的判据分工：

- **顺序与停手**：第一段先关掉干净的 tabs-a，再停在 tabs-b 的确认上——标签数 2 与
  「tabs-long 还在」两条同时成立，才说明「已关的不回滚、未处理的不动」。
  两条「还在」按节点身份判、并容纳 D90 的 `（未保存）` 后缀（这时两个标签都是脏的）；
  同帧还正观测 tabs-b——只数「关闭」钮分不出剩下的到底是哪两条。
- **全关之后的负向判据**：空态除标签数 0 之外，另判 tabs-long 的 `AXRadioButton` 节点不在
  （名字不锚 D90 后缀）——标签数归零但残留一条同名节点的形态同样判红。
- **放弃 ≠ 写盘 / 保存才落盘**：末两步分别断言 tabs-b 仍是 `DISK-VERSION`、tabs-long 里有
  `ALL-GGG`；这是 chromium 桩给不出的真实文件系统读数。
- **空态与焦点**：全关完后 `ax: { focused: "AXTextArea" }` 是本场景的**新判据**——批量关闭
  没有标签可归还焦点，产品把焦点交给编辑器（空文档正文）；真机层只有这一条能验。
- **停手焦点（review r1 P2-1）**：确认浮条的动作钮在答复那一刻随浮条从 DOM 移除，浏览器会把
  焦点送回 `body`；产品的归还口径是「收尾（全关完或停手）→ 当前前台标签的编辑器正文」。
  本段在「取消」之后与全关之后各有一条 `ax: { focused: "AXTextArea" }` 判据——真机层只有这两条
  能判实际焦点归属（chromium 层的四条 `document.activeElement` 回归见 tab-menu.spec.ts）。
- **多脏形态的构造边界**：运行期只有「打开多个文件后再逐个键入」这一条路能造出多个 dirty
  标签；未命名草稿不是标签（没有路径），批量目标集按 `visibleTabsOf` 口径排除它——
  这一条由单测 `closeAllTargets` 的负向用例钉住，真机不可达（未命名文档 dirty 时打开文件
  会被既有守卫拦下，见 `multi-tabs` 的「未命名文档的 dirty 守卫」）。
