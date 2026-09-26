---
id: "40-table-fullscreen-view"
item: 40
title: 表格放大全屏查看：命令打开遮罩、快照在场、Esc 关闭焦点回编辑器、降级表无入口、不改写源文件
fixtures: [table-fullscreen.md]
open: table-fullscreen.md
marker: "表格全屏场景"
config:
  keys: { "Cmd-j": "table.toggle-fullscreen" }
steps:
  - name: 终态：非矩形表整块降级（无 grid DOM）、正常表渲染为 grid（两条一起钉，负向断言才有区分度）
    expect:
      - label: 非矩形表的降级归因文案在场（保留原始 Markdown）
        ax: { has: "第 1 行单元格数与表头不符" }
      - label: 正常表渲染成 AX 表（唯一的 grid 表 ⇒ 它就是命令的靶子）
        ax: { has: "AXTable (Markdown 表格 1)" }
      - label: 正常表的源码态不在渲染正文里（确实渲染成表了）
        editor: { not: "| 名称 | 内容 |" }
      - shot: 终态

  - name: 基线：记录编辑器内容（供末尾两条 unchangedSince 逐字节比较）
    do: recordEditor
    as: before
    expect:
      - label: 打开前标签栏有一条标签（遮罩打开后它会从 AX 树里消失，这条是那个变化的对照）
        ax: { has: "关闭 table-fullscreen.md" }

  - name: 基线：记录磁盘文件 sha256/mtime
    do: record
    file: table-fullscreen.md
    as: doc
    expect:
      - label: 磁盘基线已记下
        file: { path: table-fullscreen.md, exists: true }

  - name: 负对照：caret 落在降级表里（文档首块）时执行命令 → 无遮罩、事件不被消费
    do: clickEditor
    dx: 40
    dy: 20
    expect:
      - label: 遮罩未出现（降级表没有 grid DOM ⇒ 命中条件为假）
        ax: { has: "关闭 table-fullscreen.md" }
      - label: 正文未被改写（事件落到原生路径，没有别的副作用）
        editor: { unchangedSince: before }

  - name: 正观测：caret 进正常表 → 命令打开遮罩，快照几何非零 + 表格文本在场
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: caret 已进表（grid 表仍在）
        ax: { has: "Markdown 表格 1" }
  - name: 执行 table.toggle-fullscreen（经 [keys] 绑定的 ⌘J）
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩里的快照表几何读数非零（不可见元素在 AX 里照样有文本行，所以判几何）
        ax: { count: { pattern: "/AXTable \\(Markdown 表格 1\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
      - label: 快照的表格文本在场（几何 + 文本两条一起钉，防「AX 文本可读 ≠ 元素可见」）
        ax: { has: "甲" }
      - label: AX 树被模态接管（标签栏从树里消失 ⇒ 上两条判的是遮罩里那张，不是文档内那张）
        ax: { not: "关闭 table-fullscreen.md" }
      - shot: 遮罩打开

  - name: 关闭路径一：Esc（就地消费）关闭并交还焦点
    do: key
    key: "escape"
    expect:
      - label: 遮罩已退场（模态作用域撤销：标签栏回到 AX 树里）
        ax: { has: "关闭 table-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - shot: Esc 关闭后

  - name: 关闭路径二：点击遮罩（面板以外的区域）
    do: clickInNode
    target: { role: "AXTable", any: "Markdown 表格 1" }
    dx: 0.5
    dy: 0.5
    expect:
      - label: 先证遮罩关着（点击落在文档内的表上）
        ax: { has: "关闭 table-fullscreen.md" }
  - name: 重新打开
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩又开着（下一条负向断言因此不是在空转）
        ax: { not: "关闭 table-fullscreen.md" }
  - name: 点遮罩空白区（窗口局部坐标）
    do: click
    target: { x: 600, y: 60 }
    expect:
      - label: 遮罩已退场（点击遮罩这条关闭路径）
        ax: { has: "关闭 table-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - shot: 点遮罩关闭后

  - name: 关闭路径三：再次执行同一命令（toggle）
    do: key
    key: "cmd+j"
    expect:
      - label: 先证遮罩开着
        ax: { not: "关闭 table-fullscreen.md" }
  - name: 再执行一次 ⌘J
    do: key
    key: "cmd+j"
    expect:
      - label: 遮罩已退场（toggle 是命令入口的自然对偶）
        ax: { has: "关闭 table-fullscreen.md" }
      - label: 焦点回到编辑器
        ax: { focused: "AXTextArea" }
      - shot: toggle 关闭后

  - name: 全程不改写源文件（ADR 0003 §3）：编辑器内容与磁盘文件逐字节不变
    expect:
      - label: 编辑器内容与基线逐字节相同
        editor: { unchangedSince: before }
      - label: 磁盘文件 sha256 与基线相同
        file: { path: table-fullscreen.md, unchangedSince: doc }
      - shot: 收尾
---

# 40 表格放大全屏查看（table-fullscreen-view）

真机（WKWebView）层的行为验收：`table.toggle-fullscreen`（D3 双入口的命令侧）打开应用内全屏遮罩，
内容是打开那一刻渲染态 grid 的只读快照副本。

## 覆盖（对应 `openspec/changes/table-fullscreen-view/tasks.md`）

| 任务 | 本场景的承接 |
|---|---|
| 6.1 新增场景 | 本文件 + `fixtures/table-fullscreen.md`；触发走 `[keys]` 配置绑定（`09b-keys-config` 先例），与视觉场景 `tests/visual/scenes/m240-table-fullscreen.spec.ts` 同一条路径 |
| 6.2 真机反向验证 | 去掉入口：把本场景的 `config.keys` 改成不绑定 `table.toggle-fullscreen`（或回退实现）后重跑，第 5 步起的遮罩断言必须 FAIL；现场留档 |
| 6.3 不改写源文件 | 末尾两条独立断言：`editor: unchangedSince: before` + `file: unchangedSince: doc` |
| 6.4 场景 md 与 fixture 同 PR | 本节两个文件随实现同 PR |

## 判据口径（为什么这么写）

- **遮罩开着靠两条一起钉**：① 快照表的几何读数非零（`AXTable (Markdown 表格 1) @x,y w×h`）——
  不可见元素在 AX 文本里照样有节点行（M178），只判文本存在会假绿；② 标签栏节点从 AX 树里消失
  ——`aria-modal` 的 dialog 让 AX 作用域收到模态子树。② 是把 ① 「钉在遮罩里那张」上的唯一手段：
  快照的读屏名**故意**与文档内那张相同（复用同一份 `Markdown 表格 N` 标签，spec 要求），所以只靠
  名字与几何分不开两处。
- **负向断言配同场景正观测**（REVIEW.md 第 2 条）：第 4 步在降级表里执行命令断言「遮罩不出现」，
  第 5 步在同一份文档的正常表里执行同一命令断言「遮罩出现」——后一条把前一条从「命令坏了」
  这一类恒真里分开。
- **焦点断言走解析结果**：`ax: { focused: "AXTextArea" }` 要求 AX 里恰有一个 focused 节点且 role
  命中（跨节点正则没有节点边界意识）。
- **代际变化（外部重载）这一条不在本场景**：遮罩开着时经外部通道改写文件需要套件在遮罩打开期间
  投递 `vaultWrite` 并等重载链路跑完，本场景的步骤粒度做不到「等到重载完成再断言」——该路径
  在 chromium 层由视觉场景覆盖（`m240-table-fullscreen.spec.ts` 的 5.5 收尾：焦点移出遮罩即
  关闭且不抢焦点）。真机层如实记为**未覆盖**，不写成「已验」。
- **手感层不下沉**（AGENTS.md）：遮罩内滚动节奏、快照观感（宽表在壳内被裁）归 Alex dogfood，
  本场景只留截图。

## 副作用

`clickInNode` / `click` 会移动真实鼠标并在目标窗口产生真实点击；`do: click` 的 `{x, y}` 是窗口局部
坐标（遮罩覆盖整窗，`(600,60)` 落在面板以外的区域）。跑本场景期间 Lumir 窗口需要在前台且不被遮挡，
否则点击落到别的窗口上，表现为「遮罩没关掉」这类与产品无关的 FAIL。
