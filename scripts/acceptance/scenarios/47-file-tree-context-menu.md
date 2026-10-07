---
id: "47-file-tree-context-menu"
item: 47
title: 文件树条目右键菜单——右键出菜单与项集分流、删除进废纸篓、树内联重命名（含撞名 / 忽略集拒绝）、复制绝对路径、在 Finder 中显示、目录下新建文件与子目录、打开中 tab 的改名联动与删除处置
fixtures: [note.md]
steps:
  - name: 启动就绪：树里 fixture 行在场（正向锚点——这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 plain.md 行
        ax: { has: "plain.md" }
      - label: 树里有 note.md 行
        ax: { has: "note.md" }
      - label: 起点没有打开任何文件（后面「右键不改上下文」的对照基线）
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 启动后的树

  - name: 造出两个靠前的文件（右键走真实指针坐标，必须在可视区内；见「已知边界」）
    do: vaultWrite
    file: aaa-menu.md
    content: "# 菜单圆桌\n\n这一篇用来当文件行的右键对象。\n"
    expect:
      - label: 磁盘上有了 aaa-menu.md
        file: { path: aaa-menu.md, exists: true }
  - name: 再造一个给 tab 联动用（同样靠前）
    do: vaultWrite
    file: aab-tab.md
    content: "# 菜单场景\n\n这一篇用来验改名联动。\n"
    expect:
      - label: 磁盘上有了 aab-tab.md
        file: { path: aab-tab.md, exists: true }
  - name: 等 watcher 把两个新文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 树里有 aaa-menu.md
        ax: { has: "aaa-menu.md" }
      - label: 树里有 aab-tab.md
        ax: { has: "aab-tab.md" }

  - name: 反向铺底：先把剪贴板置成**另一个**文件的绝对路径（下面 aaa-menu.md 的正向断言因此有区分度）
    do: click
    target: { role: AXButton, name: "^aab-tab.md$", button: right }
    expect:
      - label: 文件行菜单在场（铺底那一次也走真实右键路径）
        ax: { has: "复制完整路径" }
  - name: 点「复制完整路径」（铺底那一次）
    do: click
    target: { any: "复制完整路径" }
    expect:
      - label: 剪贴板变成 aab-tab.md 的绝对路径（**in-run 对照**：不依赖跨 run 的剪贴板残留——上一轮 run 结束时剪贴板里是 aaa-menu.md 的路径，对不上就红）
        clipboard: { exact: "$vault/aab-tab.md" }

  - name: 右键文件行 → 菜单出现且含文件项集（四项、不含新建项）
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 菜单里有「重命名…」
        ax: { has: "重命名…" }
      - label: 菜单里有「复制完整路径」
        ax: { has: "复制完整路径" }
      - label: 菜单里有「在 Finder 中显示」
        ax: { has: "在 Finder 中显示" }
      - label: 菜单里有「移到废纸篓…」
        ax: { has: "移到废纸篓…" }
      - label: 文件行菜单不含「新建文件…」（项集分流）
        ax: { not: "新建文件…" }
      - label: 文件行菜单不含「新建子目录…」
        ax: { not: "新建子目录…" }
      - label: 右键不改上下文：仍然没有打开任何文件
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 文件行右键菜单

  - name: Esc 收起菜单（键盘关闭路径）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起（「重命名…」不在 AX 里）
        ax: { not: "重命名…" }
      - label: 没有打开任何文件（右键 + 关闭全程不改上下文）
        ax: { has: "这个 vault 还没有打开的文件" }

  - name: 右键点在行的空白区（名字右侧、行盒右缘之内）也作用于该行
    do: click
    # dx 是节点 bbox 内的横向比例：0.96 落在行盒右缘附近、名字文本之外——那一带属于该行
    # （`.ft-name` 弹性撑满行内剩余宽度），用户在那里点右键说的仍是「这一行」。
    target: { role: AXButton, name: "^aaa-menu.md$", button: right, dx: 0.96 }
    expect:
      - label: 菜单出现（这一带与名字上是同一条命中路径）
        ax: { has: "复制完整路径" }
      - label: 作用行就是指针下那一行（文件项集：有「在 Finder 中显示」、无新建项）
        ax: { has: "在 Finder 中显示" }
      - label: 空白区右键同样不落到目录项集
        ax: { not: "新建文件…" }
      - label: 右键不改上下文（空白区右键也不打开文件）
        ax: { has: "这个 vault 还没有打开的文件" }
      - shot: 行空白区右键菜单
  - name: Esc 收起（下一步从干净状态开始）
    do: key
    key: "escape"
    expect:
      - label: 菜单已收起
        ax: { not: "复制完整路径" }

  - name: 外部造出子目录（给目录行菜单与新建用）
    do: vaultWrite
    file: menu-sub/x.md
    content: "子目录里的笔记。\n"
    expect:
      - label: 磁盘上有了 menu-sub/x.md
        file: { path: menu-sub/x.md, exists: true }

  - name: 右键目录行 → 菜单多出新建两项（六项）
    do: sleep
    ms: 1200
    expect:
      - label: 目录行已在树里
        ax: { has: "menu-sub" }
    # 上一步的 sleep 是等 watcher 把外部新建的目录收敛进树（这一步才对得上右键落点）
  - name: 右键目录行
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 目录行菜单含「新建文件…」
        ax: { has: "新建文件…" }
      - label: 目录行菜单含「新建子目录…」
        ax: { has: "新建子目录…" }
      - label: 目录行菜单也含通用的三项
        ax: { has: "复制完整路径" }
      - label: 目录行菜单含破坏性项
        ax: { has: "移到废纸篓…" }
      - shot: 目录行右键菜单
  - name: Esc 收起目录菜单（下一步的复制必须落在**文件行**的菜单上）
    do: key
    key: "escape"
    expect:
      - label: 目录菜单已收起
        ax: { not: "新建子目录…" }

  - name: 复制完整路径 → 剪贴板读到的必须是**绝对路径**
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 文件行菜单在场
        ax: { has: "复制完整路径" }
  - name: 点「复制完整路径」
    do: click
    target: { any: "复制完整路径" }
    expect:
      - label: 剪贴板是 vault 根 + 相对路径（绝对路径，裁决点 4）
        clipboard: { exact: "$vault/aaa-menu.md" }
      - label: 给出成功提示
        ax: { has: "已复制完整路径" }
      - shot: 复制完整路径之后

  # 「在 Finder 中显示」这一步不在这里，它排在**全场景最后一步**（M358 挪的，理由见那一步的注释
  # 与「已知边界」第 2、3 条）：它是本场景唯一的抢前台动作，而抢前台会让 Lumir 失活、失活会取消
  # 内联重命名框（失焦即取消）。原先它紧挨着下面的改名块，等于把整条改名链放在一次失活的下游。
  - name: 树内联重命名：行名换成输入框（清空原名后输入新名）
    do: click
    target: { role: AXButton, name: "^aaa-menu.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 行内出现输入框，预填的是原名（读屏名 `重命名 {名称}` 的措辞在真机 AX 通道上读不到，见「已知边界」；这里是同一份信息里可读的那一半）
        ax: { has: '/AXTextField = "aaa-menu.md" /' }
      - label: 输入框持焦点（下一步的逐字符注入落在它身上）
        ax: { focused: "AXTextField" }
      - shot: 内联重命名输入框
  - name: 全选原名（chord 盲发不重试）
    do: key
    key: "cmd+a"
  - name: 输入新名（逐字符，回读校验 + 只在字节未变时重试）
    do: keys
    keys: ["a", "a", "a", "r", "e", "n", ".", "m", "d"]
    expect:
      - label: 输入框里是 aaaren.md（注入真的落地了）
        ax: { has: '/AXTextField = "aaaren.md" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 aaaren.md
        file: { path: aaaren.md, exists: true }
      - label: 磁盘上不再有 aaa-menu.md
        file: { path: aaa-menu.md, exists: false }
  - name: 等 watcher 回响把新名收敛进树（改名 = deleted:old + created:new，不能拿 Enter 后的立即读当判据）
    do: waitFor
    waitFor: { has: ["aaaren.md"] }
    expect:
      - label: 树里出现 aaaren.md（watcher 回响收敛）
        ax: { has: "aaaren.md" }
      - label: 全程无「已被外部删除」误报（app 内改名不是外部删除）
        ax: { not: "当前文件已被外部删除" }
      - label: 全程无「检测到外部修改」误报
        ax: { not: "检测到外部修改" }
      - shot: 重命名之后

  - name: 内联重命名撞名：改名到既有 note.md → 行内给原因、磁盘不变
    do: click
    target: { role: AXButton, name: "^aaaren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场且预填的是当前名
        ax: { has: '/AXTextField = "aaaren.md" /' }
      - label: 输入框持焦点
        ax: { focused: "AXTextField" }
  - name: 全选并输入撞名
    do: key
    key: "cmd+a"
  - name: 输入 note.md（与既有 fixture 撞名）
    do: keys
    keys: ["n", "o", "t", "e", ".", "m", "d"]
    expect:
      - label: 行内给出撞名原因（前端预检，提交前就说清）
        ax: { has: "已存在同名条目：note.md" }
  - name: Enter 提交非法名
    do: key
    key: "return"
    expect:
      - label: 既有 note.md 逐字节不变（MUST NOT 覆盖）
        file: { path: note.md, has: "相对目标" }
      - label: aaaren.md 仍在（改名被拒）
        file: { path: aaaren.md, exists: true }
      - shot: 撞名拒绝

  - name: 忽略集名也拒绝（.git）
    do: key
    key: "cmd+a"
  - name: 输入 .git
    do: keys
    keys: [".", "g", "i", "t"]
    expect:
      - label: 行内给出忽略集原因
        ax: { has: "在忽略集内" }
  - name: Enter 提交非法名（仍然拒绝）
    do: key
    key: "return"
    expect:
      - label: aaaren.md 仍在磁盘上（忽略集名不得改名成功）
        file: { path: aaaren.md, exists: true }
  - name: Esc 取消编辑态
    do: key
    key: "escape"
    expect:
      - label: 编辑态已退出（浮层输入框是全应用唯一的 AXTextField——常态不该有它；旧写法断言读屏名不在，而那条名字在真机通道上从来没渲染过，等于恒真）
        ax: { not: "AXTextField" }
      - label: 树里仍显示 aaaren.md
        ax: { has: "aaaren.md" }

  - name: 删除进废纸篓：确认框 → 确认 → vault 内消失
    do: click
    target: { role: AXButton, name: "^aaaren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 确认框出现（两步动作的第二步）
        ax: { has: "移到废纸篓？" }
      - label: 文件档正文点名条目
        ax: { has: "aaaren.md 会移到系统废纸篓。" }
      - shot: 删除确认框（文件）
  - name: 点确认
    do: click
    target: { any: "/^移到废纸篓$/" }
  # 确认之后 MUST NOT 立刻读磁盘（M355）：点确认只把 invoke 发出去，删盘是**异步链路**
  #（webview → Rust command → trash::delete → FSEvents → watcher 回响），而这一步的磁盘读在
  # 同一个 tick 里就跑完了。进程内**第一次** trash 调用要走 macOS 废纸篓子系统的一次性初始化
  #（M355 实测：同机 Swift 探针里首调 16–44ms、之后 0.3–0.5ms），这段冷路径正好落在「断言已发、
  # 删除未回」的窗口里 ⇒ `exists: false` 判红，而 600ms 后同一处读到的树行已经消失（10-07 的
  # 现场：steps.md 的 FAIL 点与 shots/11 的 AX dump）。同一个场景里第二次删除（打开中的文件）
  # 走的是热路径，因此从不撞上——两处一并改成「等可观测终态」，不靠「这次跑得快不快」。
  - name: 等删除经 watcher 回响收敛（删盘的可观测终态）
    do: waitFor
    # 判据为什么是「树行消失」：树**只**由 watcher 的 deleted 回响收敛（装配层约定：成功后
    # 不自绘补丁，唯一收敛通道是回响），行消失即 FS 条目确实已不在。
    # `has` 是**完整性见证**：aab-tab.md 就在目标行的下一行、同屏可见，它在场才说明这次 AX 读取
    # 真的拿到了树行列表——否则「aaaren.md 不在」会被一次退化的快照白白满足（REVIEW.md 第 2 条）。
    waitFor: { has: ["aab-tab.md"], not: ["aaaren.md"] }
    expect:
      - label: vault 内已无该文件（移到废纸篓）
        file: { path: aaaren.md, exists: false }
      - shot: 删除之后

  - name: 目录删除的确认文案必须明示「连同其中全部内容」（取消，不真删）
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」（目录）
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 目录档正文明示连带全部内容
        ax: { has: "menu-sub 会连同其中全部内容一起移到系统废纸篓。" }
      - shot: 删除确认框（目录）
  - name: 取消（Esc）
    do: key
    key: "escape"
    expect:
      - label: 目录与其中的文件都还在
        file: { path: menu-sub/x.md, exists: true }

  - name: 目录下新建文件：内联命名 → 磁盘出现空文件 → 自动打开
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建文件…" }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 行内输入框出现（新建文件的读屏名）
        ax: { has: "新建文件的名称" }
      - shot: 新建文件输入框
  - name: 输入 fresh.md
    do: keys
    keys: ["f", "r", "e", "s", "h", ".", "m", "d"]
    expect:
      - label: 输入落地
        ax: { has: "fresh.md" }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 menu-sub/fresh.md
        file: { path: menu-sub/fresh.md, exists: true }
      - label: 新建的是空文件
        file: { path: menu-sub/fresh.md, has: "" }
      - label: 新文件已自动打开（标签读屏名是 fresh.md）
        ax: { has: "fresh.md" }
      - shot: 新建文件并自动打开

  - name: 目录下新建子目录：磁盘出现目录、树里出现条目
    do: click
    target: { role: AXButton, name: "^menu-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建子目录…" }
  - name: 点「新建子目录…」
    do: click
    target: { any: "新建子目录…" }
    expect:
      - label: 行内输入框出现（新建子目录的读屏名）
        ax: { has: "新建子目录的名称" }
  - name: 输入 freshdir
    do: keys
    keys: ["f", "r", "e", "s", "h", "d", "i", "r"]
    expect:
      - label: 输入落地（空输入框的基线是空串，出现次数判据因此有区分度）
        ax: { has: '/AXTextField = "freshdir" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现新目录（`exists` 对目录成立——M324 起的目录旁路；改前这条恒红）
        file: { path: menu-sub/freshdir, exists: true }
  - name: 等新目录的行收敛进树（新建的节点由 watcher 回响带进来，不能拿 Enter 后的立即读当判据）
    do: waitFor
    waitFor: { has: ["menu-sub/freshdir"] }
    expect:
      - label: 树里出现新目录的条目（后端从磁盘枚举出来的行）
        ax: { has: "menu-sub/freshdir" }
      - shot: 新建子目录之后

  # 加固：目录的磁盘真值**另有一条不依赖目录旁路的判据**——在它里面再建一个文件，那个文件在磁盘上
  # 存在 ⇒ 它的父目录必然是真目录。目录旁路（`exists` 认得目录）与本条互为独立见证。
  - name: 在新目录下再新建一个文件（把「目录真的落在磁盘上」变成可达的磁盘断言）
    do: click
    target: { role: AXButton, name: "^menu-sub/freshdir$", button: right }
    expect:
      - label: 新目录的菜单在场（目录专属项证明右键落在目录行上）
        ax: { has: "新建文件…" }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 行内输入框出现
        ax: { has: "新建文件的名称" }
  - name: 输入 probe.md
    do: keys
    keys: ["p", "r", "o", "b", "e", ".", "m", "d"]
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 menu-sub/freshdir/probe.md（父目录是真的 ⇒ 新建子目录真的落了盘）
        file: { path: menu-sub/freshdir/probe.md, exists: true }
      - label: 新建的是空文件
        file: { path: menu-sub/freshdir/probe.md, has: "" }

  - name: tab 联动：打开中的 dirty 文件被改名——tab 就地换名、内容不丢、不误报
    do: open
    file: aab-tab.md
    marker: "菜单场景"
    expect:
      - label: aab-tab.md 已打开
        editor: { has: "菜单场景" }
  - name: 让它变 dirty（键入探针）
    do: type
    text: "M244DIRTY"
    expect:
      - label: 键入落地并回读
        editor: { has: "M244DIRTY" }
      - label: 未保存标记出现（D90）
        ax: { has: "（未保存）" }
      - label: 反向：探针此刻不在磁盘上
        file: { path: aab-tab.md, not: "M244DIRTY" }
      - shot: 打开中的 dirty 文件
  # 右键对象就是上一步打开并改脏的那一个文件（M324 修正）：旧稿在这里右键 `note.md`（一个没打开、
  # 也没改动的文件），末步却去删 `aab-ren.md`（这个路径从没被创建过）——三步互相矛盾，且 `note.md`
  # 的树行排在字母表靠后、AX 报的内容坐标 y≈1605 落在 768 高的窗口之外，而套件没有滚动动作
  #（README「已知边界」），右键走真实指针坐标根本点不到它。打开中 + 靠近树顶的 `aab-tab.md` 两条都满足。
  - name: 右键打开中的文件 → 重命名
    do: click
    target: { role: AXButton, name: "^aab-tab.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场且预填的是当前名
        ax: { has: '/AXTextField = "aab-tab.md" /' }
      - label: 输入框持焦点
        ax: { focused: "AXTextField" }
  - name: 全选并输入新名
    do: key
    key: "cmd+a"
  - name: 输入 aabren.md
    do: keys
    keys: ["a", "a", "b", "r", "e", "n", ".", "m", "d"]
    expect:
      - label: 输入框里是 aabren.md（注入真的落地了）
        ax: { has: '/AXTextField = "aabren.md" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 aabren.md
        file: { path: aabren.md, exists: true }
      - label: 磁盘上不再有 aab-tab.md（改名不是复制）
        file: { path: aab-tab.md, exists: false }
  - name: 等改名收敛（树行来自 watcher 回响；下一步要右键的那一行必须先到）
    do: waitFor
    waitFor: { has: ["aabren.md"] }
    expect:
      - label: 标签就地换名成新名（dirty 标签的读屏名带「（未保存）」后缀，故只锚前缀）
        ax: { has: "/AXRadioButton \\(aabren\\.md/" }
      - label: 旧名的标签不再存在（与上一条配对：负向断言旁边必有正观测）
        ax: { not: "/AXRadioButton \\(aab-tab\\.md/" }
      - label: 未保存内容仍在编辑器里（改名不改字节）
        editor: { has: "M244DIRTY" }
      - label: 无「检测到外部修改」误报（remap 后 created:new 命中 dirty 会话的那条分支）
        ax: { not: "检测到外部修改" }
      - label: 无「已被外部删除」误报
        ax: { not: "当前文件已被外部删除" }
      - shot: 改名之后的 dirty 标签

  - name: 删除打开中的文件：沿用现状处置（sticky 提示 + 内容不丢）
    do: click
    target: { role: AXButton, name: "^aabren.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "移到废纸篓…" }
  - name: 点「移到废纸篓…」
    do: click
    target: { any: "移到废纸篓…" }
    expect:
      - label: 确认框在场
        ax: { has: "移到废纸篓？" }
  - name: 点确认
    do: click
    target: { any: "/^移到废纸篓$/" }
  # 与上面那次同样的口径（M355）：确认后等**可观测终态**再读磁盘，不在同一个 tick 里赌删盘已经回来。
  # 这里的终态是 sticky 提示——它本身就是 watcher 的 deleted 回响走完的那一刻才出现的
  #（打开中文件的删除处置），比树行更直接。
  - name: 等外部删除处置落到界面（sticky 提示 = 回响已走完）
    do: waitFor
    waitFor: { has: ["当前文件已被外部删除；编辑器中的内容未丢失"] }
    expect:
      - label: vault 内已无该文件
        file: { path: aabren.md, exists: false }
      - label: sticky 提示出现（与外部删除同一处置）
        ax: { has: "当前文件已被外部删除；编辑器中的内容未丢失" }
      - label: 编辑器内容未丢（未保存的改动还在）
        editor: { has: "M244DIRTY" }
      - shot: 删除打开中的文件之后

  # ── 收尾之后的最后一步：唯一的抢前台动作（M358 排位）────────────────────────────────
  # 为什么排在全场景最后：这一步真实调起系统 Finder，Finder 被激活 ⇒ Lumir 失活；而树内联重命名
  # 框的语义是**失焦即取消**（`src/tree.ts`：`input.blur → cancelEdit`，注释写明「与 Finder 一致」）。
  # 失活只要落进「点『重命名…』→ 断言行内有输入框」之间，改名就被无声取消，判据上表现为
  #「行内出现输入框」与「输入框持焦点」双双 FAIL，而 aaa-menu.md 从未改名 ⇒ 撞名 / 忽略集 / 删除 /
  # 收尾整条链级联 FAIL（2026-10-07 的现场：`steps.md` 与 `shots/07`）。它原来是紧挨着改名块的前
  # 一步，等于把整条改名链放在一次失活的下游。挪到最后：它下游只剩 teardown 的磁盘断言（不碰界面），
  # 失活不再有可波及的交互面。**反面的口径**：不要把它挪回任何菜单 / 内联编辑之前，也不要用 sleep
  # 猜「Finder 起完了没有」——排位是结构性的，等时长是猜。
  #
  # 作用对象从 `aaa-menu.md` 换成 `block-copy.md`：前者在本步之前已被改名成 aaaren.md 并删除，
  # 而这一步要求该行**在树里**（右键走真实指针坐标，行还必须在首屏可视区内）。`block-copy.md`
  # 是 fixture（vault 内一个普通 .md 文件行，树顶第 7 行附近，实测 y≈334 窗口点），项集与断言形态
  # 逐条不变：文件行菜单在场、命令无错误 toast、`unchangedSince` 逐字节不变、截图。
  - name: 在 Finder 中显示（弱断言：只读动作，磁盘逐字节不变）
    do: record
    as: finder 前
    file: block-copy.md
    expect:
      - label: 基线记到了（读不到一律 FAIL）
        file: { path: block-copy.md, exists: true }
  - name: 右键 → 在 Finder 中显示
    do: click
    target: { role: AXButton, name: "^block-copy.md$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "在 Finder 中显示" }
  - name: 点「在 Finder 中显示」
    do: click
    target: { any: "在 Finder 中显示" }
    expect:
      - label: 命令没有报错（没有错误 toast）
        ax: { not: "无法在 Finder 中显示" }
      - label: block-copy.md 逐字节未变（relaunch 只调系统文件管理器，不改 vault）
        file: { path: block-copy.md, unchangedSince: finder 前 }
      - shot: 在 Finder 中显示之后

teardown:
  - label: 收尾：aaa-menu.md 已改名并被删除，不在 vault 里
    file: { path: aaa-menu.md, exists: false }
  - label: 收尾：note.md 是 fixture 原文（撞名用例只读它，没动它）
    file: { path: note.md, has: "相对目标" }
  - label: 收尾：新建的文件与目录都落在合成 vault 里（不碰用户真实 vault）
    file: { path: menu-sub/fresh.md, exists: true }
---

# 文件树条目右键菜单（change file-tree-context-menu / M244）

## 这个场景验什么

Alex 请求的六个条目级操作（删除、重命名、复制完整路径、在 Finder 中显示、目录下新建文件 /
子目录）在真实 WKWebView + 真实文件系统上的行为，以及两个必须裁决的联动（裁决点 4 的绝对
路径、裁决点 5 的 tab 联动）：

1. **右键出菜单与项集分流**：文件行四项、目录行六项，破坏性项在尾部；菜单是应用内自绘浮层
   （DOM/AX 可见，因此可断言）；**右键不改上下文**（不打开文件、不动标签）。**右键目标行 =
   菜单作用行**（M251 的不变量）：行元素内任意横向位置（含名字右侧那段空白）与行元素右缘到
   面板右缘之间那条带（`.filetree` 的右内边距）都作用于该行——真机侧判「名字右侧的空白区」
   （`dx` 比例落点），面板右缘那条带由 chromium 层判（真机坐标通道取不到容器 bbox，见「已知边界」）。
   **作用行高亮**（M251，tower 裁决的 A 形态）：菜单开着时那一行带 `is-menu-target`（取选中档
   底色、不动字重），关菜单即撤——真机侧只给截图（本套件无计算属性通道，与第 26 项的情况同因），
   取值判据在 chromium 层 `tests/visual/scenes/tree-menu.spec.ts` 的两条 M251 用例。
2. **删除 = 移到废纸篓 + 确认框**：确认正文按条目类型分两档（目录档明示「连同其中全部内容」），
   确认后 vault 内条目消失。
3. **树内联重命名**：行名换成输入框（预填原名、持焦点）、提交后磁盘改名、**撞名与忽略集名被拒**
   且磁盘逐字节不变。输入框的**读屏名**（`重命名 {名称}`）在真机 AX 通道上读不到（见「已知边界」，
   与场景 56 的同款输入框同因），措辞那条判据落在 chromium 层。
4. **复制完整路径**：剪贴板读到的是**绝对路径**（`$vault/相对路径`）；判据带**in-run 对照**——
   先复制另一个文件并断言，再复制目标文件并断言（不依赖跨 run 的剪贴板残留）。
5. **在 Finder 中显示**：只读动作——磁盘 sha256 未变、无错误提示（不验 Finder 窗口本身，
   见「已知边界」）。M358 起这一步排在**全场景最后**：它是本场景唯一的抢前台动作（真实调起
   Finder），而 Lumir 失活会取消内联重命名框（失焦即取消），原先「紧挨改名块」的排法把整条
   改名链放在一次失活的下游（机制与现场见「已知边界」第 2、3 条）。
6. **目录下新建**：新建文件落盘为空文件且**自动打开**；新建子目录落盘（目录本身的磁盘真值
   由「在它里面再建一个文件」锚定，见「已知边界」）。
7. **tab 联动**（裁决点 5）：打开中的 dirty 文件被改名时，标签就地换名、未保存内容保留、
   **两种误报（「已被外部删除」/「检测到外部修改」）都不出现**（这是 remap + 回响抑制的
   真机判据）；删除打开中的文件时沿用既有外部删除处置（sticky 提示 + 内容不丢）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 菜单出现与项集 | **AX 文本**（菜单项的 label） | 菜单是 DOM 浮层，WKWebView 把它暴露进 AX；原生菜单则完全不可断言（这也是裁决点 1 选自绘的理由之一） |
| 右键这个动作 | **`click` 的 `button: right`**（坐标路径） | AX 索引路径发的是 AXPress（「按下这个元素」），产不出鼠标右键；`contextmenu` 靠真实指针事件。坐标取自节点 bbox 中心（套件新增能力，见本节末尾） |
| 改名 / 新建 / 删除的结果 | **磁盘事实**（`file.exists` / `has` / `unchangedSince`）+ **AX 树** | 命令返回值读不到（套件没有 IPC 读数通道）；磁盘是名实相符的最终判据 |
| 剪贴板内容 | **`clipboard` 断言形态**（固定 `osascript -e 'the clipboard'`） | 剪贴板既不在 AX 也不在磁盘；套件刻意不引入通用 shell 通道，只开这一个窄命令 |
| tab 是否误报 | **AX 文本的负向断言 + 正向配对** | 提示是 sticky toast，AX 里可见；负向断言必须配「同一动作的正向锚点」（本节每条负向断言前面都有正向断言），否则会退化成恒真（REVIEW.md 第 1 条） |
| 内联编辑的输入框起来了 | **`/AXTextField = "<原名>" /` + `focused: AXTextField`** | 读屏名那条在真机通道上不可达（见「已知边界」）；预填值就是读屏名里 `{名称}` 那一段，获焦则钉住「下一步的按键落进它」——两条一起给的是同一个信息，且「哪一行起来的」由值钉死 |

## 本场景用到的套件能力（两处窄扩展，M244，tower 裁决扩 scope）

- **`click` 的 `button`**：`target` 里写 `button: right` 时走坐标路径（节点 bbox 中心注入真实
  鼠标事件），左键默认值行为不变。这是右键唯一的可达通道。
- **`clipboardRead` 动作与 `clipboard` 断言形态**：只有一条固定命令（`osascript -e 'the clipboard'`），
  不接受任意命令、不接受参数；读不到（命令失败）时**一律判 FAIL**，不许当成空（REVIEW.md 第 2 条）。
- **`$vault` 占位符**：期望值里引用合成验收 vault 的绝对路径，避免硬编码 `/tmp` 那一份。

## 已知边界（如实登记，不读成「全量已验」）

- **「在 Finder 中显示」只做弱断言**：Finder 窗口本身不进本套件的可断言面（它是另一个 app 的
  UI，且打开与否取决于系统状态）。这里断言的是「命令没报错 + vault 逐字节未变」；「Finder 里
  真的选中了那一项」由 Alex 手感验收（`fs_reveal_in_finder` 的实现是 opener 插件的
  `reveal_item_in_dir`，语义与 `link_open_path` 同一条最小权限路径）。
- **抢前台的动作 MUST 排在所有菜单 / 内联编辑之后（M358 定策，机制已在代码里核过）**：本场景
  只有「在 Finder 中显示」会真实调起系统 Finder，Finder 被激活 ⇒ Lumir 失活；而树内联重命名框
  的语义是**失焦即取消**（`src/tree.ts:758`，`input.blur → cancelEdit`，注释写明「与 Finder 一致」）。
  失活只要落进「点『重命名…』→ 断言行内有输入框」之间，改名就被无声取消：菜单项点击已经生效、
  输入框也起来过，紧随其后的失焦把它撤掉——判据上只见「行内出现输入框」与「输入框持焦点」两条
  FAIL，而磁盘上 `aaa-menu.md` 原样未动，于是撞名 / 忽略集 / 删除 / 收尾整条链级联 FAIL
  （2026-10-07 的现场：`steps.md` 与 `shots/07`）。**这就是该步被挪到全场景最后一步的理由**：
  它下游只剩 teardown 的磁盘断言（不碰界面），失活不再有可波及的交互面。反面的口径：不要把它
  挪回任何菜单 / 内联编辑之前，也不要靠 `sleep` 猜「Finder 起完了没有」——排位是结构性的。
- **树右键菜单不随失活关闭（M358 核实，与「blur 关菜单」的推测相反）**：菜单（`src/tree-menu.ts`）
  只有两条关闭路径——document 的 `mousedown`（点在菜单外）与 Esc / 动作本身，**没有** blur 路径。
  因此「失活 ⇒ 菜单消失 ⇒ 点击落空」这条推断不成立：失活后菜单仍在 AX 里（可读到），点击也确实
  送得到菜单项上；真正随失活失效的是内联输入框（上一条）。
- **跑批环境会在场景中段整页重载（M358 实测；属套件侧缺陷，不是产品缺陷，场景内无从防）**：验收
  实例的 dev server 是 `vite`，watch 根是**整个仓库**，`.tower/worktrees/**` 也在其中——同机其他
  agent 的 worktree 只要改写 `.html` 或 `tsconfig.json`，vite 就向本实例的前端推一次 **full
  reload**（`app.log`：`[vite] (client) page reload .tower/worktrees/wt-357/…` /
  `changed tsconfig file detected … forcing full-reload`）。重载 = 前端在**同一个 Rust 进程**里
  重新启动 ⇒ 菜单、内联输入框、焦点这些**瞬时界面状态全灭**，vault 与会话是持久的（所以画面看起来
  一切正常，只有正在进行的交互断在半路）。判据：应用诊断日志（`env:logs/<日期>.jsonl`）里出现
  **只有 `vault_scan_ignored` + `vault_load_restore`、没有 `vault_open_watch`** 的成对事件——冷启动
  一定带 `vault_open_watch`，而前端重载走的是 `vault_current` 那条路径（`VaultState::status()` 会
  重扫 ⇒ 那条 `vault_scan_ignored`）。2026-10-07 11:12–11:15 那次 47 的现场即此：11:13:00 同一秒
  里既有被 wt-356 / wt-357 的 `.html` + `tsconfig.json` 触发的那批强制 full reload，又有这份
  jsonl 里的成对事件（`.678` / `.694`），而失败的那一步（点「重命名…」后断言输入框）正落在这一秒。
  场景内防不住：瞬时状态被整页换掉的那一刻，「一步开菜单、下一步点菜单项」的写法必然落空。防线在
  套件侧——让验收实例的 dev server 不 watch `.tower/**`（以及 `dist/**`、`test-results/**`、
  `playwright-report/**`），已按 M358 上报（finding）。
- **注入通道的两条老账**：① `cmd+a` 是 chord，套件**盲发不重试**（丢键就 red，按 README 先复跑
  一次再判产品缺陷）；② `keys` 的逐字符注入对 WKWebView 间歇丢键，本场景的判据都是「回读 +
  只在字节未变时重试」，仍可能整批丢键——红了先复跑。
- **不做手感判定**：菜单的间距/阴影观感、内联输入框的宽度手感归 Alex；本场景只留截图。
- **不新增像素基线**：`shot` 是给人看的证据；形态的逐像素回归在 chromium 侧
  （`tests/visual/scenes/tree-menu.spec.ts` 的五个元素级基线 + M251 新增的「行右侧空白带」用例）。
- **右键命中面只在 chromium 层判到像素级**（M251）：真机坐标通道只能表达「节点 bbox 内的横向
  比例」（`dx`/`dy`），行元素右缘之外那条带（面板右内边距，实测约 9px）在节点 bbox 之外、无法
  按比例表达；用绝对值会把窗口宽度写死。因此本场景判「名字右侧的空白区」（`dx` 落点），
  面板右缘那条带由 `tree-menu.spec.ts` 按**容器 bbox 实测**判（它能量到 `.filetree` 的右缘）。
- **作用行高亮的色值不在真机判**（M251）：本套件无计算属性通道（同本节第 26 项那条边界），
  真机只能给截图（`行空白区右键菜单` 那张里可以肉眼看到那一行被高亮）；「底色 = `--sel`、
  字重不动、关菜单即撤、eink 选中态前景（M291 起为明度带 + 黑字）」四条判据在 chromium 层
  （`tests/visual/scenes/tree-menu.spec.ts` 的两条 M251 用例，含同指针位置的前后对照）。
- **真机 AX 读不到非空值输入框的读屏名（M324 实测，判据因此换了形态）**：WKWebView 暴露给 AX 文本
  通道的 `<input type="text">`，**值为空**时带上读屏名（`AXTextField (新建文件的名称)`），**值非空**
  时只剩 `= "值"`——同一个「新建文件」输入框，用户一敲键就变成 `AXTextField = "sh."`（现场
  `test-results/acceptance/2026-09-26/47-file-tree-context-menu/ax/23-_动作_输入_fresh.md.txt`）。
  行内重命名框是**预填**的（值 = 原名），所以 `ax: { has: "重命名 {名称}" }` 永远读不到——这不是
  产品缺陷，与场景 56（goto-line 的同款预填输入框）是同一条边界。读屏名措辞仍在
  `tests/visual/scenes/tree-menu.spec.ts:138` / `:512` 逐字断言（`.ft-edit` 的 `aria-label`），
  本场景改判**预填值 + 获焦**（同一份信息里可读的那一半）。旧稿那条「编辑态已退出」的负向断言
  同样是空转的（`ax: { not: "重命名 …" }` 在任何时刻都成立），已换成 `ax: { not: "AXTextField" }`。
- **`file.exists` 对目录的语义（M324 起已修）**：改动前 `lib/execute.mjs` 的 `fileInfo()` 用
  `readFile` 算 sha256，目录抛 EISDIR 被吞成 null ⇒ 目录一律被判「不存在」：`exists: true` 假红
  （本场景的「新建子目录落盘」原本就卡在这里，与级联无关的独立缺陷）、`exists: false` 假绿。
  M324 给 `fileInfo` 加了目录旁路（目录只回 mtime/size、不读 sha256；`has/not` 与 sha256 类
  判据在目录上**一律判 FAIL**而不是抛异常/恒真）。本场景另留一条**不依赖该旁路**的独立见证：
  在新目录里再建一个文件并断言那个文件在磁盘上（文件存在 ⇒ 它的父目录必然是真目录）。
- **`any` 目标要写正则形态（M324 修正）**：`click` 的 `target.name` 走**裸正则源**
  （`findNode` 直接 `new RegExp(name)`），而 `target.any` 走 `matcher()`——只有 `/…/` 包起来的才
  解成正则，否则按**子串**比。旧稿的 `any: "^移到废纸篓$"` 因此永远匹配不到（拿带 `^$` 的字面量
  去 `includes`）：确认框的按钮读屏名正是 `AXButton (移到废纸篓)`，现在写成
  `any: "/^移到废纸篓$/"` 锚定它，不与菜单项「移到废纸篓…」混淆。
- **键入的新名不带连字符（M324，通道约束）**：`press_key` 的键名 DSL 没有 `-` 的拼法
  （`keys: ["-"]` 报 `empty key DSL`），而含 `minus` 的整串会被套件的「整串可打印字符」门降级成
  **盲发无重试**（丢掉 README「已知边界」要求的「回读 + 只在字节未变时重试」）。因此本场景两次
  键入式改名都用无连字符的名字（`aaa-menu.md` → `aaaren.md`、`aab-tab.md` → `aabren.md`）；
  改名机制与字符集无关，断言语义不变。
- **删除后的磁盘断言必须等可观测终态（M355，两处删除都按这条写）**：删盘是异步链路
  （webview invoke → Rust command → `trash::delete` → FSEvents → watcher 回响），点确认只是把
  invoke 发出去；而进程内**第一次** trash 调用要走 macOS 废纸篓子系统的一次性初始化。同机 Swift
  探针实测（新建文件 → `NSFileManager.trashItem`，同一进程内连做四次）：首调 **16–44ms**、第二到
  四次 **0.3–0.5ms**。首次那条冷路径足够长，长到「点完立刻读磁盘」会抢在删除回包之前（2026-10-07
  的现场：`steps.md` 判 `exists=true` FAIL，600ms 后的 `shots/11-删除之后` 里树行已经消失；而
  tree 只由 watcher 回响收敛、没有自绘补丁，树行消失反证 FS 条目确实已不在）。因此两处删除都改成
  `do: waitFor` 等**可观测终态**（文件档 = 树行消失；打开中文件 = sticky 提示），磁盘断言排在它后面。
  反向的口径：**不要**把这两条改回「点完立刻读」——它能不能过取决于当次跑得快不快；也**不要**
  用 `sleep` 猜时长。
- **不覆盖**：跨目录移动（非目标）、多选批量操作（非目标）、vault 根本身的右键（非目标）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- **本场景会真的改动合成 vault**：改名（`aaa-menu.md` → `aaaren.md`、打开中的 `aab-tab.md` →
  `aabren.md`）、删除（进系统废纸篓）、新建（`menu-sub/` 下的文件与子目录）。这些都在合成 vault
  里，用户真实 vault 全程只读。
- **废纸篓**：被删的条目真的进系统废纸篓（`trash::delete` 的平台语义，无法在测试里绕过）。
  场景因此不探测 `$HOME/.Trash` 的内容，只断言「vault 内消失」——套件不隔离 HOME。
- **收尾时 Finder 是前台**（M358）：末步「在 Finder 中显示」会真实激活系统 Finder 并把它留在前台。
  这是本场景的预期副作用（同机留着上一轮的 Finder 窗口是最差的起点条件，本场景就在这个条件下验）；
  下一个场景起实例时套件的 `waitAppReady` / `tryForeground` 会把 Lumir 重新带回前台。
