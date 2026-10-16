---
id: "159-filetree-drag-move"
item: 159
title: 文件树拖拽移动——拖文件入目录、拖目录入目录、撞名拒绝三态（人话提示 / 源不变 / 目标不变）、拖入自身子树与文件行均不可落
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
      - label: 三态之二：源内容逐字节不变（sha256 对账，**单独一条**——file 断言只判第一个命中的键，见「断言口径」）
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

teardown:
  - label: 终局磁盘状态：两次成功移动的结果在、三档拒绝都没动任何东西
    file: { path: dragbox/drag-target/drag-a-file.md, exists: true }
  - label: 被拖目录带着内容落在目标里
    file: { path: dragbox/drag-target/drag-src/keep.md, exists: true }
  - label: 撞名后源与目标各归原位
    file: { path: dragbox/drag-b-clash.md, unchangedSince: 撞名源基线 }
  - label: 目标内容逐字节不变
    file: { path: dragbox/drag-target/drag-b-clash.md, unchangedSince: 撞名目标基线 }
---

# 159-filetree-drag-move —— 文件树拖拽移动（M530）

## 本场景在验什么

文件树行支持 HTML5 DnD：文件 / 目录行可拖，落在**目录行**上 = 移入该目录（不支持排序、不支持落到
文件行——`src/tree.ts` 的 dropLandingAt / canMoveEntry）。本场景走四条可达路径 + 两档拒绝：

1. **拖文件入目录**：源与目标都在磁盘上原位对账（新路径出现 + 旧路径消失，判的不是复制）；
2. **拖目录入目录**：目录带着内容（`keep.md`）一起走；
3. **撞名拒绝三态**：人话提示（`fs_already_exists` 的 message 在场）+ 源逐字节不变 + 既有同名目标
   逐字节不变；
4. **拖入自身子树**与**拖到文件行上**两档拒绝：磁盘原样不动 + 没有移动发生的错误提示。

## 断言口径

- **一条 `file` 断言只判一个键（多写即静默少判）**：`lib/execute.mjs` 的 file 断言按固定优先级
  （`exists` → `changedSince` → `unchangedSince` → `mtimeUnchangedSince` → `mtimeNewerThan` →
  `has` → `not`）**return 第一个命中的键**——同一个对象里多写的键被静默忽略。所以「sha256 + mtime
  双对账」一律拆成两条独立断言（③⑤ 的四个 file 判据即此，「没动」这一档因此是四行而不是两行）。
- **落盘判据成对写**：① 的「新路径存在」单看会被**残留**骗过（`resetVault` 只重置 vault **根下**的
  `.md`，子目录里的产物跨 run 留着），因此与「旧路径已不存在」成对断言——后者骗不过去（源文件是
  本 run 刚写的）。③⑤ 的「没动」用 `unchangedSince`（sha256）**加** `mtimeUnchangedSince`
  两条（README「file 断言」条：只比 sha256 的话「写了同一份内容」会漏）。
- **树收敛**：菜单/列表类结果都走 `waitFor` 等 watcher 回响（唯一收敛通道，不自绘补丁）。① ② 的
  **新行**是目标目录的子行，只在 ④ 展开它之后才是树里的行——展开那一步因此同时充当 ①② 的收敛
  正观测；中间两步只判**旧行消失**（旧行在盒内层，不依赖展开态）。
- **拖点靠相邻性算**：`drag` 只接受 dx/dy 位移，落点 = 起点行中心 ± 行高。所有拖点都与落点行相邻
  （见 front-matter 里的盒内行序），dy 恒为 ±25。**改夹具名 / 加行 / 改行高时必须重算**（行高 25
  是 spec「行形态」钉死的值；通道实测有 ±1–2pt 抖动，远小于半行）。
- **断言锚定的是 AX dump 的真实行形态**：树行在 dump 里是 `- [14] AXButton (dragbox/drag-src) @16,84 …`
  ——**整行锚定写不出来**（`/^dragdir-src$/` 恒不匹配，README「第三处边界」M266 实测；本场景
  2026-10-16 的真机读数里那四条就是这样假红的）。锚定写成 `/AXButton \(完整相对路径\)/`：带括号的
  项名独占一行，且父行 `\(dragbox\/drag-src\)` 与子行 `\(dragbox\/drag-target\/drag-src\)` 因括号
  定位而互不误命中。
- **拒绝两档的判据结构**：拖入自身子树 / 拖到文件行这两档「什么都没发生」，磁盘原样本身**不是**
  有区分度的判据（通道假绿也是原样）。区分度由同 run 内 ①②（同一条通道、同一批行上的合法拖拽
  **真的移动了文件**）提供：①② 红的话，④⑤ 的「原样」不作数；④⑤ 还各配一条「没有走到后端的
  错误提示」的负断言。

## 已知边界（如实登记）

- **HTML5 DnD 的合成驱动（M537 闭环，2026-10-16）**：首跑「落点算对也不落盘」的成因已定为
  **产品侧**——Tauri 默认开启的 OS 级文件拖放处理器吞掉页内 dragover/drop（症状：拖影照常 +
  光标旁绿色加号 + 落点行无状态 + 松手不落盘；修复 = tauri.conf.json 窗口级
  `dragDropEnabled: false`，详见 README「已知边界」的 HTML5 DnD 条与
  openspec/specs/file-tree 的「拖拽移动条目」requirement）。**不是套件通道边界**：本场景
  `drag`（swift + CGEvent mode 5）在修复后的复跑里五条拖拽全部真实落盘、树收敛、撞名三态
  全过（现场 `test-results/acceptance/2026-10-16/159-filetree-drag-move/`）。复跑仍红时的判读
  顺序：先确认 `drag 自报` 一行里 frontmost=lumir、target 落在窗口内且落在**目标行**（steps.md
  的 note），再查 `dragDropEnabled` 是否被重开，最后按 README「重试与丢键」单步复跑排除通道 flake。
- **夹具装在自建盒子里（跨 run 残留）**：`resetVault` 只重置 vault 根下的 `.md`，本场景的夹具在
  `dragbox/` 子目录里、跨 run 会留着。这就是「落盘判据成对写」的由来（见上）；`unchangedSince`
  那几条不受残留影响（基线在本 run 内先记）。
- **行序（localeCompare，目录在前）**：`drag-src < drag-target`（目录段）、`drag-a-file.md <
  drag-b-clash.md < drag-c-notdrop.md < drag-d-notdrop.md`（文件段）；盒内行序见 front-matter 注释。
- **撞名三态的判据分层**：人话提示是 AX toast（停留时长有限，所以在 drag 步骤内立即断言）+
  源/目标各一条 sha256+mtime 双对账（磁盘终态判据，不受 toast 生命周期影响）。
- **目录的 `exists: false` 不用**（M324 口径：目录旁路下恒绿，无区分度）——「旧目录消失」一律用
  目录里的**文件**路径（`drag-src/keep.md`）作判据。
- **不判手感**：拖拽时的落点高亮（`DROP_TARGET_CLASS` 的底色）、拖影、行内 caret 提示都归 Alex
  手感与视觉层；本场景只判磁盘终态与树行形态。
