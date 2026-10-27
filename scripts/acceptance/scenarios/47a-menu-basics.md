---
# 原场景 47（`47-file-tree-context-menu`，M244）拆出的第 1 组（M747）。背景用户原话：
# 「长场景在 fail-fast 后会让一次失败跳过后续覆盖。拆分是为了独立诊断和有效覆盖，不是为了
# 减少场景数或规避既有失败。」因此：每组带**自己的 fixture 与启动锚点**（启动就绪那一步是
# 「这次 AX 读取是活的」的正向锚点），组间不共享运行期状态；原断言逐条保留、逐字不改判据。
# 其余三组：47b（改名与校验）/ 47c（新建与删除）/ 47d（dirty tab 联动）。
# `node scripts/acceptance/run.mjs 47` 按 **id 前缀**或 item 号选中四组。
#
# 本组验：右键出菜单与项集分流（文件行四项 / 目录行六项）、行空白区同样作用于该行、Esc 收起、
# 复制完整路径读出**绝对路径**（带 in-run 对照）、在 Finder 中显示（只读弱断言，放在组末）。
id: "47a-menu-basics"
item: 47
tier: full
title: 文件树右键菜单：文件行 / 目录行项集分流、行空白区命中、Esc 收起、复制完整路径（绝对路径）、在 Finder 中显示（只读弱断言）
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

  - name: 造出两个靠前的文件（右键走真实指针坐标，必须在可视区内；见正文「已知边界」）
    do: vaultWrite
    file: aaa-menu.md
    content: "# 菜单圆桌\n\n这一篇用来当文件行的右键对象。\n"
    expect:
      - label: 磁盘上有了 aaa-menu.md
        file: { path: aaa-menu.md, exists: true }
  - name: 再造一个给剪贴板 in-run 对照用（同样靠前）
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

  - name: 外部造出子目录（给目录行菜单用）
    do: vaultWrite
    file: menu-sub/x.md
    content: "子目录里的笔记。\n"
    expect:
      - label: 磁盘上有了 menu-sub/x.md
        file: { path: menu-sub/x.md, exists: true }

  - name: 目录行进树（等 watcher 收敛）
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

  # 「在 Finder 中显示」排在本组**最后一步**（M358 的排位理由在拆分后照旧成立，见正文
  # 「已知边界」第 1、2 条）：它是本组唯一的抢前台动作，而树内联重命名框失焦即取消。
  # 本组不做改名，排位仍保持「所有菜单 / 内联交互之后」这条结构约束——下一组 47b 接着验改名。
  #
  # 作用对象是 fixture `block-copy.md`（vault 内一个普通 .md 文件行、文件组首行，实测 y≈334
  # 窗口点，首屏可视区内）：本组右键走真实指针坐标，行必须在可视区内。项集与断言形态逐条不变：
  # 文件行菜单在场、命令无错误 toast、`unchangedSince` 逐字节不变、截图。
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
  - label: 收尾：note.md 是 fixture 原文（本组只读它，没动它）
    file: { path: note.md, has: "相对目标" }
  - label: 收尾：本组只右键不改盘——外部造出的目录与其中的文件都还在（目录删除用例在 47c）
    file: { path: menu-sub/x.md, exists: true }
  - label: 收尾：本组不删除 / 不改名，aaa-menu.md 原样在 vault 里（改名在 47b、删除在 47c / 47d）
    file: { path: aaa-menu.md, exists: true }
---

# 47a —— 文件树右键菜单：菜单基本行为（原场景 47 拆分第 1 组，M747）

## 本组在验什么

原场景 47（change file-tree-context-menu / M244）的第 1 组，覆盖 Alex 请求里「右键出菜单」
这一层：文件行四项 / 目录行六项的**项集分流**、**右键不改上下文**（不打开文件、不动标签）、
行内任意横向位置（含名字右侧空白区）都作用于该行、Esc 收起、**复制完整路径**（裁决点 4：必须是
绝对路径，带 in-run 对照）、**在 Finder 中显示**（弱断言：命令无错 + 磁盘逐字节不变）。

拆分口径（M747，背景用户原话「长场景在 fail-fast 后会让一次失败跳过后续覆盖。拆分是为了独立诊断和
有效覆盖，不是为了减少场景数或规避既有失败」）：断言逐条保留、判据一条不放宽；每组自带 fixture 与
启动锚点，独立诊断。同族其余三组：`47b-rename-validation`（改名与校验）/ `47c-create-and-delete`
（新建与删除）/ `47d-dirty-tab-linkage`（dirty tab 联动）。四组同属 item 47，`run.mjs 47` 按 id 前缀
（或 item 号）选中全部。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 菜单出现与项集 | **AX 文本**（菜单项的 label） | 菜单是 DOM 浮层，WKWebView 把它暴露进 AX；原生菜单则完全不可断言（这也是裁决点 1 选自绘的理由之一） |
| 右键这个动作 | **`click` 的 `button: right`**（坐标路径） | AX 索引路径发的是 AXPress（「按下这个元素」），产不出鼠标右键；`contextmenu` 靠真实指针事件。坐标取自节点 bbox 中心（套件能力，见正文末段） |
| 剪贴板内容 | **`clipboard` 断言形态**（固定 `osascript -e 'the clipboard'`） | 剪贴板既不在 AX 也不在磁盘；套件刻意不引入通用 shell 通道，只开这一个窄命令 |
| 在 Finder 中显示的实际效果 | 不进可断言面（见「已知边界」1） | 判的是「命令没报错 + vault 逐字节未变」 |

## 本组用到的套件能力（M244，tower 裁决扩 scope）

- **`click` 的 `button`**：`target` 里写 `button: right` 时走坐标路径（节点 bbox 中心注入真实
  鼠标事件），左键默认值行为不变。这是右键唯一的可达通道。
- **`clipboardRead` 动作与 `clipboard` 断言形态**：只有一条固定命令（`osascript -e 'the clipboard'`），
  不接受任意命令、不接受参数；读不到（命令失败）时**一律判 FAIL**，不许当成空（REVIEW.md
  「读不到当成空」条）。
- **`$vault` 占位符**：期望值里引用合成验收 vault 的绝对路径，避免硬编码 `/tmp` 那一份。

## 已知边界（如实登记，不读成「全量已验」）

- **1. 「在 Finder 中显示」只做弱断言**：Finder 窗口本身不进本套件的可断言面（它是另一个 app 的
  UI，且打开与否取决于系统状态）。这里断言的是「命令没报错 + vault 逐字节未变」；「Finder 里
  真的选中了那一项」由 Alex 手感验收（`fs_reveal_in_finder` 的实现是 opener 插件的
  `reveal_item_in_dir`，语义与 `link_open_path` 同一条最小权限路径）。
- **2. 抢前台的动作 MUST 排在所有菜单 / 内联编辑之后（M358 定策，机制已在代码里核过）**：本组
  只有「在 Finder 中显示」会真实调起系统 Finder，Finder 被激活 ⇒ Lumir 失活；而树内联重命名框
  的语义是**失焦即取消**（`src/tree.ts`，`input.blur → cancelEdit`，注释写明「与 Finder 一致」）。
  失活只要落进「点『重命名…』→ 断言行内有输入框」之间，改名就被无声取消（2026-10-07 的现场：
  `steps.md` 与 `shots/07`）。**这就是该步被放在本组最后一步的理由**：它下游只剩 teardown 的
  磁盘断言（不碰界面）。反面的口径：不要把它挪回任何菜单 / 内联编辑之前，也不要靠 `sleep` 猜
  「Finder 起完了没有」——排位是结构性的。
- **3. 树右键菜单不随失活关闭（M358 核实，与「blur 关菜单」的推测相反）**：菜单（`src/tree-menu.ts`）
  只有两条关闭路径——document 的 `mousedown`（点在菜单外）与 Esc / 动作本身，**没有** blur 路径。
  因此「失活 ⇒ 菜单消失 ⇒ 点击落空」这条推断不成立：失活后菜单仍在 AX 里（可读到），点击也确实
  送得到菜单项上；真正随失活失效的是内联输入框。
- **4. 跑批环境会在场景中段整页重载（M358 实测；成因已在套件侧修复，M359）**：验收实例的 dev
  server 是 `vite`，watch 根是整个仓库；同机其他 agent 的 worktree 改写 `.html` / `tsconfig.json`
  会向本实例前端推一次 full reload，把菜单 / 内联输入框 / 焦点这些**瞬时界面状态**整页换掉，
  失败形态与「一步开菜单、下一步点不到」的产品缺陷无法区分（2026-10-07 场景 47 的 17 条 FAIL
  即此）。防线已落：验收实例的 vite 按 `LUMIR_ACCEPTANCE_PORT` 忽略 `.tower/**` 等产物目录
  （README「运行环境是隔离的」表的 dev server watch 行）。**「场景中段探测到重载就判一条环境
  FAIL」的第二道防线未实现**（见 README 已知边界）——红了先看 `app.log` 有没有 `page reload`。
- **5. 不做手感判定**：菜单的间距/阴影观感、内联输入框的宽度手感归 Alex；本组只留截图。
- **6. 不新增像素基线**：`shot` 是给人看的证据；形态的逐像素回归在 chromium 侧
  （`tests/visual/scenes/tree-menu.spec.ts` 的五个元素级基线 + M251 新增的「行右侧空白带」用例）。
- **7. 右键命中面只在 chromium 层判到像素级**（M251）：真机坐标通道只能表达「节点 bbox 内的横向
  比例」（`dx`/`dy`），行元素右缘之外那条带（面板右内边距，实测约 9px）在节点 bbox 之外、无法
  按比例表达；用绝对值会把窗口宽度写死。因此本组判「名字右侧的空白区」（`dx` 落点），
  面板右缘那条带由 `tree-menu.spec.ts` 按**容器 bbox 实测**判（它能量到 `.filetree` 的右缘）。
- **8. 作用行高亮的色值不在真机判**（M251）：本套件无计算属性通道，真机只能给截图
  （`行空白区右键菜单` 那张里可以肉眼看到那一行被高亮）；「底色 = `--sel`、字重不动、关菜单即撤、
  eink 选中态前景（M291 起为明度带 + 黑字）」四条判据在 chromium 层
  （`tests/visual/scenes/tree-menu.spec.ts` 的两条 M251 用例，含同指针位置的前后对照）。
- **9. `any` 目标要写正则形态（M324 修正）**：`click` 的 `target.name` 走**裸正则源**
  （`findNode` 直接 `new RegExp(name)`），而 `target.any` 走 `matcher()`——只有 `/…/` 包起来的才
  解成正则，否则按**子串**比。本组 `any: "复制完整路径"` / `any: "在 Finder 中显示"` 是子串比，
  与菜单项读屏名逐字一致；`/^…$/` 锚定形态的用法见 47c / 47d 的确认框按钮。
- **10. 不覆盖**：跨目录移动（非目标）、多选批量操作（非目标）、vault 根本身的右键（非目标）；
  改名 / 校验、删除、新建、dirty tab 联动分别由 47b / 47c / 47d 覆盖。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组会真的改动合成 vault：外部写入 `aaa-menu.md` / `aab-tab.md` / `menu-sub/x.md`（`vaultWrite`），
  以及把剪贴板改写成文件绝对路径。用户真实 vault 全程只读。
- **本组结束时 Finder 是前台**（末步「在 Finder 中显示」会真实激活系统 Finder 并把它留在前台）：
  这是本组的预期副作用；下一个场景起实例时套件的 `waitAppReady` / `tryForeground` 会把 Lumir
  重新带回前台。
