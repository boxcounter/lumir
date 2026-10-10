---
id: "112-paste-image-to-vault"
item: 112
title: 贴剪贴板图片入 vault（落盘笔记同目录 + 转码 + 内容寻址命名 + 引用 + 渲染）
steps:
  - name: 造 notes/s1.md（vaultWrite 支持嵌套路径）
    do: vaultWrite
    file: notes/s1.md
    content: "# S1 粘贴目标\n\n正文一行。\n"
    expect:
      - label: 嵌套笔记已落盘
        file: { path: notes/s1.md, has: "S1 粘贴目标" }

  - name: 等 watch 增量把 notes 目录刷进树（行进场再点，不等则点击会扑空）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场（watch 增量已刷新）
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开 notes/s1.md
    do: open
    file: notes/s1.md
    marker: "S1 粘贴目标"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "S1 粘贴目标" }

  - name: 编辑器建立焦点（WebKit 原生右键菜单的前置：先左键点一次目标）
    do: clickEditor
    expect:
      - shot: S1-打开笔记

  - name: 剪贴板置合成 png（AppleScript «class PNGf» 标准通道）
    do: clipboardImage
    synth: { width: 480, height: 320, seed: 7 }

  - name: 右键唤出 WebKit 原生上下文菜单
    do: click
    target: { role: AXTextArea, button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点原生菜单 Paste 完成真实粘贴
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等落盘与引用插入（状态驱动，不用 sleep 猜时长）
    do: waitFor
    waitFor:
      has: ["/!\\[\\[pasted-[0-9a-f]{16}\\.webp\\]\\]/"]
    timeoutMs: 40000
    expect:
      - label: 笔记同目录出现转码后的附件（恰好一个）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 落盘字节是 WebP 容器，且文件名哈希 = 落盘字节 sha256 前 16 位
        bytes: { path: "notes/pasted-*.webp", magic: "52494646", nameHash: true }
      - label: 文档插入 ![[pasted-<hash16>.webp]] 引用（编辑器把该行渲染成图片 widget，AXTextArea value 不含它；按实跑 AX 形态断言编辑器子树的图片节点 label）
        ax: { has: "/AXImage \\(!\\[\\[pasted-[0-9a-f]{16}\\.webp\\]\\]\\)/" }
      - label: live preview 渲染出该图片（AX 有引用这条附件的图片节点）
        ax: { has: "/AXImage[^\n]*pasted-[0-9a-f]{16}\\.webp/" }
      - shot: S1-贴图入vault

  - name: 清理本次产物，不给后续场景留残留
    do: vaultRm
    file: notes/s1.md
---

# 剪贴板贴图入 vault（S1，change paste-clipboard-image）

## 这个场景验什么

从**真机粘贴**到**落盘 + 引用 + 渲染**的整条链路：md 笔记聚焦 → 剪贴板置一张合成 png →
WebKit 原生上下文菜单 Paste → 附件落在**当前笔记同目录**、字节是转码后的 WebP 容器、
文件名是**内容寻址**形态（`pasted-<落盘字节 sha256 前 16 位>.webp`），文档插入 `![[name]]`
引用且 live preview 渲染出来。

## 为什么这么驱动

- **粘贴通道**：M345 登记过「⌘V 注入在真机不落地」，M415 探针找到替代通道——对 WKWebView
  内容区**右键唤出原生上下文菜单**、点其中的 Paste，走的是与真实用户同一段 WebKit paste 链路
  （finding `20261010-worker-m415-idea-webkit-paste-m415.md`）。因此这里用
  `click {role: AXTextArea, button: right}` + 点 `AXMenuItem /Paste|粘贴/`，不用 ⌘V。
  菜单项按**正则**定位不锁索引：M415 实测它的 AX 索引每次快照都可能变。
- **剪贴板置图**：合成 png 经 `osascript` 的 `«class PNGf»`（同一条固定命令纪律，不开通用
  shell 通道），pasteboard 上同时出现 `public.png` 与 `public.tiff`——正是系统截图的形态。

## 覆盖边界（如实登记）

- **逐像素无损**不在本层判：本套件没有 PNG/WebP 解码器（零新增依赖的口径），像素级往返由
  Rust 单测钉住（`fs_io::tests::write_attachment_transcodes_png_to_lossless_webp_and_round_trips_pixels`，
  带 alpha / 无 alpha 两条）。本层判的是「字节确实是 WebP 容器 + 引用渲染得出来」。
- **图片节点的 AX 形态**按实跑读数写：`AXImage` 节点的 label 带整条引用原文（M184 的既有形态），
  断言用它 + 文件名做正则匹配。
