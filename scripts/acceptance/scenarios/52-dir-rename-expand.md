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
    file: rensub/inner.md
    content: "# 子文件\n\n这一篇用来验目录改名之后子树是否还在。\n"
    expect:
      - label: 磁盘上有了 rensub/inner.md
        file: { path: rensub/inner.md, exists: true }
  - name: 再放一层更深的子文件（两级子孙都要能被带出来）
    do: vaultWrite
    file: rensub/deep/inner2.md
    content: "# 更深一层\n"
    expect:
      - label: 磁盘上有了 rensub/deep/inner2.md
        file: { path: rensub/deep/inner2.md, exists: true }
  - name: 等 watcher 收敛（外部写入后先留一拍再读 AX，README 口径）
    do: sleep
    ms: 1500
    expect:
      - label: 目录行已在树里
        ax: { has: "rensub" }

  - name: 展开一级目录
    do: click
    target: { role: AXButton, name: "^rensub$" }
    expect:
      - label: 一级子行出现（子行的读屏名是完整相对路径）
        ax: { has: "rensub/inner.md" }
  - name: 展开再深一层
    do: click
    target: { role: AXButton, name: "^rensub/deep$" }
    expect:
      - label: 二级子行出现
        ax: { has: "rensub/deep/inner2.md" }
      - shot: 展开两级后的树

  - name: 右键目录行 → 菜单出现
    do: click
    target: { role: AXButton, name: "^rensub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
      - label: 目录行菜单含目录专属项（确认作用行是这一行）
        ax: { has: "新建子目录…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 行内出现输入框（谁获焦由下一条钉住）
        ax: { has: '/AXTextField = "rensub" /' }
      - label: 输入框持焦点（下一步的逐字符注入就落在它身上）
        ax: { focused: "AXTextField" }
  - name: 全选原名（chord 盲发不重试）
    do: key
    key: "cmd+a"
  - name: 输入新名（逐字符，回读校验 + 只在字节未变时重试）
    do: keys
    keys: ["r", "e", "n", "d", "i", "r"]
    expect:
      - label: 输入框里是 rendir（注入真的落地了）
        ax: { has: '/AXTextField = "rendir" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 rendir/inner.md
        file: { path: rendir/inner.md, exists: true }
      - label: 磁盘上不再有旧目录
        file: { path: rensub/inner.md, exists: false }
  - name: 等 watcher 回响把新目录与子树收敛进树（改名 = deleted:old + created:new 两批事件，不能拿 Enter 后的立即读当判据）
    do: waitFor
    waitFor: { has: ["rendir/deep/inner2.md"] }
    expect:
      - label: 树里的目录行换成了新名
        ax: { has: "rendir" }
      - label: 【M258 核心】改名后目录仍展开：一级子行在场（修复前这里读不到——旧子树被级联清掉、新目录节点是空的）
        ax: { has: "rendir/inner.md" }
      - label: 【M258 核心】两级展开态都搬到了新路径
        ax: { has: "rendir/deep/inner2.md" }
      - shot: 目录改名之后的树

  - name: 改回原名（用户报告「改回旧名字依然无法展开」的那一半）
    do: click
    target: { role: AXButton, name: "^rendir$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "重命名…" }
  - name: 点「重命名…」
    do: click
    target: { any: "重命名…" }
    expect:
      - label: 输入框在场且预填的是当前名
        ax: { has: '/AXTextField = "rendir" /' }
      - label: 输入框持焦点
        ax: { focused: "AXTextField" }
  - name: 全选并输入原名
    do: key
    key: "cmd+a"
  - name: 输入 rensub
    do: keys
    keys: ["r", "e", "n", "s", "u", "b"]
    expect:
      - label: 输入框里是 rensub（注入落地；用的是原名，与当前名 rendir 不同）
        ax: { has: '/AXTextField = "rensub" /' }
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上 rename 回来了：rensub/inner.md 在场
        file: { path: rensub/inner.md, exists: true }
      - label: 磁盘上不再有 rendir
        file: { path: rendir/inner.md, exists: false }
  - name: 等第二次改名回响收敛（方向二同样不能拿 Enter 后的立即读当判据）
    do: waitFor
    waitFor: { has: ["rensub/deep/inner2.md"] }
    expect:
      - label: 树里的目录行回到原名
        ax: { has: "rensub" }
      - label: 【M258 核心】改回原名后同样展开着：一级子行在场
        ax: { has: "rensub/inner.md" }
      - label: 【M258 核心】两级展开态又一次搬了回来
        ax: { has: "rensub/deep/inner2.md" }
      - shot: 改回原名之后的树

  - name: 折叠目录（子行让出）
    do: click
    target: { role: AXButton, name: "^rensub$" }
    expect:
      - label: 正向锚点：目录行本身仍在（下面的负向断言因此有区分度）
        ax: { has: "rensub" }
      - label: 折叠后子行不在 AX 里（`.ft-children[hidden]` 走 UA 的 display:none）
        ax: { not: "rensub/inner.md" }
      - shot: 折叠之后

  - name: 再展开（折叠-展开往返不被破坏）
    do: click
    target: { role: AXButton, name: "^rensub$" }
    expect:
      - label: 子行又出现（一级）
        ax: { has: "rensub/inner.md" }
      - label: 深一层也还在
        ax: { has: "rensub/deep/inner2.md" }
      - shot: 再展开之后

teardown:
  - label: 收尾：目录及其两层子文件都在（本场景只改名，不删除）
    file: { path: rensub/inner.md, exists: true }
  - label: 收尾：改回的中间名连同它的子树都没留在磁盘上（写的是**文件**路径，不是目录——见正文「已知边界」的 `file.exists` 条）
    file: { path: rendir/inner.md, exists: false }
  - label: 收尾：fixture 原文未被改动
    file: { path: note.md, has: "相对目标" }
---

# 目录改名后仍可展开（M258）

## 这个场景验什么

Alex 2026-09-27 的现场（fieldnotes vault，非只读）：把 `.local` 下的 `openspec-tutorial`
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
| 目录改名后子树在场 | **一级与二级子行的读屏名**（`rendir/inner.md` / `rendir/deep/inner2.md`） | 子行的 `aria-label` 就是完整相对路径，折叠或缺失时它们不在 AX 里 ⇒ 一条断言同时证明「子树在模型里」与「目录是展开的」 |
| 改名本身成功 | **磁盘事实**（`rendir/inner.md` 在、旧路径不在） | app 内改名的结果最终是磁盘事实；命令返回值读不到（套件无 IPC 读数通道） |
| 改回原名同理 | 同一组断言跑第二遍（方向二） | 用户报告里「改回旧名字依然无法展开」是独立的一半，不能只验一个方向 |
| 展开/折叠往返 | 折叠：负向 + 同一步的**正向锚点**（目录行仍在）；再展开：两条正向断言 | REVIEW.md 第 1/2 条：负向断言必须配正向观测，否则会退化成恒真 |
| 「右键目标行 = 菜单作用行」 | 菜单里出现**目录专属项**（新建子目录…） | 目录行菜单与文件行菜单的项集不同，这一条顺带证明右键落在目录行上 |
| 「内联重命名起来的那个输入框」 | **AXTextField 的在场 + 获焦 + 预填值 == 当前名**（`/AXTextField = "rensub" /` + `focused: AXTextField`） | 读屏名（`重命名 {名称}`）那条在真机通道上**不可达**，判据取同一份信息里读得到的部分——预填值就是 `{名称}`，获焦则钉住「下一步的按键落在它身上」；措辞那条由 chromium 层守，见下条 |

## 已知边界（如实登记，不读成「全量已验」）

- **真机 AX 读不到非空值输入框的读屏名（M324 实测，判据因此换了形态）**：WKWebView 暴露给 AX 文本
  通道的 `<input type="text">`，**值为空**时带上读屏名（`AXTextField (新建文件的名称)`），**值非空**
  时只剩 `= "值"`（同一输入框键入后变成 `AXTextField = "sh."`，现场
  `test-results/acceptance/2026-09-26/47-file-tree-context-menu/ax/23-_动作_输入_fresh.md.txt`）。
  行内重命名框是**预填**的（值 = 原名），所以 `ax: { has: "重命名 {名称}" }` 这条**永远读不到**——
  它不是产品缺陷，与场景 56（goto-line 的同款输入框）是同一条边界。读屏名措辞仍在
  `tests/visual/scenes/tree-menu.spec.ts:138` / `:512` 逐字断言（`.ft-edit` 的 `aria-label`）。
- **`file.exists` 对目录的语义（M324 起已修）**：这条断言形态此前**读不到目录**（`lib/execute.mjs` 的
  `fileInfo()` 用 `readFile` 算 sha256，目录抛 EISDIR 被吞成 null ⇒ `exists: true` 假红、
  `exists: false` 假绿）。M324 给 `fileInfo` 加了目录旁路（只回 mtime/size、不读 sha256），
  目录的 `exists` 因此是真判。本场景收尾仍写**文件**路径 `rendir/inner.md`：它比「目录不在」
  更强——同时证明子树内容没留在一个被改名的残留目录里。
- **键入的新名不带连字符（M324，通道约束）**：`press_key` 的键名 DSL 没有 `-` 的拼法
  （`keys: ["-"]` 报 `empty key DSL`），而含 `minus` 的整串会被套件的「整串可打印字符」门降级成
  **盲发无重试**（丢掉 README「已知边界」要求的「回读 + 只在字节未变时重试」）。因此本场景的
  两次改名都用无连字符的名字；改名机制与字符集无关，断言语义不变。
- **两个名字互不为子串（M324，回读判据约束）**：`keys` 的落地判据是「目标串在回读值里的出现次数
  = 注入前 + 1」。改名框是**全选替换**，注入后值恰等于目标串（出现 1 次），所以要求**目标串在
  原名里一次都不出现**——名字互为前缀/子串时这条会把自己判成「部分落地」而报错（M324 首跑实测：
  `rensubx` → `rensub` 时基线 `rensubx` 已含 `rensub` 一次，期望 2 实得 1，断言把**正确落地**判成
  FAIL）。两个方向都成立才用得上，故取 `rensub` ↔ `rendir`（首跑用的 `rensubx` 是 `rensub` 的前缀）。
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
- 本场景会在合成 vault 里真改名两次（`rensub` → `rendir` → `rensub`，收尾回到原名）；
  用户真实 vault（真实路径按信息卫生纪律不落库）全程只读。
