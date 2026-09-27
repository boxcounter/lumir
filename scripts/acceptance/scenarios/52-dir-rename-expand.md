---
id: "52-dir-rename-expand"
item: 52
title: 目录经树内右键重命名后仍可展开（子孙条目与展开态随目录搬到新路径，改回原名亦然）
fixtures: [note.md]
steps:
  - name: 启动就绪：树里 fixture 行在场（正向锚点——这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 note.md 行
        ax: { has: "note.md" }
      - shot: 启动后的树

  - name: 外部造出带内容的子目录（模拟 vault 里既有的目录）
    do: vaultWrite
    file: ren-sub/inner.md
    content: "# 子文件\n\n这一篇用来验目录改名之后子树是否还在。\n"
    expect:
      - label: 磁盘上有了 ren-sub/inner.md
        file: { path: ren-sub/inner.md, exists: true }
  - name: 再放一层更深的子文件（两级子孙都要能被带出来）
    do: vaultWrite
    file: ren-sub/deep/inner2.md
    content: "# 更深一层\n"
    expect:
      - label: 磁盘上有了 ren-sub/deep/inner2.md
        file: { path: ren-sub/deep/inner2.md, exists: true }
  - name: 等 watcher 收敛（外部写入后先留一拍再读 AX，README 口径）
    do: sleep
    ms: 1500
    expect:
      - label: 目录行已在树里
        ax: { has: "ren-sub" }

  - name: 展开一级目录
    do: click
    target: { role: AXButton, name: "^ren-sub$" }
    expect:
      - label: 一级子行出现（子行的读屏名是完整相对路径）
        ax: { has: "ren-sub/inner.md" }
  - name: 展开再深一层
    do: click
    target: { role: AXButton, name: "^ren-sub/deep$" }
    expect:
      - label: 二级子行出现
        ax: { has: "ren-sub/deep/inner2.md" }
      - shot: 展开两级后的树

  - name: 右键目录行 → 菜单出现
    do: click
    target: { role: AXButton, name: "^ren-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
      - label: 目录行菜单含目录专属项（确认作用行是这一行）
        ax: { has: "新建子目录…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 行内出现输入框（读屏名带原名）
        ax: { has: "重命名 ren-sub" }
  - name: 全选原名（chord 盲发不重试）
    do: key
    key: "cmd+a"
  - name: 输入新名（逐字符，回读校验 + 只在字节未变时重试）
    do: keys
    keys: ["r", "e", "n", "-", "s", "u", "b", "x"]
    expect:
      - label: 输入框里是 ren-subx（注入真的落地了）
        ax: { has: "ren-subx" }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 ren-subx/inner.md
        file: { path: ren-subx/inner.md, exists: true }
      - label: 磁盘上不再有旧目录
        file: { path: ren-sub/inner.md, exists: false }
      - label: 树里的目录行换成了新名
        ax: { has: "ren-subx" }
      - label: 【M258 核心】改名后目录仍展开：一级子行在场（修复前这里读不到——旧子树被级联清掉、新目录节点是空的）
        ax: { has: "ren-subx/inner.md" }
      - label: 【M258 核心】两级展开态都搬到了新路径
        ax: { has: "ren-subx/deep/inner2.md" }
      - shot: 目录改名之后的树

  - name: 改回原名（用户报告「改回旧名字依然无法展开」的那一半）
    do: click
    target: { role: AXButton, name: "^ren-subx$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场（读屏名带当前名）
        ax: { has: "重命名 ren-subx" }
  - name: 全选并输入原名
    do: key
    key: "cmd+a"
  - name: 输入 ren-sub
    do: keys
    keys: ["r", "e", "n", "-", "s", "u", "b"]
    expect:
      - label: 输入框里是 ren-sub（注入落地；用的是原名，与当前名 ren-subx 不同）
        ax: { has: "重命名 ren-sub" }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上 rename 回来了：ren-sub/inner.md 在场
        file: { path: ren-sub/inner.md, exists: true }
      - label: 磁盘上不再有 ren-subx
        file: { path: ren-subx/inner.md, exists: false }
      - label: 树里的目录行回到原名
        ax: { has: "ren-sub" }
      - label: 【M258 核心】改回原名后同样展开着：一级子行在场
        ax: { has: "ren-sub/inner.md" }
      - label: 【M258 核心】两级展开态又一次搬了回来
        ax: { has: "ren-sub/deep/inner2.md" }
      - shot: 改回原名之后的树

  - name: 折叠目录（子行让出）
    do: click
    target: { role: AXButton, name: "^ren-sub$" }
    expect:
      - label: 正向锚点：目录行本身仍在（下面的负向断言因此有区分度）
        ax: { has: "ren-sub" }
      - label: 折叠后子行不在 AX 里（`.ft-children[hidden]` 走 UA 的 display:none）
        ax: { not: "ren-sub/inner.md" }
      - shot: 折叠之后

  - name: 再展开（折叠-展开往返不被破坏）
    do: click
    target: { role: AXButton, name: "^ren-sub$" }
    expect:
      - label: 子行又出现（一级）
        ax: { has: "ren-sub/inner.md" }
      - label: 深一层也还在
        ax: { has: "ren-sub/deep/inner2.md" }
      - shot: 再展开之后

teardown:
  - label: 收尾：目录及其两层子文件都在（本场景只改名，不删除）
    file: { path: ren-sub/inner.md, exists: true }
  - label: 收尾：改回的中间名没有留在磁盘上
    file: { path: ren-subx, exists: false }
  - label: 收尾：fixture 原文未被改动
    file: { path: note.md, has: "相对目标" }
---

# 目录改名后仍可展开（M258）

## 这个场景验什么

Alex 2026-09-27 的现场（slax-reader vault，非只读）：把 `.local` 下的 `openspec-tutorial`
改名为 `openspec-tutorials`（加了一个 s），此后该目录在树里**再也展不开**；改回原名也展不开。
严重程度：功能死态。

修复（本 mission 的两层，缺一条都不成立）：

1. **后端**（`src-tauri/src/fs_io.rs` 的 `expand_new_dir_subtrees`）：FSEvents 对目录改名只报目录
   本身一个路径，子孙一个都不进事件流。真机探针实测批次逐字为
   `[Deleted tutorial, Created tutorials(dir)]`（测试 `watch_dir_rename_delivers_full_subtree`
   跑真事件流复现）。前端收到 `deleted:old` 必须按级联清掉旧子树、收到 `created:new` 只能建出
   一个**空**目录节点 ⇒ 永远展不开，直到重启全量重扫。修复：目录条目「从无到有」时把它的
   **子孙**一并补进同一批次（递归枚举，与全量枚举同忽略集口径）——不变量是**增量收敛后的模型
   = 同一时刻的全量枚举**，而这是唯一读得到磁盘现状（ground truth）的一层。
2. **前端**（`src/tree.ts` 的 `applyChanges`）：展开态是按路径存的集合，改名后旧前缀会被级联
   清理一起删掉。树自己发起的改名在提交时登记 `from → to`，回响批次命中时把 `expanded` 前缀
   搬到新路径 ⇒ 改名后的目录**保持展开**（否则会掉一档：能展开了但被折叠）。
   `src-tauri` 与 `src` 两侧的不变量在单测层各有属性/形状测试
   （`tests/unit/tree-rename.test.ts`、`fs_io.rs` 的两条），本场景验的是**真机端到端**。

## 判据为什么是这几条

| 要判的东西 | 判据 | 为什么是它 |
|---|---|---|
| 目录改名后子树在场 | **一级与二级子行的读屏名**（`ren-subx/inner.md` / `ren-subx/deep/inner2.md`） | 子行的 `aria-label` 就是完整相对路径，折叠或缺失时它们不在 AX 里 ⇒ 一条断言同时证明「子树在模型里」与「目录是展开的」 |
| 改名本身成功 | **磁盘事实**（`ren-subx/inner.md` 在、旧路径不在） | app 内改名的结果最终是磁盘事实；命令返回值读不到（套件无 IPC 读数通道） |
| 改回原名同理 | 同一组断言跑第二遍（方向二） | 用户报告里「改回旧名字依然无法展开」是独立的一半，不能只验一个方向 |
| 展开/折叠往返 | 折叠：负向 + 同一步的**正向锚点**（目录行仍在）；再展开：两条正向断言 | REVIEW.md 第 1/2 条：负向断言必须配正向观测，否则会退化成恒真 |
| 「右键目标行 = 菜单作用行」 | 菜单里出现**目录专属项**（新建子目录…） | 目录行菜单与文件行菜单的项集不同，这一条顺带证明右键落在目录行上 |

## 已知边界（如实登记，不读成「全量已验」）

- **折叠的负向断言依赖 `hidden` → `display:none`**：`src/style.css:788` 的 `.ft-children` 没有
  覆盖 `display`，因此 `ul.hidden = true` 走 UA 样式表（不渲染、也不进 AX）。若某次运行显示 AX
  仍暴露折叠子树，按套件口径先复跑确认，不直接判产品缺陷。
- **外部进程改名的展开态迁移不在本场景**：判据只认 app 内自己发起的改名（登记配不上就不迁移，
  `tests/unit/tree-rename.test.ts` 有反向对照条）。外部改名（Finder / 别的编辑器）在真机侧只保
  证「目录仍可展开、子树齐全」，本场景不构造那条现场。
- **注入通道的两条老账**：① `cmd+a` 是 chord，套件盲发不重试（丢键就红，先复跑一次再判产品
  缺陷）；② `keys` 的逐字符注入对 WKWebView 间歇丢键，本场景的判据是「回读 + 只在字节未变时
  重试」。两条见 `scripts/acceptance/README.md` 的「已知边界」。
- **不做手感判定**：内联输入框的宽度、菜单观感、改名后行的滚动位置归 Alex；本场景只留截图。
- **不覆盖**：跨目录移动（非目标）、改名的并发（同一目录连续两次改名）、折叠态的像素表现
  （视觉门禁）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本场景会在合成 vault 里真改名两次（`ren-sub` → `ren-subx` → `ren-sub`，收尾回到原名）；
  用户真实 vault（`/Users/boxcounter/Downloads/Everything-copy`）全程只读。
