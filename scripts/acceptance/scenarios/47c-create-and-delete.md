---
# 原场景 47（`47-file-tree-context-menu`，M244）拆出的第 3 组（M747）：删除与新建。
# 拆分口径见 47a 的头注释：逐条保留原断言与必要注释、判据一条不放宽、每组自带 fixture 与
# 启动锚点。本组只验「移到废纸篓」与「目录下新建」；改名 / 校验在 47b，dirty 联动在 47d。
# `node scripts/acceptance/run.mjs 47` 按 **id 前缀**或 item 号选中四组。
#
# 删除目标直接以 `aaaren.md` 落盘：该名字是原场景里「aaa-menu.md 改名后」的名字，这里沿用它是
# 为了让确认框正文（`aaaren.md 会移到系统废纸篓。`）与删除后的磁盘断言**逐字不变**——改名链本身
# 由 47b 独立覆盖，本组不依赖它，组间不共享运行期状态。
id: "47c-create-and-delete"
item: 47
tier: full
title: 文件删除与新建：移到废纸篓（文件 / 目录两档确认文案）、目录下新建文件（自动打开）与子目录
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

  - name: 造出待删除的靠前文件（右键走真实指针坐标，必须在可视区内；见 47a 正文「已知边界」）
    do: vaultWrite
    file: aaaren.md
    content: "# 菜单场景\n\n这一篇用来验删除处置。\n"
    expect:
      - label: 磁盘上有了 aaaren.md
        file: { path: aaaren.md, exists: true }
  - name: 造出删除收敛的完整性见证行（紧邻目标行、同屏可见）
    do: vaultWrite
    file: aab-tab.md
    content: "# 菜单场景\n\n这一篇用来当删除收敛的见证行。\n"
    expect:
      - label: 磁盘上有了 aab-tab.md
        file: { path: aab-tab.md, exists: true }
  - name: 等 watcher 把两个新文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 树里有 aaaren.md（右键落点的前提）
        ax: { has: "aaaren.md" }
      - label: 树里有 aab-tab.md（下一步删除收敛的完整性见证）
        ax: { has: "aab-tab.md" }

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
  # 现场：steps.md 的 FAIL 点与 shots/11 的 AX dump）。因此改成「等可观测终态」，不靠
  #「这次跑得快不快」。
  - name: 等删除经 watcher 回响收敛（删盘的可观测终态）
    do: waitFor
    # 判据为什么是「树行消失」：树**只**由 watcher 的 deleted 回响收敛（装配层约定：成功后
    # 不自绘补丁，唯一收敛通道是回响），行消失即 FS 条目确实已不在。
    # `has` 是**完整性见证**：aab-tab.md 就在目标行的下一行、同屏可见，它在场才说明这次 AX 读取
    # 真的拿到了树行列表——否则「aaaren.md 不在」会被一次退化的快照白白满足（REVIEW.md 「读不到当成空」条）。
    waitFor: { has: ["aab-tab.md"], not: ["aaaren.md"] }
    expect:
      - label: vault 内已无该文件（移到废纸篓）
        file: { path: aaaren.md, exists: false }
      - shot: 删除之后

  - name: 外部造出子目录（给目录菜单与新建用）
    do: vaultWrite
    file: menu-sub/x.md
    content: "子目录里的笔记。\n"
    expect:
      - label: 磁盘上有了 menu-sub/x.md
        file: { path: menu-sub/x.md, exists: true }

  - name: 等 watcher 把外部新建的目录收敛进树
    do: sleep
    ms: 1200
    expect:
      - label: 目录行已在树里
        ax: { has: "menu-sub" }
    # 上一步的 sleep 是等 watcher 把外部新建的目录收敛进树（下一步才对得上右键落点）

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
  - name: 输入 fresh.md（M507 原子注入）
    do: typeInNode
    target: { role: AXTextField, name: "新建文件的名称|fresh.md" }
    text: "fresh.md"
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
  - name: 输入 freshdir（M507 原子注入）
    do: typeInNode
    target: { role: AXTextField, name: "新建子目录的名称|freshdir" }
    text: "freshdir"
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
    do: typeInNode
    target: { role: AXTextField, name: "新建文件的名称|probe.md" }
    text: "probe.md"
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 磁盘上出现 menu-sub/freshdir/probe.md（父目录是真的 ⇒ 新建子目录真的落了盘）
        file: { path: menu-sub/freshdir/probe.md, exists: true }
      - label: 新建的是空文件
        file: { path: menu-sub/freshdir/probe.md, has: "" }

teardown:
  - label: 收尾：aaaren.md 已移到废纸篓，不在 vault 里
    file: { path: aaaren.md, exists: false }
  - label: 收尾：新建的文件与目录都落在合成 vault 里（不碰用户真实 vault）
    file: { path: menu-sub/fresh.md, exists: true }
  - label: 收尾：note.md 是 fixture 原文（本组只读它，没动它）
    file: { path: note.md, has: "相对目标" }
---

# 47c —— 删除与新建（原场景 47 拆分第 3 组，M747）

## 本组在验什么

原场景 47（change file-tree-context-menu / M244）的删除与新建段：

1. **删除 = 移到废纸篓 + 确认框**：文件档正文点名条目（`aaaren.md 会移到系统废纸篓。`），
   确认后 vault 内条目消失——磁盘断言**等可观测终态**（树行消失）再读，不在同一个 tick 里赌。
2. **目录删除的确认文案**必须明示「连同其中全部内容」，取消后目录与其中文件都在（不真删）。
3. **目录下新建文件**：内联命名（读屏名 `新建文件的名称`）→ 磁盘出现空文件 → **自动打开**。
4. **目录下新建子目录**：磁盘出现目录、树里出现条目；目录的磁盘真值另有一条不依赖目录旁路的
   判据（在它里面再建一个文件，那个文件存在 ⇒ 父目录必然是真目录）。

拆分口径（M747）：断言逐条保留、判据一条不放宽；本组自带 fixture 与启动锚点，独立诊断。
同族其余三组：`47a-menu-basics`（菜单基本行为）/ `47b-rename-validation`（改名与校验）/
`47d-dirty-tab-linkage`（dirty tab 联动）。四组同属 item 47，`run.mjs 47` 按 id 前缀选中全部。

**为什么删除目标直接叫 `aaaren.md`**：它是原场景里 `aaa-menu.md` 改名后的名字。本组沿用它是为了
让确认框正文与删除后的磁盘断言**逐字不变**；改名链由 47b 独立覆盖，本组不依赖它（组间不共享
运行期状态，也不借拆分放宽任何判据）。

## 判据通道（本组相关的部分）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 删除确认框与两档文案 | **AX 文本**（对话框是 DOM 浮层） | 原生对话框不可断言；自绘浮层在 AX 里可见 |
| 确认按钮 | **`any: "/^移到废纸篓$/"`**（`matcher()` 口径） | `target.name` 是裸正则源、`target.any` 走 `matcher()`——只有 `/…/` 包起来的才解成正则（见「已知边界」2） |
| 删除 / 新建的结果 | **磁盘事实**（`file.exists` / `has`）+ **AX 树** | 命令返回值读不到；磁盘是名实相符的最终判据 |
| 删盘何时完成 | **`do: waitFor`** 等树行消失 / 目录行出现 | 删盘与新建都是异步链路（见「已知边界」1、3） |

## 已知边界（如实登记）

- **1. 删除后的磁盘断言必须等可观测终态（M355，两处删除都按这条写）**：删盘是异步链路
  （webview invoke → Rust command → `trash::delete` → FSEvents → watcher 回响），点确认只是把
  invoke 发出去；而进程内**第一次** trash 调用要走 macOS 废纸篓子系统的一次性初始化。同机 Swift
  探针实测（新建文件 → `NSFileManager.trashItem`，同一进程内连做四次）：首调 **16–44ms**、第二到
  四次 **0.3–0.5ms**。首次那条冷路径足够长，长到「点完立刻读磁盘」会抢在删除回包之前（2026-10-07
  的现场：`steps.md` 判 `exists=true` FAIL，600ms 后的 `shots/11-删除之后` 里树行已经消失；而
  tree 只由 watcher 回响收敛、没有自绘补丁，树行消失反证 FS 条目确实已不在）。因此删除改成
  `do: waitFor` 等可观测终态，磁盘断言排在它后面。**反向的口径**：不要把这条改回「点完立刻读」
  ——它能不能过取决于当次跑得快不快；也不要用 `sleep` 猜时长。
- **2. `any` 目标要写正则形态（M324 修正）**：`click` 的 `target.name` 走**裸正则源**
  （`findNode` 直接 `new RegExp(name)`），而 `target.any` 走 `matcher()`——只有 `/…/` 包起来的才
  解成正则，否则按**子串**比。写成 `any: "^移到废纸篓$"` 会永远匹配不到（拿带 `^$` 的字面量去
  `includes`）；确认框按钮的读屏名正是 `AXButton (移到废纸篓)`，本组写成 `any: "/^移到废纸篓$/"`
  锚定它，不与菜单项「移到废纸篓…」混淆。
- **3. `file.exists` 对目录的语义（M324 起已修）**：改动前 `lib/execute.mjs` 的 `fileInfo()` 用
  `readFile` 算 sha256，目录抛 EISDIR 被吞成 null ⇒ 目录一律被判「不存在」：`exists: true` 假红
  （「新建子目录落盘」原本就卡在这里）、`exists: false` 假绿。M324 给 `fileInfo` 加了目录旁路
  （目录只回 mtime/size、不读 sha256；`has/not` 与 sha256 类判据在目录上**一律判 FAIL**而不是抛
  异常/恒真）。本组另留一条**不依赖该旁路**的独立见证：在新目录里再建一个文件并断言那个文件在
  磁盘上（文件存在 ⇒ 它的父目录必然是真目录）。
- **4. 新建的节点由 watcher 回响带进来**：Enter 之后的立即读会抢在回响之前，所以「新目录的行」
  用 `do: waitFor { has: ["menu-sub/freshdir"] }`；「新建文件已自动打开」的判据是标签读屏名出现
  `fresh.md`（正向锚点），不是「界面变了」。
- **5. 真机 AX 读不到非空值输入框的读屏名（M324 实测）**：`<input type="text">` 值为空时带读屏名、
  非空时只剩 `= "值"`。因此新建文件的输入框用读屏名 `新建文件的名称` 开场、输入后改判
  `/AXTextField = "freshdir" /`（值面）；两条一起才说明「哪一行起来的」。
- **6. 不做手感判定**：删除确认框的间距/阴影观感、内联输入框的宽度手感归 Alex；本组只留截图。
  形态回归在 chromium 层（`tests/visual/scenes/tree-menu.spec.ts`）。
- **7. 不覆盖**：跨目录移动（非目标）、多选批量操作（非目标）、vault 根本身的右键（非目标）；
  文件名撞名 / 忽略集校验（47b）、改名后 dirty 标签的联动（47d）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组会真的改动合成 vault：删除（进系统废纸篓）、在 `menu-sub/` 下新建文件与子目录。这些都在
  合成 vault 里，用户真实 vault 全程只读。
- **废纸篓**：被删的条目真的进系统废纸篓（`trash::delete` 的平台语义，无法在测试里绕过）。
  本组因此不探测 `$HOME/.Trash` 的内容，只断言「vault 内消失」——套件不隔离 HOME。
