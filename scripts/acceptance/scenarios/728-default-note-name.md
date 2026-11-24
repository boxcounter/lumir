---
# change add-default-note-name-nov24（真机验收场景 728）。
#
# 本场景走**真实配置 + 真实设置面板 + 真实 WKWebView 键盘事件**，补 visual 场景
# `tests/visual/scenes/default-note-name-nov24.spec.ts` 覆盖不到的一段：设置开关真的写进
# `config.json`、保存后立即生效，以及真实键盘下「全选后键入即替换」。
#
# 判据分层：
#   - 开 / 关的落盘与行内回显 → 文件系统事实 + AX；
#   - 「全选」→ 键入一个词后输入框**恰为**该词（不是「默认名 + 词」），AX 值面逐字判；
#   - Enter 接受后焦点 → `ax.focused: AXTextArea`（与 47c 同一口径）；
#   - Escape / 自定义撞名 → 磁盘事实 + 行内原因。
id: "728-default-note-name"
item: 728
tier: full
title: 新建文件默认名：设置开关持久化、预填与全选、键入替换、Enter 接受、Escape 取消、撞名递增、焦点落正文
open: note.md
marker: "相对目标"
fixtures: [note.md]
config:
  # 起点显式关闭：下面第一步的「空输入框」是关档的基线，不是「配置没读到」。
  editor:
    prefill_note_name: false
steps:
  - name: 启动就绪：树与文档都在场（这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 note.md
        ax: { has: "note.md" }
      - label: 起点文档已打开
        ax: { has: "AXTextArea" }

  - name: 造一个可右键的目录（新建文件的落点）
    do: vaultWrite
    file: default-name-sub/seed.md
    content: "落点目录里的既有笔记。\n"
    expect:
      - label: 目录与 seed 落盘
        file: { path: default-name-sub/seed.md, exists: true }
  - name: 等 watcher 把目录收敛进树
    do: sleep
    ms: 1200
    expect:
      - label: 目录行已在树里
        ax: { has: "default-name-sub" }

  # ── 关档基线 ────────────────────────────────────────────────────────────
  - name: 把新建落点目录滚进树的可视区
    do: scroll
    # 文件树初始滚动位置被启动时打开的 note.md 带到文件段中部；目录段排序在文件之前，
    # 因此 default-name-sub 落在视口上方（首跑 AX：y=-929）。do: scroll 的 dy 正数 = 向上滚
    # （M669 真机标定）；一次给足量，滚到顶后目录段与 vault 名行都可见。
    target: { x: 100, y: 400 }
    dy: 120
    wheel: true
    settleMs: 600
    expect:
      - shot: 00-树滚动到落点

  - name: 开关关闭时新建文件：输入框为空、只有占位
    do: click
    target: { role: AXButton, name: "^default-name-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建文件…" }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 输入框出现（空值时才读得到读屏名）
        ax: { has: "新建文件的名称" }
      - label: 关档不预填任何默认名
        ax: { not: "/AXTextField = \"(未命名笔记|Untitled note)\" /" }
  - name: 输入 offcase（关档仍按既有输入路径工作）
    do: typeInNode
    target: { role: AXTextField, name: "新建文件的名称|offcase" }
    text: "offcase"
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 关档创建的是用户输入的名字（默认名没有被预填进来）
        file: { path: default-name-sub/offcase.md, exists: true }

  # ── 打开设置开关并保存（持久化 + 立即生效）────────────────────────────────
  - name: ⌘, 打开设置面板
    do: keys
    keys: ["cmd+,"]
  - name: 等面板落到可观测终态
    do: waitFor
    waitFor:
      has: ["模型接入与自动化 · 配置文件"]
    timeoutMs: 20000
    expect:
      - label: 自动化节在位
        ax: { has: "AXHeading (自动化)" }
      - label: 第五个开关行在场（读屏名即行标题）
        ax: { has: "新建文件时预填默认名称" }
      - shot: 01-自动化节的默认名开关

  - name: 打开「新建文件时预填默认名称」
    do: click
    target: { role: AXCheckBox, name: "新建文件时预填默认名称" }
    expect:
      - label: 开关变为开（显式设置 => 「恢复默认」出现、默认徽标离场）
        ax: { has: "AXButton (恢复默认)" }
  - name: 保存
    do: click
    target: { name: "^保存$" }
    expect:
      - label: 保存成功
        ax: { has: /已保存/ }
      - label: 配置键真的写进隔离 config.json
        file: { path: "env:config.json", has: '"prefill_note_name": true' }

  - name: 关闭面板（干净态直接关）
    do: key
    key: "escape"
  - name: 等面板关闭并把焦点交还编辑器
    do: settle
    expect:
      - label: 面板关闭（副标题不再在场）
        ax: { not: "模型接入与自动化 · 配置文件" }
      - label: 焦点回到编辑器正文（关闭路径的既有口径）
        ax: { focused: "AXTextArea" }

  # ── 开档：预填 + 全选 + 键入替换 ────────────────────────────────────────
  - name: 开档新建文件：输入框预填 zh 默认名
    do: click
    target: { role: AXButton, name: "^default-name-sub$", button: right }
    expect:
      - label: 菜单在场
        ax: { has: "新建文件…" }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 输入框值为 未命名笔记（不含 .md）
        ax: { has: '/AXTextField = "未命名笔记" /' }
      - shot: 02-开档预填

  - name: 直接键入 probe：全选后应整段替换
    do: typeInNode
    # target.name 要同时命中注入前（值为默认名）与注入后（值为 probe）两个状态。
    target: { role: AXTextField, name: "未命名笔记|probe" }
    text: "probe"
    expect:
      # 这是「全选」的区分性判据：追加的话值会是 未命名笔记probe，两条都红。
      - label: 输入框恰为键入值（替换成立，不是追加）
        ax: { has: '/AXTextField = "probe" /' }
      - label: 默认名已被替换掉
        ax: { not: "未命名笔记probe" }

  - name: Enter 接受
    do: key
    key: "return"
    expect:
      - label: 磁盘出现 default-name-sub/probe.md
        file: { path: default-name-sub/probe.md, exists: true }
      # has 是子串：空串对任意内容恒真（REVIEW.md「断言等价于子串」条）。空文件判据必须用
      # exact 整篇逐字比较；非空内容的反向验证见 scripts/acceptance/lib/execute.test.mjs 的
      # 「空串只匹配真正的空文件」用例。
      - label: 新建的是空文件
        file: { path: default-name-sub/probe.md, exact: "" }
      - label: 焦点落在正文（创建链的既有口径）
        ax: { focused: "AXTextArea" }
  - name: 直接键入标记串（焦点已在正文）
    do: keys
    keys: ["d", "n", "7", "2", "8"]
    expect:
      - label: 标记串落在新文档正文
        editor: { has: "dn728" }

  # ── Escape 取消 ────────────────────────────────────────────────────────
  - name: 再次新建（预填仍在）
    do: click
    target: { role: AXButton, name: "^default-name-sub$", button: right }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 预填仍在
        ax: { has: '/AXTextField = "未命名笔记" /' }
  - name: Escape 取消
    do: key
    key: "escape"
    expect:
      - label: 取消不落盘（默认名没有被创建）
        file: { path: default-name-sub/未命名笔记.md, exists: false }

  # ── 撞名递增 ───────────────────────────────────────────────────────────
  - name: 外部造出占位的 未命名笔记.md
    do: vaultWrite
    file: default-name-sub/未命名笔记.md
    content: "占位笔记一。\n"
    expect:
      - label: 占位文件落盘
        file: { path: default-name-sub/未命名笔记.md, exists: true }
  - name: 等 watcher 收敛该行
    do: sleep
    ms: 1200
    expect:
      - label: 占位行在树里
        ax: { has: "未命名笔记.md" }

  - name: 开档新建：默认名撞名时自动编号
    do: click
    target: { role: AXButton, name: "^default-name-sub$", button: right }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
    expect:
      - label: 预填自动递增为 未命名笔记 2
        ax: { has: '/AXTextField = "未命名笔记 2" /' }
  - name: Enter 接受编号名
    do: key
    key: "return"
    expect:
      - label: 编号文件落盘
        file: { path: default-name-sub/未命名笔记 2.md, exists: true }
      - label: 既有占位文件逐字节不变
        file: { path: default-name-sub/未命名笔记.md, has: "占位笔记一。" }

  # ── 用户自定义输入撞名：不静默改名 ─────────────────────────────────────
  - name: 再次新建，改成已存在的 probe
    do: click
    target: { role: AXButton, name: "^default-name-sub$", button: right }
  - name: 点「新建文件…」
    do: click
    target: { any: "新建文件…" }
  - name: 全选后键入 probe（与既有 probe.md 撞名）
    do: typeInNode
    target: { role: AXTextField, name: "未命名笔记|probe" }
    text: "probe"
  - name: Enter 提交
    do: key
    key: "return"
    expect:
      - label: 撞名被拒绝并把原因回显在编辑行
        ax: { has: /已存在同名条目/ }
      - label: 编辑态仍保留（MUST NOT 静默改名后创建）
        ax: { has: '/AXTextField = "probe" /' }
      # 同上：未被覆盖 = 整篇仍为空，必须 exact；撞名后写入任意正文时这条会红。
      - label: 既有 probe.md 未被覆盖（仍是空文件）
        file: { path: default-name-sub/probe.md, exact: "" }
  - name: Escape 收尾
    do: key
    key: "escape"

teardown:
  - label: 收尾：关档创建的文件在合成 vault 里
    file: { path: default-name-sub/offcase.md, exists: true }
  - label: 收尾：开档键入替换后创建的文件在合成 vault 里
    file: { path: default-name-sub/probe.md, exists: true }
  - label: 收尾：撞名递增创建的文件在合成 vault 里
    file: { path: default-name-sub/未命名笔记 2.md, exists: true }
  - label: 收尾：占位文件未被改写
    file: { path: default-name-sub/未命名笔记.md, has: "占位笔记一。" }
  - label: 收尾：fixture 原文未动
    file: { path: note.md, has: "相对目标" }
---

# 728 —— 新建文件的默认名（change add-default-note-name-nov24）

## 本场景在验什么

1. **关档基线**：`editor.prefill_note_name` 为 `false` 时，新建文件输入框为空，创建的是用户
   输入的名字——与 change 之前逐字相同。
2. **设置开关真的落盘并立即生效**：⌘, 打开面板 → 点第五个开关 → 保存 → `env:config.json` 出现
   `"prefill_note_name": true`；关闭面板后下一次新建即预填，不需要重启。
3. **预填与全选**：输入框值为 `未命名笔记`（不含 `.md`）；直接键入 `probe` 后输入框**恰为**
   `probe`（追加形态会是 `未命名笔记probe`，两条断言都会红）。
4. **Enter 接受 + 焦点**：`probe.md` 落盘为空文件，焦点按既有创建链落到正文（`AXTextArea`），
   随后键入的字符进入该文档。
5. **Escape 取消**：预填的 `未命名笔记.md` 不被创建。
6. **撞名递增**：同级已有 `未命名笔记.md` 时预填 `未命名笔记 2` 并接受；既有文件逐字节不变。
7. **自定义撞名不静默改名**：把预填名改成已存在的 `probe` 后 Enter 被拒绝、编辑态保留、行内
   回显撞名原因，既有 `probe.md` 不被覆盖。

## 判据通道

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 预填值 / 替换是否成立 | **AXTextField 值面**（`/AXTextField = "…" /`） | AX 读不到输入框的选区状态；「恰为键入值」是选中后替换的可观测后果 |
| 开关落盘 | **`env:config.json` 字符串** | 设置保存走原子写，文件是最终事实 |
| 创建 / 取消 / 撞名 | **磁盘事实**（`file.exists` / `file.has`）+ 行内 AX 原因 | 命令返回值读不到 |
| 焦点 | **`ax.focused: AXTextArea`** 解析形态 | 与 47c 同一口径，不用跨节点正则 |

## 已知边界（如实登记）

- **文件树初始滚动位置（r1 真机现场）**：验收 vault 每次重置为全部 `.md` fixtures，树里文件很多；
  启动时 `open: note.md` 会把树滚到文件段中部。目录段按 `byTreeOrder` 排序在文件之前，因此场景
  新建的 `default-name-sub` 落在视口上方（r1 AX 读数 @207,-929），右键的**真实指针坐标**不可达，
  首跑因此在第一个右键动作上 FAIL、后续 teardown 连锁红。修法是 test-only：在第一次右键前
  `do: scroll`（`wheel: true` 真实 CGEvent 滚轮，`dy` 正数 = 向上滚，M669 标定）把目录段带回
  视口；**没有放宽任何产品断言**。r2 真机 1/1 PASS；把两处空文件判据改为 `file.exact: ""`
  后 r3 真机 1/1 PASS（41 断言，`0 字符逐字一致`），证据
  `.local/acceptance/2026-11-24-default-note-name-r3/`。
- **全选状态本身读不到**：WKWebView 的 AX 不暴露 input 的 selection range。本场景用「键入后
  输入框恰为键入值、且不含默认名」作区分性判据——若实现只把 caret 放在末尾，值会是
  `未命名笔记probe`，两条断言同时红。
- **`typeInNode` 对原生输入框走真实 Unicode keyDown**（M507）：这正是「替换选区」需要的
  通道；`press_key` 逐键注入对输入框有丢键前科，不用于本场景的素材注入。标记串不含 `e`
  （本机 `press_key` 对 `e` 有确定性丢失的历史），正文键入仍走 `do: keys`。
- **惰性目录边界**：自动编号只看已加载的同级条目；本场景的落点目录是普通目录、条目全在树里，
  不覆盖「惰性目录里存在前端不可见同名文件」这一边界（由后端拒绝兜底，归 Rust 撞名语义）。
- **不判手感**：输入框预填后的视觉宽度、全选高亮的观感归 Alex；本场景只留截图。
