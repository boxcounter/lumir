---
# 原场景 47（`47-file-tree-context-menu`，M244）拆出的第 2 组（M747）：树内联重命名与校验。
# 拆分口径见 47a 的头注释：逐条保留原断言与必要注释、判据一条不放宽、每组自带 fixture 与
# 启动锚点。本组只验「改名 + 校验拒绝」；改名后的删除在 47c，dirty tab 的改名联动在 47d。
# `node scripts/acceptance/run.mjs 47` 按 **id 前缀**或 item 号选中四组。
id: "47b-rename-validation"
item: 47
tier: full
title: 树内联重命名与校验：预填 + 获焦、改名落盘与 watcher 收敛、撞名拒绝、忽略集名拒绝、Esc 退出编辑态
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

  - name: 造出待改名的靠前文件（右键走真实指针坐标，必须在可视区内；见 47a 正文「已知边界」）
    do: vaultWrite
    file: aaa-menu.md
    content: "# 菜单圆桌\n\n这一篇用来当文件行的右键对象。\n"
    expect:
      - label: 磁盘上有了 aaa-menu.md
        file: { path: aaa-menu.md, exists: true }
  - name: 等 watcher 把新文件收敛进树
    do: sleep
    ms: 1500
    expect:
      - label: 树里有 aaa-menu.md
        ax: { has: "aaa-menu.md" }

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
      - label: 行内出现输入框，预填的是原名（读屏名 `重命名 {名称}` 的措辞在真机 AX 通道上读不到，见正文「已知边界」；这里是同一份信息里可读的那一半）
        ax: { has: '/AXTextField = "aaa-menu.md" /' }
      - label: 输入框持焦点（下一步的注入落在它身上）
        ax: { focused: "AXTextField" }
      - shot: 内联重命名输入框
  - name: 全选原名（chord 盲发不重试）
    do: key
    key: "cmd+a"
  - name: 输入新名（M507：原生输入原子注入 type_text 单串 + 计数回读；逐字符 press_key 会丢 'e'）
    do: typeInNode
    target: { role: AXTextField, name: "aaa-menu.md|aaaren.md" }
    text: "aaaren.md"
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
  - name: 输入 note.md（与既有 fixture 撞名；M507 原子注入）
    do: typeInNode
    target: { role: AXTextField, name: "aaaren.md|note.md" }
    text: "note.md"
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

  - name: 忽略集名也拒绝（.git）——前端不再预检，判定只在 Enter 之后由后端给（change ignore-tiers-config）
    do: key
    key: "cmd+a"
  - name: 输入 .git
    do: keys
    keys: [".", "g", "i", "t"]
    expect:
      - label: 输入框里是 .git（注入真的落地了——下一步的后端拒绝有输入可拒）
        ax: { has: '/AXTextField = "\.git" /' }
      - label: 输入阶段 MUST NOT 出现忽略集原因（spec「条目内联重命名」：前端 MUST NOT 维护第二份忽略名单，原因只在 Enter 后由后端回显）
        ax: { not: "在忽略集内" }
  - name: Enter 提交非法名（后端权威判定：拒绝句回显在该编辑行、保持编辑态）
    do: key
    key: "return"
    expect:
      - label: 行内回显后端拒绝句（`fs_io` 的 `fs_name_invalid`：`{名称} 在忽略集内，建成后不会出现在文件树里`；长句在窄列里折行时 AX 会多出空白，故逐字 `\s*` 容错）
        ax: { has: '/\.git\s*在\s*忽\s*略\s*集\s*内\s*，\s*建\s*成\s*后\s*不\s*会\s*出\s*现\s*在\s*文\s*件\s*树\s*里/' }
      - label: 保持编辑态且提交的原名还在输入框里（后端拒绝后回填同一个名字，不是前端预检就地拦下）
        ax: { has: '/AXTextField = "\.git" /' }
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

teardown:
  - label: 收尾：aaa-menu.md 已改名为 aaaren.md，不在 vault 里
    file: { path: aaa-menu.md, exists: false }
  - label: 收尾：aaaren.md 仍在（本组只验改名与拒绝；删除在 47c，dirty 联动在 47d）
    file: { path: aaaren.md, exists: true }
  - label: 收尾：note.md 是 fixture 原文（撞名用例只读它，没动它）
    file: { path: note.md, has: "相对目标" }
---

# 47b —— 树内联重命名与校验（原场景 47 拆分第 2 组，M747）

## 本组在验什么

原场景 47（change file-tree-context-menu / M244）的改名与校验段：

1. **树内联重命名**：行名换成输入框（预填原名、持焦点）、提交后磁盘改名、watcher 回响收敛。
2. **撞名被拒**：改名到既有 `note.md` 时行内给出原因（前端预检、提交前就说清），**磁盘逐字节
   不变**（MUST NOT 覆盖），原文件仍可改名。
3. **忽略集名被拒（后端权威）**：`.git` 在忽略集内。前端**不再预检**它——change
   `ignore-tiers-config` 退役了第二份忽略名单（`hidden` / `lazy` 两档可由用户在 `config.json`
   改，前端再抄一份必然漂移），判定只由后端 `fs_io::IgnorePolicy::validate_new_name` 在**提交时**
   做；后端返回 `fs_name_invalid` 时其原因句回显在该编辑行、保持编辑态（spec「条目内联重命名」）。
   因此本组在**输入阶段**判「没有原因」，在 **Enter 后**判「后端拒绝句 + 输入框里保留提交的原名 +
   磁盘不变」。
4. **Esc 退出编辑态**：负向断言写成 `ax: { not: "AXTextField" }`——浮层输入框是全应用唯一的
   `AXTextField`，常态不该有它（旧写法断言读屏名不在，而那条名字在真机通道上从来没渲染过，
   等于恒真）。

拆分口径（M747）：断言逐条保留、判据一条不放宽；本组自带 fixture 与启动锚点，独立诊断。
同族其余三组：`47a-menu-basics`（菜单基本行为）/ `47c-create-and-delete`（新建与删除）/
`47d-dirty-tab-linkage`（dirty tab 联动）。四组同属 item 47，`run.mjs 47` 按 id 前缀选中全部。

## 判据通道（本组相关的部分）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 内联编辑的输入框起来了 | **`/AXTextField = "<原名>" /` + `focused: AXTextField`** | 读屏名那条在真机通道上不可达（见「已知边界」1）；预填值就是读屏名里 `{名称}` 那一段，获焦则钉住「下一步的按键落进它」——两条一起给的是同一个信息，且「哪一行起来的」由值钉死 |
| 改名 / 拒绝的结果 | **磁盘事实**（`file.exists` / `has`）+ **AX 树** | 命令返回值读不到（套件没有 IPC 读数通道）；磁盘是名实相符的最终判据 |
| 忽略集名的拒绝（后端权威） | **输入阶段 `not` + Enter 后的后端原因句 + 输入框里保留提交名 + 磁盘不变** | 前端判定已随 change `ignore-tiers-config` 退役（spec「条目内联重命名」），原因句只可能来自后端 `fs_name_invalid`；「原因句回显在编辑行且保持编辑态」是 spec 的 SHALL，磁盘不变是最终判据 |
| watcher 回响收敛 | **`do: waitFor`** + 树行断言 | 改名 = `deleted:old` + `created:new`；Enter 后的立即读会抢在回响之前（见正文「已知边界」2） |

## 已知边界（如实登记）

- **1. 真机 AX 读不到非空值输入框的读屏名（M324 实测，判据因此换了形态）**：WKWebView 暴露给
  AX 文本通道的 `<input type="text">`，**值为空**时带上读屏名，**值非空**时只剩 `= "值"`。
  行内重命名框是**预填**的（值 = 原名），所以 `ax: { has: "重命名 {名称}" }` 永远读不到——这不是
  产品缺陷，与场景 56（goto-line 的同款预填输入框）是同一条边界。读屏名措辞仍在
  `tests/visual/scenes/tree-menu.spec.ts` 逐字断言（`.ft-edit` 的 `aria-label`），本组改判
  **预填值 + 获焦**（同一份信息里可读的那一半）。
- **2. 改名后的树行必须等 watcher 回响**：改名在磁盘上是 `deleted:old` + `created:new` 两个事件，
  Enter 之后立刻读树会读到旧状态。判据写成 `do: waitFor { has: ["aaaren.md"] }`，不拿「这次跑得
  快不快」赌。同一段的负向断言（无「已被外部删除」/「检测到外部修改」误报）旁边都有正向锚点
  （树里出现新名），不是空转的负向。
- **3. 注入通道的两条老账**：① `cmd+a` 是 chord，套件**盲发不重试**（丢键就红，按 README 先复跑
  一次再判产品缺陷）；② 内联输入框的**素材串注入走 `do: typeInNode`**（M507：`type_text` 整串
  一次 + M143 计数回读重试）——旧写法逐字符 `do: keys` 对 WKWebView 丢键（'e' 本机确定性丢失，
  M497 归因、M504 实测原场景「aaaren.md」落「aaarn.」），回读重试修不了确定性丢失。**唯一未迁的
  是忽略集名 `.git`**（不含 'e'、M504 未观察到丢键），它仍走逐字符 `do: keys` 的回读通道；红了
  先复跑。
- **4. 键入的新名不带连字符（M324 的通道约束；M379 起约束解除）**：`press_key` 的键名 DSL 没有
  `-` 的拼法（`keys: ["-"]` 报 `empty key DSL`），而含 `minus` 的整串会被「整串可打印字符」门
  降级成**盲发无重试**。因此改名用无连字符的名字（`aaa-menu.md` → `aaaren.md`）；改名机制与
  字符集无关，断言语义不变。**M379 起这条约束解除**（`lib/cu.mjs` 的 `keyDsl()` 把 `-` 译成
  `minus` 且留在可回读通道），既有 fixture 名保持不动（改名无收益），后续新场景可直接用连字符。
  注意底层仍有另一个坑：行首注入的 `-` 会被 markdown 渲染成列表符号 `–`。
- **5. 不做手感判定**：内联输入框的宽度 / 位置手感归 Alex；本组只留截图。形态回归在 chromium 层
  （`tests/visual/scenes/tree-menu.spec.ts`）。
- **6. 断言的读法（本组每条负向断言都有配对的正向锚点）**：「无外部删除误报」配「树里出现
  aaaren.md」；「输入框不在场」配「树里仍显示 aaaren.md」。单独写负向断言会退化成恒真
  （REVIEW.md「断言等价于子串」条 / 「读不到当成空」条）。
- **7. 不覆盖**：改名后的删除（47c）、dirty 标签的改名联动与删除处置（47d）、复制绝对路径 /
  在 Finder 中显示 / 新建（47a / 47c）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组会真的改动合成 vault：`aaa-menu.md` 改名为 `aaaren.md`；撞名与忽略集两次提交**不写盘**。
  用户真实 vault 全程只读。
- 本组不抢前台（无 Finder / 无真实鼠标手势之外的激活动作），结束后 Lumir 仍在前台。
