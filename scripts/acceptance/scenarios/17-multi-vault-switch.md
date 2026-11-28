---
id: "17-multi-vault-switch"
item: 17
tier: full
title: 多 vault——树头部入口的列表浮层、切到未打开过的 vault 的空态引导、切回后按会话恢复标签
fixtures: [tabs-a.md, tabs-b.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
    # 惰性缺失的注册项（change fix-selector-ime-aria-nov25 第四轮）：路径不存在 ⇒ 列表里的
    # 失效行（available=false），用来判「失效行同样可被键盘清理」。首次治理只记 missing_since，
    # 不归档，列表照常可见。
    - { id: acc-gone, path: /tmp/lumir-m102-acceptance-gone, lastOpenedAt: 1757000000000 }
steps:
  - name: 打开 tabs-a.md（空态单击：复用空文档出一个正式标签）
    do: open
    file: tabs-a.md
    marker: "标签场景 A"
    expect:
      - shot: 打开 tabs-a
      - label: 正文是 tabs-a
        editor: { has: "标签场景 A" }
      - label: 已经有一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: 键入内容（标签随之 dirty；写盘只由 ⌘S 触发）
    do: type
    text: "APIN"
    expect:
      - shot: 首次输入
      - label: 输入落进文档
        editor: { has: "APIN" }

  - name: ⌘S 保存（把标签留在固定态且回到 clean）
    do: key
    key: "cmd+s"
    expect:
      - shot: 保存之后
      - label: 未保存标记撤下（写盘只由用户的显式动作触发；本步只判「不再 dirty」，不判是哪条路径写的）
        ax: { not: "（未保存）" }
      - label: 磁盘上确有这次输入（固定下来的内容真的落盘了）
        file: { path: tabs-a.md, has: "APIN" }

  - name: 拿前台（修饰键点击走真实指针通道，要求 Lumir 是 key window）
    do: focusWindow
    retries: 4
  - name: ⌘-点击 tabs-b.md——新开一个标签并保留 tabs-a（普通点击会就地替换）
    do: click
    target: { role: AXButton, name: "^tabs-b\\.md$", modifiers: ["cmd"] }
    expect:
      - shot: 两个标签
      - label: 第二个文件上屏
        editor: { has: "标签场景 B" }
      - label: 现在有两个标签（⌘-点击新开；普通点击会就地替换、只剩一个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: 第二个标签也键入 + ⌘S 固定并落盘
    do: type
    text: "BPIN"
    expect:
      - label: 输入落进文档
        editor: { has: "BPIN" }

  - name: 保存第二个标签
    do: key
    key: "cmd+s"
    expect:
      - shot: 两个固定标签
      - label: 两个标签都是固定标签（标签栏仍有两个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 第二个标签的内容也落盘
        file: { path: tabs-b.md, has: "BPIN" }

  - name: 点树头部入口打开切换器（形态 A 的入口点击路径）
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 切换器浮层
      - label: 列表里有两个可用 vault（B 的名字只可能来自列表行——它的目录从没被打开过）
        ax: { has: "lumir-m102-acceptance-b" }
      - label: 当前项带「当前」标且摘要是「2 个标签 · 现在打开」（标签数来自会话落盘，不是前端镜像）
        ax: { has: "当前 2 个标签 · 现在打开" }
      - label: 没有历史的 B 行给 D101 的串（不编一个时间出来）
        ax: { has: "还没有打开过文件" }
      - label: 浮层底部的新增入口在（形态 A 下浮层内唯一的新增入口，D104 的悬停提示）
        ax: { has: "选择一个目录作为新 vault" }

  # change fix-selector-ime-aria-nov25：输入面 ⌘A 全选。必须走 cgevent 真键盘事件——KimiCU 的
  # `cmd+a` 走 AX 全选兼容路径（零键盘事件），验不到产品自己的 Cmd-A 分支。
  - name: 在筛选框输入多字符查询（为 ⌘A 全选造现场）
    do: typeInNode
    target: { role: AXComboBox, name: "筛选" }
    text: "acceptance"
    expect:
      - label: 查询串逐字落在输入框里
        ax: { has: "/AXComboBox \\(筛选\\) Value: acceptance/" }

  - name: ⌘A 全选筛选串（真实键盘事件）
    do: key
    key: "cmd+a"
    channel: cgevent

  - name: 全选后按一次 Backspace（盲发，恰好一次）：全选生效则整串被清空
    do: keys
    keys: ["Backspace"]

  - name: 判输入串是否被整串清空
    do: settle
    expect:
      - label: 输入框已空（没有 Value 字段）；全选未生效时这里会是「acceptanc」的 Value
        ax: { not: "/AXComboBox \\(筛选\\) Value:/" }
      - label: 结果集回到全量（B 行重新出现在列表里，浮层没有因按键收起）
        ax: { has: "lumir-m102-acceptance-b" }

  - name: Esc 收起浮层（浮层内就地消费 Esc，D86 同口径）
    do: key
    key: "escape"

  # Esc / ⌘O 都是**盲发 chord**（套件对 chord 不做回读重试，见 README 的「已知边界」），而紧随
  # 其后的 AX 读取会与「按键被 app 处理」那一拍抢：M296 首跑就撞上——Esc 的读取发生在收起之前，
  # ⌘O 又与尚未处理完的 Esc 叠在一起，浮层状态与场景假设错位，后面两步连带失败（点 B 行时
  # 「找不到可点节点」）。改成轮询可观测终态：两次按键各自确认生效再走下一步。**截图也挪到确认
  # 之后**——留在按键那一步会拍到打开前的帧（首跑的证据里那张 shot 的 AX dump 里根本没有浮层）。
  - name: 等浮层收起生效（状态驱动；Esc 是盲发 chord，读得太早会读到收起前的帧）
    do: waitFor
    waitFor:
      not: ["选择一个目录作为新 vault"]
    expect:
      - label: Esc 收起浮层（关闭后列表内容不在 AX 里）
        ax: { not: "选择一个目录作为新 vault" }

  # change fix-selector-ime-aria-nov25：Esc 是主动关闭，焦点交还编辑器并保持阅读位置。
  - name: Esc 之后焦点交还编辑器
    do: settle
    expect:
      - label: 焦点在编辑器正文（AXTextArea）上，而不是停在已隐藏的筛选框里
        ax: { focused: "AXTextArea" }

  - name: ⌘O 再打开（判 Tab 遍历口径）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层已展开
        ax: { has: "选择一个目录作为新 vault" }

  # 行切换钮与删除钮 tabindex=-1（change fix-selector-ime-aria-nov25）：新实现第一次 Tab 落到
  # 「新增 vault…」、第二次离开浮层；旧实现第二次 Tab 会落到行尾删除钮，浮层保持打开。
  - name: Tab 两次（行与删除钮不进 Tab 序列）
    do: keys
    keys: ["tab", "tab"]
    expect:
      - label: 浮层收起（MUST NOT 让 Tab 在 listbox 的行 / 删除钮之间遍历）
        ax: { not: "选择一个目录作为新 vault" }

  - name: ⌘O 再打开一次
    do: key
    key: "cmd+o"

  - name: 等浮层重新出现（状态驱动）
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    expect:
      - shot: ⌘O 打开的浮层
      - label: 浮层重新出现（D96 的键位路径有效）
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 B 那一行——会话上下文整窗切到 B
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
    expect:
      - shot: 切到 B
      - label: 树头部入口换成 B（整窗上下文真的换了）
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: B 没有打开过的文件——统一空工作区
        ax: { has: "没有打开的文档" }
      - label: B 自己的文件在树里（装载的是 B 的条目，不是空树）
        ax: { has: "beta.md" }
      - label: A 的会话已按稳定 id 落盘，两个固定标签都在
        file: { path: "env:vault-sessions/acc-a.json", has: '"tabs-a.md"' }
      - label: 落盘的顺序与开标签的顺序一致（有序列表，不是集合）
        file: { path: "env:vault-sessions/acc-a.json", has: '/"tabs": \[\n\s*"tabs-a\.md",\n\s*"tabs-b\.md"\n\s*\]/' }
      - label: 激活项是切走时前台那个标签
        file: { path: "env:vault-sessions/acc-a.json", has: '"active": "tabs-b.md"' }

  - name: 再点入口，点 A 那一行切回去
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 第二次浮层
      - label: A 的行按会话给摘要（2 个标签 + 相对时间；它已不是当前项，所以不说「现在打开」）
        ax: { has: '/lumir-m102-acceptance 2 个标签 · /' }

  - name: 点 A 那一行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }
    expect:
      - shot: 切回 A
      - label: 树头部入口换回 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }

  - name: 等装载后的标签恢复跑完（逐标签异步打开）
    do: sleep
    ms: 6000
    expect:
      - shot: 恢复后的两个标签
      - label: 两个标签都恢复了（恢复用的是固定标签意图，否则第二个会顶掉第一个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 激活项是会话里存的那个（tabs-b），不是退化后的第一个
        editor: { has: "BPIN" }
      - label: 第一个标签的正文没有上屏（激活项退化的反证）
        editor: { not: "标签场景 A" }

  # change fix-selector-ime-aria-nov25：行与删除钮都不进 Tab 序列（上面两步已经验过），纯键盘
  # 删除由 Delete / Backspace 承担——查询为空 + 非当前游标行，两次按下 = 同一套两步确认。
  - name: ⌘O 打开切换器（当前项是 A，游标默认落在当前项）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层已展开
        ax: { has: "选择一个目录作为新 vault" }

  - name: ↓ 把游标移到非当前行 B
    do: key
    key: "down"

  - name: 第一次 Delete 进入两步确认（与点行尾 × 同一套确认句）
    do: key
    key: "delete"
    expect:
      - shot: 键盘删除的确认态
      - label: 确认句点名 B，浮层未收起（还没发起移除）
        ax: { has: '/从列表移除「lumir-m102-acceptance-b」/' }

  # change fix-selector-ime-aria-nov25（第三轮）：Esc 第一次只撤确认——不关层、不交还焦点；
  # 第二次 Esc 才按既有规则关闭。这条同时验「确认态有自己的键盘取消出口」。
  - name: Esc 第一次只撤确认（浮层不收起）
    do: key
    key: "escape"
    expect:
      - label: 确认句撤下
        ax: { not: "从列表移除「lumir-m102-acceptance-b」" }
      - label: 浮层仍在（第一次 Esc MUST NOT 关层）
        ax: { has: "选择一个目录作为新 vault" }

  - name: 再按一次 Delete 重新进入确认（目标仍是 B，不是重建后的策略起点）
    do: key
    key: "delete"
    expect:
      - label: 确认句重新点名 B
        ax: { has: '/从列表移除「lumir-m102-acceptance-b」/' }

  - name: 第二次按下 Delete 提交移除
    do: key
    key: "delete"

  - name: 等移除完成（撤销提示出现是移除成功的终端信号）
    do: waitFor
    waitFor:
      has: ["已从列表移除"]
    expect:
      - label: 撤销提示点名被移除的 B
        ax: { has: '/已从列表移除「lumir-m102-acceptance-b」/' }
      - label: B 的行已从列表消失（行标签形态 `AXStaticText (lumir-m102-acceptance-b …)` 只由列表行产生）
        # 判据不能写「AX 里没有『还没有打开过文件』」：失效行 acc-gone 同样没有历史，也带这条摘要
        # （2026-11-25 真机轮现场：删掉 B 之后 [232] AXList 里只剩 A 与 acc-gone 两行，而 acc-gone
        # 那行是「…-gone 还没有打开过文件 路径不可用…」）。失效行是同一 change 第四轮才种下的，
        # 这条负向断言写于只有 A / B 两行的版本，判据因此不再唯一。改名也解决不了「撤销提示里
        # 含被删行名字」那一半：提示是 `AXStaticText = "已从列表移除「…-b」"`，而行是
        # `AXStaticText (…-b …)`——按行标签形态（role + 括号 label + 名字后的空格）取，两者不同形。
        ax: { not: '/AXStaticText \(lumir-m102-acceptance-b /' }

  # 移除**不收起浮层**（`commitRemove` → `reload`，见 src/vault-switcher.ts），而 ⌘O 是开关语义
  # （`vault.switcher` → `switcher.toggle`）：浮层开着时按下会把它关掉。2026-11-25 真机轮就是
  # 这样静默关掉的——紧随其后的「浮层已展开 / 失效行在列表里 / 确认句点名 / 等移除生效」四条
  # 一并级联失败（AX dump 里 element_count 从 239 掉到 230、没有 AXList）。因此先显式关：Esc 是
  # 主动关闭（确认态已被提交清掉，这一次按下走关层），再走 ⌘O 的打开路径。
  - name: Esc 收起浮层（移除后浮层仍开着，⌘O 会把它当开关关掉）
    do: key
    key: "escape"

  - name: 等浮层收起（状态驱动）
    do: waitFor
    waitFor:
      not: ["选择一个目录作为新 vault"]

  # change fix-selector-ime-aria-nov25（第四轮）：失效行同样在键盘游标空间里——`Delete` 走同一套
  # 两步确认、第二次按下移除。`Enter` 的重定位在真机上会起原生目录选择器（套件不驱动，见「不覆盖」），
  # 那条链路由视觉场景用 vault_open 的重映射候选桩判。
  - name: ⌘O 重开切换器（此时只剩当前项 A 与失效行）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层已展开
        ax: { has: "选择一个目录作为新 vault" }
      - label: 失效行在列表里（「重新定位…」只由失效行给出）
        ax: { has: "重新定位…" }

  - name: ↓ 把游标移到失效行（它排在可用项之后，是最后一行）
    do: key
    key: "down"

  - name: 第一次 Delete 进入两步确认（确认句点名失效 vault）
    do: key
    key: "delete"
    expect:
      - shot: 失效行的删除确认
      - label: 确认句点名失效 vault，浮层未收起（还没发起移除）
        ax: { has: '/从列表移除「lumir-m102-acceptance-gone」/' }

  - name: 第二次 Delete 提交移除
    do: key
    key: "delete"

  - name: 等失效行移除生效（撤销提示是唯一能区分「进入确认」与「真的删掉」的终端信号）
    do: waitFor
    waitFor:
      has: ["已从列表移除「lumir-m102-acceptance-gone」"]
    timeoutMs: 15000
    expect:
      - shot: 失效行已移除
      - label: 撤销提示点名失效 vault
        ax: { has: '/已从列表移除「lumir-m102-acceptance-gone」/' }
      - label: 失效行从列表消失（唯一带「重新定位…」的行不在了）
        ax: { not: "重新定位…" }
---

说明：本条对应 change `multi-vault-workspaces` 的任务 6.1 ①，覆盖四条会互相牵连的行为：

1. **入口形态 A**：树头部只有一个入口（`button.ft-vault`，名称 + caret，D96 读屏名），点它开的是
   列表浮层而不是系统目录选择器。因此本场景的每一次切换都是「入口 → 列表行」这条真实路径，
   且**不依赖系统目录选择器**（套件不驱动原生对话框，见 README「已知边界」）。
2. **两个固定标签与按 vault 的会话**：固定标签经「单击打开 → 键入（首次输入即固定，不持久化预览
   标签）」这条真实用户路径得到——**不能用双击**：本套件的注入通道在 WKWebView 里产生不出 DOM 的
   `dblclick`（四条路实测都失败，判据与现场见 README「已知边界」），因此「双击固定」这条路径由
   chromium 视觉通道覆盖（`tests/visual/scenes/m149-tabs.spec.ts`）。
   键入后 ⌘S 把标签留在固定态且 clean——否则 dirty 会触发切换守卫（那是 19 的场景）。
3. **切到没打开过的 vault = 统一空工作区**：B 没有会话历史，装载后一条标签都恢复不出来，正文被
   空工作区表面盖住。这也是**启动**的常态（验收 vault 首次打开时没有会话），因此就绪门必须认它
   （见 `lib/drive.mjs` 的 `waitAppReady`）。
4. **切回后按会话恢复**：断言「激活项是 tabs-b 而不是退化的第一个」，靠的是正文内容
   （`BPIN` 只可能来自 tabs-b）；`editor.not "标签场景 A"` 是它的反证——两条一起才有区分度
   （REVIEW.md 「断言等价于子串」条）。切换前 A 的会话确实落盘这一点另由三条 `file` 断言直接读盘证明
   （存在性 + 有序性 + 激活项）。

**两种寻址为什么不同**：切换用**点列表行**（AX 里的行是 `AXStaticText` + `AXPress`，`any` 匹配
行名），因为列表行的键盘导航依赖**盲发的 ↑↓**——丢一个键就静默切到错的行（REVIEW.md 「重试拼接判据 / 键盘注入丢键」条：
成功判据不该与被测的不可靠通道耦合）。键位路径另用**打开/关闭**两步覆盖（⌘O 开、Esc 关），
失败只会红、不会错切。两行名字互相是前缀（`lumir-m102-acceptance` 是 `...-b` 的前缀），
所以 A 的行用 `"/lumir-m102-acceptance /"`（名称后紧跟空格）排除 B 的行。

**不覆盖**：新增 vault → 系统目录选择器（套件不驱动原生对话框，见 README「已知边界」）；
双击 / ⌘-点击固定标签（同上，另一条通道覆盖）。**失效行的 `Enter` 重定位**同样会起原生目录选择器
（`vault_open` 选目录 → `vault_remap`），真机侧只判「失效行在、能被游标指向」，完整链路
（映射点名稳定 id、按新根装载）由 `tests/visual/scenes/selector-aria-ime-nov25.spec.ts` 的桩判。
**浮层列表的滚动条形态**（M660 #1）同样不在
本场景：AX 读不到滚动条，本场景的注册表只有三个 vault、列表不溢出；隐藏档与「不压行尾移除钮」
的溢出态判据在 `tests/visual/scenes/mv-vault-switcher.spec.ts` 的 M660 #1 用例。
**Tab 遍历与 ARIA 属性**（change fix-selector-ime-aria-nov25）：本场景只判终端事实「两次 Tab 后
浮层收起」；行 / 删除钮的 `tabindex`、`aria-selected` / `aria-current` 与 option id 归 chromium
矩阵（`tests/visual/scenes/selector-aria-ime-nov25.spec.ts`），AX 读不到这些属性。
**筛选框的 ⌘A 全选**同一 change：本场景用 `channel: cgevent` 发真实 ⌘A（KimiCU 的 `cmd+a` 在原生
输入框上走 AX 全选兼容路径，会掩盖产品分支），再按一次 Backspace（盲发）——全选生效才会把整串清空；
判据是输入框不再有 `Value` 字段，AX 读不到 selectionStart / End。

**纯键盘删除**（同一 change）：文末用「`↓` 到 B → `Delete` 进入确认句 → 再按一次 → 撤销提示点名
B」判这条键真的走通；B 删掉后再对**失效行**走同一套三步（它同样在游标空间里，`available=false`
只表示不能切换过去）。`Delete` 经 KimiCU 注入的是 keycode 51（WKWebView 读作 Backspace；浮层把
`Delete` / `Backspace` 当同一个入口）。移除后**行消失**的判据按行标签形态取——B 用
`/AXStaticText \(lumir-m102-acceptance-b /`（行是 `AXStaticText (…-b …)`，撤销提示是
`AXStaticText = "已从列表移除「…-b」"`，两者不同形），失效行用「重新定位…」；「还没有打开过文件」
**不是** B 独有的反证：没有历史的失效行（`acc-gone`）同样带这条摘要。撤销提示本身也含被删行的
名字，因此「AX 里没有这个名字」当不了任何一条判据。「已进入确认」与「真的删掉」由撤销提示区分：
确认态一出现，行内的「重新定位…」就已经不在 DOM 里。**移除不收起浮层**（`commitRemove` →
`reload`），而 ⌘O 是开关语义——想在移除后再验一次打开路径，必须先 Esc + 等终态，否则那一次
⌘O 是关层（2026-11-25 真机轮的级联现场）。
