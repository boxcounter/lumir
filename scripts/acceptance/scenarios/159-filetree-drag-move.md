---
id: "159-filetree-drag-move"
item: 159
tier: core
title: 文件树拖拽移动——拖文件入目录、拖目录入目录、撞名拒绝三态（人话提示 / 源不变 / 目标不变）、拖入自身子树与文件行均不可落、拖到 vault 名行 / 列表尾部空白落根
seed:
  # 两个 vault 都登记（M538）：⑧ 的「列表尾部空白落根」需要一个**短列表**才能把「最后一行之下
  # 那片空白」和嵌套源行同时放进窗口里，而验收 vault 根下 64 个 fixture 行 + 盒子一共 65+ 行
  # （≈1600px > 窗口高），两处永远无法同屏。第二个 vault 只有 `beta.md` + 本场景自建的盒子，
  # 三行封顶——这是唯一能在真机上走通那一档的现场。切过去的路径与场景 49/60 同一套（⌘O +
  # 点 B 行 + 状态驱动等装载）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: 启动就绪（vault 入口钮在场 = 这次 AX 读取是活的）
    do: settle
    expect:
      - label: vault 入口钮在场
        ax: { has: '/AXPopUpButton \(vault：/' }
      - shot: 启动后的树

  # ---------------------------------------------------------------------------------------------
  # 夹具（全合成名）装在自建的 `dragbox/` 里——**这是本场景的地基，别改成散落在 vault 根下**。
  #
  # 为什么：`drag` 动作只接受「起点节点 + dx/dy 位移」，没有「落到某个节点上」的形态，因此落点
  # 靠**行相邻 + dy = ±25（行高）**算出来。而验收 vault 根下有 60+ 个 fixture 文件行（resetVault
  # 铺全部 `fixtures/*.md`），「根第 N 行」这种行模型随夹具名单漂走：2026-10-16 的真机读数显示
  # 原来的 ①（drag-a.md「根第 3 行」）实际落到了 `code-block-fullscreen.md` 行上（文件行不是落点，
  # 静默无事发生）。
  #
  # 盒子展开后它的孩子行是**连续**的（目录在前、文件按名排序，与根下同一规则），行距与相邻关系
  # 只由本场景自己的名字决定，与 fixture 名单、与别的场景留下的根下残留都无关。
  #
  # 盒内行序（本场景所有拖点的依据）：
  #   [0] dragbox（盒） [1] drag-src（目录） [2] drag-target（目录）
  #   [3] drag-a-file.md  [4] drag-b-clash.md  [5] drag-c-notdrop.md  [6] drag-d-notdrop.md
  # 目录段在前（drag-src < drag-target），文件段在后（a-file < b-clash < c-notdrop < d-notdrop）。
  # 每个拖点都与落点行**相邻**，因此 dy 恒为 ±25；改名 / 加文件 / 改行高时这里的相邻关系会变。
  #
  # ⑥⑦ 的**根落点**用的是另一条几何（2026-10-16 真机读数，行高 24、首行 top=81、vault 名行
  # @23,54 183×19，换算是 `screen = dump/0.96 + (8,40)`）：树头部（列表第一行之上）在 dump
  # y ∈ [42, 81)，屏幕 y ∈ [83.75, 124.4)，中点 ≈ 104。
  #   ⑦ 的源 dragbox/drag-root-clash.md 是盒内第 9 行（dump 中心 285 → 屏幕 336.9）⇒ dy = −233；
  #   ⑥ 的源 dragbox/drag-root-move.md 是盒内第 10 行（dump 中心 309 → 屏幕 361.9）⇒ dy = −258。
  # 两个源都在「③ 那一档的源」之下（drag-root-clash < drag-root-move），因此 ⑥ 把 drag-root-move
  # 移走**不会**移动 ⑦ 的源行——两档谁先谁后都成立（这是刻意挑的：加行 / 移动都会漂，别改成
  # 顺序敏感的安排）。⑥⑦ 都在既有 ①–⑤ 之后，跑它们时 drag-target 仍展开着（④ 展开的），
  # 上面那张盒内行序表就是那一步之后的形态。
  # ---------------------------------------------------------------------------------------------
  - name: 铺拖拽夹具①：盒子里的源目录（② 的源，撞名档的落点目录里带同名文件）
    do: vaultWrite
    file: dragbox/drag-src/keep.md
    content: "# 被拖目录的占位\n\nSRC-KEEP-CONTENT-159。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-src/keep.md
        file: { path: dragbox/drag-src/keep.md, exists: true }
  - name: 铺拖拽夹具②：目标目录里预置同名文件（③ 撞名档的既有目标）
    do: vaultWrite
    file: dragbox/drag-target/drag-b-clash.md
    content: "# 既有同名目标\n\nTARGET-ORIGINAL-159——撞名时这条内容必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-target/drag-b-clash.md
        file: { path: dragbox/drag-target/drag-b-clash.md, exists: true }
  - name: 铺拖拽夹具③：① 的源（名字排在文件段最前，因此它的行紧挨目标目录行）
    do: vaultWrite
    file: dragbox/drag-a-file.md
    content: "# 待拖文件 A\n\nDRAG-A-CONTENT-159。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-a-file.md
        file: { path: dragbox/drag-a-file.md, exists: true }
  - name: 铺拖拽夹具④：③ 撞名档的源（与技术②里的目标同名）
    do: vaultWrite
    file: dragbox/drag-b-clash.md
    content: "# 待拖文件 B\n\nCLASH-SOURCE-159——撞名拒绝后这条内容必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-b-clash.md
        file: { path: dragbox/drag-b-clash.md, exists: true }
  - name: 铺拖拽夹具⑤：⑤ 的源（要往文件行上拖）
    do: vaultWrite
    file: dragbox/drag-c-notdrop.md
    content: "# 待拖文件 C\n\nNOTDROP-SOURCE-159——文件行不是落点，拖完这条内容必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-c-notdrop.md
        file: { path: dragbox/drag-c-notdrop.md, exists: true }
  - name: 铺拖拽夹具⑥：⑤ 的落点行（文件行）
    do: vaultWrite
    file: dragbox/drag-d-notdrop.md
    content: "# 待拖文件 D\n\nNOTDROP-TARGET-159。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-d-notdrop.md
        file: { path: dragbox/drag-d-notdrop.md, exists: true }

  - name: 等 watcher 把盒子与文件收敛进树
    do: sleep
    ms: 1500
  - name: 展开盒子（它的孩子行必须连续，后面的拖点才成立——新建目录初始是折叠的）
    do: click
    target: { role: AXButton, name: "^dragbox$" }
  - name: 盒内行按序在场（读屏名是完整相对路径；目录段在前、文件段在后）
    do: settle
    expect:
      - label: 盒子行在场
        ax: { has: '/AXButton \(dragbox\)/' }
      - label: 盒内源目录行在场（② 的源）
        ax: { has: '/AXButton \(dragbox\/drag-src\)/' }
      - label: 盒内目标目录行在场（①③④ 的落点）
        ax: { has: '/AXButton \(dragbox\/drag-target\)/' }
      - label: 盒内第一个文件行在场（① 的源，紧挨目标目录行）
        ax: { has: '/AXButton \(dragbox\/drag-a-file\.md\)/' }
      - label: 撞名档源文件行在场（③ 的源）
        ax: { has: '/AXButton \(dragbox\/drag-b-clash\.md\)/' }
      - label: ⑤ 的源文件行在场
        ax: { has: '/AXButton \(dragbox\/drag-c-notdrop\.md\)/' }
      - label: ⑤ 的落点文件行在场
        ax: { has: '/AXButton \(dragbox\/drag-d-notdrop\.md\)/' }
      - shot: 盒内夹具就位

  - name: 撞名档基线①：源的 sha256 + mtime（拒绝后它必须一字不动）
    do: record
    as: 撞名源基线
    file: dragbox/drag-b-clash.md
    expect:
      - label: 基线可读（读不到一律 FAIL）
        file: { path: dragbox/drag-b-clash.md, exists: true }
  - name: 撞名档基线②：既有目标的 sha256 + mtime
    do: record
    as: 撞名目标基线
    file: dragbox/drag-target/drag-b-clash.md
    expect:
      - label: 基线可读
        file: { path: dragbox/drag-target/drag-b-clash.md, exists: true }
  - name: ⑤ 禁放档基线①：源（往后拖到文件行上，必须一字不动）
    do: record
    as: 禁放源基线
    file: dragbox/drag-c-notdrop.md
    expect:
      - label: 基线可读
        file: { path: dragbox/drag-c-notdrop.md, exists: true }
  - name: ⑤ 禁放档基线②：落点文件行本身
    do: record
    as: 禁放目标基线
    file: dragbox/drag-d-notdrop.md
    expect:
      - label: 基线可读
        file: { path: dragbox/drag-d-notdrop.md, exists: true }

  - name: ① 拖文件入目录：drag-a-file.md（盒内文件段第一行）拖到 drag-target（相邻的上一个行 = 目标目录行，dy = −25）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-a-file\\.md$" }
    dy: -25
    settleMs: 1500
    expect:
      - label: 磁盘上 dragbox/drag-target/drag-a-file.md 出现（移动在后端落盘）
        file: { path: dragbox/drag-target/drag-a-file.md, exists: true }
      - label: 磁盘上 dragbox/drag-a-file.md 已不存在（不是复制——**这一条是落盘的强判据**：残留的旧目标文件骗得过上一条，骗不过这一条）
        file: { path: dragbox/drag-a-file.md, exists: false }
      - shot: 拖文件入目录后
  - name: ① 的树收敛：watcher 回响后盒内旧行消失（新行是目标目录的子行，要等 ④ 展开它才看得见——本步只判旧行）
    do: waitFor
    waitFor: { not: ['/AXButton \(dragbox\/drag-a-file\.md\)/'] }
    timeoutMs: 30000
    expect:
      - label: 盒内旧行 dragbox/drag-a-file.md 消失（树收敛，不自绘补丁）
        ax: { not: '/AXButton \(dragbox\/drag-a-file\.md\)/' }

  - name: ② 拖目录入目录：drag-src（盒内目录段第一行）拖到 drag-target（相邻的下一行，dy = +25）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-src$" }
    dy: 25
    settleMs: 1500
    expect:
      - label: 磁盘上 dragbox/drag-target/drag-src/keep.md 出现（目录带着内容移动）
        file: { path: dragbox/drag-target/drag-src/keep.md, exists: true }
      - label: 磁盘上旧位置 dragbox/drag-src/keep.md 不存在（目录的「消失」用目录内的文件判——M324：目录旁路下 exists:false 恒绿，无区分度）
        file: { path: dragbox/drag-src/keep.md, exists: false }
      - shot: 拖目录入目录后
  - name: ② 的树收敛：盒内旧目录行消失
    do: waitFor
    waitFor: { not: ['/AXButton \(dragbox\/drag-src\)/'] }
    timeoutMs: 30000
    expect:
      - label: 盒内旧行 dragbox/drag-src 消失
        ax: { not: '/AXButton \(dragbox\/drag-src\)/' }

  - name: ③ 撞名拒绝：drag-b-clash.md（盒内文件段第一行）拖到 drag-target（相邻的上一个行，其中已有同名 drag-b-clash.md，dy = −25）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-b-clash\\.md$" }
    dy: -25
    settleMs: 1500
    expect:
      - label: 三态之一：人话提示在场（fs_already_exists 的 message；AX toast 停留时长有限，故在本步内立即断言）
        ax: { has: "已存在同名条目" }
      - label: 三态之二：源内容逐字节不变（sha256 对账，**单独一条**——与下一条 mtime 成对，见「断言口径」）
        file: { path: dragbox/drag-b-clash.md, unchangedSince: 撞名源基线 }
      - label: 三态之二（续）：源 mtime 未推进（sha256 相同只说明内容没变，「写了同一份内容」要靠这一条排掉）
        file: { path: dragbox/drag-b-clash.md, mtimeUnchangedSince: 撞名源基线 }
      - label: 三态之三：既有同名目标内容逐字节不变
        file: { path: dragbox/drag-target/drag-b-clash.md, unchangedSince: 撞名目标基线 }
      - label: 三态之三（续）：目标 mtime 未推进
        file: { path: dragbox/drag-target/drag-b-clash.md, mtimeUnchangedSince: 撞名目标基线 }
      - label: 源文件仍在原处
        file: { path: dragbox/drag-b-clash.md, exists: true }
      - shot: 撞名拒绝后
  - name: ③ 的树不动：盒内源行仍在，也没有多出别的行
    do: settle
    expect:
      - label: 盒内 drag-b-clash.md 行仍在（移动没有发生）
        ax: { has: '/AXButton \(dragbox\/drag-b-clash\.md\)/' }
      - label: 盒内目标目录行仍在（内容对账在上一步）
        ax: { has: '/AXButton \(dragbox\/drag-target\)/' }

  - name: ④ 展开目标目录——同时是 ①② 两条落盘移动的**树收敛正观测**（子行只在展开后才是树里的行）
    do: click
    target: { role: AXButton, name: "^dragbox/drag-target$" }
    expect:
      - label: ① 移进来的文件作为子行在场（完整相对路径）
        ax: { has: '/AXButton \(dragbox\/drag-target\/drag-a-file\.md\)/' }
      - label: ② 移进来的目录作为子行在场
        ax: { has: '/AXButton \(dragbox\/drag-target\/drag-src\)/' }
      - shot: 目标目录展开后的树
  - name: ④ 拖目录入自身子树拒绝：drag-target 拖到它的孩子 drag-target/drag-src（相邻的下一行，dy = +25）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-target$" }
    dy: 25
    settleMs: 1500
    expect:
      - label: 子树内容原样（drag-target 没有被搬进自己里面）
        file: { path: dragbox/drag-target/drag-src/keep.md, exists: true }
      - label: 没有移动发生的错误提示（客户端在 dragover 就拒了，不该走到后端报错）
        ax: { not: "不能移动到自身或其子目录" }
      - label: 树形原样：目标目录的孩子行都在
        ax: { has: '/AXButton \(dragbox\/drag-target\/drag-a-file\.md\)/' }
      - shot: 拖入自身子树拒绝后

  - name: ⑤ 文件行不是落点：drag-c-notdrop.md 拖到相邻的下一行 drag-d-notdrop.md（文件行，dy = +25）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-c-notdrop\\.md$" }
    dy: 25
    settleMs: 1500
    expect:
      - label: 源内容逐字节不变（sha256——没有移动发生）
        file: { path: dragbox/drag-c-notdrop.md, unchangedSince: 禁放源基线 }
      - label: 源 mtime 未推进（sha256 相同只说明内容没变）
        file: { path: dragbox/drag-c-notdrop.md, mtimeUnchangedSince: 禁放源基线 }
      - label: 源仍在磁盘原处
        file: { path: dragbox/drag-c-notdrop.md, exists: true }
      - label: 落点文件行本身内容逐字节不变
        file: { path: dragbox/drag-d-notdrop.md, unchangedSince: 禁放目标基线 }
      - label: 落点文件行 mtime 未推进
        file: { path: dragbox/drag-d-notdrop.md, mtimeUnchangedSince: 禁放目标基线 }
      - label: 没有「落点不接受」之外的错误提示（没走到后端）
        ax: { not: "已存在同名条目" }
      - label: 树形原样：两行都还在盒内
        ax: { has: '/AXButton \(dragbox\/drag-c-notdrop\.md\)/' }
      - label: 落点行也在
        ax: { has: '/AXButton \(dragbox\/drag-d-notdrop\.md\)/' }

  # =============================================================================================
  # ⑥⑦⑧ vault 根落点（M538）：树头部（vault 名行那一带）与列表尾部之下的空白都 = 移到 vault 根。
  # ⑥⑦ 在验收 vault（夹具都在盒子里，行位置见 front-matter 的行序说明）；⑧ 必须换到**短列表**
  # 的第二个 vault 才成立（那里的最后一行之下才有可见空白），理由见 front-matter 的 seed 注释。
  # =============================================================================================

  - name: 铺根落点夹具①：⑥ 的源（盒内文件段最后一行——它的行位置不受⑦的移动影响，见 front-matter）
    do: vaultWrite
    file: dragbox/drag-root-move.md
    content: "# 待拖回根的占位\n\nROOT-MOVE-CONTENT-159——回到根后这几行必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-root-move.md
        file: { path: dragbox/drag-root-move.md, exists: true }
  - name: 铺根落点夹具②：⑦ 撞名档的源（盒内，名字排在 ⑥ 的源之前）
    do: vaultWrite
    file: dragbox/drag-root-clash.md
    content: "# 根撞名档的源\n\nROOT-CLASH-SOURCE-159——根落点撞名被拒后必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragbox/drag-root-clash.md
        file: { path: dragbox/drag-root-clash.md, exists: true }
  - name: 铺根落点夹具③：⑦ 的既有同名目标（在 vault **根**下——根落点的撞名与目录落点同一档）
    do: vaultWrite
    file: drag-root-clash.md
    content: "# 根下的既有同名条目\n\nROOT-CLASH-TARGET-159——拒绝后必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了根下的 drag-root-clash.md
        file: { path: drag-root-clash.md, exists: true }
  - name: 等 watcher 把三件根落点夹具收敛进树
    do: sleep
    ms: 1500
  - name: 根落点夹具就位（盒内两行 + 根下既有同名条目行）
    do: settle
    expect:
      - label: 盒内 ⑥ 的源行在场
        ax: { has: '/AXButton \(dragbox\/drag-root-move\.md\)/' }
      - label: 盒内 ⑦ 的源行在场
        ax: { has: '/AXButton \(dragbox\/drag-root-clash\.md\)/' }
      - label: 根下的既有同名条目行在场（根级行的读屏名就是文件名本身，没有目录前缀）
        ax: { has: '/AXButton \(drag-root-clash\.md\)/' }
      - shot: 根落点夹具就位

  - name: ⑥ 基线：源的 sha256 + mtime（移动后内容与 mtime 都该不变——rename 保 inode）
    do: record
    as: 根落点源基线
    file: dragbox/drag-root-move.md
    expect:
      - label: 基线可读（读不到一律 FAIL）
        file: { path: dragbox/drag-root-move.md, exists: true }
  - name: ⑦ 根撞名基线①：源的 sha256 + mtime
    do: record
    as: 根撞名源基线
    file: dragbox/drag-root-clash.md
    expect:
      - label: 基线可读
        file: { path: dragbox/drag-root-clash.md, exists: true }
  - name: ⑦ 根撞名基线②：根下既有同名目标的 sha256 + mtime
    do: record
    as: 根撞名目标基线
    file: drag-root-clash.md
    expect:
      - label: 基线可读
        file: { path: drag-root-clash.md, exists: true }

  - name: ⑥ 拖文件到树头部落根：dragbox/drag-root-move.md（盒内最后一行）拖到 vault 名行（树头部，dy = −258）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-root-move\\.md$" }
    dy: -258
    settleMs: 1500
    expect:
      - label: 磁盘上根下的 drag-root-move.md 出现（移动在后端落盘）
        file: { path: drag-root-move.md, exists: true }
      - label: 磁盘上 dragbox/drag-root-move.md 已不存在（不是复制——**这一条是落盘的强判据**）
        file: { path: dragbox/drag-root-move.md, exists: false }
      - label: 内容逐字节不变（sha256 对账：移动不改内容，**单独一条**——与下一条 mtime 成对）
        file: { path: drag-root-move.md, unchangedSince: 根落点源基线 }
      - label: mtime 未推进（`fs_move_entry` 是 rename、保 inode ⇒ 与「复制 + 重写」那一类分得开）
        file: { path: drag-root-move.md, mtimeUnchangedSince: 根落点源基线 }
      - shot: 拖到树头部落根后
  - name: ⑥ 的树收敛：盒内旧行消失、根下新行出现（watcher 回响是唯一收敛通道）
    do: waitFor
    waitFor:
      has: ['/AXButton \(drag-root-move\.md\)/']
      not: ['/AXButton \(dragbox\/drag-root-move\.md\)/']
    timeoutMs: 30000
    expect:
      - label: 盒内旧行 dragbox/drag-root-move.md 消失
        ax: { not: '/AXButton \(dragbox\/drag-root-move\.md\)/' }
      - label: 根下的新行在场（`\(drag-root-move\.md\)` 的括号定位保证它不误命中盒内旧行）
        ax: { has: '/AXButton \(drag-root-move\.md\)/' }

  - name: ⑦ 根落点撞名拒绝：dragbox/drag-root-clash.md 拖到 vault 名行（根下已有同名，dy = −233）
    do: drag
    target: { role: AXButton, name: "^dragbox/drag-root-clash\\.md$" }
    dy: -233
    settleMs: 1500
    expect:
      - label: 三态之一：人话提示在场（fs_already_exists 的 message；AX toast 停留时长有限，故在本步内立即断言）
        ax: { has: "已存在同名条目" }
      - label: 三态之二：源内容逐字节不变（sha256 对账，与目录行落点的撞名档同一份判据）
        file: { path: dragbox/drag-root-clash.md, unchangedSince: 根撞名源基线 }
      - label: 三态之二（续）：源 mtime 未推进
        file: { path: dragbox/drag-root-clash.md, mtimeUnchangedSince: 根撞名源基线 }
      - label: 三态之三：根下既有同名目标内容逐字节不变
        file: { path: drag-root-clash.md, unchangedSince: 根撞名目标基线 }
      - label: 三态之三（续）：目标 mtime 未推进
        file: { path: drag-root-clash.md, mtimeUnchangedSince: 根撞名目标基线 }
      - label: 源文件仍在原处（没有被搬走）
        file: { path: dragbox/drag-root-clash.md, exists: true }
      - shot: 根落点撞名拒绝后
  - name: ⑦ 的树不动：盒内源行与根下目标行都还在，也没有多出别的行
    do: settle
    expect:
      - label: 盒内 drag-root-clash.md 行仍在（移动没有发生）
        ax: { has: '/AXButton \(dragbox\/drag-root-clash\.md\)/' }
      - label: 根下 drag-root-clash.md 行仍在（内容对账在上一步）
        ax: { has: '/AXButton \(drag-root-clash\.md\)/' }

  - name: ⑧ 切到第二个 vault（② 的短列表：只有 shortbox 与 beta.md，尾部空白才在窗口里）
    do: key
    key: "cmd+o"
    expect:
      - label: vault 列表打开且第二个 vault 的行在场
        ax: { has: "/lumir-m102-acceptance-b/" }
  - name: ⑧ 点第二个 vault 的行（列表浮层的行文本就是 vault 显示名）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: ⑧ 等切到 B 的装载跑完（**状态驱动，不用 settle 猜装载时长**——与场景 49/60 同口径）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000
    expect:
      - label: 当前 vault 是 B
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - shot: B 装载完成
  - name: ⑧ 铺 ⑧ 的源：第二个 vault 里造一个嵌套文件（`vaultSparse` 是套件唯一能写第二个 vault 的动作）
    do: vaultSparse
    vault: second
    file: shortbox/keep.md
    size: 256
    expect:
      - label: 第二个 vault 里有了 shortbox/keep.md（第二个 vault 的绝对路径写法是 `$vault-b`，与 secondVaultDir() 同址）
        file: { path: $vault-b/shortbox/keep.md, exists: true }
  - name: ⑧ 等 watcher 把 shortbox 收敛进 B 的树（状态驱动：下一步要点击这一行）
    do: waitFor
    waitFor:
      has: ['/AXButton \(shortbox\)/']
    timeoutMs: 30000
  - name: ⑧ 展开 shortbox（嵌套行只在展开后才是树里的行）
    do: click
    target: { role: AXButton, name: "^shortbox$" }
  - name: ⑧ 的夹具就位（B 的短列表：shortbox / shortbox-keep.md / beta.md）
    do: settle
    expect:
      - label: shortbox 行在场
        ax: { has: '/AXButton \(shortbox\)/' }
      - label: ⑧ 的源行在场（嵌套行的读屏名是完整相对路径）
        ax: { has: '/AXButton \(shortbox\/keep\.md\)/' }
      - label: 列表最后一行（beta.md）在场——「最后一行之下那片空白」是 ⑧ 的落点区
        ax: { has: '/AXButton \(beta\.md\)/' }
      - shot: B 的短列表就位
  - name: ⑧ 拖到列表尾部之下的空白落根：shortbox/keep.md 拖到列表下方那片空白（dy = +191）
    do: drag
    target: { role: AXButton, name: "^shortbox/keep\\.md$" }
    dy: 191
    settleMs: 1500
    expect:
      - label: 第二个 vault 根下的 keep.md 出现（移动在后端落盘）
        file: { path: $vault-b/keep.md, exists: true }
      - label: 旧位置 shortbox/keep.md 已不存在（不是复制——**这一条是落盘的强判据**）
        file: { path: $vault-b/shortbox/keep.md, exists: false }
      - shot: 拖到尾部空白落根后
  - name: ⑧ 的树收敛：B 的盒内旧行消失、根下新行出现
    do: waitFor
    waitFor:
      has: ['/AXButton \(keep\.md\)/']
      not: ['/AXButton \(shortbox\/keep\.md\)/']
    timeoutMs: 30000
    expect:
      - label: 盒内旧行 shortbox/keep.md 消失
        ax: { not: '/AXButton \(shortbox\/keep\.md\)/' }
      - label: 根下的新行 keep.md 在场（括号定位保证它不误命中盒内旧行）
        ax: { has: '/AXButton \(keep\.md\)/' }

teardown:
  - label: 终局磁盘状态：两次成功移动的结果在、三档拒绝都没动任何东西
    file: { path: dragbox/drag-target/drag-a-file.md, exists: true }
  - label: 被拖目录带着内容落在目标里
    file: { path: dragbox/drag-target/drag-src/keep.md, exists: true }
  - label: 撞名后源与目标各归原位
    file: { path: dragbox/drag-b-clash.md, unchangedSince: 撞名源基线 }
  - label: 目标内容逐字节不变
    file: { path: dragbox/drag-target/drag-b-clash.md, unchangedSince: 撞名目标基线 }
  - label: ⑥ 的落根结果留在根下（内容与 mtime 逐字节 / 逐毫秒不变）
    file: { path: drag-root-move.md, unchangedSince: 根落点源基线 }
  - label: ⑦ 根落点的撞名档两侧都没动（源）
    file: { path: dragbox/drag-root-clash.md, unchangedSince: 根撞名源基线 }
  - label: ⑦ 根落点的撞名档两侧都没动（根下既有目标）
    file: { path: drag-root-clash.md, unchangedSince: 根撞名目标基线 }
  - label: ⑧ 的落根结果留在第二个 vault 根下
    file: { path: $vault-b/keep.md, exists: true }
---

# 159-filetree-drag-move —— 文件树拖拽移动（M530；根落点 M538）

## 本场景在验什么

文件树行支持 HTML5 DnD：文件 / 目录行可拖，落在**目录行**上 = 移入该目录（不支持排序、不支持落到
文件行——`src/tree.ts` 的 dropLandingAt / canMoveEntry）。**vault 根也是落点**（⑥⑦⑧，M538）：树头部
（vault 名行那一带）与列表尾部之下的空白都表示「移动到 vault 根」，高亮统一反馈到 vault 名行。

1. **拖文件入目录**：源与目标都在磁盘上原位对账（新路径出现 + 旧路径消失，判的不是复制）；
2. **拖目录入目录**：目录带着内容（`keep.md`）一起走；
3. **撞名拒绝三态**：人话提示（`fs_already_exists` 的 message 在场）+ 源逐字节不变 + 既有同名目标
   逐字节不变；
4. **拖入自身子树**与**拖到文件行上**两档拒绝：磁盘原样不动 + 没有移动发生的错误提示；
5. **⑥ 拖到树头部落根**（验收 vault）：盒内文件拖到 vault 名行 → 落在 vault 根（新路径出现 + 旧
   路径消失 + 内容与 mtime 都不变）；
6. **⑦ 根落点撞名拒绝**（验收 vault）：根下已有同名条目时，拖到树头部被拒（人话提示 + 两侧都不动）；
7. **⑧ 拖到列表尾部空白落根**（第二个 vault）：短列表里嵌套文件拖到列表下方那片空白 → 落在 vault 根。

## 断言口径

- **「sha256 + mtime 双对账」拆成两条独立断言（写法保留，理由已更新）**：③⑤⑦ 的「没动」写成
  四行而不是两行——每条记录一条判据，失败时 steps.md 里能直接读出是哪一半红了（内容变了 /
  mtime 推进了）。一条 `file` 断言里写多个判据键**逐键判、逐键落一条记录**（M543 起；旧口径
  的完整描述与来历见 README「file 断言」条的历史说明），判得全不全与拆不拆无关——拆开是
  「一条判据一条记录」的可读性选择，不是引擎的要求。
- **落盘判据成对写**：① 的「新路径存在」单看会被**残留**骗过（`resetVault` 只重置 vault **根下**的
  `.md`，子目录里的产物跨 run 留着），因此与「旧路径已不存在」成对断言——后者骗不过去（源文件是
  本 run 刚写的）。③⑤⑦ 的「没动」用 `unchangedSince`（sha256）**加** `mtimeUnchangedSince`
  两条（README「file 断言」条：只比 sha256 的话「写了同一份内容」会漏）。⑥⑧ 的「真的移动了」
  同样成对：新路径在 + 旧路径不在（+ ⑥ 的 sha256 / mtime 双对账，证明是 rename 而不是复制重写）。
- **树收敛**：菜单/列表类结果都走 `waitFor` 等 watcher 回响（唯一收敛通道，不自绘补丁）。① ② 的
  **新行**是目标目录的子行，只在 ④ 展开它之后才是树里的行——展开那一步因此同时充当 ①② 的收敛
  正观测；中间两步只判**旧行消失**（旧行在盒内层，不依赖展开态）。⑥⑧ 的新行是**根级行**（读屏名
  就是文件名本身），一落盘就在树里，因此这两档各配一次 `waitFor`（旧行消失 + 新行出现一起等）。
- **拖点靠相邻性算**：`drag` 只接受 dx/dy 位移，落点 = 起点行中心 ± 行高。①–⑤ 的所有拖点都与落点
  行相邻（见 front-matter 里的盒内行序），dy 恒为 ±25。⑥⑦⑧ 是**根落点**，落点不在任何一行上，
  dy 由真机读数算出（front-matter 里给了换算与两个源的推导）：⑥ dy = −258、⑦ dy = −233（树头部
  那一带 dump y ∈ [42, 81)，屏幕中点 ≈ 104）、⑧ dy = +191（第二个 vault 的最后一行之下）。
  **改夹具名 / 加行 / 改行高时必须重算这三档**（行高 24、首行 top 81 是实测值）。
- **断言锚定的是 AX dump 的真实行形态**：树行在 dump 里是 `- [14] AXButton (dragbox/drag-src) @16,84 …`
  ——**整行锚定写不出来**（`/^dragdir-src$/` 恒不匹配，README「第三处边界」M266 实测；本场景
  2026-10-16 的真机读数里那四条就是这样假红的）。锚定写成 `/AXButton \(完整相对路径\)/`：带括号的
  项名独占一行，且父行 `\(dragbox\/drag-src\)` 与子行 `\(dragbox\/drag-target\/drag-src\)` 因括号
  定位而互不误命中；⑥⑧ 的**根级行**靠同一条括号定位与「盒内旧行」分开（`\(drag-root-move\.md\)`
  不匹配 `\(dragbox\/drag-root-move\.md\)`）。
- **拒绝三档的判据结构**：拖入自身子树 / 拖到文件行 / 根落点撞名这三档「什么都没发生」，磁盘原样
  本身**不是**有区分度的判据（通道假绿也是原样）。区分度由同 run 内的合法拖拽**真的移动了文件**
  提供（①②⑥⑧ 四档，覆盖目录行与根落点两条落点形态）：它们红的话，「原样」几档不作数；三档拒绝
  还各配一条「没有走到后端的错误提示」（前两档）或「人话提示在场」（撞名档）的正/负断言。
- **⑧ 要换 vault**：验收 vault 根下 64 个 fixture 行 + 盒子共 65+ 行（≈1600px，超出窗口高），嵌套
  源行与「最后一行之下的空白」永远无法同屏——⑧ 因此切到只有三行封顶的第二个 vault（`seed.registry`
  预置两个 vault，切换链路口径与场景 49/60 相同）。

## 已知边界（如实登记）

- **HTML5 DnD 的合成驱动（M537 闭环，2026-10-16）**：首跑「落点算对也不落盘」的成因已定为
  **产品侧**——Tauri 默认开启的 OS 级文件拖放处理器吞掉页内 dragover/drop（症状：拖影照常 +
  光标旁绿色加号 + 落点行无状态 + 松手不落盘；修复 = tauri.conf.json 窗口级
  `dragDropEnabled: false`，详见 README「已知边界」的 HTML5 DnD 条与
  openspec/specs/file-tree 的「拖拽移动条目」requirement）。**不是套件通道边界**：本场景
  `drag`（swift + CGEvent mode 5）在修复后的复跑里五条拖拽全部真实落盘、树收敛、撞名三态
  全过（现场 `.local/acceptance/2026-10-16/159-filetree-drag-move/`）。复跑仍红时的判读
  顺序：先确认 `drag 自报` 一行里 frontmost=lumir、target 落在窗口内且落在**目标行**（steps.md
  的 note），再查 `dragDropEnabled` 是否被重开，最后按 README「重试与丢键」单步复跑排除通道 flake。
- **夹具装在自建盒子里（跨 run 残留）**：`resetVault` 只重置 vault 根下的 `.md`，本场景的夹具在
  `dragbox/` 子目录里、跨 run 会留着。这就是「落盘判据成对写」的由来（见上）；`unchangedSince`
  那几条不受残留影响（基线在本 run 内先记）。
- **⑧ 的第二个 vault 侧残留按「根下 .md 由 `resetSecondVault` 清掉」处理**：⑧ 的源
  `shortbox/keep.md` 由 `vaultSparse` 每次重建（mkdirp + 截断，幂等），移动结果落在**第二个 vault
  根下**的 `keep.md`——按 `resetSecondVault` 的口径（清根下全部 `.md` 后从 `fixtures/second-vault/`
  重铺），它跨 run 不会留下来。**文件名不能换成非 `.md`**：那样残留的清理由就没有了，下一轮 ⑧ 会
  撞名（`fs_already_exists`）而假红。
- **⑧ 的源只能是最小内容文件**：套件里**唯一**能写第二个 vault 的动作是 `vaultSparse`（`vault:
  second`），它只造「大小 = size 字节、全零」的文件，写不了正文——所以 ⑧ 只判「新路径在 + 旧路径不
  在 + 树行迁移」，不判内容逐字节不变。**内容保真那一层由同一条后端命令的 ⑥（验收 vault，真文本
  夹具 + sha256/mtime 双对账）承担**：⑧ 判的是落点形态（列表尾部空白），不是移动的内容语义。
- **行序（localeCompare，目录在前）**：`drag-src < drag-target`（目录段）、`drag-a-file.md <
  drag-b-clash.md < drag-c-notdrop.md < drag-d-notdrop.md < drag-root-clash.md < drag-root-move.md`
  （文件段）；盒内行序见 front-matter 注释。⑥⑦ 的源刻意放在既有文件段**之后**（r > d），因此 ⑥ 把
  `drag-root-move.md` 移走不会移动 ⑦ 的源行——两档谁先谁后都成立。
- **撞名三态的判据分层**：人话提示是 AX toast（停留时长有限，所以在 drag 步骤内立即断言）+
  源/目标各一条 sha256+mtime 双对账（磁盘终态判据，不受 toast 生命周期影响）。⑦ 是同一形态的
  **根落点**版（目标在 vault 根下而不是某个目录里）。
- **目录的 `exists: false` 不用**（M324 口径：目录旁路下恒绿，无区分度）——「旧目录消失」一律用
  目录里的**文件**路径（`drag-src/keep.md`）作判据。
- **不判手感，也不判「高亮落在 vault 名行上」的观感**：拖拽时的落点高亮（`DROP_TARGET_CLASS` 的
  底色）、拖影、行内 caret 提示都归 Alex 手感与视觉层；「高亮落在 vault 名行上」这条**接线**在
  tests/unit/tree-root-drop.test.ts 里判（本场景只判磁盘终态与树行形态——AX 层读不到底色）。
