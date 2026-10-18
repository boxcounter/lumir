---
id: "168-paste-image-semantic-name"
item: 554
title: 贴图后异步语义改名 + 正文引用同步 + toast 撤销（change add-semantic-image-naming）
config:
  # mock provider 恒支持 vision（design §10）：贴图即触发一次命名调用。mock 的 `naming` 队列
  # 脚本化返回固定 slug `Harness Arch`（fixtures/harness-mock-semantic-naming.json），
  # 规整后是 `harness-arch`，最终文件名 `<slug>-<内容哈希前 6 位>.webp`。
  # **显式声明 semantic_naming** 是 design §10 的纪律：mock + 贴图的场景不能靠默认值碰运气。
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-semantic-naming.json"
  attachments:
    semantic_naming: true
steps:
  - name: 造笔记（落盘目录 = 当前笔记同目录）
    do: vaultWrite
    file: notes/n1.md
    content: "# 语义命名目标\n\n贴图前的正文。\n"
    expect:
      - label: 笔记已落盘
        file: { path: notes/n1.md, has: "语义命名目标" }

  - name: 等 watch 增量把 notes 目录刷进树（行进场再点，不等则点击会扑空）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开 notes/n1.md
    do: open
    file: notes/n1.md
    marker: "语义命名目标"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "语义命名目标" }

  - name: 编辑器建立焦点（WebKit 原生右键菜单的前置）
    do: clickEditor
    expect:
      - shot: 01-打开笔记

  - name: 剪贴板置合成 png
    do: clipboardImage
    synth: { width: 320, height: 200, seed: 41 }

  - name: 右键唤出 WebKit 原生上下文菜单
    do: click
    target: { role: AXTextArea, button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 完成真实粘贴（粘贴先落暂存名 + 插引用，命名异步随后）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等异步命名落定（toast 与渲染出来的引用都要是新语义名）
    do: waitFor
    # 一次读取同时判两件事：① 成功 toast 带新文件名（`已命名为 <slug>-<hash6>.webp`）；
    # ② live preview 渲染出来的引用已经是新名（dirty 文档的内存引用被对账改写过）。
    # 判据落在**渲染结果**上而不是引用原文（M514 的教训，见场景 112 的注释）。
    waitFor:
      has:
        - "/已命名为 harness-arch-[0-9a-f]{6}\\.webp/"
        - "/AXImage[^\n]*harness-arch-[0-9a-f]{6}\\.webp/"
    timeoutMs: 40000
    expect:
      - label: 语义名文件恰好一个（`<slug>-<hash6>.webp`）
        glob: { dir: notes, pattern: "harness-arch-[0-9a-f]{6}\\.webp$", exact: 1 }
      - label: 暂存名文件不残留（改名不是拷贝）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 0 }
      - label: toast 带「撤销」动作（窗口 = 该 toast 的可见期）
        ax: { has: "/AXButton \\(撤销\\)/" }
      - shot: 02-语义命名成功

  - name: 点「撤销」（必须赶在 toast 可见期内）
    do: click
    target: { role: AXButton, name: "撤销" }

  - name: 等反向操作落定（文件与引用都回到暂存名）
    do: waitFor
    waitFor:
      has:
        - "/已撤销命名，文件恢复为 pasted-[0-9a-f]{16}\\.webp/"
        - "/AXImage[^\n]*pasted-[0-9a-f]{16}\\.webp/"
    timeoutMs: 40000
    expect:
      - label: 文件名回到 `pasted-<hash16>.webp`
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 语义名文件不再存在
        glob: { dir: notes, pattern: "harness-arch-", exact: 0 }
      - shot: 03-撤销恢复暂存名

  - name: 清理本次产物
    do: vaultRm
    file: notes/n1.md
---

# 贴图后的异步语义命名与撤销（S6，change add-semantic-image-naming）

## 这个场景验什么

一条完整链路：真机粘贴（暂存名 + `![[pasted-…]]` 引用）→ 异步一次性 vision 调用（mock 的
`naming` 队列）→ slug 规整（`Harness Arch` → `harness-arch`）→ 文件改名
`<slug>-<hash6>.webp` → 正文引用同步改写（dirty 文档走内存重算）→ 带「撤销」的 toast。

撤销是同一条链路的对称反向操作：引用改回 + 文件改回 `pasted-<hash16>.webp`。

## 为什么这么驱动

- 粘贴通道复用场景 112 的既定通道（WKWebView 原生上下文菜单 Paste，不是 ⌘V 注入）。
- mock 的 `naming` 队列是**独立**于会话 `responses` 的第三条队列（Rust `MockClient` 的
  `queue_from_str`）：共用一条队列会把既有对话场景的脚本整体错位。
- `waitFor` 一次读两件事（toast 文案 + AXImage 的引用名）：撤销动作的窗口只有 8 秒，判据
  拆成多次 AX 往返会把窗口耗掉（这是本条按最短路径组织断言的原因）。

## 覆盖边界（如实登记）

- **模型调用的真实网络面不在这里**：mock 只证明「请求发出去了、回包被规整、改名与引用同步
  落地」。真 provider 的 vision 请求（`input_image` 走 wire）由 harness 既有的真机通道与
  Rust 单测覆盖，本 change 不新增真 API 调用。
- **撤销窗口的过期分支**不在本场景（点不到按钮就没法驱动）；令牌过期 / 文件已被再次改名的
  放弃判据由 Rust 单测覆盖。
- 两次改名之间不做逐字节对比（WebP 内容不变，但 mtime 会变）：本场景判的是名字与引用。
