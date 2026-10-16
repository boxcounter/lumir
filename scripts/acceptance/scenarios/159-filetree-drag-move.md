---
id: "159-filetree-drag-move"
item: 159
title: 文件树拖拽移动——拖文件入目录、拖目录入目录、撞名拒绝三态（人话提示 / 源不变 / 目标不变）、拖入自身子树与文件行均不可落
fixtures: [note.md]
steps:
  - name: 启动就绪：树里 fixture 行在场（正向锚点——这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 note.md 行
        ax: { has: "note.md" }
      - shot: 启动后的树

  - name: 铺拖拽夹具（合成名；两个目标目录内容各带特征串，后面撞名判据用）
    do: vaultWrite
    file: dragdir-src/keep.md
    content: "# 被拖目录的占位\n\nSRC-KEEP-CONTENT-159。\n"
    expect:
      - label: 磁盘上有了 dragdir-src/keep.md
        file: { path: dragdir-src/keep.md, exists: true }
  - name: 目标目录里预置同名文件（撞名档的既有目标）
    do: vaultWrite
    file: dragdir-target/drag-b.md
    content: "# 既有同名目标\n\nTARGET-ORIGINAL-159——撞名时这条内容必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 dragdir-target/drag-b.md
        file: { path: dragdir-target/drag-b.md, exists: true }
  - name: 两个待拖文件
    do: vaultWrite
    file: drag-a.md
    content: "# 待拖文件 A\n\nDRAG-A-CONTENT-159。\n"
    expect:
      - label: 磁盘上有了 drag-a.md
        file: { path: drag-a.md, exists: true }
  - name: 待拖文件 B（撞名档的源）
    do: vaultWrite
    file: drag-b.md
    content: "# 待拖文件 B\n\nDRAG-B-SOURCE-159——撞名拒绝后这条内容必须逐字节不变。\n"
    expect:
      - label: 磁盘上有了 drag-b.md
        file: { path: drag-b.md, exists: true }
  - name: 等 watcher 把目录与文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 源目录行在场
        ax: { has: "/^dragdir-src$/" }
      - label: 目标目录行在场
        ax: { has: "/^dragdir-target$/" }
      - label: 待拖文件 A 行在场
        ax: { has: "/^drag-a\\.md$/" }
      - label: 待拖文件 B 行在场
        ax: { has: "/^drag-b\\.md$/" }

  - name: 撞名档基线①：源的 sha256 + mtime（拒绝后它必须一字不动）
    do: record
    as: 撞名源基线
    file: drag-b.md
    expect:
      - label: 基线可读（读不到一律 FAIL）
        file: { path: drag-b.md, exists: true }
  - name: 撞名档基线②：既有目标的 sha256 + mtime
    do: record
    as: 撞名目标基线
    file: dragdir-target/drag-b.md
    expect:
      - label: 基线可读
        file: { path: dragdir-target/drag-b.md, exists: true }
  - name: 禁放档基线：note.md（后面拖它到文件行上，拒绝后一字不动）
    do: record
    as: 禁放源基线
    file: note.md
    expect:
      - label: 基线可读
        file: { path: note.md, exists: true }

  - name: 展开目标目录（拖入后要靠它的子行做收敛判据）
    do: click
    target: { role: AXButton, name: "^dragdir-target$" }
    expect:
      - label: 目标目录的子行出现（读屏名是完整相对路径）
        ax: { has: "/^dragdir-target/drag-b\\.md$/" }

  - name: ① 拖文件入目录：drag-a.md（根第 3 行）拖到 dragdir-target（根第 2 行），dy = −25
    do: drag
    target: { role: AXButton, name: "^drag-a\\.md$" }
    dy: -25
    settleMs: 1500
    expect:
      - label: 磁盘上 dragdir-target/drag-a.md 出现（移动在后端落盘）
        file: { path: dragdir-target/drag-a.md, exists: true }
      - label: 磁盘上 drag-a.md 已不存在（不是复制）
        file: { path: drag-a.md, exists: false }
      - shot: 拖文件入目录后

  - name: ① 的树收敛：watcher 回响后新路径行在场、旧行消失（唯一收敛通道，不自绘补丁）
    do: waitFor
    waitFor: { has: ["/^dragdir-target/drag-a\\.md$/"] }
    expect:
      - label: 树里出现 dragdir-target/drag-a.md 行
        ax: { has: "/^dragdir-target/drag-a\\.md$/" }
      - label: 根下旧行 drag-a.md 消失
        ax: { not: "/^drag-a\\.md$/" }

  - name: ② 拖目录入目录：dragdir-src（根第 1 行）拖到 dragdir-target（根第 2 行），dy = +25
    do: drag
    target: { role: AXButton, name: "^dragdir-src$" }
    dy: 25
    settleMs: 1500
    expect:
      - label: 磁盘上 dragdir-target/dragdir-src/keep.md 出现
        file: { path: dragdir-target/dragdir-src/keep.md, exists: true }
      - label: 磁盘上旧位置 dragdir-src/keep.md 不存在
        file: { path: dragdir-src/keep.md, exists: false }
      - shot: 拖目录入目录后

  - name: ② 的树收敛：被拖目录作为子行出现在目标下
    do: waitFor
    waitFor: { has: ["/^dragdir-target/dragdir-src$/"] }
    expect:
      - label: 树里出现 dragdir-target/dragdir-src 行
        ax: { has: "/^dragdir-target/dragdir-src$/" }

  - name: ③ 撞名拒绝：drag-b.md（根第 2 行）拖到 dragdir-target（根第 1 行，其中已有同名 drag-b.md），dy = −25
    do: drag
    target: { role: AXButton, name: "^drag-b\\.md$" }
    dy: -25
    settleMs: 1500
    expect:
      - label: 三态之一：人话提示在场（fs_already_exists 的 message）
        ax: { has: "已存在同名条目" }
      - label: 三态之二：源逐字节不变（sha256 + mtime 双对账）
        file: { path: drag-b.md, unchangedSince: 撞名源基线 }
      - label: 三态之三：既有同名目标逐字节不变
        file: { path: dragdir-target/drag-b.md, unchangedSince: 撞名目标基线 }
      - label: 源文件仍在原处
        file: { path: drag-b.md, exists: true }
      - shot: 撞名拒绝后

  - name: ③ 的树不动：根下 drag-b.md 行还在，没有多出一个 dragdir-target/drag-b.md 之外的行
    do: settle
    expect:
      - label: 根下 drag-b.md 行仍在（移动没有发生）
        ax: { has: "/^drag-b\\.md$/" }
      - label: 既有目标行当然仍在（内容对账在上一条）
        ax: { has: "/^dragdir-target/drag-b\\.md$/" }

  - name: ④ 展开被拖进来的子目录（下一步拖入自身子树的可落行才存在）
    do: click
    target: { role: AXButton, name: "^dragdir-target/dragdir-src$" }
    expect:
      - label: 子目录的 keep.md 行出现
        ax: { has: "/^dragdir-target/dragdir-src/keep\\.md$/" }

  - name: ④ 拖目录入自身子树拒绝：dragdir-target 拖到它的孩子 dragdir-target/dragdir-src，dy = +25
    do: drag
    target: { role: AXButton, name: "^dragdir-target$" }
    dy: 25
    settleMs: 1500
    expect:
      - label: 子树内容原样（dragdir-target 没有被搬进自己里面）
        file: { path: dragdir-target/dragdir-src/keep.md, exists: true }
      - label: 没有移动发生的错误提示（客户端在 dragover 就拒了，不该走到后端报错）
        ax: { not: "不能移动到自身或其子目录" }
      - label: 树形原样：dragdir-target 的孩子行都在
        ax: { has: "/^dragdir-target/drag-a\\.md$/" }
      - shot: 拖入自身子树拒绝后

  - name: ⑤ 文件行不是落点：note.md（根第 3 行）拖到 drag-b.md 文件行（根第 2 行），dy = −25
    do: drag
    target: { role: AXButton, name: "^note\\.md$" }
    dy: -25
    settleMs: 1500
    expect:
      - label: note.md 逐字节不变（没有移动发生）
        file: { path: note.md, unchangedSince: 禁放源基线 }
      - label: note.md 仍在磁盘原处
        file: { path: note.md, exists: true }
      - label: 没有移动发生的错误提示
        ax: { not: "已存在同名条目" }
      - label: 树形原样：note.md 行还在根下
        ax: { has: "/^note\\.md$/" }

teardown:
  - label: 终局磁盘状态：两次成功移动的结果在、三次拒绝都没动任何东西
    file: { path: dragdir-target/drag-a.md, exists: true }
  - label: 被拖目录带着内容落在目标里
    file: { path: dragdir-target/dragdir-src/keep.md, exists: true }
  - label: 撞名后源与目标各归原位
    file: { path: drag-b.md, unchangedSince: 撞名源基线 }
  - label: 目标内容逐字节不变
    file: { path: dragdir-target/drag-b.md, unchangedSince: 撞名目标基线 }
---

## 已知边界

- **HTML5 DnD 的合成驱动是本轮首次**：套件 `drag` 走 swift + CGEvent 真鼠标通道（down → 插值
  dragged → up），HTML5 拖拽在 WKWebView 里由真鼠标事件起拖——理论上同通道等价于人手，但
  是**首次在树行上驱动 draggable 元素**。若 ① 的第一步假红（磁盘无变化），先按
  README「重试与丢键」口径单步复跑排除通道 flake，再判产品缺陷。
- **dy 按行高 25px（spec「行形态」钉死的行高）逐行计算**：起点是源行行带中心（dx0/dy0 缺省
  0.5），落点行与源行相邻时 dy = ±25。通道实测有 ±1–2pt 抖动（场景 38 的带宽记录），远小于
  半行行高，落点稳定。改夹具名（排序会变）时 dy 必须按新的行序重算。
- **行序（localeCompare，目录在前）**：dragdir-src < dragdir-target（目录），drag-a.md <
  drag-b.md < note.md（文件）。步骤名里的「根第 N 行」按此序数；`note.md` 是 `fixtures:`
  铺的常驻文件，始终排在文件段最后。
- **撞名三态的判据分层**：人话提示（AX toast，停留时长有限，所以在 drag 步骤内立即断言）+
  源/目标各一条 sha256+mtime 双对账（磁盘终态判据，不受 toast 生命周期影响）。
- **拖入自身子树/文件行这两档「拒绝」没有磁盘终态可验**（什么都没发生 = 磁盘原样），判据是
  ① 正向步骤已经证明「同通道的合法拖拽确实会移动文件」之后，这两步的磁盘/AX 原样不动 +
  没有错误 toast。若 drag 通道在这两步**假绿**（注入根本没起拖），判据会表现为「原样」——
  靠 ①② 的 PASS 排除这个解读：同一 run 里同通道的移动步骤是红的的话这两步也不作数。
- **目录的 `exists: false` 不用**（M324 口径：目录旁路下恒绿，无区分度）——「旧目录消失」
  一律用目录里的**文件**路径（如 dragdir-src/keep.md）作判据。
